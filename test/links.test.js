// What a linked step passes to its child (2.8): the pass: line, what it means with and without carry:, and the minimal lines
// the builder writes back (docs/design.md 40).
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), M = PF.map, L = PF.links;
const same = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);

const child = (ctx, extra) => M.parse(['---', 'process: deploy', 'title: Deploy', 'context: ' + ctx, '---', '', '## Go · READ-DO {#go}', '- [ ] {confirm} Go {#go1}', extra || '', ''].join('\n'));
const step = (fields) => ({ id: 'dep', type: 'run.process', fields: Object.assign({ process: 'deploy' }, fields), binds: [] });
const PARENT = ['commit', 'env', 'region', 'tag'];
const shape = (rows) => rows.rows.map(r => r.name + '<' + r.source + (r.from ? ':' + r.from : '') + (r.value != null ? '=' + r.value : '') + (r.childSets ? '*' : ''));

rule('parse: each source form, spaces around = and , allowed', () => {
  const p = L.parse('environment = ^env , region=us-east-1,notify=?');
  same(p.errors, []);
  same(p.entries.map(e => [e.name, e.source, e.from || e.value || '']), [['environment', 'detail', 'env'], ['region', 'value', 'us-east-1'], ['notify', 'ask', '']]);
});

rule('parse: refusals name the entry', () => {
  const bad = {
    'a=^b,,c=^d': /empty entry/,
    'a': /"a" needs a name, =, and where its value comes from/,
    '=^x': /needs a name/,
    'a b=^c': /isn't a run detail name/,
    '__proto__=^x': /keeps for itself/,
    'a=^b, a=^c': /names "a" twice/,
    'a=': /says where its value comes from/,
    'a=^': /isn't a run detail/,
    'a=^b c': /can't hold \^/,
    'a=x^y': /can't hold \^/,
    'a=team:base': /Team values aren't available yet/,
    'a=line\u0001break': /control character/
  };
  Object.keys(bad).forEach(t => { const p = L.parse(t); assert.ok(p.errors.some(e => bad[t].test(e)), t + ': ' + JSON.stringify(p.errors)); });
  assert.ok(L.parse('a=' + 'x'.repeat(121)).errors.some(e => /at most 120 characters/.test(e)));
  assert.ok(!L.parse('a=' + 'x'.repeat(120)).errors.length);
  const many = Array.from({ length: 41 }, (_, i) => 'd' + i + '=?').join(', ');
  assert.ok(L.parse(many).errors.some(e => /at most 40/.test(e)));
});

rule('rows: no carry: passes every shared detail by name, pass: entries win, ? asks instead', () => {
  const c = child('env, region, notify, tag');
  same(shape(L.rows(step({}), PARENT, c)), ['env<detail:env', 'region<detail:region', 'notify<ask', 'tag<detail:tag']);
  same(shape(L.rows(step({ pass: 'env=prod, region=?, notify=^commit' }), PARENT, c)), ['env<value=prod', 'region<ask', 'notify<detail:commit', 'tag<detail:tag']);
});

rule('rows: with carry: exactly what carry: and pass: list; the rest is asked', () => {
  const c = child('env, region, notify, tag');
  same(shape(L.rows(step({ carry: 'tag' }), PARENT, c)), ['env<ask', 'region<ask', 'notify<ask', 'tag<detail:tag']);
  same(shape(L.rows(step({ carry: 'tag', pass: 'env=^region' }), PARENT, c)), ['env<detail:region', 'region<ask', 'notify<ask', 'tag<detail:tag']);
});

rule('rows: names the child doesn\'t have come back as stale, and a detail the child also sets keeps its source', () => {
  const c = child('env, pr', '  sets: pr');
  const r = L.rows(step({ carry: 'env, gone', pass: 'old=^tag, pr=^commit' }), PARENT, c);
  same(shape(r), ['env<detail:env', 'pr<detail:commit*']);
  same(r.stale, [{ name: 'gone', where: 'carry' }, { name: 'old', where: 'pass' }]);
});

