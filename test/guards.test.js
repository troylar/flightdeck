// Round 20: the write-time guard is enforced where the bytes are written. The app installs its write gate on its own copy of
// repo, once, before it opens a folder; from then on repo's run writer (the candidate, run.json, a conflict copy, a retried
// start) and its scope writer refuse any write that doesn't hand over a token one of the app's guards made, right after a
// fresh check, for exactly that write: its kind, its path, the run and revision, the state the destination must be in
// (absent, or the fingerprint of the file it replaces) and the SHA-256 of its bytes. However a write is reached (an alias, a
// wrapper, a property, a Proxy of the folder, an object made from it at any depth, a token made by hand or taken from another
// write), in the test build (FLIGHTDECK_STRICT_GUARDS) it throws or is refused, and nothing is written.
//
// The writers, for reference (documentation only; nothing here depends on the list): save() (every mutateRun, so every
// loopEdit, X, Reopen, Hand off, Try again: the ordinary fresh guard unless the change names its own), loopLaunch (a story's
// run), launchChild, continueTwo, the start form, resumeStart and startTestRun (new runs: the fresh guard with a create key,
// the destination absent), and scopeSave (every scope and to-do record, a carried-out request's outcome included).
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

async function opened(html) {
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, html ? { html } : {}));
  await app.tick(80); app.choose('person-avery'); await app.tick(80);
  return app;
}
/* A run in the opened folder, read as the app reads one (its fingerprint set). */
function aRun(app, pick) {
  const p = app.files('runs/').filter(f => /\/run\.json$/.test(f)).find(f => !pick || pick(f)) ;
  const r = app.PF.run.sanitize(JSON.parse(app.fs.files[p].t));
  r._fileHash = app.PF.repo.fileHash(app.fs.files[p].t);
  return { r, p, text: app.fs.files[p].t };
}
const snapshot = (app) => JSON.stringify(app.files('').map(f => [f, app.fs.files[f].t]));
/* What a call did: threw (synchronously), rejected, or resolved (and with what); and whether anything in the folder changed. */
async function outcome(app, call) {
  const before = snapshot(app);
  let how = 'resolved', why = '', value;
  try { const p = call(); await Promise.resolve(p).then((v) => { value = v; }, (e) => { how = 'rejected'; why = e && e.message; }); } catch (e) { how = 'threw'; why = e && e.message; }
  await app.tick(100);
  return { how, why, value, wrote: snapshot(app) !== before };
}
const refused = (o) => o.how !== 'resolved' || !!(o.value && o.value.dropped);

/* Tokens the app's own guards hand over during a real click, taken before repo can use them: each write is answered false
   (so nothing is written), and the token and the write it was made for are kept. */
function capture(app) {
  const R = app.PF.repo, got = [], sr = R.saveRun, ss = R.saveScope;
  const steal = (fn) => function (f, phase, w) { return Promise.resolve(fn.apply(this, arguments)).then((t) => { got.push({ t, w }); return false; }); };
  R.saveRun = function (f, r, s, o) { o = Object.assign({}, o); if (o.recheck) o.recheck = steal(o.recheck); if (o.create) o.create = steal(o.create); return sr.call(this, f, r, s, o); };
  R.saveScope = function (f, n, file, o) { o = Object.assign({}, o); if (o.recheck) o.recheck = steal(o.recheck); return ss.call(this, f, n, file, o); };
  return { got, off: () => { R.saveRun = sr; R.saveScope = ss; } };
}
/* Starts a check-in run from the form (a create), and answers one of its steps (an ordinary save). */
async function startAndCheck(app) {
  app.click('start', 'check-in'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(150);
  const key = (/data-act="open-run" data-id="(check-in\/[^"]+)"/.exec(app.html()) || [])[1] || app.files('runs/check-in/').filter(f => /run\.json$/.test(f)).map(f => f.split('/').slice(1, 3).join('/')).pop();
  return key;
}

