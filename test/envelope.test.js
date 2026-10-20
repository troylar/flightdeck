// File formats: PF.envelope (docs/design.md section 28). Every family, its legacy spellings, and the refusals the 1.21 bridge
// gives a file from a newer Flightdeck: an unknown major or an unknown feature is refused and named, never read.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { load, rule, run } = require('./harness');
const S = require('../tools/v2-samples');
const PF = load(), E = PF.envelope;
const plain = (v) => JSON.parse(JSON.stringify(v));

const ok = (fam, o) => { const v = E.judge(fam, o); assert.ok(v.ok, fam + ': ' + JSON.stringify(o).slice(0, 120) + ' → ' + v.why); return v; };
const no = (fam, o, kind, needs) => {
  const v = E.judge(fam, o);
  assert.ok(!v.ok, fam + ' should refuse ' + JSON.stringify(o).slice(0, 120));
  assert.strictEqual(v.kind, kind, fam + ': ' + v.why);
  if (needs !== undefined) assert.strictEqual(v.needs, needs, fam + ': ' + v.why);
  assert.ok(typeof v.why === 'string' && v.why.length > 5);
  return v;
};

rule('Every family in the 2.0 plan is in PF.envelope.FAMILIES, and every frozen feature has a 2.0 name', () => {
  ['flightdeck-checklist', 'preflight-publication', 'preflight-run', 'flightdeck-run-archive', 'flightdeck-step-type', 'flightdeck-types', 'flightdeck-plan', 'flightdeck-plan-status',
    'flightdeck-validation', 'flightdeck-followup-decision', 'flightdeck-correction-decision', 'flightdeck-fix-decision', 'flightdeck-proposal', 'flightdeck-presence', 'flightdeck-connection',
    'flightdeck-people', 'flightdeck-skill', 'flightdeck-editor-history', 'flightdeck-installed', 'flightdeck-stage-decision', 'flightdeck-extension', 'flightdeck-report', 'flightdeck-report-decision']
    .forEach(f => assert.ok(E.FAMILIES[f], f));
  assert.deepStrictEqual(plain(E.FROZEN), ['typed-details', 'typed-evidence', 'phase-notes', 'phase-shots', 'gate-shots', 'pinned-children', 'pinned-skills', 'staged', 'test-run', 'extensions']);
  E.FROZEN.forEach(f => assert.ok(E.FEATURE.test(f)));
});

/* Slice 2, part 1: phase and gate notes and screenshots; part 2: pins; slice 3: typed data. Only these are registered; every
   other 2.0 feature stays refused (review #12). */
const PART1 = ['phase-notes', 'phase-shots', 'gate-shots'], PART2 = PART1.concat(['pinned-children', 'pinned-skills']), PART3 = PART2.concat(['typed-details', 'typed-evidence']);
rule('Each slice registers only the features it builds: checklist/2, publication/2 and run/3 know the notes, screenshots, pins and typed-data features, step-type/2 typed evidence, nothing else does', () => {
  const want = { 'flightdeck-checklist': { 2: PART3 }, 'preflight-publication': { 2: PART3 }, 'preflight-run': { 3: PART3 }, 'flightdeck-step-type': { 2: ['typed-evidence'] } };
  Object.keys(E.FAMILIES).forEach(f => Object.keys(E.FAMILIES[f].majors).forEach(m => assert.deepStrictEqual(plain(E.FAMILIES[f].majors[m]), (want[f] || {})[m] || [], f + '/' + m)));
  ['staged', 'test-run', 'extensions'].forEach(x => {
    no('preflight-publication', { format: 'preflight-publication/2', features: [x] }, 'newer', '2.0');
    no('preflight-run', { format: 'preflight-run/3', features: [x] }, 'newer', '2.0');
  });
  ok('preflight-publication', { format: 'preflight-publication/2', features: PART1 });
  ok('preflight-run', { format: 'preflight-run/3', features: ['gate-shots'] });
  no('preflight-publication', { format: 'preflight-publication/1', features: ['phase-notes'] }, 'newer', '2.0');
  no('preflight-run', { format: 'preflight-run/2', features: ['phase-notes'] }, 'newer', '2.0');
});

