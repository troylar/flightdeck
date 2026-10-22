// The reader lint (docs/design.md section 28): every place the app, the storage code or the command parses JSON follows the
// value it gets to where it's used, and must reach one of the shared checked readers (a cleaner that takes the envelope's
// verdict) before any field of it is read. Known raw consumers are listed by name with why. It's a lint, not the boundary:
// the boundary is the probe folder (test/fixtures/v2/probes/) that test/compat-bridge.test.js runs through every real reader.
//   node tools/readers.js     list every parse site and what it reaches; exit 1 on a site that reads fields first
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
/* The checked readers: a value that reaches one of these first is judged before it's read. */
const CLEANERS = ['R.sanitize', 'R.cleanCopy', 'R.cleanArchive', 'R.isPlaceholder', 'R.repairs', 'R.unexplained', 'PF.run.sanitize', 'PF.people.clean', 'PF.people.verdict', 'P.verify',
  'PF.publish.verify', 'cleanDecision', 'F.verdict', 'PF.followups.verdict', 'PF.corrections.verdict', 'PP.check', 'PP.cleanRecord', 'PF.proposals.cleanRecord', 'PP.cleanPresence', 'CN.clean',
  'TL.cleanEntry', 'PF.types.checkCustom', 'PF.skills.check', 'PF.skills.checkV2', 'PF.skills.registration', 'PF.jira.check', 'PF.contract.cleanInstalled', 'PF.plans.clean', 'PF.skills.cleanValidation', 'cleanNote', 'E.notesFile', 'P.newerOf', 'U.drift', 'fuDrift', 'ok', 'noteOf', 'cleanValue', 'X.clean'];
