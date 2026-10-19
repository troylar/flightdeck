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

rule('The big folder is the same, byte for byte, every time for a seed, and different for another seed', () => {
  const { generate } = require('../tools/big-folder');
  const a = generate(load(), { runs: 40, running: 5, recent: 5, seed: 5 }), b = generate(load(), { runs: 40, running: 5, recent: 5, seed: 5 });
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.notStrictEqual(JSON.stringify(generate(load(), { runs: 40, running: 5, recent: 5, seed: 6 }).files), JSON.stringify(a.files));
});

run();
