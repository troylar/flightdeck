// Pins (2.0 slice 2, part 2): nested runs, plans and skills follow the exact version they name, and nothing falls back to
// the latest. version: on a {run.process} step pins at publish (pinned-children); a run/3 pins every other child when it
// starts; a run/2 parent never starts or adopts a child on a /2 version and offers a 2.0 run instead. Plans with an exact
// folder are plan/2. Exact skill registrations live in skill-registrations/ (pinned-skills on the step).
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), M = PF.map, P = PF.publish, R = PF.run, E = PF.envelope;
const plain = (v) => JSON.parse(JSON.stringify(v));
const AT = '2026-10-20T09:00:00.000Z';

const CHILD = (title) => ['---', 'process: verify', 'title: ' + (title || 'Check in code'), 'context: ticket, env', '---', '', '## One {#one}', '- [ ] {confirm} Look {#look}', ''].join('\n');
const PARENT = (extra) => ['---', 'process: backup', 'title: Backup check', 'context: ticket, rows', 'roles: lead', '---', '', '## Prepare {#prep}',
  '- [!] {confirm} Read the restore runbook @lead {#read}', '- [ ] {run.process} Verify the copy {#verify}', '  process: verify'].concat(extra || []).concat(['', '## Close {#close}',
  '- [ ] {run.skill} Write the report {#report}', '  skill: release-notes', ''])
  .join('\n');
const exactOf = (files) => P.exactOf({ 'map.md': new Uint8Array(Buffer.from(files['map.md'], 'utf8')), 'types.json': new Uint8Array(Buffer.from(files['types.json'], 'utf8')) });
let seq = 0;
function publish(md, extra) {
  const b = P.build(md, Object.assign({ by: 'person-avery', changes: 'x', now: AT, existing: [], rand: 'a' + String(++seq).padStart(7, '0'), app: '2.0.0' }, extra || {}));
  if (b.blockers) return b;
  const v = P.verify(b.folder, b.files, exactOf(b.files)); assert.ok(v.ok, v.why); v.folder = b.folder; v.process = M.parse(md).meta.process; v.files = b.files;
  return v;
}
/* A process as the app lists it: the index of its usable versions, plus the ones that can't be used here. */
function proc(pubs, broken) { const i = P.index(pubs); return { latest: i.latest, all: i.all, clashes: i.clashes, broken: broken || [] }; }
function childProc(versions) {
  const out = []; let existing = [];
  versions.forEach((t) => { const v = publish(CHILD(t), { existing }); out.push(v); existing = existing.concat([{ version: v.info.version }]); });
  return out;
}

/* ---------- Syntax ---------- */
rule('version: on a {run.process} step and skillVersion: on a {run.skill} step parse, check and name the 2.0 features they need', () => {
  const m = M.parse(PARENT(['  version: 4']).replace('  skill: release-notes', '  skill: release-notes\n  skillVersion: 1.2.0'));
  assert.deepStrictEqual(plain(m.errors), []);
  assert.strictEqual(M.findStep(m, 'verify').step.fields.version, '4');
  assert.strictEqual(M.findStep(m, 'report').step.fields.skillVersion, '1.2.0');
  assert.deepStrictEqual(plain(M.features(m)), ['pinned-children', 'pinned-skills']);
  assert.deepStrictEqual(plain(M.check(m, {}).blockers), []);
  assert.deepStrictEqual(plain(M.features(M.parse(PARENT()))), [], 'a link without version: is 1.x syntax');
  const bad = (md, re) => { const b = M.check(M.parse(md), {}).blockers; assert.ok(b.some(x => re.test(x)), JSON.stringify(b)); };
  bad(PARENT(['  version: four']), /"version" should be a version number, like 4/);
  bad(PARENT(['  version: 0']), /"version" should be a version number, like 4/);
  bad(PARENT().replace('- [!] {confirm} Read the restore runbook @lead {#read}', '- [!] {confirm} Read the restore runbook @lead {#read}\n  version: 4'), /has a field "version" that \{confirm\} doesn't use/);
  bad(PARENT().replace('- [!] {confirm} Read the restore runbook @lead {#read}', '- [!] {confirm} Read the restore runbook @lead {#read}\n  skillVersion: 1.0'), /has a field "skillVersion"/);
  bad(PARENT().replace('  skill: release-notes', '  skill: release-notes\n  skillVersion: has spaces'), /"skillVersion" should be the skill's version, like 1\.2\.0/);
});

rule('A pin is never a field a run can change, and the frozen built-in types are unchanged (T.VERSION stays 2)', () => {
  assert.strictEqual(PF.types.VERSION, 2);
  const t = PF.types.get('run.process');
  assert.ok(!('version' in t.fields), 'run.process\'s own fields are unchanged');
  assert.ok(PF.types.editable(t).indexOf('version') < 0 && PF.types.editable(PF.types.get('run.skill')).indexOf('skillVersion') < 0);
});

/* ---------- Publishing pins ---------- */
rule('publish.build resolves version: to one folder and records it in the payload (pins.children), with the skill pin; the version is /2 with pinned-children and pinned-skills', () => {
  const kids = childProc(['Check in code', 'Check in code', 'Check in code', 'Check in code']);
  const md = PARENT(['  version: 2']).replace('  skill: release-notes', '  skill: release-notes\n  skillVersion: 1.2.0');
  const v = publish(md, { childProcs: { verify: proc(kids) } });
  assert.ok(!v.blockers, JSON.stringify(v.blockers));
  assert.strictEqual(v.info.format, 'preflight-publication/2');
  assert.deepStrictEqual(plain(v.info.features), ['pinned-children', 'pinned-skills']);
  assert.deepStrictEqual(plain(v.info.payload.pins), { children: { verify: { process: 'verify', version: 2, folder: kids[1].info.folder, mapHash: kids[1].info.mapHash, typesHash: kids[1].info.typesHash } }, skills: { report: { name: 'release-notes', version: '1.2.0' } } });
  assert.deepStrictEqual(Object.keys(v.info.payload), ['map', 'types', 'images', 'extensions', 'pins'], 'the frozen payload shape');
});

rule('version: that can\'t be resolved to exactly one usable folder stops the publish, naming why: not published, missing, two folders with that number, unusable', () => {
  const kids = childProc(['A', 'B']);
  const blockers = (md, procs) => { const b = publish(md, { childProcs: procs }); assert.ok(b.blockers, 'refused'); return b.blockers.join(' '); };
  assert.ok(/"verify" isn't published in this folder/.test(blockers(PARENT(['  version: 1']), {})));
  assert.ok(/verify v9 isn't in this folder/.test(blockers(PARENT(['  version: 9']), { verify: proc(kids) })));
  const twin = publish(CHILD('Twin'), { existing: [] });
  assert.ok(/two versions are numbered verify v1 here/.test(blockers(PARENT(['  version: 1']), { verify: proc(kids.concat([twin])) })));
  assert.ok(/verify v1 can't be used here: still syncing/.test(blockers(PARENT(['  version: 1']), { verify: proc([kids[1]], [{ ok: false, folder: kids[0].info.folder, why: 'Still syncing: some files haven\'t arrived.' }]) })));
});

rule('verify reads a /2 version\'s pins: well-formed pins that match its checklist are fine; pins that differ from its version: lines, or odd ones, make it unusable', () => {
  const kids = childProc(['A']), md = PARENT(['  version: 1']);
  const b = P.build(md, { by: 'a', changes: 'x', now: AT, existing: [], rand: 'pinpin01', app: '2.0.0', childProcs: { verify: proc(kids) } });
  const info = JSON.parse(b.files['publication.json']);
  assert.ok(P.verify(b.folder, b.files, exactOf(b.files)).ok);
  const edit = (f) => { const i = JSON.parse(JSON.stringify(info)); f(i); return P.verify(b.folder, Object.assign({}, b.files, { 'publication.json': JSON.stringify(i) }), exactOf(b.files)); };
  const off = [
    edit(i => { i.payload.pins.children.verify.version = 2; }),
    edit(i => { i.payload.pins.children.other = i.payload.pins.children.verify; }),
    edit(i => { delete i.payload.pins.children.verify; }),
    edit(i => { i.payload.pins.children.verify.process = 'other'; }),
    edit(i => { i.payload.pins.children.verify.extra = 1; }),
    edit(i => { i.payload.pins.skills.report = { name: 'x', version: '1' }; })
  ];
  off.forEach((v, k) => assert.ok(!v.ok && v.unusable, k + ': ' + v.why));
});

rule('The payload\'s pins are hashed as canonical JSON (key order never matters), the one way any reader compares two payloads', () => {
  const a = { map: 'm', types: 't', images: {}, extensions: {}, pins: { children: { v: { process: 'verify', version: 1, folder: 'v1-aaaa1111', mapHash: '00000001', typesHash: '00000002' } }, skills: {} } };
  const b = { pins: { skills: {}, children: { v: { typesHash: '00000002', mapHash: '00000001', folder: 'v1-aaaa1111', version: 1, process: 'verify' } } }, extensions: {}, images: {}, types: 't', map: 'm' };
  assert.strictEqual(P.canonical(a), P.canonical(b));
  assert.strictEqual(P.payloadHash(a), P.payloadHash(b));
  assert.ok(/^[0-9a-f]{64}$/.test(P.payloadHash(a)));
  const c = JSON.parse(JSON.stringify(a)); c.pins.children.v.folder = 'v1-bbbb2222';
  assert.notStrictEqual(P.payloadHash(a), P.payloadHash(c), 'a resolved pin is part of it');
});

