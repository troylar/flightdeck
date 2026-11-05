// Reports on Jira search steps (2.16, design sections 6.1 and 6.3) and reports that set run details (Appendix A.4): what the
// commands print for a search, and what a person may accept, judged against the run at the moment of acceptance.
'use strict';
const assert = require('assert');
const { load, rule, run, exactOf } = require('./harness');
const PF = load(), R = PF.run, M = PF.map, P = PF.publish, X = PF.reports, A = PF.appjson;
const NOW = '2026-11-04T15:00:00.000Z', LATER = '2026-11-04T15:10:00.000Z';
const TV = PF.teamValues.parse(JSON.stringify({ format: 'flightdeck-team-values/1', values: { 'jira-base-url': { value: 'https://jira.example.com/jira' } } }));
const MD = ['---', 'process: rel', 'title: Release', 'context: project, version, tag:pattern(\\d{4}\\.\\d{1,2}\\.\\d{1,2}-rc\\d{1,3})', 'roles: lead', '---', '',
  '## Stories · DO-CONFIRM {#stories}',
  '- [!] {jira.search} Stories are Done in ^version @lead {#done}', '  query: project = ^project AND fixVersion = ^version AND status != Done', '  results: none',
  '- [ ] {jira.search} The saved filter is empty {#saved}', '  filter: 12345', '  results: none', '  what: Open blockers',
  '- [ ] {confirm} Note the release tag {#tag}', '  sets: tag', '',
  '## Gate: Ready {#ready}', '  approves: ^version', ''].join('\n');
function publish(md) {
  const b = P.build(md, { people: [], customTypes: {}, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'abcd1234', app: '2.16.0', teamValues: TV });
  assert.ok(!b.blockers, (b.blockers || []).join(' | '));
  const v = P.verify(b.folder, b.files, exactOf(PF, b.files));
  assert.ok(v.ok, v.why);
  return v;
}
const PUB = publish(MD);
const start = () => R.create(PUB, { title: 'R', details: { project: 'PAY', version: '2026.11.0' }, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id: 'run-s1', app: '2.16.0', teamValues: TV });
const st = (r, id) => M.findStep(R.mapOf(r), id).step;
const sid = (r, id) => R.searchId(r, R.mapOf(r), st(r, id));
function group(r, step, extra) {
  const rep = Object.assign({ format: 'flightdeck-report/1', process: 'rel', run: 'run-s1', publication: { folder: r.folder }, step, verdict: 'pass', blockers: [], evidence: {}, links: [], inputs: [],
    producer: { name: 'release-check', version: '1.0.0' }, created: NOW, id: 'abcd1234' }, extra || {});
  return { key: 'rel/run-s1/' + step + '/release-check/abcd1234', process: 'rel', run: 'run-s1', step, producer: 'release-check', id: 'abcd1234', copies: [{ ok: true, sha256: 'a'.repeat(64) }], report: rep, sha256: 'a'.repeat(64), differ: false, unreadable: [] };
}
const elig = (r, g) => X.eligible(g, r, R.mapOf(r), { recording: true, now: LATER });
const ok = (A_, D) => { const e = A.conforms(JSON.parse(JSON.stringify(A_)), D); assert.strictEqual(e.length, 0, e.join(' | ')); };

