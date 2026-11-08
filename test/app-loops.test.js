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
  o = Object.assign({}, o || {}); const maps = o.maps || {}; delete o.maps;
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, o)); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const put = (md, id, rand) => {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '3.0.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  };
  put(maps.kid || KID, 'validate-story', 'vs000001');
  put(maps.parent || PARENT, 'release-readiness', 'rr000001');
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-readiness'); await app.settle();
  Object.keys(maps.details || {}).forEach(k => app.set('detail-' + k, maps.details[k]));
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

async function ask(app, changes, key, kind) {
  const PF = app.PF, LP = PF.loop, r = parentRun(app);
  const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: r.id, step: 'each' }, changes }, key, { name: 'release-helper', version: '1.0' }, kind);
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

rule('Review round 6 (2): a request that saw a scope record this computer can\'t read stays held: nothing is started and no outcome is written', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const PF = app.PF, LP = PF.loop, r = parentRun(app);
  const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: r.id, step: 'each' }, changes: [{ op: 'start', item: { key: 'ABC-101' }, as: 'person-avery' }] }, 'held-1', { name: 'release-helper', version: '1.0' });
  assert.strictEqual(c.errors.length, 0, c.errors.join(' '));
  const d = await PF.repo.loadAll(app.fs, {}), V = LP.view(r, 'each', { records: d.scopes, runs: d.runs });
  const f = LP.buildRequest(c.intent, { seen: V.ledger.heads.concat(['req-gone-0123456789abcdef01234567']), children: [], now: new Date().toISOString(), app: '3.0.0' });
  await app.fs.write('proposals/' + f.id + '.json', LP.text(f));
  app.click('refresh'); await app.tick(300);
  assert.strictEqual(kidPaths(app).length, 0, 'nothing started');
  assert.strictEqual(outcome(app, f.id), null, 'no outcome written; it stays held');
});
rule('Review round 6 (3): two runs compete for one attempt: the row offers the choice, not another start, and a start is refused', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  const twin = JSON.parse(app.fs.files[kidPaths(app)[0]].t); twin.id = 'twin0001';
  await app.fs.write('runs/validate-story/twin0001/run.json', JSON.stringify(twin));
  app.click('refresh'); await app.tick(250);
  assert.ok(/data-act="loop-choose"/.test(app.html()), 'the choice is offered');
  assert.ok(!/data-act="loop-start"[^>]*data-item="ABC-101"/.test(app.html()), 'no start button for a competing story');
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(200);
  assert.strictEqual(kidPaths(app).length, 2, 'no attempt 2 started');
});
rule('Review round 6 (4): a start waiting its turn to write is dropped when the run is paused meanwhile', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150);
  const fs0 = app.fs, write = fs0.write.bind(fs0), hold = gate();
  fs0.write = (p, t, o) => /^runs\/validate-story\//.test(p) ? hold.p.then(() => write(p, t, o)) : write(p, t, o);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(30);
  app.click('loop-start', 'each', { item: 'ABC-102' }); await app.tick(30);
  app.set('pick-input', 'Waiting'); app.click('pause', 'run'); await app.tick(40);
  hold.open(); await app.tick(400);
  const kids = kidPaths(app).map(p => JSON.parse(app.fs.files[p].t).parent.item.key);
  assert.ok(kids.indexOf('ABC-102') < 0, 'ABC-102 not started after the pause: ' + kids.join(','));
});

