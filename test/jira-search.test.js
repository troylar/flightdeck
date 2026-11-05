// The Jira search step's core (2.16): the JQL lexer and where run details may go, filling them in by position and the
// positional check, the rule, the Jira address and the link, the searchId formula and the search fields of the evidence.
// Flightdeck never calls Jira: all of this is text work.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), S = PF.jsearch, T = PF.types, M = PF.map;
const same = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const CTX = ['project', 'version', 'sprint', 'readiness'];
const DETAILS = { project: 'PAY', version: '2026.11.0', sprint: 'PAY Sprint 42', readiness: 'PAY-1200' };
const NOW = Date.parse('2026-11-04T15:00Z');
const errs = q => S.checkFields({ query: q, results: 'none' }, { context: CTX }).errors;

/* Section 3.4: hand-written from Jira's documentation of JQL operators and of text search, not from the lexer's output. */
const REF = [
  ['fixVersion = "2026.11.0"', [['word', 'fixVersion'], ['op', '='], ['str', '2026.11.0']], 'value after ='],
  ['status != Done', [['word', 'status'], ['op', '!='], ['word', 'Done']], 'unquoted value'],
  ['fixVersion in ("2026.11.0", "2026.10.0")', [['word', 'fixVersion'], ['word', 'in'], ['lp'], ['str', '2026.11.0'], ['comma'], ['str', '2026.10.0'], ['rp']], 'IN list'],
  ['fixVersion not in (A, B)', [['word', 'fixVersion'], ['word', 'not'], ['word', 'in'], ['lp'], ['word', 'A'], ['comma'], ['word', 'B'], ['rp']], 'NOT IN list'],
  ['"Story Points" is EMPTY', [['str', 'Story Points'], ['word', 'is'], ['word', 'EMPTY']], 'IS EMPTY on a quoted field name'],
  ['assignee is not null', [['word', 'assignee'], ['word', 'is'], ['word', 'not'], ['word', 'null']], 'IS NOT NULL'],
  ['summary ~ "\\"exact phrase\\""', [['word', 'summary'], ['op', '~'], ['str', '"exact phrase"']], 'text search with an escaped inner phrase'],
  ['created >= "2026-11-01" AND created <= "2026-11-30"', [['word', 'created'], ['op', '>='], ['str', '2026-11-01'], ['word', 'AND'], ['word', 'created'], ['op', '<='], ['str', '2026-11-30']], 'range'],
  ['issue in linkedIssues("PAY-1", "blocks")', [['word', 'issue'], ['word', 'in'], ['word', 'linkedIssues'], ['lp'], ['str', 'PAY-1'], ['comma'], ['str', 'blocks'], ['rp']], 'function call with arguments'],
  ['project = PAY ORDER BY key ASC', [['word', 'project'], ['op', '='], ['word', 'PAY'], ['word', 'ORDER'], ['word', 'BY'], ['word', 'key'], ['word', 'ASC']], 'ORDER BY']
];
rule('lexer: the 10 reference forms from Jira\'s documentation, token by token', () => {
  REF.forEach(([q, want, what]) => same(S.lex(q).tokens.map(t => t.v == null ? [t.t] : [t.t, t.v]), want, what));
});
rule('positions: the 8 reference positions', () => {
  [['fixVersion = ^version', true], ['fixVersion in (^version, "A")', true], ['created >= ^version', true], ['fixVersion is ^version', false], ['fixVersion is not ^version', false],
    ['summary ~ ^version', false], ['issue in linkedIssues(^version)', false], ['^version = A', false]].forEach(([q, ok]) => assert.strictEqual(!errs(q).length, ok, q));
});
rule('positions: the review\'s breakout and the other bad placements stop publishing, with the reason', () => {
  const bad = {
    'project = PAY AND (summary ~ "^unknown ^version suffix")': /\^version inside quotes/,
    'fixVersion = "^version"': /inside quotes/, 'fixVersion = \'^version\'': /inside quotes/,
    'summary ~ ^version': /text search/, 'summary !~ ^version': /text search/,
    'issue in linkedIssues(^readiness)': /function's arguments/, 'issue in fn(other(^version))': /function's arguments/,
    '^version = 2026.11.0': /isn't where a value goes/, 'fixVersion = v^version': /joined to other text/,
    'fixVersion = ^version ^sprint': /where the value should end/, 'fixVersion = ^nightly': /isn't a run detail of this checklist/,
    'fixVersion is not ^version': /IS or IS NOT/, 'summary ~ "a\\': /lone backslash/, 'summary ~ "abc': /double quote is never closed/
  };
  Object.keys(bad).forEach(q => { const e = errs(q); assert.ok(e.length && bad[q].test(e.join(' | ')), q + ': ' + e.join(' | ')); });
});
rule('positions: the allowed forms pass and name what they use', () => {
  const ok = {
    'summary ~ "^nightly build" AND fixVersion = ^version': ['version'],
    'fixVersion in (^version, "2026.10.0") AND sprint not in (^sprint)': ['version', 'sprint'],
    'created >= ^version': ['version'], 'project = ^project AND (fixVersion = ^version OR fixVersion is EMPTY)': ['project', 'version'],
    'fixVersion = ^version ORDER BY key': ['version'], 'summary ~ "say \\"hi\\"" AND fixVersion = ^version': ['version'], 'summary ~ "a\\\\" AND fixVersion = ^version': ['version']
  };
  Object.keys(ok).forEach(q => { const c = S.checkFields({ query: q, results: 'none' }, { context: CTX }); same(c.errors, [], q); same(c.uses, ok[q], q); });
});

