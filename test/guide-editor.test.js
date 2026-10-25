// The editor's entry boxes (2.6.0, entry boxes): each box asks its question, shows an example and says why; the usual boxes
// show and the rest wait behind "+ add" chips; short choices are buttons. Run against the built app with a stand-in browser.
'use strict';
const assert = require('assert');
const { rule, run, loadViews } = require('./harness');
const { boot } = require('./app-harness');

const PF = loadViews(), G = PF.guide, T = PF.types, R = PF.run;
const HEAD = '---\nprocess: release\ntitle: Production release\nowner: person-casey\nroles: lead\ncontext: tag, environment\n---\n\n';
const md = (...steps) => HEAD + '## Build · READ-DO {#build}\n' + steps.join('') + '\n';
const step = (type, id, ...fields) => '- [ ] {' + type + '} Do ' + id + ' {#' + id + '}\n' + fields.map(f => '  ' + f + '\n').join('');
const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const SIX = { id: 'pick.six', label: 'Pick six', icon: 'doc', hint: 'Choose a size.', fields: { size: { label: 'Size', kind: 'choice', options: ['xs', 's', 'm', 'l', 'xl', 'xxl'] } } };

/* The builder open on the release draft as written here, with step key selected. */
async function editorOn(text, key, opts) {
  const app = boot(Object.assign({}, opts || {})); await app.tick(60); app.choose('person-casey'); await app.tick();
  await app.fs.write('maps/drafts/release.md', text);
  await app.fs.write('step-types/pick.six.json', JSON.stringify(SIX));
  app.focus(); await app.tick(80);
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  if (key) { app.click('ob-sel', key); await app.tick(); }
  return app;
}
/* The side form, to its own closing tag (it holds sections of its own). */
const formOf = app => {
  const h = app.html(), at = h.indexOf('<section class="panel stack ob-form"'); if (at < 0) return '';
  const re = /<(\/?)section\b/g; re.lastIndex = at; let depth = 0, m;
  while ((m = re.exec(h))) { depth += m[1] ? -1 : 1; if (!depth) return h.slice(at, m.index); }
  return h.slice(at);
};
const labelOf = (h, id) => { const m = new RegExp('<label[^>]*for="' + id + '"[^>]*>([\\s\\S]*?)(?:<input|<textarea|<select|</label>)').exec(h); return m ? un(m[1].replace(/<[^>]+>/g, '')).trim() : null; };
const tagOf = (h, id) => (new RegExp('<(?:input|textarea|select|button)\\b[^>]*\\sid="' + id + '"[^>]*>').exec(h) || [''])[0];
const whyOf = (h, id) => { const m = new RegExp('<span class="small hint ob-why" id="why-' + id + '">([\\s\\S]*?)</span>').exec(h); return m ? un(m[1]) : null; };
const flagOf = (h, id) => { const m = new RegExp('<span class="small ob-flag" id="flag-' + id + '">([\\s\\S]*?)</span>').exec(h); return m ? un(m[1]) : null; };
const chips = h => [...h.matchAll(/data-act="ob-show" data-id="([\w-]+)"[^>]*>([^<]*)</g)].map(m => m[1] + '=' + un(m[2]));
const boxes = h => [...h.matchAll(/\sid="ob-fld-([\w-]+)"/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i);
const choiceRow = (h, id) => [...h.matchAll(new RegExp('<button type="button" role="radio"[^>]*data-act="ob-choice" data-id="' + id + '" data-val="([^"]*)"[^>]*aria-checked="(true|false)"[^>]*tabindex="(-1|0)"[^>]*>([^<]*)</button>', 'g'))].map(m => [un(m[1]), m[2] === 'true', m[3] === '0', un(m[4])]);
const enter = (app, id, value) => { app.set(id, value); app.input(id, value); app.keyOn('Enter', {}, { tagName: 'INPUT', id, value, dataset: { enter: 'ob-commit' }, closest: () => null }); };
const choose = (app, id, val) => app.click('ob-choice', id, { val });
const textOf = async app => { app.click('save-draft'); await app.tick(80); return app.fs.files['maps/drafts/release.md'].t; };
const typeOf = id => T.get(id);

rule('Editor: each field asks its question, shows its example and says why, linked for screen readers; "usually filled in" is gone', async () => {
  const app = await editorOn(md(step('jenkins.job', 'b', 'job: release/build-and-test', 'parameters: BRANCH=main')), 'b'), h = formOf(app), t = typeOf('jenkins.job');
  assert.strictEqual(labelOf(h, 'ob-fld-job'), 'Which job?');
  assert.ok(/placeholder="release\/build-and-test"/.test(tagOf(h, 'ob-fld-job')), 'the example: ' + tagOf(h, 'ob-fld-job'));
  assert.strictEqual(whyOf(h, 'ob-fld-job'), G.field(t, 'job', { job: 'release/build-and-test', parameters: 'BRANCH=main' }).why);
  assert.ok(/aria-describedby="why-ob-fld-job"/.test(tagOf(h, 'ob-fld-job')), 'linked');
  assert.ok(!/usually filled in/.test(h), 'gone');
  for (const [id, name] of [['ob-text', 'text'], ['ob-note', 'note']]) {
    assert.strictEqual(labelOf(h, id), G.step(name).q, id);
    assert.strictEqual(whyOf(h, id), G.step(name).why, id + ' why');
    assert.ok(new RegExp('aria-describedby="why-' + id + '"').test(tagOf(h, id)), id + ' linked');
  }
  assert.ok(/placeholder="Tag the release"/.test(tagOf(h, 'ob-text')));
  assert.ok(/<span id="ob-roles-l">Who does it\?<\/span>/.test(h) && /<span id="ob-binds-l">Which run details does it depend on\?<\/span>/.test(h), 'roles and run details ask too');
});

rule('Editor: the usual boxes show (required, or holding a value); the rest wait behind "+ add" chips; with none of those, the first two that apply', async () => {
  let app = await editorOn(md(step('jenkins.job', 'b', 'job: release/build-and-test', 'parameters: BRANCH=main'), step('confirm', 'c'), step('jira.issue', 'j', 'action: create')), 'b');
  assert.deepStrictEqual(boxes(formOf(app)), ['job', 'parameters']);
  assert.deepStrictEqual(chips(formOf(app)).filter(c => /^(page|stage)=/.test(c)), ['page=+ Job page', 'stage=+ Watch for']);
  app.click('ob-sel', 'c'); await app.tick();
  assert.deepStrictEqual(boxes(formOf(app)), ['where', 'looks'], 'nothing usual: the first two that apply');
  app.click('ob-sel', 'j'); await app.tick();
  const h = formOf(app);
  assert.deepStrictEqual(boxes(h).filter(b => b !== 'action'), ['project'], 'create: the project is usual; the issue doesn\'t apply');
  assert.ok(!chips(h).some(c => /^issue=/.test(c)), 'no chip for a field that doesn\'t apply to create');
  assert.ok(['issueType=+ Issue type', 'set=+ Fields to set'].every(c => chips(h).includes(c)), chips(h).join(' '));
  assert.ok(!chips(h).some(c => /^(assignee|linkTo|status)=/.test(c)), 'other actions\' fields wait for those actions');
});

rule('Editor: "+ add" shows the box, focused; left empty, it goes back behind its chip on the next draw; a cleared value keeps its box until focus leaves', async () => {
  const app = await editorOn(md(step('jenkins.job', 'b', 'job: release/build-and-test', 'parameters: BRANCH=main')), 'b', { replace: true, domFocus: true });
  app.click('ob-show', 'stage'); await app.tick();
  assert.ok(boxes(formOf(app)).includes('stage') && !chips(formOf(app)).some(c => /^stage=/.test(c)), 'shown, its chip gone');
  assert.strictEqual(app.activeId(), 'ob-fld-stage', 'focused');
  app.doc.activeElement = app.doc.body; app.fire('focusout', { target: { id: 'ob-fld-stage', value: '' } }); await app.tick(20);
  enter(app, 'ob-fld-job', 'release/other'); await app.tick();
  assert.ok(!boxes(formOf(app)).includes('stage') && chips(formOf(app)).includes('stage=+ Watch for'), 'empty and left: back behind its chip');
  /* Clearing an optional value keeps the empty box where it is, focused, until focus leaves. */
  app.set('ob-fld-parameters', ''); app.fire('focusin', { target: { id: 'ob-fld-parameters' } });
  enter(app, 'ob-fld-parameters', ''); await app.tick();
  assert.ok(boxes(formOf(app)).includes('parameters'), 'cleared: still shown');
  assert.strictEqual(app.activeId(), 'ob-fld-parameters');
  assert.ok(!/parameters:/.test(await textOf(app)), 'the value is gone from the draft');
  app.doc.activeElement = app.doc.body; app.fire('focusout', { target: { id: 'ob-fld-parameters', value: '' } }); await app.tick(20);
  app.click('ob-show', 'page'); await app.tick();
  assert.ok(!boxes(formOf(app)).includes('parameters') && chips(formOf(app)).includes('parameters=+ Parameters'), 'then behind its chip');
});

rule('Editor: a chip while another box holds typing waits for that typing, which is never dropped; a reveal is no edit (no Undo step) and is forgotten when the step is left', async () => {
  const app = await editorOn(md(step('jenkins.job', 'b', 'job: release/build-and-test'), step('confirm', 'c')), 'b');
  app.set('ob-fld-job', 'release/typed'); app.input('ob-fld-job', 'release/typed');
  app.click('ob-show', 'stage'); await app.tick();
  assert.ok(/Apply or clear what you typed in the box first/.test(app.html()), 'it waits');
  assert.ok(!boxes(formOf(app)).includes('stage'));
  assert.strictEqual(app.draft('ob-fld-job'), 'release/typed', 'the typing is kept');
  enter(app, 'ob-fld-job', 'release/typed'); await app.tick();
  app.click('ob-show', 'stage'); await app.tick();
  assert.ok(boxes(formOf(app)).includes('stage'));
  assert.ok(!/Showed|Revealed/.test(app.live()) && /Undo available/.test(app.html()), 'the Undo is the job\'s');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/value="release\/build-and-test"/.test(tagOf(formOf(app), 'ob-fld-job')), 'Undo took back the job, not the reveal');
  app.click('ob-sel', 'c'); await app.tick(); app.click('ob-sel', 'b'); await app.tick();
  assert.ok(!boxes(formOf(app)).includes('stage'), 'leaving the step forgets what was shown');
});

