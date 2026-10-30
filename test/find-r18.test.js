// Find things in big folders (2.11), code review round 18: a thread note's row id names its step and its note so no other
// step's note can share it (step s0-a's note b and step s0's note a-b), and a list Find empties under a background read still
// sends focus on its row to the list's heading, never to the page.
'use strict';
const assert = require('assert');
const { rule, run, loadViews } = require('./harness');
const { small, fresh, more, arrive, iso } = require('./find-twins.test');

const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const liText = (h, id) => { const i = h.indexOf('<li id="' + id + '"'); return i < 0 ? '' : h.slice(i, h.indexOf('</li>', i)); };
const typeFind = async (app, id, v) => { app.set('find-' + id, v); app.input('find-' + id, v); await app.tick(5); };
/* Focus is on the element sel finds on the page as drawn now: connected, not a node a redraw replaced. */
function focusedOn(app, sel, what) {
  const n = app.node(sel), a = app.doc.activeElement;
  assert.ok(n, what + ': ' + sel + ' is drawn');
  assert.ok(a === n, what + ': focus is on ' + sel + ', as drawn now (it is on ' + app.activeId() + (a && a !== n && a.id === n.id ? ', a node no longer on the page' : '') + ')');
}

/* ---------- 1. a thread note's row id ---------- */
const MINE = 'tn-s0-a-b';
/* The landed run: an older note b on step s0-a, then note a-b on step s0, the one this test is on. */
async function twoSteps() {
  const app = await fresh(), key = small().facts.landed, dir = 'runs/' + key + '/';
  const rj = JSON.parse(app.fs.files[dir + 'run.json'].t), t0 = Date.parse(rj.created);
  const other = { id: 'b', at: iso(t0 + 30000), by: 'person-casey', session: 'r18', step: 's0-a', text: 'Note b on step s0-a' };
  const mine = { id: 'a-b', at: iso(t0 + 60000), by: 'person-blake', session: 'r18', step: 's0', text: 'Note a-b on step s0' };
  await arrive(app, [[dir + 'notes-r18.jsonl', [other, mine]]]);
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', key); await app.tick(10);
  app.click('select', 's0'); await app.tick(10);
  assert.ok(liText(app.html(), MINE).indexOf('Note a-b on step s0') >= 0, 'set-up: note a-b is drawn in step s0\'s thread');
  app.node('[id="' + MINE + '"]').focus(); await app.tick(5);
  assert.strictEqual(app.activeId(), MINE, 'set-up: focused');
  return { app, key, dir, t0, other, mine };
}

rule('Round 18: step s0-a\'s note b and step s0\'s note a-b have row ids of their own', () => {
  const PF = loadViews(), V = PF.views;
  assert.notStrictEqual(V.noteDomId('s0-a', 'b'), V.noteDomId('s0', 'a-b'));
  assert.strictEqual(V.noteDomId('s0', 'a-b'), 'tn-s0-a-b', 'a step id with no - or \\ is as before');
  /* Every pair of a few awkward step ids and note keys: no two give one row id. */
  const steps = ['s0', 's0-a', 's0-a-b', 's0\\', 's0\\-a', '-', ''], keys = ['b', 'a-b', '-b', 'b-', '\\-b', '', 'a\\#2', 'a#2'], seen = new Map();
  for (const s of steps) for (const k of keys) {
    const id = V.noteDomId(s, k), was = seen.get(id);
    assert.ok(!was, 'step ' + JSON.stringify(s) + ' note ' + JSON.stringify(k) + ' and step ' + JSON.stringify(was && was[0]) + ' note ' + JSON.stringify(was && was[1]) + ' share ' + id);
    seen.set(id, [s, k]);
  }
});

rule('Round 18: note a-b on step s0 focused, 25 newer notes on s0: it stays drawn, under From earlier, and focused; note b on step s0-a doesn\'t take its place', async () => {
  const { app, dir, t0 } = await twoSteps();
  await arrive(app, [[dir + 'notes-more.jsonl', Array.from({ length: 25 }, (x, i) => ({ id: 'r18n' + i, at: iso(t0 + 900000 + i * 1000), by: 'person-casey', session: 'more', step: 's0', text: 'Newer on s0 ' + i }))]]);
  const h = app.html();
  assert.ok(liText(h, MINE).indexOf('Note a-b on step s0') >= 0, 'note a-b is still drawn, as itself');
  assert.ok(/<p class="small kept-h">From earlier<\/p>/.test(h), 'under From earlier');
  focusedOn(app, '[id="' + MINE + '"]', 'note a-b');
});

rule('Round 18: note a-b on step s0 focused, note b on step s0-a deleted elsewhere: focus stays on note a-b, never the inspector\'s heading', async () => {
  const { app, dir, mine } = await twoSteps();
  await arrive(app, [[dir + 'notes-r18.jsonl', [mine]]]);
  assert.ok(liText(app.html(), MINE).indexOf('Note a-b on step s0') >= 0, 'note a-b is still drawn');
  focusedOn(app, '[id="' + MINE + '"]', 'note a-b');
});

