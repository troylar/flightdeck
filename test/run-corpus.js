// The differential corpus of dependency runs (4.0, slice 6, LA): every run a living run's work depends on, in each of the three
// roles (a loop child, a run whose spread a request fulfills, a run a to-do was done on), filled out with every record a run
// file holds, then mutated one place at a time: every value takes a wrong type, an oversized or unknown value, an invalid
// time and deletion; every object and list gets an unknown entry or is replaced by another shape; and the records the app
// is allowed to drop (a pause left on an ended run, the who and when of an earlier "done differently") are added. Each case
// is judged by the export's verdict (readRunOnly, then repo.depVerdict, whose run part is PF.appjson.judgeRun) and by
// Python (test/check_pack.py --verdicts), and the two must give the same verdict and first path.
'use strict';
const { BytesFS } = require('./evidence-fixture');
const { roleWorlds } = require('./living-worlds');

const AT = '2026-11-10T09:00:00.000Z', AT2 = '2026-11-10T09:30:00.000Z', AT3 = '2026-11-10T10:00:00.000Z';
const P = 'person-avery';

/* The run filled out with every record a run file holds, each as the app writes it (so the app reads it back unchanged). */
function enrich(PF, raw) {
  const o = JSON.parse(JSON.stringify(raw)), r = PF.run.sanitize(JSON.parse(JSON.stringify(raw))), map = PF.run.mapOf(r);
  const steps = [], gates = [];
  map.phases.forEach((ph) => { if (ph.gate) gates.push(ph.gate.id); ph.steps.forEach((s) => steps.push(s.id)); });
  o.steps = {};
  steps.forEach((id, i) => {
    o.steps[id] = i === 0
      ? { s: 'done', by: P, at: AT2, started: { by: P, at: AT }, deadline: { at: AT3, by: P, set: AT }, differently: { note: 'Did it by hand', by: P, at: AT2 },
          values: { note: 'Checked by hand' }, history: [{ s: 'blocked', by: P, at: AT, reason: 'Waiting on review', differently: { note: 'Asked first' }, values: { note: 'First try' }, fields: { where: 'In the wiki' } }] }
      : i === steps.length - 1 ? { s: 'blocked', by: P, at: AT2, reason: 'Waiting on legal', child: { process: 'legal-review', id: 'lr-1', inputs: { issue: 'ABC-9' } } }
      : { s: 'blocked', by: P, at: AT2, reason: 'Waiting on legal' };
  });
  o.gates = {};
  gates.forEach((id) => { o.gates[id] = { s: 'passed', by: P, at: AT3, reason: 'Looked fine', was: 'failed', approved: { note: 'Approved as is' } }; });
  o.jira = { Story: { statuses: ['To Do', 'Done'], transitions: [{ from: '*', to: 'Done', fields: [{ name: 'Resolution', hint: 'Usually Done', source: '', options: ['Done', 'Won\'t Do'] }] }] } };
  o.recorder = { person: P, session: null, handoff: { from: P, rev: 2, at: AT } };
  o.followUps = [{ id: 'fu-1', text: 'Tell the team', owner: P, ticket: 'ABC-9', step: steps[0], from: 'run', by: P, at: AT2 }];
  o.pauses = [{ from: AT, to: AT2, by: P, reason: 'Lunch' }];
  o.roles = { reviewer: P };
  if (!o.details || !Object.keys(o.details).length) o.details = { notes: 'Release 4.1' };
  o.fields = {}; o.fields[steps[0]] = { where: 'In the repo' };
  o.marks = {}; o.marks[steps[steps.length - 1]] = ['recheck'];
  if (o.state === 'running' && !o.ended) o.paused = { by: P, at: AT3, reason: 'Waiting' };
  return o;
}

