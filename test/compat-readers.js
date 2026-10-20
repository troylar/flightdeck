// Every path family in a team folder, from the 2.0 plan's reader table (docs/design.md section 28), with who writes it and
// which reader each release uses for it. test/compat.test.js checks it against every release's own code: each path any
// release writes, lists or reads must belong to exactly one family, and each family's readers must be what the code does.
//   loadAll: the first release whose repo.loadAll reads files of this family (null: loadAll never reads them).
//   onDemand: readers outside loadAll, each [function, first release that has it], or [function, from, until].
//   writer: the capability (test/compat-matrix.js) that writes it, 'hand' for files people and AI assistants write, or
//     'none' for families no release here writes yet.
//   plan: set when the plan's reader table doesn't list the family.
'use strict';

const FAMILIES = [
  { id: 'people', re: /^people\.json$/, writer: 'people', loadAll: '1.10.0', onDemand: [] },
  { id: 'drafts', re: /^maps\/drafts\/[^/]+\.md$/, writer: 'drafts', loadAll: '1.10.0', onDemand: [] },
  { id: 'publication', re: /^publications\/[^/]+\/[^/]+\/(publication\.json|map\.md|types\.json)$/, writer: 'publish', loadAll: '1.10.0', onDemand: [] },
  { id: 'publication-images', re: /^publications\/[^/]+\/[^/]+\/images\/.+$/, writer: 'publish', loadAll: null, onDemand: [['repo.publish', '1.10.0']] },
  { id: 'run', re: /^runs\/[^/]+\/[^/]+\/run\.json$/, writer: 'runs', loadAll: '1.10.0', onDemand: [['repo.loadRun', '1.10.0']] },
  { id: 'run-copies', re: /^runs\/[^/]+\/[^/]+\/(run\.conflict-[^/]+|run-[^/]+|replaced-[^/]+|candidate-[^/]+)\.json$/, writer: 'runs', loadAll: null, onDemand: [['repo.readCopy', '1.10.0']] },
  { id: 'notes', re: /^runs\/[^/]+\/[^/]+\/notes-[^/]+\.jsonl$/, writer: 'notes', loadAll: '1.10.0', onDemand: [] },
  { id: 'run-archives', re: /^runs\/[^/]+\/[^/]+\/history-[^/]+\.jsonl$/, writer: 'runs', loadAll: null, onDemand: [['repo.loadHistory', '1.10.0']] },
  { id: 'attachments', re: /^runs\/[^/]+\/[^/]+\/files\/[^/]+$/, writer: 'notes', loadAll: null, onDemand: [['repo.saveAttachment', '1.10.0']] },
  { id: 'legacy-runs', re: /^runs\/[^/]+\.json$/, writer: 'none', loadAll: '1.10.0', onDemand: [] },
  { id: 'plan-statuses', re: /^proposals\/[^/]+\.status-[^/]+\.json$/, writer: 'plan-status', loadAll: '1.10.0', onDemand: [] },
  { id: 'plans', re: /^proposals\/(?![^/]*\.status-)[^/]+\.json$/, writer: 'plans', loadAll: '1.10.0', onDemand: [] },
  { id: 'validations', re: /^validations\/[^/]+\.json$/, writer: 'sign-offs', loadAll: '1.10.0', onDemand: [] },
  { id: 'skills', re: /^skills\/[^/]+\.json$/, writer: 'hand', loadAll: '1.10.0', onDemand: [] },
  { id: 'step-types', re: /^step-types\/[^/]+\.json$/, writer: 'step-types', loadAll: '1.10.0', onDemand: [] },
  { id: 'jira', re: /^jira\/workflows\.json$/, writer: 'hand', loadAll: '1.10.0', onDemand: [] },
  { id: 'corrections', re: /^corrections\/[^/]+\/[^/]+\.json$/, writer: 'corrections', loadAll: '1.13.0', onDemand: [] },
  { id: 'suggestions', re: /^suggestions\/[^/]+\/[^/]+\.json$/, writer: 'fixes', loadAll: '1.11.0', onDemand: [] },
  { id: 'followups', re: /^followups\/[^/]+\/[^/]+\.json$/, writer: 'followups', loadAll: '1.16.0', onDemand: [] },
  { id: 'proposed', re: /^proposed\/[^/]+\/[^/]+\.json$/, writer: 'proposals', loadAll: '1.19.0', onDemand: [] },
  { id: 'presence', re: /^presence\/[^/]+\.json$/, writer: 'proposals', loadAll: '1.19.0', onDemand: [] },
  { id: 'connection', re: /^connection\/[^/]+\.json$/, writer: 'connection', loadAll: null, onDemand: [['repo.loadConnection', '1.15.0']] },
  { id: 'editor-history', re: /^history\/(drafts|step-types)\/[^/]+\/[^/]+\.jsonl$/, writer: 'saved-history', loadAll: null, onDemand: [['repo.loadEditHistory', '1.16.0']] },
  { id: 'installed', re: /^\.flightdeck\/installed\.json$/, writer: 'none', loadAll: null, onDemand: [['repo.scan', '1.15.0']] },
  { id: 'contract', re: /^(AGENTS\.md|\.flightdeck\/skills\/.+)$/, writer: 'hand', loadAll: null, onDemand: [['repo.scan', '1.15.0']] },
  { id: 'write-test', re: /^\.flightdeck\/write-test-[^/]+\.tmp$/, writer: 'people', loadAll: null, onDemand: [['repo.scan', '1.15.0']], plan: 'not in the plan\'s reader table (setup\'s write test, removed right away)' },
  { id: 'images', re: /^images\/.+$/, writer: 'hand', loadAll: null, onDemand: [['repo.publish', '1.10.0']], plan: 'not in the plan\'s reader table (draft screenshots, read when publishing)' },
  { id: 'app-copy', re: /^(flightdeck|preflight)\.html$/, writer: 'hand', loadAll: null, onDemand: [], plan: 'not in the plan\'s reader table (the newer-copy check in app.js reads its head)' },
  { id: 'staged', re: /^staged\/.+$/, writer: 'none', loadAll: null, onDemand: [] },
  { id: 'extensions', re: /^extensions\/.+$/, writer: 'none', loadAll: null, onDemand: [] },
  { id: 'skill-registrations', re: /^skill-registrations\/.+$/, writer: 'none', loadAll: null, onDemand: [] },
  { id: 'reports', re: /^(reports|report-decisions)\/.+$/, writer: 'none', loadAll: null, onDemand: [] }
];

