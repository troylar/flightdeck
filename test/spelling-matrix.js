'use strict';
/* The spelling matrix the text guards are tested against: one instruction, in every place Markdown can hold it and with its
   path written every way a maintainer plausibly would, so a guard is checked against spellings nobody has reported yet. A
   variant is { place, form, wrap, md }. sentence(p) is the instruction's words around the path p, with no final period. */
const PLACES = {
  paragraph: (s) => s(false) + '.',
  wrapped: (s) => s(true) + '.',
  h1: (s) => '# ' + s(false), h2: (s) => '## ' + s(false), h3: (s) => '### ' + s(false),
  h4: (s) => '#### ' + s(false), h5: (s) => '##### ' + s(false), h6: (s) => '###### ' + s(false),
  'list item': (s) => '- ' + s(false) + '.',
  'nested list item': (s) => '- First, read the run.\n  - ' + s(false) + '.',
  blockquote: (s) => '> ' + s(true).split('\n').join('\n> ') + '.',
  'table cell': (s) => '| Step | What to do |\n|---|---|\n| 1 | ' + s(false) + '. |',
  'link text': (s) => '[' + s(false) + '](https://example.com/help).',
  'link target': null,
  'bold lead-in': (s) => '**' + s(false) + ':** then say you did.',
  'italic lead-in': (s) => '*' + s(false) + ':* then say you did.'
};
const WRAPS = { bare: (x) => x, backticked: (x) => '`' + x + '`', 'double-quoted': (x) => '"' + x + '"', 'single-quoted': (x) => '\'' + x + '\'',
  'double-quoted in backticks': (x) => '`"' + x + '"`', 'single-quoted in backticks': (x) => '`\'' + x + '\'`' };

/* before and after: the words around the path; forms: { name: path }; cond: words that make it allowed (a condition or a
   prohibition), as { at: 'start' | 'end', words }. Returns the variants, and with cond, the allowed twin of each. */
function variants({ before, after, forms, skip }, cond) {
  const out = [];
  Object.keys(PLACES).forEach((place) => Object.keys(forms).forEach((form) => Object.keys(WRAPS).forEach((wrap) => {
    if (skip && skip(form, wrap)) return;
    const p = WRAPS[wrap](forms[form]);
    let pre = before, post = after || '';
    if (cond && cond.at === 'start') pre = cond.words + ' ' + pre.charAt(0).toLowerCase() + pre.slice(1);
    if (cond && cond.at === 'end') post = (post ? post + ' ' : '') + cond.words;
    const tail = post ? ' ' + post : '';
    let md;
    if (place === 'link target') {
      if (wrap !== 'bare' || /\s/.test(forms[form])) return;
      md = pre + ' [the file](' + forms[form] + ')' + tail + '.';
    } else md = PLACES[place]((wrapIt) => pre + (wrapIt ? '\n' : ' ') + p + tail);
    out.push({ place, form, wrap, md });
  })));
  return out;
}

const WRITE = {
  before: 'Write the report to', after: 'directly',
  forms: { path: 'reports/release/report.json', './': './reports/release/report.json', '<team folder>/': '<team folder>/reports/release/report.json',
    'Windows': 'reports\\release\\report.json', '.\\ Windows': '.\\reports\\release\\report.json', 'root/': 'reports/', 'root': 'reports', 'root\\ Windows': 'reports\\' },
  /* A bare "reports" in plain prose is the English word, not the folder: it is a path only in a code span, quoted, or with
     ./, a slash or a backslash. */
  skip: (form, wrap) => form === 'root' && wrap === 'bare'
};
const PROHIBIT = { at: 'start', words: 'Never' };
const DELETE = {
  before: 'Delete', after: 'and run install again',
  forms: { '<version>': '.flightdeck/updates/<version>/AGENTS.md', 'concrete': '.flightdeck/updates/2.15.0/AGENTS.md', './': './.flightdeck/updates/2.15.0/AGENTS.md',
    '<team folder>/': '<team folder>/.flightdeck/updates/2.15.0/AGENTS.md', 'Windows': '.flightdeck\\updates\\2.15.0\\AGENTS.md',
    'folder/': '.flightdeck/updates/2.15.0/', 'folder': '.flightdeck/updates/2.15.0', 'folder\\ Windows': '.flightdeck\\updates\\2.15.0\\' }
};
const CONDITION = { at: 'end', words: 'only if nobody changed it' };

module.exports = { variants, PLACES, WRAPS, WRITE, PROHIBIT, DELETE, CONDITION };