/* Raw consumers, by a piece of the line, with why they may read what they parse. */
const RAW = [
  { file: 'bin/flightdeck.js', has: "o = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.buf));", why: 'skill register reads the name and process only to choose which files to load; PF.skills.registration checks the whole input before anything is written' },
  { file: 'bin/flightdeck.js', has: 'try { o = JSON.parse(snap.text); }', why: 'report check and write read the input only to fill a missing id or created; PF.reports.clean then checks the whole report before anything is written' },
  { file: 'src/core/run.js', has: 'snapshot: JSON.parse(text)', why: 'a copy of a skill snapshot this function just checked and wrote out itself (at most 2 KB), not a file' },
  { file: 'src/storage/repo.js', has: "var o = json(text); if (!o || typeof o !== 'object') return '\\u0000' + text;", why: 'compares two saves of one run by their bytes, never reads a field for meaning' },
  { file: 'src/storage/repo.js', has: 'types: json(tj)', why: 'a copy of a run\'s types this window already sanitized (intern), not a file' },
  { file: 'src/storage/repo.js', has: "readJson(fs, 'runs/' + i.name)", why: 'v0.1 runs (preflight-run/1): the legacy lister checks the format before reading a field' },
  { file: 'src/storage/repo.js', has: 'if (!bad) return readJson(fs, path)', why: 'loadJsonDir: the caller\'s ok() dispatch check runs before the record is kept; each caller then uses its family\'s cleaner (PF.plans.clean, PF.skills.cleanValidation)' },
  { file: 'src/storage/repo.js', has: "info = f && json(f.text)", why: 'pubProblem: shape checked, then P.newerOf (the envelope) before any other field' },
  { file: 'src/storage/repo.js', has: "if (o.explain) { var raw = json(res[0].text)", why: 'R.repairs and R.unexplained (the run\'s own checked reader for other apps)' },
  { file: 'src/storage/repo.js', has: 'var why0 = misplaced(json(res[0].text), run, proc, id);', why: 'the run\'s own process, as written, compared with its folder\'s name only (the run itself is read by R.sanitize)' },
  { file: 'src/storage/repo.js', has: "elsewhere(json(t[0]), proc, m.key.split('/')[1])", why: 'Evidence: the run\'s own process and ID compared with its folder\'s names only (the run itself is read by R.sanitize)' },
  { file: 'src/storage/repo.js', has: "why: json(res[0].text) === undefined", why: 'only tells unparsable from unreadable, in a message' },
  { file: 'src/storage/repo.js', has: "var o = res[0] && json(res[0].text)", why: 'loadRun\'s fingerprint read: passed to R.sanitize' },
  { file: 'src/storage/repo.js', has: 'var disk = R.sanitize', why: 'R.sanitize' },
  { file: 'src/storage/repo.js', has: "var x = line.trim() && json(line)", why: 'run archives: R.cleanArchive, line by line' },
  { file: 'src/storage/repo.js', has: "var o = json(r.text);", why: 'Folder health\'s scan: installed.json through PF.contract.cleanInstalled, replaced-*.json through R.isPlaceholder; others only whether they parse' },
  { file: 'src/storage/repo.js', has: 'function detach(o)', why: 'Evidence: a copy of a value already cleaned' },
  { file: 'src/storage/repo.js', has: 'created = o && typeof o === \'object\' && typeof o.created', why: 'Evidence: a run\'s start time, only to choose which runs a date range covers (the raw bytes are packed whatever it says)' },
  { file: 'src/storage/repo.js', has: "var raw = r.text == null ? undefined : json(r.text);", why: 'Evidence: the run\'s lineage and folder (bytes packed as they are), then R.sanitize for its own groups' },
  { file: 'src/storage/repo.js', has: "var info = pub.files['publication.json'] != null ? json(", why: 'Evidence: names the version in the pack; the version itself goes through P.verify' },
  { file: 'src/storage/repo.js', has: "var raw = rj ? json(textOf(rj.path))", why: 'Evidence: R.sanitize' },
  { file: 'src/storage/repo.js', has: "R.isPlaceholder(json(x.text), cur)", why: 'R.isPlaceholder' },
  { file: 'src/storage/repo.js', has: "var o = json(textOf(f.path)); return o ? PF.followups.cleanDecision", why: 'cleanDecision' },
  { file: 'src/storage/repo.js', has: 'PF.people.clean(json(r.text))', why: 'PF.people.clean' },
  { file: 'src/storage/repo.js', has: "var o = json(f.text), res = PP.check", why: 'PP.check' },
  { file: 'src/storage/fs.js', has: "saved = JSON.parse(raw || 'null')", why: 'the in-browser example folder this browser keeps for itself, not the team folder' },
  { file: 'src/ui/examples.js', has: "JSON.parse(files['people.json'] || '[]')", why: 'the example folder built into the app, not the team folder' },
  { file: 'src/ui/app.js', has: 'function lsGet', why: 'this browser\'s own storage, not the team folder' },
  { file: 'src/ui/app.js', has: 'return JSON.parse(text); });', why: 'a baseline of the text this window just saved' },
  { file: 'src/ui/app.js', has: 'return JSON.parse(landedText)', why: 'a baseline of the run this window just saved (R.sanitize read it first)' },
  { file: 'src/ui/app.js', has: 'return JSON.parse(baseText)', why: 'a baseline of a run already in memory' },
  { file: 'src/ui/app.js', has: 'var i = text.indexOf(\'\\n\'), d = JSON.parse(', why: 'a step-type draft this window kept in its own browser storage' },
  { file: 'src/ui/app.js', has: "o = f ? JSON.parse(f.text) : null; } catch (e) { o = null; }", why: 'the step-type editor\'s conflict: PF.types.checkCustom before the form shows it' },
  { file: 'src/ui/app.js', has: "o = JSON.parse(f.conflict.theirs || 'null')", why: 'the step-type editor\'s conflict: PF.types.checkCustom before it\'s used' },
  { file: 'bin/flightdeck.js', has: "return JSON.parse(m[1].replace(", why: 'the package\'s own page (its release list), not a team folder' },
  { file: 'bin/flightdeck.js', has: 'return JSON.parse(m[1]).files', why: 'the package\'s own baselines, not a team folder' },
  { file: 'bin/flightdeck.js', has: 'try { r = JSON.parse(text); }', why: '.flightdeck/installed.json: installedNewer (the envelope) first, then every field checked' },
  { file: 'bin/flightdeck.js', has: 'value = JSON.parse(String(req.text)', why: 'a request from another app on standard input, checked by PF.requests, not a team-folder file' },
  { file: 'src/core/publish.js', has: "info = files['publication.json'] ? JSON.parse(", why: 'P.verify itself: shape, then the envelope, before any other field' },
  { file: 'src/core/publish.js', has: "types = JSON.parse(files['types.json'])", why: 'P.verify itself: types go through T.understood' },
  { file: 'src/core/evidence.js', has: 'var n = json(l);', why: 'E.notesFile: lines kept as written for the pack page, each note then through cleanNote' },
  { file: 'src/core/evidence.js', has: 'json(types)', why: 'Evidence compares step types as data (canonical), never by meaning' },
  { file: 'src/core/evidence.js', has: 'json(info)', why: 'Evidence compares a run/3 payload and pins as data (P.payloadHash, canonical); the version itself is checked by P.verify in the same pack' }
];
/* Every JavaScript file in src/ and bin/: a new reader anywhere is in scope. */
function files() {
  const out = [];
  (function walk(d) { fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1)).forEach((e) => { const p = d + '/' + e.name; if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) out.push(p); }); })('src');
  return out.concat(['bin/flightdeck.js']);
}
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isCleaner = (name) => CLEANERS.indexOf(name) >= 0 || CLEANERS.some((c) => c.indexOf('.') < 0 && name.split('.').pop() === c);
/* The parse functions a file has: JSON.parse always, and json()/readJson() where the file defines them over JSON.parse
   (src/core/outline.js's json() is JSON.stringify, so its calls aren't parses). */
