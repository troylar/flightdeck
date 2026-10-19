/* Home (what needs me), Runs, Processes and Skills: the top-level pages. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, R = PF.run, M = PF.map, T = PF.types, I = PF.icons.icon, esc = U.esc;
  var person = K.person, nameOf = K.nameOf, avatar = K.avatar, notices = K.notices, ago = K.ago, runKey = K.runKey, freshness = K.freshness;
  /* ---------- home ---------- */
  function runCard(ctx, r) {
    var map = R.mapOf(r), hl = R.headline(r, map), t = R.totals(r, map);
    return '<button class="card" data-act="open-run" data-id="' + esc(runKey(r)) + '"><div class="row between"><span class="cat">' + esc(ctx.processTitle(r.process)) + ' · v' + esc(r.version) + '</span>' + avatar(ctx, r.recorder.person) + '</div>' +
      '<span class="card-title">' + esc(r.title) + '</span><span class="state ' + hl.s + '">' + esc(hl.text) + '</span>' +
      (r.ended ? '' : '<div class="bar" aria-hidden="true"><i style="width:' + (t.total ? Math.round(100 * t.done / t.total) : 0) + '%"></i></div>') +
      '<span class="small">' + t.done + ' of ' + t.total + ' steps · started ' + esc(U.when(r.created)) + (r._conflicts && r._conflicts.length ? ' · <b style="color:var(--stop)">conflict copy found</b>' : '') + ((ctx.state.missing || {})[runKey(r)] ? ' · <b style="color:var(--stop)">its file is gone from the team folder</b>' : '') + '</span></button>';
  }
  var SKILL_PILL = { current: ['passed', 'current'], unaffected: ['open', 'note version'], update: ['failed', 'needs update'], missing: ['failed', 'check it'] };
  function allTags(ctx) {
    var all = [];
    ctx.processes().forEach(function (p) { (p.tags || []).forEach(function (t) { if (all.indexOf(t) < 0) all.push(t); }); p.skills.forEach(function (x) { (x.skill.tags || []).forEach(function (t) { if (all.indexOf(t) < 0) all.push(t); }); }); });
    return all.sort();
  }
  /* Only tags some skill carries, plus any already chosen so it can be cleared. */
  function skillTags(skills, chosen) {
    var all = chosen.slice();
    skills.forEach(function (k) { (k.x.skill.tags || []).forEach(function (t) { if (all.indexOf(t) < 0) all.push(t); }); });
    return all.sort();
  }
  function hasTags(ctx) { var chosen = ctx.state.tags || []; return function (tags) { return chosen.every(function (t) { return (tags || []).indexOf(t) >= 0; }); }; }
  /* id: a heading that takes focus when the page opens (page-h). */
  function pageHead(eyebrow, title, sub, actions, id) {
    return '<div class="runhead"><div><div class="eyebrow">' + eyebrow + '</div><h1' + (id ? ' id="' + id + '" tabindex="-1"' : '') + '>' + title + '</h1>' + (sub ? '<div class="small">' + sub + '</div>' : '') + '</div>' + (actions ? '<div class="row">' + actions + '</div>' : '') + '</div>';
  }

  /* A plan's time, or null when it has none or it can't be read. */
  function whenOf(p) { var t = typeof p.when === 'string' ? Date.parse(p.when) : NaN; return isNaN(t) ? null : t; }
  /* Soonest first; plans without a time after them, oldest first. */
  function byWhen(plans) {
    return plans.slice().sort(function (a, b) {
      var x = whenOf(a), y = whenOf(b);
      if (x != null && y != null && x !== y) return x - y;
      if ((x == null) !== (y == null)) return x == null ? 1 : -1;
      return String(a.created || '') < String(b.created || '') ? -1 : String(a.created || '') > String(b.created || '') ? 1 : 0;
    });
  }

  /* ---------- Home: only what needs this person, each with one obvious next step ---------- */
  function home(ctx) {
    var st = ctx.state, d = ctx.data, me = st.me, items = [];
    var add = function (kind, title, sub, act, id, label) { items.push('<li class="todo ' + kind + '"><div><b>' + title + '</b>' + (sub ? '<div class="small">' + sub + '</div>' : '') + '</div><button class="btn" data-act="' + act + '" data-id="' + esc(id) + '">' + esc(label) + '</button></li>'); };
    /* Folder problems that need a person come first, with one way to see them all. */
    var hr = ctx.health ? ctx.health(false) : null, stops = hr ? hr.issues.filter(function (i) { return i.severity === 'stop'; }) : [];
    if (stops.length) add('health', 'The team folder needs attention', esc(stops[0].title) + (stops.length > 1 ? ', and ' + (stops.length - 1) + ' more' : '') + '.', 'health', '', 'Open Folder health');
    if (me) d.runs.filter(function (r) { return r.state === 'running'; }).forEach(function (r) {
      var map = R.mapOf(r), hl = R.headline(r, map), nx = R.myNext(r, map, me);
      if (r.recorder.person === me) add('run', esc(r.title) + ': you\'re recording', esc(hl.text), 'open-run', runKey(r), 'Open the run');
      else if (nx) add('run', esc(r.title) + ': you\'re up', esc(nx.step.text) + ' · ' + esc(nameOf(ctx, r.recorder.person)) + ' is recording', 'open-run', runKey(r), 'Open the run');
    });
    /* A plan with a time shows here from 24 hours before it; one without a time shows until someone decides on it. */
    var now = ctx.now(), clash = 'Two decisions on it disagree; check Runs before starting it.';
    byWhen(d.plans.filter(function (p) { return !p._status; })).forEach(function (p) {
      var t = whenOf(p);
      if (t == null) add('plan', esc(p.by ? nameOf(ctx, p.by) : 'Your AI assistant') + ' planned "' + esc(p.title) + '"', p._conflicting ? clash : 'Review it before it starts.', 'review-plan', p.id, 'Review the plan');
      else if (t - now <= 86400000) add('plan', esc(p.title) + ' is planned for ' + esc(U.dueWords(p.when, now)), p._conflicting ? clash : 'Planned by ' + esc(p.by ? nameOf(ctx, p.by) : 'an AI assistant') + '.', 'review-plan', p.id, 'Review and start');
    });
    (ctx.lostDrafts ? ctx.lostDrafts() : []).forEach(function (id) { add('draft', 'Unsaved edits to "' + esc(id) + '"', 'Its draft was removed from the folder. Save it again or copy it.', 'open-process', id, 'Open it'); });
    ctx.processes().forEach(function (p) {
      var owner = p.latest && p.latest.map.meta.owner;
      if (p.draft && p.draftChanged && (!owner || owner === me)) add('draft', esc(p.title) + ': the draft has unpublished changes', p.latest ? 'Publish it as v' + (p.latest.info.version + 1) + ' when it\'s ready.' : 'Not published yet.', 'open-process', p.id, 'Review and publish');
      if (p.staleSkills) add('skill', esc(p.title) + ': ' + p.staleSkills + ' skill' + (p.staleSkills === 1 ? ' needs' : 's need') + ' attention', 'The process changed since they were built.', 'open-process', p.id, 'See the skills');
      var signer = p.latest && owner ? PF.skills.signer(p.latest, d.people, me, !!(d.failed || {}).people) : '';
      if (signer && !PF.skills.signoffs(d.validations, p.latest).length && PF.skills.readiness(d.runs, p.latest, null).enough) add('sign', esc(p.title) + ' v' + p.latest.info.version + ' is ready for a skill', signer === 'backup' ? 'Enough clean runs. Its owner is away, so as backup owner, you sign it off.' : 'Enough clean runs. As its owner, you sign it off.', 'open-process', p.id, 'Sign it off');
    });
    var h = notices(ctx);
    if (st.fs && st.fs.kind === 'memory' && !st.needsReconnect) h += '<div class="notice"><span><b>You\'re looking at the examples</b>, a made-up team saved in this browser only. When you\'re ready, start or join your own team.</span><button class="btn" data-act="setup-mode" data-id="welcome">Start or join a team</button></div>';
    h += pageHead('Home', me ? 'Hi, ' + esc(nameOf(ctx, me).split(' ')[0]) : 'Welcome', me ? (items.length ? items.length + ' thing' + (items.length === 1 ? '' : 's') + ' need' + (items.length === 1 ? 's' : '') + ' you.' : 'Nothing needs you right now.') : 'Choose who you are at the top right to see what needs you.', '', 'page-h');
    if (V.setupHome) h += V.setupHome(ctx);
    if (items.length) h += '<section class="panel" aria-labelledby="todo-h"><h2 id="todo-h">Needs you</h2><ul class="todos">' + items.join('') + '</ul></section>';
    var running = d.runs.filter(function (r) { return r.state === 'running'; });
    h += '<section class="panel" aria-labelledby="go-h"><h2 id="go-h">At a glance</h2><div class="glance">' +
      '<button class="tile" data-act="nav" data-id="runs"><span class="big">' + running.length + '</span><span>running</span></button>' +
      '<button class="tile" data-act="nav" data-id="processes"><span class="big">' + ctx.processes().length + '</span><span>processes</span></button>' +
      '<button class="tile" data-act="nav" data-id="skills"><span class="big">' + ctx.processes().reduce(function (n, p) { return n + p.skills.length; }, 0) + '</span><span>skills</span></button>' +
      '<button class="tile" data-act="nav" data-id="types"><span class="big">' + (T.LIST.length + Object.keys((d.stepTypes || {}).types || {}).length) + '</span><span>step types</span></button></div></section>';
    var since = Date.now() - 30 * 86400000, fus = [];
    d.runs.forEach(function (r) { if (r.ended && new Date(r.ended.at) > since) (r.followUps || []).forEach(function (f) { fus.push({ f: f, r: r }); }); });
    if (fus.length) h += '<section class="panel"><h2>Follow-ups from recent runs</h2><ul class="fulist">' + fus.map(function (x) {
      return '<li><span>' + esc(x.f.text) + (x.f.ticket ? ' <span class="cat">' + esc(x.f.ticket) + '</span>' : '') + '</span><span class="small">' + (x.f.owner ? esc(nameOf(ctx, x.f.owner)) + ' · ' : '') + esc(x.r.title) + '</span></li>';
    }).join('') + '</ul></section>';
    return h;
  }

  /* ---------- Runs: everything running, planned and finished ---------- */
  function runs(ctx) {
    var st = ctx.state, d = ctx.data;
    var running = d.runs.filter(function (r) { return r.state === 'running' && (st.filter === 'all' || (!!st.me && (r.recorder.person === st.me || Object.keys(r.roles).some(function (k) { return r.roles[k] === st.me; })))); });
    var ended = d.runs.filter(function (r) { return r.state !== 'running'; }).sort(function (a, b) { return (b.ended && b.ended.at || '') < (a.ended && a.ended.at || '') ? -1 : 1; });
    var plans = byWhen(d.plans.filter(function (p) { return !p._status; })), now = ctx.now();
    var h = notices(ctx) + pageHead('Runs', 'Runs', 'Every run of every process. To start one, pick its process.', '<button class="btn go" data-act="nav" data-id="processes">' + I('play') + 'Start a run</button>');
    /* A run file that can't be read is listed, never left out: it may still be arriving, or need restoring. */
    var bad = (d.unreadable || []).filter(function (u) { return /^runs\//.test(u.path); });
    if (bad.length) h += '<div class="notice bad" role="alert"><span><b>' + (bad.length === 1 ? 'A run file can\'t be read' : bad.length + ' run files can\'t be read') + '.</b> ' + bad.slice(0, 3).map(function (u) { return '<code>' + esc(u.path) + '</code> ' + esc(u.why); }).join('; ') + (bad.length > 3 ? '; and ' + (bad.length - 3) + ' more' : '') + '. ' + (bad.some(function (u) { return ctx.findRun(u.key); }) ? 'What was read before is still shown. ' : '') + 'It may still be arriving.</span><span class="row"><button class="mini" data-act="health">Folder health</button><button class="mini" data-act="recovery" data-id="a-file-cant-be-read">What to do</button></span></div>';
    h += '<section class="panel"><div class="row between" style="margin-bottom:10px"><h2 style="margin:0">Running</h2><div class="filter" role="group" aria-label="Show runs"><button class="chipbtn" data-act="filter" data-id="mine" aria-pressed="' + (st.filter !== 'all') + '">Mine</button><button class="chipbtn" data-act="filter" data-id="all" aria-pressed="' + (st.filter === 'all') + '">Everyone</button></div></div>';
    h += '<div class="cards">' + (running.map(function (r) { return runCard(ctx, r); }).join('') || '<p class="muted">' + (st.filter === 'all' ? 'Nothing is running.' : 'Nothing you\'re recording or assigned to. Switch to Everyone to see the rest.') + '</p>') + '</div></section>';
    if (plans.length) h += '<section class="panel"><h2>Planned</h2><div class="cards">' + plans.map(function (p) {
      return '<button class="card plan" id="card-' + esc(p.id) + '" data-act="review-plan" data-id="' + esc(p.id) + '"><span class="cat">' + esc(ctx.processTitle(p.process)) + ' · planned by ' + esc(p.by ? nameOf(ctx, p.by) : 'an AI assistant') + '</span><span class="card-title">' + esc(p.title) + '</span>' + (whenOf(p) != null ? '<span class="small">' + esc(U.dueWords(p.when, now)) + '</span>' : '') + (p._conflicting ? '<span class="small" style="color:var(--stop)"><b>Two decisions on this plan disagree.</b> Someone may have started it already; check Runs before starting it again.</span>' : '') + (p.note ? '<span class="small">' + esc(p.note) + '</span>' : '') + '</button>';
    }).join('') + '</div></section>';
    h += '<section class="panel"><h2>Finished · ' + ended.length + '</h2>' + (ended.length ? '<div class="cards">' + ended.map(function (r) { return runCard(ctx, r); }).join('') + '</div>' : '<p class="small">No finished runs yet.</p>') +
      (d.legacy.length ? '<p class="small">From Flightdeck v0.1 (read-only files in <code>runs/</code>): ' + d.legacy.map(function (l) { return esc(l.name || l.file) + (l.ended ? ' (' + esc(l.ended.outcome || 'ended') + ')' : ''); }).join(', ') + '</p>' : '') + '</section>';
    return h;
  }

  /* ---------- Processes: the templates, in the team's hierarchy ---------- */
  function processesPage(ctx) {
    var st = ctx.state, procs = ctx.processes(), has = hasTags(ctx);
    var h = notices(ctx) + pageHead('Processes', 'Processes', 'Open one to run it or edit its checklist.', '<button class="btn go" data-act="new-process">' + I('edit') + 'New process</button>');
    (ctx.lostDrafts ? ctx.lostDrafts() : []).forEach(function (id) { h += '<div class="notice warn" role="status"><span>You have unsaved edits to <b>' + esc(id) + '</b>, whose draft was removed from the folder.</span><button class="mini" data-act="open-process" data-id="' + esc(id) + '">Open it</button></div>'; });
    h += '<section class="panel">' + K.tagBar(allTags(ctx), st.tags || []) + (procs.length ? K.tree(procs.filter(function (p) { return has(p.tags); }), function (p) { return p.group && p.group.length ? p.group : [p.category]; }, function (p) {
      var pub = p.latest, info = pub ? 'v' + pub.info.version + ' · published by ' + esc(nameOf(ctx, pub.info.publishedBy)) : 'not published yet';
      var flags = [];
      if (p.draftChanged) flags.push('draft changes');
      if (p.clashes.length) flags.push('version clash');
      /* Its skills by name, each with its status and a link to its own page. */
      var skills = p.skills.length ? '<div class="pskills"><span class="small">' + I('spark') + 'Skills</span>' + p.skills.map(function (x) {
        var pill = SKILL_PILL[x.status.s] || SKILL_PILL.missing;
        return '<button class="skillchip" data-act="open-skill" data-id="' + esc(x.skill.file || x.skill.name) + '">' + esc(x.skill.name) + ' <span class="pill ' + pill[0] + '">' + pill[1] + '</span></button>';
      }).join('') + '</div>' : '';
      return '<li><button data-act="open-process" data-id="' + esc(p.id) + '"><span class="t">' + esc(p.title) + '</span>' + (flags.length ? '<span class="small" style="color:var(--stop)">' + esc(flags.join(' · ')) + '</span>' : '<span></span>') + '<span class="small">' + info + (p.lastRun ? ' · last run ' + esc(U.day(p.lastRun)) : '') + '</span>' + K.tagChips(p.tags) + '</button>' + skills + '</li>';
    }, st.groupsOpen) : '<p class="small">No processes yet. Choose <b>New process</b>, or ask your AI assistant: <code>/flightdeck-new-checklist</code>.</p>') + '</section>';
    return h;
  }

  /* ---------- Skills: what they are, which need attention, and which processes are ready to become one ---------- */
  function skillRow(k) {
    var s = k.x.skill, pill = SKILL_PILL[k.x.status.s] || SKILL_PILL.missing;
    return '<li><button data-act="open-skill" data-id="' + esc(s.file || s.name) + '"><span class="t">' + I('spark') + esc(s.name) + (s.version ? ' <span class="small">' + esc(s.version) + '</span>' : '') + '</span><span class="pill ' + pill[0] + '">' + pill[1] + '</span><span class="small">' + (k.p.id ? 'Automates ' + esc(k.p.title) + ' v' + s.implements + (s.steps ? ' · ' + s.steps.length + ' step' + (s.steps.length === 1 ? '' : 's') : ' · the whole process') : esc(k.x.status.text)) + '</span>' + K.tagChips(s.tags) + '</button></li>';
  }
  function skillsPage(ctx) {
    var st = ctx.state, d = ctx.data, has = hasTags(ctx), skills = [], orphans = ctx.orphanSkills ? ctx.orphanSkills() : [];
    ctx.processes().forEach(function (p) { p.skills.forEach(function (x) { skills.push({ x: x, p: p }); }); });
    orphans.forEach(function (x) { if (!x.skill.name && x.skill.file) x.skill.name = x.skill.file; skills.push({ x: x, p: { id: '', title: 'No matching process', group: ['Not matched'], category: 'Not matched' } }); });
    var attention = skills.filter(function (k) { return k.x.status.s === 'update' || k.x.status.s === 'missing'; });
    var ready = ctx.processes().filter(function (p) { return p.latest && !p.skills.length && PF.skills.signoffs(d.validations, p.latest).length; });
    var h = notices(ctx) + pageHead('Skills', 'Skills', 'AI automations built from your processes.');
    if (d.skillsSkipped) h += '<div class="notice warn" role="status"><span><b>' + d.skillsSkipped + ' more skill registration' + (d.skillsSkipped === 1 ? ' wasn\'t' : 's weren\'t') + ' read.</b> Flightdeck reads the first 500 in <code>skills/</code>, by name.</span><button class="mini" data-act="health">Folder health</button></div>';
    /* The how-to is the page's job when there are no skills yet; after that it's a closed reference. */
    h += '<details class="panel"' + (skills.length ? '' : ' open') + '><summary><h2 style="display:inline">How a process becomes a skill</h2></summary><ol class="howto">' +
      '<li><b>Prove it.</b><span>Run a published version until it has 3 clean runs.</span></li>' +
      '<li><b>Sign it off.</b><span>The process owner confirms the version is ready.</span></li>' +
      '<li><b>Brief your AI assistant.</b><span>Copy the brief from the process page; your AI assistant builds the skill.</span></li>' +
      '<li><b>Register it.</b><span>Your AI assistant adds <code>skills/&lt;name&gt;.json</code>: where it lives, what it implements.</span></li>' +
      '<li><b>Stay in step.</b><span>When the process changes, the skill shows here as needing an update, with a brief.</span></li></ol></details>';
    if (attention.length) h += '<section class="panel" aria-labelledby="att-h"><h2 id="att-h">Needs an update · ' + attention.length + '</h2><p class="small">Their process changed. Open one to copy the update brief.</p><ul class="plist">' + attention.map(skillRow).join('') + '</ul></section>';
    /* A signed-off version that no skill implements yet: the one action is to brief the AI assistant. */
    if (ready.length) h += '<section class="panel" aria-labelledby="rdy-h"><h2 id="rdy-h">Ready to become a skill · ' + ready.length + '</h2><ul class="rlist">' + ready.map(function (p) {
      return '<li><div class="row"><button class="link t" data-act="open-process" data-id="' + esc(p.id) + '">' + esc(p.title) + ' v' + p.latest.info.version + '</button><button class="btn go" data-act="copy-brief" data-id="create:' + esc(p.id) + '">' + I('copy') + 'Copy brief</button></div>' + V.briefBox(st, 'create:' + p.id) + '</li>';
    }).join('') + '</ul></section>';
    h += '<section class="panel" aria-labelledby="all-h"><h2 id="all-h">All skills · ' + skills.length + '</h2>' + K.tagBar(skillTags(skills, st.tags || []), st.tags || []) + (skills.length ? K.tree(skills.filter(function (k) { return has(k.x.skill.tags); }), function (k) { return k.x.skill.group.length ? k.x.skill.group : (k.p.group && k.p.group.length ? k.p.group : [k.p.category || 'Other']); }, skillRow, st.groupsOpen)
      : '<p class="small">No skills yet. Follow the steps above: once a process version is signed off, its page has the brief your AI assistant needs.</p>') + '</section>';
    return h;
  }

  V.planWhen = whenOf; V.home = home; V.runs = runs; V.processesPage = processesPage; V.skillsPage = skillsPage; V.pageHead = pageHead;
})();
