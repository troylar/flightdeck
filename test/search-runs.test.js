// Jira search steps in runs (2.16, design section 5): generations at start, the record-time check, Block with these,
// corrections, a detail changing (A to B to A), Refresh search, recovery, and the reader's reopen (5.7, 5.9 R14-4/6/7).
// Every refusal is checked to leave the run exactly as it was.
'use strict';
const assert = require('assert');
const { load, rule, run, exactOf } = require('./harness');
const PF = load(), R = PF.run, M = PF.map, P = PF.publish, S = PF.jsearch;
const same = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const NOW = '2026-11-04T15:00:00.000Z', LATER = '2026-11-04T15:10:00.000Z';
const TV = PF.teamValues.parse(JSON.stringify({ format: 'flightdeck-team-values/1', values: { 'jira-base-url': { value: 'https://jira.example.com/jira' } } }));
const MD = ['---', 'process: rel', 'title: Release', 'context: project, version, ticket', 'roles: lead', '---', '',
  '## Stories · DO-CONFIRM {#stories}',
  '- [!] {jira.search} Stories are Done in ^version @lead {#done}', '  query: project = ^project AND fixVersion = ^version AND status != Done', '  results: none',
  '- [!] {jira.search} The release has stories @lead {#scope}', '  query: project = ^project AND fixVersion = ^version', '  results: at least 1',
  '- [ ] {jira.search} The saved filter is empty {#saved}', '  filter: 12345', '  results: none',
  '- [ ] {confirm} Note the ticket {#note}', '  sets: ticket', '',
  '## Gate: Ready {#ready}', '  approves: ^version', ''].join('\n');
function publish(md) {
  const b = P.build(md, { people: [], customTypes: {}, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'abcd1234', app: '2.16.0', teamValues: TV });
  assert.ok(!b.blockers, (b.blockers || []).join(' | '));
  const v = P.verify(b.folder, b.files, exactOf(PF, b.files));
  assert.ok(v.ok, v.why);
  return v;
}
const PUB = publish(MD);
const start = o => R.create(PUB, Object.assign({ title: 'R', details: { project: 'PAY', version: '2026.11.0' }, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id: 'run-s1', app: '2.16.0', teamValues: TV }, o || {}));
const st = (r, id) => M.findStep(R.mapOf(r), id).step;
const sid = (r, id) => R.searchId(r, R.mapOf(r), st(r, id));
const good = (r, id, count, keys) => Object.assign({ searchId: sid(r, id), count: String(count) }, keys ? { keys } : {});
const unchanged = (r, fn, re) => { const before = JSON.stringify(r); assert.throws(fn, re); assert.strictEqual(JSON.stringify(r), before, 'a refusal changes nothing'); };
const note = (r, map) => R.done(r, map, 'note', 'person-avery', LATER, { [R.evidenceFor(r, st(r, 'note'), null, map).list[0].name]: 'PAY-9' });
const reread = r => R.sanitize(JSON.parse(JSON.stringify(r)));

