// A virtual clock for the app suites that wait on timers far more than they work: setTimeout, setInterval and Date, in this
// process and in every app it boots (which takes them from here), run on a clock that jumps to the next timer due once the
// current turn has nothing left to do, instead of waiting for it in real time. Timers still fire one at a time, in the order
// they come due (ties in the order they were set), each in the async context it was set in (so an AsyncLocalStorage a test
// watches sees what it would), with promises and setImmediate callbacks run in between; a zero delay still counts as 1 ms,
// as Node counts it, and Date moves with the clock. Time passes as on an idle computer: never faster or slower between two
// timers, only nobody waits for it. Required first, before the harness, by the files that opt in.
'use strict';
const { AsyncLocalStorage } = require('async_hooks');
/* REAL_CLOCK=1: the same files on real time, as before, to compare. */
if (!globalThis.__virtualClock && !process.env.REAL_CLOCK) {
  const RealDate = Date, realImmediate = setImmediate;
  /* A binary heap by due time, then by when each was set: a suite sets millions of timers, so each costs a few steps, never
     a sort of everything waiting. */
  const clock = { now: RealDate.now(), seq: 0 }, heap = [];
  let pumping = false, live = 0;
  const before = (a, b) => a.at < b.at || (a.at === b.at && a.seq < b.seq);
  const push = (t) => { heap.push(t); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!before(heap[i], heap[p])) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && before(heap[l], heap[m])) m = l; if (r < heap.length && before(heap[r], heap[m])) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; }
    }
    return top;
  };
  /* The next timer fires on a later turn, after this turn's promises and setImmediate callbacks. Timers keep the process
     alive only while one is referenced, as Node's do; while it is alive, unreferenced ones fire in their turn too. */
  const schedule = () => { if (!pumping && live > 0) { pumping = true; realImmediate(pump); } };
  const pump = () => {
    pumping = false;
    let t;
    do { t = heap.length ? pop() : null; } while (t && !t.queued);
    if (!t) return;
    if (t.at > clock.now) clock.now = t.at;
    if (t.every) { t.at = clock.now + t.every; t.seq = ++clock.seq; push(t); } else { t.queued = false; byId.delete(t.id); if (t._ref) live--; }
    schedule();
    t.scope(t.fn, ...t.args);
  };
  class Timer {
    constructor(fn, ms, args, every) {
      if (typeof fn !== 'function') throw new TypeError('The "callback" argument must be of type function');
      const d = Math.max(1, Math.floor(Number(ms)) || 0);
      this.fn = fn; this.args = args; this.at = clock.now + d; this.seq = ++clock.seq; this.every = every ? d : 0; this.delay = d;
      this.id = this.seq; this._ref = true; this.queued = false; this.scope = AsyncLocalStorage.snapshot();
    }
    ref() { if (!this._ref) { this._ref = true; if (this.queued) live++; schedule(); } return this; }
    unref() { if (this._ref) { this._ref = false; if (this.queued) live--; } return this; }
    hasRef() { return this._ref; }
    refresh() { const was = this.queued; clear(this); this.at = clock.now + this.delay; this.seq = ++clock.seq; if (was || !this.every) add(this); return this; }
    close() { clear(this); return this; }
    [Symbol.toPrimitive]() { return this.id; }
  }
  const byId = new Map();
  const add = (t) => { t.queued = true; if (t._ref) live++; byId.set(t.id, t); push(t); schedule(); return t; };
  /* A cleared timer leaves a bare marker in its place in the heap (never the timer itself, which would keep its callback and
     everything that callback holds alive), skipped when it comes up. */
  const clear = (t) => {
    const x = t instanceof Timer ? t : byId.get(+t);
    if (!x || !x.queued) return;
    x.queued = false; if (x._ref) live--; byId.delete(x.id);
    const i = heap.indexOf(x); if (i >= 0) heap[i] = { at: x.at, seq: x.seq, queued: false };
  };
  globalThis.setTimeout = function setTimeout(fn, ms, ...args) { return add(new Timer(fn, ms, args, false)); };
  globalThis.setInterval = function setInterval(fn, ms, ...args) { return add(new Timer(fn, ms, args, true)); };
  globalThis.clearTimeout = function clearTimeout(t) { clear(t); };
  globalThis.clearInterval = function clearInterval(t) { clear(t); };
  function VDate(...a) {
    if (!new.target) return new RealDate(clock.now).toString();
    return Reflect.construct(RealDate, a.length ? a : [clock.now], new.target);
  }
  VDate.prototype = RealDate.prototype;
  Object.setPrototypeOf(VDate, RealDate);
  VDate.now = () => clock.now;
  globalThis.Date = VDate;
  /* Every window booted (test/app-harness.js reports each): a rule's windows are closed when the rule ends (test/harness.js
     says when), as the tabs of a finished check would be, so none keeps polling through the rules after it. */
  const windows = new Set();
  let shut = 0;
  require('v8').setFlagsFromString('--expose-gc');
  const collect = require('vm').runInNewContext('gc');
  globalThis.__virtualClock = {
    now: () => clock.now, pending: () => live,
    opened: (app) => { windows.add(app); },
    /* Closed windows are garbage, made far faster than on real time; V8 collects it late and lets the heap grow to gigabytes
       per process (the live heap stays near 75 MB). A full collection every 25 closed windows keeps it near that. */
    closed: (app) => { windows.delete(app); if (++shut % 25 === 0) collect(); },
    ruleEnded: () => { windows.forEach(app => app.close()); windows.clear(); }
  };
}
module.exports = globalThis.__virtualClock || null;