rule('Legacy spellings are the envelope: every 1.x record reads as its family\'s major', () => {
  assert.strictEqual(ok('preflight-publication', { format: 'preflight-publication/1' }).major, 1);
  assert.strictEqual(ok('preflight-run', { format: 'preflight-run/2' }).major, 2);
  assert.strictEqual(ok('flightdeck-followup-decision', { kind: 'followup-decision', fv: 1 }).major, 1);
  assert.strictEqual(ok('flightdeck-followup-decision', { kind: 'followup-decision' }).major, 1, 'fv missing is 1');
  [undefined, 0, 1, 2].forEach(dv => ok('flightdeck-correction-decision', { kind: 'correction-decision', dv }));
  ok('flightdeck-fix-decision', { kind: 'fix-decision' });
  ok('flightdeck-proposal', { kind: 'draft-proposal', pv: 1 });
  ok('flightdeck-presence', { kind: 'presence', pv: 1, app: '2.0.0' });
  ok('flightdeck-connection', { kind: 'connection-probe', cv: 1 });
  ok('flightdeck-plan', { kind: 'plan', id: 'p' });
  ok('flightdeck-plan-status', { kind: 'status' });
  ok('flightdeck-validation', { kind: 'validation' });
  ['log', 'answer'].forEach(kind => ok('flightdeck-run-archive', { kind }));
  ok('flightdeck-run-archive', { kind: 'migration', av: 1 });
  ok('flightdeck-step-type', { id: 'team.x' });
  ok('flightdeck-types', { id: 'confirm', version: 2 });
  ok('flightdeck-people', [{ id: 'a', name: 'A' }]);
  ok('flightdeck-people', { people: [] });
  ok('flightdeck-people', { format: 'flightdeck-people/1', people: [] });
  ok('flightdeck-skill', { name: 's', implements: 'backup@1' });
  ok('flightdeck-installed', { format: 'flightdeck-installed/1', version: '1.18.0' });
  ok('flightdeck-editor-history', { v: 1 });
});

rule('An unknown major is refused as newer, naming the version the 2.0 contract gives it', () => {
  no('preflight-publication', { format: 'preflight-publication/3' }, 'newer', '');
  no('preflight-run', { format: 'preflight-run/4' }, 'newer', '');
  no('flightdeck-plan', { format: 'flightdeck-plan/3' }, 'newer', '');
  no('flightdeck-plan-status', { format: 'flightdeck-plan-status/3' }, 'newer', '');
  no('flightdeck-validation', { format: 'flightdeck-validation/2' }, 'newer', '2.0');
  no('flightdeck-step-type', { format: 'flightdeck-step-type/3' }, 'newer', '');
  no('flightdeck-types', { version: 4 }, 'newer', '');
  no('flightdeck-skill', { format: 'flightdeck-skill/3' }, 'newer', '');
  ['flightdeck-stage-decision', 'flightdeck-extension'].forEach(f => no(f, { format: f + '/1' }, 'newer', '2.0'));
  ['flightdeck-report', 'flightdeck-report-decision'].forEach(f => { ok(f, { format: f + '/1' }); no(f, { format: f + '/2' }, 'newer', ''); no(f, { format: f + '/1', features: ['staged'] }, 'newer', '2.0'); });
  no('flightdeck-followup-decision', { kind: 'followup-decision', fv: 2 }, 'newer', '');
  no('flightdeck-correction-decision', { kind: 'correction-decision', dv: 3 }, 'newer', '');
  no('flightdeck-run-archive', { kind: 'migration', av: 2 }, 'newer', '');
  no('flightdeck-proposal', { kind: 'draft-proposal', pv: 2 }, 'newer');
  no('flightdeck-people', { format: 'flightdeck-people/2', people: [] }, 'newer');
  no('flightdeck-installed', { format: 'flightdeck-installed/2' }, 'newer');
  assert.strictEqual(E.judge('preflight-run', { format: 'preflight-run/3', features: ['staged'] }).why, 'uses staged, which this copy doesn\'t understand. Needs Flightdeck 2.0.');
  assert.strictEqual(E.judge('flightdeck-validation', { format: 'flightdeck-validation/2' }).why, 'was made with a newer Flightdeck (flightdeck-validation/2). Needs Flightdeck 2.0.');
});

rule('The writer\'s own app version names the version needed (2.1 reading as 2.1), never a version older than 2.0', () => {
  no('preflight-run', { format: 'preflight-run/4', app: '2.1.3' }, 'newer', '2.1');
  no('preflight-run', { format: 'preflight-run/4', app: '1.9.0' }, 'newer', '');
  no('flightdeck-validation', { format: 'flightdeck-validation/2', app: 'not a version' }, 'newer', '2.0');
});

rule('An unknown feature is refused even when the major is known', () => {
  no('preflight-publication', { format: 'preflight-publication/1', features: ['typed-details'] }, 'newer', '2.0');
  no('preflight-run', { format: 'preflight-run/2', features: ['from-the-future'] }, 'newer', '');
  no('flightdeck-followup-decision', { kind: 'followup-decision', fv: 1, features: ['x-y'] }, 'newer');
  ok('preflight-run', { format: 'preflight-run/2', features: [] });
});

rule('Never throws on hostile values: wrong types, prototypes, huge lists', () => {
  const hostile = [null, undefined, 1, 'x', [], [1], { format: 1 }, { format: '__proto__/1' }, { format: 'preflight-run/0' }, { format: 'preflight-run/99999' }, { format: 'preflight-run/2', features: 'x' },
    { format: 'preflight-run/2', features: new Array(33).fill('a-b') }, { format: 'preflight-run/2', features: [{}] }, { kind: 'followup-decision', fv: '1' }, { kind: 'followup-decision', fv: 1.5 }, { kind: 'followup-decision', fv: -1 },
    JSON.parse('{"__proto__": {"format": "preflight-run/2"}}'), Object.create(null), { constructor: 1, format: 'preflight-run/2' }];
  Object.keys(E.FAMILIES).concat(['constructor', '__proto__', 'nope']).forEach(f => hostile.forEach(o => {
    const v = E.judge(f, o);
    assert.ok(v && typeof v.ok === 'boolean');
    if (!v.ok) assert.ok(v.kind === 'newer' || v.kind === 'malformed');
  }));
  assert.strictEqual(E.judge('preflight-run', JSON.parse('{"__proto__": {"format": "preflight-run/2"}}')).ok, false, 'an inherited format isn\'t the file\'s');
  assert.strictEqual(E.judge('constructor', {}).ok, false);
});

