// Review round 10 (BB), shared by the plain loop (app-loops) and the fulfilled spread (app-spreads): an approval write (Pass,
// Waive, a loop's approval) reads its loops' runs and their version again before every write, and recovery (keeping a
// conflict copy) asks the same. A story's run gone, or it or its version unreadable, while the write waits, with no Refresh
// in between, writes nothing and puts the tentative change back.
'use strict';
const { gate } = require('./app-harness');

const PARENT_RE = /^runs\/release-readiness\/[^/]*\/run\.json$/;
const CAND_RE = /^runs\/release-readiness\/[^/]*\/candidate-/;
const parentPath = (app) => app.files('runs/release-readiness/').find(p => /run\.json$/.test(p));
const parentRun = (app) => JSON.parse(app.fs.files[parentPath(app)].t);
const files = (app) => JSON.stringify(app.files('runs/release-readiness/').map(f => [f, app.fs.files[f].t]));

const BREAKS = {
  'the story\'s run absent': (app, kid) => { const kept = app.fs.files[kid]; delete app.fs.files[kid]; return () => { app.fs.files[kid] = kept; }; },
  'the story\'s run EIO': (app, kid) => { const read = app.fs.read; app.fs.read = (q, o) => q === kid ? Promise.reject(new Error('EIO')) : read.call(app.fs, q, o); return () => { app.fs.read = read; }; },
  'its publication EIO': (app) => { const read = app.fs.read; app.fs.read = (q, o) => /^publications\/validate-story\//.test(q) ? Promise.reject(new Error('EIO')) : read.call(app.fs, q, o); return () => { app.fs.read = read; }; }
};
/* Where the write waits: at its read of the parent, or once its candidate is written (before the final write). */
const WAITS = {
  'at the parent read': (fs0) => { const read = fs0.read, hold = gate(); let n = 0; fs0.read = (p, o) => PARENT_RE.test(p) && ++n === 1 ? hold.p.then(() => read.call(fs0, p, o)) : read.call(fs0, p, o); return { hold, seen: () => n, off: () => { fs0.read = read; } }; },
  'after the candidate': (fs0) => { const write = fs0.write, hold = gate(); let n = 0; fs0.write = (p, t, o) => CAND_RE.test(p) && ++n === 1 ? write.call(fs0, p, t, o).then((x) => hold.p.then(() => x)) : write.call(fs0, p, t, o); return { hold, seen: () => n, off: () => { fs0.write = write; } }; }
};
const gid = (app) => app.PF.run.mapOf(app.PF.run.sanitize(parentRun(app))).phases[0].gate.id;
const WRITES = {
  Pass: async (app) => { app.click('pass', '0'); },
  Waive: async (app) => { app.click('pick', gid(app), { kind: 'waive' }); await app.tick(); app.set('pick-input', 'Agreed with the team'); app.click('waive', '0'); },
  'loop approve': async (app) => { app.click('loop-approve', 'each'); }
};
const approved = (app) => { const s = parentRun(app).steps.each; return !!s && s.s === 'done'; };

/* o.prep(): an app on the parent's screen with the loop's stories cleared (and fulfilled) and the loop not yet approved.
   o.kid(app): the path of a story's run.json. o.reread(app): read again until the screen is current. Returns what was off. */
async function matrix(o, only) {
  const off = [];
  let cases = 0;
  for (const how of Object.keys(WRITES).filter(h => !only || h === only)) for (const brk of Object.keys(BREAKS)) for (const wait of Object.keys(WAITS)) {
    const tag = how + ', ' + brk + ', ' + wait;
    cases++;
    const app = await o.prep();
    if (how !== 'loop approve') { app.click('loop-approve', 'each'); await app.tick(250); }
    if (how === 'loop approve' ? approved(app) : !approved(app) || !/data-act="pass"/.test(app.html())) { off.push(tag + ': set-up: not Ready ' + JSON.stringify([approved(app), /data-act="loop-approve"/.test(app.html()), /data-act="pass"/.test(app.html())])); continue; }
    const p = parentPath(app), before = app.fs.files[p].t;
    const w = WAITS[wait](app.fs);
    await WRITES[how](app); await app.tick(80);
    if (!w.seen()) { off.push(tag + ': set-up: the save never reached where it waits'); w.off(); continue; }
    const mid = files(app);
    const undo = BREAKS[brk](app, o.kid(app));
    w.hold.open(); await app.tick(500);
    if (app.fs.files[p].t !== before) off.push(tag + ': run.json written: ' + JSON.stringify([(JSON.parse(app.fs.files[p].t).gates || {})[gid(app)] || null, JSON.parse(app.fs.files[p].t).steps.each.s]));
    else if (files(app) !== mid) off.push(tag + ': something more was written');
    undo(); w.off();
    await o.reread(app);
    if (/id="pick-input"/.test(app.html())) { app.click('unpick'); await app.tick(); }
    let back = /data-act="pass"/.test(app.html());
    if (how === 'loop approve') { back = !approved(app); app.click('loop-approve', 'each'); await app.tick(250); back = back && approved(app); }
    if (!back) off.push(tag + ': read again, it isn\'t Ready (the tentative change wasn\'t put back)');
  }
  return { cases, off };
}

/* Use copy after Refresh has detected a story's run EIO: a conflict copy with the gate passed is not kept, the run and the
   folder are unchanged (no backup), and the copy stays. */
async function useCopyAfterEio(o) {
  const app = await o.prep();
  app.click('loop-approve', 'each'); await app.tick(250);
  const p = parentPath(app), approvedText = app.fs.files[p].t;
  app.click('pass', '0'); await app.tick(250);
  const passed = parentRun(app);
  if (!passed.gates || !passed.gates[gid(app)] || passed.gates[gid(app)].s !== 'passed') return ['set-up: the gate didn\'t pass'];
  await app.fs.write(p, approvedText);
  await app.fs.write(p.replace('run.json', 'run-OTHER.json'), JSON.stringify(passed));
  await o.reread(app);
  if (!/data-act="use-copy"/.test(app.html())) return ['set-up: the copy isn\'t offered'];
  const undo = BREAKS['the story\'s run EIO'](app, o.kid(app));
  await o.reread(app);
  const before = files(app);
  app.click('use-copy', 'run-OTHER.json'); await app.tick(500);
  const out = [];
  if (files(app) !== before) out.push('written: ' + JSON.stringify(app.files('runs/release-readiness/').filter(f => !JSON.parse(before).some(x => x[0] === f && x[1] === app.fs.files[f].t))));
  if (!app.fs.files[p.replace('run.json', 'run-OTHER.json')]) out.push('the copy was removed');
  undo();
  return out;
}

module.exports = { matrix, useCopyAfterEio, WRITES };
