// Find things in big folders (2.11), code review round 13: every selector built from data goes through an escape. An id from a
// file can hold a quote, a backslash or a newline; a selector that leaves one raw is invalid, and querySelector throws, which
// interrupts the redraw (finding 3: a plan id with a newline as Planned's Show more target).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');
const { fixture, into } = require('./bounds-fixture');

const UI = path.join(__dirname, '..', 'src', 'ui');
const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/* Every selector a source builds by joining a string literal and an expression: a literal (no markup in it) ending in an
   attribute test's opening quote ([data-id=") or in an id test (#, #prefix-), and the expression joined after it. Returns
   { file, line, key, expr }, key naming the place by its attribute or id prefix (stable as lines move). */
function selectorJoins(src, file) {
  const out = [], LIT = /'((?:[^'\\\n]|\\.)*)'\s*\+\s*/g;
  let m;
  while ((m = LIT.exec(src))) {
    const lit = m[1];
    if (lit.indexOf('<') >= 0) continue;
    const attr = /\[([\w-]+)="$/.exec(lit), hash = /(?:^|[\s,>])(#[\w-]*)$/.exec(lit);
    if (!attr && !hash) continue;
    let i = m.index + m[0].length, depth = 0, q = null, e = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) { e += c; if (c === '\\') { e += src[++i]; continue; } if (c === q) q = null; continue; }
      if (c === "'" || c === '"') { q = c; e += c; continue; }
      if ('([{'.includes(c)) depth++;
      if (')]}'.includes(c)) { if (!depth) break; depth--; }
      if (!depth && '+;,:?'.includes(c)) break;
      e += c;
    }
    const act = /\[data-act="([\w-]+)"\]/.exec(lit);
    out.push({ file, line: src.slice(0, m.index).split('\n').length, key: attr ? (act ? act[1] + ' ' : '') + '[' + attr[1] + ']' : hash[1], expr: e.trim() });
  }
  return out;
}
/* Escaped (K.cssStr, cssEsc, PF.vk.cssStr), or a hash of the data (K.domKey, a report card's id), or one of two words. */
const ESCAPED = /^(?:(?:K\.|PF\.vk\.)?cssStr|cssEsc|(?:K\.)?domKey|K\.domKey|cardId|V\.reportCardId)\(/;
const WORDS = /^\([^()]*\?\s*'[\w-]+'\s*:\s*'[\w-]+'\)$/;
/* The joins left as they are, each with why its value can't hold a character a selector would need escaped, and how many
   there are. A new join of data into a selector isn't here, so the check fails until it's escaped. */
const FIXED = 'one of a fixed set of words, chosen in code', BOXID = 'a box id this code builds from a fixed prefix and a [\\w-]+ name (outline field names, ob- boxes)';
const ALLOWED = {
  'app.js|ob-shot-move [data-id]|(+id + (res.same ? 0 : up ? -1 : 1))': [1, 'a number'],
  'app.js|[data-split]|key': [2, 'a pane split\'s name from the code\'s pane specs'],
  'app.js|[data-id]|scope': [1, 'draft or type, set in code'],
  'app.js|[data-mode]|f.mode': [1, FIXED],
  'app.js|[data-status]|k': [1, 'a follow-up status checked against PF.followups.LABEL'],
  'app.js|[data-track]|a.track': [2, 'a lane number'],
  'app.js|[data-track]|k': [1, 'a lane number (+dataset.track)'],
  'app.js|[data-track]|s.track': [1, 'a lane number'],
  'app.js|[data-act]|act': [1, 'an action name from the code'],
  'app.js|flight [data-id]|state.clView': [1, FIXED],
  'app.js|lib-tab [data-id]|state.libTab': [1, FIXED],
  'app.js|nav [data-id]|id': [1, 'a section name, checked against V.sectionOf'],
  'app.js|tf-add [data-id]|id': [1, 'f or e'],
  'app.js|tf-open [data-id]|parts[0]': [2, 'f or e, then a row key the type form makes (k1, k2…)'],
  'app.js|theme [data-id]|id': [1, 'system, light or dark, checked'],
  'app.js|[data-for]|partDrag.kind': [1, 'a part kind set in code'],
  'app.js|#|(field || e.field || \'corr-to\')': [1, 'a correction form box id set in code'],
  'app.js|#|(state.obMarkFrom || (mk === \'~\' ? \'ob-planned\' : \'ob-must\'))': [1, BOXID],
  'app.js|#|ae.id': [1, 'only when it is letters, digits, _ and - (tested beside it); otherwise PF.vk.byId'],
  'app.js|#|bid': [2, 'ob-add-role or ob-add-ctx'],
  'app.js|#|box': [2, BOXID + '; a type form option box (tf-f-k1-optadd)'],
  'app.js|#|f.mode': [1, 'not a selector: a draft key (step#mode)'],
  'app.js|#|field': [3, BOXID + '; the add-to-run dialog\'s own box ids'],
  'app.js|#|focus': [1, 'ob-add-role or ob-add-ctx, tested beside it'],
  'app.js|#|id': [7, BOXID + '; a type form control\'s own id'],
  'app.js|#|pf': [1, BOXID],
  'app.js|#|v': [1, 'not a selector: a message, "#tag is already a tag"'],
  'app.js|#ins-t-|id': [1, 'selected, checks, preview or practice, checked'],
  'app.js|#tf-|id': [1, 'f or e'],
  'app.js|#tf-|p[0]': [2, 'f or e, then a row key the type form makes'],
  'app.js|corr-filter [data-id]|state.fixFilter': [1, FIXED],
  'app.js|ob-role-add [data-id]|nr.at': [1, 'gate, step or track, checked'],
  'app.js|fu-filter [data-id]|state.fuFilter': [1, FIXED],
  'app.js|hist-mode [data-id]|ov.mode': [1, FIXED],
  'app.js|nc-open [data-kind]|kind': [1, 'gate or phase'],
  'app.js|setup-tpl [data-id]|id': [1, 'a built-in template\'s id'],
  'app.js|corr-scope [data-id]|f.scope': [1, 'fix or just'],
  'exporter.js|#|(o.fieldErr || \'ev-proc\')': [1, 'the export dialog\'s own box ids'],
  'exporter.js|ev-format [data-id]|o.format': [1, 'report or pack'],
  'views/builder.js|ob-meta-del [data-key]|key': [1, 'roles or context'],
  'views/common.js|#|esc(t)': [1, 'not a selector: a tag drawn as text, #tag'],
  'views/insights.js|#ins-note-|k': [1, 'a K.domKey hash'],
  'views/manage.js|#|t': [1, 'not a selector: a tag in a summary line'],
  'views/overlays.js|#hist-|k': [1, 'm plus a K.domKey hash'],
  'views/reports.js|#repbad-|String(k).slice(4)': [1, 'a K.domKey hash after bad#']
};
function sources() {
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.js$/.test(f)) files.push(p); } })(UI);
  return files;
}
function unescaped(src, file) { return selectorJoins(src, file).filter(j => !ESCAPED.test(j.expr) && !WORDS.test(j.expr)); }

