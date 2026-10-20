// 1.19 slice 1 in the built app: proposals on the process page (Review, Apply, Decline, Reopen) through one acceptance
// transaction, who's editing (presence), exact-text saves and the draft size limit. Races are paused at exact points.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot, gate, bus, locks } = require('./app-harness');

const DRAFT = 'maps/drafts/release.md';
const sha = (app, t) => app.PF.sha256.hex(t);
async function page(opts) {
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, opts || {}));
  await app.tick(60); app.choose((opts && opts.me) || 'person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick();
  return app;
}
/* A proposal written the way the command line writes it, landing in the folder as another computer's file would. */
function plant(app, o) {
  const base = o.base != null ? o.base : app.fs.files[DRAFT].t;
  const p = app.PF.proposals.make(Object.assign({ id: 'p-mh4k2a-x7w1k3m9p2', process: 'release', session: 's-k3m9p2q8x7w1', label: 'assistant', by: 'person-avery', at: new Date().toISOString(), app: '1.19.0',
    base: { kind: 'draft', ref: DRAFT, text: base }, replaces: null, after: null, note: 'Retitled' }, o, { base: o.baseObj || { kind: 'draft', ref: DRAFT, text: base } }));
  app.fs.files['proposed/release/' + p.id + '.json'] = { t: JSON.stringify(p, null, 2), m: Date.now() };
  return p;
}
const retitle = (app, t) => app.fs.files[DRAFT].t.replace('title: Production release', 'title: ' + t);
async function refresh(app) { app.click('refresh'); await app.tick(120); }
const recs = (app, id) => Object.keys(app.fs.files).filter(p => p.indexOf('proposed/release/' + id + '.') === 0 && p !== 'proposed/release/' + id + '.json').map(p => { let rec = null; try { rec = JSON.parse(app.fs.files[p].t); } catch (e) { rec = { kind: 'unreadable' }; } return { name: p.split('/').pop(), rec }; });
const statuses = (app, id) => recs(app, id).filter(r => r.rec.kind === 'proposal-decision').sort((a, b) => a.rec.decisionRev - b.rec.decisionRev).map(r => r.rec.status);
const attempts = (app, id) => recs(app, id).filter(r => r.rec.kind === 'proposal-attempt');
const said = (app, re) => re.test(app.html()) || re.test(app.live());
async function review(app, id) { app.click('prop-review', id); await app.tick(80); assert.ok(/id="pr-t"/.test(app.overlay()), 'Review is open'); }
async function applied(app, p) { app.click('prop-apply', p.id); await app.tick(160); }

