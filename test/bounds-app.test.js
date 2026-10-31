// Every list that grows with the team folder is drawn a page at a time (2.11). This boots the app on one big folder
// (test/bounds-fixture.js) and visits every screen, tab, fold and dialog, and every form an action opens, and checks two ways:
// - a registry of the bounded lists: each one's rows, counted across the screen, stay within its page (plus what's kept);
// - a catch-all: any element with more than 25 children of one tag and class that the registry doesn't know fails, with
//   where it is, unless it's exempt (with a reason) or still waiting for the slice that bounds it (PENDING).
// The registry is itself tested: PF.vk.PAGE_OFF turns paging off for one list, and the check must then fail for that list.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
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
const people = fixture().facts.people, isPerson = new Set(people.map(p => p.id)), BUILT_IN = load().types.LIST.length;
/* A select of people (or nobody): a person picker stays a native select, so its options are exempt. */
const personSelect = s => s && s.tag === 'select' && s.kids.filter(k => k.tag === 'option').every(o => o.attrs.value === '' || isPerson.has(o.attrs.value)) && s.kids.some(o => isPerson.has(o.attrs.value));

/* The bounded lists. rows: a node test, counted across the whole screen (aggregate), so many small lists that add up are caught;
   per: 'parent' counts each parent's rows instead (a function, each container it returns). count: for a list joined into one line, the number of names drawn. */
