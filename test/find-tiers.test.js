// Find things in big folders (2.11), code review round 12: K.list's three tiers (the page, pinned rows, ordinary kept rows)
// by property. A seeded random walk over K.roleRows (with Find) and K.list (a tail, without), with rows inserted, removed and
// reordered above, Find typed and cleared, Show more, focus moved, and text left pending in random rows.
'use strict';
const assert = require('assert');
const { rule, run, load } = require('./harness');

function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const SEED = +(process.env.TIERS_SEED || 1212);
const WALKS = +(process.env.TIERS_WALKS || 40), STEPS = +(process.env.TIERS_STEPS || 60);
const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const COLORS = ['red', 'blue', 'green', 'gold'];

/* One list, its rows and what the person is doing with them. */
function world(K, rand, w) {
  const pick = a => a[Math.floor(rand() * a.length)];
  const tail = rand() < 0.25, P = pick([10, 20]), id = 'tiers-' + w;
  let next = 0;
  const make = () => 'r' + (next++) + '-' + pick(COLORS);
  const roles = []; for (let i = 0, n = 25 + Math.floor(rand() * 100); i < n; i++) roles.push(make());
  const st = { more: {}, find: { q: {} } }, pinned = new Set(), soft = new Set();
  let focus = null, lost = 0;
  const sel = k => '[id="r-' + k + '"]';
  function draw() {
    K.focusAt = focus == null ? null : { away: () => false, near: s => s === sel(focus), inRow: s => s === sel(focus), lost: () => { lost++; } };
    let html, box = '';
    const row = r => '<i id="r-' + r + '"></i>';
    if (tail) html = K.list(st, id, roles, { page: P, tail: true, keyOf: r => r, focusOf: sel, keep: [...pinned], soft: [...soft], draw: shown => shown.map(row).join('') });
    else { const rr = K.roleRows(st, id, roles, { page: P, keep: [...pinned], soft: [...soft], focusOf: sel, row }); html = rr.rows; box = rr.box; }
    K.focusAt = null;
    const drawn = [...html.matchAll(/<i id="r-([^"]+)"><\/i>/g)].map(m => un(m[1]));
    const btn = /<button([^>]*data-act="more"[^>]*)>Show (\d+) (?:more|earlier)<\/button>/.exec(html);
    const step = btn && / data-step="(\d+)"/.exec(btn[1]), next = btn && / data-next="([^"]*)"/.exec(btn[1]);
    const count = /role="status">(?:(\d[\d,]*) of [\d,]+ match|No )/.exec(box);
    return { html, drawn, more: btn ? { step: step ? +step[1] : P, n: +btn[2], next: next && un(next[1]) } : null, announced: count ? (count[1] ? +count[1].replace(/,/g, '') : 0) : null };
  }
  return { tail, P, id, st, roles, pinned, soft, make, draw, pick, get focus() { return focus; }, set focus(k) { focus = k; }, get lost() { return lost; } };
}

/* Every invariant of one draw: d is the draw, before the one drawn just before it (or null), how, what was done. */
function check(W, d, before, how) {
  const fails = [], q = W.st.find.q[W.id] || '', n = Math.max(W.P, Math.floor(W.st.more[W.id] || W.P));
  const list = W.tail || !q ? W.roles : W.roles.filter(r => r.indexOf(q) >= 0);
  const drawn = new Set(d.drawn);
  if (drawn.size !== d.drawn.length) fails.push('a row drawn twice: ' + d.drawn.filter((k, i) => d.drawn.indexOf(k) !== i).join(', '));
  W.pinned.forEach(k => { if (W.roles.indexOf(k) >= 0 && !drawn.has(k)) fails.push('pinned ' + k + ' (text pending) not drawn'); });
  if (W.focus != null && W.roles.indexOf(W.focus) >= 0 && !drawn.has(W.focus)) fails.push('focused ' + W.focus + ' not drawn');
  /* The page: the first n of the list (the last n, for a tail), so with Find the matches come first. */
  const page = W.tail ? list.slice(Math.max(0, list.length - n)) : list.slice(0, n);
  page.forEach(k => { if (!drawn.has(k)) fails.push((q ? 'match ' : 'page row ') + k + ' not drawn (n ' + n + ')'); });
  if (!W.tail && q) {
    if (d.announced !== list.length) fails.push('announced ' + d.announced + ' matches, ' + list.length + ' match');
    const firstN = d.drawn.slice(0, page.length);
    if (firstN.join() !== page.join()) fails.push('the matches aren\'t drawn first: ' + firstN.slice(0, 5).join(', '));
    d.drawn.forEach(k => { if (k.indexOf(q) < 0 && !W.pinned.has(k) && k !== W.focus) fails.push('non-matching ' + k + ' drawn, neither pinned nor focused'); });
  }
  const pins = new Set([...W.pinned].filter(k => W.roles.indexOf(k) >= 0)); if (W.focus != null) pins.add(W.focus);
  if (drawn.size > page.length + pins.size + W.P) fails.push('drew ' + drawn.size + ', over the page ' + page.length + ' + pinned ' + pins.size + ' + a page of kept ' + W.P);
  /* Show more says how many it adds: exactly that many rows are new on the next draw. */
  if (before && before.more && how === 'more') {
    const added = d.drawn.filter(k => before.drawn.indexOf(k) < 0);
    if (added.length !== before.more.n) fails.push('Show ' + before.more.n + ' more added ' + added.length);
    if (before.more.next && !drawn.has(before.more.next)) fails.push('Show more\'s first row ' + before.more.next + ' not drawn');
  }
  return fails;
}