rule('Review round 7 (1): a single start waiting its turn is dropped at a folder switch: nothing lands in either folder', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150);
  const was = app.fs, write = was.write.bind(was), hold = gate();
  was.write = (p, t, o) => /^runs\/validate-story\//.test(p) ? hold.p.then(() => write(p, t, o)) : write(p, t, o);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(30);
  app.click('loop-start', 'each', { item: 'ABC-102' }); await app.tick(30);
  app.click('reset-examples'); await app.tick(60);
  const now = app.fs;
  Object.keys(was.files).forEach(p => { if (!(p in now.files)) now.files[p] = was.files[p]; });
  app.choose('person-avery'); await app.tick(); app.click('refresh'); await app.tick(150);
  hold.open(); await app.tick(400);
  const keys = Object.keys(was.files).filter(p => /^runs\/validate-story\/.*run\.json$/.test(p)).map(p => JSON.parse(was.files[p].t).parent.item.key);
  assert.ok(keys.indexOf('ABC-102') < 0, 'ABC-102 not written into the folder that was left: ' + keys.join(','));
});
rule('Review round 7 (2): a start waiting its turn is built from the run as it is when it writes: a changed detail is passed as changed', async () => {
  const kid = KID.replace('context: issue, disposition', 'context: issue, fix_version, disposition');
  const parent = PARENT.replace("title: Release 4.1", "title: Release 4.1\ncontext: fix_version").replace('  pass: issue=item:key', '  pass: issue=item:key, fix_version=^fix_version');
  const app = await setup({ maps: { kid, parent, details: { fix_version: '4.1' } } });
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150);
  const fs0 = app.fs, write = fs0.write.bind(fs0), hold = gate();
  fs0.write = (p, t, o) => /^runs\/validate-story\//.test(p) ? hold.p.then(() => write(p, t, o)) : write(p, t, o);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(30);
  app.click('loop-start', 'each', { item: 'ABC-102' }); await app.tick(30);
  app.click('edit', 'detail:fix_version'); app.set('edit-input', '4.2'); app.click('save-edit'); await app.tick(40);
  hold.open(); await app.tick(400);
  const k2 = kidPaths(app).map(p => JSON.parse(app.fs.files[p].t)).filter(k => k.parent.item.key === 'ABC-102')[0];
  assert.ok(k2, 'ABC-102 started');
  assert.strictEqual(k2.details.fix_version, '4.2', 'the value as it is now');
});
async function planConflict(app) {
  const PF = app.PF, LP = PF.loop, r = parentRun(app), d = await PF.repo.loadAll(app.fs, {}), V = LP.view(r, 'each', { records: d.scopes, runs: d.runs });
  const ids = [];
  for (const v of ['4.1', '4.1a']) {
    const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: r.id, step: 'each' }, changes: [{ op: 'add', item: { key: 'ABC-102' } }] }, 'pl-' + v.replace('.', ''), { name: 'release-helper', version: '1.0' });
    const f = LP.buildRequest(c.intent, { seen: V.ledger.heads, children: [{ item: { id: '', key: 'ABC-102' }, attempt: 1, inputs: { issue: 'ABC-102', note: v }, owner: '' }], now: new Date().toISOString(), app: '3.0.0' });
    await app.fs.write('proposals/' + f.id + '.json', LP.text(f)); ids.push(f.id);
  }
  app.click('refresh'); await app.tick(250);
  return ids;
}
rule('Review round 7 (4): two plans in conflict are listed on the story with a choice of either; choosing one settles them', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const ids = await planConflict(app);
  const sel = (app.html().match(/<select id="(loop-plan-[^"]*)"[^]*?<\/select>/) || []);
  assert.ok(sel[0] && ids.every(id => sel[0].indexOf(id) >= 0), 'both plans offered');
  app.set(sel[1], ids[1]); app.click('loop-plan', 'each', { item: 'ABC-102', pick: sel[1] }); await app.tick(200);
  const ch = scopes(app).map(p => JSON.parse(app.fs.files[p].t)).filter(f => (f.changes || []).some(c => c.op === 'plan'));
  assert.deepStrictEqual(ch.map(f => f.changes[0].record), [ids[1]]);
  assert.ok(!/<select id="loop-plan-/.test(app.html()), 'settled: no more choice');
});
async function twoWays(app, id) {
  const PF = app.PF, LP = PF.loop, r = parentRun(app), d = await PF.repo.loadAll(app.fs, {}), V = LP.view(r, 'each', { records: d.scopes, runs: d.runs });
  for (const [op, w] of [['applied', 'wa'], ['refused', 'wb']]) {
    const dd = LP.buildDecision({ proposal: id, loop: V.loop, op, items: [], seen: V.ledger.heads, reason: op, by: 'person-avery', writer: w, rev: op === 'applied' ? '0000000a' : '0000000b', now: new Date().toISOString(), app: '3.0.0' });
    await app.fs.write('proposals/' + dd.name, JSON.stringify(dd.file));
  }
  app.click('refresh'); await app.tick(250);
}
rule('Review round 7 (5): an outcome recorded both ways is resolved on the run screen by what happened, never by doing it again', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const hold = gate(), fs0 = app.fs, list = fs0.list.bind(fs0);
  const id = await ask(app, [{ op: 'start', item: { key: 'ABC-101' }, as: 'person-avery' }], 'rv-1');
  await app.tick(300);
  const outs = app.files('proposals/').filter(p => p.indexOf(id + '.status-') >= 0);
  outs.forEach(p => { delete app.fs.files[p]; });
  await twoWays(app, id);
  assert.ok(/data-act="loop-resolve"/.test(app.html()), 'resolve offered');
  const before = kidPaths(app).length;
  app.click('loop-resolve', 'each', { request: id, outcome: 'refused' }); await app.tick(200);
  assert.ok(/It was carried out/.test(txt(app)), 'refused is refused: a run it started is here');
  app.click('loop-resolve', 'each', { request: id, outcome: 'applied' }); await app.tick(250);
  assert.strictEqual(kidPaths(app).length, before, 'nothing started again');
  assert.ok(!/data-act="loop-resolve"/.test(app.html()), 'resolved');
  assert.ok(hold && list);
});
rule('Review round 7 (5): a resolve request from the CLI is carried out by the recorder\'s window by the same check', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const id = await ask(app, [{ op: 'approve', as: 'person-avery' }], 'rv-2');
  await app.tick(300);
  app.files('proposals/').filter(p => p.indexOf(id + '.status-') >= 0).forEach(p => { delete app.fs.files[p]; });
  await twoWays(app, id);
  const rs = await ask(app, [{ op: 'resolve', record: id, outcome: 'refused', as: 'person-avery' }], 'rv-3');
  await app.tick(300);
  assert.strictEqual((outcome(app, rs) || {}).op, 'applied', 'the resolve request is applied');
  assert.ok(!/data-act="loop-resolve"/.test(app.html()), 'no longer recorded both ways');
});

rule('Review round 7 (44): an exception approved and withdrawn at once is resolved on the story by either choice', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const PF = app.PF, LP = PF.loop, r = parentRun(app), L = { process: 'release-readiness', run: r.id, step: 'each' };
  const put = async (key, ch, seen) => { const c = LP.cleanIntent({ loop: L, changes: [Object.assign({ item: { key: 'ABC-101' } }, ch)] }, key, { name: 'release-helper', version: '1.0' }); const f = LP.buildRequest(c.intent, { seen, children: [], now: new Date().toISOString(), app: '3.0.0' }); await app.fs.write('proposals/' + f.id + '.json', LP.text(f)); return f.id; };
  const d = await PF.repo.loadAll(app.fs, {}), heads = LP.view(r, 'each', { records: d.scopes, runs: d.runs }).ledger.heads;
  const e1 = await put('ex1', { op: 'exception', reason: 'Docs only', approver: 'person-avery' }, heads);
  await put('ex2', { op: 'withdraw' }, heads.concat([e1])); await put('ex3', { op: 'exception', reason: 'Still docs', approver: 'person-avery' }, heads.concat([e1]));
  app.click('refresh'); await app.tick(250);
  assert.ok(/decided two ways at once/.test(txt(app)), 'the conflict is shown');
  assert.ok(/data-act="loop-withdraw"/.test(app.html()) && /data-act="loop-exception"/.test(app.html()), 'both ways out offered');
  app.click('loop-withdraw', 'each', { item: 'ABC-101' }); await app.tick(250);
  assert.ok(!/decided two ways at once/.test(txt(app)), 'resolved');
});

