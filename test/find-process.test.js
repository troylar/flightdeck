// Find things in big folders (2.11), slice 4: the process page and How runs go. Corrections paged across groups and their
// reveals, the run's corrections and reports, Finish and Receipt, Join, versions, stages, incomplete publications, Compare
// versions, the roles grid and Each phase, on the big folder (test/bounds-fixture.js).
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const fs = require('fs');
const path = require('path');
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
/* A newer read of the folder, as the app's own Check the folder now does it. */
async function reread(app) {
  const was = app.PF.perf.n['load.done'] || 0;
  app.click('refresh');
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(5);
}
function moreOf(html, id) {
  const m = new RegExp('<button[^>]*data-act="more" data-id="' + id.replace(/[-/:.]/g, '\\$&') + '"([^>]*)>').exec(html); if (!m) return null;
  const d = {}; m[1].replace(/data-([\w-]+)="([^"]*)"/g, (x, k, v) => { d[k] = un(v); return x; }); return d;
}
async function more(app, id, h) { const d = moreOf(h || app.html(), id); assert.ok(d, 'a Show more for ' + id); app.click('more', id, d); await app.tick(5); return d; }
const typeFind = async (app, id, v) => { app.set('find-' + id, v); app.input('find-' + id, v); await app.tick(5); };
const ids = (h, re) => [...h.matchAll(re)].map(m => un(m[1]));
const liText = (h, id) => { const i = h.indexOf('id="' + id + '"'); return i < 0 ? '' : h.slice(i, h.indexOf('</li>', i)); };
const count = (h, re) => (h.match(re) || []).length;
const fxGroups = h => ids(h, /<li data-scope="corr:[^"]*" id="fxg-([^"]+)"/g);
const fxMembers = h => ids(h, /id="fxm-([^"]+)" tabindex="-1"/g);
const sxBox = app => { const q = app.el('sx-q'); q.tagName = 'INPUT'; q.type = 'search'; return q; };
async function search(app, text) { app.click('search'); await app.tick(10); sxBox(app); app.input('sx-q', text); await app.tick(400); return ids(app.overlay(), /role="option"[^>]*data-id="([^"]+)"/g); }
const perfDelta = async (app, keys, fn) => { const was = {}; keys.forEach(k => { was[k] = app.PF.perf.n[k] || 0; }); const r0 = app.PF.perf.n.render || 0; await fn(); const out = { draws: (app.PF.perf.n.render || 0) - r0 }; keys.forEach(k => { out[k] = (app.PF.perf.n[k] || 0) - was[k]; }); return out; };
async function openProc(app, id, tab) {
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', id); await app.tick(10);
  if (tab) { app.click('ptab', tab); await app.tick(10); }
}
async function corrections(app, id, filter) {
  await openProc(app, id);
  app.fire('toggle', { target: { dataset: { disc: 'fx:' + id }, open: true } }); app.click('dismiss'); await app.tick(5);
  if (filter) { app.click('corr-filter', filter); await app.tick(5); }
}
async function openRun(app, key, step) {
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', fixture().facts[key] || key); await app.tick(10);
  if (step) { app.click('select', step); await app.tick(10); }
}
const C = () => fixture() && require('./harness').load().corrections;