rule('judge never throws for any JSON value in any field, for every family (a value with toString or valueOf that isn\'t a function included)', () => {
  const odd = [{ toString: null }, { valueOf: null, toString: null }, { toString: 1 }, [], [null], { a: { toString: null } }, null, true, 1e308, -0, '', 'x'.repeat(5000), [{ toString: null }]];
  const fields = ['format', 'features', 'kind', 'app', 'fv', 'dv', 'pv', 'cv', 'av', 'v', 'version'];
  Object.keys(E.FAMILIES).concat(['nope', '__proto__', 'constructor']).forEach(f => {
    odd.forEach(v => {
      fields.forEach(k => {
        const o = JSON.parse(JSON.stringify({ [k]: v }));
        let r; assert.doesNotThrow(() => { r = E.judge(f, o); }, f + ' ' + k + ' ' + JSON.stringify(v).slice(0, 40));
        assert.ok(r && typeof r.ok === 'boolean' && (r.ok || typeof r.why === 'string'));
      });
      assert.doesNotThrow(() => E.judge(f, JSON.parse(JSON.stringify(v === undefined ? null : v))));
    });
    const kinds = { 'flightdeck-followup-decision': 'followup-decision', 'flightdeck-plan': 'plan' };
    assert.doesNotThrow(() => E.judge(f, { kind: kinds[f], format: { toString: null }, features: [{ toString: null }], app: { toString: null } }));
  });
  ['format', 'features'].forEach(k => odd.forEach(v => assert.doesNotThrow(() => E.markdown(JSON.parse(JSON.stringify({ [k]: v }))))));
  assert.strictEqual(E.judge('preflight-run', { format: { toString: null } }).kind, 'malformed');
});

rule('A format from another family is malformed, never read as this one', () => {
  no('preflight-run', { format: 'preflight-publication/1' }, 'malformed');
  no('flightdeck-plan', { format: 'flightdeck-plan-status/1' }, 'malformed');
  no('preflight-run', { format: 'acme-thing/1' }, 'newer');
});

rule('stamp: lowest sufficient format: no envelope without a feature; a registered feature gives the 2.0 major, in the frozen order, with the app', () => {
  Object.keys(E.FAMILIES).forEach(f => assert.deepStrictEqual(plain(E.stamp(f, [])), {}));
  assert.deepStrictEqual(plain(E.stamp('preflight-publication', ['gate-shots', 'phase-notes'], '2.0.0')), { format: 'preflight-publication/2', features: ['phase-notes', 'gate-shots'], app: '2.0.0' });
  assert.deepStrictEqual(plain(E.stamp('preflight-run', ['phase-shots'], '2.0.0')), { format: 'preflight-run/3', features: ['phase-shots'], app: '2.0.0' });
  assert.deepStrictEqual(plain(E.stamp('preflight-run', ['phase-shots'], 'dev')), { format: 'preflight-run/3', features: ['phase-shots'] }, 'an app that isn\'t a version is left out');
  assert.deepStrictEqual(plain(E.stamp('preflight-publication', ['typed-evidence', 'typed-details'], '2.0.0')), { format: 'preflight-publication/2', features: ['typed-details', 'typed-evidence'], app: '2.0.0' });
  assert.deepStrictEqual(plain(E.stamp('flightdeck-step-type', ['typed-evidence'], '2.0.0')), { format: 'flightdeck-step-type/2', features: ['typed-evidence'], app: '2.0.0' });
  assert.throws(() => E.stamp('preflight-publication', ['staged'], '2.0.0'), /staged/);
  assert.throws(() => E.stamp('flightdeck-plan', ['phase-notes'], '2.0.0'));
  assert.throws(() => E.stamp('nope', []));
});

