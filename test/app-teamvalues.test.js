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
});

run();
