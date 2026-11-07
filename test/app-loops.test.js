// Loops (3.0) in the app: the run screen lists a loop's stories, adds them, starts a story's run, approves one without a
// run, approves the loop from its roll-up, and sends the approval back for review when the list changes after it. Every
// change to the list is a scope record in proposals/, the same ones flightdeck loop writes.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot, gate } = require('./app-harness');

const KID = ['---', 'process: validate-story', 'title: Validate a story', 'owner: person-avery', 'context: issue, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
  '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release 4.1', 'owner: person-avery', '---', '',
  '## Stories · DO-CONFIRM {#stories}', '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');

async function setup(o) {
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, o || {})); await app.tick(80); app.choose('person-avery'); await app.tick();
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
async function clear(app, path, decision) {
  decision = decision || 'cleared';
  const kid = JSON.parse(app.fs.files[path].t), at = new Date(Date.now() + 1000).toISOString(), R = app.PF.run;
  kid.steps.verdict = { s: 'done', by: 'person-avery', at, values: { decision } };
  kid.details.disposition = decision;
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

rule('Review round 1: an owner\'s Start mine, ownership from the list, and sixty stories paged with an open-only filter', async () => {
  const app = await setup();
  const keys = Array.from({ length: 60 }, (_, n) => 'ABC-' + (201 + n)).join(', ');
  app.set('loop-add-each', keys); app.click('loop-add', 'each'); await app.tick(200);
  assert.ok(/Show all 60 stories/.test(txt(app)), 'paged at 50');
  assert.strictEqual((app.html().match(/data-act="loop-start"/g) || []).length, 50);
  app.click('loop-more', 'each'); await app.tick(50);
  assert.strictEqual((app.html().match(/data-act="loop-start"/g) || []).length, 60);
  app.click('loop-owner', 'each', { item: 'ABC-201' }); await app.tick(150);
  const own = scopes(app).map(p => JSON.parse(app.fs.files[p].t)).find(f => (f.changes || []).some(c => c.op === 'owner'));
  assert.deepStrictEqual(own.changes.map(c => [c.op, c.item.key, c.owner]), [['owner', 'ABC-201', 'person-avery']]);
  assert.ok(/Start mine/.test(txt(app)), 'the owner\'s own story offers Start mine');
  app.click('loop-open', 'each'); await app.tick(50);
  assert.ok(/Show every story/.test(txt(app)));
});

async function ask(app, changes, key) {
  const PF = app.PF, LP = PF.loop, r = parentRun(app);
  const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: r.id, step: 'each' }, changes }, key, { name: 'release-helper', version: '1.0' });
  assert.strictEqual(c.errors.length, 0, c.errors.join(' '));
  const d = await PF.repo.loadAll(app.fs, {}), V = LP.view(r, 'each', { records: d.scopes, runs: d.runs });
  const f = LP.buildRequest(c.intent, { seen: V.ledger.heads, children: [], now: new Date().toISOString(), app: '3.0.0' });
  await app.fs.write('proposals/' + f.id + '.json', LP.text(f));
  app.click('refresh'); await app.tick(250);
  return f.id;
}
const outcome = (app, id) => { const p = app.files('proposals/').find(x => x.indexOf(id + '.status-') >= 0); return p ? JSON.parse(app.fs.files[p].t) : null; };

