// The 2.0 wire contracts, by example (docs/design.md section 28; the 2.0 plan's slice 1b). Frozen in 1.21: later slices
// implement these shapes rather than invent them, and from slice 2 on the real writers' output must equal them.
//   test/fixtures/v2/folder/   one sample of every 2.0 family, at its team-folder path, laid over a baseline folder
//                              (test/fixtures/folders/<tag>/), whose version folder v1-ab9ysnqh and runs they refer to
//   test/fixtures/v2/people.json   people.json in its format envelope (format 1: no 2.0 change)
//   test/fixtures/v2/probes/major/, probes/feature/   for every family: one file in a major nobody knows yet, one with a
//                              feature nobody knows yet; every real reader must refuse and name each one
//   node tools/v2-samples.js            check the committed files against what this writes
//   node tools/v2-samples.js --write    write them (only when a contract changes on purpose)
'use strict';
const path = require('path'), fs = require('fs');

const DIR = path.join(__dirname, '..', 'test', 'fixtures', 'v2');
const PUB1 = 'v1-ab9ysnqh', PUB2 = 'v2-zzzz2222', STAGE = 'stage-aaaa1111', AT = '2026-10-20T09:00:00.000Z', APP = '2.0.0';
const j = (o) => JSON.stringify(o, null, 2) + '\n';

/* FNV-1a over UTF-16 code units, as PF.util.hash: the fingerprints publication.json and run.json carry. */
/* A decision file's name carries 128 bits of SHA-256 of its report's identity (PF.reports.decisionHash). */
function decisionHash(s) { return require('crypto').createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 32); }
function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
const sha = (s) => require('crypto').createHash('sha256').update(s, 'utf8').digest('hex');
/* SHA-256 of a file's exact bytes: a screenshot's are the PNG bytes on disk, never the data: URL the tree keeps them as. */
const shaBytes = (dataUrl) => require('crypto').createHash('sha256').update(Buffer.from(dataUrl.split(',')[1], 'base64')).digest('hex');

/* A checklist in 2.0 syntax: typed run details, a phase note and screenshot, a gate screenshot, a pinned child and skill. */
const MAP2 = [
  '---', 'process: backup', 'title: Backup check', 'category: Operations', 'owner: person-avery', 'context: ticket, rows:number, due:date, approved:yes-no', 'roles: lead, checker', '---', '',
  '## Prepare {#prep}',
  '  > Use the scratch server, never production.',
  '  ![The scratch server](images/scratch.png)',
  '- [!] {confirm} Read the restore runbook @lead {#read}',
  '- [ ] {team.count} Count the restored rows ^rows @checker {#count}',
  '- [ ] {run.process} Verify the copy {#verify}',
  '  process: verify',
  '  version: 4',
  '- [ ] {run.skill} Write the report {#report}',
  '  skill: release-notes',
  '  skillVersion: 1.2.0', '',
  '## Gate: Restored {#restored}',
  '  > The restored copy opens and its row counts match.',
  '  ![Row counts side by side](images/counts.png)', '',
  '## Close {#close}',
  '- [ ] {confirm} File the report @lead {#file}', ''
].join('\n');
const TYPE2 = { format: 'flightdeck-step-type/2', features: ['typed-evidence'], app: APP, id: 'team.count', label: 'Count rows', icon: 'doc', hint: 'Counts the rows in a restored copy.',
  fields: { system: { label: 'System', kind: 'text' } }, record: [{ name: 'rows', label: 'Rows', kind: 'number', min: '0' }, { name: 'matches', label: 'Matches the source', kind: 'yes-no' }] };
const TYPES2 = { confirm: { id: 'confirm', label: 'Confirm', icon: 'check', hint: 'Check that something is true.', fields: { where: { label: 'Where to check', kind: 'text' }, looks: { label: 'True when', kind: 'text' } }, record: [], version: 2 },
  'team.count': { id: 'team.count', label: 'Count rows', icon: 'doc', hint: 'Counts the rows in a restored copy.', fields: { system: { label: 'System', kind: 'text' } }, record: [{ name: 'rows', label: 'Rows', kind: 'number', min: '0' }, { name: 'matches', label: 'Matches the source', kind: 'yes-no' }], version: 3 } };