/* The most names drawn in any one line that starts at from and ends at end. */
const joinedIn = (from, end, re) => h => { let most = 0; for (let i = h.indexOf(from); i >= 0; i = h.indexOf(from, i + 1)) most = Math.max(most, (h.slice(i, h.indexOf(end, i)).match(re) || []).length); return most; };
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
  /* Checks, 50 where each is drawn; the run inspector's Why is this here?, 20 members across a step's changes. */
  { name: 'Checks (checks-ed, checks-ov, checks-prop)', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'checks'), bound: 50 },
  { name: 'Why is this here? (prov-<step>), its members', rows: n => n.tag === 'button' && /^pm-.*-run$/.test(n.attrs.id || '') && within(n, x => cls(x, 'prov-why')), bound: 20 },
  /* One notice for unreadable note lines (D10), with the lines in its fold, 50 at a time. */
  { name: 'unreadable note lines, in the notice\'s fold (badnotes)', rows: n => n.tag === 'li' && within(n, x => cls(x, 'rw-badnotes')), bound: 50 },
  { name: 'a run\'s recovery copies (copies), 20, the compared one, the one being deleted and the browser\'s copy', rows: n => n.tag === 'div' && cls(n, 'copyrow'), bound: 20 + 2 + 1 },
  { name: 'proposal review, What happened before (prop-recs)', rows: n => n.tag === 'li' && /^prop-rec-/.test(n.attrs.id || ''), bound: 20 },
  { name: 'Folder health, What\'s in the folder (hz-areas) and its heading row', rows: n => n.tag === 'tr' && within(n, x => cls(x, 'hz-table')), bound: 50 + 1 },
  /* Start and Plan (found while building slice 1): 20 role rows, and the roles given someone past the page, 20 at most (K.list
     keeps a page at most past the page since code review round 11: a plan made from a run of the 300-role step has all). */
  { name: 'Start, Plan and Start a test run, role rows (start-roles, test-roles)', rows: n => n.tag === 'label' && cls(n, 'field') && /^role-/.test(n.attrs.for || '') && within(n, x => x.tag === 'form' && /^(start|plan)-form$/.test(x.attrs.id || '')), bound: 20 + 20 },
  /* Found in code review of 2.11: the linked step's start dialog and the run's Details (Add people) drew every role. */
  { name: 'a linked step\'s start dialog, role rows (cs-roles)', rows: n => n.tag === 'label' && cls(n, 'field') && /^cs-role-/.test(n.attrs.for || '') && within(n, x => x.tag === 'form' && x.attrs.id === 'child-start-form'), bound: 20 + 20 },
  { name: 'a run\'s Details, its role chips (det-roles), and the one being edited', rows: n => (n.tag === 'button' && cls(n, 'chip') && /^role:/.test(n.attrs['data-id'] || '')) || (n.tag === 'span' && cls(n, 'inline-edit') && /^edit:role:/.test(n.attrs['data-scope'] || '')), bound: 20 + 1 },
  /* Found in code review round 3: Screen share's Who's on what drew every role of a team run. */
  { name: 'Screen share, Who\'s on what (ms-roles), 20 roles', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'mroles'), bound: 20 },
  { name: 'a skill page\'s changes (sk-changes)', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'changes') && within(n, x => cls(x, 'status-card')), bound: 50 },
  /* Slice 4. Process › Corrections (fx:<process>): 50 members at a time across groups, plus the group being declined and the
     one a search, Home or a link opened. A group, its target's heading and a member's lines are drawn only for members drawn. */
  { name: 'Process › Corrections, the members drawn (fxm-, each one\'s first line)', rows: n => /^fxm-/.test(n.attrs.id || ''), bound: 50 + 2 },
  { name: 'Process › Corrections, the groups those members are in', rows: n => n.tag === 'li' && /^fxg-/.test(n.attrs.id || ''), bound: 50 + 2 },
  { name: 'Process › Corrections, a heading and list per step', rows: n => (n.tag === 'h3' && cls(n, 'fixgroup')) || (n.tag === 'ul' && cls(n, 'fixlist')) || (n.tag === 'p' && cls(n, 'corr-alts')), bound: 3 * (50 + 2) },
  { name: 'Process › Corrections, a group\'s lines: what it said and suggests, and a Why and What happened per member drawn', rows: n => (n.tag === 'dt' || n.tag === 'dd') && n.parent && cls(n.parent, 'corr-dl'), bound: 2 * 2 * (50 + 2) + 4, per: 'parent' },
  { name: 'Process › Corrections, the runs behind the members drawn', rows: n => n.tag === 'li' && within(n, x => cls(x, 'corr-runs')), bound: 50 + 2, per: 'parent' },
  { name: 'Markdown editor, Open corrections (md-corr)', rows: n => n.tag === 'li' && /^mdc-/.test(n.attrs.id || ''), bound: 50 },
  { name: 'the run inspector, this step\'s corrections (rcorr), and the one a search or View correction opened', rows: n => n.tag === 'li' && cls(n, 'corr') && within(n, x => cls(x, 'rw-corr')), bound: 20 + 1 },
  { name: 'Finish and Receipt, corrections (fin-corr, rcpt-corr)', rows: n => n.tag === 'li' && cls(n, 'corr') && within(n, x => cls(x, 'finish') || cls(x, 'receipt')), bound: 50 },
  { name: 'Receipt, reports (rcpt-reps), a line each', rows: n => n.tag === 'div' && cls(n, 'rr-rep'), bound: 50 },
  { name: 'the inspector\'s report cards (repcards), plus the open form, kept reasons and the one a panel link opened', rows: n => n.tag === 'section' && cls(n, 'rep-card'), bound: 20 + 3 },
  { name: 'a run\'s Reports panel (reppanel)', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'replist'), bound: 20 },
  { name: 'one report\'s copies in its fold (10, then repc 50 at a time)', rows: n => n.tag === 'p' && cls(n, 'rep-copy'), bound: 50, per: 'parent' },
  { name: 'Join, Who are you? (su-who)', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'su-who'), bound: 50 },
  { name: 'Versions, earlier versions (vers), and the one compared or viewed', rows: n => n.tag === 'li' && /^ver-/.test(n.attrs.id || ''), bound: 50 + 1 + 2 },
  { name: 'Stages (stages), and the one just staged', rows: n => n.tag === 'li' && cls(n, 'stg'), bound: 50 + 1 },
  { name: 'incomplete publications, one notice with its list (pub-broken)', rows: n => n.tag === 'li' && /^pb-/.test(n.attrs.id || ''), bound: 20 },
  { name: 'How runs go, Compare versions (ins-cmp), and its heading row', rows: n => n.tag === 'tr' && inDisc('ins-cmp')(n), bound: 20 + 1 },
  { name: 'How runs go, Who has done each role: people (ins-rot), and the heading row', rows: n => n.tag === 'tr' && within(n, x => x.attrs['aria-labelledby'] === 'ins-rot-h'), bound: 50 + 1 },
  { name: 'How runs go, Who has done each role: 20 role columns at a time (ins-rolecols), the person and Show more roles', rows: n => (n.tag === 'th' || n.tag === 'td') && within(n, x => x.attrs['aria-labelledby'] === 'ins-rot-h'), bound: 20 + 2, per: 'parent' },
  { name: 'How runs go, Each phase (ins-ph)', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'ins-phases'), bound: 50 },
  { name: 'How runs go, the notes on what the numbers can\'t count (ins-notes)', rows: n => n.tag === 'li' && /^ins_note_/.test(n.attrs.id || ''), bound: 50 },
  /* A version's Show changes (found while building slice 1): 50 changes at a time, each with a line around it, and a line per gap. */
  { name: 'a version\'s Show changes, the changes (ver-diff, draft-diff, plan-diff)', rows: n => n.tag === 'span' && (cls(n, 'add') || cls(n, 'del')) && n.parent && cls(n.parent, 'diff'), bound: 50, per: 'parent' },
  { name: 'a version\'s Show changes, its lines: the changes, a line around each and the gaps', rows: n => n.tag === 'span' && n.parent && cls(n.parent, 'diff'), bound: 50 + 2 * 50 + 51, per: 'parent' },
  { name: 'saved history (hist), and the one being compared', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'hist-list'), bound: 50 + 1 },
  { name: 'a correction\'s Who should do it (corr-roles), and the roles ticked', rows: n => n.tag === 'label' && within(n, x => x.tag === 'fieldset' && cls(x, 'corr-roles')), bound: 20 + 2 },
  { name: 'Earlier answers and Archived answers (ans, arch)', rows: n => n.tag === 'li' && /^(ans|arch)-/.test(n.attrs.id || ''), bound: 20, per: 'parent' },
  /* Slice 5. The step-note thread (notes:<run>:<step>): the newest 20, and the one a search or a save showed you. Earlier and
     Archived answers share ul.tnotes; they're counted above, by their ans- and arch- ids, not here. */
  { name: 'the step-note thread (notes), the newest 20 and the one shown from earlier', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'tnotes') && /^tn-/.test(n.attrs.id || ''), bound: 20 + 1 },
  { name: 'Folder health issues (hz-stop, hz-look), 50 a section', rows: n => n.tag === 'li' && cls(n, 'hz-issue'), bound: 50 + 50 },
  { name: 'Settings, People (people), the one being made owner and the one just added', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'pp-list'), bound: 50 + 2 },
  /* D10: a list joined into one line shows 50 names; a notice repeated per item is one notice with a paged fold. */
  { name: 'the legacy v0.1 runs, joined into one line (legacy), 50 names', count: h => (h.match(/Legacy run \d+/g) || []).length, bound: 50 },
  { name: 'a duplicate-draft warning\'s names (dupes:<process>), in its fold', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'sd-names'), bound: 50 },
  { name: 'a report\'s differing copies, named in its notice\'s fold (repdiff:<report>)', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'rep-names'), bound: 50, per: 'parent' },
  { name: 'a report\'s differing copies, every name on the screen: the notice\'s fold and the card\'s copies', count: h => (h.match(/diffcopy \(\d+\)/g) || []).length, bound: 50 + 50 },
  /* Found in code review round 7, once the builder's form was no longer exempt: a step's Who does it, and Checklist details'
     roles and run details, 20 at a time and the step's own roles or the run detail being renamed. A linked step's sources
     are K.select dropdowns, counted above. */
  { name: 'the builder, a step\'s roles (ob-roles), 20 and at most 20 of the step\'s own', rows: n => n.tag === 'button' && cls(n, 'chipbtn') && n.attrs['data-act'] === 'ob-role', bound: 20 + 20 },
  { name: 'the builder, Checklist details\' roles and run details (ob-meta-roles, ob-meta-context), 20 each and the one being renamed', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'ob-metalist'), bound: 20 + 1, per: 'parent' },
  /* Team step types are capped by their reader at 100 (storage/repo.js MAX_TYPES), so the builder lists them whole, registered
     at that cap: the type selects (the built-ins too, bundled), the parts list's groups, and the type files it can't use. */
  { name: 'the step type selects (ob-type, ob-new-type), the built-in types and 100 team types', rows: n => n.tag === 'option' && !!up(n, x => x.tag === 'select' && /^ob-(new-)?type$/.test(x.attrs.id || '')), bound: BUILT_IN + 100 + 1, per: n => up(n, x => x.tag === 'select') },
  { name: 'the builder\'s parts, a group\'s parts, at most the 100 team types', rows: n => n.tag === 'li' && n.parent && n.parent.tag === 'ul' && within(n, x => cls(x, 'ob-plist')) && !cls(n, 'ob-broken'), bound: 100, per: 'parent' },
  { name: 'the builder\'s parts, the type files it can\'t use, at most the 100 read', rows: n => n.tag === 'li' && cls(n, 'ob-broken'), bound: 100, per: 'parent' },
  { name: 'linked steps that can\'t start their child, one notice with its fold (links-broken:<process>)', rows: n => n.tag === 'li' && within(n, x => cls(x, 'links-broken')), bound: 20 },
  /* Found in code review round 8: Rename's warnings about other checklists, and the checklist preview's skill names, joined
     into one line on a step and for the whole checklist (D10), 50 each with "and N more" and a link to Skills. */
  { name: 'the builder, Rename\'s warnings about other checklists (ob-ren-deps), 20', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'ob-ren-deps'), bound: 20 },
  /* Found by the round 8 opener inventory: a step's run details (ob-binds) and Sets a run detail (ob-sets) drew every one. */
  { name: 'the builder, a step\'s run details (ob-binds), 20 and at most 20 of the step\'s own', rows: n => n.tag === 'button' && n.attrs['data-act'] === 'ob-bind', bound: 20 + 20 },
  { name: 'the builder, Sets a run detail (ob-sets), 20 and at most 20 of the ones the step sets', rows: n => n.tag === 'button' && n.attrs['data-act'] === 'ob-sets', bound: 20 + 20 },
  { name: 'the checklist preview, a step\'s skills joined into one line (pv-skills), 50 names', count: joinedIn('<span class="pv-skill">', '</span></span>', /step-skill-\d+/g), bound: 50 },
  { name: 'the checklist preview, the whole checklist\'s skills joined into one line (pv-whole), 50 names', count: joinedIn('The whole checklist: ', '</p>', /whole-skill/g), bound: 50 },
  /* Found in code review round 9: a skill page's What it takes joined a checklist's roles, now and before, into one line. */
  { name: 'a skill page\'s What it takes, the roles now and before joined into one line (sk-inputs), 50 names each', count: joinedIn('<b>What it takes:</b>', '</li>', /\br\d+\b/g), bound: 100 },
  /* Found in code review round 10: a linked step's What it needs drew a child draft's every run detail; who approves joined
     every approval a role owns; and, by the round's audit, the outline's Checklist details card and practice's Sample details
     drew a draft's every run detail and role. Start, Plan, a test run and a linked step's start dialog ask for a version's
     run details, at most the 40 a version can have (core/map.js), registered at that cap. */
  { name: 'the builder, what a linked step\'s child needs (ob-link-rows), 20 and the ones being filled in', rows: n => n.tag === 'div' && cls(n, 'ob-link-row'), bound: 20 },
  { name: 'practice, Sample details (pr-samples), 20 and the ones not accepted', rows: n => n.tag === 'label' && n.parent && cls(n.parent, 'pr-fields'), bound: 20 },
  { name: 'the builder outline\'s Checklist details card, its run details (ob-det-context), 50 names', count: joinedIn('class="ob-details', '</button>', /class="ob-chip"/g), bound: 50 },
  { name: 'the builder outline\'s Checklist details card, its roles (ob-det-roles), 50 names', count: joinedIn('class="ob-details', '</button>', /@r\d+/g), bound: 50 },
  { name: 'Start and Plan, the approvals in a role\'s label (start-approves), 50 names', count: joinedIn('· approves ', '</span>', /Approval \d+/g), bound: 50 },
  { name: 'Start and Plan, On my own\'s who approves (start-approvals), 50 names', count: joinedIn('including who approves ', '</p>', /Approval \d+/g), bound: 50 },
  /* Found in code review round 11: a step's or a lane's roles, joined into one line in the builder, the previews and a run, drew
     every role its author gave it; and a linked step's run details its child doesn't have drew a notice each. */
  { name: 'the builder outline, a step\'s roles (ob-step-roles), 50 names', count: joinedIn('<span class="ob-role">', '</span>', /@w\d+/g), bound: 50 },
  { name: 'the builder outline, a lane\'s roles (ob-lane-roles), 50 names', count: joinedIn('<div class="ob-lane-h">', '</div>', /@w\d+/g), bound: 50 },
  { name: 'the builder, Who does it for a step in a lane, the lane\'s roles (ob-lane-roles), 50 names', count: joinedIn('Uses this lane', '</span>', /@w\d+/g), bound: 50 },
  { name: 'the checklist preview, a step\'s and a lane\'s roles (pv-step-roles, pv-lane-roles), 50 names', count: joinedIn('<span class="pv-role">', '</span>', /@w\d+/g), bound: 50 },
  { name: 'the flight plan, a lane\'s roles (pv-lane-roles), 50 names', count: h => Math.max(joinedIn('<p class="fp-slane-h">', '</p>', /@w\d+/g)(h), joinedIn('<li class="fp-lane">', '</li>', /@w\d+/g)(h)), bound: 50 },
  { name: 'a run, a step row\'s people (rw-step-roles), 50 names', count: joinedIn('<span class="s-who">', '</span>', /Person \d+/g), bound: 50 },
  { name: 'a run, Next up\'s lane people (rw-next-roles), 50 names', count: joinedIn('aria-label="Next up"', '</div>', /Person \d+/g), bound: 50 },
  { name: 'a run, a lane\'s people (rw-lane-roles), 50 names', count: joinedIn('<div class="track-head">', '</div>', /<\/span>Person \d+/g), bound: 50 },
  { name: 'a run, the inspector\'s people for the step (rw-ins-roles), 50 names', count: joinedIn('<div class="rw-ins-meta">', '</div>', /<\/span>Person \d+/g), bound: 50 },
  { name: 'a run, the people avatars in a capped line (rw-ins-roles, rw-lane-roles), 50 each', rows: n => n.tag === 'span' && cls(n, 'avatar') && within(n, x => cls(x, 'rw-ins-meta') || cls(x, 'track-head')), bound: 50, per: 'parent' },
  { name: 'Screen share, a step\'s people (ms-step-roles), 50 avatars', rows: n => n.tag === 'span' && cls(n, 'avatar') && cls(n, 'lg') && within(n, x => cls(x, 'msteps')), bound: 50, per: 'parent' },
  { name: 'the builder, a linked step\'s run details its child doesn\'t have, one notice with its fold (ob-stale), 20', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'ob-stale-list'), bound: 20 },
  { name: 'Start, Plan and Start a test run, the run name, run detail boxes, and Plan\'s When and Note, at the format\'s cap of 40 (core/map.js)', rows: n => n.tag === 'label' && cls(n, 'field') && /^(detail-|run-title$|plan-when$|plan-note$)/.test(n.attrs.for || '') && within(n, x => x.tag === 'form' && /^(start|plan)-form$/.test(x.attrs.id || '')), bound: 40 + 3 },
  { name: 'a linked step\'s start dialog, run detail boxes, at the format\'s cap of 40 (core/map.js)', rows: n => n.tag === 'label' && cls(n, 'field') && /^cs-/.test(n.attrs.for || '') && !/^cs-role-/.test(n.attrs.for || '') && within(n, x => x.tag === 'form' && x.attrs.id === 'child-start-form'), bound: 40 }
];
/* Drawn in full on purpose, each with its reason. A capped one is also in REGISTRY at its cap. */
const STRUCTURE = n => (n.tag === 'li' && (cls(n, 'step') || cls(n, 'gate'))) || (n.tag === 'section' && cls(n, 'phase')) ||
  (n.tag === 'li' && n.parent && n.parent.tag === 'ol' && cls(n.parent, 'rw-phases')) || (n.tag === 'div' && cls(n, 'rrow')) ||
  (n.tag === 'li' && n.parent && (cls(n.parent, 'msteps') || (cls(n.parent, 'gates') && !cls(n.parent, 'mroles') && within(n, x => cls(x, 'mission'))))) ||
  (n.tag === 'div' && !n.attrs.class && n.parent && cls(n.parent, 'receipt')) ||
  (within(n, x => cls(x, 'mapview')) && (n.tag === 'li' || (n.tag === 'div' && cls(n, 'ph')))) ||
  /* The builder's outline (#ob-outline) is the checklist; its form, parts pane and the add-step form's type select aren't, so
     they're checked (code review round 7). */
  (n.tag !== 'option' && within(n, x => x.attrs.id === 'ob-outline')) || within(n, x => /^(flight|fp-|share)/.test(x.attrs.class || ''));