rule('The CLI asks; the recorder applies: start, approve and send-back requests are carried out once by the recorder\'s window, a refusal says why', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150);
  const early = await ask(app, [{ op: 'approve', as: 'person-avery' }], 'ap-early');
  assert.notStrictEqual((parentRun(app).steps.each || {}).s, 'done', 'an approval that fails the roll-up isn\'t applied');
  assert.deepStrictEqual([outcome(app, early).op, /can't be approved yet/.test(outcome(app, early).reason)], ['refused', true]);
  const st = await ask(app, [{ op: 'start', item: { key: 'ABC-101' }, as: 'person-avery' }, { op: 'start', item: { key: 'ABC-102' }, as: 'person-avery' }], 'st-1');
  assert.strictEqual(kidPaths(app).length, 2, 'both story runs started by the recorder');
  assert.strictEqual(outcome(app, st).op, 'applied');
  app.click('refresh'); await app.tick(200);
  assert.strictEqual(kidPaths(app).length, 2, 'applied once, not again on the next refresh');
  for (const p of kidPaths(app)) await clear(app, p);
  const ap = await ask(app, [{ op: 'approve', as: 'person-avery' }], 'ap-1');
  let r = parentRun(app);
  assert.deepStrictEqual([r.steps.each.s, r.steps.each.loop.onBehalf, outcome(app, ap).op], ['done', 'release-helper', 'applied']);
  const sb = await ask(app, [{ op: 'send-back', as: 'person-avery', reason: 'Scope review' }], 'sb-1');
  r = parentRun(app);
  assert.deepStrictEqual([r.steps.each.s, outcome(app, sb).op], ['recheck', 'applied']);
  assert.ok(/Scope review/.test(r.steps.each.values.changes), r.steps.each.values.changes);
  assert.ok(/refused: It can't be approved yet/.test(txt(app)), 'a refused request is shown with why');
});

rule('Start all under my recording: a preview names what starts and what is skipped, cancel starts nothing, confirm starts each once', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101, ABC-102, ABC-103'); app.click('loop-add', 'each'); await app.tick(150);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  app.set('loop-why-each', 'Docs-only change'); app.click('loop-exception', 'each', { item: 'ABC-102' }); await app.tick(150);
  assert.ok(/Start mine|Start its run/.test(txt(app)) && /Start all under my recording…/.test(txt(app)));
  app.click('loop-start-all', 'each'); await app.tick(50);
  const t = txt(app);
  assert.ok(/Start 1 run: ABC-103/.test(t), t.slice(t.indexOf('Start 1'), t.indexOf('Start 1') + 200));
  assert.ok(/ABC-101 \([^)]*\)/.test(t) && /ABC-102 \([^)]*\)/.test(t), 'skipped ones named with why');
  app.click('loop-start-all-cancel', 'each'); await app.tick(50);
  assert.strictEqual(kidPaths(app).length, 1, 'cancel starts nothing');
  app.click('loop-start-all', 'each'); await app.tick(50);
  app.click('loop-start-all-confirm', 'each'); app.click('loop-start-all-confirm', 'each'); await app.tick(250);
  assert.strictEqual(kidPaths(app).length, 2, 'confirm starts ABC-103 once');
});

rule('Review round 1 (P2-10): back from a story\'s run, the release table keeps its page, its filter and the row you left from', async () => {
  const app = await setup({ domFocus: true });
  const keys = Array.from({ length: 60 }, (_, n) => 'ABC-' + (201 + n)).join(', ');
  app.set('loop-add-each', keys); app.click('loop-add', 'each'); await app.tick(200);
  app.click('loop-start', 'each', { item: 'ABC-255' }); await app.tick(200);
  app.click('loop-more', 'each'); await app.tick(50);
  app.click('loop-open', 'each'); await app.tick(50);
  const kid = JSON.parse(app.fs.files[kidPaths(app)[0]].t);
  app.click('open-run', 'validate-story/' + kid.id, { loop: 'each', item: 'ABC-255' }); await app.settle();
  assert.ok(!/loop-items/.test(app.html()), 'set-up: on the story\'s run');
  app.back(); await app.settle();
  assert.ok(/Show every story/.test(txt(app)), 'the open-only filter is kept');
  assert.strictEqual((app.html().match(/data-act="loop-start"/g) || []).length, 59, 'all pages are still shown');
  assert.strictEqual(app.activeId(), 'loop-row-each-ABC-255', 'focus returns to the row you left from');
});

rule('Review round 1 (P1-4): when a scope record can\'t be read, the last readable view stays on screen beside the hold', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150);
  assert.ok(/2 in scope/.test(txt(app)));
  const p = scopes(app)[0];
  app.fs.files[p] = { t: app.fs.files[p].t.slice(0, 40), m: Date.now() };
  app.click('refresh'); await app.tick(200);
  const t = txt(app);
  assert.ok(/can't be read yet/.test(t), 'the hold is shown');
  assert.ok(/Last readable view[^]*2 in scope/.test(t), 'beside the last readable view: ' + t.slice(t.indexOf('Last'), t.indexOf('Last') + 200));
  assert.ok(/ABC-101/.test(t) && /ABC-102/.test(t), 'its stories are still listed');
  assert.ok(!/data-act="loop-approve"/.test(app.html()), 'no approval while held');
});