/* ---------- 2. Find matching nothing after a background read ---------- */
const PEOPLE = 'people.json';
const named = (app, word) => {
  const base = JSON.parse(app.fs.files[PEOPLE].t).filter(p => !/^person-x\d+$/.test(p.id));
  return base.concat(Array.from({ length: 70 }, (x, i) => ({ id: 'person-x' + (i + 1), name: word + ' ' + String(i + 1).padStart(2, '0') })));
};
const writeJson = async (app, p, o) => { await app.fs.write(p, JSON.stringify(o, null, 2) + '\n'); };
/* A minute passes and the app's own beat rereads the folder, focus left where it is. */
async function beat(app) {
  const was = app.PF.perf.n['load.done'] || 0;
  app.clock.skip += 61000; app.every(); await app.tick(20); app.every();
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(5);
}

rule('Round 18: Settings › People, Find "alpha" over 70 Alphas, Show more, focus on Alpha 60; a background read renames them all Beta: focus goes to People\'s heading, on the page', async () => {
  const app = await fresh();
  await writeJson(app, PEOPLE, named(app, 'Alpha')); await beat(app);
  app.click('nav', 'settings'); await app.tick(5);
  await typeFind(app, 'people', 'alpha');
  assert.ok(/50 of \d+ match|70 of \d+ match/.test(app.html()), 'set-up: 70 people match');
  await more(app, 'people');
  assert.ok(app.node('[id="pp-person-x60"]'), 'set-up: Alpha 60, past the first page, is drawn');
  app.node('[id="pp-person-x60"]').focus(); await app.tick(5);
  assert.strictEqual(app.activeId(), 'pp-person-x60', 'set-up: focused');
  await writeJson(app, PEOPLE, named(app, 'Beta')); await beat(app);
  const h = app.html();
  assert.ok(!/id="pp-person-x60"/.test(h), 'Alpha 60, now Beta 60, no longer matches and isn\'t drawn');
  assert.ok(/value="alpha"/.test(h), 'the Find text stays');
  focusedOn(app, '#set-people', 'People\'s heading');
});

/* A follow-up's text on the Follow-ups page: its span's id, as drawn, and its key (process/run/id) from the folder. */
function fuText(app, text) {
  const m = new RegExp('<span class="fu-text" id="([^"]+)" tabindex="-1">' + text + '<').exec(app.html());
  if (!m) return null;
  for (const p of Object.keys(app.fs.files).filter(f => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(f))) {
    const rj = JSON.parse(app.fs.files[p].t), f = (rj.followUps || []).find(x => x.text === text);
    if (f) return { id: un(m[1]), path: p, fid: f.id };
  }
  return null;
}

rule('Round 18: Follow-ups, Find matching one follow-up, focus on it; a background read changes its text so nothing matches: focus goes to the list\'s heading, on the page', async () => {
  const app = await fresh();
  /* One follow-up whose text no other follow-up, run or person shares. */
  const path = Object.keys(app.fs.files).filter(f => /^runs\/versions\/[^/]+\/run\.json$/.test(f)).find(f => (JSON.parse(app.fs.files[f].t).followUps || []).length);
  const set = async text => { const rj = JSON.parse(app.fs.files[path].t); rj.followUps[0].text = text; await writeJson(app, path, rj); await beat(app); };
  await set('Quokka');
  app.click('nav', 'followups'); await app.tick(10);
  await typeFind(app, 'fu', 'quokka');
  assert.ok(/1 of \d+ match/.test(app.html()), 'set-up: one follow-up matches');
  const t = fuText(app, 'Quokka');
  assert.ok(t, 'set-up: it is drawn');
  app.node('[id="' + t.id + '"]').focus(); await app.tick(5);
  assert.strictEqual(app.activeId(), t.id, 'set-up: focused');
  await set('Wombat');
  const h = app.html();
  assert.ok(h.indexOf('id="' + t.id + '"') < 0 && /fu-list-h/.test(h), 'it no longer matches and isn\'t drawn');
  focusedOn(app, '#fu-list-h', 'the list\'s heading');
});