function parsers(text) {
  const out = ['JSON\\.parse'];
  if (/function json\([^)]*\)\s*\{[^}]*JSON\.parse/.test(text)) out.push('json');
  if (/function readJson\([^)]*\)\s*\{[\s\S]{0,200}?\bjson\(/.test(text)) out.push('readJson');
  return out;
}
function sites() {
  const out = [];
  files().forEach((file) => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8'), lines = text.split('\n'), re = new RegExp('(^|[^\\w.$])(' + parsers(text).join('|') + ')\\(', 'g');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\/?\*)/.test(line)) return;
      let m; re.lastIndex = 0;
      while ((m = re.exec(line))) {
        const at = m.index + m[1].length;
        if (/function\s+$/.test(line.slice(0, at)) || /\bfunction (json|readJson)\(/.test(line)) continue;
        if (line.slice(at).indexOf('JSON.parse(JSON.stringify(') === 0) continue;
        out.push({ file, line: i + 1, at, text: line.trim(), raw: line, next: lines.slice(i + 1, i + 15).join('\n') });
      }
    });
  });
  return out;
}
/* The innermost call an index sits in on a line: the name before its unmatched "(", or '' for a bare group. */
function enclosing(s, idx) {
  let depth = 0;
  for (let k = idx - 1; k >= 0; k--) {
    const c = s[k];
    if (c === ')') depth++;
    else if (c === '(') { if (depth === 0) { const n = /([\w.$]+)\s*$/.exec(s.slice(0, k)); return n ? n[1] : ''; } depth--; }
  }
  return null;
}
/* Where a parsed value goes: it must reach a checked reader before any field of it is read or it's handed to anything else.
   Shape checks (typeof, !x, x === undefined, Array.isArray(x), inside an if) may come first. */