rule('Review round 2 (3): proposals that can\'t be read, one file or the whole folder, hold an approved loop in this window too', async () => {
  for (const how of ['file', 'list']) {
    const app = await setup();
    app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
    app.set('loop-why-each', 'Docs-only change'); app.click('loop-exception', 'each', { item: 'ABC-101' }); await app.tick(150);
    app.click('loop-approve', 'each'); await app.tick(150);
    assert.strictEqual(parentRun(app).steps.each.s, 'done', 'set-up: approved');
    const fs = app.fs, read = fs.read.bind(fs), list = fs.list.bind(fs);
    if (how === 'file') fs.read = (p) => /^proposals\//.test(p) ? Promise.reject(new Error('EIO')) : read(p);
    else fs.list = (p) => /^proposals/.test(p) ? Promise.reject(new Error('EIO')) : list(p);
    app.click('refresh'); await app.tick(250);
    const t = txt(app);
    assert.ok(/Held:/.test(t), how + ': the hold is shown');
    assert.ok(/Last readable view[^]*1 in scope/.test(t), how + ': the records read before are kept beside it');
    assert.ok(/Approval needs review|can't be read yet/.test(t), how + ': the approval is held');
  }
});

rule('Review round 2 (1, 9): a request from someone not in people.json, without authority, or mixing actions is refused with why and changes nothing', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150);
  const out = await ask(app, [{ op: 'start', item: { key: 'ABC-101' }, as: 'person-outsider' }], 'x-1');
  assert.deepStrictEqual([outcome(app, out).op, kidPaths(app).length], ['refused', 0]);
  assert.ok(/isn't in people\.json/.test(outcome(app, out).reason), outcome(app, out).reason);
  const nope = await ask(app, [{ op: 'start', item: { key: 'ABC-101' }, as: 'person-casey' }], 'x-2');
  assert.deepStrictEqual([outcome(app, nope).op, kidPaths(app).length], ['refused', 0]);
  assert.ok(/recorder/.test(outcome(app, nope).reason), outcome(app, nope).reason);
  const mixed = await ask(app, [{ op: 'send-back', as: 'person-avery' }, { op: 'approve', as: 'person-avery' }], 'x-3');
  assert.strictEqual(outcome(app, mixed).op, 'refused');
  assert.ok(/one kind of action/.test(outcome(app, mixed).reason), outcome(app, mixed).reason);
});

rule('Review round 2 (6): Start all isn\'t offered for a story whose run can\'t start (the pinned checklist is gone)', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  assert.ok(/Start all under my recording…/.test(txt(app)), 'set-up: offered');
  app.files('publications/validate-story/').forEach(p => { delete app.fs.files[p]; });
  app.click('refresh'); await app.tick(200);
  assert.ok(!/Start all under my recording…/.test(txt(app)), 'not offered when nothing can start');
});

