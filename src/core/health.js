/* Folder health: what in the team folder needs a person, worth a look, or is fine. Pure: it reads a snapshot (what the app
   loaded, plus an on-demand scan of every file) and returns issues, each with exactly one action, and an all-clear list.
   Flightdeck never fixes the folder by itself; each issue says what a person can do. See docs/design.md section 21. */
PF.health = (function () {
  'use strict';
  var U = PF.util, M = PF.map, C = PF.contract;
  var HOUR = 3600000, DAY = 24 * HOUR;
  var LIMITS = { saveGraceMs: 2 * 60000, abandonedMs: 7 * DAY, handoffMs: 2 * HOUR, halfSyncMs: 2 * HOUR, tmpMs: 2 * HOUR, skewMs: 10 * 60000,
    runsWarn: 500, runsStop: 2000, types: 100, skills: 500, runFiles: 500, attachBytes: 1024 * 1024 * 1024, pathChars: 200, slowRefreshMs: 15000, slowRefreshes: 3 };
  /* Sections of docs/recovery.md (and the in-app view), by their anchors. */
  var HELP = { conflicts: 'a-run-has-conflict-copies', copies: 'onedrive-made-a-copy-of-a-draft-peoplejson-or-a-step-type', access: 'flightdeck-lost-access-to-the-folder',
    syncing: 'onedrive-isnt-syncing', backup: 'restoring-from-a-backup', left: 'someone-left-the-team', newer: 'a-newer-flightdeck-wrote-files',
    older: 'teammates-on-an-older-flightdeck', placeholder: 'a-replaced-file-with-no-steps',
    unreadable: 'a-file-cant-be-read', gone: 'a-runs-file-is-gone', leftover: 'leftover-files', big: 'the-folder-is-getting-big', sameName: 'two-windows-used-the-same-name', reports: 'a-report-cant-be-accepted' };
  var ORDER = { stop: 0, warn: 1, info: 2 };

  function semverOf(v) { var m = typeof v === 'string' ? /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(v) : null; return m ? [+m[1], +m[2], +m[3]] : null; }
  function cmpV(a, b) { for (var i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }
  function listOf(xs) { return xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function ms(iso) { var t = typeof iso === 'string' ? Date.parse(iso) : NaN; return isNaN(t) ? null : t; }
  function span(d) {
    if (d < HOUR) return plural(Math.max(1, Math.round(d / 60000)), 'minute');
    if (d < 2 * DAY) return plural(Math.round(d / HOUR), 'hour');
    return plural(Math.round(d / DAY), 'day');
  }
  function bytes(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' bytes'; }
  function nameOf(people, id) { for (var i = 0; i < people.length; i++) if (people[i].id === id) return people[i].name; return id || 'nobody'; }
  function help(anchor, label) { return { act: 'recovery', id: anchor, label: label || 'What to do' }; }

  /* "release-LAPTOP.md" or "people-DESKTOP-ABC123.json" next to the original, or "people (1).json": OneDrive keeping both
     saves. A dash suffix counts only with a capital letter in it (computer names, which may have dashes of their own), so
     "deploy-prod.json" beside "deploy.json" doesn't. */
  function copyOf(name, siblings) {
    var m = /^(.*) \(\d+\)(\.[^.]+)?$/.exec(name);
    if (m && siblings[m[1] + (m[2] || '')]) return m[1] + (m[2] || '');
    m = /^(.+)(\.[A-Za-z0-9]+)$/.exec(name);
    if (!m) return null;
    for (var i = m[1].indexOf('-'); i > 0; i = m[1].indexOf('-', i + 1)) {
      var base = m[1].slice(0, i) + m[2], suffix = m[1].slice(i + 1);
      if (siblings[base] && /^[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*$/.test(suffix) && /[A-Z]/.test(suffix)) return base;
    }
    return null;
  }
  /* Where OneDrive copies matter: files with one writer that people or assistants edit by name. Run folders have their own
     conflict handling, and attachments are named uniquely. */
  function copyArea(path) { return !/^runs\//.test(path) && !/^publications\//.test(path) && !/^connection\//.test(path) && !/^images\//.test(path) && !/^reports\//.test(path) && !/^report-decisions\//.test(path); }

  /* Drafts that say the same process: line: only one can be shown, so the rest must be reported, never silently hidden. */
  function sharedDrafts(drafts) {
    var by = Object.create(null), out = [];
    (drafts || []).forEach(function (d) { var id = M.parse(d.md).meta.process || d.file.replace(/\.md$/i, ''); (by[id] = by[id] || []).push(d.file); });
    Object.keys(by).sort().forEach(function (id) { if (by[id].length > 1) out.push({ process: id, files: by[id].slice().sort() }); });
    return out;
  }

  /* snap: { data (repo.loadAll), scan (repo.scan, or null for the quick check on Home), me, app (this copy's version), newer
     (a newer copy's version in the folder), contract ({ hashes: {path: sha-256 hex} } from the scanned texts), connection
     (repo.loadConnection) }. Returns { issues, clear, scanned, counts }. */
  function check(snap, now) {
    var d = snap.data || {}, scan = snap.scan || null, issues = [], clear = [];
    var people = d.people || [], runs = d.runs || [], procs = d.processes || [];
    function add(i) { i.paths = (i.paths || []).slice(0, 50); issues.push(i); }
    function ok(id, text) { clear.push({ id: id, text: text }); }

    /* ---- reading ---- */
    var failed = Object.keys(d.failed || {});
    if (failed.length) add({ id: 'read-failed', severity: 'stop', area: 'Reading', title: 'Part of the team folder couldn\'t be read', detail: 'Flightdeck kept what it read before for ' + failed.join(', ') + '. ' + d.failed[failed[0]], paths: failed, action: help(HELP.syncing, 'What to do'), help: HELP.syncing });
    var unread = (d.unreadable || []).slice(), scanUnread = scan ? scan.unreadable || [] : [];
    (d.corrUnread || []).concat(d.fuUnread || []).forEach(function (u) { if (!u.kept) unread.push({ path: u.dir + '/' + u.process + '/' + u._file, why: 'couldn\'t be read' }); });
    scanUnread.forEach(function (u) { if (!unread.some(function (x) { return x.path === u.path; })) unread.push(u); });
    var runUnread = unread.filter(function (u) { return /^runs\//.test(u.path) || u.path === 'people.json'; }), otherUnread = unread.filter(function (u) { return runUnread.indexOf(u) < 0; });
    if (runUnread.length) add({ id: 'unreadable-runs', severity: 'stop', area: 'Files', title: runUnread.length === 1 ? (runUnread[0].path === 'people.json' ? 'people.json can\'t be read' : 'A run file can\'t be read') : plural(runUnread.length, 'file') + ' that runs depend on can\'t be read',
      detail: runUnread[0].path + ' ' + runUnread[0].why + '. It may still be arriving; if it stays this way, restore it from a backup.', paths: runUnread.map(function (u) { return u.path; }), action: help(HELP.unreadable), help: HELP.unreadable });
    if (otherUnread.length) add({ id: 'unreadable', severity: 'warn', area: 'Files', title: plural(otherUnread.length, 'file') + ' can\'t be read', detail: otherUnread[0].path + ' ' + otherUnread[0].why + '. Flightdeck skips ' + (otherUnread.length === 1 ? 'it' : 'them') + ' and shows everything else.', paths: otherUnread.map(function (u) { return u.path; }), action: help(HELP.unreadable), help: HELP.unreadable });
    if (!failed.length && !unread.length) ok('readable', scan ? 'Every file Flightdeck uses can be read (' + plural(scan.files, 'file') + ').' : 'Every run file can be read.');

    /* ---- people ---- */
    var ids = Object.create(null), dup = [];
    people.forEach(function (p) { if (ids[p.id]) dup.push(p.id); ids[p.id] = p; });
    if (!people.length) add({ id: 'people-missing', severity: 'stop', area: 'People', title: 'Nobody is in people.json', detail: 'Without it, nobody can be chosen for a role or as who you are. Restore it from a backup, or ask whoever keeps it.', paths: ['people.json'], action: help(HELP.backup), help: HELP.backup });
    else {
      if (dup.length) add({ id: 'people-dup', severity: 'stop', area: 'People', title: 'Two people share an ID in people.json', detail: dup.join(', ') + ' appears more than once, so runs can\'t tell them apart. Keep one entry per ID; never reuse an ID.', paths: ['people.json'], action: help(HELP.left, 'How people.json works'), help: HELP.left });
      if (snap.me && !ids[snap.me]) add({ id: 'me-missing', severity: 'warn', area: 'People', title: 'You aren\'t in people.json', detail: 'You\'re recording as "' + snap.me + '", which the people list doesn\'t have. Ask whoever keeps people.json to add you.', paths: ['people.json'], action: { act: 'nav', id: 'settings', label: 'See the people list' }, help: HELP.left });
      var gone = [], away = function (id) { return !ids[id] || ids[id].inactive; }, why = function (id) { return ids[id] ? 'is marked inactive' : 'isn\'t in people.json'; };
      procs.forEach(function (p) {
        var l = p.index && p.index.latest, o = l && l.map.meta.owner, b = l && l.map.meta.backup;
        if (o && away(o)) gone.push({ process: p.process, owner: o, why: why(o), backup: b && b !== o && !away(b) ? b : null });
        if (b && b !== o && away(b)) gone.push({ process: p.process, backupGone: b, why: why(b) });
      });
      gone.forEach(function (g) {
        if (g.backupGone) { add({ id: 'backup:' + g.process, severity: 'info', area: 'People', title: 'The checklist "' + g.process + '" needs a new backup owner', detail: 'Its backup owner, ' + nameOf(people, g.backupGone) + ', ' + g.why + '. Change backup: in the draft and publish a new version.', paths: ['maps/drafts/' + g.process + '.md'], action: { act: 'open-process', id: g.process, label: 'Open the process' }, help: HELP.left }); return; }
        add({ id: 'owner:' + g.process, severity: 'warn', area: 'People', title: 'The checklist "' + g.process + '" needs a new owner', detail: 'Its owner, ' + nameOf(people, g.owner) + ', ' + g.why + '. ' + (g.backup ? 'Its backup owner, ' + nameOf(people, g.backup) + ', can sign off versions until then. ' : '') + 'Change owner: in the draft and publish a new version.', paths: ['maps/drafts/' + g.process + '.md'], action: { act: 'open-process', id: g.process, label: 'Open the process' }, help: HELP.left });
      });
      /* The folder owner and backup owner keep people.json; without an active one, nobody can change it in Flightdeck. */
      var fr = PF.people.roles(people), fo = fr.owner, fb = fr.backup, roleIssue = false;
      var role = function (i) { roleIssue = true; i.area = 'People'; i.paths = ['people.json']; i.help = HELP.left; add(i); };
      if (fr.owners.length > 1 || fr.backups.length > 1) role({ id: 'folder-roles', severity: 'warn', title: 'people.json names more than one ' + (fr.owners.length > 1 ? 'folder owner' : 'backup owner'), detail: (fr.owners.length > 1 ? fr.owners : fr.backups).map(function (p) { return p.name; }).join(' and ') + ' both have it. Flightdeck uses the first; edit people.json so one person has each role.', action: help(HELP.left, 'How people.json works') });
      if (!fo) role({ id: 'folder-owner', severity: 'info', title: 'Nobody is the folder owner', detail: 'The folder owner and a backup owner keep the people list in Settings. Give one person "folderRole": "owner" in people.json (your AI assistant can do it).', action: help(HELP.left, 'How people.json works') });
      else if (fo.inactive) role({ id: 'folder-owner', severity: 'warn', title: 'The folder owner, ' + fo.name + ', is marked inactive', detail: fb && !fb.inactive ? fb.name + ', the backup owner, can make someone else the folder owner in Settings, People.' : 'Nobody active can change the people list in Flightdeck. Give someone "folderRole": "owner" in people.json.', action: { act: 'nav', id: 'settings', label: 'See the people list' } });
      else if (!fb && people.filter(function (p) { return !p.inactive; }).length > 1) role({ id: 'folder-backup', severity: 'info', title: 'No backup owner for the people list', detail: 'If ' + fo.name + ' is away or leaves, nobody else can add people in Flightdeck. Choose a backup owner in Settings, People.', action: { act: 'nav', id: 'settings', label: 'Choose a backup owner' } });
      else if (fb && fb.inactive) role({ id: 'folder-backup', severity: 'info', title: 'The backup owner, ' + fb.name + ', is marked inactive', detail: 'Choose another backup owner in Settings, People.', action: { act: 'nav', id: 'settings', label: 'Choose a backup owner' } });
      if (!dup.length && !gone.length && !roleIssue && !(snap.me && !ids[snap.me])) ok('people', 'people.json lists ' + plural(people.length, 'person', 'people') + (snap.me ? ', you included' : '') + ', with ' + (fb ? 'a folder owner and backup owner' : 'a folder owner') + ', and every checklist owner is on it.');
    }

    /* ---- conflict copies and OneDrive copies ---- */
    var unreadKeys = Object.create(null);
    (d.unreadable || []).forEach(function (u) { if (u.key) unreadKeys[u.key] = true; });
    /* A run kept from an earlier read whose file can't be read now: its copies are found by name below, not from that read. */
    var conflicted = runs.filter(function (r) { return r._conflicts && r._conflicts.length && !(scan && unreadKeys[r.process + '/' + r.id]); });
    conflicted.forEach(function (r) { add({ id: 'conflicts:' + r.process + '/' + r.id, severity: 'stop', area: 'Runs', title: '"' + r.title + '" has ' + plural(r._conflicts.length, 'other version'), detail: 'Two windows saved it without seeing each other. Compare the copies and keep the right one; nothing is merged for you.', paths: r._conflicts.map(function (n) { return 'runs/' + r.process + '/' + r.id + '/' + n; }), action: { act: 'open-run', id: r.process + '/' + r.id, label: 'Compare copies' }, help: HELP.conflicts }); });
    /* Conflict copies in a run folder whose run.json is missing or couldn't be read: no run page lists them, so they're
       found by name. */
    var orphans = Object.create(null), hasRun = Object.create(null);
    if (scan) {
      scan.list.forEach(function (f) { var m = /^runs\/([^/]+\/[^/]+)\/run\.json$/.exec(f.p); if (m) hasRun[m[1]] = true; });
      scan.list.forEach(function (f) {
        var m = /^runs\/([^/]+\/[^/]+)\/([^/]+)$/.exec(f.p);
        if (!m || m[2] === 'run.json' || (hasRun[m[1]] && !unreadKeys[m[1]])) return;
        var kind = /^candidate-.+\.json$/.test(m[2]) ? 'saved' : /^run.*\.json$/i.test(m[2]) ? 'copy' : '';
        if (kind) (orphans[m[1]] = orphans[m[1]] || { copy: [], saved: [], young: [] })[kind === 'saved' && f.m != null && now - f.m < LIMITS.saveGraceMs ? 'young' : kind].push(f.p);
      });
    }
    /* A save receipt younger than 2 minutes may be a first save whose run.json hasn't been written or arrived yet. */
    Object.keys(orphans).forEach(function (k) {
      var o = orphans[k];
      if (o.copy.length || o.saved.length) return;
      delete orphans[k];
      add({ id: 'saving:' + k, severity: 'info', area: 'Runs', title: 'A save may still be finishing in runs/' + k, detail: 'A save receipt arrived but run.json hasn\'t yet. That\'s normal for a run that was just started; check again in a minute.', paths: o.young, action: { act: 'health-again', id: '', label: 'Check again' }, help: HELP.gone });
    });
    Object.keys(orphans).sort().forEach(function (k) {
      var o = orphans[k], why = hasRun[k] ? 'can\'t be read' : 'is missing';
      add({ id: 'orphans:' + k, severity: 'stop', area: 'Runs', title: o.copy.length ? plural(o.copy.length, 'copy', 'copies') + ' of a run whose run.json ' + why : 'A saved copy of a run whose run.json ' + why,
        detail: 'runs/' + k + '/run.json ' + why + ', so no run page shows ' + (o.copy.length ? 'its other versions' : 'it') + '.' + (o.saved.length ? ' ' + plural(o.saved.length, 'save receipt') + ' (candidate-…json) hold' + (o.saved.length === 1 ? 's' : '') + ' the run as of a save.' : '') + ' Wait for OneDrive; if run.json doesn\'t come back, bring it back from one of these or a backup.',
        paths: o.copy.concat(o.saved), action: help(HELP.gone), help: HELP.gone });
    });
    /* Runs this window holds whose file is gone from the folder (deleted or moved): never written back without asking. */
    Object.keys(snap.missing || {}).sort().forEach(function (k) {
      var r = runs.filter(function (x) { return x.process + '/' + x.id === k; })[0];
      add({ id: 'missing:' + k, severity: 'stop', area: 'Runs', title: '"' + (r ? r.title : k) + '" is gone from the team folder', detail: 'Its run.json isn\'t there any more. Someone may have deleted or moved it. This window still has the version it read; nothing is written back unless someone chooses Restore it here.', paths: ['runs/' + k + '/run.json'], action: { act: 'open-run', id: k, label: 'Open the run' }, help: HELP.gone });
    });
    var shared = sharedDrafts(d.drafts);
    shared.forEach(function (s) { add({ id: 'shared:' + s.process, severity: 'stop', area: 'Checklists', title: plural(s.files.length, 'draft') + ' say process: ' + s.process, detail: 'Flightdeck shows only one of them, so you may publish the wrong one. Agree which is right, copy anything missing into it, and delete the other.', paths: s.files.map(function (f) { return 'maps/drafts/' + f; }), action: help(HELP.copies), help: HELP.copies }); });
    var copies = [];
    if (scan) {
      var dirs = Object.create(null);
      scan.list.forEach(function (f) { var i = f.p.lastIndexOf('/'), dir = i < 0 ? '' : f.p.slice(0, i); (dirs[dir] = dirs[dir] || Object.create(null))[f.p.slice(i + 1)] = true; });
      scan.list.forEach(function (f) { if (!copyArea(f.p)) return; var i = f.p.lastIndexOf('/'), dir = i < 0 ? '' : f.p.slice(0, i), of = copyOf(f.p.slice(i + 1), dirs[dir]); if (of) copies.push({ path: f.p, of: (dir ? dir + '/' : '') + of }); });
    }
    var sharedPaths = Object.create(null); shared.forEach(function (s) { s.files.forEach(function (f) { sharedPaths['maps/drafts/' + f] = true; }); });
    copies = copies.filter(function (c) { return !sharedPaths[c.path]; });
    if (copies.length) add({ id: 'copies', severity: 'stop', area: 'Files', title: copies.length === 1 ? 'OneDrive kept a second copy of ' + copies[0].of : 'OneDrive kept ' + plural(copies.length, 'second copy', 'second copies') + ' of files',
      detail: 'Two people saved the same file before OneDrive delivered the first save. Decide which is right, copy anything missing into it, and delete the other.', paths: copies.map(function (c) { return c.path; }), action: help(HELP.copies), help: HELP.copies });
    if (!conflicted.length && !shared.length && !copies.length && !Object.keys(orphans).length && !Object.keys(snap.missing || {}).length) ok('copies', scan ? 'No conflict copies, and no second copies from OneDrive.' : 'No run has conflict copies.');

    /* ---- publications ---- */
    var clashes = 0, arriving = [], stuck = [], newerPubs = [], newerVers = [];
    procs.forEach(function (p) {
      (p.index && p.index.clashes || []).forEach(function (v) { clashes++; add({ id: 'clash:' + p.process + ':' + v, severity: 'stop', area: 'Checklists', title: 'Two people published v' + v + ' of "' + p.process + '" at once', detail: 'Neither copy is used until one is removed. Open the process to see both.', paths: ['publications/' + p.process], action: { act: 'open-process', id: p.process, label: 'Open the process' }, help: HELP.syncing }); });
      (p.pubs || []).forEach(function (x) {
        var base = 'publications/' + p.process + '/' + x.folder;
        if (x.ok) return;
        if (x.unusable) { newerPubs.push(base); if (x.newer) newerVers.push({ path: base, v: 'v' + (x.info && x.info.version) + ' of ' + p.process, needs: x.needs || '' }); return; }
        var newest = scan && scan.pubs ? scan.pubs[base] : null;
        if (newest != null && now - newest > LIMITS.halfSyncMs) stuck.push({ path: base, age: now - newest, why: x.why }); else arriving.push(base);
      });
    });
    stuck.forEach(function (s) { add({ id: 'half:' + s.path, severity: 'warn', area: 'Checklists', title: s.path.split('/').slice(1).join(' ') + ' has been incomplete for ' + span(s.age), detail: s.why + ' Nobody can start a run on it. Check that OneDrive is syncing on the computer that published it.', paths: [s.path], action: help(HELP.syncing), help: HELP.syncing }); });
    if (arriving.length) add({ id: 'arriving', severity: 'info', area: 'Checklists', title: plural(arriving.length, 'published version') + ' still arriving', detail: 'Some of ' + (arriving.length === 1 ? 'its' : 'their') + ' files haven\'t reached this computer yet. They can be used once they all arrive.', paths: arriving, action: { act: 'health-again', id: '', label: 'Check again' }, help: HELP.syncing });
    if (!clashes && !stuck.length && !arriving.length) ok('pubs', 'Every published version is complete, with no clashing numbers.');

    /* ---- follow-ups: disappearing from Home isn't resolution ---- */
    var oldFus = PF.followups.stale(PF.followups.list(runs, d.fuDecisions || []), now);
    if (oldFus.length) add({ id: 'followups-stale', severity: 'warn', area: 'Follow-ups', title: plural(oldFus.length, 'follow-up') + ' open for more than 30 days',
      detail: 'The oldest is "' + oldFus[0].text + '" from "' + oldFus[0].runTitle + '", added ' + span(now - Date.parse(oldFus[0].at)) + ' ago. Mark each one done, moved or won\'t do, so what\'s open is what\'s real.',
      paths: oldFus.map(function (x) { return 'runs/' + x.process + '/' + x.run + '/run.json'; }).filter(function (x, i, a) { return a.indexOf(x) === i; }), action: { act: 'nav', id: 'followups', label: 'Review follow-ups' } });
    else ok('followups', 'No follow-up has been open for more than 30 days.');

    /* ---- runs: hand-offs, abandoned, leftovers ---- */
    var handoffs = 0, abandoned = 0;
    runs.forEach(function (r) {
      if (r.ended || r.state !== 'running') return;
      var key = r.process + '/' + r.id, h = r.recorder && r.recorder.handoff, hat = h && ms(h.at);
      if (h && !r.recorder.session && hat != null && now - hat > LIMITS.handoffMs) { handoffs++; add({ id: 'handoff:' + key, severity: 'warn', area: 'Runs', title: '"' + r.title + '" was handed to ' + nameOf(people, r.recorder.person) + ' ' + span(now - hat) + ' ago', detail: 'Nobody has picked it up. If the hand-off never arrived on their computer, they can pick it up once it does, or take over.', paths: ['runs/' + key + '/run.json'], action: { act: 'open-run', id: key, label: 'Open the run' }, help: HELP.syncing }); return; }
      var last = ms(r.savedAt) || ms(r.created), rec = r.recorder && r.recorder.person, who = rec && ids[rec];
      var why = rec && people.length && !who ? 'Its recorder, ' + rec + ', isn\'t in people.json.' : who && who.inactive ? 'Its recorder, ' + who.name + ', is marked inactive.' : last != null && now - last > LIMITS.abandonedMs ? 'Nothing was saved for ' + span(now - last) + '.' : '';
      if (why) { abandoned++; add({ id: 'abandoned:' + key, severity: 'warn', area: 'Runs', title: '"' + r.title + '" looks abandoned', detail: why + ' Finish it, end it as Stopped early, or have someone take over.', paths: ['runs/' + key + '/run.json'], action: { act: 'open-run', id: key, label: 'Open the run' }, help: HELP.left }); }
    });
    if (!handoffs && !abandoned) ok('runs', runs.some(function (r) { return !r.ended && r.state === 'running'; }) ? 'Every running run has a recorder on the team, and no hand-off is waiting.' : 'No runs are waiting on anyone.');
    if (scan) {
      var tmp = scan.list.filter(function (f) { return /\.tmp$/i.test(f.p) && f.m != null && now - f.m > LIMITS.tmpMs; });
      var cands = [];
      runs.forEach(function (r) {
        var dir = 'runs/' + r.process + '/' + r.id + '/', lin = r.lineage || [], newest = lin[lin.length - 1];
        scan.list.forEach(function (f) { if (f.p.indexOf(dir) !== 0 || f.p.slice(dir.length).indexOf('/') >= 0) return; var m = /^candidate-(.+)-([a-z0-9]{8})\.json$/.exec(f.p.slice(dir.length)); if (m && lin.indexOf(m[1] + '.' + m[2]) >= 0 && m[1] + '.' + m[2] !== newest && f.m != null && now - f.m > LIMITS.tmpMs) cands.push(f.p); });
      });
      if (tmp.length) add({ id: 'tmp', severity: 'warn', area: 'Files', title: plural(tmp.length, 'leftover temporary file'), detail: 'A save or a copy stopped partway. If nobody is saving right now, they can be deleted.', paths: tmp.map(function (f) { return f.p; }), action: help(HELP.leftover), help: HELP.leftover });
      if (cands.length) add({ id: 'candidates', severity: 'info', area: 'Runs', title: plural(cands.length, 'old save receipt') + ' left in run folders', detail: 'Their saves are already in the run, so nothing is lost. The next save of each run tidies them away.', paths: cands, action: help(HELP.leftover), help: HELP.leftover });
      if (!tmp.length && !cands.length) ok('leftover', 'No leftover temporary files.');
    }

    /* ---- newer copies: what a newer Flightdeck wrote, by family and the version each needs ---- */
    var ro = runs.filter(function (r) { return r._unrunnable; }), inst = scan && scan.installed && typeof scan.installed === 'object' && !scan.installed.newer ? scan.installed : null;
    var instNewer = scan && scan.installed && scan.installed.newer ? scan.installed : null, refused = (d.refused || []).concat(scan && scan.reports ? scan.reports.problems.filter(function (x) { return x.kind === 'newer'; }).map(function (x) { return { path: x.path, family: 'flightdeck-report', kind: 'newer', why: x.why, needs: x.needs || '' }; }) : []);
    var newerInst = inst && typeof inst.version === 'string' && snap.app && snap.app !== 'dev' && semver(inst.version, snap.app) > 0 ? inst.version : null;
    if (ro.length || newerPubs.length || snap.newer || newerInst || instNewer || refused.length) {
      var parts = [], needs = function (n) { return n ? 'Flightdeck ' + n : 'a newer Flightdeck'; };
      if (snap.newer) parts.push('Flightdeck ' + snap.newer + ' is in the team folder');
      if (newerInst) parts.push('flightdeck install ' + newerInst + ' set up the folder');
      if (instNewer) parts.push('.flightdeck/installed.json needs ' + needs(instNewer.needs));
      newerVers.forEach(function (x) { parts.push(x.v + ' needs ' + needs(x.needs)); });
      if (newerPubs.length > newerVers.length) parts.push(plural(newerPubs.length - newerVers.length, 'version') + ' can\'t be run here');
      var made = ro.filter(function (r) { return r._needs != null; }), tests = made.filter(function (r) { return r._test; });
      if (made.length) parts.push(plural(made.length, 'run') + ' made with ' + needs(made[0]._needs) + (tests.length ? ' (' + plural(tests.length, 'test run') + ')' : '') + ' show' + (made.length === 1 ? 's' : '') + ' by name only');
      if (ro.length > made.length) parts.push(plural(ro.length - made.length, 'run') + ' open' + (ro.length - made.length === 1 ? 's' : '') + ' read-only here');
      var NAMES = { 'flightdeck-plan': ['plan', 'plans'], 'flightdeck-plan-status': ['plan decision', 'plan decisions'], 'flightdeck-validation': ['sign-off', 'sign-offs'], 'flightdeck-step-type': ['step type', 'step types'], 'flightdeck-skill': ['skill registration', 'skill registrations'], 'flightdeck-followup-decision': ['follow-up decision', 'follow-up decisions'], 'flightdeck-correction-decision': ['correction decision', 'correction decisions'], 'flightdeck-fix-decision': ['decision', 'decisions'], 'flightdeck-report': ['report', 'reports'], 'flightdeck-report-decision': ['decision on a report', 'decisions on reports'] };
      var byFam = {}; refused.forEach(function (x) { var k = x.family + '|' + (x.needs || ''); (byFam[k] = byFam[k] || []).push(x); });
      Object.keys(byFam).sort().forEach(function (k) { var x = byFam[k], n = NAMES[x[0].family] || ['file', 'files']; parts.push(x.length + ' ' + (x.length === 1 ? n[0] : n[1]) + ' need' + (x.length === 1 ? 's ' : ' ') + needs(x[0].needs)); });
      add({ id: 'newer', severity: 'warn', area: 'Flightdeck', title: 'A newer Flightdeck wrote some of these files', detail: parts.join('; ') + '. This copy shows them and leaves them alone. Open the team folder\'s own flightdeck.html.', paths: newerPubs.concat(ro.map(function (r) { return 'runs/' + r.process + '/' + r.id + '/run.json'; }), refused.map(function (x) { return x.path; }), instNewer ? ['.flightdeck/installed.json'] : []), action: help(HELP.newer), help: HELP.newer });
    } else ok('newer', 'Nothing here was written by a newer Flightdeck.');
    /* ---- reports from other apps: ones that can't be read, copies that differ, ones for a run that isn't here ---- */
    var rep = d.reports || { files: [], bad: [] }, runKeys = Object.create(null);
    runs.forEach(function (r) { runKeys[r.process + '/' + r.id] = true; });
    Object.keys(d.reads || {}).forEach(function (k) { runKeys[k] = true; });
    var repBad = (rep.bad || []).map(function (b) { return { path: b.path, why: b.why }; })
      .concat(scan && scan.reports ? scan.reports.problems.filter(function (x) { return x.kind !== 'newer'; }) : [])
      .concat((d.repUnread || []).filter(function (u) { return u.kind !== 'newer'; }).map(function (u) { return { path: u.dir + '/' + u.process + '/' + u._file, why: u.why || 'couldn\'t be read' }; }));
    var repDiffer = scan && scan.reports ? scan.reports.differ : [];
    var named = Object.create(null); repBad.concat(refused).forEach(function (x) { named[x.path] = true; });
    /* A report names a run that isn't here only when the runs were listed completely: a listing that failed isn't absence. */
    var orphans = (d.failed || {}).runs ? [] : (rep.files || []).filter(function (f) { return !runKeys[f.process + '/' + f.run] && !named[f.path]; });
    if (repBad.length || repDiffer.length || orphans.length) {
      var rparts = [];
      if (repBad.length) rparts.push(repBad[0].path + ' ' + repBad[0].why + (repBad.length > 1 ? ' (and ' + plural(repBad.length - 1, 'other file') + ')' : ''));
      if (repDiffer.length) rparts.push(plural(repDiffer.length, 'report') + ' ha' + (repDiffer.length === 1 ? 's' : 've') + ' copies that differ, so neither can be accepted until the wrong one is deleted');
      if (orphans.length) rparts.push(plural(orphans.length, 'report') + ' name' + (orphans.length === 1 ? 's' : '') + ' a run that isn\'t in the folder (' + orphans[0].process + '/' + orphans[0].run + ')');
      add({ id: 'reports', severity: 'warn', area: 'Runs', title: 'Some reports from other apps can\'t be used', detail: rparts.join('; ') + '. Nothing is checked from them.', paths: repBad.map(function (x) { return x.path; }).concat([].concat.apply([], repDiffer.map(function (x) { return x.paths; })), orphans.map(function (f) { return f.path; })), action: help(HELP.reports), help: HELP.reports });
    } else if ((rep.files || []).length) ok('reports', 'Every report from another app can be read and names a run here.');
    /* An older copy's Restore beside a run it could only list by name leaves a placeholder (no steps, no answers): beside a run
       this copy lists by name only, or a run/3 it reads in full. */
    var ph = scan && scan.placeholders ? scan.placeholders.filter(function (p) { var m = /^runs\/([^/]+)\/([^/]+)\//.exec(p); return m && runs.some(function (r) { return r.process === m[1] && r.id === m[2] && (r._needs != null || r.format === PF.run.FORMAT3); }); }) : [];
    if (ph.length) add({ id: 'placeholder', severity: 'info', area: 'Runs', title: plural(ph.length, 'placeholder') + ' left by an older Flightdeck', detail: 'An older Flightdeck left ' + (ph.length === 1 ? 'this placeholder' : 'these placeholders') + ' beside a run made with a newer one. ' + (ph.length === 1 ? 'It holds' : 'They hold') + ' no answers. Once the run reads correctly in the newer Flightdeck, ' + (ph.length === 1 ? 'it' : 'they') + ' can be deleted.', paths: ph, action: help(HELP.placeholder), help: HELP.placeholder });

    /* ---- copies seen lately: older Flightdecks that answered connection checks or edited drafts here ---- */
    var seen = Object.create(null), mine = semverOf(snap.app);
    (snap.connection ? (snap.connection.probes || []).concat(snap.connection.acks || []) : []).forEach(function (x) { note(x.app, x.at); });
    (d.presence || []).forEach(function (p) { if (p && p.rec) note(p.rec.app, p.rec.at); });
    function note(app, at) { var t = ms(at), v = semverOf(app); if (!v || t == null || now - t > 7 * DAY || now - t < -LIMITS.skewMs) return; if (mine && cmpV(v, mine) >= 0) return; seen[v.join('.')] = v; }
    var olds = Object.keys(seen).map(function (k) { return seen[k]; }).sort(cmpV).map(function (v) { return v.join('.'); });
    if (olds.length) {
      var floor = olds.filter(function (v) { return cmpV(semverOf(v), [1, 11, 1]) < 0; });
      add({ id: 'older-copies', severity: floor.length ? 'warn' : 'info', area: 'Flightdeck', title: 'Teammates are using an older Flightdeck',
        detail: 'In the last 7 days, windows running Flightdeck ' + listOf(olds) + ' answered connection checks or edited drafts here.' + (floor.length ? ' Flightdeck ' + listOf(floor) + ' can\'t tell what a newer Flightdeck wrote: it may hide runs made with Flightdeck 2.0 and offer a version it can\'t read.' : '') + ' Move every computer to ' + (snap.app && snap.app !== 'dev' ? 'Flightdeck ' + snap.app : 'this Flightdeck') + ' before anyone uses Flightdeck 2.0 features, and re-enter any change an older window said it couldn\'t save.',
        paths: [], action: help(HELP.older), help: HELP.older });
    } else if (snap.connection || d.presence) ok('older-copies', 'No older Flightdeck answered a connection check or edited a draft here in the last 7 days.');

    /* ---- the same writer name twice: notes with one ID and different text, or one writer on two computers ---- */
    var clashNotes = [];
    runs.forEach(function (r) { var seen = Object.create(null); (r._notes || []).forEach(function (n) { var k = n.id; if (seen[k] != null && seen[k] !== n.text + '\u0000' + n.by) clashNotes.push('runs/' + r.process + '/' + r.id); seen[k] = n.text + '\u0000' + n.by; }); });
    var conn = snap.connection, devs = Object.create(null), twoDevs = [];
    /* Compared without the name a person gives the browser, which they may change between two checks. */
    var sys = function (dv) { return String(dv || '').split(' · ').slice(-2).join(' · '); };
    if (conn) (conn.probes || []).concat(conn.acks || []).forEach(function (x) { if (!x.writer) return; var dv = sys(x.device); if (devs[x.writer] && devs[x.writer] !== dv) { if (twoDevs.indexOf(x.writer) < 0) twoDevs.push(x.writer); } devs[x.writer] = dv; });
    if (clashNotes.length || twoDevs.length) add({ id: 'same-name', severity: 'stop', area: 'Windows', title: 'Two windows wrote under the same name', detail: clashNotes.length ? 'Notes with the same ID but different text are in ' + plural(dedupe(clashNotes).length, 'run') + '. Reload every Flightdeck window, then check those runs\' notes.' : 'Connection checks from two computers carry the same window name. Reload Flightdeck on both.', paths: dedupe(clashNotes).concat(twoDevs.map(function (w) { return 'connection/*.' + w + '.json'; })), action: help(HELP.sameName), help: HELP.sameName });

    /* ---- clocks: anything dated well in the future was written by a computer whose clock is ahead (or this one is behind) ---- */
    var ahead = 0, aheadPath = '';
    function future(t, path) { if (t != null && t - now > LIMITS.skewMs && t - now > ahead) { ahead = t - now; aheadPath = path; } }
    runs.forEach(function (r) { future(ms(r.savedAt), 'runs/' + r.process + '/' + r.id + '/run.json'); (r._notes || []).forEach(function (n) { future(ms(n.at), 'runs/' + r.process + '/' + r.id); }); });
    if (conn) (conn.probes || []).concat(conn.acks || []).forEach(function (x) { future(ms(x.at), 'connection/' + x._file); });
    if (scan) scan.list.forEach(function (f) { future(f.m, f.p); });
    if (ahead) add({ id: 'clock', severity: 'warn', area: 'Clocks', title: 'A computer\'s clock is off by ' + span(ahead) + ' or more', detail: aheadPath + ' is dated ' + span(ahead) + ' ahead of this computer\'s clock. Times from that computer will look wrong; deadlines still come from the real tools. The connection check shows whose clock differs.', paths: [aheadPath], action: { act: 'connection', id: '', label: 'Check the connection' }, help: HELP.syncing });
    else ok('clock', 'No file is dated in the future, so clocks look close enough.');

    /* ---- capacity ---- */
    var big = 0;
    function cap(id, sev, title, detail, paths) { big++; add({ id: id, severity: sev, area: 'Size', title: title, detail: detail, paths: paths || [], action: help(HELP.big), help: HELP.big }); }
    var nRuns = runs.length + (d.unreadable || []).filter(function (u) { return /run\.json$/.test(u.path); }).length;
    if (nRuns > LIMITS.runsStop) cap('cap-runs', 'stop', plural(nRuns, 'run') + ' in one folder', 'Past ' + LIMITS.runsStop.toLocaleString('en-US') + ', opening and refreshing get slow on every computer. Start a new team folder for new runs and keep this one as the record.');
    else if (nRuns > LIMITS.runsWarn) cap('cap-runs', 'warn', plural(nRuns, 'run') + ' in one folder', 'Refreshing still works, but the first read is getting slower. Past ' + LIMITS.runsStop.toLocaleString('en-US') + ', start a new team folder.');
    var st = d.stepTypes || {};
    if (st.skipped) cap('cap-types', 'warn', plural(st.skipped, 'step-type file') + ' not read', 'Flightdeck reads the first ' + LIMITS.types + ' files in step-types/. Remove types nobody uses, so every one you need is read.', ['step-types']);
    if (d.skillsSkipped) cap('cap-skills', 'warn', plural(d.skillsSkipped, 'skill registration') + ' not read', 'Flightdeck reads the first ' + LIMITS.skills + ' files in skills/. Remove registrations of skills nobody uses.', ['skills']);
    /* Measured on this computer, not counted: the last 3 routine refreshes each took more than 15 seconds. */
    var rms = (snap.refreshMs || []).slice(-LIMITS.slowRefreshes);
    if (rms.length === LIMITS.slowRefreshes && rms.every(function (x) { return x > LIMITS.slowRefreshMs; })) {
      var secs = Math.round(rms.reduce(function (a, b) { return a + b; }, 0) / rms.length / 1000);
      cap('slow-refresh', 'warn', 'Refreshing takes about ' + secs + ' seconds on this computer', 'The last ' + LIMITS.slowRefreshes + ' refreshes each took more than ' + LIMITS.slowRefreshMs / 1000 + ' seconds. Changes from other computers show up later, and the app may feel slow. A smaller team folder reads faster.');
    }
    if (scan) {
      var per = Object.create(null), attach = 0, longPaths = [];
      scan.list.forEach(function (f) {
        var m = /^runs\/([^/]+\/[^/]+)\//.exec(f.p);
        if (m) per[m[1]] = (per[m[1]] || 0) + 1;
        if (/^runs\/[^/]+\/[^/]+\/files\//.test(f.p)) attach += f.s || 0;
        if (f.p.length > LIMITS.pathChars) longPaths.push(f.p);
      });
      Object.keys(per).forEach(function (k) { if (per[k] > LIMITS.runFiles) cap('cap-run-files:' + k, 'warn', 'A run folder holds ' + plural(per[k], 'file'), 'runs/' + k + ' is slow to read and to copy. Attach fewer, larger files (a .zip) next time.', ['runs/' + k]); });
      if (attach > LIMITS.attachBytes) cap('cap-attach', 'warn', 'Attachments take ' + bytes(attach), 'OneDrive keeps every file on every computer that has the folder. Keep big logs elsewhere and attach a link or a short excerpt.', ['runs']);
      if (longPaths.length) cap('cap-paths', 'warn', plural(longPaths.length, 'file path') + ' longer than ' + LIMITS.pathChars + ' characters', 'Windows and OneDrive refuse paths that get too long once the team folder\'s own location is added. Shorten process or file names.', longPaths);
      if (scan.truncated) cap('cap-scan', 'warn', 'The folder has more files than one check reads', 'Folder health stopped after ' + plural(scan.files, 'file') + '. Its counts are lower limits.', []);
    }
    if (!big) ok('size', scan ? 'Comfortable size: ' + plural(nRuns, 'run') + ', ' + bytes(scan.bytes || 0) + ' in all, the longest path ' + (scan.longest || 0) + ' characters.' : 'Comfortable size: ' + plural(nRuns, 'run') + '.');

    /* ---- the files for AI assistants ---- */
    if (scan) contract(scan, snap, add, ok);

    /* ---- step types, skills, Jira workflows that don't check out (each page shows the details) ---- */
    var te = (d.stepTypes || {}).errors || [], se = (d.skills || []).filter(function (x) { return x.errors && x.errors.length; }), je = (d.jira || {}).errors || [];
    if (te.length) add({ id: 'types-errors', severity: 'warn', area: 'Step types', title: plural(te.length, 'step type') + ' can\'t be used', detail: 'step-types/' + te[0].file + ': ' + te[0].errors.join('; ') + '.', paths: te.map(function (e) { return 'step-types/' + e.file; }), action: { act: 'nav', id: 'types', label: 'Open Step types' }, help: HELP.unreadable });
    if (se.length) add({ id: 'skills-errors', severity: 'warn', area: 'Skills', title: plural(se.length, 'skill registration') + ' can\'t be matched', detail: se[0].errors[0] + '.', paths: se.map(function (x) { return 'skills/' + (x.file || ''); }), action: { act: 'nav', id: 'skills', label: 'Open Skills' }, help: HELP.unreadable });
    if (je.length) add({ id: 'jira-errors', severity: 'warn', area: 'Jira', title: 'jira/workflows.json has ' + plural(je.length, 'problem'), detail: je[0] + '.', paths: ['jira/workflows.json'], action: help(HELP.unreadable), help: HELP.unreadable });
    if (!te.length && !se.length && !je.length) ok('defs', 'Step types, skill registrations and Jira workflows all check out.');

    issues.sort(function (a, b) { return ORDER[a.severity] - ORDER[b.severity]; });
    var counts = { stop: 0, warn: 0, info: 0 };
    issues.forEach(function (i) { counts[i.severity]++; });
    return { issues: issues, clear: clear, scanned: !!scan, counts: counts };
  }

  /* AGENTS.md's Flightdeck part and the skills, against every default ever shipped (src/baselines.json) and the folder's
     .flightdeck/installed.json. A team's own change is fine; an old default or a file waiting to be merged is worth a look. */
  function contract(scan, snap, add, ok) {
    var B = C.BASELINES && C.BASELINES.files, h = snap.contract && snap.contract.hashes;
    if (!B || !Object.keys(B).length) return;
    if (!h) { ok('contract', 'The files for AI assistants weren\'t compared: this browser can\'t compute their fingerprints.'); return; }
    var old = [], custom = [], missing = [], app = snap.app;
    Object.keys(B).forEach(function (key) {
      var path = key === C.AGENTS + '#flightdeck' ? C.AGENTS : key, hex = h[path];
      if (hex == null) { missing.push(path); return; }
      var vers = B[key][hex];
      if (!vers) custom.push(path);
      else if (app && app !== 'dev' && vers.indexOf(app) < 0) old.push(path);
    });
    var cmd = { act: 'health-cmd', id: 'install', label: 'Copy the command' };
    var noAgents = missing.indexOf(C.AGENTS) >= 0;
    if (noAgents || missing.length === Object.keys(B).length) add({ id: 'contract-missing', severity: 'warn', area: 'AI assistants', title: noAgents ? 'AGENTS.md isn\'t in the team folder' : 'The skills for AI assistants aren\'t in the team folder', detail: 'AI assistants working in the folder need it to know the rules. flightdeck install adds what\'s missing and keeps anything your team changed.', paths: missing, action: cmd, help: HELP.newer });
    else if (missing.length) add({ id: 'contract-missing', severity: 'info', area: 'AI assistants', title: plural(missing.length, 'Flightdeck skill') + ' missing', detail: 'Your team may have removed ' + (missing.length === 1 ? 'it' : 'them') + ' on purpose. flightdeck install puts back what\'s missing.', paths: missing, action: cmd, help: HELP.newer });
    if (old.length) add({ id: 'contract-old', severity: 'warn', area: 'AI assistants', title: plural(old.length, 'file') + ' for AI assistants ' + (old.length === 1 ? 'is' : 'are') + ' from an older Flightdeck', detail: 'flightdeck install updates ' + (old.length === 1 ? 'it' : 'them') + ' to ' + app + ' and keeps anything your team changed.', paths: old, action: cmd, help: HELP.newer });
    if (scan.updates && scan.updates.length) add({ id: 'contract-merge', severity: 'warn', area: 'AI assistants', title: plural(scan.updates.length, 'new default') + ' waiting to be merged', detail: 'flightdeck install left them in .flightdeck/updates/ because your team had changed those files. Hand its README.md to your AI assistant.', paths: scan.updates, action: { act: 'health-cmd', id: 'merge', label: 'Copy a request for your AI assistant' }, help: HELP.newer });
    if (scan.installed === null && !noAgents) add({ id: 'contract-record', severity: 'info', area: 'AI assistants', title: 'No record of which defaults this folder started from', detail: 'flightdeck install writes .flightdeck/installed.json, so later updates can tell a default from your team\'s change.', paths: ['.flightdeck/installed.json'], action: cmd, help: HELP.newer });
    if (scan.installed === 'bad') add({ id: 'contract-record', severity: 'warn', area: 'AI assistants', title: '.flightdeck/installed.json can\'t be read', detail: 'flightdeck install writes it again.', paths: ['.flightdeck/installed.json'], action: cmd, help: HELP.unreadable });
    if (!old.length && !missing.length && !(scan.updates && scan.updates.length)) ok('contract', custom.length ? 'The files for AI assistants are current; ' + plural(custom.length, 'file has', 'files have') + ' your team\'s own changes, which updates keep.' : 'The files for AI assistants match this version of Flightdeck.');
  }

  function dedupe(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function semver(a, b) { var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (var i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; }

  /* The command or request an issue's "Copy" action puts on the clipboard. */
  function command(id) {
    if (id === 'merge') return 'Merge the new Flightdeck defaults in .flightdeck/updates/ into this team folder, as the README.md there says. Keep our team\'s changes, and delete each copy once it\'s merged.';
    return 'flightdeck install <team folder> --check';
  }

  /* The whole report as plain text, for Copy details: paste it to a teammate or your AI assistant. */
  function text(report, o) {
    o = o || {};
    var lines = ['Flightdeck folder health' + (o.folder ? ': ' + o.folder : ''), 'Checked ' + (o.at || '') + (o.app ? ' by Flightdeck ' + o.app : '') + (o.files != null ? ', ' + plural(o.files, 'file') + ' read' : '')];
    var groups = [['stop', 'Needs action'], ['warn', 'Worth a look'], ['info', 'For your information']];
    groups.forEach(function (g) {
      var list = report.issues.filter(function (i) { return i.severity === g[0]; });
      if (!list.length) return;
      lines.push('', g[1] + ' (' + list.length + ')');
      list.forEach(function (i) {
        lines.push('- ' + i.title, '  ' + i.detail);
        if (i.paths.length) lines.push('  Files: ' + i.paths.slice(0, 10).join(', ') + (i.paths.length > 10 ? ' and ' + (i.paths.length - 10) + ' more' : ''));
        if (i.help) lines.push('  See docs/recovery.md#' + i.help);
      });
    });
    if (report.clear.length) { lines.push('', 'All clear'); report.clear.forEach(function (c) { lines.push('- ' + c.text); }); }
    return lines.join('\n') + '\n';
  }

  /* docs/recovery.md, split into its sections with the anchors GitHub gives them, so the app links to the same places. */
  function anchor(title) { return String(title).trim().toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-'); }
  function sections(md) {
    var out = { title: '', intro: '', list: [] }, cur = null, intro = [];
    String(md || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var h1 = /^# (.+)$/.exec(line), h2 = /^## (.+)$/.exec(line);
      if (h1 && !out.title) { out.title = h1[1].trim(); return; }
      if (h2) { cur = { id: anchor(h2[1]), title: h2[1].trim(), body: [] }; out.list.push(cur); return; }
      (cur ? cur.body : intro).push(line);
    });
    out.intro = intro.join('\n').trim();
    out.list.forEach(function (s) { s.body = s.body.join('\n').trim(); });
    return out;
  }

  return { LIMITS: LIMITS, HELP: HELP, check: check, copyOf: copyOf, sharedDrafts: sharedDrafts, text: text, command: command, sections: sections, anchor: anchor, bytes: bytes, span: span };
})();