/* A walk of STEPS actions on one list. Returns its failures, each with the step it happened at. */
function walk(K, rand, w) {
  const W = world(K, rand, w), fails = [];
  let d = W.draw(), how = 'start';
  for (let s = 0; s < STEPS && !fails.length; s++) {
    const before = d, x = rand();
    if (x < 0.14) { how = 'find'; W.st.find.q[W.id] = W.tail ? '' : W.pick(['', '', 'red', 'blue', 'r1', 'r2', 'gold']); W.st.more[W.id] = 0; if (W.focus != null && !W.pinned.has(W.focus)) W.focus = null; }
    else if (x < 0.32) { how = 'more'; if (!d.more) continue; W.st.more[W.id] = Math.max(W.P, W.st.more[W.id] || W.P) + d.more.step; if (d.more.next) W.focus = d.more.next; }
    else if (x < 0.44) { how = 'focus'; W.focus = d.drawn.length ? W.pick(d.drawn) : null; }
    else if (x < 0.58) { how = 'type'; if (d.drawn.length) { const k = W.pick(d.drawn); W.pinned.add(k); W.focus = k; } }
    else if (x < 0.61) { how = 'fix'; for (let i = 0, m = 10 + Math.floor(rand() * 40); i < m; i++) W.pinned.add(W.pick(W.roles)); }
    else if (x < 0.64) { how = 'apply'; if (W.pinned.size) W.pinned.delete(W.pick([...W.pinned])); }
    else if (x < 0.74) { how = 'soft'; for (let i = 0, m = 1 + Math.floor(rand() * 30); i < m; i++) W.soft.add(W.pick(W.roles)); }
    else if (x < 0.86) { how = 'insert'; for (let i = 0, m = 1 + Math.floor(rand() * 4); i < m; i++) W.roles.splice(Math.floor(rand() * Math.min(W.roles.length, 30)), 0, W.make()); }
    else if (x < 0.93) { how = 'remove'; const k = W.pick(W.roles); W.roles.splice(W.roles.indexOf(k), 1); W.pinned.delete(k); W.soft.delete(k); if (W.focus === k) W.focus = null; }
    else { how = 'reorder'; const k = W.roles.splice(Math.floor(rand() * W.roles.length), 1)[0]; W.roles.splice(Math.floor(rand() * W.roles.length), 0, k); }
    d = W.draw();
    check(W, d, before, how).forEach(f => fails.push('walk ' + w + (W.tail ? ' (a tail)' : '') + ', page ' + W.P + ', step ' + s + ' (' + how + '): ' + f));
    /* Focus stays where it is only on a row still drawn. */
    if (W.focus != null && d.drawn.indexOf(W.focus) < 0) W.focus = null;
  }
  return fails;
}

rule('Round 12, by property: K.roleRows and K.list draw every pinned and focused row, the matches first with the count announced, no row twice, within a page, the pinned rows and a page of kept ones, and Show more adds what it says (seed ' + SEED + ')', () => {
  const PF = load(true), rand = prng(SEED), fails = [];
  for (let w = 0; w < WALKS; w++) fails.push(...walk(PF.vk, rand, w));
  assert.deepStrictEqual(fails.slice(0, 8), [], fails.length + ' failures; rerun with TIERS_SEED=' + SEED);
});

/* The round's first finding, as the walk would meet it, so a failure names it (findings 2 and 3 are app tests in
   find-process.test.js, on the builder's Who does it). */
rule('Round 12: 40 rows with a fixed value just chosen and text pending in the 40th stay drawn when a row is inserted above (finding 1)', () => {
  const K = load(true).vk, st = { more: {}, find: { q: {} } }, names = []; for (let i = 0; i < 300; i++) names.push('d' + String(i).padStart(3, '0'));
  const fixed = names.slice(0, 40), pin = fixed.concat(['d039']), row = r => '<i id="r-' + r + '"></i>', sel = r => '[id="r-' + r + '"]';
  const drawn = h => [...h.matchAll(/<i id="r-([^"]+)">/g)].map(m => m[1]);
  let h = K.roleRows(st, 'f1', names, { keep: pin, focusOf: sel, row }).rows;
  assert.ok(drawn(h).indexOf('d039') >= 0, 'set-up: d039 drawn');
  const more = ['new0'].concat(names);
  K.focusAt = { away: () => false, near: s => s === sel('d039'), inRow: s => s === sel('d039'), lost: () => { throw new Error('lost'); } };
  try { h = K.roleRows(st, 'f1', more, { keep: pin, focusOf: sel, row }).rows; } finally { K.focusAt = null; }
  fixed.forEach(n => assert.ok(drawn(h).indexOf(n) >= 0, n + ' (a fixed value just chosen) drawn'));
});
run();
