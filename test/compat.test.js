// Older releases against this one, from their own shipped code (docs/design.md section 28; the 2.0 plan's slice 1a).
// Each release tag in test/fixtures/old-bundles/record.json runs here: its core and storage headless, and its whole page in the app
// harness for saving and recovery. The rules record what each release does today, quirks included; rules marked "Known:"
// describe a gap the 1.21 bridge (slice 1b) closes, so they're expected to change then, deliberately.
// Without the tags (a shallow clone) the rules that need a release's code are skipped with a message; in CI (CI set) that's a
// failure instead. Rules that only read the committed baseline folders (test/fixtures/folders/) always run.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const { rule, run } = require('./harness');
const H = require('./compat-harness');
const AH = require('./app-harness');
const { ROWS, expects } = require('./compat-matrix');
const INV = require('./compat-readers');
const G = require('../tools/old-folders');
const { cmp } = require('../tools/old-bundles');

const TAGS = H.bundles.tags();
const MAIN = H.loadMain().__version;
const AT = '2026-03-02T12:00:00.000Z';
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const below = (v) => cmp(v, H.bundles.FLOOR) < 0;
const at = (v, from) => cmp(v, from) >= 0;
const fixture = (tag) => H.readTree(path.join(G.DIR, tag));
let mainFolder = null;
const mainFiles = async () => (mainFolder = mainFolder || await G.main());
/* Plain copies without this window's own bookkeeping (fields starting with "_"). */
const strip = (r) => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k[0] !== '_'))));
/* Every rule that needs a release's code: skipped (with the message old-bundles printed) when it isn't available. */
function eachTag(name, fn, filter) {
  TAGS.filter(filter || (() => true)).forEach((t) => rule(t.tag + (t.supported ? '' : ' (below the floor)') + ': ' + name, async () => {
    const PF = H.loadCopy(t.tag);
    if (!PF) return;
    await fn(PF, t);
  }));
}
/* A folder's files as text, under a prefix. */
const under = (m, dir) => { const o = {}; Object.keys(m.files).filter(p => p.indexOf(dir) === 0).sort().forEach(p => { o[p] = m.files[p].t; }); return o; };
/* A run file from this one, in a newer run format (what 2.0 writes on a /2 version). */
function asRun3(text) { const j = JSON.parse(text); j.format = 'preflight-run/3'; j.features = ['typed-details']; j.app = '2.0.0'; return JSON.stringify(j, null, 2); }

/* ---------- The releases themselves ---------- */

rule('The record lists every release from 1.10.0 to the newest tag, and the supported floor is 1.11.1', () => {
  const tags = TAGS.map(t => t.tag);
  assert.strictEqual(tags[0], 'v1.10.0');
  assert.ok(tags.indexOf('v1.11.1') >= 0 && TAGS.find(t => t.tag === 'v1.11.1').supported && !TAGS.find(t => t.tag === 'v1.11.0').supported);
  const left = H.bundles.unrecorded();
  // A new tag isn't a failure here, so tagging a release never breaks main; slice 1b adds 1.19 and 1.20 to the harness.
  if (left.length) console.log('  (not in the harness yet: ' + left.join(', ') + '; run node tools/old-bundles.js --write)');
});

eachTag('extracts to its recorded commit and SHA-256, and what the tests run is exactly what shipped', (PF, t) => {
  const b = H.bundles.get(t.tag), html = b.files['flightdeck.html'];
  assert.strictEqual(H.bundles.block(html, 'pf-core'), b.files['core.js'], 'pf-core as shipped');
  const st = H.bundles.block(html, 'pf-storage'), app = H.bundles.block(html, 'pf-app');
  if (st != null) assert.strictEqual(st.trim(), b.files['storage.js'].trim(), 'pf-storage as shipped');
  else assert.ok(app.indexOf(b.files['fs.js'] + '\n' + b.files['storage.js'] + '\n') >= 0, 'storage code cut from the top of pf-app');
  assert.ok(app.indexOf(b.files['fs.js']) >= 0 && app.indexOf(b.files['fs.js']) < 2, 'fs.js is the top of pf-app');
  const meta = JSON.parse(fs.readFileSync(path.join(H.bundles.CACHE, t.tag, 'meta.json'), 'utf8'));
  same(meta.sha256, JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'old-bundles', 'record.json'), 'utf8')).tags[t.tag].sha256, 'the cache matches the record');
  assert.strictEqual(PF.__version, t.version);
});

/* ---------- The capability matrix ---------- */

ROWS.forEach((row) => rule('Capability matrix: ' + row.what + ' is in exactly the releases from ' + row.from + (row.until ? ' to ' + row.until : ' on') + ', and in this version as its row says', () => {
  const wrong = [];
  TAGS.forEach((t) => {
    const PF = H.loadCopy(t.tag);
    if (!PF) return;
    const b = H.bundles.get(t.tag), has = !!row.has(PF, b.files['flightdeck.html'], b.files['flightdeck.js']);
    if (has !== expects(row.id, t.version)) wrong.push(t.tag + (has ? ' has it' : ' doesn\'t have it'));
  });
  const mine = !!row.has(H.loadMain(), fs.readFileSync(path.join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'bin', 'flightdeck.js'), 'utf8'));
  if (mine !== expects(row.id, MAIN)) wrong.push('this version (' + MAIN + ')' + (mine ? ' has it' : ' doesn\'t have it'));
  assert.deepStrictEqual(wrong, [], 'test/compat-matrix.js is wrong about ' + row.id);
}));

rule('Capability matrix: every writer the reader inventory names is a row', () => {
  INV.FAMILIES.filter(f => f.writer !== 'hand' && f.writer !== 'none').forEach(f => assert.ok(ROWS.some(r => r.id === f.writer), f.id + ' names writer ' + f.writer));
});

/* ---------- Baseline folders written by each release ---------- */

eachTag('writes its baseline folder (test/fixtures/folders/) again, byte for byte', async (PF0, t) => {
  const PF = H.loadCopy(t.tag, { at: G.AT, seed: 7 });
  same(await G.generate(PF, t.version), fixture(t.tag), 'run node tools/old-folders.js --write only if the scenario changed on purpose');
});

rule('This version writes the same folder from the same scenario every time', async () => {
  const a = await G.main(), b = await G.main();
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
});

TAGS.forEach((t) => rule(t.tag + ': its baseline folder holds only files from writers that release had, and hand-written seeds', () => {
  const files = fixture(t.tag), wrong = [];
  Object.keys(files).forEach((p) => {
    const f = INV.familyOf(p);
    if (files[p] === G.SEED[p]) return;
    if (f.writer === 'hand') { if (!(p in G.SEED) && p !== 'images/restore.png') wrong.push(p + ' (hand-written, not in the scenario\'s seed)'); return; }
    if (f.writer === 'none' || !expects(f.writer, t.version)) wrong.push(p + ' (' + f.writer + ' isn\'t in ' + t.tag + ')');
  });
  // people.json is a seed, rewritten only by a release with the people writer (1.15 on).
  if (!expects('people', t.version)) assert.strictEqual(files['people.json'], G.SEED['people.json']);
  assert.deepStrictEqual(wrong, []);
}));

