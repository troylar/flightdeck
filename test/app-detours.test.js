// Checklist-linked to-dos (4.0, docs/design.md 45.4) in the app, slice 5. The run screen is a faithful view plus easy actions:
// a to-do linked to a checklist says what settles it and offers Run this checklist, which makes (once) the to-do's own plan
// and opens it in the standalone start; the run it starts leads back to the to-do. A completed run whose result the to-do
// accepts offers Accept, which asks for the to-do done on that run, checked again against the folder right before it is
// written. Linking a to-do and anything more complex goes through flightdeck todo.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');
const { race } = require('./race-harness');

const PARENT = ['---', 'process: release-notes', 'title: Release notes', 'owner: person-morgan', '---', '',
  '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', ''].join('\n');
const SMOKE = ['---', 'process: smoke-test', 'title: Smoke test', 'owner: person-avery', 'context: verdict:choice(pass|fail)', 'result: verdict', '---', '',
  '## Test · DO-CONFIRM {#test}', '- [!] {confirm} Run the smoke suite {#suite}', '- [!] {decide} Record the result {#call}', '  options: pass, fail', '  sets: verdict=decision', ''].join('\n');
const txt = (h) => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const AT = () => new Date().toISOString();

function publish(app, md, rand, existing) {
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t);
  const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-morgan', changes: 'First', existing: existing || [], now: AT(), rand, app: '4.0.0' });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const proc = PF.map.parse(md).meta.process;
  Object.keys(b.files).forEach(k => { app.fs.files['publications/' + proc + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  const exact = PF.publish.exactOf({ 'map.md': new Uint8Array(Buffer.from(b.files['map.md'], 'utf8')), 'types.json': new Uint8Array(Buffer.from(b.files['types.json'], 'utf8')) });
  const v = PF.publish.verify(b.folder, b.files, exact); v.folder = b.folder;
  return v;
}
const parentPath = (app) => app.files('runs/release-notes/').find(p => /run\.json$/.test(p));
const parentRun = (app) => JSON.parse(app.fs.files[parentPath(app)].t);
const kidPaths = (app) => app.files('runs/smoke-test/').filter(p => /run\.json$/.test(p)).sort();
const plans = (app) => app.files('proposals/plan-ev-').filter(p => /^proposals\/plan-ev-[0-9a-f]{24}\.json$/.test(p));
const evRecs = (app) => app.files('proposals/req-evidence-').filter(p => !/\.status-/.test(p));
const refresh = async (app, ms) => { app.click('refresh'); await app.tick(ms || 250); };
const toParent = async (app) => { const r = parentRun(app); app.click('open-run', r.process + '/' + r.id); await app.tick(120); };

/* A release-notes run, started in the app by Avery; a smoke-test checklist; a to-do on the run linked to it, landed. */
async function setup(accepts) {
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(80); app.choose('person-avery'); await app.tick();
  publish(app, PARENT, 'rn000001'); const kp = publish(app, SMOKE, 'sm000001');
  await refresh(app, 80);
  app.click('start', 'release-notes'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  assert.ok(parentPath(app), 'set-up: a run was started');
  const PF = app.PF, r = PF.run.sanitize(parentRun(app)), people = JSON.parse(app.fs.files['people.json'].t);
  const Q = PF.detours.pinFor({ latest: kp, all: [kp], clashes: [], broken: [] }, 'smoke-test', kp.folder, accepts);
  assert.ok(!Q.why, Q.why);
  const d = await PF.repo.loadAll(app.fs, {});
  const P = PF.todos.prepare(r, { body: { op: 'add', text: 'Smoke test the build', target: { phase: 'draft' }, checklist: Q.checklist }, by: { person: 'person-avery' }, key: 'ui-setup', records: d.todos, unread: d.todosUnread, people, at: AT(), app: '4.0.0' });
  assert.ok(!P.why, P.why);
  app.fs.files['proposals/' + P.name] = { t: PF.todos.text(P.file), m: Date.now() };
  await refresh(app, 400); await toParent(app); await refresh(app, 300);
  const V = PF.todos.view(PF.run.sanitize(parentRun(app)), { records: (await PF.repo.loadAll(app.fs, {})).todos, people });
  const x = V.todos.filter(t => t.text === 'Smoke test the build')[0];
  assert.ok(x && x.state === 'open' && x.checklist, 'set-up: the linked to-do landed');
  return { app, kp, todo: x.id };
}
/* Run this checklist, then start the plan it opened; returns the new run's key. */
async function runIt(app, todo) {
  const before = kidPaths(app);
  app.click('td-detour', todo); await app.tick(250);
  app.chooseApprovers().submitForm('start-form'); await app.tick(200);
  const p = kidPaths(app).filter(x => before.indexOf(x) < 0)[0];
  assert.ok(p, 'a run of smoke-test was started');
  return p.split('/').slice(1, 3).join('/');
}
function finish(app, key, verdict, at) {
  const PF = app.PF, p = 'runs/' + key + '/run.json', c = JSON.parse(app.fs.files[p].t), m = PF.run.mapOf(c), t = at || AT();
  PF.run.done(c, m, 'suite', 'person-avery', t); PF.run.done(c, m, 'call', 'person-avery', t, { decision: verdict }); PF.run.pass(c, m, 0, 'person-avery', t); PF.run.end(c, m, 'Completed', 'person-avery', 'Avery', t);
  app.fs.files[p] = { t: JSON.stringify(c, null, 2), m: Date.now() };
}

rule('A linked to-do says what settles it; Run this checklist makes its one plan and opens it in the standalone start; asked twice it is the same plan', async () => {
  const { app, todo } = await setup(['pass']);
  const t = txt(app.html());
  assert.ok(/Settled by a run of Smoke test v1 that returns pass/.test(t), t.slice(0, 2000));
  assert.ok(new RegExp('data-act="td-detour"[^>]*data-id="' + todo + '"|data-id="' + todo + '"[^>]*data-act="td-detour"').test(app.html()), 'the button');
  app.click('td-detour', todo); await app.tick(250);
  assert.strictEqual(plans(app).length, 1, 'one plan');
  const plan = JSON.parse(app.fs.files[plans(app)[0]].t), r = parentRun(app);
  assert.deepStrictEqual([plan.format, plan.process, plan.from], [app.PF.plans.FORMAT2, 'smoke-test', r.process + '/' + r.id]);
  assert.ok(/id="start-form"/.test(app.html()), 'the standalone start, on its plan');
  await toParent(app);
  app.click('td-detour', todo); await app.tick(250);
  assert.strictEqual(plans(app).length, 1, 'asked again, the same plan: nothing more written');
  assert.ok(/id="start-form"/.test(app.html()));
  assert.strictEqual(app.fs.files[parentPath(app)].t.indexOf('plan-ev-'), -1, 'the run itself doesn\'t change');
});

rule('The started run leads back to the to-do; Accept on its completed result asks for the to-do done on that run, and it is checked off', async () => {
  const { app, todo } = await setup(['pass']);
  const key = await runIt(app, todo);
  const st = app.files('proposals/plan-ev-').filter(p => /\.status-/.test(p)).map(p => JSON.parse(app.fs.files[p].t));
  assert.deepStrictEqual([st.length, st[0].status, st[0].run], [1, 'accepted', key.split('/')[1]], 'the started decision names the run');
  app.click('open-run', key); await app.tick(150);
  assert.ok(/Started for the to-do "Smoke test the build"/.test(txt(app.html())), txt(app.html()).slice(0, 1500));
  const r = parentRun(app);
  app.click('td-back', r.process + '/' + r.id); await app.tick(150);
  assert.ok(/id="td-/.test(app.html()) && /Smoke test the build/.test(app.html()), 'on the run with the to-do');
  assert.strictEqual(app.activeId(), 'td-' + todo, 'focused on the to-do it came from');
  assert.ok(!/data-act="td-evidence"/.test(app.html()), 'nothing to accept before it completes');
  assert.ok(/hasn't completed yet/.test(txt(app.html())));
  finish(app, key, 'pass'); await refresh(app, 300);
  assert.ok(/data-act="td-evidence"/.test(app.html()), 'Accept, once it completed with a result it accepts');
  app.click('td-evidence', todo, { run: key.split('/')[1] }); await app.tick(250);
  assert.strictEqual(evRecs(app).length, 1, 'one request on that run: ' + (/<div class="notice[^>]*><span>(.*?)<\/span>/.exec(app.html()) || [])[1]);
  const rec = JSON.parse(app.fs.files[evRecs(app)[0]].t);
  assert.deepStrictEqual([rec.op, rec.todo, rec.evidence.run, rec.evidence.result], ['done', todo, { process: 'smoke-test', id: key.split('/')[1] }, 'pass']);
  await refresh(app, 400);
  assert.ok(/Checked off on the run smoke-test\/[a-z0-9-]+ \(pass\)/.test(txt(app.html())), txt(app.html()).slice(0, 2500));
  app.click('td-evidence', todo, { run: key.split('/')[1] }); await app.tick(200);
  assert.strictEqual(evRecs(app).length, 1, 'nothing more once it is done');
});

rule('A result it doesn\'t accept offers nothing to accept and says why; competing starts each offer their own Accept', async () => {
  const { app, todo } = await setup(['pass']);
  const k1 = await runIt(app, todo);
  finish(app, k1, 'fail'); await toParent(app); await refresh(app, 300);
  assert.ok(!/data-act="td-evidence"/.test(app.html()));
  assert.ok(/returned fail; this to-do accepts pass/.test(txt(app.html())), txt(app.html()).slice(0, 2500));
  const PF = app.PF, plan = JSON.parse(app.fs.files[plans(app)[0]].t);
  const g = PF.repo.groupPlans([Object.assign({}, plan, { _file: plan.id + '.json' })], [], [])[0];
  const c = PF.run.create((await PF.repo.loadAll(app.fs, {})).processes.filter(p => p.process === 'smoke-test')[0].index.latest, { id: 'k2', by: 'person-avery', session: 'w9', now: AT(), app: '4.0.0' });
  app.fs.files['runs/smoke-test/k2/run.json'] = { t: JSON.stringify(c, null, 2), m: Date.now() };
  app.fs.files['proposals/' + plan.id + '.status-w9-d.json'] = { t: JSON.stringify(PF.plans.decision(g, 'accepted', 'k2', 'person-avery', AT(), null, '4.0.0')), m: Date.now() };
  finish(app, 'smoke-test/k2', 'pass'); await refresh(app, 300);
  const acc = (app.html().match(/data-act="td-evidence"/g) || []).length;
  assert.strictEqual(acc, 1, 'only the run whose result it accepts');
  assert.ok(/data-run="k2"/.test(app.html()));
});

rule('A run that changed since the screen was drawn is never accepted: checked against the folder right before the write', async () => {
  const { app, todo } = await setup();
  const key = await runIt(app, todo);
  finish(app, key, 'pass'); await toParent(app); await refresh(app, 300);
  assert.ok(/data-act="td-evidence"/.test(app.html()));
  const p = 'runs/' + key + '/run.json', c = JSON.parse(app.fs.files[p].t);
  c.ended.at = '2030-01-01T00:00:00.000Z';
  app.fs.files[p] = { t: JSON.stringify(c, null, 2), m: Date.now() };
  app.click('td-evidence', todo, { run: key.split('/')[1] }); await app.tick(250);
  assert.strictEqual(evRecs(app).length, 0, 'nothing written');
  assert.ok(/changed since this screen|Nothing was written/.test(txt(app.html())), txt(app.html()).slice(0, 2000));
});

rule('Evidence the write guard would refuse is never offered: a conflict copy beside the run it rests on shows the hold, not Accept', async () => {
  const { app, todo } = await setup();
  const key = await runIt(app, todo);
  finish(app, key, 'pass'); await toParent(app); await refresh(app, 300);
  assert.ok(/data-act="td-evidence"/.test(app.html()), 'set-up: Accept offered');
  const c = JSON.parse(app.fs.files['runs/' + key + '/run.json'].t); c.title = 'Another copy';
  app.fs.files['runs/' + key + '/run.conflict-w99-1.json'] = { t: JSON.stringify(c, null, 2), m: Date.now() };
  await refresh(app, 400); await toParent(app); await refresh(app, 300);
  assert.ok(!/data-act="td-evidence"/.test(app.html()), 'no Accept while the run it rests on has a conflict copy');
  assert.ok(/can.t be read now|can only be read here|Conflict/i.test(txt(app.html())), 'the hold is said: ' + txt(app.html()).slice(0, 1500));
});

rule('Evidence held by a torn plan beside a readable (1) copy, a version that can\'t be read, or a version that is gone is never offered', async () => {
  for (const how of ['torn plan with a copy', 'version unreadable', 'version gone']) {
    const { app, todo, kp } = await setup();
    const key = await runIt(app, todo);
    finish(app, key, 'pass'); await toParent(app); await refresh(app, 300);
    assert.ok(/data-act="td-evidence"/.test(app.html()), how + ': set-up: Accept offered');
    const pf = plans(app)[0];
    if (how === 'torn plan with a copy') { app.fs.files[pf.replace(/\.json$/, ' (1).json')] = { t: app.fs.files[pf].t, m: Date.now() }; app.fs.files[pf] = { t: '{ torn', m: Date.now() + 1000 }; }
    /* The checklist's versions can't be listed now (EACCES): what was read before is no longer known to hold. */
    if (how === 'version unreadable') { const fs = app.fs, list = fs.list.bind(fs); fs.list = (p, o) => /^publications\/smoke-test\/?$/.test(p) ? Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES', name: 'NotAllowedError' })) : list(p, o); }
    if (how === 'version gone') app.files('publications/smoke-test/' + kp.folder + '/').forEach(f => { delete app.fs.files[f]; });
    await refresh(app, 400); await toParent(app); await refresh(app, 300);
    assert.ok(!/data-act="td-evidence"/.test(app.html()), how + ': no Accept');
    app.click('td-evidence', todo, { run: key.split('/')[1] }); await app.tick(400);
    assert.strictEqual(evRecs(app).length, 0, how + ': nothing written');
  }
});

rule('MC: a version whose step types changed though it verifies, a plan link beside a readable (1) copy, and proposals that can\'t be read after a refresh offer no Accept', async () => {
  for (const how of ['types drift', 'plan link', 'proposals unreadable']) {
    const { app, todo, kp } = await setup();
    const key = await runIt(app, todo);
    finish(app, key, 'pass'); await toParent(app); await refresh(app, 300);
    assert.ok(/data-act="td-evidence"/.test(app.html()), how + ': set-up: Accept offered');
    const PF = app.PF, dir = 'publications/smoke-test/' + kp.folder + '/', pf = plans(app)[0], fs = app.fs, list = fs.list.bind(fs);
    if (how === 'types drift') {
      /* The version's step types change and its fingerprints are updated, so it still verifies; it is read again (gone, then back). */
      const files = {}; app.files(dir).forEach(f => { files[f] = app.fs.files[f]; delete app.fs.files[f]; });
      await refresh(app, 300);
      const t2 = files[dir + 'types.json'].t + '\n', info = JSON.parse(files[dir + 'publication.json'].t);
      info.typesHash = PF.util.hash(t2);
      if (info.payload) info.payload.types = PF.publish.exactOf({ 'map.md': new Uint8Array(Buffer.from(files[dir + 'map.md'].t, 'utf8')), 'types.json': new Uint8Array(Buffer.from(t2, 'utf8')) })['types.json'];
      Object.keys(files).forEach(f => { app.fs.files[f] = files[f]; });
      app.fs.files[dir + 'types.json'] = { t: t2, m: Date.now() }; app.fs.files[dir + 'publication.json'] = { t: JSON.stringify(info, null, 2), m: Date.now() };
    }
    if (how === 'plan link') {
      app.fs.files[pf.replace(/\.json$/, ' (1).json')] = { t: app.fs.files[pf].t, m: Date.now() };
      const name = pf.split('/').pop();
      fs.list = (p, o) => list(p, o).then(items => /^proposals\/?$/.test(p) ? items.map(i => i.name === name ? Object.assign({}, i, { kind: 'link' }) : i) : items);
    }
    if (how === 'proposals unreadable') fs.list = (p, o) => /^proposals\/?$/.test(p) ? Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES', name: 'NotAllowedError' })) : list(p, o);
    await refresh(app, 400); await toParent(app); await refresh(app, 300);
    assert.ok(!/data-act="td-evidence"/.test(app.html()), how + ': no Accept: ' + txt(app.html()).slice(0, 600));
    app.click('td-evidence', todo, { run: key.split('/')[1] }); await app.tick(400);
    fs.list = list;
    assert.strictEqual(evRecs(app).length, 0, how + ': nothing written');
  }
});

rule('Run this checklist whose folder or person changes before the plan is written writes nothing; a pin that can\'t be used offers nothing', async () => {
  const { app, todo } = await setup();
  const fs = app.fs, read = fs.read.bind(fs); let release = null;
  fs.read = (p, o) => /^proposals\/plan-ev-[0-9a-f]{24}\.json$/.test(p) && !release ? new Promise((res) => { release = () => res(read(p, o)); }) : read(p, o);
  app.click('td-detour', todo); await app.tick(40);
  assert.ok(release, 'the save is under way');
  app.choose('person-blake'); await app.tick(40);
  release(); await app.tick(150);
  fs.read = read;
  assert.strictEqual(plans(app).length, 0, 'nothing written');
  app.choose('person-avery'); await app.tick(80);
  const { app: app2, kp, todo: t2 } = await setup();
  app2.files('publications/smoke-test/' + kp.folder + '/').forEach(p => { app2.fs.files[p] = { t: 'damaged', m: Date.now() }; });
  await refresh(app2, 300);
  assert.ok(!new RegExp('data-act="td-detour"[^>]*data-id="' + t2 + '"').test(app2.html()), 'no button on a pin that can\'t be used');
  assert.ok(/can't be used here/.test(txt(app2.html())), txt(app2.html()).slice(0, 2000));
  app2.click('td-detour', t2); await app2.tick(200);
  assert.strictEqual(plans(app2).length, 0, 'clicked anyway, nothing written');
});

/* VD: Run this checklist's late completion is bound to the screen, form and person it started from. Its plan is saved;
   once the person has moved on (another Start screen, typing a run name) or another person is chosen, nothing is opened
   over it and nothing typed is replaced, and it is said. */
rule('A late Run this checklist keeps its plan but never opens over a newer screen, replaces what was typed, or opens for another person', async () => {
  for (const how of ['moved', 'person']) {
    const { app, todo } = await setup();
    const fs = app.fs, read = fs.read.bind(fs), blob = fs.blob ? fs.blob.bind(fs) : null; let release = null;
    const held = (p) => /^proposals\/plan-ev-[0-9a-f]{24}\.json$/.test(p) && fs.files[p] && !release;
    const wait = (go) => new Promise((res) => { release = () => res(go()); });
    fs.read = (p, o) => held(p) ? wait(() => read(p, o)) : read(p, o);
    if (blob) fs.blob = (p, o) => held(p) ? wait(() => blob(p, o)) : blob(p, o);
    app.click('td-detour', todo);
    for (let i = 0; i < 40 && !release; i++) await app.tick(20);
    assert.ok(release && plans(app).length === 1, how + ': set-up: the plan is saved, its read-back held');
    if (how === 'moved') { app.click('start', 'release-notes'); await app.settle(); app.set('run-title', 'My typed name'); }
    else { app.choose('person-blake'); await app.tick(40); }
    const view = app.html().indexOf('data-plan-hash') >= 0;
    release(); await app.tick(300);
    fs.read = read; if (blob) fs.blob = blob;
    assert.strictEqual(plans(app).length, 1, how + ': the plan is kept');
    assert.strictEqual(app.html().indexOf('data-plan-hash') >= 0, view, how + ': the plan wasn\'t opened over the screen');
    if (how === 'moved') assert.strictEqual(app.draft('run-title'), 'My typed name', 'what was typed stays');
    assert.ok(/plan was saved/i.test(txt(app.html())), how + ': said: ' + (txt(app.html()).match(/[^.]*plan[^.]*\./) || [])[0]);
  }
});

/* YC: every late completion of Run this checklist is bound to the form and layer it started from, not only the screen:
   the plan's Start, Try again and Decline once another checklist's Start form is open with a name typed, and the plan's
   read-back once a step correction is being typed on the same run. What was committed is saved and said; nothing on
   screen is replaced or navigated away from. */
rule('A late detour Start, Try again, Decline or plan read-back keeps what was saved but never replaces a newer form or what was typed in it', async () => {
  const pause = (fs, m, test) => { const orig = fs[m].bind(fs); let release = null; fs[m] = (p, ...a) => (!release && test(p)) ? new Promise((res, rej) => { release = () => orig(p, ...a).then(res, rej); }) : orig(p, ...a); return { go: () => release && release(), on: () => !!release, off: () => { fs[m] = orig; } }; };
  const another = async (app) => { app.click('start', 'release-notes'); await app.settle(); app.set('run-title', 'My typed name'); };
  const kept = (app, label) => {
    assert.ok(/id="start-form"/.test(app.html()) && app.html().indexOf('data-process="release-notes"') >= 0, label + ': the newer Start form is still the one on screen');
    assert.strictEqual(app.draft('run-title'), 'My typed name', label + ': what was typed stays');
  };
  const pick = (h) => !process.env.YC_CASE || process.env.YC_CASE.split(',').indexOf(h) >= 0;
  for (const how of ['start', 'retry', 'decline'].filter(pick)) {
    const label = how, { app, todo } = await setup(['pass']);
    app.click('td-detour', todo); await app.tick(250);
    assert.ok(/id="start-form"/.test(app.html()), label + ': set-up: the plan\'s Start');
    const before = kidPaths(app).length;
    if (how === 'retry') {
      const w = app.fs.write.bind(app.fs); let failed = false;
      app.fs.write = (p, ...a) => (!failed && /^runs\/smoke-test\//.test(p)) ? (failed = true, Promise.reject(new Error('disk full'))) : w(p, ...a);
      app.chooseApprovers().submitForm('start-form'); await app.tick(300);
      app.fs.write = w;
      assert.ok(/data-act="plan-resume"/.test(app.html()), label + ': set-up: Try again offered');
    }
    const pz = how === 'decline' ? pause(app.fs, 'write', (p) => /^proposals\/plan-ev-.*\.status-/.test(p)) : pause(app.fs, 'write', (p) => /^runs\/smoke-test\//.test(p));
    if (how === 'start') app.chooseApprovers().submitForm('start-form');
    if (how === 'retry') { const id = (/data-act="plan-resume"[^>]*data-id="([^"]+)"/.exec(app.html()) || /data-id="([^"]+)"[^>]*data-act="plan-resume"/.exec(app.html()))[1]; app.click('plan-resume', id); }
    if (how === 'decline') { const id = (/data-act="decline-plan"[^>]*data-id="([^"]+)"/.exec(app.html()) || /data-id="([^"]+)"[^>]*data-act="decline-plan"/.exec(app.html()))[1]; app.click('decline-plan', id); }
    for (let i = 0; i < 40 && !pz.on(); i++) await app.tick(20);
    assert.ok(pz.on(), label + ': set-up: its write is under way');
    await another(app);
    pz.go(); await app.tick(400); pz.off();
    if (how === 'decline') assert.ok(app.files('proposals/').some(p => /^proposals\/plan-ev-.*\.status-/.test(p)), label + ': declined, as committed');
    else assert.strictEqual(kidPaths(app).length, before + 1, label + ': the run was saved');
    kept(app, label);
    assert.ok(/(started|declined|saved)/i.test(txt(app.html())), label + ': said what was done: ' + (txt(app.html()).match(/[^.]*(started|declined|saved)[^.]*\./i) || [])[0]);
  }
  /* The plan's read-back, after a step correction was opened on the same run and typed in. */
  if (!pick('readback')) return;
  const { app, todo } = await setup(['pass']);
  const fs = app.fs, read = fs.read.bind(fs); let release = null;
  fs.read = (p, o) => (/^proposals\/plan-ev-[0-9a-f]{24}\.json$/.test(p) && fs.files[p] && !release) ? new Promise((res) => { release = () => res(read(p, o)); }) : read(p, o);
  app.click('td-detour', todo);
  for (let i = 0; i < 40 && !release; i++) await app.tick(20);
  assert.ok(release && plans(app).length === 1, 'read-back: set-up: saved, its read-back held');
  app.click('corr-open', 'write', { mode: 'correct' }); await app.tick(80);
  assert.ok(/id="corr-text"|id="corr-to"/.test(app.html()), 'read-back: set-up: the composer is open');
  const box = /id="corr-text"/.test(app.html()) ? 'corr-text' : 'corr-to';
  app.set(box, 'My correction');
  release(); await app.tick(300); fs.read = read;
  assert.ok(/id="corr-text"|id="corr-to"/.test(app.html()) && !/data-plan-hash/.test(app.html()), 'read-back: the composer stays, the plan isn\'t opened over it');
  assert.strictEqual(app.draft(box), 'My correction', 'read-back: what was typed stays');
  /* PD: a browser replaces a data-bound box with what is drawn, so the redraw itself must carry it, not only the old node. */
  assert.ok(new RegExp('id="' + box + '"[^>]*>My correction</textarea>').test(app.html()), 'read-back: the redraw draws what was typed: ' + (app.html().match(new RegExp('id="' + box + '"[^>]*>[^<]*')) || [])[0]);
  assert.ok(/plan was saved/i.test(txt(app.html())), 'read-back: said it was saved');
});

/* BE: the same form revised while its Start is being saved, by input alone (typed text, a paste) or by the box's value
   replaced with no event at all: the run is saved, but the revised form stays on screen as it is, never opened over. */
rule('A detour Start keeps its run but never navigates away from its own form revised meanwhile by typing, a paste or a replaced value', async () => {
  for (const how of ['insertText', 'insertFromPaste', 'replaced']) {
    const { app, todo } = await setup(['pass']);
    app.click('td-detour', todo); await app.tick(250);
    assert.ok(/id="start-form"/.test(app.html()), how + ': set-up: the plan\'s Start');
    const before = kidPaths(app).length, w = app.fs.write.bind(app.fs); let release = null;
    app.fs.write = (p, ...a) => (!release && /^runs\/smoke-test\//.test(p)) ? new Promise((res, rej) => { release = () => w(p, ...a).then(res, rej); }) : w(p, ...a);
    app.chooseApprovers().submitForm('start-form');
    for (let i = 0; i < 40 && !release; i++) await app.tick(20);
    assert.ok(release, how + ': set-up: its first run write is under way');
    /* As on a page, the box the page holds is the one replaced (the harness hands back its own node once marked); no event.
       LB: unmarked, the harness reads the box from the markup, and only the redraw's new default title used to trip this. */
    if (how === 'replaced') Object.assign(app.el('run-title'), { _touched: true }).value = 'Revised name'; else app.input('run-title', 'Revised name', how);
    release(); await app.tick(400); app.fs.write = w;
    assert.strictEqual(kidPaths(app).length, before + 1, how + ': the run was saved');
    assert.ok(/id="start-form"/.test(app.html()), how + ': the revised form is still on screen');
    assert.strictEqual(app.draft('run-title'), 'Revised name', how + ': what was entered stays');
    assert.ok(/(started|saved)/i.test(txt(app.html())), how + ': said what was done');
  }
});

/* CB: the same check for every detour completion that navigates, not only Start: Try again, Decline and the plan's
   read-back each keep what they saved but never leave their own form revised meanwhile, even by a value replaced with no
   event at all. */
rule('A detour Try again, Decline or plan read-back never navigates away from its own form whose value was replaced with no event', async () => {
  const pause = (fs, m, test) => { const orig = fs[m].bind(fs); let release = null; fs[m] = (p, ...a) => (!release && test(p)) ? new Promise((res, rej) => { release = () => orig(p, ...a).then(res, rej); }) : orig(p, ...a); return { go: () => release && release(), on: () => !!release, off: () => { fs[m] = orig; } }; };
  const pick = (h) => !process.env.CB_CASE || process.env.CB_CASE.split(',').indexOf(h) >= 0;
  for (const how of ['retry', 'decline'].filter(pick)) {
    const { app, todo } = await setup(['pass']);
    app.click('td-detour', todo); await app.tick(250);
    assert.ok(/id="start-form"/.test(app.html()), how + ': set-up: the plan\'s Start');
    const before = kidPaths(app).length;
    if (how === 'retry') {
      const w = app.fs.write.bind(app.fs); let failed = false;
      app.fs.write = (p, ...a) => (!failed && /^runs\/smoke-test\//.test(p)) ? (failed = true, Promise.reject(new Error('disk full'))) : w(p, ...a);
      app.chooseApprovers().submitForm('start-form'); await app.tick(300);
      app.fs.write = w;
      assert.ok(/data-act="plan-resume"/.test(app.html()), how + ': set-up: Try again offered');
    }
    const act = how === 'retry' ? 'plan-resume' : 'decline-plan';
    const id = (new RegExp('data-act="' + act + '"[^>]*data-id="([^"]+)"').exec(app.html()) || new RegExp('data-id="([^"]+)"[^>]*data-act="' + act + '"').exec(app.html()))[1];
    const pz = how === 'decline' ? pause(app.fs, 'write', (p) => /^proposals\/plan-ev-.*\.status-/.test(p)) : pause(app.fs, 'write', (p) => /^runs\/smoke-test\//.test(p));
    app.click(act, id);
    for (let i = 0; i < 40 && !pz.on(); i++) await app.tick(20);
    assert.ok(pz.on(), how + ': set-up: its write is under way');
    /* As on a page, the box the page holds is the one replaced (the harness hands back its own node once marked); no event. */
    Object.assign(app.el('run-title'), { _touched: true }).value = 'Revised name';
    pz.go(); await app.tick(400); pz.off();
    if (how === 'decline') assert.ok(app.files('proposals/').some(p => /^proposals\/plan-ev-.*\.status-/.test(p)), how + ': declined, as committed');
    else assert.strictEqual(kidPaths(app).length, before + 1, how + ': the run was saved');
    assert.ok(/id="start-form"/.test(app.html()), how + ': the revised form is still on screen');
    assert.strictEqual(app.draft('run-title'), 'Revised name', how + ': what was entered stays');
    assert.ok(/(started|declined|saved)/i.test(txt(app.html())), how + ': said what was done: ' + (txt(app.html()).match(/[^.]*(started|declined|saved)[^.]*\./i) || [])[0]);
  }
  if (!pick('readback')) return;
  const { app, todo } = await setup(['pass']);
  const fs = app.fs, read = fs.read.bind(fs); let release = null;
  fs.read = (p, o) => (/^proposals\/plan-ev-[0-9a-f]{24}\.json$/.test(p) && fs.files[p] && !release) ? new Promise((res) => { release = () => res(read(p, o)); }) : read(p, o);
  app.click('td-detour', todo);
  for (let i = 0; i < 40 && !release; i++) await app.tick(20);
  assert.ok(release && plans(app).length === 1, 'read-back: set-up: saved, its read-back held');
  assert.ok(app.el('td-add'), 'read-back: set-up: the to-do box is on screen');
  Object.assign(app.el('td-add'), { _touched: true }).value = 'A revised to-do';
  release(); await app.tick(300); fs.read = read;
  assert.ok(!/data-plan-hash/.test(app.html()), 'read-back: the plan isn\'t opened over the run');
  assert.strictEqual(app.draft('td-add'), 'A revised to-do', 'read-back: what was entered stays');
  assert.ok(/plan was saved/i.test(txt(app.html())), 'read-back: said it was saved');
});

/* LB: with nothing done meanwhile, every completion pageMark guards lands where it always did: Start and Try again open
   the run they saved, Decline goes Home, and the plan's read-back opens its Start. Its own resets (the plan it clears)
   are never someone moving on. */
rule('A detour Start, Try again, Decline or plan read-back with nothing touched meanwhile opens its run, Home or its plan', async () => {
  const pick = (h) => !process.env.LB_CASE || process.env.LB_CASE.split(',').indexOf(h) >= 0;
  for (const how of ['readback', 'start', 'retry', 'decline'].filter(pick)) {
    const { app, todo } = await setup(['pass']);
    app.click('td-detour', todo); await app.tick(250);
    assert.ok(/id="start-form"/.test(app.html()) && /data-plan-hash/.test(app.html()), how + ': the plan\'s read-back opens its Start');
    if (how === 'readback') continue;
    const before = kidPaths(app).length;
    if (how === 'retry') {
      const w = app.fs.write.bind(app.fs); let failed = false;
      app.fs.write = (p, ...a) => (!failed && /^runs\/smoke-test\//.test(p)) ? (failed = true, Promise.reject(new Error('disk full'))) : w(p, ...a);
      app.chooseApprovers().submitForm('start-form'); await app.tick(300);
      app.fs.write = w;
      assert.ok(/data-act="plan-resume"/.test(app.html()), how + ': set-up: Try again offered');
    }
    if (how === 'start') { app.chooseApprovers().submitForm('start-form'); await app.tick(400); }
    else {
      const act = how === 'retry' ? 'plan-resume' : 'decline-plan';
      const id = (new RegExp('data-act="' + act + '"[^>]*data-id="([^"]+)"').exec(app.html()) || new RegExp('data-id="([^"]+)"[^>]*data-act="' + act + '"').exec(app.html()))[1];
      app.click(act, id); await app.tick(400);
    }
    const said = txt(app.html());
    assert.ok(!/left as it is/.test(said), how + ': nothing was left as it is: ' + (said.match(/[^.]*left as it is[^.]*\./) || [])[0]);
    if (how === 'decline') { assert.ok(!/id="start-form"/.test(app.html()), how + ': went Home, off the plan\'s Start'); assert.ok(/declined/i.test(said), how + ': said it was declined'); continue; }
    assert.strictEqual(kidPaths(app).length, before + 1, how + ': the run was saved');
    assert.ok(!/id="start-form"/.test(app.html()) && /id="step-suite"/.test(app.html()), how + ': the run it saved is open');
    assert.ok(/Run started/.test(said + ' ' + app.live()), how + ': said it started');
  }
});

rule('An interrupted start finds its plan again: Run this checklist opens the plan already there, never a second', async () => {
  const { app, todo } = await setup();
  app.click('td-detour', todo); await app.tick(250);
  assert.strictEqual(plans(app).length, 1);
  const was = app.fs.files[plans(app)[0]].t;
  await refresh(app, 200); await toParent(app);
  app.click('td-detour', todo); await app.tick(250);
  assert.deepStrictEqual([plans(app).length, app.fs.files[plans(app)[0]].t], [1, was], 'the same plan, the same bytes');
  assert.ok(/id="start-form"/.test(app.html()));
});

rule('Run this checklist checks its pin again when the run starts: a pinned version damaged, gone or changed since the form opened starts nothing', async () => {
  for (const how of ['damaged', 'gone', 'unreadable']) {
    const { app, kp, todo } = await setup();
    app.click('td-detour', todo); await app.tick(250);
    assert.ok(/id="start-form"/.test(app.html()), 'set-up: the start form, on its plan');
    const before = kidPaths(app).length, decs = () => app.files('proposals/').filter(p => /\.status-/.test(p)).length, d0 = decs();
    const base = 'publications/smoke-test/' + kp.folder + '/', fs = app.fs, read = fs.read.bind(fs), blob = fs.blob ? fs.blob.bind(fs) : null;
    if (how === 'damaged') fs.files[base + 'map.md'] = { t: fs.files[base + 'map.md'].t.replace('Run the smoke suite', 'Skip the smoke suite'), m: Date.now() };
    else if (how === 'gone') Object.keys(fs.files).filter(k => k.indexOf(base) === 0).forEach(k => { delete fs.files[k]; });
    else {
      const no = () => Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));
      fs.read = (p, o) => p.indexOf(base) === 0 ? no() : read(p, o);
      if (blob) fs.blob = (p) => p.indexOf(base) === 0 ? no() : blob(p);
    }
    app.chooseApprovers().submitForm('start-form'); await app.tick(300);
    fs.read = read; if (blob) fs.blob = blob;
    assert.deepStrictEqual([how, kidPaths(app).length, decs()], [how, before, d0], how + ': no run and no started decision');
    assert.ok(/Nothing was started|wasn.t started/.test(txt(app.html())), how + ': said');
  }
});

/* Every write path of a checklist-linked to-do, raced (test/race-harness.js): each async read before its writes paused in turn,
   the person switched, the folder switched, the person marked inactive or people.json made unreadable, then released. */
rule('Every checklist-linked write path is guarded after every read and right before every write: a pause and a change of person, folder, activity or people.json writes nothing after it', async () => {
  const only = process.env.RACE ? process.env.RACE.split(',') : null, want = (n) => !only || only.indexOf(n) >= 0, out = {};
  const completed = async () => { const S = await setup(), key = await runIt(S.app, S.todo); finish(S.app, key, 'pass'); await toParent(S.app); await refresh(S.app, 300); return Object.assign(S, { key }); };
  if (want('plan')) out.plan = await race('plan', async () => {
    const { app, todo } = await setup();
    return { app, act: () => app.click('td-detour', todo), mine: (p) => /^proposals\/plan-ev-[0-9a-f]{24}\.json$/.test(p), who: 'person-avery', other: 'person-casey' };
  });
  if (want('start')) out.start = await race('start', async () => {
    const { app, todo } = await setup();
    app.click('td-detour', todo); await app.tick(250);
    /* Only a decision written before the pause may have its run saved after it, in the name of whoever started it. */
    const allowed = (p, before, was) => {
      const m = /^runs\/smoke-test\/([^/]+)\//.exec(p);
      return !!m && Object.keys(before).some(k => /^proposals\/plan-ev-[0-9a-f]{24}\.status-/.test(k) && String(before[k]).indexOf('"' + m[1] + '"') >= 0) && /person-avery/.test(String(was.files[p] && was.files[p].t));
    };
    return { app, act: () => app.chooseApprovers().submitForm('start-form'), mine: (p) => /^proposals\/plan-ev-[0-9a-f]{24}\.status-/.test(p) || /^runs\/smoke-test\//.test(p), allowed, who: 'person-avery', other: 'person-casey' };
  });
  if (want('accept')) out.accept = await race('accept', async () => {
    const { app, todo, key } = await completed();
    return { app, act: () => app.click('td-evidence', todo, { run: key.split('/')[1] }), mine: (p) => /^proposals\/req-evidence-/.test(p), who: 'person-avery', other: 'person-casey' };
  });
  if (want('decide')) out.decide = await race('decide', async () => {
    const { app, todo, key } = await completed();
    app.choose('person-casey'); await app.tick(80); await toParent(app);
    app.click('td-evidence', todo, { run: key.split('/')[1] }); await app.tick(250);
    assert.strictEqual(evRecs(app).length, 1, 'set-up: Casey asked');
    app.choose('person-avery'); await app.tick(80); await refresh(app, 300); await toParent(app);
    app.click('td-inbox', ''); await app.tick(40);
    const m = /data-act="td-accept" data-id="([^"]+)" data-run="([^"]+)" data-fp="([^"]+)"/.exec(app.overlay() || app.html());
    assert.ok(m, 'set-up: Avery decides it');
    return { app, act: () => app.click('td-accept', m[1], { run: m[2], fp: m[3] }), mine: (p) => /^proposals\/req-evidence-[0-9a-f]+\.status-/.test(p) && !/apply|appl/.test(p), who: 'person-avery', other: 'person-casey' };
  });
  /* The recorder's window lands a done on a run's result: the application record and the run's save (candidate, backup,
     run.json), each under the to-do guard read again right there, people.json last. */
  if (want('land')) out.land = await race('land', async () => {
    const { app, todo, key } = await completed(), PF = app.PF;
    const r = PF.run.sanitize(parentRun(app)), id = key.split('/')[1];
    const sn = await PF.repo.readTodos(app.fs, { evidence: true, also: [{ process: 'smoke-test', id }] });
    const x = PF.todos.view(r, { records: sn.records, unread: sn.unread, people: sn.people, evidence: sn.evidence }).byTodo[todo];
    const E = PF.detours.evidenceFor(r, x, id, sn.evidence);
    assert.ok(!E.why, 'set-up: ' + E.why);
    const P = PF.todos.prepare(r, { body: { op: 'done', todo, evidence: E.evidence }, by: { person: 'person-avery' }, key: 'ui-land', records: sn.records, unread: sn.unread, people: sn.people, at: AT(), app: '4.0.0', evidence: sn.evidence });
    assert.ok(!P.why, P.why);
    app.fs.files['proposals/' + P.name] = { t: PF.todos.text(P.file), m: Date.now() };
    const pp = parentPath(app), dir = pp.slice(0, pp.lastIndexOf('/') + 1);
    return { app, act: () => app.click('refresh'), mine: (p) => p.indexOf(dir) === 0 || (/^proposals\/req-evidence-/.test(p) && p !== 'proposals/' + P.name), who: 'person-avery', other: 'person-casey' };
  }, { near: 8, settle: 600 });
  if (process.env.RACE_SAY) console.log(JSON.stringify(out));
});

/* SE: Accept's write guard reads the evidence run again; a part of it that can't be read now (its notes file) is part of the
   verdict, as runs and run say: unread evidence is never accepted. */
rule('Accept writes nothing when the evidence run has a file that can\'t be read since the screen was drawn', async () => {
  const { app, todo } = await setup();
  const key = await runIt(app, todo);
  finish(app, key, 'pass');
  const np = 'runs/' + key + '/notes-w9.jsonl';
  app.fs.files[np] = { t: JSON.stringify({ id: 'n1', at: AT(), by: 'person-avery', text: 'Ran it' }) + '\n', m: Date.now() };
  await toParent(app); await refresh(app, 300);
  assert.ok(/data-act="td-evidence"/.test(app.html()), 'set-up: Accept offered');
  const fs = app.fs, read = fs.read.bind(fs);
  fs.read = (p, ...a) => p === np ? Promise.reject(Object.assign(new Error('The file is locked'), { name: 'NotReadableError' })) : read(p, ...a);
  app.click('td-evidence', todo, { run: key.split('/')[1] }); await app.tick(250);
  fs.read = read;
  assert.strictEqual(evRecs(app).length, 0, 'nothing written');
});

/* UC: a notes file that was listed and then read as gone (null) is a vanished part of the evidence run: Accept writes nothing. */
rule('Accept writes nothing when a listed file of the evidence run is gone when it is read', async () => {
  const { app, todo } = await setup();
  const key = await runIt(app, todo);
  finish(app, key, 'pass');
  const np = 'runs/' + key + '/notes-w9.jsonl';
  app.fs.files[np] = { t: JSON.stringify({ id: 'n1', at: AT(), by: 'person-avery', text: 'Ran it' }) + '\n', m: Date.now() };
  await toParent(app); await refresh(app, 300);
  assert.ok(/data-act="td-evidence"/.test(app.html()), 'set-up: Accept offered');
  const fs = app.fs, read = fs.read.bind(fs);
  fs.read = (p, ...a) => p === np ? Promise.resolve(null) : read(p, ...a);
  app.click('td-evidence', todo, { run: key.split('/')[1] }); await app.tick(250);
  fs.read = read;
  assert.strictEqual(evRecs(app).length, 0, 'nothing written');
});

/* VF: a part of the evidence run listed as a link (never read through) is named, and Accept writes nothing. */
rule('Accept writes nothing when a part of the evidence run is listed as a link', async () => {
  const { app, todo } = await setup();
  const key = await runIt(app, todo);
  finish(app, key, 'pass');
  await toParent(app); await refresh(app, 300);
  assert.ok(/data-act="td-evidence"/.test(app.html()), 'set-up: Accept offered');
  const fs = app.fs, list = fs.list.bind(fs), dir = 'runs/' + key;
  fs.list = (p, ...a) => list(p, ...a).then((items) => p === dir ? items.concat([{ name: 'notes-w9.jsonl', kind: 'link' }]) : items);
  app.click('td-evidence', todo, { run: key.split('/')[1] }); await app.tick(250);
  fs.list = list;
  assert.strictEqual(evRecs(app).length, 0, 'nothing written');
});

/* PA: Start, Decline and the plan's creation read proposals/ last but for people.json, through the final check
   (PF.repo.planFinal): the exact plan, its copies and its decisions as that read finds them. A plan torn, gone, copied
   differently or decided while the pinned version is read, or a copy that arrives while the plan is read, writes nothing. */
rule('A detour Start, Decline or plan creation writes nothing when its plan is torn, gone, copied or decided during its last reads', async () => {
  const pick = (h) => !process.env.PA_CASE || process.env.PA_CASE.split(',').indexOf(h) >= 0;
  const decided = (app) => app.files('proposals/plan-ev-').filter(p => /\.status-.*-d\.json$/.test(p));
  const change = (app, planPath, how) => {
    const F = app.fs.files, id = planPath.slice('proposals/'.length, -'.json'.length), plan = JSON.parse(F[planPath].t);
    if (how === 'tear') F[planPath] = { t: '{ "format": ', m: Date.now() };
    if (how === 'delete') delete F[planPath];
    if (how === 'torncopy') F['proposals/' + id + ' (1).json'] = { t: '{ "format": ', m: Date.now() };
    if (how === 'differs') { const o = Object.assign({}, plan, { title: 'Another title' }); F['proposals/' + id + ' (1).json'] = { t: JSON.stringify(o, null, 2) + '\n', m: Date.now() }; }
    if (how === 'decided') F['proposals/' + id + '.status-other-d.json'] = { t: JSON.stringify(app.PF.plans.decision(plan, 'accepted', 'r-other1', 'person-blake', AT(), null, '4.0.0'), null, 2), m: Date.now() };
  };
  /* Start: the change lands during the pinned version's read inside the write (after proposals/ was read under the lock). */
  for (const how of ['tear', 'delete', 'torncopy', 'differs', 'decided'].filter((h) => pick('start-' + h))) {
    const { app, todo } = await setup(['pass']);
    app.click('td-detour', todo); await app.tick(250);
    const planPath = plans(app)[0], before = kidPaths(app).length, fs = app.fs, list = fs.list.bind(fs), read = fs.read.bind(fs);
    let listed = false, done = false;
    fs.list = (d, ...a) => list(d, ...a).then((x) => { if (d === 'proposals') listed = true; return x; });
    fs.read = (p, ...a) => { if (listed && !done && /^publications\/smoke-test\//.test(p)) { done = true; change(app, planPath, how); } return read(p, ...a); };
    app.chooseApprovers().submitForm('start-form'); await app.tick(400);
    fs.list = list; fs.read = read;
    assert.ok(done, 'start ' + how + ': set-up: changed during the pin read');
    assert.strictEqual(kidPaths(app).length, before, 'start ' + how + ': no run saved');
    assert.ok(!decided(app).some(p => !/status-other-d/.test(p)), 'start ' + how + ': no decision written: ' + decided(app).join(', '));
  }
  /* Start and Decline: a copy that arrives right after proposals/ is first listed for the decision. */
  for (const act of ['start', 'decline'].filter((h) => pick(h + '-early'))) {
    for (const how of ['torncopy', 'differs']) {
      const { app, todo } = await setup(['pass']);
      app.click('td-detour', todo); await app.tick(250);
      const planPath = plans(app)[0], before = kidPaths(app).length, fs = app.fs, list = fs.list.bind(fs);
      let done = false;
      fs.list = (d, ...a) => list(d, ...a).then((x) => { if (d === 'proposals' && !done) { done = true; change(app, planPath, how); } return x; });
      if (act === 'start') app.chooseApprovers().submitForm('start-form');
      else { const id = (/data-act="decline-plan"[^>]*data-id="([^"]+)"/.exec(app.html()) || /data-id="([^"]+)"[^>]*data-act="decline-plan"/.exec(app.html()))[1]; app.click('decline-plan', id); }
      await app.tick(400); fs.list = list;
      assert.ok(done, act + ' ' + how + ': set-up: a copy arrived');
      assert.strictEqual(kidPaths(app).length, before, act + ' ' + how + ': no run saved');
      assert.deepStrictEqual(decided(app), [], act + ' ' + how + ': no decision written');
    }
  }
  /* Creation: a torn copy of the plan arrives after its name is first read, before it is written. */
  if (pick('create')) {
    const { app, todo } = await setup(['pass']);
    const fs = app.fs, read = fs.read.bind(fs);
    let done = false;
    fs.read = (p, ...a) => { if (!done && /^proposals\/plan-ev-[0-9a-f]{24}\.json$/.test(p) && !fs.files[p]) { done = true; fs.files[p.slice(0, -'.json'.length) + ' (1).json'] = { t: '{ "format": ', m: Date.now() }; } return read(p, ...a); };
    app.click('td-detour', todo); await app.tick(400); fs.read = read;
    assert.ok(done, 'create: set-up: a torn copy arrived');
    assert.deepStrictEqual(plans(app), [], 'create: the plan isn\'t written beside a copy that can\'t be read');
  }
});

/* Round 15: a start whose first run save failed: its decision is written and Try again is on offer. */
const mineDec = (app) => app.files('proposals/plan-ev-').filter(p => /\.status-.*-d\.json$/.test(p) && !/status-other-d/.test(p));
const idOf = (app, act) => (new RegExp('data-act="' + act + '"[^>]*data-id="([^"]+)"').exec(app.html()) || new RegExp('data-id="([^"]+)"[^>]*data-act="' + act + '"').exec(app.html()))[1];
const r15 = (h) => !process.env.SR_CASE || process.env.SR_CASE.split(',').indexOf(h) >= 0;
async function interrupted() {
  const S = await setup(['pass']), app = S.app;
  app.click('td-detour', S.todo); await app.tick(250);
  const w = app.fs.write.bind(app.fs); let failed = false;
  app.fs.write = (p, ...a) => (!failed && /^runs\/smoke-test\//.test(p)) ? (failed = true, Promise.reject(new Error('disk full'))) : w(p, ...a);
  app.chooseApprovers().submitForm('start-form'); await app.tick(300);
  app.fs.write = w;
  assert.ok(/data-act="plan-resume"/.test(app.html()) && mineDec(app).length === 1, 'set-up: Try again offered, its decision written');
  return Object.assign(S, { planPath: plans(app)[0], decPath: mineDec(app)[0] });
}

/* SA: Try again's final read keeps the reservation it rests on: this window's exact start decision and the plan as the form
   showed it, both unchanged, or nothing is saved. */
rule('A detour Try again saves nothing once its own start decision or the plan it reviewed changed during its reads', async () => {
  /* SA: during Try again's reads, before its final one. */
  for (const how of ['sa-delete', 'sa-title', 'sa-maphash'].filter(r15)) {
    const S = await interrupted(), app = S.app, F = app.fs.files, before = kidPaths(app).length, fs = app.fs, read = fs.read.bind(fs);
    let done = false;
    fs.read = (p, ...a) => {
      if (!done && /^runs\/smoke-test\/[^/]+\/run\.json$/.test(p)) {
        done = true;
        if (how === 'sa-delete') delete F[S.decPath];
        else { const o = JSON.parse(F[S.planPath].t); if (how === 'sa-title') o.title = 'Another title'; else o.pin = Object.assign({}, o.pin, { mapHash: 'f'.repeat(String(o.pin.mapHash).length) }); F[S.planPath] = { t: JSON.stringify(o, null, 2) + '\n', m: Date.now() }; }
      }
      return read(p, ...a);
    };
    app.click('plan-resume', idOf(app, 'plan-resume')); await app.tick(400); fs.read = read;
    assert.ok(done, how + ': set-up: changed during Try again\'s reads');
    assert.strictEqual(kidPaths(app).length, before, how + ': no run saved');
    assert.ok(!/Run started/.test(txt(app.html()) + ' ' + app.live()), how + ': never said it started');
  }
});

/* SB: making a to-do's plan is refused by a start or decline on its ID that arrived meanwhile. */
rule('Run this checklist writes no plan beside a decision on its plan\'s ID that arrived while it was read', async () => {
  /* SB: a decision on the plan's ID arrives after its name is first read, before it is written. */
  for (const st of ['accepted', 'declined'].filter(x => r15('sb-' + x))) {
    const { app, todo } = await setup(['pass']);
    const fs = app.fs, read = fs.read.bind(fs);
    let done = false;
    fs.read = (p, ...a) => {
      const m = /^proposals\/(plan-ev-[0-9a-f]{24})\.json$/.exec(p);
      if (!done && m && !fs.files[p]) { done = true; fs.files['proposals/' + m[1] + '.status-other-d.json'] = { t: JSON.stringify({ format: 'flightdeck-plan-status/2', app: '4.0.0', proposal: m[1], proposalHash: 'x', status: st, run: st === 'accepted' ? 'r-other1' : null, by: 'person-blake', at: AT() }, null, 2), m: Date.now() }; }
      return read(p, ...a);
    };
    app.click('td-detour', todo); await app.tick(400); fs.read = read;
    assert.ok(done, 'sb-' + st + ': set-up: a decision arrived');
    assert.deepStrictEqual(plans(app), [], 'sb-' + st + ': no plan written beside a decision on its ID');
  }
});

/* SC: a detour Decline reads people.json after the plan's final read and asks the decliner's authority right before the write. */
rule('A detour Decline writes nothing when the decliner is marked inactive or people.json can\'t be read during its reads', async () => {
  /* SC: the decliner marked inactive, or people.json unreadable, during the plan's final read. */
  for (const how of ['sc-inactive', 'sc-unreadable'].filter(r15)) {
    const { app, todo } = await setup(['pass']);
    app.click('td-detour', todo); await app.tick(250);
    const fs = app.fs, list = fs.list.bind(fs), F = fs.files;
    let done = false;
    fs.list = (d, ...a) => list(d, ...a).then((x) => {
      if (d === 'proposals' && !done) {
        done = true;
        if (how === 'sc-unreadable') F['people.json'] = { t: '{ "format": ', m: Date.now() };
        else { const o = JSON.parse(F['people.json'].t); (o.people || o).forEach(p => { if (p.id === 'person-avery') p.inactive = true; }); F['people.json'] = { t: JSON.stringify(o, null, 2), m: Date.now() }; }
      }
      return x;
    });
    app.click('decline-plan', idOf(app, 'decline-plan')); await app.tick(400); fs.list = list;
    assert.ok(done, how + ': set-up: changed during the plan\'s read');
    assert.deepStrictEqual(mineDec(app), [], how + ': no decline written');
    assert.ok(!/Plan declined/.test(txt(app.html()) + ' ' + app.live()), how + ': never said it was declined');
  }
});

/* SD: Try again verifies the exact pinned version again, as Start does, before its final read. */
rule('A detour Try again saves nothing on a pinned version damaged or gone since the start was interrupted', async () => {
  /* SD: the pinned version damaged or gone after the start was interrupted, with no refresh. */
  for (const how of ['sd-damage', 'sd-delete'].filter(r15)) {
    const S = await interrupted(), app = S.app, F = app.fs.files, before = kidPaths(app).length;
    const dir = 'publications/smoke-test/' + S.kp.folder + '/';
    if (how === 'sd-damage') F[dir + 'map.md'] = { t: F[dir + 'map.md'].t + '\n- [!] {confirm} Something else {#extra}\n', m: Date.now() };
    else Object.keys(F).filter(k => k.indexOf(dir) === 0).forEach(k => delete F[k]);
    app.click('plan-resume', idOf(app, 'plan-resume')); await app.tick(400);
    assert.strictEqual(kidPaths(app).length, before, how + ': no run saved');
    assert.ok(!/Run started/.test(txt(app.html()) + ' ' + app.live()), how + ': never said it started');
  }
});

/* Round 16. */
const r16 = (h) => !process.env.UR_CASE || process.env.UR_CASE.split(',').indexOf(h) >= 0;
const setPeople = (app, how) => {
  const F = app.fs.files;
  if (how === 'unreadable') F['people.json'] = { t: '{ "format": ', m: Date.now() };
  else { const o = JSON.parse(F['people.json'].t); (o.people || o).forEach(p => { if (p.id === 'person-avery') p.inactive = true; }); F['people.json'] = { t: JSON.stringify(o, null, 2), m: Date.now() }; }
};
/* UA: a to-do's Try again is under the write guard: people.json read after its final read, the starter's authority asked
   right before the run is written; refused, the reservation stays and Try again is still offered. */
rule('A detour Try again saves no run when its starter is inactive or people.json can\'t be read, and stays on offer', async () => {
  for (const how of ['ua-inactive-before', 'ua-unreadable-before', 'ua-inactive-during', 'ua-unreadable-during'].filter(r16)) {
    const S = await interrupted(), app = S.app, before = kidPaths(app).length, fs = app.fs, read = fs.read.bind(fs), kind = /inactive/.test(how) ? 'inactive' : 'unreadable';
    let done = false;
    if (/before/.test(how)) { setPeople(app, kind); done = true; }
    else fs.read = (p, ...a) => { if (!done && /^runs\/smoke-test\/[^/]+\/run\.json$/.test(p)) { done = true; setPeople(app, kind); } return read(p, ...a); };
    app.click('plan-resume', idOf(app, 'plan-resume')); await app.tick(400); fs.read = read;
    assert.ok(done, how + ': set-up: people changed');
    assert.strictEqual(kidPaths(app).length, before, how + ': no run saved');
    assert.ok(!/Run started/.test(txt(app.html()) + ' ' + app.live()), how + ': never said it started');
    assert.ok(/data-act="plan-resume"/.test(app.html()), how + ': Try again still offered');
    assert.strictEqual(mineDec(app).length, 1, how + ': the reservation stays');
  }
});

/* UD: a reservation write whose answer is an error but which landed is read back: found exactly as written, the plan is
   marked started for that run and Try again is on offer (and saves it); not found, nothing is offered as started. */
rule('A detour start whose decision write landed but answered an error offers Try again, which saves the run', async () => {
  const S = await setup(['pass']), app = S.app;
  app.click('td-detour', S.todo); await app.tick(250);
  const w = app.fs.write.bind(app.fs), before = kidPaths(app).length; let failed = false;
  app.fs.write = (p, ...a) => (!failed && /^proposals\/plan-ev-.*\.status-.*-d\.json$/.test(p)) ? (failed = true, w(p, ...a).then(() => { throw new Error('The network went away'); })) : w(p, ...a);
  app.chooseApprovers().submitForm('start-form'); await app.tick(300);
  app.fs.write = w;
  assert.ok(failed, 'set-up: the decision write answered an error');
  assert.strictEqual(mineDec(app).length, 1, 'the decision landed');
  assert.strictEqual(kidPaths(app).length, before, 'no run yet');
  assert.ok(/data-act="plan-resume"/.test(app.html()), 'Try again offered');
  app.click('plan-resume', idOf(app, 'plan-resume')); await app.tick(400);
  assert.strictEqual(kidPaths(app).length, before + 1, 'Try again saved the run');
  assert.strictEqual(mineDec(app).length, 1, 'still one decision');
});

/* VA: a start decision write that answered an error keeps Try again whatever its read-back gives (an error, or nothing):
   Try again confirms the exact reservation first, and only one confirmed absent is reserved again. */
rule('A detour start whose decision write answered an error and whose read-back failed still offers Try again, which saves one run', async () => {
  for (const how of ['landed-readerror', 'landed-readnull', 'lost-readnull'].filter((h) => !process.env.VA_CASE || process.env.VA_CASE.split(',').indexOf(h) >= 0)) {
    const S = await setup(['pass']), app = S.app;
    app.click('td-detour', S.todo); await app.tick(250);
    const fs = app.fs, w = fs.write.bind(fs), read = fs.read.bind(fs), before = kidPaths(app).length, isDec = (p) => /^proposals\/plan-ev-.*\.status-.*-d\.json$/.test(p);
    let failed = false, readBack = false;
    fs.write = (p, ...a) => {
      if (failed || !isDec(p)) return w(p, ...a);
      failed = true;
      return (/^landed/.test(how) ? w(p, ...a) : Promise.resolve()).then(() => { throw new Error('The network went away'); });
    };
    fs.read = (p, ...a) => {
      if (failed && !readBack && isDec(p)) { readBack = true; return /readerror/.test(how) ? Promise.reject(new Error('EIO: i/o error')) : Promise.resolve(null); }
      return read(p, ...a);
    };
    app.chooseApprovers().submitForm('start-form'); await app.tick(300);
    fs.write = w; fs.read = read;
    assert.ok(failed && readBack, how + ': set-up: the write answered an error and was read back');
    assert.strictEqual(mineDec(app).length, /^landed/.test(how) ? 1 : 0, how + ': set-up: the decision ' + (/^landed/.test(how) ? 'landed' : 'didn\'t land'));
    assert.strictEqual(kidPaths(app).length, before, how + ': no run yet');
    assert.ok(/data-act="plan-resume"/.test(app.html()), how + ': Try again offered');
    app.click('plan-resume', idOf(app, 'plan-resume')); await app.tick(500);
    assert.strictEqual(kidPaths(app).length, before + 1, how + ': Try again saved the run: ' + app.live());
    assert.strictEqual(mineDec(app).length, 1, how + ': one decision');
    const d = JSON.parse(app.fs.files[mineDec(app)[0]].t), r = JSON.parse(app.fs.files[kidPaths(app).filter(p => p.indexOf(d.run) >= 0)[0]].t);
    assert.strictEqual(r.id, d.run, how + ': the decision names the run saved');
  }
});

/* VB: Run this checklist reads and judges, inside its final check, everything its plan rests on: the pinned version, the run
   it is on and the to-do's own record. One damaged or gone since the screen was drawn (no refresh) writes no plan. */
rule('Run this checklist writes no plan when its pinned version, its run or its to-do\'s record changed since the screen was drawn', async () => {
  for (const how of ['vb-pub', 'vb-run', 'vb-todo'].filter((h) => !process.env.VB_CASE || process.env.VB_CASE.split(',').indexOf(h) >= 0)) {
    const { app, kp, todo } = await setup(['pass']), F = app.fs.files;
    assert.strictEqual(plans(app).length, 0, how + ': set-up: no plan yet');
    if (how === 'vb-pub') { const m = 'publications/smoke-test/' + kp.folder + '/map.md'; F[m] = { t: F[m].t.replace('Run the smoke suite', 'Skip the smoke suite'), m: Date.now() }; }
    else if (how === 'vb-run') { const o = parentRun(app); o.details = []; F[parentPath(app)] = { t: JSON.stringify(o, null, 2), m: Date.now() }; }
    else { const adds = app.files('proposals/req-').filter(p => { try { const o = JSON.parse(F[p].t); return o.op === 'add' && o.checklist; } catch (e) { return false; } }); assert.strictEqual(adds.length, 1, how + ': set-up: its record'); delete F[adds[0]]; }
    app.click('td-detour', todo); await app.tick(300);
    assert.strictEqual(plans(app).length, 0, how + ': no plan written: ' + app.live());
  }
});

/* UE: a to-do's plan starts on the exact version its to-do pins: no Start on vN instead or Use the latest, and a switch
   asked anyway writes nothing. */
rule('A to-do\'s plan never offers or records a switch to a newer version', async () => {
  const { app, todo, kp } = await setup(['pass']);
  app.click('td-detour', todo); await app.tick(250);
  const planPath = plans(app)[0], id = planPath.slice('proposals/'.length, -'.json'.length);
  const k2 = publish(app, SMOKE.replace('Run the smoke suite', 'Run the whole smoke suite'), 'sm000002', [kp.info]);
  await refresh(app, 300);
  app.click('td-detour', todo); await app.tick(250);
  assert.ok(/id="start-form"/.test(app.html()), 'set-up: its plan is open');
  assert.ok(!/data-act="plan-retarget"/.test(app.html()) && !/data-act="plan-latest"/.test(app.html()), 'no switch offered');
  app.click('plan-retarget', id, { folder: k2.folder }); await app.tick(300);
  app.click('plan-latest', id); await app.tick(100);
  assert.deepStrictEqual(app.files('proposals/' + id + '.status-'), [], 'no switch recorded');
  const before = kidPaths(app).length;
  app.chooseApprovers().submitForm('start-form'); await app.tick(400);
  assert.strictEqual(kidPaths(app).length, before + 1, 'it starts on its pinned version');
});

/* WD: Run this checklist judges the run it is on with the one source verdict every reader uses: a version of that run that
   can't be read (EACCES) since the screen was drawn writes no plan. */
rule('Run this checklist writes no plan when the version of the run it is on can\'t be read since the screen was drawn', async () => {
  const { app, todo } = await setup(['pass']), r = parentRun(app), fs = app.fs, read = fs.read.bind(fs);
  const pi = 'publications/release-notes/' + r.folder + '/publication.json';
  assert.ok(fs.files[pi], 'set-up: the version is there');
  fs.read = (p, ...a) => p === pi ? Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })) : read(p, ...a);
  app.click('td-detour', todo); await app.tick(300);
  fs.read = read;
  assert.strictEqual(plans(app).length, 0, 'no plan written: ' + app.live());
});

/* WE: the plan made again inside the final check is compared whole (its pin, title and attribution), never by its id alone:
   the to-do's record replaced by one with the same id that pins another version writes no plan on the old pin. */
rule('Run this checklist writes no plan when its to-do now pins another version under the same plan id', async () => {
  const { app, kp, todo } = await setup(['pass']), F = app.fs.files;
  const k2 = publish(app, SMOKE.replace('Run the smoke suite', 'Run the whole smoke suite'), 'sm000002', [kp.info]);
  await refresh(app, 300); await toParent(app); await refresh(app, 300);
  const adds = app.files('proposals/req-').filter(p => { try { const o = JSON.parse(F[p].t); return o.op === 'add' && o.checklist; } catch (e) { return false; } });
  assert.strictEqual(adds.length, 1, 'set-up: its record');
  /* Every place the record names its pin moves to v2, and the application's fingerprint is made again: a valid record. */
  const old = JSON.parse(F[adds[0]].t), pin1 = JSON.stringify(old.checklist);
  const repin = (v) => Array.isArray(v) ? v.map(repin) : v && typeof v === 'object' ? (JSON.stringify(v) === pin1 ? Object.assign({}, v, { folder: k2.folder, version: k2.info.version, mapHash: k2.info.mapHash, typesHash: k2.info.typesHash }) : Object.fromEntries(Object.entries(v).map(([k, y]) => [k, repin(y)]))) : v;
  const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
  const o = repin(old);
  if (o.application) o.application.fingerprint = app.PF.sha256.hex(JSON.stringify(canon(o.application.effect))).slice(0, 16);
  F[adds[0]] = { t: JSON.stringify(o, null, 2) + '\n', m: Date.now() };
  const PF = app.PF, d = await PF.repo.loadAll(app.fs, {}), people = JSON.parse(F['people.json'].t);
  const V = PF.todos.view(PF.run.sanitize(parentRun(app)), { records: d.todos, people }), x = V.byTodo[todo];
  assert.ok(x && x.checklist && x.checklist.folder === k2.folder, 'set-up: the folder now reads the to-do pinned to v2 under the same id: ' + JSON.stringify(d.todosUnread));
  app.click('td-detour', todo); await app.tick(300);
  const made = plans(app).map(p => JSON.parse(F[p].t));
  assert.ok(!made.some(p => p.pin && p.pin.folder === kp.folder), 'no plan on the old pin: ' + app.live());
});

/* WC: a linked file named for the plan (a decision or a copy) is never read through and never left out: plan creation,
   Start and Decline each write nothing beside one, and say its path. */
rule('A detour plan creation, Start or Decline writes nothing beside a linked file named for its plan', async () => {
  const decided = (app) => app.files('proposals/plan-ev-').filter(p => /\.status-.*-d\.json$/.test(p));
  for (const act of ['create', 'start', 'decline'].filter((h) => !process.env.WC_CASE || process.env.WC_CASE.split(',').indexOf(h) >= 0)) {
    const { app, todo } = await setup(['pass']), fs = app.fs, list = fs.list.bind(fs), read = fs.read.bind(fs);
    let id = null;
    const linked = () => { fs.list = (d, ...a) => list(d, ...a).then((x) => d === 'proposals' && id ? x.concat([{ name: id + '.status-other-d.json', kind: 'link' }]) : x); };
    if (act === 'create') {
      fs.read = (p, ...a) => { const m = /^proposals\/(plan-ev-[0-9a-f]{24})\.json$/.exec(p); if (m && !id) id = m[1]; return read(p, ...a); };
      linked();
      app.click('td-detour', todo); await app.tick(400);
      fs.read = read; fs.list = list;
      assert.ok(id, 'create: set-up: its name was read');
      assert.deepStrictEqual(plans(app), [], 'create: no plan written beside a linked decision');
      continue;
    }
    app.click('td-detour', todo); await app.tick(250);
    const before = kidPaths(app).length;
    id = plans(app)[0].slice('proposals/'.length, -'.json'.length);
    linked();
    if (act === 'start') app.chooseApprovers().submitForm('start-form');
    else { const did = (/data-act="decline-plan"[^>]*data-id="([^"]+)"/.exec(app.html()) || /data-id="([^"]+)"[^>]*data-act="decline-plan"/.exec(app.html()))[1]; app.click('decline-plan', did); }
    await app.tick(400); fs.list = list;
    assert.strictEqual(kidPaths(app).length, before, act + ': no run saved');
    assert.deepStrictEqual(decided(app), [], act + ': no decision written');
    assert.ok(/status-other-d\.json/.test(app.live() + ' ' + txt(app.html())), act + ': the linked file is named: ' + app.live());
  }
});

/* WB: a part of a completed evidence run that an ordinary read can't take in (a listed notes file gone when read, or a
   notes file listed as a link) holds the evidence on the screen, as the write guard holds it: after a refresh no Accept. */
rule('A refreshed evidence view offers no Accept when a part of the evidence run is gone when read or listed as a link', async () => {
  for (const how of ['wb-null', 'wb-link'].filter((h) => !process.env.WB_CASE || process.env.WB_CASE.split(',').indexOf(h) >= 0)) {
    const { app, todo } = await setup(['pass']);
    const key = await runIt(app, todo);
    finish(app, key, 'pass');
    const np = 'runs/' + key + '/notes-w9.jsonl', dir = 'runs/' + key;
    app.fs.files[np] = { t: JSON.stringify({ id: 'n1', at: AT(), by: 'person-avery', text: 'Ran it' }) + '\n', m: Date.now() };
    await toParent(app); await refresh(app, 300);
    assert.ok(/data-act="td-evidence"/.test(app.html()), how + ': set-up: Accept offered');
    const fs = app.fs, read = fs.read.bind(fs), list = fs.list.bind(fs);
    if (how === 'wb-null') fs.read = (p, ...a) => p === np ? Promise.resolve(null) : read(p, ...a);
    else { delete fs.files[np]; fs.list = (p, ...a) => list(p, ...a).then((items) => p === dir ? items.concat([{ name: 'notes-w9.jsonl', kind: 'link' }]) : items); }
    await refresh(app, 400); await toParent(app); await refresh(app, 400);
    assert.ok(!/data-act="td-evidence"/.test(app.html()), how + ': no Accept: ' + txt(app.html()).slice(0, 800));
    fs.read = read; fs.list = list;
  }
});

run();
