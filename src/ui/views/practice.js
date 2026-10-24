/* Practice (2.2, docs/design.md section 34): a tab beside the draft editor that runs what's on screen, in this browser only.
   Its own markup, never the run workspace's: no notes, corrections, child-run controls or timers. The model comes from
   ctx.practice(p, text) (app.js), which follows PF.practice. */
(function () {
  'use strict';
  var V = PF.views, U = PF.util, I = PF.icons.icon, esc = U.esc;

  function againWhy(s) {
    if (s.again && s.again.reason === 'setter') return '^' + s.again.detail + ' came from a step to try again.';
    return s.old === 'na' ? 'Changed since you marked it not needed. Look at it again.' : 'Changed since you checked it. Try it again.';
  }

  function stepRow(s, x, sel) {
    var on = s.status === 'done', na = s.status === 'skipped', off = s.status === 'hidden' || x.paused, cls = 'pr-st st-' + s.status + (sel === s.id ? ' sel' : '');
    var mark = x.refusal && x.refusal.at === s.id ? '<span class="pr-why err" role="alert">' + esc(x.refusal.msg) + '</span>'
      : s.status === 'again' ? '<span class="pr-why">' + esc(againWhy(s)) + '</span>'
      : s.status === 'hidden' ? '<span class="pr-why">Hidden: ' + esc(hiddenWhy(s.why)) + '</span>'
      : s.status === 'waiting' ? '<span class="pr-why">' + esc(s.why) + '</span>'
      : s.skipped ? '<span class="pr-why sim">Checked without evidence.</span>'
      : s.simulated === 'linked' ? '<span class="pr-why sim">Simulated: practice doesn\'t start other runs.</span>' : '';
    var check = s.status === 'hidden' ? '' : '<button type="button" class="pr-check' + (on ? ' on' : '') + '" data-act="pr-check" data-id="' + esc(s.id) + '" aria-pressed="' + on + '"' + (off ? ' disabled' : '') +
      ' aria-label="' + (on ? 'Done: ' : s.simulated === 'linked' ? 'Mark done for practice: ' : s.ask ? 'Check (asks for evidence): ' : 'Check: ') + esc(s.text) + '"' + (s.ask && !on ? ' aria-haspopup="true"' : '') + '>' + I('check') + '</button>';
    var skip = s.status === 'hidden' || s.must || on ? '' : '<button type="button" class="mini pr-na" data-act="pr-na" data-id="' + esc(s.id) + '" aria-pressed="' + na + '"' + (off ? ' disabled' : '') + '>Not needed</button>';
    return '<li class="' + cls + '" data-pr-step="' + esc(s.id) + '">' + check +
      '<button type="button" class="pr-text linkish" data-act="pr-sel" data-id="' + esc(s.id) + '"' + (s.temp ? ' title="Give this step an ID to keep its answer while you edit."' : '') + '>' + U.mdInline(s.text) + (s.must ? ' <span class="pill must">must</span>' : '') + '</button>' +
      skip + mark + '</li>' + (sel === s.id && s.status !== 'hidden' ? more(s, x) : '');
  }
  /* The selected row's extra line: Fill in, Run from here and Edit (in the builder), or the form open on it. */
  function more(s, x) {
    var f = x.form && x.form.id === s.id ? x.form : null, off = x.paused ? ' disabled' : '', h = '';
    if (!f) {
      if (s.fill) h += '<button type="button" class="mini" data-act="pr-fill" data-id="' + esc(s.id) + '"' + off + '>Fill in</button>';
      if (!(x.model.from && x.model.from.id === s.id)) h += '<button type="button" class="mini" data-act="pr-from" data-id="' + esc(s.id) + '"' + off + '>Run from here</button>';
      if (x.builder && !s.temp) h += '<button type="button" class="mini" data-act="pr-goto" data-id="' + esc(s.id) + '">Edit</button>';
      return h ? '<li class="pr-more">' + h + '</li>' : '';
    }
    return '<li class="pr-more">' + form(f, x) + '</li>';
  }
  function form(f, x) {
    var err = x.formErr || null, shown = false, h = '';
    var eid = function (n) { return err && err.field === n ? 'pr-fe' : ''; };
    var say = function (id) { if (!id || shown) return ''; shown = true; return '<p class="ferr" id="pr-fe" role="alert">' + esc(err.msg) + '</p>'; };
    var head = f.kind === 'ev' ? 'Evidence for practice' : 'Fill in for practice';
    h += '<div class="pr-form" data-pr-form="' + f.kind + '" data-id="' + esc(f.id) + '" role="group" aria-label="' + esc(head + ': ' + f.text) + '">';
    if (f.kind === 'ev') {
      if (f.problem) h += '<p class="small pr-why err" id="pr-fe-p">' + esc(f.problem) + '</p>';
      else h += f.list.map(function (d) { return PF.vk.fieldInput('pr-rec-' + d.name, d, vals(x, d.name, d.value), 'pr-ev-ok', f.id, d.required ? '' : ' (optional)', eid(d.name)) + say(eid(d.name)); }).join('');
    } else {
      h += f.list.map(function (d) { return PF.vk.fieldInput('pr-fld-' + d.name, d.def, vals(x, d.name, d.value), 'pr-fill-ok', f.id, d.value !== d.draft ? ' (draft says: ' + (d.draft || 'nothing') + ')' : '', eid('fld-' + d.name)) + say(eid('fld-' + d.name)); }).join('');
    }
    /* The error sits under its box; one about the whole step (a Jira problem) under the boxes. */
    if (err && !shown) h += '<p class="ferr" id="pr-fe" role="alert">' + esc(err.msg) + '</p>';
    h += '<span class="row">';
    if (f.kind === 'ev') {
      if (!f.problem) h += '<button type="button" class="btn go" data-act="pr-ev-ok" data-id="' + esc(f.id) + '">Check</button>';
      h += '<button type="button" class="mini" data-act="pr-ev-skip" data-id="' + esc(f.id) + '">Check without it</button>';
    } else h += '<button type="button" class="btn go" data-act="pr-fill-ok" data-id="' + esc(f.id) + '">Save</button>';
    return h + '<button type="button" class="mini" data-act="pr-form-close">Cancel</button></span></div>';
  }
  function vals(x, n, v) { return x.formVals && Object.prototype.hasOwnProperty.call(x.formVals, n) ? x.formVals[n] : v; }
  function hiddenWhy(why) {
    var m = /^only when (.*) \(([\w-]+) is not set\)$/.exec(why || '');
    return m ? m[2] + ' isn\'t set. Give ' + m[2] + ' a sample to see it.' : why || 'not needed with these samples.';
  }
  function gateRow(ph, pi, x) {
    var g = ph.gate, st = g.status, off = x.paused;
    if (st === 'skipped') return '<div class="pr-gate st-skipped">' + esc(ph.title) + ' isn\'t needed with these samples.</div>';
    var review = g.rec && g.rec.reason === 'setter' ? '^' + g.rec.detail + ' came from a step to try again.' + (g.canPass ? ' Pass it again.' : '') : g.canPass ? 'Changed since you passed it. Pass it again.' : 'Changed since you passed it. Finish the steps above, then pass it again.';
    var word = { passed: 'Passed', waived: 'Waived', review: review, ready: 'Ready to pass', open: 'Not ready yet', locked: 'After the gate before it', failed: 'Failed' }[st] || st;
    var acts = '';
    if (st === 'passed' || st === 'waived') acts = '<button type="button" class="mini" data-act="pr-gate" data-id="' + pi + '" data-how="reopen"' + (off ? ' disabled' : '') + '>Reopen this phase</button>';
    else {
      if (g.canPass) acts += '<button type="button" class="btn go pr-pass" data-act="pr-gate" data-id="' + pi + '" data-how="pass"' + (off ? ' disabled' : '') + '>' + (g.implicit ? 'Confirm the phase' : 'Pass') + '</button>';
      var bad = x.gateErr && x.gateErr.pi === pi;
      if (g.canWaive && !g.canPass) acts += '<label class="sr" for="pr-why-' + pi + '">Why waive it</label><input id="pr-why-' + pi + '" class="pr-waive-why" placeholder="Why waive it" maxlength="200" data-draft-kept' + (bad ? ' aria-invalid="true" aria-describedby="pr-why-e-' + pi + '"' : '') + '>' + (bad ? '<span class="err small" id="pr-why-e-' + pi + '">' + esc(x.gateErr.msg) + '</span>' : '') + '<button type="button" class="mini" data-act="pr-gate" data-id="' + pi + '" data-how="waive"' + (off ? ' disabled' : '') + '>Waive</button>';
    }
    if (x.refusal && x.refusal.at === 'gate:' + pi) acts += '<span class="err small" role="alert">' + esc(x.refusal.msg) + '</span>';
    return '<div class="pr-gate st-' + st + '"><span class="pr-gate-t">' + (g.implicit ? '' : '<b>' + esc(g.title) + '</b> · ') + esc(word) + (g.approves && st !== 'passed' && st !== 'waived' ? ' <span class="small">' + U.mdInline(g.approves) + '</span>' : '') + '</span>' + acts + '</div>';
  }
  /* The pane: header, what's paused or refused, sample details, the phases with their steps and gates, then the draft's save
     state and Things to fix. */
  function practicePane(ctx, p, text) {
    var x = ctx.practice(p, text);
    if (!x) return '';
    var m = x.model, sel = x.sel;
    var h = '<div class="pr" id="pr" aria-labelledby="pr-h"' + (x.narrow ? ' role="dialog" aria-modal="true"' : '') + '><div class="pr-head"><h2 id="pr-h" class="pr-badge" tabindex="-1">Practice · not recorded</h2><span class="row">' +
      '<button type="button" class="mini" data-act="pr-undo"' + (x.canUndo ? '' : ' disabled') + ' aria-label="Undo in practice' + (x.undoLabel ? ': ' + esc(x.undoLabel) : '') + '">' + I('undo') + '</button>' +
      '<button type="button" class="mini" data-act="pr-redo"' + (x.canRedo ? '' : ' disabled') + ' aria-label="Redo in practice">' + I('redo') + '</button>' +
      '<button type="button" class="mini" data-act="pr-reset"' + (x.hasAnswers ? '' : ' disabled') + '>Reset</button>' +
      '<button type="button" class="mini" data-act="pr-close">Done practicing</button></span></div>';
    if (x.problem) h += '<div class="notice warn pr-note">The draft has a problem: ' + esc(x.problem) + ' Practicing the last version that worked.</div>';
    if (x.note) h += '<div class="notice warn pr-note">' + esc(x.note) + '</div>';
    if (x.refusal && x.refusal.at == null) h += '<div class="notice warn pr-note" role="alert">' + esc(x.refusal.msg) + '</div>';
    if (x.paused) h += '<div class="notice pr-note">' + esc(x.paused) + '</div>';
    if (!m) return h + '<p class="small">Fix the draft to start practicing it.</p></div>';
    h += '<p class="small pr-sub">Nothing here is saved to the team folder. Links and commands you follow still act on real systems.</p>';
    var need = m.from ? m.from.needed : [];
    if (x.details.length) h += '<details class="pr-sample" data-disc="pr-sample"' + (need.length || !ctx.state.disc || ctx.state.disc['pr-sample'] !== false ? ' open' : '') + '><summary>Sample details' + (need.length ? ' <span class="pill warn">' + need.length + ' needed from here</span>' : '') + '</summary><div class="pr-fields">' + x.details.map(function (d) {
      var se = x.sampleErr && Object.prototype.hasOwnProperty.call(x.sampleErr, d.name) ? x.sampleErr[d.name] : null, err = se ? se.msg : '';
      var note = need.indexOf(d.name) >= 0 ? 'Needed from here' : d.setBy ? 'Set by "' + d.setBy + '"' : '';
      return '<label class="field" for="pr-s-' + esc(d.name) + '">' + esc(d.name) + (d.hint ? ' <span class="small">' + esc(d.hint) + '</span>' : '') + (note ? ' <span class="small pr-set">' + esc(note) + '</span>' : '') + '<input id="pr-s-' + esc(d.name) + '" data-pr-sample="' + esc(d.name) + '" value="' + esc(x.typed && Object.prototype.hasOwnProperty.call(x.typed, d.name) ? x.typed[d.name] : se ? se.value : d.value) + '" data-bound data-draft-kept maxlength="120"' + (err ? ' aria-invalid="true" aria-describedby="pr-s-e-' + esc(d.name) + '"' : '') + '></label>' + (err ? '<span class="err small" id="pr-s-e-' + esc(d.name) + '">' + esc(err) + '</span>' : '');
    }).join('') + '</div></details>';
    if (x.gone.length) h += '<p class="small pr-gone">Removed from the draft: ' + x.gone.map(esc).join(', ') + '</p>';
    if (m.from) h += '<p class="small pr-from">' + (m.from.assumed ? m.from.assumed + (m.from.assumed === 1 ? ' earlier step' : ' earlier steps') + ' assumed for practice · ' : 'Practicing from "' + esc(m.from.text) + '" · ') + '<button type="button" class="linkish" data-act="pr-from-clear">Start from the beginning</button></p>';
    if (m.from && m.from.through) h += '<div class="notice good pr-done"><span>You got through from "' + esc(m.from.text) + '".</span><button type="button" class="btn" data-act="pr-from-clear">Start from the beginning</button></div>';
    else if (m.complete) h += '<div class="notice good pr-done"><span>You got through the whole checklist.' + (x.dirty ? ' Save it, then stage it for a test run.' : '') + '</span>' +
      (x.dirty ? '<button type="button" class="btn" data-act="save-draft" data-id="' + esc(p.id) + '">Save draft</button>' : '<button type="button" class="btn" data-act="pr-stage">Stage it for a test run</button>') + '</div>';
    else if (m.nextUp.text) h += '<p class="pr-next"><b>Next up:</b> ' + esc(m.nextUp.text) + '</p>';
    h += m.phases.map(function (ph, pi) {
      if (ph.gate.assumed) return '';
      var shown = ph.steps.filter(function (s) { return s.status !== 'assumed'; });
      ph = Object.assign({}, ph, { steps: shown });
      /* The from step's phase counts only what's practiced from here; assumed steps aren't progress. */
      if (shown.length !== m.phases[pi].steps.length) ph.info = { done: shown.filter(function (s) { return s.status === 'done' || s.status === 'skipped'; }).length, total: shown.filter(function (s) { return s.status !== 'hidden'; }).length, here: true };
      return '<section class="pr-ph" aria-label="' + esc(ph.title) + '"><h3 class="pr-ph-t' + (sel === 'ph:' + ph.id ? ' sel' : '') + '" tabindex="-1" id="pr-ph-' + pi + '">' + esc(ph.title) + (ph.info.total ? ' <span class="small">' + ph.info.done + ' of ' + ph.info.total + (ph.info.here ? ' from here' : '') + '</span>' : '') + '</h3>' +
        (ph.steps.length ? '<ol class="pr-steps">' + ph.steps.map(function (s) { return stepRow(s, x, sel); }).join('') + '</ol>' : '<p class="small">No steps yet.</p>') + gateRow(ph, pi, x) + '</section>';
    }).join('');
    /* Save draft is here too: on a phone the sheet covers the editor's own. */
    h += '<div class="pr-foot"><span class="small" role="status">Draft: ' + esc(x.saveState) + '</span>' + (x.dirty && !(m.complete || (m.from && m.from.through)) ? '<button type="button" class="mini" data-act="save-draft" data-id="' + esc(p.id) + '">Save draft</button>' : '') +
      '<label class="field" for="pr-found">Things to fix <span class="small">' + x.found.length + ' of ' + PF.practice.FOUND_MAX + '</span><textarea id="pr-found" data-draft-kept rows="3" maxlength="' + PF.practice.FOUND_MAX + '" placeholder="What you noticed while practicing">' + esc(x.found) + '</textarea></label>' +
      '<button type="button" class="mini" data-act="pr-copy"' + (x.found ? '' : ' disabled') + '>' + I('copy') + 'Copy what I found</button><span class="small" id="pr-copy-msg" role="status"></span></div>';
    return h + '</div>';
  }
  V.practicePane = practicePane;
})();
