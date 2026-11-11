// The generated race for the write paths slice 5 added (4.0, round 2): every write is under one guard, asked after every
// async read and right before every write. For one path (make: a fresh app with the path ready; act: the gesture), a dry
// run lists the async reads the path makes before its last write; then, for each of them in turn, a fresh app pauses that
// read, does one of: switch the person, switch the folder, mark the person inactive, make people.json unreadable, and
// releases it. Nothing the path writes may land after the pause, unless allowed (what a written decision already committed,
// attributed to whoever made it), and no version folder is left without its record.
'use strict';
const assert = require('assert');

const PERTS = ['person', 'folder', 'inactive', 'people'];
const READS = ['read', 'list', 'stat', 'blob'];

function instrument(fs) {
  const st = { armed: false, log: [], occ: Object.create(null), target: null, held: false, release: null, writes: [], paused: false };
  READS.forEach((m) => {
    if (typeof fs[m] !== 'function') return;
    const orig = fs[m].bind(fs);
    fs[m] = (p, o) => {
      if (!st.armed) return orig(p, o);
      const sig = m + ':' + p;
      st.occ[sig] = (st.occ[sig] || 0) + 1;
      st.log.push({ sig, n: st.occ[sig], writes: st.writes.length });
      if (st.target && !st.held && sig === st.target.sig && st.occ[sig] === st.target.n) {
        st.held = true;
        return new Promise((res, rej) => { st.release = () => { st.paused = false; orig(p, o).then(res, rej); }; st.paused = true; });
      }
      return orig(p, o);
    };
  });
  ['write', 'remove'].forEach((m) => {
    const orig = fs[m].bind(fs);
    fs[m] = (p, ...a) => { if (st.armed) st.writes.push({ m, p, afterPause: st.held }); return orig(p, ...a); };
  });
  return st;
}
const textOf = (fs, p) => (fs.files[p] ? (typeof fs.files[p].t === 'string' ? fs.files[p].t : '<blob>') : null);
const snapshot = (fs) => { const o = {}; Object.keys(fs.files).forEach((p) => { o[p] = textOf(fs, p); }); return o; };

async function perturb(app, how, ctx, was) {
  if (how === 'owner') { await ctx.transfer(was); return; }
  if (ctx.extra && ctx.extra[how]) { await ctx.extra[how](was); return; }
  if (how === 'person') { app.choose(ctx.other); return; }
  /* The switch is made once the window is on the other folder: a write that landed before that was before the switch. */
  /* A switch the window holds back (a dialog with something typed in it asks first) never happened: the case is skipped. */
  if (how === 'folder') { const said = () => /Examples reset\./.test(app.html() + app.live()); app.click('reset-examples'); for (let k = 0; k < 200 && !said(); k++) await app.tick(5); return said(); }
  const f = was.files['people.json'];
  if (how === 'people') { was.files['people.json'] = { t: '{ torn', m: Date.now() }; return; }
  const ppl = JSON.parse(f.t), list = Array.isArray(ppl) ? ppl : ppl.people;
  list.forEach((p) => { if (p.id === ctx.who) p.inactive = true; });
  was.files['people.json'] = { t: JSON.stringify(ppl), m: Date.now() };
}

