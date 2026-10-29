// Find things in big folders (2.11): the list helper, Show more's focus, natural sort and the person pickers.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { load, loadViews, rule, run } = require('./harness');
const { boot } = require('./app-harness');
const { fixture, into } = require('./bounds-fixture');

/* ---------- natural sort ---------- */
rule('Natural sort: 2 comes before 10, case doesn\'t matter, and names that look the same keep one fixed order', () => {
  const N = load().text.natural;
  assert.deepStrictEqual(['Process 10', 'process 2', 'Process 1'].sort(N), ['Process 1', 'process 2', 'Process 10']);
  assert.deepStrictEqual(['v10', 'v9', 'v100', 'v1'].sort(N), ['v1', 'v9', 'v10', 'v100']);
  assert.ok(N('apple', 'Banana') < 0 && N('Banana', 'apple') > 0, 'case-insensitive');
  assert.ok(N('Sam', 'sam') !== 0 && Math.sign(N('Sam', 'sam')) === -Math.sign(N('sam', 'Sam')), 'a tie is broken, the same way both ways round');
  assert.deepStrictEqual(['sam', 'Sam', 'SAM'].sort(N), ['SAM', 'Sam', 'sam']);
  assert.deepStrictEqual(['SAM', 'sam', 'Sam'].sort(N), ['SAM', 'Sam', 'sam'], 'whatever order they come in');
  assert.strictEqual(N('x', 'x'), 0);
  assert.ok(N(null, 'a') < 0 && N(undefined, '') === 0, 'no name sorts first');
});

rule('People by name: a sorted copy, natural, with ties broken by ID; people.json\'s order is left alone', () => {
  const PF = load(), list = [{ id: 'p-c', name: 'Sam 10' }, { id: 'p-b', name: 'sam 2' }, { id: 'p-z', name: 'Avery' }, { id: 'p-a', name: 'Avery' }];
  const before = JSON.stringify(list), out = PF.people.byName(list);
  assert.deepStrictEqual(out.map(p => p.id), ['p-a', 'p-z', 'p-b', 'p-c']);
  assert.strictEqual(JSON.stringify(list), before, 'not sorted in place');
  assert.deepStrictEqual(PF.people.sorted({ data: { people: list } }).map(p => p.id), ['p-a', 'p-z', 'p-b', 'p-c']);
  const memo = [{ id: 'm' }];
  assert.strictEqual(PF.people.sorted({ data: { people: list }, peopleSorted: () => memo }), memo, 'the screen\'s copy, made once per render');
  assert.strictEqual(PF.people.sorted(null).length, 0);
});

