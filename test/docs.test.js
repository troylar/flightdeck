// The documentation: every link and anchor resolves, every image is used, the prose is US English, and the README says
// how to start. Offline: links to this repo on GitHub are checked against the files here; other sites aren't fetched.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { rule, run, load } = require('./harness');
const PF = load();

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
/* GitHub's heading anchors: lowercase, punctuation dropped, each space a dash; a repeated heading gets -1, -2. The headings are
   the ones Flightdeck's own heading reader finds (PF.contract.headings), so a section AGENTS.md cites is one this sees. */
function anchors(md) {
  const seen = {}, out = new Set();
  PF.contract.headings(md).forEach(h => {
    const text = h.text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '');
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

/* Every command the CLI's help lists, as "draft save" or "export": a second word is a subcommand unless it's a placeholder. */
function helpCommands(help) {
  const out = [];
  help.split('\n').forEach(line => {
    const m = /^ {2}flightdeck ([a-z]+)(?: ([a-z]+)\b(?![^\s]))?/.exec(line);
    if (m) { const c = m[2] ? m[1] + ' ' + m[2] : m[1]; if (out.indexOf(c) < 0) out.push(c); }
  });
  return out;
}
const STEP_SKILL = 'example-folder/.flightdeck/skills/flightdeck-new-step-type/SKILL.md', IN_SKILL = ['type list', 'type read', 'type save'];
/* Commands a person runs to set up or look after the folder. Neither file is for them; the README is. */
const FOR_PEOPLE = ['open', 'install', 'skills', 'backup', 'path', 'version'];
function unlisted(md, commands) {
  const flatMd = md.replace(/\s+/g, ' ');
  return commands.filter(c => FOR_PEOPLE.indexOf(c) < 0 && !new RegExp('flightdeck ' + c + '(?![a-z-])').test(flatMd));
}
rule('Docs: AGENTS.md routes every command the CLI\'s help lists to a place that names it, docs/apps.md names each, and the README every one they leave to people', () => {
  const help = require('../bin/flightdeck.js').main(['help']).out, commands = helpCommands(help);
  ['export', 'skill register', 'draft propose', 'report targets', 'plan request', 'open', 'version'].forEach(c => assert.ok(commands.indexOf(c) >= 0, 'the help is read: ' + c));
  assert.ok(commands.length >= 20 && commands.every(c => /^[a-z]+( [a-z]+)?$/.test(c)), commands.join(', '));
  FOR_PEOPLE.forEach(c => assert.ok(commands.indexOf(c) >= 0, 'still a command: ' + c));
  FOR_PEOPLE.forEach(c => assert.ok(new RegExp('flightdeck ' + c + '(?![a-z-])').test(read('README.md')), 'the README names: flightdeck ' + c));
  /* AGENTS.md routes: each command has one row in its Commands table, whose last cell is a section of the command guide or a
     skill, and that place names the command in full (test/agents-inventory.js, docs()). */
  const I = require('./agents-inventory'), state = I.initial();
  assert.deepStrictEqual(I.docs(state), [], 'example-folder/AGENTS.md routes every command');
  assert.deepStrictEqual(unlisted(read(STEP_SKILL), IN_SKILL), [], STEP_SKILL);
  assert.deepStrictEqual(unlisted(read('docs/apps.md'), commands), [], 'docs/apps.md');
  /* D7a-c: the routed check sees a help line with no row, a guide section that no longer names its command, and a row that
     routes to a section the guide lacks. */
  assert.deepStrictEqual(I.docs(Object.assign({}, state, { help: help + '\n  flightdeck health <team folder> [--json]\n' })), ['health: 0 rows'], 'D7a');
  const files = Object.assign({}, state.files); files[I.GUIDE] = files[I.GUIDE].split('flightdeck export').join('flightdeck exporter');
  assert.deepStrictEqual(I.docs(Object.assign({}, state, { files })), ['export: *Evidence packs* in the command guide does not name flightdeck export'], 'D7b');
  assert.deepStrictEqual(I.docs(Object.assign({}, state, { agents: state.agents.replace('| *Evidence packs* in the command guide |', '| *Packs* in the command guide |') })), ['export: routes nowhere: *Packs* in the command guide'], 'D7c');
  /* And the check sees a word that only starts like a command. */
  assert.deepStrictEqual(unlisted(read('docs/apps.md'), helpCommands(help + '\n  flightdeck health <team folder> [--json]\n')), ['health']);
  assert.deepStrictEqual(unlisted('`flightdeck runsy` and `flightdeck run-x`', ['runs', 'run']), ['runs', 'run']);
  assert.deepStrictEqual(helpCommands('  flightdeck draft read <team folder>\n  flightdeck open                     open the app\n  flightdeck skills --to <folder>\n'), ['draft read', 'open', 'skills']);
});

/* Round 12 (review round 2): a delete instruction for AGENTS.md or a staged copy is never unconditional. Someone may have added a
   team rule to a waiting copy, and deleting it would lose the rule's only copy. Every such sentence, anywhere Flightdeck ships
   text (docs, the README, the changelog and release notes, the installed AGENTS.md, skills and references, and the words the
   app and the command build, in their source and as the merge README renders them), says when: only if nobody changed the
   copies, unless one was changed, or once it is merged. */
const DELETE_WORD = /\bdelet(?:e|es|ing)\b[^\n]{0,120}?(?:AGENTS\.md|\bits copy\b|\beach copy\b|\bthe cop(?:y|ies)\b|\bthose copies\b|\bthat copy\b|\bit from each version folder\b)/i;
const ABOUT_COPIES = /AGENTS\.md|\.flightdeck[-/]updates|version folder|updates\/|staged cop|waiting cop/i;
/* "once the other files are merged" is no condition on the copy itself: only its own merge, or nobody having changed it, is. */
const CONDITION = /\bonly if\b|\bunless\b|\bnobody changed\b|\b(?:when|once) (?:it'?s|it is|a file is|each (?:file|copy) is|that file is|its edits are) merged\b/i;
/* Markdown is read through the shared prose reader (test/prose-reader.js: soft wraps joined, a sentence split only outside
   paths and code spans); source code keeps its own lines, each split the same way, since its strings run one per line. */
const PROSE = require('./prose-reader');
const sentencesIn = (text, code) => code ? text.split('\n').flatMap(PROSE.sentencesOf) : PROSE.proseSentences(text).map(x => x.text);
/* A delete aimed at the staged folder itself or a copy in it, whatever its spelling (the shared reader's path normalizing:
   Windows separators, quotes, ./ and <team folder>/). */
const DELETE_VERB = /\bdelet(?:e|es|ing)\b/i;
const stagedPath = (x) => PROSE.pathsOf(x).some(p => /^\.flightdeck[-/]updates(?:\/|$)|(?:^|\/)updates\/(?:<version>|\d+\.\d+\.\d+)\/AGENTS\.md$/.test(p));
/* Sentences the guard flags that aren't instructions, by file and exact normalized text, each reviewed by hand; an entry
   that matches nothing fails. */
const NOT_DELETE_ORDERS = {
  'docs/updating.md': {
    'Otherwise, a copy left in any version\'s updates folder (`.flightdeck/updates/<version>/<the file\'s path>`) still counts as waiting, even after a later update and even if the file now matches the default, until someone deletes it or `--force` files it away.':
      'describes when a copy stops counting as waiting; it tells nobody to delete it'
  }
};
const deleteUsed = {};
function unconditionalDeletes(text, where, code) {
  return sentencesIn(text, code).filter(x => !((NOT_DELETE_ORDERS[where] || {})[x] && (deleteUsed[where + '\u0000' + x] = true))).filter(x => (DELETE_WORD.test(x) && ABOUT_COPIES.test(x) || DELETE_VERB.test(x) && stagedPath(x)) && !CONDITION.test(x)).map(x => where + ': ' + x.trim().slice(0, 200));
}
const shippedText = () => {
  const files = [...REPO_DOCS, ...INSTALLED, 'CHANGELOG.md', 'src/releases.json', 'bin/flightdeck.js', 'dist/flightdeck.html', ...list('src/core', /\.js$/), ...list('src/ui', /\.js$/), ...list('src/ui/views', /\.js$/)];
  return files.filter(f => !/^docs\/rehearsals\//.test(f)).map(f => [f, read(f)]);
};
rule('Round 12: no shipped text says to delete AGENTS.md or a staged copy without saying when (only if nobody changed it, or once it is merged)', () => {
  const bad = [];
  shippedText().forEach(([f, t]) => bad.push(...unconditionalDeletes(t, f, !/\.md$/.test(f))));
  /* The words as they render: the merge README for a held AGENTS.md and for one only its copy waits on, and the merge prompt. */
  const C = PF.contract, G = C.REFS + 'command-guide.md', ups = ['.flightdeck', 'updates'];
  const held = { key: 'AGENTS.md', rel: 'AGENTS.md', status: 'merge', heldFrom: 'update', held: [{ path: G, lacks: ['Reading runs'] }] };
  const only = { key: 'AGENTS.md', rel: 'AGENTS.md', status: 'merge', waiting: '2.15.0', onlyCopy: true, waitsFor: [] };
  const wait = { key: 'AGENTS.md', rel: 'AGENTS.md', status: 'merge', waiting: '2.15.0', onlyCopy: true, waitsFor: [{ path: G, lacks: ['Reading runs'] }] };
  [held, only, wait].forEach((i, n) => bad.push(...unconditionalDeletes(C.mergeReadme('2.15.0', [i], ups, 'the team folder', {}), 'the merge README ' + n)));
  bad.push(...unconditionalDeletes(C.mergePrompt('2.15.0', '.flightdeck/updates/2.15.0'), 'the merge prompt'));
  assert.deepStrictEqual(bad, []);
  Object.keys(NOT_DELETE_ORDERS).forEach(f => Object.keys(NOT_DELETE_ORDERS[f]).forEach(x => assert.ok(deleteUsed[f + '\u0000' + x], 'NOT_DELETE_ORDERS matches nothing: ' + f + ': ' + x.slice(0, 60))));
  /* The check itself: it catches the round 11 paragraph, and passes the conditional forms. */
  assert.strictEqual(unconditionalDeletes('Then delete `AGENTS.md` from each version folder in `.flightdeck/updates/`, and run install again.', 'x').length, 1);
  assert.strictEqual(unconditionalDeletes('Delete AGENTS.md from each version folder there.', 'x').length, 1);
  assert.strictEqual(unconditionalDeletes('Delete AGENTS.md from each version folder in `.flightdeck/updates/` only if nobody changed those copies.', 'x').length, 0);
  assert.strictEqual(unconditionalDeletes('Keep our changes, and delete each copy in .flightdeck/updates/ once it\'s merged.', 'x').length, 0);
});
rule('Round 13: a period inside a path or a code span never ends a sentence, so the delete guard finds full staged paths', () => {
  ['Delete `.flightdeck/updates/<version>/AGENTS.md` and run install again.', 'Delete `.flightdeck/updates/2.15.0/AGENTS.md` and run install again.',
    'Delete .flightdeck/updates/2.15.0/AGENTS.md and run install again.', 'Run `flightdeck install . --yes`, then delete `.flightdeck/updates/2.15.0/AGENTS.md`.']
    .forEach((t) => assert.strictEqual(unconditionalDeletes(t, 'x').length, 1, t));
  assert.strictEqual(unconditionalDeletes('Delete `.flightdeck/updates/2.15.0/AGENTS.md` only if nobody changed it.', 'x').length, 0);
  assert.deepStrictEqual(PROSE.sentencesOf('Run `a. b` now. Then `c`! Done? Yes'), ['Run `a. b` now.', 'Then `c`!', 'Done?', 'Yes']);
  assert.strictEqual(unconditionalDeletes('const A = \'Delete `.flightdeck/updates/2.15.0/AGENTS.md`\';\nconst B = \'only if nobody changed it\';', 'x', true).length, 1, 'source lines stay apart');
});
rule('Round 14: the delete guard reads Markdown through the shared prose reader, so a soft-wrapped delete is read whole', () => {
  ['Delete\n`.flightdeck/updates/<version>/AGENTS.md` and run install again.', 'Delete\n`.flightdeck/updates/2.15.0/AGENTS.md` and run install again.',
    'Then delete `AGENTS.md`\nfrom each version folder, and run install again.']
    .forEach((t) => assert.strictEqual(unconditionalDeletes(t, 'x').length, 1, t));
  assert.strictEqual(unconditionalDeletes('Delete `.flightdeck/updates/2.15.0/AGENTS.md`\nonly if nobody changed it.', 'x').length, 0, 'a wrapped condition counts');
  assert.strictEqual(unconditionalDeletes('- Delete `.flightdeck/updates/2.15.0/AGENTS.md`.\n- Only if nobody changed it, run install.', 'x').length, 1, 'a new list item is a new paragraph');
});
rule('Round 15: the spelling matrix: an unconditional delete of a staged copy in every place and every path spelling is caught, and its conditional twin passes', () => {
  const M = require('./spelling-matrix'), bad = [];
  const forbidden = M.variants(M.DELETE), allowed = M.variants(M.DELETE, M.CONDITION);
  assert.strictEqual(forbidden.length, allowed.length, 'set-up: twins');
  forbidden.forEach((v, i) => {
    if (unconditionalDeletes(v.md, 'x').length < 1) bad.push('missed: ' + v.place + ' / ' + v.form + ' / ' + v.wrap + ': ' + JSON.stringify(v.md));
    if (unconditionalDeletes(allowed[i].md, 'x').length) bad.push('flagged the conditional twin: ' + v.place + ' / ' + v.form + ' / ' + v.wrap);
  });
  assert.deepStrictEqual(bad, []);
  assert.strictEqual(unconditionalDeletes('## Delete `.flightdeck/updates/<version>/AGENTS.md`\n\nThen run install again.', 'x').length, 1, 'a heading');
  assert.strictEqual(unconditionalDeletes('## Delete `.flightdeck/updates/<version>/AGENTS.md` only if nobody changed it', 'x').length, 0, 'a conditional heading');
});
rule('The README\'s manual download is the release being shipped, so it can\'t go stale', () => {
  const version = JSON.parse(read('src/releases.json'))[0].version;
  const links = read('README.md').match(/@troylar\/flightdeck@\d+\.\d+\.\d+\/dist\/flightdeck\.html/g) || [];
  assert.ok(links.length >= 1, 'the README links a download');
  links.forEach(l => assert.strictEqual(l, '@troylar/flightdeck@' + version + '/dist/flightdeck.html'));
});

/* ---------- flightdeck type save (2.14, slice A2): the wording the owner decided (design section 0.5) ---------- */
const SAME_INSTANT = 'Like two Flightdeck windows in different browsers, two saves at the same instant can replace one another without either being told.';
const FORBIDDEN = /can'?t overwrite|cannot overwrite|closed by construction|recoverable from history/i;
rule('A2 wording: HELP, docs/apps.md and the step-type skill carry the same-instant sentence and none of the forbidden phrases', () => {
  const help = require('../bin/flightdeck.js').main(['help']).out;
  for (const [name, t] of [['HELP', help], ['docs/apps.md', read('docs/apps.md')], [STEP_SKILL, read(STEP_SKILL)]]) {
    assert.ok(t.replace(/\s+/g, ' ').indexOf(SAME_INSTANT) >= 0, name + ' carries: ' + SAME_INSTANT);
    assert.ok(!FORBIDDEN.test(t), name + ': ' + (FORBIDDEN.exec(t) || [])[0]);
  }
  assert.ok(FORBIDDEN.test('a save that can\'t overwrite') && FORBIDDEN.test('Closed by construction'), 'the scan sees them');
});
rule('The step-type skill uses the commands: type list, type read and type save --expect, a next action for every outcome, the route table by existing, and no direct writes', () => {
  const t = read(STEP_SKILL), flat = t.replace(/\s+/g, ' ');
  ['flightdeck type list', 'flightdeck type read', 'flightdeck type save', '--expect <rev', '--expect none'].forEach(w => assert.ok(flat.indexOf(w) >= 0, 'names ' + w));
  ['done', 'same', 'checked', 'changed', 'copies', 'newer', 'invalid', 'not-allowed', 'no-links', 'link-check', 'failed', 'held', 'partial', 'replaced', 'unverified', 'unsure'].forEach(o => assert.ok(new RegExp('^\\|[^\\n]*`' + o + '`[^\\n]*\\|', 'm').test(t), 'a table row for ' + o));
  ['`existing: missing`', '`appLoads: true`', '`appLoads: false`', '`existing: newer`'].forEach(r => assert.ok(t.indexOf(r) >= 0, 'route row ' + r));
  assert.ok(/New type[^\n]*same ID[^\n]*Keep mine/.test(t), 'the New type, Keep mine route');
  /* Nothing tells an assistant to write, edit, overwrite, rename or delete a file in step-types/ itself, except to say never. */
  const lines = unfenced(t).split('\n').filter(l => /step-types\//.test(l) && /\b(write|writes|edit|overwrite|rename|delete|create)\b/i.test(l));
  lines.forEach(l => assert.ok(/\bnever\b|\bdon't\b|read only/i.test(l), 'a direct-write instruction: ' + l));
  assert.ok(lines.length >= 1, 'it says never to write there directly');
  assert.ok(!/Write `step-types\/<id>\.json`/.test(t), 'the old heading is gone');
});
run();
