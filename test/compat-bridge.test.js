// The 1.21 bridge against real older releases (docs/design.md section 28; the 2.0 plan's slice 1b and matrix A).
// test/fixtures/v2/folder/ holds one sample of every 2.0 family, frozen in 1.21 (tools/v2-samples.js). Laid over each release's
// own baseline folder, every release from 1.11.1 to 1.20.0 is checked to take the refusal path matrix A says it has today, with
// zero writes, and this version (the bridge) to refuse the same files precisely: named, with the Flightdeck each needs, read-only,
// never misread and never hidden. Then the probes (an unknown major and an unknown feature for every family) go through every
// real reader of this version, and READ/1 is compared with the tagged releases' own commands on the same folder.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const { rule, run } = require('./harness');
const H = require('./compat-harness');
const { expects } = require('./compat-matrix');
const G = require('../tools/old-folders');
const S = require('../tools/v2-samples');
const { cmp } = require('../tools/old-bundles');

const TAGS = H.bundles.tags();
const AT = '2026-10-20T12:00:00.000Z';
const below = (v) => cmp(v, H.bundles.FLOOR) < 0;
/* 1.21.0 is the bridge: it refuses what 2.0 writes the way this version does. */
const bridged = (v) => cmp(v, '1.21.0') >= 0;
const fixture = (tag) => H.readTree(path.join(G.DIR, tag));
const V2 = S.tree('folder');
const NEW_TOPS = ['staged/', 'extensions/', 'skill-registrations/', 'reports/', 'report-decisions/'];
const RUN3 = ['run-c', 'run-t', 'run-e'];
/* What this version reads since slice 2 part 2 (pins): exact skill registrations, plan/2 and its decisions, and the explicit
   2.0 run on a /1 version (run-e); since slice 3 (typed data) the typed version v2, its run run-c and the 2.0 step type.
   Everything else in the samples (stages, test runs) stays refused by name. */
const MAIN_TOPS = NEW_TOPS.filter(x => ['skill-registrations/', 'reports/', 'report-decisions/', 'staged/'].indexOf(x) < 0);
const snap = (m) => JSON.stringify(Object.keys(m.files).sort().map(p => [p, m.files[p].t]));
function eachTag(name, fn, filter) {
  TAGS.filter(filter || (() => true)).forEach((t) => rule(t.tag + (t.supported ? '' : ' (below the floor)') + ': ' + name, async () => {
    const PF = H.loadCopy(t.tag);
    if (!PF) return;
    await fn(PF, t);
  }));
}
/* Records every list, read, stat and blob while on. */
function watch(m) {
  const seen = [], on = { v: false };
  ['list', 'read', 'blob', 'stat'].forEach(k => { const o = m[k].bind(m); m[k] = (p, x) => { if (on.v) seen.push(String(p)); return o(p, x); }; });
  return { seen, on };
}
let mainFolder = null;
const mainFiles = async () => (mainFolder = mainFolder || await G.main());

/* ---------- Matrix A, "today": each release reading what 2.0 writes ---------- */