rule('write: implicit stays implicit; only renamed, fixed and asked shared names are written', () => {
  const c = child('env, region, notify, tag'), s = step({});
  const rows = L.rows(s, PARENT, c);
  rows.rows[0] = { name: 'env', source: 'detail', from: 'region' };
  rows.rows[1] = { name: 'region', source: 'ask' };
  rows.rows[2] = { name: 'notify', source: 'value', value: 'ops' };
  const w = L.write(rows.rows, s, PARENT, c);
  same(w, { carry: null, pass: 'env=^region, region=?, notify=ops' });
  same(shape(L.rows(step({ pass: w.pass }), PARENT, c)), ['env<detail:region', 'region<ask', 'notify<value=ops', 'tag<detail:tag']);
});

rule('write: an explicit carry: is kept; a same-name source is added to it or removed from it, never written in pass:', () => {
  const c = child('env, region, tag'), s = step({ carry: 'tag' });
  const add = L.rows(s, PARENT, c).rows.map(r => r.name === 'region' ? { name: 'region', source: 'detail', from: 'region' } : r);
  same(L.write(add, s, PARENT, c), { carry: 'tag, region', pass: null });
  const s2 = step({ carry: 'tag, region' });
  const drop = L.rows(s2, PARENT, c).rows.map(r => r.name === 'region' ? { name: 'region', source: 'ask' } : r);
  same(L.write(drop, s2, PARENT, c), { carry: 'tag', pass: null });
});

rule('write: the last carry: name removed drops the line and asks every other shared detail, so nothing new is passed', () => {
  const c = child('env, region, tag'), s = step({ carry: 'tag' });
  const rows = L.rows(s, PARENT, c).rows.map(r => r.name === 'tag' ? { name: 'tag', source: 'detail', from: 'commit' } : r);
  const w = L.write(rows, s, PARENT, c);
  same(w, { carry: null, pass: 'env=?, region=?, tag=^commit' });
  same(shape(L.rows(step({ pass: w.pass }), PARENT, c)), shape({ rows }));
});

rule('write keeps stale entries (only Remove takes them out) and existing order', () => {
  const c = child('env, region'), s = step({ carry: 'env, gone', pass: 'region=^tag, old=^commit' });
  same(L.write(L.rows(s, PARENT, c).rows, s, PARENT, c), { carry: 'env, gone', pass: 'region=^tag, old=^commit' });
});

rule('round trip: rows(write(rows)) is rows, for every source on every name, with and without carry:', () => {
  const c = child('env, region, tag'), names = ['env', 'region', 'tag'];
  const sources = [{ source: 'ask' }, { source: 'value', value: 'x1' }].concat(PARENT.map(p => ({ source: 'detail', from: p })));
  [step({}), step({ carry: 'tag' }), step({ carry: 'env, region' })].forEach(s => {
    sources.forEach(a => sources.forEach(b => {
      const want = names.map((n, i) => Object.assign({ name: n }, i === 0 ? a : i === 1 ? b : { source: 'ask' }));
      const w = L.write(want, s, PARENT, c), back = L.rows(step({ carry: w.carry == null ? undefined : w.carry, pass: w.pass == null ? undefined : w.pass }), PARENT, c);
      same(shape(back), shape({ rows: want }), JSON.stringify([s.fields, want, w]));
    }));
  });
});

rule('values: child-keyed; one parent detail can feed two child names; a parent detail with no value isn\'t passed', () => {
  const c = child('env, region, tag'), r = { details: { env: 'prod', region: 'eu', tag: '' } };
  same(L.values(r, step({ pass: 'env=^env, region=^env' }), c), { env: 'prod', region: 'prod', tag: '' });
  same(L.values(r, step({ carry: 'env', pass: 'region=west' }), c), { env: 'prod', region: 'west' });
  same(L.values({ details: { tag: 'v1' } }, step({ pass: 'env=^env' }), c), { tag: 'v1' });
});

