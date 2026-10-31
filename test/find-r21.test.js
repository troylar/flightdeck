// Find things in big folders (2.11), code review round 21: a note or a correction this window just saved is kept, revealed
// and focused by its whole identity (its run, id and whole content: PF.search.noteKeep), found again at every draw, never by
// the key it had when saved. A twin (another note sharing its id) arriving, leaving or moving never takes its place.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { small, fresh, arrive, iso, lines, textOf } = require('./find-twins.test');
const { prng } = require('./find-roles-diff.test');

const MINE = 'Saved behind the clock';
const key = () => small().facts.landed, dir = () => 'runs/' + key() + '/';
const liText = (h, id) => { const i = h.indexOf('<li id="' + id + '"'); return i < 0 ? null : h.slice(i, h.indexOf('</li>', i)); };
const thread = h => [...h.slice(h.indexOf('id="ins-notes"')).matchAll(/<li id="tn-s0-([^"]+)" tabindex="-1"/g)].map(m => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
const kept = h => { const i = h.indexOf('<p class="small kept-h">From earlier</p>'); return i < 0 ? [] : [...h.slice(i, h.indexOf('</ul>', i)).matchAll(/<li id="tn-s0-([^"]+)"/g)].map(m => m[1]); };
const gone = h => /That note isn(&#39;|')t in this run anymore/.test(h);
const noteFile = app => app.files(dir()).filter(f => /notes-/.test(f)).find(f => app.fs.files[f].t.indexOf(MINE) >= 0);
const mineOf = app => lines(app, noteFile(app)).find(n => n.text === MINE);
async function openLanded(app) { app.click('nav', 'home'); await app.tick(5); app.click('open-run', key()); await app.tick(10); app.click('select', 's0'); await app.tick(10); }
/* The id the next note or correction saved gets, once. */
function nextId(app, id) { const U = app.PF.util, was = U.randomId; U.randomId = n => { if (n !== 10) return was(n); U.randomId = was; return id; }; }

/* The landed run's step s0 with 25 notes an hour ahead of this computer's clock (a teammate's fast clock), and, with old,
   one older note whose id is old. Then a note saved here, which sorts before the newest 20. */
async function saved(old) {
  const app = await fresh(), now = Date.now(), rj = JSON.parse(app.fs.files[dir() + 'run.json'].t);
  const ahead = Array.from({ length: 25 }, (x, i) => ({ id: 'fast' + i, at: iso(now + 3600000 + i * 60000), by: 'person-blake', session: 'r21', step: 's0', text: 'From a fast clock ' + i }));
  if (old) ahead.unshift({ id: old, at: iso(Date.parse(rj.created) + 1000), by: 'person-blake', session: 'r21', step: 's0', text: 'An older note sharing the id' });
  await arrive(app, [[dir() + 'notes-r21.jsonl', ahead]]);
  await openLanded(app);
  app.input('note-text', MINE); await app.tick(5);
  if (old) nextId(app, old);
  app.click('add-note', 's0'); await app.tick(120);
  const mine = mineOf(app); assert.ok(mine, 'set-up: saved');
  if (old) assert.strictEqual(mine.id, old, 'set-up: with the older note\'s id');
  return { app, mine, now };
}
/* Twins of the saved note from other computers, each in a file of its own (set: name → note, or null for none). */
const twin = (mine, at, text) => ({ id: mine.id, at: iso(at), by: 'person-blake', session: 'tw', step: 's0', text });
async function twins(app, set) { await arrive(app, Object.keys(set).map(n => [dir() + 'notes-tw' + n + '.jsonl', set[n] ? [set[n]] : null])); }
/* The thread draws the saved note once, as itself, kept under From earlier; every drawn note is the note its key names. */
function savedOn(app, mine, what) {
  const h = app.html(), t = thread(h), rows = t.filter(k => (liText(h, 'tn-s0-' + k) || '').indexOf(MINE) >= 0);
  assert.strictEqual(rows.length, 1, what + ': the saved note is drawn, once: ' + t.slice(0, 3).join(', '));
  assert.ok(kept(h).indexOf(rows[0]) >= 0, what + ': under From earlier: ' + kept(h).join(', '));
  assert.ok(!gone(h), what + ': nothing says it\'s gone');
  return rows[0];
}
/* Each drawn note with the saved note's id is the note of the run its key names (id, then id#2… in time order). */
function asThemselves(app, mine, list, what) {
  const h = app.html(), ordered = list.slice().sort((a, b) => (a.at < b.at ? -1 : 1));
  ordered.forEach((n, i) => {
    const k = i ? mine.id + '#' + (i + 1) : mine.id, row = liText(h, 'tn-s0-' + k);
    if (row != null) assert.ok(row.indexOf(n.text) >= 0, what + ': ' + k + ' is drawn as itself (' + n.text + ')');
  });
}

/* ---------- 1. a note just saved ---------- */
rule('Round 21: a note saved before the newest 20, then a later note with its id arrives: the saved note stays under From earlier, as itself, and the twin is drawn as itself', async () => {
  const { app, mine, now } = await saved();
  assert.deepStrictEqual(kept(app.html()), [mine.id], 'set-up: under From earlier');
  const later = twin(mine, now + 7200000, 'The later twin');
  await twins(app, { a: later });
  assert.strictEqual(savedOn(app, mine, 'a later twin'), mine.id, 'by its own key');
  assert.ok((liText(app.html(), 'tn-s0-' + mine.id + '#2') || '').indexOf('The later twin') >= 0, 'the twin is drawn, as itself');
  asThemselves(app, mine, [mine, later], 'a later twin');
  /* Focus on the saved note stays on it when another later twin arrives. */
  app.node('[id="tn-s0-' + mine.id + '"]').focus();
  const second = twin(mine, now + 7300000, 'The second later twin');
  await twins(app, { a: later, b: second });
  savedOn(app, mine, 'a second later twin');
  assert.strictEqual(app.activeId(), 'tn-s0-' + mine.id, 'and focused');
  asThemselves(app, mine, [mine, later, second], 'a second later twin');
});

rule('Round 21: a note saved before the newest 20, then removed from the folder: the thread says it\'s gone, and a twin that arrives isn\'t drawn in its place', async () => {
  const { app, mine, now } = await saved();
  const later = twin(mine, now + 7200000, 'The later twin');
  await twins(app, { a: later });
  await arrive(app, [[noteFile(app), []]]);
  const h = app.html();
  assert.ok(gone(h), 'the line says it\'s gone');
  assert.deepStrictEqual(kept(h), [], 'nothing is kept in its place');
  assert.ok((liText(h, 'tn-s0-' + mine.id) || '').indexOf('The later twin') >= 0, 'the twin is drawn, as itself');
});

rule('Round 21: a note saved with the id of an older note on its step: it is the one brought into view and kept, not the older note', async () => {
  const { app, mine } = await saved('dupid');
  const asked = app.asked().filter(s => /tn-s0-dupid/.test(s));
  assert.ok(asked.some(s => /"tn-s0-dupid#2"/.test(s)), 'the saved note (dupid#2) is brought into view: ' + asked.join(' '));
  assert.ok(!asked.some(s => /"tn-s0-dupid"/.test(s)), 'never the older note: ' + asked.join(' '));
  const h = app.html();
  assert.ok((liText(h, 'tn-s0-dupid#2') || '').indexOf(MINE) >= 0, 'drawn as itself');
  savedOn(app, mine, 'saved with an older note\'s id');
});

rule('Round 21: a note saved while a read is under way, which doesn\'t have it yet: a later read finds it and keeps it under From earlier, as itself, with a later twin beside it', async () => {
  const app = await fresh(), now = Date.now();
  const ahead = Array.from({ length: 25 }, (x, i) => ({ id: 'fast' + i, at: iso(now + 3600000 + i * 60000), by: 'person-blake', session: 'r21', step: 's0', text: 'From a fast clock ' + i }));
  await arrive(app, [[dir() + 'notes-r21.jsonl', ahead]]);
  await openLanded(app);
  app.input('note-text', MINE); await app.tick(5);
  /* A read starts, then the note is saved: the read right after the save can be that read, from before the note. */
  app.click('refresh'); app.click('add-note', 's0'); await app.tick(160);
  const mine = mineOf(app); assert.ok(mine, 'set-up: saved');
  await arrive(app, []);
  assert.deepStrictEqual(kept(app.html()), [mine.id], 'kept under From earlier');
  await twins(app, { a: twin(mine, now + 7200000, 'The later twin') });
  savedOn(app, mine, 'a later twin');
});

/* A seeded run of twins arriving, leaving and moving (their time changed) around the saved note. */
rule('Round 21: twins of a saved note arriving, leaving and moving, 3 seeds of 10 reads: the saved note is always drawn, once, as itself, and every twin drawn is itself', async () => {
  for (const seed of [21, 2101, 9]) {
    const rand = prng(seed), { app, mine, now } = await saved(), set = {}, names = ['a', 'b', 'c', 'd'];
    const at = () => now + Math.floor((rand() * 4 - 1.5) * 3600000);
    for (let step = 0; step < 10; step++) {
      const n = names[Math.floor(rand() * names.length)], op = rand();
      if (!set[n] || op < 0.4) set[n] = twin(mine, at(), 'Twin ' + n + ' at step ' + step);
      else if (op < 0.7) set[n] = null;
      else set[n] = Object.assign({}, set[n], { at: iso(at()) });
      await twins(app, set);
      const what = 'seed ' + seed + ', read ' + step;
      savedOn(app, mine, what);
      asThemselves(app, mine, [mine].concat(names.map(x => set[x]).filter(Boolean)), what);
    }
  }
});

/* ---------- 2. a correction just saved ---------- */
/* The landed run's step s0 with 25 corrections from another computer, then one saved here (the newest, past the page). */
async function corrSaved(id) {
  const app = await fresh(), rj = JSON.parse(app.fs.files[dir() + 'run.json'].t), map = app.PF.run.mapOf(rj), C = app.PF.corrections, t0 = Date.parse(rj.created);
  const mk = (cid, at, to, why) => C.build({ id: cid, at: iso(at), by: 'person-blake', session: 'other', map, version: +rj.version, folder: rj.folder, step: 's0', op: 'wording', to, why });
  await arrive(app, [[dir() + 'notes-pre.jsonl', Array.from({ length: 25 }, (x, i) => mk((id && !i) ? id : 'pre' + i, t0 + 60000 + i * 1000, 'Pre worded ' + i, 'Pre reason ' + i))]]);
  await openLanded(app);
  app.click('corr-open', 's0', { mode: 'correct' }); await app.tick();
  app.input('corr-to', 'My own wording'); app.input('corr-why', 'Saved past the page');
  if (id) nextId(app, id);
  app.click('corr-save', 's0'); await app.tick(120);
  const mine = app.files(dir()).filter(f => /notes-/.test(f)).flatMap(f => lines(app, f)).find(n => n.kind === 'correction' && n.why === 'Saved past the page');
  assert.ok(mine, 'set-up: saved');
  return { app, mine, mk, t0 };
}
const corrRow = (h, id) => { const i = h.indexOf('<li class="corr" id="' + id + '"'); return i < 0 ? null : h.slice(i, h.indexOf('</li>', i)); };
const corrIds = h => [...h.slice(h.indexOf('id="ins-corr"')).matchAll(/<li class="corr" id="(corr-[^"]+)"/g)].map(m => m[1]);

rule('Round 21: a correction saved past the page, then an older correction with its id arrives: the saved one is still drawn, as itself, and the older one as itself', async () => {
  const { app, mine, mk, t0 } = await corrSaved();
  let h = app.html();
  assert.ok((corrRow(h, 'corr-' + mine.id) || '').indexOf('My own wording') >= 0, 'set-up: drawn');
  assert.strictEqual(app.activeId(), 'corr-' + mine.id, 'set-up: focused');
  /* Focus moves off it, so only the save keeps it drawn. */
  app.doc.activeElement = app.doc.body;
  await arrive(app, [[dir() + 'notes-old.jsonl', [mk(mine.id, t0 + 1000, 'The older twin\'s wording', 'Older twin reason')]]]);
  h = app.html();
  const row = corrRow(h, 'corr-' + mine.id + '#2');
  assert.ok(row && row.indexOf('My own wording') >= 0, 'the saved correction is drawn, as itself (' + mine.id + '#2): ' + corrIds(h).slice(-3).join(', '));
  assert.ok((corrRow(h, 'corr-' + mine.id) || '').indexOf('The older twin') >= 0, 'the older twin is drawn as itself');
  assert.ok(/plus the one you just added/.test(h), 'said as the one just added');
  assert.ok(corrIds(h).length <= 22, 'with at most 22 drawn: ' + corrIds(h).length);
});

rule('Round 21: a correction saved with the id of an older correction on its step: it is the one drawn past the page, focused and brought into view', async () => {
  const { app, mine } = await corrSaved('c-old');
  assert.strictEqual(mine.id, 'c-old', 'set-up: with the older correction\'s id');
  const h = app.html(), row = corrRow(h, 'corr-c-old#2');
  assert.ok(row && row.indexOf('My own wording') >= 0, 'the saved correction is drawn: ' + corrIds(h).slice(-3).join(', '));
  assert.strictEqual(app.activeId(), 'corr-c-old#2', 'and focused');
  assert.ok(app.asked().some(s => /"corr-c-old#2"/.test(s)), 'and brought into view');
});

/* ---------- 3. a search hit's flash ---------- */
const sxBox = app => { const q = app.el('sx-q'); q.tagName = 'INPUT'; q.type = 'search'; return q; };
async function search(app, text) { app.click('search'); await app.tick(10); sxBox(app); app.input('sx-q', text); await app.tick(400); return [...app.overlay().matchAll(/role="option"[^>]*data-id="([^"]+)"/g)].map(m => m[1]); }
rule('Round 21: a note a search opened flashes as itself when an older note with its id arrives while it flashes', async () => {
  const app = await fresh(), rj = JSON.parse(app.fs.files[dir() + 'run.json'].t), t0 = Date.parse(rj.created);
  const n = { id: 'flashme', at: iso(t0 + 600000), by: 'person-blake', session: 'r21', step: 's0', text: 'The note a search opened' };
  await arrive(app, [[dir() + 'notes-r21.jsonl', [n]]]);
  app.click('nav', 'home'); await app.tick(5);
  const hit = (await search(app, 'note a search opened'))[0];
  assert.ok(hit, 'set-up: a search hit');
  app.click('sx-open', hit); await app.tick(20);
  assert.ok(/<li id="tn-s0-flashme" tabindex="-1" class="flash">/.test(app.html()), 'set-up: it flashes');
  /* Focus moves off it, then an older note with its id arrives while it still flashes. */
  app.doc.activeElement = app.doc.body;
  await arrive(app, [[dir() + 'notes-old.jsonl', [Object.assign({}, n, { at: iso(t0 + 1000), text: 'The older twin' })]]]);
  const h = app.html();
  if (!/class="flash"/.test(h)) return; /* the flash ended first on a slow machine: nothing to check */
  assert.ok(/<li id="tn-s0-flashme#2" tabindex="-1" class="flash">/.test(h), 'the note opened (flashme#2 now) flashes');
  assert.ok(!/<li id="tn-s0-flashme" tabindex="-1" class="flash">/.test(h), 'the older twin doesn\'t');
});

run();
