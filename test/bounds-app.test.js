// Every list that grows with the team folder is drawn a page at a time (2.11). This boots the app on one big folder
// (test/bounds-fixture.js) and visits every screen, tab, fold and dialog, and every form an action opens, and checks two ways:
// - a registry of the bounded lists: each one's rows, counted across the screen, stay within its page (plus what's kept);
// - a catch-all: any element with more than 25 children of one tag and class that the registry doesn't know fails, with
//   where it is, unless it's exempt (with a reason) or still waiting for the slice that bounds it (PENDING).
// The registry is itself tested: PF.vk.PAGE_OFF turns paging off for one list, and the check must then fail for that list.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');
const { fixture, into } = require('./bounds-fixture');

/* ---------- the drawn HTML as a tree ---------- */
const VOID = /^(input|img|br|hr|meta|link|area|base|col|embed|source|track|wbr|circle|line|rect|path|polyline|polygon|ellipse|use)$/;
const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function parse(html) {
  const root = { tag: '#root', attrs: {}, kids: [], parent: null }, stack = [root], re = /<(\/?)([a-zA-Z][\w-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|<!--[\s\S]*?-->/g;
  let m;
  while ((m = re.exec(html))) {
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; } continue; }
    const attrs = {}; m[3].replace(/\s([\w:-]+)(?:="([^"]*)")?/g, (x, k, v) => { attrs[k] = v == null ? '' : un(v); return x; });
    const n = { tag, attrs, kids: [], parent: stack[stack.length - 1], at: m.index };
    n.parent.kids.push(n);
    if (tag === 'option') { const end = html.indexOf('<', re.lastIndex); n.text = un(html.slice(re.lastIndex, end < 0 ? html.length : end)); }
    if (!VOID.test(tag) && !/\/\s*$/.test(m[3])) stack.push(n);
  }
  return root;
}
function walk(n, fn) { fn(n); n.kids.forEach(k => walk(k, fn)); }
const cls = (n, c) => (' ' + (n.attrs.class || '') + ' ').indexOf(' ' + c + ' ') >= 0;
const up = (n, test) => { for (let x = n.parent; x; x = x.parent) if (test(x)) return x; return null; };
const within = (n, test) => !!up(n, test);
function where(n) { const p = []; for (let x = n; x && x.tag !== '#root'; x = x.parent) p.unshift(x.tag + (x.attrs.id ? '#' + x.attrs.id : '') + (x.attrs.class ? '.' + x.attrs.class.trim().split(/\s+/).join('.') : '')); return p.slice(-5).join(' > '); }

/* ---------- what may be drawn ---------- */
const people = fixture().facts.people, isPerson = new Set(people.map(p => p.id));
/* A select of people (or nobody): a person picker stays a native select, so its options are exempt. */
const personSelect = s => s && s.tag === 'select' && s.kids.filter(k => k.tag === 'option').every(o => o.attrs.value === '' || isPerson.has(o.attrs.value)) && s.kids.some(o => isPerson.has(o.attrs.value));

/* The bounded lists. rows: a node test, counted across the whole screen (aggregate), so many small lists that add up are caught;
   per: 'parent' counts each parent's rows instead (a function, each container it returns). count: for a list joined into one line, the number of names drawn. */
