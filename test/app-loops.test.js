// Loops (3.0) in the app: the run screen lists a loop's stories, adds them, starts a story's run, approves one without a
// run, approves the loop from its roll-up, and sends the approval back for review when the list changes after it. Every
// change to the list is a scope record in proposals/, the same ones flightdeck loop writes.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

const KID = ['---', 'process: validate-story', 'title: Validate a story', 'owner: person-avery', 'context: issue, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
  '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release 4.1', 'owner: person-avery', '---', '',
  '## Stories · DO-CONFIRM {#stories}', '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');

async function setup() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const put = (md, id, rand) => {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '3.0.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  };
  put(KID, 'validate-story', 'vs000001');
  put(PARENT, 'release-readiness', 'rr000001');
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-readiness'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  assert.ok(/data-act="loop-add"/.test(app.html()), 'set-up: the loop step is shown with its list');
  return app;
}
const parentRun = (app) => JSON.parse(app.fs.files[app.files('runs/release-readiness/').find(p => /run\.json$/.test(p))].t);
const kidPaths = (app) => app.files('runs/validate-story/').filter(p => /run\.json$/.test(p));
const txt = (app) => app.html().replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'");
const scopes = (app) => app.files('proposals/').filter(p => /\/req-/.test(p));
async function clear(app, path) {
  const kid = JSON.parse(app.fs.files[path].t), at = new Date(Date.now() + 1000).toISOString(), R = app.PF.run;
  kid.steps.verdict = { s: 'done', by: 'person-avery', at, values: { decision: 'cleared' } };
  kid.details.disposition = 'cleared';
  const rr = R.sanitize(JSON.parse(JSON.stringify(kid))), mm = R.mapOf(rr);
  mm.phases.forEach(p => { if (p.gate) kid.gates[p.gate.id] = { s: 'passed', by: 'person-avery', at, approved: R.gateInputs(rr, mm, p.gate) }; });
  kid.ended = { outcome: 'Completed', by: 'person-avery', at }; kid.state = 'completed'; kid.rev = (kid.rev || 0) + 1;
  await app.fs.write(path, JSON.stringify(kid));
  app.click('refresh'); await app.tick(150);
}

rule('App: add stories, start one\'s run, approve one without a run, approve the loop, and send the approval back when a story is added after it', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101, https://jira.example.com/browse/ABC-102'); app.click('loop-add', 'each'); await app.tick(150);
  assert.strictEqual(scopes(app).length, 1, 'one scope request written');
  const req = JSON.parse(app.fs.files[scopes(app)[0]].t);
  assert.deepStrictEqual([req.format, req.by, req.changes.map(c => c.item.key)], ['flightdeck-plan/3', 'person-avery', ['ABC-101', 'ABC-102']]);
  assert.ok(/2 in scope · 0 cleared by validation · 2 not started/.test(txt(app)), 'the exact counts: ' + ((app.html().match(/<b>[^<]*in scope[^<]*<\/b>/g) || []).join(' | ') || app.html().replace(/<svg[\s\S]*?<\/svg>/g, '').match(/loopbox[\s\S]{0,400}/)));
  assert.ok(!/data-act="loop-approve"/.test(app.html()), 'no approval while stories are open');

  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  assert.strictEqual(kidPaths(app).length, 1, 'one story run started');
  const kid = JSON.parse(app.fs.files[kidPaths(app)[0]].t);
  assert.deepStrictEqual([kid.parent.item.key, kid.parent.item.attempt, kid.details.issue, kid.features.indexOf('loops') >= 0], ['ABC-101', 1, 'ABC-101', true]);
  await clear(app, kidPaths(app)[0]);

  app.click('loop-exception', 'each', { item: 'ABC-102' }); await app.tick(80);
  assert.strictEqual(scopes(app).length, 1, 'an approval without a run needs a reason first');
  app.set('loop-why-each', 'Docs-only change'); app.click('loop-exception', 'each', { item: 'ABC-102' }); await app.tick(150);
  assert.strictEqual(scopes(app).length, 2);
  assert.ok(/2 in scope · 1 cleared by validation · 1 approved without a run/.test(txt(app)), 'scope, outcome and exception kept apart');

  app.click('loop-approve', 'each'); await app.tick(150);
  let r = parentRun(app);
  assert.deepStrictEqual([r.steps.each.s, r.steps.each.loop.summary], ['done', '2 in scope · 1 cleared by validation · 1 approved without a run']);

  app.set('loop-add-each', 'ABC-103'); app.click('loop-add', 'each'); await app.tick(150);
  assert.ok(/ABC-103 was added after this approval\./.test(txt(app)), 'the change since the approval, in words');
  app.click('loop-unsettle', 'each'); await app.tick(150);
  r = parentRun(app);
  assert.strictEqual(r.steps.each.s, 'recheck');
  assert.ok(/ABC-103 was added after this approval\./.test(r.steps.each.values.changes));
  assert.ok(r.steps.each.history.some(h => h.loop && h.loop.summary), 'the earlier approval is kept in its history');
});

