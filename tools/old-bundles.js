// Older releases as they shipped, for the cross-version tests (test/compat.test.js, docs/design.md section 28).
// For each release tag in test/fixtures/old-bundles/record.json it takes, with git show, the shipped app (dist/flightdeck.html), the
// command (bin/flightdeck.js) and, where the tag had one, the skills' checker (check_folder.py). It caches them in .old-bundles/
// (not committed) and checks every file against the SHA-256 recorded for that tag, so a moved tag or a changed cache fails loudly.
// Once cached, nothing needs git: the tests run offline.
//   node tools/old-bundles.js            extract what isn't cached yet, check everything, list the tags
//   node tools/old-bundles.js --write    also record tags from v1.10.0 on that the record doesn't have yet (needs git)
// Without the tags (a shallow clone) a release is skipped with a message; in CI (CI set) that's a failure instead.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const RECORD = path.join(ROOT, 'test', 'fixtures', 'old-bundles', 'record.json');
const CACHE = path.join(ROOT, '.old-bundles');
/* The oldest release a team may still run (docs/updating.md): older tags are kept only as characterizations. */
const FLOOR = '1.11.1';

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
function git(...a) { return cp.execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1048576, stdio: ['ignore', 'pipe', 'ignore'] }); }
function record() { return JSON.parse(fs.readFileSync(RECORD, 'utf8')); }
/* Every recorded tag, oldest first, with its major version and whether it's at or above the floor. */
function tags() { return Object.keys(record().tags).sort((a, b) => cmp(a.slice(1), b.slice(1))).map((tag) => ({ tag, version: tag.slice(1), major: +tag.slice(1).split('.')[0], supported: cmp(tag.slice(1), FLOOR) >= 0 })); }

/* build.py joins source files with "\n" and escapes "</script" in every block; so does this, to find them in the shipped page. */
const safe = (s) => s.replace(/<\/script/g, '<\\/script');
const block = (html, id) => { const m = new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>').exec(html); return m ? m[1] : null; };

/* The files of one tag, read from git: the shipped page, the command, the checker, and the shipped page's own core and storage
   code. Before 1.17 the storage code sat at the top of pf-app (storage/fs.js, then storage/repo.js); it's cut from there at the
   lengths of the tag's own sources, and the cut is proved byte for byte, so what the tests run is exactly what shipped. */
function fromGit(tag) {
  const commit = git('rev-parse', tag + '^{commit}').trim();
  const html = git('show', tag + ':dist/flightdeck.html'), cli = git('show', tag + ':bin/flightdeck.js');
  let checker = null;
  try { checker = git('show', tag + ':example-folder/.flightdeck/skills/_flightdeck/check_folder.py'); } catch (e) { /* not in this tag */ }
  const core = block(html, 'pf-core'), app = block(html, 'pf-app'), storageBlock = block(html, 'pf-storage');
  if (core == null || app == null) throw new Error(tag + ': its dist/flightdeck.html has no pf-core or pf-app block');
  const fsSrc = safe(git('show', tag + ':src/storage/fs.js')), repoSrc = safe(git('show', tag + ':src/storage/repo.js'));
  /* Each block starts after the page's own line break; only white space may sit around the joined sources. */
  const around = (text, inner) => { const at = text.indexOf(inner); return at >= 0 && /^\s*$/.test(text.slice(0, at)) ? at : -1; };
  let storage, fsAt;
  if (storageBlock != null) {
    const at = around(storageBlock, repoSrc);
    if (at < 0 || !/^\s*$/.test(storageBlock.slice(at + repoSrc.length))) throw new Error(tag + ': its pf-storage block isn\'t its src/storage/repo.js');
    fsAt = around(app, fsSrc + '\n');
    if (fsAt < 0) throw new Error(tag + ': its pf-app block doesn\'t start with its src/storage/fs.js');
    storage = repoSrc;
  } else {
    fsAt = around(app, fsSrc + '\n' + repoSrc + '\n');
    if (fsAt < 0) throw new Error(tag + ': its pf-app block doesn\'t start with its storage code');
    storage = app.slice(fsAt + fsSrc.length + 1, fsAt + fsSrc.length + 1 + repoSrc.length);
  }
  const files = { 'flightdeck.html': html, 'flightdeck.js': cli, 'core.js': core, 'storage.js': storage, 'fs.js': app.slice(fsAt, fsAt + fsSrc.length) };
  if (checker != null) files['check_folder.py'] = checker;
  return { commit, files };
}

function hashes(files) { const out = {}; Object.keys(files).sort().forEach((k) => { out[k] = sha(files[k]); }); return out; }

function readCache(tag) {
  const dir = path.join(CACHE, tag);
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')), files = {};
    Object.keys(meta.sha256).forEach((k) => { files[k] = fs.readFileSync(path.join(dir, k), 'utf8'); });
    return { commit: meta.commit, files };
  } catch (e) { return null; }
}
function writeCache(tag, got) {
  const dir = path.join(CACHE, tag);
  fs.mkdirSync(dir, { recursive: true });
  /* Each file lands whole (written beside it, then renamed), so test files reading the cache in parallel never see half of one. */
  const put = (k, text) => { const tmp = path.join(dir, k + '.' + process.pid + '.tmp'); fs.writeFileSync(tmp, text); fs.renameSync(tmp, path.join(dir, k)); };
  Object.keys(got.files).forEach((k) => put(k, got.files[k]));
  put('meta.json', JSON.stringify({ tag, commit: got.commit, sha256: hashes(got.files) }, null, 2) + '\n');
}