const ISO = /^\d{4}-\d{2}-\d{2}T/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/* Every place in a run, as [path segments, value]. */
function places(v, at, out) {
  out.push([at, v]);
  if (Array.isArray(v)) v.forEach((x, i) => places(x, at.concat([i]), out));
  else if (isObj(v)) Object.keys(v).forEach((k) => places(v[k], at.concat([k]), out));
  return out;
}
function setAt(o, at, f) {
  const c = JSON.parse(JSON.stringify(o));
  if (!at.length) return f(c);
  let p = c;
  for (let i = 0; i < at.length - 1; i++) p = p[at[i]];
  const k = at[at.length - 1];
  const v = f(p[k]);
  if (v === DELETE) { if (Array.isArray(p)) p.splice(k, 1); else delete p[k]; } else p[k] = v;
  return c;
}
const DELETE = { deleted: true };
/* The mutations of one value: [name, new value]. */
function mutationsOf(v, at) {
  const out = [];
  const leaf = !isObj(v) && !Array.isArray(v);
  if (at.length) out.push(['deleted', DELETE]);
  if (typeof v === 'string') {
    out.push(['a number', 42], ['unknown value', 'banana'], ['oversized', v + 'x'.repeat(10001)], ['empty', '']);
    if (ISO.test(v)) out.push(['not a time', 'bad'], ['an invalid calendar date', '2026-02-30T10:00:00.000Z'], ['an invalid month', '2026-13-01T10:00:00.000Z'],
      /* Times the engine reads but the app never wrote (NB): one form only, toISOString's, within the date range. */
      ['a bare number (not the written form)', '7'], ['a ticket key (not the written form)', 'ABC-101'], ['no milliseconds (not the written form)', v.replace(/\.\d{3}Z$/, 'Z')],
      ['an offset (not the written form)', v.replace(/Z$/, '+00:00')], ['a date only (not the written form)', v.slice(0, 10)], ['past the date range (not the written form)', '+275760-09-13T00:00:00.001Z']);
  } else if (typeof v === 'number') {
    out.push(['text', String(v)], ['negative', -1], ['a fraction', v + 0.5], ['huge', 1e15]);
  } else if (typeof v === 'boolean') {
    out.push(['text', String(v)], ['the other', !v]);
  } else if (v === null) {
    out.push(['a number', 42], ['text', 'banana'], ['an object', { zz: 1 }]);
  } else if (Array.isArray(v)) {
    out.push(['an object', { zz: 1 }], ['text', 'broken'], ['a null entry', v.concat([null])], ['a text entry', v.concat(['banana'])]);
  } else {
    out.push(['an unknown key', Object.assign({}, v, { zzUnknown: 1 })], ['text', 'broken'], ['a list', []]);
    if (at.length) out.push(['null', null]);
  }
  return leaf || at.length ? out : out.filter((m) => m[0] !== 'text' && m[0] !== 'a list');
}
/* Every case for one enriched run: { name, run } with a distinct file each. */
function casesOf(base) {
  const out = [], seen = new Set();
  /* text: the file's exact text, for what JSON.stringify can't write (a number too big to be finite). */
  const add = (name, run, text) => { const t = text || JSON.stringify(run); if (seen.has(t)) return; seen.add(t); out.push(text ? { name, run, text } : { name, run }); };
  add('as written', base);
  places(base, [], []).forEach(([at, v]) => mutationsOf(v, at).forEach(([what, nv]) => add((at.join('.') || '(the run)') + ': ' + what, setAt(base, at, () => nv))));
  /* The records the app is allowed to drop, and the fields it fills in when they're missing. */
  const ended = JSON.parse(JSON.stringify(base));
  ended.state = 'completed'; ended.ended = { outcome: 'Completed', by: P, byName: 'Avery', at: AT3 }; ended.paused = { by: P, at: AT2, reason: 'Waiting' };
  if (ended.living && Object.keys(ended.living).length === 1) { /* a living run that ended without a receipt reads as before */ }
  add('a pause left on an ended run (dropped)', ended);
  /* A completed run's searches are repaired differently (generations rebuilt, a stuck search): their places mutated there too. */
  if (base.searchGen) places(ended, [], []).filter(([at]) => /^(searchSites|searchGen|searchRec)$/.test(at[0]) || (at[0] === 'steps' && at[1] === 'scope')).forEach(([at, v]) => mutationsOf(v, at).forEach(([what, nv]) => add('(ended) ' + at.join('.') + ': ' + what, setAt(ended, at, () => nv))));
  /* The end itself, mutated as every other place is. */
  places(ended, [], []).filter(([at]) => at[0] === 'ended').forEach(([at, v]) => mutationsOf(v, at).forEach(([what, nv]) => add('(ended) ' + at.join('.') + ': ' + what, setAt(ended, at, () => nv))));
  const hist = JSON.parse(JSON.stringify(base)), first = Object.keys(hist.steps)[0];
  hist.steps[first].history[0].differently = { note: 'By hand', by: P, at: AT };
  add('an earlier answer\'s "done differently" with who and when (dropped)', hist);
  ['title', 'state', 'version', 'rev', 'shotsFrozen'].forEach((k) => { const c = JSON.parse(JSON.stringify(base)); delete c[k]; add(k + ': missing (filled in)', c); });
  reviewerCases(base, ended).forEach((c) => add(c[0], c[1], c[2]));
  return out;
}
/* PA: the reviewers' cases, kept. A value the cleaner keeps after a table lookup given as a list (JS would read ["running"]
   as "running"), JavaScript's white space against Python's (a snapshot or a follow-up of U+0085, U+001C or U+FEFF), a number
   too big to be finite, a team value the validator refuses (too long, empty, padded, a control character) or one only
   Python's trim would call padded, and a null where the cleaner writes text. */
