// Find things in big folders (2.11), code review round 16: a role past the page holds what its select would in 2.10 through a
// new version arriving (test/find-roles-diff.test.js drives both releases through random events), and a note whose id is ""
// (the folder accepts it) is found by search and held by focus like any other.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { world, pair, put, reread, formRoles, prng, PID } = require('./find-roles-diff.test');
const { small, fresh, arrive, iso } = require('./find-twins.test');

const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const hiddenOf = (h, role) => (new RegExp('<input type="hidden" id="role-' + role + '" data-role="[^"]*" value="([^"]*)"').exec(h) || [])[1];

/* ---------- 1. a hidden role through a new version ---------- */
rule('Round 16: Plan on 60 roles, Just me, then v2 arrives with the same roles and a refresh: hidden role 50 is still Avery, and the plan saves Avery in every role', async () => {
  const W = world(60, prng(7));
  /* Avery had every role on the last run, so the rotation suggests someone else for each. */
  const [, side] = await pair(W, Object.assign({}, W.publish(W.roles), W.peopleFile(), W.runFile(() => 'person-avery')));
  const app = side.app;
  app.click('plan-run', PID); await app.tick(20);
  let h = app.html();
  assert.ok(hiddenOf(h, 'r50') !== undefined && hiddenOf(h, 'r50') !== 'person-avery', 'set-up: role 50 is hidden, suggested to someone else: ' + hiddenOf(h, 'r50'));
  app.click('just-me'); await app.tick(5);
  assert.strictEqual(hiddenOf(app.html(), 'r50'), 'person-avery', 'set-up: Just me');
  await put([side], W.publish(W.roles));
  await reread(app);
  h = app.html();
  assert.ok(new RegExp('data-folder="' + W.pubs[1].folder + '"').test(h), 'set-up: the form is on v2');
  assert.strictEqual(hiddenOf(h, 'r50'), 'person-avery', 'role 50, not drawn, is still Avery, as 2.10\'s select is');
  const f = formRoles(app);
  assert.deepStrictEqual(Object.keys(f.roles).filter(r => f.roles[r] !== 'person-avery'), [], 'every role is still Avery');
  app.set('run-title', 'Just me through v2'); app.set('plan-when', '2099-06-01T09:00');
  app.submitForm('plan-form'); await app.tick(120);
  const made = Object.keys(app.fs.files).filter(p => /^proposals\/plan-manyroles-[a-z0-9]{8}\.json$/.test(p)).map(p => JSON.parse(app.fs.files[p].t)).filter(p => p.title === 'Just me through v2');
  assert.strictEqual(made.length, 1, 'the plan is saved');
  assert.strictEqual(made[0].roles.r50, 'person-avery', 'with Avery in role 50');
  assert.deepStrictEqual(Object.keys(made[0].roles).filter(r => made[0].roles[r] !== 'person-avery'), [], 'and in every role');
});