const EXEMPT = [
  { why: 'person pickers stay native selects (D6)', rows: n => n.tag === 'option' && personSelect(n.parent) },
  { why: 'the duration chart has its own cap (registered at 300)', rows: n => n.tag === 'a' && cls(n, 'ins-dot-a') },
  { why: 'checklist structure, drawn whole on every surface that draws a whole checklist: phases, steps and gates on the run screen, the builder, the flight plan, Receipt\'s rows, screen share and the checklist preview', rows: STRUCTURE },
  { why: 'bundled with the app, not the team folder: What\'s new and the built-in step types', rows: n => within(n, x => /\b(rel-|rn-)/.test(x.attrs.class || '') || x.attrs['data-disc'] === 'types-built') },
  { why: 'team values are capped by the format (registered at 100)', rows: n => n.tag === 'li' && n.parent && cls(n.parent, 'tv-list') },
  { why: 'a Start, Plan, test run or linked start form\'s roles not drawn keep their value in a hidden field each (nothing shown), so the form starts or plans what 2.10 did, and the form\'s own mode field', rows: n => n.tag === 'input' && n.attrs.type === 'hidden' && ('data-role' in n.attrs || n.attrs.id === 'start-mode') && within(n, x => x.tag === 'form' && /^(start|plan|child-start)-form$/.test(x.attrs.id || '')) },
  { why: 'a step type\'s Group and Tags suggestions are native datalists, which the browser filters as you type', rows: n => n.tag === 'option' && n.parent && n.parent.tag === 'datalist' },
  { why: 'the Connection check is left unchanged in 2.11', rows: n => within(n, x => /^(conn|cn-)/.test(x.attrs.class || '') || /^conn/.test(x.attrs.id || '')) }
];
const inIns = n => within(n, x => x.tag === 'section' && cls(x, 'ins'));
const inDisc = d => n => within(n, x => x.attrs['data-disc'] === d);
/* Lists the later slices of 2.11 bound, each with the slice that bounds it (plan section "Slices"). The slice removes its
   entries and registers the bound. An entry not drawn over 25 on a screen it names fails, so none can outstay its slice.
   slice null: a list the plan's D7 doesn't have yet; reported, not assigned. */
