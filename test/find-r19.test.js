// Find things in big folders (2.11), code review round 19: a choice whose value is "#more" is a choice, not a dropdown's Show
// 50 more…; two changes whose old 32-bit keys were the same are both reached; and a Find box someone is using stays drawn
// when a newer read shortens its list below the length that shows one.
'use strict';
const assert = require('assert');
const { rule, run, load, loadViews, exactOf } = require('./harness');
const { boot, folderHandle, memoryIDB } = require('./app-harness');

const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const iso = t => new Date(t).toISOString();
const NOW = Date.parse('2026-10-20T15:00:00Z');

/* ---------- 1. "#more" as a Decide step's choice ---------- */
const PID = 'gonogo';
const MD = '---\nprocess: ' + PID + '\ntitle: Go or no-go\ncategory: Synthetic\nowner: person-avery\n---\n\n' +
  '## Decide · READ-DO {#ph1}\n- [ ] {decide} Pick the path {#dec}\n  options: #more, Other\n- [ ] {confirm} Tell the team {#tell}\n';

/* The checklist published, and a run of it, put in the examples' folder, as another window would. */
async function decideRun() {
  const app = boot({ liveForms: true, localStore: { 'preflight:builder': 'false' } }); await app.tick(60);
  app.choose('person-avery'); await app.tick();
  const PF = load(), people = JSON.parse(app.fs.files['people.json'].t);
  const built = PF.publish.build(MD, { people, by: 'person-avery', changes: 'First', existing: [], now: iso(NOW - 86400000), rand: 'r19aaaaa' });
  assert.ok(!built.blockers, 'set-up: it publishes: ' + (built.blockers || []).join('; '));
  let v = PF.publish.verify(built.folder, built.files, null, {});
  if (v.needsBytes) v = PF.publish.verify(built.folder, built.files, exactOf(PF, built.files), {});
  for (const f of Object.keys(built.files)) await app.fs.write('publications/' + PID + '/' + built.folder + '/' + f, built.files[f]);
  const r = PF.run.create({ folder: built.folder, info: v.info, map: v.map, md: MD }, { id: 'r19run', title: 'Decide run', roles: {}, by: 'person-casey', session: 's-r19', now: iso(NOW - 3600000), tz: 'UTC' });
  const c = {}; Object.keys(r).forEach(k => { if (k[0] !== '_') c[k] = r[k]; });
  const path = 'runs/' + PID + '/r19run/run.json';
  await app.fs.write(path, JSON.stringify(c, null, 2) + '\n');
  const was = app.PF.perf.n['load.done'] || 0;
  app.click('refresh');
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(10);
  app.click('open-run', PID + '/r19run'); await app.tick(20);
  app.click('takeover'); await app.tick(40);
  if (/data-act="pickup"/.test(app.html())) { app.click('pickup'); await app.tick(40); }
  assert.strictEqual(JSON.parse(app.fs.files[path].t).recorder.person, 'person-avery', 'set-up: Avery is recording');
  app.click('select', 'dec'); await app.tick(10);
  return { app, path };
}