rule('Editor: a value the step doesn\'t use is kept and flagged: another action\'s field, and a field the type doesn\'t have', async () => {
  const app = await editorOn(md(step('jira.issue', 'j', 'action: create', 'project: PAY'), step('github.pr', 'g', 'action: open', 'repo: payments-api', 'pull: https://github.com/acme/payments-api/pull/88'), step('confirm', 'c', 'job: release/x')), 'j');
  choose(app, 'ob-fld-action', 'transition'); await app.tick();
  let h = formOf(app);
  assert.ok(boxes(h).includes('project') && /value="PAY"/.test(tagOf(h, 'ob-fld-project')), 'kept');
  assert.strictEqual(flagOf(h, 'ob-fld-project'), 'Only used when the action is create.');
  assert.ok(new RegExp('aria-describedby="[^"]*flag-ob-fld-project').test(tagOf(h, 'ob-fld-project')), 'the flag is read out');
  assert.ok(['issue', 'status'].every(b => boxes(h).includes(b)), 'the transition\'s usual boxes: ' + boxes(h));
  assert.ok(/project: PAY/.test(await textOf(app)), 'nothing dropped');
  app.click('ob-sel', 'g'); await app.tick(); h = formOf(app);
  assert.strictEqual(flagOf(h, 'ob-fld-pull'), 'Not used when the action is open.');
  app.click('ob-sel', 'c'); await app.tick(); h = formOf(app);
  assert.strictEqual(labelOf(h, 'ob-fld-job'), 'job', 'its raw name');
  assert.strictEqual(flagOf(h, 'ob-fld-job'), '{confirm} doesn\'t use this; publishing will refuse it.');
});