/* The family a path belongs to; throws when it fits none or more than one. */
function familyOf(p) {
  const hits = FAMILIES.filter(f => f.re.test(p));
  if (hits.length !== 1) throw new Error(p + (hits.length ? ' fits more than one family: ' + hits.map(f => f.id).join(', ') : ' fits no family in test/compat-readers.js'));
  return hits[0];
}
/* The top-level folder a family lives in ('' for files at the top). */
function topOf(f) { const m = /^\^\(?([a-z.-]+)\\\//i.exec(f.re.source.replace(/\\\./g, '.')); return m ? m[1] : ''; }
/* A folder a release lists must be one a family lives in. */
function dirKnown(dir) { return dir === '' || FAMILIES.some(f => topOf(f) === dir.split('/')[0] || f.re.test(dir + '/x.json') || f.re.test(dir + '/x/y.json')); }

/* One file of every family (path → text), for the probes: each is read or ignored as that release does. */
const PROBES = {
  'runs/backup/run-a/run.conflict-w-blake-1.json': '{}', 'runs/backup/run-a/run-LAPTOP.json': '{}', 'runs/backup/run-a/replaced-w-avery-1.json': '{}',
  'runs/backup/run-a/history-w-avery.jsonl': '{"kind":"log","at":"2026-03-02T09:00:00.000Z","by":"person-avery","what":"Archived"}\n',
  'runs/backup/run-a/files/1-abcdef-w-blake.txt': 'attached', 'runs/old.json': '{"format":"preflight-run/1"}',
  'suggestions/backup/f-9.w-avery.json': '{}', 'connection/probe-w-avery-1.json': '{}', '.flightdeck/installed.json': '{"format":"flightdeck-installed/1"}',
  'AGENTS.md': 'Instructions', '.flightdeck/skills/flightdeck-status/SKILL.md': 'A skill', '.flightdeck/write-test-w-avery.tmp': 'x',
  'staged/backup/stage-aaaa1111/publication.json': '{}', 'extensions/acme/extension.json': '{}', 'skill-registrations/backup-report/a.1.w-avery.json': '{}',
  'reports/r-1.json': '{}', 'report-decisions/r-1.w-avery.1.json': '{}', 'images/restore.png': 'x', 'flightdeck.html': '<!doctype html>',
  'history/step-types/team.restore/w-avery.jsonl': '{}\n', 'jira/workflows.json': '{"workflows":{}}', 'publications/backup/v1-ab9ysnqh/images/restore.png': 'x'
};

module.exports = { FAMILIES, familyOf, dirKnown, PROBES };
