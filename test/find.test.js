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
  assert.ok(/<button class="btn" data-act="more" data-id="demo" data-next="row-50" data-focus="\[id=&quot;row-50&quot;\] h3">Show 50 more<\/button>/.test(h), h.slice(-300));
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
  assert.ok(d && d.focus === '[id="' + d.next + '"] button', 'Show more names the row\'s link: ' + JSON.stringify(d));
  app.click('more', 'ins-dur', d); await app.tick(5);
  assert.strictEqual(rows(), 100);
  const want = app.node(d.focus);
  assert.ok(want && want.tagName === 'BUTTON', 'the first added row is drawn, with its link');
  assert.strictEqual(app.activeId(), '[data-act="go"]', 'focus moved to a link');
  assert.ok(want.contains(app.node(d.focus)) && app.node('[id="' + d.next + '"]').contains(app.node(d.focus)), 'inside the first added row');
});

rule('Show more on Steps that go off-script moves focus to the first added step\'s heading', async () => {
  const app = await bigApp(); await insights(app, 'steps');
  const rows = () => rowsOf(app.html(), /<li class="ins-step"/g);
  assert.strictEqual(rows(), 50, 'set-up: a page of the 120 steps drawn');
  const d = moreOf(app.html(), 'ins-hot');
  assert.ok(d && d.focus === '[id="' + d.next + '"] h3', JSON.stringify(d));
  app.click('more', 'ins-hot', d); await app.tick(5);
  assert.strictEqual(rows(), 100);
  const h3 = app.node(d.focus);
  assert.ok(h3 && h3.tagName === 'H3' && h3.getAttribute('tabindex') === '-1', 'a focusable heading');
  assert.ok(app.node('[id="' + d.next + '"]').contains(h3));
  assert.ok(/<li class="ins-step" id="[^"]+"><h3 tabindex="-1">/.test(app.html()));
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

run();