const MUTANTS = {
  'an alias of the writer': (app, r) => { const w = app.PF.repo.saveRun; return w(app.fs, r, 'mutant'); },
  'a helper that wraps it': (app, r) => { const h = (f, x) => app.PF.repo.saveRun(f, x, 'mutant', { writer: 'mutant' }); return h(app.fs, r); },
  'a call through a property': (app, r) => { const o = { s: app.PF.repo.saveRun }; return o.s(app.fs, r, 'mutant'); },
  'an object made from the folder': (app, r) => app.PF.repo.saveRun(Object.create(app.fs), r, 'mutant'),
  'an object made from the folder 33 times over': (app, r) => { let f = app.fs; for (let i = 0; i < 33; i++) f = Object.create(f); return app.PF.repo.saveRun(f, r, 'mutant'); },
  'a Proxy of the folder': (app, r) => app.PF.repo.saveRun(new Proxy(app.fs, {}), r, 'mutant'),
  'a fresh wrapper of the folder': (app, r) => { const f = app.fs; return app.PF.repo.saveRun({ read: (p, o) => f.read(p, o), write: (p, t) => f.write(p, t), list: (p) => f.list(p), remove: (p) => f.remove(p) }, r, 'mutant'); },
  'a guard that answers true': (app, r) => app.PF.repo.saveRun(app.fs, r, 'mutant', { recheck: () => true }),
  'a Proxy and a guard that answers true': (app, r) => app.PF.repo.saveRun(new Proxy(app.fs, {}), r, 'mutant', { recheck: () => true })
};
for (const m of Object.keys(MUTANTS)) rule('A run written through ' + m + ', without its guard\'s token, is refused in the test build and writes nothing', async () => {
  const app = await opened(), { r } = aRun(app);
  r.title = 'Changed by a mutant'; r.recorder = Object.assign({}, r.recorder, { person: 'person-blake' });
  const o = await outcome(app, () => MUTANTS[m](app, r));
  assert.deepStrictEqual([refused(o), o.wrote], [true, false], JSON.stringify(o));
  assert.ok(/guard didn't admit|wasn't admitted|no write-time check/.test(o.why), 'refused by the writer\'s check: ' + o.why);
});
rule('A token made by hand, shaped like a guard\'s, is refused: it was never made by a guard', async () => {
  const app = await opened(), { r, p, text } = aRun(app), key = r.process + '/' + r.id;
  r.title = 'Changed with a forged token';
  const forge = (f, phase, w) => Object.assign({}, w);
  const o = await outcome(app, () => app.PF.repo.saveRun(app.fs, r, 'mutant', { recheck: forge }));
  assert.deepStrictEqual([refused(o), o.wrote, app.fs.files[p].t === text], [true, false, true], JSON.stringify(o) + key);
});
rule('A new run written without its guard throws in the test build and writes nothing', async () => {
  const app = await opened(), { r } = aRun(app);
  const n = JSON.parse(JSON.stringify(r)); n.id = 'mutant-new-run'; delete n._fileHash;
  const o = await outcome(app, () => { const w = app.PF.repo.saveRun; return w(new Proxy(app.fs, {}), n, 'mutant'); });
  assert.deepStrictEqual([o.how, o.wrote], ['threw', false], JSON.stringify(o));
});

