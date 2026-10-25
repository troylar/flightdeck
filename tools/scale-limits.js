// Folder health's run-count limits, picked from what the browser gate measured (docs/design.md section 25).
// Input: { [runs]: { open, freeze } } for the worst workload at each size, at 4× CPU throttling. open is the summed duration of
// long tasks during a first open, freeze the longest task during a refresh, both in ms.
// Output: { warn, stop }, or { need: [sizes] } when another size has to be measured first, or { keep: true, warn, stop } when
// nothing qualifies and the limits stay as they are.
// Run: node tools/scale-limits.js results.json
'use strict';

const GRID = [2000, 4000, 6000, 8000, 10000], SMALL = [1000, 500];
const KEEP = { keep: true, warn: 500, stop: 2000 };
const WARN_OPEN = 30000, WARN_FREEZE = 150, STOP_FREEZE = 500;

const stopOk = r => r.freeze <= STOP_FREEZE;
const warnOk = r => r.open <= WARN_OPEN && r.freeze <= WARN_FREEZE;

/* The largest measured size passing ok, under a ceiling. Between two grid sizes where one passes and the next fails, the size
   halfway is measured once; nothing is interpolated, and nothing above what was measured is ever chosen. */
function largest(m, ok, below) {
  const sizes = Object.keys(m).map(Number).filter(s => s < below).sort((a, b) => a - b);
  let best = null;
  sizes.forEach(s => { if (ok(m[s])) best = s; });
  if (best == null) return { best: null };
  const g = GRID.indexOf(best);
  if (g >= 0 && g + 1 < GRID.length) {
    const next = GRID[g + 1], mid = (best + next) / 2;
    if (next < below && next in m && !ok(m[next]) && !(mid in m)) return { best, need: mid };
  }
  return { best };
}

function pick(m) {
  const need = [];
  const s = largest(m, stopOk, Infinity);
  if (s.best == null) return Object.assign({}, KEEP);
  if (s.need) need.push(s.need);
  const stop = s.best;
  const w = largest(m, warnOk, stop);
  if (w.best == null) {
    /* Nothing below stop qualifies: measure the smaller sizes, largest first, before deciding the limits stay. */
    const next = SMALL.filter(sz => sz < stop && !(sz in m))[0];
    if (next != null) need.push(next);
    else if (!need.length) return Object.assign({}, KEEP);
  } else if (w.need) need.push(w.need);
  if (need.length) return { need: need.sort((a, b) => a - b) };
  return { warn: w.best, stop };
}

module.exports = { pick, GRID, SMALL };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node tools/scale-limits.js results.json'); process.exit(2); }
  console.log(JSON.stringify(pick(JSON.parse(require('fs').readFileSync(file, 'utf8')))));
}
