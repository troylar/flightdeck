/* The run screen, a page of its own: a slim header, the status strip (who records, what's saved), messages and conflicts
   under it, then three panes that each scroll on their own: Phases, the checklist (with Next up pinned at its top) and the
   selected step. On a phone the checklist scrolls with the page and the selected step opens as a full-screen sheet. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, R = PF.run, M = PF.map, T = PF.types, A = PF.attach, I = PF.icons.icon, esc = U.esc;
  var nameOf = K.nameOf, avatar = K.avatar, runKey = K.runKey, freshness = K.freshness;
  var BLOCK_REASONS = ['Failed', 'Waiting on someone', 'Not sure it passed'];
  var STATE_WORD = { open: 'not checked', done: 'done', na: 'not applicable', blocked: 'blocked', recheck: 'needs a re-check' };
  var GATE_WORD = { passed: 'Passed', waived: 'Waived', failed: 'Failed', review: 'Needs review', ready: 'Ready', open: 'Waiting on steps', locked: 'Locked' };
  /* The error points at its own field when core named one; otherwise at every field in the form. */
  function errFor(st, stepId, inputId) { var e = st.fieldErr; return e && e.id === stepId && (!e.field || e.field === inputId) ? 'ferr-' + stepId : ''; }
  function ferr(st, id) { return st.fieldErr && st.fieldErr.id === id ? '<p class="ferr" id="ferr-' + esc(id) + '" role="alert">' + esc(st.fieldErr.msg) + '</p>' : ''; }
  function fieldInput(id, d, value, enter, stepId, note, errId) {
    /* A hint (from a Jira workflow, for example) says what the value should be or where it comes from. */
    var hintId = d.hint ? 'hint-' + id : '', described = [errId, hintId].filter(Boolean).join(' ');
    var lab = '<label class="small" for="' + esc(id) + '">' + esc(d.label) + esc(note || '') + '</label>' + (d.hint ? '<span class="small hint" id="' + esc(hintId) + '">' + esc(d.hint) + '</span>' : ''),
      bad = (errId ? ' aria-invalid="true"' : '') + (described ? ' aria-describedby="' + esc(described) + '"' : '');
    if (d.kind === 'choice') return '<span class="rf">' + lab + '<select id="' + esc(id) + '"' + bad + '><option value="">Choose…</option>' + (d.options || []).map(function (o) { return '<option' + (String(o).toLowerCase() === String(value || '').trim().toLowerCase() ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></span>';
    if (d.kind === 'message' || d.kind === 'code' || d.long) return '<span class="rf">' + lab + '<textarea id="' + esc(id) + '"' + bad + ' maxlength="300" rows="' + (d.long ? 3 : 2) + '">' + esc(value) + '</textarea></span>';
    return '<span class="rf">' + lab + '<input id="' + esc(id) + '"' + bad + ' maxlength="' + (d.max || 300) + '" value="' + esc(value) + '" data-enter="' + esc(enter) + '" data-id="' + esc(stepId) + '"' + (d.kind === 'url' ? ' type="url" placeholder="https://"' : '') + '></span>';
  }
  /* Step text inside a button: the same escaped Markdown, without links (a link can't sit inside a button). */
  function inlineText(t) { return U.mdInline(t).replace(/<a\b[^>]*>|<\/a>/g, ''); }
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
    return R.evidenceFor(r, x.step).list.length > 0;
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
    var aState = stateOf(r, s), sel = selOf(ctx) === s.id, isNext = !!(nx && nx.step && nx.step.id === s.id);
    var who = s.roles.map(function (ro) { return r.roles[ro] ? nameOf(ctx, r.roles[ro]) : '@' + ro; }).join(', ');
    var meta = '<span class="type">' + I(t.icon) + esc(t.label) + '</span>' + (who ? '<span class="s-who">' + esc(who) + '</span>' : '');
    /* Target details that tell two similar steps apart (an environment, a job) stay on the row. */
    var eff = R.fieldsOf(r, s), shown = 0;
    Object.keys(eff).forEach(function (f) {
      var def = T.fieldDef(t, f), v = def && eff[f] ? R.fill(eff[f], r.details) : ''; if (!v || shown >= 2 || v.length > 32 || (def.kind !== 'text' && def.kind !== 'choice') || /^(expect|deadline|require|at|due|after|evidence|sets|carry)$/.test(f)) return;
      shown++; meta += '<span class="s-field">' + esc(def.label) + ' ' + esc(v) + '</span>';
    });
    var badges = (s.must ? '<span class="badge b-must">Must do</span>' : '') + (s.planned ? '<span class="badge b-plan">Automation planned</span>' : '') +
      (aState === 'recheck' ? '<span class="badge b-warn">Re-check: ' + esc(a.reason) + '</span>' : '') +
      (aState === 'blocked' ? '<span class="badge b-stop">Blocked · ' + esc(a.reason) + '</span>' : '') +
      (aState === 'na' ? '<span class="badge b-ref">N/A</span>' : '') +
      (a && a.differently ? '<span class="badge b-diff" title="' + esc(a.differently.note) + '">Done differently</span>' : '') +
      (x.sched ? schedBadge(x.sched) : '') + timerOf(ctx, r, s, a, now);
    var notes = (r._notes || []).filter(function (n) { return n.step === s.id && n.kind !== 'correction' && n.kind !== 'fix' && n.kind !== 'map'; }).length, dr = ctx.stepDraft && ctx.stepDraft(s.id);
    var nc = (r._notes || []).filter(function (n) { return n.step === s.id && (n.kind === 'correction' || n.kind === 'fix' || n.kind === 'map'); }).length;
    if (nc) badges += '<span class="badge b-corr">' + (nc === 1 ? 'Correction proposed' : nc + ' corrections') + '</span>';
    if (changedHere(ctx, r)[s.id]) badges += '<span class="badge b-changed">Changed in v' + esc(r.version) + '</span>';
    if (dr && (dr.open || String(dr.note || '').trim() || Object.keys(dr.record).length || Object.keys(dr.fields).length)) badges += '<span class="s-draft">Draft</span><span class="sr"> (typed, not saved yet)</span>';
    if (notes) badges += '<span class="s-notes">' + I('note') + notes + '<span class="sr"> note' + (notes === 1 ? '' : 's') + '</span></span>';
    var stamp = a && (a.s === 'done' || a.s === 'na') ? '<span class="stamp">' + avatar(ctx, a.by) + ' ' + U.hm(a.at) + '</span>' : '';
    var flash = st.flash && st.flash.ids && st.flash.ids.indexOf(s.id) >= 0;
    var canCheck = rec && open && t.id !== 'run.process';
    return '<li class="step' + (sel ? ' sel' : '') + (isNext ? ' next' : '') + (flash ? ' flash' : '') + '" data-a="' + esc(aState) + '" id="step-' + esc(s.id) + '">' +
      '<button class="check" role="checkbox" aria-checked="' + (aState === 'done') + '" aria-label="' + esc(s.text) + ', ' + esc(STATE_WORD[aState] || aState) + (s.must ? ', must do' : '') + '" data-act="toggle" data-id="' + esc(s.id) + '"' + (canCheck ? '' : ' disabled') + (t.id === 'run.process' ? ' title="Checked when its linked run completes"' : '') + '>' + I('check') + '</button>' +
      '<button class="s-pick" data-act="select" data-id="' + esc(s.id) + '" aria-pressed="' + sel + '" aria-controls="rw-ins">' + (isNext ? '<span class="s-next">Next</span>' : '') + '<span class="s-text">' + inlineText(s.text) + '</span><span class="s-meta">' + meta + '</span>' + (badges ? '<span class="badges">' + badges + '</span>' : '') + '</button>' +
      stamp + '</li>';
  }

  /* A step that starts another process: the linked child run, or the button that starts it. What starting it passes on is
     worked out the same way the start does. */
  function passesOn(r, s, pub) {
    var problem = R.childProblem(r, s, pub.map.meta.context);
    if (problem) return problem;
    var d = R.childDetails(r, s, pub.map.meta.context), keys = Object.keys(d);
    return keys.length ? 'Passes on ' + keys.map(function (k) { return k + (d[k] ? ' ' + d[k] : ' (empty)'); }).join(', ') : 'Passes on no details';
  }
  function childBox(ctx, r, s, a, canStart) {
    var proc = R.fieldsOf(r, s).process, child = a && a.child, key = child && child.process + '/' + child.id, cr = child && ctx.findRun(key);
    /* A child run that names this step as its parent but isn't the linked one (its link didn't land): offer to link it,
       unless the linked child is still current. */
    var orphan = (ctx.data.runs || []).filter(function (x) { return x.parent && x.parent.process === r.process && x.parent.id === r.id && x.parent.step === s.id && !(child && child.process === x.process && child.id === x.id) && !(x.ended && (R.childVerdict(r, s, { child: { process: x.process, id: x.id, inputs: x.parent.inputs || {} } }, x) || {}).s !== 'done') && R.childCurrent(r, s, { child: { process: x.process, inputs: x.parent.inputs || {} } }); })
      .sort(function (p1, p2) { return p1.created < p2.created ? 1 : -1; })[0];
    if (orphan && canStart && !(child && R.childCurrent(r, s, a) && !child.failed)) return '<div class="childbox">' + I('nest') + '<span>"' + esc(orphan.title) + '" was started for this step but isn\'t linked.</span><button class="btn" data-act="link-child" data-id="' + esc(s.id) + '" data-child="' + esc(orphan.process + '/' + orphan.id) + '">Link it</button></div>';
    if (child) {
      var state = cr ? (cr.ended ? cr.ended.outcome : R.headline(cr, R.mapOf(cr)).text) : 'not visible in this folder yet', fresh = R.childCurrent(r, s, a) && !child.failed;
      var again = !fresh && canStart && ctx.latestPub(proc) ? '<button class="btn" data-act="start-child" data-id="' + esc(s.id) + '">Start a new ' + esc(ctx.latestPub(proc).map.meta.title) + ' run</button>' : '';
      return '<div class="childbox">' + I('nest') + '<span>Child run: <b>' + esc(cr ? cr.title : child.process) + '</b> · ' + esc(state) + (fresh ? '' : child.failed ? '. It didn\'t complete as started, so it doesn\'t count for this step.' : '. The details it was started for have changed, so it no longer counts for this step.') + '</span>' + (cr ? '<button class="mini" data-act="open-run" data-id="' + esc(key) + '">Open run</button>' : '') + again + '</div>';
    }
    var pub = ctx.latestPub(proc);
    if (a && (a.s === 'done' || a.s === 'na')) return '';
    if (!canStart) return '<div class="childbox">' + I('nest') + '<span>Starts a <b>' + esc(proc || '?') + '</b> run when this step is reached.</span></div>';
    return '<div class="childbox">' + I('nest') + (pub ? '<button class="btn go" data-act="start-child" data-id="' + esc(s.id) + '">Start the ' + esc(pub.map.meta.title) + ' run</button><span class="small">' + esc(passesOn(r, s, pub)) + '. This step is checked when it completes.</span>' : '<span class="small">"' + esc(proc || '?') + '" isn\'t published in this folder yet.</span>') + '</div>';
  }

  /* The approval a gate recorded, as one sentence: who, when, and the exact details it was for. */
  function gateReceipt(ctx, rec2, st) {
    if (!rec2 || !rec2.by) return '';
    return esc(GATE_WORD[st] || st) + (st === 'review' ? ' (was ' + esc((rec2.s === 'review' ? rec2.was : rec2.s) || 'passed') + ')' : '') + ' by ' + esc(nameOf(ctx, rec2.by)) + ' at ' + U.hm(rec2.at) +
      (rec2.approved && Object.keys(rec2.approved).length ? ' for ' + esc(Object.keys(rec2.approved).map(function (k) { return k + ' ' + (rec2.approved[k] || '(not set)'); }).join(' · ')) : '') + (rec2.reason ? ': ' + esc(rec2.reason) : '');
  }
  function gateBlock(ctx, r, map, pi, rec, sched) {
    var g = map.phases[pi].gate, st = R.gateStatus(r, map, pi), rec2 = r.gates[g.id], s = ctx.state, owner = g.owner && r.roles[g.owner], info = R.phaseInfo(r, map, pi);
    var approves = g.approves ? R.fill(g.approves, r.details) : '';
    var h = '<div class="gate" data-scope="gate:' + esc(g.id) + '" data-s="' + st + '" id="gate-' + esc(g.id) + '"><div class="stack" style="gap:4px"><div class="gate-title">' + I('gate') + '<span>' + (g.implicit ? (R.solo(r) ? 'Confirm' : 'Confirm together') : 'Gate: ' + esc(g.title)) + '</span><span class="pill ' + st + '">' + GATE_WORD[st] + '</span>' +
      (st === 'passed' && s.justPassed === g.id ? '<span class="called-stamp">Passed</span>' : '') + '</div>';
    if (approves) h += '<div class="q">Approves ' + U.mdInline(approves) + '</div>';
    if (owner) h += '<div class="small">Owner: ' + esc(nameOf(ctx, owner)) + '</div>';
    if (sched) h += '<div class="badges">' + schedBadge(sched) + '</div>';
    if (rec2 && rec2.by && (st === 'passed' || st === 'waived' || st === 'failed' || st === 'review')) h += '<div class="small g-rec">' + gateReceipt(ctx, rec2, st) + '</div>';
    h += '</div><div class="row">';
    if (rec && r.state === 'running' && !r.paused) {
      if (s.pick && s.pick.id === g.id && s.pick.kind === 'pass') h += '<span class="q"><b>' + (approves ? 'Approve ' + U.mdInline(approves) + '?' : 'Pass "' + esc(g.title) + '"?') + '</b></span><button class="btn go" data-act="pass" data-id="' + pi + '">Yes, pass it</button><button class="mini" data-act="unpick">Cancel</button>';
      else if (s.pick && s.pick.id === g.id && (s.pick.kind === 'waive' || s.pick.kind === 'fail')) h += '<label class="sr" for="pick-input">' + (s.pick.kind === 'waive' ? 'Why waive it?' : 'What failed?') + '</label><input id="pick-input" class="rw-in" placeholder="' + (s.pick.kind === 'waive' ? 'Why waive it?' : 'What failed?') + '" maxlength="200" data-enter="' + s.pick.kind + '" data-id="' + pi + '"><button class="btn ' + (s.pick.kind === 'fail' ? 'stop' : '') + '" data-act="' + s.pick.kind + '" data-id="' + pi + '">' + (s.pick.kind === 'waive' ? 'Waive' : 'Fail') + '</button><button class="mini" data-act="unpick">Cancel</button>';
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
        if (st !== 'locked' && st !== 'failed' && st !== 'passed' && st !== 'waived') h += '<button class="mini" data-act="pick" data-kind="fail" data-id="' + esc(g.id) + '">Fail</button>';
        if (st === 'passed' || st === 'waived' || st === 'failed' || st === 'review') h += '<button class="mini" data-act="reopen" data-id="' + pi + '">Reopen</button>';
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
    if (rp === me && !r.recorder.session) return { text: '<b>Recording is waiting for you</b> · revision ' + (r.rev || 0) + '. Pick it up to check steps in this window.', ctl: '<button class="btn go" data-act="pickup">Pick up recording</button>' };
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
    else if (r.ended) { kind = 'ended'; text = '<b>Ended: ' + esc(r.ended.outcome) + '</b>' + (r.ended.byName || r.ended.by ? ' by ' + esc(r.ended.byName || nameOf(ctx, r.ended.by)) : '') + (r.ended.at ? ' at ' + U.hm(r.ended.at) : '') + '.'; ctl = '<button class="btn go" data-act="receipt">' + I('receipt') + 'Receipt</button>'; }
    else if (!s.me) {
      kind = 'who'; text = '<b>Choose who you are</b> to record or add notes. Everything you do here is stamped with your name.';
      var people = ctx.data.people.filter(function (p) { return !p.inactive; });
      ctl = people.length ? '<label class="sr" for="me-run">You are</label><select id="me-run"><option value="">Choose…</option>' + people.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(PF.people.label(p, people)) + '</option>'; }).join('') + '</select>' : '<label class="sr" for="me-run">Your name</label><input id="me-run" class="rw-in" placeholder="Your name" maxlength="40">';
    } else if (r.paused) {
      kind = 'paused';
      text = I('pause') + ' <b>Paused</b> by ' + esc(nameOf(ctx, r.paused.by)) + ' at ' + U.hm(r.paused.at) + ': ' + esc(r.paused.reason) + '. Steps, gates and timers wait until it\'s resumed; deadlines from other tools keep counting.';
      if (rec) ctl = '<button class="btn go" data-act="resume">Resume</button>';
      else { var o = ownership(ctx, r); text += ' ' + o.text; ctl = o.ctl; }
    } else if (rec) {
      kind = 'rec';
      text = (solo ? '<b>Your run</b>' : '<b>You\'re recording</b>') + ' · revision ' + (r.rev || 0);
      var pause = s.pick && s.pick.kind === 'pause' ? '<span class="row rw-ask" data-scope="pause"><label class="sr" for="pick-input">Why pause?</label><input id="pick-input" class="rw-in" placeholder="Why pause? (what are we waiting for)" maxlength="120" data-enter="pause" data-id="run"><button class="mini" data-act="pause">Pause</button><button class="mini" data-act="unpick">Cancel</button></span>'
        : '<button class="mini" data-act="pick" data-kind="pause" data-id="run">' + I('pause') + 'Pause</button>';
      var people2 = ctx.data.people.filter(function (p) { return !p.inactive && p.id !== s.me; });
      var hand = s.pick && s.pick.kind === 'handoff' ? '<span class="row rw-ask"><label class="sr" for="handoff-to">Hand recording to</label><select id="handoff-to">' + people2.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(PF.people.label(p, people2)) + '</option>'; }).join('') + '</select><button class="mini" data-act="handoff">Hand off</button><button class="mini" data-act="unpick">Cancel</button></span>'
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
    var map = R.mapOf(r), keys = map.meta.context.filter(function (f) { return r.details[f]; });
    if (!keys.length) return '';
    return '<div class="rw-chips">' + keys.map(function (f) { return '<span class="rw-chip"><span class="k">' + esc(f) + '</span> <code>' + esc(r.details[f]) + '</code></span>'; }).join('') + '</div>';
  }

  /* Conflict copies and copies kept in this browser, side by side with what's current, with a way to keep or delete each. */
  function recovery(ctx, r, rec) {
    var s = ctx.state, copies = r._conflicts || [], local = ctx.localCopy(r);
    if (!copies.length && !local) return '';
    var h = '<section class="notice bad recovery" aria-labelledby="rec-t"><div class="stack" style="gap:8px;width:100%"><h3 id="rec-t" tabindex="-1" style="margin:0">' + (copies.length + (local ? 1 : 0)) + ' other version' + (copies.length + (local ? 1 : 0) === 1 ? '' : 's') + ' of this run</h3>' +
      '<span class="small">Two computers saved at once, or a save couldn\'t be written. Compare, keep the right one, and delete the rest. Nothing is merged automatically. <button type="button" class="linkish" data-act="recovery" data-id="a-run-has-conflict-copies">What to do</button></span>';
    copies.forEach(function (name) {
      var open = s.copyView && s.copyView.name === name && s.copyView.key === runKey(r);
      h += '<div class="copyrow"><code>' + esc(name) + '</code><span class="row"><button class="mini" data-act="compare-copy" data-id="' + esc(name) + '">' + (open ? 'Compared' : 'Compare') + '</button>' +
        (rec ? '<button class="mini" data-act="use-copy" data-id="' + esc(name) + '">Keep this one</button>' : '') +
        (s.pick && s.pick.kind === 'delete-copy' && s.pick.id === name ? '<button class="btn stop" data-act="delete-copy" data-id="' + esc(name) + '">Yes, delete it</button><button class="mini" data-act="unpick">Cancel</button>' : '<button class="mini" data-act="delete-copy" data-id="' + esc(name) + '">Delete</button>') + '</span></div>';
      if (open) h += s.copyView.lines ? '<ul class="small difflist">' + s.copyView.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : '<p class="small">That copy can\'t be read.</p>';
    });
    if (local) h += '<div class="copyrow"><span>A copy kept in this browser (' + esc(U.when(local.savedAt || local.created)) + ')</span><span class="row">' + (rec ? '<button class="mini" data-act="restore-local">Restore it</button>' : '') + '<button class="mini" data-act="discard-local">Discard</button></span></div>';
    if (!rec && copies.length) h += '<span class="small">' + (r.ended ? 'Only whoever recorded or ended this run can keep a copy' : 'Only the recorder can keep a copy') + '; anyone can compare.</span>';
    return h + '</div></section>';
  }

  /* Details: every run detail and role, editable by the recorder as before, and where this run sits. */
  function details(ctx, r, map, rec) {
    var s = ctx.state;
    var det = map.meta.context.map(function (f) {
      if (s.edit === 'detail:' + f && rec) return '<span class="inline-edit" data-scope="edit:detail:' + esc(f) + '"><label class="small" for="edit-input">' + esc(f) + '</label><input id="edit-input" maxlength="120" value="' + esc(r.details[f]) + '" data-enter="save-edit"><button class="mini" data-act="save-edit">Save</button><button class="mini" data-act="unedit">Cancel</button></span>';
      return '<button class="chip' + (r.details[f] ? '' : ' empty') + '" data-act="edit" data-id="detail:' + esc(f) + '"' + (rec ? '' : ' disabled') + '><span class="k">' + esc(f) + '</span>' + (r.details[f] ? '<span class="v">' + esc(r.details[f]) + '</span>' : 'set') + '</button>';
    }).join('');
    var roles = map.meta.roles.map(function (ro) {
      if (s.edit === 'role:' + ro && rec) return '<span class="inline-edit" data-scope="edit:role:' + esc(ro) + '"><label class="small" for="edit-input">' + esc(ro) + '</label><select id="edit-input"><option value="">Nobody</option>' + ctx.data.people.filter(function (p) { return !p.inactive; }).map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === r.roles[ro] ? ' selected' : '') + '>' + esc(PF.people.label(p, ctx.data.people)) + '</option>'; }).join('') + '</select><button class="mini" data-act="save-edit">Save</button><button class="mini" data-act="unedit">Cancel</button></span>';
      return '<button class="chip' + (r.roles[ro] ? '' : ' empty') + '" data-act="edit" data-id="role:' + esc(ro) + '"' + (rec ? '' : ' disabled') + '><span class="k">' + esc(ro) + '</span>' + (r.roles[ro] ? avatar(ctx, r.roles[ro]) + esc(nameOf(ctx, r.roles[ro])) : 'assign') + '</button>';
    }).join('');
    /* Solo runs keep collaboration out of the way: roles appear only if someone asks for them. */
    var alone = R.solo(r), roleRow = map.meta.roles.length ? (alone && !s.showRoles ? (rec ? '<button class="mini" data-act="show-roles">' + I('people') + 'Add people</button>' : '') : roles) : '';
    var h = '<section class="rw-details" id="rw-details" aria-labelledby="rw-det-h"><h2 id="rw-det-h" class="rw-h2" tabindex="-1">Details</h2>' +
      '<p class="small">' + esc(map.meta.title) + ' · v' + esc(r.version) + ' · started ' + esc(U.when(r.created)) + ' · recorded by ' + esc(nameOf(ctx, r.recorder.person)) + '</p>' +
      (det ? '<div class="chips" role="group" aria-label="Run details">' + det + '</div>' : '') + (roleRow ? '<div class="chips" role="group" aria-label="Roles">' + roleRow + '</div>' : '') +
      (rec ? '<p class="small">Changing a detail sends steps that used it back for a re-check, and gates that approved it need review.</p>' : '');
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
  function nextBar(ctx, r, map, nx, rec) {
    var s = ctx.state, hl = nx.hl, hint = '', main = '', btn = '';
    if (nx.kind === 'ended') { hint = 'This run has ended'; main = hl.text; }
    else if (nx.kind === 'paused') { hint = 'Paused'; main = r.paused.reason; btn = rec ? '<button class="btn go" data-act="resume">Resume</button>' : ''; }
    else if (nx.kind === 'blocked') { hint = 'Stopped · blocked (' + (r.steps[nx.step.id] || {}).reason + ')'; main = nx.step.text; btn = '<button class="btn" data-act="goto" data-id="step-' + esc(nx.step.id) + '">Show blocked step</button>'; }
    else if (nx.kind === 'gate') {
      var g = nx.gate, name = g.implicit ? 'Confirm ' + map.phases[nx.phaseIndex].title : g.title;
      hint = nx.status === 'failed' ? 'Gate failed' : nx.status === 'review' ? 'Gate needs review · something it approved changed' : 'Every step in ' + map.phases[nx.phaseIndex].title + ' is answered';
      main = nx.status === 'ready' ? (g.implicit ? name : 'Gate: ' + g.title) : hl.text;
      btn = '<button class="btn' + (nx.status === 'ready' ? ' go' : '') + '" data-act="goto" data-id="gate-' + esc(g.id) + '">Review "' + esc(name) + '"</button>';
    } else if (nx.kind === 'complete') { hint = 'Every gate passed'; main = 'Finish the run'; btn = rec ? '<button class="btn go" data-act="finish">Finish the run</button>' : ''; }
    else if (nx.step) {
      var p = map.phases[nx.phaseIndex], g2 = p.gate, here = selOf(ctx) === nx.step.id;
      hint = esc(p.title) + ' · ' + nx.left + ' to go, then ' + (g2.implicit ? (R.solo(r) ? 'confirm the phase' : 'confirm together') : 'the "' + esc(g2.title) + '" gate');
      if (nx.track) {
        var who = nx.track.roles.map(function (ro) { return r.roles[ro] ? nameOf(ctx, r.roles[ro]) : ''; }).filter(Boolean).join(', ');
        hint += ' · ' + esc(nx.track.title) + (who ? ' (' + esc(who) + ')' : '');
      }
      main = nx.step.text;
      btn = here ? '<span class="small rw-here">Selected' + (rec && s.keys ? '<span class="rw-kbd"> · Space checks it</span>' : '') + '</span>' : '<button class="btn" data-act="goto" data-id="step-' + esc(nx.step.id) + '">' + (selOf(ctx) ? 'Back to it' : 'Go to step') + '</button>';
      var others = (nx.tracks || []).filter(function (t) { return t.step && (!nx.track || t.track.id !== nx.track.id); });
      var tail = others.map(function (t) { return esc(t.track.title) + ': ' + t.left + ' left'; }).join(' · ');
      return '<div class="rw-next" data-k="step" role="region" aria-label="Next up"><div class="rw-next-t"><div class="small">Next up · ' + hint + '</div><b>' + inlineText(main) + '</b>' + (tail ? '<div class="small">Also open: ' + tail + '</div>' : '') + '</div>' + btn + '</div>';
    }
    return '<div class="rw-next" data-k="' + esc(nx.kind) + (nx.status ? ' ' + esc(nx.status) : '') + '" role="region" aria-label="Next up"><div class="rw-next-t"><div class="small">' + esc(hint) + '</div><b>' + inlineText(main || '') + '</b></div>' + btn + '</div>';
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
    var h = '<li class="corr" id="corr-' + esc(c.id) + '" tabindex="-1"><div class="row corr-top"><span class="badge b-plan">' + esc(lab) + '</span>' + corrPill(g, c) + '<span class="small">' + esc(nameOf(ctx, c.by)) + ' · ' + esc(opts.day ? U.when(c.at) : U.hm(c.at)) + '</span></div>';
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
  function changedHere(ctx, r) { return r && r.process && r.folder ? C.changedIn(corrGroups(ctx, r.process), r.folder) : {}; }
  /* "Changed in vN" with "Why is this here?": what it said before and after, why, the runs that suggested it, who applied it. */
  function provenance(ctx, r, map, st, g) {
    var c = g.first, d = g.decision, ch = g.change, disc = 'prov:' + g.id, open = !!(ctx.state.disc && ctx.state.disc[disc]);
    var dl = '';
    if (ch.op === 'wording' && g.from) dl += '<dt>Before → after</dt><dd>' + redline(g.from, st.text) + '</dd>';
    else {
      if (g.from && ch.op !== 'add') dl += '<dt>Before</dt><dd>' + esc(g.from) + '</dd>';
      var prop = C.proposal(c, map); if (prop) dl += '<dt>' + (ch.op === 'describe' || ch.op === 'screenshot' ? 'Change' : 'After') + '</dt><dd>' + esc(ch.op === 'add' ? 'Added' + (g.from ? ' after "' + g.from + '"' : '') + ': ' + st.text : prop) + '</dd>';
    }
    g.members.forEach(function (m) { if (m.why) dl += '<dt>' + (ch.op === 'describe' ? 'Problem' : 'Why') + ' · ' + esc(nameOf(ctx, m.by)) + '</dt><dd>' + esc(m.why) + '</dd>'; });
    var runs = '<p class="small prov-runs">Suggested in ' + g.runs + ' run' + (g.runs === 1 ? '' : 's') + ': ' + g.members.map(function (m) {
      return '<button class="linkish" data-act="open-run" data-id="' + esc(m.process + '/' + m.run) + '">' + esc(m.runTitle) + '</button> (' + esc(nameOf(ctx, m.by)) + ', v' + esc(m.version) + ')';
    }).join(', ') + '</p>';
    var who = d && d.by ? '<p class="small">' + (d.status === 'included' ? esc(nameOf(ctx, d.by)) + ' said v' + esc(d.version) + ' has it' : 'Applied by ' + esc(nameOf(ctx, d.by))) + (d.at ? ' ' + esc(U.day(d.at)) : '') + '.</p>' : '';
    return '<div class="prov"><span class="badge b-changed">Changed in v' + esc(g.landed.version) + '</span><details class="prov-why" data-disc="' + esc(disc) + '"' + (open ? ' open' : '') + '><summary class="small">Why is this here?</summary>' +
      (dl ? '<dl class="corr-dl">' + dl + '</dl>' : '') + runs + who + '</details></div>';
  }
  V.fuList = fuList; V.fuRow = fuRow; V.fuPill = fuPill;
  V.redline = redline; V.corrRow = corrRow; V.corrPill = corrPill; V.corrIndex = corrIndex; V.corrGroups = corrGroups;
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
      '<p class="small corr-says"><b>Checklist says</b> (v' + esc(r.version) + '): ' + esc(s.text) + '</p>';
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
        var opts = '<option value="">Choose…</option>' + map.phases.map(function (p) {
          return '<optgroup label="' + esc(p.title) + '"><option value="start:' + esc(p.id) + '"' + (f.moveTo === 'start:' + p.id ? ' selected' : '') + '>At the start of ' + esc(p.title) + '</option>' + p.steps.filter(function (y) { return y.id !== s.id; }).map(function (y) { return '<option value="after:' + esc(y.id) + '"' + (f.moveTo === 'after:' + y.id ? ' selected' : '') + '>After "' + esc(y.text.slice(0, 80)) + '"</option>'; }).join('') + '</optgroup>';
        }).join('');
        h += '<label class="small" for="corr-move">Move it to</label><select id="corr-move" data-bound' + bad('corr-move') + '>' + opts + '</select>' + fe('corr-move');
      } else if (f.op === 'roles') {
        var roles = map.meta.roles || [];
        h += roles.length ? '<fieldset class="corr-roles" id="corr-roles" tabindex="-1"' + bad('corr-roles') + '><legend class="small">Who should do it</legend>' + roles.map(function (ro) { return '<label class="check-label small"><input type="checkbox" id="corr-role-' + esc(ro) + '" data-bound' + (f.roles.indexOf(ro) >= 0 ? ' checked' : '') + '> @' + esc(ro) + (r.roles[ro] ? ' (' + esc(nameOf(ctx, r.roles[ro])) + ')' : '') + '</label>'; }).join('') + '</fieldset>' + fe('corr-roles')
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
  function fieldsBlock(ctx, r, s, t, sched) {
    var st = ctx.state, eff = R.fieldsOf(r, s), own = (r.fields || {})[s.id] || {}, chips = '', code = '';
    Object.keys(eff).forEach(function (f) {
      if (f === 'expect' || f === 'deadline' || f === 'require' || !eff[f] || (sched && (f === 'at' || f === 'due' || f === 'after'))) return;
      var def = T.fieldDef(t, f) || { label: f, kind: 'text' }, val = R.fill(eff[f], r.details), mark = own[f] != null ? ' filled" title="Filled in during this run' : '';
      var copy = function () { var on = st.copied === val; return '<button class="mini" data-act="copy" data-text="' + esc(val) + '" aria-label="Copy ' + esc(def.label) + '">' + I(on ? 'check' : 'copy') + (on ? 'Copied' : 'Copy') + '</button>'; };
      if (f === 'evidence') { chips += '<span class="fchip"><b>Evidence:</b> ' + esc(val === 'link' ? 'a link' : 'a note') + '</span>'; return; }
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
    var st = x.step, t = T.get(st.type, r.types) || { id: st.type, label: st.type, icon: 'check', hint: '', fields: {} }, a = r.steps[st.id] || null, aState = stateOf(r, st), now = ctx.now();
    var work = canWork(ctx, r, map, x), all = M.steps(map), i = all.map(function (y) { return y.step.id; }).indexOf(st.id), prev = all[i - 1], next = all[i + 1];
    var ph = map.phases[x.phaseIndex], inPhase = ph.steps.map(function (y) { return y.id; }).indexOf(st.id) + 1, track = st.track ? (ph.tracks || []).filter(function (tr) { return tr.id === st.track; })[0] : null;
    var sched = (R.schedule(r, map, now).filter(function (it) { return it.what === 'step' && it.id === st.id; }) || [])[0];
    var who = st.roles.map(function (ro) { return r.roles[ro] ? avatar(ctx, r.roles[ro]) + esc(nameOf(ctx, r.roles[ro])) : '@' + esc(ro); }).join(', ');
    var cf = s.corrForm && s.corrForm.key === runKey(r) && s.corrForm.step === st.id ? s.corrForm : null, corrOpen = !!cf;
    var h = '<aside class="fpe-pane rw-ins" id="rw-ins" data-scope="ref:' + esc(st.id) + '" data-open="' + open + '" aria-label="Selected step">';
    h += '<div class="rw-ins-top"><button class="mini close" data-act="close-ref">Close</button><nav class="row rw-steps" aria-label="Other steps">' +
      (prev ? '<button class="mini" data-act="select" data-id="' + esc(prev.step.id) + '" data-nav="1">' + I('back') + 'Previous</button>' : '') + (next ? '<button class="mini" data-act="select" data-id="' + esc(next.step.id) + '" data-nav="1">Next</button>' : '') + '</nav>' +
      '<button class="linkish rw-skip" data-act="to-row" data-id="' + esc(st.id) + '">Back to the checklist</button></div>';
    h += '<div class="rw-ins-body">';
    h += '<nav aria-label="Where it is"><ol class="ob-crumbs"><li>' + esc(ph.title) + '</li>' + (track ? '<li>' + esc(track.title) + '</li>' : '') + '<li>Step ' + inPhase + ' of ' + ph.steps.length + '</li></ol></nav>';
    h += '<h2 id="ins-h" class="rw-ins-h" tabindex="-1">' + U.mdInline(st.text) + '</h2>';
    h += '<div class="rw-ins-meta"><span class="type">' + I(t.icon) + esc(t.label) + '</span>' + (who ? '<span class="small">' + who + '</span>' : '') + (st.must ? '<span class="badge b-must">Must do</span>' : '') +
      '<span class="badge rw-st s-' + esc(aState) + '">' + esc(aState === 'open' ? 'Not checked' : aState === 'done' ? 'Done' : aState === 'na' ? 'N/A' : aState === 'blocked' ? 'Blocked' : 'Re-check') + '</span>' +
      (a && (a.s === 'done' || a.s === 'na') ? '<span class="small">' + esc(nameOf(ctx, a.by)) + ' · ' + U.hm(a.at) + '</span>' : '') + '</div>';
    var chg = changedHere(ctx, r)[st.id];
    if (chg) h += '<div class="rw-prov">' + chg.map(function (g) { return provenance(ctx, r, map, st, g); }).join('') + '</div>';
    if (aState === 'blocked' || aState === 'recheck') h += '<div class="notice ' + (aState === 'blocked' ? 'bad' : 'warn') + ' rw-why"><span><b>' + (aState === 'blocked' ? 'Blocked' : 'Needs a re-check') + ':</b> ' + esc(a.reason) + (a.by ? ' · ' + esc(nameOf(ctx, a.by)) + ' ' + U.hm(a.at) : '') + '</span></div>';
    if (s.keys && rec && work && aState !== 'done') h += '<p class="small rw-keys" aria-hidden="true">Space: check · N: note · B: blocked</p>';

    /* What to do */
    var how = (t.hint ? '<p class="small">' + esc(t.hint) + '</p>' : '') + (st.note ? '<div class="note">' + U.mdBlock(st.note) + '</div>' : '');
    var shots = st.shots.map(function (sh, k) { return '<figure class="shot"><button class="thumb" data-act="zoom" data-id="' + esc(st.id) + '" data-i="' + k + '" aria-label="Expand: ' + esc(sh.caption) + '" title="' + esc(sh.caption) + '">' + ctx.img(sh.src, sh.caption) + '</button><figcaption class="small">' + esc(sh.caption) + '</figcaption>' +
      (s.me && !corrOpen ? '<button class="linkish" data-act="corr-open" data-mode="correct" data-op="screenshot" data-id="' + esc(st.id) + '" data-shot="' + esc(sh.src) + '">' + (st.shots.length === 1 ? 'Replace this screenshot' : 'Replace screenshot ' + (k + 1)) + '</button>' : '') + '</figure>'; }).join('');
    how += fieldsBlock(ctx, r, st, t, sched) + (shots ? '<div class="thumbs shots">' + shots + '</div>' : '');
    if (t.id === 'run.process') how += childBox(ctx, r, st, a, rec && work && !(a && (a.s === 'done' || a.s === 'na')));
    /* Timing: elapsed, expected, a deadline copied from the tool, the schedule; Start and Set deadline while it's open. */
    var timing = timerOf(ctx, r, st, a, now) + (sched ? schedBadge(sched) : '') + (st.fields.expect ? '<span class="small">Usually ' + esc(st.fields.expect) + '</span>' : '') +
      (a && a.started && aState !== 'done' && aState !== 'na' ? '<span class="small">' + esc(nameOf(ctx, a.started.by)) + ' started ' + U.hm(a.started.at) + '</span>' : '') +
      (a && a.deadline && aState !== 'done' && aState !== 'na' ? '<span class="small">deadline ' + U.hm(a.deadline.at) + ', copied from the tool</span>' : '');
    var timeActs = '';
    if (rec && work && (!a || a.s === 'open' || a.s === 'recheck')) {
      if (!(a && a.started)) timeActs += '<button class="mini" data-act="start-step" data-id="' + esc(st.id) + '">' + I('clock') + 'Start</button>';
      if (st.fields.deadline && !(a && a.deadline)) timeActs += '<button class="mini" data-act="pick" data-kind="deadline" data-id="' + esc(st.id) + '">Set deadline</button>';
    }
    if (s.pick && s.pick.id === st.id && s.pick.kind === 'deadline') timeActs = '<div class="pick" data-scope="deadline:' + esc(st.id) + '"><label for="pick-input">Deadline from the tool (for example 21:30):</label> <input id="pick-input" class="rw-in" placeholder="21:30" maxlength="8" data-enter="deadline" data-id="' + esc(st.id) + '" style="min-width:90px"><button class="mini" data-act="deadline" data-id="' + esc(st.id) + '">Set</button><button class="mini" data-act="unpick">Cancel</button></div>';
    if (timing || timeActs) how += '<div class="rw-timing"><h4 class="rw-h4">Timing</h4><div class="badges">' + timing + '</div>' + (timeActs ? '<div class="row">' + timeActs + '</div>' : '') + '</div>';
    h += '<section class="rw-box" aria-labelledby="ins-do"><h3 class="rw-h3" id="ins-do">What to do</h3>' + (how || '<p class="small">Nothing more to it than the step says.</p>') + '</section>';

    /* Record the result: evidence to type before Done, what was recorded, and Fill in for values known later. */
    var recFields = R.evidenceFor(r, st, R.fieldsOf(r, st)).list, editable = T.editable(t), showRec = recordShown(ctx, r, map, st.id);
    var dr = (ctx.stepDraft && ctx.stepDraft(st.id)) || { record: {}, fields: {}, note: '' };
    var valueOf = function (d) { return evidenceDefault(ctx, r, st, d); };
    var recBody = '';
    if (s.pick && s.pick.id === st.id && s.pick.kind === 'fields') {
      /* Choices made in this form but not saved yet (an action) decide which other fields and evidence it shows. Evidence
         starts from the step's draft (typed before Fill in opened), so saving the form never drops that typing. */
      var eff = R.fieldsOf(r, st), own = (r.fields || {})[st.id] || {}, draft = s.fieldsDraft && s.fieldsDraft.id === st.id ? s.fieldsDraft.values : {}, eff2 = Object.assign({}, eff, draft), recFields2 = R.evidenceFor(r, st, eff2).list;
      recBody = '<div class="pick record" data-scope="fields:' + esc(st.id) + '"><span class="small">Fill in or correct this step\'s values for this run. Leave anything you don\'t know yet.</span>' + ferr(s, st.id) +
        T.relevant(t, eff2).map(function (f) { var d = T.fieldDef(t, f); return fieldInput('fld-' + f, d, dr.fields['fld-' + f] != null ? dr.fields['fld-' + f] : eff2[f] || '', 'save-fields', st.id, st.fields[f] && own[f] != null ? ' (checklist says: ' + st.fields[f] + ')' : '', errFor(s, st.id, 'fld-' + f)); }).join('') +
        (recFields2.length ? '<span class="small" style="margin-top:4px">Evidence</span>' + recFields2.map(function (d) { return fieldInput('rec-' + d.name, d, dr.fields['rec-' + d.name] != null ? dr.fields['rec-' + d.name] : dr.record['rec-' + d.name] != null ? dr.record['rec-' + d.name] : valueOf(d), 'save-fields', st.id, d.required ? ' (required to check it)' : '', errFor(s, st.id, 'rec-' + d.name)); }).join('') : '') +
        '<span class="row"><button class="btn" data-act="save-fields" data-id="' + esc(st.id) + '">Save</button><button class="mini" data-act="unpick">Cancel</button></span></div>';
    } else if (showRec) {
      recBody = '<div class="pick record" data-scope="record:' + esc(st.id) + '"><span class="small">' + (recFields.some(function (d) { return d.required; }) ? 'To check this step, record:' : 'You can record:') + '</span>' + ferr(s, st.id) + recFields.map(function (d) {
        return fieldInput('rec-' + d.name, d, dr.record['rec-' + d.name] != null ? dr.record['rec-' + d.name] : valueOf(d), 'record', st.id, d.required ? '' : ' (optional)', errFor(s, st.id, 'rec-' + d.name));
      }).join('') + '</div>';
    } else if (a && a.values) {
      var vals = '';
      recFields.forEach(function (d) { var v = a.values[d.name]; if (!v) return; vals += d.kind === 'url' && U.safeUrl(v) ? '<a class="fchip rec" href="' + esc(U.safeUrl(v)) + '" target="_blank" rel="noopener noreferrer"><b>' + esc(d.label) + '</b> open</a>' : '<span class="fchip rec"><b>' + esc(d.label) + ':</b> ' + esc(v) + '</span>'; });
      if (vals) recBody = '<div class="fields">' + vals + '</div>';
    }
    var finishing = s.answering && s.answering.key === runKey(r) && s.answering.step === st.id;
    var fillIn = rec && r.state === 'running' && !r.paused && (editable.length || recFields.length) && !(s.pick && s.pick.id === st.id && s.pick.kind === 'fields') ? (finishing
      ? '<span class="row"><button class="mini" data-act="pick" data-kind="fields" data-id="' + esc(st.id) + '" disabled aria-describedby="fillwhy-' + esc(st.id) + '">' + I('edit') + 'Fill in</button><span class="small" id="fillwhy-' + esc(st.id) + '">Finishing the answer…</span></span>'
      : '<button class="mini" data-act="pick" data-kind="fields" data-id="' + esc(st.id) + '">' + I('edit') + 'Fill in</button>') : '';
    if (recBody || fillIn) h += '<section class="rw-box" aria-labelledby="ins-rec"><div class="row between"><h3 class="rw-h3" id="ins-rec">Record the result</h3>' + fillIn + '</div>' + recBody + '</section>';

    /* The actions: Done is the one primary action, kept in reach while long instructions scroll. */
    var acts = '', pick = '';
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
    var rows = C.forRun(r, map).filter(function (c) { return c.step === st.id; }), idx = rows.length ? corrIndex(ctx, r.process) : {};
    if (a && a.differently) {
      var linked = rows.filter(function (c) { return c.answer && !c.oneOff; })[0];
      h += '<div class="notice rw-diff" style="margin:0"><span><span class="badge b-diff">Done differently</span> · ' + esc(nameOf(ctx, a.differently.by)) + (a.differently.at ? ' · ' + U.hm(a.differently.at) : '') + '<span class="rw-diff-t">' + esc(a.differently.note) + '</span></span><span class="row">' +
        (linked ? '<button class="mini" data-act="goto-corr" data-id="corr-' + esc(linked.id) + '">View correction</button>' : '') + (rec && !r.paused && a.s === 'done' && R.phaseOpen(r, map, x.phaseIndex) ? '<button class="mini" data-act="toggle" data-id="' + esc(st.id) + '">Change answer</button>' : '') + '</span></div>';
    }
    /* Earlier answers: who, when, values and reasons; older ones from the run's history files on request. */
    if (a && a.history && a.history.length) h += '<details><summary class="small" style="cursor:pointer">Earlier answers (' + a.history.length + ')</summary><ul class="tnotes" style="margin-top:8px">' + a.history.slice().reverse().map(function (y) {
      return '<li>' + avatar(ctx, y.by) + '<div><div class="meta">' + esc(nameOf(ctx, y.by)) + ' · ' + esc(U.when(y.at)) + '</div><div>' + esc({ done: 'Done', na: 'N/A', blocked: 'Blocked', recheck: 'Needed a re-check' }[y.s] || y.s) + (y.reason ? ': ' + esc(y.reason) : '') + (y.values ? ' · ' + esc(Object.keys(y.values).map(function (k) { return k + ' ' + y.values[k]; }).join(', ')) : '') + (y.differently ? ' · done differently: ' + esc(y.differently.note) : '') + '</div></div></li>';
    }).join('') + '</ul></details>';
    var arch = s.archive[runKey(r)];
    if (arch) { var mine = arch.filter(function (y) { return y.kind === 'answer' && y.step === st.id; }); if (mine.length) h += '<details open><summary class="small">Archived answers (' + mine.length + ')</summary><ul class="tnotes">' + mine.map(function (y) { return '<li>' + avatar(ctx, y.by) + '<div><div class="meta">' + esc(nameOf(ctx, y.by)) + ' · ' + esc(U.when(y.at)) + '</div><div>' + esc(y.s) + (y.reason ? ': ' + esc(y.reason) : '') + '</div></div></li>'; }).join('') + '</ul></details>'; }
    else if (a && a.history && a.history.length >= 10) h += '<button class="mini" style="align-self:flex-start" data-act="load-history">Show older answers</button>';

    /* Notes, with attachments; anyone who has said who they are can add one. */
    /* Corrections to this step from this run, then Correct this step (anyone who has said who they are, whatever the run's state). */
    h += '<section class="rw-box rw-corr" aria-labelledby="ins-corr"><div class="row between"><h3 class="rw-h3" id="ins-corr">Corrections' + (rows.length ? ' · ' + rows.length : '') + '</h3>' +
      (s.me && !(cf && cf.mode === 'correct') ? '<button class="mini" data-act="corr-open" data-mode="correct" data-id="' + esc(st.id) + '">' + I('edit') + 'Correct this step</button>' : '') + '</div>' +
      (rows.length ? '<ul class="corrlist">' + rows.map(function (c) { return corrRow(ctx, c, idx[c.id], { withdraw: true }); }).join('') + '</ul>' : !(cf && cf.mode === 'correct') ? '<p class="small">If the checklist was wrong or unclear here, correct it. The team reviews corrections on the process page.</p>' : '') +
      (cf && cf.mode === 'correct' ? composer(ctx, r, map, x, cf) : '') + '</section>';
    var notes = (r._notes || []).filter(function (n) { return n.step === st.id && n.kind !== 'correction' && n.kind !== 'fix' && n.kind !== 'map'; });
    h += '<section class="rw-box rw-notes" aria-labelledby="ins-notes"><h3 class="rw-h3" id="ins-notes">' + (R.solo(r) ? 'Notes' : 'Team notes') + (notes.length ? ' · ' + notes.length : '') + '</h3>' + (notes.length ? '<ul class="tnotes">' + notes.map(function (n) {
      var made = (r.followUps || []).some(function (f) { return f.from === n.id; });
      return '<li>' + avatar(ctx, n.by) + '<div><div class="meta">' + esc(nameOf(ctx, n.by)) + ' · ' + U.hm(n.at) + '</div><div>' + U.mdInline(n.text) + '</div>' +
        attachments(ctx, n.id, n.files, n.fileInfo, 'note') +
        (rec && r.state === 'running' && n.text ? (made ? '<span class="small">Follow-up added</span>' : '<button class="linkish" data-act="add-followup" data-text="' + esc(n.text.slice(0, 300)) + '" data-step="' + esc(st.id) + '" data-from="' + esc(n.id) + '">Make it a follow-up</button>') : '') + '</div></li>';
    }).join('') + '</ul>' : '<p class="small">No notes on this step yet.</p>');
    if (s.me) {
      var pend = ctx.attachments(runKey(r), st.id), ack = s.noteAck && s.noteAck.key === runKey(r) && s.noteAck.step === st.id;
      h += '<div class="compose" data-drop="note" data-id="' + esc(st.id) + '">' + ferr(s, 'note:' + st.id) + '<label class="small" for="note-text">Add a note</label><textarea id="note-text" maxlength="2000" rows="3"' + (s.fieldErr && s.fieldErr.id === 'note:' + st.id ? ' aria-invalid="true" aria-describedby="ferr-note:' + esc(st.id) + '"' : '') + ' placeholder="' + (R.solo(r) ? 'What you noticed' : 'What the team should know') + '. Drop, paste or attach files.">' + esc(dr.note || '') + '</textarea>' +
        pendingList(ctx, pend, 'note:' + st.id) +
        '<div class="row"><button class="btn primary" data-act="add-note" data-id="' + esc(st.id) + '">Add note' + (pend.length ? ' with ' + pend.length + ' file' + (pend.length === 1 ? '' : 's') : '') + '</button><label class="btn" for="note-file">' + I('clip') + 'Attach</label><input type="file" id="note-file" accept="' + esc(A.ACCEPT) + '" multiple class="sr">' +
        (ack ? '<span class="small rw-ack" role="status">' + I('check') + 'Note added to this step.</span>' : '') + '</div>' +
        '<p class="small">Images, PDF, text, logs and .zip, up to 10 MB each.</p></div>';
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
        '<span class="rw-gate g-' + gst + '">' + I('gate') + '<span>' + esc(p.gate.implicit ? 'Confirm' : p.gate.title) + ' · ' + GATE_WORD[gst] + '</span></span></li>';
    }).join('') + '</ol>';
    return h + utilities(ctx, r, schedN, lateN, 'rail');
  }
  /* Day timeline and follow-ups, reachable at every width. */
  function utilities(ctx, r, schedN, lateN, where) {
    var s = ctx.state, fus = (r.followUps || []).length, h = '<div class="rw-utils">';
    if (schedN) h += '<button class="mini" data-act="timeline" data-id="' + where + '" aria-expanded="' + !!s.timeline + '" aria-controls="rw-timeline">' + I('timeline') + 'Day timeline · ' + schedN + (lateN ? ' · ' + lateN + ' late' : '') + '</button>';
    h += '<button class="mini" data-act="run-fu" data-id="' + where + '" aria-expanded="' + !!s.fuOpen + '" aria-controls="rw-fu">' + I('flag') + 'Follow-ups · ' + fus + '</button>';
    if (where === 'rail') h += '<button class="mini" data-act="help">Keyboard shortcuts</button>';
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
    if (opts.run) meta.push('<button class="linkish" data-act="open-run" data-id="' + esc(x.runKey) + '">' + esc(x.runTitle) + '</button>');
    if (opts.age && x.status === 'open') meta.push(days === 0 ? 'added today' : 'open ' + days + ' day' + (days === 1 ? '' : 's'));
    var h = '<li class="fu" id="fu-' + esc(x.key.replace(/\//g, '--')) + '"><div class="fu-main"><span class="fu-text">' + esc(f.text) + (f.ticket ? ' <span class="cat">' + esc(f.ticket) + '</span>' : '') + '</span>' + fuPill(x) +
      (meta.length ? '<span class="small fu-meta">' + meta.join(' · ') + '</span>' : '') + '</div>' + fuDecided(ctx, x);
    var acts = '';
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
  function fuForm(ctx, x, status) {
    var st = ctx.state, saving = !!(st.fuSaving && st.fuSaving[x.key]), base = PF.followups.formId(x.key);
    var box = function (part, label, attrs, hint) {
      var id = base + '-' + part, bad = st.fieldErr && st.fieldErr.id === id, desc = [hint ? id + '-hint' : '', bad ? 'ferr-' + id : ''].filter(Boolean).join(' ');
      return '<label class="field" for="' + id + '">' + label + '<input id="' + id + '" ' + attrs + (bad ? ' aria-invalid="true"' : '') + (desc ? ' aria-describedby="' + desc + '"' : '') + ' data-enter="fu-save" data-id="' + esc(x.key) + '"></label>' + (hint ? '<span class="small" id="' + id + '-hint">' + hint + '</span>' : '') + ferr(st, id);
    };
    var h = '<div class="fu-form" id="' + base + '-form" role="group" aria-labelledby="' + base + '-h"><p class="fu-form-h" id="' + base + '-h"><b>' + FU_FORM[status] + '</b><span class="sr">: ' + esc(x.text) + '</span></p>';
    if (status === 'done') h += box('link', 'Link (optional)', 'type="url" maxlength="500" placeholder="https://"', 'Where the work is: a merged pull request, a page, a message.') + box('note', 'Note (optional)', 'maxlength="300"');
    else if (status === 'ticket') h += box('ticket', 'Ticket key or link', 'maxlength="500" placeholder="ABC-123" autocomplete="off"');
    else if (status === 'moved') {
      var runs = (ctx.data.runs || []).filter(function (r) { return r.state === 'running' && !(r.process === x.process && r.id === x.run); }), plans = (ctx.data.plans || []).filter(function (p) { return !p._status && /^[\w-]{1,100}$/.test(p.id || ''); });
      var toId = base + '-to', bad = st.fieldErr && st.fieldErr.id === toId;
      h += '<label class="field" for="' + toId + '">The run or plan it moved to<select id="' + toId + '"' + (bad ? ' aria-invalid="true" aria-describedby="ferr-' + toId + '"' : '') + '><option value="">None: I\'ll paste a link</option>' +
        (runs.length ? '<optgroup label="Running">' + runs.map(function (r) { return '<option value="' + esc(r.process + '/' + r.id) + '">' + esc(r.title) + '</option>'; }).join('') + '</optgroup>' : '') +
        (plans.length ? '<optgroup label="Planned">' + plans.map(function (p) { return '<option value="plan:' + esc(p.id) + '">' + esc(p.title) + '</option>'; }).join('') + '</optgroup>' : '') + '</select></label>' + ferr(st, toId) +
        box('link', 'Or a link (optional)', 'type="url" maxlength="500" placeholder="https://"');
    } else if (status === 'wont') h += box('reason', 'Why won\'t it be done?', 'maxlength="300"', 'Everyone who opens the run sees this.');
    return h + '<div class="row"><button class="btn primary" data-act="fu-save" data-id="' + esc(x.key) + '"' + (saving ? ' disabled' : '') + '>' + (saving ? 'Saving…' : 'Save') + '</button><button class="mini" data-act="fu-cancel" data-id="' + esc(x.key) + '">Cancel</button></div></div>';
  }
  /* Steps outside any track first, then the phase's tracks side by side: parallel work, all finished before the gate. */
  function stepsHtml(ctx, r, p, row) {
    var loose = p.steps.filter(function (st) { return !st.track; }), h = loose.length ? '<ul class="steps">' + loose.map(row).join('') + '</ul>' : '';
    if (!p.tracks || !p.tracks.length) return h;
    return h + '<div class="tracks">' + p.tracks.map(function (t) {
      var steps = p.steps.filter(function (st) { return st.track === t.id; }), done = steps.filter(function (st) { return R.answered(r, st); }).length;
      var who = t.roles.map(function (ro) { return r.roles[ro] ? avatar(ctx, r.roles[ro]) + esc(nameOf(ctx, r.roles[ro])) : esc(ro); }).join(', ');
      return '<section class="track" aria-labelledby="tr-' + esc(t.id) + '"><div class="track-head"><h3 id="tr-' + esc(t.id) + '">' + esc(t.title) + '</h3><span class="small">' + (who ? who + ' · ' : '') + done + '/' + steps.length + '</span></div><ul class="steps">' + steps.map(row).join('') + '</ul></section>';
    }).join('') + '<p class="small tracks-note">Finish every track before the gate.</p></div>';
  }
  /* "5 done · 1 N/A" for a folded phase. */
  function tally(r, p) {
    var c = { done: 0, na: 0, other: 0 };
    p.steps.forEach(function (s) { var a = r.steps[s.id]; if (a && a.s === 'done') c.done++; else if (a && a.s === 'na') c.na++; else c.other++; });
    return [c.done ? c.done + ' done' : '', c.na ? c.na + ' N/A' : '', c.other ? c.other + ' not answered' : ''].filter(Boolean).join(' · ');
  }

  function run(ctx) {
    var r = ctx.run(), s = ctx.state;
    if (!r) return K.notices(ctx) + '<div class="panel">That run wasn\'t found. <button class="mini" data-act="home">Back to Home</button></div>';
    var map = R.mapOf(r), rec = ctx.recording(r), t = R.totals(r, map), nx = R.nextUp(r, map, s.me), hl = nx.hl, now = Date.now();
    var items = R.schedule(r, map, now), schedBy = {}, late = items.filter(function (it) { return it.status === 'late' || it.status === 'started?'; }).length;
    items.forEach(function (it) { schedBy[it.what + ':' + it.id] = it; });
    var pct = t.total ? Math.round(t.done / t.total * 100) : 0, alone = R.solo(r);
    /* The header: who it is, how far, and the tools. Three groups that never trade places. */
    var h = '<div class="fpe rw" id="rw"><header class="fpe-head rw-head" role="region" aria-labelledby="run-h"><div class="fpe-id">' +
      '<button type="button" class="btn rw-back" data-act="nav" data-id="runs">' + I('back') + 'Runs</button>' +
      '<div class="fpe-title"><h1 id="run-h" tabindex="-1">' + esc(r.title) + '</h1><span class="small rw-sub">' + esc(map.meta.title) + ' · v' + esc(r.version) + ' · started ' + esc(U.when(r.created)) +
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
      '<button type="button" class="mini" data-act="refresh">Check the folder now</button><button type="button" class="mini" data-act="health">Folder health</button><button type="button" class="mini" data-act="help">Keyboard shortcuts</button></div></details>' +
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
    if (part && !(pa && pa.s === 'done' && pa.differently)) { var px = M.findStep(map, part.step); al += '<div class="notice warn" role="status"><span><b>Correction saved; the step wasn\'t marked done.</b> ' + esc(px ? px.step.text : part.step) + '</span><span class="row">' + (rec && px ? '<button class="btn" data-act="corr-open" data-mode="differently" data-id="' + esc(part.step) + '">Mark it now</button>' : '') + '<button class="mini" data-act="partial-dismiss" data-id="' + esc(runKey(r)) + '">Dismiss</button></span></div>'; }
    al += recovery(ctx, r, ctx.canRecover(r));
    if (K.connBanner) al += K.connBanner(ctx);
    if (s.runDetails) al += details(ctx, r, map, rec);
    h += '<div class="fpe-alerts rw-alerts">' + al + '</div>';

    /* The checklist. */
    var row = function (p, pi, open) { return function (st) { return stepRow(ctx, r, map, { phase: p, phaseIndex: pi, step: st, sched: schedBy['step:' + st.id] }, rec, open, nx); }; };
    var cur = -1, deck = '';
    map.phases.forEach(function (p, pi) { if (cur < 0 && !R.gateOk(R.gateStatus(r, map, pi))) cur = pi; });
    map.phases.forEach(function (p, pi) {
      var gst = R.gateStatus(r, map, pi), info = R.phaseInfo(r, map, pi), done = R.gateOk(gst), locked = gst === 'locked';
      /* Finished phases and phases that can't start yet fold to one line, so the current phase gets the attention. */
      var open = R.phaseOpen(r, map, pi), folded = (done || locked) && !s.unfold[p.id];
      var one = alone, hint = p.mode === 'READ-DO' ? (one ? 'Read each step, then do it.' : 'Read each step aloud, then do it.') : p.mode === 'DO-CONFIRM' ? (one ? 'Do the work, then stop and confirm each step.' : 'Do the work, then stop and confirm each step together.') : '';
      deck += '<section class="phase" id="phase-' + esc(p.id) + '" data-s="' + (done ? 'done' : locked ? 'locked' : 'open') + '"' + (pi === cur ? ' data-cur="true"' : '') + ' aria-labelledby="ph-' + esc(p.id) + '"><div class="placard"><span class="p-label">Phase ' + (pi + 1) + '</span><h2 class="p-title" id="ph-' + esc(p.id) + '" tabindex="-1">' + esc(p.title) + '</h2><span class="p-count">' + info.done + '/' + info.total + '</span>' +
        (p.mode ? '<span class="mode">' + p.mode + '</span>' : '') +  (hint && !folded ? '<span class="mode-hint">' + hint + '</span>' : '') + '</div>';
      if (folded) deck += '<div class="folded"><span>' + (locked ? info.total + ' step' + (info.total === 1 ? '' : 's') + ', after the gate above' : tally(r, p)) + '</span><button class="mini" data-act="unfold" data-id="' + esc(p.id) + '" aria-expanded="false" aria-controls="phase-' + esc(p.id) + '">' + (locked ? 'Preview steps' : 'Show steps') + '</button></div>';
      else {
        if ((done || locked) && s.unfold[p.id]) deck += '<div class="folded"><span>' + (locked ? 'A preview: these open after the gate above.' : tally(r, p)) + '</span><button class="mini" data-act="fold" data-id="' + esc(p.id) + '" aria-expanded="true" aria-controls="phase-' + esc(p.id) + '">Hide steps</button></div>';
        deck += stepsHtml(ctx, r, p, row(p, pi, open));
      }
      deck += gateBlock(ctx, r, map, pi, rec, schedBy['gate:' + p.gate.id]) + '</section>';
    });
    /* A compact Phases picker, timeline and follow-ups for screens too narrow for the rail. */
    var picker = '<div class="rw-picker"><label class="small" for="rw-phase">Phase</label><select id="rw-phase" data-bound>' + map.phases.map(function (p, pi) {
      var gst = R.gateStatus(r, map, pi), info = R.phaseInfo(r, map, pi);
      return '<option value="' + esc(p.id) + '"' + (pi === cur ? ' selected' : '') + '>' + (pi + 1) + '. ' + esc(p.title) + ' · ' + info.done + '/' + info.total + ' · ' + esc(p.gate.implicit ? 'confirm' : p.gate.title) + ': ' + GATE_WORD[gst].toLowerCase() + '</option>';
    }).join('') + '</select>' + utilities(ctx, r, items.length, late, 'picker') + '</div>';
    h += '<div class="fpe-panes rw-panes"><nav class="fpe-pane rw-rail" aria-label="Phases"><h2 class="rw-h2">Phases</h2>' + railHtml(ctx, r, map, nx, items.length, late) + '</nav>' +
      '<section class="fpe-pane rw-list" id="rw-list" aria-label="Checklist">' + (selOf(ctx) ? '<button class="linkish rw-skip" data-act="to-ins">Skip to the selected step</button>' : '') + '<div class="rw-dock">' + nextBar(ctx, r, map, nx, rec) + picker + '</div>' + timeline(ctx, r, map, items) + followUps(ctx, r, rec) + '<div class="deck">' + deck + '</div></section>' +
      inspector(ctx, r, map, rec) + '</div>';
    return h + '</div>';
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
