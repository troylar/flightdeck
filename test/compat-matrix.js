// The per-tag capability matrix (docs/design.md section 28; the 2.0 plan's matrix, checked against the code): which writers and
// readers exist in each release. tools/old-folders.js runs a writer only where its row says the release has it, and
// test/compat.test.js checks every row against every release's own code, so the table can't drift from what shipped.
// from: the first release with it; until: the last (when it was removed). plan: what the 2.0 plan's matrix says, where the
// code says otherwise (kept so the difference stays visible).
'use strict';
const { cmp } = require('../tools/old-bundles');

const fn = (o, k) => !!o && typeof o[k] === 'function';
const repoHas = (...ks) => (PF) => ks.every(k => fn(PF.repo, k));

const H = require('./compat-harness');
/* Whether PF is a 2.x copy, which runs /2 versions and run/3 files itself. */
const twoX = (PF) => +String(PF.__version || '0').split('.')[0] >= 2;

/* What is newer than PF's own release (H.newer). */
const newerFor = (PF) => H.newer({ version: String(PF.__version), major: +String(PF.__version).split('.')[0] });
/* A /2 publication record, otherwise valid for its files, using a feature PF's release doesn't build (H.newer: staged versions
   for 2.0, extensions for 2.1): is it set aside as unusable? (For 1.x any /2 is newer; for 2.x the feature is, and the same
   record without it must be usable there, so the refusal can't come from a malformed record.) */
function refusesNewerPublication(PF) {
  const map = '---\nprocess: p\ntitle: P\n---\n\n## One {#one}\n- [ ] {confirm} A {#a}\n', types = '{}';
  const base = { process: 'p', title: 'P', version: 1, folder: 'v1-aaaa' };
  const n = newerFor(PF);
  const check = (features) => PF.publish.verify('v1-aaaa', { 'publication.json': JSON.stringify(H.pub2(PF, base, map, types, features, features.length ? n.app : '2.0.0')), 'map.md': map, 'types.json': types }, H.exact2(map, types));
  const v = check(n.pub);
  return !v.ok && !!v.unusable && (!twoX(PF) || check([]).ok);
}
/* A preflight-run/3 file, otherwise one a 2.x copy wrote, with a feature PF's release doesn't build (H.newer: test runs for
   2.0, extensions for 2.1): kept by name only, and never writable? (On 2.x, the same file without it must read in full.) */
function namesNewerRun(PF) {
  if (!fn(PF.run, 'create')) return false;
  const md = '---\nprocess: p\ntitle: P\n---\n\n## One {#one}\n- [ ] {confirm} A {#a}\n';
  const pub = { info: { format: PF.publish.FORMAT, version: 1, folder: 'v1-aaaa', mapHash: PF.util.hash(md), typesHash: PF.util.hash('{}') }, map: PF.map.parse(md), md, types: {} };
  let text; try { text = JSON.stringify(PF.run.create(pub, { by: 'person-avery', session: 's1', now: '2026-01-01T00:00:00.000Z', id: 'r1' })); } catch (e) { return false; }
  const n = newerFor(PF), r = PF.run.sanitize(JSON.parse(H.run3(text, n.run, n.app, PF.util.hash('{}'))));
  if (!(r && r._unrunnable)) return false;
  if (!twoX(PF)) return true;
  const plain = PF.run.sanitize(JSON.parse(H.run3(text, [], '2.0.0', PF.util.hash('{}'))));
  return !!(plain && !plain._unrunnable);
}
/* A run/2 with a field this copy doesn't know: opened read-only rather than having the field dropped? */
function readOnlyOnUnknownField(PF) {
  if (!fn(PF.run, 'create')) return false;
  const md = '---\nprocess: p\ntitle: P\n---\n\n## One {#one}\n- [ ] {confirm} A {#a}\n';
  const pub = { info: { format: PF.publish.FORMAT, version: 1, folder: 'v1-aaaa', mapHash: PF.util.hash(md) }, map: PF.map.parse(md), md, types: {} };
  let r; try { r = PF.run.create(pub, { by: 'person-avery', session: 's1', now: '2026-01-01T00:00:00.000Z', id: 'r1' }); } catch (e) { return false; }
  const plain = PF.run.sanitize(JSON.parse(JSON.stringify(r))), o = JSON.parse(JSON.stringify(r));
  o.fromANewerCopy = { x: 1 };
  const back = PF.run.sanitize(o);
  return !!(plain && !plain._unrunnable && back && back._unrunnable && /fromANewerCopy/.test(back._unrunnable));
}

