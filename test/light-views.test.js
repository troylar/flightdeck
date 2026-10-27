// Lightness, parts 2 and 3: the process page folds the owner's panels for everyone else, Home lists only what's yours, the top
// bar keeps four sections, and Publish never publishes a draft other than the one the person sees. Then the run says each thing
// once, plain words on screen (stored values unchanged), a flatter Processes list, New process asks for a title, Fill in opens
// itself when a check needs a value, and Finish, Runs, Step types and Settings show only what has something in it.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const { rule, run } = require('./harness');
const { boot, folderHandle, memoryIDB } = require('./app-harness');

/* Text a person can see: closed <details> bodies (not their summary), hidden and aria-hidden content and screen-reader-only
   text are left out, as the lightness audit counted. */
function visible(html) {
  const out = [], stack = [], re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>|([^<]+)/g, VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/;
  let hidden = 0, m;
  const pop = () => { const t = stack.pop(); if (t.hide) hidden--; if (t.summaryOf && !t.summaryOf.hide) { t.summaryOf.hide = true; hidden++; } return t; };
  while ((m = re.exec(html))) {
    if (m[5] != null) { if (!hidden) out.push(m[5]); continue; }
    const tag = m[2].toLowerCase(), attrs = m[3] || '';
    if (m[1]) { if (stack.some(t => t.tag === tag)) while (stack.length && pop().tag !== tag); continue; }
    const cls = (/\sclass="([^"]*)"/.exec(attrs) || [])[1] || '';
    const hide = /\shidden(?=[\s=]|$)/.test(attrs) || /\saria-hidden="true"/.test(attrs) || /(^|\s)sr(\s|$)/.test(cls) || /^(script|style|template)$/.test(tag);
    if (!hidden && !hide) out.push('<' + tag + attrs + '>');
    if (VOID.test(tag) || m[4]) continue;
    const t = { tag, hide };
    if (hide) hidden++;
    const up = stack[stack.length - 1];
    if (tag === 'summary' && up && up.closed) t.summaryOf = up;
    if (tag === 'details' && !/\sopen(?=[\s=]|$)/.test(attrs)) t.closed = true;
    stack.push(t);
  }
  return out.join('');
}
const shown = (html, re) => re.test(visible(html));
const inHtml = (html, re) => re.test(html);
const folded = (html, disc) => new RegExp('<details class="panel fold" data-disc="' + disc.replace(/[.:]/g, '\\$&') + '"><summary>').test(html);
const opened = (html, disc) => new RegExp('<details class="panel fold" data-disc="' + disc.replace(/[.:]/g, '\\$&') + '" open><summary>').test(html);
const openFold = async (app, disc) => { app.fire('toggle', { target: { dataset: { disc }, open: true } }); app.click('corr-filter', 'open'); await app.tick(); };

async function releaseAs(who) {
  const app = boot(); await app.tick(60);
  app.choose(who); await app.tick();
  app.click('open-process', 'release'); await app.tick();
  return app;
}

/* ---------- Process page: the owner's panels fold for everyone else ---------- */
rule('Process page, not its owner: Corrections and Skills are one closed line each, with what they hold in the line', async () => {
  const app = await releaseAs('person-morgan'), html = app.html();
  assert.ok(folded(html, 'fx:release'), 'corrections folded');
  assert.ok(/<summary><h2 id="fx-h" tabindex="-1">[\s\S]{0,400}?Corrections · \d+ open<\/h2>[\s\S]{0,80}?Review[\s\S]{0,40}?<\/summary>/.test(html), 'one line: Corrections · N open, Review');
  assert.ok(!shown(html, /Copy correction brief/) && !shown(html, /data-act="corr-review"/) && inHtml(html, /data-act="corr-review"/), 'its body is on the page, closed');
  assert.ok(folded(html, 'sk:release'), 'skills folded');
  assert.ok(/<summary><h2 id="sk-h">[\s\S]{0,300}?Skills · 2 · 2 need attention<\/h2><\/summary>/.test(html), 'one line with the count and what needs an update');
  assert.ok(!shown(html, /Ready for a skill\?/) && inHtml(html, /Ready for a skill\?/) && !shown(html, /needs update/), 'readiness and the list are inside it');
  assert.ok(html.indexOf('data-disc="sk:release"') > html.indexOf('id="pr-h"'), 'at the bottom of the side column');
});

rule('Process page, not its owner: each fold opens in place and stays open across redraws', async () => {
  const app = await releaseAs('person-morgan');
  await openFold(app, 'fx:release');
  assert.ok(opened(app.html(), 'fx:release') && shown(app.html(), /data-act="corr-review"/) && shown(app.html(), /Copy correction brief/), 'corrections open, with every action');
  await openFold(app, 'sk:release');
  assert.ok(opened(app.html(), 'sk:release') && shown(app.html(), /Ready for a skill\?/) && shown(app.html(), /data-act="open-skill"/), 'skills open, with each skill');
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  assert.ok(opened(app.html(), 'fx:release') && opened(app.html(), 'sk:release'), 'remembered');
});

rule('Process page, its owner and its backup owner: Corrections, Ready for a skill? and Skills are open panels, as before', async () => {
  for (const who of ['person-casey', 'person-avery']) {
    const app = await releaseAs(who), html = app.html();
    assert.ok(!/data-disc="(fx|sk):release"/.test(html), who + ': nothing folded');
    assert.ok(/<section class="panel" aria-labelledby="fx-h"><h2 id="fx-h" tabindex="-1">[\s\S]*?Corrections · \d+ open/.test(html) && shown(html, /Copy correction brief/), who + ': corrections open');
    assert.ok(/<section class="panel" aria-labelledby="rd-h">/.test(html) && /<section class="panel" aria-labelledby="sk-h">/.test(html) && shown(html, /needs update/), who + ': readiness and skills open');
  }
});