/* ---------- The reader inventory ---------- */

rule('Reader inventory: every path in every baseline folder, this version\'s folder, the example folder and the specimens is in exactly one family', async () => {
  const paths = new Set(Object.keys(INV.UNREAD).concat(Object.keys(await mainFiles())));
  TAGS.forEach(t => Object.keys(fixture(t.tag)).forEach(p => paths.add(p)));
  Object.keys(H.readTree(path.join(__dirname, '..', 'example-folder'))).forEach(p => paths.add(p));
  const PF = H.loadMain(), m = H.memFolder(PF, await mainFiles());
  await INV.prepare(PF, m, MAIN, await mainFiles());
  Object.keys(m.files).forEach(p => paths.add(p));
  const errs = [];
  paths.forEach(p => { try { INV.familyOf(p); } catch (e) { errs.push(e.message); } });
  assert.deepStrictEqual(errs, []);
});

/* A folder as one release wrote it, with a specimen of every family: the scenario's files, prepare()'s, and the unread ones. */
async function specimens(PF, version, files) {
  const m = H.memFolder(PF, Object.assign({}, files, INV.UNREAD));
  await INV.prepare(PF, m, version, files);
  return m;
}
/* Records what a folder is asked for while on() is true. */
function record(m) {
  const seen = { list: new Set(), read: new Set(), stat: new Set() }, on = { v: false };
  ['list', 'read', 'blob', 'stat'].forEach(k => { if (!m[k]) return; const o = m[k].bind(m); m[k] = p => { if (on.v) seen[k === 'blob' ? 'read' : k].add(p); return o(p); }; });
  return { seen, on };
}
const DAMAGE = (p, t) => /\.png$/.test(p) ? 'data:image/png;base64,AAAA' : /\.md$/.test(p) ? 'damaged\n' : '{"damaged":true}\n';
const inRange = (r, v) => at(v, r.from) && (!r.until || cmp(v, r.until) <= 0);
const fnOf = (PF, via) => { const [mod, k] = via.split('.'); return PF[mod] && typeof PF[mod][k] === 'function' ? PF[mod][k] : null; };

/* Each reader, called on a valid specimen: the call reads it, and the output shows it; damaged, the output no longer does. */
async function probeReaders(load, version, files) {
  const wrong = [];
  for (const f of INV.FAMILIES) for (const r of f.readers.filter(x => x.via !== 'app')) {
    const name = f.id + ' via ' + r.via + ' (from ' + r.from + ')';
    if (!inRange(r, version)) {
      if (r.via === 'loadAll') {
        const PF = load(), m = await specimens(PF, version, files), rec = record(m), spec = typeof r.spec === 'function' ? r.spec(m.files ? H.filesOf(m) : files) : r.spec;
        rec.on.v = true; await r.call(PF, m); rec.on.v = false;
        if (spec && rec.seen.read.has(spec)) wrong.push(name + ': read before its range');
      } else if (fnOf(load(), r.via)) wrong.push(name + ': ' + r.via + ' exists before its range');
      continue;
    }
    const run = async (damage) => {
      const PF = load(), m = await specimens(PF, version, files), all = H.filesOf(m), spec = typeof r.spec === 'function' ? r.spec(all) : r.spec;
      if (!spec || !(spec in all)) return { missing: spec || '(no specimen)' };
      if (damage) { if (r.listOnly) await m.remove(spec); else m.files[spec] = { t: DAMAGE(spec, all[spec]), m: Date.now() }; }
      if (!fnOf(PF, r.via === 'loadAll' ? 'repo.loadAll' : r.via)) return { nofn: true };
      const ctx = r.before ? await r.before(PF, m) : null, rec = record(m);
      rec.on.v = true; let out; try { out = await r.call(PF, m, ctx); } finally { rec.on.v = false; }
      let found; try { found = !!r.found(out, all); } catch (e) { found = false; }
      const dir = spec.slice(0, spec.lastIndexOf('/'));
      return { spec, found, read: r.listOnly ? rec.seen.list.has(dir) : rec.seen.read.has(spec) };
    };
    const ok = await run(false);
    if (ok.missing) { wrong.push(name + ': no specimen ' + ok.missing); continue; }
    if (ok.nofn) { wrong.push(name + ': ' + r.via + ' doesn\'t exist'); continue; }
    if (!ok.read) wrong.push(name + ': the call never ' + (r.listOnly ? 'lists the folder of ' : 'reads ') + ok.spec);
    if (!ok.found) wrong.push(name + ': its output doesn\'t show ' + ok.spec);
    const bad = await run(true);
    if (bad.found) wrong.push(name + ': its output doesn\'t change when ' + ok.spec + ' is damaged');
  }
  return wrong;
}
/* What loadAll touches on a folder with a specimen of every family: only known folders and families with a loadAll reader. */
async function loadAllTouches(PF, version, files) {
  const m = await specimens(PF, version, files), rec = record(m), wrong = [];
  rec.on.v = true; await PF.repo.loadAll(m, { deep: true }); rec.on.v = false;
  rec.seen.list.forEach(d => { if (!INV.dirKnown(d)) wrong.push('lists ' + d + '/, which no family in test/compat-readers.js lives in'); });
  rec.seen.read.forEach(p => {
    let f; try { f = INV.familyOf(p); } catch (e) { wrong.push('reads ' + e.message); return; }
    if (!f.readers.some(r => r.via === 'loadAll' && inRange(r, version))) wrong.push('loadAll reads ' + p + ' (' + f.id + '), which has no loadAll reader in the inventory at ' + version);
  });
  rec.seen.stat.forEach(p => { try { INV.familyOf(p); } catch (e) { wrong.push('stats ' + e.message); } });
  return wrong;
}
eachTag('Reader inventory: every reader the inventory names reads a valid specimen and shows it, and none is claimed outside its range', async (PF, t) => {
  assert.deepStrictEqual(await probeReaders(() => H.loadCopy(t.tag), t.version, fixture(t.tag)), []);
  assert.deepStrictEqual(await loadAllTouches(H.loadCopy(t.tag), t.version, fixture(t.tag)), []);
});
rule('Reader inventory: this version\'s readers read a valid specimen of each family and show it', async () => {
  const files = await mainFiles();
  assert.deepStrictEqual(await probeReaders(() => H.loadMain(), MAIN, files), []);
  assert.deepStrictEqual(await loadAllTouches(H.loadMain(), MAIN, files), []);
});

