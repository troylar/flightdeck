/* The run screen, a page of its own: a slim header, the status strip (who records, what's saved), messages and conflicts
   under it, then three panes that each scroll on their own: Phases, the checklist (with Next up pinned at its top) and the
   selected step. On a phone the checklist scrolls with the page and the selected step opens as a full-screen sheet. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, R = PF.run, M = PF.map, T = PF.types, A = PF.attach, I = PF.icons.icon, esc = U.esc;
  var nameOf = K.nameOf, avatar = K.avatar, runKey = K.runKey, freshness = K.freshness;
  var ATT_HELP = 'Images, PDF, text, logs and .zip, up to 10 MB each.';
  var BLOCK_REASONS = ['Failed', 'Waiting on someone', 'Not sure it passed'];
  var STATE_WORD = { open: 'not checked', done: 'done', na: 'not applicable', blocked: 'blocked', recheck: 'needs a re-check' };
  var GATE_WORD = { passed: 'Passed', waived: 'Waived', failed: 'Failed', review: 'Needs review', ready: 'Ready', open: 'Waiting on steps', locked: 'Locked', skipped: 'Not needed' };
  /* The error points at its own field when core named one; otherwise at every field in the form. */
  function errFor(st, stepId, inputId) { var e = st.fieldErr; return e && e.id === stepId && (!e.field || e.field === inputId) ? 'ferr-' + stepId : ''; }
  function ferr(st, id) { return st.fieldErr && st.fieldErr.id === id ? '<p class="ferr" id="ferr-' + esc(id) + '" role="alert">' + esc(st.fieldErr.msg) + '</p>' : ''; }
  /* Evidence and Fill in boxes are kept as the step's draft when you leave (data-draft-kept), so leaving never asks first. */
  /* g: the box's guide entry (PF.guide) for a built-in type: its question is the label, its example the placeholder, and its
     why follows any hint the box already has. Ids, names and labels in what's saved don't change. */
  function fieldInput(id, d, value, enter, stepId, note, errId, g) {
    /* A hint (from a Jira workflow, for example) says what the value should be or where it comes from. */
    var typed = PF.values.isNew(d.kind) || (d.detailKind && d.detailKind !== 'text'), kind = typed ? PF.values.kindOf(d) : d.kind;
    /* A date box shows no placeholder in most browsers, so its example goes in the why. */
    var hint = [d.hint, g && g.eg && kind === 'date' ? 'For example, ' + g.eg + '.' : '', g && g.why].filter(Boolean).join(' '), hintId = hint ? 'hint-' + id : '', described = [errId, hintId].filter(Boolean).join(' ');
    var q = g ? g.q : d.label, ph = g && g.eg ? ' placeholder="' + esc(g.eg) + '"' : d.kind === 'url' ? ' placeholder="https://"' : '';
    /* The hint follows the box, so it reads as this box's, not the next one's. */
    var lab = '<label class="small" for="' + esc(id) + '">' + esc(q) + esc(note || '') + '</label>', after = hint ? '<span class="small hint" id="' + esc(hintId) + '">' + esc(hint) + '</span>' : '',
      bad = (errId ? ' aria-invalid="true"' : '') + (described ? ' aria-describedby="' + esc(described) + '"' : '');
    /* A typed value (2.0) gets its kind's box; everything else keeps the boxes it always had. */
    if (typed) return '<span class="rf" data-draft-kept>' + K.typedField(id, q + (note || ''), d, value, bad.trim() + (kind === 'number' || kind === 'text' ? ph : '') + (d.kind === 'yes-no' || d.kind === 'choice' ? '' : ' data-enter="' + esc(enter) + '" data-id="' + esc(stepId) + '"'), 'small') + after + '</span>';
    if (d.kind === 'choice') return '<span class="rf" data-draft-kept>' + lab + '<select id="' + esc(id) + '"' + bad + '><option value="">Choose…</option>' + (d.options || []).map(function (o) { return '<option' + (String(o).toLowerCase() === String(value || '').trim().toLowerCase() ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>' + after + '</span>';
    if (d.kind === 'message' || d.kind === 'code' || d.long) return '<span class="rf" data-draft-kept>' + lab + '<textarea id="' + esc(id) + '"' + bad + ph + ' maxlength="300" rows="' + (d.long ? 3 : 2) + '">' + esc(value) + '</textarea>' + after + '</span>';
    return '<span class="rf" data-draft-kept>' + lab + '<input id="' + esc(id) + '"' + bad + ' maxlength="' + (d.cap || 300) + '" value="' + esc(value) + '" data-enter="' + esc(enter) + '" data-id="' + esc(stepId) + '"' + (d.kind === 'url' ? ' type="url"' : '') + ph + '>' + after + '</span>';
  }
  /* The guide speaks for built-in types only; a team type's boxes keep their own labels. */
  function guided(t) { return !!t && !t.custom && !!PF.guide && !!T.get(t.id); }
  function gField(t, f, fields) { return guided(t) ? PF.guide.field(t, f, fields) : null; }
  function gRecord(t, d, fields) { return guided(t) ? PF.guide.record(t, d, fields) : null; }
  var PROOF = { link: 'a link', note: 'a note', number: 'a number', 'yes-no': 'a yes or no', date: 'a date' };
  /* Step text inside a button: the same escaped Markdown, without links (a link can't sit inside a button). */
  function inlineText(t) { return U.mdInline(t).replace(/<a\b[^>]*>|<\/a>/g, ''); }
  /* The map the view reads: the run's own, or (Practice) the draft's admitted map, projected for Run from here. */
  function mapOf(ctx, r) { return ctx.mapOf ? ctx.mapOf(r) : R.mapOf(r); }
  /* Practice (2.3, docs/design.md section 34): the same screen over a stand-in, with what a run records left out. */
  function prOf(ctx) { return ctx.practice || null; }
  /* Whose drafts the boxes on screen belong to: the open run's, or the practice's. */
  function draftKeyOf(ctx) { return ctx.practice ? ctx.practice.key : ctx.state.runKey; }
  function typedOf(d) { return PF.values.isNew(d.kind) || (d.detailKind && d.detailKind !== 'text'); }
  function V0(def) { return PF.values.kindOf(def) === 'choice' && (def.options || []).length <= 5; }
  function stateOf(r, s) { var a = r.steps[s.id]; return a && a.s !== 'open' ? a.s : 'open'; }
  /* The step the inspector shows: the selected one, or the one a form is open on. */
  function selOf(ctx) { var s = ctx.state; return s.sel || (s.pick && /^(record|fields|block|deadline|differently)$/.test(s.pick.kind) ? s.pick.id : null); }
  function canWork(ctx, r, map, x) { return ctx.recording(r) && !r.paused && R.phaseOpen(r, map, x.phaseIndex); }
  /* Whether the selected step shows its evidence boxes, so Done collects what was typed there. The app asks the same. */
  function recordShown(ctx, r, map, id) {
    var x = M.findStep(map, id), a = r.steps[id], st = ctx.state;
    if (!x || !canWork(ctx, r, map, x) || x.step.type === 'run.process') return false;
    if (a && (a.s === 'done' || a.s === 'na' || a.s === 'blocked')) return false;
    if (st.pick && st.pick.id === id && st.pick.kind === 'fields') return false;
    return R.evidenceFor(r, x.step, null, map).list.length > 0;
  }
  var SCHED_WORD = { done: 'done', 'done late': 'done late', late: 'late', 'started?': 'time passed', soon: 'soon', upcoming: '' };
  function schedBadge(it) {
    var label = (it.kind === 'at' ? 'At ' : 'Due ') + U.hm(new Date(it.ms).toISOString()), word = SCHED_WORD[it.status];
    return '<span class="badge b-time s-' + esc(it.status.replace(/\W+/g, '-')) + '">' + esc(label + (word ? ' · ' + word : '')) + '</span>';
  }
  /* Elapsed time on a started step (paused time doesn't count, and a paused run's timer stands still) and a deadline copied from a tool. */
  function timerOf(ctx, r, s, a, now) {
    var h = '', st = a ? a.s : 'open';
    if (a && a.started && st !== 'done' && st !== 'na') {
      var exp = U.duration(s.fields.expect), active = R.activeMs(r, a.started.at, now), offset = (now - new Date(a.started.at).getTime()) - active;
      h += r.paused ? '<span class="timer">' + U.clock(active) + ' · paused</span>' : '<span class="timer" data-since="' + esc(a.started.at) + '" data-offset="' + offset + '"' + (exp ? ' data-expect="' + exp + '"' : '') + '>' + U.clock(active) + '</span>';
    }
    if (a && a.deadline && st !== 'done' && st !== 'na') h += '<span class="timer due" data-until="' + esc(a.deadline.at) + '">' + U.clock(new Date(a.deadline.at) - now) + '</span>';
    return h;
  }

  /* ---------- the checklist: compact rows; the working detail is in the inspector ---------- */
  function stepRow(ctx, r, map, x, rec, open, nx) {
    open = open && !r.paused;
    var s = x.step, a = r.steps[s.id] || null, t = T.get(s.type, r.types) || { label: s.type, icon: 'check', fields: {} }, st = ctx.state, now = ctx.now();
    var aState = stateOf(r, s), sel = selOf(ctx) === s.id, isNext = !!(nx && nx.step && nx.step.id === s.id), P = prOf(ctx), pm = P ? P.steps[s.id] || {} : null;
    var who = K.capJoin(s.roles, function (ro) { return r.roles[ro] ? nameOf(ctx, r.roles[ro]) : '@' + ro; }, ', ', 'rw-step-roles');
    var meta = (t.id === 'confirm' ? '' : '<span class="type">' + I(t.icon) + esc(T.nameOf(t)) + '</span>') + (who ? '<span class="s-who">' + esc(who) + '</span>' : '');
    /* Target details that tell two similar steps apart (an environment, a job) stay on the row. */
    var eff = R.fieldsOf(r, s), shown = 0;
    Object.keys(eff).forEach(function (f) {
      var def = T.fieldDef(t, f), v = def && eff[f] ? R.fill(eff[f], r.details, map.meta.context) : ''; if (!v || shown >= 2 || v.length > 32 || (def.kind !== 'text' && def.kind !== 'choice') || /^(expect|deadline|require|at|due|after|evidence|sets|carry)$/.test(f)) return;
      shown++; meta += '<span class="s-field">' + esc(def.label) + ' ' + esc(v) + '</span>';
    });
    var badges = (s.must ? K.mustMark() : '') + (s.planned ? '<span class="badge b-plan">Automation planned</span>' : '') +
      (aState === 'recheck' ? (P ? '<span class="badge b-warn">Try it again</span>' : '<span class="badge b-warn">Re-check: ' + esc(a.reason) + '</span>') : '') +
      (aState === 'blocked' ? '<span class="badge b-stop">Blocked · ' + esc(a.reason) + '</span>' : '') +
      (aState === 'na' ? '<span class="badge b-ref">N/A</span>' : '') +
      (a && a.differently ? '<span class="badge b-diff" title="' + esc(a.differently.note) + '">Done differently</span>' : '') +
      (x.sched ? schedBadge(x.sched) : '') + timerOf(ctx, r, s, a, now);
    /* Conditions (2.1): a step whose condition waits for a detail says why, as a bound step does. */
    var heldWhy = s.when || x.phase.when ? R.held(r, map, s) : '';
    if (heldWhy) badges += '<span class="badge b-warn">Waiting · ' + esc(heldWhy) + '</span>';
    /* Practice says what a run never needs to: assumed, checked without its evidence, simulated. */
    if (P) badges += pm.status === 'assumed' ? '<span class="badge b-ref">Assumed for practice</span>' : pm.skipped ? '<span class="badge b-ref">Checked without evidence</span>' : pm.simulated === 'linked' && pm.status !== 'done' ? '<span class="badge b-ref">Simulated</span>' : '';
    var notes = (r._notes || []).filter(function (n) { return n.step === s.id && n.kind !== 'correction' && n.kind !== 'fix' && n.kind !== 'map'; }).length, dr = ctx.stepDraft && ctx.stepDraft(s.id);
    var nc = (r._notes || []).filter(function (n) { return n.step === s.id && (n.kind === 'correction' || n.kind === 'fix' || n.kind === 'map'); }).length;
    if (nc) badges += '<span class="badge b-corr">' + (nc === 1 ? 'Correction proposed' : nc + ' corrections') + '</span>';
    if (changedHere(ctx, r)[s.id]) badges += '<span class="badge b-changed">Changed in v' + esc(r.version) + '</span>';
    if (dr && (dr.open || String(dr.note || '').trim() || Object.keys(dr.record).length || Object.keys(dr.fields).length)) badges += '<span class="s-draft">Draft</span><span class="sr"> (typed, not saved yet)</span>';
    if (V.reportBadge && !P) badges += V.reportBadge(ctx, r, map, s.id);
    if (notes) badges += '<span class="s-notes">' + I('note') + notes + '<span class="sr"> note' + (notes === 1 ? '' : 's') + '</span></span>';
    var stamp = P ? (pm.status === 'assumed' || !P.canEdit(s.id) ? '' : '<button class="mini s-edit" data-act="pr-edit" data-id="' + esc(s.id) + '" aria-label="Edit: ' + esc(K.stepPlain(s, K.refValue(r, map))) + '">' + I('edit') + 'Edit</button>')
      : a && (a.s === 'done' || a.s === 'na') ? '<span class="stamp">' + avatar(ctx, a.by) + ' ' + U.hm(a.at) + '</span>' : '';
    var flash = st.flash && st.flash.ids && st.flash.ids.indexOf(s.id) >= 0;
    var canCheck = rec && open && (t.id !== 'run.process' || !!P) && !heldWhy && !(P && (P.paused || pm.status === 'assumed'));
    return '<li class="step' + (sel ? ' sel' : '') + (isNext ? ' next' : '') + (flash ? ' flash' : '') + '" data-a="' + esc(aState) + '" id="step-' + esc(s.id) + '">' +
      '<button class="check" role="checkbox" aria-checked="' + (aState === 'done') + '" aria-label="' + esc(K.stepPlain(s, K.refValue(r, map))) + ', ' + esc(P && aState === 'recheck' ? 'try it again' : P && pm.status === 'assumed' ? 'assumed for practice' : STATE_WORD[aState] || aState) + (s.must ? ', must do' : '') + '" data-act="toggle" data-id="' + esc(s.id) + '"' + (canCheck ? '' : ' disabled') + (t.id === 'run.process' && !P ? ' title="Checked when its linked run completes"' : '') + '>' + I('check') + '</button>' +
      '<button class="s-pick" data-act="select" data-id="' + esc(s.id) + '" aria-pressed="' + sel + '" aria-controls="rw-ins">' + (isNext ? '<span class="s-next">Next</span>' : '') + '<span class="s-text">' + K.stepHtml(s, K.refValue(r, map), false) + '</span><span class="s-meta">' + meta + '</span>' + (badges ? '<span class="badges">' + badges + '</span>' : '') + '</button>' +
      stamp + '</li>';
  }

  /* A step that starts another process: the linked child run, or the button that starts it. What starting it passes on is
     worked out the same way the start does. */
  function passesOn(ctx, r, s, pub) {
    var problem = R.childProblem(r, s, pub.map.meta.context);
    if (problem) return problem;
    /* 2.8: a pass: step says where each value comes from and what the child asks when it starts. */
    if (PF.links.has(s)) {
      var rows = PF.links.rows(R.effStep(r, s), Object.keys(r.details), pub.map).rows, dv = R.childDetails(r, s, pub.map), setBy = M.setBy(pub.map);
      /* A team value (2.9) is named with what the folder has now; it's read again when the run starts. */
      var team = function (x) { var l = PF.teamValues.lookup(ctx.data.teamValues, x.team); return x.name + (l.value != null ? ' ' + l.value : l.missing ? ' (not set; asked when it starts)' : ' (can\'t be read)') + ' (team value ' + x.team + ')'; };
      var gave = rows.filter(function (x) { return x.source !== 'ask'; }).map(function (x) { if (x.source === 'team') return team(x); var v = Object.prototype.hasOwnProperty.call(dv, x.name) ? dv[x.name] : ''; return x.name + (v ? ' ' + v : ' (empty)') + (x.source === 'value' ? ' (fixed)' : x.from !== x.name ? ' (from ' + x.from + ')' : ''); });
      var asks = rows.filter(function (x) { return x.source === 'ask' && !Object.prototype.hasOwnProperty.call(setBy, x.name); }).map(function (x) { return x.name; });
      return (gave.length ? 'Passes on ' + K.capJoin(gave) : 'Passes on no details') + (asks.length ? '; asks for ' + K.capJoin(asks) + ' when it starts' : '');
    }
    var d = R.childDetails(r, s, pub.map.meta.context), keys = Object.keys(d);
    return keys.length ? 'Passes on ' + K.capJoin(keys, function (k) { return k + (d[k] ? ' ' + d[k] : ' (empty)'); }) : 'Passes on no details';
  }
  /* A step that runs a skill: what was registered when it was checked (run/3), and a warning, never a block, when the team
     folder registers another version than skillVersion: expects. */
  function skillBox(ctx, r, s, a) {
    var name = R.fieldsOf(r, s).skill, reg = (ctx.data.skills || []).filter(function (x) { return x.skill && x.skill.name === name && !x.unmatched; })[0];
    var warn = R.skillWarning(r, s, reg ? reg.skill : null), seen = a && a.skill ? PF.skills.observedWords(a.skill) : '';
    return (seen ? '<p class="small">' + esc(seen) + '.</p>' : '') + (warn ? '<div class="notice warn" role="status"><span>' + esc(warn) + '</span></div>' : '');
  }
  function childBox(ctx, r, s, a, canStart) {
    var proc = R.fieldsOf(r, s).process, child = a && a.child, key = child && child.process + '/' + child.id, cr = child && ctx.findRun(key);
    /* The version the child starts on: a run/3's pin, and only its pin; for a run/2, the latest, never a 2.0 version (it
       offers a 2.0 run instead). */
    var procOf = ctx.procOf || function (id) { var p = ctx.latestPub(id); return p ? { latest: p, all: [p], clashes: [], broken: [] } : null; };
    var target = PF.pins.childTarget(r, s, procOf), two = r.format === R.FORMAT3;
    var ownOf = function (o, k) { return o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null; };
    var pinned = two && r.pins ? ownOf(r.pins.children, s.id) : null, fromPayload = pinned && r.payload && r.payload.pins ? ownOf(r.payload.pins.children, s.id) : null;
    var pinWords = pinned ? '<span class="small">' + esc(PF.pins.words(pinned, target.pub ? target.pub.map.meta.title : null, !!fromPayload)) + '</span>' : '';
    var cont = a && a.s === 'blocked' && !two && /^Continued in run (\S+)$/.exec(a.reason || '');
    if (cont) return '<div class="childbox">' + I('nest') + '<span>' + esc(a.reason) + ', made with Flightdeck 2.0.</span>' + (ctx.findRun(cont[1]) ? '<button class="mini" data-act="open-run" data-id="' + esc(cont[1]) + '">Open run</button>' : '') + '</div>';
    var offer = function (why) { return '<div class="childbox">' + I('nest') + '<span>' + esc(why) + '</span>' + (canStart || (a && a.s === 'blocked') ? '<button class="btn" data-act="continue-two" data-id="' + esc(s.id) + '">Start it as a Flightdeck 2.0 run</button>' : '') + '</div>'; };
    /* A child run that names this step as its parent but isn't the linked one (its link didn't land): offer to link it,
       unless the linked child is still current. */
    var orphan = (ctx.data.runs || []).filter(function (x) { return x.parent && x.parent.process === r.process && x.parent.id === r.id && x.parent.step === s.id && !(child && child.process === x.process && child.id === x.id) && !(x.ended && (R.childVerdict(r, s, { child: { process: x.process, id: x.id, inputs: x.parent.inputs || {} } }, x, procOf, { noTeam: true }) || {}).s !== 'done') && R.childCurrent(r, s, { child: { process: x.process, inputs: x.parent.inputs || {} } }); })
      .filter(function (x) { return !R.childHeld(r, s.id, x, procOf); })
      .sort(function (p1, p2) { return p1.created < p2.created ? 1 : -1; })[0];
    if (orphan && canStart && !(child && R.childCurrent(r, s, a) && !child.failed)) return '<div class="childbox">' + I('nest') + '<span>"' + esc(orphan.title) + '" was started for this step but isn\'t linked.</span><button class="btn" data-act="link-child" data-id="' + esc(s.id) + '" data-child="' + esc(orphan.process + '/' + orphan.id) + '">Link it</button></div>';
    if (child) {
      /* The same verdict that refuses settlement (R.childHeld): a child it names can't stand for the step, current or not. */
      var off = cr ? R.childHeld(r, s.id, cr, procOf) : '';
      var state = cr ? (cr.ended ? K.outcomeWord(cr.ended.outcome) : K.headline(cr, R.mapOf(cr)).text) : 'not visible in this folder yet', fresh = R.childCurrent(r, s, a) && !child.failed && !off, tu = R.teamUnrecorded(r, s, a);
      if (!two && off) return offer(PF.pins.legacyWhy(target.pub || { map: { meta: { title: cr.title } }, info: { process: cr.process, version: cr.version } }, r));
      var again = !fresh && canStart && target.pub && !target.legacy ? '<button class="btn" data-act="start-child" data-id="' + esc(s.id) + '">Start a new ' + esc(target.pub.map.meta.title) + ' run</button>' : !fresh && canStart && target.legacy ? '<span class="small">' + esc(target.why) + '</span><button class="btn" data-act="continue-two" data-id="' + esc(s.id) + '">Start it as a Flightdeck 2.0 run</button>' : '';
      return '<div class="childbox">' + I('nest') + '<span>Child run: <b>' + esc(cr ? cr.title : child.process) + '</b> · ' + esc(state) + (fresh ? (tu ? '. ' + esc(tu) : '') : off ? '. ' + esc(off) : child.failed ? '. It didn\'t complete as started, so it doesn\'t count for this step.' : '. The details it was started for have changed, so it no longer counts for this step.') + '</span>' + (cr ? '<button class="mini" data-act="open-run" data-id="' + esc(key) + '">Open run</button>' : '') + again + '</div>';
    }
    var pub = target.pub;
    if (a && (a.s === 'done' || a.s === 'na')) return '';
    if (target.legacy) return offer(target.why);
    if (!canStart) return '<div class="childbox">' + I('nest') + '<span>Starts a <b>' + esc(proc || '?') + '</b> run when this step is reached.</span>' + pinWords + '</div>';
    if (target.why) return '<div class="childbox">' + I('nest') + '<span class="small">' + esc(target.why) + '</span></div>';
    return '<div class="childbox">' + I('nest') + '<button class="btn go" data-act="start-child" data-id="' + esc(s.id) + '">Start the ' + esc(pub.map.meta.title) + ' run</button><span class="small">' + esc(passesOn(ctx, r, s, pub)) + '. This step is checked when it completes.</span>' + pinWords + '</div>';
  }

  /* A phase's note and screenshots (2.0) at the top of the phase, folded with its steps once it's done. Thumbnails load
     when they scroll into view, as a step's do. */
  function shotsHtml(ctx, act, id, list) {
    return list.length ? '<div class="thumbs shots">' + list.map(function (sh, k) { return '<figure class="shot"><button class="thumb" data-act="' + act + '" data-id="' + esc(id) + '" data-i="' + k + '" aria-label="Expand: ' + esc(sh.caption) + '" title="' + esc(sh.caption) + '">' + ctx.img(sh.src, sh.caption) + '</button><figcaption class="small">' + esc(sh.caption) + '</figcaption></figure>'; }).join('') + '</div>' : '';
  }
  function phaseNote(ctx, p) {
    var shots = p.shots || [];
    if (!p.note && !shots.length) return '';
    return '<div class="ph-note">' + (p.note ? '<div class="note">' + U.mdBlock(p.note) + '</div>' + (ctx.practice ? '' : noteCorr(ctx, 'phase', p.id, p.note)) : '') + shotsHtml(ctx, 'zoom-phase', p.id, shots) + '</div>';
  }
  /* Suggest a change to a phase's note or a gate's (2.0): a correction the team decides on, like a step's. */
  function noteCorr(ctx, kind, id, note) {
    var s = ctx.state, r = ctx.run && ctx.run(); if (!s.me || !r) return '';
    /* Each phase's and gate's composer is its own draft, kept for this folder and run until Save or Cancel. */
    var f = (s.noteCorrs || {})[ctx.fsKey + '\n' + runKey(r) + '|nc:' + kind + ':' + id] || null, act = ' data-kind="' + kind + '" data-id="' + esc(id) + '"';
    if (!f) return '<div class="row"><button class="mini" data-act="nc-open"' + act + '>' + I('edit') + 'Suggest a change to this note</button></div>';
    var sfx = '-' + kind + '-' + id, eid = 'ferr-nc' + sfx, err = s.fieldErr && s.fieldErr.id === 'nc' + sfx ? s.fieldErr : null, bad = function (k) { return err && err.field === k ? ' aria-invalid="true" aria-describedby="' + esc(eid) + '"' : ''; };
    var fe = function (k) { return err && err.field === k ? '<p class="ferr" id="' + esc(eid) + '" role="alert">' + esc(err.msg) + '</p>' : ''; };
    /* While it saves, what's typed is what's being saved: nothing typed then could be lost when the composer closes. */
    var ro = f.sending ? ' readonly aria-readonly="true"' : '';
    return '<div class="corr-form nc-form" role="group" aria-label="Suggest a change to the ' + kind + '\'s note" data-draft-kept>' +
      '<label class="small" for="nc-to' + esc(sfx) + '">What the note should say</label><textarea id="nc-to' + esc(sfx) + '" rows="3" maxlength="2000"' + ro + bad('to') + '>' + esc(f.to) + '</textarea>' + fe('to') +
      '<label class="small" for="nc-why' + esc(sfx) + '">Why (optional)</label><textarea id="nc-why' + esc(sfx) + '" rows="2" maxlength="2000"' + ro + bad('why') + '>' + esc(f.why || '') + '</textarea>' + fe('why') +
      '<p class="small">The team decides on it like any correction. Copies older than Flightdeck 2.0 show it as a described problem.</p>' +
      '<div class="row"><button class="btn" data-act="nc-save"' + act + (f.sending ? ' disabled' : '') + '>Save correction</button><button class="mini" data-act="nc-cancel"' + act + '>Cancel</button></div></div>';
  }

  /* The approval a gate recorded, as one sentence: who, when, and the exact details it was for. */
  function gateReceipt(ctx, rec2, st) {
    if (!rec2 || !rec2.by) return '';
    return esc(GATE_WORD[st] || st) + (st === 'review' ? ' (was ' + esc((rec2.s === 'review' ? rec2.was : rec2.s) || 'passed') + ')' : '') + ' by ' + esc(nameOf(ctx, rec2.by)) + ' at ' + U.hm(rec2.at) +
      (rec2.approved && Object.keys(rec2.approved).length ? ' for ' + esc(K.capJoin(Object.keys(rec2.approved), function (k) { return k + ' ' + (rec2.approved[k] || '(not set)'); }, ' · ', 'gate-approved')) : '') + (rec2.reason ? ': ' + esc(rec2.reason) : '');
  }
  /* brief: the gate of a phase that can't start yet and is folded, so only its name and status show until it's reached
     (never while a suggestion to its note is being written). */
  function gateBlock(ctx, r, map, pi, rec, sched, brief) {
    var g = map.phases[pi].gate, st = R.gateStatus(r, map, pi), rec2 = r.gates[g.id], s = ctx.state, P = prOf(ctx), owner = !P && g.owner && r.roles[g.owner], info = R.phaseInfo(r, map, pi);
    var approves = g.approves ? R.fill(g.approves, r.details, map.meta.context) : '';
    var h = '<div class="gate" data-scope="gate:' + esc(g.id) + '" data-s="' + st + '" id="gate-' + esc(g.id) + '"><div class="stack" style="gap:4px"><div class="gate-title">' + I('gate') + '<span>' + (g.implicit ? esc(g.title) + (R.solo(r) ? '' : ' together') : 'Gate: ' + esc(g.title)) + '</span>' + (st === 'passed' && s.justPassed === g.id ? '' : '<span class="pill ' + st + '">' + GATE_WORD[st] + '</span>') +
      (st === 'passed' && s.justPassed === g.id ? '<span class="called-stamp">Passed</span>' : '') + '</div>';
    if (brief) return h + (sched ? '<div class="badges">' + schedBadge(sched) + '</div>' : '') + '</div><div class="row"></div></div>';
    if (approves) h += '<div class="q">Approves ' + U.mdInline(approves) + '</div>';
    if (owner) h += '<div class="small">Owner: ' + esc(nameOf(ctx, owner)) + '</div>';
    if (sched) h += '<div class="badges">' + schedBadge(sched) + '</div>';
    if (P) h += V.prGateNote(P, g.id, pi) + (P.canEdit(g.id) ? '<div class="row"><button class="mini" data-act="pr-edit" data-id="' + esc(g.id) + '">' + I('edit') + 'Edit the gate</button></div>' : '');
    else if (rec2 && rec2.by && (st === 'passed' || st === 'waived' || st === 'failed' || st === 'review')) h += '<div class="small g-rec">' + gateReceipt(ctx, rec2, st) + '</div>';
    /* The gate's note, for every version (every copy since 1.10 publishes it), and its screenshots (2.0), above Pass the gate. */
    if (g.note) h += '<div class="note g-note">' + U.mdBlock(g.note) + '</div>' + (g.implicit || P ? '' : noteCorr(ctx, 'gate', g.id, g.note));
    h += shotsHtml(ctx, 'zoom-gate', g.id, g.shots || []);
    h += '</div><div class="row">';
    if (rec && r.state === 'running' && !r.paused && !(P && P.paused)) {
      if (s.pick && s.pick.id === g.id && s.pick.kind === 'pass') h += '<span class="q"><b>' + (approves ? 'Approve ' + U.mdInline(approves) + '?' : 'Pass "' + esc(g.title) + '"?') + '</b></span><button class="btn go" data-act="pass" data-id="' + pi + '">Yes, pass it</button><button class="mini" data-act="unpick">Cancel</button>';
      else if (s.pick && s.pick.id === g.id && (s.pick.kind === 'waive' || s.pick.kind === 'fail')) h += '<label class="sr" for="pick-input">' + (s.pick.kind === 'waive' ? 'Why waive it?' : 'What failed?') + '</label><input id="pick-input" class="rw-in" placeholder="' + (s.pick.kind === 'waive' ? 'Why waive it?' : 'What failed?') + '" maxlength="200" data-enter="' + s.pick.kind + '" data-id="' + pi + '"' + (P ? ' value="' + esc(P.waiveText(g.id)) + '"' + (P.gateErr && P.gateErr.pi === pi ? ' aria-invalid="true" aria-describedby="pr-why-e-' + pi + '"' : '') : '') + '><button class="btn ' + (s.pick.kind === 'fail' ? 'stop' : '') + '" data-act="' + s.pick.kind + '" data-id="' + pi + '">' + (s.pick.kind === 'waive' ? 'Waive' : 'Fail') + '</button><button class="mini" data-act="unpick">Cancel</button>';
      else {
        /* A solo run's plain "confirm" between phases is one click; a named gate always asks for a deliberate second click. */
        if (R.canPass(r, map, pi) && g.implicit && R.solo(r) && st !== 'review') h += '<button class="btn go" data-act="pass" data-id="' + pi + '">Confirm and continue</button>';
        else if (R.canPass(r, map, pi)) h += '<button class="btn go" data-act="pick" data-kind="pass" data-id="' + esc(g.id) + '">' + (st === 'review' ? 'Review and pass again' : 'Pass the gate') + '</button>';
        else if (st === 'open' || (st === 'review' && (info.left || info.blocked.length))) {
          /* Why it can't pass yet, said next to the button. */
          var why = (info.left ? info.left + ' unanswered step' + (info.left === 1 ? '' : 's') : '') + (info.blocked.length ? (info.left ? ', ' : '') + info.blocked.length + ' blocked' : '');
          h += '<button class="btn" disabled aria-describedby="gwhy-' + esc(g.id) + '">' + (g.implicit ? 'Confirm' : 'Pass the gate') + '</button><span class="small" id="gwhy-' + esc(g.id) + '">' + esc(why) + '</span>';
        }
        if (R.canWaive(r, map, pi) && st !== 'ready') h += '<button class="mini" data-act="pick" data-kind="waive" data-id="' + esc(g.id) + '">Waive</button>';
        if (!P && st !== 'locked' && st !== 'failed' && st !== 'passed' && st !== 'waived' && st !== 'skipped') h += '<button class="mini" data-act="pick" data-kind="fail" data-id="' + esc(g.id) + '">Fail</button>';
        if (st === 'passed' || st === 'waived' || st === 'failed' || st === 'review') h += '<button class="mini" data-act="reopen" data-id="' + pi + '">' + (P ? 'Reopen this phase' : 'Reopen') + '</button>';
      }
    }
    return h + '</div></div>';
  }

  /* ---------- who records, what's saved ---------- */
  /* For a window that isn't recording: who is, and how to pick up or take over. */
  function ownership(ctx, r) {
    var s = ctx.state, me = s.me, rp = r.recorder.person;
    var risk = 'If the other window has changes OneDrive hasn\'t delivered yet, they\'ll show up as a conflict copy to review.';
    if (!r.recorder.session && R.waitingForHandoff(r)) return { text: '<b>' + esc(nameOf(ctx, r.recorder.handoff.from)) + ' handed recording to ' + (rp === me ? 'you' : esc(nameOf(ctx, rp))) + '.</b> Their last change hasn\'t reached this computer yet, so it can\'t be picked up here until OneDrive syncs it.', ctl: '' };
    if (rp === me && !r.recorder.session) return { text: '<b>Recording is waiting for you</b>. Pick it up to check steps in this window.', ctl: '<button class="btn go" data-act="pickup">Pick up recording</button>' };
    if (!r.recorder.session) return { text: 'Waiting for <b>' + esc(nameOf(ctx, rp)) + '</b> to pick up recording.', ctl: '' };
    if (rp === me) return { text: '<b>You\'re recording in another window.</b> This window is following. Choose Record here to record in this one; the other becomes view-only. ' + risk, ctl: '<button class="btn go" data-act="takeover">Record here</button>' };
    var ask = s.pick && s.pick.kind === 'takeover' ? '<span class="row rw-ask"><b>Take over from ' + esc(nameOf(ctx, rp)) + '? Only if they can\'t continue. ' + risk + '</b><button class="btn stop" data-act="takeover">Take over</button><button class="mini" data-act="unpick">Cancel</button></span>' : (me ? '<button class="mini" data-act="pick" data-kind="takeover" data-id="recorder">Take over recording</button>' : '');
    return { text: avatar(ctx, rp) + ' <b>' + esc(nameOf(ctx, rp)) + ' is recording.</b>' + (me ? ' You can add notes.' : ''), ctl: ask };
  }
  /* The strip under the header: whose recording this is, with the control that goes with it, and on the right what this
     window saved and when it last checked the folder (separate facts; neither proves another computer has the change). */
  function strip(ctx, r) {
    var s = ctx.state, rec = ctx.recording(r), solo = R.solo(r), kind = 'follow', text = '', ctl = '';
    if (r._unrunnable) { kind = 'ro'; text = '<b>Read-only in this copy.</b> ' + esc(r._unrunnable) + ' This copy shows the parts it understands, and can\'t record it or save over it.'; }
    else if (r.ended) { kind = 'ended'; text = '<b>Ended: ' + esc(K.outcomeWord(r.ended.outcome)) + '</b>' + (r.ended.byName || r.ended.by ? ' by ' + esc(r.ended.byName || nameOf(ctx, r.ended.by)) : '') + (r.ended.at ? ' at ' + U.hm(r.ended.at) : '') + '.'; ctl = '<button class="btn go" data-act="receipt">' + I('receipt') + 'Receipt</button>'; }
    else if (!s.me) {
      kind = 'who'; text = '<b>Choose who you are</b> to record or add notes. Everything you do here is stamped with your name.';
      var people = PF.people.sorted(ctx).filter(function (p) { return !p.inactive; });
      var nmMe = PF.people.labeler(people);
      ctl = people.length ? '<label class="sr" for="me-run">You are</label><select id="me-run"><option value="">Choose…</option>' + people.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(nmMe(p)) + '</option>'; }).join('') + '</select>' : '<label class="sr" for="me-run">Your name</label><input id="me-run" class="rw-in" placeholder="Your name" maxlength="40">';
    } else if (r.paused) {
      kind = 'paused';
      text = I('pause') + ' <b>Paused</b> by ' + esc(nameOf(ctx, r.paused.by)) + ' at ' + U.hm(r.paused.at) + ': ' + esc(r.paused.reason) + '. Steps, gates and timers wait until it\'s resumed; deadlines from other tools keep counting.';
      if (rec) ctl = '<button class="btn go" data-act="resume">Resume</button>';
      else { var o = ownership(ctx, r); text += ' ' + o.text; ctl = o.ctl; }
    } else if (rec) {
      kind = 'rec';
      text = solo ? '<b>Your run</b>' : '<b>You\'re recording</b>';
      var pause = s.pick && s.pick.kind === 'pause' ? '<span class="row rw-ask" data-scope="pause"><label class="sr" for="pick-input">Why pause?</label><input id="pick-input" class="rw-in" placeholder="Why pause? (what are we waiting for)" maxlength="120" data-enter="pause" data-id="run"><button class="mini" data-act="pause">Pause</button><button class="mini" data-act="unpick">Cancel</button></span>'
        : '<button class="mini" data-act="pick" data-kind="pause" data-id="run">' + I('pause') + 'Pause</button>';
      var people2 = PF.people.sorted(ctx).filter(function (p) { return !p.inactive && p.id !== s.me; });
      var nmTo = PF.people.labeler(people2);
      var hand = s.pick && s.pick.kind === 'handoff' ? '<span class="row rw-ask"><label class="sr" for="handoff-to">Hand recording to</label><select id="handoff-to">' + people2.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(nmTo(p)) + '</option>'; }).join('') + '</select><button class="mini" data-act="handoff">Hand off</button><button class="mini" data-act="unpick">Cancel</button></span>'
        : '<button class="mini" data-act="pick" data-kind="handoff" data-id="recorder">' + I('swap') + (solo ? 'Hand to someone' : 'Hand off') + '</button>';
      ctl = pause + hand;
    } else { var w = ownership(ctx, r); text = w.text; ctl = w.ctl; kind = /data-act="pickup"/.test(w.ctl) ? 'ready' : 'follow'; }
    /* The save side: Saving…, a failed save with its way out, or when this window saved and checked the folder. */
    var save;
    if (s.unsaved[r.id]) save = '<span class="rw-unsaved"><b>Your last change isn\'t saved.</b></span><button class="btn" data-act="retry-save">Try again</button><button class="mini" data-act="discard-unsaved">Discard my change</button>';
    else save = ((s.pendingSaves || {})[r.id] ? '<span class="rw-saving">Saving…</span>' : '') + '<span id="fresh" data-k="strip">' + freshness(ctx, r, true) + '</span>';
    var copies = (r._conflicts || []).length + (ctx.localCopy(r) ? 1 : 0);
    if (copies) save += '<button class="mini rw-copies" data-act="goto" data-id="rec-t">' + copies + ' other version' + (copies === 1 ? '' : 's') + ' · Compare copies</button>';
    return '<div class="rw-strip" data-k="' + kind + '" role="region" aria-label="Recording and saving"><div class="rw-who"><span class="rw-say">' + text + '</span>' + (ctl ? '<span class="row rw-ctl">' + ctl + '</span>' : '') + '</div>' +
      chipsLine(ctx, r) + '<div class="rw-save">' + save + '</div></div>';
  }
  /* The run's details, read-only, beside the strip; they're edited in Details. */
  function chipsLine(ctx, r) {
    var map = mapOf(ctx, r), waiting = R.openMigrations(r).map(function (m) { return m.path; }), flag = function (f) { return (r._invalid && Object.prototype.hasOwnProperty.call(r._invalid, 'details.' + f)) || waiting.indexOf('details.' + f) >= 0; };
    var keys = map.meta.context.filter(function (f) { return r.details[f] || flag(f); });
    if (!keys.length) return '';
    /* A typed value that isn't right, or still waiting since the run started, says so here; Details says what to do. */
    return '<div class="rw-chips">' + keys.map(function (f) { return '<span class="rw-chip"><span class="k">' + esc(f) + '</span> <code>' + esc(K.valueText(detailDef(r, map, f), r.details[f])) + '</code>' + (flag(f) ? ' <span class="small">needs filling in</span>' : '') + '</span>'; }).join('') + '</div>';
  }

  /* Conflict copies and copies kept in this browser, side by side with what's current, with a way to keep or delete each. */
  function recovery(ctx, r, rec) {
    var s = ctx.state, copies = r._conflicts || [], local = ctx.localCopy(r);
    if (!copies.length && !local) return '';
    var h = '<section class="notice bad recovery" aria-labelledby="rec-t"><div class="stack" style="gap:8px;width:100%"><h3 id="rec-t" tabindex="-1" style="margin:0">' + (copies.length + (local ? 1 : 0)) + ' other version' + (copies.length + (local ? 1 : 0) === 1 ? '' : 's') + ' of this run</h3>' +
      '<span class="small">Two computers saved at once, or a save couldn\'t be written. Compare, keep the right one, and delete the rest. Nothing is merged automatically. <button type="button" class="linkish" data-act="recovery" data-id="a-run-has-conflict-copies">What to do</button></span>';
    /* 20 at a time, in name order (2.11); the copy being compared or confirmed for deletion stays drawn. */
    var cmp = s.copyView && s.copyView.key === runKey(r) ? s.copyView.name : null, del = s.pick && s.pick.kind === 'delete-copy' ? s.pick.id : null;
    h += K.list(s, 'copies', copies, { page: 20, keyOf: function (n) { return n; }, keep: [cmp, del], keptLabel: 'The copy you\'re working on', focusOf: function (k) { return K.byId('copy-' + k); }, draw: function (shown) { var o = ''; shown.forEach(function (name) { o += copyRow(name); }); return o; } });
    function copyRow(name) {
      var open = s.copyView && s.copyView.name === name && s.copyView.key === runKey(r), h = '';
      h += '<div class="copyrow"><code id="copy-' + esc(name) + '" tabindex="-1">' + esc(name) + '</code><span class="row"><button class="mini" data-act="compare-copy" data-id="' + esc(name) + '">' + (open ? 'Compared' : 'Compare') + '</button>' +
        (rec ? '<button class="mini" data-act="use-copy" data-id="' + esc(name) + '">Keep this one</button>' : '') +
        (s.pick && s.pick.kind === 'delete-copy' && s.pick.id === name ? '<button class="btn stop" data-act="delete-copy" data-id="' + esc(name) + '">Yes, delete it</button><button class="mini" data-act="unpick">Cancel</button>' : '<button class="mini" data-act="delete-copy" data-id="' + esc(name) + '">Delete</button>') + '</span></div>';
      if (open) h += s.copyView.lines ? '<ul class="small difflist">' + s.copyView.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : '<p class="small">That copy can\'t be read.</p>';
      return h;
    }
    if (local) h += '<div class="copyrow"><span>A copy kept in this browser (' + esc(U.when(local.savedAt || local.created)) + ')</span><span class="row">' + (rec ? '<button class="mini" data-act="restore-local">Restore it</button>' : '') + '<button class="mini" data-act="discard-local">Discard</button></span></div>';
    if (!rec && copies.length) h += '<span class="small">' + (r.ended ? 'Only whoever recorded or ended this run can keep a copy' : 'Only the recorder can keep a copy') + '; anyone can compare.</span>';
    return h + '</div></section>';
  }

  /* A run detail's kind on a run/3 (typed-details), or null for text. */
  function detailDef(r, map, f) { return r.format === R.FORMAT3 ? R.typedDef(r, map, 'details.' + f) : null; }
  /* Values converted from older text when the run started (2.0 typed details): only on a run that has any, folded, with
     archived ones from the run's history once they're loaded. */
  function migrationsList(ctx, r, map) {
    var arch = (ctx.state.archive[runKey(r)] || []).filter(function (y) { return y.kind === 'migration'; }), list = arch.concat(Array.isArray(r.migrations) ? r.migrations : []);
    if (!list.length) return '';
    var SRC = { plan: 'the plan', 'switch': 'the plan', carry: 'the parent run', request: 'the request', report: 'a report' };
    return '<details class="small"><summary>Converted values (' + list.length + ')</summary><ul>' + list.map(function (m) {
      var def = R.typedDef(r, map, String(m.path)), name = String(m.path).replace(/^details\./, '').replace(/^steps\.([^.]+)\.values\./, '$1 ');
      var to = m.resolved ? 'filled in as ' + K.valueText(def, m.resolved.value) + ' by ' + nameOf(ctx, m.resolved.by) : m.result != null ? 'became ' + K.valueText(def, m.result) : R.isOpenMigration(m) ? 'waiting for someone to fill it in' : '';
      return '<li><b>' + esc(name) + '</b>: "' + esc(String(m.from)) + '" from ' + esc(SRC[m.source] || String(m.source)) + (to ? ', ' + esc(to) : '') + '</li>';
    }).join('') + '</ul></details>';
  }
  /* Details: every run detail and role, editable by the recorder as before, and where this run sits. A typed value that isn't
     right, or one still waiting since the run started, says so beside it. */
  function details(ctx, r, map, rec) {
    var s = ctx.state, waiting = R.openMigrations(r);
    var det = map.meta.context.map(function (f) {
      var def = detailDef(r, map, f), bad = r._invalid && Object.prototype.hasOwnProperty.call(r._invalid, 'details.' + f) ? r._invalid['details.' + f].why : '';
      var wait = waiting.filter(function (m) { return m.path === 'details.' + f; })[0], note = bad || (wait ? PF.values.ask(def, wait.from) : '');
      if (s.edit === 'detail:' + f && rec && def) return '<span class="inline-edit" data-scope="edit:detail:' + esc(f) + '">' + K.typedField('edit-input', f, def, r.details[f], def.kind === 'yes-no' || V0(def) ? '' : 'data-enter="save-edit"', 'small') + '<button class="mini" data-act="save-edit">Save</button><button class="mini" data-act="unedit">Cancel</button>' + (note ? '<span class="small">' + esc(note) + '</span>' : '') + '</span>';
      if (def) return '<button class="chip' + (r.details[f] ? '' : ' empty') + (note ? ' warn' : '') + '" data-act="edit" data-id="detail:' + esc(f) + '"' + (rec ? '' : ' disabled') + '><span class="k">' + (r.details[f] ? '' : 'Set ') + esc(f) + '</span>' + (r.details[f] ? '<span class="v">' + esc(K.valueText(def, r.details[f])) + '</span>' : '') + (note ? '<span class="small">' + esc(note) + '</span>' : '') + '</button>';
      if (s.edit === 'detail:' + f && rec) return '<span class="inline-edit" data-scope="edit:detail:' + esc(f) + '"><label class="small" for="edit-input">' + esc(f) + '</label><input id="edit-input" maxlength="120" value="' + esc(r.details[f]) + '" data-enter="save-edit"><button class="mini" data-act="save-edit">Save</button><button class="mini" data-act="unedit">Cancel</button></span>';
      return '<button class="chip' + (r.details[f] ? '' : ' empty') + '" data-act="edit" data-id="detail:' + esc(f) + '"' + (rec ? '' : ' disabled') + '><span class="k">' + (r.details[f] ? '' : 'Set ') + esc(f) + '</span>' + (r.details[f] ? '<span class="v">' + esc(r.details[f]) + '</span>' : '') + '</button>';
    }).join('');
    var nmRole = PF.people.labeler(ctx.data.people);
    /* 20 roles at a time with Find past 20 (2.11); the one being edited is always drawn. */
    var rolePaged = K.roleRows(s, 'det-roles', map.meta.roles, { keep: map.meta.roles.filter(function (ro) { return s.edit === 'role:' + ro; }), keptLabel: 'You\'re editing this one', focusOf: function (k) { return rec ? K.byAct('edit', 'role:' + k) : K.byId('det-role-' + k); }, row: function (ro) {
      if (s.edit === 'role:' + ro && rec) return '<span class="inline-edit" data-scope="edit:role:' + esc(ro) + '"><label class="small" for="edit-input">' + esc(ro) + '</label><select id="edit-input"><option value="">Nobody</option>' + PF.people.sorted(ctx).filter(function (p) { return !p.inactive; }).map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === r.roles[ro] ? ' selected' : '') + '>' + esc(nmRole(p)) + '</option>'; }).join('') + '</select><button class="mini" data-act="save-edit">Save</button><button class="mini" data-act="unedit">Cancel</button></span>';
      var chip = '<button class="chip' + (r.roles[ro] ? '' : ' empty') + '" data-act="edit" data-id="role:' + esc(ro) + '"' + (rec ? '' : ' disabled') + '><span class="k">' + esc(ro) + '</span>' + (r.roles[ro] ? avatar(ctx, r.roles[ro]) + esc(nameOf(ctx, r.roles[ro])) : 'assign') + '</button>';
      /* A viewer's chip is disabled, so Show more's focus goes to a wrapper that can take it. */
      return rec ? chip : '<span class="chip-at" id="det-role-' + esc(ro) + '" tabindex="-1">' + chip + '</span>';
    } }), roles = rolePaged.rows;
    /* Solo runs keep collaboration out of the way: roles appear only if someone asks for them, or while Find a role has text or
       focus, so a newer read leaving the run to one person never takes the box away (K.findOn, code review round 20). */
    var alone = R.solo(r), roleRow = map.meta.roles.length ? (alone && !s.showRoles && !K.findOn(s, 'det-roles', false) ? (rec ? '<button class="mini" data-act="show-roles">' + I('people') + 'Add people</button>' : '') : roles) : '';
    var h = '<section class="rw-details" id="rw-details" aria-labelledby="rw-det-h"><h2 id="rw-det-h" class="rw-h2" tabindex="-1">Details</h2>' +
      '<p class="small">' + esc(map.meta.title) + ' · ' + esc(K.verWord(r)) + ' · started ' + esc(U.when(r.created)) + ' · recorded by ' + esc(nameOf(ctx, r.recorder.person)) + ' · revision ' + (r.rev || 0) + '</p>' +
      (det ? '<div class="chips" role="group" aria-label="Run details">' + det + '</div>' : '') + (roleRow ? (roleRow === roles ? rolePaged.box : '') + '<div class="chips" role="group" aria-label="Roles">' + roleRow + '</div>' : '') +
      (rec ? '<p class="small">Changing a detail sends steps that used it back for a re-check, and gates that approved it need review.</p>' : '') + migrationsList(ctx, r, map);
    if (r.parent) { var pk = r.parent.process + '/' + r.parent.id, pr = ctx.findRun(pk); h += '<p class="small">' + I('nest') + ' Part of <b>' + esc(pr ? pr.title : r.parent.process) + '</b>. When this run ends, that run\'s step is checked (or blocked, if this one stops). ' + (pr ? '<button class="linkish" data-act="open-run" data-id="' + esc(pk) + '">Open it</button>' : '') + '</p>'; }
    return h + '</section>';
  }

  /* Duplicate a run into a plan: offered once its process has a published version to plan on, and never for a run this
     copy can only partly read (its details and roles may be missing what a newer copy wrote). */
  function planAgain(ctx, r, cls) {
    if (!ctx.state.me || r._unrunnable || !ctx.processes().some(function (p) { return p.id === r.process && p.latest; })) return '';
    return '<button class="' + (cls || 'btn') + '" data-act="plan-from-run" data-id="' + esc(runKey(r)) + '">Plan another like this</button>';
  }
  V.planAgain = planAgain;

  /* ---------- Next up: where the run stands, never where this window is looking ---------- */
  /* Next up's line: a step (its text with run details in place) or words. */
  function mainHtml(r, map, main) { return main && typeof main === 'object' ? K.stepHtml(main, K.refValue(r, map), false) : inlineText(main || ''); }
  function nextBar(ctx, r, map, nx, rec) {
    var s = ctx.state, hl = nx.hl, hint = '', main = '', btn = '';
    if (nx.kind === 'ended') { hint = 'This run has ended'; main = K.hlText(r, hl); }
    else if (nx.kind === 'paused') { hint = 'Paused'; main = r.paused.reason; btn = rec ? '<button class="btn go" data-act="resume">Resume</button>' : ''; }
    else if (nx.kind === 'blocked') { hint = 'Stopped · blocked (' + (r.steps[nx.step.id] || {}).reason + ')'; main = nx.step; btn = '<button class="btn" data-act="goto" data-id="step-' + esc(nx.step.id) + '">Show blocked step</button>'; }
    else if (nx.kind === 'gate') {
      var g = nx.gate, name = g.implicit ? 'Confirm ' + map.phases[nx.phaseIndex].title : g.title;
      hint = nx.status === 'failed' ? 'Gate failed' : nx.status === 'review' ? 'Gate needs review · something it approved changed' : 'Every step in ' + map.phases[nx.phaseIndex].title + ' is answered';
      main = nx.status === 'ready' ? (g.implicit ? name : 'Gate: ' + g.title) : hl.text;
      btn = '<button class="btn' + (nx.status === 'ready' ? ' go' : '') + '" data-act="goto" data-id="gate-' + esc(g.id) + '">Review "' + esc(name) + '"</button>';
    } else if (nx.kind === 'complete') { hint = 'Every gate passed'; main = ctx.practice ? 'You got through it' : 'Finish the run'; btn = rec && !ctx.practice ? '<button class="btn go" data-act="finish">Finish the run</button>' : ''; }
    else if (nx.step) {
      var p = map.phases[nx.phaseIndex], g2 = p.gate, here = selOf(ctx) === nx.step.id;
      hint = esc(p.title) + ' · ' + nx.left + ' to go, then ' + (g2.implicit ? (R.solo(r) ? 'confirm the phase' : 'confirm together') : 'the "' + esc(g2.title) + '" gate');
      if (nx.track) {
        var who = K.capJoin(nx.track.roles.filter(function (ro) { return r.roles[ro]; }), function (ro) { return nameOf(ctx, r.roles[ro]); }, ', ', 'rw-next-roles');
        hint += ' · ' + esc(nx.track.title) + (who ? ' (' + esc(who) + ')' : '');
      }
      main = nx.step;
      btn = here ? '<span class="small rw-here">Selected' + (rec && s.keys ? '<span class="rw-kbd"> · Space checks it</span>' : '') + '</span>' : '<button class="btn" data-act="goto" data-id="step-' + esc(nx.step.id) + '">' + (selOf(ctx) ? 'Back to it' : 'Go to step') + '</button>';
      if (ctx.practice && ctx.practice.canEdit(nx.step.id)) btn += '<button class="mini" data-act="pr-edit" data-id="' + esc(nx.step.id) + '">' + I('edit') + 'Edit</button>';
      var others = (nx.tracks || []).filter(function (t) { return t.step && (!nx.track || t.track.id !== nx.track.id); });
      var tail = K.capJoin(others, function (t) { return esc(t.track.title) + ': ' + t.left + ' left'; }, ' · ', 'rw-next-lanes');
      return '<div class="rw-next" data-k="step" role="region" aria-label="Next up"><div class="rw-next-t"><div class="small">Next up · ' + hint + '</div><b>' + mainHtml(r, map, main) + '</b>' + (tail ? '<div class="small">Also open: ' + tail + '</div>' : '') + '</div>' + btn + '</div>';
    }
    return '<div class="rw-next" data-k="' + esc(nx.kind) + (nx.status ? ' ' + esc(nx.status) : '') + '" role="region" aria-label="Next up"><div class="rw-next-t"><div class="small">' + esc(hint) + '</div><b>' + mainHtml(r, map, main) + '</b></div>' + btn + '</div>';
  }

  /* ---------- the inspector: everything about the selected step ---------- */
  /* ---------- corrections (docs/design.md section 19) ---------- */
  var C = PF.corrections, CPILL = { open: 'open', applied: 'ready', declined: 'locked', withdrawn: 'locked', legacy: 'passed' };
  /* Files waiting to go with a note or a correction: name, size and Remove. */
  function pendingList(ctx, files, errKey) {
    var st = ctx.state, err = st.attErr && st.attErr.key === errKey ? '<p class="ferr" role="alert" id="atterr-' + esc(errKey) + '">' + esc(st.attErr.msg) + '</p>' : '';
    if (!files.length) return err;
    return err + '<ul class="att-list pending" aria-label="Waiting to attach">' + files.map(function (p) {
      return '<li class="att">' + I(p.kind === 'image' ? 'camera' : 'doc') + '<span class="att-n">' + esc(p.name) + '</span><span class="small">' + esc(A.size(p.size)) + '</span><button class="mini" data-act="att-remove" data-id="' + esc(p.id) + '" aria-label="Remove ' + esc(p.name) + '">Remove</button></li>';
    }).join('') + '</ul>';
  }
  /* Before and After, word by word, with the same thing said in plain text for screen readers. */
  function redline(from, to) {
    var parts = C.diffWords(from, to);
    return '<span class="redline"><span aria-hidden="true">' + parts.map(function (p) { return p.t === 'same' ? esc(p.s) : p.t === 'del' ? '<del>' + esc(p.s) + '</del>' : '<ins>' + esc(p.s) + '</ins>'; }).join('') + '</span><span class="sr">Before: ' + esc(from) + '. After: ' + esc(to) + '.</span></span>';
  }
  /* Where a correction stands: its group's status, or One-off for a "done differently" answer with no correction. */
  function corrPill(g, c) {
    if (c && c.oneOff) return '<span class="pill waived">One-off</span>';
    var st = g ? g.status : 'open';
    return '<span class="pill ' + (g && g.tie ? 'review' : g && g.landed ? 'passed' : CPILL[st] || 'open') + '">' + esc(g ? C.label(g) : C.STATUS.open) + '</span>' + (g && st === 'declined' && g.decision && g.decision.reason ? '<span class="small corr-why-no">' + esc(g.decision.reason) + '</span>' : '');
  }
  /* The groups of a process by correction ID, from the app (memoized) or worked out here. */
  function corrIndex(ctx, pid) { return C.statusById(corrGroups(ctx, pid)); }
  /* Every group on a process, with where it stands and which published version has it: from the app (memoized) or worked out here. */
  function corrGroups(ctx, pid) {
    if (ctx.corrections) return ctx.corrections(pid);
    return C.forProcess(ctx.data.runs, pid, ctx.data.corrDecisions, ctx.processes().filter(function (x) { return x.id === pid; })[0]);
  }
  /* One correction as the run's record shows it: Checklist said, Suggested (a redline for new wording), Why, What happened,
     who and when, where it stands, and its files. */
  function corrRow(ctx, c, g, opts) {
    opts = opts || {};
    var ch = c.change, lab = c.oneOff ? 'Just this run' : C.OP_LABEL[ch ? ch.op : 'describe'];
    var h = '<li class="corr" id="' + esc(opts.domId || 'corr-' + c.id) + '" tabindex="-1"><div class="row corr-top"><span class="badge b-plan">' + esc(lab) + '</span>' + corrPill(g, c) + '<span class="small">' + esc(nameOf(ctx, c.by)) + ' · ' + esc(opts.day ? U.when(c.at) : U.hm(c.at)) + '</span></div>';
    if (opts.step && c.stepText) h += '<div class="corr-step">' + inlineText(c.stepText) + '</div>';
    var dl = '';
    if (ch && ch.op !== 'describe' && c.from) dl += '<dt>Checklist said</dt><dd>' + esc(c.from) + '</dd>';
    if (ch && ch.op === 'wording') dl += '<dt>Suggested</dt><dd>' + redline(c.from, ch.to) + '</dd>';
    else if (c.proposed) dl += '<dt>Suggested</dt><dd>' + esc(c.proposed) + '</dd>';
    if (c.why) dl += '<dt>' + (ch && ch.op === 'describe' ? 'Problem' : 'Why') + '</dt><dd>' + esc(c.why) + '</dd>';
    if (c.happened) dl += '<dt>What happened</dt><dd>' + esc(c.happened) + '</dd>';
    h += dl ? '<dl class="corr-dl">' + dl + '</dl>' : '';
    h += attachments(ctx, c.id, c.files, c.fileInfo, 'corr');
    if (g && g.again) h += '<div class="small">Suggested again after it was ' + esc(g.again.status) + (g.again.reason ? ': ' + esc(g.again.reason) : '') + '</div>';
    if (opts.withdraw && g && g.status === 'open' && !g.tie && C.canWithdraw(g, ctx.state.me)) h += '<div class="row"><button class="mini" data-act="corr-withdraw" data-id="' + esc(g.id) + '" data-process="' + esc(g.process) + '">Withdraw</button></div>';
    if (opts.followUp) h += opts.followUp;
    return h + '</li>';
  }
  /* Corrections first published in exactly this run's version, by the step they're about there. Only that version's runs
     show "Changed in vN": a later version has the step as it is, with nothing new to explain. */
  /* A step's corrections as a list's items (2.11): keyed by ID, and by its occurrence when two share one ("id#2"). */
  /* A step's corrections as list items, each keyed by its note's identity (its id, and where it stands among the run's notes
     sharing that id: noteAt), so two corrections sharing an id are two rows with their own ids on the page. */
  /* A one-off row (a Done differently answer with no correction) is keyed, and has its row id, by its step under ONE_OFF:
     a note's key is its id as U.nthKey writes it, which starts with '#' only as '#' and digits (an empty id's later note),
     so no note, whatever its id (diff-s0 too), can share a one-off's key or row id (code review round 15). */
  var ONE_OFF = '#off-';
  function corrItems(rows) {
    var seen = Object.create(null);
    return rows.map(function (c) {
      if (c.oneOff) return { c: c, k: ONE_OFF + c.step, dom: oneOffDom(c.step) };
      var n = c.noteAt || (seen[c.id] = (seen[c.id] || 0) + 1); return { c: c, k: PF.search.noteKey(c.id, n), dom: corrDomId(c.id, n) };
    });
  }
  function oneOffDom(step) { return 'corr-' + ONE_OFF + step; }
  /* The selector of a correction list's row from its key: a one-off's by its step, a note's by its id and place. */
  function corrFocus(k) { k = String(k); if (k.indexOf(ONE_OFF) === 0) return K.byId('corr-' + k); var x = U.nthOf(k); return K.byId(corrDomId(x.s, x.n)); }
  /* Earlier or archived answers as list items, each keyed by the whole answer (who, when, what), never its place: a newer
     answer arriving on top doesn't turn the row someone is on into another. */
  function answerRows(list) {
    var ks = K.uniqKeys(list, function (y) { return JSON.stringify(y); });
    return list.map(function (y, i) { return { y: y, k: ks[i] }; });
  }
  /* Unreadable note lines, each keyed by its file and line. */
  function badRows(nl) { var ks = K.uniqKeys(nl, function (x) { return x.file + '\n' + x.line; }); return nl.map(function (x, i) { return { x: x, k: ks[i] }; }); }
  /* A list key, "" included: a note's id can be "" and its key with it (code review round 16). */
  function isKey(k) { return typeof k === 'string'; }
  /* The key of the one-off row (a Done differently answer with no correction) that has focus, by its answer (app.js
     noteHold): these lists hold their focused rows themselves (hold: false), notes by their anchor, one-offs by this. */
  function oneOffHeld(st, r, items) {
    var h = st.noteHeld; if (!h || !h.oneOff || h.run !== runKey(r)) return null;
    for (var i = 0; i < items.length; i++) { var c = items[i].c; if (c.oneOff && c.step === h.step && c.by === h.oneOff.by && c.at === h.oneOff.at && c.happened === h.oneOff.note) return items[i].k; }
    return null;
  }
  /* A group's members' keys (2.11): each member by its run, its id and its note's whole content (PF.search.noteAnchor, as
     noteFind and noteHold tell twins apart), never its place in the group or among notes sharing its id. Members identical
     in every field are told apart by rank only while there are as many of them: when their number changes, each gets a new
     key, so focus on one goes to its list's heading rather than onto another (noteFind chooses none then too). */
  function memberKeys(g) {
    var sigs = g.members.map(function (m) { return m.run + '\n' + m.id + '\n' + (m.note ? PF.search.noteAnchor(m.note) : m.noteAt || 1); }), n = Object.create(null);
    sigs.forEach(function (s) { n[s] = (n[s] || 0) + 1; });
    return K.uniqKeys(sigs.map(function (s) { return n[s] > 1 ? s + '\n' + n[s] : s; }), function (s) { return s; });
  }
  /* A correction row's id: corr-<id>, and corr-<id>#<n> for a later note sharing that id (U.nthKey: never a literal id's). */
  function corrDomId(id, n) { return 'corr-' + U.nthKey(id, n); }
  /* A thread note's row id: tn-, its step's id with each - and \ escaped by a \, then -, then the note's key. The step's id
     ends at the first - not escaped, so step s0-a's note b and step s0's note a-b never share a row id (code review round 18). */
  function noteDomId(step, key) { return 'tn-' + String(step).replace(/[\\-]/g, '\\$&') + '-' + key; }
  function changedHere(ctx, r) { return r && r.process && r.folder ? C.changedIn(corrGroups(ctx, r.process), r.folder) : {}; }
  /* "Changed in vN" with "Why is this here?": what it said before and after, why, the runs that suggested it, who applied it. */
  /* The members of every change on this step, 20 at a time counted across them (2.11): a change is drawn once one of its
     members is, each member with its whole reason and the run it came from, built only when drawn. */
  function provList(ctx, r, map, st, gs) {
    var items = [], byK = Object.create(null);
    /* Each member by its change and its own note (run, id, place among its twins), never its place in the list. */
    gs.forEach(function (g, gi) { var ks = memberKeys(g); g.members.forEach(function (m, i) { var x = { g: g, gi: gi, m: m, i: i, k: K.domKey(g.id + '\n' + ks[i]) }; items.push(x); byK[x.k] = x; }); });
    return K.list(ctx.state, 'prov-' + st.id, items, { page: 20, keyOf: function (x) { return x.k; }, groupOf: function (x) { return x.g.id; },
      /* A member gone from this draw (its row still on the page as drawn) is found by either of its ids, so focus on it can go
         to the list's heading. */
      focusOf: function (k) { var x = byK[k], why = K.byId('pm-' + st.id + '-' + k), run = K.byId('pm-' + st.id + '-' + k + '-run'); return x ? (x.m.why ? why : run) : why + ', ' + run; },
      draw: function (shown) {
        var out = '', run = [];
        shown.forEach(function (x, i) { run.push(x); if (i === shown.length - 1 || shown[i + 1].gi !== x.gi) { out += provenance(ctx, r, map, st, x.g, run); run = []; } });
        return out;
      } });
  }
  function provenance(ctx, r, map, st, g, shown) {
    var c = g.first, d = g.decision, ch = g.change, disc = 'prov:' + g.id, open = !!(ctx.state.disc && ctx.state.disc[disc]);
    var pm = function (x) { PF.perf.add('prov.member'); return 'pm-' + st.id + '-' + x.k; };
    shown.forEach(function (x) { x.id = pm(x); });
    var dl = '';
    if (ch.op === 'wording' && g.from) dl += '<dt>Before → after</dt><dd>' + redline(g.from, st.text) + '</dd>';
    else {
      if (g.from && ch.op !== 'add') dl += '<dt>Before</dt><dd>' + esc(g.from) + '</dd>';
      var prop = C.proposal(c, map); if (prop) dl += '<dt>' + (ch.op === 'describe' || ch.op === 'screenshot' ? 'Change' : 'After') + '</dt><dd>' + esc(ch.op === 'add' ? 'Added' + (g.from ? ' after "' + g.from + '"' : '') + ': ' + st.text : prop) + '</dd>';
    }
    shown.forEach(function (x) { var m = x.m; if (m.why) dl += '<dt id="' + esc(x.id) + '" tabindex="-1">' + (ch.op === 'describe' ? 'Problem' : 'Why') + ' · ' + esc(nameOf(ctx, m.by)) + '</dt><dd>' + esc(m.why) + '</dd>'; });
    var runs = '<p class="small prov-runs">Suggested in ' + g.runs + ' run' + (g.runs === 1 ? '' : 's') + ': ' + shown.map(function (x) {
      var m = x.m;
      return '<button class="linkish" id="' + esc(x.id) + '-run" data-act="open-run" data-id="' + esc(m.process + '/' + m.run) + '">' + esc(m.runTitle) + '</button> (' + esc(nameOf(ctx, m.by)) + ', ' + (m.test ? 'test run, staged v' : 'v') + esc(m.version) + ')';
    }).join(', ') + (shown.length < g.members.length ? ', and ' + (g.members.length - shown.length).toLocaleString('en-US') + ' more' : '') + '</p>';
    var who = d && d.by ? '<p class="small">' + (d.status === 'included' ? esc(nameOf(ctx, d.by)) + ' said v' + esc(d.version) + ' has it' : 'Applied by ' + esc(nameOf(ctx, d.by))) + (d.at ? ' ' + esc(U.day(d.at)) : '') + '.</p>' : '';
    return '<div class="prov"><span class="badge b-changed">Changed in v' + esc(g.landed.version) + '</span><details class="prov-why" data-disc="' + esc(disc) + '"' + (open ? ' open' : '') + '><summary class="small">Why is this here?</summary>' +
      (dl ? '<dl class="corr-dl">' + dl + '</dl>' : '') + runs + who + '</details></div>';
  }
  V.fuList = fuList; V.fuRow = fuRow; V.fuPill = fuPill; V.fuPaged = fuPaged;
  V.redline = redline; V.corrRow = corrRow; V.corrDomId = corrDomId; V.noteDomId = noteDomId; V.oneOffDom = oneOffDom; V.ONE_OFF = ONE_OFF; V.corrFocus = corrFocus; V.memberKeys = memberKeys; V.oneOffHeld = oneOffHeld; V.corrItems = corrItems; V.corrPill = corrPill; V.corrIndex = corrIndex; V.corrGroups = corrGroups;
  /* The composer: Correct this step (a proposal; it doesn't answer the step) or Done differently (answers it; what happened
     first, then whether the checklist should change). The published step stays shown above it, never replaced. */
  function composer(ctx, r, map, x, f) {
    var st = ctx.state, s = x.step, err = st.fieldErr && st.fieldErr.id === 'corr' ? st.fieldErr : null;
    var fe = function (id) { return err && err.field === id ? '<p class="ferr" id="ferr-corr" role="alert">' + esc(err.msg) + '</p>' : ''; };
    var bad = function (id) { return err && err.field === id ? ' aria-invalid="true" aria-describedby="ferr-corr"' : ''; };
    var answer = f.mode === 'differently', fix = !answer || f.scope === 'fix', files = ctx.attachments(runKey(r), 'corr:' + s.id);
    var shown = { 'corr-happened': answer, 'corr-to': fix && f.op === 'wording', 'corr-text': fix && f.op === 'add', 'corr-move': fix && f.op === 'move', 'corr-roles': fix && f.op === 'roles', 'corr-why': fix };
    var h = '<div class="compose corrform" data-scope="corr:' + esc(s.id) + '" data-drop="corr" role="group" aria-labelledby="corr-h"><h4 class="corr-h" id="corr-h">' + (answer ? 'Done differently' : 'Correct this step') + '</h4>' +
      (err && !shown[err.field] ? '<p class="ferr" id="ferr-corr" role="alert">' + esc(err.msg) + '</p>' : '') +
      '<p class="small corr-says"><b>Checklist says</b> (v' + esc(r.version) + '): ' + K.stepHtml(s, K.refValue(r, map)) + '</p>';
    if (answer) {
      h += '<label class="small" for="corr-happened"><b>What happened</b> (required)</label><textarea id="corr-happened" rows="2" maxlength="500" data-bound' + bad('corr-happened') + '>' + esc(f.happened) + '</textarea>' + fe('corr-happened');
      h += '<span class="small" id="corr-scope-l">Should the checklist change?</span><div class="seg" role="group" aria-labelledby="corr-scope-l">' + [['just', 'Just this run'], ['fix', 'Fix the checklist too']].map(function (o) { return '<button type="button" data-act="corr-scope" data-id="' + o[0] + '" aria-pressed="' + (f.scope === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>';
    }
    var same = false;
    if (fix) {
      var others = C.OTHER.filter(function (o) { return o[0] !== f.op && (o[0] !== 'screenshot' || s.shots.length); });
      if (f.op !== 'wording') others.unshift(['wording', 'Edit the wording']);
      h += '<div class="corr-op"><span class="small"><b>' + esc(f.op === 'wording' ? 'Suggested wording' : (C.OTHER.filter(function (o) { return o[0] === f.op; })[0] || ['', ''])[1]) + '</b></span>' +
        '<span class="corr-menu"><button type="button" class="mini" data-act="corr-menu" aria-expanded="' + !!f.menu + '" aria-controls="corr-menu">Change something else</button>' +
        (f.menu ? '<span class="corr-menu-list" id="corr-menu" role="group" aria-label="Change something else">' + others.map(function (o) { return '<button type="button" class="mini" data-act="corr-op" data-id="' + o[0] + '">' + esc(o[1]) + '</button>'; }).join('') + '</span>' : '') + '</span></div>';
      if (f.op === 'wording') {
        same = String(f.to).replace(/\s+/g, ' ').trim() === s.text.replace(/\s+/g, ' ').trim();
        h += '<label class="sr" for="corr-to">Suggested wording</label><textarea id="corr-to" rows="3" maxlength="2000" data-bound' + (same ? ' aria-describedby="corr-same"' : bad('corr-to')) + '>' + esc(f.to) + '</textarea>' + fe('corr-to') +
          (same ? '<p class="small corr-same" id="corr-same">No wording changed.</p>' : '<div class="corr-prev"><span class="small"><b>Before / After</b></span>' + redline(s.text, String(f.to).replace(/\s+/g, ' ').trim()) + '</div>');
      } else if (f.op === 'add') {
        h += '<label class="sr" for="corr-text">The missing step</label><textarea id="corr-text" rows="2" maxlength="2000" placeholder="What the missing step says" data-bound' + bad('corr-text') + '>' + esc(f.text) + '</textarea>' + fe('corr-text') +
          '<fieldset class="corr-where"><legend class="small">Where it goes</legend>' + [['after', 'After this step'], ['end', 'At the end of ' + x.phase.title]].map(function (w) { return '<label class="check-label small"><input type="radio" name="corr-where" id="corr-where-' + w[0] + '" data-bound' + (f.where === w[0] ? ' checked' : '') + '> ' + esc(w[1]) + '</label>'; }).join('') + '</fieldset>';
      } else if (f.op === 'move') {
        /* Every place in checklist order, the 50 nearest this step first, with Find past 50 (K.select). Places whose step reads the
           same are told apart by where they are. */
        var places = [], near = 0, rv = K.refValue(r, map);
        map.phases.forEach(function (p, pi) {
          places.push({ v: 'start:' + p.id, t: 'At the start of ' + p.title, place: 'Phase ' + (pi + 1), g: p.title });
          p.steps.forEach(function (y, si) {
            if (y.id === s.id) { near = places.length; return; }
            places.push({ v: 'after:' + y.id, t: 'After "' + K.stepPlain(y, rv).slice(0, 80) + '"', place: 'Phase ' + (pi + 1) + ', step ' + (si + 1), g: p.title });
          });
        });
        var mv = K.select(st, 'corr-move', places, f.moveTo || '', { attrs: ' data-bound' + bad('corr-move'), lead: '<option value="">Choose…</option>', around: near, noun: 'place', group: function (it) { return it.g; } });
        h += mv.box + '<label class="small" for="corr-move">Move it to</label>' + mv.select + mv.more + fe('corr-move');
      } else if (f.op === 'roles') {
        /* 20 roles at a time in checklist order, with Find past 20 (2.11); a role ticked is always drawn, so it's never lost. */
        var roles = map.meta.roles || [], rq = K.findQ(st, 'corr-roles'), rhit = K.finds(rq);
        var rmatch = roles.filter(function (ro) { return rhit([ro, r.roles[ro] ? nameOf(ctx, r.roles[ro]) : '']); }), rout = rq ? roles.filter(function (ro) { return !rhit([ro, r.roles[ro] ? nameOf(ctx, r.roles[ro]) : '']); }) : null;
        var rbox = function (ro) { return '<label class="check-label small"><input type="checkbox" id="corr-role-' + esc(ro) + '" data-bound' + (f.roles.indexOf(ro) >= 0 ? ' checked' : '') + '> @' + esc(ro) + (r.roles[ro] ? ' (' + esc(nameOf(ctx, r.roles[ro])) + ')' : '') + '</label>'; };
        h += roles.length ? '<fieldset class="corr-roles" id="corr-roles" tabindex="-1"' + bad('corr-roles') + '><legend class="small">Who should do it</legend>' +
          (K.findOn(st, 'corr-roles', roles.length > 20) ? K.findBox(st, 'corr-roles', 'Find a role', rmatch.length, roles.length, 'role') : '') +
          K.list(st, 'corr-roles', rmatch, { page: 20, keyOf: function (ro) { return ro; }, focusOf: function (k) { return K.byId('corr-role-' + k); }, outside: rout, soft: f.roles.filter(function (ro) { return roles.indexOf(ro) >= 0; }), keptLabel: 'Ticked', draw: function (shown) { return shown.map(rbox).join(''); } }) +
          '</fieldset>' + fe('corr-roles')
          : '<p class="small">This checklist has no roles. Use Describe another problem to say who should do it.</p>';
      } else if (f.op === 'screenshot') {
        var shot = s.shots.filter(function (sh) { return sh.src === f.shot; })[0] || s.shots[0];
        h += '<p class="small">Replacing <b>' + esc(shot ? shot.caption : '') + '</b>. Attach the right one, or say what\'s wrong with it.</p>';
      } else if (f.op === 'remove') h += '<p class="small corr-warn"><b>Remove this step from future versions?</b> Runs already started keep it.</p>';
      var whyLabel = f.op === 'describe' ? 'What\'s wrong' : f.op === 'remove' ? 'Why remove it? (required)' : 'Why? (optional)';
      h += '<label class="small" for="corr-why">' + whyLabel + '</label><textarea id="corr-why" rows="2" maxlength="2000" data-bound' + bad('corr-why') + '>' + esc(f.why) + '</textarea>' + fe('corr-why');
      h += '<div class="row"><label class="btn" for="corr-file">' + I('clip') + (f.op === 'screenshot' ? 'Attach the right one' : 'Attach') + '</label><input type="file" id="corr-file" accept="' + esc(A.ACCEPT) + '" multiple class="sr"><span class="small">or drop or paste files here</span></div>' + pendingList(ctx, files, 'corr:' + s.id);
    }
    var conseq = answer ? (fix ? 'Marks this step done differently and proposes a checklist correction.' : 'Marks this step done differently.') : 'Saves a proposal for the checklist. It doesn\'t answer the step.';
    var off = f.sending || (fix && same);
    return h + '<p class="small corr-conseq" id="corr-conseq">' + conseq + '</p><div class="row"><button class="btn ' + (answer ? 'go' : 'primary') + '" data-act="' + (answer ? 'corr-done' : 'corr-save') + '" data-id="' + esc(s.id) + '"' + (off ? ' aria-disabled="true"' : '') + ' aria-describedby="corr-conseq' + (fix && same ? ' corr-same' : '') + '">' + (f.sending ? 'Saving…' : answer ? 'Mark done differently' : 'Save correction') + '</button><button class="mini" data-act="corr-cancel">Cancel</button></div></div>';
  }
  /* A step's checklist fields as the run sees them: commands and messages with Copy, links with Open, the rest as labels. */
  function fieldsBlock(ctx, r, map, s, t, sched) {
    var st = ctx.state, eff = R.fieldsOf(r, s), own = (r.fields || {})[s.id] || {}, chips = '', code = '';
    Object.keys(eff).forEach(function (f) {
      if (f === 'expect' || f === 'deadline' || f === 'require' || !eff[f] || (sched && (f === 'at' || f === 'due' || f === 'after'))) return;
      var def = T.fieldDef(t, f) || { label: f, kind: 'text' }, val = R.fill(eff[f], r.details, map.meta.context), mark = own[f] != null ? ' filled" title="Filled in during this run' : '';
      var copy = function () { var on = st.copied === val; return '<button class="mini" data-act="copy" data-text="' + esc(val) + '" aria-label="Copy ' + esc(def.label) + '">' + I(on ? 'check' : 'copy') + (on ? 'Copied' : 'Copy') + '</button>'; };
      if (f === 'evidence') { chips += '<span class="fchip"><b>Evidence:</b> ' + esc(PROOF[String(val).toLowerCase()] || 'a note') + '</span>'; return; }
      if (def.kind === 'message') { code += '<div class="cmd msg' + mark + '"><span>' + esc(val) + '</span>' + copy() + '</div>'; return; }
      if (def.kind === 'list') { chips += '<span class="fchip' + mark + '"><b>' + esc(def.label) + ':</b> ' + esc(val.split(',').map(function (x) { return x.trim(); }).filter(Boolean).join(' / ')) + '</span>'; return; }
      if (def.kind === 'code') code += '<div class="cmd' + mark + '"><code>' + esc(val) + '</code>' + copy() + '</div>';
      else if (def.kind === 'url' && U.safeUrl(val)) chips += '<a class="fchip' + mark + '" href="' + esc(U.safeUrl(val)) + '" target="_blank" rel="noopener noreferrer"><b>' + esc(def.label) + '</b> open</a>';
      else chips += '<span class="fchip' + mark + '"><b>' + esc(def.label) + ':</b> ' + esc(val) + '</span>';
    });
    return (chips ? '<div class="fields">' + chips + '</div>' : '') + code;
  }
  /* Attachments on a note or suggestion: images as thumbnails that open the viewer; text files open as plain text; other
     files save a copy. Never shown as a page. */
  function attachments(ctx, owner, files, info, from) {
    var imgs = 0, h = '';
    (files || []).forEach(function (f) {
      var k = A.kindOf(f), name = A.nameOf(f, info && info[f]), sz = info && info[f] && info[f].size != null ? A.size(info[f].size) : '';
      if (k === 'image') { h += '<button class="thumb" data-act="' + (from === 'corr' ? 'zoom-corr' : 'zoom-note') + '" data-id="' + esc(owner) + '" data-i="' + imgs + '" aria-label="Open ' + esc(name) + '" title="' + esc(name) + '">' + ctx.img(f, name) + '</button>'; imgs++; return; }
      h += '<button class="att" data-act="' + (k === 'text' ? 'att-open' : 'att-save') + '" data-id="' + esc(owner) + '" data-from="' + esc(from) + '" data-path="' + esc(f) + '" aria-label="' + (k === 'text' ? 'Open ' : 'Save a copy of ') + esc(name) + (sz ? ', ' + esc(sz) : '') + '">' + I('doc') + '<span class="att-n">' + esc(name) + '</span>' + (sz ? '<span class="small">' + esc(sz) + '</span>' : '') + '<span class="att-do">' + (k === 'text' ? 'Open' : 'Save') + '</span></button>';
    });
    return h ? '<div class="thumbs atts">' + h + '</div>' : '';
  }
  V.attachments = attachments;

  function inspector(ctx, r, map, rec) {
    var s = ctx.state, id = selOf(ctx), x = id && M.findStep(map, id), open = s.refOpen && !!x;
    if (!x) return '<aside class="fpe-pane rw-ins" id="rw-ins" data-open="false" aria-label="Selected step"><div class="rw-nosel"><p><b>No step selected.</b> Choose a step in the checklist to see how to do it, record it and read its notes.</p></div></aside>';
    var st = x.step, t = T.get(st.type, r.types) || { id: st.type, label: st.type, icon: 'check', hint: '', fields: {} }, a = r.steps[st.id] || null, aState = stateOf(r, st), now = ctx.now(), P = prOf(ctx), pm = P ? P.steps[st.id] || {} : null;
    var work = canWork(ctx, r, map, x), all = M.steps(map), i = all.map(function (y) { return y.step.id; }).indexOf(st.id), prev = all[i - 1], next = all[i + 1];
    var ph = map.phases[x.phaseIndex], inPhase = ph.steps.map(function (y) { return y.id; }).indexOf(st.id) + 1, track = st.track ? (ph.tracks || []).filter(function (tr) { return tr.id === st.track; })[0] : null;
    var sched = P ? null : (R.schedule(r, map, now).filter(function (it) { return it.what === 'step' && it.id === st.id; }) || [])[0];
    var who = K.capJoin(st.roles, function (ro) { return !P && r.roles[ro] ? avatar(ctx, r.roles[ro]) + esc(nameOf(ctx, r.roles[ro])) : '@' + esc(ro); }, ', ', 'rw-ins-roles');
    var cf = s.corrForm && s.corrForm.key === runKey(r) && s.corrForm.step === st.id ? s.corrForm : null, corrOpen = !!cf;
    var h = '<aside class="fpe-pane rw-ins" id="rw-ins" data-scope="ref:' + esc(st.id) + '" data-open="' + open + '" aria-label="Selected step">';
    h += '<div class="rw-ins-top"><button class="mini close" data-act="close-ref">Close</button>' + (P && P.canEdit(st.id) ? '<button class="mini rw-ins-edit" data-act="pr-edit" data-id="' + esc(st.id) + '">' + I('edit') + 'Edit this step</button>' : '') + '<nav class="row rw-steps" aria-label="Other steps">' +
      (prev ? '<button class="mini" data-act="select" data-id="' + esc(prev.step.id) + '" data-nav="1">' + I('back') + 'Previous</button>' : '') + (next ? '<button class="mini" data-act="select" data-id="' + esc(next.step.id) + '" data-nav="1">Next</button>' : '') + '</nav>' +
      '<button class="linkish rw-skip" data-act="to-row" data-id="' + esc(st.id) + '">Back to the checklist</button></div>';
    h += '<div class="rw-ins-body">';
    h += '<nav aria-label="Where it is"><ol class="ob-crumbs"><li>' + esc(ph.title) + '</li>' + (track ? '<li>' + esc(track.title) + '</li>' : '') + '<li>Step ' + inPhase + ' of ' + ph.steps.length + '</li></ol></nav>';
    h += '<h2 id="ins-h" class="rw-ins-h" tabindex="-1">' + K.stepHtml(st, K.refValue(r, map)) + '</h2>';
    h += '<div class="rw-ins-meta">' + (t.id === 'confirm' ? '' : '<span class="type">' + I(t.icon) + esc(T.nameOf(t)) + '</span>') + (who ? '<span class="small">' + who + '</span>' : '') + (st.must ? '<span class="badge b-must">Must do</span>' : '') +
      '<span class="badge rw-st s-' + esc(aState) + '">' + esc(P && pm.status === 'assumed' ? 'Assumed for practice' : aState === 'open' ? 'Not checked' : aState === 'done' ? 'Done' : aState === 'na' ? (P ? 'Not needed' : 'N/A') : aState === 'blocked' ? 'Blocked' : P ? 'Try it again' : 'Re-check') + '</span>' +
      (a && (a.s === 'done' || a.s === 'na') && !P ? '<span class="small">' + esc(nameOf(ctx, a.by)) + ' · ' + U.hm(a.at) + '</span>' : '') + '</div>';
    var chg = changedHere(ctx, r)[st.id];
    if (chg) h += '<div class="rw-prov">' + provList(ctx, r, map, st, chg) + '</div>';
    if (P) h += V.prStepNote(P, st.id);
    else if (aState === 'blocked' || aState === 'recheck') h += '<div class="notice ' + (aState === 'blocked' ? 'bad' : 'warn') + ' rw-why"><span><b>' + (aState === 'blocked' ? 'Blocked' : 'Needs a re-check') + ':</b> ' + esc(a.reason) + (a.by ? ' · ' + esc(nameOf(ctx, a.by)) + ' ' + U.hm(a.at) : '') + '</span></div>';

    /* What to do */
    /* The plain type's generic hint says nothing the step doesn't; What to do shows only when it has something (2.3.1). */
    var how = (t.hint && t.id !== 'confirm' ? '<p class="small">' + esc(t.hint) + '</p>' : '') + (st.note ? '<div class="note">' + U.mdBlock(st.note) + '</div>' : '');
    var shots = st.shots.map(function (sh, k) { return '<figure class="shot"><button class="thumb" data-act="zoom" data-id="' + esc(st.id) + '" data-i="' + k + '" aria-label="Expand: ' + esc(sh.caption) + '" title="' + esc(sh.caption) + '">' + ctx.img(sh.src, sh.caption) + '</button><figcaption class="small">' + esc(sh.caption) + '</figcaption>' +
      (s.me && !corrOpen && !P ? '<button class="linkish" data-act="corr-open" data-mode="correct" data-op="screenshot" data-id="' + esc(st.id) + '" data-shot="' + esc(sh.src) + '">' + (st.shots.length === 1 ? 'Replace this screenshot' : 'Replace screenshot ' + (k + 1)) + '</button>' : '') + '</figure>'; }).join('');
    how += fieldsBlock(ctx, r, map, st, t, sched) + (shots ? '<div class="thumbs shots">' + shots + '</div>' : '');
    if (P && (t.id === 'run.process' || t.id === 'run.skill')) how += '<p class="small">Simulated: practice doesn\'t ' + (t.id === 'run.process' ? 'start other runs' : 'run skills') + '. Mark it done for practice.</p>';
    else if (t.id === 'run.process') how += childBox(ctx, r, st, a, rec && work && !(a && (a.s === 'done' || a.s === 'na')));
    else if (t.id === 'run.skill') how += skillBox(ctx, r, st, a);
    /* Timing: elapsed, expected, a deadline copied from the tool, the schedule; Start and Set deadline while it's open. */
    var timing = P ? '' : timerOf(ctx, r, st, a, now) + (sched ? schedBadge(sched) : '') + (st.fields.expect ? '<span class="small">Usually ' + esc(st.fields.expect) + '</span>' : '') +
      (a && a.started && aState !== 'done' && aState !== 'na' ? '<span class="small">' + esc(nameOf(ctx, a.started.by)) + ' started ' + U.hm(a.started.at) + '</span>' : '') +
      (a && a.deadline && aState !== 'done' && aState !== 'na' ? '<span class="small">deadline ' + U.hm(a.deadline.at) + ', copied from the tool</span>' : '');
    var timeActs = '';
    if (rec && work && !P && (!a || a.s === 'open' || a.s === 'recheck')) {
      if (!(a && a.started)) timeActs += '<button class="mini" data-act="start-step" data-id="' + esc(st.id) + '">' + I('clock') + 'Start</button>';
      if (st.fields.deadline && !(a && a.deadline)) timeActs += '<button class="mini" data-act="pick" data-kind="deadline" data-id="' + esc(st.id) + '">Set deadline</button>';
    }
    if (s.pick && s.pick.id === st.id && s.pick.kind === 'deadline') timeActs = '<div class="pick" data-scope="deadline:' + esc(st.id) + '"><label for="pick-input">Deadline from the tool (for example 21:30):</label> <input id="pick-input" class="rw-in" placeholder="21:30" maxlength="8" data-enter="deadline" data-id="' + esc(st.id) + '" style="min-width:90px"><button class="mini" data-act="deadline" data-id="' + esc(st.id) + '">Set</button><button class="mini" data-act="unpick">Cancel</button></div>';
    /* Timing is on show when the checklist times the step, or it's started; otherwise Start waits under More for this step. */
    var timed = !P && !!(timing || st.fields.expect || st.fields.deadline || (s.pick && s.pick.id === st.id && s.pick.kind === 'deadline'));
    if (timed && (timing || timeActs)) how += '<div class="rw-timing"><h4 class="rw-h4">Timing</h4><div class="badges">' + timing + '</div>' + (timeActs ? '<div class="row">' + timeActs + '</div>' : '') + '</div>';
    if (how) h += '<section class="rw-box" aria-labelledby="ins-do"><h3 class="rw-h3" id="ins-do">What to do</h3>' + how + '</section>';
    if (!timed && timeActs) h += '<details class="rw-more" data-disc="rw-more"' + ((s.disc || {})['rw-more'] ? ' open' : '') + '><summary class="small">More for this step</summary><div class="row">' + timeActs + '</div></details>';

    /* Record the result: evidence to type before Done, what was recorded, and Fill in for values known later. */
    var recFields = R.evidenceFor(r, st, R.fieldsOf(r, st), map).list, editable = T.editable(t), showRec = recordShown(ctx, r, map, st.id);
    var dr = (ctx.stepDraft && ctx.stepDraft(st.id)) || { record: {}, fields: {}, note: '' };
    var valueOf = function (d) { return evidenceDefault(ctx, r, st, d); };
    var recBody = '';
    if (s.pick && s.pick.id === st.id && s.pick.kind === 'fields') {
      /* Choices made in this form but not saved yet (an action) decide which other fields and evidence it shows. Evidence
         starts from the step's draft (typed before Fill in opened), so saving the form never drops that typing. */
      /* One source for what's shown and which fields are drawn: the step's draft (typed or chosen), over Fill in's latest
         choices for this folder and run, over what the run says. */
      var fd = s.fieldsDraft && s.fieldsDraft.id === st.id && s.fieldsDraft.key === draftKeyOf(ctx) && s.fieldsDraft.fs === ctx.fsKey ? s.fieldsDraft.values : {}, draft = Object.assign({}, fd);
      Object.keys(dr.fields || {}).forEach(function (k) { if (/^fld-/.test(k)) draft[k.slice(4)] = dr.fields[k]; });
      var eff = R.fieldsOf(r, st), own = (r.fields || {})[st.id] || {}, eff2 = Object.assign({}, eff, draft), recFields2 = P ? [] : R.evidenceFor(r, st, eff2, map).list;
      /* A Jira issue type or status the team's workflows don't have says why beside its box, as soon as it's chosen. */
      var jf = V.jiraFill && !P ? V.jiraFill(r, st, eff2) : null, jid = 'jwhy-' + st.id;
      recBody = '<div class="pick record" data-scope="fields:' + esc(st.id) + '"><span class="small">Fill in or correct this step\'s values for ' + (P ? 'practice' : 'this run') + '. Leave anything you don\'t know yet.</span>' + ferr(s, st.id) +
        T.relevant(t, eff2).concat(jf && T.relevant(t, eff2).indexOf(jf.field) < 0 && T.editable(t).indexOf(jf.field) >= 0 ? [jf.field] : []).filter(function (f) { return !(f === 'carry' && PF.links.has(st)); }).map(function (f) { var d = T.fieldDef(t, f), mine = jf && jf.field === f; return fieldInput('fld-' + f, d, dr.fields['fld-' + f] != null ? dr.fields['fld-' + f] : eff2[f] || '', 'save-fields', st.id, st.fields[f] && own[f] != null ? ' (checklist says: ' + st.fields[f] + ')' : '', mine ? jid : errFor(s, st.id, 'fld-' + f), gField(t, f, eff2)) + (mine ? '<p class="ferr" id="' + esc(jid) + '">' + esc(jf.why) + '</p>' : ''); }).join('') +
        (recFields2.length ? '<span class="small" style="margin-top:4px">Evidence</span>' + recFields2.map(function (d) { return fieldInput('rec-' + d.name, d, dr.fields['rec-' + d.name] != null ? dr.fields['rec-' + d.name] : dr.record['rec-' + d.name] != null ? dr.record['rec-' + d.name] : valueOf(d), 'save-fields', st.id, d.required ? ' (required to check it)' : '', errFor(s, st.id, 'rec-' + d.name), gRecord(t, d, eff2)); }).join('') : '') +
        '<span class="row"><button class="btn" data-act="save-fields" data-id="' + esc(st.id) + '">Save</button><button class="mini" data-act="unpick">Cancel</button></span></div>';
    } else if (showRec) {
      recBody = '<div class="pick record" data-scope="record:' + esc(st.id) + '"><span class="small">' + (recFields.some(function (d) { return d.required; }) ? 'To check this step, record:' : 'You can record:') + '</span>' + ferr(s, st.id) + recFields.map(function (d) {
        return fieldInput('rec-' + d.name, d, dr.record['rec-' + d.name] != null ? dr.record['rec-' + d.name] : valueOf(d), 'record', st.id, d.required ? '' : ' (optional)', errFor(s, st.id, 'rec-' + d.name), gRecord(t, d, R.fieldsOf(r, st)));
      }).join('') + '</div>';
    } else if (a && a.values) {
      var vals = '';
      recFields.forEach(function (d) { var v = a.values[d.name]; if (!v) return; vals += d.kind === 'url' && U.safeUrl(v) ? '<a class="fchip rec" href="' + esc(U.safeUrl(v)) + '" target="_blank" rel="noopener noreferrer"><b>' + esc(d.label) + '</b> open</a>' : '<span class="fchip rec"><b>' + esc(d.label) + ':</b> ' + esc(typedOf(d) ? K.valueText(d, v) : v) + (r._invalid && r._invalid['steps.' + st.id + '.values.' + d.name] ? ' <span class="small">' + esc(r._invalid['steps.' + st.id + '.values.' + d.name].why) + '</span>' : '') + '</span>'; });
      if (vals) recBody = '<div class="fields">' + vals + '</div>';
    }
    var finishing = !P && s.answering && s.answering.key === runKey(r) && s.answering.step === st.id;
    var fillIn = rec && r.state === 'running' && !r.paused && !(P && (P.paused || pm.status === 'assumed')) && R.fillOffered(r, map, st, t, !!P) && !(s.pick && s.pick.id === st.id && s.pick.kind === 'fields') ? (finishing
      ? '<span class="row"><button class="mini" data-act="pick" data-kind="fields" data-id="' + esc(st.id) + '" disabled aria-describedby="fillwhy-' + esc(st.id) + '">' + I('edit') + 'Fill in</button><span class="small" id="fillwhy-' + esc(st.id) + '">Finishing the answer…</span></span>'
      : '<button class="mini" data-act="pick" data-kind="fields" data-id="' + esc(st.id) + '">' + I('edit') + 'Fill in</button>') : '';
    if (recBody || fillIn) h += '<section class="rw-box" aria-labelledby="ins-rec"><div class="row between"><h3 class="rw-h3" id="ins-rec">Record the result</h3>' + fillIn + '</div>' + recBody + '</section>';
    if (V.reportSection && !P) h += V.reportSection(ctx, r, map, st.id);

    /* The actions: Done is the one primary action, kept in reach while long instructions scroll. */
    var acts = '', pick = '';
    if (P) {
      /* Practice: Done (or Done without it, when evidence is asked for), Not needed, Uncheck; and Run from here. */
      var pfill = s.pick && s.pick.id === st.id && s.pick.kind === 'fields', live = work && !P.paused && pm.status !== 'assumed';
      if (live && (!a || a.s === 'open' || a.s === 'recheck')) {
        if (pfill) acts += '<button class="btn go" disabled aria-describedby="donewhy-' + esc(st.id) + '">' + I('check') + 'Done</button><span class="small rw-why-off" id="donewhy-' + esc(st.id) + '">Save or cancel Fill in first.</span>';
        else acts += '<button class="btn go" data-act="' + (showRec ? 'record' : 'toggle') + '" data-id="' + esc(st.id) + '">' + I('check') + (pm.simulated === 'linked' ? 'Mark done for practice' : 'Done') + '</button>';
        /* Whenever the step asks for something (required evidence, or a Jira transition the workflow refuses). */
        if (!pfill && pm.ask) acts += '<button class="btn" data-act="pr-ev-skip" data-id="' + esc(st.id) + '">Done without it</button>';
        if (!st.must) acts += '<button class="mini" data-act="na" data-id="' + esc(st.id) + '">Not needed</button>';
      } else if (live && a.s === 'na') acts += '<button class="btn" data-act="clear" data-id="' + esc(st.id) + '">Undo Not needed</button>';
      else if (live && a.s === 'done') acts += '<button class="mini" data-act="toggle" data-id="' + esc(st.id) + '">Uncheck</button>';
      var from = P.from && P.from.id === st.id;
      if (!from && pm.status !== 'hidden' && !P.paused) acts += '<button class="mini" data-act="pr-from" data-id="' + esc(st.id) + '">Run from here</button>';
      if (acts) h += '<div class="rw-act" role="group" aria-label="Answer this step for practice"><div class="row">' + acts + '</div></div>';
      return h + '</div></aside>';
    }
    if (rec && work) {
      if (!a || a.s === 'open' || a.s === 'recheck') {
        var filling = s.pick && s.pick.id === st.id && s.pick.kind === 'fields';
        if (t.id !== 'run.process' && filling) acts += '<button class="btn go" disabled aria-describedby="donewhy-' + esc(st.id) + '">' + I('check') + 'Done</button><span class="small rw-why-off" id="donewhy-' + esc(st.id) + '">Save or cancel Fill in first.</span>';
        else if (t.id !== 'run.process') acts += showRec ? '<button class="btn go" data-act="record" data-id="' + esc(st.id) + '">' + I('check') + 'Done</button>' : '<button class="btn go" data-act="toggle" data-id="' + esc(st.id) + '">' + I('check') + 'Done</button>';
        if (t.id !== 'run.process' && !filling) acts += '<button class="btn" data-act="corr-open" data-mode="differently" data-id="' + esc(st.id) + '"' + (cf && cf.mode === 'differently' ? ' aria-expanded="true"' : '') + '>Done differently</button>';
        acts += '<button class="btn" data-act="pick" data-kind="block" data-id="' + esc(st.id) + '">Blocked</button>';
        if (!st.must) acts += '<button class="mini" data-act="na" data-id="' + esc(st.id) + '">N/A</button>';
      } else if (a.s === 'blocked') acts += '<button class="btn" data-act="clear" data-id="' + esc(st.id) + '">Unblock</button>';
      else if (a.s === 'na') acts += '<button class="btn" data-act="clear" data-id="' + esc(st.id) + '">Undo N/A</button>';
      else if (a.s === 'done' && t.id !== 'run.process') acts += '<button class="mini" data-act="toggle" data-id="' + esc(st.id) + '">Uncheck</button>';
      if (s.pick && s.pick.id === st.id && s.pick.kind === 'block') pick = '<div class="pick" data-scope="block:' + esc(st.id) + '">What\'s wrong? ' + BLOCK_REASONS.map(function (y) { return '<button class="chipbtn" data-act="block" data-id="' + esc(st.id) + '" data-reason="' + esc(y) + '">' + esc(y) + '</button>'; }).join('') + '<label class="sr" for="pick-input">Why it\'s blocked</label><input id="pick-input" class="rw-in" placeholder="or type a reason, then Enter" maxlength="120" data-enter="block" data-id="' + esc(st.id) + '"><button class="mini" data-act="unpick">Cancel</button></div>';
    }
    if (acts || pick) h += '<div class="rw-act" role="group" aria-label="Answer this step">' + (acts ? '<div class="row">' + acts + '</div>' : '') + pick + '</div>';

    /* Done differently: what happened, said with the answer (or after it), and the correction that went with it if any. */
    if (cf && cf.mode === 'differently') h += composer(ctx, r, map, x, cf);
    else if (rec && !r.paused && R.phaseOpen(r, map, x.phaseIndex) && a && a.s === 'done' && !a.differently && t.id !== 'run.process') h += '<button class="mini" style="align-self:flex-start" data-act="corr-open" data-mode="differently" data-id="' + esc(st.id) + '">Did it differently? Say how</button>';
    var rows = C.forRun(r, map, { at: true }).filter(function (c) { return c.step === st.id; }), idx = rows.length ? corrIndex(ctx, r.process) : {};
    if (a && a.differently) {
      var linked = rows.filter(function (c) { return c.answer && !c.oneOff; })[0];
      h += '<div class="notice rw-diff" style="margin:0"><span><span class="badge b-diff">Done differently</span> · ' + esc(nameOf(ctx, a.differently.by)) + (a.differently.at ? ' · ' + U.hm(a.differently.at) : '') + '<span class="rw-diff-t">' + esc(a.differently.note) + '</span></span><span class="row">' +
        (linked ? '<button class="mini" data-act="goto-corr" data-id="corr-' + esc(PF.search.noteKey(linked.id, linked.noteAt || 1)) + '">View correction</button>' : '') + (rec && !r.paused && a.s === 'done' && R.phaseOpen(r, map, x.phaseIndex) ? '<button class="mini" data-act="toggle" data-id="' + esc(st.id) + '">Change answer</button>' : '') + '</span></div>';
    }
    /* Earlier answers: who, when, values and reasons; older ones from the run's history files on request. */
    /* Each 20 at a time (2.11), in its own order: Earlier answers newest first, Archived answers oldest first. */
    var rk = runKey(r) + ':' + st.id;
    if (a && a.history && a.history.length) h += '<details data-disc="ans:' + esc(st.id) + '"' + ((s.disc || {})['ans:' + st.id] ? ' open' : '') + '><summary class="small" style="cursor:pointer">Earlier answers (' + a.history.length + ')</summary>' + K.list(s, 'ans:' + rk, answerRows(a.history.slice().reverse()), { page: 20, keyOf: function (x) { return x.k; }, focusOf: function (k) { return K.byId('ans-' + st.id + '-' + K.domKey(k)); },
      draw: function (shown) { return '<ul class="tnotes" style="margin-top:8px">' + shown.map(function (x) { var y = x.y;
      return '<li id="' + esc('ans-' + st.id + '-' + K.domKey(x.k)) + '" tabindex="-1">' + avatar(ctx, y.by) + '<div><div class="meta">' + esc(nameOf(ctx, y.by)) + ' · ' + esc(U.when(y.at)) + '</div><div>' + esc({ done: 'Done', na: 'N/A', blocked: 'Blocked', recheck: 'Needed a re-check' }[y.s] || y.s) + (y.reason ? ': ' + esc(y.reason) : '') + (y.values ? ' · ' + esc(Object.keys(y.values).map(function (k) { return k + ' ' + y.values[k]; }).join(', ')) : '') + (y.differently ? ' · done differently: ' + esc(y.differently.note) : '') + '</div></div></li>';
    }).join('') + '</ul>'; } }) + '</details>';
    var arch = s.archive[runKey(r)];
    if (arch) { var mine = arch.filter(function (y) { return y.kind === 'answer' && y.step === st.id; }); if (mine.length) h += '<details open><summary class="small">Archived answers (' + mine.length + ')</summary>' + K.list(s, 'arch:' + rk, answerRows(mine), { page: 20, keyOf: function (x) { return x.k; }, focusOf: function (k) { return K.byId('arch-' + st.id + '-' + K.domKey(k)); },
        draw: function (shown) { return '<ul class="tnotes">' + shown.map(function (x) { var y = x.y; return '<li id="' + esc('arch-' + st.id + '-' + K.domKey(x.k)) + '" tabindex="-1">' + avatar(ctx, y.by) + '<div><div class="meta">' + esc(nameOf(ctx, y.by)) + ' · ' + esc(U.when(y.at)) + '</div><div>' + esc(y.s) + (y.reason ? ': ' + esc(y.reason) : '') + '</div></div></li>'; }).join('') + '</ul>'; } }) + '</details>';
      /* Archived records this copy refused (a newer Flightdeck's) are counted, never hidden. */
      var nr = (arch.refused || []).length; if (nr) h += '<p class="small">' + nr + ' archived record' + (nr === 1 ? ' needs' : 's need') + ' a newer Flightdeck. This copy leaves ' + (nr === 1 ? 'it' : 'them') + ' alone.</p>'; }
    else if (a && a.history && a.history.length >= 10) h += '<button class="mini" style="align-self:flex-start" data-act="load-history">Show older answers</button>';

    /* The note a search or a save showed you (2.11), found again by its whole content after a newer read: an ordinary note
       is kept in the thread below, a correction, fix or map note in Corrections. */
    var ns = s.noteShown && s.noteShown.run === runKey(r) && s.noteShown.step === st.id ? s.noteShown : null, nsAny = ns ? PF.search.noteFind(r._notes || [], ns) : null;
    var nsCorrKind = !!nsAny && (nsAny.n.kind === 'correction' || nsAny.n.kind === 'fix' || nsAny.n.kind === 'map');
    var nsHit = nsAny && !nsCorrKind && nsAny.n.step === st.id ? nsAny : null, nsCorr = nsAny && nsCorrKind ? nsAny : null;
    var nhAny = s.noteHeld && s.noteHeld.run === runKey(r) && s.noteHeld.step === st.id ? PF.search.noteFind(r._notes || [], s.noteHeld) : null;
    var nhCorr = nhAny && (nhAny.n.kind === 'correction' || nhAny.n.kind === 'fix' || nhAny.n.kind === 'map'), nh = nhAny && !nhCorr ? nhAny : null;
    var ci = rows.length ? corrItems(rows) : [];
    /* Notes, with attachments; anyone who has said who they are can add one. */
    /* Corrections to this step from this run, then Correct this step (anyone who has said who they are, whatever the run's state). */
    h += '<section class="rw-box rw-corr" aria-labelledby="ins-corr"><div class="row between"><h3 class="rw-h3" id="ins-corr">Corrections' + (rows.length ? ' · ' + rows.length : '') + '</h3>' +
      (s.me && !(cf && cf.mode === 'correct') ? '<button class="mini" data-act="corr-open" data-mode="correct" data-id="' + esc(st.id) + '" title="If the checklist was wrong or unclear here, correct it. The team reviews corrections on the checklist&#39;s page.">' + I('edit') + 'Correct this step</button>' : '') + '</div>' +
      (rows.length ? K.list(s, 'rcorr:' + rk, ci, { page: 20, hold: false, keep: [nsCorr ? nsCorr.key : null, nhCorr ? nhAny.key : null, oneOffHeld(s, r, ci)].filter(isKey), keptLabel: nsCorr ? 'Shown because you opened it' : 'You\'re on this one', keyOf: function (x) { return x.k; }, focusOf: corrFocus,
        draw: function (shown) { return '<ul class="corrlist">' + shown.map(function (x) { return corrRow(ctx, x.c, idx[x.c.id], { withdraw: true, domId: x.dom }); }).join('') + '</ul>'; } }) : '') +
      (cf && cf.mode === 'correct' ? composer(ctx, r, map, x, cf) : '') + '</section>';
    /* The newest 20 notes, with Show earlier above them (2.11). A note is its id and where it stands among the notes sharing
       that id (PF.search.noteAt), so notes that share an id are told apart. The note a search or a save showed you is drawn
       wherever it sorts, under From earlier, found again by its whole content after a newer read; gone, the line says so. */
    var ats = PF.search.noteAts(r._notes || []), notes = [];
    (r._notes || []).forEach(function (n, i) { if (n.step === st.id && n.kind !== 'correction' && n.kind !== 'fix' && n.kind !== 'map') notes.push({ n: n, key: PF.search.noteKey(n.id, ats[i]) }); });
    var fl = s.flash && s.flash.note && s.flash.note.run === runKey(r) ? PF.search.noteFind(r._notes || [], s.flash.note) : null, flashKey = fl ? fl.key : null, tn = function (key) { return noteDomId(st.id, key); };
    var noteLi = function (x) {
      var n = x.n, made = (r.followUps || []).some(function (f) { return f.from === n.id; });
      PF.perf.add('note.row');
      return '<li id="' + esc(tn(x.key)) + '" tabindex="-1"' + (flashKey === x.key ? ' class="flash"' : '') + '>' + avatar(ctx, n.by) + '<div><div class="meta">' + esc(nameOf(ctx, n.by)) + ' · ' + U.hm(n.at) + '</div><div>' + U.mdInline(n.text) + '</div>' +
        attachments(ctx, n.id, n.files, n.fileInfo, 'note') +
        (rec && r.state === 'running' && n.text ? (made ? '<span class="small">Follow-up added</span>' : '<button class="linkish" data-act="add-followup" data-text="' + esc(n.text.slice(0, 300)) + '" data-step="' + esc(st.id) + '" data-from="' + esc(n.id) + '">Make it a follow-up</button>') : '') + '</div></li>';
    };
    h += '<section class="rw-box rw-notes" aria-labelledby="ins-notes"><h3 class="rw-h3" id="ins-notes">' + (R.solo(r) ? 'Notes' : 'Team notes') + (notes.length ? ' · ' + notes.length : '') + '</h3>' +
      (ns && !nsAny && ns.anchor != null ? '<p class="small tn-gone" role="status">That note isn\'t in this run anymore.</p>' : '') +
      (notes.length ? K.list(s, 'notes:' + rk, notes, { page: 20, tail: true, hold: false, keyOf: function (x) { return x.key; }, focusOf: function (k) { return K.byId(tn(k)); }, keep: [nsHit ? nsHit.key : null, nh && nh.n.step === st.id ? nh.key : null].filter(isKey), keptLabel: 'From earlier',
        gap: function (n) { return n.toLocaleString('en-US') + (n === 1 ? ' note' : ' notes') + ' between'; },
        draw: function (shown) { return '<ul class="tnotes">' + shown.map(noteLi).join('') + '</ul>'; } }) : '');
    if (s.me) {
      var pend = ctx.attachments(runKey(r), st.id), ack = s.noteAck && s.noteAck.key === runKey(r) && s.noteAck.step === st.id;
      h += '<div class="compose" data-drop="note" data-id="' + esc(st.id) + '">' + ferr(s, 'note:' + st.id) + '<label class="small" for="note-text">Add a note</label><textarea id="note-text" data-draft-kept maxlength="2000" rows="3"' + (s.fieldErr && s.fieldErr.id === 'note:' + st.id ? ' aria-invalid="true" aria-describedby="ferr-note:' + esc(st.id) + '"' : '') + ' placeholder="' + (R.solo(r) ? 'What you noticed' : 'What the team should know') + '. Drop, paste or attach files.">' + esc(dr.note || '') + '</textarea>' +
        pendingList(ctx, pend, 'note:' + st.id) +
        '<div class="row"><button class="btn primary" data-act="add-note" data-id="' + esc(st.id) + '">Add note' + (pend.length ? ' with ' + pend.length + ' file' + (pend.length === 1 ? '' : 's') : '') + '</button><label class="btn" for="note-file">' + I('clip') + 'Attach</label><input type="file" id="note-file" accept="' + esc(A.ACCEPT) + '" multiple class="sr" aria-describedby="att-help">' +
        (ack ? '<span class="small rw-ack" role="status">' + I('check') + 'Note added to this step.</span>' : '') + '</div>' +
        (pend.length ? '<p class="small" id="att-help">' + ATT_HELP + '</p>' : '<span class="sr" id="att-help">' + ATT_HELP + '</span>') + '</div>';
    }
    h += '</section>';
    return h + '</div></aside>';
  }

  /* ---------- Phases rail and the checklist ---------- */
  function railHtml(ctx, r, map, nx, schedN, lateN) {
    var s = ctx.state, cur = -1, h = '';
    map.phases.forEach(function (p, pi) { if (cur < 0 && !R.gateOk(R.gateStatus(r, map, pi))) cur = pi; });
    h += '<ol class="rw-phases">' + map.phases.map(function (p, pi) {
      var gst = R.gateStatus(r, map, pi), info = R.phaseInfo(r, map, pi), done = R.gateOk(gst), ps = done ? 'done' : gst === 'locked' ? 'locked' : pi === cur ? 'current' : 'open';
      return '<li><button class="rw-ph" data-act="goto" data-id="phase-' + esc(p.id) + '" data-s="' + ps + '"' + (pi === cur ? ' aria-current="step"' : '') + '><span class="num" aria-hidden="true">' + (done ? '✓' : pi + 1) + '</span><span class="name">' + esc(p.title) + '</span><span class="count" aria-label="' + info.done + ' of ' + info.total + ' answered">' + info.done + '/' + info.total + '</span></button>' +
        '<span class="rw-gate g-' + gst + '">' + I('gate') + '<span>' + esc(p.gate.title) + ' · ' + GATE_WORD[gst] + '</span></span></li>';
    }).join('') + '</ol>';
    return h + (ctx.practice ? '' : utilities(ctx, r, schedN, lateN, 'rail'));
  }
  /* Day timeline and follow-ups, reachable at every width. */
  function utilities(ctx, r, schedN, lateN, where) {
    var s = ctx.state, fus = (r.followUps || []).length, h = '<div class="rw-utils">';
    if (schedN) h += '<button class="mini" data-act="timeline" data-id="' + where + '" aria-expanded="' + !!s.timeline + '" aria-controls="rw-timeline">' + I('timeline') + 'Day timeline · ' + schedN + (lateN ? ' · ' + lateN + ' late' : '') + '</button>';
    h += '<button class="mini" data-act="run-fu" data-id="' + where + '" aria-expanded="' + !!s.fuOpen + '" aria-controls="rw-fu">' + I('flag') + 'Follow-ups · ' + fus + '</button>';
    if (V.reportButton) h += V.reportButton(ctx, r, where);
    return h + '</div>';
  }
  /* The day at a glance: every step and gate with a clock time or an "after start" due time, in order. */
  function timeline(ctx, r, map, items) {
    if (!ctx.state.timeline || !items.length) return '';
    return '<section class="rw-panel" id="rw-timeline" aria-label="Day timeline"><ol class="timeline">' + items.map(function (it) {
      return '<li data-s="' + esc(it.status.replace(/\W+/g, '-')) + '"><span class="tl-time">' + U.hm(new Date(it.ms).toISOString()) + '</span><button class="link" data-act="goto" data-id="' + (it.what === 'gate' ? 'gate-' : 'step-') + esc(it.id) + '">' + esc(it.title) + '</button><span class="small">' + esc(it.phase) + ' · ' + esc((it.kind === 'at' ? 'starts' : 'due') + (SCHED_WORD[it.status] ? ' · ' + SCHED_WORD[it.status] : '')) + '</span></li>';
    }).join('') + '</ol></section>';
  }
  function followUps(ctx, r, rec) {
    if (!ctx.state.fuOpen) return '';
    var xs = PF.followups.forRun(fuList(ctx), r);
    return '<section class="rw-panel" id="rw-fu" aria-label="Follow-ups"><h2 class="rw-h2">Follow-ups</h2>' + (xs.length ? '<ul class="fulist">' + xs.map(function (x) { return fuRow(ctx, x, { remove: rec }); }).join('') + '</ul>' : '<p class="small">None yet. ' + (rec ? 'Make one from a note on a step, or when you finish the run.' : 'The recorder adds them.') + '</p>') + '</section>';
  }
  /* ---------- What became of follow-ups (PF.followups) ---------- */
  var FU_PILL = { open: 'open', done: 'passed', ticket: 'waived', moved: 'waived', wont: 'locked' };
  var FU_FORM = { done: 'Done', ticket: 'Moved to a ticket', moved: 'Moved to another run', wont: 'Won\'t do' };
  /* Every follow-up with where it stands: from the app (worked out once per redraw) or here. */
  function fuList(ctx) { return ctx.followUps ? ctx.followUps() : PF.followups.list(ctx.data.runs, ctx.data.fuDecisions || []); }
  function fuPill(x) { return '<span class="pill ' + (x.tie ? 'review' : FU_PILL[x.status] || 'open') + '">' + esc(x.label) + '</span>'; }
  /* What became of it, with who and when; links stay http(s), runs and plans open in the app. */
  function fuDecided(ctx, x) {
    var d = x.decision;
    if (x.tie) return '<div class="small fu-dec">Two people decided at once. Decide again.</div>';
    if (!d) return '';
    var link = d.link ? '<a href="' + esc(U.safeUrl(d.link)) + '" target="_blank" rel="noopener noreferrer">' + esc(d.link) + '</a>' : '', what;
    if (d.status === 'open') what = 'Reopened';
    else if (d.status === 'done') what = 'Done' + (d.note ? ': ' + esc(d.note) : '') + (link ? ' · ' + link : '');
    else if (d.status === 'ticket') what = 'Moved to ' + (d.ticket ? '<span class="cat">' + esc(d.ticket) + '</span>' : link);
    else if (d.status === 'moved') {
      var to = '';
      if (d.to && d.to.run) { var tr = ctx.findRun ? ctx.findRun(d.to.run) : null; to = tr ? '<button class="linkish" data-act="open-run" data-id="' + esc(d.to.run) + '">' + esc(tr.title) + '</button>' : esc(d.to.run); }
      else if (d.to && d.to.plan) { var pl = (ctx.data.plans || []).filter(function (q) { return q.id === d.to.plan; })[0]; to = pl ? '<button class="linkish" data-act="review-plan" data-id="' + esc(pl.id) + '">' + esc(pl.title) + '</button> (planned)' : 'a planned run'; }
      what = 'Moved to ' + (to || link) + (to && link ? ' · ' + link : '');
    } else what = 'Won\'t do: ' + esc(d.reason);
    return '<div class="small fu-dec">' + what + ' · ' + esc(nameOf(ctx, d.by)) + ' · ' + esc(U.day(d.at)) + '</div>';
  }
  /* One follow-up: what it is, where it stands, and what anyone on the team can say became of it. opts: run (link to its run),
     age (how long it's been open), remove (the recorder's Remove). */
  function fuRow(ctx, x, opts) {
    opts = opts || {};
    var st = ctx.state, f = x.f, me = st.me, pick = st.fuPick && st.fuPick.key === x.key ? st.fuPick : null, days = PF.followups.ageDays(x, ctx.now());
    var meta = [];
    if (x.owner) meta.push(esc(nameOf(ctx, x.owner)));
    if (opts.run) meta.push((x.test ? 'Test run · ' : '') + '<button class="linkish" data-act="open-run" data-id="' + esc(x.runKey) + '">' + esc(x.runTitle) + '</button>');
    if (opts.age && x.status === 'open') meta.push(days === 0 ? 'added today' : 'open ' + days + ' day' + (days === 1 ? '' : 's'));
    var h = '<li class="fu' + (opts.removed ? ' fu-gone' : '') + '" id="fu-' + esc(x.key.replace(/\//g, '--')) + '"><div class="fu-main"><span class="fu-text" id="' + esc(fuTextId(x.key)) + '" tabindex="-1">' + esc(f.text) + (f.ticket ? ' <span class="cat">' + esc(f.ticket) + '</span>' : '') + '</span>' + (opts.removed ? '' : fuPill(x)) +
      (meta.length ? '<span class="small fu-meta">' + meta.join(' · ') + '</span>' : '') + '</div>' + (opts.removed ? '' : fuDecided(ctx, x));
    /* A row kept for its open form (2.11) says when it no longer matches: someone decided it, or it left the folder. */
    if (opts.removed) h += '<p class="small fu-kept" role="note"><b>Removed elsewhere.</b> This follow-up isn\'t in the folder anymore, so what you typed can\'t be saved. Copy it if you need it.</p>';
    else if (pick && x.status !== 'open' && x.decision) h += '<p class="small fu-kept" role="note"><b>No longer open:</b> ' + esc(PF.followups.LABEL[x.status].toLowerCase()) + ' by ' + esc(nameOf(ctx, x.decision.by)) + '</p>';
    var acts = '';
    if (opts.removed) { if (pick && opts.actions !== false) h += fuForm(ctx, x, pick.status, true); return h + '</li>'; }
    if (opts.actions !== false && me && x.decidable) {
      if (x.status === 'open') acts = ['done', 'ticket', 'moved', 'wont'].map(function (k) {
        var on = !!pick && pick.status === k;
        return '<button class="mini" data-act="fu-pick" data-id="' + esc(x.key) + '" data-status="' + k + '" aria-expanded="' + on + '"' + (on ? ' aria-controls="' + PF.followups.formId(x.key) + '-form"' : '') + '>' + FU_FORM[k] + '</button>';
      }).join('');
      if (x.status !== 'open' || x.tie) acts += '<button class="mini" data-act="fu-reopen" data-id="' + esc(x.key) + '"' + (st.fuSaving && st.fuSaving[x.key] ? ' disabled' : '') + '>Reopen</button>';
    }
    if (opts.remove) acts += '<button class="mini" data-act="remove-followup" data-id="' + esc(f.id) + '" aria-label="Remove follow-up: ' + esc(f.text) + '">Remove</button>';
    if (acts) h += '<div class="row fu-acts" role="group" aria-label="' + esc('What became of it: ' + f.text) + '">' + acts + '</div>';
    if (pick && opts.actions !== false) h += fuForm(ctx, x, pick.status);
    return h + '</li>';
  }
  /* The form for one decision. Its element IDs belong to this follow-up (PF.followups.formId), so a box typed in for one
     follow-up is never carried into another's form. Labels above boxes, errors next to their box. */
  function fuForm(ctx, x, status, removed) {
    var st = ctx.state, saving = !!(st.fuSaving && st.fuSaving[x.key]), base = PF.followups.formId(x.key);
    var box = function (part, label, attrs, hint) {
      var id = base + '-' + part, bad = st.fieldErr && st.fieldErr.id === id, desc = [hint ? id + '-hint' : '', bad ? 'ferr-' + id : ''].filter(Boolean).join(' ');
      return '<label class="field" for="' + id + '">' + label + '<input id="' + id + '" ' + attrs + (bad ? ' aria-invalid="true"' : '') + (desc ? ' aria-describedby="' + desc + '"' : '') + ' data-enter="fu-save" data-id="' + esc(x.key) + '"></label>' + (hint ? '<span class="small" id="' + id + '-hint">' + hint + '</span>' : '') + ferr(st, id);
    };
    var h = '<div class="fu-form" id="' + base + '-form" role="group" aria-labelledby="' + base + '-h"><p class="fu-form-h" id="' + base + '-h"><b>' + FU_FORM[status] + '</b><span class="sr">: ' + esc(x.text) + '</span></p>';
    if (status === 'done') h += box('link', 'Link (optional)', 'type="url" maxlength="500" placeholder="https://"', 'Where the work is: a merged pull request, a page, a message.') + box('note', 'Note (optional)', 'maxlength="300"');
    else if (status === 'ticket') h += box('ticket', 'Ticket key or link', 'maxlength="500" placeholder="ABC-123" autocomplete="off"');
    else if (status === 'moved') {
      var toId = base + '-to', bad = st.fieldErr && st.fieldErr.id === toId, pick = st.fuPick && st.fuPick.key === x.key ? st.fuPick : {}, to = pick.to || null;
      var dest = movedTo(ctx, x), chosen = to ? dest.filter(function (it) { return it.v === to.v; })[0] : null, gone = to && !chosen ? destGone(ctx, to) : null;
      /* A run whose file left the folder is still listed (its last copy stays on screen), but chosen, it's said to be gone. */
      if (chosen && (st.missing || {})[to.v]) { gone = destGone(ctx, to, true); dest = dest.filter(function (it) { return it !== chosen; }); }
      /* The chosen destination is drawn whatever Find shows, and, once a newer read has ended, started or removed it, as it
         was, marked; Save sends it as chosen (2.10 checks only that it's a run or plan reference). The saved default stays
         None, so a choice not saved yet is still unsaved work (the page puts it back after each draw). */
      var ms = K.select(st, toId, dest, '', { attrs: bad ? ' aria-invalid="true" aria-describedby="ferr-' + toId + '"' : (gone ? ' aria-describedby="' + toId + '-gone"' : ''), keep: to ? [to.v] : [], cur: to ? to.v : '', noun: 'run or plan', group: function (it) { return it.g; },
        lead: '<option value="">None: I\'ll paste a link</option>' + (gone ? '<option value="' + esc(to.v) + '">' + esc(to.t + ' (' + gone.mark + ')') + '</option>' : '') });
      h += ms.box + '<label class="field" for="' + toId + '">The run or plan it moved to' + ms.select + '</label>' + ms.more + (gone ? '<p class="small fu-gone-to" id="' + toId + '-gone" role="note">' + esc(gone.line) + '</p>' : '') + ferr(st, toId) +
        box('link', 'Or a link (optional)', 'type="url" maxlength="500" placeholder="https://"');
    } else if (status === 'wont') h += box('reason', 'Why won\'t it be done?', 'maxlength="300"', 'Everyone who opens the run sees this.');
    /* A follow-up removed by a newer read can't be decided: what was typed can be copied, and the form closed. */
    if (removed) return h + '<div class="row"><button class="btn" data-act="fu-copy" data-id="' + esc(x.key) + '">Copy my text</button><button class="mini" data-act="fu-cancel" data-id="' + esc(x.key) + '">Cancel</button></div></div>';
    return h + '<div class="row"><button class="btn primary" data-act="fu-save" data-id="' + esc(x.key) + '"' + (saving ? ' disabled' : '') + '>' + (saving ? 'Saving…' : 'Save') + '</button><button class="mini" data-act="fu-cancel" data-id="' + esc(x.key) + '">Cancel</button></div></div>';
  }
  /* Where a follow-up can move to (2.11): running runs and undecided plans, as K.select items. In this order, so the first 50
     are the likeliest: running runs of the same checklist, then other running runs, newest first, then plans, soonest
     first. Find matches a run or plan by its title, key and checklist. */
  function movedTo(ctx, x) {
    var runs = (ctx.data.runs || []).filter(function (r) { return r.state === 'running' && !(r.process === x.process && r.id === x.run); }), plans = (ctx.data.plans || []).filter(function (p) { return !p._status && !p._decidedEarlier && /^[\w-]{1,100}$/.test(p.id || ''); });
    var at = function (r) { return String(r.created || ''); }, when = function (p) { var t = typeof p.when === 'string' ? Date.parse(p.when) : NaN; return isNaN(t) ? Infinity : t; };
    runs = runs.slice().sort(function (a, b) { return (a.process === x.process ? 0 : 1) - (b.process === x.process ? 0 : 1) || (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0); });
    plans = plans.slice().sort(function (a, b) { return when(a) - when(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    return runs.map(function (r) { var t = ctx.processTitle(r.process); return { v: r.process + '/' + r.id, t: r.title, place: t + ' · started ' + U.day(r.created), words: r.process + '/' + r.id + ' ' + t, g: 'Running' }; })
      .concat(plans.map(function (p) { var t = ctx.processTitle(p.process); return { v: 'plan:' + p.id, t: p.title, place: t + (p.when ? ' · ' + U.day(p.when) : ''), words: p.id + ' ' + t, g: 'Planned' }; }));
  }
  /* A chosen destination a newer read took away: how it's marked, and the line under it. */
  function destGone(ctx, to, missing) {
    var plan = /^plan:(.+)$/.exec(to.v);
    if (plan) {
      var pl = (ctx.data.plans || []).filter(function (p) { return p.id === plan[1]; })[0];
      var w = pl && pl._status && pl._status.status === 'declined' ? 'declined' : 'started';
      return pl ? { mark: w, line: w === 'declined' ? 'That plan was declined. Choose where it moved to, or keep it.' : 'That plan has started. Choose where it moved to, or keep it.' } : { mark: 'no longer in the folder', line: 'That plan is no longer in the folder. Saving still records that the work moved there; choose another to change it.' };
    }
    var r = !missing && ctx.findRun ? ctx.findRun(to.v) : null;
    return r ? { mark: 'ended', line: 'That run has ended. Choose where it moved to, or keep it.' } : { mark: 'no longer in the folder', line: 'That run is no longer in the folder. Saving still records that the work moved there; choose another to change it.' };
  }
  /* A follow-up's text, which Show more and focus go to: fu-t- and its key as it is (process/run/id). The key's slashes keep it
     apart from every row's id (fu- and the key with each / as --, which has none) and from every other follow-up's (code
     review round 18). */
  function fuTextId(key) { return 'fu-t-' + key; }
  /* A list of follow-ups a page at a time (2.11): K.list over the rows shown, keeping the one whose form is open wherever it
     is, even when the chip or Find leaves it out (drawn after the list, marked), and from its snapshot when a newer read
     removed it. id: the list's paging id; page: its size. */
  function fuPaged(ctx, id, items, all, o) {
    var st = ctx.state, pick = st.fuPick, key = pick && pick.key, opts = { run: true, age: true };
    var row = function (x) { return fuRow(ctx, x, opts); };
    var h = K.list(st, id, items, { draw: function (shown) { return '<ul class="fulist">' + shown.map(row).join('') + '</ul>'; }, keyOf: function (x) { return x.key; },
      focusOf: function (k) { return K.byId(fuTextId(k)); }, page: o && o.page, keep: key ? [key] : [], empty: '' });
    if (!key || items.some(function (x) { return x.key === key; })) return h;
    var x = all.filter(function (y) { return y.key === key; })[0];
    if (!x && !pick.snap) return h;
    return h + '<p class="small kept-h">You\'re editing this one</p><ul class="fulist">' + (x ? row(x) : fuRow(ctx, pick.snap, { run: true, removed: true })) + '</ul>';
  }
  /* Steps outside any track first, then the phase's tracks side by side: parallel work, all finished before the gate. */
  function stepsHtml(ctx, r, p, row, map, pi) {
    /* Conditions (2.1): steps that aren't needed in this run fold to one quiet line at the end of the phase. */
    var nn = map ? (R.phaseInfo(r, map, pi).notNeeded || []) : [], needed = function (st) { return nn.indexOf(st) < 0; };
    var loose = p.steps.filter(function (st) { return !st.track && needed(st); }), h = loose.length ? '<ul class="steps">' + loose.map(row).join('') + '</ul>' : '';
    var folded = nn.length ? '<details class="folded not-needed"><summary class="small">' + nn.length + ' step' + (nn.length === 1 ? '' : 's') + ' not needed</summary><ul class="small">' + nn.map(function (st) { return '<li>' + K.stepHtml(st, K.refValue(r, map), false) + ' · ' + esc(R.applies(r, map, pi, st).why.replace(/\^/g, '')) + '</li>'; }).join('') + '</ul></details>' : '';
    if (!p.tracks || !p.tracks.length) return h + folded;
    return h + '<div class="tracks">' + p.tracks.map(function (t) {
      var steps = p.steps.filter(function (st) { return st.track === t.id && needed(st); }), done = steps.filter(function (st) { return R.answered(r, st); }).length;
      var who = K.capJoin(t.roles, function (ro) { return r.roles[ro] ? avatar(ctx, r.roles[ro]) + esc(nameOf(ctx, r.roles[ro])) : esc(ro); }, ', ', 'rw-lane-roles');
      return '<section class="track" aria-labelledby="tr-' + esc(t.id) + '"><div class="track-head"><h3 id="tr-' + esc(t.id) + '">' + esc(t.title) + '</h3><span class="small">' + (who ? who + ' · ' : '') + done + '/' + steps.length + '</span></div><ul class="steps">' + steps.map(row).join('') + '</ul></section>';
    }).join('') + '<p class="small tracks-note">Finish every track before the gate.</p></div>' + folded;
  }
  /* "5 done · 1 N/A" for a folded phase. */
  function tally(r, p, info) {
    var c = { done: 0, na: 0, other: 0 }, nn = (info && info.notNeeded) || [];
    p.steps.forEach(function (s) { if (nn.indexOf(s) >= 0) return; var a = r.steps[s.id]; if (a && a.s === 'done') c.done++; else if (a && a.s === 'na') c.na++; else c.other++; });
    return [c.done ? c.done + ' done' : '', c.na ? c.na + ' N/A' : '', c.other ? c.other + ' not answered' : '', nn.length ? nn.length + ' not needed' : ''].filter(Boolean).join(' · ');
  }

  /* The phases rail, the checklist with Next up docked at its top, and the selected step: the same for a run and Practice. */
  function panes(ctx, r, map, rec, nx, items, schedBy, late) {
    var s = ctx.state, P = prOf(ctx);
    /* The checklist. */
    var row = function (p, pi, open) { return function (st) { return stepRow(ctx, r, map, { phase: p, phaseIndex: pi, step: st, sched: schedBy['step:' + st.id] }, rec, open, nx); }; };
    var cur = -1, deck = '';
    map.phases.forEach(function (p, pi) { if (cur < 0 && !R.gateOk(R.gateStatus(r, map, pi))) cur = pi; });
    map.phases.forEach(function (p, pi) {
      var gst = R.gateStatus(r, map, pi), info = R.phaseInfo(r, map, pi), done = R.gateOk(gst), locked = gst === 'locked';
      /* Finished phases and phases that can't start yet fold to one line, so the current phase gets the attention. */
      var open = R.phaseOpen(r, map, pi), folded = (done || locked) && !s.unfold[p.id];
      var one = R.solo(r), hint = p.mode === 'READ-DO' ? (one ? 'Read each step, then do it.' : 'Read each step aloud, then do it.') : p.mode === 'DO-CONFIRM' ? (one ? 'Do the work, then stop and confirm each step.' : 'Do the work, then stop and confirm each step together.') : '';
      /* Conditions (2.1): a phase that isn't needed is its heading and one line saying why; no steps, no gate. */
      if (gst === 'skipped') { deck += '<section class="phase" id="phase-' + esc(p.id) + '" data-s="done" aria-labelledby="ph-' + esc(p.id) + '"><div class="placard"><span class="p-label">Phase ' + (pi + 1) + '</span><h2 class="p-title" id="ph-' + esc(p.id) + '" tabindex="-1">' + esc(p.title) + '</h2></div><div class="folded"><span>Not needed · ' + esc(R.applies(r, map, pi).why.replace(/\^/g, '')) + '</span></div></section>'; return; }
      deck += '<section class="phase" id="phase-' + esc(p.id) + '" data-s="' + (done ? 'done' : locked ? 'locked' : 'open') + '"' + (pi === cur ? ' data-cur="true"' : '') + ' aria-labelledby="ph-' + esc(p.id) + '"><div class="placard"><span class="p-label">Phase ' + (pi + 1) + '</span><h2 class="p-title" id="ph-' + esc(p.id) + '" tabindex="-1">' + esc(p.title) + '</h2><span class="p-count">' + info.done + '/' + info.total + '</span>' +
        (hint && !folded ? '<span class="mode-hint">' + hint + '</span>' : '') + '</div>';
      if (folded) deck += '<div class="folded"><span>' + (locked ? info.total + ' step' + (info.total === 1 ? '' : 's') + ', after the gate above' : tally(r, p, info)) + '</span><button class="mini" data-act="unfold" data-id="' + esc(p.id) + '" aria-expanded="false" aria-controls="phase-' + esc(p.id) + '">' + (locked ? 'Preview steps' : 'Show steps') + '</button></div>';
      else {
        deck += phaseNote(ctx, p);
        if ((done || locked) && s.unfold[p.id]) deck += '<div class="folded"><span>' + (locked ? 'A preview: these open after the gate above.' : tally(r, p, info)) + '</span><button class="mini" data-act="fold" data-id="' + esc(p.id) + '" aria-expanded="true" aria-controls="phase-' + esc(p.id) + '">Hide steps</button></div>';
        deck += stepsHtml(ctx, r, p, row(p, pi, open), map, pi);
      }
      deck += gateBlock(ctx, r, map, pi, rec, schedBy['gate:' + p.gate.id], folded && locked && !(!P && (s.noteCorrs || {})[ctx.fsKey + '\n' + runKey(r) + '|nc:gate:' + p.gate.id])) + '</section>';
    });
    /* A compact Phases picker, timeline and follow-ups for screens too narrow for the rail. */
    /* Every phase in order, the 50 around the current one first, with Find past 50 (K.select); how far each is is worked out
       only for the phases drawn. */
    var phIdx = Object.create(null); map.phases.forEach(function (p, pi) { phIdx[p.id] = pi; });
    var ph = K.select(s, 'rw-phase', map.phases.map(function (p, pi) { return { v: p.id, t: (pi + 1) + '. ' + p.title }; }), cur >= 0 ? map.phases[cur].id : '', { attrs: ' data-bound', around: cur, noun: 'phase', draw: function (it) {
      var pi = phIdx[it.v], p = map.phases[pi], gst = R.gateStatus(r, map, pi), info = R.phaseInfo(r, map, pi);
      return { more: ' · ' + info.done + '/' + info.total + ' · ' + (p.gate.implicit ? 'confirm' : p.gate.title) + ': ' + GATE_WORD[gst].toLowerCase() };
    } });
    var picker = '<div class="rw-picker">' + ph.box + '<label class="small" for="rw-phase">Phase</label>' + ph.select + ph.more + (P ? '' : utilities(ctx, r, items.length, late, 'picker')) + '</div>';
    return '<div class="fpe-panes rw-panes"><nav class="fpe-pane rw-rail" aria-label="Phases"><h2 class="rw-h2">Phases</h2>' + railHtml(ctx, r, map, nx, items.length, late) + '</nav>' +
      '<section class="fpe-pane rw-list" id="rw-list" aria-label="Checklist">' + (selOf(ctx) ? '<button class="linkish rw-skip" data-act="to-ins">Skip to the selected step</button>' : '') + '<div class="rw-dock">' + nextBar(ctx, r, map, nx, rec) + picker + '</div>' + (P ? '' : timeline(ctx, r, map, items) + followUps(ctx, r, rec) + (V.reportPanel ? V.reportPanel(ctx, r, map) : '')) + '<div class="deck">' + deck + '</div></section>' +
      inspector(ctx, r, map, rec) + '</div>';
  }
  /* Practice (2.3): this screen over the draft as it's in the editor. The header and notices are Practice's own
     (views/practice.js); the checklist, gates, Next up and the selected step are the run's, with what a run records left out. */
  function practiceRun(ctx, r, map, P, t, nx, items, schedBy, pct) {
    var h = '<div class="fpe rw pr-run" id="rw">' + V.practiceHead(ctx, P, t, pct);
    h += '<div class="fpe-alerts rw-alerts">' + V.practiceAlerts(ctx, P) + '</div>';
    return h + panes(ctx, r, map, true, nx, items, schedBy, 0) + '</div>';
  }
  function run(ctx) {
    var r = ctx.run(), s = ctx.state;
    if (!r) return K.notices(ctx) + '<div class="panel">That run wasn\'t found. <button class="mini" data-act="home">Back to Home</button></div>';
    var map = mapOf(ctx, r), rec = ctx.recording(r), t = R.totals(r, map), P = prOf(ctx), nx = R.nextUp(r, map, s.me, K.shownOpt(r, map)), hl = nx.hl, now = Date.now();
    var items = P ? [] : R.schedule(r, map, now), schedBy = {}, late = items.filter(function (it) { return it.status === 'late' || it.status === 'started?'; }).length;
    items.forEach(function (it) { schedBy[it.what + ':' + it.id] = it; });
    var pct = t.total ? Math.round(t.done / t.total * 100) : 0, alone = R.solo(r);
    if (P) return practiceRun(ctx, r, map, P, t, nx, items, schedBy, pct);
    /* The header: who it is, how far, and the tools. Three groups that never trade places. */
    var h = '<div class="fpe rw" id="rw"><header class="fpe-head rw-head" role="region" aria-labelledby="run-h"><div class="fpe-id">' +
      '<button type="button" class="btn rw-back" data-act="nav" data-id="runs">' + I('back') + 'Runs</button>' +
      '<div class="fpe-title"><h1 id="run-h" tabindex="-1">' + esc(r.title) + K.testTag(r) + '</h1><span class="small rw-sub">' + esc(map.meta.title) + ' · ' + esc(K.verWord(r)) + ' · started ' + esc(U.when(r.created)) +
      (r.parent ? ' · part of <button class="linkish" data-act="open-run" data-id="' + esc(r.parent.process + '/' + r.parent.id) + '">' + esc((ctx.findRun(r.parent.process + '/' + r.parent.id) || {}).title || r.parent.process) + '</button>' : '') + '</span></div></div>' +
      '<div class="rw-prog"><span class="rw-bar" role="progressbar" aria-label="Steps answered" aria-valuemin="0" aria-valuemax="' + t.total + '" aria-valuenow="' + t.done + '" aria-valuetext="' + t.done + ' of ' + t.total + ' steps answered"><i style="width:' + pct + '%"></i></span><b>' + t.done + '/' + t.total + '</b><span class="small">answered</span></div>' +
      '<div class="rw-tools"><button type="button" class="mini" data-act="run-details" aria-expanded="' + !!s.runDetails + '" aria-controls="rw-details">Details</button>' +
      (alone ? '' : '<button type="button" class="mini" data-act="mission">' + I('screen') + 'Screen share</button>') +
      '<button type="button" class="mini" data-act="receipt">' + I('receipt') + 'Receipt</button>' +
      (rec && hl.s === 'complete' ? '<button type="button" class="btn go" data-act="finish">Finish the run</button>' : '') +
      '<details class="rw-menu" data-disc="rw-menu"' + (s.disc && s.disc['rw-menu'] ? ' open' : '') + '><summary class="mini">More</summary><div class="rw-menu-list">' +
      /* On a phone the header keeps only Runs and More, so Details and Screen share are here too. */
      '<button type="button" class="mini rw-m-phone" data-act="run-details" aria-expanded="' + !!s.runDetails + '">Details</button>' + (alone ? '' : '<button type="button" class="mini rw-m-phone" data-act="mission">' + I('screen') + 'Screen share</button>') + '<button type="button" class="mini rw-m-phone" data-act="receipt">' + I('receipt') + 'Receipt</button>' +
      (rec && hl.s !== 'complete' ? '<button type="button" class="mini" data-act="finish">End run…</button>' : '') + planAgain(ctx, r, 'mini') +
      '<button type="button" class="mini" data-act="copy-run-key" data-id="' + esc(r.process + '/' + r.id) + '">Copy run key</button>' +
      '<button type="button" class="mini" data-act="ev-open" data-id="' + esc(r.process + '/' + r.id) + '">Export evidence…</button><button type="button" class="mini" data-act="refresh">Check the folder now</button><button type="button" class="mini" data-act="health">Folder health</button><button type="button" class="mini" data-act="help">Keyboard shortcuts</button></div></details>' +
      (s.me ? '<span class="rw-me" title="Everything you do here is stamped with your name">You: <b>' + esc(nameOf(ctx, s.me)) + '</b></span>' : '') + '</div></header>';
    h += strip(ctx, r);
    /* Messages, a failed save, folder trouble, conflicts and Details stay in view, right under the strip. */
    var al = '';
    if (s.msg && !s.msg.quiet) al += '<div class="notice ' + (s.msg.kind || '') + '" role="status"><span>' + esc(s.msg.text) + '</span><span class="row">' + (s.msg.act ? '<button class="btn" data-act="' + esc(s.msg.act) + '">' + esc(s.msg.label) + '</button>' : '') + '<button class="mini" data-act="dismiss">Dismiss</button></span></div>';
    if (s.unsaved[r.id]) al += '<div class="notice bad" role="alert"><span><b>Your last change isn\'t saved.</b> ' + esc(s.saveErr[r.id] || '') + ' It\'s on this screen but not in the team folder' + (r.ended ? ', so the run hasn\'t really ended yet' : '') + '. Try again, or discard it, from the bar above.</span></div>';
    /* Part of the folder, or this run's own file, couldn't be read on the last check: what's shown is the last version read. */
    if ((s.missing || {})[runKey(r)]) al += '<div class="notice bad rw-gone" role="alert"><span><b>This run\'s file is gone from the team folder.</b> Someone may have deleted or moved it. You\'re seeing the version this window read; nothing is saved, so a deletion is never undone by accident.</span><span class="row">' + (ctx.canRecover(r) ? '<button class="btn" data-act="restore-missing">Restore it here</button>' : '') + '<button class="mini" data-act="recovery" data-id="a-runs-file-is-gone">What to do</button></span></div>';
    var ownWhy = ((s.unread || {}).runs || {})[runKey(r)], parts = Object.keys(ctx.data.failed || {});
    if (!s.folderErr && (ownWhy || parts.length)) al += '<div class="notice bad rw-partial" role="alert"><span>' + (ownWhy ? '<b>This run\'s file couldn\'t be read on the last check</b> (' + esc(ownWhy) + '). You\'re seeing the version read before, and nothing is saved over the file until it reads again.' : '<b>Part of the team folder couldn\'t be read</b> (' + esc(parts.join(', ')) + '). You\'re seeing what was read before' + (parts.indexOf('runs') >= 0 ? ', and changes to runs wait until they read again' : '') + '.') + '</span><span class="row"><button class="btn" data-act="refresh">Try again</button><button class="mini" data-act="recovery" data-id="' + (ownWhy ? 'a-file-cant-be-read' : 'onedrive-isnt-syncing') + '">What to do</button></span></div>';
    if (s.folderErr) al += '<div class="notice bad" role="alert"><span><b>Can\'t read the team folder.</b> ' + esc(s.folderErr) + ' You\'re seeing what was last read at ' + U.hm(ctx.data.readAt) + '. Check that OneDrive is running and the folder is available offline.</span><button class="btn" data-act="refresh">Try again</button></div>';
    /* A Done differently whose correction was saved but whose answer couldn't be: said here until someone acts. */
    var part = (s.partial || {})[runKey(r)], pa = part && r.steps[part.step];
    if (part && !(pa && pa.s === 'done' && pa.differently)) { var px = M.findStep(map, part.step); al += '<div class="notice warn" role="status"><span><b>Correction saved; the step wasn\'t marked done.</b> ' + (px ? K.stepHtml(px.step, K.refValue(r, map)) : esc(part.step)) + '</span><span class="row">' + (rec && px ? '<button class="btn" data-act="corr-open" data-mode="differently" data-id="' + esc(part.step) + '">Mark it now</button>' : '') + '<button class="mini" data-act="partial-dismiss" data-id="' + esc(runKey(r)) + '">Dismiss</button></span></div>'; }
    /* A note line that isn't complete JSON (2.1.1): named, never guessed at; the rest of the notes show. */
    /* More than one is one notice, announced once, with the lines in a fold 50 at a time (2.11). */
    var nl = r._noteLines || [];
    if (nl.length === 1) al += '<div class="notice warn" role="status"><span>' + esc(PF.health.noteLineText(nl[0])) + '</span></div>';
    else if (nl.length) {
      var nd = 'badnotes:' + runKey(r), nOpen = !!(s.disc || {})[nd];
      al += '<div class="notice warn rw-badnotes"><span><b role="status">' + nl.length.toLocaleString('en-US') + ' note lines can\'t be read.</b> They may still be arriving; if they stay, the notes on those lines are lost and the rest are shown.' +
        '<details data-disc="' + esc(nd) + '"' + (nOpen ? ' open' : '') + '><summary class="small">Which lines</summary>' +
        K.list(s, 'badnotes', badRows(nl), { keyOf: function (y) { return y.k; }, focusOf: function (k) { return K.byId('badnote-' + K.domKey(k)); }, draw: function (shown) { return '<ul class="small">' + shown.map(function (y) { return '<li id="badnote-' + K.domKey(y.k) + '" tabindex="-1"><code>' + esc(y.x.file) + '</code>, line ' + esc(y.x.line) + '</li>'; }).join('') + '</ul>'; } }) +
        '</details></span></div>';
    }
    al += recovery(ctx, r, ctx.canRecover(r));
    if (K.connBanner) al += K.connBanner(ctx);
    if (s.runDetails) al += details(ctx, r, map, rec);
    h += '<div class="fpe-alerts rw-alerts">' + al + '</div>';
    return h + panes(ctx, r, map, rec, nx, items, schedBy, late) + '</div>';
  }

  /* What an evidence box shows before anything is typed: the saved value, else one a Jira workflow fills in from the run. */
  function evidenceDefault(ctx, r, s, d) {
    var a = r.steps[s.id], saved = a && a.values && a.values[d.name];
    if (saved) return saved;
    return d.source ? PF.jira.resolve(d.source, r.details, function (ro) { return r.roles[ro] ? nameOf(ctx, r.roles[ro]) : ''; }) : '';
  }
  V.evidenceDefault = evidenceDefault;
  V.run = run; V.recordShown = recordShown; V.runSel = selOf; K.ferr = ferr; K.fieldInput = fieldInput;
})();