/* ---------- 2. a note whose id is "" ---------- */
/* The landed run's step s0 with a note whose id is "", then n newer notes on it. */
async function emptyId(n) {
  const app = await fresh(), key = small().facts.landed, dir = 'runs/' + key + '/';
  const rj = JSON.parse(app.fs.files[dir + 'run.json'].t), t0 = Date.parse(rj.created);
  const mk = (i, id, text) => ({ id, at: iso(t0 + 60000 + i * 1000), by: 'person-blake', session: 'r16', step: 's0', text });
  const notes = [mk(0, '', 'The note whose id is empty')].concat(Array.from({ length: n }, (x, i) => mk(i + 1, 'r16n' + i, 'Newer note ' + i)));
  await arrive(app, [[dir + 'notes-r16.jsonl', notes]]);
  return { app, key, dir, notes };
}
const sxBox = app => { const q = app.el('sx-q'); q.tagName = 'INPUT'; q.type = 'search'; return q; };
async function search(app, text) { app.click('search'); await app.tick(10); sxBox(app); app.input('sx-q', text); await app.tick(400); return [...app.overlay().matchAll(/role="option"[^>]*data-id="([^"]+)"/g)].map(m => un(m[1])); }
const liText = (h, id) => { const i = h.indexOf('<li id="' + id + '"'); return i < 0 ? '' : h.slice(i, h.indexOf('</li>', i)); };

rule('Round 16: a note whose id is "", older than the newest 20 on its step: its search hit opens the run with the note drawn under From earlier, as itself, and focused', async () => {
  const { app, key } = await emptyId(25);
  app.click('nav', 'home'); await app.tick(5);
  const hit = (await search(app, 'whose id is empty')).find(x => x === 'note:' + key + ':#1');
  assert.ok(hit, 'set-up: the note is a search hit');
  app.click('sx-open', hit); await app.tick(20);
  const h = app.html();
  assert.ok(liText(h, 'tn-s0-').indexOf('The note whose id is empty') >= 0, 'the note is drawn, as itself');
  assert.ok(/<p class="small kept-h">From earlier<\/p>/.test(h), 'under From earlier');
  assert.strictEqual(app.activeId(), 'tn-s0-', 'and focused');
});

rule('Round 16: a note whose id is "" drawn and focused keeps focus through an unrelated newer read', async () => {
  const { app, key, dir } = await emptyId(3);
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', key); await app.tick(10);
  app.click('select', 's0'); await app.tick(10);
  assert.ok(liText(app.html(), 'tn-s0-').indexOf('The note whose id is empty') >= 0, 'set-up: the note is drawn');
  app.node('[id="tn-s0-"]').focus(); await app.tick(5);
  assert.strictEqual(app.activeId(), 'tn-s0-', 'set-up: focused');
  /* Another computer adds 30 notes to another step: nothing about this note changes. */
  const rj = JSON.parse(app.fs.files[dir + 'run.json'].t), t0 = Date.parse(rj.created);
  await arrive(app, [[dir + 'notes-other.jsonl', Array.from({ length: 30 }, (x, i) => ({ id: 'oth' + i, at: iso(t0 + 900000 + i * 1000), by: 'person-casey', session: 'other', step: 's1', text: 'Elsewhere ' + i }))]]);
  assert.ok(liText(app.html(), 'tn-s0-').indexOf('The note whose id is empty') >= 0, 'the note is still drawn');
  assert.strictEqual(app.activeId(), 'tn-s0-', 'and still focused');
  /* 25 newer notes on its own step push it past the newest 20: it stays drawn, held by focus, and keeps it. */
  await arrive(app, [[dir + 'notes-more.jsonl', Array.from({ length: 25 }, (x, i) => ({ id: 'newer' + i, at: iso(t0 + 2000000 + i * 1000), by: 'person-casey', session: 'more', step: 's0', text: 'Newer here ' + i }))]]);
  assert.ok(liText(app.html(), 'tn-s0-').indexOf('The note whose id is empty') >= 0, 'pushed past the page, the note is still drawn');
  assert.strictEqual(app.activeId(), 'tn-s0-', 'and still focused');
});

rule('Round 16: search targets keep a note id of "", and PF.search.noteFind finds that note, not another', () => {
  const { load } = require('./harness');
  const S = load().search;
  const notes = [{ id: '', at: '2026-01-01T00:00:00.000Z', step: 's0', text: 'empty' }, { id: 'a', at: '2026-01-01T00:01:00.000Z', step: 's0', text: 'a' }];
  const t = S.noteTarget('p/r', notes[0], [notes[0]]);
  assert.strictEqual(t.note, '', 'the target names the note by its id ""');
  const hit = S.noteFind(notes, t);
  assert.ok(hit && hit.n === notes[0] && hit.key === '', 'and noteFind finds it, keyed ""');
  assert.strictEqual(S.noteFind(notes, { note: undefined }), null, 'a target without a note finds none');
});

run();