const REGISTRY = [
  /* Runs: Running 50, the 8 newest finished, Flagged 50, Earlier finished 50; a filtered or cohort list 50 instead. */
  { name: 'run cards (runs-running, runs-flagged, runs-ended, runs-filtered, runs-cohort)', rows: n => n.tag === 'button' && n.attrs.class === 'card' && n.attrs['data-act'] === 'open-run', bound: 50 + 8 + 50 + 50 },
  { name: 'How runs go, the duration table (ins-dur)', rows: n => n.tag === 'tr' && /^ins-row-/.test(n.attrs.id || ''), bound: 50 },
  { name: 'How runs go, steps that go off-script (ins-hot)', rows: n => n.tag === 'li' && cls(n, 'ins-step'), bound: 50 },
  { name: 'Folder health, the paths of one issue (hz-paths, 50 and "and N more")', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'hz-paths'), bound: 50, per: 'parent' },
  /* Checklist structure is drawn whole (below), at the checklist's own size: the biggest in the fixture has 400 steps and 300 phases. */
  { name: 'checklist steps, at the checklist\'s step count', rows: n => n.tag === 'li' && cls(n, 'step'), bound: 400 },
  { name: 'the duration chart, at its renderer\'s cap of 300 dots (insights.js)', rows: n => n.tag === 'a' && cls(n, 'ins-dot-a'), bound: 300 },
  { name: 'team values, at the format\'s cap of 100 (core/teamvalues.js)', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'tv-list'), bound: 100 },
  /* Checklists and All skills: 50 rows across the tree, and only their groups. */
  { name: 'the Checklists and All skills tree, its rows (processes, skills)', rows: n => n.tag === 'li' && !cls(n, 'tgroup') && n.parent && cls(n.parent, 'plist') && within(n, x => cls(x, 'tree')), bound: 50 },
  { name: 'the Checklists and All skills tree, its groups', rows: n => n.tag === 'li' && cls(n, 'tgroup'), bound: 50 },
  { name: 'the skill chips on a process row (5, then "+N more skills")', rows: n => n.tag === 'button' && cls(n, 'skillchip'), bound: 5, per: 'parent' },
  { name: 'the tag buttons (tags), 50 and the chosen ones', rows: n => n.tag === 'button' && cls(n, 'tag') && n.parent && cls(n.parent, 'tagbar'), bound: 50 },
  { name: 'a process\'s Skills panel (p-skills)', rows: n => n.tag === 'li' && n.parent && n.parent.tag === 'ul' && n.parent.attrs.class === 'plist' && within(n, x => x.attrs['aria-labelledby'] === 'sk-h' || /^sk:/.test(x.attrs['data-disc'] || '')), bound: 50 },
  { name: 'Skills, Needs an update (sk-att) and Ready to become a skill (sk-ready)', rows: n => n.tag === 'li' && n.parent && (cls(n.parent, 'plist') || cls(n.parent, 'rlist')) && within(n, x => x.attrs['aria-labelledby'] === 'att-h' || x.attrs['aria-labelledby'] === 'rdy-h'), bound: 50 + 50 },
  /* Home: Needs you, Your corrections and Your follow-ups, 10 each; Follow-ups 50 a chip; Planned 50 and the Just planned card. */
  { name: 'Home, Needs you (home-todo)', rows: n => n.tag === 'li' && cls(n, 'todo') && !cls(n, 'ack') && within(n, x => cls(x, 'todos')), bound: 10 },
  { name: 'Home, Your corrections (home-acks)', rows: n => n.tag === 'li' && cls(n, 'todo') && cls(n, 'ack'), bound: 10 },
  { name: 'follow-ups (fu, home-fu), the page and the one being edited', rows: n => n.tag === 'li' && cls(n, 'fu'), bound: 50 + 1 },
  { name: 'Runs, Planned (runs-planned) and Just planned', rows: n => n.tag === 'button' && cls(n, 'plan') && cls(n, 'card'), bound: 50 + 1 },
  /* Every bounded dropdown (D9): 50 candidates, the kept choice, the select's own special choices and Show 50 more…. */
  { name: 'a bounded dropdown (K.select), per select', rows: n => n.tag === 'option' && !!up(n, x => x.tag === 'select' && 'data-kselect' in x.attrs), bound: 50 + 1 + 2 + 1, per: n => up(n, x => x.tag === 'select') },
  { name: 'a skill page\'s changes (sk-changes)', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'changes') && within(n, x => cls(x, 'status-card')), bound: 50 }
];
/* Drawn in full on purpose, each with its reason. A capped one is also in REGISTRY at its cap. */
const STRUCTURE = n => (n.tag === 'li' && (cls(n, 'step') || cls(n, 'gate'))) || (n.tag === 'section' && cls(n, 'phase')) ||
  (n.tag === 'li' && n.parent && n.parent.tag === 'ol' && cls(n.parent, 'rw-phases')) || (n.tag === 'div' && cls(n, 'rrow')) ||
  (n.tag === 'div' && !n.attrs.class && n.parent && cls(n.parent, 'receipt')) ||
  (within(n, x => cls(x, 'mapview')) && (n.tag === 'li' || (n.tag === 'div' && cls(n, 'ph')))) ||
  within(n, x => /^(ob-|fpe-outline|flight|fp-|share)/.test(x.attrs.class || ''));
