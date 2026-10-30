// Find things in big folders (2.11), the persona walkthrough: leaving a Find box no longer redraws the page under a click
// (the first click on a fold, a button or anything else outside the box works), and a Find box's count says when another
// filter, or a row kept while you work on it, has a part in "No … matches".
'use strict';
const assert = require('assert');
const { rule, run, loadViews } = require('./harness');
const { small, fresh } = require('./find-twins.test');

const K = loadViews().vk;
const typeFind = async (app, id, v) => { app.set('find-' + id, v); app.input('find-' + id, v); await app.tick(5); };
const count = (h, id) => { const m = new RegExp('id="find-' + id + '-n" role="status">([^<]*)</span>').exec(h); return m ? m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'") : null; };
const renders = app => app.PF.perf.n.render || 0;
const fuRows = h => (h.match(/<li class="fu[^"]*" id="fu-/g) || []).length;
const box = id => ({ id: 'find-' + id, dataset: { find: id } });
/* A fold's header (a <summary>) as the click's press moves focus to it. */
const summary = { tagName: 'SUMMARY', id: '', dataset: {} };
async function enter(app, id) { app.doc.activeElement = app.el('find-' + id); app.fire('focusin', { target: box(id) }); await app.tick(5); }
async function leave(app, id, to) { app.doc.activeElement = to || summary; app.fire('focusout', { target: box(id) }); await app.tick(10); }

/* ---------- F1: leaving a Find box ---------- */
rule('Walkthrough: leaving a Find box that stays drawn (Checklists, Follow-ups, Settings) draws nothing, so the click that left it lands on what it pressed', async () => {
  const app = await fresh(small({ procs: 60 }));
  for (const [nav, id] of [['processes', 'processes'], ['followups', 'fu'], ['settings', 'people']]) {
    app.click('nav', nav); await app.tick(10);
    assert.ok(new RegExp('id="find-' + id + '"').test(app.html()), 'set-up: ' + nav + ' draws Find');
    await enter(app, id);
    const was = renders(app), h = app.html();
    app.fire('pointerdown', {}); await leave(app, id); app.fire('pointerup', {}); await app.tick(5);
    assert.strictEqual(renders(app), was, nav + ': the press that left the box redrew nothing (a redraw replaced the fold it pressed)');
    assert.strictEqual(app.html(), h, nav + ': the page is as it was');
    await enter(app, id); await typeFind(app, id, 'zz');
    const was2 = renders(app);
    await leave(app, id);
    assert.strictEqual(renders(app), was2, nav + ': with text, leaving by the keyboard redraws nothing either');
    assert.ok(new RegExp('id="find-' + id + '"[^>]*value="zz"').test(app.html()), nav + ': the Find text is kept');
    app.click('find-clear', id); await app.tick(5);
    await leave(app, id);
  }
});

rule('Walkthrough: a Find box drawn for its focus alone goes when it\'s left: at once by the keyboard, and only once a pressed pointer is released', async () => {
  const app = await fresh(small({ followUps: 0 }));
  app.click('nav', 'followups'); await app.tick(10);
  app.click('fu-filter', 'mine'); await app.tick(5);
  assert.ok(!/id="find-fu"/.test(app.html()), 'set-up: none of them is yours, no Find');
  /* Focus in the box (kept from a longer list) draws it with nothing to find. */
  app.fire('focusin', { target: box('fu') }); app.click('fu-filter', 'mine'); await app.tick(5);
  assert.ok(/id="find-fu"/.test(app.html()), 'set-up: drawn while it has focus');
  app.doc.activeElement = app.el('find-fu');
  app.fire('pointerdown', {});
  const was = renders(app);
  await leave(app, 'fu');
  assert.strictEqual(renders(app), was, 'nothing is redrawn while the pointer is still pressed');
  assert.ok(/id="find-fu"/.test(app.html()), 'the box is still there under the press');
  app.fire('pointerup', {}); await app.tick(5);
  assert.ok(!/id="find-fu"/.test(app.html()), 'released: the box goes');
  app.fire('focusin', { target: box('fu') }); app.click('fu-filter', 'mine'); await app.tick(5);
  app.doc.activeElement = app.el('find-fu');
  assert.ok(/id="find-fu"/.test(app.html()), 'set-up: drawn again');
  await leave(app, 'fu', app.doc.body);
  assert.ok(!/id="find-fu"/.test(app.html()), 'left by the keyboard: it goes at once');
});