const PENDING = [];

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
/* An app of its own on the same folder, for a check that needs the folder as the fixture made it: the screens before it open
   every form they can, and on Many versions those include Apply and Decline on its corrections. */
async function freshApp() {
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fixture());
  return { app };
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
/* The actions that open a form or a dialog, as a person can on that screen: the first of each kind drawn there. The builder's
   (code review round 8): what selects a part and so draws its form, Rename, the delete questions, the add forms, + Add role,
   a step's hidden fields and note, and placing a part. */
const OPENERS = /^(pick|edit|fu-pick|corr-open|nc-open|people-owner|team-edit|team-remove|delete-copy|compare-copy|rep-accept|rep-decline|ev-open|hist-open|search|plan-from-run|start|plan-run|start-test|start-child|prop-review|corr-review|corr-apply|corr-decline|show-roles|timeline|load-history|run-reports|run-details|run-fu|mission|receipt|finish|diff|view-version|flight|fp-steps|ptab|ob-parts-open|new-process|new-type|corr-menu|fold|unfold|pr-open|setup-mode|ob-sel|ob-sel-track|ob-sel-phase|ob-sel-gate|ob-sel-details|ob-sel-questions|ob-ren|ob-ask|ob-add|ob-add-after|ob-add-phase|ob-role-add|ob-note-open|ob-show|ob-part)$/;
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
  const { app } = o.app ? { app: o.app } : await bigApp();
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
    const list = openers(app.html() + app.overlay() + app.top()), seen = new Set(list.map(x => x.key)), next = [];
    for (const x of list) {
      await go(app); await app.tick(10);
      app.click(x.act, x.id, x.data); await app.tick(15);
      await look(name + ' › ' + x.key);
      /* Openers a form or panel reveals (Details › Add people) are opened too, each kind once per screen. */
      openers(app.html() + app.overlay() + app.top()).forEach(y => { if (!seen.has(y.key)) { seen.add(y.key); next.push([x, y]); } });
      if (app.overlay()) { app.click('close-overlay'); await app.tick(5); }
    }
    for (const [x, y] of next) {
      await go(app); await app.tick(10);
      app.click(x.act, x.id, x.data); await app.tick(15);
      app.click(y.act, y.id, y.data); await app.tick(15);
      await look(name + ' › ' + x.key + ' › ' + y.key);
      if (app.overlay()) { app.click('close-overlay'); await app.tick(5); }
    }
  }
  /* A practice (Many roles › pr-open) only lets Checklists through: leave it, so the next screen's nav isn't refused. */
  if (/data-act="pr-back"/.test(app.html())) { app.click('pr-back'); await app.tick(10); }
  const expected = PENDING.filter(p => (p.on || []).indexOf(name) >= 0).map(p => p.name).filter(p => !pending.has(p));
  expected.forEach(p => fails.push(name + ': PENDING lists "' + p + '" here, but it isn\'t drawn over 25 any more. Take it off PENDING (and register its bound).'));
  assert.deepStrictEqual([...new Set(fails)], [], 'lists drawn past their bound');
}
const nav = (v, then) => async app => { app.click('nav', v); await app.tick(5); if (then) await then(app); };
const openRun = (key, then) => async app => { const { fx } = await bigApp(); app.click('nav', 'home'); await app.tick(5); app.click('open-run', fx.facts[key] || key); await app.tick(10); if (then) await then(app); };
const openProc = (id, tab) => async app => { app.click('nav', 'processes'); await app.tick(5); app.click('open-process', id); await app.tick(10); if (tab) { app.click('ptab', tab); await app.tick(10); } if (tab === 'edit' && /id="ob-outline"/.test(app.html())) { app.click('ed-mode', 'markdown'); await app.tick(10); } };
/* The builder (code review round 7): Edit, the builder, and what's selected in it (an action and its id). */
const inBuilder = (id, act, sel) => async app => { await openProc(id, 'edit')(app); app.click('ed-mode', 'builder'); await app.tick(10); if (act) { app.click(act, sel); await app.tick(10); } };

/* The forms found in code review that list every role, reached the same way each time (Details and Add people toggle). */
const detailsRoles = openRun('roles', async a => { a.click('takeover'); await a.tick(40); if (!/id="rw-details"/.test(a.html())) { a.click('run-details'); await a.tick(5); } if (/data-act="show-roles"/.test(a.html())) { a.click('show-roles'); await a.tick(5); } });
const testRoles = async a => { await openProc('roles')(a); const m = /data-act="start-test" data-id="([^"]+)"/.exec(a.html()); assert.ok(m, 'set-up: a staged version of Many roles'); a.click('start-test', m[1]); await a.tick(10); };
const childRoles = openRun('rolelink', async a => { a.click('takeover'); await a.tick(40); a.click('select', 'kid'); await a.tick(10); a.click('start-child', 'kid'); await a.tick(20); });

/* Code review round 10: the linked step whose child is a 300-detail draft, practice's Sample details on that draft, a test
   run of the 40-detail checklist, its child start dialog, and Start on 300 approvals, with others and on my own. */
const bigLink = inBuilder('linkbig', 'ob-sel', 'lkb');
const bigSamples = async a => { await inBuilder('bigkid', 'ob-sel', 's0')(a); a.click('pr-open'); await a.tick(20); if (!/id="pr-sample"/.test(a.html())) { a.click('pr-samples'); await a.tick(10); } };
const testOf = id => async a => { await openProc(id)(a); const m = /data-act="start-test" data-id="([^"]+)"/.exec(a.html()); assert.ok(m, 'set-up: a staged version of ' + id); a.click('start-test', m[1]); await a.tick(10); };
const detChild = openRun('detlink', async a => { a.click('takeover'); await a.tick(40); a.click('select', 'kid'); await a.tick(10); a.click('start-child', 'kid'); await a.tick(20); });
const gatesStart = async a => { await openProc('gates')(a); a.click('start', 'gates'); await a.tick(10); };
const gatesSolo = async a => { await gatesStart(a); a.click('start-mode', 'solo', { process: 'gates' }); await a.tick(10); };