rule('Checklists: no front-matter-only minimums; a format: or features: line is a blocker that says why', () => {
  assert.ok(E.markdown({ process: 'p' }).ok);
  assert.strictEqual(E.markdown({ format: 'flightdeck-checklist/1' }).why, 'This says it needs Flightdeck 2.0, but nothing in it does. Remove the format line.');
  assert.ok(/needs Flightdeck 2\.0/.test(E.markdown({ format: 'flightdeck-checklist/2' }).why));
  assert.strictEqual(E.markdown({ format: 'flightdeck-checklist/2' }).needs, '2.0');
  assert.ok(/needs Flightdeck 2\.0/.test(E.markdown({ features: 'typed-details' }).why));
  assert.ok(/doesn't understand/.test(E.markdown({ features: 'from-the-future' }).why));
  assert.ok(/isn't a checklist format/.test(E.markdown({ format: 'preflight-run/2' }).why));
  assert.ok(/a newer Flightdeck/.test(E.markdown({ format: 'flightdeck-checklist/9' }).why));
});

rule('Checklists: a format: line counts only beside a 2.0 construct the line names or implies; with a 1.x body it stays a blocker', () => {
  const body2 = ['---', 'process: p', 'title: P', 'format: flightdeck-checklist/2', 'features: phase-notes', '---', '', '## One {#one}', '  > Read first.', '- [ ] {confirm} Look {#look}', ''].join('\n');
  assert.deepStrictEqual(plain(PF.map.check(PF.map.parse(body2), { people: [], types: {} }).blockers), []);
  assert.ok(E.markdown({ format: 'flightdeck-checklist/2' }, PF.map.parse(body2)).ok);
  assert.ok(!E.markdown({ format: 'flightdeck-checklist/2', features: 'staged' }, PF.map.parse(body2)).ok, 'an unregistered feature is still refused');
  assert.strictEqual(E.markdown({ format: 'flightdeck-checklist/2' }, PF.map.parse('## One {#one}\n- [ ] {confirm} Look {#look}\n')).why, 'This says it needs Flightdeck 2.0, but nothing in it does. Remove the format line.');
});

rule('The bridge\'s checklist check blocks each front-matter fixture that every older copy publishes', () => {
  const t = S.tree('folder');
  ['min-only', 'feature-only', 'min-plus-body'].forEach(n => {
    const md = t['maps/drafts/' + n + '.md'], c = PF.map.check(PF.map.parse(md), { people: [], types: {} });
    assert.ok(c.blockers.some(b => /Flightdeck 2\.0|newer Flightdeck/.test(b)), n + ': ' + c.blockers.join(' | '));
  });
});

rule('familyOfPath names the family of every JSON sample and probe path', () => {
  const t = S.tree('folder'), json = (p) => /\.json$/.test(p) && !/\/types\.json$/.test(p), paths = Object.keys(t).filter(json).concat(Object.keys(S.tree('probes/major')).filter(json));
  paths.forEach(p => assert.ok(E.familyOfPath(p), p));
});

rule('The committed 2.0 samples and probes are exactly what tools/v2-samples.js writes (the frozen contracts)', () => {
  const want = S.all(), have = {};
  ['folder', 'probes/major', 'probes/feature'].forEach(w => Object.entries(S.tree(w)).forEach(([p, t]) => { have[w + '/' + p] = t; }));
  have['people.json'] = fs.readFileSync(path.join(S.DIR, 'people.json'), 'utf8');
  assert.deepStrictEqual(Object.keys(have).sort(), Object.keys(want).sort());
  Object.keys(want).forEach(p => assert.strictEqual(have[p], want[p], p));
});

/* What slice 2 part 2 reads: plan/2 and its decision, an exact skill registration, and the explicit 2.0 run on a /1 version;
   slice 3 adds the typed /2 version, its typed run/3 with migration records, and the 2.0 step type. */
const PART2_READS = ['proposals/plan-backup-pinned.json', 'proposals/plan-backup-pinned.status-w-twozero.json', 'skill-registrations/release-notes/sk-aaaa1111.1.w-twozero.json', 'runs/backup/run-e/run.json',
  'publications/backup/v2-zzzz2222/publication.json', 'runs/backup/run-c/run.json', 'step-types/team.count.json'];
/* What slice 2b reads: a report and a decision on it, through the reports reader itself. */
const REPORT_READS = ['reports/backup/run-c.count.row-counter.k3m9p2q8.json', 'report-decisions/backup/run-c.' + S.hash('backup/run-c/count/row-counter/k3m9p2q8') + '.w-twozero.1.json'];
rule('Every 2.0 sample this slice doesn\'t build is refused by its family\'s verdict in this copy, every probe too, and the ones it builds are read', () => {
  const t = S.tree('folder');
  PART2_READS.forEach(p => { const fam = E.familyOfPath(p), o = JSON.parse(t[p]); assert.ok(E.judge(fam, o).ok, p); if (fam === 'preflight-run') assert.ok(!PF.run.sanitize(o)._unrunnable, p); });
  const rep = PF.reports.clean(t[REPORT_READS[0]], 'backup', REPORT_READS[0].split('/').pop());
  assert.ok(rep.ok, rep.why);
  const dec = PF.reports.cleanDecision(JSON.parse(t[REPORT_READS[1]]), 'backup', REPORT_READS[1].split('/').pop());
  assert.ok(dec.ok, dec.why); assert.strictEqual(dec.d.sha256, PF.sha256.hex(t[REPORT_READS[0]])); assert.strictEqual(dec.d.key, rep.report.key);
  Object.keys(t).filter(p => /\.json$/.test(p) && !/types\.json$|replaced-|presence\//.test(p) && !/^runs\/backup\/run-a\//.test(p) && PART2_READS.indexOf(p) < 0 && REPORT_READS.indexOf(p) < 0).forEach(p => {
    const fam = E.familyOfPath(p), o = JSON.parse(t[p]);
    const v = fam === 'flightdeck-skill' && o.implements === 'moved' ? { ok: false } : fam === 'preflight-run' && E.judge(fam, o).ok ? { ok: (PF.run.sanitize(o) || {})._needs == null } : E.judge(fam, o);
    assert.ok(!v.ok, p + ' (' + fam + ') must be refused');
  });
  ['major', 'feature'].forEach(k => Object.entries(S.tree('probes/' + k)).filter(([p]) => /\.json$/.test(p) && !/types\.json$/.test(p)).forEach(([p, text]) => {
    const v = E.judge(E.familyOfPath(p), JSON.parse(text));
    assert.ok(!v.ok && v.kind === 'newer', k + ' ' + p + ': ' + JSON.stringify(v));
  }));
  const types = JSON.parse(t['publications/backup/' + S.PUB2 + '/types.json']);
  assert.ok(E.judge('flightdeck-types', types['team.count']).ok && E.judge('flightdeck-types', types['team.count']).major === 3, 'a frozen type with 2.0 kinds is version 3, read here');
  assert.ok(PF.types.understood(types['team.count']));
  assert.ok(!E.judge('flightdeck-types', Object.assign({}, types['team.count'], { version: 4 })).ok, 'version 4 is newer');
  assert.ok(E.judge('flightdeck-types', types.confirm).ok, 'a built-in stays version 2');
});

/* A screenshot as the bytes on disk (the tree keeps binary files as data: URLs). */
const bytesOf = (t) => { const m = /^data:[\w/+.-]+;base64,/.exec(t); return m ? Buffer.from(t.slice(m[0].length), 'base64') : Buffer.from(t, 'utf8'); };
const fnvBytes = (b) => PF.util.hash(b.toString('latin1'));
const sha = (b) => require('crypto').createHash('sha256').update(b).digest('hex');
rule('Every sample and probe publication\'s screenshot fingerprints and payload hashes match the exact bytes of its files', () => {
  ['folder', 'probes/major', 'probes/feature'].forEach(w => {
    const t = S.tree(w);
    Object.keys(t).filter(p => /publication\.json$/.test(p)).forEach(p => {
      const dir = p.replace('publication.json', ''), info = JSON.parse(t[p]);
      Object.keys(info.images || {}).forEach(src => {
        assert.ok(t[dir + src] != null, p + ': ' + src + ' is there');
        assert.strictEqual(info.images[src], fnvBytes(bytesOf(t[dir + src])), p + ': ' + src + ' fingerprint over its bytes');
      });
      if (info.payload) {
        assert.strictEqual(info.payload.map, sha(Buffer.from(t[dir + 'map.md'], 'utf8')), p + ': payload map');
        assert.strictEqual(info.payload.types, sha(Buffer.from(t[dir + 'types.json'], 'utf8')), p + ': payload types');
        Object.keys(info.payload.images).forEach(src => assert.strictEqual(info.payload.images[src], sha(bytesOf(t[dir + src])), p + ': payload ' + src));
      }
      if (t[dir + 'map.md'] != null) assert.strictEqual(info.mapHash, PF.util.hash(t[dir + 'map.md']), p + ': mapHash');
      if (t[dir + 'types.json'] != null) assert.strictEqual(info.typesHash, PF.util.hash(t[dir + 'types.json']), p + ': typesHash');
    });
  });
});
rule('Every sample run\'s checklist, step types and hashes are its named publication\'s (run/3 on a /1 version carries v1\'s own)', () => {
  const H = require('./compat-harness'), G = require('../tools/old-folders');
  const t = Object.assign(H.readTree(require('path').join(G.DIR, 'v1.18.0')), S.tree('folder'));
  const runs = Object.keys(t).filter(p => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(p)).map(p => JSON.parse(t[p])).filter(r => r.format === 'preflight-run/3');
  assert.ok(runs.length >= 3);
  runs.forEach(r => {
    const top = r.stage ? 'staged/' : 'publications/', dir = top + r.process + '/' + r.folder + '/', info = JSON.parse(t[dir + 'publication.json']);
    assert.strictEqual(r.snapshot, t[dir + 'map.md'], r.id + ': snapshot is ' + dir + 'map.md');
    assert.strictEqual(JSON.stringify(r.types, null, 2), t[dir + 'types.json'], r.id + ': types are ' + dir + 'types.json');
    assert.strictEqual(r.mapHash, info.mapHash, r.id + ': mapHash'); assert.strictEqual(r.typesHash, info.typesHash, r.id + ': typesHash');
    if (!r.stage) assert.strictEqual(r.version, info.version, r.id + ': version');
    assert.deepStrictEqual(r.payload || null, info.payload || null, r.id + ': payload (a /1 version has none)');
  });
});

/* ---------- Slice 2, part 1: the real writers (lowest sufficient format, the frozen payload, run/3) ---------- */
const P = PF.publish, R = PF.run, M = PF.map;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUg==', 'base64'), PNG2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAB', 'base64');
const DRAFT1 = ['---', 'process: backup', 'title: Backup check', 'owner: person-avery', 'roles: lead', '---', '', '## Prepare {#prep}', '- [!] {confirm} Read the restore runbook @lead {#read}', '',
  '## Gate: Restored {#restored}', '  > The restored copy opens.', '', '## Close {#close}', '- [ ] {confirm} File the report @lead {#file}', ''].join('\n');
