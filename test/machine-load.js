// How busy this computer is right now, for the speed budgets (test/run.sh's quiet pass, test/harness.js's budget rules).
// A budget missed on a busy machine says little about the code, so the pass waits for a quiet moment and says what it found.
// It samples the CPUs over a second rather than reading the load average, which lags by minutes and would still count the
// test jobs that just ended.
//   node test/machine-load.js                   print one line, starting quiet: or busy:
//   node test/machine-load.js --wait <seconds>  the same, after waiting up to that long for a quiet moment
// PERF_BUSY: the share of all CPUs (percent) in use that counts as busy (25 by default: a third of them are
// slower cores on some computers, and the fast ones are full long before all of them are).
'use strict';
const os = require('os');

const LIMIT = () => { const n = Number(process.env.PERF_BUSY); return process.env.PERF_BUSY && n >= 0 ? n : 25; };
const times = () => os.cpus().reduce((t, c) => { Object.keys(c.times).forEach(k => { t.total += c.times[k]; if (k !== 'idle') t.busy += c.times[k]; }); return t; }, { busy: 0, total: 0 });
const pause = ms => new Promise(res => setTimeout(res, ms));

/* The share of all CPUs in use over the sample, with the load average and the CPU count. */
async function sample(ms) {
  const a = times();
  await pause(ms || 1000);
  const b = times(), total = b.total - a.total;
  return { busy: total > 0 ? Math.round((b.busy - a.busy) * 100 / total) : 0, load: os.loadavg()[0], cpus: os.cpus().length };
}
const say = s => s.busy + '% of ' + s.cpus + ' CPUs in use, load average ' + s.load.toFixed(1);
const isBusy = s => s.busy > LIMIT();

/* Samples until the machine is quiet or the wait is over; the last sample either way. */
async function waitQuiet(seconds) {
  const end = Date.now() + seconds * 1000;
  let s = await sample();
  while (isBusy(s) && Date.now() < end) { await pause(4000); s = await sample(); }
  return s;
}

if (require.main === module) {
  const at = process.argv.indexOf('--wait'), wait = at >= 0 ? Number(process.argv[at + 1]) || 0 : 0;
  waitQuiet(wait).then(s => { console.log((isBusy(s) ? 'busy' : 'quiet') + ': ' + say(s)); });
}

module.exports = { sample, say, isBusy, waitQuiet };
