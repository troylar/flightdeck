// Every path family in a team folder, from the 2.0 plan's reader table (docs/design.md section 28), with who writes it and
// which reader each release uses for it. Nothing here is taken on trust: test/compat.test.js runs each reader in every
// release whose range includes it, on a valid specimen of the family that the scenario's writers (or prepare() below) put in
// the folder, records the paths the call actually reads, and requires the specimen to be read and to show in the reader's
// output; then it damages the specimen and requires the output to change. Outside a reader's range, a loadAll reader must
// not read the specimen and a named function must not exist. Each path any release writes, lists or reads must belong to
// exactly one family.
//   readers: [{ via: 'loadAll' or a function like 'repo.loadHistory', from, until?, spec: the specimen path (from the folder's
//     files, or a function of them), before(PF, fs): set-up not recorded, call(PF, fs, ctx): the reader, found(out): whether
//     the specimen shows in its output, listOnly: the reader lists the specimen's folder and never reads the file }]
//   writer: the capability (test/compat-matrix.js) that writes it, 'hand' for files people and AI assistants write, or
//     'none' for families no release here writes yet.
//   note: what isn't probed here, said plainly.
'use strict';
const path = require('path'), fsN = require('fs');

const runOf = (d, id) => (d.runs || []).find(r => r.id === id);
const loadAll = (PF, fs) => PF.repo.loadAll(fs, { deep: true });
const L = (from, found, spec, extra) => Object.assign({ via: 'loadAll', from, spec, call: loadAll, found }, extra || {});
const pubFolder = (files) => Object.keys(files).find(p => /^publications\/backup\/[^/]+\/publication\.json$/.test(p)).split('/')[2];

