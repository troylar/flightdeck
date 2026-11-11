// Review round 10 (BB), shared by the plain loop (app-loops) and the fulfilled spread (app-spreads): an approval write (Pass,
// Waive, a loop's approval) reads its loops' runs and their version again before every write, and recovery (keeping a
// conflict copy) asks the same. A story's run gone, or it or its version unreadable, while the write waits, with no Refresh
// in between, writes nothing and puts the tentative change back.
'use strict';
const { gate, boot, locks } = require('./app-harness');

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
/* Round 12 (FB): what coverage reads besides the runs: the loop's scope records, and the story's own to-do records (the
   application its living.head names). Each returns its undo, or null where the set-up has no such file (a story without
   to-dos has no application). */
const scopeFile = (app) => app.files('proposals/').filter(p => /\/req-[^/]*\.json$/.test(p)).find(p => { try { const j = JSON.parse(app.fs.files[p].t); return j.loop && j.loop.step === 'each'; } catch (e) { return false; } });
const headFile = (app, kid) => { try { const h = JSON.parse(app.fs.files[kid].t).living; return h && h.head ? 'proposals/' + h.head + '.json' : null; } catch (e) { return null; } };
const gone = (app, f) => { if (!f || !app.fs.files[f]) return null; const kept = app.fs.files[f]; delete app.fs.files[f]; return () => { app.fs.files[f] = kept; }; };
const eio = (app, f) => { if (!f || !app.fs.files[f]) return null; const read = app.fs.read; app.fs.read = (q, o) => q === f ? Promise.reject(new Error('EIO')) : read.call(app.fs, q, o); return () => { app.fs.read = read; }; };
const DEPS = {
  'a scope record absent': (app) => gone(app, scopeFile(app)),
  'a scope record EIO': (app) => eio(app, scopeFile(app)),
  'the story\'s application absent': (app, kid) => gone(app, headFile(app, kid)),
  'the story\'s application EIO': (app, kid) => eio(app, headFile(app, kid))
};
/* Round 13 (GA, GB): a scope record that arrives while the write waits (ABC-105 added), a conflicting copy of one there
   ("<id> (1).json" saying something else), and the run's own version gone or unreadable. */
const newScope = (app) => {
  const PF = app.PF, LP = PF.loop, r = parentRun(app);
  const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: r.id, step: 'each' }, changes: [{ op: 'add', item: { key: 'ABC-105', id: '10105' } }] }, 'ga-' + Math.random().toString(36).slice(2, 10), { name: 'release-helper', version: '1.0' });
  const f = LP.buildRequest(c.intent, { seen: [], children: [], now: new Date().toISOString(), app: '4.0.0', head: LP.headFor(r) });
  const path = 'proposals/' + f.id + '.json';
  app.fs.files[path] = { t: LP.text(f), m: Date.now() };
  return () => { delete app.fs.files[path]; };
};
const copyScope = (app) => {
  const f = scopeFile(app); if (!f) return null;
  const j = JSON.parse(app.fs.files[f].t); j.created = new Date(Date.now() + 5000).toISOString(); j.seen = []; if (Array.isArray(j.changes)) j.changes = [];
  if (j.observation && Array.isArray(j.observation.items)) j.observation.items = j.observation.items.slice(0, 1);
  const path = f.replace(/\.json$/, ' (1).json');
  app.fs.files[path] = { t: JSON.stringify(j, null, 2), m: Date.now() };
  return () => { delete app.fs.files[path]; };
};
const parentPub = (app) => { const r = parentRun(app); return 'publications/release-readiness/' + r.folder + '/publication.json'; };
const GA_GB = {
  'a new scope record': (app) => newScope(app),
  'a conflicting copy of a scope record': (app) => copyScope(app),
  'the run\'s publication absent': (app) => gone(app, parentPub(app)),
  'the run\'s publication EIO': (app) => eio(app, parentPub(app))
};
Object.assign(BREAKS, DEPS, GA_GB);
const RUN_BREAKS = ['the story\'s run absent', 'the story\'s run EIO', 'its publication EIO'];
/* Where the write waits: at its read of the parent, or once its candidate is written (before the final write). */
const WAITS = {
  'at the parent read': (fs0) => { const read = fs0.read, hold = gate(); let n = 0; fs0.read = (p, o) => PARENT_RE.test(p) && ++n === 1 ? hold.p.then(() => read.call(fs0, p, o)) : read.call(fs0, p, o); return { hold, seen: () => n, off: () => { fs0.read = read; } }; },
  'after the candidate': (fs0) => { const write = fs0.write, hold = gate(); let n = 0; fs0.write = (p, t, o) => CAND_RE.test(p) && ++n === 1 ? write.call(fs0, p, t, o).then((x) => hold.p.then(() => x)) : write.call(fs0, p, t, o); return { hold, seen: () => n, off: () => { fs0.write = write; } }; }
};
const gid = (app) => app.PF.run.mapOf(app.PF.run.sanitize(parentRun(app))).phases[0].gate.id;
const WRITES = {
  Pass: async (app) => { app.click('pass', '0'); },
  Waive: async (app) => { app.click('pick', gid(app), { kind: 'waive' }); await app.tick(); app.set('pick-input', 'Agreed with the team'); app.click('waive', '0'); },
  'loop approve': async (app) => { app.click('loop-approve', 'each'); },
  /* Round 11 (EB): a loop approval asked from the command line, carried out by the recorder's window on its next read. */
  'loop approve request': async (app) => { await requestApprove(app); app.click('refresh'); await app.tick(300); }
};
async function requestApprove(app) {
    const PF = app.PF, LP = PF.loop, r = parentRun(app);
    const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: r.id, step: 'each' }, changes: [{ op: 'approve', as: 'person-avery' }] }, 'eb-' + Math.random().toString(36).slice(2, 10), { name: 'release-helper', version: '1.0' });
    const d = await PF.repo.loadAll(app.fs, {}), V = LP.view(r, 'each', { records: d.scopes, runs: d.runs });
    const f = LP.buildRequest(c.intent, { seen: V.ledger.heads, children: [], now: new Date().toISOString(), app: '4.0.0', head: LP.headFor(r) });
    await app.fs.write('proposals/' + f.id + '.json', LP.text(f));
}
const approved = (app) => { const s = parentRun(app).steps.each; return !!s && s.s === 'done'; };