/* ---------- F3: what the count says ---------- */
rule('Walkthrough: K.findBox says another filter and a kept row in its count, through esc(), and stays role="status"', () => {
  const st = { find: { q: { fu: 'mor<gan' } } };
  assert.strictEqual(count(K.findBox(st, 'fu', 'Find a follow-up', 0, 9, 'follow-up'), 'fu'), 'No follow-up matches "mor&lt;gan"');
  assert.strictEqual(count(K.findBox(st, 'fu', 'Find a follow-up', 0, 9, 'follow-up', { by: 'with Yours on' }), 'fu'), 'No follow-up matches "mor&lt;gan" with Yours on');
  assert.strictEqual(count(K.findBox(st, 'fu', 'Find a follow-up', 0, 9, 'follow-up', { kept: true }), 'fu'), 'No other follow-up matches "mor&lt;gan"');
  assert.strictEqual(count(K.findBox(st, 'fu', 'Find a follow-up', 0, 9, 'follow-up', { kept: true, by: 'with <Open> on' }), 'fu'), 'No other follow-up matches "mor&lt;gan" with &lt;Open&gt; on');
  assert.strictEqual(count(K.findBox(st, 'fu', 'Find a follow-up', 2, 9, 'follow-up', { kept: true, by: 'with Yours on' }), 'fu'), '2 of 9 match', 'matches: counted as before');
  /* A list of roles with one kept (being edited) and Find matching none draws that row: "No other". */
  const rs = { find: { q: { r: 'zzz' } } };
  const rr = K.roleRows(rs, 'r', Array.from({ length: 30 }, (x, i) => 'role' + i), { keep: ['role3'], row: r => '<i>' + r + '</i>' });
  assert.ok(/<i>role3<\/i>/.test(rr.rows), 'set-up: the kept role is drawn');
  assert.strictEqual(count(rr.box, 'r'), 'No other role matches "zzz"');
  assert.strictEqual(count(K.roleRows(rs, 'r', ['a', 'b'], { row: r => r }).box, 'r'), 'No role matches "zzz"', 'nothing kept: as before');
});

rule('Walkthrough: Follow-ups: with Yours or Open on, "No follow-up matches" says so; beside a row kept for its open form, "No other"', async () => {
  const app = await fresh(small({ followUps: 40 }));
  app.click('nav', 'followups'); await app.tick(10);
  app.click('fu-filter', 'all'); await app.tick(5);
  await typeFind(app, 'fu', 'Follow up 23');
  assert.strictEqual(fuRows(app.html()), 1, 'set-up: one match among all');
  const key = /<li class="fu[^"]*" id="fu-([^"]+)"/.exec(app.html())[1].replace(/--/g, '/');
  app.click('fu-filter', 'mine'); await app.tick(5);
  assert.strictEqual(fuRows(app.html()), 0, 'set-up: it isn\'t yours');
  assert.strictEqual(count(app.html(), 'fu'), 'No follow-up matches "Follow up 23" with Yours on');
  await typeFind(app, 'fu', 'nothing like it');
  assert.strictEqual(count(app.html(), 'fu'), 'No follow-up matches "nothing like it" with Yours on');
  app.click('fu-filter', 'all'); await app.tick(5);
  assert.strictEqual(count(app.html(), 'fu'), 'No follow-up matches "nothing like it"', 'All: Find text alone');
  await typeFind(app, 'fu', 'Follow up 23');
  app.click('fu-pick', key, { status: 'wont' }); await app.tick(5);
  await typeFind(app, 'fu', 'nothing like it');
  let h = app.html();
  assert.ok(/You(&#39;|')re editing this one/.test(h) && fuRows(h) === 1, 'set-up: the row being edited is kept');
  assert.strictEqual(count(h, 'fu'), 'No other follow-up matches "nothing like it"');
  app.click('fu-filter', 'open'); await app.tick(5);
  assert.strictEqual(count(app.html(), 'fu'), 'No other follow-up matches "nothing like it" with Open on');
  app.click('fu-cancel', key); await app.tick(5);
  /* Done under Open: it leaves the chip's list, and the zero is the chip's. */
  await typeFind(app, 'fu', 'Follow up 23');
  assert.strictEqual(fuRows(app.html()), 1, 'set-up: one open match');
  app.click('fu-pick', key, { status: 'done' }); await app.tick(5);
  app.click('fu-save', key); await app.tick(60);
  h = app.html();
  assert.strictEqual(fuRows(h), 0, 'set-up: done, it leaves Open');
  assert.strictEqual(count(h, 'fu'), 'No follow-up matches "Follow up 23" with Open on');
});

rule('Walkthrough: Checklists and Skills: with a tag chosen, "No … matches" says the tag applies too', async () => {
  const app = await fresh(small({ procs: 60 }));
  app.click('nav', 'processes'); await app.tick(10);
  const tag = /data-act="tag" data-id="([^"]+)"/.exec(app.html())[1];
  app.click('tag', tag); await app.tick(5);
  await typeFind(app, 'processes', 'nothing like it');
  assert.strictEqual(count(app.html(), 'processes'), 'No checklist matches "nothing like it" with the tag you chose');
  app.click('tag', ''); await app.tick(5);
  assert.strictEqual(count(app.html(), 'processes'), 'No checklist matches "nothing like it"', 'no tag: Find text alone');
  app.click('find-clear', 'processes'); await app.tick(5);
  app.click('nav', 'skills'); await app.tick(10);
  const st = /data-act="tag" data-id="([^"]+)"/.exec(app.html());
  if (st && /id="find-skills"/.test(app.html())) {
    app.click('tag', st[1]); await app.tick(5);
    await typeFind(app, 'skills', 'nothing like it');
    assert.strictEqual(count(app.html(), 'skills'), 'No skill matches "nothing like it" with the tag you chose');
    app.click('tag', ''); await app.tick(5);
  }
});

run();