/* One path's race. make() resolves to { app, act(), mine(path), who, other, allowed?(path, before, was), transfer?(fs) }. */
async function race(name, make, o) {
  o = o || {};
  const settle = o.settle || 400;
  const dry = await make(), dfs = dry.app.fs, ds = instrument(dfs);
  ds.armed = true; dry.act(); await dry.app.tick(settle); ds.armed = false;
  /* o.removes: the path's writes include removals (withdrawing a keep removes its record). */
  const mineW = (c) => (w) => (w.m === 'write' || (c.removes && w.m === 'remove')) && c.mine(w.p);
  const mineWrites = ds.writes.filter(mineW(dry));
  assert.ok(mineWrites.length, name + ': set-up: the path writes when nothing changes (reads: ' + ds.log.length + ')');
  /* The reads up to the path's last write: each is a step to pause. */
  const lastW = ds.writes.lastIndexOf(mineWrites[mineWrites.length - 1]) + 1;
  /* o.near: only the reads within that many before one of the path's writes (a path that starts with a whole folder read). */
  const writeAt = ds.writes.map((w, i) => (mineW(dry)(w) ? i + 1 : 0)).filter(Boolean);
  const all = ds.log.filter((x) => x.writes < lastW);
  const steps = o.near ? all.filter((x, i) => writeAt.some((w) => x.writes < w && all.slice(i + 1).filter((y) => y.writes < w).length < o.near)) : all;
  /* An ownership transfer (a valid newer version owned by someone else) is a fifth change where the path has an owner. */
  /* ctx.extra: changes of the path's own to another file ({ name: (fs) => ... }), raced like a transfer. */
  const extra = Object.keys(dry.extra || {});
  const perts = (dry.transfer ? PERTS.concat(['owner']) : PERTS).concat(extra);
  const cases = [];
  /* One read is always last before a write, and a folder can't check and write in one step: a change to another file made
     while that last read is in flight is the one window no guard closes. So at the guard's last read (people.json) an
     ownership transfer (another file) isn't asked; a change to that read's own file, the person or the folder still is. */
  const lastRead = (s, i) => (steps[i + 1] ? steps[i + 1].writes > s.writes : true) && /^read:people\.json$/.test(s.sig);
  /* A guard that depends on two files besides people.json reads one of them second to last: a change to the other (ctx.extra)
     made while that read is in flight is the same window one step earlier. The owner transfer is still asked there. */
  const nextIsLast = (i) => !!steps[i + 1] && steps[i + 1].writes === steps[i].writes && lastRead(steps[i + 1], i + 1);
  steps.forEach((s, i) => {
    const before = steps[i + 1] ? steps[i + 1].writes > s.writes : true;
    /* o.every: every change at every read (the full matrix), not one change in turn at reads before the last. */
    (before || o.every ? perts : [perts[i % perts.length]]).filter((how) => !((how === 'owner' || extra.indexOf(how) >= 0) && lastRead(s, i)) && !(extra.indexOf(how) >= 0 && nextIsLast(i))).forEach((how) => cases.push({ s, how }));
  });
  /* o.dry: only count the steps and cases (sizing a matrix). o.part [i, n]: only every nth case from the ith (a shard). */
  if (o.dry) return { steps: steps.length, cases: cases.length, ran: 0 };
  let ran = 0;
  /* RACE_CASE=<text>: only the cases whose label has it, while working on one. */
  const one = (c) => !process.env.RACE_CASE || (c.s.sig + ' #' + c.s.n + ' · ' + c.how).indexOf(process.env.RACE_CASE) >= 0;
  for (const c of (o.part ? cases.filter((x, i) => i % o.part[1] === o.part[0]) : cases).filter(one)) {
    const ctx = await make(), app = ctx.app, was = app.fs, st = instrument(was);
    st.target = { sig: c.s.sig, n: c.s.n }; st.armed = true;
    ctx.act();
    for (let k = 0; k < 40 && !st.paused && !st.held; k++) await app.tick(10);
    for (let k = 0; k < 40 && !st.paused; k++) await app.tick(10);
    if (!st.paused) { st.armed = false; continue; }
    ran++;
    const at = st.writes.length, before = snapshot(was);
    const made = await perturb(app, c.how, ctx, was);
    await app.tick(20);
    st.release();
    await app.tick(settle);
    st.armed = false;
    if (made === false) { ran--; continue; }
    const label = name + ' · paused ' + c.s.sig + ' #' + c.s.n + ' · ' + c.how;
    const landed = st.writes.slice(at).filter(mineW(ctx)).map((w) => w.p)
      .filter((p, i, a) => a.indexOf(p) === i && (textOf(was, p) !== null ? textOf(was, p) !== before[p] : before[p] != null))
      .filter((p) => !(ctx.allowed && ctx.allowed(p, before, was)));
    assert.deepStrictEqual(landed, [], label + ': written after the pause');
    /* A version or stage folder is whole or absent: never files without its record. */
    const dirs = {};
    Object.keys(was.files).forEach((p) => { const m = /^(publications|staged)\/[^/]+\/[^/]+\//.exec(p); if (m) (dirs[m[0]] = dirs[m[0]] || []).push(p); });
    Object.keys(dirs).forEach((d) => assert.ok(dirs[d].indexOf(d + 'publication.json') >= 0, label + ': ' + d + ' left without its record: ' + dirs[d].join(', ')));
  }
  assert.ok(ran >= Math.min(o.part ? cases.filter((x, i) => i % o.part[1] === o.part[0]).length : cases.length, 1), name + ': no step could be paused');
  return { steps: steps.length, cases: cases.length, ran };
}

module.exports = { race, PERTS };
