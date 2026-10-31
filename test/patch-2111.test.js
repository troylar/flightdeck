// 2.11.1: names and notes from the folder are taken as they are.
// An id from a file can be a name every plain object already has (constructor, toString, hasOwnProperty, __proto__): a running
// run with one stopped the app reading the whole folder. Two notes can share an id in a run (twins): a screenshot's or a file's
// button is on one of them, and opens that one. A process can be named as the linked checklist's Other ID… choice.
'use strict';
const assert = require('assert');
const { rule, run, load } = require('./harness');
const cp = require('child_process'), path = require('path'), fsN = require('fs'), os = require('os');
const { boot, gate, folderHandle, memoryIDB } = require('./app-harness');
const { into } = require('./bounds-fixture');
const { small, fresh, arrive } = require('./find-twins.test');

const NAMES = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];
const MINUTE = 60000, un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/* Anything the app throws outside a click (a read that fails after it is accepted) ends up here. */
async function noThrow(fn) {
  const seen = [], on = e => seen.push(e && e.stack || String(e));
  process.on('unhandledRejection', on);
  try { const out = await fn(); await new Promise(r => setTimeout(r, 5)); assert.deepStrictEqual(seen, [], 'nothing thrown outside a click'); return out; } finally { process.removeListener('unhandledRejection', on); }
}
/* The landed run of the small folder, moved to the run id named, with its run file changed by edit. */
function moved(fx, id, edit) {
  const files = Object.assign({}, fx.files), key = fx.facts.landed, proc = key.split('/')[0], from = 'runs/' + key + '/';
  Object.keys(files).filter(f => f.indexOf(from) === 0).forEach(f => {
    let text = files[f];
    if (/run\.json$/.test(f)) { const o = JSON.parse(text); o.id = id; if (edit) edit(o); text = JSON.stringify(o, null, 2) + '\n'; }
    files['runs/' + proc + '/' + id + '/' + f.slice(from.length)] = text; delete files[f];
  });
  return { files, facts: fx.facts, key: proc + '/' + id };
}