eachTag('reads the 2.0 samples as matrix A says: /2 unusable, run/3 name only, plan/2 and stage sign-offs not shown, 2.0 kinds broken, tombstones refused, new folders never listed; saving any of it writes nothing (2.0.0: as this version reads them)', async (OLD, t) => {
  if (t.major >= 2) return readsAsTwoZero(OLD, t);
  const m = H.memFolder(OLD, Object.assign(fixture(t.tag), V2)), w = watch(m);
  w.on.v = true; const d = await OLD.repo.loadAll(m, { deep: true }); w.on.v = false;
  const touched = w.seen.filter(p => NEW_TOPS.some(x => (p + '/').indexOf(x) === 0));
  assert.deepStrictEqual(touched, [], 'staged/, extensions/, skill-registrations/ and reports never listed or read by its loaders');
  const proc = d.processes.find(p => p.process === 'backup');
  const v2 = proc.pubs.find(x => x.folder === S.PUB2);
  if (below(t.version)) {
    // Below the floor (H7, with the real 2.0 sample): no format check and no check of the checklist's lines, so v2 is usable and the latest.
    assert.ok(v2 && v2.ok && proc.index.latest.info.version === 2, 'below the floor, the /2 version is offered as the latest');
  } else {
    assert.ok(v2 && !v2.ok && v2.unusable, 'v2 is unusable');
    assert.strictEqual(proc.index.latest.info.version, 1, 'v1 stays the latest');
  }
  const runs = Object.fromEntries(d.runs.map(r => [r.id, r]));
  if (below(t.version)) RUN3.forEach(id => assert.ok(!runs[id], id + ': below the floor, left out without a word'));
  else RUN3.forEach(id => assert.ok(runs[id] && runs[id]._unrunnable && !Object.keys(runs[id].steps).length, id + ': name only, read-only'));
  assert.ok(!runs['run-a']._unrunnable && !runs['run-b']._unrunnable, 'its own runs stay writable');
  if (expects('plans', t.version)) assert.ok(!d.plans.some(p => p.id === 'plan-backup-pinned'), 'plan/2 is never shown, so it never falls back to the latest');
  assert.ok(!d.validations.some(v => /stage/.test(v._file || '')), 'a stage sign-off isn\'t counted');
  assert.ok(!d.stepTypes.types['team.count'] && d.stepTypes.errors.some(e => e.file === 'team.count.json'), 'a 2.0 step type is listed broken');
  const sk = d.skills.find(s => (s.file || '') === 'release-notes.json' || (s.skill && s.skill.name === 'release-notes'));
  assert.ok(sk && sk.errors.length && (bridged(t.version) ? /skill-registrations\/ for Flightdeck 2\.0/ : /implements/).test(sk.errors.join(' ')), 'the tombstone is refused: ' + JSON.stringify(sk && sk.errors));
  const typed = OLD.map.check(OLD.map.parse(V2['maps/drafts/typed.md']), { people: G.PEOPLE, types: {} });
  assert.ok(typed.blockers.length, 'a 2.0 draft can\'t be published');
  if (expects('proposals', t.version)) assert.ok(OLD.proposals.cleanPresence(JSON.parse(V2['presence/w-twozero.json']), 'w-twozero.json'), 'presence with app is read (the field ignored)');
  if (expects('corrections', t.version)) { const n = runs['run-a']._notes.find(x => x.id === 'c-9'); assert.ok(n && n.change && n.change.op === 'describe', 'a cv: 2 correction is a Describe'); }
  // Zero writes: every save, record or step-type save this copy could try on a 2.0 file.
  const before = snap(m);
  for (const id of RUN3) if (runs[id]) await assert.rejects(() => OLD.repo.saveRun(m, runs[id], 'w-avery'));
  const def = JSON.parse(V2['step-types/team.count.json']);
  await assert.rejects(() => OLD.repo.saveStepType(m, def, OLD.util.hash(V2['step-types/team.count.json']), {}));
  assert.strictEqual(snap(m), before, 'nothing written');
});

eachTag('starting a run is refused on the /2 version (2.0.0: on the staged version; 2.1.0: an ordinary run there, while a test run starts), and a plan for it can\'t fall back (it\'s never listed)', async (OLD, t) => {
  const files = Object.assign(fixture(t.tag), V2), m = H.memFolder(OLD, files), stages = expects('staging', t.version);
  const two = t.major >= 2, b = two ? 'staged/backup/' + S.STAGE + '/' : 'publications/backup/' + S.PUB2 + '/', these = { 'publication.json': files[b + 'publication.json'], 'map.md': files[b + 'map.md'], 'types.json': files[b + 'types.json'] };
  // 2.1.0 checks a stage only with its exact bytes (without them it's still syncing): read as a version it's unusable, as a stage it reads.
  const exact = stages ? H.exact2(these['map.md'], these['types.json']) : undefined, v = OLD.publish.verify(two ? S.STAGE : S.PUB2, these, exact);
  assert.ok(!v.ok && v.unusable, v.why);
  const pub = (info) => ({ info, map: OLD.map.parse(files[b + 'map.md']), md: files[b + 'map.md'], types: JSON.parse(files[b + 'types.json']) });
  assert.throws(() => OLD.run.create(pub(v.info), { by: 'person-avery', session: 's', now: AT }));
  if (stages) {
    const st = OLD.publish.verify(S.STAGE, these, exact, { stage: true });
    assert.ok(st.ok, 'by the stage rules it reads: ' + st.why);
    assert.throws(() => OLD.run.create(pub(st.info), { by: 'person-avery', session: 's', now: AT }), /test runs only/, 'an ordinary run on the stage is refused');
    assert.strictEqual(OLD.run.create(pub(st.info), { test: true, by: 'person-avery', session: 's', now: AT }).test, true, 'a test run starts');
  }
  const before = snap(m); await OLD.repo.loadAll(m); assert.strictEqual(snap(m), before);
}, (t) => !below(t.version));

/* An accepted report is an ordinary answer plus a log line naming the report's SHA-256 (run.json gains no field): every
   release reads that run/2 in full and writable, and none of them lists reports/ or report-decisions/. */
