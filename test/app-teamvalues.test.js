// Team values (2.9) in the app: Settings › Team values, the builder's "A team value", and a child's start that passes one.
'use strict';
const assert = require('assert');
const { rule, run, example } = require('./harness');
const { boot, folderHandle, memoryIDB } = require('./app-harness');
const doc = (values) => JSON.stringify({ format: 'flightdeck-team-values/1', values }, null, 2) + '\n';
const URL = 'https://bitbucket.example.com/projects/PAY';

async function settingsAs(person, files) {
  const dir = folderHandle('Team', files);
  const app = boot({ picker: dir, indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.choose(person); await app.tick();
  app.click('nav', 'settings'); await app.tick();
  app.dir = dir;
  return app;
}

rule('App: Settings › Team values: the owner adds one (trimmed), edits and removes it; the warning is always shown', async () => {
  const files = { 'people.json': example('people.json') }, app = await settingsAs('person-avery', files);
  let html = app.html();
  assert.ok(/Team values · 0/.test(html) && /Don&#39;t store passwords or tokens here|Don't store passwords or tokens here/.test(html), 'the panel and its warning');
  assert.ok(/id="team-add-form"/.test(html));
  app.input('tv-name', 'bitbucket-base-url'); app.input('tv-value', '  ' + URL + '  '); app.input('tv-about', ' Bitbucket base URL '); await app.tick();
  app.submit('team-add-form'); await app.tick(200);
  assert.deepStrictEqual(JSON.parse(files['team-values.json']), { format: 'flightdeck-team-values/1', values: { 'bitbucket-base-url': { value: URL, about: 'Bitbucket base URL' } } });
  assert.ok(/Team values · 1/.test(app.html()) && /Added the team value bitbucket-base-url/.test(app.html()));
  app.click('team-edit', 'bitbucket-base-url'); await app.tick();
  app.input('tv-e-value', URL + '/repos'); await app.tick();
  app.submit('team-edit-form'); await app.tick(200);
  assert.strictEqual(JSON.parse(files['team-values.json']).values['bitbucket-base-url'].value, URL + '/repos');
  app.click('pick', 'bitbucket-base-url', { kind: 'team-remove' }); await app.tick();
  assert.ok(/Steps that pass it ask for it when their run starts/.test(app.html()));
  app.click('team-remove', 'bitbucket-base-url'); await app.tick(200);
  assert.deepStrictEqual(JSON.parse(files['team-values.json']).values, {});
});

rule('App: Settings › Team values refuses a bad name, a duplicate and an empty value next to the box, writing nothing', async () => {
  const files = { 'people.json': example('people.json'), 'team-values.json': doc({ base: { value: 'x' } }) }, app = await settingsAs('person-avery', files), before = files['team-values.json'];
  app.input('tv-name', 'Bad Name'); app.input('tv-value', 'v'); await app.tick(); app.submit('team-add-form'); await app.tick(100);
  assert.ok(/Use lowercase letters, digits and -/.test(app.html()) && /aria-invalid="true" aria-describedby="ferr-tv-name"/.test(app.html()));
  app.input('tv-name', 'base'); await app.tick(); app.submit('team-add-form'); await app.tick(100);
  assert.ok(/There&#39;s already a team value named base|There's already a team value named base/.test(app.html()));
  app.input('tv-name', 'other'); app.input('tv-value', '   '); await app.tick(); app.submit('team-add-form'); await app.tick(100);
  assert.ok(/The value is empty/.test(app.html()));
  assert.strictEqual(files['team-values.json'], before, 'nothing written');
});

rule('App: Settings › Team values: a file changed since the page was drawn is never saved over; the change made again goes through', async () => {
  const files = { 'people.json': example('people.json'), 'team-values.json': doc({ base: { value: 'one' } }) }, app = await settingsAs('person-avery', files);
  files['team-values.json'] = doc({ base: { value: 'one' }, theirs: { value: 'two' } });
  const theirs = files['team-values.json'];
  app.click('pick', 'base', { kind: 'team-remove' }); await app.tick(); app.click('team-remove', 'base'); await app.tick(200);
  assert.strictEqual(files['team-values.json'], theirs, 'refused');
  assert.ok(/changed since this page was drawn/.test(app.html()) && /theirs/.test(app.html()), 'says so and shows the list as it is now');
  app.click('pick', 'base', { kind: 'team-remove' }); await app.tick(); app.click('team-remove', 'base'); await app.tick(200);
  assert.deepStrictEqual(Object.keys(JSON.parse(files['team-values.json']).values), ['theirs']);
});

rule('App: Settings › Team values: an Edit open across a Refresh never saves the old value over a newer one', async () => {
  const files = { 'people.json': example('people.json'), 'team-values.json': doc({ base: { value: 'one', about: 'old' } }) }, app = await settingsAs('person-avery', files);
  app.click('team-edit', 'base'); await app.tick();
  app.input('tv-e-about', 'new words'); await app.tick();
  files['team-values.json'] = doc({ base: { value: 'two', about: 'old' } });
  const theirs = files['team-values.json'];
  app.click('refresh'); await app.tick(200);
  app.submit('team-edit-form'); await app.tick(200);
  assert.strictEqual(files['team-values.json'], theirs, 'refused: the value the backup owner set stays');
  assert.ok(/changed since you opened Edit/.test(app.html()) && /id="team-edit-form"/.test(app.html()), 'says so and keeps the form open');
  app.submit('team-edit-form'); await app.tick(200);
  assert.deepStrictEqual(JSON.parse(files['team-values.json']).values.base, { value: 'one', about: 'new words' }, 'saved again on purpose: what the form showed');
});

rule('App: Settings › Team values is read-only for a member, for a damaged file and for a key this copy doesn\'t know; text is escaped', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const files = { 'people.json': example('people.json'), 'team-values.json': doc({ base: { value: evil, about: evil } }) };
  const app = await settingsAs('person-casey', files);
  let html = app.html();
  assert.ok(/Team values · 1/.test(html) && !/team-add-form|data-act="team-edit"/.test(html), 'a member only reads');
  assert.ok(!html.includes(evil) && html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'escaped');
  assert.ok(/Avery Lee \(folder owner\) and Blake Ortiz \(backup owner\) change these/.test(html), String(html.match(/[^>]*Ask them[^<]*/)));
  app.choose('person-avery'); await app.tick();
  files['team-values.json'] = '{'; app.click('refresh'); await app.tick(200);
  html = app.html();
  assert.ok(/isn&#39;t valid JSON|isn't valid JSON/.test(html) && /Nothing here can be changed until it reads again/.test(html) && !/team-add-form/.test(html), 'damaged: said, nothing editable');
  files['team-values.json'] = JSON.stringify({ format: 'flightdeck-team-values/1', values: { base: { value: 'x' } }, extra: 1 });
  app.click('refresh'); await app.tick(200);
  html = app.html();
  assert.ok(/has &quot;extra&quot;|has "extra"/.test(html) && !/team-add-form/.test(html), 'an unknown key: read-only with the reason');
  files['team-values.json'] = doc({ base: { value: 'production', color: 'red' } });
  app.click('refresh'); await app.tick(200);
  html = app.html();
  assert.ok(/Team values · 1/.test(html) && /production/.test(html), 'an unknown key in a value: its values still shown');
  assert.ok(/has &quot;color&quot;|has "color"/.test(html) && !/team-add-form|data-act="team-edit"/.test(html), 'and read-only with the reason');
});

/* ---------- A child's start that passes a team value (F4) ---------- */
const { gate } = require('./app-harness');
async function teamStart(passLine, kidCtx, values, kidRoles) {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-casey'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const put = (md, id, rand) => {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '2.9.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  };
  put(['---', 'process: deploy', 'title: Deploy', 'owner: person-avery', 'context: ' + (kidCtx || 'base, env'), ...(kidRoles ? ['roles: ' + kidRoles] : []), '---', '', '## Go · READ-DO {#go}', '- [ ] {confirm} Go {#go1}'].join('\n'), 'deploy', 'dp000001');
  put(['---', 'process: ship', 'title: Ship', 'owner: person-avery', 'context: env', '---', '', '## Ship · READ-DO {#s}', '  > Ship it with care.', '- [ ] {run.process} Deploy it {#dep}', '  process: deploy', '  pass: ' + (passLine || 'base=team:bitbucket-base-url, env=^env'), '- [ ] {confirm} Tell the team {#tell}'].join('\n'), 'ship', 'sh000001');
  if (values !== null) setTeam(app, values || { 'bitbucket-base-url': { value: URL } });
  app.click('refresh'); await app.tick(80);
  app.click('start', 'ship'); await app.settle();
  app.set('detail-env', 'prod'); app.submitForm('start-form'); await app.tick(120);
  assert.ok(/<h1 id="run-h"[^>]*>Ship/.test(app.html()), 'set-up: the parent run is open');
  return app;
}
const setTeam = (app, values) => { app.fs.files['team-values.json'] = { t: typeof values === 'string' ? values : doc(values), m: Date.now() }; };
const shipRun = (app) => JSON.parse(app.fs.files[app.files('runs/ship/').find(p => /run\.json$/.test(p))].t);
const deployRuns = (app) => app.files('runs/deploy/').filter(p => /run\.json$/.test(p)).map(p => JSON.parse(app.fs.files[p].t));
async function endKid(app, edit) {
  const path = app.files('runs/deploy/').find(p => /run\.json$/.test(p)), kid = JSON.parse(app.fs.files[path].t);
  if (edit) Object.assign(kid.details, edit);
  kid.ended = { outcome: 'Completed', by: 'person-avery', at: new Date().toISOString() }; kid.state = 'completed'; kid.rev = (kid.rev || 0) + 1;
  await app.fs.write(path, JSON.stringify(kid));
  app.click('refresh'); await app.tick(100);
}

rule('App: a set team value is passed as it reads when the child starts, recorded on the link, and the step is checked when the child completes', async () => {
  const app = await teamStart();
  assert.ok(/base https:\/\/bitbucket\.example\.com\/projects\/PAY \(team value bitbucket-base-url\)/.test(app.html()), 'the step names where it comes from');
  app.click('start-child', 'dep'); await app.tick(150);
  assert.ok(!/child-start-form/.test(app.overlay()), 'nothing to ask: it starts at once');
  const kids = deployRuns(app);
  assert.deepStrictEqual(kids.map(k => k.details), [{ base: URL, env: 'prod' }]);
  assert.deepStrictEqual(kids[0].parent.inputs, { env: 'prod' }, 'team values stay out of the snapshot');
  const link = shipRun(app).steps.dep.child;
  assert.deepStrictEqual(link.teamPassed, { base: { text: URL } });
  assert.ok(!('base' in link.inputs));
  setTeam(app, { 'bitbucket-base-url': { value: 'https://changed.example.com' } }); app.click('refresh'); await app.tick(100);
  assert.notStrictEqual(shipRun(app).steps.dep.s, 'blocked', 'a later change to the team value changes nothing for a started child');
  await endKid(app);
  assert.strictEqual(shipRun(app).steps.dep.s, 'done');
});

rule('App: a child that changed a team-supplied value blocks the step, like a fixed value', async () => {
  const app = await teamStart();
  app.click('start-child', 'dep'); await app.tick(150);
  await endKid(app, { base: 'https://elsewhere.example.com' });
  const a = shipRun(app).steps.dep;
  assert.strictEqual(a.s, 'blocked'); assert.ok(/base "https:\/\/elsewhere\.example\.com"/.test(a.reason), a.reason);
});

rule('App: a team value that isn\'t set is asked, typed for this run, recorded as typed, and the step completes after a reload', async () => {
  const app = await teamStart(null, null, {});
  app.click('start-child', 'dep'); await app.tick(40);
  const ov = app.overlay();
  assert.ok(/id="cs-base"/.test(ov) && /The team value bitbucket-base-url isn&#39;t set; type it for this run|The team value bitbucket-base-url isn't set; type it for this run/.test(ov), ov.slice(0, 600));
  app.set('cs-base', 'https://typed.example.com'); app.submitForm('child-start-form'); await app.tick(150);
  assert.deepStrictEqual(deployRuns(app).map(k => k.details.base), ['https://typed.example.com']);
  assert.deepStrictEqual(shipRun(app).steps.dep.child.teamPassed, { base: { typed: true } });
  await endKid(app, { base: 'anything' });
  assert.strictEqual(shipRun(app).steps.dep.s, 'done', 'what the person typed is the child\'s own');
});

rule('App: a team-values.json that can\'t be read refuses the start with the reason and writes nothing', async () => {
  const app = await teamStart(null, null, '{');
  app.click('start-child', 'dep'); await app.tick(150);
  assert.strictEqual(deployRuns(app).length, 0);
  assert.ok(/isn&#39;t valid JSON|isn't valid JSON/.test(app.html() + app.live()) && /can.t be read, and nothing was started/.test(app.html() + app.live()), app.live());
});

rule('App: a team value that doesn\'t fit a typed child detail opens as a correction; the correction starts it and counts', async () => {
  const app = await teamStart('replicas=team:replicas, env=^env', 'replicas:number, env', { replicas: { value: 'about 40' } });
  app.click('start-child', 'dep'); await app.tick(40);
  const ov = app.overlay();
  assert.ok(/id="cs-replicas"/.test(ov) && /From the team value replicas\. Before: &quot;about 40&quot;|From the team value replicas\. Before: "about 40"/.test(ov), ov.slice(0, 900));
  app.set('cs-replicas', '40'); app.submitForm('child-start-form'); await app.tick(150);
  const kid = deployRuns(app)[0];
  assert.strictEqual(kid.details.replicas, '40');
  assert.ok(kid.migrations.some(m => m.path === 'details.replicas' && m.from === 'about 40' && m.resolved && m.resolved.value === '40'), JSON.stringify(kid.migrations));
  assert.deepStrictEqual(shipRun(app).steps.dep.child.teamPassed, { replicas: { text: 'about 40' } });
  await endKid(app);
  assert.strictEqual(shipRun(app).steps.dep.s, 'done', 'the correction counts as the same value');
});

rule('App: a team value changed while the form is open refuses the submit, and the form reopens with the new value and the answers kept', async () => {
  const app = await teamStart('base=team:bitbucket-base-url, env=^env, note=?', 'base, env, note');
  app.click('start-child', 'dep'); await app.tick(40);
  app.input('cs-note', 'hello'); await app.tick();
  setTeam(app, { 'bitbucket-base-url': { value: 'https://new.example.com' } }); app.click('refresh'); await app.tick(100);
  app.submitForm('child-start-form'); await app.tick(150);
  assert.strictEqual(deployRuns(app).length, 0, 'nothing written');
  const ov = app.overlay();
  assert.ok(/The team value bitbucket-base-url changed while you were filling this in/.test(ov) && /https:\/\/new\.example\.com/.test(ov), ov.slice(0, 900));
  assert.ok(/id="cs-note"[^>]*value="hello"/.test(ov), 'the answer is kept');
  app.submitForm('child-start-form'); await app.tick(150);
  assert.deepStrictEqual(deployRuns(app).map(k => k.details), [{ base: 'https://new.example.com', env: 'prod', note: 'hello' }]);
  assert.deepStrictEqual(shipRun(app).steps.dep.child.teamPassed, { base: { text: 'https://new.example.com' } });
});

rule('App: a team value changed while the child is saving is caught by the read right before the write; the reopened form starts with the new value', async () => {
  const app = await teamStart('base=team:bitbucket-base-url, env=^env, note=?', 'base, env, note');
  app.click('start-child', 'dep'); await app.tick(40);
  const fsr = app.fs.read.bind(app.fs), g = gate(); let held = false;
  app.fs.read = function (p) { if (!held && /^runs\/deploy\//.test(p)) { held = true; return g.p.then(() => fsr(p)); } return fsr(p); };
  app.set('cs-note', 'n1'); app.submitForm('child-start-form'); await app.tick(40);
  assert.ok(held, 'set-up: the save is in its read');
  setTeam(app, { 'bitbucket-base-url': { value: 'https://during.example.com' } });
  g.open(); await app.tick(150);
  app.fs.read = fsr;
  assert.strictEqual(deployRuns(app).length, 0, 'nothing written');
  const ov = app.overlay();
  assert.ok(/The team value bitbucket-base-url changed while you were filling this in/.test(ov) && /during\.example\.com/.test(ov), ov.slice(0, 900));
  app.submitForm('child-start-form'); await app.tick(150);
  assert.deepStrictEqual(deployRuns(app).map(k => k.details.base), ['https://during.example.com'], 'no refresh needed: the read before the write is the one kept');
});

rule('App: a missing team value typed, then set before the submit: the form says the team value is used instead, and starts with it', async () => {
  const app = await teamStart(null, null, {});
  app.click('start-child', 'dep'); await app.tick(40);
  app.input('cs-base', 'https://typed.example.com'); await app.tick();
  setTeam(app, { 'bitbucket-base-url': { value: URL } }); app.click('refresh'); await app.tick(100);
  app.submitForm('child-start-form'); await app.tick(150);
  assert.strictEqual(deployRuns(app).length, 0);
  const ov = app.overlay();
  assert.ok(/You typed https:\/\/typed\.example\.com; the team value bitbucket-base-url is now https:\/\/bitbucket\.example\.com\/projects\/PAY, and that&#39;s what will be used|and that's what will be used/.test(ov), ov.slice(0, 900));
  assert.ok(!/id="cs-base"/.test(ov), 'no box for it now');
  app.submitForm('child-start-form'); await app.tick(150);
  assert.deepStrictEqual(deployRuns(app).map(k => k.details.base), [URL]);
  assert.deepStrictEqual(shipRun(app).steps.dep.child.teamPassed, { base: { text: URL } });
});

rule('App: a team value is escaped wherever the run and the start form show it', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const app = await teamStart('base=team:bitbucket-base-url, env=^env, note=?', 'base, env, note', { 'bitbucket-base-url': { value: evil } });
  assert.ok(!app.html().includes(evil) && app.html().includes('&lt;img src=x onerror=alert(1)&gt;'));
  app.click('start-child', 'dep'); await app.tick(40);
  const ov = app.overlay();
  assert.ok(!ov.includes(evil) && ov.includes('&lt;img src=x onerror=alert(1)&gt;'), 'escaped in the form');
});

/* ---------- Link it on a step that passes team values ---------- */
async function lostLink(kidEdit, end) {
  const app = await teamStart();
  app.click('start-child', 'dep'); await app.tick(150);
  const sp = app.files('runs/ship/').find(p => /run\.json$/.test(p)), ship = JSON.parse(app.fs.files[sp].t);
  delete ship.steps.dep; ship.rev = (ship.rev || 0) + 1;
  await app.fs.write(sp, JSON.stringify(ship));
  const kp = app.files('runs/deploy/').find(p => /run\.json$/.test(p)), kid = JSON.parse(app.fs.files[kp].t);
  if (kidEdit) Object.assign(kid.details, kidEdit);
  if (end) { kid.ended = { outcome: 'Completed', by: 'person-avery', at: new Date().toISOString() }; kid.state = 'completed'; }
  kid.rev = (kid.rev || 0) + 1;
  await app.fs.write(kp, JSON.stringify(kid));
  app.click('refresh'); await app.tick(120);
  return { app, kp, key: 'deploy/' + kid.id };
}

rule('App: a lost link to a completed child is still offered; Link it shows the child\'s team values and links them as confirmed; the step is checked', async () => {
  const { app, key } = await lostLink(null, true);
  assert.ok(!shipRun(app).steps.dep || !shipRun(app).steps.dep.child, 'set-up: the link is gone');
  assert.ok(/was started for this step but isn&#39;t linked|was started for this step but isn't linked/.test(app.html()), 'offered: the team rows are left out of discovery');
  app.click('link-child', 'dep', { child: key }); await app.tick(40);
  const ov = app.overlay();
  assert.ok(/didn&#39;t record what it was passed|didn't record what it was passed/.test(ov) && ov.includes(URL) && /team value bitbucket-base-url/.test(ov), ov.slice(0, 800));
  assert.ok(!shipRun(app).steps.dep || !shipRun(app).steps.dep.child, 'nothing linked before confirming');
  app.click('link-child-confirm'); await app.tick(150);
  const a = shipRun(app).steps.dep;
  assert.strictEqual(a.child.teamPassed.base.text, URL);
  assert.strictEqual(a.child.teamPassed.base.confirmed.by, 'person-casey');
  assert.ok(shipRun(app).log.some(l => /Confirmed base of that run as the team values it was meant to get/.test(l.what)), 'the run says who confirmed it');
  app.click('refresh'); await app.tick(120);
  assert.strictEqual(shipRun(app).steps.dep.s, 'done');
});

rule('App: Link it\'s confirm redraws when the child changes while it\'s open and links nothing until confirmed again; Cancel links nothing', async () => {
  const { app, kp, key } = await lostLink(null, false);
  app.click('link-child', 'dep', { child: key }); await app.tick(40);
  app.key('Escape'); await app.tick();
  assert.ok(!shipRun(app).steps.dep || !shipRun(app).steps.dep.child, 'Cancel links nothing');
  app.click('link-child', 'dep', { child: key }); await app.tick(40);
  const kid = JSON.parse(app.fs.files[kp].t); kid.details.base = 'https://other.example.com'; kid.rev = (kid.rev || 0) + 1;
  await app.fs.write(kp, JSON.stringify(kid));
  app.click('refresh'); await app.tick(120);
  app.click('link-child-confirm'); await app.tick(80);
  const ov = app.overlay();
  assert.ok(/This run changed while you were looking\. Check the values again\./.test(ov) && /other\.example\.com/.test(ov), ov.slice(0, 800));
  assert.ok(!shipRun(app).steps.dep || !shipRun(app).steps.dep.child, 'nothing linked yet');
  app.click('link-child-confirm'); await app.tick(150);
  assert.strictEqual(shipRun(app).steps.dep.child.teamPassed.base.text, 'https://other.example.com', 'exactly what was shown');
});

rule('App: confirmed while the child runs, then the child changes the value and completes: the step is Blocked', async () => {
  const { app, kp, key } = await lostLink(null, false);
  app.click('link-child', 'dep', { child: key }); await app.tick(40);
  app.click('link-child-confirm'); await app.tick(150);
  assert.strictEqual(shipRun(app).steps.dep.child.teamPassed.base.text, URL);
  const kid = JSON.parse(app.fs.files[kp].t); kid.details.base = 'https://edited.example.com';
  kid.ended = { outcome: 'Completed', by: 'person-avery', at: new Date().toISOString() }; kid.state = 'completed'; kid.rev = (kid.rev || 0) + 1;
  await app.fs.write(kp, JSON.stringify(kid));
  app.click('refresh'); await app.tick(150);
  assert.strictEqual(shipRun(app).steps.dep.s, 'blocked');
});

/* ---------- The retry path and which read counts ---------- */
/* Holds the next read of a path matching re until the gate opens; the read itself happens now (so it sees the file as it
   is now) unless late, when it reads only once the gate opens. */
function holdRead(app, re, late) {
  const fsr = app.fs.read.bind(app.fs), g = gate(); let held = false;
  app.fs.read = function (p, o) { if (!held && re.test(p)) { held = true; if (late) return g.p.then(() => fsr(p, o)); const res = fsr(p, o); return g.p.then(() => res); } return fsr(p, o); };
  return { g, held: () => held, restore: () => { app.fs.read = fsr; } };
}

rule('App: a refused start doesn\'t reopen its form after the person changed steps or opened another dialog; the answers come back on the next start', async () => {
  for (const move of ['step', 'dialog']) {
    const app = await teamStart('base=team:bitbucket-base-url, env=^env, note=?', 'base, env, note');
    app.click('start-child', 'dep'); await app.tick(40);
    const h = holdRead(app, /^runs\/deploy\//, true);
    app.set('cs-note', 'kept'); app.submitForm('child-start-form'); await app.tick(40);
    assert.ok(h.held(), move + ': set-up: the save is in its read');
    setTeam(app, { 'bitbucket-base-url': { value: 'https://moved.example.com' } });
    if (move === 'step') { app.click('select', 'tell'); await app.tick(40); }
    else { app.keyOn('k', { ctrlKey: true }); await app.tick(40); }
    h.g.open(); await app.tick(150); h.restore();
    assert.strictEqual(deployRuns(app).length, 0, move + ': nothing written');
    assert.ok(!/child-start-form/.test(app.overlay()), move + ': not reopened');
    assert.ok(/kept for when you start it again/.test(app.html() + app.live()), move + ': says so');
    if (move === 'dialog') { app.key('Escape'); await app.tick(); }
    app.click('start-child', 'dep'); await app.tick(40);
    const ov = app.overlay();
    assert.ok(/id="cs-note"[^>]*value="kept"/.test(ov) && /moved\.example\.com/.test(ov), move + ': the answers come back with the new value: ' + ov.slice(0, 600));
  }
});

rule('App: a start refused in the queue (a team value refreshed while an earlier save held it) reopens its form like any other refusal', async () => {
  const app = await teamStart('base=team:bitbucket-base-url, env=^env, note=?', 'base, env, note');
  const h = holdRead(app, /^runs\/ship\//, true);
  app.click('edit', 'detail:env'); app.set('edit-input', 'prod'); app.click('save-edit'); await app.tick(40);
  assert.ok(h.held(), 'set-up: an earlier save holds the queue');
  app.click('start-child', 'dep'); await app.tick(40);
  app.set('cs-note', 'queued'); app.submitForm('child-start-form'); await app.tick(40);
  setTeam(app, { 'bitbucket-base-url': { value: 'https://queued.example.com' } }); app.click('refresh'); await app.tick(100);
  // A menu the app closes itself fires a toggle; that isn't the person moving on.
  app.fire('toggle', { target: { dataset: { disc: 'rw-menu' }, open: false } }); await app.tick();
  h.g.open(); await app.tick(200); h.restore();
  assert.strictEqual(deployRuns(app).length, 0, 'nothing written');
  const ov = app.overlay();
  assert.ok(/child-start-form/.test(ov) && /queued\.example\.com/.test(ov) && /id="cs-note"[^>]*value="queued"/.test(ov), 'reopened with the new value and the answer: ' + ov.slice(0, 600));
});

rule('App: a refused start doesn\'t reopen its form after the person did anything but Refresh while it saved (a detail\'s Edit, Fill in, Blocked by its key, a correction, a phase note\'s correction, Details, Escape, the Phase selector, the More menu)', async () => {
  for (const move of ['edit', 'pick', 'block-key', 'correct-key', 'note-correct', 'details', 'escape', 'phase-select', 'more-menu']) {
    const app = await teamStart('base=team:bitbucket-base-url, env=^env, note=?', 'base, env, note');
    app.click('start-child', 'dep'); await app.tick(40);
    const h = holdRead(app, /^runs\/deploy\//, true);
    app.set('cs-note', 'kept'); app.submitForm('child-start-form'); await app.tick(40);
    assert.ok(h.held(), move + ': set-up: the save is in its read');
    setTeam(app, { 'bitbucket-base-url': { value: 'https://moved.example.com' } });
    if (move === 'edit') {
      app.click('run-details'); await app.tick();
      assert.ok(/data-act="edit" data-id="detail:env"/.test(app.html()), 'set-up: the detail\'s Edit is shown');
      app.click('edit', 'detail:env'); await app.tick();
      assert.ok(/id="edit-input"/.test(app.html()), 'set-up: its form is open');
      app.click('unedit'); await app.tick();
    }
    else if (move === 'details') { app.click('run-details'); await app.tick(); app.click('run-details'); await app.tick(); }
    else if (move === 'escape') { app.key('Escape'); await app.tick(); }
    else if (move === 'phase-select') {
      assert.ok(/id="rw-phase"/.test(app.html()), 'set-up: the Phase selector is shown');
      app.select('rw-phase', 's'); await app.tick();
    }
    else if (move === 'more-menu') { app.fire('click', { target: { closest: () => null, tagName: 'SUMMARY' } }); await app.tick(); }
    else if (move === 'pick') { app.click('pick', 'tell', { kind: 'fields' }); await app.tick(); app.click('unpick'); await app.tick(); }
    else if (move === 'block-key') { app.click('select', 'dep'); await app.tick(); app.key('b'); await app.tick(); assert.ok(/data-scope="block:dep"/.test(app.html()), 'set-up: Blocked is open'); app.key('Escape'); await app.tick(); }
    else if (move === 'correct-key') { app.click('select', 'dep'); await app.tick(); app.key('c'); await app.tick(); app.click('corr-cancel'); await app.tick(); }
    else {
      assert.ok(/data-act="nc-open"[^>]*data-id="s"|data-id="s"[^>]*data-act="nc-open"/.test(app.html()), 'set-up: the phase note\'s correction is offered');
      app.click('nc-open', 's', { kind: 'phase' }); await app.tick();
      assert.ok(/id="nc-to-phase-s"/.test(app.html()), 'set-up: its form is open');
      app.click('nc-cancel', 's', { kind: 'phase' }); await app.tick();
    }
    h.g.open(); await app.tick(150); h.restore();
    assert.strictEqual(deployRuns(app).length, 0, move + ': nothing written');
    assert.ok(!/child-start-form/.test(app.overlay()), move + ': not reopened');
    assert.ok(/kept for when you start it again/.test(app.html() + app.live()), move + ': says so');
  }
});

rule('App: answers and roles kept from a refused start come back in the form on the next start, even when nothing needs asking now', async () => {
  const app = await teamStart('base=team:bitbucket-base-url, env=^env', 'base, env', {}, 'operator');
  app.click('start-child', 'dep'); await app.tick(40);
  assert.ok(/id="cs-base"/.test(app.overlay()), 'set-up: the missing team value is asked');
  app.set('cs-base', 'https://typed.example.com'); app.set('cs-role-operator', 'person-morgan');
  const h = holdRead(app, /^runs\/deploy\//, true);
  app.submitForm('child-start-form'); await app.tick(40);
  assert.ok(h.held(), 'set-up: the save is in its read');
  setTeam(app, { 'bitbucket-base-url': { value: URL } }); app.click('refresh'); await app.tick(60);
  app.keyOn('k', { ctrlKey: true }); await app.tick(40);
  h.g.open(); await app.tick(150); h.restore();
  assert.strictEqual(deployRuns(app).length, 0, 'nothing written');
  app.key('Escape'); await app.tick();
  app.click('start-child', 'dep'); await app.tick(40);
  const ov = app.overlay();
  assert.ok(/child-start-form/.test(ov) && /id="cs-role-operator"[\s\S]*value="person-morgan" selected|id="cs-role-operator"[^>]*value="person-morgan"/.test(ov), 'the form, with the role kept: ' + ov.slice(0, 900));
  app.submitForm('child-start-form'); await app.tick(150);
  const kid = deployRuns(app)[0];
  assert.strictEqual(kid.roles.operator, 'person-morgan', 'started with the role chosen before');
  assert.strictEqual(kid.details.base, URL, 'and the team value now set');
});

rule('App: a start refused in the queue because the parent was paused keeps where each answer came from; after Resume a typed value whose team value is now set but doesn\'t convert says so', async () => {
  const app = await teamStart('replicas=team:replicas, env=^env', 'replicas:number, env', {});
  const h = holdRead(app, /^runs\/ship\//, true);
  app.click('edit', 'detail:env'); app.set('edit-input', 'prod'); app.click('save-edit'); await app.tick(40);
  assert.ok(h.held(), 'set-up: an earlier save holds the queue');
  app.click('start-child', 'dep'); await app.tick(40);
  app.set('cs-replicas', '5'); app.submitForm('child-start-form'); await app.tick(40);
  app.click('pick', 'run', { kind: 'pause' }); await app.tick();
  app.set('pick-input', 'Waiting'); app.click('pause', 'run'); await app.tick(40);
  h.g.open(); await app.tick(200); h.restore();
  assert.strictEqual(deployRuns(app).length, 0, 'nothing written');
  app.key('Escape'); await app.tick();
  app.click('resume', 'run'); await app.tick(80);
  setTeam(app, { replicas: { value: 'about 40' } }); app.click('refresh'); await app.tick(100);
  app.click('start-child', 'dep'); await app.tick(40);
  const ov = app.overlay();
  assert.ok(/You typed 5 before/.test(ov) && /id="cs-replicas"[^>]*value=""/.test(ov), 'the typed-before note, the box empty: ' + ov.slice(0, 900));
});

rule('App: a start with nothing to ask, refused in the queue because the parent was paused, comes back in the form with the team value as it is now', async () => {
  const app = await teamStart();
  const h = holdRead(app, /^runs\/ship\//, true);
  app.click('edit', 'detail:env'); app.set('edit-input', 'prod'); app.click('save-edit'); await app.tick(40);
  assert.ok(h.held(), 'set-up: an earlier save holds the queue');
  app.click('start-child', 'dep'); await app.tick(40);
  assert.ok(!/child-start-form/.test(app.overlay()), 'set-up: nothing to ask, so no form');
  app.click('pick', 'run', { kind: 'pause' }); await app.tick();
  app.set('pick-input', 'Waiting'); app.click('pause', 'run'); await app.tick(40);
  h.g.open(); await app.tick(200); h.restore();
  assert.strictEqual(deployRuns(app).length, 0, 'nothing written');
  app.key('Escape'); await app.tick();
  app.click('resume', 'run'); await app.tick(80);
  setTeam(app, { 'bitbucket-base-url': { value: 'https://after.example.com' } }); app.click('refresh'); await app.tick(100);
  app.click('start-child', 'dep'); await app.tick(40);
  const ov = app.overlay();
  assert.ok(/child-start-form/.test(ov) && /after\.example\.com/.test(ov), 'the form, with the value as it is now: ' + ov.slice(0, 600));
  app.submitForm('child-start-form'); await app.tick(150);
  assert.deepStrictEqual(deployRuns(app).map(k => k.details.base), ['https://after.example.com']);
});

rule('App: a start whose save fails keeps its answers with where each came from: a typed value whose team value is now set but doesn\'t convert says so, and a start with nothing to ask comes back in the form', async () => {
  const failOnce = (app) => { const fsr = app.fs.read.bind(app.fs); let failed = false; app.fs.read = function (p, o) { if (!failed && /^runs\/deploy\//.test(p)) { failed = true; return Promise.reject(new Error('disk said no')); } return fsr(p, o); }; return () => { app.fs.read = fsr; }; };
  let app = await teamStart('replicas=team:replicas, env=^env', 'replicas:number, env', {});
  app.click('start-child', 'dep'); await app.tick(40);
  let restore = failOnce(app);
  app.set('cs-replicas', '5'); app.submitForm('child-start-form'); await app.tick(150); restore();
  assert.strictEqual(deployRuns(app).length, 0, 'typed: nothing written');
  assert.ok(/disk said no/.test(app.html() + app.live() + app.overlay()), 'typed: says why');
  app.key('Escape'); await app.tick();
  setTeam(app, { replicas: { value: 'about 40' } }); app.click('refresh'); await app.tick(100);
  app.click('start-child', 'dep'); await app.tick(40);
  assert.ok(/You typed 5 before/.test(app.overlay()), 'typed: the note: ' + app.overlay().slice(0, 600));
  app = await teamStart();
  restore = failOnce(app);
  app.click('start-child', 'dep'); await app.tick(150); restore();
  assert.strictEqual(deployRuns(app).length, 0, 'nothing to ask: nothing written');
  setTeam(app, { 'bitbucket-base-url': { value: 'https://later.example.com' } }); app.click('refresh'); await app.tick(100);
  app.click('start-child', 'dep'); await app.tick(40);
  assert.ok(/child-start-form/.test(app.overlay()) && /later\.example\.com/.test(app.overlay()), 'nothing to ask: the form, with the value as it is now');
});

rule('App: Settings › Team values: a save that finishes after its form was closed never closes or empties another form', async () => {
  const files = { 'people.json': example('people.json'), 'team-values.json': doc({ a: { value: 'one' }, b: { value: 'two' } }) }, app = await settingsAs('person-avery', files);
  const gfh = app.dir.getFileHandle, g = gate(); let held = false;
  app.dir.getFileHandle = function (n, o) {
    return gfh.call(this, n, o).then(h => n !== 'team-values.json' ? h : Object.assign({}, h, { createWritable: (wo) => h.createWritable(wo).then(w => Object.assign({}, w, { close: () => { if (held) return w.close(); held = true; return g.p.then(() => w.close()); } })) }));
  };
  app.click('team-edit', 'a'); await app.tick(); app.input('tv-e-value', 'uno'); await app.tick();
  app.submit('team-edit-form'); await app.tick(40);
  assert.ok(held, 'set-up: the save is held');
  app.click('team-cancel'); await app.tick();
  app.click('team-edit', 'b'); await app.tick(); app.input('tv-e-value', 'dos'); await app.tick();
  app.input('tv-name', 'c'); await app.tick();
  g.open(); await app.tick(200); app.dir.getFileHandle = gfh;
  const html = app.html();
  assert.ok(/id="team-edit-form"/.test(html) && /id="tv-e-value"[^>]*value="dos"/.test(html), 'B\'s form and its typing stay');
  assert.ok(/id="tv-name"[^>]*value="c"/.test(html), 'and what was typed in Add');
});

rule('App: an older refresh that lands after the read before the write never brings the old team value back', async () => {
  const app = await teamStart('base=team:bitbucket-base-url, env=^env, note=?', 'base, env, note');
  app.click('start-child', 'dep'); await app.tick(40);
  const old = holdRead(app, /^team-values\.json$/, false);
  app.click('refresh'); await app.tick(20);
  assert.ok(old.held(), 'set-up: a refresh read team-values.json (A) and is held');
  old.restore();
  setTeam(app, { 'bitbucket-base-url': { value: 'https://b.example.com' } });
  app.set('cs-note', 'n'); app.submitForm('child-start-form'); await app.tick(150);
  assert.strictEqual(deployRuns(app).length, 0, 'refused: B differs from what the form showed');
  assert.ok(/b\.example\.com/.test(app.overlay()), 'reopened with B');
  old.g.open(); await app.tick(150);
  app.submitForm('child-start-form'); await app.tick(150);
  assert.deepStrictEqual(deployRuns(app).map(k => k.details.base), ['https://b.example.com'], 'the older read (A) was ignored');
});

rule('App: a typed value for a missing team value that is now set but doesn\'t convert opens as a correction; the child records the team value\'s text and the correction', async () => {
  const app = await teamStart('replicas=team:replicas, env=^env', 'replicas:number, env', {});
  app.click('start-child', 'dep'); await app.tick(40);
  app.input('cs-replicas', '5'); await app.tick();
  setTeam(app, { replicas: { value: 'about 40' } }); app.click('refresh'); await app.tick(100);
  app.submitForm('child-start-form'); await app.tick(150);
  const ov = app.overlay();
  assert.ok(/The team value is now &quot;about 40&quot;, which doesn&#39;t fit here\. You typed 5 before\.|The team value is now "about 40", which doesn't fit here\. You typed 5 before\./.test(ov), ov.slice(0, 900));
  assert.ok(/id="cs-replicas"[^>]*value=""/.test(ov), 'the box opens empty');
  app.set('cs-replicas', '40'); app.submitForm('child-start-form'); await app.tick(150);
  const kid = deployRuns(app)[0];
  assert.strictEqual(kid.details.replicas, '40');
  assert.ok(kid.migrations.some(m => m.from === 'about 40' && m.resolved && m.resolved.value === '40'), JSON.stringify(kid.migrations));
  assert.deepStrictEqual(shipRun(app).steps.dep.child.teamPassed, { replicas: { text: 'about 40' } });
});

rule('App: a parent detail changed while the read before the write is in flight is caught by still, with 2.8\'s message', async () => {
  const app = await teamStart('base=team:bitbucket-base-url, env=^env, note=?', 'base, env, note');
  app.click('start-child', 'dep'); await app.tick(40);
  const h = holdRead(app, /^team-values\.json$/, true);
  app.set('cs-note', 'n'); app.submitForm('child-start-form'); await app.tick(40);
  assert.ok(h.held(), 'set-up: the prewrite is reading team-values.json');
  app.key('Escape'); await app.tick();
  app.click('edit', 'detail:env'); app.set('edit-input', 'dev'); app.click('save-edit'); await app.tick(40);
  h.g.open(); await app.tick(150); h.restore();
  assert.strictEqual(deployRuns(app).length, 0, 'nothing written');
  assert.ok(/A detail this run passes changed while you were filling this in/.test(app.html() + app.live() + app.overlay()));
});

run();