const EXEMPT = [
  { why: 'person pickers stay native selects (D6)', rows: n => n.tag === 'option' && personSelect(n.parent) },
  { why: 'the duration chart has its own cap (registered at 300)', rows: n => n.tag === 'a' && cls(n, 'ins-dot-a') },
  { why: 'checklist structure, drawn whole on every surface that draws a whole checklist: phases, steps and gates on the run screen, the builder, the flight plan, Receipt\'s rows, screen share and the checklist preview', rows: STRUCTURE },
  { why: 'bundled with the app, not the team folder: What\'s new and the built-in step types', rows: n => within(n, x => /\b(rel-|rn-)/.test(x.attrs.class || '') || x.attrs['data-disc'] === 'types-built') },
  { why: 'team values are capped by the format (registered at 100)', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'tv-list') },
  { why: 'the Connection check is left unchanged in 2.11', rows: n => within(n, x => /^(conn|cn-)/.test(x.attrs.class || '') || /^conn/.test(x.attrs.id || '')) }
];
const inIns = n => within(n, x => x.tag === 'section' && cls(x, 'ins'));
const inDisc = d => n => within(n, x => x.attrs['data-disc'] === d);
/* Lists the later slices of 2.11 bound, each with the slice that bounds it (plan section "Slices"). The slice removes its
   entries and registers the bound. An entry not drawn over 25 on a screen it names fails, so none can outstay its slice.
   slice null: a list the plan's D7 doesn't have yet; reported, not assigned. */
const PENDING = [
  { slice: 3, name: 'Checks', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'checks'), on: ['Commands to fill in'] },
  { slice: 3, name: 'Why is this here? (members, reasons, source runs)', rows: n => within(n, x => cls(x, 'prov-why')) && /^(dt|dd|button)$/.test(n.tag), on: ['A run on a version with a landed correction'] },
  { slice: 3, name: 'unreadable note lines, one notice each (D10)', rows: n => n.tag === 'div' && cls(n, 'notice') && n.parent && cls(n.parent, 'rw-alerts'), on: ['The busy run', 'The busy run, picked up'] },
  { slice: 3, name: 'a run\'s recovery copies', rows: n => n.tag === 'div' && cls(n, 'copyrow'), on: ['A run with 300 copies'] },
  { slice: 3, name: 'proposal review, What happened before', rows: n => n.tag === 'li' && within(n, x => cls(x, 'ca-box')), on: ['Many versions'] },
  { slice: 3, name: 'Folder health, What\'s in the folder', rows: n => n.tag === 'tr' && within(n, x => cls(x, 'hz-table')), on: ['Folder health'] },
  { slice: 4, name: 'Process, Corrections (members, Why, What happened, runs)', rows: n => (within(n, x => cls(x, 'fixlist')) && (n.tag === 'li' || n.tag === 'dt' || n.tag === 'dd')) || (n.tag === 'ul' && cls(n, 'fixlist')) || (n.tag === 'h3' && cls(n, 'fixgroup')), on: ['Many versions', 'Busy run\'s checklist', 'Four hundred steps'] },
  { slice: 4, name: 'Markdown editor, Open corrections', rows: n => n.tag === 'li' && within(n, x => cls(x, 'md-corr')), on: ['Busy run\'s checklist'] },
  { slice: 4, name: 'the run inspector, this step\'s corrections', rows: n => n.tag === 'li' && cls(n, 'corr') && within(n, x => cls(x, 'rw-corr')), on: ['The busy run', 'The busy run, picked up'] },
  { slice: 4, name: 'Finish and Receipt, corrections', rows: n => n.tag === 'li' && cls(n, 'corr') && within(n, x => cls(x, 'finish') || cls(x, 'receipt')), on: ['The busy run, picked up', 'The busy run\'s receipt'] },
  { slice: 4, name: 'a run\'s Reports panel and the inspector\'s report cards', rows: n => (n.tag === 'section' && cls(n, 'rep-card')) || (n.tag === 'li' && n.parent && cls(n.parent, 'replist')), on: ['The busy run', 'The busy run, picked up'] },
  { slice: 4, name: 'one report\'s copies, in its fold', rows: n => n.tag === 'p' && within(n, x => cls(x, 'rep-details')), on: ['The busy run, step 3'] },
  { slice: 4, name: 'Join, Who are you?', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'su-who'), on: ['Join'] },
  { slice: 4, name: 'Versions (All versions)', rows: n => n.tag === 'li' && !cls(n, 'stg') && n.parent && cls(n.parent, 'vlist') && within(n, x => x.tag === 'details' && x.attrs['data-disc'] !== 'ins-cmp') && !within(n, x => cls(x, 'diff')), on: ['Many versions'] },
  { slice: 4, name: 'Stages', rows: n => n.tag === 'li' && cls(n, 'stg'), on: ['Many versions'] },
  { slice: 4, name: 'incomplete or broken publications, one notice each', rows: n => n.tag === 'div' && cls(n, 'notice') && n.parent && n.parent.tag === '#root', on: ['Many versions'] },
  { slice: 4, name: 'How runs go, Compare versions', rows: n => n.tag === 'tr' && inDisc('ins-cmp')(n), on: ['Many versions'] },
  { slice: 4, name: 'How runs go, Who has done each role (people and role columns)', rows: n => /^(tr|th|td)$/.test(n.tag) && inIns(n) && !inDisc('ins-cmp')(n) && !inDisc('ins-dur-table')(n), on: ['Many versions', 'Many roles'] },
  { slice: 4, name: 'How runs go, Each phase', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'ins-phases'), on: ['Many phases'] },
  { slice: 5, name: 'the step-note thread', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'tnotes'), on: ['The busy run', 'The busy run, picked up'] },
  { slice: 5, name: 'Folder health issues', rows: n => n.tag === 'li' && cls(n, 'hz-issue'), on: ['Folder health'] },
  { slice: 5, name: 'Settings, People', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'pp-list'), on: ['Settings'] },
  { slice: 5, name: 'a duplicate-draft warning\'s names (D10)', rows: n => n.tag === 'code' && within(n, x => cls(x, 'notice')), on: ['Duplicated draft'] },
  { slice: 5, name: 'the legacy v0.1 runs, joined into one line (D10)', count: h => (h.match(/Legacy run \d+/g) || []).length, on: ['Runs'] },
  { slice: 5, name: 'a report\'s conflict warning, its copies joined into one line (D10)', count: h => (h.match(/diffcopy \(\d+\)/g) || []).length, on: ['The busy run, step 3'] },
  { slice: null, name: 'Start and Plan, one role row per role (not in D7)', rows: n => n.tag === 'label' && cls(n, 'field') && within(n, x => x.tag === 'form' && /^(start|plan)-form$/.test(x.attrs.id || '')), on: ['Start a run with 300 roles'] },
  { slice: null, name: 'a version\'s Show changes, every changed step (not in D7)', rows: n => n.tag === 'span' && within(n, x => cls(x, 'diff')), on: ['Four hundred steps'] }
];

