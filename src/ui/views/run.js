/* The run screen: steps, gates, the recorder bar, recovery and the step panel. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, R = PF.run, M = PF.map, T = PF.types, I = PF.icons.icon, esc = U.esc;
  var person = K.person, nameOf = K.nameOf, avatar = K.avatar, notices = K.notices, ago = K.ago, runKey = K.runKey, freshness = K.freshness;
  /* ---------- run ---------- */
  var BLOCK_REASONS = ['Failed', 'Waiting on someone', 'Not sure it passed'];
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
  function stepRow(ctx, r, map, x, rec, open) {
    open = open && !r.paused;
    var s = x.step, a = r.steps[s.id] || null, t = T.get(s.type, r.types) || { label: s.type, icon: 'check', fields: {} }, st = ctx.state;
    var aState = a && a.s !== 'open' ? a.s : 'open', now = ctx.now();
    var fieldsHtml = '', codeHtml = '', eff = R.fieldsOf(r, s), own = (r.fields || {})[s.id] || {};
    Object.keys(eff).forEach(function (f) {
      if (f === 'expect' || f === 'deadline' || f === 'require' || !eff[f] || (x.sched && (f === 'at' || f === 'due' || f === 'after'))) return;
      var def = T.fieldDef(t, f) || { label: f, kind: 'text' }, val = R.fill(eff[f], r.details), mark = own[f] != null ? ' filled" title="Filled in during this run' : '';
      if (f === 'evidence') { fieldsHtml += '<span class="fchip"><b>Evidence:</b> ' + esc(val === 'link' ? 'a link' : 'a note') + '</span>'; return; }
      if (def.kind === 'message') { codeHtml += '<div class="cmd msg' + mark + '"><span>' + esc(val) + '</span><button class="mini" data-act="copy" data-text="' + esc(val) + '">' + I('copy') + 'Copy</button></div>'; return; }
      if (def.kind === 'list') { fieldsHtml += '<span class="fchip' + mark + '"><b>' + esc(def.label) + ':</b> ' + esc(val.split(',').map(function (x) { return x.trim(); }).filter(Boolean).join(' / ')) + '</span>'; return; }
      if (def.kind === 'code') codeHtml += '<div class="cmd' + mark + '"><code>' + esc(val) + '</code><button class="mini" data-act="copy" data-text="' + esc(val) + '">' + I('copy') + 'Copy</button></div>';
      else if (def.kind === 'url' && U.safeUrl(val)) fieldsHtml += '<a class="fchip' + mark + '" href="' + esc(U.safeUrl(val)) + '" target="_blank" rel="noopener noreferrer"><b>' + esc(def.label) + '</b> open</a>';
      else fieldsHtml += '<span class="fchip' + mark + '"><b>' + esc(def.label) + ':</b> ' + esc(val) + '</span>';
    });
    var people = s.roles.map(function (ro) { return r.roles[ro] ? avatar(ctx, r.roles[ro]) : '<span class="small">@' + esc(ro) + '</span>'; }).join('');
    var badges = (s.must ? '<span class="badge b-must">Must do</span>' : '') + (s.planned ? '<span class="badge b-plan">Automation planned</span>' : '') +
      (aState === 'recheck' ? '<span class="badge b-warn">Re-check: ' + esc(a.reason) + '</span>' : '') +
      (aState === 'blocked' ? '<span class="badge b-stop">Blocked · ' + esc(a.reason) + '</span>' : '') +
      (aState === 'na' ? '<span class="badge b-ref">Not applicable</span>' : '') +
      (a && a.differently ? '<span class="badge b-diff" title="' + esc(a.differently.note) + '">Done differently</span>' : '');
    var timers = '';
    if (a && a.started && aState !== 'done' && aState !== 'na') {
      /* Paused time doesn't count: the offset is the paused time so far, and a paused run's timer stands still. */
      var exp = U.duration(s.fields.expect), active = R.activeMs(r, a.started.at, now), offset = (now - new Date(a.started.at).getTime()) - active;
      timers += (r.paused ? '<span class="timer">' + U.clock(active) + ' · paused</span>' : '<span class="timer" data-since="' + esc(a.started.at) + '" data-offset="' + offset + '"' + (exp ? ' data-expect="' + exp + '"' : '') + '>' + U.clock(active) + '</span>') + '<span class="small">' + esc(nameOf(ctx, a.started.by)) + ' started ' + U.hm(a.started.at) + '</span>';
    }
    if (x.sched) timers += schedBadge(x.sched);
    if (a && a.deadline && aState !== 'done' && aState !== 'na') timers += '<span class="timer due" data-until="' + esc(a.deadline.at) + '">' + U.clock(new Date(a.deadline.at) - now) + '</span><span class="small">deadline ' + U.hm(a.deadline.at) + ', copied from the tool</span>';
    var noteCount = (r._notes || []).filter(function (n) { return n.step === s.id; }).length;
    var acts = '';
    if (rec && open) {
      if (!a || a.s === 'open' || a.s === 'recheck') {
        if (!(a && a.started)) acts += '<button class="mini sec" data-act="start-step" data-id="' + esc(s.id) + '">' + I('clock') + 'Start</button>';
        if (s.fields.deadline && !(a && a.deadline)) acts += '<button class="mini" data-act="pick" data-kind="deadline" data-id="' + esc(s.id) + '">Set deadline</button>';
        if (!s.must) acts += '<button class="mini sec" data-act="na" data-id="' + esc(s.id) + '">N/A</button>';
        acts += '<button class="mini sec" data-act="pick" data-kind="block" data-id="' + esc(s.id) + '">Blocked</button>';
      } else if (a.s === 'blocked') acts += '<button class="mini" data-act="clear" data-id="' + esc(s.id) + '">Unblock</button>';
      else if (a.s === 'na') acts += '<button class="mini" data-act="clear" data-id="' + esc(s.id) + '">Undo N/A</button>';
    }
    var recFields = R.evidenceFor(r, s, eff).list, editable = T.editable(t);
    /* A value the workflow says where to find (a run detail, a role) is filled in for you; you can still change it. */
    var valueOf = function (d) { var saved = a && a.values && a.values[d.name]; if (saved) return saved; return d.source ? PF.jira.resolve(d.source, r.details, function (ro) { return r.roles[ro] ? nameOf(ctx, r.roles[ro]) : ''; }) : ''; };
    if (t.id === 'run.process') codeHtml += childBox(ctx, r, s, a, rec && open && !(a && (a.s === 'done' || a.s === 'na')));
    if (rec && r.state === 'running' && !r.paused && (editable.length || recFields.length)) acts += '<button class="mini sec" data-act="pick" data-kind="fields" data-id="' + esc(s.id) + '">' + I('edit') + 'Fill in</button>';
    acts += '<button class="mini" data-act="select" data-id="' + esc(s.id) + '">' + I('note') + (noteCount ? noteCount + ' note' + (noteCount === 1 ? '' : 's') : 'Notes') + (s.note || s.shots.length ? ' · ref' : '') + '</button>';
    var pick = '';
    if (st.pick && st.pick.id === s.id) {
      if (st.pick.kind === 'block') pick = '<div class="pick" data-scope="block:' + esc(s.id) + '">What\'s wrong? ' + BLOCK_REASONS.map(function (x) { return '<button class="chipbtn" data-act="block" data-id="' + esc(s.id) + '" data-reason="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '<label class="sr" for="pick-input">Why it\'s blocked</label><input id="pick-input" placeholder="or type a reason, then Enter" maxlength="120" data-enter="block" data-id="' + esc(s.id) + '"><button class="mini" data-act="unpick">Cancel</button></div>';
      if (st.pick.kind === 'deadline') pick = '<div class="pick" data-scope="deadline:' + esc(s.id) + '"><label for="pick-input">Deadline from the tool (for example 21:30):</label> <input id="pick-input" placeholder="21:30" maxlength="8" data-enter="deadline" data-id="' + esc(s.id) + '" style="min-width:90px"><button class="mini" data-act="deadline" data-id="' + esc(s.id) + '">Set</button><button class="mini" data-act="unpick">Cancel</button></div>';
    }
    var valuesHtml = '';
    if (a && a.values) recFields.forEach(function (d) {
      var v = a.values[d.name]; if (!v) return;
      valuesHtml += d.kind === 'url' && U.safeUrl(v) ? '<a class="fchip rec" href="' + esc(U.safeUrl(v)) + '" target="_blank" rel="noopener noreferrer"><b>' + esc(d.label) + '</b> open</a>' : '<span class="fchip rec"><b>' + esc(d.label) + ':</b> ' + esc(v) + '</span>';
    });
    if (st.pick && st.pick.id === s.id && st.pick.kind === 'record') {
      pick = '<div class="pick record" data-scope="record:' + esc(s.id) + '"><span class="small">To check this step, record:</span>' + ferr(st, s.id) + recFields.map(function (d) {
        return fieldInput('rec-' + d.name, d, valueOf(d), 'record', s.id, d.required ? '' : ' (optional)', errFor(st, s.id, 'rec-' + d.name));
      }).join('') + '<span class="row"><button class="btn go" data-act="record" data-id="' + esc(s.id) + '">' + I('check') + 'Check it</button><button class="mini" data-act="unpick">Cancel</button></span></div>';
    }
    if (st.pick && st.pick.id === s.id && st.pick.kind === 'fields') {
      /* Choices made in this form but not saved yet (an action) decide which other fields and evidence it shows. */
      var draft = st.fieldsDraft && st.fieldsDraft.id === s.id ? st.fieldsDraft.values : {}, eff2 = Object.assign({}, eff, draft), recFields2 = R.evidenceFor(r, s, eff2).list;
      pick = '<div class="pick record" data-scope="fields:' + esc(s.id) + '"><span class="small">Fill in or correct this step\'s values for this run. Leave anything you don\'t know yet.</span>' + ferr(st, s.id) +
        T.relevant(t, eff2).map(function (f) { var d = T.fieldDef(t, f); return fieldInput('fld-' + f, d, eff2[f] || '', 'save-fields', s.id, s.fields[f] && own[f] != null ? ' (checklist says: ' + s.fields[f] + ')' : '', errFor(st, s.id, 'fld-' + f)); }).join('') +
        (recFields2.length ? '<span class="small" style="margin-top:4px">Evidence</span>' + recFields2.map(function (d) { return fieldInput('rec-' + d.name, d, valueOf(d), 'save-fields', s.id, d.required ? ' (required to check it)' : '', errFor(st, s.id, 'rec-' + d.name)); }).join('') : '') +
        '<span class="row"><button class="btn" data-act="save-fields" data-id="' + esc(s.id) + '">Save</button><button class="mini" data-act="unpick">Cancel</button></span></div>';
    }
    var stamp = a && (a.s === 'done' || a.s === 'na') ? '<span class="stamp">' + avatar(ctx, a.by) + ' ' + U.hm(a.at) + '</span>' : '';
    return '<li class="step' + (st.sel === s.id ? ' sel' : '') + '" data-a="' + esc(aState) + '" id="step-' + esc(s.id) + '">' +
      '<button class="check" role="checkbox" aria-checked="' + (aState === 'done') + '" aria-label="' + esc(s.text) + ', ' + esc(aState === 'open' ? 'not checked' : aState) + (s.must ? ', must do' : '') + '" data-act="toggle" data-id="' + esc(s.id) + '"' + (rec && open && t.id !== 'run.process' ? '' : ' disabled') + (t.id === 'run.process' ? ' title="Checked when its linked run completes"' : '') + '>' + I('check') + '</button>' +
      '<div><div class="s-top"><span class="type">' + I(t.icon) + esc(t.label) + '</span>' + people + '</div><div class="s-text">' + U.mdInline(s.text) + '</div>' +
      (badges ? '<div class="badges">' + badges + '</div>' : '') + (fieldsHtml ? '<div class="fields">' + fieldsHtml + '</div>' : '') + codeHtml + (valuesHtml ? '<div class="fields">' + valuesHtml + '</div>' : '') +
      (timers ? '<div class="badges">' + timers + '</div>' : '') + '</div><div class="side">' + stamp + '<div class="acts">' + acts + '</div></div>' + pick + '</li>';
  }

  var SCHED_WORD = { done: 'done', 'done late': 'done late', late: 'late', 'started?': 'time passed', soon: 'soon', upcoming: '' };
  function schedBadge(it) {
    var label = (it.kind === 'at' ? 'At ' : 'Due ') + U.hm(new Date(it.ms).toISOString()), word = SCHED_WORD[it.status];
    return '<span class="badge b-time s-' + esc(it.status.replace(/\W+/g, '-')) + '">' + esc(label + (word ? ' · ' + word : '')) + '</span>';
  }
  /* A step that starts another process: the linked child run, or the button that starts it. */
  /* What starting the child passes on, worked out the same way the start does. */
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
      return '<div class="childbox">' + I('nest') + '<span>Child run: <b>' + esc(cr ? cr.title : child.process) + '</b> · ' + esc(state) + (fresh ? '' : child.failed ? '. It didn\'t complete as started, so it doesn\'t count for this step.' : '. The details it was started for have changed, so it no longer counts for this step.') + '</span>' + (cr ? '<button class="mini" data-act="open-run" data-id="' + esc(key) + '">Open it</button>' : '') + again + '</div>';
    }
    var pub = ctx.latestPub(proc);
    if (a && (a.s === 'done' || a.s === 'na')) return '';
    if (!canStart) return '<div class="childbox">' + I('nest') + '<span>Starts a <b>' + esc(proc || '?') + '</b> run when this step is reached.</span></div>';
    return '<div class="childbox">' + I('nest') + (pub ? '<button class="btn" data-act="start-child" data-id="' + esc(s.id) + '">Start the ' + esc(pub.map.meta.title) + ' run</button><span class="small">' + esc(passesOn(r, s, pub)) + '. This step is checked when it completes.</span>' : '<span class="small">"' + esc(proc || '?') + '" isn\'t published in this folder yet.</span>') + '</div>';
  }

  function gateBlock(ctx, r, map, pi, rec, sched) {
    var g = map.phases[pi].gate, st = R.gateStatus(r, map, pi), rec2 = r.gates[g.id], s = ctx.state, owner = g.owner && r.roles[g.owner];
    var approves = g.approves ? R.fill(g.approves, r.details) : '';
    var label = { passed: 'Passed', waived: 'Waived', failed: 'Failed', review: 'Needs review', ready: 'Ready', open: 'Waiting on steps', locked: 'Locked' }[st];
    var h = '<div class="gate" data-scope="gate:' + esc(g.id) + '" data-s="' + st + '" id="gate-' + esc(g.id) + '"><div class="stack" style="gap:4px"><div class="gate-title">' + I('gate') + '<span>' + (g.implicit ? (R.solo(r) ? 'Confirm' : 'Confirm together') : 'Gate: ' + esc(g.title)) + '</span><span class="pill ' + st + '">' + label + '</span>' +
      (st === 'passed' && s.justPassed === g.id ? '<span class="called-stamp">Passed</span>' : '') + '</div>';
    if (approves) h += '<div class="q">Approves ' + U.mdInline(approves) + '</div>';
    if (owner) h += '<div class="small">Owner: ' + esc(nameOf(ctx, owner)) + '</div>';
    if (sched) h += '<div class="badges">' + schedBadge(sched) + '</div>';
    if (rec2 && rec2.by && (st === 'passed' || st === 'waived' || st === 'failed' || st === 'review')) h += '<div class="small">' + esc(label) + (st === 'review' ? ' (was ' + rec2.s + ')' : '') + ' by ' + esc(nameOf(ctx, rec2.by)) + ' at ' + U.hm(rec2.at) + (rec2.reason ? ': ' + esc(rec2.reason) : '') + (rec2.approved && Object.keys(rec2.approved).length ? ' · for ' + esc(Object.keys(rec2.approved).map(function (k) { return k + ' ' + (rec2.approved[k] || '(not set)'); }).join(', ')) : '') + '</div>';
    h += '</div><div class="row">';
    if (rec && r.state === 'running' && !r.paused) {
      if (s.pick && s.pick.id === g.id && s.pick.kind === 'pass') h += '<span class="q"><b>' + (approves ? 'Approve ' + U.mdInline(approves) + '?' : 'Pass "' + esc(g.title) + '"?') + '</b></span><button class="btn go" data-act="pass" data-id="' + pi + '">Yes, pass it</button><button class="mini" data-act="unpick">Cancel</button>';
      else if (s.pick && s.pick.id === g.id && (s.pick.kind === 'waive' || s.pick.kind === 'fail')) h += '<label class="sr" for="pick-input">' + (s.pick.kind === 'waive' ? 'Why waive it?' : 'What failed?') + '</label><input id="pick-input" placeholder="' + (s.pick.kind === 'waive' ? 'Why waive it?' : 'What failed?') + '" maxlength="200" data-enter="' + s.pick.kind + '" data-id="' + pi + '" style="border:1px solid var(--line);border-radius:6px;padding:5px 8px;min-width:220px"><button class="btn ' + (s.pick.kind === 'fail' ? 'stop' : '') + '" data-act="' + s.pick.kind + '" data-id="' + pi + '">' + (s.pick.kind === 'waive' ? 'Waive' : 'Fail') + '</button><button class="mini" data-act="unpick">Cancel</button>';
      else {
        /* A solo run's plain "confirm" between phases is one click; a named gate always asks for a deliberate second click. */
        if (R.canPass(r, map, pi) && g.implicit && R.solo(r) && st !== 'review') h += '<button class="btn go" data-act="pass" data-id="' + pi + '">Confirm and continue</button>';
        else if (R.canPass(r, map, pi)) h += '<button class="btn go" data-act="pick" data-kind="pass" data-id="' + esc(g.id) + '">' + (st === 'review' ? 'Review and pass again' : 'Pass the gate') + '</button>';
        if (R.canWaive(r, map, pi) && st !== 'ready') h += '<button class="mini" data-act="pick" data-kind="waive" data-id="' + esc(g.id) + '">Waive</button>';
        if (st !== 'locked' && st !== 'failed' && st !== 'passed' && st !== 'waived') h += '<button class="mini" data-act="pick" data-kind="fail" data-id="' + esc(g.id) + '">Fail</button>';
        if (st === 'passed' || st === 'waived' || st === 'failed' || st === 'review') h += '<button class="mini" data-act="reopen" data-id="' + pi + '">Reopen</button>';
      }
    }
    return h + '</div></div>';
  }

  function recorderBar(ctx, r) {
    var s = ctx.state, me = s.me, rp = r.recorder.person, fresh = '<span id="fresh">' + freshness(ctx, r) + '</span>';
    if (r.ended) return '';
    if (s.unsaved[r.id]) return '';
    /* Paused: the recorder's window gets Resume. Anyone else still sees how to pick up or take over recording, so a paused run
       whose recorder has gone can be resumed from another window. */
    if (r.paused) {
      var note = '<div class="notice warn" role="status"><span>' + I('pause') + ' <b>Paused</b> by ' + esc(nameOf(ctx, r.paused.by)) + ' at ' + U.hm(r.paused.at) + ': ' + esc(r.paused.reason) + '. Steps and gates can\'t change until it\'s resumed; timers are stopped. Deadlines from other tools keep counting.</span>' +
        (ctx.recording(r) ? '<button class="btn go" data-act="resume">Resume</button>' : '') + '</div>';
      return ctx.recording(r) ? note : note + whoRecords(ctx, r, fresh);
    }
    var pauseCtl = s.pick && s.pick.kind === 'pause' ? '<span class="row" data-scope="pause"><label class="sr" for="pick-input">Why pause?</label><input id="pick-input" placeholder="Why pause? (what are we waiting for)" maxlength="120" data-enter="pause" data-id="run"><button class="mini" data-act="pause">Pause</button><button class="mini" data-act="unpick">Cancel</button></span>'
      : '<button class="mini" data-act="pick" data-kind="pause" data-id="run">' + I('pause') + 'Pause</button>';
    if (ctx.recording(r)) {
      var people = ctx.data.people.filter(function (p) { return !p.inactive && p.id !== me; });
      var hand = s.pick && s.pick.kind === 'handoff' ? '<label class="sr" for="handoff-to">Hand recording to</label><select id="handoff-to">' + people.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') + '</select><button class="mini" data-act="handoff">Hand off</button><button class="mini" data-act="unpick">Cancel</button>'
        : '<button class="mini" data-act="pick" data-kind="handoff" data-id="recorder">' + I('swap') + (R.solo(r) ? 'Hand to someone' : 'Hand off') + '</button>';
      if (R.solo(r)) return '<div class="notice"><span><b>Your run.</b> Work down the list and check each step as you go.</span><span class="row">' + fresh + pauseCtl + hand + '</span></div>';
      return '<div class="notice"><span><b>You\'re recording.</b> Read each step aloud; the team answers; you check it.</span><span class="row">' + fresh + pauseCtl + hand + '</span></div>';
    }
    return whoRecords(ctx, r, fresh);
  }
  /* For a window that isn't recording: who is, and how to pick up or take over. */
  function whoRecords(ctx, r, fresh) {
    var s = ctx.state, me = s.me, rp = r.recorder.person;
    if (!r.recorder.session && R.waitingForHandoff(r)) return '<div class="notice warn"><span><b>' + esc(nameOf(ctx, r.recorder.handoff.from)) + ' handed recording to ' + (rp === me ? 'you' : esc(nameOf(ctx, rp))) + '.</b> Their last change hasn\'t reached this computer yet, so it can\'t be picked up here until OneDrive syncs it.</span>' + fresh + '</div>';
    if (rp === me && !r.recorder.session) return '<div class="notice good"><span><b>Recording is waiting for you.</b> Pick it up to start checking steps in this window. You\'ll continue from revision ' + (r.rev || 0) + '.</span><button class="btn go" data-act="pickup">Pick up recording</button></div>';
    if (!r.recorder.session) return '<div class="notice warn"><span>Waiting for ' + esc(nameOf(ctx, rp)) + ' to pick up recording.</span>' + fresh + '</div>';
    var risk = 'If the other window has changes OneDrive hasn\'t delivered yet, they\'ll show up as a conflict copy to review.';
    if (rp === me) return '<div class="notice warn"><span><b>You\'re recording this run in another window or on another computer</b>, so this one is view-only. To record here instead, choose <b>Record here</b>; the other window becomes view-only. ' + risk + '</span><button class="btn go" data-act="takeover">Record here</button></div>';
    var ask = s.pick && s.pick.kind === 'takeover' ? '<span class="row"><b>Take over from ' + esc(nameOf(ctx, rp)) + '? Only if they can\'t continue. ' + risk + '</b><button class="btn stop" data-act="takeover">Take over</button><button class="mini" data-act="unpick">Cancel</button></span>' : (me ? '<button class="mini" data-act="pick" data-kind="takeover" data-id="recorder">Take over recording</button>' : '');
    return '<div class="notice"><span>' + avatar(ctx, rp) + ' <b>' + esc(nameOf(ctx, rp)) + '</b> is recording. You\'re following along; this screen refreshes every few seconds.</span>' + fresh + ask + '</div>';
  }

  /* Conflict copies and copies kept in this browser, side by side with what's current, with a way to keep or delete each. */
  function recovery(ctx, r, rec) {
    var s = ctx.state, copies = r._conflicts || [], local = ctx.localCopy(r);
    if (!copies.length && !local) return '';
    var h = '<section class="notice bad recovery" aria-labelledby="rec-t"><div class="stack" style="gap:8px;width:100%"><h3 id="rec-t" style="margin:0">' + (copies.length + (local ? 1 : 0)) + ' other version' + (copies.length + (local ? 1 : 0) === 1 ? '' : 's') + ' of this run</h3>' +
      '<span class="small">Two computers saved at once, or a save couldn\'t be written. Compare, keep the right one, and delete the rest. Nothing is merged automatically.</span>';
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

  function refPanel(ctx, r, map, rec) {
    var s = ctx.state, x = s.sel && M.findStep(map, s.sel);
    if (!x) return '<aside class="ref" data-open="false" aria-label="Step details"><p class="small">Choose <b>Notes</b> on a step to see how to do it and what the team noted.</p></aside>';
    var st = x.step, t = T.get(st.type, r.types);
    var notes = (r._notes || []).filter(function (n) { return n.step === st.id; });
    var shots = st.shots.map(function (sh, i) { return '<button class="thumb" data-act="zoom" data-id="' + esc(st.id) + '" data-i="' + i + '" aria-label="Expand: ' + esc(sh.caption) + '" title="' + esc(sh.caption) + '">' + ctx.img(sh.src, sh.caption) + '</button>'; }).join('');
    var h = '<aside class="ref" data-scope="ref:' + esc(st.id) + '" data-open="' + s.refOpen + '" aria-label="Step details"><button class="mini close" data-act="close-ref">Close</button>' + (t ? '<div class="eyebrow">' + esc(t.label) + '</div>' : '') + '<h3>' + U.mdInline(st.text) + '</h3>' + (t ? '<div class="small">' + esc(t.hint) + '</div>' : '') +
      (st.note ? '<div class="note">' + U.mdBlock(st.note) + '</div>' : '') + (shots ? '<div class="thumbs">' + shots + '</div>' : '');
    var a = r.steps[st.id];
    if (rec && !r.paused && R.phaseOpen(r, map, M.findStep(map, st.id).phaseIndex) && a && a.s === 'done' && !a.differently) {
      h += s.pick && s.pick.kind === 'differently' && s.pick.id === st.id
        ? '<div class="compose"><label class="small" for="pick-input">What did you do differently? It helps whoever updates the checklist.</label><input id="pick-input" maxlength="300" data-enter="differently" data-id="' + esc(st.id) + '" style="border:1px solid var(--line);border-radius:7px;padding:7px 10px"><div class="row"><button class="btn" data-act="differently" data-id="' + esc(st.id) + '">Save</button><button class="mini" data-act="unpick">Cancel</button></div></div>'
        : '<button class="mini" style="align-self:flex-start" data-act="pick" data-kind="differently" data-id="' + esc(st.id) + '">Did it differently? Say how</button>';
    }
    if (a && a.differently) h += '<div class="notice" style="margin:0"><span><span class="badge b-diff">Done differently</span> ' + esc(a.differently.note) + '</span></div>';
    if (a && a.history && a.history.length) h += '<details><summary class="small" style="cursor:pointer">Earlier answers (' + a.history.length + ')</summary><ul class="tnotes" style="margin-top:8px">' + a.history.slice().reverse().map(function (x) {
      return '<li>' + avatar(ctx, x.by) + '<div><div class="meta">' + esc(nameOf(ctx, x.by)) + ' · ' + esc(U.when(x.at)) + '</div><div>' + esc({ done: 'Done', na: 'N/A', blocked: 'Blocked', recheck: 'Needed a re-check' }[x.s] || x.s) + (x.reason ? ': ' + esc(x.reason) : '') + (x.values ? ' · ' + esc(Object.keys(x.values).map(function (k) { return k + ' ' + x.values[k]; }).join(', ')) : '') + (x.differently ? ' · done differently: ' + esc(x.differently.note) : '') + '</div></div></li>';
    }).join('') + '</ul></details>';
    /* Answers older than run.json keeps live in the run's history files; they're read only when someone asks. */
    var arch = s.archive[runKey(r)];
    if (arch) { var mine = arch.filter(function (x) { return x.kind === 'answer' && x.step === st.id; }); if (mine.length) h += '<details open><summary class="small">Archived answers (' + mine.length + ')</summary><ul class="tnotes">' + mine.map(function (x) { return '<li>' + avatar(ctx, x.by) + '<div><div class="meta">' + esc(nameOf(ctx, x.by)) + ' · ' + esc(U.when(x.at)) + '</div><div>' + esc(x.s) + (x.reason ? ': ' + esc(x.reason) : '') + '</div></div></li>'; }).join('') + '</ul></details>'; }
    else if (a && a.history && a.history.length >= 10) h += '<button class="mini" style="align-self:flex-start" data-act="load-history">Show older answers</button>';
    h += '<h3 style="margin-top:6px">' + (R.solo(r) ? 'Notes' : 'Team notes') + '</h3>' + (notes.length ? '<ul class="tnotes">' + notes.map(function (n) {
      var made = (r.followUps || []).some(function (f) { return f.from === n.id; });
      return '<li>' + avatar(ctx, n.by) + '<div><div class="meta">' + esc(nameOf(ctx, n.by)) + ' · ' + U.hm(n.at) + (n.kind === 'map' ? ' · <span class="badge b-plan">checklist change</span>' : '') + '</div><div>' + U.mdInline(n.text) + '</div>' +
        (rec && r.state === 'running' && n.text ? (made ? '<span class="small">Follow-up added</span>' : '<button class="linkish" data-act="add-followup" data-text="' + esc(n.text.slice(0, 300)) + '" data-step="' + esc(st.id) + '" data-from="' + esc(n.id) + '">Make it a follow-up</button>') : '') +
        ((n.files || []).length ? '<div class="thumbs" style="margin-top:6px">' + n.files.map(function (f, i) { return '<button class="thumb" data-act="zoom-note" data-id="' + esc(n.id) + '" data-i="' + i + '" aria-label="Expand attachment">' + ctx.img(f, 'Attachment') + '</button>'; }).join('') + '</div>' : '') + '</div></li>';
    }).join('') + '</ul>' : '<p class="small">No notes on this step yet.</p>');
    if (s.me) h += '<div class="compose">' + ferr(s, 'note:' + st.id) + '<label class="sr" for="note-text">Add a note</label><textarea id="note-text" maxlength="2000"' + (s.fieldErr && s.fieldErr.id === 'note:' + st.id ? ' aria-invalid="true" aria-describedby="ferr-note:' + esc(st.id) + '"' : '') + ' placeholder="' + (R.solo(r) ? 'Add a note' : 'Add a note for the team') + '. Paste a screenshot to attach it."></textarea>' +
      (ctx.attachments(runKey(r), st.id).length ? '<div class="small">' + ctx.attachments(runKey(r), st.id).length + ' screenshot' + (ctx.attachments(runKey(r), st.id).length === 1 ? '' : 's') + ' attached</div>' : '') +
      '<label class="small check-label"><input type="checkbox" id="note-map"> Suggests a change to the checklist</label>' +
      '<div class="row"><button class="btn primary" data-act="add-note" data-id="' + esc(st.id) + '">Add note</button><label class="mini" for="note-file">' + I('camera') + 'Attach</label><input type="file" id="note-file" accept="image/png,image/jpeg,image/webp" class="sr"></div></div>';
    return h + '</aside>';
  }

  /* Duplicate a run into a plan: offered once its process has a published version to plan on. */
  function planAgain(ctx, r) {
    if (!ctx.state.me || !ctx.processes().some(function (p) { return p.id === r.process && p.latest; })) return '';
    return '<button class="btn" data-act="plan-from-run" data-id="' + esc(runKey(r)) + '">Plan another like this</button>';
  }
  V.planAgain = planAgain;
  function run(ctx) {
    var r = ctx.run(), s = ctx.state;
    if (!r) return notices(ctx) + '<div class="panel">That run wasn\'t found. <button class="mini" data-act="home">Back to Home</button></div>';
    var map = R.mapOf(r), hl = R.headline(r, map), rec = ctx.recording(r), t = R.totals(r, map);
    var h = notices(ctx);
    var details = map.meta.context.map(function (f) {
      if (s.edit === 'detail:' + f && rec) return '<span class="inline-edit" data-scope="edit:detail:' + esc(f) + '"><label class="small" for="edit-input">' + esc(f) + '</label><input id="edit-input" maxlength="120" value="' + esc(r.details[f]) + '" data-enter="save-edit"><button class="mini" data-act="save-edit">Save</button><button class="mini" data-act="unedit">Cancel</button></span>';
      return '<button class="chip' + (r.details[f] ? '' : ' empty') + '" data-act="edit" data-id="detail:' + esc(f) + '"' + (rec ? '' : ' disabled') + '><span class="k">' + esc(f) + '</span>' + (r.details[f] ? '<span class="v">' + esc(r.details[f]) + '</span>' : 'set') + '</button>';
    }).join('');
    var roles = map.meta.roles.map(function (ro) {
      if (s.edit === 'role:' + ro && rec) return '<span class="inline-edit" data-scope="edit:role:' + esc(ro) + '"><label class="small" for="edit-input">' + esc(ro) + '</label><select id="edit-input"><option value="">Nobody</option>' + ctx.data.people.filter(function (p) { return !p.inactive; }).map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === r.roles[ro] ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select><button class="mini" data-act="save-edit">Save</button><button class="mini" data-act="unedit">Cancel</button></span>';
      return '<button class="chip' + (r.roles[ro] ? '' : ' empty') + '" data-act="edit" data-id="role:' + esc(ro) + '"' + (rec ? '' : ' disabled') + '><span class="k">' + esc(ro) + '</span>' + (r.roles[ro] ? avatar(ctx, r.roles[ro]) + esc(nameOf(ctx, r.roles[ro])) : 'assign') + '</button>';
    }).join('');
    /* Solo runs keep collaboration out of the way: roles and screen sharing appear only if someone asks for them. */
    var alone = R.solo(r), roleRow = map.meta.roles.length ? (alone && !s.showRoles ? (rec ? '<button class="mini" data-act="show-roles">' + I('people') + 'Add people</button>' : '') : roles) : '';
    h += '<div class="runhead"><div><div class="eyebrow">' + esc(map.meta.title) + ' · v' + esc(r.version) + ' · started ' + esc(U.when(r.created)) + '</div><h1>' + esc(r.title) + '</h1><div class="chips">' + details + '</div>' + (roleRow ? '<div class="chips">' + roleRow + '</div>' : '') + '</div>' +
      '<div class="row"><div><div class="big">' + t.done + '<span class="muted">/' + t.total + '</span></div><div class="small">steps answered</div></div>' +
      (alone ? '' : '<button class="btn" data-act="mission">' + I('screen') + 'Screen share</button>') + '<button class="btn" data-act="receipt">' + I('receipt') + 'Receipt</button>' + planAgain(ctx, r) + '</div></div>';
    if (r.parent) { var pk = r.parent.process + '/' + r.parent.id, pr = ctx.findRun(pk); h += '<div class="notice"><span>' + I('nest') + ' Part of <b>' + esc(pr ? pr.title : r.parent.process) + '</b>. When this run ends, that run\'s step is checked (or blocked, if this one stops).</span>' + (pr ? '<button class="mini" data-act="open-run" data-id="' + esc(pk) + '">Open it</button>' : '') + '</div>'; }
    h += recovery(ctx, r, ctx.canRecover(r)) + recorderBar(ctx, r) + timeline(ctx, r, map);
    h += '<div class="headline" data-s="' + hl.s + '" role="status"><div><div class="headline-text">' + esc(hl.text) + '</div><div class="small">' + esc(hl.sub) + '</div></div><div class="row">';
    if (hl.step) h += '<button class="mini" data-act="goto" data-id="step-' + esc(hl.step) + '">Show the blocked step</button>';
    if (hl.gate) h += '<button class="mini" data-act="goto" data-id="gate-' + esc(hl.gate) + '">Go to the gate</button>';
    if (rec) h += '<button class="btn' + (hl.s === 'stopped' ? ' stop' : hl.s === 'complete' ? ' go' : '') + '" data-act="finish">' + (hl.s === 'complete' ? 'Finish the run' : 'End run') + '</button>';
    h += '</div></div>';
    var rail = '', deck = '', currentFound = false, schedBy = {};
    R.schedule(r, map, Date.now()).forEach(function (it) { schedBy[it.what + ':' + it.id] = it; });
    var row = function (p, pi, open) { return function (st) { return stepRow(ctx, r, map, { phase: p, phaseIndex: pi, step: st, sched: schedBy['step:' + st.id] }, rec, open); }; };
    map.phases.forEach(function (p, pi) {
      var gst = R.gateStatus(r, map, pi), info = R.phaseInfo(r, map, pi), done = gst === 'passed' || gst === 'waived', locked = gst === 'locked';
      var phaseState = done ? 'done' : locked ? 'locked' : (!currentFound ? 'current' : 'open');
      if (phaseState === 'current') currentFound = true;
      rail += '<button data-act="goto" data-id="phase-' + esc(p.id) + '" data-s="' + phaseState + '"><span class="num">' + (done ? '✓' : pi + 1) + '</span><span class="name">' + esc(p.title) + '</span><span class="count">' + info.done + '/' + info.total + '</span></button><div class="gate-line">' + I('gate') + '<span class="pill ' + gst + '">' + esc(p.gate.implicit ? 'confirm' : p.gate.title) + '</span></div>';
      /* Finished phases and phases that can't start yet fold to one line, so the current phase gets the attention. */
      var open = R.phaseOpen(r, map, pi), folded = (done || locked) && !s.unfold[p.id];
      var one = R.solo(r), hint = p.mode === 'READ-DO' ? (one ? 'Read each step, then do it.' : 'Read each step aloud, then do it.') : p.mode === 'DO-CONFIRM' ? (one ? 'Do the work, then stop and confirm each step.' : 'Do the work, then stop and confirm each step together.') : '';
      deck += '<section class="phase" id="phase-' + esc(p.id) + '" data-s="' + (done ? 'done' : locked ? 'locked' : 'open') + '" aria-labelledby="ph-' + esc(p.id) + '"><div class="placard"><span class="p-label">Phase ' + (pi + 1) + '</span><h2 class="p-title" id="ph-' + esc(p.id) + '" tabindex="-1">' + esc(p.title) + '</h2><span class="p-count">' + info.done + '/' + info.total + '</span>' +
        (p.mode ? '<span class="mode">' + p.mode + '</span>' : '') + (hint && !folded ? '<span class="mode-hint">' + hint + '</span>' : '') + '</div>';
      if (folded) deck += '<div class="folded"><span>' + (locked ? info.total + ' step' + (info.total === 1 ? '' : 's') + ', after the gate above' : info.done + ' of ' + info.total + ' steps answered') + '</span><button class="mini" data-act="unfold" data-id="' + esc(p.id) + '">' + (locked ? 'Preview steps' : 'Show steps') + '</button></div>';
      else deck += stepsHtml(ctx, r, p, row(p, pi, open));
      deck += gateBlock(ctx, r, map, pi, rec, schedBy['gate:' + p.gate.id]) + '</section>';
    });
    h += '<div class="run"><nav class="rail" aria-label="Phases">' + rail + '</nav><div class="deck">' + deck + '</div>' + refPanel(ctx, r, map, rec) + '</div>';
    return h;
  }

  /* The day at a glance: every step and gate with a clock time or an "after start" due time, in order. */
  function timeline(ctx, r, map) {
    var items = R.schedule(r, map, Date.now());
    if (!items.length) return '';
    var late = items.filter(function (it) { return it.status === 'late' || it.status === 'started?'; }).length, s = ctx.state;
    var head = '<button class="mini" data-act="timeline" aria-expanded="' + (s.timeline ? 'true' : 'false') + '">' + I('timeline') + 'Day timeline · ' + items.length + ' timed' + (late ? ' · ' + late + ' late' : '') + '</button>';
    if (!s.timeline) return '<div class="tl-head">' + head + '</div>';
    return '<div class="tl-head">' + head + '</div><ol class="timeline">' + items.map(function (it) {
      return '<li data-s="' + esc(it.status.replace(/\W+/g, '-')) + '"><span class="tl-time">' + U.hm(new Date(it.ms).toISOString()) + '</span><button class="link" data-act="goto" data-id="' + (it.what === 'gate' ? 'gate-' : 'step-') + esc(it.id) + '">' + esc(it.title) + '</button><span class="small">' + esc(it.phase) + ' · ' + esc((it.kind === 'at' ? 'starts' : 'due') + (SCHED_WORD[it.status] ? ' · ' + SCHED_WORD[it.status] : '')) + '</span></li>';
    }).join('') + '</ol>';
  }

  /* Steps outside any track first, then the phase's tracks side by side: parallel work, all finished before the gate. */
  function stepsHtml(ctx, r, p, row) {
    var loose = p.steps.filter(function (st) { return !st.track; }), h = loose.length ? '<ul class="steps">' + loose.map(row).join('') + '</ul>' : '';
    if (!p.tracks || !p.tracks.length) return h;
    return h + '<div class="tracks">' + p.tracks.map(function (t) {
      var steps = p.steps.filter(function (st) { return st.track === t.id; }), done = steps.filter(function (st) { return R.answered(r, st); }).length;
      var who = t.roles.map(function (ro) { return r.roles[ro] ? avatar(ctx, r.roles[ro]) + esc(nameOf(ctx, r.roles[ro])) : esc(ro); }).join(', ');
      return '<section class="track" aria-labelledby="tr-' + esc(t.id) + '"><div class="track-head"><h3 id="tr-' + esc(t.id) + '">' + esc(t.title) + '</h3><span class="small">' + (who ? who + ' · ' : '') + done + '/' + steps.length + '</span></div><ul class="steps">' + steps.map(row).join('') + '</ul></section>';
    }).join('') + '</div>';
  }

  V.run = run; K.ferr = ferr; K.fieldInput = fieldInput;
})();
