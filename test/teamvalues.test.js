// Team values (2.9): team-values.json, read and checked by PF.teamValues, and looked up by a pass: line's team: source.
'use strict';
const assert = require('assert');
const { load, rule, run, example, exampleSetup } = require('./harness');
const PF = load(), T = PF.teamValues, E = PF.envelope;
const same = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const doc = (values) => JSON.stringify({ format: 'flightdeck-team-values/1', values });
const BASE = { 'bitbucket-base-url': { value: 'https://bitbucket.example.com/projects/PAY', about: 'Bitbucket base URL' } };

rule('parse: a good file reads as ok with its values', () => {
  const r = T.parse(doc(BASE));
  assert.strictEqual(r.state, 'ok', r.why);
  same(r.doc.values, BASE);
});

rule('parse: no file is missing (no team values), never an error', () => {
  same(T.parse(null).state, 'missing');
  same(T.lookup(T.parse(null), 'bitbucket-base-url'), { missing: true });
});

rule('parse: bad JSON, the wrong shape, bad names, values and limits are malformed with a reason', () => {
  const bad = {
    '{': /isn't valid JSON/,
    '[]': /isn't a JSON object/,
    [JSON.stringify({ values: {} })]: /has no format/,
    [JSON.stringify({ format: 'flightdeck-team-values/1' })]: /values/,
    [JSON.stringify({ format: 'flightdeck-team-values/1', values: [] })]: /values/,
    [doc({ 'Bad Name': { value: 'x' } })]: /"Bad Name" isn't a team value name/,
    [doc({ ['a'.repeat(41)]: { value: 'x' } })]: /isn't a team value name/,
    [doc({ x: { value: 'a'.repeat(121) } })]: /at most 120 characters/,
    [doc({ x: { value: 'a\u0007b' } })]: /control character/,
    [doc({ x: { value: ' padded ' } })]: /spaces at the start or end/,
    [doc({ x: { value: '' } })]: /is empty/,
    [doc({ x: { value: 3 } })]: /isn't text/,
    [doc({ x: { value: 'v', about: 'a'.repeat(81) } })]: /at most 80 characters/,
    [doc({ x: { value: 'v', color: 'red' } })]: /"color"/,
    [doc({ __proto__: null, constructor: { value: 'v' } })]: /keeps for itself/
  };
  Object.keys(bad).forEach(t => { const r = T.parse(t); assert.strictEqual(r.state, 'malformed', t); assert.ok(bad[t].test(r.why), t + ': ' + r.why); });
  const many = {}; for (let i = 0; i < 101; i++) many['v' + i] = { value: 'x' };
  const r = T.parse(doc(many)); assert.strictEqual(r.state, 'malformed'); assert.ok(/at most 100/.test(r.why), r.why);
});

rule('parse: an unknown top-level key is read but read-only, with the reason', () => {
  const r = T.parse(JSON.stringify({ format: 'flightdeck-team-values/1', values: BASE, extra: 1 }));
  assert.strictEqual(r.state, 'ok');
  assert.ok(r.readOnly && /"extra"/.test(r.readOnly), r.readOnly);
  same(T.lookup(r, 'bitbucket-base-url'), { value: BASE['bitbucket-base-url'].value });
});

rule('parse: a newer format or feature is newer, naming what it needs', () => {
  const r = T.parse(JSON.stringify({ format: 'flightdeck-team-values/2', values: {} }));
  assert.strictEqual(r.state, 'newer'); assert.ok(/newer Flightdeck/.test(r.why), r.why);
  const f = T.parse(JSON.stringify({ format: 'flightdeck-team-values/1', features: ['secrets'], values: {} }));
  assert.strictEqual(f.state, 'newer');
});