const DRAFT2 = DRAFT1.replace('## Prepare {#prep}\n', '## Prepare {#prep}\n  > Use the scratch server, never production.\n  ![The scratch server](images/scratch.png)\n')
  .replace('  > The restored copy opens.\n', '  > The restored copy opens.\n  ![Row counts side by side](images/counts.png)\n');
function build(md, extra) {
  const images = {}, imageBytes = {};
  [['images/scratch.png', PNG], ['images/counts.png', PNG2]].forEach(([src, b]) => { if (md.indexOf(src) >= 0) { images[src] = PF.util.hash(b.toString('latin1')); imageBytes[src] = new Uint8Array(b); } });
  return P.build(md, Object.assign({ by: 'person-avery', changes: 'Notes on the phase', now: '2026-10-20T09:00:00.000Z', existing: [], rand: 'abcd1234', app: '2.0.0', images, imageBytes }, extra || {}));
}
/* The exact bytes of a built version's checklist and step types, as a folder holds them (UTF-8). */
const exactOf = (files) => P.exactOf({ 'map.md': new Uint8Array(Buffer.from(files['map.md'], 'utf8')), 'types.json': new Uint8Array(Buffer.from(files['types.json'], 'utf8')) });
const pubOf = (b) => { const v = P.verify(b.folder, b.files, exactOf(b.files)); assert.ok(v.ok, v.why); return v; };