rule('Process page: View change from Home opens the corrections, even for someone who doesn\'t own the checklist', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-morgan'); await app.tick(); app.click('nav', 'home'); await app.tick(20);
  const key = (/data-act="ack-view" data-id="([^"]+)" data-process="release"/.exec(app.html()) || [])[1];
  assert.ok(key, 'Morgan has a correction on Home');
  app.click('ack-view', key, { process: 'release' }); await app.tick(20);
  assert.ok(opened(app.html(), 'fx:release') && shown(app.html(), /Declined/), 'open on her corrections');
  assert.strictEqual(app.focused(), 'fx-h');
});

rule('Process page: a warning in Corrections is never folded', async () => {
  const app = await releaseAs('person-morgan');
  const dec = app.files('corrections/release/').filter(f => /\.json$/.test(f))[0];
  assert.ok(dec, 'the examples have a decision file');
  await app.fs.write(dec, '{ not json');
  app.click('refresh'); await app.tick(120);
  const html = app.html();
  assert.ok(shown(html, /Couldn.t read 1 decision file/), 'the warning is on screen');
  assert.ok(!/data-disc="fx:release"/.test(html) && /<section class="panel" aria-labelledby="fx-h">/.test(html), 'the panel is drawn open');
});

rule('Process page: one version line with the rest folded, three recent runs with a way to all of them, and a short header', async () => {
  const app = await releaseAs('person-casey'), html = app.html();
  const ver = html.slice(html.indexOf('id="ver-h"'), html.indexOf('id="pr-h"'));
  assert.ok(/<details data-disc="vers:release"><summary class="small">All versions \(2\)<\/summary>/.test(ver), 'earlier versions folded');
  assert.strictEqual((visible(ver).match(/data-act="view-version"/g) || []).length, 1, 'one version on show');
  assert.ok(/data-act="view-version" data-id="v1-/.test(ver), 'the earlier one is still there');
  const v1 = /data-act="view-version" data-id="(v1-[^"]+)"/.exec(ver)[1];
  app.click('view-version', v1); await app.tick();
  assert.ok(/<details data-disc="vers:release" open>/.test(app.html()), 'viewing an earlier version opens the fold');
  const runs = html.slice(html.indexOf('id="pr-h"'));
  const n = (runs.match(/data-act="open-run"/g) || []).length;
  assert.ok(n <= 3, 'three runs at most: ' + n);
  const all = /data-act="runs-of" data-id="release">All (\d+) runs of this checklist<\/button>/.exec(runs);
  assert.ok(all && +all[1] > 3, 'a way to the rest');
  assert.ok(/<div class="small">v2 · published [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} by [A-Z][a-z]+ [A-Z][a-z]+<\/div>/.test(html) && !/Published by/.test(html), 'v2 · published <day> by <name>');
  app.click('runs-of', 'release'); await app.tick();
  assert.ok(/aria-current="page">Runs</.test(app.top()) && /Matching runs · \d+/.test(app.html()) && /<option value="release" selected>/.test(app.html()), 'Runs, filtered to this process');
  assert.strictEqual((app.html().match(/data-act="open-run"/g) || []).length, +all[1], 'every run of it');
});

rule('Process page: with no skills and no clean runs yet, the fold says so for someone who doesn\'t own it', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick(); app.click('open-process', 'jira-cleanup'); await app.tick();
  const html = app.html();
  assert.ok(/<summary><h2 id="sk-h">[\s\S]{0,300}?Skills · none yet \(\d of 3 clean runs\)<\/h2><\/summary>/.test(html), html.slice(html.indexOf('sk-h') - 200, html.indexOf('sk-h') + 300));
});

/* A blank new process starts with no steps (2.2.1): one typed into its open Add a step box. */
const firstStep = (app, value) => { app.set('ob-new-text', value); app.keyOn('Enter', {}, { tagName: 'INPUT', id: 'ob-new-text', value, dataset: { enter: 'ob-add-go' }, closest: () => null }); };
/* ---------- Publish: never the old draft while newer edits sit unsaved in the editor ---------- */
rule('Publish: after Done with unsaved edits, Publish is off and says why; it publishes what was saved once the edits are saved', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('nav', 'processes'); await app.tick(); app.click('new-process'); await app.tick();
  app.set('np-id', 'risk-review'); app.set('np-title', 'Risk review'); app.submit('new-process-form'); await app.tick(150);
  firstStep(app, 'The first thing to do'); await app.tick(); app.click('save-draft'); await app.tick(200);
  const draft = 'maps/drafts/risk-review.md', saved = app.fs.files[draft].t;
  app.input('draft-editor', saved.replace('The first thing to do', 'Read the risk register')); await app.tick(300);
  app.click('ed-done'); await app.tick();
  let html = app.html();
  assert.ok(/data-act="publish" data-id="risk-review" disabled aria-describedby="pub-why"/.test(html), 'Publish is off');
  assert.ok(shown(html, /id="pub-why"[^>]*>Your edits aren.t saved, so they wouldn.t be in this version\. Save or discard them in the editor first\./), 'and says why');
  app.set('change-note', 'First version'); app.click('publish', 'risk-review'); await app.tick(120);
  assert.deepStrictEqual(app.files('publications/risk-review/'), [], 'nothing published');
  assert.ok(/aren.t saved, so nothing was published/.test(app.html() + app.live()));
  assert.strictEqual(app.fs.files[draft].t, saved, 'and nothing saved');
  app.click('ptab', 'edit'); await app.tick(); app.click('save-draft'); await app.tick(200); app.click('ed-done'); await app.tick();
  html = app.html();
  assert.ok(/data-act="publish" data-id="risk-review">/.test(html) && !/id="pub-why"/.test(html), 'saved: Publish is on');
  app.set('change-note', 'First version'); app.click('publish', 'risk-review'); await app.tick(200);
  const md = app.files('publications/risk-review/').filter(f => /map\.md$/.test(f));
  assert.ok(md.length === 1 && /Read the risk register/.test(app.fs.files[md[0]].t), 'what the person saw is what was published');
});