/* S2, one write-time guard: every loop write (a child run, a request's outcome, a resolution) is checked right before its
   bytes are written, after its last read: a folder switch or another person since the click writes nothing. */
const holdReads = (fs0, re) => { const read = fs0.read.bind(fs0), hold = gate(); let n = 0; fs0.read = (p, o) => re.test(p) ? (n++, hold.p.then(() => read(p, o))) : read(p, o); return { hold, seen: () => n }; };
async function switchAway(app) {
  const was = app.fs; app.click('reset-examples'); await app.tick(60);
  Object.keys(was.files).forEach(p => { if (!(p in app.fs.files)) app.fs.files[p] = was.files[p]; });
  app.choose('person-avery'); await app.tick(); app.click('refresh'); await app.tick(150);
  return was;
}
rule('S2 (child run): a start held at its last read writes nothing after a folder switch', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const fs0 = app.fs, before = Object.keys(fs0.files).filter(p => /^runs\/validate-story\//.test(p)).length, h = holdReads(fs0, /^runs\/validate-story\/.*run\.json$/);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(60);
  assert.ok(h.seen() > 0, 'the save reached its read');
  await switchAway(app); h.hold.open(); await app.tick(300);
  assert.strictEqual(Object.keys(fs0.files).filter(p => /^runs\/validate-story\//.test(p)).length, before, 'nothing written into the folder that was left');
});
rule('S2 (person): a start waiting its turn is dropped when someone else says who they are; the batch stops', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150);
  const fs0 = app.fs, write = fs0.write.bind(fs0), hold = gate();
  fs0.write = (p, t, o) => /^runs\/validate-story\//.test(p) ? hold.p.then(() => write(p, t, o)) : write(p, t, o);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(30);
  app.click('loop-start', 'each', { item: 'ABC-102' }); await app.tick(30);
  app.choose('person-casey'); await app.tick(40);
  hold.open(); await app.tick(400);
  const keys = kidPaths(app).map(p => JSON.parse(app.fs.files[p].t).parent.item.key);
  assert.ok(keys.indexOf('ABC-102') < 0, 'not started under someone else: ' + keys.join(','));
});
rule('S2 (outcome): a request\'s outcome held at its last read writes nothing after a folder switch', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const fs0 = app.fs, h = holdReads(fs0, /\.status-/);
  const id = await ask(app, [{ op: 'approve', as: 'person-avery' }], 'g-1');
  await app.tick(100);
  assert.ok(h.seen() > 0, 'the outcome reached its read');
  await switchAway(app); h.hold.open(); await app.tick(300);
  assert.ok(!Object.keys(fs0.files).some(p => p.indexOf(id + '.status-') >= 0), 'no outcome written into the folder that was left');
});
rule('S2 (resolution): a resolution held at its last read writes nothing after a folder switch', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const id = await ask(app, [{ op: 'approve', as: 'person-avery' }], 'g-2');
  await app.tick(300);
  app.files('proposals/').filter(p => p.indexOf(id + '.status-') >= 0).forEach(p => { delete app.fs.files[p]; });
  await twoWays(app, id);
  const fs0 = app.fs, n0 = Object.keys(fs0.files).filter(p => p.indexOf(id + '.status-') >= 0).length, h = holdReads(fs0, /\.status-/);
  app.click('loop-resolve', 'each', { request: id, outcome: 'refused' }); await app.tick(60);
  assert.ok(h.seen() > 0, 'the resolution reached its read');
  await switchAway(app); h.hold.open(); await app.tick(300);
  assert.strictEqual(Object.keys(fs0.files).filter(p => p.indexOf(id + '.status-') >= 0).length, n0, 'nothing written into the folder that was left');
});

/* S3, caches keyed by folder: what this window remembers about loops (the last readable view, starts in flight, requests
   being applied, previews) belongs to the folder and generation it was read in, and never shows or blocks in another. */
rule('S3 (last readable view): a folder opened next never shows the loop as another folder read it', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(200);
  const was = app.fs; app.click('reset-examples'); await app.tick(60);
  Object.keys(was.files).forEach(p => { if (!(p in app.fs.files)) app.fs.files[p] = was.files[p]; });
  scopes(app).forEach(p => { app.fs.files[p] = { t: '{"format": "flightdeck-plan/3", "id": ', m: Date.now() }; });
  app.choose('person-avery'); await app.tick(); app.click('refresh'); await app.tick(200);
  app.click('open-run', 'release-readiness/' + parentRun(app).id); await app.tick(200);
  assert.ok(/data-act="loop-add"|can.t be read/.test(app.html()), 'the run screen is open');
  assert.ok(!/Last readable view/.test(txt(app)), 'no view carried over from the folder that was left');
});
rule('S3 (starts in flight): a start held in one folder never blocks the same start in the folder opened next', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const was = app.fs, write = was.write.bind(was), hold = gate();
  was.write = (p, t, o) => /^runs\/validate-story\//.test(p) ? hold.p.then(() => write(p, t, o)) : write(p, t, o);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(40);
  await switchAway(app);
  /* The examples reset reuses the same folder object: what counts is that the held start writes no run.json of its own. */
  app.click('open-run', 'release-readiness/' + parentRun(app).id); await app.settle();
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(60);
  hold.open(); await app.tick(400);
  assert.strictEqual(kidPaths(app).length, 1, 'started in the folder opened next, once the held write is dropped');
  assert.strictEqual(Object.keys(was.files).filter(p => /^runs\/validate-story\/.*candidate-/.test(p)).length >= 1, true, 'the held start kept only its candidate, for recovery: one run in all');
});