/* Genuine tokens, used for anything but the write they were made for. */
rule('A genuine run token is good only for its own write: another run, another revision or other bytes are refused, and nothing is written', async () => {
  const app = await opened(), key = await startAndCheck(app);
  assert.ok(key, 'set-up: a run started');
  app.click('open-run', key); await app.tick(60);
  const step = (/data-act="toggle" data-id="([^"]+)"/.exec(app.html()) || [])[1];
  assert.ok(step, 'set-up: a step to check');
  const c = capture(app);
  app.click('toggle', step); await app.tick(200);
  c.off();
  const one = c.got.find(x => x.t && typeof x.t === 'object' && (!x.w || x.w.kind === 'run'));
  assert.ok(one, 'set-up: the save\'s guard made a token: ' + JSON.stringify(c.got.map(x => [typeof x.t, x.w && x.w.kind])));
  const mine = aRun(app, f => f.indexOf('runs/' + key + '/') === 0), other = aRun(app, f => f.indexOf('runs/' + key + '/') !== 0 && /^runs\/check-in\//.test(f)) ;
  const cases = {
    'another run': () => { other.r.title = 'Another run, its token'; return app.PF.repo.saveRun(app.fs, other.r, 'mutant', { recheck: () => one.t }); },
    'another revision': () => { const x = aRun(app, f => f.indexOf('runs/' + key + '/') === 0).r; x.rev = (x.rev || 0) + 7; return app.PF.repo.saveRun(app.fs, x, 'mutant', { recheck: () => one.t }); },
    'other bytes': () => { const x = aRun(app, f => f.indexOf('runs/' + key + '/') === 0).r; x.title = 'Other bytes'; return app.PF.repo.saveRun(app.fs, x, 'mutant', { recheck: () => one.t }); }
  };
  for (const k of Object.keys(cases)) {
    const o = await outcome(app, cases[k]);
    assert.deepStrictEqual([k, refused(o), o.wrote], [k, true, false], JSON.stringify(o));
  }
  assert.strictEqual(aRun(app, f => f.indexOf('runs/' + key + '/') === 0).text, mine.text, 'the run is as it was');
});
rule('A genuine create token is good only for a run that is still absent: once a run.json is there, it writes nothing', async () => {
  const app = await opened(), c = capture(app);
  app.click('start', 'check-in'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(200);
  c.off();
  const one = c.got.find(x => x.t && typeof x.t === 'object' && (!x.w || x.w.kind === 'create'));
  assert.ok(one, 'set-up: the start\'s guard made a create token: ' + JSON.stringify(c.got.map(x => [typeof x.t, x.w && x.w.kind])));
  const ckey = (one.w && one.w.key) || one.t.key;
  /* A run arrives where the new one would go (another computer's), then the token is tried there. */
  const dir = 'runs/' + ckey + '/', there = dir + 'run.json', theirs = JSON.stringify({ arrived: true });
  app.fs.files[there] = { t: theirs, m: Date.now() };
  const n = app.PF.run.sanitize(JSON.parse(aRun(app).text)); n.process = ckey.split('/')[0]; n.id = ckey.split('/')[1]; delete n._fileHash;
  const o = await outcome(app, () => app.PF.repo.saveRun(app.fs, n, 'mutant', { create: () => one.t }));
  assert.deepStrictEqual([refused(o), app.fs.files[there].t], [true, theirs], JSON.stringify(o));
});
/* A genuine scope token used elsewhere is in app-loops.test.js (YA), which has a loop to write one for. */
rule('A genuine run token never writes a scope record (another kind)', async () => {
  const app = await opened(), c = capture(app);
  const key = await startAndCheck(app);
  app.click('open-run', key); await app.tick(60);
  const step = (/data-act="toggle" data-id="([^"]+)"/.exec(app.html()) || [])[1];
  app.click('toggle', step); await app.tick(200);
  c.off();
  const one = c.got.find(x => x.t && typeof x.t === 'object');
  assert.ok(one, 'set-up: a genuine token');
  const o = await outcome(app, () => app.PF.repo.saveScope(app.fs, SCOPE, scopeFile(), { recheck: () => one.t }));
  assert.ok(refused(o) && !o.wrote, 'a run token never writes a scope record: ' + JSON.stringify(o));
});
const SCOPE = 'req-mutant-0123456789abcdef01234567.json';
const scopeFile = () => ({ format: 'flightdeck-plan/3', features: ['loops'] });
for (const [m, call] of [
  ['an alias of the scope writer', (app) => { const w = app.PF.repo.saveScope; return w(app.fs, SCOPE, scopeFile(), {}); }],
  ['a call through a property, with a guard that answers true', (app) => { const o = { s: app.PF.repo.saveScope }; return o.s(app.fs, SCOPE, scopeFile(), { recheck: () => true }); }],
  ['a Proxy of the folder, with a token made by hand', (app) => app.PF.repo.saveScope(new Proxy(app.fs, {}), SCOPE, scopeFile(), { recheck: (f, ph, w) => Object.assign({}, w) })]
]) rule('A scope record written through ' + m + ' is refused and nothing is written', async () => {
  const app = await opened();
  const o = await outcome(app, () => call(app));
  assert.deepStrictEqual([refused(o), o.wrote], [true, false], JSON.stringify(o));
  assert.ok(o.how === 'threw' || /guard didn't admit|wasn't admitted|no write-time check/.test(o.why) || (o.value && o.value.dropped), 'refused by the writer\'s check: ' + JSON.stringify(o));
});
rule('The write gate is set once: a second gate, or none, is refused', async () => {
  const app = await opened();
  assert.throws(() => app.PF.repo.gateWrites(() => true), /already set/);
  const { r } = aRun(app); r.title = 'After a second gate';
  const o = await outcome(app, () => app.PF.repo.saveRun(app.fs, r, 'mutant', { recheck: () => true }));
  assert.deepStrictEqual([refused(o), o.wrote], [true, false], JSON.stringify(o));
});
/* Round 21 (ZA): a token is bound to the folder its guard checked. Another folder holding the same files (a copy; the
   destination there is in the very state the write names) is written to through the app's own writer call, with the
   app's genuine guard asked about the real folder: refused, for every kind, and neither folder changes. */