/* ---------- This version reads every older folder ---------- */

TAGS.forEach((t) => rule(t.tag + ': this version reads its folder: the version usable, both runs writable, and its notes, plans, sign-offs and decisions as written', async () => {
  const PF = H.loadMain(), m = H.memFolder(PF, fixture(t.tag)), d = await PF.repo.loadAll(m), v = t.version;
  same([d.unreadable, d.failed], [[], {}], 'nothing unreadable');
  const proc = d.processes[0];
  assert.ok(proc.index.latest && proc.index.latest.info.version === 1 && proc.index.latest.info.format === 'preflight-publication/1', 'v1 is usable');
  same(d.runs.map(r => [r.id, r.format, !!r._unrunnable]).sort(), [['run-a', 'preflight-run/2', false], ['run-b', 'preflight-run/2', false]]);
  const a = d.runs.find(r => r.id === 'run-a'), b = d.runs.find(r => r.id === 'run-b');
  assert.strictEqual(a.steps.read.s, 'done');
  assert.ok(a._notes.some(n => n.id === 'n-1' && /slow to start/.test(n.text)), 'the note');
  assert.ok(b.ended && b.ended.outcome === 'Completed' && b.followUps.length === 1);
  assert.strictEqual(d.drafts.length, 1);
  assert.strictEqual(d.skills[0].skill.implements, 1);
  assert.strictEqual(d.validations.length, 1);
  assert.ok(d.stepTypes.types['team.restore'] && !d.stepTypes.errors.length, 'the step type');
  assert.strictEqual(d.people.length, expects('people', v) ? 4 : 3);
  assert.strictEqual(d.plans.length, expects('plans', v) ? 1 : 0);
  if (expects('plans', v)) assert.strictEqual(d.plans[0]._status.status, 'declined');
  // Suggested fixes from 1.11 and 1.12 are read as legacy decisions; corrections' and follow-ups' decisions as their own.
  same(d.corrDecisions.map(x => x.kind).sort(), [].concat(expects('fixes', v) ? ['fix-decision'] : [], expects('corrections', v) ? ['correction-decision'] : []));
  same([d.corrUnread.length, d.fuUnread.length], [0, 0]);
  same(d.fuDecisions.map(x => x.status), expects('followups', v) ? ['ticket'] : []);
  if (expects('fixes', v)) assert.ok(a._notes.some(n => n.kind === 'fix' && n.id === 'f-1'), 'the suggested fix');
  if (expects('corrections', v)) assert.ok(a._notes.some(n => n.kind === 'correction' && n.id === 'c-1'), 'the correction');
}));

/* A run goes from one copy to the other and back: each answers a step and saves; nothing either wrote is lost. */
eachTag('a run it wrote goes to this version and back: each answers a step and saves as preflight-run/2, nothing lost either way', async (OLD, t) => {
  const NEW = H.loadMain(), m = H.memFolder(NEW, fixture(t.tag));
  const a = (await NEW.repo.loadAll(m)).runs.find(r => r.id === 'run-a');
  same(strip(a), strip(OLD.run.sanitize(JSON.parse(m.files['runs/backup/run-a/run.json'].t))), 'both read the file the same way');
  a.recorder.session = 'w-avery';
  NEW.run.done(a, NEW.run.mapOf(a), 'restore', 'person-blake', AT, { copy: 'scratch-2026-03' });
  await NEW.repo.saveRun(m, a, 'w-avery');
  const saved = JSON.parse(m.files['runs/backup/run-a/run.json'].t);
  assert.strictEqual(saved.format, 'preflight-run/2');
  const om = H.memFolder(OLD, H.filesOf(m)), back = (await OLD.repo.loadAll(om)).runs.find(r => r.id === 'run-a');
  assert.ok(!back._unrunnable, t.tag + ' can record it: ' + back._unrunnable);
  same(strip(back), strip(NEW.run.sanitize(JSON.parse(om.files['runs/backup/run-a/run.json'].t))), 'and reads exactly what this version saved');
  OLD.run.done(back, OLD.run.mapOf(back), 'where', 'person-blake', AT, { evidence: 'https://example.com/copies/2026-03' });
  await OLD.repo.saveRun(om, back, 'w-avery');
  const again = (await NEW.repo.loadAll(H.memFolder(NEW, H.filesOf(om)))).runs.find(r => r.id === 'run-a');
  assert.ok(!again._unrunnable && !again._badTimes);
  same([again.steps.read.s, again.steps.restore.s, again.steps.where.s, again.steps.restore.values.copy], ['done', 'done', 'done', 'scratch-2026-03'], 'both answers kept');
  assert.ok(again.log.length >= saved.log.length, 'and the log');
});

/* ---------- Older releases read this version's folder ---------- */

eachTag('reads this version\'s folder: the version usable, both runs writable, and each run saved again loses nothing', async (OLD, t) => {
  const files = await mainFiles(), m = H.memFolder(OLD, files), d = await OLD.repo.loadAll(m);
  assert.ok(d.processes[0].index.latest && d.processes[0].index.latest.info.version === 1, 'v1 is usable');
  same(d.runs.map(r => [r.id, !!r._unrunnable]).sort(), [['run-a', false], ['run-b', false]]);
  if (d.fuDecisions) assert.strictEqual(d.fuDecisions.length, expects('followups', t.version) ? 1 : 0);
  for (const id of ['run-a', 'run-b']) {
    const p = 'runs/backup/' + id + '/run.json', before = JSON.parse(m.files[p].t), r = d.runs.find(x => x.id === id);
    r.recorder.session = 'w-avery';
    await OLD.repo.saveRun(m, r, 'w-avery');
    const after = JSON.parse(m.files[p].t);
    ['rev', 'savedAt', 'savedBy', 'lineage'].forEach(k => { delete before[k]; delete after[k]; });
    same(after, before, id + ': ' + t.tag + ' saves back exactly what it read');
  }
});

/* ---------- Refusals that already exist (zero writes) ---------- */

