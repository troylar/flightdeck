// Large folders: what loading and refreshing a 2,000-run team folder costs, counted in folder calls so the numbers are the
// same on every computer. The ceilings are what 1.16 needed; they can only go down (docs/design.md section 25).
// PERF=big adds the 6,000-run profile. Times and memory are printed, not asserted, except where a budget says so.
'use strict';
const assert = require('assert');
const { load, loadViews, rule, run } = require('./harness');
const { bigFolder } = require('./big-folder');
const { NOW } = require('../tools/big-folder');

/* Folder calls (list + read + stat + blob) measured with this harness on the seeded folder. 1.16.0 needed cold 32,611 /
   32,694 / 32,676 and routine 10,063 / 10,773 / 9,797; slice 1a needed cold 29,618 / 29,681 / 29,672 with routine unchanged.
   Slice 1b reads sizes and times with the files themselves (no stat before or after a read) and checks runs on an
   elapsed-time schedule (docs/design.md section 25). A routine refresh is measured 30 seconds of elapsed time after the
   first open, on the generator's own date. The plan's target for recent-heavy was 2,000; its sum left out the 200
   publication lists and the old-run sweep, which the schedule keeps, so 2,268 is what checking every rule costs. These
   are 1b's numbers: never raise them. */
const CEILING = {
  default: { cold: 14638, routine: 1752 },
  'recent-heavy': { cold: 14640, routine: 2268 },
  'old-heavy': { cold: 14659, routine: 1345 }
};
/* The costliest single refresh over a 65-minute cycle on the default profile: the sweep is spread out, never all at once. */
const SWEEP_MOST = 1773;
const PROFILES = Object.keys(CEILING).concat(process.env.PERF === 'big' ? ['6000'] : []);
const mb = n => (n / 1048576).toFixed(1) + ' MB';
const line = (name, fs) => name + ': ' + fs.total() + ' calls (list ' + fs.counts.list + ' · read ' + fs.counts.read + ' · stat ' + fs.counts.stat + ' · blob ' + fs.counts.blob + ')';

PROFILES.forEach(profile => {
  rule('Large folder (' + profile + '): a first open, a routine refresh and Refresh stay within their folder-call budgets', async () => {
    const PF = load(), fs = bigFolder(PF, { profile });
    let now = 1000; const clock = () => now, wall = () => NOW + now;
    let t = Date.now();
    const cold = await PF.repo.loadAll(fs, { clock, now: wall() }), coldN = fs.total(), coldMs = Date.now() - t;
    console.log('  ' + profile + ' ' + line('cold', fs) + ', ' + coldMs + ' ms');
    assert.ok(cold.runs.length >= 1990, 'the runs load: ' + cold.runs.length);
    fs.reset(); t = Date.now(); now += 30000;
    await PF.repo.loadAll(fs, { clock, now: wall() });
    const routineN = fs.total();
    console.log('  ' + profile + ' ' + line('routine', fs) + ', ' + (Date.now() - t) + ' ms');
    fs.reset();
    await PF.repo.loadAll(fs, { deep: true, clock, now: wall() });
    console.log('  ' + profile + ' ' + line('deep', fs));
    if (CEILING[profile]) {
      assert.ok(coldN <= CEILING[profile].cold, 'cold ' + coldN + ' > ' + CEILING[profile].cold);
      assert.ok(routineN <= CEILING[profile].routine, 'routine ' + routineN + ' > ' + CEILING[profile].routine);
      assert.ok(fs.total() <= CEILING[profile].cold, 'Refresh reads everything, within the cold budget');
    }
  });
});

/* The schedule, over 65 minutes of elapsed time with a routine refresh every 30 seconds: every run's folder is looked at
   within 10 minutes, every finished run's file is read in full within 60, every running run's within 5, and no single
   refresh costs more than SWEEP_MOST (the sweep is spread out, never all at once). */
