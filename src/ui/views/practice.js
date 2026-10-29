/* Practice (2.3, docs/design.md section 34): the practice run screen's own parts. The checklist, gates, Next up and the
   selected step are the run screen's (views/run.js, given ctx.practice); these are the header, the notices under it, and what
   a step or gate says that a run never needs to. The model comes from ctx.practice (app.js), which follows PF.practice. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, I = PF.icons.icon, esc = U.esc;

  function againWhy(s) {
    if (s.again && s.again.reason === 'setter') return '^' + s.again.detail + ' came from a step to try again.';
    return s.old === 'na' ? 'Changed since you marked it not needed. Look at it again.' : 'Changed since you checked it. Try it again.';
  }
  function hiddenWhy(why) {
    var m = /^only when (.*) \(([\w-]+) is not set\)$/.exec(why || '');
    return m ? m[2] + ' isn\'t set. Give ' + m[2] + ' a sample to see it.' : why || 'not needed with these samples.';
  }
  /* Typing kept for a step whose boxes changed or went away: what it was, with Copy and Discard. Never put in another box. */
  function keptHtml(k) {
    return '<div class="notice pr-kept" role="group" aria-label="' + esc('What you typed for: ' + k.text) + '"><span>You typed this before the step changed: ' + k.values.map(function (v) { return '<b>' + esc(v.name) + '</b> ' + esc(v.value); }).join(' · ') + '</span>' +
      '<span class="row"><button type="button" class="mini" data-act="pr-kept-copy" data-id="' + esc(k.id) + '">' + I('copy') + 'Copy</button><button type="button" class="mini" data-act="pr-kept-drop" data-id="' + esc(k.id) + '">Discard</button></span></div>';
  }
  /* What the selected step says in practice, above What to do. */
  V.prStepNote = function (P, id) {
    var s = P.steps[id] || {}, h = '';
    if (P.refusal && P.refusal.at === id) h += '<div class="notice warn pr-why" role="alert"><span>' + esc(P.refusal.msg) + '</span></div>';
    if (s.status === 'again') h += '<div class="notice warn pr-why"><span><b>Try it again:</b> ' + esc(againWhy(s)) + '</span></div>';
    else if (s.status === 'hidden') h += '<div class="notice pr-why"><span>Hidden: ' + esc(hiddenWhy(s.why)) + '</span></div>';
    else if (s.status === 'waiting') h += '<div class="notice pr-why"><span>' + esc(s.why) + '</span></div>';
    else if (s.status === 'assumed') h += '<div class="notice pr-why"><span>Assumed while you practice from a later step.</span><button type="button" class="mini" data-act="pr-from-clear">Start from the beginning</button></div>';
    else if (s.skipped) h += '<p class="small pr-why">Checked without evidence.</p>';
    if (s.temp) h += '<p class="small pr-why">Give this step an ID to keep its answer while you edit.</p>';
    if (P.kept[id]) h += keptHtml(P.kept[id]);
    return h;
  };
  /* What a gate says in practice: why it needs passing again, a refusal, or a waiver without its reason. */
  V.prGateNote = function (P, gid, pi) {
    var g = P.gates[gid] || {}, h = '';
    if (g.status === 'review') h += '<div class="small pr-why">' + esc(g.rec && g.rec.reason === 'setter' ? '^' + g.rec.detail + ' came from a step to try again.' + (g.canPass ? ' Pass it again.' : '') : g.canPass ? 'Changed since you passed it. Pass it again.' : 'Changed since you passed it. Finish the steps above, then pass it again.') + '</div>';
    if (P.refusal && P.refusal.at === 'gate:' + pi) h += '<div class="err small" role="alert">' + esc(P.refusal.msg) + '</div>';
    if (P.gateErr && P.gateErr.pi === pi) h += '<div class="err small" id="pr-why-e-' + pi + '" role="alert">' + esc(P.gateErr.msg) + '</div>';
    return h;
  };

  /* The header: the way back to the draft, Practice · not recorded, how far, and practice's own tools. */
  V.practiceHead = function (ctx, P, t, pct) {
    var s = ctx.state;
    var h = '<header class="fpe-head rw-head pr-head" role="region" aria-labelledby="run-h"><div class="fpe-id">' +
      '<button type="button" class="btn rw-back" data-act="pr-back">' + I('back') + 'Back to the draft</button>' +
      '<div class="fpe-title"><h1 id="run-h" tabindex="-1">' + esc(P.title) + '</h1><span class="small rw-sub"><span class="pr-badge">Practice · not recorded</span> · Draft: ' + esc(P.saveState) + '</span></div></div>' +
      '<div class="rw-prog"><span class="rw-bar" role="progressbar" aria-label="Steps answered" aria-valuemin="0" aria-valuemax="' + t.total + '" aria-valuenow="' + t.done + '" aria-valuetext="' + t.done + ' of ' + t.total + ' steps answered"><i style="width:' + pct + '%"></i></span><b>' + t.done + '/' + t.total + '</b><span class="small">answered</span></div>' +
      '<div class="rw-tools">' +
      '<button type="button" class="mini" data-act="pr-undo"' + (P.canUndo ? '' : ' disabled') + ' aria-label="Undo in practice' + (P.undoLabel ? ': ' + esc(P.undoLabel) : '') + '">' + I('undo') + 'Undo</button>' +
      '<button type="button" class="mini" data-act="pr-redo"' + (P.canRedo ? '' : ' disabled') + ' aria-label="Redo in practice">' + I('redo') + 'Redo</button>' +
      '<button type="button" class="mini" data-act="pr-reset"' + (P.hasAnswers ? '' : ' disabled') + '>Reset</button>' +
      (P.details.length ? '<button type="button" class="mini" data-act="pr-samples" aria-expanded="' + !!s.prSamples + '" aria-controls="pr-sample">Sample details</button>' : '') +
      '<button type="button" class="mini" data-act="pr-found-open" aria-expanded="' + !!s.prFound + '" aria-controls="pr-found-box">Things to fix' + (P.found ? ' ·' : '') + '</button>' +
      (P.dirty ? '<button type="button" class="mini" data-act="pr-save"' + (P.saving ? ' disabled' : '') + '>' + (P.saving ? 'Saving…' : 'Save draft') + '</button>' : '') +
      '<button type="button" class="btn" data-act="pr-close">Done practicing</button></div></header>';
    return h + '<div class="rw-strip pr-strip" data-k="practice" role="region" aria-label="Practice"><div class="rw-who"><span class="rw-say">Nothing here is saved to the team folder. Links and commands you follow still act on real systems.</span></div></div>';
  };

  /* One line at the end: what changed, and Stage it for a test run. */
  function stageLine(P) {
    return '<span class="row pr-stage"><label class="sr" for="pr-note">What changed</label><input id="pr-note" maxlength="200" placeholder="What changed" value="' + esc(P.stageNote) + '" data-enter="pr-stage"' + (P.noteErr ? ' aria-invalid="true" aria-describedby="ferr-pr-note"' : '') + '>' +
      '<button type="button" class="btn" data-act="pr-stage"' + (P.staging ? ' disabled' : '') + '>Stage it for a test run</button></span>' + (P.noteErr ? '<p class="ferr" id="ferr-pr-note" role="alert">' + esc(P.noteErr) + '</p>' : '');
  }
  /* Under the header: messages, what's paused or refused, what changed while away, the end, sample details and Things to fix. */
  V.practiceAlerts = function (ctx, P) {
    var s = ctx.state, m = P.model, h = '';
    if (s.msg && !s.msg.quiet) h += '<div class="notice ' + (s.msg.kind || '') + '" role="status"><span>' + esc(s.msg.text) + '</span><span class="row">' + (s.msg.act ? '<button class="btn" data-act="' + esc(s.msg.act) + '">' + esc(s.msg.label) + '</button>' : '') + '<button class="mini" data-act="dismiss">Dismiss</button></span></div>';
    if (P.saveErr) h += '<div class="notice bad" role="alert"><span>' + esc(P.saveErr.msg) + '</span>' + (P.saveErr.conflict ? '<button type="button" class="btn" data-act="pr-back" data-id="compare">Compare in the editor</button>' : '<button type="button" class="btn" data-act="pr-save">Try saving again</button>') + '</div>';
    if (P.incoming) h += '<div class="notice warn" role="status"><span>' + esc(P.incoming) + '</span><button type="button" class="btn" data-act="pr-back">Back to the draft</button></div>';
    if (P.problem) h += '<div class="notice warn pr-note"><span>The draft has a problem: ' + esc(P.problem) + ' Practicing the last version that worked.</span><button type="button" class="btn" data-act="pr-back">Back to the draft to fix it</button></div>';
    if (P.note) h += '<div class="notice warn pr-note"><span>' + esc(P.note) + '</span></div>';
    if (P.refusal && P.refusal.at == null) h += '<div class="notice warn pr-note" role="alert"><span>' + esc(P.refusal.msg) + '</span></div>';
    if (P.paused) h += '<div class="notice pr-note"><span>' + esc(P.paused) + '</span></div>';
    if (P.gone.length) h += '<div class="notice pr-gone"><span>Removed from the draft: ' + K.capJoin(P.gone, function (g) { return esc(g.text || g.id); }) + '</span></div>' + P.gone.filter(function (g) { return g.kept; }).map(function (g) { return keptHtml(g.kept); }).join('');
    if (!m) return h + '<p class="small">Fix the draft to start practicing it.</p>';
    var need = m.from ? m.from.needed : [];
    if (m.from) h += '<p class="small pr-from">' + (m.from.assumed ? m.from.assumed + (m.from.assumed === 1 ? ' earlier step' : ' earlier steps') + ' assumed for practice · ' : 'Practicing from "' + esc(m.from.shown || m.from.text) + '" · ') + '<button type="button" class="linkish" data-act="pr-from-clear">Start from the beginning</button></p>';
    if (m.from && m.from.through) h += '<div class="notice good pr-done" tabindex="-1"><span>You got through from "' + esc(m.from.shown || m.from.text) + '".</span><button type="button" class="btn" data-act="pr-from-clear">Start from the beginning</button></div>';
    else if (m.complete) h += '<div class="notice good pr-done" tabindex="-1"><span>You got through the whole checklist.' + (P.dirty ? ' Save it, then stage it for a test run.' : '') + '</span>' +
      (P.dirty ? '<button type="button" class="btn" data-act="pr-save"' + (P.saving ? ' disabled' : '') + '>Save draft</button>' : stageLine(P)) + '</div>';
    if (P.details.length && (s.prSamples || need.length)) h += '<section class="rw-details pr-sample" id="pr-sample" aria-labelledby="pr-sample-h"><h2 id="pr-sample-h" class="rw-h2" tabindex="-1">Sample details' + (need.length ? ' <span class="pill warn">' + need.length + ' needed from here</span>' : '') + '</h2><p class="small">Values to practice with, as a run would have them. Used only here.</p><div class="pr-fields">' + P.details.map(function (d) {
      var se = P.sampleErr && Object.prototype.hasOwnProperty.call(P.sampleErr, d.name) ? P.sampleErr[d.name] : null, err = se ? se.msg : '';
      var note = need.indexOf(d.name) >= 0 ? 'Needed from here' : d.setBy ? 'Set by "' + d.setBy + '"' : '';
      return '<label class="field" for="pr-s-' + esc(d.name) + '">' + esc(d.name) + (d.hint ? ' <span class="small">' + esc(d.hint) + '</span>' : '') + (note ? ' <span class="small pr-set">' + esc(note) + '</span>' : '') + '<input id="pr-s-' + esc(d.name) + '" data-pr-sample="' + esc(d.name) + '" value="' + esc(P.typed && Object.prototype.hasOwnProperty.call(P.typed, d.name) ? P.typed[d.name] : se ? se.value : d.value) + '" data-bound data-draft-kept maxlength="120"' + (err ? ' aria-invalid="true" aria-describedby="pr-s-e-' + esc(d.name) + '"' : '') + '></label>' + (err ? '<span class="err small" id="pr-s-e-' + esc(d.name) + '">' + esc(err) + '</span>' : '');
    }).join('') + '</div></section>';
    if (s.prFound) h += '<section class="rw-details pr-foot" id="pr-found-box" aria-labelledby="pr-found-h"><h2 id="pr-found-h" class="rw-h2" tabindex="-1">Things to fix</h2>' +
      '<label class="field" for="pr-found">What you noticed while practicing <span class="small">' + P.found.length + ' of ' + PF.practice.FOUND_MAX + '</span><textarea id="pr-found" data-draft-kept rows="3" maxlength="' + PF.practice.FOUND_MAX + '">' + esc(P.found) + '</textarea></label>' +
      '<span class="row"><button type="button" class="mini" data-act="pr-copy"' + (P.found ? '' : ' disabled') + '>' + I('copy') + 'Copy what I found</button><span class="small" id="pr-copy-msg" role="status"></span></span></section>';
    return h;
  };
})();
