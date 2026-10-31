// Find things in big folders (2.11), code review round 13: every selector built from data goes through an escape. An id from a
// file can hold a quote, a backslash or a newline; a selector that leaves one raw is invalid, and querySelector throws, which
// interrupts the redraw (finding 3: a plan id with a newline as Planned's Show more target).
// Code review round 14: an id from a file can also be a name every plain object already has (constructor, __proto__,
// toString, hasOwnProperty). A lookup keyed by one is made without a prototype (Object.create(null)), so it never reads an
// inherited value as the item's own.
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
  'app.js|#|e.field': [1, 'inside mutateRun, which this release leaves byte for byte as in 2.10.0; a run field id is a [\\w-]+ name from its type'],
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
  'views/insights.js|#ins_note_|k': [1, 'a K.domKey id part (letters, digits and _)'],
  'views/manage.js|#|t': [1, 'not a selector: a tag in a summary line'],
  'views/overlays.js|#hist-|k': [1, 'm plus a K.domKey id part (letters, digits and _)'],
  'views/reports.js|#repbad-|String(k).slice(4)': [1, 'a K.domKey id part (letters, digits and _) after bad#']
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
/* ---------- Round 14: lookups keyed by data from the folder have no prototype ---------- */
/* Every lookup a source makes on a plain object literal: an object declared as {} (var x = {}, x = {}) and indexed later in
   the file with a key that isn't a literal, or (expr || {})[key]. A key joined with a literal holding a character no
   Object.prototype name has (':', '/', a newline...) is safe whatever the rest is, so it isn't listed. Returns
   { line, name, key }. */