rule('Review round 2 (5): an approve or send-back whose outcome couldn\'t be written is recognized from the run on the next read, never applied twice', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.set('loop-why-each', 'Docs-only change'); app.click('loop-exception', 'each', { item: 'ABC-101' }); await app.tick(150);
  const fs = app.fs, write = fs.write.bind(fs);
  fs.write = (p, t, o) => /\.status-/.test(p) && /"applied"|"refused"/.test(String(t)) ? Promise.reject(new Error('EIO')) : write(p, t, o);
  const ap = await ask(app, [{ op: 'approve', as: 'person-avery' }], 'r5-ap');
  assert.strictEqual(parentRun(app).steps.each.s, 'done', 'set-up: approved, its outcome not written');
  const hist = (parentRun(app).steps.each.history || []).length;
  fs.write = write;
  app.click('refresh'); await app.tick(250);
  assert.strictEqual((parentRun(app).steps.each.history || []).length, hist, 'not approved again');
  assert.strictEqual(outcome(app, ap).op, 'applied', 'recorded as applied once it can be');
  fs.write = (p, t, o) => /\.status-/.test(p) && /"applied"|"refused"/.test(String(t)) ? Promise.reject(new Error('EIO')) : write(p, t, o);
  const sb = await ask(app, [{ op: 'send-back', as: 'person-avery', reason: 'Recheck' }], 'r5-sb');
  assert.strictEqual(parentRun(app).steps.each.s, 'recheck');
  fs.write = write;
  app.click('loop-approve', 'each'); await app.tick(200);
  assert.strictEqual(parentRun(app).steps.each.s, 'done', 'approved again by the person');
  app.click('refresh'); await app.tick(250);
  assert.deepStrictEqual([parentRun(app).steps.each.s, outcome(app, sb).op], ['done', 'applied'], 'the earlier send-back isn\'t replayed');
});

rule('Review round 2 (7): a story completed while you were on its run stays in the open-only table for your return, with focus on it', async () => {
  const app = await setup({ domFocus: true });
  const keys = Array.from({ length: 12 }, (_, n) => 'ABC-' + (301 + n)).join(', ');
  app.set('loop-add-each', keys); app.click('loop-add', 'each'); await app.tick(200);
  app.click('loop-start', 'each', { item: 'ABC-305' }); await app.tick(200);
  app.click('loop-open', 'each'); await app.tick(50);
  const kp = kidPaths(app)[0], kid = JSON.parse(app.fs.files[kp].t);
  app.click('open-run', 'validate-story/' + kid.id, { loop: 'each', item: 'ABC-305' }); await app.settle();
  await clear(app, kp);
  app.back(); await app.settle();
  assert.ok(/Show every story/.test(txt(app)), 'the filter is kept');
  assert.ok(/id="loop-row-each-ABC-305"/.test(app.html()), 'the row you return to is kept for this return');
  assert.strictEqual(app.activeId(), 'loop-row-each-ABC-305');
});

rule('Review round 2 (8): an unchanged approval can be sent back from the run screen with a reason; applied requests stay listed, bounded', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.set('loop-why-each', 'Docs-only change'); app.click('loop-exception', 'each', { item: 'ABC-101' }); await app.tick(150);
  const ap = await ask(app, [{ op: 'approve', as: 'person-avery' }], 'h-1');
  assert.strictEqual(parentRun(app).steps.each.s, 'done');
  assert.ok(/Avery Lee asked to approve · applied/.test(txt(app)), 'an applied request is still listed');
  assert.ok(/data-act="loop-unsettle"/.test(app.html()), 'Send the approval back is offered with nothing changed');
  app.set('loop-why-each', 'Scope check with the release owner'); app.click('loop-unsettle', 'each'); await app.tick(150);
  const r = parentRun(app);
  assert.strictEqual(r.steps.each.s, 'recheck');
  assert.ok(/Scope check with the release owner/.test(r.steps.each.values.changes), r.steps.each.values.changes);
  assert.ok(ap);
});

rule('Review round 3 (1): with its only scope request cut short, a passed loop phase closes again and Ship can\'t be recorded', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.set('loop-why-each', 'Docs-only change'); app.click('loop-exception', 'each', { item: 'ABC-101' }); await app.tick(150);
  app.click('loop-approve', 'each'); await app.tick(150);
  app.click('pass', '0'); await app.tick(150);
  assert.strictEqual(parentRun(app).gates[Object.keys(parentRun(app).gates)[0]].s, 'passed', 'set-up: gate passed');
  scopes(app).forEach(p => { app.fs.files[p] = { t: app.fs.files[p].t.slice(0, 30), m: Date.now() }; });
  app.click('refresh'); await app.tick(250);
  app.click('toggle', 'ship1'); await app.tick(150);
  assert.ok(!(parentRun(app).steps.ship1 && parentRun(app).steps.ship1.s === 'done'), 'Ship isn\'t recorded while the loop is held');
});

