// Find things in big folders (2.11), slice 5: run notes, folder health, Settings › People and team values, and the lists
// joined into one line. The step-note thread is the newest 20 with Show earlier; a note is found by its id and its whole
// content (PF.search.noteFind), so notes sharing an id are told apart, in the thread, in a step's Corrections and in search.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');
const { fixture, into } = require('./bounds-fixture');

const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
let big = null;
async function fresh() {
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fixture());
  return app;
}
async function bigApp() { return big || (big = await fresh()); }
async function reread(app) {
  const was = app.PF.perf.n['load.done'] || 0;
  app.click('refresh');
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(5);
}
function moreOf(html, id) {
  const m = new RegExp('<button[^>]*data-act="more" data-id="' + id.replace(/[-/:.#]/g, '\\$&') + '"([^>]*)>').exec(html); if (!m) return null;
  const d = {}; m[1].replace(/data-([\w-]+)="([^"]*)"/g, (x, k, v) => { d[k] = un(v); return x; }); return d;
}
async function more(app, id, h) { const d = moreOf(h || app.html(), id); assert.ok(d, 'a Show more for ' + id); app.click('more', id, d); await app.tick(5); return d; }
const ids = (h, re) => [...h.matchAll(re)].map(m => un(m[1]));
const count = (h, re) => (h.match(re) || []).length;
const typeFind = async (app, id, v) => { app.set('find-' + id, v); app.input('find-' + id, v); await app.tick(5); };
const sxBox = app => { const q = app.el('sx-q'); q.tagName = 'INPUT'; q.type = 'search'; return q; };
async function search(app, text) { app.click('search'); await app.tick(10); sxBox(app); app.input('sx-q', text); await app.tick(400); return ids(app.overlay(), /role="option"[^>]*data-id="([^"]+)"/g); }
const perfDelta = async (app, keys, fn) => { const was = {}; keys.forEach(k => { was[k] = app.PF.perf.n[k] || 0; }); await fn(); const out = {}; keys.forEach(k => { out[k] = (app.PF.perf.n[k] || 0) - was[k]; }); return out; };
async function openRun(app, key, step) {
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', fixture().facts[key] || key); await app.tick(10);
  if (step) { app.click('select', step); await app.tick(10); }
}
/* The thread's notes drawn: their keys (id, or id#n for a later note sharing that id), in order. */
const thread = (h, step) => ids(h.slice(h.indexOf('id="ins-notes"')), new RegExp('<li id="tn-' + step + '-([^"]+)" tabindex="-1"', 'g'));
const liText = (h, id) => { const i = h.indexOf('id="' + id + '"'); return i < 0 ? '' : h.slice(i, h.indexOf('</li>', i)); };
const busyList = () => 'notes:' + fixture().facts.busy + ':s0';
const notesFile = app => Object.keys(app.fs.files).find(p => /notes-busy-s1\.jsonl$/.test(p));
const lines = (app, p) => app.fs.files[p].t.split('\n').filter(Boolean).map(l => JSON.parse(l));
async function rewrite(app, p, list) { await app.fs.write(p, list.map(x => JSON.stringify(x)).join('\n') + '\n'); await reread(app); }
/* A newer read that arrives on its own (the window coming back into focus), leaving focus where it is. */
async function arrive(app, p, list) {
  await app.fs.write(p, list.map(x => JSON.stringify(x)).join('\n') + '\n');
  const was = app.PF.perf.n['load.done'] || 0;
  app.focus();
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(5);
}

/* ---------- the step-note thread ---------- */
rule('Notes: 327 notes on a step draw the newest 20; Show earlier adds 20 above, focusing the first one it adds', async () => {
  const app = await bigApp(); await openRun(app, 'busy', 's0');
  let h = app.html(), t = thread(h, 's0');
  assert.strictEqual(t.length, 20, 'the newest 20');
  assert.deepStrictEqual(t, Array.from({ length: 20 }, (x, i) => 'ahead' + String(i + 5).padStart(2, '0')), 'newest last, in time order');
  assert.ok(/Showing 20 of 327/.test(h), 'the count says how many');
  const d = await more(app, busyList(), h);
  assert.strictEqual(d.focus, '[id="tn-s0-n0285"]', 'Show earlier names the first note it adds');
  h = app.html(); t = thread(h, 's0');
  assert.strictEqual(t.length, 40);
  assert.deepStrictEqual(t.slice(0, 3), ['n0285', 'n0286', 'n0287'], 'added above, in time order');
  assert.strictEqual(app.activeId(), 'tn-s0-n0285', 'and focused');
  assert.ok(h.indexOf('id="tn-s0-n0285"') < h.indexOf('id="tn-s0-ahead24"'), 'above the newer ones');
});

rule('Notes: Earlier and Archived answers share the thread\'s look, and aren\'t counted with its notes', async () => {
  const app = await fresh(); await openRun(app, 'busy', 's0');
  app.click('load-history'); await app.tick(60);
  await more(app, busyList());
  const h = app.html();
  assert.strictEqual(thread(h, 's0').length, 40, '40 notes after one Show earlier');
  assert.strictEqual(count(h, /<li id="arch-s0-\d+"/g), 20, 'the archived answers page on their own');
  assert.ok(count(h, /<ul class="tnotes"/g) >= 2, 'both lists use the thread\'s look');
});

rule('Notes: a search hit on note 10 of 327 is drawn under From earlier, flashed and focused, with at most 21 drawn', async () => {
  const app = await bigApp();
  app.click('nav', 'home'); await app.tick(5);
  const hit = (await search(app, 'Note 10 on the busy step')).find(x => /:n0010#1$/.test(x));
  assert.ok(hit);
  app.click('sx-open', hit); await app.tick(20);
  const h = app.html(), t = thread(h, 's0');
  assert.ok(t.indexOf('n0010') >= 0, 'drawn');
  assert.ok(t.length <= 21, 'with at most 21: ' + t.length);
  assert.ok(/<p class="small kept-h">From earlier<\/p>/.test(h), 'under From earlier');
  assert.ok(/294 notes between/.test(h), 'with how many notes lie between: ' + (h.match(/\d+ notes between/) || [])[0]);
  assert.ok(/<li id="tn-s0-n0010" tabindex="-1" class="flash"/.test(h), 'flashed');
  assert.strictEqual(app.activeId(), 'tn-s0-n0010', 'focused');
  assert.ok(app.asked().some(s => /tn-s0-n0010/.test(s)), 'brought into view');
});

rule('Notes: at phone width a search hit on a note opens the inspector sheet on it', async () => {
  const app = await bigApp(); app.setNarrow(true); await app.tick(5);
  try {
    app.click('nav', 'home'); await app.tick(5);
    const hit = (await search(app, 'Note 12 on the busy step')).find(x => /:n0012#1$/.test(x));
    app.click('sx-open', hit); await app.tick(20);
    assert.strictEqual(app.PF && app.activeId(), 'tn-s0-n0012');
    assert.ok(thread(app.html(), 's0').indexOf('n0012') >= 0);
    assert.ok(/class="fpe-pane rw-ins" id="rw-ins"[^>]*data-open="true"/.test(app.html()), 'the inspector sheet is open');
  } finally { app.setNarrow(false); await app.tick(5); }
});

rule('Notes: the composer keeps what\'s typed through Show earlier and a newer read', async () => {
  const app = await bigApp(); await openRun(app, 'busy', 's0');
  app.input('note-text', 'Half a thought'); await app.tick(5);
  await more(app, busyList());
  assert.strictEqual(app.el('note-text').value, 'Half a thought');
  await reread(app);
  assert.strictEqual(app.el('note-text').value, 'Half a thought');
  app.input('note-text', ''); await app.tick(5);
});

rule('Notes: two notes sharing an id, both older than the newest 20, are two search hits that each reveal their own text', async () => {
  const app = await bigApp();
  app.click('nav', 'home'); await app.tick(5);
  const hits = (await search(app, 'twin note')).filter(x => /:twin-note#/.test(x));
  assert.strictEqual(hits.length, 2, hits.join(', '));
  for (const [hit, key, text] of [[hits.find(x => /#1$/.test(x)), 'twin-note', 'The first twin note'], [hits.find(x => /#2$/.test(x)), 'twin-note#2', 'The second twin note']]) {
    app.click('nav', 'home'); await app.tick(5);
    await search(app, 'twin note');
    app.click('sx-open', hit); await app.tick(20);
    const h = app.html();
    assert.strictEqual(app.activeId(), 'tn-s0-' + key);
    assert.ok(liText(h, 'tn-s0-' + key).indexOf(text) >= 0, 'its own text');
    assert.ok(thread(h, 's0').length <= 21);
    assert.strictEqual(count(h, /The (first|second) twin note/g), 1, 'and not the other one');
  }
});

rule('Notes: a revealed note is found again by its content after a newer read adds an older note with its id; deleted, the slot says so', async () => {
  const app = await fresh();
  app.click('nav', 'home'); await app.tick(5);
  const hit = (await search(app, 'twin note')).find(x => /:twin-note#2$/.test(x));
  app.click('sx-open', hit); await app.tick(20);
  assert.ok(liText(app.html(), 'tn-s0-twin-note#2').indexOf('The second twin note') >= 0);
  const p = notesFile(app), all = lines(app, p);
  const older = { id: 'twin-note', at: '2000-01-01T00:00:00.000Z', by: 'person-blake', session: 'busy-s1', step: 's0', text: 'An older note with the same id' };
  await rewrite(app, p, [older].concat(all));
  let h = app.html(), t = thread(h, 's0');
  assert.ok(t.indexOf('twin-note#3') >= 0, 'now third with that id: ' + t.slice(0, 3).join(', '));
  assert.ok(liText(h, 'tn-s0-twin-note#3').indexOf('The second twin note') >= 0, 'still the note revealed');
  assert.ok(!/An older note with the same id/.test(h) && !/The first twin note/.test(h), 'never another in its place');
  assert.ok(t.length <= 21);
  await rewrite(app, p, [older].concat(all.filter(n => n.text !== 'The second twin note')));
  h = app.html(); t = thread(h, 's0');
  assert.ok(/That note isn&#39;t in this run anymore|That note isn't in this run anymore/.test(h), 'the line says it\'s gone');
  assert.ok(!/From earlier/.test(h) && t.length === 20, 'and the slot is empty: ' + t.length);
});

rule('Notes: focus on a revealed twin follows the note, not its place, through a newer read that inserts, deletes or reorders notes sharing its id', async () => {
  const app = await fresh();
  const p = notesFile(app), all = lines(app, p), second = 'The second twin note';
  const older = { id: 'twin-note', at: '2000-01-01T00:00:00.000Z', by: 'person-blake', session: 'busy-s1', step: 's0', text: 'An older note with the same id' };
  const open = async () => {
    app.click('nav', 'home'); await app.tick(5);
    const hit = (await search(app, 'twin note')).find(x => /:twin-note#2$/.test(x));
    app.click('sx-open', hit); await app.tick(20);
    assert.strictEqual(app.activeId(), 'tn-s0-twin-note#2', 'set-up: the second twin focused');
  };
  const on = (id, what) => { assert.strictEqual(app.activeId(), id, what); assert.ok(liText(app.html(), id).indexOf(second) >= 0, what + ': on the second twin\'s own text'); };
  await open();
  /* Inserted: an older twin arrives, so the revealed one is now third with that id. */
  await arrive(app, p, [older].concat(all));
  on('tn-s0-twin-note#3', 'an older twin inserted');
  /* Deleted: the other twins go, so it's the only one with that id. */
  await arrive(app, p, all.filter(n => n.text !== 'The first twin note'));
  on('tn-s0-twin-note', 'the other twins deleted');
  /* Reordered: the first twin's time moves after it, so it's first with that id. */
  await arrive(app, p, all); await open();
  await arrive(app, p, all.map(n => n.text === 'The first twin note' ? Object.assign({}, n, { at: new Date(Date.parse(n.at) + 6 * 60000).toISOString() }) : n));
  on('tn-s0-twin-note', 'the twins reordered');
  /* The revealed note itself deleted: focus goes to the step's heading, never onto another note. */
  await arrive(app, p, all); await open();
  await arrive(app, p, all.filter(n => n.text !== second));
  assert.strictEqual(app.activeId(), 'ins-h', 'the revealed note deleted');
});

rule('Notes: focus on a correction twin in the inspector follows its note through a newer read that inserts an older twin', async () => {
  const app = await fresh();
  const p = notesFile(app), all = lines(app, p), first = all.find(n => n.id === 'twin-corr');
  app.click('nav', 'home'); await app.tick(5);
  const hit = (await search(app, 'second twin correction')).find(x => /:twin-corr#2$/.test(x));
  assert.ok(hit, 'set-up: the second twin correction');
  app.click('sx-open', hit); await app.tick(20);
  assert.strictEqual(app.activeId(), 'corr-twin-corr-2', 'set-up: focused');
  const older = Object.assign({}, first, { at: '2000-01-01T00:00:00.000Z', change: { op: 'wording', to: 'An older twin correction' }, text: 'An older twin correction' });
  await arrive(app, p, [older].concat(all));
  assert.strictEqual(app.activeId(), 'corr-twin-corr-3', 'focus follows it to its new place');
  assert.ok(liText(app.html(), 'corr-twin-corr-3').indexOf('The second twin correction') >= 0, 'on its own text');
});

rule('Notes: a note saved while 25 notes are an hour ahead is drawn after the refresh, under From earlier, in time order', async () => {
  const app = await fresh();
  /* 25 notes an hour ahead of this computer's clock, as a teammate's fast clock writes them. */
  const p = notesFile(app), ahead = Array.from({ length: 25 }, (x, i) => ({ id: 'fast' + i, at: new Date(Date.now() + 3600000 + i * 60000).toISOString(), by: 'person-blake', session: 'busy-s1', step: 's0', text: 'From a fast clock ' + i }));
  await rewrite(app, p, lines(app, p).concat(ahead));
  await openRun(app, 'busy', 's0');
  app.input('note-text', 'Saved behind the clock'); await app.tick(5);
  app.click('add-note', 's0'); await app.tick(120);
  const h = app.html(), t = thread(h, 's0');
  const mine = lines(app, Object.keys(app.fs.files).filter(f => /notes-/.test(f) && f.indexOf(fixture().facts.busy) >= 0).find(f => /Saved behind the clock/.test(app.fs.files[f].t))).find(n => n.text === 'Saved behind the clock');
  assert.ok(mine, 'saved');
  assert.ok(t.indexOf(mine.id) >= 0, 'drawn: ' + t.slice(0, 3).join(', '));
  assert.ok(t.length <= 21, 'with at most 21');
  assert.strictEqual(t.indexOf(mine.id), 0, 'before the newest 20, as its time sorts it');
  assert.ok(/From earlier/.test(h));
  assert.ok(app.asked().some(s => s.indexOf('tn-s0-' + mine.id) >= 0), 'brought into view');
});

/* ---------- notes sharing an id, in a small folder ---------- */
async function small() {
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const r = app.run(), dir = r.path.replace(/run\.json$/, '');
  return { app, key: r.key, dir };
}
const fix = (fixKind, o) => Object.assign({ id: 'fixtwin1', at: '2026-01-01T10:00:00.000Z', by: 'person-blake', session: 'other', step: 'flags', text: 'The flag step trips people up', kind: 'fix', fixKind, target: { phase: '', step: 'flags' }, version: 1 }, o || {});
async function withFixes(list) {
  const s = await small();
  await s.app.fs.write(s.dir + 'notes-other.jsonl', list.map(x => JSON.stringify(x)).join('\n') + '\n');
  await reread(s.app); return s;
}
const corrRows = h => ids(h.slice(h.indexOf('rw-corr')), /<li class="corr" id="(corr-[^"]+)"/g);

rule('Fix notes sharing id, time, author and text but not their kind: each search hit reveals its own meaning', async () => {
  const { app } = await withFixes([fix('missing'), fix('instructions')]);
  const hits = (await search(app, 'flag step trips')).filter(x => /fixtwin1#/.test(x));
  assert.strictEqual(hits.length, 2, hits.join(', '));
  for (const [hit, row, word] of [[hits.find(x => /#1$/.test(x)), 'corr-fixtwin1', 'A step is missing'], [hits.find(x => /#2$/.test(x)), 'corr-fixtwin1-2', 'The instructions are wrong']]) {
    app.click('nav', 'home'); await app.tick(5); await search(app, 'flag step trips');
    app.click('sx-open', hit); await app.tick(20);
    assert.strictEqual(app.activeId(), row);
    assert.ok(liText(app.html(), row).indexOf(word) >= 0, row + ' says ' + word);
  }
});

rule('Fix notes sharing everything but their kind: the revealed one deleted by a newer read selects nothing', async () => {
  const s = await withFixes([fix('missing'), fix('instructions')]), app = s.app;
  const hit = (await search(app, 'flag step trips')).find(x => /fixtwin1#2$/.test(x));
  app.click('sx-open', hit); await app.tick(20);
  assert.strictEqual(app.activeId(), 'corr-fixtwin1-2');
  await app.fs.write(s.dir + 'notes-other.jsonl', JSON.stringify(fix('missing')) + '\n'); await reread(app);
  const h = app.html();
  assert.deepStrictEqual(corrRows(h).filter(x => /fixtwin1/.test(x)), ['corr-fixtwin1'], 'the other one is still there');
  assert.ok(!/Shown because you opened it/.test(h), 'but it isn\'t shown as the one opened');
  assert.ok(/That note isn&#39;t in this run anymore|That note isn't in this run anymore/.test(h));
});

rule('Notes identical in every field: one deleted after the reveal selects nothing', async () => {
  const s = await withFixes([fix('missing'), fix('missing')]), app = s.app;
  const hit = (await search(app, 'flag step trips')).find(x => /fixtwin1#2$/.test(x));
  app.click('sx-open', hit); await app.tick(20);
  assert.strictEqual(app.activeId(), 'corr-fixtwin1-2');
  const nf = app.PF.search.noteFind, notes = app.PF.store ? null : null;
  await app.fs.write(s.dir + 'notes-other.jsonl', JSON.stringify(fix('missing')) + '\n'); await reread(app);
  assert.ok(!/Shown because you opened it/.test(app.html()), 'not the survivor: there were two like it when it was opened');
  assert.ok(nf, 'PF.search.noteFind');
});

rule('With the palette open on two fix notes sharing an id, a newer read that removes the first rebuilds the survivor\'s result: it opens the survivor', async () => {
  const s = await withFixes([fix('missing'), fix('instructions')]), app = s.app;
  let hits = (await search(app, 'flag step trips')).filter(x => /fixtwin1#/.test(x));
  assert.strictEqual(hits.length, 2);
  await app.fs.write(s.dir + 'notes-other.jsonl', JSON.stringify(fix('instructions')) + '\n'); await reread(app);
  sxBox(app); app.input('sx-q', 'flag step trips '); await app.tick(400);
  hits = ids(app.overlay(), /role="option"[^>]*data-id="([^"]+)"/g).filter(x => /fixtwin1#/.test(x));
  assert.deepStrictEqual(hits.map(x => x.replace(/^.*#/, '#')), ['#1'], 'the removed one is no longer a result');
  app.click('sx-open', hits[0]); await app.tick(20);
  assert.strictEqual(app.activeId(), 'corr-fixtwin1', 'the survivor is revealed');
  const h = app.html();
  assert.ok(liText(h, 'corr-fixtwin1').indexOf('The instructions are wrong') >= 0, 'with its own meaning');
  assert.ok(/Shown because you opened it/.test(h) || corrRows(h).indexOf('corr-fixtwin1') >= 0);
  assert.ok(!/That note isn/.test(h), 'nothing says it\'s gone');
});

rule('With the palette open on two fix notes sharing an id, a newer read that reorders them gives each result its new note', async () => {
  const s = await withFixes([fix('missing'), fix('instructions')]), app = s.app;
  await search(app, 'flag step trips');
  await app.fs.write(s.dir + 'notes-other.jsonl', [fix('instructions'), fix('missing')].map(x => JSON.stringify(x)).join('\n') + '\n'); await reread(app);
  sxBox(app); app.input('sx-q', 'flag step trips '); await app.tick(400);
  const hits = ids(app.overlay(), /role="option"[^>]*data-id="([^"]+)"/g).filter(x => /fixtwin1#/.test(x));
  assert.strictEqual(hits.length, 2);
  app.click('sx-open', hits.find(x => /#1$/.test(x))); await app.tick(20);
  assert.strictEqual(app.activeId(), 'corr-fixtwin1');
  assert.ok(liText(app.html(), 'corr-fixtwin1').indexOf('The instructions are wrong') >= 0, 'the first is now the instructions one');
});

rule('Search: a note source\'s signature holds its whole content, so a twin differing only in fixKind is a new signature', () => {
  const { load } = require('./harness'), PF = load();
  const S = PF.search, a = { id: 'x', at: 't', by: 'b', step: 's', text: 'same', kind: 'fix', fixKind: 'missing', target: { phase: '', step: 's' } };
  const b = Object.assign({}, a, { fixKind: 'instructions' }), r = n => ({ process: 'p', id: 'r', title: 'R', _notes: n, steps: {} });
  const sig = list => S.docs({ runs: [r(list)] }).filter(d => /^note:/.test(d.id)).map(d => d.id + ' ' + d.sig);
  assert.notDeepStrictEqual(sig([a]), sig([b]), 'the kind is in the signature');
  assert.ok(S.noteAnchor(a) !== S.noteAnchor(b));
  assert.strictEqual(S.noteAnchor({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}', 'keys sorted, missing fields left out');
  const t = S.noteTarget('p/r', b, [a, b]);
  assert.deepStrictEqual([t.note, t.noteAt, t.same, t.rank], ['x', 2, 1, 0]);
  assert.strictEqual(S.noteFind([b], t).k, 1, 'found by its content where it now is');
  assert.strictEqual(S.noteFind([a], t), null, 'never another in its place');
  const c = Object.assign({}, a), t2 = S.noteTarget('p/r', c, [a, c]);
  assert.strictEqual(S.noteFind([a, c], t2).k, 2, 'twins identical in every field: the hint, while there are as many');
  assert.strictEqual(S.noteFind([a], t2), null, 'one gone: none');
});

/* ---------- folder health, the legacy runs line, duplicate drafts, a report's differing copies ---------- */
rule('Folder health: 1,000 issues draw 50 a section, building only those, and Show more focuses the first one it adds', async () => {
  const app = await bigApp();
  app.click('nav', 'settings'); await app.tick(5);
  const d = await perfDelta(app, ['health.issue'], async () => { app.click('health'); await app.tick(20); });
  const h = app.html();
  assert.ok(count(h, /<li class="hz-issue /g) <= 100, 'at most 50 a section');
  assert.ok(/Needs action · 1,0\d\d/.test(h), 'the heading counts every one');
  assert.ok(d['health.issue'] > 0 && d['health.issue'] <= 100 * 3, 'built only for drawn rows: ' + d['health.issue']);
  const m = await more(app, 'hz-stop', h);
  assert.strictEqual(app.activeId(), m.focus.replace(/^\[id="|"\]$/g, ''));
  assert.ok(/^hz-i-/.test(app.activeId()));
});

rule('Runs: 300 legacy v0.1 runs show 50 names and "and 250 more"; Show more adds 50 and keeps focus on the line', async () => {
  const app = await bigApp();
  app.click('nav', 'runs'); await app.tick(5); app.click('filter', 'all'); await app.tick(5);
  let h = app.html();
  assert.strictEqual(count(h, /Legacy run \d+/g), 50);
  assert.ok(/, and 250 more<\/p>/.test(h));
  await more(app, 'legacy', h);
  h = app.html();
  assert.strictEqual(count(h, /Legacy run \d+/g), 100);
  assert.ok(/, and 200 more<\/p>/.test(h));
  assert.strictEqual(app.activeId(), 'joined-legacy');
});

rule('A checklist with 300 drafts that say its name: one line, and a fold naming them 50 at a time, built only for those', async () => {
  const app = await bigApp();
  app.click('nav', 'processes'); await app.tick(5);
  const d = await perfDelta(app, ['dupes.name'], async () => { app.click('open-process', 'dupes'); await app.tick(10); });
  let h = app.html();
  assert.ok(/<b>30\d drafts say process: dupes<\/b>\. This page shows/.test(h), 'one summary line: ' + (h.match(/<b>\d+ drafts say[^<]*/) || [])[0]);
  assert.ok(d['dupes.name'] <= 50, 'names built: ' + d['dupes.name']);
  app.fire('toggle', { target: { dataset: { disc: 'dupes:dupes' }, open: true } }); app.click('dismiss'); await app.tick(5);
  h = app.html();
  assert.strictEqual(count(h, /<li id="sd-dupes-/g), 50);
  await more(app, 'dupes:dupes', h);
  assert.strictEqual(count(app.html(), /<li id="sd-dupes-/g), 100);
  assert.ok(/^sd-dupes-/.test(app.activeId()));
});

rule('A report with 300 differing copies: one line, and a fold naming them 50 at a time, built only for those', async () => {
  const app = await bigApp(); await openRun(app, 'busy', 's2');
  let h = app.html();
  assert.ok(/30\d copies of this report differ, so none of them can be accepted/.test(h), 'one summary line');
  assert.ok(!/Two copies of this report differ \(/.test(h), 'not the joined reason');
  const key = (h.match(/data-disc="repdiff:([^"]+)"/) || [])[1];
  assert.ok(key);
  /* A redraw an earlier rule scheduled (a flash ending, 1.8 s, then the 250 ms redraw) lands first, not in the count. */
  await new Promise(res => setTimeout(res, 2200)); await app.tick(5);
  const d = await perfDelta(app, ['rep.differ'], async () => { app.fire('toggle', { target: { dataset: { disc: 'repdiff:' + un(key) }, open: true } }); app.click('dismiss'); await app.tick(5); });
  h = app.html();
  assert.ok(d['rep.differ'] <= 50, 'names built: ' + d['rep.differ']);
  assert.strictEqual(count(h, /<li id="repd-/g), 50);
});

rule('A checklist with 30 linked steps that can\'t start their child: one notice, announced once, with the steps 20 at a time', async () => {
  const app = await bigApp();
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'linker'); await app.tick(10);
  let h = app.html();
  assert.ok(/<b>30 linked steps can&#39;t start their child as it is now\.<\/b>|<b>30 linked steps can't start their child as it is now\.<\/b>/.test(h), 'one summary');
  assert.strictEqual(count(h, /New runs can&#39;t start th|New runs can't start th/g), 1, 'said once');
  assert.strictEqual(count(h, /class="notice warn links-broken" role="status"/g), 1);
  app.fire('toggle', { target: { dataset: { disc: 'links-broken:linker' }, open: true } }); app.click('dismiss'); await app.tick(5);
  h = app.html();
  assert.strictEqual(count(h, /<li id="lb-linker-/g), 20);
  await more(app, 'links-broken:linker', h);
  assert.strictEqual(count(app.html(), /<li id="lb-linker-/g), 30);
  assert.strictEqual(app.activeId(), 'lb-linker-lk20');
});

/* ---------- Settings › People ---------- */
const ppNames = h => ids(h, /<b id="pp-[^"]+" tabindex="-1">([^<]+)<\/b>/g);
rule('Settings › People: 500 people draw 50 in name order; Find a person reaches person 480; Show more focuses the first added', async () => {
  const app = await bigApp();
  app.click('nav', 'settings'); await app.tick(5);
  let h = app.html(), names = ppNames(h);
  assert.strictEqual(names.length, 50);
  const N = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  assert.ok(names.every((n, i) => !i || N.compare(names[i - 1], n) <= 0), 'in name order');
  const m = await more(app, 'people', h);
  assert.strictEqual(ppNames(app.html()).length, 100);
  assert.strictEqual('[id="' + app.activeId() + '"]', m.focus);
  await typeFind(app, 'people', 'person 480');
  h = app.html();
  assert.deepStrictEqual(ppNames(h), ['Person 480']);
  assert.ok(/1 of 500 match/.test(h));
  await typeFind(app, 'people', '');
});

rule('Settings › People: the owner confirm on person 401 is kept through Show more and Find', async () => {
  const app = await fresh();
  app.click('nav', 'settings'); await app.tick(5);
  const pid = fixture().facts.people.find(p => p.name === 'Person 401').id;
  app.click('pick', pid, { kind: 'people-owner' }); await app.tick(5);
  let h = app.html();
  assert.ok(/Make Person 401 the folder owner\?/.test(h), 'set-up: the confirm is open' + (/folder owner/.test(h) ? '' : ' (not an owner here)'));
  await typeFind(app, 'people', 'person 12');
  h = app.html();
  assert.ok(/Make Person 401 the folder owner\?/.test(h), 'kept past a Find that leaves it out');
  await typeFind(app, 'people', '');
  await more(app, 'people');
  assert.ok(/Make Person 401 the folder owner\?/.test(app.html()), 'kept through Show more');
});

rule('Settings › People: a person added while "smith" is in Find is drawn as just added; five more leave one, the latest', async () => {
  const app = await fresh();
  app.click('nav', 'settings'); await app.tick(5);
  await typeFind(app, 'people', 'smith');
  const add = async name => { app.input('pa-name', name); await app.tick(5); app.submit('people-add-form'); await app.tick(80); };
  await add('Jordan Added0');
  let h = app.html();
  assert.strictEqual(app.el('find-people').value === undefined ? 'smith' : app.el('find-people').value, 'smith', 'the Find text stays');
  assert.ok(/value="smith"/.test(h));
  assert.ok(/Just added<\/p>/.test(h) && ppNames(h).indexOf('Jordan Added0') >= 0, 'drawn as just added');
  for (let i = 1; i <= 5; i++) await add('Jordan Added' + i);
  h = app.html();
  assert.deepStrictEqual(ppNames(h).filter(n => /Jordan Added/.test(n)), ['Jordan Added5'], 'one exception, the latest');
});

rule('Settings › People: a Find set in folder A doesn\'t filter folder B, and A → B → A without touching it starts A clean', async () => {
  const app = await bigApp();
  app.click('nav', 'settings'); await app.tick(5);
  await typeFind(app, 'people', 'person 47');
  assert.ok(ppNames(app.html()).length < 50);
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  const useFs = src.slice(src.indexOf('function useFs('), src.indexOf('\n  }\n', src.indexOf('function useFs(')));
  assert.ok(!/find|justShown|noteShown/.test(useFs), 'useFs doesn\'t reset Find (the rehearsal gate)');
  /* A folder switch is a new folder generation: renderNow drops what was typed for the folder before. */
  assert.ok(/if \(state\.find && state\.find\.gen !== gen\) state\.find = null;/.test(src));
  assert.ok(/if \(state\.noteShown && state\.noteShown\.gen !== gen\) state\.noteShown = null;/.test(src));
  await typeFind(app, 'people', '');
});

/* ---------- team values ---------- */
rule('Team values: 100 in natural order; value 90, just saved, is drawn and focused', async () => {
  const app = await fresh();
  app.click('nav', 'settings'); await app.tick(5);
  let h = app.html();
  const names = ids(h, /<code id="tvv-([^"]+)" tabindex="-1">/g);
  assert.strictEqual(names.length, 100);
  const N = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  assert.ok(names.every((n, i) => !i || N.compare(names[i - 1], n) <= 0), 'natural order: ' + names.slice(0, 12).join(' '));
  const n90 = names[89];
  app.click('team-edit', n90); await app.tick(5);
  if (!app.el('tv-e-value')) return assert.fail('set-up: the edit form for ' + n90);
  app.input('tv-e-value', 'https://example.com/changed'); await app.tick(5);
  app.submit('team-edit-form'); await app.tick(120);
  h = app.html();
  assert.ok(new RegExp('id="tvv-' + n90 + '"').test(h), 'drawn');
  assert.strictEqual(app.activeId(), 'tvv-' + n90, 'focused');
  assert.ok(app.asked().some(s => s.indexOf('tvv-' + n90) >= 0), 'brought into view');
});

run();