function plainLookups(src) {
  const out = [], lineOf = i => src.slice(0, i).split('\n').length;
  const inner = i => { let d = 0, q = null, e = ''; for (; i < src.length; i++) { const c = src[i]; if (q) { e += c; if (c === '\\') { e += src[++i]; continue; } if (c === q) q = null; continue; } if (c === "'" || c === '"') { q = c; e += c; continue; } if ('([{'.includes(c)) d++; if (')]}'.includes(c)) { if (!d) break; d--; } e += c; } return e.trim(); };
  const safeKey = e => /^(?:'[^']*'|"[^"]*"|\d+)$/.test(e) || /'(?:[^'\\]|\\.)*[^A-Za-z0-9_$'\\](?:[^'\\]|\\.)*'/.test(e.replace(/\\n/g, '\n'));
  let m;
  const INL = /\|\|\s*\{\}\)\s*\[/g;
  while ((m = INL.exec(src))) { const e = inner(m.index + m[0].length); if (!safeKey(e)) out.push({ line: lineOf(m.index), name: '(… || {})', key: e }); }
  const DECL = /(?:\b(?:var|let|const)\s+|,\s*|[;{]\s*)([A-Za-z_$][\w$]*)\s*=\s*\{\}/g;
  while ((m = DECL.exec(src))) {
    const name = m[1], from = m.index + m[0].length, again = new RegExp('(?:\\b(?:var|let|const)\\s+|,\\s*|[;{]\\s*)' + name.replace(/\$/g, '\\$') + '\\s*=(?!=)', 'g');
    again.lastIndex = from; const nx = again.exec(src), to = nx ? nx.index : src.length;
    const use = new RegExp('(?<![\\w$.])' + name.replace(/\$/g, '\\$') + '\\[', 'g'); use.lastIndex = from; let u;
    while ((u = use.exec(src)) && u.index < to) { const e = inner(u.index + u[0].length); if (!safeKey(e)) out.push({ line: lineOf(u.index), name, key: e }); }
  }
  return out;
}
/* The plain-object lookups left as they are in src/ui/views, each with why its key can't be a name Object.prototype has, or
   why it is left (pre-existing: as in 2.10.0, not changed by 2.11), and how many there are. A new one isn't here, so the
   check fails until it is made with Object.create(null), a Map, or an own-property test. */
const PREFIXED = 'a key this code builds with a fixed prefix holding a colon (ob-stale:, dupes:, repdiff:...)', RUNKEY = 'a run key (process/id): it always holds a slash';
const LISTID = 'a list\'s paging id, a fixed name or a fixed prefix with a colon set in code', PANE = 'a pane name from the code\'s PANES specs';
const PRE = 'pre-existing (as in 2.10.0, not changed by 2.11): ';
const LOOKUPS_OK = {
  'views/builder.js|(… || {})|sk': [2, PREFIXED],
  'views/builder.js|(… || {})|dk': [1, PRE + 'a disclosure key, a field id, a colon and the checklist id'],
  'views/builder.js|u|s.type': [1, PRE + 'written before any read; read back only by Object.keys'],
  'views/builder.js|P|k': [2, PRE + 'step, lanes, gate or phase, from a fixed list'],
  'views/builder.js|P|pt.kind': [1, PRE + 'a part kind set in code'],
  'views/common.js|(… || {})|id': [4, LISTID],
  'views/common.js|(… || {})|key': [2, PRE + PANE],
  'views/common.js|chosen|it.key': [2, PRE + PANE],
  'views/common.js|chosen|k': [1, PRE + PANE],
  'views/common.js|out|it.key': [1, PRE + PANE],
  'views/common.js|w|it.key': [4, PRE + PANE],
  'views/common.js|w|k': [2, PRE + PANE],
  'views/detailbox.js|d|n': [1, PRE + 'a run detail name: a map refuses one Object.prototype has (map.js reserved)'],
  'views/flight.js|(… || {})|p.id': [1, PRE + 'state.fpSteps is made with Object.create(null) (fpStepsKept); {} only stands in before it is set'],
  'views/home.js|(… || {})|runKey(r)': [2, RUNKEY],
  'views/insights.js|(… || {})|p.id': [1, 'state.insFolder is made with Object.create(null); {} only stands in before it is set'],
  'views/insights.js|status|k': [2, PRE + RUNKEY],
  'views/insights.js|by|k': [2, PRE + RUNKEY],
  'views/manage.js|at|id': [2, PRE + 'a type form control id, tf- and a name'],
  'views/overlays.js|teamOf|e.name': [1, PRE + 'a pass name: PF.links refuses one Object.prototype has (links.js reserved)'],
  'views/overlays.js|teamOf|f': [2, PRE + 'a pass name: PF.links refuses one Object.prototype has (links.js reserved)'],
  'views/overlays.js|teamOf|k': [1, PRE + 'a pass name: PF.links refuses one Object.prototype has (links.js reserved)'],
  'views/process.js|(… || {})|k': [1, PREFIXED],
  'views/process.js|(… || {})|sdk': [1, PREFIXED],
  'views/process.js|(… || {})|lbk': [1, PREFIXED],
  'views/process.js|(… || {})|cmpKey': [1, PREFIXED],
  'views/process.js|(… || {})|p.draft.file': [1, PRE + 'a draft file name; the value is only shown as why it can\'t be read'],
  'views/process.js|(… || {})|p.id': [1, 'state.startModeAt is made with Object.create(null); {} only stands in before it is set'],
  'views/reports.js|(… || {})|k': [1, PREFIXED],
  'views/reports.js|(… || {})|g.key': [1, 'a report\'s identity, process/run/step/producer/id: it always holds a slash'],
  'views/run.js|(… || {})|r.id': [1, 'state.pendingSaves is made with Object.create(null); {} only stands in before it is set'],
  'views/run.js|(… || {})|s.id': [1, PRE + 'the run file\'s own fields object, keyed by step id'],
  'views/run.js|(… || {})|st.id': [1, PRE + 'the run file\'s own fields object, keyed by step id'],
  'views/run.js|(… || {})|runKey(r)': [3, RUNKEY],
  'views/run.js|(… || {})|nd': [1, PREFIXED],
  'views/run.js|(… || {})|to.v': [1, 'a destination value, process/id or plan:id, so it always holds a slash or a colon'],
  'views/setup.js|out|x.k': [1, PRE + 'me or a row key the setup form makes']
};
rule('Round 14: no lookup in src/ui/views reads a plain object by a key from the folder unless it is listed with why it can\'t be an inherited name', () => {
  /* The check itself: it finds a counter and a fallback read by an id, and passes Object.create(null) and a prefixed key. */
  const bad = plainLookups("var nth = {}; a.forEach(function (p) { nth[p.id] = (nth[p.id] || 0) + 1; }); x = (st.more || {})[p.id];");
  assert.deepStrictEqual(bad.map(x => x.name + '[' + x.key + ']'), ['(… || {})[p.id]', 'nth[p.id]', 'nth[p.id]'], JSON.stringify(bad));
  assert.deepStrictEqual(plainLookups("var nth = Object.create(null); nth[p.id] = 1; y = (st.disc || {})['fx:' + p.id]; var o = {}; o['a'] = 1; z = (s.m || {})[ctx.fsKey + '\\n' + p.id];"), []);
  const seen = {}, fails = [];
  fs.readdirSync(path.join(UI, 'views')).filter(f => /\.js$/.test(f)).forEach(f => {
    plainLookups(fs.readFileSync(path.join(UI, 'views', f), 'utf8')).forEach(x => { const k = 'views/' + f + '|' + x.name + '|' + x.key; (seen[k] = seen[k] || []).push(x.line); });
  });
  Object.keys(seen).forEach(k => {
    if (!LOOKUPS_OK[k]) fails.push(k.split('|')[0] + ':' + seen[k].join(',') + ' reads ' + k.split('|')[1] + '[' + k.split('|')[2] + '] on a plain object');
    else if (seen[k].length > LOOKUPS_OK[k][0]) fails.push(k + ': ' + seen[k].length + ' reads, ' + LOOKUPS_OK[k][0] + ' listed (lines ' + seen[k].join(',') + ')');
  });
  Object.keys(LOOKUPS_OK).forEach(k => { if (!seen[k]) fails.push('listed but gone: ' + k); });
  assert.deepStrictEqual(fails, []);
});

const PROTO = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];
const SMALL = { procs: 3, tags: 3, people: 10, followUps: 3, running: 3, plans: 3, versions: 3, stages: 2, members: 3, health: 3, many: 3, ended: 3, steps: 8, teamValues: 3, legacy: 3, archived: 3, hot: 3 };
async function protoApp(size, edit) {
  const fx = fixture({ size: Object.assign({}, SMALL, size) }), files = Object.assign({}, fx.files);
  edit(files);
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, { files, facts: fx.facts });
  return app;
}
function moreData(h, id) {
  const m = new RegExp('<button[^>]*data-act="more" data-id="' + id.replace(/[-/:.#]/g, '\\$&') + '"([^>]*)>').exec(h); if (!m) return null;
  const d = {}; m[1].replace(/data-([\w-]+)="([^"]*)"/g, (x, k, v) => { d[k] = un(v); return x; }); return d;
}
/* Planned (finding 1): two differing copies of each, the first ending page one; each is drawn once, the first copy with the card's id. */
async function protoPlanned() {
  const app = await protoApp({ plans: 60 }, files => {
    /* 49 ordinary plans, soonest first, then two differing copies of each id: the first one ends page one. */
    for (let i = 49; i < 60; i++) {
      const f = 'proposals/plan-000' + i + '.json', p = JSON.parse(files[f]); delete files[f];
      const j = i - 49; if (j >= 8) continue;
      p.id = PROTO[j >> 1]; p.title = 'Copy ' + (j & 1 ? 'B' : 'A') + ' of ' + p.id;
      files['proposals/' + p.id + (j & 1 ? ' (1)' : '') + '.json'] = JSON.stringify(p, null, 2) + '\n';
    }
  });
  app.click('nav', 'runs'); await app.tick(10);
  let h = app.html();
  const cards = html => [...html.matchAll(/<button class="card plan"([^>]*)>/g)].map(m => { const d = {}; m[1].replace(/(id|data-id|data-key)="([^"]*)"/g, (x, k, v) => { d[k] = un(v); return x; }); return d; });
  assert.ok(/id="planned-h">Planned · 59</.test(h), 'set-up: Planned counts 49 plans, 8 copies and the folder\'s own 2 plans, which come last');
  assert.strictEqual(cards(h).length, 50, 'a page of 50');
  const d = moreData(h, 'runs-planned');
  assert.ok(d, 'Show more is there for the 7 copies and 2 plans past the page');
  app.click('more', 'runs-planned', d); await app.tick(5);
  h = app.html();
  const all = cards(h), keys = all.map(c => c['data-key']);
  assert.strictEqual(all.length, 59, 'every plan and every copy drawn');
  assert.strictEqual(new Set(keys).size, 59, 'each with its own paging key: ' + JSON.stringify(keys.slice(48)));
  PROTO.forEach(id => {
    const mine = all.filter(c => c['data-id'] === id);
    assert.strictEqual(mine.length, 2, 'both copies of ' + id);
    assert.deepStrictEqual(mine.map(c => c.id || null), ['card-' + id, null], 'the first copy of ' + id + ' has the card\'s id, and only it');
  });
  const a = app.doc.activeElement;
  assert.ok(a && a.dataset && a.dataset.act === 'review-plan' && un(a.dataset.key) === all[50]['data-key'], 'focus on the first card Show more added: ' + JSON.stringify(a && a.dataset));
}
/* A step's notes: two of each, across the thread's Show earlier boundary; each is drawn once, by its own key, with its own text. */
async function protoNotes() {
  const app = await protoApp({}, files => {
    const p = Object.keys(files).find(f => /notes-busy-s1\.jsonl$/.test(f)), lines = files[p].split('\n').filter(Boolean).map(l => JSON.parse(l));
    const ahead = lines.find(n => n.id === 'ahead09'), t0 = Date.parse(ahead.at);
    /* After ahead09, before ahead10: 15 newer notes, so the newest 20 hold 5 of these 8 and Show earlier the other 3. */
    PROTO.forEach((id, i) => [0, 1].forEach(c => lines.push({ id, at: new Date(t0 + (i * 2 + c + 1) * 5000).toISOString(), by: 'person-blake', session: 'busy-s1', step: 's0', text: 'Note ' + id + ' copy ' + (c + 1) })));
    files[p] = lines.map(x => JSON.stringify(x)).join('\n') + '\n';
  });
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', fixture({ size: SMALL }).facts.busy); await app.tick(10);
  app.click('select', 's0'); await app.tick(10);
  const thread = h => [...h.slice(h.indexOf('id="ins-notes"')).matchAll(/<li id="tn-s0-([^"]+)" tabindex="-1"/g)].map(m => un(m[1]));
  const want = [].concat(...PROTO.map(id => [id, id + '#2']));
  let t = thread(app.html());
  assert.strictEqual(t.length, 20, 'the newest 20');
  assert.deepStrictEqual(want.filter(k => t.indexOf(k) >= 0), want.slice(3), 'set-up: 5 of them on the first page');
  const d = moreData(app.html(), 'notes:' + fixture({ size: SMALL }).facts.busy + ':s0');
  assert.ok(d, 'Show earlier');
  app.click('more', d.id || ('notes:' + fixture({ size: SMALL }).facts.busy + ':s0'), d); await app.tick(5);
  t = thread(app.html());
  assert.deepStrictEqual(want.filter(k => t.indexOf(k) >= 0), want, 'all 8 drawn, by their own keys');
  assert.strictEqual(new Set(t).size, t.length, 'none drawn twice');
  want.forEach((k, i) => { const li = app.html().slice(app.html().indexOf('id="tn-s0-' + k + '"')); assert.ok(li.slice(0, li.indexOf('</li>')).indexOf('Note ' + PROTO[i >> 1] + ' copy ' + (i % 2 + 1)) >= 0, k + ' shows its own text'); });
}
/* Checklists: one in a group of each name, one with the id constructor, across the page boundary; each drawn once, in its own group.
   (A run id can be constructor or toString too: test/patch-2111.test.js.) */
async function protoChecklists() {
  const md = (id, g) => '---\nprocess: ' + id + '\ntitle: Checklist in ' + g + '\ncategory: Synthetic\ngroup: ' + g + '\nowner: person-avery\nroles: lead\n---\n\n## Phase 1 · READ-DO {#ph1}\n- [ ] {confirm} Do it @lead {#s1}\n';
  const ids = PROTO.map((g, i) => i ? 'proto-' + i : 'constructor');
  const app = await protoApp({ procs: 60 }, files => { PROTO.forEach((g, i) => { files['maps/drafts/' + ids[i] + '.md'] = md(ids[i], g); }); });
  app.click('nav', 'processes'); await app.tick(10);
  const drawn = h => { const s = h.slice(h.indexOf('id="procs-all"')); return [...s.matchAll(/data-act="open-process" data-id="([^"]+)"/g)].map(m => un(m[1])); };
  let list = drawn(app.html());
  const first = ids.filter(k => list.indexOf(k) >= 0);
  assert.ok(first.length > 0 && first.length < 4, 'set-up: the page boundary falls among them: ' + JSON.stringify(first));
  for (let i = 0, d; i < 5 && (d = moreData(app.html(), 'processes')); i++) { app.click('more', 'processes', d); await app.tick(5); }
  const h = app.html(); list = drawn(h);
  assert.strictEqual(new Set(list).size, list.length, 'none drawn twice');
  ids.forEach((k, i) => {
    assert.strictEqual(list.filter(x => x === k).length, 1, k + ' drawn once');
    const g = h.indexOf('data-group="' + PROTO[i] + '"'), at = h.indexOf('data-act="open-process" data-id="' + k + '"'), next = h.indexOf('data-group=', g + 1);
    assert.ok(g >= 0 && at > g && (next < 0 || next > at), k + ' is in the group ' + PROTO[i]);
  });
}
rule('Round 14: ids constructor, __proto__, toString and hasOwnProperty across a page boundary are each drawn once, as themselves, on Planned, a step\'s notes and Checklists (finding 1)', async () => {
  await protoPlanned();
  await protoNotes();
  await protoChecklists();
});
run();