rule('Review round 8 (5): a resolution whose own outcome couldn\'t be written is recorded applied when retried, from what it left', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const id = await ask(app, [{ op: 'approve', as: 'person-avery' }], 'rv-8');
  await app.tick(300);
  app.files('proposals/').filter(p => p.indexOf(id + '.status-') >= 0).forEach(p => { delete app.fs.files[p]; });
  await twoWays(app, id);
  const rs = app.PF.loop.idFor('release-helper', 'rv-9'), fs0 = app.fs, write = fs0.write.bind(fs0); let failed = 0;
  fs0.write = (p, t, o) => p.indexOf(rs + '.status-') >= 0 && !failed++ ? Promise.reject(new Error('disk full')) : write(p, t, o);
  await ask(app, [{ op: 'resolve', record: id, outcome: 'refused', as: 'person-avery' }], 'rv-9');
  await app.tick(300);
  assert.ok(failed > 0, 'the resolution\'s own outcome failed once');
  app.click('refresh'); await app.tick(400);
  assert.strictEqual((outcome(app, rs) || {}).op, 'applied', 'recorded applied, never refused');
});

rule('Review round 8 (7): a request still to resolve is always on the run screen, however many came after it; the rest page', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const id = await ask(app, [{ op: 'approve', as: 'person-avery' }], 'old-1');
  await app.tick(300);
  app.files('proposals/').filter(p => p.indexOf(id + '.status-') >= 0).forEach(p => { delete app.fs.files[p]; });
  await twoWays(app, id);
  for (let n = 0; n < 11; n++) { await ask(app, [{ op: 'approve', as: 'person-avery' }], 'later-' + n); await app.tick(200); }
  assert.ok(new RegExp('data-act="loop-resolve"[^>]*data-request="' + id + '"').test(app.html()), 'its Resolve buttons are still there');
  assert.ok(/data-act="loop-requests-more"/.test(app.html()), 'earlier applied and refused requests page');
  app.click('loop-requests-more', 'each'); await app.tick(60);
  assert.ok(!/data-act="loop-requests-more"/.test(app.html()), 'all shown');
});

/* Slice 3b: a loop over any list (items: item). */
const GPARENT = PARENT.replace('title: Release 4.1', 'title: Deploy everywhere').replace('Validate every release story', 'Deploy to every environment').replace('## Stories ·', '## Environments ·')
  .replace('  items: jira.issue', '  items: item\n  source: deploy-targets\n  noun: environment / environments');
