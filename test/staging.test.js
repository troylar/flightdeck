// Staging (2.1 slice 4): stage a draft as a version only test runs use, then promote it (make it the default) or retire and
// reopen it. Stages live in staged/<process>/stage-<random8>/ and are written once; retire and reopen are decision files;
// a promoted version is an ordinary publication in the lowest format its content needs, with stagedFrom. A stage's status
// is derived from those files on every read. Nothing here is ever listed as a version to run.
'use strict';
const assert = require('assert');
const { load, example, exampleSetup, rule, run, exactOf } = require('./harness');
const PF = load(), P = PF.publish, S = PF.staging, repo = PF.repo, E = PF.envelope;
const EX = exampleSetup(PF);
const NOW = '2026-10-22T09:00:00.000Z', LATER = '2026-10-22T10:00:00.000Z';
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const people = JSON.parse(example('people.json'));
const MD = example('maps/drafts/release.md');
const CHANGED = MD.replace('Smoke prompts return', 'Smoke prompts all return');

function folder(extra) {
  const fs = new PF.fs.MemoryFS('stage:' + Math.random(), null);
  fs.reset(Object.assign({ 'people.json': example('people.json'), 'maps/drafts/release.md': MD }, extra || {}));
  return fs;
}
const opts = (o) => Object.assign({ people, ...EX, by: 'person-avery', changes: 'Try the new smoke test', now: NOW, app: '2.1.0' }, o || {});
async function v1(fs) {
  const res = await repo.publish(fs, MD, opts({ changes: 'First version', existing: [] }));
  assert.ok(!res.blockers, String(res.blockers));
  return repo.loadAll(fs);
}
async function staged(fs, md) {
  const d = await v1(fs), p = d.processes[0];
  const res = await repo.stage(fs, md || CHANGED, opts({ existing: p.pubs.map(x => ({ version: P.versionOf(x.folder) || 0 })), rand: 'abcd1234' }));
  assert.ok(res && !res.blockers, JSON.stringify(res));
  return res;
}
const files = (fs, re) => Object.keys(fs.files).filter(p => re.test(p)).sort();

/* ---------- The format ---------- */

