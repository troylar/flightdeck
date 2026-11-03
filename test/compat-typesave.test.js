// flightdeck type save (2.14, slice A2) against real older releases (design section 6): every recorded copy loads the
// command's step-type file as the same normalized definition (1.10.0 refuses group and tags, a characterization), 1.x copies
// refuse a /2 type by name, the agent-*.jsonl history line is ignored before 1.16.0 and read from it (source '' until 1.19.0,
// 'agent' after), and the step-type editor's stale-save check: a fingerprint only before 2.1.0, 1.10.0 included (a colliding
// stale save goes through, characterized), the exact text from 2.1.0 (refused).
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { rule, run, load } = require('./harness');
const H = require('./compat-harness');
const { cmp } = require('../tools/old-bundles');
const FD = require('../bin/flightdeck.js');

const PF = load(), T = PF.types, U = PF.util, TL = PF.timeline;
const plain = (v) => JSON.parse(JSON.stringify(v));
const TAGS = H.bundles.tags();
const at = (v, lo, hi) => cmp(v, lo) >= 0 && (!hi || cmp(v, hi) <= 0);

/* Every optional property a step type has: hint, icon, group, tags, fields of each kind with and without required, choice
   options, and evidence. */
const DEF = { id: 'team.audit', label: 'Team audit', icon: 'doc', hint: 'An audit.', group: 'Operations / Checks', tags: ['#Audit', 'cab'],
  fields: { system: { label: 'System', kind: 'text', required: true }, level: { label: 'Level', kind: 'choice', options: ['Low', 'High'] }, ticket: { label: 'Ticket', kind: 'url' } },
  record: [{ name: 'number', label: 'Number', kind: 'text', long: true }, { name: 'outcome', label: 'Outcome', kind: 'choice', options: ['Pass', 'Fail'] }] };
/* What 1.11.0 onward load it as (customType): group split into levels, tags without "#" in lowercase, required: false where
   a field didn't say, version 2, custom. Written out, never computed. */
const LOADED = { id: 'team.audit', label: 'Team audit', icon: 'doc', hint: 'An audit.',
  fields: { system: { label: 'System', kind: 'text', required: true }, level: { label: 'Level', kind: 'choice', required: false, options: ['Low', 'High'] }, ticket: { label: 'Ticket', kind: 'url', required: false } },
  version: 2, custom: true, group: ['Operations', 'Checks'], tags: ['audit', 'cab'],
  record: [{ name: 'number', label: 'Number', kind: 'text', long: true }, { name: 'outcome', label: 'Outcome', kind: 'choice', options: ['Pass', 'Fail'] }] };
const TWO = { format: 'flightdeck-step-type/2', features: ['typed-evidence'], id: 'team.count', label: 'Count', record: [{ name: 'rows', label: 'Rows', kind: 'number', min: '0' }] };

/* Real command output: the bytes and the history line type save wrote. */
let made = null;
async function written() {
  if (made) return made;
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-typesave-'))), out = {};
  for (const d of [DEF, TWO]) {
    const f = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-in-'))), 'in.json');
    fs.writeFileSync(f, JSON.stringify(d));
    const r = JSON.parse((await FD.main(['type', 'save', dir, d.id, '--expect', 'none', '--from', f, '--json'])).out);
    assert.strictEqual(r.outcome, 'done', r.words);
    out[d.id] = { text: fs.readFileSync(path.join(dir, 'step-types', d.id + '.json'), 'utf8'), history: fs.readFileSync(path.join(dir, r.history.path), 'utf8'), historyPath: r.history.path };
  }
  return (made = out);
}
const mem = (P, files) => { const m = new P.fs.MemoryFS('typesave:' + Math.random(), null); m.reset(Object.assign({}, files)); return m; };