const TYPES2_TEXT = JSON.stringify(TYPES2, null, 2);
/* v1 as every release's baseline folder publishes it (test/fixtures/folders/<tag>/publications/backup/v1-ab9ysnqh/). */
const V1DIR = path.join(__dirname, '..', 'test', 'fixtures', 'folders', 'v1.18.0', 'publications', 'backup', 'v1-ab9ysnqh');
const V1 = { map: fs.readFileSync(path.join(V1DIR, 'map.md'), 'utf8'), types: fs.readFileSync(path.join(V1DIR, 'types.json'), 'utf8'), info: JSON.parse(fs.readFileSync(path.join(V1DIR, 'publication.json'), 'utf8')) };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
/* The fingerprint publish records for a screenshot: FNV-1a over its bytes, as repo.bytesHash takes it. */
const PNG_HASH = hash(Buffer.from(PNG.split(',')[1], 'base64').toString('latin1'));

/* The frozen payload: everything a version freezes, each by SHA-256 of its exact bytes (pins as canonical JSON). */
const PAYLOAD = { map: sha(MAP2), types: sha(TYPES2_TEXT), images: { 'images/scratch.png': shaBytes(PNG), 'images/counts.png': shaBytes(PNG) }, extensions: {},
  pins: { children: { verify: { process: 'verify', version: 4, folder: 'v4-cccc4444', mapHash: 'aaaa0001', typesHash: 'aaaa0002' } }, skills: { report: { name: 'release-notes', version: '1.2.0' } } } };
function publication(folder, version, extra) {
  return Object.assign({ format: 'preflight-publication/2', features: ['typed-details', 'typed-evidence', 'phase-notes', 'phase-shots', 'gate-shots', 'pinned-children', 'pinned-skills'], app: APP,
    process: 'backup', title: 'Backup check', version, folder, publishedBy: 'person-avery', publishedAt: AT, changes: 'Typed row counts and a pinned check', mapHash: hash(MAP2), typesHash: hash(TYPES2_TEXT),
    images: { 'images/scratch.png': PNG_HASH, 'images/counts.png': PNG_HASH }, payload: PAYLOAD }, extra || {});
}
function run3(id, extra) {
  return Object.assign({ format: 'preflight-run/3', features: ['typed-details', 'typed-evidence', 'pinned-children'], app: APP, id, process: 'backup', version: 2, folder: PUB2, mapHash: hash(MAP2), typesHash: hash(TYPES2_TEXT),
    title: 'Backup check October', category: 'Operations', snapshot: MAP2, types: TYPES2, payload: PAYLOAD,
    details: { ticket: 'ABC-201', rows: '1234.5', due: '2026-10-31', approved: 'yes' }, roles: { lead: 'person-avery', checker: 'person-blake' },
    recorder: { person: 'person-avery', session: 'w-twozero' }, followUps: [], shotsFrozen: true, jira: {}, pauses: [], paused: null, lineage: [], state: 'running',
    created: AT, createdBy: 'person-avery', tz: 'America/New_York',
    pins: { children: { verify: { process: 'verify', version: 4, folder: 'v4-cccc4444', mapHash: 'aaaa0001', typesHash: 'aaaa0002' } } },
    migrations: [{ path: 'details.due', at: AT, from: '10/31/2026', source: 'plan', verdict: 'ambiguous', result: null, resolved: { by: 'person-avery', at: AT, value: '2026-10-31' } }],
    steps: { read: { s: 'done', by: 'person-avery', at: AT }, count: { s: 'done', by: 'person-blake', at: AT, values: { rows: '1234.5', matches: 'yes' } },
      verify: { s: 'open', child: { process: 'verify', id: 'run-v', inputs: { ticket: 'ABC-201' }, folder: 'v4-cccc4444' } },
      report: { s: 'done', by: 'person-avery', at: AT, skill: { id: 'sk-aaaa1111', rev: 1, sha: sha('registration'), snapshot: { name: 'release-notes', version: '1.2.0' } } } },
    gates: {}, fields: {}, log: [{ at: AT, by: 'person-avery', what: 'Started' }], ended: null, rev: 3, savedAt: AT, savedBy: 'w-twozero.k3m9p2q8' }, extra || {});
}
/* What an older copy's Restore writes beside a run/3 (H10): the name-only view of it, as preflight-run/2, with no steps. */
const PLACEHOLDER = { format: 'preflight-run/2', id: 'run-c', process: 'backup', version: 2, folder: PUB2, mapHash: '', title: 'Backup check October', category: '', snapshot: '', types: {},
  details: {}, roles: {}, recorder: { person: 'person-avery', session: null }, followUps: [], shotsFrozen: false, jira: {}, pauses: [], paused: null, lineage: [], state: 'running',
  created: AT, createdBy: 'person-avery', tz: '', steps: {}, gates: {}, fields: {}, log: [], ended: null, rev: 0, savedAt: null, savedBy: '' };