/* ---- 2.16: what it newly writes and reads, each probed on the release's own code ---- */
const AT16 = '2026-11-04T15:00:00.000Z';
/* Specimens made once by this version's own writers (the full harness: the Jira address check needs a URL parser). */
let made16 = null;
function specimens16() {
  if (made16) return made16;
  const BPF = require('./harness').load();
  const tv = BPF.teamValues.parse(JSON.stringify({ format: 'flightdeck-team-values/1', values: { 'jira-base-url': { value: 'https://jira.example.com' } } }));
  const build = (md) => {
    const b = BPF.publish.build(md, { people: [], customTypes: {}, by: 'person-avery', changes: 'First', existing: [], now: AT16, rand: 'abcd1234', app: '2.16.0', teamValues: tv });
    if (b.blockers) throw new Error('2.16 specimen: ' + b.blockers.join(' | '));
    return b;
  };
  const jira = build(['---', 'process: rel', 'title: Release', 'context: version', '---', '', '## Stories · DO-CONFIRM {#stories}',
    '- [ ] {jira.search} No open blockers in ^version {#blockers}', '  query: fixVersion = ^version AND priority = Blocker', '  results: none', ''].join('\n'));
  const pattern = build(['---', 'process: rel', 'title: Release', 'context: version, tag:pattern(v\\d{1,3})', '---', '', '## Ship · READ-DO {#ship}', '- [ ] {confirm} Ship ^tag {#ship-it}', ''].join('\n'));
  const R = BPF.run, v = BPF.publish.verify(jira.folder, jira.files, H.exact2(jira.files['map.md'], jira.files['types.json']));
  const run = () => R.create(v, { title: 'R', details: { version: '2026.11.0' }, roles: {}, by: 'person-avery', session: 'w-a', now: AT16, id: 'run-s1', app: '2.16.0', teamValues: tv });
  const started = run(), blocked = run(), map = R.mapOf(blocked);
  R.block(blocked, map, 'blockers', '', 'person-avery', AT16, { searchId: R.searchId(blocked, map, BPF.map.findStep(map, 'blockers').step), count: '2', keys: 'PAY-1, PAY-2' });
  const startedId = R.searchId(started, R.mapOf(started), BPF.map.findStep(R.mapOf(started), 'blockers').step);
  if (!startedId || ['searchSites', 'searchGen', 'searchRec'].some(k => !started[k] || !Object.keys(started[k]).length)) throw new Error('2.16 specimen: the started run has no search state');
  made16 = { jira, pattern, started: JSON.stringify(started), startedId, blocked: JSON.stringify(blocked) };
  return made16;
}
const verify16 = (PF, b) => { try { return PF.publish.verify(b.folder, b.files, H.exact2(b.files['map.md'], b.files['types.json'])); } catch (e) { return { ok: false }; } };
/* A publication with a {jira.search} step: usable, the step read as that type, frozen at version 4. */
function readsJiraSearch(PF) {
  const v = verify16(PF, specimens16().jira), t = PF.types && fn(PF.types, 'get') ? PF.types.get('jira.search') : null;
  return v.ok === true && !!t && t.version === 4 && !!v.map && PF.map.findStep(v.map, 'blockers').step.type === 'jira.search';
}
/* A publication with a run detail that must match a pattern: usable, the pattern kept as written. */
function readsPatternDetail(PF) {
  const v = verify16(PF, specimens16().pattern), d = v.ok && v.map && v.map.meta && v.map.meta.detailTypes ? v.map.meta.detailTypes.tag : null;
  return !!d && d.kind === 'pattern' && d.pattern === 'v\\d{1,3}';
}
/* Set aside as unusable, saying it needs 2.16 (the bridge and 2.0 to 2.14). */
const refuses16 = (which) => (PF) => { const v = verify16(PF, specimens16()[which]); return !v.ok && !!v.unusable && /2\.16/.test(String(v.why || '') + ' ' + String(v.needs || '')); };
/* A run of a search step, read in full: the containers it keeps (searchSites, searchGen, searchRec) come back with the
   contents 2.16 wrote, and the step's search identity is the one the results were entered for. */
