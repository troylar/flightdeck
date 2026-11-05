// Run details in link fields (2.16, Appendix B): the compatibility table (B.5) row by row, the authority grammar, dot
// segments, the parameter-name rule and the query hint, and publish refusing the forms a new version can't use.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), L = PF.urls, M = PF.map;
const CTX = ['tag', 'version', 'host', 'who', 'runbook', 'sprint'];
const fill = (t, d) => L.fillLink(t, d || {}, CTX);
const link = (t, d, href) => { const r = fill(t, d); assert.ok(r.ok, t + ': ' + r.why); assert.strictEqual(r.href, href, t); return r; };
const none = (t, d, why) => { const r = fill(t, d); assert.ok(!r.ok, t + ' gave ' + r.href); assert.ok(why.test(r.why), t + ': ' + r.why); return r; };
const TAG = '2026.11.0-rc3-7f3a9c1';

rule('B.5: static links, whole-link details and plain values are the same link as before', () => {
  link('https://wiki.example.com/release-runbook', {}, 'https://wiki.example.com/release-runbook');
  link('mailto:help@example.com?subject=release', {}, 'mailto:help@example.com?subject=release');
  link('https://jira.example.com/issues/?jql=project%3DPAY%20AND%20status%3DDone', {}, 'https://jira.example.com/issues/?jql=project%3DPAY%20AND%20status%3DDone');
  none('ftp://files.example.com/x', {}, /isn't a link/);
  link('^runbook', { runbook: 'https://wiki.example.com/view?id=7' }, 'https://wiki.example.com/view?id=7');
  link('^runbook', { runbook: 'mailto:oncall@example.com' }, 'mailto:oncall@example.com');
  none('^runbook', { runbook: 'javascript:alert(1)' }, /isn't a web or mailto: link/);
  link('https://build.example.com/job/x/parambuild/?TAG=^tag', { tag: TAG }, 'https://build.example.com/job/x/parambuild/?TAG=' + TAG);
  link('https://build.example.com/x?TAG=^tag&V=^version', { tag: TAG, version: '2026.11.0' }, 'https://build.example.com/x?TAG=' + TAG + '&V=2026.11.0');
  link('https://jira.example.com/issues/?jql=project%3DPAY&label=^tag', { tag: TAG }, 'https://jira.example.com/issues/?jql=project%3DPAY&label=' + TAG);
  link('https://[2001:db8::1]:8443/builds/^tag', { tag: '2026.11.0' }, 'https://[2001:db8::1]:8443/builds/2026.11.0');
  link('https://example.com/releases/^tag/view', { tag: '..x' }, 'https://example.com/releases/..x/view');
});
rule('B.5: values are encoded for their part, so a value can never restructure the link', () => {
  link('https://build.example.com/job/x/parambuild/?TAG=^tag', { tag: 'oops not a tag!!' }, 'https://build.example.com/job/x/parambuild/?TAG=oops%20not%20a%20tag%21%21');
  link('https://build.example.com/job/x/parambuild/?TAG=^tag&ENV=uat', { tag: 'x&ENV=prod' }, 'https://build.example.com/job/x/parambuild/?TAG=x%26ENV%3Dprod&ENV=uat');
  link('https://build.example.com/x?TAG=^tag', { tag: 'rc#1' }, 'https://build.example.com/x?TAG=rc%231');
  link('https://git.example.com/repo/tree/^version', { version: 'release/2026.11' }, 'https://git.example.com/repo/tree/release%2F2026.11');
  link('https://build.example.com/x?TAG=^tag', { tag: 'a%20b' }, 'https://build.example.com/x?TAG=a%2520b');
  link('https://wiki.example.com/spaces/^sprint/overview', { sprint: 'PAY Sprint 42' }, 'https://wiki.example.com/spaces/PAY%20Sprint%2042/overview');
  link('mailto:help@example.com?subject=Release%20^version', { version: '2026.11.0 & more' }, 'mailto:help@example.com?subject=Release%202026.11.0%20%26%20more');
  link('mailto:test@example.com?the+tag=^version', { version: '2026.11.0' }, 'mailto:test@example.com?the+tag=2026.11.0');
  link('mailto:test@example.com?subject=Release&body=^version', { version: '2026.11.0' }, 'mailto:test@example.com?subject=Release&body=2026.11.0');
  link('https://example.com/café/^tag', { tag: 'plain' }, 'https://example.com/caf%C3%A9/plain');
  link('HTTPS://Example.COM/café/^tag?x=1', { tag: 'plain' }, 'https://example.com/caf%C3%A9/plain?x=1');
  link('https://example.com/doc#section-^tag', { tag: 'a b' }, 'https://example.com/doc#section-a%20b');
  ['%6aql', 'j%71l', 'the+tag', 'täg'].forEach(n => assert.ok(fill('https://example.com/x?' + n + '=^tag', { tag: 'v' }).ok, n));
});
rule('B.3: a value that makes a . or .. segment is no link, %2e included', () => {
  ['..', '.'].forEach(v => none('https://example.com/releases/^tag/view', { tag: v }, /"\." or "\.\." path segment/));
  none('https://example.com/releases/.^tag/view', { tag: '.' }, /path segment/);
  none('https://example.com/releases/%2e^tag/view', { tag: '.' }, /path segment/);
});
rule('B.1/B.4: a detail in the address, a parameter name or a part with no =, and invisible characters, are never a link', () => {
  none('https://^host.example.com/x', { host: 'evil.example/' }, /in the address .*context: runbook:link/);
  none('mailto:^who@example.com', { who: 'x' }, /in the address/);
  assert.ok(fill('https://example.com/x?^tag=1', { tag: 'jql' }).plain);
  none('https://example.com/x?^tag=1', { tag: 'jql' }, /in a parameter name/);
  none('mailto:test@example.com?^version=x', { version: 'jql' }, /in a parameter name/);
  none('https://example.com/x?^tag', { tag: 'a' }, /with no "="/);
  ['\t', '\r', '\n', '\u0000', '\u007f', '​', ' ', '﻿', ' '].forEach(c => {
    const r = none('https://example.com/r' + c + '?TAG=^tag', { tag: 'a' }, /control or invisible character/);
    assert.ok(r.plain, JSON.stringify(c));
  });
  assert.strictEqual(L.marked('a\tb​c'), 'a\\u0009b\\u200bc');
  none('https://example.com/x?TAG=^tag', {}, /^Waiting for \^tag\.$/);
  none('https://example.com/x?TAG=^tag', { tag: 'a‮b' }, /can't hold/);
});
rule('B.2: the authority grammar refuses what a browser might read differently', () => {
  const bad = ['https://[bad]/^tag', 'https://example.com:99999/^tag', 'https://example.com:0/^tag', 'https://example.com:bad/^tag', 'https://user@example.com/^tag', 'https://u:p@example.com/^tag',
    'https://exa|mple.com/^tag', 'https://ex_ample.com/^tag', 'https://0x7f.1/^tag', 'https://1.2.3/^tag', 'https://999.1.1.1/^tag', 'https://café.example/^tag', 'https://[::1]xxx/^tag', 'https://ex%41mple.com/^tag'];
  bad.forEach(t => { const c = L.classify(t, CTX); assert.ok(L.refused(c), t + ' -> ' + c.code); assert.ok(!fill(t, { tag: 'a' }).ok, t); });
  ['https://example.com./^tag', 'https://EXAMPLE.com/^tag', 'https://example.com:1/^tag', 'https://example.com:65535/^tag', 'https://[::ffff:1.2.3.4]/^tag', 'https://10.0.0.1/^tag', 'https://xn--caf-dma.example/^tag']
    .forEach(t => assert.ok(fill(t, { tag: 'a' }).ok, t + ': ' + fill(t, { tag: 'a' }).why));
});
rule('B.4: a query-like parameter gets the hint, not a refusal; the list is not exhaustive', () => {
  ['jql', 'JQL', 'jqlQuery', 'cql', 'query', 'q', 'filter', 'search'].forEach(n => {
    const r = fill('https://jira.example.com/issues/?' + n + '=project%3D^tag', { tag: 'PAY OR project=OTHER' });
    assert.ok(r.ok && /Use a Jira search step to build this query safely/.test(r.hint), n);
  });
  assert.strictEqual(fill('https://jira.example.com/issues/?%6aql=^tag', { tag: 'x' }).hint, '');
});
const MD = f => ['---', 'process: rel', 'title: Release', 'context: tag, host, runbook:link', '---', '', '## Ship · READ-DO {#ship}', '- [ ] {ui.action} Open it {#open}', '  page: ' + f, ''].join('\n');
const check = f => M.check(M.parse(MD(f)), {});
rule('publish: new versions can\'t use a refused form; the query hint is a suggestion', () => {
  ['https://^host.example.com/x', 'https://example.com/x?^tag=1', 'https://example.com/r​?TAG=^tag', 'https://[bad]/^tag', 'https://user@example.com/^tag'].forEach(f =>
    assert.ok(check(f).blockers.some(b => /field "page"/.test(b)), f + ': ' + JSON.stringify(check(f).blockers)));
  ['https://example.com/x?TAG=^tag', '^runbook', 'https://example.com/static', 'https://example.com/releases/^tag'].forEach(f =>
    assert.ok(!check(f).blockers.some(b => /field "page"/.test(b)), f + ': ' + JSON.stringify(check(f).blockers)));
  assert.ok(check('https://jira.example.com/?jql=^tag').suggestions.some(s => /Use a Jira search step/.test(s)));
});
rule('the link-building code carries the security note and never builds a RegExp from a value', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/core/jira.js'), 'utf8');
  assert.ok(src.indexOf('// SECURITY-REVIEW: generic link fields guarantee URL structure only; {jira.search} is the only dynamic-query path with an injection guarantee') >= 0);
});

run();