function folder() {
  const f = {};
  const v2 = 'publications/backup/' + PUB2 + '/';
  f[v2 + 'map.md'] = MAP2; f[v2 + 'types.json'] = TYPES2_TEXT; f[v2 + 'publication.json'] = j(publication(PUB2, 2));
  f[v2 + 'images/scratch.png'] = PNG; f[v2 + 'images/counts.png'] = PNG;
  f['runs/backup/run-c/run.json'] = j(run3('run-c'));
  f['runs/backup/run-c/replaced-w-old-1760950000000.json'] = JSON.stringify(PLACEHOLDER, null, 2);
  f['runs/backup/run-c/history-w-twozero.jsonl'] = JSON.stringify({ kind: 'migration', av: 1, path: 'details.due', at: AT, from: '10/31/2026', source: 'plan', verdict: 'ambiguous', result: null, resolved: { by: 'person-avery', at: AT, value: '2026-10-31' } }) + '\n';
  f['runs/backup/run-t/run.json'] = j(run3('run-t', { features: ['typed-details', 'typed-evidence', 'staged', 'test-run'], title: 'Backup check (test)', test: true, stage: { folder: STAGE }, folder: STAGE, version: 3 }));
  /* Explicit 2.0 run on a /1 version (R2-4): run/3 on v1, chosen by a person because a child pin needs it. */
  /* Its checklist, step types and hashes are v1's own (the baseline folder's v1-ab9ysnqh), with no payload: a /1 version has none. */
  /* v1's checklist has no linked step, so this run pins nothing and lists no feature; it's run/3 only because a person chose it. */
  const e = run3('run-e', { features: [], title: 'Backup check (continued)', folder: PUB1, version: 1, snapshot: V1.map, types: JSON.parse(V1.types), mapHash: V1.info.mapHash, typesHash: V1.info.typesHash,
    details: { ticket: 'ABC-202' }, roles: { lead: 'person-avery', checker: 'person-blake' }, migrations: [], steps: { read: { s: 'done', by: 'person-avery', at: AT } } });
  delete e.payload; delete e.pins;
  f['runs/backup/run-e/run.json'] = j(e);
  f['runs/backup/run-a/notes-w-twozero.jsonl'] = JSON.stringify({ id: 'c-9', at: AT, by: 'person-avery', session: 'w-twozero', step: '', text: 'Say which server in the phase note.', files: [], kind: 'correction', cv: 2, version: 1, folder: PUB1, target: { phase: 'prep' }, change: { op: 'wording', to: 'Use the scratch server, never production.' } }) + '\n';
  f['proposals/plan-backup-pinned.json'] = j({ format: 'flightdeck-plan/2', app: APP, id: 'plan-backup-pinned', process: 'backup', pin: { folder: PUB1, version: 1, mapHash: 'c2780532', typesHash: 'c4143e9d' }, title: 'Backup check November', details: { ticket: 'ABC-203' }, roles: { lead: 'person-avery' }, by: 'person-avery', created: AT });
  f['proposals/plan-backup-pinned.status-w-twozero.json'] = j({ format: 'flightdeck-plan-status/2', app: APP, proposal: 'plan-backup-pinned', proposalHash: 'aaaa0003', status: 'retargeted', to: { folder: PUB2, version: 2 }, by: 'person-avery', at: AT });
  f['validations/backup.' + STAGE + '.w-twozero.json'] = j({ format: 'flightdeck-validation/2', app: APP, process: 'backup', stage: { folder: STAGE, proposed: 3 }, payload: sha(j(PAYLOAD)), by: 'person-avery', at: AT, note: 'Two clean test runs', evidence: { completed: 2, clean: 2, runs: ['run-t'] } });
  f['step-types/team.count.json'] = j(TYPE2);
  f['skills/release-notes.json'] = j({ name: 'release-notes', implements: 'moved', movedTo: 'skill-registrations/release-notes/', id: 'sk-aaaa1111' });
  f['skill-registrations/release-notes/sk-aaaa1111.1.w-twozero.json'] = j({ format: 'flightdeck-skill/2', app: APP, id: 'sk-aaaa1111', rev: 1, seen: null, name: 'release-notes', version: '1.2.0', location: 'https://example.com/skills/release-notes',
    implements: { process: 'backup', folder: PUB2, mapHash: hash(MAP2), typesHash: hash(TYPES2_TEXT) }, description: 'Writes the release notes.', by: 'person-avery', updated: AT });
  const st = 'staged/backup/' + STAGE + '/';
  f[st + 'map.md'] = MAP2; f[st + 'types.json'] = TYPES2_TEXT; f[st + 'images/scratch.png'] = PNG; f[st + 'images/counts.png'] = PNG;
  f[st + 'publication.json'] = j(publication(STAGE, null, { features: ['typed-details', 'typed-evidence', 'phase-notes', 'phase-shots', 'gate-shots', 'pinned-children', 'pinned-skills', 'staged'], version: undefined, stage: { proposed: 3 }, stagedBy: 'person-avery', stagedAt: AT }));
  f['staged/backup/decisions/' + STAGE + '.w-twozero.1.json'] = j({ format: 'flightdeck-stage-decision/1', app: APP, process: 'backup', stage: STAGE, status: 'retired', reason: 'Replaced by a new stage', by: 'person-avery', at: AT, rev: 1, seen: null });
  f['extensions/acme/extension.json'] = j({ format: 'flightdeck-extension/1', app: APP, namespace: 'acme', version: '1.0.0', title: 'Acme checks', description: 'Ticket keys and row limits.', by: 'person-avery', updated: AT });
  f['extensions/acme/checks/ticket-key.json'] = j({ format: 'flightdeck-extension/1', check: 'ticket-key', severity: 'block', message: 'Use a ticket key like ABC-123.' });
  /* A report from another app (flightdeck-report/1) and the recorder's decision on it (flightdeck-report-decision/1): the
     decision names the report by its identity's hash and the SHA-256 of its exact bytes. */
  const REPORT = j({ format: 'flightdeck-report/1', app: APP, run: 'backup/run-c', publication: { folder: PUB2, version: 2 }, step: 'count', verdict: 'pass',
    evidence: { rows: '1234.5', matches: 'yes' }, links: [{ label: 'Row count job', url: 'https://ci.example.com/jobs/1432' }],
    inputs: [{ name: 'Rows expected', value: '1234.5', source: 'detail:rows' }, { name: 'Database', value: 'scratch', source: 'external' }, { name: 'Read token', source: 'external', secret: true }],
    producer: { name: 'row-counter', version: '1.4.0' }, created: AT, id: 'k3m9p2q8', summary: 'Counted the restored rows.' });
  f['reports/backup/run-c.count.row-counter.k3m9p2q8.json'] = REPORT;
  f['report-decisions/backup/run-c.' + decisionHash('backup/run-c/count/row-counter/k3m9p2q8') + '.w-twozero.1.json'] = j({ format: 'flightdeck-report-decision/1', app: APP, process: 'backup', run: 'run-c', step: 'count', producer: 'row-counter', report: 'k3m9p2q8',
    sha256: sha(REPORT), status: 'declined', reason: 'Counted the wrong database.', by: 'person-avery', at: AT, rev: 1, seen: null });
  f['presence/w-twozero.json'] = j({ kind: 'presence', pv: 1, app: APP, writer: 'w-twozero', by: 'person-avery', device: 'Laptop', since: AT, at: AT, beat: 1, drafts: [], main: [] });
  /* Checklist drafts: 2.0 syntax, and the three front-matter cases no copy may rely on (review #3). */
  f['maps/drafts/typed.md'] = MAP2.replace('process: backup', 'process: typed');
  const plain = (p, extra) => ['---', 'process: ' + p, 'title: Plain', extra, '---', '', '## One {#one}', '- [ ] {confirm} Look {#look}', ''].join('\n');
  f['maps/drafts/min-only.md'] = plain('min-only', 'format: flightdeck-checklist/2');
  f['maps/drafts/feature-only.md'] = plain('feature-only', 'features: typed-details');
  f['maps/drafts/min-plus-body.md'] = plain('min-plus-body', 'format: flightdeck-checklist/2\nfeatures: phase-notes');
  return f;
}

