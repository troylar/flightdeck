// Round 18: the write-time guard can't be skipped. Every writer of an authority-bearing record in the app (a loop's parent
// changed through loopEdit, a scope record or decision, a run saved) names its fresh guard where it is called, so a writer
// added later without one fails here, before a reviewer has to find it.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { rule, run } = require('./harness');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');

/* Every call of name( in the app (not its definition): where it is, the text of its arguments (balanced, strings and comments
   skipped), and the function it is in. */
function calls(name) {
  const out = [], re = new RegExp('(^|[^A-Za-z0-9_.$])' + name.replace(/[.(]/g, '\\$&'), 'g');
  let m;
  while ((m = re.exec(SRC))) {
    const at = m.index + m[1].length, open = at + name.length - 1;
    if (/function\s+$/.test(SRC.slice(Math.max(0, at - 12), at))) continue;
    let depth = 0, i = open, q = null;
    for (; i < SRC.length; i++) {
      const c = SRC[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '\'' || c === '"') { q = c; continue; }
      if (c === '/' && SRC[i + 1] === '*') { i = SRC.indexOf('*/', i + 2) + 1; continue; }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) break;
    }
    const line = SRC.slice(0, at).split('\n').length, before = SRC.slice(0, at).split('\n');
    let fn = '';
    for (let k = before.length - 1; k >= 0 && !fn; k--) { const f = /^ {2}function ([A-Za-z0-9_]+)\(|^ {4}'?([A-Za-z0-9_-]+)'?: function/.exec(before[k]); if (f) fn = f[1] || f[2]; }
    out.push({ line, args: SRC.slice(open + 1, i), fn, start: at, end: i });
  }
  return out;
}

rule('Every loopEdit names its fresh guard: the approval snapshot or the fresh guard on the runs it depends on', () => {
  const all = calls('loopEdit(');
  assert.ok(all.length >= 9, 'the inventory found the loop writes: ' + all.length);
  const bad = all.filter(c => !/guard: 'snapshot'|freshKeys: /.test(c.args)).map(c => 'app.js:' + c.line + ' (' + c.fn + ')');
  assert.deepStrictEqual(bad, []);
});
rule('A loopEdit without a guard refuses in the app and throws in a test build', () => {
  const def = SRC.slice(SRC.indexOf('function loopEdit('), SRC.indexOf('function loopEdit(') + 1500);
  assert.ok(/if \(!cx \|\| \(!snap && !keyed\)\) \{/.test(def), 'the refusal comes first');
  assert.ok(/FLIGHTDECK_STRICT_GUARDS\) throw/.test(def), 'a test build throws');
  assert.ok(/still: function \(\) \{ return false; \}/.test(def), 'the app writes nothing');
});
rule('Every change that approves, sends back, passes, waives, lands a to-do or keeps a copy is made inside a guarded loopEdit', () => {
  const edits = calls('loopEdit(').filter(c => /guard: 'snapshot'|freshKeys: /.test(c.args));
  const re = /R\.(pass|waive|unsettleLoop|todoLand|adopt)\(|_loop: \{ ok: true/g, bad = [];
  let m;
  while ((m = re.exec(SRC))) if (!edits.some(e => m.index > e.start && m.index < e.end)) bad.push('app.js:' + SRC.slice(0, m.index).split('\n').length + ' ' + m[0]);
  assert.deepStrictEqual(bad, []);
});
rule('Every scope record goes through scopeSave, and each names its fresh guard or only reports a guarded write', () => {
  assert.strictEqual(calls('repo.saveScope(').map(c => c.fn).join(), 'scopeSave', 'repo.saveScope is called only by scopeSave');
  const all = calls('scopeSave(');
  assert.ok(all.length >= 7, 'the inventory found the scope writes: ' + all.length);
  const bad = all.filter(c => !/recheck: /.test(c.args) && !(c.fn === 'loopOutcome' && c.args.indexOf('opts') >= 0)).map(c => 'app.js:' + c.line + ' (' + c.fn + ')');
  assert.deepStrictEqual(bad, []);
  const lo = SRC.slice(SRC.indexOf('function loopOutcome('), SRC.indexOf('function scopeSave('));
  assert.ok(/if \(resolves\) opts\.recheck = function \(fs\) \{ return [^;]*freshGuard\(/.test(lo) && /else opts\.report = true;/.test(lo), 'a resolution asks the fresh guard; only an outcome report is exempt');
  const ss = SRC.slice(SRC.indexOf('function scopeSave('), SRC.indexOf('function scopeSave(') + 600);
  assert.ok(/typeof opts\.recheck !== 'function' && opts\.report !== true/.test(ss) && /dropped: true/.test(ss), 'scopeSave refuses a write with neither');
});
/* The run saves: save() (every mutateRun, so every loopEdit) and a loop's child run ask their guards; the rest each make a new
   run that decides nothing about another record. A new site has to be added here, with why. */
const NEW_RUNS = {
  launchChild: 'a linked child run started from its form',
  continueTwo: 'a run continued as a Flightdeck 2.0 run',
  csHarvest: 'a run started from the start form'
};
rule('Every run save is the guarded save(), a loop child with its fresh guard, or a listed new run', () => {
  const all = calls('repo.saveRun(');
  const bad = all.filter(c => !(c.fn === 'save' || (c.fn === 'loopLaunch' && /recheck: recheck/.test(c.args)) || NEW_RUNS[c.fn])).map(c => 'app.js:' + c.line + ' (' + c.fn + ')');
  assert.deepStrictEqual(bad, []);
  assert.deepStrictEqual(Object.keys(NEW_RUNS).filter(f => !all.some(c => c.fn === f)), [], 'every listed new run is still a real site');
});

run();