rule('start: the address from team values, a generation for every detail and every search step, after jira; jira-search listed', () => {
  const r = start(), keys = Object.keys(r);
  same(r.searchSites, { 'jira-base-url': { base: 'https://jira.example.com/jira' } });
  same(Object.keys(r.searchGen), ['project', 'version', 'ticket']); same(Object.keys(r.searchRec), ['done', 'scope', 'saved']);
  Object.values(r.searchGen).concat(Object.values(r.searchRec)).forEach(g => assert.ok(/^1-[0-9a-f]{8}$/.test(g), g));
  assert.strictEqual(keys.indexOf('searchSites'), keys.indexOf('jira') + 1); assert.strictEqual(keys.indexOf('searchRec'), keys.indexOf('searchGen') + 1);
  assert.ok(r.features.indexOf('jira-search') >= 0);
  const s = R.searchState(r, R.mapOf(r), st(r, 'done'));
  assert.ok(s.ok && /^sha256:[0-9a-f]{64}$/.test(s.id) && s.link.indexOf('https://jira.example.com/jira/issues/?jql=') === 0, JSON.stringify(s));
  assert.ok(R.searchState(r, R.mapOf(r), st(r, 'saved')).link.endsWith('/issues/?filter=12345'));
  const noSite = start({ teamValues: null }); same(noSite.searchSites, { 'jira-base-url': { missing: true } });
  assert.ok(R.searchState(noSite, R.mapOf(noSite), st(noSite, 'done')).ok, 'with no address it can still be checked');
});
rule('Done: only with the current searchId, a count, and the rule met; refusals change nothing', () => {
  const r = start(), map = R.mapOf(r);
  unchanged(r, () => R.done(r, map, 'done', 'person-avery', LATER, { count: '0' }), /don't say which search/);
  unchanged(r, () => R.done(r, map, 'done', 'person-avery', LATER, { searchId: 'sha256:' + '0'.repeat(64), count: '0' }), /earlier search/);
  unchanged(r, () => R.done(r, map, 'done', 'person-avery', LATER, { searchId: sid(r, 'done') }), /number of results is needed/);
  unchanged(r, () => R.done(r, map, 'done', 'person-avery', LATER, good(r, 'done', 2, 'PAY-1, PAY-2')), /These results can't check this search/);
  unchanged(r, () => R.done(r, map, 'done', 'person-avery', LATER, Object.assign(good(r, 'done', 0), { note: 'x' })), /isn't something this step records/);
  R.done(r, map, 'done', 'person-avery', LATER, good(r, 'done', '+0'));
  same(r.steps.done.values, { searchId: sid(r, 'done'), count: '0' });
  R.done(r, map, 'scope', 'person-avery', LATER, good(r, 'scope', 3, 'pay-1 pay-2, PAY-3'));
  assert.strictEqual(r.steps.scope.values.keys, 'PAY-1, PAY-2, PAY-3');
});
rule('Block with these keeps the results on the blocked answer, reason "Found N: keys"', () => {
  const r = start(), map = R.mapOf(r);
  R.block(r, map, 'done', '', 'person-avery', LATER, good(r, 'done', 2, 'PAY-101, PAY-102'));
  same([r.steps.done.s, r.steps.done.reason, r.steps.done.values.count], ['blocked', 'Found 2: PAY-101, PAY-102', '2']);
  const r2 = start();
  unchanged(r2, () => R.block(r2, R.mapOf(r2), 'note', '', 'person-avery', LATER, { count: '1' }), /Only a Jira search step/);
  unchanged(r2, () => R.block(r2, R.mapOf(r2), 'done', '', 'person-avery', LATER, { searchId: 'sha256:' + '1'.repeat(64), count: '1' }), /earlier search/);
});
rule('correcting a checked search: same searchId and still meeting the rule, else refused', () => {
  const r = start(), map = R.mapOf(r);
  R.done(r, map, 'scope', 'person-avery', LATER, good(r, 'scope', 2));
  unchanged(r, () => R.setFields(r, map, 'scope', {}, { count: '0' }, 'person-avery', LATER), /This would make a checked search fail/);
  R.setFields(r, map, 'scope', {}, { count: '5' }, 'person-avery', LATER);
  assert.strictEqual(r.steps.scope.values.count, '5');
  const r2 = start();
  R.setFields(r2, R.mapOf(r2), 'done', {}, good(r2, 'done', 4), 'person-avery', LATER);
  assert.strictEqual(r2.steps.done.values.count, '4', 'failing results may be recorded on an open step');
});
rule('a detail changes (A to B to A): new generations, results to history, re-check, gate to review; the old searchId never returns', () => {
  const r = start(), map = R.mapOf(r), id0 = sid(r, 'done');
  R.done(r, map, 'done', 'person-avery', LATER, good(r, 'done', 0)); R.done(r, map, 'scope', 'person-avery', LATER, good(r, 'scope', 1));
  R.done(r, map, 'saved', 'person-avery', LATER, good(r, 'saved', 0)); note(r, map);
  R.pass(r, map, 0, 'person-avery', LATER);
  const g0 = r.searchGen.version;
  R.setDetail(r, map, 'version', '2026.12.0', 'person-avery', LATER);
  assert.ok(/^2-[0-9a-f]{8}$/.test(r.searchGen.version) && r.searchGen.version !== g0);
  same([r.steps.done.s, r.steps.scope.s, r.steps.saved.s], ['recheck', 'recheck', 'done'], 'a filter uses no details');
  assert.ok(!r.steps.done.values && r.steps.done.history.some(h => h.s === 'done' && h.values.searchId === id0));
  assert.strictEqual(r.gates.ready.s, 'review');
  R.setDetail(r, map, 'version', '2026.11.0', 'person-avery', LATER);
  assert.ok(/^3-/.test(r.searchGen.version)); assert.notStrictEqual(sid(r, 'done'), id0, 'A to B to A never brings back the first searchId');
  unchanged(r, () => R.done(r, map, 'done', 'person-avery', LATER, { searchId: id0, count: '0' }), /earlier search/);
});
rule('a damaged generation: no searchId, Refresh search repairs it, and so does the next write of the detail even with the same value', () => {
  const r = start(), map = R.mapOf(r);
  r.searchGen.version = 'bad';
  assert.strictEqual(sid(r, 'done'), null); assert.match(R.searchProblem(r, map, st(r, 'done')), /damaged.*Refresh the search/);
  unchanged(r, () => R.done(r, map, 'done', 'person-avery', LATER, { count: '0' }), /damaged/);
  R.refreshSearch(r, map, 'done', 'person-avery', LATER);
  assert.ok(S.genOk(r.searchGen.version) && sid(r, 'done'));
  r.searchRec.scope = 7;
  R.refreshSearch(r, map, 'scope', 'person-avery', LATER); assert.ok(S.genOk(r.searchRec.scope));
  r.searchGen.project = null;
  R.setDetail(r, map, 'project', 'PAY', 'person-avery', LATER);
  assert.ok(S.genOk(r.searchGen.project), 'the same value still repairs it');
});
rule('recovery: adopting any copy gives fresh generations and needs fresh results, for every form of search', () => {
  const cur = start(), map = R.mapOf(cur);
  R.done(cur, map, 'done', 'person-avery', LATER, good(cur, 'done', 0)); R.done(cur, map, 'saved', 'person-avery', LATER, good(cur, 'saved', 0));
  const copy = JSON.parse(JSON.stringify(cur)), old = { done: sid(cur, 'done'), saved: sid(cur, 'saved') };
  R.adopt(cur, R.sanitize(copy), 'person-avery', LATER);
  same([cur.steps.done.s, cur.steps.saved.s], ['recheck', 'recheck']);
  assert.notStrictEqual(sid(cur, 'done'), old.done); assert.notStrictEqual(sid(cur, 'saved'), old.saved);
  assert.ok(cur.log.some(l => /Recovered a copy: Jira searches need fresh results/.test(l.what)));
  const k = Object.keys(cur); assert.strictEqual(k.indexOf('searchSites'), k.indexOf('jira') + 1);
});
rule('the reader: containers into fresh objects with only valid entries; damage is named, never repaired, in a running run', () => {
  const r = start(), o = JSON.parse(JSON.stringify(r));
  o.searchGen = { project: o.searchGen.project, version: 'x', bogus: '1-00000000' }; o.searchRec = [1]; o.searchSites = { 'jira-base-url': { base: 'http://evil' } };
  const back = R.sanitize(o);
  same(back.searchGen, { project: r.searchGen.project }); same(back.searchRec, {}); same(back.searchSites, {});
  const rp = R.repairs(o).map(x => x.at + ' ' + x.what);
  ['searchGen.version damaged', 'searchGen.bogus dropped', 'searchRec container', 'searchSites.jira-base-url dropped'].forEach(w => assert.ok(rp.some(x => x === w || x.indexOf(w) === 0), w + ' in ' + JSON.stringify(rp)));
  const ok = JSON.parse(JSON.stringify(r)); same(R.repairs(ok), []); same(R.unexplained(ok), []);
});
rule('the reader reopens a done search whose record doesn\'t count, names it, marks it on every read, and drops a stored mark', () => {
  const r = start(), map = R.mapOf(r);
  R.done(r, map, 'done', 'person-avery', LATER, good(r, 'done', 0)); R.done(r, map, 'scope', 'person-avery', LATER, good(r, 'scope', 1));
  R.done(r, map, 'saved', 'person-avery', LATER, good(r, 'saved', 0)); note(r, map); R.pass(r, map, 0, 'person-avery', LATER);
  same(R.repairs(JSON.parse(JSON.stringify(r))), [], 'a clean run reads unchanged');
  assert.strictEqual(reread(r).steps.done.s, 'done');
  const edited = JSON.parse(JSON.stringify(r)); edited.steps.done.values.count = '3';
  const back = R.sanitize(JSON.parse(JSON.stringify(edited)));
  same([back.steps.done.s, back.steps.done.reopened, back.gates.ready.s], ['open', true, 'review']);
  assert.ok(/^Reopened when read: its results/.test(back.steps.done.reason), back.steps.done.reason);
  assert.ok(back.steps.done.history.some(h => h.s === 'done' && h.values.count === '3'), 'the done answer and its evidence go to history');
  assert.ok(R.repairs(edited).some(x => x.at === 'steps.done' && /^reopened: /.test(x.what)));
  same(R.unexplained(edited), []);
  const again = R.sanitize(JSON.parse(JSON.stringify(back)));
  same([again.steps.done.s, again.steps.done.reopened, again.steps.done.reason], ['open', true, back.steps.done.reason], 'saved as read, it still reads reopened');
  const forged = JSON.parse(JSON.stringify(r)); forged.steps.note = { s: 'open', reopened: true };
  assert.ok(!('reopened' in R.sanitize(forged).steps.note), 'a stored mark is dropped');
});
rule('R14-4/R14-6: a completed run takes Done on the reopened search only; other actions stay refused; a forged mark isn\'t honored', () => {
  const r = start(), map = R.mapOf(r);
  ['done', 'scope', 'saved'].forEach(id => R.done(r, map, id, 'person-avery', LATER, good(r, id, id === 'scope' ? 1 : 0))); note(r, map);
  R.pass(r, map, 0, 'person-avery', LATER); r.state = 'completed'; r.ended = { outcome: 'Completed', by: 'person-avery', byName: 'Avery', at: LATER };
  const o = JSON.parse(JSON.stringify(r)); o.steps.done.values.count = '9';
  const c = R.sanitize(o), cm = R.mapOf(c);
  assert.ok(R.rereadable(c, 'done') && !R.rereadable(c, 'scope'));
  unchanged(c, () => R.done(c, cm, 'scope', 'person-avery', LATER, good(c, 'scope', 1)), /That phase isn't open/);
  unchanged(c, () => R.block(c, cm, 'done', 'x', 'person-avery', LATER), /Only Done can answer a step reopened when read/);
  unchanged(c, () => R.na(c, cm, 'done', 'person-avery', LATER), /Only Done/);
  unchanged(c, () => R.doneDifferently(c, cm, 'done', 'x', 'person-avery', LATER, good(c, 'done', 0)), /Only Done/);
  unchanged(c, () => R.done(c, cm, 'done', 'person-avery', LATER, good(c, 'done', 2, 'PAY-1, PAY-2')), /can't check this search/);
  R.done(c, cm, 'done', 'person-avery', LATER, good(c, 'done', 0));
  same([c.state, c.steps.done.s], ['completed', 'done']);
  assert.ok(c.log.some(l => /^Answered again after it was reopened when read: /.test(l.what)));
  const f = JSON.parse(JSON.stringify(r)); f.steps.note = { s: 'open', reopened: true };
  const fc = R.sanitize(f); assert.ok(!R.rereadable(fc, 'note'));
  const g = JSON.parse(JSON.stringify(r)); g.steps.scope = { s: 'open', reopened: true, reason: 'x', history: [g.steps.scope] };
  assert.ok(!R.rereadable(R.sanitize(g), 'scope'), 'a search whose earlier done answer still passes isn\'t rereadable');
});
rule('R14-7: a completed run\'s damaged generation is rebuilt from the published version; earlier results no longer match', () => {
  const r = start(), map = R.mapOf(r);
  ['done', 'scope', 'saved'].forEach(id => R.done(r, map, id, 'person-avery', LATER, good(r, id, id === 'scope' ? 1 : 0))); note(r, map);
  R.pass(r, map, 0, 'person-avery', LATER); r.state = 'completed';
  ['searchGen', 'searchRec'].forEach(kind => {
    const o = JSON.parse(JSON.stringify(r)); if (kind === 'searchGen') o.searchGen.version = 'bad'; else delete o.searchRec.done;
    const c = R.sanitize(JSON.parse(JSON.stringify(o)));
    assert.strictEqual(c.state, 'completed'); same(c.details, r.details);
    assert.ok(S.genOk(c.searchGen.version) && S.genOk(c.searchRec.done));
    assert.ok(R.repairs(o).some(x => x.at === kind && /rebuilt from the published version/.test(x.what)), kind);
    assert.strictEqual(c.steps.done.s, 'open'); assert.ok(R.rereadable(c, 'done'));
    assert.ok(/earlier search/.test(c.steps.done.reason), c.steps.done.reason);
    R.done(c, R.mapOf(c), 'done', 'person-avery', LATER, good(c, 'done', 0));
    assert.strictEqual(R.sanitize(JSON.parse(JSON.stringify(c))).steps.done.s, 'done', 'saved and read again, it stands');
  });
});
rule('R14-2: mergeOverflow keeps the browser copy\'s records first, each once by id', () => {
  same(R.mergeOverflow([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]).map(x => x.id), ['a', 'b', 'c']);
  same(R.mergeOverflow(null, [{ id: 'c' }]).map(x => x.id), ['c']);
});
rule('runs without searches are unchanged: no search fields at start or on read', () => {
  const v = publish(MD.replace(/- \[!\] \{jira\.search\}[\s\S]*?(?=- \[ \] \{confirm\})/, ''));
  const r = R.create(v, { title: 'R', details: {}, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id: 'run-n1', app: '2.16.0' });
  assert.ok(!('searchGen' in r) && !('searchSites' in r)); assert.ok(!('searchGen' in R.sanitize(JSON.parse(JSON.stringify(r)))));
});

const completedRun = () => {
  const r = start(), map = R.mapOf(r);
  ['done', 'scope', 'saved'].forEach(id => R.done(r, map, id, 'person-avery', LATER, good(r, id, id === 'scope' ? 1 : 0))); note(r, map);
  R.pass(r, map, 0, 'person-avery', LATER); r.state = 'completed'; r.ended = { outcome: 'Completed', by: 'person-avery', byName: 'Avery', at: LATER };
  return r;
};
rule('recovering a completed copy keeps Completed and takes its searches down the read-reopened path: Done answers them again', () => {
  const cur = completedRun(), copy = R.sanitize(JSON.parse(JSON.stringify(cur))), old = sid(cur, 'done');
  R.adopt(cur, copy, 'person-avery', LATER);
  same([cur.state, cur.ended.outcome, cur.steps.done.s, cur.steps.done.reopened, cur.gates.ready.s], ['completed', 'Completed', 'open', true, 'review']);
  assert.ok(cur.steps.done.history.some(h => h.s === 'done' && h.values.count === '0'), 'the earlier answer is kept in history');
  assert.ok(/^Reopened when read: /.test(cur.steps.done.reason), cur.steps.done.reason);
  assert.notStrictEqual(sid(cur, 'done'), old);
  [cur, R.sanitize(JSON.parse(JSON.stringify(cur)))].forEach((c, i) => {
    assert.ok(R.rereadable(c, 'done'), 'rereadable ' + (i ? 'after a reload' : 'at once'));
    R.done(c, R.mapOf(c), 'done', 'person-avery', LATER, good(c, 'done', 0));
    same([c.state, c.steps.done.s], ['completed', 'done']);
  });
});
const PAT = publish(['---', 'process: pat', 'title: Pat', 'context: version:pattern([0-9]+)', '---', '', '## Check · DO-CONFIRM {#check}',
  '- [!] {jira.search} No blockers in ^version {#b}', '  query: fixVersion = ^version AND priority = Blocker', '  results: none', '', '## Gate: Ready {#ready}', ''].join('\n'));
rule('a consumed detail that isn\'t valid builds no search: a completed run marks the search stuck, and Done is refused', () => {
  const r = R.create(PAT, { title: 'P', details: { version: '12' }, roles: {}, by: 'person-avery', session: 'w-a', now: NOW, id: 'run-pt', app: '2.16.0', teamValues: TV }), map = R.mapOf(r);
  R.done(r, map, 'b', 'person-avery', LATER, { searchId: sid(r, 'b'), count: '0' }); R.pass(r, map, 0, 'person-avery', LATER);
  r.state = 'completed'; r.ended = { outcome: 'Completed', by: 'person-avery', byName: 'Avery', at: LATER };
  const o = JSON.parse(JSON.stringify(r)); o.details.version = 'oops'; o.searchGen.version = 'bad';
  const c = R.sanitize(o), cm = R.mapOf(c);
  assert.ok(c._invalid && c._invalid['details.version'], 'the value is named');
  assert.strictEqual(R.searchId(c, cm, st(c, 'b')), null);
  assert.match(R.searchProblem(c, cm, st(c, 'b')), /The run detail version isn't a valid value/);
  same([c.steps.b.s, c.steps.b.reopened], ['open', 'stuck']);
  assert.match(c.steps.b.reason, /can't be repaired here; start a new run/);
  assert.ok(!R.rereadable(c, 'b'));
  unchanged(c, () => R.done(c, cm, 'b', 'person-avery', LATER, { searchId: 'sha256:' + '0'.repeat(64), count: '0' }), /./);
  const u = JSON.parse(JSON.stringify(r)); u.details.version = '1‮2';
  const cu = R.sanitize(u);
  same([cu.steps.b.s, cu.steps.b.reopened], ['open', 'stuck'], 'a value with a direction override can\'t be searched: stuck, not rereadable');
  assert.ok(!R.rereadable(cu, 'b'));
});
run();
