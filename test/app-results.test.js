// Module results (3.0) in the app: the recorder's window settles a step from its run's answer and notices when that answer
// changes, Start a new run replaces a held link, accepted results are escaped, and a bound result is read-only.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

const KID = (opts) => ['---', 'process: validate-story', 'title: Validate a story', 'owner: person-avery', 'context: issue, disposition:choice(' + opts.join('|') + ')', 'result: disposition', '---', '',
  '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: ' + opts.join(', '), '  sets: disposition=decision', ''].join('\n');
const PARENT = (accept, opts) => ['---', 'process: ship-stories', 'title: Ship stories', 'owner: person-avery', 'context: issue, story_result:choice(' + opts.join('|') + ')', '---', '',
  '## Stories · DO-CONFIRM {#stories}', '- [!] {run.process} Validate the story {#story}', '  process: validate-story', '  sets: story_result=result', '  accepts: ' + accept, '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');

async function setup(o) {
  o = o || {};
  const opts = o.opts || ['cleared', 'needs-work'];
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const put = (md, id, rand) => {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '3.0.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  };
  put(KID(opts), 'validate-story', 'vs000001');
  put(PARENT(o.accept || opts[0], opts), 'ship-stories', 'rl000001');
  app.click('refresh'); await app.tick(80);
  app.click('start', 'ship-stories'); await app.settle();
  app.set('detail-issue', 'ABC-104'); app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  assert.ok(/<h1 id="run-h"[^>]*><span class="hd-t"[^>]*>Ship stories/.test(app.html()), 'set-up: the parent run is open: ' + (app.html().match(/class="notice[^"]*"[^>]*><span>[^<]*/g) || []).join(' / ') + (app.html().match(/<h1[^<]*<[^<]*/) || [''])[0]);
  return app;
}
const parentRun = (app) => JSON.parse(app.fs.files[app.files('runs/ship-stories/').find(p => /run\.json$/.test(p))].t);
const kidPaths = (app) => app.files('runs/validate-story/').filter(p => /run\.json$/.test(p));
async function decideKid(app, value, path) {
  path = path || kidPaths(app)[0];
  const kid = JSON.parse(app.fs.files[path].t), at = new Date(Date.now() + 1000).toISOString(), R = app.PF.run;
  kid.steps.verdict = { s: 'done', by: 'person-avery', at, values: { decision: value } };
  kid.details.disposition = value;
  const rr = R.sanitize(JSON.parse(JSON.stringify(kid))), mm = R.mapOf(rr);
  mm.phases.forEach(p => { if (p.gate) kid.gates[p.gate.id] = { s: 'passed', by: 'person-avery', at, approved: R.gateInputs(rr, mm, p.gate) }; });
  kid.ended = { outcome: 'Completed', by: 'person-avery', at }; kid.state = 'completed'; kid.rev = (kid.rev || 0) + 1;
  await app.fs.write(path, JSON.stringify(kid));
  app.click('refresh'); await app.tick(150);
}

rule('App: the recorder settles the step from its run\'s answer, and sends it back when that run is corrected', async () => {
  const app = await setup();
  app.click('start-child', 'story'); await app.tick(150);
  assert.strictEqual(kidPaths(app).length, 1, 'set-up: the child started');
  await decideKid(app, 'cleared');
  let a = parentRun(app).steps.story;
  assert.deepStrictEqual([a.s, a.child.result], ['done', 'cleared']);
  await decideKid(app, 'needs-work');
  a = parentRun(app).steps.story;
  assert.ok(a.s !== 'done', 'a corrected run no longer counts: ' + JSON.stringify(a));
  assert.strictEqual(parentRun(app).details.story_result, 'needs-work', 'settled again from the new answer');
});

rule('App: Start a new run on a step held by its run\'s result starts one', async () => {
  const app = await setup();
  app.click('start-child', 'story'); await app.tick(150);
  await decideKid(app, 'needs-work');
  assert.strictEqual(parentRun(app).steps.story.s, 'blocked');
  assert.ok(/Start a new Validate a story run/.test(app.html()), 'offered');
  app.click('start-child', 'story'); await app.tick(150);
  assert.strictEqual(kidPaths(app).length, 2, 'a second run started');
  const fresh = kidPaths(app).map(p => JSON.parse(app.fs.files[p].t)).filter(k => !k.ended)[0];
  assert.strictEqual(parentRun(app).steps.story.child.id, fresh && fresh.id, 'the step links the new run');
});

rule('App: accepted results are drawn escaped', async () => {
  const evil = '<img src=x onerror=alert`1`>';
  const app = await setup({ opts: [evil, 'needs-work'] });
  const html = app.html();
  assert.ok(!html.includes(evil), 'never raw');
  assert.ok(/checked when it completes with &lt;img src=x onerror=alert`1`&gt;/.test(html), String(html.match(/checked when it completes[^<]*/)));
});

rule('App: a bound result is read-only on the run, with where it comes from', async () => {
  const app = await setup();
  app.click('run-details'); await app.tick();
  const html = app.html();
  assert.ok(!/data-act="edit" data-id="detail:story_result"/.test(html), 'no editor for the imported result');
  assert.ok(/story_result[^<]*<\/span>(<span class="v">[^<]*<\/span>)?<span class="small">From Validate the story/.test(html) || /From the run &quot;Validate the story&quot;|From the run "Validate the story"|From Validate the story/.test(html), String(html.match(/[^>]*story_result[^<]*(<[^>]*>[^<]*){0,4}/)));
  assert.ok(/data-act="edit" data-id="detail:issue"/.test(html), 'other details stay editable');
});

rule('App: an ended run is never settled again; its step says the linked run\'s result changed after it ended', async () => {
  const app = await setup();
  app.click('start-child', 'story'); await app.tick(150);
  await decideKid(app, 'cleared');
  const path = app.files('runs/ship-stories/').find(p => /run\.json$/.test(p)), pr = JSON.parse(app.fs.files[path].t), R = app.PF.run, at = new Date().toISOString();
  pr.steps.ship1 = { s: 'done', by: 'person-avery', at };
  const rr = R.sanitize(JSON.parse(JSON.stringify(pr))), mm = R.mapOf(rr);
  mm.phases.forEach(p => { if (p.gate) pr.gates[p.gate.id] = { s: 'passed', by: 'person-avery', at, approved: R.gateInputs(rr, mm, p.gate) }; });
  pr.ended = { outcome: 'Completed', by: 'person-avery', at }; pr.state = 'completed'; pr.rev = (pr.rev || 0) + 1;
  await app.fs.write(path, JSON.stringify(pr));
  app.click('refresh'); await app.tick(150);
  const before = app.fs.files[path].t;
  await decideKid(app, 'needs-work');
  await app.tick(150);
  assert.strictEqual(app.fs.files[path].t, before, 'the ended run is never rewritten');
  app.click('open-run', 'ship-stories/' + pr.id); await app.tick(80);
  assert.ok(/A linked run&#39;s result changed after this run ended|A linked run's result changed after this run ended/.test(app.html()), 'said on the run');
  assert.ok(/A linked run(&#39;|')s result changed after this run ended<\/b> \(&quot;story&quot;\)/.test(app.html()), 'naming the step');
});

rule('App: a long accepted list is cut with how many more', async () => {
  const many = Array.from({ length: 80 }, (_, i) => 'v' + i).join(', ');
  const app = await setup({ accept: many });
  const html = app.html();
  assert.ok(/v48 or v49 or 30 more\./.test(html), String(html.match(/checked when it completes[^<]*/)).slice(-200));
});

rule('The publish panel says a draft with a result needs Flightdeck 3.0, and that teammates on 2.16 or earlier can\'t run it', async () => {
  const app = await setup();
  const md = KID(['cleared', 'needs-work']).replace('title: Validate a story', 'title: Validate a story again');
  await app.fs.write('maps/drafts/validate-story.md', md);
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'validate-story'); await app.tick();
  const h = app.html(), at = h.indexOf('pub-needs');
  assert.ok(at > 0 && /<b>Needs Flightdeck 3\.0:<\/b>/.test(h), 'set-up: the notice is drawn');
  assert.ok(/Teammates on Flightdeck 2\.16 or earlier see this version but can(&#39;|')t run it/.test(h), h.slice(at, at + 400));
});

run();
