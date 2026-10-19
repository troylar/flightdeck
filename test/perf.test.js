// Large folders: what loading and refreshing a 2,000-run team folder costs, counted in folder calls so the numbers are the
// same on every computer. The ceilings are what 1.16 needed; they can only go down (docs/design.md section 25).
// PERF=big adds the 6,000-run profile. Times and memory are printed, not asserted, except where a budget says so.
'use strict';
const assert = require('assert');
const { load, loadViews, rule, run } = require('./harness');
const { bigFolder } = require('./big-folder');

/* Folder calls (list + read + stat + blob) measured with this harness on the seeded folder. 1.16.0 needed cold 32,611 /
   32,694 / 32,676 and routine 10,063 / 10,773 / 9,797; 1.17 slice 1a stopped stat'ing a notes file again after reading it
   (its size comes with the read). These are 1a's numbers: never raise them. Slice 1b lowers routine refreshes to the
   targets in docs/design.md section 25. */
const CEILING = {
  default: { cold: 29618, routine: 10063 },
  'recent-heavy': { cold: 29681, routine: 10773 },
  'old-heavy': { cold: 29672, routine: 9797 }
};
const PROFILES = Object.keys(CEILING).concat(process.env.PERF === 'big' ? ['6000'] : []);
const mb = n => (n / 1048576).toFixed(1) + ' MB';
const line = (name, fs) => name + ': ' + fs.total() + ' calls (list ' + fs.counts.list + ' · read ' + fs.counts.read + ' · stat ' + fs.counts.stat + ' · blob ' + fs.counts.blob + ')';

PROFILES.forEach(profile => {
  rule('Large folder (' + profile + '): a first open, a routine refresh and Refresh stay within their folder-call budgets', async () => {
    const PF = load(), fs = bigFolder(PF, { profile });
    let t = Date.now();
    const cold = await PF.repo.loadAll(fs), coldN = fs.total(), coldMs = Date.now() - t;
    console.log('  ' + profile + ' ' + line('cold', fs) + ', ' + coldMs + ' ms');
    assert.ok(cold.runs.length >= 1990, 'the runs load: ' + cold.runs.length);
    fs.reset(); t = Date.now();
    await PF.repo.loadAll(fs);
    const routineN = fs.total();
    console.log('  ' + profile + ' ' + line('routine', fs) + ', ' + (Date.now() - t) + ' ms');
    fs.reset();
    await PF.repo.loadAll(fs, { deep: true });
    console.log('  ' + profile + ' ' + line('deep', fs));
    if (CEILING[profile]) {
      assert.ok(coldN <= CEILING[profile].cold, 'cold ' + coldN + ' > ' + CEILING[profile].cold);
      assert.ok(routineN <= CEILING[profile].routine, 'routine ' + routineN + ' > ' + CEILING[profile].routine);
      assert.ok(fs.total() <= CEILING[profile].cold, 'Refresh reads everything, within the cold budget');
    }
  });
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

/* Search (docs/design.md section 22) on the 2,000-run folder: a build in 8 ms slices ≤ 400 ms of work, a query ≤ 30 ms at
   the 95th percentile, one run's update ≤ 5 ms, and the index's memory within its budget. */
const SEARCH = { buildMs: 400, queryP95Ms: 30, updateMs: 5, heapMB: 80 };
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
  assert.ok(docsMs + work <= SEARCH.buildMs, 'build ' + (docsMs + work).toFixed(0) + ' ms > ' + SEARCH.buildMs);
  assert.ok(p95 <= SEARCH.queryP95Ms, 'query p95 ' + p95.toFixed(1) + ' ms > ' + SEARCH.queryP95Ms);
  assert.ok(updateMs <= SEARCH.updateMs, 'update ' + updateMs.toFixed(2) + ' ms > ' + SEARCH.updateMs);
  assert.ok(!gc || heap <= SEARCH.heapMB * 1048576, 'index heap ' + mb(heap) + ' > ' + SEARCH.heapMB + ' MB');
});

rule('The big folder is the same, byte for byte, every time for a seed, and different for another seed', () => {
  const { generate } = require('../tools/big-folder');
  const a = generate(load(), { runs: 40, running: 5, recent: 5, seed: 5 }), b = generate(load(), { runs: 40, running: 5, recent: 5, seed: 5 });
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.notStrictEqual(JSON.stringify(generate(load(), { runs: 40, running: 5, recent: 5, seed: 6 }).files), JSON.stringify(a.files));
});

run();
