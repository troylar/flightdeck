/* Home (what needs me), Runs, Processes and Skills: the top-level pages. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, R = PF.run, M = PF.map, T = PF.types, I = PF.icons.icon, esc = U.esc;
  var person = K.person, nameOf = K.nameOf, avatar = K.avatar, notices = K.notices, ago = K.ago, runKey = K.runKey, freshness = K.freshness;
  /* ---------- home ---------- */
  function runCard(ctx, r) {
    var map = R.mapOf(r), hl = K.headline(r, map), t = R.totals(r, map);
    return '<button class="card" data-act="open-run" data-id="' + esc(runKey(r)) + '"><div class="row between"><span class="cat">' + esc(ctx.processTitle(r.process)) + K.testTag(r) + '</span>' + avatar(ctx, r.recorder.person) + '</div>' +
      '<span class="card-title">' + esc(r.title) + '</span><span class="state ' + hl.s + '">' + esc(K.hlText(r, hl)) + '</span>' +
      (r.ended ? '' : '<div class="bar" aria-hidden="true"><i style="width:' + (t.total ? Math.round(100 * t.done / t.total) : 0) + '%"></i></div>') +
      '<span class="small">' + t.done + ' of ' + t.total + ' steps · started ' + esc(U.when(r.created)) + (r._conflicts && r._conflicts.length ? ' · <b style="color:var(--stop)">conflict copy found</b>' : '') + ((ctx.state.missing || {})[runKey(r)] ? ' · <b style="color:var(--stop)">its file is gone from the team folder</b>' : '') + '</span></button>';
  }
  /* Home's lists are a glance: 10 at a time, each linking to its full page (2.11). */
  var HOME_PAGE = 10;
  /* A Processes row shows this many skill chips (2.11). */
  var CHIPS = 5;
  var SKILL_PILL = { current: ['passed', 'current'], unaffected: ['open', 'note version'], update: ['failed', 'needs update'], missing: ['failed', 'check it'], unmatched: ['failed', 'can\'t be matched'] };
  /* Every tag in use, plus any chosen (a newer read may have taken it off every checklist, and Clear must stay), by name. */
  function allTags(ctx, chosen) {
    var all = (chosen || []).slice();
    ctx.processes().forEach(function (p) { (p.tags || []).forEach(function (t) { if (all.indexOf(t) < 0) all.push(t); }); p.skills.forEach(function (x) { (x.skill.tags || []).forEach(function (t) { if (all.indexOf(t) < 0) all.push(t); }); }); });
    return all.sort(PF.text.natural);
  }
  /* Only tags some skill carries, plus any already chosen so it can be cleared. */
  function skillTags(skills, chosen) {
    var all = chosen.slice();
    skills.forEach(function (k) { (k.x.skill.tags || []).forEach(function (t) { if (all.indexOf(t) < 0) all.push(t); }); });
    return all.sort(PF.text.natural);
  }
  function hasTags(ctx) { var chosen = ctx.state.tags || []; return function (tags) { return chosen.every(function (t) { return (tags || []).indexOf(t) >= 0; }); }; }
  /* id: the heading that takes focus when the page opens (page-h unless given; Back and Forward focus it too). */
  function pageHead(eyebrow, title, sub, actions, id) {
    return '<div class="runhead"><div><div class="eyebrow">' + eyebrow + '</div><h1 id="' + (id || 'page-h') + '" tabindex="-1">' + title + '</h1>' + (sub ? '<div class="small">' + sub + '</div>' : '') + '</div>' + (actions ? '<div class="row">' + actions + '</div>' : '') + '</div>';
  }

  /* A plan's time, or null when it has none or it can't be read. */
  function whenOf(p) { var t = typeof p.when === 'string' ? Date.parse(p.when) : NaN; return isNaN(t) ? null : t; }
  /* Who asked for a plan: a person (or an assistant) planned it; another app's request names its tool, as a claim. */
  function plannedBy(ctx, p) {
    var c = PF.requests.claim(p);
    return c ? 'requested by ' + c.name + ', by its own account' : 'planned by ' + (p.by ? nameOf(ctx, p.by) : 'an AI assistant');
  }
  /* OneDrive kept more than one file of this plan: the same plan (shown once), or copies that differ (none can start). HTML. */
  function copiesLine(p) {
    var what = PF.requests.claim(p) ? 'request' : 'plan';
    if (p._copiesDiffer) return '<b>Two different copies of this ' + what + ' are in the folder.</b> Neither can be started until a person deletes one.';
    return p._copies > 1 ? 'This ' + what + ' arrived ' + (p._copies === 2 ? 'twice' : p._copies + ' times') + ' (OneDrive kept a copy). It\'s shown once.' : '';
  }
  /* Soonest first; plans without a time after them, oldest first. */
  function byWhen(plans) {
    return plans.slice().sort(function (a, b) {
      var x = whenOf(a), y = whenOf(b);
      if (x != null && y != null && x !== y) return x - y;
      if ((x == null) !== (y == null)) return x == null ? 1 : -1;
      return String(a.created || '') < String(b.created || '') ? -1 : String(a.created || '') > String(b.created || '') ? 1 : 0;
    });
  }

  /* While the first read of a folder is still under way (docs/design.md section 25): how far it's got, and, on Home, that a
     run being recorded may not be listed yet, since the runs read first are the ones already known to be running. */
  function stillReading(ctx, home) {
    var rd = ctx.state.reading; if (!rd) return '';
    var n = function (x) { return Number(x).toLocaleString('en-US'); };
    return '<div class="notice" role="status" id="reading"><span><b>Still reading runs' + (rd.total != null ? ' (' + n(rd.done) + ' of ' + n(rd.total) + ')' : '') + '.</b>' +
      (home ? ' Runs you\'re recording may not be listed yet.' : ' Runs not read yet aren\'t listed.') + '</span></div>';
  }

  /* ---------- Home: only what needs this person, each with one obvious next step ---------- */
  function home(ctx) {
    var st = ctx.state, d = ctx.data, me = st.me, items = [];
    /* Each row is a light descriptor (2.11): what it says (text(), returning its title and line as HTML) is worked out only
       for the rows drawn, 10 at a time; whether it's there at all is decided here, for the count. */
    var add = function (kind, text, act, id, label) { items.push({ kind: kind, text: text, act: act, id: id, label: label }); };
    /* A row's id is from what it is (its kind, action, item and label), never its place, so a row sorting in above it never
       turns the row someone is on into another (2.11). */
    var todo = function (x) { PF.perf.add('home.todo'); var t = x.text(), d = 'todo-' + K.domKey(x.key); return '<li class="todo ' + x.kind + '" id="' + d + '"><div><b id="' + d + '-t" tabindex="-1">' + t[0] + '</b>' + (t[1] ? '<div class="small">' + t[1] + '</div>' : '') + '</div><button class="btn" id="' + d + '-go" data-act="' + x.act + '" data-id="' + esc(x.id) + '">' + esc(x.label) + '</button></li>'; };
    /* Folder problems that need a person come first, with one way to see them all. */
    var hr = ctx.health ? ctx.health(false) : null, stops = hr ? hr.issues.filter(function (i) { return i.severity === 'stop'; }) : [];
    if (stops.length) add('health', function () { return ['The team folder needs attention', esc(stops[0].title) + (stops.length > 1 ? ', and ' + (stops.length - 1) + ' more' : '') + '.']; }, 'health', '', 'Open Folder health');
    var repWait = me && ctx.reportsWaiting ? ctx.reportsWaiting() : {};
    if (me) d.runs.filter(function (r) { return r.state === 'running'; }).forEach(function (r) {
      var mine = r.recorder.person === me, map = R.mapOf(r), nx = mine ? null : R.myNext(r, map, me), nr = Object.prototype.hasOwnProperty.call(repWait, runKey(r)) ? repWait[runKey(r)] : 0;
      var tt = R.isTest(r) ? 'Test run · ' : '';
      if (mine) add('run', function () { return [tt + esc(r.title) + ': you\'re recording', esc(K.headline(r, map).text)]; }, 'open-run', runKey(r), 'Open the run');
      else if (nx) add('run', function () { return [tt + esc(r.title) + ': you\'re up', K.stepHtml(nx.step, K.refValue(r, map), false) + ' · ' + esc(nameOf(ctx, r.recorder.person)) + ' is recording']; }, 'open-run', runKey(r), 'Open the run');
      if (mine && nr) add('run', function () { return [nr + ' report' + (nr === 1 ? '' : 's') + ' to review on ' + esc(r.title), 'A tool says it did ' + (nr === 1 ? 'a step' : 'steps') + '. Accept or decline ' + (nr === 1 ? 'it' : 'each') + ' on the step.']; }, 'open-run', runKey(r), 'Review');
    });
    /* A plan with a time shows here from 24 hours before it; one without a time shows until someone decides on it. */
    var now = ctx.now(), clash = 'Two decisions on it disagree; check Runs before starting it.';
    byWhen(d.plans.filter(function (p) { return !p._status && !p._decidedEarlier; })).forEach(function (p) {
      var t = whenOf(p), c = PF.requests.claim(p), flag = p._conflicting ? clash : p._copiesDiffer ? copiesLine(p) : null;
      if (t == null) add('plan', function () { return [c ? esc(c.name) + ' requested "' + esc(p.title) + '" (by its own account)' : esc(p.by ? nameOf(ctx, p.by) : 'Your AI assistant') + ' planned "' + esc(p.title) + '"', flag || 'Review it before it starts.']; }, 'review-plan', p.id, 'Review the plan');
      else if (t - now <= 86400000) add('plan', function () { return [esc(p.title) + ' is planned for ' + esc(U.dueWords(p.when, now)), flag || (c ? 'Requested by ' + esc(c.name) + ', by its own account.' : 'Planned by ' + esc(p.by ? nameOf(ctx, p.by) : 'an AI assistant') + '.')]; }, 'review-plan', p.id, 'Review and start');
    });
    (ctx.lostDrafts ? ctx.lostDrafts() : []).forEach(function (id) { add('draft', function () { return ['Unsaved edits to "' + esc(id) + '"', 'Its draft was removed from the folder. Save it again or copy it.']; }, 'open-process', id, 'Open it'); });
    ctx.processes().forEach(function (p) {
      var owner = p.latest && p.latest.map.meta.owner, mine = K.keeps(ctx, p);
      /* A draft and skills that need attention go to whoever looks after the checklist (K.keepers); to everyone when nobody does. */
      if (p.draft && p.draftChanged && mine) add('draft', function () { return [esc(p.title) + ': the draft has unpublished changes', p.latest ? 'Publish it as v' + (p.latest.info.version + 1) + ' when it\'s ready.' : 'Not published yet.']; }, 'open-process', p.id, 'Review and publish');
      if (p.staleSkills && mine) add('skill', function () { return [esc(p.title) + ': ' + p.staleSkills + ' skill' + (p.staleSkills === 1 ? ' needs' : 's need') + ' attention', 'The checklist changed since they were built.']; }, 'open-process', p.id, 'See the skills');
      var signer = p.latest && owner ? PF.skills.signer(p.latest, d.people, me, !!(d.failed || {}).people) : '';
      if (signer && !PF.skills.signoffs(d.validations, p.latest).length && !PF.skills.signUnknown(d, p.latest) && PF.skills.readiness(ctx.countedRuns ? ctx.countedRuns(p.latest.map.meta.process) : d.runs, p.latest, null).enough) add('sign', function () { return [esc(p.title) + ' v' + p.latest.info.version + ' is ready for a skill', signer === 'backup' ? 'Enough clean runs. Its owner is away, so as backup owner, you sign it off.' : 'Enough clean runs. As its owner, you sign it off.']; }, 'open-process', p.id, 'Sign it off');
    });
    var h = notices(ctx);
    if (st.needsReconnect && ctx.navPending && ctx.navPending()) h += '<div class="notice" role="status"><span>Reconnect to open the page you linked to.</span><button class="mini" data-act="reconnect">Reconnect</button></div>';
    if (st.fs && st.fs.kind === 'memory' && !st.needsReconnect) h += '<div class="notice"><span><b>You\'re looking at the examples</b>, a made-up team saved in this browser only. When you\'re ready, start or join your own team.</span><button class="btn" data-act="setup-mode" data-id="welcome">Start or join a team</button></div>';
    h += pageHead('Home', me ? 'Hi, ' + esc(nameOf(ctx, me).split(' ')[0]) : 'Welcome', me ? (items.length ? items.length + ' thing' + (items.length === 1 ? '' : 's') + ' need' + (items.length === 1 ? 's' : '') + ' you.' : st.reading ? 'Still reading the team folder.' : 'Nothing needs you right now.') : '', '', 'page-h');
    h += stillReading(ctx, true);
    if (V.setupHome) h += V.setupHome(ctx);
    K.uniqKeys(items, function (x) { return [x.kind, x.act, x.id, x.label].join('\n'); }).forEach(function (k, i) { items[i].key = k; });
    if (items.length) h += '<section class="panel" aria-labelledby="todo-h"><h2 id="todo-h">Needs you</h2>' + K.list(st, 'home-todo', items, { draw: function (shown) { return '<ul class="todos">' + shown.map(todo).join('') + '</ul>'; }, keyOf: function (x) { return x.key; }, focusOf: function (k) { return '#todo-' + K.domKey(k) + '-t'; }, page: HOME_PAGE }) + '</section>';
    h += acksPanel(ctx);
    h += myFollowUps(ctx);
    /* Test runs (2.1) are never counted as real runs. */
    var running = d.runs.filter(function (r) { return r.state === 'running' && !R.isTest(r); });
    h += '<section class="panel" aria-labelledby="go-h"><h2 id="go-h">At a glance</h2><div class="glance">' +
      '<button class="tile" data-act="nav" data-id="runs"><span class="big">' + running.length + '</span><span>running</span></button>' +
      /* Versions arrive with the first complete read, so until then the count isn't known. */
      '<button class="tile" data-act="nav" data-id="processes"><span class="big">' + (st.reading ? '…' : ctx.processes().length) + '</span><span>checklists</span></button></div></section>';
    return h;
  }

  /* Quiet news about this person's own corrections: published in a version, or declined by someone else. Each has View
     change and Dismiss (remembered in this browser). It never counts as something that needs them. */
  function acksPanel(ctx) {
    var me = ctx.state.me, C = PF.corrections;
    var list = ctx.acks ? ctx.acks() : me ? [].concat.apply([], ctx.processes().map(function (p) { return C.acks(V.corrGroups(ctx, p.id), me, null); })) : [];
    if (!list.length) return '';
    var stepName = function (g) { return '"' + C.targetName(g) + '"'; };
    /* Each row by its acknowledgment's key (what Dismiss remembers), never its place. */
    var rows = list.map(function (a) { return { a: a }; });
    K.uniqKeys(list, function (a) { return a.key; }).forEach(function (k, i) { rows[i].key = k; rows[i].d = 'ack-' + K.domKey(k); });
    return '<section class="panel" aria-labelledby="ack-h"><h2 id="ack-h">Your corrections</h2>' + K.list(ctx.state, 'home-acks', rows, { page: HOME_PAGE, keyOf: function (x) { return x.key; }, focusOf: function (k) { return '#ack-' + K.domKey(k) + '-t'; }, draw: function (shown) { return '<ul class="todos">' + shown.map(function (x) {
      var a = x.a;
      var gs = a.groups || [a.group], title;
      /* Plain text, escaped once where it's used. */
      if (a.kind === 'landed') title = gs.length === 1 ? 'Your correction to ' + stepName(gs[0]) + ' is published in v' + a.version + '.'
        : 'Your corrections to ' + stepName(gs[0]) + (gs.length === 2 ? ' and ' + stepName(gs[1]) : ' and ' + (gs.length - 1) + ' other steps') + ' are published in v' + a.version + '.';
      else title = nameOf(ctx, a.by) + ' declined your correction: ' + a.reason;
      var sub = ctx.processTitle(a.process) + (a.kind === 'declined' ? ' · ' + stepName(a.group) : '');
      return '<li class="todo ack ' + a.kind + '" id="' + x.d + '"><div><b id="' + x.d + '-t" tabindex="-1">' + esc(title) + '</b><div class="small">' + esc(sub) + '</div></div><span class="row"><button class="btn" data-act="ack-view" data-id="' + esc(a.key) + '" data-process="' + esc(a.process) + '" data-group="' + esc(a.group ? a.group.id : a.groups && a.groups[0] ? a.groups[0].id : '') + '">View change</button>' +
        '<button class="mini" data-act="ack-dismiss" data-id="' + esc(a.key) + '" aria-label="Dismiss: ' + esc(title) + '">Dismiss</button></span></li>';
    }).join('') + '</ul>'; } }) + '</section>';
  }

  /* Open follow-ups this person owns, however old; resolved ones drop off. Like acknowledgments, never counted in Needs you. */
  function myFollowUps(ctx) {
    var me = ctx.state.me, all = V.fuList(ctx), mine = PF.followups.mine(all, me), open = all.filter(PF.followups.isOpen).length;
    if (!mine.length && !(ctx.state.fuPick && ctx.state.view === 'home')) return open ? '<p class="small fu-all"><button class="linkish" data-act="nav" data-id="followups">All open follow-ups · ' + open + '</button></p>' : '';
    return '<section class="panel" aria-labelledby="fu-home-h"><div class="row between"><h2 id="fu-home-h">Your follow-ups · ' + mine.length + '</h2><button class="mini" data-act="nav" data-id="followups">All open follow-ups · ' + open + '</button></div>' +
      V.fuPaged(ctx, 'home-fu', mine, all, { page: HOME_PAGE }) + '</section>';
  }

  /* ---------- Runs › Follow-ups: every follow-up across runs, and what became of it ---------- */
  function followUpsPage(ctx) {
    var st = ctx.state, me = st.me, all = V.fuList(ctx), F = PF.followups, filter = st.fuFilter === 'mine' || st.fuFilter === 'all' ? st.fuFilter : 'open';
    var open = all.filter(F.isOpen), mine = F.mine(all, me);
    /* Oldest open first: what's waited longest is what most needs a decision. Everything else newest first. */
    var shown = filter === 'all' ? all.slice().reverse() : filter === 'mine' ? mine : open;
    var h = notices(ctx) + '<nav class="small fu-crumbs" aria-label="Breadcrumb"><button class="linkish" data-act="nav" data-id="runs">Runs</button> › Follow-ups</nav>' +
      pageHead('Runs', 'Follow-ups', 'Work runs turned up that outlives them. Anyone on the team can say what became of one: done, moved to a ticket or another run, or won\'t do.', '', 'page-h');
    h += '<section class="panel"><div class="row between" style="margin-bottom:10px"><h2 id="fu-list-h" tabindex="-1" style="margin:0">' + (filter === 'all' ? 'Every follow-up · ' + all.length : filter === 'mine' ? 'Open and yours · ' + mine.length : 'Open · ' + open.length) + '</h2>' +
      '<div class="filter" role="group" aria-label="Show follow-ups">' + [['open', 'Open'], ['mine', 'Yours'], ['all', 'All']].map(function (f) { return '<button class="chipbtn" data-act="fu-filter" data-id="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '">' + f[1] + '</button>'; }).join('') + '</div></div>';
    if (!me && shown.length) h += '<p class="small">Choose who you are at the top right to say what became of a follow-up.</p>';
    /* Find a follow-up (2.11): by its text, its run, its owner and its step, over the chip's whole list; 50 at a time. */
    var q = K.findQ(st, 'fu'), hit = K.finds(q), stepOf = function (x) { if (!x.f.step) return ''; var r = ctx.findRun ? ctx.findRun(x.runKey) : null, y = r ? M.findStep(R.mapOf(r), x.f.step) : null; return y ? K.stepPlain(y.step, null) : x.f.step; };
    var found = q ? shown.filter(function (x) { return hit([x.text, x.runTitle, x.owner ? nameOf(ctx, x.owner) : '', x.f.ticket, stepOf(x)]); }) : shown;
    /* With no match, the count says which chip applies too, and "No other" beside the row kept for its open form. */
    var fuRows = V.fuPaged(ctx, 'fu', found, all);
    if (K.findOn(st, 'fu', shown.length > 0)) h += K.findBox(st, 'fu', 'Find a follow-up', found.length, shown.length, 'follow-up', { by: filter === 'all' ? '' : filter === 'mine' ? 'with Yours on' : 'with Open on', kept: !found.length && !!fuRows });
    h += fuRows || (shown.length ? '' : '<p class="muted">' + (filter === 'all' ? 'No run has follow-ups yet. The recorder adds them while finishing a run.' : filter === 'mine' ? (me ? 'Nothing open is yours.' : 'Choose who you are to see yours.') : 'Nothing is open. Every follow-up has been dealt with.') + '</p>');
    return h + '</section>';
  }

  /* ---------- Runs: everything running, planned and finished ---------- */
  function runs(ctx) {
    var st = ctx.state, d = ctx.data;
    var running = d.runs.filter(function (r) { return r.state === 'running' && (st.filter === 'all' || (!!st.me && (r.recorder.person === st.me || Object.keys(r.roles).some(function (k) { return r.roles[k] === st.me; })))); });
    var ended = d.runs.filter(function (r) { return r.state !== 'running'; }).sort(function (a, b) { return (b.ended && b.ended.at || '') < (a.ended && a.ended.at || '') ? -1 : 1; });
    var plans = byWhen(d.plans.filter(function (p) { return !p._status; })), now = ctx.now();
    var h = notices(ctx) + pageHead('Runs', 'Runs', 'Every run of every checklist.', (function () { var n = V.fuList(ctx).filter(PF.followups.isOpen).length; return '<button class="btn" data-act="nav" data-id="followups">' + I('flag') + 'Follow-ups' + (n ? ' · ' + n + ' open' : '') + '</button>'; })() +
      '<details class="rw-menu" data-disc="runs-more"' + ((st.disc || {})['runs-more'] ? ' open' : '') + '><summary class="mini">More</summary><div class="rw-menu-list"><button class="mini" data-act="ev-range">' + I('doc') + 'Export evidence…</button></div></details><button class="btn go" data-act="nav" data-id="processes">' + I('play') + 'Start a run</button>');
    /* A run file that can't be read is listed, never left out: it may still be arriving, or need restoring. */
    h += stillReading(ctx, false);
    var bad = (d.unreadable || []).filter(function (u) { return /^runs\//.test(u.path); });
    if (bad.length) h += '<div class="notice bad" role="alert"><span><b>' + (bad.length === 1 ? 'A run file can\'t be read' : bad.length + ' run files can\'t be read') + '.</b> ' + bad.slice(0, 3).map(function (u) { return '<code>' + esc(u.path) + '</code> ' + esc(u.why); }).join('; ') + (bad.length > 3 ? '; and ' + (bad.length - 3) + ' more' : '') + '. ' + (bad.some(function (u) { return ctx.findRun(u.key); }) ? 'What was read before is still shown. ' : '') + 'It may still be arriving.</span><span class="row"><button class="mini" data-act="health">Folder health</button><button class="mini" data-act="recovery" data-id="a-file-cant-be-read">What to do</button></span></div>';
    var cards = function (list) { return '<div class="cards">' + list.map(function (r) { return runCard(ctx, r); }).join('') + '</div>'; };
    /* A filter or the runs behind a number in How runs go (views/insights.js) replace the lists below. */
    /* A plan just saved (2.11) is shown at the top, above the filters, whatever they or a cohort from How runs go leave out,
       until you leave Runs; it has the card's id there. */
    var cardIds = Object.create(null), jp = st.justPlanned ? d.plans.filter(function (p) { return p.id === st.justPlanned.id; })[0] : null;
    if (jp) h += '<section class="panel just-planned" aria-labelledby="jp-h"><h2 id="jp-h">Just planned</h2><div class="cards">' + planCard(jp, '') + '</div></section>';
    var cohort = st.runFilter && st.runFilter.cohort, only = V.runsFiltered(ctx, cards);
    if (!cohort) h += V.runsFilterBar(ctx);
    if (only) return h + only;
    h += '<section class="panel"><div class="row between" style="margin-bottom:10px"><h2 style="margin:0">Running</h2><div class="filter" role="group" aria-label="Show runs"><button class="chipbtn" data-act="filter" data-id="mine" aria-pressed="' + (st.filter !== 'all') + '">Mine</button><button class="chipbtn" data-act="filter" data-id="all" aria-pressed="' + (st.filter === 'all') + '">Everyone</button></div></div>';
    h += (running.length ? K.paged(st, 'runs-running', running, cards, runKey) : '<div class="cards"><p class="muted">' + (st.reading ? 'None read yet.' : st.filter === 'all' ? 'Nothing is running.' : 'Nothing you\'re recording or assigned to. Switch to Everyone to see the rest.') + '</p></div>') + '</section>';
    /* 50 at a time, soonest first (2.11). Copies of one plan that differ are each shown; only the first keeps the card's id, so
       ids stay unique, and none does while the plan is in Just planned above. */
    var nth = Object.create(null);
    var planKeyed = plans.map(function (p) { nth[p.id] = (nth[p.id] || 0) + 1; return { p: p, key: U.nthKey(p.id, nth[p.id]) }; });
    if (plans.length) h += '<section class="panel" aria-labelledby="planned-h"><h2 id="planned-h">Planned · ' + plans.length.toLocaleString('en-US') + '</h2>' + K.list(st, 'runs-planned', planKeyed, { keyOf: function (x) { return x.key; }, focusOf: function (k) { return '[data-act="review-plan"][data-key="' + K.cssStr(k) + '"]'; }, draw: function (shown) { return '<div class="cards">' + shown.map(function (x) { return planCard(x.p, x.key); }).join('') + '</div>'; } }) + '</section>';
    function planCard(p, key) {
      var cid = cardIds[p.id] ? '' : ' id="card-' + esc(p.id) + '"', copies = copiesLine(p);
      cardIds[p.id] = true;
      return '<button class="card plan"' + cid + ' data-act="review-plan" data-id="' + esc(p.id) + '"' + (key ? ' data-key="' + esc(key) + '"' : '') + '><span class="cat">' + esc(ctx.processTitle(p.process)) + ' · ' + esc(plannedBy(ctx, p)) + '</span><span class="card-title">' + esc(p.title) + '</span>' + (whenOf(p) != null ? '<span class="small">' + esc(U.dueWords(p.when, now)) + '</span>' : '') + (p._conflicting ? '<span class="small" style="color:var(--stop)"><b>Two decisions on this plan disagree.</b> Someone may have started it already; check Runs before starting it again.</span>' : '') + (p._decidedEarlier && !p._conflicting ? '<span class="small">' + esc(V.earlierWords(p, d)) + '</span>' : '') + (copies ? '<span class="small"' + (p._copiesDiffer ? ' style="color:var(--stop)"' : '') + '>' + copies + '</span>' : '') + (p.note ? '<span class="small">' + esc(p.note) + '</span>' : '') + '</button>';
    }
    /* The newest 8 finished runs, and any run with a warning; the rest one click away, remembered. */
    var warned = function (r) { return (r._conflicts && r._conflicts.length) || (st.missing || {})[runKey(r)]; };
    var flagged = ended.filter(function (r, i) { return i >= 8 && warned(r); }), older = ended.filter(function (r, i) { return i >= 8 && !warned(r); }), allOpen = (st.disc || {})['runs-older'];
    h += '<section class="panel"><h2>Finished · ' + ended.length + '</h2>' + (ended.length ? cards(ended.slice(0, 8)) + (flagged.length ? K.paged(st, 'runs-flagged', flagged, cards, runKey) : '') + (older.length ? '<details data-disc="runs-older"' + (allOpen ? ' open' : '') + '><summary class="small">Earlier finished runs (' + older.length + ')</summary>' + K.paged(st, 'runs-ended', older, cards, runKey) + '</details>' : '') : '<p class="small">' + (st.reading ? 'None read yet.' : 'No finished runs yet.') + '</p>') +
      (d.legacy.length ? K.joined(st, 'legacy', d.legacy, function (l) { return esc(l.name || l.file) + (l.ended ? ' (' + esc(l.ended.outcome || 'ended') + ')' : ''); }, { lead: 'From Flightdeck v0.1 (read-only files in <code>runs/</code>): ', noun: 'run' }) : '') + '</section>';
    return h;
  }

  /* The tag filter, as a Find box's count says it applies too. */
  function tagWords(chosen) { return !chosen.length ? '' : chosen.length === 1 ? 'with the tag you chose' : 'with the tags you chose'; }
  /* ---------- Processes: the templates, in the team's hierarchy ---------- */
  function processesPage(ctx) {
    var st = ctx.state, procs = ctx.processes(), has = hasTags(ctx);
    var h = notices(ctx) + (st.renamed ? '' : '<p class="notice renamed" role="note"><span>Checklists were called Processes before 2.10.</span><button type="button" class="mini" data-act="renamed-ok">Got it</button></p>') + pageHead('Checklists', 'Checklists', 'Open one to start it or edit it.', '<button class="mini" data-act="nav" data-id="skills">' + I('spark') + 'Skills</button><button class="mini" data-act="nav" data-id="types">Step types</button><button class="btn go" data-act="new-process">' + I('edit') + 'New checklist</button>');
    /* More than one is one notice, announced once, with a way to each in a fold 50 at a time (2.11); every editor's text is kept. */
    var lost = ctx.lostDrafts ? ctx.lostDrafts() : [];
    if (lost.length === 1) h += '<div class="notice warn" role="status"><span>You have unsaved edits to <b>' + esc(lost[0]) + '</b>, whose draft was removed from the folder.</span><button class="mini" data-act="open-process" data-id="' + esc(lost[0]) + '">Open it</button></div>';
    else if (lost.length) h += '<div class="notice warn lost-drafts"><span><b role="status">' + lost.length.toLocaleString('en-US') + ' drafts you were editing aren\'t in the folder anymore.</b> Your edits to each are kept here: open one to save it again or copy it.' +
      '<details data-disc="lost-drafts"' + ((st.disc || {})['lost-drafts'] ? ' open' : '') + '><summary class="small">Which drafts</summary>' +
      K.list(st, 'lost-drafts', lost, { keyOf: function (id) { return id; }, focusOf: function (k) { return K.byAct('open-process', k); }, draw: function (shown) { return '<ul class="small">' + shown.map(function (id) { return '<li><button class="linkish" data-act="open-process" data-id="' + esc(id) + '">' + esc(id) + '</button></li>'; }).join('') + '</ul>'; } }) +
      '</details></span></div>';
    var chosen = st.tags || [], tagged = procs.filter(function (p) { return has(p.tags); }), q = K.findQ(st, 'processes'), hit = K.finds(q);
    var found = q ? tagged.filter(function (p) { return hit([p.title, p.id, (p.group || []).join(' / '), p.category, (p.tags || []).join(' ')]); }) : tagged;
    h += '<section class="panel" id="procs-all">' + (K.findOn(st, 'processes', procs.length > 0) ? K.findBox(st, 'processes', 'Find a checklist', found.length, tagged.length, 'checklist', { by: tagWords(chosen) }) : '') + K.tagBar(allTags(ctx, chosen), chosen, st.disc, st) + (procs.length ? K.treeList(st, 'processes', found, function (p) { return p.group && p.group.length ? p.group : [p.category]; }, function (p) {
      PF.perf.add('procs.rows');
      var pub = p.latest, info = pub ? 'v' + pub.info.version : p.proposedOnly ? 'Proposed, not drafted yet' : 'not published yet';
      var flags = [];
      if (p.draftChanged) flags.push('draft changes');
      if (p.clashes.length) flags.push('version clash');
      if (p.proposed && p.proposed.list.some(function (x) { return x.fit === 'ready' || x.fit === 'older' || x.fit === 'review' || x.fit === 'already'; })) flags.push('proposed changes');
      /* Its skills by name, each with its status and a link to its own page: the first 5, and how many more (all of them are on
         the checklist's page). */
      var more = p.skills.length - CHIPS;
      var skills = p.skills.length ? '<div class="pskills"><span class="small">' + I('spark') + 'Skills</span>' + p.skills.slice(0, CHIPS).map(function (x) {
        var pill = SKILL_PILL[x.status.s] || SKILL_PILL.missing;
        return '<button class="skillchip" data-act="open-skill" data-id="' + esc(x.skill.file || x.skill.name) + '">' + esc(x.skill.name) + ' <span class="pill ' + pill[0] + '">' + pill[1] + '</span></button>';
      }).join('') + (more > 0 ? '<span class="small">+' + more.toLocaleString('en-US') + ' more skill' + (more === 1 ? '' : 's') + '</span>' : '') + '</div>' : '';
      return '<li><button data-act="open-process" data-id="' + esc(p.id) + '"><span class="t">' + esc(p.title) + '</span>' + (flags.length ? '<span class="small" style="color:var(--stop)">' + esc(flags.join(' · ')) + '</span>' : '<span></span>') + '<span class="small">' + info + (p.lastRun ? ' · last run ' + esc(U.day(p.lastRun)) : '') + '</span></button>' + skills + '</li>';
    /* Scoped to this list: the lost-drafts notice above can have a button for the same checklist (2.11). */
    }, { keyOf: function (p) { return p.id; }, focusOf: function (id) { return '#procs-all ' + K.byAct('open-process', id); } }) : '<p class="small">No checklists yet. Choose <b>New checklist</b>, or ask your AI assistant: <code>/flightdeck-new-checklist</code>.</p>') + '</section>';
    return h;
  }

  /* ---------- Skills: what they are, which need attention, and which processes are ready to become one ---------- */
  /* A skill's row in one of the page's lists (pre: sk-att- or sk-all-), its button with an id of its own from the row's key, so
     Show more in one list never focuses the same skill in another, or another registration with its name (2.11). */
  function skillRow(pre) { return function (k) {
    PF.perf.add('skills.rows');
    var s = k.x.skill, pill = SKILL_PILL[k.x.status.s] || SKILL_PILL.missing;
    return '<li><button id="' + esc(pre + k.key) + '" data-act="open-skill" data-id="' + esc(s.file || s.name) + '"><span class="t">' + I('spark') + esc(s.name) + (s.version ? ' <span class="small">' + esc(s.version) + '</span>' : '') + '</span><span class="pill ' + pill[0] + '">' + pill[1] + '</span><span class="small">' + (k.p.id ? 'Automates ' + esc(k.p.title) + ' v' + esc(s.implements) + (s.steps ? ' · ' + s.steps.length + ' step' + (s.steps.length === 1 ? '' : 's') : ' · the whole checklist') : esc(k.x.status.text)) + '</span>' + K.tagChips(s.tags) + '</button></li>';
  }; }
  function skillsPage(ctx) {
    var st = ctx.state, d = ctx.data, has = hasTags(ctx), skills = [], orphans = ctx.orphanSkills ? ctx.orphanSkills() : [];
    ctx.processes().forEach(function (p) { p.skills.forEach(function (x) { skills.push({ x: x, p: p }); }); });
    orphans.forEach(function (x) { if (!x.skill.name && x.skill.file) x.skill.name = x.skill.file; skills.push({ x: x, p: { id: '', title: 'No matching checklist', group: ['Not matched'], category: 'Not matched' } }); });
    var attention = skills.filter(function (k) { return k.x.status.s === 'update' || k.x.status.s === 'missing'; });
    var ready = ctx.processes().filter(function (p) { return p.latest && !p.skills.length && PF.skills.signoffs(d.validations, p.latest).length; });
    var h = notices(ctx) + pageHead('Skills', 'Skills', 'AI automations built from your checklists.');
    if (d.skillsSkipped) h += '<div class="notice warn" role="status"><span><b>' + d.skillsSkipped + ' more skill registration' + (d.skillsSkipped === 1 ? ' wasn\'t' : 's weren\'t') + ' read.</b> Flightdeck reads the first 500 in <code>skills/</code>, by name.</span><button class="mini" data-act="health">Folder health</button></div>';
    /* The how-to is the page's job when there are no skills yet; after that it's a closed reference. */
    h += '<details class="panel"' + (skills.length ? '' : ' open') + '><summary><h2 style="display:inline">How a checklist becomes a skill</h2></summary><ol class="howto">' +
      '<li><b>Prove it.</b><span>Run a published version until it has 3 clean runs.</span></li>' +
      '<li><b>Sign it off.</b><span>The checklist\'s owner confirms the version is ready.</span></li>' +
      '<li><b>Brief your AI assistant.</b><span>Copy the brief from the checklist\'s page; your AI assistant builds the skill.</span></li>' +
      '<li><b>Register it.</b><span>Your AI assistant adds <code>skills/&lt;name&gt;.json</code>: where it lives, what it implements.</span></li>' +
      '<li><b>Stay in step.</b><span>When the checklist changes, the skill shows here as needing an update, with a brief.</span></li></ol></details>';
    /* Each skill's key is its file, made unique (two registrations can share a name); Show more focuses its row's button. */
    var seen = Object.create(null);
    skills.forEach(function (k) { var b = k.x.skill.file || k.x.skill.name; seen[b] = (seen[b] || 0) + 1; k.key = U.nthKey(b, seen[b]); });
    var skillKey = function (k) { return k.key; }, focusIn = function (pre) { return function (key) { return K.byId(pre + key); }; };
    if (attention.length) h += '<section class="panel" aria-labelledby="att-h"><h2 id="att-h">Needs an update · ' + attention.length + '</h2><p class="small">Their checklist changed. Open one to copy the update brief.</p>' +
      K.list(st, 'sk-att', attention, { draw: function (shown) { return '<ul class="plist">' + shown.map(skillRow('sk-att-')).join('') + '</ul>'; }, keyOf: skillKey, focusOf: focusIn('sk-att-') }) + '</section>';
    /* A signed-off version that no skill implements yet: the one action is to brief the AI assistant. The row whose brief is
       open stays drawn. */
    if (ready.length) h += '<section class="panel" aria-labelledby="rdy-h"><h2 id="rdy-h">Ready to become a skill · ' + ready.length + '</h2>' + K.list(st, 'sk-ready', ready, { draw: function (shown) { return '<ul class="rlist">' + shown.map(function (p) {
      return '<li><div class="row"><button class="link t" data-act="open-process" data-id="' + esc(p.id) + '">' + esc(p.title) + ' v' + p.latest.info.version + '</button><button class="btn go" data-act="copy-brief" data-id="create:' + esc(p.id) + '">' + I('copy') + 'Copy brief</button></div>' + V.briefBox(st, 'create:' + p.id) + '</li>';
    }).join('') + '</ul>'; }, keyOf: function (p) { return p.id; }, focusOf: function (id) { return K.byAct('open-process', id); }, keep: st.brief && /^create:/.test(st.brief.key) ? [st.brief.key.slice(7)] : [], keptLabel: 'Its brief is open' }) + '</section>';
    var chosen = st.tags || [], tagged = skills.filter(function (k) { return has(k.x.skill.tags); }), q = K.findQ(st, 'skills'), hit = K.finds(q);
    var found = q ? tagged.filter(function (k) { return hit([k.x.skill.name, k.p.title, k.p.id, (k.x.skill.tags || []).join(' ')]); }) : tagged;
    h += '<section class="panel" aria-labelledby="all-h"><h2 id="all-h">All skills · ' + skills.length + '</h2>' + (K.findOn(st, 'skills', skills.length > 0) ? K.findBox(st, 'skills', 'Find a skill', found.length, tagged.length, 'skill', { by: tagWords(chosen) }) : '') + K.tagBar(skillTags(skills, chosen), chosen, st.disc, st) + (skills.length ? K.treeList(st, 'skills', found, function (k) { return k.x.skill.group.length ? k.x.skill.group : (k.p.group && k.p.group.length ? k.p.group : [k.p.category || 'Other']); }, skillRow('sk-all-'), { keyOf: skillKey, focusOf: focusIn('sk-all-') })
      : '<p class="small">No skills yet. Follow the steps above: once a checklist version is signed off, its page has the brief your AI assistant needs.</p>') + '</section>';
    return h;
  }

  V.planWhen = whenOf; V.plannedBy = plannedBy; V.planCopies = copiesLine; V.home = home; V.runs = runs; V.followUpsPage = followUpsPage; V.processesPage = processesPage; V.skillsPage = skillsPage; V.pageHead = pageHead;
})();