/* ---------- checking one screen ---------- */
/* Every crowd on the screen: more than 25 children of one tag and class. */
function crowds(root) {
  const out = [];
  walk(root, n => {
    const g = new Map();
    n.kids.forEach(k => { const key = k.tag + (k.attrs.class ? '.' + k.attrs.class.trim().split(/\s+/).join('.') : ''); if (!g.has(key)) g.set(key, []); g.get(key).push(k); });
    g.forEach((list, key) => { if (list.length > 25) out.push({ parent: n, key, list }); });
  });
  return out;
}
function check(screen, html, o) {
  const root = parse(html), fails = [], pending = new Set(), all = [], reg = (o && o.registry) || REGISTRY;
  walk(root, n => all.push(n));
  reg.forEach(e => {
    if (e.count) { const n = e.count(html); if (n > e.bound) fails.push(screen + ': ' + e.name + ' draws ' + n + ', over its bound of ' + e.bound); return; }
    const rows = all.filter(e.rows), per = new Map();
    if (e.per) rows.forEach(n => { const k = typeof e.per === 'function' ? e.per(n) : n.parent; per.set(k, (per.get(k) || 0) + 1); }); else per.set(root, rows.length);
    per.forEach(n => { if (n > e.bound) fails.push(screen + ': ' + e.name + ' draws ' + n + ', over its bound of ' + e.bound); });
  });
  PENDING.filter(e => e.count).forEach(e => { if (e.count(html) > 25) pending.add(e.name); });
  const seen = new Set();
  crowds(root).forEach(c => {
    if (c.list.every(n => reg.some(e => e.rows && e.rows(n)))) return;
    if (EXEMPT.some(e => c.list.every(n => e.rows(n)))) return;
    const p = PENDING.find(e => e.rows && c.list.every(n => e.rows(n)));
    if (p) { pending.add(p.name); return; }
    const sig = where(c.parent).replace(/#[\w-]+/g, '') + ' > ' + c.key;
    if (seen.has(sig)) return; seen.add(sig);
    fails.push(screen + ': an unregistered list draws ' + c.list.length + ' × ' + c.key + ' in ' + where(c.parent));
  });
  return { fails, pending, root };
}
/* Every person select and person button list is in name order, though people.json isn't. */
function personOrder(screen, root) {
  const N = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }), bad = [], byId = {};
  people.forEach(p => { byId[p.id] = p; });
  const sorted = ids => ids.every((id, i) => !i || N.compare(byId[ids[i - 1]].name, byId[id].name) <= 0);
  walk(root, n => {
    if (personSelect(n)) { const ids = n.kids.map(o => o.attrs.value).filter(v => isPerson.has(v)); if (ids.length > 1 && !sorted(ids)) bad.push(screen + ': the person picker ' + (n.attrs.id || where(n)) + ' isn\'t in name order'); }
    if (n.tag === 'ul' && cls(n, 'su-who')) { const ids = []; walk(n, b => { if (b.attrs['data-act'] === 'setup-who') ids.push(b.attrs['data-id']); }); if (!sorted(ids)) bad.push(screen + ': Who are you? isn\'t in name order'); }
  });
  return bad;
}

