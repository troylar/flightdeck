'use strict';
/* The one Markdown prose reader the text guards share (inventory check g, the docs delete guard), so a sentence reads the same
   to both. Lines outside fenced code (the contract's prose() rule, asserted line for line) are joined into paragraphs: a blank
   line, a list item, a heading, a fence or a table row starts a new one, so a soft-wrapped sentence is read whole. A sentence
   ends only at ., ! or ? followed by whitespace or the end of the paragraph, outside code spans, so a period inside a path
   (`.flightdeck`, `2.15.0`) never ends one. Each sentence carries its paragraph's key: the nearest heading path and the
   paragraph's bold lead-in (`**Without the command:**`). Source-code files don't come here: their callers split by line. */
const { load } = require('./harness');
const R = load().contract;

function fenceOf(l) {
  let i = 0; while (i < 4 && i < l.length && l[i] === ' ') i++;
  if (i > 3) return null;
  const c = l[i]; if (c !== '`' && c !== '~') return null;
  let j = i; while (j < l.length && l[j] === c) j++;
  return j - i < 3 || /[\u2028\u2029]/.test(l.slice(j)) ? null : { ch: c, n: j - i, end: j };
}
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const STARTS = (l) => ITEM.test(l) || HEADING.test(l) || /^\s*\|/.test(l);
const LEAD = /^\*\*([^*]+?)\*\*/;

function sentencesOf(text) {
  const out = []; let cur = '', tick = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; cur += c;
    if (c === '`') tick = !tick;
    else if (!tick && (c === '.' || c === '!' || c === '?') && (i + 1 === text.length || /\s/.test(text[i + 1]))) { out.push(cur); cur = ''; }
  }
  out.push(cur);
  return out.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/* [{ text, at (heading path, ' > ' between levels), lead (the bold lead-in, or ''), line (where the paragraph starts) }] */
function proseSentences(md) {
  const lines = R.norm(md).split('\n'), kept = [], paras = [], path = [];
  let fence = null, cur = null;
  const close = () => { if (cur) paras.push(cur); cur = null; };
  lines.forEach((l, i) => {
    const f = fenceOf(l);
    if (fence) { if (f && f.ch === fence.ch && f.n >= fence.n && /^[ \t]*$/.test(l.slice(f.end))) fence = null; return; }
    if (f && !(f.ch === '`' && l.indexOf('`', f.end) >= 0)) { fence = f; close(); return; }
    kept.push(l);
    if (!l.trim()) { close(); return; }
    const h = HEADING.exec(l);
    if (h && !/[\u2028\u2029]/.test(l)) { close(); path.length = h[1].length - 1; path[h[1].length - 1] = (h[2] || '').trim(); return; }
    if (!cur || STARTS(l)) { close(); cur = { text: l, at: path.filter((x) => x != null).join(' > '), line: i + 1 }; } else cur.text += '\n' + l;
  });
  close();
  const want = R.prose(md);
  if (kept.length !== want.length || kept.some((l, i) => l !== want[i])) throw new Error('prose-reader: fences disagree with the contract\'s prose()');
  return paras.flatMap((p) => {
    const body = p.text.replace(ITEM, ''), m = LEAD.exec(body.trim()), lead = m ? m[1].trim() : '';
    return sentencesOf(body).map((text) => ({ text, at: p.at, lead, line: p.line }));
  });
}

/* The protected roots, matched on paths after normalizing: surrounding backticks and quotes go, so do `./` and a leading
   `<team folder>/`, and a root counts with or without its trailing slash. A bare root word counts only as a whole code span
   (`reports`) or with `./`: in plain prose "reports" is a word, and in `flightdeck runs <team folder>` a command. */
const ROOT = /^(?:maps\/drafts|runs|reports|report-decisions|step-types|\.flightdeck[-/]updates)(?:\/|$)/;
const STAGED = /(?:^|\/)updates\/(?:<version>|\d+\.\d+\.\d+)\/AGENTS\.md$/;
function pathsOf(sentence) {
  const out = [], codes = [], lead = /<[^>]*>\/(?=(?:maps|runs|reports|report-decisions|step-types|\.flightdeck)\b)/g;
  const plain = sentence.replace(lead, '').replace(/`([^`]*)`/g, (m, c) => { codes.push(c.replace(lead, '')); return ' '; });
  const norm = (t, bare, code) => {
    let p = code ? t.trim() : t.trim().replace(/^["'(\[]+|["')\],.;:!?]+$/g, '');
    const dot = /^\.\//.test(p);
    while (/^\.\//.test(p)) p = p.slice(2);
    if (!bare && !dot && p.indexOf('/') < 0) return;
    if (ROOT.test(p) || STAGED.test(p)) out.push(p);
  };
  codes.forEach((c) => { const ts = c.trim().split(/\s+/); ts.forEach((t) => norm(t, ts.length === 1, true)); });
  plain.split(/\s+/).forEach((t) => norm(t, false, false));
  return out;
}

module.exports = { proseSentences, sentencesOf, pathsOf };
