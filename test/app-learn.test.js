// Keep for next time (4.0, docs/design.md 45.3) in the app, slice 5: one button on a to-do keeps it as a suggestion for its
// checklist (one keep record, nothing else; the run doesn't change). The to-do then says where that stands (Suggested,
// Applied to draft, Published in vN) and opens its correction; the correction shows every source and each wording, and only
// the checklist's active owner reviews, applies or declines it. Placing and rewording go through flightdeck todo keep.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

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

run();
