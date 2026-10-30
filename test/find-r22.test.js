// Find things in big folders (2.11), code review round 22: a note or correction this window just saved is found, as read
// back, by the whole record it was written with (PF.search.noteRead), never by its id, time, author and window alone. A copy
// that shares those four but has other text (and other attachments, or another change) is never taken for it.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { small, fresh, arrive, iso, lines } = require('./find-twins.test');

const MINE = 'Saved behind the clock, round 22';
const key = () => small().facts.landed, dir = () => 'runs/' + key() + '/';
const liText = (h, id) => { const i = h.indexOf('<li id="' + id + '"'); return i < 0 ? null : h.slice(i, h.indexOf('</li>', i)); };
const thread = h => [...h.slice(h.indexOf('id="ins-notes"')).matchAll(/<li id="tn-s0-([^"]+)" tabindex="-1"/g)].map(m => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
const kept = h => { const i = h.indexOf('<p class="small kept-h">From earlier</p>'); return i < 0 ? [] : [...h.slice(i, h.indexOf('</ul>', i)).matchAll(/<li id="tn-s0-([^"]+)"/g)].map(m => m[1]); };
const gone = h => /That note isn(&#39;|')t in this run anymore/.test(h);
const noteFile = app => app.files(dir()).filter(f => /notes-/.test(f)).find(f => app.fs.files[f].t.indexOf(MINE) >= 0);
async function openLanded(app) { app.click('nav', 'home'); await app.tick(5); app.click('open-run', key()); await app.tick(10); app.click('select', 's0'); await app.tick(10); }
/* The copies' files. The first is made (empty) before the save, so a read takes it before this window's own notes file and
   has a copy ahead of the saved note (same time) as well as one behind it. */
const TWIN_FILES = ['notes-0tw.jsonl', 'notes-ztw.jsonl'];

/* Copies land in the folder with the save itself, written right after this window's own line, so no read ever has the
   saved note without them. match: text only the saved line has; make(note as written) → [[file, notes]]. */
function landWith(app, match, make) {
  const fs = app.fs, was = fs.append;
  fs.append = function (path, text) {
    return was.call(this, path, text).then(r => {
      if (text.indexOf(match) < 0) return r;
      fs.append = was;
      const n = JSON.parse(text.trim().split('\n').pop());
      return Promise.all(make(n).map(([f, list]) => fs.write(dir() + f, list.map(x => JSON.stringify(x)).join('\n') + '\n'))).then(() => { app.landed = true; return r; });
    });
  };
}
/* The landed run's step s0 with 25 notes an hour ahead (they sort after a note saved here, so it is drawn under From
   earlier), then a note saved here; with, the copies that land with it. */
async function saved(withCopies) {
  const app = await fresh(), now = Date.now();
  const ahead = Array.from({ length: 25 }, (x, i) => ({ id: 'fast' + i, at: iso(now + 3600000 + i * 60000), by: 'person-blake', session: 'r22', step: 's0', text: 'From a fast clock ' + i }));
  await arrive(app, [[dir() + 'notes-r22.jsonl', ahead], [dir() + TWIN_FILES[0], []]]);
  await openLanded(app);
  app.input('note-text', MINE); await app.tick(5);
  if (withCopies) landWith(app, MINE, withCopies);
  app.click('add-note', 's0'); await app.tick(120);
  const mine = lines(app, noteFile(app)).find(n => n.text === MINE);
  assert.ok(mine, 'set-up: saved');
  if (withCopies) assert.ok(app.landed, 'set-up: the copies landed with it');
  return { app, mine };
}
/* A copy of the saved note with its id, time, author and window, but other text and an attachment it doesn't have. */
const noteTwin = (mine, i) => Object.assign({}, mine, { text: 'A copy with other text ' + i, files: [dir() + 'files/1-abc-tw-copy' + i + '.txt'], fileInfo: { [dir() + 'files/1-abc-tw-copy' + i + '.txt']: { name: 'copy' + i + '.txt', size: 3 } } });
/* The saved note is drawn once, as itself, under From earlier, and nothing says it's gone; no copy is kept in its place. */
function savedOn(app, what) {
  const h = app.html(), t = thread(h), rows = t.filter(k => (liText(h, 'tn-s0-' + k) || '').indexOf(MINE) >= 0);
  assert.strictEqual(rows.length, 1, what + ': the saved note is drawn, once: ' + t.slice(0, 4).join(', '));
  assert.deepStrictEqual(kept(h), [rows[0]], what + ': it alone is under From earlier: ' + kept(h).join(', '));
  assert.ok(!/A copy with other text/.test(h), what + ': no copy is drawn in its place');
  assert.ok(!gone(h), what + ': nothing says it\'s gone');
}

const noteCopies = mine => TWIN_FILES.map((f, i) => [f, [noteTwin(mine, i)]]);
async function notesCase(before) {
  const { app, mine } = await saved(before ? noteCopies : null);
  const what = before ? 'copies landed with the save' : 'copies arriving after a read found it';
  if (!before) { assert.deepStrictEqual(kept(app.html()), [mine.id], 'set-up: kept under From earlier'); await arrive(app, noteCopies(mine).map(([f, l]) => [dir() + f, l])); }
  savedOn(app, what);
  await arrive(app, []);
  savedOn(app, what + ', read again');
  /* Each copy removed: the saved note stays drawn, and nothing says it's gone. */
  await arrive(app, [[dir() + TWIN_FILES[0], null]]);
  savedOn(app, what + ', the first copy removed');
  await arrive(app, [[dir() + TWIN_FILES[1], null]]);
  savedOn(app, what + ', both copies removed');
  /* The saved note removed (copies back): the thread says it's gone, and no copy is kept in its place. */
  await arrive(app, noteCopies(mine).map(([f, l]) => [dir() + f, l]).concat([[noteFile(app), []]]));
  const h = app.html();
  assert.ok(gone(h), what + ', the saved note removed: the line says it\'s gone');
  assert.deepStrictEqual(kept(h), [], what + ', the saved note removed: nothing kept in its place');
}

rule('Round 22: a note saved behind the clock lands with copies that share its id, time, author and window but have other text and attachments: the saved note is the one drawn and kept, a copy removed says nothing, the note removed says it\'s gone', () => notesCase(true));
rule('Round 22: the same, the copies arriving after a read found the saved note', () => notesCase(false));

rule('Round 22: a saved note lands with an identical copy: one of the two is drawn and kept, by its place among them, as noteFind holds identical notes, and stays so on the next read', async () => {
  const { app } = await saved(mine => [[TWIN_FILES[0], [mine]]]);
  for (const what of ['the first read', 'read again']) {
    if (what !== 'the first read') await arrive(app, []);
    const h = app.html(), rows = thread(h).filter(k => (liText(h, 'tn-s0-' + k) || '').indexOf(MINE) >= 0);
    assert.strictEqual(rows.length, 1, what + ': one of the identical copies is drawn: ' + rows.join(', '));
    assert.deepStrictEqual(kept(h), [rows[0]], what + ': kept under From earlier');
    assert.ok(!gone(h), what + ': nothing says it\'s gone');
  }
});

/* ---------- a correction just saved ---------- */
async function corrSaved(withCopies) {
  const app = await fresh(), rj = JSON.parse(app.fs.files[dir() + 'run.json'].t), map = app.PF.run.mapOf(rj), C = app.PF.corrections, t0 = Date.parse(rj.created);
  const mk = (cid, at, to, why) => C.build({ id: cid, at: iso(at), by: 'person-blake', session: 'other', map, version: +rj.version, folder: rj.folder, step: 's0', op: 'wording', to, why });
  await arrive(app, [[dir() + 'notes-pre.jsonl', Array.from({ length: 25 }, (x, i) => mk('pre' + i, t0 + 60000 + i * 1000, 'Pre worded ' + i, 'Pre reason ' + i))], [dir() + TWIN_FILES[0], []]]);
  await openLanded(app);
  app.click('corr-open', 's0', { mode: 'correct' }); await app.tick();
  app.input('corr-to', 'My own wording'); app.input('corr-why', 'Saved past the page');
  if (withCopies) landWith(app, 'Saved past the page', withCopies);
  app.click('corr-save', 's0'); await app.tick(120);
  const file = app.files(dir()).filter(f => /notes-/.test(f) && TWIN_FILES.every(t => f !== dir() + t)).find(f => lines(app, f).some(n => n.kind === 'correction' && n.why === 'Saved past the page'));
  const mine = lines(app, file).find(n => n.kind === 'correction' && n.why === 'Saved past the page');
  assert.ok(mine, 'set-up: saved');
  if (withCopies) assert.ok(app.landed, 'set-up: the copies landed with it');
  return { app, mine, file };
}
/* A copy of the saved correction with its id, time, author and window, but another change, reason and an attachment. */
const corrTwin = (mine, i) => Object.assign({}, mine, { change: { op: 'wording', to: 'Copy wording ' + i }, why: 'Copy reason ' + i, text: 'Should say: "Copy wording ' + i + '"', files: [dir() + 'files/1-abc-tw-copy' + i + '.txt'] });
const corrRows = h => [...h.slice(h.indexOf('id="ins-corr"')).matchAll(/<li class="corr" id="(corr-[^"]+)"[^]*?<\/li>/g)].map(m => ({ id: m[1], html: m[0] }));
function corrOn(app, mine, what) {
  const h = app.html(), rows = corrRows(h), own = rows.filter(r => r.html.indexOf('My own wording') >= 0);
  assert.strictEqual(own.length, 1, what + ': the saved correction is drawn, once: ' + rows.slice(-3).map(r => r.id).join(', '));
  assert.ok(!rows.some(r => /Copy wording/.test(r.html)), what + ': no copy is drawn in its place');
  assert.ok(/plus the one you just added/.test(h), what + ': said as the one just added');
}

const corrCopies = mine => TWIN_FILES.map((f, i) => [f, [corrTwin(mine, i)]]);
async function corrCase(before) {
  const { app, mine, file } = await corrSaved(before ? corrCopies : null);
  const what = before ? 'copies landed with the save' : 'copies arriving after a read found it';
  app.doc.activeElement = app.doc.body;
  if (!before) await arrive(app, corrCopies(mine).map(([f, l]) => [dir() + f, l]));
  corrOn(app, mine, what);
  await arrive(app, []);
  corrOn(app, mine, what + ', read again');
  await arrive(app, [[dir() + TWIN_FILES[0], null]]);
  corrOn(app, mine, what + ', the first copy removed');
  await arrive(app, [[dir() + TWIN_FILES[1], null]]);
  corrOn(app, mine, what + ', both copies removed');
  /* The saved correction removed (copies back): nothing is shown as just added, and no copy in its place. */
  await arrive(app, corrCopies(mine).map(([f, l]) => [dir() + f, l]).concat([[file, lines(app, file).filter(n => n.why !== 'Saved past the page')]]));
  const h = app.html(), rows = corrRows(h);
  assert.ok(!rows.some(r => r.html.indexOf('My own wording') >= 0), what + ', removed: not drawn');
  assert.ok(!/plus the one you just added/.test(h), what + ', removed: nothing said as just added');
  assert.ok(!rows.some(r => /Copy wording/.test(r.html)), what + ', removed: no copy drawn in its place');
}

rule('Round 22: a correction saved past the page lands with copies that share its id, time, author and window but have another change, reason and attachment: the saved one is drawn as just added, a copy removed changes nothing, the correction removed leaves nothing as just added', () => corrCase(true));
rule('Round 22: the same, the copies arriving after a read found the saved correction', () => corrCase(false));

/* ---------- the record read back ---------- */
rule('Round 22: a note and a correction as noteRead says a read gives them back are exactly what the run\'s reader gives back, attachment names it cleans and files outside the run left out included', async () => {
  const { app, mine } = await saved(null), S = app.PF.search, base = dir(), [proc, id] = key().split('/');
  const file = base + 'files/1-abc-w-My-photo-1.png';
  const odd = { files: [file, 'elsewhere/x.png'], fileInfo: { [file]: { name: 'My photo (1).png', size: 10.7, extra: 1 } } };
  const { mine: corr } = await corrSaved(null);
  const raws = [Object.assign({}, mine, odd, { id: 'rb-note', text: 'With an odd file name' }), Object.assign({}, corr, odd, { id: 'rb-corr', session: 'w'.repeat(50) })];
  await app.fs.write(base + 'notes-rb.jsonl', raws.map(x => JSON.stringify(x)).join('\n') + '\n');
  const r = await app.PF.repo.loadRun(app.fs, proc, id, null, true);
  raws.forEach(raw => {
    const read = r._notes.filter(n => n.id === raw.id);
    assert.strictEqual(read.length, 1, raw.id + ': read back once');
    assert.strictEqual(S.noteAnchor(S.noteRead(raw, base)), S.noteAnchor(read[0]), raw.id + ': the same whole record');
  });
});

run();