rule('sources and inputs: parent-keyed; an overridden implicit name isn\'t consumed unless it\'s a tie', () => {
  const c = child('env, region, tag'), r = { details: { env: 'prod', region: 'eu', tag: 'v1', commit: 'abc' } };
  const s = step({ pass: 'env=?, region=^commit' });
  same(L.sources(s, PARENT, c).sort(), ['commit', 'tag']);
  same(L.inputs(r, s, PARENT, c), { commit: 'abc', tag: 'v1' });
  same(L.inputs(r, Object.assign(s, { binds: ['env'] }), PARENT, c), { env: 'prod', commit: 'abc', tag: 'v1' });
  same(L.inputs(r, step({ pass: 'region=^tag', sets: 'tag' }), PARENT, c), { env: 'prod' });
});

rule('has: only a step with a pass: line takes the new paths', () => {
  assert.strictEqual(L.has(step({})), false); assert.strictEqual(L.has(step({ carry: 'x' })), false);
  assert.strictEqual(L.has(step({ pass: '' })), true); assert.strictEqual(L.has(step({ pass: 'a=?' })), true);
  assert.strictEqual(L.has({ type: 'confirm', fields: { pass: 'a=?' } }), false);
});

/* ---------- the checks (C1, C2) ---------- */
const PMAP = (stepLines, ctx) => ['---', 'process: release', 'title: Release', 'context: ' + (ctx || 'commit, env, region, tag, replicas:number'), '---', '',
  '## Ship · READ-DO {#ship}', '- [ ] {confirm} Tag it {#tagit}', '  sets: tag', '- [ ] {run.process} Deploy the build {#dep}', '  process: deploy'].concat(stepLines).concat(['']).join('\n');
const KID = child('environment, region, replicas:number, pr', '  sets: pr');
const kids = (got) => () => got;
const chk = (lines, got, ctx) => M.check(M.parse(PMAP(lines, ctx)), { children: kids(got) });
const has = (list, re) => list.some(m => re.test(m));

rule('checks: pass: problems that stop publishing, with or without the child', () => {
  let c = chk(['  carry: env', '  pass: env=^commit'], null);
  assert.ok(has(c.blockers, /gives \^env in both carry: and pass:/), c.blockers.join('\n'));
  c = chk(['  pass: environment=^enviroment'], null);
  assert.ok(has(c.blockers, /passes \^enviroment, which isn't listed in context\. Did you mean \^environment\?|passes \^enviroment, which isn't listed in context/), c.blockers.join('\n'));
  c = chk(['  sets: tag', '  pass: environment=^tag'], null);
  assert.ok(has(c.blockers, /passes \^tag and sets it/), c.blockers.join('\n'));
  c = chk(['  pass: environment=^env,, x=1'], null);
  assert.ok(has(c.blockers, /Step "Deploy the build" pass: has an empty entry/), c.blockers.join('\n'));
});