rule('Stage: the version is written under staged/, as publication/2 naming staged, with the number it proposes and no version of its own', async () => {
  const fs = folder(), res = await staged(fs);
  same([res.folder, res.proposed], ['stage-abcd1234', 2]);
  same(files(fs, /^staged\//), ['staged/release/stage-abcd1234/map.md', 'staged/release/stage-abcd1234/publication.json', 'staged/release/stage-abcd1234/types.json']);
  same(files(fs, /^publications\//).filter(p => /publication\.json$/.test(p)).length, 1, 'nothing new in publications/');
  const info = JSON.parse(fs.files['staged/release/stage-abcd1234/publication.json'].t);
  same([info.format, info.features, info.folder, 'version' in info, info.stage, info.stagedBy, info.stagedAt, info.changes], ['preflight-publication/2', ['staged'], 'stage-abcd1234', false, { proposed: 2 }, 'person-avery', NOW, 'Try the new smoke test']);
  assert.ok(info.payload && /^[0-9a-f]{64}$/.test(info.payload.map), 'a stage always freezes its payload');
  assert.strictEqual(fs.files['staged/release/stage-abcd1234/map.md'].t, CHANGED, 'exactly the draft');
});

rule('Stage: a stage reads back as a stage only; publications/ never takes a staged record, and staged/ never takes an ordinary one', async () => {
  const fs = folder(); await staged(fs);
  const b = 'staged/release/stage-abcd1234/', t = n => fs.files[b + n].t, f = { 'map.md': t('map.md'), 'types.json': t('types.json'), 'publication.json': t('publication.json') };
  const st = P.verify('stage-abcd1234', f, exactOf(PF, f), { stage: true });
  assert.ok(st.ok, st.why);
  const asPub = P.verify('stage-abcd1234', f, exactOf(PF, f));
  assert.ok(!asPub.ok && asPub.unusable && /staged/i.test(asPub.why), 'never a version to run: ' + asPub.why);
  const d = await repo.loadAll(fs), pv = d.processes[0];
  const pf = pv.index.latest.info.folder, pfiles = { 'map.md': fs.files['publications/release/' + pf + '/map.md'].t, 'types.json': fs.files['publications/release/' + pf + '/types.json'].t, 'publication.json': fs.files['publications/release/' + pf + '/publication.json'].t };
  assert.ok(!P.verify(pf, pfiles, exactOf(PF, pfiles), { stage: true }).ok, 'an ordinary record isn\'t a stage');
});

rule('Loading: stages are listed on their own, never in the versions; a folder without staged/ never lists it', async () => {
  const fs = folder(); await staged(fs);
  const d = await repo.loadAll(fs), p = d.processes[0];
  same([p.index.latest.info.version, p.index.all.length], [1, 1], 'the stage isn\'t a version');
  const sp = d.stages.procs.release;
  same(sp.stages.map(s => [s.folder, s.ok, s.info.stage.proposed]), [['stage-abcd1234', true, 2]]);
  same(S.status(sp.stages[0], sp.decisions, p.pubs).status, 'staged');
  const plain = folder(); await v1(plain);
  const listed = []; const orig = plain.list.bind(plain); plain.list = (x) => { listed.push(x); return orig(x); };
  const d2 = await repo.loadAll(plain);
  assert.ok(!listed.some(x => /^staged/.test(x)), 'never listed: ' + listed.join(', '));
  same(d2.stages.procs, {});
});

rule('Loading: staged/ or staged/<process>/ that can\'t be listed holds that process\'s stages ("couldn\'t be read"), never "no stages"', async () => {
  const fs = folder(); await staged(fs);
  const orig = fs.list.bind(fs);
  fs.list = (x) => x === 'staged/release' ? Promise.reject(new Error('offline')) : orig(x);
  const d = await repo.loadAll(fs);
  assert.ok(/couldn't be read/.test(d.stages.procs.release.unlisted), JSON.stringify(d.stages));
  fs.list = (x) => x === 'staged' ? Promise.reject(new Error('offline')) : orig(x);
  const d2 = await repo.loadAll(fs);
  assert.ok(d2.failed.stages, 'the part that failed is named');
});

/* ---------- Promote ---------- */

rule('Promote: a stage with no 2.0 or 2.1 feature becomes the next version as publication/1, with stagedFrom, and is the default', async () => {
  const fs = folder(); await staged(fs);
  const res = await repo.promote(fs, 'release', 'stage-abcd1234', { by: 'person-blake', now: LATER, app: '2.1.0', rand: 'prom0001' });
  same([res.version, res.folder, res.renumbered], [2, 'v2-prom0001', false]);
  const info = JSON.parse(fs.files['publications/release/v2-prom0001/publication.json'].t);
  same([info.format, 'features' in info, 'payload' in info, 'stage' in info, info.version, info.publishedBy, info.publishedAt, info.stagedFrom], ['preflight-publication/1', false, false, false, 2, 'person-blake', LATER, { folder: 'stage-abcd1234', at: NOW }]);
  assert.strictEqual(fs.files['publications/release/v2-prom0001/map.md'].t, CHANGED, 'the stage\'s checklist, exactly');
  const d = await repo.loadAll(fs), p = d.processes[0], sp = d.stages.procs.release;
  same([p.index.latest.info.version, p.index.latest.info.folder], [2, 'v2-prom0001']);
  const st = S.status(sp.stages[0], sp.decisions, p.pubs);
  same([st.status, st.pub && st.pub.info.version], ['promoted', 2]);
  await assert.rejects(() => repo.promote(fs, 'release', 'stage-abcd1234', { by: 'person-blake', now: LATER, app: '2.1.0' }), /already the default|already promoted/i);
});

rule('Promote: a stage with conditions keeps its format and payload, drops staged, and its payload is exactly the stage\'s', async () => {
  const md = CHANGED.replace('context: ticket, commit, environment, tag', 'context: ticket, commit, environment, tag, risk:choice(low|high)').replace(/(\n## Verify in production[^\n]*\n)/, '$1  only when ^risk is high\n');
  const fs = folder(); await staged(fs, md);
  const stInfo = JSON.parse(fs.files['staged/release/stage-abcd1234/publication.json'].t);
  same(stInfo.features, ['typed-details', 'staged', 'conditions']);
  await repo.promote(fs, 'release', 'stage-abcd1234', { by: 'person-blake', now: LATER, app: '2.1.0', rand: 'prom0002' });
  const info = JSON.parse(fs.files['publications/release/v2-prom0002/publication.json'].t);
  same([info.format, info.features], ['preflight-publication/2', ['typed-details', 'conditions']]);
  assert.strictEqual(P.payloadHash(info.payload), P.payloadHash(stInfo.payload), 'the whole payload, unchanged');
  const d = await repo.loadAll(fs);
  assert.ok(d.processes[0].index.latest.ok && d.processes[0].index.latest.info.version === 2);
});

rule('Promote: the number comes from a fresh listing, renumbered and said when someone published meanwhile', async () => {
  const fs = folder(); await staged(fs);
  const other = await repo.publish(fs, MD.replace('Smoke prompts return', 'Smoke prompts now return'), opts({ changes: 'Meanwhile', existing: [{ version: 1 }], rand: 'meanwhil' }));
  assert.strictEqual(other.version, 2);
  const res = await repo.promote(fs, 'release', 'stage-abcd1234', { by: 'person-blake', now: LATER, app: '2.1.0', rand: 'prom0003' });
  same([res.version, res.proposed, res.renumbered], [3, 2, true]);
  const d = await repo.loadAll(fs);
  same(d.processes[0].index.latest.info.folder, 'v3-prom0003');
});

rule('Promote: refused while publications/<process>/, the stage or its decisions can\'t be read, and writes nothing', async () => {
  for (const bad of ['publications/release', 'staged/release/decisions']) {
    const fs = folder(); await staged(fs);
    if (bad === 'staged/release/decisions') await repo.decideStage(fs, 'release', 'stage-abcd1234', 'retired', { by: 'person-avery', now: NOW, window: 'w-avery', reason: 'x' }).then(() => repo.decideStage(fs, 'release', 'stage-abcd1234', 'reopened', { by: 'person-avery', now: NOW, window: 'w-avery' }));
    const before = JSON.stringify(Object.keys(fs.files).sort()), orig = fs.list.bind(fs);
    fs.list = (x) => x === bad ? Promise.reject(new Error('offline')) : orig(x);
    await assert.rejects(() => repo.promote(fs, 'release', 'stage-abcd1234', { by: 'person-blake', now: LATER, app: '2.1.0' }), /couldn't be read|can't be read/);
    assert.strictEqual(JSON.stringify(Object.keys(fs.files).sort()), before, bad + ': nothing written');
  }
  const fs = folder(); await staged(fs);
  delete fs.files['staged/release/stage-abcd1234/types.json'];
  await assert.rejects(() => repo.promote(fs, 'release', 'stage-abcd1234', { by: 'person-blake', now: LATER, app: '2.1.0' }), /syncing|isn't complete|can't be read/i);
  assert.ok(!files(fs, /^publications\/release\/v2/).length);
});

rule('Promote: a copied file that doesn\'t read back as written stops it before the record is written', async () => {
  const fs = folder(); await staged(fs);
  const orig = fs.write.bind(fs);
  fs.write = (p, d) => /^publications\/release\/v2-[a-z0-9]+\/map\.md$/.test(p) ? orig(p, 'something else') : orig(p, d);
  await assert.rejects(() => repo.promote(fs, 'release', 'stage-abcd1234', { by: 'person-blake', now: LATER, app: '2.1.0', rand: 'prom0004' }), /didn't read back|doesn't match/);
  assert.ok(!fs.files['publications/release/v2-prom0004/publication.json'], 'no record: never a version');
});

/* ---------- The stage transaction ---------- */

rule('Stage transaction: a write or read-back failure at each step stops it with the reason; the record is written last, so a half stage is never usable', async () => {
  const md = CHANGED.replace(/(\n- \[[ !~]\] [^\n]*\{#flags\}\n)/, '$1  ![The values file](images/flags.png)\n');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  for (const at of ['map.md', 'types.json', 'images/flags.png', 'publication.json']) {
    for (const how of ['fail', 'garble']) {
      const fs = folder({ 'images/flags.png': png }); const d = await v1(fs);
      const orig = fs.write.bind(fs);
      fs.write = (p, data) => {
        if (p.indexOf('staged/release/') === 0 && p.endsWith('/' + at)) return how === 'fail' ? Promise.reject(new Error('disk full')) : orig(p, 'garbled');
        return orig(p, data);
      };
      await assert.rejects(() => repo.stage(fs, md, opts({ existing: [{ version: 1 }], rand: 'half0001' })), how === 'fail' ? /disk full/ : /didn't read back|doesn't match|unreadable|isn't/, at + ' ' + how);
      fs.write = orig;
      const d2 = await repo.loadAll(fs), sp = d2.stages.procs.release;
      if (!sp) continue;
      assert.ok(sp.stages.every(s => !s.ok), at + ' ' + how + ': never usable');
      assert.ok(sp.stages.every(s => s.incomplete), 'named as incomplete');
    }
  }
});

rule('Health: an incomplete stage is named, with its folder', async () => {
  const fs = folder(); await staged(fs);
  delete fs.files['staged/release/stage-abcd1234/publication.json'];
  const d = await repo.loadAll(fs), sp = d.stages.procs.release;
  same(sp.stages.map(s => [s.folder, s.ok, s.incomplete]), [['stage-abcd1234', false, true]]);
  const items = PF.health.stages(d.stages);
  assert.ok(items.some(x => /staged\/release\/stage-abcd1234/.test(x.path) && /incomplete/i.test(x.why)), JSON.stringify(items));
});

rule('A stage a newer Flightdeck wrote is refused by name, never called incomplete', async () => {
  const fs = folder(); await staged(fs);
  const pj = 'staged/release/stage-abcd1234/publication.json', info = JSON.parse(fs.files[pj].t);
  info.features = info.features.concat(['extensions']); fs.files[pj].t = JSON.stringify(info);
  const d = await repo.loadAll(fs), s = d.stages.procs.release.stages[0];
  same([s.ok, !!s.incomplete, !!s.newer], [false, false, true]);
  assert.ok(d.refused.some(r => r.path === pj && r.kind === 'newer'), JSON.stringify(d.refused));
  assert.ok(!PF.health.stages(d.stages).length, 'not an incomplete stage');
});

/* ---------- Retire and reopen: decision files, status derived ---------- */

rule('Retire and reopen are decision files, never edits; the latest one by rev decides, and a retired stage offers no promote', async () => {
  const fs = folder(); await staged(fs);
  const snap = JSON.stringify(Object.keys(fs.files).filter(p => /stage-abcd1234\//.test(p)).map(p => fs.files[p].t));
  await repo.decideStage(fs, 'release', 'stage-abcd1234', 'retired', { by: 'person-avery', now: NOW, window: 'w-avery', reason: 'Not this one', app: '2.1.0' });
  same(files(fs, /^staged\/release\/decisions\//), ['staged/release/decisions/stage-abcd1234.w-avery.1.json']);
  const dec = JSON.parse(fs.files['staged/release/decisions/stage-abcd1234.w-avery.1.json'].t);
  same([dec.format, dec.process, dec.stage, dec.status, dec.reason, dec.by, dec.rev, dec.seen, dec.app], ['flightdeck-stage-decision/1', 'release', 'stage-abcd1234', 'retired', 'Not this one', 'person-avery', 1, null, '2.1.0']);
  let d = await repo.loadAll(fs), sp = d.stages.procs.release;
  same(S.status(sp.stages[0], sp.decisions, d.processes[0].pubs).status, 'retired');
  await assert.rejects(() => repo.promote(fs, 'release', 'stage-abcd1234', { by: 'person-blake', now: LATER, app: '2.1.0' }), /retired/);
  await repo.decideStage(fs, 'release', 'stage-abcd1234', 'reopened', { by: 'person-blake', now: LATER, window: 'w-blake' });
  d = await repo.loadAll(fs); sp = d.stages.procs.release;
  same(sp.decisions.map(x => [x.rev, x.status, x.seen]), [[1, 'retired', null], [2, 'reopened', 1]]);
  same(S.status(sp.stages[0], sp.decisions, d.processes[0].pubs).status, 'staged');
  assert.strictEqual(JSON.stringify(Object.keys(fs.files).filter(p => /stage-abcd1234\//.test(p)).map(p => fs.files[p].t)), snap, 'the stage itself never changes');
});

rule('Two decisions with the same rev that disagree are a tie: shown as such, and promote waits for a newer decision', () => {
  const st = { folder: 'stage-abcd1234', ok: true, info: { process: 'release' } };
  const a = { stage: 'stage-abcd1234', status: 'retired', rev: 1 }, b = { stage: 'stage-abcd1234', status: 'reopened', rev: 1 };
  same(S.status(st, [a, b], []).status, 'tie');
  same(S.status(st, [a, b, { stage: 'stage-abcd1234', status: 'reopened', rev: 2 }], []).status, 'staged');
  same(S.status(st, [a, Object.assign({}, a)], []).status, 'retired', 'two that agree aren\'t a tie');
  same(S.status(st, [{ stage: 'stage-other', status: 'retired', rev: 5 }], []).status, 'staged', 'another stage\'s decision');
});

rule('A decision is read through its envelope: a newer one is refused by name and held, never read as no decision', () => {
  const ok = S.cleanDecision({ format: 'flightdeck-stage-decision/1', app: '2.1.0', process: 'release', stage: 'stage-abcd1234', status: 'retired', reason: '', by: 'person-avery', at: NOW, rev: 1, seen: null }, 'release', 'stage-abcd1234.w-avery.1.json');
  assert.ok(ok.ok, ok.why);
  const newer = S.cleanDecision({ format: 'flightdeck-stage-decision/2', process: 'release', stage: 'stage-abcd1234', status: 'retired', rev: 1 }, 'release', 'x.json');
  same([newer.ok, newer.kind], [false, 'newer']);
  ['archived', ''].forEach(s => assert.ok(!S.cleanDecision({ format: 'flightdeck-stage-decision/1', process: 'release', stage: 'stage-abcd1234', status: s, by: 'a', at: NOW, rev: 1, seen: null }, 'release', 'x.json').ok, s));
  assert.ok(!S.cleanDecision({ format: 'flightdeck-stage-decision/1', process: 'other', stage: 'stage-abcd1234', status: 'retired', by: 'a', at: NOW, rev: 1, seen: null }, 'release', 'x.json').ok, 'another process');
  assert.ok(!S.cleanDecision({ format: 'flightdeck-stage-decision/1', process: 'release', stage: 'stage-abcd1234', status: 'retired', by: 'a', at: NOW, rev: 0, seen: null }, 'release', 'x.json').ok, 'rev from 1');
});

/* ---------- The frozen 2.0 samples ---------- */

rule('The frozen sample stage reads as a stage (its record says 2.0.0; staged needs 2.1), retired by its decision, and its sample version stays the only one to run', async () => {
  const path = require('path'), nfs = require('fs');
  const root = path.join(__dirname, 'fixtures', 'v2', 'folder'), seed = {};
  (function walk(d) { nfs.readdirSync(d).forEach(f => { const q = path.join(d, f); if (nfs.statSync(q).isDirectory()) walk(q); else { const rel = path.relative(root, q).split(path.sep).join('/'); seed[rel] = /\.png$/.test(f) ? 'data:image/png;base64,' + nfs.readFileSync(q).toString('base64') : nfs.readFileSync(q, 'utf8'); } }); })(root);
  const fs = new PF.fs.MemoryFS('frozen:' + Math.random(), null); fs.reset(seed);
  const d = await repo.loadAll(fs), sp = d.stages.procs.backup;
  const st = sp.stages.filter(s => s.folder === 'stage-aaaa1111')[0];
  assert.ok(st && st.ok, JSON.stringify(st && st.why));
  same(S.status(st, sp.decisions, (d.processes.filter(p => p.process === 'backup')[0] || { pubs: [] }).pubs).status, 'retired');
  assert.strictEqual(E.judge('preflight-publication', JSON.parse(seed['staged/backup/stage-aaaa1111/publication.json'])).ok, true, 'staged is read now');
});

run();