rule('6.3: a report without a searchId, or for an earlier search, is refused; a detail changed back keeps it refused', () => {
  const r = start(), id = sid(r, 'done');
  assert.match(elig(r, group(r, 'done', { evidence: { count: '0' } })).why, /doesn't say which search it ran/);
  assert.match(elig(r, group(r, 'done', { evidence: { searchId: 'sha256:' + '0'.repeat(64), count: '0' } })).why, /for an earlier search: a run detail it used has changed, or the run was recovered/);
  const late = group(r, 'done', { evidence: { searchId: id, count: '0' } });
  assert.ok(elig(r, late).ok, elig(r, late).why);
  R.setDetail(r, R.mapOf(r), 'version', '2026.12.0', 'person-avery', LATER);
  R.setDetail(r, R.mapOf(r), 'version', '2026.11.0', 'person-avery', LATER);
  assert.match(elig(r, late).why, /earlier search/, 'the old generation stays refused after the detail returns');
});
rule('6.3: a pass must meet the rule; a passing report is accepted with its results as Done records them', () => {
  const r = start(), id = sid(r, 'done');
  const bad = elig(r, group(r, 'done', { evidence: { searchId: id, count: '2', keys: 'PAY-1, PAY-2' } }));
  assert.ok(!bad.ok && /don't meet the step's rule/.test(bad.why), bad.why);
  const good = elig(r, group(r, 'done', { evidence: { searchId: id, count: '0', ranAt: '2026-11-04T15:05Z' } }));
  assert.ok(good.ok, good.why);
  R.done(r, R.mapOf(r), 'done', 'person-avery', LATER, good.values, { exact: true });
  assert.strictEqual(r.steps.done.s, 'done');
});
rule('6.3: fail or blocked with the current searchId offers Block with these, which blocks the step with the results', () => {
  const r = start(), id = sid(r, 'done');
  const e = elig(r, group(r, 'done', { verdict: 'fail', blockers: ['2 stories open'], evidence: { searchId: id, count: '2', keys: 'PAY-1, PAY-2' } }));
  assert.ok(!e.ok && e.block && /only a pass can be accepted/.test(e.why), JSON.stringify(e));
  R.block(r, R.mapOf(r), 'done', '', 'person-avery', LATER, e.block.values);
  assert.strictEqual(r.steps.done.s, 'blocked'); assert.strictEqual(r.steps.done.values.keys, 'PAY-1, PAY-2');
  const old = elig(r, group(r, 'done', { verdict: 'blocked', blockers: ['timed out'], evidence: { searchId: 'sha256:' + '1'.repeat(64), count: '0' } }));
  assert.ok(!old.ok && !old.block && /earlier search/.test(old.why), 'an earlier search offers no Block with these');
});
rule('6.3: with a damaged generation every report is refused, whatever it carries', () => {
  const r = start(), id = sid(r, 'done');
  r.searchGen.version = 'broken';
  const e = elig(r, group(r, 'done', { evidence: { searchId: id, count: '0' } }));
  assert.ok(!e.ok && /damaged/.test(e.why), e.why);
});
rule('6.3: report check and write warn for a missing or earlier searchId and for results that break the rule', () => {
  const r = start(), map = R.mapOf(r), id = sid(r, 'done');
  const t = (ev, v) => X.target(Object.assign(group(r, 'done').report, { verdict: v || 'pass', evidence: ev }), r, map).warnings.join(' | ');
  assert.match(t({ count: '0' }), /doesn't say which search it ran/);
  assert.match(t({ searchId: 'sha256:' + '2'.repeat(64), count: '0' }), /earlier search/);
  assert.match(t({ searchId: id, count: '3', keys: 'PAY-1, PAY-2, PAY-3' }), /don't meet the step's rule/);
  assert.strictEqual(t({ searchId: id, count: '0' }), '');
});
rule('A.4: a report may set a sets: detail, checked against its pattern; it can\'t name that detail as an input', () => {
  const r = start(), map = R.mapOf(r), name = R.evidenceFor(r, st(r, 'tag'), null, map).list.filter(d => d.detail === 'tag')[0].name;
  assert.match(elig(r, group(r, 'tag', { evidence: { [name]: '2026.11.0 rc3' } })).why, /match/i);
  const self = elig(r, group(r, 'tag', { evidence: { [name]: '2026.11.0-rc3' }, inputs: [{ name: 'tag', value: 'x', source: 'detail:tag' }] }));
  assert.ok(!self.ok && /can't examine the detail it sets/.test(self.why), self.why);
  const e = elig(r, group(r, 'tag', { evidence: { [name]: '2026.11.0-rc3' } }));
  assert.ok(e.ok, e.why);
  assert.deepStrictEqual(Array.from(e.sets, x => x.text), ['Sets tag to 2026.11.0-rc3']);
  R.done(r, map, 'tag', 'person-avery', LATER, e.values, { exact: true });
  assert.strictEqual(r.details.tag, '2026.11.0-rc3', 'applied through applySets');
  const again = elig(r, group(r, 'tag', { evidence: { [name]: '2026.11.0-rc4' }, id: 'abcd1235' }));
  assert.deepStrictEqual(Array.from(again.sets, x => x.text), ['Replaces tag (2026.11.0-rc3) with 2026.11.0-rc4']);
});
rule('6.1: report targets, run --json and next carry search, resolved from the run; other steps are unchanged; it conforms', () => {
  const r = start(), nameOf = A.names([]);
  const tg = A.targets([r], nameOf), steps = tg.runs[0].steps;
  ok(tg, A.SCHEMA.targets);
  const s = steps.filter(x => x.id === 'done')[0].search;
  assert.strictEqual(s.searchId, sid(r, 'done')); assert.strictEqual(s.ready, true); assert.strictEqual(s.results, 'none'); assert.strictEqual(s.site, 'jira-base-url');
  assert.deepStrictEqual(Array.from(s.uses), ['project', 'version']);
  assert.strictEqual(s.jql, 'project = "PAY" AND fixVersion = "2026.11.0" AND status != Done');
  assert.ok(s.link.indexOf('https://jira.example.com/jira/issues/?jql=') === 0);
  const f = steps.filter(x => x.id === 'saved')[0].search;
  assert.strictEqual(f.filter, '12345'); assert.strictEqual(f.jql, null); assert.ok(f.link.endsWith('?filter=12345')); assert.strictEqual(f.what, 'Open blockers');
  assert.ok(!('search' in steps.filter(x => x.id === 'tag')[0]), 'a step that isn\'t a search has no search key');
  assert.strictEqual(steps.filter(x => x.id === 'tag')[0].accepts, true, 'A.4: a step that sets details accepts reports');
  const rj = A.run2(r, [], nameOf); ok(rj, A.SCHEMA2.run);
  assert.strictEqual(rj.run.steps.filter(x => x.id === 'done')[0].search.searchId, sid(r, 'done'));
  const nx = A.next(r, nameOf, null); ok(nx, A.SCHEMA2.next);
  assert.strictEqual(nx.next.step.id, 'done'); assert.strictEqual(nx.next.step.search.ready, true);
  r.searchGen.version = 'broken';
  const d = A.targets([r], nameOf).runs[0].steps.filter(x => x.id === 'done')[0].search;
  assert.strictEqual(d.searchId, null); assert.strictEqual(d.ready, false); assert.strictEqual(d.jql, null); assert.match(d.why, /damaged/);
  r.details.version = '';
  const w = A.targets([start()].map(x => { x.details.version = ''; return x; }), nameOf).runs[0].steps.filter(x => x.id === 'done')[0].search;
  assert.strictEqual(w.ready, false); assert.match(w.why, /Waiting for \^version/);
});
rule('6.1: process --json carries the template only, never resolved', () => {
  const p = A.process2({ process: 'rel', pubs: [PUB], index: { latest: PUB, clashes: [] } }, PUB);
  ok(p, A.SCHEMA2.process);
  const s = p.phases[0].steps.filter(x => x.id === 'done')[0].search;
  assert.deepStrictEqual(Object.keys(s).sort(), ['filter', 'query', 'results', 'site', 'uses', 'what']);
  assert.strictEqual(s.query, 'project = ^project AND fixVersion = ^version AND status != Done');
});
run();