rule('Review round 3 (2): a request carried out while the folder is switched writes nothing into the folder opened next, and stops', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150);
  const was = app.fs, write = was.write.bind(was), hold = gate();
  was.write = (p, t, o) => /^runs\/validate-story\//.test(p) ? hold.p.then(() => write(p, t, o)) : write(p, t, o);
  const PF = app.PF, LP = PF.loop, r = parentRun(app);
  const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: r.id, step: 'each' }, changes: [{ op: 'start', item: { key: 'ABC-101' }, as: 'person-avery' }, { op: 'start', item: { key: 'ABC-102' }, as: 'person-avery' }] }, 'sw-1', { name: 'release-helper', version: '1.0' });
  const d = await PF.repo.loadAll(was, {}), V = LP.view(r, 'each', { records: d.scopes, runs: d.runs });
  const f = LP.buildRequest(c.intent, { seen: V.ledger.heads, children: [], now: new Date().toISOString(), app: '3.0.0' });
  await write('proposals/' + f.id + '.json', LP.text(f));
  app.click('refresh'); await app.tick(150);
  app.click('reset-examples'); await app.tick(60); app.choose('person-casey'); await app.tick();
  const now = app.fs;
  assert.ok(now !== was, 'set-up: another folder');
  hold.open(); await app.tick(300);
  assert.deepStrictEqual(Object.keys(now.files).filter(p => p.indexOf(f.id) >= 0), [], 'no outcome in the folder opened next: ' + JSON.stringify(Object.keys(now.files).filter(p => /proposals|validate-story/.test(p))));
  assert.ok(Object.keys(was.files).filter(p => /^runs\/validate-story\/.*run\.json$/.test(p)).length <= 1, 'the batch stopped after the switch');
});

rule('Review round 3 (4): a start request whose outcome couldn\'t be written is recovered from the run it started, and recorded applied', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const fs = app.fs, write = fs.write.bind(fs);
  fs.write = (p, t, o) => /\.status-/.test(p) && /"applied"|"refused"/.test(String(t)) ? Promise.reject(new Error('EIO')) : write(p, t, o);
  const st = await ask(app, [{ op: 'start', item: { key: 'ABC-101' }, as: 'person-avery' }], 'r4-st');
  assert.strictEqual(kidPaths(app).length, 1, 'set-up: started, its outcome not written');
  assert.strictEqual(JSON.parse(app.fs.files[kidPaths(app)[0]].t).parent.item.request, st, 'the run names the request that started it');
  fs.write = write;
  app.click('refresh'); await app.tick(250);
  assert.strictEqual(kidPaths(app).length, 1, 'not started again');
  assert.deepStrictEqual([outcome(app, st).op, /ABC-101/.test(outcome(app, st).reason)], ['applied', true], outcome(app, st).reason);
});

rule('Review round 3 (5): a story whose run returned needs-work offers a new attempt; the earlier attempt is kept', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  await clear(app, kidPaths(app)[0], 'needs-work');
  assert.ok(/Start a new attempt/.test(txt(app)), 'a new attempt is offered');
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(200);
  const ks = kidPaths(app).map(p => JSON.parse(app.fs.files[p].t).parent.item.attempt).sort();
  assert.deepStrictEqual(ks, [1, 2], 'both attempts kept');
});