function readsSearchRun(PF) {
  if (!fn(PF.run, 'searchId')) return false;
  try {
    const m = specimens16(), was = JSON.parse(m.started), r = PF.run.sanitize(JSON.parse(m.started));
    if (!r || r._unrunnable || !['searchSites', 'searchGen', 'searchRec'].every(k => JSON.stringify(r[k]) === JSON.stringify(was[k]))) return false;
    const map = PF.run.mapOf(r);
    return PF.run.searchId(r, map, PF.map.findStep(map, 'blockers').step) === m.startedId;
  } catch (e) { return false; }
}
/* A search step blocked with its results (Block with these): read in full, the results kept on the blocked step. */
function readsBlockedResults(PF) {
  try { const r = PF.run.sanitize(JSON.parse(specimens16().blocked)), a = r && r.steps && r.steps.blockers; return !!r && !r._unrunnable && !!a && a.s === 'blocked' && !!a.values && a.values.keys === 'PAY-1, PAY-2' && a.values.count === '2'; } catch (e) { return false; }
}
/* Publish refuses a run detail in a link's host, in a parameter name and in a parameter with no "=" (Appendix B), by the
   check every publish runs, and still allows one as a parameter's value. */
function refusesLinkForms(PF) {
  try {
    const page = (p) => (PF.map.check(PF.map.parse(['---', 'process: rel', 'title: Release', 'context: tag, host', '---', '', '## Ship · READ-DO {#ship}', '- [ ] {ui.action} Open it {#open}', '  page: ' + p, ''].join('\n')), {}).blockers || []).filter(b => /field "page"/.test(b));
    const refused = (p, why) => { const b = page(p); return b.length === 1 && why.test(b[0]); };
    return refused('https://^host.example.com/x', /has a run detail in the address/) && refused('https://example.com/x?^tag=x', /has a run detail in a parameter name/) &&
      refused('https://example.com/x?^tag', /has a run detail in a parameter with no "="/) && page('https://example.com/x?tag=^tag').length === 0;
  } catch (e) { return false; }
}
/* A report on a step that sets a run detail (Appendix A.4) is accepted with the value it sets; the same report shape on a
   step that sets nothing is accepted too, so a refusal can only come from sets:. */