rule('Editor: 5 or fewer choices are buttons (Not set first, roving tabindex, case-insensitive, a hand-written value kept); 6 or more stay a select', async () => {
  const app = await editorOn(md(step('jira.issue', 'j', 'action: Create', 'project: PAY'), step('jira.issue', 'k'), step('jira.issue', 'w', 'action: frobnicate'), step('pick.six', 'p')), 'j');
  let row = choiceRow(formOf(app), 'ob-fld-action');
  assert.deepStrictEqual(row.map(r => r[0]), ['', 'create', 'update', 'transition', 'assign', 'link']);
  assert.deepStrictEqual(row.map(r => r[3]), ['Not set', 'Create', 'Update', 'Transition', 'Assign', 'Link']);
  assert.deepStrictEqual(row.filter(r => r[1]).map(r => r[0]), ['create'], 'Create matches create');
  assert.deepStrictEqual(row.filter(r => r[2]).map(r => r[0]), ['create'], 'Tab enters at the checked button');
  assert.ok(/<div class="seg ob-choices" role="radiogroup" aria-labelledby="q-ob-fld-action" aria-describedby="why-ob-fld-action">/.test(formOf(app)));
  assert.ok(/<button[^>]*\sid="ob-fld-action" data-act="ob-choice" data-id="ob-fld-action" data-val="create"/.test(formOf(app)), 'the checked button carries the control ID, so focus and refusals land on it');
  const before = await textOf(app);
  choose(app, 'ob-fld-action', 'create'); await app.tick();
  assert.strictEqual(await textOf(app), before, 'the checked one does nothing');
  choose(app, 'ob-fld-action', ''); await app.tick();
  assert.ok(!/action:/.test((await textOf(app)).split('{#j}')[1].split('{#k}')[0]), 'Not set clears it');
  app.click('ob-sel', 'k'); await app.tick(); row = choiceRow(formOf(app), 'ob-fld-action');
  assert.deepStrictEqual(row.filter(r => r[2]).map(r => r[0]), [''], 'nothing set: Tab enters at Not set');
  app.click('ob-sel', 'w'); await app.tick(); row = choiceRow(formOf(app), 'ob-fld-action');
  assert.deepStrictEqual(row.filter(r => r[1]).map(r => r[0]), ['frobnicate'], 'a hand-written value shows as an extra checked button');
  app.click('ob-sel', 'p'); await app.tick();
  assert.ok(/<select id="ob-fld-size"/.test(formOf(app)) && !choiceRow(formOf(app), 'ob-fld-size').length, 'six: a select');
});

rule('Editor: choice keys: arrows move and select (wrapping), focus follows the checked button; a choice waits while a box holds typing', async () => {
  const app = await editorOn(md(step('jira.issue', 'j', 'action: create')), 'j', { replace: true, domFocus: true });
  /* A key on a drawn choice button, as the browser hands it over: its data-* as dataset. */
  const on = (key, val) => {
    const m = new RegExp('data-act="ob-choice" data-id="ob-fld-action" data-val="' + val + '"[^>]*data-prev="([^"]*)" data-next="([^"]*)"').exec(formOf(app)); assert.ok(m, 'prev/next on ' + val);
    app.keyOn(key, {}, { tagName: 'BUTTON', dataset: { act: 'ob-choice', id: 'ob-fld-action', val, prev: un(m[1]), next: un(m[2]) }, closest: () => null });
  };
  on('ArrowRight', 'create'); await app.tick();
  assert.strictEqual(app.activeId(), 'ob-fld-action', 'focus on the checked button');
  assert.ok(/data-val="update"[^>]*aria-checked="true"/.test(formOf(app)));
  assert.ok(/action: update/.test(await textOf(app)));
  on('ArrowDown', 'update'); await app.tick();
  assert.ok(/action: transition/.test(await textOf(app)));
  on('ArrowUp', 'transition'); on('ArrowLeft', 'update'); await app.tick();
  assert.ok(/action: create/.test(await textOf(app)));
  on('ArrowLeft', 'create'); await app.tick();
  assert.ok(!/action:/.test(await textOf(app)), 'Left from the first option reaches Not set');
  on('ArrowLeft', ''); await app.tick();
  assert.ok(/action: link/.test(await textOf(app)), 'and wraps to the last');
  app.set('ob-text', 'Typed, not applied'); app.input('ob-text', 'Typed, not applied');
  choose(app, 'ob-fld-action', 'assign'); await app.tick();
  assert.ok(/Apply or clear what you typed in the box first/.test(app.html()) && /action: link/.test(app.fs.files['maps/drafts/release.md'].t), 'waits');
  assert.strictEqual(app.draft('ob-text'), 'Typed, not applied');
});