/* ---------- Home: what's yours ---------- */
function exampleFolder() {
  const root = path.join(__dirname, '..', 'example-folder'), files = {};
  (function walk(d) { fs.readdirSync(d).forEach(f => { const q = path.join(d, f); if (fs.statSync(q).isDirectory()) walk(q); else files[path.relative(root, q).split(path.sep).join('/')] = fs.readFileSync(q, 'utf8'); }); })(root);
  return files;
}
const todos = html => [...html.matchAll(/<li class="todo ([\w ]+)"><div><b>([^<]*)<\/b>/g)].map(m => m[1] + ': ' + m[2].replace(/&quot;/g, '"').replace(/&#39;/g, '\''));
async function joined(who, edit) {
  const files = exampleFolder(); if (edit) edit(files);
  const app = boot({ picker: folderHandle('Team', files), indexedDB: memoryIDB(), firstRun: true }); await app.tick(60);
  app.click('setup-mode', 'join'); await app.tick(); app.click('setup-open'); await app.tick(300);
  app.click('setup-who', who); await app.tick(100);
  return app;
}

rule('Home, a teammate who just joined: only her own drafts and the plan for everyone, not the team\'s drafts and skills', async () => {
  const app = await joined('person-morgan');
  assert.deepStrictEqual(todos(app.html()).sort(), [
    'draft: New skill or process: the draft has unpublished changes',
    'draft: Weekly Jira cleanup: the draft has unpublished changes',
    'plan: AI assistant planned "Release 2026.10.24"'
  ]);
  assert.ok(/3 things need you\./.test(app.html()));
  app.click('nav', 'processes'); await app.tick();
  assert.ok(/data-act="open-process" data-id="release"[\s\S]*?draft changes/.test(app.html()), 'the team\'s drafts are on Processes');
});

rule('Home: a draft goes to its owner and backup owner; with no one active to take it, to everyone', async () => {
  let app = await joined('person-avery');
  const avery = todos(app.html());
  assert.ok(avery.indexOf('draft: Production release: the draft has unpublished changes') >= 0, 'Avery is the release\'s backup owner');
  assert.ok(avery.indexOf('skill: Production release: 2 skills need attention') >= 0, 'and gets its skills');
  assert.ok(avery.indexOf('draft: Weekly Jira cleanup: the draft has unpublished changes') < 0, 'not Morgan\'s');
  app = await joined('person-casey', files => { files['maps/drafts/jira-cleanup.md'] = files['maps/drafts/jira-cleanup.md'].replace(/^owner: .*\n/m, ''); });
  assert.ok(todos(app.html()).indexOf('draft: Weekly Jira cleanup: the draft has unpublished changes') >= 0, 'no owner named: everyone');
  app = await joined('person-casey', files => { files['people.json'] = files['people.json'].replace('"email": "morgan@example.com"', '"email": "morgan@example.com", "inactive": true'); });
  assert.ok(todos(app.html()).indexOf('draft: Weekly Jira cleanup: the draft has unpublished changes') >= 0, 'its owner left: everyone');
});

rule('Home, the examples: skills that need attention go to the process\'s owner and backup owner only', async () => {
  const app = boot(); await app.tick(60);
  const has = async who => { app.choose(who); await app.tick(); app.click('nav', 'home'); await app.tick(); return todos(app.html()).some(t => /Production release: 2 skills need attention/.test(t)); };
  assert.deepStrictEqual([await has('person-casey'), await has('person-avery'), await has('person-morgan'), await has('person-blake')], [true, true, false, false]);
});

rule('Home: a run you record is one item, "you\'re recording", never also "you\'re up"', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick(); app.click('nav', 'home'); await app.tick();
  const runs = todos(app.html()).filter(t => /^run: Release 2026\.10\.16/.test(t));
  assert.deepStrictEqual(runs, ['run: Release 2026.10.16: you\'re recording']);
});

rule('Home: At a glance is running and processes', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  const g = app.html().slice(app.html().indexOf('id="go-h"'));
  assert.deepStrictEqual([...g.matchAll(/class="tile" data-act="nav" data-id="(\w+)"/g)].map(m => m[1]), ['runs', 'processes']);
});

/* ---------- Top bar: four sections; Skills and Step types stay a click away ---------- */
rule('Top bar: Home, Runs, Processes, Settings', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  const nav = app.top().slice(app.top().indexOf('class="mainnav"'), app.top().indexOf('</nav>'));
  assert.deepStrictEqual([...nav.matchAll(/data-id="(\w+)"/g)].map(m => m[1]), ['home', 'runs', 'processes', 'settings']);
});

rule('Top bar: Skills and Step types open from Processes and Settings, light Processes, and keep their links, Back and Forward', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'processes'); await app.tick();
  assert.ok(/data-act="nav" data-id="skills"/.test(app.html()) && /data-act="nav" data-id="types"/.test(app.html()), 'Processes links to both');
  app.click('nav', 'skills'); await app.tick();
  assert.ok(/<h1 id="page-h" tabindex="-1">Skills<\/h1>/.test(app.html()) && /data-id="processes" aria-current="page"/.test(app.top()), 'Skills, under Processes');
  assert.strictEqual(app.focused(), 'page-h', 'focus on the page');
  assert.strictEqual(app.hash(), '#/skills');
  app.click('nav', 'settings'); await app.tick();
  const lib = app.html().slice(app.html().indexOf('id="set-lib"'));
  assert.ok(/Library/.test(lib) && /data-act="nav" data-id="skills"/.test(lib) && /data-act="nav" data-id="types"/.test(lib), 'Settings has a Library');
  app.click('nav', 'types'); await app.tick();
  assert.ok(/<h1 id="page-h" tabindex="-1">Step types<\/h1>/.test(app.html()) && /data-id="processes" aria-current="page"/.test(app.top()));
  assert.strictEqual(app.hash(), '#/types');
  app.back(); await app.settle();
  assert.ok(/aria-current="page">Settings</.test(app.top()), 'Back to Settings');
  app.back(); await app.settle();
  assert.ok(/<h1 id="page-h" tabindex="-1">Skills<\/h1>/.test(app.html()), 'Back to Skills');
  app.forward(); await app.settle(); app.forward(); await app.settle();
  assert.ok(/<h1 id="page-h" tabindex="-1">Step types<\/h1>/.test(app.html()), 'Forward to Step types');
  app.typeHash('#/skills'); await app.settle();
  assert.ok(/<h1 id="page-h" tabindex="-1">Skills<\/h1>/.test(app.html()), 'a link to #/skills');
});