rule('Sorting is for the screen only: the CLI and the outside-app JSON never sort people', () => {
  const root = path.join(__dirname, '..');
  ['bin/flightdeck.js', 'src/core/appjson.js', 'src/core/people.js'].forEach(f => {
    const src = fs.readFileSync(path.join(root, f), 'utf8').replace(/function (byName|sorted)\([\s\S]*?\n  }\n/g, '');
    assert.ok(!/people\.(sorted|byName)\(|text\.natural/.test(src), f + ' sorts people');
  });
});

/* Every view that draws people from the folder either sorts them by name or is listed here with why it doesn't. */
const PEOPLE_UNSORTED = [
  [/labeler\(/, 'labels, not a list'],
  [/PP\.roles\(|PF\.people\.roles\(/, 'the owner and backup, not a list'],
  [/M\.check\(/, 'checking a draft, not drawing'],
  [/skills\.signer\(/, 'who may sign, not a list'],
  [/function personName\(/, 'one name looked up'],
  [/PF\.people\.sorted\(ctx\)/, 'sorted'],
  [/PP\.canManage\(|PP\.permits\(/, 'Settings › People: sorted and paged in slice 5'],
  [/PF\.teamValues/, 'Team values: who may edit them, not a list'],
];
rule('Every person list a view draws is sorted by name (an inventory of ctx.data.people in the views)', () => {
  const dir = path.join(__dirname, '..', 'src', 'ui', 'views'), bad = [], used = new Set();
  fs.readdirSync(dir).filter(f => /\.js$/.test(f)).forEach(f => {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      if (!/ctx\.data\.people/.test(line)) return;
      const ok = PEOPLE_UNSORTED.filter(([re]) => re.test(line));
      ok.forEach(([re]) => used.add(String(re)));
      if (!ok.length) bad.push(f + ':' + (i + 1) + ': ' + line.trim().slice(0, 140));
    });
  });
  assert.deepStrictEqual(bad, [], 'drawn from ctx.data.people without PF.people.sorted(ctx)');
  assert.deepStrictEqual(PEOPLE_UNSORTED.filter(([re]) => !used.has(String(re))).map(([, why]) => why), [], 'an exemption nothing needs any more');
});

/* ---------- K.list ---------- */
const K = loadViews().vk;
const items = n => Array.from({ length: n }, (x, i) => ({ k: 'row-' + i }));
const draw = shown => '<ul>' + shown.map(x => '<li id="' + x.k + '">' + x.k + '</li>').join('') + '</ul>';
const ids = h => (h.match(/<li id="([^"]+)"/g) || []).map(x => x.slice(8, -1));
const lo = o => Object.assign({ draw, keyOf: x => x.k }, o);

rule('K.list: the first 50, how many there are (announced), and Show more naming the first row it adds and what to focus', () => {
  const h = K.list({}, 'demo', items(120), lo({ focusOf: k => K.byId(k) + ' h3' }));
  assert.strictEqual(ids(h).length, 50);
  assert.ok(/<span class="small" role="status">Showing 50 of 120<\/span>/.test(h));
  assert.ok(/<button type="button" class="btn" data-act="more" data-id="demo" data-next="row-50" data-focus="\[id=&quot;row-50&quot;\] h3">Show 50 more<\/button>/.test(h), h.slice(-300));
  assert.strictEqual(ids(K.list({ more: { demo: 100 } }, 'demo', items(120), lo())).length, 100);
  const all = K.list({ more: { demo: 150 } }, 'demo', items(120), lo());
  assert.ok(ids(all).length === 120 && !/data-act="more"/.test(all) && !/Showing/.test(all), 'all shown: no line, no button');
  assert.ok(/>Show 20 more</.test(K.list({ more: { demo: 100 } }, 'demo', items(120), lo())), 'says how many when fewer than a page are left');
  assert.ok(!/data-act="more"/.test(K.list({}, 'demo', items(50), lo())), 'exactly a page: nothing to show more of');
});

rule('K.list: a kept row and the one just shown are drawn past the page, after it and labeled, and paged() draws as it did', () => {
  const st = { justShown: { gen: 1, lists: { demo: 'row-90' } } };
  const h = K.list(st, 'demo', items(120), lo({ keep: ['row-70', null] }));
  assert.deepStrictEqual(ids(h).slice(50), ['row-70', 'row-90']);
  assert.ok(/Showing 50 of 120, plus the one you just added/.test(h));
  assert.ok(h.indexOf('editing this one') > h.indexOf('data-act="more"'), 'the kept row comes after Show more, labeled');
  assert.ok(!/editing this one/.test(K.list(st, 'demo', items(120), lo())), 'only the just-shown one: no editing label');
  assert.deepStrictEqual(ids(K.list({ justShown: { lists: { demo: 'row-3' } } }, 'demo', items(120), lo())).length, 50, 'already on the page: drawn once');
  assert.strictEqual(K.paged({}, 'demo', items(120), draw, x => x.k), K.list({}, 'demo', items(120), lo()));
  const runs = K.paged({}, 'runs-ended', items(60), draw, x => x.k);
  assert.ok(/data-act="more" data-id="runs-ended" data-next="row-50">Show 10 more</.test(runs), 'no data-focus: the run card, as before');
});

rule('K.list: a tail shows the last ones with Show earlier above; a dialog\'s list and its own page size say so', () => {
  const h = K.list({}, 'thread', items(45), lo({ tail: true, page: 20 }));
  assert.deepStrictEqual(ids(h), items(45).slice(25).map(x => x.k));
  assert.ok(h.indexOf('data-act="more"') < h.indexOf('<li'), 'above the rows');
  assert.ok(/data-next="row-5" data-page="20">Show 20 earlier</.test(h), h.slice(0, 300));
  assert.deepStrictEqual(ids(K.list({ more: { thread: 40 } }, 'thread', items(45), lo({ tail: true, page: 20 }))), items(45).slice(5).map(x => x.k));
  assert.ok(/data-dialog="1"/.test(K.list({}, 'hist', items(60), lo({ inDialog: true }))));
  const kept = K.list({}, 'thread', items(45), lo({ tail: true, page: 20, keep: ['row-2'] }));
  assert.ok(ids(kept)[0] === 'row-2' && kept.indexOf('data-act="more"') < kept.indexOf('id="row-2"'), 'a kept row of a tail comes before the page');
});

rule('K.list: Show more counts past kept rows: it adds a page of rows not drawn yet and focuses the first of them; so does Show earlier', () => {
  const o = lo({ page: 20, keep: ['row-20'], focusOf: k => K.byId(k) });
  let h = K.list({}, 'demo', items(120), o);
  assert.deepStrictEqual(ids(h), items(21).map(x => x.k), 'the page and the kept row 20');
  assert.ok(/data-next="row-21" data-focus="\[id=&quot;row-21&quot;\]" data-page="20" data-step="21">Show 20 more</.test(h), h.slice(-400));
  h = K.list({ more: { demo: 20 + 21 } }, 'demo', items(120), o);
  assert.deepStrictEqual(ids(h), items(41).map(x => x.k), '20 added, each drawn once');
  assert.ok(!/data-act="more"/.test(K.list({}, 'demo', items(22), lo({ page: 20, keep: ['row-20', 'row-21'] }))), 'every row left is kept: nothing to show more of');
  assert.ok(/data-next="row-22"[^>]*data-step="3">Show 1 more</.test(K.list({}, 'demo', items(23), lo({ page: 20, keep: ['row-20', 'row-21'] }))), 'fewer than a page left after the kept ones');
  const t = lo({ tail: true, page: 20, keep: ['row-24'] });
  h = K.list({}, 'thread', items(45), t);
  assert.ok(/data-next="row-4" data-page="20" data-step="21">Show 20 earlier</.test(h), h.slice(0, 400));
  h = K.list({ more: { thread: 41 } }, 'thread', items(45), t);
  assert.deepStrictEqual(ids(h), items(45).slice(4).map(x => x.k), 'Show earlier adds 20 above, each drawn once');
});

rule('K.list: PF.vk.PAGE_OFF turns paging off for the one list it names, so the bounds test can prove it notices', () => {
  try {
    K.PAGE_OFF = 'demo';
    assert.strictEqual(ids(K.list({}, 'demo', items(120), lo())).length, 120);
    assert.strictEqual(ids(K.list({}, 'other', items(120), lo())).length, 50);
  } finally { K.PAGE_OFF = null; }
});

rule('K.byId: a selector for any id a file can hold', () => {
  assert.strictEqual(K.byId('a"b\\c'), '[id="a\\"b\\\\c"]');
});

/* ---------- Show more in the app, on the big folder ---------- */
let big = null;
async function bigApp() {
  if (big) return big;
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fixture());
  return (big = app);
}
const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function moreOf(html, id) {
  const m = new RegExp('<button[^>]*data-act="more" data-id="' + id + '"([^>]*)>').exec(html); if (!m) return null;
  const d = {}; m[1].replace(/data-([\w-]+)="([^"]*)"/g, (x, k, v) => { d[k] = un(v); return x; }); return d;
}
async function insights(app, proc) {
  app.click('nav', 'processes'); await app.tick(5);
  app.click('open-process', proc); await app.tick(10);
  app.click('ptab', 'insights'); await app.tick(20);
}
const rowsOf = (h, re) => (h.match(re) || []).length;

rule('Show more on How runs go\'s duration table moves focus to the first added row\'s link, which is drawn', async () => {
  const app = await bigApp(); await insights(app, 'versions');
  app.fire('toggle', { target: { dataset: { disc: 'ins-dur-table' }, open: true } }); app.click('dismiss'); await app.tick(5);
  const rows = () => rowsOf(app.html(), /<tr id="ins-row-/g);
  assert.strictEqual(rows(), 50, 'set-up: a page drawn');
  const d = moreOf(app.html(), 'ins-dur');
  assert.ok(d && d.focus === '[id="' + d.next + '-go"]', 'Show more names the row\'s link: ' + JSON.stringify(d));
  app.click('more', 'ins-dur', d); await app.tick(5);
  assert.strictEqual(rows(), 100);
  const want = app.node(d.focus);
  assert.ok(want && want.tagName === 'BUTTON', 'the first added row is drawn, with its link');
  assert.strictEqual(app.activeId(), d.next + '-go', 'focus moved to the link, by its own id');
  assert.ok(want.contains(app.node(d.focus)) && app.node('[id="' + d.next + '"]').contains(app.node(d.focus)), 'inside the first added row');
});

rule('Show more on Steps that go off-script moves focus to the first added step\'s heading', async () => {
  const app = await bigApp(); await insights(app, 'steps');
  const rows = () => rowsOf(app.html(), /<li class="ins-step"/g);
  assert.strictEqual(rows(), 50, 'set-up: a page of the 120 steps drawn');
  const d = moreOf(app.html(), 'ins-hot');
  assert.ok(d && d.focus === '[id="' + d.next + '-h"]', JSON.stringify(d));
  app.click('more', 'ins-hot', d); await app.tick(5);
  assert.strictEqual(rows(), 100);
  const h3 = app.node(d.focus);
  assert.ok(h3 && h3.tagName === 'H3' && h3.getAttribute('tabindex') === '-1', 'a focusable heading');
  assert.ok(app.node('[id="' + d.next + '"]').contains(h3));
  assert.ok(/<li class="ins-step" id="[^"]+"><h3 id="[^"]+-h" tabindex="-1">/.test(app.html()));
});

rule('Choosing another version on How runs go starts both of its lists again from their first page', async () => {
  const app = await bigApp(), dur = () => rowsOf(app.html(), /<tr id="ins-row-/g), hot = () => rowsOf(app.html(), /<li class="ins-step"/g);
  const other = () => { const opts = /<select id="ins-folder"[^>]*>([\s\S]*?)<\/select>/.exec(app.html())[1], cur = /<option value="([^"]*)" selected/.exec(opts)[1];
    return [cur, (opts.match(/<option value="([^"]*)"/g) || []).map(x => x.slice(15, -1)).filter(v => v !== cur)[0]]; };
  const away = async () => { const [cur, o] = other(); app.select('ins-folder', o); await app.tick(10); app.select('ins-folder', cur); await app.tick(10); };
  await insights(app, 'steps');
  app.click('more', 'ins-hot', moreOf(app.html(), 'ins-hot')); await app.tick(5);
  assert.strictEqual(hot(), 100, 'set-up');
  await away();
  assert.strictEqual(hot(), 50, 'Steps that go off-script: back to the first page');
  await insights(app, 'versions');
  app.fire('toggle', { target: { dataset: { disc: 'ins-dur-table' }, open: true } }); app.click('dismiss'); await app.tick(5);
  app.click('more', 'ins-dur', moreOf(app.html(), 'ins-dur')); await app.tick(5);
  assert.strictEqual(dur(), 100, 'set-up');
  await away();
  assert.strictEqual(dur(), 50, 'the duration table: back to the first page');
});

rule('Every person picker on the big folder lists its 500 scrambled people in name order, and people.json keeps its own order', async () => {
  const app = await bigApp(), N = load().text.natural, file = app.fs.files['people.json'].t, people = JSON.parse(file);
  const byId = Object.fromEntries((people.people || people).map(p => [p.id, p.name]));
  assert.ok((people.people || people).some((p, i, a) => i && N(a[i - 1].name, p.name) > 0), 'set-up: the file is scrambled');
  const seen = new Set();
  const look = () => {
    const h = app.html() + app.top() + app.overlay(), re = /<select id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g; let m;
    while ((m = re.exec(h))) {
      const v = (m[2].match(/<option value="([^"]*)"/g) || []).map(x => x.slice(15, -1)).filter(x => byId[x] !== undefined);
      if (v.length < 2) continue;
      seen.add(m[1].replace(/\d+$/, ''));
      v.forEach((x, i) => assert.ok(!i || N(byId[v[i - 1]], byId[x]) <= 0, m[1] + ' isn\'t in name order at ' + byId[x]));
    }
  };
  app.click('nav', 'home'); await app.tick(5); look();
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'tiny'); await app.tick(10); app.click('start', 'tiny'); await app.tick(10); look();
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'tiny'); await app.tick(10); app.click('plan-run', 'tiny'); await app.tick(10); look();
  app.click('nav', 'processes'); await app.tick(5); app.click('new-process'); await app.tick(10); look();
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', fixture().facts.busy); await app.tick(10); app.click('takeover'); await app.tick(40); app.click('pick', 'recorder', { kind: 'handoff' }); await app.tick(10); look();
  app.click('unpick'); await app.tick(5); app.click('run-details'); await app.tick(10); app.click('edit', 'role:lead'); await app.tick(10); look();
  ['me', 'role-lead', 'np-owner', 'handoff-to', 'edit-input'].forEach(id => assert.ok(seen.has(id), id + ' was checked: ' + [...seen].join(', ')));
  assert.strictEqual(app.fs.files['people.json'].t, file, 'people.json is untouched');
});

/* ---------- slice 2: Checklists, Skills and tags ---------- */
rule('K.treeList: the page is the first 50 in the tree\'s own order, groups by name, and each group counts every item, saying how many are shown', () => {
  const its = [];
  for (let i = 0; i < 40; i++) its.push({ k: 'b' + i, g: ['Group 10'] });
  for (let i = 0; i < 30; i++) its.push({ k: 'a' + i, g: ['Group 2'] });
  its.push({ k: 'loose', g: [] });
  const row = x => '<li id="' + x.k + '">' + x.k + '</li>', o = { keyOf: x => x.k, focusOf: k => K.byId(k) };
  const h = K.treeList({}, 'tr', its, x => x.g, row, o);
  assert.deepStrictEqual(ids(h), its.slice(40, 70).map(x => x.k).concat(its.slice(0, 20).map(x => x.k)), 'Group 2 before Group 10, then the rest');
  assert.ok(/<span class="t">Group 2<\/span> <span class="small">30<\/span>/.test(h), 'a group drawn whole: its count');
  assert.ok(/<span class="t">Group 10<\/span> <span class="small">40 · 20 shown<\/span>/.test(h), 'a group split by the page: "40 · 20 shown"');
  assert.ok(/data-act="more" data-id="tr" data-next="b20" data-focus="\[id=&quot;b20&quot;\]">Show 21 more/.test(h), h.slice(-300));
  const all = K.treeList({ more: { tr: 100 } }, 'tr', its, x => x.g, row, o);
  assert.strictEqual(ids(all).length, 71);
  assert.ok(/Group 10<\/span> <span class="small">40<\/span>/.test(all));
  const one = K.treeList({}, 'tr', Array.from({ length: 1000 }, (x, i) => ({ k: 'p' + i, g: ['G ' + i] })), x => x.g, row, o);
  assert.strictEqual(ids(one).length, 50, '1,000 groups of one still draw 50 rows');
  assert.strictEqual((one.match(/class="tgroup"/g) || []).length, 50, 'and only their groups');
  assert.strictEqual(K.tree(its, x => x.g, row), K.treeList({ more: { tr: 100 } }, 'tr', its, x => x.g, row, o), 'K.tree draws the same whole tree');
});

rule('K.findBox: drawn from state through esc(), safe to leave, with its count; finds matches every term in any case', () => {
  const st = { find: { gen: 0, q: { processes: '"><b>x' } } };
  const h = K.findBox(st, 'processes', 'Find a checklist', 0, 9, 'checklist');
  assert.ok(/<label for="find-processes">Find a checklist<\/label><input type="search" id="find-processes" data-find="processes" data-nav-safe data-bound value="&quot;&gt;&lt;b&gt;x" autocomplete="off"/.test(h), h);
  assert.ok(/aria-describedby="find-processes-n"/.test(h) && /id="find-processes-n" role="status">No checklist matches "&quot;&gt;&lt;b&gt;x"</.test(h));
  assert.ok(/data-act="find-clear" data-id="processes">Clear</.test(h));
  assert.ok(/role="status">12 of 1,000 match</.test(K.findBox({ find: { q: { processes: 'a' } } }, 'processes', 'Find a checklist', 12, 1000, 'checklist')));
  const empty = K.findBox({}, 'processes', 'Find a checklist', 9, 9, 'checklist');
  assert.ok(/value=""/.test(empty) && !/find-clear/.test(empty) && /role="status"><\/span>/.test(empty));
  const f = K.finds('  deploy  PROD ');
  assert.ok(f(['Deploy to prod']) && f(['deploy', 'tag-prod']) && !f(['Deploy']) && K.finds('')(['x']));
});

const big2 = async () => { const app = await bigApp(); app.click('nav', 'processes'); await app.tick(5); return app; };
const procRows = h => (h.match(/<li><button data-act="open-process"/g) || []).length;
const typeFind = async (app, id, v) => { app.set('find-' + id, v); app.input('find-' + id, v); await app.tick(5); };
/* The harness doesn't redraw a data-bound box from its markup as a page does (syncBound): after the app clears it, the box is
   made to hold what was drawn, so the next key sees what a person would. The drawn value is what's checked. */
const drawnBox = (app, id) => { const v = (new RegExp('<input type="search" id="find-' + id + '"[^>]*value="([^"]*)"').exec(app.html()) || [])[1]; app.set('find-' + id, v == null ? '' : un(v)); return v; };

rule('Checklists on the big folder: 50 checklist rows across 1,000 groups, 5 skill chips a row and "+N more skills", 50 tags, chosen ones always', async () => {
  const app = await big2(), h = app.html();
  assert.strictEqual(procRows(h), 50);
  assert.ok((h.match(/class="tgroup"/g) || []).length <= 50, 'only the groups of the rows drawn');
  assert.ok(/<span class="t">Busy<\/span> <span class="small">13<\/span>/.test(h), 'Busy counts its 13');
  assert.ok(h.indexOf('>Group 2<') < h.indexOf('>Group 10<'), 'groups in natural order');
  const steps = h.slice(h.indexOf('data-id="steps"'), h.indexOf('</li>', h.indexOf('data-id="steps"')));
  assert.strictEqual((steps.match(/class="skillchip"/g) || []).length, 5);
  assert.ok(/\+596 more skills/.test(steps), steps.slice(-200));
  assert.strictEqual((h.match(/<button class="tag[ "]/g) || []).length, 50);
  const tagIds = (h.match(/<button class="tag[^"]*" data-act="tag" data-id="[^"]*"/g) || []).map(x => /data-id="([^"]*)"/.exec(x)[1]);
  assert.deepStrictEqual(tagIds, tagIds.slice().sort(load().text.natural), 'by name');
  assert.ok(/Filter by tag \(\d+\)/.test(h) && /data-act="more" data-id="tags"/.test(h), 'the first 50, then Show more');
  app.click('tag', 'tag-300'); await app.tick(5);
  const t = app.html();
  assert.strictEqual((t.match(/<button class="tag[ "]/g) || []).length, 51, 'a chosen tag past the page is drawn too');
  assert.ok(/class="tag on" data-act="tag" data-id="tag-300"/.test(t) && /data-act="tag" data-id="">Clear/.test(t));
  assert.strictEqual(procRows(t), 2, 'tag-300: processes 300 and 700');
  app.click('tag', ''); await app.tick(5);
  const d = moreOf(app.html(), 'tags');
  app.click('more', 'tags', d); await app.tick(5);
  assert.strictEqual((app.html().match(/<button class="tag[ "]/g) || []).length, 100);
  assert.strictEqual(app.activeId(), '[data-act="tag"][data-id="' + d.next + '"]', 'Show more focuses the first tag it adds');
});

rule('Checklists: Show more focuses the first checklist it adds, in its group, and the tree grows by 50', async () => {
  const app = await big2(), d = moreOf(app.html(), 'processes');
  assert.ok(d && d.focus === '#procs-all [data-act="open-process"][data-id="' + d.next + '"]', JSON.stringify(d));
  app.click('more', 'processes', d); await app.tick(5);
  assert.strictEqual(procRows(app.html()), 100);
  assert.strictEqual(app.activeId(), '[data-act="open-process"][data-id="' + d.next + '"]');
});

rule('Checklists: Find narrows the list over every checklist, the count says so, and Find and the tag filter combine', async () => {
  const app = await big2();
  await typeFind(app, 'processes', 'process 777');
  let h = app.html();
  assert.strictEqual(procRows(h), 1);
  assert.ok(/data-id="proc-0777"/.test(h) && /role="status">1 of 1,020 match</.test(h), h.slice(h.indexOf('findbox'), h.indexOf('findbox') + 600));
  await typeFind(app, 'processes', 'TAG-007');
  assert.strictEqual(procRows(app.html()), 3, 'tags are words too: 7, 407 and 807');
  await typeFind(app, 'processes', 'busy');
  assert.strictEqual(procRows(app.html()), 13, 'and groups');
  await typeFind(app, 'processes', 'process 7');
  assert.ok(/role="status">\d+ of 1,020 match</.test(app.html()) && procRows(app.html()) === 50, 'many matches: paged');
  app.click('tag', 'tag-007'); await app.tick(5);
  h = app.html();
  assert.strictEqual(procRows(h), 3, 'with tag-007 chosen: 7, 407 and 807 match both');
  assert.ok(/role="status">3 of 3 match</.test(h), 'counted within the tag filter');
  await typeFind(app, 'processes', 'process 407');
  assert.strictEqual(procRows(app.html()), 1);
  app.click('tag', ''); await app.tick(5);
  await typeFind(app, 'processes', 'deploy nowhere');
  h = app.html();
  assert.strictEqual(procRows(h), 0);
  assert.ok(/No checklist matches "deploy nowhere"/.test(h) && /data-act="find-clear" data-id="processes"/.test(h));
  app.click('find-clear', 'processes'); await app.tick(5);
});

rule('Checklists: the box shows what\'s kept after Clear, after Escape and after coming back by Back, with the results and focus to match', async () => {
  const app = await big2(), val = () => drawnBox(app, 'processes');
  await typeFind(app, 'processes', 'process 777');
  app.click('find-clear', 'processes'); await app.tick(5);
  assert.strictEqual(val(), '', 'Clear: the box is empty');
  assert.strictEqual(procRows(app.html()), 50, 'Clear: every checklist again');
  assert.strictEqual(app.activeId(), 'find-processes', 'Clear: focus in the box');
  await typeFind(app, 'processes', 'process 777');
  let prevented = false, stopped = false;
  app.el('find-processes').tagName = 'INPUT'; app.el('find-processes').type = 'search';
  app.keyOn('Escape', { preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }, app.el('find-processes')); await app.tick(5);
  assert.strictEqual(val(), '', 'Escape: the box is empty');
  assert.strictEqual(procRows(app.html()), 50, 'Escape: every checklist again');
  assert.strictEqual(app.activeId(), 'find-processes', 'Escape: focus stays in the box');
  assert.ok(prevented && stopped, 'Escape is the box\'s own');
  app.keyOn('Escape', {}, app.el('find-processes')); await app.tick(5);
  assert.ok(/id="find-processes"/.test(app.html()), 'an empty box lets Escape do what it did, which on Checklists is nothing');
  await typeFind(app, 'processes', 'process 777');
  app.click('open-process', 'proc-0777'); await app.tick(10);
  assert.ok(!/id="find-processes"/.test(app.html()), 'set-up: on the checklist');
  app.back(); await app.settle();
  assert.strictEqual(val(), 'process 777', 'Back: the box shows the filter');
  assert.strictEqual(procRows(app.html()), 1, 'Back: and its results');
  assert.notStrictEqual(app.activeId(), 'find-processes', 'Back focuses what Back focuses, not the box');
  app.click('nav', 'home'); await app.tick(5); app.click('nav', 'processes'); await app.tick(5);
  assert.strictEqual(val(), 'process 777', 'coming back by the top bar keeps it too');
  app.click('find-clear', 'processes'); await app.tick(5);
});

rule('Checklists: a non-empty Escape in the Find box doesn\'t also close or leave anything', async () => {
  const app = boot({ domFocus: true }); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  app.click('nav', 'processes'); await app.tick(5);
  app.click('search'); await app.tick(10);
  assert.ok(app.overlay(), 'set-up: a dialog open');
  app.set('find-processes', 'code'); app.input('find-processes', 'code'); await app.tick(5);
  app.el('find-processes').tagName = 'INPUT'; app.el('find-processes').type = 'search';
  app.keyOn('Escape', {}, app.el('find-processes')); await app.tick(5);
  assert.ok(app.overlay(), 'the dialog is still open');
  assert.strictEqual(drawnBox(app, 'processes'), '', 'only the box was cleared');
  app.keyOn('Escape', {}, app.el('find-processes')); await app.tick(5);
  assert.ok(!app.overlay(), 'then, empty, Escape closes the dialog as before');
});

rule('Checklists: Find belongs to its folder: a folder switch, and back, starts it empty, without a change to useFs', async () => {
  const app = boot({ domFocus: true }); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  app.click('nav', 'processes'); await app.tick(5);
  app.set('find-processes', 'sprint'); app.input('find-processes', 'sprint'); await app.tick(5);
  assert.ok(/id="find-processes"[^>]*value="sprint"/.test(app.html()), 'set-up');
  app.click('reset-examples'); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'processes'); await app.tick(5);
  assert.ok(/id="find-processes"[^>]*value=""/.test(app.html()), 'another folder: empty');
  assert.ok(!/No checklist matches/.test(app.html()));
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8'), at = src.indexOf('function useFs(');
  assert.ok(at > 0 && !/state\.find\b/.test(src.slice(at, src.indexOf('\n  function ', at + 10))), 'useFs doesn\'t touch state.find');
});

rule('Checklists: with the folder\'s last tag chosen, a newer read that removes it still shows the tag, chosen, with Clear', async () => {
  const app = boot({ domFocus: true }); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  const md = '---\nprocess: lonely\ntitle: Lonely checklist\ncategory: Other\ntags: lonely-tag\nowner: person-casey\nroles: lead\n---\n\n## One · READ-DO {#ph1}\n- [ ] {confirm} Do it @lead {#s0}\n';
  await app.fs.write('maps/drafts/lonely.md', md);
  app.click('refresh'); await app.tick(60);
  app.click('nav', 'processes'); await app.tick(5);
  app.click('tag', 'lonely-tag'); await app.tick(5);
  assert.ok(/data-id="lonely"/.test(app.html()), 'set-up: the checklist with the tag');
  await app.fs.remove('maps/drafts/lonely.md');
  app.click('refresh'); await app.tick(60);
  const h = app.html();
  assert.ok(!/data-act="open-process" data-id="lonely"/.test(h), 'set-up: it\'s gone');
  assert.ok(/class="tag on" data-act="tag" data-id="lonely-tag" aria-pressed="true"/.test(h), 'the tag is still drawn, chosen');
  assert.ok(/data-act="tag" data-id="">Clear/.test(h), 'with Clear');
});

rule('Checklists: a go() to a checklist bypasses the list, whatever it shows', async () => {
  const app = await big2();
  await typeFind(app, 'processes', 'nothing matches this');
  app.click('go', null, { view: 'process', process: 'proc-0900' }); await app.tick(10);
  assert.ok(/Process 900/.test(app.html()) && /id="page-h"/.test(app.html()), 'checklist 900 opened');
  app.click('nav', 'processes'); await app.tick(5);
  app.click('find-clear', 'processes'); await app.tick(5);
});

rule('Skills on the big folder: All skills draws 50 across its tree, with Find a skill; Needs an update and Ready to become a skill page at 50', async () => {
  const app = await bigApp(); app.click('nav', 'skills'); await app.tick(10);
  const h = app.html(), all = h.slice(h.indexOf('id="all-h"'));
  assert.strictEqual((all.match(/<li><button id="sk-(?:all|att)-[^"]*" data-act="open-skill"/g) || []).length, 50);
  assert.ok(/data-act="more" data-id="skills"/.test(all) && /id="find-skills"/.test(all) && /Find a skill/.test(all));
  await typeFind(app, 'skills', 'step-skill-12');
  let a = app.html().slice(app.html().indexOf('id="all-h"'));
  assert.strictEqual((a.match(/<li><button id="sk-(?:all|att)-[^"]*" data-act="open-skill"/g) || []).length, 10, 'step-skill-120 to 129');
  assert.ok(/role="status">10 of [\d,]+ match</.test(a));
  await typeFind(app, 'skills', 'skilltag-7 four hundred');
  a = app.html().slice(app.html().indexOf('id="all-h"'));
  assert.ok(/role="status">\d+ of [\d,]+ match</.test(a) && (a.match(/<li><button id="sk-(?:all|att)-[^"]*" data-act="open-skill"/g) || []).length > 0, 'by tag and checklist');
  app.click('find-clear', 'skills'); await app.tick(5);
  const PF = loadViews(), V = PF.views, mk = (i, s) => ({ skill: { name: 'sk ' + i, file: 'sk' + i + '.json', group: [], tags: [], implements: 1 }, status: { s, text: '' } });
  const procs = [{ id: 'p', title: 'P', group: [], category: 'C', latest: { info: { version: 1 } }, skills: Array.from({ length: 120 }, (x, i) => mk(i, 'update')) }];
  for (let i = 0; i < 120; i++) procs.push({ id: 'q' + i, title: 'Q ' + i, group: [], category: 'C', latest: { info: { version: 1, folder: 'v1' } }, skills: [] });
  PF.skills.signoffs = () => [{}];
  const ctx = { state: { tags: [] }, data: { validations: [], people: [], failed: {} }, processes: () => procs, peopleById: {}, run: () => null, now: () => Date.now() };
  const sp = V.skillsPage(ctx), att = sp.slice(sp.indexOf('id="att-h"'), sp.indexOf('id="rdy-h"')), rdy = sp.slice(sp.indexOf('id="rdy-h"'), sp.indexOf('id="all-h"'));
  assert.ok(/Needs an update · 120/.test(att) && (att.match(/<li><button id="sk-(?:all|att)-[^"]*" data-act="open-skill"/g) || []).length === 50 && /data-act="more" data-id="sk-att"/.test(att), 'Needs an update: 50 of 120');
  assert.ok(/Ready to become a skill · 120/.test(rdy) && (rdy.match(/<li>/g) || []).length === 50 && /data-act="more" data-id="sk-ready"/.test(rdy), 'Ready to become a skill: 50 of 120');
});

rule('A checklist\'s Skills panel draws 50 of its 601 skills, with Show more focusing the first added', async () => {
  const app = await bigApp(); app.click('nav', 'processes'); await app.tick(5);
  app.click('open-process', 'steps'); await app.tick(10);
  const h = app.html(), panel = h.slice(h.indexOf('id="sk-h"'));
  assert.strictEqual((panel.match(/<li><button data-act="open-skill"/g) || []).length, 50);
  const d = moreOf(panel, 'p-skills');
  /* Keyed by its file, never its place (2.11): the 51st skill's own registration. */
  const files = [...h.matchAll(/data-act="open-skill" data-id="([^"]+)"/g)].map(m => m[1]);
  assert.ok(d && d.focus === '[data-act="open-skill"][data-id="' + d.next + '"]' && files.indexOf(d.next) < 0 && /\.json$/.test(d.next), JSON.stringify(d));
  app.click('more', 'p-skills', d); await app.tick(5);
  const p2 = app.html().slice(app.html().indexOf('id="sk-h"'));
  assert.strictEqual((p2.match(/<li><button data-act="open-skill"/g) || []).length, 100);
  assert.strictEqual(app.activeId(), d.focus, 'the 51st skill\'s button');
});

rule('A skill page with 400 changes draws 50 in order, Show more focuses the first added change, and the update brief has all 400', async () => {
  const app = await bigApp(); app.click('nav', 'skills'); await app.tick(5);
  app.click('open-skill', 'old-whole-skill.json'); await app.tick(10);
  /* Each change's id is from the change (what changed, and its step), never its place (2.11). */
  const ch = () => { const h = app.html(), a = h.indexOf('<ul class="changes">'); return a < 0 ? [] : [...h.slice(a, h.indexOf('</ul>', a)).matchAll(/<li id="(skc-[0-9a-f]{16})"/g)].map(m => m[1]); };
  const first = ch();
  assert.strictEqual(new Set(first).size, 50, 'the first 50, each with an id of its own');
  const d = moreOf(app.html(), 'sk-changes');
  assert.ok(d && first.indexOf(d.next) < 0 && d.focus === '[id="' + d.next + '"]', JSON.stringify(d));
  app.click('more', 'sk-changes', d); await app.tick(5);
  const all = ch();
  assert.strictEqual(all.length, 100);
  assert.deepStrictEqual(all.slice(0, 50), first, 'in order: the first 50 stay first');
  assert.strictEqual(all[50], d.next, 'the 51st is the one Show more named');
  assert.strictEqual(app.activeId(), d.next);
  assert.ok(new RegExp('<li id="' + d.next + '" tabindex="-1">').test(app.html()), 'a focusable change');
  /* The harness has no clipboard or selection: the brief is drawn before copying falls back to selecting it. */
  try { app.click('copy-brief', 'update:old-whole-skill.json'); } catch (e) { if (!/createRange/.test(e.message)) throw e; }
  await app.tick(5);
  const brief = /<pre id="brief-pre"[^>]*>([\s\S]*?)<\/pre>/.exec(app.html())[1];
  assert.ok((brief.match(/\(v2\)/g) || []).length >= 400, 'the brief names every changed step');
});

/* ---------- code review round 4: the focused row stays drawn ---------- */
rule('K.list: the row with focus stays drawn when an item sorting in above pushes it off the page, once, with the count and Show more still right; gone, its list says so', () => {
  const PF = loadViews(), K = PF.vk, st = { more: {} };
  const keys = n => Array.from({ length: n }, (x, i) => 'item' + String(i).padStart(3, '0'));
  const o = { keyOf: k => k, focusOf: k => K.byId('row-' + k), draw: shown => '<ul>' + shown.map(k => '<li id="row-' + k + '" tabindex="-1">' + k + '</li>').join('') + '</ul>' };
  const drawn = h => [...h.matchAll(/<li id="row-([^"]+)"/g)].map(m => m[1]);
  let items = keys(60);
  assert.strictEqual(drawn(K.list(st, 'L', items, o)).length, 50, 'set-up: a page');
  const focused = 'item049', lost = [];
  K.focusAt = { away: () => false, inRow: sel => sel === K.byId('row-' + focused), lost: id => lost.push(id) };
  try {
    /* Inserted above: the focused row is 51st now, and kept. */
    items = ['aaa'].concat(items);
    let h = K.list(st, 'L', items, o), d = drawn(h);
    assert.strictEqual(d.length, 51, 'the page and the one row: ' + d.length);
    assert.ok(d.indexOf(focused) >= 0 && d.filter(k => k === focused).length === 1, 'the focused row, once');
    assert.ok(/Showing 50 of 61, plus the one you(&#39;|')re on/.test(h), 'the count says so: ' + (/Showing[^<]*/.exec(h) || [''])[0]);
    assert.ok(/data-act="more" data-id="L" data-next="item050"/.test(h) && /Show 10 more/.test(h), 'Show more adds the 10 not drawn, from the first of them');
    assert.ok(!/kept-h/.test(h), 'no "you\'re editing" line for a row that only has focus');
    /* Redrawn again with focus still there: still drawn. Focus gone: let go. */
    assert.ok(drawn(K.list(st, 'L', items, o)).indexOf(focused) >= 0, 'still kept on the next redraw');
    K.focusAt = null;
    assert.ok(drawn(K.list(st, 'L', items, o)).indexOf(focused) < 0, 'let go once focus has left it');
    /* Reordered: the focused row moved past the page by a sort. */
    drawn(K.list(st, 'L', keys(60), o));
    K.focusAt = { away: () => false, inRow: sel => sel === K.byId('row-' + focused), lost: id => lost.push(id) };
    assert.ok(drawn(K.list(st, 'L', keys(60).filter(k => k !== focused).concat([focused]), o)).indexOf(focused) >= 0, 'reordered past the page: kept');
    /* Deleted: the item is gone, so nothing is kept and the list says it lost its focused row. */
    drawn(K.list(st, 'L', keys(60), o));
    h = K.list(st, 'L', keys(60).filter(k => k !== focused), o);
    assert.strictEqual(drawn(h).length, 50, 'deleted: just the page');
    assert.deepStrictEqual(lost, ['L'], 'its heading takes focus (app.js)');
    /* Only this list: another list drawing the same keys doesn't keep it. */
    drawn(K.list(st, 'M', keys(60), o));
    K.focusAt = { away: () => true, inRow: () => true, lost: id => lost.push(id) };
    assert.ok(drawn(K.list(st, 'M', ['aaa'].concat(keys(60)), o)).indexOf(focused) < 0, 'focus outside the list keeps nothing');
    /* A list holding its rows itself (hold: false) isn't touched. */
    K.focusAt = { away: () => false, inRow: () => true, lost: id => lost.push(id) };
    drawn(K.list(st, 'N', keys(60), Object.assign({ hold: false }, o)));
    assert.strictEqual(drawn(K.list(st, 'N', ['aaa'].concat(keys(60)), Object.assign({ hold: false }, o))).length, 50);
  } finally { K.focusAt = null; }
});

async function arriveRead(app) {
  const was = app.PF.perf.n['load.done'] || 0;
  app.focus();
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(5);
}
rule('Checklists: with 1,000, the last row drawn keeps focus and stays drawn when a checklist sorting first arrives, is deleted, or moves', async () => {
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fixture());
  app.click('nav', 'processes'); await app.tick(10);
  const rows = h => { const a = h.indexOf('id="procs-all"'); return [...h.slice(a).matchAll(/<li><button data-act="open-process" data-id="([^"]+)"/g)].map(m => m[1]); };
  const r0 = rows(app.html()), last = r0[r0.length - 1], sel = '#procs-all [data-act="open-process"][data-id="' + last + '"]';
  assert.strictEqual(r0.length, 50, 'set-up: a page');
  app.node(sel).focus();
  const on = what => {
    const r = rows(app.html());
    assert.ok(r.indexOf(last) >= 0 && r.filter(x => x === last).length === 1, what + ': still drawn, once');
    assert.ok(r.length <= 51, what + ': one past the page at most: ' + r.length);
    assert.strictEqual(app.activeId(), '[data-act="open-process"][data-id="' + last + '"]', what + ': still focused');
  };
  const draft = (id, group) => '---\nprocess: ' + id + '\ntitle: ' + id + '\ncategory: Synthetic\ngroup: ' + group + '\nowner: person-avery\n---\n\n## Only · READ-DO {#only}\n- [ ] {confirm} Do it {#a}\n';
  /* Inserted: a draft in a group that sorts first. */
  await app.fs.write('maps/drafts/arrived-first.md', draft('arrived-first', 'Aardvark')); await arriveRead(app);
  assert.ok(rows(app.html())[0] === 'arrived-first', 'set-up: it sorts first');
  on('a checklist inserted above');
  /* Moved: it moves to a group that sorts last; then deleted. */
  await app.fs.write('maps/drafts/arrived-first.md', draft('arrived-first', 'Zebra')); await arriveRead(app);
  on('a checklist above it moved below');
  await app.fs.write('maps/drafts/arrived-second.md', draft('arrived-second', 'Aardvark')); await arriveRead(app);
  await app.fs.remove('maps/drafts/arrived-first.md'); await arriveRead(app);
  on('a checklist deleted');
  await app.fs.remove('maps/drafts/arrived-second.md'); await arriveRead(app);
  assert.strictEqual(rows(app.html()).length, 50, 'back on the page, nothing kept past it');
  assert.strictEqual(app.activeId(), '[data-act="open-process"][data-id="' + last + '"]');
});

run();
