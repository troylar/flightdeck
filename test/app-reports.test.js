// Reports in the app (docs/design.md section 26), run against the real built file with a stand-in browser: Accept goes through
// the one answer path, a decision is written only for the answer that's saved, and nothing in a report is trusted as markup.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot, gate } = require('./app-harness');

async function recording() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } });
  await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick();
  app.click('pickup'); await app.tick(40);
  assert.strictEqual(app.run().json.recorder.person, 'person-casey', 'set-up: Casey is recording');
  return app;
}
// A report on the example release's Jenkins step (open, its phase open, Build number required, tied to the tag).
function report(app, o) {
  o = o || {};
  const j = app.run().json, id = o.id || 'abcd1234', step = o.step || 'jenkins', tool = o.tool || 'ci-check';
  const rep = Object.assign({ format: 'flightdeck-report/1', run: 'release/' + j.id, publication: { folder: j.folder, version: +j.version }, step, verdict: 'pass',
    evidence: { build: '1432', buildLink: 'https://ci.example.com/jobs/1432', extra: 'not recorded' },
    inputs: [{ name: 'Tag', value: j.details.tag, source: 'detail:tag' }, { name: 'Deploy token', source: 'external', secret: true }],
    producer: { name: tool, version: '1.4.0' }, created: '2026-10-20T09:00:00.000Z', id, summary: 'Built and archived.' }, o.rep || {});
  Object.keys(rep).forEach(k => { if (rep[k] === undefined) delete rep[k]; });
  const name = j.id + '.' + step + '.' + tool + '.' + id + '.json', text = JSON.stringify(rep, null, 2) + '\n';
  return { name, path: 'reports/release/' + name, text, rep, key: ['release', j.id, step, tool, id].join('/'), sha: app.PF.sha256.hex(new TextEncoder().encode(text)) };
}
async function plant(app, o) { const x = report(app, o); await app.fs.write(x.path, x.text); app.click('refresh'); await app.tick(80); return x; }
const isDone = (app) => { const a = app.run().json.steps.jenkins; return !!a && a.s === 'done'; };
const decisions = (app) => app.files('report-decisions/release/').map(p => { try { return JSON.parse(app.fs.files[p].t); } catch (e) { return null; } }).filter(Boolean);
async function openStep(app, id) { app.click('select', id); await app.tick(40); }

rule('App: a report shows its three facts on its step and checks nothing by itself', async () => {
  const app = await recording();
  const x = await plant(app, { rep: { summary: '<img src=x onerror=alert(1)>' } });
  assert.ok(!isDone(app), 'the step is still open');
  assert.deepStrictEqual(decisions(app), [], 'nothing decided');
  await openStep(app, 'jenkins');
  const h = app.html();
  assert.ok(/Report says pass/.test(h), 'what it says');
  assert.ok(/Not accepted yet\./.test(h), 'what a person decided');
  assert.ok(/Matches the run: tag v2026\.10\.16/.test(h), 'whether its inputs match');
  assert.ok(/From ci-check 1\.4\.0, by its own account\./.test(h), 'the producer line');
  assert.ok(/Deploy token \(secret, not shown\)/.test(h), 'a secret input is named, never shown');
  assert.ok(/Not used: this step doesn(&#39;|')t record extra/.test(h), 'unused evidence names');
  assert.ok(!/<img src=x/.test(h) && /&lt;img src=x/.test(h), 'file text is escaped');
  assert.ok(/Report: says pass/.test(h), 'the row badge');
  assert.ok(h.indexOf(x.sha) >= 0, 'Details name the hash');
});

rule('App: Accept asks first, checks the step with exactly the report\'s evidence, logs its SHA-256 and writes one decision', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  app.click('rep-accept', x.key); await app.tick();
  assert.ok(/Accept this report\?/.test(app.html()) && /Checks &quot;|Checks "/.test(app.html()), 'the confirmation');
  assert.ok(!isDone(app), 'nothing until it\'s confirmed');
  app.click('rep-accept-go', x.key); await app.tick(120);
  const j = app.run().json, a = j.steps.jenkins;
  assert.strictEqual(a.s, 'done');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.values)), { build: '1432', buildLink: 'https://ci.example.com/jobs/1432' }, 'exactly the report\'s evidence the step records');
  const line = j.log[j.log.length - 1];
  assert.ok(line.what.indexOf('Accepted report ci-check/abcd1234 sha256:' + x.sha + ' (says pass) for "') === 0, line.what);
  const ds = decisions(app);
  assert.strictEqual(ds.length, 1, 'one decision');
  assert.deepStrictEqual([ds[0].status, ds[0].sha256, ds[0].inputs, ds[0].answer.at, ds[0].answer.by], ['accepted', x.sha, 'match', a.at, 'person-casey']);
  assert.ok(/Report accepted/.test(app.html()), 'the row says so');
  await openStep(app, 'jenkins');
  assert.ok(/Accepted by Casey/.test(app.html()), 'the card says so');
});