/* ---------- a run, a person or a process named like Object.prototype ---------- */
for (const id of NAMES.concat(['valueOf'])) {
  rule('A running run with the id ' + id + ' reads with the rest of the folder, and again on the next read', () => noThrow(async () => {
    const fx = moved(small(), id), app = await fresh(fx);
    await arrive(app, []);
    app.click('nav', 'runs'); await app.tick(10);
    const h = app.html();
    assert.ok(/Running 0/.test(h), 'the rest of the folder is listed');
    assert.ok(!/native code/.test(h), 'nothing inherited is drawn');
    /* __proto__ isn't a run id a run file can have (letters, numbers and dashes): it's listed as unread, never read as a run. */
    if (id === '__proto__') { assert.ok(!app.fs.files['runs/' + fx.key + '/run.json'] || !h.includes('data-id="' + fx.key + '"'), 'not read as a run'); return; }
    assert.ok(h.includes('On the landed version'), 'the run itself is listed');
  }));
}
rule('A run named constructor: the recorder records in it, the change lands, and a failed save can be discarded', () => noThrow(async () => {
  const fx = moved(small(), 'constructor', o => { o.recorder = { person: 'person-avery', session: null }; }), app = await fresh(fx);
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', fx.key); await app.tick(10);
  app.click('pickup'); await app.tick(40);
  app.click('select', 's0'); await app.tick(5); app.click('toggle', 's0'); await app.tick(60);
  const file = () => JSON.parse(app.fs.files['runs/' + fx.key + '/run.json'].t);
  assert.strictEqual(file().steps.s0.s, 'done', 'saved');
  assert.ok(!/isn(&#39;|')t saved/.test(app.html()), 'nothing is called unsaved');
  /* A save that fails is unsaved, and only then: Discard goes back to what was saved. */
  const save = app.PF.repo.saveRun; app.PF.repo.saveRun = () => Promise.reject(new Error('OneDrive is offline'));
  app.click('select', 's1'); await app.tick(5); app.click('toggle', 's1'); await app.tick(60);
  app.PF.repo.saveRun = save;
  assert.ok(/Your last change isn(&#39;|')t saved/.test(app.html()), 'the failed save is said');
  app.click('discard-unsaved'); await app.tick(60);
  assert.ok(!/isn(&#39;|')t saved/.test(app.html()), 'discarded');
  assert.ok(!file().steps.s1, 'the failed change isn\'t in the file');
  /* The run in memory is back too, as a later save shows: the discarded answer doesn't come back with it. */
  const state = id => (new RegExp('<li class="step[^"]*" data-a="([\\w-]+)" id="step-' + id + '">').exec(app.html()) || [])[1];
  assert.notStrictEqual(state('s1'), 'done', 'on screen, the discarded answer is gone');
  const was = file().steps.s0;
  app.click('select', 's0'); await app.tick(5); app.click('toggle', 's0'); await app.tick(60);
  assert.notDeepStrictEqual(file().steps.s0, was, 'set-up: the next change is saved');
  assert.ok(!file().steps.s1, 'and the discarded answer isn\'t saved with it');
}));
rule('A person named like Object.prototype is shown by their id, never as Object', () => noThrow(async () => {
  for (const who of ['constructor', 'toString']) {
    const fx = moved(small(), 'named-run', o => { o.recorder = { person: who, session: null }; o.roles = { lead: who }; }), app = await fresh(fx);
    app.click('nav', 'home'); await app.tick(5); app.click('open-run', fx.key); await app.tick(10);
    const h = app.html();
    assert.ok(!/native code/.test(h) && !/undefined/.test(h.slice(h.indexOf('class="avatar'), h.indexOf('class="avatar') + 200)), who + ': nothing inherited is drawn');
    assert.ok(new RegExp('Waiting for <b>' + who + '</b>').test(h), who + ': said by their id');
  }
}));
/* A checklist named constructor, with a run, published as the app publishes. */
function constructorFolder(md) {
  const PF = load(), fx = small(), files = Object.assign({}, fx.files), now = new Date(Date.now() - 3600000).toISOString();
  const b = PF.publish.build(md, { people: fx.facts.people, by: 'person-avery', changes: 'First', existing: [], now, rand: 'abcd1234' });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  Object.keys(b.files).forEach(f => { files['publications/constructor/' + b.folder + '/' + f] = b.files[f]; });
  return { files, facts: fx.facts };
}
const procMd = extra => '---\nprocess: constructor\ntitle: Named constructor\ncategory: Synthetic\ngroup: Busy\nowner: person-avery\nroles: lead\n' + (extra || '') + '---\n\n## One · READ-DO {#ph1}\n- [ ] {confirm} Do it @lead {#s1}\n';
rule('A checklist named constructor: its start form says on my own or with others, not an inherited value', () => noThrow(async () => {
  const app = await fresh(constructorFolder(procMd('runs: solo\n')));
  app.click('nav', 'processes'); await app.tick(8); app.click('open-process', 'constructor'); await app.tick(10); app.click('start', 'constructor'); await app.tick(10);
  assert.strictEqual(/id="start-mode" value="([^"]*)"/.exec(app.html())[1], 'solo', 'the checklist suggests running it solo');
}));
rule('A checklist named constructor: How runs go and its folder picker read', () => noThrow(async () => {
  const app = await fresh(constructorFolder(procMd()));
  app.click('nav', 'processes'); await app.tick(8); app.click('open-process', 'constructor'); await app.tick(10); app.click('ptab', 'insights'); await app.tick(10);
  assert.ok(!/native code/.test(app.html()), 'nothing inherited is drawn');
}));
rule('A hand-edited run whose checklist has a step named constructor is read-only, and nothing writes onto what a plain object inherits', () => noThrow(async () => {
  const fx = moved(small(), 'edited', o => { o.recorder = { person: 'person-avery', session: null }; o.snapshot = o.snapshot.replace('{#s0}', '{#constructor}'); }), app = await fresh(fx);
  const r = app.PF.run.sanitize(JSON.parse(app.fs.files['runs/' + fx.key + '/run.json'].t));
  assert.ok(/keeps that name for itself/.test(r._unrunnable), 'said why: ' + r._unrunnable);
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', fx.key); await app.tick(10);
  assert.ok(/Read-only in this copy/.test(app.html()), 'said on the run');
  assert.ok(!/native code/.test(app.html()), 'nothing inherited is drawn');
}));
rule('Publishing still refuses a step named constructor, and a checklist with none is untouched', () => {
  const PF = load(), P = PF.publish, md = '---\nprocess: plain\ntitle: Plain\ncategory: S\nowner: person-avery\nroles: lead\n---\n\n## One · READ-DO {#ph1}\n- [ ] {confirm} Do it @lead {#s1}\n';
  assert.strictEqual(P.unrunnable(md, {}), '');
  const b = P.build(md.replace('{#s1}', '{#constructor}'), { people: [{ id: 'person-avery', name: 'Avery' }], by: 'person-avery', changes: 'x', existing: [], now: new Date().toISOString(), rand: 'abcd1234' });
  assert.ok(b.blockers && b.blockers.length, 'refused');
});
rule('A run file with a step or gate keyed __proto__ doesn\'t set what the run\'s answers inherit', () => {
  const PF = load(), R = PF.run, fx = small(), o = JSON.parse(fx.files['runs/' + fx.facts.landed + '/run.json']);
  o.steps = JSON.parse('{"__proto__":{"s":"done","by":"person-avery","at":"2026-10-30T00:00:00.000Z"}}');
  o.gates = JSON.parse('{"__proto__":{"s":"passed","by":"person-avery","at":"2026-10-30T00:00:00.000Z"}}');
  const r = R.sanitize(o);
  assert.strictEqual(r.steps.s, undefined, 'steps'); assert.strictEqual(r.gates.s, undefined, 'gates');
});

/* ---------- twin notes: a button is on one note ---------- */
const PNG = 'runs/landed/landedrun/files/';
const att = (name, by) => ({ files: [PNG + name], fileInfo: { [PNG + name]: { name, size: 10 } }, by: by || 'person-blake' });
const note = (over) => Object.assign({ id: 'tw1', at: new Date(Date.now() - 2 * MINUTE).toISOString(), by: 'person-blake', session: 'tw', step: 's0', text: 'A note', files: [], fileInfo: {} }, over);
const bytesOf = name => 'bytes of ' + PNG + name;
async function twinFolder(list, edit) {
  const fx = small(), files = Object.assign({}, fx.files), key = fx.facts.landed, rf = 'runs/' + key + '/run.json';
  if (edit) { const o = JSON.parse(files[rf]); edit(o); files[rf] = JSON.stringify(o, null, 2) + '\n'; }
  files['runs/' + key + '/notes-tw.jsonl'] = list.map(n => JSON.stringify(n)).join('\n') + '\n';
  list.forEach(n => (n.files || []).forEach(f => { files[f] = 'bytes of ' + f; }));
  const app = await fresh({ files, facts: fx.facts });
  return { app, key };
}
async function twins(list, edit) {
  const { app, key } = await twinFolder(list, edit);
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', key); await app.tick(10); app.click('select', 's0'); await app.tick(10);
  return app;
}
/* Each attachment button drawn, as the page has it: its action, and every data- attribute. */
function buttons(h, act) {
  return [...h.matchAll(/<button class="(?:thumb|att)"([^>]*)>/g)].map(m => attrs(m[1])).filter(d => !act || d.act === act);
}
function attrs(text) { const d = {}; text.replace(/data-([\w-]+)="([^"]*)"/g, (x, k, v) => { d[k] = un(v); return x; }); return d; }
function press(app, d) { const data = Object.assign({}, d); delete data.act; delete data.id; app.click(d.act, d.id, data); return app.tick(20); }
/* The one file the note a button carries has: what that button must open. */
const ownFile = d => { const m = JSON.parse(d.note).anchor.match(/[\w-]+\.(?:png|log)/); assert.ok(m, 'the button carries a note with a file: ' + d.note); return m[0]; };
/* Which image the open overlay shows, from every image name it says. */
const overlayImages = app => [...new Set(app.overlay().match(/[\w-]+\.png/g) || [])];
/* Presses each button, and says which image opened for each: each must be the file of the note on that button. */
async function eachOpensItsOwn(app, b) {
  const out = [], read = app.fs.blob;
  for (const d of b) {
    /* The caption alone could be another note's image under this note's name: the file read is what it shows. */
    const asked = [];
    app.fs.blob = function (p) { asked.push(p); return read.apply(this, arguments); };
    try { await press(app, d); } finally { app.fs.blob = read; }
    assert.deepStrictEqual(overlayImages(app), [ownFile(d)], 'the button of the note with ' + ownFile(d) + ' opens only that image');
    assert.deepStrictEqual([...new Set(asked)], [PNG + ownFile(d)], 'and reads only that file');
    out.push(ownFile(d));
    app.click('close-overlay'); await app.tick(5);
  }
  return out.sort();
}

rule('Twins: the first has no screenshot and the second has one; the second\'s thumbnail opens it', () => noThrow(async () => {
  const app = await twins([note({ text: 'No picture' }), note(Object.assign({ text: 'With a picture' }, att('second.png')))]);
  const b = buttons(app.html(), 'zoom-note');
  assert.strictEqual(b.length, 1, 'one thumbnail');
  assert.deepStrictEqual(await eachOpensItsOwn(app, b), ['second.png']);
}));
rule('Twins: the first has a screenshot and the second has none; the first\'s thumbnail opens it', () => noThrow(async () => {
  const app = await twins([note(Object.assign({ text: 'With a picture' }, att('first.png'))), note({ text: 'No picture' })]);
  const b = buttons(app.html(), 'zoom-note');
  assert.strictEqual(b.length, 1, 'one thumbnail');
  assert.deepStrictEqual(await eachOpensItsOwn(app, b), ['first.png']);
}));
rule('Twins: both have a screenshot; each thumbnail opens the image of the note it carries, never the other\'s', () => noThrow(async () => {
  const app = await twins([note(Object.assign({ text: 'First picture' }, att('first.png'))), note(Object.assign({ text: 'Second picture' }, att('second.png')))]);
  const b = buttons(app.html(), 'zoom-note');
  assert.strictEqual(b.length, 2, 'two thumbnails');
  assert.deepStrictEqual(await eachOpensItsOwn(app, b), ['first.png', 'second.png']);
}));
/* Presses the file button, then the dialog's Save a copy: the file name and the bytes the browser is handed. */
async function saveCopy(app, d) {
  await press(app, d);
  const m = /<button[^>]*data-act="att-save"[^>]*>/.exec(app.overlay());
  assert.ok(m, 'the dialog has Save a copy');
  const s = attrs(m[0]);
  assert.ok(s.note, 'Save a copy carries the note');
  const was = app.downloads.length;
  await press(app, s);
  assert.strictEqual(app.downloads.length, was + 1, 'one file is handed to the browser');
  const got = app.downloads[was], bytes = await got.blob.text();
  app.click('close-overlay'); await app.tick(5);
  return { name: got.name, bytes };
}
rule('Twins with files: Open and Save a copy read the note\'s own file, its name and its bytes, and a file of no note opens nothing', () => noThrow(async () => {
  const app = await twins([note(Object.assign({ text: 'First file' }, att('first.log'))), note(Object.assign({ text: 'Second file' }, att('second.log')))]);
  const b = buttons(app.html(), 'att-open');
  assert.strictEqual(b.length, 2, 'two file buttons');
  const names = [];
  for (const d of b) {
    const own = ownFile(d);
    app.set('att-text', '');
    await press(app, d);
    assert.strictEqual(app.text('att-text'), bytesOf(own), 'its text opens: ' + own);
    app.click('close-overlay'); await app.tick(5);
    assert.deepStrictEqual(await saveCopy(app, d), { name: own, bytes: bytesOf(own) }, 'Save a copy of ' + own);
    names.push(own);
  }
  assert.deepStrictEqual(names.sort(), ['first.log', 'second.log']);
  app.set('att-text', 'untouched');
  await press(app, Object.assign({}, b[0], { path: PNG + 'not-its-own.log' }));
  assert.strictEqual(app.overlay(), '', 'not a file of that note');
}));
rule('Twins where only the second has a file: Save a copy saves that file', () => noThrow(async () => {
  const app = await twins([note({ text: 'No file' }), note(Object.assign({ text: 'With a file' }, att('second.log')))]);
  const d = buttons(app.html(), 'att-open')[0];
  assert.ok(d, 'the file\'s button');
  assert.deepStrictEqual(await saveCopy(app, d), { name: 'second.log', bytes: bytesOf('second.log') });
}));
rule('Twins identical in every field: each opens, as what they are; one more arriving opens none in its place', () => noThrow(async () => {
  const same = note(Object.assign({ text: 'Same' }, att('same.png')));
  const app = await twins([same, Object.assign({}, same)]);
  const b = buttons(app.html(), 'zoom-note');
  assert.strictEqual(b.length, 2);
  await press(app, b[1]);
  assert.deepStrictEqual(overlayImages(app), ['same.png'], 'the copy opens');
  app.click('close-overlay'); await app.tick(5);
  /* A third copy arrives. A button drawn before it no longer says which copy it's on, so pressing it opens none in its place. */
  await arrive(app, [['runs/' + landedKey + '/notes-tw.jsonl', [same, same, same]]]);
  assert.strictEqual(buttons(app.html(), 'zoom-note').length, 3, 'set-up: the third has arrived');
  await press(app, b[1]);
  assert.strictEqual(app.overlay(), '', 'none opens');
}));
/* Where focus is, as a test reads it: the file of the thumbnail it's on, or the tag of what else has it. */
const focusOn = app => { const a = app.doc.activeElement; return a && a.dataset && /^zoom-/.test(a.dataset.act || '') ? ownFile(a.dataset) : a && a.tagName; };
const pictures = () => [note(Object.assign({ text: 'First picture' }, att('first.png'))), note(Object.assign({ text: 'Second picture' }, att('second.png')))];
const notesFile = 'runs/landed/landedrun/notes-tw.jsonl';
const thumbOf = (h, act, file) => { const d = buttons(h, act).filter(x => ownFile(x) === file)[0]; assert.ok(d, 'the thumbnail of ' + file); return d; };
rule('Closing an image goes back to its own twin\'s thumbnail, as it was, after the notes reorder, and when its note has been paged away', () => noThrow(async () => {
  const [a, c] = pictures(), app = await twins([a, c]);
  for (const file of ['first.png', 'second.png']) {
    await press(app, thumbOf(app.html(), 'zoom-note', file));
    app.click('close-overlay'); await app.tick(5);
    assert.strictEqual(focusOn(app), file, 'closed at once: back on ' + file);
  }
  await press(app, thumbOf(app.html(), 'zoom-note', 'second.png'));
  await arrive(app, [[notesFile, [c, a]]]);
  assert.ok(buttons(app.html(), 'zoom-note')[0].note.includes('second.png'), 'set-up: it has moved up');
  app.click('close-overlay'); await app.tick(5);
  assert.strictEqual(focusOn(app), 'second.png', 'reordered: still its own');
  /* Newer and older notes push it off the thread's page while the image is open: it's brought back to take focus. */
  const fill = (i, ago) => note({ id: 'fill' + ago + i, session: 'tw', at: new Date(Date.now() - ago * MINUTE - i * 1000).toISOString(), text: 'Filler ' + i });
  const many = [...Array(30).keys()];
  await press(app, thumbOf(app.html(), 'zoom-note', 'second.png'));
  await arrive(app, [[notesFile, [...many.map(i => fill(i, 500)), a, c, ...many.map(i => fill(i, 1))]]]);
  assert.ok(!buttons(app.html(), 'zoom-note').some(d => ownFile(d) === 'second.png'), 'set-up: it is off the page');
  app.click('close-overlay'); await app.tick(5);
  assert.strictEqual(focusOn(app), 'second.png', 'paged away: brought back, and focused');
}));
rule('Closing an image whose note has been removed goes to its list\'s heading, never the other twin\'s thumbnail', () => noThrow(async () => {
  const [a, c] = pictures(), app = await twins([a, c]);
  await press(app, thumbOf(app.html(), 'zoom-note', 'second.png'));
  await arrive(app, [[notesFile, [a]]]);
  app.click('close-overlay'); await app.tick(5);
  assert.ok(/^H[1-4]$/.test(focusOn(app)), 'a heading: ' + focusOn(app));
}));

/* ---------- twin corrections: each row says its own group, and acts on it ---------- */
const corrNote = over => note(Object.assign({ kind: 'correction', version: 1, folder: '', target: { phase: '', step: 's0' }, change: { op: 'describe' }, why: 'Why', happened: '' }, over));
/* The twins in two groups: one a problem, one a new wording. */
const twoGroups = () => [
  corrNote({ why: 'First reason', by: 'person-avery', change: { op: 'describe' } }),
  corrNote(Object.assign({ why: 'Second reason', by: 'person-avery', change: { op: 'wording', to: 'Better words' } }, att('corr.png', 'person-avery')))];
const rowsOf = h => [...h.matchAll(/<li class="corr"[\s\S]*?<\/li>/g)].map(m => m[0]);
const rowWith = (h, why) => { const r = rowsOf(h).filter(x => x.includes(why)); assert.strictEqual(r.length, 1, 'one row says ' + why); return r[0]; };
const pillOf = row => { const m = /<span class="pill [^"]*">([^<]*)<\/span>/.exec(row); assert.ok(m, 'a status: ' + row.slice(0, 200)); return un(m[1]); };
const statusOf = (h, why) => pillOf(rowWith(h, why));
async function decide(app, key, gid, member, status, reason) {
  const proc = key.split('/')[0];
  const D = app.PF.corrections.decision({ process: proc, id: gid, members: [{ id: member, by: 'person-avery' }] }, 'person-blake', status, reason || '', new Date().toISOString(), {});
  await arrive(app, [['corrections/' + proc + '/' + gid + '.w-other.1.json', [D]]]);
}
const withdrawOf = row => { const m = /<button[^>]*data-act="corr-withdraw"[^>]*>/.exec(row); return m ? attrs(m[0]) : null; };
const landedKey = 'landed/landedrun';

rule('Twin corrections on the run\'s step: the thumbnail opens its note\'s image, whichever note has it', () => noThrow(async () => {
  const app = await twins(twoGroups());
  const b = buttons(app.html(), 'zoom-corr');
  assert.strictEqual(b.length, 1, 'one thumbnail');
  assert.deepStrictEqual(await eachOpensItsOwn(app, b), ['corr.png']);
}));
rule('Twin corrections with different decisions: each row on the run says its own status, and only the open one offers Withdraw', () => noThrow(async () => {
  const app = await twins(twoGroups());
  let h = app.html();
  assert.strictEqual(statusOf(h, 'First reason'), 'Open'); assert.strictEqual(statusOf(h, 'Second reason'), 'Open');
  const g1 = withdrawOf(rowWith(h, 'First reason')), g2 = withdrawOf(rowWith(h, 'Second reason'));
  assert.ok(g1 && g2 && g1.id !== g2.id, 'each row withdraws its own group');
  await decide(app, landedKey, g1.id, 'tw1', 'declined', 'Not how we work');
  h = app.html();
  assert.strictEqual(statusOf(h, 'First reason'), 'Declined', 'the declined one');
  assert.ok(rowWith(h, 'First reason').includes('Not how we work'), 'with why');
  assert.strictEqual(statusOf(h, 'Second reason'), 'Open', 'the other stays open');
  assert.ok(!rowWith(h, 'Second reason').includes('Not how we work'), 'and isn\'t given its reason');
  assert.strictEqual(withdrawOf(rowWith(h, 'First reason')), null, 'decided: no Withdraw');
  assert.strictEqual(withdrawOf(rowWith(h, 'Second reason')).id, g2.id, 'still its own');
}));
rule('Twin corrections with different decisions on Finish: each row says its own status', () => noThrow(async () => {
  const app = await twins(twoGroups(), o => { o.recorder = { person: 'person-avery', session: null }; });
  app.click('pickup'); await app.tick(60);
  let h = app.html();
  const g1 = withdrawOf(rowWith(h, 'First reason')), g2 = withdrawOf(rowWith(h, 'Second reason'));
  assert.ok(g1 && g2 && g1.id !== g2.id, 'two groups');
  await decide(app, landedKey, g2.id, 'tw1', 'declined', 'Not how we work');
  app.click('finish'); await app.tick(20);
  h = app.html();
  assert.ok(/Finish On the landed version/.test(h) && /<h2>Corrections · \d+<\/h2>/.test(h), 'on Finish, with its corrections');
  assert.strictEqual(statusOf(h, 'First reason'), 'Open', 'the open one');
  assert.strictEqual(statusOf(h, 'Second reason'), 'Declined', 'the declined one');
}));
rule('Twin corrections on Finish: the thumbnail opens its note\'s image', () => noThrow(async () => {
  const app = await twins(twoGroups(), o => { o.recorder = { person: 'person-avery', session: null }; });
  app.click('pickup'); await app.tick(60); app.click('finish'); await app.tick(20);
  assert.ok(/Finish On the landed version/.test(app.html()), 'set-up: on Finish');
  const b = buttons(app.html(), 'zoom-corr');
  assert.strictEqual(b.length, 1, 'one thumbnail');
  assert.deepStrictEqual(await eachOpensItsOwn(app, b), ['corr.png']);
}));
rule('Twin corrections on the receipt: the thumbnail opens its note\'s image', () => noThrow(async () => {
  const app = await twins(twoGroups());
  app.click('receipt'); await app.tick(20);
  assert.ok(/data-act="copy-receipt"/.test(app.html()), 'set-up: on the receipt');
  const b = buttons(app.html(), 'zoom-corr');
  assert.strictEqual(b.length, 1, 'one thumbnail');
  assert.deepStrictEqual(await eachOpensItsOwn(app, b), ['corr.png']);
}));
for (const [why, other] of [['First reason', 'Second reason'], ['Second reason', 'First reason']]) {
  rule('Twin corrections: Withdraw on "' + why + '" writes a decision naming that group, and only that row changes', () => noThrow(async () => {
    const app = await twins(twoGroups());
    const h = app.html(), d = withdrawOf(rowWith(h, why)), o = withdrawOf(rowWith(h, other));
    assert.ok(d && o && d.id !== o.id, 'two groups');
    const had = Object.keys(app.fs.files);
    await press(app, d); await app.tick(60);
    const files = Object.keys(app.fs.files).filter(f => had.indexOf(f) < 0 && f.indexOf('corrections/landed/') === 0);
    assert.strictEqual(files.length, 1, 'one decision: ' + files.join(', '));
    assert.ok(files[0].startsWith('corrections/landed/' + d.id + '.'), 'in the group\'s name: ' + files[0]);
    const rec = JSON.parse(app.fs.files[files[0]].t);
    assert.strictEqual(rec.group, d.id, 'names the group');
    assert.strictEqual(rec.status, 'withdrawn');
    assert.strictEqual(rec.by, 'person-avery');
    const after = app.html();
    assert.strictEqual(statusOf(after, why), 'Withdrawn', 'the row withdrawn');
    assert.strictEqual(statusOf(after, other), 'Open', 'the other as it was');
  }));
}
/* The checklist's Corrections page. */
async function onChecklist(list) {
  const { app } = await twinFolder(list);
  app.click('nav', 'processes'); await app.tick(8); app.click('open-process', 'landed'); await app.tick(10); app.click('ptab', 'corrections'); await app.tick(10);
  return app;
}
rule('Twin corrections on the checklist\'s page: the screenshot on the first twin opens from its button', () => noThrow(async () => {
  const app = await onChecklist([
    corrNote(Object.assign({ why: 'Picture', change: { op: 'describe' } }, att('page.png'))),
    corrNote({ why: 'No picture', change: { op: 'describe' } })]);
  const b = buttons(app.html(), 'zoom-corr');
  assert.strictEqual(b.length, 1, 'one thumbnail: ' + b.length);
  assert.deepStrictEqual(await eachOpensItsOwn(app, b), ['page.png']);
}));
rule('Twin corrections on the checklist\'s page: the screenshot on the second twin opens from its button', () => noThrow(async () => {
  const app = await onChecklist([
    corrNote({ why: 'No picture', change: { op: 'describe' } }),
    corrNote(Object.assign({ why: 'Picture', change: { op: 'describe' } }, att('page.png')))]);
  const b = buttons(app.html(), 'zoom-corr');
  assert.strictEqual(b.length, 1, 'one thumbnail: ' + b.length);
  assert.deepStrictEqual(await eachOpensItsOwn(app, b), ['page.png']);
}));
rule('Twin corrections on the checklist\'s page: distinct screenshots on both; each button opens its own', () => noThrow(async () => {
  const app = await onChecklist([
    corrNote(Object.assign({ why: 'One', change: { op: 'describe' } }, att('page1.png'))),
    corrNote(Object.assign({ why: 'Two', change: { op: 'describe' } }, att('page2.png')))]);
  const b = buttons(app.html(), 'zoom-corr');
  assert.strictEqual(b.length, 2, 'two thumbnails: ' + b.length);
  assert.deepStrictEqual(await eachOpensItsOwn(app, b), ['page1.png', 'page2.png']);
}));
rule('No note is found by its id alone in the page (the checklist\'s same-id source check)', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  const hits = src.split('\n').filter(l => /_notes[^;]{0,30}\.(find|filter|some|findIndex)\(function \((\w+)\) \{ return \2\.id ===/.test(l));
  assert.deepStrictEqual(hits, []);
});

/* ---------- the linked checklist's reserved Other ID… ---------- */
async function linker() {
  const fx = small(), files = Object.assign({}, fx.files);
  files['maps/drafts/__other.md'] = '---\nprocess: __other\ntitle: Odd process\nowner: person-avery\nroles: lead\n---\n\n## One · READ-DO {#ph1}\n- [ ] {confirm} Do it @lead {#s1}\n';
  files['maps/drafts/linker.md'] = '---\nprocess: linker\ntitle: Linker\nowner: person-avery\n---\n\n## Build · READ-DO {#build}\n- [ ] {run.process} Run the child {#s}\n  process: tiny\n  title: Keep me\n';
  const app = await fresh({ files, facts: fx.facts });
  app.click('nav', 'processes'); await app.tick(5);
  app.click('open-process', 'linker'); await app.tick(10); app.click('ptab', 'edit'); await app.tick(10);
  app.click('ed-mode', 'builder'); await app.tick(10); app.click('ob-sel', 's'); await app.tick(10);
  return app;
}
const draftOf = app => app.fs.files['maps/drafts/linker.md'].t;
const saveDraft = async app => { app.click('save-draft'); await app.tick(80); return draftOf(app); };
rule('Other ID… is the one choice with its value, even with a process named __other', () => noThrow(async () => {
  const app = await linker(), h = app.html(), sel = h.slice(h.indexOf('<select id="ob-link-proc"'), h.indexOf('</select>', h.indexOf('<select id="ob-link-proc"')));
  const others = [...sel.matchAll(/<option value="__other"[^>]*>([^<]*)</g)].map(m => un(m[1]));
  assert.deepStrictEqual(others, ['Other ID…'], 'one choice has the value, and it\'s Other ID…');
}));
rule('Linking a process named __other: choose Other ID…, type it, apply and save, and the draft links it', () => noThrow(async () => {
  const app = await linker();
  app.select('ob-link-proc', '__other'); await app.tick(10);
  assert.ok(app.html().includes('id="ob-link-proc-other"'), 'the box for the ID is drawn');
  app.set('ob-link-proc-other', '__other'); app.input('ob-link-proc-other', '__other');
  app.keyOn('Enter', {}, { tagName: 'INPUT', id: 'ob-link-proc-other', value: '__other', dataset: { enter: 'ob-commit' }, closest: () => null }); await app.tick(10);
  const t = await saveDraft(app);
  assert.ok(/\n  process: __other\n/.test(t), 'the step links __other: ' + t);
  assert.ok(!/process: tiny/.test(t), 'and no longer the old one');
  assert.ok(/^process: linker$/m.test(t), 'the draft\'s own process is as it was');
}));
rule('Choosing Other ID… alone keeps the linked checklist the step has', () => noThrow(async () => {
  const app = await linker(), before = draftOf(app);
  app.select('ob-link-proc', '__other'); await app.tick(10);
  assert.ok(app.html().includes('id="ob-link-proc-other"'), 'the box for the ID is drawn');
  assert.ok(/\n  process: tiny\n/.test(await saveDraft(app)), 'still links tiny');
  assert.ok(!/process: __other/.test(draftOf(app)), 'never __other: ' + before.length);
}));

/* ---------- a Jira workflow, a person and a participant named like Object.prototype ---------- */
/* What the app's own realm made, compared by value. */
const plain = v => JSON.parse(JSON.stringify(v));
const JIRA = '{"__proto__":{"statuses":["To Do","Done"],"transitions":[{"from":"*","to":"Done","fields":[{"name":"Resolution","options":["Fixed","Won\'t do"]}]}]}}';
const JIRA_MD = '---\nprocess: jira-odd\ntitle: Odd workflow\nowner: person-avery\n---\n\n## One · READ-DO {#ph1}\n- [ ] {jira.issue} Close it {#close}\n  action: transition\n  issue: ABC-1\n  issueType: __proto__\n  status: Done\n';
/* The run this build starts on a workflow file: its answers need the workflow's required field. */
function jiraRun(PF) {
  const wf = PF.jira.check(JSON.parse(JIRA)), now = '2026-10-31T00:00:00.000Z';
  assert.deepStrictEqual(plain(wf.errors), []);
  const b = PF.publish.build(JIRA_MD, { people: [{ id: 'person-avery', name: 'Avery' }], workflows: wf.workflows, by: 'person-avery', changes: 'First', existing: [], now, rand: 'abcd1234' });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const v = PF.publish.verify(b.folder, b.files);
  assert.ok(v.ok, v.why);
  return { r: PF.run.create(v, { title: 'Odd', by: 'person-avery', session: 's1', now, workflows: wf.workflows }) };
}
const required = (PF, r) => { const map = PF.run.mapOf(r), s = PF.map.steps(map)[0].step; return { step: s, list: plain(PF.run.evidenceFor(r, s, null, map).list.filter(d => d.jira).map(d => d.label)) }; };
rule('A Jira workflow named __proto__ is read as a workflow: the file\'s own key survives the check', () => {
  const PF = load(), wf = PF.jira.check(JSON.parse(JIRA));
  assert.deepStrictEqual(plain(wf.errors), []);
  assert.deepStrictEqual(Object.keys(wf.workflows), ['__proto__']);
  assert.deepStrictEqual(plain(PF.jira.forType(wf.workflows, '__proto__').workflow.statuses), ['To Do', 'Done']);
  assert.strictEqual(wf.workflows.statuses, undefined, 'nothing landed on the dictionary itself');
});
rule('A run on a Jira workflow named __proto__ requires its evidence, and still does after run.json is written and read', () => {
  const PF = load(), { r } = jiraRun(PF);
  assert.deepStrictEqual(Object.keys(r.jira), ['__proto__'], 'the run\'s copy has it');
  assert.deepStrictEqual(required(PF, r).list, ['Resolution'], 'its field is required');
  assert.strictEqual(PF.run.jiraProblem(r, required(PF, r).step), null, 'the transition is known');
  const disk = JSON.stringify(r), back = JSON.parse(disk);
  assert.ok(disk.includes('"__proto__":{"statuses"'), 'on disk as its own key');
  assert.ok(Object.prototype.hasOwnProperty.call(back.jira, '__proto__'), 'read back as its own key');
  const again = PF.run.sanitize(back);
  assert.deepStrictEqual(Object.keys(again.jira), ['__proto__']);
  assert.deepStrictEqual(required(PF, again).list, ['Resolution'], 'still required after the read');
});
rule('A run on a Jira workflow named __proto__ refuses the transition without its field and records it with one, before and after run.json is written and read', () => {
  const PF = load(), R = PF.run, { r } = jiraRun(PF), now = '2026-10-31T01:00:00.000Z', key = PF.jira.key('Resolution');
  const answer = run => {
    const map = R.mapOf(run);
    assert.throws(() => R.done(run, map, 'close', 'person-avery', now, {}), /Resolution/, 'refused without it');
    assert.ok(!(run.steps.close && run.steps.close.s === 'done'), 'and not recorded');
    R.done(run, map, 'close', 'person-avery', now, { [key]: 'Fixed' });
    assert.strictEqual(run.steps.close.s, 'done', 'recorded with it');
    assert.strictEqual(run.steps.close.values[key], 'Fixed', 'with its value');
  };
  const again = R.sanitize(JSON.parse(JSON.stringify(r)));
  answer(r);
  answer(again);
  assert.strictEqual(R.sanitize(JSON.parse(JSON.stringify(again))).steps.close.values[key], 'Fixed', 'and it is still there when read back');
});
/* 2.11.0 reads the run as it always read one: it opens, its other workflows work, and its own check drops the __proto__ name. */
rule('A run file this build wrote with a workflow named __proto__ still opens in 2.11.0, with the file\'s other workflows at work', async () => {
  const PF = load(), { r } = jiraRun(PF), disk = JSON.parse(JSON.stringify(r));
  disk.jira = plain(PF.jira.check({ Story: { statuses: ['To Do', 'Done'], transitions: [{ from: '*', to: 'Done', fields: [{ name: 'Fix version' }] }] } }).workflows);
  const text = JSON.stringify(disk).replace('"jira":{', '"jira":' + JIRA.slice(0, -1) + ',');
  assert.deepStrictEqual(Object.keys(JSON.parse(text).jira), ['__proto__', 'Story'], 'both are in the file');
  let html;
  try { html = cp.execFileSync('git', ['show', 'v2.11.0:dist/flightdeck.html'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 64 * 1048576, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { if (process.env.CI) throw e; console.log('  (skipped: v2.11.0 isn\'t in this clone)'); return; }
  const old = boot({ html }); await old.tick(40);
  const back = old.PF.run.sanitize(JSON.parse(text));
  assert.ok(!back._unrunnable, 'runs there: ' + back._unrunnable);
  assert.deepStrictEqual(Object.keys(back.jira), ['Story'], 'as 2.11.0 always read it');
  assert.ok(!JSON.stringify(back.jira).includes('__proto__'), 'and what it would save has no such workflow');
  const map = old.PF.run.mapOf(back), step = Object.assign({}, old.PF.map.steps(map)[0].step);
  step.fields = Object.assign({}, step.fields, { issueType: 'Story' });
  assert.deepStrictEqual(plain(old.PF.run.evidenceFor(back, step, null, map).list.filter(d => d.jira).map(d => d.label)), ['Fix version'], 'Story\'s field is required there');
});
rule('Rotation offers a person named constructor who has never done the role, ahead of everyone who has', () => noThrow(async () => {
  const fx = small(), files = Object.assign({}, fx.files), people = JSON.parse(files['people.json']), list = Array.isArray(people) ? people : people.people;
  list.push({ id: 'constructor', name: 'Aardvark Never' });
  files['people.json'] = JSON.stringify(people, null, 2) + '\n';
  const app = await fresh({ files, facts: fx.facts });
  app.click('nav', 'processes'); await app.tick(8); app.click('open-process', 'release'); await app.tick(10); app.click('start', 'release'); await app.tick(10);
  const h = app.html();
  const said = (h.match(/suggestion: [^<]*/g) || []).map(un);
  assert.ok(said.length, 'a role is suggested');
  said.forEach(t => assert.strictEqual(t, 'suggestion: Aardvark Never (hasn\'t done it yet)'));
}));
rule('A participant named __proto__ makes the run a team run, as any other second person does', () => {
  const R = load().run, recorder = { person: 'person-avery' };
  assert.strictEqual(R.solo({ recorder, roles: { lead: '__proto__' } }), false, '__proto__ as the only other person');
  assert.strictEqual(R.solo({ recorder: { person: '__proto__' }, roles: { lead: 'person-avery' } }), false, '__proto__ as the recorder');
  assert.strictEqual(R.solo({ recorder: { person: 'constructor' }, roles: { lead: 'person-avery' } }), false, 'constructor as the recorder');
  assert.strictEqual(R.solo({ recorder, roles: { lead: 'person-avery' } }), true, 'just the recorder is still solo');
  assert.strictEqual(R.solo({ recorder: { person: '__proto__' }, roles: { lead: '__proto__' } }), true, 'just __proto__ is solo too');
});
/* ---------- a step type frozen into a version or a run: names a hand edit can give it ---------- */
const CHECKER = path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py');
const PROOF = id => '---\nprocess: ' + id + '\ntitle: Proof\nowner: person-avery\n---\n\n## Check {#check}\n- [ ] {team.proof} Record the proof {#proof}\n';
const proofType = () => ({ id: 'team.proof', label: 'Proof', fields: { note: { label: 'Note', kind: 'text' } }, record: [{ name: 'proof', label: 'Proof', kind: 'text' }] });
const OWN = name => JSON.parse('{' + JSON.stringify(name) + ':"x"}');
/* A version as the app publishes it, its types.json then edited by hand and its fingerprint brought along. */
function forged(PF, id, edit) {
  const b = PF.publish.build(PROOF(id), { by: 'person-avery', people: [{ id: 'person-avery', name: 'Avery' }], customTypes: { 'team.proof': PF.types.customType(proofType()) }, existing: [], changes: 'First', now: '2026-03-02T09:00:00.000Z', rand: 'abcd1234' });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const types = JSON.parse(b.files['types.json']), info = JSON.parse(b.files['publication.json']);
  edit(types['team.proof']);
  b.files['types.json'] = JSON.stringify(types, null, 2);
  info.typesHash = PF.util.hash(b.files['types.json']);
  b.files['publication.json'] = JSON.stringify(info, null, 2);
  return b;
}
const PROTO_NAMES = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'];
const REFUSED = [].concat(
  PROTO_NAMES.map(n => ['evidence named ' + n, d => { d.record[0].name = n; }]),
  [['evidence named by a list', d => { d.record[0].name = ['__proto__']; }],
    ['a field named __proto__', d => { d.fields = JSON.parse('{"__proto__":{"label":"X","kind":"text"}}'); }],
    ['a field named constructor', d => { d.fields = JSON.parse('{"constructor":{"label":"X","kind":"text"}}'); }],
    ['evidence shown only when constructor is', d => { d.record[0].when = OWN('constructor'); }],
    ['evidence shown only when __proto__ is', d => { d.record[0].when = OWN('__proto__'); }],
    ['a field required when toString is', d => { d.fields.note.requiredWhen = OWN('toString'); }],
    ['a field required unless __proto__ is', d => { d.fields.note.requiredUnless = OWN('__proto__'); }],
    ['evidence with options from toString', d => { d.record[0].optionsFrom = 'toString'; }]]);
const KEPT = [
  ['as published', () => {}],
  ['evidence named ToString, which a team\'s type may have', d => { d.record[0].name = 'ToString'; }],
  ['a field named Constructor, which a team\'s type may have', d => { d.fields = { Constructor: { label: 'X', kind: 'text' } }; }],
  ['a built-in\'s condition and options', d => { d.fields.note.requiredWhen = { action: 'x' }; d.record[0].when = { action: 'x' }; d.record[0].optionsFrom = 'note'; }]];
rule('A version whose step type names evidence, a field or a condition like Object.prototype isn\'t run, by the app reading its files and by the assistants\' checker alike', async () => {
  const PF = load(), root = fsN.mkdtempSync(path.join(os.tmpdir(), 'preflight-frozen-')), mem = new PF.fs.MemoryFS('frozen', null);
  try {
    const cases = REFUSED.map(c => [c[0], c[1], false]).concat(KEPT.map(c => [c[0], c[1], true])), ids = cases.map((c, i) => 'case-' + i);
    fsN.writeFileSync(path.join(root, 'people.json'), JSON.stringify([{ id: 'person-avery', name: 'Avery' }]));
    await mem.write('people.json', JSON.stringify([{ id: 'person-avery', name: 'Avery' }]));
    for (let i = 0; i < cases.length; i++) {
      const b = forged(PF, ids[i], cases[i][1]), v = PF.publish.verify(b.folder, b.files);
      assert.strictEqual(v.ok, cases[i][2], cases[i][0] + ': publish.verify ' + (v.why || 'accepts'));
      if (!cases[i][2]) assert.ok(v.unusable && /can't read/.test(v.why), cases[i][0] + ': said why: ' + v.why);
      for (const f of Object.keys(b.files)) {
        const p = 'publications/' + ids[i] + '/' + b.folder + '/' + f, disk = path.join(root, p);
        await mem.write(p, b.files[f]);
        fsN.mkdirSync(path.dirname(disk), { recursive: true }); fsN.writeFileSync(disk, b.files[f]);
      }
    }
    const app = await PF.repo.loadAll(mem, { deep: true }), out = JSON.parse(cp.execFileSync('python3', ['-I', CHECKER, root], { encoding: 'utf8', maxBuffer: 64 * 1048576 })).publications;
    cases.forEach((c, i) => {
      const proc = app.processes.find(p => p.process === ids[i]), latest = proc && proc.index && proc.index.latest, v = out[ids[i]].versions[0];
      assert.strictEqual(!!latest, c[2], c[0] + ': the app, reading the folder');
      assert.strictEqual(v.status, c[2] ? 'complete' : 'unusable', c[0] + ': the checker: ' + v.status + ' ' + v.why);
      if (!c[2]) assert.ok(/can't read/.test(v.why), c[0] + ': the checker says why: ' + v.why);
    });
  } finally { fsN.rmSync(root, { recursive: true, force: true }); }
});
rule('A run whose copy of its step type has evidence named __proto__ is read-only, so nothing entered is lost', () => {
  const PF = load(), b = forged(PF, 'plain', () => {}), v = PF.publish.verify(b.folder, b.files);
  assert.ok(v.ok, v.why);
  const o = JSON.parse(JSON.stringify(PF.run.create(v, { id: 'run-proof', by: 'person-avery', session: 's1', now: '2026-03-02T09:00:00.000Z' })));
  assert.ok(!PF.run.sanitize(JSON.parse(JSON.stringify(o)))._unrunnable, 'set-up: as started, it runs');
  o.types['team.proof'].record[0].name = '__proto__';
  assert.ok(/can't read/.test(PF.run.sanitize(o)._unrunnable), 'edited by hand, it is read-only');
});
rule('Every built-in step type, and every step type frozen in a folder of a shipped release, is still read', () => {
  const PF = load(), T = PF.types, seen = [];
  T.LIST.forEach(x => { const d = typeof x === 'string' ? T.get(x) : x; assert.ok(T.understood(JSON.parse(JSON.stringify(d))), 'built-in ' + d.id); });
  (function walk(dir) {
    fsN.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'types.json') { const types = JSON.parse(fsN.readFileSync(p, 'utf8')); Object.keys(types).forEach(k => { seen.push(k); assert.ok(T.understood(types[k]), p + ': ' + k); }); }
    });
  })(path.join(__dirname, 'fixtures', 'folders'));
  assert.ok(seen.length > 10, 'set-up: fixtures read: ' + seen.length);
});
rule('Practice doesn\'t admit a draft with a role or run detail named like Object.prototype; publishing refuses them too, and a plain name is untouched', () => {
  const PF = load(), md = (roles, context) => '---\nprocess: p\ntitle: P\nowner: person-avery\nroles: ' + roles + '\ncontext: ' + context + '\n---\n\n## One · READ-DO {#ph1}\n- [ ] {confirm} Do it {#s1}\n';
  for (const n of ['constructor', '__proto__', 'toString']) {
    assert.ok(/keeps for itself/.test(PF.practice.admit(md(n, 'ticket'), {}).why), 'role ' + n);
    assert.ok(/keeps for itself/.test(PF.practice.admit(md('lead', n), {}).why), 'run detail ' + n);
    assert.ok(PF.map.check(PF.map.parse(md(n, 'ticket'))).blockers.some(b => /keeps for itself/.test(b)), 'publishing: role ' + n);
  }
  assert.ok(PF.practice.admit(md('lead', 'ticket'), {}).ok, 'plain names');
});

/* ---------- another folder finishes opening while something of this one is open ---------- */
rule('A folder that finishes opening while a screenshot is open closes it, and focus lands on the new folder\'s heading', () => noThrow(async () => {
  const fx = small(), files = Object.assign({}, fx.files), key = fx.facts.landed, a = note(Object.assign({ text: 'A picture' }, att('first.png')));
  files['runs/' + key + '/notes-tw.jsonl'] = JSON.stringify(a) + '\n';
  files[PNG + 'first.png'] = 'bytes of folder A';
  const pending = gate(), other = folderHandle('Folder B', Object.assign({}, fx.files, { [PNG + 'first.png']: 'bytes of folder B' }));
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true, indexedDB: memoryIDB(), picker: () => pending.p.then(() => other) }); await app.tick(60);
  await into(app, { files, facts: fx.facts });
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', key); await app.tick(10); app.click('select', 's0'); await app.tick(10);
  app.click('connect'); await app.tick(5);
  await press(app, buttons(app.html(), 'zoom-note')[0]);
  assert.ok(app.overlay().includes('first.png'), 'set-up: the screenshot is open');
  pending.open(); await app.tick(80);
  assert.strictEqual(app.overlay(), '', 'closed');
  assert.ok(app.html().includes('id="page-h"') && !/data-act="toggle"/.test(app.html()), 'on the new folder\'s Home');
  assert.strictEqual(app.activeId(), 'page-h', 'focus on its heading');
}));
rule('A folder that finishes opening while a dialog holds typing doesn\'t open: the typing stays and the person is told', () => noThrow(async () => {
  const pending = gate(), other = folderHandle('Folder B', {});
  const app = boot({ localStore: { 'preflight:builder': 'false' }, indexedDB: memoryIDB(), picker: () => pending.p.then(() => other) }); await app.tick(80);
  app.choose('person-morgan'); await app.tick();
  app.click('open-process', 'release'); await app.tick(20);
  const id = /data-act="corr-review" data-id="([\w-]+)"/.exec(app.html())[1];
  app.click('connect'); await app.tick(5);
  app.click('corr-review', id); await app.tick(20); app.click('corr-ca-declining'); await app.tick();
  app.set('ca-reason', 'Not this time'); await app.tick();
  pending.open(); await app.tick(80);
  assert.ok(/id="ca-reason"/.test(app.overlay()), 'the dialog is still up'); assert.strictEqual(app.draft('ca-reason'), 'Not this time');
  assert.ok(/Finish or cancel this first\./.test(app.live()), 'says why');
  assert.ok(/id="page-h"/.test(app.html()) && /data-act="ptab"/.test(app.html()), 'still on the checklist');
}));
rule('A slow attachment that finishes reading after another dialog opened doesn\'t replace it', () => noThrow(async () => {
  const app = await twins([note(Object.assign({ text: 'First file' }, att('first.log')))]);
  const d = buttons(app.html(), 'att-open')[0], data = Object.assign({}, d); delete data.act; delete data.id;
  app.click(d.act, d.id, data); app.click('help'); await app.tick(40);
  assert.ok(app.overlay() !== '' && !app.overlay().includes('first.log'), 'Help is still up');
}));
async function rememberedFolder(files) {
  const dir = folderHandle('Team', files), idb = memoryIDB();
  dir.queryPermission = () => Promise.resolve('prompt');
  await new Promise(res => { const q = idb.open(); q.onsuccess = () => { const tx = q.result.transaction(); tx.oncomplete = res; tx.objectStore().put({ dir, id: 'team-1' }, 'folder'); }; });
  return idb;
}
rule('Reconnecting with a dialog up lands on the heading of the page it comes back to', () => noThrow(async () => {
  const files = {};
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true, indexedDB: await rememberedFolder(files), picker: folderHandle('Other', {}) }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  Object.keys(app.fs.files).forEach(p => { const t = app.fs.files[p].t; if (!/^data:/.test(t)) files[p] = t; });
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', app.run().key); await app.tick(20);
  assert.ok(/id="run-h"/.test(app.html()), 'set-up: on the run');
  app.click('help'); await app.tick(5);
  app.click('reconnect'); await app.tick(200);
  assert.strictEqual(app.overlay(), '', 'Help closes');
  assert.ok(/id="run-h"/.test(app.html()), 'the run, in the team folder');
  assert.strictEqual(app.activeId(), 'run-h', 'focus on its heading');
}));
rule('The assistants\' checker refuses the same names the app does: step, phase, gate, role and run detail', () => {
  const PF = load(), dir = path.dirname(CHECKER);
  const md = over => '---\nprocess: plain\ntitle: Plain\nowner: person-avery\nroles: ' + (over.role || 'lead') + '\ncontext: ' + (over.detail || 'ticket') + '\n---\n\n## One {#' + (over.phase || 'ph1') + '}\n- [ ] {confirm} Do it {#' + (over.step || 's1') + '}\n## Gate: Check {#' + (over.gate || 'g1') + '}\n';
  const cases = [{}, { step: 'constructor' }, { phase: 'constructor' }, { gate: 'constructor' }, { role: 'toString' }, { detail: 'valueOf' }, { role: 'ToString' }];
  const py = 'import json,sys\nsys.path.insert(0,sys.argv[1])\nimport check_folder as c\nprint(json.dumps([c.unrunnable(m,{}) for m in json.load(sys.stdin)]))';
  const out = JSON.parse(cp.execFileSync('python3', ['-I', '-c', py, dir], { input: JSON.stringify(cases.map(md)), encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) }));
  cases.forEach((c, i) => {
    assert.strictEqual(/keeps that name for itself/.test(out[i]), !!(c.step || c.phase || c.gate || (c.role === 'toString') || c.detail), JSON.stringify(c) + ': ' + out[i]);
    assert.strictEqual(out[i], PF.publish.unrunnable(md(c), {}), JSON.stringify(c));
  });
});
rule('Everything that opens another folder closes what is open first; only the first read of the page has nothing to close', () => {
  const lines = fsN.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8').split('\n');
  const calls = lines.map((l, i) => [l, i]).filter(([l]) => /\buseFs\(/.test(l) && !/function useFs/.test(l));
  /* Before the call on its own line, or on the line above unless this line is a whole action of its own (the line above is then another action's). */
  const closes = (l, i) => /leaveFolderOverlay\(/.test(l.slice(0, l.indexOf('useFs('))) || (!/^\s*'?[\w-]+'?: function/.test(l) && /leaveFolderOverlay\(/.test(lines[i - 1]));
  const unclosed = calls.filter(([l, i]) => !closes(l, i)).map(([l]) => l.trim());
  assert.deepStrictEqual(unclosed, ['var useMem = function () { return seeded.then(function () { return useFs(mem); }); };', 'if (p === \'granted\') return useFs(folderFs(rec));']);
});

/* ---------- the same class in the core: an inherited name reads as absent ---------- */
rule('A text naming a detail like constructor says it isn\'t set, never what every object inherits', () => {
  const PF = load(), R = PF.run;
  assert.strictEqual(R.fill('See ^constructor now', {}, null), 'See (constructor not set) now');
  assert.strictEqual(R.fill('See ^constructor now', { constructor: 'mine' }, null), 'See mine now');
  assert.strictEqual(PF.jira.resolve ? PF.jira.resolve('detail:constructor', {}, null) : '', '');
});
rule('The checklist check refuses an ID named like Object.prototype; a plain ID is untouched', () => {
  const PF = load(), md = id => '---\nprocess: plain\ntitle: Plain\nowner: person-avery\nroles: lead\n---\n\n## One · READ-DO {#ph1}\n- [ ] {confirm} Do it @lead {#' + id + '}\n';
  /* IDs read lowercase, so constructor is the one word of Object.prototype a step ID can spell. */
  for (const id of ['constructor']) {
    const blockers = PF.map.check(PF.map.parse(md(id))).blockers;
    assert.ok(blockers.some(b => /keeps for itself/.test(b)), id + ': ' + JSON.stringify(blockers));
  }
  assert.deepStrictEqual(plain(PF.map.check(PF.map.parse(md('s1'))).blockers.filter(b => /keeps for itself/.test(b))), []);
});
run();