/* ---------- Runs: pins at start, the child's folder ---------- */
function linked(kids, extra, opts) {
  const parent = publish(PARENT(extra), Object.assign({ childProcs: { verify: proc(kids) } }, opts || {}));
  assert.ok(!parent.blockers, JSON.stringify(parent.blockers));
  return parent;
}
rule('A run/3 pins every child when it starts: version: pins from the payload, the rest at the latest usable version now; pinned-children is one of its features', () => {
  const kids = childProc(['A', 'B']), parent = linked(kids, ['  version: 1']);
  const procs = { verify: proc(kids) };
  const r = R.create(parent, { by: 'person-avery', session: 'w', now: AT, app: '2.0.0', pins: PF.pins.atStart(parent.map, parent.info.payload.pins, (id) => procs[id] || null) });
  assert.strictEqual(r.format, 'preflight-run/3');
  assert.deepStrictEqual(plain(r.pins), { children: { verify: plain(parent.info.payload.pins.children.verify) } }, 'the version\'s own pin, v1, not the latest');
  assert.ok(r.features.indexOf('pinned-children') >= 0);
  const back = R.sanitize(plain(r));
  assert.ok(!back._unrunnable, back._unrunnable);
  assert.deepStrictEqual(plain(back.pins), plain(r.pins));
  assert.deepStrictEqual(plain(R.unexplained(plain(back))), [], 'read back exactly');
});

rule('A run/3 without version: pins the latest child when it starts; a later child version doesn\'t change what it runs; the start uses the pin and records child.folder', () => {
  const kids = childProc(['A']), parent = linked(kids, [], {});
  /* No 2.0 syntax here: the parent is /1, so a run/3 on it is an explicit 2.0 run (R2-4). */
  assert.strictEqual(parent.info.format, 'preflight-publication/1');
  let procs = { verify: proc(kids) };
  const r = R.create(parent, { by: 'person-avery', session: 'w', now: AT, app: '2.0.0', explicit: true, details: { ticket: 'ABC-1' }, pins: PF.pins.atStart(parent.map, null, (id) => procs[id] || null) });
  assert.strictEqual(r.pins.children.verify.folder, kids[0].info.folder);
  const later = childProc(['A', 'B']); procs = { verify: proc(kids.concat([later[1]])) };
  const step = M.findStep(R.mapOf(r), 'verify').step, t = PF.pins.childTarget(r, step, (id) => procs[id] || null);
  assert.strictEqual(t.pub.info.folder, kids[0].info.folder, 'still v1, though v2 is published');
  const kid1 = R.create(t.pub, { id: 'kid1', by: 'a', session: 'w', now: AT, details: { ticket: 'ABC-1' } });
  R.linkChild(r, R.mapOf(r), 'verify', { process: 'verify', id: 'kid1', inputs: { ticket: 'ABC-1' }, folder: t.pub.info.folder, format: 'preflight-run/2' }, 'person-avery', AT, { run: kid1, procOf: (id) => procs[id] || null });
  assert.strictEqual(r.steps.verify.child.folder, kids[0].info.folder);
  const back = R.sanitize(plain(r));
  assert.ok(!back._unrunnable, back._unrunnable); assert.strictEqual(back.steps.verify.child.folder, kids[0].info.folder);
  // Changed child details: the linked child no longer counts, and a new one starts on the same pin, never the latest.
  R.setDetail(r, R.mapOf(r), 'ticket', 'ABC-2', 'person-avery', AT);
  assert.ok(!R.childCurrent(r, step, r.steps.verify), 'the child was for other details');
  assert.strictEqual(PF.pins.childTarget(r, step, (id) => procs[id] || null).pub.info.folder, kids[0].info.folder, 'Start again: the pin');
});

rule('Keeping a conflict copy keeps the pin its child was given when it first started, so the kept run never falls back to a later child version', () => {
  const parent = linked(childProc(['A']), [], {});
  /* The parent starts before its child process is published: nothing is pinned yet. */
  const r = R.create(parent, { by: 'person-avery', session: 'w', now: AT, app: '2.0.0', explicit: true, details: { ticket: 'ABC-1' }, pins: PF.pins.atStart(parent.map, null, () => null) });
  assert.ok(!(r.pins && r.pins.children && r.pins.children.verify), 'no pin at start');
  const cur = R.sanitize(plain(r)), copy = R.sanitize(plain(r));
  const kids = childProc(['A']); let procs = { verify: proc(kids) };
  const kid1 = R.create(kids[0], { id: 'kid1', by: 'a', session: 'w', now: AT, details: { ticket: 'ABC-1' } });
  R.linkChild(copy, R.mapOf(copy), 'verify', { process: 'verify', id: 'kid1', inputs: { ticket: 'ABC-1' }, folder: kids[0].info.folder, format: 'preflight-run/2' }, 'person-avery', AT, { run: kid1, procOf: (id) => procs[id] || null });
  assert.strictEqual(copy.pins.children.verify.folder, kids[0].info.folder, 'pinned when the child first started');
  R.adopt(cur, R.sanitize(plain(copy)), 'person-avery', AT);
  assert.deepStrictEqual(plain(cur.pins), plain(copy.pins), 'the kept copy\'s pin comes with it');
  assert.ok(cur.features.indexOf('pinned-children') >= 0, 'and the feature that says so');
  const later = childProc(['A', 'B']); procs = { verify: proc(kids.concat([later[1]])) };
  const back = R.sanitize(plain(cur)); assert.ok(!back._unrunnable, back._unrunnable);
  assert.strictEqual(PF.pins.childTarget(back, M.findStep(R.mapOf(back), 'verify').step, (id) => procs[id] || null).pub.info.folder, kids[0].info.folder, 'still v1, though v2 is published');
  assert.deepStrictEqual(plain(R.unexplained(plain(back))), [], 'read back exactly');
});

