/* Folder health: what in the team folder needs a person, worth a look, or is fine. Pure: it reads a snapshot (what the app
   loaded, plus an on-demand scan of every file) and returns issues, each with exactly one action, and an all-clear list.
   Flightdeck never fixes the folder by itself; each issue says what a person can do. See docs/design.md section 21. */
PF.health = (function () {
  'use strict';
  var U = PF.util, M = PF.map, C = PF.contract;
  var HOUR = 3600000, DAY = 24 * HOUR;
  var LIMITS = { abandonedMs: 7 * DAY, handoffMs: 2 * HOUR, halfSyncMs: 2 * HOUR, tmpMs: 2 * HOUR, skewMs: 10 * 60000,
    runsWarn: 500, runsStop: 2000, types: 100, skills: 500, runFiles: 500, attachBytes: 1024 * 1024 * 1024, pathChars: 200 };
  /* Sections of docs/recovery.md (and the in-app view), by their anchors. */
  var HELP = { conflicts: 'a-run-has-conflict-copies', copies: 'onedrive-made-a-copy-of-a-draft-peoplejson-or-a-step-type', access: 'flightdeck-lost-access-to-the-folder',
    syncing: 'onedrive-isnt-syncing', backup: 'restoring-from-a-backup', left: 'someone-left-the-team', newer: 'a-newer-flightdeck-wrote-files',
    unreadable: 'a-file-cant-be-read', leftover: 'leftover-files', big: 'the-folder-is-getting-big', sameName: 'two-windows-used-the-same-name' };
  var ORDER = { stop: 0, warn: 1, info: 2 };

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
  function copyArea(path) { return !/^runs\//.test(path) && !/^publications\//.test(path) && !/^connection\//.test(path) && !/^images\//.test(path); }

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
    (d.corrUnread || []).forEach(function (u) { if (!u.kept) unread.push({ path: u.dir + '/' + u.process + '/' + u._file, why: 'couldn\'t be read' }); });
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
      var gone = [];
      procs.forEach(function (p) { var l = p.index && p.index.latest, o = l && l.map.meta.owner; if (o && (!ids[o] || ids[o].inactive)) gone.push({ process: p.process, owner: o, why: ids[o] ? 'is marked inactive' : 'isn\'t in people.json' }); });
      gone.forEach(function (g) { add({ id: 'owner:' + g.process, severity: 'warn', area: 'People', title: 'The checklist "' + g.process + '" needs a new owner', detail: 'Its owner, ' + nameOf(people, g.owner) + ', ' + g.why + '. Change owner: in the draft and publish a new version.', paths: ['maps/drafts/' + g.process + '.md'], action: { act: 'open-process', id: g.process, label: 'Open the process' }, help: HELP.left }); });
      if (!dup.length && !gone.length && !(snap.me && !ids[snap.me])) ok('people', 'people.json lists ' + plural(people.length, 'person', 'people') + (snap.me ? ', you included' : '') + ', and every checklist owner is on it.');
    }

    /* ---- conflict copies and OneDrive copies ---- */
    var conflicted = runs.filter(function (r) { return r._conflicts && r._conflicts.length; });
    conflicted.forEach(function (r) { add({ id: 'conflicts:' + r.process + '/' + r.id, severity: 'stop', area: 'Runs', title: '"' + r.title + '" has ' + plural(r._conflicts.length, 'other version'), detail: 'Two windows saved it without seeing each other. Compare the copies and keep the right one; nothing is merged for you.', paths: r._conflicts.map(function (n) { return 'runs/' + r.process + '/' + r.id + '/' + n; }), action: { act: 'open-run', id: r.process + '/' + r.id, label: 'Compare copies' }, help: HELP.conflicts }); });
    /* Conflict copies in a run folder whose run.json is missing or couldn't be read: no run page lists them, so they're
       found by name. */
    var orphans = Object.create(null), loadedRuns = Object.create(null);
    runs.forEach(function (r) { loadedRuns[r.process + '/' + r.id] = true; });
    if (scan) scan.list.forEach(function (f) { var m = /^runs\/([^/]+\/[^/]+)\/([^/]+)$/.exec(f.p); if (m && !loadedRuns[m[1]] && m[2] !== 'run.json' && /^run.*\.json$/i.test(m[2])) (orphans[m[1]] = orphans[m[1]] || []).push(f.p); });
    Object.keys(orphans).sort().forEach(function (k) { add({ id: 'orphans:' + k, severity: 'stop', area: 'Runs', title: plural(orphans[k].length, 'copy', 'copies') + ' of a run that didn\'t load', detail: 'runs/' + k + ' has other versions of a run, but its run.json is missing or can\'t be read, so no run page shows them. Wait for OneDrive, or restore run.json from a backup; then compare the copies in the run.', paths: orphans[k], action: help(HELP.conflicts), help: HELP.conflicts }); });
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
    if (!conflicted.length && !shared.length && !copies.length && !Object.keys(orphans).length) ok('copies', scan ? 'No conflict copies, and no second copies from OneDrive.' : 'No run has conflict copies.');

    /* ---- publications ---- */
    var clashes = 0, arriving = [], stuck = [], newerPubs = [];
    procs.forEach(function (p) {
      (p.index && p.index.clashes || []).forEach(function (v) { clashes++; add({ id: 'clash:' + p.process + ':' + v, severity: 'stop', area: 'Checklists', title: 'Two people published v' + v + ' of "' + p.process + '" at once', detail: 'Neither copy is used until one is removed. Open the process to see both.', paths: ['publications/' + p.process], action: { act: 'open-process', id: p.process, label: 'Open the process' }, help: HELP.syncing }); });
      (p.pubs || []).forEach(function (x) {
        var base = 'publications/' + p.process + '/' + x.folder;
        if (x.ok) return;
        if (x.unusable) { newerPubs.push(base); return; }
        var newest = scan && scan.pubs ? scan.pubs[base] : null;
        if (newest != null && now - newest > LIMITS.halfSyncMs) stuck.push({ path: base, age: now - newest, why: x.why }); else arriving.push(base);
      });
    });
    stuck.forEach(function (s) { add({ id: 'half:' + s.path, severity: 'warn', area: 'Checklists', title: s.path.split('/').slice(1).join(' ') + ' has been incomplete for ' + span(s.age), detail: s.why + ' Nobody can start a run on it. Check that OneDrive is syncing on the computer that published it.', paths: [s.path], action: help(HELP.syncing), help: HELP.syncing }); });
    if (arriving.length) add({ id: 'arriving', severity: 'info', area: 'Checklists', title: plural(arriving.length, 'published version') + ' still arriving', detail: 'Some of ' + (arriving.length === 1 ? 'its' : 'their') + ' files haven\'t reached this computer yet. They can be used once they all arrive.', paths: arriving, action: { act: 'health-again', id: '', label: 'Check again' }, help: HELP.syncing });
    if (!clashes && !stuck.length && !arriving.length) ok('pubs', 'Every published version is complete, with no clashing numbers.');

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

    /* ---- newer copies ---- */
    var ro = runs.filter(function (r) { return r._unrunnable; }), inst = scan && scan.installed && typeof scan.installed === 'object' ? scan.installed : null;
    var newerInst = inst && typeof inst.version === 'string' && snap.app && snap.app !== 'dev' && semver(inst.version, snap.app) > 0 ? inst.version : null;
    if (ro.length || newerPubs.length || snap.newer || newerInst) {
      var parts = [];
      if (snap.newer) parts.push('Flightdeck ' + snap.newer + ' is in the team folder');
      if (newerInst) parts.push('flightdeck install ' + newerInst + ' set up the folder');
      if (newerPubs.length) parts.push(plural(newerPubs.length, 'version') + ' can\'t be run here');
      if (ro.length) parts.push(plural(ro.length, 'run') + ' open' + (ro.length === 1 ? 's' : '') + ' read-only here');
      add({ id: 'newer', severity: 'warn', area: 'Flightdeck', title: 'A newer Flightdeck wrote some of these files', detail: parts.join('; ') + '. This copy leaves them alone. Open the team folder\'s own flightdeck.html.', paths: newerPubs.concat(ro.map(function (r) { return 'runs/' + r.process + '/' + r.id + '/run.json'; })), action: help(HELP.newer), help: HELP.newer });
    } else ok('newer', 'Nothing here was written by a newer Flightdeck.');

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