rule('Round 13: every selector src/ui builds from data escapes it (K.cssStr, cssEsc, PF.vk.byId) or is listed with why it can\'t need to', () => {
  /* The check itself: it finds a selector joined with an unescaped value, and passes an escaped one. */
  const bad = unescaped("x = '[data-act=\"review-plan\"][data-key=\"' + String(k).replace(/[\"\\\\]/g, '\\\\$&') + '\"]'; y = '#role-' + gap.role;", 't.js');
  assert.deepStrictEqual(bad.map(j => j.key + ' ' + j.expr.slice(0, 17)), ['review-plan [data-key] String(k).replace', '#role- gap.role'], JSON.stringify(bad));
  assert.deepStrictEqual(unescaped("x = '[data-key=\"' + K.cssStr(k) + '\"]'; y = '#' + cssEsc('role-' + r); z = '<b data-id=\"' + esc(v) + '\">';", 't.js'), []);
  const seen = {}, fails = [];
  sources().forEach(p => {
    const file = path.relative(UI, p).split(path.sep).join('/');
    unescaped(fs.readFileSync(p, 'utf8'), file).forEach(j => { const k = file + '|' + j.key + '|' + j.expr; (seen[k] = seen[k] || []).push(j.line); });
  });
  Object.keys(seen).forEach(k => {
    if (!ALLOWED[k]) fails.push(k.split('|')[0] + ':' + seen[k].join(',') + ' joins ' + k.split('|')[2].slice(0, 80) + ' into ' + k.split('|')[1] + ' unescaped');
    else if (seen[k].length > ALLOWED[k][0]) fails.push(k + ': ' + seen[k].length + ' joins, ' + ALLOWED[k][0] + ' listed (lines ' + seen[k].join(',') + ')');
  });
  Object.keys(ALLOWED).forEach(k => { if (!seen[k]) fails.push('listed but gone: ' + k); });
  assert.deepStrictEqual(fails, []);
});
rule('Round 13: a plan whose id holds a newline, Planned\'s Show more target past page one, gets a valid focus selector and takes focus (finding 3)', async () => {
  const fx = fixture({ size: { procs: 3, tags: 3, people: 10, followUps: 3, running: 3, plans: 60, versions: 3, stages: 2, members: 3, health: 3, many: 3, ended: 3, steps: 8, teamValues: 3, legacy: 3, archived: 3, hot: 3 } });
  const files = Object.assign({}, fx.files), odd = 'plan-00050\nline';
  const p50 = JSON.parse(files['proposals/plan-00050.json']); p50.id = odd;
  delete files['proposals/plan-00050.json']; files['proposals/plan-odd.json'] = JSON.stringify(p50, null, 2) + '\n';
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, { files, facts: fx.facts });
  app.click('nav', 'runs'); await app.tick(10);
  const h = app.html(), m = /<button[^>]*data-act="more" data-id="runs-planned"([^>]*)>/.exec(h);
  assert.ok(m, 'set-up: Planned has Show more');
  const d = {}; m[1].replace(/data-([\w-]+)="([^"]*)"/g, (x, k, v) => { d[k] = un(v); return x; });
  assert.strictEqual(d.next, odd, 'set-up: the plan with a newline in its id is the first Show more adds');
  assert.ok(!/[\0-\x1f\x7f]/.test(d.focus), 'the focus selector holds no raw control character: ' + JSON.stringify(d.focus));
  app.click('more', 'runs-planned', d); await app.tick(5);
  const a = app.doc.activeElement;
  assert.ok(a && a.dataset && a.dataset.act === 'review-plan' && un(a.dataset.id) === odd, 'focus on that plan\'s card: ' + JSON.stringify(a && a.dataset));
});
run();