rule('Top bar: the first-run welcome draws only the name and What\'s new', async () => {
  const app = boot({ firstRun: true }); await app.tick(60);
  const top = app.top();
  assert.ok(/Start your team/.test(app.html()), 'the welcome');
  assert.ok(!/class="mainnav"/.test(top) && !/id="me"/.test(top) && !/data-act="search"/.test(top) && !/data-act="theme"/.test(top), 'no sections, search, theme or You are');
  assert.ok(/Flightdeck/.test(top) && /data-act="whats-new"/.test(top), 'the name and What\'s new');
  assert.ok((top.match(/<(button|select|input)\b/g) || []).length <= 2, 'two controls at most');
  app.click('setup-mode', 'examples'); await app.tick();
  assert.ok(/class="mainnav"/.test(app.top()) && /id="me"/.test(app.top()), 'the examples get the full bar');
});

/* ---------- Part 3: the run says each thing once ---------- */
async function startRelease(who) {
  const app = boot(); await app.tick(60); app.choose(who || 'person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('start', 'release'); await app.tick(); app.chooseApprovers().submitForm('start-form', {}); await app.tick(80);
  return app;
}
const between = (html, a, b) => { const i = html.indexOf(a); return i < 0 ? '' : html.slice(i, b ? html.indexOf(b, i) : undefined); };

rule('Run: the start is announced, not drawn as a notice; the keyboard is mentioned once, and More and ? still have the shortcuts', async () => {
  const app = await startRelease(), html = app.html();
  assert.ok(/Run started/.test(app.live()), 'announced');
  assert.ok(!shown(html, /Run started/), 'no notice on screen');
  assert.strictEqual((visible(html).match(/Space checks it/g) || []).length, 1, 'one keyboard hint, in Next up');
  assert.ok(!/Space: check · N: note · B: blocked/.test(html), 'not again in the step');
  assert.ok(!shown(html, /data-act="help"/), 'no Keyboard shortcuts button outside More');
  assert.ok(/<details class="rw-menu"[\s\S]*?data-act="help">Keyboard shortcuts<\/button>/.test(html), 'More keeps it');
  app.key('?'); await app.tick();
  assert.ok(/Space or X/.test(app.overlay()), '? opens them');
});

rule('Run: the strip keeps who records, Pause, Hand off and what\'s saved; the revision moves to Details', async () => {
  const app = await startRelease(), strip = between(app.html(), 'class="rw-strip"', 'class="fpe-alerts');
  assert.ok(/You.re recording/.test(strip) && /data-kind="pause"/.test(strip) && /data-kind="handoff"/.test(strip) && /id="fresh"/.test(strip), 'the strip as before');
  assert.ok(!/revision/.test(strip), 'no revision in the strip');
  app.click('run-details'); await app.tick();
  assert.ok(/revision \d+/.test(visible(between(app.html(), 'id="rw-details"', '</section>'))), 'in Details');
});

rule('Run: a phase says how it\'s worked in a sentence, without the DO-CONFIRM pill', async () => {
  const app = await startRelease(), html = app.html();
  assert.ok(!/<span class="mode">/.test(html) && !shown(html, /DO-CONFIRM|READ-DO/), 'no pill');
  assert.ok(shown(html, /Do the work, then stop and confirm each step/), 'the sentence');
});

rule('Run: must-do rows carry a compact mark named Must do; the selected step keeps the words, and still has no N/A', async () => {
  const app = await startRelease(), html = app.html(), deck = between(html, 'class="deck"', 'id="rw-ins"');
  assert.ok(!/b-must/.test(deck), 'no Must do pill on rows');
  const marks = deck.match(/<span class="mustmark" role="img" aria-label="Must do" title="Must do">/g) || [];
  assert.ok(marks.length >= 4, 'a mark on each must-do row: ' + marks.length);
  assert.ok(/aria-label="[^"]*, must do"/.test(deck), 'the check says it too');
  app.click('select', 'approved'); await app.tick();
  const ins = between(app.html(), 'id="rw-ins"');
  assert.ok(/<span class="badge b-must">Must do<\/span>/.test(ins), 'the step keeps the words');
  assert.ok(!/data-act="na" data-id="approved"/.test(ins), 'and N/A is still refused');
});

rule('Run: Correct this step without its explanation, the attach limits for screen readers, and Start under More for this step', async () => {
  const app = await startRelease();
  app.click('select', 'approved'); await app.tick();
  const ins = between(app.html(), 'id="rw-ins"');
  assert.ok(!shown(ins, />If the checklist was wrong or unclear here/), 'no explanation');
  assert.ok(/data-act="corr-open" data-mode="correct" data-id="approved" title="If the checklist was wrong or unclear here/.test(ins), 'it\'s the button\'s help text');
  assert.ok(!shown(ins, /up to 10 MB each/) && /<span class="sr" id="att-help">Images, PDF, text, logs and \.zip, up to 10 MB each\.<\/span>/.test(ins), 'the limits, for screen readers');
  assert.ok(!shown(ins, /data-act="start-step"/), 'Start isn\'t on show for an untimed step');
  assert.ok(/<details class="rw-more" data-disc="rw-more"><summary class="small">More for this step<\/summary>[\s\S]*?data-act="start-step" data-id="approved"/.test(ins), 'it\'s under More for this step');
  app.fire('toggle', { target: { dataset: { disc: 'rw-more' }, open: true } }); app.click('select', 'tests'); await app.tick();
  assert.ok(shown(between(app.html(), 'id="rw-ins"'), /data-act="start-step" data-id="tests"/), 'opened, and kept open');
});

/* ---------- Part 3: plain words on screen; stored values unchanged ---------- */
rule('Process page: phases say "Read, then do" and "Do, then confirm", and run details have no caret; skills and must-do are quiet marks', async () => {
  const app = await releaseAs('person-morgan'), html = app.html(), cl = between(html, 'id="cl-h"', '</section>');
  assert.ok(shown(cl, /Do, then confirm/) && shown(cl, /Read, then do/) && !shown(cl, /DO-CONFIRM|READ-DO/), 'modes in words');
  assert.ok(/approves deploy of <b class="dname">commit<\/b> to <b class="dname">environment<\/b>/.test(cl) && !/\^/.test(visible(cl)), 'no caret');
  assert.ok(!/b-must|b-skill/.test(cl), 'no pills');
  assert.ok((cl.match(/class="mustmark" role="img" aria-label="Must do"/g) || []).length >= 8 && /class="pv-skill"/.test(cl), 'marks instead');
});

rule('Finish: End as Canceled on screen, while the run file keeps Cancelled; the receipt says copy it into your ticket', async () => {
  const app = await startRelease();
  app.click('finish'); await app.tick();
  assert.ok(/data-act="end" data-id="Cancelled"[^>]*>End as Canceled<\/button>/.test(app.html()), 'the button');
  const key = /data-act="copy-run-key" data-id="([^"]+)"/.exec(app.html()) || null;
  app.click('end', 'Cancelled'); await app.tick(150);
  const runFile = app.files('runs/release/').filter(f => /run\.json$/.test(f)).map(f => JSON.parse(app.fs.files[f].t)).filter(r => r.ended && r.ended.outcome === 'Cancelled');
  assert.strictEqual(runFile.length, 1, 'stored as Cancelled');
  const html = app.html();
  assert.ok(shown(html, /Ended: Canceled/) && !shown(html, /Cancelled/), 'the receipt says Canceled');
  assert.ok(shown(html, /Copy it into your ticket, or take a screenshot/), 'the receipt\'s eyebrow');
  assert.ok(/Ended: Cancelled/.test(app.el('receipt-text').textContent || between(html, 'id="receipt-text"', '</pre>')), 'the receipt\'s text keeps the stored word');
  void key;
});