function copyFolder(app) {
  const files = JSON.parse(JSON.stringify(app.fs.files));
  return { files,
    read: (p) => Promise.resolve(files[p] ? { text: files[p].t, mtime: files[p].m, size: files[p].t.length } : null),
    list: (p) => { const pre = p ? p + '/' : '', seen = {}, out = []; Object.keys(files).forEach(k => { if (k.indexOf(pre) !== 0) return; const rest = k.slice(pre.length), i = rest.indexOf('/'), n = i < 0 ? rest : rest.slice(0, i); if (!seen[n]) { seen[n] = true; out.push({ name: n, kind: i < 0 ? 'file' : 'dir' }); } }); return Promise.resolve(out); },
    write: (p, t) => { files[p] = { t: String(t), m: Date.now() }; return Promise.resolve(); },
    remove: (p) => { delete files[p]; return Promise.resolve(); },
    stat: (p) => Promise.resolve(files[p] ? { size: files[p].t.length, mtime: files[p].m } : null) };
}
/* Every writer call the app makes while act() runs goes to the other folder, its guard asked about the real one. */
async function replayElsewhere(app, act) {
  const R = app.PF.repo, sr = R.saveRun, ss = R.saveScope, other = copyFolder(app), real = app.fs, calls = [];
  const there = (fn) => fn && function (f, phase, w) { return fn.call(this, real, phase, w); };
  R.saveRun = function (f, r, s, o) { o = Object.assign({}, o); o.recheck = there(o.recheck); o.create = there(o.create); calls.push('run'); return sr.call(this, other, r, s, o); };
  R.saveScope = function (f, n, file, o) { o = Object.assign({}, o); o.recheck = there(o.recheck); calls.push('scope'); return ss.call(this, other, n, file, o); };
  const before = snapshot(app), otherBefore = JSON.stringify(other.files);
  try { await act(); } finally { R.saveRun = sr; R.saveScope = ss; }
  await app.tick(150);
  return { calls, otherWrote: JSON.stringify(other.files) !== otherBefore, realWrote: snapshot(app) !== before };
}
rule('Round 21 (ZA): a run\'s write sent to another folder with the same files, its guard asked about this one, is refused and writes nothing', async () => {
  const app = await opened(), key = await startAndCheck(app);
  app.click('open-run', key); await app.tick(60);
  const step = (/data-act="toggle" data-id="([^"]+)"/.exec(app.html()) || [])[1];
  assert.ok(step, 'set-up: a step to check');
  const o = await replayElsewhere(app, async () => { app.click('toggle', step); await app.tick(200); });
  assert.ok(o.calls.includes('run'), 'set-up: the save was made');
  assert.deepStrictEqual([o.otherWrote, o.realWrote], [false, false], JSON.stringify(o));
});
rule('Round 21 (ZA): a new run\'s write sent to another folder with the same files, its guard asked about this one, is refused and writes nothing', async () => {
  const app = await opened();
  app.click('start', 'check-in'); await app.settle();
  const o = await replayElsewhere(app, async () => { app.chooseApprovers().submitForm('start-form'); await app.tick(200); });
  assert.ok(o.calls.includes('run'), 'set-up: the start was made');
  assert.deepStrictEqual([o.otherWrote, o.realWrote], [false, false], JSON.stringify(o));
});
/* Round 21 (ZD): a recovery's backup (replaced-*.json) is written only with its guard's token, like every other write. */
rule('Round 21 (ZD): a backup written without its guard throws in the test build and writes nothing', async () => {
  const app = await opened(), { r } = aRun(app);
  const o = await outcome(app, () => app.PF.repo.keepDisplaced(app.fs, r, 'mutant'));
  assert.deepStrictEqual([o.how, o.wrote], ['threw', false], JSON.stringify(o));
});
rule('Round 21 (ZD): a backup with a token made by hand, or a guard that answers true, is refused and writes nothing', async () => {
  const app = await opened(), { r } = aRun(app);
  for (const g of [(f, ph, w) => Object.assign({}, w), () => true]) {
    const o = await outcome(app, () => app.PF.repo.keepDisplaced(app.fs, r, 'mutant', g));
    assert.deepStrictEqual([refused(o), o.wrote], [true, false], JSON.stringify(o));
  }
});
/* Round 22 (AB): a guard is bound, when it is made, to the write it was made for: its kind, its run and that run's
   revision, its paths and its bytes. A genuine save's guard (not its token), used for another run, the same run read
   again and changed, a scope record or a backup, mints nothing. */