/* Does what was read match the record for this tag? Returns what differs, or ''. */
function mismatch(tag, got) {
  const want = record().tags[tag];
  if (!want) return tag + ' isn\'t in test/fixtures/old-bundles/record.json';
  if (got.commit !== want.commit) return tag + ' is commit ' + got.commit + ', recorded as ' + want.commit + ' (was the tag moved?)';
  const h = hashes(got.files), keys = Object.keys(want.sha256).concat(Object.keys(h)).filter((k, i, a) => a.indexOf(k) === i);
  const bad = keys.filter((k) => h[k] !== want.sha256[k]);
  return bad.length ? tag + ': ' + bad.join(', ') + ' differ from the recorded SHA-256' : '';
}

const memo = {};
/* One release: { tag, version, supported, commit, files: { 'flightdeck.html', 'flightdeck.js', 'core.js', 'storage.js', 'fs.js',
   'check_folder.py'? } }, from the cache when it matches the record, else from git (and cached). null, with a message, when
   neither has it; in CI that throws instead. */
function get(tag) {
  if (tag in memo) return memo[tag];
  const info = tags().find((t) => t.tag === tag);
  if (!info) throw new Error(tag + ' isn\'t in test/fixtures/old-bundles/record.json: run node tools/old-bundles.js --write');
  let got = readCache(tag);
  if (got && mismatch(tag, got)) got = null;
  if (!got) {
    try { got = fromGit(tag); } catch (e) {
      if (/its |differ|moved/.test(e.message)) throw e;
      if (process.env.CI) throw new Error(tag + ' isn\'t in this clone and isn\'t cached in .old-bundles/. Fetch the history and tags (git fetch --tags --unshallow).');
      console.log('  (skipped ' + tag + ': it isn\'t in this clone or in .old-bundles/; git fetch --tags to run it)');
      return (memo[tag] = null);
    }
    const bad = mismatch(tag, got);
    if (bad) throw new Error(bad);
    writeCache(tag, got);
  }
  const html = got.files['flightdeck.html'];
  if (html.indexOf('<meta name="flightdeck-version" content="' + info.version + '">') < 0) throw new Error(tag + '\'s page doesn\'t say it\'s Flightdeck ' + info.version);
  return (memo[tag] = Object.assign({}, info, { commit: got.commit, files: got.files }));
}

/* Release tags from v1.10.0 on that git has and the record doesn't. */
function unrecorded() {
  let list;
  try { list = git('tag', '-l', 'v*').split('\n').map((t) => t.trim()); } catch (e) { return []; }
  const have = record().tags;
  return list.filter((t) => /^v\d+\.\d+\.\d+$/.test(t) && cmp(t.slice(1), '1.10.0') >= 0 && !have[t]).sort((a, b) => cmp(a.slice(1), b.slice(1)));
}

if (require.main === module) {
  if (process.argv.includes('--write')) {
    const rec = record(), add = unrecorded();
    add.forEach((t) => { const got = fromGit(t); rec.tags[t] = { commit: got.commit, sha256: hashes(got.files) }; });
    const sorted = {};
    Object.keys(rec.tags).sort((a, b) => cmp(a.slice(1), b.slice(1))).forEach((t) => { sorted[t] = rec.tags[t]; });
    rec.tags = sorted;
    fs.writeFileSync(RECORD, JSON.stringify(rec, null, 2) + '\n');
    console.log(add.length ? 'Recorded ' + add.join(', ') : 'Every release tag is recorded');
  }
  tags().forEach((t) => {
    const b = get(t.tag);
    console.log((b ? 'ok   ' : 'skip ') + t.tag + (t.supported ? '' : ' (below the ' + FLOOR + ' floor: characterization only)') + (b ? '  ' + b.commit.slice(0, 7) + '  ' + Object.keys(b.files).join(' ') : ''));
  });
  const left = unrecorded();
  if (left.length) console.log('Not recorded yet: ' + left.join(', ') + '. Run node tools/old-bundles.js --write, then add them to the capability matrix (test/compat-matrix.js).');
}
module.exports = { FLOOR, CACHE, tags, get, unrecorded, block, cmp };