/* ---------- 3. ids that join ids ---------- */
const dupIds = h => { const n = new Map(); for (const m of h.matchAll(/\sid="([^"]*)"/g)) n.set(un(m[1]), (n.get(un(m[1])) || 0) + 1); return [...n].filter(x => x[1] > 1).map(x => x[0]); };

rule('Round 18: follow-ups f1 and f1-t in one run: every id on the Follow-ups page is its own, and Show more\'s focus finds f1-t\'s text', async () => {
  const app = await fresh();
  const path = Object.keys(app.fs.files).filter(f => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(f)).find(f => (JSON.parse(app.fs.files[f].t).followUps || []).length);
  const rj = JSON.parse(app.fs.files[path].t), f0 = rj.followUps[0];
  rj.followUps.push(Object.assign({}, f0, { id: f0.id + '-t', text: 'The one whose id ends in -t' }));
  await writeJson(app, path, rj); await beat(app);
  app.click('nav', 'followups'); await app.tick(10); app.click('fu-filter', 'all'); await app.tick(10);
  const h = app.html(), sec = h.slice(h.indexOf('id="fu-list-h"'));
  assert.ok(sec.indexOf('The one whose id ends in -t') >= 0, 'set-up: both are drawn');
  assert.deepStrictEqual(dupIds(h), [], 'no id is drawn twice');
  const t = fuText(app, 'The one whose id ends in -t');
  assert.ok(app.node('[id="' + t.id + '"]') && /fu-text/.test(app.node('[id="' + t.id + '"]').getAttribute('class')), 'its text is found by its own id');
});

rule('Round 18: How runs go on a checklist with phases h, a and a-lab and steps hot, x and x-h: every id is its own, and each list\'s focus finds its own row', () => {
  const H = require('./harness'), PF = loadViews(), R = PF.run, P = PF.publish, V = PF.views, EX = H.exampleSetup(PF);
  const people = JSON.parse(H.example('people.json')), NOW = '2026-10-17T21:00:00.000Z';
  const md = '---\nprocess: idx\ntitle: Ids\ncategory: Synthetic\nowner: person-avery\nroles: lead\n---\n\n' +
    '## Phase H · READ-DO {#h}\n- [ ] {confirm} The hot step @lead {#hot}\n- [ ] {confirm} Step x @lead {#x}\n\n' +
    '## Phase A · READ-DO {#a}\n- [ ] {confirm} Step x-h @lead {#x-h}\n\n## Phase A lab · READ-DO {#a-lab}\n- [ ] {confirm} The last step @lead {#last}\n';
  const b = P.build(md, Object.assign({ people, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'idx00001' }, EX));
  assert.ok(!b.blockers, 'set-up: ' + (b.blockers || []).join('; '));
  const pub = P.verify(b.folder, b.files, H.exactOf(PF, b.files));
  const runs = Array.from({ length: 6 }, (x, i) => {
    const r = R.create(pub, { title: 'Run ' + i, roles: { lead: 'person-casey' }, by: 'person-casey', session: 'me', now: NOW, id: 'idx' + i });
    H.completeRun(PF, r, NOW);
    ['hot', 'x', 'x-h'].forEach(s => R.differently(r, R.mapOf(r), s, 'Another way', 'person-casey', NOW));
    r._notes = []; r._conflicts = []; r._fileHash = 'h' + i;
    return r;
  });
  const state = { view: 'process', ptab: 'insights', processId: 'idx', me: 'person-casey', unfold: {}, disc: {}, more: {}, fs: { kind: 'memory', name: 'x' } };
  const ctx = {
    state, canFolder: true, data: { people, validations: [], processes: [{ process: 'idx', pubs: [pub], index: { latest: pub } }], runs, plans: [], drafts: [], skills: [], legacy: [], readAt: NOW },
    now: () => Date.parse(NOW), peopleById: Object.fromEntries(people.map(p => [p.id, p])), run: () => null, attachments: () => [],
    processTitle: id => id, processes: () => [], findRun: k => runs.find(r => r.process + '/' + r.id === k) || null, latestPub: () => pub, suggestRole: () => null, localCopy: () => null,
    followUps: () => [], corrections: () => [], img: () => ''
  };
  const p = { id: 'idx', title: 'Ids', category: 'Synthetic', latest: pub, all: [pub], clashes: [], broken: [], skills: [], draft: null, draftChanged: false };
  PF.vk.TRACE = [];
  const h = V.insightsPage(ctx, p), trace = PF.vk.TRACE; PF.vk.TRACE = null;
  assert.ok(/id="ins-hot-h"/.test(h) && /id="ins-ph-h"/.test(h) && /The hot step/.test(h), 'set-up: both lists are drawn');
  assert.deepStrictEqual(dupIds(h), [], 'no id is drawn twice');
  for (const id of ['ins-hot', 'ins-ph', 'ins-dur']) {
    const l = trace.find(x => x.id === id);
    assert.ok(l && l.page.length, 'set-up: ' + id + ' is drawn');
    l.page.forEach(k => {
      const sel = l.focusOf(k), m = /^\[id="((?:[^"\\]|\\.)*)"\]$/.exec(sel), want = m && m[1].replace(/\\(.)/g, '$1');
      assert.ok(want && (h.match(new RegExp('\\sid="' + want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g')) || []).length === 1, id + ': ' + k + '\'s focus (' + sel + ') finds exactly one element');
    });
  }
});

run();
