// Lightness: the examples can be finished, folded lists stay reachable, and each screen keeps to a budget of visible content.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const { load, example, exampleSetup, rule, run } = require('./harness');
const { boot } = require('./app-harness');
const PF = load(), R = PF.run, P = PF.publish;
const EX = exampleSetup(PF), people = JSON.parse(example('people.json'));
const NOW = '2026-10-21T15:00:00.000Z';
const MAPS = fs.readdirSync(path.join(__dirname, '..', 'example-folder', 'maps', 'drafts')).filter(f => /\.md$/.test(f)).map(f => f.replace(/\.md$/, ''));

/* ---------- Every example checklist can be completed the normal way ---------- */
function pub(id) {
  const b = P.build(example('maps/drafts/' + id + '.md'), { people, ...EX, by: 'person-avery', changes: 'First version', existing: [], now: NOW, rand: 'abcd1234' });
  assert.ok(!b.blockers, id + ': ' + (b.blockers || []).join(' | '));
  const v = P.verify(b.folder, b.files);
  assert.ok(v.ok, v.why);
  return v;
}
/* Done with sample values for what each step asks for; a step that runs another process through a real child run, played
   to completion the same way; every gate passed; ended as Completed. */
function complete(id, details, parent, trail) {
  const v = pub(id), meta = v.map.meta, roles = {};
  const full = {}; meta.context.forEach(k => { full[k] = (details || {})[k] || 'sample-' + k; });
  meta.roles.forEach(ro => { roles[ro] = 'person-casey'; });
  const r = R.create(v, { title: meta.title, details: full, roles, by: 'person-casey', session: 's1', now: NOW, workflows: EX.workflows, parent }), map = R.mapOf(r);
  map.phases.forEach((ph, pi) => {
    ph.steps.forEach(s => {
      const where = trail + ' › ' + s.id;
      if (s.type === 'run.process') {
        const f = R.fieldsOf(r, s), cv = pub(f.process), inputs = R.childDetails(r, s, cv.map.meta.context);
        const child = complete(f.process, inputs, { process: id, id: r.id, step: s.id, inputs }, where);
        R.linkChild(r, map, s.id, { process: child.process, id: child.id, inputs }, 'person-casey', NOW);
        assert.strictEqual(R.settleChild(r, map, s.id, child, 'person-casey', NOW), 'done', where + ': settled by its child run');
        return;
      }
      const values = {};
      R.evidenceFor(r, s).list.forEach(d => { if (d.required) values[d.name] = d.kind === 'url' ? 'https://example.com/' + d.name : d.kind === 'choice' ? d.options[0] : 'sample ' + d.name; });
      try { R.done(r, map, s.id, 'person-casey', NOW, values); } catch (e) { assert.fail(where + ': ' + e.message); }
    });
    R.pass(r, map, pi, 'person-casey', NOW);
  });
  R.end(r, map, 'Completed', 'person-casey', 'Casey Nguyen', NOW);
  assert.strictEqual(r.state, 'completed', trail);
  return r;
}

rule('Every example checklist, child runs included, can be completed: Done with what each step asks for, and every gate passed', () => {
  assert.ok(MAPS.length >= 7 && MAPS.indexOf('jira-cleanup') >= 0, 'all the examples: ' + MAPS.join(', '));
  MAPS.forEach(id => complete(id, null, undefined, id));
});