rule('Large folder: refreshing every 30 seconds checks every run within 10 minutes and reads each in full within its maximum age, a share at a time', async () => {
  const PF = load(), fs = bigFolder(PF, {});
  let now = 1000; const clock = () => now;
  const d = await PF.repo.loadAll(fs, { clock, now: NOW });
  const running = new Set(d.runs.filter(r => !r.ended).map(r => r.process + '/' + r.id));
  const keys = Object.keys(d.reads), seen = {}, read = {}, gapSeen = {}, gapRead = {};
  keys.forEach(k => { seen[k] = read[k] = now; gapSeen[k] = gapRead[k] = 0; });
  const list = fs.list.bind(fs), rd = fs.read.bind(fs);
  fs.list = p => { const m = /^runs\/([^/]+\/[^/]+)$/.exec(p); if (m && seen[m[1]] != null) { gapSeen[m[1]] = Math.max(gapSeen[m[1]], now - seen[m[1]]); seen[m[1]] = now; } return list(p); };
  fs.read = p => { const m = /^runs\/([^/]+\/[^/]+)\/run\.json$/.exec(p); if (m && read[m[1]] != null) { gapRead[m[1]] = Math.max(gapRead[m[1]], now - read[m[1]]); read[m[1]] = now; } return rd(p); };
  let most = 0, total = 0, passes = 0;
  for (now += 30000; now <= 1000 + 65 * 60000; now += 30000) {
    fs.reset(); await PF.repo.loadAll(fs, { clock, now: NOW + now }); most = Math.max(most, fs.total()); total += fs.total(); passes++;
  }
  const end = now - 30000;
  keys.forEach(k => { gapSeen[k] = Math.max(gapSeen[k], end - seen[k]); gapRead[k] = Math.max(gapRead[k], end - read[k]); });
  const worst = (g, f) => keys.filter(f).reduce((m, k) => Math.max(m, g[k]), 0) / 60000;
  console.log('  sweep: worst gap between checks ' + worst(gapSeen, () => true).toFixed(1) + ' min; between full reads ' + worst(gapRead, k => !running.has(k)).toFixed(1) + ' min finished, ' +
    worst(gapRead, k => running.has(k)).toFixed(1) + ' min running; ' + passes + ' refreshes, average ' + Math.round(total / passes) + ', most ' + most + ' calls');
  assert.ok(worst(gapSeen, () => true) <= 10, 'every run checked within 10 minutes');
  assert.ok(worst(gapRead, k => !running.has(k)) <= 60, 'every finished run read in full within 60 minutes');
  assert.ok(worst(gapRead, k => running.has(k)) <= 5, 'every running run read in full within 5 minutes');
  assert.ok(most <= SWEEP_MOST, 'no refresh in the cycle costs more than ' + SWEEP_MOST + ': ' + most);
});