eachTag('a preflight-run/3 file is shown by name only and never written; candidates and conflict copies already there are kept byte for byte', async (OLD, t) => {
  const m = H.memFolder(OLD, fixture(t.tag)), dir = 'runs/backup/run-a/', p = dir + 'run.json';
  const mine = (await OLD.repo.loadAll(m)).runs.find(r => r.id === 'run-a');
  m.files[dir + 'run.conflict-w-other-1.json'] = { t: m.files[p].t, m: 1 };
  m.files[dir + 'candidate-w-other-aaaa1111.json'] = { t: '{"left":"by another window"}', m: 1 };
  m.files[p] = { t: asRun3(m.files[p].t), m: 2 };
  const before = under(m, dir), d = await OLD.repo.loadAll(m), r = d.runs.find(x => x.id === 'run-a');
  if (below(t.version)) {
    // No format check before 1.11.1: the run isn't listed at all, not even as unreadable.
    assert.ok(!r && !d.unreadable, 'silently left out');
  } else {
    assert.ok(r && r._unrunnable && !Object.keys(r.steps).length && r.title === 'Backup check March', 'name only, read-only');
    await assert.rejects(() => OLD.repo.saveRun(m, r, 'w-avery'), 'saving it is refused');
  }
  // A save this copy had queued from before the file changed: refused, with no conflict copy and no candidate written.
  mine.recorder.session = 'w-avery';
  OLD.run.done(mine, OLD.run.mapOf(mine), 'restore', 'person-blake', AT, { copy: 'x' });
  await assert.rejects(() => OLD.repo.saveRun(m, mine, 'w-avery'));
  same(under(m, dir), before, 'nothing written; what was there is kept as it was');
});

eachTag('a preflight-publication/2 version is unusable: never the latest, and no run starts on it (before 1.11.1: usable, why the floor is 1.11.1)', async (OLD, t) => {
  const files = fixture(t.tag), pubDir = Object.keys(files).find(p => /publication\.json$/.test(p)).replace('publication.json', '');
  const info = JSON.parse(files[pubDir + 'publication.json']);
  const v2 = pubDir.replace(/v1-[a-z0-9]+\/$/, 'v2-zzzz2222/');
  files[v2 + 'map.md'] = files[pubDir + 'map.md']; Object.keys(files).filter(p => p.indexOf(pubDir + 'images/') === 0).forEach(p => { files[v2 + p.slice(pubDir.length)] = files[p]; }); files[v2 + 'types.json'] = files[pubDir + 'types.json'];
  files[v2 + 'publication.json'] = JSON.stringify(Object.assign({}, info, { format: 'preflight-publication/2', features: ['typed-details'], app: '2.0.0', version: 2, folder: 'v2-zzzz2222' }), null, 2);
  const proc = (await OLD.repo.loadAll(H.memFolder(OLD, files))).processes[0];
  if (below(t.version)) { assert.strictEqual(proc.index.latest.info.version, 2, 'below the floor, a /2 version is run as if it were /1'); return; }
  assert.strictEqual(proc.index.latest.info.version, 1, 'v1 stays the latest');
  const v = OLD.publish.verify('v2-zzzz2222', { 'publication.json': files[v2 + 'publication.json'], 'map.md': files[v2 + 'map.md'], 'types.json': files[v2 + 'types.json'] });
  assert.ok(!v.ok && v.unusable && v.why === OLD.publish.NEWER);
  assert.throws(() => OLD.run.create({ info: v.info, map: OLD.map.parse(files[v2 + 'map.md']), md: files[v2 + 'map.md'], types: JSON.parse(files[v2 + 'types.json']) }, { by: 'person-avery', session: 's', now: AT }));
});

eachTag('a run/2 with a field this copy doesn\'t know, at the top, in a step, a gate or a linked child, opens read-only (before 1.11.1: the field is dropped on save)', async (OLD, t) => {
  const files = fixture(t.tag), p = 'runs/backup/run-b/run.json', base = JSON.parse(files[p]);
  const gate = Object.keys(base.gates)[0];
  const cases = {
    top: [(j) => { j.pins = { children: {} }; }, (r) => 'pins' in r],
    step: [(j) => { j.steps.restore.migration = { from: 'x' }; }, (r) => 'migration' in r.steps.restore],
    gate: [(j) => { j.gates[gate].shots = ['images/a.png']; }, (r) => 'shots' in r.gates[gate]],
    child: [(j) => { j.steps.read.child = { process: 'verify', id: 'c1', inputs: {}, folder: 'v1-aaaa1111' }; }, (r) => 'folder' in r.steps.read.child]
  };
  for (const k of Object.keys(cases)) {
    const j = JSON.parse(JSON.stringify(base)); cases[k][0](j);
    const r = OLD.run.sanitize(JSON.parse(JSON.stringify(j)));
    if (below(t.version)) { assert.ok(r && !r._unrunnable && !cases[k][1](r), k + ': writable below the floor, without the field'); continue; }
    assert.ok(r && r._unrunnable, k + ': read-only, never dropped');
  }
});

eachTag('a draft in 2.0 syntax can\'t be published, and a step type with a 2.0 kind is refused and never saved over', async (OLD, t) => {
  const typed = G.CHECKLIST.replace('context: ticket', 'context: ticket, amount:number');
  assert.ok(OLD.map.check(OLD.map.parse(typed), { people: G.PEOPLE, types: { 'team.restore': OLD.types.customType(G.STEP_TYPE) } }).blockers.length, 'typed details are a blocker');
  const m = H.memFolder(OLD, fixture(t.tag)), res = await OLD.repo.publish(m, typed, { people: G.PEOPLE, customTypes: { 'team.restore': OLD.types.customType(G.STEP_TYPE) }, workflows: {}, by: 'person-avery', changes: 'Typed', existing: [], now: AT });
  assert.ok(res.blockers && res.blockers.length, 'publish refuses');
  const def = JSON.parse(JSON.stringify(G.STEP_TYPE)); def.record.push({ name: 'rows', label: 'Rows', kind: 'number' });
  assert.ok(OLD.types.checkCustom(def).length, 'a number kind is refused');
  const was = m.files['step-types/team.restore.json'].t;
  await assert.rejects(() => OLD.repo.saveStepType(m, def, OLD.util.hash(was), {}));
  assert.strictEqual(m.files['step-types/team.restore.json'].t, was);
});

/* ---------- Known: what older releases (and this one) still accept; the 1.21 bridge closes these ---------- */