rule('A pinned child that can\'t be used refuses the start in the plan\'s words, and never falls back: missing folder, another folder with the same number, a clash, changed files', () => {
  const kids = childProc(['A']), parent = linked(kids, ['  version: 1']);
  const r = R.create(parent, { by: 'person-avery', session: 'w', now: AT, app: '2.0.0', pins: PF.pins.atStart(parent.map, parent.info.payload.pins, () => null) });
  const step = M.findStep(R.mapOf(r), 'verify').step;
  const why = (procs) => { const t = PF.pins.childTarget(r, step, (id) => procs[id] || null); assert.ok(!t.pub && t.why, JSON.stringify(t)); return t.why; };
  const other = publish(CHILD('Other'), { existing: [] }), latest = childProc(['Check in code', 'Check in code'])[1];
  assert.strictEqual(why({ verify: proc([latest]) }), 'This step runs Check in code v1, which can\'t be used here: ' + kids[0].info.folder + ' isn\'t in this folder.');
  assert.ok(/^This step runs .* v1, which can't be used here: this folder's v1 is a different version \(v1-/.test(why({ verify: proc([other, latest]) })));
  assert.ok(/two versions are numbered v1 here/.test(why({ verify: proc([kids[0], other]) })));
  const edited = JSON.parse(JSON.stringify(r)); edited.pins.children.verify.mapHash = 'ffffffff';
  const t = PF.pins.childTarget(edited, step, (id) => ({ verify: proc(kids) })[id]);
  assert.ok(/its files don't match what was pinned/.test(t.why), t.why);
});

/* ---------- Legacy parents (review #1, rule c) ---------- */
function legacyParent() {
  const kids = childProc(['A']), two = publish(CHILD('Check in code').replace('## One {#one}', '## One {#one}\n  > A 2.0 phase note.'), { existing: [{ version: 1 }] });
  assert.strictEqual(two.info.format, 'preflight-publication/2');
  const parent = linked(kids, []), r = R.create(parent, { id: 'oldparent', by: 'person-avery', session: 'w', now: AT, details: { ticket: 'ABC-1', rows: '12' }, roles: { lead: 'person-avery' } });
  assert.strictEqual(r.format, 'preflight-run/2');
  return { kids, two, parent, r, procs: { verify: proc(kids.concat([two])) } };
}
rule('A run/2 parent never starts a child on a /2 version: the target says so in the plan\'s words, and offers a 2.0 run', () => {
  const x = legacyParent(), step = M.findStep(R.mapOf(x.r), 'verify').step;
  const t = PF.pins.childTarget(x.r, step, (id) => x.procs[id] || null);
  assert.ok(t.legacy && !t.pin);
  assert.strictEqual(t.why, 'Check in code v2 needs a run made with Flightdeck 2.0. Start a new run of this checklist on v1 to use it.');
  const fine = PF.pins.childTarget(x.r, step, (id) => ({ verify: proc(x.kids) })[id]);
  assert.ok(fine.pub && !fine.legacy, 'a /1 child starts as today');
});

rule('A run/2 parent never adopts a run/3 child: linking (an orphan, or Start again), settling, hand-off, take over and pick up all refuse', () => {
  const x = legacyParent(), map = R.mapOf(x.r);
  const child3 = { format: 'preflight-run/3', process: 'verify', id: 'kid3', title: 'Check in code for Backup', details: { ticket: 'ABC-1' }, ended: { outcome: 'Completed', by: 'a', at: AT }, steps: {}, gates: {} };
  assert.throws(() => R.linkChild(x.r, map, 'verify', { process: 'verify', id: 'kid3', inputs: { ticket: 'ABC-1' }, format: 'preflight-run/3' }, 'person-avery', AT), /made with Flightdeck 2\.0/);
  /* A hand-made link (2.0 never writes one): */
  x.r.steps.verify = { s: 'open', child: { process: 'verify', id: 'kid3', inputs: { ticket: 'ABC-1' } } };
  assert.strictEqual(R.childVerdict(x.r, M.findStep(map, 'verify').step, x.r.steps.verify, child3), null, 'never settled from it');
  assert.throws(() => R.settleChild(x.r, map, 'verify', child3, 'person-avery', AT), /made with Flightdeck 2\.0/);
  const nameOnly = R.sanitize({ format: 'preflight-run/9', id: 'kid3', process: 'verify', title: 'X', snapshot: '', steps: {}, gates: {}, recorder: { person: 'a' } });
  assert.strictEqual(R.childVerdict(x.r, M.findStep(map, 'verify').step, x.r.steps.verify, Object.assign(nameOnly, { ended: { outcome: 'Completed' } })), null, 'nor from a name-only one');
  const links = R.legacyLinks(x.r, (k) => (k === 'verify/kid3' ? child3 : null));
  assert.deepStrictEqual(plain(links.map(l => l.step)), ['verify']);
  assert.throws(() => R.handOff(x.r, 'person-blake', 'person-avery', AT, links), /Start it as a Flightdeck 2\.0 run/);
  assert.throws(() => R.takeOver(x.r, 'person-blake', 'w2', AT, links), /Start it as a Flightdeck 2\.0 run/);
  assert.throws(() => R.pickUp(x.r, 'person-blake', 'w2', AT, links), /Start it as a Flightdeck 2\.0 run/);
  /* A run/3 parent takes a run/3 child as usual. */
  R.handOff(x.r, 'person-blake', 'person-avery', AT, []);
});

rule('Start it as a Flightdeck 2.0 run: a run/3 on the same /1 version, chosen by a person, with details and roles copied and no answers, its children pinned; the old step is Blocked "Continued in run <key>" and stays refused', () => {
  const x = legacyParent(), map = R.mapOf(x.r);
  R.done(x.r, map, 'read', 'person-avery', AT);
  const n = R.continuation(x.r, x.parent, { by: 'person-avery', session: 'w', now: AT, app: '2.0.0', id: 'newrun1', pins: PF.pins.atStart(x.parent.map, null, (id) => x.procs[id] || null) });
  assert.strictEqual(n.format, 'preflight-run/3');
  assert.deepStrictEqual(plain(n.features), ['pinned-children']);
  assert.strictEqual(n.folder, x.r.folder); assert.strictEqual(n.version, 1);
  assert.ok(!('payload' in n), 'a /1 version has no payload');
  assert.strictEqual(n.typesHash, x.parent.info.typesHash);
  assert.deepStrictEqual(plain(n.details), plain(x.r.details)); assert.deepStrictEqual(plain(n.roles), plain(x.r.roles));
  assert.deepStrictEqual(plain(n.steps), {}, 'answers aren\'t copied');
  assert.strictEqual(n.pins.children.verify.folder, x.two.info.folder, 'the 2.0 child is pinned');
  assert.strictEqual(n.title, 'Backup check (continued)');
  assert.ok(/Continued from run backup\/oldparent/.test(n.log.map(l => l.what).join('\n')));
  R.continued(x.r, map, 'verify', n, 'person-avery', AT);
  assert.strictEqual(x.r.steps.verify.s, 'blocked'); assert.strictEqual(x.r.steps.verify.reason, 'Continued in run backup/newrun1');
  assert.strictEqual(x.r.format, 'preflight-run/2', 'the old parent stays run/2');
  const back = R.sanitize(plain(n));
  assert.ok(!back._unrunnable, back._unrunnable);
  /* The order of the frozen sample (run-e, an explicit 2.0 run on a /1 version). */
  const sample = JSON.parse(require('../tools/v2-samples').tree('folder')['runs/backup/run-e/run.json']);
  const mine = Object.keys(plain(back)).filter(k => k in sample);
  assert.deepStrictEqual(mine, Object.keys(sample).filter(k => k in back));
  const step = M.findStep(R.mapOf(n), 'verify').step, t = PF.pins.childTarget(n, step, (id) => x.procs[id] || null);
  assert.strictEqual(t.pub.info.folder, x.two.info.folder, 'the new run starts the /2 child');
});

rule('The explicit 2.0 run sample (run-e) reads in full here: run/3 with no payload and an empty migrations list', () => {
  const sample = JSON.parse(require('../tools/v2-samples').tree('folder')['runs/backup/run-e/run.json']);
  const r = R.sanitize(sample);
  assert.ok(r && !r._unrunnable, r && r._unrunnable);
  assert.strictEqual(r.format, 'preflight-run/3');
  const odd = Object.assign({}, sample, { migrations: [{ path: 'details.ticket' }] });
  assert.ok(R.sanitize(odd)._unrunnable, 'a migration record needs typed data (slice 3)');
});

/* ---------- Skills on run/3 steps ---------- */
rule('Done on a {run.skill} step in a run/3 records the registration as observed (id, rev, sha, a snapshot of at most 2 KB); a mismatch with skillVersion is a warning, never a block', () => {
  const kids = childProc(['A']), md = PARENT(['  version: 1']).replace('  skill: release-notes', '  skill: release-notes\n  skillVersion: 1.2.0');
  const parent = publish(md, { childProcs: { verify: proc(kids) } });
  const r = R.create(parent, { by: 'person-avery', session: 'w', now: AT, app: '2.0.0', pins: {} }), map = R.mapOf(r);
  const reg = { id: 'sk-aaaa1111', rev: 2, sha: 'a'.repeat(64), name: 'release-notes', version: '1.3.0', location: 'https://example.com/x', description: 'd'.repeat(5000), implements: { process: 'backup', folder: parent.info.folder, mapHash: parent.info.mapHash, typesHash: parent.info.typesHash } };
  R.done(r, map, 'read', 'person-avery', AT); R.na(r, map, 'verify', 'person-avery', AT);
  r.gates[map.phases[0].gate.id] = { s: 'passed', by: 'a', at: AT, approved: {} };
  assert.strictEqual(R.skillWarning(r, M.findStep(map, 'report').step, reg), 'This step expects release-notes 1.2.0. The team folder registers 1.3.0.');
  R.done(r, map, 'report', 'person-avery', AT, { _skill: PF.skills.observed(reg) });
  const s = r.steps.report.skill;
  assert.deepStrictEqual([s.id, s.rev, s.sha], ['sk-aaaa1111', 2, 'a'.repeat(64)]);
  assert.ok(JSON.stringify(s.snapshot).length <= 2048 && s.snapshot.name === 'release-notes' && s.snapshot.version === '1.3.0');
  assert.strictEqual(PF.skills.observedWords(s), 'Registered as release-notes 1.3.0 when this step was checked');
  assert.ok(r.features.indexOf('pinned-skills') >= 0);
  const back = R.sanitize(plain(r));
  assert.ok(!back._unrunnable, back._unrunnable);
  assert.deepStrictEqual(plain(back.steps.report.skill), plain(s));
  /* A run/2 never records one: its format is frozen. */
  const r2 = R.create(publish(PARENT()), { by: 'a', session: 'w', now: AT });
  R.done(r2, R.mapOf(r2), 'read', 'a', AT); R.na(r2, R.mapOf(r2), 'verify', 'a', AT); r2.gates[R.mapOf(r2).phases[0].gate.id] = { s: 'passed', by: 'a', at: AT, approved: {} };
  R.done(r2, R.mapOf(r2), 'report', 'a', AT, { _skill: PF.skills.observed(reg) });
  assert.ok(!('skill' in r2.steps.report));
});


/* ---------- Skill registrations (skill-registrations/<name>/<id>.<rev>.<window>.json) ---------- */
const SK = PF.skills;
function reg(over, file) {
  const o = Object.assign({ format: 'flightdeck-skill/2', app: '2.0.0', id: 'sk-aaaa1111', rev: 1, seen: null, name: 'release-notes', version: '1.2.0', location: 'https://example.com/skills/release-notes',
    implements: { process: 'backup', folder: 'v2-zzzz2222', mapHash: 'b7bf4bf0', typesHash: 'dff477ba' }, description: 'Writes the release notes.', by: 'person-avery', updated: AT }, over || {});
  const text = JSON.stringify(o, null, 2) + '\n';
  return { o, text, file: file || 'skill-registrations/' + o.name + '/' + o.id + '.' + o.rev + '.w-twozero.json', sha: require('crypto').createHash('sha256').update(text).digest('hex') };
}
rule('A skill/2 registration is read by checkV2: its exact pin, id, rev and the SHA-256 of its bytes; anything else in its place is refused with a reason', () => {
  const r = reg(), c = SK.checkV2(JSON.parse(r.text), r.file, r.sha);
  assert.deepStrictEqual(plain(c.errors), []);
  assert.deepStrictEqual([c.skill.name, c.skill.process, c.skill.implements, c.skill.regId, c.skill.rev, c.skill.sha, c.skill.file], ['release-notes', 'backup', 2, 'sk-aaaa1111', 1, r.sha, r.file]);
  assert.deepStrictEqual(plain(c.skill.exact), { process: 'backup', folder: 'v2-zzzz2222', mapHash: 'b7bf4bf0', typesHash: 'dff477ba' });
  const bad = (o, file, re) => { const x = SK.checkV2(o, file || r.file, r.sha); assert.ok(x.errors.length && re.test(x.errors.join(' ')), JSON.stringify(x.errors)); };
  bad(Object.assign({}, r.o, { implements: 'backup@2' }), null, /implements/);
  bad(Object.assign({}, r.o, { rev: 0 }), null, /rev/);
  bad(r.o, 'skill-registrations/other-name/sk-aaaa1111.1.w-twozero.json', /folder/);
  bad(r.o, 'skill-registrations/release-notes/sk-aaaa1111.2.w-twozero.json', /file name/);
  bad(Object.assign({}, r.o, { format: 'flightdeck-skill/3' }), null, /newer Flightdeck/);
  /* A /2 registration in skills/ isn't read there. */
  const legacy = SK.check(r.o, 'release-notes.json');
  assert.ok(!legacy.skill && /skill-registrations\//.test(legacy.errors[0]), JSON.stringify(legacy.errors));
});

rule('The current registration is the highest rev; two files at that rev are Needs review; a tombstone and a registration are one skill; every refusal is "can\'t be matched", never "current"', () => {
  const one = reg(), two = reg({ rev: 2, seen: 1, version: '1.3.0' }), clash = reg({ rev: 2, seen: 1, version: '1.4.0' }, 'skill-registrations/release-notes/sk-aaaa1111.2.w-other.json');
  const cv = (x) => SK.checkV2(JSON.parse(x.text), x.file, x.sha);
  const tomb = SK.check({ name: 'release-notes', implements: 'moved', movedTo: 'skill-registrations/release-notes/', id: 'sk-aaaa1111' }, 'release-notes.json');
  let list = SK.merge([Object.assign(tomb, { file: 'release-notes.json' })], [cv(one), cv(two)]);
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual([list[0].skill.rev, list[0].skill.version, list[0].errors.length], [2, '1.3.0', 0]);
  list = SK.merge([], [cv(one), cv(two), cv(clash)]);
  assert.ok(list.length === 1 && /Needs review: two registrations of release-notes at revision 2/.test(list[0].errors.join(' ')), JSON.stringify(plain(list)));
  /* A tombstone whose registration hasn't arrived. */
  list = SK.merge([Object.assign(tomb, { file: 'release-notes.json' })], []);
  assert.ok(/still arriving/.test(list[0].errors.join(' ')) && list[0].unmatched, JSON.stringify(plain(list)));
  /* A legacy registration (not a tombstone) beside one with the same name. */
  const old = SK.check({ name: 'release-notes', version: '1.0.0', implements: 'backup@1' }, 'release-notes.json'); old.file = 'release-notes.json';
  list = SK.merge([old], [cv(one)]);
  assert.ok(list.every(x => x.unmatched && /Two registrations for release-notes; keep one/.test(x.errors.join(' '))) && list.length === 1, 'one entry for the name, can\'t be matched: ' + JSON.stringify(plain(list)));
});

rule('skills.status matches a registration by its exact folder and fingerprints: missing folder, another folder with that number, a mismatch and an unusable version are "can\'t be matched"; the same folder as the latest is current', () => {
  const v1 = publish(PARENT()), v2 = publish(PARENT().replace('Read the restore', 'Now read the restore'), { existing: [{ version: 1 }] });
  const skillOn = (pub, over) => SK.checkV2(Object.assign({}, reg().o, { implements: Object.assign({ process: 'backup', folder: pub.info.folder, mapHash: pub.info.mapHash, typesHash: pub.info.typesHash }, over || {}) }), reg().file, 'a'.repeat(64)).skill;
  const p = proc([v1, v2]);
  assert.strictEqual(SK.status(skillOn(v2), p.all, p.latest, p).s, 'current');
  const up = SK.status(skillOn(v1), p.all, p.latest, p);
  assert.strictEqual(up.s, 'update'); assert.strictEqual(up.base.info.folder, v1.info.folder);
  const gone = SK.status(skillOn(v1), [v2], v2, proc([v2]));
  assert.deepStrictEqual([gone.s, gone.text], ['unmatched', 'Can\'t be matched: built from backup v1 (' + v1.info.folder + '), which isn\'t in this folder.']);
  const twin = publish(PARENT().replace('Write the report', 'Write the other report'));
  const other = SK.status(skillOn(v1), [twin, v2], v2, proc([twin, v2]));
  assert.ok(other.s === 'unmatched' && /this folder's v1 is a different version/.test(other.text), other.text);
  const mism = SK.status(skillOn(v1, { mapHash: 'ffffffff' }), p.all, p.latest, p);
  assert.ok(mism.s === 'unmatched' && /don't match/.test(mism.text), mism.text);
  const broken = SK.status(skillOn(v1), [v2], v2, proc([v2], [{ ok: false, folder: v1.info.folder, why: 'Still syncing: some files haven\'t arrived.' }]));
  assert.ok(broken.s === 'unmatched' && /still syncing/.test(broken.text), broken.text);
});

/* ---------- Envelope ---------- */
/* ---------- Plans ---------- */
const PL = () => PF.plans;
const planFields = { id: 'plan-verify-a1', process: 'verify', title: 'Check', details: { ticket: 'T-1' }, roles: {}, by: 'person-avery', created: AT };
rule('A plan for a 2.0 version, or an exact pin to any version, is a plan/2 (format, no kind) pinned to the folder; a 1.x version keeps the number plan', () => {
  const [one] = childProc(['Check in code']), two = publish(PARENT(['  version: 1']), { childProcs: { verify: proc([one]) } });
  const p2 = PL().make(two, Object.assign({}, planFields, { process: 'backup' }), false, '2.0.0');
  assert.deepStrictEqual(Object.keys(p2), ['format', 'app', 'id', 'process', 'pin', 'title', 'details', 'roles', 'by', 'created'], 'the frozen sample\'s order');
  assert.strictEqual(p2.format, 'flightdeck-plan/2'); assert.ok(!('kind' in p2) && !('version' in p2));
  assert.deepStrictEqual(plain(p2.pin), { folder: two.info.folder, version: two.info.version, mapHash: two.info.mapHash, typesHash: two.info.typesHash });
  const n = PL().make(one, planFields, false, '2.0.0');
  assert.strictEqual(n.kind, 'plan'); assert.strictEqual(n.version, 1); assert.ok(!('format' in n) && !('pin' in n));
  const x = PL().make(one, planFields, true, '2.0.0');
  assert.strictEqual(x.format, 'flightdeck-plan/2', 'an exact pin to a /1 version is plan/2 too'); assert.strictEqual(x.pin.folder, one.info.folder);
  const sample = JSON.parse(require('../tools/v2-samples.js').tree('folder')['proposals/plan-backup-pinned.json']);
  assert.deepStrictEqual(Object.keys(p2), Object.keys(sample), 'the writer\'s output equals the frozen shape');
});

rule('PF.plans.clean reads plan/2 and its decisions (retargeted to an exact folder); reading for other apps (contract 1) names them newer, as before', () => {
  const [one] = childProc(['Check in code']), p2 = PL().make(one, planFields, true, '2.0.0');
  assert.deepStrictEqual(plain(PL().clean(p2, 'plan-verify-a1.json')), { ok: true, kind: 'plan', why: '' });
  const v1 = PL().clean(p2, 'plan-verify-a1.json', true);
  assert.strictEqual(v1.ok, false); assert.strictEqual(v1.kind, 'newer'); assert.strictEqual(v1.needs, '2.0');
  const bad = (o, re) => { const v = PL().clean(o, 'x.json'); assert.ok(v.ok && re.test(v.why), JSON.stringify(v)); };
  bad(Object.assign({}, p2, { pin: Object.assign({}, p2.pin, { version: 9 }) }), /isn't a version folder/);
  bad(Object.assign({}, p2, { pin: { folder: p2.pin.folder, version: p2.pin.version } }), /without its fingerprints/);
  bad(Object.assign({}, p2, { version: 1 }), /names a version two ways/);
  const plan = Object.assign({}, p2, { _hash: 'aaaa0001' });
  const st = PL().decision(plan, 'retargeted', null, 'person-avery', AT, { folder: 'v2-zzzz2222', version: 2 }, '2.0.0');
  const sample = JSON.parse(require('../tools/v2-samples.js').tree('folder')['proposals/plan-backup-pinned.status-w-twozero.json']);
  assert.deepStrictEqual(Object.keys(st), Object.keys(sample), 'the frozen decision shape');
  assert.deepStrictEqual(plain(PL().clean(st, 'p.status-w.json')), { ok: true, kind: 'status', why: '' });
  assert.strictEqual(PL().clean(st, 'p.status-w.json', true).kind, 'newer');
  const acc = PL().decision(plan, 'accepted', 'r1', 'person-avery', AT, null, '2.0.0');
  assert.strictEqual(acc.format, 'flightdeck-plan-status/2'); assert.strictEqual(acc.run, 'r1'); assert.ok(!('to' in acc));
  assert.ok(/isn't accepted or declined/.test(PL().clean({ kind: 'status', proposal: 'p', status: 'retargeted', to: { folder: 'v2-zzzz2222', version: 2 } }, 'x').why), 'a 1.x decision never retargets');
  assert.ok(/isn't a version folder/.test(PL().clean(Object.assign({}, st, { to: { folder: 'v2-zzzz2222', version: 3 } }), 'x').why));
  const old = PL().decision(Object.assign({ kind: 'plan', id: 'p', process: 'x', version: 1 }, { _hash: 'h' }), 'declined', null, 'b', AT, null, '2.0.0');
  assert.deepStrictEqual(Object.keys(old), ['kind', 'proposal', 'proposalHash', 'status', 'run', 'by', 'at'], 'a number plan\'s decision is today\'s');
});

rule('A plan/2 starts only on its pin or a version a person switched it to: a missing folder, another folder with that number, a clash or two switches that disagree ask, never the latest; a number plan keeps falling back', () => {
  const kids = childProc(['Check in code', 'Check in code']), [k1, k2] = kids, p2 = PL().make(k1, planFields, true, '2.0.0');
  let x = PL().pick(proc(kids), p2, null);
  assert.strictEqual(x.pub.info.folder, k1.info.folder); assert.ok(x.older && x.exact);
  x = PL().pick(proc([k2]), p2, 'whatever');
  assert.strictEqual(x.pub, null); assert.ok(/isn't in this folder/.test(x.ask), x.ask);
  const other = childProc(['Check in code'])[0];
  x = PL().pick(proc([other, k2]), p2, null);
  assert.strictEqual(x.pub, null); assert.ok(/is a different version/.test(x.ask), x.ask);
  x = PL().pick(proc([k1, other, k2]), p2, null);
  assert.strictEqual(x.pub, null); assert.ok(/a person has to choose one/.test(x.ask), x.ask);
  const moved = Object.assign({}, p2, { _retarget: { status: 'retargeted', to: { folder: k2.info.folder, version: 2 } } });
  x = PL().pick(proc([k2]), moved, null);
  assert.strictEqual(x.pub.info.folder, k2.info.folder); assert.ok(x.chosen && !x.older);
  x = PL().pick(proc([k2]), Object.assign({}, p2, { _retargetClash: [k1.info.folder, k2.info.folder] }), null);
  assert.strictEqual(x.pub, null); assert.ok(/two people switched it/.test(x.ask));
  const num = PL().make(k1, planFields, false, '2.0.0');
  x = PL().pick(proc([k2]), num, null);
  assert.strictEqual(x.pub.info.folder, k2.info.folder, 'a number plan whose version is gone starts on the latest, as every copy does'); assert.ok(x.missing && !x.exact);
});

rule('In a folder: plan/2 and its retarget are read and grouped (the switch is not a decision); READ (contract 1) names them newer; recordPlanStatus writes plan-status/2 for a plan/2', async () => {
  const kids = childProc(['Check in code', 'Check in code']), [k1, k2] = kids, p2 = PL().make(k1, planFields, true, '2.0.0');
  const m = new PF.fs.MemoryFS('pins:' + Math.random(), null);
  m.reset({ 'proposals/plan-verify-a1.json': JSON.stringify(p2, null, 2) });
  let got = await PF.repo.readPlans(m, null);
  let g = PF.repo.groupPlans(got.plans, got.statuses);
  assert.strictEqual(g.length, 1); assert.strictEqual(g[0]._retarget, null);
  await PF.repo.recordPlanStatus(m, g[0], 'w1', 'retargeted', null, 'person-avery', { folder: k2.info.folder, version: 2 }, '2.0.0');
  const written = JSON.parse(m.files['proposals/plan-verify-a1.status-w1.json'].t);
  assert.strictEqual(written.format, 'flightdeck-plan-status/2'); assert.deepStrictEqual(written.to, { folder: k2.info.folder, version: 2 });
  got = await PF.repo.readPlans(m, null); g = PF.repo.groupPlans(got.plans, got.statuses);
  assert.strictEqual(g[0]._retarget.to.folder, k2.info.folder); assert.strictEqual(g[0]._status, null, 'a switch isn\'t a decision'); assert.ok(!g[0]._conflicting);
  assert.strictEqual(PL().pick(proc(kids), g[0], null).pub.info.folder, k2.info.folder);
  await PF.repo.recordPlanStatus(m, g[0], 'w2', 'retargeted', null, 'person-casey', { folder: k1.info.folder, version: 1 }, '2.0.0');
  got = await PF.repo.readPlans(m, null); g = PF.repo.groupPlans(got.plans, got.statuses);
  assert.ok(g[0]._retargetClash && !g[0]._retarget); assert.strictEqual(PL().pick(proc(kids), g[0], null).pub, null);
  const bad = []; got = await PF.repo.readPlans(m, bad);
  assert.strictEqual(got.plans.length + got.statuses.length, 0);
  assert.deepStrictEqual(bad.map(b => b.kind), ['newer', 'newer', 'newer']);
});

rule('Fuzz: every plan/2 and plan-status/2 sample with a field removed, wrong-typed or hostile never throws in loadAll or READ; each bad file is refused there, never kept', async () => {
  const tree = require('../tools/v2-samples').tree('folder');
  const PLAN = 'proposals/plan-backup-pinned.json', STATUS = 'proposals/plan-backup-pinned.status-w-twozero.json';
  const hostile = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}},"toString":1,"valueOf":{},"hasOwnProperty":"no"}');
  const deep = JSON.parse('['.repeat(200) + ']'.repeat(200));
  const values = [undefined, 1, -1, 1.5, true, null, '', 'x'.repeat(100000), [], {}, hostile, deep];
  let n = 0, bad = 0;
  for (const target of [PLAN, STATUS]) {
    const base = JSON.parse(tree[target]);
    const paths = [];
    Object.keys(base).forEach(k => { paths.push([k]); if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) Object.keys(base[k]).forEach(k2 => paths.push([k, k2])); });
    paths.push(['__proto__']);
    for (const p of paths) for (const v of values) {
      const o = JSON.parse(tree[target]);
      const holder = p.length === 2 ? o[p[0]] : o, key = p[p.length - 1];
      if (v === undefined) delete holder[key]; else Object.defineProperty(holder, key, { value: v, enumerable: true, writable: true, configurable: true });
      const text = JSON.stringify(o);
      const m = new PF.fs.MemoryFS('fuzz:' + Math.random(), null);
      m.reset(Object.assign({}, { [PLAN]: tree[PLAN], [STATUS]: tree[STATUS] }, { [target]: text }));
      const label = target + ' ' + p.join('.') + ' = ' + (v === undefined ? '(removed)' : JSON.stringify(v).slice(0, 40));
      let app, read;
      try { app = await PF.repo.loadAll(m); } catch (e) { assert.fail(label + ': loadAll threw ' + e.message); }
      try { read = await PF.repo.loadAll(m, { readOnly: true, explain: true, deep: true }); } catch (e) { assert.fail(label + ': READ threw ' + e.message); }
      n++;
      const parsed = JSON.parse(text), dispatch = parsed && (typeof parsed.format === 'string' || parsed.kind === 'plan' || parsed.kind === 'status');
      const v2 = PF.plans.clean(parsed, target.slice(10), false), isBad = !v2.ok || !!v2.why;
      if (!isBad) continue;
      bad++;
      assert.ok((read.malformed || []).some(x => x.path === target), label + ': READ names it');
      if (!dispatch) continue;
      assert.ok((app.refused || []).some(x => x.path === target), label + ': the app refuses it: ' + JSON.stringify(app.refused));
      const kept = target === PLAN ? app.plans.filter(x => x._file === target.slice(10)) : app.plans.filter(x => x._retarget || x._status);
      assert.deepStrictEqual(kept.length, 0, label + ': never kept');
    }
  }
  assert.ok(n > 150 && bad > 80, n + ' variants, ' + bad + ' bad');
});

rule('A child pin is a version JavaScript holds exactly: 1e999, -1e999 and 2^53+1 (with a folder numbered to match) are refused in the app and the folder check alike, never read as a number that saves differently', () => {
  const PY = require('child_process').spawnSync;
  const check = require('path').join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', '_flightdeck');
  for (const n of ['1e999', '-1e999', '9007199254740993']) {
    const text = '{"process":"verify","version":' + n + ',"folder":"v' + n.replace(/^-/, '') + '-abcd1234","mapHash":"aaaaaaaa","typesHash":"bbbbbbbb"}';
    assert.strictEqual(PF.pins.childOk(JSON.parse(text)), false, n + ': the app refuses it');
    const py = PY('python3', ['-I', '-c', 'import sys, json; sys.path.insert(0, sys.argv[1]); import check_folder as c; print(c.child_pin_ok(json.loads(sys.argv[2])))', check, text], { encoding: 'utf8' });
    assert.strictEqual(py.stdout.trim(), 'False', n + ': the folder check refuses it: ' + py.stderr);
  }
  assert.strictEqual(PF.pins.childOk({ process: 'verify', version: 9007199254740991, folder: 'v9007199254740991-abcd1234', mapHash: 'aaaaaaaa', typesHash: 'bbbbbbbb' }), true, 'the largest whole number JavaScript holds exactly is still a version');
});

/* ---------- Signatures ---------- */
rule('PF.signature: a step\'s signature includes its resolved pin (child or skill), and the process signature hashes the pins as canonical JSON; correction identity is unchanged', () => {
  const kids = childProc(['Check in code', 'Check in code']), cp = { verify: proc(kids) };
  const md = (n) => PARENT(['  version: ' + n]).replace('  skill: release-notes', '  skill: release-notes\n  skillVersion: 1.2.0');
  const a = publish(md(1), { childProcs: cp }), b = publish(md(2), { childProcs: cp });
  const pinsOf = (v) => v.info.payload.pins, sa = PF.signature.steps(a.map, a.types, a.info.images, pinsOf(a)), sb = PF.signature.steps(b.map, b.types, b.info.images, pinsOf(b));
  assert.notStrictEqual(sa.verify.sig, sb.verify.sig, 'pinned to another version: the step changed');
  assert.strictEqual(sa.read.sig, sb.read.sig, 'other steps didn\'t');
  assert.notStrictEqual(PF.signature.process(a), PF.signature.process(b));
  const swapped = JSON.parse(JSON.stringify(a)); const c = swapped.info.payload.pins.children.verify; swapped.info.payload.pins.children.verify = { typesHash: c.typesHash, mapHash: c.mapHash, folder: c.folder, version: c.version, process: c.process };
  assert.strictEqual(PF.signature.process(swapped), PF.signature.process(a), 'key order never matters');
  const s2 = publish(md(1).replace('skillVersion: 1.2.0', 'skillVersion: 1.3.0'), { childProcs: cp });
  assert.notStrictEqual(PF.signature.steps(s2.map, s2.types, s2.info.images, pinsOf(s2)).report.sig, sa.report.sig, 'a skill pinned to another version: the step changed');
  const ch = PF.skills.changes(a, b, ['verify']);
  assert.ok(ch.some(x => x.id === 'verify' && x.change === 'changed'), JSON.stringify(ch));
  const other = JSON.parse(JSON.stringify(pinsOf(a))); other.children.verify.folder = kids[0].info.folder.replace(/-.*/, '-zzzzzzzz'); other.children.verify.mapHash = '00000000';
  assert.notStrictEqual(PF.signature.steps(a.map, a.types, a.info.images, other).verify.sig, sa.verify.sig, 'the same line resolved to another folder: the step changed');
  assert.strictEqual(PF.corrections.stepSig(a.map, 'verify'), PF.corrections.stepSig(M.parse(a.md || md(1)), 'verify'), 'correction identity is the map\'s alone, never its pins');
});

rule('PF.signature: a {run.process} step without carry: depends on the run details it shares (implicit carry); with carry: only on what it names', () => {
  const kids = childProc(['Check in code']), cp = { verify: proc(kids) };
  const a = publish(PARENT(), { childProcs: cp }), b = publish(PARENT().replace('context: ticket, rows', 'context: ticket, rows, env'), { childProcs: cp });
  const sa = PF.signature.steps(a.map, a.types), sb = PF.signature.steps(b.map, b.types);
  assert.notStrictEqual(sa.verify.sig, sb.verify.sig, 'implicit carry: a new run detail may be passed on');
  assert.strictEqual(sa.read.sig, sb.read.sig);
  const ca = publish(PARENT(['  carry: ticket']), { childProcs: cp }), cb = publish(PARENT(['  carry: ticket']).replace('context: ticket, rows', 'context: ticket, rows, env'), { childProcs: cp });
  assert.strictEqual(PF.signature.steps(ca.map, ca.types).verify.sig, PF.signature.steps(cb.map, cb.types).verify.sig, 'explicit carry: only what it names');
});

/* ---------- Evidence ---------- */
rule('Evidence checks a run/3\'s payload against its version by the shared canonical hash, and the pins it started with against the version\'s own', () => {
  const kids = childProc(['Check in code']), v = publish(PARENT(['  version: 1']), { childProcs: { verify: proc(kids) } });
  const r = JSON.parse(JSON.stringify(R.create(v, { by: 'person-avery', session: 'w', now: AT, app: '2.0.0', pins: PF.pins.atStart(v.map, v.info.payload.pins, () => proc(kids)) })));
  const files = v.files, check = (raw, id) => PF.evidence.checks(raw, files, null).find(c => c.id === id);
  let c = check(r, 'payload');
  assert.ok(c && c.ok === true, JSON.stringify(c));
  const swapped = JSON.parse(JSON.stringify(r)); const pl = swapped.payload; swapped.payload = { pins: pl.pins, extensions: pl.extensions, images: pl.images, types: pl.types, map: pl.map };
  assert.strictEqual(check(swapped, 'payload').ok, true, 'key order never matters');
  const edited = JSON.parse(JSON.stringify(r)); edited.payload.pins.children.verify.version = 9;
  assert.strictEqual(check(edited, 'payload').ok, false);
  const moved = JSON.parse(JSON.stringify(r)); moved.pins.children.verify.folder = 'v1-zzzzzzzz';
  c = check(moved, 'pins');
  assert.ok(c && c.ok === false && /verify/.test(c.detail), JSON.stringify(c));
  assert.strictEqual(check(r, 'pins').ok, true);
  const two = JSON.parse(JSON.stringify(PF.evidence.checks(JSON.parse(JSON.stringify(R.create(kids[0], { by: 'a', session: 'w', now: AT }))), kids[0].files, null)));
  assert.ok(!two.some(x => x.id === 'payload' || x.id === 'pins'), 'a run/2 on a /1 version has neither');
});

/* ---------- Review fixes (pins, part 2) ---------- */
rule('A run/3 pinned to a child version never adopts or settles from a run on another version: linking an orphan, a hand-edited link and settlement all refuse; the pinned one settles', () => {
  const kids = childProc(['A', 'B']), parent = linked(kids, ['  version: 1']), procs = { verify: proc(kids) }, procOf = (id) => procs[id] || null;
  const r = R.create(parent, { by: 'person-avery', session: 'w', now: AT, app: '2.0.0', details: { ticket: 'ABC-1' }, pins: PF.pins.atStart(parent.map, parent.info.payload.pins, procOf) });
  const map = R.mapOf(r), step = M.findStep(map, 'verify').step, inputs = { ticket: 'ABC-1' };
  assert.strictEqual(r.pins.children.verify.folder, kids[0].info.folder, 'set-up: pinned to v1');
  const kid = (pub, id) => Object.assign(R.create(pub, { id, by: 'a', session: 'w', now: AT, details: { ticket: 'ABC-1' }, parent: { process: 'backup', id: r.id, step: 'verify', inputs, folder: r.folder } }), { ended: { outcome: 'Completed', by: 'a', at: AT } });
  const v2 = kid(kids[1], 'kid2'), v1 = kid(kids[0], 'kid1');
  const linkOf = (c) => ({ process: c.process, id: c.id, inputs, folder: c.folder, mapHash: c.mapHash, typesHash: c.typesHash });
  const opts = (c) => ({ run: c, procOf, findRun: () => null });
  // Adoption (Link it on an orphan): a run on v2 can't stand for a step pinned to v1.
  assert.throws(() => R.linkChild(r, map, 'verify', linkOf(v2), 'person-avery', AT, opts(v2)), /pinned to verify v1/);
  assert.ok(!r.steps.verify || !r.steps.verify.child, 'nothing linked');
  // Without the child run and the folder's versions, nothing can be checked, so nothing is adopted.
  assert.throws(() => R.linkChild(r, map, 'verify', linkOf(v1), 'person-avery', AT), /pinned/);
  // A hand-edited link to the v2 run: never settles the step, either way.
  const hand = plain(r); hand.steps.verify = { s: 'open', child: { process: 'verify', id: 'kid2', inputs, folder: kids[1].info.folder } };
  assert.strictEqual(R.childVerdict(hand, step, hand.steps.verify, v2, procOf), null, 'no verdict from another version');
  assert.throws(() => R.settleChild(hand, map, 'verify', v2, 'person-avery', AT, procOf), /pinned/);
  assert.strictEqual(hand.steps.verify.s, 'open');
  const failed = Object.assign(plain(v2), { ended: { outcome: 'Cancelled', by: 'a', at: AT } });
  assert.strictEqual(R.childVerdict(hand, step, hand.steps.verify, failed, procOf), null, 'nor blocks it');
  // Even with child.folder edited to say v1, the child's own version decides.
  hand.steps.verify.child.folder = kids[0].info.folder;
  assert.throws(() => R.settleChild(hand, map, 'verify', v2, 'person-avery', AT, procOf), /pinned/);
  // The run on the pinned version links and settles; without the folder's versions, it doesn't.
  R.linkChild(r, map, 'verify', linkOf(v1), 'person-avery', AT, opts(v1));
  assert.strictEqual(R.childVerdict(r, step, r.steps.verify, v1), null, 'unverifiable: no match');
  assert.throws(() => R.settleChild(plain(r), map, 'verify', v1, 'person-avery', AT), /pinned/);
  assert.strictEqual(R.settleChild(r, map, 'verify', v1, 'person-avery', AT, procOf), 'done');
  // A child whose version files changed since the pin (same folder, other fingerprints) doesn't settle either.
  const r2 = R.create(parent, { by: 'person-avery', session: 'w', now: AT, app: '2.0.0', details: { ticket: 'ABC-1' }, pins: PF.pins.atStart(parent.map, parent.info.payload.pins, procOf) });
  r2.steps.verify = { s: 'open', child: { process: 'verify', id: 'kid1', inputs, folder: kids[0].info.folder } };
  const edited = Object.assign(plain(v1), { mapHash: 'ffffffff' });
  assert.throws(() => R.settleChild(r2, map, 'verify', edited, 'person-avery', AT, procOf), /pinned/);
});

rule('One child-pin verdict judges a run/2 child by its verified publication: same folder and checklist but other step types never match, and a missing or unverifiable version never matches', () => {
  const kids = childProc(['A']), parent = linked(kids, ['  version: 1']), good = kids[0];
  /* Another publication with the same folder name and checklist, but different step types: a run/2 child of it records no
     typesHash, only its frozen types. */
  const types = JSON.parse(JSON.stringify(good.types)); types.confirm = Object.assign({}, types.confirm || {}, { label: 'Changed' });
  const twin = Object.assign({}, good, { types, info: Object.assign({}, good.info, { typesHash: 'ffffffff' }) });
  const procs = { verify: proc(kids) }, procOf = (id) => procs[id] || null;
  const r = R.create(parent, { by: 'person-avery', session: 'w', now: AT, app: '2.0.0', details: { ticket: 'ABC-1' }, pins: PF.pins.atStart(parent.map, parent.info.payload.pins, procOf) });
  const map = R.mapOf(r), step = M.findStep(map, 'verify').step, pin = r.pins.children.verify, inputs = { ticket: 'ABC-1' };
  const kid = (pub, id) => Object.assign(plain(R.create(pub, { id, by: 'a', session: 'w', now: AT, details: inputs, parent: { process: 'backup', id: r.id, step: 'verify', inputs, folder: r.folder } })), { ended: { outcome: 'Completed', by: 'a', at: AT } });
  const odd = kid(twin, 'twin1'), ok = kid(good, 'good1');
  assert.ok(!('typesHash' in odd) && odd.folder === pin.folder && odd.mapHash === pin.mapHash, 'set-up: a run/2 child with the same folder and checklist');
  assert.strictEqual(PF.pins.childMatch(pin, ok, procOf), '');
  assert.ok(/step types/.test(PF.pins.childMatch(pin, odd, procOf)), PF.pins.childMatch(pin, odd, procOf));
  assert.throws(() => R.linkChild(plain(r), map, 'verify', { process: 'verify', id: 'twin1', inputs, folder: odd.folder, mapHash: odd.mapHash }, 'a', AT, { run: odd, procOf }), /step types/);
  const hand = plain(r); hand.steps.verify = { s: 'open', child: { process: 'verify', id: 'twin1', inputs, folder: pin.folder } };
  assert.strictEqual(R.childVerdict(hand, step, hand.steps.verify, odd, procOf), null);
  assert.throws(() => R.settleChild(hand, map, 'verify', odd, 'a', AT, procOf), /pinned/);
  // Missing or unverifiable: never a match.
  const noTypes = plain(ok); delete noTypes.types;
  assert.ok(PF.pins.childMatch(pin, noTypes, procOf), 'a run/2 child without its types can\'t be checked');
  assert.ok(PF.pins.childMatch(pin, ok, () => null), 'its checklist isn\'t published here');
  assert.ok(PF.pins.childMatch(pin, ok, null), 'no versions to check against');
  assert.ok(PF.pins.childMatch(pin, null, procOf), 'no child run');
  const gone = proc([childProc(['A'])[0]]);
  assert.ok(PF.pins.childMatch(pin, ok, () => gone), 'another folder with that number');
});

rule('Linking an orphan to a run/3 step with no pin yet pins the step to the orphan\'s verified publication, and refuses, with why, when that publication can\'t be verified', () => {
  const kids = childProc(['A', 'B']), parent = linked(kids, []), inputs = { ticket: 'ABC-1' };
  // The child process wasn't published when the parent started: no pin for the step.
  const start = () => plain(R.create(parent, { by: 'person-avery', session: 'w', now: AT, app: '2.0.0', details: inputs, explicit: true, pins: PF.pins.atStart(parent.map, null, () => null) }));
  assert.strictEqual(start().format, 'preflight-run/3', 'set-up: a run/3');
  const r = start(), map = R.mapOf(r);
  assert.ok(!(r.pins && r.pins.children && r.pins.children.verify), 'set-up: no pin yet');
  const kid = (pub, id) => plain(R.create(pub, { id, by: 'a', session: 'w', now: AT, details: inputs, parent: { process: 'backup', id: r.id, step: 'verify', inputs, folder: r.folder } }));
  const v1 = kid(kids[0], 'kid1'), procs = { verify: proc(kids) }, procOf = (id) => procs[id] || null;
  const linkOf = (c) => ({ process: c.process, id: c.id, inputs, folder: c.folder, format: c.format });
  // Link it, with no pin passed: the pin comes from the orphan's version, as the folder holds it.
  R.linkChild(r, map, 'verify', linkOf(v1), 'person-avery', AT, { run: v1, procOf, findRun: () => null });
  assert.deepStrictEqual(plain(r.pins.children.verify), plain(PF.pins.of(kids[0], 'verify')), 'pinned to v1, the orphan\'s version');
  assert.ok(r.features.indexOf('pinned-children') >= 0);
  // The next child goes to the pin, not the latest.
  assert.strictEqual(PF.pins.childTarget(r, M.findStep(map, 'verify').step, procOf).pub.info.folder, kids[0].info.folder);
  // Can't be verified: refused with why, and nothing linked or pinned.
  const refuse = (c, o, re) => { const x = start(); assert.throws(() => R.linkChild(x, map, 'verify', linkOf(c), 'person-avery', AT, o), re); assert.ok(!(x.steps.verify && x.steps.verify.child) && !(x.pins && x.pins.children && x.pins.children.verify), 'nothing linked or pinned'); };
  refuse(v1, { run: v1, procOf: () => null, findRun: () => null }, /isn't published|can't be (checked|verified)/);
  refuse(v1, { run: v1, findRun: () => null }, /can't be (checked|verified)|aren't known/);
  refuse(v1, undefined, /can't be (checked|verified)|isn't visible|aren't known/);
  const clash = proc([kids[0], childProc(['A'])[0], kids[1]]);
  refuse(v1, { run: v1, procOf: () => clash, findRun: () => null }, /two versions are numbered/);
  refuse(Object.assign(plain(v1), { mapHash: 'ffffffff' }), { run: Object.assign(plain(v1), { mapHash: 'ffffffff' }), procOf, findRun: () => null }, /checklist/);
});

rule('A process whose versions can\'t be listed is unreadable, never unpublished: pinning a step, finding a pin and registering a skill against it refuse with the listing\'s reason', async () => {
  const locked = { list: (p) => p === 'publications/verify' ? Promise.reject(Object.assign(new Error('permission denied'), { code: 'EACCES' })) : Promise.resolve([]), read: () => Promise.resolve(null) };
  const proc = await PF.repo.readProcess(locked, 'verify');
  assert.ok(proc, 'a state, not null');
  const why = (x) => x && x.why || '';
  assert.ok(/couldn't be listed/.test(why(PF.pins.find(proc, { process: 'verify', folder: 'v1-abcd1234' }))), why(PF.pins.find(proc, { process: 'verify', folder: 'v1-abcd1234' })));
  assert.ok(/couldn't be listed/.test(why(PF.pins.atVersion(proc, 'verify', 1))), why(PF.pins.atVersion(proc, 'verify', 1)));
  const g = PF.skills.registration({ name: 'x', version: '1', location: 'here', implements: { process: 'verify', folder: 'v1-abcd1234' } }, proc, null, { app: '2.0.0', now: AT, by: 'a', window: 'w', rand: 'abcdefgh' });
  assert.ok(!g.rec && /couldn't be listed/.test(g.why), JSON.stringify(g));
  assert.strictEqual(await PF.repo.readProcess({ list: () => Promise.resolve([]) }, 'verify'), null, 'a process with no versions is still not published');
});

rule('A process ID an object inherits (constructor) is an ordinary ID, and state names it inherits are never states: pins, the next child, the pin lookups and a run\'s history never read them from the prototype', () => {
  // Step IDs are lowercase (toString is read as tostring), so constructor is the only inherited name one could be, and every
  // copy's checklist check already refuses it; __proto__ isn't an ID at all.
  assert.deepStrictEqual(['toString', 'valueOf', 'hasOwnProperty'].map(id => M.findStep(M.parse(CHILD().replace('{#look}', '{#' + id + '}')), id.toLowerCase()) ? id.toLowerCase() : null), ['tostring', 'valueof', 'hasownproperty']);
  assert.ok(M.check(M.parse(CHILD().replace('{#look}', '{#constructor}')), {}).blockers.length, 'constructor is refused as a step ID');
  const kid = publish(CHILD().replace('process: verify', 'process: constructor'));
  assert.ok(!kid.blockers, 'constructor is a process ID: ' + JSON.stringify(kid.blockers));
  const md = ['---', 'process: backup', 'title: Backup check', 'context: ticket', '---', '', '## Prepare {#prep}',
    '- [ ] {run.process} Pinned at publish {#first}', '  process: constructor', '  version: 1',
    '- [ ] {run.process} Not pinned {#later}', '  process: constructor',
    '- [ ] {confirm} Look {#look}', ''].join('\n');
  const procs = Object.create(null); procs.constructor = proc([kid]);
  const procOf = (id) => Object.prototype.hasOwnProperty.call(procs, id) ? procs[id] : null;
  const parent = publish(md, { childProcs: { constructor: procs.constructor } });
  assert.ok(!parent.blockers, JSON.stringify(parent.blockers));
  assert.deepStrictEqual(Object.keys(parent.info.payload.pins.children), ['first']);
  const r = plain(R.create(parent, { by: 'a', session: 'w', now: AT, app: '2.0.0', details: { ticket: 'T-1' }, pins: PF.pins.atStart(parent.map, parent.info.payload.pins, () => null) }));
  assert.deepStrictEqual(Object.keys(r.pins.children), ['first']);
  const map = R.mapOf(r), step = (id) => M.findStep(map, id).step;
  const t = PF.pins.childTarget(r, step('later'), procOf);
  assert.ok(t.first && t.pin && t.pin.folder === kid.info.folder, 'no pin yet: the latest now, first: ' + JSON.stringify(t.why || t.pin));
  assert.strictEqual(PF.pins.childTarget(r, step('first'), procOf).pin.folder, kid.info.folder);
  // A process lookup through a plain object never finds the prototype's constructor.
  assert.ok(/isn't published/.test(PF.pins.childTarget(r, step('later'), (id) => ({})[id] || null).why || ''), 'never the prototype\'s constructor');
  // pins.children itself: a step whose ID an object inherits has no pin unless it's its own.
  const hand = plain(r); hand.pins.children = JSON.parse('{"first":' + JSON.stringify(r.pins.children.first) + '}');
  assert.strictEqual(R.childPinProblem(hand, 'constructor', {}, procOf), '', 'no own pin, no pin problem');
  // A state named like an inherited property is never a state.
  r.steps.look = { s: 'done', by: 'a', at: AT, history: [{ s: 'constructor', by: 'a', at: AT }, { s: 'open', by: 'a', at: AT }] };
  const back = R.sanitize(plain(r));
  assert.strictEqual(back.steps.look.s, 'done');
  assert.deepStrictEqual(plain(back.steps.look.history).map(h => h.s), ['open'], 'an inherited name isn\'t a state');
  const odd = plain(r); odd.steps.look = { s: 'valueOf', by: 'a', at: AT };
  assert.ok(!R.sanitize(odd).steps.look, 'a step whose state is an inherited name is dropped');
  const g = plain(r), gid = Object.keys(R.mapOf(r).phases.reduce((o, p) => (p.gate && p.gate.id ? (o[p.gate.id] = 1, o) : o), {}))[0];
  if (gid) { g.gates[gid] = { s: 'toString', by: 'a', at: AT }; assert.ok(!R.sanitize(g).gates[gid] || R.sanitize(g).gates[gid].s !== 'toString', 'nor a gate state'); }
});

rule('Rechecking a {run.skill} step keeps the registration it observed in the step\'s history, through sanitize and the archive', () => {
  const kids = childProc(['A']), md = PARENT(['  version: 1']).replace('Write the report {#report}', 'Write the report for ^ticket {#report}');
  const parent = publish(md, { childProcs: { verify: proc(kids) } });
  const r = R.create(parent, { by: 'person-avery', session: 'w', now: AT, app: '2.0.0', details: { ticket: 'ABC-1' }, pins: {} }), map = R.mapOf(r);
  assert.deepStrictEqual(plain(M.findStep(map, 'report').step.binds), ['ticket'], 'set-up: the step binds ticket');
  const regAt = (rev) => ({ id: 'sk-aaaa1111', rev, sha: rev.toString(16).repeat(64), name: 'release-notes', version: '1.' + rev + '.0', location: 'https://example.com/x', implements: { process: 'backup', folder: parent.info.folder, mapHash: parent.info.mapHash, typesHash: parent.info.typesHash } });
  R.done(r, map, 'read', 'person-avery', AT); R.na(r, map, 'verify', 'person-avery', AT);
  r.gates[map.phases[0].gate.id] = { s: 'passed', by: 'a', at: AT, approved: {} };
  R.done(r, map, 'report', 'person-avery', AT, { _skill: PF.skills.observed(regAt(1)) });
  R.setDetail(r, map, 'ticket', 'ABC-2', 'person-avery', AT);
  assert.strictEqual(r.steps.report.s, 'recheck');
  R.done(r, map, 'report', 'person-avery', AT, { _skill: PF.skills.observed(regAt(2)) });
  assert.strictEqual(r.steps.report.skill.rev, 2);
  const one = (r.steps.report.history || []).filter(h => h.skill && h.skill.rev === 1);
  assert.strictEqual(one.length, 1, 'revision 1 is in the history: ' + JSON.stringify(r.steps.report.history));
  assert.deepStrictEqual([one[0].skill.sha, one[0].skill.snapshot.version], ['1'.repeat(64), '1.1.0']);
  const back = R.sanitize(plain(r));
  assert.ok(!back._unrunnable, back._unrunnable);
  assert.deepStrictEqual(plain(back.steps.report.history), plain(r.steps.report.history), 'sanitize keeps it');
  assert.deepStrictEqual(plain(R.unexplained(plain(r))), [], 'read back exactly');
  // Enough rechecks push revision 1 out of run.json, into the archive, kept whole.
  for (let rev = 3; rev <= 9; rev++) { R.setDetail(r, map, 'ticket', 'T-' + rev, 'person-avery', AT); R.done(r, map, 'report', 'person-avery', AT, { _skill: PF.skills.observed(regAt(rev)) }); }
  const arch = (r._overflow || []).filter(x => x.kind === 'answer' && x.step === 'report' && x.skill && x.skill.rev === 1);
  assert.strictEqual(arch.length, 1, 'archived with its skill: ' + JSON.stringify(r._overflow));
  assert.ok(R.cleanArchive(plain(arch[0])).ok);
  assert.strictEqual(arch[0].skill.sha, '1'.repeat(64));
  // A history entry with a skill this copy can't read is refused, never kept half.
  const odd = plain(r); odd.steps.report.history[0].skill = { id: 'nope' };
  assert.ok(R.sanitize(odd)._unrunnable, 'refused');
  // A run/2's history is unchanged: no skill there.
  const r2 = R.create(publish(PARENT().replace('Write the report {#report}', 'Write the report for ^ticket {#report}')), { by: 'a', session: 'w', now: AT, details: { ticket: 'A' } }), m2 = R.mapOf(r2);
  R.done(r2, m2, 'read', 'a', AT); R.na(r2, m2, 'verify', 'a', AT); r2.gates[m2.phases[0].gate.id] = { s: 'passed', by: 'a', at: AT, approved: {} };
  R.done(r2, m2, 'report', 'a', AT, { _skill: PF.skills.observed(regAt(1)) }); R.setDetail(r2, m2, 'ticket', 'B', 'a', AT);
  assert.ok(!(r2.steps.report.history || []).some(h => 'skill' in h));
});

rule('A registration with any revision this copy can\'t read (newer, malformed or unreadable) can\'t be matched until it\'s resolved; a lower revision is never current past it', () => {
  const cv = (x) => SK.checkV2(JSON.parse(x.text), x.file, x.sha), one = reg();
  const named = (list, n) => list.filter(x => (x.skill && x.skill.name === n) || (x.file || '').indexOf('skill-registrations/' + n + '/') === 0);
  const held = (list, n, re) => {
    const l = named(list, n);
    assert.ok(l.length >= 1, JSON.stringify(plain(list)));
    assert.ok(l.every(x => x.unmatched), 'every entry for ' + n + ' can\'t be matched: ' + JSON.stringify(plain(l)));
    assert.ok(l.some(x => re.test(x.errors.join(' '))), JSON.stringify(plain(l)));
  };
  const newer = reg({ rev: 2, seen: 1, format: 'flightdeck-skill/3' });
  held(SK.merge([], [cv(one), cv(newer)]), 'release-notes', /newer Flightdeck/);
  const bad = reg({ rev: 2, seen: 1, implements: 'backup@2' });
  held(SK.merge([], [cv(one), cv(bad)]), 'release-notes', /implements/);
  const unreadable = { skill: null, errors: ['skill-registrations/release-notes/sk-aaaa1111.2.w-other.json: isn\'t valid JSON'], file: 'skill-registrations/release-notes/sk-aaaa1111.2.w-other.json' };
  held(SK.merge([], [cv(one), unreadable]), 'release-notes', /isn't valid JSON/);
  const odd = { skill: null, errors: ['skill-registrations/release-notes/notes.json: its file name isn\'t right'], file: 'skill-registrations/release-notes/notes.json' };
  held(SK.merge([], [cv(one), odd]), 'release-notes', /file name/);
  // With a tombstone too: still not matched.
  const tomb = Object.assign(SK.check({ name: 'release-notes', implements: 'moved', movedTo: 'skill-registrations/release-notes/', id: 'sk-aaaa1111' }, 'release-notes.json'), { file: 'release-notes.json' });
  held(SK.merge([tomb], [cv(one), cv(newer)]), 'release-notes', /newer Flightdeck/);
  // Another skill's registrations are unaffected.
  const other = reg({ name: 'other-skill', id: 'sk-bbbb2222' }), list = SK.merge([], [cv(one), cv(newer), cv(other)]);
  assert.ok(named(list, 'other-skill').length === 1 && !named(list, 'other-skill')[0].unmatched);
});

rule('Slice 2 part 2 registers pinned-children and pinned-skills (checklist/2, publication/2, run/3), plan/2 and its status, and skill/2; slice 3 adds typed data; 2.1 adds conditions and staged versions; every later feature stays refused', () => {
  const want = ['phase-notes', 'phase-shots', 'gate-shots', 'pinned-children', 'pinned-skills', 'typed-details', 'typed-evidence', 'conditions'];
  assert.deepStrictEqual(plain(E.FAMILIES['flightdeck-checklist'].majors[2]), want);
  assert.deepStrictEqual(plain(E.FAMILIES['preflight-publication'].majors[2]), want.concat(['staged']));
  assert.deepStrictEqual(plain(E.FAMILIES['preflight-run'].majors[3]), want);
  assert.ok(E.judge('flightdeck-plan', { format: 'flightdeck-plan/2' }).ok);
  assert.ok(E.judge('flightdeck-plan-status', { format: 'flightdeck-plan-status/2' }).ok);
  assert.ok(E.judge('flightdeck-skill', { format: 'flightdeck-skill/2' }).ok);
  assert.ok(!E.judge('preflight-run', { format: 'preflight-run/3', features: ['staged'] }).ok);
  ['test-run', 'extensions'].forEach(x => {
    assert.ok(!E.judge('preflight-publication', { format: 'preflight-publication/2', features: [x] }).ok, x);
    assert.ok(!E.judge('preflight-run', { format: 'preflight-run/3', features: [x] }).ok, x);
  });
  assert.ok(!E.judge('flightdeck-plan', { format: 'flightdeck-plan/3' }).ok);
});

run();