rule('Large folder: the Runs page parses each checklist once and draws at most 100 cards, however many runs there are', async () => {
  const PF = loadViews(), fs = bigFolder(PF, {}), R = PF.run, V = PF.views;
  const mem0 = process.memoryUsage();
  const d = await PF.repo.loadAll(fs);
  const mem = process.memoryUsage();
  R.mapMemo.clear();
  const ctx = {
    state: { view: 'runs', me: 'person-avery', filter: 'all', unsaved: {}, saveErr: {}, fs: { kind: 'memory', name: 'x' }, missing: {} },
    data: Object.assign({}, d, { plans: [], legacy: [], unreadable: d.unreadable }), now: () => Date.now(), peopleById: Object.fromEntries(d.people.map(p => [p.id, p])),
    processTitle: id => id, processes: () => [], findRun: () => null, fuList: () => []
  };
  V.fuList = () => [];
  let t = process.hrtime.bigint();
  const html = V.runs(ctx);
  const renderMs = Number(process.hrtime.bigint() - t) / 1e6;
  const shown = (html.match(/data-act="open-run"/g) || []).length, parses = R.mapMemo.stats().parses;
  console.log('  Runs page: ' + shown + ' cards, ' + parses + ' parses, ' + renderMs.toFixed(0) + ' ms');
  assert.ok(shown <= 100, shown + ' cards');
  assert.ok(parses <= shown, 'at most one parse per card on a cold memo');
  t = process.hrtime.bigint();
  V.runs(ctx);
  assert.strictEqual(R.mapMemo.stats().parses, parses, 'drawing again parses nothing');
  console.log('  Runs page again: ' + (Number(process.hrtime.bigint() - t) / 1e6).toFixed(0) + ' ms');
  t = process.hrtime.bigint();
  d.runs.forEach(r => R.mapOf(r));
  console.log('  R.mapOf over ' + d.runs.length + ' runs: ' + (Number(process.hrtime.bigint() - t) / 1e6).toFixed(0) + ' ms, ' + R.mapMemo.stats().size + ' checklists kept');
  console.log('  memory for one load (this process also holds the generated folders): heap +' + mb(mem.heapUsed - mem0.heapUsed) + ', external ' + mb(mem.external) + ', arrayBuffers ' + mb(mem.arrayBuffers));
  assert.ok(renderMs <= 250, 'first Runs page in ' + renderMs.toFixed(0) + ' ms');
});

/* Insights (docs/design.md section 23) on the same folder: every process and version, then the worst case the plan budgets,
   one version of one process with 500 runs, on its longest checklist. Times are asserted here because the page draws them on
   every redraw of How runs go. */
const INSIGHTS_500_MS = 150, INSIGHTS_ALL_MS = 1000;
rule('Large folder: insights for every version of every process, and for one version with 500 runs within ' + INSIGHTS_500_MS + ' ms', async () => {
  const PF = load(), fs = bigFolder(PF, {}), I = PF.insights, R = PF.run;
  const d = await PF.repo.loadAll(fs, { now: NOW });
  const status = {}; Object.keys(d.reads).forEach(k => { if (d.reads[k].kind === 'unreadable') status[k] = 'unread'; });
  const input = { runs: d.runs, runStatus: status, followUps: PF.followups.list(d.runs, d.fuDecisions || []), corrections: [] };
  const pairs = [...new Set(d.runs.map(r => r.process + '|' + r.folder))].map(x => x.split('|'));
  R.mapMemo.clear();
  let t = process.hrtime.bigint(), counted = 0;
  pairs.forEach(([p, f]) => { counted += I.forProcess(input, p, { now: NOW, folder: f }).runs.n; });
  const allMs = Number(process.hrtime.bigint() - t) / 1e6;
  console.log('  insights: ' + pairs.length + ' versions, ' + counted + ' runs counted, ' + allMs.toFixed(0) + ' ms in all (' + (allMs / pairs.length).toFixed(2) + ' ms each)');
  assert.ok(counted >= d.runs.length - 10, 'every readable run lands in exactly one version: ' + counted);
  // The longest checklist with runs, its runs copied to 500 (new IDs), ended, half with a deviation archived to marks.
  const steps = r => PF.map.steps(R.mapOf(r)).length;
  const base = d.runs.filter(r => r.ended && !r._unrunnable && !status[r.process + '/' + r.id]).sort((a, b) => steps(b) - steps(a))[0];
  const many = Array.from({ length: 500 }, (_, i) => { const c = JSON.parse(JSON.stringify(base)); c.id = 'p' + i; c.snapshot = base.snapshot; c.types = base.types; if (i % 2) c.marks = { [Object.keys(c.steps)[0]]: ['blocked'] }; if (i % 7 === 0) delete c.marksFrom; return c; });
  const one = { runs: many, followUps: [], corrections: [] }, times = [];
  R.mapMemo.clear();
  for (let i = 0; i < 3; i++) { t = process.hrtime.bigint(); const res = I.forProcess(one, base.process, { now: NOW, folder: base.folder }); times.push(Number(process.hrtime.bigint() - t) / 1e6); assert.strictEqual(res.runs.n, 500); }
  console.log('  insights, one version, 500 runs, ' + steps(base) + ' steps: ' + times.map(x => x.toFixed(1)).join(' / ') + ' ms (first includes the parse)');
  assert.ok(times[0] <= INSIGHTS_500_MS, 'first: ' + times[0].toFixed(1) + ' ms');
  assert.ok(allMs <= INSIGHTS_ALL_MS, 'every version: ' + allMs.toFixed(0) + ' ms');
});

