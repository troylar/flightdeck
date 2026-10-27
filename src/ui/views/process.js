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
      var meta = (s.must ? K.mustMark() : '') + (by[s.id] ? '<span class="pv-skill">' + I('spark') + esc(by[s.id].join(', ')) + '</span>' : '') + (s.planned ? '<span class="badge b-plan">Automation planned</span>' : '') +
        (s.roles.length ? '<span class="pv-role">@' + esc(s.roles.join(' @')) + '</span>' : '') + fixBadge(s.id), cond = K.whenWords(s);
      /* The checklist panel gives each step an anchor, so the flight plan (go() with a step) can open it there. */
      return '<li' + (hs ? ' class="pv-sel" id="pv-sel" aria-current="true"' : anchor ? ' id="cl-st-' + esc(s.id) + '" tabindex="-1"' : '') + '>' + (t ? I(t.icon, T.nameOf(t)) : '<span class="ic"></span>') + '<div class="pv-body"><span class="pv-copy">' + K.stepHtml(s, null) + '</span>' + (cond ? '<span class="pv-when">' + cond + '</span>' : '') + (meta ? '<span class="pv-meta">' + meta + '</span>' : '') + '</div></li>';
    };
    /* Lanes stay lanes: the steps before any lane, then each lane as a labeled group under "Do all lanes". */
    return (whole.length ? '<p class="small">' + I('spark') + ' The whole checklist: ' + esc(whole.join(', ')) + '</p>' : '') + map.phases.map(function (p, pi) {
      var hp = hl && hl.phase === pi, lead = p.steps.filter(function (s) { return !s.track; });
      var lanes = p.tracks.map(function (t) { return { t: t, steps: p.steps.filter(function (s) { return s.track === t.id && t.id; }) }; });
      var body = lead.length || !lanes.length ? '<ul>' + lead.map(step).join('') + '</ul>' : '';
      if (lanes.length) body += '<div class="pv-lanes"><p class="pv-lanes-h">Do all lanes</p>' + lanes.map(function (l) {
        return '<div class="pv-lane"><p class="pv-lane-h">' + esc(l.t.title || 'Untitled lane') + (l.t.roles.length ? ' <span class="pv-role">@' + esc(l.t.roles.join(' @')) + '</span>' : '') + '</p><ul>' + l.steps.map(step).join('') + '</ul></div>';
      }).join('') + '</div>';
      return '<div class="ph' + (hp ? ' pv-sel" id="pv-sel' : '') + '"><h3' + (anchor ? ' id="' + anchor + pi + '" tabindex="-1"' : '') + '>' + esc(p.title) + (p.mode ? ' <span class="cat mode">' + esc(K.modeWord(p.mode)) + '</span>' : '') + fixBadge('phase:' + p.id) + '</h3>' + (p.when ? '<p class="pv-when">' + K.whenWords(p) + '</p>' : '') + body +
        '<div class="g">' + I('gate') + '<span class="pv-gate-copy">Gate: ' + esc(p.gate.title) + (p.gate.approves ? ' · approves ' + K.detailWords(U.mdInline(p.gate.approves)) : '') + '</span></div></div>';
    }).join('');
  }
  function checkList(c) {
    var rows = c.blockers.map(function (b) { return '<li><span class="lvl bad">Fix</span><span>' + esc(b) + '</span></li>'; })
      .concat(c.suggestions.map(function (s) { return '<li><span class="lvl tip">Tip</span><span>' + esc(s) + '</span></li>'; }));
    if (!rows.length) rows.push('<li><span class="lvl ok">Good</span><span>Ready to publish.</span></li>');
    return '<ul class="checks">' + rows.join('') + '</ul>';
  }
  /* How runs of this process have gone, one version at a time (docs/design.md section 23; views/insights.js draws it). */
  function insights(ctx, p) { return V.insightsPage(ctx, p); }
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
  /* bare: inside the Skills fold, as a heading and its content rather than a panel of its own. */
  function skillsPanel(ctx, p, bare) {
    var h = bare ? '<h3>Skills</h3>' : '<section class="panel" aria-labelledby="sk-h"><h2 id="sk-h">' + I('spark') + 'Skills</h2>', end = bare ? '' : '</section>';
    if (!p.skills.length) return h + '<p class="small">None yet. Once a version is signed off, copy its brief for your AI assistant.</p>' + end;
    return h + '<ul class="plist">' + p.skills.map(function (x) {
      var s = x.skill, pill = SKILL_PILL[x.status.s] || SKILL_PILL.missing;
      return '<li><button data-act="open-skill" data-id="' + esc(s.file || s.name) + '"><span class="t">' + esc(s.name) + '</span><span class="pill ' + pill[0] + '">' + pill[1] + '</span></button></li>';
    }).join('') + '</ul>' + end;
  }
  /* For someone who doesn't look after the checklist: Ready for a skill? and Skills as one closed line that says what they hold. */
  function skillsFold(ctx, p, pub) {
    var st = ctx.state, n = p.skills.length, stale = p.staleSkills || 0, line = 'Skills · ';
    if (n) line += n + (stale ? ' · ' + stale + ' need' + (stale === 1 ? 's' : '') + ' attention' : '');
    else if (!pub) line += 'none yet';
    else if (PF.skills.signoffs(ctx.data.validations, pub).length) line += 'none yet (v' + pub.info.version + ' signed off)';
    else if (PF.skills.signHold(ctx.data, pub)) line += PF.skills.signHold(ctx.data, pub).kind === 'newer' ? 'none yet (v' + pub.info.version + ' signed off with a newer Flightdeck)' : 'none yet (can\'t tell whether v' + pub.info.version + ' is signed off)';
    else { var ready = PF.skills.readiness(ctx.countedRuns ? ctx.countedRuns(pub.map.meta.process) : ctx.data.runs, pub, null); line += 'none yet (' + ready.clean + ' of ' + ready.needed + ' clean runs)'; }
    /* Open whenever it holds a warning: a sign-off file of this process that can't be read. */
    var warn = signUnread(ctx, p).length > 0;
    return '<details class="panel fold" data-disc="sk:' + esc(p.id) + '"' + ((st.disc || {})['sk:' + p.id] || warn ? ' open' : '') + '><summary><h2 id="sk-h">' + I('spark') + esc(line) + '</h2></summary>' +
      readyPanel(ctx, p, pub, true) + skillsPanel(ctx, p, true) + '</details>';
  }
  /* The last brief copied, shown so it can be read or selected by hand if the clipboard isn't available. */
  function briefBox(st, key) {
    if (!st.brief || st.brief.key !== key) return '';
    var open = !st.disc || !Object.prototype.hasOwnProperty.call(st.disc, 'brief:' + key) || st.disc['brief:' + key];
    return '<details' + (open ? ' open' : '') + ' class="brief" data-disc="brief:' + esc(key) + '"><summary class="small" id="sum-brief"><span id="copy-msg" role="status"></span> The brief</summary><pre id="brief-pre" class="source" tabindex="0">' + esc(st.brief.text) + '</pre></details>';
  }
  /* This process's sign-off files that couldn't be read, kept ones too (named on its page, as Folder health names them). */
  function signUnread(ctx, p) {
    return (ctx.data.valUnread || []).filter(function (u) { var proc = PF.skills.signFileProcess(u._file); return !u.ignored && (proc ? proc === p.id : u.claimed && u.process === p.id); });
  }
  function signUnreadNotice(ctx, p) {
    var u = signUnread(ctx, p);
    if (!u.length) return '';
    return '<div class="notice warn" role="status"><span>Couldn\'t read ' + (u.length === 1 ? 'a sign-off file' : u.length + ' sign-off files') + ': ' + u.slice(0, 3).map(function (x) { return '<code>' + esc(x.path) + '</code>'; }).join(', ') + (u.length > 3 ? ' and ' + (u.length - 3) + ' more' : '') +
      (u.every(function (x) { return x.kept; }) ? '. Showing what ' + (u.length === 1 ? 'it' : 'they') + ' said last time.' : '. It may still be arriving; if it stays this way, restore it from a backup or delete it.') + '</span></div>';
  }
  /* Clean test runs counted for a version made from a stage (2.1 slice 6), said only when there are some. */
  function testWords(ready) { return ready.tests ? ' (' + ready.tests + (ready.tests === 1 ? ' is a test run' : ' are test runs') + ' from while it was staged)' : ''; }
  /* Is the current version ready to become a skill? One line of status and the one thing to do next. */
  function readyPanel(ctx, p, pub, bare) {
    if (!pub) return '';
    var st = ctx.state, ready = PF.skills.readiness(ctx.countedRuns ? ctx.countedRuns(pub.map.meta.process) : ctx.data.runs, pub, null), signs = PF.skills.signoffs(ctx.data.validations, pub), owner = pub.map.meta.owner;
    var h = bare ? '<h3>Ready for a skill?</h3>' : '<section class="panel" aria-labelledby="rd-h"><h2 id="rd-h">' + I('check') + 'Ready for a skill?</h2>';
    var hold = PF.skills.signHold(ctx.data, pub), unknown = PF.skills.signUnknown(ctx.data, pub);
    h += signUnreadNotice(ctx, p);
    if (signs.length) {
      h += '<p class="small"><b>Yes.</b> v' + pub.info.version + ' was signed off by ' + esc(nameOf(ctx, signs[0].by)) + (signs[0].as === 'backup' ? ', the backup owner,' : '') + (signs[0].stage ? ' while it was staged' : '') + ' ' + esc(U.day(signs[0].at)) + '.</p><button class="btn go" data-act="copy-brief" data-id="create:' + esc(p.id) + '">' + I('copy') + 'Copy the brief for your AI assistant</button>' + briefBox(st, 'create:' + p.id);
    } else if (unknown) {
      /* A sign-off that can't be read could be this version's: never "not signed off" (and no Sign off) until it reads. */
      if (hold.kind === 'newer') h += '<p class="small"><b>Signed off with a newer Flightdeck.</b> <code>' + esc(hold.path) + '</code> is a sign-off of v' + pub.info.version + ' this copy can\'t read. Update Flightdeck to see it.</p>';
      else h += '<p class="small"><b>Can\'t tell yet.</b> ' + esc(unknown) + ', so it isn\'t known whether v' + pub.info.version + ' was signed off. ' + ready.clean + ' of ' + ready.needed + ' clean runs' + testWords(ready) + '. ' +
        (hold.kind === 'failed' ? 'Try again once the folder can be read.' : 'It may still be arriving; if it stays this way, restore it from a backup or delete it.') + '</p>';
    } else if (!ready.enough) {
      h += '<p class="small"><b>Not yet.</b> ' + ready.clean + ' of ' + ready.needed + ' clean runs of v' + pub.info.version + testWords(ready) + '.</p>';
    } else if (PF.skills.signer(pub, ctx.data.people, st.me, !!(ctx.data.failed || {}).people)) {
      var asBackup = PF.skills.signer(pub, ctx.data.people, st.me, !!(ctx.data.failed || {}).people) === 'backup';
      h += '<p class="small"><b>Almost.</b> ' + ready.clean + ' clean runs of v' + pub.info.version + testWords(ready) + '. ' + (asBackup ? 'Its owner, ' + esc(nameOf(ctx, owner)) + ', is inactive or no longer on the team, so as its backup owner, you sign it off.' : 'As its owner, you sign it off.') + '</p>' + (st.pick && st.pick.kind === 'signoff'
        ? '<div class="row" data-scope="signoff"><label class="sr" for="pick-input">Note for the sign-off</label><input id="pick-input" maxlength="300" placeholder="Optional note" data-enter="signoff" data-id="' + esc(p.id) + '"><button class="btn go" data-act="signoff" data-id="' + esc(p.id) + '">Sign off</button><button class="mini" data-act="unpick">Cancel</button></div>'
        : '<button class="btn go" data-act="pick" data-kind="signoff" data-id="' + esc(p.id) + '">Sign off v' + pub.info.version + '</button>');
    } else h += '<p class="small"><b>Almost.</b> ' + ready.clean + ' clean runs' + testWords(ready) + '. ' + esc(nameOf(ctx, owner)) + ', the owner, signs it off' + (pub.map.meta.backup && pub.map.meta.backup !== owner ? ' (or ' + esc(nameOf(ctx, pub.map.meta.backup)) + ', the backup owner, while the owner is away)' : '') + '.</p>';
    /* Conditions (2.1), information only: steps that apply only sometimes and that no clean run has needed yet. */
    var un = ready.clean ? ready.unseen || [] : [];
    if (un.length) h += '<p class="small">Not yet seen in a clean run: ' + esc(un.slice(0, 5).map(function (x) { return K.stepPlain(x, null); }).join(', ')) + (un.length > 5 ? ' and ' + (un.length - 5) + ' more' : '') + '.</p>';
    var devOpen = st.disc && st.disc['dev:' + p.id] === true;
    if (ready.deviations.length) h += '<details' + (devOpen ? ' open' : '') + ' data-disc="dev:' + esc(p.id) + '"><summary class="small" id="sum-dev">Why some runs don\'t count (' + ready.deviations.length + ')</summary><ul class="small">' + ready.deviations.slice(0, 20).map(function (d) { return '<li>' + esc(d.run) + ': ' + (d.text ? '"' + esc(d.text) + '" ' : '') + esc(d.kind) + (d.note ? ': ' + esc(d.note) : '') + '</li>'; }).join('') + '</ul></details>';
    return h + (bare ? '' : '</section>');
  }

  /* ---------- corrections (docs/design.md section 19) ---------- */
  /* Every group of corrections on a process, with where it stands. The app memoizes this per folder read; views tests compute it. */
  function fixesOf(ctx, p) {
    return V.corrGroups(ctx, p.id);
  }
  /* Grouped by step in checklist order: each group is one proposed change, "Suggested in N runs" with the runs behind it,
     and two different changes to the same step are shown as alternatives. Anyone decides; declining needs a reason. */
  function fixesPanel(ctx, p) {
    var st = ctx.state, all = fixesOf(ctx, p), C = PF.corrections;
    if (!all.length) return '';
    var open = all.filter(function (g) { return g.status === 'open'; });
    var showAll = st.fixFilter === 'all', list = showAll ? all : open, map = p.latest ? p.latest.map : p.draft ? M.parse(p.draft.md) : null;
    var h = '<p class="small">Recorded during runs: what the checklist said, what it should say, and what happened. Review one to apply it to the draft, or mark it as applied once the draft has it.</p>' +
      '<div class="seg" role="group" aria-label="Show">' + [['open', 'Open'], ['all', 'All']].map(function (x) { return '<button type="button" data-act="corr-filter" data-id="' + x[0] + '" aria-pressed="' + ((x[0] === 'all') === showAll) + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var unread = (ctx.data.corrUnread || []).filter(function (u) { return u.process === p.id; });
    if (unread.length) h += '<div class="notice bad"><span>Couldn\'t read ' + unread.length + ' decision file' + (unread.length === 1 ? '' : 's') + ' in <code>corrections/' + esc(p.id) + '</code>' + (unread.every(function (u) { return u.kept; }) ? '. Showing what they said last time.' : '. Some corrections may show the wrong status until it syncs.') + '</span></div>';
    if (!list.length) h += '<p class="small">No open corrections.</p>';
    var order = [], groups = Object.create(null);
    if (map) map.phases.forEach(function (ph) { order.push('phase:' + ph.id); ph.steps.forEach(function (x) { order.push(x.id); }); if (ph.gate && !ph.gate.implicit) order.push('gate:' + ph.gate.id); });
    list.forEach(function (g) { var k = C.targetKey(g.target); if (!groups[k]) { groups[k] = []; if (order.indexOf(k) < 0) order.push(k); } groups[k].push(g); });
    order.filter(function (k) { return groups[k]; }).forEach(function (k) {
      var x = map && !/^(phase|gate):/.test(k) && M.findStep(map, k), ph = map && k.indexOf('phase:') === 0 && map.phases.filter(function (q) { return 'phase:' + q.id === k; })[0], gt = map && k.indexOf('gate:') === 0 && map.phases.filter(function (q) { return q.gate && 'gate:' + q.gate.id === k; })[0];
      var gs = groups[k], alts = gs.filter(function (g) { return g.status === 'open' && g.change.op !== 'describe'; }).length;
      h += '<h3 class="fixgroup">' + (x ? K.stepHtml(x.step, null) : ph ? 'Phase: ' + esc(ph.title) : gt ? 'Gate: ' + esc(gt.gate.title) : esc(C.targetName(gs[0])) + ' <span class="small">(not in the current version)</span>') + '</h3>' +
        (alts > 1 ? '<p class="small corr-alts"><b>' + (alts === 2 ? 'Two' : alts) + ' proposed changes.</b> Each can be decided on its own.</p>' : '') +
        '<ul class="fixlist">' + gs.map(function (g) { return groupItem(ctx, p, g); }).join('') + '</ul>';
    });
    if (open.length) h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="copy-corr-brief" data-id="' + esc(p.id) + '">' + I('copy') + 'Copy correction brief</button></div>' + briefBox(st, 'corrections:' + p.id);
    var head = '<h2 id="fx-h" tabindex="-1">' + I('edit') + 'Corrections · ' + open.length + ' open</h2>';
    /* Open for whoever looks after the checklist, and whenever it holds a warning; for everyone else, one closed line. */
    if (unread.length || K.keeps(ctx, p)) return '<section class="panel" aria-labelledby="fx-h">' + head + h + '</section>';
    return '<details class="panel fold" data-disc="fx:' + esc(p.id) + '"' + ((st.disc || {})['fx:' + p.id] ? ' open' : '') + '><summary>' + head + '<span class="fold-act">Review</span></summary>' + h + '</details>';
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
      return '<li>' + esc(nameOf(ctx, m.by)) + ' · ' + esc(U.day(m.at)) + ' · <button class="linkish" data-act="open-run" data-id="' + esc(m.process + '/' + m.run) + '">' + esc(m.runTitle) + '</button> · ' + (m.test ? 'test run, staged v' : 'v') + esc(m.version) + '</li>';
    }).join('') + '</ul></details>';
    if (d) h += '<div class="small">' + esc(d.addressed ? 'Marked as addressed differently' : { applied: 'Marked as applied', declined: 'Declined', open: 'Reopened', withdrawn: 'Withdrawn', legacy: 'Accepted before 1.13', included: 'Said v' + d.version + ' has it' }[d.status] || d.status) + ' by ' + esc(nameOf(ctx, d.by)) + ' ' + esc(U.day(d.at)) + (d.reason ? ': ' + esc(d.reason) : '') + '</div>';
    if (g.landed) h += '<div class="small">v' + esc(g.landed.version) + ' has it' + (g.landed.at ? ', published ' + esc(U.day(g.landed.at)) : '') + '.</div>';
    if (g.proofless) {
      var said = g.decision && g.decision.status === 'included' ? esc(nameOf(ctx, g.decision.by)) + ' said v' + esc(g.decision.version) + ' has it, but that version doesn\'t make this change. ' : '';
      h += '<div class="small corr-proof">' + (said || (g.old ? 'Applied before 1.16. ' : 'A published version has this change but doesn\'t list it. ')) + 'Flightdeck can\'t confirm which version has it.</div>' + includedButtons(ctx, p, g);
    }
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

  /* "It's in vN" for an item applied before 1.16: the published versions after the correction's own, newest first. */
  function includedButtons(ctx, p, g) {
    if (!ctx.state.me) return '';
    var own = Math.min.apply(null, g.members.map(function (c) { return c.version || 0; }));
    var vs = (p.all || []).filter(function (v) { return v.info.version > own && (p.clashes || []).indexOf(v.info.version) < 0; }).slice(0, 4);
    if (!vs.length) return '';
    return '<div class="row corr-in">' + vs.map(function (v) { return '<button class="mini" data-act="corr-included" data-id="' + esc(g.id) + '" data-folder="' + esc(v.info.folder) + '">It\'s in v' + v.info.version + '</button>'; }).join('') + '</div>';
  }
  /* What publishing this draft includes: applied corrections whose change it makes, and the applied ones it leaves out because
     the draft no longer matches what was applied. */
  function publishCorrections(ctx, p) {
    var C = PF.corrections, fp = C.forPublish(p.draft.md, fixesOf(ctx, p));
    if (!fp.groups.length && !fp.left.length) return '';
    var name = function (g) { return '"' + esc(C.targetName(g)) + '"'; };
    return '<p class="small corr-pub" role="status"><b>Included in this version: ' + fp.groups.length + ' correction' + (fp.groups.length === 1 ? '' : 's') + '.</b>' +
      (fp.left.length ? ' Left out, changed since applied: ' + fp.left.map(name).join(', ') + '.' : '') + '</p>';
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
    var h = bar('Apply to the draft: ' + (stepName ? '“' + esc(stepName) + '”' : (g.target.step ? 'step ' : '') + esc(C.targetName(g))));
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

  /* A draft that uses something new in 2.0 publishes a version older copies can't run: say which, and what that means. */
  function publishNeeds(ctx, p) {
    var map = M.parse(p.draft.md), n = PF.publish.needs(map, PF.types.freeze(M.usedTypes(map), (ctx.data.stepTypes || {}).types)); if (!n) return '';
    var list = n.names.length === 1 ? n.names[0] : n.names.slice(0, -1).join(', ') + ' and ' + n.names[n.names.length - 1];
    /* The release that first runs all of it (PF.envelope.minimum), and the last one that can't. */
    var need = n.needs || '2.0', nm = need.split('.'), before = +nm[1] > 0 ? nm[0] + '.' + (+nm[1] - 1) : '1.22';
    return '<p class="small pub-needs" role="note"><b>Needs Flightdeck ' + esc(need) + ':</b> ' + esc(list) + '. Teammates on Flightdeck ' + esc(before) + ' or earlier see this version but can\'t run it until they update. Leave ' + (n.names.length === 1 ? 'it' : 'these') + ' out if they need to run it now.</p>';
  }
  function process(ctx) {
    var st = ctx.state, p = ctx.processes().filter(function (x) { return x.id === st.processId; })[0];
    if (!p) {
      /* Its draft was removed while it had edits that aren't saved: keep them reachable, to copy or to save again. */
      var lost = st.editor && st.editor.text != null ? st.editor : null;
      if (lost) return notices(ctx) + '<section class="panel stack" role="alert"><h2>This draft was removed from the folder</h2><p>Your edits that weren\'t saved are below. Save them as the draft again, or copy them.</p>' +
        '<div class="row"><button class="btn go" data-act="recover-draft">Save as the draft again</button><button class="mini" data-act="copy-map">' + I('copy') + 'Copy</button><span id="copy-msg" class="small" role="status"></span></div><pre class="source" id="map-source" tabindex="0">' + esc(lost.text) + '</pre></section>';
      return notices(ctx) + '<div class="panel">That checklist wasn\'t found. <button class="mini" data-act="home">Back to Home</button></div>';
    }
    /* Editing a draft takes the whole page (manage.js). */
    if (V.tabOf(ctx) === 'edit') return V.editTab(ctx, p);
    var pub = p.latest, h = notices(ctx);
    h += '<div class="runhead"><div><div class="eyebrow">' + esc(p.category) + (pub ? ' · owner ' + esc(nameOf(ctx, pub.map.meta.owner)) : '') + '</div><h1 id="page-h" tabindex="-1">' + esc(p.title) + '</h1>' +
      (pub ? '<div class="small">v' + pub.info.version + ' · published ' + esc(U.day(pub.info.publishedAt)) + ' by ' + esc(nameOf(ctx, pub.info.publishedBy)) + '</div>' : '<div class="small">Not published yet.</div>') + '</div>' +
      '<div class="row">' + (V.tabOf(ctx) === 'overview' && p.all.length ? '<button class="mini" data-act="ptab" data-id="insights">' + I('chart') + 'How runs go</button>' : '') + (pub ? '<button class="btn primary" data-act="start" data-id="' + esc(p.id) + '"' + (st.me ? '' : ' disabled') + '>' + I('play') + 'Start a run</button><button class="btn" data-act="plan-run" data-id="' + esc(p.id) + '"' + (st.me ? '' : ' disabled') + '>Plan a run</button>' : '') + '</div></div>';
    var dWhy = p.draft && ((st.unread || {}).drafts || {})[p.draft.file];
    if (dWhy) h += '<div class="notice bad" role="alert"><span><b>' + esc(p.draft.file) + ' couldn\'t be read on the last check</b> (' + esc(dWhy) + '). This is the version read before. It isn\'t edited or saved over until it reads again.</span><span class="row"><button class="btn" data-act="refresh">Try again</button><button class="mini" data-act="recovery" data-id="a-file-cant-be-read">What to do</button></span></div>';
    if (p.sharedDrafts) h += '<div class="notice bad" role="alert"><span><b>' + p.sharedDrafts.length + ' drafts say process: ' + esc(p.id) + '</b> (' + p.sharedDrafts.map(function (f) { return '<code>' + esc(f) + '</code>'; }).join(', ') + '). This page shows ' + esc(p.draft.file) + '. Settle which one is right before you publish.</span><button class="mini" data-act="recovery" data-id="onedrive-made-a-copy-of-a-draft-peoplejson-or-a-step-type">What to do</button></div>';
    if (p.proposedOnly) h += '<div class="notice"><span><b>Proposed, not drafted yet.</b> Your AI assistant proposed this checklist. Review it below; applying it creates the draft.</span></div>';
    h += editingNote(ctx, p);
    if (p.clashes.length) h += '<div class="notice bad"><span>Two people published version ' + p.clashes.join(', ') + ' at the same time. Neither is used until one is removed from <code>publications/' + esc(p.id) + '</code>. Publish again to make a clean next version.</span></div>';
    p.broken.forEach(function (b) { h += '<div class="notice warn"><span>' + esc(b.folder) + ': ' + esc(b.why) + '</span></div>'; });
    /* C3 (2.8): the latest version's linked steps that can't start their child as it is now. */
    if (pub && ctx.procOf) PF.links.broken(pub.map, PF.links.childrenFrom(ctx.procOf)).forEach(function (b) {
      h += '<div class="notice warn" role="status"><span>Step "' + esc(b.step.text.slice(0, 40)) + '" passes ' + esc(b.names.join(', ')) + ' to ' + esc(b.title) + ', whose latest version (v' + esc(b.version) + ') doesn\'t have ' + (b.names.length > 1 ? 'them' : 'it') + '. New runs can\'t start that child until this checklist changes.</span></div>';
    });
    /* One page: the checklist in the middle, edited in place; how runs go opens on its own with a way back. */
    if (V.tabOf(ctx) === 'insights') return h + '<div class="row"><button class="mini" data-act="ptab" data-id="overview">' + I('back') + 'Back to the checklist</button></div>' + (insights(ctx, p) || '<section class="panel"><p class="small">No runs yet. This fills in after the first run.</p></section>');
    h += '<div class="pgrid"><div class="stack">';
    if (p.draft && p.draftChanged) {
      var c = M.check(M.parse(p.draft.md), { people: ctx.data.people, types: (ctx.data.stepTypes || {}).types, workflows: (ctx.data.jira || {}).workflows, processes: ctx.processes().filter(function (x) { return x.latest; }).map(function (x) { return x.id; }), children: ctx.procOf ? PF.links.childrenFrom(ctx.procOf) : null, parents: ctx.processes(), teamValues: ctx.data.teamValues });
      h += '<section class="panel"><div class="row between"><h2 style="margin:0">Draft · ' + esc(p.draft.file) + '</h2><span class="small">' + (p.typesChanged && p.typesChanged.length ? 'Step type ' + p.typesChanged.join(', ') + ' changed since v' + pub.info.version + '; publish to use it' : p.draftChanged ? 'Has changes not yet published' : 'Same as the published version') + '</span></div>' + checkList(c);
      if (p.draftChanged) {
        /* Publishing takes the draft in the folder: while newer edits wait unsaved in the editor, it would publish the older text. */
        var base = corrBase(ctx, p), shots = ctx.shotBusy ? ctx.shotBusy(p.id) : 0, held = base.dirty || base.conflict || shots;
        h += '<div class="row" style="margin-top:12px"><label class="field" style="flex:1;min-width:240px" for="change-note">What changed (one line, required)<input id="change-note" maxlength="200"' + (pub ? '' : ' value="First version"') + ' placeholder="e.g. Require the full test gate after the rebase"></label>' +
          '<button class="btn go" data-act="publish" data-id="' + esc(p.id) + '"' + (c.blockers.length || !st.me || held ? ' disabled' : '') + (held ? ' aria-describedby="pub-why"' : '') + '>Publish v' + PF.publish.nextVersion(p.taken || p.all.map(function (x) { return x.info; })) + '</button></div>' +
          (held ? '<p class="small" id="pub-why">' + (base.dirty || base.conflict ? 'Your edits aren\'t saved, so they wouldn\'t be in this version. Save or discard them in the editor first.' : 'A screenshot is still being added to this draft. Publish when it\'s done.') + '</p>' : '') +
          '<p class="small">Anyone can publish. It\'s logged with your name, the time and the change note, and runs already started keep their version.</p>' + publishNeeds(ctx, p) + publishCorrections(ctx, p);
        if (pub) h += '<details style="margin-top:8px"><summary class="small" style="cursor:pointer">Compare the draft with v' + pub.info.version + '</summary>' + diffHtml(PF.publish.diff(pub.md, p.draft.md)) + '</details>';
      }
      h += '</section>';
    }
    h += proposalsPanel(ctx, p);
    h += V.checklistPanel(ctx, p);
    h += '</div><aside class="stack">';
    var mine = K.keeps(ctx, p);
    h += fixesPanel(ctx, p) + (mine ? readyPanel(ctx, p, pub) + skillsPanel(ctx, p) : '');
    /* Versions: the newest on show, earlier ones folded; one line each; the change note shows in full on hover and in Changes. */
    var verLi = function (v, i) {
      var older = p.all[i + 1];
      return '<li><b>v' + v.info.version + '</b><span><span class="clip" title="' + esc(v.info.changes) + '">' + esc(v.info.changes) + '</span><span class="small">' + esc(U.day(v.info.publishedAt)) + '</span></span>' +
        '<span class="row">' + (older ? '<button class="mini" data-act="diff" data-id="' + esc(v.folder) + '" aria-expanded="' + (st.diffOf === v.folder) + '">Changes</button>' : '') + '<button class="mini" data-act="view-version" data-id="' + esc(v.folder) + '" aria-pressed="' + (st.mapVer === v.folder) + '">View</button></span></li>' +
        (st.diffOf === v.folder && older ? '<li style="display:block">' + diffHtml(PF.publish.diff(older.md, v.md)) + '</li>' : '');
    };
    /* Staging (2.1) lives inside the closed All versions disclosure, so nobody who never stages sees it. */
    var earlier = p.all.slice(1), stg = stagesHtml(ctx, p), verOpen = (st.disc || {})['vers:' + p.id] || earlier.some(function (v) { return st.diffOf === v.folder || st.mapVer === v.folder; });
    h += '<section class="panel" aria-labelledby="ver-h"><h2 id="ver-h">Versions</h2><ul class="vlist compact">' + (p.all.length ? verLi(p.all[0], 0) : '<li class="small">Not published yet. Edit the checklist, then publish it.</li>') + '</ul>' +
      (earlier.length || stg ? '<details data-disc="vers:' + esc(p.id) + '"' + (verOpen ? ' open' : '') + '><summary class="small">All versions' + (earlier.length ? ' (' + p.all.length + ')' : '') + '</summary>' + (earlier.length ? '<ul class="vlist compact">' + earlier.map(function (v, i) { return verLi(v, i + 1); }).join('') + '</ul>' : '') + stg + '</details>' : '') + '</section>';
    var runs = ctx.data.runs.filter(function (r) { return r.process === p.id; }).sort(function (a, b) { return a.created < b.created ? 1 : -1; });
    h += '<section class="panel" aria-labelledby="pr-h"><h2 id="pr-h">Recent runs</h2>' + (runs.length ? '<ul class="plist">' + runs.slice(0, 3).map(function (r) {
      var hl = K.headline(r, R.mapOf(r));
      return '<li><button data-act="open-run" data-id="' + esc(runKey(r)) + '"><span class="t">' + esc(r.title) + '</span><span class="pill ' + hl.s + '">' + esc(r.ended ? K.outcomeWord(r.ended.outcome) : 'running') + '</span><span class="small">' + esc(U.day(r.created)) + ' · ' + esc(K.verWord(r)) + '</span></button></li>';
    }).join('') + '</ul>' + (runs.length > 3 ? '<button class="link" data-act="runs-of" data-id="' + esc(p.id) + '">All ' + runs.length + ' runs of this checklist</button>' : '') : '<p class="small">No runs yet. Start one with <b>Start a run</b>.</p>') + '</section>';
    return h + (mine ? '' : skillsFold(ctx, p, pub)) + '</aside></div>';
  }

  /* ---------- proposals from AI assistants and who's editing (docs/design.md section 27) ---------- */
  var FIT_WORDS = {
    ready: 'Ready to apply: it starts from the draft as it is now.', older: 'This started from an older draft.', already: 'Already in the draft.',
    waiting: 'Waiting for an earlier proposal.', review: 'The proposal it follows was declined or replaced. Review it.', replaced: 'Replaced by a newer proposal.',
    invalid: 'Can\'t be used: it links to another session\'s proposal, or to itself.', applied: 'Applied.', 'applied-twice': 'Applied twice.', declined: 'Declined.',
    unknown: 'Can\'t tell what happened: a record about it can\'t be read yet.'
  };
  var REC_WORDS = { maybe: 'May already be applied.', tried: 'Tried before, not applied.', reopened: 'Reopened.', 'decided-twice': 'Decided twice.' };
  function propWords(x) {
    var w = FIT_WORDS[x.fit] || '', r = REC_WORDS[x.rec && x.rec.state];
    return r && x.fit !== 'applied' && x.fit !== 'applied-twice' && x.fit !== 'declined' && x.fit !== 'unknown' ? r + ' ' + w : w;
  }
  /* Apply straight from the list only for a fast-forward with no record at all; anything tried before goes through Review. */
  function listApply(x) { return x.fit === 'ready' && x.rec && x.rec.state === 'pending'; }
  function canDecide(x) { return x.fit !== 'invalid' && x.fit !== 'replaced' && x.fit !== 'applied' && x.fit !== 'applied-twice' && x.fit !== 'declined' && x.fit !== 'unknown'; }
  /* Stages (2.1, docs/design.md section 31): each with its status worked out from the saved files, Make vN the default, Retire
     and Reopen; and Stage the draft when there's a changed draft. Anyone may do these; each is logged with their name. */
  function stagesHtml(ctx, p) {
    var st = ctx.state, procs = (ctx.data.stages || {}).procs || {}, sp = Object.prototype.hasOwnProperty.call(procs, p.id) ? procs[p.id] : null, S = PF.staging, me = !!st.me, busy = st.stageBusy === p.id;
    var next = PF.publish.nextVersion(p.taken || p.all.map(function (x) { return x.info; }));
    var canStage = me && !!p.draft && !!p.draftChanged && !p.proposedOnly;
    if (!sp && !canStage) return '';
    /* Decisions that can't be read could say it's retired: no status is shown as settled and nothing can be changed until they read. */
    var held = !!sp && (!!(ctx.data.failed || {}).stages || !!sp.unlisted || sp.unread.length > 0 || sp.refused.some(function (r) { return /\/decisions\//.test(r.path); }));
    var rows = (sp ? sp.stages : []).map(function (s) {
      if (s.newer) return '<li class="stg"><b>Staged</b><span><span class="small">' + esc(s.folder) + ': ' + esc(s.why) + '</span></span></li>';
      if (!s.ok) return '<li class="stg"><b>Staged</b><span><span class="small">' + esc(s.folder) + ' is incomplete: nothing runs from it.</span></span></li>';
      var x = S.status(s, sp.decisions, p.all), i = s.info, id = esc(s.folder), b = '';
      var word = x.status === 'promoted' ? 'Published as v' + x.pub.info.version : held ? 'Status unknown until its decisions can be read' : x.status === 'retired' ? 'Retired' : x.status === 'tie' ? 'Two decisions disagree' : '';
      if (held) b = '';
      else if (me && x.status === 'staged') b = '<button class="mini" data-act="start-test" data-id="' + id + '"' + (busy ? ' disabled' : '') + '>Start a test run</button><button class="mini" data-act="promote-stage" data-id="' + id + '"' + (busy ? ' disabled' : '') + '>Make v' + next + ' the default</button><button class="mini" data-act="retire-stage" data-id="' + id + '"' + (busy ? ' disabled' : '') + '>Retire</button>';
      else if (me && (x.status === 'retired' || x.status === 'tie')) b = (x.status === 'tie' ? '<button class="mini" data-act="retire-stage" data-id="' + id + '"' + (busy ? ' disabled' : '') + '>Retire</button>' : '') + '<button class="mini" data-act="reopen-stage" data-id="' + id + '"' + (busy ? ' disabled' : '') + '>Reopen</button>';
      /* Its test runs (2.1 slice 6): said only once it has some, with its sign-off, and Sign off for its owner once enough are clean. */
      var sg = stageSign(ctx, p, s.folder), tw = '';
      var anyTest = (ctx.data.runs || []).some(function (r) { return r.process === p.id && r.folder === s.folder && PF.run.isTest(r); });
      if (sg.ready && anyTest) tw = ' · ' + sg.ready.clean + ' of ' + sg.ready.needed + ' clean test runs' + (sg.signs.length ? ' · Signed off by ' + nameOf(ctx, sg.signs[0].by) : sg.hold && sg.hold.kind === 'newer' ? ' · Signed off with a newer Flightdeck: update to see it' : sg.unknown ? ' · Can\'t tell whether it was signed off: ' + sg.unknown : '');
      if (sg.as) b += '<button class="mini" data-act="signoff-stage" data-id="' + id + '"' + (busy ? ' disabled' : '') + '>Sign off staged v' + esc(i.stage.proposed) + '</button>';
      return '<li class="stg"><b>Staged</b><span><span class="clip" title="' + esc(i.changes) + '">' + esc(i.changes) + '</span><span class="small">' + esc(U.day(i.stagedAt)) + ' by ' + esc(nameOf(ctx, i.stagedBy)) + (word ? ' · ' + esc(word) : '') + esc(tw) + '</span></span>' + (b ? '<span class="row">' + b + '</span>' : '') + '</li>';
    });
    var gone = (ctx.data.failed || {}).stages;
    return (sp && (sp.unlisted || gone) ? '<p class="small">' + esc(sp.unlisted || 'staged/ couldn\'t be read (' + gone + ')') + '. Staged versions are shown as last read.</p>' : held ? '<p class="small">A decision on these staged versions can\'t be read now, so they can\'t be changed until it can. Folder health names it.</p>' : '') +
      (rows.length ? '<ul class="vlist compact">' + rows.join('') + '</ul>' : '') +
      (canStage ? '<p class="small"><button class="mini" data-act="stage-draft" data-id="' + esc(p.id) + '"' + (busy ? ' disabled' : '') + '>Stage the draft for testing</button> Only test runs use it until someone makes it the default.</p>' : '');
  }
  function proposalsPanel(ctx, p) {
    var pr = p.proposed;
    if (!pr || (!pr.list.length && !pr.bad.length)) return '';
    var h = '<section class="panel" aria-labelledby="pp-h"><h2 id="pp-h" tabindex="-1">Proposed changes · ' + pr.list.length + '</h2>' +
      '<p class="small">From your AI assistant, when the draft was open in an editor or had changed since it was read. Review one, then apply or decline it.</p>';
    if (pr.list.length) h += '<ul class="rlist props">' + pr.list.map(function (x) {
      var m = x.meta;
      return '<li class="prop"><div><b>' + esc(m.note || 'A change to the draft') + '</b><div class="small">' + esc(m.by ? nameOf(ctx, m.by) + '’s AI assistant' : 'Your AI assistant') + ' · ' + esc(U.when(m.at)) + '</div>' +
        '<div class="small prop-st">' + esc(propWords(x)) + '</div></div><div class="row">' +
        '<button class="mini" data-act="prop-review" data-id="' + esc(x.id) + '">Review</button>' +
        (listApply(x) ? '<button class="btn go" data-act="prop-apply" data-id="' + esc(x.id) + '">Apply</button>' : '') +
        (canDecide(x) ? '<button class="mini" data-act="prop-decline" data-id="' + esc(x.id) + '">Decline</button>' : '') +
        (x.fit === 'declined' ? '<button class="mini" data-act="prop-reopen" data-id="' + esc(x.id) + '">Reopen</button>' : '') + '</div></li>';
    }).join('') + '</ul>';
    if (pr.older) h += '<p class="small">… and ' + pr.older + ' older proposal' + (pr.older === 1 ? '' : 's') + '.</p>';
    if (pr.bad.length) h += '<p class="small">' + pr.bad.length + ' proposal' + (pr.bad.length === 1 ? ' can\'t' : 's can\'t') + ' be read yet (' + esc(pr.bad.slice(0, 3).map(function (b) { return b.name + ' ' + b.why; }).join('; ')) + '). Flightdeck tries again on the next refresh.</p>';
    return h + '</section>';
  }
  /* Who else has this draft open, as far as this computer can see right now: a courtesy, not a lock. */
  function editingNote(ctx, p) {
    var eds = p.editing || [];
    if (!eds.length) return '';
    var secs = function (ms) { var s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + ' second' + (s === 1 ? '' : 's') : Math.round(s / 60) + ' minute' + (Math.round(s / 60) === 1 ? '' : 's'); };
    return '<div class="notice edit-by"><span>' + eds.map(function (e) { return '<b>Being edited by ' + esc(nameOf(ctx, e.by)) + (e.device ? ' on ' + esc(e.device) : '') + '</b> (seen ' + secs(e.ago) + ' ago).'; }).join(' ') +
      ' Flightdeck shows the editors this computer can see right now.</span></div>';
  }
  /* The editor's line about which window is the main editor for this draft (the one that will apply proposals live). */
  function mainNote(ctx, p) {
    var m = p.main;
    if (!m && !(p.editing || []).length) return '';
    var btn = '<button type="button" class="mini" data-act="main-editor">Make this the main editor</button>';
    if (m && m.me) return '<div class="notice"><span>This is the main editor for this draft.</span></div>';
    if (m && m.ambiguous && m.claimRev) return '<div class="notice warn"><span>Two editors claimed this draft at once. Choose Make this the main editor to settle it.</span>' + btn + '</div>';
    if (m && m.by && m.lost) return '<div class="notice"><span>' + esc(nameOf(ctx, m.by)) + ' made their editor the main one for this draft. You can still edit and save.</span>' + btn + '</div>';
    return '<div class="notice"><span>More than one editor has this draft open.</span>' + btn + '</div>';
  }
  /* Review: what the change does to the draft, its checks, ID changes, what happened before (attempts and decisions), and
     only the actions that fit. ov: { item, proposal (read whole, on demand), draftText, records, err, busy }. */
  function proposalReview(ctx, ov) {
    var x = ov.item, m = x ? x.meta : null;
    var box = function (inner) { return '<div class="overlay" data-act="close-overlay"><div class="ca-box" role="dialog" aria-modal="true" aria-labelledby="pr-t">' + inner + '</div></div>'; };
    var bar = '<div class="ca-bar"><h2 id="pr-t" tabindex="-1">Review your AI assistant’s change</h2><button type="button" class="mini" id="pr-close" data-act="close-overlay">Close</button></div>';
    if (!x) return box(bar + '<p>This proposal isn\'t in the folder any more.</p>');
    var h = bar + '<p><b>' + esc(m.note || 'A change to the draft') + '</b></p><p class="small">' + esc(m.by ? nameOf(ctx, m.by) + '’s AI assistant' : 'Your AI assistant') + (m.label ? ' (' + esc(m.label) + ')' : '') + ' · ' + esc(U.when(m.at)) + '</p>';
    h += '<p class="prop-st">' + esc(propWords(x)) + '</p>';
    if (ov.err) h += '<div class="notice bad" id="pr-err"><span>' + esc(ov.err) + '</span></div>';
    if (!ov.proposal) return box(h + '<p class="small" role="status">' + (ov.loadErr ? esc(ov.loadErr) : 'Reading it…') + '</p>');
    var maybe = x.rec && (x.rec.state === 'maybe' || (x.rec.open && x.rec.open.length));
    if (maybe) h += '<div class="notice warn"><span>Flightdeck started applying this but couldn\'t record what happened. Compare it with the draft below, then mark it as applied or apply it again.</span></div>';
    var recs = ov.records || [];
    if (recs.length) h += '<details open><summary class="small">What happened before (' + recs.length + ')</summary><ul class="small">' + recs.map(function (r) {
      if (!r.rec) return '<li><code>' + esc(r.name) + '</code> can\'t be read yet. It may still be arriving.</li>';
      var who = esc(nameOf(ctx, r.rec.by)) + ' · ' + esc(U.when(r.rec.at));
      return '<li>' + (r.rec.kind === 'attempt' ? 'Started applying it' + (r.rec.how === 'live' ? ' in an editor' : '') : esc(DEC_WORDS[r.rec.status] || r.rec.status)) + ' · ' + who + '</li>';
    }).join('') + '</ul></details>';
    var draftText = ov.draftText == null ? '' : ov.draftText, d = PF.proposals.diff(draftText, ov.proposal.text);
    h += '<h3 class="small">' + (ov.draftText == null ? 'Compared with nothing (there\'s no draft yet)' : 'Compared with the draft as it is now') + '</h3>';
    h += d.tooMany ? '<p class="small">Too many changes to show line by line.</p>' : capDiff(d.rows);
    var ids = PF.proposals.ids(draftText, ov.proposal.text);
    if (ids.removed.length || ids.renamed.length) h += '<div class="notice warn"><span>' + (ids.removed.length ? 'Step or phase IDs this removes: ' + esc(ids.removed.slice(0, 20).join(', ')) + '. ' : '') + (ids.renamed.length ? 'IDs it changes: ' + esc(ids.renamed.slice(0, 20).map(function (r) { return r.from + ' → ' + r.to; }).join(', ')) + '. ' : '') + 'Runs and skills that name them will need a look.</span></div>';
    var c = M.check(M.parse(ov.proposal.text), { people: ctx.data.people, types: (ctx.data.stepTypes || {}).types, workflows: (ctx.data.jira || {}).workflows, processes: ctx.processes().filter(function (q) { return q.latest; }).map(function (q) { return q.id; }), children: ctx.procOf ? PF.links.childrenFrom(ctx.procOf) : null, parents: ctx.processes(), teamValues: ctx.data.teamValues });
    h += '<h3 class="small">Checks on the proposed text</h3>' + checkList(c);
    var blocked = recs.some(function (r) { return !r.rec; }), acts = '';
    if (x.fit === 'ready' && !blocked && x.rec.state !== 'applied' && x.rec.state !== 'applied-twice') acts += '<button type="button" class="btn go" data-act="prop-apply" data-id="' + esc(x.id) + '"' + (ov.busy ? ' disabled' : '') + '>' + (recs.length ? 'Apply again' : 'Apply') + '</button>';
    if (maybe && !blocked) acts += '<button type="button" class="btn" data-act="prop-mark-applied" data-id="' + esc(x.id) + '">Mark as applied</button>';
    else if (x.fit === 'already' && !blocked && x.rec.state !== 'applied') acts += '<button type="button" class="btn" data-act="prop-mark-applied" data-id="' + esc(x.id) + '">Mark as applied</button>';
    if (canDecide(x)) acts += '<button type="button" class="mini" data-act="prop-decline" data-id="' + esc(x.id) + '">Decline</button>';
    if (x.fit === 'declined') acts += '<button type="button" class="mini" data-act="prop-reopen" data-id="' + esc(x.id) + '">Reopen</button>';
    h += '<div class="row ca-acts" id="pr-acts">' + acts + '<button type="button" class="mini" data-act="close-overlay">Close</button></div>';
    return box(h);
  }
  var DEC_WORDS = { applied: 'Applied', declined: 'Declined', reopened: 'Reopened', withdrawn: 'Taken back before it was saved', 'not-saved': 'Not saved: someone else changed the draft', cancelled: 'Stopped: the draft changed while it was being applied', overwritten: 'Saved, then replaced by another change before Flightdeck read it back' };
  function capDiff(rows) {
    if (!rows.some(function (r) { return r.op === '+' || r.op === '-'; })) return '<p class="small">No differences.</p>';
    return '<div class="diff">' + rows.map(function (r) { return r.op === '+' ? '<span class="add">+ ' + esc(r.text) + '</span>' : r.op === '-' ? '<span class="del">- ' + esc(r.text) + '</span>' : r.op === '…' ? '<span class="small">  … ' + esc(r.text) + '</span>\n' : '<span>  ' + esc(r.text) + '</span>\n'; }).join('') + '</div>';
  }

  function diffHtml(rows) {
    var changed = rows.some(function (r) { return r.op !== ' '; });
    if (!changed) return '<p class="small">No differences.</p>';
    return '<div class="diff">' + rows.map(function (r) { return r.op === '+' ? '<span class="add">+ ' + esc(r.text) + '</span>' : r.op === '-' ? '<span class="del">- ' + esc(r.text) + '</span>' : '<span>  ' + esc(r.text) + '</span>\n'; }).join('') + '</div>';
  }

  /* The exact publication a person switched this plan to, if it was in this folder, on this plan, as it reads now. */
  /* A plan/2 whose version can't be used: say which and why, and offer only an explicit switch to the latest. */
  function exactAsk(ctx, p, plan, pick) {
    var title = p.latest && p.latest.map ? p.latest.map.meta.title : p.title, to = plan._retarget ? plan._retarget.to : plan.pin;
    var h = '<div class="runhead"><div><div class="eyebrow">' + esc(title) + ' · ' + esc(V.plannedBy(ctx, plan)) + '</div><h1>Start a run</h1></div></div>';
    h += '<div class="notice bad" role="alert"><span>This plan starts on ' + esc(title) + ' v' + esc(to.version) + ' (' + esc(to.folder) + '), which can\'t be used here: ' + esc(pick.ask) + '. It won\'t start on another version by itself.</span>' +
      '<span class="row">' + (p.latest ? '<button class="btn" type="button" data-act="plan-retarget" data-id="' + esc(plan.id) + '" data-folder="' + esc(p.latest.info.folder) + '">Start on v' + esc(p.latest.info.version) + ' instead</button>' : '') +
      '<button class="mini" type="button" data-act="decline-plan" data-id="' + esc(plan.id) + '">Decline this plan</button><button class="mini" type="button" data-act="home">Back</button></span></div>';
    return h;
  }
  /* Why a plan can't be started, declined or switched now, and what an earlier decision said: PF.plans, shared with reading for other apps. */
  var planHeldWhy = PF.plans.heldWhy, earlierWords = PF.plans.earlierWords;
  function planChoice(ctx, plan) {
    var c = ctx.state.planPick;
    return c && plan && c.plan === plan.id && c.hash === plan._sha && c.key === ctx.fsKey ? c.folder : null;
  }
  /* ---------- start a run, or plan one ---------- */
  /* The same form starts a run (from scratch or from a plan) or, with state.planning, saves a plan for later. */
  /* A test run (2.1) starts from a stage's line, on that stage only: never a plan (D5), never another version. */
  function testStage(ctx, p) {
    var procs = (ctx.data.stages || {}).procs || {}, sp = Object.prototype.hasOwnProperty.call(procs, p.id) ? procs[p.id] : null;
    var s = sp ? sp.stages.filter(function (x) { return x.folder === ctx.state.testStage; })[0] : null;
    if (!s || !s.ok) return { why: 'This staged version isn\'t in the folder, or can\'t be read now.' };
    var held = !!(ctx.data.failed || {}).stages || !!sp.unlisted || sp.unread.length > 0 || sp.refused.some(function (r) { return /\/decisions\//.test(r.path); });
    if (held) return { why: 'A decision on it can\'t be read now, so it isn\'t known whether it was retired. Try again once the folder has synced.' };
    var x = PF.staging.status(s, sp.decisions, p.all);
    if (x.status === 'promoted') return { why: 'It\'s already the default, v' + x.pub.info.version + '. Start an ordinary run on it.' };
    if (x.status !== 'staged') return { why: PF.staging.promoteWhy(x) };
    return { stage: s };
  }
  /* A stage's readiness and sign-off (2.1 slice 6), as its line shows them: { ready, signs, as } where as is who may sign it
     off now ("owner", "backup" or ""), only while it's staged, its decisions read and enough of its test runs are clean. */
  function stageSign(ctx, p, folder) {
    var procs = (ctx.data.stages || {}).procs || {}, sp = Object.prototype.hasOwnProperty.call(procs, p.id) ? procs[p.id] : null;
    var s = sp ? sp.stages.filter(function (x) { return x.folder === folder; })[0] : null;
    if (!s || !s.ok) return { why: 'This staged version isn\'t in the folder, or can\'t be read now.' };
    var ready = PF.skills.readiness(ctx.countedRuns ? ctx.countedRuns(s.map.meta.process) : ctx.data.runs, s, null), signs = PF.skills.signoffs(ctx.data.validations, s);
    var held = !!(ctx.data.failed || {}).stages || !!sp.unlisted || sp.unread.length > 0 || sp.refused.some(function (r) { return /\/decisions\//.test(r.path); });
    var x = PF.staging.status(s, sp.decisions, p.all);
    /* A sign-off of it that can't be read could be there already: it's never offered again until that reads. */
    var hold = signs.length ? null : PF.skills.signHold(ctx.data, s), unknown = hold ? PF.skills.signUnknown(ctx.data, s) : '';
    var as = !held && !unknown && x.status === 'staged' && ready.enough && !signs.length ? PF.skills.signer(s, ctx.data.people, ctx.state.me, !!(ctx.data.failed || {}).people) : '';
    return { stage: s, ready: ready, signs: signs, as: as, status: x.status, unknown: unknown, hold: hold };
  }
  function start(ctx) {
    var st = ctx.state, p = ctx.processes().filter(function (x) { return x.id === st.processId; })[0];
    if (p && st.testStage) return startTest(ctx, p);
    var planning = st.planning && st.planning.process === st.processId ? st.planning : null;
    var plan = !planning && st.planId ? ctx.data.plans.filter(function (x) { return x.id === st.planId; })[0] : null;
    if (!p || !p.latest) return notices(ctx) + '<div class="panel">There\'s no published version of this checklist to run. <button class="mini" data-act="home">Back</button></div>';
    /* A plan starts on the version it was planned on, or the exact one the person switched to; see PF.plans.pick. A plan/2
       whose pinned version can't be used asks, and never starts on another version by itself. */
    /* A plan decided on an earlier version (2.1.1) is never offered to start, decline or switch: it says what was decided. */
    if (plan && plan._decidedEarlier && !plan._conflicting) return notices(ctx) + '<div class="runhead"><div><div class="eyebrow">' + esc(p.title) + ' · ' + esc(V.plannedBy(ctx, plan)) + '</div><h1 id="page-h" tabindex="-1">' + esc(plan.title || 'Planned run') + '</h1></div></div>' +
      '<div class="notice warn" role="status"><span>' + esc(planHeldWhy(plan, ctx.data)) + '</span><span class="row"><button class="mini" type="button" data-act="home">Back</button></span></div>';
    var chosen = plan ? planChoice(ctx, plan) : null, pick = plan ? PF.plans.pick(p, plan, chosen) : { pub: p.latest };
    if (plan && pick.exact && !pick.pub) return notices(ctx) + exactAsk(ctx, p, plan, pick);
    var pub = pick.pub, latest = p.latest, meta = pub.map.meta, people = ctx.data.people.filter(function (x) { return !x.inactive; }), pre = planning || plan || {};
    var defTitle = plan ? plan.title : planning ? planning.title || meta.title : meta.title + ' · ' + U.day(new Date().toISOString());
    var h = notices(ctx) + '<div class="runhead"><div><div class="eyebrow">' + esc(meta.title) + ' · v' + pub.info.version + (plan ? ' · ' + esc(V.plannedBy(ctx, plan)) : '') + '</div><h1 id="page-h" tabindex="-1">' + (planning ? 'Plan a run' : 'Start a run') + '</h1>' + (plan && plan.note ? '<div class="small">' + esc(plan.note) + '</div>' : '') + '</div></div>';
    var claim = plan ? PF.requests.claim(plan) : null, copies = plan ? V.planCopies(plan) : '';
    if (claim) h += '<p class="small">Requested by ' + esc(claim.name + ' ' + claim.version) + ', by its own account. Flightdeck can\'t confirm which tool or person wrote this file. Nothing starts until you start it.</p>';
    if (plan && plan._copiesDiffer) h += '<div class="notice bad" role="alert"><span>' + copies + ' The files: ' + (plan._files || []).map(function (f) { return '<code>proposals/' + esc(f) + '</code>'; }).join(', ') + '. Compare them, then delete the wrong one (When something goes wrong, A planned run arrived twice).</span></div>';
    else if (copies) h += '<div class="notice" role="status"><span>' + copies + '</span></div>';
    if (plan && planHeldWhy(plan, ctx.data)) h += '<div class="notice bad" role="alert"><span>' + esc(planHeldWhy(plan, ctx.data)) + '</span></div>';
    if (plan && plan._conflicting) h += '<div class="notice bad" role="alert"><span><b>Two decisions on this plan disagree</b>: it was started and declined, or started twice. Someone may have started it already; check Runs before you start it again.</span></div>';
    if (plan && pick.older) {
      h += '<div class="notice warn"><span>' + (pick.chosen ? 'You switched this plan to v' : 'This plan was made for v') + esc(pub.info.version) + '. v' + esc(latest.info.version) + ' is now published.</span><span class="row"><button class="mini" type="button" data-act="plan-diff" aria-expanded="' + !!st.planDiff + '">See what changed</button>' +
        (pick.exact ? '<button class="btn" type="button" data-act="plan-retarget" data-id="' + esc(plan.id) + '" data-folder="' + esc(latest.info.folder) + '">Start on v' + esc(latest.info.version) + ' instead</button>' : '<button class="btn" type="button" data-act="plan-latest" data-id="' + esc(plan.id) + '">Switch to v' + esc(latest.info.version) + '</button>') + '</span></div>';
      if (st.planDiff) h += '<section class="panel" aria-label="Changes from v' + pub.info.version + ' to v' + latest.info.version + '">' + diffHtml(PF.publish.diff(pub.md, latest.md)) + '</section>';
    } else if (plan && pick.missing) {
      /* Say why, when the version is in the folder but can't be used here (still syncing, damaged, or too new for this copy). */
      var gone = !chosen && (p.broken || []).filter(function (b) { return PF.publish.versionOf(b.folder) === +plan.version; })[0];
      h += '<div class="notice warn" role="status"><span>' + (chosen ? 'The version you switched to' : 'This plan was made for v' + esc(plan.version) + ', which') + (gone ? ' can\'t be used here: ' + esc(gone.why) : ' can\'t be used anymore.') + ' It starts on v' + latest.info.version + '. Check the roles and details still make sense.</span></div>';
    }
    else if (pick.chosen) h += '<div class="notice" role="status"><span>Switched to v' + pub.info.version + '. Check the roles and details still make sense.</span></div>';
    var formId = planning ? 'plan-form' : 'start-form', scope = planning ? 'plan:' + p.id + ':' + (planning.from || '') : 'start:' + p.id + ':' + (plan ? plan.id : '');
    h += '<form class="panel stack" id="' + formId + '" data-scope="' + esc(scope) + '" data-process="' + esc(p.id) + '" data-folder="' + esc(pub.info.folder) + '"' + (plan ? ' data-plan-hash="' + esc(plan._sha) + '" data-plan-conflict="' + (plan._conflicting ? '1' : '') + '"' : '') + '><div class="grid2"><label class="field" for="run-title">Run name<input id="run-title" maxlength="100" value="' + esc(defTitle) + '"></label>';
    /* A detail a step produces during the run (sets:) isn't asked for here; the form says which step fills it in. */
    var setBy = M.setBy(pub.map), given = pre.details && typeof pre.details === 'object' ? pre.details : {};
    var later = meta.context.filter(function (f) { return Object.prototype.hasOwnProperty.call(setBy, f) && !(plan && given[f]); });
    meta.context.filter(function (f) { return later.indexOf(f) < 0; }).forEach(function (f) {
      var g = typeof given[f] === 'string' ? given[f] : '', def = PF.run.typedDef({ snapshot: '' }, pub.map, 'details.' + f);
      if (!def) { h += '<label class="field" for="detail-' + esc(f) + '">' + esc(f) + '<input id="detail-' + esc(f) + '" data-detail="' + esc(f) + '" maxlength="120" value="' + esc(g) + '"></label>'; return; }
      /* A typed detail (2.0) gets its kind's box. A plan's text that doesn't convert is shown beside it, never guessed. */
      var m = plan && g ? PF.run.migrateDetail(def, g) : null, shown = m && (m.verdict === 'exact' || m.verdict === 'converted') ? m.result : plan ? '' : g;
      h += '<div>' + K.typedField('detail-' + f, f, def, shown, 'data-detail="' + esc(f) + '"') + (m && m.verdict !== 'exact' && m.verdict !== 'converted' ? '<p class="small">' + esc(PF.values.ask(def, g)) + '</p>' : '') + '</div>';
    });
    if (later.length) h += '<p class="small" style="grid-column:1/-1">' + later.map(function (f) { return '<b>' + esc(f) + '</b> is filled in by "' + esc(setBy[f][0].text) + '"'; }).join('; ') + '.</p>';
    if (planning) {
      var err = st.fieldErr && st.fieldErr.id === 'plan-when';
      h += '<p class="small" style="grid-column:1/-1">Details can stay blank until the run starts.</p>' +
        '<label class="field" for="plan-when">When (optional)<input type="datetime-local" id="plan-when" value="' + esc(planning.when || '') + '"' + (err ? ' aria-invalid="true" aria-describedby="ferr-plan-when"' : '') + '></label>' +
        '<label class="field" for="plan-note">Note (optional)<input id="plan-note" maxlength="300" value="' + esc(planning.note || '') + '"></label>' +
        (err ? '<p class="ferr" id="ferr-plan-when" role="alert" style="grid-column:1/-1">' + esc(st.fieldErr.msg) + '</p>' : '');
    }
    h += '</div>';
    /* On my own or with others: the map suggests which (runs: solo), the person decides. A version with an approval role
       (2.10) opens With others unless On my own was chosen on this very form, so who approves is always a choice. */
    var aps = approvals(pub.map), apRole = {}; aps.forEach(function (a) { (apRole[a.role] = apRole[a.role] || []).push(a.title); });
    var picked = st.startMode[p.id], pickedHere = picked && (st.startModeAt || {})[p.id] === scope + ':' + pub.info.folder;
    var mode = aps.length ? (pickedHere ? picked : 'team') : picked || (meta.runs === 'solo' || !meta.roles.length ? 'solo' : 'team'), soloMap = mode === 'solo';
    var apNames = aps.map(function (a) { return '"' + a.title + '"'; }).join(' and ');
    h += '<input type="hidden" id="start-mode" value="' + mode + '"><div class="seg" role="radiogroup" aria-label="Who is running it"><button type="button" role="radio" aria-checked="' + soloMap + '" data-act="start-mode" data-id="solo" data-process="' + esc(p.id) + '">On my own</button><button type="button" role="radio" aria-checked="' + !soloMap + '" data-act="start-mode" data-id="team" data-process="' + esc(p.id) + '">With others</button></div>';
    if (soloMap) h += '<p class="small">' + (aps.length ? 'Every role is yours, including who approves ' + esc(apNames) + '.' : 'Every role is yours.') + ' If someone joins later, add them from the run.</p>';
    if (meta.roles.length && !soloMap) {
      h += '<div class="row" style="margin-top:6px"><h3 style="margin:0">Who\'s doing what</h3>' + (st.me ? '<button class="mini" type="button" data-act="just-me">' + (aps.length ? 'Just me (every role, including who approves)' : 'Just me') + '</button>' : '') + '</div><div class="grid2">';
      var nmStage = PF.people.labeler(people);
      meta.roles.forEach(function (role) {
        var chosen = pre.roles && typeof pre.roles === 'object' && typeof pre.roles[role] === 'string' ? pre.roles[role] : '', sug = ctx.suggestRole(p.id, role);
        /* Who approves is never preselected: a saved plan's choice stays, otherwise it's Choose a person, with the rotation's
           suggestion as a hint (what it knows: who had the role on past runs). */
        if (apRole[role]) {
          var bad = st.fieldErr && st.fieldErr.id === 'start-approver' && st.fieldErr.field === 'role-' + role;
          h += '<div><label class="field" for="role-' + esc(role) + '">' + esc(role) + ' <span class="small">· approves ' + esc(apRole[role].map(function (t) { return '"' + t + '"'; }).join(' and ')) + '</span><select id="role-' + esc(role) + '" data-role="' + esc(role) + '"' + (sug ? ' data-suggested="' + esc(sug.person) + '"' : '') + (bad ? ' aria-invalid="true" aria-describedby="ferr-role-' + esc(role) + '"' : '') + '><option value="">Choose a person</option>' +
            people.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === chosen ? ' selected' : '') + '>' + esc(nmStage(x)) + '</option>'; }).join('') + '</select></label>' +
            (sug ? '<p class="small">Suggested: ' + esc(nameOf(ctx, sug.person)) + ' · ' + (sug.last ? 'last had this role on ' + esc(U.day(sug.last)) : 'hasn\'t had this role yet') + '</p>' : '') +
            (bad ? '<p class="ferr" id="ferr-role-' + esc(role) + '" role="alert">' + esc(st.fieldErr.msg) + '</p>' : '') + '</div>';
          return;
        }
        h += '<label class="field" for="role-' + esc(role) + '">' + esc(role) + (sug ? ' <span class="small">· suggestion: ' + esc(nameOf(ctx, sug.person)) + ' (' + esc(sug.why) + ')</span>' : '') + '<select id="role-' + esc(role) + '" data-role="' + esc(role) + '"><option value="">Nobody yet</option>' +
          people.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === (chosen || (sug && sug.person)) ? ' selected' : '') + '>' + esc(nmStage(x)) + '</option>'; }).join('') + '</select></label>';
      });
      h += '</div><p class="small">Suggestions rotate roles to whoever did them least recently, so everyone gets the experience. Change anything.</p>';
    }
    if (planning) return h + '<div class="row"><button class="btn go" type="submit" id="start-submit"' + (st.me ? '' : ' disabled') + '>Save the plan</button><span class="small">It waits under Runs until someone starts it.</span><button class="mini" type="button" data-act="cancel-plan">Cancel</button></div></form>';
    h += '<div class="row"><button class="btn go" type="submit" id="start-submit"' + (st.me && !(plan && plan._copiesDiffer) ? '' : ' disabled') + '>' + I('play') + 'Start the run</button><span class="small">' + (soloMap ? 'It\'s your run. You can bring someone in at any time.' : 'You\'ll be the recorder. You can hand recording to someone else at any time.') + '</span>' +
      (plan ? '<button class="mini" type="button" data-act="decline-plan" data-id="' + esc(plan.id) + '">Decline this plan</button>' : '') + '</div></form>';
    return h;
  }

  function startTest(ctx, p) {
    var st = ctx.state, ts = testStage(ctx, p), back = '<button class="mini" data-act="open-process" data-id="' + esc(p.id) + '">Back</button>';
    if (!ts.stage) return notices(ctx) + '<div class="panel">' + esc(ts.why) + ' ' + back + '</div>';
    var pub = ts.stage, meta = pub.map.meta, n = pub.info.stage.proposed, people = ctx.data.people.filter(function (x) { return !x.inactive; });
    var h = notices(ctx) + '<div class="runhead"><div><div class="eyebrow">' + esc(meta.title) + ' · staged v' + esc(n) + '</div><h1 id="page-h" tabindex="-1">Start a test run</h1><div class="small">' + esc(pub.info.changes || '') + '</div></div></div>';
    h += '<form class="panel stack" id="start-form" data-scope="' + esc('test:' + p.id + ':' + pub.folder) + '" data-process="' + esc(p.id) + '" data-folder="' + esc(pub.folder) + '" data-test="1"><div class="grid2"><label class="field" for="run-title">Run name<input id="run-title" maxlength="100" value="' + esc(meta.title + ' (test) · ' + U.day(new Date().toISOString())) + '"></label>';
    var setBy = M.setBy(pub.map);
    meta.context.filter(function (f) { return !Object.prototype.hasOwnProperty.call(setBy, f); }).forEach(function (f) {
      var def = PF.run.typedDef({ snapshot: '' }, pub.map, 'details.' + f);
      h += def ? '<div>' + K.typedField('detail-' + f, f, def, '', 'data-detail="' + esc(f) + '"') + '</div>' : '<label class="field" for="detail-' + esc(f) + '">' + esc(f) + '<input id="detail-' + esc(f) + '" data-detail="' + esc(f) + '" maxlength="120" value=""></label>';
    });
    h += '</div>';
    if (meta.roles.length) {
      h += '<div class="grid2">';
      var nmRun = PF.people.labeler(people);
      meta.roles.forEach(function (role) {
        h += '<label class="field" for="role-' + esc(role) + '">' + esc(role) + '<select id="role-' + esc(role) + '" data-role="' + esc(role) + '"><option value="">Nobody yet</option>' +
          people.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === st.me ? ' selected' : '') + '>' + esc(nmRun(x)) + '</option>'; }).join('') + '</select></label>';
      });
      h += '</div>';
    }
    return h + '<div class="row"><button class="btn go" type="submit" id="start-submit"' + (st.me ? '' : ' disabled') + '>' + I('play') + 'Start the test run</button><span class="small">A test run tries this staged version. It isn\'t counted in How runs go or toward a skill.</span>' + back + '</div></form>';
  }
  V.testStage = testStage;
  V.stageSign = stageSign;
  /* The approvals a version names a role for (2.10): who approves is chosen when it starts. */
  function approvals(map) { return (map.phases || []).filter(function (ph) { return ph.gate && !ph.gate.implicit && ph.gate.owner && map.meta.roles.indexOf(ph.gate.owner) >= 0; }).map(function (ph) { return { role: ph.gate.owner, title: ph.gate.title }; }); }
  V.approvals = approvals;
  V.process = process; V.readyPanel = readyPanel; V.start = start; V.teamSetup = teamSetup; V.checkList = checkList; V.mapPreview = mapPreview; V.fixesOf = fixesOf; V.corrBase = corrBase; V.corrApply = corrApply; V.briefBox = briefBox; V.diffHtml = diffHtml; V.planChoice = planChoice; V.planHeldWhy = planHeldWhy; V.earlierWords = earlierWords; V.proposalsPanel = proposalsPanel; V.proposalReview = proposalReview; V.editingNote = editingNote; V.mainNote = mainNote; V.propWords = propWords;
})();
