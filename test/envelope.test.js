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

rule('The bridge registers no 2.0 feature: each slice registers only the features it builds', () => {
  Object.keys(E.FAMILIES).forEach(f => Object.keys(E.FAMILIES[f].majors).forEach(m => assert.deepStrictEqual(plain(E.FAMILIES[f].majors[m]), [], f + '/' + m)));
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
  no('preflight-publication', { format: 'preflight-publication/2' }, 'newer', '2.0');
  no('preflight-run', { format: 'preflight-run/3' }, 'newer', '2.0');
  no('flightdeck-plan', { format: 'flightdeck-plan/2' }, 'newer', '2.0');
  no('flightdeck-plan-status', { format: 'flightdeck-plan-status/2' }, 'newer', '2.0');
  no('flightdeck-validation', { format: 'flightdeck-validation/2' }, 'newer', '2.0');
  no('flightdeck-step-type', { format: 'flightdeck-step-type/2' }, 'newer', '2.0');
  no('flightdeck-types', { version: 3 }, 'newer', '2.0');
  no('flightdeck-skill', { format: 'flightdeck-skill/2' }, 'newer', '2.0');
  ['flightdeck-stage-decision', 'flightdeck-extension', 'flightdeck-report', 'flightdeck-report-decision'].forEach(f => no(f, { format: f + '/1' }, 'newer', '2.0'));
  no('flightdeck-followup-decision', { kind: 'followup-decision', fv: 2 }, 'newer', '');
  no('flightdeck-correction-decision', { kind: 'correction-decision', dv: 3 }, 'newer', '');
  no('flightdeck-run-archive', { kind: 'migration', av: 2 }, 'newer', '');
  no('flightdeck-proposal', { kind: 'draft-proposal', pv: 2 }, 'newer');
  no('flightdeck-people', { format: 'flightdeck-people/2', people: [] }, 'newer');
  no('flightdeck-installed', { format: 'flightdeck-installed/2' }, 'newer');
  assert.strictEqual(E.judge('preflight-run', { format: 'preflight-run/3' }).why, 'was made with a newer Flightdeck (preflight-run/3). Needs Flightdeck 2.0.');
});

rule('The writer\'s own app version names the version needed (2.1 reading as 2.1), never a version older than 2.0', () => {
  no('preflight-run', { format: 'preflight-run/4', app: '2.1.3' }, 'newer', '2.1');
  no('preflight-run', { format: 'preflight-run/4', app: '1.9.0' }, 'newer', '');
  no('preflight-run', { format: 'preflight-run/3', app: 'not a version' }, 'newer', '2.0');
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

rule('stamp: the bridge writes nothing new (no envelope for 1.x records, and refuses to stamp a feature)', () => {
  Object.keys(E.FAMILIES).forEach(f => assert.deepStrictEqual(plain(E.stamp(f, [])), {}));
  assert.throws(() => E.stamp('preflight-publication', ['typed-details']));
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

rule('Every 2.0 sample is refused by its family\'s verdict in this copy, and every probe too', () => {
  const t = S.tree('folder');
  Object.keys(t).filter(p => /\.json$/.test(p) && !/types\.json$|replaced-|presence\//.test(p) && !/^runs\/backup\/run-a\//.test(p)).forEach(p => {
    const fam = E.familyOfPath(p), o = JSON.parse(t[p]);
    const v = fam === 'flightdeck-skill' && o.implements === 'moved' ? { ok: false } : E.judge(fam, o);
    assert.ok(!v.ok, p + ' (' + fam + ') must be refused');
  });
  ['major', 'feature'].forEach(k => Object.entries(S.tree('probes/' + k)).filter(([p]) => /\.json$/.test(p) && !/types\.json$/.test(p)).forEach(([p, text]) => {
    const v = E.judge(E.familyOfPath(p), JSON.parse(text));
    assert.ok(!v.ok && v.kind === 'newer', k + ' ' + p + ': ' + JSON.stringify(v));
  }));
  const types = JSON.parse(t['publications/backup/' + S.PUB2 + '/types.json']);
  assert.ok(!E.judge('flightdeck-types', types['team.count']).ok, 'a frozen type with 2.0 kinds is version 3');
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

run();
