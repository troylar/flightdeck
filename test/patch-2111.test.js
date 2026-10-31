// 2.11.1: names and notes from the folder are taken as they are.
// An id from a file can be a name every plain object already has (constructor, toString, hasOwnProperty, __proto__): a running
// run with one stopped the app reading the whole folder. Two notes can share an id in a run (twins): a screenshot's or a file's
// button is on one of them, and opens that one. A process can be named as the linked checklist's Other ID… choice.
'use strict';
const assert = require('assert');
const { rule, run, load } = require('./harness');
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
async function twins(list) {
  const fx = small(), files = Object.assign({}, fx.files), key = fx.facts.landed;
  files['runs/' + key + '/notes-tw.jsonl'] = list.map(n => JSON.stringify(n)).join('\n') + '\n';
  list.forEach(n => (n.files || []).forEach(f => { files[f] = 'bytes of ' + f; }));
  const app = await fresh({ files, facts: fx.facts });
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', key); await app.tick(10); app.click('select', 's0'); await app.tick(10);
  return app;
}
/* Each attachment button drawn, as the page has it: its action, and every data- attribute. */
function buttons(h, act) {
  return [...h.matchAll(/<button class="(?:thumb|att)"([^>]*)>/g)].map(m => { const d = {}; m[1].replace(/data-([\w-]+)="([^"]*)"/g, (x, k, v) => { d[k] = un(v); return x; }); return d; }).filter(d => !act || d.act === act);
}
const shown = app => { const m = /<img[^>]*alt="([^"]*)"/.exec(app.overlay()); return m ? un(m[1]) : null; };
function press(app, d) { const data = Object.assign({}, d); delete data.act; delete data.id; app.click(d.act, d.id, data); return app.tick(20); }