rule('Round 22 (AB): a genuine save\'s guard, reused for another run, changed bytes, a scope record or a backup, writes nothing', async () => {
  const app = await opened(), key = await startAndCheck(app);
  assert.ok(key, 'set-up: a run started');
  app.click('open-run', key); await app.tick(60);
  const step = (/data-act="toggle" data-id="([^"]+)"/.exec(app.html()) || [])[1];
  const R = app.PF.repo, sr = R.saveRun, got = [];
  R.saveRun = function (f, r, s, o) { if (o && typeof o.recheck === 'function') got.push(o.recheck); return sr.apply(this, arguments); };
  app.click('toggle', step); await app.tick(200);
  R.saveRun = sr;
  const rc = got[0];
  assert.ok(rc, 'set-up: the save asked its guard');
  const mine = () => aRun(app, f => f.indexOf('runs/' + key + '/') === 0);
  const before = mine().text;
  const cases = {
    'another run': () => { const o = aRun(app, f => f.indexOf('runs/' + key + '/') !== 0 && /^runs\/check-in\//.test(f)).r; o.title = 'Another run'; return R.saveRun(app.fs, o, 'mutant', { recheck: rc }); },
    'the same run read again, changed': () => { const x = mine().r; x.title = 'Changed bytes'; x.recorder = Object.assign({}, x.recorder, { person: 'person-blake' }); return R.saveRun(app.fs, x, 'mutant', { recheck: rc }); },
    'a scope record': () => R.saveScope(app.fs, SCOPE, scopeFile(), { recheck: rc }),
    'a backup': () => R.keepDisplaced(app.fs, mine().r, 'mutant', rc)
  };
  for (const k of Object.keys(cases)) {
    const o = await outcome(app, cases[k]);
    /* A backup's writer answers null when its guard refuses (nothing kept). */
    assert.deepStrictEqual([k, refused(o) || (k === 'a backup' && o.value === null), o.wrote], [k, true, false], JSON.stringify(o));
  }
  assert.strictEqual(mine().text, before, 'the run is as it was');
});
/* Round 22 (AC): a write that isn't gated never reaches a run's own files or a scope or to-do record. Each writer below is
   aimed at one: a run's run.json, a backup or candidate name beside it, a path under one of those names, a scope record
   in proposals/, or (for the install and update files) anywhere but their own place. Each is refused, the test build's
   gate is told (it throws), and nothing in the folder changes. */
const SCOPE_DEC = 'req-mutant-0123456789abcdef01234567.status-wmutant-0123abcd.json';
const PLAIN = {
  'contractWrite onto a run.json': (app, r, p, text) => app.PF.repo.contractWrite(app.fs, p, text, text.replace(/"title": "[^"]*"/, '"title": "Changed"')),
  'archiveCopy as a backup beside a run': (app, r) => app.PF.repo.archiveCopy(app.fs, 'runs/' + r.process + '/' + r.id, 'replaced-mutant.json', '{}'),
  'archiveDir in a run\'s folder': (app, r) => app.PF.repo.archiveDir(app.fs, 'runs/' + r.process + '/' + r.id),
  'archiveStaged putting a run.json away': (app, r, p, text) => app.PF.repo.archiveStaged(app.fs, 'runs/' + r.process + '/' + r.id, p, 'replaced-mutant.json', text, () => true),
  'appendHistory as a candidate': (app, r) => app.PF.repo.appendHistory(app.fs, 'runs/' + r.process + '/' + r.id, 'candidate-mutant', ['{}'], {}),
  'appendHistory into proposals/': (app) => app.PF.repo.appendHistory(app.fs, 'proposals', 'req-mutant-0123456789abcdef01234567', ['{"format":"flightdeck-plan/3","features":["loops"]}'], {}),
  'addNote under a candidate\'s name': (app, r) => app.PF.repo.addNote(app.fs, { process: r.process, id: r.id + '/candidate-mutant' }, 'mutant', { text: 'x' }),
  'saveAttachment under run.json': (app, r) => app.PF.repo.saveAttachment(app.fs, { process: r.process, id: r.id + '/run.json' }, new Blob(['x'], { type: 'text/plain' }), 'mutant', 'a.txt'),
  'archiveOverflow under a backup\'s name': (app, r) => app.PF.repo.archiveOverflow(app.fs, { process: r.process, id: r.id + '/replaced-mutant', _overflow: [{ id: 'x' }] }, 'mutant'),
  'recordPlanStatus over a scope decision': (app) => app.PF.repo.recordPlanStatus(app.fs, { id: 'req-mutant-0123456789abcdef01234567', process: 'check-in', version: 1 }, 'wmutant-0123abcd', 'retargeted', '', 'person-avery', { folder: 'v1-x', version: 1 }, '4.0.0'),
  'savePlan with a scope record\'s bytes': (app) => app.PF.repo.savePlan(app.fs, { id: 'plan-mutant', format: 'flightdeck-plan/3', features: ['loops'] }, {})
};
for (const m of Object.keys(PLAIN)) rule('Round 22 (AC): ' + m + ' is refused and nothing is written', async () => {
  const app = await opened(), { r, p, text } = aRun(app);
  app.fs.files['proposals/' + SCOPE_DEC] = { t: JSON.stringify({ format: 'flightdeck-plan-status/3', features: ['loops'], proposal: 'req-mutant-0123456789abcdef01234567' }), m: Date.now() };
  const dirs = JSON.stringify(app.fs.dirs || {});
  const o = await outcome(app, () => PLAIN[m](app, r, p, text));
  assert.deepStrictEqual([refused(o), o.wrote, JSON.stringify(app.fs.dirs || {}) === dirs], [true, false, true], JSON.stringify(o));
});
/* Round 22 (AC): the source keeps it so: in storage, a folder's write, append or new folder is called only by the gated
   writer and the one plain writer; in the app, never on a folder at all. */
rule('Round 22 (AC): storage writes to the folder only through the gated writer or the plain writer, and the app never does', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'storage', 'repo.js'), 'utf8');
  const fnAt = (name) => { const i = src.indexOf('  function ' + name + '('); assert.ok(i >= 0, name); return [i, src.indexOf('\n  }\n', i)]; };
  const ok = [fnAt('gatedWrite'), fnAt('plainPut')];
  /* A folder's write always names a path; o.write() is a plan decision's own callback, not a folder. */
  const calls = [...src.matchAll(/\.(write|append|mkdirExclusive)\((?!\))/g)].map(m => m.index).filter(i => !ok.some(([a, b]) => i > a && i < b));
  assert.deepStrictEqual(calls.map(i => src.slice(src.lastIndexOf('\n', i) + 1, src.indexOf('\n', i)).trim().slice(0, 120)), [], 'raw folder writes in repo.js');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  const raw = [...app.matchAll(/([\w.]+)\.(write|append|mkdirExclusive)\(/g)].filter(m => !/^(handles|PF\.links)$/.test(m[1])).map(m => m[0]);
  assert.deepStrictEqual(raw, [], 'folder writes in app.js');
});
/* The same mutants made in the app's own source: a click handler that aliases, wraps or calls the writer through a property,
   or through a Proxy of the folder, built into the page. Each click throws in the test build and writes nothing. */