eachTag('a follow-up decision with fv: 2 is read as an ordinary decision there (pre-bridge copies keep accepting it), and this version refuses it as newer, named', async (OLD, t) => {
  const files = fixture(t.tag), file = Object.keys(files).find(p => /^followups\//.test(p));
  const o = JSON.parse(files[file]); o.fv = 2; o.status = 'done'; o.rev = 2; o.seen = file.split('/').pop();
  const name = file.replace(/\.1\.json$/, '.2.json').replace('w-avery', 'w-blake');
  files[name] = JSON.stringify(o, null, 2);
  const d = await OLD.repo.loadAll(H.memFolder(OLD, files));
  assert.ok(d.fuDecisions.some(x => x.rev === 2 && x.status === 'done'), t.tag + ' accepts it');
  assert.strictEqual(d.fuUnread.length, 0);
  const NEW = H.loadMain(), n = await NEW.repo.loadAll(H.memFolder(NEW, files));
  assert.ok(!n.fuDecisions.some(x => x.rev === 2), 'this version never reads it as a decision');
  const u = n.fuUnread.find(x => x._file === name.split('/').pop());
  assert.ok(u && u.kind === 'newer' && /newer Flightdeck/.test(u.why), JSON.stringify(n.fuUnread));
  assert.ok(n.refused.some(r => r.path === name && r.kind === 'newer'), 'and lists it with the files it refused');
}, (t) => expects('followups', t.version));

eachTag('a correction decision with dv: 3 is read as an ordinary decision there (pre-bridge copies keep accepting it), and this version refuses it as newer, named', async (OLD, t) => {
  const files = fixture(t.tag), file = Object.keys(files).find(p => /^corrections\//.test(p));
  const o = JSON.parse(files[file]); o.dv = 3; o.rev = 2; o.seen = file.split('/').pop();
  const name = file.replace(/\.1\.json$/, '.2.json').replace('w-avery', 'w-blake');
  files[name] = JSON.stringify(o, null, 2);
  const d = await OLD.repo.loadAll(H.memFolder(OLD, files));
  assert.ok(d.corrDecisions.some(x => x.kind === 'correction-decision' && x.rev === 2), t.tag + ' accepts it');
  assert.strictEqual(d.corrUnread.length, 0);
  const NEW = H.loadMain(), n = await NEW.repo.loadAll(H.memFolder(NEW, files));
  assert.ok(!n.corrDecisions.some(x => x.rev === 2), 'this version never reads it as a decision');
  const u = n.corrUnread.find(x => x._file === name.split('/').pop());
  assert.ok(u && u.kind === 'newer' && /newer Flightdeck/.test(u.why), JSON.stringify(n.corrUnread));
  assert.ok(n.refused.some(r => r.path === name && r.kind === 'newer'));
}, (t) => expects('corrections', t.version));

eachTag('a front-matter format: or features: line is kept in meta and published as an ordinary version there (so it can\'t be a boundary); this version refuses to publish it', async (OLD, t) => {
  const NEW = H.loadMain();
  for (const extra of ['format: flightdeck-checklist/2', 'features: typed-details', 'format: flightdeck-checklist/9\nfeatures: future-thing']) {
    const md = G.CHECKLIST.replace('roles: lead, checker\n', 'roles: lead, checker\n' + extra + '\n');
    const m = H.memFolder(OLD, fixture(t.tag)), existing = (await OLD.repo.loadAll(m)).processes[0].index.all.map(p => p.info);
    const res = await OLD.repo.publish(m, md, { people: G.PEOPLE, customTypes: { 'team.restore': OLD.types.customType(G.STEP_TYPE) }, workflows: {}, by: 'person-avery', changes: 'Minimum only', existing, now: AT });
    assert.ok(!res.blockers, extra + ': ' + res.blockers);
    assert.strictEqual(JSON.parse(res.files['publication.json']).format, 'preflight-publication/1');
    const mine = await NEW.repo.publish(H.memFolder(NEW, fixture(t.tag)), md, { people: G.PEOPLE, customTypes: { 'team.restore': NEW.types.customType(G.STEP_TYPE) }, workflows: {}, by: 'person-avery', changes: 'Minimum only', existing, now: AT });
    assert.ok(mine.blockers && mine.blockers.some(b => /Flightdeck 2\.0|newer Flightdeck/.test(b)), extra + ': this version refuses it');
  }
});

eachTag('Known: a plan whose version number is gone, or whose chosen folder is gone, starts on the latest and says so (forPlan falls back)', async (OLD, t) => {
  const proc = (await OLD.repo.loadAll(H.memFolder(OLD, fixture(t.tag)))).processes[0].index;
  const gone = OLD.publish.forPlan(proc, 9), folderGone = OLD.publish.forPlan(proc, 1, 'v1-gone0000');
  same([gone.pub.info.version, gone.missing, folderGone.pub.info.version, folderGone.missing], [1, true, 1, true]);
}, (t) => expects('plans', t.version));

eachTag('Known: a run/2 parent settles its step from a name-only preflight-run/3 child: done when it completed, blocked for carry: (2.0 never links one)', async (OLD) => {
  const CHILD = '---\nprocess: verify\ntitle: Verify\ncontext: ticket\n---\n\n## One {#one}\n- [ ] {confirm} Look {#look}\n';
  const PARENT = (carry) => '---\nprocess: parent\ntitle: Parent\ncontext: ticket\n---\n\n## One {#one}\n- [ ] {run.process} Verify the copy {#v}\n  process: verify\n' + (carry ? '  carry: ticket\n' : '');
  const verdict = async (carry) => {
    const m = H.memFolder(OLD, { 'people.json': JSON.stringify(G.PEOPLE) });
    for (const md of [CHILD, PARENT(carry)]) assert.ok(!(await OLD.repo.publish(m, md, { people: G.PEOPLE, customTypes: {}, workflows: {}, processes: ['verify', 'parent'], by: 'person-avery', changes: 'x', existing: [], now: AT })).blockers);
    const pub = (await OLD.repo.loadAll(m)).processes.map(p => p.index.latest).find(p => p.info.process === 'parent');
    const r = OLD.run.create(pub, { details: { ticket: 'ABC-1' }, by: 'person-avery', session: 's', now: AT, id: 'p1' }), map = OLD.run.mapOf(r), step = OLD.map.findStep(map, 'v').step;
    OLD.run.linkChild(r, map, 'v', { process: 'verify', id: 'c1', inputs: OLD.run.childDetails(r, step, Object.keys(r.details)) }, 'person-avery', AT);
    const child = OLD.run.sanitize({ format: 'preflight-run/3', id: 'c1', process: 'verify', title: 'Verify', version: 1, folder: 'v1-zzzz', state: 'completed', ended: { outcome: 'Completed', by: 'person-avery', at: AT }, details: { ticket: 'ABC-1' }, recorder: { person: 'person-avery' } });
    assert.ok(child && child._unrunnable && !Object.keys(child.details || {}).length, 'the child is name only');
    return OLD.run.childVerdict(r, step, r.steps.v, child);
  };
  assert.strictEqual((await verdict(false)).s, 'done', 'settled from the outcome alone');
  assert.ok(/has no ticket to carry/.test((await verdict(true)).reason));
}, (t) => !below(t.version));

eachTag('Known: a skill registration is matched to a version by number only, whatever folder has that number', async (OLD, t) => {
  const files = fixture(t.tag), d = await OLD.repo.loadAll(H.memFolder(OLD, files)), idx = d.processes[0].index;
  const s = OLD.skills.status(d.skills[0].skill, idx.all, idx.latest);
  assert.strictEqual(s.s, 'current');
  assert.ok(!('folder' in d.skills[0].skill) && !('implementsFolder' in d.skills[0].skill), 'no folder in the registration');
  // The same number in another folder (published elsewhere, a different checklist): still matched, nothing tells them apart.
  const moved = {}; Object.keys(files).forEach(p => { moved[p.replace(/v1-[a-z0-9]{8}/, 'v1-other000')] = files[p].replace(/v1-[a-z0-9]{8}/g, 'v1-other000'); });
  const d2 = await OLD.repo.loadAll(H.memFolder(OLD, moved)), idx2 = d2.processes[0].index;
  const s2 = OLD.skills.status(d2.skills[0].skill, idx2.all, idx2.latest);
  same([s2.s, s2.base.info.folder], ['current', 'v1-other000']);
});

eachTag('Known: people.json in a wrapper with a format and other fields keeps every field when this copy adds a person or marks one inactive', async (OLD) => {
  const P = OLD.people, doc = { format: 'flightdeck-people/1', note: 'kept', people: JSON.parse(JSON.stringify(G.PEOPLE)) };
  doc.people[0].future = { x: 1 };
  const added = P.add(doc, 'Morgan Diaz', 'morgan@example.com').doc, off = P.setActive(added, 'person-blake', false, 'person-avery').doc;
  same([off.format, off.note, off.people[0].future, off.people.length, !!off.people[1].inactive], ['flightdeck-people/1', 'kept', { x: 1 }, 4, true]);
  const m = H.memFolder(OLD, { 'people.json': JSON.stringify(doc) });
  assert.strictEqual((await OLD.repo.loadAll(m)).people.length, 3, 'read through the wrapper');
}, (t) => expects('people', t.version));

eachTag('Known: before the people writer (1.15), people.json in a wrapper is read through it, and nothing rewrites it', async (OLD) => {
  const m = H.memFolder(OLD, { 'people.json': JSON.stringify({ format: 'flightdeck-people/1', people: G.PEOPLE }) });
  assert.strictEqual((await OLD.repo.loadAll(m)).people.length, 3);
}, (t) => !expects('people', t.version));

/* READ/1 as 1.18 shipped it: its own command, its own engine, a folder on disk. */
eachTag('READ/1: its command names a run/3 newer (exit 4) and a plan/2 malformed, and never reads staged/, extensions/ or skill-registrations/', async (OLD, t) => {
  const b = H.bundles.get(t.tag), root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-read-'));
  fs.mkdirSync(path.join(root, 'bin')); fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'bin', 'flightdeck.js'), b.files['flightdeck.js']); fs.writeFileSync(path.join(root, 'dist', 'flightdeck.html'), b.files['flightdeck.html']);
  const put = (dir, files) => H.writeTree(dir, files);
  const read = (dir, ...a) => { const r = cp.spawnSync(process.execPath, [path.join(root, 'bin', 'flightdeck.js'), ...a, dir, '--json'], { encoding: 'utf8' }); return { code: r.status, json: JSON.parse(r.stdout || r.stderr) }; };
  try {
    const plain = path.join(root, 'plain'); put(plain, fixture(t.tag));
    const ok = read(plain, 'runs');
    assert.strictEqual(ok.code, 0, JSON.stringify(ok.json.problems));
    // Only 2.0 folders it never lists: still complete.
    const staged = path.join(root, 'staged'); put(staged, Object.assign(fixture(t.tag), { 'staged/backup/stage-aaaa1111/publication.json': '{"format":"preflight-publication/2"}', 'extensions/acme/extension.json': '{', 'skill-registrations/backup-report/a.1.w.json': '{' }));
    for (const cmd of ['processes', 'runs']) { const r = read(staged, cmd); assert.strictEqual(r.code, 0, cmd + ': ' + JSON.stringify(r.json.problems)); }
    // A run/3 and a plan/2 in the folders it reads.
    const newer = path.join(root, 'newer'), files = fixture(t.tag);
    files['runs/backup/run-a/run.json'] = asRun3(files['runs/backup/run-a/run.json']);
    files['proposals/plan-backup-pinned.json'] = JSON.stringify({ format: 'flightdeck-plan/2', id: 'plan-backup-pinned', process: 'backup', folder: 'v1-ab9ysnqh', title: 'Pinned' });
    put(newer, files);
    const r = read(newer, 'runs');
    assert.strictEqual(r.code, 4);
    const kinds = {}; r.json.problems.forEach(x => { kinds[x.path] = x.kind; });
    same([kinds['runs/backup/run-a/run.json'], kinds['proposals/plan-backup-pinned.json']], ['newer', 'malformed'], JSON.stringify(r.json.problems));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}, (t) => expects('read', t.version));

/* ---------- Older releases' own screens: saving and recovery against a newer run file ---------- */

/* An older release's app on its example folder, recording the release run in progress. */
async function recording(t) {
  const app = H.bootCopy(t.tag); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick();
  app.click('pickup'); await app.tick(40);
  return app;
}
const filesUnder = (app, dir) => { const o = {}; app.files(dir).sort().forEach(p => { o[p] = app.fs.files[p].t; }); return o; };

eachTag('In its app, a save that meets a preflight-run/3 on disk writes nothing; candidates and conflict copies already there stay byte for byte', async (OLD, t) => {
  const app = await recording(t), r = app.run(), dir = r.path.replace('run.json', '');
  assert.strictEqual(r.json.recorder.person, 'person-casey', 'set-up: recording');
  const map = app.PF.map.parse(r.json.snapshot);
  const id = (app.html().match(/data-act="toggle" data-id="[\w-]+"/g) || []).map(s => /data-id="([\w-]+)"/.exec(s)[1])
    .find(x => !(r.json.steps[x] && r.json.steps[x].s === 'done') && app.PF.map.findStep(map, x).step.type !== 'run.process' && app.PF.run.evidenceFor(r.json, app.PF.map.findStep(map, x).step).list.every(d => !d.required));
  // Another computer: a conflict copy and a candidate already there, then a 2.0 copy saves the run as preflight-run/3.
  app.fs.files[dir + 'run.conflict-w-other-1.json'] = { t: app.fs.files[r.path].t, m: Date.now() };
  app.fs.files[dir + 'candidate-w-other-aaaa1111.json'] = { t: '{"left":"by another window"}', m: Date.now() };
  app.fs.files[r.path] = { t: asRun3(app.fs.files[r.path].t), m: Date.now() };
  const before = filesUnder(app, dir);
  let saves = 0; const save = app.PF.repo.saveRun; app.PF.repo.saveRun = function () { saves++; return save.apply(this, arguments); };
  app.click('toggle', id); await app.tick(80);
  assert.ok(saves >= 1, 'set-up: the change was saved');
  same(filesUnder(app, dir), before, 'zero writes');
  if (!below(t.version)) assert.ok(/newer copy of Flightdeck/.test(app.html() + app.live()), 'and it says why');
});

eachTag('In its app, keeping a conflict copy that is preflight-run/3 is refused and changes nothing', async (OLD, t) => {
  const app = H.bootCopy(t.tag); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const r = app.run(), dir = r.path.replace('run.json', ''), name = 'run.conflict-w-other-2.json';
  app.fs.files[dir + name] = { t: asRun3(app.fs.files[r.path].t), m: Date.now() };
  app.click('refresh'); await app.tick(80);
  app.click('open-run', r.key); await app.tick(); app.click('pickup'); await app.tick(40);
  assert.ok(app.html().indexOf(name) >= 0, 'set-up: the copy is listed');
  const before = filesUnder(app, dir);
  app.click('use-copy', name); await app.tick(120);
  same(filesUnder(app, dir), before, 'nothing kept, replaced or removed');
  assert.ok(/newer copy of Flightdeck|can.t be read/.test(app.live() + app.html()), 'and it says why');
});

/* A step on the recorded run that a plain click answers (no evidence form, no child run). */
function plainStep(app, j) {
  const map = app.PF.map.parse(j.snapshot);
  return (app.html().match(/data-act="toggle" data-id="[\w-]+"/g) || []).map(x => /data-id="([\w-]+)"/.exec(x)[1])
    .find(x => !(j.steps[x] && j.steps[x].s === 'done') && app.PF.map.findStep(map, x).step.type !== 'run.process' && app.PF.run.evidenceFor(j, app.PF.map.findStep(map, x).step).list.every(d => !d.required));
}
const rowClass = (html, id) => { const i = html.indexOf('id="step-' + id + '"'); return i < 0 ? null : html.slice(html.lastIndexOf('<li', i), i); };

eachTag('In its app, a refused change is kept only in that window: on screen, never on disk or in browser storage, and leaving says nothing; moved to another folder, it goes to browser storage, and back here it can be discarded but not restored', async (OLD, t) => {
  const other = AH.folderHandle('Other', { 'people.json': '[]' });
  const app = H.bootCopy(t.tag, { picker: other, indexedDB: AH.memoryIDB() }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  let r = app.run(); app.click('open-run', r.key); await app.tick(); app.click('pickup'); await app.tick(40); r = app.run();
  const id = plainStep(app, r.json), done = new RegExp('"' + id + '"\\s*:\\s*\\{\\s*"s"\\s*:\\s*"done"');
  app.fs.files[r.path] = { t: asRun3(app.fs.files[r.path].t), m: Date.now() }; app.fs.persist();
  const folder = JSON.stringify(Object.keys(app.fs.files).sort().map(p => [p, app.fs.files[p].t]));
  app.click('toggle', id); await app.tick(80);
  same(JSON.stringify(Object.keys(app.fs.files).sort().map(p => [p, app.fs.files[p].t])), folder, 'nothing on disk');
  const kept = () => Object.keys(app.store).filter(k => k !== 'preflight:examples' && done.test(app.store[k])).concat(Object.keys(app.session).filter(k => done.test(app.session[k])));
  same(kept(), [], 'nothing in browser storage');
  assert.ok(!done.test(app.store['preflight:examples']), 'nor in the examples folder this browser keeps');
  assert.strictEqual(app.leaveWarns(), false, 'closing the tab doesn\'t warn');
  assert.ok(/data-a="done"/.test(rowClass(app.html(), id)), 'on screen, answered');
  app.click('refresh'); await app.tick(80);
  assert.ok(/data-a="done"/.test(rowClass(app.html(), id)), 'and still on screen after Refresh: a read never replaces an unsaved change');
  // Switching this window to another folder keeps its unsaved runs in browser storage, under the folder they belong to.
  app.click('connect'); await app.tick(200);
  const keys = kept();
  assert.ok(keys.length === 1 && /^preflight:unsaved:/.test(keys[0]), JSON.stringify(keys));
  // Back in the first folder (a new window on the same browser): the copy is listed but there's no Restore, and nothing is written.
  const b = H.bootCopy(t.tag, { localStore: Object.assign({}, app.store) }); await b.tick(80); b.choose('person-casey'); await b.tick();
  b.click('open-run', r.key); await b.tick(40);
  const snap = () => { const o = {}; Object.keys(b.fs.files).sort().forEach(p => { o[p] = b.fs.files[p].t; }); return o; };
  const page = b.html(), before = snap();
  assert.ok(!/data-act="restore-local"/.test(page), 'no Restore it here');
  if (below(t.version)) assert.ok(!/A copy kept in this browser/.test(page), 'below the floor the run isn\'t listed, so neither is the copy');
  else assert.ok(/newer copy of Flightdeck/.test(page) && /A copy kept in this browser/.test(page) && /data-act="discard-local"/.test(page), 'listed with Discard only');
  // Known: the action has no button here, but called anyway (1.11.1 on) it keeps "the version it replaces" first, which is the
  // name-only view of the run/3: a replaced-*.json in preflight-run/2 with no steps and no checklist. run.json is never touched.
  b.click('restore-local'); await b.tick(120);
  const after = snap(), changed = Object.keys(after).filter(p => after[p] !== before[p]);
  if (below(t.version)) { same(changed, [], 'below the floor: nothing'); return; }
  assert.strictEqual(changed.length, 1, JSON.stringify(changed));
  const rec = JSON.parse(after[changed[0]]);
  assert.ok(/\/replaced-[^/]+\.json$/.test(changed[0]) && rec.format === 'preflight-run/2' && !Object.keys(rec.steps).length && rec.snapshot === '', 'a name-only record');
  assert.strictEqual(after[r.path], before[r.path], 'run.json untouched');
  assert.ok(/newer copy of Flightdeck/.test(b.live()), 'and it says why');
});

eachTag('In its builder, a draft with 2.0 lines opens, and a builder edit saves only that change: every line it doesn\'t understand is kept as written', async (OLD, t) => {
  const app = H.bootCopy(t.tag); await app.tick(60); app.choose('person-casey'); await app.tick();
  const p = 'maps/drafts/release.md', lines = app.fs.files[p].t.split('\n');
  const ci = lines.findIndex(l => /^context:/.test(l)); lines[ci] += ', amount:number';
  const ph = lines.findIndex(l => /^## /.test(l) && !/Gate/i.test(l));
  lines.splice(ph + 1, 0, '  > A phase note from 2.0', '  ![Phase map](images/phase.png)');
  const st = lines.findIndex((l, i) => i > ph + 2 && /^- \[/.test(l));
  lines.splice(st, 0, '- [ ] {acme:change.request} An extension step {#ext}');
  const md = lines.join('\n'), NEW = [lines[ci], '  > A phase note from 2.0', '  ![Phase map](images/phase.png)', '- [ ] {acme:change.request} An extension step {#ext}'];
  app.fs.files[p] = { t: md, m: Date.now() };
  app.click('refresh'); await app.tick(80); app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  assert.ok(/class="ob" id="ob"/.test(app.html()), 'the builder opens it');
  const ids = (app.html().match(/data-ob-step="([\w-]+)"/g) || []).map(x => x.slice(14, -1)), id = ids.find(x => x !== 'ext');
  app.click('ob-move', id, { dir: 'down' }); await app.tick(); app.click('save-draft'); await app.tick(80);
  const saved = app.fs.files[p].t.split('\n');
  NEW.forEach(l => assert.ok(saved.indexOf(l) >= 0, 'kept: ' + l));
  const gone = md.split('\n').filter(l => saved.indexOf(l) < 0), added = saved.filter(l => md.split('\n').indexOf(l) < 0);
  same([gone, added], [[], []], 'a move changes no line, only their order');
  assert.notStrictEqual(saved.join('\n'), md, 'set-up: the move was saved');
}, (t) => expects('builder', t.version));

eachTag('In its step-type editor, a step type with a format envelope (with or without a 2.0 kind) is listed as broken, doesn\'t open, and is never saved over', async (OLD, t) => {
  for (const kind of ['number', null]) {
    const app = H.bootCopy(t.tag); await app.tick(60); app.choose('person-casey'); await app.tick();
    const f = 'step-types/change.request.json', def = JSON.parse(app.fs.files[f].t);
    const env = Object.assign({ format: 'flightdeck-step-type/2', features: kind ? ['typed-evidence'] : [], app: '2.0.0' }, def);
    if (kind) env.record = def.record.concat([{ name: 'rows', label: 'Rows', kind }]);
    const text = JSON.stringify(env, null, 2); app.fs.files[f] = { t: text, m: Date.now() };
    app.click('refresh'); await app.tick(80); app.click('nav', 'types'); await app.tick();
    assert.ok(/unknown field\(s\): format, features, app/.test(app.html()), (kind || 'envelope only') + ': listed with what it can\'t read');
    app.click('edit-type', 'change.request'); await app.tick(40);
    assert.ok(!/id="tf-label"/.test(app.html()) && /Fix the file/.test(app.live()), 'the editor doesn\'t open it');
    app.click('new-type'); await app.tick(); app.set('tf-id', 'change.request'); app.set('tf-label', 'Mine'); app.submit('type-form'); await app.tick(120);
    assert.strictEqual(app.fs.files[f].t, text, 'a new type with its ID is refused, never saved over it');
  }
}, (t) => expects('type-editor', t.version));

eachTag('In its Settings, people.json in a format envelope keeps the envelope and every unknown field when the owner adds a person and marks one inactive (no people editor before 1.15)', async (OLD, t) => {
  const people = [{ id: 'person-avery', name: 'Avery Lee', initials: 'AL', email: 'avery@example.com', folderRole: 'owner', future: { x: 1 } }, { id: 'person-blake', name: 'Blake Ortiz', initials: 'BO', email: 'blake@example.com' }];
  const text = JSON.stringify({ format: 'flightdeck-people/1', app: '2.0.0', note: 'kept', people }, null, 2), files = { 'people.json': text };
  const app = H.bootCopy(t.tag, { picker: AH.folderHandle('Team', files), indexedDB: AH.memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200); app.choose('person-avery'); await app.tick();
  app.click('nav', 'settings'); await app.tick();
  if (!expects('people', t.version)) { assert.ok(!/people-add-form/.test(app.html())); assert.strictEqual(files['people.json'], text); return; }
  app.input('pa-name', 'Casey Nguyen'); await app.tick(); app.submit('people-add-form'); await app.tick(200);
  app.click('people-active', 'person-blake', { on: '' }); await app.tick(200);
  const o = JSON.parse(files['people.json']);
  same([o.format, o.app, o.note, o.people.length, o.people[0].future, !!o.people[1].inactive], ['flightdeck-people/1', '2.0.0', 'kept', 3, { x: 1 }, true]);
});

eachTag('In its app, an archived migration record in a run\'s history is read back as a raw object, never shown, and its file is never changed by recording', async (OLD, t) => {
  const app = H.bootCopy(t.tag); await app.tick(60); app.choose('person-casey'); await app.tick();
  let r = app.run(); const hp = r.path.replace('run.json', 'history-w-twozero.jsonl');
  const mig = { kind: 'migration', av: 1, at: 'details.due', from: '03/04/2026', source: 'plan', verdict: 'ambiguous', result: null, resolved: { by: 'person-avery', at: '2026-10-18T10:00:00.000Z', value: '2026-04-03' } };
  const ans = { kind: 'answer', step: 'merge', s: 'done', by: 'person-avery', at: '2026-10-16T08:00:00.000Z' };
  const text = JSON.stringify(mig) + '\n' + JSON.stringify(ans) + '\n'; app.fs.files[hp] = { t: text, m: Date.now() };
  app.click('refresh'); await app.tick(80); app.click('open-run', r.key); await app.tick(); app.click('pickup'); await app.tick(40);
  app.click('load-history'); await app.tick(60);
  assert.ok(!/03\/04\/2026|2026-04-03/.test(app.html()), 'not shown');
  r = app.run(); const id = plainStep(app, r.json);
  app.click('toggle', id); await app.tick(80);
  assert.strictEqual(JSON.parse(app.fs.files[r.path].t).steps[id].s, 'done', 'set-up: recorded');
  assert.strictEqual(app.fs.files[hp].t, text, 'its file is untouched');
  const back = await OLD.repo.loadHistory(app.fs, { process: r.json.process, id: r.json.id });
  same(back.map(x => x.kind).sort(), ['answer', 'migration'], 'read back as it is, with no check of its kind or version');
  // Its "at" is a path, not a time: 1.17 on sorts it first, as a time it can't read; earlier releases leave it where it sorts as text.
  same(back.map(x => x.kind), at(t.version, '1.17.0') ? ['migration', 'answer'] : ['answer', 'migration']);
});

eachTag('In its app, a newer flightdeck.html in the team folder is announced from the head of the file', async (OLD, t) => {
  const files = { 'people.json': JSON.stringify(G.PEOPLE), 'flightdeck.html': '<!doctype html><meta name="flightdeck-version" content="9.9.9">' };
  const app = H.bootCopy(t.tag, { picker: AH.folderHandle('Team', files), indexedDB: AH.memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200); app.click('refresh'); await app.tick(100);
  assert.ok(/Flightdeck 9\.9\.9 is in the team folder/.test(app.top()));
  files['flightdeck.html'] = '<!doctype html><meta name="flightdeck-version" content="1.0.0">';
  app.click('refresh'); await app.tick(100);
  assert.ok(!/is in the team folder/.test(app.top()), 'an older one isn\'t');
});

run();