rule('3b App: a list of environments kept by hand: its noun on the table, buttons and notices; keys as typed; a title and a safe link', async () => {
  const app = await setup({ maps: { parent: GPARENT } });
  let t = txt(app);
  const box = t.slice(t.indexOf('0 in scope'));
  assert.ok(/No environments in scope yet\./.test(box) && /Add environments/.test(box) && !/stor(y|ies)|Jira/i.test(box), box.slice(0, 900));
  assert.ok(/placeholder="staging, prod"/.test(app.html()), 'a generic example key');
  app.set('loop-add-each', 'qa'); app.set('loop-add-title-each', 'QA'); app.set('loop-add-link-each', 'javascript:alert(1)'); app.click('loop-add', 'each'); await app.tick(150);
  assert.strictEqual(scopes(app).length, 0, 'an unsafe link writes nothing');
  assert.ok(/(&quot;|")link(&quot;|") is an http or https address/.test(txt(app)), 'and says why');
  app.set('loop-add-link-each', 'https://qa.example.com/"><img src=x onerror=alert(1)>'); app.click('loop-add', 'each'); await app.tick(150);
  assert.strictEqual(scopes(app).length, 0, 'a link with markup in it writes nothing');
  app.set('loop-add-link-each', 'https://qa.example.com/'); app.click('loop-add', 'each'); await app.tick(150);
  app.set('loop-add-each', 'staging, Prod'); app.set('loop-add-title-each', ''); app.set('loop-add-link-each', ''); app.click('loop-add', 'each'); await app.tick(150);
  assert.strictEqual(scopes(app).length, 2);
  const req = JSON.parse(app.fs.files[scopes(app).map(p => [p, JSON.parse(app.fs.files[p].t)]).filter(x => x[1].changes.length === 1)[0][0]].t);
  assert.deepStrictEqual([req.kind, req.changes[0].item], ['item', { key: 'qa', title: 'QA', link: 'https://qa.example.com/' }]);
  t = txt(app);
  assert.ok(/<th>Environment<\/th>/.test(app.html()), 'the table heads its column with the noun');
  assert.ok(/<a href="https:\/\/qa\.example\.com\/" target="_blank" rel="noopener noreferrer">QA<\/a>/.test(app.html()), 'the link, escaped, opens apart');
  assert.ok(/Prod/.test(t) && /staging/.test(t) && !/PROD/.test(t), 'keys exactly as typed: ' + (t.match(/(Prod|PROD|prod|staging)[^·]{0,80}/g) || []).join(' | '));
  app.click('loop-start-all', 'each'); await app.tick(50);
  assert.ok(/Start 3 runs: qa, staging, Prod|Start 3 runs: [a-zA-Z, ]+/.test(txt(app)), 'Start all previews the environments');
  app.click('loop-start-all-confirm', 'each'); app.click('loop-start-all-confirm', 'each'); await app.tick(300);
  assert.strictEqual(kidPaths(app).length, 3, 'the batch starts each environment once');
  const kids = kidPaths(app).map(p => JSON.parse(app.fs.files[p].t)).map(k => [k.details.issue, k.parent.item.uid]).sort();
  assert.deepStrictEqual(kids, [['Prod', 'item:key:Prod'], ['qa', 'item:key:qa'], ['staging', 'item:key:staging']]);
  for (const p of kidPaths(app)) await clear(app, p);
  t = txt(app);
  assert.ok(/3 in scope · 3 cleared by validation/.test(t), t.slice(0, 400));
  app.click('loop-approve', 'each'); await app.tick(200);
  assert.strictEqual(parentRun(app).steps.each.s, 'done', 'approved');
});
rule('3b App: a tool feeds the list; its proposals and the mismatch name the feed; a choice and two decisions at once hold approval', async () => {
  const app = await setup({ maps: { parent: GPARENT } });
  const PF = app.PF, LP = PF.loop, r = parentRun(app), loop = { process: 'release-readiness', run: r.id, step: 'each' };
  const ob = (keys) => ({ source: { feed: 'deploy-targets' }, generation: 'g1', query: '', observedAt: new Date().toISOString(), items: keys.map(k => ({ key: k })), reported: keys.length, fetched: keys.length, complete: true, errors: [] });
  const sync = async (keys, key) => { const c = LP.cleanIntent({ loop, observation: ob(keys) }, key, { name: 'deploy-helper', version: '1.0' }, 'item'); assert.strictEqual(c.errors.length, 0, c.errors.join(' '));
    const d = await PF.repo.loadAll(app.fs, {}), V = LP.view(parentRun(app), 'each', { records: d.scopes, runs: d.runs });
    const f = LP.buildRequest(c.intent, { seen: V.ledger.heads, children: [], now: new Date().toISOString(), app: '3.0.0' }); await app.fs.write('proposals/' + f.id + '.json', LP.text(f)); app.click('refresh'); await app.tick(250); };
  await sync(['staging', 'prod'], 'k1');
  app.set('loop-add-each', 'qa'); app.click('loop-add', 'each'); await app.tick(150);
  await sync(['staging'], 'k2');
  const V = LP.view(parentRun(app), 'each', { records: (await PF.repo.loadAll(app.fs, {})).scopes, runs: [] });
  assert.strictEqual(JSON.stringify(V.ledger.items.map(x => x.key + ':' + x.state)), JSON.stringify(['prod:proposed', 'staging:in', 'qa:in']), 'qa, added by hand, is never proposed');
  app.click('loop-keep', 'each', { item: 'prod' }); await app.tick(200);
  app.set('loop-why-each', 'Not this release'); app.click('loop-exclude', 'each', { item: 'staging' }); await app.tick(200);
  assert.ok(/Removed here, but the feed deploy-targets still lists it/.test(txt(app)), txt(app).slice(txt(app).indexOf('staging'), txt(app).indexOf('staging') + 300));
  app.click('loop-start', 'each', { item: 'prod' }); await app.tick(150);
  app.click('loop-start', 'each', { item: 'qa' }); await app.tick(150);
  const ps = kidPaths(app); for (const p of ps) await clear(app, p);
  /* A second run for prod at the same attempt: two runs compete, and two choices at once hold approval. */
  const k0 = JSON.parse(app.fs.files[ps.find(p => JSON.parse(app.fs.files[p].t).details.issue === 'prod')].t), k1 = JSON.parse(JSON.stringify(k0)); k1.id = k0.id + 'b';
  await app.fs.write('runs/validate-story/' + k1.id + '/run.json', JSON.stringify(k1)); app.click('refresh'); await app.tick(200);
  const d = await PF.repo.loadAll(app.fs, {}), heads = LP.view(parentRun(app), 'each', { records: d.scopes, runs: d.runs }).ledger.heads;
  const choose = async (run, key) => { const c = LP.cleanIntent({ loop, changes: [{ op: 'choose', item: { key: 'prod' }, run, attempt: 1, candidates: [k0.id, k1.id] }] }, key, { name: 'deploy-helper', version: '1.0' }, 'item');
    assert.strictEqual(c.errors.length, 0, c.errors.join(' ')); const f = LP.buildRequest(c.intent, { seen: heads, children: [], now: new Date().toISOString(), app: '3.0.0' }); await app.fs.write('proposals/' + f.id + '.json', LP.text(f)); };
  await choose(k0.id, 'c1'); await choose(k1.id, 'c2'); app.click('refresh'); await app.tick(250);
  assert.ok(!/data-act="loop-approve"/.test(app.html()), 'two choices at once hold approval');
  assert.ok(/two people chose different runs at once/.test(txt(app)));
});
rule('3b App: a run whose loop takes a kind this copy doesn\'t know is read-only, naming the kind, and writes nothing; another run is unaffected', async () => {
  const app = await setup({ maps: { parent: GPARENT } });
  const p = app.files('runs/release-readiness/').find(x => /run\.json$/.test(x)), r = JSON.parse(app.fs.files[p].t);
  r.snapshot = r.snapshot.split('items: item').join('items: widget');
  await app.fs.write(p, JSON.stringify(r)); app.click('refresh'); await app.tick(250);
  const t = txt(app);
  assert.ok(/takes items of kind (&quot;|")widget(&quot;|"), which this copy of Flightdeck doesn't know/.test(t), t.slice(0, 800));
  assert.ok(!/data-act="loop-add"/.test(app.html()), 'no list to change');
  const before = JSON.stringify(app.fs.files);
  app.click('loop-add', 'each'); app.click('loop-start-all', 'each'); await app.tick(150);
  assert.strictEqual(JSON.stringify(app.fs.files), before, 'nothing written');
  app.click('start', 'release-readiness'); await app.settle();
  assert.ok(/data-act="loop-add"/.test(app.html()) || /start-form/.test(app.html()), 'a new run of the published version starts as usual');
});

rule('Round 9 (1): two owners assigned at once after the approval send it back at once in the recorder\'s window, with the conflict as the reason', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  await clear(app, kidPaths(app)[0]);
  app.click('loop-approve', 'each'); await app.tick(150);
  assert.strictEqual(parentRun(app).steps.each.s, 'done', 'set-up: approved');
  const PF = app.PF, LP = PF.loop, r = parentRun(app), loop = { process: 'release-readiness', run: r.id, step: 'each' };
  const d = await PF.repo.loadAll(app.fs, {}), heads = LP.view(r, 'each', { records: d.scopes, runs: d.runs }).ledger.heads;
  for (const [owner, key] of [['person-avery', 'o1'], ['person-morgan', 'o2']]) {
    const c = LP.cleanIntent({ loop, changes: [{ op: 'owner', item: { key: 'ABC-101' }, owner }] }, key, { name: 'release-helper', version: '1.0' });
    const f = LP.buildRequest(c.intent, { seen: heads, children: [], now: new Date().toISOString(), app: '3.0.0' });
    await app.fs.write('proposals/' + f.id + '.json', LP.text(f));
  }
  app.click('refresh'); await app.tick(300);
  const r2 = parentRun(app);
  assert.strictEqual(r2.steps.each.s, 'recheck', 'sent back for review');
  assert.ok(/two people assigned it at once/.test(r2.steps.each.values.changes), r2.steps.each.values.changes);
});