/* Search (docs/design.md section 22) on the 2,000-run folder: a build in 8 ms slices ≤ 400 ms of work, a query ≤ 30 ms at
   the 95th percentile, one run's update ≤ 5 ms, and the index's memory within its budget. */
const SEARCH = { buildMs: 400, queryP95Ms: 30, updateMs: 5, heapMB: 80, refreshMs: 20 };
/* The index's memory is measured after a full garbage collection, so the number is the index, not garbage. */
const gc = (() => { try { require('v8').setFlagsFromString('--expose-gc'); return require('vm').runInNewContext('gc'); } catch (e) { return null; } })();
rule('Large folder: search builds, answers and updates within its time and memory budgets', async () => {
  const PF = load(), fs = bigFolder(PF, {}), S = PF.search, now = () => Number(process.hrtime.bigint()) / 1e6;
  const d = await PF.repo.loadAll(fs);
  const input = { runs: d.runs, pubs: d.processes, drafts: d.drafts, people: d.people, stepTypes: d.stepTypes.types, skills: d.skills, corrDecisions: d.corrDecisions, followUps: PF.followups.list(d.runs, d.fuDecisions) };
  if (gc) gc();
  const heap0 = process.memoryUsage().heapUsed;
  let t = now();
  const sources = S.docs(input), docsMs = now() - t, ix = S.create(), job = S.start(ix, sources, input);
  let work = 0, slices = 0;
  while (!job.done) { t = now(); job.step(8, now); work += now() - t; slices++; }
  if (gc) gc();
  const heap = process.memoryUsage().heapUsed - heap0, size = S.size(ix);
  console.log('  search build: ' + sources.length + ' sources, ' + size.docs + ' documents, ' + size.words + ' words; sources ' + docsMs.toFixed(0) + ' ms, index ' + work.toFixed(0) + ' ms in ' + slices + ' slices; heap +' + mb(heap));
  const queries = ['deploy', 'deploy the', 'check the build', 'ABC-123', 'abc', 'avery', 'blake review', 'confirm', 'process 12', 'release notes', 'staging site', 'note', 'the', 'v3', 'archive the backup', 'restart queue', 'approve', 'dashboard', 'merge config', 'scan alerts', 'look at', 'phase 2', 'proc-1', 'verify', 'notify the', 'b', 'co', 'rec', 'compare', 'tag', 'jordan', 'quinn sage', 'folder health', 'jenkins', 'zzz-nothing'];
  const times = [];
  for (let round = 0; round < 3; round++) queries.forEach(q => { t = now(); S.query(ix, q, { context: { run: d.runs[5].process + '/' + d.runs[5].id } }); times.push(now() - t); });
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)], worst = times[times.length - 1];
  console.log('  search query: p50 ' + times[Math.floor(times.length / 2)].toFixed(1) + ' ms, p95 ' + p95.toFixed(1) + ' ms, worst ' + worst.toFixed(1) + ' ms over ' + times.length + ' queries');
  // One run's notes change (a note replaced, same count): only that run's sources are reindexed.
  const r = d.runs.find(x => x._notes && x._notes.length > 1);
  const r2 = Object.assign({}, r, { _notes: r._notes.map((n, i) => i === 0 ? Object.assign({}, n, { text: 'Zebracrossing was closed' }) : n) });
  const input2 = Object.assign({}, input, { runs: input.runs.map(x => x === r ? r2 : x) });
  t = now(); const sources2 = S.docs(input2), docs2Ms = now() - t;
  const changed = sources2.filter(s => { const c = ix.src[s.id]; return !c || c.sig !== s.sig; });
  t = now(); S.update(ix, changed, []); const updateMs = now() - t;
  t = now(); const again = S.sync(ix, S.docs(input2), input2); const syncMs = now() - t;
  console.log('  search update: ' + changed.length + ' sources changed, update ' + updateMs.toFixed(2) + ' ms; sources again ' + docs2Ms.toFixed(0) + ' ms; a full sync with nothing new ' + syncMs.toFixed(0) + ' ms');
  assert.strictEqual(changed.length, 1, 'only the replaced note changed');
  assert.strictEqual(again.changed + again.removed, 0, 'nothing else to do');
  assert.ok(S.query(ix, 'zebracrossing').total === 1, 'the new words are found');
  // The refresh path with the palette open: a routine reload, the runs the app keeps (a cached result whose signature
  // matches keeps the object on screen, as applyRunRead does), the follow-up list of the redraw, then sources and sync.
  const memo = {}, keyOf = r => r.process + '/' + r.id;
  S.sync(ix, S.docs(input, memo), input);
  let shown = d.runs; const refresh = [];
  for (let k = 0; k < 5; k++) {
    const d2 = await PF.repo.loadAll(fs), byKey = new Map(shown.map(r => [keyOf(r), r]));
    const runs2 = Object.keys(d2.reads).map(key => { const res = d2.reads[key], prev = byKey.get(key); return res.kind === 'cached' && prev && PF.repo.runSig(prev) === res.sig ? prev : res.kind === 'fresh' ? res.run : res.kind === 'cached' ? res.build() : prev; }).filter(Boolean);
    t = now();
    const in3 = { runs: runs2, pubs: d2.processes, drafts: d2.drafts, people: d2.people, stepTypes: d2.stepTypes.types, skills: d2.skills, corrDecisions: d2.corrDecisions, followUps: PF.followups.list(runs2, d2.fuDecisions) };
    const c = S.sync(ix, S.docs(in3, memo), in3);
    refresh.push(now() - t); shown = runs2;
    if (k === 0) console.log('  search on a routine refresh: ' + c.changed + ' sources changed, ' + c.removed + ' removed; ' + runs2.filter(r => byKey.get(keyOf(r)) === r).length + ' of ' + runs2.length + ' run objects kept');
  }
  refresh.sort((a, b) => a - b);
  const refreshMs = refresh[Math.floor(refresh.length / 2)];
  console.log('  search on a routine refresh with the palette open: median ' + refreshMs.toFixed(1) + ' ms, worst ' + refresh[refresh.length - 1].toFixed(1) + ' ms over ' + refresh.length);
  assert.ok(refreshMs <= SEARCH.refreshMs, 'refresh ' + refreshMs.toFixed(1) + ' ms > ' + SEARCH.refreshMs);
  assert.ok(docsMs + work <= SEARCH.buildMs, 'build ' + (docsMs + work).toFixed(0) + ' ms > ' + SEARCH.buildMs);
  assert.ok(p95 <= SEARCH.queryP95Ms, 'query p95 ' + p95.toFixed(1) + ' ms > ' + SEARCH.queryP95Ms);
  assert.ok(updateMs <= SEARCH.updateMs, 'update ' + updateMs.toFixed(2) + ' ms > ' + SEARCH.updateMs);
  assert.ok(!gc || heap <= SEARCH.heapMB * 1048576, 'index heap ' + mb(heap) + ' > ' + SEARCH.heapMB + ' MB');
});