const INF = '"\\u0000inf\\u0000"';
function reviewerCases(base, ended) {
  const out = [], copy = (o) => JSON.parse(JSON.stringify(o)), steps = Object.keys(base.steps), first = steps[0], gate = Object.keys(base.gates)[0];
  const put = (name, o, at, v) => out.push([name, setAt(o, at, () => v)]);
  const inf = (name, o, at) => { const c = setAt(o, at, () => JSON.parse(INF)); out.push([name, c, JSON.stringify(c, null, 2).split(INF).join('1e999')]); };
  put('(reviewer) state: a list', base, ['state'], ['running']);
  put('(reviewer) a step\'s s: a list', base, ['steps', first, 's'], [base.steps[first].s]);
  if (base.steps[first].history) put('(reviewer) an earlier answer\'s s: a list', base, ['steps', first, 'history', 0, 's'], [base.steps[first].history[0].s]);
  if (gate) { put('(reviewer) a gate\'s s: a list', base, ['gates', gate, 's'], [base.gates[gate].s]); put('(reviewer) a gate\'s was: a list', base, ['gates', gate, 'was'], ['failed']); put('(reviewer) a gate\'s was: a number', base, ['gates', gate, 'was'], 7); }
  put('(reviewer) the outcome: a list', ended, ['ended', 'outcome'], ['Completed']);
  ['\u0085', '\u001c', '\ufeff', '\u00a0'].forEach((w) => {
    const name = 'U+' + w.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
    put('(reviewer) snapshot: only ' + name, base, ['snapshot'], w);
    put('(reviewer) snapshot: a line of only ' + name, base, ['snapshot'], String(base.snapshot).replace('\n\n', '\n' + w + '\n'));
    if (base.followUps && base.followUps.length) { put('(reviewer) a follow-up: only ' + name, base, ['followUps', 0, 'text'], w); put('(reviewer) a follow-up: padded with ' + name, base, ['followUps', 0, 'text'], w + 'Tell the team' + w); }
  });
  inf('(reviewer) version: 1e999', base, ['version']);
  inf('(reviewer) rev: 1e999', base, ['rev']);
  if (base.steps.each && base.steps.each.loop) inf('(reviewer) a loop approval\'s count: 1e999', base, ['steps', 'each', 'loop', 'counts', 'cleared']);
  if (base.followUps && base.followUps.length) put('(reviewer) a follow-up\'s owner: null', base, ['followUps', 0, 'owner'], null);
  put('(reviewer) a step\'s by: null', base, ['steps', first, 'by'], null);
  /* A link's record of the team values its child was passed, on a run of a version that uses team values. */
  const link = steps.filter((k) => base.steps[k].child)[0];
  if (link) {
    const team = copy(base);
    /* In the order the app writes features (PF.envelope.FROZEN). */
    const ORDER = ['typed-details', 'typed-evidence', 'phase-notes', 'phase-shots', 'gate-shots', 'pinned-children', 'pinned-skills', 'staged', 'test-run', 'extensions', 'conditions', 'passed-details', 'team-values', 'jira-search', 'detail-patterns', 'module-results', 'loops', 'living-runs'];
    team.features = ORDER.filter((f) => f === 'team-values' || (Array.isArray(team.features) && team.features.indexOf(f) >= 0));
    [['valid', 'ABC-1'], ['over 120 characters', 'x'.repeat(121)], ['120 characters', 'x'.repeat(120)], ['empty', ''], ['padded', ' ABC-1 '], ['padded with U+FEFF', '\ufeffABC-1'],
      ['padded with U+0085 (not JavaScript white space)', '\u0085ABC-1'], ['a control character', 'ABC\u00011'], ['DEL', 'ABC\u007f1']].forEach(([what, text]) => {
      put('(reviewer) team value: ' + what, team, ['steps', link, 'child', 'teamPassed'], { issue: { text } });
    });
  }
  return out;
}
/* The export's verdict on one dependency run file: '' when it holds, else the first problem's path and kind. */
async function jsVerdict(PF, files, key) {
  const [proc, id] = key.split('/');
  const one = await PF.repo.readRunOnly(new BytesFS(files), proc, id);
  const v = PF.repo.depVerdict(proc, id, one);
  return v.bad ? { path: String(v.bad.path), kind: String(v.bad.kind), why: String(v.bad.why) } : null;
}
/* NA: a run whose checklist has every field family the run cleaner reads, so each is seeded with a valid value and mutated
   like every other place: typed details (choice, date, pattern) and a migration record about one, Jira searches (the
   containers, a done search with its results, one only when a detail matches), typed evidence (a number), a skill
   registration on a step and in its history, a loop approval on a step and in its history, and the to-dos an approval
   counted on a step and a gate (a living run). The readers' corpus only: it isn't a dependency of a living run here. */