/* o.prep(): an app on the parent's screen with the loop's stories cleared (and fulfilled) and the loop not yet approved.
   o.kid(app): the path of a story's run.json. o.reread(app): read again until the screen is current. Returns what was off. */
async function matrix(o, only, breaks) {
  const off = [];
  let cases = 0;
  for (const how of Object.keys(WRITES).filter(h => !only || h === only)) for (const brk of breaks || RUN_BREAKS) for (const wait of Object.keys(WAITS)) {
    const tag = how + ', ' + brk + ', ' + wait;
    cases++;
    const app = await o.prep();
    if (!/^loop approve/.test(how)) { app.click('loop-approve', 'each'); await app.tick(250); }
    if (/^loop approve/.test(how) ? approved(app) : !approved(app) || !/data-act="pass"/.test(app.html())) { off.push(tag + ': set-up: not Ready ' + JSON.stringify([approved(app), /data-act="loop-approve"/.test(app.html()), /data-act="pass"/.test(app.html())])); continue; }
    const p = parentPath(app), before = app.fs.files[p].t;
    const w = WAITS[wait](app.fs);
    await WRITES[how](app); await app.tick(80);
    if (!w.seen()) { off.push(tag + ': set-up: the save never reached where it waits'); w.off(); continue; }
    const mid = files(app);
    const undo = BREAKS[brk](app, o.kid(app));
    if (!undo) { cases--; w.hold.open(); w.off(); await app.tick(300); continue; }
    w.hold.open(); await app.tick(500);
    if (app.fs.files[p].t !== before) off.push(tag + ': run.json written: ' + JSON.stringify([(JSON.parse(app.fs.files[p].t).gates || {})[gid(app)] || null, JSON.parse(app.fs.files[p].t).steps.each.s]));
    else if (files(app) !== mid) off.push(tag + ': something more was written');
    undo(); w.off();
    await o.reread(app);
    if (/id="pick-input"/.test(app.html())) { app.click('unpick'); await app.tick(); }
    let back = /data-act="pass"/.test(app.html());
    if (/^loop approve/.test(how)) { back = !approved(app); app.click('loop-approve', 'each'); await app.tick(250); back = back && approved(app); }
    if (!back) off.push(tag + ': read again, it isn\'t Ready (the tentative change wasn\'t put back)');
  }
  return { cases, off };
}

