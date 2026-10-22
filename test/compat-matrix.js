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

/* A /2 publication record, otherwise valid for its files, using a feature no released copy builds yet (staged versions): is
   it set aside as unusable? (For 1.x any /2 is newer; for 2.x the feature is, and the same record without it must be usable
   there, so the refusal can't come from a malformed record.) */
function refusesNewerPublication(PF) {
  const map = '---\nprocess: p\ntitle: P\n---\n\n## One {#one}\n- [ ] {confirm} A {#a}\n', types = '{}';
  const base = { process: 'p', title: 'P', version: 1, folder: 'v1-aaaa' };
  const check = (features) => PF.publish.verify('v1-aaaa', { 'publication.json': JSON.stringify(H.pub2(PF, base, map, types, features, features.length ? '2.1.0' : '2.0.0')), 'map.md': map, 'types.json': types }, H.exact2(map, types));
  const v = check(['staged']);
  return !v.ok && !!v.unusable && (!twoX(PF) || check([]).ok);
}
/* A preflight-run/3 file, otherwise one a 2.x copy wrote, with a feature no released copy builds yet (test runs): kept by name
   only, and never writable? (On 2.x, the same file without it must read in full.) */
function namesNewerRun(PF) {
  if (!fn(PF.run, 'create')) return false;
  const md = '---\nprocess: p\ntitle: P\n---\n\n## One {#one}\n- [ ] {confirm} A {#a}\n';
  const pub = { info: { format: PF.publish.FORMAT, version: 1, folder: 'v1-aaaa', mapHash: PF.util.hash(md), typesHash: PF.util.hash('{}') }, map: PF.map.parse(md), md, types: {} };
  let text; try { text = JSON.stringify(PF.run.create(pub, { by: 'person-avery', session: 's1', now: '2026-01-01T00:00:00.000Z', id: 'r1' })); } catch (e) { return false; }
  const r = PF.run.sanitize(JSON.parse(H.run3(text, ['test-run'], '2.1.0', PF.util.hash('{}'))));
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

const ROWS = [
  // Writers
  { id: 'drafts', what: 'Drafts (repo.saveDraft)', from: '1.10.0', has: repoHas('saveDraft'), writes: ['maps/drafts/<process>.md'] },
  { id: 'publish', what: 'Publish (repo.publish)', from: '1.10.0', has: repoHas('publish'), writes: ['publications/<process>/<folder>/'] },
  { id: 'runs', what: 'Runs (repo.saveRun)', from: '1.10.0', has: repoHas('saveRun'), writes: ['runs/<process>/<id>/run.json', 'candidate-*.json', 'run.conflict-*.json', 'replaced-*.json', 'history-*.jsonl'] },
  { id: 'notes', what: 'Notes (repo.addNote)', from: '1.10.0', has: repoHas('addNote'), writes: ['runs/<process>/<id>/notes-<writer>.jsonl'] },
  { id: 'step-types', what: 'Step types (repo.saveStepType)', from: '1.10.0', has: repoHas('saveStepType'), writes: ['step-types/<id>.json'] },
  { id: 'sign-offs', what: 'Sign-offs (repo.recordValidation)', from: '1.10.0', has: repoHas('recordValidation'), writes: ['validations/<process>.v<N>.<writer>.json'] },
  { id: 'plan-status', what: 'Plan decisions (repo.recordPlanStatus)', from: '1.10.0', has: repoHas('recordPlanStatus'), writes: ['proposals/<plan>.status-<writer>.json'] },
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
  // Readers that refuse what they don't know
  { id: 'publication-format', what: 'A publication in another format is unusable (P.verify)', from: '1.11.1', has: refusesNewerPublication, writes: [] },
  { id: 'run-format', what: 'A preflight-run/3 is kept by name only (R.newerFormat)', from: '1.11.1', has: namesNewerRun, writes: [] },
  { id: 'run-known', what: 'A run/2 with an unknown field opens read-only (R.newer, KNOWN)', from: '1.11.1', has: readOnlyOnUnknownField, writes: [] }
];

/* Whether a release (by version, like "1.15.0") has a row, by the matrix. */
function expects(id, version) {
  const r = ROWS.find(x => x.id === id);
  if (!r) throw new Error('No capability ' + id);
  return cmp(version, r.from) >= 0 && (!r.until || cmp(version, r.until) <= 0);
}
module.exports = { ROWS, expects };