eachTag('reads a run/2 whose step was checked from an accepted report in full and writable, keeps its log line, and never lists reports/', async (OLD, t) => {
  const NEW = H.loadMain(), files = fixture(t.tag), mn = H.memFolder(NEW, files);
  const d0 = await NEW.repo.loadAll(mn, { deep: true }), r = d0.runs.find(x => x.id === 'run-a');
  assert.ok(r && !r._unrunnable && !r.ended, 'run-a is open in ' + t.tag);
  const map = NEW.run.mapOf(r);
  const text = JSON.stringify({ format: 'flightdeck-report/1', run: 'backup/run-a', publication: { folder: r.folder }, step: 'read', verdict: 'pass', producer: { name: 'spec-tool', version: '1.0.0' }, created: AT, id: 'spec0001' }, null, 2) + '\n';
  mn.files['reports/backup/run-a.read.spec-tool.spec0001.json'] = { t: text, m: 1 };
  const g = (await NEW.repo.loadRunReports(mn, 'backup', 'run-a')).list[0], e = NEW.reports.eligible(g, r, map, { recording: true });
  assert.ok(e.ok, e.why);
  NEW.run.done(r, map, 'read', 'person-avery', AT, e.values, { exact: true });
  NEW.run.log(r, 'person-avery', AT, NEW.reports.logLine(g, g.sha256, 'Read the restore runbook'));
  await NEW.repo.saveRun(mn, r, r.recorder.session);
  const saved = JSON.parse(mn.files['runs/backup/run-a/run.json'].t);
  assert.strictEqual(saved.format, 'preflight-run/2', 'the lowest sufficient format');
  const after = H.filesOf(mn), m = H.memFolder(OLD, after), w = watch(m);
  w.on.v = true; const d = await OLD.repo.loadAll(m, { deep: true }); w.on.v = false;
  if (t.major >= 2) assert.ok(d.reports.files.some(f => f.name === 'run-a.read.spec-tool.spec0001.json'), '2.0.0 lists reports/ as its own');
  else assert.deepStrictEqual(w.seen.filter(p => /^report(s|-decisions)(\/|$)/.test(p)), [], 'never lists reports/');
  const old = d.runs.find(x => x.id === 'run-a');
  assert.ok(old && !old._unrunnable, 'writable: ' + (old && old._unrunnable));
  assert.strictEqual(old.steps.read.s, 'done');
  assert.ok(old.log.some(l => /^Accepted report spec-tool\/spec0001 sha256:[0-9a-f]{64} \(says pass\)/.test(l.what)));
  const before = mn.files['reports/backup/run-a.read.spec-tool.spec0001.json'].t;
  await OLD.repo.saveRun(m, old, old.recorder.session);
  assert.ok(JSON.parse(m.files['runs/backup/run-a/run.json'].t).log.some(l => /^Accepted report spec-tool\/spec0001/.test(l.what)), 'its own save keeps the line');
  assert.strictEqual(m.files['reports/backup/run-a.read.spec-tool.spec0001.json'].t, before, 'the report is never touched');
}, (t) => !below(t.version));

/* ---------- The bridge: this version reading the same folders ---------- */

/* How a 2.0 copy reads the 2.0 samples over release t's folder: what it builds (typed data, pins, reports) in full, and what
   only a later release builds (stages, test runs, stage sign-offs) refused by name, with nothing written. NEW: that copy's code
   (this version, or the tagged 2.0.0). */