function acceptsReportSets(PF) {
  if (!PF.reports || !fn(PF.reports, 'eligible') || !fn(PF.run, 'create')) return false;
  const one = (sets) => {
    const md = ['---', 'process: p', 'title: P', 'context: ticket', '---', '', '## One {#one}', '- [ ] {confirm} Note the ticket {#a}'].concat(sets ? ['  sets: ticket'] : []).concat(['']).join('\n');
    const pub = { info: { format: PF.publish.FORMAT, version: 1, folder: 'v1-aaaa', mapHash: PF.util.hash(md), typesHash: PF.util.hash('{}') }, map: PF.map.parse(md), md, types: {} };
    const r = PF.run.create(pub, { title: 'P', details: sets ? {} : { ticket: 'ABC-1' }, roles: {}, by: 'person-avery', session: 's1', now: AT16, id: 'r1' }), map = PF.run.mapOf(r), ev = {};
    if (sets) PF.run.evidenceFor(r, PF.map.findStep(map, 'a').step).list.forEach(d => { if (d.detail === 'ticket') ev[d.name] = 'ABC-7'; });
    const rep = { format: 'flightdeck-report/1', process: 'p', run: 'r1', publication: { folder: 'v1-aaaa' }, step: 'a', verdict: 'pass', blockers: [], evidence: ev, links: [], inputs: [], producer: { name: 'ci', version: '1.0.0' }, created: AT16, id: 'abcd1234' };
    return PF.reports.eligible({ key: 'p/r1/a/ci/abcd1234', process: 'p', run: 'r1', step: 'a', producer: 'ci', id: 'abcd1234', copies: [{ ok: true, sha256: 'a'.repeat(64) }], report: rep, sha256: 'a'.repeat(64), differ: false, unreadable: [] }, r, map, { recording: true, now: AT16 });
  };
  try { const s = one(true); return !!one(false).ok && !!s.ok && JSON.stringify(s.sets || []).indexOf('ABC-7') >= 0; } catch (e) { return false; }
}
/* An update holds AGENTS.md (stages it, leaving the team's) while a file it points to lacks a section it cites, and writes it
   when the file has the section. */
function holdsAgents(PF) {
  if (!PF.contract || !fn(PF.contract, 'hold')) return false;
  try {
    const G = '.flightdeck/skills/_flightdeck/command-guide.md', A = '<!-- flightdeck:begin -->\nCommands: see `' + G + '` (*the command guide*). Use *Commands* in the command guide.\n<!-- flightdeck:end -->\n';
    const old = '<!-- flightdeck:begin -->\nOld.\n<!-- flightdeck:end -->\n', st = () => [{ key: 'AGENTS.md', status: 'update' }, { key: G, status: 'kept' }];
    const lacking = PF.contract.hold(st(), [{ key: 'AGENTS.md', text: A, now: old }, { key: G, text: '## Commands\n\nx\n', now: '## Other\n\nx\n' }]);
    const having = PF.contract.hold(st(), [{ key: 'AGENTS.md', text: A, now: old }, { key: G, text: '## Commands\n\nx\n', now: '## Commands\n\nours\n' }]);
    return lacking[0].status === 'merge' && lacking[0].heldFrom === 'update' && having[0].status === 'update';
  } catch (e) { return false; }
}

