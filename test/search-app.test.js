// Jira searches in the booted app (2.16, sections 5.3, 5.7, 5.9 and 7): unsaved results stay bound to the search they were
// typed for, Fill in carries that identity, Block with these declines a report only once the block is saved, and a reopened
// or stuck search says why and what to do next.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

const MD = ['---', 'process: rel', 'title: Release check', 'context: version', '---', '', '## Stories · DO-CONFIRM {#stories}',
  '- [!] {jira.search} No open blockers in ^version {#blockers}', '  query: fixVersion = ^version AND priority = Blocker', '  results: none',
  '- [ ] {jira.search} The release has stories {#scope}', '  query: fixVersion = ^version', '  results: at least 1', '',
  '## Gate: Ready {#ready}', ''].join('\n');
const NOW = '2026-11-04T15:00:00.000Z';

async function searching(o) {
  o = o || {};
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, o.boot || {}));
  await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const PF = app.PF, b = PF.publish.build(o.md || MD, { people: [], customTypes: {}, by: 'person-casey', changes: 'First', existing: [], now: NOW, rand: 'abcd1234', app: '2.16.0' });
  assert.ok(!b.blockers, (b.blockers || []).join(' | '));
  for (const n of Object.keys(b.files)) await app.fs.write('publications/rel/' + b.folder + '/' + n, b.files[n]);
  const raw = {}; ['map.md', 'types.json'].forEach(n => { if (b.files[n] != null) raw[n] = new Uint8Array(Buffer.from(b.files[n], 'utf8')); });
  const v = PF.publish.verify(b.folder, b.files, PF.publish.exactOf(raw));
  assert.ok(v.ok, v.why);
  const r = PF.run.create(v, { title: 'Release check 2026.11.0', details: { version: o.version || '2026.11.0' }, roles: {}, by: 'person-casey', session: 'w-other', now: NOW, id: 'run-s1', app: '2.16.0' });
  if (o.edit) o.edit(r, PF);
  await app.fs.write('runs/rel/run-s1/run.json', JSON.stringify(r, null, 2));
  app.click('refresh'); await app.tick(80);
  app.click('open-run', 'rel/run-s1'); await app.tick(40);
  if (!o.noPickup) { app.click('takeover'); await app.tick(60); }
  return app;
}
const runJson = (app) => JSON.parse(app.fs.files['runs/rel/run-s1/run.json'].t);

rule('set-up: a run with Jira searches opens and is recorded here', async () => {
  const app = await searching();
  assert.strictEqual(runJson(app).recorder.person, 'person-casey', 'Casey is recording');
  app.click('select', 'blockers'); await app.tick(40);
  const h = app.html();
  assert.ok(/id="rec-count"/.test(h), 'the results form');
});
const sidNow = (app, id) => { const R = app.PF.run, r = R.sanitize(runJson(app)), m = R.mapOf(r); return R.searchId(r, m, app.PF.map.findStep(m, id).step); };
async function setDetail(app, name, value) { app.click('edit', 'detail:' + name); await app.tick(20); app.set('edit-input', value); app.click('save-edit'); await app.tick(80); }

