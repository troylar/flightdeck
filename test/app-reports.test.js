// Reports in the app (docs/design.md section 26), run against the real built file with a stand-in browser: Accept goes through
// the one answer path, a decision is written only for the answer that's saved, and nothing in a report is trusted as markup.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

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
  assert.ok(/This report doesn(&#39;|')t have Build number, which this step requires\./.test(app.html()), app.html().match(/rw-why-off[^<]*<\/span>|id="rep-0-why">[^<]*/g));
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
  assert.ok(/id="rep-0-why">Save or cancel Fill in first\./.test(app.html()), "the reason beside Accept");
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

rule('App: an acceptance the run records without its decision is recorded from the logged bytes only', async () => {
  for (const changed of [false, true]) {
    const app = await recording();
    const x = await plant(app);
    // Another window accepted it and closed before writing the decision: the run has the answer and the log line.
    const j = app.run().json, at = new Date(Date.now() - 60000).toISOString();
    j.steps.jenkins = { s: 'done', by: 'person-casey', at, values: { build: '1432', buildLink: 'https://ci.example.com/jobs/1432' } };
    j.log.push({ at, by: 'person-casey', what: app.PF.reports.logLine({ producer: 'ci-check', id: 'abcd1234' }, x.sha, 'Jenkins') });
    j.rev = (j.rev || 0) + 1;
    await app.fs.write(app.run().path, JSON.stringify(j, null, 2));
    if (changed) await app.fs.write(x.path, x.text.replace('Built and archived.', 'Built.'));
    app.click('refresh'); await app.tick(120);
    await openStep(app, 'jenkins');
    if (changed) {
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
  app.set('rep-reason', 'Wrong build'); app.click('rep-decline-go', x.key); await app.tick(120);
  let ds = decisions(app).sort((a, b) => a.rev - b.rev);
  assert.deepStrictEqual(ds.map(d => d.status), ['accepted', 'declined']);
  assert.strictEqual(ds[1].reason, 'Wrong build');
  assert.ok(/Declined by Casey[^:<]*: Wrong build/.test(app.html()), String(app.html().match(/What a person decided<\/h4><p>[^<]*/)));
  const before = app.fs.files[app.run().path].t;
  app.click('rep-reopen', x.key); await app.tick(120);
  ds = decisions(app).sort((a, b) => a.rev - b.rev);
  assert.deepStrictEqual(ds.map(d => d.status), ['accepted', 'declined', 'open']);
  assert.strictEqual(app.fs.files[app.run().path].t, before, 'run.json untouched');
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
  const text = (h.match(/<pre id="receipt-text" hidden>([\s\S]*?)<\/pre>/) || [])[1] || '';
  assert.ok(/\[DONE\] [^\n]*\(accepted report ci-check\/abcd1234, sha256 [0-9a-f]{12}…, by Casey[^)]*\)/.test(text), 'the copied text too');
  assert.ok(/Reports · 2/.test(text));
});

run();