/* ---------- the app on the big folder ---------- */
let booted = null;
async function bigApp() {
  if (booted) return booted;
  const t0 = Date.now(), fx = fixture(), t1 = Date.now();
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fx);
  if (process.env.BOUNDS_TIME) console.log('bounds: fixture ' + (t1 - t0) + ' ms, first read ' + (Date.now() - t1) + ' ms, ' + Object.keys(fx.files).length + ' files');
  booted = { app, fx };
  return booted;
}
/* A redraw that changes nothing else. */
const redraw = async app => { app.click('dismiss'); await app.tick(5); };
/* Every closed fold opened, as a person would (closed folds count too), until none is left. */
async function openFolds(app) {
  for (let pass = 0; pass < 4; pass++) {
    const shut = [];
    [app.html(), app.overlay()].forEach(h => walk(parse(h), n => { if (n.tag === 'details' && !('open' in n.attrs) && (n.attrs['data-disc'] || n.attrs['data-group'])) shut.push(n); }));
    if (!shut.length) return;
    shut.forEach(n => app.fire('toggle', { target: { dataset: { disc: n.attrs['data-disc'], group: n.attrs['data-group'] }, open: true } }));
    await redraw(app);
  }
}
/* The actions that open a form or a dialog, as a person can on that screen: the first of each kind drawn there. */
const OPENERS = /^(pick|edit|fu-pick|corr-open|nc-open|people-owner|team-edit|team-remove|delete-copy|compare-copy|rep-accept|rep-decline|ev-open|hist-open|search|plan-from-run|start|plan-run|start-test|start-child|prop-review|corr-review|corr-apply|corr-decline|show-roles|timeline|load-history|run-reports|run-details|run-fu|mission|receipt|finish|diff|view-version|flight|fp-steps|ptab|ob-parts-open|new-process|new-type|corr-menu|fold|unfold|pr-open|setup-mode)$/;
function openers(html) {
  const out = [], seen = new Set();
  walk(parse(html), n => {
    const act = n.attrs['data-act'];
    if (!act || !OPENERS.test(act) || 'disabled' in n.attrs || n.attrs['aria-disabled'] === 'true') return;
    const data = {}; Object.keys(n.attrs).forEach(k => { if (/^data-/.test(k) && k !== 'data-act' && k !== 'data-id') data[k.slice(5).replace(/-(\w)/g, (x, c) => c.toUpperCase())] = n.attrs[k]; });
    const key = act + '|' + (data.kind || data.status || data.id || '') + (act === 'ptab' || act === 'flight' ? n.attrs['data-id'] : '');
    if (seen.has(key)) return; seen.add(key);
    out.push({ act, id: n.attrs['data-id'], data, key });
  });
  return out;
}
/* One screen, then every form and dialog its actions open, each from the screen as reached. */
async function visit(name, go, o) {
  o = o || {};
  const { app } = await bigApp();
  const fails = [], pending = new Set();
  const look = async what => {
    await openFolds(app);
    [['', app.html()], [' (top bar)', app.top()], [' (dialog)', app.overlay()]].forEach(([w, h]) => {
      if (!h) return;
      const c = check(what + w, h);
      fails.push(...c.fails, ...personOrder(what + w, c.root)); c.pending.forEach(p => pending.add(p));
    });
  };
  await go(app); await app.tick(10);
  await look(name);
  if (!o.noOpeners) {
    const list = openers(app.html() + app.overlay() + app.top());
    for (const x of list) {
      await go(app); await app.tick(10);
      app.click(x.act, x.id, x.data); await app.tick(15);
      await look(name + ' › ' + x.key);
      if (app.overlay()) { app.click('close-overlay'); await app.tick(5); }
    }
  }
  const expected = PENDING.filter(p => (p.on || []).indexOf(name) >= 0).map(p => p.name).filter(p => !pending.has(p));
  expected.forEach(p => fails.push(name + ': PENDING lists "' + p + '" here, but it isn\'t drawn over 25 any more. Take it off PENDING (and register its bound).'));
  assert.deepStrictEqual([...new Set(fails)], [], 'lists drawn past their bound');
}
const nav = (v, then) => async app => { app.click('nav', v); await app.tick(5); if (then) await then(app); };
const openRun = (key, then) => async app => { const { fx } = await bigApp(); app.click('nav', 'home'); await app.tick(5); app.click('open-run', fx.facts[key] || key); await app.tick(10); if (then) await then(app); };
const openProc = (id, tab) => async app => { app.click('nav', 'processes'); await app.tick(5); app.click('open-process', id); await app.tick(10); if (tab) { app.click('ptab', tab); await app.tick(10); } };