async function readsAsTwoZero(NEW, t) {
  const m = H.memFolder(NEW, Object.assign(fixture(t.tag), V2)), w = watch(m);
  w.on.v = true; const d = await NEW.repo.loadAll(m, { deep: true }); w.on.v = false;
  assert.deepStrictEqual(w.seen.filter(p => MAIN_TOPS.some(x => (p + '/').indexOf(x) === 0)), [], 'new folders never listed by ordinary loaders');
  // Slice 2b: report names and decisions are listed, never a report's contents (read for the open run only).
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d.reports.files.map(f => f.name))), ['run-c.count.row-counter.k3m9p2q8.json']);
  assert.ok(d.repDecisions.length === 1 && d.repDecisions[0].status === 'declined' && !d.repUnread.length);
  const proc = d.processes.find(p => p.process === 'backup'), v2 = proc.pubs.find(x => x.folder === S.PUB2);
  // 2.1 slice 4: the sample stage is read as a stage, retired by its decision, and never a version to run.
  const sp = NEW.staging && d.stages.procs.backup, st = sp && sp.stages.find(x => x.folder === S.STAGE);
  if (NEW.staging) assert.ok(st && st.ok && NEW.staging.status(st, sp.decisions, proc.pubs).status === 'retired' && !proc.pubs.some(x => x.folder === S.STAGE), JSON.stringify(sp));
  /* Changed on purpose in slice 3: typed-details and typed-evidence are read here, so v2 and run-c are read in full. */
  assert.ok(v2.ok, v2.why);
  assert.strictEqual(proc.index.latest.info.version, 2);
  const runs = Object.fromEntries(d.runs.map(r => [r.id, r]));
  assert.ok(!runs['run-c']._unrunnable && !runs['run-c']._invalid && runs['run-c'].details.rows === '1234.5' && runs['run-c'].migrations.length === 1, 'run-c is read in full: ' + runs['run-c']._unrunnable);
  assert.ok(!runs['run-e']._unrunnable && runs['run-e'].format === 'preflight-run/3', 'the explicit 2.0 run on a /1 version is read in full: ' + runs['run-e']._unrunnable);
  /* 2.1 slice 5: this version reads the test run in full, on its stage; 2.0.0 lists it by name only. */
  const tests = !!(NEW.run && NEW.run.isTest), MAIN_RUN3 = tests ? [] : ['run-t'];
  if (tests) assert.ok(!runs['run-t']._unrunnable && NEW.run.isTest(runs['run-t']) && runs['run-t'].stage.folder === S.STAGE && Object.keys(runs['run-t'].steps).length, 'run-t is read in full: ' + runs['run-t']._unrunnable);
  else assert.ok(/^Test run · needs Flightdeck 2\.0\./.test(runs['run-t']._unrunnable) && runs['run-t']._test, runs['run-t']._unrunnable);
  MAIN_RUN3.forEach(id => assert.ok(!Object.keys(runs[id].steps).length && !Object.keys(runs[id].details).length, id + ': nothing it might misread'));
  const refused = Object.fromEntries(d.refused.map(r => [r.path, r]));
  /* 2.1 slice 6: this version reads the stage sign-off; 2.0.0 refuses it by name. */
  const signs = !!(NEW.skills && NEW.skills.stageSignoff), sv = 'validations/backup.' + S.STAGE + '.w-twozero.json';
  if (signs) assert.ok(!refused[sv] && d.validations.some(v => v.stage === S.STAGE && v._file === sv.split('/').pop()), 'the stage sign-off is read: ' + JSON.stringify(refused[sv]));
  else assert.ok(refused[sv] && refused[sv].kind === 'newer' && refused[sv].needs === '2.0', sv + ': ' + JSON.stringify(refused[sv]));
  ['proposals/plan-backup-pinned.json', 'proposals/plan-backup-pinned.status-w-twozero.json', 'skills/release-notes.json', 'step-types/team.count.json'].forEach(p => assert.ok(!refused[p], p + ' is read here'));
  const pinned = d.plans.find(p => p.id === 'plan-backup-pinned');
  assert.ok(pinned && pinned.format === 'flightdeck-plan/2' && (signs || !d.validations.some(v => /stage/.test(v._file))));
  assert.strictEqual(NEW.plans.pick({ latest: proc.index.latest, all: proc.index.all, clashes: proc.index.clashes, broken: proc.pubs.filter(x => !x.ok) }, pinned, null).pub.info.folder, 'v1-ab9ysnqh', 'a plan/2 starts on its pin');
  assert.ok(d.stepTypes.types['team.count'] && !d.stepTypes.errors.some(e => e.file === 'team.count.json'), 'the 2.0 step type is read');
  const notes = d.skills.filter(s => (s.skill && s.skill.name === 'release-notes') || s.file === 'release-notes.json');
  assert.ok(notes.length === 1 && notes[0].skill.regId === 'sk-aaaa1111', 'the tombstone and its registration are one skill: ' + JSON.stringify(notes.map(s => s.file)));
  ['typed', 'min-only', 'feature-only', 'min-plus-body'].forEach(n => assert.ok(NEW.map.check(NEW.map.parse(V2['maps/drafts/' + n + '.md']), { people: G.PEOPLE, types: {} }).blockers.some(b => /Flightdeck 2\.0|newer Flightdeck|needs/.test(b)) || n === 'typed', n));
  const before = snap(m);
  for (const id of MAIN_RUN3) await assert.rejects(() => NEW.repo.saveRun(m, runs[id], 'w-avery'), e => e.unrunnable);
  assert.strictEqual(snap(m), before, 'nothing written');
}

TAGS.forEach((t) => rule(t.tag + ' folder + 2.0 samples: this version refuses each 2.0 file it doesn\'t build by name, with the Flightdeck it needs, reads the typed data and pins it builds, and writes nothing', () => readsAsTwoZero(H.loadMain(), t)));