rule('5.3 (P1): results typed for one search are never saved for another: a detail change drops them with the notice', async () => {
  const app = await searching();
  app.click('select', 'blockers'); await app.tick(40);
  app.set('rec-count', '0');
  await setDetail(app, 'version', '2026.12.0');
  assert.strictEqual(runJson(app).details.version, '2026.12.0', 'set-up: the detail changed');
  assert.ok(app.html().indexOf('Your unsaved results were for version 2026.11.0. Search again.') >= 0, 'the notice, as soon as the search changes');
  app.click('select', 'blockers'); await app.tick(40);
  assert.strictEqual(app.draft('rec-count'), '', 'the box is empty');
  app.click('record', 'blockers'); await app.tick(80);
  const a = runJson(app).steps.blockers;
  assert.ok(!a || a.s !== 'done', 'not saved as done: ' + JSON.stringify(a));
  app.click('record', 'blockers'); await app.tick(80);
  assert.ok(!(runJson(app).steps.blockers && runJson(app).steps.blockers.s === 'done'), 'the old count isn\'t used later either');
  app.set('rec-count', '0'); app.click('record', 'blockers'); await app.tick(80);
  const b = runJson(app).steps.blockers;
  assert.strictEqual(b.s, 'done', 'typed again for this search, it\'s saved');
  assert.strictEqual(b.values.searchId, sidNow(app, 'blockers'));
});
rule('5.2: Fill in saves a search\'s results with the search its form was drawn for, and so does a correction', async () => {
  const app = await searching();
  app.click('select', 'scope'); await app.tick(40);
  app.click('pick', 'scope', { kind: 'fields' }); await app.tick(40);
  assert.ok(/data-act="save-fields" data-id="scope"/.test(app.html()), 'set-up: Fill in is open');
  app.set('rec-count', '3'); app.set('rec-keys', 'PAY-1, PAY-2, PAY-3');
  app.click('save-fields', 'scope'); await app.tick(80);
  const a = runJson(app).steps.scope;
  assert.ok(a && a.values && a.values.count === '3' && a.values.searchId === sidNow(app, 'scope'), JSON.stringify(a) + ' ' + app.html().match(/role="alert"[^<]*<[^<]*/));
  app.set('rec-count', '3'); app.record = null;
  app.click('record', 'scope'); await app.tick(80);
  assert.strictEqual(runJson(app).steps.scope.s, 'done', 'checked');
  app.click('pick', 'scope', { kind: 'fields' }); await app.tick(40);
  app.set('rec-count', '2'); app.set('rec-keys', 'PAY-1, PAY-2');
  app.click('save-fields', 'scope'); await app.tick(80);
  const c = runJson(app).steps.scope;
  assert.deepStrictEqual([c.s, c.values.count, c.values.keys, c.values.searchId], ['done', '2', 'PAY-1, PAY-2', sidNow(app, 'scope')], 'the correction carries it');
});
function plantReport(app, o) {
  const j = runJson(app), id = o.id || 'abcd1234', step = 'blockers', tool = 'jq';
  const rep = { format: 'flightdeck-report/1', run: 'rel/' + j.id, publication: { folder: j.folder, version: +j.version }, step, verdict: o.verdict || 'fail',
    evidence: Object.assign({ searchId: sidNow(app, step) }, o.evidence), inputs: [{ name: 'Version', value: j.details.version, source: 'detail:version' }],
    producer: { name: tool, version: '1.0.0' }, blockers: o.verdict === 'pass' ? undefined : ['Found blockers'], created: '2026-11-04T15:05:00.000Z', id, summary: 'Searched.' };
  Object.keys(rep).forEach(k => { if (rep[k] === undefined) delete rep[k]; });
  const name = j.id + '.' + step + '.' + tool + '.' + id + '.json';
  return { path: 'reports/rel/' + name, text: JSON.stringify(rep, null, 2) + '\n', key: ['rel', j.id, step, tool, id].join('/') };
}
const decisions = (app) => app.files('report-decisions/rel/').map(p => { try { return JSON.parse(app.fs.files[p].t); } catch (e) { return null; } }).filter(Boolean);
rule('6.3: Block with these is offered only for results R.block takes; a refused or failed block writes no decline', async () => {
  const app = await searching();
  let x = plantReport(app, { evidence: { count: '1' } });
  await app.fs.write(x.path, x.text); app.click('refresh'); await app.tick(80);
  app.click('select', 'blockers'); await app.tick(40);
  assert.ok(!/data-act="rep-block"/.test(app.html()), 'count 1 with no keys can\'t block the step, so it isn\'t offered');
  app.click('rep-block', x.key); await app.tick(80);
  assert.deepStrictEqual(decisions(app), [], 'no decline');
  assert.ok(!(runJson(app).steps.blockers && runJson(app).steps.blockers.s === 'blocked'));
  x = plantReport(app, { id: 'beef5678', evidence: { count: '1', keys: 'PAY-7' } });
  await app.fs.write(x.path, x.text); app.click('refresh'); await app.tick(80);
  app.click('select', 'blockers'); await app.tick(40);
  assert.ok(new RegExp('data-act="rep-block" data-id="' + x.key.replace(/\//g, '\\/') + '"').test(app.html()), 'offered with a key: ' + (app.html().match(/rep-card[\s\S]{0,1500}/g) || []).join('\n---\n').replace(/<[^>]+>/g, ' ').slice(0, 1500));
  const write = app.fs.write.bind(app.fs);
  app.fs.write = (p, t) => p === 'runs/rel/run-s1/run.json' ? Promise.reject(new Error('disk full')) : write(p, t);
  app.click('rep-block', x.key); await app.tick(120);
  assert.deepStrictEqual(decisions(app), [], 'the block didn\'t save, so no decline');
  app.fs.write = write;
  app.click('rep-block', x.key); await app.tick(160);
  assert.strictEqual(runJson(app).steps.blockers.s, 'blocked', 'blocked once saved');
  const ds = decisions(app);
  assert.deepStrictEqual(ds.map(d => [d.status, d.reason]), [['declined', 'Blocked with its results']], JSON.stringify(ds));
});
rule('R14-2: Restore it at the history cap keeps every record: a refused save keeps them all waiting, the next writes each once', async () => {
  let history = [];
  const app = await searching({ edit: (r, PF) => {
    const R = PF.run, m = R.mapOf(r), st = PF.map.findStep(m, 'blockers').step;
    R.done(r, m, 'blockers', 'person-casey', '2026-11-04T15:01:00.000Z', { searchId: R.searchId(r, m, st), count: '0' });
    history = []; for (let i = 0; i < 10; i++) history.push({ s: 'done', by: 'person-casey', at: '2026-11-04T14:' + String(10 + i) + ':00.000Z', values: { searchId: R.searchId(r, m, st), count: '0' } });
    r.steps.blockers.history = history;
  } });
  const path = 'runs/rel/run-s1/run.json', o = JSON.parse(app.fs.files[path].t);
  o.steps.blockers.values.count = '3';
  const local = Object.assign({}, o, { title: 'Kept here', _path: path, _fileHash: 'x', _overflow: [{ id: 'keptaaaa01', kind: 'log', at: NOW, by: 'person-casey', what: 'one' }, { id: 'keptbbbb02', kind: 'log', at: NOW, by: 'person-casey', what: 'two' }] });
  app.store['preflight:unsaved:' + app.fs.kind + ':' + (app.fs.id || app.fs.name) + ':run-s1'] = JSON.stringify(local);
  app.click('nav', 'runs'); await app.tick(); app.click('open-run', 'rel/run-s1'); await app.tick(40);
  assert.ok(/data-act="restore-local"/.test(app.html()), 'set-up: Restore it is offered');
  const histLines = () => app.files('runs/rel/run-s1/history-').map(p => app.fs.files[p].t).join('').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const write = app.fs.write.bind(app.fs), append = app.fs.append.bind(app.fs);
  app.fs.write = (p, t) => p === path ? Promise.reject(new Error('OneDrive is offline')) : write(p, t);
  app.fs.append = (p, t) => /\/history-/.test(p) ? Promise.reject(new Error('OneDrive is offline')) : append(p, t);
  app.click('restore-local'); await app.tick(200);
  assert.deepStrictEqual(histLines(), [], 'the history file gains none');
  assert.ok(app.store['preflight:unsaved:' + app.fs.kind + ':' + (app.fs.id || app.fs.name) + ':run-s1'], 'the browser copy is still kept');
  app.fs.write = write; app.fs.append = append;
  assert.ok(/data-act="retry-save"/.test(app.html()), 'Try again is offered');
  app.click('retry-save'); await app.tick(240);
  const lines = histLines(), ids = lines.map(x => x.id);
  assert.strictEqual(lines.length, 3, JSON.stringify(lines));
  assert.strictEqual(new Set(ids).size, 3, 'each record once');
  assert.ok(ids.indexOf('keptaaaa01') >= 0 && ids.indexOf('keptbbbb02') >= 0, 'the browser copy\'s own records');
  assert.ok(lines.some(x => x.kind === 'answer' && x.step === 'blockers'), 'and the answer the reopen moved out');
  const back = JSON.parse(app.fs.files[path].t);
  assert.strictEqual(back.title, 'Kept here', 'restored');
});
/* ---- Round 3: one stamp on the step's draft, checked by one function at every read, save and render ---- */
const NOTE = 'Your unsaved results were for version 2026.11.0. Search again.';
const stepOf = (app, id) => runJson(app).steps[id] || null;
rule('5.3 (round 3): the inspector: results typed before a detail change are dropped with the notice, never saved', async () => {
  const app = await searching();
  app.click('select', 'scope'); await app.tick(40);
  app.set('rec-count', '2'); app.set('rec-keys', 'PAY-1, PAY-2');
  app.click('select', 'blockers'); await app.tick(40);
  await setDetail(app, 'version', '2026.12.0');
  assert.ok(app.html().indexOf(NOTE) >= 0, 'the notice');
  app.click('select', 'scope'); await app.tick(40);
  assert.deepStrictEqual([app.draft('rec-count'), app.draft('rec-keys')], ['', ''], 'the boxes are empty');
  app.click('record', 'scope'); await app.tick(80);
  assert.ok(!(stepOf(app, 'scope') && stepOf(app, 'scope').s === 'done'), JSON.stringify(stepOf(app, 'scope')));
});
rule('5.3 (round 3): Fill in: results typed in Fill in before a detail change are dropped, whether it stays open or is reopened', async () => {
  for (const reopen of [false, true]) {
    const app = await searching();
    app.click('select', 'scope'); await app.tick(40);
    app.click('pick', 'scope', { kind: 'fields' }); await app.tick(40);
    app.set('rec-count', '3'); app.set('rec-keys', 'PAY-1, PAY-2, PAY-3');
    await setDetail(app, 'version', '2026.12.0');
    assert.ok(app.html().indexOf(NOTE) >= 0, reopen + ': the notice');
    app.click('select', 'scope'); await app.tick(40);
    if (reopen || !/data-act="save-fields" data-id="scope"/.test(app.html())) { app.click('pick', 'scope', { kind: 'fields' }); await app.tick(40); }
    assert.strictEqual(app.draft('rec-count'), '', reopen + ': the box is empty');
    app.click('save-fields', 'scope'); await app.tick(80);
    const a = stepOf(app, 'scope');
    assert.ok(!(a && a.values && a.values.count === '3'), reopen + ': the stale count isn\'t saved: ' + JSON.stringify(a));
    app.click('record', 'scope'); await app.tick(80);
    assert.ok(!(stepOf(app, 'scope') && stepOf(app, 'scope').s === 'done'), reopen + ': not done');
  }
});
rule('5.3 (round 3): Done differently: results typed before a detail change are dropped, never saved with the new search (without the change, it answers)', async () => {
  for (const change of [false, true]) {
    const app = await searching();
    app.click('select', 'blockers'); await app.tick(40);
    app.set('rec-count', '0');
    app.click('corr-open', 'blockers', { mode: 'differently' }); await app.tick(40);
    app.set('corr-happened', 'Checked by hand'); app.input('corr-happened', 'Checked by hand');
    if (change) {
      await setDetail(app, 'version', '2026.12.0');
      assert.ok(app.html().indexOf(NOTE) >= 0, 'the notice');
      app.click('select', 'blockers'); await app.tick(40);
      app.click('corr-open', 'blockers', { mode: 'differently' }); await app.tick(40);
    }
    app.click('corr-done'); await app.tick(150);
    const a = stepOf(app, 'blockers');
    if (change) assert.ok(!(a && a.s === 'done'), JSON.stringify(a));
    else assert.ok(a && a.s === 'done' && a.differently && a.values.searchId === sidNow(app, 'blockers'), 'control: ' + JSON.stringify(a));
  }
});
rule('5.3 (round 3): Block with these: results typed before a detail change are dropped, and nothing is blocked (without the change, it blocks)', async () => {
  for (const change of [false, true]) {
    const app = await searching();
    app.click('select', 'blockers'); await app.tick(40);
    app.set('rec-count', '1'); app.set('rec-keys', 'PAY-9');
    if (change) {
      await setDetail(app, 'version', '2026.12.0');
      assert.ok(app.html().indexOf(NOTE) >= 0, 'the notice');
      app.click('select', 'blockers'); await app.tick(40);
    }
    app.click('search-block', 'blockers'); await app.tick(100);
    const a = stepOf(app, 'blockers');
    if (change) assert.ok(!(a && a.s === 'blocked'), JSON.stringify(a));
    else assert.ok(a && a.s === 'blocked' && a.values.keys === 'PAY-9' && a.values.searchId === sidNow(app, 'blockers'), 'control: ' + JSON.stringify(a));
  }
});
rule('6.3 (round 3): a refused Block with these keeps what was typed; a block that applies clears it', async () => {
  const app = await searching();
  app.click('select', 'blockers'); await app.tick(40);
  app.set('rec-count', '1');
  app.click('search-block', 'blockers'); await app.tick(80);
  assert.ok(!(stepOf(app, 'blockers') && stepOf(app, 'blockers').s === 'blocked'), 'set-up: refused without keys');
  app.click('select', 'scope'); await app.tick(40); app.click('select', 'blockers'); await app.tick(40);
  assert.strictEqual(app.draft('rec-count'), '1', 'the count is still there');
  app.set('rec-keys', 'PAY-9'); app.click('search-block', 'blockers'); await app.tick(120);
  assert.strictEqual(stepOf(app, 'blockers').s, 'blocked');
});

/* R14-8 (round 3): Done on a search reopened in a completed run saves from this window even when the run was recorded in
   another browser session, for its recorder and for whoever ended it; the file's fingerprint is still checked. */
function endedElsewhere(recorder, ender) {
  return (r, PF) => {
    const R = PF.run, map = R.mapOf(r), sid = id => R.searchId(r, map, PF.map.findStep(map, id).step);
    R.done(r, map, 'blockers', recorder, NOW, { count: '0', searchId: sid('blockers') });
    R.done(r, map, 'scope', recorder, NOW, { count: '1', keys: 'PAY-1', searchId: sid('scope') });
    R.pass(r, map, 0, recorder, NOW);
    r.recorder = { person: recorder, session: 'w-other' };
    r.state = 'completed'; r.ended = { outcome: 'Completed', by: ender, byName: 'Ender', at: NOW };
    r.steps.blockers.values.count = '9';
  };
}
rule('R14-8 (round 3): the recorder and the ender, in another browser session, answer a reopened search with Done; it lands in run.json, no conflict copy', async () => {
  for (const [rec, end] of [['person-casey', 'person-casey'], ['person-avery', 'person-casey']]) {
    const app = await searching({ edit: endedElsewhere(rec, end), noPickup: true });
    const before = runJson(app);
    assert.strictEqual(before.state, 'completed', 'set-up');
    app.click('select', 'blockers'); await app.tick(40);
    assert.ok(/data-act="record" data-id="blockers"/.test(app.html()), rec + ': Done is offered');
    app.set('rec-count', '0'); app.click('record', 'blockers'); await app.tick(150);
    const after = runJson(app);
    assert.deepStrictEqual([after.state, after.steps.blockers.s, after.steps.blockers.values.count, after.steps.blockers.values.searchId], ['completed', 'done', '0', sidNow(app, 'blockers')], rec + ': saved: ' + JSON.stringify(after.steps.blockers));
    assert.deepStrictEqual(app.files('runs/rel/run-s1/').filter(p => /conflict/.test(p)), [], rec + ': no conflict copy');
    assert.strictEqual(after.recorder.session, 'w-other', rec + ': the recorder stays as it was');
  }
  /* The fingerprint still holds: the file changed on disk since it was read, so the change is kept as a conflict copy. */
  const app = await searching({ edit: endedElsewhere('person-casey', 'person-casey'), noPickup: true });
  app.click('select', 'blockers'); await app.tick(40);
  const j = runJson(app); j.title = 'Changed elsewhere'; j.rev = (j.rev || 0) + 1; await app.fs.write('runs/rel/run-s1/run.json', JSON.stringify(j));
  app.set('rec-count', '0'); app.click('record', 'blockers'); await app.tick(150);
  assert.strictEqual(runJson(app).title, 'Changed elsewhere', 'not written over');
  assert.ok(app.files('runs/rel/run-s1/').some(p => /conflict/.test(p)), 'kept as a conflict copy');
});

/* ---- Section 7 and Appendix A.3: the editor ---- */
const HEAD = '---\nprocess: release\ntitle: Production release\nowner: person-casey\nroles: lead\ncontext: tag, environment\n---\n\n';
const jmd = (...steps) => HEAD + '## Build · READ-DO {#build}\n' + steps.join('') + '\n';
const jstep = (type, id, ...fields) => '- [ ] {' + type + '} Do ' + id + ' {#' + id + '}\n' + fields.map(f => '  ' + f + '\n').join('');
const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
async function editorOn(text, key, team) {
  const app = boot({}); await app.tick(60); app.choose('person-casey'); await app.tick();
  await app.fs.write('maps/drafts/release.md', text);
  if (team) await app.fs.write('team-values.json', JSON.stringify({ format: 'flightdeck-team-values/1', values: team }));
  app.focus(); await app.tick(80);
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  if (key) { app.click('ob-sel', key); await app.tick(); }
  return app;
}
const formOf = app => {
  const h = app.html(), at = h.indexOf('<section class="panel stack ob-form"'); if (at < 0) return '';
  const re = /<(\/?)section\b/g; re.lastIndex = at; let depth = 0, m;
  while ((m = re.exec(h))) { depth += m[1] ? -1 : 1; if (!depth) return h.slice(at, m.index); }
  return h.slice(at);
};
const choiceRow = (h, id) => [...h.matchAll(new RegExp('<button type="button" role="radio"[^>]*data-act="ob-choice" data-id="' + id + '" data-val="([^"]*)"[^>]*aria-checked="(true|false)"[^>]*>([^<]*)</button>', 'g'))].map(m => [un(m[1]), m[2] === 'true', un(m[3])]);
const choose = (app, id, val) => app.click('ob-choice', id, { val });
const textOf = async app => { app.click('save-draft'); await app.tick(80); return app.fs.files['maps/drafts/release.md'].t; };
const enter = (app, id, value) => { app.set(id, value); app.input(id, value); app.keyOn('Enter', {}, { tagName: 'INPUT', id, value, dataset: { enter: 'ob-commit' }, closest: () => null }); };
const boxes = h => [...h.matchAll(/\sid="ob-fld-([\w-]+)"/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i);

rule('7: What do you do in Jira? gains Search for issues; it switches the type both ways keeping every value; one Undo reverses each switch', async () => {
  const before = jmd(jstep('jira.issue', 'j', 'action: transition', 'issue: PAY-1', 'status: Done'));
  const app = await editorOn(before, 'j');
  let row = choiceRow(formOf(app), 'ob-jira');
  assert.deepStrictEqual(row.map(r => r[2]), ['Create', 'Update', 'Transition', 'Assign', 'Link', 'Search for issues']);
  assert.deepStrictEqual(row.filter(r => r[1]).map(r => r[0]), ['transition'], 'the action is checked');
  assert.ok(formOf(app).indexOf('id="q-ob-jira">What do you do in Jira?') >= 0, 'its question');
  assert.ok(!boxes(formOf(app)).includes('action'), 'the action is the switch, not a second control');
  choose(app, 'ob-jira', 'search'); await app.tick();
  const t1 = await textOf(app);
  assert.strictEqual(t1, before.replace('{jira.issue}', '{jira.search}'), 'only the type changed; every value is kept');
  const h = formOf(app);
  assert.deepStrictEqual(choiceRow(h, 'ob-jira').filter(r => r[1]).map(r => r[0]), ['search']);
  assert.ok(/id="q-ob-jfind">How do you find them\?/.test(h) && /id="q-ob-jres">What should it find\?/.test(h), 'the search form asks');
  assert.ok(h.indexOf('q-ob-jfind') < h.indexOf('ob-fld-query') && h.indexOf('ob-fld-query') < h.indexOf('q-ob-jres') && h.indexOf('q-ob-jres') < h.indexOf('ob-fld-what') && h.indexOf('ob-fld-what') < h.indexOf('ob-jsite-l') && h.indexOf('ob-jsite-l') < h.indexOf('ob-jpreview'), 'in the order of section 7');
  assert.ok(/id="flag-ob-fld-issue">\{jira\.search\} doesn&#39;t use this/.test(h), 'what search doesn\'t use is flagged');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.strictEqual(await textOf(app), before, 'Undo puts it back, byte for byte');
  choose(app, 'ob-jira', 'search'); await app.tick(); choose(app, 'ob-jira', 'assign'); await app.tick();
  const t2 = await textOf(app);
  assert.strictEqual(t2, before.replace('action: transition', 'action: assign'), 'back to an issue with the action chosen, in one change');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.strictEqual(await textOf(app), t1, 'one Undo reverses the switch back, type and action together');
});

rule('7: How do you find them? JQL or a saved filter; What should it find? writes results, with a number for Exactly, At least and At most', async () => {
  const before = jmd(jstep('jira.search', 's', 'query: project = PAY'));
  const app = await editorOn(before, 's');
  assert.deepStrictEqual(choiceRow(formOf(app), 'ob-jfind').map(r => [r[0], r[1], r[2]]), [['jql', true, 'JQL'], ['filter', false, 'Saved filter']]);
  assert.deepStrictEqual(choiceRow(formOf(app), 'ob-jres').map(r => r[2]), ['None', 'Any number (including zero)', 'Exactly', 'At least', 'At most']);
  assert.deepStrictEqual(choiceRow(formOf(app), 'ob-jres').filter(r => r[1]).map(r => r[0]), ['any'], 'no results: line reads as Any');
  choose(app, 'ob-jres', 'at least'); await app.tick();
  assert.ok(/  results: at least 1\n/.test(await textOf(app)));
  assert.ok(/id="ob-jres-n"[^>]*value="1"/.test(formOf(app)), 'the number box');
  enter(app, 'ob-jres-n', 'x'); await app.tick();
  assert.ok(/Type a whole number, 0 to 999999\./.test(formOf(app)), 'a refused number');
  enter(app, 'ob-jres-n', '4'); await app.tick();
  assert.ok(/  results: at least 4\n/.test(await textOf(app)));
  choose(app, 'ob-jres', 'none'); await app.tick();
  assert.ok(/  results: none\n/.test(await textOf(app)) && !/id="ob-jres-n"/.test(formOf(app)));
  choose(app, 'ob-jfind', 'filter'); await app.tick();
  let h = formOf(app);
  assert.ok(boxes(h).includes('filter') && boxes(h).includes('query'), 'the filter box; the query stays while it has a value');
  assert.ok(/flag-ob-fld-query/.test(h) === false || /not both/.test(h), 'no double flag');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/  results: at least 4\n/.test(await textOf(app)), 'Undo reverses the rule change');
});

rule('7: a ^detail chip goes in only where a value goes; a refused place is underlined and nothing is written; the preview fills in samples, checks positions and builds the link', async () => {
  const before = jmd(jstep('jira.search', 's', 'query: project = PAY AND fixVersion', 'results: none'));
  const app = await editorOn(before, 's', { 'jira-base-url': { value: 'https://jira.acme.com' } });
  app.click('ob-jql-ins', 'tag'); await app.tick();
  let h = formOf(app);
  assert.strictEqual(await textOf(app), before, 'refused: nothing written');
  assert.ok(/<code>project = PAY AND fixVersion <u class="bad">\^tag<\/u><\/code>/.test(h), 'the refused place is underlined: ' + (/ob-jql-marks[\s\S]{0,300}/.exec(h) || [''])[0]);
  assert.ok(/\^tag can&#39;t go there: a run detail goes only where a single value goes/.test(h));
  enter(app, 'ob-fld-query', 'project = PAY AND fixVersion = '); await app.tick();
  app.click('ob-jql-ins', 'tag'); await app.tick();
  assert.ok(/  query: project = PAY AND fixVersion = \^tag\n/.test(await textOf(app)), 'after =, it goes in');
  h = formOf(app);
  assert.ok(!/ob-jql-marks/.test(h), 'nothing refused now');
  const pv = un((/<details class="ob-jpreview"[\s\S]*?<\/details>/.exec(h) || [''])[0]);
  assert.ok(pv.indexOf('^tag = <code>sample-tag</code>') >= 0, 'a sample detail: ' + pv);
  assert.ok(pv.indexOf('<code class="ob-jpv-q">project = PAY AND fixVersion = "sample-tag"</code>') >= 0, 'the filled-in query');
  assert.ok(pv.indexOf('Positional check passed: 1 value, each one quoted string in its own place.') >= 0, 'the positional check');
  /* The stand-in browser has no URL parser, so the link itself is checked in search-core; here it says why there's none. */
  assert.ok(/class="small ob-jpv-nolink">No link: |ob-jpv-link/.test(pv), 'the link, or why there is none: ' + pv);
  app.click('tl-undo', 'draft'); await app.tick();
  app.click('tl-undo', 'draft'); await app.tick();
  assert.strictEqual(await textOf(app), before, 'Undo');
  /* A query already holding a refused ^detail underlines it where it is. */
  const app2 = await editorOn(jmd(jstep('jira.search', 's', 'query: summary ~ ^tag')), 's');
  assert.ok(/<code>summary ~ <u class="bad">\^tag<\/u><\/code>/.test(formOf(app2)), 'underlined in place');
  assert.ok(/No link: The Jira address team:jira-base-url isn&#39;t set\.|is a text search/.test(formOf(app2)));
  assert.ok(/data-act="ob-jsite">Set in Settings</.test(formOf(app2)), 'Set in Settings when the address is missing');
  app2.set('ob-text', 'Typed, not applied'); app2.input('ob-text', 'Typed, not applied');
  app2.click('ob-jsite'); await app2.tick();
  assert.ok(/Apply or clear what you typed in the box first/.test(app2.html()) && formOf(app2), 'unsaved typing: it asks before leaving');
  app2.set('ob-text', 'Do s'); app2.input('ob-text', 'Do s'); app2.click('ob-jsite'); await app2.tick();
  assert.ok(!formOf(app2) && /Team values/.test(app2.html()), 'nothing held: Settings opens');
});

rule('A.3: Text that matches a pattern: Check tries a value; an unescaped ( ) or , is refused before anything is written; Add writes name:pattern(...) and Undo removes it', async () => {
  const before = jmd(jstep('confirm', 'c'));
  const app = await editorOn(before, null);
  app.click('ob-sel-details'); await app.tick();
  let h = formOf(app);
  assert.ok(/<span id="ob-pat-l">Text that matches a pattern<\/span>/.test(h), 'the form');
  app.set('ob-pat-name', 'rel'); app.set('ob-pat-src', '\\d{4}\\.\\d{1,2}'); app.set('ob-pat-test', '2026.11');
  app.click('ob-pat-check'); await app.tick();
  assert.ok(/id="ob-pat-check" role="status">&quot;2026\.11&quot; matches\.</.test(formOf(app)), 'a matching value');
  app.set('ob-pat-test', '2026-11'); app.click('ob-pat-check'); await app.tick();
  assert.ok(/&quot;2026-11&quot; doesn&#39;t match\./.test(formOf(app)));
  for (const bad of ['v(\\d+)', 'a,b', '[a,b]+', 'x)']) {
    app.set('ob-pat-name', 'rel'); app.set('ob-pat-src', bad); app.click('ob-pat-add'); await app.tick();
    assert.ok(/The pattern can&#39;t be used: /.test(formOf(app)), bad + ' refused');
    assert.strictEqual(await textOf(app), before, bad + ': nothing written');
  }
  app.set('ob-pat-name', 'rel'); app.set('ob-pat-src', '\\d{4}\\.\\d{1,2}'); app.click('ob-pat-add'); await app.tick();
  const t = await textOf(app);
  assert.ok(/\ncontext: tag, environment, rel:pattern\(\\d\{4\}\\\.\\d\{1,2\}\)\n/.test(t), t.split('\n')[5]);
  assert.strictEqual(JSON.stringify(app.PF.map.parse(t).meta.detailTypes.rel), JSON.stringify({ kind: 'pattern', pattern: '\\d{4}\\.\\d{1,2}' }));
  app.click('tl-undo', 'draft'); await app.tick();
  assert.strictEqual(await textOf(app), before, 'Undo removes it');
});

rule('R3-7: typing in Text that matches a pattern is pending input: choosing a step waits, nothing is lost, Discard puts the boxes back', async () => {
  const before = jmd(jstep('confirm', 'c'), jstep('confirm', 'd'));
  const app = await editorOn(before, null);
  app.click('ob-sel-details'); await app.tick();
  for (const [id, v] of [['ob-pat-name', 'rel'], ['ob-pat-src', 'v\\d+'], ['ob-pat-test', 'v12']]) { app.set(id, v); app.input(id, v); }
  await app.tick();
  app.click('ob-sel', 'd'); await app.tick();
  assert.ok(/Apply or clear what you typed in the box first/.test(app.live()), 'choosing a step waits: ' + app.live());
  assert.ok(/<span id="ob-pat-l">/.test(formOf(app)), 'still on the checklist details');
  assert.deepStrictEqual([app.draft('ob-pat-name'), app.draft('ob-pat-src'), app.draft('ob-pat-test')], ['rel', 'v\\d+', 'v12'], 'nothing typed is lost');
  app.click('ob-pat-check'); await app.tick();
  assert.deepStrictEqual([app.draft('ob-pat-name'), app.draft('ob-pat-src'), app.draft('ob-pat-test')], ['rel', 'v\\d+', 'v12'], 'and it survives a redraw');
  for (let i = 0; i < 3; i++) { app.click('ob-sel', 'd'); await app.tick(); if (!/Apply or clear/.test(app.live())) break; app.click('ob-hold-discard'); await app.tick(); }
  app.click('ob-sel', 'd'); await app.tick();
  assert.ok(!/<span id="ob-pat-l">/.test(formOf(app)), 'after Discard, the step opens');
  app.click('ob-sel-details'); await app.tick();
  assert.deepStrictEqual([app.draft('ob-pat-name'), app.draft('ob-pat-src'), app.draft('ob-pat-test')], ['', '', ''], 'Discard cleared what was typed');
  assert.strictEqual(await textOf(app), before, 'nothing written');
});
rule('R3-7: every typed box the builder draws is pending input (OB_TYPED) or listed as exempt, so a new authoring box can\'t lose typing unnoticed', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  const typed = new RegExp(/var OB_TYPED = \/(.*)\/;/.exec(src)[1]);
  const b = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'views', 'builder.js'), 'utf8');
  const ids = new Set();
  for (const m of b.matchAll(/(?:formBox\(ctx, |<input[^>]*?id=")'?(ob-[\w-]+)/g)) ids.add(m[1]);
  for (const m of b.matchAll(/<(?:input|textarea)\b[^>]*?id="(ob-[\w-]+)/g)) ids.add(m[1]);
  /* Not typed authoring text: checkboxes, radios, the file picker, the outline filter. */
  const EXEMPT = ['ob-must', 'ob-planned', 'ob-link-ver-latest', 'ob-link-ver-pin', 'ob-shot-file', 'ob-shot-new', 'ob-part-q'];
  assert.ok(ids.has('ob-pat-name') && ids.has('ob-g-title') && ids.has('ob-note'), 'the scan finds the boxes: ' + [...ids].join(' '));
  const missing = [...ids].map(id => /-$/.test(id) ? id + 'x' : id).filter(id => !typed.test(id) && EXEMPT.indexOf(id) < 0);
  assert.deepStrictEqual(missing, [], 'boxes not kept as pending input');
});
rule('R3 P1: one binding for every search draft: no save path builds evidence from a step draft without searchBound (source check)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  assert.ok(/function searchBound\(key, id\)/.test(src), 'the one checking function');
  assert.ok(/function stampDraft\(/.test(src), 'the one stamp, at the draft root');
  assert.deepStrictEqual(src.match(/\.searchFor\b|dropStaleSearch\(/g), null, 'no per-compartment binding left');
  /* Each function declaration or ACTIONS entry, as a chunk of text up to the next one. */
  const heads = [...src.matchAll(/^\s*(?:function (\w+)\(|'([\w-]+)': function \(|(\w+): function \()/gm)];
  const chunks = heads.map((m, i) => ({ name: m[1] || m[2] || m[3], text: src.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : src.length) }));
  const MACHINERY = ['draftKey', 'draftOf', 'hasDraft', 'dropDraft', 'harvest', 'stampDraft', 'stampEvidence', 'searchBound', 'searchBoundAll', 'restoreDrafts', 'noteDrawn', 'searchNow'];
  const bad = [];
  chunks.forEach(c => {
    if (MACHINERY.indexOf(c.name) >= 0) return;
    const draft = /draftOf\(/.test(c.text), saves = /R\.checkEvidence\(|R\.setFields\(|R\.block\(|R\.done\(|R\.doneDifferently\(|PR\.answer\(|values\[/.test(c.text);
    if (/searchId =/.test(c.text) && !/searchBound\(/.test(c.text)) bad.push(c.name + ': sets a searchId');
    if (/R\.checkEvidence\(/.test(c.text) && !/searchBound\(/.test(c.text)) bad.push(c.name + ': checks evidence');
    if (draft && saves && /\.(record|fields)\b/.test(c.text) && !/searchBound\(/.test(c.text)) bad.push(c.name + ': reads a step draft to save');
  });
  assert.deepStrictEqual(bad, [], 'save paths outside the binding');
  const users = chunks.filter(c => /searchBound\(/.test(c.text) && MACHINERY.indexOf(c.name) < 0).map(c => c.name);
  ['answerCheck', 'save-fields', 'prAnswer'].forEach(n => assert.ok(users.indexOf(n) >= 0, n + ' checks it: ' + users.join(' ')));
  /* Done, Done differently and Block with these build their evidence only in answerCheck. */
  ['search-block', 'answerStep'].forEach(n => { const c = chunks.find(x => x.name === n); const t = c ? c.text.replace(/dropDraft\(/g, '') : '', at = t.indexOf('answerCheck('), dr = t.indexOf('draftOf('); assert.ok(at >= 0 && (dr < 0 || dr > at), n + ': its draft is read only after answerCheck'); });
});
/* Round 4 (P1, settled): a search's identity belongs to its evidence, set once when it's entered. Saved results keep the
   searchId they were recorded with; when the run's search has moved on (the stored detail or generation changed), they're
   shown as previous results with the notice and never offered to Done, Done differently, Fill in or Block with these. */
const SAVED_NOTE = 'Your saved results were for an earlier search. Search again.';
function savedThenMoved(id, values) {
  return (r, PF) => {
    const R = PF.run, map = R.mapOf(r), sid = R.searchId(r, map, PF.map.findStep(map, id).step);
    R.setFields(r, map, id, {}, Object.assign({ searchId: sid }, values), 'person-casey', NOW);
    assert.strictEqual(r.steps[id].values.searchId, sid, 'set-up: saved with its search');
    r.details.version = '2026.12.0'; r.searchGen.version = '7-0badc0de';
    assert.notStrictEqual(R.searchId(r, map, PF.map.findStep(map, id).step), sid, 'set-up: the search moved on');
  };
}
rule('R4 P1: saved results for an earlier search are previous results: Done, Done differently, Fill in and Block with these each refuse them, with the notice', async () => {
  const cases = [
    ['Done', 'scope', { count: '3', keys: 'PAY-1, PAY-2, PAY-3' }, async app => { app.click('record', 'scope'); await app.tick(120); }],
    ['Done differently', 'scope', { count: '3', keys: 'PAY-1, PAY-2, PAY-3' }, async app => {
      app.click('corr-open', 'scope', { mode: 'differently' }); await app.tick(40);
      app.set('corr-happened', 'Checked by hand'); app.input('corr-happened', 'Checked by hand'); app.click('corr-done'); await app.tick(150); }],
    ['Fill in', 'scope', { count: '3', keys: 'PAY-1, PAY-2, PAY-3' }, async app => {
      app.click('pick', 'scope', { kind: 'fields' }); await app.tick(40); app.click('save-fields', 'scope'); await app.tick(120);
      app.click('record', 'scope'); await app.tick(120); }],
    ['Block with these', 'blockers', { count: '1', keys: 'PAY-9' }, async app => { app.click('search-block', 'blockers'); await app.tick(120); }]
  ];
  for (const [what, id, values, act] of cases) {
    const app = await searching({ edit: savedThenMoved(id, values) });
    const old = runJson(app).steps[id].values.searchId;
    app.click('select', id); await app.tick(40);
    assert.ok(app.html().indexOf(SAVED_NOTE) >= 0, what + ': the notice');
    assert.strictEqual(app.draft('rec-count'), '', what + ': not offered in the form');
    await act(app);
    const a = runJson(app).steps[id];
    assert.ok(a.s !== 'done' && a.s !== 'blocked', what + ': refused: ' + JSON.stringify(a));
    assert.ok(!a.values || a.values.searchId === old, what + ': the saved results keep the search they were recorded for: ' + JSON.stringify(a.values));
    assert.ok(!JSON.stringify(a).includes(sidNow(app, id)), what + ': never relabeled as the new search');
  }
});
rule('R4 P1 (control): saved results for the current search are offered and Done saves them with the searchId they were recorded with', async () => {
  const app = await searching({ edit: (r, PF) => { const R = PF.run, map = R.mapOf(r); R.setFields(r, map, 'scope', {}, { searchId: R.searchId(r, map, PF.map.findStep(map, 'scope').step), count: '2', keys: 'PAY-1, PAY-2' }, 'person-casey', NOW); } });
  app.click('select', 'scope'); await app.tick(40);
  assert.ok(app.html().indexOf(SAVED_NOTE) < 0, 'no notice');
  app.click('record', 'scope'); await app.tick(120);
  const a = runJson(app).steps.scope;
  assert.deepStrictEqual([a.s, a.values.count, a.values.searchId], ['done', '2', sidNow(app, 'scope')]);
});
rule('R4 P1: the searchId is written only where evidence is stamped (source check)', () => {
  const fs = require('fs'), path = require('path');
  const files = ['src/ui/app.js', 'src/ui/views/run.js', 'src/ui/views/pages.js', 'src/core/run.js', 'src/core/practice.js', 'src/core/reports.js'];
  /* jira.js checkEvidence copies the evidence's own searchId into its canonical form, after checking it is the current one:
     its one write, and never the current identity. */
  const js = fs.readFileSync(path.join(__dirname, '..', 'src/core/jira.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepStrictEqual(js.match(/\bsearchId\s*=(?!=)|[{,]\s*searchId\s*:/g), ['searchId ='], 'jira.js writes a searchId once');
  assert.ok(/out\.searchId = str\('searchId'\);/.test(js) && !/searchId = curId/.test(js), 'and copies the evidence\'s own');
  const bad = [];
  files.forEach(f => {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const heads = [...src.matchAll(/^\s*(?:function (\w+)\(|'([\w-]+)': function \(|(\w+): function \()/gm)];
    heads.forEach((m, i) => {
      const name = m[1] || m[2] || m[3], text = src.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : src.length);
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\n]*'/g, "''").replace(/\bsearchId: searchId\b/g, '');
      if (/\bsearchId\s*=(?!=)|[{,]\s*searchId\s*:/.test(code) && !(f === 'src/ui/app.js' && name === 'stampEvidence')) bad.push(f + ' ' + name);
    });
  });
  assert.deepStrictEqual(bad, [], 'searchId written outside stampEvidence');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src/ui/app.js'), 'utf8');
  assert.ok(/function stampEvidence\(/.test(app), 'the one stamping function');
  assert.ok(!/R\.searchId\(/.test(app), 'the app never reads the current searchId to put on evidence');
});
run();