rule('Home and Runs: each thing said once', async () => {
  const app = boot(); await app.tick(60);
  app.click('nav', 'home'); await app.tick();
  assert.strictEqual((visible(app.html()).match(/Choose who you are at the top right/g) || []).length, 1, 'Home, before choosing who you are');
  app.choose('person-casey'); await app.tick(); app.click('nav', 'runs'); await app.tick();
  assert.ok(/<div class="small">Every run of every checklist\.<\/div>/.test(app.html()), 'Runs');
});

/* ---------- Part 3: a flatter Processes list ---------- */
rule('Processes: tags fold into Filter by tag (N), one-child groups are one heading, and rows carry no tags or publisher', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'processes'); await app.tick();
  let html = app.html();
  const fold = /<details class="tagfold" data-disc="tags"><summary class="small">Filter by tag \((\d+)\)<\/summary>/.exec(html);
  assert.ok(fold && +fold[1] >= 10, 'the tags are one closed line');
  assert.ok(!shown(html, /data-act="tag"/) && /data-act="tag" data-id="jira"/.test(html), 'folded, still there');
  assert.ok(shown(html, /<span class="t">Operations \/ Incidents/), 'a group whose only child is a group is one heading');
  assert.ok(!/<span class="small">1<\/span><\/summary>/.test(html), 'no counts of 1');
  const rows = visible(between(html, 'class="plist tree"', '</section>'));
  assert.ok(!/class="tag"/.test(rows) && !/published by/.test(rows), 'no tags or publisher on rows');
  assert.ok(/v\d+ · last run /.test(rows), 'version and last run');
  app.fire('toggle', { target: { dataset: { disc: 'tags' }, open: true } }); app.click('tag', 'jira'); await app.tick();
  html = app.html();
  assert.ok(/<details class="tagfold" data-disc="tags" open>/.test(html) && /data-id="jira" aria-pressed="true"/.test(html), 'opened, and the filter works');
  assert.ok(/data-id="jira-cleanup"/.test(html) && !/data-act="open-process" data-id="release"/.test(html), 'filtered');
});

