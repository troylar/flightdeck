// Find things in big folders (2.11), code review round 6: correction members, one-off answers and kept rows are held by
// what they are. Twin notes (notes sharing an id in one run) inserted, deleted and reordered never move focus onto another.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');
const { fixture, into } = require('./bounds-fixture');

const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const SMALL = { procs: 3, tags: 3, people: 10, followUps: 3, running: 3, plans: 3, versions: 3, stages: 2, members: 3, health: 3, many: 60, ended: 3, steps: 3, teamValues: 3, legacy: 3, archived: 3, hot: 3 };
const small = o => fixture({ size: Object.assign({}, SMALL, o || {}) });
async function fresh(fx) {
  /* The app's elapsed-time clock, which a test moves on (skip) so the whole folder is due for a read. */
  const clock = { skip: 0 }, perf = { now: () => Number(process.hrtime.bigint() / 1000000n) + clock.skip };
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true, performance: perf }); await app.tick(60);
  app.clock = clock;
  await into(app, fx || small());
  /* Every ended run counts as recently ended, so every read checks its files and a twin can arrive in one. */
  app.PF.repo.config.recentMs = 1e13;
  return app;
}
function moreOf(html, id) {
  const m = new RegExp('<button[^>]*data-act="more" data-id="' + id.replace(/[-/:.#]/g, '\\$&') + '"([^>]*)>').exec(html); if (!m) return null;
  const d = {}; m[1].replace(/data-([\w-]+)="([^"]*)"/g, (x, k, v) => { d[k] = un(v); return x; }); return d;
}
async function more(app, id, h) { const d = moreOf(h || app.html(), id); assert.ok(d, 'a Show more for ' + id); app.click('more', id, d); await app.tick(5); return d; }
const lines = (app, p) => (app.fs.files[p] ? app.fs.files[p].t : '').split('\n').filter(Boolean).map(l => JSON.parse(l));
async function arrive(app, writes) {
  for (const [p, list] of writes) {
    if (list) await app.fs.write(p, list.map(x => JSON.stringify(x)).join('\n') + (list.length ? '\n' : ''));
    else if (app.fs.files[p]) await app.fs.remove(p);
  }
  /* A minute passes: the app's own beat rereads the folder (the open run first, on a run's screens), focus left where it is. */
  const was = app.PF.perf.n['load.done'] || 0;
  app.clock.skip += 61000; app.every(); await app.tick(20); app.every();
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(5);
}
/* The text of the element with this id, to the end of its row or term (</li>, </dd>, </button>). */
function textOf(h, id) {
  const i = h.indexOf('id="' + id + '"'); if (i < 0) return null;
  const ends = ['</li>', '</dd>', '</button>'].map(e => h.indexOf(e, i)).filter(x => x >= 0);
  return h.slice(i, Math.min.apply(null, ends));
}
const iso = t => new Date(t).toISOString();

module.exports = { small, fresh, more, moreOf, lines, arrive, textOf, iso, un };
if (require.main !== module) return;

/* ---------- 1. a correction group's members, by their whole note ---------- */
/* Twin members: notes sharing one id in one v1 run of "landed", the same change, each with its own reason. */
function twinSetup(app) {
  const file = app.files('runs/landed/').filter(f => /notes-landed\.jsonl$/.test(f)).sort()[0], base = lines(app, file)[0];
  const T0 = Date.parse(base.at) - 400 * 86400000;
  const twin = (why, min) => Object.assign({}, base, { id: 'tw', at: iso(T0 + min * 60000), why, text: base.text.replace(/Why: .*$/, 'Why: ' + why) });
  return { file, base, twin };
}
async function processFx(app) {
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'landed'); await app.tick(10);
  app.fire('toggle', { target: { dataset: { disc: 'fx:landed' }, open: true } }); app.click('dismiss'); await app.tick(5);
  app.click('corr-filter', 'all'); await app.tick(5);
}
async function landedRun(app) {
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', small().facts.landed); await app.tick(10);
  app.click('select', 's0'); await app.tick(10);
}
/* The id of the reason term (fxm-… on the process page, pm-… in Why is this here?) whose text holds what. */
const reasonId = (h, prefix, what) => { const m = [...h.matchAll(new RegExp('<dt id="(' + prefix + '[^"]+)" tabindex="-1">[^<]*</dt><dd>' + what + '</dd>', 'g'))]; return m.length === 1 ? un(m[0][1]) : null; };
const reasonAt = (app, id) => { const h = app.html(), i = h.indexOf('id="' + id + '"'); return i < 0 ? null : /<dd>([^<]*)<\/dd>/.exec(h.slice(i))[1]; };
/* Each twin in a notes file of its own, as notes from other computers arrive (notes files only grow). */
const twinFile = (file, n) => file.replace('notes-landed', 'notes-' + n);
async function twins(app, file, set) { const all = ['ta', 'tb', 'tc', 'td']; await arrive(app, all.map(n => [twinFile(file, n), set[n] ? [set[n]] : null])); }
for (const [where, go, prefix, heading] of [['the process page', processFx, 'fxm-', 'fx-h'], ['Why is this here?', landedRun, 'pm-s0-', 'ins-h']]) {
  rule('Round 6: twin members of one correction group (' + where + '): focus on a member\'s reason stays on that member when a twin is inserted, deleted or reordered', async () => {
    const app = await fresh(), { file, twin } = twinSetup(app);
    const alpha = twin('Alpha reason', 10), beta = twin('Beta reason', 20), gamma = twin('Gamma reason', 5);
    const start = async set => { await twins(app, file, set); await go(app); const id = reasonId(app.html(), prefix, 'Beta reason'); assert.ok(id, where + ': set-up: Beta drawn'); app.node('[id="' + id + '"]').focus(); return id; };
    const on = what => { const a = app.activeId(); assert.ok(a && a.indexOf(prefix) === 0, what + ': focus on a reason: ' + a); assert.strictEqual(reasonAt(app, a), 'Beta reason', what + ': on Beta\'s own reason'); };
    await start({ ta: alpha, tb: beta });
    await twins(app, file, { ta: alpha, tb: beta, tc: gamma });
    assert.ok(reasonId(app.html(), prefix, 'Gamma reason'), 'set-up: the older twin arrived');
    on('an older twin inserted');
    await start({ ta: alpha, tb: beta });
    await twins(app, file, { tb: beta });
    assert.ok(!reasonId(app.html(), prefix, 'Alpha reason'), 'set-up: the other twin is gone');
    on('the other twin deleted');
    await start({ ta: alpha, tb: beta });
    await twins(app, file, { ta: Object.assign({}, alpha, { at: iso(Date.parse(beta.at) + 60000) }), tb: beta });
    on('the twins reordered');
    /* The focused member itself deleted: focus goes to the list's heading, never onto another member. */
    await start({ ta: alpha, tb: beta });
    await twins(app, file, { ta: alpha });
    assert.strictEqual(app.activeId(), heading, 'the focused member deleted');
  });
}

/* ---------- 2. a one-off Done differently row, held by its answer ---------- */
/* The landed run's step s0 with 55 corrections from another computer, then a Done differently answer with no correction
   (a one-off row, corr-#off-s0), the newest on the step. */
async function oneOff() {
  const app = await fresh(), key = small().facts.landed, dir = 'runs/' + key + '/';
  const rj = JSON.parse(app.fs.files[dir + 'run.json'].t), map = app.PF.run.mapOf(rj), C = app.PF.corrections, t0 = Date.parse(rj.created);
  const mk = (tag, n, from) => Array.from({ length: n }, (x, i) => C.build({ id: tag + i, at: iso(from + i * 1000), by: 'person-blake', session: 'other', map, version: +rj.version, folder: rj.folder, step: 's0', op: 'wording', to: tag + ' worded ' + i, why: tag + ' reason ' + i }));
  await arrive(app, [[dir + 'notes-pre.jsonl', mk('pre', 55, t0 + 60000)]]);
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', key); await app.tick(10);
  for (const act of ['pickup', 'takeover']) if (new RegExp('data-act="' + act + '"').test(app.html())) { app.click(act); await app.tick(40); }
  app.click('select', 's0'); await app.tick(10);
  app.click('corr-open', 's0', { mode: 'differently' }); await app.tick();
  app.input('corr-happened', 'Did it by hand'); app.click('corr-done', 's0'); await app.tick(120);
  /* Done moves on to the next step; back to s0. */
  app.click('select', 's0'); await app.tick(10);
  assert.ok(/<li class="corr" id="corr-#off-s0"/.test(app.html()) || moreOf(app.html(), 'rcorr:' + key + ':s0'), 'set-up: a one-off row');
  let n = 0;
  /* Older corrections arriving from another computer, each read in a file of its own: they sort in above the one-off. */
  const older = async count => { n++; await arrive(app, [[dir + 'notes-older' + n + '.jsonl', mk('old' + n + '-', count, t0 + 1000)]]); };
  return { app, key, older };
}
const oneOffOn = (app, what) => {
  const h = app.html();
  assert.ok(/<li class="corr" id="corr-#off-s0"/.test(h), what + ': the one-off row is still drawn');
  assert.strictEqual(app.activeId(), 'corr-#off-s0', what + ': and focused');
  assert.ok(textOf(h, 'corr-#off-s0').indexOf('Did it by hand') >= 0, what + ': on its own answer');
  assert.ok(/<p class="small kept-h">You(&#39;|')re on this one<\/p><ul class="corrlist"><li class="corr" id="corr-#off-s0"/.test(h), what + ': past the page, under You\'re on this one');
};
rule('Round 6: a focused one-off Done differently row stays drawn and focused in the inspector, Finish and Receipt when older corrections push it past the page', async () => {
  const { app, key, older } = await oneOff();
  const id = 'rcorr:' + key + ':s0';
  while (!/<li class="corr" id="corr-#off-s0"/.test(app.html())) await more(app, id);
  app.node('[id="corr-#off-s0"]').focus();
  await older(50);
  oneOffOn(app, 'the inspector');
  for (const [page, list] of [['finish', 'fin-corr:' + key], ['receipt', 'rcpt-corr:' + key]]) {
    app.click(page); await app.tick(10);
    while (!/<li class="corr" id="corr-#off-s0"/.test(app.html())) await more(app, list);
    app.node('[id="corr-#off-s0"]').focus();
    await older(60);
    oneOffOn(app, page);
    if (page === 'finish') { app.click('exit-mission'); await app.tick(10); }
  }
});
rule('Round 6: the focused one-off row\'s answer changed by a newer read: focus goes to the inspector\'s heading, never onto the new answer in its place', async () => {
  const { app, key } = await oneOff();
  const id = 'rcorr:' + key + ':s0';
  while (!/<li class="corr" id="corr-#off-s0"/.test(app.html())) await more(app, id);
  app.node('[id="corr-#off-s0"]').focus();
  const p = 'runs/' + key + '/run.json', rj = JSON.parse(app.fs.files[p].t);
  rj.steps.s0.differently = Object.assign({}, rj.steps.s0.differently, { note: 'Did it another way' });
  await app.fs.write(p, JSON.stringify(rj, null, 2) + '\n');
  await arrive(app, []);
  assert.ok(textOf(app.html(), 'corr-#off-s0').indexOf('Did it another way') >= 0, 'set-up: the new answer is drawn');
  assert.strictEqual(app.activeId(), 'ins-h', 'focus on the inspector\'s heading');
});

/* ---------- 3. focus retention past 1,000 drawn rows ---------- */
const quietRedraw = async app => { app.fire('click', { target: { closest: () => ({ dataset: { act: 'dismiss' }, disabled: false, classList: { contains: () => false } }) } }); await app.tick(5); };
rule('Round 6: Running shown to 1,050 runs, the last focused: one sorting in above keeps it drawn and focused', async () => {
  const app = await fresh(small({ running: 1100 }));
  app.click('nav', 'runs'); await app.tick(5); app.click('filter', 'all'); await app.tick(5);
  for (let i = 0; i < 20; i++) await more(app, 'runs-running');
  app.PF.vk.TRACE = [];
  let l; try { await quietRedraw(app); l = app.PF.vk.TRACE.filter(x => x.id === 'runs-running')[0]; } finally { app.PF.vk.TRACE = null; }
  assert.strictEqual(l.page.length, 1050, 'set-up: 1,050 drawn');
  const k = l.page[1049], sel = l.focusOf(k);
  app.node(sel).focus();
  app.PF.vk.ARRIVE = 'runs-running'; app.PF.vk.TRACE = [];
  let after; try { await quietRedraw(app); after = app.PF.vk.TRACE.filter(x => x.id === 'runs-running')[0]; } finally { app.PF.vk.ARRIVE = null; app.PF.vk.TRACE = null; }
  assert.ok(after.page.indexOf(k) < 0, 'set-up: pushed past the page');
  assert.deepStrictEqual([...after.extra], [k], 'drawn once past the page');
  assert.ok(app.node(sel) && app.doc.activeElement === app.node(sel), 'and focused: ' + app.activeId());
});

/* ---------- every list that can hold twins, by property ---------- */
/* For each list that can draw twin notes (notes sharing one id in one run): the step's note thread, the run's corrections in
   the inspector, Finish, Receipt, correction groups on the process page and Why is this here?. A seeded random walk: each
   drawn twin focused in turn, then another twin inserted, deleted or moved in time (now and then the focused one deleted),
   read as a newer read; focus must be on the same item, by its content, or on the list's heading when it's gone or can no
   longer be told apart (one more or one fewer note identical to it in every field). Twins sit at the edge of each list's
   page, so arrivals push drawn ones past it. */
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const SEED = +(process.env.TWIN_SEED || 6011);
const MIN = 60000, HOUR = 3600000;
async function twinWorld() {
  const app = await fresh(), key = small().facts.landed, dir = 'runs/' + key + '/', C = app.PF.corrections;
  const rj = JSON.parse(app.fs.files[dir + 'run.json'].t), map = app.PF.run.mapOf(rj), t0 = Date.parse(rj.created);
  const corr = (id, at, step, mark) => C.build({ id, at: iso(at), by: 'person-blake', session: 'other', map, version: +rj.version, folder: rj.folder, step, op: 'wording', to: 'Worded ' + mark, why: 'Why ' + mark });
  const note = (id, at, mark) => ({ id, at: iso(at), by: 'person-blake', session: 'other', step: 's0', text: 'Said ' + mark });
  /* Fillers, each list's page minus a few, before (after, for the thread) its twins. */
  const fill = [];
  for (let i = 0; i < 17; i++) fill.push(corr('fa' + i, t0 + (i + 1) * MIN, 's0', 'filler s0 ' + i));
  for (let i = 0; i < 27; i++) fill.push(corr('fb' + i, t0 + (i + 1) * MIN, 's1', 'filler s1 ' + i));
  for (let i = 0; i < 17; i++) fill.push(note('fn' + i, t0 + 300 * MIN + i * MIN, 'filler note ' + i));
  await arrive(app, [[dir + 'notes-fill.jsonl', fill]]);
  /* The v1 run of landed member 10: its members are an hour apart, member i at m(i). */
  const vfile = app.files('runs/landed/').filter(f => /notes-landed\.jsonl$/.test(f)).sort()[0], vbase = lines(app, vfile)[0];
  const vi = +/Landed member (\d+)/.exec(vbase.why)[1], m = i => Date.parse(vbase.at) + (i - vi) * HOUR;
  const member = (at, mark) => Object.assign({}, vbase, { id: 'tw', at: iso(at), why: 'Why ' + mark, text: vbase.text.replace(/Why: .*$/, 'Why: Why ' + mark) });
  const inspector = async () => { app.click('nav', 'home'); await app.tick(5); app.click('open-run', key); await app.tick(10); app.click('select', 's0'); await app.tick(10); };
  const page = p => async () => { await inspector(); if (/data-act="takeover"/.test(app.html())) { app.click('takeover'); await app.tick(40); } app.click(p); await app.tick(10); };
  const corrRows = h => [...h.matchAll(/<li class="corr" id="([^"]+)"/g)].map(x => un(x[1]));
  const liOf = (h, id) => { const i = h.indexOf('id="' + id + '"'); return i < 0 ? null : h.slice(i, h.indexOf('</li>', i)); };
  const markOf = t => { const x = t && /(P[A-Z]-\d+[ab]?)/.exec(t); return x ? x[1].replace(/[ab]$/, '') : null; };
  const lists = [
    { name: 'the note thread', heading: 'ins-h', go: inspector, dir: dir, mark: 'PN', make: (id, at, mk) => note(id, at, mk), win: [t0 + 200 * MIN, t0 + 290 * MIN],
      rows: h => [...h.slice(h.indexOf('id="ins-notes"')).matchAll(/<li id="(tn-s0-[^"]+)" tabindex="-1"/g)].map(x => un(x[1])), text: textOf },
    { name: 'the inspector\'s corrections', heading: 'ins-h', go: inspector, dir: dir, mark: 'PI', make: (id, at, mk) => corr(id, at, 's0', mk), win: [t0 + 20 * MIN, t0 + 30 * MIN],
      rows: h => { const a = h.indexOf('id="ins-corr"'); return corrRows(h.slice(a, h.indexOf('id="ins-notes"', a))); }, text: liOf },
    { name: 'Finish', heading: 'page-h', go: page('finish'), dir: dir, mark: 'PF', make: (id, at, mk) => corr(id, at, 's1', mk), win: [t0 + 40 * MIN, t0 + 50 * MIN], rows: corrRows, text: liOf },
    { name: 'Receipt', heading: 'page-h', go: page('receipt'), dir: dir, mark: 'PR', make: (id, at, mk) => corr(id, at, 's1', mk), win: [t0 + 60 * MIN, t0 + 70 * MIN], rows: corrRows, text: liOf },
    { name: 'correction groups on the process page', heading: 'fx-h', go: processFx, dir: null, mark: 'PG', make: (id, at, mk) => member(at, mk), win: [m(46) + 10 * MIN, m(46) + 50 * MIN],
      rows: h => [...h.matchAll(/<dt id="(fxm-[^"]+)" tabindex="-1">/g)].map(x => un(x[1])), text: (h, id) => reasonAt(app, id) },
    { name: 'Why is this here?', heading: 'ins-h', go: landedRun, dir: null, mark: 'PW', make: (id, at, mk) => member(at, mk), win: [m(17) + 10 * MIN, m(17) + 50 * MIN],
      rows: h => [...h.matchAll(/<dt id="(pm-s0-[^"]+)" tabindex="-1">/g)].map(x => un(x[1])), text: (h, id) => reasonAt(app, id) }
  ];
  lists.forEach(l => { l.file = n => (l.dir ? l.dir + 'notes-' : vfile.replace('notes-landed.jsonl', 'notes-')) + l.mark.toLowerCase() + n + '.jsonl'; l.markOf = markOf; });
  return { app, lists };
}
rule('Round 6, by property: in every list that holds twins, focus stays on the same item through random insertions, deletions and reorders of its twins (seed ' + SEED + ')', async () => {
  const { app, lists } = await twinWorld(), rand = prng(SEED), log = [], fails = [];
  const pick = a => a[Math.floor(rand() * a.length)];
  for (const l of lists) {
    /* The pool: six twins sharing id "pt" (one of them twice, identical in every field), each with its own file. */
    const at = () => l.win[0] + Math.floor(rand() * (l.win[1] - l.win[0]) / 1000) * 1000;
    const pool = []; for (let i = 0; i < 6; i++) pool.push({ n: i, note: l.make('pt', at(), l.mark + '-' + i) });
    /* The identical pair (1 and 6) at the end of the window the page draws (the newest, for the thread's tail), so both are drawn. */
    pool[1].note = l.make('pt', l.name === 'the note thread' ? l.win[1] : l.win[0], l.mark + '-1');
    pool.push({ n: 6, note: Object.assign({}, pool[1].note) });
    const on = new Set([0, 1, 2, 3, 6]);
    const write = () => arrive(app, pool.map(p => [l.file(p.n), on.has(p.n) ? [p.note] : null]));
    const count = mk => pool.filter(p => on.has(p.n) && l.markOf(p.note.why || p.note.text) === mk).length;
    await write(); await l.go(app);
    let ok = 0, steps = 0;
    const twinsOf = (h, mk) => l.rows(h).filter(x => l.markOf(l.text(h, x)) === mk);
    /* Focus the drawn row id (marked mk), make the change, read: gone or no longer told apart (one more or one fewer note
       identical to it) sends focus to the heading, checked first; otherwise focus is on its own row, by its exact id now. */
    const trial = async (tag, id, mk, change) => {
      const h = app.html(), was = count(mk), rank = twinsOf(h, mk).indexOf(id);
      app.node('[id="' + id.replace(/["\\]/g, '\\$&') + '"]').focus();
      const what = change();
      await write();
      const h2 = app.html(), now = count(mk), a = app.activeId(), got = a ? l.markOf(l.text(h2, a)) : null;
      const gone = now === 0, ambiguous = now !== was && (was > 1 || now > 1);
      const want = gone || ambiguous ? l.heading : now === 1 ? twinsOf(h2, mk)[0] : twinsOf(h2, mk)[rank];
      log.push(l.name + ' ' + tag + ': on ' + mk + ' (' + was + ' like it, ' + id + '), ' + what + ' -> ' + now + ' like it, focus ' + a + (got ? ' (' + got + ')' : '') + ', wanted ' + want);
      steps++;
      if (want && a === want) ok++; else fails.push(log[log.length - 1]);
    };
    /* Every surface, deterministically: two notes identical in every field become one, and one becomes two again. */
    const mk1 = l.markOf(pool[1].note.why || pool[1].note.text);
    let tw = twinsOf(app.html(), mk1);
    if (!tw.length) fails.push(l.name + ': set-up: its identical twins aren\'t drawn');
    else {
      await trial('identical 2 to 1', tw[tw.length - 1], mk1, () => { on.delete(6); return 'delete one of the two identical'; });
      tw = twinsOf(app.html(), mk1);
      if (!tw.length) fails.push(l.name + ': set-up: the identical survivor isn\'t drawn');
      else await trial('identical 1 to 2', tw[0], mk1, () => { on.add(6); return 'insert its identical twin'; });
    }
    for (let step = 0; step < 6; step++) {
      const h = app.html(), drawn = l.rows(h).filter(id => (l.markOf(l.text(h, id)) || '').indexOf(l.mark + '-') === 0);
      if (!drawn.length) { fails.push(l.name + ': no twin drawn at step ' + step); break; }
      const id = drawn[step % drawn.length], mk = l.markOf(l.text(h, id));
      const self = [...on].filter(n => l.markOf(pool[n].note.why || pool[n].note.text) === mk), others = [...on].filter(n => self.indexOf(n) < 0), off = pool.filter(p => !on.has(p.n)).map(p => p.n);
      await trial('#' + step, id, mk, () => {
        const r = rand();
        if (r < 0.12 && self.length) { const n = pick(self); on.delete(n); return 'delete the focused ' + mk; }
        if (r < 0.45 && off.length) { const n = pick(off); pool[n].note = Object.assign({}, pool[n].note, n === 6 ? {} : { at: iso(at()) }); on.add(n); return 'insert ' + l.markOf(pool[n].note.why || pool[n].note.text); }
        if (r < 0.75 && others.length > 1) { const n = pick(others); on.delete(n); return 'delete ' + l.markOf(pool[n].note.why || pool[n].note.text); }
        if (others.length) { const n = pick(others); if (n !== 6 && n !== 1) pool[n].note = Object.assign({}, pool[n].note, { at: iso(at()) }); else { on.delete(n); } return (n !== 6 && n !== 1 ? 'move ' : 'delete ') + l.markOf(pool[n].note.why || pool[n].note.text); }
        return 'nothing';
      });
    }
    if (ok < steps && !fails.some(f => f.indexOf(l.name) === 0)) fails.push(l.name + ': only ' + ok + ' of ' + steps + ' steps checked');
    if (steps < 8 && !fails.some(f => f.indexOf(l.name) === 0)) fails.push(l.name + ': only ' + steps + ' steps run');
    /* This list's twins go, so the next list's are the only twins sharing their id. */
    on.clear(); await write();
  }
  if (process.env.TWIN_LOG) console.log(log.join('\n'));
  assert.deepStrictEqual(fails, [], fails.join('\n'));
});

run();