rule('Review round 3 (6): the child\'s Part of … Open it link returns to the loop\'s row too, kept under the open-only filter', async () => {
  const app = await setup({ domFocus: true });
  const keys = Array.from({ length: 12 }, (_, n) => 'ABC-' + (401 + n)).join(', ');
  app.set('loop-add-each', keys); app.click('loop-add', 'each'); await app.tick(200);
  app.click('loop-start', 'each', { item: 'ABC-405' }); await app.tick(200);
  app.click('loop-open', 'each'); await app.tick(50);
  const kp = kidPaths(app)[0], kid = JSON.parse(app.fs.files[kp].t), parent = parentRun(app);
  app.click('open-run', 'validate-story/' + kid.id); await app.settle();
  await clear(app, kp);
  app.click('run-details'); await app.tick(50);
  const link = (app.html().match(/<button class="linkish" data-act="open-run" data-id="release-readiness\/[^"]*"[^>]*>/) || [''])[0];
  assert.ok(/data-parent-loop="each"/.test(link) && /data-item="ABC-405"/.test(link), 'the link names the loop and the story: ' + link);
  app.click('open-run', 'release-readiness/' + parent.id, { parentLoop: 'each', item: 'ABC-405' }); await app.settle();
  assert.ok(/id="loop-row-each-ABC-405"/.test(app.html()), 'the completed row is kept for this return');
  assert.strictEqual(app.activeId(), 'loop-row-each-ABC-405');
});

rule('Review round 3 (7): the run screen assigns a story to anyone in people.json and unassigns it, as loop owner does', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  assert.ok(/<select id="loop-who-each"/.test(app.html()), 'an owner picker');
  app.set('loop-who-each', 'person-casey'); app.click('loop-assign', 'each', { item: 'ABC-101' }); await app.tick(150);
  const owners = () => scopes(app).map(p => JSON.parse(app.fs.files[p].t)).filter(f => (f.changes || []).some(c => c.op === 'owner')).map(f => f.changes[0].owner);
  assert.deepStrictEqual(owners(), ['person-casey']);
  assert.ok(/Casey Nguyen/.test(txt(app)) && /data-act="loop-unassign"/.test(app.html()), 'shown, with Unassign');
  app.click('loop-unassign', 'each', { item: 'ABC-101' }); await app.tick(150);
  assert.deepStrictEqual(owners().sort(), ['', 'person-casey']);
  assert.ok(!/data-act="loop-unassign"/.test(app.html()), 'no owner now');
});

rule('Review round 4 (2, 5): a request naming a story twice is refused; a send-back with nothing changed needs a reason, as the button does', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const twice = await ask(app, [{ op: 'start', item: { key: 'ABC-101' }, as: 'person-avery' }, { op: 'start', item: { key: 'ABC-101' }, as: 'person-avery' }], 'd-1');
  assert.deepStrictEqual([outcome(app, twice).op, kidPaths(app).length], ['refused', 0]);
  assert.ok(/twice/.test(outcome(app, twice).reason), outcome(app, twice).reason);
  app.set('loop-why-each', 'Docs-only change'); app.click('loop-exception', 'each', { item: 'ABC-101' }); await app.tick(150);
  app.click('loop-approve', 'each'); await app.tick(150);
  const bare = await ask(app, [{ op: 'send-back', as: 'person-avery' }], 'd-2');
  assert.deepStrictEqual([outcome(app, bare).op, parentRun(app).steps.each.s], ['refused', 'done']);
  assert.ok(/why/i.test(outcome(app, bare).reason), outcome(app, bare).reason);
});

rule('Review round 4 (3): a request interrupted by a folder switch is carried out when its folder is read again', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150);
  const was = app.fs, write = was.write.bind(was), hold = gate();
  was.write = (p, t, o) => /^runs\/validate-story\//.test(p) ? hold.p.then(() => write(p, t, o)) : write(p, t, o);
  const PF = app.PF, LP = PF.loop, r = parentRun(app);
  const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: r.id, step: 'each' }, changes: [{ op: 'start', item: { key: 'ABC-101' }, as: 'person-avery' }, { op: 'start', item: { key: 'ABC-102' }, as: 'person-avery' }] }, 'sw-2', { name: 'release-helper', version: '1.0' });
  const d = await PF.repo.loadAll(was, {}), V = LP.view(r, 'each', { records: d.scopes, runs: d.runs });
  const f = LP.buildRequest(c.intent, { seen: V.ledger.heads, children: [], now: new Date().toISOString(), app: '3.0.0' });
  await write('proposals/' + f.id + '.json', LP.text(f));
  app.click('refresh'); await app.tick(150);
  app.click('reset-examples'); await app.tick(60);
  const now = app.fs;
  hold.open(); await app.tick(300);
  was.write = write;
  Object.keys(was.files).forEach(p => { if (!(p in now.files)) now.files[p] = was.files[p]; });
  app.choose('person-avery'); await app.tick();
  app.click('refresh'); await app.tick(400);
  app.click('refresh'); await app.tick(400);
  const kids = Object.keys(now.files).filter(p => /^runs\/validate-story\/.*run\.json$/.test(p)).map(p => JSON.parse(now.files[p].t).parent.item.key).sort();
  assert.deepStrictEqual(kids, ['ABC-101', 'ABC-102'], 'both started once, in the folder read again');
  assert.ok(Object.keys(now.files).some(p => p.indexOf(f.id + '.status-') >= 0), 'its outcome is recorded');
});

