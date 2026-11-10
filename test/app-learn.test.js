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

run();