/* Evidence export (docs/design.md section 24). The command line streams: a run with 50 MB of attachments takes at most 10 s,
   and what it holds in memory outside the JS heap (arrayBuffers, external) stays far below the pack's size, because
   attachments are hashed and copied 1 MB at a time and never kept. */
const EXPORT = { cliMs: 10000, cliArrayBuffersMB: 24, oneRunMs: 1500, oneRunCalls: 400 };
rule('Evidence export: the command line packs a run with 50 MB of attachments within 10 s, streaming, with memory reported', async () => {
  const EV = require('./evidence-fixture'), os = require('os'), nodeFs = require('fs'), path = require('path'), crypto = require('crypto');
  const files = Object.assign({}, (await EV.build(load())).files);
  for (let i = 0; i < 5; i++) files['runs/release/run1/files/20261017-big' + i + '-w2-dump.bin'] = crypto.randomBytes(10 * 1048576);
  const dir = EV.toDisk(files, nodeFs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-perf-'))), out = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-perf-out-'));
  Object.keys(files).forEach(k => { delete files[k]; });
  const cli = require('../bin/flightdeck.js'), KEYS = ['arrayBuffers', 'external', 'heapUsed'];
  const timed = async (sampleGc) => {
    const o = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-perf-out-'));
    if (gc) gc();
    const m0 = process.memoryUsage(), peak = {}; KEYS.forEach(k => { peak[k] = m0[k]; });
    /* With a collection before each sample, the peak is what the export holds, not garbage waiting to be collected. */
    const sample = setInterval(() => { if (sampleGc && gc) gc(); const m = process.memoryUsage(); KEYS.forEach(k => { peak[k] = Math.max(peak[k], m[k]); }); }, sampleGc ? 20 : 5);
    const t = Date.now(), r = await cli.main(['export', dir, '--run', 'release/run1', '--out', o, '--tz', 'UTC']), ms = Date.now() - t;
    clearInterval(sample);
    const grew = {}; KEYS.forEach(k => { grew[k] = peak[k] - m0[k]; });
    return { r, ms, grew, size: nodeFs.statSync(path.join(o, nodeFs.readdirSync(o)[0])).size };
  };
  const a = await timed(false), held = gc ? await timed(true) : null;
  const say = g => 'arrayBuffers +' + mb(g.arrayBuffers) + ', external +' + mb(g.external) + ', heap +' + mb(g.heapUsed);
  console.log('  export (command line): 50 MB of attachments, pack ' + mb(a.size) + ' in ' + a.ms + ' ms; peak with garbage: ' + say(a.grew) + (held ? '; held (collected before each sample): ' + say(held.grew) : ''));
  assert.strictEqual(a.r.code, 0, a.r.out);
  assert.ok(a.size > 50 * 1048576, 'every byte is in the pack');
  assert.ok(a.ms <= EXPORT.cliMs, a.ms + ' ms > ' + EXPORT.cliMs);
  if (held) assert.ok(held.grew.arrayBuffers <= EXPORT.cliArrayBuffersMB * 1048576 && held.grew.external <= EXPORT.cliArrayBuffersMB * 1048576, 'streams: held ' + say(held.grew));
});