rule('Folder health names what a newer Flightdeck wrote, by family and the version each needs, the placeholder an old Restore left, and older copies seen lately', async () => {
  /* 2.1 reads every 2.0 sample, so a sign-off from a later Flightdeck (2.2) stands in for what it can't read. */
  const LATER = { 'validations/backup.v1.w-later.json': JSON.stringify({ format: 'flightdeck-validation/3', app: '2.2.0', process: 'backup' }) };
  const NEW = H.loadMain(), files = Object.assign(fixture('v1.18.0'), V2, LATER), m = H.memFolder(NEW, files);
  const d = await NEW.repo.loadAll(m, { deep: true }), scan = await NEW.repo.scan(m), now = Date.parse(AT);
  const conn = { probes: [{ app: '1.19.0', at: AT, writer: 'w-old', device: 'x', _file: 'a.json' }, { app: '1.10.0', at: AT, writer: 'w-older', device: 'y', _file: 'b.json' }, { app: '1.12.0', at: '2026-09-01T00:00:00.000Z', writer: 'w-gone', device: 'z', _file: 'c.json' }], acks: [] };
  const rep = NEW.health.check({ data: d, scan, me: 'person-avery', app: '1.21.0', connection: conn }, now);
  const newer = rep.issues.find(i => i.id === 'newer');
  assert.ok(newer, JSON.stringify(rep.issues.map(i => i.id)));
  ['1 sign-off needs Flightdeck 2.2']
    .forEach(x => assert.ok(newer.detail.indexOf(x) >= 0, x + ' in: ' + newer.detail));
  /* 2.1 slice 5: the frozen test run is read here, so it isn't named as newer. */
  ['test run', 'plan needs', 'plan decision needs', 'skill registration needs', 'v2 of backup', 'step type needs'].forEach(x => assert.ok(newer.detail.indexOf(x) < 0, x + ' isn\'t refused here: ' + newer.detail));
  d.refused.forEach(r => assert.ok(newer.paths.indexOf(r.path) >= 0, r.path));
  const ph = rep.issues.find(i => i.id === 'placeholder');
  assert.ok(ph && ph.paths.length === 1 && /replaced-w-old-/.test(ph.paths[0]) && /holds no answers/.test(ph.detail), JSON.stringify(ph));
  const old = rep.issues.find(i => i.id === 'older-copies');
  assert.ok(old && old.severity === 'warn' && /Flightdeck 1\.10\.0 and 1\.19\.0 answered/.test(old.detail) && /Flightdeck 1\.10\.0 can't tell/.test(old.detail) && !/1\.12\.0/.test(old.detail), old && old.detail);
  assert.strictEqual(old.help, 'teammates-on-an-older-flightdeck');
  const clean = NEW.health.check({ data: await NEW.repo.loadAll(H.memFolder(NEW, fixture('v1.18.0'))), scan: null, me: 'person-avery', app: '1.21.0', connection: { probes: [{ app: '1.21.0', at: AT, writer: 'w', device: 'x', _file: 'a.json' }], acks: [] } }, now);
  assert.ok(!clean.issues.some(i => i.id === 'newer' || i.id === 'older-copies') && clean.clear.some(c => c.id === 'older-copies'));
});

rule('A replaced-*.json an older copy\'s Restore left beside a run/3 is recognized by R.cleanCopy and never taken for a run, a copy to keep, or answers', async () => {
  const NEW = H.loadMain(), R = NEW.run, base = 'runs/backup/run-c/';
  const name = Object.keys(V2).find(p => p.indexOf(base + 'replaced-') === 0), o = JSON.parse(V2[name]);
  const cur = R.sanitize(JSON.parse(V2[base + 'run.json']));
  const c = R.cleanCopy(o, cur);
  assert.ok(c._placeholder && c._unrunnable === 'An older Flightdeck left this placeholder. It holds no answers.');
  assert.throws(() => R.adopt ? R.adopt(cur, c, 'person-avery', AT) : (() => { throw new Error(); })());
  assert.ok(!R.isPlaceholder(o, R.sanitize(JSON.parse(fixture('v1.18.0')['runs/backup/run-a/run.json']))), 'beside an ordinary run it\'s a real replaced copy');
  const col = await NEW.repo.collectEvidence(H.memFolder(NEW, Object.assign(fixture('v1.18.0'), V2)), { run: 'backup/run-c' }, { now: () => Date.parse(AT) });
  const f = col.files.find(x => x.path === name), r = col.files.find(x => x.path === base + 'run.json');
  assert.ok(f && f.role === 'leftover' && f.label === R.PLACEHOLDER, JSON.stringify(f));
  assert.ok(r && r.label === 'The run', JSON.stringify(r));
});

rule('Run archives go through R.cleanArchive: a migration record is kept and never shown, a newer one is refused and counted, never dropped silently', async () => {
  const NEW = H.loadMain(), files = Object.assign(fixture('v1.18.0'), V2, S.tree('probes/major'));
  const m = H.memFolder(NEW, files);
  const c = await NEW.repo.loadHistory(m, { process: 'backup', id: 'run-c' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.map(x => x.kind))), ['migration']); assert.strictEqual(c.refused.length, 0);
  const a = await NEW.repo.loadHistory(m, { process: 'backup', id: 'run-a' });
  assert.strictEqual(a.refused.length, 1); assert.ok(/newer Flightdeck/.test(a.refused[0].why) && a.refused[0].path === 'runs/backup/run-a/history-w-probe.jsonl');
  const f = await NEW.repo.loadHistory(H.memFolder(NEW, Object.assign(fixture('v1.18.0'), S.tree('probes/feature'))), { process: 'backup', id: 'run-a' });
  assert.strictEqual(f.refused.length, 1, 'an answer line with a feature this copy doesn\'t know is refused too');
});

