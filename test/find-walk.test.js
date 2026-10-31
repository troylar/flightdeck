// Find things in big folders (2.11), the persona walkthrough: leaving a Find box no longer redraws the page under a click
// (the first click on a fold, a button or anything else outside the box works), and a Find box's count says when another
// filter, or a row kept while you work on it, has a part in "No … matches".
'use strict';
const assert = require('assert');
const { rule, run, loadViews } = require('./harness');
const { small, fresh, arrive } = require('./find-twins.test');
const { boot } = require('./app-harness');
const { into } = require('./bounds-fixture');

const K = loadViews().vk;
const typeFind = async (app, id, v) => { app.set('find-' + id, v); app.input('find-' + id, v); await app.tick(5); };
const count = (h, id) => { const m = new RegExp('id="find-' + id + '-n" role="status">([^<]*)</span>').exec(h); return m ? m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'") : null; };
const renders = app => app.PF.perf.n.render || 0;
const fuRows = h => (h.match(/<li class="fu[^"]*" id="fu-/g) || []).length;
const box = id => ({ id: 'find-' + id, dataset: { find: id } });
/* A fold's header (a <summary>) as the click's press moves focus to it. */
const summary = { tagName: 'SUMMARY', id: '', dataset: {} };
/* As fresh(), with the app's delayed timers held (none fires until the test moves the clock), so a redraw put off by
   250 ms (scheduleRender) can't land in the middle of a gesture being counted (code review round 24). */
async function freshT(fx) {
  const clock = { skip: 0 }, perf = { now: () => Number(process.hrtime.bigint() / 1000000n) + clock.skip };
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true, performance: perf, timers: true }); await app.tick(60);
  app.clock = clock;
  await into(app, fx || small());
  app.PF.repo.config.recentMs = 1e13;
  await settle(app);
  return app;
}
/* Every delayed timer that's waiting fires, and what it started finishes, before a gesture is measured. */
async function settle(app) { for (let i = 0; i < 50 && app.pendingTimers().length; i++) { app.advanceTimers(1000); await app.tick(10); } await app.tick(10); }
/* A drawn node is still on the page: its region hasn't been redrawn since it was drawn. */
const live = n => !!n && n._src === n._region._html;
/* A pointer pressed on node n moves focus there from Find box id. */
async function press(app, id, n, type) { app.fire('pointerdown', { target: n, pointerType: type || 'mouse', buttons: 1 }); app.doc.activeElement = n; app.fire('focusout', { target: box(id) }); await app.tick(10); }
/* Checklists removed from the folder by a newer read, so a list that needed Find no longer does. */
async function shrink(app) { await arrive(app, app.files('publications/proc-00').filter(f => /proc-00[1-6]/.test(f)).map(f => [f, null])); await settle(app); }
async function heldFu(app) {
  app.fire('focusin', { target: box('fu') }); app.click('fu-filter', 'mine'); await settle(app);
  app.doc.activeElement = app.el('find-fu');
  assert.ok(/id="find-fu"/.test(app.html()) && app.PF.vk.findHeld.fu, 'set-up: drawn for its focus alone');
}
async function enter(app, id) { app.doc.activeElement = app.el('find-' + id); app.fire('focusin', { target: box(id) }); await app.tick(5); }
async function leave(app, id, to) { app.doc.activeElement = to || summary; app.fire('focusout', { target: box(id) }); await app.tick(10); }

/* ---------- F1: leaving a Find box ---------- */
rule('Walkthrough: leaving a Find box that stays drawn (Checklists, Follow-ups, Settings) draws nothing, so the click that left it lands on what it pressed', async () => {
  const app = await freshT(small({ procs: 60 }));
  for (const [nav, id] of [['processes', 'processes'], ['followups', 'fu'], ['settings', 'people']]) {
    app.click('nav', nav); await app.tick(10);
    assert.ok(new RegExp('id="find-' + id + '"').test(app.html()), 'set-up: ' + nav + ' draws Find');
    await enter(app, id); await settle(app);
    const was = renders(app), h = app.html();
    app.fire('pointerdown', {}); await leave(app, id); app.fire('pointerup', {}); await app.tick(5);
    assert.strictEqual(renders(app), was, nav + ': the press that left the box redrew nothing (a redraw replaced the fold it pressed)');
    assert.strictEqual(app.html(), h, nav + ': the page is as it was');
    await enter(app, id); await typeFind(app, id, 'zz'); await settle(app);
    const was2 = renders(app);
    await leave(app, id);
    assert.strictEqual(renders(app), was2, nav + ': with text, leaving by the keyboard redraws nothing either');
    assert.ok(new RegExp('id="find-' + id + '"[^>]*value="zz"').test(app.html()), nav + ': the Find text is kept');
    app.click('find-clear', id); await app.tick(5);
    await leave(app, id);
  }
});