rule('lookup: each result, by name', () => {
  const ok = T.parse(doc(BASE));
  same(T.lookup(ok, 'bitbucket-base-url'), { value: 'https://bitbucket.example.com/projects/PAY' });
  same(T.lookup(ok, 'nope'), { missing: true });
  same(T.lookup(ok, 'constructor'), { missing: true });
  same(T.lookup(T.parse('{'), 'x').malformed, true);
  same(T.lookup({ state: 'unreadable', why: 'locked' }, 'x'), { unreadable: true, why: 'locked' });
  same(T.lookup(T.parse(JSON.stringify({ format: 'flightdeck-team-values/9', values: {} })), 'x').newer, true);
});

rule('text: writes the file back in a stable shape that reads the same; check refuses what parse would', () => {
  const t = T.text({ values: BASE });
  assert.strictEqual(T.parse(t).state, 'ok');
  same(T.parse(t).doc.values, BASE);
  assert.strictEqual(t, T.text(T.parse(t).doc), 'stable');
  assert.ok(/^\{\n  "format": "flightdeck-team-values\/1",/.test(t), t);
  assert.ok(T.check({ values: { 'Bad': { value: 'x' } } }), 'check names the problem');
  assert.strictEqual(T.check({ values: BASE }), '');
});

rule('the largest file F1 allows (100 values at every limit, 4-byte characters) fits under TEAM_MAX', () => {
  const values = {};
  for (let i = 0; i < 100; i++) values[('v' + i + '-' + 'x'.repeat(40)).slice(0, 40)] = { value: '\u{1F600}'.repeat(60), about: '\u{1F600}'.repeat(40) };
  const t = T.text({ values });
  assert.strictEqual(T.parse(t).state, 'ok', T.parse(t).why);
  assert.ok(Buffer.byteLength(t, 'utf8') < T.MAX_BYTES, Buffer.byteLength(t, 'utf8') + ' bytes');
});

rule('the envelope knows the family and the file', () => {
  assert.strictEqual(E.familyOfPath('team-values.json'), 'flightdeck-team-values');
  assert.ok(E.judge('flightdeck-team-values', JSON.parse(doc(BASE))).ok);
  assert.strictEqual(E.FAMILIES['flightdeck-team-values'].rewrite, true);
});

/* ---- storage: one bounded reader, a checked save, publishing and staging read it fresh ---- */
const repo = PF.repo, NOW = '2026-10-27T09:00:00.000Z';
const mem = (files) => { const m = new PF.fs.MemoryFS('tv:' + Math.random(), null); m.reset(files || {}); return m; };
const KIDMD = ['---', 'process: deploy', 'title: Deploy', 'owner: person-avery', 'context: base, env', '---', '', '## Go · READ-DO {#go}', '- [ ] {confirm} Go {#go1}', ''].join('\n');
const SHIP = (src) => ['---', 'process: ship', 'title: Ship', 'owner: person-avery', 'context: env', '---', '', '## Ship · READ-DO {#s}', '- [ ] {run.process} Deploy it {#dep}', '  process: deploy', '  pass: base=' + src, ''].join('\n');

rule('readTeamValues: missing, ok, malformed, newer, oversized and a failed read, with the exact text for a checked save', async () => {
  same((await repo.readTeamValues(mem())).state, 'missing');
  const ok = await repo.readTeamValues(mem({ 'team-values.json': doc(BASE) }));
  assert.strictEqual(ok.state, 'ok'); assert.strictEqual(ok.text, doc(BASE)); assert.strictEqual(ok.hash, PF.util.hash(doc(BASE)));
  same((await repo.readTeamValues(mem({ 'team-values.json': '{"format":"flightdeck-team-values/1","values":[]}' }))).state, 'malformed');
  same((await repo.readTeamValues(mem({ 'team-values.json': JSON.stringify({ format: 'flightdeck-team-values/4', values: {} }) }))).state, 'newer');
  const big = await repo.readTeamValues(mem({ 'team-values.json': ' '.repeat(T.MAX_BYTES + 1) }));
  assert.strictEqual(big.state, 'unreadable', 'too big is unreadable, never missing'); assert.ok(/team-values\.json couldn't be read/.test(big.why), big.why);
  const m = mem(); m.read = () => Promise.reject(new Error('locked'));
  const bad = await repo.readTeamValues(m);
  assert.strictEqual(bad.state, 'unreadable'); assert.ok(/locked/.test(bad.why));
});

rule('saveTeamValues: checked against the text seen; refused over TEAM_MAX, when invalid, and when the file was swapped for a huge one', async () => {
  const m = mem({ 'team-values.json': doc(BASE) }), seen = await repo.readTeamValues(m);
  const next = T.text({ values: Object.assign({}, BASE, { 'prod-env': { value: 'production' } }) });
  const ok = await repo.saveTeamValues(m, next, seen.hash, { expectText: seen.text });
  assert.ok(ok.ok); assert.strictEqual(m.files['team-values.json'].t, next);
  const stale = await repo.saveTeamValues(m, T.text({ values: {} }), seen.hash, { expectText: seen.text });
  assert.ok(stale.conflict, 'a save from an older read is refused'); assert.strictEqual(m.files['team-values.json'].t, next);
  await assert.rejects(repo.saveTeamValues(m, '{', PF.util.hash(next), { expectText: next }), /isn't valid JSON/);
  await assert.rejects(repo.saveTeamValues(m, 'x'.repeat(T.MAX_BYTES + 1), PF.util.hash(next), { expectText: next }), /too long to save/);
  const n = mem({ 'team-values.json': ' '.repeat(T.MAX_BYTES + 1) });
  await assert.rejects(repo.saveTeamValues(n, next, PF.util.hash(n.files['team-values.json'].t), { expectText: n.files['team-values.json'].t }), /too big|bigger|MB|KB|bytes/i, 'the comparison read is bounded');
  const w = mem({}), write = w.write.bind(w);
  w.write = (p, t) => write(p, t).then(() => { w.files[p].t = ' '.repeat(T.MAX_BYTES + 1); });
  await assert.rejects(repo.saveTeamValues(w, next, null, { expectText: null }), /too big|bigger|MB|KB|bytes/i, 'the read-back is bounded');
});

rule('loadAll carries the team values', async () => {
  const d = await repo.loadAll(mem({ 'people.json': example('people.json'), 'team-values.json': doc(BASE) }));
  assert.strictEqual(d.teamValues.state, 'ok');
  same(T.lookup(d.teamValues, 'bitbucket-base-url'), { value: BASE['bitbucket-base-url'].value });
  assert.strictEqual((await repo.loadAll(mem({ 'people.json': example('people.json') }))).teamValues.state, 'missing');
});

rule('publish and stage read team-values.json now: a missing name blocks both; a good one publishes the team-values feature', async () => {
  const EX = exampleSetup(PF), people = JSON.parse(example('people.json'));
  const m = mem({ 'people.json': example('people.json') });
  const kid = await repo.publish(m, KIDMD, { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, rand: 'aaaa1111' });
  assert.ok(!kid.blockers, String(kid.blockers));
  const opts = { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, rand: 'bbbb2222' };
  const no = await repo.publish(m, SHIP('team:bitbucket-base-url'), opts);
  assert.ok(no.blockers && no.blockers.some(b => /"bitbucket-base-url" isn't a team value in this folder/.test(b)), String(no.blockers));
  const st = await repo.stage(m, SHIP('team:bitbucket-base-url'), opts);
  assert.ok(st.blockers && st.blockers.some(b => /isn't a team value in this folder/.test(b)), 'staging too: ' + String(st.blockers));
  await m.write('team-values.json', doc(BASE));
  const yes = await repo.publish(m, SHIP('team:bitbucket-base-url'), opts);
  assert.ok(!yes.blockers, String(yes.blockers));
  same(JSON.parse(m.files['publications/ship/' + yes.folder + '/publication.json'].t).features, ['passed-details', 'team-values']);
  await m.write('team-values.json', '{');
  const torn = await repo.publish(m, SHIP('team:bitbucket-base-url'), Object.assign({}, opts, { rand: 'cccc3333' }));
  assert.ok(torn.blockers && torn.blockers.some(b => /isn't valid JSON\. So the team value "bitbucket-base-url" can't be checked/.test(b)), String(torn.blockers));
  const plain = await repo.publish(m, SHIP('^env'), Object.assign({}, opts, { rand: 'dddd4444' }));
  assert.ok(!plain.blockers, 'a draft without team: never reads it: ' + String(plain.blockers));
});

rule('Folder health: a published step passing a team value that isn\'t set is flagged; a damaged file is named; a copy is listed', async () => {
  const M = PF.map, ship = M.parse(SHIP('team:bitbucket-base-url'));
  const procs = [{ id: 'ship', latest: { map: ship, info: { version: 1 } } }];
  const rep = (tv) => PF.health.check({ data: { processes: procs, runs: [], people: [], teamValues: tv } }, Date.parse(NOW));
  const gone = rep(T.parse(doc({}))).issues.filter(x => /^team-missing:/.test(x.id));
  assert.strictEqual(gone.length, 1);
  assert.ok(/passes the team value "bitbucket-base-url", which isn't in team-values\.json\. New runs ask for it when the child starts/.test(gone[0].detail), gone[0].detail);
  assert.strictEqual(gone[0].action.act, 'open-process');
  assert.strictEqual(rep(T.parse(doc(BASE))).issues.filter(x => /^team-missing:/.test(x.id)).length, 0);
  assert.strictEqual(rep(T.parse(null)).issues.filter(x => /^team-missing:/.test(x.id)).length, 1, 'no file at all: not set');
  assert.strictEqual(rep(T.parse('{')).issues.filter(x => /^team-missing:/.test(x.id)).length, 0, 'a damaged file is named as unreadable instead');
  const m = mem({ 'people.json': example('people.json'), 'team-values.json': '{', 'team-values-LAPTOP.json': doc(BASE) });
  const scan = await repo.scan(m, {});
  assert.ok(scan.unreadable.some(u => u.path === 'team-values.json' && /isn't valid JSON/.test(u.why)), JSON.stringify(scan.unreadable));
  assert.strictEqual(PF.health.copyOf('team-values-LAPTOP.json', { 'team-values.json': true }), 'team-values.json');
});

rule('saveRun opts.prewrite: awaited after the reads and before still; false or a rejection writes nothing; callers without it are unchanged', async () => {
  const EX = exampleSetup(PF), people = JSON.parse(example('people.json')), m = mem({ 'people.json': example('people.json') });
  const pub0 = await repo.publish(m, KIDMD, { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, rand: 'aaaa1111' });
  const pub = (await repo.loadAll(m)).processes.find(p => p.process === 'deploy').index.latest;
  assert.ok(pub && pub0.folder);
  const mk = (id) => PF.run.create(pub, { title: 'D', details: { base: 'b', env: 'e' }, roles: {}, by: 'person-avery', session: 's1', now: NOW, id });
  const runsIn = () => Object.keys(m.files).filter(p => /^runs\/deploy\/.+\/run\.json$/.test(p));
  const order = [];
  await assert.rejects(repo.saveRun(m, mk('r1'), 's1', { prewrite: () => { order.push('pre'); return false; }, still: () => { order.push('still'); return true; } }), e => e.dropped);
  same(order, ['pre'], 'still never runs after a refusal'); same(runsIn(), []);
  await assert.rejects(repo.saveRun(m, mk('r2'), 's1', { prewrite: () => Promise.reject(new Error('changed')) }), e => e.dropped && /changed/.test(e.cause.message));
  same(runsIn(), []);
  order.length = 0;
  await repo.saveRun(m, mk('r3'), 's1', { prewrite: (fs) => { order.push(fs === m ? 'pre(fs)' : 'pre(?)'); return new Promise(r => setTimeout(() => r(true), 5)); }, still: () => { order.push('still'); return true; } });
  same(order, ['pre(fs)', 'still']); same(runsIn().length, 1);
  await repo.saveRun(m, mk('r4'), 's1', {});
  same(runsIn().length, 2);
});

run();