rule('Editor: phase mode is buttons with no Not set; choosing applies, Undo takes it back', async () => {
  const app = await editorOn(md(step('confirm', 'c')));
  app.click('ob-sel-phase', 'build'); await app.tick();
  const row = choiceRow(formOf(app), 'ob-ph-mode');
  assert.deepStrictEqual(row.map(r => [r[0], r[1], r[3]]), [['READ-DO', true, 'Read, then do'], ['DO-CONFIRM', false, 'Do, then confirm']]);
  assert.strictEqual(whyOf(formOf(app), 'ob-ph-mode'), G.form('ph-mode').why);
  choose(app, 'ob-ph-mode', 'DO-CONFIRM'); await app.tick();
  assert.deepStrictEqual(choiceRow(formOf(app), 'ob-ph-mode').filter(r => r[1]).map(r => r[0]), ['DO-CONFIRM']);
  app.click('tl-undo', 'draft'); await app.tick();
  assert.deepStrictEqual(choiceRow(formOf(app), 'ob-ph-mode').filter(r => r[1]).map(r => r[0]), ['READ-DO']);
});

rule('Editor: a refused choice keeps the checked button, says why beside the group, and the group reads it out', () => {
  const V = PF.views, text = md(step('jira.issue', 'j', 'action: create'));
  const h = V.builderForm({ state: { obSel: { pid: 'release', kind: 'step', key: 'j' }, fieldErr: { id: 'ob', field: 'ob-fld-action', msg: 'No.' } }, data: {}, fsKey: 'f' }, { id: 'release' }, text);
  assert.ok(/<button[^>]*\sid="ob-fld-action" data-act="ob-choice" data-id="ob-fld-action" data-val="create"[^>]*aria-checked="true"/.test(h), 'still checked, and focus lands on it');
  const group = (/<div class="seg ob-choices" role="radiogroup" aria-labelledby="q-ob-fld-action"[^>]*>/.exec(h) || [''])[0];
  assert.ok(/aria-describedby="ferr-ob-fld-action why-ob-fld-action"/.test(group) && /aria-invalid="true"/.test(group), group);
  assert.ok(/id="ferr-ob-fld-action" role="alert">No\./.test(h), 'announced');
});

rule('Editor: the fields every type accepts wait behind "More about this step"; At, Done by and Due after stay three boxes', async () => {
  const app = await editorOn(md(step('confirm', 'c'), step('confirm', 'd', 'at: 14:00', 'due: 17:30')), 'c');
  const more = (/<div class="field ob-more"><span id="ob-more-l">More about this step<\/span><div class="row" role="group" aria-labelledby="ob-more-l">([\s\S]*?)<\/div><\/div>/.exec(formOf(app)) || [])[1] || '';
  assert.deepStrictEqual(chips(more), ['link=+ Link', 'expect=+ How long it takes', 'deadline=+ Deadline', 'evidence=+ Ask for proof', 'require=+ What must be recorded', 'at=+ At', 'due=+ Done by', 'after=+ Due after', 'sets=+ Sets a run detail']);
  app.click('ob-show', 'expect'); await app.tick();
  assert.strictEqual(labelOf(formOf(app), 'ob-fld-expect'), 'How long does it usually take?');
  app.click('ob-sel', 'd'); await app.tick();
  const h = formOf(app);
  assert.ok(['at', 'due'].every(b => boxes(h).includes(b)), 'both shown');
  assert.ok(chips(h).includes('after=+ Due after'), 'the third still offered');
  assert.strictEqual(flagOf(h, 'ob-fld-at'), 'Give one time, "at:", "due:" or "after:", not more than one.', 'the one-of-three message, under each');
  assert.strictEqual(flagOf(h, 'ob-fld-due'), flagOf(h, 'ob-fld-at'));
});