rule('Walkthrough: a Find box drawn for its focus alone goes when it\'s left: at once by the keyboard, and only once a pressed pointer is released', async () => {
  const app = await freshT(small({ followUps: 0 }));
  app.click('nav', 'followups'); await app.tick(10);
  app.click('fu-filter', 'mine'); await settle(app);
  assert.ok(!/id="find-fu"/.test(app.html()), 'set-up: none of them is yours, no Find');
  /* Focus in the box (kept from a longer list) draws it with nothing to find. */
  await heldFu(app);
  app.fire('pointerdown', { pointerType: 'mouse', buttons: 1 });
  const was = renders(app);
  await leave(app, 'fu');
  assert.strictEqual(renders(app), was, 'nothing is redrawn while the pointer is still pressed');
  assert.ok(/id="find-fu"/.test(app.html()), 'the box is still there under the press');
  app.fire('pointerup', { pointerType: 'mouse' }); await app.tick(5);
  assert.ok(!/id="find-fu"/.test(app.html()), 'released: the box goes');
  await heldFu(app);
  const was2 = renders(app);
  await leave(app, 'fu', app.doc.body);
  assert.strictEqual(renders(app), was2 + 1, 'left by the keyboard: one redraw');
  assert.ok(!/id="find-fu"/.test(app.html()), 'left by the keyboard: it goes at once');
});

/* ---------- code review round 24: the box goes after the click, never under it ---------- */
rule('Round 24: Export evidence: with the checklists cut below 51 under a focused, empty Find, one click on Check what\'s included lands and runs', async () => {
  const app = await freshT(small({ procs: 60 }));
  app.click('nav', 'runs'); await app.tick(10);
  app.click('ev-range'); await settle(app);
  assert.ok(/id="find-ev-proc"/.test(app.overlay()), 'set-up: over 50 checklists, Find');
  app.set('ev-proc', 'proc-0001').set('ev-from', '2000-01-01').set('ev-through', '2099-12-31');
  await enter(app, 'ev-proc');
  await shrink(app);
  assert.ok(/id="find-ev-proc"/.test(app.overlay()) && app.PF.vk.findHeld['ev-proc'], 'set-up: 50 or fewer left; the box is drawn for its focus alone');
  const btn = app.node('[data-act="ev-check"]'), was = renders(app);
  await press(app, 'ev-proc', btn);
  app.fire('pointerup', { target: btn, pointerType: 'mouse' });
  assert.ok(live(btn), 'the pressed button is still in the dialog when its click comes');
  assert.strictEqual(renders(app), was, 'nothing redrawn between the press and the click');
  /* A browser clicks only a button still on the page. */
  if (live(btn)) app.fire('click', { target: btn });
  await settle(app);
  assert.ok(!/data-act="ev-check"/.test(app.overlay()), 'the click ran Check what\'s included: the dialog moved on');
  assert.ok(!/id="find-ev-proc"/.test(app.overlay()), 'and the Find box is gone');
  app.click('close-overlay'); await settle(app);
});

rule('Round 24: a fold on the page (the editor\'s More options) pressed out of a Find box drawn for its focus alone opens on one click, then the box goes in one redraw', async () => {
  const app = await freshT(small({ procs: 60 }));
  await app.fs.write('maps/drafts/linker.md', '---\nprocess: linker\ntitle: Linker\nowner: person-avery\n---\n\n## Build · READ-DO {#build}\n- [ ] {run.process} Run the child {#s}\n  process: proc-0001\n');
  app.click('nav', 'processes'); await app.tick(5); app.focus(); await settle(app);
  app.click('open-process', 'linker'); await app.tick(10); app.click('ptab', 'edit'); await app.tick(10);
  app.click('ed-mode', 'builder'); await app.tick(10); app.click('ob-sel', 's'); await settle(app);
  assert.ok(/id="find-ob-link-proc"/.test(app.html()), 'set-up: the linked checklist\'s Find, over 50 checklists');
  await enter(app, 'ob-link-proc');
  await shrink(app);
  assert.ok(/id="find-ob-link-proc"/.test(app.html()) && app.PF.vk.findHeld['ob-link-proc'], 'set-up: 50 or fewer left; the box is drawn for its focus alone');
  assert.ok(/<details class="ob-more-opts" data-disc="ob-more">/.test(app.html()), 'set-up: More options drawn shut');
  const sum = app.node('[data-disc="ob-more"] summary'), was = renders(app);
  await press(app, 'ob-link-proc', sum);
  app.fire('pointerup', { target: sum, pointerType: 'mouse' });
  assert.ok(live(sum), 'the pressed fold is still on the page when its click comes');
  assert.strictEqual(renders(app), was, 'nothing redrawn between the press and the click');
  if (live(sum)) app.fire('click', { target: sum });
  /* The browser fires the fold's toggle on a later turn; the redraw waits for it, or it would draw the fold shut again. */
  await app.tick(10);
  assert.strictEqual(renders(app), was, 'not redrawn before the fold\'s toggle');
  const d = app.node('[data-disc="ob-more"]'); d.open = true; app.fire('toggle', { target: d });
  await app.tick(10); await settle(app);
  assert.strictEqual(renders(app), was + 1, 'one redraw, after the toggle');
  assert.ok(/<details class="ob-more-opts" data-disc="ob-more" open>/.test(app.html()), 'More options is drawn open, as the click left it');
  assert.ok(!/id="find-ob-link-proc"/.test(app.html()), 'the box is gone');
});