const FULL_MD = ['---', 'process: kit', 'title: Kit', 'context: project, version, kind:choice(minor|major), due:date, tag:pattern(v\\d{1,3})', 'roles: lead', '---', '',
  '## Build · DO-CONFIRM {#build}',
  '- [ ] {confirm} Look first {#look}',
  '- [!] {jira.search} The release has stories @lead {#scope}', '  query: project = ^project AND fixVersion = ^version', '  results: at least 1',
  '- [ ] {jira.search} Majors only {#major}', '  query: project = ^project', '  results: any', '  only when ^kind is major',
  '- [ ] {confirm} Count the boxes {#count}', '  evidence: number',
  '- [ ] {run.skill} Write the notes {#notes}', '  skill: notes-bot',
  '- [ ] {for.each} Check each story {#each}', '  process: check-story', '  items: item', '  accepts: cleared',
  '- [ ] {confirm} Wrap up {#wrap}', '',
  '## Gate: Ready {#ready}', ''].join('\n');
async function fullWorld() {
  const PF = require('./harness').load(), R = PF.run, Pb = PF.publish, M = PF.map;
  const TV = PF.teamValues.parse(JSON.stringify({ format: 'flightdeck-team-values/1', values: { 'jira-base-url': { value: 'https://jira.example.com/jira' } } }));
  const b = Pb.build(FULL_MD, { people: [], customTypes: {}, by: P, changes: 'First', existing: [], now: AT, rand: 'kit00001', app: '4.0.0', teamValues: TV });
  if (b.blockers) throw new Error(b.blockers.join(' | '));
  const bytes = (t) => new Uint8Array(Buffer.from(t, 'utf8'));
  const pub = Pb.verify(b.folder, b.files, Pb.exactOf({ 'map.md': bytes(b.files['map.md']), 'types.json': bytes(b.files['types.json']) }));
  const r = R.create(pub, { id: 'kit-1', title: 'Kit run', details: { project: 'PAY', version: '2026.11.0', kind: 'major', due: '2026-11-20', tag: 'v12' }, roles: { lead: P }, by: P, session: 's-1', now: AT, tz: 'UTC', app: '4.0.0', teamValues: TV });
  const map = R.mapOf(r), st = (id) => M.findStep(map, id).step;
  R.done(r, map, 'scope', P, AT2, { searchId: R.searchId(r, map, st('scope')), count: '2', keys: 'PAY-1, PAY-2' });
  R.done(r, map, 'count', P, AT2, { [R.evidenceFor(r, st('count'), null, map).list[0].name]: '42' });
  const made = {}; Object.keys(r).forEach((k) => { if (k[0] !== '_') made[k] = r[k]; });
  const o = enrich(PF, made), REQ = 'req-flightdeck-' + 'ab'.repeat(12);
  o.steps.scope = made.steps.scope; o.steps.count = made.steps.count;
  const skill = { id: 'sk-abcd1234', rev: 2, sha: 'c'.repeat(64), snapshot: { name: 'Notes bot', version: '1.2', implements: { process: 'kit', folder: b.folder, mapHash: null, typesHash: 'abcd' }, steps: ['notes'], location: 'skills/notes-bot', description: 'Writes the notes' } };
  const snap = { by: P, at: AT2, onBehalf: '', records: [REQ], summary: '1 item, cleared', counts: { cleared: 1 }, items: [{ uid: 'item:1', key: 'Story one', state: 'cleared', status: 'Done', result: 'cleared', run: 'cs-1', exception: '', fp: '0123456789abcdef' }], request: REQ };
  o.steps.notes = { s: 'done', by: P, at: AT2, skill, history: [{ s: 'blocked', by: P, at: AT, reason: 'Waiting on the bot', skill, loop: snap }] };
  o.steps.each = { s: 'done', by: P, at: AT2, loop: snap, todos: { cut: [REQ] } };
  Object.keys(o.gates).forEach((g) => { o.gates[g].todos = { cut: [REQ] }; });
  o.features = PF.envelope.FROZEN.filter((f) => o.features.indexOf(f) >= 0 || f === 'living-runs');
  const base = {};
  Object.keys(o).forEach((k) => { if (k === 'steps') base.migrations = [{ path: 'details.kind', at: AT, from: 'Major', source: 'plan', verdict: 'converted', result: 'major', resolved: null }]; base[k] = o[k]; });
  base.living = { head: REQ };
  const files = {}, path = 'runs/kit/kit-1/run.json';
  Object.keys(b.files).forEach((n) => { files['publications/kit/' + b.folder + '/' + n] = b.files[n]; });
  files[path] = JSON.stringify(base, null, 2);
  return { X: { role: 'full', PF, files, key: 'kit/kit-1', path, depKey: 'kit/kit-1', force: false }, base };
}
async function build() {
  const roles = [];
  for (const X of await roleWorlds()) {
    const base = enrich(X.PF, JSON.parse(X.files[X.path]));
    const versions = {};
    Object.keys(X.files).filter((p) => /^(publications|staged)\//.test(p)).forEach((p) => { versions[p] = X.files[p]; });
    roles.push({ X, base, versions, cases: casesOf(base) });
  }
  const F = await fullWorld(), versions = {};
  Object.keys(F.X.files).filter((p) => /^publications\//.test(p)).forEach((p) => { versions[p] = F.X.files[p]; });
  roles.push({ X: F.X, base: F.base, versions, cases: casesOf(F.base) });
  return roles;
}
module.exports = { enrich, casesOf, jsVerdict, build, fullWorld };
