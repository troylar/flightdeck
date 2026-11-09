// Living runs (4.0, docs/design.md 45), slice 2: the inbox and delegation. "N need you" opens exactly those N decisions,
// once each, paged; accepting binds the consequence shown, so one that changed since asks again; a delegation can be made
// and revoked, and a revoke while its request is queued sends it back to waiting; what the inbox remembers belongs to its
// folder.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot, gate } = require('./app-harness');

const MD = ['---', 'process: release-notes', 'title: Release notes', 'owner: person-avery', 'roles: reviewer', '---', '',
  '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', '',
  '## Review · READ-DO {#review}', '- [!] {confirm} @reviewer Read them {#read}', ''].join('\n');

async function setup(o) {
  o = Object.assign({}, o || {});
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, o)); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const b = PF.publish.build(o.md || MD, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand: 'rn000001', app: '4.0.0' });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  Object.keys(b.files).forEach(k => { app.fs.files['publications/release-notes/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-notes'); await app.settle();
  /* Blake holds the reviewer role, so Blake may decide; Casey holds none. */
  app.set('role-reviewer', 'person-blake'); app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  assert.strictEqual(theRun(app).roles.reviewer, 'person-blake', 'set-up: Blake reviews');
  assert.ok(runPath(app), 'set-up: a run was started');
  return app;
}
const runPath = (app) => app.files('runs/release-notes/').find(p => /run\.json$/.test(p));
const theRun = (app) => JSON.parse(app.fs.files[runPath(app)].t);
const apps = (app, id) => app.files('proposals/').filter(p => p.indexOf(id + '.status-') >= 0).map(p => Object.assign(JSON.parse(app.fs.files[p].t), { id: p.slice('proposals/'.length, -'.json'.length) })).filter(x => x.kind === 'application');
let seq = 0;
const hex = (n) => (++seq).toString(16).padStart(n, '0');
/* A person's request, and the recorder's or a role holder's decision accepting exactly what it would do. */
async function request(app, body, o) {
  o = o || {};
  const T = app.PF.todos, r = theRun(app), RUN = { process: r.process, id: r.id }, at = new Date().toISOString();
  const d = await app.PF.repo.loadAll(app.fs, {}), V = T.view(app.PF.run.sanitize(r), { records: d.todos || [], people: JSON.parse(app.fs.files['people.json'].t) });
  if (body.op === 'add' && !body.placement) body.placement = T.placementFor(app.PF.run.mapOf(app.PF.run.sanitize(r)), body.target);
  const p = T.buildProposal({ run: RUN, id: T.idFor('flightdeck', 'k-' + hex(6)), by: o.by || 'person-avery', seen: V.heads.slice(0, 50), at, body, app: '4.0.0' });
  await app.fs.write('proposals/' + p.id + '.json', T.text(p));
  if (o.decide !== false) {
    const rec = T.cleanFile(JSON.parse(T.text(p)), p.id + '.json').record, V2 = T.view(app.PF.run.sanitize(r), { records: (d.todos || []).concat([rec]), people: JSON.parse(app.fs.files['people.json'].t) });
    const C = T.consequenceOf(app.PF.run.sanitize(r), V2.map, V2.requests[p.id], V2).fingerprint;
    const s = T.buildStatus({ kind: 'decision', proposal: p.id, run: RUN, seen: [p.id], by: { person: o.decider || 'person-avery' }.person, at, op: 'accept', consequence: C, writer: 'w1', rev: hex(8), app: '4.0.0' });
    await app.fs.write('proposals/' + s.name, T.text(s.file));
  }
  return p;
}
const refresh = async (app, ms) => { app.click('refresh'); await app.tick(ms || 250); };
const setPeople = async (app, f) => { const ppl = JSON.parse(app.fs.files['people.json'].t), list = Array.isArray(ppl) ? ppl : ppl.people, next = list.map(f); await app.fs.write('people.json', JSON.stringify(Array.isArray(ppl) ? next : { people: next }, null, 2) + '\n'); };
const failing = (app, re) => { const fs = app.fs, write = fs.write.bind(fs); fs.write = (p, t, o) => re.test(p) ? Promise.reject(new Error('EIO')) : write(p, t, o); return () => { fs.write = write; }; };



const recs = (app) => app.files('proposals/').filter(p => /^proposals\/req-/.test(p));
const fresh = (app, before) => recs(app).filter(p => before.indexOf(p) < 0).map(p => JSON.parse(app.fs.files[p].t));
const ov = (app) => app.overlay() || '';
/* Show more, pressed as drawn: its data-* (page, step, focus, dialog) go with the click. */
const showMore = (app) => { const m = /<button[^>]*data-act="more"[^>]*>/.exec(ov(app)); assert.ok(m, 'Show more'); const id = /data-id="([^"]+)"/.exec(m[0])[1], d = {}; m[0].replace(/data-(page|step|focus|next|dialog)="([^"]*)"/g, (x, k, v) => { d[k] = v.replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }); app.click('more', id, d); };
const accepts = (h) => { const out = []; const re = /data-act="td-accept" data-id="([^"]+)" data-run="([^"]+)" data-fp="([^"]+)"/g; let m; while ((m = re.exec(h))) out.push({ id: m[1], run: m[2], fp: m[3] }); return out; };
async function asked(app, n, who) {
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(await request(app, { op: 'add', text: 'Asked ' + i, target: { phase: i % 2 ? 'review' : 'draft' } }, { by: who || 'person-casey', decide: false }));
  return ps;
}