const Q = 'project = ^project AND issuetype = Story AND fixVersion = ^version AND "Story Points" is EMPTY';
rule('substitution: hostile values stay one string at their place, and the link round-trips', () => {
  ['1.2" OR project != "X', ') AND project = OTHER AND (summary ~', 'v1\\" OR 1=1 OR "', 'v1\\\\', 'v1\\', 'v\\u0041', 'AND OR NOT EMPTY ORDER BY', 'R&D #5 ?x=1',
    'javascript:alert(1)', 'it\'s 2026', '100%25 %0A', 'Café 2026 – 中文 🚀', 'x'.repeat(300)].forEach(v => {
    const sub = S.substitute(Q, Object.assign({}, DETAILS, { version: v }), CTX);
    assert.ok(sub.ok, v);
    same(S.contained(sub.template, sub), { ok: true, tokens: 15, values: 2 }, v);
    const l = S.buildLink('https://jira.example.com/jira', { jql: sub.jql });
    assert.ok(l.ok && PF.util.safeUrl(l.href), v);
    const u = new URL(l.href);
    same([...u.searchParams.keys()], ['jql'], v); assert.strictEqual(u.searchParams.get('jql'), sub.jql, v); assert.strictEqual(u.origin + u.pathname, 'https://jira.example.com/jira/issues/', v);
  });
});
rule('substitution: refused values never become a search', () => {
  const why = v => S.substitute(Q, Object.assign({}, DETAILS, { version: v }), CTX).why;
  assert.match(why('v\ud800x'), /\^version has broken Unicode \(a lone surrogate\), so it can't go in a search/);
  assert.match(why('line1\nline2'), /line break or control character/);
  assert.match(why('‮abc'), /direction character/);
  assert.strictEqual(why(''), 'Waiting for ^version.');
  assert.match(why('x'.repeat(301)), /more than 300 characters/);
  assert.match(why('😀'.repeat(301)), /more than 300 characters/, 'counted in code points');
  assert.ok(S.substitute(Q, Object.assign({}, DETAILS, { version: '😀'.repeat(300) }), CTX).ok, '300 emoji fit');
});
rule('the positional check catches the old global replace, decoy included', () => {
  const tpl = 'project = PAY AND (summary ~ "^unknown ^version suffix") AND labels != ") AND project = OTHER AND (summary ~"', payload = ') AND project = OTHER AND (summary ~';
  const old = tpl.replace(/\^version/g, S.quoteJql(payload)), at = tpl.indexOf('^version');
  const tokens = S.lex(tpl).tokens.map(t => t.t === 'ph' ? Object.assign({}, t, { slot: true }) : t);
  assert.ok(S.lex(old).tokens.some(t => t.t === 'str' && t.v === payload), 'the old "some string token" check would say yes');
  same(S.contained(tokens, { jql: old, occ: [{ name: 'version', value: payload, s: at, e: at + S.quoteJql(payload).length }] }), { ok: false, why: 'the output has 23 tokens, the template 13' });
  assert.match(S.substitute(tpl, { version: payload }, CTX).why, /inside quotes/);
});
rule('definitions: exactly one non-empty query or filter, the rule, site and what', () => {
  const c = f => S.checkFields(f, { context: CTX });
  assert.match(c({ results: 'none' }).errors[0], /needs "query:" \(JQL\) or "filter:"/);
  assert.match(c({ query: '   ', results: 'none' }).errors[0], /needs "query:"/);
  assert.match(c({ filter: '', results: 'none' }).errors[0], /needs "query:"/);
  assert.match(c({ query: 'project = PAY', filter: '12345' }).errors[0], /not both/);
  assert.match(c({ filter: '12a' }).errors[0], /saved filter's number/);
  same(c({ filter: '12345', results: 'none' }).errors, []); assert.match(c({ filter: '12345', results: 'none' }).tips[0], /say what it finds with "what:"/);
  assert.match(c({ query: 'project = PAY', results: 'some' }).errors[0], /"results" should be none, any/);
  assert.strictEqual(c({ query: 'project = PAY', results: 'Exactly  0' }).rule.text, 'none');
  assert.strictEqual(c({ query: 'project = PAY', results: 'at least 0' }).rule.text, 'any');
  assert.strictEqual(S.ruleLabel(c({ query: 'project = PAY' }).rule), 'Any number, including zero');
  assert.match(c({ query: 'project = PAY' }).tips[0], /usually says "results:"/);
  assert.match(c({ query: 'project = PAY', results: 'none', site: 'https://jira.example.com' }).errors[0], /team:<name>/);
  assert.match(c({ query: 'project = PAY', results: 'none', what: 'x'.repeat(201) }).errors[0], /at most 200/);
  assert.match(c({ query: 'project = ' + 'x'.repeat(2000), results: 'none' }).errors[0], /the most is 2000/);
  assert.match(c({ query: 'project = PAY‮', results: 'none' }).errors[0], /direction character/);
});
rule('definitions: the team value must exist and be a valid address, when the caller has team values', () => {
  const tv = v => PF.teamValues.parse(JSON.stringify({ format: 'flightdeck-team-values/1', values: v }));
  const c = (f, t) => S.checkFields(f, { context: CTX, teamValues: t }).errors;
  same(c({ query: 'project = PAY', results: 'none' }, tv({ 'jira-base-url': { value: 'https://jira.example.com/jira' } })), []);
  assert.match(c({ query: 'project = PAY', results: 'none', site: 'team:jira-prod' }, tv({ 'jira-base-url': { value: 'https://jira.example.com' } }))[0], /"jira-prod" isn't in team-values.json/);
  assert.match(c({ query: 'project = PAY', results: 'none' }, tv({ 'jira-base-url': { value: 'http://jira.example.com' } }))[0], /must start with https/);
});
rule('definitions: a search can\'t set a detail its own query uses; require: keys with a zero-only rule is refused', () => {
  const c = f => S.checkFields(f, { context: CTX }).errors;
  assert.match(c({ query: 'fixVersion = ^version', results: 'none', sets: 'version' })[0], /sets \^version, which its own query uses/);
  same(c({ query: 'fixVersion = ^version', results: 'none', sets: 'readiness' }), []);
  assert.match(c({ query: 'project = PAY', results: 'none', require: 'keys' })[0], /requires keys, but results: none/);
  assert.match(c({ query: 'project = PAY', results: 'at most 0', require: 'keys' })[0], /requires keys/);
  same(c({ query: 'project = PAY', results: 'at most 3', require: 'keys' }), []);
  same(c({ query: 'project = PAY', results: 'none', require: 'all' }), []);
});
rule('addresses: exactly https://host[:port][/path]', () => {
  const ok = { 'https://jira.example.com': 'https://jira.example.com', 'https://jira.example.com/': 'https://jira.example.com', 'HTTPS://Jira.Example.com/jira/': 'https://jira.example.com/jira',
    'https://jira.example.com:8443/jira': 'https://jira.example.com:8443/jira', 'https://xn--jra-8ma.example.com': 'https://xn--jra-8ma.example.com' };
  Object.keys(ok).forEach(v => same(S.checkBase(v), { ok: true, base: ok[v] }, v));
  const bad = { 'https://jira.example.com/jira/../admin': /path segment/, 'https://jira.example.com/./jira': /path segment/, 'https://jira.example.com:443/jira': /reads differently/,
    'http://jira.example.com': /https/, 'javascript:alert(1)': /https/, 'https://user:pw@jira.example.com': /without a user/, 'https://jira.example.com\\@evil.example': /without a user/,
    'https://jira.example.com/?a=1': /query/, 'https://jira.example.com/#x': /fragment/, ' https://jira.example.com': /spaces/, 'https://jïra.example.com': /xn--/,
    'https://jira.example.com:99999': /host\[:port\]/, 'https://jira.example.com/%2e%2e/admin': /escapes/, 'data:text/html,<script>': /https/, 'https://-bad.example.com': /xn--/ };
  Object.keys(bad).forEach(v => { const b = S.checkBase(v); assert.ok(!b.ok && bad[v].test(b.why), v + ': ' + b.why); });
});
rule('links: strict encoding, safeUrl, the 8,000-character limit and filters', () => {
  const l = S.buildLink('https://jira.example.com/jira', { jql: 'summary ~ "it\'s (x)*!"' });
  assert.ok(l.ok && PF.util.safeUrl(l.href) && !/['()*!]/.test(l.href.split('?')[1]), l.href);
  assert.strictEqual(S.buildLink('https://jira.example.com', { filter: '12345' }).href, 'https://jira.example.com/issues/?filter=12345');
  const wide = 'project = PAY AND summary ~ "' + '発行'.repeat(980) + '"';
  assert.match(S.buildLink('https://jira.example.com/jira', { jql: wide }).why, /over 8000; copy the query instead, or save it as a Jira filter/);
  assert.match(S.buildLink('http://jira.example.com', { jql: 'x = y' }).why, /^The Jira address must start with https/);
});
rule('searchId: the pinned formula', () => {
  const sub = S.substitute('fixVersion = ^version', { version: '2026.11.0' }, CTX);
  const id = S.identity('https://jira.example.com/jira', { query: 'fixVersion = ^version' }, sub, { version: '1-0a1b2c3d' }, '1-ffeeddcc');
  same(id, ['flightdeck-search/3', 'https://jira.example.com/jira', 'jql', 'fixVersion = "2026.11.0"', [['version', '2026.11.0', '1-0a1b2c3d']], '1-ffeeddcc']);
  const want = 'sha256:' + require('crypto').createHash('sha256').update(JSON.stringify(id), 'utf8').digest('hex');
  assert.strictEqual(S.fingerprint(id), want); assert.strictEqual(want.length, 71);
  assert.strictEqual(S.fingerprint(S.identity('', { filter: '12345' }, null, {}, '2-00000000')), 'sha256:' + require('crypto').createHash('sha256').update(JSON.stringify(['flightdeck-search/3', '', 'filter', '12345', [], '2-00000000'])).digest('hex'));
  assert.strictEqual(S.identity('x', { query: 'fixVersion = ^version' }, sub, { version: 'bad' }, '1-ffeeddcc'), null, 'a damaged detail generation');
  assert.strictEqual(S.identity('x', { query: 'fixVersion = ^version' }, sub, { version: '1-0a1b2c3d' }, null), null, 'a damaged recovery generation');
  assert.strictEqual(S.identity('x', { filter: '1' }, null, {}, 7), null);
});
rule('generations: random, counted, and never the same twice', () => {
  const a = S.token(), b = S.token(a), c = S.token(b);
  assert.match(a, /^1-[0-9a-f]{8}$/); assert.match(b, /^2-[0-9a-f]{8}$/); assert.match(c, /^3-[0-9a-f]{8}$/);
  assert.notStrictEqual(S.token().slice(2), S.token().slice(2));
  assert.match(S.token('garbage'), /^1-/);
});
rule('evidence: the search fields, in Done\'s canonical form', () => {
  const none = S.parseResults('none'), one = S.parseResults('exactly 1'), cur = 'sha256:' + 'a'.repeat(64);
  const ev = (rule, v) => S.checkEvidence(rule, Object.assign({ searchId: cur }, v), cur, NOW);
  same(ev(none, { count: '0', ranAt: '2026-11-04T14:05Z' }), { values: { searchId: cur, count: '0', ranAt: '2026-11-04T14:05Z' }, meets: true, why: '' });
  const three = ev(none, { count: '3', keys: 'PAY-101, pay-102 PAY-103' });
  assert.strictEqual(three.values.keys, 'PAY-101, PAY-102, PAY-103'); assert.strictEqual(three.meets, false); assert.match(three.why, /should find no results and found 3/);
  assert.match(ev(none, { count: '3' }).error, /Record at least one key it found, then block the step/);
  assert.match(ev(none, { count: '40', keys: '+40 more' }).error, /Name at least one issue key/);
  assert.strictEqual(ev(none, { count: '40', keys: 'PAY-1, PAY-2 +38 more' }).values.keys, 'PAY-1, PAY-2 +38 more');
  assert.match(ev(none, { count: '60', keys: Array.from({ length: 60 }, (_, i) => 'PAYMENTS-' + (1000 + i)).join(', ') }).error, /list up to 300/);
  ['1e3', '-1', '1,234', '3.5'].forEach(n => assert.match(ev(none, { count: n }).error, /whole number/, n));
  ['0', '00', '+0', ' 0 '].forEach(n => assert.strictEqual(ev(none, { count: n }).values.count, '0', n));
  assert.match(ev(none, { count: '00', keys: 'PAY-1' }).error, /doesn't apply when there are no results/);
  assert.match(ev(none, { count: '0', ranAt: '2026-02-31T00:00Z' }).error, /isn't a real date/);
  assert.match(ev(none, { count: '0', ranAt: '2026-11-04T24:00Z' }).error, /isn't a real date/);
  assert.match(ev(none, { count: '0', ranAt: '2026-11-05T15:00Z' }).error, /Check the clock/);
  assert.ok(ev(none, { count: '0', ranAt: '2026-11-04T15:02Z' }).meets, 'clock skew allowed');
  assert.match(ev(one, { count: '0' }).why, /should find exactly 1 result and found 0/);
  assert.match(S.checkEvidence(none, { count: '0', searchId: 'sha256:' + '0'.repeat(64) }, cur, NOW).error, /for an earlier search/);
  assert.match(S.checkEvidence(none, { count: '0' }, cur, NOW).error, /don't say which search/);
  assert.match(S.checkEvidence(none, { count: '0', searchId: cur }, null, NOW).error, /no current search/);
  same(S.checkEvidence(none, { count: '0' }, null, NOW, { practice: true }).values, { count: '0' }, 'practice: no searchId');
  assert.match(ev(none, { count: '0', resultsLink: 'javascript:alert(1)' }).error, /results link/);
});
rule('the type: built in, version 4, fields fixed for a run, understood only as version 4', () => {
  const t = T.get('jira.search');
  assert.strictEqual(t.version, 4); assert.strictEqual(T.get('jira.issue').version, 2);
  same(T.editable(t), ['link']);
  assert.ok(T.understood(JSON.parse(JSON.stringify(t))));
  assert.ok(!T.understood(Object.assign(JSON.parse(JSON.stringify(t)), { version: 2 })), 'the new kinds need version 4');
  assert.ok(!T.understood(Object.assign(JSON.parse(JSON.stringify(t)), { version: 5 })));
  const rf = T.recordFields(t, { require: 'all' });
  same(rf.filter(d => d.required).map(d => d.name), ['count', 'keys', 'resultsLink', 'ranAt'], 'require: all leaves out the system field');
  same(T.checkRecord(t, { require: 'all' }, { searchId: 'x', count: '0', resultsLink: 'https://j.example.com/x', ranAt: '2026-11-04T14:05Z' }).values, { searchId: 'x', count: '0', resultsLink: 'https://j.example.com/x', ranAt: '2026-11-04T14:05Z' }, 'keys do not apply at zero');
  assert.match(T.checkRecord(t, { require: 'all' }, { searchId: 'x', count: '0', keys: 'PAY-1', resultsLink: 'https://j.example.com/x', ranAt: 't' }).error, /Issue keys doesn't apply/);
  assert.match(T.checkRecord(t, { require: 'all' }, { searchId: 'x', count: '2', resultsLink: 'https://j.example.com/x', ranAt: 't' }).error, /Issue keys is needed/);
  assert.match(T.checkFields(t, { query: 'project = PAY', results: 'none', jql: 'x' }, { context: [] }).errors[0], /has a field "jql" that \{jira.search\} doesn't use/);
});
rule('publish: a checklist with a search marks jira-search and needs 2.16', () => {
  const md = ['---', 'process: rr', 'title: RR', 'context: project, version', 'roles: lead', '---', '', '## Stories · DO-CONFIRM {#stories}',
    '- [!] {jira.search} The release has stories @lead {#scope}', '  query: project = ^project AND fixVersion = ^version', '  results: at least 1', ''].join('\n');
  const map = M.parse(md);
  same(M.features(map), ['jira-search']);
  same(M.check(map, {}).blockers, []);
  const n = PF.publish.needs(map, T.freeze(M.usedTypes(map)));
  assert.strictEqual(n.needs, '2.16'); same(n.names, ['a Jira search step']);
  assert.strictEqual(PF.publish.unrunnable(md, T.freeze(M.usedTypes(map))), '');
  assert.match(PF.publish.unrunnable(md.replace('fixVersion = ^version', 'fixVersion = "^version"'), T.freeze(M.usedTypes(map))), /inside quotes/);
  assert.match(M.check(M.parse(md.replace('  results: at least 1', '  results: at least 1\n  sets: version')), {}).blockers.join(' '), /which its own query uses/);
});
rule('the example checklist (section 8): every search publishes, with its rule and what it uses', () => {
  const md = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'jira-search', 'release-readiness.md'), 'utf8');
  const map = M.parse(md), c = M.check(map, {});
  same(c.blockers, []);
  const got = M.steps(map).filter(x => x.step.type === 'jira.search').map(x => { const k = S.checkFields(x.step.fields, { context: map.meta.context }); return [x.step.id, S.ruleLabel(k.rule), k.uses.slice().sort().join(',')]; });
  same(got, [['scope', 'At least 1', 'project,version'], ['parent', 'None', 'project,version'], ['points', 'None', 'project,version'], ['criteria', 'None', 'project,version'], ['evidence', 'None', 'project,version'], ['done', 'None', 'project,version'], ['fixversion', 'None', 'project,sprint,version'], ['ticket-version', 'Exactly 1', 'readiness,version']]);
  M.steps(map).filter(x => x.step.type === 'jira.search').forEach(x => {
    const sub = S.substitute(x.step.fields.query, DETAILS, map.meta.context);
    assert.ok(sub.ok && S.contained(sub.template, sub).ok, x.step.id);
    assert.ok(S.buildLink('https://jira.example.com/jira', { jql: sub.jql }).ok, x.step.id);
  });
});
run();