rule('Round 9 (4): what a request already did is recognized before who may ask: a start whose asker lost the item, and a resolution that landed, are applied', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150);
  app.set('loop-who-each', 'person-casey'); app.click('loop-assign', 'each', { item: 'ABC-101' }); await app.tick(150);
  const fs = app.fs, write = fs.write.bind(fs);
  fs.write = (p, t, o) => /\.status-/.test(p) && /"applied"|"refused"/.test(String(t)) ? Promise.reject(new Error('EIO')) : write(p, t, o);
  const st = await ask(app, [{ op: 'start', item: { key: 'ABC-101' }, as: 'person-casey' }], 'r9-st');
  assert.strictEqual(kidPaths(app).length, 1, 'set-up: Casey, the owner, started it; its outcome not written');
  fs.write = write;
  app.click('loop-unassign', 'each', { item: 'ABC-101' }); await app.tick(250);
  assert.deepStrictEqual([outcome(app, st) && outcome(app, st).op, kidPaths(app).length], ['applied', 1], outcome(app, st) ? outcome(app, st).reason : 'no outcome');
  /* A resolution that already landed (it names its resolve request) is applied, though its asker may not ask. */
  const PF = app.PF, LP = PF.loop, x = await ask(app, [{ op: 'start', item: { key: 'ABC-102' }, as: 'person-avery' }], 'r9-x');
  for (const p of app.files('proposals/').filter(p => p.indexOf(x + '.status-') >= 0)) delete app.fs.files[p];
  await twoWays(app, x);
  const rid = LP.idFor('release-helper', 'r9-res'), d = await PF.repo.loadAll(app.fs, {}), V = LP.view(parentRun(app), 'each', { records: d.scopes, runs: d.runs });
  const dd = LP.buildDecision({ proposal: x, loop: V.loop, op: 'applied', items: [], seen: V.ledger.heads, reason: 'resolved', by: 'person-avery', resolver: rid, writer: 'wr', rev: '0000000c', now: new Date().toISOString(), app: '3.0.0' });
  await app.fs.write('proposals/' + dd.name, JSON.stringify(dd.file));
  const res = await ask(app, [{ op: 'resolve', record: x, outcome: 'applied', as: 'person-casey' }], 'r9-res');
  assert.strictEqual(res, rid);
  const o = app.files('proposals/').filter(p => p.indexOf(rid + '.status-') >= 0).map(p => JSON.parse(app.fs.files[p].t));
  assert.deepStrictEqual(o.map(f => f.op), ['applied'], JSON.stringify(o.map(f => f.reason)));
});

rule('Round 9 (2, 3): every save of a loop\'s parent or child carries the guard captured at the click (still), found in the source', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8'), bad = [];
  const re = /\b(mutateRun|mutate|repo\.saveRun)\(/g; let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, d = 1; while (i < src.length && d) { const ch = src[i++]; if (ch === '(') d++; else if (ch === ')') d--; }
    const call = src.slice(m.index, i), line = src.slice(0, m.index).split('\n').length;
    if (/function (mutateRun|mutate)\(/.test(src.slice(Math.max(0, m.index - 9), m.index + 12))) continue;
    if (/unsettleLoop|_loop:|loopView\(|loopChild|PF\.loop\./.test(call) && !/still/i.test(call)) bad.push('app.js:' + line);
  }
  assert.deepStrictEqual(bad, [], 'loop saves without the guard');
});
rule('Round 9 (2): a direct approval held at its last read writes nothing once someone else says who they are', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  await clear(app, kidPaths(app)[0]);
  const fs0 = app.fs, p = app.files('runs/release-readiness/').find(x => /run\.json$/.test(x)), before = fs0.files[p].t, h = holdReads(fs0, /^runs\/release-readiness\/.*run\.json$/);
  app.click('loop-approve', 'each'); await app.tick(60);
  assert.ok(h.seen() > 0, 'the save reached its read');
  app.choose('person-casey'); await app.tick(); h.hold.open(); await app.tick(300);
  assert.strictEqual(fs0.files[p].t, before, 'the parent run is unchanged');
});
rule('Round 9 (2): an approve request held at the parent\'s last read writes nothing into the folder that was left', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  await clear(app, kidPaths(app)[0]);
  const PF = app.PF, LP = PF.loop, r = parentRun(app), d = await PF.repo.loadAll(app.fs, {}), V = LP.view(r, 'each', { records: d.scopes, runs: d.runs });
  const c = LP.cleanIntent({ loop: V.loop, changes: [{ op: 'approve', as: 'person-avery' }] }, 'r9-ap', { name: 'release-helper', version: '1.0' });
  const f = LP.buildRequest(c.intent, { seen: V.ledger.heads, children: [], now: new Date().toISOString(), app: '3.0.0' });
  const fs0 = app.fs, p = app.files('runs/release-readiness/').find(x => /run\.json$/.test(x)), before = fs0.files[p].t;
  /* Count the parent's reads in a plain refresh, then let that many through: the next one is the approval's own last read. */
  const read = fs0.read.bind(fs0); let n = 0; fs0.read = (q, o) => { if (/^runs\/release-readiness\/.*run\.json$/.test(q)) n++; return read(q, o); };
  app.click('refresh'); await app.tick(200); const plain = n; n = 0;
  await fs0.write('proposals/' + f.id + '.json', LP.text(f));
  const hold = gate(); let held = 0;
  fs0.read = (q, o) => { if (/^runs\/release-readiness\/.*run\.json$/.test(q) && ++n > plain) { held++; return hold.p.then(() => read(q, o)); } return read(q, o); };
  app.click('refresh'); await app.tick(200);
  assert.ok(held > 0, 'the approval reached its read');
  const h = { hold };
  await switchAway(app); h.hold.open(); await app.tick(300);
  assert.strictEqual(fs0.files[p].t, before, 'the old folder\'s parent is unchanged');
});
rule('Round 9 (3): a child whose candidate was written before a folder switch writes no run.json after it; the candidate stays for recovery', async () => {
  const app = await setup();
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  const fs0 = app.fs, write = fs0.write.bind(fs0), hold = gate(); let cand = 0;
  fs0.write = (p, t, o) => /^runs\/validate-story\/.*candidate-/.test(p) ? write(p, t, o).then((x) => { cand++; return hold.p.then(() => x); }) : write(p, t, o);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(120);
  assert.strictEqual(cand, 1, 'the candidate is written');
  await switchAway(app); hold.open(); await app.tick(300);
  assert.deepStrictEqual(Object.keys(fs0.files).filter(p => /^runs\/validate-story\/.*\/run\.json$/.test(p)), [], 'no run.json after the switch');
  assert.strictEqual(Object.keys(fs0.files).filter(p => /^runs\/validate-story\/.*candidate-/.test(p)).length, 1, 'the candidate is kept');
});