rule('App: a proposed removal is kept or removed by a person\'s decision, written beside the request', async () => {
  const app = await setup(), PF = app.PF, LP = PF.loop, r = parentRun(app);
  const sync = async (key, keys) => {
    const obs = { source: { system: 'jira' }, generation: key, query: 'fixVersion = 4.1', observedAt: new Date().toISOString(), items: keys.map(n => ({ id: String(10000 + n), key: 'ABC-' + n, title: 'Story ' + n })), reported: keys.length, fetched: keys.length, complete: true, errors: [] };
    const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: r.id, step: 'each' }, observation: obs }, key, { name: 'release-helper', version: '1.0' });
    assert.strictEqual(c.errors.length, 0, c.errors.join(' '));
    const d = await PF.repo.loadAll(app.fs, {}), V = LP.view(r, 'each', { records: d.scopes, runs: d.runs });
    const P = LP.project(r, V, c.intent, {}), f = LP.buildRequest(c.intent, { seen: P.seen, children: P.record.children, now: new Date().toISOString(), app: '3.0.0' });
    await app.fs.write('proposals/' + f.id + '.json', LP.text(f));
    app.click('refresh'); await app.tick(150);
    return P;
  };
  await sync('sync-1', [101, 102]);
  const P = await sync('sync-2', [101]);
  assert.strictEqual(P.proposed.length, 1, 'set-up: ABC-102 proposed for removal');
  assert.ok(/data-act="loop-keep"/.test(app.html()) && /data-act="loop-accept"/.test(app.html()), 'Keep and Remove offered for the proposed removal');
  app.click('loop-keep', 'each', { item: 'ABC-102' }); await app.tick(150);
  const dec = scopes(app).filter(p => /\.status-/.test(p));
  assert.strictEqual(dec.length, 1, 'one decision written');
  const df = JSON.parse(app.fs.files[dec[0]].t);
  assert.deepStrictEqual([df.format, df.op, df.by], ['flightdeck-plan-status/3', 'keep', 'person-avery']);
  assert.ok(!/data-act="loop-keep"/.test(app.html()) && /2 in scope/.test(txt(app)), 'kept in scope, no longer waiting');
});

rule('Review round 1: a result changed after approval sends the loop back at once; a double click starts one run; a story still in Jira shows the mismatch', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.click('loop-start', 'each', { item: 'ABC-101' }); app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(200);
  assert.strictEqual(kidPaths(app).length, 1, 'two clicks, one run');
  await clear(app, kidPaths(app)[0]);
  app.click('loop-approve', 'each'); await app.tick(150);
  assert.strictEqual(parentRun(app).steps.each.s, 'done');
  const k = JSON.parse(app.fs.files[kidPaths(app)[0]].t);
  k.steps.verdict.values.decision = 'needs-work'; k.details.disposition = 'needs-work'; k.steps.verdict.at = new Date(Date.now() + 5000).toISOString(); k.rev = (k.rev || 0) + 1;
  await app.fs.write(kidPaths(app)[0], JSON.stringify(k));
  app.click('refresh'); await app.tick(250);
  const r = parentRun(app);
  assert.strictEqual(r.steps.each.s, 'recheck', 'the recorder sends it back without being asked');
  assert.ok(/ABC-101 now returns needs-work/.test(r.steps.each.values.changes), r.steps.each.values.changes);
});

run();