rule('Weekly Jira cleanup: the stale-issues step names its issue type and a status the example workflow has, so Done asks only for the Resolution', () => {
  const v = pub('jira-cleanup'), r = R.create(v, { title: 'Cleanup', details: { board: 'WEB' }, roles: { owner: 'person-morgan' }, by: 'person-morgan', session: 's1', now: NOW, workflows: EX.workflows }), map = R.mapOf(r);
  map.phases[0].steps.forEach(s => R.done(r, map, s.id, 'person-morgan', NOW, R.evidenceFor(r, s).list.reduce((o, d) => Object.assign(o, d.required ? { [d.name]: d.options ? d.options[0] : 'x' } : {}), {})));
  R.pass(r, map, 0, 'person-morgan', NOW);
  const stale = map.phases[1].steps.filter(s => s.id === 'stale')[0];
  assert.ok(stale && stale.must, 'still a must-do step');
  const asks = R.evidenceFor(r, stale).list.filter(d => d.required);
  assert.deepStrictEqual(asks.map(d => d.label), ['Resolution'], 'one box');
  assert.ok(asks[0].options.indexOf('Won\'t Do') >= 0, 'with Won\'t Do to choose');
  assert.throws(() => R.done(r, map, 'stale', 'person-morgan', NOW, {}), /Resolution/, 'the Resolution is still required');
  R.done(r, map, 'stale', 'person-morgan', NOW, { [asks[0].name]: 'Won\'t Do' });
  assert.strictEqual(r.steps.stale.s, 'done');
});

/* ---------- Visible content, counted the way the lightness audit counted it in a browser ---------- */
/* The main area only. Not counted: the bodies of closed <details> (their summary is), screen-reader-only text, hidden and
   aria-hidden content, and options that aren't selected. The harness has no layout, so CSS-only hiding still counts. */
