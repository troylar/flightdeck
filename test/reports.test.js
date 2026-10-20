// Reports from other apps (2.0 slice 2b): a report is a claim a tool writes once (flightdeck-report/1); the run's recorder
// accepts it (the step is checked with exactly its evidence) or declines it; decisions are flightdeck-report-decision/1
// files. What a report says, what a person decided and whether its inputs still match the run stay three facts.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), M = PF.map, P = PF.publish, R = PF.run, X = PF.reports;
const plain = (v) => JSON.parse(JSON.stringify(v));
const AT = '2026-10-20T09:00:00.000Z', LATER = '2026-10-20T10:00:00.000Z';
const bytes = (t) => new Uint8Array(Buffer.from(t, 'utf8'));

const MD = ['---', 'process: backup-check', 'title: Backup check', 'context: ticket, env', '---', '## P · READ-DO {#p}',
  '- [!] {jenkins.job} Deploy ^env {#deploy}', '  job: deploy', '  require: build', '- [ ] {confirm} Smoke {#smoke}', '  evidence: link',
  '- [ ] {confirm} Look around {#look}', '- [ ] {run.process} Verify the copy {#verify}', '  process: verify', ''].join('\n');
function makeRun(details) {
  const b = P.build(MD, { by: 'person-avery', changes: 'x', now: AT, existing: [], rand: 'k3m9p2q8' });
  const v = P.verify(b.folder, b.files);
  const r = R.create(v, { details: details || { ticket: 'ABC-123', env: 'prod' }, by: 'person-avery', session: 's1', now: AT, id: 'run1' });
  return { r, map: R.mapOf(r) };
}
function report(extra) {
  return Object.assign({ format: 'flightdeck-report/1', run: 'backup-check/run1', publication: { folder: 'v1-k3m9p2q8' }, step: 'deploy', verdict: 'pass',
    evidence: { build: '1432', buildLink: 'https://ci.example.com/1432' }, links: [{ label: 'Build', url: 'https://ci.example.com/1432' }],
    inputs: [{ name: 'Environment', value: 'prod', source: 'detail:env' }], producer: { name: 'ci-check', version: '1.4.0' }, created: AT, id: 'abcd1234' }, extra || {});
}
const NAME = 'run1.deploy.ci-check.abcd1234.json';
function cleanOk(o, name) { const c = X.clean(JSON.stringify(o), 'backup-check', name || NAME); assert.ok(c.ok, c.why); return c.report; }
function cleanNo(o, re, name) { const c = X.clean(typeof o === 'string' ? o : JSON.stringify(o), 'backup-check', name || NAME); assert.ok(!c.ok, 'should refuse'); if (re) assert.ok(c.errors.some(e => re.test(e)), c.errors.join(' | ')); return c; }
function entry(o, name) {
  const t = typeof o === 'string' ? o : JSON.stringify(o), s = X.snapshot(bytes(t)), c = s.text === null ? { ok: false, why: s.why } : X.clean(s.text, 'backup-check', name || NAME);
  return { name: name || NAME, path: 'reports/backup-check/' + (name || NAME), sha256: s.sha256, report: c.ok ? c.report : null, why: c.ok ? '' : c.why, kind: c.ok ? '' : c.kind };
}

/* ---------- bytes ---------- */
rule('Report bytes decode as strict UTF-8: overlong forms, surrogates, cut sequences and code points past U+10FFFF are refused', () => {
  assert.strictEqual(X.utf8(bytes('héllo ✓ 𝄞')), 'héllo ✓ 𝄞');
  [[0xc0, 0xaf], [0xe0, 0x80, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x9c], [0xff], [0x80], [0xf0, 0x9d, 0x84]].forEach(b => assert.strictEqual(X.utf8(new Uint8Array(b)), null, b.join(',')));
});
rule('A snapshot hashes the bytes on disk, then drops a byte-order mark', () => {
  const t = JSON.stringify(report()), withBom = new Uint8Array([0xef, 0xbb, 0xbf].concat(Array.from(bytes(t))));
  const a = X.snapshot(bytes(t)), b = X.snapshot(withBom);
  assert.strictEqual(a.text, t); assert.strictEqual(b.text, t);
  assert.notStrictEqual(a.sha256, b.sha256);
  assert.strictEqual(a.sha256, PF.sha256.hex(bytes(t)));
  assert.strictEqual(X.snapshot(new Uint8Array([0x7b, 0xff, 0x7d])).text, null);
});