rule('One malformed archive line is refused on its own: a kind or id that is not text (or names an Object method) never hides the valid records around it', async () => {
  const NEW = H.loadMain(), files = fixture('v1.18.0'), dir = 'runs/backup/run-a/';
  const good = { kind: 'answer', id: 'h-good', at: '2026-10-01T00:00:00.000Z', step: 's1', value: 'ok' };
  files[dir + 'history-w-bad.jsonl'] = [
    JSON.stringify({ kind: { toString: null }, id: 'h-1' }),
    JSON.stringify({ kind: 'answer', id: { toString: null } }),
    JSON.stringify({ kind: 'toString', id: 'h-2' }),
    JSON.stringify({ kind: 'constructor', id: 'h-3' }),
    JSON.stringify({ kind: 'log', id: 'constructor', at: '2026-10-01T00:00:01.000Z', what: 'kept' }),
    JSON.stringify(good)
  ].join('\n');
  const h = await NEW.repo.loadHistory(H.memFolder(NEW, files), { process: 'backup', id: 'run-a' });
  assert.ok(h.some(x => x.id === 'h-good'), 'the valid answer is kept');
  assert.ok(h.some(x => x.id === 'constructor'), 'an id that names an Object method is an ordinary id');
  assert.ok(!h.some(x => x.id === 'h-2' || x.id === 'h-3' || x.id === 'h-1'), 'unknown or non-text kinds are not shown');
  assert.strictEqual(h.refused.filter(r => r.path === dir + 'history-w-bad.jsonl').length, 4, JSON.stringify(h.refused));
});

/* ---------- Probes: an unknown major and an unknown feature, for every family, through every real reader ---------- */

