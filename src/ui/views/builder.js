/* The outline builder: the draft's phases as cards, its steps as rows and its gates as hazard-striped thresholds, edited by
   buttons, a side form, dragging or Alt+Up / Alt+Down. It shows what PF.outline reads from the Markdown, and every change
   is an operation on that same text (app.js), so the Markdown editor and the builder always agree. */
(function () {
  'use strict';
  var V = PF.views, U = PF.util, T = PF.types, O = PF.outline, M = PF.map, I = PF.icons.icon, esc = U.esc;
  var LAND = 'Cleared to land here · or move with Alt+Up / Alt+Down';
  var MARKS = [[' ', 'Step'], ['!', 'Must-do'], ['~', 'Automation planned']];

  function teamTypes(ctx) { return (ctx.data.stepTypes || {}).types || {}; }
  /* Built-in types, then the team's, as select options; a type the step names that isn't known stays choosable. */
  function typeOptions(ctx, cur) {
    var team = teamTypes(ctx), ids = Object.keys(team).sort(), known = T.LIST.some(function (t) { return t.id === cur; }) || ids.indexOf(cur) >= 0;
    var opt = function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === cur ? ' selected' : '') + '>' + esc(t.label) + ' {' + esc(t.id) + '}</option>'; };
    return (cur && !known ? '<option value="' + esc(cur) + '" selected>{' + esc(cur) + '} (unknown type)</option>' : '') +
      '<optgroup label="Built-in">' + T.LIST.map(opt).join('') + '</optgroup>' + (ids.length ? '<optgroup label="Your team\'s">' + ids.map(function (id) { return opt(team[id]); }).join('') + '</optgroup>' : '');
  }
  /* Rows are buttons, so the step text shows without its Markdown markers rather than as links inside a button. */
  function plain(s) { return String(s || '').replace(/\*\*|__|`/g, ''); }
  function selOf(ctx, p) { var s = ctx.state.obSel; return s && s.pid === p.id ? s : null; }
  function addOf(ctx, p) { var a = ctx.state.obAdd; return a && a.pid === p.id ? a : null; }
  /* A refused value shows its reason next to its field (app.js sets fieldErr { id: 'ob', field }). */
  function errOf(ctx, id) { var e = ctx.state.fieldErr; return e && e.id === 'ob' && e.field === id ? e : null; }
  function errAt(ctx, id) { return errOf(ctx, id) ? ' aria-invalid="true" aria-describedby="ferr-' + esc(id) + '"' : ''; }
  function errMsg(ctx, id) { var e = errOf(ctx, id); return e ? '<p class="ferr" id="ferr-' + esc(id) + '" role="alert">' + esc(e.msg) + '</p>' : ''; }
  /* The form's scope names what it shows and the lines it was drawn from, so a redraw after those lines changed (in this
     window or in the folder) shows the new values instead of carrying over what the old boxes held. */
  function sigOf(o, from, to) { return U.hash(o.lines.slice(from, to).join('\n')); }

  function addStepForm(ctx) {
    return '<li class="ob-addform"><div class="row"><label class="sr" for="ob-new-text">New step: what to do</label><input id="ob-new-text" maxlength="200" placeholder="What to do" data-enter="ob-add-go"' + errAt(ctx, 'ob-new-text') + '>' +
      '<label class="sr" for="ob-new-type">Type of the new step</label><select id="ob-new-type">' + typeOptions(ctx, 'confirm') + '</select>' +
      '<button type="button" class="btn go" data-act="ob-add-go">Add step</button><button type="button" class="mini" data-act="ob-add-cancel">Cancel</button></div>' + errMsg(ctx, 'ob-new-text') + '</li>';
  }
  function stepRow(ctx, p, s, sel) {
    var t = T.get(s.type, teamTypes(ctx)), on = sel && sel.kind === 'step' && sel.key === s.key;
    var meta = (s.must ? ' <span class="badge b-must">Must do</span>' : '') + (s.planned ? ' <span class="badge b-plan">Automation planned</span>' : '') +
      (s.roles.length ? ' <span class="small">@' + esc(s.roles.join(' @')) + '</span>' : '') + s.binds.map(function (b) { return ' <span class="ob-chip">^' + esc(b) + '</span>'; }).join('');
    return '<li class="ob-slot" aria-hidden="true" data-ob-drop="before:' + esc(s.key) + '"><span>' + LAND + '</span></li>' +
      '<li class="ob-step' + (on ? ' sel' : '') + (s.odd ? ' odd' : '') + '" draggable="' + !s.odd + '" data-ob-step="' + esc(s.key) + '"><span class="ob-grip" aria-hidden="true"></span>' +
      '<button type="button" class="ob-pick" data-act="ob-sel" data-id="' + esc(s.key) + '" aria-pressed="' + on + '" aria-describedby="ob-kbd">' + (t ? I(t.icon, t.label) : I('check', 'Unknown type')) +
      '<span class="ob-txt">' + esc(plain(s.text)) + '</span>' + meta + '</button></li>';
  }
  function phaseCard(ctx, o, p, ph, sel, add) {
    var st = ctx.state, on = sel && sel.kind === 'phase' && sel.key === ph.key, h = '';
    var groups = [-1].concat(ph.tracks.map(function (t) { return t.index; }));
    groups.forEach(function (g) {
      var steps = ph.steps.filter(function (s) { return s.track === g; });
      if (g >= 0) { var tr = ph.tracks[g]; h += '<li class="ob-track"><span class="fp-eye">Track</span> <b>' + esc(tr.title || 'Track') + '</b>' + (tr.roles.length ? ' <span class="small">@' + esc(tr.roles.join(' @')) + '</span>' : '') + '</li>'; }
      /* Before the first track, a phase's own group shows only when it has steps or the phase has no tracks. */
      if (g < 0 && !steps.length && ph.tracks.length) return;
      steps.forEach(function (s) {
        h += stepRow(ctx, p, s, sel);
        if (add && add.kind === 'step' && add.after === s.key) h += addStepForm(ctx);
      });
      h += '<li class="ob-slot" aria-hidden="true" data-ob-drop="end:' + esc(ph.key) + ':' + g + '"><span>' + LAND + '</span></li>';
      h += add && add.kind === 'step' && add.after == null && add.phase === ph.key && +add.track === g ? addStepForm(ctx) :
        '<li class="ob-addrow"><button type="button" class="mini" data-act="ob-add" data-id="' + esc(ph.key) + '" data-track="' + g + '">' + I('plus') + 'Add a step' + (g >= 0 ? ' to ' + esc(ph.tracks[g].title || 'this track') : '') + '</button></li>';
    });
    var gt = ph.gate, gate = gt ? '<div class="fp-gate ob-gate"><span class="fp-gate-t">' + I('gate') + 'Gate: ' + esc(gt.title) + '</span>' + (gt.owner ? '<span class="small">owner @' + esc(gt.owner) + '</span>' : '') + (gt.approves ? '<span class="small">approves ' + esc(plain(gt.approves)) + '</span>' : '') +
      '<button type="button" class="mini" data-act="ob-sel-phase" data-id="' + esc(ph.key) + '" data-focus="ob-g-title" aria-label="Edit gate ' + esc(gt.title) + '">Edit gate</button></div>' :
      '<div class="fp-gate implicit ob-gate"><span class="small">Ends with a check that the phase is done.</span><button type="button" class="mini" data-act="ob-sel-phase" data-id="' + esc(ph.key) + '" data-focus="ob-g-title" aria-label="Add a gate to ' + esc(ph.title) + '">' + I('plus') + 'Add a gate</button></div>';
    return '<li class="ob-phase' + (on ? ' sel' : '') + '"><div class="ob-ph-head"><div class="fp-eye">Phase ' + (ph.index + 1) + '</div>' +
      '<h3 class="ob-ph-h"><button type="button" class="ob-ph-name" data-act="ob-sel-phase" data-id="' + esc(ph.key) + '" data-ob-phase="' + esc(ph.key) + '" aria-pressed="' + on + '" aria-describedby="ob-kbd">' + esc(ph.title || 'Untitled phase') + '</button></h3>' +
      (ph.mode ? '<span class="cat">' + esc(ph.mode) + '</span>' : '<span class="cat">No mode</span>') + '</div>' +
      '<ul class="ob-steps" aria-label="Steps in ' + esc(ph.title) + '">' + h + '</ul>' + gate + '</li>';
  }

  /* The builder itself, for the left of the editor. */
  function builder(ctx, p, text, ed) {
    var o = O.parse(text), sel = selOf(ctx, p), add = addOf(ctx, p), map = M.parse(text), h = '';
    if (o.unsupported) return '<div class="notice warn"><span>The builder can\'t edit this draft safely: ' + esc(o.unsupported) + ' Use Markdown instead.</span><button class="mini" data-act="ed-mode" data-id="markdown">Markdown</button></div>';
    if (map.errors.length) h += '<div class="notice warn"><span>' + map.errors.length + ' line' + (map.errors.length === 1 ? ' isn\'t' : 's aren\'t') + ' understood (see Checks). The builder keeps ' + (map.errors.length === 1 ? 'it' : 'them') + ' exactly as written; fix ' + (map.errors.length === 1 ? 'it' : 'them') + ' in Markdown.</span></div>';
    if (o.questions >= 0) h += '<div class="notice warn"><span>It still has a Questions section. Answer the questions in Markdown.</span></div>';
    h += '<p id="ob-kbd" class="small" style="margin:0">Drag a step by its grip, or select it and press Alt+Up or Alt+Down to move it. Select a step, phase or gate to change it.</p>';
    var phaseForm = '<div class="ob-addform row"><label class="sr" for="ob-new-title">New phase name</label><input id="ob-new-title" maxlength="120" placeholder="Phase name" data-enter="ob-add-go"' + errAt(ctx, 'ob-new-title') + '>' +
      '<label class="sr" for="ob-new-mode">How it\'s worked</label><select id="ob-new-mode"><option value="READ-DO">READ-DO</option><option value="DO-CONFIRM">DO-CONFIRM</option></select>' +
      '<button type="button" class="btn go" data-act="ob-add-go">Add phase</button><button type="button" class="mini" data-act="ob-add-cancel">Cancel</button></div>' + errMsg(ctx, 'ob-new-title');
    var addingPhase = add && add.kind === 'phase';
    h += '<ol class="ob-phases" aria-label="Phases">' + o.phases.map(function (ph) { return phaseCard(ctx, o, p, ph, sel, add) + (addingPhase && add.after === ph.key ? '<li>' + phaseForm + '</li>' : ''); }).join('') + '</ol>';
    if (!o.phases.length) h += '<p class="small">No phases yet. Add the first one.</p>';
    h += addingPhase && add.after == null ? phaseForm : '<button type="button" class="mini ob-addphase" data-act="ob-add-phase">' + I('plus') + 'Add a phase</button>';
    return '<div class="ob" id="ob">' + h + '</div>';
  }

  function fieldRow(ctx, def, s, name) {
    var d = T.fieldDef(def, name) || { label: name, kind: 'text' }, v = s.fields[name] || '', id = 'ob-fld-' + name;
    var label = esc(d.label || name) + ' <span class="small"><code>' + esc(name) + '</code>' + (d.required ? ' · usually filled in' : '') + '</span>';
    var opts = d.kind === 'choice' ? T.options(d, s.fields) : [];
    if (opts.length) {
      var list = opts.indexOf(v) < 0 && v ? opts.concat([v]) : opts;
      return '<label class="field" for="' + esc(id) + '">' + label + '<select id="' + esc(id) + '" data-bound' + errAt(ctx, id) + '><option value=""' + (v ? '' : ' selected') + '>Not set</option>' + list.map(function (x) { return '<option value="' + esc(x) + '"' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></label>' + errMsg(ctx, id);
    }
    return '<label class="field" for="' + esc(id) + '">' + label + '<input id="' + esc(id) + '" maxlength="300" data-enter="ob-commit" value="' + esc(v) + '"' + errAt(ctx, id) + '></label>' + errMsg(ctx, id);
  }
  /* The side form for what's selected: a step's text, kind, type, roles, run details and fields; or a phase and its gate.
     Text boxes apply when you leave them (or press Enter); choices apply at once. */
  function builderForm(ctx, p, text) {
    var sel = selOf(ctx, p); if (!sel) return '';
    var o = O.parse(text); if (o.unsupported) return '';
    var meta = M.parse(text).meta;
    if (sel.kind === 'step') {
      var s = o.steps.filter(function (x) { return x.key === sel.key; })[0]; if (!s) return '';
      var h = '<section class="panel stack ob-form" aria-labelledby="ob-form-h" data-scope="ob-step|' + esc(s.key) + '|' + sigOf(o, s.line, s.end) + '"><h2 id="ob-form-h">' + I('edit') + 'Step</h2>';
      if (s.odd) return h + '<p class="small">This step has lines the builder can\'t change safely (a field or note separated from it). Edit it in Markdown.</p></section>';
      var def = T.get(s.type, teamTypes(ctx)), mark = s.must ? '!' : s.planned ? '~' : ' ';
      h += '<label class="field" for="ob-text">What to do<input id="ob-text" maxlength="200" data-enter="ob-commit" value="' + esc(s.text) + '"' + errAt(ctx, 'ob-text') + '></label>' + errMsg(ctx, 'ob-text') +
        '<div class="grid2"><label class="field" for="ob-mark">Kind<select id="ob-mark" data-bound>' + MARKS.map(function (m) { return '<option value="' + (m[0] === ' ' ? 'step' : m[0] === '!' ? 'must' : 'planned') + '"' + (m[0] === mark ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="field" for="ob-type">Type<select id="ob-type" data-bound>' + typeOptions(ctx, s.type) + '</select></label></div>';
      var own = s.parts.roles, roles = meta.roles.concat(own.filter(function (r) { return meta.roles.indexOf(r) < 0; }));
      h += '<div class="field"><span id="ob-roles-l">Who does it</span>' + (roles.length ? '<div class="row" role="group" aria-labelledby="ob-roles-l">' + roles.map(function (r) { return '<button type="button" class="chipbtn" data-act="ob-role" data-id="' + esc(r) + '" aria-pressed="' + (own.indexOf(r) >= 0) + '">@' + esc(r) + '</button>'; }).join('') + '</div>' : '<span class="small">The checklist lists no roles. Add them to "roles:" in Markdown.</span>') +
        (s.track >= 0 && !own.length ? '<span class="small">With no role of its own, it goes to the track\'s people.</span>' : '') + '</div>';
      var binds = s.parts.binds, ctxs = meta.context.concat(binds.filter(function (b) { return meta.context.indexOf(b) < 0; }));
      h += '<div class="field"><span id="ob-binds-l">Tied to run details</span><span class="small">When one of these changes during a run, the step needs a re-check.</span>' + (ctxs.length ? '<div class="row" role="group" aria-labelledby="ob-binds-l">' + ctxs.map(function (b) { return '<button type="button" class="ob-chip" data-act="ob-bind" data-id="' + esc(b) + '" aria-pressed="' + (binds.indexOf(b) >= 0) + '">^' + esc(b) + '</button>'; }).join('') + '</div>' : '<span class="small">The checklist lists no run details ("context:").</span>') + '</div>';
      var names = def ? Object.keys(def.fields || {}) : [];
      Object.keys(s.fields).forEach(function (f) { if (names.indexOf(f) < 0) names.push(f); });
      h += '<h3>Fields</h3>' + (names.length ? names.map(function (f) { return fieldRow(ctx, def, s, f); }).join('') : '<p class="small">This type asks for nothing more.</p>');
      if (s.notes) h += '<p class="small">Its ' + (s.notes === 1 ? 'note line stays' : s.notes + ' note lines stay') + ' as written; edit notes in Markdown.</p>';
      h += '<p class="small">' + (s.id ? 'ID <code>' + esc(s.id) + '</code>. It never changes, so runs and skills keep finding this step.' : 'No ID yet. Add one in Markdown, like {#' + esc(U.slug(s.text, 24)) + '}.') + '</p>';
      h += '<div class="row"><button type="button" class="mini" data-act="ob-move" data-id="' + esc(s.key) + '" data-dir="up">Move up</button><button type="button" class="mini" data-act="ob-move" data-id="' + esc(s.key) + '" data-dir="down">Move down</button>' +
        '<button type="button" class="mini" data-act="ob-add-after" data-id="' + esc(s.key) + '">' + I('plus') + 'Add a step after it</button><button type="button" class="mini" data-act="ob-del" data-id="' + esc(s.key) + '">Delete this step</button>' +
        '<button type="button" class="mini" data-act="hist-open" data-id="draft" data-item="step:' + esc(s.key) + '" aria-haspopup="dialog">' + I('clock') + 'History of this step</button></div>';
      return h + '</section>';
    }
    var ph = o.phases.filter(function (x) { return x.key === sel.key; })[0]; if (!ph) return '';
    var gt = ph.gate, sig = sigOf(o, ph.line, ph.line + 1) + (gt ? '.' + sigOf(o, gt.line, gt.end) : '');
    var f = '<section class="panel stack ob-form" aria-labelledby="ob-form-h" data-scope="ob-phase|' + esc(ph.key) + '|' + sig + '"><h2 id="ob-form-h">' + I('edit') + 'Phase ' + (ph.index + 1) + '</h2>' +
      '<label class="field" for="ob-ph-title">Name<input id="ob-ph-title" maxlength="120" data-enter="ob-commit" value="' + esc(ph.title) + '"' + errAt(ctx, 'ob-ph-title') + '></label>' + errMsg(ctx, 'ob-ph-title') +
      '<label class="field" for="ob-ph-mode">How it\'s worked<select id="ob-ph-mode" data-bound><option value=""' + (ph.mode ? '' : ' selected') + '>Not set</option><option value="READ-DO"' + (ph.mode === 'READ-DO' ? ' selected' : '') + '>READ-DO: read each step, then do it</option><option value="DO-CONFIRM"' + (ph.mode === 'DO-CONFIRM' ? ' selected' : '') + '>DO-CONFIRM: do the work, then confirm together</option></select></label>' +
      '<div class="row"><button type="button" class="mini" data-act="ob-ph-move" data-id="' + esc(ph.key) + '" data-dir="up">Move phase up</button><button type="button" class="mini" data-act="ob-ph-move" data-id="' + esc(ph.key) + '" data-dir="down">Move phase down</button><button type="button" class="mini" data-act="ob-add-phase" data-id="' + esc(ph.key) + '">' + I('plus') + 'Add a phase after it</button>' +
      '<button type="button" class="mini" data-act="hist-open" data-id="draft" data-item="phase:' + esc(ph.key) + '" aria-haspopup="dialog">' + I('clock') + 'History of this phase</button></div>' +
      '<h3>' + I('gate') + 'Closing gate</h3>';
    if (gt && gt.odd) return f + '<p class="small">This gate has options the builder doesn\'t know. Edit it in Markdown.</p></section>';
    if (!gt) return f + '<p class="small">Without a gate, the phase ends with a check that it\'s done. Name a gate to add one.</p><label class="field" for="ob-g-title">Gate name<input id="ob-g-title" maxlength="120" data-enter="ob-commit" value="" placeholder="Ready to deploy"' + errAt(ctx, 'ob-g-title') + '></label>' + errMsg(ctx, 'ob-g-title') + '</section>';
    var roles = meta.roles.concat(gt.owner && meta.roles.indexOf(gt.owner) < 0 ? [gt.owner] : []);
    return f + '<label class="field" for="ob-g-title">Gate name<input id="ob-g-title" maxlength="120" data-enter="ob-commit" value="' + esc(gt.title) + '"' + errAt(ctx, 'ob-g-title') + '></label>' + errMsg(ctx, 'ob-g-title') +
      '<label class="field" for="ob-g-owner">Owner<select id="ob-g-owner" data-bound><option value=""' + (gt.owner ? '' : ' selected') + '>Nobody in particular</option>' + roles.map(function (r) { return '<option value="' + esc(r) + '"' + (r === gt.owner ? ' selected' : '') + '>@' + esc(r) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field" for="ob-g-approves">What passing it approves <span class="small">use ^details from the run</span><input id="ob-g-approves" maxlength="200" data-enter="ob-commit" value="' + esc(gt.approves) + '"' + errAt(ctx, 'ob-g-approves') + '></label>' + errMsg(ctx, 'ob-g-approves') + '</section>';
  }

  /* After builder edits, the Markdown view lists the lines that changed since the draft was opened or saved. */
  function changedLines(base, text) {
    var d = O.diff(base, text), lines = String(text).split('\n');
    if (!d.added.length && !d.removed.length) return '';
    return '<details class="ob-changed"><summary>Changed lines · ' + d.added.length + ' new or changed' + (d.removed.length ? ', ' + d.removed.length + ' removed' : '') + '</summary><ol class="ob-lines">' +
      d.added.slice(0, 40).map(function (i) { return '<li><span class="small">Line ' + (i + 1) + '</span> <code>' + esc(lines[i].replace(/\r$/, '')) + '</code></li>'; }).join('') +
      (d.added.length > 40 ? '<li class="small">and ' + (d.added.length - 40) + ' more</li>' : '') + '</ol></details>';
  }

  V.builder = builder; V.builderForm = builderForm; V.changedLines = changedLines;
})();