rule('map.js reads phase notes and screenshots under a phase heading (before its first step or track) and screenshots under a gate; PF.map.features names them', () => {
  const m = M.parse(DRAFT2);
  assert.deepStrictEqual(plain(m.errors), []);
  assert.strictEqual(m.phases[0].note, 'Use the scratch server, never production.');
  assert.deepStrictEqual(plain(m.phases[0].shots), [{ caption: 'The scratch server', src: 'images/scratch.png' }]);
  assert.strictEqual(m.phases[0].gate.note, 'The restored copy opens.');
  assert.deepStrictEqual(plain(m.phases[0].gate.shots), [{ caption: 'Row counts side by side', src: 'images/counts.png' }]);
  assert.deepStrictEqual(plain(m.phases[1].gate.shots), [], 'an automatic gate has none');
  assert.deepStrictEqual(plain(M.features(m)), ['phase-notes', 'phase-shots', 'gate-shots']);
  assert.deepStrictEqual(plain(M.features(M.parse(DRAFT1))), [], 'a gate note is not new: every copy since 1.10 publishes it');
  const lane = M.parse('## A {#a}\n### Track: T {#t}\n  > Not a phase note.\n- [ ] {confirm} X {#x}\n');
  assert.ok(lane.errors.length, 'a note under a track heading is still an error');
  const bad = M.parse('## A {#a}\n  ![x](../secret.png)\n- [ ] {confirm} X {#x}\n');
  assert.ok(/under images\//.test(bad.errors[0].msg));
});

rule('build writes the lowest sufficient format: a checklist with no 2.0 feature is preflight-publication/1, byte for byte as before (gate notes included)', () => {
  const b = build(DRAFT1), info = JSON.parse(b.files['publication.json']);
  assert.deepStrictEqual(Object.keys(info), ['format', 'process', 'title', 'version', 'folder', 'publishedBy', 'publishedAt', 'changes', 'mapHash', 'typesHash', 'images']);
  assert.strictEqual(info.format, 'preflight-publication/1');
  assert.deepStrictEqual(plain(P.features(M.parse(DRAFT1))), []);
  assert.ok(pubOf(b).ok);
});

rule('build writes preflight-publication/2 when a 2.0 feature is used: features, app and the frozen payload (SHA-256 over exact bytes), in the frozen sample\'s shape', () => {
  const b = build(DRAFT2), info = JSON.parse(b.files['publication.json']), sample = JSON.parse(S.tree('folder')['publications/backup/' + S.PUB2 + '/publication.json']);
  assert.deepStrictEqual(Object.keys(info), Object.keys(sample), 'the sample\'s fields, in its order');
  assert.strictEqual(info.format, 'preflight-publication/2'); assert.strictEqual(info.app, '2.0.0');
  assert.deepStrictEqual(info.features, ['phase-notes', 'phase-shots', 'gate-shots']);
  assert.deepStrictEqual(Object.keys(info.payload), Object.keys(sample.payload));
  assert.deepStrictEqual(info.payload.extensions, {}); assert.deepStrictEqual(info.payload.pins, { children: {}, skills: {} }, 'pins are slice 2 part 2: the slot is there, empty');
  assert.strictEqual(info.payload.map, sha(Buffer.from(b.files['map.md'], 'utf8')));
  assert.strictEqual(info.payload.types, sha(Buffer.from(b.files['types.json'], 'utf8')));
  assert.deepStrictEqual(info.payload.images, { 'images/scratch.png': sha(PNG), 'images/counts.png': sha(PNG2) });
  assert.deepStrictEqual(plain(P.payload({ 'map.md': b.files['map.md'], 'types.json': b.files['types.json'], images: { 'images/scratch.png': new Uint8Array(PNG), 'images/counts.png': new Uint8Array(PNG2) } })), info.payload);
  const v = pubOf(b);
  assert.deepStrictEqual(plain(P.payloadOf(v.info)), info.payload);
});

rule('A /1 version has an implied payload from its own fingerprints, with no extensions and no pins', () => {
  const b = build(DRAFT1), info = JSON.parse(b.files['publication.json']);
  assert.deepStrictEqual(plain(P.payloadOf(info)), { implied: true, map: info.mapHash, types: info.typesHash, images: {}, extensions: {}, pins: {} });
});

rule('verify checks a /2 version by its payload: a changed map or types, a missing or odd payload, or a pin or extension this copy can\'t check never verifies', () => {
  const b = build(DRAFT2), files = Object.assign({}, b.files), info = JSON.parse(files['publication.json']);
  const withInfo = (f) => Object.assign({}, files, { 'publication.json': JSON.stringify(f(JSON.parse(JSON.stringify(info)))) });
  assert.ok(!P.verify(b.folder, withInfo(i => { i.payload.map = 'a'.repeat(64); return i; }), exactOf(files)).ok, 'map payload');
  assert.ok(!P.verify(b.folder, withInfo(i => { i.payload.types = 'b'.repeat(64); return i; }), exactOf(files)).ok, 'types payload');
  const none = P.verify(b.folder, withInfo(i => { delete i.payload; return i; }), exactOf(files));
  assert.ok(!none.ok && none.unusable, 'no payload: ' + none.why);
  const pin = P.verify(b.folder, withInfo(i => { i.payload.pins.children.x = { process: 'p' }; return i; }), exactOf(files));
  assert.ok(!pin.ok && pin.unusable, 'a pin without its feature: ' + pin.why);
  const ext = P.verify(b.folder, withInfo(i => { i.payload.extensions['a.json'] = 'c'.repeat(64); return i; }), exactOf(files));
  assert.ok(!ext.ok && ext.unusable);
  const img = P.verify(b.folder, withInfo(i => { delete i.payload.images['images/counts.png']; return i; }), exactOf(files));
  assert.ok(!img.ok, 'a screenshot recorded without its payload entry');
});

rule('A /2 version verifies only from the SHA-256 of its exact bytes, through P.exactOf: never from decoded text, so a byte-order mark a reader drops can\'t pass', () => {
  const b = build(DRAFT2), raw = { 'map.md': new Uint8Array(Buffer.from(b.files['map.md'], 'utf8')), 'types.json': new Uint8Array(Buffer.from(b.files['types.json'], 'utf8')) };
  const none = P.verify(b.folder, b.files);
  assert.ok(!none.ok && !none.unusable && none.needsBytes, 'no exact bytes: ' + none.why);
  assert.ok(P.verify(b.folder, b.files, P.exactOf(raw)).ok, 'the exact bytes as published');
  const bom = Object.assign({}, raw, { 'map.md': new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(raw['map.md'])])) });
  const v = P.verify(b.folder, b.files, P.exactOf(bom));
  assert.ok(!v.ok && /byte for byte/.test(v.why), 'a byte-order mark the text doesn\'t show: ' + v.why);
  assert.throws(() => P.exactOf({ 'map.md': b.files['map.md'], 'types.json': b.files['types.json'] }), /bytes/, 'exactOf takes bytes, never text');
  const one = build(DRAFT1);
  assert.ok(P.verify(one.folder, one.files).ok, 'a /1 version is still checked by its fingerprints over text, as 1.x checks it');
});

