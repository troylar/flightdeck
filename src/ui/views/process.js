/* A process page, and the form that starts a run. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, R = PF.run, M = PF.map, T = PF.types, I = PF.icons.icon, esc = U.esc;
  var ferr = function (s, id) { return K.ferr(s, id); };
  var person = K.person, nameOf = K.nameOf, avatar = K.avatar, notices = K.notices, ago = K.ago, runKey = K.runKey, freshness = K.freshness;
  /* ---------- process page ---------- */
  /* anchor, when given, ids each phase's heading so the flight plan can bring a phase into view. fixes, when given, counts open
     suggested fixes per step ID (and "phase:<id>"), marked so whoever edits the draft sees them. */
  /* hl: what the builder has selected ({ line } of a step, or { phase } index), marked so the preview can show it. */
  function mapPreview(map, types, skills, anchor, fixes, hl) {
    var fixBadge = function (k) { var n = fixes && fixes[k]; return n ? ' <span class="badge b-warn">' + n + ' suggested fix' + (n === 1 ? '' : 'es') + '</span>' : ''; };
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
    if (!p.skills.length) return h + '<p class="small">None yet. Once a version is signed off below, copy its brief for your LLM.</p></section>';
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
      h += '<p class="small"><b>Yes.</b> v' + pub.info.version + ' was signed off by ' + esc(nameOf(ctx, signs[0].by)) + ' ' + esc(U.day(signs[0].at)) + '.</p><button class="btn go" data-act="copy-brief" data-id="create:' + esc(p.id) + '">' + I('copy') + 'Copy the brief for your LLM</button>' + briefBox(st, 'create:' + p.id);
    } else if (!ready.enough) {
      h += '<p class="small"><b>Not yet.</b> ' + ready.clean + ' of ' + ready.needed + ' clean runs of v' + pub.info.version + '.</p>';
    } else if (st.me && (!owner || owner === st.me)) {
      h += '<p class="small"><b>Almost.</b> ' + ready.clean + ' clean runs of v' + pub.info.version + '. As its owner, you sign it off.</p>' + (st.pick && st.pick.kind === 'signoff'
        ? '<div class="row" data-scope="signoff"><label class="sr" for="pick-input">Note for the sign-off</label><input id="pick-input" maxlength="300" placeholder="Optional note" data-enter="signoff" data-id="' + esc(p.id) + '"><button class="btn go" data-act="signoff" data-id="' + esc(p.id) + '">Sign off</button><button class="mini" data-act="unpick">Cancel</button></div>'
        : '<button class="btn go" data-act="pick" data-kind="signoff" data-id="' + esc(p.id) + '">Sign off v' + pub.info.version + '</button>');
    } else h += '<p class="small"><b>Almost.</b> ' + ready.clean + ' clean runs. ' + esc(nameOf(ctx, owner)) + ', the owner, signs it off.</p>';
    var devOpen = st.disc && st.disc['dev:' + p.id] === true;
    if (ready.deviations.length) h += '<details' + (devOpen ? ' open' : '') + ' data-disc="dev:' + esc(p.id) + '"><summary class="small" id="sum-dev">Why some runs don\'t count (' + ready.deviations.length + ')</summary><ul class="small">' + ready.deviations.slice(0, 20).map(function (d) { return '<li>' + esc(d.run) + ': ' + (d.text ? '"' + esc(d.text) + '" ' : '') + esc(d.kind) + (d.note ? ': ' + esc(d.note) : '') + '</li>'; }).join('') + '</ul></details>';
    return h + '</section>';
  }

  /* ---------- suggested fixes (docs/design.md section 19) ---------- */
  /* Every suggestion on a process, with where it stands. The app memoizes this per folder read; views tests compute it. */
  function fixesOf(ctx, p) {
    if (ctx.fixes) return ctx.fixes(p.id);
    return PF.fixes.withStatus(PF.fixes.collect(ctx.data.runs, p.id), ctx.data.fixDecisions, PF.fixes.creditable(p));
  }
  var FIX_PILL = { open: 'open', accepted: 'ready', fixed: 'passed', declined: 'locked' };
  function fixesPanel(ctx, p) {
    var st = ctx.state, all = fixesOf(ctx, p);
    if (!all.length) return '';
    var open = all.filter(function (s) { return s.status === 'open'; }), todo = all.filter(function (s) { return s.status === 'open' || s.status === 'accepted'; });
    var showAll = st.fixFilter === 'all', list = showAll ? all : open, map = p.latest ? p.latest.map : p.draft ? M.parse(p.draft.md) : null;
    var h = '<section class="panel" aria-labelledby="fx-h"><h2 id="fx-h" tabindex="-1">' + I('edit') + 'Suggested fixes · ' + open.length + ' open</h2>' +
      '<div class="seg" role="group" aria-label="Show">' + [['open', 'Open'], ['all', 'All']].map(function (x) { return '<button type="button" data-act="fix-filter" data-id="' + x[0] + '" aria-pressed="' + ((x[0] === 'all') === showAll) + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var unread = (ctx.data.fixUnread || []).filter(function (u) { return u.process === p.id; });
    if (unread.length) h += '<div class="notice bad"><span>Couldn\'t read ' + unread.length + ' decision file' + (unread.length === 1 ? '' : 's') + ' in <code>suggestions/' + esc(p.id) + '</code>' + (unread.every(function (u) { return u.kept; }) ? '. Showing what they said last time.' : '. Some suggestions may show the wrong status until it syncs.') + '</span></div>';
    if (!list.length) h += '<p class="small">No open suggestions.</p>';
    /* Grouped by the step or phase they're about, in checklist order; anything no longer in the checklist goes last. */
    var order = [], groups = Object.create(null);
    if (map) map.phases.forEach(function (ph) { order.push('phase:' + ph.id); ph.steps.forEach(function (x) { order.push(x.id); }); });
    list.forEach(function (s) { var k = s.target.step || 'phase:' + s.target.phase; if (!groups[k]) { groups[k] = []; if (order.indexOf(k) < 0) order.push(k); } groups[k].push(s); });
    order.filter(function (k) { return groups[k]; }).forEach(function (k) {
      var x = map && k.indexOf('phase:') !== 0 && M.findStep(map, k), ph = map && k.indexOf('phase:') === 0 && map.phases.filter(function (q) { return 'phase:' + q.id === k; })[0];
      h += '<p class="fixgroup">' + (x ? U.mdInline(x.step.text) : ph ? 'Phase: ' + esc(ph.title) : esc(k.replace(/^phase:/, 'Phase ')) + ' <span class="small">(not in the current version)</span>') + '</p><ul class="fixlist">' + groups[k].map(function (s) { return fixItem(ctx, p, s); }).join('') + '</ul>';
    });
    if (todo.length) h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="copy-fix-brief" data-id="' + esc(p.id) + '">' + I('copy') + 'Copy fix brief</button></div>' + briefBox(st, 'fixes:' + p.id);
    return h + '</section>';
  }
  function fixItem(ctx, p, s) {
    var st = ctx.state, d = s.decision, F = PF.fixes, declining = st.pick && st.pick.kind === 'fix-decline' && st.pick.id === s.id;
    var h = '<li data-scope="fix:' + esc(s.id) + '"><div class="row"><span class="badge b-plan">' + esc(F.kindLabel(s.kind)) + '</span><span class="pill ' + FIX_PILL[s.status] + '">' + esc(F.label(s)) + '</span>' +
      (s.kind === 'missing' ? '<span class="small">' + (s.target.where === 'after' && s.target.step ? 'after this step' : 'at the end of the phase') + '</span>' : '') + '</div>' +
      '<div>' + esc(s.text) + '</div>' + (s.target.shot ? '<div class="small">Screenshot <code>' + esc(s.target.shot) + '</code></div>' : '') +
      (s.files.length ? '<div class="thumbs">' + s.files.map(function (f, i) { return '<button class="thumb" data-act="zoom-fix" data-id="' + esc(s.id) + '" data-i="' + i + '" aria-label="Expand the attached screenshot">' + ctx.img(f, 'Attachment') + '</button>'; }).join('') + '</div>' : '') +
      '<div class="small">' + esc(nameOf(ctx, s.by)) + ' · <button class="linkish" data-act="open-run" data-id="' + esc(s.process + '/' + s.run) + '">' + esc(s.runTitle) + '</button> · v' + esc(s.version) + '</div>';
    if (d) h += '<div class="small">' + esc(d.status === 'declined' ? 'Declined' : d.status === 'accepted' ? 'Accepted' : 'Reopened') + ' by ' + esc(nameOf(ctx, d.by)) + ' ' + esc(U.day(d.at)) + (d.reason ? ': ' + esc(d.reason) : '') + '</div>' +
      (s.tie ? '<div class="small">Two people decided at once; the latest shown here.</div>' : '');
    if (!st.me) return h + '</li>';
    if (declining) return h + '<div class="row">' + ferr(st, 'fix-decline') + '<label class="sr" for="pick-input">Why decline it?</label><input id="pick-input" maxlength="300" placeholder="Why decline it?" data-enter="fix-decline" data-id="' + esc(s.id) + '"' + (st.fieldErr && st.fieldErr.id === 'fix-decline' ? ' aria-invalid="true" aria-describedby="ferr-fix-decline"' : '') + '><button class="btn" data-act="fix-decline" data-id="' + esc(s.id) + '">Decline</button><button class="mini" data-act="unpick">Cancel</button></div></li>';
    if (s.status === 'open') h += '<div class="row"><button class="mini" data-act="fix-accept" data-id="' + esc(s.id) + '">Accept into the draft</button><button class="mini" data-act="pick" data-kind="fix-decline" data-id="' + esc(s.id) + '">Decline</button></div>';
    else h += '<div class="row"><button class="mini" data-act="fix-reopen" data-id="' + esc(s.id) + '">Reopen</button></div>';
    return h + '</li>';
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
          '<button class="btn go" data-act="publish" data-id="' + esc(p.id) + '"' + (c.blockers.length || !st.me ? ' disabled' : '') + '>Publish v' + PF.publish.nextVersion(p.all.map(function (x) { return x.info; })) + '</button></div>' +
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
    } else if (plan && pick.missing) h += '<div class="notice warn" role="status"><span>' + (chosen ? 'The version you switched to' : 'This plan was made for v' + esc(plan.version) + ', which') + ' can\'t be used anymore. It starts on v' + latest.info.version + '. Check the roles and details still make sense.</span></div>';
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
          people.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === (chosen || (sug && sug.person)) ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></label>';
      });
      h += '</div><p class="small">Suggestions rotate roles to whoever did them least recently, so everyone gets the experience. Change anything.</p>';
    }
    if (planning) return h + '<div class="row"><button class="btn go" type="submit" id="start-submit"' + (st.me ? '' : ' disabled') + '>Save the plan</button><span class="small">It waits under Runs until someone starts it.</span><button class="mini" type="button" data-act="cancel-plan">Cancel</button></div></form>';
    h += '<div class="row"><button class="btn go" type="submit" id="start-submit"' + (st.me ? '' : ' disabled') + '>' + I('play') + 'Start the run</button><span class="small">' + (soloMap ? 'It\'s your run. You can bring someone in at any time.' : 'You\'ll be the recorder. You can hand recording to someone else at any time.') + '</span>' +
      (plan ? '<button class="mini" type="button" data-act="decline-plan" data-id="' + esc(plan.id) + '">Decline this plan</button>' : '') + '</div></form>';
    return h;
  }

  V.process = process; V.start = start; V.teamSetup = teamSetup; V.checkList = checkList; V.mapPreview = mapPreview; V.fixesOf = fixesOf; V.briefBox = briefBox; V.diffHtml = diffHtml; V.planChoice = planChoice;
})();