/* Round 10: one guard builder (loopGuard) for every write of a loop's parent or child, checked inside the save. */
const PARENT_RE = /^runs\/release-readiness\/[^/]*\/run\.json$/;
const parentPath = (app) => app.files('runs/release-readiness/').find(p => /run\.json$/.test(p));
async function cleared(app) {
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  await clear(app, kidPaths(app)[0]);
}
rule('Round 10 (2): a direct approval held at its last read writes nothing once the run is paused; the pause lands alone', async () => {
  const app = await setup(); await cleared(app);
  const fs0 = app.fs, p = parentPath(app), h = holdReads(fs0, PARENT_RE);
  app.click('loop-approve', 'each'); await app.tick(60);
  assert.ok(h.seen() > 0, 'the approval reached its read');
  app.set('pick-input', 'Waiting'); app.click('pause', 'run'); await app.tick(40);
  h.hold.open(); await app.tick(400);
  const r = JSON.parse(fs0.files[p].t);
  assert.ok(r.paused, 'the pause is saved');
  assert.ok(!(r.steps.each && r.steps.each.s === 'done'), 'the approval is not saved while paused: ' + JSON.stringify(r.steps.each));
});
rule('Round 10 (2): a send-back held at its last read writes nothing once the run is paused', async () => {
  const app = await setup(); await cleared(app);
  app.click('loop-approve', 'each'); await app.tick(250);
  const fs0 = app.fs, p = parentPath(app);
  assert.strictEqual(JSON.parse(fs0.files[p].t).steps.each.s, 'done', 'set-up: approved');
  const h = holdReads(fs0, PARENT_RE);
  app.set('loop-why-each', 'Check it again'); app.click('loop-unsettle', 'each'); await app.tick(60);
  assert.ok(h.seen() > 0, 'the send-back reached its read');
  app.set('pick-input', 'Waiting'); app.click('pause', 'run'); await app.tick(40);
  h.hold.open(); await app.tick(400);
  const r = JSON.parse(fs0.files[p].t);
  assert.ok(r.paused, 'the pause is saved');
  assert.strictEqual(r.steps.each.s, 'done', 'not sent back while paused');
});
rule('Round 10 (1): any change to a loop\'s parent held at its last read writes nothing into the folder that was left', async () => {
  const app = await setup(); await cleared(app);
  const fs0 = app.fs, p = parentPath(app), before = fs0.files[p].t, h = holdReads(fs0, PARENT_RE);
  app.set('pick-input', 'Waiting'); app.click('pause', 'run'); await app.tick(60);
  assert.ok(h.seen() > 0, 'the save reached its read');
  await switchAway(app); h.hold.open(); await app.tick(300);
  assert.strictEqual(fs0.files[p].t, before, 'the old folder\'s parent is unchanged');
});
rule('Round 10 (1): keeping a conflict copy of a loop\'s parent writes nothing after a folder switch, its backup included', async () => {
  const app = await setup(); await cleared(app);
  const fs0 = app.fs, p = parentPath(app), copy = JSON.parse(fs0.files[p].t); copy.title = 'From the other computer';
  await fs0.write(p.replace('run.json', 'run-OTHER.json'), JSON.stringify(copy));
  app.click('refresh'); await app.tick(200);
  assert.ok(/data-act="use-copy"/.test(app.html()), 'set-up: the copy is offered');
  const before = fs0.files[p].t, h = holdReads(fs0, PARENT_RE);
  app.click('use-copy', 'run-OTHER.json'); await app.tick(80);
  await switchAway(app); h.hold.open(); await app.tick(300);
  assert.strictEqual(fs0.files[p].t, before, 'the old folder\'s parent is unchanged');
  const app2 = await setup(); await cleared(app2);
  const f2 = app2.fs, p2 = parentPath(app2), c2 = JSON.parse(f2.files[p2].t); c2.title = 'From the other computer';
  await f2.write(p2.replace('run.json', 'run-OTHER.json'), JSON.stringify(c2));
  app2.click('refresh'); await app2.tick(200);
  const hc = holdReads(f2, /run-OTHER\.json$/);
  app2.click('use-copy', 'run-OTHER.json'); await app2.tick(60);
  app2.choose('person-casey'); await app2.tick(); hc.hold.open(); await app2.tick(300);
  assert.deepStrictEqual(app2.files('runs/release-readiness/').filter(x => /replaced-/.test(x)), [], 'no backup written for someone else');
});
rule('Round 10 (1): starting a run of a checklist with a loop, held at its last read, writes nothing after a folder switch', async () => {
  const app = await setup();
  const fs0 = app.fs, n0 = app.files('runs/release-readiness/').filter(x => /run\.json$/.test(x)).length, h = holdReads(fs0, PARENT_RE);
  app.click('start', 'release-readiness'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(80);
  assert.ok(h.seen() > 0, 'the start reached its read');
  await switchAway(app); h.hold.open(); await app.tick(300);
  assert.strictEqual(Object.keys(fs0.files).filter(x => PARENT_RE.test(x)).length, n0, 'no second run in the folder that was left');
});
rule('Round 10 (3): Start all stops at the first start its guard drops; the rest aren\'t started, and the receipt says so', async () => {
  const kid = KID.replace('context: issue, disposition', 'context: issue, fix_version, disposition');
  const parent = PARENT.replace("title: Release 4.1", "title: Release 4.1\ncontext: fix_version").replace('  pass: issue=item:key', '  pass: issue=item:key, fix_version=^fix_version');
  const app = await setup({ maps: { kid, parent, details: { fix_version: '4.1' } } });
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150);
  const fs0 = app.fs, read = fs0.read.bind(fs0), hold = gate(); let n = 0;
  fs0.read = (q, o) => /^runs\/validate-story\/.*run\.json$/.test(q) && ++n === 1 ? hold.p.then(() => read(q, o)) : read(q, o);
  app.click('loop-start-all', 'each'); await app.tick(50);
  app.click('loop-start-all-confirm', 'each'); await app.tick(60);
  assert.strictEqual(n, 1, 'the first start reached its read');
  app.click('edit', 'detail:fix_version'); app.set('edit-input', '4.2'); app.click('save-edit'); await app.tick(60);
  hold.open(); await app.tick(500);
  const keys = kidPaths(app).map(x => JSON.parse(app.fs.files[x].t).parent.item.key);
  assert.deepStrictEqual(keys, [], 'nothing started after the guard dropped the first: ' + keys.join(','));
  assert.ok(/Stopped/.test(txt(app)), 'the receipt says the batch stopped');
});
rule('Round 11 (1): a send-back dropped after a folder switch puts nothing back in the other folder\'s run of the same key', async () => {
  const app = await setup(); await cleared(app);
  app.click('loop-approve', 'each'); await app.tick(250);
  /* Its gate passed, as a person would pass it. */
  const R = app.PF.run, p0 = parentPath(app), rr = R.sanitize(JSON.parse(app.fs.files[p0].t)), mm = R.mapOf(rr);
  R.pass(rr, mm, 0, 'person-avery', new Date(Date.now() + 1000).toISOString());
  const plain = {}; Object.keys(rr).forEach(k => { if (k[0] !== '_') plain[k] = rr[k]; }); plain.rev = (plain.rev || 0) + 1;
  await app.fs.write(p0, JSON.stringify(plain)); app.click('refresh'); await app.tick(200);
  const gid = Object.keys(parentRun(app).gates)[0];
  assert.strictEqual(parentRun(app).gates[gid].s, 'passed', 'set-up: approved and its gate passed');
  const fs0 = app.fs, h = holdReads(fs0, PARENT_RE);
  app.set('loop-why-each', 'Check it again'); app.click('loop-unsettle', 'each'); await app.tick(60);
  assert.ok(h.seen() > 0, 'the send-back reached its read');
  await switchAway(app);
  app.click('open-run', 'release-readiness/' + parentRun(app).id); await app.tick(80);
  app.set('loop-why-each', 'And here too'); app.click('loop-unsettle', 'each'); await app.tick(60);
  h.hold.open(); await app.tick(400);
  assert.strictEqual(parentRun(app).gates[gid].s, 'review', 'set-up: sent back in the copied folder, its gate under review');
  app.set('pick-input', 'Waiting'); app.click('pause', 'run'); await app.tick(250);
  const r = parentRun(app);
  assert.ok(r.paused, 'the copied folder\'s run saved again');
  assert.deepStrictEqual([r.steps.each.s, r.gates[gid].s], ['recheck', 'review'], 'nothing from the old folder was put back into it');
});
rule('Round 10 (1, 2): every save, backup or archive of a run.json in the app goes through the loop guard: the save funnel, the recovery backup, a start\'s first save', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8'), bad = [];
  const body = (name) => { const i = src.indexOf('function ' + name + '('); let j = src.indexOf('{', i), d = 1; j++; while (d) { const ch = src[j++]; if (ch === '{') d++; else if (ch === '}') d--; } return src.slice(i, j); };
  assert.ok(/loopy\(/.test(body('save')) && /loopGuard\(/.test(body('save')), 'the save funnel guards a loop\'s parent or child');
  const re = /\brepo\.(saveRun|keepDisplaced|archiveOverflow|archiveRun)\(/g; let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, d = 1; while (i < src.length && d) { const ch = src[i++]; if (ch === '(') d++; else if (ch === ')') d--; }
    const call = src.slice(m.index, i), line = src.slice(0, m.index).split('\n').length, around = src.slice(Math.max(0, m.index - 400), m.index);
    if (m[1] === 'keepDisplaced') { if (!/keepDisplaced: function/.test(src) || !/state\.recoverCx/.test(src)) bad.push('app.js:' + line + ' backup without the guard'); continue; }
    if (/function save\(r, opts\)/.test(around) || /still/.test(call)) continue;
    if (/saveOpts\)$/.test(call) && /if \(loopy\(child\)\)[^\n]*saveOpts\.still/.test(src)) continue;
    bad.push('app.js:' + line + ': ' + call.slice(0, 80));
  }
  assert.deepStrictEqual(bad, [], 'run.json writes without the loop guard');
});
run();