const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/;
function visible(html) {
  const out = [], stack = [], re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>|([^<]+)/g;
  let hidden = 0, m;
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  const pop = () => { const t = stack.pop(); if (t.hide) hidden--; if (t.summaryOf && !t.summaryOf.hide) { t.summaryOf.hide = true; hidden++; } return t; };
  while ((m = re.exec(html))) {
    if (m[5] != null) { if (!hidden) out.push({ text: m[5] }); continue; }
    const tag = m[2].toLowerCase(), attrs = m[3] || '';
    if (m[1]) { if (stack.some(t => t.tag === tag)) while (stack.length && pop().tag !== tag); continue; }
    const cls = (/\sclass="([^"]*)"/.exec(attrs) || [])[1] || '';
    const hide = /\shidden(?=[\s=]|$)/.test(attrs) || /\saria-hidden="true"/.test(attrs) || /(^|\s)sr(\s|$)/.test(cls) ||
      /^(script|style|template)$/.test(tag) || (tag === 'option' && !/\sselected/.test(attrs)) || (tag === 'input' && /\stype="hidden"/.test(attrs));
    if (!hidden && !hide) out.push({ tag, attrs, cls });
    if (VOID.test(tag) || m[4]) continue;
    /* A box counts; what is typed in it isn't content. */
    const t = { tag, hide: hide || tag === 'textarea' };
    if (t.hide) hidden++;
    const up = stack[stack.length - 1];
    if (tag === 'summary' && up && up.closed) t.summaryOf = up;
    if (tag === 'details' && !/\sopen(?=[\s=]|$)/.test(attrs)) t.closed = true;
    stack.push(t);
  }
  return out;
}
function measure(html) {
  const v = visible(html), els = v.filter(x => x.tag);
  const text = v.filter(x => x.text).map(x => x.text.replace(/&[#\w]+;/g, m => m === '&nbsp;' ? ' ' : 'x')).join(' ');
  return {
    words: (text.match(/\S+/g) || []).filter(w => /[A-Za-z0-9]/.test(w)).length,
    buttons: els.filter(x => x.tag === 'button' || /\srole="button"/.test(x.attrs)).length,
    inputs: els.filter(x => x.tag === 'input' || x.tag === 'select' || x.tag === 'textarea').length,
    chips: els.filter(x => x.cls.split(/\s+/).some(c => /^(badge|pill|tag|chip|chipbtn)$|-(chip|tag)$/.test(c))).length
  };
}
const shown = (html, re) => re.test(visible(html).map(x => x.text ? x.text : '<' + x.tag + x.attrs + '>').join(''));

rule('The visible-content counter skips closed details bodies, screen-reader text, hidden and aria-hidden content', () => {
  const html = '<p>One two</p><details><summary>Three</summary><p>four five</p><button>Six</button></details><details open><summary>Seven</summary><button>Eight</button></details>' +
    '<textarea>typed words</textarea><details><summary>x</summary><textarea></textarea></details><span class="sr">nine</span><div hidden><button>ten</button></div><span aria-hidden="true">eleven</span><span class="badge">Twelve</span><select><option selected>Thirteen</option><option>no</option></select>';
  assert.deepStrictEqual(measure(html), { words: 8, buttons: 1, inputs: 2, chips: 1 });
});

/* Today's numbers are the budgets; a slice that lightens a screen lowers its budget (SHOW=1 prints what each screen has now).
   target is where the lightness plan aims. */
const BUDGETS = {
  home: { words: 139, buttons: 13, chips: 1, target: { words: 120 } },
  processes: { words: 95, buttons: 13, chips: 3, target: { chips: 8 } },
  /* The harness also counts the CSS-hidden phone picker and skip links, so its run and process numbers sit above the browser's. */
  'process page as a non-owner': { words: 268, buttons: 13, chips: 3, target: { words: 260, buttons: 16, chips: 12 } },
  'process page as its owner': { words: 415, buttons: 24, chips: 9, target: { words: 430 } },
  'run, just started': { words: 355, buttons: 39, chips: 5, target: { words: 300, buttons: 36, chips: 6 } },
  finish: { words: 48, buttons: 4, inputs: 0, target: { words: 70, inputs: 0 } },
  'new process': { words: 33, buttons: 6, inputs: 1, target: { inputs: 1 } },
  /* Raised by 3 on purpose: the builder banner now says the whole path (Save draft, then Done to publish). */
  'builder, a step selected': { words: 281, buttons: 35, target: { words: 350, buttons: 36 } },
  'folder health': { words: 135, buttons: 6, target: { words: 110 } },
  /* The same screens for a checklist with conditions (2.1), Release with one on a step and one on a phase: each condition is
     one muted line, and the builder's is one closed "Only when…" until it's used. The release builder without them is the
     baseline: a step with a condition adds its open box and hint, and the outline's two condition lines. */
  'builder, release, a step selected': { words: 467, buttons: 62, inputs: 10 },
  'process page with conditions, its owner': { words: 404, buttons: 24, chips: 9 },
  'process page with conditions, a non-owner': { words: 257, buttons: 13, chips: 3 },
  'run with conditions, just started': { words: 349, buttons: 37, chips: 5 },
  'builder with conditions, a step selected': { words: 487, buttons: 62, inputs: 11 },
  'builder, a step without conditions selected': { words: 477, buttons: 62, inputs: 10 }
};
async function screens() {
  const app = boot(), out = {}; await app.tick(60);
  const take = name => { out[name] = measure(app.html()); };
  app.choose('person-casey'); await app.tick();
  app.click('nav', 'home'); await app.tick(); take('home');
  app.click('nav', 'processes'); await app.tick(); take('processes');
  app.click('open-process', 'release'); await app.tick(); take('process page as its owner');
  app.choose('person-morgan'); await app.tick(); app.click('open-process', 'release'); await app.tick(); take('process page as a non-owner');
  app.choose('person-casey'); await app.tick();
  app.click('start', 'release'); await app.tick(); app.submitForm('start-form', {}); await app.tick(80); take('run, just started');
  app.click('pickup'); await app.tick(40); app.click('finish'); await app.tick(); take('finish');
  app.click('nav', 'settings'); await app.tick(); app.click('health'); await app.tick(200); take('folder health');
  app.click('nav', 'processes'); await app.tick(); app.click('new-process'); await app.tick(); take('new process');
  app.set('np-id', 'onboard'); app.set('np-title', 'Onboard a new hire'); app.submit('new-process-form'); await app.tick(150);
  app.click('ob-sel', 'first-step'); await app.tick(); take('builder, a step selected');
  await conditional(out);
  return out;
}
/* Release with a condition on a step and on a phase, published as its next version through the screens. */
async function conditional(out) {
  const app = boot(); await app.tick(60);
  const take = name => { out[name] = measure(app.html()); };
  app.choose('person-casey'); await app.tick();
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick(); take('builder, release, a step selected');
  app.click('ob-done'); await app.tick();
  const path = 'maps/drafts/release.md', md = app.fs.files[path].t;
  const cond = md.replace(/(\n- \[[ !~]\] [^\n]*\{#flags\}\n)/, '$1  only when ^environment is set\n').replace(/(\n## Verify in production[^\n]*\n)/, '$1  only when ^tag is set\n');
  assert.ok(cond !== md && (cond.match(/only when/g) || []).length === 2, 'set-up: two conditions');
  await app.fs.write(path, cond);
  app.click('refresh'); await app.tick(80);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  app.set('change-note', 'Conditions'); app.click('publish', 'release'); await app.tick(200);
  assert.ok(app.files('publications/release/').some(f => /map\.md$/.test(f) && /only when/.test(app.fs.files[f].t)), 'set-up: published with its conditions');
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  assert.ok(/class="pv-when"/.test(app.html()), 'set-up: the page shows them');
  take('process page with conditions, its owner');
  app.choose('person-morgan'); await app.tick(); app.click('open-process', 'release'); await app.tick(); take('process page with conditions, a non-owner');
  app.choose('person-casey'); await app.tick();
  app.click('start', 'release'); await app.tick(); app.submitForm('start-form', {}); await app.tick(80); take('run with conditions, just started');
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  assert.ok(/<details class="ob-when" data-disc="ob-when:flags" open>/.test(app.html()), 'set-up: its condition is open');
  take('builder with conditions, a step selected');
  app.click('ob-sel', 'rollback'); await app.tick();
  assert.ok(/<details class="ob-when" data-disc="ob-when:rollback"><summary>/.test(app.html()), 'set-up: closed');
  take('builder, a step without conditions selected');
}
rule('Each screen keeps to its budget of visible words, buttons, boxes and chips', async () => {
  const got = await screens(), over = [];
  if (process.env.SHOW) console.log(JSON.stringify(got, null, 1));
  Object.keys(BUDGETS).forEach(name => {
    assert.ok(got[name], 'measured: ' + name);
    Object.keys(BUDGETS[name]).filter(k => k !== 'target').forEach(k => { if (got[name][k] > BUDGETS[name][k]) over.push(name + ' ' + k + ' ' + got[name][k] + ' > ' + BUDGETS[name][k]); });
  });
  assert.deepStrictEqual(over, [], 'over budget');
});

/* ---------- Folder health: the passing checks fold into one line ---------- */
async function healthApp(conflict) {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  if (conflict) { const r = app.run(); await app.fs.write(r.path.replace('run.json', 'run.conflict-wx-1.json'), JSON.stringify(r.json)); }
  app.click('nav', 'settings'); await app.tick(); app.click('health'); await app.tick(200);
  return app;
}
rule('Folder health: the passing checks are one closed line with their count; Show opens the full list, and it stays open', async () => {
  const app = await healthApp(false), html = app.html();
  const m = /<details class="panel hz-sec" data-disc="hz-ok"><summary><h2 id="hz-ok">All clear · (\d+) checks passed<\/h2><\/summary><ul class="hz-clear">([\s\S]*?)<\/ul>/.exec(html);
  assert.ok(m, 'one closed line');
  const items = (m[2].match(/<li>/g) || []).length;
  assert.ok(items >= 10 && items === +m[1], 'the count is the list, and the list is all there: ' + items);
  assert.ok(!shown(html, /Nothing here was written by a newer Flightdeck/), 'folded');
  app.fire('toggle', { target: { dataset: { disc: 'hz-ok' }, open: true } }); app.click('health-again'); await app.tick(200);
  assert.ok(/<details class="panel hz-sec" data-disc="hz-ok" open>/.test(app.html()) && shown(app.html(), /Nothing here was written by a newer Flightdeck/), 'opened, and kept open across a redraw');
});

rule('Folder health: problems and things worth a look are never folded', async () => {
  const app = await healthApp(true), html = app.html();
  assert.ok(shown(html, /Needs action · 1/) && shown(html, /data-act="open-run"[^>]*>/) && shown(html, /Compare copies/), 'the problem and its button are on screen');
  assert.ok(/data-disc="hz-ok"><summary><h2 id="hz-ok">All clear · \d+ checks passed/.test(html), 'only the passing checks fold');
});

/* ---------- Builder: four parts, and the rest one click away ---------- */
async function builderApp() {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  return app;
}
const partsShown = html => [...visible(html.slice(html.indexOf('id="ob-plist'))).map(x => x.attrs || '').join(' ').matchAll(/data-act="ob-part" data-id="([^"]+)"/g)].map(m => m[1]);
rule('Builder parts: Phase, Gate, Step and Must-do, then All parts (N) holding every part', async () => {
  const app = await builderApp(), html = app.html();
  assert.deepStrictEqual(partsShown(html), ['phase', 'gate', 'step', 'must'], 'four parts on show');
  const all = [...html.slice(html.indexOf('id="ob-plist"'), html.indexOf('</aside>', html.indexOf('id="ob-plist"'))).matchAll(/data-act="ob-part" data-id="([^"]+)"/g)].map(m => m[1]);
  const n = (html.match(/All parts \((\d+)\)/) || [])[1];
  assert.ok(n && +n === new Set(all).size && all.indexOf('lanes') >= 0 && all.indexOf('process') >= 0 && all.indexOf('type:jenkins.job') >= 0 && all.indexOf('type:change.request') >= 0, 'every part is there: ' + n + ' / ' + all.length);
  assert.ok(/<details class="ob-all" data-disc="ob-all"><summary/.test(html), 'folded');
  app.fire('toggle', { target: { dataset: { disc: 'ob-all' }, open: true } }); app.click('ob-sel', 'flags'); await app.tick();
  assert.ok(partsShown(app.html()).length === +n, 'opened, and kept open across a redraw');
});

rule('Builder parts: a search shows every match, folded or not, and a folded part being placed shows itself', async () => {
  const app = await builderApp();
  app.input('ob-part-q', 'jenkins'); await app.tick();
  assert.ok(partsShown(app.html()).indexOf('type:jenkins.job') >= 0, 'found by search');
  app.input('ob-part-q', ''); await app.tick();
  app.click('ob-part', 'lanes'); await app.tick();
  assert.ok(partsShown(app.html()).indexOf('lanes') >= 0 && /data-id="lanes"[^>]*aria-pressed="true"/.test(app.html()), 'the part being placed is on show');
});

rule('Builder parts: the phone\'s Add a part sheet folds the same way', async () => {
  const app = await builderApp();
  app.click('ob-parts-open'); await app.tick();
  const o = app.overlay();
  assert.deepStrictEqual(partsShown(o), ['phase', 'gate', 'step', 'must']);
  assert.ok(/All parts \(\d+\)/.test(o));
});

/* ---------- New process: the ID pattern works in today's browsers ---------- */
rule('New process: the Process ID pattern compiles the way browsers compile pattern attributes (the v flag)', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('nav', 'processes'); await app.tick(); app.click('new-process'); await app.tick();
  const raw = (/id="np-id"[^>]*\spattern="([^"]*)"/.exec(app.html()) || /\spattern="([^"]*)"[^>]*id="np-id"/.exec(app.html()) || [])[1];
  assert.ok(raw, 'the box has a pattern');
  const pat = raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&'), re = new RegExp('^(?:' + pat + ')$', 'v');
  ['release', 'code-review', 'a1'].forEach(s => assert.ok(re.test(s), s));
  ['-release', 'Release', 'code review', ''].forEach(s => assert.ok(!re.test(s), s));
});

run();
