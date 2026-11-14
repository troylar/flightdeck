// Keep for next time (4.0, docs/design.md 45.3) in the app, slice 5: one button on a to-do keeps it as a suggestion for its
// checklist (one keep record, nothing else; the run doesn't change). The to-do then says where that stands (Suggested,
// Applied to draft, Published in vN) and opens its correction; the correction shows every source and each wording, and only
// the checklist's active owner reviews, applies or declines it. Placing and rewording go through flightdeck todo keep.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');
const { race } = require('./race-harness');

const MD = ['---', 'process: release-notes', 'title: Release notes', 'owner: person-morgan', '---', '',
  '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', '',
  '## Review · READ-DO {#review}', '- [!] {confirm} Read them {#read}', ''].join('\n');

async function setup() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const b = PF.publish.build(MD, { people, ...require('./harness').exampleSetup(PF), by: 'person-morgan', changes: 'First', existing: [], now, rand: 'rn000001', app: '4.0.0' });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  Object.keys(b.files).forEach(k => { app.fs.files['publications/release-notes/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-notes'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  assert.ok(runPath(app), 'set-up: a run was started');
  return app;
}
const runPath = (app) => app.files('runs/release-notes/').find(p => /run\.json$/.test(p));
const theRun = (app) => JSON.parse(app.fs.files[runPath(app)].t);
const recs = (app) => app.files('proposals/').filter(p => /^proposals\/req-/.test(p));
const keeps = (app) => recs(app).map(p => JSON.parse(app.fs.files[p].t)).filter(x => x.kind === 'keep');
const refresh = async (app, ms) => { app.click('refresh'); await app.tick(ms || 250); };
const txt = (h) => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
async function added(app, text) {
  app.set('td-add', text); app.click('td-add'); await app.tick(120);
  await refresh(app, 400);
  const d = await app.PF.repo.loadAll(app.fs, {});
  return app.PF.todos.view(app.PF.run.sanitize(theRun(app)), { records: d.todos, people: JSON.parse(app.fs.files['people.json'].t) }).todos.filter(x => x.text === text)[0].id;
}
const backToRun = (app) => { const r = theRun(app); app.click('open-run', r.process + '/' + r.id); };
const groupId = (app) => { const m = /data-act="keep-open"[^>]*data-id="([^"]+)"/.exec(app.html()) || /data-id="([^"]+)"[^>]*data-act="keep-open"/.exec(app.html()); return m ? m[1] : null; };

rule('Keep for next time writes exactly one keep for the run\'s checklist, changes nothing on the run, and says where it stands', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes');
  const runBefore = app.fs.files[runPath(app)].t, before = recs(app).length;
  assert.ok(/data-act="keep"/.test(app.html()), 'the button on the to-do');
  app.click('keep', id, { kind: 'todo' }); await app.tick(120);
  const ks = keeps(app);
  assert.strictEqual(recs(app).length, before + 1, 'exactly one record');
  assert.deepStrictEqual([ks.length, ks[0].by, ks[0].source, ks[0].template.process, ks[0].anchor, ks[0].change], [1, 'person-avery', { todo: id }, 'release-notes', { phase: 'draft' }, { op: 'add', text: 'Post the release notes', where: 'end' }]);
  assert.ok(/Suggest for next time in release-notes v1: add "Post the release notes" at the end of phase draft/.test(txt(app.html())), 'said');
  assert.strictEqual(app.fs.files[runPath(app)].t, runBefore, 'the run doesn\'t change');
  await refresh(app, 300);
  assert.ok(/Suggested for next time in release-notes · Suggested\.|Suggested for next time in release-notes\./.test(txt(app.html())), txt(app.html()).slice(0, 3000));
  assert.ok(groupId(app), 'linked to its correction');
  assert.ok(!/data-act="keep" /.test(app.html()) || !new RegExp('data-act="keep"[^>]*data-id="' + id + '"').test(app.html()), 'kept once: no button now');
  app.click('keep', id, { kind: 'todo' }); await app.tick(120);
  assert.strictEqual(keeps(app).length, 1, 'asking again files nothing more');
});

rule('The to-do opens its correction, which shows its source; only the checklist\'s owner reviews and decides it', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes');
  app.click('keep', id, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
  const gid = groupId(app);
  app.click('keep-open', gid, { process: 'release-notes' }); await app.tick(120);
  let h = app.html();
  assert.ok(/id="fx-h"/.test(h), 'on the checklist\'s page, at its corrections');
  assert.ok(h.indexOf('fxg-' + gid) >= 0, 'the group is shown');
  assert.ok(/Kept for next time/.test(txt(h)), 'from a keep');
  assert.ok(/Only the checklist's owner, Morgan Diaz, reviews what was kept for next time/.test(txt(h)), 'the owner rule said');
  assert.ok(!new RegExp('data-act="corr-review" data-id="' + gid + '"').test(h), 'no Review for someone else');
  const n = app.files('corrections/').length;
  app.click('corr-applied', gid); await app.tick(120);
  assert.strictEqual(app.files('corrections/').length, n, 'a decision by someone else writes nothing');
  app.choose('person-morgan'); await app.tick(80);
  h = app.html();
  assert.ok(new RegExp('data-act="corr-review" data-id="' + gid + '"').test(h), 'the owner reviews it');
  app.click('corr-applied', gid); await app.tick(160);
  assert.strictEqual(app.files('corrections/').length, n + 1, 'the owner\'s decision is written');
  backToRun(app); await app.tick(120); await refresh(app, 300);
  assert.ok(/Kept for next time in release-notes · Applied to draft\./.test(txt(app.html())), 'the to-do says it, linked both ways');
});

/* A keep applied to the draft by the owner, Morgan: the draft has the step and the group is Applied to draft. */
async function appliedKeep() {
  const app = await setup(), id = await added(app, 'Post the release notes');
  app.click('keep', id, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
  const gid = groupId(app);
  app.click('keep-open', gid, { process: 'release-notes' }); await app.tick(120);
  app.choose('person-morgan'); await app.tick(80);
  app.click('corr-review', gid); await app.tick(60);
  app.click('corr-apply', gid); await app.tick(300);
  await refresh(app, 300);
  assert.ok(/Post the release notes/.test(app.fs.files['maps/drafts/release-notes.md'].t), 'set-up: the draft has it');
  assert.ok(app.files('corrections/').length >= 1, 'set-up: applied');
  return { app, gid };
}
async function groupNow(app, gid) {
  const PF = app.PF, d = await PF.repo.loadAll(app.fs, {}), p = d.processes.filter(x => x.process === 'release-notes')[0];
  return PF.corrections.forProcess(d.runs.filter(r => r.process === 'release-notes'), 'release-notes', d.corrDecisions, p ? p.index : null, PF.learn.members(d.todos, d.runs, 'release-notes')).filter(x => x.id === gid)[0];
}
/* A valid newer version of release-notes, owned by Blake, published into fs: ownership moves mid-write. */
async function transfer(app, fs) {
  const PF = app.PF, people = JSON.parse(fs.files['people.json'].t), have = Object.keys(fs.files).filter(p => /^publications\/release-notes\/v\d+-[^/]+\/publication\.json$/.test(p));
  const existing = have.map(p => ({ version: PF.publish.versionOf(p.split('/')[2]) }));
  const b = PF.publish.build(MD.replace('owner: person-morgan', 'owner: person-blake'), { people, ...require('./harness').exampleSetup(PF), by: 'person-blake', changes: 'Owner', existing, now: new Date().toISOString(), rand: 'ow' + String(existing.length).padStart(6, '0'), app: '4.0.0' });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  Object.keys(b.files).forEach(k => { fs.files['publications/release-notes/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
}
const versions = (app) => app.files('publications/release-notes/').filter(p => /publication\.json$/.test(p)).length;
const openPage = async (app) => { app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release-notes'); await app.tick(60); };

rule('Publishing a version that includes a keep is the active owner\'s: anyone else publishes nothing; an unrelated version publishes as before', async () => {
  const { app } = await appliedKeep();
  const n = versions(app);
  app.choose('person-avery'); await app.tick(80); await openPage(app);
  app.set('change-note', 'Post the notes'); app.click('publish', 'release-notes'); await app.tick(300);
  assert.strictEqual(versions(app), n, 'nothing published by someone else');
  assert.ok(/kept for next time/.test(txt(app.html())) && /owner/.test(txt(app.html())), 'said why: ' + (txt(app.html()).match(/Nothing was published[^.]*\.[^.]*\./) || [])[0]);
  /* The owner changes to someone else right before the write: the check at the write refuses it too. */
  app.choose('person-morgan'); await app.tick(80); await openPage(app);
  const fs = app.fs, read = fs.read.bind(fs); let release = null;
  fs.read = (p, o) => /^maps\/drafts\/release-notes\.md$/.test(p) && !release ? new Promise((res) => { release = () => res(read(p, o)); }) : read(p, o);
  app.set('change-note', 'Post the notes'); app.click('publish', 'release-notes'); await app.tick(40);
  assert.ok(release, 'the draft is being read');
  const ppl = JSON.parse(fs.files['people.json'].t); (Array.isArray(ppl) ? ppl : ppl.people).forEach(p => { if (p.id === 'person-morgan') p.inactive = true; }); fs.files['people.json'] = { t: JSON.stringify(ppl), m: Date.now() };
  release(); await app.tick(300); fs.read = read;
  assert.strictEqual(versions(app), n, 'nothing published once the owner is inactive at the write');
  (Array.isArray(ppl) ? ppl : ppl.people).forEach(p => { if (p.id === 'person-morgan') delete p.inactive; }); fs.files['people.json'] = { t: JSON.stringify(ppl), m: Date.now() };
  await refresh(app, 300); await openPage(app);
  app.set('change-note', 'Post the notes'); app.click('publish', 'release-notes'); await app.tick(300);
  assert.strictEqual(versions(app), n + 1, 'the owner publishes it');
  /* A version without keeps: anyone publishes, as before. */
  const other = await setup(), m = versions(other), dp = 'maps/drafts/release-notes.md';
  const md = other.fs.files[dp] ? other.fs.files[dp].t : MD;
  await other.fs.write(dp, md.replace('- [!] {confirm} Read them {#read}', '- [!] {confirm} Read them {#read}\n- [ ] {confirm} File them {#file}'));
  await refresh(other, 300); await openPage(other);
  other.set('change-note', 'File them'); other.click('publish', 'release-notes'); await other.tick(300);
  assert.strictEqual(versions(other), m + 1, 'someone other than the owner publishes a version without keeps');
});

rule('A keep applied and then reopened by a new wording still publishes only through its owner, and the owner\'s version lists it', async () => {
  const { app, gid } = await appliedKeep();
  app.choose('person-avery'); await app.tick(80);
  backToRun(app); await app.tick(80);
  const b = await added(app, 'Publish the notes to the wiki');
  app.click('keep', b, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
  const g = await groupNow(app, gid);
  assert.ok(g && g.status === 'open' && g.reviewed, 'set-up: the new wording reopened the group');
  const n = versions(app);
  await openPage(app);
  app.set('change-note', 'Post the notes'); app.click('publish', 'release-notes'); await app.tick(300);
  assert.strictEqual(versions(app), n, 'nothing published by someone else while a new wording is open');
  assert.ok(/kept for next time/.test(txt(app.html())), 'said why');
  app.choose('person-morgan'); await app.tick(80); await openPage(app);
  app.set('change-note', 'Post the notes'); app.click('publish', 'release-notes'); await app.tick(300);
  assert.strictEqual(versions(app), n + 1, 'the owner publishes it');
  const pub = app.files('publications/release-notes/').filter(p => /publication\.json$/.test(p)).map(p => JSON.parse(app.fs.files[p].t)).sort((x, y) => y.version - x.version)[0];
  assert.deepStrictEqual((pub.corrections || []).map(x => x.id || x), [gid], 'the applied wording is listed as published');
  await refresh(app, 300);
  const after = await groupNow(app, gid);
  assert.ok(after.status === 'open' && after.reviewedLanded && after.reviewedLanded.version === pub.version, 'the new wording stays open; what was reviewed is published');
});

rule('A keep record that can\'t be read holds publishing and promoting a version that may include it: never published past the owner check', async () => {
  const { app } = await appliedKeep();
  await openPage(app);
  app.set('change-note', 'Post the notes'); app.click('stage-draft', 'release-notes'); await app.tick(300);
  const st = app.files('staged/release-notes/').filter(f => /publication\.json$/.test(f)), folder = JSON.parse(app.fs.files[st[0]].t).folder, n = versions(app);
  const kf = app.files('proposals/req-keep-')[0];
  assert.ok(kf, 'set-up: the keep record');
  app.fs.files[kf] = { t: app.fs.files[kf].t.slice(0, 40), m: Date.now() };
  app.choose('person-avery'); await app.tick(80); await refresh(app, 300); await openPage(app);
  app.click('promote-stage', folder); await app.tick(300);
  assert.strictEqual(versions(app), n, 'nothing promoted while the keep can\'t be read');
  app.set('change-note', 'Post the notes'); app.click('publish', 'release-notes'); await app.tick(300);
  assert.strictEqual(versions(app), n, 'nothing published while the keep can\'t be read');
  assert.ok(/can.t be read/.test(txt(app.html())), 'said why: ' + txt(app.html()).slice(0, 600));
});

rule('A stage listing a keep whose record was deleted holds the promote; one whose correction can\'t be classified at all needs the owner', async () => {
  for (const how of ['keep', 'keep and decisions']) {
    const { app } = await appliedKeep();
    await openPage(app);
    app.set('change-note', 'Post the notes'); app.click('stage-draft', 'release-notes'); await app.tick(300);
    const st = app.files('staged/release-notes/').filter(f => /publication\.json$/.test(f)), folder = JSON.parse(app.fs.files[st[0]].t).folder, n = versions(app);
    assert.ok((JSON.parse(app.fs.files[st[0]].t).corrections || []).length, 'set-up: the stage includes the keep');
    app.files('proposals/req-keep-').forEach(f => { delete app.fs.files[f]; });
    const decs = Object.keys(app.fs.files).filter(f => { try { return JSON.parse(app.fs.files[f].t).kind === 'correction-decision'; } catch (e) { return false; } });
    assert.ok(decs.length, 'set-up: a decision on the keep');
    if (how !== 'keep') decs.forEach(f => { delete app.fs.files[f]; });
    app.choose('person-avery'); await app.tick(80); await refresh(app, 300); await openPage(app);
    app.click('promote-stage', folder); await app.tick(300);
    assert.strictEqual(versions(app), n, how + ' deleted: nothing promoted by someone else');
    assert.ok(/kept for next time/.test(txt(app.html())), how + ': said why: ' + txt(app.html()).slice(0, 400));
    app.choose('person-morgan'); await app.tick(80); await refresh(app, 300); await openPage(app);
    app.click('promote-stage', folder); await app.tick(300);
    assert.strictEqual(versions(app), how === 'keep' ? n : n + 1, how === 'keep' ? 'a missing keep is held, for the owner too' : 'unclassified: the owner promotes it');
  }
});

/* MA: whether a version includes what was kept comes from the decisions that applied it and the content they recorded, read
   again inside the guard: an explicit Reopen, a deleted keep, or one deleted member of a group never takes the owner check
   away, with or without a refresh, for Publish and Promote alike. */
rule('Kept content needs its owner from durable proof read at the write: Reopen, a deleted keep and a deleted member, for Publish and Promote, refreshed or cached', async () => {
  const stage = async (app) => {
    await openPage(app); app.set('change-note', 'Post the notes'); app.click('stage-draft', 'release-notes'); await app.tick(300);
    const st = app.files('staged/release-notes/').filter(f => /publication\.json$/.test(f));
    assert.strictEqual(st.length, 1, 'set-up: staged'); return JSON.parse(app.fs.files[st[0]].t).folder;
  };
  const del = (app, f) => { assert.ok(app.fs.files[f], 'set-up: ' + f); delete app.fs.files[f]; };
  for (const how of ['reopen', 'deleted', 'member']) for (const path of ['publish', 'promote']) for (const mode of ['refresh', 'cached']) {
    const label = how + ' · ' + path + ' · ' + mode, { app, gid } = await appliedKeep(), k1 = app.files('proposals/req-keep-')[0];
    if (how === 'reopen') { await openPage(app); app.click('corr-reopen', gid); await app.tick(300); await refresh(app, 300); assert.strictEqual((await groupNow(app, gid)).status, 'open', label + ': set-up: reopened'); }
    if (how === 'member') {
      app.choose('person-avery'); await app.tick(80); backToRun(app); await app.tick(80);
      const b = await added(app, 'Publish the notes to the wiki'); app.click('keep', b, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
      assert.strictEqual(app.files('proposals/req-keep-').length, 2, label + ': set-up: two keeps');
    }
    const folder = path === 'promote' ? await stage(app) : null, n = versions(app);
    app.choose('person-avery'); await app.tick(80); await refresh(app, 300); await openPage(app);
    if (how === 'deleted') del(app, k1);
    if (how === 'member') del(app, k1);
    if (mode === 'refresh') { await refresh(app, 300); await openPage(app); }
    const go = async () => { if (path === 'publish') { app.set('change-note', 'Post the notes'); app.click('publish', 'release-notes'); } else app.click('promote-stage', folder); await app.tick(400); };
    await go();
    assert.strictEqual(versions(app), n, label + ': nothing published by someone else');
    assert.ok(/kept for next time/.test(txt(app.html())), label + ': said why: ' + (txt(app.html()).match(/Nothing was published[^.]*\.[^.]*\./) || [])[0]);
    app.choose('person-morgan'); await app.tick(80); await refresh(app, 300); await openPage(app);
    await go();
    assert.strictEqual(versions(app), how === 'reopen' ? n + 1 : n, label + (how === 'reopen' ? ': the owner publishes it' : ': a keep it rests on is gone: held for the owner too'));
  }
});

/* OA: lost proof never frees kept content while any trace of it survives. Every way of losing it (the keep, the decision,
   the keep deleted with its decision truncated, one member, a truncated keep or decision, Reopen with the decisions deleted,
   and staging before that) × Publish and Promote × refreshed and cached: someone else publishes nothing; the owner publishes,
   unless a keep a readable decision names is gone or any proof can't be read (QA: held for everyone). With every trace deleted (both-deleted), the draft is
   a hand edit, which anyone may publish: the documented limit (design.md 45.3); a stage that still lists it is a trace. */
const OA_WAYS = ['keep', 'decision', 'both-trunc', 'both-deleted', 'member', 'trunc-keep', 'trunc-decision', 'reopen', 'staged', 'copy-differs'];
rule('Lost proof never lets anyone but the owner publish kept content: every way of losing it, for Publish and Promote, refreshed or cached', async () => {
  const stage = async (app) => {
    await openPage(app); app.set('change-note', 'Post the notes'); app.click('stage-draft', 'release-notes'); await app.tick(300);
    const st = app.files('staged/release-notes/').filter(f => /publication\.json$/.test(f));
    assert.strictEqual(st.length, 1, 'set-up: staged'); return JSON.parse(app.fs.files[st[0]].t).folder;
  };
  const decFiles = (app) => Object.keys(app.fs.files).filter(f => /^corrections\//.test(f) && (() => { try { return JSON.parse(app.fs.files[f].t).kind === 'correction-decision'; } catch (e) { return false; } })());
  const cut = (app, f) => { app.fs.files[f] = { t: app.fs.files[f].t.slice(0, 20), m: Date.now() }; };
  let checks = 0;
  const ways = OA_WAYS.filter(h => !process.env.OA_WAY || process.env.OA_WAY.split(',').indexOf(h) >= 0);
  for (const how of ways) for (const path of ['publish', 'promote']) for (const mode of ['refresh', 'cached']) {
    const label = how + ' · ' + path + ' · ' + mode, { app, gid } = await appliedKeep(), k1 = app.files('proposals/req-keep-')[0];
    let folder = null;
    if (how === 'staged') folder = await stage(app);
    if (how === 'member') {
      app.choose('person-avery'); await app.tick(80); backToRun(app); await app.tick(80);
      const b = await added(app, 'Publish the notes to the wiki'); app.click('keep', b, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
      assert.strictEqual(app.files('proposals/req-keep-').length, 2, label + ': set-up: two keeps');
      app.choose('person-morgan'); await app.tick(80);
    }
    if (how === 'reopen' || how === 'staged') { await refresh(app, 300); await openPage(app); app.click('corr-reopen', gid); await app.tick(300); await refresh(app, 300); assert.strictEqual((await groupNow(app, gid)).status, 'open', label + ': set-up: reopened'); }
    if (path === 'promote' && !folder) folder = await stage(app);
    const n = versions(app), ds = decFiles(app);
    assert.ok(ds.length, label + ': set-up: decisions');
    app.choose('person-avery'); await app.tick(80); await refresh(app, 300); await openPage(app);
    if (how === 'keep' || how === 'both-trunc' || how === 'both-deleted' || how === 'member') delete app.fs.files[k1];
    if (how === 'trunc-keep') cut(app, k1);
    /* AC: a valid copy of the keep that differs (only its reason): which one was kept can't be told, so it holds. */
    if (how === 'copy-differs') { const o = JSON.parse(app.fs.files[k1].t); o.reason = 'Another reason'; app.fs.files[k1.replace(/\.json$/, ' (1).json')] = { t: JSON.stringify(o, null, 2) + '\n', m: Date.now() }; }
    if (how === 'decision' || how === 'both-deleted' || how === 'reopen' || how === 'staged') ds.forEach(f => { delete app.fs.files[f]; });
    if (how === 'both-trunc' || how === 'trunc-decision') ds.forEach(f => cut(app, f));
    if (mode === 'refresh') { await refresh(app, 300); await openPage(app); }
    const go = async () => { if (path === 'publish') { app.set('change-note', 'Post the notes'); app.click('publish', 'release-notes'); } else app.click('promote-stage', folder); await app.tick(400); };
    await go();
    if (how === 'both-deleted' && path === 'publish') {
      /* Cached, the window still shows the keep it last read and refuses at the click; once it reads the folder, the draft is
         a hand edit, which anyone publishes (the documented limit). */
      if (mode === 'cached') { assert.strictEqual(versions(app), n, label + ': the window\'s last read still shows the keep'); await refresh(app, 300); await openPage(app); await go(); }
      assert.strictEqual(versions(app), n + 1, label + ': every trace deleted is a hand edit of the draft, which anyone publishes (the documented limit)'); checks += 2; continue;
    }
    assert.strictEqual(versions(app), n, label + ': nothing published by someone else'); checks++;
    assert.ok(/kept for next time/.test(txt(app.html())), label + ': said why: ' + (txt(app.html()).match(/Nothing was (published|promoted)[^.]*\.[^.]*\./) || [])[0]);
    app.choose('person-morgan'); await app.tick(80); await refresh(app, 300); await openPage(app);
    await go();
    const held = how === 'keep' || how === 'member' || how === 'trunc-keep' || how === 'both-trunc' || how === 'trunc-decision' || how === 'copy-differs';
    assert.strictEqual(versions(app), held ? n : n + 1, label + (held ? ': a keep a decision names is gone: held for the owner too' : ': the owner publishes it')); checks++;
  }
  assert.strictEqual(checks, ways.length * 2 * 2 * 2, 'the whole matrix ran');
});

/* The documented limit: the owner requirement guards the keep workflow, not a folder writer who erases every trace. A kept
   step whose keep and every decision are deleted is exactly a hand edit of the draft: published by anyone, the same as the
   same step typed by hand, and ordinary corrections and direct edits are unchanged. */
rule('A kept step with every trace deleted publishes exactly like the same step typed into the draft by hand', async () => {
  const { app } = await appliedKeep(), draft = app.fs.files['maps/drafts/release-notes.md'].t;
  Object.keys(app.fs.files).filter(f => /^proposals\/req-keep-/.test(f) || /^corrections\//.test(f)).forEach(f => { delete app.fs.files[f]; });
  const hand = await setup();
  await hand.fs.write('maps/drafts/release-notes.md', draft);
  const out = [];
  for (const a of [app, hand]) {
    const n = versions(a);
    a.choose('person-avery'); await a.tick(80); await refresh(a, 300); await openPage(a);
    a.set('change-note', 'Post the notes'); a.click('publish', 'release-notes'); await a.tick(400);
    const pub = a.files('publications/release-notes/').filter(p => /publication\.json$/.test(p)).map(p => JSON.parse(a.fs.files[p].t)).sort((x, y) => y.version - x.version)[0];
    out.push([versions(a) - n, pub.corrections || [], a.fs.files['publications/release-notes/' + pub.folder + '/map.md'].t]);
  }
  assert.deepStrictEqual(out[0], out[1], 'the same as a hand edit');
  assert.strictEqual(out[0][0], 1, 'published by someone other than the owner');
});

rule('A keep checks the 500 limit on the keep records read again at the write: one filed meanwhile by another writer stops the 501st', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes'), id2 = await added(app, 'Email the release notes');
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t);
  const file = async (text, todo) => {
    const d = await PF.repo.loadAll(app.fs, {}), r = PF.run.sanitize(theRun(app));
    const K = PF.learn.prepare(r, { source: { todo }, text, by: { person: 'person-blake' }, records: d.todos, unread: d.todosUnread, people, at: new Date().toISOString(), app: '4.0.0' });
    assert.ok(!K.why, K.why); app.fs.files['proposals/' + K.name] = { t: PF.todos.text(K.file), m: Date.now() }; return K;
  };
  /* 499 wordings kept at one place, read by this window. */
  const d0 = await PF.repo.loadAll(app.fs, {}), r0 = PF.run.sanitize(theRun(app));
  const first = PF.learn.prepare(r0, { source: { todo: id }, by: { person: 'person-blake' }, records: d0.todos, unread: d0.todosUnread, people, at: new Date().toISOString(), app: '4.0.0' });
  assert.ok(!first.why, first.why);
  const recs = [];
  for (let i = 0; i < 499; i++) { const K = PF.learn.prepare(r0, { source: { todo: id }, text: 'Wording ' + i, by: { person: 'person-blake' }, records: d0.todos.concat(recs), unread: [], people, at: new Date().toISOString(), app: '4.0.0' }); assert.ok(!K.why, K.why); recs.push(Object.assign(K.record, { _file: K.name })); app.fs.files['proposals/' + K.name] = { t: PF.todos.text(K.file), m: Date.now() }; }
  await refresh(app, 1500);
  const before = app.files('proposals/req-keep-').length;
  assert.strictEqual(before, 499, 'set-up: 499 keeps');
  /* Another writer files the 500th; this window hasn't read it. */
  await file('Wording 499', id);
  app.click('keep', id2, { kind: 'todo' }); await app.tick(600);
  assert.strictEqual(app.files('proposals/req-keep-').length, 500, 'no 501st keep was filed');
  assert.ok(/500/.test(txt(app.html())), 'said why: ' + (txt(app.html()).match(/Nothing was kept[^.]*\.[^.]*\./) || [])[0]);
});

/* OB: filing a keep counts and writes one place at a time in a window, and a group pushed past 500 anyway (two computers)
   stays recoverable: its owner sees the overflow and withdraws members no decision names, as their author can; Apply stays
   refused until it is back within the limit. */
async function keeps499(app, id) {
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), d0 = await PF.repo.loadAll(app.fs, {}), r0 = PF.run.sanitize(theRun(app)), recs = [];
  for (let i = 0; i < 499; i++) { const K = PF.learn.prepare(r0, { source: { todo: id }, text: 'Wording ' + i, by: { person: 'person-blake' }, records: d0.todos.concat(recs), unread: [], people, at: new Date().toISOString(), app: '4.0.0' }); assert.ok(!K.why, K.why); recs.push(Object.assign(K.record, { _file: K.name })); app.fs.files['proposals/' + K.name] = { t: PF.todos.text(K.file), m: Date.now() }; }
  return recs;
}
rule('Two keeps clicked at once in one window count one at a time: the second sees the first and stops at 500', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes'), id2 = await added(app, 'Email the release notes');
  await keeps499(app, id); await refresh(app, 1500);
  assert.strictEqual(app.files('proposals/req-keep-').length, 499, 'set-up: 499 keeps');
  app.click('keep', id, { kind: 'todo' }); app.click('keep', id2, { kind: 'todo' }); await app.tick(1200);
  assert.strictEqual(app.files('proposals/req-keep-').length, 500, 'one filed, the other refused at the limit');
  assert.ok(/500/.test(txt(app.html())), 'said why');
});
rule('A group over 500 stays recoverable: its owner sees the overflow and withdraws members no decision names; Apply stays refused until then', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes'), PF = app.PF;
  const recs = await keeps499(app, id), people = JSON.parse(app.fs.files['people.json'].t), r0 = PF.run.sanitize(theRun(app));
  /* Two more filed at once on other computers: 501. */
  const base = (await PF.repo.loadAll(app.fs, {})).todos.filter(x => x.kind !== 'keep');
  for (const w of ['Late wording A', 'Late wording B']) { const K = PF.learn.prepare(r0, { source: { todo: id }, text: w, by: { person: 'person-casey' }, records: base, unread: [], people, at: new Date().toISOString(), app: '4.0.0' }); assert.ok(!K.why, K.why); const rec = Object.assign(K.record, { _file: K.name }); recs.push(rec); base.push(rec); app.fs.files['proposals/' + K.name] = { t: PF.todos.text(K.file), m: Date.now() }; }
  assert.strictEqual(app.files('proposals/req-keep-').length, 501, 'set-up: 501 keeps');
  app.choose('person-morgan'); await app.tick(80); await refresh(app, 1500); await openPage(app);
  const h = txt(app.html());
  assert.ok(/501 keeps/.test(h) && /withdraw/i.test(h), 'the owner is told about the overflow: ' + (h.match(/[^.]*501 keeps[^.]*\./) || [])[0]);
  const late = recs.filter(k => k.by.person === 'person-casey');
  assert.ok(new RegExp('data-act="keep-withdraw"[^>]*data-id="' + late[0].id + '"').test(app.html()), 'each member no decision names can be withdrawn');
  /* Apply is refused while it is over. */
  const g = await (async () => { const d = await PF.repo.loadAll(app.fs, {}); return PF.corrections.forProcess(d.runs, 'release-notes', d.corrDecisions, null, PF.learn.members(d.todos, d.runs, 'release-notes'))[0]; })();
  assert.strictEqual(g.members.length, 501, 'set-up: one group of 501');
  assert.ok(/500/.test(PF.corrections.decideWhy(g)), 'decided nothing while over');
  /* Someone who is neither the owner nor its author withdraws nothing. */
  app.choose('person-avery'); await app.tick(80); await openPage(app);
  app.click('keep-withdraw', late[0].id, { process: 'release-notes' }); await app.tick(400);
  assert.strictEqual(app.files('proposals/req-keep-').length, 501, 'nothing withdrawn by someone else');
  /* The owner withdraws another's, down to 500; its author withdraws theirs whenever no decision names it; the owner withdraws
     nothing more once the group is within the limit. */
  app.choose('person-morgan'); await app.tick(80); await openPage(app);
  app.click('keep-withdraw', late[0].id, { process: 'release-notes' }); await app.tick(400);
  assert.strictEqual(app.files('proposals/req-keep-').length, 500, 'the owner withdrew one, down to 500');
  assert.ok(!app.fs.files['proposals/' + late[0]._file], 'that keep is gone');
  app.choose('person-casey'); await app.tick(80); await refresh(app, 1500); await openPage(app);
  app.click('keep-withdraw', late[1].id, { process: 'release-notes' }); await app.tick(400);
  assert.strictEqual(app.files('proposals/req-keep-').length, 499, 'its author withdrew theirs: ' + (txt(app.html()).match(/Nothing was withdrawn[^.]*\.[^.]*\./) || [])[0]);
  app.choose('person-morgan'); await app.tick(80); await refresh(app, 1500); await openPage(app);
  app.click('keep-withdraw', recs[0].id, { process: 'release-notes' }); await app.tick(400);
  assert.strictEqual(app.files('proposals/req-keep-').length, 499, 'the owner withdraws nothing once it is within the limit');
});

/* VA: a OneDrive copy of a keep that differs (only its reason, say) holds its correction by name: the review says so, and
   Apply and every decision write nothing and leave the draft as it was, whether the copy was read or arrives after. */
rule('A keep whose copy differs holds its correction by name: no draft change and no decision, read before or arriving at the write', async () => {
  for (const when of ['read', 'late']) for (const act of ['apply', 'decide']) {
    const label = when + ' · ' + act, app = await setup(), id = await added(app, 'Post the release notes');
    app.click('keep', id, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
    const gid = groupId(app), k = keeps(app)[0], own = 'proposals/' + k.id + '.json', copy = 'proposals/' + k.id + ' (1).json';
    const diff = JSON.stringify(Object.assign(JSON.parse(app.fs.files[own].t), { reason: 'Another reason' }), null, 2) + '\n';
    const DR = 'maps/drafts/release-notes.md', draft0 = app.fs.files[DR] ? app.fs.files[DR].t : null, n = app.files('corrections/').length;
    if (when === 'read') { app.fs.files[copy] = { t: diff, m: Date.now() }; await refresh(app, 300); }
    app.click('keep-open', gid, { process: 'release-notes' }); await app.tick(120);
    app.choose('person-morgan'); await app.tick(80);
    if (when === 'read') assert.ok(txt(app.html()).indexOf(k.id + ' (1).json') >= 0, label + ': the review names the copy');
    if (act === 'apply') { app.click('corr-review', gid); await app.tick(60); }
    if (when === 'late') app.fs.files[copy] = { t: diff, m: Date.now() };
    if (act === 'apply') app.click('corr-apply', gid); else app.click('corr-applied', gid);
    await app.tick(400);
    assert.strictEqual(app.files('corrections/').length, n, label + ': no decision written');
    assert.strictEqual(app.fs.files[DR] ? app.fs.files[DR].t : null, draft0, label + ': the draft as it was');
    assert.ok(txt(app.html()).indexOf(k.id + ' (1).json') >= 0, label + ': said, naming the copy: ' + (txt(app.html()).match(/[^.]*different things[^.]*\./) || [])[0]);
  }
});

/* QE: every name the checked reader knows for a keep (its own, " (1)", "-COMPUTER") is withdrawn like its own; identical
   copies of it are one keep, so withdrawing it removes each of them. */
rule('A keep under a OneDrive copy name is withdrawn like its own, and identical copies go with it', async () => {
  for (const how of [' (1)', '-LAPTOP', 'both']) {
    const app = await setup(), id = await added(app, 'Post the release notes');
    app.click('keep', id, { kind: 'todo' }); await app.tick(120);
    const k = keeps(app)[0], own = 'proposals/' + k.id + '.json', text = app.fs.files[own].t;
    assert.ok(text, how + ': set-up: kept');
    if (how === 'both') app.fs.files['proposals/' + k.id + ' (1).json'] = { t: text, m: Date.now() };
    else { app.fs.files['proposals/' + k.id + how + '.json'] = { t: text, m: Date.now() }; delete app.fs.files[own]; }
    await refresh(app, 400); await openPage(app);
    assert.ok(new RegExp('data-act="keep-withdraw"[^>]*data-id="' + k.id + '"').test(app.html()), how + ': offered Withdraw');
    app.click('keep-withdraw', k.id, { process: 'release-notes' }); await app.tick(400);
    assert.deepStrictEqual(app.files('proposals/req-keep-'), [], how + ': withdrawn: ' + (txt(app.html()).match(/(Nothing was withdrawn|Couldn't withdraw)[^.]*\.[^.]*\./) || [])[0]);
  }
});
/* AA: every keep decision is bound to the members reviewed: a keep deleted since, or replaced by a valid record with the
   same id that says something else (another author, say), refuses Apply, Mark as applied and Withdraw, by path; Withdraw
   judges its author on the records read now. */
rule('A keep decision refuses a reviewed keep deleted or changed since, by path, and Withdraw judges its author on the records read now', async () => {
  for (const how of ['deleted', 'changed']) for (const act of ['apply', 'decide', 'withdraw']) {
    const label = how + ' · ' + act, app = await setup(), id = await added(app, 'Post the release notes');
    app.click('keep', id, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
    const gid = groupId(app), k = keeps(app)[0], own = 'proposals/' + k.id + '.json';
    const DR = 'maps/drafts/release-notes.md', draft0 = app.fs.files[DR] ? app.fs.files[DR].t : null, n = app.files('corrections/').length;
    app.click('keep-open', gid, { process: 'release-notes' }); await app.tick(120);
    if (act !== 'withdraw') { app.choose('person-morgan'); await app.tick(80); }
    if (act === 'apply') { app.click('corr-review', gid); await app.tick(60); }
    if (how === 'deleted') delete app.fs.files[own];
    else { const o = JSON.parse(app.fs.files[own].t); o.by = { person: 'person-casey' }; app.fs.files[own] = { t: JSON.stringify(o, null, 2) + '\n', m: Date.now() }; }
    if (act === 'apply') app.click('corr-apply', gid); else if (act === 'decide') app.click('corr-applied', gid); else app.click('corr-withdraw', gid, { process: 'release-notes' });
    await app.tick(400);
    assert.strictEqual(app.files('corrections/').length, n, label + ': no decision written');
    assert.strictEqual(app.fs.files[DR] ? app.fs.files[DR].t : null, draft0, label + ': the draft as it was');
    assert.ok(txt(app.html()).indexOf(k.id + '.json') >= 0, label + ': said, by path: ' + (txt(app.html()).match(/[^.]*(isn't in the folder|changed since|whoever kept)[^.]*\./) || [])[0]);
  }
});
/* AB: a copy that arrives (differing or unreadable) while the keep records are read, after proposals/ was listed, refuses
   every keep decision before anything is written (Apply before its draft write), and an individual Withdraw deletes
   nothing. */
rule('A keep copy that arrives during the guard\'s read refuses every keep write before it writes, the draft and a lone Withdraw included', async () => {
  for (const kind of ['differs', 'torn']) for (const act of ['apply', 'decide', 'withdraw', 'withdraw-one']) {
    const label = kind + ' · ' + act, app = await setup(), id = await added(app, 'Post the release notes');
    app.click('keep', id, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
    const gid = groupId(app), k = keeps(app)[0], own = 'proposals/' + k.id + '.json', text = app.fs.files[own].t;
    const DR = 'maps/drafts/release-notes.md', draft0 = app.fs.files[DR] ? app.fs.files[DR].t : null, n = app.files('corrections/').length;
    if (act === 'withdraw-one') await openPage(app); else app.click('keep-open', gid, { process: 'release-notes' });
    await app.tick(120);
    if (act === 'apply' || act === 'decide') { app.choose('person-morgan'); await app.tick(80); }
    if (act === 'apply') { app.click('corr-review', gid); await app.tick(60); }
    /* The keep's own file, read after proposals/ was listed: the copy arrives while that read is paused. */
    const fs = app.fs, rd = fs.read.bind(fs), bl = fs.blob ? fs.blob.bind(fs) : null; let armed = true;
    const add = () => { const o = JSON.parse(text); o.reason = 'Another reason'; fs.files['proposals/' + k.id + ' (2).json'] = { t: kind === 'torn' ? '{ "kind": "ke' : JSON.stringify(o, null, 2) + '\n', m: Date.now() }; };
    const hook = (orig) => (p, o) => { if (armed && p === own) { armed = false; return Promise.resolve(orig(p, o)).then((x) => { add(); return x; }); } return orig(p, o); };
    fs.read = hook(rd); if (bl) fs.blob = hook(bl);
    if (act === 'apply') app.click('corr-apply', gid); else if (act === 'decide') app.click('corr-applied', gid); else if (act === 'withdraw') app.click('corr-withdraw', gid, { process: 'release-notes' }); else app.click('keep-withdraw', k.id, { process: 'release-notes' });
    await app.tick(500);
    fs.read = rd; if (bl) fs.blob = bl;
    assert.ok(!armed, label + ': set-up: the copy arrived during the read');
    assert.strictEqual(app.files('corrections/').length, n, label + ': no decision written');
    assert.strictEqual(app.fs.files[DR] ? app.fs.files[DR].t : null, draft0, label + ': the draft as it was');
    assert.ok(app.fs.files[own], label + ': the keep wasn\'t withdrawn');
  }
});

/* AD: withdrawing three identical copies reads the copy it is about to remove last, after the others: that copy changed
   (to a valid keep with the same id and another reason) during the last read of another copy before its delete is never
   removed, at each position. */
rule('Withdrawing copies reads the one it removes last: that copy changed during another copy\'s read is never removed, at each position', async () => {
  const make = async () => {
    const app = await setup(), id = await added(app, 'Post the release notes'); app.click('keep', id, { kind: 'todo' }); await app.tick(120);
    const k = keeps(app)[0], t = app.fs.files['proposals/' + k.id + '.json'].t;
    app.fs.files['proposals/' + k.id + ' (1).json'] = { t, m: Date.now() }; app.fs.files['proposals/' + k.id + '-LAPTOP.json'] = { t, m: Date.now() };
    await refresh(app, 300); await openPage(app);
    return { app, k, t };
  };
  const watch = (app, onRead) => {
    const fs = app.fs, st = { log: [], removes: [] }, rd = fs.read.bind(fs), bl = fs.blob ? fs.blob.bind(fs) : null, rm = fs.remove.bind(fs);
    const wrap = (orig) => (p, o) => { const i = st.log.length; st.log.push({ p, removes: st.removes.length }); if (onRead) onRead(i, p); return orig(p, o); };
    fs.read = wrap(rd); if (bl) fs.blob = wrap(bl); fs.remove = (p, ...a) => { st.removes.push(p); return rm(p, ...a); };
    st.off = () => { fs.read = rd; if (bl) fs.blob = bl; fs.remove = rm; };
    return st;
  };
  const dry = await make(), d = watch(dry.app);
  dry.app.click('keep-withdraw', dry.k.id, { process: 'release-notes' }); await dry.app.tick(600); d.off();
  assert.strictEqual(d.removes.length, 3, 'set-up: all three removed when nothing changes');
  let ran = 0;
  for (let pos = 0; pos < 2; pos++) {
    /* In the pass before delete #pos, the last other copy still to go is read twice (the reader, then its bytes): the
       target changes at that second read, after any read of the target placed before it. */
    const { app, k, t } = await make(), o = JSON.parse(t); o.reason = 'Another reason';
    const as = (p) => 'proposals/' + k.id + p.slice(('proposals/' + dry.k.id).length), target = as(d.removes[pos]), trigger = as(d.removes[d.removes.length - 1]);
    const changed = JSON.stringify(o, null, 2) + '\n';
    let seen = 0, st = null;
    st = watch(app, (i, p) => { if (st && st.removes.length === pos && p === trigger && ++seen === 2) app.fs.files[target] = { t: changed, m: Date.now() }; });
    app.click('keep-withdraw', k.id, { process: 'release-notes' }); await app.tick(600); st.off();
    assert.strictEqual(seen >= 2, true, 'position ' + pos + ': set-up: the other copy was read twice in that pass');
    ran++;
    assert.ok(app.fs.files[target] && app.fs.files[target].t === changed, 'position ' + pos + ': the changed copy ' + target + ' was never removed: ' + (txt(app.html()).match(/(Withdrawn|Nothing was withdrawn)[^.]*\./) || [])[0]);
  }
  assert.ok(ran >= 2, 'set-up: at least two positions have another copy read before the delete');
});

/* YB: Withdraw on a whole correction reads the keep's copies again, as every other decision does: a copy that differs
   refuses it, naming the copy; its author still withdraws it once the copy is gone. */
rule('Withdrawing a whole correction is refused while a copy of its keep differs; its author withdraws it once that copy is gone', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes');
  app.click('keep', id, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
  const gid = groupId(app), k = keeps(app)[0], own = 'proposals/' + k.id + '.json', copy = 'proposals/' + k.id + ' (1).json';
  const o = JSON.parse(app.fs.files[own].t); o.reason = 'Another reason';
  const n = app.files('corrections/').length;
  await openPage(app);
  app.fs.files[copy] = { t: JSON.stringify(o, null, 2) + '\n', m: Date.now() };
  app.click('corr-withdraw', gid, { process: 'release-notes' }); await app.tick(400);
  assert.strictEqual(app.files('corrections/').length, n, 'nothing withdrawn while a copy differs');
  assert.ok(txt(app.html()).indexOf(k.id + ' (1).json') >= 0, 'said, naming the copy: ' + (txt(app.html()).match(/[^.]*different things[^.]*\./) || [])[0]);
  delete app.fs.files[copy]; await refresh(app, 300); await openPage(app);
  app.click('corr-withdraw', gid, { process: 'release-notes' }); await app.tick(400);
  assert.strictEqual(app.files('corrections/').length, n + 1, 'its author withdraws it');
});

/* CC: a tool's name never confers a person's authority. A keep filed by a tool named like person-avery is not hers to
   withdraw: no Withdraw is shown on the correction or the keep, and a whole-correction Withdraw clicked anyway writes nothing. */
rule('A keep filed by a tool named like a person is never that person\'s to withdraw, on the correction or on the keep', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes');
  app.click('keep', id, { kind: 'todo' }); await app.tick(120);
  const k = keeps(app)[0], own = 'proposals/' + k.id + '.json', o = JSON.parse(app.fs.files[own].t), L = app.PF.learn;
  assert.strictEqual(o.by, 'person-avery', 'set-up: kept by person-avery');
  delete o.by; o.producer = { name: 'person-avery', version: '1.0' }; o.key = L.keyFor(o.run, o.source, o.template || null, o.anchor || null, o.change.text);
  app.fs.files[own] = { t: JSON.stringify(o, null, 2) + '\n', m: Date.now() };
  await refresh(app, 400); await openPage(app); await app.tick(60);
  assert.ok(app.PF.todos.cleanFile(JSON.parse(app.fs.files[own].t), k.id + '.json').ok, 'set-up: a valid tool keep');
  const h = app.html();
  assert.ok(!/data-act="corr-withdraw"/.test(h), 'no Withdraw on the correction');
  assert.ok(!/data-act="keep-withdraw"/.test(h), 'no Withdraw on the keep');
  assert.ok(/person-avery \(a tool\)/.test(txt(h)) && !/Avery Lee · /.test(txt(h)), 'named as a tool, never as the person');
  const n = app.files('corrections/').length, groups = app.PF.corrections.groups(L.members(keeps(app).map(x => Object.assign(app.PF.todos.cleanFile(x, x.id + '.json').record, { _file: x.id + '.json' })), [], 'release-notes'));
  assert.strictEqual(app.PF.corrections.canWithdraw(groups[0], 'person-avery'), false, 'the core rule says no');
  app.click('corr-withdraw', groups[0].id, { process: 'release-notes' }); await app.tick(400);
  assert.strictEqual(app.files('corrections/').length, n, 'a whole-correction Withdraw clicked anyway writes nothing');
  app.click('keep-withdraw', k.id, { process: 'release-notes' }); await app.tick(400);
  assert.ok(app.fs.files[own], 'the keep stays');
});

/* VB: withdrawing a keep with copies guards each delete: the person, their authority and the copy's bytes are
   checked again before every one. Refused after the first, it stops, says what was and wasn't removed, and withdrawing
   again finishes it. */
rule('Withdrawing a keep with copies guards each delete: a change after the first stops it, said as partial, and Withdraw again finishes', async () => {
  for (const how of ['person', 'inactive', 'people', 'bytes']) {
    const app = await setup(), id = await added(app, 'Post the release notes');
    app.click('keep', id, { kind: 'todo' }); await app.tick(120);
    const k = keeps(app)[0], own = 'proposals/' + k.id + '.json', text = app.fs.files[own].t, ppl0 = app.fs.files['people.json'].t;
    app.fs.files['proposals/' + k.id + ' (1).json'] = { t: text, m: Date.now() };
    await refresh(app, 400); await openPage(app);
    assert.strictEqual(app.files('proposals/req-keep-').length, 2, how + ': set-up: two identical copies');
    const fs = app.fs, rm = fs.remove; let n = 0;
    fs.remove = function (p) {
      const r = rm.apply(this, arguments);
      return Promise.resolve(r).then((x) => {
        if (/req-keep-/.test(p) && ++n === 1) {
          const left = app.files('proposals/req-keep-')[0];
          if (how === 'person') app.choose('person-blake');
          if (how === 'inactive') { const ppl = JSON.parse(fs.files['people.json'].t); (Array.isArray(ppl) ? ppl : ppl.people).forEach(q => { if (q.id === 'person-avery') q.inactive = true; }); fs.files['people.json'] = { t: JSON.stringify(ppl), m: Date.now() }; }
          if (how === 'people') fs.files['people.json'] = { t: '{"peo', m: Date.now() };
          if (how === 'bytes') fs.files[left] = { t: fs.files[left].t + ' ', m: Date.now() };
        }
        return x;
      });
    };
    app.click('keep-withdraw', k.id, { process: 'release-notes' }); await app.tick(500);
    fs.remove = rm;
    const left = app.files('proposals/req-keep-');
    assert.strictEqual(left.length, 1, how + ': stopped after the first delete');
    assert.ok(/in part/i.test(txt(app.html())) && txt(app.html()).indexOf(left[0].replace('proposals/', '')) >= 0, how + ': said as partial, naming what is left: ' + (txt(app.html()).match(/[^.]*(in part|withdraw)[^.]*\./i) || [])[0]);
    /* Put back as it was, the same person withdraws again and it is finished. */
    fs.files['people.json'] = { t: ppl0, m: Date.now() };
    if (how === 'bytes') fs.files[left[0]] = { t: text, m: Date.now() };
    app.choose('person-avery'); await app.tick(80); await refresh(app, 400); await openPage(app);
    app.click('keep-withdraw', k.id, { process: 'release-notes' }); await app.tick(500);
    assert.deepStrictEqual(app.files('proposals/req-keep-'), [], how + ': withdrawing again finishes it');
  }
});

/* QE: two computers each declining 500 keeps (499 shared, one different) make 501 that decisions all name. While the place
   is over, a keep no applied decision names is withdrawable (its author, or the owner), and the decisions stay as they are;
   back within 500, a keep a decision names is withdrawn only with its correction again. */
rule('A place pushed past 500 by keeps declined on two computers stays recoverable: guarded Withdraw, decisions kept', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes'), PF = app.PF;
  const recs = await keeps499(app, id), people = JSON.parse(app.fs.files['people.json'].t), r0 = PF.run.sanitize(theRun(app));
  const base = (await PF.repo.loadAll(app.fs, {})).todos.filter(x => x.kind !== 'keep'), late = [];
  for (const w of ['Late wording A', 'Late wording B']) { const K = PF.learn.prepare(r0, { source: { todo: id }, text: w, by: { person: 'person-casey' }, records: base, unread: [], people, at: new Date().toISOString(), app: '4.0.0' }); assert.ok(!K.why, K.why); late.push(Object.assign(K.record, { _file: K.name })); app.fs.files['proposals/' + K.name] = { t: PF.todos.text(K.file), m: Date.now() }; }
  const d = await PF.repo.loadAll(app.fs, {}), g = PF.corrections.forProcess(d.runs, 'release-notes', d.corrDecisions, null, PF.learn.members(d.todos, d.runs, 'release-notes'))[0];
  assert.strictEqual(g.members.length, 501, 'set-up: one group of 501');
  /* Each computer declined the 500 it had. */
  const decs = [];
  late.forEach((k, i) => {
    const other = late[1 - i].id, part = Object.assign({}, g, { members: g.members.filter(m => m.id !== other) });
    const dec = PF.corrections.decision(part, 'person-morgan', 'declined', 'Not for this checklist', new Date().toISOString());
    const f = 'corrections/release-notes/' + g.id + '.w' + i + '.' + dec.rev + '.json'; decs.push(f);
    app.fs.files[f] = { t: JSON.stringify(dec, null, 2) + '\n', m: Date.now() };
  });
  const decText = decs.map(f => app.fs.files[f].t);
  app.choose('person-morgan'); await app.tick(80); await refresh(app, 1500); await openPage(app);
  assert.ok(/501 keeps/.test(txt(app.html())), 'set-up: the overflow is said');
  assert.ok(new RegExp('data-act="keep-withdraw"[^>]*data-id="' + late[0].id + '"').test(app.html()), 'a keep only declined decisions name is offered Withdraw while over');
  /* Its author withdraws one: back to 500, every decision as it was. */
  app.choose('person-casey'); await app.tick(80); await refresh(app, 1500); await openPage(app);
  app.click('keep-withdraw', late[0].id, { process: 'release-notes' }); await app.tick(400);
  assert.strictEqual(app.files('proposals/req-keep-').length, 500, 'withdrawn, down to 500: ' + (txt(app.html()).match(/Nothing was withdrawn[^.]*\.[^.]*\./) || [])[0]);
  assert.deepStrictEqual(decs.map(f => app.fs.files[f] && app.fs.files[f].t), decText, 'the decisions are kept as they were');
  /* Within the limit, the owner withdraws nothing a decision names. */
  app.choose('person-morgan'); await app.tick(80); await refresh(app, 1500); await openPage(app);
  app.click('keep-withdraw', late[1].id, { process: 'release-notes' }); await app.tick(400);
  assert.strictEqual(app.files('proposals/req-keep-').length, 500, 'nothing more withdrawn once within the limit');
});

/* OE: more than 50 wordings page, so Show more reveals the 51st and on. */
rule('A keep group\'s wordings page 50 at a time: Show more reveals the 51st', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes');
  await keeps499(app, id);
  app.choose('person-morgan'); await app.tick(80); await refresh(app, 1500); await openPage(app);
  const d = await app.PF.repo.loadAll(app.fs, {}), G = app.PF.corrections.forProcess(d.runs, 'release-notes', d.corrDecisions, null, app.PF.learn.members(d.todos, d.runs, 'release-notes'))[0] || {}, g = G.id;
  assert.ok(g && G.alternatives.length === 499, 'set-up: the group, with its wordings');
  /* In the order the group gives them (first suggested first). */
  const shows = (n) => app.html().indexOf('>' + G.alternatives[n].text + ' <') >= 0;
  assert.ok(shows(0) && shows(49), 'the first 50 wordings');
  assert.ok(!shows(50), 'the 51st waits for Show more');
  const lid = 'keep-alts-' + g;
  assert.ok(new RegExp('data-act="more" data-id="' + lid + '"').test(app.html()), 'a Show more for the wordings');
  app.click('more', lid); await app.tick(120);
  assert.ok(shows(50) && shows(99), 'Show more reveals the next 50');
});

rule('Promoting a staged version that includes a keep is the active owner\'s too', async () => {
  const { app } = await appliedKeep();
  await openPage(app);
  app.set('change-note', 'Post the notes'); app.click('stage-draft', 'release-notes'); await app.tick(300);
  const st = app.files('staged/release-notes/').filter(f => /publication\.json$/.test(f));
  assert.strictEqual(st.length, 1, 'set-up: staged');
  const folder = JSON.parse(app.fs.files[st[0]].t).folder, n = versions(app);
  assert.ok((JSON.parse(app.fs.files[st[0]].t).corrections || []).length, 'set-up: the stage includes the keep');
  app.choose('person-avery'); await app.tick(80); await refresh(app, 200); await openPage(app);
  app.click('promote-stage', folder); await app.tick(300);
  assert.strictEqual(versions(app), n, 'nothing published by someone else');
  app.choose('person-morgan'); await app.tick(80); await refresh(app, 200); await openPage(app);
  app.click('promote-stage', folder); await app.tick(300);
  assert.strictEqual(versions(app), n + 1, 'the owner promotes it');
});

/* VD: the promotion is guarded on the exact stage it publishes: a plain stage swapped for one with an applied keep (same
   folder) between the guard's read and the promotion's own read publishes nothing for anyone but the owner. */
rule('A stage swapped for one that includes a keep between the owner check and the promotion publishes nothing', async () => {
  const { app } = await appliedKeep();
  await openPage(app);
  app.set('change-note', 'Post the notes'); app.click('stage-draft', 'release-notes'); await app.tick(300);
  const st = app.files('staged/release-notes/').filter(f => /publication\.json$/.test(f));
  assert.strictEqual(st.length, 1, 'set-up: staged');
  const folder = JSON.parse(app.fs.files[st[0]].t).folder, base = 'staged/release-notes/' + folder + '/', n = versions(app);
  assert.ok((JSON.parse(app.fs.files[st[0]].t).corrections || []).length, 'set-up: the stage includes the keep');
  const kept = {}; app.files(base).forEach(f => { kept[f] = app.fs.files[f]; });
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t);
  const b = PF.publish.build(MD, { people, ...require('./harness').exampleSetup(PF), stage: true, by: 'person-morgan', changes: 'Plain', existing: [{ version: 1 }], now: new Date().toISOString(), rand: folder.replace(/^stage-/, ''), app: '4.0.0' });
  assert.ok(!b.blockers && b.folder === folder, 'set-up: a plain stage of the same name ' + JSON.stringify(b.blockers || b.folder));
  Object.keys(kept).forEach(f => { delete app.fs.files[f]; });
  Object.keys(b.files).forEach(k => { app.fs.files[base + k] = { t: b.files[k], m: Date.now() }; });
  app.choose('person-avery'); await app.tick(80); await refresh(app, 300); await openPage(app);
  assert.ok(new RegExp('data-act="promote-stage"[^>]*data-id="' + folder + '"|data-id="' + folder + '"[^>]*data-act="promote-stage"').test(app.html()), 'set-up: Promote offered on the plain stage');
  const fs = app.fs, read = fs.read.bind(fs); let swapped = false, stageReads = 0;
  fs.read = (p, ...a) => {
    if (p === base + 'publication.json') stageReads++;
    if (!swapped && stageReads >= 1 && p === 'people.json') { swapped = true; Object.keys(b.files).forEach(k => { delete fs.files[base + k]; }); Object.keys(kept).forEach(f => { fs.files[f] = { t: kept[f].t, m: Date.now() }; }); }
    return read(p, ...a);
  };
  app.click('promote-stage', folder); await app.tick(400);
  fs.read = read;
  assert.ok(swapped, 'set-up: swapped after the guard\'s read');
  assert.strictEqual(versions(app), n, 'nothing published by someone else');
});

rule('Applying a keep whose person changes while the draft is being read writes neither the draft nor a decision', async () => {
  for (const change of ['person', 'folder-owner']) {
    const app = await setup(), id = await added(app, 'Post the release notes');
    app.click('keep', id, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
    const gid = groupId(app);
    app.click('keep-open', gid, { process: 'release-notes' }); await app.tick(120);
    app.choose('person-morgan'); await app.tick(80);
    const drafts = () => app.files('maps/drafts/').map(p => app.fs.files[p].t).join('\n'), before = drafts(), n = app.files('corrections/').length;
    const fs = app.fs, read = fs.read.bind(fs); let release = null;
    fs.read = (p, o) => /^maps\/drafts\//.test(p) && !release ? new Promise((res) => { release = () => res(read(p, o)); }) : read(p, o);
    app.click('corr-review', gid); await app.tick(60);
    app.click('corr-apply', gid); await app.tick(40);
    assert.ok(release, 'the draft is being read');
    if (change === 'person') app.choose('person-blake');
    else { const ppl = JSON.parse(fs.files['people.json'].t); (Array.isArray(ppl) ? ppl : ppl.people).forEach(p => { if (p.id === 'person-morgan') p.inactive = true; }); fs.files['people.json'] = { t: JSON.stringify(ppl), m: Date.now() }; app.click('refresh'); }
    await app.tick(60);
    release(); await app.tick(300);
    fs.read = read;
    assert.strictEqual(drafts(), before, change + ': the draft wasn\'t written');
    assert.strictEqual(app.files('corrections/').length, n, change + ': no decision');
  }
});

rule('An owner marked inactive in people.json decides nothing kept for next time', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes');
  app.click('keep', id, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
  const gid = groupId(app);
  app.click('keep-open', gid, { process: 'release-notes' }); await app.tick(120);
  app.choose('person-morgan'); await app.tick(80);
  const ppl = JSON.parse(app.fs.files['people.json'].t);
  (Array.isArray(ppl) ? ppl : ppl.people).forEach(p => { if (p.id === 'person-morgan') p.inactive = true; });
  app.fs.files['people.json'] = { t: JSON.stringify(ppl), m: Date.now() };
  await refresh(app, 300);
  const n = app.files('corrections/').length;
  app.click('corr-applied', gid); await app.tick(160);
  assert.strictEqual(app.files('corrections/').length, n, 'nothing is decided');
  assert.ok(!new RegExp('data-act="corr-review" data-id="' + gid + '"').test(app.html()), 'no Review for an inactive owner');
});

rule('Two to-dos kept for the same place in different words join one correction with both wordings, never guessing one', async () => {
  const app = await setup();
  const a = await added(app, 'Post the release notes'), b = await added(app, 'Publish the notes to the wiki');
  app.click('keep', a, { kind: 'todo' }); await app.tick(120);
  app.click('keep', b, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
  assert.strictEqual(keeps(app).length, 2);
  const gid = groupId(app);
  app.click('keep-open', gid, { process: 'release-notes' }); await app.tick(120);
  const t = txt(app.html());
  assert.ok(/2 wordings/.test(t) && t.indexOf('Post the release notes') >= 0 && t.indexOf('Publish the notes to the wiki') >= 0, 'both wordings shown');
  const groups = (app.html().match(/id="fxg-/g) || []).length;
  assert.strictEqual(groups, 1, 'one group');
});

rule('A keep whose save fails writes nothing and says so; keeping again files it once', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes');
  const fs = app.fs, write = fs.write.bind(fs);
  fs.write = (p, t, o) => /^proposals\/req-keep-/.test(p) ? Promise.reject(new Error('EIO')) : write(p, t, o);
  app.click('keep', id, { kind: 'todo' }); await app.tick(120);
  assert.strictEqual(keeps(app).length, 0);
  assert.ok(/Couldn't save/.test(txt(app.html())), 'said');
  fs.write = write;
  app.click('keep', id, { kind: 'todo' }); await app.tick(120);
  assert.strictEqual(keeps(app).length, 1);
});

rule('A keep whose person changes before it is written is never written, and is never said to be kept', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes');
  const fs = app.fs, read = fs.read.bind(fs); let release = null;
  fs.read = (p, o) => /^proposals\/req-keep-/.test(p) && !release ? new Promise((res) => { release = () => res(read(p, o)); }) : read(p, o);
  app.click('keep', id, { kind: 'todo' }); await app.tick(40);
  assert.ok(release, 'the save is under way');
  app.choose('person-blake'); await app.tick(40);
  release(); await app.tick(120);
  fs.read = read;
  assert.strictEqual(keeps(app).length, 0, 'nothing written');
  assert.ok(!/Suggest for next time/.test(txt(app.html())), 'never said');
});

/* A loop whose items run validate-story, with a spread on it: what a spread's keep rests on is that child's publication. */
const KID = ['---', 'process: validate-story', 'title: Validate a story', 'owner: person-avery', 'context: issue, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
  '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release 4.1', 'owner: person-avery', '---', '',
  '## Stories · DO-CONFIRM {#stories}', '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
async function loopSetup() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const put = (md, id, rand) => {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '4.0.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  };
  put(KID, 'validate-story', 'vs000001'); put(PARENT, 'release-readiness', 'rr000001');
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-readiness'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150); app.set('loop-add-each', ''); await app.tick();
  const parent = () => { const p = app.files('runs/release-readiness/').find(x => /run\.json$/.test(x)); return JSON.parse(app.fs.files[p].t); };
  const d = await PF.repo.loadAll(app.fs, {}), r = d.runs.find(x => x.process === 'release-readiness');
  const procOf = (id) => { const x = d.processes.filter(p => p.process === id)[0]; return x ? { latest: x.index.latest, all: x.index.all, clashes: x.index.clashes, broken: [] } : null; };
  const LV = PF.loop.view(r, 'each', { records: d.scopes, runs: d.runs, procOf }), childMap = PF.pins.childTarget(r, PF.map.findStep(PF.run.mapOf(r), 'each').step, procOf).pub.map;
  const P = PF.todos.prepare(r, { body: { op: 'spread-add', loopStep: 'each', text: 'Security sign-off', child: { beforeGate: 'assess-confirm' }, scope: PF.spreads.snapshot(LV) }, by: { tool: 'release-helper', version: '1.0', key: 'sp-000001' }, records: d.todos, unread: d.todosUnread, people, at: new Date().toISOString(), app: '4.0.0', childMap });
  assert.ok(!P.why, P.why);
  await app.fs.write('proposals/' + P.name, PF.todos.text(P.file));
  await refresh(app, 300);
  app.click('td-inbox', ''); await app.tick(20);
  const b = /data-act="td-accept" data-id="([^"]+)" data-run="([^"]+)" data-fp="([^"]+)"/.exec(app.overlay() || '');
  assert.ok(b, 'set-up: the spread waits for a decision');
  app.click('td-accept', b[1], { run: b[2], fp: b[3] }); await app.tick(80);
  app.click('close-overlay'); await app.tick();
  for (let i = 0; i < 4; i++) await refresh(app, 300);
  app.click('open-run', 'release-readiness/' + parent().id); await app.tick(80);
  const sp = /data-act="keep" data-kind="spread" data-id="([^"]+)"/.exec(app.html());
  assert.ok(sp, 'set-up: the spread can be kept');
  return { app, spread: sp[1] };
}

rule('A spread\'s keep is held when its checklist\'s publication can\'t be read at the write, even with a copy read before', async () => {
  const { app, spread } = await loopSetup();
  const fs = app.fs, read = fs.read.bind(fs), blob = fs.blob ? fs.blob.bind(fs) : null;
  const n = keeps(app).length;
  fs.read = (p, o) => /^publications\/validate-story\//.test(p) ? Promise.reject(Object.assign(new Error('EIO: i/o error'), { code: 'EIO' })) : read(p, o);
  if (blob) fs.blob = (p) => /^publications\/validate-story\//.test(p) ? Promise.reject(Object.assign(new Error('EIO: i/o error'), { code: 'EIO' })) : blob(p);
  app.click('keep', spread, { kind: 'spread' }); await app.tick(200);
  assert.strictEqual(keeps(app).length, n, 'nothing kept');
  assert.ok(/Nothing was kept/.test(txt(app.html())) && /validate-story/.test(txt(app.html())), 'said, naming the checklist: ' + (txt(app.html()).match(/Nothing was kept[^.]*\.[^.]*\./) || [])[0]);
  fs.read = read; if (blob) fs.blob = blob;
  app.click('keep', spread, { kind: 'spread' }); await app.tick(200);
  assert.strictEqual(keeps(app).length, n + 1, 'kept once it reads');
  assert.strictEqual(keeps(app)[0].template.process, 'validate-story');
});

/* LA: a spread's keep is filed against proposals/ as read last, after its checklist's publication is read again: a copy of
   the keep that differs, or one that can't be read, landing while that publication is read again, files nothing. */
rule('A spread\'s keep files nothing when a differing or torn copy of it lands while its checklist is read again', async () => {
  for (const how of ['differs', 'torn'].filter((h) => !process.env.LA_CASE || process.env.LA_CASE.split(',').indexOf(h) >= 0)) {
    const { app, spread } = await loopSetup();
    /* Its name and bytes, from a keep filed once and then removed (this window reads the folder again after). */
    app.click('keep', spread, { kind: 'spread' }); await app.tick(200);
    const k = keeps(app)[0]; assert.ok(k, how + ': set-up: kept once');
    const own = 'proposals/' + k.id + '.json', o = JSON.parse(app.fs.files[own].t); o.reason = 'Another reason';
    delete app.fs.files[own]; await refresh(app, 400);
    assert.strictEqual(keeps(app).length, 0, how + ': set-up: removed');
    const fs = app.fs, read = fs.read.bind(fs), blob = fs.blob ? fs.blob.bind(fs) : null; let landed = false;
    const land = (p) => { if (!landed && /^publications\/validate-story\/.*map\.md$/.test(p)) { landed = true; fs.files['proposals/' + k.id + ' (1).json'] = { t: how === 'torn' ? '{ "format": ' : JSON.stringify(o, null, 2) + '\n', m: Date.now() }; } };
    fs.read = (p, x) => { land(p); return read(p, x); };
    if (blob) fs.blob = (p, x) => { land(p); return blob(p, x); };
    app.click('keep', spread, { kind: 'spread' }); await app.tick(300);
    fs.read = read; if (blob) fs.blob = blob;
    assert.ok(landed, how + ': set-up: the copy landed while the checklist was read again');
    assert.ok(!app.fs.files[own], how + ': not filed');
    assert.ok(/Nothing was kept/.test(txt(app.html())), how + ': said: ' + (txt(app.html()).match(/(Nothing was kept|Suggest)[^.]*\.[^.]*\./) || [])[0]);
  }
});

/* BC: a copy that arrives during the last read before the last delete (people.json, which no guard can follow) is never
   said withdrawn: the folder is listed again once the deletes are done, and the copy still there is named. */
rule('A keep copy arriving during the last read before a withdrawal\'s last delete is said, by path, never "Withdrawn"', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes');
  app.click('keep', id, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
  const k = keeps(app)[0], own = 'proposals/' + k.id + '.json', o = JSON.parse(app.fs.files[own].t); o.reason = 'Another reason';
  await openPage(app);
  const fs = app.fs, rd = fs.read.bind(fs), rm = fs.remove.bind(fs); let armed = false, removed = 0;
  fs.remove = (p, ...a) => { removed++; return rm(p, ...a); };
  fs.read = (p, x) => { if (armed && p === 'people.json') { armed = false; fs.files['proposals/' + k.id + ' (2).json'] = { t: JSON.stringify(o, null, 2) + '\n', m: Date.now() }; } return rd(p, x); };
  armed = true; app.click('keep-withdraw', k.id, { process: 'release-notes' }); await app.tick(500);
  fs.read = rd; fs.remove = rm;
  assert.ok(!armed && removed === 1 && !app.fs.files[own], 'set-up: the copy arrived during the last read, and the original was removed');
  const t = txt(app.html());
  assert.ok(!/Withdrawn: that keep is no longer suggested/.test(t), 'never said withdrawn');
  assert.ok(t.indexOf(k.id + ' (2).json') >= 0 && /Withdrawn in part/.test(t), 'the copy still there is named: ' + (t.match(/Withdrawn[^.]*\.[^.]*\./) || [])[0]);
});

/* BD: a keep just saved carries the SHA-256 of the bytes written and read back, so its author withdraws it at once, no
   refresh between; a copy changed since is still refused. */
rule('A keep just saved is withdrawn by its author with no refresh; a change to it since is still refused', async () => {
  for (const how of ['as saved', 'changed']) {
    const app = await setup(), id = await added(app, 'Post the release notes');
    app.click('keep', id, { kind: 'todo' }); await app.tick(200);
    const k = keeps(app)[0], own = 'proposals/' + k.id + '.json';
    assert.ok(k && app.fs.files[own], how + ': set-up: kept');
    await openPage(app);
    assert.ok(new RegExp('data-act="keep-withdraw"[^>]*data-id="' + k.id + '"|data-id="' + k.id + '"[^>]*data-act="keep-withdraw"').test(app.html()), how + ': set-up: Withdraw offered');
    if (how === 'changed') app.fs.files[own] = { t: app.fs.files[own].t + ' ', m: Date.now() };
    app.click('keep-withdraw', k.id, { process: 'release-notes' }); await app.tick(400);
    if (how === 'as saved') {
      assert.ok(!app.fs.files[own], how + ': withdrawn: ' + (txt(app.html()).match(/(Withdrawn|Nothing was withdrawn)[^.]*\.[^.]*\./) || [])[0]);
      assert.ok(/Withdrawn: that keep is no longer suggested/.test(txt(app.html())), how + ': said');
    } else assert.ok(app.fs.files[own], how + ': not withdrawn');
  }
});

/* BA-BC: the one guard order of every keep and publication write, as a full matrix: every path, a pause at every read
   before its writes, and each change: a differing copy, a torn copy, the keep deleted, a version published that moves
   ownership (where the path has an owner), the person or the folder switched, the person marked inactive, people.json
   made unreadable. Nothing the path writes lands after the change. */
/* A keep file still there (its own, or a copy left by a delete before the pause) and its id: a new " (2)" copy is that id's. */
const MX_COPY = (fs) => { const p = Object.keys(fs.files).filter(q => /^proposals\/req-keep-/.test(q)).sort()[0]; if (!p) return null; try { const o = JSON.parse(fs.files[p].t); return { o, to: 'proposals/' + o.id + ' (2).json' }; } catch (e) { return null; } };
const MX_CHANGES = {
  differs: (fs) => { const c = MX_COPY(fs); if (!c) return; c.o.reason = 'Another reason'; fs.files[c.to] = { t: JSON.stringify(c.o, null, 2) + '\n', m: Date.now() }; },
  torn: (fs) => { const c = MX_COPY(fs); if (!c) return; fs.files[c.to] = { t: '{ "kind": "ke', m: Date.now() }; },
  gone: (fs) => { Object.keys(fs.files).filter(q => /^proposals\/req-keep-/.test(q)).forEach(q => { delete fs.files[q]; }); }
};
const mxCorr = (p) => /^corrections\//.test(p), mxProps = (p) => /^proposals\/req-/.test(p), mxPub = (p) => /^publications\//.test(p) && !/\/v\d+-ow/.test(p);
/* Each case starts from the same folder: built once per kind (a keep, three identical copies, applied, staged, applied
   with its decision lost), then copied into a fresh window, where only the clicks of the path are made again. */
const MX_BASE = {
  kept: async () => { const app = await setup(), id = await added(app, 'Post the release notes'); app.click('keep', id, { kind: 'todo' }); await app.tick(120); await refresh(app, 300); app.mxGid = groupId(app); return app; },
  copies: async () => { const app = await MX_BASE.kept(), k = keeps(app)[0], t = app.fs.files['proposals/' + k.id + '.json'].t;
    app.fs.files['proposals/' + k.id + ' (1).json'] = { t, m: Date.now() }; app.fs.files['proposals/' + k.id + '-LAPTOP.json'] = { t, m: Date.now() }; return app; },
  applied: async () => { const { app, gid } = await appliedKeep(); app.mxGid = gid; return app; },
  staged: async () => { const { app, gid } = await appliedKeep(); app.mxGid = gid; await openPage(app); app.set('change-note', 'Post the notes'); app.click('stage-draft', 'release-notes'); await app.tick(300); return app; },
  lost: async () => { const app = await MX_BASE.kept(), gid = app.mxGid, orig = app.PF.repo.decideCorrection; let fails = 1;
    app.click('keep-open', gid, { process: 'release-notes' }); await app.tick(120); app.choose('person-morgan'); await app.tick(80); app.click('corr-review', gid); await app.tick(60);
    app.PF.repo.decideCorrection = function () { if (fails-- > 0) return Promise.reject(new Error('OneDrive is offline')); return orig.apply(this, arguments); };
    app.click('corr-apply', gid); await app.tick(300); app.PF.repo.decideCorrection = orig;
    assert.ok(/Post the release notes/.test(app.fs.files['maps/drafts/release-notes.md'].t) && !app.files('corrections/release-notes/').length, 'set-up: the draft has it, its decision was lost');
    return app; }
};
const mxSnaps = Object.create(null);
async function mxFrom(kind, who) {
  if (!mxSnaps[kind]) mxSnaps[kind] = MX_BASE[kind]().then((app) => ({ files: structuredClone(app.fs.files), gid: app.mxGid }));
  const { files, gid } = await mxSnaps[kind], app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80);
  Object.keys(app.fs.files).forEach((k) => { delete app.fs.files[k]; });
  Object.keys(files).forEach((k) => { app.fs.files[k] = structuredClone(files[k]); });
  app.choose(who); await app.tick(40); await refresh(app, 300);
  app.mxGid = gid;
  return app;
}
/* A keep's correction opened and reviewed by its owner (Morgan): the overlay the decision paths act from. */
async function mxReviewed(kind) {
  const app = await mxFrom(kind || 'kept', 'person-morgan'), gid = app.mxGid;
  app.click('keep-open', gid, { process: 'release-notes' }); await app.tick(120);
  app.click('corr-review', gid); await app.tick(60);
  return { app, gid };
}
const MX_PATHS = {
  applied: async () => { const app = await mxFrom('kept', 'person-morgan'), gid = app.mxGid; await openPage(app);
    return { app, act: () => app.click('corr-applied', gid), mine: mxCorr, who: 'person-morgan', other: 'person-avery', owned: true }; },
  'decline-page': async () => { const app = await mxFrom('kept', 'person-morgan'), gid = app.mxGid; await openPage(app);
    app.click('pick', gid, { kind: 'corr-decline' }); await app.tick(20); app.set('pick-input', 'Not for this checklist');
    return { app, act: () => app.click('corr-decline', gid), mine: mxCorr, who: 'person-morgan', other: 'person-avery', owned: true }; },
  'decline-review': async () => { const { app, gid } = await mxReviewed(); app.click('corr-ca-declining', gid); await app.tick(20); app.set('ca-reason', 'Not for this checklist');
    return { app, act: () => app.click('corr-ca-decline', gid), mine: mxCorr, who: 'person-morgan', other: 'person-avery', owned: true }; },
  addressed: async () => { const { app, gid } = await mxReviewed();
    return { app, act: () => app.click('corr-addressed', gid), mine: mxCorr, who: 'person-morgan', other: 'person-avery', owned: true }; },
  link: async () => { const { app, gid } = await mxReviewed('lost');
    assert.ok(/data-act="corr-link"/.test(app.overlay()), 'set-up: Link this correction');
    return { app, act: () => app.click('corr-link', gid), mine: mxCorr, who: 'person-morgan', other: 'person-avery', owned: true }; },
  apply: async () => { const { app, gid } = await mxReviewed();
    return { app, act: () => app.click('corr-apply', gid), mine: (p) => mxCorr(p) || /^maps\/drafts\//.test(p), who: 'person-morgan', other: 'person-avery', owned: true }; },
  withdraw: async () => { const app = await mxFrom('kept', 'person-avery'), gid = app.mxGid;
    return { app, act: () => app.click('corr-withdraw', gid, { process: 'release-notes' }), mine: mxCorr, who: 'person-avery', other: 'person-casey' }; },
  'withdraw-one': async () => { const app = await mxFrom('kept', 'person-avery'), k = keeps(app)[0]; await openPage(app);
    return { app, act: () => app.click('keep-withdraw', k.id, { process: 'release-notes' }), mine: mxProps, removes: true, who: 'person-avery', other: 'person-casey' }; },
  'withdraw-copies': async () => { const app = await mxFrom('copies', 'person-avery'), k = keeps(app)[0]; await openPage(app);
    assert.strictEqual(app.files('proposals/req-keep-').length, 3, 'set-up: three identical copies');
    return { app, act: () => app.click('keep-withdraw', k.id, { process: 'release-notes' }), mine: mxProps, removes: true, who: 'person-avery', other: 'person-casey' }; },
  publish: async () => { const app = await mxFrom('applied', 'person-morgan'); await openPage(app); app.set('change-note', 'Post the notes');
    return { app, act: () => app.click('publish', 'release-notes'), mine: mxPub, who: 'person-morgan', other: 'person-avery', owned: true }; },
  promote: async () => { const app = await mxFrom('staged', 'person-morgan'); await openPage(app);
    const st = app.files('staged/release-notes/').filter(f => /publication\.json$/.test(f)), folder = JSON.parse(app.fs.files[st[0]].t).folder;
    return { app, act: () => app.click('promote-stage', folder), mine: mxPub, who: 'person-morgan', other: 'person-avery', owned: true }; }
};
/* The longest paths run in parts (every nth case), so the suite's shards share them. */
const MX_PARTS = { publish: 4, promote: 4, 'withdraw-copies': 2 };
for (const way of Object.keys(MX_PATHS)) for (let part = 0; part < (MX_PARTS[way] || 1); part++) {
  const n = MX_PARTS[way] || 1, tag = n > 1 ? way + ', part ' + (part + 1) + ' of ' + n : way;
  rule('The one keep guard order, as a matrix: ' + tag + ' writes nothing after a change at any read (a differing or torn copy, the keep deleted, ownership moved, the person, folder, activity or people.json)', async () => {
    const r = await race('matrix ' + tag, async () => {
      const c = await MX_PATHS[way]();
      return Object.assign(c, { extra: MX_CHANGES }, c.owned ? { transfer: (fs) => transfer(c.app, fs) } : {});
    }, { every: true, dry: !!process.env.MX_DRY, part: n > 1 ? [part, n] : null });
    if (process.env.RACE_SAY) console.log(tag + ' ' + JSON.stringify(r));
  });
}

/* Every write path of keeping for next time, raced (test/race-harness.js): each async read before its writes paused in turn,
   the person switched, the folder switched, the person marked inactive or people.json made unreadable, then released. */
/* Every write path of keeping for next time, one rule each (RACE=<names> picks them while working on one). */
const OLD_RACES = {};
const proposals = (p) => /^proposals\/req-/.test(p), corr = (p) => /^corrections\//.test(p);
/* MA: the keep a published or promoted version rests on is deleted mid-write: it holds for everyone, the owner too. */
const keepGone = { keepgone: (fs) => { Object.keys(fs.files).filter(p => /^proposals\/req-keep-/.test(p)).forEach(p => { delete fs.files[p]; }); } };
const kept = async (who) => { const app = await setup(), id = await added(app, 'Post the release notes'); app.click('keep', id, { kind: 'todo' }); await app.tick(120); await refresh(app, 300); const gid = groupId(app); if (who) { app.choose(who); await app.tick(80); } return { app, gid }; };
OLD_RACES['keep'] = () => race('keep', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes');
  return { app, act: () => app.click('keep', id, { kind: 'todo' }), mine: proposals, who: 'person-avery', other: 'person-casey' };
});
OLD_RACES['withdraw'] = () => race('withdraw', async () => {
  const { app, gid } = await kept();
  return { app, act: () => app.click('corr-withdraw', gid, { process: 'release-notes' }), mine: corr, who: 'person-avery', other: 'person-casey' };
});
/* OB: withdrawing one keep removes its record, under the same guard. */
OLD_RACES['withdraw-keep'] = () => race('withdraw-keep', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes'); app.click('keep', id, { kind: 'todo' }); await app.tick(120); await refresh(app, 300);
  const k = keeps(app)[0]; assert.ok(k, 'set-up: a keep'); await openPage(app);
  return { app, act: () => app.click('keep-withdraw', k.id, { process: 'release-notes' }), mine: proposals, removes: true, who: 'person-avery', other: 'person-casey' };
});
/* YA: a keep with three identical copies: every delete is guarded right before it removes, at every position, against a
   change of person, folder, activity, people.json, or a copy's bytes. */
const touch = { bytes: (fs) => { Object.keys(fs.files).filter(p => /^proposals\/req-keep-/.test(p)).forEach(p => { fs.files[p] = { t: fs.files[p].t + ' ', m: Date.now() }; }); } };
OLD_RACES['withdraw-copies'] = () => race('withdraw-copies', async () => {
  const app = await setup(), id = await added(app, 'Post the release notes'); app.click('keep', id, { kind: 'todo' }); await app.tick(120);
  const k = keeps(app)[0], t = app.fs.files['proposals/' + k.id + '.json'].t;
  app.fs.files['proposals/' + k.id + ' (1).json'] = { t, m: Date.now() }; app.fs.files['proposals/' + k.id + '-LAPTOP.json'] = { t, m: Date.now() };
  await refresh(app, 300); await openPage(app);
  assert.strictEqual(app.files('proposals/req-keep-').length, 3, 'set-up: three identical copies');
  return { app, act: () => app.click('keep-withdraw', k.id, { process: 'release-notes' }), mine: proposals, removes: true, who: 'person-avery', other: 'person-casey', extra: touch };
});
/* YB: withdrawing the whole correction reads the keep's copies again too: a differing copy arriving refuses it. */
const differs = { copy: (fs) => { const p = Object.keys(fs.files).filter(q => /^proposals\/req-keep-[a-z0-9-]+\.json$/.test(q))[0], o = JSON.parse(fs.files[p].t); o.reason = 'Another reason'; fs.files[p.replace(/\.json$/, ' (1).json')] = { t: JSON.stringify(o, null, 2) + '\n', m: Date.now() }; } };
OLD_RACES['withdraw-differs'] = () => race('withdraw-differs', async () => {
  const { app, gid } = await kept();
  return { app, act: () => app.click('corr-withdraw', gid, { process: 'release-notes' }), mine: corr, who: 'person-avery', other: 'person-casey', extra: differs };
});
OLD_RACES['decide'] = () => race('decide', async () => {
  const { app, gid } = await kept('person-morgan'); await openPage(app);
  return { app, act: () => app.click('corr-applied', gid), mine: corr, who: 'person-morgan', other: 'person-avery', transfer: (fs) => transfer(app, fs) };
});
OLD_RACES['apply'] = () => race('apply', async () => {
  const { app, gid } = await kept();
  app.click('keep-open', gid, { process: 'release-notes' }); await app.tick(120);
  app.choose('person-morgan'); await app.tick(80);
  app.click('corr-review', gid); await app.tick(60);
  return { app, act: () => app.click('corr-apply', gid), mine: (p) => corr(p) || /^maps\/drafts\//.test(p), who: 'person-morgan', other: 'person-avery', transfer: (fs) => transfer(app, fs) };
});
OLD_RACES['publish'] = () => race('publish', async () => {
  const { app } = await appliedKeep(); await openPage(app);
  app.set('change-note', 'Post the notes');
  return { app, act: () => app.click('publish', 'release-notes'), mine: (p) => /^publications\//.test(p) && !/\/v\d+-ow/.test(p), who: 'person-morgan', other: 'person-avery', transfer: (fs) => transfer(app, fs), extra: keepGone };
});
OLD_RACES['promote'] = () => race('promote', async () => {
  const { app } = await appliedKeep(); await openPage(app);
  app.set('change-note', 'Post the notes'); app.click('stage-draft', 'release-notes'); await app.tick(300);
  const st = app.files('staged/release-notes/').filter(f => /publication\.json$/.test(f)), folder = JSON.parse(app.fs.files[st[0]].t).folder;
  await refresh(app, 200); await openPage(app);
  return { app, act: () => app.click('promote-stage', folder), mine: (p) => /^publications\//.test(p) && !/\/v\d+-ow/.test(p), who: 'person-morgan', other: 'person-avery', transfer: (fs) => transfer(app, fs), extra: keepGone };
});
for (const name of Object.keys(OLD_RACES)) {
  rule('Every keep write path is guarded after every read and right before every write: ' + name + ', a pause and a change of person, folder, activity or people.json writes nothing after it', async () => {
    if (process.env.RACE && process.env.RACE.split(',').indexOf(name) < 0) return;
    const r = await OLD_RACES[name]();
    if (process.env.RACE_SAY) console.log(name + ' ' + JSON.stringify(r));
  });
}

/* WA: Keep for next time reads the run it keeps from again inside its final check and judges it as every reader does; the
   keep is made again from that read, never from this window's copy. A run.json deleted or emptied, or its version damaged or
   unreadable, since the screen was drawn (no refresh) files no keep. */
rule('A keep files nothing when the run it keeps from was deleted, emptied or its version damaged since the screen was drawn', async () => {
  for (const how of ['wa-delete', 'wa-empty', 'wa-pub', 'wa-pub-unreadable'].filter((h) => !process.env.WA_CASE || process.env.WA_CASE.split(',').indexOf(h) >= 0)) {
    const app = await setup(), id = await added(app, 'Post the release notes'), F = app.fs.files, rp = runPath(app);
    const pubDir = 'publications/release-notes/' + theRun(app).folder + '/', read = app.fs.read.bind(app.fs);
    if (how === 'wa-delete') delete F[rp];
    else if (how === 'wa-empty') { const o = theRun(app); o.details = []; F[rp] = { t: JSON.stringify(o, null, 2), m: Date.now() }; }
    else if (how === 'wa-pub') F[pubDir + 'map.md'] = { t: F[pubDir + 'map.md'].t.replace('Write the notes', 'Skip the notes'), m: Date.now() };
    else app.fs.read = (p, ...a) => p === pubDir + 'publication.json' ? Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })) : read(p, ...a);
    app.click('keep', id, { kind: 'todo' }); await app.tick(200);
    app.fs.read = read;
    assert.strictEqual(keeps(app).length, 0, how + ': no keep filed: ' + app.live());
    assert.ok(!/Suggest for next time in release-notes/.test(txt(app.html()) + ' ' + app.live()), how + ': never said kept');
  }
});

run();