rule('Review round 4 (4): two runs for one story\'s attempt: the run screen offers which one counts, and the choice is a scope record', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  const kp = kidPaths(app)[0], twin = JSON.parse(app.fs.files[kp].t);
  twin.id = 'twin0001'; await app.fs.write('runs/validate-story/twin0001/run.json', JSON.stringify(twin));
  app.click('refresh'); await app.tick(200);
  for (const p of kidPaths(app)) await clear(app, p);
  assert.ok(/More than one run/.test(txt(app)) && /data-act="loop-choose"/.test(app.html()), 'competing, with a choice offered');
  app.click('loop-choose', 'each', { item: 'ABC-101', run: 'twin0001' }); await app.tick(200);
  const ch = scopes(app).map(p => JSON.parse(app.fs.files[p].t)).filter(f => (f.changes || []).some(c => c.op === 'choose'));
  assert.deepStrictEqual(ch.map(f => f.changes[0].run), ['twin0001']);
  assert.ok(/1 cleared by validation/.test(txt(app)) && !/data-act="loop-choose"/.test(app.html()), 'counted, no longer competing');
});

rule('Review round 5 (3): Start all stops at a folder switch: nothing lands in the folder opened next', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150);
  const was = app.fs, write = was.write.bind(was), hold = gate();
  was.write = (p, t, o) => /^runs\/validate-story\//.test(p) ? hold.p.then(() => write(p, t, o)) : write(p, t, o);
  app.click('loop-start-all', 'each'); await app.tick(50);
  app.click('loop-start-all-confirm', 'each'); await app.tick(50);
  app.click('reset-examples'); await app.tick(60);
  const now = app.fs;
  Object.keys(was.files).forEach(p => { if (!(p in now.files)) now.files[p] = was.files[p]; });
  app.choose('person-avery'); await app.tick(); app.click('refresh'); await app.tick(150);
  const before = Object.keys(now.files).filter(p => /^runs\/validate-story\//.test(p)).length;
  hold.open(); await app.tick(400);
  assert.strictEqual(Object.keys(now.files).filter(p => /^runs\/validate-story\//.test(p)).length, before, 'nothing written into the folder opened next');
  assert.ok(Object.keys(was.files).filter(p => /^runs\/validate-story\/.*run\.json$/.test(p)).length <= 1, 'the batch stopped');
});

rule('Review round 5 (6): every competing run can be chosen on the run screen, however many there are', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  const twin = JSON.parse(app.fs.files[kidPaths(app)[0]].t);
  for (let n = 1; n <= 5; n++) { const t = Object.assign({}, twin, { id: 'twin000' + n }); await app.fs.write('runs/validate-story/twin000' + n + '/run.json', JSON.stringify(t)); }
  app.click('refresh'); await app.tick(250);
  const opts = (app.html().match(/<select id="loop-pick-[^"]*"[^]*?<\/select>/) || [''])[0];
  assert.strictEqual((opts.match(/<option/g) || []).length, 6, 'all six in the picker');
  assert.ok(/value="twin0005"/.test(opts));
  const pick = opts.match(/id="(loop-pick-[^"]*)"/)[1];
  app.set(pick, 'twin0005'); app.click('loop-choose', 'each', { item: 'ABC-101', pick }); await app.tick(200);
  const ch = scopes(app).map(p => JSON.parse(app.fs.files[p].t)).filter(f => (f.changes || []).some(c => c.op === 'choose'));
  assert.deepStrictEqual(ch.map(f => f.changes[0].run), ['twin0005'], 'the picked run is the one counted');
  assert.strictEqual(ch[0].changes[0].candidates.length, 6, 'bound to all six it saw');
});

run();