rule('Every place that verifies a version hands P.verify the exact bytes of a /2 version (no reader checks /2 from text)', () => {
  const root = path.join(__dirname, '..'), files = ['src/storage/repo.js', 'src/core/evidence.js', 'bin/flightdeck.js'].concat(fs.readdirSync(path.join(root, 'src/ui')).filter(n => /\.js$/.test(n)).map(n => 'src/ui/' + n));
  let calls = 0;
  files.forEach((rel) => {
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (!/\b(?:P|PF\.publish)\.verify\(/.test(l)) return;
      calls++;
      if (/missingVersion/.test(l)) return;
      assert.ok(/\.verify\([^;]*exact/i.test(l), rel + ':' + (i + 1) + ' verifies a version without its exact bytes: ' + l.trim());
    });
  });
  assert.ok(calls >= 4, 'found the call sites');
});

rule('R.create writes preflight-run/3 on a /2 version (features, app, typesHash, payload) and preflight-run/2 on a /1 version, unchanged', () => {
  const one = pubOf(build(DRAFT1)), two = pubOf(build(DRAFT2));
  const r2 = R.create(one, { by: 'person-avery', session: 'w', now: '2026-10-20T09:00:00.000Z', app: '2.0.0' });
  assert.strictEqual(r2.format, 'preflight-run/2');
  ['features', 'app', 'typesHash', 'payload'].forEach(k => assert.ok(!(k in r2), 'run/2 has no ' + k));
  const r3 = R.create(two, { by: 'person-avery', session: 'w', now: '2026-10-20T09:00:00.000Z', app: '2.0.0' });
  assert.strictEqual(r3.format, 'preflight-run/3');
  assert.deepStrictEqual(plain(r3.features), ['phase-notes', 'phase-shots', 'gate-shots']);
  assert.strictEqual(r3.app, '2.0.0'); assert.strictEqual(r3.typesHash, two.info.typesHash);
  assert.deepStrictEqual(plain(r3.payload), plain(two.info.payload));
  const back = R.sanitize(JSON.parse(JSON.stringify(r3)));
  assert.ok(!back._unrunnable, back._unrunnable);
  assert.strictEqual(back.format, 'preflight-run/3');
  assert.deepStrictEqual(plain(back.payload), plain(r3.payload));
  const sample = JSON.parse(S.tree('folder')['runs/backup/run-c/run.json']), mine = Object.keys(plain(back)).filter(k => k in sample);
  assert.deepStrictEqual(mine, Object.keys(sample).filter(k => k in back), 'run/3 fields in the frozen sample\'s order');
  assert.deepStrictEqual(plain(R.unexplained(JSON.parse(JSON.stringify(back)))), [], 'reading it back changes nothing');
});