/* For every family, a file in an unknown major and one with an unknown feature, at a path its readers read. */
function probes() {
  const out = { major: {}, feature: {} }, F = 'flightdeck-9', X = ['from-the-future'];
  const put = (k, p, o) => { out[k][p] = typeof o === 'string' ? o : j(o); };
  const both = (p, base, major) => { put('major', p, Object.assign({}, base, major)); put('feature', p, Object.assign({}, base, { features: X, app: '9.1.0' })); };
  const pub = JSON.parse(j(publication(PUB1, 1))); delete pub.payload;
  both('publications/backup/v3-yyyy3333/publication.json', Object.assign(pub, { folder: 'v3-yyyy3333', version: 3 }), { format: 'preflight-publication/9', features: [], app: '9.0.0' });
  ['major', 'feature'].forEach(k => { const b = 'publications/backup/v3-yyyy3333/'; out[k][b + 'map.md'] = MAP2; out[k][b + 'types.json'] = TYPES2_TEXT; out[k][b + 'images/scratch.png'] = PNG; out[k][b + 'images/counts.png'] = PNG; });
  out.feature['publications/backup/v3-yyyy3333/publication.json'] = j(Object.assign(JSON.parse(out.feature['publications/backup/v3-yyyy3333/publication.json']), { format: 'preflight-publication/1' }));
  const r = run3('run-p'); delete r.payload;
  put('major', 'runs/backup/run-p/run.json', Object.assign({}, r, { format: 'preflight-run/9', features: [], app: '9.0.0' }));
  put('feature', 'runs/backup/run-p/run.json', Object.assign({}, r, { format: 'preflight-run/2', features: X, app: '9.1.0' }));
  out.major['runs/backup/run-a/history-w-probe.jsonl'] = JSON.stringify({ kind: 'migration', av: 9, path: 'details.due', at: AT }) + '\n';
  out.feature['runs/backup/run-a/history-w-probe.jsonl'] = JSON.stringify({ kind: 'answer', step: 'read', s: 'done', by: 'person-avery', at: AT, features: X }) + '\n';
  both('proposals/plan-backup-probe.json', { id: 'plan-backup-probe', process: 'backup', title: 'Probe', by: 'person-avery', created: AT }, { format: 'flightdeck-plan/9' });
  out.feature['proposals/plan-backup-probe.json'] = j({ kind: 'plan', id: 'plan-backup-probe', process: 'backup', version: 1, title: 'Probe', by: 'person-avery', created: AT, features: X });
  both('proposals/plan-backup-april.status-w-probe.json', { proposal: 'plan-backup-april', proposalHash: 'aaaa0004', status: 'declined', run: null, by: 'person-avery', at: AT }, { format: 'flightdeck-plan-status/9' });
  out.feature['proposals/plan-backup-april.status-w-probe.json'] = j({ kind: 'status', proposal: 'plan-backup-april', proposalHash: 'aaaa0004', status: 'declined', run: null, by: 'person-avery', at: AT, features: X });
  both('validations/backup.v1.w-probe.json', { process: 'backup', version: 1, folder: PUB1, by: 'person-avery', at: AT, note: 'Probe' }, { format: 'flightdeck-validation/9' });
  out.feature['validations/backup.v1.w-probe.json'] = j({ kind: 'validation', process: 'backup', version: 1, folder: PUB1, by: 'person-avery', at: AT, note: 'Probe', features: X });
  const fu = { kind: 'followup-decision', process: 'backup', run: 'run-b', followUp: 'probe1', status: 'done', by: 'person-avery', at: AT, rev: 1, seen: null };
  put('major', 'followups/backup/run-b.probe1.w-probe.1.json', Object.assign({}, fu, { fv: 9 }));
  put('feature', 'followups/backup/run-b.probe1.w-probe.1.json', Object.assign({}, fu, { fv: 1, features: X }));
  const cd = { kind: 'correction-decision', process: 'backup', group: 'gprobe00000001', status: 'declined', reason: 'Probe', by: 'person-avery', at: AT, rev: 1, seen: null, members: [] };
  put('major', 'corrections/backup/gprobe00000001.w-probe.1.json', Object.assign({}, cd, { dv: 9 }));
  put('feature', 'corrections/backup/gprobe00000001.w-probe.1.json', Object.assign({}, cd, { dv: 2, features: X }));
  const st = { id: 'team.probe', label: 'Probe', icon: 'doc', hint: 'A probe.', fields: {}, record: [] };
  put('major', 'step-types/team.probe.json', Object.assign({ format: 'flightdeck-step-type/9', app: '9.0.0' }, st));
  put('feature', 'step-types/team.probe.json', Object.assign({ format: 'flightdeck-step-type/1', features: X, app: '9.1.0' }, st));
  const sk = { name: 'probe-skill', version: '1.0.0', location: 'https://example.com/skills/probe', implements: 'backup@1' };
  put('major', 'skills/probe-skill.json', Object.assign({ format: 'flightdeck-skill/9', app: '9.0.0' }, sk));
  put('feature', 'skills/probe-skill.json', Object.assign({ format: 'flightdeck-skill/1', features: X, app: '9.1.0' }, sk));
  const pe = { kind: 'presence', writer: 'w-probe', by: 'person-avery', device: 'Laptop', since: AT, at: AT, beat: 1, drafts: [], main: [] };
  put('major', 'presence/w-probe.json', Object.assign({}, pe, { pv: 9 }));
  put('feature', 'presence/w-probe.json', Object.assign({}, pe, { pv: 1, features: X }));
  /* people.json, .flightdeck/installed.json, a proposal, an editor history line and a connection check. */
  put('major', 'people.json', { format: 'flightdeck-people/9', app: '9.0.0', people: [{ id: 'person-avery', name: 'Avery Lee' }] });
  put('feature', 'people.json', { format: 'flightdeck-people/1', features: X, app: '9.1.0', people: [{ id: 'person-avery', name: 'Avery Lee' }] });
  put('major', '.flightdeck/installed.json', { format: 'flightdeck-installed/9', version: '9.0.0', at: AT, by: 'cli', files: {} });
  put('feature', '.flightdeck/installed.json', { format: 'flightdeck-installed/1', features: X, version: '9.1.0', at: AT, by: 'cli', files: {} });
  const pp = { kind: 'draft-proposal', id: 'p-pr0b3a-x7w1k3m9p9', process: 'backup', session: 's-probe0probe0', label: 'assistant', by: 'person-avery', at: AT, app: '9.0.0' };
  put('major', 'proposed/backup/p-pr0b3a-x7w1k3m9p9.json', Object.assign({}, pp, { pv: 9 }));
  put('feature', 'proposed/backup/p-pr0b3a-x7w1k3m9p9.json', Object.assign({}, pp, { pv: 1, features: X }));
  const he = { kind: 'draft-edit', id: 'h-probe', process: 'backup', writer: 'w-probe', seq: 1, by: 'person-avery', at: AT, from: null, to: 'aaaa0001', source: 'editor' };
  out.major['history/drafts/backup/w-probe.jsonl'] = JSON.stringify(Object.assign({ v: 9 }, he)) + '\n';
  out.feature['history/drafts/backup/w-probe.jsonl'] = JSON.stringify(Object.assign({ v: 1, features: X }, he)) + '\n';
  const cn = { kind: 'connection-probe', id: 'k3m9p2q8', n: 1, by: 'person-avery', writer: 'w-probe', device: 'Laptop', at: AT, app: '9.0.0', run: null, seen: [] };
  put('major', 'connection/probe-20261020T090000Z-k3m9p2q8.w-probe.json', Object.assign({}, cn, { cv: 9 }));
  put('feature', 'connection/probe-20261020T090000Z-k3m9p2q8.w-probe.json', Object.assign({}, cn, { cv: 1, features: X }));
  const rp = { run: 'backup/run-c', publication: { folder: PUB2 }, step: 'count', verdict: 'pass', producer: { name: 'row-counter', version: '1.4.0' }, created: AT, id: 'pr0b3a00' };
  put('major', 'reports/backup/run-c.count.row-counter.pr0b3a00.json', Object.assign({ format: 'flightdeck-report/9', app: '9.0.0' }, rp));
  put('feature', 'reports/backup/run-c.count.row-counter.pr0b3a00.json', Object.assign({ format: 'flightdeck-report/1', features: X, app: '9.1.0' }, rp));
  const rd = { process: 'backup', run: 'run-c', step: 'count', producer: 'row-counter', report: 'pr0b3a00', sha256: sha('probe'), status: 'open', by: 'person-avery', at: AT, rev: 1, seen: null };
  const rdName = 'report-decisions/backup/run-c.' + decisionHash('backup/run-c/count/row-counter/pr0b3a00') + '.w-probe.1.json';
  put('major', rdName, Object.assign({ format: 'flightdeck-report-decision/9', app: '9.0.0' }, rd));
  put('feature', rdName, Object.assign({ format: 'flightdeck-report-decision/1', features: X, app: '9.1.0' }, rd));
  /* team-values.json (2.9). */
  put('major', 'team-values.json', { format: 'flightdeck-team-values/9', app: '9.0.0', values: { base: { value: 'x' } } });
  put('feature', 'team-values.json', { format: 'flightdeck-team-values/1', features: X, app: '9.1.0', values: { base: { value: 'x' } } });
  return out;
}

