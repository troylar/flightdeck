/* A process page, and the form that starts a run. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, R = PF.run, M = PF.map, T = PF.types, I = PF.icons.icon, esc = U.esc;
  var ferr = function (s, id) { return K.ferr(s, id); };
  var person = K.person, nameOf = K.nameOf, avatar = K.avatar, notices = K.notices, ago = K.ago, runKey = K.runKey, freshness = K.freshness;
  /* ---------- process page ---------- */
  /* anchor, when given, ids each phase's heading so the flight plan can bring a phase into view. fixes, when given, counts open
     corrections per step ID (and "phase:<id>"), marked so whoever edits the draft sees them. */
  /* hl: what the builder has selected ({ line } of a step, or { phase } index), marked so the preview can show it. */
  function mapPreview(map, types, skills, anchor, fixes, hl) {
    var fixBadge = function (k) { var n = fixes && fixes[k]; return n ? ' <span class="badge b-warn">' + n + ' open correction' + (n === 1 ? '' : 's') + '</span>' : ''; };
    /* Which skills cover each step (skills mapped to the whole process are listed once, above). */
    var by = Object.create(null), whole = [];
    (skills || []).forEach(function (x) { if (!x.skill.steps) whole.push(x.skill.name); else x.skill.steps.forEach(function (id) { (by[id] = by[id] || []).push(x.skill.name); }); });
    var step = function (s) {
      var t = T.get(s.type, types), hs = hl && hl.line === s.line;
      var meta = (s.must ? '<span class="badge b-must">Must do</span>' : '') + (by[s.id] ? '<span class="badge b-skill">' + I('spark') + esc(by[s.id].join(', ')) + '</span>' : '') + (s.planned ? '<span class="badge b-plan">Automation planned</span>' : '') +
        (s.roles.length ? '<span class="pv-role">@' + esc(s.roles.join(' @')) + '</span>' : '') + fixBadge(s.id);
      return '<li' + (hs ? ' class="pv-sel" id="pv-sel" aria-current="true"' : '') + '>' + (t ? I(t.icon, t.label) : '<span class="ic"></span>') + '<div class="pv-body"><span class="pv-copy">' + U.mdInline(s.text) + '</span>' + (meta ? '<span class="pv-meta">' + meta + '</span>' : '') + '</div></li>';
    };
    /* Lanes stay lanes: the steps before any lane, then each lane as a labeled group under "Do all lanes". */
    return (whole.length ? '<p class="small">' + I('spark') + ' The whole process: ' + esc(whole.join(', ')) + '</p>' : '') + map.phases.map(function (p, pi) {
      var hp = hl && hl.phase === pi, lead = p.steps.filter(function (s) { return !s.track; });
      var lanes = p.tracks.map(function (t) { return { t: t, steps: p.steps.filter(function (s) { return s.track === t.id && t.id; }) }; });
      var body = lead.length || !lanes.length ? '<ul>' + lead.map(step).join('') + '</ul>' : '';
      if (lanes.length) body += '<div class="pv-lanes"><p class="pv-lanes-h">Do all lanes</p>' + lanes.map(function (l) {
        return '<div class="pv-lane"><p class="pv-lane-h">' + esc(l.t.title || 'Untitled lane') + (l.t.roles.length ? ' <span class="pv-role">@' + esc(l.t.roles.join(' @')) + '</span>' : '') + '</p><ul>' + l.steps.map(step).join('') + '</ul></div>';
      }).join('') + '</div>';
      return '<div class="ph' + (hp ? ' pv-sel" id="pv-sel' : '') + '"><h3' + (anchor ? ' id="' + anchor + pi + '" tabindex="-1"' : '') + '>' + esc(p.title) + (p.mode ? ' <span class="cat">' + p.mode + '</span>' : '') + fixBadge('phase:' + p.id) + '</h3>' + body +
        '<div class="g">' + I('gate') + '<span class="pv-gate-copy">Gate: ' + esc(p.gate.title) + (p.gate.approves ? ' · approves ' + U.mdInline(p.gate.approves) : '') + '</span></div></div>';
    }).join('');
  }
  function checkList(c) {
    var rows = c.blockers.map(function (b) { return '<li><span class="lvl bad">Fix</span><span>' + esc(b) + '</span></li>'; })
      .concat(c.suggestions.map(function (s) { return '<li><span class="lvl tip">Tip</span><span>' + esc(s) + '</span></li>'; }));
    if (!rows.length) rows.push('<li><span class="lvl ok">Good</span><span>Ready to publish.</span></li>');
    return '<ul class="checks">' + rows.join('') + '</ul>';
  }
  /* How runs of this process have gone, and who has held each role: from the runs in the folder, nothing stored. */
  function insights(ctx, p) {
    var an = R.analytics(ctx.data.runs, p.id);
    if (!an.runs) return '';
    var outs = Object.keys(an.outcomes).map(function (k) { return an.outcomes[k] + ' ' + k.toLowerCase(); }).join(' · ');
    var h = '<section class="panel"><h2>' + I('chart') + 'How runs go</h2><p class="small">' + an.runs + ' run' + (an.runs === 1 ? '' : 's') + (an.running ? ', ' + an.running + ' still going' : '') + (outs ? ' · ' + esc(outs) : '') +
      (an.medianMs != null ? ' · typical completed run ' + U.clock(an.medianMs) + ' (paused time not counted)' : '') + (an.gates.waived || an.gates.failed ? ' · gates waived ' + an.gates.waived + ', failed ' + an.gates.failed : '') + '</p>';
    var top = Math.max.apply(null, an.phases.map(function (x) { return x.medianMs || 0; }).concat([1]));
    if (an.phases.length) h += '<h3>Typical time per phase</h3><div class="grid-wrap"><table class="grid"><thead><tr><th scope="col">Phase</th><th scope="col">Median</th><th scope="col"><span class="sr">Relative</span></th><th scope="col">Runs</th></tr></thead><tbody>' + an.phases.map(function (x) {
      return '<tr><td>' + esc(x.title) + '</td><td>' + U.clock(x.medianMs) + '</td><td><span class="bar" style="width:' + Math.max(2, Math.round(120 * x.medianMs / top)) + 'px"></span></td><td>' + x.n + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    if (an.steps.length) h += '<h3>Steps that often go off-script</h3><div class="grid-wrap"><table class="grid"><thead><tr><th scope="col">Step</th><th scope="col">Blocked</th><th scope="col">Did differently</th><th scope="col">Re-checked</th><th scope="col">Not needed</th></tr></thead><tbody>' + an.steps.map(function (c) {
      return '<tr><td>' + esc(c.text) + '</td><td>' + c.blocked + '</td><td>' + c.differently + '</td><td>' + c.recheck + '</td><td>' + c.na + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="small">These are good places to change the checklist. The flightdeck-learn-from-runs skill for your AI assistant reads the same runs.</p>';
    var rot = R.rotation(ctx.data.runs, p.id), people = Object.keys(rot.grid);
    if (rot.roles.length && people.length) h += '<h3>Who has done each role</h3><div class="grid-wrap"><table class="grid"><thead><tr><th scope="col">Person</th>' + rot.roles.map(function (ro) { return '<th scope="col">' + esc(ro) + '</th>'; }).join('') + '</tr></thead><tbody>' + people.sort(function (a, b) { return nameOf(ctx, a).localeCompare(nameOf(ctx, b)); }).map(function (pid) {
      return '<tr><th scope="row">' + esc(nameOf(ctx, pid)) + '</th>' + rot.roles.map(function (ro) { var c = rot.grid[pid][ro]; return c ? '<td>' + c.count + '× · last ' + esc(U.when(c.last)) + '</td>' : '<td class="cold">never</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div><p class="small">"Never" is a good place to rotate someone in. Starting a run suggests whoever did a role least recently.</p>';
    return h + '</section>';
  }
  /* The team's own step types and Jira workflows, with anything in those files that couldn't be used. */
  /* Jira workflows the folder defines (step types have their own page). */
  function teamSetup(ctx) {
    var jw = ctx.data.jira || { workflows: {}, errors: [] }, wf = Object.keys(jw.workflows || {});
    if (!wf.length && !jw.errors.length) return '';
    return '<section class="panel"><h2>' + I('ticket') + 'Jira workflows</h2>' + (wf.length ? '<ul class="vlist">' + wf.map(function (k) { var w = jw.workflows[k]; if (w.invalid) return '<li><b>' + esc(k === PF.jira.FILE ? 'The file' : k) + '</b> · not used: ' + esc(w.invalid) + '</li>'; var req = w.transitions.reduce(function (n, t) { return n + t.fields.length; }, 0); return '<li><b>' + esc(k) + '</b> · ' + w.statuses.length + ' statuses, ' + w.transitions.length + ' transitions' + (req ? ', ' + req + ' required fields' : '') + '</li>'; }).join('') + '</ul>' : '') +
      jw.errors.map(function (e) { return '<div class="notice warn"><span>' + esc(e) + '</span></div>'; }).join('') + '<p class="small">Edit <code>jira/workflows.json</code> to change them.</p></section>';
  }

  var SKILL_PILL = { current: ['passed', 'in step'], unaffected: ['open', 'note version'], update: ['failed', 'needs update'], missing: ['failed', 'check it'] };
  /* Skills built from this process: one row each, opening the skill's own page. */
  function skillsPanel(ctx, p) {
    var h = '<section class="panel" aria-labelledby="sk-h"><h2 id="sk-h">' + I('spark') + 'Skills</h2>';
    if (!p.skills.length) return h + '<p class="small">None yet. Once a version is signed off below, copy its brief for your AI assistant.</p></section>';
    return h + '<ul class="plist">' + p.skills.map(function (x) {
      var s = x.skill, pill = SKILL_PILL[x.status.s] || SKILL_PILL.missing;
      return '<li><button data-act="open-skill" data-id="' + esc(s.file || s.name) + '"><span class="t">' + esc(s.name) + '</span><span class="pill ' + pill[0] + '">' + pill[1] + '</span></button></li>';
    }).join('') + '</ul></section>';
  }
  /* The last brief copied, shown so it can be read or selected by hand if the clipboard isn't available. */
  function briefBox(st, key) {
    if (!st.brief || st.brief.key !== key) return '';
    var open = !st.disc || !Object.prototype.hasOwnProperty.call(st.disc, 'brief:' + key) || st.disc['brief:' + key];
    return '<details' + (open ? ' open' : '') + ' class="brief" data-disc="brief:' + esc(key) + '"><summary class="small" id="sum-brief"><span id="copy-msg" role="status"></span> The brief</summary><pre id="brief-pre" class="source" tabindex="0">' + esc(st.brief.text) + '</pre></details>';
  }
  /* Is the current version ready to become a skill? One line of status and the one thing to do next. */
  function readyPanel(ctx, p, pub) {
    if (!pub) return '';
    var st = ctx.state, ready = PF.skills.readiness(ctx.data.runs, pub, null), signs = PF.skills.signoffs(ctx.data.validations, pub), owner = pub.map.meta.owner;
    var h = '<section class="panel" aria-labelledby="rd-h"><h2 id="rd-h">' + I('check') + 'Ready for a skill?</h2>';
    if (signs.length) {
      h += '<p class="small"><b>Yes.</b> v' + pub.info.version + ' was signed off by ' + esc(nameOf(ctx, signs[0].by)) + (signs[0].as === 'backup' ? ', the backup owner,' : '') + ' ' + esc(U.day(signs[0].at)) + '.</p><button class="btn go" data-act="copy-brief" data-id="create:' + esc(p.id) + '">' + I('copy') + 'Copy the brief for your AI assistant</button>' + briefBox(st, 'create:' + p.id);
    } else if (!ready.enough) {
      h += '<p class="small"><b>Not yet.</b> ' + ready.clean + ' of ' + ready.needed + ' clean runs of v' + pub.info.version + '.</p>';
    } else if (PF.skills.signer(pub, ctx.data.people, st.me, !!(ctx.data.failed || {}).people)) {
      var asBackup = PF.skills.signer(pub, ctx.data.people, st.me, !!(ctx.data.failed || {}).people) === 'backup';
      h += '<p class="small"><b>Almost.</b> ' + ready.clean + ' clean runs of v' + pub.info.version + '. ' + (asBackup ? 'Its owner, ' + esc(nameOf(ctx, owner)) + ', is inactive or no longer on the team, so as its backup owner, you sign it off.' : 'As its owner, you sign it off.') + '</p>' + (st.pick && st.pick.kind === 'signoff'
        ? '<div class="row" data-scope="signoff"><label class="sr" for="pick-input">Note for the sign-off</label><input id="pick-input" maxlength="300" placeholder="Optional note" data-enter="signoff" data-id="' + esc(p.id) + '"><button class="btn go" data-act="signoff" data-id="' + esc(p.id) + '">Sign off</button><button class="mini" data-act="unpick">Cancel</button></div>'
        : '<button class="btn go" data-act="pick" data-kind="signoff" data-id="' + esc(p.id) + '">Sign off v' + pub.info.version + '</button>');
    } else h += '<p class="small"><b>Almost.</b> ' + ready.clean + ' clean runs. ' + esc(nameOf(ctx, owner)) + ', the owner, signs it off' + (pub.map.meta.backup && pub.map.meta.backup !== owner ? ' (or ' + esc(nameOf(ctx, pub.map.meta.backup)) + ', the backup owner, while the owner is away)' : '') + '.</p>';
    var devOpen = st.disc && st.disc['dev:' + p.id] === true;
    if (ready.deviations.length) h += '<details' + (devOpen ? ' open' : '') + ' data-disc="dev:' + esc(p.id) + '"><summary class="small" id="sum-dev">Why some runs don\'t count (' + ready.deviations.length + ')</summary><ul class="small">' + ready.deviations.slice(0, 20).map(function (d) { return '<li>' + esc(d.run) + ': ' + (d.text ? '"' + esc(d.text) + '" ' : '') + esc(d.kind) + (d.note ? ': ' + esc(d.note) : '') + '</li>'; }).join('') + '</ul></details>';
    return h + '</section>';
  }

  /* ---------- corrections (docs/design.md section 19) ---------- */
  /* Every group of corrections on a process, with where it stands. The app memoizes this per folder read; views tests compute it. */
  function fixesOf(ctx, p) {
    if (ctx.corrections) return ctx.corrections(p.id);
    var C = PF.corrections; return C.status(C.groups(C.collect(ctx.data.runs, p.id)), ctx.data.corrDecisions);
  }
  /* Grouped by step in checklist order: each group is one proposed change, "Suggested in N runs" with the runs behind it,
     and two different changes to the same step are shown as alternatives. Anyone decides; declining needs a reason. */
  function fixesPanel(ctx, p) {
    var st = ctx.state, all = fixesOf(ctx, p), C = PF.corrections;
    if (!all.length) return '';
    var open = all.filter(function (g) { return g.status === 'open'; });
    var showAll = st.fixFilter === 'all', list = showAll ? all : open, map = p.latest ? p.latest.map : p.draft ? M.parse(p.draft.md) : null;
    var h = '<section class="panel" aria-labelledby="fx-h"><h2 id="fx-h" tabindex="-1">' + I('edit') + 'Corrections · ' + open.length + ' open</h2>' +
      '<p class="small">Recorded during runs: what the checklist said, what it should say, and what happened. Review one to apply it to the draft, or mark it as applied once the draft has it.</p>' +
      '<div class="seg" role="group" aria-label="Show">' + [['open', 'Open'], ['all', 'All']].map(function (x) { return '<button type="button" data-act="corr-filter" data-id="' + x[0] + '" aria-pressed="' + ((x[0] === 'all') === showAll) + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var unread = (ctx.data.corrUnread || []).filter(function (u) { return u.process === p.id; });
    if (unread.length) h += '<div class="notice bad"><span>Couldn\'t read ' + unread.length + ' decision file' + (unread.length === 1 ? '' : 's') + ' in <code>corrections/' + esc(p.id) + '</code>' + (unread.every(function (u) { return u.kept; }) ? '. Showing what they said last time.' : '. Some corrections may show the wrong status until it syncs.') + '</span></div>';
    if (!list.length) h += '<p class="small">No open corrections.</p>';
    var order = [], groups = Object.create(null);
    if (map) map.phases.forEach(function (ph) { order.push('phase:' + ph.id); ph.steps.forEach(function (x) { order.push(x.id); }); });
    list.forEach(function (g) { var k = g.target.step || 'phase:' + g.target.phase; if (!groups[k]) { groups[k] = []; if (order.indexOf(k) < 0) order.push(k); } groups[k].push(g); });
    order.filter(function (k) { return groups[k]; }).forEach(function (k) {
      var x = map && k.indexOf('phase:') !== 0 && M.findStep(map, k), ph = map && k.indexOf('phase:') === 0 && map.phases.filter(function (q) { return 'phase:' + q.id === k; })[0];
      var gs = groups[k], alts = gs.filter(function (g) { return g.status === 'open' && g.change.op !== 'describe'; }).length;
      h += '<h3 class="fixgroup">' + (x ? U.mdInline(x.step.text) : ph ? 'Phase: ' + esc(ph.title) : esc(gs[0].from || k.replace(/^phase:/, 'Phase ')) + ' <span class="small">(not in the current version)</span>') + '</h3>' +
        (alts > 1 ? '<p class="small corr-alts"><b>' + (alts === 2 ? 'Two' : alts) + ' proposed changes.</b> Each can be decided on its own.</p>' : '') +
        '<ul class="fixlist">' + gs.map(function (g) { return groupItem(ctx, p, g); }).join('') + '</ul>';
    });
    if (open.length) h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="copy-corr-brief" data-id="' + esc(p.id) + '">' + I('copy') + 'Copy correction brief</button></div>' + briefBox(st, 'corrections:' + p.id);
    return h + '</section>';
  }
  function groupItem(ctx, p, g) {
    var st = ctx.state, C = PF.corrections, d = g.decision, c = g.first, declining = st.pick && st.pick.kind === 'corr-decline' && st.pick.id === g.id;
    var map = p.latest ? p.latest.map : null;
    var h = '<li data-scope="corr:' + esc(g.id) + '"><div class="row"><span class="badge b-plan">' + esc(C.OP_LABEL[g.change.op]) + '</span>' + V.corrPill(g) + (g.legacy ? '<span class="small">From a suggested fix</span>' : '') + '</div>';
    var dl = '';
    if (g.change.op !== 'describe' && g.from) dl += '<dt>Checklist said (v' + esc(c.version) + ')</dt><dd>' + esc(g.from) + '</dd>';
    if (g.change.op === 'wording') dl += '<dt>Suggested</dt><dd>' + V.redline(g.from, g.change.to) + '</dd>';
    else if (g.change.op !== 'describe') dl += '<dt>Suggested</dt><dd>' + esc(C.proposal(c, map)) + '</dd>';
    g.members.forEach(function (m) {
      if (m.why) dl += '<dt>' + (g.change.op === 'describe' ? 'Problem' : 'Why') + ' · ' + esc(nameOf(ctx, m.by)) + '</dt><dd>' + esc(m.why) + '</dd>';
      if (m.happened) dl += '<dt>What happened · ' + esc(nameOf(ctx, m.by)) + '</dt><dd>' + esc(m.happened) + '</dd>';
    });
    if (dl) h += '<dl class="corr-dl">' + dl + '</dl>';
    g.members.forEach(function (m) { h += V.attachments(ctx, m.id, m.files, m.fileInfo, 'corr'); });
    /* The runs behind it, with names inside: a count of runs, never a vote. */
    h += '<details class="corr-runs"><summary class="small">Suggested in ' + g.runs + ' run' + (g.runs === 1 ? '' : 's') + '</summary><ul class="small">' + g.members.map(function (m) {
      return '<li>' + esc(nameOf(ctx, m.by)) + ' · ' + esc(U.day(m.at)) + ' · <button class="linkish" data-act="open-run" data-id="' + esc(m.process + '/' + m.run) + '">' + esc(m.runTitle) + '</button> · v' + esc(m.version) + '</li>';
    }).join('') + '</ul></details>';
    if (d) h += '<div class="small">' + esc({ applied: 'Marked as applied', declined: 'Declined', open: 'Reopened', withdrawn: 'Withdrawn', legacy: 'Accepted before 1.13' }[d.status] || d.status) + ' by ' + esc(nameOf(ctx, d.by)) + ' ' + esc(U.day(d.at)) + (d.reason ? ': ' + esc(d.reason) : '') + '</div>';
    if (g.status === 'legacy') h += '<div class="small">Applied before 1.13. Flightdeck can\'t confirm which version has it.</div>';
    if (g.again) h += '<div class="small">Suggested again after it was ' + esc(g.again.status) + (g.again.reason ? ': ' + esc(g.again.reason) : '') + '</div>';
    if (g.tie) h += '<div class="small"><b>Needs review:</b> two people decided at once. Decide again to settle it.</div>';
    if (C.changedSince(g, corrBase(ctx, p).text)) h += '<div class="small corr-since"><span class="pill review">Changed since applied</span> The draft\'s step no longer matches what was applied.</div>';
    if (!st.me || g.status === 'legacy') return h + '</li>';
    if (declining) return h + '<div class="row">' + ferr(st, 'corr-decline') + '<label class="sr" for="pick-input">Why not? The runs will show this.</label><input id="pick-input" maxlength="300" placeholder="Why not? The runs will show this." data-enter="corr-decline" data-id="' + esc(g.id) + '"' + (st.fieldErr && st.fieldErr.id === 'corr-decline' ? ' aria-invalid="true" aria-describedby="ferr-corr-decline"' : '') + '><button class="btn" data-act="corr-decline" data-id="' + esc(g.id) + '">Decline</button><button class="mini" data-act="unpick">Cancel</button></div></li>';
    var acts = '';
    if (g.status === 'open' || g.tie) acts += '<button class="btn" data-act="corr-review" data-id="' + esc(g.id) + '">' + (C.applies(g) ? 'Review and apply' : 'Review') + '</button><button class="mini" data-act="corr-applied" data-id="' + esc(g.id) + '">Mark as applied</button><button class="mini" data-act="pick" data-kind="corr-decline" data-id="' + esc(g.id) + '">Decline</button>';
    if (g.status !== 'open' || g.tie) acts += '<button class="mini" data-act="corr-reopen" data-id="' + esc(g.id) + '">Reopen</button>';
    if (g.status === 'open' && C.canWithdraw(g, st.me)) acts += '<button class="mini" data-act="corr-withdraw" data-id="' + esc(g.id) + '" data-process="' + esc(p.id) + '">Withdraw</button>';
    return h + '<div class="row">' + acts + '</div></li>';
  }

  /* The draft a correction is compared with and applied to: the editor's (what it started from, so applying and its Undo
     share one timeline), else the draft in the folder, else the latest version, which applying makes the draft. */
  function corrBase(ctx, p) {
    var st = ctx.state, ed = st.editor && st.editor.pid === p.id && st.editor.fsKey === ctx.fsKey ? st.editor : null;
    var text = ed ? ed.base : p.draft ? p.draft.md : p.latest ? p.latest.md : '';
    return { text: text, ed: ed, dirty: !!(ed && ed.text != null && ed.text !== ed.base) || st.obPending === p.id, conflict: !!(ed && ed.conflict),
      saving: (st.draftSaving || {})[ctx.fsKey + '\n' + p.id], fresh: !p.draft };
  }
  /* One column of the comparison: the step's wording, and who does it or where it is when that's what changes. */
  function caCol(id, head, v, op, other) {
    var body;
    if (!v) body = '<p class="ca-none">' + esc(other) + '</p>';
    else {
      body = v.text ? '<p class="ca-text">' + (v.redFrom != null && v.redFrom !== v.text ? V.redline(v.redFrom, v.text) : esc(v.text)) + '</p>' : '';
      if (op === 'roles' || v.rolesToo) body += '<p class="small">Who: ' + (v.roles.length ? esc(v.roles.map(function (r) { return '@' + r; }).join(', ')) : 'anyone') + '</p>';
      if ((op === 'move' || op === 'add') && v.where) body += '<p class="small">' + esc(v.where) + '</p>';
    }
    return '<section class="ca-col" aria-labelledby="' + id + '"><h3 id="' + id + '">' + head + '</h3>' + body + '</section>';
  }
  /* The dialog that applies one group of corrections to the draft: From the run's vN | Draft now | Proposed result, and
     what can be done in the state it's in. Nothing is applied that isn't clean unless the person edits or confirms it. */
  function corrApply(ctx, ov) {
    var st = ctx.state, C = PF.corrections, p = ctx.processes().filter(function (x) { return x.id === ov.pid; })[0];
    var gs = p ? fixesOf(ctx, p) : [], g = gs.filter(function (x) { return x.id === ov.gid; })[0];
    var box = function (inner) { return '<div class="overlay" data-act="close-overlay"><div class="ca-box" role="dialog" aria-modal="true" aria-labelledby="ca-t">' + inner + '</div></div>'; };
    var bar = function (t) { return '<div class="ca-bar"><h2 id="ca-t" tabindex="-1">' + t + '</h2><button type="button" class="mini" id="ca-close" data-act="close-overlay">Close</button></div>'; };
    if (!g || (g.status !== 'open' && !g.tie)) return box(bar('Apply a correction') + '<p>' + (g ? 'This correction was decided meanwhile: ' + esc(C.label(g)) + '.' : 'This correction isn\'t here anymore.') + '</p>');
    var base = corrBase(ctx, p), c = g.first, ch = g.change, edited = ov.edit ? ov.edit.text : null;
    var applied = (st.corrApplied || {})[ctx.fsKey + '\n' + p.id + '\n' + g.id] || null;
    var rv = C.review(g, base.text, ov.edit && ov.edit.text != null && (ch.op === 'wording' || ch.op === 'add') ? edited : null, { applied: applied }), stepName = c.from || (rv.now && rv.now.text) || '';
    var h = bar('Apply to the draft: ' + (stepName ? '“' + esc(stepName) + '”' : 'step ' + esc(g.target.step || g.target.phase)));
    h += '<p class="small"><span class="badge b-plan">' + esc(C.OP_LABEL[ch.op]) + '</span> Suggested in ' + g.runs + ' run' + (g.runs === 1 ? '' : 's') + (base.fresh ? ' · There\'s no draft yet: applying starts one from v' + esc(p.latest ? p.latest.info.version : '') + '.' : '') + '</p>';
    var stateLine = { clean: '', already: 'This is already in the draft.', changed: rv.reason, gone: rv.reason || 'This step isn\'t in the draft anymore.', manual: 'Flightdeck can\'t apply this one for you. ' + rv.reason }[rv.state];
    if (ov.edit) stateLine = 'Your edit is applied as written. Check it against the draft now.';
    if (stateLine) h += '<div class="notice ' + (rv.state === 'already' && !ov.edit ? 'good' : 'warn') + '" role="status"><span>' + esc(stateLine) + '</span></div>';
    /* The run's version: its own record of what the step said and the change it proposed. */
    var from = { text: g.from, roles: [], where: '' }, prop = C.proposal(c, null);
    var result = rv.result ? Object.assign({}, rv.result, { redFrom: rv.now && !rv.now.anchor ? rv.now.text : null }) : null;
    var said = '<section class="ca-col" aria-labelledby="ca-h-from"><h3 id="ca-h-from">From the run\'s v' + esc(c.version) + '</h3>' + (from.text ? '<p class="ca-text">' + esc(from.text) + '</p>' : '<p class="ca-none">Not recorded.</p>') +
      '<p class="small">Suggested: ' + (ch.op === 'wording' ? esc(ch.to) : esc(prop || c.why || '')) + '</p></section>';
    h += '<div class="ca-cols">' + said +
      caCol('ca-h-now', 'Draft now', rv.now && (rv.now.text || rv.now.where) ? rv.now : null, ch.op, 'Not in the draft.') +
      caCol('ca-h-res', 'Proposed result', result, ch.op, rv.removed ? 'Removed from the checklist.' : rv.state === 'manual' ? 'Made by hand in the editor.' : rv.state === 'gone' ? 'Nothing to change.' : 'Nothing to change.') + '</div>';
    var err = ov.err ? '<p class="ferr" id="ferr-' + esc(ov.err.field) + '" role="alert">' + esc(ov.err.msg) + '</p>' : '';
    if (base.conflict) h += '<div class="notice bad" role="alert"><span>Someone else changed this draft while you were editing it. Settle that in the editor first.</span></div>';
    else if (base.dirty) h += '<div class="notice warn" role="alert"><span>You have unsaved changes to this draft. Save or discard them in the editor first, so applying can\'t mix with them.</span><button type="button" class="mini" data-act="corr-open-editor" data-id="' + esc(g.id) + '">Open the editor</button></div>';
    else if (base.saving) h += '<p class="small" role="status">Saving the draft…</p>';
    var blocked = base.conflict || base.dirty || !!base.saving || !st.me, dis = blocked ? ' disabled' : '';
    var alts = C.alternatives(gs, g), combine = alts.length > 1 && alts.every(function (x) { return x.change.op === 'wording'; });
    var acts = '';
    if (ov.declining) {
      acts = '<label class="sr" for="ca-reason">Why not? The runs will show this.</label><input id="ca-reason" maxlength="300" placeholder="Why not? The runs will show this." data-enter="corr-ca-decline" data-id="' + esc(g.id) + '"' + (ov.err && ov.err.field === 'ca-reason' ? ' aria-invalid="true" aria-describedby="ferr-ca-reason"' : '') + '>' +
        '<button type="button" class="btn" data-act="corr-ca-decline" data-id="' + esc(g.id) + '">Decline</button><button type="button" class="mini" data-act="corr-ca-cancel">Cancel</button>';
      return box(h + (ov.err && ov.err.field === 'ca-reason' ? err : '') + '<div class="row ca-acts">' + acts + '</div>');
    }
    if (ov.edit) {
      var txt = ch.op === 'wording' || ch.op === 'add';
      if (txt) h += '<label class="field" for="ca-edit">' + (ch.op === 'add' ? 'The new step' : 'Proposed result') + '<textarea id="ca-edit" rows="3" maxlength="2000"' + (ov.err && ov.err.field === 'ca-edit' ? ' aria-invalid="true" aria-describedby="ferr-ca-edit"' : '') + '>' + esc(edited != null ? edited : '') + '</textarea></label>' + (ov.err && ov.err.field === 'ca-edit' ? err : '');
      else h += '<p class="small">Applies "' + esc(prop) + '" to the step as the draft has it now.</p>';
      if (ov.combine) h += '<p class="small">Combining ' + ov.combine.length + ' proposals: applying marks each of them as applied.</p>';
      acts = '<button type="button" class="btn go" data-act="corr-apply" data-id="' + esc(g.id) + '" data-how="edit"' + dis + (rv.state === 'gone' || rv.state === 'manual' ? ' disabled' : '') + '>Apply to draft</button><button type="button" class="mini" data-act="corr-edit-cancel">Cancel</button>';
      if (rv.state === 'manual' || rv.state === 'gone') h += '<p class="small">' + esc(rv.reason) + '</p>';
      return box(h + (ov.err && ov.err.field !== 'ca-edit' ? err : '') + '<div class="row ca-acts">' + acts + '</div>');
    }
    var apply = function (label) { return '<button type="button" class="btn go" data-act="corr-apply" data-id="' + esc(g.id) + '"' + dis + '>' + label + '</button>'; };
    var addressed = '<button type="button" class="btn" data-act="corr-addressed" data-id="' + esc(g.id) + '"' + (st.me ? '' : ' disabled') + '>Already addressed</button>';
    if (rv.state === 'clean') acts = alts.length > 1 ? apply('Use this proposal') + (combine ? '<button type="button" class="btn" data-act="corr-combine" data-id="' + esc(g.id) + '"' + dis + '>Combine into a new proposal</button>' : '') : apply('Apply to draft');
    else if (rv.state === 'already') acts = '<button type="button" class="btn go" data-act="corr-link" data-id="' + esc(g.id) + '"' + (st.me ? '' : ' disabled') + '>Link this correction</button>';
    else if (rv.state === 'changed') acts = '<button type="button" class="btn go" data-act="corr-edit" data-id="' + esc(g.id) + '"' + dis + '>Edit proposed result</button>' + addressed;
    else if (rv.state === 'gone') acts = addressed + '<button type="button" class="btn" data-act="corr-ca-declining" data-id="' + esc(g.id) + '"' + (st.me ? '' : ' disabled') + '>Decline</button>';
    else acts = '<button type="button" class="btn go" data-act="corr-open-editor" data-id="' + esc(g.id) + '">Open in the editor</button><button type="button" class="btn" data-act="corr-addressed" data-id="' + esc(g.id) + '"' + (st.me ? '' : ' disabled') + '>Mark as applied</button>';
    if (alts.length > 1 && rv.state === 'clean') h += '<p class="small">' + (alts.length === 2 ? 'Two' : alts.length) + ' proposed changes to this step. Use one, or combine them into your own wording.</p>';
    return box(h + err + '<div class="row ca-acts">' + acts + '</div>');
  }

  function process(ctx) {
    var st = ctx.state, p = ctx.processes().filter(function (x) { return x.id === st.processId; })[0];
    if (!p) {
      /* Its draft was removed while it had edits that aren't saved: keep them reachable, to copy or to save again. */
      var lost = st.editor && st.editor.text != null ? st.editor : null;
      if (lost) return notices(ctx) + '<section class="panel stack" role="alert"><h2>This draft was removed from the folder</h2><p>Your edits that weren\'t saved are below. Save them as the draft again, or copy them.</p>' +
        '<div class="row"><button class="btn go" data-act="recover-draft">Save as the draft again</button><button class="mini" data-act="copy-map">' + I('copy') + 'Copy</button><span id="copy-msg" class="small" role="status"></span></div><pre class="source" id="map-source" tabindex="0">' + esc(lost.text) + '</pre></section>';
      return notices(ctx) + '<div class="panel">That process wasn\'t found. <button class="mini" data-act="home">Back to Home</button></div>';
    }
    /* Editing a draft takes the whole page (manage.js). */
    if (V.tabOf(ctx) === 'edit') return V.editTab(ctx, p);
    var pub = p.latest, h = notices(ctx);
    h += '<div class="runhead"><div><div class="eyebrow">' + esc(p.category) + (pub ? ' · v' + pub.info.version + ' · owner ' + esc(nameOf(ctx, pub.map.meta.owner)) : '') + '</div><h1>' + esc(p.title) + '</h1>' +
      (pub ? '<div class="small">Published by ' + esc(nameOf(ctx, pub.info.publishedBy)) + ' on ' + esc(U.when(pub.info.publishedAt)) + ' · "' + esc(pub.info.changes) + '"</div>' : '<div class="small">Not published yet.</div>') + '</div>' +
      '<div class="row">' + (V.tabOf(ctx) === 'overview' && p.all.length ? '<button class="mini" data-act="ptab" data-id="insights">' + I('chart') + 'How runs go</button>' : '') + (pub ? '<button class="btn primary" data-act="start" data-id="' + esc(p.id) + '"' + (st.me ? '' : ' disabled') + '>' + I('play') + 'Start a run</button><button class="btn" data-act="plan-run" data-id="' + esc(p.id) + '"' + (st.me ? '' : ' disabled') + '>Plan a run</button>' : '') + '</div></div>';
    var dWhy = p.draft && ((st.unread || {}).drafts || {})[p.draft.file];
    if (dWhy) h += '<div class="notice bad" role="alert"><span><b>' + esc(p.draft.file) + ' couldn\'t be read on the last check</b> (' + esc(dWhy) + '). This is the version read before. It isn\'t edited or saved over until it reads again.</span><span class="row"><button class="btn" data-act="refresh">Try again</button><button class="mini" data-act="recovery" data-id="a-file-cant-be-read">What to do</button></span></div>';
    if (p.sharedDrafts) h += '<div class="notice bad" role="alert"><span><b>' + p.sharedDrafts.length + ' drafts say process: ' + esc(p.id) + '</b> (' + p.sharedDrafts.map(function (f) { return '<code>' + esc(f) + '</code>'; }).join(', ') + '). This page shows ' + esc(p.draft.file) + '. Settle which one is right before you publish.</span><button class="mini" data-act="recovery" data-id="onedrive-made-a-copy-of-a-draft-peoplejson-or-a-step-type">What to do</button></div>';
    if (p.clashes.length) h += '<div class="notice bad"><span>Two people published version ' + p.clashes.join(', ') + ' at the same time. Neither is used until one is removed from <code>publications/' + esc(p.id) + '</code>. Publish again to make a clean next version.</span></div>';
    p.broken.forEach(function (b) { h += '<div class="notice warn"><span>' + esc(b.folder) + ': ' + esc(b.why) + '</span></div>'; });
    /* One page: the checklist in the middle, edited in place; how runs go opens on its own with a way back. */
    if (V.tabOf(ctx) === 'insights') return h + '<div class="row"><button class="mini" data-act="ptab" data-id="overview">' + I('back') + 'Back to the checklist</button></div>' + (insights(ctx, p) || '<section class="panel"><p class="small">No runs yet. This fills in after the first run.</p></section>');
    h += '<div class="pgrid"><div class="stack">';
    if (p.draft && p.draftChanged) {
      var c = M.check(M.parse(p.draft.md), { people: ctx.data.people, types: (ctx.data.stepTypes || {}).types, workflows: (ctx.data.jira || {}).workflows, processes: ctx.processes().filter(function (x) { return x.latest; }).map(function (x) { return x.id; }) });
      h += '<section class="panel"><div class="row between"><h2 style="margin:0">Draft · ' + esc(p.draft.file) + '</h2><span class="small">' + (p.typesChanged && p.typesChanged.length ? 'Step type ' + p.typesChanged.join(', ') + ' changed since v' + pub.info.version + '; publish to use it' : p.draftChanged ? 'Has changes not yet published' : 'Same as the published version') + '</span></div>' + checkList(c);
      if (p.draftChanged) {
        h += '<div class="row" style="margin-top:12px"><label class="field" style="flex:1;min-width:240px" for="change-note">What changed (one line, required)<input id="change-note" maxlength="200" placeholder="e.g. Require the full test gate after the rebase"></label>' +
          '<button class="btn go" data-act="publish" data-id="' + esc(p.id) + '"' + (c.blockers.length || !st.me ? ' disabled' : '') + '>Publish v' + PF.publish.nextVersion(p.taken || p.all.map(function (x) { return x.info; })) + '</button></div>' +
          '<p class="small">Anyone can publish. It\'s logged with your name, the time and the change note, and runs already started keep their version.</p>';
        if (pub) h += '<details style="margin-top:8px"><summary class="small" style="cursor:pointer">Compare the draft with v' + pub.info.version + '</summary>' + diffHtml(PF.publish.diff(pub.md, p.draft.md)) + '</details>';
      }
      h += '</section>';
    }
    h += V.checklistPanel(ctx, p);
    h += '</div><aside class="stack">';
    h += fixesPanel(ctx, p) + readyPanel(ctx, p, pub) + skillsPanel(ctx, p);
    /* Versions: one line each; the change note shows in full on hover and in Changes. */
    h += '<section class="panel" aria-labelledby="ver-h"><h2 id="ver-h">Versions</h2><ul class="vlist compact">' + (p.all.map(function (v, i) {
      var older = p.all[i + 1];
      return '<li><b>v' + v.info.version + '</b><span><span class="clip" title="' + esc(v.info.changes) + '">' + esc(v.info.changes) + '</span><span class="small">' + esc(U.day(v.info.publishedAt)) + '</span></span>' +
        '<span class="row">' + (older ? '<button class="mini" data-act="diff" data-id="' + esc(v.folder) + '" aria-expanded="' + (st.diffOf === v.folder) + '">Changes</button>' : '') + '<button class="mini" data-act="view-version" data-id="' + esc(v.folder) + '" aria-pressed="' + (st.mapVer === v.folder) + '">View</button></span></li>' +
        (st.diffOf === v.folder && older ? '<li style="display:block">' + diffHtml(PF.publish.diff(older.md, v.md)) + '</li>' : '');
    }).join('') || '<li class="small">Not published yet. Edit the checklist, then publish it.</li>') + '</ul></section>';
    var runs = ctx.data.runs.filter(function (r) { return r.process === p.id; }).sort(function (a, b) { return a.created < b.created ? 1 : -1; });
    h += '<section class="panel" aria-labelledby="pr-h"><h2 id="pr-h">Recent runs</h2>' + (runs.length ? '<ul class="plist">' + runs.slice(0, 5).map(function (r) {
      var hl = R.headline(r, R.mapOf(r));
      return '<li><button data-act="open-run" data-id="' + esc(runKey(r)) + '"><span class="t">' + esc(r.title) + '</span><span class="pill ' + hl.s + '">' + esc(r.ended ? r.ended.outcome : 'running') + '</span><span class="small">' + esc(U.day(r.created)) + ' · v' + esc(r.version) + '</span></button></li>';
    }).join('') + '</ul>' + (runs.length > 5 ? '<button class="link" data-act="nav" data-id="runs">All ' + runs.length + ' runs</button>' : '') : '<p class="small">No runs yet. Start one with <b>Start a run</b>.</p>') + '</section></aside></div>';
    return h;
  }
  function diffHtml(rows) {
    var changed = rows.some(function (r) { return r.op !== ' '; });
    if (!changed) return '<p class="small">No differences.</p>';
    return '<div class="diff">' + rows.map(function (r) { return r.op === '+' ? '<span class="add">+ ' + esc(r.text) + '</span>' : r.op === '-' ? '<span class="del">- ' + esc(r.text) + '</span>' : '<span>  ' + esc(r.text) + '</span>\n'; }).join('') + '</div>';
  }

  /* The exact publication a person switched this plan to, if it was in this folder, on this plan, as it reads now. */
  function planChoice(ctx, plan) {
    var c = ctx.state.planPick;
    return c && plan && c.plan === plan.id && c.hash === plan._hash && c.key === ctx.fsKey ? c.folder : null;
  }
  /* ---------- start a run, or plan one ---------- */
  /* The same form starts a run (from scratch or from a plan) or, with state.planning, saves a plan for later. */
  function start(ctx) {
    var st = ctx.state, p = ctx.processes().filter(function (x) { return x.id === st.processId; })[0];
    var planning = st.planning && st.planning.process === st.processId ? st.planning : null;
    var plan = !planning && st.planId ? ctx.data.plans.filter(function (x) { return x.id === st.planId; })[0] : null;
    if (!p || !p.latest) return notices(ctx) + '<div class="panel">There\'s no published version of this process to run. <button class="mini" data-act="home">Back</button></div>';
    /* A plan starts on the version it was planned on, or the exact one the person switched to; see PF.publish.forPlan. */
    var chosen = plan ? planChoice(ctx, plan) : null, pick = plan ? PF.publish.forPlan(p, plan.version, chosen) : { pub: p.latest };
    var pub = pick.pub, latest = p.latest, meta = pub.map.meta, people = ctx.data.people.filter(function (x) { return !x.inactive; }), pre = planning || plan || {};
    var defTitle = plan ? plan.title : planning ? planning.title || meta.title : meta.title + ' · ' + U.day(new Date().toISOString());
    var h = notices(ctx) + '<div class="runhead"><div><div class="eyebrow">' + esc(meta.title) + ' · v' + pub.info.version + (plan ? ' · planned by ' + esc(plan.by ? nameOf(ctx, plan.by) : 'an AI assistant') : '') + '</div><h1>' + (planning ? 'Plan a run' : 'Start a run') + '</h1>' + (plan && plan.note ? '<div class="small">' + esc(plan.note) + '</div>' : '') + '</div></div>';
    if (plan && plan._conflicting) h += '<div class="notice bad" role="alert"><span><b>Two decisions on this plan disagree</b>: one accepted it and one declined it. Someone may have started it already; check Runs before you start it again.</span></div>';
    if (plan && pick.older) {
      h += '<div class="notice warn"><span>' + (pick.chosen ? 'You switched this plan to v' : 'This plan was made for v') + pub.info.version + '. v' + latest.info.version + ' is now published.</span><span class="row"><button class="mini" type="button" data-act="plan-diff" aria-expanded="' + !!st.planDiff + '">See what changed</button><button class="btn" type="button" data-act="plan-latest" data-id="' + esc(plan.id) + '">Switch to v' + latest.info.version + '</button></span></div>';
      if (st.planDiff) h += '<section class="panel" aria-label="Changes from v' + pub.info.version + ' to v' + latest.info.version + '">' + diffHtml(PF.publish.diff(pub.md, latest.md)) + '</section>';
    } else if (plan && pick.missing) {
      /* Say why, when the version is in the folder but can't be used here (still syncing, damaged, or too new for this copy). */
      var gone = !chosen && (p.broken || []).filter(function (b) { return PF.publish.versionOf(b.folder) === +plan.version; })[0];
      h += '<div class="notice warn" role="status"><span>' + (chosen ? 'The version you switched to' : 'This plan was made for v' + esc(plan.version) + ', which') + (gone ? ' can\'t be used here: ' + esc(gone.why) : ' can\'t be used anymore.') + ' It starts on v' + latest.info.version + '. Check the roles and details still make sense.</span></div>';
    }
    else if (pick.chosen) h += '<div class="notice" role="status"><span>Switched to v' + pub.info.version + '. Check the roles and details still make sense.</span></div>';
    var formId = planning ? 'plan-form' : 'start-form', scope = planning ? 'plan:' + p.id + ':' + (planning.from || '') : 'start:' + p.id + ':' + (plan ? plan.id : '');
    h += '<form class="panel stack" id="' + formId + '" data-scope="' + esc(scope) + '" data-process="' + esc(p.id) + '" data-folder="' + esc(pub.info.folder) + '"' + (plan ? ' data-plan-hash="' + esc(plan._hash) + '" data-plan-conflict="' + (plan._conflicting ? '1' : '') + '"' : '') + '><div class="grid2"><label class="field" for="run-title">Run name<input id="run-title" maxlength="100" value="' + esc(defTitle) + '"></label>';
    /* A detail a step produces during the run (sets:) isn't asked for here; the form says which step fills it in. */
    var setBy = M.setBy(pub.map), given = pre.details && typeof pre.details === 'object' ? pre.details : {};
    var later = meta.context.filter(function (f) { return Object.prototype.hasOwnProperty.call(setBy, f) && !(plan && given[f]); });
    meta.context.filter(function (f) { return later.indexOf(f) < 0; }).forEach(function (f) { h += '<label class="field" for="detail-' + esc(f) + '">' + esc(f) + '<input id="detail-' + esc(f) + '" data-detail="' + esc(f) + '" maxlength="120" value="' + esc(typeof given[f] === 'string' ? given[f] : '') + '"></label>'; });
    if (later.length) h += '<p class="small" style="grid-column:1/-1">' + later.map(function (f) { return '<b>' + esc(f) + '</b> is filled in by "' + esc(setBy[f][0].text) + '"'; }).join('; ') + '.</p>';
    if (planning) {
      var err = st.fieldErr && st.fieldErr.id === 'plan-when';
      h += '<p class="small" style="grid-column:1/-1">Details can stay blank until the run starts.</p>' +
        '<label class="field" for="plan-when">When (optional)<input type="datetime-local" id="plan-when" value="' + esc(planning.when || '') + '"' + (err ? ' aria-invalid="true" aria-describedby="ferr-plan-when"' : '') + '></label>' +
        '<label class="field" for="plan-note">Note (optional)<input id="plan-note" maxlength="300" value="' + esc(planning.note || '') + '"></label>' +
        (err ? '<p class="ferr" id="ferr-plan-when" role="alert" style="grid-column:1/-1">' + esc(st.fieldErr.msg) + '</p>' : '');
    }
    h += '</div>';
    /* On my own or with others: the map suggests which (runs: solo), the person decides. */
    var mode = st.startMode[p.id] || (meta.runs === 'solo' || !meta.roles.length ? 'solo' : 'team'), soloMap = mode === 'solo';
    h += '<input type="hidden" id="start-mode" value="' + mode + '"><div class="seg" role="radiogroup" aria-label="Who is running it"><button type="button" role="radio" aria-checked="' + soloMap + '" data-act="start-mode" data-id="solo" data-process="' + esc(p.id) + '">On my own</button><button type="button" role="radio" aria-checked="' + !soloMap + '" data-act="start-mode" data-id="team" data-process="' + esc(p.id) + '">With others</button></div>';
    if (soloMap) h += '<p class="small">Every role is yours. If someone joins later, add them from the run.</p>';
    if (meta.roles.length && !soloMap) {
      h += '<div class="row" style="margin-top:6px"><h3 style="margin:0">Who\'s doing what</h3>' + (st.me ? '<button class="mini" type="button" data-act="just-me">Just me</button>' : '') + '</div><div class="grid2">';
      meta.roles.forEach(function (role) {
        var chosen = pre.roles && typeof pre.roles === 'object' && typeof pre.roles[role] === 'string' ? pre.roles[role] : '', sug = ctx.suggestRole(p.id, role);
        h += '<label class="field" for="role-' + esc(role) + '">' + esc(role) + (sug ? ' <span class="small">· suggestion: ' + esc(nameOf(ctx, sug.person)) + ' (' + esc(sug.why) + ')</span>' : '') + '<select id="role-' + esc(role) + '" data-role="' + esc(role) + '"><option value="">Nobody yet</option>' +
          people.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === (chosen || (sug && sug.person)) ? ' selected' : '') + '>' + esc(PF.people.label(x, people)) + '</option>'; }).join('') + '</select></label>';
      });
      h += '</div><p class="small">Suggestions rotate roles to whoever did them least recently, so everyone gets the experience. Change anything.</p>';
    }
    if (planning) return h + '<div class="row"><button class="btn go" type="submit" id="start-submit"' + (st.me ? '' : ' disabled') + '>Save the plan</button><span class="small">It waits under Runs until someone starts it.</span><button class="mini" type="button" data-act="cancel-plan">Cancel</button></div></form>';
    h += '<div class="row"><button class="btn go" type="submit" id="start-submit"' + (st.me ? '' : ' disabled') + '>' + I('play') + 'Start the run</button><span class="small">' + (soloMap ? 'It\'s your run. You can bring someone in at any time.' : 'You\'ll be the recorder. You can hand recording to someone else at any time.') + '</span>' +
      (plan ? '<button class="mini" type="button" data-act="decline-plan" data-id="' + esc(plan.id) + '">Decline this plan</button>' : '') + '</div></form>';
    return h;
  }

  V.process = process; V.start = start; V.teamSetup = teamSetup; V.checkList = checkList; V.mapPreview = mapPreview; V.fixesOf = fixesOf; V.corrBase = corrBase; V.corrApply = corrApply; V.briefBox = briefBox; V.diffHtml = diffHtml; V.planChoice = planChoice;
})();