rule('checks against the child: a target or carry: name it lacks and a fixed value of the wrong kind block; Latest and pinned are named', () => {
  const latest = { map: KID, title: 'Deploy', version: 6, latest: true }, pinned = { map: KID, title: 'Deploy', version: 4 };
  let c = chk(['  pass: zone=^region'], latest);
  assert.ok(has(c.blockers, /^Deploy's latest version \(v6\) has no run detail zone, so step "Deploy the build" can't pass it\. Choose one it has, or remove it from pass:\.$/), c.blockers.join('\n'));
  c = chk(['  carry: env'], pinned);
  assert.ok(has(c.blockers, /^Deploy v4 has no run detail env, so step "Deploy the build" can't pass it\. Choose one it has, or remove it from carry:\.$/), c.blockers.join('\n'));
  c = chk(['  pass: replicas=three'], pinned);
  assert.ok(has(c.blockers, /Deploy v4's \^replicas is a number; "three" isn't one/), c.blockers.join('\n'));
  assert.ok(!chk(['  pass: replicas=3'], pinned).blockers.length, 'a number is fine');
});

rule('checks: suggestions for an unpublished child, a conversion, a detail the child also sets, and a source that may not be set yet', () => {
  let c = chk(['  pass: environment=^env'], { unpublished: true });
  assert.ok(has(c.suggestions, /"deploy" isn't published yet, so what it needs can't be checked/), c.suggestions.join('\n'));
  assert.ok(!c.blockers.length, c.blockers.join('\n'));
  c = chk(['  pass: replicas=^env'], { map: KID, title: 'Deploy', version: 4 });
  assert.ok(has(c.suggestions, /\^env goes into Deploy v4's \^replicas, which is a number\. Converted when it starts/), c.suggestions.join('\n'));
  c = chk(['  pass: pr=^commit'], { map: KID, title: 'Deploy', version: 4 });
  assert.ok(has(c.suggestions, /passes \^pr, which Deploy also sets itself later/), c.suggestions.join('\n'));
  const late = M.parse(PMAP(['  pass: environment=^tag']).replace('- [ ] {confirm} Tag it {#tagit}\n  sets: tag\n', '').replace('  process: deploy\n  pass: environment=^tag', '  process: deploy\n  pass: environment=^tag\n- [ ] {confirm} Tag it {#tagit}\n  sets: tag'));
  assert.ok(has(M.check(late, {}).suggestions, /\^tag may not be set yet here/), M.check(late, {}).suggestions.join('\n'));
  c = chk(['  pass: environment=^env'], { unreadable: 'publications/deploy/v4-ab12/publication.json can\'t be read.' });
  assert.ok(has(c.blockers, /can't be read\. So what it passes to "deploy" can't be checked\./), c.blockers.join('\n'));
});

rule('format: passed-details only with a pass: line; a carry-only checklist uses no new feature', () => {
  same(M.features(M.parse(PMAP(['  carry: env'], 'commit, env, region, tag'))), []);
  same(M.features(M.parse(PMAP(['  pass: environment=^env'], 'commit, env, region, tag'))), ['passed-details']);
  same(M.features(M.parse(PMAP(['  version: 3', '  pass: environment=^env'], 'commit, env, region, tag'))), ['pinned-children', 'passed-details']);
  assert.ok(has(M.check(M.parse(PMAP([]).replace('{confirm} Tag it {#tagit}', '{confirm} Tag it {#tagit}\n  pass: a=?'))).blockers, /has a field "pass" that \{confirm\} doesn't use/));
  assert.strictEqual(PF.publish.unrunnable(PMAP(['  pass: a=,']), {}).indexOf('says where its value comes from') >= 0, true);
});

rule('the example folder gets no new blockers or suggestions from the link checks', () => {
  const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '..', 'example-folder', 'maps', 'drafts');
  const ex = {}; fs.readdirSync(dir).filter(f => f.endsWith('.md')).forEach(f => { ex[f.slice(0, -3)] = fs.readFileSync(path.join(dir, f), 'utf8'); });
  assert.ok(Object.keys(ex).length > 1);
  Object.keys(ex).forEach(k => {
    const m = M.parse(ex[k]);
    const a = M.check(m, {}), b = M.check(m, { children: (id) => { const t = ex[id]; return t ? { map: M.parse(t), title: id, version: 1, latest: true } : { unpublished: true }; } });
    same(b.blockers, a.blockers, k); same(b.suggestions.filter(x => !/isn't published yet, so what it needs/.test(x)), a.suggestions, k);
  });
});

/* ---------- Run time: starting, keeping current, and judging a child through its pass: line ---------- */

const P = PF.publish, R = PF.run;
const NOW = '2026-10-26T09:00:00.000Z';
const { exactOf } = require('./harness');
function published(md) {
  const b = P.build(md, { people: [], customTypes: {}, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'abcd1234', app: '2.8.0' });
  assert.ok(!b.blockers, (b.blockers || []).join(' | '));
  const v = P.verify(b.folder, b.files, exactOf(PF, b.files));
  assert.ok(v.ok, v.why);
  return v;
}
const DEPLOY = ['---', 'process: deploy', 'title: Deploy', 'context: environment, region, ticket, notify', 'roles: lead', '---', '', '## Go · READ-DO {#go}', '- [ ] {confirm} Go {#go1}', ''].join('\n');
const RELEASE = (fields) => ['---', 'process: rel', 'title: Release', 'context: env, ticket, region', 'roles: lead', '---', '', '## Ship · READ-DO {#ship}',
  '- [ ] {run.process} Deploy it {#dep}', '  process: deploy'].concat(fields || []).concat(['']).join('\n');
const startRun = (v, details, id) => R.create(v, { title: 'R', details, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id, app: '2.8.0' });
function linked(fields, details) {
  const parent = startRun(published(RELEASE(fields)), details || { env: 'prod', ticket: 'T-1', region: 'eu' }, 'run-p');
  const st = M.findStep(R.mapOf(parent), 'dep').step, cmap = M.parse(DEPLOY);
  return { parent, st, cmap, dv: published(DEPLOY) };
}

rule('Run time: a step without pass: keeps the 2.7 answers for what its child starts with', () => {
  const x = linked(['  carry: ticket']);
  assert.ok(!L.has(x.st));
  same(R.childDetails(x.parent, x.st, x.cmap.meta.context), { ticket: 'T-1' });
});

rule('Run time: a pass: step starts its child with the renamed source and the fixed value, by the child\'s names', () => {
  const x = linked(['  pass: environment=^env, region=us-east-1, notify=?']);
  assert.ok(L.has(x.st));
  same(R.childDetails(x.parent, x.st, x.cmap), { environment: 'prod', region: 'us-east-1', ticket: 'T-1' });
  same(R.childDetails(x.parent, x.st, x.cmap.meta.context), { environment: 'prod', region: 'us-east-1', ticket: 'T-1' }, 'a context list works too');
  same(L.inputs(x.parent, x.st, Object.keys(x.parent.details), x.cmap), { env: 'prod', ticket: 'T-1' }, 'the snapshot is by the parent\'s names');
  assert.strictEqual(R.childProblem(x.parent, x.st, x.cmap.meta.context), null);
});

rule('Run time: a pass: name the child lacks is refused before anything starts', () => {
  const x = linked(['  pass: stage=^env']);
  assert.ok(/no run detail stage/.test(R.childProblem(x.parent, x.st, x.cmap.meta.context)));
});

function judged(fields, inputs, childDetails, outcome) {
  const x = linked(fields), kid = startRun(x.dv, childDetails, 'run-k');
  kid.ended = { outcome: outcome || 'Completed' };
  x.parent.steps.dep = { s: 'open', child: { process: 'deploy', id: 'run-k', inputs } };
  return R.childVerdict(x.parent, x.st, x.parent.steps.dep, kid, () => null);
}
rule('Run time: the child is judged on each passed value under its own name', () => {
  const F = ['  pass: environment=^env, region=us-east-1, notify=?'], IN = { env: 'prod', ticket: 'T-1' };
  same(judged(F, IN, { environment: 'prod', region: 'us-east-1', ticket: 'T-1', notify: 'ops' }), { s: 'done' });
  assert.ok(/environment "dev"/.test(judged(F, IN, { environment: 'dev', region: 'us-east-1', ticket: 'T-1', notify: '' }).reason), 'a renamed source changed');
  assert.ok(/region "eu"/.test(judged(F, IN, { environment: 'prod', region: 'eu', ticket: 'T-1', notify: '' }).reason), 'a fixed value changed in the child');
  same(judged(F, IN, { environment: 'prod', region: 'us-east-1', ticket: 'T-1', notify: 'anything' }), { s: 'done' }, 'what it asked is the child\'s own');
  assert.ok(/ended: Canceled/.test(judged(F, IN, { environment: 'prod', region: 'us-east-1', ticket: 'T-1', notify: '' }, 'Canceled').reason));
});

rule('Run time: one source passed to two names counts for both', () => {
  const F = ['  pass: environment=^env, notify=^env'], IN = { env: 'prod', ticket: 'T-1', region: 'eu' };
  same(judged(F, IN, { environment: 'prod', region: 'eu', ticket: 'T-1', notify: 'prod' }), { s: 'done' });
  assert.ok(/notify "x"/.test(judged(F, IN, { environment: 'prod', region: 'eu', ticket: 'T-1', notify: 'x' }).reason));
});

rule('Run time: a child stops being current when a pass: source isn\'t in what it was started from', () => {
  const x = linked(['  pass: environment=^env']);
  assert.ok(R.childCurrent(x.parent, x.st, { child: { process: 'deploy', id: 'k', inputs: { env: 'prod', ticket: 'T-1', region: 'eu' } } }));
  assert.ok(!R.childCurrent(x.parent, x.st, { child: { process: 'deploy', id: 'k', inputs: { ticket: 'T-1', region: 'eu' } } }), 'started before env was its source');
  x.parent.details.env = 'dev';
  assert.ok(!R.childCurrent(x.parent, x.st, { child: { process: 'deploy', id: 'k', inputs: { env: 'prod', ticket: 'T-1', region: 'eu' } } }), 'the source changed since');
});

rule('Run time: a migration waiting in the child on a renamed source holds the step; resolved to the same value it counts', () => {
  const x = linked(['  pass: environment=^env']), kid = startRun(x.dv, { environment: 'Prod', region: 'eu', ticket: 'T-1', notify: '' }, 'run-k');
  kid.ended = { outcome: 'Completed' };
  kid.migrations = [{ path: 'details.environment', from: 'prod', verdict: 'ambiguous', resolved: null }];
  x.parent.steps.dep = { s: 'open', child: { process: 'deploy', id: 'run-k', inputs: { env: 'prod', ticket: 'T-1', region: 'eu' } } };
  assert.strictEqual(R.childVerdict(x.parent, x.st, x.parent.steps.dep, kid, () => null), null, 'held');
  kid.migrations[0].resolved = { value: 'Prod' };
  same(R.childVerdict(x.parent, x.st, x.parent.steps.dep, kid, () => null), { s: 'done' });
});

/* ---------- Publishing: every child read fresh from the folder, winning over what the caller had ---------- */

rule('Publishing reads each child from the folder: a pass: name the child lacks blocks it, even when the caller\'s copy had it', async () => {
  const fsm = new PF.fs.MemoryFS('links:' + Math.random(), null), repo = PF.repo, people = [];
  const base = { people, customTypes: {}, by: 'person-avery', changes: 'First', existing: [], now: NOW, app: '2.8.0' };
  const put = (md, id, rand) => { const b = P.build(md, Object.assign({}, base, { rand })); assert.ok(!b.blockers, JSON.stringify(b.blockers)); Object.keys(b.files).forEach(k => fsm.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }); };
  put(DEPLOY.replace('environment, region, ticket, notify', 'region, ticket, notify'), 'deploy', 'dp000001');
  const stale = { deploy: { latest: { map: M.parse(DEPLOY), info: { version: 1 } }, all: [], clashes: [], broken: [] } };
  const res = await repo.publish(fsm, RELEASE(['  pass: environment=^env']), Object.assign({}, base, { rand: 'rl000001', childProcs: stale }));
  assert.ok(res.blockers && res.blockers.some(b => /Deploy's latest version \(v1\) has no run detail environment/.test(b)), JSON.stringify(res.blockers));
  const ok = await repo.publish(fsm, RELEASE(['  pass: region=^env']), Object.assign({}, base, { rand: 'rl000002' }));
  assert.ok(!ok.blockers, JSON.stringify(ok.blockers));
});

/* ---------- C3: a child changed later is flagged from the shared verdict, explicit targets only ---------- */

rule('A child that drops a detail breaks only an explicit target: carry: or pass: names it, never an implicit share', () => {
  const lacking = M.parse(DEPLOY.replace('environment, region, ticket, notify', 'region, notify'));
  const kids = L.childrenFrom({ deploy: { latest: { map: lacking, info: { version: 3 } }, all: [], clashes: [], broken: [] } });
  same(L.broken(M.parse(RELEASE([])), kids), [], 'ticket was only shared: it drops out');
  same(L.broken(M.parse(RELEASE(['  pass: region=^region'])), kids), [], 'what is still there is fine');
  same(L.broken(M.parse(RELEASE(['  pass: environment=^env'])), kids).map(b => [b.child, b.version, b.names]), [['deploy', 3, ['environment']]]);
  same(L.broken(M.parse(RELEASE(['  carry: ticket'])), kids).map(b => b.names), [['ticket']]);
  same(L.broken(M.parse(RELEASE(['  version: 1', '  carry: ticket'])), kids), [], 'a pinned version doesn\'t follow later ones');
  const parents = [{ id: 'rel', latest: { map: M.parse(RELEASE(['  pass: environment=^env'])) } }, { id: 'other', latest: { map: M.parse(RELEASE([]).replace('process: rel', 'process: other')) } }];
  same(L.parentsBroken(lacking, parents).map(b => [b.process, b.names]), [['rel', ['environment']]]);
  const c = M.check(lacking, { parents });
  assert.ok(c.suggestions.some(x => /Release \(published\) step "Deploy it" passes \^environment to this checklist/.test(x)), JSON.stringify(c.suggestions));
});

rule('Folder health names a linked step that can\'t start its child, with a way to open the parent', () => {
  const lacking = M.parse(DEPLOY.replace('environment, region, ticket, notify', 'region, notify'));
  const procs = [{ id: 'rel', latest: { map: M.parse(RELEASE(['  pass: environment=^env'])), info: { version: 1 } } }, { id: 'deploy', latest: { map: lacking, info: { version: 3 } } }];
  const rep = PF.health.check({ data: { processes: procs, runs: [], people: [] } }, Date.parse(NOW));
  const i = rep.issues.filter(x => /^link-broken:/.test(x.id));
  assert.strictEqual(i.length, 1, JSON.stringify(rep.issues.map(x => x.id)));
  assert.ok(/passes environment to Deploy, whose latest version \(v3\)/.test(i[0].detail) && i[0].action.act === 'open-process' && i[0].action.id === 'rel');
});

/* ---------- Part G: each step's inputs and outputs ---------- */

rule('io: a step uses its refs, ties, conditions and what it passes; a linked step without a child map says it may share more', () => {
  const md = ['---', 'process: rel', 'title: Release', 'context: env, ticket, region, pr', 'roles: lead', '---', '', '## Ship · READ-DO {#ship}',
    '- [ ] {confirm} Open the PR for ^ticket {#open}', '  sets: pr',
    '- [ ] {run.process} Deploy it {#dep}', '  process: deploy', '  pass: environment=^env, notify=?', '  only when ^region is set', ''].join('\n');
  const map = M.parse(md), open = M.findStep(map, 'open').step, dep = M.findStep(map, 'dep').step;
  const a = L.io(map, open, null);
  same(a.uses.map(u => u.name), ['ticket']); same(a.sets, ['pr']);
  assert.strictEqual(a.uses[0].where, 'asked when a run starts');
  const b = L.io(map, dep, null);
  same(b.uses.map(u => u.name), ['region', 'env']); assert.ok(b.shared, 'implicit sharing can\'t be listed without the child');
  const c = L.io(map, dep, M.parse(DEPLOY));
  same(c.uses.map(u => u.name).sort(), ['env', 'region', 'ticket']); assert.ok(!c.shared);
  same(c.passes.map(r => r.name + ':' + r.source), ['environment:detail', 'region:detail', 'ticket:detail', 'notify:ask']);
  const d = L.io(M.parse(md.replace('  pass: environment=^env, notify=?', '  carry: ticket\n  pass: environment=^env')), M.findStep(M.parse(md.replace('  pass: environment=^env, notify=?', '  carry: ticket\n  pass: environment=^env')), 'dep').step, null);
  same(d.uses.map(u => u.name), ['region', 'ticket', 'env']); assert.ok(!d.shared, 'explicit carry: lists everything');
});

run();
