// The documentation: every link and anchor resolves, every image is used, the prose is US English, and the README says
// how to start. Offline: links to this repo on GitHub are checked against the files here; other sites aren't fetched.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { rule, run } = require('./harness');

const ROOT = path.join(__dirname, '..');
const REPO = /^https:\/\/(?:github\.com\/troylar\/flightdeck\/(?:blob|tree|raw)\/main\/|raw\.githubusercontent\.com\/troylar\/flightdeck\/main\/)([^?#]*)(#.*)?$/;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const list = (dir, re) => fs.readdirSync(path.join(ROOT, dir)).filter(f => re.test(f) && !f.startsWith('.')).map(f => dir + '/' + f);
function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === '__pycache__' ? [] : walk(dir + '/' + e.name)) : /\.md$/.test(e.name) ? [dir + '/' + e.name] : []);
}
/* The repo's own docs, and the ones installed into a team folder (example-folder is laid out as the folder is). */
const REPO_DOCS = ['README.md', 'CONTRIBUTING.md', 'AGENTS.md', ...list('docs', /\.md$/), ...list('docs/rehearsals', /\.md$/)];
const INSTALLED = ['example-folder/AGENTS.md', ...walk('example-folder/.flightdeck')];

/* Text outside fenced code blocks and inline code, where links and prose live. */
const unfenced = md => md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
const prose = md => unfenced(md).replace(/`[^`\n]*`/g, '');
/* GitHub's heading anchors: lowercase, punctuation dropped, each space a dash; a repeated heading gets -1, -2. */
function anchors(md) {
  const seen = {}, out = new Set();
  unfenced(md).split('\n').forEach(line => {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line); if (!m) return;
    const text = m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '');
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const n = seen[base] || 0; seen[base] = n + 1;
    out.add(n ? base + '-' + n : base);
  });
  md.replace(/<a\s+(?:name|id)="([^"]+)"/g, (x, id) => { out.add(id); return x; });
  return out;
}
/* Every link target in a file: Markdown links and images, and HTML src, srcset and href. */
function targets(md) {
  const p = prose(md), out = [];
  p.replace(/!?\[(?:[^\]]|\][^(])*?\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (x, u) => { out.push(u); return x; });
  p.replace(/\s(?:src|href)="([^"]+)"/g, (x, u) => { out.push(u); return x; });
  p.replace(/\ssrcset="([^"]+)"/g, (x, s) => { s.split(',').forEach(part => out.push(part.trim().split(/\s+/)[0])); return x; });
  return out.filter(Boolean);
}
const anchorCache = {};
const anchorsOf = f => anchorCache[f] || (anchorCache[f] = anchors(read(f)));
/* What's wrong with one link from file f, or null. root: links mustn't leave it (an installed file's folder). */
function problem(f, u, root) {
  if (/^(mailto:|tel:)/.test(u)) return null;
  let rel, hash;
  const gh = REPO.exec(u);
  if (gh) { rel = decodeURIComponent(gh[1]).replace(/\/$/, ''); hash = gh[2]; }
  else if (/^[a-z]+:/i.test(u) || u.startsWith('//')) return null;
  else {
    const [p, h] = u.split('#'); hash = h != null ? '#' + h : undefined;
    rel = p ? path.posix.normalize(path.posix.join(path.posix.dirname(f), decodeURIComponent(p))) : f;
    if (root && !(rel + '/').startsWith(root + '/')) return u + ' leaves ' + root + ' (it won\'t exist once installed)';
  }
  if (!fs.existsSync(path.join(ROOT, rel))) return u + ': no ' + rel;
  if (hash && hash.length > 1 && /\.md$/.test(rel) && !anchorsOf(rel).has(decodeURIComponent(hash.slice(1)))) return u + ': no heading #' + hash.slice(1) + ' in ' + rel;
  return null;
}

rule('Docs: every link and #anchor in the repo\'s docs resolves, GitHub links to this repo included', () => {
  const bad = [];
  REPO_DOCS.forEach(f => targets(read(f)).forEach(u => { const p = problem(f, u, null); if (p) bad.push(f + ': ' + p); }));
  assert.deepStrictEqual(bad, []);
});

rule('Docs: the files installed into a team folder link only to what\'s installed with them', () => {
  const bad = [];
  INSTALLED.forEach(f => targets(read(f)).forEach(u => { const p = problem(f, u, 'example-folder'); if (p) bad.push(f + ': ' + p); }));
  assert.deepStrictEqual(bad, []);
});

rule('Docs: the anchor rules match GitHub\'s: punctuation dropped, spaces as dashes, repeats numbered', () => {
  const a = anchors('# What to know when moving to 2.1\n## Step 1: open it\n## Step 1: open it\n```\n# not a heading\n```\n## `code` & *more*\n');
  assert.deepStrictEqual([...a], ['what-to-know-when-moving-to-21', 'step-1-open-it', 'step-1-open-it-1', 'code--more']);
});