/* Use copy after Refresh has detected a story's run EIO: a conflict copy with the gate passed is not kept, the run and the
   folder are unchanged (no backup), and the copy stays. */
async function useCopyAfterEio(o, brk, noRefresh) {
  brk = brk || 'the story\'s run EIO';
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
  const undo = BREAKS[brk](app, o.kid(app));
  if (!undo) return ['set-up: no such file to break'];
  if (!noRefresh) await o.reread(app);
  const before = files(app);
  app.click('use-copy', 'run-OTHER.json'); await app.tick(500);
  const out = [];
  if (files(app) !== before) out.push('written: ' + JSON.stringify(app.files('runs/release-readiness/').filter(f => !JSON.parse(before).some(x => x[0] === f && x[1] === app.fs.files[f].t))));
  if (!app.fs.files[p.replace('run.json', 'run-OTHER.json')]) out.push('the copy was removed');
  undo();
  return out;
}

/* Round 13: Try again on a Pass whose first save failed (its candidate write refused), after brk: nothing written. */
async function retryAfter(o, brk) {
  const app = await o.prep();
  app.click('loop-approve', 'each'); await app.tick(250);
  const p = parentPath(app), before = app.fs.files[p].t, write = app.fs.write; let n = 0;
  app.fs.write = (q, t, x) => CAND_RE.test(q) && ++n === 1 ? Promise.reject(new Error('EIO')) : write.call(app.fs, q, t, x);
  app.click('pass', '0'); await app.tick(300);
  app.fs.write = write;
  if (!n || app.fs.files[p].t !== before) return ['set-up: the first save didn\'t fail'];
  if (!/data-act="retry-save"/.test(app.html())) return ['set-up: Try again isn\'t offered'];
  const undo = BREAKS[brk](app, o.kid(app)); if (!undo) return ['set-up: no such file to break'];
  app.click('retry-save'); await app.tick(500);
  const out = app.fs.files[p].t !== before ? ['written by Try again: ' + JSON.stringify((JSON.parse(app.fs.files[p].t).gates || {})[gid(app)] || null)] : [];
  undo();
  return out;
}
module.exports = { matrix, useCopyAfterEio, retryAfter, requestApprove, WRITES, DEPS, GA_GB: Object.keys(GA_GB) };

/* Review round 14 (HA, HB, HC): a generic suspension harness. Every approval-writing path (PATHS) is first run once,
   recording each read and listing inside its approval guard (from its read of the run to its proposals listing). Then,
   for every such read point and every input change (CHANGES), a fresh app is run again with that read paused, the input
   changed while it waits, and the read let go. Where the guard reads that input again at or after the paused point before
   its last write (so the change is one it can see), the cell must write nothing more, put the change back and keep any
   recovery source. Returns { cells, applicable, required, points, todo, off }: cells, every read point x change; todo, those where the
   guard reads that input again after the point (in the dry run); applicable, those run (HA_STRIDE); required, those where
   it did read the changed input after the change, which must write nothing more. */
const KID_RE = /^runs\/validate-story\/[^/]*\/run\.json$/;
const scopeFiles = (app) => app.files('proposals/').filter(p => /\/req-[^/]*\.json$/.test(p));
const identicalCopy = (app) => {
  const f = scopeFile(app); if (!f) return null;
  const path = f.replace(/\.json$/, ' (1).json');
  app.fs.files[path] = { t: app.fs.files[f].t, m: Date.now() };
  return () => { delete app.fs.files[path]; };
};
const changeTodo = (app, kid) => {
  const f = headFile(app, kid); if (!f || !app.fs.files[f]) return null;
  const j = JSON.parse(app.fs.files[f].t); j.note = 'changed while the approval waited';
  const kept = app.fs.files[f]; app.fs.files[f] = { t: JSON.stringify(j, null, 2), m: Date.now() };
  return () => { app.fs.files[f] = kept; };
};
const secondRun = (app, kid) => {
  const k = JSON.parse(app.fs.files[kid].t), id = 'run-hb' + Math.random().toString(36).slice(2, 8);
  k.id = id; const path = 'runs/validate-story/' + id + '/run.json';
  app.fs.files[path] = { t: JSON.stringify(k), m: Date.now() };
  return () => { delete app.fs.files[path]; };
};
/* HC: the run's version rebuilt in place, consistently, with one more mandatory step: it verifies, but it isn't the version
   the run is pinned to. */