rule('App: Accept is refused, with the reason beside it, when the step can\'t take this report now', async () => {
  // Not the recorder.
  let app = await recording();
  let x = await plant(app);
  app.choose('person-blake'); await app.tick(); await openStep(app, 'jenkins');
  assert.ok(!/data-act="rep-accept"/.test(app.html()) && !/data-act="rep-decline"/.test(app.html()), 'no actions for someone else');
  app.click('rep-accept-go', x.key); await app.tick(60);
  assert.ok(!isDone(app));
  // A fail, and a report missing required evidence.
  app = await recording();
  x = await plant(app, { rep: { verdict: 'fail', blockers: ['Disk full'] } });
  await openStep(app, 'jenkins');
  assert.ok(/only a pass can be accepted/.test(app.html()));
  app = await recording();
  x = await plant(app, { rep: { evidence: { buildLink: 'https://ci.example.com/jobs/1432' } } });
  await openStep(app, 'jenkins');
  assert.ok(/This report doesn(&#39;|')t have Build number, which this step requires\./.test(app.html()), app.html().match(/rw-why-off[^<]*<\/span>|id="rep-[0-9a-f]+-why">[^<]*/g));
  // Paused.
  app = await recording();
  x = await plant(app);
  app.click('pick', 'run', { kind: 'pause' }); await app.tick(); app.set('pick-input', 'Waiting'); app.click('pause', 'run'); await app.tick(40);
  await openStep(app, 'jenkins');
  assert.ok(/The run is paused\. Resume it first\./.test(app.html()));
  app.click('rep-accept-go', x.key); await app.tick(60);
  assert.ok(!isDone(app), 'nothing while paused');
  assert.deepStrictEqual(decisions(app), []);
  // Inputs known not to match.
  app = await recording();
  x = await plant(app, { rep: { inputs: [{ name: 'Tag', value: 'v1.0.0', source: 'detail:tag' }] } });
  await openStep(app, 'jenkins');
  assert.ok(/Doesn(&#39;|')t match: it examined tag v1\.0\.0/.test(app.html()));
  assert.ok(/Report: doesn(&#39;|')t match/.test(app.html()), 'the row badge');
});

rule('App: Accept waits while Fill in is open on the step, and leaves what was typed there alone', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  app.click('pick', 'jenkins', { kind: 'fields' }); await app.tick(40);
  assert.ok(new RegExp('id="' + app.PF.views.reportCardId(x.key) + '-why">Save or cancel Fill in first\\.').test(app.html()), "the reason beside Accept");
  app.click('rep-accept-go', x.key); await app.tick(120);
  assert.ok(!isDone(app), 'nothing accepted');
  assert.deepStrictEqual(decisions(app), []);
});

rule('App: a report whose bytes changed after it was shown isn\'t accepted', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  app.click('rep-accept', x.key); await app.tick();
  await app.fs.write(x.path, x.text.replace('Built and archived.', 'Built.'));
  app.click('rep-accept-go', x.key); await app.tick(120);
  assert.ok(!isDone(app), 'the step stays open');
  assert.deepStrictEqual(decisions(app), []);
  assert.ok(/changed in the team folder since it was shown/.test(app.html()));
});

rule('App: a failed save keeps the acceptance; Try again saves it and then the decision, once; Discard writes none', async () => {
  for (const how of ['retry', 'discard']) {
    const app = await recording();
    const x = await plant(app);
    await openStep(app, 'jenkins');
    const orig = app.PF.repo.saveRun; let fail = true;
    app.PF.repo.saveRun = function () { if (fail) { fail = false; return Promise.reject(new Error('offline')); } return orig.apply(this, arguments); };
    app.click('rep-accept', x.key); await app.tick();
    app.click('rep-accept-go', x.key); await app.tick(120);
    assert.deepStrictEqual(decisions(app), [], how + ': no decision before the answer is saved');
    if (how === 'retry') {
      app.click('retry-save'); await app.tick(120);
      assert.strictEqual(app.run().json.steps.jenkins.s, 'done');
      assert.strictEqual(decisions(app).length, 1, 'one decision, after the save');
      app.click('retry-save'); app.click('refresh'); await app.tick(120);
      assert.strictEqual(decisions(app).length, 1, 'still one');
    } else {
      app.click('discard-unsaved'); await app.tick(120);
      assert.ok(!isDone(app), 'the answer is gone');
      app.click('refresh'); await app.tick(120);
      assert.deepStrictEqual(decisions(app), [], 'and no decision, ever');
    }
    app.PF.repo.saveRun = orig;
  }
});

rule('App: a decision that couldn\'t be written is offered again, and writing it twice is one decision', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  const orig = app.PF.repo.decideReport; let fail = true;
  app.PF.repo.decideReport = function () { if (fail) { fail = false; return Promise.reject(new Error('offline')); } return orig.apply(this, arguments); };
  app.click('rep-accept', x.key); await app.tick();
  app.click('rep-accept-go', x.key); await app.tick(120);
  assert.strictEqual(app.run().json.steps.jenkins.s, 'done');
  assert.deepStrictEqual(decisions(app), []);
  await openStep(app, 'jenkins');
  assert.ok(/data-act="rep-record"/.test(app.html()), 'Record the decision');
  // A decision on it that can't be read arrives first: the retry is held too, and says why.
  const j = app.run().json, h = app.PF.reports.decisionHash({ process: 'release', run: j.id, step: 'jenkins', producer: 'ci-check', id: 'abcd1234' }), bad = 'report-decisions/release/' + j.id + '.' + h + '.w9.4.json';
  await app.fs.write(bad, '{"format": "flightdeck-report-decision/1", "status": "decl');
  app.click('refresh'); await app.tick(120); await openStep(app, 'jenkins');
  assert.ok(!/data-act="rep-record"/.test(app.html()), 'no Record while held');
  app.click('rep-record', x.key); await app.tick(120);
  assert.deepStrictEqual(decisions(app), [], 'nothing written while held');
  await app.fs.remove(bad); app.click('refresh'); await app.tick(120); await openStep(app, 'jenkins');
  app.click('rep-record', x.key); await app.tick(120);
  assert.strictEqual(decisions(app).length, 1);
  app.PF.repo.decideReport = orig;
});

rule('App: declining a report whose acceptance decision is still waiting supersedes it, and Record the decision still works', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  const orig = app.PF.repo.decideReport; let fail = true;
  app.PF.repo.decideReport = function () { if (fail) { fail = false; return Promise.reject(new Error('offline')); } return orig.apply(this, arguments); };
  app.click('rep-accept', x.key); await app.tick();
  app.click('rep-accept-go', x.key); await app.tick(120);
  assert.deepStrictEqual(decisions(app), [], 'set-up: the decision failed');
  app.click('rep-decline', x.key); await app.tick();
  app.set(app.PF.reports.reasonId(x.key), 'Wrong build'); app.click('rep-decline-go', x.key); await app.tick(120);
  assert.deepStrictEqual(decisions(app).map(d => [d.status, d.rev]), [['declined', 1]]);
  await openStep(app, 'jenkins');
  assert.ok(/Another decision on it is in the folder too \(declined by Casey[^)]*\)/.test(app.html()), 'the acceptance in the run and the decline are both shown');
  app.click('rep-record', x.key); await app.tick(120);
  assert.deepStrictEqual(decisions(app).sort((a, b) => a.rev - b.rev).map(d => [d.status, d.rev]), [['declined', 1], ['accepted', 2]], 'written at the next rev, not over the decline');
  assert.ok(/Accepted by Casey/.test(app.html()));
  app.PF.repo.decideReport = orig;
});

rule('App: an acceptance the run records without its decision is recorded from the logged bytes only, during the run or after it ended', async () => {
  for (const changed of [false, true, 'ended']) {
    const app = await recording();
    const x = await plant(app);
    // Another window accepted it and closed before writing the decision: the run has the answer and the log line.
    const j = app.run().json, at = new Date(Date.now() - 60000).toISOString();
    j.steps.jenkins = { s: 'done', by: 'person-casey', at, values: { build: '1432', buildLink: 'https://ci.example.com/jobs/1432' } };
    j.log.push({ at, by: 'person-casey', what: app.PF.reports.logLine({ producer: 'ci-check', id: 'abcd1234' }, x.sha, 'Jenkins') });
    if (changed === 'ended') { j.ended = { outcome: 'Completed', by: 'person-casey', at: new Date().toISOString() }; j.state = 'completed'; }
    j.rev = (j.rev || 0) + 1;
    await app.fs.write(app.run().path, JSON.stringify(j, null, 2));
    if (changed === true) await app.fs.write(x.path, x.text.replace('Built and archived.', 'Built.'));
    app.click('refresh'); await app.tick(120);
    await openStep(app, 'jenkins');
    if (changed === true) {
      assert.ok(/isn(&#39;|')t in the folder in that form anymore/.test(app.html()), 'other bytes: said, and nothing offered');
      assert.ok(!/data-act="rep-record"/.test(app.html()));
      continue;
    }
    assert.ok(/data-act="rep-record"/.test(app.html()), 'Record the decision');
    app.click('rep-record', x.key); await app.tick(120);
    const ds = decisions(app);
    assert.strictEqual(ds.length, 1);
    assert.deepStrictEqual([ds[0].status, ds[0].sha256, ds[0].answer.at], ['accepted', x.sha, at]);
    assert.ok(/Accepted by Casey/.test(app.html()));
  }
});

rule('App: a logged acceptance isn\'t recorded while this window holds a change to the run that isn\'t saved', async () => {
  const app = await recording();
  const x = await plant(app);
  // Logged, decision lost, and the saved evidence was changed since (9999): not recordable.
  const j = app.run().json, at = new Date(Date.now() - 60000).toISOString();
  j.steps.jenkins = { s: 'done', by: 'person-casey', at, values: { build: '9999', buildLink: 'https://ci.example.com/jobs/1432' } };
  j.log.push({ at, by: 'person-casey', what: app.PF.reports.logLine({ producer: 'ci-check', id: 'abcd1234' }, x.sha, 'Jenkins') });
  j.rev = (j.rev || 0) + 1;
  await app.fs.write(app.run().path, JSON.stringify(j, null, 2));
  app.click('refresh'); await app.tick(120);
  await openStep(app, 'jenkins');
  assert.ok(!/data-act="rep-record"/.test(app.html()), 'changed: nothing offered');
  // Fill in puts the report's 1432 back, but the save fails: the folder still says 9999.
  const orig = app.PF.repo.saveRun;
  app.PF.repo.saveRun = function () { return Promise.reject(new Error('offline')); };
  app.click('pick', 'jenkins', { kind: 'fields' }); await app.tick(40);
  app.set('rec-build', '1432'); app.click('save-fields', 'jenkins'); await app.tick(120);
  assert.strictEqual(JSON.parse(app.fs.files[app.run().path].t).steps.jenkins.values.build, '9999', 'set-up: the save failed');
  await openStep(app, 'jenkins');
  app.click('rep-record', x.key); await app.tick(120);
  assert.deepStrictEqual(decisions(app), [], 'nothing recorded for evidence that isn\'t saved');
  app.PF.repo.saveRun = orig;
});

rule('App: a logged acceptance isn\'t recorded while the run couldn\'t be read on the last check', async () => {
  const app = await recording();
  const x = await plant(app);
  const j = app.run().json, at = new Date(Date.now() - 60000).toISOString();
  j.steps.jenkins = { s: 'done', by: 'person-casey', at, values: { build: '1432', buildLink: 'https://ci.example.com/jobs/1432' } };
  j.log.push({ at, by: 'person-casey', what: app.PF.reports.logLine({ producer: 'ci-check', id: 'abcd1234' }, x.sha, 'Jenkins') });
  j.rev = (j.rev || 0) + 1;
  await app.fs.write(app.run().path, JSON.stringify(j, null, 2));
  app.click('refresh'); await app.tick(120);
  await openStep(app, 'jenkins');
  assert.ok(/data-act="rep-record"/.test(app.html()), 'set-up: recordable');
  // The folder's run now says 9999, and this window's read of it fails: what it shows (1432) isn't what the folder holds.
  const path = app.run().path;
  j.steps.jenkins.values.build = '9999'; j.rev += 1;
  await app.fs.write(path, JSON.stringify(j, null, 2));
  const read = app.fs.read.bind(app.fs);
  app.fs.read = p => p === path ? Promise.reject(new Error('NotReadableError')) : read(p);
  app.click('refresh'); await app.tick(120);
  await openStep(app, 'jenkins');
  app.click('rep-record', x.key); await app.tick(120);
  assert.deepStrictEqual(decisions(app), [], 'nothing recorded from a run that couldn\'t be read');
  // Readable again: it's the 9999 the folder holds, so the report's evidence isn't there and nothing is offered.
  app.fs.read = read;
  app.click('refresh'); await app.tick(120); await openStep(app, 'jenkins');
  app.click('rep-record', x.key); await app.tick(120);
  assert.deepStrictEqual(decisions(app), []);
});

rule('App: a reports folder that can\'t be read keeps the reports last read, and says so with the panel closed', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  assert.ok(/data-act="run-reports"[^>]*>[\s\S]{0,600}Reports · 1/.test(app.html()), 'set-up: the rail button');
  const list = app.fs.list.bind(app.fs);
  app.fs.list = p => p === 'reports/release' ? Promise.reject(new Error('NotReadableError')) : list(p);
  app.click('refresh'); await app.tick(160);
  await openStep(app, 'jenkins');
  const h = app.html();
  assert.ok(/Report says pass/.test(h) && h.indexOf(x.sha) >= 0, 'the report last read is still on its step');
  assert.ok(/reports folder couldn(&#39;|')t be read on the last check/.test(h), 'the failure is named on the step');
  assert.ok(/Reports · 1 · couldn(&#39;|')t be read/.test(h), 'and on the rail button');
  // Nothing is decided from it: Accept reads every copy again first.
  app.click('rep-accept', x.key); await app.tick(); app.click('rep-accept-go', x.key); await app.tick(120);
  assert.ok(!isDone(app) && decisions(app).length === 0, 'nothing accepted');
  app.fs.list = list;
  app.click('refresh'); await app.tick(160);
  assert.ok(!/couldn(&#39;|')t be read on the last check/.test(app.html()), 'readable again: the note goes');
});

rule('App: accepting a report on a {run.skill} step in a run/3 records the registration as observed, as Done does', async () => {
  const runOf = async (how) => {
    const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(60);
    app.choose('person-casey'); await app.tick();
    await app.fs.write('maps/drafts/notes.md', '---\nprocess: notes\ntitle: Release notes\ncategory: Operations\nowner: person-casey\n---\n\n## Write {#w}\n- [ ] {run.skill} Write the notes {#write}\n  skill: notes-writer\n  skillVersion: 1.2.0\n');
    app.click('refresh'); await app.tick(120);
    app.click('home'); await app.tick(); app.click('open-process', 'notes'); await app.tick();
    app.set('change-note', 'First'); app.click('publish', 'notes'); await app.tick(120);
    const info = JSON.parse(app.fs.files[app.files('publications/notes/').find(p => /publication\.json$/.test(p))].t);
    const reg = { format: 'flightdeck-skill/2', app: '2.0.0', id: 'sk-abcd1234', rev: 1, seen: null, name: 'notes-writer', version: '1.2.0', location: 'https://example.com/skills/notes-writer',
      implements: { process: 'notes', folder: info.folder, mapHash: info.mapHash, typesHash: info.typesHash }, description: 'Writes the release notes.', by: 'person-casey', updated: '2026-10-20T09:00:00.000Z' };
    const regText = JSON.stringify(reg, null, 2), regSha = app.PF.sha256.hex(new TextEncoder().encode(regText));
    await app.fs.write('skill-registrations/notes-writer/sk-abcd1234.1.w-test.json', regText);
    app.click('refresh'); await app.tick(120);
    app.click('start', 'notes'); await app.tick(); app.chooseApprovers().submitForm('start-form'); await app.tick(120);
    const path = app.files('runs/notes/').find(p => /run\.json$/.test(p)), j = JSON.parse(app.fs.files[path].t);
    assert.strictEqual(j.format, 'preflight-run/3', 'set-up: a run/3');
    if (how === 'done') { app.click('toggle', 'write'); await app.tick(120); }
    else {
      const rep = { format: 'flightdeck-report/1', run: 'notes/' + j.id, publication: { folder: j.folder, version: +j.version }, step: 'write', verdict: 'pass', evidence: {},
        producer: { name: 'notes-bot', version: '1.0.0' }, created: '2026-10-20T09:00:00.000Z', id: 'abcd1234', summary: 'Notes written.' };
      await app.fs.write('reports/notes/' + j.id + '.write.notes-bot.abcd1234.json', JSON.stringify(rep, null, 2) + '\n');
      app.click('refresh'); await app.tick(120);
      await openStep(app, 'write');
      const key = ['notes', j.id, 'write', 'notes-bot', 'abcd1234'].join('/');
      app.click('rep-accept', key); await app.tick(); app.click('rep-accept-go', key); await app.tick(160);
    }
    return { a: JSON.parse(app.fs.files[path].t).steps.write, sha: regSha, folder: info.folder };
  };
  // Each window publishes its own folder, so the folder (and the registration's bytes naming it) differ; all else is the same.
  const same = (x) => { const k = JSON.parse(JSON.stringify(x.a.skill)); assert.strictEqual(k.sha, x.sha, 'the SHA-256 of the registration read'); assert.strictEqual(k.snapshot.implements.folder, x.folder); delete k.sha; delete k.snapshot.implements.folder; return k; };
  const done = await runOf('done'), acc = await runOf('report');
  assert.ok(done.a && done.a.s === 'done' && done.a.skill && done.a.skill.id === 'sk-abcd1234', 'set-up: Done records it: ' + JSON.stringify(done.a));
  assert.ok(acc.a && acc.a.s === 'done' && acc.a.skill, 'accepted, with the registration: ' + JSON.stringify(acc.a));
  assert.deepStrictEqual(same(acc), same(done), 'the same registration snapshot as Done');
});

rule('App: while skills/, skill-registrations/ or a registration can\'t be read, a {run.skill} step in a run/3 isn\'t checked, by Done or by accepting a report, so what was read before (or nothing) never stands as the current registration', async () => {
  for (const [how, cause] of [['done', 'list'], ['report', 'list'], ['done', 'read'], ['report', 'read'], ['done', 'regs'], ['report', 'regs']]) {
    const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(60);
    app.choose('person-casey'); await app.tick();
    await app.fs.write('maps/drafts/notes.md', '---\nprocess: notes\ntitle: Release notes\ncategory: Operations\nowner: person-casey\n---\n\n## Write {#w}\n- [ ] {run.skill} Write the notes {#write}\n  skill: notes-writer\n  skillVersion: 1.2.0\n');
    app.click('refresh'); await app.tick(120);
    app.click('home'); await app.tick(); app.click('open-process', 'notes'); await app.tick();
    app.set('change-note', 'First'); app.click('publish', 'notes'); await app.tick(120);
    const info = JSON.parse(app.fs.files[app.files('publications/notes/').find(p => /publication\.json$/.test(p))].t);
    const reg = (rev, version) => JSON.stringify({ format: 'flightdeck-skill/2', app: '2.0.0', id: 'sk-abcd1234', rev, seen: rev > 1 ? rev - 1 : null, name: 'notes-writer', version, location: 'https://example.com/skills/notes-writer',
      implements: { process: 'notes', folder: info.folder, mapHash: info.mapHash, typesHash: info.typesHash }, description: 'Writes the release notes.', by: 'person-casey', updated: '2026-10-20T09:00:00.000Z' }, null, 2);
    await app.fs.write('skill-registrations/notes-writer/sk-abcd1234.1.w-test.json', reg(1, '1.2.0'));
    app.click('refresh'); await app.tick(120);
    app.click('start', 'notes'); await app.tick(); app.chooseApprovers().submitForm('start-form'); await app.tick(120);
    const path = app.files('runs/notes/').find(p => /run\.json$/.test(p)), j = JSON.parse(app.fs.files[path].t);
    assert.strictEqual(j.format, 'preflight-run/3', 'set-up: a run/3');
    if (how === 'report') {
      const rep = { format: 'flightdeck-report/1', run: 'notes/' + j.id, publication: { folder: j.folder, version: +j.version }, step: 'write', verdict: 'pass', evidence: {},
        producer: { name: 'notes-bot', version: '1.0.0' }, created: '2026-10-20T09:00:00.000Z', id: 'abcd1234', summary: 'Notes written.' };
      await app.fs.write('reports/notes/' + j.id + '.write.notes-bot.abcd1234.json', JSON.stringify(rep, null, 2) + '\n');
      app.click('refresh'); await app.tick(120);
    }
    // A newer revision lands, and skills/ stops listing: the app still shows revision 1 from the read before.
    await app.fs.write('skill-registrations/notes-writer/sk-abcd1234.2.w-test.json', reg(2, '1.3.0'));
    await app.fs.write('skills/other.json', JSON.stringify({ name: 'other', version: '1.0.0', location: 'there', implements: 'notes@1' }));
    const list = app.fs.list.bind(app.fs), read = app.fs.read.bind(app.fs), blob = app.fs.blob.bind(app.fs), two = (p) => /sk-abcd1234\.2\.w-test\.json$/.test(p);
    if (cause === 'list') app.fs.list = p => p === 'skills' ? Promise.reject(new Error('NotReadableError')) : list(p);
    // skill-registrations/ can't be listed at all, and skills/ has no file naming this skill: no name to hold, still not absent.
    else if (cause === 'regs') app.fs.list = p => p === 'skill-registrations' ? Promise.reject(new Error('NotReadableError')) : list(p);
    else { app.fs.read = p => two(p) ? Promise.reject(new Error('NotReadableError')) : read(p); app.fs.blob = p => two(p) ? Promise.reject(new Error('NotReadableError')) : blob(p); }
    app.click('refresh'); await app.tick(160);
    if (cause === 'list') assert.ok(/Part of the team folder couldn(&#39;|')t be read/.test(app.html()), 'set-up: the skills part failed');
    if (how === 'done') { app.click('toggle', 'write'); await app.tick(120); }
    else {
      await openStep(app, 'write');
      const key = ['notes', j.id, 'write', 'notes-bot', 'abcd1234'].join('/');
      app.click('rep-accept', key); await app.tick(); app.click('rep-accept-go', key); await app.tick(160);
    }
    const a = JSON.parse(app.fs.files[path].t).steps.write;
    assert.ok(!a || a.s !== 'done', how + '/' + cause + ': not checked: ' + JSON.stringify(a));
    assert.ok(/couldn(&#39;|')t be (read|listed)( just now)?, so this step can(&#39;|')t record/.test(app.html() + app.live()), how + '/' + cause + ': says why');
    app.fs.list = list; app.fs.read = read; app.fs.blob = blob;
  }
});

rule('App: Record the decision for this window\'s own acceptance is judged again when its write\'s turn comes', async () => {
  const app = await recording();
  const a = await plant(app), b = await plant(app, { id: 'efgh5678' });
  await openStep(app, 'jenkins');
  const orig = app.PF.repo.decideReport; let fail = true, hold = null;
  app.PF.repo.decideReport = function (fs, rec) {
    if (fail) { fail = false; return Promise.reject(new Error('offline')); }
    if (hold && rec.report === 'efgh5678') { const g = hold; hold = null; return g.p.then(() => orig.apply(this, arguments)); }
    return orig.apply(this, arguments);
  };
  app.click('rep-accept', a.key); await app.tick(); app.click('rep-accept-go', a.key); await app.tick(120);
  assert.strictEqual(app.run().json.steps.jenkins.s, 'done', 'set-up: accepted');
  assert.deepStrictEqual(decisions(app), [], 'set-up: its decision failed');
  // A slow write (B's decline) is ahead in the queue when Record the decision is chosen.
  const g = gate(); hold = g;
  app.click('rep-decline', b.key); await app.tick();
  app.set(app.PF.reports.reasonId(b.key), 'Old tag'); app.click('rep-decline-go', b.key); await app.tick(20);
  await openStep(app, 'jenkins');
  assert.strictEqual(hold, null, 'set-up: B\'s write is waiting');
  app.click('rep-record', a.key); await app.tick(20);
  // Meanwhile the folder's run changes and this window's next read of it fails.
  const path = app.run().path, j = app.run().json;
  j.steps.jenkins.values.build = '9999'; j.rev += 1;
  await app.fs.write(path, JSON.stringify(j, null, 2));
  const read = app.fs.read.bind(app.fs);
  app.fs.read = p => p === path ? Promise.reject(new Error('NotReadableError')) : read(p);
  app.click('refresh'); await app.tick(120);
  g.open(); await app.tick(160);
  assert.deepStrictEqual(decisions(app).map(d => [d.report, d.status]), [['efgh5678', 'declined']], 'only B; A isn\'t recorded from a run that couldn\'t be read');
  app.fs.read = read; app.PF.repo.decideReport = orig;
});

rule('App: a decline reason typed for one report never lands in another report\'s form', async () => {
  const app = await recording();
  const a = await plant(app);
  const b = await plant(app, { id: 'efgh5678' });
  await openStep(app, 'jenkins');
  const field = () => (/<textarea id="([^"]+)"/.exec(app.html()) || [])[1];
  app.click('rep-decline', a.key); await app.tick();
  const ra = field();
  app.set(ra, 'Wrong build for report A');
  app.click('rep-decline', b.key); await app.tick();
  const rb = [...app.html().matchAll(/<textarea id="(rep-reason-[^"]+)"/g)].map(m => m[1]).filter(x => x !== ra)[0];
  const boxText = id => (new RegExp('<textarea id="' + id + '"[^>]*>([^<]*)<').exec(app.html()) || [])[1];
  assert.strictEqual(boxText(rb), '', 'B\'s form starts empty');
  assert.strictEqual(boxText(ra), 'Wrong build for report A', 'A\'s reason stays with A');
  assert.ok(ra !== rb, 'each report has its own field');
  app.click('rep-decline-go', b.key); await app.tick(60);
  assert.deepStrictEqual(decisions(app), [], 'B needs its own reason');
  app.set(rb, 'Old tag'); app.click('rep-decline-go', b.key); await app.tick(120);
  assert.deepStrictEqual(decisions(app).map(d => [d.report, d.reason]), [['efgh5678', 'Old tag']]);
  assert.strictEqual(boxText(ra), 'Wrong build for report A', 'A\'s reason is still kept');
});

rule('App: a logged acceptance whose evidence was changed since isn\'t recorded as the report\'s', async () => {
  const app = await recording();
  const x = await plant(app);
  const j = app.run().json, at = new Date(Date.now() - 60000).toISOString();
  j.steps.jenkins = { s: 'done', by: 'person-casey', at, values: { build: '1433', buildLink: 'https://ci.example.com/jobs/1432' } };
  j.log.push({ at, by: 'person-casey', what: app.PF.reports.logLine({ producer: 'ci-check', id: 'abcd1234' }, x.sha, 'Jenkins') });
  j.rev = (j.rev || 0) + 1;
  await app.fs.write(app.run().path, JSON.stringify(j, null, 2));
  app.click('refresh'); await app.tick(120);
  await openStep(app, 'jenkins');
  assert.ok(/evidence was changed since, so the decision can(&#39;|')t be recorded/.test(app.html()));
  assert.ok(!/data-act="rep-record"/.test(app.html()));
  app.click('rep-record', x.key); await app.tick(120);
  assert.deepStrictEqual(decisions(app), [], 'nothing recorded');
});

rule('App: a decision on a report that can\'t be read holds it: no Accept, Decline or Reopen until it can be read', async () => {
  const app = await recording();
  const x = await plant(app);
  const j = app.run().json, h = app.PF.reports.decisionHash({ process: 'release', run: j.id, step: 'jenkins', producer: 'ci-check', id: 'abcd1234' });
  await app.fs.write('report-decisions/release/' + j.id + '.' + h + '.w9.4.json', '{"format": "flightdeck-report-decision/1", "status": "decl');
  app.click('refresh'); await app.tick(120);
  await openStep(app, 'jenkins');
  assert.ok(/A decision on this report can(&#39;|')t be read/.test(app.html()), 'it says why');
  assert.ok(!/data-act="rep-accept"/.test(app.html()) && !/data-act="rep-decline"/.test(app.html()));
  app.click('rep-accept-go', x.key); app.click('rep-decline-go', x.key); app.click('rep-reopen', x.key); await app.tick(120);
  assert.ok(!isDone(app), 'nothing accepted');
  assert.deepStrictEqual(decisions(app).filter(Boolean).length, 0, 'nothing decided');
});

rule('App: a differing copy that arrives after the confirmation opens stops Accept', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  app.click('rep-accept', x.key); await app.tick();
  await app.fs.write(x.path.replace('.json', '-LAPTOP.json'), x.text.replace('"1432"', '"9999"'));
  app.click('rep-accept-go', x.key); await app.tick(120);
  assert.ok(!isDone(app), 'nothing accepted');
  assert.deepStrictEqual(decisions(app), []);
});

rule('App: a decision that can\'t be read, found while a recovery reads the report, stops the recovery\'s write', async () => {
  const app = await recording();
  const x = await plant(app);
  const j = app.run().json, at = new Date(Date.now() - 60000).toISOString();
  j.steps.jenkins = { s: 'done', by: 'person-casey', at, values: { build: '1432', buildLink: 'https://ci.example.com/jobs/1432' } };
  j.log.push({ at, by: 'person-casey', what: app.PF.reports.logLine({ producer: 'ci-check', id: 'abcd1234' }, x.sha, 'Jenkins') });
  j.rev = (j.rev || 0) + 1;
  await app.fs.write(app.run().path, JSON.stringify(j, null, 2));
  app.click('refresh'); await app.tick(120);
  await openStep(app, 'jenkins');
  const orig = app.PF.repo.loadRunReports, g = gate(); let hold = true;
  app.PF.repo.loadRunReports = function () { const a = arguments; if (hold) { hold = false; return g.p.then(() => orig.apply(this, a)); } return orig.apply(this, a); };
  app.click('rep-record', x.key); await app.tick(20);
  const h = app.PF.reports.decisionHash({ process: 'release', run: j.id, step: 'jenkins', producer: 'ci-check', id: 'abcd1234' });
  await app.fs.write('report-decisions/release/' + j.id + '.' + h + '.w9.4.json', '{"format": "flightdeck-report-decision/1", "status": "decl');
  app.click('refresh'); await app.tick(120);
  g.open(); await app.tick(120);
  app.PF.repo.loadRunReports = orig;
  assert.deepStrictEqual(decisions(app), [], 'nothing written while held');
});

rule('App: Fill in after an acceptance shows the evidence changed; Decline needs a reason; Reopen writes a decision only', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  app.click('rep-accept', x.key); await app.tick();
  app.click('rep-accept-go', x.key); await app.tick(120);
  const j = app.run().json, at = new Date().toISOString();
  j.steps.jenkins.values.build = '1433'; j.log.push({ at, by: 'person-blake', what: 'Filled in Build number for "Jenkins"' }); j.rev = (j.rev || 0) + 1;
  await app.fs.write(app.run().path, JSON.stringify(j, null, 2));
  app.click('refresh'); await app.tick(120);
  await openStep(app, 'jenkins');
  assert.ok(/Evidence changed since acceptance \(Fill in by Blake/.test(app.html()), app.html().match(/Evidence changed[^<]*/));
  app.click('rep-decline', x.key); await app.tick();
  assert.ok(/Why not\? The run will show this\./.test(app.html()));
  app.click('rep-decline-go', x.key); await app.tick(60);
  assert.ok(/Say why it(&#39;|')s declined/.test(app.html()), 'the reason is required');
  assert.strictEqual(decisions(app).length, 1, 'nothing written without one');
  app.set(app.PF.reports.reasonId(x.key), 'Wrong build'); app.click('rep-decline-go', x.key); await app.tick(120);
  let ds = decisions(app).sort((a, b) => a.rev - b.rev);
  assert.deepStrictEqual(ds.map(d => d.status), ['accepted', 'declined']);
  assert.strictEqual(ds[1].reason, 'Wrong build');
  assert.ok(/Declined by Casey[^:<]*: Wrong build/.test(app.html()), String(app.html().match(/What a person decided<\/h4><p>[^<]*/)));
  const before = app.fs.files[app.run().path].t;
  app.click('rep-reopen', x.key); await app.tick(120);
  ds = decisions(app).sort((a, b) => a.rev - b.rev);
  assert.deepStrictEqual(ds.map(d => d.status), ['accepted', 'declined', 'open']);
  assert.strictEqual(app.fs.files[app.run().path].t, before, 'run.json untouched');
  assert.ok(!/data-act="rep-record"/.test(app.html()) && !/decision isn(&#39;|')t in the team folder/.test(app.html()), 'the recorded acceptance is never offered again');
});

rule('App: Home tells the recorder about reports waiting, and a folder without reports reads none', async () => {
  let app = await recording();
  let calls = 0; const orig = app.PF.repo.loadRunReports;
  app.PF.repo.loadRunReports = function () { calls++; return orig.apply(this, arguments); };
  await openStep(app, 'jenkins'); app.click('refresh'); await app.tick(80);
  assert.strictEqual(calls, 0, 'no report names, no reads');
  app.PF.repo.loadRunReports = orig;
  await plant(app);
  app.click('nav', 'home'); await app.tick(40);
  assert.ok(/1 report to review on Release 2026\.10\.16/.test(app.html()));
  app.choose('person-blake'); await app.tick(40);
  assert.ok(!/report to review/.test(app.html()), 'only the recorder');
});

rule('App: an acceptance whose log line was archived out of a full log is still recordable and named on the receipt', async () => {
  const app = await recording();
  const x = await plant(app);
  const j = app.run().json, at = new Date(Date.now() - 60000).toISOString();
  j.steps.jenkins = { s: 'done', by: 'person-casey', at, values: { build: '1432', buildLink: 'https://ci.example.com/jobs/1432' } };
  // 300 later lines pushed the acceptance's line into the run's history file.
  const later = new Date(Date.now() - 30000).toISOString();
  j.log = Array.from({ length: 300 }, (_, i) => ({ at: later, by: 'person-casey', what: 'Note ' + i }));
  j.rev = (j.rev || 0) + 1;
  await app.fs.write(app.run().path, JSON.stringify(j, null, 2));
  await app.fs.write(app.run().path.replace(/run\.json$/, 'history-w1.jsonl'), JSON.stringify({ kind: 'log', id: 'archived01', at, by: 'person-casey', what: app.PF.reports.logLine({ producer: 'ci-check', id: 'abcd1234' }, x.sha, 'Jenkins') }) + '\n');
  app.click('refresh'); await app.tick(160);
  await openStep(app, 'jenkins'); await app.tick(80);
  assert.ok(/data-act="rep-record"/.test(app.html()), 'Record the decision is offered from the archived line');
  app.click('receipt'); await app.tick(80);
  assert.ok(/Accepted report ci-check\/abcd1234, sha256 /.test(app.html()), 'the receipt names it');
  app.click('receipt'); await app.tick(40);
  await openStep(app, 'jenkins');
  app.click('rep-record', x.key); await app.tick(160);
  assert.deepStrictEqual(decisions(app).map(d => [d.status, d.answer.at]), [['accepted', at]]);
});

rule('App: Record the decision after a write whose read-back failed finds it recorded, and writes nothing under its name again', async () => {
  const app = await recording();
  const x = await plant(app);
  const j = app.run().json, at = new Date(Date.now() - 60000).toISOString();
  j.steps.jenkins = { s: 'done', by: 'person-casey', at, values: { build: '1432', buildLink: 'https://ci.example.com/jobs/1432' } };
  j.log.push({ at, by: 'person-casey', what: app.PF.reports.logLine({ producer: 'ci-check', id: 'abcd1234' }, x.sha, 'Jenkins') });
  j.rev = (j.rev || 0) + 1;
  await app.fs.write(app.run().path, JSON.stringify(j, null, 2));
  app.click('refresh'); await app.tick(120);
  await openStep(app, 'jenkins');
  const orig = app.PF.repo.decideReport; let lose = true;
  app.PF.repo.decideReport = function () { const p = orig.apply(this, arguments); if (!lose) return p; lose = false; return p.then(() => { throw new Error('read back failed'); }); };
  app.click('rep-record', x.key); await app.tick(160);
  assert.strictEqual(decisions(app).length, 1, 'set-up: written, though its read-back failed');
  await openStep(app, 'jenkins');
  app.click('rep-record', x.key); await app.tick(160);
  assert.strictEqual(decisions(app).length, 1, 'still one');
  assert.ok(!/already in the folder/.test(app.html()), 'no clash with its own name');
  app.PF.repo.decideReport = orig;
});

rule('App: an acceptance\'s decision is tried by itself once; after a failed write, a read doesn\'t try again', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  const orig = app.PF.repo.decideReport; let fail = true;
  app.PF.repo.decideReport = function () { if (fail) { fail = false; return Promise.reject(new Error('offline')); } return orig.apply(this, arguments); };
  app.click('rep-accept', x.key); await app.tick(); app.click('rep-accept-go', x.key); await app.tick(120);
  assert.deepStrictEqual(decisions(app), [], 'set-up: the automatic write failed');
  app.click('refresh'); await app.tick(160); app.click('refresh'); await app.tick(160);
  assert.deepStrictEqual(decisions(app), [], 'not tried again by itself');
  await openStep(app, 'jenkins');
  assert.ok(/data-act="rep-record"/.test(app.html()), 'offered to the person');
  app.PF.repo.decideReport = orig;
});

rule('App: a report whose every copy is gone still shows on its step from the decision on it, and can be reopened', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  app.click('rep-accept', x.key); await app.tick(); app.click('rep-accept-go', x.key); await app.tick(160);
  assert.strictEqual(decisions(app).length, 1, 'set-up: accepted');
  await app.fs.remove(x.path);
  app.click('refresh'); await app.tick(160);
  await openStep(app, 'jenkins');
  assert.ok(/Accepted, but the report it accepted is gone or changed\./.test(app.html()), 'the card and what was decided');
  assert.ok(/Report: /.test(app.html()), 'the badge');
  assert.ok(/data-act="rep-reopen"/.test(app.html()), 'Reopen is offered');
  app.click('rep-reopen', x.key); await app.tick(160);
  assert.deepStrictEqual(decisions(app).sort((a, b) => a.rev - b.rev).map(d => d.status), ['accepted', 'open']);
});

rule('App: a decline reason being typed survives moving to another step and back', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  app.click('rep-decline', x.key); await app.tick();
  const field = () => (/<textarea id="([^"]+)"/.exec(app.html()) || [])[1];
  app.set(field(), 'Wrong build, half typed');
  await openStep(app, 'pods');
  await openStep(app, 'jenkins');
  assert.ok(/Wrong build, half typed/.test(app.html()), 'the reason is still there');
});

rule('App: Back, a top-bar click and a jump keep a decline reason as a draft; it comes back with its report until Cancel', async () => {
  const app = await recording();
  const x = await plant(app);
  app.click('nav', 'runs'); await app.tick(40);
  app.click('open-run', app.run().key); await app.tick(40);
  const runHash = app.hash();
  await openStep(app, 'jenkins');
  app.click('rep-decline', x.key); await app.tick();
  const rid = (/<textarea id="(rep-reason-[^"]+)"/.exec(app.html()) || [])[1];
  const back = () => new RegExp('<textarea id="' + rid + '"[^>]*>Wrong build, half typed<').test(app.html());
  app.set(rid, 'Wrong build, half typed');
  await openStep(app, 'pods');
  app.back(); await app.settle();
  assert.ok(/<h1[^>]*>Runs<\/h1>/.test(app.html()) && !/Finish or cancel this first/.test(app.html() + app.live()), 'Back goes, asking nothing');
  app.forward(); await app.settle();
  assert.strictEqual(app.hash(), runHash);
  await openStep(app, 'jenkins');
  assert.ok(back(), 'the reason is back on its report');
  app.set(rid, 'Wrong build, half typed');
  app.click('nav', 'runs'); await app.tick(40);
  app.click('open-run', app.run().key); await app.tick(40); await openStep(app, 'jenkins');
  assert.ok(back(), 'a top-bar click keeps it too');
  app.click('go', '', { view: 'runs' }); await app.tick(40);
  app.click('open-run', app.run().key); await app.tick(40); await openStep(app, 'jenkins');
  assert.ok(back(), 'and a jump');
  app.click('rep-cancel', x.key); await app.tick();
  app.click('nav', 'runs'); await app.tick(40);
  app.click('open-run', app.run().key); await app.tick(40); await openStep(app, 'jenkins');
  assert.ok(!new RegExp('id="' + rid + '"').test(app.html()) && /data-act="rep-decline"/.test(app.html()), 'after Cancel nothing is kept');
});

rule('App: a decline reason being typed keeps its box and Cancel when this person stops recording', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  app.click('rep-decline', x.key); await app.tick();
  const rid = (/<textarea id="(rep-reason-[^"]+)"/.exec(app.html()) || [])[1];
  app.set(rid, 'Wrong build');
  app.choose('person-blake'); await app.tick(40);
  assert.ok(new RegExp('id="' + rid + '"').test(app.html()) && /Wrong build/.test(app.html()), 'the reason stays on screen');
  assert.ok(/data-act="rep-cancel"/.test(app.html()) && !/data-act="rep-decline-go"/.test(app.html()), 'with Cancel, and no Decline to press');
  assert.ok(/can(&#39;|')t be declined here/.test(app.html()), 'saying why');
  app.click('rep-cancel', x.key); await app.tick();
  assert.ok(!new RegExp('id="' + rid + '"').test(app.html()), 'Cancel closes it');
  assert.strictEqual(decisions(app).length, 0, 'nothing was decided');
});

rule('App: saving a decline closes only that report\'s form; another report\'s open form keeps its draft', async () => {
  const app = await recording();
  const a = await plant(app);
  const b = await plant(app, { id: 'efgh5678' });
  await openStep(app, 'jenkins');
  const boxText = id => (new RegExp('<textarea id="' + id + '"[^>]*>([^<]*)<').exec(app.html()) || [])[1];
  app.click('rep-decline', a.key); await app.tick();
  const ra = (/<textarea id="(rep-reason-[^"]+)"/.exec(app.html()) || [])[1];
  app.set(ra, 'Still deciding on A');
  app.click('rep-decline', b.key); await app.tick();
  const rb = [...app.html().matchAll(/<textarea id="(rep-reason-[^"]+)"/g)].map(m => m[1]).filter(x => x !== ra)[0];
  app.set(rb, 'Wrong build');
  app.click('rep-decline-go', b.key); await app.tick(120);
  assert.deepStrictEqual(decisions(app).map(d => [d.report, d.reason]), [['efgh5678', 'Wrong build']], 'B is declined');
  app.click('refresh'); await app.tick(80);
  assert.strictEqual(boxText(rb), undefined, 'B\'s form is closed');
  assert.ok(new RegExp('data-act="rep-reopen" data-id="' + b.key + '"').test(app.html()), 'and B offers Reopen');
  assert.strictEqual(boxText(ra), 'Still deciding on A', 'A\'s form keeps its draft');
  app.click('nav', 'runs'); await app.tick(40);
  app.click('open-run', app.run().key); await app.tick(40); await openStep(app, 'jenkins');
  assert.strictEqual(boxText(rb), undefined, 'B stays closed after leaving and coming back');
  assert.strictEqual(boxText(ra), 'Still deciding on A');
});

rule('App: a decline reason is read-only while its decision is being saved, so nothing typed then is dropped', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  app.click('rep-decline', x.key); await app.tick();
  const rid = app.PF.reports.reasonId(x.key), box = () => new RegExp('<textarea id="' + rid + '"[^>]*>').exec(app.html());
  assert.ok(box() && !/readonly/.test(box()[0]), 'set-up: editable while typing');
  app.set(rid, 'Wrong build');
  const origD = app.PF.repo.decideReport, g = gate(); let hold = true;
  app.PF.repo.decideReport = function () { const a = arguments; if (hold) { hold = false; return g.p.then(() => origD.apply(this, a)); } return origD.apply(this, a); };
  app.click('rep-decline-go', x.key); await app.tick(20);
  assert.ok(box() && / readonly/.test(box()[0]), 'read-only while the write waits');
  g.open(); await app.tick(120);
  assert.deepStrictEqual(decisions(app).map(d => d.reason), ['Wrong build']);
  assert.ok(!box(), 'and the form closes once it is saved');
});

rule('App: this window\'s hint records only the acceptance it made: after Discard, an older acceptance of the same report isn\'t recorded by itself', async () => {
  const app = await recording();
  const x = await plant(app);
  await openStep(app, 'jenkins');
  const origD = app.PF.repo.decideReport; let failD = true;
  app.PF.repo.decideReport = function () { if (failD) { failD = false; return Promise.reject(new Error('offline')); } return origD.apply(this, arguments); };
  app.click('rep-accept', x.key); await app.tick(); app.click('rep-accept-go', x.key); await app.tick(160);
  assert.deepStrictEqual(decisions(app), [], 'set-up: A saved, its decision failed');
  const at = app.run().json.steps.jenkins.at;
  await new Promise(res => setTimeout(res, 5));
  // B: the same report accepted again, and its save fails; then Discard puts A back.
  const origS = app.PF.repo.saveRun; let failS = true;
  app.PF.repo.saveRun = function () { if (failS) { failS = false; return Promise.reject(new Error('offline')); } return origS.apply(this, arguments); };
  await openStep(app, 'jenkins');
  app.click('rep-accept', x.key); await app.tick(); app.click('rep-accept-go', x.key); await app.tick(160);
  app.click('discard-unsaved'); await app.tick(160);
  app.click('refresh'); await app.tick(160);
  assert.strictEqual(app.run().json.steps.jenkins.at, at, 'set-up: A is the saved answer again');
  assert.deepStrictEqual(decisions(app), [], 'A isn\'t recorded by B\'s hint');
  await openStep(app, 'jenkins');
  assert.ok(/data-act="rep-record"/.test(app.html()), 'A is offered to the person');
  app.PF.repo.saveRun = origS; app.PF.repo.decideReport = origD;
});

rule('App: a decision finishing for a folder this window has left never drops a hint in the folder it uses now', async () => {
  const app = await recording();
  let x = await plant(app);
  await openStep(app, 'jenkins');
  // A decline in the first folder waits in the write queue.
  const origD = app.PF.repo.decideReport, g = gate(); let hold = true;
  app.PF.repo.decideReport = function () { const a = arguments; if (hold) { hold = false; return g.p.then(() => origD.apply(this, a)); } return origD.apply(this, a); };
  app.click('rep-decline', x.key); await app.tick();
  app.set(app.PF.reports.reasonId(x.key), 'Wrong build'); app.click('rep-decline-go', x.key); await app.tick(20);
  // A copy of the folder (the examples reset, then this run copied in): the same report is accepted there, its save queued
  // behind the decline.
  const path = app.run().path, text = app.fs.files[path].t;
  app.click('reset-examples'); await app.tick(160);
  await app.fs.write(path, text); app._runPath = path;
  app.click('refresh'); await app.tick(160);
  app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
  x = await plant(app);
  await openStep(app, 'jenkins');
  app.click('rep-accept', x.key); await app.tick(); app.click('rep-accept-go', x.key); await app.tick(40);
  g.open(); await app.tick(300);
  assert.strictEqual(app.run().json.steps.jenkins.s, 'done', 'set-up: accepted in the new folder');
  assert.deepStrictEqual(decisions(app).map(d => d.status), ['accepted'], 'its decision is written');
  app.PF.repo.decideReport = origD;
});

rule('App: the receipt names the accepted report and lists every report on the run', async () => {
  const app = await recording();
  const x = await plant(app);
  await plant(app, { id: 'efgh5678', step: 'pods', tool: 'pod-check', rep: { evidence: { result: 'All up' }, inputs: undefined, verdict: 'blocked', blockers: ['No access'] } });
  await openStep(app, 'jenkins');
  app.click('rep-accept', x.key); await app.tick();
  app.click('rep-accept-go', x.key); await app.tick(120);
  app.click('receipt'); await app.tick(80);
  const h = app.html();
  assert.ok(/Accepted report ci-check\/abcd1234, sha256 /.test(h) && h.indexOf(x.sha.slice(0, 12)) >= 0, 'the step names the report and its hash');
  assert.ok(/Reports · 2/.test(h), 'a Reports section');
  assert.ok(/pod-check\/efgh5678 on [^:<]+: says blocked \(No access\)/.test(h), 'every report is listed with what it says');
  /* The text is made when copied; with no clipboard here the fallback's selection throws after the text is in place. */
  const pre = app.el('receipt-text'); try { app.click('copy-receipt'); } catch (e) { /* no createRange in the harness */ }
  const text = pre.textContent || '';
  assert.ok(/\[DONE\] [^\n]*\(accepted report ci-check\/abcd1234, sha256 [0-9a-f]{12}…, by Casey[^)]*\)/.test(text), 'the copied text too');
  assert.ok(/Reports · 2/.test(text));
});

run();