rule('Docs: every image in docs/images is used, and every image a doc shows exists', () => {
  const all = REPO_DOCS.map(read).join('\n');
  const unused = fs.readdirSync(path.join(ROOT, 'docs/images')).filter(f => !f.startsWith('.') && all.indexOf('images/' + f) < 0);
  assert.deepStrictEqual(unused, [], 'unused images');
});

rule('Docs: HTML in the docs is balanced, and no page shows the same image twice', () => {
  const bad = [];
  REPO_DOCS.forEach(f => {
    const p = prose(read(f));
    // Each tag closes the one opened last, and a cell sits in a row in a table.
    const stack = [], parent = { td: 'tr', tr: 'table' };
    p.replace(/<(\/?)(table|tr|td|picture|details)[\s>]/g, (x, end, t) => {
      if (!end) { if (parent[t] && stack[stack.length - 1] !== parent[t]) bad.push(f + ': <' + t + '> outside <' + parent[t] + '>'); stack.push(t); }
      else if (stack.pop() !== t) bad.push(f + ': </' + t + '> closes nothing open');
      return x;
    });
    if (stack.length) bad.push(f + ': unclosed ' + stack.join(', '));
    const seen = {};
    p.replace(/<img\s[^>]*src="([^"]+)"/g, (x, u) => { if (seen[u]) bad.push(f + ': shows ' + u + ' twice'); seen[u] = 1; return x; });
  });
  assert.deepStrictEqual(bad, []);
});

rule('Docs: the prose is US English', () => {
  const bad = [];
  REPO_DOCS.concat(INSTALLED).forEach(f => prose(read(f)).split('\n').forEach((line, i) => {
    const m = /\b(colour|grey|behaviour|organis(?:e|ed|es|ing|ation)|licence|cancelled|cancelling|favour|honour|catalogue)\b/i.exec(line);
    if (m) bad.push(f + ':' + (i + 1) + ' ' + m[1]);
  }));
  assert.deepStrictEqual(bad, []);
});

rule('Docs: the README says how to start, and the download it names is in the package', () => {
  const md = read('README.md'), pkg = JSON.parse(read('package.json'));
  assert.ok(md.includes('npx @troylar/flightdeck open'), 'the one-line start');
  const dl = /https:\/\/unpkg\.com\/@troylar\/flightdeck@(\d+\.\d+\.\d+)\/dist\/flightdeck\.html/.exec(md);
  assert.ok(dl, 'a pinned download of the HTML');
  assert.ok(pkg.files.includes('dist/flightdeck.html'), 'the package ships the HTML it points at');
  assert.ok(!/github\.com\/troylar\/flightdeck\/releases/.test(md), 'no GitHub Releases: the repo doesn\'t publish them');
  assert.ok(md.indexOf('npx @troylar/flightdeck open') < 4000, 'on the first screen');
});

run();
