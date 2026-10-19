/* Getting started: the welcome (Start your team, Join your team's folder, Look around the examples), the five setup steps,
   joining, Home's Getting started, and Settings, People. Progress comes from the folder (PF.setup.progress). */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, PP = PF.people, S = PF.setup, M = PF.map, I = PF.icons.icon, esc = U.esc;
  var nameOf = K.nameOf;
  /* Setup's own screens say who you are in their own words, so the top bar's reminder isn't repeated here. */
  function notices(ctx) { return K.notices(ctx, { noMe: true }); }

  /* The honest promise, word for word wherever roles come up (docs/design.md section 2; README FAQ). */
  var PROMISE = 'Roles in Flightdeck prevent ordinary mistakes: only the folder owner and backup owner change the people list, and only a checklist\'s owner (or its backup owner, while the owner is away) signs off a version. They aren\'t security. Anyone who can open the team folder can change any file in it, with Flightdeck or without. Who can open it is set by how you share it in OneDrive.';

  function ferr(st, field) {
    var e = st.fieldErr && st.fieldErr.id === 'setup' && st.fieldErr.field === field ? st.fieldErr : null;
    return { attrs: e ? ' aria-invalid="true" aria-describedby="ferr-' + field + '"' : '', html: e ? '<p class="ferr" id="ferr-' + field + '" role="alert">' + esc(e.msg) + '</p>' : '' };
  }
  function input(st, id, label, value, extra) {
    var e = ferr(st, id);
    return '<label class="field" for="' + id + '">' + label + '<input id="' + id + '" data-bound value="' + esc(value || '') + '"' + (extra || '') + e.attrs + '></label>' + e.html;
  }
  function arrow() { return '<span class="su-arrow" aria-hidden="true">' + I('chevron') + '</span>'; }
  function ok(text) { return '<p class="su-ok" role="status"><span class="su-tick" aria-hidden="true">' + I('check') + '</span><span>' + text + '</span></p>'; }
  function promise() { return '<aside class="su-promise" aria-labelledby="su-promise-h"><h3 id="su-promise-h">' + I('gate') + 'What roles do, and don\'t do</h3><p>' + esc(PROMISE) + '</p></aside>'; }

  /* ---------- the welcome ---------- */
  function welcome(ctx) {
    var can = ctx.canFolder;
    var choice = function (id, icon, title, text, cta, off) {
      return '<button type="button" class="su-choice" data-act="setup-mode" data-id="' + id + '"' + (off ? ' disabled aria-describedby="su-nofolder"' : '') + '><span class="su-ic" aria-hidden="true">' + I(icon) + '</span><b>' + title + '</b><span class="su-txt">' + text + '</span><span class="su-cta">' + cta + arrow() + '</span></button>';
    };
    var h = notices(ctx) + '<section class="su-hero"><div class="eyebrow">Flightdeck</div><h1 id="page-h" tabindex="-1">Checklists your team runs together</h1><p>Write down how your team does things, run it the same way every time, and see who did what. Everything lives in one shared OneDrive folder. No server, and nothing to sign in to.</p></section>';
    h += '<div class="su-choices">' +
      choice('start', 'plus', 'Start your team', 'You\'re the first one here. Pick an empty shared folder, add your people, publish a first checklist. About ten minutes.', 'Start your team', !can) +
      choice('join', 'people', 'Join your team\'s folder', 'Someone already set it up. Open the folder and choose who you are.', 'Join', !can) +
      choice('examples', 'spark', 'Look around the examples', 'A made-up team with runs in progress. Saved in this browser only; nothing is shared.', 'Look around', false) + '</div>';
    h += can ? '<p class="small su-need">You need Edge or Chrome on a computer, and a OneDrive folder your team can open.</p>'
      : '<p class="notice warn" id="su-nofolder">This browser can\'t open folders, so you can only look around the examples here. Use Edge or Chrome on a computer to start or join a team.</p>';
    return h;
  }

  /* ---------- Start your team ---------- */
  function stepper(ctx, su, prog) {
    /* On a phone only the current step's label shows, so every step carries its full name for screen readers. */
    return '<ol class="su-steps" aria-label="Setup steps">' + prog.steps.map(function (s, i) {
      var cur = s.id === su.step, can = s.done || cur || (su.created && i > 1);
      var name = 'Step ' + (i + 1) + ' of ' + prog.steps.length + ': ' + s.short + ', ' + (cur ? 'current' : s.done ? 'done' : 'not done yet');
      var body = '<span class="su-n" aria-hidden="true">' + (s.done ? I('check') : i + 1) + '</span><span class="su-l" aria-hidden="true">' + esc(s.short) + '</span><span class="sr">' + esc(name) + '</span>';
      return '<li class="' + (s.done ? 'done' : '') + (cur ? ' cur' : '') + '">' + (can && !cur && su.created ? '<button type="button" data-act="setup-step" data-id="' + s.id + '" aria-label="' + esc(name) + '">' + body + '</button>' : '<span' + (cur ? ' aria-current="step"' : '') + ' aria-label="' + esc(name) + '">' + body + '</span>') + '</li>';
    }).join('') + '</ol>';
  }
  function folderStep(ctx, su) {
    var h = '<h2 id="su-h" tabindex="-1">Choose the team folder</h2><p>Flightdeck keeps everything in one shared folder: checklists, runs and notes. Each person opens it on their own computer through OneDrive.</p>' +
      '<ol class="su-tips"><li>In OneDrive, make a new, empty folder, like <b>Team checklists</b>.</li><li>Share it with everyone who will run checklists.</li><li>Right-click it and choose <b>Always keep on this device</b>, so Flightdeck can read it offline.</li></ol>';
    if (su.err) h += '<div class="notice ' + (su.err.kind === 'team' ? 'warn' : 'bad') + '" role="alert"><span>' + esc(su.err.text) + '</span>' + (su.err.kind === 'team' ? '<button class="btn" data-act="setup-join-dir">Join this folder</button>' : '') + '</div>';
    if (su.tested) return h + ok('Flightdeck can save files in <b>' + esc(su.dirName) + '</b>. It checked by writing a test file' + (su.leftover ? '.' : ' and removing it.')) + (su.leftover ? '<p class="notice warn" role="status">It couldn\'t remove the test file. Delete <code>' + esc(su.leftover) + '</code> from the folder when you can; it\'s harmless meanwhile.</p>' : '') + '<div class="row su-actions"><button class="btn go" data-act="setup-next" data-id="people">Continue' + arrow() + '</button><button class="mini" data-act="setup-pick">Choose another folder</button></div>';
    return h + '<div class="row su-actions"><button class="btn go" data-act="setup-pick"' + (su.busy ? ' disabled' : '') + '>' + (su.busy ? 'Checking the folder…' : I('doc') + 'Choose the folder') + '</button></div>';
  }
  /* IDs as they'll be saved: made from names in order, "-2" on a clash. Shown before anything is written. */
  function previewIds(su) {
    var taken = [], out = {};
    [{ k: 'me', name: su.me.name }].concat(su.team).forEach(function (x) { if (!String(x.name || '').trim()) return; var id = PP.idFor(x.name, taken); taken.push(id); out[x.k] = id; });
    return out;
  }
  function peopleStep(ctx, su) {
    var st = ctx.state, ids = previewIds(su), named = su.team.filter(function (x) { return String(x.name || '').trim(); });
    var idLine = function (k) { return '<span class="small su-id" id="su-id-' + k + '">' + (ids[k] ? 'Saved as <code>' + esc(ids[k]) + '</code>' : '&nbsp;') + '</span>'; };
    var h = '<h2 id="su-h" tabindex="-1">Who\'s on the team?</h2><p>Everyone who runs or follows checklists. Each person gets an ID made from their name; it never changes, so runs always know who did what. You can add people later in Settings.</p>';
    h += '<form id="setup-people-form" class="stack" data-scope="setup-people" novalidate><fieldset class="su-mine"><legend>You <span class="pill passed">Folder owner</span></legend><div class="grid2">' +
      input(st, 'su-me-name', 'Your name', su.me.name, ' maxlength="60" autocomplete="name"') + input(st, 'su-me-email', 'Email (optional)', su.me.email, ' maxlength="120" type="email" autocomplete="email"') + '</div>' + idLine('me') + '</fieldset>';
    h += '<fieldset class="su-team"><legend>Your teammates</legend><ul class="su-rows">' + su.team.map(function (x, i) {
      return '<li><div class="grid2">' + input(st, 'su-name-' + x.k, 'Name', x.name, ' maxlength="60"') + input(st, 'su-email-' + x.k, 'Email (optional)', x.email, ' maxlength="120" type="email"') + '</div><div class="row between">' + idLine(x.k) +
        '<button type="button" class="mini" data-act="setup-del-row" data-id="' + x.k + '" aria-label="Remove teammate ' + (i + 1) + (x.name ? ', ' + esc(x.name) : '') + '">Remove</button></div></li>';
    }).join('') + '</ul><button type="button" class="btn" data-act="setup-add-row">' + I('plus') + 'Add a teammate</button></fieldset>';
    var b = ferr(st, 'su-backup'), cands = [{ id: ids.me, name: su.me.name }].concat(named.map(function (x) { return { id: ids[x.k], name: x.name, email: String(x.email || '').trim() }; }));
    h += '<fieldset class="su-backup"><legend>Backup owner</legend><label class="field" for="su-backup">If you\'re away or leave, your backup owner keeps the people list and can hand the folder to someone else.<select id="su-backup" data-bound' + b.attrs + '><option value="">Nobody yet</option>' +
      named.map(function (x) { return '<option value="' + esc(x.k) + '"' + (su.backup === x.k ? ' selected' : '') + '>' + esc(PP.label({ id: ids[x.k], name: x.name, email: String(x.email || '').trim() }, cands)) + '</option>'; }).join('') + '</select></label>' + b.html + '</fieldset>';
    h += promise();
    h += '<div class="row su-actions"><button class="btn go" type="submit"' + (su.busy ? ' disabled' : '') + '>' + (su.busy ? 'Creating…' : 'Create the team folder') + '</button><button type="button" class="mini" data-act="setup-step" data-id="folder">Back</button></div>' +
      '<p class="small">Flightdeck writes <code>people.json</code>, <code>AGENTS.md</code> (instructions for AI assistants) and their skills into <b>' + esc(su.dirName || '') + '</b>.</p></form>';
    return h;
  }
  function firstPublished(ctx) { return ctx.processes().filter(function (p) { return p.latest; })[0] || null; }
  function checklistStep(ctx, su, prog) {
    var st = ctx.state, roles = PP.roles(ctx.data.people), bk = roles.backup && !roles.backup.inactive && roles.backup.id !== st.me ? roles.backup : null;
    var h = '<h2 id="su-h" tabindex="-1">Your first checklist</h2><p>A checklist is your process written down: phases of steps, with a gate to confirm at the end of each. Pick one to start from. You own it' + (bk ? '; ' + esc(bk.name) + ' is its backup owner' : '') + '.</p>';
    var pub = firstPublished(ctx);
    if (pub) h += ok('<b>' + esc(pub.title) + '</b> v' + pub.latest.info.version + ' is published.') + '<div class="row su-actions"><button class="btn go" data-act="setup-next" data-id="run">Continue' + arrow() + '</button><span class="small">Or start another below.</span></div>';
    h += '<div class="su-tpls" role="group" aria-label="Start from">' + S.TEMPLATES.map(function (t) {
      return '<button type="button" class="su-tpl" data-act="setup-tpl" data-id="' + t.id + '" aria-pressed="' + (su.tpl === t.id) + '"><b>' + esc(t.title) + '</b><span class="small">' + esc(t.text) + '</span></button>';
    }).join('') + '</div>';
    var t = S.TEMPLATES.filter(function (x) { return x.id === su.tpl; })[0];
    if (!t) return h;
    if (t.id === 'assistant') {
      var text = S.assistantPrompt({ folder: st.fs ? st.fs.name : '', owner: st.me, backup: bk ? bk.id : '' });
      return h + '<div class="su-pick"><p>Paste this to your AI assistant, opened in the team folder, with your notes or runbook. It writes the draft into <code>maps/drafts/</code>; it shows up in Processes, where you publish it. This step ticks itself once it\'s published.</p>' +
        '<pre class="source" id="su-prompt" tabindex="0">' + esc(text) + '</pre><div class="row"><button class="btn" data-act="setup-copy" data-id="prompt">' + I('copy') + 'Copy the prompt</button><span class="small" id="copy-msg" role="status"></span></div></div>';
    }
    var md = ctx.setupTemplate ? ctx.setupTemplate(t.id) : '', map = M.parse(md), steps = M.steps(map).length;
    return h + '<div class="su-pick"><div class="row between"><div><b>' + esc(map.meta.title || t.title) + '</b><div class="small">' + map.phases.length + ' phase' + (map.phases.length === 1 ? '' : 's') + ', ' + steps + ' step' + (steps === 1 ? '' : 's') + (map.meta.runs === 'solo' ? ' · run on your own' : map.meta.roles.length ? ' · roles: ' + esc(map.meta.roles.join(', ')) : '') + '</div></div></div>' +
      '<ol class="su-phases">' + map.phases.map(function (p) { return '<li><b>' + esc(p.title) + '</b> <span class="small">' + p.steps.map(function (s) { return esc(s.text); }).join(' · ') + '</span></li>'; }).join('') + '</ol>' +
      '<div class="row su-actions"><button class="btn go" data-act="setup-publish" data-id="' + t.id + '"' + (su.busy ? ' disabled' : '') + '>' + I('play') + 'Publish v1 as it is</button><button class="btn" data-act="setup-edit" data-id="' + t.id + '"' + (su.busy ? ' disabled' : '') + '>' + I('edit') + 'Open it in the editor</button></div>' +
      '<p class="small">Publishing makes a numbered version people can run. You can edit and publish v2 any time; runs already started keep their version.</p></div>';
  }
  function runStep(ctx, su, prog) {
    var st = ctx.state, pubs = ctx.processes().filter(function (p) { return p.latest; }), done = prog.steps[3].done;
    var h = '<h2 id="su-h" tabindex="-1">Do a first run</h2><p>Run a checklist once on your own to see how it feels. Check each step as you go; each phase ends with a gate you confirm. Finish the run to tick this step.</p>';
    var mine = ctx.data.runs.filter(function (r) { return r.state === 'running' && r.recorder && r.recorder.person === st.me; })[0];
    if (done) h += ok('You finished a run. That\'s the whole loop: publish, run, learn.') + '<div class="row su-actions"><button class="btn go" data-act="setup-next" data-id="second">Continue' + arrow() + '</button></div>';
    else if (mine) h += '<div class="notice"><span><b>' + esc(mine.title) + '</b> is running. Finish it to tick this step.</span><button class="btn go" data-act="open-run" data-id="' + esc(mine.process + '/' + mine.id) + '">Open the run</button></div>';
    if (!pubs.length) return h + '<p class="notice warn">Publish a checklist first.</p><div class="row"><button class="btn" data-act="setup-step" data-id="checklist">Back to the first checklist</button></div>';
    return h + '<ul class="su-runs">' + pubs.slice(0, 6).map(function (p) {
      return '<li><span><b>' + esc(p.title) + '</b> <span class="small">v' + p.latest.info.version + '</span></span><button class="btn' + (done || mine ? '' : ' go') + '" data-act="setup-run" data-id="' + esc(p.id) + '">' + I('play') + 'Start it on your own</button></li>';
    }).join('') + '</ul>';
  }
  function secondStep(ctx, su, prog) {
    var st = ctx.state, me = st.me, fs = st.fs, others = ctx.data.people.filter(function (p) { return !p.inactive && p.id !== me; });
    var to = others.filter(function (p) { return p.id === su.to; })[0] || others[0] || null, done = prog.steps[4].done;
    var h = '<h2 id="su-h" tabindex="-1">Open it on a second computer</h2><p>A run helps most when the team can see it. Have a teammate open the folder on their computer, then check that files travel between you.</p><ol class="su-sub">';
    h += '<li><h3>Flightdeck in the team folder</h3>' + (su.hasApp === true ? ok('<code>flightdeck.html</code> is in the team folder, so everyone opens the same version.')
      : su.hasApp === false ? '<p>Teammates open Flightdeck from the team folder. Copy this file (<code>flightdeck.html</code>) into <b>' + esc(fs ? fs.name : '') + '</b>, or run <code>flightdeck install &lt;team folder&gt;</code> in a terminal.</p><button class="btn" data-act="setup-app-check">Check again</button>'
      : '<p class="small">Checking the team folder…</p>') + '</li>';
    h += '<li><h3>Send a teammate the way in</h3>';
    if (!to) h += '<p>Add a teammate in Settings, People first.</p><button class="btn" data-act="nav" data-id="settings">Settings</button>';
    else {
      h += (others.length > 1 ? '<label class="field su-to" for="su-to">Who\'s opening it<select id="su-to">' + others.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p === to ? ' selected' : '') + '>' + esc(PP.label(p, ctx.data.people)) + '</option>'; }).join('') + '</select></label>' : '') +
        '<pre class="source su-msg" id="su-invite" tabindex="0">' + esc(S.invite({ folder: fs ? fs.name : '', to: to.name, from: nameOf(ctx, me) })) + '</pre><div class="row"><button class="btn" data-act="setup-copy" data-id="invite">' + I('copy') + 'Copy the message</button><span class="small" id="copy-msg" role="status"></span></div>';
    }
    h += '</li><li><h3>Check the connection</h3>';
    var acks = ((st.conn || {}).acks || []).filter(function (a) { return a.by && a.by !== me; });
    if (done) h += ok(acks.length ? '<b>' + esc(nameOf(ctx, acks[acks.length - 1].by)) + '</b> answered from ' + esc(acks[acks.length - 1].device || 'another computer') + '. Files reach their computer and come back.' : 'Someone else has used this folder from their computer.');
    else h += '<p>Once they\'ve opened the folder, send a check. Their Flightdeck offers to answer it; when they do, this step ticks.</p>';
    h += '<div class="row"><button class="btn' + (done ? '' : ' go') + '" data-act="conn-send"' + (st.connSending ? ' disabled' : '') + '>' + I('swap') + (st.connSending ? 'Sending…' : 'Send a check') + '</button><button class="mini" data-act="connection">Open Connection check</button></div>' +
      ((st.connSent || []).length && !done ? '<p class="small" role="status">Check ' + st.connSent[st.connSent.length - 1].n + ' sent. Waiting for an answer from another computer.</p>' : '') + '</li></ol>';
    return h;
  }
  function doneStamp(ctx) {
    return '<section class="su-done" aria-labelledby="su-done-h"><span class="called-stamp">Set up</span><h2 id="su-done-h">Your team is set up</h2><p>Your folder has people, a published checklist, a finished run, and a second computer that can see it. From here, Home shows what needs you.</p><div class="row"><button class="btn go" data-act="setup-finish">Go to Home</button></div></section>';
  }
  function start(ctx, su) {
    var prog = ctx.setupProgress ? ctx.setupProgress() : S.progress({});
    /* Before the folder is created, the first two steps are what this screen knows, not what the folder says. */
    if (!su.created) prog.steps.forEach(function (s, i) { s.done = i === 0 && !!su.tested; });
    var body = { folder: folderStep, people: peopleStep, checklist: checklistStep, run: runStep, second: secondStep }[su.step] || folderStep;
    var h = notices(ctx) + '<div class="su-top"><button type="button" class="mini" data-act="setup-mode" data-id="welcome">' + I('back') + 'Back</button><div class="eyebrow">Start your team · step ' + (S.STEPS.map(function (s) { return s.id; }).indexOf(su.step) + 1) + ' of 5</div></div>';
    h += stepper(ctx, su, prog);
    if (su.created && prog.complete) h += doneStamp(ctx);
    return h + '<section class="panel su-card" aria-labelledby="su-h">' + body(ctx, su, prog) + '</section>';
  }

  /* ---------- Join your team's folder ---------- */
  function join(ctx, su) {
    var st = ctx.state, fs = st.fs, h = notices(ctx) + '<div class="su-top"><button type="button" class="mini" data-act="setup-mode" data-id="welcome">' + I('back') + 'Back</button><div class="eyebrow">Join your team</div></div><section class="panel su-card" aria-labelledby="su-h">';
    if (su.step !== 'who' || !fs || fs.kind !== 'folder') {
      h += '<h2 id="su-h" tabindex="-1">Open your team\'s folder</h2><p>Pick the shared folder your team uses. It has <code>flightdeck.html</code>, <code>people.json</code> and the checklists in it.</p>' +
        '<ol class="su-tips"><li>Don\'t see it? In OneDrive, open <b>Shared with me</b> and choose <b>Add shortcut to My files</b>.</li><li>Right-click the folder and choose <b>Always keep on this device</b>.</li></ol>';
      if (su.err) h += '<div class="notice bad" role="alert"><span>' + esc(su.err.text) + '</span></div>';
      return h + '<div class="row su-actions"><button class="btn go" data-act="setup-open"' + (su.busy ? ' disabled' : '') + '>' + I('doc') + (su.busy ? 'Opening…' : 'Open team folder') + '</button></div></section>';
    }
    var people = ctx.data.people.filter(function (p) { return !p.inactive; }), owner = PP.roles(ctx.data.people).owner;
    h += '<h2 id="su-h" tabindex="-1">Who are you?</h2>';
    if (!people.length) return h + '<div class="notice warn" role="status"><span><b>' + esc(fs.name) + '</b> has no people list yet. If you\'re setting up a new team, choose Start your team instead.</span><button class="btn" data-act="setup-mode" data-id="start">Start your team</button></div></section>';
    h += '<p>Choose your name in <b>' + esc(fs.name) + '</b>. Everything you record or note is stamped with it.</p><ul class="su-who">' + people.map(function (p) {
      return '<li><button type="button" class="su-pers" data-act="setup-who" data-id="' + esc(p.id) + '"' + (p.id === st.me ? ' aria-current="true"' : '') + '>' + K.avatar(ctx, p.id, true) + '<span class="su-pt"><b>' + esc(p.name) + '</b><span class="small">' + esc(p.email || p.id) + '</span></span>' + arrow() + '</button></li>';
    }).join('') + '</ul>';
    var who = owner && !owner.inactive ? owner.name : 'whoever set up the team folder', rq = su.request || {};
    h += '<details class="su-notme"' + (su.askOpen ? ' open' : '') + ' data-disc="su-notme"><summary>Not on the list?</summary><p>Ask ' + esc(who) + ' to add you. Only the folder owner and backup owner change the people list, so nothing here writes to it.</p><div class="grid2">' +
      input(st, 'su-rq-name', 'Your name', rq.name, ' maxlength="60" autocomplete="name"') + input(st, 'su-rq-email', 'Email (optional)', rq.email, ' maxlength="120" type="email" autocomplete="email"') + '</div>' +
      '<pre class="source su-msg" id="su-request" tabindex="0">' + esc(PP.request({ owner: owner && !owner.inactive ? owner.name.split(' ')[0] : '', folder: fs.name, name: rq.name, email: rq.email })) + '</pre><div class="row"><button class="btn" data-act="setup-copy" data-id="request">' + I('copy') + 'Copy a request</button><span class="small" id="copy-msg" role="status"></span></div></details>';
    return h + '</section>';
  }

  function setup(ctx) {
    var su = ctx.state.setup || { mode: 'welcome' };
    if (su.mode === 'start') return '<div class="su">' + start(ctx, su) + '</div>';
    if (su.mode === 'join') return '<div class="su">' + join(ctx, su) + '</div>';
    return '<div class="su">' + welcome(ctx) + '</div>';
  }

  /* ---------- Home: Getting started · N of 5, for the folder owner and backup until it's hidden ---------- */
  function homeCard(ctx) {
    var prog = ctx.setupCard ? ctx.setupCard() : null;
    if (!prog) return '';
    if (prog.complete) return '<section class="panel su-home done" aria-labelledby="su-home-h"><div class="row between"><div class="row"><span class="called-stamp">Set up</span><h2 id="su-home-h" style="margin:0">Your team is set up</h2></div><button class="mini" data-act="setup-hide">Dismiss</button></div><p class="small">People, a published checklist, a finished run and a second computer. Nice work.</p></section>';
    return '<section class="panel su-home" aria-labelledby="su-home-h"><div class="row between"><h2 id="su-home-h" style="margin:0">Getting started · ' + prog.count + ' of ' + prog.total + '</h2><button class="mini" data-act="setup-hide" aria-label="Hide Getting started">Hide</button></div>' +
      '<div class="bar" role="progressbar" aria-label="Setup" aria-valuemin="0" aria-valuemax="' + prog.total + '" aria-valuenow="' + prog.count + '"><i style="width:' + Math.round(100 * prog.count / prog.total) + '%"></i></div><ol class="su-list">' + prog.steps.map(function (s) {
        var next = s.id === prog.next;
        return '<li class="' + (s.done ? 'done' : next ? 'next' : '') + '"><span class="su-n" aria-hidden="true">' + (s.done ? I('check') : '') + '</span><span>' + esc(s.title) + '<span class="sr">' + (s.done ? ', done' : ', not done yet') + '</span></span>' + (next ? '<button class="btn go" data-act="setup-continue" data-id="' + s.id + '">Continue</button>' : '') + '</li>';
      }).join('') + '</ol></section>';
  }

  /* ---------- Settings, People ---------- */
  function peoplePanel(ctx) {
    var st = ctx.state, people = ctx.data.people, me = st.me, can = PP.canManage(people, me), r = PP.roles(people), pick = st.pick && st.pick.kind === 'people-owner' ? st.pick.id : null;
    var role = function (p) { return p.folderRole === 'owner' ? '<span class="pill passed">Folder owner</span>' : p.folderRole === 'backup' ? '<span class="pill waived">Backup owner</span>' : ''; };
    var h = '<section class="panel" aria-labelledby="set-people"><h2 id="set-people">' + I('people') + 'People · ' + people.length + '</h2>';
    if (st.peopleErr) h += '<div class="notice warn" role="alert"><span>' + esc(st.peopleErr) + '</span><button class="mini" data-act="people-err-dismiss">Dismiss</button></div>';
    h += people.length ? '<ul class="vlist pp-list">' + people.map(function (p) {
      var acts = '';
      if (can) {
        if (pick === p.id) acts = '<span class="row" data-scope="people-owner"><span class="small">Make ' + esc(p.name) + ' the folder owner?' + (r.owner && r.owner.id === me ? ' You become ' + (p.folderRole === 'backup' ? 'backup owner' : 'an ordinary member') + '.' : '') + '</span><button class="btn go" data-act="people-owner" data-id="' + esc(p.id) + '">Make folder owner</button><button class="mini" data-act="unpick">Cancel</button></span>';
        else {
          if (!PP.allowed(people, me, 'owner', p.id)) acts += '<button class="mini" data-act="pick" data-kind="people-owner" data-id="' + esc(p.id) + '">Make folder owner</button>';
          if (!PP.allowed(people, me, 'backup', p.id) && p.folderRole !== 'backup') acts += '<button class="mini" data-act="people-backup" data-id="' + esc(p.id) + '">Make backup owner</button>';
          if (!PP.allowed(people, me, p.inactive ? 'active' : 'inactive', p.id)) acts += '<button class="mini" data-act="people-active" data-id="' + esc(p.id) + '" data-on="' + (p.inactive ? '1' : '') + '">' + (p.inactive ? 'Mark active' : 'Mark inactive') + '</button>';
        }
      }
      return '<li class="' + (p.inactive ? 'inactive' : '') + '">' + K.avatar(ctx, p.id) + '<span class="pp-who"><b>' + esc(p.name) + '</b> ' + role(p) + (p.inactive ? ' <span class="pill locked">Inactive</span>' : '') + (p.id === me ? ' <span class="small">(you)</span>' : '') + '<br><span class="small">' + esc(p.id) + (p.email ? ' · ' + esc(p.email) : '') + '</span></span>' + (acts ? '<span class="row pp-acts">' + acts + '</span>' : '') + '</li>';
    }).join('') + '</ul>' : '<p class="small">Nobody yet.</p>';
    if (can) {
      var add = st.peopleAdd || {}, e1 = ferr(st, 'pa-name'), e2 = ferr(st, 'pa-email'), id = String(add.name || '').trim() ? PP.idFor(add.name, people.map(function (p) { return p.id; })) : '';
      h += '<form id="people-add-form" class="pp-add" data-scope="people-add" novalidate><h3>Add a person</h3><div class="grid2"><label class="field" for="pa-name">Name<input id="pa-name" data-bound maxlength="60" value="' + esc(add.name || '') + '"' + e1.attrs + '></label>' + e1.html +
        '<label class="field" for="pa-email">Email (optional)<input id="pa-email" data-bound type="email" maxlength="120" value="' + esc(add.email || '') + '"' + e2.attrs + '></label>' + e2.html + '</div>' +
        '<div class="row between"><span class="small" id="pa-id">' + (id ? 'Their ID will be <code>' + esc(id) + '</code>. IDs never change.' : 'Their ID is made from the name and never changes.') + '</span><button class="btn" type="submit"' + (st.peopleSaving ? ' disabled' : '') + '>' + I('plus') + 'Add a person</button></div></form>' +
        '<p class="small">Nobody is ever deleted: runs keep their names. Mark people who left as inactive.</p>';
    } else if (r.owner) h += '<p class="small">' + esc(r.owner.name) + (r.backup ? ' (folder owner) and ' + esc(r.backup.name) + ' (backup owner) change' : ', the folder owner, changes') + ' this list. Ask them to add someone.</p>';
    else if (people.length) h += '<p class="small">Nobody is the folder owner yet. Give one person <code>"folderRole": "owner"</code> in <code>people.json</code> (your AI assistant can do it); then they change this list here.</p>';
    else h += '<p class="small">To change this list, edit <code>people.json</code> in the team folder.</p>';
    return h + '<details class="pp-promise"><summary class="small">Are roles a security control?</summary><p class="small">' + esc(PROMISE) + '</p></details></section>';
  }

  V.setup = setup; V.setupHome = homeCard; V.peoplePanel = peoplePanel; V.PROMISE = PROMISE;
})();