/* ---------- every screen ---------- */
const SCREENS = [
  ['Home', nav('home')],
  ['Runs', nav('runs', async a => { a.click('filter', 'all'); await a.tick(5); })],
  ['Runs › Follow-ups, Open', nav('followups')],
  ['Runs › Follow-ups, All', nav('followups', async a => { a.click('fu-filter', 'all'); await a.tick(5); })],
  ['Checklists', nav('processes')],
  ['Skills', nav('skills')],
  ['A skill built on v1 of a 400-step checklist', nav('skills', async a => { a.click('open-skill', 'old-whole-skill.json'); await a.tick(10); })],
  ['Step types', nav('types')],
  ['Settings', nav('settings')],
  ['Folder health', nav('settings', async a => { a.click('health'); await a.tick(20); })],
  ['The busy run', openRun('busy', async a => { a.click('select', 's0'); await a.tick(10); })],
  ['The busy run, picked up', openRun('busy', async a => { a.click('takeover'); await a.tick(40); a.click('select', 's0'); await a.tick(10); })],
  ['The busy run, step 3', openRun('busy', async a => { a.click('select', 's2'); await a.tick(10); })],
  ['The busy run\'s receipt', openRun('busy', async a => { a.click('receipt'); await a.tick(10); })],
  ['A run with 300 copies', openRun('copies')],
  ['A run on a version with a landed correction', openRun('landed', async a => { a.click('select', 's0'); await a.tick(10); })],
  ['A run with 300 roles', openRun('roles', async a => { a.click('takeover'); await a.tick(40); a.click('select', 's0'); await a.tick(10); })],
  ['A run with 300 phases', openRun('phases', async a => { a.click('takeover'); await a.tick(40); })],
  ['A run with 400 steps', openRun('steps', async a => { a.click('takeover'); await a.tick(40); a.click('select', 's199'); await a.tick(10); })],
  ['Many versions', openProc('versions')],
  ['Many versions › How runs go', openProc('versions', 'insights')],
  ['Many versions › Edit', openProc('versions', 'edit')],
  ['Many roles › How runs go', openProc('roles', 'insights')],
  ['Many phases › How runs go', openProc('phases', 'insights')],
  ['Many phases › Edit', openProc('phases', 'edit')],
  ['Many roles › Edit', openProc('roles', 'edit')],
  ['Search', nav('home', async a => { a.click('search'); await a.tick(10); a.input('sx-q', 'run'); await a.tick(400); }), { noOpeners: true }],
  ['Four hundred steps', openProc('steps')],
  ['Four hundred steps › How runs go', openProc('steps', 'insights')],
  ['Four hundred steps › Edit', openProc('steps', 'edit')],
  ['Commands to fill in', openProc('commands')],
  ['Duplicated draft', openProc('dupes')],
  ['Landed change', openProc('landed')],
  ['Busy run\'s checklist', openProc('busy')],
  ['Start a run with 300 roles', openProc('roles', null), { start: 'roles' }],
  ['Plan a run', openProc('tiny', null), { plan: 'tiny' }]
];