function all() {
  const files = {};
  Object.entries(folder()).forEach(([p, t]) => { files['folder/' + p] = t; });
  files['people.json'] = j({ format: 'flightdeck-people/1', app: APP, people: [{ id: 'person-avery', name: 'Avery Lee', initials: 'AL', email: 'avery@example.com', folderRole: 'owner' }, { id: 'person-blake', name: 'Blake Ortiz', initials: 'BO', email: 'blake@example.com' }] });
  const pr = probes();
  ['major', 'feature'].forEach(k => Object.entries(pr[k]).forEach(([p, t]) => { files['probes/' + k + '/' + p] = t; }));
  return files;
}

/* On disk a screenshot is its bytes; in a tree it's a data: URL, as the harness keeps binary files (test/compat-harness.js). */
function readDir(dir) { return fs.existsSync(dir) ? require('../test/compat-harness').readTree(dir) : {}; }
/* A sample tree as path → text (paths relative to it): 'folder', 'probes/major', 'probes/feature'. */
function tree(which) { return readDir(path.join(DIR, which)); }

if (require.main === module) {
  const want = all();
  if (process.argv.includes('--write')) {
    require('../test/compat-harness').writeTree(DIR, want);
    console.log('Wrote test/fixtures/v2/ (' + Object.keys(want).length + ' files)');
  } else {
    const have = readDir(DIR), bad = Object.keys(want).concat(Object.keys(have)).filter((p, i, a) => a.indexOf(p) === i && want[p] !== have[p]);
    console.log(bad.length ? 'Differ: ' + bad.join(', ') : 'test/fixtures/v2/ matches the frozen contracts');
    process.exitCode = bad.length ? 1 : 0;
  }
}
module.exports = { DIR, PUB1, PUB2, STAGE, MAP2, all, folder, probes, tree, hash, decisionHash };
