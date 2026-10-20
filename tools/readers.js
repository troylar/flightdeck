// The reader lint (docs/design.md section 28): every place the app, the storage code or the command parses JSON follows the
// value it gets to where it's used, and must reach one of the shared checked readers (a cleaner that takes the envelope's
// verdict) before any field of it is read. Known raw consumers are listed by name with why. It's a lint, not the boundary:
// the boundary is the probe folder (test/fixtures/v2/probes/) that test/compat-bridge.test.js runs through every real reader.
//   node tools/readers.js     list every parse site and what it reaches; exit 1 on a site that reads fields first
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FILES = ['src/storage/repo.js', 'src/ui/app.js', 'bin/flightdeck.js', 'src/core/publish.js', 'src/core/evidence.js'];
/* The checked readers: a value that reaches one of these first is judged before it's read. */
const CLEANERS = ['R.sanitize', 'R.cleanCopy', 'R.cleanArchive', 'R.isPlaceholder', 'R.repairs', 'R.unexplained', 'PF.run.sanitize', 'PF.people.clean', 'PF.people.verdict', 'P.verify',
  'PF.publish.verify', 'cleanDecision', 'F.verdict', 'PF.followups.verdict', 'PF.corrections.verdict', 'PP.check', 'PP.cleanRecord', 'PF.proposals.cleanRecord', 'PP.cleanPresence', 'CN.clean',
  'TL.cleanEntry', 'PF.types.checkCustom', 'PF.skills.check', 'PF.jira.check', 'PF.contract.cleanInstalled', 'PF.plans.clean', 'PF.skills.cleanValidation', 'cleanNote', 'E.notesFile', 'P.newerOf', 'U.drift', 'fuDrift', 'ok'];
/* Raw consumers, by a piece of the line, with why they may read what they parse. */
const RAW = [
  { file: 'src/storage/repo.js', has: "var o = json(text); if (!o || typeof o !== 'object') return '\\u0000' + text;", why: 'compares two saves of one run by their bytes, never reads a field for meaning' },
  { file: 'src/storage/repo.js', has: 'types: json(tj)', why: 'a copy of a run\'s types this window already sanitized (intern), not a file' },
  { file: 'src/storage/repo.js', has: "readJson(fs, 'runs/' + i.name)", why: 'v0.1 runs (preflight-run/1): the legacy lister checks the format before reading a field' },
  { file: 'src/storage/repo.js', has: 'if (!bad) return readJson(fs, path)', why: 'loadJsonDir: the caller\'s ok() dispatch check runs before the record is kept; each caller then uses its family\'s cleaner (PF.plans.clean, PF.skills.cleanValidation)' },
  { file: 'src/storage/repo.js', has: "info = f && json(f.text)", why: 'pubProblem: shape checked, then P.newerOf (the envelope) before any other field' },
  { file: 'src/storage/repo.js', has: "if (o.explain) { var raw = json(res[0].text)", why: 'R.repairs and R.unexplained (the run\'s own checked reader for other apps)' },
  { file: 'src/storage/repo.js', has: "why: json(res[0].text) === undefined", why: 'only tells unparsable from unreadable, in a message' },
  { file: 'src/storage/repo.js', has: "var o = res[0] && json(res[0].text)", why: 'loadRun\'s fingerprint read: passed to R.sanitize' },
  { file: 'src/storage/repo.js', has: 'errors: o === undefined ? [\'isn\\\'t valid JSON\'] : PF.types.checkCustom(o)', why: 'step types: PF.types.checkCustom (with the envelope) first' },
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
  { file: 'src/core/evidence.js', has: 'json(types)', why: 'Evidence compares step types as data (canonical), never by meaning' }
];
const SITE = /\b(json|readJson)\(|JSON\.parse\(/g;
const clean = (line) => CLEANERS.some((c) => line.indexOf(c + '(') >= 0);

function sites() {
  const out = [];
  FILES.forEach((file) => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8'), lines = text.split('\n');
    lines.forEach((line, i) => {
      if (/function (json|readJson)\(/.test(line) || !SITE.test(line)) { SITE.lastIndex = 0; return; }
      SITE.lastIndex = 0;
      if (/JSON\.parse\(JSON\.stringify\(/.test(line) && !/\b(json|readJson)\(/.test(line.replace(/JSON\.parse\(JSON\.stringify\(/g, ''))) return;
      if (/^\s*(\/\/|\/?\*)/.test(line)) return;
      out.push({ file, line: i + 1, text: line.trim(), next: lines.slice(i, i + 12).join('\n') });
    });
  });
  return out;
}
/* What one site's value reaches first: a cleaner on the same line, or (assigned to a name) the first line that uses the name. */
function verdict(s) {
  const raw = RAW.find((r) => r.file === s.file && s.text.indexOf(r.has) >= 0);
  if (raw) return { ok: true, how: 'listed raw consumer: ' + raw.why, raw };
  if (clean(s.text)) return { ok: true, how: 'reaches a checked reader on the same line' };
  const m = /(?:var|let|const)\s+(\w+)\s*=\s*[^;=]*?\b(?:json|readJson|JSON\.parse)\(/.exec(s.text) || /\bfunction \((\w+)\) \{/.exec(s.text.slice(s.text.search(SITE)));
  SITE.lastIndex = 0;
  if (m) {
    const name = m[1], rest = s.next.split('\n');
    for (let k = 0; k < rest.length; k++) {
      const l = k === 0 ? rest[0].slice(rest[0].indexOf(m[0]) + m[0].length) : rest[k];
      if (!new RegExp('\\b' + name + '\\b').test(l)) continue;
      if (CLEANERS.some((c) => new RegExp(c.replace(/[.()]/g, '\\$&') + '\\([^;]*\\b' + name + '\\b').test(l))) return { ok: true, how: name + ' reaches a checked reader' };
      if (new RegExp('\\b' + name + '\\s*(\\.\\w|\\[)').test(l.replace(new RegExp('typeof ' + name + '\\b', 'g'), ''))) return { ok: false, how: name + ' has a field read before any checked reader: ' + l.trim().slice(0, 140) };
    }
  }
  return { ok: false, how: 'its value never reaches a checked reader' };
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
module.exports = { FILES, CLEANERS, RAW, sites, lint, verdict };
