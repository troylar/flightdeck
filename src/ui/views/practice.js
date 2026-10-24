/* Practice (2.2, docs/design.md section 34): a tab beside the draft editor that runs what's on screen, in this browser only.
   Its own markup, never the run workspace's: no notes, corrections, child-run controls or timers. The model comes from
   ctx.practice(p, text) (app.js), which follows PF.practice. */
(function () {
  'use strict';
  var V = PF.views, U = PF.util, I = PF.icons.icon, esc = U.esc;
  var SAY = { again: 'Changed since you checked it. Try it again.', waiting: '', hidden: '' };

  function stepRow(s, x, sel) {
    var on = s.status === 'done', na = s.status === 'skipped', off = s.status === 'hidden' || x.paused, cls = 'pr-st st-' + s.status + (sel === s.id ? ' sel' : '');
    var mark = x.refusal && x.refusal.at === s.id ? '<span class="pr-why err" role="alert">' + esc(x.refusal.msg) + '</span>'
      : s.status === 'again' ? '<span class="pr-why">' + SAY.again + (s.old ? ' <span class="pr-old">(it was ' + (s.old === 'na' ? 'not needed' : 'done') + ')</span>' : '') + '</span>'
      : s.status === 'hidden' ? '<span class="pr-why">Hidden: ' + esc(hiddenWhy(s.why)) + '</span>'
      : s.status === 'waiting' ? '<span class="pr-why">' + esc(s.why) + '</span>'
      : s.simulated === 'evidence' ? '<span class="pr-why sim">Evidence isn\'t checked in practice.</span>'
      : s.simulated === 'linked' ? '<span class="pr-why sim">Simulated: practice doesn\'t start other runs.</span>' : '';
    var check = s.status === 'hidden' ? '' : '<button type="button" class="pr-check' + (on ? ' on' : '') + '" data-act="pr-check" data-id="' + esc(s.id) + '" aria-pressed="' + on + '"' + (off ? ' disabled' : '') +
      ' aria-label="' + (on ? 'Done: ' : s.simulated === 'linked' ? 'Mark done for practice: ' : 'Check: ') + esc(s.text) + '">' + I('check') + '</button>';
    var skip = s.status === 'hidden' || s.must ? '' : '<button type="button" class="mini pr-na" data-act="pr-na" data-id="' + esc(s.id) + '" aria-pressed="' + na + '"' + (off ? ' disabled' : '') + '>Not needed</button>';
    return '<li class="' + cls + '" data-pr-step="' + esc(s.id) + '">' + check +
      '<button type="button" class="pr-text linkish" data-act="pr-goto" data-id="' + esc(s.id) + '"' + (s.temp ? ' title="Give this step an ID to keep its answer while you edit."' : '') + '>' + U.mdInline(s.text) + (s.must ? ' <span class="pill must">must</span>' : '') + '</button>' +
      skip + mark + '</li>';
  }
  function hiddenWhy(why) {
    var m = /^only when (.*) \(([\w-]+) is not set\)$/.exec(why || '');
    return m ? m[2] + ' isn\'t set. Give ' + m[2] + ' a sample to see it.' : why || 'not needed with these samples.';
  }
  function gateRow(ph, pi, x) {
    var g = ph.gate, st = g.status, off = x.paused;
    if (st === 'skipped') return '<div class="pr-gate st-skipped">' + esc(ph.title) + ' isn\'t needed with these samples.</div>';
    var word = { passed: 'Passed', waived: 'Waived', review: 'Changed since you passed it. Pass it again.', ready: 'Ready to pass', open: 'Not ready yet', locked: 'After the gate before it', failed: 'Failed' }[st] || st;
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
    if (x.details.length) h += '<details class="pr-sample" data-disc="pr-sample"' + (!ctx.state.disc || ctx.state.disc['pr-sample'] !== false ? ' open' : '') + '><summary>Sample details</summary><div class="pr-fields">' + x.details.map(function (d) {
      var se = x.sampleErr && Object.prototype.hasOwnProperty.call(x.sampleErr, d.name) ? x.sampleErr[d.name] : null, err = se ? se.msg : '';
      return '<label class="field" for="pr-s-' + esc(d.name) + '">' + esc(d.name) + (d.hint ? ' <span class="small">' + esc(d.hint) + '</span>' : '') + '<input id="pr-s-' + esc(d.name) + '" data-pr-sample="' + esc(d.name) + '" value="' + esc(x.typed && Object.prototype.hasOwnProperty.call(x.typed, d.name) ? x.typed[d.name] : se ? se.value : d.value) + '" data-bound data-draft-kept maxlength="120"' + (err ? ' aria-invalid="true" aria-describedby="pr-s-e-' + esc(d.name) + '"' : '') + '></label>' + (err ? '<span class="err small" id="pr-s-e-' + esc(d.name) + '">' + esc(err) + '</span>' : '');
    }).join('') + '</div></details>';
    if (x.gone.length) h += '<p class="small pr-gone">Removed from the draft: ' + x.gone.map(esc).join(', ') + '</p>';
    if (m.complete) h += '<div class="notice good pr-done"><span>You got through the whole checklist.' + (x.dirty ? ' Save it, then stage it for a test run.' : '') + '</span>' +
      (x.dirty ? '<button type="button" class="btn" data-act="save-draft" data-id="' + esc(p.id) + '">Save draft</button>' : '<button type="button" class="btn" data-act="pr-stage">Stage it for a test run</button>') + '</div>';
    else if (m.nextUp.text) h += '<p class="pr-next"><b>Next up:</b> ' + esc(m.nextUp.text) + '</p>';
    h += m.phases.map(function (ph, pi) {
      return '<section class="pr-ph" aria-label="' + esc(ph.title) + '"><h3 class="pr-ph-t' + (sel === 'ph:' + ph.id ? ' sel' : '') + '" tabindex="-1" id="pr-ph-' + pi + '">' + esc(ph.title) + (ph.info.total ? ' <span class="small">' + ph.info.done + ' of ' + ph.info.total + '</span>' : '') + '</h3>' +
        (ph.steps.length ? '<ol class="pr-steps">' + ph.steps.map(function (s) { return stepRow(s, x, sel); }).join('') + '</ol>' : '<p class="small">No steps yet.</p>') + gateRow(ph, pi, x) + '</section>';
    }).join('');
    h += '<div class="pr-foot"><span class="small" role="status">Draft: ' + esc(x.saveState) + '</span>' +
      '<label class="field" for="pr-found">Things to fix <span class="small">' + x.found.length + ' of ' + PF.practice.FOUND_MAX + '</span><textarea id="pr-found" data-draft-kept rows="3" maxlength="' + PF.practice.FOUND_MAX + '" placeholder="What you noticed while practicing">' + esc(x.found) + '</textarea></label>' +
      '<button type="button" class="mini" data-act="pr-copy"' + (x.found ? '' : ' disabled') + '>' + I('copy') + 'Copy what I found</button><span class="small" id="pr-copy-msg" role="status"></span></div>';
    return h + '</div>';
  }
  V.practicePane = practicePane;
})();