rule('Round 19: a Decide step with options #more and Other: choosing #more and Done saves decision "#more" in the run file, as 2.10.0 does', async () => {
  const { app, path } = await decideRun();
  const h = app.html(), m = /<select[^>]*\sid="rec-decision"[^>]*>([\s\S]*?)<\/select>/.exec(h);
  assert.ok(m, 'set-up: the Decision dropdown is drawn');
  assert.ok(/<option(?: value="#more")?>#more</.test(m[1]), 'set-up: #more is one of its options');
  assert.ok(!/data-kselect/.test(m[0].slice(0, m[0].indexOf('>'))), 'set-up: it is an ordinary dropdown, not a long list\'s');
  app.input('rec-decision', '#more'); app.select('rec-decision', '#more'); await app.tick(10);
  const shown = app.el('rec-decision').value;
  app.click('record', 'dec'); await app.tick(60);
  const j = JSON.parse(app.fs.files[path].t);
  assert.ok(j.steps.dec && j.steps.dec.s === 'done', 'the step is saved done: ' + JSON.stringify(j.steps.dec));
  assert.strictEqual(j.steps.dec.values && j.steps.dec.values.decision, '#more', 'decision "#more" is saved: ' + JSON.stringify(j.steps.dec));
  assert.strictEqual(shown, '#more', 'the choice stayed chosen until Done');
});

rule('Round 19: Show 50 more… is heard only on a long list\'s dropdown (data-kselect, data-step), and only as its last option', () => {
  const K = loadViews().vk;
  const sel = (o) => Object.assign({ tagName: 'SELECT', value: '#more', dataset: {} }, o);
  assert.strictEqual(K.isSelMore(sel({ dataset: { kselect: '', step: '50', cur: 'a' } })), true, 'a K.select with more to show');
  assert.strictEqual(K.isSelMore(sel({ dataset: { step: 'dec' } })), false, 'any other dropdown: #more is a value');
  assert.strictEqual(K.isSelMore(sel({ dataset: { kselect: '' } })), false, 'a K.select with nothing more to show draws no Show 50 more…');
  assert.strictEqual(K.isSelMore(sel({ dataset: { kselect: '', step: '50' }, options: [{}, {}, {}], selectedIndex: 1 })), false, 'an option other than the last');
  assert.strictEqual(K.isSelMore(sel({ dataset: { kselect: '', step: '50' }, options: [{}, {}, {}], selectedIndex: 2 })), true, 'the last option');
  assert.strictEqual(K.isSelMore({ tagName: 'INPUT', value: '#more', dataset: { kselect: '', step: '50' } }), false, 'a box typed in');
});

/* ---------- 2. changes whose old keys collided ---------- */
const A = '- [ ] {confirm} Verify result 512789', B = '- [ ] {confirm} Verify result 749192';

rule('Round 19: the old key (32-bit FNV-1a, its second half computed from the first) gave the two added lines one key; the new id parts differ', () => {
  const PF = loadViews(), K = PF.vk, U = PF.util;
  assert.strictEqual(U.hash('+' + A), U.hash('+' + B), 'the two lines\' FNV-1a hashes collide');
  assert.strictEqual(U.hash('+' + A + '|2'), U.hash('+' + B + '|2'), 'and so does the second half: it continues from the same state');
  assert.notStrictEqual(K.domKey('+' + A), K.domKey('+' + B));
  /* Injective over awkward keys, and valid in a #selector: letters, digits and _ only, never a -. */
  const keys = ['', '_', '__', '_005f', 'a', 'a-t', 'a_t', 'h', '-', '#2', 'a#2', 'a\\#2', 'é', '😀', 'x\ny', ' ', 'x y'], seen = new Map();
  for (const k of keys) {
    const d = K.domKey(k);
    assert.ok(/^_[A-Za-z0-9_]*$/.test(d), JSON.stringify(k) + ' gives ' + d);
    assert.ok(!seen.has(d), JSON.stringify(k) + ' and ' + JSON.stringify(seen.get(d)) + ' share ' + d);
    seen.set(d, k);
  }
});

rule('Round 19: 51 added lines with the two colliding ones first and last: the page draws 50 with Show 1 more, and Show more reaches the last', () => {
  const PF = loadViews(), V = PF.views;
  const mid = Array.from({ length: 49 }, (x, i) => '- [ ] {confirm} Middle check ' + (i + 1));
  const old = '---\nprocess: p\ntitle: P\n---\n\n## One · READ-DO {#ph1}\n- [ ] {confirm} Keep {#k}\n';
  const now = old + [A].concat(mid, [B]).join('\n') + '\n';
  const rows = PF.publish.diff(old, now), adds = rows.filter(r => r.op === '+');
  assert.strictEqual(adds.length, 51, 'set-up: 51 changes');
  assert.ok(adds[0].text.indexOf('512789') >= 0 && adds[50].text.indexOf('749192') >= 0, 'set-up: the colliding two first and last');
  const changes = h => [...h.matchAll(/<span class="add" id="([^"]+)" tabindex="-1">\+ ([^<]*)</g)].map(m => ({ id: un(m[1]), text: un(m[2]) }));
  let h = V.diffHtml(rows, {}, 'ver-diff');
  assert.strictEqual(changes(h).length, 50, 'the first page');
  const m = /<button[^>]*data-act="more" data-id="ver-diff"([^>]*)>Show (\d+) more<\/button>/.exec(h);
  assert.ok(m && m[2] === '1', 'Show 1 more: ' + (m ? m[0] : 'none'));
  const next = un(/data-next="([^"]*)"/.exec(m[1])[1]), focus = un(/data-focus="([^"]*)"/.exec(m[1])[1]);
  h = V.diffHtml(rows, { more: { 'ver-diff': 100 } }, 'ver-diff');
  const all = changes(h);
  assert.strictEqual(all.length, 51, 'every change, after Show more');
  assert.ok(all[50].text.indexOf('749192') >= 0, 'the last one is drawn');
  assert.strictEqual(new Set(all.map(x => x.id)).size, 51, 'each with its own id');
  assert.strictEqual(focus, '[id="ver-diff-' + next + '"]', 'Show more\'s focus names the change it adds');
  assert.strictEqual(all[50].id, 'ver-diff-' + next, 'and that is the last line');
});

/* ---------- 3. Join's Find box when a newer list is shorter ---------- */
const team = n => [{ id: 'person-avery', name: 'Avery Lee', email: 'avery@example.com', folderRole: 'owner' }]
  .concat(Array.from({ length: n - 1 }, (x, i) => ({ id: 'person-j' + (i + 1), name: 'Jo ' + String(i + 1).padStart(2, '0'), email: 'jo' + (i + 1) + '@example.com' })));
async function joinWith(n) {
  const files = { 'people.json': JSON.stringify(team(n), null, 2) + '\n' }, dir = folderHandle('Team', files);
  const clock = { skip: 0 }, perf = { now: () => Number(process.hrtime.bigint() / 1000000n) + clock.skip };
  const app = boot({ picker: dir, indexedDB: memoryIDB(), firstRun: true, domFocus: true, performance: perf }); await app.tick(60);
  app.clock = clock;
  app.click('setup-mode', 'join'); await app.tick();
  app.click('setup-open'); await app.tick(200);
  /* Another computer saves a newer people list in the team folder. */
  app.people = m => { files['people.json'] = JSON.stringify(team(m), null, 2) + '\n'; };
  return { app, dir };
}
/* A minute passes and the app's own beat rereads the folder, focus left where it is. */
async function beat(app) {
  const was = app.PF.perf.n['load.done'] || 0;
  app.clock.skip += 61000; app.every(); await app.tick(20); app.every();
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(10);
}
const whoIds = h => [...h.matchAll(/data-act="setup-who" data-id="([^"]+)"/g)].map(m => un(m[1]));

rule('Round 19: Join with 60 people, Find "Jo 07" with focus in the box; a newer list of 45: the box stays, still filters, and keeps focus', async () => {
  const { app } = await joinWith(60);
  assert.ok(/id="find-su-who"/.test(app.html()), 'set-up: Find your name is drawn over 60 people');
  const box = app.node('#find-su-who'); box.focus(); app.fire('focusin', { target: box }); await app.tick(5);
  app.set('find-su-who', 'Jo 07'); app.input('find-su-who', 'Jo 07'); await app.tick(5);
  assert.deepStrictEqual(whoIds(app.html()), ['person-j7'], 'set-up: one name matches');
  app.doc.activeElement = app.node('#find-su-who');
  app.people(45);
  await beat(app);
  const h = app.html();
  assert.ok(/id="find-su-who"/.test(h), 'Find your name is still drawn over 45 people');
  assert.ok(/value="Jo 07"/.test(h), 'with its text');
  assert.ok(/1 of 45 match/.test(h), 'counting the newer list: ' + (/role="status">[^<]*/.exec(h.slice(h.indexOf('find-su-who-n'))) || [''])[0]);
  assert.deepStrictEqual(whoIds(h), ['person-j7'], 'and it still filters');
  const a = app.doc.activeElement;
  assert.ok(a && app.node('#find-su-who') === a, 'focus is on the Find box as drawn now (it is on ' + app.activeId() + ')');
  assert.ok(app.html().indexOf('id="' + a.id + '"') >= 0, 'connected: on the page');
});

rule('Round 19: Join, Find text typed over 60 people, focus gone elsewhere; a newer list of 45: the text still filters and the box shows it', async () => {
  const { app } = await joinWith(60);
  app.set('find-su-who', 'Jo 07'); app.input('find-su-who', 'Jo 07'); await app.tick(5);
  app.people(45);
  await beat(app);
  const h = app.html();
  assert.ok(/id="find-su-who"[^>]*value="Jo 07"/.test(h), 'the box is drawn with its text');
  assert.ok(/1 of 45 match/.test(h), 'counting the newer list');
  assert.deepStrictEqual(whoIds(h), ['person-j7'], 'and it filters');
});

rule('Round 19: every Find box with a length threshold stays while it has text or focus (K.findOn), and only then', () => {
  const K = loadViews().vk;
  assert.strictEqual(K.findOn({}, 'x', false), false);
  assert.strictEqual(K.findOn({}, 'x', true), true);
  assert.strictEqual(K.findOn({ find: { q: { x: 'a' } } }, 'x', false), true, 'text');
  assert.strictEqual(K.findOn({ selFocus: 'x' }, 'x', false), true, 'focus');
  assert.strictEqual(K.findOn({ selFocus: 'y', find: { q: { y: 'a' } } }, 'x', false), false, 'another list\'s');
  const roles = Array.from({ length: 5 }, (x, i) => 'r' + i), rr = st => K.roleRows(st, 'rl', roles, { row: r => '<p>' + r + '</p>' });
  assert.strictEqual(rr({}).box, '', 'a short role list has no box');
  assert.ok(/id="find-rl"/.test(rr({ selFocus: 'rl' }).box), 'unless it has focus');
  assert.ok(/id="find-rl"/.test(rr({ find: { q: { rl: 'r1' } } }).box), 'or text');
});

run();
