'use strict';
/* The spelling matrix the text guards are tested against: one instruction, in every place Markdown can hold it and with its
   path written every way a maintainer plausibly would, so a guard is checked against spellings nobody has reported yet. A
   variant is { place, form, wrap, md }. sentence(p) is the instruction's words around the path p, with no final period. */
/* Each place gets { s, pre, path, tail }: s(wrapIt) is the whole sentence (wrapped over two lines when wrapIt), pre the words
   before the path, path the raw path (unwrapped), tail the words after it. A place that takes the raw path (a link) is LINKY:
   only an unquoted path with no spaces can be a link target. */
const PLACES = {
  paragraph: ({ s }) => s(false) + '.',
  wrapped: ({ s }) => s(true) + '.',
  h1: ({ s }) => '# ' + s(false), h2: ({ s }) => '## ' + s(false), h3: ({ s }) => '### ' + s(false),
  h4: ({ s }) => '#### ' + s(false), h5: ({ s }) => '##### ' + s(false), h6: ({ s }) => '###### ' + s(false),
  'list item': ({ s }) => '- ' + s(false) + '.',
  'nested list item': ({ s }) => '- First, read the run.\n  - ' + s(false) + '.',
  blockquote: ({ s }) => '> ' + s(true).split('\n').join('\n> ') + '.',
  'table cell': ({ s }) => '| Step | What to do |\n|---|---|\n| 1 | ' + s(false) + '. |',
  'table row, action | destination': ({ pre, p, tail }) => '| Action | Destination |\n|---|---|\n| ' + pre + ' | ' + p + tail + ' |',
  'table row, file | action': ({ pre, p, tail }) => '| File | Action |\n|---|---|\n| ' + p + ' | ' + pre + tail + ' |',
  'link text': ({ s }) => '[' + s(false) + '](https://example.com/help).',
  'link target': ({ pre, path, tail }) => pre + ' [the file](' + path + ')' + tail + '.',
  'reference link, full': ({ pre, path, tail }) => pre + ' [the file][out]' + tail + '.\n\n[out]: ' + path,
  'reference link, collapsed': ({ pre, path, tail }) => pre + ' [the file][]' + tail + '.\n\n[the file]: ' + path,
  'reference link, shortcut': ({ pre, path, tail }) => pre + ' [the file]' + tail + '.\n\n[the file]: ' + path,
  'bold lead-in': ({ s }) => '**' + s(false) + ':** then say you did.',
  'italic lead-in': ({ s }) => '*' + s(false) + ':* then say you did.'
};
const LINKY = (place) => /^(?:link target|reference link)/.test(place);
const WRAPS = { bare: (x) => x, backticked: (x) => '`' + x + '`', 'double-quoted': (x) => '"' + x + '"', 'single-quoted': (x) => '\'' + x + '\'',
  'double-quoted in backticks': (x) => '`"' + x + '"`', 'single-quoted in backticks': (x) => '`\'' + x + '\'`' };

/* before and after: the words around the path; forms: { name: path }; cond: words that make it allowed (a condition or a
   prohibition), as { at: 'start' | 'end', words }. Returns the variants, and with cond, the allowed twin of each. */
function variants({ before, after, forms, skip }, cond) {
  const out = [];
  Object.keys(PLACES).forEach((place) => Object.keys(forms).forEach((form) => Object.keys(WRAPS).forEach((wrap) => {
    if (skip && skip(form, wrap, place)) return;
    if (LINKY(place) && (wrap !== 'bare' || /\s/.test(forms[form]))) return;
    const p = WRAPS[wrap](forms[form]);
    let pre = before, post = after || '';
    if (cond && cond.at === 'start') pre = cond.words + ' ' + pre.charAt(0).toLowerCase() + pre.slice(1);
    if (cond && cond.at === 'end') post = (post ? post + ' ' : '') + cond.words;
    const tail = post ? ' ' + post : '';
    const md = PLACES[place]({ s: (wrapIt) => pre + (wrapIt ? '\n' : ' ') + p + tail, pre, p, path: forms[form], tail });
    out.push({ place, form, wrap, md });
  })));
  return out;
}

const WRITE = {
  before: 'Write the report to', after: 'directly',
  forms: { path: 'reports/release/report.json', './': './reports/release/report.json', '<team folder>/': '<team folder>/reports/release/report.json',
    'Windows': 'reports\\release\\report.json', '.\\ Windows': '.\\reports\\release\\report.json', 'root/': 'reports/', 'root': 'reports', 'root\\ Windows': 'reports\\',
    'the folder': 'the reports folder', 'the directory': 'the reports directory', 'your folder': 'your reports folder', 'its folder': 'its reports folder',
    'their directory': 'their reports directory', 'this folder': 'this reports folder' },
  /* A bare "reports" in plain prose is the English word, not the folder: it is a path in a code span, quoted, as a link
     target, with ./, a slash or a backslash, or named as "the reports folder". Those words take no quotes or backticks. */
  skip: (form, wrap, place) => (form === 'root' && wrap === 'bare' && !LINKY(place)) || (/^(?:the|your|its|their|this) /.test(form) && wrap !== 'bare')
};
const PROHIBIT = { at: 'start', words: 'Never' };
const DELETE = {
  before: 'Delete', after: 'and run install again',
  forms: { '<version>': '.flightdeck/updates/<version>/AGENTS.md', 'concrete': '.flightdeck/updates/2.15.0/AGENTS.md', './': './.flightdeck/updates/2.15.0/AGENTS.md',
    '<team folder>/': '<team folder>/.flightdeck/updates/2.15.0/AGENTS.md', 'Windows': '.flightdeck\\updates\\2.15.0\\AGENTS.md',
    'folder/': '.flightdeck/updates/2.15.0/', 'folder': '.flightdeck/updates/2.15.0', 'folder\\ Windows': '.flightdeck\\updates\\2.15.0\\',
    'the folder': 'the updates folder', 'the directory': 'the updates directory', 'your folder': 'your updates folder', 'its directory': 'its updates directory' },
  skip: (form, wrap) => /^(?:the|your|its|their|this) /.test(form) && wrap !== 'bare'
};
const CONDITION = { at: 'end', words: 'only if nobody changed it' };

module.exports = { variants, PLACES, WRAPS, WRITE, PROHIBIT, DELETE, CONDITION };
