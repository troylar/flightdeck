// The run screen for a Jira search step (2.16, design section 7), rendered without a browser: the filled-in query with
// Copy, the rule, Open in Jira or why there's no link, the result line, Block with these, Refresh search, and the
// reopened mark. searchId is Flightdeck's own, never a box to type in.
'use strict';
const assert = require('assert');
const { loadViews, exactOf, rule, run } = require('./harness');
const PF = loadViews(), R = PF.run, P = PF.publish, V = PF.views, M = PF.map;
const NOW = '2026-11-04T15:00:00.000Z', LATER = '2026-11-04T15:10:00.000Z';
const TV = PF.teamValues.parse(JSON.stringify({ format: 'flightdeck-team-values/1', values: { 'jira-base-url': { value: 'https://jira.example.com/jira' } } }));
const MD = ['---', 'process: rel', 'title: Release', 'context: project, version', 'roles: lead', '---', '',
  '## Stories · DO-CONFIRM {#stories}',
  '- [!] {jira.search} Stories are Done in ^version @lead {#done}', '  query: project = ^project AND fixVersion = ^version AND status != Done', '  results: none', '  what: Stories not Done yet',
  '- [ ] {confirm} Tell the team {#tell}', '',
  '## Gate: Ready {#ready}', ''].join('\n');
const b = P.build(MD, { people: [], customTypes: {}, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'abcd1234', app: '2.16.0', teamValues: TV });
assert.ok(!b.blockers, (b.blockers || []).join(' | '));
const PUB = P.verify(b.folder, b.files, exactOf(PF, b.files));
function setup(o) {
  const r = R.create(PUB, { title: 'R', details: { project: 'PAY', version: '2026.11.0' }, roles: { lead: 'person-casey' }, by: 'person-casey', session: 'me', now: NOW, id: 'run1', app: '2.16.0', teamValues: o && 'teamValues' in o ? o.teamValues : TV });
  r._notes = []; r._conflicts = [];
  const state = { view: 'run', me: 'person-casey', sel: 'done', refOpen: true, pick: null, edit: null, unfold: {}, msg: null, pendingFiles: [], unsaved: {}, saveErr: {}, startMode: {}, archive: {}, keys: true, fs: { kind: 'memory', name: 'x' }, fieldErr: null, showRoles: false, copyView: null };
  const ctx = { state, canFolder: true, data: { people: [], validations: [], processes: [{ process: 'rel', pubs: [PUB], index: { latest: PUB } }], runs: [r], plans: [], drafts: [], skills: [], legacy: [], readAt: NOW },
    now: () => Date.parse(NOW), peopleById: {}, run: () => r, recording: x => !x.ended && x.recorder.person === state.me && x.recorder.session === 'me', attachments: () => [],
    canRecover: () => true, processTitle: id => id, processes: () => [], findRun: () => null, latestPub: () => null, suggestRole: () => null, localCopy: () => null, img: () => '<img src="blob:test">' };
  return { r, ctx, state, html: () => V.run(ctx) };
}
const sid = r => R.searchId(r, R.mapOf(r), M.findStep(R.mapOf(r), 'done').step);