rule('Apply: a fast-forward proposal is saved as its exact text, with an attempt first, then the decision applied and a history line', async () => {
  const app = await page(), text = retitle(app, 'Proposed'), p = plant(app, { text });
  await refresh(app);
  assert.ok(/Proposed changes · 1/.test(app.html()) && /data-act="prop-apply" data-id="p-mh4k2a-x7w1k3m9p2"/.test(app.html()));
  await applied(app, p);
  assert.strictEqual(app.fs.files[DRAFT].t, text, 'the proposal\'s exact text');
  assert.strictEqual(attempts(app, p.id).length, 1);
  const at = attempts(app, p.id)[0].rec;
  assert.deepStrictEqual([at.how, at.proposal, at.proposalRev], ['apply', p.id, p.rev]);
  assert.deepStrictEqual(statuses(app, p.id), ['applied']);
  const dec = recs(app, p.id).filter(r => r.rec.kind === 'proposal-decision')[0].rec;
  assert.deepStrictEqual([dec.attempt, dec.result.rev, dec.decisionRev], [at.attempt, sha(app, text), 1]);
  const hist = Object.keys(app.fs.files).filter(x => x.indexOf('history/drafts/release/') === 0).map(x => app.fs.files[x].t).join('\n');
  assert.ok(/"source":"proposal"/.test(hist) && /"proposal":"p-mh4k2a-x7w1k3m9p2"/.test(hist), 'History: changed by your AI assistant, applied in Flightdeck');
  assert.ok(said(app, /Applied your AI assistant.s change to the draft/));
  await refresh(app);
  assert.ok(!/data-act="prop-apply" data-id="p-mh4k2a/.test(app.html()) && /Applied\./.test(app.html()), 'listed as applied, no Apply');
});

rule('Apply is refused over unsaved work kept in this window, and writes nothing', async () => {
  const app = await page(), p = plant(app, { text: retitle(app, 'Proposed') });
  app.click('ptab', 'edit'); await app.tick();
  app.input('draft-editor', retitle(app, 'Mine')); await app.tick(300);
  app.click('ed-done'); await app.tick(); await refresh(app);
  await applied(app, p);
  assert.ok(said(app, /You have unsaved changes to this draft\. Save or discard them in the editor first\./));
  assert.deepStrictEqual(recs(app, p.id), [], 'no attempt');
  assert.ok(/title: Production release/.test(app.fs.files[DRAFT].t));
});

rule('Two proposals in a row: the second is judged on the result of the first, and a dependent one becomes a fast-forward', async () => {
  const app = await page(), A = app.fs.files[DRAFT].t, B = retitle(app, 'B'), C = retitle(app, 'C'), D = retitle(app, 'D');
  const p1 = plant(app, { id: 'p-a1-aaaaaaaaaa', text: B }), p2 = plant(app, { id: 'p-a2-bbbbbbbbbb', text: C });
  const p3 = plant(app, { id: 'p-a3-cccccccccc', text: D, after: p1.id, baseObj: { kind: 'proposal', ref: p1.id, text: B } });
  await refresh(app);
  assert.ok(/Waiting for an earlier proposal/.test(app.html()), 'the dependent one waits');
  app.click('prop-apply', p1.id); app.click('prop-apply', p2.id); await app.tick(240);
  assert.strictEqual(app.fs.files[DRAFT].t, B, 'the first applied');
  assert.deepStrictEqual(recs(app, p2.id), [], 'the second, queued behind it, found it no longer starts from the draft');
  assert.ok(said(app, /This started from an older draft/));
  await refresh(app);
  assert.ok(/data-act="prop-apply" data-id="p-a3-cccccccccc"/.test(app.html()), 'P1 applied: the dependent one is a fast-forward now');
  await applied(app, p3);
  assert.strictEqual(app.fs.files[DRAFT].t, D);
  assert.ok(A !== D);
});

rule('Decline, then Reopen, then Apply after Review: each a versioned decision naming the one before', async () => {
  const app = await page(), text = retitle(app, 'Later'), p = plant(app, { text });
  await refresh(app);
  app.click('prop-decline', p.id); await app.tick(120);
  assert.deepStrictEqual(statuses(app, p.id), ['declined']);
  await refresh(app);
  assert.ok(/data-act="prop-reopen" data-id="p-mh4k2a-x7w1k3m9p2"/.test(app.html()) && !/data-act="prop-apply" data-id="p-mh4k2a/.test(app.html()));
  app.click('prop-reopen', p.id); await app.tick(120);
  const ds = recs(app, p.id).map(r => r.rec).sort((a, b) => a.decisionRev - b.decisionRev);
  assert.deepStrictEqual(ds.map(d => [d.status, d.decisionRev]), [['declined', 1], ['reopened', 2]]);
  assert.strictEqual(ds[1].seen, recs(app, p.id).filter(r => r.rec.decisionRev === 1)[0].name);
  await refresh(app);
  assert.ok(!/data-act="prop-apply" data-id="p-mh4k2a/.test(app.html()), 'reopened: Review first, never straight from the list');
  await review(app, p.id);
  app.click('prop-apply', p.id); await app.tick(200);
  assert.strictEqual(app.fs.files[DRAFT].t, text);
  assert.deepStrictEqual(statuses(app, p.id), ['declined', 'reopened', 'applied']);
});

rule('The reviewed set lets a person apply again after cancelled, but never over a record added, changed or gone since Review', async () => {
  const app = await page(), text = retitle(app, 'Again'), p = plant(app, { text });
  // An earlier attempt was cancelled.
  const PP = app.PF.proposals, at = PP.attempt({ proposal: p.id, proposalRev: p.rev, writer: 'zz1', n: 1, how: 'apply', from: sha(app, app.fs.files[DRAFT].t), by: 'person-avery', at: new Date().toISOString() });
  const out = PP.decision({ proposal: p.id, proposalRev: p.rev, writer: 'zz1', decisionRev: 1, seen: null, status: 'cancelled', attempt: 'zz1.1', by: 'person-avery', at: new Date().toISOString() });
  app.fs.files['proposed/release/' + at.name] = { t: JSON.stringify(at.rec), m: 1 }; app.fs.files['proposed/release/' + out.name] = { t: JSON.stringify(out.rec), m: 1 };
  await refresh(app);
  assert.ok(!/data-act="prop-apply" data-id="p-mh4k2a/.test(app.html()), 'tried before: not from the list');
  app.click('prop-apply', p.id); await app.tick(120);
  assert.strictEqual(attempts(app, p.id).length, 1, 'Apply without Review is refused');
  // Added between Review and Apply: refused before any attempt.
  await review(app, p.id);
  const extra = PP.decision({ proposal: p.id, proposalRev: p.rev, writer: 'zz2', decisionRev: 2, seen: out.name, status: 'declined', by: 'person-avery', at: new Date().toISOString() });
  app.fs.files['proposed/release/' + extra.name] = { t: JSON.stringify(extra.rec), m: 1 };
  app.click('prop-apply', p.id); await app.tick(160);
  assert.ok(said(app, /This proposal changed since you reviewed it\. Look again\./));
  assert.strictEqual(attempts(app, p.id).length, 1);
  delete app.fs.files['proposed/release/' + extra.name];
  // Changed (same name, other bytes) between step 2a and the save: no save, and the attempt ends cancelled.
  app.click('close-overlay'); await app.tick(); await review(app, p.id);
  const list = app.PF.repo.listRecords; let n = 0;
  app.PF.repo.listRecords = function () { if (++n === 4) app.fs.files['proposed/release/' + out.name] = { t: JSON.stringify(Object.assign({}, out.rec, { by: 'person-blake' })), m: 2 }; return list.apply(this, arguments); };
  app.click('prop-apply', p.id); await app.tick(200);
  app.PF.repo.listRecords = list;
  assert.ok(/title: Production release/.test(app.fs.files[DRAFT].t), 'not saved');
  const mine = attempts(app, p.id).filter(a => a.rec.attempt.indexOf('zz1') !== 0);
  assert.strictEqual(mine.length, 1);
  assert.ok(recs(app, p.id).some(r => r.rec.status === 'cancelled' && r.rec.attempt === mine[0].rec.attempt), 'this attempt: cancelled');
  // Gone between Review and step 2a (it disappears while the attempt is written): cancelled too.
  await refresh(app); await review(app, p.id);
  const kept = app.fs.files['proposed/release/' + out.name], write = app.fs.write.bind(app.fs);
  app.fs.write = (path, t) => { const r = write(path, t); if (/\.attempt\./.test(path)) delete app.fs.files['proposed/release/' + out.name]; return r; };
  app.click('prop-apply', p.id); await app.tick(200);
  app.fs.write = write;
  assert.ok(/title: Production release/.test(app.fs.files[DRAFT].t), 'not saved');
  assert.strictEqual(statuses(app, p.id).filter(s => s === 'cancelled').length, 2, 'its attempt: cancelled');
  app.fs.files['proposed/release/' + out.name] = kept;
  // Now exactly as reviewed: applied.
  await refresh(app); await review(app, p.id);
  app.click('prop-apply', p.id); await app.tick(200);
  assert.strictEqual(app.fs.files[DRAFT].t, text, 'applied once the records are exactly what the person saw');
});

rule('Counterexample (a): apply A to B, the decision can\'t be written, the person puts A back and saves: never applied again, shown as May already be applied', async () => {
  const app = await page(), A = app.fs.files[DRAFT].t, B = retitle(app, 'B'), p = plant(app, { text: B });
  await refresh(app);
  const wr = app.PF.repo.writeRecord;
  app.PF.repo.writeRecord = function (fs, proc, name) { if (!/\.attempt\./.test(name)) return Promise.reject(new Error('OneDrive is offline')); return wr.apply(this, arguments); };
  await applied(app, p);
  app.PF.repo.writeRecord = wr;
  assert.strictEqual(app.fs.files[DRAFT].t, B, 'saved B');
  assert.deepStrictEqual(statuses(app, p.id), [], 'no decision');
  app.click('ptab', 'edit'); await app.tick();
  app.input('draft-editor', A); await app.tick(300);
  app.click('save-draft'); await app.tick(120);
  assert.strictEqual(app.fs.files[DRAFT].t, A, 'the person saved A');
  app.click('ed-done'); await app.tick(); await refresh(app);
  assert.ok(/May already be applied/.test(app.html()), app.html().match(/Proposed changes[\s\S]{0,600}/));
  assert.ok(!/data-act="prop-apply" data-id="p-mh4k2a/.test(app.html()), 'not offered from the list');
  app.click('prop-apply', p.id); await app.tick(160);
  assert.strictEqual(app.fs.files[DRAFT].t, A, 'never applied again without Review');
  await review(app, p.id);
  assert.ok(/Flightdeck started applying this but couldn.t record what happened\./.test(app.overlay()) && /data-act="prop-mark-applied"/.test(app.overlay()));
});

rule('Already in the draft after a failed decision write: Review offers Mark as applied, which records it', async () => {
  const app = await page(), B = retitle(app, 'B'), p = plant(app, { text: B });
  await refresh(app);
  const wr = app.PF.repo.writeRecord;
  app.PF.repo.writeRecord = function (fs, proc, name) { if (!/\.attempt\./.test(name)) return Promise.reject(new Error('OneDrive is offline')); return wr.apply(this, arguments); };
  await applied(app, p);
  app.PF.repo.writeRecord = wr;
  await refresh(app);
  assert.ok(/Already in the draft/.test(app.html()));
  await review(app, p.id);
  assert.ok(!/data-act="prop-apply"/.test(app.overlay()));
  app.click('prop-mark-applied', p.id); await app.tick(160);
  assert.deepStrictEqual(statuses(app, p.id), ['applied']);
  const d = recs(app, p.id).filter(r => r.rec.kind === 'proposal-decision')[0].rec;
  assert.ok(d.attempt && d.result.rev === sha(app, B), 'naming the attempt and the draft it found');
});

async function pausedAttempt(app, when) {
  const g = gate(), write = app.fs.write.bind(app.fs), read = app.fs.read.bind(app.fs);
  let reads = 0;
  if (when === 'create') app.fs.write = (p, t) => /\.attempt\./.test(p) ? g.p.then(() => write(p, t)) : write(p, t);
  else app.fs.read = (p, o) => { const r = read(p, o); if (/\.attempt\./.test(p) && ++reads === 2) return r.then(v => g.p.then(() => v)); return r; };
  return { g, restore() { app.fs.write = write; app.fs.read = read; } };
}
['create', 'read back'].forEach(when => {
  rule('Counterexample (b): typing in the Markdown while the attempt is ' + (when === 'create' ? 'written' : 'read back') + ': the person\'s text stays, the outcome is cancelled', async () => {
    const app = await page(), B = retitle(app, 'B'), p = plant(app, { text: B });
    app.click('ptab', 'edit'); await app.tick(); await refresh(app);
    assert.ok(/Your AI assistant proposed changes\./.test(app.html()), 'the editor says so');
    await review(app, p.id);
    const pause = await pausedAttempt(app, when);
    app.click('prop-apply', p.id); await app.tick(40);
    app.input('draft-editor', retitle(app, 'Typed meanwhile')); await app.tick(40);
    pause.g.open(); await app.tick(200); pause.restore();
    assert.ok(/title: Production release/.test(app.fs.files[DRAFT].t), 'the draft is unchanged');
    assert.ok(/title: Typed meanwhile/.test(app.html()), 'the person\'s text stays');
    assert.ok(statuses(app, p.id).indexOf('cancelled') >= 0, 'cancelled');
    assert.ok(said(app, /wasn.t applied because the draft changed while it was being applied/));
  });
});

rule('Counterexample (b): text typed in a builder box, or a switch of folders, while the attempt is written: cancelled, nothing replaced', async () => {
  let app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  let p = plant(app, { text: retitle(app, 'B') }); await refresh(app);
  await review(app, p.id);
  let pause = await pausedAttempt(app, 'create');
  app.click('prop-apply', p.id); await app.tick(40);
  app.click('close-overlay'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  app.setScoped('ob-text', 'Typed words'); app.input('ob-text', 'Typed words'); await app.tick();
  pause.g.open(); await app.tick(200); pause.restore();
  assert.ok(/title: Production release/.test(app.fs.files[DRAFT].t));
  assert.strictEqual(app.draft('ob-text'), 'Typed words');
  assert.ok(statuses(app, p.id).indexOf('cancelled') >= 0);
  // Switching folders while it's written: the old folder gets the cancelled outcome, and nothing is saved anywhere.
  app = await page(); p = plant(app, { text: retitle(app, 'B') }); await refresh(app);
  const old = app.fs;
  pause = await pausedAttempt(app, 'create');
  app.click('prop-apply', p.id); await app.tick(40);
  app.click('reset-examples'); await app.tick(80);
  pause.g.open(); await app.tick(200); pause.restore();
  assert.ok(/title: Production release/.test(old.files[DRAFT].t));
  assert.ok(Object.keys(old.files).some(k => k.indexOf('proposed/release/' + p.id + '.') === 0 && /"cancelled"/.test(old.files[k].t)), 'cancelled in the folder it started in');
});

[true, false].forEach(withLocks => {
  rule('Counterexample (c), ' + (withLocks ? 'with Web Locks' : 'without Web Locks') + ': window 2 checked, then stalled; window 1 applied A to B and the person saved A again; window 2 never puts B back', async () => {
    const files = {}, L = locks(), Channel = bus(), g = gate();
    let w2paused = !withLocks ? null : { request(name, fn) { return g.p.then(() => L.request(name, fn)); } };
    const w1 = await page({ sharedFiles: files, locks: withLocks ? L : undefined, Channel });
    const A = w1.fs.files[DRAFT].t, B = A.replace('title: Production release', 'title: B'), p = plant(w1, { text: B });
    const w2 = await page({ sharedFiles: files, locks: withLocks ? w2paused : undefined, Channel, me: 'person-blake' });
    await refresh(w1); await refresh(w2);
    let restore = null;
    if (!withLocks) { const write = w2.fs.write.bind(w2.fs); w2.fs.write = (path, t) => /\.attempt\./.test(path) ? g.p.then(() => write(path, t)) : write(path, t); restore = () => { w2.fs.write = write; }; }
    w2.click('prop-apply', p.id); await w2.tick(60);
    await applied(w1, p);
    assert.strictEqual(files[DRAFT].t, B, 'window 1 applied it');
    w1.click('ptab', 'edit'); await w1.tick();
    w1.input('draft-editor', A); await w1.tick(300);
    w1.click('save-draft'); await w1.tick(120);
    assert.strictEqual(files[DRAFT].t, A, 'the person took it back');
    g.open(); await w2.tick(240); if (restore) restore();
    assert.strictEqual(files[DRAFT].t, A, 'window 2 found window 1\'s attempt and stopped');
    const mine = Object.keys(files).filter(k => k.indexOf('proposed/release/' + p.id + '.') === 0 && k !== 'proposed/release/' + p.id + '.json').map(k => JSON.parse(files[k].t));
    assert.strictEqual(mine.filter(r => r.status === 'applied').length, 1, 'applied once');
    if (!withLocks) assert.ok(mine.some(r => r.status === 'cancelled'), 'its own attempt: cancelled');
  });
});

rule('If the attempt can\'t be recorded, nothing changes and the message says so', async () => {
  const app = await page(), p = plant(app, { text: retitle(app, 'B') });
  await refresh(app);
  const wr = app.PF.repo.writeRecord;
  app.PF.repo.writeRecord = () => Promise.reject(new Error('OneDrive is offline'));
  await applied(app, p);
  app.PF.repo.writeRecord = wr;
  assert.ok(/title: Production release/.test(app.fs.files[DRAFT].t));
  assert.ok(said(app, /Couldn.t record that your AI assistant.s change is being applied, so it wasn.t\./));
});

rule('A record that can\'t be read blocks Apply until it reads, and Review names it', async () => {
  const app = await page(), p = plant(app, { text: retitle(app, 'B') });
  app.fs.files['proposed/release/' + p.id + '.zz9.1.json'] = { t: '{"kind":"proposal-deci', m: 1 };
  await refresh(app);
  assert.ok(/Can(.|&#39;)t tell what happened/.test(app.html()) && !/data-act="prop-apply" data-id="p-mh4k2a/.test(app.html()));
  await review(app, p.id);
  assert.ok(/p-mh4k2a-x7w1k3m9p2\.zz9\.1\.json/.test(app.overlay()) && !/data-act="prop-apply"/.test(app.overlay()));
  app.click('prop-apply', p.id); await app.tick(160);
  assert.ok(/title: Production release/.test(app.fs.files[DRAFT].t));
});

rule('A process with only a proposal is listed on Processes and has a page with it; applying it creates the draft', async () => {
  const app = await page(), md = '---\nprocess: onboard\ntitle: Onboarding\ncategory: People\nowner: person-casey\n---\n\n## First · READ-DO {#first}\n- [ ] {confirm} Say hello {#hello}\n';
  const p = app.PF.proposals.make({ id: 'p-b1-aaaaaaaaaa', process: 'onboard', session: 's-k3m9p2q8x7w1', label: 'assistant', by: 'person-avery', at: new Date().toISOString(), app: '1.19.0', base: { kind: 'none', ref: null, text: '' }, text: md, replaces: null, after: null, note: '' });
  app.fs.files['proposed/onboard/' + p.id + '.json'] = { t: JSON.stringify(p), m: 1 };
  await refresh(app);
  app.click('nav', 'processes'); await app.tick();
  assert.ok(/Proposed, not drafted yet/.test(app.html()));
  app.click('open-process', 'onboard'); await app.tick();
  assert.ok(/Proposed changes · 1/.test(app.html()));
  app.click('prop-apply', p.id); await app.tick(200);
  assert.strictEqual(app.fs.files['maps/drafts/onboard.md'].t, md);
});

rule('Who is editing: a window holding a draft editor writes its presence; another window shows it and Edit anyway; Make this the main editor claims it', async () => {
  const files = {}, L = locks(), Channel = bus();
  const a = await page({ sharedFiles: files, locks: L, Channel });
  const b = await page({ sharedFiles: files, locks: L, Channel, me: 'person-avery' });
  b.click('ptab', 'edit'); await b.tick(); b.every(); await b.tick(40);
  const pres = Object.keys(files).filter(k => /^presence\//.test(k));
  assert.strictEqual(pres.length, 1, 'one presence file, for the window holding the editor');
  const rec = JSON.parse(files[pres[0]].t);
  assert.deepStrictEqual([rec.kind, rec.by, rec.drafts], ['presence', 'person-avery', ['release']]);
  await refresh(a);
  assert.ok(/Being edited by Avery Lee/.test(a.html()) && /Flightdeck shows the editors this computer can see right now\./.test(a.html()), a.html().slice(0, 300));
  assert.ok(/Edit anyway/.test(a.html()));
  a.click('ptab', 'edit'); await a.tick(); a.every(); await a.tick(40);
  assert.ok(/data-act="main-editor"/.test(a.html()));
  a.click('main-editor'); await a.tick(80);
  const mine = Object.keys(files).filter(k => /^presence\//.test(k)).map(k => JSON.parse(files[k].t)).filter(r => r.by === 'person-casey')[0];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(mine.main)), [{ process: 'release', claimRev: 1, seen: null }]);
  assert.ok(/This is the main editor for this draft\./.test(a.html()));
  await refresh(b);
  assert.ok(/Casey Nguyen made their editor the main one for this draft\. You can still edit and save\./.test(b.html()));
  // Leaving the editor with nothing unsaved removes the presence file.
  b.click('ed-done'); await b.tick(); b.every(); await b.tick(40);
  assert.ok(!Object.keys(files).some(k => /^presence\//.test(k) && JSON.parse(files[k].t).by === 'person-avery'), 'gone once no editor is held');
});

rule('A slow folder read that finishes after this window saved never puts back the older draft it read', async () => {
  const app = await page(), A = app.fs.files[DRAFT].t, B = retitle(app, 'B'), read = app.fs.read.bind(app.fs);
  let hold = gate(), armed = true;
  app.fs.read = (p, o) => { const r = read(p, o); if (p === DRAFT && armed) { armed = false; return r.then(v => hold.p.then(() => v)); } return r; };
  app.click('refresh'); await app.tick(5);
  app.click('ptab', 'edit'); await app.tick();
  app.input('draft-editor', B); await app.tick(300);
  app.click('save-draft'); await app.tick(120);
  assert.strictEqual(app.fs.files[DRAFT].t, B);
  hold.open(); await app.tick(120); app.fs.read = read;
  app.click('ed-done'); await app.tick();
  const p = plant(app, { id: 'p-c1-aaaaaaaaaa', text: B.replace('title: B', 'title: C'), base: B });
  app.click('refresh'); await app.tick(120);
  assert.ok(/data-act="prop-apply" data-id="p-c1-aaaaaaaaaa"/.test(app.html()), 'judged against B, the draft as saved, not the stale A');
  assert.ok(A !== B && p);
});

rule('Publishing while a proposal arrives publishes the draft shown; the proposal stays, judged against the draft', async () => {
  const app = await page(), md = retitle(app, 'To publish');
  app.click('ptab', 'edit'); await app.tick();
  app.input('draft-editor', md); await app.tick(300);
  app.click('save-draft'); await app.tick(120);
  app.click('ed-done'); await app.tick();
  const p = plant(app, { text: md.replace('title: To publish', 'title: Proposed') });
  app.set('change-note', 'Retitle');
  app.click('publish', 'release'); await app.tick(200);
  const pubs = app.files('publications/release/').filter(x => /map\.md$/.test(x)).map(x => app.fs.files[x].t);
  assert.ok(pubs.some(t => /title: To publish/.test(t)) && !pubs.some(t => /title: Proposed/.test(t)), 'published what was shown');
  await refresh(app);
  assert.ok(new RegExp('data-act="prop-apply" data-id="' + p.id + '"').test(app.html()), 'the proposal is still a fast-forward');
});

rule('The size limit: saving and Keep mine refuse a draft over 1 MB with the size and what to cut, and keep the text (Restore, corrections and new drafts go through the same check)', async () => {
  const app = await page(), head = retitle(app, 'Big') + '\n', big = head + 'x'.repeat(Math.floor(1.2 * 1048576) - app.PF.util.utf8Bytes(head));
  app.click('ptab', 'edit'); await app.tick();
  app.input('draft-editor', big); await app.tick(300);
  assert.ok(/1\.2[0-9]? of 1 MB|of 1 MB/.test(app.html()), 'the size in the header');
  app.click('save-draft'); await app.tick(120);
  assert.ok(said(app, /Not saved: this draft is 1\.2 MB, and Flightdeck saves drafts up to 1 MB\. Shorten it by about 0\.2 MB \(long notes or pasted logs are the usual cause\), then save\. Your text is still here\./));
  assert.ok(/title: Production release/.test(app.fs.files[DRAFT].t), 'nothing written');
  assert.ok(/Unsaved changes/.test(app.html()), 'still unsaved, still here');
  // Keep mine over someone else's change: refused the same way.
  await app.fs.write(DRAFT, retitle(app, 'Theirs'));
  app.input('draft-editor', retitle(app, 'Mine')); await app.tick(300);
  app.click('save-draft'); await app.tick(120);
  assert.ok(/Someone else changed this draft/.test(app.html()));
  app.input('draft-editor', big); await app.tick(300);
  app.click('draft-keep-mine'); await app.tick(120);
  assert.ok(said(app, /Not saved: this draft is 1\.2 MB/));
  assert.ok(/title: Theirs/.test(app.fs.files[DRAFT].t));
});

/* ---------- review 1 ---------- */
rule('Review 1: Apply rereads the process\'s proposals: a replacement that arrived since the page was drawn stops it', async () => {
  const app = await page(), p1 = plant(app, { id: 'p-a1-aaaaaaaaaa', text: retitle(app, 'B') });
  await refresh(app);
  plant(app, { id: 'p-a2-bbbbbbbbbb', text: retitle(app, 'C'), replaces: p1.id });
  await applied(app, p1);
  assert.ok(/title: Production release/.test(app.fs.files[DRAFT].t), 'not applied');
  assert.deepStrictEqual(recs(app, p1.id), [], 'no attempt');
  assert.ok(said(app, /A newer proposal replaces this one/));
});

rule('Review 1: Decline after an interrupted attempt settles it: Declined, with Reopen, and nothing says May already be applied', async () => {
  const app = await page(), p = plant(app, { text: retitle(app, 'B') }), PP = app.PF.proposals;
  const at = PP.attempt({ proposal: p.id, proposalRev: p.rev, writer: 'zz1', n: 1, how: 'apply', from: null, by: 'person-avery', at: new Date().toISOString() });
  app.fs.files['proposed/release/' + at.name] = { t: JSON.stringify(at.rec), m: 1 };
  await refresh(app);
  await review(app, p.id);
  app.click('prop-decline', p.id); await app.tick(160);
  const d = recs(app, p.id).filter(r => r.rec.kind === 'proposal-decision')[0].rec;
  assert.deepStrictEqual([d.status, d.settles], ['declined', ['zz1.1']]);
  await refresh(app);
  assert.ok(/data-act="prop-reopen" data-id="p-mh4k2a-x7w1k3m9p2"/.test(app.html()) && !/May already be applied/.test(app.html()));
});

rule('Review 1: a decision is refused while a record about the proposal can\'t be read, and no success is announced', async () => {
  const app = await page(), p = plant(app, { text: retitle(app, 'B') });
  await refresh(app);
  app.fs.files['proposed/release/' + p.id + '.zz9.10.json'] = { t: '{"kind":"proposal-deci', m: 1 };
  app.click('prop-decline', p.id); await app.tick(160);
  assert.deepStrictEqual(recs(app, p.id).filter(r => r.name !== p.id + '.zz9.10.json').length, 0, 'nothing written');
  assert.ok(!said(app, /^Declined/) && said(app, /can.t be read yet/));
});

rule('Review 2: two decisions made at once in one window take turns: each gets its own revision and file, and neither is lost', async () => {
  const app = await page(), p = plant(app, { text: retitle(app, 'B') }), PP = app.PF.proposals;
  const at = PP.attempt({ proposal: p.id, proposalRev: p.rev, writer: 'zz1', n: 1, how: 'apply', from: null, by: 'person-avery', at: new Date().toISOString() });
  app.fs.files['proposed/release/' + at.name] = { t: JSON.stringify(at.rec), m: 1 };
  await refresh(app); await review(app, p.id);
  const g = gate(), write = app.fs.write.bind(app.fs);
  app.fs.write = (path, t) => /proposed\/release\/p-mh4k2a-x7w1k3m9p2\.\w+\.\d+\.json$/.test(path) && !/attempt/.test(path) ? g.p.then(() => write(path, t)) : write(path, t);
  app.click('prop-mark-applied', p.id); await app.tick(20);
  app.click('prop-decline', p.id); await app.tick(20);
  g.open(); await app.tick(200); app.fs.write = write;
  const ds = recs(app, p.id).filter(r => r.rec.kind === 'proposal-decision').map(r => [r.rec.decisionRev, r.rec.status]).sort();
  assert.deepStrictEqual(ds, [[1, 'applied'], [2, 'declined']]);
});

run();