function follow(name, text) {
  const re = new RegExp('\\b' + esc(name) + '\\b', 'g'); let m;
  const lines = text.split('\n');
  for (const l of lines) {
    re.lastIndex = 0;
    while ((m = re.exec(l))) {
      const after = l.slice(m.index + name.length), before = l.slice(0, m.index);
      if (/^\s*=[^=]/.test(after) && !/[=!<>]$/.test(before.trimEnd())) return { ok: false, how: name + ' is replaced before it reaches a checked reader' };
      const call = enclosing(l, m.index);
      if (call && isCleaner(call)) return { ok: !/^\s*(\.|\[)/.test(after), how: /^\s*(\.|\[)/.test(after) ? name + ' has a field read inside ' + call + '()' : name + ' reaches ' + call + '()' };
      if (/^\s*(\.\w|\[)/.test(after)) return { ok: false, how: name + ' has a field read before any checked reader: ' + l.trim().slice(0, 140) };
      if (call && call !== 'if' && call !== 'while' && call !== 'Array.isArray' && call !== '' && call !== 'return') return { ok: false, how: name + ' is handed to ' + call + '() before any checked reader' };
      if (/^\s*;?\s*$/.test(after) && /\breturn\s+$/.test(before)) return { ok: false, how: name + ' is returned before any checked reader' };
    }
  }
  return { ok: false, how: 'its value never reaches a checked reader' };
}
/* The name the parse is assigned to: the last "x =" before it with no statement or top-level comma between (a condition such
   as "f ? json(f.text) : null" or "r.text == null ? undefined : json(r.text)" may sit between). */
function assigned(before) {
  const re = /(?:\b(?:var|let|const)\s+|[,;{(]\s*|^\s*)([A-Za-z_$][\w$]*)\s*=(?![=>])/g; let m, last = null;
  while ((m = re.exec(before))) last = m;
  if (!last) return null;
  const between = before.slice(last.index + last[0].length);
  let depth = 0;
  for (const c of between) { if (c === '(' || c === '[' || c === '{') depth++; else if (c === ')' || c === ']' || c === '}') depth--; else if ((c === ',' || c === ';') && depth <= 0) return null; }
  return depth === 0 ? last : null;
}
/* What one site's value reaches first. */
function verdict(s) {
  const raw = RAW.find((r) => r.file === s.file && s.text.indexOf(r.has) >= 0);
  if (raw) return { ok: true, how: 'listed raw consumer: ' + raw.why, raw };
  const line = s.raw != null ? s.raw : s.text, at = s.at != null ? s.at : line.search(/\b(json|readJson|JSON\.parse)\(/);
  if (at < 0) return { ok: false, how: 'no parse found' };
  /* Parsed straight into a checked reader: R.sanitize(json(x)), possibly behind a condition. */
  const call = enclosing(line, at), close = (() => { let d = 0; for (let k = line.indexOf('(', at); k < line.length; k++) { if (line[k] === '(') d++; else if (line[k] === ')' && !--d) return k + 1; } return line.length; })();
  if (call && isCleaner(call)) return /^\s*(\.|\[)/.test(line.slice(close)) ? { ok: false, how: 'a field of the parse is read inside ' + call + '()' } : { ok: true, how: 'parsed straight into ' + call + '()' };
  /* Assigned to a name (or a callback's parameter): follow the name. */
  const lhs = assigned(line.slice(0, at));
  const rest = line.slice(close) + '\n' + (s.next || '');
  if (lhs) return follow(lhs[1], rest);
  const cb = /^\)\.then\(function \((\w+)\)/.exec(line.slice(close - 1));
  if (cb) return follow(cb[1], line.slice(close + cb[0].length - 1) + '\n' + (s.next || ''));
  return { ok: false, how: 'its value is used directly' + (call ? ' by ' + call + '()' : '') + ', not by a checked reader' };
}
function lint() { return sites().map((s) => Object.assign(s, verdict(s))); }

if (require.main === module) {
  const all = lint(), bad = all.filter((s) => !s.ok);
  all.forEach((s) => console.log((s.ok ? 'ok   ' : 'FAIL ') + s.file + ':' + s.line + '  ' + s.how));
  const unused = RAW.filter((r) => !all.some((s) => s.raw === r));
  unused.forEach((r) => console.log('UNUSED raw entry ' + r.file + ': ' + r.has));
  console.log(bad.length ? bad.length + ' site(s) read a team-folder file without a checked reader' : 'Every parse site reaches a checked reader or is a listed raw consumer');
  process.exitCode = bad.length || unused.length ? 1 : 0;
}
module.exports = { files, CLEANERS, RAW, sites, lint, verdict };