rule('7: the step shows what it finds, the filled-in query with Copy, the rule and Open in Jira; no searchId box', () => {
  const { html } = setup(), h = html();
  assert.ok(h.indexOf('Stories not Done yet') >= 0, 'what');
  assert.ok(h.indexOf('project = &quot;PAY&quot; AND fixVersion = &quot;2026.11.0&quot; AND status != Done') >= 0, 'the filled-in query, escaped');
  assert.ok(/aria-label="Copy the query"/.test(h), 'Copy');
  assert.ok(/<b>Should find:<\/b> None/.test(h), 'the rule chip');
  assert.ok(/href="https:\/\/jira\.example\.com\/jira\/issues\/\?jql=[^"]+" target="_blank" rel="noopener noreferrer"><b>Open in Jira<\/b>/.test(h), 'the link');
  assert.ok(!/id="rec-searchId"/.test(h), 'searchId is never typed');
  assert.ok(/id="rec-count"/.test(h), 'count is');
  assert.ok(/data-act="search-block" data-id="done"/.test(h), 'Block with these is offered');
});
rule('7: with no Jira address, no link and the reason; the query can still be copied', () => {
  const { html } = setup({ teamValues: null }), h = html();
  assert.ok(!/Open in Jira/.test(h) && /the run has no Jira address/.test(h), 'the reason');
  assert.ok(/aria-label="Copy the query"/.test(h));
});
rule('7: the result line, green when the rule is met and red with the keys when it isn\'t', () => {
  const { r, html } = setup(), map = R.mapOf(r);
  R.done(r, map, 'done', 'person-casey', LATER, { searchId: sid(r), count: '0', ranAt: '2026-11-04T15:05Z' });
  assert.ok(/class="search-res good" role="status">Found 0 · searched [^<]+ · checked/.test(html()), html().match(/search-res[^<]*/));
  const t = setup(), m2 = R.mapOf(t.r);
  R.block(t.r, m2, 'done', '', 'person-casey', LATER, { searchId: sid(t.r), count: '2', keys: 'PAY-1, PAY-2' });
  assert.ok(/class="search-res bad" role="status">Found 2 · PAY-1, PAY-2/.test(t.html()));
});
rule('5.6 and 5.9: a damaged generation offers Refresh search; a reopened search says so', () => {
  const { r, html } = setup();
  assert.ok(!/refresh-search/.test(html()), 'not when nothing is damaged');
  r.searchGen.version = 'broken';
  const h = html();
  assert.ok(/data-act="refresh-search" data-id="done"/.test(h) && /damaged/.test(h));
  const t = setup(), map = R.mapOf(t.r);
  R.done(t.r, map, 'done', 'person-casey', LATER, { searchId: sid(t.r), count: '0' });
  t.r.steps.done.values.count = '3';
  const back = R.sanitize(JSON.parse(JSON.stringify(t.r, (k, v) => k === '_notes' || k === '_conflicts' ? undefined : v)));
  assert.ok(back.steps.done.reopened, JSON.stringify(back.steps.done)); back._notes = []; back._conflicts = []; t.ctx.run = () => back; t.ctx.data.runs = [back];
  const hh = t.html(); assert.ok(/Reopened when read/.test(hh), (hh.match(/search-box.{0,600}/) || [''])[0]);
});
rule('R14-8 and R14-3: in a completed run, the reopened search has a badge, its evidence boxes and Done, and nothing else', () => {
  const t = setup(), map = R.mapOf(t.r);
  R.done(t.r, map, 'done', 'person-casey', LATER, { searchId: sid(t.r), count: '0' }); R.done(t.r, map, 'tell', 'person-casey', LATER); R.pass(t.r, map, 0, 'person-casey', LATER);
  t.r.state = 'completed'; t.r.ended = { outcome: 'Completed', by: 'person-casey', byName: 'Casey', at: LATER };
  const o = JSON.parse(JSON.stringify(t.r, (k, v) => k === '_notes' || k === '_conflicts' ? undefined : v)); o.steps.done.values.count = '5';
  const c = R.sanitize(o); c._notes = []; c._conflicts = []; t.ctx.run = () => c; t.ctx.data.runs = [c];
  const h = t.html();
  assert.ok(/class="badge b-warn" title="[^"]*">Reopened when read</.test(h), 'the row badge');
  assert.ok(/id="rec-count"/.test(h) && !/id="rec-count"[^>]*disabled/.test(h), 'the evidence box, enabled');
  assert.ok(/data-act="record" data-id="done">/.test(h), 'Done');
  assert.ok(!/data-kind="block" data-id="done"/.test(h) && !/data-act="na" data-id="done"/.test(h) && !/data-mode="differently" data-id="done"/.test(h), 'nothing else');
  t.state.sel = 'tell';
  assert.ok(!/data-act="record" data-id="tell"|data-act="toggle" data-id="tell">Uncheck/.test(t.html()), 'no other step can be answered');
});
rule('R14-2: Restore it keeps both copies\' history records (R.mergeOverflow), never only the browser copy\'s', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  const at = src.indexOf("'restore-local': function"), body = src.slice(at, src.indexOf("'discard-local'", at));
  assert.ok(at > 0 && /c\._overflow = R\.mergeOverflow\(local\._overflow, c\._overflow\)/.test(body), body);
  assert.ok(!/local\._overflow \|\| \[\]/.test(body));
});
const ins = h => h.slice(h.indexOf('id="rw-ins"'));
rule('R14-3/R14-7: a reopened search\'s notice gives its reason, escaped, and the exact next action: running, completed, stuck', () => {
  const t = setup(), map = R.mapOf(t.r);
  R.done(t.r, map, 'done', 'person-casey', LATER, { searchId: sid(t.r), count: '0' });
  const o = JSON.parse(JSON.stringify(t.r, (k, v) => k === '_notes' || k === '_conflicts' ? undefined : v)); o.steps.done.values.count = '3';
  const back = R.sanitize(o); back._notes = []; back._conflicts = []; t.ctx.run = () => back; t.ctx.data.runs = [back];
  assert.ok(ins(t.html()).indexOf('Reopened when read: its results can&#39;t check this search. Refresh the search, search again, then choose Done.') >= 0, ins(t.html()).match(/note warn.{0,300}/));
  back.steps.done.reason = 'Reopened when read: <b>x</b>';
  assert.ok(ins(t.html()).indexOf('Reopened when read: &lt;b&gt;x&lt;/b&gt;.') >= 0, 'the reason is escaped');
  const c = setup(), cm = R.mapOf(c.r);
  R.done(c.r, cm, 'done', 'person-casey', LATER, { searchId: sid(c.r), count: '0' }); R.done(c.r, cm, 'tell', 'person-casey', LATER); R.pass(c.r, cm, 0, 'person-casey', LATER);
  c.r.state = 'completed'; c.r.ended = { outcome: 'Completed', by: 'person-casey', byName: 'Casey', at: LATER };
  const co = JSON.parse(JSON.stringify(c.r, (k, v) => k === '_notes' || k === '_conflicts' ? undefined : v)); co.steps.done.values.count = '5';
  const cr = R.sanitize(JSON.parse(JSON.stringify(co))); cr._notes = []; cr._conflicts = []; c.ctx.run = () => cr; c.ctx.data.runs = [cr];
  assert.ok(ins(c.html()).indexOf('The run stays Completed; answer this step again with Done. Every other step stays closed.') >= 0, 'completed');
  const so = JSON.parse(JSON.stringify(co)); so.details.version = '1‮2';
  const sr = R.sanitize(so); sr._notes = []; sr._conflicts = []; c.ctx.run = () => sr; c.ctx.data.runs = [sr];
  assert.strictEqual(sr.steps.done.reopened, 'stuck');
  const h = c.html();
  assert.ok(ins(h).indexOf('Reopened when read: this run&#39;s record is damaged and can&#39;t be repaired here; start a new run. Start a new run of this checklist; this run stays as recorded.') >= 0, ins(h).match(/note warn.{0,400}/));
  assert.ok(/>Reopened when read: start a new run</.test(h), 'the row says so');
  assert.ok(!/data-act="record" data-id="done">/.test(h), 'no Done');
});
rule('7: search times show the year and the zone; the HTML receipt shows the search as 8 hex, as the text receipt does', () => {
  const { r, ctx, html } = setup(), map = R.mapOf(r);
  R.done(r, map, 'done', 'person-casey', LATER, { searchId: sid(r), count: '0', ranAt: '2026-11-04T15:05Z' });
  const line = (html().match(/search-res good" role="status">[^<]*/) || [''])[0];
  assert.ok(/searched Nov 4, 2026, \d{1,2}:\d{2} [AP]M [A-Z]{2,5}[+-]?[\d:]*/.test(line) && /checked \d{1,2}:\d{2} [AP]M</.test(line + '<'), line);
  R.done(r, map, 'tell', 'person-casey', LATER); R.pass(r, map, 0, 'person-casey', LATER); R.end(r, map, 'Completed', 'person-casey', 'Casey', LATER);
  const rh = V.receipt(ctx);
  const short = sid(r).replace(/^sha256:/, '').slice(0, 8);
  assert.ok(rh && rh.indexOf('Search: ' + short) >= 0 && rh.indexOf(sid(r)) < 0, 'the receipt abbreviates it');
});
run();