rule('Round 24: a press canceled (pointercancel) under a Find box drawn for its focus alone: the box goes in one redraw, after the event', async () => {
  const app = await freshT(small({ followUps: 0 }));
  app.click('nav', 'followups'); await app.tick(10);
  app.click('fu-filter', 'mine'); await settle(app);
  await heldFu(app);
  const chip = app.node('[data-act="fu-filter"][data-id="all"]'), was = renders(app);
  await press(app, 'fu', chip, 'touch');
  app.fire('pointercancel', { target: chip, pointerType: 'touch' });
  assert.strictEqual(renders(app), was, 'not redrawn while the cancel is dispatched');
  await app.tick(10);
  assert.strictEqual(renders(app), was + 1, 'one redraw once it has been');
  assert.ok(!/id="find-fu"/.test(app.html()), 'the box is gone');
  await settle(app);
  assert.strictEqual(renders(app), was + 1, 'and no other');
});

rule('Round 24: a press dragged off its control (no click) under a Find box drawn for its focus alone: the box goes in one redraw, by mouse, by touch and when the release is never heard', async () => {
  const app = await freshT(small({ followUps: 0 }));
  app.click('nav', 'followups'); await app.tick(10);
  app.click('fu-filter', 'mine'); await settle(app);
  /* Mouse: no click follows in the release's turn, so it goes on the next. */
  await heldFu(app);
  let chip = app.node('[data-act="fu-filter"][data-id="all"]'), was = renders(app);
  await press(app, 'fu', chip);
  app.fire('pointerup', { target: app.doc.body, pointerType: 'mouse' });
  assert.strictEqual(renders(app), was, 'mouse: not redrawn while the release is dispatched');
  await app.tick(10);
  assert.strictEqual(renders(app), was + 1, 'mouse: one redraw after it');
  assert.ok(!/id="find-fu"/.test(app.html()), 'mouse: the box is gone');
  await settle(app);
  assert.strictEqual(renders(app), was + 1, 'mouse: and no other');
  /* Touch: a tap's click can come on a later turn, so it waits a moment for one, then goes without it. */
  await heldFu(app);
  chip = app.node('[data-act="fu-filter"][data-id="all"]'); was = renders(app);
  await press(app, 'fu', chip, 'touch');
  app.fire('pointerup', { target: app.doc.body, pointerType: 'touch' });
  await app.tick(10);
  assert.strictEqual(renders(app), was, 'touch: still waiting for a click');
  assert.ok(live(chip), 'touch: what was pressed is still on the page');
  app.advanceTimers(400); await app.tick(10);
  assert.strictEqual(renders(app), was + 1, 'touch: one redraw when none came');
  assert.ok(!/id="find-fu"/.test(app.html()), 'touch: the box is gone');
  await settle(app);
  assert.strictEqual(renders(app), was + 1, 'touch: and no other');
  /* A release the page never heard (outside the window): the next key lets it go. */
  await heldFu(app);
  chip = app.node('[data-act="fu-filter"][data-id="all"]'); was = renders(app);
  await press(app, 'fu', chip);
  await settle(app);
  assert.ok(/id="find-fu"/.test(app.html()), 'unheard release: kept while the press may still be held');
  app.keyOn('Shift', {}, chip); await app.tick(10);
  assert.strictEqual(renders(app), was, 'unheard release: Shift alone (held for a click) lets nothing go');
  app.keyOn('Tab', {}, chip);
  await app.tick(10); await settle(app);
  assert.strictEqual(renders(app), was + 1, 'unheard release: one redraw after the next key');
  assert.ok(!/id="find-fu"/.test(app.html()), 'unheard release: the box is gone');
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