const HTML = fs.readFileSync(path.join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8');
const ANCHOR = "    'loop-unsettle': function (id) {";
const SOURCE = {
  alias: "'mutant': function () { var w = repo.saveRun; w(state.fs, data.runs[0], SESSION, { writer: WRITER }); },",
  helper: "'mutant': function () { var h = function (r) { return repo.saveRun(state.fs, r, SESSION, { writer: WRITER }); }; h(data.runs[0]); },",
  property: "'mutant': function () { var o = { put: PF.repo.saveRun }; o.put(state.fs, data.runs[0], SESSION, { writer: WRITER }); },",
  proxy: "'mutant': function () { repo.saveRun(new Proxy(state.fs, {}), data.runs[0], SESSION, { writer: WRITER }); },",
  scope: "'mutant': function () { var w = repo.saveScope; w(state.fs, '" + SCOPE + "', { format: 'flightdeck-plan/3' }, {}); },",
  backup: "'mutant': function () { repo.keepDisplaced(state.fs, data.runs[0], WRITER); },",
  contract: "'mutant': function () { var r = data.runs[0]; repo.contractWrite(state.fs, 'runs/' + r.process + '/' + r.id + '/run.json', null, '{}'); },",
  archive: "'mutant': function () { var r = data.runs[0]; repo.archiveCopy(state.fs, 'runs/' + r.process + '/' + r.id, 'replaced-mutant.json', '{}'); },"
};
for (const m of Object.keys(SOURCE)) rule('A writer reached by ' + m + ' in the app\'s own source throws when clicked in the test build, and nothing is written', async () => {
  assert.strictEqual(HTML.split(ANCHOR).length, 2, 'set-up: one place to put the mutant');
  const app = await opened(HTML.replace(ANCHOR, '    ' + SOURCE[m] + '\n' + ANCHOR));
  const o = await outcome(app, () => app.click('mutant', ''));
  assert.deepStrictEqual([o.how, o.wrote], ['threw', false], JSON.stringify(o));
});

run();
