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
  R.linkChild(r, R.mapOf(r), 'verify', { process: 'verify', id: 'kid1', inputs: { ticket: 'ABC-1' }, folder: t.pub.info.folder, format: 'preflight-run/2' }, 'person-avery', AT);
  assert.strictEqual(r.steps.verify.child.folder, kids[0].info.folder);
  const back = R.sanitize(plain(r));
  assert.ok(!back._unrunnable, back._unrunnable); assert.strictEqual(back.steps.verify.child.folder, kids[0].info.folder);
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
  assert.ok(list.every(x => x.unmatched && /Two registrations for release-notes; keep one/.test(x.errors.join(' '))) && list.length === 2, JSON.stringify(plain(list)));
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
rule('Slice 2 part 2 registers pinned-children and pinned-skills (checklist/2, publication/2, run/3), plan/2 and its status, and skill/2; every later feature stays refused', () => {
  const want = ['phase-notes', 'phase-shots', 'gate-shots', 'pinned-children', 'pinned-skills'];
  ['flightdeck-checklist', 'preflight-publication'].forEach(f => assert.deepStrictEqual(plain(E.FAMILIES[f].majors[2]), want, f));
  assert.deepStrictEqual(plain(E.FAMILIES['preflight-run'].majors[3]), want);
  assert.ok(E.judge('flightdeck-plan', { format: 'flightdeck-plan/2' }).ok);
  assert.ok(E.judge('flightdeck-plan-status', { format: 'flightdeck-plan-status/2' }).ok);
  assert.ok(E.judge('flightdeck-skill', { format: 'flightdeck-skill/2' }).ok);
  ['typed-details', 'typed-evidence', 'staged', 'test-run', 'extensions'].forEach(x => {
    assert.ok(!E.judge('preflight-publication', { format: 'preflight-publication/2', features: [x] }).ok, x);
    assert.ok(!E.judge('preflight-run', { format: 'preflight-run/3', features: [x] }).ok, x);
  });
  assert.ok(!E.judge('flightdeck-plan', { format: 'flightdeck-plan/3' }).ok);
});

run();