/* ---------- names ---------- */
rule('Report file names: <run>.<step>.<tool>.<id>.json, OneDrive copies keep every part', () => {
  assert.deepStrictEqual(plain(X.parseName(NAME)), { run: 'run1', step: 'deploy', producer: 'ci-check', id: 'abcd1234', copy: '', canonical: NAME });
  assert.strictEqual(X.parseName('run1.deploy.ci-check.abcd1234-LAPTOP.json').copy, '-LAPTOP');
  assert.strictEqual(X.parseName('run1.deploy.ci-check.abcd1234 (1).json').copy, ' (1)');
  ['run1.deploy.ci-check.abc.json', 'Run1.deploy.ci-check.abcd1234.json', 'run1.Deploy.ci-check.abcd1234.json', 'run1.deploy.ci-check.abcd1234.json.tmp', 'run1.deploy.ci-check.abcd12345x.json.bak', '../x.json', null, 7, {}].forEach(n => assert.strictEqual(X.parseName(n), null, String(n)));
  assert.strictEqual(X.parseName('run1.deploy.ci-check.abcd1234x9.json').id, 'abcd1234x9');
});

/* ---------- reading ---------- */
rule('A valid report reads with every field, kept only as its own', () => {
  const o = cleanOk(report({ summary: 'Deployed 1432.', blockers: [] }));
  assert.strictEqual(o.process, 'backup-check'); assert.strictEqual(o.run, 'run1'); assert.strictEqual(o.verdict, 'pass');
  assert.strictEqual(Object.getPrototypeOf(o.evidence), null);
  assert.strictEqual(o.evidence.build, '1432');
  assert.strictEqual(o.key, 'backup-check/run1/deploy/ci-check/abcd1234');
});
rule('A report with a property this copy doesn\'t know, at any level, can\'t be read', () => {
  cleanNo(report({ extra: 1 }), /"extra"/);
  cleanNo(report({ publication: { folder: 'v1-k3m9p2q8', hash: 'x' } }), /"hash"/);
  cleanNo(report({ producer: { name: 'ci-check', version: '1', url: 'x' } }), /"url"/);
  cleanNo(report({ links: [{ label: 'a', url: 'https://example.com', icon: 'x' }] }), /"icon"/);
  cleanNo(report({ inputs: [{ name: 'a', value: 'b', source: 'external', note: 1 }] }), /"note"/);
});
rule('Verdicts and blockers: a pass has none, a fail or blocked names at least one', () => {
  cleanNo(report({ verdict: 'pass', blockers: ['x'] }), /pass but lists blockers/);
  cleanNo(report({ verdict: 'fail' }), /without a blocker/);
  cleanNo(report({ verdict: 'blocked', blockers: [] }), /without a blocker/);
  cleanNo(report({ verdict: 'maybe' }), /pass, fail or blocked/);
  assert.strictEqual(cleanOk(report({ verdict: 'fail', blockers: ['Restore failed'] })).blockers[0], 'Restore failed');
  cleanNo(report({ verdict: 'fail', blockers: Array(21).fill('x') }), /at most 20/);
});
rule('Links must be web links: mailto, javascript and data are refused', () => {
  ['mailto:a@example.com', 'javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', 'https://' + 'a'.repeat(2000)].forEach(u => cleanNo(report({ links: [{ label: 'x', url: u }] }), /url is a web link/));
});
rule('A secret input is named, never its value: one with a value refuses the report', () => {
  cleanNo(report({ inputs: [{ name: 'Token', value: 'hunter2', source: 'external', secret: true }] }), /secret with a value/);
  assert.deepStrictEqual(plain(cleanOk(report({ inputs: [{ name: 'Token', source: 'external', secret: true }] })).inputs), [{ name: 'Token', source: 'external', secret: true }]);
  cleanNo(report({ inputs: [{ name: 'Token', source: 'external', secret: 'yes' }] }), /secret is true/);
});
rule('The report must say what its file name says: process folder, run, step, producer and id', () => {
  cleanNo(report({ run: 'other/run1' }), /names process other/);
  cleanNo(report({ run: 'backup-check/run2' }), /names run run2/);
  cleanNo(report({ step: 'smoke' }), /file name says deploy/);
  cleanNo(report({ producer: { name: 'other', version: '1' } }), /file name says ci-check/);
  cleanNo(report({ id: 'zzzz9999' }), /file name says abcd1234/);
  cleanNo(report(), /file name/, 'deploy.json');
});
rule('Evidence names are a step\'s names: reserved keys and odd names refuse, never reach a prototype', () => {
  const c = cleanNo('{"format":"flightdeck-report/1","run":"backup-check/run1","publication":{"folder":"v1-k3m9p2q8"},"step":"deploy","verdict":"pass","evidence":{"__proto__":"x","constructor":"y"},"producer":{"name":"ci-check","version":"1"},"created":"' + AT + '","id":"abcd1234"}', /"__proto__"/);
  assert.ok(c.errors.some(e => /"constructor"/.test(e)));
  cleanNo(report({ evidence: { 'has space': 'x' } }), /isn't one a step records/);
  cleanNo(report({ evidence: { build: 7 } }), /is text/);
  const many = {}; for (let i = 0; i < 41; i++) many['k' + i] = 'v';
  cleanNo(report({ evidence: many }), /more than 40/);
});
rule('Newer and unreadable reports are named as such, never as absent', () => {
  const n = X.clean(JSON.stringify(report({ format: 'flightdeck-report/2' })), 'backup-check', NAME);
  assert.strictEqual(n.kind, 'newer');
  const f = X.clean(JSON.stringify(report({ features: ['staged'] })), 'backup-check', NAME);
  assert.strictEqual(f.kind, 'newer'); assert.strictEqual(f.needs, '2.0');
  assert.strictEqual(X.clean('{"format":"flightdeck-report/1"', 'backup-check', NAME).kind, 'malformed');
  assert.strictEqual(X.clean(JSON.stringify(report({ format: 'flightdeck-plan/1' })), 'backup-check', NAME).kind, 'malformed');
});
rule('Hostile values never throw: every field given every kind of JSON value', () => {
  const vals = [null, 0, -1, 1e999, '', 'x', true, [], [null], {}, { toString: null }, { __proto__: null }, 'javascript:alert(1)', '<img src=x>', 'a'.repeat(70000)];
  const base = report({ summary: 's', supersedes: 'abcd0000' });
  X.KEYS.forEach(k => vals.forEach(v => {
    const o = Object.assign({}, base); o[k] = v;
    const c = X.clean(JSON.stringify(o), 'backup-check', NAME);
    assert.ok(typeof c.ok === 'boolean', k);
  }));
  ['evidence', 'links', 'inputs', 'publication', 'producer'].forEach(k => vals.forEach(v => {
    const o = JSON.parse(JSON.stringify(base));
    if (Array.isArray(o[k])) o[k] = [v]; else o[k] = { x: v, folder: v, name: v, version: v };
    const c = X.clean(JSON.stringify(o), 'backup-check', NAME);
    assert.ok(typeof c.ok === 'boolean');
  }));
  [null, 1, 'x', [], '[]', '"x"', 'null'].forEach(t => assert.strictEqual(X.clean(typeof t === 'string' ? t : JSON.stringify(t), 'backup-check', NAME).ok, false));
});

/* ---------- copies and order ---------- */
rule('Copies: identical bytes are one report; copies that differ, or one that can\'t be read, can\'t be accepted', () => {
  const t = JSON.stringify(report());
  const same = X.group('backup-check', [entry(t), entry(t, 'run1.deploy.ci-check.abcd1234-LAPTOP.json')]).list;
  assert.strictEqual(same.length, 1); assert.strictEqual(same[0].differ, false); assert.strictEqual(same[0].copies.length, 2);
  const diff = X.group('backup-check', [entry(t), entry(JSON.stringify(report({ summary: 'other' })), 'run1.deploy.ci-check.abcd1234-LAPTOP.json')]).list[0];
  assert.ok(diff.differ); assert.ok(/differ/.test(diff.reason));
  const broken = X.group('backup-check', [entry(t), entry('{', 'run1.deploy.ci-check.abcd1234 (1).json')]).list[0];
  assert.ok(broken.report); assert.strictEqual(broken.unreadable.length, 1);
  const { r, map } = makeRun();
  assert.strictEqual(X.eligible(diff, r, map, { recording: true }).ok, false);
  assert.strictEqual(X.eligible(broken, r, map, { recording: true }).ok, false);
  // The report shown is the canonical name's, whatever order the files were listed in.
  const a = X.group('backup-check', [entry(JSON.stringify(report({ summary: 'copy' })), 'run1.deploy.ci-check.abcd1234-LAPTOP.json'), entry(t)]).list[0];
  assert.strictEqual(a.report.summary, undefined);
  assert.deepStrictEqual(plain(X.group('backup-check', [entry(t, 'notes.json')]).badNames.map(e => e.name)), ['notes.json']);
});
rule('Order is deterministic and never "newest": supersession chains, then producer and id; branches and loops are flat with a note', () => {
  const e = (id, sup, prod) => entry(report(Object.assign({ id, producer: { name: prod || 'ci-check', version: '1' } }, sup ? { supersedes: sup } : {})), 'run1.deploy.' + (prod || 'ci-check') + '.' + id + '.json');
  const chain = X.group('backup-check', [e('aaaa0001'), e('aaaa0002', 'aaaa0001'), e('aaaa0003', 'aaaa0002'), e('bbbb0001', null, 'a-tool')]).list;
  assert.deepStrictEqual(plain(chain.map(g => g.id)), ['bbbb0001', 'aaaa0003', 'aaaa0002', 'aaaa0001']);
  assert.deepStrictEqual(plain(chain.map(g => g.order.superseded)), [false, false, true, true]);
  const rev = X.group('backup-check', [e('aaaa0003', 'aaaa0002'), e('aaaa0001'), e('aaaa0002', 'aaaa0001')]).list;
  assert.deepStrictEqual(plain(rev.map(g => g.id)), ['aaaa0003', 'aaaa0002', 'aaaa0001']);
  const branch = X.group('backup-check', [e('aaaa0001'), e('aaaa0002', 'aaaa0001'), e('aaaa0003', 'aaaa0001')]).list;
  assert.strictEqual(branch.length, 3); assert.ok(branch.some(g => /Two reports say/.test(g.order.note)));
  const loop = X.group('backup-check', [e('aaaa0001', 'aaaa0002'), e('aaaa0002', 'aaaa0001')]).list;
  assert.strictEqual(loop.length, 2); assert.ok(loop.every(g => /loop/.test(g.order.note)));
});

/* ---------- inputs ---------- */
rule('Inputs against the run: match, mismatch, unknown, and untied details named', () => {
  const { r, map } = makeRun(), step = M.findStep(map, 'deploy').step;
  assert.strictEqual(X.applies(cleanOk(report()), r, map, step).result, 'match');
  assert.deepStrictEqual(plain(X.applies(cleanOk(report()), r, map, step).untied), []);
  const t = X.applies(cleanOk(report({ inputs: [{ name: 'Ticket', value: 'ABC-123', source: 'detail:ticket' }] })), r, map, step);
  assert.strictEqual(t.result, 'match'); assert.deepStrictEqual(plain(t.untied), ['ticket']); assert.ok(/isn't tied to ticket/.test(X.appliesText(t)));
  const mis = X.applies(cleanOk(report({ inputs: [{ name: 'Environment', value: 'staging', source: 'detail:env' }] })), r, map, step);
  assert.strictEqual(mis.result, 'mismatch'); assert.ok(/the run's env is prod/.test(X.appliesText(mis)));
  assert.strictEqual(X.applies(cleanOk(report({ inputs: [{ name: 'X', value: '1', source: 'detail:nope' }] })), r, map, step).result, 'mismatch');
  assert.strictEqual(X.applies(cleanOk(report({ inputs: [{ name: 'Region', value: 'east', source: 'external' }] })), r, map, step).result, 'unknown');
  assert.strictEqual(X.applies(cleanOk(report({ inputs: [] })), r, map, step).result, 'unknown');
  const proto = makeRun({ ticket: 'ABC-123', env: 'prod' }); proto.r.details = Object.assign(Object.create({ toString: 'x' }), { ticket: 'ABC-123', env: 'prod' });
  assert.strictEqual(X.applies(cleanOk(report({ inputs: [{ name: 'x', value: 'x', source: 'detail:toString' }] })), proto.r, proto.map, step).result, 'mismatch');
});

/* ---------- eligibility and accepting ---------- */
function groupOf(o, name) { return X.group('backup-check', [entry(o, name)]).list[0]; }
rule('Only the recorder, a pass, the run\'s version, a step a report can check, inputs that don\'t mismatch and the step\'s required evidence', () => {
  const { r, map } = makeRun();
  const ok = (o, extra) => X.eligible(groupOf(o), r, map, Object.assign({ recording: true }, extra || {}));
  assert.ok(ok(report()).ok);
  assert.ok(/recorder/.test(ok(report(), { recording: false }).why));
  assert.ok(/read-only/.test(ok(report(), { readOnly: 'This run is read-only.' }).why));
  assert.ok(/says fail/.test(ok(report({ verdict: 'fail', blockers: ['x'] })).why));
  assert.ok(/v2-zzzz/.test(ok(report({ publication: { folder: 'v2-zzzz' } })).why));
  assert.ok(/doesn't have Build number/.test(ok(report({ evidence: { buildLink: 'https://ci.example.com/1' } })).why));
  assert.ok(/Doesn't match/.test(ok(report({ inputs: [{ name: 'e', value: 'staging', source: 'detail:env' }] })).why));
  assert.ok(/Fill in/.test(ok(report(), { fillOpen: true }).why));
  const v = X.eligible(groupOf(report({ step: 'verify' }), 'run1.verify.ci-check.abcd1234.json'), r, map, { recording: true });
  assert.ok(/linked run/.test(v.why));
  const smoke = X.eligible(groupOf(report({ step: 'smoke', evidence: { evidence: 'javascript:alert(1)' } }), 'run1.smoke.ci-check.abcd1234.json'), r, map, { recording: true });
  assert.strictEqual(smoke.ok, false);
  const ghost = X.eligible(groupOf(report({ step: 'gone' }), 'run1.gone.ci-check.abcd1234.json'), r, map, { recording: true });
  assert.ok(/isn't in the run's version/.test(ghost.why));
  r.paused = { by: 'a', at: AT }; assert.ok(/paused/.test(ok(report()).why)); r.paused = null;
  r.ended = { outcome: 'Completed' }; r.state = 'ended'; assert.ok(/ended/.test(ok(report()).why));
});
rule('Accepting checks the step with exactly the report\'s evidence: earlier values are replaced, never merged or inherited', () => {
  const { r, map } = makeRun();
  R.done(r, map, 'deploy', 'person-avery', AT, { build: '1000', buildLink: 'https://ci.example.com/1000' });
  const e = X.eligible(groupOf(report({ evidence: { build: '1432', extra: 'not recorded' } })), r, map, { recording: true });
  assert.ok(e.ok); assert.deepStrictEqual(plain(e.unused), ['extra']);
  assert.deepStrictEqual(plain(e.replaces.map(x => x.name)), ['build', 'buildLink']);
  R.done(r, map, 'deploy', 'person-avery', LATER, e.values, { exact: true });
  assert.deepStrictEqual(plain(r.steps.deploy.values), { build: '1432' });
  // Without exact, the old merge stays as it was for every other answer.
  R.done(r, map, 'deploy', 'person-avery', LATER, { build: '7' });
  assert.deepStrictEqual(plain(r.steps.deploy.values), { build: '7' });
});
rule('The log line names the report and its SHA-256, and reads back; a long step text is cut, the hash never', () => {
  const g = groupOf(report()), sha = 'a'.repeat(64);
  const l = X.logLine(g, sha, 'Deploy');
  assert.strictEqual(l, 'Accepted report ci-check/abcd1234 sha256:' + sha + ' (says pass) for "Deploy"');
  assert.deepStrictEqual(plain(X.parseLog(l)), { producer: 'ci-check', id: 'abcd1234', sha256: sha });
  const long = X.logLine(g, sha, 'x'.repeat(1000));
  assert.ok(long.length <= 300); assert.ok(X.parseLog(long));
  assert.strictEqual(X.parseLog('Accepted report X/abcd1234 sha256:' + sha + ' (says pass) for "x"'), null);
  assert.strictEqual(X.parseLog(null), null);
});

/* ---------- decisions ---------- */
rule('Decisions: written once per rev, named by the report\'s identity, read back only when the name matches what\'s inside', () => {
  const g = groupOf(report()), sha = g.sha256;
  const d = X.decision(g, sha, 'declined', 'person-avery', AT, null, { reason: '  wrong   build ' });
  assert.strictEqual(d.reason, 'wrong build'); assert.strictEqual(d.rev, 1); assert.strictEqual(d.seen, null);
  const name = X.decisionName(d, 'w-avery');
  assert.ok(new RegExp('^run1\\.[0-9a-f]{8}\\.w-avery\\.1\\.json$').test(name));
  const back = X.cleanDecision(JSON.parse(JSON.stringify(d)), 'backup-check', name);
  assert.ok(back.ok, back.why); assert.strictEqual(back.d.key, g.key);
  assert.strictEqual(X.cleanDecision(JSON.parse(JSON.stringify(d)), 'backup-check', name.replace('.1.json', '.2.json')).ok, false);
  assert.strictEqual(X.cleanDecision(JSON.parse(JSON.stringify(d)), 'other', name).ok, false);
  assert.strictEqual(X.cleanDecision(Object.assign({ extra: 1 }, d), 'backup-check', name).ok, false);
  assert.strictEqual(X.cleanDecision(Object.assign({}, d, { format: 'flightdeck-report-decision/2' }), 'backup-check', name).kind, 'newer');
  assert.throws(() => X.decision(g, sha, 'declined', 'person-avery', AT, null, {}), /Say why/);
  assert.throws(() => X.decision(g, sha, 'accepted', 'person-avery', AT, null, {}), /names the answer/);
  assert.throws(() => X.decision(g, 'nothex', 'open', 'person-avery', AT, null), /can't be decided/);
  const two = X.decision(g, sha, 'open', 'person-avery', LATER, back.d);
  assert.strictEqual(two.rev, 2); assert.strictEqual(two.seen, name);
});
rule('Hostile decision files never throw and never read as decisions', () => {
  const g = groupOf(report()), d = X.decision(g, g.sha256, 'open', 'person-avery', AT, null), name = X.decisionName(d, 'w1');
  const vals = [null, 0, 1e999, -1, 1.5, '', 'x', true, [], {}, { toString: null }];
  X.DKEYS.forEach(k => vals.forEach(v => { const o = Object.assign({}, d); o[k] = v; const c = X.cleanDecision(o, 'backup-check', name); assert.ok(typeof c.ok === 'boolean'); }));
  [null, [], 'x', 7].forEach(v => assert.strictEqual(X.cleanDecision(v, 'backup-check', name).ok, false));
});
rule('The current decision is the highest rev; two at the same rev are a tie, shown as Needs review', () => {
  const g = groupOf(report()), mk = (rev, w, status) => { const d = X.decision(g, g.sha256, status, 'p', AT, rev > 1 ? { rev: rev - 1 } : null, { reason: 'r' }); return X.cleanDecision(JSON.parse(JSON.stringify(d)), 'backup-check', X.decisionName(d, w)).d; };
  const cur = X.current([mk(1, 'w1', 'declined'), mk(2, 'w1', 'open')]);
  assert.strictEqual(cur[g.key].d.status, 'open'); assert.strictEqual(cur[g.key].tie, false);
  const tie = X.current([mk(2, 'w1', 'open'), mk(2, 'w2', 'declined')]);
  assert.ok(tie[g.key].tie); assert.strictEqual(X.decided(g, tie, null, null).state, 'tie');
  assert.strictEqual(X.current([mk(2, 'w2', 'declined'), mk(2, 'w1', 'open')])[g.key].d._file, tie[g.key].d._file);
});
rule('After acceptance: still accepted, evidence changed (Fill in), answered again since, or the accepted bytes are gone', () => {
  const { r, map } = makeRun(), g = groupOf(report()), step = M.findStep(map, 'deploy').step;
  const e = X.eligible(g, r, map, { recording: true });
  R.done(r, map, 'deploy', 'person-avery', LATER, e.values, { exact: true });
  const fp = X.fingerprint(r.steps.deploy.values, e.schema);
  assert.ok(X.landed(r, { step: 'deploy', at: LATER, by: 'person-avery', fp, schema: e.schema }));
  const d = X.decision(g, g.sha256, 'accepted', 'person-avery', LATER, null, { inputs: 'match', answer: { at: LATER, by: 'person-avery', fp } });
  const cur = X.current([X.cleanDecision(JSON.parse(JSON.stringify(d)), 'backup-check', X.decisionName(d, 'w1')).d]);
  assert.strictEqual(X.decided(g, cur, r, step).state, 'accepted');
  r.steps.deploy.values = { build: '9999' };
  r.log.push({ at: '2026-10-20T11:00:00.000Z', by: 'person-blake', what: 'Filled in Deploy' });
  const ch = X.decided(g, cur, r, step);
  assert.strictEqual(ch.state, 'changed'); assert.ok(/person-blake/.test(ch.text));
  R.done(r, map, 'deploy', 'person-avery', '2026-10-20T12:00:00.000Z', { build: '1' });
  assert.strictEqual(X.decided(g, cur, r, step).state, 'again');
  const other = groupOf(report({ summary: 'changed bytes' }));
  assert.strictEqual(X.decided(other, cur, r, step).state, 'gone');
  assert.strictEqual(X.decided(g, {}, r, step).state, 'none');
});
rule('The fingerprint is canonical: key order never matters, a value or the evidence schema changing does', () => {
  const s = [['build', 'text', true]];
  assert.strictEqual(X.fingerprint({ a: '1', b: '2' }, s), X.fingerprint({ b: '2', a: '1' }, s));
  assert.notStrictEqual(X.fingerprint({ a: '1' }, s), X.fingerprint({ a: '2' }, s));
  assert.notStrictEqual(X.fingerprint({ a: '1' }, s), X.fingerprint({ a: '1' }, [['build', 'text', false]]));
  assert.ok(/^[0-9a-f]{64}$/.test(X.fingerprint({}, [])));
});
rule('An acceptance logged in the run but never recorded is recoverable only from a copy with exactly the logged bytes', () => {
  const { r, map } = makeRun(), g = groupOf(report());
  const e = X.eligible(g, r, map, { recording: true });
  R.done(r, map, 'deploy', 'person-avery', LATER, e.values, { exact: true });
  r.log.push({ at: LATER, by: 'person-avery', what: X.logLine(g, g.sha256, 'Deploy') });
  const u = X.unrecorded(r, [g], {});
  assert.strictEqual(u.length, 1); assert.ok(u[0].recordable);
  const changed = X.group('backup-check', [entry(report({ summary: 'edited later' }))]).list;
  assert.strictEqual(X.unrecorded(r, changed, {})[0].recordable, false);
  const d = X.decision(g, g.sha256, 'accepted', 'person-avery', LATER, null, { inputs: 'match', answer: { at: LATER, by: 'person-avery', fp: X.fingerprint(r.steps.deploy.values, e.schema) } });
  const cur = X.current([X.cleanDecision(JSON.parse(JSON.stringify(d)), 'backup-check', X.decisionName(d, 'w1')).d]);
  assert.strictEqual(X.unrecorded(r, [g], cur).length, 0);
  R.done(r, map, 'deploy', 'person-avery', '2026-10-20T12:00:00.000Z', { build: '1' });
  assert.strictEqual(X.unrecorded(r, [g], {}).length, 0);
});

rule('Recovery finds the report by the step that still holds the logged answer, when one id is used on two steps', () => {
  const { r, map } = makeRun();
  const ga = groupOf(report()), smoke = report({ step: 'smoke', evidence: { evidence: 'https://ci.example.com/smoke' } }), gb = X.group('backup-check', [entry(smoke, 'run1.smoke.ci-check.abcd1234.json')]).list[0];
  const e = X.eligible(gb, r, map, { recording: true });
  assert.ok(e.ok, e.why);
  R.done(r, map, 'smoke', 'person-avery', LATER, e.values, { exact: true });
  r.log.push({ at: LATER, by: 'person-avery', what: X.logLine(gb, gb.sha256, 'Smoke') });
  [[ga, gb], [gb, ga]].forEach(gs => {
    const u = X.unrecorded(r, gs, {});
    assert.strictEqual(u.length, 1);
    assert.deepStrictEqual([u[0].g.step, u[0].recordable], ['smoke', true], 'whatever order the groups come in');
  });
});

/* ---------- command line and Home ---------- */
rule('Checking a report against its run: errors for another version or step, warnings for what a person can\'t accept or won\'t use', () => {
  const { r, map } = makeRun();
  assert.deepStrictEqual(plain(X.target(cleanOk(report()), r, map)).errors, []);
  assert.strictEqual(X.target(cleanOk(report()), r, map).applies, 'yes');
  assert.ok(X.target(cleanOk(report({ publication: { folder: 'v9-zzzz' } })), r, map).errors.length);
  const w = X.target(cleanOk(report({ evidence: { build: '1', other: 'x' }, verdict: 'fail', blockers: ['x'], inputs: [{ name: 't', value: 'ABC-123', source: 'detail:ticket' }] })), r, map);
  assert.ok(w.warnings.some(x => /other isn't something/.test(x)));
  assert.ok(w.warnings.some(x => /only a pass/.test(x)));
  assert.ok(w.warnings.some(x => /isn't tied to ticket/.test(x)));
  assert.ok(X.holdsKey('-----BEGIN OPENSSH PRIVATE KEY-----')); assert.ok(!X.holdsKey('{}'));
});
rule('Home counts undecided reports by name alone, on runs this person records only', () => {
  const f = (id, run) => ({ process: 'backup-check', run: run || 'run1', step: 'deploy', producer: 'ci-check', id });
  const g = groupOf(report()), d = X.decision(g, g.sha256, 'declined', 'p', AT, null, { reason: 'no' });
  const cur = X.current([X.cleanDecision(JSON.parse(JSON.stringify(d)), 'backup-check', X.decisionName(d, 'w')).d]);
  const runs = Object.create(null); runs['backup-check/run1'] = true;
  assert.deepStrictEqual(plain(X.undecided([f('abcd1234'), f('abcd0000'), f('abcd0000'), f('abcd5555', 'run2')], cur, runs)), { 'backup-check/run1': 1 });
});

/* ---------- the folder ---------- */
const repo = PF.repo;
function memFolder(files) { const fs = new PF.fs.MemoryFS('rep:' + Math.random(), null); Object.keys(files || {}).forEach(p => { fs.files[p] = { t: files[p], m: 1 }; }); return fs; }
function counting(fs) { const calls = []; const w = Object.create(fs); ['list', 'read', 'stat', 'blob'].forEach(m => { w[m] = (p, o) => { calls.push(m + ' ' + p); return fs[m](p, o); }; }); w.calls = calls; return w; }
rule('Loading lists report names and decisions only where those folders are, reads no report contents, and never for flightdeck-read/1', async () => {
  const t = JSON.stringify(report());
  const g = groupOf(report()), d = X.decision(g, g.sha256, 'declined', 'person-avery', AT, null, { reason: 'Wrong build' }), dn = X.decisionName(d, 'w-avery');
  const fs = counting(memFolder({ ['reports/backup-check/' + NAME]: t, 'reports/backup-check/notes.txt': 'x', 'reports/backup-check/odd.json': '{}', ['report-decisions/backup-check/' + dn]: JSON.stringify(d, null, 2) + '\n', 'report-decisions/backup-check/run1.00000000.w-x.1.json': '{"format":"flightdeck-report-decision/7"}' }));
  const all = await repo.loadAll(fs);
  assert.deepStrictEqual(plain(all.reports.files.map(f => f.name)), [NAME]);
  assert.deepStrictEqual(plain(all.reports.bad.map(b => b.path)), ['reports/backup-check/odd.json']);
  assert.strictEqual(all.repDecisions.length, 1); assert.strictEqual(all.repDecisions[0].status, 'declined');
  assert.strictEqual(all.repUnread.length, 1); assert.strictEqual(all.repUnread[0].kind, 'newer');
  assert.ok(all.refused.some(x => x.family === 'flightdeck-report-decision'));
  assert.ok(!fs.calls.some(c => /^(read|blob) reports\//.test(c)), fs.calls.join('\n'));
  const plainFs = counting(memFolder({ 'people.json': '[]' }));
  await repo.loadAll(plainFs);
  assert.ok(!plainFs.calls.some(c => /reports/.test(c)), 'an ordinary folder costs nothing more');
  const ro = await repo.loadAll(memFolder({ ['reports/backup-check/' + NAME]: t }), { readOnly: true });
  assert.deepStrictEqual(plain(ro.reports.files), []);
});
rule('A run\'s reports are read as bytes: too big, not UTF-8 and unreadable files are named, never taken as absent', async () => {
  const t = JSON.stringify(report());
  const fs = memFolder({ ['reports/backup-check/' + NAME]: t, 'reports/backup-check/run1.deploy.ci-check.bbbb2222.json': JSON.stringify(report({ id: 'bbbb2222', summary: 'x'.repeat(400) + 'y'.repeat(70000) })), 'reports/backup-check/run2.deploy.ci-check.cccc3333.json': t });
  const got = await repo.loadRunReports(fs, 'backup-check', 'run1');
  assert.strictEqual(got.list.length, 2);
  const big = got.list.filter(x => x.id === 'bbbb2222')[0];
  assert.strictEqual(big.report, null); assert.strictEqual(big.unreadable[0].kind, 'skipped');
  const good = got.list.filter(x => x.id === 'abcd1234')[0];
  assert.strictEqual(good.sha256, PF.sha256.hex(bytes(t)));
  const failing = Object.create(fs); failing.blob = () => Promise.reject(new Error('locked'));
  const f2 = await repo.loadRunReports(failing, 'backup-check', 'run1');
  assert.ok(f2.list.every(x => !x.report && x.unreadable[0].kind === 'unreadable'));
  const unlisted = Object.create(fs); unlisted.list = () => Promise.reject(new Error('offline'));
  assert.ok((await repo.loadRunReports(unlisted, 'backup-check', 'run1')).failed);
  assert.deepStrictEqual(plain((await repo.loadRunReports(fs, '../x', 'run1')).list), []);
});
rule('A decision on a report is written once and read back; the same bytes again succeed, different ones are refused', async () => {
  const fs = memFolder({}), g = groupOf(report()), d = X.decision(g, g.sha256, 'declined', 'person-avery', AT, null, { reason: 'Wrong build' });
  const path = await repo.decideReport(fs, d, 'w-avery');
  assert.strictEqual(path, 'report-decisions/backup-check/' + X.decisionName(d, 'w-avery'));
  assert.strictEqual(await repo.decideReport(fs, d, 'w-avery'), path);
  await assert.rejects(repo.decideReport(fs, Object.assign({}, d, { reason: 'Other' }), 'w-avery'), /already in the folder/);
  await assert.rejects(repo.decideReport(fs, Object.assign({}, d, { process: '../x' }), 'w-avery'), /can't be decided/);
  await assert.rejects(repo.decideReport(fs, d, '../w'), /can't be decided/);
  const lossy = memFolder({}); lossy.write = (p, t) => { lossy.files[p] = { t: t.replace('Wrong', 'Right'), m: 1 }; return Promise.resolve(); };
  await assert.rejects(repo.decideReport(lossy, d, 'w-avery'), /didn't read back/);
});

rule('Folder health names reports that can\'t be read, newer ones, copies that differ and reports for a run that isn\'t here; copies are never OneDrive "copies" issues', async () => {
  const t = JSON.stringify(report());
  const fs = memFolder({ 'people.json': '[]', ['reports/backup-check/' + NAME]: t, 'reports/backup-check/run1.deploy.ci-check.abcd1234-LAPTOP.json': JSON.stringify(report({ summary: 'other' })),
    'reports/backup-check/run1.deploy.ci-check.dddd4444.json': '{"format":"flightdeck-report/1"', 'reports/backup-check/run1.deploy.ci-check.eeee5555.json': JSON.stringify(report({ id: 'eeee5555', format: 'flightdeck-report/3' })),
    'reports/backup-check/odd.json': '{}' });
  const d = await repo.loadAll(fs), scan = await repo.scan(fs), rep = PF.health.check({ data: d, scan, me: 'person-avery', app: '2.0.0' }, Date.parse(AT));
  const i = rep.issues.find(x => x.id === 'reports');
  assert.ok(i, JSON.stringify(rep.issues.map(x => x.id)));
  ['reports/backup-check/run1.deploy.ci-check.dddd4444.json', 'reports/backup-check/odd.json', 'reports/backup-check/' + NAME, 'reports/backup-check/run1.deploy.ci-check.abcd1234-LAPTOP.json'].forEach(p => assert.ok(i.paths.indexOf(p) >= 0, p));
  assert.ok(/copies that differ/.test(i.detail) && /isn't in the folder/.test(i.detail), i.detail);
  const newer = rep.issues.find(x => x.id === 'newer');
  assert.ok(newer && newer.paths.indexOf('reports/backup-check/run1.deploy.ci-check.eeee5555.json') >= 0 && /1 report needs/.test(newer.detail), newer && newer.detail);
  assert.ok(!rep.issues.some(x => x.id === 'copies' && x.paths.some(p => /^reports\//.test(p))));
  assert.ok(!i.paths.some(p => /eeee5555/.test(p)), 'a newer report is named once, as newer');
});

run();