rule('Evidence export on the 2,000-run folder: one run is collected with few folder calls, and a range past the byte cap is refused before any file is read', async () => {
  const PF = load(), fs = bigFolder(PF, {}), E = PF.evidence;
  const d = await PF.repo.loadAll(fs, { now: NOW });
  const r = d.runs.find(x => x.ended && x._notes && x._notes.length > 2 && !x._unrunnable);
  fs.reset();
  let t = Date.now(), bytes = 0;
  const res = await PF.repo.exportEvidence(fs, { run: r.process + '/' + r.id }, { sink: u => { bytes += u.length; }, attachments: false, tz: 'UTC', now: () => NOW, cap: E.capFor({ width: 1440 }) });
  const ms = Date.now() - t;
  console.log('  export (one run of 2,000, without attachments): ' + res.col.files.length + ' files, ' + mb(bytes) + ' in ' + ms + ' ms; ' + line('folder', fs));
  assert.strictEqual(res.status, 'complete', res.col.unresolved.join(' '));
  assert.ok(ms <= EXPORT.oneRunMs, ms + ' ms');
  assert.ok(fs.total() <= EXPORT.oneRunCalls, fs.total() + ' calls');
  // Virtual sizes: the estimate comes from listings and sizes alone, and a pack past the cap is refused before any read.
  const counts = {};
  d.runs.forEach(x => { counts[x.process] = (counts[x.process] || 0) + 1; });
  const proc = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0], scope = { process: proc, from: '2025-01-01', through: '2026-10-19', tz: 'UTC' };
  /* Records (run.json, notes, decisions) are read to decide what goes in, each sized first; attachments never are. */
  const readPaths = [], rd = fs.read.bind(fs), bl = fs.blob.bind(fs);
  fs.read = q => { readPaths.push(q); return rd(q); }; fs.blob = q => { readPaths.push(q); return bl(q); };
  fs.reset(); t = Date.now();
  const plan = await PF.repo.collectEvidence(fs, scope, { plan: true, cap: E.capFor({ width: 1440 }), now: () => NOW });
  console.log('  export estimate for ' + plan.runs.length + ' runs of ' + proc + ': about ' + mb(plan.estimate) + ' from ' + plan.files.length + ' files, ' + (Date.now() - t) + ' ms, ' + line('folder', fs));
  assert.deepStrictEqual(readPaths.filter(q => /\/files\//.test(q)), [], 'the estimate reads no attachment');
  fs.reset(); readPaths.length = 0;
  await assert.rejects(PF.repo.exportEvidence(fs, scope, { sink: () => {}, cap: Math.floor(plan.estimate / 2), now: () => NOW }), /over the .* limit here/);
  assert.deepStrictEqual(readPaths.filter(q => !/run\.json$/.test(q)), [], 'refused from sizes before any record but the runs\' start times is read');
});

rule('The big folder is the same, byte for byte, every time for a seed, and different for another seed', () => {
  const { generate } = require('../tools/big-folder');
  const a = generate(load(), { runs: 40, running: 5, recent: 5, seed: 5 }), b = generate(load(), { runs: 40, running: 5, recent: 5, seed: 5 });
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.notStrictEqual(JSON.stringify(generate(load(), { runs: 40, running: 5, recent: 5, seed: 6 }).files), JSON.stringify(a.files));
});


/* READ on the 2,000-run folder: what `flightdeck runs --json` costs, through the same engine function the command runs. It
   reads every file once (a deep load on a fresh cache), so it stays within the cold-open budget. */
rule('READ: runs --json on the 2,000-run folder reads within the cold-open budget, and its time is recorded', async () => {
  const PF = load(), fs = bigFolder(PF, {}), C = require('../bin/flightdeck.js');
  const t = Date.now(), r = await C.readData({ PF, version: 'perf' }, fs, { cmd: 'runs' }), ms = Date.now() - t;
  console.log('  READ runs --json: ' + r.json.data.runs.length + ' runs, ' + r.json.problems.length + ' problems, ' + ms + ' ms, ' + JSON.stringify(r.json).length + ' bytes; ' + line('folder', fs));
  assert.ok(r.json.data.runs.length >= 1990, 'the runs: ' + r.json.data.runs.length);
  assert.ok(fs.total() <= CEILING.default.cold, fs.total() + ' calls > ' + CEILING.default.cold);
  assert.strictEqual(r.json.complete, r.json.problems.length === 0);
});

/* ---------- 1.19 slice 1: proposals and presence (docs/design.md section 27) ---------- */
rule('Proposals: 50 in a big folder cost one list per process folder and one read each the first time, then only lists; verification of 2 MB stays quick', async () => {
  const PF = load(), fs = bigFolder(PF, {}), PP = PF.proposals, NOWP = '2026-10-19T14:00:00.000Z';
  const md = fs.files.get([...fs.files.keys()].find(p => /^publications\/.+\/map\.md$/.test(p) && fs.files.get(p).t)).t, proc = /process: (\S+)/.exec(md)[1];
  for (let i = 0; i < 50; i++) {
    const p = PP.make({ id: 'p-' + (100000 + i).toString(36) + '-aaaaaaaaaa', process: proc, session: 's-k3m9p2q8x7w1', label: 'assistant', by: 'person-avery', at: NOWP, app: '1.19.0', base: { kind: 'draft', ref: 'maps/drafts/' + proc + '.md', text: md }, text: md + '\n<!-- ' + i + ' -->\n', replaces: null, after: null, note: '' });
    fs._put('proposed/' + proc + '/' + p.id + '.json', { t: JSON.stringify(p), m: 1 });
  }
  fs._put('presence/w1.json', { t: JSON.stringify(PP.presence({ writer: 'w1', by: 'person-avery', device: 'D', since: NOWP, at: NOWP, beat: 1, drafts: [proc], main: [] })), m: 1 });
  let now = 1000; const clock = () => now;
  await PF.repo.loadAll(fs, { clock, now: Date.parse(NOW) });
  const cold = fs.by.proposed || {}, coldP = fs.by.presence || {};
  assert.deepStrictEqual([cold.list, cold.read], [2, 50], 'proposed/ and its one process folder listed, each proposal read once: ' + JSON.stringify(cold));
  assert.deepStrictEqual([coldP.list, coldP.read], [1, 1], JSON.stringify(coldP));
  fs.reset(); now += 30000;
  await PF.repo.loadAll(fs, { clock, now: Date.parse(NOW) });
  const routine = fs.by.proposed || {};
  assert.deepStrictEqual([routine.list, routine.read || 0], [2, 0], 'a routine refresh lists, and reads nothing it already verified: ' + JSON.stringify(routine));
  const big = '---\nprocess: release\n---\n' + 'x'.repeat(1048000);
  let t = Date.now();
  const p = PP.make({ id: 'p-a1-aaaaaaaaaa', process: 'release', session: 's-k3m9p2q8x7w1', label: 'assistant', by: 'person-avery', at: NOWP, app: '1.19.0', base: { kind: 'draft', ref: 'maps/drafts/release.md', text: big }, text: big + 'y', replaces: null, after: null, note: '' });
  const json = JSON.stringify(p);
  t = Date.now();
  const ok = PP.check(JSON.parse(json), p.id + '.json', 'release', Buffer.byteLength(json));
  const ms = Date.now() - t;
  console.log('  verifying a proposal with 2 MB of text: ' + ms + ' ms');
  assert.ok(ok.ok && ms < 2000, ms + ' ms');
});

rule('Review\'s comparison is capped: thousands of identical lines with a few changes are quick, and too many changes stop early', () => {
  const PF = loadViews(), PP = PF.proposals;
  const same = Array.from({ length: 20000 }, (x, i) => 'line ' + i), changed = same.slice();
  changed[100] = 'changed'; changed[15000] = 'also changed';
  let t = Date.now();
  const d = PP.diff(same.join('\n'), changed.join('\n'));
  const ms = Date.now() - t;
  console.log('  Review comparison, 20,000 lines with 2 changes: ' + ms + ' ms');
  assert.ok(!d.tooMany && d.rows.filter(r => r.op === '+' || r.op === '-').length === 4 && ms < 300, ms + ' ms');
  t = Date.now();
  const many = PP.diff(same.join('\n'), same.map(x => x + '!').join('\n'));
  console.log('  Review comparison, 20,000 lines all changed: ' + (Date.now() - t) + ' ms');
  assert.ok(many.tooMany && Date.now() - t < 1500);
});

run();