rule('run/3 is read in full only when everything in it is known: an unknown field, a 2.0 feature this copy doesn\'t have, or an odd payload lists it by name only', () => {
  const two = pubOf(build(DRAFT2)), r3 = JSON.parse(JSON.stringify(R.create(two, { by: 'person-avery', session: 'w', now: '2026-10-20T09:00:00.000Z', app: '2.0.0' })));
  const nameOnly = (o) => { const x = R.sanitize(o); assert.ok(x && x._unrunnable && !Object.keys(x.steps).length && x._needs != null, JSON.stringify(x && x._unrunnable)); };
  nameOnly(Object.assign({}, r3, { migrations: [{ path: 'details.ticket' }] }));
  nameOnly(Object.assign({}, r3, { pins: { children: { a: {} } } }));
  nameOnly(Object.assign({}, r3, { pins: { reports: {} } }));
  nameOnly(Object.assign({}, r3, { features: ['phase-notes', 'staged'] }));
  nameOnly(Object.assign({}, r3, { payload: { map: 'x' } }));
  nameOnly(Object.assign({}, r3, { payload: Object.assign({}, r3.payload, { pins: { children: { a: {} }, skills: {} } }) }));
  const step = JSON.parse(JSON.stringify(r3)); step.steps = { read: { s: 'done', by: 'person-avery', at: '2026-10-20T09:00:00.000Z', skill: { id: 'x' } } };
  const x = R.sanitize(step); assert.ok(x._unrunnable, 'a nested unknown field still opens read-only, as for run/2');
  assert.throws(() => R.create(Object.assign({}, two, { info: Object.assign({}, two.info, { features: ['staged'] }) }), { by: 'a', session: 'w', now: '2026-10-20T09:00:00.000Z' }));
});

rule('Every screenshot a checklist shows (a step\'s, a phase\'s or a gate\'s) must be in its publication record and payload: one taken out of both manifests makes the version unusable, /1 and /2 alike', () => {
  const b = build(DRAFT2), info = JSON.parse(b.files['publication.json']);
  const drop = (i, src) => { delete i.images[src]; if (i.payload) delete i.payload.images[src]; return i; };
  for (const src of ['images/scratch.png', 'images/counts.png']) {
    const v = P.verify(b.folder, Object.assign({}, b.files, { 'publication.json': JSON.stringify(drop(JSON.parse(JSON.stringify(info)), src)) }), exactOf(b.files));
    assert.ok(!v.ok && v.unusable && /isn't in its publication record/.test(v.why), src + ': ' + v.why);
  }
  const one = build(DRAFT1.replace('- [!] {confirm} Read the restore runbook @lead {#read}\n', '- [!] {confirm} Read the restore runbook @lead {#read}\n  ![The runbook](images/scratch.png)\n'));
  const i1 = JSON.parse(one.files['publication.json']);
  assert.strictEqual(i1.format, 'preflight-publication/1');
  assert.ok(P.verify(one.folder, one.files).ok, 'as published, it is fine');
  const v1 = P.verify(one.folder, Object.assign({}, one.files, { 'publication.json': JSON.stringify(drop(i1, 'images/scratch.png')) }));
  assert.ok(!v1.ok && v1.unusable, 'a /1 version too: ' + v1.why);
});

run();
