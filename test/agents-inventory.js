// The rule inventory of 2.15.0 (docs/design.md, AGENTS.md room): every unit of AGENTS.md as 2.14.0 shipped it
// (test/fixtures/agents-2.14.0.md) has one entry saying where it went, and checks(state) proves the shipped files say so.
// A unit is a sentence, a list item's text or a fenced line, by unitsAt(); its key is <line>.<index on that line> in the
// fixture. Every home is a section: a reference's ## section, or an AGENTS.md section inside region() ('top' is the part
// before the first ##; 'after' is the text past the end marker). checks() returns the failing rule set: 1-12 and a-f, plus
// the docs routed check as 'docs'. test/agents-inventory.test.js runs it on the shipped files and on each broken copy.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { load } = require('./harness');
const PF = load(), C = PF.contract, R = PF.contract, PR = require('./prose-reader');
const K = require('../bin/flightdeck.js');
const ROOT = path.join(__dirname, '..'), EX = path.join(ROOT, 'example-folder');
const read = (p) => fs.readFileSync(path.join(EX, p), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const REFS = R.REFS, GUIDE = REFS + 'command-guide.md', ESS = REFS + 'checklist-essentials.md', FF = REFS + 'file-formats.md', MF = REFS + 'map-format.md';
const SKD = '.flightdeck/skills/';
const STEP = SKD + 'flightdeck-new-step-type/SKILL.md';
const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'baselines.json'), 'utf8')).files;
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'agents-2.14.0.md'), 'utf8');
const AGENTS = read('AGENTS.md');
/* AGENTS.md's ceiling: 2.14.0's copy less the room the design keeps for team notes and the index rows (design section 4). */
const ROOM_CEILING = 19688 + 141; /* 3.0: the library inspect row in Commands (assistant-start.test.js) */
const WHY_WORDS = /\b(never|must|only)\b/i;
const GUIDANCE = /\b(never|must|don't|do not|check|checks|read|leave out|only|ignore|skip|should|unless|instead|avoid|make sure|was meant|reopens)\b|\bis only\b/i;
const GRANT = /\byou (may|can)\b|\b(is|are) (fine|ok|okay|allowed)\b|\bfeel free\b|\ballowed to\b/i;
const noCode = (t) => t.replace(/`[^`]*`/g, '');
const flat = (t) => t.replace(/\s+/g, ' ');
const codeSpans = (t) => t.match(/`[^`]*`/g) || [];
const slug = (h) => h.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

/* unitsAt(md): the units of a Markdown text by the rules of sentences() in test/assistant-start.test.js, each with its key.
   Fence lines are whole units; fence markers are not units. */
function unitsAt(md) {
  const out = []; let fence = false;
  md.split('\n').forEach((line, i) => {
    const at = i + 1; let parts, inFence = false;
    if (/^\s*```/.test(line)) { fence = !fence; return; }
    if (fence) { parts = [line]; inFence = true; }
    else {
      const codes = []; const masked = line.replace(/`[^`]*`/g, (c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
      parts = masked.split(/(?<=[.;:!?)])\s+(?=[A-Z\u0000*"(])/).map((x) => x.replace(/\u0000(\d+)\u0000/g, (m, n) => codes[n]));
    }
    parts.map((s) => s.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').replace(/\s+/g, ' ').trim()).filter((s) => s.length > 1).forEach((text, n) => out.push({ at: at + '.' + n, line: at, text, fence: inFence }));
  });
  return out;
}

/* Classes: C1-C6, C8, C10, C12, C14-C16, C18 stay in AGENTS.md (rules, safety, what may and may never be written, the record);
   C7, C9, C11, C13, C17, C20 move to a reference section (how a command or a file works); C21 is already said, word for word,
   in a file 2.14.0 shipped. Class by fixture line: [first, last, stays, moves]. */
const SECTIONS = [
  [1, 7, 'C1'], [8, 9, 'C5'], [10, 16, 'C2'], [17, 29, 'C3'], [30, 50, 'C4'], [51, 65, 'C5'], [66, 98, 'C6', 'C7'], [99, 113, 'C8', 'C9'],
  [114, 131, 'C10', 'C11'], [132, 147, 'C12', 'C13'], [148, 151, 'C14', 'C20'], [152, 162, 'C15'], [163, 172, 'C16', 'C17'], [173, 183, 'C18']
];
const sectionOf = (line) => SECTIONS.find((s) => line >= s[0] && line <= s[1]);
const STAYS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C8', 'C10', 'C12', 'C14', 'C15', 'C16', 'C18'];
/* The AGENTS.md section each staying class lives in; 8.x is 0a (top); line 180 on is past the end marker. 144.2 and 144.4 are
   C3: they sit in the evidence row of What you may write. */
const CLASS_HOME = { C1: 'top', C2: 'safety-rules', C3: 'what-you-may-write', C4: 'what-you-must-never-touch', C5: 'skills-for-this-folder',
  C6: 'writing-a-checklist', C8: 'skills-built-from-processes-process-to-skill-traceability', C10: 'planning-a-run', C12: 'reading-runs',
  C14: 'reporting-work', C15: 'corrections', C16: 'editing-drafts', C18: 'saved-history' };
const KEY_HOME = { '8.0': 'top', '8.1': 'top' };
const agentsHome = (key, line, cls) => 'AGENTS.md#' + (line >= 180 ? 'after' : KEY_HOME[key] || CLASS_HOME[cls]);
const isA = (home) => home.split('#')[0] === 'AGENTS.md';

const H = {}, G = {};
[['top', 'top'], ['safety', 'safety-rules'], ['may', 'what-you-may-write'], ['never', 'what-you-must-never-touch'], ['skills', 'skills-for-this-folder'],
  ['commands', 'commands'], ['checklist', 'writing-a-checklist'], ['built', 'skills-built-from-processes-process-to-skill-traceability'],
  ['planning', 'planning-a-run'], ['reading', 'reading-runs'], ['reporting', 'reporting-work'], ['corrections', 'corrections'],
  ['drafts', 'editing-drafts'], ['history', 'saved-history'], ['after', 'after']].forEach(([k, a]) => { H[k] = 'AGENTS.md#' + a; });
[['reading', 'reading-runs'], ['drafts', 'editing-drafts'], ['reporting', 'reporting-work'], ['built', 'skills-built-from-processes'],
  ['planning', 'planning-a-run'], ['asking', 'asking-for-a-run'], ['packs', 'evidence-packs']].forEach(([k, a]) => { G[k] = GUIDE + '#' + a; });
G.checklist = ESS + '#writing-a-checklist';
G.top = GUIDE + '#top'; G.essTop = ESS + '#top';

/* One entry: the fixture keys it covers, and each target: { class, home, now (the new text when it isn't the old one), why,
   changed (a staying unit whose words changed in place), drops ([{ span, why }]: code spans the new text leaves out) }. */
const T = (cls, home, o) => Object.assign({ class: cls, home, now: null, why: '', drops: [] }, o || {});
const E = (old, ...to) => ({ id: old[0], old, to });
const ENTRIES = [
  E(['1.0'], T('C1', H.top)),
  E(['2.0'], T('C1', H.top)),
  E(['4.0'], T('C1', H.top)),
  E(['4.1'], T('C1', H.top)),
  E(['6.0'], T('C1', H.top)),
  E(['6.1'], T('C1', H.top)),
  E(['6.2'], T('C1', H.top)),
  E(['6.3'], T('C1', H.top)),
  E(['8.0'], T('C5', H.top, { now: 'How to run most commands is in `.flightdeck/skills/_flightdeck/command-guide.md` (*the command guide*), the checklist essentials in `.flightdeck/skills/_flightdeck/checklist-essentials.md` (*the checklist essentials*), and the long file formats in `.flightdeck/skills/_flightdeck/file-formats.md` (*the file formats*).', why: '0a replaces the one line that named the file formats: it names all three references by full path' })),
  E(['8.1'], T('C5', H.top, { now: 'Before each kind of work, read the part named in that work\'s section (its How: line) or in its row of the Skills or Commands table below.', why: '0a: read the part a section names before that kind of work' })),
  E(['10.0'], T('C2', H.safety)),
  E(['12.0'], T('C2', H.safety)),
  E(['12.1'], T('C2', H.safety)),
  E(['13.0'], T('C2', H.safety)),
  E(['13.1'], T('C2', H.safety)),
  E(['13.2'], T('C2', H.safety)),
  E(['13.3'], T('C2', H.safety)),
  E(['14.0'], T('C2', H.safety)),
  E(['15.0'], T('C2', H.safety)),
  E(['15.1'], T('C2', H.safety)),
  E(['17.0'], T('C3', H.may)),
  E(['19.0'], T('C3', H.may)),
  E(['20.0'], T('C3', H.may)),
  E(['21.0','21.1'], T('C3', H.may, { now: '| Create or edit checklists | `maps/drafts/<process>.md`, through `flightdeck draft save` when the command is available (see *Editing drafts*); it may make your change a proposal, `proposed/<process>/<id>.json`, which a person applies in Flightdeck. |', why: 'the drafts row is shorter: when the command writes the draft is in the command guide; the row keeps the proposal' })),
  E(['22.0'], T('C3', H.may)),
  E(['23.0'], T('C3', H.may)),
  E(['23.1'], T('C3', H.may)),
  E(['23.2'], T('C3', H.may)),
  E(['24.0'], T('C3', H.may)),
  E(['25.0'], T('C3', H.may, { now: '| Add or change a team step type | `step-types/<id>.json`, only through `flightdeck type save` (see `/flightdeck-new-step-type`, which also gives the person\'s route when the command can\'t save).', why: 'C3a: a team step type is saved only through flightdeck type save, as the step-type skill says (SKILL.md:16)', changed: true }), T('C21', MF, { now: 'The file name must match the `id`', why: 'the file name must match the id: already said in map-format.md as 2.14.0 shipped it' })),
  E(['25.1'], T('C21', STEP, { now: '`group` (optional)', why: 'already said in the step-type skill as 2.14.0 shipped it' }), T('C21', STEP, { now: '`tags` (optional)', why: 'already said in the step-type skill as 2.14.0 shipped it' }), T('C21', STEP, { now: 'Both only organize', why: 'already said in the step-type skill as 2.14.0 shipped it' })),
  E(['26.0'], T('C3', H.may)),
  E(['27.0'], T('C3', H.may)),
  E(['28.0'], T('C3', H.may, { now: '| Make an evidence pack, when a person asks | `flightdeck export`, never into this folder.', why: 'the evidence row now holds the evidence-pack rules that stay (144.2, 144.4)' })),
  E(['30.0'], T('C4', H.never)),
  E(['32.0'], T('C4', H.never)),
  E(['32.1'], T('C4', H.never)),
  E(['33.0'], T('C4', H.never)),
  E(['33.1'], T('C4', H.never)),
  E(['34.0'], T('C4', H.never)),
  E(['34.1'], T('C4', H.never)),
  E(['35.0'], T('C4', H.never)),
  E(['35.1'], T('C4', H.never)),
  E(['35.2'], T('C4', H.never)),
  E(['36.0'], T('C4', H.never)),
  E(['36.1'], T('C4', H.never)),
  E(['37.0'], T('C4', H.never)),
  E(['38.0'], T('C4', H.never)),
  E(['38.1'], T('C4', H.never)),
  E(['39.0'], T('C4', H.never)),
  E(['40.0'], T('C4', H.never)),
  E(['40.1'], T('C4', H.never)),
  E(['41.0'], T('C4', H.never)),
  E(['41.1'], T('C4', H.never)),
  E(['42.0'], T('C4', H.never)),
  E(['42.1'], T('C4', H.never)),
  E(['42.2'], T('C4', H.never)),
  E(['42.3'], T('C4', H.never)),
  E(['43.0'], T('C4', H.never)),
  E(['43.1'], T('C4', H.never)),
  E(['43.2'], T('C4', H.never)),
  E(['44.0'], T('C4', H.never)),
  E(['44.1'], T('C4', H.never)),
  E(['45.0'], T('C4', H.never)),
  E(['45.1'], T('C4', H.never)),
  E(['46.0'], T('C4', H.never)),
  E(['46.1'], T('C4', H.never)),
  E(['47.0'], T('C4', H.never)),
  E(['47.1'], T('C4', H.never)),
  E(['47.2'], T('C4', H.never)),
  E(['47.3'], T('C4', H.never)),
  E(['48.0'], T('C4', H.never)),
  E(['48.1'], T('C4', H.never)),
  E(['48.2'], T('C4', H.never)),
  E(['48.3'], T('C4', H.never)),
  E(['49.0'], T('C4', H.never)),
  E(['49.1'], T('C4', H.never)),
  E(['51.0'], T('C5', H.skills)),
  E(['53.0'], T('C5', H.skills)),
  E(['53.1'], T('C5', H.skills)),
  E(['55.0'], T('C5', H.skills)),
  E(['56.0'], T('C5', H.skills)),
  E(['57.0'], T('C5', H.skills)),
  E(['58.0'], T('C5', H.skills)),
  E(['59.0'], T('C5', H.skills)),
  E(['60.0'], T('C5', H.skills)),
  E(['61.0'], T('C5', H.skills)),
  E(['62.0'], T('C5', H.skills, { now: '| `/flightdeck-new-step-type <what it\'s for>` | Create or change a team step type, through `flightdeck type save` |', why: 'the row names the command; the step-types/ row of What you may write names the folder', drops: [{ span: '`step-types/`', why: 'the row says the command; the step-type row of What you may write names the folder' }] })),
  E(['63.0'], T('C5', H.skills)),
  E(['64.0'], T('C5', H.skills)),
  E(['66.0'], T('C6', H.checklist)),
  E(['68.0'], T('C6', H.checklist)),
  E(['68.1'], T('C6', H.checklist)),
  E(['68.2'], T('C6', H.checklist)),
  E(['68.3'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['70.1', '70.0'], T('C7', G.checklist, { now: '`process`, `title`, `category`, `group` (its place in the hierarchy, like `Engineering / Releases`), `tags`, `owner` (a person ID from `people.json`), `backup` (optional: another person ID, who signs off only while the owner is inactive or gone), `context` (run details), `roles`, and `runs: solo` when one person usually runs it alone.', why: 'moved: how, not a rule; round 8 drops the "Front matter:" label, which only repeated the ### Front matter heading above it' })),
  E(['70.2'], T('C6', H.checklist)),
  E(['70.3'], T('C6', H.checklist)),
  E(['71.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['71.1'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['71.2'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['71.3'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['74.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['75.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['76.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['77.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['78.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['79.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['80.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['81.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['82.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['83.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['85.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['85.1'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['85.2'], T('C6', H.checklist)),
  E(['86.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['86.1'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['86.2'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['87.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['87.1'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['87.2'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['88.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['88.1'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['88.2'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['89.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['89.1'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['89.2'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['89.3'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['89.4'], T('C6', H.checklist, { now: 'Use times (`at:`, `due:`, `after:`) only when the time is real (a change window, a cutoff).', why: 'context words added, since the syntax before it moved' })),
  E(['90.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['90.1'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['90.2'], T('C6', H.checklist, { now: 'A typed run detail (a kind in `context`, like `rows:number`) makes the checklist need Flightdeck 2.0, so add one only when the team uses 2.0.', why: 'context words added, since the syntax before it moved' })),
  E(['90.3'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['91.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['91.1'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['92.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['92.1'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['92.2'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['92.3'], T('C6', H.checklist)),
  E(['92.4'], T('C6', H.checklist, { now: '`only when` makes the checklist need Flightdeck 2.1, so use it only when the team uses 2.1.', why: 'context words added, since the syntax before it moved' })),
  E(['93.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['93.1'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['93.2'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['93.3'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['93.4'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['94.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['94.1'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['95.0'], T('C6', H.checklist)),
  E(['95.1'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['96.0'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['96.1'], T('C7', G.checklist, { why: 'moved: how, not a rule' })),
  E(['97.0'], T('C6', H.checklist)),
  E(['97.1'], T('C6', H.checklist)),
  E(['97.2'], T('C6', H.checklist)),
  E(['99.0'], T('C8', H.built)),
  E(['101.0'], T('C9', G.built, { why: 'moved: how, not a rule' })),
  E(['101.1'], T('C9', G.built, { why: 'moved: how, not a rule' })),
  E(['101.2'], T('C8', H.built, { now: 'When you create or update a skill from a Flightdeck brief, register it in this folder.', why: '"a skill" instead of "one", since the sentence before it moved' })),
  E(['101.3'], T('C8', H.built)),
  E(['103.0'], T('C8', H.built)),
  E(['103.1'], T('C8', H.built)),
  E(['103.2'], T('C8', H.built)),
  E(['105.0'], T('C9', G.built, { why: 'moved: how, not a rule' })),
  E(['105.1'], T('C9', G.built, { why: 'moved: how, not a rule' })),
  E(['105.2'], T('C8', H.built)),
  E(['107.0'], T('C8', H.built)),
  E(['109.0'], T('C9', G.built, { why: 'moved: how, not a rule' })),
  E(['109.1'], T('C9', G.built, { why: 'moved: how, not a rule' })),
  E(['110.0'], T('C8', H.built)),
  E(['111.0'], T('C9', G.built, { why: 'moved: how, not a rule' })),
  E(['111.1'], T('C8', H.built)),
  E(['111.2'], T('C8', H.built)),
  E(['112.0'], T('C9', G.built, { why: 'moved: how, not a rule' })),
  E(['114.0'], T('C10', H.planning)),
  E(['116.0'], T('C10', H.planning)),
  E(['116.1'], T('C10', H.planning, { now: 'The `id` starts with `plan-` and is lowercase letters, numbers and dashes, with a random part so two plans written on two computers never collide (`plan-<process>-<yyyy-mm-dd>-<6 random letters or digits>`), and the file name is the `id` plus `.json`.', why: 'the example after it moved, so the colon becomes a full stop' })),
  E(['119.0'], T('C11', G.planning, { why: 'moved: how, not a rule' })),
  E(['120.0'], T('C11', G.planning, { why: 'moved: how, not a rule' })),
  E(['121.0'], T('C11', G.planning, { why: 'moved: how, not a rule' })),
  E(['122.0'], T('C11', G.planning, { why: 'moved: how, not a rule' })),
  E(['123.0'], T('C11', G.planning, { why: 'moved: how, not a rule' })),
  E(['126.0'], T('C11', G.planning, { why: 'moved: how, not a rule' })),
  E(['126.1'], T('C11', G.planning, { why: 'moved: how, not a rule' })),
  E(['126.2'], T('C11', G.planning, { why: 'moved: how, not a rule' })),
  E(['126.3'], T('C10', H.planning)),
  E(['128.0'], T('C10', H.planning)),
  E(['128.1'], T('C10', H.planning)),
  E(['128.2'], T('C10', H.planning)),
  E(['130.0'], T('C11', G.planning, { why: 'moved: how, not a rule' })),
  E(['130.1'], T('C11', G.planning, { why: 'moved: how, not a rule' })),
  E(['130.2'], T('C11', G.planning, { why: 'moved: how, not a rule' })),
  E(['130.3'], T('C11', G.planning, { why: 'moved: how, not a rule' })),
  E(['132.0'], T('C12', H.reading)),
  E(['134.0'], T('C12', H.reading, { now: '**Read through the command when it\'s installed.**', why: 'split: the bold lead stays' }), T('C13', G.reading, { now: '`flightdeck runs <team folder> --contract 2 --json` (with `--process <id>` and `--status running|planned|ended|all`), `flightdeck run <team folder> <process>/<run id> --contract 2 --json`, `flightdeck next <team folder> <process>/<run id> --contract 2 --json` (what\'s waiting, and on whom), `flightdeck followups <team folder> --contract 2 --json` (with `--status open|all`), `flightdeck processes <team folder> --contract 2 --json` and `flightdeck process <team folder> <process> --contract 2 --json` read the folder exactly as Flightdeck does and never change it.', why: 'split: the commands move to the guide' })),
  E(['134.1'], T('C12', H.reading)),
  E(['134.2'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['134.3'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['134.4'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['134.5'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['134.6'], T('C13', G.reading, { now: 'Without the command, read the files as this section describes.', why: '"as this section describes": the files are described in the guide section it is in' })),
  E(['136.0'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['136.1'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['136.2'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['136.3'], T('C12', H.reading)),
  E(['136.4'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['136.5'], T('C12', H.reading)),
  E(['136.6'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['136.7'], T('C12', H.reading)),
  E(['136.8'], T('C13', G.reading, { now: 'Follow-ups are in `followUps`; notes with `"kind": "correction"` are corrections to the checklist (see *Corrections* in `AGENTS.md`); older notes with `"kind": "fix"` (suggested fixes) or `"kind": "map"` describe a problem in their `text`.', why: '"see below" pointed to Corrections in AGENTS.md, which the guide now names' })),
  E(['136.9'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['138.0'], T('C12', H.reading)),
  E(['138.1'], T('C12', H.reading)),
  E(['139.0'], T('C12', H.reading)),
  E(['139.1'], T('C12', H.reading)),
  E(['140.0'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['141.0'], T('C12', H.reading)),
  E(['141.1'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['141.2'], T('C12', H.reading)),
  E(['141.3'], T('C12', H.reading)),
  E(['141.4'], T('C12', H.reading)),
  E(['141.5'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['142.0'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['143.0'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['144.0'], T('C13', G.packs, { now: '**Evidence packs:** when a person asks for a run\'s evidence, run `flightdeck export <team folder> --run <process>/<id> --out <a folder outside the team folder>` (or `--process <id> --from YYYY-MM-DD --through YYYY-MM-DD --tz Area/City` for the runs started on those days).', why: 'no "you may": the guide never grants; AGENTS.md says what may be done' })),
  E(['144.1'], T('C13', G.packs, { why: 'moved: how, not a rule' })),
  E(['144.2'], T('C3', H.may)),
  E(['144.3'], T('C13', G.packs, { why: 'moved: how, not a rule' })),
  E(['144.4'], T('C3', H.may, { now: 'Give the person the SHA-256 it prints, to keep somewhere separate from the pack. |', why: 'it ends in a table cell of the evidence row' })),
  E(['145.0'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['145.1'], T('C12', H.reading, { now: '**Publications:** a version folder without `publication.json` is still syncing; ignore it.', why: 'the bold lead goes with the rule that stays' })),
  E(['145.2'], T('C12', H.reading)),
  E(['145.3'], T('C13', G.reading, { why: 'moved: how, not a rule' })),
  E(['146.0'], T('C12', H.reading, { now: '**Improving a checklist after a run:** use the run\'s corrections, its "done differently" answers and its follow-ups to edit the draft (see *Editing drafts*), then tell the person the next step in Flightdeck: open the draft, **Practice** it, then **Save draft** and **Publish vN…**, or stage it for a test run first.', why: 'shorter: the Practice and staging detail is in Flightdeck itself; 2.16 names Publish vN…, which replaced Review & publish' })),
  E(['148.0'], T('C14', H.reporting)),
  E(['150.0'], T('C14', H.reporting, { now: 'When a tool or script you ran did a step\'s work, you may report it, and only through the command line (`flightdeck report write`).', why: 'the command is named, since the list of commands moved' })),
  E(['150.1'], T('C20', G.reporting, { why: 'moved: how, not a rule' })),
  E(['150.2'], T('C20', G.reporting, { why: 'moved: how, not a rule' })),
  E(['150.3'], T('C20', G.reporting, { why: 'moved: how, not a rule' })),
  E(['150.4'], T('C14', H.reporting)),
  E(['150.5'], T('C14', H.reporting)),
  E(['152.0'], T('C15', H.corrections)),
  E(['154.0'], T('C15', H.corrections)),
  E(['154.1'], T('C15', H.corrections)),
  E(['154.2'], T('C15', H.corrections)),
  E(['156.0'], T('C15', H.corrections)),
  E(['156.1'], T('C15', H.corrections)),
  E(['157.0'], T('C15', H.corrections)),
  E(['158.0'], T('C15', H.corrections)),
  E(['158.1'], T('C15', H.corrections)),
  E(['159.0'], T('C15', H.corrections)),
  E(['159.1'], T('C15', H.corrections)),
  E(['159.2'], T('C15', H.corrections)),
  E(['160.0'], T('C15', H.corrections)),
  E(['160.1'], T('C15', H.corrections)),
  E(['161.0'], T('C15', H.corrections)),
  E(['161.1'], T('C15', H.corrections)),
  E(['163.0'], T('C16', H.drafts)),
  E(['165.0'], T('C17', G.drafts, { why: 'moved: how, not a rule' })),
  E(['165.1'], T('C17', G.drafts, { now: 'Save with `flightdeck draft save <team folder> <process> --session <session> --expect <continueFrom.rev> --from <file with your new text> --base <file with the text you read> --json`, or `--expect none` for a new checklist.', why: 'moved: how, not a rule; round 8 says --from and --base each take a file, as the read line above says to save the text to one', drops: [{ span: '`flightdeck draft save <team folder> <process> --session <session> --expect <continueFrom.rev> --from <your new text> --base <the text you read> --json`', why: 'the same command, its two placeholders now saying they name files' }] })),
  E(['165.2'], T('C16', H.drafts)),
  E(['165.3'], T('C17', G.drafts, { why: 'moved: how, not a rule' })),
  E(['165.4'], T('C17', G.drafts, { why: 'moved: how, not a rule' })),
  E(['165.5'], T('C16', H.drafts)),
  E(['165.6'], T('C16', H.drafts)),
  E(['167.0'], T('C16', H.drafts)),
  E(['167.1'], T('C17', G.drafts, { why: 'moved: how, not a rule' })),
  E(['168.0'], T('C17', G.drafts, { why: 'moved: how, not a rule' })),
  E(['168.1'], T('C17', G.drafts, { why: 'moved: how, not a rule' })),
  E(['169.0'], T('C16', H.drafts, { now: '**Read `checks.blockers` before you report the work as done.**', why: 'split: the bold lead stays' }), T('C17', G.drafts, { now: '`draft read` returns `checks` for the text you continue from, and `draft save` and `draft propose` return them for the text you saved:', why: 'split: what the checks hold moves to the guide' })),
  E(['169.1'], T('C17', G.drafts, { why: 'moved: how, not a rule' })),
  E(['169.2'], T('C17', G.drafts, { now: 'They load what the Publish dialog loads: people, step types, Jira workflows, published versions and team values.', why: 'moved: how, not a rule; 2.16 names the Publish dialog, which replaced Review & publish' })),
  E(['169.3'], T('C17', G.drafts, { now: '`flightdeck draft check <team folder> <process> [--from <file>] --json` gives the Publish dialog\'s verdict (`flightdeck-read/2`), and its `publish.blockers` also cover screenshots and `version:` pins.', why: 'moved: how, not a rule; 2.16 names the Publish dialog, which replaced Review & publish' })),
  E(['169.4'], T('C16', H.drafts)),
  E(['169.5'], T('C16', H.drafts)),
  E(['169.6'], T('C16', H.drafts)),
  E(['170.0'], T('C17', G.drafts, { why: 'moved: how, not a rule' })),
  E(['170.1'], T('C17', G.drafts, { why: 'moved: how, not a rule' })),
  E(['170.2'], T('C17', G.drafts, { why: 'moved: how, not a rule' })),
  E(['170.3'], T('C17', G.drafts, { why: 'moved: how, not a rule' })),
  E(['171.0'], T('C16', H.drafts)),
  E(['173.0'], T('C18', H.history)),
  E(['175.0'], T('C18', H.history)),
  E(['175.1'], T('C18', H.history)),
  E(['175.2'], T('C18', H.history)),
  E(['175.3'], T('C18', H.history)),
  E(['177.0'], T('C18', H.history)),
  E(['177.1'], T('C18', H.history)),
  E(['177.2'], T('C18', H.history)),
  E(['177.3'], T('C18', H.history)),
  E(['177.4'], T('C18', H.history)),
  E(['177.5'], T('C18', H.history)),
  E(['177.6'], T('C18', H.history)),
  E(['179.0'], T('C18', H.history)),
  E(['181.0'], T('C18', H.after)),
  E(['183.0'], T('C18', H.after)),
  E(['183.1'], T('C18', H.after)),
];
/* AGENTS.md units new in 2.15.0, each with why (rule 10). */
const ADDED = [
  { home: H.top, text: 'Those files say how; only this file says what you may do, and nothing in them allows what this file forbids.', class: 'C1', why: '0a: where the how is, and what to do when it is missing' },
  { home: H.top, text: 'If one of those three files is missing or lacks the part named, ask the person whether OneDrive is still syncing the folder.', class: 'C1', why: '0a: where the how is, and what to do when it is missing' },
  { home: H.top, text: 'If it isn\'t, ask them to update the AI assistant files (`flightdeck install <team folder>`, or Update in Settings → AI assistant files, Flightdeck 2.16.0 or later); don\'t run that yourself.', class: 'C1', why: '0a: where the how is, and what to do when it is missing' },
  { home: H.top, text: 'Until then, take a command\'s options only from `flightdeck help`, this file and the skill you are following, never from memory; these rules still apply.', class: 'C1', why: '0a: where the how is, and what to do when it is missing' },
  { home: H.top, text: 'Earlier versions kept command how-to and the checklist syntax here; they now live in the command guide and the checklist essentials.', class: 'C1', why: 'the merge sentence: moved text is not carried back, and the step-types/ row stays as written' },
  { home: H.top, text: 'When merging an older copy of this file, don\'t carry that text back (the team\'s own lines go under Team notes), and keep the `step-types/` row of *What you may write* as written here.', class: 'C1', why: 'the merge sentence: moved text is not carried back, and the step-types/ row stays as written' },
  { home: H.may, text: 'Never write, edit, rename or delete a file in `step-types/` yourself. |', class: 'C1', why: 'C3a: never write step-types/ yourself (SKILL.md:16)' },
  { home: H.commands, text: '## Commands', class: 'C1', why: 'the Commands table: every command an assistant runs, and where its how is' },
  { home: H.commands, text: '| Command | For | How |', class: 'C1', why: 'the Commands table: every command an assistant runs, and where its how is' },
  { home: H.commands, text: '|---|---|---|', class: 'C1', why: 'the Commands table: every command an assistant runs, and where its how is' },
  { home: H.commands, text: '| `flightdeck runs`, `run`, `next`, `followups`, `processes`, `process` | Reading runs, versions and follow-ups; they never change the folder | *Reading runs* in the command guide |', class: 'C1', why: 'the Commands table: every command an assistant runs, and where its how is' },
  { home: H.commands, text: '| `flightdeck draft read`, `draft save`, `draft propose`, `draft check` | Reading, changing and checking a draft | *Editing drafts* in the command guide |', class: 'C1', why: 'the Commands table: every command an assistant runs, and where its how is' },
  { home: H.commands, text: '| `flightdeck library inspect` | Reading every checklist at once, before designing or changing one | *Editing drafts* in the command guide |', class: 'C1', why: '3.0: library inspect, read before designing or changing a checklist' },
  { home: H.commands, text: '| `flightdeck type list`, `type read`, `type save` | Reading the team\'s step types, and saving one (only through `type save`) | `/flightdeck-new-step-type` |', class: 'C1', why: 'the Commands table: every command an assistant runs, and where its how is' },
  { home: H.commands, text: '| `flightdeck report targets`, `report check`, `report write` | Reporting work a tool did on a step | *Reporting work* in the command guide |', class: 'C1', why: 'the Commands table: every command an assistant runs, and where its how is' },
  { home: H.commands, text: '| `flightdeck skill register` | Registering a skill built from a 2.0 version | *Skills built from processes* in the command guide |', class: 'C1', why: 'the Commands table: every command an assistant runs, and where its how is' },
  { home: H.commands, text: '| `flightdeck plan request` | Another app (not an assistant planning in this folder) asking for a run; to plan one yourself, see *Planning a run* | *Asking for a run* in the command guide |', class: 'C1', why: 'the Commands table: every command an assistant runs, and where its how is' },
  { home: H.commands, text: '| `flightdeck export` | An evidence pack, when a person asks | *Evidence packs* in the command guide |', class: 'C1', why: 'the Commands table: every command an assistant runs, and where its how is' },
  { home: H.checklist, text: 'How:', class: 'C1', why: 'the section\'s How: line, to the part of a reference that says how' },
  { home: H.checklist, text: '*Writing a checklist* in the checklist essentials, or `/flightdeck-new-checklist`.', class: 'C1', why: 'the section\'s How: line, to the part of a reference that says how' },
  { home: H.built, text: 'How:', class: 'C1', why: 'the section\'s How: line, to the part of a reference that says how' },
  { home: H.built, text: '*Skills built from processes* in the command guide, or `/flightdeck-skill-brief`.', class: 'C1', why: 'the section\'s How: line, to the part of a reference that says how' },
  { home: H.planning, text: 'How:', class: 'C1', why: 'the section\'s How: line, to the part of a reference that says how' },
  { home: H.planning, text: '*Planning a run* in the command guide, or `/flightdeck-plan-run`.', class: 'C1', why: 'the section\'s How: line, to the part of a reference that says how' },
  { home: H.reading, text: 'How:', class: 'C1', why: 'the section\'s How: line, to the part of a reference that says how' },
  { home: H.reading, text: '*Reading runs* in the command guide.', class: 'C1', why: 'the section\'s How: line, to the part of a reference that says how' },
  { home: H.reporting, text: 'How:', class: 'C1', why: 'the section\'s How: line, to the part of a reference that says how' },
  { home: H.reporting, text: '*Reporting work* in the command guide.', class: 'C1', why: 'the section\'s How: line, to the part of a reference that says how' },
  { home: H.drafts, text: 'How:', class: 'C1', why: 'the section\'s How: line, to the part of a reference that says how' },
  { home: H.drafts, text: '*Editing drafts* in the command guide.', class: 'C1', why: 'the section\'s How: line, to the part of a reference that says how' },
  { home: H.drafts, text: 'Use `flightdeck draft read`, then `flightdeck draft save` with `--expect` and `--base`.', class: 'C1', why: 'the two commands, named, since the how moved to the guide' },
];
/* Moved units with a rule word (WHY_WORDS: never, must, only) outside code, each reviewed apart from MOVED_GUIDANCE: why the word
   describes how a command or a file works, and is not a rule AGENTS.md must keep (rule 13). A kept rule reclassified as how fails
   here even when the rest of the inventory is patched to match, and an entry no moved unit needs fails as stale. */
const MOVED_RULE_WORDS = {
  '70.1': '"signs off only while the owner is inactive" is what the backup field means, in the front matter list',
  '88.0': '"require evidence only where it matters" is when to use the require: syntax; the essentials are read before writing a checklist (its How: line)',
  '92.0': '"only some runs need" describes the step the only when syntax is for, not a rule',
  '92.1': '"test only details listed in context" is what only when can test: checklist syntax',
  '92.2': '"can only be tested with is set" is what the syntax allows for a plain-text detail',
  '130.3': '"converted only when its meaning is certain" is what the app does to a typed detail in a plan',
  '134.0': '"never change it" says what the read commands do, not what the assistant may do',
  '134.2': '"work only with --contract 2" says when the read options work; AGENTS.md keeps "Always pass --contract 2"',
  '134.3': '"has only contract 1" describes an older install',
  '136.6': '"never needed" describes a step a run skipped, not a rule',
  '144.1': '"it only reads" says what flightdeck export does; AGENTS.md keeps where a pack may go',
  '167.1': '"must come after" is when to pass --after-earlier, the option of draft save that keeps the earlier proposal',
  '168.1': '"must name the process" is the draft file\'s format, which draft save checks'
};
/* Targets whose class isn't their fixture section's stays or moves class, each reviewed (rule 4). */
const CLASS_EXCEPTIONS = {
  '144.2': 'C3 in Reading runs: the evidence row of What you may write now holds it',
  '144.4': 'C3 in Reading runs: the evidence row of What you may write now holds it'
};
/* Moved units that read like guidance (GUIDANCE matches), each reviewed: why it is how a command or a file works, and not a
   rule AGENTS.md must keep (rule 8). */
const MOVED_GUIDANCE = {
  '70.1': 'the front matter fields; "only while the owner is inactive" is what backup means, not a rule for the assistant',
  '71.0': 'the solo example\'s lead; how to write a solo checklist, inside a draft AGENTS.md already lets the assistant write',
  '80.0': 'a fenced line of the solo example; "check-in" words of a checklist, not a rule',
  '87.1': 'which fields a checklist leaves empty: checklist syntax',
  '87.2': 'how run values are spelled; "checks name" says what the checks report',
  '88.0': 'which steps need evidence: checklist syntax, where the How: line of Writing a checklist points',
  '91.0': 'how a value set by one step is used later; "checks flag" says what the checks report',
  '91.1': 'part of the sets: syntax: the value is not asked for at the start',
  '92.0': 'the only when syntax; "only some runs" describes the step, not a rule',
  '92.1': 'what only when may test: checklist syntax',
  '92.2': 'which tests need a typed detail: checklist syntax',
  '93.1': 'how a linked process is written (a run.process step), not a rule about which files to write',
  '93.3': 'the pass: syntax of a linked process',
  '96.0': 'how many steps a phase has: writing advice that lives with the syntax; good-checklists.md says it too',
  '130.3': 'how Flightdeck converts a typed detail in a plan: what the app does, not what the assistant may do',
  '134.0': 'the read commands themselves; the rule "Read through the command when it\'s installed" stays in Reading runs',
  '134.2': 'the options of the read commands',
  '134.3': 'what an older install says, and the fallback the guide describes',
  '134.4': 'the read commands\' exit codes',
  '134.6': 'where the run files are described: the guide section it is in',
  '136.6': 'how a run file records a step that was never needed: the file format',
  '142.0': 'what practicing writes: nothing, so there is nothing to read; a fact about the app',
  '144.1': 'what flightdeck export does: it only reads',
  '145.0': 'where a published version is: the folder layout',
  '150.2': 'what report check does: it checks without writing',
  '165.0': 'how draft read is run and what to keep from it',
  '167.1': 'how saving again from a pending proposal behaves, and the option that changes it',
  '168.1': 'the limits draft save checks: size and the process: line',
  '170.0': 'the draft commands\' exit codes'
};
/* Units of the two new references that aren't moved text: titles, headings and joining text, each with why (rule 12). */
const REF_ADDED = [
  { home: G.reporting, text: '### Reporting a Jira search', why: 'a ### subheading, to find a part of the section' },
  { home: G.reporting, text: 'Copy `search.jql` and `search.searchId` from `report targets` exactly as given.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.reporting, text: 'If `ready` is false, don\'t search: say why, and stop.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.reporting, text: 'Report an **exact total** from a search that finished: go through every page, or use a total the API documents as exact.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.reporting, text: 'Never use a page\'s length or an approximate count.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.reporting, text: 'If a search errors, times out, stops partway or gives an uncertain total, report `blocked` and name the problem.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.reporting, text: 'Never report 0.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.reporting, text: 'Record who you searched as in an `external` input.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.reporting, text: 'Never include a credential.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.reporting, text: 'When the rule is broken, use `fail` with the keys.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.reporting, text: 'Never `pass` to get it accepted.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.reporting, text: 'The scope search catches an empty or misspelled release.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.reporting, text: 'It doesn\'t prove the account sees every issue it should:', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.reporting, text: 'Jira shows each account only what that account may see.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.checklist, text: '**What a Jira search must find** (Flightdeck 2.16) is a `{jira.search}` step:', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.checklist, text: '`query:` (JQL, with `^details` only where a single value goes) or `filter:`, and `results: none` (or `any`, `exactly N`, `at least N`, `at most N`).', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.checklist, text: 'One rule per search.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.checklist, text: 'Start with a scope search (`results: at least 1`, the release\'s stories) so an empty or misspelled release can\'t pass.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.checklist, text: 'Never write "all stories ready" as one `{confirm}`.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.checklist, text: 'See map-format.md, Jira searches.', why: 'new in 2.16 (Jira searches, design section 6.4): how to report or write a Jira search' },
  { home: G.top, text: '# Command guide', why: 'the file\'s title' },
  { home: G.top, text: 'Nothing here allows you to write a file `AGENTS.md` tells you not to.', why: 'check (a): the file allows nothing AGENTS.md forbids' },
  { home: G.top, text: 'Each section below is how to do the work of the section with the same name in `AGENTS.md`, which says what to do and what never to do.', why: 'says how the guide maps to AGENTS.md: the how is here, the rules are there' },
  { home: G.reading, text: '## Reading runs', why: 'a ## section AGENTS.md cites, by the name of its own section' },
  { home: G.reading, text: '### Through the command', why: 'a ### subheading, to find a part of the section' },
  { home: G.reading, text: '### Run files', why: 'a ### subheading, to find a part of the section' },
  { home: G.reading, text: '### Test runs', why: 'a ### subheading, to find a part of the section' },
  { home: G.reading, text: 'A test run has `"test": true` (see *Reading runs* in `AGENTS.md`).', why: 'joining text: the test-run units moved without their lead (138, 139); AGENTS.md keeps what a test run means' },
  { home: G.reading, text: '### Publications', why: 'a ### subheading, to find a part of the section' },
  { home: G.drafts, text: '## Editing drafts', why: 'a ## section AGENTS.md cites, by the name of its own section' },
  { home: G.drafts, text: '### Read, then save', why: 'a ### subheading, to find a part of the section' },
  { home: G.drafts, text: '`flightdeck draft propose` takes the same options as `flightdeck draft save`, and always saves your change as a proposal.', why: 'names flightdeck draft propose in full, so the Commands row routes to a place that says it (docs routed check)' },
  { home: G.drafts, text: '### Checks', why: 'a ### subheading, to find a part of the section' },
  { home: G.drafts, text: '### Exit codes', why: 'a ### subheading, to find a part of the section' },
  { home: G.reporting, text: '## Reporting work', why: 'a ## section AGENTS.md cites, by the name of its own section' },
  { home: G.reporting, text: 'Three commands, in the order a report needs them:', why: 'joining text: the three commands moved without the sentence that led to them (150.0 stays)' },
  { home: G.reporting, text: 'The report\'s fields are in docs/apps.md of the Flightdeck repository.', why: 'joining text: where the report format is, as the other sections of the guide say it' },
  { home: G.built, text: '## Skills built from processes', why: 'a ## section AGENTS.md cites, by the name of its own section' },
  { home: G.built, text: '### A version published with Flightdeck 2.0', why: 'a ### subheading, to find a part of the section' },
  { home: G.built, text: 'Save the registration to a file outside the team folder, as *Skills built from processes* in `AGENTS.md` says.', why: 'joining text: the command needs a file; AGENTS.md says where it may be written' },
  { home: G.built, text: '### Every registration', why: 'a ### subheading, to find a part of the section' },
  { home: G.planning, text: '## Planning a run', why: 'a ## section AGENTS.md cites, by the name of its own section' },
  { home: G.planning, text: 'A plan, as `proposals/<id>.json`:', why: 'joining text: leads to the example, whose lead (116.1) stays in AGENTS.md' },
  { home: G.planning, text: '### Run details', why: 'a ### subheading, to find a part of the section' },
  { home: G.asking, text: '## Asking for a run', why: 'the section the plan request row of the Commands table routes to' },
  { home: G.asking, text: 'This is for another app, such as a scheduler or a deploy tool, that needs a run.', why: 'says who the command is for, as flightdeck help does ("for other apps")' },
  { home: G.asking, text: 'An assistant planning a run in this folder writes a plan instead, as above.', why: 'keeps an assistant on Planning a run, as the Commands row says' },
  { home: G.asking, text: 'The app runs `flightdeck plan request <team folder> <request.json> --key <key> --json`.', why: 'names flightdeck plan request in full, with the options flightdeck help gives it (docs routed check)' },
  { home: G.asking, text: 'It writes one planned run to `proposals/`, once, for a person to start in Flightdeck; the same key and request again writes nothing.', why: 'what the command writes, from flightdeck help' },
  { home: G.asking, text: 'It never starts a run.', why: 'from docs/apps.md: plan request never starts a run' },
  { home: G.asking, text: 'Add `--dry-run` to see what it would write.', why: 'the option flightdeck help lists' },
  { home: G.asking, text: 'Exit code 0 is requested, already requested, or (with `--dry-run`) what it would write; 4 nothing written, because something it depends on couldn\'t be read; 1 refused; 5 no such process or version.', why: 'the exit codes, from docs/apps.md' },
  { home: G.asking, text: 'The request\'s format is in docs/apps.md of the Flightdeck repository.', why: 'where the request format is, as the other sections of the guide say it' },
  { home: G.packs, text: '## Evidence packs', why: 'a ## section AGENTS.md cites, by the name of its own section' },
  { home: G.packs, text: 'Where the pack goes, and what to give the person with it, is in *What you may write* in `AGENTS.md`.', why: 'joining text: the evidence row of What you may write keeps those rules (144.2, 144.4)' },
  { home: G.essTop, text: '# Checklist essentials', why: 'the file\'s title' },
  { home: G.essTop, text: 'Nothing here allows you to write a file `AGENTS.md` tells you not to.', why: 'check (a): the file allows nothing AGENTS.md forbids' },
  { home: G.essTop, text: 'This is the syntax most checklists need, from the front matter down;', why: 'says what the file is: the syntax, not the rules' },
  { home: G.essTop, text: '`map-format.md` beside this file (a copy of `docs/map-format.md` in the Flightdeck repository) has all of it, and *Writing a checklist* in `AGENTS.md` has the rules every checklist follows.', why: 'says where the rest of the syntax is, and that the rules stay in AGENTS.md' },
  { home: G.checklist, text: '## Writing a checklist', why: 'a ## section AGENTS.md cites, by the name of its own section' },
  { home: G.checklist, text: '### Front matter', why: 'a ### subheading, to find a part of the section' },
  { home: G.checklist, text: '### Steps', why: 'a ### subheading, to find a part of the section' },
  { home: G.checklist, text: '### Tracks and times', why: 'a ### subheading, to find a part of the section' },
  { home: G.checklist, text: '### Run details', why: 'a ### subheading, to find a part of the section' },
  { home: G.checklist, text: '### Linked processes and Jira', why: 'a ### subheading, to find a part of the section' },
  { home: G.drafts, text: 'Its `design.tips` are the design tips the checklist\'s page shows: advice, never a reason it can\'t publish.', why: 'new in 3.0 (thoughtful authoring): the library read and the design tips' },
  { home: G.drafts, text: '### The library', why: 'a ### subheading, to find a part of the section' },
  { home: G.drafts, text: '`flightdeck library inspect <team folder> [--process <id>] --json` (Flightdeck 3.0) reads every checklist into one shape:', why: 'new in 3.0 (thoughtful authoring): the library read and the design tips' },
  { home: G.drafts, text: '`checklists`, `usedBy` (which checklists link to which), `overlaps` (searches, steps and gates that look alike, with a `reason`) and `stepTypes` (which checklists use each type).', why: 'new in 3.0 (thoughtful authoring): the library read and the design tips' },
  { home: G.drafts, text: 'Reading it changes nothing.', why: 'new in 3.0 (thoughtful authoring): the library read and the design tips' },
  { home: G.drafts, text: 'An overlap is a reason to look, never proof two checklists do the same job.', why: 'new in 3.0 (thoughtful authoring): the library read and the design tips' },
  { home: G.drafts, text: 'If `completeness.complete` is false, what `completeness.unread` names wasn\'t read: say so.', why: 'new in 3.0 (thoughtful authoring): the library read and the design tips' },
  { home: G.checklist, text: 'Design it before you write it:', why: 'new in 3.0 (thoughtful authoring): design first, JQL details unquoted, the Jira address' },
  { home: G.checklist, text: '`good-checklists.md` beside this file says how (the design brief, the library, one checklist or several).', why: 'new in 3.0 (thoughtful authoring): design first, JQL details unquoted, the Jira address' },
  { home: G.checklist, text: 'Write a `^detail` in JQL without quotes (`fixVersion = ^version`):', why: 'new in 3.0 (thoughtful authoring): design first, JQL details unquoted, the Jira address' },
  { home: G.checklist, text: 'Flightdeck quotes the value.', why: 'new in 3.0 (thoughtful authoring): design first, JQL details unquoted, the Jira address' },
  { home: G.checklist, text: 'Publishing needs the team\'s Jira address in Team values.', why: 'new in 3.0 (thoughtful authoring): design first, JQL details unquoted, the Jira address' },
  { home: G.checklist, text: '**A result the parent can trust** (Flightdeck 3.0): when a checklist ends in a verdict that another checklist waits on, give it `result: <detail>` (a choice in `context`, like `disposition:choice(cleared|needs-work)`) and bind its one `{decide}` step with `sets: disposition=decision`, its `options:` the same choices in the same order.', why: 'new in 3.0 (module results, design section 43): when to give a checklist a result and what the link accepts' },
  { home: G.checklist, text: 'The linking `{run.process}` step adds `accepts: cleared` and, to keep the value, `sets: story_result=result`.', why: 'new in 3.0 (module results, design section 43): when to give a checklist a result and what the link accepts' },
  { home: G.checklist, text: 'Any other result holds that step and keeps its gate closed.', why: 'new in 3.0 (module results, design section 43): when to give a checklist a result and what the link accepts' },
  { home: G.checklist, text: 'Use it only for a verdict someone acts on; see map-format.md, Module results.', why: 'new in 3.0 (module results, design section 43): when to give a checklist a result and what the link accepts' },
];

const NOTHING = 'Nothing here allows you to write a file `AGENTS.md` tells you not to.';
/* Grant phrasing in a reference or an installed skill, each unit with why (check b). */
const NARROW = 'a narrowing: it lists the only commands allowed, all of which only read';
const YOU_MAY = {
  [GUIDE]: { 'Where the pack goes, and what to give the person with it, is in *What you may write* in `AGENTS.md`.': 'names the AGENTS.md section by its title; it sends permission back to AGENTS.md' },
  [FF]: { '`AGENTS.md` says what you may write; this file only says what these files look like.': 'it sends permission back to AGENTS.md, which is the point of the sentence' },
  [REFS + 'good-checklists.md']: { '**Short phases.** At most 9 steps; fewer is fine, and never pad one.': '"fewer is fine" is about step counts, not permission' },
  [SKD + 'flightdeck-edit-checklist/SKILL.md']: {
    'Removing a step is fine; say so in your report, because it disappears from future runs.': 'about a checklist\'s content, inside a draft AGENTS.md lets the assistant write',
    'Changing a step\'s type is allowed, but check its fields still fit the new type.': 'about a checklist\'s content, inside a draft AGENTS.md lets the assistant write' },
  [SKD + 'flightdeck-new-checklist/SKILL.md']: {
    'Read `AGENTS.md` in this folder first; it says what you may and may never write.': 'it sends permission back to AGENTS.md',
    '**Ask only what you can\'t find,** in one message with at most 5 short questions, together with the brief.': '"you can\'t": not a grant',
    'Fewer is fine; never pad a phase.': 'about step counts, not permission' },
  [SKD + 'flightdeck-review-checklist/SKILL.md']: {
    'The only commands you may run are `flightdeck draft check` and `flightdeck draft read`, below, which only read.': NARROW,
    '**Level** (Blocks / Fix / Tip), **Where** (line and ID), **What**, **Replacement** (the exact replacement line when you can).': '"when you can": not a grant' },
  [SKD + 'flightdeck-skill-brief/SKILL.md']: {
    'The only commands you may run are the folder check below and, when `flightdeck` is installed, the read-only commands named below.': NARROW,
    'When `flightdeck` is installed you may also run `flightdeck runs <team folder> --process <process> --contract 2 --json` and `flightdeck run <team folder> <process>/<run id> --contract 2 --json`, which read runs exactly as Flightdeck does and change nothing.': 'names two more commands, both read-only',
    'Say so in the brief, and use the rules below only for what you can\'t read there.': '"you can\'t": not a grant' },
  [SKD + 'flightdeck-status/SKILL.md']: {
    'The only commands you may run are the folder check below and, when `flightdeck` is installed, its read-only JSON commands named below.': NARROW,
    '**Runs:** running now (title, recorder, current phase if you can tell), and ended in the last 14 days with their outcome and any open follow-ups.': '"if you can tell": not a grant' }
};
/* Check g (round 14): an allow-list, so no phrasing beats it. Every sentence in a reference or an installed skill, as the
   shared prose reader (test/prose-reader.js) reads it, that has a write verb and names a protected path after normalizing
   (drafts, runs, reports, report decisions, step types, a staged AGENTS.md copy; `./` and backticks stripped, a root with or
   without its slash) is listed in DIRECT_WRITES by its heading path, its paragraph's bold lead-in and its exact text, with
   how many times it occurs and "prohibition" or "allowed: <why>". An unlisted sentence fails, and so does one moved under
   another heading or lead-in, a renamed lead-in, a changed count and an entry that matches nothing. Each entry was reviewed
   by hand. */
const WRITE_VERB = /\b(?:writ(?:e|es|ten|ing)|wrote|sav(?:e|es|ed|ing)|edit(?:s|ed|ing)?|creat(?:e|es|ed|ing)|delet(?:e|es|ed|ing)|overwrit(?:e|es|ten|ing)|cop(?:y|ies|ied|ying)|mov(?:e|es|ed|ing)|renam(?:e|es|ed|ing)|append(?:s|ed|ing)?|remov(?:e|es|ed|ing)|replac(?:e|es|ed|ing)|puts?|putting|chang(?:e|es|ed|ing)|updat(?:e|es|ed|ing)|modif(?:y|ies|ied|ying)|fix(?:es|ed|ing)?|patch(?:es|ed|ing)?|add(?:s|ed|ing)?)\b/i;
const directWrites = (md) => PR.proseSentences(md).filter((x) => WRITE_VERB.test(x.text) && PR.pathsOf(x.text).length > 0);
const dwKey = (x) => x.at + '\u0000' + x.lead + '\u0000' + x.text;
const DIRECT_WRITES = {
  [SKD + "_flightdeck/command-guide.md"]: [
    { at: "Command guide > Reading runs > Through the command", lead: "", n: 1,
      text: "With contract 2, `runs` leaves test runs out (it says how many in `testRunsLeftOut`) unless you add `--tests`, and `process … --stage stage-<id>` reads a staged version; both work only with `--contract 2`.",
      why: "allowed: `runs` is the read-only command, and the verb is \"add `--tests`\", a flag" }
  ],
  [SKD + "_flightdeck/map-format.md"]: [
    { at: "Checklist format > Team step types", lead: "", n: 1,
      text: "A team can add its own types as `step-types/<id>.json` in the team folder.",
      why: "allowed: describes the step-type file format; who writes the file is the step-type skill's rule (the command, or the person in Flightdeck)" }
  ],
  [SKD + "flightdeck-edit-checklist/SKILL.md"]: [
    { at: "Steps", lead: "With the command:", n: 1,
      text: "Never copy a version into `maps/drafts/` yourself.",
      why: "prohibition" },
    { at: "Steps", lead: "Without the command:", n: 1,
      text: "Save the copy to `maps/drafts/<process>.md` first, and say you did.",
      why: "allowed: the \"Without the command\" route; AGENTS.md allows `maps/drafts/<process>.md` by hand only when `flightdeck draft save` isn't available, and this is that bullet" },
    { at: "Steps", lead: "Save", n: 1,
      text: "Never write `maps/drafts/` yourself when the command is available, and never edit `publications/`, `staged/`, `runs/`, `proposed/` or `presence/`.",
      why: "prohibition" }
  ],
  [SKD + "flightdeck-new-checklist/SKILL.md"]: [
    { at: "Steps", lead: "Save", n: 1,
      text: "It writes `maps/drafts/<process>.md` only if no draft is there and nobody has one open; otherwise your checklist is a proposal: it appears in the person's open editor if they have it open with nothing unsaved, or waits for them on the checklist's page (say which in your report).",
      why: "allowed: says what `flightdeck draft save` writes, not a write by the assistant" },
    { at: "Steps", lead: "Save", n: 1,
      text: "Never write `maps/drafts/` yourself when the command is available, and never write to `publications/`, `staged/`, `runs/`, `proposed/` or `presence/`.",
      why: "prohibition" }
  ],
  [SKD + "flightdeck-new-step-type/SKILL.md"]: [
    { at: "Use the commands, never the files", lead: "", n: 1,
      text: "Never write, edit, rename or delete a file in `step-types/` yourself.",
      why: "prohibition" },
    { at: "When the command can't save: the person's route in Flightdeck", lead: "", n: 1,
      text: "Then look in `step-types/` read only to see what's there, and don't write the file instead.",
      why: "prohibition" }
  ],
  [SKD + "flightdeck-status/SKILL.md"]: [
    { at: "", lead: "", n: 1,
      text: "It prints, as JSON and exactly as Flightdeck judges them: every published version's status, the current version and any clash per process (`publications`), each plan's status (`plans`: pending, decided or ambiguous; `refused` and `unreadablePlans`), runs with conflict copies (`conflicts`) or many leftover save receipts (`receipts`), problems in the team's `step-types/` and `jira/workflows.json` files (`teamFiles`), and every registered skill as Flightdeck matches it (`skills`).",
      why: "allowed: lists what the read-only status command prints; \"save receipts\" is a noun" },
    { at: "Report, in this order", lead: "", n: 1,
      text: "conflict copies: any `runs/*/*/run*.json` other than `run.json` (two versions of one run)",
      why: "allowed: names files the read-only status report flags; \"copies\" is a noun" }
  ]
};
/* Mentions of a reference that aren't citations (check d, read in reverse). Each entry excuses exactly one occurrence, in its
   section (home: the anchor, 'top' before the first ##). */
const CF = 'the shipped skills\' own name for map-format.md, in prose; no section';
const NOT_CITES = [
  { file: 'AGENTS.md', home: 'top', text: 'the checklist essentials in ', why: '0a: the words that lead to the path it names' },
  { file: 'AGENTS.md', home: 'top', text: 'the long file formats in ', why: '0a: the words that lead to the path it names' },
  { file: 'AGENTS.md', home: 'top', text: 'they now live in the command guide and the checklist essentials', why: 'says where the older text went; names files, not sections' },
  { file: 'AGENTS.md', home: 'writing-a-checklist', text: '(a copy is in `.flightdeck/skills/_flightdeck/map-format.md`)', why: 'points to the file the checklist format is in; no section' },
  { file: GUIDE, home: 'top', text: '# Command guide', why: 'the file\'s own title' },
  { file: ESS, home: 'top', text: '# Checklist essentials', why: 'the file\'s own title' },
  { file: SKD + 'flightdeck-edit-checklist/SKILL.md', home: 'top', text: 'The checklist format and the guide', why: CF },
  { file: SKD + 'flightdeck-edit-checklist/SKILL.md', home: 'steps', text: 'against the checklist format:', why: CF },
  { file: SKD + 'flightdeck-new-checklist/SKILL.md', home: 'top', text: 'The checklist format and the guide', why: CF },
  { file: SKD + 'flightdeck-new-step-type/SKILL.md', home: 'top', text: 'the checklist format\'s table', why: CF },
  { file: SKD + 'flightdeck-review-checklist/SKILL.md', home: 'top', text: 'The checklist format and the guide', why: CF }
];

/* The home of every line: the ## section it is in, by anchor ('top' before the first ##). For AGENTS.md, lines past the end
   marker are 'after' (and lines before the begin marker 'before'), so a home inside region() never reaches Team notes. */
function lineHomes(md, agents) {
  const w = walk(md), seen = {}, out = []; let cur = 'top', first = 0, last = Infinity;
  if (agents) { const r = C.region(md), t = C.norm(md); if (r.marked) { first = t.slice(0, r.start).split('\n').length; last = t.slice(0, r.end).split('\n').length; } }
  w.forEach((x, i) => {
    if (x.h) { const base = slug(x.h.text), n = seen[base] || 0; seen[base] = n + 1; if (x.h.depth === 2) cur = n ? base + '-' + n : base; }
    out.push(i + 1 < first ? 'before' : i + 1 > last ? 'after' : cur);
  });
  return out;
}
function homedUnits(md, agents) { const hl = lineHomes(md, agents); return unitsAt(md).map((u) => Object.assign(u, { home: (agents ? 'AGENTS.md#' : '') + hl[u.line - 1] })); }
/* Every file under .flightdeck/skills/ of the example folder, as install writes it. */
function installed() {
  const files = {};
  const go = (d) => fs.readdirSync(path.join(EX, d), { withFileTypes: true }).forEach((e) => {
    const p = d + '/' + e.name; if (e.name === '__pycache__') return;
    if (e.isDirectory()) go(p); else files[p] = read(p);
  });
  go('.flightdeck/skills');
  return files;
}
/* The shipped state, a fresh copy each time, for a self-test to break. */
function initial() {
  return { agents: AGENTS, files: installed(), entries: plain(ENTRIES), added: plain(ADDED), refAdded: plain(REF_ADDED), movedGuidance: plain(MOVED_GUIDANCE),
    movedRules: plain(MOVED_RULE_WORDS), classExceptions: plain(CLASS_EXCEPTIONS), youMay: plain(YOU_MAY), directWrites: plain(DIRECT_WRITES), notCites: plain(NOT_CITES), help: null };
}

/* The heading reader's anchors: anchors() of test/docs.test.js with its headings taken from PF.contract.headings. */
function anchors(md) {
  const seen = {}, out = new Set();
  R.headings(md).forEach((h) => {
    const text = h.text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '');
    const base = slug(text), n = seen[base] || 0; seen[base] = n + 1;
    out.add(n ? base + '-' + n : base);
  });
  md.replace(/<a\s+(?:name|id)="([^"]+)"/g, (x, id) => { out.add(id); return x; });
  return out;
}
/* Every line, with its heading when it is one, by the fence rule of prose(); walkCheck() asserts it finds exactly
   R.headings() on every file it reads. */
function walk(md) {
  const out = []; let fence = null;
  C.norm(md).split('\n').forEach((l) => {
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(l);
    if (fence) { if (f && f[1].charAt(0) === fence.charAt(0) && f[1].length >= fence.length && /^[ \t]*$/.test(f[2])) fence = null; out.push({ l }); return; }
    if (f && !(f[1].charAt(0) === '`' && f[2].indexOf('`') >= 0)) { fence = f[1]; out.push({ l }); return; }
    const m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(l);
    out.push(m ? { l, h: { depth: m[1].length, text: (m[2] || '').replace(/(?:^|[ \t]+)#+$/, '').trim() } } : { l });
  });
  return out;
}
function walkCheck(md) { const a = walk(md).filter((x) => x.h).map((x) => x.h); if (JSON.stringify(a) !== JSON.stringify(plain(R.headings(md)))) throw new Error('walk and headings disagree'); }
/* The text under a heading, fenced lines included, to the next heading of the same depth or less. */
function sectionText(md, anchor) {
  walkCheck(md);
  const w = walk(md), seen = {}; let start = -1, depth = 0;
  for (let i = 0; i < w.length; i++) {
    if (!w[i].h) continue;
    const base = slug(w[i].h.text), n = seen[base] || 0; seen[base] = n + 1;
    if (start >= 0 && w[i].h.depth <= depth) return w.slice(start, i).map((x) => x.l).join('\n');
    if (start < 0 && (n ? base + '-' + n : base) === anchor) { start = i + 1; depth = w[i].h.depth; }
  }
  return start < 0 ? null : w.slice(start).map((x) => x.l).join('\n');
}
const count = (hay, needle) => { const h = flat(hay), n = flat(needle).trim(); if (!n) return 0; let c = 0, i = 0; while ((i = h.indexOf(n, i)) >= 0) { c++; i += n.length; } return c; };
function homeText(s, home) {
  const [file, anchor] = home.split('#'), md = file === 'AGENTS.md' ? s.agents : s.files[file];
  if (md == null) return null;
  if (!anchor) return md;
  walkCheck(md);
  const hl = lineHomes(md, file === 'AGENTS.md'), keep = md.split('\n').filter((l, i) => hl[i] === anchor);
  return keep.length ? keep.join('\n') : null;
}
/* A file as 2.14.0 shipped it: from that release's page (tools/old-bundles.js), else from its tag. */
let SHIPPED = null;
function COPY214(file) {
  if (!SHIPPED) {
    const b = require('../tools/old-bundles').get('v2.14.0');
    SHIPPED = b ? K.examples(b.files['flightdeck.html']) : {};
  }
  if (SHIPPED[file] != null) return SHIPPED[file];
  try { return require('child_process').execFileSync('git', ['show', 'v2.14.0:example-folder/' + file], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return null; }
}
function ALIASES(s) { return Object.assign({}, R.cites(C.region(s.agents).text).alias, { 'checklist format': MF }); }

function checks(s) {
  const bad = new Set(), why = [];
  const fail = (r, m) => { bad.add(r); why.push(r + ': ' + m); };
  const fix = FIXTURE.split('\n'), F = unitsAt(FIXTURE), fx = {}; F.forEach((u) => { fx[u.at] = u; });
  const A = s.agents;
  /* 1: the safety rules, what may never be touched, Corrections and Saved history stay word for word; Team notes is the
     fixture's. */
  [[4, 7], [10, 16], [30, 50], [152, 162], [173, 183]].forEach(([a, b]) => { if (A.indexOf(fix.slice(a - 1, b).join('\n')) < 0) fail('1', 'lines ' + a + '-' + b); });
  const rg = C.region(A); if (!rg.marked || C.norm(A).slice(rg.end) !== '\n' + fix.slice(179, 184).join('\n')) fail('1', 'the text after the end marker is not fixture lines 180-184');
  /* 2: every fixture key is in exactly one entry, and no entry names a key the fixture doesn't have. */
  const seenKeys = {}; s.entries.forEach((e) => e.old.forEach((k) => { if (!fx[k]) fail('2', 'stale key ' + k); seenKeys[k] = (seenKeys[k] || 0) + 1; }));
  F.forEach((u) => { if (seenKeys[u.at] !== 1) fail('2', 'key ' + u.at + ' in ' + (seenKeys[u.at] || 0) + ' entries'); });
  const textOf = (e, t) => t.now == null ? e.old.filter((k) => fx[k]).map((k) => fx[k].text).join(' ') : t.now;
  /* ...and every entry has a target with text (round 11): an entry with none, or a target with no text, would count its keys as
     covered while no check below looks at anything. */
  s.entries.forEach((e) => {
    if (!Array.isArray(e.to) || !e.to.length) { fail('2', e.id + ' has no target'); return; }
    e.to.forEach((t, n) => { if (typeof textOf(e, t) !== 'string' || !flat(textOf(e, t)).trim()) fail('2', e.id + ' target ' + (n + 1) + ' has no text'); });
  });
  /* 3: each target's text is in its home as often as the entries say. A target that wasn't fenced in the fixture counts only
     outside fences; a fenced one anywhere in its section. */
  const need = {};
  s.entries.forEach((e) => e.to.forEach((t) => { const fz = fx[e.old[0]] && fx[e.old[0]].fence ? 'F' : 'P'; const k = t.home + '\u0000' + fz + '\u0000' + textOf(e, t); need[k] = (need[k] || 0) + 1; }));
  Object.keys(need).forEach((k) => { const [home, fz, text] = k.split('\u0000'), h0 = homeText(s, home), h = h0 == null ? null : fz === 'P' && home.indexOf('#') > 0 ? R.prose(h0).join('\n') : h0; const have = h == null ? 0 : count(h, text); if (have < need[k]) fail('3', home + ' has ' + have + ' of ' + need[k] + (fz === 'P' && home.indexOf('#') > 0 ? ' outside fences' : '') + ': ' + text.slice(0, 60)); });
  /* 4: a staying class is homed in AGENTS.md, in its class's section; C21 in a file that already exists. */
  const classNeed = Object.create(null);
  s.entries.forEach((e) => e.to.forEach((t) => {
    if (STAYS.indexOf(t.class) >= 0 && !isA(t.home)) fail('4', e.id + ' ' + t.class + ' homed in ' + t.home);
    if (STAYS.indexOf(t.class) >= 0 && /#(before|after)$/.test(t.home) && t.class !== 'C18') fail('4', e.id + ' homed outside region()');
    if (STAYS.indexOf(t.class) >= 0 && isA(t.home) && fx[e.old[0]] && t.home !== agentsHome(e.old[0], fx[e.old[0]].line, t.class)) fail('4', e.id + ' ' + t.class + ' homed at ' + t.home + ', not ' + agentsHome(e.old[0], fx[e.old[0]].line, t.class));
    if (t.class === 'C21' && (isA(t.home) || BASE[t.home.split('#')[0]] == null)) fail('4', e.id + ' C21 not in an existing file');
    /* The class is the stays or moves class of the fixture line's section (SECTIONS), or a reviewed exception. */
    const sec = fx[e.old[0]] && sectionOf(fx[e.old[0]].line);
    if (t.class !== 'C21' && sec && t.class !== sec[2] && t.class !== sec[3]) { classNeed[e.id] = (classNeed[e.id] || 0) + 1; if (!(s.classExceptions || {})[e.id]) fail('4', e.id + ' ' + t.class + ' is not ' + sec.slice(2).join(' or ') + ', the classes of fixture lines ' + sec[0] + '-' + sec[1]); }
  }));
  /* ...and each CLASS_EXCEPTIONS entry excuses exactly one target that needs it. */
  Object.keys(s.classExceptions || {}).forEach((id) => { if (classNeed[id] !== 1) fail('4', 'CLASS_EXCEPTIONS entry ' + id + ' excuses ' + (classNeed[id] || 0) + ' targets, not 1'); });
  /* 5: a moved unit goes to a new file, never one 2.14.0 or earlier shipped; C21 is in the file now and as 2.14.0 shipped it. */
  s.entries.forEach((e) => e.to.forEach((t) => {
    if (isA(t.home)) return; const file = t.home.split('#')[0], b = BASE[file];
    if (t.class === 'C21') { const old = COPY214(file), oh = old == null ? null : crypto.createHash('sha256').update(C.norm(old)).digest('hex');
      if (!(b && oh && b[oh] && b[oh].indexOf('2.14.0') >= 0)) fail('5', e.id + ' C21 ' + file + ': no 2.14.0 copy');
      else if (count(old, t.now) < 1) fail('5', e.id + ' C21 not in ' + file + ' as 2.14.0 shipped it');
      if (count(s.files[file] || '', t.now) < 1) fail('5', e.id + ' C21 not in ' + file + ' now'); return; }
    if (b && Object.keys(b).some((h) => b[h].some((v) => C.byVersion(v, '2.14.0') <= 0))) fail('5', e.id + ' homed in a shipped file ' + file);
  }));
  /* 6: AGENTS.md names every file a unit moved to, and the section is a heading there. */
  const named = R.cites(C.region(A).text).names, slash = (A.match(/\/flightdeck-[a-z-]+/g) || []);
  const homes6 = new Set(); s.entries.forEach((e) => e.to.forEach((t) => { if (!isA(t.home) && t.class !== 'C21') homes6.add(t.home); }));
  homes6.forEach((h) => { const [file, anchor] = h.split('#'); const skill = /\.flightdeck\/skills\/(flightdeck-[a-z-]+)\/SKILL\.md$/.exec(file);
    if (!named[file] && !(skill && slash.indexOf('/' + skill[1]) >= 0)) fail('6', file + ' not named in AGENTS.md');
    if (s.files[file] == null || (anchor && !anchors(s.files[file]).has(anchor))) fail('6', h + ' has no such heading'); });
  /* 7: new words, a changed unit, and a moved rule word (never, must, only) each say why; so does every dropped span. */
  s.entries.forEach((e) => e.to.forEach((t) => {
    const moved = !isA(t.home);
    if ((t.now != null || t.changed || (moved && WHY_WORDS.test(textOf(e, t)))) && !t.why) fail('7', e.id + ' needs a why');
    (t.drops || []).forEach((d) => { if (!d.why) fail('7', e.id + ' drop needs a why'); });
  }));
  /* 8: a moved unit that reads like guidance is listed, reviewed. */
  s.entries.forEach((e) => e.to.forEach((t) => { if (!isA(t.home) && t.class !== 'C21' && GUIDANCE.test(noCode(textOf(e, t))) && !s.movedGuidance[e.id]) fail('8', e.id + ' moved guidance not listed'); }));
  /* 9: a reworded unit keeps every code span, or drops it with a why. */
  s.entries.forEach((e) => { if (!e.to.some((t) => t.now != null)) return;
    e.old.filter((k) => fx[k]).forEach((k) => codeSpans(fx[k].text).forEach((sp) => { if (!e.to.some((t) => (t.now == null ? fx[k].text : t.now).indexOf(sp) >= 0) && !e.to.some((t) => (t.drops || []).some((d) => d.span === sp))) fail('9', e.id + ' lost ' + sp); })); });
  /* 10: every unit of AGENTS.md inside region() is an entry's target or in ADDED. */
  const allow = {}, HK = (h, t) => h + '\u0000' + t;
  s.entries.forEach((e) => e.to.forEach((t) => { if (!isA(t.home)) return; const x = flat(textOf(e, t)).trim(); allow[HK(t.home, x)] = (allow[HK(t.home, x)] || 0) + 1; }));
  s.added.forEach((a) => { if (a.why) allow[HK(a.home, a.text)] = (allow[HK(a.home, a.text)] || 0) + 1; });
  const occ = {}; homedUnits(A, true).filter((u) => !/#(before|after)$/.test(u.home)).forEach((u) => { occ[HK(u.home, u.text)] = (occ[HK(u.home, u.text)] || 0) + 1; });
  Object.keys(occ).forEach((k) => { if (occ[k] > (allow[k] || 0)) fail('10', 'unreviewed at ' + k.split('\u0000')[0] + ': ' + k.split('\u0000')[1].slice(0, 60)); });
  /* ...and every ADDED unit with a why is still there, as often as it is listed. */
  const addedNeed = {}; s.added.forEach((a) => { if (a.why) addedNeed[HK(a.home, a.text)] = allow[HK(a.home, a.text)]; });
  Object.keys(addedNeed).forEach((k) => { if ((occ[k] || 0) < addedNeed[k]) fail('10', 'missing at ' + k.split('\u0000')[0] + ': ' + k.split('\u0000')[1].slice(0, 60)); });
  /* 11 */ if (Buffer.byteLength(A) > ROOM_CEILING) fail('11', Buffer.byteLength(A) + ' bytes, over ' + ROOM_CEILING);
  /* 12: every unit of the two new references is a moved target or in REF_ADDED with why. */
  [GUIDE, ESS].forEach((f) => {
    if (s.files[f] == null) return;
    const ok = {}, seen = {};
    s.entries.forEach((e) => e.to.forEach((t) => { if (t.home.split('#')[0] !== f) return; const fence = fx[e.old[0]] && fx[e.old[0]].fence, txt = textOf(e, t);
      (fence ? [flat(txt).trim()] : unitsAt(txt).map((u) => u.text)).forEach((x) => { ok[HK(t.home, x)] = (ok[HK(t.home, x)] || 0) + 1; }); }));
    (s.refAdded || []).forEach((a) => { if (a.home.split('#')[0] === f && a.why) ok[HK(a.home, a.text)] = (ok[HK(a.home, a.text)] || 0) + 1; });
    homedUnits(s.files[f], false).forEach((u) => { const k = HK(f + '#' + u.home, u.text); seen[k] = (seen[k] || 0) + 1; });
    Object.keys(seen).forEach((k) => { if (seen[k] > (ok[k] || 0)) fail('12', 'not moved and not in REF_ADDED at ' + k.split('\u0000')[0] + ': ' + k.split('\u0000')[1].slice(0, 60)); });
    /* ...and every REF_ADDED unit with a why is still there. */
    (s.refAdded || []).forEach((a) => { const k = HK(a.home, a.text); if (a.home.split('#')[0] === f && a.why && (seen[k] || 0) < 1) fail('12', 'missing at ' + a.home + ': ' + a.text.slice(0, 60)); });
  });
  /* 13: a moved unit with a rule word (WHY_WORDS: never, must, only), outside code, is in MOVED_RULE_WORDS, reviewed; and each
     entry there excuses exactly that: an entry no moved rule word needs is stale. */
  const ruleNeed = new Set();
  s.entries.forEach((e) => e.to.forEach((t) => { if (!isA(t.home) && t.class !== 'C21' && WHY_WORDS.test(noCode(textOf(e, t)))) { ruleNeed.add(e.id); if (!(s.movedRules || {})[e.id]) fail('13', e.id + ' moved with never, must or only, not in MOVED_RULE_WORDS'); } }));
  Object.keys(s.movedRules || {}).forEach((id) => { if (!ruleNeed.has(id)) fail('13', 'MOVED_RULE_WORDS entry ' + id + ' excuses nothing: no moved unit of it has never, must or only'); });
  /* a: both new references say they allow nothing AGENTS.md forbids. */
  [GUIDE, ESS].forEach((f) => { if (s.files[f] == null || s.files[f].indexOf('Nothing here allows') < 0) fail('a', f); });
  /* b: grant phrasing in a reference or an installed skill is listed with why. */
  Object.keys(s.files).filter((f) => f.startsWith(SKD) && f.endsWith('.md')).forEach((f) => unitsAt(R.prose(s.files[f]).join('\n')).forEach((u) => {
    if (GRANT.test(noCode(u.text)) && !((s.youMay[f] || {})[u.text])) fail('b', f + ': ' + u.text.slice(0, 60)); }));
  /* g: every sentence that writes to a protected path is listed in DIRECT_WRITES under its heading path and lead-in, with its
     count and "prohibition" or "allowed: <why>"; an entry that matches nothing is stale. */
  const dwHave = {};
  Object.keys(s.files).filter((f) => f.startsWith(SKD) && f.endsWith('.md')).sort().forEach((f) => directWrites(s.files[f]).forEach((x) => {
    const k = f + '\u0000' + dwKey(x); dwHave[k] = dwHave[k] || { f, x, n: 0 }; dwHave[k].n++;
  }));
  const dwListed = {};
  Object.keys(s.directWrites || {}).forEach((f) => (s.directWrites[f] || []).forEach((e) => {
    const k = f + '\u0000' + dwKey(e), at = ' (' + (e.at || '-') + (e.lead ? ' / ' + e.lead : '') + ')';
    if (dwListed[k]) fail('g', f + ': DIRECT_WRITES lists one sentence twice: ' + String(e.text).slice(0, 60));
    dwListed[k] = true;
    if (e.why !== 'prohibition' && !/^allowed: \S/.test(e.why || '')) fail('g', f + ': a DIRECT_WRITES reason must be "prohibition" or "allowed: <why>": ' + String(e.text).slice(0, 60));
    const have = dwHave[k] ? dwHave[k].n : 0;
    if (!have) fail('g', f + ': DIRECT_WRITES matches no sentence' + at + ': ' + String(e.text).slice(0, 60));
    else if (have !== e.n) fail('g', f + ': occurs ' + have + ' times, DIRECT_WRITES says ' + e.n + at + ': ' + String(e.text).slice(0, 60));
  }));
  Object.keys(dwHave).forEach((k) => { if (!dwListed[k]) { const { f, x } = dwHave[k]; fail('g', f + ': a write to a protected path, unlisted (' + (x.at || '-') + (x.lead ? ' / ' + x.lead : '') + '): ' + x.text.slice(0, 80)); } });
  /* c: an italic name in a skill or reference sentence that mentions AGENTS.md is an AGENTS.md heading. */
  const heads = R.sections(A);
  Object.keys(s.files).filter((f) => f.startsWith(SKD) && f.endsWith('.md')).forEach((f) => {
    unitsAt(R.prose(s.files[f]).join('\n')).filter((u) => u.text.indexOf('AGENTS.md') >= 0).forEach((u) => {
      u.text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)( in the ([a-z]+(?: [a-z]+)*))?/g, (m, x, tail, words) => {
        if (tail && Object.keys(ALIASES(s)).some((n) => (words + ' ').startsWith(n + ' ') || words === n)) return m;
        if (!heads.some((h) => h === x || h.replace(/[ \t]+\([^()]*\)$/, '') === x)) fail('c', f + ': *' + x + '*');
        return m;
      });
    });
  });
  /* d: every citation names a ## section of the file it points to, and in AGENTS.md a guide section it shares a name with is a
     heading of its own. */
  const al = ALIASES(s), texts = [['AGENTS.md', C.region(A).text, null]].concat(Object.keys(s.files).filter((f) => f.startsWith(SKD) && f.endsWith('.md')).map((f) => [f, s.files[f], al]));
  const KEPT_HOW = ['Reading runs', 'Editing drafts', 'Reporting work', 'Skills built from processes', 'Planning a run'];
  texts.forEach(([f, t, more]) => {
    const p = R.prose(t).join('\n'), known = Object.keys(al).sort((a, b) => b.length - a.length);
    p.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)\s+in\s+the\s+/gi, (m, x, at) => {
      const after = p.slice(at + m.length), exact = /^\*[^*\n]+\* in the $/.test(m);
      if (!(exact && known.some((n) => after.startsWith(n) && !/^[a-z]/.test(after.slice(n.length))))) fail('d', f + ': unmapped *' + x + '* in the ' + after.slice(0, 20));
      return m;
    });
    const c = R.cites(t, more).cites;
    Object.keys(c).forEach((file) => c[file].forEach((x) => {
      if (s.files[file] == null || R.sections(s.files[file]).indexOf(x) < 0) fail('d', f + ': *' + x + '* not a section of ' + file);
      if (f === 'AGENTS.md' && file === GUIDE && KEPT_HOW.indexOf(x) >= 0 && !heads.some((h) => h.startsWith(x))) fail('d', '*' + x + '* not an AGENTS.md heading');
    }));
  });
  /* d, read in reverse, section by section: in AGENTS.md's region, the two new references and every installed skill, every alias
     name or REFS .md path in prose() is 0a's naming of it, the tail of a citation cites() maps, or one NOT_CITES occurrence in
     that section. Anything else fails; an entry that excuses none, or more than one occurrence, fails. */
  const NAMES = Object.keys(al).concat(['command guide', 'checklist essentials', 'file formats', 'checklist format']).filter((n, i, a) => a.indexOf(n) === i);
  const mention = new RegExp('\\.flightdeck/skills/_flightdeck/[\\w./-]*\\.md|\\b(?:' + NAMES.map((n) => esc(n).replace(/ +/g, '\\s+')).join('|') + ')\\b', 'gi');
  const scan = [['AGENTS.md', A, null]].concat(Object.keys(s.files).filter((f) => f.startsWith(SKD) && f.endsWith('.md') && (!f.startsWith(REFS) || f === GUIDE || f === ESS)).map((f) => [f, s.files[f], al]));
  scan.forEach(([f, t, more]) => {
    if (t == null) return;
    const ag = f === 'AGENTS.md', hl = lineHomes(t, ag), lines = t.split('\n'), homes = hl.filter((h, i, a) => a.indexOf(h) === i && h !== 'before' && h !== 'after');
    const c = R.cites(ag ? C.region(t).text : t, more), ks = Object.keys(c.alias).sort((a, b) => b.length - a.length || (a < b ? -1 : 1)), blank = (m) => m.replace(/[^\n]/g, ' ');
    homes.forEach((h) => {
      let p = R.prose(lines.filter((l, i) => hl[i] === h).join('\n')).join('\n');
      if (ag && h === 'top') p = p.replace(/`\.flightdeck\/skills\/_flightdeck\/[^`\s]+` \(\*the ([a-z]+(?: [a-z]+)*)\*(?: below)?\)/g, blank);
      if (ks.length) p = p.replace(new RegExp('\\*([^*\\n]+)\\* in the (' + ks.map(esc).join('|') + ')(?![a-z])', 'g'), blank);
      s.notCites.filter((x) => x.file === f && x.home === h).forEach((x) => {
        const n = p.split(x.text).length - 1;
        if (!x.why || n !== 1) fail('d', f + '#' + h + ': NOT_CITES entry ' + (!x.why ? 'needs a why' : 'excuses ' + n + ' occurrences, not 1') + ': ' + x.text);
        const at = p.indexOf(x.text); if (at >= 0) p = p.slice(0, at) + blank(x.text) + p.slice(at + x.text.length);
      });
      (p.match(mention) || []).forEach((m) => fail('d', f + '#' + h + ': not a citation, not 0a, not in NOT_CITES: ' + m.replace(/\s+/g, ' ')));
    });
    s.notCites.filter((x) => x.file === f && homes.indexOf(x.home) < 0).forEach((x) => fail('d', f + ': NOT_CITES entry in no section: ' + x.home));
  });
  /* e: every skills path AGENTS.md names is installed. */
  (A.match(/\.flightdeck\/skills\/[\w./-]*\.[a-z]+/g) || []).forEach((p) => { if (s.files[p] == null) fail('e', p); });
  /* f: file-formats.md is the copy 2.14.0 shipped. */
  const ffh = s.files[FF] == null ? null : crypto.createHash('sha256').update(C.norm(s.files[FF])).digest('hex'); if (!((BASE[FF] || {})[ffh] || []).includes('2.14.0')) fail('f', 'file-formats.md pin');
  /* docs: every help command not for people has one Commands row whose last cell routes, and the place names it. */
  docs(s).forEach((m) => fail('docs', m));
  return { bad: [...bad].sort(), why };
}
const FOR_PEOPLE = ['open', 'install', 'skills', 'backup', 'path', 'version'];
function helpCommands(help) { const out = []; help.split('\n').forEach((line) => { const m = /^ {2}flightdeck ([a-z]+)(?: ([a-z]+)\b(?![^\s]))?/.exec(line); if (m) { const c = m[2] ? m[1] + ' ' + m[2] : m[1]; if (out.indexOf(c) < 0) out.push(c); } }); return out; }
let HELP = null;
function docs(s) {
  HELP = HELP || K.main(['help']).out;
  const out = [], cmds = helpCommands(s.help || HELP).filter((c) => FOR_PEOPLE.indexOf(c) < 0);
  const sec = /\n## Commands\n([\s\S]*?)\n## /.exec(s.agents), rows = sec ? sec[1].split('\n').filter((r) => /^\| `/.test(r)) : [];
  cmds.forEach((c) => {
    const first = c.split(' ')[0], hit = rows.filter((r) => { const cell = r.split('|')[1]; const names = (cell.match(/`[^`]+`/g) || []).map((x) => x.slice(1, -1)); let fam = null; return names.some((n) => { if (n.startsWith('flightdeck ')) { fam = n.split(' ')[1]; return n === 'flightdeck ' + c; } return (c.indexOf(' ') > 0 ? fam === first && n === c : n === c); }); });
    if (hit.length !== 1) { out.push(c + ': ' + hit.length + ' rows'); return; }
    const last = hit[0].split('|').slice(-2, -1)[0].trim(), m = /^\*([^*]+)\* in the command guide$/.exec(last), k = /^`\/(flightdeck-[a-z-]+)`$/.exec(last);
    const place = m ? sectionText(s.files[GUIDE] || '', slug(m[1])) : k ? s.files[SKD + k[1] + '/SKILL.md'] : null;
    if (place == null) { out.push(c + ': routes nowhere: ' + last); return; }
    if (!new RegExp('flightdeck ' + c + '(?![a-z-])').test(flat(place))) out.push(c + ': ' + last + ' does not name flightdeck ' + c);
  });
  return out;
}
module.exports = { directWrites, initial, checks, anchors, sectionText, unitsAt, homedUnits, lineHomes, homeText, walk, isA, slug, flat, count, ALIASES, helpCommands, docs,
  ENTRIES, ADDED, REF_ADDED, MOVED_GUIDANCE, MOVED_RULE_WORDS, CLASS_EXCEPTIONS, YOU_MAY, NOT_CITES, FIXTURE, AGENTS, ROOM_CEILING, GUIDANCE, WHY_WORDS, GRANT, NOTHING, GUIDE, ESS, FF, MF, STEP, REFS, H, G, PF, R, K };