rule('Twins: the first has no screenshot and the second has one; the second\'s thumbnail opens it', () => noThrow(async () => {
  const app = await twins([note({ text: 'No picture' }), note(Object.assign({ text: 'With a picture' }, att('second.png')))]);
  const b = buttons(app.html(), 'zoom-note');
  assert.strictEqual(b.length, 1, 'one thumbnail');
  await press(app, b[0]);
  assert.ok(/second\.png/.test(shown(app) || app.overlay()), 'opens the second note\'s image: ' + app.overlay().slice(0, 200));
}));
rule('Twins: both have a screenshot; each thumbnail opens its own', () => noThrow(async () => {
  const app = await twins([note(Object.assign({ text: 'First picture' }, att('first.png'))), note(Object.assign({ text: 'Second picture' }, att('second.png')))]);
  const b = buttons(app.html(), 'zoom-note'), by = {};
  assert.strictEqual(b.length, 2, 'two thumbnails');
  for (const d of b) { await press(app, d); const o = app.overlay(); by[/second\.png/.test(o) ? 'second' : /first\.png/.test(o) ? 'first' : 'none'] = (by[/second\.png/.test(o) ? 'second' : /first\.png/.test(o) ? 'first' : 'none'] || 0) + 1; app.click('close-overlay'); await app.tick(5); }
  assert.deepStrictEqual(by, { first: 1, second: 1 }, 'each opens its own');
}));
rule('Twins: the same with a file: Open and Save a copy read the second note\'s, and only a file of that note opens', () => noThrow(async () => {
  const app = await twins([note({ text: 'No file' }), note(Object.assign({ text: 'With a file' }, att('second.log')))]);
  const d = buttons(app.html(), 'att-open')[0];
  assert.ok(d, 'the file\'s button');
  app.set('att-text', '');
  await press(app, d);
  assert.strictEqual(app.text('att-text'), 'bytes of ' + PNG + 'second.log', 'its text opens');
  assert.ok(/data-act="att-save"[^>]*data-note="/.test(app.overlay()), 'Save a copy in the dialog carries the note too');
  app.click('close-overlay'); await app.tick(5);
  app.set('att-text', 'untouched');
  await press(app, Object.assign({}, d, { path: PNG + 'not-its-own.log' }));
  assert.strictEqual(app.overlay(), '', 'not a file of that note');
}));
rule('Twins identical in every field: each opens, as what they are; one more arriving opens none in its place', () => noThrow(async () => {
  const same = note(Object.assign({ text: 'Same' }, att('same.png')));
  const app = await twins([same, Object.assign({}, same)]);
  const b = buttons(app.html(), 'zoom-note');
  assert.strictEqual(b.length, 2);
  await press(app, b[1]);
  assert.ok(/same\.png/.test(app.overlay()), 'the copy opens');
  app.click('close-overlay'); await app.tick(5);
  /* What a stale button holds no longer says which: the count of copies changed. */
  const r = app.PF.search, t = JSON.parse(b[1].note);
  assert.strictEqual(r.noteFind([same, same, same].map(x => JSON.parse(JSON.stringify(x))), t), null, 'none chosen');
}));
const corrNote = over => note(Object.assign({ kind: 'correction', version: 1, folder: '', target: { phase: '', step: 's0' }, change: { op: 'describe' }, why: 'Why', happened: '' }, over));
rule('Twin corrections on the run\'s step: the second\'s thumbnail opens its own, and each row says its own group; Withdraw decides the row\'s', () => noThrow(async () => {
  const app = await twins([
    corrNote({ why: 'First reason', by: 'person-avery', change: { op: 'describe' } }),
    corrNote(Object.assign({ why: 'Second reason', by: 'person-avery', change: { op: 'screenshot' } }, att('corr.png', 'person-avery')))]);
  const h = app.html(), b = buttons(h, 'zoom-corr');
  assert.strictEqual(b.length, 1, 'one thumbnail');
  await press(app, b[0]);
  assert.ok(/corr\.png/.test(app.overlay()), 'the second\'s image: ' + app.overlay().slice(0, 160));
  app.click('close-overlay'); await app.tick(5);
  const rows = [...h.matchAll(/<li class="corr"[\s\S]*?<\/li>/g)].map(m => m[0]);
  const w = rows.map(x => { const m = /data-act="corr-withdraw" data-id="([^"]+)"/.exec(x); return m ? m[1] : null; });
  assert.strictEqual(rows.length, 2, 'two rows: ' + rows.length);
  assert.ok(w[0] && w[1] && w[0] !== w[1], 'each row withdraws its own group: ' + JSON.stringify(w));
}));
rule('Twin corrections on the checklist\'s page: each member\'s thumbnail opens its own', () => noThrow(async () => {
  const app = await twins([
    corrNote({ why: 'No picture', change: { op: 'describe' } }),
    corrNote(Object.assign({ why: 'Picture', change: { op: 'describe' } }, att('page.png')))]);
  app.click('nav', 'processes'); await app.tick(8); app.click('open-process', 'landed'); await app.tick(10); app.click('ptab', 'corrections'); await app.tick(10);
  const b = buttons(app.html(), 'zoom-corr');
  assert.strictEqual(b.length, 1, 'one thumbnail: ' + b.length);
  await press(app, b[0]);
  assert.ok(/page\.png/.test(app.overlay()), 'its image: ' + app.overlay().slice(0, 160));
}));
rule('No note is found by its id alone in the page (the checklist\'s same-id source check)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  const hits = src.split('\n').filter(l => /_notes[^;]{0,30}\.(find|filter|some|findIndex)\(function \((\w+)\) \{ return \2\.id ===/.test(l));
  assert.deepStrictEqual(hits, []);
});

/* ---------- the linked checklist's reserved Other ID… ---------- */
rule('A process with the id __other is reached by Other ID…, and choosing Other ID… never links it by accident', () => noThrow(async () => {
  const fx = small(), files = Object.assign({}, fx.files);
  files['maps/drafts/__other.md'] = '---\nprocess: __other\ntitle: Odd process\nowner: person-avery\nroles: lead\n---\n\n## One · READ-DO {#ph1}\n- [ ] {confirm} Do it @lead {#s1}\n';
  files['maps/drafts/linker.md'] = '---\nprocess: linker\ntitle: Linker\nowner: person-avery\n---\n\n## Build · READ-DO {#build}\n- [ ] {run.process} Run the child {#s}\n  process: tiny\n';
  const app = await fresh({ files, facts: fx.facts });
  app.click('nav', 'processes'); await app.tick(5);
  app.click('open-process', 'linker'); await app.tick(10); app.click('ptab', 'edit'); await app.tick(10);
  app.click('ed-mode', 'builder'); await app.tick(10); app.click('ob-sel', 's'); await app.tick(10);
  const h = app.html(), sel = h.slice(h.indexOf('<select id="ob-link-proc"'), h.indexOf('</select>', h.indexOf('<select id="ob-link-proc"')));
  const others = [...sel.matchAll(/<option value="__other"[^>]*>([^<]*)</g)].map(m => un(m[1]));
  assert.deepStrictEqual(others, ['Other ID…'], 'one choice has the value, and it\'s Other ID…');
}));
run();