/* Code review round 11: a checklist whose step and lane name 300 roles, its flight plan, a run of it on that step, and a
   linked step carrying 40 run details its child doesn't have. */
const widePlan = async a => { await openProc('wide')(a); a.click('flight', 'plan'); await a.tick(5); };
const wideRun = openRun('wide', async a => { a.click('select', 'all'); await a.tick(10); });
const staleLink = inBuilder('staleparent', 'ob-sel', 'lks');

/* ---------- every screen ---------- */
const SCREENS = [
  ['Home', nav('home')],
  ['Runs', nav('runs', async a => { a.click('filter', 'all'); await a.tick(5); })],
  ['Runs › Follow-ups, Open', nav('followups')],
  ['Runs › Follow-ups, All', nav('followups', async a => { a.click('fu-filter', 'all'); await a.tick(5); })],
  ['Checklists', nav('processes')],
  ['Skills', nav('skills')],
  ['A skill built on v1 of a 400-step checklist', nav('skills', async a => { a.click('open-skill', 'old-whole-skill.json'); await a.tick(10); })],
  ['A skill built on the 1-role version of a 300-role checklist', nav('skills', async a => { a.click('open-skill', 'old-roles-skill.json'); await a.tick(10); })],
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
  /* Receipt, screen share and the checklist preview (Four hundred steps, below) with the 400-step checklist (slice 4). */
  ['A run with 400 steps, its receipt', openRun('steps', async a => { a.click('receipt'); await a.tick(10); })],
  ['A run with 400 steps, shared on screen', openRun('steps', async a => { a.click('mission'); await a.tick(10); })],
  /* A team run (a solo run has no Screen share) with 300 roles, and one with 300 phases (its gates are structure). */
  ['A team run with 300 roles, shared on screen', openRun('rolesTeam', async a => { a.click('mission'); await a.tick(10); })],
  ['A run with 300 phases, shared on screen', openRun('phases', async a => { a.click('mission'); await a.tick(10); })],
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
  ['Many linked steps', openProc('linker')],
  ['Landed change', openProc('landed')],
  ['Busy run\'s checklist', openProc('busy')],
  ['Start a run with 300 roles', openProc('roles', null), { start: 'roles' }],
  /* Its process page opens Plan, Start and its staged version's Start a test run; a linked step starts a 300-role child. */
  ['Many roles', openProc('roles')],
  ['A run with 300 roles, Details › Add people', detailsRoles],
  ['Start a test run with 300 roles', testRoles],
  ['A run whose step starts a 300-role run', openRun('rolelink', async a => { a.click('takeover'); await a.tick(40); a.click('select', 'kid'); await a.tick(10); })],
  ['Plan a run', openProc('tiny', null), { plan: 'tiny' }],
  /* Found in code review round 7: the builder's form and parts pane were exempt with its outline. */
  ['Many linked steps › Edit › Builder, a linked step', inBuilder('linker', 'ob-sel', 'lk0')],
  ['Many roles › Edit › Builder, a step', inBuilder('roles', 'ob-sel', 's0')],
  ['Many roles › Edit › Builder, checklist details', inBuilder('roles', 'ob-sel-details', '')],
  ['Many phases › Edit › Builder, a phase', inBuilder('phases', 'ob-sel-phase', 'ph1')],
  ['Four hundred steps › Edit › Builder, a step', inBuilder('steps', 'ob-sel', 's1')],
  /* Code review round 10. */
  ['Links a big draft › Edit › Builder, the linked step', bigLink],
  ['Big child draft › Edit › Builder, a step', inBuilder('bigkid', 'ob-sel', 's0')],
  ['Big child draft › Practice, Sample details', bigSamples],
  ['Start a run with 40 run details', openProc('manydet', null), { start: 'manydet' }],
  ['Plan a run with 40 run details', openProc('manydet', null), { plan: 'manydet' }],
  ['Start a test run with 40 run details', testOf('manydet')],
  ['A run whose step starts a 40-detail run, its start dialog', detChild],
  ['Wide roles', openProc('wide')],
  ['Wide roles, its flight plan', widePlan],
  ['Wide roles › Edit › Builder, the 300-role step', inBuilder('wide', 'ob-sel', 'all')],
  ['Wide roles › Edit › Builder, a step in the 300-role lane', inBuilder('wide', 'ob-sel', 'inwide')],
  ['A run with a 300-role step', wideRun],
  ['A run with a 300-role step, shared on screen', openRun('wide', async a => { a.click('mission'); await a.tick(10); })],
  ['Carries stale details › Edit › Builder, the linked step', staleLink],
  ['Start a run with 300 approvals', gatesStart],
  ['Start a run with 300 approvals, On my own', gatesSolo]
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

rule('D8: 100 team step types, their reader\'s cap: the builder\'s type selects and parts list draw them within their bound', async () => {
  const fx = fixture({ size: { procs: 3, tags: 3, people: 10, followUps: 3, running: 3, plans: 3, versions: 3, stages: 2, members: 3, health: 3, many: 3, ended: 3, steps: 8, teamValues: 3, legacy: 3, archived: 3, hot: 3 } });
  for (let i = 0; i < 100; i++) fx.files['step-types/team.t' + String(i).padStart(3, '0') + '.json'] = JSON.stringify({ id: 'team.t' + String(i).padStart(3, '0'), label: 'Team type ' + i, fields: {}, record: [] });
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fx);
  await inBuilder('steps', 'ob-sel', 's1')(app);
  app.click('ob-add', 'ph1'); await app.tick(10);
  await openFolds(app);
  const h = app.html(), team = id => { const i = h.indexOf('<select id="' + id + '"'), sel = i < 0 ? '' : h.slice(i, h.indexOf('</select>', i)), g = sel.indexOf('label="Your team'); return g < 0 ? -1 : (sel.slice(g).match(/<option /g) || []).length; };
assert.strictEqual(team('ob-type'), 100, 'set-up: the step form\'s type select lists the 100');
  assert.strictEqual(team('ob-new-type'), 100, 'set-up: and the add-step form\'s');
  assert.ok((h.match(/data-act="ob-part" data-id="type:team\.t\d+"/g) || []).length >= 99, 'set-up: and the parts list');
  assert.deepStrictEqual(check('100 team step types, the builder', h).fails, []);
});

/* Code review round 8: Rename on a run detail 60 other checklists pass draws 20 of their warnings, reached through the
   builder's openers (Rename is one), and with paging off for them the check fails. Its own small folder: the big one has no
   detail that many checklists pass. */