rule('"N need you" on Home opens exactly those N decisions, once each, an older dispute among them', async () => {
  const app = await setup();
  const ps = await asked(app, 2, 'person-casey');
  const q = await request(app, { op: 'add', text: 'Disputed one', target: { phase: 'draft' } }, { by: 'person-casey', decide: false });
  await request(app, { op: 'add', text: 'Disputed one', target: { phase: 'draft' } }, { by: 'person-casey', decide: false });
  const T = app.PF.todos, r = app.PF.run.sanitize(theRun(app)), RUN = { process: r.process, id: r.id }, at = new Date().toISOString();
  const d = await app.PF.repo.loadAll(app.fs, {}), V = T.view(r, { records: d.todos, people: JSON.parse(app.fs.files['people.json'].t) });
  const C = T.consequenceOf(r, V.map, V.requests[q.id], V).fingerprint;
  for (const [by, op, w] of [['person-avery', 'accept', 'wa'], ['person-blake', 'decline', 'wb']]) { const s = T.buildStatus({ kind: 'decision', proposal: q.id, run: RUN, seen: [q.id], by, at, op, consequence: C, writer: w, rev: hex(8), app: '4.0.0' }); await app.fs.write('proposals/' + s.name, T.text(s.file)); }
  await refresh(app, 400);
  app.click('go', '', { view: 'home' }); await app.tick(40);
  const n = (app.html().match(/(\d+) to-do requests? needs? your decision/) || [])[1];
  app.click('td-inbox', ''); await app.tick(20);
  const got = accepts(ov(app));
  assert.strictEqual(Number(n), got.length, 'the number said is the number opened');
  assert.strictEqual(new Set(got.map(x => x.id)).size, got.length, 'each once');
  assert.ok(got.some(x => x.id === q.id) && /Decided two ways at once/.test(ov(app)), 'the older dispute is among them');
  assert.ok(ps.every(p => got.some(x => x.id === p.id)), 'and the waiting ones');
});
rule('A decision dispute on a request that already landed is in the inbox; settling it writes one decision and applies nothing again', async () => {
  const app = await setup();
  const p = await request(app, { op: 'add', text: 'Landed one', target: { phase: 'draft' } }, { by: 'person-casey' });
  await refresh(app, 400);
  assert.strictEqual(apps(app, p.id).length, 1, 'set-up: the recorder applied it');
  const T = app.PF.todos, r = app.PF.run.sanitize(theRun(app)), RUN = { process: r.process, id: r.id }, at = new Date().toISOString();
  const d = await app.PF.repo.loadAll(app.fs, {}), V = T.view(r, { records: d.todos, people: JSON.parse(app.fs.files['people.json'].t) });
  const no = T.buildStatus({ kind: 'decision', proposal: p.id, run: RUN, seen: [p.id], by: 'person-blake', at, op: 'decline', consequence: T.consequenceOf(r, V.map, V.requests[p.id], V).fingerprint, writer: 'wb', rev: hex(8), app: '4.0.0' });
  await app.fs.write('proposals/' + no.name, T.text(no.file));
  await refresh(app, 400);
  app.click('go', '', { view: 'home' }); await app.tick(40);
  assert.ok(/1 to-do request needs your decision/.test(app.html()), 'Home counts it');
  app.click('td-inbox', ''); await app.tick(20);
  const got = accepts(ov(app));
  assert.deepStrictEqual(got.map(x => x.id), [p.id], 'listed though it landed');
  assert.ok(/already applied/i.test(ov(app)) && /Decided two ways at once/.test(ov(app)), 'says it landed and is disputed');
  const before = recs(app);
  app.click('td-accept', got[0].id, { run: got[0].run, fp: got[0].fp }); await app.tick(60);
  const w = fresh(app, before);
  assert.deepStrictEqual(w.map(x => [x.kind, x.op, x.proposal]), [['decision', 'accept', p.id]], 'one decision, nothing applied');
  await refresh(app, 400);
  assert.strictEqual(apps(app, p.id).length, 1, 'never applied again');
  assert.strictEqual(accepts(ov(app) || '').length, 0, 'settled, it leaves the inbox');
});
rule('A run whose file can\'t be read asks nothing, and an open dialog writes nothing for it: decide, revoke or delegate', async () => {
  const app = await setup();
  const [p] = await asked(app, 1);
  const g = await (async () => { app.click('td-delegate'); await app.tick(10); app.set('tdg-who', 'notes-bot'); app.check('tdg-add', true); app.set('tdg-adds', '2'); app.click('td-delegate-save'); await app.tick(80); return recs(app).map(f => JSON.parse(app.fs.files[f].t)).filter(x => x.kind === 'grant')[0]; })();
  assert.ok(g, 'set-up: a delegation');
  app.click('close-overlay'); await app.tick(10);
  await refresh(app, 400);
  app.click('td-inbox', ''); await app.tick(20);
  const it = accepts(ov(app))[0];
  assert.strictEqual(it.id, p.id, 'set-up: it waits');
  const path = runPath(app), read = app.fs.read.bind(app.fs);
  app.fs.read = (f) => f === path ? Promise.reject(new Error('NotReadableError')) : read(f);
  await refresh(app, 400);
  const before = recs(app);
  app.click('td-accept', it.id, { run: it.run, fp: it.fp }); await app.tick(60);
  app.click('td-revoke', g.id, { run: it.run }); await app.tick(60);
  app.click('td-delegate'); await app.tick(10); app.set('tdg-who', 'other-bot'); app.check('tdg-add', true); app.set('tdg-adds', '1'); app.click('td-delegate-save'); await app.tick(80);
  assert.deepStrictEqual(fresh(app, before), [], 'nothing written while the run can\'t be read');
  app.click('close-overlay'); await app.tick(10);
  app.click('td-inbox', ''); await app.tick(20);
  assert.strictEqual(accepts(ov(app)).length, 0, 'and it asks nothing');
  app.fs.read = read;
});
rule('A delegation, revoke or decision that may have been saved, made again unchanged, is the same record: never a second grant', async () => {
  const app = await setup();
  const fs = app.fs, write = fs.write.bind(fs);
  let lose = true;
  fs.write = (p, t, o) => /^proposals\/req-/.test(p) && lose ? (lose = false, write(p, t, o).then(() => Promise.reject(new Error('EIO')))) : write(p, t, o);
  const before = recs(app), grants = () => recs(app).map(f => JSON.parse(app.fs.files[f].t)).filter(x => x.kind === 'grant');
  const delegate = async () => { app.click('td-delegate'); await app.tick(10); app.set('tdg-who', 'notes-bot'); app.check('tdg-add', true); app.set('tdg-adds', '10'); app.click('td-delegate-save'); await app.tick(80); };
  await delegate();
  assert.ok(/may or may not have been saved/.test(ov(app)), 'said');
  app.click('close-overlay'); await app.tick(10);
  await refresh(app, 400);
  await delegate();
  assert.strictEqual(grants().length, 1, 'one grant: ' + JSON.stringify(fresh(app, before).map(x => x.id)));
  app.click('close-overlay'); await app.tick(10);
  const [p] = await asked(app, 1);
  await refresh(app, 400);
  app.click('td-inbox', ''); await app.tick(20);
  const it = accepts(ov(app))[0], b2 = recs(app);
  lose = true;
  app.click('td-accept', it.id, { run: it.run, fp: it.fp }); await app.tick(60);
  app.click('td-accept', it.id, { run: it.run, fp: it.fp }); await app.tick(60);
  assert.deepStrictEqual(fresh(app, b2).map(x => [x.kind, x.proposal]), [['decision', p.id]], 'one decision');
});
rule('A decline\'s reason belongs to its request: picking another with a reason typed is refused, and nothing carries over', async () => {
  const app = await setup();
  await asked(app, 2);
  await refresh(app, 400);
  app.click('td-inbox', ''); await app.tick(20);
  const [x, y] = accepts(ov(app));
  app.click('td-decline-pick', x.id, { run: x.run }); await app.tick(10);
  app.set('td-dec-why', 'Not this one');
  app.click('td-decline-pick', y.id, { run: y.run }); await app.tick(10);
  assert.ok(new RegExp('data-act="td-decline" data-id="' + x.id + '"').test(ov(app)) && /Finish or cancel/.test(ov(app)), 'still on the first');
  app.click('td-decline-cancel'); await app.tick(10);
  app.click('td-decline-pick', y.id, { run: y.run }); await app.tick(10);
  assert.strictEqual(app.draft('td-dec-why'), '', 'nothing carried');
});
rule('An active delegation can always be ended: the run screen and Home offer Delegations when nothing waits for a decision', async () => {
  const app = await setup();
  app.click('td-delegate'); await app.tick(10);
  app.set('tdg-who', 'notes-bot'); app.check('tdg-add', true); app.set('tdg-adds', '3'); app.click('td-delegate-save'); await app.tick(80);
  app.click('close-overlay'); await app.tick(10);
  await refresh(app, 400);
  assert.ok(!/data-act="td-inbox"/.test(app.html()), 'set-up: nothing waits for a decision');
  const r = theRun(app), rk = r.process + '/' + r.id;
  assert.ok(new RegExp('data-act="td-grants" data-id="' + rk + '"').test(app.html()), 'the run screen offers Delegations');
  app.click('td-grants', rk); await app.tick(20);
  assert.ok(/data-act="td-revoke"/.test(ov(app)), 'which lists the one to end');
  app.click('close-overlay'); await app.tick(10);
  app.click('go', '', { view: 'home' }); await app.tick(40);
  assert.ok(/1 delegation you can end/.test(app.html()) && /data-act="td-grants"/.test(app.html()), 'Home offers it too');
  app.click('td-grants', ''); await app.tick(20);
  const m = /data-act="td-revoke" data-id="([^"]+)" data-run="([^"]+)"/.exec(ov(app));
  const before = recs(app);
  app.click('td-revoke', m[1], { run: m[2] }); await app.tick(60);
  assert.deepStrictEqual(fresh(app, before).map(x => x.kind), ['revoke']);
  await refresh(app, 400);
  app.click('go', '', { view: 'home' }); await app.tick(40);
  assert.ok(!/data-act="td-grants"/.test(app.html()), 'none left: no entry');
});
rule('More than ten wait: ten at a time, and Show more brings the rest', async () => {
  const app = await setup();
  await asked(app, 12);
  await refresh(app, 400);
  app.click('td-inbox', ''); await app.tick(20);
  assert.strictEqual(accepts(ov(app)).length, 10, 'a page');
  showMore(app); await app.tick(20);
  assert.strictEqual(accepts(ov(app)).length, 12, 'all of them');
});
rule('Accepting binds what was shown: when what it would do changed since, nothing is written and it asks again', async () => {
  const app = await setup();
  const [p] = await asked(app, 1);
  await refresh(app, 400);
  app.click('td-inbox', ''); await app.tick(20);
  const old = accepts(ov(app))[0];
  app.click('close-overlay'); await app.tick(10);
  app.click('record', 'write'); await app.tick(80);
  app.click('pick', 'draft-confirm', { kind: 'pass' }); await app.tick(10); app.click('pass', '0'); await app.tick(120);
  assert.ok(/"s": "passed"/.test(JSON.stringify(theRun(app).gates, null, 1)), 'set-up: the gate passed meanwhile');
  app.click('td-inbox', ''); await app.tick(20);
  const before = recs(app);
  app.click('td-accept', old.id, { run: old.run, fp: old.fp }); await app.tick(60);
  assert.deepStrictEqual(fresh(app, before), [], 'nothing written');
  assert.ok(/changed since you saw it/.test(ov(app)) && /sends 1 approval back for review/.test(ov(app)), 'says what it would do now');
  const now = accepts(ov(app))[0];
  assert.ok(now.fp !== old.fp, 'shown again as it is now');
  app.click('td-accept', now.id, { run: now.run, fp: now.fp }); await app.tick(60);
  const w = fresh(app, before);
  assert.deepStrictEqual([w.length, w[0].kind, w[0].op, w[0].proposal], [1, 'decision', 'accept', p.id]);
  assert.ok(/Queued for the recorder/.test(ov(app)), 'and says it is queued');
});
rule('Declining takes an optional reason, writes one decision, and the request leaves the list', async () => {
  const app = await setup();
  const [p] = await asked(app, 1);
  await refresh(app, 400);
  app.click('td-inbox', ''); await app.tick(20);
  const before = recs(app), it = accepts(ov(app))[0];
  app.click('td-decline-pick', it.id, { run: it.run }); await app.tick(10);
  assert.ok(/id="td-dec-why"/.test(ov(app)));
  app.set('td-dec-why', 'Not in this release'); app.click('td-decline', it.id, { run: it.run }); await app.tick(60);
  const w = fresh(app, before);
  assert.deepStrictEqual([w.length, w[0].op, w[0].reason, w[0].proposal], [1, 'decline', 'Not in this release', p.id]);
  assert.strictEqual(accepts(ov(app)).length, 0, 'gone from the list');
});
rule('A delegation made here lets a tool add without asking; revoked while its request is queued, the request waits for a person again', async () => {
  const app = await setup();
  app.click('td-delegate'); await app.tick(10);
  assert.ok(/id="tdg-who"/.test(ov(app)), 'the dialog');
  let before = recs(app);
  app.set('tdg-who', 'notes-bot'); app.check('tdg-add', true); app.set('tdg-adds', ''); app.click('td-delegate-save'); await app.tick(20);
  assert.deepStrictEqual(fresh(app, before), [], 'no number: nothing written');
  assert.ok(/whole number/.test(ov(app)), 'said');
  app.set('tdg-adds', '10'); app.click('td-delegate-save'); await app.tick(60);
  const g = fresh(app, before);
  assert.deepStrictEqual([g.length, g[0].kind, g[0].subject, g[0].ops, g[0].targets, g[0].limits], [1, 'grant', { tool: 'notes-bot' }, ['add'], [{ phase: 'draft' }], { adds: 10 }]);
  app.click('close-overlay'); await app.tick(10);
  app.choose('person-blake'); await app.tick();
  await refresh(app, 300);
  const T = app.PF.todos, r = app.PF.run.sanitize(theRun(app));
  const t = T.buildProposal({ run: { process: r.process, id: r.id }, producer: { name: 'notes-bot', version: '1.0' }, key: 'bot-1', seen: [g[0].id], at: new Date().toISOString(), body: { op: 'add', text: 'From the bot', target: { phase: 'draft' }, placement: T.placementFor(app.PF.run.mapOf(r), { phase: 'draft' }) }, app: '4.0.0' });
  await app.fs.write('proposals/' + t.id + '.json', T.text(t));
  await refresh(app, 400);
  const status = async () => { const d = await app.PF.repo.loadAll(app.fs, {}); return T.view(app.PF.run.sanitize(theRun(app)), { records: d.todos, people: JSON.parse(app.fs.files['people.json'].t) }).requests[t.id].status; };
  assert.strictEqual(await status(), 'queued', 'set-up: queued by the delegation, the recorder\'s window not open');
  app.click('td-inbox', ''); await app.tick(20);
  const m = /data-act="td-revoke" data-id="([^"]+)" data-run="([^"]+)"/.exec(ov(app));
  assert.ok(m, 'Blake may end it');
  before = recs(app);
  app.click('td-revoke', m[1], { run: m[2] }); await app.tick(60);
  const x = fresh(app, before);
  assert.deepStrictEqual([x.length, x[0].kind, x[0].grant, x[0].by], [1, 'revoke', g[0].id, 'person-blake']);
  assert.strictEqual(await status(), 'waiting', 'back to waiting');
  await refresh(app, 300);
  app.click('td-inbox', ''); await app.tick(20);
  assert.ok(accepts(ov(app)).some(y => y.id === t.id), 'and in Blake\'s list now');
});
rule('Someone who may not decide is asked nothing and offered no delegation', async () => {
  const app = await setup();
  await asked(app, 2, 'person-blake');
  app.choose('person-casey'); await app.tick(); await refresh(app, 300);
  assert.ok(!/data-act="td-inbox"/.test(app.html()) && !/data-act="td-delegate"/.test(app.html()));
});
rule('What the inbox remembers belongs to its folder: a copy of the run in another folder opens fresh', async () => {
  const app = await setup();
  await asked(app, 12);
  await refresh(app, 400);
  app.click('td-inbox', ''); await app.tick(20);
  const it = accepts(ov(app))[0];
  app.click('td-decline-pick', it.id, { run: it.run }); await app.tick(10);
  showMore(app); await app.tick(20);
  assert.ok(/id="td-dec-why"/.test(ov(app)) && accepts(ov(app)).length >= 11, 'set-up: a decline open, every row shown');
  const files = Object.assign({}, app.fs.files);
  app.click('close-overlay'); await app.tick(10);
  app.click('reset-examples'); await app.tick(60);
  Object.keys(files).filter(k => /^(runs\/release-notes|publications\/release-notes|proposals)\//.test(k)).forEach(k => { app.fs.files[k] = files[k]; });
  app.choose('person-avery'); await app.tick(); await refresh(app, 400);
  app.click('td-inbox', ''); await app.tick(20);
  assert.ok(!/id="td-dec-why"/.test(ov(app)), 'no decline open');
  assert.strictEqual(accepts(ov(app)).length, 10, 'the first page');
});
run();