SCREENS.forEach(([name, go, o]) => {
  rule('D8: ' + name + ' draws every list within its bound, and so does every form and dialog it opens', async () => {
    let g = go;
    if (o && o.start) g = async a => { await go(a); a.click('start', o.start); await a.tick(10); };
    if (o && o.plan) g = async a => { await go(a); a.click('plan-run', o.plan); await a.tick(10); };
    await visit(name, g, o);
  });
});

rule('D8: Join\'s Who are you? with 500 people', async () => {
  const { folderHandle, memoryIDB } = require('./app-harness');
  const fx = fixture(), dir = folderHandle('Team', { 'people.json': fx.files['people.json'] });
  const app = boot({ picker: dir, indexedDB: memoryIDB(), firstRun: true }); await app.tick(60);
  app.click('setup-mode', 'join'); await app.tick();
  app.click('setup-open'); await app.tick(200);
  const html = app.html(), c = check('Join', html);
  assert.ok(/Who are you\?/.test(html), 'set-up: on Who are you?');
  assert.deepStrictEqual([...c.fails, ...personOrder('Join', c.root)], []);
  assert.deepStrictEqual([...c.pending], PENDING.filter(p => (p.on || []).indexOf('Join') >= 0).map(p => p.name));
});

/* The check is itself checked: with paging off for one list, that list must fail it. A flat page and the tree here;
   the tail (slice 5) and the nested list (slice 4, corrections across groups) are added by the slice that pages them. */
const PAGE_OFF = [
  { list: 'runs-running', kind: 'flat', screen: 'Runs', go: SCREENS.filter(s => s[0] === 'Runs')[0][1], expect: /run cards .* draws \d+, over its bound/ },
  { list: 'processes', kind: 'tree', screen: 'Checklists', go: SCREENS.filter(s => s[0] === 'Checklists')[0][1], expect: /the Checklists and All skills tree, its rows .* draws \d+, over its bound of 50/ },
  { list: 'ins-dur', kind: 'flat', screen: 'Many versions › How runs go', go: SCREENS.filter(s => s[0] === 'Many versions › How runs go')[0][1], expect: /the duration table \(ins-dur\) draws \d+, over its bound of 50/ }
];
const PAGE_OFF_PENDING = [{ kind: 'tail', slice: 5 }, { kind: 'nested', slice: 4 }];
PAGE_OFF.forEach(t => {
  rule('D8 is tested: with paging off for ' + t.list + ' (' + t.kind + '), the bounds check fails for it, and passes again with paging on', async () => {
    const { app } = await bigApp();
    const look = async () => { await t.go(app); await app.tick(10); await openFolds(app); return check(t.screen, app.html()).fails; };
    assert.deepStrictEqual((await look()).filter(f => t.expect.test(f)), [], 'set-up: bounded with paging on');
    app.PF.vk.PAGE_OFF = t.list;
    try { const f = await look(); assert.ok(f.some(x => t.expect.test(x)), 'paging off for ' + t.list + ' must fail the check: ' + f.join('; ')); }
    finally { app.PF.vk.PAGE_OFF = null; await redraw(app); }
  });
});
rule('D8 is tested: the kinds of list not yet paged in this slice are listed with the slice that adds their PAGE_OFF check', () => {
  assert.deepStrictEqual(PAGE_OFF_PENDING.map(k => k.kind).concat(PAGE_OFF.map(t => t.kind)).filter((k, i, a) => a.indexOf(k) === i).sort(), ['flat', 'nested', 'tail', 'tree']);
});
rule('D8: PENDING names each list once, with a slice of 2.11 or null for one the plan doesn\'t have yet', () => {
  const names = PENDING.map(p => p.name);
  assert.strictEqual(new Set(names).size, names.length);
  PENDING.forEach(p => assert.ok(p.slice === null || [2, 3, 4, 5].indexOf(p.slice) >= 0, p.name));
});

run();