/* ---------- Process › Corrections ---------- */
rule('Corrections: 400 members of one group draw 50, each with its whole Why, and Show more focuses the first one it adds', async () => {
  const app = await bigApp(); await corrections(app, 'versions');
  let h = app.html();
  assert.strictEqual(fxMembers(h).length, 50, 'a page of members');
  assert.strictEqual(fxGroups(h).length, 1, 'in their one group');
  for (let i = 0; i < 50; i++) assert.ok(new RegExp('<dd>Member ' + i + '</dd>').test(h), 'member ' + i + '\'s whole Why');
  assert.ok(/350 more in this group/.test(h), 'what isn\'t drawn is counted');
  const d = await more(app, 'fx:versions');
  h = app.html();
  assert.strictEqual(fxMembers(h).length, 100);
  assert.ok(d.focus && app.node(d.focus) && app.doc.activeElement === app.node(d.focus), 'focus on the first added member: ' + d.focus);
  /* The 51st member, by an id from its own note (2.11), never its place in the group. */
  assert.ok(d.focus === '[id="fxm-' + fxMembers(h)[50] + '"]' && /#[0-9a-f]{16}$/.test(fxMembers(h)[50]), d.focus + ' ' + fxMembers(h)[50]);
  app.click('corr-filter', 'open'); await app.tick(5);
});

rule('Corrections: the decline box on group 200 keeps its text through Show more, a newer read that decides it elsewhere keeps it under Open, marked', async () => {
  const app = await fresh(); await corrections(app, 'busy');
  for (let i = 0; i < 4; i++) await more(app, 'fx:busy');
  const gid = fxGroups(app.html())[200];
  app.click('pick', gid, { kind: 'corr-decline' }); await app.tick(5);
  assert.strictEqual(app.activeId(), 'pick-input', 'the box is focused when it opens');
  app.set('pick-input', 'Not for this checklist');
  app.click('corr-filter', 'open'); await app.tick(5);
  let h = app.html();
  assert.ok(fxGroups(h).length <= 52 && fxGroups(h).indexOf(gid) >= 0, 'back to the first page, with the group kept');
  assert.ok(/id="pick-input"[^>]*data-id="/.test(h) && app.draft('pick-input') === 'Not for this checklist', 'the box and its text');
  assert.ok(/You&#39;re declining this one/.test(h));
  const d = await more(app, 'fx:busy');
  assert.ok(app.doc.activeElement === app.node(d.focus), 'Show more\'s focus isn\'t taken back by the box (focusWins)');
  assert.strictEqual(app.draft('pick-input'), 'Not for this checklist');
  /* Decided on another computer. */
  const D = app.PF.corrections.decision({ process: 'busy', id: gid, members: [{ id: 'c0200' }] }, 'person-blake', 'applied', '', '2026-10-27T09:00:00.000Z', {});
  await app.fs.write('corrections/busy/' + gid + '.w-other.1.json', JSON.stringify(D, null, 2) + '\n');
  await reread(app);
  h = app.html();
  assert.ok(fxGroups(h).indexOf(gid) >= 0, 'still drawn under Open');
  assert.ok(/No longer open:<\/b> [^<]*by Blake Ortiz/.test(h), 'marked as no longer open: ' + (/fx-gone[^<]*<b>[^<]*<\/b>[^<]*/.exec(h) || [''])[0]);
  assert.strictEqual(app.draft('pick-input'), 'Not for this checklist', 'the text is kept');
});

rule('Corrections: two correction search hits past page 1 each land on their own group, Open still on after the reveal and after Back; Home\'s View change lands on its group', async () => {
  const app = await fresh();
  await corrections(app, 'busy');
  const gs = fxGroups(app.html());
  for (let i = 0; i < 5; i++) await more(app, 'fx:busy');
  const all = fxGroups(app.html()), a = all[120], b = all[260];
  for (const [gid, reason] of [[a, 'Too wordy for us'], [b, 'Not how we work']]) {
    const n = all.indexOf(gid), D = app.PF.corrections.decision({ process: 'busy', id: gid, members: [{ id: 'c' + String(n).padStart(4, '0') }] }, 'person-blake', 'declined', reason, '2026-10-27T09:00:00.000Z', {});
    await app.fs.write('corrections/busy/' + gid + '.w-other.1.json', JSON.stringify(D, null, 2) + '\n');
  }
  await reread(app);
  for (const [gid, word] of [[a, 'wordy'], [b, 'how we work']]) {
    app.click('nav', 'home'); await app.tick(5);
    const hits = await search(app, word), hit = hits.find(x => /^corr:/.test(x));
    assert.ok(hit, 'set-up: a decision result: ' + hits.join(', '));
    app.click('sx-open', hit); await app.tick(20);
    const h = app.html();
    assert.ok(fxGroups(h).indexOf(gid) >= 0 && fxGroups(h).length <= 51, 'its group is drawn, with the first page: ' + fxGroups(h).length);
    assert.strictEqual(app.activeId(), 'fxg-' + gid, 'focus on its group');
    assert.ok(/data-act="corr-filter" data-id="open" aria-pressed="true"/.test(h), 'Open stays on');
    app.click('dismiss'); await app.tick(5);
    assert.strictEqual(app.activeId(), 'fxg-' + gid, 'and stays there after another render');
    app.back(); await app.settle(); app.forward(); await app.settle();
    assert.ok(/data-act="corr-filter" data-id="open" aria-pressed="true"/.test(app.html()), 'Open still on after Back and Forward');
  }
  /* A generic process result still focuses the page heading. */
  const hits = await search(app, 'busy run');
  const ph = hits.find(x => /^proc:|^pub:|^process:/.test(x));
  if (ph) { app.click('sx-open', ph); await app.tick(20); assert.strictEqual(app.activeId(), 'page-h'); }
  /* Home's View change for a group past page 1. */
  app.click('nav', 'home'); await app.tick(5);
  app.click('ack-view', 'x', { process: 'busy', group: b }); await app.tick(10);
  assert.ok(fxGroups(app.html()).indexOf(b) >= 0, 'View change draws its group');
  assert.strictEqual(app.activeId(), 'fxg-' + b, 'and focuses it');
  void gs;
});

rule('Corrections: phase and gate note corrections found by search, past page 1, land on their process group with the filter unchanged', async () => {
  const app = await fresh();
  const Cc = app.PF.corrections, key = fixture().facts.busy;
  const r = JSON.parse(app.fs.files['runs/' + key + '/run.json'].t), cmap = app.PF.run.mapOf(r);
  const notes = [
    Cc.build({ id: 'phx1', at: '2026-10-27T08:00:00.000Z', by: 'person-blake', session: 'ph', map: cmap, version: +r.version, folder: r.folder, phase: 'ph2', op: 'describe', why: 'Phase two runs long every time' }),
    Cc.build({ id: 'gtx1', at: '2026-10-27T08:01:00.000Z', by: 'person-blake', session: 'ph', map: cmap, version: +r.version, folder: r.folder, gate: 'g1', op: 'describe', why: 'The gate after phase one is unclear' })
  ];
  await app.fs.write('runs/' + key + '/notes-ph.jsonl', notes.map(n => JSON.stringify(n)).join('\n') + '\n');
  await reread(app);
  for (const [word, nid] of [['runs long every time', 'phx1'], ['gate after phase one', 'gtx1']]) {
    app.click('nav', 'home'); await app.tick(5);
    const hits = await search(app, word), hit = hits.find(x => x.indexOf(':' + nid) >= 0);
    assert.ok(hit, 'set-up: the note: ' + hits.join(', '));
    app.click('sx-open', hit); await app.tick(20);
    const h = app.html();
    assert.ok(/aria-labelledby="fx-h"|data-disc="fx:busy" open/.test(h), 'on the checklist\'s Corrections');
    assert.ok(/^fxg-/.test(app.activeId()), 'focus on a group: ' + app.activeId());
    assert.ok(new RegExp(word).test(h), 'its own group is drawn');
    assert.ok(/data-act="corr-filter" data-id="open" aria-pressed="true"/.test(h), 'the filter unchanged');
  }
});

rule('Corrections: twins on a phase\'s note and a gate\'s, sharing id, author, time, reason and wording, each open their own group', async () => {
  const app = await fresh();
  const Cc = app.PF.corrections, key = fixture().facts.busy;
  const r = JSON.parse(app.fs.files['runs/' + key + '/run.json'].t), cmap = app.PF.run.mapOf(r);
  const b = o => Cc.build(Object.assign({ id: 'pgtwin', at: '2026-10-27T08:00:00.000Z', by: 'person-blake', session: 'ph', map: cmap, version: +r.version, folder: r.folder, op: 'wording', to: 'Same new wording for both', why: 'Same reason for both' }, o));
  await app.fs.write('runs/' + key + '/notes-pg.jsonl', [b({ phase: 'ph2' }), b({ gate: 'g1' })].map(n => JSON.stringify(n)).join('\n') + '\n');
  await reread(app);
  const hits = (await search(app, 'Same reason for both')).filter(x => /:pgtwin#/.test(x));
  assert.strictEqual(hits.length, 2, 'set-up: two results: ' + hits.join(', '));
  const opened = [];
  for (const [hit, heading] of [[hits.find(x => /#1$/.test(x)), 'Phase: Phase 2'], [hits.find(x => /#2$/.test(x)), 'Gate: Phase one checked']]) {
    app.click('nav', 'home'); await app.tick(5); await search(app, 'Same reason for both');
    app.click('sx-open', hit); await app.tick(20);
    const h = app.html(), id = app.activeId(), at = h.indexOf('id="' + id + '"'), hs = h.lastIndexOf('<h3 class="fixgroup">', at);
    assert.ok(/^fxg-/.test(id), 'a group is focused: ' + id);
    assert.strictEqual(h.slice(hs + 21, h.indexOf('</h3>', hs)), heading, 'the group for its own target');
    opened.push(id);
  }
  assert.notStrictEqual(opened[0], opened[1], 'two groups');
});

/* ---------- the Markdown editor and the run's corrections ---------- */
rule('Corrections: 300 open in the Markdown editor draw 50; 300 on one run step draw 20 in the inspector', async () => {
  const app = await bigApp();
  await openProc(app, 'busy', 'edit');
  app.click('flight', 'md'); await app.tick(10);
  app.fire('toggle', { target: { dataset: { disc: 'md-corr' }, open: true } }); app.click('dismiss'); await app.tick(5);
  assert.strictEqual(count(app.html(), /<li id="mdc-/g), 50);
  await more(app, 'md-corr:busy');
  assert.strictEqual(count(app.html(), /<li id="mdc-/g), 100);
  await openRun(app, 'busy', 's0');
  const h = app.html();
  assert.strictEqual(count(h.slice(h.indexOf('rw-corr')), /<li class="corr" id="corr-/g), 20, 'a page of the step\'s corrections');
});

rule('Corrections: a search hit on correction 100 of a step lands on its corr-<id> row in the inspector, apart from ordinary-note hits', async () => {
  const app = await bigApp();
  app.click('nav', 'home'); await app.tick(5);
  const hits = await search(app, 'worded 100'), hit = hits.find(x => /:c0100#/.test(x));
  assert.ok(hit, hits.join(', '));
  app.click('sx-open', hit); await app.tick(20);
  let h = app.html();
  assert.ok(/id="corr-c0100"/.test(h), 'its row is drawn');
  assert.ok(count(h, /<li class="corr" id="corr-/g) <= 21, 'with at most 21 drawn');
  assert.strictEqual(app.activeId(), 'corr-c0100', 'and focused');
  /* An ordinary note lands on the step, not on a corrections row. */
  app.click('nav', 'home'); await app.tick(5);
  const nh = (await search(app, 'Note 250 on the busy step')).find(x => /:n0250#/.test(x));
  assert.ok(nh);
  app.click('sx-open', nh); await app.tick(20);
  assert.ok(!/^corr-/.test(app.activeId()), 'not a corrections row: ' + app.activeId());
});

rule('Corrections: View correction for correction 100 of a step focuses its row, with at most 21 drawn', async () => {
  const app = await bigApp(); await openRun(app, 'busy', 's0');
  assert.ok(!/id="corr-c0100"/.test(app.html()), 'set-up: past the page');
  app.click('goto-corr', 'corr-c0100'); await app.tick(10);
  const h = app.html();
  assert.ok(/id="corr-c0100"/.test(h) && count(h, /<li class="corr" id="corr-/g) <= 21);
  assert.strictEqual(app.activeId(), 'corr-c0100');
  assert.ok(app.asked().some(s => /corr-c0100/.test(s)), 'brought into view');
});

rule('Corrections: a correction saved as the newest on a step with 300, and a Done differently one, are drawn with at most 21', async () => {
  const app = await fresh(); await openRun(app, 'busy');
  app.click('takeover'); await app.tick(40); app.click('select', 's0'); await app.tick(10);
  const key = fixture().facts.busy, notes = () => app.files('runs/' + key + '/').filter(f => /notes-/.test(f)).flatMap(f => app.fs.files[f].t.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return {}; } }));
  const was = new Set(notes().map(n => n.id));
  app.click('corr-open', 's0', { mode: 'correct' }); await app.tick();
  app.input('corr-to', 'Busy step 0, with a new wording'); app.input('corr-why', 'Saved as the newest'); app.click('corr-save', 's0'); await app.tick(80);
  let n = notes().filter(x => x.kind === 'correction' && !was.has(x.id))[0];
  assert.ok(n, 'saved');
  let h = app.html();
  assert.ok(new RegExp('id="corr-' + n.id + '"').test(h), 'drawn');
  assert.ok(count(h, /<li class="corr" id="corr-/g) <= 21, 'at most 21');
  assert.strictEqual(app.activeId(), 'corr-' + n.id, 'focused');
  was.add(n.id);
  app.click('corr-open', 's0', { mode: 'differently' }); await app.tick();
  app.input('corr-happened', 'Did it by hand'); app.click('corr-scope', 'fix'); await app.tick();
  app.input('corr-to', 'Busy step 0, done by hand'); app.click('corr-done', 's0'); await app.tick(120);
  n = notes().filter(x => x.kind === 'correction' && !was.has(x.id))[0];
  assert.ok(n, 'the Done differently correction is saved');
  app.click('select', 's0'); await app.tick(10);
  h = app.html();
  assert.ok(/data-act="goto-corr"/.test(h), 'View correction is offered');
  app.click('goto-corr', 'corr-' + n.id); await app.tick(10);
  h = app.html();
  assert.ok(new RegExp('id="corr-' + n.id + '"').test(h) && count(h, /<li class="corr" id="corr-/g) <= 21, 'View correction draws it, at most 21');
});

/* ---------- Finish and Receipt ---------- */
rule('Finish and Receipt with 300 corrections draw 50 each; Receipt with 300 reports formats 50 per draw, and Copy has all of both', async () => {
  const app = await fresh(); await openRun(app, 'busy');
  app.click('takeover'); await app.tick(40);
  app.click('finish'); await app.tick(10);
  let h = app.html();
  assert.strictEqual(count(h, /<li class="corr" id="corr-/g), 50, 'Finish: 50 corrections');
  const lines = app.PF.reports.lines; let fed = 0;
  app.PF.reports.lines = function (list) { fed += list.length; return lines.apply(this, arguments); };
  try {
    app.click('receipt'); await app.tick(10);
    h = app.html();
    assert.strictEqual(count(h, /<li class="corr" id="corr-/g), 50, 'Receipt: 50 corrections');
    assert.strictEqual(count(h, /<div class="rrow rr-rep"/g), 50, 'Receipt: 50 report lines');
    const draws = app.PF.perf.n.render || 0; fed = 0;
    app.click('dismiss'); await app.tick(5);
    assert.ok(fed <= 50 * Math.max(1, (app.PF.perf.n.render || 0) - draws), 'formats only the drawn reports: ' + fed);
    const pre = app.el('receipt-text'); try { app.click('copy-receipt'); } catch (e) { /* no createRange in the harness */ }
    const text = pre.textContent || '';
    assert.ok(/Reports · 30\d/.test(text), 'Copy names every report');
    assert.ok(count(text, /ci-check\/r\d{7}/g) >= 300, 'and lists all 300: ' + count(text, /ci-check\/r\d{7}/g));
    assert.ok(/Corrections · 30\d/.test(text), 'and every correction');
    assert.ok(count(text, /worded \d+/g) >= 300, 'all 300 corrections: ' + count(text, /worded \d+/g));
  } finally { app.PF.reports.lines = lines; }
});

/* The example release with 51 corrections on its first step, the first and the last sharing an id. */
async function twinCorrections(html) {
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, html ? { html } : { domFocus: true })); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const r = app.run(), dir = r.path.replace(/run\.json$/, ''), map = app.PF.run.mapOf(r.json), Cc = app.PF.corrections, st = map.phases[0].steps[0].id;
  const list = Array.from({ length: 51 }, (x, i) => Cc.build({ id: i === 50 ? 'ctw0' : 'ctw' + i, at: '2026-01-01T10:' + String(i).padStart(2, '0') + ':00.000Z', by: 'person-blake', session: 'other', map, version: +r.json.version, folder: r.json.folder, step: st, op: 'wording', to: 'Worded ' + i, why: 'Reason ' + i }));
  await app.fs.write(dir + 'notes-other.jsonl', list.map(x => JSON.stringify(x)).join('\n') + '\n');
  await reread(app);
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', r.key); await app.tick(10);
  for (const act of ['pickup', 'takeover']) if (new RegExp('data-act="' + act + '"').test(app.html())) { app.click(act); await app.tick(40); }
  return { app, key: r.key };
}
function receiptCopy(app) {
  const pre = app.el('receipt-text'); try { app.click('copy-receipt'); } catch (e) { /* no createRange in the harness */ }
  /* 2.10.0 drew the text in the page; 2.11 makes it when copied. The run's id is random per boot. */
  const m = /<pre id="receipt-text"[^>]*>([\s\S]*?)<\/pre>/.exec(app.html()), text = pre.textContent || (m ? un(m[1]) : '');
  return text.replace(/ · run [a-z0-9]+\n/, ' · run X\n').replace(/captured [^·]+·/, 'captured X ·');
}
rule('Finish and Receipt: 51 corrections on a step, the last sharing the first\'s id; Show more draws it with its own id and focuses it, and Copy for Jira is byte for byte 2.10.0\'s', async () => {
  const { app, key } = await twinCorrections();
  const rows = h => ids(h, /<li class="corr" id="(corr-[^"]+)"/g);
  for (const [page, list] of [['finish', 'fin-corr:' + key], ['receipt', 'rcpt-corr:' + key]]) {
    app.click(page); await app.tick(10);
    let h = app.html();
    assert.strictEqual(rows(h).length, 50, page + ': 50');
    const d = await more(app, list, h);
    assert.strictEqual(d.focus, '[id="corr-ctw0#2"]', page + ': Show more names the twin by its own id');
    h = app.html();
    const r = rows(h), n = +/Corrections · (\d+)</.exec(h)[1];
    assert.ok(n > 50 && r.length === n, page + ': all ' + n + ' (the example\'s own too): ' + r.length);
    assert.strictEqual(new Set(r).size, n, page + ': every row its own id');
    assert.strictEqual(app.activeId(), 'corr-ctw0#2', page + ': the twin is focused, not the first correction');
    assert.ok(liText(h, 'corr-ctw0#2').indexOf('Worded 50') >= 0 && liText(h, 'corr-ctw0').indexOf('Worded 0') >= 0, page + ': each with its own wording');
    if (page === 'finish') { app.click('exit-mission'); await app.tick(10); }
  }
  const now = receiptCopy(app);
  assert.ok(/Corrections · 5\d/.test(now) && /Worded 50/.test(now) && /Worded 0\b/.test(now), 'the copied text has every correction');
  const OB = require('../tools/old-bundles'), old = OB.get('v2.10.0');
  if (!old) return;
  const was = await twinCorrections(old.files['flightdeck.html']);
  was.app.click('receipt'); await was.app.tick(10);
  assert.strictEqual(now, receiptCopy(was.app), 'Copy for Jira is the text 2.10.0 copies');
});

rule('1,000 archived answers on a step draw 20, and Show more adds 20', async () => {
  const app = await bigApp(); await openRun(app, 'busy', 's0');
  app.click('load-history'); await app.tick(60);
  const h = app.html();
  assert.ok(/Archived answers \(1000\)/.test(h), 'set-up: the archive is read');
  assert.strictEqual(count(h, /<li id="arch-s0-/g), 20);
  await more(app, 'arch:' + fixture().facts.busy + ':s0');
  assert.strictEqual(count(app.html(), /<li id="arch-s0-/g), 40);
});

/* ---------- Reports ---------- */
/* Report n on the busy run's step 1 (r0000000 to r0000299), and its card's id (from its key, 2.11). */
const repKey = n => fixture().facts.busy + '/s0/ci-check/r' + String(n).padStart(7, '0');
const cardOf = (app, n) => app.PF.views.reportCardId(repKey(n));
/* The cards drawn, as the numbers of their reports. */
const cardKeys = (app, h) => { const at = {}; for (let i = 0; i < 300; i++) at[cardOf(app, i)] = String(i); return ids(h, /<section class="rep-card[^"]*" aria-labelledby="(rep-[0-9a-f]+)-h"/g).map(x => at[x]); };
rule('Reports: 300 on a step draw 20 panel rows and 20 cards, each built once per draw, in the order 2.10 draws them', async () => {
  const app = await bigApp(); await openRun(app, 'busy', 's0');
  const d = await perfDelta(app, ['rep.card', 'rep.row'], async () => { app.click('dismiss'); await app.tick(5); });
  const h = app.html();
  assert.strictEqual(count(h, /<section class="rep-card/g), 20, '20 cards');
  assert.ok(d['rep.card'] <= 20 * d.draws, 'cards built once each: ' + JSON.stringify(d));
  assert.deepStrictEqual(cardKeys(app, h), Array.from({ length: 20 }, (x, i) => String(i)), 'in 2.10\'s order');
  const order = ids(h, /data-act="rep-goto" data-id="step-s0" data-report="([^"]+)"/g);
  const all = app.PF.reports && (await (async () => order)());
  assert.ok(order.length <= 20, 'panel rows on the page: ' + order.length);
  void all;
});

rule('Reports: an open decline form on report 150 keeps its reason through Show more and a newer read, and reasons on 150 and 220 are kept apart and drawn after leaving', async () => {
  const app = await fresh(); await openRun(app, 'busy');
  app.click('takeover'); await app.tick(40); app.click('select', 's0'); await app.tick(10);
  const lid = 'repcards:' + fixture().facts.busy + ':s0';
  for (let i = 0; i < 11; i++) await more(app, lid);
  const keyOf = n => (new RegExp('aria-labelledby="' + cardOf(app, n) + '-h"[\\s\\S]*?data-act="rep-decline" data-id="([^"]+)"').exec(app.html()) || [])[1];
  const k150 = un(keyOf(150) || ''), k220 = un(keyOf(220) || '');
  assert.ok(k150 && k220, 'set-up: both drawn');
  const rid = k => app.PF.reports.reasonId(k);
  app.click('rep-decline', k220); await app.tick(5); app.set(rid(k220), 'Wrong build for 220');
  app.click('rep-decline', k150); await app.tick(5); app.set(rid(k150), 'Wrong build for 150');
  app.click('select', 's1'); await app.tick(5); app.click('select', 's0'); await app.tick(10);
  let h = app.html();
  assert.ok(new RegExp('id="' + rid(k150) + '"').test(h), 'report 150\'s box is drawn');
  assert.strictEqual(app.draft(rid(k150)), 'Wrong build for 150');
  await more(app, lid);
  assert.strictEqual(app.draft(rid(k150)), 'Wrong build for 150', 'through Show more');
  await reread(app);
  assert.strictEqual(app.draft(rid(k150)), 'Wrong build for 150', 'through a newer read');
  /* Leaving and coming back. */
  app.click('nav', 'home'); await app.tick(5); await openRun(app, 'busy', 's0');
  h = app.html();
  assert.ok(count(h, /<section class="rep-card/g) <= 20 + 2, 'a page, and the two with reasons: ' + count(h, /<section class="rep-card/g));
  assert.ok(new RegExp('id="' + rid(k150) + '"').test(h) && /Wrong build for 150/.test(h), 'report 150\'s reason is drawn again (repPick null)');
  assert.ok(new RegExp('id="' + rid(k220) + '"').test(h) && /Wrong build for 220/.test(h), 'report 220 keeps its own');
});

/* The Reports panel toggles, and the shared app keeps it as an earlier rule left it: open it only if it's closed. */
async function reportsOpen(app) { if (!/data-act="rep-goto"/.test(app.html() + app.overlay())) { app.click('run-reports'); await app.tick(10); } }
rule('Reports: the panel links for reports 150 and 220 each open and focus their own card', async () => {
  const app = await bigApp(); await openRun(app, 'busy', 's1');
  const pl = 'reppanel:' + fixture().facts.busy;
  await reportsOpen(app);
  for (let i = 0; i < 11 && moreOf(app.html() + app.overlay(), pl); i++) { app.click('more', pl, moreOf(app.html() + app.overlay(), pl)); await app.tick(5); }
  const all = app.html() + app.overlay(), keys = ids(all, /data-act="rep-goto" data-id="step-s0" data-report="([^"]+)"/g);
  assert.ok(keys.length >= 221, 'set-up: the panel reaches report 220: ' + keys.length);
  for (const n of [150, 220]) {
    app.click('rep-goto', 'step-s0', { report: keys[n] }); await app.tick(10);
    const h = app.html();
    const cid = app.PF.views.reportCardId(keys[n]);
    assert.strictEqual(app.activeId(), cid + '-h', 'its own card is focused');
    assert.ok(new RegExp('<section class="rep-card[^"]*" aria-labelledby="' + cid + '-h"><h4').test(h), 'unfolded');
    assert.ok(count(h, /<section class="rep-card/g) <= 21);
  }
});

rule('Reports: at phone width, with the inspector closed, a Reports panel row opens the sheet on its own card, focused, not on Close', async () => {
  const app = await bigApp(); app.setNarrow(true); await app.tick(5);
  try {
    await openRun(app, 'busy', 's1');
    if (/id="rw-ins"[^>]*data-open="true"/.test(app.html())) { app.click('close-ref'); await app.tick(5); }
    assert.ok(!/id="rw-ins"[^>]*data-open="true"/.test(app.html()), 'set-up: the inspector is closed');
    await reportsOpen(app);
    const keys = ids(app.html() + app.overlay(), /data-act="rep-goto" data-id="step-s0" data-report="([^"]+)"/g);
    assert.ok(keys.length >= 3, 'set-up: the panel lists reports');
    app.click('rep-goto', 'step-s0', { report: keys[2] }); await app.tick(10);
    assert.ok(/id="rw-ins"[^>]*data-open="true"/.test(app.html()), 'the sheet opens');
    assert.strictEqual(app.activeId(), app.PF.views.reportCardId(keys[2]) + '-h', 'on the report\'s card');
  } finally { app.setNarrow(false); await app.tick(5); }
});

rule('Reports: one report with 300 copies draws 10 copy lines, Show all pages the rest, and each line is built only when drawn', async () => {
  const app = await bigApp(); await openRun(app, 'busy', 's2');
  const d = await perfDelta(app, ['rep.copy'], async () => { app.click('dismiss'); await app.tick(5); });
  let h = app.html();
  assert.strictEqual(count(h, /<p class="rep-copy"/g), 10);
  assert.ok(d['rep.copy'] <= 10 * d.draws, JSON.stringify(d));
  const key = un(/data-act="rep-copies" data-id="([^"]+)"/.exec(h)[1]);
  assert.ok(/Show all 300 copies/.test(h));
  const eleventh = un(/data-act="rep-copies" data-id="[^"]+" data-focus="\[id=&quot;([^"]+)&quot;\]"/.exec(h)[1]);
  const firstTen = [...h.matchAll(/<p class="rep-copy" id="([^"]+)"/g)].map(m => un(m[1]));
  app.click('rep-copies', key, { focus: '[id="' + eleventh + '"]' }); await app.tick(10);
  h = app.html();
  assert.strictEqual(count(h, /<p class="rep-copy"/g), 50, 'Show all lists them 50 at a time');
  /* The 11th copy, by an id from its path (2.11), never its place. */
  assert.ok(firstTen.indexOf(eleventh) < 0 && [...h.matchAll(/<p class="rep-copy" id="([^"]+)"/g)].map(m => un(m[1]))[10] === eleventh, eleventh);
  assert.strictEqual(app.activeId(), eleventh, 'focus on the first one not shown before');
  await more(app, 'repc:' + key);
  assert.strictEqual(count(app.html(), /<p class="rep-copy"/g), 100);
});

rule('Reports: a kept decline reason on a report a newer read deleted is drawn as Removed elsewhere with its reason; two are kept apart', async () => {
  const app = await fresh(); await openRun(app, 'busy');
  app.click('takeover'); await app.tick(40); app.click('select', 's0'); await app.tick(10);
  const keyOf = n => un((new RegExp('aria-labelledby="' + cardOf(app, n) + '-h"[\\s\\S]*?data-act="rep-decline" data-id="([^"]+)"').exec(app.html()) || [])[1] || '');
  const k3 = keyOf(3), k7 = keyOf(7), rid = k => app.PF.reports.reasonId(k);
  for (const [k, t] of [[k3, 'Reason for three'], [k7, 'Reason for seven']]) { app.click('rep-decline', k); await app.tick(5); app.set(rid(k), t); app.click('select', 's1'); await app.tick(5); app.click('select', 's0'); await app.tick(5); }
  app.click('nav', 'home'); await app.tick(5);
  const files = app.files('reports/busy/').filter(f => /\.r000000[37]\.json$/.test(f));
  assert.strictEqual(files.length, 2, 'set-up: their files');
  for (const f of files) await app.fs.remove(f);
  await reread(app);
  await openRun(app, 'busy', 's0');
  const h = app.html();
  assert.strictEqual(count(h, /<section class="rep-card rep-gone"/g), 2, 'both drawn as gone');
  assert.ok(/Removed elsewhere\./.test(h));
  assert.ok(/Reason for three/.test(h) && /Reason for seven/.test(h), 'each with its own reason');
  assert.ok(/data-act="rep-copy-reason"/.test(h) && !/rep-gone[\s\S]{0,900}data-act="rep-decline-go"/.test(h), 'Copy my text, never Decline');
  app.click('rep-cancel', k3); await app.tick(5);
  assert.strictEqual(count(app.html(), /<section class="rep-card rep-gone"/g), 1, 'Cancel takes one away, the other stays');
});

/* Code review round 3. */
rule('Corrections: an open Decline with a reason, whose correction a newer read no longer has, is drawn as Removed elsewhere with the reason, Copy my text and Cancel; leaving is refused while it holds text', async () => {
  let copied = null;
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true, navigator: { clipboard: { writeText: t => { copied = t; return Promise.resolve(); } } } }); await app.tick(60);
  await into(app, fixture());
  await corrections(app, 'busy');
  let h = app.html();
  const gid = fxGroups(h)[3], n = (/<dd>Reason (\d+)<\/dd>/.exec(liText(h, 'fxg-' + gid)) || [])[1];
  assert.ok(gid && n, 'set-up: a group and its correction');
  app.click('pick', gid, { kind: 'corr-decline' }); await app.tick(5);
  app.set('pick-input', 'Covered by another change');
  const nf = app.files('runs/busy/').filter(f => /\/notes-busy-s1\.jsonl$/.test(f))[0];
  const lines = app.fs.files[nf].t.split('\n').filter(l => { if (!l) return true; const x = JSON.parse(l); return !(x.kind === 'correction' && x.why === 'Reason ' + n); });
  await app.fs.write(nf, lines.join('\n'));
  await reread(app);
  h = app.html();
  assert.ok(fxGroups(h).indexOf(gid) < 0 || /class="fx-removed"/.test(h), 'set-up: the correction is gone from the folder');
  const li = (new RegExp('<li class="fx-removed" data-scope="corr:[^"]*" id="fxg-' + gid + '"[\\s\\S]*?</li>').exec(h) || [''])[0];
  assert.ok(li, 'its row is still drawn, from what it said');
  assert.ok(/Removed elsewhere\./.test(li) && /Busy step 0, worded/.test(li), 'marked, with what it suggested');
  assert.ok(/id="pick-input"/.test(li) && app.draft('pick-input') === 'Covered by another change', 'with the reason typed');
  assert.ok(/data-act="corr-copy-reason"/.test(li) && /data-act="unpick"/.test(li) && !/data-act="corr-decline"/.test(li), 'Copy my text and Cancel, never Decline');
  const at = app.url();
  app.click('go', null, { view: 'process', process: 'tiny' }); await app.tick(10);
  assert.ok(/class="fx-removed"/.test(app.html()) && app.url() === at, 'go() refused');
  app.back(); await app.settle();
  assert.ok(/class="fx-removed"/.test(app.html()), 'Back refused');
  app.click('corr-copy-reason'); await app.tick(5);
  assert.strictEqual(copied, 'Covered by another change', 'Copy my text');
  app.click('unpick'); await app.tick(5);
  assert.ok(!/class="fx-removed"/.test(app.html()), 'Cancel takes it away');
  app.click('go', null, { view: 'process', process: 'tiny' }); await app.tick(10);
  assert.ok(app.url() !== at, 'then leaving is allowed');
});

rule('Reports: report 31 opened from the Reports panel keeps focus on its own card when a report that sorts before it arrives', async () => {
  const app = await fresh(); await openRun(app, 'busy', 's1');
  const pl = 'reppanel:' + fixture().facts.busy;
  await reportsOpen(app);
  await more(app, pl, app.html() + app.overlay());
  const keys = ids(app.html() + app.overlay(), /data-act="rep-goto" data-id="step-s0" data-report="([^"]+)"/g);
  assert.strictEqual(keys[31], repKey(31), 'set-up: report 31 in the panel');
  app.click('rep-goto', 'step-s0', { report: keys[31] }); await app.tick(10);
  /* The card the focused heading is on, as far as its report's own words (Report r0000031). */
  const headOf = () => { const a = app.doc.activeElement, h = app.html(), i = a && a.id ? h.indexOf('id="' + a.id + '"') : -1; return i < 0 ? '' : h.slice(i, h.indexOf('</section>', i)).replace(/<[^>]+>/g, ' ').slice(0, 400); };
  assert.ok(/r0000031/.test(headOf()), 'set-up: report 31\'s card is focused: ' + headOf());
  const src = app.files('reports/busy/').filter(f => /\.r0000031\.json$/.test(f))[0];
  await app.fs.write(src.replace(/r0000031\.json$/, 'a0000000.json'), app.fs.files[src].t.replace(/r0000031/g, 'a0000000'));
  /* A newer read, with focus left where it is (pressing Refresh would take it). */
  const was = app.PF.perf.n['load.done'] || 0, held = app.doc.activeElement;
  app.click('refresh'); app.doc.activeElement = held;
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(5);
  assert.ok(/a0000000/.test(app.html()), 'set-up: the new report is drawn ahead');
  assert.ok(/r0000031/.test(headOf()), 'focus is still on report 31\'s card: ' + app.activeId() + ' ' + headOf());
});

/* ---------- Join ---------- */
rule('Join: 500 people draw 50 in name order, and Find your name finds person 480', async () => {
  const { folderHandle, memoryIDB } = require('./app-harness');
  const fx = fixture(), dir = folderHandle('Team', { 'people.json': fx.files['people.json'] });
  const app = boot({ picker: dir, indexedDB: memoryIDB(), firstRun: true }); await app.tick(60);
  app.click('setup-mode', 'join'); await app.tick();
  app.click('setup-open'); await app.tick(200);
  let h = app.html();
  const names = ids(h, /data-act="setup-who" data-id="[^"]+"[^>]*>[\s\S]*?<b>([^<]+)<\/b>/g);
  assert.strictEqual(names.length, 50);
  const N = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  assert.deepStrictEqual(names, names.slice().sort(N.compare), 'in name order');
  await typeFind(app, 'su-who', 'Person 480');
  h = app.html();
  assert.ok(/data-id="person-p480"/.test(h), 'found');
});

rule('The linked-run dialog\'s role selects list scrambled people in name order and keep a chosen person', async () => {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-casey'); await app.tick();
  const PF = app.PF, now = new Date().toISOString();
  const people = JSON.parse(app.fs.files['people.json'].t);
  for (let i = 60; i > 0; i--) people.push({ id: 'person-x' + i, name: (i % 2 ? 'Zed ' : 'Abe ') + i, email: 'x' + i + '@example.com' });
  app.fs.files['people.json'] = { t: JSON.stringify(people, null, 2) + '\n', m: Date.now() };
  const put = (md, id, rand) => {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '2.9.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  };
  put(['---', 'process: deploy', 'title: Deploy', 'owner: person-avery', 'context: env', 'roles: lead', '---', '', '## Go · READ-DO {#go}', '- [ ] {confirm} Go @lead {#go1}'].join('\n'), 'deploy', 'dp000001');
  put(['---', 'process: ship', 'title: Ship', 'owner: person-avery', '---', '', '## Ship · READ-DO {#s}', '- [ ] {run.process} Deploy it {#dep}', '  process: deploy', '  pass: env=?', '- [ ] {confirm} Tell them {#tell}'].join('\n'), 'ship', 'sh000001');
  app.click('refresh'); await app.tick(80);
  app.click('start', 'ship'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  app.click('start-child', 'dep'); await app.tick(150);
  const opts = () => /<select id="cs-role-lead"/.test(app.overlay()) ? [...(/<select id="cs-role-lead"[^>]*>([\s\S]*?)<\/select>/.exec(app.overlay())[1]).matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)</g)].map(m => [m[1], m[3], /selected/.test(m[2])]) : null;
  let o = opts();
  assert.ok(o, 'set-up: the dialog asks who leads');
  const names = o.filter(x => /^person-/.test(x[0])).map(x => un(x[1]));
  const N = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  assert.deepStrictEqual(names, names.slice().sort(N.compare), 'in name order');
  assert.ok(names.indexOf('Abe 2') < names.indexOf('Abe 10'), 'numbers in number order');
  app.select('cs-role-lead', 'person-x37'); await app.tick(5);
  app.click('dismiss'); await app.tick(5);
  o = opts();
  assert.ok(o && o.some(x => x[0] === 'person-x37' && x[2]), 'the chosen person is kept');
});

/* ---------- versions, stages, incomplete publications ---------- */
rule('Versions: 300 draw 50 earlier versions; 200 stages work out readiness at most 50 times; 300 incomplete publications draw 20, each built only when drawn', async () => {
  const app = await bigApp(); await openProc(app, 'versions');
  app.fire('toggle', { target: { dataset: { disc: 'vers:versions' }, open: true } }); app.fire('toggle', { target: { dataset: { disc: 'pub-broken:versions' }, open: true } });
  const d = await perfDelta(app, ['stage.row', 'pub.broken'], async () => { app.click('dismiss'); await app.tick(5); });
  const h = app.html();
  assert.ok(count(h, /<li[^>]*id="ver-v/g) <= 51 + 2, 'versions: ' + count(h, /<li[^>]*id="ver-v/g));
  assert.ok(count(h, /<li class="stg[^"]*" id="stg-/g) <= 50, 'stages: ' + count(h, /<li class="stg[^"]*" id="stg-/g));
  assert.ok(d['stage.row'] <= 50 * d.draws, 'readiness: ' + JSON.stringify(d));
  assert.strictEqual(count(h, /<div class="notice warn pub-broken"/g), 1, 'one notice');
  assert.strictEqual(count(h, /<li id="pb-/g), 20, '20 in its fold');
  assert.ok(d['pub.broken'] <= 20 * d.draws, JSON.stringify(d));
  assert.ok(/300 /.test((/<div class="notice warn pub-broken"[\s\S]{0,300}/.exec(h) || [''])[0]), 'the notice counts all 300');
});

rule('Versions: Show changes on a 400-step checklist draws 50 changes, with Show more focusing the next', async () => {
  const app = await bigApp(); await openProc(app, 'steps');
  const m = /data-act="diff" data-id="([^"]+)"/.exec(app.html());
  assert.ok(m, 'set-up: Changes');
  app.click('diff', un(m[1])); await app.tick(10);
  const h = app.html(), n = count(h, /<span class="(?:add|del)" id="ver-diff-[0-9a-f]{16}"/g);
  assert.strictEqual(n, 50, 'a page of changes');
  const d = await more(app, 'ver-diff');
  assert.strictEqual(count(app.html(), /<span class="(?:add|del)" id="ver-diff-[0-9a-f]{16}"/g), 100);
  assert.ok(app.doc.activeElement === app.node(d.focus), 'focus on the first added change');
});

rule('Stages: a stage made from the overview, and one from Practice, landing past row 50, is drawn, its fold open, with Start a test run focused', async () => {
  const app = await fresh(), U = app.PF.util, rid = U.randomId;
  const latest = Object.keys(app.fs.files).filter(k => /^publications\/versions\/v300-[^/]+\/map\.md$/.test(k))[0];
  const md = app.fs.files[latest].t.replace(/\nversion: [^\n]*/, '').replace('Step 0 of version 300', 'Step 0, staged from the overview');
  await app.fs.write('maps/drafts/versions.md', md);
  await reread(app);
  let n = 0; U.randomId = len => len === 8 ? 'zzzzzz' + String(n++).padStart(2, '0') : rid(len);
  try {
    await openProc(app, 'versions');
    app.set('change-note', 'Staged from the overview');
    app.click('stage-draft', 'versions'); await app.tick(300);
    const stg = Object.keys(app.fs.files).filter(k => /^staged\/versions\/stage-zzzzzz\d\d\/map\.md$/.test(k)).map(k => k.split('/')[2]);
    assert.strictEqual(stg.length, 1, 'set-up: staged');
    const all = Object.keys(app.fs.files).filter(k => /^staged\/versions\/[^/]+\/map\.md$/.test(k)).map(k => k.split('/')[2]).sort();
    assert.ok(all.indexOf(stg[0]) >= 50, 'set-up: past row 50 (' + all.indexOf(stg[0]) + ')');
    const h = app.html();
    assert.ok(new RegExp('id="stg-' + stg[0] + '"').test(h), 'drawn');
    assert.ok(count(h, /<li class="stg[^"]*" id="stg-/g) <= 51, 'with the page');
    assert.ok(/data-disc="vers:versions" open/.test(h), 'its fold open');
    assert.strictEqual(app.activeId(), '[data-act="start-test"][data-id="' + stg[0] + '"]', 'Start a test run focused');
    /* From Practice. */
    await app.fs.write('maps/drafts/versions.md', md.replace('Step 0, staged from the overview', 'Step 0, staged from Practice'));
    await reread(app);
    await openProc(app, 'versions', 'edit');
    app.click('pr-open'); await app.tick(60);
    assert.ok(/Practice · not recorded/.test(app.html()), 'set-up: practicing');
    for (let pi = 0; pi < 2; pi++) {
      for (let k = 0; k < 3; k++) { app.click('toggle', 's' + (pi * 3 + k)); await app.tick(); }
      if (!new RegExp('data-act="pass" data-id="' + pi + '"').test(app.html())) { const g = [...app.html().matchAll(/<div class="gate" data-scope="gate:([^"]+)"/g)].map(m => m[1])[pi]; app.click('pick', g, { kind: 'pass' }); await app.tick(); }
      app.click('pass', String(pi)); await app.tick();
    }
    assert.ok(/You got through the whole checklist\./.test(app.html()), 'set-up: practiced to the end');
    app.set('pr-note', 'Staged from Practice'); app.fire('input', { target: { id: 'pr-note', value: 'Staged from Practice', tagName: 'INPUT', dataset: {}, closest: () => null } });
    app.click('pr-stage'); await app.tick(300);
    const stg2 = Object.keys(app.fs.files).filter(k => /^staged\/versions\/stage-zzzzzz\d\d\/map\.md$/.test(k)).map(k => k.split('/')[2]).filter(f => f !== stg[0]);
    assert.strictEqual(stg2.length, 1, 'set-up: staged from Practice');
    const h2 = app.html();
    assert.ok(new RegExp('id="stg-' + stg2[0] + '"').test(h2) && /data-disc="vers:versions" open/.test(h2), 'drawn, its fold open');
    assert.ok(count(h2, /<li class="stg[^"]*" id="stg-/g) <= 51);
    assert.strictEqual(app.activeId(), '[data-act="start-test"][data-id="' + stg2[0] + '"]', 'Start a test run focused');
  } finally { U.randomId = rid; }
});

/* ---------- How runs go ---------- */
rule('How runs go: Compare versions over 300 versions works out at most 20 of them per draw', async () => {
  const app = await bigApp(); await openProc(app, 'versions', 'insights');
  app.fire('toggle', { target: { dataset: { disc: 'ins-cmp' }, open: true } });
  const I = app.PF.insights, f = I.forProcess; let n = 0;
  I.forProcess = function () { n++; return f.apply(this, arguments); };
  try {
    const r0 = app.PF.perf.n.render || 0;
    app.click('dismiss'); await app.tick(5);
    const draws = (app.PF.perf.n.render || 0) - r0;
    assert.ok(n <= 21 * draws, 'insightsOf, per draw: ' + n + ' in ' + draws);
    assert.strictEqual(count(app.html(), /<th scope="row" id="ins-cmp-/g), 20);
  } finally { I.forProcess = f; }
});

rule('How runs go: the roles grid with 300 roles and 60 people builds at most 50 × 20 cells; Show 20 more roles reaches role 300 and Show more people person 60', async () => {
  const app = await bigApp(); await openProc(app, 'roles', 'insights');
  const d = await perfDelta(app, ['ins.rolecell'], async () => { app.click('dismiss'); await app.tick(5); });
  let h = app.html();
  assert.ok(d['ins.rolecell'] <= 50 * 20 * d.draws, JSON.stringify(d));
  assert.strictEqual(count(h, /<th scope="col" id="ins-role-/g), 20);
  for (let i = 0; i < 14; i++) {
    const m = moreOf(app.html(), 'ins-rolecols'); assert.ok(m, 'Show more roles, ' + i);
    app.click('more', 'ins-rolecols', m); await app.tick(5);
    assert.strictEqual(app.activeId(), 'ins-role-' + m.next, 'focus on the first new heading');
  }
  h = app.html();
  assert.ok(/id="ins-role-r300"/.test(h) && !moreOf(h, 'ins-rolecols'), 'role 300 reached');
  assert.strictEqual(count(h, /<th scope="row" id="ins-who-/g), 50, '50 people');
  const pm = await more(app, 'ins-rot');
  assert.strictEqual(app.activeId(), 'ins-who-' + pm.next, 'Show more people focuses the first one it adds');
  h = app.html();
  assert.ok(count(h, /<th scope="row" id="ins-who-/g) >= 60 && !moreOf(h, 'ins-rot'), 'every person who did a role');
  app.click('ptab', 'overview'); await app.tick(5);
});

rule('How runs go: Each phase on the 300-phase checklist builds 50 rows in order, scaled from all 300; Show more reaches phase 300', async () => {
  const app = await bigApp(); await openProc(app, 'phases', 'insights');
  const d = await perfDelta(app, ['ins.phase'], async () => { app.click('dismiss'); await app.tick(5); });
  let h = app.html();
  const ph = ids(h, /<li id="ins-ph-([^"]+)"/g);
  assert.strictEqual(ph.length, 50);
  assert.deepStrictEqual(ph, Array.from({ length: 50 }, (x, i) => 'ph' + (i + 1)), 'checklist order');
  assert.ok(d['ins.phase'] <= 50 * d.draws, JSON.stringify(d));
  for (let i = 0; i < 5; i++) { const m = await more(app, 'ins-ph'); assert.ok(app.doc.activeElement === app.node(m.focus), 'focus on the first new row'); }
  h = app.html();
  assert.ok(/<li id="ins-ph-ph300"/.test(h));
  app.click('ptab', 'overview'); await app.tick(5);
});

rule('How runs go: Back from the runs behind step 100\'s count, and phase 100\'s, draws that row and focuses its count', async () => {
  const app = await bigApp();
  for (const [proc, list, path] of [['steps', 'ins-hot', /data-act="ins-runs" data-id="(step:s100:[^"]+)"/], ['phases', 'ins-ph', /data-act="ins-runs" data-id="(phase:ph100[^"]*)"/]]) {
    await openProc(app, proc, 'insights');
    for (let i = 0; i < 2; i++) await more(app, list);
    const m = path.exec(app.html());
    assert.ok(m, 'set-up: the count for ' + proc);
    app.click('ins-runs', un(m[1])); await app.tick(10);
    app.click('nav', 'home'); await app.tick(5);
    app.back(); await app.settle();
    if (!/data-act="ins-back"/.test(app.html())) { app.click('ins-runs', un(m[1])); await app.tick(10); }
    app.click('ins-back'); await app.tick(10);
    const h = app.html();
    assert.ok(h.indexOf('data-id="' + m[1] + '"') >= 0 || h.indexOf(m[1].replace(/&/g, '&amp;')) >= 0, proc + ': that row is drawn after Back');
    assert.ok(/ins-runs/.test(app.activeId()) || app.focused().indexOf('ins-runs') >= 0, proc + ': its count is focused: ' + app.activeId());
  }
  app.click('ptab', 'overview'); await app.tick(5);
});

/* ---------- a correction's Who should do it ---------- */
rule('Who should do it: 300 roles build 20 checkboxes; Find reaches role 300; ticked roles, the text and Move it to survive Show more, Find and a refresh', async () => {
  const app = await fresh(); await openRun(app, 'roles');
  app.click('takeover'); await app.tick(40); app.click('select', 's0'); await app.tick(10);
  app.click('corr-open', 's0', { mode: 'correct' }); await app.tick();
  app.click('corr-op', 'move'); await app.tick(10);
  const place = (/<select id="corr-move"[\s\S]*?<option value="([^"#][^"]*)"/.exec(app.html()) || [])[1];
  assert.ok(place, 'set-up: a place to move it to');
  app.select('corr-move', un(place)); await app.tick(5);
  app.click('corr-op', 'roles'); await app.tick(10);
  let h = app.html();
  assert.ok(/id="corr-roles"/.test(h), 'set-up: Who should do it');
  assert.strictEqual(count(h, /id="corr-role-r\d+"/g), 20);
  app.check('corr-role-r5', true); await app.tick(5);
  app.input('corr-why', 'Roles should rotate');
  const d = await more(app, 'corr-roles');
  assert.strictEqual(app.activeId(), 'corr-role-' + d.next, 'Show more focuses the first new checkbox');
  await typeFind(app, 'corr-roles', 'r250');
  h = app.html();
  /* Code review round 12: with Find the page is the matches; a ticked role Find leaves out is an ordinary kept row, its tick
     kept in the form's state and drawn again once the Find text is cleared. */
  assert.ok(/id="corr-role-r250"/.test(h) && !/id="corr-role-r5"/.test(h), 'Find reaches it, matches first, the ticked one kept in the form');
  app.check('corr-role-r250', true); await app.tick(5);
  await typeFind(app, 'corr-roles', 'r300');
  assert.ok(/id="corr-role-r300"/.test(app.html()), 'role 300');
  app.click('find-clear', 'corr-roles'); await app.tick(5);
  await reread(app);
  h = app.html();
  assert.ok(/id="corr-role-r5"[^>]*checked/.test(h) && /id="corr-role-r250"[^>]*checked/.test(h), 'both ticked through Find and a refresh');
  assert.strictEqual(app.draft('corr-why'), 'Roles should rotate');
  app.click('corr-op', 'move'); await app.tick(10);
  assert.ok(new RegExp('<option value="' + place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*selected').test(app.html()), 'Move it to keeps its choice');
});

/* ---------- D10: the two shapes, found by reading the views ---------- */
/* Where the bracket opened just before i closes (its index), past strings, comments and regexes. */
function closeAt(src, i) {
  let depth = 1, prev = '(';
  while (i < src.length && depth) {
    const c = src[i];
    if (c === '"' || c === "'") { i++; while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; } prev = 'x'; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (c === '/' && /[(,=:[!&|?{};+]/.test(prev)) { i++; let cls = false; while (i < src.length && (src[i] !== '/' || cls)) { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i++; } i++; prev = 'x'; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return i;
}
/* The callback of every .map( and .forEach( call, from its ( to the matching ), and (code review round 12) the body of every
   function a list calls once per row: a row: option, inline or named. */
function callbacks(src) {
  const out = [], re = /\.(map|forEach)\(/g; let m;
  while ((m = re.exec(src))) {
    const i = closeAt(src, m.index + m[0].length);
    out.push({ kind: m[1], line: src.slice(0, m.index).split('\n').length, body: src.slice(m.index + m[0].length, i - 1) });
  }
  const fns = functions(src), rr = /\brow\s*:\s*(function\b[^{]*\{|([A-Za-z_$][\w$]*)\b)/g;
  while ((m = rr.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    if (m[2]) { if (fns[m[2]]) out.push({ kind: 'row', line, body: fns[m[2]] }); continue; }
    const i = closeAt(src, m.index + m[0].length);
    out.push({ kind: 'row', line, body: src.slice(m.index + m[0].length, i - 1) });
  }
  return out;
}
/* Every named function's body: function name( and name = function (. */
function functions(src) {
  const out = {}, re = /(?:\bfunction\s+([A-Za-z_$][\w$]*)|\b([A-Za-z_$][\w$]*)\s*=\s*function\b)[^{]*\{/g; let m;
  while ((m = re.exec(src))) { const i = closeAt(src, m.index + m[0].length); out[m[1] || m[2]] = src.slice(m.index + m[0].length, i - 1); }
  return out;
}
/* The functions that build a notice, themselves or through another one (code review round 12: a row calling teamNote drew a
   notice per run detail, and the check read only markup written inline). */
function noticeHelpers(src, skip) {
  const fns = functions(src), names = new Set(Object.keys(fns).filter(n => NOTICE.test(fns[n]) && !(skip && skip.has(n))));
  for (let grew = true; grew;) { grew = false; Object.keys(fns).forEach(n => { if (!names.has(n) && !(skip && skip.has(n)) && [...names].some(h => new RegExp('\\b' + h.replace(/\$/g, '\\$') + '\\s*\\(').test(fns[n]))) { names.add(n); grew = true; } }); }
  return names;
}
const callsAny = (body, names) => [...names].filter(h => new RegExp('(^|[^\\w$.])' + h.replace(/\$/g, '\\$') + '\\s*\\(').test(body));
/* Every hit, with why it's allowed: covered by a bound, a person picker (D6), or a list that doesn't grow with the folder. */
const PERSON = 'a person picker, a native select by name (D6)';
const D10_OK = [
  { file: 'builder.js', has: 'esc(x) + \'"\' + (x === v', why: 'a step type\'s own choices, set by the type' },
  { file: 'common.js', has: 'is marked started, but', why: 'this window\'s own unsaved starts, not the folder\'s' },
  { file: 'common.js', has: '(o === v ? \' selected\'', why: 'a step\'s choices, set by its type' },
  { file: 'common.js', has: 'nmMe(p)', why: PERSON }, { file: 'manage.js', has: 'nmOwn(p)', why: PERSON },
  { file: 'manage.js', has: 'esc(t) + \'">\'', why: 'the tag box\'s datalist: suggestions the browser filters as you type, not a select' },
  { file: 'manage.js', has: 'esc(g) + \'">\'', why: 'the group box\'s datalist: suggestions the browser filters as you type, not a select' },
  { file: 'manage.js', has: 'KIND_NAMES[x]', why: 'the step kinds, built into the app' },
  { file: 'overlays.js', has: 'f.area === a', why: 'What\'s new\'s areas, bundled with the app' },
  { file: 'overlays.js', has: 'the team value', why: 'replaced team values, capped by the format at 100 (core/teamvalues.js)' },
  { file: 'overlays.js', has: 'esc(nm(x))', why: PERSON }, { file: 'pages.js', has: 'nmFu(p)', why: PERSON },
  { file: 'process.js', has: 'nmStage(x)', why: PERSON }, { file: 'process.js', has: 'nmRun(x)', why: PERSON },
  { file: 'run.js', has: 'String(value || \'\').trim().toLowerCase()', why: 'a step\'s choices, set by its type' },
  { file: 'run.js', has: 'nmMe(p)', why: PERSON }, { file: 'run.js', has: 'nmTo(p)', why: PERSON }, { file: 'run.js', has: 'nmRole(p)', why: PERSON },
  { file: 'setup.js', has: 'esc(k[1]) + \'</p>\' + list([p])', why: 'a fixed pair: the person being changed and the one just added, each drawn once' },
  { file: 'setup.js', has: 'nmBk(', why: PERSON }, { file: 'setup.js', has: 'nmTo(p)', why: PERSON }
];
/* Helpers that draw a notice for one thing at a time, never once per row (code review round 12): a call to one of these in a
   row or a loop isn't a repeated notice. Every other function that builds a notice, itself or through another, counts as one
   when a row or a loop calls it. */
const ONE = 'a field\'s own error: state.fieldErr names one field at a time';
const D10_HELPER_OK = [
  { file: 'builder.js', helper: 'errMsg', why: ONE },
  { file: 'builder.js', helper: 'holdIn', why: 'the one box with typing not applied (state.obHold), at most one' },
  { file: 'builder.js', helper: 'groupList', why: 'its notice is Delete the lane?, for the one lane being deleted (state.obAsk)' },
  { file: 'builder.js', helper: 'phaseCard', why: 'its notice is Delete the phase?, for the one phase being deleted (state.obAsk)' },
  { file: 'builder.js', helper: 'renameRow', why: 'drawn only for the one run detail being renamed (state.obRename)' },
  { file: 'run.js', helper: 'ferr', why: ONE }, { file: 'run.js', helper: 'fe', why: ONE }, { file: 'run.js', helper: 'noteCorr', why: ONE + ', for the one note being corrected' },
  { file: 'run.js', helper: 'fuForm', why: 'the one follow-up whose form is open (state.fuPick)' },
  { file: 'setup.js', helper: 'ferr', why: ONE },
  { file: 'practice.js', helper: 'keptHtml', why: 'what the person typed in this practice for a step that changed since: one per step they typed into, kept so they can copy it, not a status announced' },
  { file: 'reports.js', helper: 'card', why: 'a report card\'s own decision state, not announced but for the person\'s own decision being saved; cards are paged at 20 (D8, repcards)' }
];
/* Hits the plan doesn't have yet, reported rather than assigned (as D8's PENDING with slice null). None left: the linked
   step that can't start its child became one notice in slice 5. */
const D10_PENDING = [];
/* A notice: a status or alert role, a live region, or the notice class (code review round 11: Jira's problems had no role). */
const NOTICE = /role=\\?"(status|alert)\\?"|aria-live|class=\\?"(?:[\w-]+ )*notice\b/;
rule('D10: a notice built once per item, and an option built in a .map, are each covered by a bound, exempt with a reason, or listed as pending', () => {
  const dir = path.join(__dirname, '..', 'src', 'ui', 'views'), left = [], used = new Set(), usedHelper = new Set();
  fs.readdirSync(dir).filter(f => /\.js$/.test(f)).forEach(f => {
    const skip = new Set(D10_HELPER_OK.filter(e => e.file === f).map(e => e.helper)), src = fs.readFileSync(path.join(dir, f), 'utf8'), helpers = noticeHelpers(src, skip), fns = functions(src);
    D10_HELPER_OK.filter(e => e.file === f && fns[e.helper] && (NOTICE.test(fns[e.helper]) || callsAny(fns[e.helper], noticeHelpers(src)).length)).forEach(e => usedHelper.add(e));
    callbacks(src).forEach(c => {
      const notice = NOTICE.test(c.body) || callsAny(c.body, helpers).length > 0, option = c.kind === 'map' && /<option/.test(c.body);
      if (!notice && !option) return;
      const ok = D10_OK.concat(D10_PENDING).filter(e => e.file === f && c.body.indexOf(e.has) >= 0);
      ok.forEach(e => used.add(e));
      if (!ok.length) left.push(f + ':' + c.line + ' (' + (notice ? 'a notice' : 'an option') + ' in .' + c.kind + '): ' + c.body.slice(0, 100).replace(/\s+/g, ' '));
    });
  });
  assert.deepStrictEqual(left, [], 'not covered');
  assert.deepStrictEqual(D10_OK.concat(D10_PENDING).filter(e => !used.has(e)).map(e => e.file + ': ' + e.has), [], 'an exemption that matches nothing any more');
  assert.deepStrictEqual(D10_HELPER_OK.filter(e => !usedHelper.has(e)).map(e => e.file + ': ' + e.helper), [], 'a helper exemption for a function that no longer draws a notice');
});
/* D10 rule 3 (code review round 8, widened in round 10): every .join( in the views and app.js with any separator but '' (a
   list of rows, bounded by D8's check). Each is capped (K.capJoin, K.joined, or the first few and "and N more"), or exempt
   with the reason it can't grow with the team folder or isn't drawn as text. Since round 11, an exemption holds only when
   the list's length is bounded by something other than the folder's or a checklist's size: a cap enforced when the file is
   read, or a fixed set. What a checklist's author writes for one step (its roles, its lane's roles, a gate's approvals) is
   not bounded by being one step's, so it's capped. */
const NOT_TEXT = 'never drawn: a key, signature, selector, pattern or comparison';
const ARIA = 'element ids for aria-describedby, never drawn';
const SEARCH = 'the words Find or search matches against, never drawn';
const COPY = 'copied whole to the clipboard on purpose: what the person typed';
const FORMVAL = 'a form box\'s value, which the person edits, not a line of text';
const FILE = 'text written to a file (front matter, a step\'s lines), never drawn';
const FIXED = 'a fixed set of parts, at most a handful';
const GROUP = 'one group path (Group / Subgroup), as deep as its author wrote it';
const D10_JOIN_OK = [
  { file: 'builder.js', has: 'function described(', why: ARIA }, { file: 'builder.js', has: 'function sigOf(', why: NOT_TEXT },
  { file: 'builder.js', has: 'group: T.groupOf(t).join(\' / \')', why: 'a step type\'s group, at most 80 characters, and its tags, at most 10, a type file over either is refused when read (core/types.js)' },
  { file: 'builder.js', has: 'keys: \'github.pr bitbucket.pr', why: SEARCH }, { file: 'builder.js', has: 'function matches(pt, q)', why: SEARCH },
  { file: 'builder.js', has: 'esc(t.when.join(\'\\n\'))', why: FORMVAL }, { file: 'builder.js', has: 'guideList.join(\'|\')', why: NOT_TEXT },
  { file: 'builder.js', has: '\' · fields \' + names.map', why: 'a step type\'s fields, at most 30, a type file with more is refused when read (core/types.js)' },
  { file: 'common.js', has: 'Part of the team folder couldn', why: 'the folder\'s areas, a fixed set' },
  { file: 'common.js', has: 'shown.map(name).join(\', \')', why: 'K.joined: the first 50 and Show more' },
  { file: 'common.js', has: '.join(sep) + tail', why: 'K.capJoin itself: the first 50 and "and N more"' },
  { file: 'common.js', has: 'esc(parts.join(\' · \'))', why: FIXED }, { file: 'common.js', has: 'var key = p.join(\' / \')', why: NOT_TEXT },
  { file: 'common.js', has: 'esc(name.join(\' / \'))', why: GROUP }, { file: 'common.js', has: '.join(\'\\n\').toLowerCase()', why: SEARCH },
  { file: 'common.js', has: 'function whenWords(x)', why: 'a step\'s or phase\'s "only when" lines, at most 4, a fifth refused when the checklist is read (PF.conditions.MAX, core/map.js)' }, { file: 'common.js', has: '\'--pane-\'', why: NOT_TEXT },
  { file: 'detailbox.js', has: 's0.when.join(\' and \')', why: 'a step\'s "only when" lines, at most 4 (PF.conditions.MAX, core/map.js)' }, { file: 'detailbox.js', has: 'var desc = [o.describedBy', why: ARIA },
  { file: 'evidence.js', has: 'return parts.join(\' · \')', why: FIXED },
  { file: 'flight.js', has: 'esc(marks.join(\' and \'))', why: FIXED }, { file: 'flight.js', has: '<b>Gate note</b>', why: FIXED },
  { file: 'health.js', has: 'function flushP()', why: 'a paragraph of the recovery guide, bundled with the app' },
  { file: 'home.js', has: 'K.uniqKeys(items', why: NOT_TEXT }, { file: 'home.js', has: 'bad.slice(0, 3)', why: 'the first 3 and "and N more"' },
  { file: 'home.js', has: 'var found = q ? tagged.filter(function (p)', why: SEARCH }, { file: 'home.js', has: 'var found = q ? tagged.filter(function (k)', why: SEARCH },
  { file: 'home.js', has: 'esc(flags.join(\' · \'))', why: 'a checklist\'s warning flags, a fixed set' },
  { file: 'insights.js', has: 'STATUS_WORDS[k]', why: 'correction statuses, a fixed set' }, { file: 'insights.js', has: 'var m = x.gate[k[0]]', why: FIXED },
  { file: 'manage.js', has: 'esc(K.capJoin(e.errors', why: 'the type files the reader couldn\'t use, at most the 100 it reads (storage/repo.js), each one\'s problems capped by K.capJoin' },
  { file: 'manage.js', has: 'PF.signature.inputWords(', why: 'a skill\'s What it takes: at most four phrases (roles, runs, extensions, pins), each role list capped by K.capJoin' },
  { file: 'manage.js', has: '\'## First phase · READ-DO {#first}\'', why: FILE },
  { file: 'manage.js', has: 'function slugId(t)', why: NOT_TEXT }, { file: 'manage.js', has: 'var describe = function (id, has, help)', why: ARIA },
  { file: 'manage.js', has: 'g = (t.group || []).join(\' / \')', why: 'the team types\' groups as a native datalist\'s suggestions, at most the 100 type files read' },
  { file: 'manage.js', has: 'id="tf-tagadd"', why: ARIA }, { file: 'manage.js', has: 'orgSum = [', why: 'two parts, the group and the tags, the tags capped by K.capJoin' }, { file: 'manage.js', has: 'id(\'optadd\')', why: ARIA },
  { file: 'manage.js', has: 'norm(r.orig.join(\'\\n\'))', why: NOT_TEXT },
  { file: 'manage.js', has: 'group: keepId && t.group ? t.group.join', why: FORMVAL }, { file: 'manage.js', has: 'fields: Object.keys(t.fields || {})', why: FORMVAL },
  { file: 'manage.js', has: 'record: (t.record || []).map', why: FORMVAL }, { file: 'manage.js', has: 'esc(s.group.join(\' / \'))', why: GROUP },
  { file: 'overlays.js', has: 'c.title, c.now, c.before', why: SEARCH }, { file: 'overlays.js', has: 'foot.map(esc).join(\' \')', why: FIXED },
  { file: 'overlays.js', has: 'histBa(h.del.join(\'\\n\'), h.ins.join(\'\\n\')', why: 'one saved change\'s lines; history keeps a change over 64 KB as fingerprints only (core/timeline.js)' },
  { file: 'pages.js', has: 'R.evidenceFor(r, s).list', why: 'one step\'s evidence: a step type\'s, at most 30 fields and 20 kinds of evidence, a type file with more refused when read (core/types.js)' },
  { file: 'practice.js', has: 'You typed this before the step changed', why: 'one step\'s values typed in practice: a step type\'s, at most 30 fields and 20 kinds of evidence, a type file with more refused when read (core/types.js)' },
  { file: 'process.js', has: 'u.slice(0, 3)', why: 'the first 3 and "and N more"' },
  { file: 'process.js', has: 'un.slice(0, 5)', why: 'the first 5 and "and N more"' },
  { file: 'process.js', has: 'n.names.slice(0, -1)', why: 'the features new in 2.0 a draft uses, a fixed set' },
  { file: 'process.js', has: 'sd.length <= 3', why: 'only when there are 3 or fewer' },
  { file: 'process.js', has: 'b.names.slice(0, 50)', why: 'the first 50 and "and N more"' },
  { file: 'process.js', has: 'pr.bad.slice(0, 3)', why: 'the first 3' },
  { file: 'reports.js', has: 'unused.join', why: 'a step\'s record fields: a step type\'s, at most 30 fields and 20 kinds of evidence, a type file with more refused when read (core/types.js)' },
  { file: 'reports.js', has: 'vals.join', why: 'one step\'s evidence: a step type\'s, at most 30 fields and 20 kinds of evidence, a type file with more refused when read (core/types.js)' },
  { file: 'run.js', has: 'var hint = [d.hint', why: FIXED + ' (a hint, an example and a why), and ' + ARIA },
  { file: 'run.js', has: 'shown.length < g.members.length', why: 'the members drawn, and "and N more"' },
  { file: 'run.js', has: 'val.split(\',\')', why: 'one value split and joined again: never longer than the value itself' },
  { file: 'run.js', has: 'Object.keys(y.values)', why: 'one answer\'s values, at most 120, the rest dropped when the run is read (core/run.js values)' },
  { file: 'run.js', has: 'meta.join(\' · \')', why: FIXED }, { file: 'run.js', has: 'var id = base + \'-\' + part', why: ARIA },
  { file: 'run.js', has: 'c.done ? c.done + \' done\'', why: FIXED },
  { file: 'run.js', has: 'esc(parts.join', why: 'the folder\'s areas, a fixed set' },
  { file: 'setup.js', has: 'su-phases', why: 'a starter template\'s steps, bundled with the app' },
  { file: 'app.js', has: 'ids.join(\'\\n\') : \'\'', why: NOT_TEXT }, { file: 'app.js', has: 'orphanSkills.push(', why: 'one skill file\'s problems, at most one per check of its fields' },
  { file: 'app.js', has: '\'Can\\\'t be matched: \' + x.errors.join', why: 'one skill file\'s problems, at most one per check of its fields' },
  { file: 'app.js', has: 'function shownSig(r)', why: NOT_TEXT }, { file: 'app.js', has: '(d.corrDecisions || [])', why: NOT_TEXT },
  { file: 'app.js', has: 'Object.keys((d.proposed || {}).procs || {})', why: NOT_TEXT }, { file: 'app.js', has: '(d.presence || []).map', why: NOT_TEXT },
  { file: 'app.js', has: 'Object.keys((d.stages || {}).procs || {})', why: NOT_TEXT },
  { file: 'app.js', has: 'Object.keys(state.missing || {}).join', why: NOT_TEXT }, { file: 'app.js', has: 'function connSig(l)', why: NOT_TEXT },
  { file: 'app.js', has: '[n.nodeName, n.id, n.className', why: NOT_TEXT }, { file: 'app.js', has: 'var fsig = [', why: NOT_TEXT },
  { file: 'app.js', has: 'function fillKey()', why: NOT_TEXT }, { file: 'app.js', has: 'app.dataset.scope = [', why: NOT_TEXT },
  { file: 'app.js', has: 'var piKey = pi ? [', why: NOT_TEXT }, { file: 'app.js', has: '[s.kind, s.key, s.track, state.insTab]', why: NOT_TEXT },
  { file: 'app.js', has: 'return it.id + \':\' + it.status; }).join', why: NOT_TEXT }, { file: 'app.js', has: '    }).join(\'|\');', why: NOT_TEXT },
  { file: 'app.js', has: 'return i.name; }).sort().join', why: NOT_TEXT },
  /* decideProposal is a queued write, left unchanged in 2.11 (gated); its message names the decision records still arriving. */
  { file: 'app.js', has: 'A record about this proposal can', why: 'in decideProposal, a queued write gated for 2.11: left as it is and reported' },
  { file: 'app.js', has: '\'one of \' + dd.options.join', why: 'one typed run detail\'s choices, at most 20, more refused when the checklist is read (core/map.js OPTIONS_MAX)' },
  { file: 'app.js', has: '\'pr-kept-copy\'', why: COPY }, { file: 'app.js', has: 'copyText((snap ? snap.text', why: COPY },
  { file: 'app.js', has: 'block: o.lines.slice(s.line, s.end).join', why: NOT_TEXT }, { file: 'app.js', has: 'return o.lines.slice(x.line, x.end).join', why: NOT_TEXT },
  { file: 'app.js', has: 'var sig = text.split(\'\\n\')', why: NOT_TEXT },
  { file: 'app.js', has: 'r.options = o.concat(v).join', why: FORMVAL }, { file: 'app.js', has: 'f.def.tags = t.concat(v).join', why: FORMVAL },
  { file: 'app.js', has: 'st.when.join(\'\\n\') : \'\'', why: NOT_TEXT }, { file: 'app.js', has: 'ph.when.join(\'\\n\') : \'\'', why: NOT_TEXT },
  { file: 'app.js', has: 'builderField(box, cur.join', why: FILE }, { file: 'app.js', has: 'cssEsc(p.join(\':\'))', why: NOT_TEXT },
  { file: 'app.js', has: 'typeChange(\'move\'', why: NOT_TEXT }, { file: 'app.js', has: 'res.notes.slice(0, 3)', why: 'the first 3 and "And N more"' },
  { file: 'app.js', has: 'fields.carry = carry.join', why: FILE }, { file: 'app.js', has: 'fields.pass = pe.map', why: FILE },
  { file: 'app.js', has: '[gone.name, gone.label, gone.kind]', why: FIXED }, { file: 'app.js', has: 'typeChange(\'option removal\'', why: FORMVAL },
  { file: 'app.js', has: 'typeChange(\'tag removal\'', why: FORMVAL }, { file: 'app.js', has: 'sigN = names.join', why: NOT_TEXT },
  { file: 'app.js', has: 'return { text: out.join', why: FILE },
  { file: 'app.js', has: 'cx.renamed.concat(rl.renamed)', why: 'names typed in New checklist\'s boxes, each at most 120 characters' }
];
/* Every .join( in the views and app.js whose separator isn't '', with its line number and file. */
function joins(src) {
  const out = [];
  src.split('\n').forEach((line, i) => {
    const re = /\.join\(([^)]*)\)/g; let m, any = false;
    while ((m = re.exec(line))) if (m[1] !== "''") any = true;
    if (any) out.push({ line: i + 1, text: line });
  });
  return out;
}
const JOIN_SRC = () => {
  const dir = path.join(__dirname, '..', 'src', 'ui', 'views');
  return fs.readdirSync(dir).filter(f => /\.js$/.test(f)).map(f => ({ f, src: fs.readFileSync(path.join(dir, f), 'utf8') }))
    .concat([{ f: 'app.js', src: fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8') }]);
};
rule('D10: every list joined into text in the views and app.js, with any separator, is capped, or exempt with a reason', () => {
  const left = [], used = new Set();
  JOIN_SRC().forEach(({ f, src }) => {
    joins(src).forEach(j => {
      const ok = D10_JOIN_OK.filter(e => e.file === f && j.text.indexOf(e.has) >= 0);
      ok.forEach(e => used.add(e));
      if (!ok.length) left.push(f + ':' + j.line + ': ' + j.text.trim().slice(0, 140));
    });
  });
  assert.deepStrictEqual(left, [], 'joined without a cap');
  assert.deepStrictEqual(D10_JOIN_OK.filter(e => !used.has(e)).map(e => e.file + ': ' + e.has), [], 'an exemption that matches nothing any more');
});
rule('D10 is tested (round 10): the join reader finds \' and \', \' · \', \' / \', \'\\n\' and \' @\', and passes \'\' (rows, which D8 bounds)', () => {
  const src = ["a.join(' and ')", "b.join(' · ')", "c.join(' / ')", "d.join('\\n')", "e.join(' @')", "f.join('')", "g.join()"].join('\n');
  assert.deepStrictEqual(joins(src).map(j => j.line), [1, 2, 3, 4, 5, 7]);
});
rule('D10 is tested (round 11): a notice without a role (class="notice ...") or with aria-live, built in a .map, is found too', () => {
  const src = "a.map(function (e) { return '<div class=\"notice warn\"><span>' + e + '</span></div>'; }); b.forEach(function (x) { h += '<p aria-live=\"polite\">' + x + '</p>'; }); c.map(function (y) { return '<li>' + y + '</li>'; });";
  const found = callbacks(src).filter(c => NOTICE.test(c.body));
  assert.deepStrictEqual(found.map(c => c.kind), ['map', 'forEach']);
});
rule('D10 is tested (round 12): a notice built by a helper, or by a helper of a helper, called from a .map or from a list\'s row: function, inline or named, is found', () => {
  const src = "function note(n) { return '<div class=\\\"notice warn\\\" role=\\\"status\\\">' + n + '</div>'; }\n" +
    "function wrap(n) { return '<p>' + note(n) + '</p>'; }\n" +
    "function plain(n) { return '<p>' + n + '</p>'; }\n" +
    "var linkRow = function (n) { return '<div>' + wrap(n) + '</div>'; };\n" +
    "K.roleRows(st, 'a', names, { row: linkRow });\n" +
    "K.roleRows(st, 'b', names, { row: function (n) { return note(n); } });\n" +
    "x.map(function (n) { return wrap(n); }); y.map(function (n) { return plain(n); });";
  const helpers = noticeHelpers(src);
  assert.deepStrictEqual([...helpers].sort(), ['linkRow', 'note', 'wrap']);
  const hits = callbacks(src).filter(c => NOTICE.test(c.body) || callsAny(c.body, helpers).length);
  assert.deepStrictEqual(hits.map(c => c.kind + ':' + c.line), ['map:7', 'row:5', 'row:6']);
  assert.deepStrictEqual([...noticeHelpers(src, new Set(['note']))], [], 'an exempt helper makes no helper of its callers');
});
rule('D10 is tested: the reader finds a notice built in a forEach and an option built in a map', () => {
  const found = callbacks('a.forEach(function (x) { h += \'<div role="status">\' + /[(]/.test(x) + \'</div>\'; }); b.map(function (y) { return \'<option>\' + y; });');
  assert.deepStrictEqual(found.map(c => c.kind), ['forEach', 'map']);
  assert.ok(/role="status"/.test(found[0].body) && /<option/.test(found[1].body));
});


rule('Round 5: 170 members with Decline open, Show more to 100, newer members sort in above and push the focused one past the page: one group, one Decline box, and the right count', async () => {
  const app = await fresh();
  const notes = app.files('runs/versions/').filter(f => /\/notes-corr\.jsonl$/.test(f)).sort();
  for (const f of notes.slice(170)) await app.fs.remove(f);
  await reread(app);
  await corrections(app, 'versions');
  let h = app.html();
  const gid = fxGroups(h)[0];
  assert.ok(gid && fxGroups(h).length === 1 && /120 more in this group/.test(h), 'set-up: one group of 170, 50 drawn');
  app.click('pick', gid, { kind: 'corr-decline' }); await app.tick(5);
  app.set('pick-input', 'Not this one');
  await more(app, 'fx:versions');
  h = app.html();
  const ms = fxMembers(h), last = ms[ms.length - 1];
  assert.strictEqual(ms.length, 100, 'set-up: 100 drawn');
  app.node('[id="fxm-' + last + '"]').focus();
  /* Five more members arrive, in runs that had none, sorting in above: the focused member is past the page. */
  const first = JSON.parse(app.fs.files[notes[0]].t.split('\n')[0]);
  for (let i = 0; i < 5; i++) {
    const n = Object.assign({}, first, { id: 'old' + i, at: '2026-10-26T01:0' + i + ':00.000Z', why: 'Older ' + i });
    await app.fs.write(notes[170 + i], JSON.stringify(n) + '\n');
  }
  const was = app.PF.perf.n['load.done'] || 0;
  app.focus();
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(5);
  h = app.html();
  assert.strictEqual(app.activeId(), 'fxm-' + last, 'focus stays on its member');
  assert.ok(fxMembers(h).indexOf(last) >= 0 && fxMembers(h).length === 101, 'the page and the one with focus: ' + fxMembers(h).length);
  assert.strictEqual(count(h, new RegExp('id="fxg-' + gid + '"', 'g')), 1, 'the group drawn once');
  assert.strictEqual(count(h, /id="pick-input"/g), 1, 'one Decline box');
  assert.strictEqual(count(h, /data-act="corr-decline"/g), 1, 'one Decline button');
  const of = /Showing 100 of (\d+), plus the one you(?:&#39;|')re on/.exec(h);
  assert.ok(of && +of[1] > 170, 'the list says so: ' + (/Showing[^<]*/.exec(h) || [''])[0]);
  assert.deepStrictEqual(h.match(/[\d,]+ more in this group/g), [(of[1] - 101) + ' more in this group'], 'counted over every member drawn');
  assert.strictEqual(app.draft('pick-input'), 'Not this one', 'what was typed is in the one box');
  app.set('pick-input', 'Not this one, again');
  app.click('corr-decline', gid); await app.tick(30);
  const dec = app.files('corrections/versions/').map(f => app.fs.files[f].t).filter(t => /declined/.test(t));
  assert.ok(dec.length === 1 && /Not this one, again/.test(dec[0]), 'Decline sends the one box\'s text: ' + dec.length);
});

/* ---------- code review round 8 ---------- */
/* A small folder with a draft of 60 run details (detail0…detail59), and that many other drafts whose linked step passes
   detail59 to it, open in the builder on its Checklist details. */
const SMALL = { procs: 3, tags: 3, people: 10, followUps: 3, running: 3, plans: 3, versions: 3, stages: 2, members: 3, health: 3, many: 3, ended: 3, steps: 8, teamValues: 3, legacy: 3, archived: 3, hot: 3 };
async function sixtyDetails(parents) {
  const fx = fixture({ size: SMALL }), files = Object.assign({}, fx.files);
  const fm = (proc, title, ctx) => '---\nprocess: ' + proc + '\ntitle: ' + title + '\ncategory: Synthetic\nowner: person-avery\ncontext: ' + ctx + '\nroles: lead\n---\n\n';
  files['maps/drafts/sixty.md'] = fm('sixty', 'Sixty details', Array.from({ length: 60 }, (x, i) => 'detail' + i).join(', ')) + '## Only · READ-DO {#ph1}\n- [ ] {confirm} Check ^detail59 and ^detail45 @lead {#s0}\n';
  for (let i = 0; i < parents; i++) files['maps/drafts/parent-' + i + '.md'] = fm('parent' + i, 'Parent ' + i, 'detail59') + '## Only · READ-DO {#ph1}\n- [ ] {run.process} Start the sixty @lead {#k0}\n  process: sixty\n  pass: detail59=^detail59\n';
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, { files, facts: fx.facts });
  await openProc(app, 'sixty', 'edit');
  app.click('ed-mode', 'builder'); await app.tick(10);
  app.click('ob-sel-details'); await app.tick(10);
  assert.ok(/data-act="ob-ren" data-id="detail0"/.test(app.html()), 'set-up: Checklist details of Sixty details');
  return app;
}
const renBtn = n => '[data-act="ob-ren"][data-id="' + n + '"]';
const focusedOn = (app, sel) => { const el = app.node(sel); return !!el && app.doc.activeElement === el; };
async function rename(app, from, to) { app.click('ob-ren', from); await app.tick(5); app.set('ob-ren-ctx', to); app.click('ob-ren-go', from); await app.tick(10); }
rule('Round 8: a run detail renamed while Find narrows 60 to it is drawn and focused, and stays drawn when Find is cleared; one past page one, the same', async () => {
  const app = await sixtyDetails(0);
  await typeFind(app, 'ob-meta-context', 'detail59');
  assert.ok(/data-act="ob-ren" data-id="detail59"/.test(app.html()) && count(app.html(), /data-act="ob-ren" data-id=/g) === 1, 'set-up: Find found it');
  await rename(app, 'detail59', 'renamed59');
  let h = app.html();
  assert.ok(/data-act="ob-ren" data-id="renamed59"/.test(h), 'the renamed detail is drawn, though Find says detail59');
  assert.ok(focusedOn(app, renBtn('renamed59')), 'and focused: ' + app.activeId());
  app.click('find-clear', 'ob-meta-context'); await app.tick(5);
  h = app.html();
  assert.ok(/data-act="ob-ren" data-id="renamed59"/.test(h), 'still drawn with Find cleared, though past page one');
  assert.ok(/Just renamed/.test(h), 'said to be the one just renamed');
  assert.ok(count(h, /data-act="ob-ren" data-id=/g) <= 21, 'the page and that one');
  /* Without Find: detail45 is past page one of 60. */
  await rename(app, 'detail45', 'renamed45');
  h = app.html();
  assert.ok(/data-act="ob-ren" data-id="renamed45"/.test(h) && focusedOn(app, renBtn('renamed45')), 'drawn and focused past page one: ' + app.activeId());
  assert.ok(!/data-act="ob-ren" data-id="renamed59"/.test(h), 'the earlier rename is let go');
});
rule('Round 8: Rename with 60 other checklists passing the detail draws 20 of their warnings, Show more adds 20 and focuses the first, and the rename still reads all 60', async () => {
  const app = await sixtyDetails(60);
  app.click('ob-ren', 'detail59'); await app.tick(10);
  let h = app.html();
  const warn = () => count(app.html(), /<li id="ob-ren-dep-[^"]*" tabindex="-1" class="info">/g);
  assert.strictEqual(warn(), 20, 'a page of warnings');
  assert.ok(/Showing 20 of 60/.test(h), 'the count');
  assert.ok(/ Used in [^<]*\./.test(h), 'what it\'s used in');
  const d = await more(app, 'ob-ren-deps');
  assert.strictEqual(warn(), 40, 'Show more adds 20');
  assert.ok(focusedOn(app, d.focus), 'and focuses the first it adds: ' + app.activeId());
  app.set('ob-ren-ctx', 'renamed59'); app.click('ob-ren-go', 'detail59'); await app.tick(10);
  h = app.html();
  assert.ok(/data-act="ob-ren" data-id="renamed59"/.test(h), 'renamed');
  const msg = (app.top() + h).match(/Renamed \^detail59 to \^renamed59[^<]*/);
  assert.ok(msg && /And 57 more like these\./.test(msg[0]), 'the message names three of the 60 and counts the rest: ' + (msg || [''])[0].slice(0, 200));
  assert.ok((msg[0].match(/passes \^detail59 to this checklist/g) || []).length === 3, 'three said in full');
});
rule('Round 8: a step of a checklist with 60 run details draws 20 of them and the 2 it names, and 20 in Sets a run detail; Find reaches detail 58, and once tied it stays drawn with Find cleared', async () => {
  const app = await sixtyDetails(0);
  app.click('ob-sel', 's0'); await app.tick(10);
  app.click('ob-show', 'sets'); await app.tick(10);
  let h = app.html();
  assert.strictEqual(count(h, /data-act="ob-bind"/g), 22, 'a page of the step\'s run details, and detail45 and detail59 it names');
  assert.strictEqual(count(h, /data-act="ob-sets"/g), 20, 'a page of Sets a run detail');
  assert.ok(/id="find-ob-binds"/.test(h) && /id="find-ob-sets"/.test(h), 'each with Find');
  assert.ok(!/data-act="ob-bind" data-id="detail58"/.test(h), 'set-up: detail 58 is past the page');
  await typeFind(app, 'ob-binds', 'detail58');
  assert.ok(/data-act="ob-bind" data-id="detail58"/.test(app.html()), 'Find reaches detail 58');
  app.click('ob-bind', 'detail58'); await app.tick(10);
  assert.ok(/data-act="ob-bind" data-id="detail58" aria-pressed="true"/.test(app.html()), 'tied to the step');
  app.click('find-clear', 'ob-binds'); await app.tick(5);
  h = app.html();
  assert.ok(/data-act="ob-bind" data-id="detail58" aria-pressed="true"/.test(h), 'drawn with Find cleared, past page one');
  assert.strictEqual(count(h, /data-act="ob-bind"/g), 23, 'the page and the step\'s own three');
});
rule('Round 8: K.capJoin draws the first 50 names and "and N more", builds only those, and lists 50 or fewer whole', () => {
  const K = require('./harness').loadViews().vk;
  const names = Array.from({ length: 300 }, (x, i) => 'n' + i);
  let built = 0;
  const t = K.capJoin(names, x => { built++; return '<b>' + x + '</b>'; });
  assert.strictEqual((t.match(/<b>/g) || []).length, 50);
  assert.ok(/, and 250 more$/.test(t) && built === 50, t.slice(-40) + ' ' + built);
  assert.strictEqual(K.capJoin(names.slice(0, 50)), names.slice(0, 50).join(', '));
  assert.strictEqual(K.capJoin(['a', 'b', 'c'], null, '; '), 'a; b; c');
  assert.ok(/; and 1 more$/.test(K.capJoin(names.slice(0, 51), null, '; ')));
});
rule('Round 8: the checklist preview names 50 of a step\'s 300 skills and 50 of the whole checklist\'s 301, each with how many more and a link that opens and focuses Skills', async () => {
  /* Its own app: an earlier rule can leave the shared one on another view of the checklist (code review round 9). */
  const app = await fresh(); await openProc(app, 'steps');
  let h = app.html();
  const upTo = (from, end) => { const i = h.indexOf(from); return i < 0 ? null : [h.slice(i, h.indexOf(end, i))]; };
  const stepSkills = upTo('<span class="pv-skill">', '</span></span>'), whole = upTo('The whole checklist: ', '</p>');
  assert.ok(stepSkills && whole, 'set-up: both are drawn');
  assert.strictEqual(count(stepSkills[0], /step-skill-\d+/g), 50);
  assert.strictEqual(count(whole[0], /whole-skill/g), 50, 'v2\'s 300 and one built on v1');
  assert.ok(/and 250 more/.test(stepSkills[0]) && /and 251 more/.test(whole[0]), 'the rest counted');
  assert.ok(/data-act="pv-skills"/.test(stepSkills[0]) && /data-act="pv-skills"/.test(whole[0]), 'each with the link to Skills');
  /* From the editor's Preview too: the link goes to the overview with Skills open and focused. */
  app.click('ptab', 'edit'); await app.tick(10);
  app.click('pv-skills'); await app.tick(10);
  h = app.html();
  assert.ok(/id="sk-h" tabindex="-1"/.test(h), 'Skills is drawn');
  assert.strictEqual(app.activeId(), 'sk-h', 'and focused');
  assert.ok(/data-act="open-skill"/.test(h), 'its rows are there, paged');
});

/* ---------- code review round 9 ---------- */
rule('Round 9: See all in Skills from the editor\'s Preview refuses while a run detail typed in Checklist details isn\'t added, keeps the text and says so; added, it goes', async () => {
  const app = await sixtyDetails(0);
  app.set('ob-add-ctx', 'typednew'); app.input('ob-add-ctx', 'typednew'); await app.tick(5);
  app.click('ins-tab', 'preview'); await app.tick(5);
  app.click('pv-skills'); await app.tick(10);
  let h = app.html();
  assert.ok(/id="ob-add-ctx"/.test(h) && !/id="sk-h"/.test(h), 'still in the editor, Skills not opened');
  assert.strictEqual(app.el('ob-add-ctx').value, 'typednew', 'the typed name is kept');
  assert.ok(/Apply or clear what you typed in the box first/.test(app.top() + h), 'and it says why');
  assert.strictEqual(app.activeId(), 'ob-add-ctx', 'focus on the box');
  app.set('ob-add-ctx', ''); app.input('ob-add-ctx', ''); await app.tick(5);
  app.click('pv-skills'); await app.tick(10);
  assert.ok(/id="sk-h"/.test(app.html()), 'with the box cleared, it opens Skills');
});
rule('Round 9: a skill built on a 1-role version of a checklist that now has 300 roles names 50 in What it takes and how many more; the copied brief names all 300', async () => {
  const app = await bigApp();
  app.click('nav', 'skills'); await app.tick(5); app.click('open-skill', 'old-roles-skill.json'); await app.tick(10);
  const h = app.html(), m = /<b>What it takes:<\/b>([^<]*)<\/li>/.exec(h);
  assert.ok(m, 'set-up: What it takes is drawn');
  const line = un(m[1]);
  assert.strictEqual(count(line, /\br\d+\b/g), 49, 'lead and 49 of the r roles: 50 names');
  assert.ok(/Roles: now lead, r1, r2, [^(]*, r49, and 250 more \(was lead\)/.test(line), line.slice(0, 80) + ' … ' + line.slice(-60));
  try { app.click('copy-brief', 'update:old-roles-skill.json'); } catch (e) { if (!/createRange/.test(e.message)) throw e; }
  await app.tick(5);
  const brief = un(/<pre id="brief-pre"[^>]*>([\s\S]*?)<\/pre>/.exec(app.html())[1]);
  assert.ok(/Roles: now lead, r1, r2, [\s\S]*, r298, r299 \(was lead\)/.test(brief) && count(brief, /\br\d+\b/g) >= 299, 'the brief keeps every role');
});


/* ---------- code review round 10 ---------- */
rule('Round 10: K.capJoin with \' and \' says "and 250 more" once, and a list of sentences can end its own way', () => {
  const K = require('./harness').loadViews().vk, names = Array.from({ length: 300 }, (x, i) => '"A' + i + '"');
  const t = K.capJoin(names, null, ' and ');
  assert.strictEqual((t.match(/"A\d+"/g) || []).length, 50);
  assert.ok(/"A49" and 250 more$/.test(t) && !/and and/.test(t), t.slice(-40));
  assert.strictEqual(K.capJoin(['a', 'b'], null, ' and '), 'a and b');
  assert.ok(/ c\. And 250 more\.$/.test(K.capJoin(Array.from({ length: 300 }, () => 'c.'), null, ' ', null, n => ' And ' + n + ' more.')));
});
rule('Round 10: a checklist with 300 approvals one role owns names 50 in that role\'s label and in On my own, with how many more', async () => {
  const fx = fixture({ size: SMALL }), files = Object.assign({}, fx.files);
  const md = '---\nprocess: gates300\ntitle: Many approvals\ncategory: Synthetic\nowner: person-avery\nroles: lead, approver\n---\n\n' +
    Array.from({ length: 300 }, (x, i) => '## Phase ' + (i + 1) + ' · READ-DO {#ph' + (i + 1) + '}\n- [ ] {confirm} Step ' + i + ' @lead {#s' + i + '}\n\n## Gate: Approval ' + (i + 1) + ' · owner @approver {#g' + (i + 1) + '}\n\n').join('');
  const pub = require('./harness').load().publish.build(md, { people: fx.facts.people, by: 'person-avery', changes: 'First', existing: [], now: new Date().toISOString(), rand: 'gatesabc' });
  assert.ok(!pub.blockers, 'set-up: publishes: ' + (pub.blockers || []).join('; '));
  Object.keys(pub.files).forEach(f => { files['publications/gates300/' + pub.folder + '/' + f] = pub.files[f]; });
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, { files, facts: fx.facts });
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'gates300'); await app.tick(10);
  app.click('start', 'gates300'); await app.tick(10);
  let h = app.html();
  const label = (/· approves ([^<]*)<\/span>/.exec(h) || [])[1] || '';
  assert.strictEqual((label.match(/Approval \d+/g) || []).length, 50, 'the role\'s label names 50');
  assert.ok(/Approval 50&quot; and 250 more$/.test(label), 'and says how many more: ' + label.slice(-40));
  app.click('start-mode', 'solo', { process: 'gates300' }); await app.tick(10);
  h = app.html();
  const solo = (/including who approves ([^<]*)<\/p>/.exec(h) || [])[1] || '';
  assert.strictEqual((solo.match(/Approval \d+/g) || []).length, 50, 'On my own names 50');
  assert.ok(/and 250 more\. If someone joins/.test(solo), solo.slice(-60));
});
rule('Round 10: a linked step whose child is a draft with 60 run details draws 20 of them, with Find; a fixed value typed and not applied stays drawn with its text through Find and Show more', async () => {
  const fx = fixture({ size: SMALL }), files = Object.assign({}, fx.files);
  const fm = (proc, title, ctx) => '---\nprocess: ' + proc + '\ntitle: ' + title + '\ncategory: Synthetic\nowner: person-avery\ncontext: ' + ctx + '\nroles: lead\n---\n\n';
  files['maps/drafts/kid60.md'] = fm('kid60', 'Sixty child', Array.from({ length: 60 }, (x, i) => 'detail' + i).join(', ')) + '## Only · READ-DO {#ph1}\n- [ ] {confirm} Check ^detail0 @lead {#s0}\n';
  files['maps/drafts/par.md'] = fm('par', 'Parent', 'env') + '## Only · READ-DO {#ph1}\n- [ ] {run.process} Start the child @lead {#k0}\n  process: kid60\n';
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, { files, facts: fx.facts });
  await openProc(app, 'par', 'edit');
  app.click('ed-mode', 'builder'); await app.tick(10);
  app.click('ob-sel', 'k0'); await app.tick(10);
  const rows = () => count(app.html(), /<div class="field ob-link-row"[ >]/g);
  assert.strictEqual(rows(), 20, 'a page of what the child needs');
  assert.ok(/id="find-ob-link-rows"/.test(app.html()), 'with Find');
  app.select('ob-link-src-detail5', '='); await app.tick(10);
  assert.ok(/id="ob-link-val-detail5"/.test(app.html()), 'set-up: A fixed value asks for it');
  app.set('ob-link-val-detail5', 'typed, not applied'); app.input('ob-link-val-detail5', 'typed, not applied'); await app.tick(5);
  await typeFind(app, 'ob-link-rows', 'detail58');
  let h = app.html();
  assert.ok(/id="ob-link-src-detail58"/.test(h), 'Find reaches detail 58');
  assert.ok(/id="ob-link-val-detail5"/.test(h), 'the row being filled in stays drawn');
  assert.strictEqual(app.draft('ob-link-val-detail5'), 'typed, not applied', 'with its text');
  app.click('find-clear', 'ob-link-rows'); await app.tick(5);
  await more(app, 'ob-link-rows');
  assert.strictEqual(rows(), 40, 'Show more adds 20');
  assert.strictEqual(app.draft('ob-link-val-detail5'), 'typed, not applied', 'the text is still there');
});
rule('Round 10: a draft open by 60 people names 50 of them and how many more', () => {
  const PF = require('./harness').loadViews(), V = PF.views;
  const ctx = { state: {}, data: { people: [] }, peopleById: {} };
  const h = V.editingNote(ctx, { editing: Array.from({ length: 60 }, (x, i) => ({ by: 'person-' + i, ago: 1000 })) });
  assert.strictEqual(count(h, /Being edited by/g), 50);
  assert.ok(/And 10 more\./.test(h), h.slice(-120));
});

/* ---------- code review round 11 ---------- */
rule('Round 11: two phase corrections sharing id, author, time and reason but not from and base are two groups, and each search result opens its own', async () => {
  const app = await fresh();
  const Cc = app.PF.corrections, key = fixture().facts.busy;
  const r = JSON.parse(app.fs.files['runs/' + key + '/run.json'].t), cmap = app.PF.run.mapOf(r);
  const b = Cc.build({ id: 'fbtwin', at: '2026-10-27T08:00:00.000Z', by: 'person-blake', session: 'fb', map: cmap, version: +r.version, folder: r.folder, phase: 'ph2', op: 'describe', why: 'Twins apart only by what they started from' });
  const one = Object.assign({}, b, { from: 'Phase two, as one copy had it', base: '1a2b3c4d' }), two = Object.assign({}, b, { from: 'Phase two, as another copy had it', base: '5e6f7a8b' });
  await app.fs.write('runs/' + key + '/notes-fb.jsonl', [one, two].map(n => JSON.stringify(n)).join('\n') + '\n');
  await reread(app);
  assert.strictEqual(app.PF.corrections.groups(app.PF.corrections.collect([Object.assign({}, r, { _notes: [one, two] })], r.process)).length, 2, 'set-up: two groups');
  const hits = (await search(app, 'Twins apart only by')).filter(x => /:fbtwin/.test(x));
  assert.strictEqual(hits.length, 2, 'set-up: two results: ' + hits.join(', '));
  const opened = [];
  for (const hit of hits) {
    app.click('nav', 'home'); await app.tick(5); await search(app, 'Twins apart only by');
    app.click('sx-open', hit); await app.tick(20);
    const id = app.activeId();
    assert.ok(/^fxg-/.test(id), 'its group is opened and focused, not the run: ' + id);
    assert.ok(/Twins apart only by/.test(liText(app.html(), id)), 'a group of the twins');
    opened.push(id.slice(4));
  }
  assert.notStrictEqual(opened[0], opened[1], 'each opens its own');
});

const wideOf = (h, from, end) => { const i = h.indexOf(from); return i < 0 ? null : h.slice(i, h.indexOf(end, i + from.length)); };
const names = (t, re) => (t.match(re) || []).length;
rule('Round 11: a step and a lane with 300 roles name 50 and how many more in the builder, the previews, a run and screen share', async () => {
  const app = await bigApp();
  const at50 = (t, what) => { assert.ok(t, what + ': drawn'); assert.strictEqual(names(t, /@w\d+\b/g), 50, what + ': 50 roles'); assert.ok(/ and 250 more/.test(t), what + ': and how many more'); };
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'wide'); await app.tick(10);
  app.click('flight', 'list'); await app.tick(5);
  let h = app.html();
  at50(wideOf(h, '<span class="pv-role">@w1 ', '</span>'), 'the preview\'s step');
  at50(wideOf(h, 'pv-lane-h">Wide lane', '</p>'), 'the preview\'s lane');
  app.click('flight', 'plan'); await app.tick(5); h = app.html();
  at50(wideOf(h, '<p class="fp-slane-h"><b>Wide lane', '</p>') || wideOf(h, '<li class="fp-lane"><b>Wide lane', '</li>'), 'the flight plan\'s lane');
  app.click('ptab', 'edit'); await app.tick(10); app.click('ed-mode', 'builder'); await app.tick(10); app.click('ob-sel', 'all'); await app.tick(10);
  h = app.html();
  at50(wideOf(h, 'data-ob-step="all"', '</li>'), 'the builder\'s step row');
  at50(wideOf(h, '<div class="ob-lane-h">', '</div>'), 'the builder\'s lane');
  app.click('ob-sel', 'inwide'); await app.tick(10);
  at50(wideOf(app.html(), 'Uses this lane', '</span>'), 'Who does it, for a step in the lane');
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', fixture().facts.wide); await app.tick(10); app.click('select', 'all'); await app.tick(10);
  h = app.html();
  const people = (t, what, re) => { assert.ok(t, what + ': drawn'); assert.strictEqual(names(t, re || /Person \d+/g), 50, what + ': 50 people'); assert.ok(/ and 250 more/.test(t), what + ': and how many more'); };
  people(wideOf(h, '<span class="s-who">', '</span>'), 'the run\'s step row');
  people(wideOf(h, 'aria-label="Next up"', '</b>'), 'Next up');
  people(wideOf(h, '<div class="track-head"><h3 id="tr-wide">', '</div>'), 'the run\'s lane', /<\/span>Person \d+/g);
  people(wideOf(h, '<div class="rw-ins-meta">', '</div>'), 'the inspector', /<\/span>Person \d+/g);
  app.click('mission'); await app.tick(10); h = app.html();
  const ms = wideOf(h, 'Everyone signs this', '</li>');
  assert.strictEqual(names(ms, /class="avatar lg"/g), 50, 'screen share: 50 people');
  assert.ok(/and 250 more/.test(ms), 'screen share: and how many more');
  app.click('exit-mission'); await app.tick(5);
});

rule('Round 11: a linked step carrying 40 run details its child doesn\'t have shows one notice, with the names 20 at a time; Remove on the fifth keeps focus on its own button through a redraw', async () => {
  const app = await fresh();
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'staleparent'); await app.tick(10);
  app.click('ptab', 'edit'); await app.tick(10); app.click('ed-mode', 'builder'); await app.tick(10); app.click('ob-sel', 'lks'); await app.tick(10);
  let h = app.html();
  assert.strictEqual(count(h, /class="notice warn ob-stale" role="status"/g), 1, 'one notice');
  assert.strictEqual(count(h, /Stale child v1 has no run detail/g), 1, 'saying it once');
  assert.ok(/has no run detail for 40 of the names this step passes/.test(h), 'with how many');
  assert.strictEqual(count(h, /<li id="ob-stale-lks-carry:d\d+"/g), 20, '20 in its fold');
  await more(app, 'ob-stale:lks');
  h = app.html();
  assert.strictEqual(count(h, /<li id="ob-stale-lks-carry:d\d+"/g), 40, 'Show more adds 20');
  assert.strictEqual(app.activeId(), 'ob-stale-lks-carry:d020', 'and focuses the first it adds');
  app.node('[id="ob-stale-lks-carry:d004"] [data-act="ob-link-rm"]').focus();
  app.click('dismiss'); await app.tick(5);
  await reread(app);
  const a = app.doc.activeElement;
  assert.ok(a && a.dataset && a.dataset.act === 'ob-link-rm' && a.dataset.name === 'd004', 'focus stays on the fifth row\'s Remove: ' + app.activeId() + ' ' + (a && a.dataset && a.dataset.name));
});

/* ---------- code review round 12 ---------- */
/* The builder's Who does it on the wide checklist's step "all": 301 roles, the step's own 300 kept (K.list's ordinary tier). */
async function wideWho(app) {
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'wide'); await app.tick(10);
  app.click('ptab', 'edit'); await app.tick(10); app.click('ed-mode', 'builder'); await app.tick(10); app.click('ob-sel', 'all'); await app.tick(10);
}
const roleChips = h => ids(h, /data-act="ob-role" data-id="([^"]+)"/g);
rule('Round 12: Find w250 in Who does it, with all 300 of the step\'s roles kept, draws w250 first and announces 1 of 301 match', async () => {
  const app = await fresh();
  await wideWho(app);
  assert.strictEqual(roleChips(app.html()).length, 40, 'set-up: a page of 20 and a page of its kept roles');
  await typeFind(app, 'ob-roles', 'w250');
  const h = app.html(), drawn = roleChips(h);
  assert.ok(/id="find-ob-roles-n" role="status">1 of 301 match</.test(h), 'announced');
  assert.deepStrictEqual(drawn, ['w250'], 'the one match, and no role Find leaves out: ' + drawn.slice(0, 5).join(', '));
});
rule('Round 12: Show 20 more in Who does it, with all 300 of the step\'s roles kept, adds the 20 rows it says', async () => {
  const app = await fresh();
  await wideWho(app);
  const before = roleChips(app.html()), d = moreOf(app.html(), 'ob-roles');
  assert.ok(d, 'a Show more');
  const said = +/Show (\d+) more/.exec(app.html().slice(app.html().indexOf('data-id="ob-roles" data-next'))) [1];
  await more(app, 'ob-roles');
  const after = roleChips(app.html()), added = after.filter(r => before.indexOf(r) < 0);
  assert.strictEqual(said, 20, 'it says 20');
  assert.strictEqual(added.length, said, 'Show ' + said + ' more added ' + added.length);
  assert.strictEqual(new Set(after).size, after.length, 'no role twice');
  assert.strictEqual(app.doc.activeElement && app.doc.activeElement.dataset.id, d.next, 'focus on the first it adds');
});
rule('Round 12: a linked step passing 40 team values that aren\'t in the folder draws one notice, with 20 names in its fold and Show more', async () => {
  const app = await fresh();
  const md = app.fs.files['maps/drafts/linkbig.md'].t.replace(/process: linkbig/, 'process: teamgap').replace(/title: [^\n]*/, 'title: Passes missing team values').replace('{#lkb}', '{#lkt}')
    .replace('  process: bigkid\n', '  process: bigkid\n  pass: ' + Array.from({ length: 40 }, (x, i) => 'd' + String(i).padStart(3, '0') + '=team:gone-' + String(i).padStart(3, '0')).join(', ') + '\n');
  await app.fs.write('maps/drafts/teamgap.md', md); await reread(app);
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'teamgap'); await app.tick(10);
  app.click('ptab', 'edit'); await app.tick(10); app.click('ed-mode', 'builder'); await app.tick(10); app.click('ob-sel', 'lkt'); await app.tick(10);
  let h = app.html();
  assert.ok(/data-act="ob-link-rm"|ob-link-src-d000/.test(h), 'set-up: the linked step');
  assert.strictEqual(count(h, /role="status"><span>gone-\d+ isn/g), 0, 'no notice per run detail');
  assert.strictEqual(count(h, /class="notice warn ob-team-bad" role="status"/g), 1, 'one notice');
  assert.ok(/40 run details this step passes take a team value that isn(&#39;|')t in this folder/.test(h), 'with how many');
  assert.strictEqual(count(h, /<li id="ob-team-miss-lkt-d\d+"/g), 20, '20 in its fold');
  await more(app, 'ob-team-miss:lkt');
  h = app.html();
  assert.strictEqual(count(h, /<li id="ob-team-miss-lkt-d\d+"/g), 40, 'Show more adds 20');
  assert.strictEqual(app.activeId(), 'ob-team-miss-lkt-d020', 'and focuses the first it adds');
});

/* ---------- code review round 13 ---------- */
/* A parent with 60 run details of its own (so each source dropdown has Find and Show more choices) linking a child draft with
   60 run details; the parent passes detail3 and detail5 a fixed value. Open in the builder on the linked step. */
async function linkedSixty() {
  const fx = fixture({ size: SMALL }), files = Object.assign({}, fx.files);
  const fm = (proc, title, ctx) => '---\nprocess: ' + proc + '\ntitle: ' + title + '\ncategory: Synthetic\nowner: person-avery\ncontext: ' + ctx + '\nroles: lead\n---\n\n';
  const kid = ctx => fm('kid60', 'Sixty child', ctx.join(', ')) + '## Only · READ-DO {#ph1}\n- [ ] {confirm} Check ^detail0 @lead {#s0}\n';
  const names = Array.from({ length: 60 }, (x, i) => 'detail' + i);
  files['maps/drafts/kid60.md'] = kid(names);
  files['maps/drafts/par.md'] = fm('par', 'Parent', Array.from({ length: 60 }, (x, i) => 'own' + i).join(', ')) + '## Only · READ-DO {#ph1}\n- [ ] {run.process} Start the child @lead {#k0}\n  process: kid60\n  pass: detail3=aaa, detail5=bbb\n';
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, { files, facts: fx.facts });
  await openProc(app, 'par', 'edit');
  app.click('ed-mode', 'builder'); await app.tick(10);
  app.click('ob-sel', 'k0'); await app.tick(10);
  /* A newer child draft with a run detail inserted first (or n of them), read as Check the folder now does. */
  const insert = async n => { await app.fs.write('maps/drafts/kid60.md', kid(Array.from({ length: n }, (x, i) => 'aaa' + i).concat(names))); await reread(app); };
  return { app, insert };
}
const leave = async (app, id, v) => { app.set(id, v); app.input(id, v); await app.tick(2); app.select(id, v); await app.tick(5); };
rule('Round 13: two existing fixed values edited to refused text and left both stay drawn with their text through Find and back (finding 1)', async () => {
  const { app } = await linkedSixty();
  let h = app.html();
  assert.ok(/id="ob-link-val-detail3"[^>]*value="aaa"/.test(h) && /id="ob-link-val-detail5"[^>]*value="bbb"/.test(h), 'set-up: both fixed values drawn');
  await leave(app, 'ob-link-val-detail3', 'first, refused');
  await leave(app, 'ob-link-val-detail5', 'second, refused');
  await typeFind(app, 'ob-link-rows', 'detail39');
  h = app.html();
  assert.ok(/id="ob-link-src-detail39"/.test(h), 'set-up: Find reaches detail39');
  assert.ok(/id="ob-link-val-detail3"/.test(h), 'the first refused row stays drawn');
  assert.ok(/id="ob-link-val-detail5"/.test(h), 'the second refused row stays drawn');
  app.click('find-clear', 'ob-link-rows'); await app.tick(5);
  assert.strictEqual(app.draft('ob-link-val-detail3'), 'first, refused', 'the first one\'s text is still there');
  assert.strictEqual(app.draft('ob-link-val-detail5'), 'second, refused', 'and the second one\'s');
  assert.ok(/  pass: detail3=aaa, detail5=bbb\n/.test(app.fs.files['maps/drafts/par.md'].t), 'nothing refused was saved');
});
rule('Round 13: focus on a nested control of the 20th linked detail (its source Find box, its Show more choices, its fixed value) keeps that row drawn and focused when a newer child draft pushes it off the page (finding 2)', async () => {
  const { app, insert } = await linkedSixty();
  const rowOn = id => new RegExp('<div class="field ob-link-row"[^>]*>(?:(?!<div class="field ob-link-row")[\\s\\S])*?(id|data-id)="' + id + '"').test(app.html());
  assert.ok(/id="find-ob-link-src-detail19"/.test(app.html()), 'set-up: the 20th row\'s source dropdown has Find');
  assert.ok(!/id="ob-link-src-detail20"/.test(app.html()), 'set-up: the 21st is past the page');
  app.doc.activeElement = app.node('#find-ob-link-src-detail19');
  await insert(1);
  assert.ok(rowOn('find-ob-link-src-detail19'), 'the row with the focused Find box stays drawn');
  assert.strictEqual(app.activeId(), 'find-ob-link-src-detail19', 'and focus stays on the box');
  app.doc.activeElement = app.node('[data-act="sel-more"][data-id="ob-link-src-detail19"]');
  assert.ok(app.doc.activeElement, 'set-up: its Show more choices');
  await insert(2);
  assert.ok(rowOn('ob-link-src-detail19'), 'the row with the focused Show more choices stays drawn');
  assert.strictEqual(app.activeId(), '[data-act="sel-more"][data-id="ob-link-src-detail19"]', 'and focus stays on that button');
  app.doc.activeElement = app.node('#ob-link-val-detail5');
  await app.fs.write('maps/drafts/kid60.md', app.fs.files['maps/drafts/kid60.md'].t.replace('context: ', 'context: ' + Array.from({ length: 20 }, (x, i) => 'zzz' + i).join(', ') + ', ')); await reread(app);
  assert.ok(/id="ob-link-val-detail5"/.test(app.html()), 'the row whose fixed value box has focus stays drawn');
  assert.strictEqual(app.activeId(), 'ob-link-val-detail5', 'and focus stays on the box');
});

run();