rule('Serializer: the command\'s bytes are PF.types.fileText(def), and what repo.saveStepType writes', async () => {
  const w = await written(), m = mem(PF, {});
  assert.strictEqual(w['team.audit'].text, T.fileText(DEF));
  assert.ok((await PF.repo.saveStepType(m, plain(DEF), null, { expectText: null })).ok);
  assert.strictEqual(m.files['step-types/team.audit.json'].t, w['team.audit'].text);
});
rule('Every recorded release loads the command\'s step type as the normalized definition (1.11.0 on); 1.10.0 refuses group and tags', async () => {
  const w = await written();
  assert.ok(TAGS.length >= 10, 'recorded releases: ' + TAGS.length);
  for (const t of TAGS) {
    const P = H.loadCopy(t.tag), got = await P.repo.loadStepTypes(mem(P, { 'step-types/team.audit.json': w['team.audit'].text }));
    if (at(t.version, '1.11.0')) assert.deepStrictEqual(plain(got.types['team.audit']), LOADED, t.version);
    else assert.deepStrictEqual(plain(got.errors), [{ file: 'team.audit.json', errors: ['unknown field(s): group, tags'] }], t.version);
  }
});
rule('A /2 type the command wrote: 1.x copies refuse it by name and load nothing from it; 2.x copies load it', async () => {
  const w = await written();
  for (const t of TAGS) {
    const P = H.loadCopy(t.tag), got = await P.repo.loadStepTypes(mem(P, { 'step-types/team.count.json': w['team.count'].text }));
    if (at(t.version, '2.0.0')) assert.ok(got.types['team.count'], t.version);
    else {
      assert.ok(!got.types['team.count'], t.version);
      assert.ok(got.errors.some((e) => e.file === 'team.count.json' && /Flightdeck 2|newer|format|features/.test(e.errors.join(' '))), t.version + ': ' + JSON.stringify(plain(got.errors)));
    }
  }
});
rule('The agent history line: no reader before 1.16.0; from 1.16.0 loadEditHistory lists it, source "" until 1.19.0 and "agent" after, definitions kept', async () => {
  const w = await written(), line = w['team.audit'], dir = path.posix.dirname(line.historyPath), name = path.posix.basename(line.historyPath);
  const op = name.replace(/^agent-|\.jsonl$/g, '');
  for (const t of TAGS) {
    const P = H.loadCopy(t.tag), m = mem(P, { 'step-types/team.audit.json': line.text, [line.historyPath]: line.history });
    if (!at(t.version, '1.16.0')) {
      assert.strictEqual(typeof P.repo.loadEditHistory, 'undefined', t.version + ': no saved-history reader');
      const ty = (await P.repo.loadStepTypes(m)).types['team.audit'];
      if (at(t.version, '1.11.0')) assert.deepStrictEqual(plain(ty), LOADED, t.version + ': the type reads the same beside it'); else assert.ok(!ty, t.version);
      continue;
    }
    const h = await P.repo.loadEditHistory(m, dir, U.hash(line.text)), e = h.items.filter((x) => x.entry && x.entry.id === op)[0];
    assert.ok(e, t.version + ': listed');
    assert.strictEqual(e.entry.source, at(t.version, '1.19.0') ? 'agent' : '', t.version + ': source');
    assert.deepStrictEqual(plain(e.entry.after), plain(DEF), t.version + ': the definition kept');
    assert.strictEqual(e.entry.before, null, t.version);
  }
});
rule('Stale-save check by release: a stale editor whose base collides with the command\'s bytes saves over them in every release before 2.1.0, 1.10.0 and 1.11.1 included (characterized); 2.1.0 on refuse it', async () => {
  const a = { id: 'sample.check', label: 'Verify result 149599' }, b = { id: 'sample.check', label: 'Verify result 312382' };
  assert.strictEqual(U.hash(T.fileText(a)), U.hash(T.fileText(b)), 'the fixtures collide');
  const c = { id: 'sample.check', label: '245ibbb0ckty', fields: {} }, d = { id: 'sample.check', label: 'n02kfd9kdioh', fields: {} };
  assert.strictEqual(U.hash(T.fileText(c)), '554b9c80');
  assert.strictEqual(U.hash(T.fileText(d)), '554b9c80');
  const stale = { id: 'sample.check', label: 'Stale editor' }, seen = [];
  for (const t of TAGS) {
    const P = H.loadCopy(t.tag);
    for (const [base, cmdDef] of [[a, b], [c, d]]) {
      const m = mem(P, { 'step-types/sample.check.json': T.fileText(cmdDef) });
      /* As that release's editor calls it: the fingerprint alone before 2.1.0, with the exact text from 2.1.0. */
      const r = await P.repo.saveStepType(m, plain(stale), P.util.hash(T.fileText(base)), at(t.version, '2.1.0') ? { expectText: T.fileText(base) } : {});
      const now = m.files['step-types/sample.check.json'].t;
      if (!at(t.version, '2.1.0')) { assert.ok(r && r.ok, t.version + ': ' + JSON.stringify(r)); assert.ok(/Stale editor/.test(now), t.version + ': the command\'s save is gone'); }
      else { assert.ok(r && r.conflict, t.version + ': ' + JSON.stringify(r)); assert.strictEqual(now, T.fileText(cmdDef), t.version + ': the command\'s save stays'); }
    }
    seen.push(t.version);
  }
  for (const v of ['1.10.0', '1.11.1', '1.13.0', '2.0.1', '2.1.0']) assert.ok(seen.indexOf(v) >= 0, v + ' checked: ' + seen.join(', '));
});

run();