const ROWS = [
  // Writers
  { id: 'drafts', what: 'Drafts (repo.saveDraft)', from: '1.10.0', has: repoHas('saveDraft'), writes: ['maps/drafts/<process>.md'] },
  { id: 'publish', what: 'Publish (repo.publish)', from: '1.10.0', has: repoHas('publish'), writes: ['publications/<process>/<folder>/'] },
  { id: 'runs', what: 'Runs (repo.saveRun)', from: '1.10.0', has: repoHas('saveRun'), writes: ['runs/<process>/<id>/run.json', 'candidate-*.json', 'run.conflict-*.json', 'replaced-*.json', 'history-*.jsonl'] },
  { id: 'notes', what: 'Notes (repo.addNote)', from: '1.10.0', has: repoHas('addNote'), writes: ['runs/<process>/<id>/notes-<writer>.jsonl'] },
  { id: 'step-types', what: 'Step types (repo.saveStepType)', from: '1.10.0', has: repoHas('saveStepType'), writes: ['step-types/<id>.json'] },
  { id: 'sign-offs', what: 'Sign-offs (repo.recordValidation)', from: '1.10.0', has: repoHas('recordValidation'), writes: ['validations/<process>.v<N>.<writer>.json'] },
  { id: 'plan-status', what: 'Plan decisions (repo.recordPlanStatus)', from: '1.10.0', has: repoHas('recordPlanStatus'), writes: ['proposals/<plan>.status-<writer>.json', 'from 2.1.1 a start or decline: proposals/<plan>.status-<writer>-d.json (start-once)'] },
  { id: 'plans', what: 'Plans (repo.savePlan)', from: '1.11.0', has: repoHas('savePlan'), writes: ['proposals/plan-*.json'] },
  { id: 'fixes', what: 'Suggested fixes (PF.fixes, repo.decideFix)', from: '1.11.0', until: '1.12.0', plan: 'not listed', has: (PF) => !!PF.fixes && fn(PF.repo, 'decideFix'), writes: ['notes kind "fix"', 'suggestions/<process>/<id>.<writer>.json'] },
  { id: 'builder', what: 'The outline builder (PF.outline, the editor\'s builder view)', from: '1.11.0', has: (PF, page) => !!PF.outline && page.indexOf('ob-move') >= 0, writes: ['maps/drafts/<process>.md'] },
  { id: 'type-editor', what: 'The step-type editor (edit-type, repo.saveStepType)', from: '1.10.0', has: (PF, page) => fn(PF.repo, 'saveStepType') && page.indexOf("'edit-type'") >= 0, writes: ['step-types/<id>.json'] },
  { id: 'undo', what: 'Undo and Redo in the editor (PF.timeline, in memory)', from: '1.12.0', has: (PF) => !!PF.timeline, writes: [] },
  { id: 'saved-history', what: 'Saved editor history (repo.appendHistory)', from: '1.16.0', plan: '1.12.0 (the plan counts timeline.js; it wrote no files before 1.16.0)', has: repoHas('appendHistory'), writes: ['history/drafts/<process>/<writer>.jsonl', 'history/step-types/<id>/<writer>.jsonl'] },
  { id: 'corrections', what: 'Corrections (PF.corrections, repo.decideCorrection)', from: '1.13.0', has: (PF) => !!PF.corrections && fn(PF.repo, 'decideCorrection'), writes: ['notes kind "correction"', 'corrections/<process>/<group>.<writer>.json'] },
  { id: 'apply-correction', what: 'Apply a correction to the draft (repo.applyCorrection)', from: '1.16.0', has: repoHas('applyCorrection'), writes: ['maps/drafts/<process>.md'] },
  { id: 'people', what: 'people.json writer (PF.people, repo.savePeople)', from: '1.15.0', has: (PF) => !!PF.people && fn(PF.repo, 'savePeople'), writes: ['people.json'] },
  { id: 'health', what: 'Folder health (PF.health, repo.scan)', from: '1.15.0', has: (PF) => !!PF.health && fn(PF.repo, 'scan'), writes: [] },
  { id: 'connection', what: 'Connection check (PF.connection, repo.sendProbe)', from: '1.15.0', has: (PF) => !!PF.connection && fn(PF.repo, 'sendProbe'), writes: ['connection/<file>.json'] },
  { id: 'followups', what: 'Follow-up decisions (PF.followups, repo.decideFollowUp)', from: '1.16.0', has: (PF) => !!PF.followups && fn(PF.repo, 'decideFollowUp'), writes: ['followups/<process>/<run>.<followUp>.<writer>.<rev>.json'] },
  { id: 'pf-storage', what: 'pf-storage block in the page', from: '1.17.0', has: (PF, page) => /<script id="pf-storage">/.test(page), writes: [] },
  { id: 'evidence', what: 'Evidence packs (PF.evidence, repo.collectEvidence)', from: '1.17.0', has: (PF) => !!PF.evidence && fn(PF.repo, 'collectEvidence'), writes: [] },
  { id: 'read', what: 'READ/1 (PF.appjson; flightdeck runs --json)', from: '1.18.0', has: (PF, page, cli) => !!PF.appjson && cli.indexOf('flightdeck-read/1') >= 0, writes: [] },
  { id: 'proposals', what: 'Proposals and presence (PF.proposals)', from: '1.19.0', has: (PF) => !!PF.proposals && fn(PF.repo, 'loadProposed'), writes: ['proposed/<process>/*.json', 'presence/<writer>.json'] },
  { id: 'requests', what: 'Requests from other apps (PF.requests; flightdeck plan request)', from: '1.20.0', plan: '"Reports" in the plan\'s matrix: 1.20 shipped REQUEST only, and REPORT moved to 2.0 (slice 2b)', has: (PF) => !!PF.requests, writes: ['proposals/<request>.json (a plan)'] },
  { id: 'reports', what: 'Reports from other apps (PF.reports, repo.decideReport; flightdeck report)', from: '2.0.0', has: (PF) => !!PF.reports && fn(PF.repo, 'decideReport'), writes: ['report-decisions/<process>/<run>.<hash>.<writer>.<rev>.json'] },
  { id: 'conditions', what: 'Only when (PF.conditions, PF.run.applies)', from: '2.1.0', has: (PF) => !!PF.conditions && fn(PF.conditions, 'parse') && fn(PF.run, 'applies'), writes: ['publications/<process>/<folder>/ (preflight-publication/2 naming conditions)', 'runs/<process>/<id>/run.json (preflight-run/3 naming conditions)'] },
  { id: 'staging', what: 'Stage the draft for testing (PF.staging, repo.stage)', from: '2.1.0', has: (PF) => !!PF.staging && fn(PF.repo, 'stage') && fn(PF.repo, 'readStage'), writes: ['staged/<process>/stage-<random8>/ (preflight-publication/2 naming staged)'] },
  { id: 'stage-decisions', what: 'Retire and reopen a stage (repo.decideStage)', from: '2.1.0', has: repoHas('decideStage'), writes: ['staged/<process>/decisions/<stage>.<writer>.<rev>.json (flightdeck-stage-decision/1)'] },
  { id: 'promote', what: 'Make a stage the default (repo.promote)', from: '2.1.0', has: repoHas('promote'), writes: ['publications/<process>/<folder>/ (with stagedFrom, /1 when nothing else is left)'] },
  { id: 'test-runs', what: 'Test runs on a stage (repo.startTestRun)', from: '2.1.0', has: (PF) => fn(PF.repo, 'startTestRun') && fn(PF.run, 'isTest'), writes: ['runs/<process>/<id>/run.json (preflight-run/3 naming staged and test-run)'] },
  { id: 'stage-sign-offs', what: 'Sign off a stage (repo.signOffStage)', from: '2.1.0', has: repoHas('signOffStage', 'recordStageValidation'), writes: ['validations/<process>.<stage>.<writer>.json (flightdeck-validation/2)'] },
  { id: 'start-once', what: 'A planned start writes its decision first, a start or decline in its own file, and Try again saves only that run (repo.resumeStart)', from: '2.1.1',
    has: (PF) => fn(PF.repo, 'resumeStart') && String(PF.repo.recordPlanStatus).indexOf("'-d'") >= 0, writes: ['proposals/<plan>.status-<writer>-d.json (a start or decline; a switch stays in <plan>.status-<writer>.json)'] },
  { id: 'passed-details', what: 'What a linked step passes (PF.links, pass:)', from: '2.8.0', has: (PF) => !!PF.links && fn(PF.links, 'parse') && fn(PF.links, 'write'), writes: ['publications/<process>/<folder>/ (preflight-publication/2 naming passed-details)', 'runs/<process>/<id>/run.json (preflight-run/3 naming passed-details)'] },
  { id: 'team-values', what: 'Team values in team-values.json, passed with pass: name=team:… (PF.teamValues, repo.saveTeamValues)', from: '2.9.0', has: (PF) => !!PF.teamValues && fn(PF.teamValues, 'parse') && fn(PF.repo, 'saveTeamValues'), writes: ['team-values.json (Settings › Team values)', 'publications/<process>/<folder>/ (preflight-publication/2 naming team-values)', 'runs/<process>/<id>/run.json (preflight-run/3 naming team-values, a link\'s teamPassed)'] },
  { id: 'type-save-cli', what: 'Step types from the command line (flightdeck type save, flightdeck-write/1)', from: '2.14.0', has: (PF, page, cli) => cli.indexOf('flightdeck-write/1') >= 0, writes: ['step-types/<id>.json', 'history/step-types/<id>/agent-<operation>.jsonl'] },
  { id: 'jira-search', what: 'A Jira search step, its type frozen at version 4 ({jira.search}, PF.jira)', from: '2.16.0', has: readsJiraSearch, writes: ['publications/<process>/<folder>/ (preflight-publication/2 naming jira-search; types.json freezes jira.search at version 4)', 'staged/<process>/stage-<random8>/ (the same)'] },
  { id: 'search-runs', what: 'A run of a Jira search keeps its addresses and generations (searchSites, searchGen, searchRec)', from: '2.16.0', has: readsSearchRun, writes: ['runs/<process>/<id>/run.json (preflight-run/3 naming jira-search, with searchSites, searchGen and searchRec)'] },
  { id: 'blocked-results', what: 'Block with these: a search step blocked with its results', from: '2.16.0', has: readsBlockedResults, writes: ['runs/<process>/<id>/run.json (a blocked search step with values)', 'report-decisions/<process>/<run>.<hash>.<writer>.<rev>.json (the report it blocked with, declined)'] },
  { id: 'detail-patterns', what: 'Run details that must match a pattern (context: name:pattern(...))', from: '2.16.0', has: readsPatternDetail, writes: ['publications/<process>/<folder>/ (preflight-publication/2 naming detail-patterns)', 'runs/<process>/<id>/run.json (preflight-run/3 naming detail-patterns)'] },
  { id: 'link-forms', what: 'Publish refuses a run detail in a link\'s host, a parameter\'s name or a query part with no = (Appendix B)', from: '2.16.0', has: refusesLinkForms, writes: [] },
  { id: 'report-sets', what: 'A report may set the run details its step sets (Appendix A.4)', from: '2.16.0', has: acceptsReportSets, writes: ['runs/<process>/<id>/run.json (details set by an accepted report)', 'report-decisions/<process>/<run>.<hash>.<writer>.<rev>.json'] },
  { id: 'agents-hold', what: 'An update holds AGENTS.md while a file it points to lacks a section it cites (PF.contract.hold)', from: '2.16.0', has: holdsAgents, writes: ['.flightdeck/updates/<version>/AGENTS.md (held) and .flightdeck/updates/<version>/README.md, by flightdeck install and the app\'s update'] },
  // Readers that refuse what they don't know
  { id: 'publication-format', what: 'A publication in another format is unusable (P.verify)', from: '1.11.1', has: refusesNewerPublication, writes: [] },
  { id: 'run-format', what: 'A preflight-run/3 is kept by name only (R.newerFormat)', from: '1.11.1', has: namesNewerRun, writes: [] },
  { id: 'run-known', what: 'A run/2 with an unknown field opens read-only (R.newer, KNOWN)', from: '1.11.1', has: readOnlyOnUnknownField, writes: [] },
  { id: 'jira-search-refused', what: 'A publication with a Jira search step is set aside as needing 2.16', from: '1.21.0', until: '2.14.0', plan: 'the 2.16 plan says 2.0 to 2.14; the 1.21 bridge refuses it the same way', has: refuses16('jira'), writes: [] },
  { id: 'detail-patterns-refused', what: 'A publication with a pattern run detail is set aside as needing 2.16', from: '1.21.0', until: '2.14.0', has: refuses16('pattern'), writes: [] }
];

/* Whether a release (by version, like "1.15.0") has a row, by the matrix. */
function expects(id, version) {
  const r = ROWS.find(x => x.id === id);
  if (!r) throw new Error('No capability ' + id);
  return cmp(version, r.from) >= 0 && (!r.until || cmp(version, r.until) <= 0);
}
module.exports = { ROWS, expects };