const PROBE_SETS = ['major', 'feature'];
async function probeAll(kind) {
  const NEW = H.loadMain(), probes = S.tree('probes/' + kind), files = Object.assign({}, await mainFiles(), probes), m = H.memFolder(NEW, files);
  const d = await NEW.repo.loadAll(m, { deep: true });
  return { NEW, probes, files, m, d };
}
PROBE_SETS.forEach((kind) => rule('Probes (' + kind + '): every family\'s probe is refused and named by loadAll, Folder health, the run history and Evidence; nothing reads it as a record it knows, and nothing is written', async () => {
  const { NEW, probes, m, d } = await probeAll(kind), before = snap(m);
  const named = new Set(d.refused.map(r => r.path));
  d.fuUnread.concat(d.corrUnread).filter(u => u.kind === 'newer').forEach(u => named.add(u.dir + '/' + u.process + '/' + u._file));
  d.runs.filter(r => r._needs != null || (r._unrunnable && !Object.keys(r.steps).length)).forEach(r => named.add('runs/' + r.process + '/' + r.id + '/run.json'));
  d.processes.forEach(p => (p.pubs || []).filter(x => x.newer).forEach(x => named.add('publications/' + p.process + '/' + x.folder + '/publication.json')));
  if (d.failed.people) named.add('people.json');
  const pres = (d.presence || []).find(x => x.name === 'w-probe.json'); if (pres && !pres.rec) named.add('presence/w-probe.json');
  const h = await NEW.repo.loadHistory(m, { process: 'backup', id: 'run-a' }); h.refused.forEach(x => named.add(x.path));
  if (d.failed.people) assert.ok(/newer Flightdeck/.test(d.failed.people), d.failed.people);
  const bp = (((d.proposed || {}).procs || {}).backup || { bad: [] }).bad; bp.filter(b => /newer Flightdeck/.test(b.why)).forEach(b => named.add(b.path));
  // Folder health's scan names a newer installed.json; the editor history and connection check never use theirs (counted or left alone, as a newer version always was).
  const scan = await NEW.repo.scan(m), rep0 = NEW.health.check({ data: d, scan, me: 'person-avery', app: '1.21.0' }, Date.parse(AT));
  (rep0.issues.find(i => i.id === 'newer') || { paths: [] }).paths.forEach(p => named.add(p));
  const eh = await NEW.repo.loadEditHistory(m, 'history/drafts/backup', null);
  assert.ok(eh.bad >= 1 && !eh.items.some(x => x.entry && x.entry.id === 'h-probe'), 'an editor history line from a newer Flightdeck is counted, never used');
  named.add('history/drafts/backup/w-probe.jsonl');
  const cn = await NEW.repo.loadConnection(m, Date.parse(AT) + 1000);
  assert.ok(!cn.probes.some(x => x.writer === 'w-probe'), 'a connection check from a newer Flightdeck is left alone');
  named.add(Object.keys(probes).find(p => /^connection\//.test(p)));
  const missing = Object.keys(probes).filter(p => /\.(json|jsonl)$/.test(p) && !/types\.json$/.test(p) && !named.has(p));
  assert.deepStrictEqual(missing, [], 'every probe is named');
  // Nothing reads a probe as something it knows.
  assert.ok(!d.plans.some(p => p.id === 'plan-backup-probe') && !d.validations.some(v => /probe/.test(v._file)) && !d.fuDecisions.some(x => x.followUp === 'probe1') && !d.corrDecisions.some(x => x.group === 'gprobe00000001'));
  assert.ok(!d.stepTypes.types['team.probe'] && !d.skills.some(s => s.skill && s.skill.name === 'probe-skill'));
  assert.ok(!d.processes[0].index.all.some(p => p.info.folder === 'v3-yyyy3333'));
  // Folder health names each refused file.
  const rep = NEW.health.check({ data: d, scan: await NEW.repo.scan(m), me: 'person-avery', app: '1.21.0' }, Date.parse(AT));
  const newer = rep.issues.find(i => i.id === 'newer');
  d.refused.forEach(r => assert.ok(newer.paths.indexOf(r.path) >= 0, r.path + ' in Folder health'));
  // Evidence keeps the raw original whatever the verdict.
  const col = await NEW.repo.collectEvidence(m, { run: 'backup/run-a' }, { now: () => Date.parse(AT) });
  const hp = col.files.find(x => x.path === 'runs/backup/run-a/history-w-probe.jsonl');
  assert.ok(hp && hp.sha256 === require('crypto').createHash('sha256').update(probes['runs/backup/run-a/history-w-probe.jsonl']).digest('hex'), 'packed as it is');
  assert.strictEqual(snap(m), before, 'nothing written');
}));

/* READ through the shipped command: this version's, on disk. */
const ROOT = path.join(__dirname, '..');
function read(bin, dir, cmd, ...a) { const r = cp.spawnSync(process.execPath, [bin, cmd, dir, ...a, '--json'], { encoding: 'utf8' }); let j = null; try { j = JSON.parse(r.stdout || r.stderr); } catch (e) { j = { raw: r.stdout + r.stderr }; } return { code: r.status, json: j }; }
const kinds = (j) => { const k = {}; (j.problems || []).forEach(x => { k[x.path] = x.kind; }); return k; };
PROBE_SETS.forEach((kind) => rule('Probes (' + kind + ') through READ/1\'s six commands: every probe in READ\'s scope is named, never used, and the exit code says so', async () => {
  const { probes, files } = await probeAll(kind), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-probe-'));
  try {
    H.writeTree(dir, files);
    const bin = path.join(ROOT, 'bin', 'flightdeck.js');
    const all = {};
    for (const a of [['processes'], ['runs'], ['process', 'backup'], ['run', 'backup/run-a'], ['next', 'backup/run-a', '--as', 'person-avery'], ['followups']]) {
      const r = read(bin, dir, ...a);
      assert.ok(r.code === 4 || r.code === 0, a.join(' ') + ': ' + JSON.stringify(r.json).slice(0, 300));
      Object.assign(all, kinds(r.json));
    }
    // In READ/1's scope (1.18's): versions, runs, plans and their decisions, follow-up decisions.
    const scope = Object.keys(probes).filter(p => /^(publications\/.*publication\.json|runs\/[^/]+\/[^/]+\/run\.json|proposals\/|followups\/)/.test(p));
    scope.forEach(p => { const at = p.replace(/publication\.json$/, ''); assert.strictEqual(all[at], 'newer', at + ': ' + JSON.stringify(all)); });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}));

/* ---------- READ/1 parity with the tagged commands (1.18 on) ---------- */

TAGS.filter(t => expects('read', t.version)).forEach((t) => rule(t.tag + ': READ/1 parity on a folder with every 2.0 sample: the same files with the same kinds and exit codes, except plan/2 files (malformed there, newer here: the one encoded refinement)', async () => {
  const b = H.bundles.get(t.tag); if (!b) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-parity-'));
  try {
    fs.mkdirSync(path.join(root, 'bin')); fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'bin', 'flightdeck.js'), b.files['flightdeck.js']); fs.writeFileSync(path.join(root, 'dist', 'flightdeck.html'), b.files['flightdeck.html']);
    const dir = path.join(root, 'folder'); H.writeTree(dir, Object.assign(fixture(t.tag), V2));
    for (const a of [['processes'], ['runs'], ['process', 'backup'], ['run', 'backup/run-c'], ['followups']]) {
      const theirs = read(path.join(root, 'bin', 'flightdeck.js'), dir, ...a), mine = read(path.join(ROOT, 'bin', 'flightdeck.js'), dir, ...a);
      const tk = kinds(theirs.json), mk = kinds(mine.json), refine = (p) => /^proposals\//.test(p);
      assert.strictEqual(mine.code, theirs.code, a.join(' ') + ' exit code');
      assert.deepStrictEqual(Object.keys(mk).sort(), Object.keys(tk).sort(), a.join(' ') + ': the same files');
      Object.keys(tk).forEach(p => {
        if (refine(p)) { assert.strictEqual(tk[p], bridged(t.version) ? 'newer' : 'malformed', p); assert.strictEqual(mk[p], 'newer', p); }
        else assert.strictEqual(mk[p], tk[p], a.join(' ') + ' ' + p);
      });
      (mine.json.problems || []).filter(x => x.kind === 'newer').forEach(x => assert.ok(/Flightdeck 2\.[01]|newer Flightdeck/.test(x.why), x.path + ': ' + x.why));
    }
    // A folder whose only 2.0 files are in folders READ/1 never reads: complete, as the tag says.
    const only = path.join(root, 'only'), o = fixture(t.tag);
    Object.keys(V2).filter(p => NEW_TOPS.some(x => p.indexOf(x) === 0)).forEach(p => { o[p] = V2[p]; });
    H.writeTree(only, o);
    for (const a of [['processes'], ['runs']]) {
      assert.strictEqual(read(path.join(root, 'bin', 'flightdeck.js'), only, ...a).code, 0);
      assert.strictEqual(read(path.join(ROOT, 'bin', 'flightdeck.js'), only, ...a).code, 0, a.join(' ') + ': this version reads it complete too');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}));

/* ---------- Both directions: runs, with this version's real code ---------- */

eachTag('a run/2 this version writes in a folder with every 2.0 sample is recorded there and back, field by field', async (OLD, t) => {
  const NEW = H.loadMain(), m = H.memFolder(NEW, Object.assign(fixture(t.tag), V2));
  const a = (await NEW.repo.loadAll(m)).runs.find(r => r.id === 'run-a');
  a.recorder.session = 'w-avery'; NEW.run.done(a, NEW.run.mapOf(a), 'restore', 'person-blake', AT, { copy: 'scratch-2026-10' }); await NEW.repo.saveRun(m, a, 'w-avery');
  assert.strictEqual(JSON.parse(m.files['runs/backup/run-a/run.json'].t).format, 'preflight-run/2', 'lowest sufficient format');
  const om = H.memFolder(OLD, H.filesOf(m)), back = (await OLD.repo.loadAll(om)).runs.find(r => r.id === 'run-a');
  assert.ok(!back._unrunnable, t.tag + ' records it: ' + back._unrunnable);
  OLD.run.done(back, OLD.run.mapOf(back), 'where', 'person-blake', AT, { evidence: 'https://example.com/copies/2026-10' }); await OLD.repo.saveRun(om, back, 'w-avery');
  const again = (await NEW.repo.loadAll(H.memFolder(NEW, H.filesOf(om)))).runs.find(r => r.id === 'run-a');
  assert.deepStrictEqual(JSON.parse(JSON.stringify([again.steps.restore.values, again.steps.where.s])), [{ copy: 'scratch-2026-10' }, 'done']);
  assert.deepStrictEqual(NEW.util.drift(JSON.parse(om.files['runs/backup/run-a/run.json'].t), JSON.parse(JSON.stringify(NEW.run.sanitize(JSON.parse(om.files['runs/backup/run-a/run.json'].t)))), NEW.run.DRIFT_ALLOW).length, 0, 'nothing lost or changed reading it back');
}, (t) => !below(t.version));

run();