rule('D8: Rename on a run detail 60 other checklists pass, and a step of that checklist, draw the warnings and the step\'s run details within bounds, and with paging off for each the check fails', async () => {
  const small = { procs: 3, tags: 3, people: 10, followUps: 3, running: 3, plans: 3, versions: 3, stages: 2, members: 3, health: 3, many: 3, ended: 3, steps: 8, teamValues: 3, legacy: 3, archived: 3, hot: 3 };
  const fx = fixture({ size: small }), files = Object.assign({}, fx.files);
  const fm = (proc, title, ctx) => '---\nprocess: ' + proc + '\ntitle: ' + title + '\ncategory: Synthetic\nowner: person-avery\ncontext: ' + ctx + '\nroles: lead\n---\n\n';
  files['maps/drafts/sixty.md'] = fm('sixty', 'Sixty details', Array.from({ length: 60 }, (x, i) => 'detail' + i).join(', ')) + '## Only · READ-DO {#ph1}\n- [ ] {confirm} Check ^detail0 @lead {#s0}\n';
  for (let i = 0; i < 60; i++) files['maps/drafts/parent-' + i + '.md'] = fm('parent' + i, 'Parent ' + i, 'detail0') + '## Only · READ-DO {#ph1}\n- [ ] {run.process} Start the sixty @lead {#k0}\n  process: sixty\n  pass: detail0=^detail0\n';
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, { files, facts: fx.facts });
  const details = inBuilder('sixty', 'ob-sel-details', '');
  /* Every form the screen's openers draw, Rename of its first run detail among them. */
  await visit('Sixty details › Edit › Builder, checklist details', details, { app });
  const look = async () => { await details(app); app.click('ob-ren', 'detail0'); await app.tick(10); await openFolds(app); return app.html(); };
  let h = await look();
  assert.strictEqual((h.match(/<li id="ob-ren-dep-/g) || []).length, 20, 'set-up: Rename lists its warnings');
  assert.deepStrictEqual(check('Sixty details › Edit › Builder, checklist details › Rename', h).fails, []);
  const offFails = async (list, go, expect) => {
    app.PF.vk.PAGE_OFF = list;
    try { const f = check(list + ', paging off', await go()).fails; assert.ok(f.some(x => expect.test(x)), 'paging off for ' + list + ' must fail the check: ' + f.join('; ')); }
    finally { app.PF.vk.PAGE_OFF = null; }
  };
  await offFails('ob-ren-deps', look, /Rename's warnings about other checklists \(ob-ren-deps\), 20 draws 60, over its bound of 20/);
  /* A step's run details, and Sets a run detail shown: 60 each, 20 drawn. */
  const step = async () => { await inBuilder('sixty', 'ob-sel', 's0')(app); app.click('ob-show', 'sets'); await app.tick(10); await openFolds(app); return app.html(); };
  h = await step();
  assert.strictEqual((h.match(/data-act="ob-bind"/g) || []).length, 20, 'set-up: a step\'s run details');
  assert.strictEqual((h.match(/data-act="ob-sets"/g) || []).length, 20, 'set-up: Sets a run detail');
  assert.deepStrictEqual(check('Sixty details › Edit › Builder, a step with Sets a run detail', h).fails, []);
  await offFails('ob-binds', step, /a step's run details \(ob-binds\), 20 and at most 20 of the step's own draws 60, over its bound of 40/);
  await offFails('ob-sets', step, /Sets a run detail \(ob-sets\), 20 and at most 20 of the ones the step sets draws 60, over its bound of 40/);
});

/* The check is itself checked: with paging off for one list, that list must fail it. A flat page, the tree, a select, the
   nested list (corrections, one page across groups) and the tail (the step-note thread). */
/* The checklist preview of the current version of Four hundred steps, whatever screens before it chose (Flight plan, Markdown, an
   older version). */
const stepsList = async app => { await openProc('steps', 'overview')(app); app.click('flight', 'list'); await app.tick(5); if (/data-act="back-current"/.test(app.html())) { app.click('back-current'); await app.tick(5); } };
const PAGE_OFF = [
  { list: 'runs-running', kind: 'flat', screen: 'Runs', go: SCREENS.filter(s => s[0] === 'Runs')[0][1], expect: /run cards .* draws \d+, over its bound/ },
  { list: 'processes', kind: 'tree', screen: 'Checklists', go: SCREENS.filter(s => s[0] === 'Checklists')[0][1], expect: /the Checklists and All skills tree, its rows .* draws \d+, over its bound of 50/ },
  { list: 'ins-dur', kind: 'flat', screen: 'Many versions › How runs go', go: SCREENS.filter(s => s[0] === 'Many versions › How runs go')[0][1], expect: /the duration table \(ins-dur\) draws \d+, over its bound of 50/ },
  /* The 400-step checklist passes as registered structure, and a bound on its screens still fails with paging off. */
  { list: 'ins-hot', kind: 'flat', screen: 'Four hundred steps › How runs go', go: SCREENS.filter(s => s[0] === 'Four hundred steps › How runs go')[0][1], expect: /steps that go off-script \(ins-hot\) draws \d+, over its bound of 50/ },
  { list: 'corr-move', kind: 'select', screen: 'A run with 400 steps, moving step 200', go: openRun('steps', async a => { a.click('takeover'); await a.tick(40); a.click('select', 's199'); await a.tick(10); a.click('corr-open', 's199', { mode: 'correct' }); await a.tick(10); a.click('corr-op', 'move'); await a.tick(10); }), expect: /a bounded dropdown \(K\.select\), per select draws \d+, over its bound of 54/ },
  /* Nested: one page across groups, 400 members of one correction group. */
  { list: 'fx:versions', kind: 'nested', screen: 'Many versions', go: openProc('versions'), fresh: true, expect: /Corrections, the members drawn .* draws \d+, over its bound of 52/ },
  /* The tail: the busy step's 327 notes, the newest 20 drawn. */
  /* Found in code review: Start a test run, Details › Add people and a linked step's start dialog, 20 roles each. */
  { list: 'test-roles', kind: 'flat', screen: 'Start a test run with 300 roles', go: testRoles, expect: /Start a test run, role rows .* draws \d+, over its bound of 40/ },
  { list: 'det-roles', kind: 'flat', screen: 'A run with 300 roles, Details › Add people', go: detailsRoles, expect: /Details, its role chips .* draws \d+, over its bound of 21/ },
  { list: 'cs-roles', kind: 'flat', screen: 'A run whose step starts a 300-role run, its start dialog', go: childRoles, dialog: true, expect: /start dialog, role rows \(cs-roles\) draws \d+, over its bound of 40/ },
  { list: 'ms-roles:' + fixture().facts.rolesTeam, kind: 'flat', screen: 'A team run with 300 roles, shared on screen', go: openRun('rolesTeam', async a => { a.click('mission'); await a.tick(10); }), expect: /Who's on what \(ms-roles\), 20 roles draws \d+, over its bound of 20/ },
  /* Found in code review round 7: the builder's linked-step sources, a step's roles and Checklist details' roles. */
  { list: 'ob-link-src-region', kind: 'select', screen: 'Many linked steps › Edit › Builder, a linked step', go: SCREENS.filter(s => s[0] === 'Many linked steps › Edit › Builder, a linked step')[0][1], expect: /a bounded dropdown \(K\.select\), per select draws \d+, over its bound of 54/ },
  { list: 'ob-roles', kind: 'flat', screen: 'Many roles › Edit › Builder, a step', go: SCREENS.filter(s => s[0] === 'Many roles › Edit › Builder, a step')[0][1], expect: /a step's roles \(ob-roles\), 20 and at most 20 of the step's own draws \d+, over its bound of 40/ },
  { list: 'ob-meta-roles', kind: 'flat', screen: 'Many roles › Edit › Builder, checklist details', go: SCREENS.filter(s => s[0] === 'Many roles › Edit › Builder, checklist details')[0][1], expect: /Checklist details' roles and run details .* draws \d+, over its bound of 21/ },
  /* Found in code review round 8: the preview's skill names, a step's and the whole checklist's (K.capJoin). */
  { list: 'pv-skills', kind: 'joined', screen: 'Four hundred steps', go: stepsList, expect: /a step's skills joined into one line \(pv-skills\), 50 names draws \d+, over its bound of 50/ },
  { list: 'pv-whole', kind: 'joined', screen: 'Four hundred steps', go: stepsList, expect: /the whole checklist's skills joined into one line \(pv-whole\), 50 names draws \d+, over its bound of 50/ },
  /* Found in code review round 9: a skill's What it takes, the roles of a checklist that went from 1 to 300 (K.capJoin). */
  { list: 'sk-inputs', kind: 'joined', screen: 'A skill built on the 1-role version of a 300-role checklist', go: SCREENS.filter(s => s[0] === 'A skill built on the 1-role version of a 300-role checklist')[0][1], expect: /What it takes, the roles now and before joined into one line \(sk-inputs\), 50 names each draws \d+, over its bound of 100/ },
  /* Found in code review round 10: a linked step's What it needs, Sample details, the outline's details card, who approves. */
  { list: 'ob-link-rows', kind: 'flat', screen: 'Links a big draft › Edit › Builder, the linked step', go: bigLink, expect: /what a linked step's child needs \(ob-link-rows\), 20 and the ones being filled in draws 300, over its bound of 20/ },
  { list: 'pr-samples', kind: 'flat', screen: 'Big child draft › Practice, Sample details', go: bigSamples, expect: /Sample details \(pr-samples\), 20 and the ones not accepted draws 300, over its bound of 20/ },
  { list: 'ob-det-context', kind: 'joined', screen: 'Big child draft › Edit › Builder, a step', go: inBuilder('bigkid', 'ob-sel', 's0'), expect: /Checklist details card, its run details \(ob-det-context\), 50 names draws 300, over its bound of 50/ },
  { list: 'ob-det-roles', kind: 'joined', screen: 'Many roles › Edit › Builder, a step', go: SCREENS.filter(s => s[0] === 'Many roles › Edit › Builder, a step')[0][1], expect: /Checklist details card, its roles \(ob-det-roles\), 50 names draws 300, over its bound of 50/ },
  { list: 'start-approves', kind: 'joined', screen: 'Start a run with 300 approvals', go: gatesStart, expect: /the approvals in a role's label \(start-approves\), 50 names draws 300, over its bound of 50/ },
  { list: 'start-approvals', kind: 'joined', screen: 'Start a run with 300 approvals, On my own', go: gatesSolo, expect: /On my own's who approves \(start-approvals\), 50 names draws 300, over its bound of 50/ },
  /* Found in code review round 11: role summaries on a step, a lane, the previews and a run (K.atRoles), and stale run details. */
  { list: 'ob-step-roles', kind: 'joined', screen: 'Wide roles › Edit › Builder, the 300-role step', go: inBuilder('wide', 'ob-sel', 'all'), expect: /a step's roles \(ob-step-roles\), 50 names draws 300, over its bound of 50/ },
  { list: 'ob-lane-roles', kind: 'joined', screen: 'Wide roles › Edit › Builder, the 300-role step', go: inBuilder('wide', 'ob-sel', 'all'), expect: /the builder outline, a lane's roles \(ob-lane-roles\), 50 names draws 300, over its bound of 50/ },
  { list: 'ob-lane-roles', kind: 'joined', screen: 'Wide roles › Edit › Builder, a step in the 300-role lane', go: inBuilder('wide', 'ob-sel', 'inwide'), expect: /Who does it for a step in a lane, the lane's roles \(ob-lane-roles\), 50 names draws 300, over its bound of 50/ },
  { list: 'pv-step-roles', kind: 'joined', screen: 'Wide roles', go: async a => { await openProc('wide')(a); a.click('flight', 'list'); await a.tick(5); }, expect: /the checklist preview, a step's and a lane's roles .*, 50 names draws 300, over its bound of 50/ },
  { list: 'pv-lane-roles', kind: 'joined', screen: 'Wide roles, its flight plan', go: widePlan, expect: /the flight plan, a lane's roles \(pv-lane-roles\), 50 names draws 300, over its bound of 50/ },
  { list: 'rw-step-roles', kind: 'joined', screen: 'A run with a 300-role step', go: wideRun, expect: /a step row's people \(rw-step-roles\), 50 names draws 300, over its bound of 50/ },
  { list: 'rw-next-roles', kind: 'joined', screen: 'A run with a 300-role step', go: wideRun, expect: /Next up's lane people \(rw-next-roles\), 50 names draws 300, over its bound of 50/ },
  { list: 'rw-lane-roles', kind: 'joined', screen: 'A run with a 300-role step', go: wideRun, expect: /a lane's people \(rw-lane-roles\), 50 names draws 300, over its bound of 50/ },
  { list: 'rw-ins-roles', kind: 'joined', screen: 'A run with a 300-role step', go: wideRun, expect: /the inspector's people for the step \(rw-ins-roles\), 50 names draws 300, over its bound of 50/ },
  { list: 'ms-step-roles', kind: 'joined', screen: 'A run with a 300-role step, shared on screen', go: openRun('wide', async a => { a.click('mission'); await a.tick(10); }), expect: /a step's people \(ms-step-roles\), 50 avatars draws 300, over its bound of 50/ },
  { list: 'ob-stale:lks', kind: 'flat', screen: 'Carries stale details › Edit › Builder, the linked step', go: staleLink, expect: /run details its child doesn't have, one notice with its fold \(ob-stale\), 20 draws 40, over its bound of 20/ },
  { list: 'notes:' + fixture().facts.busy + ':s0', kind: 'tail', screen: 'The busy run', go: SCREENS.filter(s => s[0] === 'The busy run')[0][1], expect: /the step-note thread .* draws \d+, over its bound of 21/ }
];
const PAGE_OFF_PENDING = [];
PAGE_OFF.forEach(t => {
  rule('D8 is tested: with paging off for ' + t.list + ' (' + t.kind + '), the bounds check fails for it, and passes again with paging on', async () => {
    const { app } = t.fresh ? await freshApp() : await bigApp();
    const look = async () => { if (app.overlay()) { app.click('close-overlay'); await app.tick(5); } await t.go(app); await app.tick(10); await openFolds(app); return check(t.screen, t.dialog ? app.overlay() : app.html()).fails; };
    assert.deepStrictEqual((await look()).filter(f => t.expect.test(f)), [], 'set-up: bounded with paging on');
    app.PF.vk.PAGE_OFF = t.list;
    try { const f = await look(); assert.ok(f.some(x => t.expect.test(x)), 'paging off for ' + t.list + ' must fail the check: ' + f.join('; ')); }
    finally { app.PF.vk.PAGE_OFF = null; await redraw(app); if (t.kind === 'select') { app.click('corr-cancel'); await app.tick(5); } if (app.overlay()) { app.click('close-overlay'); await app.tick(5); } }
  });
});
rule('D8: the duration chart draws its 300 dots (400 ended runs of one version) and passes, registered at its cap', async () => {
  const { app } = await bigApp();
  await SCREENS.filter(s => s[0] === 'Many versions › How runs go')[0][1](app); await app.tick(10);
  const html = app.html();
  assert.strictEqual((html.match(/<a [^>]*class="ins-dot-a"/g) || []).length, 300);
  assert.deepStrictEqual(check('Many versions › How runs go', html).fails, []);
});
rule('D8 is tested: the kinds of list not yet paged in this slice are listed with the slice that adds their PAGE_OFF check', () => {
  assert.deepStrictEqual(PAGE_OFF_PENDING.map(k => k.kind).concat(PAGE_OFF.map(t => t.kind)).filter((k, i, a) => a.indexOf(k) === i).sort(), ['flat', 'joined', 'nested', 'select', 'tail', 'tree']);
});
rule('D8: PENDING names each list once, with a slice of 2.11 or null for one the plan doesn\'t have yet', () => {
  const names = PENDING.map(p => p.name);
  assert.strictEqual(new Set(names).size, names.length);
  PENDING.forEach(p => assert.ok(p.slice === null || [2, 3, 4, 5].indexOf(p.slice) >= 0, p.name));
});

/* ---------- code review round 4: keys are identities, and the focused row stays drawn ---------- */
/* A redraw that changes nothing else and leaves focus where it is (a click on Dismiss would take it). */
const quietRedraw = async app => { app.fire('click', { target: { closest: () => ({ dataset: { act: 'dismiss' }, disabled: false, classList: { contains: () => false } }) } }); await app.tick(5); };
/* Every list each screen draws (PF.vk.TRACE): its id, keys, page and focus target. */
async function traced(app, name, go, o) {
  let g = go;
  if (o && o.start) g = async a => { await go(a); a.click('start', o.start); await a.tick(10); };
  if (o && o.plan) g = async a => { await go(a); a.click('plan-run', o.plan); await a.tick(10); };
  if (app.overlay()) { app.click('close-overlay'); await app.tick(5); }
  await g(app); await app.tick(10); await openFolds(app);
  app.PF.vk.TRACE = [];
  try { await quietRedraw(app); return app.PF.vk.TRACE; } finally { app.PF.vk.TRACE = null; }
}
rule('Round 4: on every screen, the last row drawn of every paged list keeps focus and stays drawn, once, when an item sorting in above pushes it off the page', async () => {
  /* Its own app: a rule before it in the same shard can leave a list shown in full (Show more), so not paged here. */
  const { app } = await freshApp(), fails = [], tried = new Set();
  for (const [name, go, o] of SCREENS) {
    const seen = new Set();
    for (const l of await traced(app, name, go, o)) {
      if (seen.has(l.id) || l.keys.length <= l.page.length || !l.page.length) continue;
      seen.add(l.id);
      /* The row the arrival pushes off: the page's last (a tail's first, the newest arriving below it). */
      const k = l.tail ? l.page[0] : l.page[l.page.length - 1], sel = l.focusOf(k), el = app.node(sel);
      if (!el) { fails.push(name + ' › ' + l.id + ': its row ' + k + ' has no element for ' + sel); continue; }
      el.focus();
      app.PF.vk.ARRIVE = l.id; app.PF.vk.TRACE = [];
      let after;
      try { await quietRedraw(app); after = app.PF.vk.TRACE.filter(x => x.id === l.id)[0]; } finally { app.PF.vk.ARRIVE = null; app.PF.vk.TRACE = null; }
      tried.add(l.id.replace(/:.*/, ''));
      const now = app.node(sel);
      if (!after || after.page.indexOf(k) >= 0) fails.push(name + ' › ' + l.id + ': set-up: the arrival didn\'t push ' + k + ' off the page');
      else if (after.extra.filter(x => x === k).length !== 1 || after.extra.length > 1 + after.extra.filter(x => x !== k && l.extra.indexOf(x) >= 0).length) fails.push(name + ' › ' + l.id + ': ' + k + ' isn\'t drawn once past the page: ' + after.extra.join(', '));
      if (!now || app.doc.activeElement !== now) fails.push(name + ' › ' + l.id + ': focus on ' + k + ' went to ' + app.activeId());
      await quietRedraw(app);
    }
  }
  assert.deepStrictEqual(fails, []);
  /* The kinds of paged list the fixture fills: flat, tree, tail and the nested corrections, at least. */
  ['runs-running', 'processes', 'notes', 'rcorr', 'fx', 'home-todo', 'ins-dur'].forEach(x => assert.ok(tried.has(x), 'tried ' + x + ': ' + [...tried].join(', ')));
});
/* A key built from a row's place: an item's index (from map's or forEach's second argument) kept on it and returned by keyOf.
   Checked in the source of every list the views draw, since a screen's keys can't tell a place from an id that happens to
   count up (the fixture's roles are r1, r2…). */
const fsx = require('fs'), pathx = require('path');
function placeKeys(src) {
  const out = [], idx = new Set();
  /* Fields given an index: { …, i: i } or x.n = i, from a callback's (x, i). */
  for (const m of src.matchAll(/function \(\w+, (\w+)\) \{[^\n]*?\{[^{}\n]*\b(\w+): \1\b/g)) idx.add(m[2]);
  for (const m of src.matchAll(/function \(\w+, (\w+)\) \{ \w+\.(\w+) = \1;/g)) idx.add(m[2]);
  for (const m of src.matchAll(/keyOf: function \((\w+)\) \{ return ([^}]*)\}/g)) {
    const body = m[2], uses = [...body.matchAll(new RegExp('\\b' + m[1] + '\\.(\\w+)', 'g'))].map(x => x[1]);
    if (uses.some(f => idx.has(f)) || new RegExp('^String\\(' + m[1] + '\\);?\\s*$').test(body.trim())) out.push(m[0]);
  }
  return out;
}
rule('Round 4: no list the views draw is keyed by its rows\' places, and on every screen no two rows of a list share a key', async () => {
  const dir = pathx.join(__dirname, '..', 'src', 'ui', 'views'), fails = [];
  fsx.readdirSync(dir).filter(f => /\.js$/.test(f)).forEach(f => placeKeys(fsx.readFileSync(pathx.join(dir, f), 'utf8')).forEach(k => fails.push(f + ': keyed by place: ' + k)));
  const { app } = await bigApp();
  for (const [name, go, o] of SCREENS) for (const l of await traced(app, name, go, o)) if (new Set(l.keys).size !== l.keys.length) fails.push(name + ' › ' + l.id + ': two rows share a key');
  assert.deepStrictEqual([...new Set(fails)], []);
});
rule('Round 4: the place check is itself checked: the lists 2.11 keyed by place fail it, the same lists keyed by their items pass', () => {
  /* As the views had them before code review round 4. */
  const before = [
    "items.forEach(function (x, i) { x.n = i; });\n K.list(st, 'home-todo', items, { keyOf: function (x) { return String(x.n); } });",
    "K.list(s, 'ans:' + rk, a.history.slice().reverse().map(function (y, i) { return { y: y, i: i }; }), { page: 20, keyOf: function (x) { return String(x.i); } });",
    "K.list(ctx.state, 'prop-recs', recs.map(function (r, i) { return { r: r, i: i }; }), { keyOf: function (x) { return String(x.i); } });",
    "g.members.forEach(function (m, i) { items.push({ k: k, g: g, m: m, i: i }); });\n K.list(st, lid, items, { draw: draw, keyOf: function (x) { return x.g.id + '#' + x.i; } });",
    "K.list(st || {}, id, ch, { draw: draw, keyOf: function (i) { return String(i); } });"
  ];
  before.forEach(src => assert.strictEqual(placeKeys(src).length, 1, src));
  ["K.list(st, 'x', items, { keyOf: function (x) { return x.key; } });", "K.list(st, 'x', rows, { keyOf: function (r) { return r.k; } });", "K.list(st, 'x', items, { keyOf: function (i) { return kOf[i]; } });"]
    .forEach(src => assert.strictEqual(placeKeys(src).length, 0, src));
});

run();