/* ---------- Part 3: New process asks for a title ---------- */
async function newProc(opts) {
  const app = boot(opts); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'processes'); await app.tick(); app.click('new-process'); await app.tick();
  return app;
}
rule('New process: one box, Title; the file name is made from it and shown, and the rest is under More options', async () => {
  const app = await newProc(), html = app.html(), form = between(html, 'id="new-process-form"', '</form>');
  const boxes = visible(form).match(/<(input|select|textarea)\b[^>]*>/g) || [];
  assert.deepStrictEqual(boxes.map(b => (/id="([^"]+)"/.exec(b) || [])[1]), ['np-title'], 'one box on show');
  assert.ok(/<details class="np-more" data-disc="np-more"><summary>More options<\/summary>/.test(form), 'More options, folded');
  ['np-id', 'np-group', 'np-tags', 'np-context', 'np-roles', 'np-owner', 'np-solo'].forEach(id => assert.ok(form.indexOf('id="' + id + '"') >= 0, id + ' is in it'));
  assert.ok(/<label class="field" for="np-id">File name/.test(form) && /keeps this checklist up to date/.test(form), 'plain words');
  app.input('np-title', 'Onboard a new hire!'); await app.tick(300);
  assert.ok(shown(app.html(), /Saved as <code>onboard-a-new-hire\.md/), 'the file name, as it\'s typed');
  assert.ok(/id="np-title" maxlength="120" value=""/.test(app.html()), 'the box keeps what was typed as unapplied, so leaving still asks');
  app.submit('new-process-form'); await app.tick(150);
  assert.ok(/^process: onboard-a-new-hire$/m.test(app.fs.files['maps/drafts/onboard-a-new-hire.md'].t), 'created from the title');
});

rule('New process: a file name typed under More options wins, and a bad or taken one opens the fold with the reason', async () => {
  let app = await newProc({ domFocus: true });
  app.set('np-title', 'Release'); app.submit('new-process-form'); await app.tick(60);
  assert.ok(/already a checklist/.test(app.html() + app.live()) && /<details class="np-more" data-disc="np-more" open>/.test(app.html()) , 'taken: More opens');
  assert.strictEqual(app.activeId(), 'np-title', 'the title it came from has focus');
  assert.ok(/id="np-id" maxlength="120" value=""/.test(app.html()), 'the file name stays made from the title');
  app.click('nav', 'processes'); await app.tick(); app.click('new-process'); await app.tick();
  app.set('np-title', 'Release checklist'); app.submit('new-process-form'); await app.tick(150);
  assert.ok(app.fs.files['maps/drafts/release-checklist.md'], 'a new title makes a new file name');
  app = await newProc();
  app.set('np-title', 'Bad name'); app.set('np-id', 'Bad Name'); app.submit('new-process-form'); await app.tick(60);
  assert.ok(/lowercase letters, numbers and dashes/.test(app.html() + app.live()) && /data-disc="np-more" open/.test(app.html()), 'refused');
  app = await newProc();
  app.set('np-title', 'Something'); app.set('np-id', 'my-own-name'); app.submit('new-process-form'); await app.tick(150);
  assert.ok(app.fs.files['maps/drafts/my-own-name.md'], 'the typed file name');
});

rule('New process: start from a template, then create the draft or publish v1 as it is', async () => {
  let app = await newProc();
  assert.deepStrictEqual([...app.html().matchAll(/data-act="np-tpl" data-id="([\w-]+)"/g)].map(m => m[1]), ['blank', 'check-in', 'weekly-review', 'assistant']);
  app.click('np-tpl', 'weekly-review'); await app.tick();
  app.set('np-title', 'Team weekly'); app.submit('new-process-form'); await app.tick(150);
  const md = app.fs.files['maps/drafts/team-weekly.md'].t;
  assert.ok(/^process: team-weekly$/m.test(md) && /^title: Team weekly$/m.test(md) && /^owner: person-casey$/m.test(md) && /Look back/.test(md), 'the template, as this process');
  app = await newProc();
  app.click('np-tpl', 'weekly-review'); await app.tick();
  app.set('np-title', 'My weekly'); app.click('np-publish'); await app.tick(250);
  assert.strictEqual(app.files('publications/my-weekly/').filter(f => /map\.md$/.test(f)).length, 1, 'published as v1');
  assert.ok(/Published My weekly v1/.test(app.html() + app.live()) && /data-act="start" data-id="my-weekly"/.test(app.html()), 'on its page, ready to start');
  app = await newProc();
  app.click('np-tpl', 'assistant'); await app.tick();
  assert.ok(/\/flightdeck-new-checklist/.test(app.html()) && /data-act="np-copy"/.test(app.html()), 'a prompt to copy');
});

rule('New process: switching to Ask your AI assistant and back keeps what was typed in every box', async () => {
  const app = await newProc();
  app.set('np-title', 'Kept title'); app.set('np-group', 'Ops / Kept'); app.set('np-id', 'kept-file');
  app.click('np-tpl', 'assistant'); await app.tick();
  assert.ok(!/id="np-title"/.test(app.html()), 'the prompt replaces the boxes');
  app.click('np-tpl', 'blank'); await app.tick();
  const html = app.html();
  assert.ok(/id="np-title" maxlength="120" value="Kept title"/.test(html) && /id="np-group" maxlength="120" value="Ops \/ Kept"/.test(html) && /id="np-id" maxlength="120" value="kept-file"/.test(html), 'all back');
  assert.ok(/Saved as <code>kept-file\.md/.test(html), 'and the file name with them');
});

rule('New process: a publish that finishes after the person left the form says where it is and never moves them', async () => {
  const app = await newProc(), orig = app.PF.repo.publish;
  app.PF.repo.publish = function () { app.click('nav', 'runs'); return orig.apply(this, arguments); };
  app.click('np-tpl', 'weekly-review'); await app.tick();
  app.set('np-title', 'Left weekly'); app.click('np-publish'); await app.tick(300);
  app.PF.repo.publish = orig;
  assert.strictEqual(app.files('publications/left-weekly/').filter(f => /map\.md$/.test(f)).length, 1, 'published');
  assert.ok(/<h1 id="page-h"[^>]*>Runs/.test(app.html()), 'still on Runs');
  assert.ok(/Published Left weekly v1\. Open it from Checklists\./.test(app.html() + app.live()), 'says where it is');
});

rule('Plain words: a run detail inside a link\'s address is left alone; only the text shows the name', () => {
  const app = boot(), K = app.PF.vk;
  const out = K.detailWords('<a href="https://example.com/^commit" rel="noopener">see ^commit</a> to <code>^environment</code>');
  assert.strictEqual(out, '<a href="https://example.com/^commit" rel="noopener">see <b class="dname">commit</b></a> to <b class="dname">environment</b>');
});

rule('New process: two quick clicks on Publish v1 publish once and land on the page', async () => {
  const app = await newProc();
  app.click('np-tpl', 'weekly-review'); await app.tick();
  app.set('np-title', 'Twice weekly'); app.click('np-publish'); app.click('np-publish'); await app.tick(300);
  assert.strictEqual(app.files('publications/twice-weekly/').filter(f => /map\.md$/.test(f)).length, 1, 'published once');
  assert.ok(/data-act="start" data-id="twice-weekly"/.test(app.html()), 'on its page');
});

rule('New process: a template that runs solo starts the box checked, and unchecking it leaves runs: solo out', async () => {
  let app = await newProc();
  app.check('np-solo', false); app.click('np-tpl', 'weekly-review'); await app.tick();
  assert.ok(/<input type="checkbox" id="np-solo" checked>/.test(app.html()), 'checked, as the template says');
  app.set('np-title', 'Solo review'); app.submit('new-process-form'); await app.tick(150);
  assert.ok(/^runs: solo$/m.test(app.fs.files['maps/drafts/solo-review.md'].t), 'the live box followed the template, so it is kept');
  app = await newProc();
  app.click('np-tpl', 'weekly-review'); await app.tick();
  app.set('np-title', 'Team review'); app.check('np-solo', false); app.submit('new-process-form'); await app.tick(150);
  assert.ok(!/^runs: solo$/m.test(app.fs.files['maps/drafts/team-review.md'].t), 'unchecked: left out');
});

/* ---------- Part 3: the builder's words; Checks counts problems only ---------- */
rule('Builder: the new-draft banner names Save draft, the header says what unsaved means, and tips don\'t make a Checks badge', async () => {
  const app = await newProc();
  app.set('np-title', 'Onboard'); app.submit('new-process-form'); await app.tick(150);
  firstStep(app, 'Say hello'); await app.tick();
  let html = app.html();
  assert.ok(/choose Save draft, then Review &(amp;)? publish/.test(html + app.live()), 'the banner');
  const head = between(html, 'class="fpe-head"', '</header>');
  assert.ok(!/class="cnt/.test(head) && /aria-label="Checks: \d+ tips?"/.test(head), 'tips only: no number');
  assert.ok(/<span class="lvl tip">Tip<\/span>/.test(html), 'the tips are still listed');
  app.input('draft-editor', app.fs.files['maps/drafts/onboard.md'].t + '- [ ] {confirm} Another {#another}\n'); await app.tick(300);
  assert.ok(/Unsaved: Save draft before you publish/.test(between(app.html(), 'class="fpe-head"', '</header>')), 'unsaved, said in the header');
});

rule('Publish: the first version\'s change note is filled in, First version, and can be changed', async () => {
  /* domFocus: the page's boxes read as drawn, so the prefilled note is what Publish sends. */
  const app = await newProc({ domFocus: true });
  app.set('np-title', 'Note check'); app.submit('new-process-form'); await app.tick(150);
  firstStep(app, 'Check the note'); await app.tick(); app.click('save-draft'); await app.tick(200); app.click('ed-done'); await app.tick();
  assert.ok(/id="change-note" maxlength="200" value="First version"/.test(app.html()), 'prefilled');
  app.click('publish', 'note-check'); await app.tick(200);
  const info = app.files('publications/note-check/').filter(f => /publication\.json$/.test(f));
  assert.ok(info.length === 1 && JSON.parse(app.fs.files[info[0]].t).changes === 'First version', 'published with it');
});

/* ---------- Part 3: Fill in opens itself when a check needs a value ---------- */
const JIRA_X = ['---', 'process: jira-x', 'title: Jira move', 'category: Product', 'owner: person-casey', 'runs: solo', '---', '',
  '## Move it · READ-DO {#move}', '- [!] {jira.issue} Stale issues closed {#stale}', '  action: transition', '  issue: Board filter', '  status: Done', ''].join('\n');
async function jiraRun() {
  const app = boot({ domFocus: true }); await app.tick(60); app.choose('person-casey'); await app.tick();
  await app.fs.write('maps/drafts/jira-x.md', JIRA_X); app.click('refresh'); await app.tick(120);
  app.click('open-process', 'jira-x'); await app.tick(); app.click('publish', 'jira-x'); await app.tick(200);
  app.click('start', 'jira-x'); await app.tick(); app.chooseApprovers().submitForm('start-form', {}); await app.tick(80);
  app.click('select', 'stale'); await app.tick();
  return app;
}
rule('Run: a locked gate folded to its name keeps its time badge', async () => {
  const md = ['---', 'process: timed-x', 'title: Timed', 'category: Ops', 'owner: person-casey', 'runs: solo', '---', '',
    '## First · READ-DO {#first}', '- [ ] {confirm} One {#one}', '', '## Second · READ-DO {#second}', '- [ ] {confirm} Two {#two}', '',
    '## Gate: Late check {#late}', '  due: 23:59', '  > Look at the dashboards.', ''].join('\n');
  const app = boot({ domFocus: true }); await app.tick(60); app.choose('person-casey'); await app.tick();
  await app.fs.write('maps/drafts/timed-x.md', md); app.click('refresh'); await app.tick(120);
  app.click('open-process', 'timed-x'); await app.tick(); app.click('publish', 'timed-x'); await app.tick(200);
  app.click('start', 'timed-x'); await app.tick(); app.chooseApprovers().submitForm('start-form', {}); await app.tick(80);
  let gate = between(app.html(), 'id="gate-late"', '</section>');
  assert.ok(gate && /class="badge b-time[^"]*">Due 11:59 PM/.test(gate), 'the time badge is on show');
  assert.ok(!/Look at the dashboards/.test(gate), 'otherwise brief');
});

rule('Fill in: a check that needs the issue type opens Fill in on that box, says why beside it, and Done then works', async () => {
  const app = await jiraRun();
  app.click('toggle', 'stale'); await app.tick(60);
  let html = app.html();
  assert.ok(/data-scope="fields:stale"/.test(html), 'Fill in is open');
  assert.strictEqual(app.activeId(), 'fld-issueType', 'on the issue type');
  assert.ok(/id="fld-issueType"[^>]*aria-describedby="[^"]*jwhy-stale/.test(html) && /<p class="ferr" id="jwhy-stale">Fill in the issue type \(Story, Release\)/.test(html), 'the reason beside the box');
  assert.ok(/Fill in the issue type/.test(app.live()), 'and announced');
  app.input('fld-issueType', 'Bug'); app.select('fld-issueType', 'Bug'); await app.tick();
  assert.ok(/id="jwhy-stale">The team&#39;s Jira workflows have no issue type &quot;Bug&quot;/.test(app.html()), 'a wrong one says why as soon as it\'s typed');
  app.select('fld-issueType', 'Story'); await app.tick();
  assert.ok(!/id="jwhy-stale"/.test(app.html()), 'a right one clears it');
  /* The stand-in reads a select's chosen option only by value: the step's other boxes are given as drawn. */
  app.set('fld-action', 'transition'); app.set('fld-issue', 'Board filter'); app.set('fld-status', 'Done');
  app.click('save-fields', 'stale'); await app.tick(120);
  app.click('select', 'stale'); await app.tick();
  const res = /<label class="small" for="rec-([\w-]+)">Resolution/.exec(app.html());
  assert.ok(res, 'Done now asks for the Resolution');
  app.set('rec-' + res[1], 'Done'); app.click('record', 'stale'); await app.tick(120);
  const r = app.files('runs/jira-x/').filter(f => /run\.json$/.test(f)).map(f => JSON.parse(app.fs.files[f].t))[0];
  assert.strictEqual(r.steps.stale.s, 'done');
  void html; html = null;
});

/* ---------- Part 3: Finish shows only what has something in it ---------- */
rule('Finish: no follow-ups is one Add a follow-up that opens the form; no corrections is one line; the three End buttons stay', async () => {
  const app = await startRelease();
  app.click('finish'); await app.tick();
  let html = app.html();
  assert.ok(!shown(html, /id="fu-text"/) && /id="fu-text"/.test(html), 'the form is folded');
  assert.ok(/<details class="fu-add" data-disc="fu-add"><summary class="btn">Add a follow-up<\/summary>/.test(html), 'Add a follow-up');
  assert.ok(shown(html, /No corrections/) && !shown(html, /Nothing was done differently/), 'one line');
  assert.deepStrictEqual([...html.matchAll(/data-act="end" data-id="([^"]+)"/g)].map(m => m[1]), ['Completed', 'Stopped early', 'Cancelled']);
  app.fire('toggle', { target: { dataset: { disc: 'fu-add' }, open: true } }); app.set('fu-text', 'Tidy the flags'); app.click('add-followup'); await app.tick(120);
  html = app.html();
  assert.ok(shown(html, /Tidy the flags/), 'added');
  assert.ok(/<details class="fu-add" data-disc="fu-add" open>/.test(html), 'and the form stays open for the next one');
});

/* ---------- Part 3: Runs, Step types and Settings fold what's rarely needed ---------- */
rule('Runs: Export evidence is under More, finished runs show the newest 8 with the rest one click away, and cards drop the version', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick(); app.click('nav', 'runs'); await app.tick();
  const html = app.html(), head = between(html, 'class="runhead"', 'class="panel rf"');
  assert.ok(!shown(head, /data-act="ev-range"/) && /<details class="rw-menu" data-disc="runs-more"><summary class="mini">More<\/summary>[\s\S]*?data-act="ev-range"/.test(head), 'Export evidence under More');
  const fin = between(html, 'Finished · ', '</section>'), n = +/Finished · (\d+)/.exec(html)[1];
  const shownCards = (visible(fin).match(/class="card"/g) || []).length, all = (fin.match(/class="card"/g) || []).length;
  assert.ok(n > 8 ? shownCards === 8 && all === n && /Earlier finished runs \(\d+\)/.test(fin) : shownCards === n, 'newest 8: ' + shownCards + ' of ' + n);
  assert.ok(!/<span class="cat">[^<]* · v\d+<\/span>/.test(html), 'no version on cards');
});

rule('Runs: a finished run with a conflict copy is never folded away, however old', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  const ended = app.files('runs/').filter(f => /run\.json$/.test(f)).map(f => ({ f, j: JSON.parse(app.fs.files[f].t) })).filter(x => x.j.ended).sort((a, b) => a.j.ended.at < b.j.ended.at ? -1 : 1);
  assert.ok(ended.length > 8, 'enough finished runs: ' + ended.length);
  const oldest = ended[0];
  await app.fs.write(oldest.f.replace('run.json', 'run.conflict-wx-1.json'), JSON.stringify(oldest.j));
  app.click('nav', 'runs'); app.click('refresh'); await app.tick(120);
  const fin = between(app.html(), 'Finished · ', '</section>'), at = fin.indexOf('data-id="' + oldest.j.process + '/' + oldest.j.id + '"'), fold = fin.indexOf('<details data-disc="runs-older"');
  assert.ok(at > 0 && (fold < 0 || at < fold), 'outside the fold');
  assert.ok(/conflict copy found/.test(fin.slice(at, fin.indexOf('</button>', at))), 'with its warning');
});

rule('Step types: the built-in types fold into one line, and a type\'s {id} is inside What it asks for', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick(); app.click('nav', 'types'); await app.tick();
  const html = app.html();
  assert.ok(/<details class="panel fold" data-disc="types-built"><summary><h2>Built-in types · \d+<\/h2><\/summary>/.test(html), 'folded');
  assert.ok(!shown(html, /\{confirm\}/) && /\{confirm\}/.test(html), 'the id is still there');
  app.fire('toggle', { target: { dataset: { disc: 'types-built' }, open: true } }); app.fire('toggle', { target: { dataset: { disc: 'type:confirm' }, open: true } }); app.click('nav', 'types'); await app.tick();
  assert.ok(shown(app.html(), /\{confirm\}/), 'opened, both stay open');
});

rule('Settings: Jira workflows and Keyboard are under More settings, unless a workflow has a problem', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick(); app.click('nav', 'settings'); await app.tick();
  let html = app.html();
  assert.ok(/<details class="panel fold" data-disc="set-more"><summary><h2>More settings<\/h2><\/summary>[\s\S]*?Jira workflows[\s\S]*?id="set-keys"/.test(html), 'folded');
  await app.fs.write('jira/workflows.json', '{ "Story": 3 }'); app.click('refresh'); await app.tick(150); app.click('nav', 'settings'); await app.tick();
  html = app.html();
  assert.ok(shown(html, /Jira workflows/) && shown(html, /not used/), 'a problem stays on show');
});

run();