rule('Editor: Ask for proof is buttons; What must be recorded offers only the type\'s records and All, shows other mechanisms\' needs as fixed, marks another action\'s record and an unknown name', async () => {
  const app = await editorOn(md(step('github.pr', 'g', 'action: open', 'repo: payments-api', 'require: mergeCommit, nope', 'evidence: note', 'sets: tag')), 'g');
  const h = formOf(app);
  assert.deepStrictEqual(choiceRow(h, 'ob-fld-evidence').map(r => r[3]), ['Not set', 'Link', 'Note', 'Number', 'Yes/no', 'Date']);
  const req = [...h.matchAll(/data-act="ob-req" data-id="([\w-]+)" aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)].map(m => [m[1], m[2] === 'true', un(m[3].replace(/<[^>]+>/g, ''))]);
  assert.deepStrictEqual(req.map(r => r[0]), ['pr', 'checks', 'mergeCommit', 'all', 'nope']);
  assert.deepStrictEqual(req.filter(r => r[1]).map(r => r[0]), ['mergeCommit', 'nope']);
  assert.ok(/Only asked when the action is merge/.test(req[2][2]), 'another action\'s record is marked: ' + req[2][2]);
  assert.ok(/doesn't record nope/.test(req[4][2]) && /ob-req bad/.test(h), 'an unknown name is marked invalid, and removable');
  const fixed = [...h.matchAll(/<span class="chip ob-needed">([\s\S]*?)<\/span>/g)].map(m => un(m[1].replace(/<[^>]+>/g, '')));
  assert.deepStrictEqual(fixed, ['Needed: a note (from Ask for proof)', 'Needed: ^tag (from Sets a run detail)']);
  app.click('ob-req', 'nope'); await app.tick();
  app.click('ob-req', 'checks'); await app.tick();
  assert.ok(/require: mergeCommit, checks/.test(await textOf(app)), 'toggled, never writing evidence or sets into require');
});

rule('Editor: "When it\'s checked, they record" lists exactly what the run asks for, through R.evidenceFor with practice\'s stand-in', async () => {
  const text = md(step('jira.issue', 'j', 'action: transition', 'issue: PAY-1', 'issueType: Story', 'status: In Review', 'sets: tag', 'require: all'));
  const app = await editorOn(text, 'j'), h = formOf(app);
  const sec = (/<section class="ob-records" aria-labelledby="ob-rec-h"><h3 class="ob-sec" id="ob-rec-h">When it's checked, they record<\/h3><ul>([\s\S]*?)<\/ul>/.exec(h) || [])[1];
  assert.ok(sec, 'the section');
  const items = [...sec.matchAll(/<li><b>([\s\S]*?)<\/b>( <span class="small">needed to check it<\/span>)?<span class="small hint">([\s\S]*?)<\/span><\/li>/g)].map(m => [un(m[1]), !!m[2], un(m[3])]);
  const PR = PF.practice, map = PR.admit(text, PR.env({}, JSON.parse(require('./harness').example('jira/workflows.json')))).map;
  const r = PR.asRun({ sample: {}, steps: {}, gates: {}, fields: {} }, map, null, false, PR.env({}, JSON.parse(require('./harness').example('jira/workflows.json'))));
  const s = map.phases[0].steps[0], ev = R.evidenceFor(r, s, null, map), t = typeOf('jira.issue');
  assert.deepStrictEqual(items, JSON.parse(JSON.stringify(ev.list.map(d => { const g = G.record(t, d, ev.fields); return [g.q, !!d.required, g.why]; }))));
  assert.ok(items.some(i => i[0] === 'Reviewer') && items.some(i => i[0] === 'What\'s the ^tag?'), 'the workflow\'s field and the run detail: ' + JSON.stringify(items));
});

rule('Editor: the other forms ask their questions: phase, gate, lane, checklist details, Questions and screenshots', async () => {
  const text = HEAD + '## Build · READ-DO {#build}\n- [ ] {confirm} Do c {#c}\n  ![The deploy button](images/a.png)\n\n### Track: Lane one {#lane}\n- [ ] {confirm} In the lane {#inlane}\n\n## Gate: Ready {#ready}\n\n## Questions for the owner\n\n- Who signs off?\n';
  const app = await editorOn(text);
  app.click('ob-sel-phase', 'build'); await app.tick();
  let h = formOf(app);
  for (const [id, name] of [['ob-ph-title', 'ph-title'], ['ob-ph-note', 'ph-note'], ['ob-g-title', 'g-title'], ['ob-g-owner', 'g-owner'], ['ob-g-approves', 'g-approves']]) {
    assert.strictEqual(labelOf(h, id), G.form(name).q, id);
    assert.strictEqual(whyOf(h, id), G.form(name).why, id + ' why');
    if (G.form(name).eg) assert.ok(tagOf(h, id).includes('placeholder="' + G.form(name).eg.replace(/"/g, '&quot;') + '"'), id + ' example');
  }
  app.click('ob-sel-track', 'build', { track: '0' }); await app.tick(); h = formOf(app);
  assert.strictEqual(labelOf(h, 'ob-tr-title'), G.form('tr-title').q); assert.strictEqual(labelOf(h, 'ob-tr-role'), G.form('tr-role').q);
  app.click('ob-sel-details'); await app.tick(); h = formOf(app);
  assert.strictEqual(labelOf(h, 'ob-owner'), G.form('owner').q); assert.strictEqual(labelOf(h, 'ob-backup'), G.form('backup').q);
  assert.ok(/placeholder="release-manager"/.test(tagOf(h, 'ob-add-role')) && /placeholder="tag"/.test(tagOf(h, 'ob-add-ctx')));
  app.click('ob-sel-questions'); await app.tick(); h = formOf(app);
  assert.strictEqual(labelOf(h, 'ob-q-text'), G.form('questions').q); assert.strictEqual(whyOf(h, 'ob-q-text'), G.form('questions').why);
  app.click('ob-sel', 'c'); await app.tick(); h = formOf(app);
  for (const id of ['ob-shot-cap-0', 'ob-shot-new']) {
    assert.strictEqual(labelOf(h, id), G.form('caption').q + (id === 'ob-shot-new' ? ' (the next screenshot)' : ' (screenshot 1 of 1)'), id);
    assert.strictEqual(whyOf(h, id), G.form('caption').why, id + ' why');
  }
  assert.ok(tagOf(h, 'ob-shot-new').includes('placeholder="' + G.form('caption').eg + '"'), 'its example');
});

rule('Pull request: one entry in the picker and the parts box; a new one takes the checklist\'s usual host', async () => {
  const app = await editorOn(md(step('bitbucket.pr', 'b1', 'action: open', 'repo: web'), step('bitbucket.pr', 'b2', 'action: merge', 'repo: web'), step('github.pr', 'g', 'action: open', 'repo: api')), 'g');
  const picker = (/<select id="ob-type"[\s\S]*?<\/select>/.exec(formOf(app)) || [''])[0];
  assert.deepStrictEqual([...picker.matchAll(/<option value="([\w.]+)"[^>]*>Pull request<\/option>/g)].map(m => m[1]), ['github.pr'], 'one entry, keeping this step\'s host');
  assert.ok(!/GitHub pull request/.test(picker));
  const box = app.html().slice(app.html().indexOf('<aside class="fpe-pane fpe-parts"'));
  assert.strictEqual((box.match(/data-act="ob-part" data-id="type:(?:pr|github\.pr|bitbucket\.pr)"/g) || []).length, 1, 'one part');
  app.click('ob-sel', 'b1'); await app.tick();
  assert.ok(/<option value="bitbucket\.pr" selected>Pull request<\/option>/.test(formOf(app)));
  app.click('ob-part', 'type:pr'); await app.tick(); app.click('ob-place-at', 'end:build:-1'); await app.tick();
  assert.ok(/- \[ \] \{bitbucket\.pr\} Pull request/.test(await textOf(app)), 'Bitbucket: most of this checklist\'s pull requests');
});

rule('Pull request: Where? switches the host both ways, keeping and flagging what the other doesn\'t use; Undo; the files equal writing the other type by hand; the signature changes', async () => {
  const before = md(step('github.pr', 'g', 'action: approve', 'repo: payments-api', 'pull: https://github.com/acme/payments-api/pull/88', 'require: checks'));
  const app = await editorOn(before, 'g');
  let row = choiceRow(formOf(app), 'ob-host');
  assert.deepStrictEqual(row.map(r => [r[0], r[1], r[3]]), [['github.pr', true, 'GitHub'], ['bitbucket.pr', false, 'Bitbucket']]);
  assert.ok(formOf(app).indexOf('id="q-ob-host">Where is the pull request?') >= 0 && formOf(app).indexOf('q-ob-host') < formOf(app).indexOf('q-ob-fld-action'), 'its first question');
  choose(app, 'ob-host', 'bitbucket.pr'); await app.tick();
  const h = formOf(app), text = await textOf(app);
  assert.strictEqual(text, before.replace('{github.pr}', '{bitbucket.pr}'), 'only the type changed: as if written by hand');
  assert.strictEqual(flagOf(h, 'ob-fld-action'), '{bitbucket.pr} doesn\'t have approve. Pick one of: open, review, merge.');
  assert.strictEqual(flagOf(h, 'ob-fld-pull'), '{bitbucket.pr} doesn\'t use this; publishing will refuse it.');
  assert.ok(/class="chipbtn ob-req bad" data-bad="1" data-act="ob-req" data-id="checks" aria-pressed="true"/.test(h), 'checks: a removable invalid chip');
  const S = PF.signature, sig = t => { const m = PF.map.parse(t); return S.steps(m, null, null, null).g.sig; };
  assert.notStrictEqual(sig(text), sig(before), 'switching hosts is a change to the step');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.strictEqual(await textOf(app), before, 'Undo puts the type back, byte for byte');
  choose(app, 'ob-host', 'bitbucket.pr'); await app.tick(); choose(app, 'ob-host', 'github.pr'); await app.tick();
  assert.strictEqual(await textOf(app), before, 'and switching back');
});

rule('Editor: What must be recorded and Sets a run detail are one box each: "+ add" focuses the first chip, focus inside keeps them shown, leaving them empty puts them back; a marked chip goes and focus moves to the group', async () => {
  const app = await editorOn(md(step('jenkins.job', 'b', 'job: release/build-and-test'), step('confirm', 'c', 'sets: tag, nope')), 'b', { replace: true, domFocus: true });
  app.click('ob-show', 'require'); await app.tick();
  assert.ok(boxes(formOf(app)).includes('require'), 'shown');
  assert.strictEqual(app.activeId(), '[data-act="ob-req"][data-id="build"]', 'focus on its first chip, not a box that isn\'t there');
  /* Moving from chip to chip stays in the box; leaving it empty sends it back behind its chip. */
  const chip = app.doc.activeElement;
  app.fire('focusout', { target: chip }); await app.tick(20);
  assert.ok(boxes(formOf(app)).includes('require'), 'focus still inside: kept');
  app.doc.activeElement = app.doc.body; app.fire('focusout', { target: chip }); await app.tick(20);
  enter(app, 'ob-fld-job', 'release/other'); await app.tick();
  assert.ok(!boxes(formOf(app)).includes('require') && chips(formOf(app)).includes('require=+ What must be recorded'), 'left empty: behind its chip');
  app.click('ob-sel', 'c'); await app.tick();
  const sets = h => [...h.matchAll(/data-act="ob-sets" data-id="([\w-]+)" aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)].map(m => [m[1], m[2] === 'true', /Not one of this checklist/.test(m[3])]);
  assert.deepStrictEqual(sets(formOf(app)), [['tag', true, false], ['environment', false, false], ['nope', true, true]], 'the run details as toggles; an unknown name marked');
  assert.ok(/data-bad="1" data-act="ob-sets" data-id="nope"/.test(formOf(app)));
  app.click('ob-sets', 'environment'); await app.tick();
  assert.strictEqual(app.activeId(), '[data-act="ob-sets"][data-id="environment"]', 'focus stays on a toggled chip');
  app.click('ob-sets', 'nope', { bad: '1' }); await app.tick();
  assert.strictEqual(app.activeId(), '[data-act="ob-sets"][data-id="tag"]', 'focus to the group\'s first chip');
  assert.ok(/sets: tag, environment\n/.test(await textOf(app)), 'written in order, the marked name gone');
  app.click('ob-sets', 'tag'); await app.tick(); app.click('ob-sets', 'environment'); await app.tick();
  assert.ok(!/sets:/.test(await textOf(app)), 'all off: the line is gone');
});

rule('Editor: Sets a run detail with no run details listed says so, and "+ add" focuses the group', async () => {
  const app = await editorOn(HEAD.replace('context: tag, environment\n', '') + '## Build · READ-DO {#build}\n' + step('confirm', 'c') + '\n', 'c', { replace: true, domFocus: true });
  app.click('ob-show', 'sets'); await app.tick();
  assert.ok(/The checklist lists no run details yet\./.test(formOf(app)));
  assert.strictEqual(app.activeId(), 'ob-fld-sets');
});

rule('Editor: Where? counts the checklist\'s pull request steps, not their notes', async () => {
  const text = md(step('github.pr', 'g', 'action: open', 'repo: api'), step('confirm', 'c', 'note: Not {bitbucket.pr}, not {bitbucket.pr}, never {bitbucket.pr}.'));
  assert.strictEqual(PF.views.obPrHost(text), 'github.pr');
  const app = await editorOn(text, 'g');
  app.click('ob-part', 'type:pr'); await app.tick(); app.click('ob-place-at', 'end:build:-1'); await app.tick();
  assert.ok(/- \[ \] \{github\.pr\} Pull request/.test(await textOf(app)), 'GitHub: the only pull request step');
});

rule('Editor: the add forms ask too: a new step\'s and a new phase\'s question, example and why; a new phase\'s mode is buttons, applied with it', async () => {
  const app = await editorOn(md(step('confirm', 'c')), null, { replace: true, domFocus: true });
  app.click('ob-add', 'build', { track: '-1' }); await app.tick();
  let h = app.html();
  assert.strictEqual(labelOf(h, 'ob-new-text'), 'New step: ' + G.step('text').q);
  assert.ok(new RegExp('placeholder="' + G.step('text').eg + '"').test(tagOf(h, 'ob-new-text')) && /aria-describedby="why-ob-new-text"/.test(tagOf(h, 'ob-new-text')), tagOf(h, 'ob-new-text'));
  assert.strictEqual(whyOf(h, 'ob-new-text'), G.step('text').why);
  app.click('ob-add-cancel'); await app.tick();
  app.click('ob-add-phase', 'build'); await app.tick();
  h = app.html();
  assert.strictEqual(labelOf(h, 'ob-new-title'), 'New phase: ' + G.form('ph-title').q);
  assert.strictEqual(whyOf(h, 'ob-new-title'), G.form('ph-title').why);
  assert.ok(!/<select id="ob-new-mode"/.test(h), 'no select');
  assert.deepStrictEqual(choiceRow(h, 'ob-new-mode').map(r => [r[0], r[1], r[3]]), [['READ-DO', true, 'Read, then do'], ['DO-CONFIRM', false, 'Do, then confirm']]);
  app.set('ob-new-title', 'Watch'); app.input('ob-new-title', 'Watch');
  choose(app, 'ob-new-mode', 'DO-CONFIRM'); await app.tick();
  assert.strictEqual(app.activeId(), 'ob-new-mode', 'focus on the checked button');
  assert.strictEqual(app.draft('ob-new-title'), 'Watch', 'the name typed is kept');
  assert.ok(!/## Watch/.test(app.fs.files['maps/drafts/release.md'].t), 'nothing written yet');
  app.click('ob-add-go'); await app.tick();
  assert.ok(/## Watch · DO-CONFIRM/.test(await textOf(app)), 'applied with the phase');
});

rule('Editor: Space and Enter on a choice button are left to the browser, whose click chooses it once (one Undo step, focus on it); Not set clears an optional value and keeps its buttons, focused, until focus leaves', async () => {
  const app = await editorOn(md(step('confirm', 'c', 'evidence: note')), 'c', { replace: true, domFocus: true });
  /* A key on a drawn choice button; true when the app let the browser's default (the button's click) happen. */
  const press = (key, val) => {
    let prevented = false;
    const node = { tagName: 'BUTTON', id: '', dataset: { act: 'ob-choice', id: 'ob-fld-evidence', val }, closest: sel => (/data-act/.test(sel) ? node : null) };
    app.keyOn(key, { preventDefault() { prevented = true; } }, node);
    return !prevented;
  };
  for (const [key, val] of [[' ', 'link'], ['Enter', 'date']]) {
    const checked = () => choiceRow(formOf(app), 'ob-fld-evidence').filter(r => r[1]).map(r => r[0]), before = checked();
    assert.strictEqual(press(key, val), true, JSON.stringify(key) + ': not canceled');
    await app.tick();
    assert.deepStrictEqual(checked(), before, JSON.stringify(key) + ': the key itself chooses nothing, in the editor or the file');
    app.click('ob-choice', 'ob-fld-evidence', { val }); await app.tick();
    assert.strictEqual(app.activeId(), 'ob-fld-evidence', JSON.stringify(key) + ': focus on the chosen button');
    assert.ok(new RegExp('evidence: ' + val).test(await textOf(app)), JSON.stringify(key) + ': chosen');
  }
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/evidence: link/.test(await textOf(app)), 'one Undo step takes back one choice');
  app.click('ob-sel', 'c'); await app.tick();
  choose(app, 'ob-fld-evidence', ''); await app.tick();
  assert.strictEqual(app.activeId(), 'ob-fld-evidence', 'focus on Not set, which carries the control');
  assert.ok(boxes(formOf(app)).includes('evidence') && choiceRow(formOf(app), 'ob-fld-evidence')[0][1], 'still shown, Not set checked');
  app.doc.activeElement = app.doc.body; app.fire('focusout', { target: { id: 'ob-fld-evidence', tagName: 'BUTTON' } }); await app.tick(20);
  /* Redrawn by another change, not by selecting the step again (which forgets reveals itself). */
  app.click('ob-show', 'link'); await app.tick();
  assert.ok(!boxes(formOf(app)).includes('evidence') && chips(formOf(app)).some(c => /^evidence=/.test(c)), 'gone once focus left');
  assert.ok(!/evidence:/.test(await textOf(app)), 'cleared');
});

rule('Editor: clearing a value the step doesn\'t use (another action\'s field, an unknown field) keeps its box, focused, until focus leaves', async () => {
  const app = await editorOn(md(step('jira.issue', 'j', 'action: transition', 'issue: PAY-1', 'status: Done', 'project: PAY', 'nope: x')), 'j', { replace: true, domFocus: true });
  for (const n of ['project', 'nope']) {
    assert.ok(flagOf(formOf(app), 'ob-fld-' + n), n + ': flagged');
    app.fire('focusin', { target: { id: 'ob-fld-' + n } });
    enter(app, 'ob-fld-' + n, ''); await app.tick();
    assert.strictEqual(app.activeId(), 'ob-fld-' + n, n + ': focus stays on its box');
    assert.ok(boxes(formOf(app)).includes(n), n + ': still shown');
    assert.ok(!new RegExp('\n  ' + n + ':').test(await textOf(app)), n + ': the value is gone');
    app.doc.activeElement = app.doc.body; app.fire('focusout', { target: { id: 'ob-fld-' + n, value: '' } }); await app.tick(20);
    enter(app, 'ob-fld-issue', 'PAY-2'); await app.tick();
    assert.ok(!boxes(formOf(app)).includes(n), n + ': gone once focus left');
  }
});

rule('Editor: what was revealed is forgotten on leaving the checklist, and coming back', async () => {
  const app = await editorOn(md(step('jenkins.job', 'b', 'job: release/build-and-test')), 'b', { replace: true, domFocus: true });
  app.click('ob-show', 'stage'); await app.tick();
  assert.ok(boxes(formOf(app)).includes('stage'));
  app.click('nav', 'processes'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  /* The step is still selected (selecting it again would forget reveals by itself). */
  assert.ok(boxes(formOf(app)).includes('job'), 'back on the step\'s form');
  assert.ok(!boxes(formOf(app)).includes('stage') && chips(formOf(app)).includes('stage=+ Watch for'), 'behind its chip again');
});

rule('Editor: phase mode waits while a box holds typing: the checked mode stays, and focus goes to that box', async () => {
  const app = await editorOn(md(step('confirm', 'c')), null, { replace: true, domFocus: true });
  app.click('ob-sel-phase', 'build'); await app.tick();
  app.set('ob-ph-title', 'Typed'); app.input('ob-ph-title', 'Typed');
  choose(app, 'ob-ph-mode', 'DO-CONFIRM'); await app.tick();
  assert.ok(/Apply or clear what you typed in the box first/.test(app.html()), 'waits');
  assert.ok(/## Build · READ-DO/.test(app.fs.files['maps/drafts/release.md'].t), 'unchanged');
  assert.deepStrictEqual(choiceRow(formOf(app), 'ob-ph-mode').filter(r => r[1]).map(r => r[0]), ['READ-DO'], 'the checked one stays');
  assert.strictEqual(app.activeId(), 'ob-ph-title', 'focus goes to the typing it waits on, as every waiting change does');
  assert.strictEqual(app.draft('ob-ph-title'), 'Typed', 'the typing is kept');
});

rule('Editor round trips: for every built-in type and each of its actions, revealing and filling every field, pin and common field through the editor writes what writing it by hand does; the definitions in the app stay 2.4.0\'s', async () => {
  const was = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'entry-boxes', 'types-2.4.0.json'), 'utf8'));
  const plain = x => JSON.parse(JSON.stringify(x));
  for (const t of PF.types.LIST) {
    const pins = Object.keys(T.PINS[t.id] || {}), choice = Object.keys(t.fields || {}).find(n => t.fields[n].kind === 'choice');
    for (const v of choice ? t.fields[choice].options : [null]) {
      const app = await editorOn(md(step(t.id, 's')), 's', { replace: true, domFocus: true }), want = {}, label = t.id + (v ? ' · ' + v : '');
      const fill = async (n, val) => { if (!boxes(formOf(app)).includes(n)) { app.click('ob-show', n); await app.tick(); } enter(app, 'ob-fld-' + n, val); await app.tick(); want[n] = val; };
      if (v) { choose(app, 'ob-fld-' + choice, v); await app.tick(); want[choice] = v; }
      for (const n of Object.keys(t.fields || {}).filter(n => n !== choice).concat(pins)) {
        if (!T.applies(t, n, want)) continue;
        const d = T.fieldDef(t, n) || {};
        if (d.kind === 'choice') { const o = d.options[0]; choose(app, 'ob-fld-' + n, o); await app.tick(); want[n] = o; continue; }
        await fill(n, String(G.field(t, n, want).eg || (d.kind === 'pin' ? '1' : 'x')));
      }
      for (const n of ['link', 'expect', 'deadline', 'at', 'due', 'after']) await fill(n, String(G.COMMON[n].eg));
      if (!boxes(formOf(app)).includes('evidence')) { app.click('ob-show', 'evidence'); await app.tick(); }
      assert.ok(choiceRow(formOf(app), 'ob-fld-evidence').length, label + ': Ask for proof drawn');
      choose(app, 'ob-fld-evidence', 'note'); await app.tick(); want.evidence = 'note';
      if (!boxes(formOf(app)).includes('require')) { app.click('ob-show', 'require'); await app.tick(); }
      app.click('ob-req', 'all'); await app.tick(); want.require = 'all';
      if (!boxes(formOf(app)).includes('sets')) { app.click('ob-show', 'sets'); await app.tick(); }
      app.click('ob-sets', 'environment'); await app.tick(); want.sets = 'environment';
      const got = await textOf(app), hand = md(step(t.id, 's', ...Object.keys(want).map(k => k + ': ' + want[k])));
      assert.strictEqual(got, hand, label);
      assert.deepStrictEqual(plain(app.PF.types.LIST), was.LIST, label + ': T.LIST unchanged in the app');
      assert.deepStrictEqual(plain(app.PF.types.COMMON), was.COMMON, label + ': T.COMMON');
      assert.deepStrictEqual(plain(app.PF.types.PINS), was.PINS, label + ': pins');
    }
  }
});

run();