/* The scenario's folders hold the families their writers make; these add a valid specimen of the rest. */
const LEGACY = JSON.stringify({ format: 'preflight-run/1', name: 'Old backup check', started: '2025-01-06T09:00:00.000Z', ended: '2025-01-06T10:00:00.000Z' }, null, 2);
const FIX_DECISION = JSON.stringify({ kind: 'fix-decision', process: 'backup', suggestion: 'f-1', status: 'accepted', reason: '', by: 'person-avery', at: '2026-03-02T09:15:00.000Z', rev: 1, seen: null, latestVersion: 1 }, null, 2);
const ARCHIVE = JSON.stringify({ id: 'arch-1', kind: 'answer', step: 'read', s: 'done', by: 'person-avery', at: '2026-03-02T09:03:00.000Z' }) + '\n';
const INSTALLED = JSON.stringify({ format: 'flightdeck-installed/1', version: '1.18.0', files: {} }, null, 2);
const AGENTS = '# Team instructions\n\nSpecimen for the reader inventory.\n';
const PLAN = { kind: 'plan', id: 'plan-backup-april', process: 'backup', version: 1, title: 'Backup check April', details: { ticket: 'ABC-102' }, roles: { lead: 'person-avery', checker: 'person-casey' }, note: 'Casey checks this time.', by: 'AI assistant', created: '2026-03-02T09:13:00.000Z' };
const CONN_AT = Date.parse('2026-03-02T10:00:00.000Z');
const REPORT_PATH = 'reports/backup/run-a.read.spec-tool.spec0001.json';
async function prepare(PF, fs, version, files) {
  const put = (p, t) => fs.write(p, t);
  await put('jira/workflows.json', fsN.readFileSync(path.join(__dirname, '..', 'example-folder', 'jira', 'workflows.json'), 'utf8'));
  await put('runs/legacy-check.json', LEGACY);
  const run = files['runs/backup/run-a/run.json'], copy = JSON.parse(run); copy.title = 'Backup check March (their copy)';
  await put('runs/backup/run-a/run.conflict-w-blake-1.json', JSON.stringify(copy, null, 2));
  await put('runs/backup/run-a/history-w-avery.jsonl', ARCHIVE);
  if (!Object.keys(files).some(p => /^suggestions\//.test(p))) await put('suggestions/backup/f-1.w-avery.json', FIX_DECISION);
  // Before savePlan (1.11.0), plans were written by hand or by an AI assistant; the decision on one by the release itself.
  if (!files['proposals/plan-backup-april.json']) {
    await put('proposals/plan-backup-april.json', JSON.stringify(PLAN, null, 2) + '\n');
    const plan = (await PF.repo.loadAll(fs)).plans.find(p => p.id === PLAN.id);
    await PF.repo.recordPlanStatus(fs, plan, 'w-avery', 'declined', null, 'person-avery');
  }
  await put('.flightdeck/installed.json', INSTALLED);
  await put('AGENTS.md', AGENTS);
  await put('.flightdeck/write-test-w-avery.tmp', 'x');
  await put('.flightdeck/updates/AGENTS.md', AGENTS + 'An update to merge.\n');
  // From 2.0: an exact skill registration (skill-registrations/), written only by flightdeck skill register.
  if (PF.skills && PF.skills.checkV2) {
    const f = pubFolder(files), info = JSON.parse(files['publications/backup/' + f + '/publication.json']);
    await put('skill-registrations/restore-report/sk-bbbb2222.1.w-avery.json', JSON.stringify({ format: 'flightdeck-skill/2', app: version, id: 'sk-bbbb2222', rev: 1, seen: null, name: 'restore-report', version: '1.0.0', location: 'https://example.com/skills/restore-report',
      implements: { process: 'backup', folder: f, mapHash: info.mapHash, typesHash: info.typesHash }, by: 'person-avery', updated: '2026-03-02T09:20:00.000Z' }, null, 2) + '\n');
  }
  // From 2.1: a stage (staged/), written by the app's Stage the draft for testing.
  if (PF.repo.stage) {
    const existing = (await PF.repo.loadAll(fs)).processes[0].index.all.map(p => p.info);
    const res = await PF.repo.stage(fs, require('../tools/old-folders').CHECKLIST, Object.assign(publishOpts(PF, existing), { rand: 'aaaa1111', app: version }));
    if (!res || res.blockers) throw new Error('specimen stage: ' + JSON.stringify(res));
  }
  // From 2.0: a report from another app on run-a, and the recorder's decision on it.
  if (PF.reports && PF.repo.decideReport) {
    const text = JSON.stringify({ format: 'flightdeck-report/1', run: 'backup/run-a', publication: { folder: pubFolder(files) }, step: 'read', verdict: 'pass', producer: { name: 'spec-tool', version: '1.0.0' }, created: '2026-03-02T09:21:00.000Z', id: 'spec0001' }, null, 2) + '\n';
    await put(REPORT_PATH, text);
    const g = (await PF.repo.loadRunReports(fs, 'backup', 'run-a')).list.find(x => x.id === 'spec0001');
    await PF.repo.decideReport(fs, PF.reports.decision(g, g.sha256, 'declined', 'person-avery', '2026-03-02T09:22:00.000Z', null, { reason: 'Specimen' }), 'w-avery');
  }
  if (PF.connection && PF.repo.sendProbe) await PF.repo.sendProbe(fs, { id: 'k3m9p2q8', n: 1, by: 'person-avery', writer: 'w-avery', device: 'Laptop', at: new Date(CONN_AT).toISOString(), app: version }, CONN_AT);
}

const FAMILIES = [
  { id: 'people', re: /^people\.json$/, writer: 'people', readers: [L('1.10.0', d => d.people.some(p => p.id === 'person-blake'), 'people.json')] },
  { id: 'drafts', re: /^maps\/drafts\/[^/]+\.md$/, writer: 'drafts', readers: [L('1.10.0', d => d.drafts.some(x => /process: backup/.test(x.md || x.text || '')), 'maps/drafts/backup.md')] },
  { id: 'publication', re: /^publications\/[^/]+\/[^/]+\/(publication\.json|map\.md|types\.json)$/, writer: 'publish',
    readers: [L('1.10.0', d => !!(d.processes[0] && d.processes[0].index.latest), f => 'publications/backup/' + pubFolder(f) + '/publication.json')] },
  { id: 'publication-images', re: /^publications\/[^/]+\/[^/]+\/images\/.+$/, writer: 'publish',
    readers: [L('1.10.0', d => !!(d.processes[0] && d.processes[0].index.latest && d.processes[0].index.latest.info.images['images/restore.png']), f => 'publications/backup/' + pubFolder(f) + '/images/restore.png')] },
  { id: 'run', re: /^runs\/[^/]+\/[^/]+\/run\.json$/, writer: 'runs', readers: [L('1.10.0', d => !!runOf(d, 'run-a') && !runOf(d, 'run-a')._unrunnable, 'runs/backup/run-a/run.json')] },
  { id: 'run-copies', re: /^runs\/[^/]+\/[^/]+\/(run\.conflict-[^/]+|run-[^/]+|replaced-[^/]+|candidate-[^/]+)\.json$/, writer: 'runs',
    readers: [{ via: 'repo.readCopy', from: '1.10.0', spec: 'runs/backup/run-a/run.conflict-w-blake-1.json', before: async (PF, fs) => runOf(await loadAll(PF, fs), 'run-a'),
      call: (PF, fs, run) => PF.repo.readCopy(fs, run, 'run.conflict-w-blake-1.json'), found: c => !!c && c.title === 'Backup check March (their copy)' }] },
  { id: 'notes', re: /^runs\/[^/]+\/[^/]+\/notes-[^/]+\.jsonl$/, writer: 'notes', readers: [L('1.10.0', d => runOf(d, 'run-a')._notes.some(n => n.id === 'n-1'), 'runs/backup/run-a/notes-w-blake.jsonl')] },
  { id: 'run-archives', re: /^runs\/[^/]+\/[^/]+\/history-[^/]+\.jsonl$/, writer: 'runs',
    readers: [{ via: 'repo.loadHistory', from: '1.10.0', spec: 'runs/backup/run-a/history-w-avery.jsonl', before: async (PF, fs) => runOf(await loadAll(PF, fs), 'run-a'),
      call: (PF, fs, run) => PF.repo.loadHistory(fs, run), found: h => h.some(x => x.id === 'arch-1' && x.step === 'read') }] },
  { id: 'attachments', re: /^runs\/[^/]+\/[^/]+\/files\/[^/]+$/, writer: 'notes', readers: [], note: 'read by each release\'s screens (thumbnails and the viewer) and, from 1.17, the evidence collector; not probed here' },
  { id: 'legacy-runs', re: /^runs\/[^/]+\.json$/, writer: 'none', readers: [L('1.10.0', d => (d.legacy || []).some(x => x.name === 'Old backup check'), 'runs/legacy-check.json')] },
  { id: 'plan-statuses', re: /^proposals\/[^/]+\.status-[^/]+\.json$/, writer: 'plan-status',
    // From 2.1.1 a decline is written to <plan>.status-<window>-d.json.
    readers: [L('1.10.0', d => d.plans.some(p => p._status && p._status.status === 'declined'), f => ['proposals/plan-backup-april.status-w-avery.json', 'proposals/plan-backup-april.status-w-avery-d.json'].find(p => p in f))] },
  { id: 'plans', note: 'before savePlan (1.11.0) plans were written by hand or by an AI assistant', re: /^proposals\/(?![^/]*\.status-)[^/]+\.json$/, writer: 'plans', readers: [L('1.10.0', d => d.plans.some(p => p.id === 'plan-backup-april'), 'proposals/plan-backup-april.json')] },
  { id: 'validations', re: /^validations\/[^/]+\.json$/, writer: 'sign-offs', readers: [L('1.10.0', d => d.validations.some(v => v.by === 'person-avery'), 'validations/backup.v1.w-avery.json')] },
  { id: 'skills', re: /^skills\/[^/]+\.json$/, writer: 'hand', readers: [L('1.10.0', d => d.skills.some(s => s.skill && s.skill.name === 'backup-report' && s.skill.implements === 1 && !(s.errors || []).length), 'skills/backup-report.json')] },
  { id: 'step-types', re: /^step-types\/[^/]+\.json$/, writer: 'step-types', readers: [L('1.10.0', d => !!d.stepTypes.types['team.restore'], 'step-types/team.restore.json')] },
  { id: 'jira', re: /^jira\/workflows\.json$/, writer: 'hand', readers: [L('1.10.0', d => !!(d.jira && d.jira.workflows && Object.keys(d.jira.workflows).length && Object.keys(d.jira.workflows).every(k => !d.jira.workflows[k].invalid)), 'jira/workflows.json')] },
  { id: 'corrections', re: /^corrections\/[^/]+\/[^/]+\.json$/, writer: 'corrections',
    readers: [L('1.13.0', d => d.corrDecisions.some(x => x.kind === 'correction-decision'), f => Object.keys(f).find(p => /^corrections\//.test(p)))] },
  { id: 'suggestions', re: /^suggestions\/[^/]+\/[^/]+\.json$/, writer: 'fixes',
    readers: [L('1.11.0', d => (d.corrDecisions || d.fixDecisions || []).some(x => x.suggestion === 'f-1'), 'suggestions/backup/f-1.w-avery.json')] },
  { id: 'followups', re: /^followups\/[^/]+\/[^/]+\.json$/, writer: 'followups',
    readers: [L('1.16.0', d => d.fuDecisions.some(x => x.status === 'ticket'), f => Object.keys(f).find(p => /^followups\//.test(p)))] },
  { id: 'proposed', re: /^proposed\/[^/]+\/[^/]+\.json$/, writer: 'proposals',
    readers: [L('1.19.0', d => { const b = d.proposed.procs.backup; return !!b && !b.bad.length && JSON.stringify(b.all).indexOf('p-mh4k2a-x7w1k3m9p2') >= 0; }, 'proposed/backup/p-mh4k2a-x7w1k3m9p2.json')] },
  { id: 'presence', re: /^presence\/[^/]+\.json$/, writer: 'proposals', readers: [L('1.19.0', d => (d.presence || []).some(p => p.writer === 'w-avery' && !!p.rec), 'presence/w-avery.json')] },
  { id: 'connection', re: /^connection\/[^/]+\.json$/, writer: 'connection',
    readers: [{ via: 'repo.loadConnection', from: '1.15.0', spec: f => Object.keys(f).find(p => /^connection\/probe-/.test(p)), call: (PF, fs) => PF.repo.loadConnection(fs, CONN_AT + 1000), found: c => c.probes.some(p => p.id === 'k3m9p2q8') }] },
  { id: 'editor-history', re: /^history\/(drafts|step-types)\/[^/]+\/[^/]+\.jsonl$/, writer: 'saved-history',
    readers: [{ via: 'repo.loadEditHistory', from: '1.16.0', spec: 'history/drafts/backup/w-avery.jsonl', call: (PF, fs) => PF.repo.loadEditHistory(fs, 'history/drafts/backup', null), found: h => !h.bad && h.items.some(x => x.entry && x.entry.id === 'h-1') }] },
  { id: 'installed', re: /^\.flightdeck\/installed\.json$/, writer: 'none',
    readers: [{ via: 'repo.scan', from: '1.15.0', spec: '.flightdeck/installed.json', call: (PF, fs) => PF.repo.scan(fs), found: s => !!s.installed && s.installed.format === 'flightdeck-installed/1' }], note: 'written by flightdeck install (the command), not the app' },
  { id: 'contract', re: /^(AGENTS\.md|\.flightdeck\/skills\/.+)$/, writer: 'hand',
    readers: [{ via: 'repo.scan', from: '1.15.0', spec: 'AGENTS.md', call: (PF, fs) => PF.repo.scan(fs), found: s => s.contractTexts && s.contractTexts['AGENTS.md'] === AGENTS }] },
  { id: 'install-updates', re: /^\.flightdeck\/updates\/.+$/, writer: 'none', plan: 'not in the plan\'s reader table',
    readers: [{ via: 'repo.scan', from: '1.15.0', spec: '.flightdeck/updates/AGENTS.md', listOnly: true, call: (PF, fs) => PF.repo.scan(fs), found: s => (s.updates || []).indexOf('.flightdeck/updates/AGENTS.md') >= 0 }], note: 'written by flightdeck install when a team changed a default file' },
  { id: 'write-test', re: /^\.flightdeck\/write-test-[^/]+\.tmp$/, writer: 'people', plan: 'not in the plan\'s reader table',
    readers: [{ via: 'repo.scan', from: '1.15.0', spec: '.flightdeck/write-test-w-avery.tmp', listOnly: true, call: (PF, fs) => PF.repo.scan(fs), found: s => s.list.some(f => f.p === '.flightdeck/write-test-w-avery.tmp') }], note: 'setup\'s write test, removed right away; Folder health lists a leftover' },
  { id: 'images', re: /^images\/.+$/, writer: 'hand', plan: 'not in the plan\'s reader table',
    readers: [{ via: 'repo.publish', from: '1.10.0', spec: 'images/restore.png', before: async (PF, fs) => (await loadAll(PF, fs)).processes[0].index.all.map(p => p.info),
      call: (PF, fs, existing) => PF.repo.publish(fs, require('../tools/old-folders').CHECKLIST, publishOpts(PF, existing)), found: (res, all) => !res.blockers && JSON.parse(res.files['publication.json']).images['images/restore.png'] === JSON.parse(all['publications/backup/' + pubFolder(all) + '/publication.json']).images['images/restore.png'] }] },
  { id: 'app-copy', re: /^(flightdeck|preflight)\.html$/, writer: 'hand', plan: 'not in the plan\'s reader table', readers: [{ via: 'app', from: '1.10.0' }], note: 'read by each release\'s app.js (the newer-copy check reads the head of the file, in a real folder only); test/compat.test.js checks it in each release\'s own page' },
  { id: 'staged', re: /^staged\/.+$/, writer: 'none', note: 'stages and their decisions (2.1): no released copy writes them; this version reads them when staged/ is there',
    readers: [L('2.1.0', d => !!d.stages && !!d.stages.procs.backup && d.stages.procs.backup.stages.some(x => x.folder === 'stage-aaaa1111' && x.ok), 'staged/backup/stage-aaaa1111/publication.json')] },
  { id: 'extensions', re: /^extensions\/.+$/, writer: 'none', readers: [] },
  { id: 'skill-registrations', re: /^skill-registrations\/.+$/, writer: 'hand', note: 'written only by flightdeck skill register (the command, 2.0), never by the app',
    readers: [L('2.0.0', d => d.skills.some(s => s.skill && s.skill.regId === 'sk-bbbb2222' && !(s.errors || []).length), 'skill-registrations/restore-report/sk-bbbb2222.1.w-avery.json')] },
  { id: 'reports', re: /^reports\/.+$/, writer: 'hand', note: 'written by other apps (flightdeck report write, 2.0), never by the app; loadAll lists their names, and a run\'s are read when it opens',
    readers: [L('2.0.0', d => d.reports.files.some(f => f.id === 'spec0001'), REPORT_PATH, { listOnly: true }),
      { via: 'repo.loadRunReports', from: '2.0.0', spec: REPORT_PATH, call: (PF, fs) => PF.repo.loadRunReports(fs, 'backup', 'run-a'), found: o => o.list.some(g => g.id === 'spec0001' && !!g.report) }] },
  { id: 'report-decisions', re: /^report-decisions\/.+$/, writer: 'reports',
    readers: [L('2.0.0', d => d.repDecisions.some(x => x.report === 'spec0001'), (files) => Object.keys(files).find(p => /^report-decisions\/backup\/run-a\./.test(p)))] }
];
function publishOpts(PF, existing) {
  const G = require('../tools/old-folders');
  return { people: G.PEOPLE, customTypes: { 'team.restore': PF.types.customType(G.STEP_TYPE) }, workflows: {}, by: 'person-avery', changes: 'Again', existing, now: '2026-03-02T12:00:00.000Z' };
}

/* The family a path belongs to; throws when it fits none or more than one. */
function familyOf(p) {
  const hits = FAMILIES.filter(f => f.re.test(p));
  if (hits.length !== 1) throw new Error(p + (hits.length ? ' fits more than one family: ' + hits.map(f => f.id).join(', ') : ' fits no family in test/compat-readers.js'));
  return hits[0];
}
/* A folder a release lists must be one a family lives in. */
function dirKnown(dir) {
  if (dir === '') return true;
  const names = ['x.json', 'x.md', 'x.jsonl', 'notes-x.jsonl', 'publication.json', 'run.json', 'x.png'], subs = ['', 'x/', 'x/y/'];
  return FAMILIES.some(f => subs.some(sub => names.some(n => f.re.test(dir + '/' + sub + n))));
}

/* One file of every family that has no reader here, for the "never read" checks. */
const UNREAD = {
  'runs/backup/run-a/files/1-abcdef-w-blake.txt': 'attached', 'flightdeck.html': '<!doctype html>',
  'staged/backup/stage-aaaa1111/publication.json': '{}', 'extensions/acme/extension.json': '{}', 'skill-registrations/other-skill/a.1.w-avery.json': '{}',
  'reports/r-1.json': '{}', 'report-decisions/r-1.w-avery.1.json': '{}'
};

module.exports = { FAMILIES, familyOf, dirKnown, prepare, UNREAD };
