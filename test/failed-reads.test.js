// 2.1.0, found before release: a file that can't be read is never taken as absent, and a save never trusts a 32-bit
// fingerprint to say a file didn't change. A sign-off or plan decision that's still arriving is named in Folder health and
// leaves "was it signed off / started?" unanswered; a run, people.json or a step type saved over a file that changed is
// refused, however the two texts' FNV fingerprints compare; and a misplaced copy of a test run is labeled as one.
'use strict';
const assert = require('assert');
const { completeRun, load, example, exampleSetup, rule, run } = require('./harness');
const { BytesFS, build: evidenceFolder } = require('./evidence-fixture');
const PF = load(), R = PF.run, S = PF.skills, M = PF.map, U = PF.util, repo = PF.repo;
const EX = exampleSetup(PF);
const NOW = '2026-10-22T09:00:00.000Z';
const people = JSON.parse(example('people.json'));
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

function folder() {
  const fs = new PF.fs.MemoryFS('test:' + Math.random(), null);
  fs.reset({ 'people.json': JSON.stringify(people) });
  return fs;
}
const put = (fs, path, text) => { fs.files[path] = { t: text, m: Date.now() }; };
async function publish(fs) {
  const res = await repo.publish(fs, example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First version', existing: [], now: NOW });
  assert.ok(!res.blockers, String(res.blockers));
  return (await repo.loadAll(fs)).processes[0].index.latest;
}
async function cleanRun(fs, pub, id) {
  const r = completeRun(PF, R.create(pub, { title: 'Release ' + id, details: { commit: 'aaa111', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'w1', now: NOW, id }), NOW);
  await repo.saveRun(fs, r, 'w1');
  return r;
}
const sign = (pub, by) => ({ kind: 'validation', process: pub.map.meta.process, version: pub.info.version, folder: pub.info.folder, by, at: NOW, note: '' });
const health = (d) => PF.health.check({ data: d, scan: null, me: 'person-casey', app: '2.1.0' }, Date.parse(NOW));
const named = (rep, path) => rep.issues.some(i => (i.paths || []).indexOf(path) >= 0 || (i.detail || '').indexOf(path) >= 0);

/* FNV-1a 32 run from a given state, so two same-length strings that collide after a shared prefix are found by birthday search. */
function fnvFrom(h, s) { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
function collide(prefix, len) {
  const start = fnvFrom(0x811c9dc5, prefix), seen = new Map(), abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let n = 0;
  for (;;) {
    let s = ''; let k = n++;
    for (let i = 0; i < len; i++) { s += abc[k % 36]; k = Math.floor(k / 36); }
    const h = fnvFrom(start, s), was = seen.get(h);
    if (was !== undefined && was !== s) return [was, s];
    seen.set(h, s);
  }
}
/* Two texts, each the original with one span replaced, that share an FNV-1a fingerprint. */
function collidingTexts(text, at, oldLen, len) {
  const [a, b] = collide(text.slice(0, at), len), rest = text.slice(at + oldLen);
  const ta = text.slice(0, at) + a + rest, tb = text.slice(0, at) + b + rest;
  assert.strictEqual(U.hash(ta), U.hash(tb), 'set-up: a collision');
  assert.notStrictEqual(ta, tb);
  return [ta, tb];
}

/* ---------- 1. A sign-off file that can't be read is named, and leaves readiness unanswered ---------- */

rule('A sign-off that isn\'t complete JSON is named in valUnread and in Folder health, never dropped', async () => {
  const fs = folder(), pub = await publish(fs);
  put(fs, 'validations/release.v1.w-other.json', '{"kind": "validation", "process": "rel');
  const d = await repo.loadAll(fs);
  same(d.validations, []);
  assert.ok((d.valUnread || []).some(u => u._file === 'release.v1.w-other.json' && /complete JSON/.test(u.why)), JSON.stringify(d.valUnread));
  assert.ok(named(health(d), 'validations/release.v1.w-other.json'), JSON.stringify(health(d).issues.map(i => i.id + ': ' + i.detail)));
  assert.ok(/release\.v1\.w-other\.json couldn't be read/.test(S.signUnknown(d, pub)), S.signUnknown(d, pub));
});

rule('A sign-off that reads as JSON but isn\'t one this copy can read is named too; a newer one stays refused, not unread', async () => {
  const fs = folder(), pub = await publish(fs);
  put(fs, 'validations/release.v1.w-odd.json', JSON.stringify({ kind: 'validation', process: 'release' }));
  put(fs, 'validations/release.v1.w-new.json', JSON.stringify({ format: 'flightdeck-validation/3', app: '2.2.0', process: 'release' }));
  const d = await repo.loadAll(fs);
  same((d.valUnread || []).map(u => u._file), ['release.v1.w-odd.json']);
  assert.ok(d.refused.some(x => x.path === 'validations/release.v1.w-new.json'), 'the newer one is refused by name');
  assert.ok(S.signUnknown(d, pub), 'can\'t tell');
});

rule('Which unreadable sign-offs leave a version unanswered: its own and odd names, never another version\'s or process\'s', async () => {
  const fs = folder(), pub = await publish(fs);
  const torn = '{"kind": "valid';
  put(fs, 'validations/release.v2.w-a.json', torn);
  put(fs, 'validations/hotfix.v1.w-a.json', torn);
  put(fs, 'validations/release.stage-abcd1234.w-a.json', torn);
  let d = await repo.loadAll(fs);
  assert.strictEqual(d.valUnread.length, 3);
  assert.strictEqual(S.signUnknown(d, pub), '', 'none of them can be v1\'s');
  put(fs, 'validations/copy of sign-off.json', torn);
  d = await repo.loadAll(fs);
  assert.ok(/copy of sign-off\.json/.test(S.signUnknown(d, pub)), 'a file not named by Flightdeck could be anyone\'s');
  // A sign-off that is there and reads still answers yes: one that can't be read changes nothing then.
  put(fs, 'validations/release.v1.w-own.json', JSON.stringify(sign(pub, pub.map.meta.owner)));
  d = await repo.loadAll(fs);
  assert.strictEqual(S.signoffs(d.validations, pub).length, 1);
});

rule('Sign-offs that couldn\'t be listed or read at all leave readiness unanswered too', async () => {
  const fs = folder(), pub = await publish(fs);
  put(fs, 'validations/release.v1.w-own.json', JSON.stringify(sign(pub, pub.map.meta.owner)));
  const orig = fs.list.bind(fs);
  fs.list = (p) => p === 'validations' ? Promise.reject(new Error('offline')) : orig(p);
  const d = await repo.loadAll(fs);
  assert.ok('sign-offs' in d.failed);
  assert.ok(/validations\/ couldn't be read/.test(S.signUnknown(d, pub)), S.signUnknown(d, pub));
});

rule('Readiness says it can\'t tell, names the file, and offers no sign-off, while a sign-off for the version can\'t be read', async () => {
  const PFV = load(true), V = PFV.views, fs = folder(), pub = await publish(fs);
  for (const id of ['run1', 'run2', 'run3']) await cleanRun(fs, pub, id);
  put(fs, 'validations/release.v1.w-other.json', '{"kind": "valid');
  const d = await PFV.repo.loadAll(fs);
  const p = { id: 'release', title: 'Release', latest: d.processes[0].index.latest, all: [d.processes[0].index.latest], skills: [], draft: null };
  const ctx = { data: d, state: { me: pub.map.meta.owner || 'person-casey', disc: {} }, processes: () => [p], countedRuns: () => d.runs };
  const html = V.readyPanel(ctx, p, p.latest);
  assert.ok(/Can(&#39;|')t tell yet/.test(html) && /validations\/release\.v1\.w-other\.json/.test(html), html);
  assert.ok(!/data-kind="signoff"/.test(html) && !/data-act="signoff"/.test(html), 'no sign-off offered');
});

/* ---------- 1b. Plan decisions: one that can't be read leaves the plan unstartable ---------- */

rule('A plan decision that can\'t be read is named and holds its plan: it isn\'t known whether it was started', async () => {
  const fs = folder(), plan = JSON.parse(example('proposals/plan-release-2026-10-24.json'));
  put(fs, 'proposals/plan-release-2026-10-24.json', JSON.stringify(plan));
  put(fs, 'proposals/plan-release-2026-10-24.status-w-other.json', '{"kind": "status", "propos');
  const d = await repo.loadAll(fs);
  const p = d.plans.filter(x => x.id === 'plan-release-2026-10-24')[0];
  assert.ok(p, 'the plan is there');
  same(p._statusUnread, ['proposals/plan-release-2026-10-24.status-w-other.json']);
  assert.ok((d.planUnread || []).some(u => u.path === 'proposals/plan-release-2026-10-24.status-w-other.json'));
  assert.ok(named(health(d), 'proposals/plan-release-2026-10-24.status-w-other.json'), JSON.stringify(health(d).issues.map(i => i.detail)));
});

/* ---------- 2. Saves compare the exact text (or SHA-256), never a 32-bit FNV ---------- */

rule('A run saved over a run.json that changed is kept as a conflict copy, even when the two texts share an FNV fingerprint', async () => {
  const fs = folder(), pub = await publish(fs);
  await cleanRun(fs, pub, 'run1');
  const path = 'runs/release/run1/run.json', text = fs.files[path].t, key = '"title": "', at = text.indexOf(key) + key.length;
  const oldLen = text.indexOf('"', at) - at, [mine, theirs] = collidingTexts(text, at, oldLen, 6);
  put(fs, path, mine);
  const r = (await repo.loadAll(fs)).runs.filter(x => x.id === 'run1')[0];
  assert.ok(r && /^[0-9a-f]{64}$/.test(r._fileHash), 'a SHA-256 fingerprint: ' + (r && r._fileHash));
  assert.strictEqual(r._fileHash, repo.fileHash(mine));
  put(fs, path, theirs);
  r.details.commit = 'bbb222';
  let err = null;
  await repo.saveRun(fs, r, 'w1').catch(e => { err = e; });
  assert.ok(err && err.keptAs, 'kept as a conflict copy: ' + (err && err.message));
  assert.strictEqual(fs.files[path].t, theirs, 'their run.json is untouched');
  assert.ok(JSON.parse(fs.files[err.keptAs].t).details.commit === 'bbb222', 'this window\'s change is in the copy');
});

rule('A run fingerprint from before 2.1 (8 hex characters, kept in this browser) is never taken as a match: the save keeps a copy', async () => {
  const fs = folder(), pub = await publish(fs), r = await cleanRun(fs, pub, 'run1'), path = 'runs/release/run1/run.json', was = fs.files[path].t;
  r._fileHash = U.hash(was);
  r.details.commit = 'ccc333';
  let err = null;
  await repo.saveRun(fs, r, 'w1').catch(e => { err = e; });
  assert.ok(err && err.keptAs, 'a conflict copy, nothing written over');
  assert.strictEqual(fs.files[path].t, was);
});

rule('people.json is saved only over the exact text read: a save without it is refused, and an FNV collision is a conflict', async () => {
  const fs = folder(), text = JSON.stringify(people, null, 2) + '\n', at = text.indexOf('"name": "') + 9, oldLen = text.indexOf('"', at) - at;
  const [a, b] = collidingTexts(text, at, oldLen, 6);
  put(fs, 'people.json', b);
  await assert.rejects(() => repo.savePeople(fs, 'x', U.hash(a)), /exact text/);
  const res = await repo.savePeople(fs, text, U.hash(a), { expectText: a });
  assert.ok(res.conflict && !res.afterWrite && res.theirs === b, JSON.stringify(res));
  assert.strictEqual(fs.files['people.json'].t, b);
  const d = await repo.loadAll(fs);
  assert.strictEqual(d.people.text, b, 'the text read comes with the list');
  const ok = await repo.savePeople(fs, text, d.people.hash, { expectText: d.people.text });
  assert.ok(ok.ok && fs.files['people.json'].t === text);
});

rule('A step type is saved only over the exact text read: a save without it is refused, and an FNV collision is a conflict', async () => {
  const fs = folder(), def = JSON.parse(example('step-types/' + require('fs').readdirSync(require('path').join(__dirname, '..', 'example-folder', 'step-types'))[0]));
  const text = JSON.stringify(def, null, 2) + '\n', key = '"label": "', at = text.indexOf(key) + key.length, oldLen = text.indexOf('"', at) - at;
  const [a, b] = collidingTexts(text, at, oldLen, 6), path = 'step-types/' + def.id + '.json';
  put(fs, path, b);
  await assert.rejects(() => repo.saveStepType(fs, def, U.hash(a)), /exact text/);
  const res = await repo.saveStepType(fs, def, U.hash(a), { expectText: a });
  assert.ok(res.conflict && res.theirs === b, JSON.stringify(res));
  assert.strictEqual(fs.files[path].t, b);
  const ok = await repo.saveStepType(fs, def, U.hash(b), { expectText: b });
  assert.ok(ok.ok && ok.text === text, 'saved, and the text written comes back');
});

/* ---------- 4. A misplaced copy of a test run is labeled as one in an evidence pack ---------- */

rule('Evidence: a test run\'s run.json in another run\'s folder is labeled Test run, never "version N" alone', async () => {
  const fx = await evidenceFolder(load()), files = Object.assign({}, fx.files);
  const o = JSON.parse(files['runs/release/run1/run.json'].toString('utf8'));
  o.test = true; o.folder = 'stage-abcd1234'; o.version = 3;
  Object.keys(files).filter(k => k.indexOf('runs/release/run1/') === 0).forEach(k => { files['runs/release/run8/' + k.slice('runs/release/run1/'.length)] = files[k]; });
  files['runs/release/run8/run.json'] = Buffer.from(JSON.stringify(o));
  const res = await repo.exportEvidence(new BytesFS(files), { run: 'release/run8' }, { sink: () => {}, now: () => Date.parse(NOW), tz: 'UTC' });
  const rc = res.col.runs[0];
  assert.strictEqual(rc.run, null, 'still not read as release/run8');
  const html = PF.evidence.page(res.col), head = html.slice(html.indexOf('<h2>Run:'), html.indexOf('<h3>'));
  assert.ok(/<b>Test run<\/b>/.test(head) && /staged version 3/.test(head) && !/ · version 3/.test(head), head);
});

run();
