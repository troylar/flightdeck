// Tests the pure logic (the <script id="pf-core"> block) of the built single file.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'preflight.html'), 'utf8');
const block = id => { const m = new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>').exec(html); assert.ok(m, 'missing script ' + id); return m[1]; };
const ctx = { module: { exports: {} } }; vm.createContext(ctx); vm.runInContext(block('pf-core'), ctx);
const PF = ctx.module.exports;
new vm.Script(block('pf-ui')); // syntax check of the UI script
let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); } }
const tdir = path.join(__dirname, '..', 'example-folder', 'templates');
const tpl = n => fs.readFileSync(path.join(tdir, n + '.md'), 'utf8');
const NOW = '2026-10-17T15:30:00.000Z';

test('single file has no external resources', () => {
  assert.ok(!/<script[^>]+src=/i.test(html), 'external script');
  assert.ok(!/<link[^>]+stylesheet/i.test(html), 'external stylesheet');
  assert.ok(!/fonts\.googleapis|cdnjs|jsdelivr|unpkg/.test(html), 'CDN reference');
});
test('example templates parse with no blockers', () => {
  fs.readdirSync(tdir).forEach(f => { const t = PF.parse(fs.readFileSync(path.join(tdir, f), 'utf8')); assert.deepStrictEqual(Array.from(PF.blockers(t)), [], f); });
});
test('parse reads kinds, bindings, notes and shots', () => {
  const t = PF.parse(tpl('release'));
  assert.strictEqual(t.sections.length, 3);
  assert.deepStrictEqual(Array.from(t.meta.ctx), ['ticket', 'commit', 'environment']);
  const s0 = t.sections[0], s1 = t.sections[1];
  assert.strictEqual(s0.mode, 'DO-CONFIRM');
  assert.strictEqual(s0.items[1].kind, 'must');
  assert.deepStrictEqual(Array.from(s0.items[1].binds), ['commit']);
  assert.ok(!/\^commit/.test(s0.items[1].text));
  assert.ok(s0.items[1].note.indexOf('rebase') > 0);
  assert.strictEqual(s1.items[2].kind, 'auto');
  assert.strictEqual(s1.items[2].shots[0].src, 'shot:pipeline');
});
test('unknown syntax, unknown bindings and open questions block a template', () => {
  const md = '---\ntitle: T\ncontext: a\n---\n## P · READ-DO\n- [ ] one\n- [x] critical check\n- [ ] tied ^b\n## Questions for the owner\n- [ ] what?';
  const b = PF.blockers(PF.parse(md));
  assert.ok(b.some(x => /isn't understood/.test(x)), 'skipped line');
  assert.ok(b.some(x => /\^b/.test(x)), 'binding');
  assert.ok(b.some(x => /open questions/.test(x)), 'questions');
  assert.strictEqual(PF.parse(md).sections.length, 1, 'questions are not a pause point');
});
test('image paths cannot escape the folder', () => {
  const t = PF.parse('---\ntitle: T\n---\n## P · READ-DO\n- [ ] a\n  ![x](images/../secret.png)');
  assert.strictEqual(t.sections[0].items[0].shots.length, 0);
  assert.ok(PF.blockers(t).length > 0);
});
function release() { return PF.newRun('release', tpl('release'), 'Avery', NOW, 'abc123'); }
test('new run gets an immutable, unique file name and a readable title', () => {
  const r = release();
  assert.strictEqual(r.file, '20261017T1530Z__release__abc123.json');
  assert.ok(/^Production release · /.test(r.name));
  assert.deepStrictEqual(Array.from(r.recorders), ['Avery']);
});
test('a pause point needs every step answered; must-dos cannot be N/A', () => {
  const r = release(), t = PF.parse(r.snapshot);
  assert.ok(!PF.canCall(r, t, 0));
  for (let i = 0; i < 5; i++) r.checks['0.' + i] = { s: 'na', reason: 'Not applicable', by: 'Avery', at: NOW };
  assert.ok(!PF.canCall(r, t, 0), 'N/A on must-dos must not count');
  for (let i = 0; i < 4; i++) r.checks['0.' + i] = { s: 'done', by: 'Avery', at: NOW };
  assert.ok(PF.canCall(r, t, 0));
  assert.ok(!PF.canCall(r, t, 1), 'next section stays locked');
});
test('unchecking after a call reopens that pause point and the ones after it', () => {
  const r = release(), t = PF.parse(r.snapshot);
  for (let i = 0; i < 5; i++) r.checks['0.' + i] = { s: 'done', by: 'A', at: NOW };
  r.called[0] = { by: 'A', at: NOW };
  delete r.checks['0.2']; PF.normalize(r, t);
  assert.ok(!r.called[0]);
});
test('changing a run detail sends tied answers back for a re-check', () => {
  const r = release(), t = PF.parse(r.snapshot);
  r.checks['0.1'] = { s: 'done', by: 'A', at: NOW };
  r.checks['1.1'] = { s: 'done', by: 'A', at: NOW };
  r.checks['0.4'] = { s: 'done', by: 'A', at: NOW };
  r.auto['1.2'] = 'pass';
  assert.strictEqual(PF.setContext(r, t, 'commit', 'abc', 'A', NOW), 2, 'blank to value invalidates');
  assert.strictEqual(r.checks['0.1'].s, 'recheck');
  assert.strictEqual(r.checks['0.4'].s, 'done', 'untied step untouched');
  assert.strictEqual(PF.setContext(r, t, 'commit', '  abc  ', 'A', NOW), 0, 'whitespace is not a change');
});
test('changing a tied detail clears a recorded automation result', () => {
  const t = PF.parse('---\ntitle: T\ncontext: commit\n---\n## P · READ-DO\n- [auto] gate ^commit');
  const r = PF.newRun('t', '---\ntitle: T\ncontext: commit\n---\n## P · READ-DO\n- [auto] gate ^commit', 'A', NOW, 'x');
  r.ctx.commit = 'a'; r.auto['0.0'] = 'pass';
  PF.setContext(r, t, 'commit', 'b', 'A', NOW);
  assert.ok(!r.auto['0.0']);
});
test('title follows the first run detail until renamed', () => {
  const r = PF.newRun('check-in', tpl('check-in'), 'A', NOW, 'x'), t = PF.parse(r.snapshot);
  PF.setContext(r, t, 'branch', 'feature/login', 'A', NOW);
  assert.strictEqual(r.name, 'Check in code · feature/login');
  r.nameCustom = true; r.name = 'Mine'; PF.setContext(r, t, 'branch', 'other', 'A', NOW);
  assert.strictEqual(r.name, 'Mine');
});
test('Completed requires every pause point called; stopping early is always allowed', () => {
  const r = release(), t = PF.parse(r.snapshot);
  assert.ok(!PF.canEnd(r, t, 'Completed'));
  assert.ok(PF.canEnd(r, t, 'Stopped early'));
  r.called = { 0: {}, 1: {}, 2: {} };
  assert.ok(PF.canEnd(r, t, 'Completed'));
});
test('a blocked step stops the run; an abandoned run never looks complete', () => {
  const r = release(), t = PF.parse(r.snapshot);
  r.checks['0.0'] = { s: 'blocked', reason: 'Failed', by: 'A', at: NOW };
  assert.strictEqual(PF.decision(r, t).s, 'stopped');
  r.ended = { outcome: 'Abandoned', by: 'A', at: NOW };
  assert.strictEqual(PF.decision(r, t).s, 'stopped');
  r.ended.outcome = 'Completed';
  assert.strictEqual(PF.decision(r, t).s, 'complete');
});
test('reopen clears that call and later calls but keeps answers', () => {
  const r = release();
  r.called = { 0: {}, 1: {}, 2: {} }; r.checks['1.0'] = { s: 'done' };
  PF.reopen(r, 1);
  assert.deepStrictEqual(Object.keys(r.called), ['0']);
  assert.ok(r.checks['1.0']);
});
test('Markdown is escape-first: no raw HTML, no javascript links', () => {
  assert.ok(!/<img/.test(PF.mdInline('<img src=x onerror=alert(1)>')));
  assert.ok(!/<button/.test(PF.mdBlock('<button data-call="0">go</button>')));
  assert.ok(!/href/.test(PF.mdInline('[x](javascript:alert(1))')));
  assert.ok(/href="https:\/\/example.com"/.test(PF.mdInline('[x](https://example.com)')));
  assert.strictEqual(PF.mdInline('**b** and `c<d>`'), '<strong>b</strong> and <code>c&lt;d&gt;</code>');
});
test('Jira text lists every step state and leaves out paths and notes', () => {
  const r = release(), t = PF.parse(r.snapshot);
  r.checks['0.0'] = { s: 'done', by: 'A', at: NOW };
  r.checks['0.4'] = { s: 'na', reason: 'Not applicable', by: 'A', at: NOW };
  r.checks['1.0'] = { s: 'blocked', reason: 'Failed', by: 'A', at: NOW };
  r.proposed = { '1.0': [{ file: 'proposals/x.png', by: 'A', at: NOW }] };
  const s = PF.summaryText(r, t, NOW);
  ['[DONE]', '[N/A]', '[BLOCKED - Failed]', '[NOT CHECKED]', 'Run ID: abc123', 'Status: In progress'].forEach(x => assert.ok(s.indexOf(x) >= 0, x));
  assert.ok(s.indexOf('proposals/') < 0 && s.indexOf('rebase') < 0);
});
test('Mine means runs I have recorded', () => {
  const r = release();
  assert.ok(PF.isMine(r, 'Avery'));
  assert.ok(!PF.isMine(r, 'Blake'));
  r.recorders.push('Blake'); r.lead = 'Blake';
  assert.ok(PF.isMine(r, 'Avery') && PF.isMine(r, 'Blake'));
});
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
