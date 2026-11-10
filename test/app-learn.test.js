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

/* OA: lost proof never frees kept content. Every way of losing it (the keep, the decision, both, one member, a truncated keep
   or decision, Reopen with the decisions deleted, and staging before that) × Publish and Promote × refreshed and cached:
   someone else publishes nothing; the owner publishes, unless a keep a readable decision names is gone (held for everyone). */
const OA_WAYS = ['keep', 'decision', 'both', 'member', 'trunc-keep', 'trunc-decision', 'reopen', 'staged'];
rule('Lost proof never lets anyone but the owner publish kept content: every way of losing it, for Publish and Promote, refreshed or cached', async () => {
  const stage = async (app) => {
    await openPage(app); app.set('change-note', 'Post the notes'); app.click('stage-draft', 'release-notes'); await app.tick(300);
    const st = app.files('staged/release-notes/').filter(f => /publication\.json$/.test(f));
    assert.strictEqual(st.length, 1, 'set-up: staged'); return JSON.parse(app.fs.files[st[0]].t).folder;
  };
  const decFiles = (app) => Object.keys(app.fs.files).filter(f => /^corrections\//.test(f) && (() => { try { return JSON.parse(app.fs.files[f].t).kind === 'correction-decision'; } catch (e) { return false; } })());
  const cut = (app, f) => { app.fs.files[f] = { t: app.fs.files[f].t.slice(0, 20), m: Date.now() }; };
  let checks = 0;
  for (const how of OA_WAYS) for (const path of ['publish', 'promote']) for (const mode of ['refresh', 'cached']) {
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
    if (how === 'keep' || how === 'both' || how === 'member') delete app.fs.files[k1];
    if (how === 'trunc-keep') cut(app, k1);
    if (how === 'decision' || how === 'reopen' || how === 'staged') ds.forEach(f => { delete app.fs.files[f]; });
    if (how === 'both' || how === 'trunc-decision') ds.forEach(f => cut(app, f));
    if (mode === 'refresh') { await refresh(app, 300); await openPage(app); }
    const go = async () => { if (path === 'publish') { app.set('change-note', 'Post the notes'); app.click('publish', 'release-notes'); } else app.click('promote-stage', folder); await app.tick(400); };
    await go();
    assert.strictEqual(versions(app), n, label + ': nothing published by someone else'); checks++;
    assert.ok(/kept for next time/.test(txt(app.html())), label + ': said why: ' + (txt(app.html()).match(/Nothing was (published|promoted)[^.]*\.[^.]*\./) || [])[0]);
    app.choose('person-morgan'); await app.tick(80); await refresh(app, 300); await openPage(app);
    await go();
    const held = how === 'keep' || how === 'member' || how === 'trunc-keep';
    assert.strictEqual(versions(app), held ? n : n + 1, label + (held ? ': a keep a decision names is gone: held for the owner too' : ': the owner publishes it')); checks++;
  }
  assert.strictEqual(checks, OA_WAYS.length * 2 * 2 * 2, 'the whole matrix ran');
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

/* Every write path of keeping for next time, raced (test/race-harness.js): each async read before its writes paused in turn,
   the person switched, the folder switched, the person marked inactive or people.json made unreadable, then released. */
rule('Every keep write path is guarded after every read and right before every write: a pause and a change of person, folder, activity or people.json writes nothing after it', async () => {
  const only = process.env.RACE ? process.env.RACE.split(',') : null, want = (n) => !only || only.indexOf(n) >= 0, out = {};
  const proposals = (p) => /^proposals\/req-/.test(p), corr = (p) => /^corrections\//.test(p);
  /* MA: the keep a published or promoted version rests on is deleted mid-write: it holds for everyone, the owner too. */
  const keepGone = { keepgone: (fs) => { Object.keys(fs.files).filter(p => /^proposals\/req-keep-/.test(p)).forEach(p => { delete fs.files[p]; }); } };
  const kept = async (who) => { const app = await setup(), id = await added(app, 'Post the release notes'); app.click('keep', id, { kind: 'todo' }); await app.tick(120); await refresh(app, 300); const gid = groupId(app); if (who) { app.choose(who); await app.tick(80); } return { app, gid }; };
  if (want('keep')) out.keep = await race('keep', async () => {
    const app = await setup(), id = await added(app, 'Post the release notes');
    return { app, act: () => app.click('keep', id, { kind: 'todo' }), mine: proposals, who: 'person-avery', other: 'person-casey' };
  });
  if (want('withdraw')) out.withdraw = await race('withdraw', async () => {
    const { app, gid } = await kept();
    return { app, act: () => app.click('corr-withdraw', gid, { process: 'release-notes' }), mine: corr, who: 'person-avery', other: 'person-casey' };
  });
  if (want('decide')) out.decide = await race('decide', async () => {
    const { app, gid } = await kept('person-morgan'); await openPage(app);
    return { app, act: () => app.click('corr-applied', gid), mine: corr, who: 'person-morgan', other: 'person-avery', transfer: (fs) => transfer(app, fs) };
  });
  if (want('apply')) out.apply = await race('apply', async () => {
    const { app, gid } = await kept();
    app.click('keep-open', gid, { process: 'release-notes' }); await app.tick(120);
    app.choose('person-morgan'); await app.tick(80);
    app.click('corr-review', gid); await app.tick(60);
    return { app, act: () => app.click('corr-apply', gid), mine: (p) => corr(p) || /^maps\/drafts\//.test(p), who: 'person-morgan', other: 'person-avery', transfer: (fs) => transfer(app, fs) };
  });
  if (want('publish')) out.publish = await race('publish', async () => {
    const { app } = await appliedKeep(); await openPage(app);
    app.set('change-note', 'Post the notes');
    return { app, act: () => app.click('publish', 'release-notes'), mine: (p) => /^publications\//.test(p) && !/\/v\d+-ow/.test(p), who: 'person-morgan', other: 'person-avery', transfer: (fs) => transfer(app, fs), extra: keepGone };
  });
  if (want('promote')) out.promote = await race('promote', async () => {
    const { app } = await appliedKeep(); await openPage(app);
    app.set('change-note', 'Post the notes'); app.click('stage-draft', 'release-notes'); await app.tick(300);
    const st = app.files('staged/release-notes/').filter(f => /publication\.json$/.test(f)), folder = JSON.parse(app.fs.files[st[0]].t).folder;
    await refresh(app, 200); await openPage(app);
    return { app, act: () => app.click('promote-stage', folder), mine: (p) => /^publications\//.test(p) && !/\/v\d+-ow/.test(p), who: 'person-morgan', other: 'person-avery', transfer: (fs) => transfer(app, fs), extra: keepGone };
  });
  if (process.env.RACE_SAY) console.log(JSON.stringify(out));
});

run();