const rebuiltPub = (app) => {
  const r = parentRun(app), base = 'publications/release-readiness/' + r.folder + '/', PF = app.PF;
  const md = app.fs.files[base + 'map.md'].t.replace(/\n$/, '') + '\n- [!] {confirm} Tell support {#ship2}\n';
  const people = JSON.parse(app.fs.files['people.json'].t);
  const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now: new Date().toISOString(), rand: r.folder.replace(/^v\d+-/, ''), app: '3.0.0' });
  if (b.blockers || b.folder !== r.folder) return null;
  /* Which of its files the rebuild changed (the others read the same as before): only a read of one of those sees it. */
  rebuiltPub.changed = Object.keys(b.files).filter(k => !app.fs.files[base + k] || app.fs.files[base + k].t !== b.files[k]);
  const kept = {}; Object.keys(b.files).forEach(k => { kept[k] = app.fs.files[base + k]; app.fs.files[base + k] = { t: b.files[k], m: Date.now() }; });
  return () => { Object.keys(kept).forEach(k => { if (kept[k]) app.fs.files[base + k] = kept[k]; else delete app.fs.files[base + k]; }); };
};
/* Round 15 (SA): the run handed to another session (its recorder changed, its revision bumped) by another window. */
const handedOff = (app) => {
  const p = parentPath(app), kept = app.fs.files[p], j = JSON.parse(kept.t);
  j.recorder = Object.assign({}, j.recorder, { session: 'other-window-sa' }); j.rev = (j.rev || 0) + 1; j.savedAt = new Date().toISOString(); j.savedBy = 'other-window-sa';
  app.fs.files[p] = { t: JSON.stringify(j, null, 2), m: Date.now() };
  return () => { app.fs.files[p] = kept; };
};
const isList = (op, p, dir) => op === 'list' && p.replace(/\/$/, '') === dir;
/* A read point by its role, the same in every app: the run, the story's run, the first scope record, the story's application. */
function namer(app, kid) {
  const rid = parentRun(app).id, kidDir = kid.replace(/\/run\.json$/, ''), first = scopeFile(app), head = headFile(app, kid);
  return (p) => {
    if (p === first) return 'proposals/<scope 1>';
    if (head && p === head) return 'proposals/<application>';
    if (/^proposals\/[^/]+$/.test(p)) return 'proposals/<' + (/\/req-/.test(p) ? 'scope' : 'record') + '>';
    return p.split(kidDir).join('runs/validate-story/<story>').split('/' + rid).join('/<run>').replace(/^runs\/validate-story\/(?!<story>)[^/]+/, 'runs/validate-story/<other>');
  };
}
const CHANGES = {
  'a new scope record': { make: (app) => newScope(app), sees: (op, p) => isList(op, p, 'proposals') },
  'a conflicting copy of a scope record': { make: (app) => copyScope(app), sees: (op, p) => isList(op, p, 'proposals') },
  'an identical copy of a scope record': { make: identicalCopy, sees: (op, p) => isList(op, p, 'proposals') },
  'a scope record absent': { make: (app) => gone(app, scopeFile(app)), sees: (op, p) => isList(op, p, 'proposals') || p === 'proposals/<scope 1>' },
  'a scope record EIO': { make: (app) => eio(app, scopeFile(app)), sees: (op, p) => op === 'read' && p === 'proposals/<scope 1>' },
  'the story\'s to-do changed': { make: changeTodo, sees: (op, p) => op === 'read' && p === 'proposals/<application>' },
  'the story\'s run absent': { make: (app, kid) => BREAKS['the story\'s run absent'](app, kid), sees: (op, p) => p === 'runs/validate-story/<story>/run.json' || isList(op, p, 'runs/validate-story/<story>') },
  'the story\'s run EIO': { make: (app, kid) => BREAKS['the story\'s run EIO'](app, kid), sees: (op, p) => op === 'read' && p === 'runs/validate-story/<story>/run.json' },
  'the story\'s version EIO': { make: (app) => BREAKS['its publication EIO'](app), sees: (op, p) => op === 'read' && /^publications\/validate-story\//.test(p) },
  'a second run for the story\'s attempt': { make: secondRun, sees: (op, p) => isList(op, p, 'runs/validate-story') },
  'the run\'s version absent': { make: (app) => gone(app, parentPub(app)), sees: (op, p) => op === 'read' && /^publications\/release-readiness\/[^/]+\/publication\.json$/.test(p) },
  'the run\'s version EIO': { make: (app) => eio(app, parentPub(app)), sees: (op, p) => op === 'read' && /^publications\/release-readiness\/[^/]+\/publication\.json$/.test(p) },
  'the run\'s version rebuilt with another step': { make: rebuiltPub, sees: (op, p) => op === 'read' && /^publications\/release-readiness\/[^/]+\//.test(p) && (rebuiltPub.changed || []).includes(p.replace(/^publications\/release-readiness\/[^/]+\//, '')) },
  'the run handed to another session': { make: handedOff, sees: (op, p) => op === 'read' && p === 'runs/release-readiness/<run>/run.json' },
  /* Round 15 (SB): who may approve can't be read. */
  'people.json EIO': { make: (app) => eio(app, 'people.json'), sees: (op, p) => op === 'read' && p === 'people.json' }
};
const localKeyOf = (app, id) => 'preflight:unsaved:' + app.fs.kind + ':' + (app.fs.id || app.fs.name) + ':' + id;
const failCand = (app) => { const write = app.fs.write; let n = 0; app.fs.write = (q, t, x) => CAND_RE.test(q) && ++n === 1 ? Promise.reject(new Error('EIO')) : write.call(app.fs, q, t, x); return { n: () => n, off: () => { app.fs.write = write; } }; };
/* Each path: disk(app, o) brings the prepared fixture to the click as far as the folder and browser storage go (it is done
   once, in the template), live(app) does what only the open window holds (Try again's failed save), and offered(app) says
   why the click isn't there, or ''. kept(app) is whether the recovery source is still there (true for the others). */
const READY = (app) => approved(app) && /data-act="pass"/.test(app.html()) ? '' : 'not Ready';
const approveLoop = async (app) => { app.click('loop-approve', 'each'); await app.tick(250); };
const passedCopy = async (app, o, local) => {
  await approveLoop(app);
  const p = parentPath(app), approvedText = app.fs.files[p].t;
  app.click('pass', '0'); await app.tick(250);
  const passed = parentRun(app);
  if (!passed.gates || !passed.gates[gid(app)] || passed.gates[gid(app)].s !== 'passed') return;
  await app.fs.write(p, approvedText);
  if (local) { await o.reread(app); app.store[localKeyOf(app, passed.id)] = JSON.stringify(passed); }
  else await app.fs.write(p.replace('run.json', 'run-OTHER.json'), JSON.stringify(passed));
  await o.reread(app);
};
const PATHS = {
  Pass: { disk: approveLoop, offered: READY, go: WRITES.Pass },
  Waive: { disk: approveLoop, offered: READY, go: WRITES.Waive },
  'loop approve': { offered: (app) => approved(app) ? 'already approved' : '', go: WRITES['loop approve'] },
  /* The request is written before the watch starts (its own folder read isn't the guard's); the click is the Refresh that
     makes the recorder carry it out. */
  'loop approve request': { offered: (app) => approved(app) ? 'already approved' : '', pre: (app) => requestApprove(app), go: async (app) => { app.click('refresh'); await app.tick(300); } },
  'Try again': {
    disk: approveLoop,
    live: async (app) => { const f = failCand(app); app.click('pass', '0'); await app.tick(300); f.off(); return f.n(); },
    offered: (app) => /data-act="retry-save"/.test(app.html()) ? '' : 'Try again not offered',
    go: async (app) => { app.click('retry-save'); }
  },
  'Use copy': {
    disk: (app, o) => passedCopy(app, o, false),
    offered: (app) => /data-act="use-copy"/.test(app.html()) ? '' : 'the copy isn\'t offered',
    go: async (app) => { app.click('use-copy', 'run-OTHER.json'); },
    kept: (app) => !!app.fs.files[parentPath(app).replace('run.json', 'run-OTHER.json')]
  },
  'Restore browser copy': {
    disk: (app, o) => passedCopy(app, o, true),
    offered: (app) => /data-act="restore-local"/.test(app.html()) ? '' : 'the browser copy isn\'t offered',
    go: async (app) => { app.click('restore-local'); },
    kept: (app) => !!app.store[localKeyOf(app, parentRun(app).id)]
  }
};
/* Inside the guard: from its read of the run (readRunOnly on the parent's process) until the next write or removal, or until
   its proposals read is done with none of its reads still under way. */
/* The guard's async context: its reads of runs and of proposals/ run inside it, and so does every step the guard chains on
   them (guarded: each callback runs inside it), so every read it makes after, in whatever helper, carries it. Nothing
   else does: a Refresh, a timer or the test itself started elsewhere never runs inside it. */
const GUARD = new (require('async_hooks').AsyncLocalStorage)();
const inGuard = (f) => f && ((x) => GUARD.run(true, () => f(x)));
const guarded = (p) => ({ then: (a, b) => guarded(p.then(inGuard(a), inGuard(b))), catch: (b) => guarded(p.then(null, inGuard(b))), finally: (f) => guarded(p.finally(f)) });
function guardWatch(app, name) {
  const R = app.PF.repo, ro = R.readRunOnly, rp = R.readPlans, fs0 = app.fs, read = fs0.read, list = fs0.list, write = fs0.write, remove = fs0.remove;
  const st = { on: false, win: 0, seen: Object.create(null), log: [], hook: null, ops: 0, busy: 0, plans: false, pass: 0 };
  /* Once its proposals read is done, the window stays open through the stability pass (round 15, SC): it closes at a write
     or removal, or once a later turn finds none of its reads under way. */
  const settle = () => { if (!(st.on && st.plans && !st.busy)) return; const win = st.win; setImmediate(() => { if (st.on && st.win === win && st.plans && !st.busy) st.on = false; }); };
  R.readRunOnly = function (fs, proc, id) { if (proc === 'release-readiness' && !st.on) { st.on = true; st.win++; st.plans = false; } const a = arguments; return st.on ? guarded(GUARD.run(true, () => ro.apply(this, a))) : ro.apply(this, a); };
  /* The window also closes once its proposals read is done and no read of it is still under way (a write-free last step). */
  R.readPlans = function () { const mine = st.on, a = arguments; const done = (x) => { if (mine) { st.plans = true; settle(); } return x; }; return (mine ? GUARD.run(true, () => rp.apply(this, a)) : rp.apply(this, a)).then(done, (e) => { done(); throw e; }); };
  const wrap = (op, real) => function (p) {
    const args = arguments;
    if (st.pass) return real.apply(fs0, args);
    st.ops++;
    /* The guard's own reads: issued from within its reads of runs and of proposals/ (their async context), never another
       read under way at the same time (a Refresh the recorder runs alongside). */
    if (!st.on || GUARD.getStore() !== true) return real.apply(fs0, args);
    const np = name(p), k = op + ' ' + np, n = st.seen[k] = (st.seen[k] || 0) + 1, at = { op, p: np, n, i: st.log.length, win: st.win, phase: st.plans ? 'stable' : 'snap' };
    st.log.push(at);
    const h = st.hook && st.hook(at);
    st.busy++;
    const end = (x) => { st.busy--; settle(); return x; };
    /* A paused read resumes through the folder as it is then (a change made meanwhile may sit above this watch). */
    const resume = () => { st.pass++; try { return fs0[op].apply(fs0, args); } finally { st.pass--; } };
    return (h ? h.then(resume) : real.apply(fs0, args)).then(end, (e) => { end(); throw e; });
  };
  fs0.read = wrap('read', read); fs0.list = wrap('list', list);
  fs0.write = function () { st.ops++; st.on = false; return write.apply(fs0, arguments); };
  fs0.remove = function () { st.ops++; st.on = false; return remove.apply(fs0, arguments); };
  return { st, off: () => { R.readRunOnly = ro; R.readPlans = rp; fs0.read = read; fs0.list = list; fs0.write = write; fs0.remove = remove; } };
}
/* Until the folder has been quiet for a while (no read, listing or write), at most about 1,500 turns. */
async function quiet(app, w) { let calm = 0; for (let i = 0; i < 60 && calm < 4; i++) { const n = w.st.ops; await app.tick(25); calm = w.st.ops === n ? calm + 1 : 0; } }
/* The fixture is prepared once, in a window with Web Locks (so its session is its own, kept in session storage); each cell
   then opens a copy of that window, as a reload does: the same files (copied), session, browser storage and page. */
/* APP_HTML=<file>: run the harness on another build (an earlier commit's dist/flightdeck.html), to show a change failing first. */
const otherHtml = () => (process.env.APP_HTML ? { html: require('fs').readFileSync(process.env.APP_HTML, 'utf8') } : {});
async function template(o, P) {
  const files = {}, session = {}, app = await o.prep(Object.assign({ sharedFiles: files, locks: locks(), sessionStore: session }, otherHtml()));
  if (P.disk) await P.disk(app, o);
  await app.tick(100);
  return { files: JSON.stringify(files), session: JSON.stringify(session), store: JSON.stringify(app.store), hash: app.hash() };
}
async function opened(t, P) {
  const app = boot(Object.assign({ sharedFiles: JSON.parse(t.files), locks: locks(), sessionStore: JSON.parse(t.session), localStore: JSON.parse(t.store), hash: t.hash }, otherHtml()));
  await app.tick(150);
  if (P.live && !(await P.live(app))) return { app, why: 'its first save didn\'t fail' };
  return { app, why: P.offered(app) };
}
async function suspension(o, how, changes, shard) {
  const P = PATHS[how], off = [];
  let cells = 0, applicable = 0, required = 0, limit = 0;
  const tpl = await template(o, P);
  /* The dry run: the read points, and that the write happens when nothing changes. */
  const { app: app0, why: why0 } = await opened(tpl, P);
  if (why0) return { cells, applicable, off: [how + ': set-up: ' + why0] };
  if (P.pre) await P.pre(app0);
  const p0 = parentPath(app0), before0 = app0.fs.files[p0].t, w0 = guardWatch(app0, namer(app0, o.kid(app0)));
  await P.go(app0); await quiet(app0, w0); w0.off();
  const points = w0.st.log.slice(), hasHead = !!headFile(app0, o.kid(app0));
  if (!points.length) return { cells, applicable, off: [how + ': set-up: no read inside the guard'] };
  if (app0.fs.files[p0].t === before0) off.push(how + ': with nothing changed, the approval wasn\'t written');
  /* The order the guard reads in: within each snapshot, nothing but the records it lists is read after proposals/ is listed. */
  for (let i = 0; i < points.length; i++) {
    if (points[i].op !== 'list' || points[i].p !== 'proposals') continue;
    for (let j = i + 1; j < points.length && points[j].win === points[i].win && points[j].phase === 'snap'; j++) if (!/^proposals\//.test(points[j].p)) { off.push(how + ': read after the proposals listing: ' + points[j].op + ' ' + points[j].p + ' #' + points[j].n); break; }
  }
  const todo = [];
  for (const ch of changes || Object.keys(CHANGES)) {
    if (ch === 'the story\'s to-do changed' && !hasHead) continue;
    /* Round 15 (SC): every read point, whether or not the guard reads that input again after it. */
    for (let k = 0; k < points.length; k++) { cells++; todo.push([ch, points[k]]); }
  }
  /* HA_STRIDE=n runs every n-th cell (a quick look); left out, every one runs. */
  const [si, sn] = shard || [0, 1], stride = Math.max(1, +(process.env.HA_STRIDE || 1)), picked = todo.filter((x, c) => c % stride === 0);
  for (let c = 0; c < picked.length; c++) {
    if (c % sn !== si) continue;
    const [ch, pt] = picked[c], C = CHANGES[ch];
    applicable++;
    const tag = [how, ch, 'at ' + pt.op + ' ' + pt.p + ' #' + pt.n].join(' · ');
    const { app, why } = await opened(tpl, P);
    if (why) { off.push(tag + ': set-up: ' + why); continue; }
    if (P.pre) await P.pre(app);
    const kid = o.kid(app), w = guardWatch(app, namer(app, kid)), hold = gate();
    let hit = false;
    w.st.hook = (at) => (at.op === pt.op && at.p === pt.p && at.n === pt.n && !hit ? (hit = true, hold.p) : null);
    await P.go(app); await app.tick(80);
    for (let t = 0; t < 40 && !hit; t++) await app.tick(50);
    if (!hit) { off.push(tag + ': set-up: never reached that read'); hold.open(); w.off(); continue; }
    /* Names as the folder was before the change: once a record is gone, "the first scope record" would be another one. */
    const nm = namer(app, kid);
    const undo = C.make(app, kid);
    if (!undo) { off.push(tag + ': set-up: the change couldn\'t be made'); hold.open(); w.off(); continue; }
    /* Watched from outside the change (an EIO answers before any read under it): a read of the changed input, inside the
       guard, from here on. */
    const inner = { read: app.fs.read, list: app.fs.list, write: app.fs.write, remove: app.fs.remove }, late = [];
    const saw = new Set();
    app.fs.read = function (q) { if (w.st.on && GUARD.getStore() === true && C.sees('read', nm(q))) saw.add(w.st.win); return inner.read.apply(app.fs, arguments); };
    app.fs.list = function (q) { if (w.st.on && GUARD.getStore() === true && C.sees('list', nm(q))) saw.add(w.st.win); return inner.list.apply(app.fs, arguments); };
    /* What is written or removed once the guard has read the change: none of it may be. A request the recorder couldn't
       carry out is answered (its decision, op 'refused'): that is its outcome, not a write. */
    app.fs.write = function (q, t) { if (!(/^proposals\//.test(q) && (() => { try { return JSON.parse(t).op === 'refused'; } catch (e) { return false; } })())) late.push({ q, win: w.st.win }); return inner.write.apply(app.fs, arguments); };
    app.fs.remove = function (q) { late.push({ q: '-' + q, win: w.st.win }); return inner.remove.apply(app.fs, arguments); };
    hold.open(); await quiet(app, w);
    Object.assign(app.fs, inner);
    /* Round 15 (SC): a change made while the snapshot reads (before its stability pass) always refuses, whether or not that
       input was read already. One made during the stability pass refuses when that pass rereads the input after the change
       (the paused read itself, or a later one); else it is the documented limit (docs/design.md), counted, not judged. */
    const names = (xs) => JSON.stringify(xs.map(x => x.q));
    if (pt.phase === 'stable' && !C.sees(pt.op, pt.p) && !saw.has(pt.win)) {
      /* The stated limit: this guard's write may land over the change, and what follows from it is that write's. */
      limit++;
      w.off(); undo(); continue;
    }
    required++;
    if (late.length) off.push(tag + ': written after the change' + (pt.phase === 'stable' ? ' (its stability pass reread it)' : ' (made before the stability pass)') + ': ' + names(late));
    else if (P.kept && !P.kept(app)) off.push(tag + ': the recovery source was removed');
    w.off(); undo();
  }
  return { cells, applicable, required, limit, points: points.length, todo: todo.length, off };
}
module.exports.suspension = suspension;
/* Round 15 (SD): the guard's first read never settles. Past the guard's deadline (waitMs, real time) the approval has
   refused: nothing written or removed, the click (or Try again) offered again, a recovery's source kept. The read then
   answers late, and still nothing is written. Returns what was off. */
async function stalled(o, how, waitMs) {
  const P = PATHS[how], tpl = await template(o, P), { app, why } = await opened(tpl, P);
  if (why) return [how + ': set-up: ' + why];
  if (P.pre) await P.pre(app);
  const w = guardWatch(app, namer(app, o.kid(app))), hold = gate(), late = [], off = [];
  let hit = false;
  w.st.hook = () => (!hit ? (hit = true, hold.p) : null);
  const write = app.fs.write, remove = app.fs.remove;
  app.fs.write = function (q) { if (hit) late.push(q); return write.apply(app.fs, arguments); };
  app.fs.remove = function (q) { if (hit) late.push('-' + q); return remove.apply(app.fs, arguments); };
  await P.go(app); await app.tick(80);
  for (let t = 0; t < 40 && !hit; t++) await app.tick(50);
  if (!hit) { hold.open(); w.off(); return [how + ': set-up: never reached the guard']; }
  await new Promise(res => setTimeout(res, waitMs)); await app.tick(100);
  if (late.length) off.push(how + ': written while the read hung: ' + JSON.stringify(late));
  const again = /data-act="(retry-save|pass|waive|loop-approve|use-copy|restore-local)"/.exec(app.html());
  if (!again) off.push(how + ': past the deadline, neither the click nor Try again is offered');
  if (P.kept && !P.kept(app)) off.push(how + ': the recovery source was removed');
  hold.open(); await quiet(app, w);
  if (late.length) off.push(how + ': written once the read answered late: ' + JSON.stringify(late));
  w.off();
  return off;
}
module.exports.stalled = stalled;
module.exports.HOLD_PATHS = Object.keys(PATHS);
module.exports.HOLD_CHANGES = Object.keys(CHANGES);
