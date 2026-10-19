/* App wiring: state, loading, saving, refresh, events. Screens are in views.js; rules are in core/. */
(function () {
  'use strict';
  var U = PF.util, R = PF.run, M = PF.map, T = PF.types, V = PF.views, repo = PF.repo;
  var EXAMPLES = /*@EXAMPLES@*/{};
  /* src/releases.json, checked and embedded by build.py, newest first. The app's version is the newest release; "dev" means
     this is the unbuilt source, not a copy people should use. */
  var RELEASES = /*@RELEASES@*/[];
  var APP_VERSION = RELEASES[0] ? RELEASES[0].version : 'dev';
  /* docs/recovery.md, embedded by build.py: the in-app "When something goes wrong". */
  var RECOVERY = /*@RECOVERY@*/'';
  var LS = 'preflight';
  var resumeEdit = (function () { try { return sessionStorage.getItem('preflight:editing'); } catch (e) { return null; } })();
  var canFolder = typeof window.showDirectoryPicker === 'function';

  function lsGet(k, d) { try { var v = localStorage.getItem(LS + ':' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function applyTheme() { var root = document.documentElement; if (!root || !root.setAttribute) return; if (state.theme === 'light' || state.theme === 'dark') root.setAttribute('data-theme', state.theme); else root.removeAttribute('data-theme'); }
  function lsSet(k, v) { try { localStorage.setItem(LS + ':' + k, JSON.stringify(v)); } catch (e) { /* per-viewer convenience only */ } }
  /* One writer per browser window: a session ID that survives a reload of the same tab. A duplicated tab inherits a copy of
     that ID, so each window announces its ID when it opens; if a live window already uses it, the newcomer takes a fresh one.
     A reload is safe: the old page is gone, so nothing answers. Writes wait until this check is done. */
  var SESSION = (function () {
    try { var s = sessionStorage.getItem(LS + ':session'); if (!s) { s = U.randomId(10); sessionStorage.setItem(LS + ':session', s); } return s; }
    catch (e) { return U.randomId(10); }
  })();
  /* This page load's own writer ID: every file this window writes besides run.json carries it (notes, history, conflict copies,
     plan decisions, attachments), so two windows never write the same file even if their SESSION was copied. SESSION only
     says who is recording; a clash there is caught by the fingerprint check before every save of run.json. */
  var WRITER = U.randomId(10);
  /* Web Locks let windows on this computer take turns saving a run. Without them, nothing can stop two duplicated windows
     racing, so recording belongs to this page load only: a duplicate is view-only, and after a reload one click on
     "Record here" continues the recording. */
  var LOCKS = typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function' ? navigator.locks : null;
  function lock(name, fn) { return LOCKS.request(name, fn); }
  if (!LOCKS) SESSION = WRITER;
  var sessionReady = (function () {
    if (!LOCKS || typeof BroadcastChannel !== 'function') return Promise.resolve();
    var chan, nonce = U.randomId(8), settled = false;
    try { chan = new BroadcastChannel(LS + ':windows'); } catch (e) { return Promise.resolve(); }
    return new Promise(function (res) {
      chan.onmessage = function (e) {
        var m = e.data || {};
        if (m.ask === SESSION && m.nonce !== nonce) chan.postMessage({ taken: SESSION, nonce: m.nonce });
        if (m.taken === SESSION && m.nonce === nonce && !settled) {
          SESSION = U.randomId(10);
          try { sessionStorage.setItem(LS + ':session', SESSION); } catch (err) { /* this window keeps the new ID in memory */ }
          settled = true; res(); if (typeof render === 'function') render();
        }
      };
      chan.postMessage({ ask: SESSION, nonce: nonce });
      setTimeout(function () { settled = true; res(); }, 300);
    });
  })();

  var state = {
    view: 'home', fs: null, me: lsGet('me', ''), filter: lsGet('filter', 'mine'), processId: null, planId: null, runKey: null,
    sel: null, refOpen: true, pick: null, edit: null, unfold: {}, diffOf: null, msg: null, justPassed: null,
    pendingFiles: [], urls: {}, full: {}, needsReconnect: null, overlay: null, busy: false, unsaved: {}, saveErr: {},
    rel: { q: '', kind: '', area: '', sel: 0, detail: false }, newer: null,
    folderErr: null, deviceName: lsGet('device-name', ''), keys: lsGet('keys', true), theme: lsGet('theme', 'system'), builder: lsGet('builder', true), insTabSaved: lsGet('insTab', ''), partsRail: lsGet('partsRail', false), fieldErr: null, startMode: {}, showRoles: false, lookAround: lsGet('look-around', !!lsGet('me', '')), copyView: null, archive: {}, stepDrafts: {}, partial: {}, answering: null
  };
  /* A step-type form belongs to its folder: switching folders and back finds it again, and another folder's form never
     replaces it. */
  var typeForms = {};
  Object.defineProperty(state, 'typeForm', { enumerable: true,
    get: function () { return typeForms[fsKey()] || null; },
    set: function (v) { if (v) typeForms[fsKey()] = v; else delete typeForms[fsKey()]; } });
  applyTheme();
  var data = { people: [], drafts: [], processes: [], runs: [], legacy: [], skills: [], plans: [], stepTypes: { types: {}, errors: [] }, jira: { workflows: {}, errors: [] }, readAt: new Date().toISOString() };
  /* Writes to the folder happen one at a time, in order, so a later change never lands before an earlier one. */
  var writes = sessionReady;
  function queued(task) { var p = writes.then(task); writes = p.catch(function () {}); return p; }
  function verNum(v) { return parseInt(String(v || '').replace(/^v/i, ''), 10) || 0; }
  var sig = '';

  /* ---------- context handed to views ---------- */
  var ctx = {
    state: state, canFolder: canFolder,
    get data() { return data; },
    now: function () { return Date.now(); },
    get peopleById() { var o = {}; data.people.forEach(function (p) { o[p.id] = p; }); return o; },
    run: function () { for (var i = 0; i < data.runs.length; i++) if (data.runs[i].process + '/' + data.runs[i].id === state.runKey) return data.runs[i]; return null; },
    recording: function (r) { return !!r && !!state.me && !r.ended && !r._unrunnable && r.recorder.person === state.me && r.recorder.session === SESSION; },
    /* Who may resolve conflict copies: the recorder's window while it runs; once it has ended, whoever recorded or ended it. */
    canRecover: function (r) { return !!r && !!state.me && !r._unrunnable && (ctx.recording(r) || (!!r.ended && (r.recorder.person === state.me || r.ended.by === state.me))); },
    processTitle: function (id) { var p = processes().filter(function (x) { return x.id === id; })[0]; return p ? p.title : id; },
    processes: function () { return processes(); },
    get fsKey() { return fsKey(); },
    orphanSkills: function () { processes(); return orphanSkills; },
    /* Unsaved edits to a draft that was removed from this folder, so they stay findable. */
    lostDrafts: function () { var k = fsKey() + '\n', ids = processes().map(function (x) { return x.id; }); return Object.keys(state.editors || {}).filter(function (e) { var ed = state.editors[e]; return e.indexOf(k) === 0 && ed.text != null && ids.indexOf(ed.pid) < 0; }).map(function (e) { return state.editors[e].pid; }); },
    findRun: function (key) { for (var i = 0; i < data.runs.length; i++) if (data.runs[i].process + '/' + data.runs[i].id === key) return data.runs[i]; return null; },
    latestPub: function (id) { var p = processes().filter(function (x) { return x.id === id; })[0]; return p ? p.latest : null; },
    suggestRole: suggestRole,
    attachments: function (key, step) { return attachmentsFor(key, step); },
    /* What was typed on a step of the open run and not used yet: evidence, Fill in values, a note. */
    stepDraft: function (id) { return draftOf(state.runKey, id, false); },
    /* Corrections on a process, grouped, with where each group stands, worked out once per redraw like processes(). */
    corrections: function (pid) {
      if (!fixMemo[pid]) { var C = PF.corrections; fixMemo[pid] = C.status(C.groups(C.collect(data.runs, pid)), data.corrDecisions); }
      return fixMemo[pid];
    },
    /* The release history and what this person has seen of it (for "New for you" and the dot on What's new). */
    get releases() { var seen = state.relShownSeen || relSeen(); return { list: RELEASES, version: APP_VERSION, lastSeen: seen, fresh: APP_VERSION !== 'dev' && V.semverCmp(APP_VERSION, relSeen()) > 0, newer: state.newer }; },
    localCopy: function (r) { var c = lsGet(localKey(r.id), null); return c && c.id === r.id ? c : null; },
    /* Folder health from what's loaded (full: with this folder's last scan of every file). Worked out once per change. */
    health: function (full) { return healthReport(full); },
    recovery: RECOVERY, writer: WRITER,
    /* Getting started, worked out from the folder (PF.setup.progress); setupCard is null when Home shouldn't show it. */
    setupProgress: function () { return setupProgress(); },
    setupCard: function () { return setupShown() ? setupProgress() : null; },
    setupTemplate: function (id) { return setupTemplate(id); },
    device: function () { return PF.connection.device(navigator.userAgent, state.deviceName); },
    /* Connection checks from other windows that this one hasn't answered or put off. */
    connPending: function () { return state.conn ? PF.connection.pending(state.conn, WRITER, state.connDismissed).filter(function (p) { return !(state.connAnswering || {})[p._file]; }) : []; },
    /* Thumbnails are small copies made once per image; the full image is loaded only in the lightbox and released when it closes. */
    img: function (src, caption, full) {
      /* A run shows the screenshots frozen into its own publication. Only publications made before screenshots were frozen fall back to images/. */
      var r = ctx.run(), paths = [src], key = src;
      if (r && /^images\//.test(src)) {
        /* The run itself records whether its publication froze screenshots, so a publication that's still syncing shows
           "Missing", never today's images/ file. Only runs of older publications fall back to images/. */
        var own = 'publications/' + r.process + '/' + r.folder + '/' + src;
        var legacy = !r.shotsFrozen && legacyPub(r);
        paths = legacy ? [own, src] : [own]; key = r.process + '/' + r.folder + '|' + src + (legacy ? '|legacy' : '');
      }
      var cache = full ? state.full : state.urls;
      if (!(key in cache)) {
        var g = gen, ep = cache._epoch || 0; cache[key] = null;
        /* A picture that finishes after the folder changed, its lightbox closed or the person moved on is released, and its
           entry is cleared so it loads again if it's needed again. Thumbnails and full images have separate epochs. */
        (full ? fullUrl(paths) : thumbUrl(paths)).then(function (u) {
          if (g !== gen || ep !== (cache._epoch || 0)) { if (u) URL.revokeObjectURL(u); if (cache[key] === null) delete cache[key]; return; }
          cache[key] = u || ''; later();
        }, function () { if (g === gen && ep === (cache._epoch || 0)) { cache[key] = ''; later(); } else if (cache[key] === null) delete cache[key]; });
      }
      var u = cache[key];
      return u ? '<img alt="' + U.esc(caption) + '" src="' + U.esc(u) + '"' + (full ? '' : ' loading="lazy" decoding="async"') + '>' : '<span class="small" style="display:grid;place-items:center;height:100%;padding:4px">' + (u === '' ? 'Missing' : '…') + '</span>';
    }
  };

  /* Older publications didn't copy screenshots. Only a run whose publication is loaded and confirmed to be one of those may
     show images/ instead; anything not yet confirmed shows "Missing" until it syncs. */
  function legacyPub(r) {
    for (var i = 0; i < data.processes.length; i++) if (data.processes[i].process === r.process) for (var j = 0; j < data.processes[i].pubs.length; j++) { var p = data.processes[i].pubs[j]; if (p.folder === r.folder) return !!(p.ok && p.info && !('images' in p.info)); }
    return false;
  }
  function firstBlob(paths) {
    return paths.reduce(function (p, path) { return p.then(function (b) { return b || (/^(images|runs|publications)\//.test(path) ? state.fs.blob(path).catch(function () { return null; }) : null); }); }, Promise.resolve(null));
  }
  function thumbUrl(paths) {
    return firstBlob(paths).then(function (b) {
      if (!b) return '';
      if (typeof createImageBitmap !== 'function') return URL.createObjectURL(b);
      return createImageBitmap(b).then(function (bm) {
        var k = Math.min(1, 320 / bm.width), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bm.width * k)); c.height = Math.max(1, Math.round(bm.height * k));
        c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height); bm.close && bm.close();
        return new Promise(function (res) { c.toBlob(function (t) { res(t ? URL.createObjectURL(t) : ''); }, 'image/webp', 0.82); });
      });
    });
  }
  function fullUrl(paths) { return firstBlob(paths).then(function (b) { return b ? URL.createObjectURL(b) : ''; }); }
  function releaseUrls(map) { var ep = (map._epoch || 0) + 1; Object.keys(map).forEach(function (k) { if (map[k] && /^blob:/.test(map[k])) URL.revokeObjectURL(map[k]); delete map[k]; }); map._epoch = ep; }
  /* Several images finishing at once cause one redraw, not one each. */
  var pending = false;
  function later() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; render(); }); }

  /* Browser-kept copies belong to one folder, so a copy from one team folder never shows up in another. */
  function localKey(id, fs) { fs = fs || state.fs; return 'unsaved:' + (fs ? fs.kind + ':' + (fs.id || fs.name) : '') + ':' + id; }
  /* The newest release this person has seen. Someone opening Flightdeck for the first time has seen everything, so day one
     isn't a changelog; someone who used it before release notes existed has seen up to 1.0.0. */
  function relSeen() {
    if (APP_VERSION === 'dev') return '0.0.0';
    var s = lsGet('seen-release', null); if (s) return s;
    var v = lsGet('me', '') ? '1.0.0' : APP_VERSION; lsSet('seen-release', v); return v;
  }
  /* Once per release: a short note that Flightdeck changed, for anyone who hasn't looked yet. */
  function announceRelease() {
    if (APP_VERSION === 'dev' || V.semverCmp(APP_VERSION, relSeen()) <= 0 || lsGet('toasted-release', '') === APP_VERSION) return;
    /* Another message on screen first: wait for it to be dismissed rather than use up the one-time notice unseen. */
    if (state.msg && !state.msg.quiet) return;
    lsSet('toasted-release', APP_VERSION);
    state.msg = { text: 'Flightdeck was updated to ' + APP_VERSION + '.', kind: 'good', act: 'whats-new', label: 'See what\'s new' }; render();
  }
  /* A newer copy of Flightdeck saved in the team folder (flightdeck.html at its top) is announced in the top bar. */
  function checkNewerCopy(fs, g) {
    if (!fs || fs.kind !== 'folder' || APP_VERSION === 'dev') return;
    /* Only the first few kilobytes are read: the version stamp is near the top, and the file can be large. */
    /* The app was called Preflight before 1.9.0: a team folder may still hold preflight.html. */
    var head = function (name) { return fs.blob(name).then(function (b) { return b ? b.slice(0, 4096).text() : null; }, function () { return null; }); };
    head('flightdeck.html').then(function (h) { return h || head('preflight.html'); }).then(function (head) {
      if (g !== gen) return;
      if (!head) { if (state.newer) { state.newer = null; renderTop(); } return; }
      var m = /<meta name="(?:flightdeck|preflight)-version" content="(\d{1,4}\.\d{1,4}\.\d{1,4})">/.exec(head);
      var newer = m && V.semverCmp(m[1], APP_VERSION) > 0 ? m[1] : null;
      if (newer !== state.newer) { state.newer = newer; renderTop(); }
    }, function () {});
  }
  var procCache = null, orphanSkills = [], fixMemo = Object.create(null);
  function processes() {
    if (procCache) return procCache;
    var by = Object.create(null);
    function entry(id) { return by[id] = by[id] || { id: id, title: id, category: 'Other', latest: null, all: [], clashes: [], broken: [], taken: [], draft: null, draftChanged: false, lastRun: null, staleSkills: 0, skills: [], group: [], tags: [] }; }
    data.processes.forEach(function (p) {
      var e = entry(p.process); e.latest = p.index.latest; e.all = p.index.all; e.clashes = p.index.clashes;
      e.broken = p.pubs.filter(function (x) { return !x.ok; });
      /* Every version number in use, including ones still syncing or unusable here, so publishing never reuses one. */
      e.taken = p.pubs.map(function (x) { return { version: PF.publish.versionOf(x.folder) || 0 }; });
      if (e.latest) { e.title = e.latest.map.meta.title || e.id; e.category = e.latest.map.meta.category || 'Other'; e.group = e.latest.map.meta.group; e.tags = e.latest.map.meta.tags; }
    });
    data.drafts.forEach(function (d) {
      var m = M.parse(d.md), id = m.meta.process || d.file.replace(/\.md$/i, ''), e = entry(id);
      /* Two drafts that say the same process (a OneDrive copy, release-LAPTOP.md): both are listed on the process page and in
         Folder health. The one named for the process is shown; otherwise the first by name, the same on every computer. */
      if (e.draft) {
        e.sharedDrafts = (e.sharedDrafts || [e.draft.file]).concat([d.file]).sort();
        var keep = e.draft.file === id + '.md' || (d.file !== id + '.md' && e.draft.file < d.file);
        if (keep) return;
      }
      e.draft = d;
      if (!e.latest) { e.title = m.meta.title || id; e.category = m.meta.category || 'Other'; e.group = m.meta.group; e.tags = m.meta.tags; }
      e.draftChanged = !e.latest || U.hash(d.md) !== e.latest.info.mapHash;
      /* A team step type the map uses changed since it was frozen into the publication: republishing picks it up. */
      if (e.latest && !e.draftChanged) {
        var custom = (data.stepTypes || {}).types || {}, frozen = e.latest.types || {};
        e.typesChanged = M.usedTypes(m).filter(function (t) { return (custom[t] || (frozen[t] && frozen[t].custom)) && JSON.stringify(T.freeze([t], custom)[t] || null) !== JSON.stringify(frozen[t] || null); });
        e.draftChanged = e.typesChanged.length > 0;
      }
    });
    data.runs.forEach(function (r) { var e = by[r.process]; if (e && (!e.lastRun || r.created > e.lastRun)) e.lastRun = r.created; });
    /* Each registered skill, with where it stands against its process. "Needs attention" = its steps changed, or it can't be matched. */
    /* Registrations that match no process here, or can't be read, are kept and listed with why, never dropped. */
    orphanSkills = [];
    data.skills.forEach(function (x) {
      var e = x.skill && Object.prototype.hasOwnProperty.call(by, x.skill.process) ? by[x.skill.process] : null;
      if (!e) { orphanSkills.push({ skill: x.skill || { name: x.file || '?', process: '', implements: 0, steps: null, group: [], tags: [], version: '', location: '' }, errors: x.errors, status: { s: 'missing', text: x.errors.length ? x.errors.join('; ') : 'It names the process "' + x.skill.process + '", which isn\'t in this folder.' } }); return; }
      var st = x.errors.length ? { s: 'missing', text: x.errors.join('; ') } : PF.skills.status(x.skill, e.all, e.latest);
      e.skills.push({ skill: x.skill, errors: x.errors, status: st });
      if (st.s === 'update' || st.s === 'missing') e.staleSkills++;
    });
    procCache = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.category === b.category ? (a.title < b.title ? -1 : 1) : (a.category < b.category ? -1 : 1); });
    return procCache;
  }

  /* Rotation: suggest whoever has gone longest without this role in this process. */
  function suggestRole(processId, role) {
    var people = data.people.filter(function (p) { return !p.inactive; });
    if (!people.length) return null;
    var last = {};
    data.runs.forEach(function (r) { if (r.process === processId && r.state !== 'cancelled' && r.roles && r.roles[role]) { var p = r.roles[role]; if (!last[p] || r.created > last[p]) last[p] = r.created; } });
    var best = people.slice().sort(function (a, b) { var la = last[a.id] || '', lb = last[b.id] || ''; return la === lb ? (a.name < b.name ? -1 : 1) : la < lb ? -1 : 1; })[0];
    return { person: best.id, why: last[best.id] ? 'last did it ' + U.day(last[best.id]) : 'hasn\'t done it yet' };
  }

  /* ---------- loading ---------- */
  function signature(d) {
    return JSON.stringify([d.people.length, d.people.hash, d.drafts.map(function (x) { return x.file + x.mtime; }), d.processes.map(function (p) { return p.pubs.map(function (x) { return x.folder + x.ok; }); }),
      d.runs.map(function (r) { return r.id + ':' + r._fileHash + ':' + (r._notes || []).length + ':' + (r._conflicts || []).length; }), d.skills.map(function (x) { return JSON.stringify(x.skill); }), (d.validations || []).length, (d.corrDecisions || []).map(function (x) { return x._file + x.at; }), (d.corrUnread || []).map(function (x) { return x.process + '/' + x._file; }), d.plans.map(function (p) { return p.id + p._hash + !!p._status + !!p._conflicting; }), (d.unreadable || []).map(function (u) { return u.path; }), Object.keys(d.failed || {})]);
  }
  /* One read of the folder at a time. If the folder can't be read, keep showing what was last read and say so;
     an unreadable folder never looks empty. */
  /* Every read and write belongs to the folder it started in. Switching folders starts a new generation, and anything still
     in flight from the old folder is ignored when it finishes, so two folders' data never mix. */
  var loading = null, gen = 0;
  /* The one rule for replacing a run with the folder's copy, used by every read: never when the run has a change not yet
     saved, a save still in flight, or any edit made since the read began (its local revision moved). A read that started
     before an edit is older than what's on screen, whatever the folder says. */
  /* Each run's version lives here, not on the run object, so it never resets when a newer object replaces the old one. It
     advances on every local edit and every time a newer copy from the folder is accepted, so a read that began before
     either can never install an older run over it. */
  var editCount = {};
  function bump(id) { editCount[id] = (editCount[id] || 0) + 1; }
  function edits(id) { return editCount[id] || 0; }
  function revsNow() { return Object.assign({}, editCount); }
  function localRun(id) { for (var i = 0; i < data.runs.length; i++) if (data.runs[i].id === id) return data.runs[i]; return null; }
  function canReplace(id, before) {
    if (state.unsaved[id] || (state.pendingSaves || {})[id]) return false;
    /* '~' + id counts this window's successful saves and restores of the run: a read that started before one is older than
       what's in the folder now. */
    return edits(id) === (before[id] || 0) && edits('~' + id) === (before['~' + id] || 0);
  }
  /* Reads are numbered as they start, so an editor can tell a read that began after its own save from an older one. */
  var readsStarted = 0;
  function load(force, deep) {
    if (!state.fs) return Promise.resolve();
    if (deep) checkNewerCopy(state.fs, gen);
    if (loading && loading.gen === gen) return loading.p;
    var g = gen, before = revsNow(), seq = ++readsStarted;
    var p = repo.loadAll(state.fs, { deep: !!deep }).then(function (d) {
      if (g !== gen) return;
      d.readSeq = seq;
      loading = null;
      keepUnread(d);
      d.runs = applyRunsRead(d, { seq: seq, revs: before });
      var s = signature(d), changed = s !== sig, wasErr = state.folderErr;
      /* A decision that couldn't be read this time keeps the last one read from the same file. */
      (d.corrUnread || []).forEach(function (u) { (data.corrDecisions || []).forEach(function (x) { if (x.process === u.process && x._file === u._file && x._dir === u.dir) { d.corrDecisions.push(x); u.kept = true; } }); });
      data = d; sig = s; procCache = null; state.folderErr = null; state.runReadAt = d.readAt;
      if (changed || force || wasErr) render(); else renderTop();
      syncChildren();
      loadConn();
      loadSetupAnswers();
    }, function (e) { if (g !== gen) return; loading = null; state.folderErr = e.message || String(e); render(); });
    loading = { gen: g, p: p };
    return p;
  }
  /* A part of the folder that couldn't be read this time keeps what was read before, and so does a run whose file couldn't
     be read: an unreadable part never looks empty, and Folder health and the Runs page say what couldn't be read. */
  var KEEP = { people: ['people'], drafts: ['drafts'], publications: ['processes'], legacy: ['legacy'], skills: ['skills', 'skillsSkipped'], proposals: ['plans'], 'step types': ['stepTypes'], 'Jira workflows': ['jira'], 'sign-offs': ['validations'], corrections: ['corrDecisions', 'corrUnread'] };
  function keepUnread(d) {
    Object.keys(d.failed || {}).forEach(function (k) { (KEEP[k] || []).forEach(function (f) { if (data[f] !== undefined) d[f] = data[f]; }); });
    var drafts = {};
    (d.unreadable || []).forEach(function (u) {
      if (!u.draft) return;
      drafts[u.draft] = u.why;
      var od = data.drafts.filter(function (x) { return x.file === u.draft; })[0];
      if (od && !d.drafts.some(function (y) { return y.file === od.file; })) d.drafts.push(od);
    });
    state.unread = { runs: (state.unread || {}).runs || {}, drafts: drafts };
  }
  /* ---------- What a read found about a run: applied in one place, by one rule ---------- */
  /* A read result is { kind: 'run', run } (the file read), { kind: 'missing' } (no run.json, for a run that has been on
     disk) or { kind: 'unread', why }. at = { seq, revs }: when the read started. applyRunRead ignores the whole result if
     the run was edited, saved or restored since then (canReplace: every one of those advances its version) or a newer read
     of it was applied first. Nothing about a run (its contents, gone, unreadable) changes any other way, except the
     outcome of this window's own save, which is newer than any read (runOutcome). */
  var applied = {}, baselines = {};
  function startRead() { return { seq: ++readsStarted, revs: revsNow() }; }
  function findRun(key) { for (var i = 0; i < data.runs.length; i++) if (data.runs[i].process + '/' + data.runs[i].id === key) return data.runs[i]; return null; }
  function setRunStatus(key, kind, why) {
    var u = state.unread = state.unread || { runs: {}, drafts: {} }, runs = Object.assign({}, u.runs), m = Object.assign({}, state.missing || {});
    delete runs[key]; delete m[key];
    if (kind === 'unread') runs[key] = why;
    if (kind === 'missing') m[key] = true;
    u.runs = runs; state.missing = m;
  }
  function applyRunRead(key, at, res) {
    var id = key.slice(key.indexOf('/') + 1);
    if ((applied[key] || 0) > at.seq) return false;
    if (!canReplace(id, at.revs)) {
      /* The run on screen stays (a change of this window's waits), but a file that reads again is news: an old "couldn't be
         read" or "gone" would otherwise stay, and refuse changes, until that change is saved. Not while a save is under way
         or landed since the read began: what that save found is newer. */
      if (res.kind === 'run' && !(state.pendingSaves || {})[id] && edits('~' + id) === (at.revs['~' + id] || 0)) { applied[key] = at.seq; setRunStatus(key, 'run'); }
      return false;
    }
    applied[key] = at.seq;
    setRunStatus(key, res.kind, res.why);
    if (res.kind === 'run') {
      var mine = findRun(key);
      if (!mine || mine._fileHash !== res.run._fileHash) bump(id);
      baselines[id] = { run: res.run };
    }
    return true;
  }
  /* What this window's own save found (gone, unreadable) is current: it outranks any read still in flight. */
  function runOutcome(key, kind, why) { applied[key] = ++readsStarted; setRunStatus(key, kind, why); }
  /* A refresh of every run: each run's result goes through applyRunRead. A run the read didn't list that has been on disk is
     gone (unless runs couldn't be read at all); one never saved yet, or one the read may not replace, stays as it is. */
  function applyRunsRead(d, at) {
    var got = {}, why = {}, keys = [], out = [], failed = !!(d.failed || {}).runs;
    function note(k) { if (keys.indexOf(k) < 0) keys.push(k); }
    data.runs.forEach(function (x) { note(x.process + '/' + x.id); });
    d.runs.forEach(function (x) { var k = x.process + '/' + x.id; got[k] = x; note(k); });
    (d.unreadable || []).forEach(function (u) { if (u.key) { why[u.key] = u.why; note(u.key); } });
    keys.forEach(function (k) {
      var prev = findRun(k), res = got[k] ? { kind: 'run', run: got[k] } : why[k] ? { kind: 'unread', why: why[k] } : !failed && prev && prev._fileHash ? { kind: 'missing' } : null;
      var show = res && applyRunRead(k, at, res) ? (res.kind === 'run' ? res.run : prev) : prev ? state.unsaved[prev.id] || prev : res && res.kind === 'run' ? res.run : null;
      if (show) out.push(show);
    });
    return out;
  }
  function clone(r) { return JSON.parse(JSON.stringify(r)); }
  /* Saves and restores of a run, and copies being kept, are one at a time: anything that rewrites the run waits for them. */
  function runBusy(r) {
    if (!r || !((state.pendingSaves || {})[r.id] || state.recovering)) return false;
    say('Wait for the save to finish, then try again.', 'warn'); render(); return true;
  }
  /* Why a run can't be changed right now because its own latest read failed (or runs weren't read this time), or ''. The
     version on screen is the last one read; nothing is written over a file this copy couldn't read. */
  function runUnread(r) {
    var key = r.process + '/' + r.id, u = state.unread || {};
    if ((state.missing || {})[key]) return 'This run\'s file is gone from the team folder. Someone may have deleted or moved it.';
    if (u.runs && u.runs[key]) return 'This run\'s file couldn\'t be read on the last check (' + u.runs[key] + ').';
    if ((data.failed || {}).runs) return 'The runs in the team folder couldn\'t be read on the last check.';
    return '';
  }
  function draftUnread(p) { var f = p && p.draft && p.draft.file, u = (state.unread || {}).drafts || {}; return f && u[f] ? f + ' couldn\'t be read on the last check (' + u[f] + ').' : ''; }

  /* ---------- Folder health (on demand) ---------- */
  var healthMemo = null;
  function healthReport(full) {
    if (!data.readSeq) return null;
    var hs = state.healthScan && state.healthScan.gen === gen ? state.healthScan : null, conn = state.conn;
    var key = [sig, state.me, Object.keys(state.missing || {}).join(','), hs && full ? hs.n : 0, Math.floor(Date.now() / 60000), state.newer, conn ? conn.readAt : ''].join('|');
    if (healthMemo && healthMemo.key === key) return healthMemo.rep;
    var rep = PF.health.check({ data: data, scan: full && hs ? hs.scan : null, me: state.me, app: APP_VERSION, newer: state.newer, contract: hs ? hs.contract : null, connection: conn, missing: state.missing }, Date.now());
    healthMemo = { key: key, rep: rep };
    return rep;
  }
  /* The fingerprints of AGENTS.md's Flightdeck part and the skills, as flightdeck install takes them. */
  function contractHashes(scan) {
    var sub = typeof crypto !== 'undefined' && crypto.subtle, C = PF.contract, paths = Object.keys(scan.contractTexts || {});
    if (!sub || typeof TextEncoder === 'undefined') return Promise.resolve(null);
    return Promise.all(paths.map(function (p) { return sub.digest('SHA-256', new TextEncoder().encode(C.managed(p, scan.contractTexts[p]))); })).then(function (ds) {
      var hashes = {}; ds.forEach(function (d, i) { hashes[paths[i]] = C.hex(d); }); return { hashes: hashes };
    }, function () { return null; });
  }
  /* Reads the folder again, then every file in it, 8 at a time. Bound to the folder it started in. */
  function runHealth() {
    if (!state.fs || state.healthBusy) return;
    var fs = state.fs, g = gen, n = (state.healthN || 0) + 1, last = 0;
    state.healthN = n; state.healthBusy = true; state.healthErr = null; state.healthFound = 0; render();
    load(true, true).then(function () {
      if (g !== gen) return null;
      return repo.scan(fs, { alive: function () { return g === gen; }, progress: function (k) { if (g !== gen) return; state.healthFound = k; var t = Date.now(); if (t - last > 400 && state.view === 'health') { last = t; scheduleRender(); } } });
    }).then(function (scan) {
      if (!scan || g !== gen) return null;
      return contractHashes(scan).then(function (c) { if (g !== gen) return; state.healthScan = { gen: g, n: n, scan: scan, contract: c }; });
    }).then(function () { if (g !== gen) return; state.healthBusy = false; render(); }, function (e) {
      if (g !== gen) return; state.healthBusy = false; if (!(e && e.cancelled)) state.healthErr = e && e.message || String(e); render();
    });
  }

  /* ---------- The connection check (connection/; core/connection.js) ---------- */
  var connListing = false, lastConn = 0;
  function connSig(l) { return l ? l.probes.concat(l.acks).map(function (x) { return x._file; }).sort().join('|') : ''; }
  /* Lists connection/ (only the last 15 minutes are read). On the Connection check page it runs every 5 seconds and answers
     checks from other computers; elsewhere it rides along with the routine refresh and only offers an Answer button. */
  function loadConn() {
    if (!state.fs || connListing) return Promise.resolve();
    var fs = state.fs, g = gen;
    connListing = true;
    return repo.loadConnection(fs, Date.now()).then(function (list) {
      connListing = false;
      if (g !== gen) return;
      var t = Date.now(), seen = state.connSeen = state.connSeen || {};
      list.probes.concat(list.acks).forEach(function (x) { if (seen[x._file] == null) seen[x._file] = t; });
      /* Answers to this window's own checks stay once seen, so an answered check never turns unanswered when it leaves the
         15-minute window. */
      var mine = (state.connSent || []).map(function (x) { return x.id; }), kept = state.connKept = state.connKept || {};
      list.acks.forEach(function (a) { if (mine.indexOf(a.probe) >= 0) kept[a._file] = a; });
      Object.keys(kept).forEach(function (f) { if (!list.acks.some(function (a) { return a._file === f; })) list.acks.push(kept[f]); });
      var was = connSig(state.conn); state.conn = list;
      if (state.view === 'connection') PF.connection.pending(list, WRITER, null).forEach(function (p) { answerConn(p, true); });
      if (connSig(list) !== was) render();
    }, function () { connListing = false; });
  }
  function answerConn(p, auto) {
    var busy = state.connAnswering = state.connAnswering || {};
    if (!state.me || !state.fs || busy[p._file]) return;
    busy[p._file] = true;
    var fs = state.fs, g = gen, run = p.run ? ctx.findRun(p.run.key) : null, seenAt = (state.connSeen || {})[p._file] || Date.now();
    var rec = { probe: p.id, probeFile: p._file, by: state.me, writer: WRITER, device: ctx.device(), at: new Date().toISOString(), firstSeenAt: new Date(seenAt).toISOString(), app: APP_VERSION,
      run: !p.run ? null : run && runUnread(run) ? { key: p.run.key, rev: 0, savedAt: null, unknown: true } : run ? { key: p.run.key, rev: run.rev || 0, savedAt: run.savedAt || null } : (data.failed || {}).runs ? { key: p.run.key, rev: 0, savedAt: null, unknown: true } : null, folderReadAt: data.readAt };
    queued(function () { return repo.sendAck(fs, rec); }).then(function (name) {
      if (g !== gen) return;
      (state.connAnswered = state.connAnswered || []).push({ probe: p.id, file: name, at: Date.now(), by: p.by });
      if (!auto) say('Answered ' + V.nameOf(ctx, p.by) + '\'s check. Their computer shows your answer when it arrives there.', 'good');
      render();
      return loadConn();
    }, function (e) { if (g !== gen) return; delete busy[p._file]; state.connErr = 'Couldn\'t answer the check: ' + (e && e.message || e); render(); });
  }
  function sendCheck() {
    if (!state.me || !state.fs || state.connSending) return;
    var fs = state.fs, g = gen, at = Date.now(), id = U.randomId(8), n = (state.connN || 0) + 1;
    /* The run most recently saved, so the answer can say whether the other computer has its latest revision too. */
    var at_ = function (r) { return r.savedAt || r.created || ''; };
    var cur = data.runs.filter(function (r) { return !r.ended && r.state === 'running' && !r._unrunnable; }).sort(function (a, b) { return at_(a) < at_(b) ? 1 : -1; })[0];
    var mine = (state.connSent || []).map(function (x) { return x.id; });
    var seen = ((state.conn || {}).acks || []).filter(function (a) { return mine.indexOf(a.probe) >= 0; }).map(function (a) { return a._file; });
    var rec = { id: id, n: n, by: state.me, writer: WRITER, device: ctx.device(), at: new Date(at).toISOString(), app: APP_VERSION, run: cur ? { key: cur.process + '/' + cur.id, rev: cur.rev || 0 } : null, seen: seen };
    state.connSending = true; state.connErr = null; render();
    queued(function () { return repo.sendProbe(fs, rec, at); }).then(function (name) {
      if (g !== gen) return;
      state.connSending = false; state.connN = n;
      (state.connSent = state.connSent || []).push({ file: name, id: id, n: n, at: at, run: rec.run });
      (state.connSeen = state.connSeen || {})[name] = at;
      say('Check ' + n + ' sent. Waiting for another computer to answer.', 'good'); state.msg.quiet = true;
      queued(function () { return repo.cleanConnection(fs, Date.now()); }).catch(function () {});
      render();
      return loadConn();
    }, function (e) { if (g !== gen) return; state.connSending = false; state.connErr = 'Couldn\'t send the check: ' + (e && e.message || e); render(); });
  }
  /* While a run is open, refresh just that run and its notes. The rest of the folder refreshes less often. */
  function refreshRun() {
    var r = ctx.run();
    if (!r || !state.fs || (loading && loading.gen === gen)) return Promise.resolve();
    var before = r._fileHash + ':' + (r._notes || []).length + ':' + (r._conflicts || []).length, g = gen, revs = revsNow();
    var at = startRead(), key = r.process + '/' + r.id, bad = [];
    var p = repo.loadRun(state.fs, r.process, r.id, null, false, false, bad).then(function (f) {
      if (g !== gen) return;
      loading = null; state.folderErr = null; state.runReadAt = new Date().toISOString();
      var cur = findRun(key) || r, was = runUnread(cur);
      var res = f ? { kind: 'run', run: f } : bad.length ? { kind: 'unread', why: bad[0].why } : cur._fileHash ? { kind: 'missing' } : null;
      var changed = !!f && f._fileHash !== cur._fileHash;
      if (!res || !applyRunRead(key, at, res)) { if (runUnread(cur) !== was) render(); else renderTop(); return; }
      if (res.kind !== 'run') { if (runUnread(cur) !== was) render(); else renderTop(); return; }
      if (changed) flashChanged(cur, f);
      for (var i = 0; i < data.runs.length; i++) if (data.runs[i].process + '/' + data.runs[i].id === key) data.runs[i] = f;
      if (f._fileHash + ':' + (f._notes || []).length + ':' + (f._conflicts || []).length !== before || runUnread(f) !== was) render(); else { renderTop(); updateFreshness(); }
    }, function (e) { if (g !== gen) return; loading = null; applyRunRead(key, at, { kind: 'unread', why: 'couldn\'t be read (' + (e.message || String(e)) + ')' }); state.folderErr = e.message || String(e); render(); });
    loading = { gen: g, p: p };
    return p;
  }
  /* Answers another window changed light up their rows for a moment, without moving anything or anyone. */
  function flashChanged(was, now) {
    var ids = Object.keys(now.steps || {}).filter(function (id) { var a = (was.steps || {})[id], b = now.steps[id]; return !a || a.s !== b.s || a.at !== b.at; });
    if (!ids.length) return;
    var mark = state.flash = { ids: ids };
    setTimeout(function () { if (state.flash === mark) { state.flash = null; scheduleRender(); } }, 1800);
  }
  function updateFreshness() { var el = document.getElementById('fresh'); if (el) el.innerHTML = V.freshness(ctx, ctx.run(), el.dataset && el.dataset.k === 'strip'); }
  function useFs(fs) {
    /* Unsaved changes stay with their own folder: kept in this browser under that folder's name, never carried into the new one. */
    Object.keys(state.unsaved).forEach(function (id) { lsSet(localKey(id), state.unsaved[id]); });
    gen++; loading = null; state.planPick = null; state.copyView = null; state.newer = null; state.archive = {}; editCount = {}; state.unsaved = {}; state.saveErr = {}; state.saveOpts = {}; state.folderErr = null; state.busyN = 0; state.pendingSaves = {}; state.recovering = null;
    state.setupAnswers = []; state.setupSeen = {}; answersBusy = false; state.healthScan = null; state.healthBusy = false; state.healthErr = null; state.conn = null; state.connSent = []; state.connSeen = {}; state.connAnswered = []; state.connAnswering = {}; state.connDismissed = {}; state.connErr = null; state.connSending = false; state.connN = 0; state.connKept = {}; state.unread = { runs: {}, drafts: {} }; state.missing = {}; applied = {}; baselines = {}; connListing = false;
    data = { people: [], drafts: [], processes: [], runs: [], legacy: [], skills: [], plans: [], stepTypes: { types: {}, errors: [] }, jira: { workflows: {}, errors: [] }, readAt: new Date().toISOString() };
    state.fs = fs; releaseUrls(state.urls); releaseUrls(state.full); sig = ''; procCache = null;
    return load(true, true);
  }

  function seedExamples(mem) { mem.reset(EXAMPLES); return PF.examples.seed(mem, EXAMPLES); }
  function boot() {
    var mem = new PF.fs.MemoryFS(LS + ':examples', null);
    var seeded = Object.keys(mem.files).length ? Promise.resolve() : seedExamples(mem);
    var useMem = function () { return seeded.then(function () { return useFs(mem); }); };
    if (!canFolder) return useMem();
    return handles.get().then(function (rec) {
      if (!rec) return useMem();
      return rec.dir.queryPermission({ mode: 'readwrite' }).then(function (p) {
        if (p === 'granted') return useFs(folderFs(rec));
        state.needsReconnect = rec; return useMem();
      });
    }, function (e) { say('This browser couldn\'t read which team folder you used last (' + (e && e.message || 'storage error') + '). Open it again from the top bar.', 'warn'); return useMem(); });
  }
  var handles = {
    db: function () { return new Promise(function (res, rej) { var q = indexedDB.open(LS, 1); q.onupgradeneeded = function () { q.result.createObjectStore('h'); }; q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; }); },
    /* The folder is stored with an ID made when it was first chosen, so two different folders with the same name never share
       the copies kept in this browser. A handle saved by an older version gets an ID from its name. */
    get: function () { return handles.read('folder').then(function (v) { v = v || null; return v && v.dir ? v : v ? { dir: v, id: 'named-' + v.name } : null; }); },
    /* Every folder chosen in this browser keeps its ID, so going A → B → A finds A's kept copies again. */
    set: function (dir) {
      return handles.known().then(function (list) {
        return list.reduce(function (p, rec) { return p.then(function (id) { return id || (rec.dir.isSameEntry ? rec.dir.isSameEntry(dir).then(function (same) { return same ? rec.id : null; }, function () { return null; }) : null); }); }, Promise.resolve(null))
          .then(function (id) {
            var rec = { dir: dir, id: id || U.randomId(12) };
            return handles.write('known', (id ? list : list.concat([rec])).slice(-20)).then(function () { return handles.write('folder', rec); }).then(function () { return rec; });
          });
      });
    },
    /* The list of known folders starts with the one an older version saved, so its ID carries over. */
    known: function () { return Promise.all([handles.read('known'), handles.get()]).then(function (x) { var list = Array.isArray(x[0]) ? x[0] : []; return x[1] && !list.some(function (r) { return r.id === x[1].id; }) ? list.concat([x[1]]) : list; }); },
    read: function (k) { return handles.db().then(function (db) { return new Promise(function (res, rej) { var g = db.transaction('h').objectStore('h').get(k); g.onsuccess = function () { res(g.result); }; g.onerror = function () { rej(g.error || new Error('Couldn\'t read the remembered folder.')); }; }); }); },
    write: function (k, v) { return handles.db().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction('h', 'readwrite'); tx.objectStore('h').put(v, k); tx.oncomplete = res; tx.onerror = function () { rej(tx.error || new Error('Couldn\'t remember the folder.')); }; tx.onabort = tx.onerror; }); }); }
  };
  function folderFs(rec) { var fs = new PF.fs.FolderFS(rec.dir); fs.id = rec.id; return fs; }
  /* Opening a folder takes a token; if another folder is opened before this one finishes, this one gives way. */
  var opening = 0;
  function connect() {
    var t = ++opening;
    window.showDirectoryPicker({ id: 'preflight', mode: 'readwrite' }).then(function (dir) {
      if (t !== opening) return;
      var notRemembered = '';
      return handles.set(dir).catch(function (e) { notRemembered = ' This browser couldn\'t remember the folder (' + e.message + '), so you\'ll be asked to choose it again next time.'; return { dir: dir, id: 'unremembered-' + U.randomId(12) }; }).then(function (rec) {
        if (t !== opening) return;
        state.needsReconnect = null; home();
        return useFs(folderFs(rec)).then(function () {
          if (t !== opening) return;
          if (!data.drafts.length && !data.processes.length) say('Connected to "' + dir.name + '", but it has no checklists yet. Copy the example folder into it, or ask your AI assistant to write a checklist into maps/drafts.' + notRemembered, 'warn');
          else say('Connected to "' + dir.name + '".' + notRemembered, notRemembered ? 'warn' : 'good');
          render();
        });
      });
    }, function () { /* picker closed */ });
  }

  /* The assistant contract a new team folder starts with: AGENTS.md (Flightdeck's part and Team notes), the skills, and
     .flightdeck/installed.json saying which defaults they are, so flightdeck install can later tell them from the team's own
     changes. Without hashing in this browser, the command falls back on the defaults every version shipped. */
  function writeContract(fs) {
    var C = PF.contract, contract = Object.keys(EXAMPLES).filter(function (k) { return k === C.AGENTS || /^\.flightdeck\/skills\//.test(k); });
    var installed = function () {
      var sub = typeof crypto !== 'undefined' && crypto.subtle;
      if (!sub || typeof TextEncoder === 'undefined') return null;
      return Promise.all(contract.map(function (k) { return sub.digest('SHA-256', new TextEncoder().encode(C.managed(k, EXAMPLES[k]))); })).then(function (ds) {
        var files = {};
        ds.forEach(function (d, i) { files[contract[i]] = C.hex(d); });
        return fs.write('.flightdeck/installed.json', C.installed(APP_VERSION, new Date().toISOString(), 'app', files));
      }, function () { return null; });
    };
    return contract.reduce(function (p, k) { return p.then(function () { return fs.write(k, EXAMPLES[k]); }); }, Promise.resolve()).then(installed);
  }

  /* ---------- Getting started (views/setup.js, core/setup.js) ---------- */
  /* A new team needs an empty folder (PF.setup.emptyFolder). Resolves '' when it is, else why not. */
  function notEmpty(fs, name) {
    return fs.list('').then(function (items) {
      if (items.some(function (i) { return i.name === 'people.json'; })) return 'team';
      var fd = items.some(function (i) { return i.name === '.flightdeck'; }) ? fs.list('.flightdeck') : Promise.resolve([]);
      return fd.then(function (inFd) {
        if (PF.setup.emptyFolder(items, inFd)) return '';
        return items.every(function (i) { return PF.setup.emptyFolder([i], []); }) ? '"' + name + '" isn\'t empty: it already has Flightdeck files for AI assistants in .flightdeck/, which a new team would replace. If your team uses this folder, join it; otherwise choose an empty folder.'
          : '"' + name + '" isn\'t empty. Choose an empty folder for a new team, or make a new one in OneDrive.';
      });
    });
  }
  function setupProgress() {
    var fs = state.fs, answers = (state.setupAnswers || []).concat(((state.conn || {}).acks) || []);
    return PF.setup.progress({ folder: !!fs && fs.kind === 'folder', people: data.people, me: state.me, processes: data.processes, runs: data.runs, answers: answers });
  }
  function setupHidden() { return !!lsGet('setup-hidden:' + fsKey(), false); }
  /* Home's Getting started is for the folder owner and backup owner, in a real team folder, until they hide it. */
  function setupShown() {
    var fs = state.fs, me = state.me && data.people.filter(function (p) { return p.id === state.me; })[0];
    return !!fs && fs.kind === 'folder' && !!me && !me.inactive && !!me.folderRole && !setupHidden();
  }
  function setupTemplate(id) {
    var t = PF.setup.TEMPLATES.filter(function (x) { return x.id === id; })[0], base = id === 'check-in' ? EXAMPLES['maps/drafts/check-in.md'] : t && t.md;
    if (!base) return '';
    var r = PF.people.roles(data.people), bk = r.backup && !r.backup.inactive && r.backup.id !== state.me ? r.backup.id : null;
    return PF.setup.starter(base, state.me, bk);
  }
  function setupState(mode, step) { state.setup = { mode: mode, step: step || (mode === 'start' ? 'folder' : mode === 'join' ? 'open' : ''), me: { name: '', email: '' }, team: [{ k: 't1', name: '', email: '' }], backup: '', kn: 1 }; return state.setup; }
  /* Answers to connection checks still in the folder (up to 7 days), read once each, while Getting started isn't done. */
  var answersBusy = false;
  function loadSetupAnswers() {
    if (answersBusy || !setupShown() || setupProgress().complete) return;
    var fs = state.fs, g = gen, seen = state.setupSeen = state.setupSeen || {};
    answersBusy = true;
    repo.loadAnswers(fs, seen).then(function (got) {
      answersBusy = false; if (g !== gen) return;
      var more = false;
      got.forEach(function (x) { seen[x.name] = true; if (x.rec) { (state.setupAnswers = state.setupAnswers || []).push(x.rec); more = true; } });
      if (more) render();
    }, function () { answersBusy = false; });
  }
  /* Step 1: an empty folder Flightdeck can write to (a test file written, read back and removed). */
  function setupPick() {
    var su = state.setup, t = ++opening;
    window.showDirectoryPicker({ id: 'preflight', mode: 'readwrite' }).then(function (dir) {
      if (t !== opening || state.setup !== su) return;
      var fs = new PF.fs.FolderFS(dir);
      su.err = null; su.tested = false; su.dir = null; su.busy = true; su.dirName = dir.name; render();
      return notEmpty(fs, dir.name).then(function (why) {
        if (t !== opening) return;
        if (why === 'team') { su.err = { kind: 'team', text: '"' + dir.name + '" already has a team in it. To use it, join it instead of starting a new one.' }; su.joinDir = dir; return; }
        if (why) { su.err = { text: why }; return; }
        return repo.writeTest(fs, WRITER).then(function (res) { if (t !== opening) return; su.dir = dir; su.tested = true; su.leftover = res && !res.removed ? res.path : null; });
      }).then(function () { su.busy = false; if (t === opening) { state.focus = su.tested ? '[data-act="setup-next"]' : 'su-h'; render(); } }, function (e) {
        su.busy = false; if (t !== opening) return;
        su.err = { text: 'Flightdeck couldn\'t save a test file in "' + dir.name + '" (' + (e && e.message || e) + '). Check that the folder is in OneDrive and that you can edit it, then choose it again.' }; render();
      });
    }, function () { /* picker closed */ });
  }
  function setupErr(field, msg) { state.fieldErr = { id: 'setup', field: field, msg: msg }; state.focus = field; render(); }
  /* Step 2: people.json (you as folder owner, the backup owner), AGENTS.md, the skills and installed.json, into the folder
     tested in step 1, which must still have no team in it. */
  function createTeam() {
    var su = state.setup, P = PF.people;
    if (!su || !su.dir || su.busy) return;
    state.fieldErr = null;
    try { P.checkName(su.me.name); } catch (e) { return setupErr('su-me-name', 'Type your name.'); }
    try { P.checkEmail(su.me.email); } catch (e) { return setupErr('su-me-email', e.message); }
    var team = [], backup = -1;
    for (var i = 0; i < su.team.length; i++) {
      var x = su.team[i], named = String(x.name || '').trim();
      if (!named && !String(x.email || '').trim()) continue;
      if (!named) return setupErr('su-name-' + x.k, 'Type their name, or remove this row.');
      try { P.checkName(x.name); } catch (e) { return setupErr('su-name-' + x.k, e.message); }
      try { P.checkEmail(x.email); } catch (e) { return setupErr('su-email-' + x.k, e.message); }
      if (su.backup === x.k) backup = team.length;
      team.push(x);
    }
    var doc = P.create(su.me, team, backup), mine = P.text(doc), myId = doc[0].id, dir = su.dir, fs = new PF.fs.FolderFS(dir), t = ++opening;
    su.busy = true; render();
    var init = function () {
      return notEmpty(fs, dir.name).then(function (why) {
        if (why) throw new Error('"' + dir.name + '" isn\'t empty any more. Someone may have started it from another window');
        /* Two browsers starting the same folder at once can't share a lock, so each checks that people.json is the one it wrote. */
        return fs.write('people.json', mine).then(function () { return fs.read('people.json'); }).then(function (f) { if (!f || f.text !== mine) throw new Error('another window started this folder at the same moment; open it with Join your team\'s folder instead'); });
      }).then(function () { return writeContract(fs); });
    };
    (LOCKS ? lock('preflight:new-folder', init) : init()).then(function () { return handles.set(dir); }).then(function (rec) {
      if (t !== opening) return;
      state.me = myId; lsSet('me', myId); state.needsReconnect = null;
      return useFs(folderFs(rec)).then(function () {
        if (t !== opening) return;
        su.busy = false; su.created = true; su.step = 'checklist'; su.dir = null; state.focus = 'su-h';
        say('Created the team folder "' + dir.name + '" with ' + doc.length + (doc.length === 1 ? ' person' : ' people') + '. Next, your first checklist.', 'good'); render(); window.scrollTo(0, 0);
      });
    }).catch(function (e) { su.busy = false; if (t !== opening) return; say('The team folder wasn\'t created: ' + e.message + '. Check what\'s in "' + dir.name + '", and try again.', 'bad'); render(); });
  }
  /* Step 3: the starter as a draft with real owner and backup IDs, then published as v1 or opened in the editor. A draft
     with the same name already there is never replaced. */
  function setupChecklist(id, edit) {
    var su = state.setup, md = setupTemplate(id);
    if (!su || su.busy || !md || !state.fs || !state.me) return;
    var pid = M.parse(md).meta.process, sfs = state.fs, g = gen, by = state.me;
    su.busy = true; render();
    var open = function () { setView('process'); state.processId = pid; state.ptab = 'edit'; state.mapVer = null; resetRunUi(); dropEditor(pid); var p = currentProcess(); if (p) openEditor(p); state.focus = 'draft-editor'; say('This is your first checklist. Change what you like, choose Done, then publish it.', 'good'); render(); window.scrollTo(0, 0); };
    queued(function () { return repo.saveDraft(sfs, pid + '.md', md, null, { lock: LOCKS ? lock : null }); }).then(function (res) {
      if (g !== gen) return null;
      if (res.conflict && res.theirs !== md) { su.busy = false; say('A draft called ' + pid + '.md is already in the folder, so nothing was replaced. Open it from Processes.', 'warn'); render(); return null; }
      return load(true).then(function () {
        if (g !== gen) return null;
        var p = processes().filter(function (x) { return x.id === pid; })[0];
        if (edit) { su.busy = false; open(); return null; }
        if (p && p.latest && !p.draftChanged) { su.busy = false; say(p.title + ' is published already.', 'good'); render(); return null; }
        var people = data.people, wfs = data.jira.workflows, pids = processes().filter(function (x) { return x.latest; }).map(function (x) { return x.id; });
        return queued(function () {
          return repo.loadStepTypes(sfs).then(function (types) { return repo.publish(sfs, md, { people: people, customTypes: types.types, workflows: wfs, processes: pids, by: by, changes: 'First version', existing: p ? p.taken : [], now: new Date().toISOString() }); });
        }).then(function (pub) {
          if (g !== gen) return null;
          su.busy = false;
          if (pub.blockers) { say(pub.blockers[0], 'warn'); render(); return null; }
          say('Published ' + (M.parse(md).meta.title || pid) + ' v' + pub.version + '. Next, run it once.', 'good'); state.focus = 'su-h';
          return load(true);
        });
      });
    }).catch(function (e) { if (g !== gen) return; su.busy = false; say('Couldn\'t ' + (edit ? 'create' : 'publish') + ' the checklist: ' + e.message, 'bad'); render(); });
  }
  function setupAppCheck() {
    var fs = state.fs, g = gen, su = state.setup;
    if (!fs || fs.kind !== 'folder' || !su) return;
    var has = function (n) { return fs.stat(n).then(function (x) { return !!x; }, function () { return false; }); };
    has('flightdeck.html').then(function (a) { return a || has('preflight.html'); }).then(function (a) { if (g !== gen || state.setup !== su) return; su.hasApp = a; render(); });
  }
  /* Join: open the folder the team uses, then choose who you are. Nothing is written. */
  function setupOpen(dir) {
    var su = state.setup, t = ++opening;
    (dir ? Promise.resolve(dir) : window.showDirectoryPicker({ id: 'preflight', mode: 'readwrite' })).then(function (d) {
      if (t !== opening) return;
      su.busy = true; su.err = null; render();
      return handles.set(d).catch(function () { return { dir: d, id: 'unremembered-' + U.randomId(12) }; }).then(function (rec) {
        if (t !== opening) return;
        state.needsReconnect = null;
        return useFs(folderFs(rec)).then(function () {
          if (t !== opening) return;
          su.busy = false; su.mode = 'join'; su.step = 'who'; state.focus = 'su-h'; render(); window.scrollTo(0, 0);
        });
      });
    }, function () { /* picker closed */ }).catch(function (e) { if (t !== opening) return; su.busy = false; su.err = { text: 'Couldn\'t open the folder: ' + (e && e.message || e) }; render(); });
  }
  /* Settings, People: one change at a time to exactly the people.json on screen, saved only over that (like a draft). */
  function changePeople(act, id, fn, done) {
    var P = PF.people, people = data.people, why = P.allowed(people, state.me, act, id);
    if (why) { state.peopleErr = why; render(); return; }
    if (state.peopleSaving) { state.peopleErr = 'Still saving the last change.'; render(); return; }
    var res; try { res = fn(people.doc); } catch (e) { state.peopleErr = e.message; render(); return; }
    var sfs = state.fs, g = gen, expect = people.hash;
    state.peopleSaving = true; state.peopleErr = null; render();
    queued(function () { return repo.savePeople(sfs, P.text(res.doc), expect, { lock: LOCKS ? lock : null }); }).then(function (out) {
      state.peopleSaving = false; if (g !== gen) return null;
      if (out.conflict) state.peopleErr = out.afterWrite ? 'Something else wrote people.json at the same moment. Check the list below; make your change again if it isn\'t there.' : 'people.json changed since this page was drawn, so your change wasn\'t saved. Here is the list as it is now; make your change again.';
      else { state.pick = null; if (done) done(res.person); }
      return load(true);
    }, function (e) { state.peopleSaving = false; if (g !== gen) return; state.peopleErr = 'Couldn\'t save people.json: ' + e.message; render(); });
  }

  /* ---------- rendering ---------- */
  var app = document.getElementById('app'), topEl = document.getElementById('top'), overlayEl = document.getElementById('overlay');
  /* act: an optional button on the message, like { act: 'tl-undo', id: 'draft', label: 'Undo' }. */
  function say(text, kind, act) { state.msg = text ? { text: text, kind: kind || '' } : null; if (state.msg && act) { state.msg.act = act.act; state.msg.id = act.id; state.msg.label = act.label; } }
  /* A builder change said back with a real Undo button. */
  function sayUndo(text) { say(text, 'good', { act: 'tl-undo', id: 'draft', label: 'Undo' }); }
  function renderTop() {
    var meVal = document.activeElement && document.activeElement.id === 'me' ? null : true;
    if (meVal) patch(topEl, V.top(ctx));
    pinOffsets();
  }
  /* Sticky phase headers sit just under the top bar, whose height changes as it wraps on narrow screens. */
  function pinOffsets() {
    var root = document.documentElement, pl = app.querySelector && app.querySelector('.phase[data-s="open"] .placard');
    if (!root || !root.style || !topEl.offsetHeight) return;
    var bar = (topEl.closest && topEl.closest('.top')) || topEl, pinned = window.getComputedStyle && window.getComputedStyle(bar).position === 'sticky';
    root.style.setProperty('--top-h', (pinned ? bar.offsetHeight : 0) + 'px');
    if (pl && pl.offsetHeight) root.style.setProperty('--placard-h', pl.offsetHeight + 'px');
  }
  /* Crossing the phone breakpoint redraws, so the properties sheet's modal state follows the layout. */
  var wasNarrow = null;
  window.addEventListener('resize', function () { pinOffsets(); var n = !!(window.matchMedia && window.matchMedia('(max-width: 800px)').matches); if (wasNarrow !== null && n !== wasNarrow) render(); wasNarrow = n; });
  /* Redraw only what changed: unchanged regions keep their nodes, so focus, the caret, typed text and scroll inside them stay.
     Nodes that differ are compared a few levels down (screen → run → deck → phase → steps → step) and replaced there. */
  function patch(el, html) {
    var tpl = document.createElement('template');
    if (!tpl.content || !el.firstChild) { el.innerHTML = html; return; }
    tpl.innerHTML = html;
    morph(el, tpl.content, 6);
  }
  function sameAttrs(x, y) {
    if (x.attributes.length !== y.attributes.length) return false;
    for (var i = 0; i < x.attributes.length; i++) if (y.getAttribute(x.attributes[i].name) !== x.attributes[i].value) return false;
    return true;
  }
  function morph(el, next, depth) {
    var as = Array.prototype.slice.call(el.childNodes), bs = Array.prototype.slice.call(next.childNodes);
    /* Match from both ends, so a region that appears or disappears (a notice, the timeline) leaves the rest in place. */
    var fits = function (x, y) { return x.isEqualNode(y) || (x.nodeType === 1 && x.nodeName === y.nodeName && sameAttrs(x, y)); };
    var i = 0, ja = as.length - 1, jb = bs.length - 1;
    while (i <= ja && i <= jb && fits(as[i], bs[i])) i++;
    while (ja >= i && jb >= i && fits(as[ja], bs[jb])) { ja--; jb--; }
    as.slice(i, ja + 1).forEach(function (x) { el.removeChild(x); });
    var before = as[ja + 1] || null;
    bs.slice(i, jb + 1).forEach(function (y) { el.insertBefore(y, before); });
    as.slice(0, i).concat(as.slice(ja + 1)).forEach(function (x, k) {
      var y = k < i ? bs[k] : bs[jb + 1 + (k - i)];
      if (x.isEqualNode(y)) return;
      if (depth > 0 && x.nodeType === 1) morph(x, y, depth - 1);
      else el.replaceChild(y, x);
    });
  }
  /* A redraw can keep a control's node while its markup changed; a bound control then shows what the markup says, which is the
     state, never a stale value the browser held on to (a textarea's value stops following its text once typed in). */
  function syncBound() {
    app.querySelectorAll('[data-bound]').forEach(function (el) {
      if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== el.defaultChecked) el.checked = el.defaultChecked; return; }
      var want = el.defaultValue;
      if (el.tagName === 'SELECT') { want = el.options.length ? el.options[0].value : ''; for (var i = 0; i < el.options.length; i++) if (el.options[i].defaultSelected) want = el.options[i].value; }
      if (el.value === want) return;
      var mine = document.activeElement === el, a = el.selectionStart, b = el.selectionEnd;
      el.value = want;
      if (mine && el.setSelectionRange && a != null) try { el.setSelectionRange(Math.min(a, want.length), Math.min(b, want.length)); } catch (e) { /* not a text field */ }
    });
  }
  /* Removing a focused control during a redraw fires its blur and change events, whose handlers redraw too. A redraw asked
     for during one runs right after it instead, so it never edits the page under the redraw in progress. */
  var rendering = false, composing = false;
  document.addEventListener('compositionstart', function () { composing = true; });
  document.addEventListener('compositionend', function (e) { composing = false; var t = e.target; if (t && t.dispatchEvent && typeof Event === 'function') t.dispatchEvent(new Event('input', { bubbles: true })); });
  function render() {
    /* Nor while someone is composing text (an input method): the redraw waits until the composition ends. */
    if (rendering || composing) { scheduleRender(); return; }
    rendering = true;
    try { renderNow(); } finally { rendering = false; }
  }
  /* Re-render without losing what someone is typing or where their focus is. */
  function renderNow() {
    procCache = null; fixMemo = Object.create(null);
    var keep = {}, ae = document.activeElement, focusKey = null;
    /* What a person typed or ticked survives a redraw of the same thing: the same screen, run, step and open form. Moving to
       another step or form starts clean, so a note or a value never jumps to the wrong place. Hidden inputs are never carried. */
    /* Each input's scope is read from the page it's on: the old page when saving drafts, the new page when restoring them. */
    function scopeOf(el) { var z = el.closest('[data-scope]'); return (app.dataset.scope || '') + '|' + (z ? z.dataset.scope : ''); }
    /* Controls marked data-bound are drawn from state (the draft editor, the step-type form), so they're never carried over. */
    if (!state.planFormReset) app.querySelectorAll('input[id], textarea[id], select[id]').forEach(function (el) { if (el.type !== 'file' && el.type !== 'hidden' && !(el.hasAttribute && el.hasAttribute('data-bound'))) keep[el.id] = { v: el.value, c: el.checked, s: el.selectionStart, e: el.selectionEnd, box: el.type === 'checkbox', scope: scopeOf(el) }; });
    state.planFormReset = false;
    if (ae && (app.contains(ae) || topEl.contains(ae))) focusKey = ae.id ? '#' + ae.id : ae.dataset && ae.dataset.act ? '[data-act="' + ae.dataset.act + '"]' + (ae.dataset.id ? '[data-id="' + cssEsc(ae.dataset.id) + '"]' : '') : null;
    var y = window.scrollY;
    renderTop();
    followDrafts();
    state.editor = state.processId ? editorOf(state.processId) : null;
    state.tags = (state.tagsBy || {})[state.view] || [];
    var v = state.view;
    app.dataset.scope = [v, state.runKey, state.processId, state.fs ? state.fs.id || state.fs.name : '', gen].join('|');
    var PAGES = { run: V.run, mission: V.mission, receipt: V.receipt, finish: V.finish, process: V.process, start: V.start, runs: V.runs, processes: V.processesPage, skills: V.skillsPage, skill: V.skill, types: V.types, settings: V.settings, 'new-process': V.newProcess, health: V.health, connection: V.connection, recovery: V.recoveryPage, setup: V.setup };
    tfPreviewFits();
    if (drawn && drawn.key === state.runKey && drawn.sel === V.runSel(ctx) && drawn.kind === (state.pick && state.pick.kind === 'fields' && state.pick.id === drawn.sel ? 'fields' : 'record')) harvest();
    /* The first time, with only the examples to show, Home is the welcome: Start your team, Join, or Look around. */
    var welcome = v === 'home' && state.fs && state.fs.kind === 'memory' && !state.needsReconnect && !state.lookAround;
    var page = (welcome ? V.setup : PAGES[v] || V.home)(ctx), was = drawn;
    patch(app, page);
    noteDrawn(page);
    /* Boxes drafts own (evidence, Fill in, the note) are carried by their step's draft, never from another step or form. */
    var moved = !!drawn && !(was && was.fs === drawn.fs && was.key === drawn.key && was.sel === drawn.sel && was.kind === drawn.kind);
    if (moved) drawn.ids.forEach(function (id) { delete keep[id]; });
    Object.keys(keep).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && state.clearInputs === id) { el.value = ''; return; }
      if (!el || scopeOf(el) !== keep[id].scope) return;
      if (keep[id].box) { el.checked = keep[id].c; return; }
      if (el.value === keep[id].v) return;
      if (el.tagName === 'SELECT' && !Array.prototype.some.call(el.options, function (o) { return o.value === keep[id].v; })) return;
      el.value = keep[id].v;
    });
    state.clearInputs = null;
    restoreDrafts(moved);
    syncBound();
    typeEditorPage();
    /* The draft editor's text is only there in Markdown mode; in the builder, focus goes to the editor's heading instead. */
    if (state.focus === 'draft-editor' && !document.getElementById('draft-editor')) state.focus = 'ed-h';
    var target = state.focus ? document.getElementById(state.focus) || app.querySelector(state.focus) || topEl.querySelector(state.focus) : focusKey ? app.querySelector(focusKey) || topEl.querySelector(focusKey) : null;
    /* The page someone was on went away (its skill was removed): focus goes to the way back, next to the message saying so. */
    if (!target && focusKey === '#page-h') target = document.getElementById('page-back');
    state.focus = null;
    /* The caret goes back where it was: from the carried-over value, or for a bound control from the node it had before. */
    var caret = keep[target && target.id] || (ae && target && ae.id && ae.id === target.id && ae.selectionStart != null ? { s: ae.selectionStart, e: ae.selectionEnd } : null);
    if (target && document.activeElement !== target) { target.focus({ preventScroll: true }); if (caret && target.setSelectionRange && caret.s != null) try { target.setSelectionRange(caret.s, caret.e); } catch (e) { /* not a text field */ } }
    /* A part just added has its name selected, ready to type over. */
    if (target && state.focusSelect && target.select) target.select();
    state.focusSelect = false;
    /* A box opened prefilled puts the caret at the end, ready to edit. */
    if (target && state.focusEnd && target.setSelectionRange && typeof target.value === 'string') try { target.setSelectionRange(target.value.length, target.value.length); } catch (e) { /* not a text field */ }
    state.focusEnd = false;
    var pi = document.getElementById('pick-input') || document.getElementById('edit-input');
    if (pi && document.activeElement !== pi) pi.focus({ preventScroll: true });
    pinOffsets();
    if (window.scrollY !== y) window.scrollTo(0, y);
    /* An open dialog isn't rebuilt by background refreshes unless its content changed, so focus inside it stays put. */
    var ov = state.overlay ? state.overlay.html() : '';
    if (ov !== lastOverlay) {
      /* Typing in a dialog's search redraws it; focus and the caret go back to the same control. */
      var oa = document.activeElement, osel = oa && overlayEl.contains(oa) ? selectorOf(oa) : null, os = oa && oa.selectionStart;
      overlayEl.innerHTML = ov; lastOverlay = ov;
      /* A text attachment is put in as text, never as markup. */
      var tp = state.overlay && state.overlay.text != null && document.getElementById('att-text'); if (tp) tp.textContent = state.overlay.text;
      var want = state.overlayFocus || osel; state.overlayFocus = null;
      var back = want && overlayEl.querySelector(want); if (back) { back.focus(); if (os != null && back.setSelectionRange && !state.overlayFocus) try { back.setSelectionRange(os, os); } catch (e) { /* not a text field */ } }
    }
    if (state.overlay) {
      /* If focus was lost (the focused control disappeared), it goes to the dialog's close button rather than the page. */
      var c = overlayEl.querySelector('#lb-close, #rel-close, #ob-sheet-close, #tp-close, #ca-close, .help [data-act="close-overlay"]');
      if (c && !overlayEl.contains(document.activeElement)) c.focus();
      app.setAttribute('inert', ''); topEl.setAttribute('inert', '');
    } else { app.removeAttribute('inert'); topEl.removeAttribute('inert'); }
    /* Typed text whose box has left the screen (a mode switch, another screen) was never applied: it isn't pending. */
    if (state.obPendingField && (!document.getElementById(state.obPendingField) || app.innerHTML.indexOf('id="' + state.obPendingField + '"') < 0)) dropPending();
    editorPage();
    runPage();
    sheet();
    announce();
    tick();
    lsSet('filter', state.filter);
  }
  var lastOverlay = '';
  /* The draft editor is a page of its own: the app's top bar hides and the page stops scrolling (each pane scrolls). The
     selected item and its line in the preview are brought into view when the selection or the inspector tab changes. */
  var lastShown = '';
  function editorPage() {
    var on = state.view === 'process' && state.ptab === 'edit' && !!currentProcess(), de = document.documentElement;
    if (de && de.classList) { if (on) de.classList.add('fpe-on'); else de.classList.remove('fpe-on'); }
    try { if (on) sessionStorage.setItem('preflight:editing', state.processId); else if (!resumeEdit) sessionStorage.removeItem('preflight:editing'); } catch (e) { /* this tab only */ }
    var s = state.obSel, k = on && s ? [s.kind, s.key, s.track, state.insTab].join('|') : '';
    if (k === lastShown) return;
    lastShown = k; if (!k) return;
    reveal(s.kind === 'step' ? '[data-ob-step="' + cssEsc(s.key) + '"]' : s.kind === 'track' ? '.ob-lane.sel' : '[data-ob-phase="' + cssEsc(s.key) + '"]');
    reveal('#pv-sel', 'center');
  }
  /* The run screen is a page of its own too: the top bar hides and, on a wider screen, each pane scrolls on its own. Next up
     sticks under the header on a phone, whatever height the header wraps to. Pane positions saved on the way to screen share
     come back on the way out. */
  function runPage() {
    var on = state.view === 'run' && !!ctx.run(), de = document.documentElement;
    if (de && de.classList) { if (on) de.classList.add('rw-on'); else de.classList.remove('rw-on'); }
    var head = on && app.querySelector && app.querySelector('.rw-head');
    if (head && head.offsetHeight && de.style) de.style.setProperty('--rw-head-h', head.offsetHeight + 'px');
    /* Steps and phases brought into view stop below the sticky Next up (and the picker beside it on laptops). */
    var dock = on && app.querySelector && app.querySelector('.rw-dock');
    if (dock && dock.offsetHeight && de.style) de.style.setProperty('--rw-dock-h', dock.offsetHeight + 'px');
    var nb = on && app.querySelector && app.querySelector('.rw-next');
    if (nb && nb.offsetHeight && de.style) de.style.setProperty('--rw-next-h', nb.offsetHeight + 'px');
    var keep = on && state.paneScroll && state.paneScroll.key === state.runKey ? state.paneScroll : null;
    if (keep) { state.paneScroll = null; ['rw-list', 'rw-ins'].forEach(function (id) { var el = document.getElementById(id); if (el && keep[id] != null) el.scrollTop = keep[id]; }); }
    /* A run opens with its selected step in view beside the inspector. */
    if (on && state.revealSel) { state.revealSel = false; if (!narrow() && state.sel) reveal('#step-' + cssEsc(state.sel), 'center'); }
  }
  function savePanes() { var k = { key: state.runKey }; ['rw-list', 'rw-ins'].forEach(function (id) { var el = document.getElementById(id); if (el) k[id] = el.scrollTop; }); state.paneScroll = k; }
  /* On a phone the step panel covers the screen, so it behaves like a dialog: the rest is inert, focus moves into it, and
     closing returns focus to the step it came from. */
  var sheetWasOpen = false, obSheetOpen = false, obInert = [];
  /* The builder's side form too: on a phone it covers the outline, everything else is inert, and Done closes it. */
  function obSheet(narrow) {
    obInert.forEach(function (el) { el.removeAttribute('inert'); }); obInert = [];
    if (wasNarrow === null) wasNarrow = narrow;
    var form = app.querySelector('.ob-form'), open = !!(narrow && form && !form.closest('[hidden]') && state.view === 'process' && state.ptab === 'edit' && state.obSel && !state.obAdd && !state.overlay);
    if (open) {
      for (var n = form; n && n !== app && n.parentNode; n = n.parentNode) Array.prototype.forEach.call(n.parentNode.children, function (sib) { if (sib !== n && !sib.hasAttribute('inert')) { sib.setAttribute('inert', ''); obInert.push(sib); } });
      topEl.setAttribute('inert', ''); form.setAttribute('role', 'dialog'); form.setAttribute('aria-modal', 'true');
      if (!form.contains(document.activeElement)) { var f = form.querySelector('input, select, textarea, button'); if (f) f.focus(); }
    } else if (form) { form.removeAttribute('role'); form.removeAttribute('aria-modal'); }
    obSheetOpen = open;
    return open;
  }
  function sheet() {
    var narrow = window.matchMedia && window.matchMedia('(max-width: 800px)').matches, ref = app.querySelector('.rw-ins[data-open="true"]');
    if (obSheet(narrow)) return;
    var open = !!(narrow && ref && state.view === 'run');
    app.querySelectorAll('.rw-head, .rw-strip, .rw-alerts, .rw-rail, .rw-list').forEach(function (el) { if (open) el.setAttribute('inert', ''); else el.removeAttribute('inert'); });
    if (open) { topEl.setAttribute('inert', ''); ref.setAttribute('role', 'dialog'); ref.setAttribute('aria-modal', 'true'); if (!sheetWasOpen || !ref.contains(document.activeElement)) { var c = ref.querySelector('.close'); if (c) c.focus(); } }
    else if (!state.overlay) topEl.removeAttribute('inert');
    if (sheetWasOpen && !open && state.sel) { var back = document.querySelector('[data-act="select"][data-id="' + cssEsc(state.sel) + '"]'); if (back) back.focus({ preventScroll: true }); }
    sheetWasOpen = open;
  }
  /* Messages are announced from one stable live region outside the redrawn screen, so screen readers hear each one once. */
  /* The same words said again (Undo twice in a row) are a new message, so they're announced again. */
  var said = '', saidMsg = null;
  function announce() {
    var t = state.msg ? state.msg.text : '', el = document.getElementById('live');
    if (el && t && (t !== said || state.msg !== saidMsg)) el.textContent = t === said && el.textContent === t ? t + '\u00a0' : t;
    said = t; saidMsg = state.msg;
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'); }

  /* Timers and countdowns update every second without a full re-render. */
  /* While a run is open in the recorder's window, say once when a timed step is about to start or is late. */
  var lastRemind = 0;
  function remind(now) {
    var r = ctx.run();
    if (now - lastRemind < 30000 || !r || state.view !== 'run') return;
    lastRemind = now;
    /* Badges and the timeline change as time passes even when nothing is saved: redraw when any timed item's status does. */
    var sig = R.schedule(r, R.mapOf(r), now).map(function (it) { return it.id + ':' + it.status; }).join('|');
    if (state.schedSig && state.schedSig.key === r.id && state.schedSig.sig !== sig) render();
    state.schedSig = { key: r.id, sig: sig };
    if (!ctx.recording(r) || r.paused || (state.msg && !state.msg.quiet)) return;
    var seen = state.reminded = state.reminded || {};
    R.schedule(r, R.mapOf(r), now).some(function (it) {
      var k = r.id + ':' + it.id + ':' + it.status;
      if (seen[k] || (it.status !== 'soon' && it.status !== 'late' && it.status !== 'started?')) return false;
      seen[k] = true;
      say((it.status === 'soon' ? 'Coming up at ' : it.status === 'late' ? 'Late (due ' : 'Was due to start at ') + U.hm(new Date(it.ms).toISOString()) + (it.status === 'late' ? ')' : '') + ': ' + it.title, it.status === 'soon' ? 'good' : 'warn');
      render(); return true;
    });
  }
  /* Home and Runs say when plans are ("in 2 hours", "was due yesterday") and Home shows a plan from a day before it, so redraw
     when any of that changes with time alone, even if nothing in the folder did. */
  var planSig = null;
  function planClock(now) {
    if (state.view !== 'home' && state.view !== 'runs') { planSig = null; return; }
    var sig = state.view + '|' + data.plans.map(function (p) {
      var t = p._status ? null : V.planWhen(p);
      return t == null ? '' : p.id + ':' + (t - now <= 86400000 ? 'due ' : '') + U.dueWords(p.when, now);
    }).join('|');
    if (planSig !== null && sig !== planSig) render();
    planSig = sig;
  }
  var hintsShown = 0;
  function tick() {
    var now = Date.now(), soonest = null;
    /* A check that has waited 3 minutes without an answer shows what to look at, without waiting for a new file. */
    if (state.view === 'connection') {
      var waits = PF.connection.results(state.connSent || [], state.conn, state.connSeen || {}, now).filter(function (r) { return r.hint; }).length;
      if (waits !== hintsShown) { hintsShown = waits; later(); }
    }
    document.querySelectorAll('[data-since]').forEach(function (el) {
      var ms = now - new Date(el.dataset.since) - (+el.dataset.offset || 0), exp = +el.dataset.expect || 0;
      el.textContent = U.clock(ms); el.classList.toggle('over', !!exp && ms > exp);
      if (exp && ms > exp) el.title = 'Longer than usual (' + U.clock(exp) + ')';
    });
    document.querySelectorAll('[data-until]').forEach(function (el) {
      var ms = new Date(el.dataset.until) - now;
      el.textContent = ms >= 0 ? U.clock(ms) + ' left' : 'Deadline passed ' + U.clock(-ms) + ' ago';
      el.classList.toggle('due', ms < 5 * 60000); el.classList.toggle('over', ms >= 5 * 60000);
      if (soonest == null || ms < soonest) soonest = ms;
    });
    remind(now);
    planClock(now);
    /* The tab says which run it is, so several open tabs are easy to tell apart. */
    var open = (state.view === 'run' || state.view === 'mission') && ctx.run(), base = open ? open.title + ' · Flightdeck' : 'Flightdeck';
    document.title = soonest != null && soonest > -600000 ? (soonest >= 0 ? '⏱ ' + U.clock(soonest) + ' · ' : '⚠ deadline passed · ') + base : base;
  }
  setInterval(tick, 1000);

  /* Refresh from the folder: often while a run is open, less often elsewhere, and when the window gets focus. */
  var lastRun = 0, lastAll = 0;
  function inRun() { return state.view === 'run' || state.view === 'mission' || state.view === 'receipt' || state.view === 'finish'; }
  setInterval(function () {
    if (document.hidden || isBusy() || !state.fs || loading) return;
    var now = Date.now();
    if ((state.view === 'connection' || (state.view === 'setup' && state.setup && state.setup.step === 'second')) && now - lastConn >= PF.connection.EVERY_MS) { lastConn = now; loadConn(); }
    if (inRun() && now - lastRun >= 5000) { lastRun = now; refreshRun(); return; }
    if (now - lastAll >= (inRun() ? 60000 : 30000)) { lastAll = now; load(); }
  }, 1000);
  window.addEventListener('focus', function () { if (state.fs && !isBusy()) { if (inRun()) { lastRun = Date.now(); refreshRun(); } else { lastAll = Date.now(); load(); } } });

  /* ---------- saving ---------- */
  /* Resolves true once the change is in the team folder, false if it isn't. The save always goes to the folder the change was
     made in, even if someone switches folders while it's queued. */
  function save(r, opts) {
    var fs = state.fs, g = gen, endBusy = busyStart(), rev = edits(r.id), pend = state.pendingSaves = state.pendingSaves || {};
    pend[r.id] = (pend[r.id] || 0) + 1;
    function settled() { endBusy(); if (g === gen) { pend[r.id]--; if (pend[r.id] <= 0) delete pend[r.id]; } }
    return queued(function () { return repo.saveRun(fs, r, SESSION, Object.assign({}, opts, { writer: WRITER, lock: LOCKS ? lock : null })); }).then(function (wrote) {
      settled();
      if (g !== gen) return true;
      var key = r.process + '/' + r.id, done = edits(r.id) === rev;
      /* Only the change this save carried is now safe; a newer one stays marked until its own save lands. */
      if (done && (!state.unsaved[r.id] || state.unsaved[r.id] === r)) { delete state.unsaved[r.id]; delete state.saveErr[r.id]; if (state.saveOpts) delete state.saveOpts[r.id]; }
      /* What this save wrote is now the last version known to be in the folder: Discard goes back to it, and every read
         that started before it is too old to apply. */
      var landed = wrote && wrote.text ? R.sanitize(JSON.parse(wrote.text)) : null;
      if (landed) {
        Object.keys(r).forEach(function (f) { if (f[0] === '_' && !(f in landed)) landed[f] = r[f]; });
        landed._fileHash = U.hash(wrote.text); landed._overflow = [];
        baselines[r.id] = { run: landed };
      }
      runOutcome(key, 'run'); bump('~' + r.id);
      render();
      return true;
    }, function (e) {
      settled();
      if (g !== gen) { lsSet(localKey(r.id, fs), r); return false; }
      if (e.disk) {
        if (state.unsaved[r.id] === r && edits(r.id) === rev) delete state.unsaved[r.id];
        if (!e.keptAs) lsSet(localKey(r.id), r);
        /* "Before" is this save's own revision: if the person changed anything after it, the newer change stays on screen. */
        var mineAt = {}; mineAt[r.id] = rev; mineAt['~' + r.id] = edits('~' + r.id);
        var at = { seq: ++readsStarted, revs: mineAt };
        return repo.loadRun(fs, r.process, r.id).then(function (fresh) {
          if (g !== gen) return false;
          var replaced = !!fresh && applyRunRead(r.process + '/' + r.id, at, { kind: 'run', run: fresh });
          if (replaced) { for (var i = 0; i < data.runs.length; i++) if (data.runs[i].id === r.id) data.runs[i] = fresh; }
          say(V.nameOf(ctx, e.disk.recorder.person) + ' saved this run from another window or computer, so your change wasn\'t written over theirs. ' +
            (replaced ? 'You\'re seeing their version. ' : 'Your newer change is still on screen and will be checked against theirs when it saves. ') +
            (e.keptAs ? 'Yours is kept as a conflict copy; compare it below and keep whichever is right.' : 'Your copy is kept in this browser.'), 'bad');
          render();
          return false;
        });
      }
      if (e.missing) runOutcome(r.process + '/' + r.id, 'missing');
      else if (e.unreadable) runOutcome(r.process + '/' + r.id, 'unread', 'isn\'t a run this copy can read');
      /* The run object holding the newest change is what's shown and what Try again saves. */
      state.unsaved[r.id] = r; state.saveErr[r.id] = e.message; (state.saveOpts = state.saveOpts || {})[r.id] = opts;
      for (var i = 0; i < data.runs.length; i++) if (data.runs[i].id === r.id) data.runs[i] = r;
      render();
      return false;
    });
  }
  function snapshot(r) { var c = {}; Object.keys(r).forEach(function (k) { if (k[0] !== '_') c[k] = r[k]; }); return JSON.stringify(c); }
  /* "Busy" pauses background refreshes while work is in flight. Each piece of work holds its own claim, released exactly once,
     and claims from a folder you've switched away from never touch the new folder's count. */
  function busyStart() { var g = gen, open = true; state.busyN = (state.busyN || 0) + 1; return function () { if (!open) return; open = false; if (g === gen) state.busyN = Math.max(0, state.busyN - 1); }; }
  function isBusy() { return (state.busyN || 0) > 0; }
  /* A "run another process" step: start the child run with the details it carries, then link it to this step. */
  function startChild(stepId) {
    var parent = ctx.run(), map = parent && R.mapOf(parent), x = map && M.findStep(map, stepId);
    if (!x || !ctx.recording(parent)) return;
    var f = R.fieldsOf(parent, x.step), pub = ctx.latestPub(f.process), a0 = parent.steps[stepId], rkey = state.runKey + ':' + stepId;
    /* One start at a time per step: a second click while the first is saving, or a step that already has a current child, does nothing. */
    if ((state.startingChild = state.startingChild || {})[rkey] || (a0 && a0.child && R.childCurrent(parent, x.step, a0) && !a0.child.failed) || parent.paused) return;
    if (!pub) { say('"' + f.process + '" isn\'t published in this folder yet.', 'warn'); render(); return; }
    var cp = R.childProblem(parent, x.step, pub.map.meta.context);
    if (cp) { say(cp, 'warn'); render(); return; }
    var details = R.childDetails(parent, x.step, pub.map.meta.context), roles = {};
    pub.map.meta.roles.forEach(function (ro) { roles[ro] = parent.roles[ro] || ''; });
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (err) { tz = ''; }
    /* The child counts for exactly the details it was started with: snapshot them now, before any save can let them change. */
    var own = String(f.sets || '').split(',').map(function (k) { return k.trim(); });
    var inputs = {}; Object.keys(details).forEach(function (k) { inputs[k] = details[k]; }); (x.step.binds || []).forEach(function (k) { inputs[k] = parent.details[k] || ''; });
    own.forEach(function (k) { delete inputs[k]; });
    var child; try { child = R.create(pub, { title: pub.map.meta.title + ' for ' + parent.title, details: details, roles: roles, by: state.me, session: SESSION, now: new Date().toISOString(), tz: tz, workflows: data.jira.workflows, parent: { process: parent.process, id: parent.id, step: stepId, inputs: inputs } }); }
    catch (err) { say(err.message, 'warn'); render(); return; }
    /* Try the link on a copy first, so a step that can't take a child never leaves an orphan run in the folder. */
    try { R.linkChild(JSON.parse(JSON.stringify(parent)), map, stepId, { process: child.process, id: child.id, inputs: inputs }, state.me, new Date().toISOString()); }
    catch (err) { say(err.message, 'warn'); render(); return; }
    var sfs = state.fs, sg = gen, key = state.runKey, endBusy = busyStart();
    state.startingChild[rkey] = true;
    var done = function () { endBusy(); delete state.startingChild[rkey]; };
    queued(function () { child.recorder.session = SESSION; return repo.saveRun(sfs, child, SESSION, { writer: WRITER, lock: LOCKS ? lock : null }); }).then(function () {
      if (sg !== gen) { done(); return; }
      return mutateRun(key, sg, function (r, m, me, now) { R.linkChild(r, m, stepId, { process: child.process, id: child.id, inputs: inputs }, me, now); }).then(function (ok) {
        done();
        if (sg !== gen) return;
        if (ok === false) { say('"' + child.title + '" was started but isn\'t linked to this step yet. Use Link it on the step.', 'warn'); render(); return load(true); }
        say('Started "' + child.title + '". This step is checked when it completes.', 'good'); return load(true);
      });
    }, function (err) { done(); if (sg !== gen) return; say('Couldn\'t start the run: ' + err.message, 'bad'); render(); });
  }
  /* The recorder's window settles a parent step once its child run ends: done if it completed, blocked otherwise. */
  function syncChildren() {
    data.runs.forEach(function (r) {
      if (!ctx.recording(r) || r.paused || state.unsaved[r.id]) return;
      Object.keys(r.steps).forEach(function (sid) {
        var a = r.steps[sid], c = a && a.child && ctx.findRun(a.child.process + '/' + a.child.id), x = M.findStep(R.mapOf(r), sid), v = x && R.childVerdict(r, x.step, a, c);
        /* Settled once: a failed child stays failed (unblocking the step won't re-block it); a new child replaces it. */
        if (!v || a.child.failed || !R.childCurrent(r, x.step, a) || a.s === 'done' || a.s === 'na') return;
        mutateRun(r.process + '/' + r.id, gen, function (rr, m, me, now) { R.settleChild(rr, m, sid, c, me, now); }, { background: true });
      });
    });
  }
  /* ---------- templates and step types ---------- */
  /* Which folder an editor belongs to: unsaved edits stay with their own folder, and come back when you switch back. */
  function fsKey() { var f = state.fs; return f ? f.kind + ':' + (f.id || f.name || '') : ''; }
  /* One editor per folder and process, so opening another draft or another folder never discards unsaved work. */
  function edKey(pid, k) { return (k == null ? fsKey() : k) + '\n' + pid; }
  function editorOf(pid, k) { return (state.editors || {})[edKey(pid, k)] || null; }
  function setEditor(ed) { (state.editors = state.editors || {})[edKey(ed.pid, ed.fsKey)] = ed; return ed; }
  function dropEditor(pid) { if (state.editors) delete state.editors[edKey(pid)]; }
  function dirty(ed) { return !!(ed && ed.text != null && ed.text !== ed.base); }
  /* The editor for a process: text and the fingerprint it was opened from, taken together, once. */
  function openEditor(p) {
    var ed = editorOf(p.id);
    if (ed) return ed;
    var base = p.draft ? p.draft.md : p.latest ? p.latest.md : '';
    return setEditor({ pid: p.id, fsKey: fsKey(), base: base, baseHash: p.draft ? U.hash(p.draft.md) : null, text: null, seen: cachedHash(p.id) });
  }
  function editorDirty(p) { return dirty(editorOf(p.id)); }
  /* While a save of this draft is in flight, nothing else may change it: say so and stop. */
  function stillSaving(p) { if (!state.draftSaving[edKey(p.id)]) return false; say('Still saving this draft. Try again in a moment.', 'warn'); render(); return true; }
  /* The fingerprint of the draft as this window last read it from the folder. */
  function cachedHash(pid) { var p = processes().filter(function (x) { return x.id === pid; })[0]; return p && p.draft ? U.hash(p.draft.md) : null; }
  /* An editor with nothing unsaved follows the draft in the folder; one with unsaved changes keeps what it started from,
     so saving it over a newer draft is a conflict, never an overwrite. */
  function followDrafts() {
    if (!state.editors) return;
    processes().forEach(function (p) {
      /* Only a read that started after the editor's own save or Take theirs counts, so an older copy still in memory or
         an older read finishing late never undoes it. A later read is the folder as it is, whatever it holds. */
      /* Nor while this window's own save of it is still finishing (an Undo made meanwhile is newer than either), nor while
         text typed in the builder's form isn't applied yet (that's unsaved too). */
      var ed = editorOf(p.id); if (!ed || ed.conflict || dirty(ed) || state.obPending === p.id || !p.draft || state.draftSaving[edKey(p.id)] || (data.readSeq || 0) <= (ed.after || 0)) return;
      /* Undo steps were taken against the old text; one applied now would bring it back over the newer draft. They stay
         listed in History, behind a barrier. */
      var h = U.hash(p.draft.md); if (h !== ed.baseHash) { ed.base = p.draft.md; ed.baseHash = h; ed.text = null; ed.fresh = null; TL.barrier(tlOf(ed), 'The draft changed in the folder here. Earlier changes can\'t be undone.'); }
    });
  }
  function currentProcess() { var id = state.processId; return processes().filter(function (x) { return x.id === id; })[0] || null; }
  var renderTimer = null;
  function scheduleRender() { if (renderTimer) return; renderTimer = setTimeout(function () { renderTimer = null; render(); }, 250); }
  /* Save a draft only over the version the editor started from; anything else is shown as a conflict, never overwritten. */
  /* opts.replace (a restore): the editor is replaced only once the save succeeds; a failed or refused one keeps it as it was. */
  /* One save of a draft at a time: a second save would start from the same fingerprint and conflict with this window's own
     first save, and edits typed during a restore would be replaced by it. While a restore saves, the draft can't be edited. */
  state.draftSaving = {};
  function saveDraftText(p, text, expectHash, okMsg, opts) {
    opts = opts || {};
    var sfs = state.fs, g = gen, key = fsKey(), file = p.draft ? p.draft.file : p.id + '.md', sk = edKey(p.id, key);
    var dw = draftUnread(p);
    if (dw) { say(dw + ' Nothing was saved over it. Choose Refresh, then save again.', 'warn'); render(); return; }
    if (state.draftSaving[sk]) { say('Still saving this draft. Try again in a moment.', 'warn'); render(); return; }
    state.draftSaving[sk] = opts.replace ? 'restore' : 'save';
    /* The changes this save carries, so History can say they were saved; typing after it starts a new unit. */
    var ed0 = editorOf(p.id, key), carried = ed0 && ed0.tl ? ed0.tl.entries.slice(0, ed0.tl.pos) : [];
    if (ed0 && ed0.tl) TL.close(ed0.tl);
    /* When it ends, the controls it disabled come back, also if someone left this folder and returned meanwhile. */
    var done = function () { delete state.draftSaving[sk]; if (fsKey() === key) scheduleRender(); };
    render();
    var write = opts.write || function (f, name, t, h, o) { return repo.saveDraft(f, name, t, h, o); };
    queued(function () { return write(sfs, file, text, expectHash, { lock: LOCKS ? lock : null }); }).then(function (res) {
      done();
      /* Only this process's editor in its own folder is touched, whatever is on screen now, even after a folder switch. */
      var ed = editorOf(p.id, key), here = g === gen && state.processId === p.id && fsKey() === key;
      if (res.conflict && opts.replace) { if (g === gen) { say('The draft changed since you looked, so nothing was restored. Look again, then restore.', 'warn'); render(); } return; }
      if (res.conflict) {
        if (ed) { if (ed.text == null) ed.text = text; ed.baseHash = expectHash; ed.conflict = res; }
        else setEditor({ pid: p.id, fsKey: key, text: text, base: '', baseHash: expectHash, conflict: res });
        if (g !== gen) return;
        if (here) state.ptab = 'edit'; else say('The draft of ' + p.title + ' wasn\'t saved: someone else changed it. Open it to compare.', 'warn');
        render();
        /* A draft that was missing and is back (a recovery that found a new file) needs the folder read to show it. */
        if (!p.draft) return load(true);
        return;
      }
      /* Saved: the editor now starts from what was saved. Anything typed while it saved stays, as unsaved changes. */
      /* Undo steps survive a save: undoing one makes the draft unsaved again, and saving it is checked like any other. A
         restore replaced the text, so nothing before it can be undone. Parts saved are no longer new. */
      if (!opts.replace && ed && ed.text != null && ed.text !== text) { ed.base = text; ed.baseHash = res.hash; ed.conflict = null; ed.seen = cachedHash(p.id); ed.after = readsStarted; ed.fresh = null; }
      else ed = setEditor({ pid: p.id, fsKey: key, base: text, baseHash: res.hash, text: null, seen: cachedHash(p.id), after: readsStarted, tl: ed && ed.tl });
      if (opts.replace) { if (ed.tl) TL.barrier(ed.tl, opts.why || 'The draft was replaced here. Earlier changes can\'t be undone.'); }
      else TL.saved(carried, res.hash);
      if (ed.tl) learnIds(ed, text);
      if (g !== gen) return;
      if (opts.replace) dropPending();
      if (opts.replace && here) { state.mapVer = null; state.focus = 'cl-h'; }
      say(okMsg, 'good', opts.act);
      /* In the editor a save is confirmed by a quiet check beside Save (and still announced), not a notice. */
      if (!opts.replace && state.view === 'process' && state.ptab === 'edit' && state.processId === p.id) state.msg.quiet = true;
      /* A quiet check beside Save, for a moment. */
      if (!opts.replace) { var mark = state.justSaved = { pid: p.id }; setTimeout(function () { if (state.justSaved === mark) { state.justSaved = null; scheduleRender(); } }, 1600); }
      /* What has to follow the save (an applied correction's decision) happens only once the draft is in the folder. */
      return Promise.resolve(opts.after ? opts.after(res) : null).then(function () { if (g === gen) return load(true); });
    }, function (err) { done(); if (fsKey() !== key) return; say('Couldn\'t save the draft of ' + p.title + ': ' + err.message, 'bad'); render(); });
  }
  /* ---------- applying a correction to the draft (docs/design.md section 19, slice 2) ---------- */
  function caOv() { return state.overlay && state.overlay.corrApply ? state.overlay : null; }
  function caFind(pid, gid) {
    var p = processes().filter(function (x) { return x.id === pid; })[0], all = p ? ctx.corrections(p.id) : [];
    return { p: p, all: all, g: all.filter(function (x) { return x.id === gid; })[0] || null };
  }
  function caErr(ov, msg, field) { ov.err = { msg: msg, field: field || 'ca-acts' }; state.overlayFocus = field ? '#' + field : '#ca-t'; render(); }
  /* The draft a correction is compared with: the editor's starting point, the same one the dialog shows (views corrBase). */
  function caBase(p) { var ed = editorOf(p.id); return ed ? ed.base : p.draft ? p.draft.md : p.latest ? p.latest.md : ''; }
  /* Why nothing may be applied to this draft right now, or ''. Unsaved edits in this window come first: applying over them
     would mix the correction into changes nobody has saved. */
  function caBlocked(p) {
    var dw = draftUnread(p); if (dw) return dw + ' Nothing is applied until it reads again.';
    if (state.draftSaving[edKey(p.id)]) return 'Still saving this draft. Try again in a moment.';
    var ed = editorOf(p.id);
    if (ed && ed.conflict) return 'Someone else changed this draft while you were editing it. Settle that in the editor first.';
    if (dirty(ed) || state.obPending === p.id) return 'You have unsaved changes to this draft. Save or discard them in the editor first.';
    return '';
  }
  /* A decision of applied, with the result it records, written once; Link, Already addressed and Mark as applied in the dialog. */
  function caDecide(ov, status, reason, msg, result) {
    var x = caFind(ov.pid, ov.gid), g = x.g; if (!g || !state.me) return;
    var rec;
    try { rec = PF.corrections.decision(g, state.me, status, reason, new Date().toISOString(), { current: g.decision, act: U.randomId(10), result: result }); }
    catch (e) { caErr(ov, e.message, status === 'declined' ? 'ca-reason' : null); return; }
    var dfs = state.fs, gg = gen;
    ov.busy = true;
    queued(function () { return repo.decideCorrection(dfs, rec, WRITER); }).then(function () {
      if (gg !== gen) return; if (caOv() === ov) closeOverlay(); state.focus = 'fx-h'; say(msg, 'good'); return load(true);
    }, function (e) { if (gg !== gen) return; ov.busy = false; if (caOv() === ov) caErr(ov, 'Couldn\'t save the decision: ' + e.message); else { say('Couldn\'t save the decision: ' + e.message, 'bad'); render(); } });
  }
  /* Applies a group, or a person's edit of it, to the draft: one named change on the draft editor's timeline (so Undo takes it
     back), saved only over the exact draft it was compared with, then the decision. If the decision can't be written, the
     draft already has the change: the next look shows "already" with Link this correction. */
  function applyCorr(ov, how) {
    var x = caFind(ov.pid, ov.gid), p = x.p, g = x.g, C = PF.corrections; if (!g || !p || !state.me) return;
    var why = caBlocked(p); if (why) { caErr(ov, why); return; }
    var ed = openEditor(p), base = ed.base, op = g.change.op, edited = null;
    if (how === 'edit' && (op === 'wording' || op === 'add')) {
      var el = document.getElementById('ca-edit'); edited = String(el ? el.value : ov.edit ? ov.edit.text : '').replace(/\s+/g, ' ').trim();
      if (!edited) { caErr(ov, op === 'add' ? 'Say what the new step is.' : 'Say what the step should say.', 'ca-edit'); return; }
    }
    var rv = C.review(g, base, edited);
    if (rv.state === 'manual' || rv.state === 'gone' || !rv.text) { caErr(ov, rv.reason || 'This can\'t be applied here.', edited != null && rv.state === 'manual' ? 'ca-edit' : null); return; }
    /* Only a clean comparison applies on its own; anything else needs the person's edit or confirmation (how === 'edit'). */
    if (how !== 'edit' && rv.state !== 'clean') { caErr(ov, 'The draft changed since this was shown. Look at the comparison again.'); return; }
    if (rv.text === base) { caErr(ov, 'That\'s what the draft says now. Choose Cancel, then Already addressed.', edited != null ? 'ca-edit' : null); return; }
    var subj = (rv.now && rv.now.text) || g.from || '', lb = TL.labelOf({ op: 'applyCorrection' }), others = C.alternatives(x.all, g).filter(function (y) { return y.id !== g.id; });
    var ids = how === 'edit' && ov.combine ? ov.combine : [g.id], gs = ids.map(function (id) { return x.all.filter(function (y) { return y.id === id; })[0]; }).filter(Boolean);
    var before = obSnap(ed);
    learnIds(ed, ed.base); dropPending();
    TL.record(tlOf(ed), base, rv.text, { kind: 'op', lines: true, label: lb.label, subject: subj, items: ['step:' + (rv.added || g.target.step)], selBefore: before });
    ed.text = rv.text; state.planFormReset = true; state.obFlash = null; state.obAsk = null;
    var dfs = state.fs, gg = gen, text = rv.text, added = rv.added, me = state.me, left = others.filter(function (y) { return ids.indexOf(y.id) < 0; }).length;
    closeOverlay(); state.focus = 'fx-h';
    saveDraftText(p, text, ed.baseHash, TL.past(lb.past, subj) + '. Saved to the draft.' + (left ? ' The other proposal' + (left === 1 ? ' is' : 's are') + ' still open.' : ''), {
      act: { act: 'tl-undo', id: 'draft', label: 'Undo' },
      write: function (f, file, t, h, o) { return repo.applyCorrection(f, { process: p.id, file: file, base: base, expect: h, group: g, edited: edited, confirmed: how === 'edit', text: t }, o); },
      after: function () {
        if (gg !== gen) return null;
        return gs.reduce(function (pr, y) {
          return pr.then(function () {
            var rec = C.decision(y, me, 'applied', '', new Date().toISOString(), { current: y.decision, act: U.randomId(10), result: C.outcome(y, text, y === g ? added : '') });
            return queued(function () { return repo.decideCorrection(dfs, rec, WRITER); });
          });
        }, Promise.resolve()).catch(function (e) { if (gg === gen) say('The draft has the correction, but marking it as applied didn\'t save: ' + e.message + ' Review it again and choose Link this correction.', 'warn'); });
      }
    });
  }
  /* ---------- the outline builder ---------- */
  /* No builder edits while a restore replaces the draft (the same rule as typing, where the editor isn't even shown). */
  function builderBlocked(p) { if (state.draftSaving[edKey(p.id)] !== 'restore') return false; say('Restoring the draft. You can edit it when that finishes.', 'warn'); render(); return true; }
  /* Apply one outline operation to the editor's current text. The result is unsaved, like typing: Save draft, conflicts
     and checks work exactly as they do for the Markdown. Returns the operation's result, or null if nothing changed. */
  /* field: the input the value came from, so a refusal shows next to it. what: the change in a few words, for Undo. */
  function builderEdit(op, field, what) {
    var p = currentProcess(); if (!p || builderBlocked(p)) return null;
    var ed = openEditor(p), cur = ed.text != null ? ed.text : ed.base, res = PF.outline.apply(cur, op);
    if (res.error) {
      if (field) { state.fieldErr = { id: 'ob', msg: res.error, field: field }; state.focus = '#' + field; say(null); } else say(res.error, 'warn');
      render(); return null;
    }
    if (state.fieldErr && state.fieldErr.id === 'ob') state.fieldErr = null;
    var before = obSnap(ed);
    learnIds(ed, ed.base);
    dropPending();
    if (res.same) return res;
    /* Each change keeps what was selected, being added, new in this window and typed but not applied then, so undoing
       puts those back with the text. */
    var lb = TL.labelOf(op), subj = opSubject(cur, op);
    TL.record(tlOf(ed), cur, res.text, { kind: 'op', lines: true, label: lb.label, subject: subj, items: opItems(op, res), selBefore: before });
    ed.text = res.text; state.planFormReset = true; state.obFlash = null; state.obReveal = null; state.obAsk = null;
    say(TL.past(lb.past, subj) + '. Undo available.', 'good', { act: 'tl-undo', id: 'draft', label: 'Undo' });
    /* A step or phase without a unique ID is known by its place, so what's selected or being added to follows the change. */
    var F = function (kind, key) { return PF.outline.follow(cur, res.text, op, res.at, kind, key); };
    var sl = state.obSel; if (sl && sl.pid === p.id) { var nk = F(sl.kind === 'track' ? 'phase' : sl.kind, sl.key); if (nk) sl.key = nk; else state.obSel = null; }
    var ad = state.obAdd;
    if (ad && ad.pid === p.id) {
      if (ad.after != null) ad.after = F(ad.kind === 'phase' ? 'phase' : 'step', ad.after);
      if (ad.phase != null) ad.phase = F('phase', ad.phase);
      if (ad.kind === 'step' && ad.after == null && ad.phase == null) state.obAdd = null;
    }
    return res;
  }
  /* ---------- Undo, Redo and History (PF.timeline): one timeline per draft editor and per step-type form ---------- */
  var TL = PF.timeline;
  function tlOf(ed) { return ed.tl || (ed.tl = TL.create()); }
  /* Every ID that was ever in a saved or loaded draft in this session: such a part is never new again, so no Undo can let
     its ID follow its name. Kept on the timeline, which outlives the editor objects a save replaces. */
  function learnIds(ed, text) { if (!ed || text == null) return; var tl = tlOf(ed), ids = PF.outline.parse(text).ids, k = tl.savedIds || (tl.savedIds = Object.create(null)); Object.keys(ids).forEach(function (x) { k[x] = true; }); }
  /* What rides along with a builder change: the selection, what's being added and the parts new in this window (freshCopy),
     so Undo and Redo put them back with the text. Typing not yet applied is never replayed: Undo waits for it instead. */
  function obSnap(ed) { var snap = function (x) { return x ? JSON.parse(JSON.stringify(x)) : null; }; return { obSel: snap(state.obSel), obAdd: snap(state.obAdd), fresh: ed ? freshCopy(ed) : null }; }
  /* The step or phase an outline operation is about, in words and as a History item. */
  function opSubject(text, op) {
    if (op.op === 'add') return String(op.text || '').trim();
    if (op.op === 'addPhase' || op.op === 'addTrack') return String(op.title || '').trim();
    if (op.op === 'editTrack' || op.op === 'deleteTrack') { var ph = PF.outline.parse(text).phases.filter(function (y) { return y.key === String(op.phase); })[0], tr = ph && ph.tracks[+op.track]; return tr ? String(tr.title || '') : ''; }
    var o = PF.outline.parse(text), isStep = op.step != null, k = String(isStep ? op.step : op.phase), x = (isStep ? o.steps : o.phases).filter(function (y) { return y.key === k; })[0];
    return x ? String(isStep ? x.text : x.title).replace(/\*\*|__|`/g, '') : '';
  }
  function opItems(op, res) {
    if (op.op === 'add') return res.id ? ['step:' + res.id] : [];
    if (op.op === 'addPhase') return res.id ? ['phase:' + res.id] : [];
    return op.step != null ? ['step:' + op.step] : op.phase != null ? ['phase:' + op.phase] : [];
  }
  var INPUT_KINDS = { insertFromPaste: ['paste', 'paste'], insertFromPasteAsQuotation: ['paste', 'paste'], deleteByCut: ['cut', 'cut'], insertFromDrop: ['drop', 'drag and drop', 'join'], deleteByDrag: ['drop', 'drag and drop', 'wait'], insertReplacementText: ['correction', 'spelling correction'] };
  function inputKind(t) { var k = INPUT_KINDS[t], o = k ? { kind: k[0], label: k[1] } : { kind: 'typing', label: 'typing' }; if (k && k[2]) o[k[2]] = 'drag'; return o; }
  /* An input method (Japanese, Chinese, Korean…) shows text that changes until it's committed: the whole composition is one
     change, from the text before it started. */
  var ime = null;
  function imeStep(e, id, now) {
    if (composing || e.isComposing) { if (!ime || ime.id !== id) ime = { id: id, before: now }; return true; }
    return false;
  }
  document.addEventListener('compositionstart', function (e) {
    var id = (e.target && e.target.id) || '', p, ed;
    if (id === 'draft-editor' && (p = currentProcess()) && (ed = editorOf(p.id)) && ed.tl) TL.close(ed.tl);
    if (/^tf-/.test(id) && state.typeForm && state.typeForm.tl) TL.close(state.typeForm.tl);
  });
  function imeBefore(id, fallback) { var b = ime && ime.id === id ? ime.before : null; ime = null; return b != null ? b : fallback; }
  /* Typing in the Markdown: one unit per run of typing, named by the step or phase it's in. */
  function recordTyping(ed, before, after, inputType) {
    var tl = tlOf(ed), seq = tl.seq, k = inputKind(inputType);
    var e = TL.record(tl, before, after, { kind: k.kind, label: k.label, lines: true, wait: k.wait, join: k.join });
    if (e && e.id > seq) { var hit = TL.itemAt(after, e.start); if (hit) { e.subject = hit.subject; e.items = [hit.item]; } }
  }
  /* The step-type form's controls in words, and what each one holds, for naming and showing typing there. */
  var TF_NAMES = { id: 'ID', label: 'Label', hint: 'What it\'s for', icon: 'Icon', group: 'Group', tags: 'Tags' };
  var TF_PARTS = { name: 'name', label: 'label', kind: 'kind', options: 'options', required: 'usually filled in', long: 'long text' };
  function tfControl(def, id) {
    var m = /^tf-(f|r)-(k\d+)-(\w+)$/.exec(id || '');
    if (m) {
      var r = (m[1] === 'f' ? def.fields : def.record).filter(function (x) { return x.k === m[2]; })[0]; if (!r) return null;
      return { name: (TF_PARTS[m[3]] || m[3]) + ' of ' + (m[1] === 'f' ? 'field ' : 'evidence ') + (r.name || '(unnamed)'), item: (m[1] === 'f' ? 'field:' : 'evidence:') + m[2], value: String(r[m[3]] == null ? '' : r[m[3]]) };
    }
    if (/^tf-icon-/.test(id || '')) return { name: 'Icon', item: 'type:icon', value: def.icon || '' };
    var k = /^tf-(\w+)$/.exec(id || ''); if (!k || !TF_NAMES[k[1]]) return null;
    return { name: TF_NAMES[k[1]], item: 'type:' + k[1], value: String(def[k[1]] == null ? '' : def[k[1]]) };
  }
  function typeTl(f) { return f.tl || (f.tl = TL.create()); }
  /* Text typed in Add an option or Add a tag is added as soon as the person leaves the box or does anything else (another
     row, Save, Done, Undo…): one recorded change each, trimmed. Empty text, or an option or tag already there, is left out.
     There's no half-typed state to keep, so nothing can be lost or block Undo. */
  function optsList(r) { return String(r.options || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function tagsList(d) { return String(d.tags || '').split(',').map(function (x) { return x.trim().replace(/^#/, ''); }).filter(Boolean); }
  function cleanTag(v) { return String(v || '').trim().replace(/^#/, '').replace(/,/g, ' ').trim().slice(0, 30); }
  function addOption(f, p, v) {
    var r = rowOf(f.def, p); v = String(v || '').trim().slice(0, 40); if (!r || r.kind !== 'choice' || !v) return null;
    var o = optsList(r); if (o.indexOf(v) >= 0) return 'dup';
    var before = typeSnap(f), focus = '#tf-' + p[0] + '-' + p[1] + '-optadd';
    r.options = o.concat(v).join('\n');
    recordTypeForm(f, before, { kind: 'form', label: 'new option', subject: v, items: [rowItem(p)], selBefore: { focus: focus }, selAfter: { focus: focus } });
    return 'added';
  }
  function addTag(f, v) {
    v = cleanTag(v); if (!v) return null;
    var t = tagsList(f.def); if (t.indexOf(v) >= 0) return 'dup';
    var before = typeSnap(f); f.def.tags = t.concat(v).join(', ');
    recordTypeForm(f, before, { kind: 'form', label: 'new tag', subject: v, items: ['type:tags'], selBefore: { focus: '#tf-tagadd' }, selAfter: { focus: '#tf-tagadd' } });
    return 'added';
  }
  /* Add whatever the Add boxes on screen hold. noRead: the caller reads the form itself (a change of a field's type must not
     be read before its options are added). */
  function flushAdds(f, noRead) {
    if (!f) return false; if (!noRead) readTypeForm();
    var any = false, box = function (id) { var el = document.getElementById(id); if (!el || !String(el.value || '').trim()) return null; var v = el.value; el.value = ''; return v; };
    var tv = box('tf-tagadd'); if (tv != null && addTag(f, tv) === 'added') any = true;
    [['f', f.def.fields], ['r', f.def.record]].forEach(function (x) { x[1].slice().forEach(function (r) { if (r.kind !== 'choice') return; var v = box('tf-' + x[0] + '-' + r.k + '-optadd'); if (v != null && addOption(f, [x[0], r.k], v) === 'added') any = true; }); });
    return any;
  }
  /* The step-type editor is a page of its own, like the draft editor: the app's top bar hides while it's open. */
  /* The phone preview sheet exists only below 800 px: on a wider screen it's closed before anything is drawn, so the page
     never shows an inert editor without a way out. Widening the window redraws at once. */
  function narrowNow() { return !!(window.matchMedia && window.matchMedia('(max-width: 800px)').matches); }
  function tfPreviewFits() { if (state.tfPreview && !narrowNow()) state.tfPreview = false; }
  (function () { var mq = window.matchMedia && window.matchMedia('(max-width: 800px)'); if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (state.tfPreview && !mq.matches) render(); }); })();
  function typeEditorPage() {
    var on = state.view === 'types' && !!state.typeForm && state.typeForm.fsKey === fsKey(), de = document.documentElement;
    if (de && de.classList) { if (on) de.classList.add('tfe-on'); else de.classList.remove('tfe-on'); }
    if (!on) state.tfPreview = false;
  }
  function rowIndex(list, k) { return list.map(function (r) { return r.k; }).indexOf(k); }
  function rowOf(d, p) { var list = p[0] === 'f' ? d.fields : d.record; return list[rowIndex(list, p[1])] || null; }
  function rowItem(p) { return (p[0] === 'f' ? 'field:' : 'evidence:') + p[1]; }
  /* One change to the step type from a button (a move, an option, a tag): fn changes the definition and returns what it was
     about, or null for no change. Recorded, so Undo takes it back. */
  function typeChange(label, fn, items, focus) {
    var f = state.typeForm; if (!f) return; flushAdds(f);
    var before = typeSnap(f), subject = fn(f.def);
    if (subject == null) return;
    recordTypeForm(f, before, { kind: 'form', label: label, subject: String(subject), items: items, selBefore: { focus: focus }, selAfter: { focus: focus } });
    state.focus = focus; render();
  }
  /* A step type's timeline outlives its form, as a draft's does: saving or closing keeps it (with the form as saved, row keys
     and all), and opening the type again picks it up. If the file changed since, earlier changes stay listed but can't be
     undone. */
  var typeTls = {};
  function keepTypeTl(f, id, def, hash) { if (f.tl && id) typeTls[f.fsKey + '\n' + id] = { tl: f.tl, def: def ? JSON.parse(JSON.stringify(def)) : null, hash: hash, tail: def ? typeTail(f) : null }; }
  function resumeTypeTl(f, id, hash) {
    var k = typeTls[fsKey() + '\n' + id]; if (!k) return f;
    f.tl = k.tl;
    if (k.def && k.hash === hash) { f.def = k.def; f.tlTail = k.tail; f.initial = V.typeFormSnapshot(f.def); }
    else TL.barrier(f.tl, 'The step type changed in the folder here. Earlier changes can\'t be undone.');
    return f;
  }
  /* A change in the step-type form: its whole definition before and after, rows with their keys, so undoing a removal puts
     the row back in place with everything it had. */
  function recordTypeForm(f, before, meta) { var e = TL.record(typeTl(f), before, typeSnap(f), meta); if (e) f.flash = { items: meta.items || [], at: Date.now() }; return e; }
  /* What the timeline records of a step type: everything a person set, and nothing made from it. A name or ID still made
     from its label isn't stored (so typing a label is one change, not two far apart), and a saved type's ID isn't stored at
     all (so no Undo can move it to another file). A typed ID goes last, apart from the rest. */
  function typeSnap(f) {
    /* A switch that was never touched and one switched off are the same: both are stored as false, so reading the page
       never looks like a change. */
    var row = function (flag) { return function (r) { var o = {}; Object.keys(r).forEach(function (k) { if (k !== 'name' || r.nameSet) o[k] = r[k]; }); o[flag] = !!r[flag]; return o; }; };
    var d = f.def, out = {};
    Object.keys(d).forEach(function (k) { if (k !== 'id' && k !== 'idSet') out[k] = d[k]; });
    out.fields = d.fields.map(row('required')); out.record = d.record.map(row('long'));
    /* The typed ID stays in the text after saving too (it's then fixed and ignored), so its earlier changes still undo. */
    return JSON.stringify(out) + '\n' + typeTail(f);
  }
  /* The ID part of the history's text. Once the type is saved its ID is fixed: the history keeps the ID part as it last
     replayed it, so every earlier change still applies, while the form always shows the saved ID. */
  function typeTail(f) {
    if (f.existing && f.tlTail != null) return f.tlTail;
    /* idSet first: the first letter typed into the ID flips it, and the letters after it then join the same Undo. */
    var d = f.def, t = JSON.stringify({ idSet: !!d.idSet, id: d.idSet ? d.id : '' });
    if (f.existing) f.tlTail = t;
    return t;
  }
  function typeUnsnap(f, text) {
    var i = text.indexOf('\n'), d = JSON.parse(i < 0 ? text : text.slice(0, i)), t = i < 0 ? null : JSON.parse(text.slice(i + 1)), S = V.typeSlugs;
    if (f.existing) f.tlTail = i < 0 ? null : text.slice(i + 1);
    d.idSet = !!f.existing || !!(t && t.idSet);
    d.id = f.existing || (t && t.idSet ? t.id : S.id(d.label));
    d.fields.concat(d.record).forEach(function (r) { if (!r.nameSet) r.name = S.name(r.label); });
    f.def = d;
  }
  function typeFormInput(e, typing) {
    var f = state.typeForm, id = e.target.id;
    if (!typing && /-kind$/.test(id)) flushAdds(f, true);
    var cur = typeSnap(f);
    if (typing && imeStep(e, id, { json: cur, val: tfControl(f.def, id) })) { readTypeForm(); return; }
    var start = typing ? imeBefore(id, null) : null, before = start ? start.json : cur, was = start ? start.val : tfControl(f.def, id);
    readTypeForm();
    var now = tfControl(f.def, id), k = typing && e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT' ? inputKind(e.inputType) : { kind: 'form', label: /-kind$/.test(id) ? 'type change' : /^tf-icon/.test(id) ? 'icon change' : 'setting change' };
    if (now) recordTypeForm(f, before, { kind: k.kind, label: k.label, subject: now.name, group: id, items: [now.item], selBefore: { focus: '#' + id }, selAfter: { focus: '#' + id }, show: { before: was ? was.value : '', after: now.value }, wait: k.wait, join: k.join });
    /* A committed composition is a change of its own: typing after it starts another. */
    if (start) TL.close(typeTl(f));
  }
  /* Which editor Undo and Redo act on here, or null to leave the keys to the browser. */
  function tlScope() {
    if (state.overlay) return state.overlay.hist || null;
    if (state.view === 'process' && state.ptab === 'edit' && currentProcess()) return 'draft';
    if (state.view === 'types' && state.typeForm && state.typeForm.fsKey === fsKey()) return 'type';
    return null;
  }
  function tlFor(scope) {
    if (scope === 'type') return state.typeForm ? typeTl(state.typeForm) : null;
    var p = currentProcess(); return p ? tlOf(openEditor(p)) : null;
  }
  /* Focus the first of these that's on the page. */
  function focusFirst(sels) {
    for (var i = 0; i < sels.length; i++) { var el = sels[i] && (document.getElementById(sels[i]) || app.querySelector(sels[i])); if (el && el.focus) { if (document.activeElement !== el) el.focus({ preventScroll: true }); return; } }
  }
  function itemSel(item) { var m = /^(step|phase):(.+)$/.exec(item || ''); return m ? '[data-act="' + (m[1] === 'step' ? 'ob-sel' : 'ob-sel-phase') + '"][data-id="' + cssEsc(m[2]) + '"]' : null; }
  /* Undo or Redo in one editor. how: 'button' keeps focus on the button pressed, so it can be pressed again; 'key' moves focus
     to what changed (the step's row, the field, or the caret in the Markdown). Either way the message says what happened. */
  function tlMove(scope, redo, how) {
    var tl = tlFor(scope); if (!tl) return;
    var p = scope === 'draft' ? currentProcess() : null, ed = p && openEditor(p), f = scope === 'type' ? state.typeForm : null;
    if (p && builderBlocked(p)) return;
    /* Text typed in a builder box and not applied (or refused) isn't in the draft: Undo would replace the box and lose it,
       so it waits until that text is applied or cleared. An Add box keeps its text through Undo (below). */
    var pf = p && state.obPending === p.id && state.obPendingField;
    if (pf && !/^ob-new-/.test(pf)) {
      say('Apply or clear what you typed in the box first (Enter applies it), then ' + (redo ? 'Redo' : 'Undo') + '.', 'warn');
      state.focus = '#' + pf; render(); return;
    }
    /* The step-type editor's Add boxes add what they hold first, so Undo takes that back like any other change. */
    if (f) flushAdds(f, true);
    var top = TL.peek(tl).undo;
    /* What's selected now is what Redo will put back. */
    if (!redo && top && scope === 'draft' && top.kind === 'op') top.selAfter = obSnap(ed);
    var cur = p ? (ed.text != null ? ed.text : ed.base) : typeSnap(f), r = redo ? TL.redo(tl, cur) : TL.undo(tl, cur);
    /* A new step or phase being written in its Add box isn't in the text yet: Undo and Redo keep the box and what's typed in
       it. If the step or phase it goes after would change or disappear, nothing is undone, so the typing is never lost. */
    var adding = p && !r.error && state.obAdd && state.obAdd.pid === p.id && (val('ob-new-text') || val('ob-new-title')) ? state.obAdd : null;
    if (adding && !addAnchorKept(adding, cur, r.text)) {
      tl.pos += redo ? -1 : 1;
      say('Add or cancel the new ' + (adding.kind === 'phase' ? 'phase' : 'step') + ' you\'re writing first: ' + (redo ? 'Redo' : 'Undo') + ' would take away the place it goes.', 'warn');
      state.focus = adding.kind === 'phase' ? 'ob-new-title' : 'ob-new-text'; render(); return;
    }
    if (r.error) {
      var locked = r.none && TL.peek(tl).locked && !redo;
      say(locked ? 'Earlier changes can\'t be undone: the ' + (p ? 'draft' : 'step type') + ' was replaced since. History shows where.' : r.error, 'warn'); render(); return;
    }
    var k = TL.peek(tl), words = (redo ? 'Redid ' : 'Undid ') + TL.describe(r.entry) + '.';
    /* Undo of an applied correction from the process page: the draft is now unsaved, so the editor shows it. */
    if (p && state.view === 'process' && state.ptab !== 'edit') state.ptab = 'edit';
    if (p) {
      ed.text = r.text; obClearErr(); state.planFormReset = !adding; state.obPlace = null; state.obAsk = null; state.obFlash = null;
      if (r.sel && 'obSel' in r.sel) {
        state.obSel = r.sel.obSel; state.obAdd = adding || r.sel.obAdd;
        /* Parts already in the saved draft are never new again, whatever an older change remembered. */
        if (r.sel.fresh) { learnIds(ed, ed.base); var saved = tl.savedIds, fr = Object.create(null); Object.keys(r.sel.fresh).forEach(function (k) { if (!saved[k]) fr[k] = true; }); ed.fresh = fr; }
      }
    } else { typeUnsnap(f, r.text); state.fieldErr = null; }
    say(words + (redo ? (k.undo ? ' Undo available.' : '') : ' Redo available.'), 'good', redo ? { act: 'tl-undo', id: scope, label: 'Undo' } : { act: 'tl-redo', id: scope, label: 'Redo' });
    var mine = '[data-act="' + (redo ? 'tl-redo' : 'tl-undo') + '"][data-id="' + scope + '"]', sl = state.obSel, md = p && !state.builder;
    /* In the builder, Undo from its button goes to the item it restored (as the builder always has); with nothing to go to,
       focus stays on the button so it can be pressed again. */
    var back = p && state.builder && how === 'button' && !state.overlay && state.obSel ? selFocus(state.obSel) : null;
    state.focus = back || (how === 'button' && !state.overlay ? mine : md && !state.overlay ? 'draft-editor' : null);
    render();
    /* The Markdown's caret marks the change, whichever way Undo was pressed. */
    var ta = md && document.getElementById('draft-editor');
    if (ta && ta.setSelectionRange) try { ta.setSelectionRange(r.caret.start, r.caret.end); } catch (err) { /* not a text field */ }
    if (how === 'button' || state.overlay || md) return;
    focusFirst(p ? [sl ? selFocus(sl) : null, itemSel(r.entry.items[0]), mine] : [r.sel && r.sel.focus, mine]);
  }
  /* The step or phase an open Add box goes after (or into) is the same one, with the same words, in the new text. */
  function addAnchorKept(a, oldText, newText) {
    var O1 = PF.outline.parse(oldText), O2 = PF.outline.parse(newText);
    var same = function (kind, key) {
      var list = kind === 'phase' ? 'phases' : 'steps', w = kind === 'phase' ? 'title' : 'text', find = function (o) { return o[list].filter(function (x) { return x.key === String(key); })[0]; };
      var x = find(O1), y = find(O2); return !!x && !!y && x[w] === y[w];
    };
    if (a.after != null && !same(a.kind === 'phase' ? 'phase' : 'step', a.after)) return false;
    if (a.phase != null && !same('phase', a.phase)) return false;
    return true;
  }
  function openHistory(scope, item) {
    var tl = tlFor(scope); if (!tl) return;
    openOverlay({ hist: scope, item: item || null, html: function () {
      var o = this, t = tlFor(o.hist), p = currentProcess(), f = state.typeForm, name = o.item;
      if (o.item && o.hist === 'draft' && p) { var m = /^(step|phase):(.+)$/.exec(o.item), ed = editorOf(p.id); if (m && ed) { var x = PF.outline.parse(ed.text != null ? ed.text : ed.base)[m[1] === 'step' ? 'steps' : 'phases'].filter(function (y) { return y.key === m[2]; })[0]; if (x) name = m[1] + ' "' + String(m[1] === 'step' ? x.text : x.title).replace(/\*\*|__|`/g, '') + '"'; } }
      if (o.item && o.hist === 'type' && f) { var c = tfControl(f.def, 'tf-' + (/^field:/.test(o.item) ? 'f-' : 'r-') + o.item.split(':')[1] + '-name'); if (c) name = c.name.replace(/^name of /, ''); }
      return V.historyDrawer(ctx, { scope: o.hist, tl: t, item: o.item, itemName: name, title: o.hist === 'draft' ? (p ? 'Draft of ' + p.title : '') : f ? (f.existing ? '{' + f.existing + '}' : 'New step type') : '' });
    } });
  }
  /* A value as the outline ops apply it (lineValue): line breaks become spaces and the ends are trimmed; spaces inside
     (a command's arguments) are its content. */
  function norm(v) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim(); }
  function dropPending() { state.obPending = null; state.obPendingField = null; }
  /* What the draft says now for a box in the builder's form, to tell typed text from what's applied. */
  function fieldApplied(id) {
    var p = currentProcess(), s = state.obSel; if (!p || !s || /^ob-new-/.test(id)) return '';
    var o = PF.outline.parse(edText(p)), st = s.kind === 'step' && o.steps.filter(function (x) { return x.key === s.key; })[0], ph = s.kind !== 'step' && o.phases.filter(function (x) { return x.key === s.key; })[0];
    if (id === 'ob-text') return st ? st.text : '';
    if (/^ob-fld-/.test(id)) return st ? st.fields[id.slice(7)] || '' : '';
    if (id === 'ob-ph-title') return ph ? ph.title : '';
    if (id === 'ob-tr-title') { var tr = ph && ph.tracks[+s.track]; return tr ? tr.title : ''; }
    if (id === 'ob-g-title' || id === 'ob-g-approves') return ph && ph.gate ? (id === 'ob-g-title' ? ph.gate.title : ph.gate.approves) : '';
    return '';
  }
  function obClearErr() { if (state.fieldErr && state.fieldErr.id === 'ob') state.fieldErr = null; dropPending(); }

  /* Parts added in this window and not saved yet, by ID: own keys only, so an ID like "constructor" is never one of them.
     Each Undo step keeps a copy, so undoing an addition also undoes its being new. */
  function isFresh(ed, id) { return !!(id && ed && ed.fresh && Object.prototype.hasOwnProperty.call(ed.fresh, id)); }
  function markFresh(ed, id) { if (!id) return; if (!ed.fresh) ed.fresh = Object.create(null); ed.fresh[id] = true; }
  function freshCopy(ed) { var c = Object.create(null); if (ed.fresh) Object.keys(ed.fresh).forEach(function (k) { c[k] = true; }); return c; }
  /* On a phone the properties form is a sheet over the outline: an addition in the outline closes it first, or the new box
     would sit behind it. */
  function sheetAway() { if (narrow()) { state.obSel = null; state.obAsk = null; } }
  function partsSheetAway() { if (state.overlay && state.overlay.obParts) { state.overlay = null; app.removeAttribute('inert'); topEl.removeAttribute('inert'); } }
  /* Where focus goes for a selection: its row, lane or phase in the outline. */
  function selFocus(s) {
    if (!s) return null;
    return s.kind === 'step' ? '[data-act="ob-sel"][data-id="' + cssEsc(s.key) + '"]' : s.kind === 'track' ? '[data-act="ob-sel-track"][data-id="' + cssEsc(s.key) + '"][data-track="' + s.track + '"]' : '[data-act="ob-sel-phase"][data-id="' + cssEsc(s.key) + '"]';
  }
  function narrow() { return !!(window.matchMedia && window.matchMedia('(max-width: 800px)').matches); }
  function edText(p) { var ed = openEditor(p); return ed.text != null ? ed.text : ed.base; }
  /* The new item is shown: the page scrolls just enough to bring it into view (renders keep the scroll where it was). */
  function reveal(sel, block) { var el = sel && document.querySelector(sel); if (el && el.scrollIntoView) el.scrollIntoView({ block: block || 'nearest' }); }

  /* ---------- the parts box: placing a new part ---------- */
  /* Choosing a part (click, Enter or Space) starts placing it: the place nearest what's selected is offered first, the
     arrow keys move among the places it can legally go, Enter puts it there, Escape cancels. A part dragged in skips this. */
  function startPlacing(partId, via) {
    var p = currentProcess(), pt = p && V.obPart(ctx, partId); if (!pt) return;
    obClearErr(); state.obAdd = null; state.obAsk = null;
    var sel = state.obSel && state.obSel.pid === p.id ? state.obSel : null, at = PF.outline.nearest(edText(p), pt.kind, sel);
    state.obPlace = { pid: p.id, part: pt.id, at: at, via: via || '' };
    if (at) { say('Placing ' + pt.label + '. Choose a destination. Escape cancels.'); state.focus = destSel(at); }
    else { say('Nowhere to put ' + pt.noun + '. ' + V.obNowhere(PF.outline.parse(edText(p)), pt), 'warn'); state.focus = 'ob-place-cancel'; }
    render(); if (at) reveal(destSel(at));
  }
  function destSel(id) { return '[data-act="ob-place-at"][data-id="' + cssEsc(id) + '"]'; }
  function cancelPlacing() {
    var pl = state.obPlace; if (!pl) return;
    state.obPlace = null; say('Canceled. Nothing was added.');
    state.focus = pl.via === 'sheet' ? '[data-act="ob-parts-open"]' : '[data-act="ob-part"][data-id="' + cssEsc(pl.part) + '"]'; render();
  }
  function movePlace(e) {
    var pl = state.obPlace, p = currentProcess(), pt = p && pl && V.obPart(ctx, pl.part); if (!pt) return;
    var list = PF.outline.places(edText(p), pt.kind), i = 0; if (!list.length) return;
    for (var k = 0; k < list.length; k++) if (list[k].id === pl.at) i = k;
    var j = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : i + (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1);
    j = Math.max(0, Math.min(list.length - 1, j));
    pl.at = list[j].id; state.focus = destSel(pl.at); render(); reveal(destSel(pl.at));
  }
  /* Put a part at a place, if it can legally go there: one builder edit (so Undo takes it back), then the new item is
     selected with its name ready to type over, and a message says where it went. */
  function placePart(partId, placeId) {
    var p = currentProcess(), pt = p && V.obPart(ctx, partId); if (!pt) return;
    var cur = edText(p), place = PF.outline.places(cur, pt.kind).filter(function (x) { return x.id === placeId; })[0];
    if (!place) {
      var none = !PF.outline.places(cur, pt.kind).length;
      say(none ? 'Nowhere to put ' + pt.noun + '. ' + V.obNowhere(PF.outline.parse(cur), pt) : pt.label + ' can\'t go there. Choose one of the places marked for it.', 'warn'); render(); return;
    }
    var m = placeId.split(':'), op, meta = PF.map.parse(cur).meta;
    if (pt.kind === 'step') op = { op: 'add', to: m[0] === 'before' ? { before: m[1] } : { phase: m[1], track: +m[2], where: 'end' }, text: pt.text, type: pt.type, mark: pt.mark };
    else if (pt.kind === 'phase') op = { op: 'addPhase', first: m[1] === '^', after: m[1] === '^' ? null : m[1], title: pt.title, mode: 'READ-DO' };
    else if (pt.kind === 'gate') op = { op: 'gate', phase: m[1], set: { title: pt.title } };
    else {
      /* A new lane works as a role no lane in its phase has yet, else the first role; it's named after that role. */
      var ph = PF.outline.parse(cur).phases.filter(function (x) { return x.key === m[1]; })[0], taken = ph ? ph.tracks.reduce(function (a, t) { return a.concat(t.roles); }, []) : [];
      var role = meta.roles.filter(function (r) { return taken.indexOf(r) < 0; })[0] || meta.roles[0] || '';
      op = { op: 'addTrack', to: { phase: m[1], before: m[2] === 'end' ? null : +m[2] }, title: role ? role.charAt(0).toUpperCase() + role.slice(1).replace(/[-_]+/g, ' ') : pt.title, role: role, text: pt.text, type: 'confirm' };
    }
    var res = builderEdit(op, null, 'added ' + pt.noun); if (!res) return;
    var ed = openEditor(p);
    state.obPlace = null; state.obAdd = null;
    if (pt.kind === 'step') { markFresh(ed, res.id); state.obSel = { pid: p.id, kind: 'step', key: res.id }; state.obFlash = { kind: 'step', key: res.id }; state.focus = 'ob-text'; if (pt.mark === '!') state.obReveal = res.id; }
    else if (pt.kind === 'phase') { markFresh(ed, res.id); state.obSel = { pid: p.id, kind: 'phase', key: res.id }; state.obFlash = { kind: 'phase', key: res.id }; state.focus = 'ob-ph-title'; }
    else if (pt.kind === 'gate') { markFresh(ed, res.id); state.obSel = { pid: p.id, kind: 'phase', key: m[1] }; state.obFlash = { kind: 'gate', key: m[1] }; state.focus = 'ob-g-title'; }
    else { markFresh(ed, res.id); markFresh(ed, res.step); state.obSel = { pid: p.id, kind: 'track', key: res.phase, track: res.track }; state.obFlash = { kind: 'track', key: res.phase, track: res.track }; state.focus = 'ob-tr-title'; }
    state.focusSelect = true; state.insTab = null;
    sayUndo('Added ' + pt.noun + ' ' + place.where + '.'); render();
    reveal(pt.kind === 'step' ? '[data-ob-step="' + cssEsc(res.id) + '"]' : pt.kind === 'phase' ? '[data-ob-phase="' + cssEsc(res.id) + '"]' : '#ob .ob-new');
  }
  function builderMoveStep(key, dir, from) {
    var res = builderEdit({ op: 'move', step: key, dir: dir }); if (!res) return;
    /* A step without a unique ID is known by its place, so the selection follows it to its new place. */
    var p = currentProcess(), nk = PF.outline.keyAt(openEditor(p).text, res.at) || key;
    state.focus = from === 'row' ? '[data-act="ob-sel"][data-id="' + cssEsc(nk) + '"]' : '[data-act="ob-move"][data-dir="' + (dir < 0 ? 'up' : 'down') + '"]';
    render();
  }
  /* A role or run detail button turns it on or off for the selected step, from what the text says now. */
  function builderToggle(kind, name) {
    var s = state.obSel, p = currentProcess(); if (!s || s.kind !== 'step' || !p) return;
    var ed = openEditor(p), step = PF.outline.parse(ed.text != null ? ed.text : ed.base).steps.filter(function (x) { return x.key === s.key; })[0]; if (!step) return;
    var set = {}; set[kind] = name; set.on = (kind === 'role' ? step.parts.roles : step.parts.binds).indexOf(name) < 0;
    if (builderEdit({ op: 'edit', step: s.key, set: set })) { state.focus = '[data-act="ob-' + kind + '"][data-id="' + cssEsc(name) + '"]'; render(); }
  }
  /* The side form's controls: which one changed says what to change. */
  function builderField(id, value) {
    var s = state.obSel, cp = currentProcess(); if (!s || !cp || s.pid !== cp.id) return;
    var refocus = '#' + id, res = null, ed = openEditor(cp), o = PF.outline.parse(edText(cp)), fresh = function (x) { return isFresh(ed, x); };
    var ph = o.phases.filter(function (x) { return x.key === s.key; })[0];
    /* A part added in this window and not saved yet takes its ID from the name it's given (it's in no run or skill). */
    var reid = function (oldId, r) { if (r && r.id && r.id !== oldId && fresh(oldId)) markFresh(ed, r.id); return r; };
    if (s.kind === 'step') {
      var st = o.steps.filter(function (x) { return x.key === s.key; })[0], mk = id === 'ob-mark' ? (value === 'must' ? '!' : value === 'planned' ? '~' : ' ') : null;
      var set = id === 'ob-text' ? { text: value, reid: !!(st && fresh(st.id)) } : mk ? { mark: mk } : id === 'ob-type' ? { type: value } : /^ob-fld-[\w-]+$/.test(id) ? { field: id.slice(7), value: value } : null;
      if (!set) return;
      res = reid(st && st.id, builderEdit({ op: 'edit', step: s.key, set: set }, id));
      /* The three kinds exclude each other: say what the new one means, and what leaving must-do allows. */
      if (res && !res.same && mk) { say((st && st.must && mk !== '!' ? 'No longer a must-do step: it can now be marked N/A or waived. ' : '') + (mk === '!' ? 'Now a must-do step: it can\'t be marked N/A or waived.' : mk === '~' ? 'Automation planned. It\'s still done by hand for now.' : 'Now a plain step.'), 'good'); refocus = '#ob-mark-' + value; }
    } else if (s.kind === 'track') {
      var tr = ph && ph.tracks[+s.track]; if (!tr) return;
      if (id === 'ob-tr-title') res = reid(tr.id, builderEdit({ op: 'editTrack', phase: s.key, track: s.track, set: { title: value, reid: fresh(tr.id) } }, id));
      else if (id === 'ob-tr-role') res = builderEdit({ op: 'editTrack', phase: s.key, track: s.track, set: { role: value } }, id);
      else return;
    } else {
      if (id === 'ob-ph-title') res = reid(ph && ph.id, builderEdit({ op: 'editPhase', phase: s.key, set: { title: value, reid: !!(ph && fresh(ph.id)) } }, id));
      else if (id === 'ob-ph-mode') res = builderEdit({ op: 'editPhase', phase: s.key, set: { mode: value } }, id);
      else if (id === 'ob-g-title' || id === 'ob-g-owner' || id === 'ob-g-approves') {
        /* Leaving the "name a gate" box empty adds nothing. */
        if (ph && !ph.gate && !String(value).trim()) return;
        var g = {}; g[id === 'ob-g-title' ? 'title' : id === 'ob-g-owner' ? 'owner' : 'approves'] = value;
        if (id === 'ob-g-title' && ph && ph.gate && fresh(ph.gate.id)) g.reid = true;
        res = reid(ph && ph.gate && ph.gate.id, builderEdit({ op: 'gate', phase: s.key, set: g }, id));
      } else return;
    }
    if (res) { state.focus = refocus; render(); }
  }
  /* Dragging a step or a part: the drop lines take no room, so nothing moves while aiming. The line nearest the pointer that
     can take it lights up and says where it will land. The keyboard does the same with Alt+Up / Alt+Down (steps) or by
     choosing a part and the arrow keys, and the side form has Move up / Move down. */
  var drag = null, partDrag = null;
  function bodyClass(on, names) { var b = document.body; if (b && b.classList) names.forEach(function (n) { if (on) b.classList.add(n); else b.classList.remove(n); }); }
  function dragClear() {
    drag = null; partDrag = null;
    bodyClass(false, ['ob-dragging', 'ob-for-move', 'ob-for-step', 'ob-for-lanes', 'ob-for-gate', 'ob-for-phase']);
    Array.prototype.forEach.call(document.querySelectorAll('.ob-step.lifted, .ob-slot.over'), function (el) { el.classList.remove('lifted'); el.classList.remove('over'); });
  }
  /* The line under the pointer if it takes what's dragged, else the nearest one that does, within the outline. */
  function dropSlotOf(e) {
    var t = e.target; if (!t || !t.closest) return null;
    var sel = partDrag ? '[data-for="' + partDrag.kind + '"]' : '[data-ob-drop]', direct = t.closest(sel); if (direct) return direct;
    if (!t.closest('#ob-outline')) return null;
    var best = null, bd = Infinity;
    Array.prototype.forEach.call(document.querySelectorAll('#ob-outline ' + sel), function (el) {
      var r = el.getBoundingClientRect(), dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right), dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom), d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = el; }
    });
    return best;
  }
  document.addEventListener('dragstart', function (e) {
    var pe = e.target && e.target.closest && e.target.closest('[data-ob-part]');
    if (pe) {
      dragClear(); partDrag = V.obPart(ctx, pe.getAttribute('data-ob-part')); if (!partDrag) return;
      try { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', partDrag.label); } catch (err) { /* older browsers */ }
      var kind = partDrag.kind; setTimeout(function () { if (partDrag) bodyClass(true, ['ob-dragging', 'ob-for-' + kind]); }, 0);
      return;
    }
    var row = e.target && e.target.closest && e.target.closest('[data-ob-step]'); if (!row) return;
    dragClear(); drag = row.getAttribute('data-ob-step');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', drag); } catch (err) { /* older browsers */ }
    row.classList.add('lifted');
    /* Lighting the lines after the browser has taken its picture of the row keeps the drag from being cancelled. */
    setTimeout(function () { if (drag) bodyClass(true, ['ob-dragging', 'ob-for-move']); }, 0);
  });
  document.addEventListener('dragover', function (e) {
    if (!drag && !partDrag) return;
    /* Near the top or bottom of the outline's pane, it scrolls. */
    var pane = document.getElementById('ob-outline');
    if (pane && pane.getBoundingClientRect) { var pr = pane.getBoundingClientRect(); if (e.clientY < pr.top + 48) pane.scrollTop -= 14; else if (e.clientY > pr.bottom - 48) pane.scrollTop += 14; }
    var slot = dropSlotOf(e); if (!slot) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = partDrag ? 'copy' : 'move'; } catch (err) { /* older browsers */ }
    if (slot.classList.contains('over')) return;
    Array.prototype.forEach.call(document.querySelectorAll('.ob-slot.over'), function (el) { el.classList.remove('over'); });
    slot.setAttribute('data-label', partDrag ? V.obSentence(partDrag, { where: slot.getAttribute('data-say') }) : 'Lands ' + slot.getAttribute('data-say') + ' · or move with Alt+Up / Alt+Down');
    slot.classList.add('over');
  });
  document.addEventListener('drop', function (e) {
    if (!drag && !partDrag) return;
    var slot = dropSlotOf(e), key = drag, part = partDrag; dragClear();
    if (!slot) return;
    e.preventDefault();
    if (part) { placePart(part.id, slot.getAttribute('data-ob-place')); return; }
    var d = slot.getAttribute('data-ob-drop'), m = /^before:(.+)$/.exec(d) || null, to;
    if (m) to = { before: m[1] };
    else { var parts = /^end:(.+):(-?\d+)$/.exec(d); if (!parts) return; to = { phase: parts[1], track: +parts[2], where: 'end' }; }
    var res = builderEdit({ op: 'moveTo', step: key, to: to }); if (!res) return;
    var nk = PF.outline.keyAt(openEditor(currentProcess()).text, res.at) || key;
    state.focus = '[data-act="ob-sel"][data-id="' + cssEsc(nk) + '"]'; render();
  });
  document.addEventListener('dragend', function () { if (drag || partDrag) dragClear(); tfDrag = null; });
  /* Pointing at a place while placing a part previews it in words. */
  document.addEventListener('mouseover', function (e) {
    var d = state.obPlace && e.target && e.target.closest && e.target.closest('.ob-dest'), pv = d && document.getElementById('ob-preview');
    if (pv) pv.textContent = d.getAttribute('data-say');
  });
  /* Dragging a field or evidence row in the step-type editor by its grip; Move up / Move down do the same from the keyboard. */
  var tfDrag = null;
  document.addEventListener('dragstart', function (e) {
    var row = e.target && e.target.closest && e.target.closest('[data-tf-row]'); if (!row) return;
    tfDrag = row.getAttribute('data-tf-row');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tfDrag); } catch (err) { /* older browsers */ }
  });
  document.addEventListener('dragover', function (e) {
    if (!tfDrag) return;
    var row = e.target && e.target.closest && e.target.closest('[data-tf-row]');
    if (row && row.getAttribute('data-tf-row').split(':')[0] === tfDrag.split(':')[0]) e.preventDefault();
  });
  document.addEventListener('drop', function (e) {
    if (!tfDrag) return;
    var from = tfDrag, row = e.target && e.target.closest && e.target.closest('[data-tf-row]'); tfDrag = null;
    if (!row) return;
    var to = row.getAttribute('data-tf-row'), a = from.split(':'), b = to.split(':');
    if (a[0] !== b[0] || a[1] === b[1]) return;
    e.preventDefault(); tfMoveTo(a, b[1]);
  });
  /* After a move, focus stays on the button pressed, or goes to the row once that button is disabled at the end of the list. */
  function tfMoveFocus(p, up) {
    var f = state.typeForm, list = f ? (p[0] === 'f' ? f.def.fields : f.def.record) : [], i = rowIndex(list, p[1]), j = i + (up ? -1 : 1);
    var edge = up ? j <= 0 : j >= list.length - 1;
    return edge ? '[data-act="tf-open"][data-id="' + cssEsc(p.join(':')) + '"]' : '[data-act="tf-move"][data-id="' + cssEsc(p.join(':')) + '"][data-dir="' + (up ? 'up' : 'down') + '"]';
  }
  function tfMoveTo(a, beforeKey) {
    typeChange('move', function (d) { var list = a[0] === 'f' ? d.fields : d.record, i = rowIndex(list, a[1]); if (i < 0) return null; var r = list.splice(i, 1)[0], j = rowIndex(list, beforeKey); list.splice(j < 0 ? list.length : j + (i <= j ? 1 : 0), 0, r); return r.label || r.name; }, [rowItem(a)], '[data-act="tf-open"][data-id="' + cssEsc(a.join(':')) + '"]');
  }
  /* The step-type form's inputs → its state, read in one place so typing, choosing and saving all agree. */
  function readTypeForm() {
    var f = state.typeForm; if (!f) return;
    var v = function (id) { var el = document.getElementById(id); return el ? el.value : undefined; }, c = function (id) { var el = document.getElementById(id); return el ? !!el.checked : undefined; };
    var d = f.def, S = V.typeSlugs;
    /* A box was typed in if it no longer holds what was drawn in it. Comparing with the state instead would mistake a box
       not yet redrawn (typing redraws every 250 ms) for one someone changed. */
    var typed = function (id, cur) { var el = document.getElementById(id); if (!el) return undefined; var was = el.defaultValue != null ? el.defaultValue : cur; return el.value !== was ? el.value : undefined; };
    /* The ID and each name follow the label until someone types their own; once saved, the ID never changes. */
    var id = typed('tf-id', d.id); if (!f.existing && id !== undefined) { d.id = id; d.idSet = true; }
    ['label', 'group'].forEach(function (k) { var x = v('tf-' + k); if (x !== undefined) d[k] = x; });
    var hint = v('tf-hint'); if (hint !== undefined) d.hint = hint.replace(/\s*\n\s*/g, ' ');
    T.ICONS.forEach(function (ic) { if (c('tf-icon-' + ic)) d.icon = ic; });
    if (!f.existing && !d.idSet) d.id = S.id(d.label);
    var rows = function (list, kind, flag) {
      list.forEach(function (r) {
        var p = 'tf-' + kind + '-' + r.k + '-', n = typed(p + 'name', r.name);
        if (n !== undefined) { r.name = n; r.nameSet = true; }
        ['label', 'kind'].forEach(function (k) { var x = v(p + k); if (x !== undefined) r[k] = x; });
        if (!r.nameSet) r.name = S.name(r.label);
        var q = c(p + flag); if (q !== undefined) r[flag] = q;
      });
    };
    rows(d.fields, 'f', 'required'); rows(d.record, 'r', 'long');
  }
  var typeOpens = 0;
  function typeFormFor(def, existing, baseHash) { typeOpens++; return { fsKey: fsKey(), def: def, existing: existing, baseHash: baseHash, initial: V.typeFormSnapshot(def) }; }
  function typeFormChanged(f) { return V.typeFormSnapshot(f.def) !== f.initial; }
  function saveType() {
    var f = state.typeForm; if (!f) return;
    flushAdds(f);
    var def = V.typeDefOf(f.def), errs = V.typeErrors(f.def), sent = JSON.stringify(def), savedSnap = V.typeFormSnapshot(f.def);
    if (errs.length) {
      /* Show every problem next to its box, open the rows that have one, and go to the first. */
      f.tried = true; f.leaving = false; f.closeAfterSave = false; render();
      var bad = document.querySelector && document.querySelector('#type-form [aria-invalid="true"]');
      say('Not saved yet. ' + errs.length + (errs.length === 1 ? ' thing needs' : ' things need') + ' fixing first.', 'warn');
      state.focus = bad && bad.id ? '#' + bad.id : 'tf-h'; render(); return;
    }
    if (!f.existing && (T.get(def.id) || ((data.stepTypes || {}).types || {})[def.id])) { say('There\'s already a step type {' + def.id + '}. Choose another ID, or edit that one.', 'warn'); render(); return; }
    if (f.saving) { say('Still saving this step type. Try again in a moment.', 'warn'); render(); return; }
    var sfs = state.fs, g = gen, carried = f.tl ? f.tl.entries.slice(0, f.tl.pos) : [], savedDef = JSON.parse(JSON.stringify(f.def));
    if (f.tl) TL.close(f.tl);
    f.saving = true; render();
    queued(function () { return repo.saveStepType(sfs, def, f.baseHash, { lock: LOCKS ? lock : null }); }).then(function (res) {
      f.saving = false;
      /* The form is updated in its own folder even if someone switched folders meanwhile; only the screen waits. */
      var here = g === gen, open = typeForms[f.fsKey] === f;
      if (res.conflict) { f.conflict = res; f.closeAfterSave = false; if (here) render(); return; }
      TL.saved(carried, res.hash);
      /* Saved. If the form changed while it saved, it stays open on the saved version, with those changes still unsaved. */
      if (open && V.typeFormSnapshot(f.def) !== savedSnap) {
        /* If the ID was changed while it saved, the form now describes a different, unsaved type; keep it a new one. */
        /* An ID still made from the label is the saved one now: changing the label later doesn't make it another type. */
        var sameId = !f.def.idSet || (f.def.id || '').trim() === def.id;
        if (sameId) { var keepTail = typeTail(f); f.def.id = def.id; f.justSaved = Date.now(); }
        f.existing = sameId ? def.id : null; f.baseHash = sameId ? res.hash : null; f.initial = sameId ? savedSnap : '';
        if (sameId) f.tlTail = keepTail;
        if (!here) return;
        say(sameId ? 'Saved {' + def.id + '}. Your later changes aren\'t saved yet.' : 'Saved {' + def.id + '}. The ID you changed it to isn\'t saved yet; save again to create it.', 'good');
        return load(true);
      }
      /* Saving keeps you in the editor, on the saved version, like the draft editor; Done goes back to the list. */
      if (open) {
        /* The saved ID can differ from what was typed (spaces trimmed); the history keeps what was typed, so it still applies. */
        var tail = typeTail(f);
        f.existing = def.id; f.def.id = def.id; f.tlTail = tail; f.baseHash = res.hash; f.initial = savedSnap; f.tried = false; f.idEdit = false; f.leaving = false; f.justSaved = Date.now();
        keepTypeTl(f, def.id, savedDef, res.hash);
      }
      if (!here) return;
      if (open && f.closeAfterSave) { f.closeAfterSave = false; ACTIONS['type-cancel'](); }
      say('Saved {' + def.id + '}. Checklists can use it now.', 'good');
      return load(true);
    }, function (err) { f.saving = false; if (fsKey() !== f.fsKey) return; say('Couldn\'t save the step type {' + def.id + '}: ' + err.message, 'bad'); render(); });
  }
  function mutate(fn, opts) { return mutateRun(state.runKey, gen, fn, opts); }
  /* Change one run, named by its key, in the folder generation the action started in. An action that finishes after the
     person switched folders or runs does nothing, rather than landing on whatever is on screen now. */
  function mutateRun(key, g, fn, opts) {
    opts = opts || {};
    if (g !== gen) { say('That didn\'t happen: the folder changed while it was in progress.', 'warn'); render(); return Promise.resolve(false); }
    var r = null; for (var i = 0; i < data.runs.length; i++) if (data.runs[i].process + '/' + data.runs[i].id === key) r = data.runs[i];
    if (!r) return Promise.resolve(false);
    /* A run on a version this copy can't fully read is view-only for everyone here: no recording, take over or recovery. */
    if (r._unrunnable) { say(r._unrunnable + ' This run is read-only here.', 'warn'); render(); return Promise.resolve(false); }
    var unreadWhy = opts.restoreMissing && (state.missing || {})[key] ? '' : runUnread(r);
    if (unreadWhy) { say(unreadWhy + ' The run wasn\'t changed. Choose Refresh once the file can be read.', 'warn'); render(); return Promise.resolve(false); }
    /* While a copy is being kept or restored, nothing else may change the run; the person is told to wait. */
    if (state.recovering && !opts.recovery) { say('Wait until the copy is kept, then try again.', 'warn'); render(); return Promise.resolve(false); }
    /* Recovery applies only to the exact contents it backed up: same object and same contents. */
    if (opts.expect && (r !== opts.expect || (opts.expectText && snapshot(r) !== opts.expectText))) { say('The run changed while the copy was being kept, so nothing was replaced. Compare again, then choose.', 'warn'); render(); return Promise.resolve(false); }
    var allowed = ctx.recording(r) || opts.any || (opts.recovery && ctx.canRecover(r));
    if (!allowed) { say('Only the recorder\'s window can change the run.', 'warn'); render(); return Promise.resolve(false); }
    var map = R.mapOf(r), recoveringEnded = !!(opts.recovery && r.ended);
    /* The version the folder had before this window's first unsaved change, so Discard my change can put it back even when
       the folder can't give it back (the file is gone). */
    var base = baselines[r.id];
    if (!base) baselines[r.id] = { run: clone(r) }; else if (base.run === r) base.run = clone(r);
    try {
      var now = new Date().toISOString();
      fn(r, map, state.me, now);
      /* Recovering a copy that is still running reopens the run: this window becomes its recorder, and that's logged. */
      if (recoveringEnded && !r.ended && !(r.recorder.person === state.me && r.recorder.session === SESSION)) R.takeOver(r, state.me, SESSION, now);
    }
    catch (e) {
      if (opts.fieldsFor) { state.fieldErr = { id: opts.fieldsFor, msg: e.message, field: e.field || '' }; state.focus = e.field ? '#' + e.field : '[aria-invalid="true"]'; }
      else if (!opts.background) say(e.message, 'warn');
      render(); return Promise.resolve(false);
    }
    bump(r.id);
    /* A change made in the background (a child run settling its parent) leaves whatever form is open alone. */
    /* An answer (opts.only) closes only its own step's forms; any other change closes what's open. */
    if (opts.only != null) { if (state.pick && state.pick.id === opts.only && state.runKey === key) { state.pick = null; state.fieldsDraft = null; } if (state.fieldErr && state.fieldErr.id === opts.only) state.fieldErr = null; }
    else if (!opts.background) { state.pick = null; state.edit = null; state.fieldErr = null; state.fieldsDraft = null; }
    render(); return save(r, recoveringEnded ? Object.assign({}, opts, { takeover: true }) : opts);
  }

  /* ---------- navigation ---------- */
  function openPlanForm(planning) {
    setView('start'); state.processId = planning.process; state.planId = null; state.planning = planning; state.fieldErr = null;
    state.planFormReset = true; state.focus = 'run-title'; render(); window.scrollTo(0, 0);
  }
  function home() { releaseUrls(state.urls); setView('home'); state.processId = null; state.runKey = null; resetRunUi(); }
  function resetRunUi() { state.fieldsDraft = null; state.copyView = null; state.sel = null; state.pick = null; state.edit = null; state.unfold = {}; state.pendingFiles = []; state.justPassed = null; state.msg = null; state.corrForm = null; }
  function openRun(key) {
    if (key !== state.runKey) releaseUrls(state.urls);
    setView('run'); state.runKey = key; resetRunUi();
    var r = ctx.run();
    if (r) { var nx = R.nextUp(r, R.mapOf(r), state.me); state.sel = nx.step ? nx.step.id : null; }
    state.refOpen = window.innerWidth > 800; state.revealSel = true;
    window.scrollTo(0, 0);
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    if (b.classList.contains('overlay') && e.target !== b) return;
    var act = b.dataset.act, id = b.dataset.id;
    /* Choosing something from the run's More menu closes the menu. */
    var menu = b.closest && b.closest('.rw-menu'); if (menu) { menu.open = false; (state.disc = state.disc || {})['rw-menu'] = false; }
    var handler = ACTIONS[act];
    if (!handler) return;
    e.preventDefault();
    harvest();
    handler(id, b);
  });

  var BACK = { home: 'Home', runs: 'Runs', run: 'Back to the run', processes: 'Processes', process: 'Back to the process', skills: 'Skills', skill: 'Back to the skill', types: 'Step types', settings: 'Settings', health: 'Folder health', connection: 'Connection check' };
  var ACTIONS = {
    home: function () { home(); render(); },
    /* ---------- Folder health, the connection check, When something goes wrong ---------- */
    health: function () {
      releaseUrls(state.urls); setView('health'); state.runKey = null; state.processId = null; resetRunUi();
      state.focus = 'page-h'; render(); window.scrollTo(0, 0);
      var hs = state.healthScan;
      if (!hs || hs.gen !== gen || Date.now() - Date.parse(hs.scan.at) > 300000) runHealth();
    },
    'health-again': function () { runHealth(); },
    'health-copy': function () {
      var hs = state.healthScan, rep = healthReport(true); if (!rep || !hs) return;
      copyText(PF.health.text(rep, { folder: state.fs && state.fs.name, at: U.when(hs.scan.at), app: APP_VERSION, files: hs.scan.files }), null, 'Copied. Paste it to a teammate or your AI assistant.');
    },
    'health-cmd': function (id) { copyText(PF.health.command(id), null, id === 'merge' ? 'Copied. Paste it to your AI assistant in the team folder.' : 'Copied. Run it in a terminal, with your team folder\'s path.'); },
    connection: function () {
      releaseUrls(state.urls); setView('connection'); state.runKey = null; state.processId = null; resetRunUi();
      state.focus = 'page-h'; render(); window.scrollTo(0, 0); lastConn = Date.now(); loadConn();
    },
    /* Writing a run back after its file disappeared is only ever this explicit choice, and the run's log says so. */
    'restore-missing': function () {
      var key = state.runKey, r = ctx.run(), g = gen;
      if (!r || !(state.missing || {})[key] || runBusy(r)) return;
      if (!ctx.canRecover(r)) { say(r.ended ? 'Only whoever recorded or ended this run can restore it.' : 'Only the recorder can restore this run. Take over first if they\'re gone.', 'warn'); render(); return; }
      mutateRun(key, g, function (run, map, me, now) { R.log(run, me, now, 'Restored this run\'s file to the team folder after it went missing'); }, { restoreMissing: true, any: true }).then(function (ok) {
        if (!ok || g !== gen) return;
        runOutcome(key, 'run'); say('Restored. The run\'s file is back in the team folder.', 'good'); render();
      });
    },
    'conn-send': function () { sendCheck(); },
    'conn-answer': function (id) { var p = ((state.conn || {}).probes || []).filter(function (x) { return x._file === id; })[0]; if (p) answerConn(p, false); },
    'conn-dismiss': function (id) { (state.connDismissed = state.connDismissed || {})[id] = true; render(); },
    'dismiss-conn': function () { state.connErr = null; render(); },
    'conn-name': function () {
      state.deviceName = String(val('cx-name')).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40); lsSet('device-name', state.deviceName);
      say('Saved. Checks from this browser say "' + ctx.device() + '".', 'good'); render();
    },
    recovery: function (id) {
      if (state.view !== 'recovery') state.recBack = { view: state.view, runKey: state.runKey, processId: state.processId, ptab: state.ptab, label: BACK[state.view] || 'Back' };
      setView('recovery'); state.recoveryAt = id || ''; state.focus = id ? 'rv-h-' + id : 'page-h'; render();
      var el = id && document.getElementById('rv-' + id);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
    },
    'recovery-back': function () {
      var b = state.recBack || { view: 'settings' };
      state.recBack = null; setView(b.view); state.runKey = b.runKey || null; state.processId = b.processId || null; state.ptab = b.ptab; render(); window.scrollTo(0, 0);
    },
    dismiss: function () { say(null); render(); announceRelease(); },
    refresh: function () { load(true, true); },
    connect: function () { connect(); },
    reconnect: function () { var rec = state.needsReconnect, t = ++opening; rec.dir.requestPermission({ mode: 'readwrite' }).then(function (p) { if (p === 'granted' && t === opening) { state.needsReconnect = null; useFs(folderFs(rec)); } }); },
    'reset-examples': function () { var mem = new PF.fs.MemoryFS(LS + ':examples', null), t = ++opening; seedExamples(mem).then(function () { if (t !== opening) return; home(); return useFs(mem).then(function () { if (t === opening) { say('Examples reset.', 'good'); render(); } }); }); },
    filter: function (id) { state.filter = id; render(); },
    /* Sign off the current version of a process as ready for a skill, with the run evidence it was signed on. */
    signoff: function (id) {
      var p = processes().filter(function (x) { return x.id === id; })[0], pub = p && p.latest;
      if (!pub || !state.me) return;
      var as = PF.skills.signer(pub, data.people, state.me, !!(data.failed || {}).people);
      if (!as) { say('Only the process owner, ' + V.nameOf(ctx, pub.map.meta.owner) + ', can sign off a version' + (pub.map.meta.backup ? ', or its backup owner while the owner is inactive or gone' : '') + '.', 'warn'); render(); return; }
      var ready = PF.skills.readiness(data.runs, pub, null), note = val('pick-input'), sfs = state.fs, sg = gen;
      if (!ready.enough) { say('Sign-off needs ' + ready.needed + ' clean completed runs of v' + pub.info.version + '.', 'warn'); render(); return; }
      queued(function () { return repo.recordValidation(sfs, pub, WRITER, state.me, note, { completed: ready.completed, clean: ready.clean, runs: ready.cleanRuns }, as === 'backup' ? 'backup' : null); }).then(function () {
        if (sg !== gen) return; state.pick = null; say('Signed off v' + pub.info.version + ' as ready for a skill.', 'good'); return load(true);
      }, function (e) { if (sg !== gen) return; say('Couldn\'t save the sign-off: ' + e.message, 'bad'); render(); });
    },
    /* The brief an AI assistant needs to create a skill from a signed-off version, or to update one after the process changed. */
    'copy-brief': function (id) {
      var kind = id.split(':')[0], name = id.slice(kind.length + 1), text = '';
      var withNames = function (signs) { return signs.map(function (v) { return Object.assign({}, v, { byName: V.nameOf(ctx, v.by) }); }); };
      if (kind === 'create') {
        var p = processes().filter(function (x) { return x.id === name; })[0], pub = p && p.latest;
        if (!pub) return;
        text = PF.skills.createBrief(pub, null, PF.skills.readiness(data.runs, pub, null), withNames(PF.skills.signoffs(data.validations, pub)));
      } else {
        /* Registrations are identified by their file, so two skills with the same name never get each other's brief. */
        var hit = null; processes().forEach(function (q) { q.skills.forEach(function (x) { if (x.skill.file === name) hit = x; }); });
        if (!hit || !hit.status.latest) return;
        var lp = hit.status.latest;
        text = PF.skills.updateBrief(hit.skill, hit.status, PF.skills.readiness(data.runs, lp, hit.skill.steps), withNames(PF.skills.signoffs(data.validations, lp)));
      }
      state.brief = { key: id, text: text }; render();
      copyText(text, document.getElementById('brief-pre'), 'Copied. Paste it to your AI assistant.');
    },
    'lib-tab': function (id) { state.libTab = id === 'skills' ? 'skills' : 'processes'; state.focus = '[data-act="lib-tab"][data-id="' + state.libTab + '"]'; render(); },
    /* Each list keeps its own tag filter, so a tag picked on one page never hides things on another. */
    tag: function (id) { var t = state.tags || []; state.tags = !id ? [] : t.indexOf(id) >= 0 ? t.filter(function (x) { return x !== id; }) : t.concat(id); (state.tagsBy = state.tagsBy || {})[state.view] = state.tags; state.focus = id ? '[data-act="tag"][data-id="' + cssEsc(id) + '"]' : null; render(); },
    'open-process': function (id) { setView('process'); state.processId = id; state.diffOf = null; state.ptab = 'overview'; state.mapVer = null; resetRunUi(); render(); window.scrollTo(0, 0); },
    /* ---------- the sections ---------- */
    nav: function (id) {
      typeOpens++;
      if (id === 'home') { home(); state.focus = '[data-act="nav"][data-id="home"]'; render(); window.scrollTo(0, 0); return; }
      if (['runs', 'processes', 'skills', 'types', 'settings'].indexOf(id) < 0) return;
      releaseUrls(state.urls); setView(id); state.processId = null; state.runKey = null; resetRunUi();
      /* A step-type form with changes stays for when you come back to Step types; an untouched one closes. */
      if (state.typeForm && !typeFormChanged(state.typeForm)) state.typeForm = null;
      state.focus = '[data-act="nav"][data-id="' + id + '"]'; render(); window.scrollTo(0, 0);
    },
    /* ---------- a process's map: tabs, versions, the draft editor ---------- */
    /* The process page's three views: reading the checklist, editing the draft in its place, and how runs go. Focus goes
       to where the new view starts. */
    ptab: function (id) {
      if (['overview', 'edit', 'insights'].indexOf(id) < 0) return;
      state.ptab = id; state.pick = null;
      if (id === 'edit') { var p = currentProcess(); var dw = draftUnread(p); if (dw) { state.ptab = 'overview'; say(dw + ' The draft isn\'t edited until it can be read, so nothing is saved over it. Choose Refresh.', 'warn'); render(); return; } if (p && state.draftSaving[edKey(p.id)] === 'restore') { state.ptab = 'overview'; say('Restoring the draft. You can edit it when that finishes.', 'warn'); render(); return; } if (p) openEditor(p); state.mapVer = null; }
      state.focus = id === 'edit' ? 'draft-editor' : id === 'insights' ? '[data-act="ptab"][data-id="overview"]' : 'cl-h';
      render(); window.scrollTo(0, 0);
    },
    'view-version': function (id) { state.ptab = 'overview'; state.mapVer = id; state.pick = null; state.focus = 'cl-h'; render(); window.scrollTo(0, 0); },
    'back-current': function () { state.mapVer = 'current'; state.pick = null; state.focus = 'map-ver'; render(); },
    /* Checklist or flight plan: the same version either way. A phase in the flight plan opens it in the checklist. */
    /* Checklist, Flight plan or Markdown: the same version three ways. The choice stays while you move around. */
    flight: function (id) { state.clView = id === 'plan' || id === 'md' ? id : 'list'; state.focus = '[data-act="flight"][data-id="' + state.clView + '"]'; render(); },
    'flight-phase': function (id) {
      var want = /^\d+$/.test(id) ? 'cl-ph-' + id : 'cl-h';
      state.clView = 'list'; state.focus = want;
      render();
      var el = document.getElementById(want) || document.getElementById('cl-h');
      if (!el) return;
      if (el.scrollIntoView) el.scrollIntoView({ block: 'start' });
      if (document.activeElement !== el) el.focus({ preventScroll: true });
    },
    'copy-map': function () { var pre = document.getElementById('map-source'); copyText(pre ? pre.textContent : '', pre, 'Copied.'); },
    'restore-draft': function (id, b) {
      var p = currentProcess(), v = p && p.all.filter(function (x) { return x.folder === id; })[0];
      if (!v) return;
      var expect = p.draft ? U.hash(p.draft.md) : null, sure = b && b.dataset.sure && state.pick && state.pick.kind === 'restore' && state.pick.id === id;
      /* Ask first if anything would be lost (unpublished changes, or unsaved edits), and save over exactly what was shown then. */
      if (!sure && ((p.draft && p.draftChanged) || editorDirty(p))) { state.pick = { kind: 'restore', id: id, expect: expect, dirty: editorDirty(p) }; render(); return; }
      if (sure) expect = state.pick.expect;
      state.pick = null;
      state.planFormReset = true;
      saveDraftText(p, v.md, expect, 'Restored v' + v.info.version + ' as the draft. Edit it, then publish a new version.', { replace: true, why: 'You restored v' + v.info.version + ' as the draft here. Earlier changes can\'t be undone.' });
    },
    /* Saving keeps you in the editor: focus goes back to the text, since the Save button is disabled while it saves. */
    'save-draft': function () { var p = currentProcess(); if (!p) return; var ed = openEditor(p); state.focus = 'draft-editor'; saveDraftText(p, ed.text != null ? ed.text : ed.base, ed.baseHash, 'Draft saved.'); },
    'revert-draft': function () {
      var p = currentProcess(); if (!p || stillSaving(p)) return;
      dropPending(); obClearErr();
      var old = editorOf(p.id); dropEditor(p.id); var ne = openEditor(p);
      if (old && old.tl) { ne.tl = old.tl; TL.barrier(ne.tl, 'You discarded your changes here. Earlier changes can\'t be undone.'); }
      state.planFormReset = true; state.focus = 'draft-editor'; render();
    },
    /* The draft file disappeared while it had unsaved edits: write them back as a new draft. */
    'recover-draft': function () {
      var ed = editorOf(state.processId); if (!ed || ed.text == null) return;
      saveDraftText({ id: state.processId, title: state.processId, draft: null }, ed.text, null, 'Saved your draft again.');
    },
    'draft-keep-mine': function () { var p = currentProcess(), ed = p && editorOf(p.id); if (!p || !ed || !ed.conflict) return; saveDraftText(p, ed.text != null ? ed.text : ed.base, ed.conflict.theirsHash, 'Draft saved over the other change.'); },
    'draft-take-theirs': function () { var p = currentProcess(), ed = p && editorOf(p.id); if (!ed || !ed.conflict || stillSaving(p)) return; var t = ed.conflict.theirs || ''; dropPending(); setEditor({ pid: ed.pid, fsKey: ed.fsKey, text: null, base: t, baseHash: ed.conflict.theirsHash, seen: cachedHash(ed.pid), after: readsStarted, tl: ed.tl }); if (ed.tl) TL.barrier(ed.tl, 'You took their version here. Earlier changes can\'t be undone.'); state.planFormReset = true; render(); },
    /* ---------- the outline builder: every change is an operation on the editor's text (PF.outline) ---------- */
    'ed-mode': function (id) {
      state.builder = id !== 'markdown'; lsSet('builder', state.builder); state.obPlace = null;
      var cp = currentProcess(), ce = cp && editorOf(cp.id); if (ce && ce.tl) TL.close(ce.tl);
      state.focus = '[data-act="ed-mode"][data-id="' + (state.builder ? 'builder' : 'markdown') + '"]'; render();
    },
    'ob-sel': function (id) { var p = currentProcess(); if (!p || !id) return; obClearErr(); state.insTab = null; state.obSel = { pid: p.id, kind: 'step', key: id }; state.obAdd = null; state.obAsk = null; state.planFormReset = true; state.focus = '[data-act="ob-sel"][data-id="' + cssEsc(id) + '"]'; render(); },
    'ob-sel-track': function (id, b) { var p = currentProcess(); if (!p) return; obClearErr(); state.insTab = null; var k = b && b.dataset ? +b.dataset.track : 0; state.obSel = { pid: p.id, kind: 'track', key: id, track: k }; state.obAdd = null; state.obAsk = null; state.planFormReset = true; state.focus = '[data-act="ob-sel-track"][data-id="' + cssEsc(id) + '"][data-track="' + k + '"]'; render(); },
    'ob-part': function (id) {
      var pl = state.obPlace, sheet = !!(state.overlay && state.overlay.obParts);
      if (pl && pl.part === id && !sheet) { cancelPlacing(); return; }
      /* From the phone's sheet: it closes, and the outline is where the place is chosen. */
      if (sheet) partsSheetAway();
      startPlacing(id, sheet ? 'sheet' : '');
    },
    /* The inspector's tabs; Checks and Preview are remembered in this browser. */
    'ins-tab': function (id) {
      if (['selected', 'checks', 'preview'].indexOf(id) < 0) return;
      state.insTab = id; if (id !== 'selected') { state.insTabSaved = id; lsSet('insTab', id); }
      state.focus = '#ins-t-' + id; render();
    },
    'ob-rail': function () { state.partsRail = !state.partsRail; lsSet('partsRail', state.partsRail); state.focus = '[data-act="ob-rail"]'; render(); },
    /* Done leaves the editor; edits not saved stay in it, and the process page says so. */
    'ed-done': function () {
      var p = currentProcess(); state.obPlace = null; state.obAsk = null;
      if (p && editorDirty(p)) say('Your changes aren\'t saved yet. They stay in the editor until you save or discard them.', 'warn'); else say(null);
      state.ptab = 'overview'; state.focus = '[data-act="ptab"][data-id="edit"]'; render(); window.scrollTo(0, 0);
    },
    /* An empty checklist: Step offers to add its phase too, as one change. */
    'ob-phase-with': function () {
      var pl = state.obPlace, p = currentProcess(), pt = pl && p && V.obPart(ctx, pl.part); if (!pt || pt.kind !== 'step') return;
      var res = builderEdit({ op: 'addPhase', title: 'New phase', mode: 'READ-DO', step: { text: pt.text, type: pt.type, mark: pt.mark } }, null, 'added a phase with ' + pt.noun); if (!res) return;
      var ed = openEditor(p); markFresh(ed, res.id); markFresh(ed, res.step);
      state.obPlace = null; state.obSel = { pid: p.id, kind: 'step', key: res.step }; state.obFlash = { kind: 'step', key: res.step }; state.insTab = null;
      state.focus = 'ob-text'; state.focusSelect = true; sayUndo('Added a phase with ' + pt.noun + ' in it.'); render();
    },
    'ob-place-at': function (id) { var pl = state.obPlace; if (pl) placePart(pl.part, id); },
    'ob-place-cancel': function () { cancelPlacing(); },
    'ob-part-clear': function () { state.obQ = ''; state.focus = state.overlay && state.overlay.obParts ? null : 'ob-part-q'; if (state.overlay) state.overlayFocus = '#ob-part-q2'; render(); },
    'ob-parts-open': function () { var p = currentProcess(); if (!p) return; state.overlayFocus = '#ob-part-q2'; openOverlay({ obParts: true, html: function () { return V.obPartsSheet(ctx, currentProcess() || p); } }); },
    'ob-ask': function (id) { var s = state.obSel; if (!s) return; state.obAsk = { kind: id === 'track' ? 'track' : 'phase', key: s.key, track: s.track }; state.focus = 'ob-ask-go'; render(); },
    'ob-ask-cancel': function () { state.obAsk = null; state.focus = '[data-act="ob-ask"]'; render(); },
    'ob-del-track': function (how) {
      var s = state.obSel, p = currentProcess(); if (!s || s.kind !== 'track' || !p) return;
      var ph = PF.outline.parse(edText(p)).phases.filter(function (x) { return x.key === s.key; })[0], tr = ph && ph.tracks[+s.track], name = tr && tr.title || 'untitled';
      var res = builderEdit({ op: 'deleteTrack', phase: s.key, track: s.track, steps: how === 'keep' ? 'keep' : 'all' }, null, 'deleted the ' + name + ' lane'); if (!res) return;
      state.obSel = { pid: p.id, kind: 'phase', key: state.obSel ? state.obSel.key : s.key };
      sayUndo('Deleted the ' + name + ' lane' + (!res.steps ? '' : how === 'keep' ? '; its steps moved up into the phase' : ' and its ' + res.steps + ' step' + (res.steps === 1 ? '' : 's')) + '.');
      state.focus = '[data-act="tl-undo"][data-id="draft"]'; render();
    },
    'ob-del-phase': function (id) {
      var p = currentProcess(); if (!p) return;
      var ph = PF.outline.parse(edText(p)).phases.filter(function (x) { return x.key === id; })[0], name = ph && ph.title || 'the phase';
      var res = builderEdit({ op: 'deletePhase', phase: id }, null, 'deleted ' + name); if (!res) return;
      state.obSel = null; sayUndo('Deleted ' + name + (res.steps ? ' and its ' + res.steps + ' step' + (res.steps === 1 ? '' : 's') : '') + '.'); state.focus = '[data-act="tl-undo"][data-id="draft"]'; render();
    },
    'ob-gate-remove': function (id) {
      var res = builderEdit({ op: 'removeGate', phase: id }, null, 'removed a gate'); if (!res) return;
      sayUndo('Removed the gate. The phase ends with a check that it\'s done.'); state.focus = 'ob-g-title'; render();
    },
    /* On a phone, Done closes the side form's sheet and goes back to what was selected. */
    'ob-done': function () {
      /* Typed text not yet applied is applied first; if it's refused, the sheet stays open with the reason. */
      var pf = state.obPending && state.obPendingField, pel = pf && document.getElementById(pf);
      if (pel && /^ob-(text|ph-title|tr-title|g-title|g-approves|fld-[\w-]+)$/.test(pf)) { builderField(pf, pel.value); if (state.fieldErr && state.fieldErr.id === 'ob') return; }
      var s = state.obSel; state.obSel = null; state.obAsk = null; obClearErr();
      state.focus = !s ? 'ed-h' : s.kind === 'step' ? '[data-act="ob-sel"][data-id="' + cssEsc(s.key) + '"]' : s.kind === 'track' ? '[data-act="ob-sel-track"][data-id="' + cssEsc(s.key) + '"][data-track="' + s.track + '"]' : '[data-act="ob-sel-phase"][data-id="' + cssEsc(s.key) + '"]';
      render();
    },
    'ob-sel-phase': function (id, b) { var p = currentProcess(); if (!p) return; obClearErr(); state.insTab = null; state.obSel = { pid: p.id, kind: 'phase', key: id }; state.obAdd = null; state.planFormReset = true; state.focus = b && b.dataset && b.dataset.focus ? b.dataset.focus : '[data-act="ob-sel-phase"][data-id="' + cssEsc(id) + '"]'; render(); },
    'ob-move': function (id, b) { builderMoveStep(id, b && b.dataset.dir === 'up' ? -1 : 1, b && b.dataset.from === 'key' ? 'row' : 'button'); },
    'ob-ph-move': function (id, b) {
      var up = b && b.dataset.dir === 'up', res = builderEdit({ op: 'movePhase', phase: id, dir: up ? -1 : 1 }); if (!res) return;
      var ed = openEditor(currentProcess()), nk = PF.outline.keyAt(ed.text != null ? ed.text : ed.base, res.at, 'phase') || id;
      state.focus = b && b.dataset.from === 'key' ? '[data-act="ob-sel-phase"][data-id="' + cssEsc(nk) + '"]' : '[data-act="ob-ph-move"][data-dir="' + (up ? 'up' : 'down') + '"]'; render();
    },
    'ob-role': function (id) { builderToggle('role', id); },
    'ob-bind': function (id) { builderToggle('bind', id); },
    'ob-del': function (id) {
      var p = currentProcess(), st = p && PF.outline.parse(edText(p)).steps.filter(function (x) { return x.key === id; })[0];
      var res = builderEdit({ op: 'delete', step: id }, null, 'deleted the step “' + (st ? String(st.text).slice(0, 60) : '') + '”'); if (!res) return;
      state.obSel = null; sayUndo('Deleted the step.'); state.focus = '[data-act="tl-undo"][data-id="draft"]'; render();
    },
    'ob-add': function (id, b) { var p = currentProcess(); if (!p) return; obClearErr(); sheetAway(); state.obAdd = { pid: p.id, kind: 'step', phase: id, track: b && b.dataset.track != null ? +b.dataset.track : -1 }; state.planFormReset = true; state.focus = 'ob-new-text'; render(); },
    'ob-add-after': function (id) { var p = currentProcess(); if (!p) return; obClearErr(); sheetAway(); state.obAdd = { pid: p.id, kind: 'step', after: id }; state.planFormReset = true; state.focus = 'ob-new-text'; render(); },
    'ob-add-phase': function (id) { var p = currentProcess(); if (!p) return; obClearErr(); sheetAway(); state.obAdd = { pid: p.id, kind: 'phase', after: id || null }; state.planFormReset = true; state.focus = 'ob-new-title'; render(); },
    'ob-add-cancel': function () { var a = state.obAdd; state.obAdd = null; obClearErr(); state.focus = a && a.kind === 'phase' ? '[data-act="ob-add-phase"]' : a && a.after ? '[data-act="ob-sel"][data-id="' + cssEsc(a.after) + '"]' : a ? '[data-act="ob-add"][data-id="' + cssEsc(a.phase) + '"][data-track="' + a.track + '"]' : 'ed-h'; render(); },
    'ob-add-go': function () {
      var a = state.obAdd, p = currentProcess(); if (!a || !p || a.pid !== p.id) return;
      if (a.kind === 'phase') {
        var pr = builderEdit({ op: 'addPhase', after: a.after, title: val('ob-new-title'), mode: val('ob-new-mode') || 'READ-DO' }, 'ob-new-title'); if (!pr) return;
        /* A phase needs a step: the new phase opens with its "add a step" box ready. */
        state.obSel = { pid: p.id, kind: 'phase', key: pr.id }; state.obAdd = { pid: p.id, kind: 'step', phase: pr.id, track: -1 }; state.focus = 'ob-new-text'; render(); return;
      }
      var to = a.after != null ? { after: a.after } : { phase: a.phase, track: a.track, where: 'end' };
      var res = builderEdit({ op: 'add', to: to, text: val('ob-new-text'), type: val('ob-new-type') || 'confirm' }, 'ob-new-text'); if (!res) return;
      state.obAdd = null; state.obSel = { pid: p.id, kind: 'step', key: res.id }; state.focus = 'ob-text'; render();
    },
    'ob-commit': function (id, t) { if (t && t.id) builderField(t.id, t.value); },
    /* ---------- Undo, Redo and History, the same on every editor (id: 'draft' or 'type') ---------- */
    'tl-undo': function (id) { if (id === 'draft' || id === 'type') tlMove(id, false, 'button'); },
    'tl-redo': function (id) { if (id === 'draft' || id === 'type') tlMove(id, true, 'button'); },
    'hist-open': function (id, b) { if (id === 'draft' || id === 'type') openHistory(id, b && b.dataset && b.dataset.item); },
    'hist-item': function (id) { if (!state.overlay || !state.overlay.hist) return; state.overlay.item = id || null; state.overlayFocus = '#hist-t'; render(); },
    'open-skill': function (id) { setView('skill'); state.skillFile = id; state.brief = null; resetRunUi(); state.focus = 'page-h'; render(); window.scrollTo(0, 0); },
    'new-process': function () { setView('new-process'); state.newProc = {}; resetRunUi(); render(); window.scrollTo(0, 0); },
    /* ---------- step types ---------- */
    'open-types': function () { partsSheetAway(); ACTIONS.nav('types'); },
    'new-type': function () { partsSheetAway(); setView('types'); state.typeForm = typeFormFor({ id: '', label: '', hint: '', icon: 'check', group: '', tags: '', fields: [], record: [] }, null, null); state.planFormReset = true; state.focus = 'tf-label'; render(); window.scrollTo(0, 0); },
    'copy-type': function (id) { var t = T.get(id); if (!t) return; setView('types'); state.typeForm = typeFormFor(V.typeFormOf(t, false), null, null); state.planFormReset = true; state.focus = 'tf-id'; render(); window.scrollTo(0, 0); },
    /* Edit a team type from the file as it is now: its content and its fingerprint come from the same read. */
    'edit-type': function (id) {
      /* Only the latest open request lands: one that finishes after another form was opened, or after leaving, does nothing. */
      var sfs = state.fs, g = gen, t = ++typeOpens;
      sfs.read('step-types/' + id + '.json').then(function (f) {
        /* And only on the Step types list: never over a run, a page or a form someone moved on to. */
        if (g !== gen || t !== typeOpens || state.view !== 'types' || (state.typeForm && state.typeForm.fsKey === fsKey())) return;
        var o = null; try { o = f ? JSON.parse(f.text) : null; } catch (e) { o = null; }
        var errs = o ? T.checkCustom(o) : ['it can\'t be read'];
        if (!o || errs.length) { say('step-types/' + id + '.json ' + (errs[0] || 'has a problem') + '. Fix the file, or ask your AI assistant to.', 'warn'); render(); return; }
        setView('types'); state.typeForm = resumeTypeTl(typeFormFor(V.typeFormOf(T.customType(o), true), id, U.hash(f.text)), id, U.hash(f.text)); state.planFormReset = true; state.focus = 'tf-label'; render(); window.scrollTo(0, 0);
      }, function (e) { if (g !== gen || t !== typeOpens) return; say('Couldn\'t open step-types/' + id + '.json: ' + e.message, 'bad'); render(); });
    },
    'tf-add': function (id, b) {
      var f = state.typeForm, d = f && f.def; if (!d) return; flushAdds(f);
      var kd = b && b.dataset && b.dataset.kind, kinds = id === 'f' ? ['text', 'url', 'code', 'message', 'list', 'choice'] : ['text', 'url', 'choice'];
      var before = typeSnap(f), row = { k: V.nextRowKey(), name: '', label: '', kind: kinds.indexOf(kd) >= 0 ? kd : 'text' }; (id === 'f' ? d.fields : d.record).push(row);
      f.open = id + ':' + row.k; (state.disc = state.disc || {})['tf-add-' + id] = false;
      recordTypeForm(f, before, { kind: 'form', label: id === 'f' ? 'new field' : 'new evidence', items: [(id === 'f' ? 'field:' : 'evidence:') + row.k], selBefore: { focus: '[data-act="tf-add"][data-id="' + id + '"]' }, selAfter: { focus: '#tf-' + id + '-' + row.k + '-label' } });
      state.focus = 'tf-' + id + '-' + row.k + '-label'; render();
    },
    'tf-remove': function (id) {
      var d = state.typeForm && state.typeForm.def, parts = String(id).split(':'); if (!d) return;
      flushAdds(state.typeForm);
      var list = parts[0] === 'f' ? d.fields : d.record, i = list.map(function (r) { return r.k; }).indexOf(parts[1]);
      if (i < 0) return;
      var before = typeSnap(state.typeForm), gone = list[i], what = (parts[0] === 'f' ? 'field' : 'evidence');
      if (state.typeForm.open === id) state.typeForm.open = null;
      list.splice(i, 1);
      recordTypeForm(state.typeForm, before, { kind: 'form', label: what + ' removal', subject: gone.name || '', items: [what + ':' + gone.k], selBefore: { focus: '[data-act="tf-open"][data-id="' + parts[0] + ':' + gone.k + '"]' }, show: { before: [gone.name, gone.label, gone.kind].filter(Boolean).join(' · '), after: '' } });
      say('Removed ' + what + (gone.name ? ' "' + gone.name + '"' : '') + '. Undo available.', 'good', { act: 'tl-undo', id: 'type', label: 'Undo' });
      /* Focus goes to the row that took its place, or the add button. */
      var next = list[i] || list[i - 1];
      if (state.disc) delete state.disc['tfm-' + id];
      state.focus = next ? '[data-act="tf-open"][data-id="' + parts[0] + ':' + next.k + '"]' : '[data-disc="tf-add-' + parts[0] + '"] summary';
      render();
    },
    /* ---------- the step-type editor's own controls; every change to the type goes through typeChange, so it's undoable ---------- */
    'type-done': function () {
      var f = state.typeForm; if (!f) return; flushAdds(f);
      if (typeFormChanged(f)) { f.leaving = true; state.focus = '[data-act="type-save"]'; render(); return; }
      ACTIONS['type-cancel']();
    },
    /* On a phone the preview is a sheet over the form, so the place being edited stays where it was. */
    'tf-preview': function () { state.tfPreview = !state.tfPreview; state.focus = state.tfPreview ? '.tf-prevclose' : '.tf-prevbtn'; render(); },
    'type-stay': function () { var f = state.typeForm; if (f) f.leaving = false; state.focus = 'tf-h'; render(); },
    /* Save from the leave prompt saves, then goes back to the list. */
    'type-save': function () { var f = state.typeForm; if (f && f.leaving) f.closeAfterSave = true; readTypeForm(); saveType(); },
    'tf-id-edit': function () { var f = state.typeForm; if (!f || f.existing) return; f.idEdit = true; state.focus = 'tf-id'; render(); },
    'tf-open': function (id) {
      var f = state.typeForm; if (!f) return; flushAdds(f);
      f.open = f.open === id ? null : id;
      var p = String(id).split(':');
      state.focus = f.open ? 'tf-' + p[0] + '-' + p[1] + '-label' : '[data-act="tf-open"][data-id="' + cssEsc(id) + '"]'; render();
    },
    'tf-move': function (id, b) {
      var up = b && b.dataset && b.dataset.dir === 'up', p = String(id).split(':');
      typeChange('move', function (d) { var list = p[0] === 'f' ? d.fields : d.record, i = rowIndex(list, p[1]), j = i + (up ? -1 : 1); if (i < 0 || j < 0 || j >= list.length) return null; var r = list.splice(i, 1)[0]; list.splice(j, 0, r); return r.label || r.name; }, [rowItem(p)], tfMoveFocus(p, up));
    },
    'tf-opt-add': function (id) {
      var f = state.typeForm; if (!f) return; readTypeForm();
      var p = String(id).split(':'), box = 'tf-' + p[0] + '-' + p[1] + '-optadd', v = val(box).trim();
      if (v && addOption(f, p, v) === 'dup') say('"' + v + '" is already an option.', 'warn');
      state.clearInputs = box; state.focus = '#' + box; render();
    },
    'tf-opt-del': function (id) {
      var p = String(id).split(':'), j = +p[2];
      typeChange('option removal', function (d) { var r = rowOf(d, p); if (!r) return null; var o = String(r.options || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); if (!(j >= 0 && j < o.length)) return null; var gone = o.splice(j, 1)[0]; r.options = o.join('\n'); return gone; }, [rowItem(p)], '#tf-' + p[0] + '-' + p[1] + '-optadd');
    },
    'tf-tag-add': function () {
      var f = state.typeForm; if (!f) return; readTypeForm();
      var v = cleanTag(val('tf-tagadd'));
      if (v && addTag(f, v) === 'dup') say('#' + v + ' is already a tag.', 'warn');
      state.clearInputs = 'tf-tagadd'; state.focus = '#tf-tagadd'; render();
    },
    'tf-tag-del': function (id) {
      typeChange('tag removal', function (d) { var t = String(d.tags || '').split(',').map(function (x) { return x.trim().replace(/^#/, ''); }).filter(Boolean), i = t.indexOf(id); if (i < 0) return null; t.splice(i, 1); d.tags = t.join(', '); return id; }, ['type:tags'], '#tf-tagadd');
    },
    'type-cancel': function () {
      var f = state.typeForm;
      /* Closing without saving: unsaved changes are dropped, so they can't be undone over the file when it's opened again. */
      if (f && f.existing && f.tl) { if (typeFormChanged(f)) { TL.barrier(f.tl, 'You closed it without saving here. Earlier changes can\'t be undone.'); keepTypeTl(f, f.existing, null, null); } else keepTypeTl(f, f.existing, f.def, f.baseHash); }
      state.typeForm = null; state.focus = '[data-act="new-type"]'; render(); },
    'type-keep-mine': function () { var f = state.typeForm; if (f && f.conflict && !f.saving) { f.baseHash = f.conflict.theirsHash; f.conflict = null; saveType(); } },
    'type-take-theirs': function () {
      var f = state.typeForm; if (!f || !f.conflict || f.saving) return;
      var o = null; try { o = JSON.parse(f.conflict.theirs || 'null'); } catch (e) { o = null; }
      if (!o || T.checkCustom(o).length) { say('Their version can\'t be used as a step type' + (f.conflict.theirs == null ? ' (the file was deleted)' : '') + '. Keep yours, or cancel.', 'warn'); render(); return; }
      f.def = V.typeFormOf(T.customType(o), true); f.baseHash = f.conflict.theirsHash; f.initial = V.typeFormSnapshot(f.def); f.conflict = null; state.planFormReset = true;
      if (f.tl) TL.barrier(f.tl, 'You took their version here. Earlier changes can\'t be undone.');
      render();
    },
    'open-run': function (id) { openRun(id); render(); },
    'review-plan': function (id) { var p = data.plans.filter(function (x) { return x.id === id; })[0]; if (!p) return; setView('start'); state.processId = p.process; state.planId = id; state.planning = null; state.planDiff = false; if (!state.planPick || state.planPick.plan !== id) state.planPick = null; state.fieldErr = null; render(); window.scrollTo(0, 0); },
    start: function (id) { setView('start'); state.processId = id; state.planId = null; state.planning = null; state.fieldErr = null; render(); window.scrollTo(0, 0); },
    /* Plan a run for later: the start form, saving a plan instead of starting. */
    'plan-run': function (id) { openPlanForm({ process: id, from: null }); },
    /* Duplicate a run into a plan: its details and roles, never its answers, notes or gates. Details a step sets during the run
       (sets:) are left out, since the new run produces them again. */
    'plan-from-run': function (key) {
      var r = data.runs.filter(function (x) { return x.process + '/' + x.id === key; })[0], p = r && processes().filter(function (x) { return x.id === r.process; })[0];
      if (!r || !p || !p.latest || !state.me) return;
      if (r._unrunnable) { say(r._unrunnable + ' This run is read-only here.', 'warn'); render(); return; }
      var made = Object.assign({}, M.setBy(R.mapOf(r)), M.setBy(p.latest.map)), details = {}, roles = {};
      Object.keys(r.details || {}).forEach(function (f) { if (!Object.prototype.hasOwnProperty.call(made, f) && r.details[f]) details[f] = String(r.details[f]); });
      Object.keys(r.roles || {}).forEach(function (ro) { if (r.roles[ro]) roles[ro] = r.roles[ro]; });
      /* "Release · Fri, Oct 16" (the default run name) becomes "Release"; any other name is kept as it is. */
      var dated = ' · ' + U.day(r.created), title = r.title.length > dated.length && r.title.slice(-dated.length) === dated ? r.title.slice(0, -dated.length) : r.title;
      openPlanForm({ process: r.process, from: key, title: title, details: details, roles: roles });
    },
    'cancel-plan': function () {
      var from = state.planning && state.planning.from, pid = state.processId;
      state.planning = null; state.fieldErr = null;
      if (from && ctx.findRun(from)) { openRun(from); render(); return; }
      state.focus = '[data-act="plan-run"]'; ACTIONS['open-process'](pid);
    },
    'plan-diff': function () { state.planDiff = !state.planDiff; state.focus = '[data-act="plan-diff"]'; render(); },
    /* The one way a plan moves off the version it was planned on: the person chooses the latest. */
    'plan-latest': function (id) {
      var plan = data.plans.filter(function (x) { return x.id === id; })[0], p = plan && processes().filter(function (x) { return x.id === plan.process; })[0];
      if (!p || !p.latest) return;
      /* The exact version shown, never "whatever is latest": a newer one published later asks again. */
      state.planPick = { key: fsKey(), plan: id, hash: plan._hash, folder: p.latest.info.folder };
      state.planDiff = false; state.focus = 'start-submit'; say(null); render();
    },
    'decline-plan': function (id) { var p = data.plans.filter(function (x) { return x.id === id; })[0], g = gen; if (!p) return; repo.recordPlanStatus(state.fs, p, WRITER, 'declined', null, state.me).then(function () { if (g !== gen) return; home(); say('Plan declined. It stays in the folder for reference.'); return load(true); }, function (e) { if (g === gen) { say('Couldn\'t decline it: ' + e.message, 'bad'); render(); } }); },
    diff: function (id) { state.diffOf = state.diffOf === id ? null : id; render(); },
    publish: function (id) {
      var p = processes().filter(function (x) { return x.id === id; })[0], note = (document.getElementById('change-note') || {}).value || '';
      if (!p || !p.draft || stillSaving(p)) return;
      /* Publish exactly the draft that was shown: it is read again from the folder in the queue (after any save ahead of it),
         and if it differs, the newer draft is shown instead of being published unseen. */
      var shown = p.draft.md, draftPath = 'maps/drafts/' + p.draft.file;
      /* Everything the publication is checked against comes from this folder now, before the queue waits on anything. */
      var pfs = state.fs, pg = gen, by = state.me, people = data.people, wfs = data.jira.workflows, pids = processes().filter(function (x) { return x.latest; }).map(function (x) { return x.id; });
      queued(function () {
        /* Step types too are read again here, after any save of one ahead in the queue, so a version never freezes a
           type's earlier rules; publishing re-checks the checklist against them. */
        return Promise.all([pfs.read(draftPath), repo.loadStepTypes(pfs)]).then(function (got) {
          var f = got[0];
          if (!f || f.text !== shown) return { changed: true };
          return repo.publish(pfs, f.text, { people: people, customTypes: got[1].types, workflows: wfs, processes: pids, by: by, changes: note, existing: p.taken, now: new Date().toISOString() });
        });
      }).then(function (res) {
        if (pg !== gen) return;
        if (res.changed) { say('The draft changed since this page was drawn, so nothing was published. Here is the newest draft: check it, then publish.', 'warn'); return load(true); }
        if (res.blockers) { say(res.blockers[0], 'warn'); render(); return; }
        state.clearInputs = 'change-note'; say('Published v' + res.version + '. New runs use it; runs already started keep their version.', 'good');
        return load(true);
      }, function (e) { if (pg !== gen) return; say('Couldn\'t publish: ' + e.message, 'bad'); render(); });
    },
    /* The check on a row, Done in the inspector, Space and X: one step, one path (answerStep). A done step unchecks. */
    toggle: function (id) {
      var r = ctx.run(), a = r && r.steps[id];
      if (!r || !M.findStep(R.mapOf(r), id)) return;
      if (a && a.s === 'done') { mutate(function (r, map, me, now) { R.clear(r, map, id, me, now); }); return; }
      answerStep(state.runKey, id, { how: 'done' });
    },
    'save-fields': function (id) {
      var r = ctx.run(), x = M.findStep(R.mapOf(r), id), t = T.get(x.step.type, r.types), fields = {}, values = {};
      T.editable(t).forEach(function (f) { var el = document.getElementById('fld-' + f); if (el) fields[f] = el.value; });
      /* Evidence is collected and checked against the fields as they'll be after this save, not as they were. */
      var merged = Object.assign({}, R.fieldsOf(r, x.step), fields);
      R.evidenceFor(r, x.step, merged).list.forEach(function (d) { var el = document.getElementById('rec-' + d.name); if (el) values[d.name] = el.value; });
      var chk = R.checkEvidence(r, x.step, merged, values, true);
      if (chk.error) { state.fieldErr = { id: id, msg: chk.error, field: chk.field ? 'rec-' + chk.field : '' }; state.focus = chk.field ? '#rec-' + chk.field : '[aria-invalid="true"]'; render(); return; }
      /* The draft is dropped only once the values are in the run, and only the evidence this form saved: evidence typed for
         an action no longer chosen stays a draft. */
      var key = state.runKey;
      state.fieldErr = null;
      mutate(function (r, map, me, now) {
        R.setFields(r, map, id, fields, values, me, now);
        var d = draftOf(key, id, false), keep = {};
        if (d) Object.keys(d.record).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(values, k.slice(4))) keep[k] = d.record[k]; });
        dropDraft(key, id, ['record', 'fields', 'open']);
        if (Object.keys(keep).length) draftOf(key, id, true).record = keep;
      }, { fieldsFor: id });
    },
    record: function (id) { answerStep(state.runKey, id, { how: 'done' }); },
    pause: function () { var why = val('pick-input'); if (!why.trim()) { say('Say why the run is paused, so others know what it\'s waiting for.', 'warn'); render(); return; } state.pick = null; mutate(function (r, map, me, now) { R.pause(r, why, me, now); }); },
    resume: function () { mutate(function (r, map, me, now) { R.resume(r, me, now); }); },
    'start-child': function (id) { startChild(id); },
    /* A child run that was saved but whose link didn't land (the parent changed meanwhile): link it now, with the inputs it was started for. */
    'link-child': function (id, b) {
      var c = ctx.findRun(b.dataset.child);
      if (!c || !c.parent) return;
      mutate(function (r, map, me, now) { R.linkChild(r, map, id, { process: c.process, id: c.id, inputs: c.parent.inputs }, me, now); });
    },
    timeline: function (id) { state.timeline = !state.timeline; state.overlayFocus = null; state.focus = '[data-act="timeline"]' + (id ? '[data-id="' + cssEsc(id) + '"]' : ''); render(); },
    'start-step': function (id) { mutate(function (r, map, me, now) { R.start(r, map, id, me, now); }); },
    na: function (id) { mutate(function (r, map, me, now) { R.na(r, map, id, me, now); }); },
    clear: function (id) { mutate(function (r, map, me, now) { R.clear(r, map, id, me, now); }); },
    pick: function (id, b) {
      /* While Done differently is finishing on a step, Fill in waits: the answer landing would close it. */
      var ans = state.answering;
      if (b.dataset.kind === 'fields' && ans && ans.key === state.runKey && ans.step === id) { say('Finishing the answer… Fill in opens once it\'s saved.', 'warn'); render(); return; }
      state.pick = { kind: b.dataset.kind, id: id, back: '[data-act="pick"][data-kind="' + cssEsc(b.dataset.kind || '') + '"][data-id="' + cssEsc(id || '') + '"]' }; state.fieldsDraft = null; if (b.dataset.kind === 'block' || b.dataset.kind === 'differently' || b.dataset.kind === 'deadline' || b.dataset.kind === 'fields') state.sel = id; render(); },
    unpick: function () { var pk = state.pick; state.pick = null; state.fieldErr = null; state.fieldsDraft = null; if (pk && pk.kind === 'fields') dropDraft(state.runKey, pk.id, ['fields', 'open']); if (pk && pk.back) state.focus = pk.back; render(); },
    block: function (id, b) { var reason = b.dataset.reason || val('pick-input'); if (!reason.trim()) return; mutate(function (r, map, me, now) { R.block(r, map, id, reason, me, now); }); },
    differently: function (id) { var note = val('pick-input'); if (!note.trim()) return; mutate(function (r, map, me, now) { R.differently(r, map, id, note, me, now); }); },
    deadline: function (id) {
      var iso = U.timeToday(val('pick-input'));
      if (!iso) { say('Type the time the tool shows, like 21:30 or 9:30 PM.', 'warn'); render(); return; }
      if (new Date(iso) < Date.now() - 12 * 3600000) iso = new Date(new Date(iso).getTime() + 86400000).toISOString();
      mutate(function (r, map, me, now) { R.setDeadline(r, map, id, iso, me, now); });
    },
    pass: function (pi) { mutate(function (r, map, me, now) { R.pass(r, map, +pi, me, now); state.justPassed = map.phases[+pi].gate.id; var nxt = map.phases[+pi + 1]; if (nxt) state.focus = 'ph-' + nxt.id; }); },
    waive: function (pi) { var why = val('pick-input'); mutate(function (r, map, me, now) { R.waive(r, map, +pi, why, me, now); }); },
    fail: function (pi) { var why = val('pick-input') || 'Failed'; mutate(function (r, map, me, now) { R.fail(r, map, +pi, why, me, now); }); },
    reopen: function (pi) { mutate(function (r, map, me, now) { R.reopen(r, map, +pi, me, now); }); },
    edit: function (id) { state.edit = id; render(); },
    unedit: function () { state.edit = null; render(); },
    'save-edit': function () {
      var e = state.edit, v = val('edit-input');
      if (!e) return;
      mutate(function (r, map, me, now) {
        if (e.indexOf('detail:') === 0) { var n = R.setDetail(r, map, e.slice(7), v, me, now); if (n) say(n + ' step' + (n === 1 ? ' needs' : 's need') + ' a re-check because ' + e.slice(7) + ' changed. Gates that approved the old value need review.', 'warn'); }
        else R.setRole(r, map, e.slice(5), v, me, now);
      });
    },
    handoff: function () { var to = val('handoff-to'); if (!to) return; mutate(function (r, map, me, now) { R.handOff(r, to, me, now); }); },
    /* Picking up or taking over starts from the newest copy in the folder, never from what this screen showed earlier. */
    pickup: function () { if (runBusy(ctx.run())) return; fresh().then(function (t) { if (t) mutateRun(t.key, t.g, function (r, map, me, now) { R.pickUp(r, me, SESSION, now); }, { any: true }); }); },
    takeover: function () { if (runBusy(ctx.run())) return; fresh().then(function (t) { if (t) mutateRun(t.key, t.g, function (r, map, me, now) { R.takeOver(r, me, SESSION, now); }, { any: true, takeover: true }); }); },
    /* The receipt opens only once the ending is really in the team folder; a failed save keeps you here with Try again. */
    end: function (id) { var g = gen, key = state.runKey; mutate(function (r, map, me, now) { R.end(r, map, id, me, V.nameOf(ctx, me), now); }).then(function (ok) { if (ok && g === gen && state.runKey === key && ctx.run() && ctx.run().ended) { setView('receipt'); render(); window.scrollTo(0, 0); } }); },
    /* Finishing: outcome, follow-ups and suggested map changes, then the receipt. */
    finish: function () { setView('finish'); state.pick = null; render(); window.scrollTo(0, 0); },
    'add-followup': function (id, b) {
      var text = b && b.dataset.text != null ? b.dataset.text : val('fu-text'), owner = b && b.dataset.text != null ? '' : val('fu-owner'), ticket = b && b.dataset.text != null ? '' : val('fu-ticket');
      if (!String(text).trim()) { state.fieldErr = { id: 'followup', msg: 'Say what needs doing.' }; render(); return; }
      state.fieldErr = null; state.clearInputs = 'fu-text';
      mutate(function (r, map, me, now) { R.addFollowUp(r, { text: text, owner: owner, ticket: ticket, step: b && b.dataset.step || '', from: b && b.dataset.from || '' }, me, now); });
    },
    'remove-followup': function (id) { mutate(function (r, map, me, now) { R.removeFollowUp(r, id, me, now); }); },
    /* Recovery: conflict copies sit next to run.json until someone keeps or deletes them. */
    'compare-copy': function (name) {
      var r = ctx.run(), g = gen, key = state.runKey; if (!r) return;
      repo.readCopy(state.fs, r, name).then(function (c) {
        if (g !== gen || state.runKey !== key) return;
        state.copyView = { name: name, key: key, lines: c ? R.compare(ctx.run(), c, R.mapOf(ctx.run()), function (id) { return V.nameOf(ctx, id); }) : null }; render();
      }, function (e) { if (g === gen) { say(e.message, 'bad'); render(); } });
    },
    /* Keep a conflict copy: the version it replaces is saved next to the run first, the copy becomes current, and only after that
       save succeeds is the copy file removed. */
    /* Keep a conflict copy. The exact current version is backed up first; if a refresh brings a newer one meanwhile, nothing
       is changed and the person is asked to compare again. Refreshes pause while this runs; the save is checked against the
       backed-up version's fingerprint, so a change on disk turns into a conflict copy rather than being overwritten. */
    /* Keep a conflict copy. Pending saves finish first, then the run is locked: the exact current contents are backed up, the
       copy replaces them only if nothing changed since, and other changes are refused until it's done. The save is checked
       against the backed-up version's fingerprint, so a change on disk becomes a conflict copy rather than being overwritten. */
    'use-copy': function (name) { if (runBusy(ctx.run())) return; recover(function (fs, cur) { return repo.readCopy(fs, cur, name); }, 'The version it replaced is kept as ', function (fs, cur) { return repo.removeCopy(fs, Object.assign({}, cur, { _conflicts: null }), name); }); },
    'delete-copy': function (name) {
      var r = ctx.run(); if (!r) return;
      if (!(state.pick && state.pick.kind === 'delete-copy' && state.pick.id === name)) { state.pick = { kind: 'delete-copy', id: name }; render(); return; }
      var g = gen, key = state.runKey;
      repo.removeCopy(state.fs, r, name).then(function () { if (g !== gen) return; if (state.runKey === key) { if (state.pick && state.pick.kind === 'delete-copy' && state.pick.id === name) state.pick = null; if (state.copyView && state.copyView.name === name) state.copyView = null; } say('Conflict copy deleted.', 'good'); return refreshRun(); }, function (e) { if (g === gen) { say('Couldn\'t delete it: ' + e.message, 'bad'); render(); } });
    },
    'restore-local': function () {
      var r = ctx.run(); if (!r || runBusy(r)) return;
      var lkey = localKey(r.id), local = lsGet(lkey, null); if (!local) return;
      recover(function () { var c = R.sanitize(local); if (c) c._overflow = local._overflow || []; return Promise.resolve(c); }, 'Restored the copy kept in this browser; the version it replaced is kept as ', function () { lsSet(lkey, null); return Promise.resolve(); });
    },
    'discard-local': function () { var r = ctx.run(); if (r) { lsSet(localKey(r.id), null); say('The copy kept in this browser was discarded.'); render(); } },
    'load-history': function () {
      var r = ctx.run(), g = gen, key = state.runKey; if (!r) return;
      repo.loadHistory(state.fs, r).then(function (h) { if (g !== gen) return; state.archive[key] = h; render(); }, function (e) { if (g === gen) { say('Couldn\'t read the history: ' + e.message, 'bad'); render(); } });
    },
    'whats-new': function () {
      state.relShownSeen = relSeen(); state.rel = { q: '', kind: '', area: '', sel: 0, detail: false };
      lsSet('seen-release', APP_VERSION); lsSet('toasted-release', APP_VERSION);
      if (state.msg && state.msg.act === 'whats-new') state.msg = null;
      openOverlay({ html: function () { return V.releases(ctx); }, onClose: function () { state.relShownSeen = null; } });
      var q = document.getElementById('rel-search'); if (q) q.focus();
    },
    'rel-kind': function (id) { state.rel.kind = state.rel.kind === id ? '' : id; render(); },
    'rel-sel': function (id) { state.rel.sel = +id; state.rel.detail = true; state.overlayFocus = '#rel-detail-title'; render(); },
    'rel-back': function () { state.rel.detail = false; state.overlayFocus = '.rn-item[aria-current="true"]'; render(); },
    'rel-clear': function () { state.rel.q = ''; state.rel.kind = ''; state.rel.area = ''; state.overlayFocus = '#rel-detail-title'; render(); },
    /* Appearance is per browser: system follows the computer; light and dark set data-theme, which the colors key off. */
    theme: function (id, b) { if (['system', 'light', 'dark'].indexOf(id) < 0) return; state.theme = id; lsSet('theme', id); applyTheme(); state.focus = b && b.classList && b.classList.contains('icon-btn') ? '.icon-btn[data-act="theme"]' : '[data-act="theme"][data-id="' + id + '"]'; render(); },
    'toggle-keys': function () { state.keys = !state.keys; lsSet('keys', state.keys); render(); },
    'start-mode': function (id, b) { state.startMode[b.dataset.process] = id; render(); },
    'show-roles': function () { state.showRoles = !state.showRoles; render(); },
    'new-folder': function () { ACTIONS['setup-mode']('start'); },
    /* ---------- Getting started ---------- */
    'setup-mode': function (id) {
      if (id === 'examples') { state.lookAround = true; lsSet('look-around', true); state.setup = null; home(); state.focus = 'page-h'; render(); window.scrollTo(0, 0); return; }
      if (id === 'welcome') { state.setup = null; state.lookAround = false; lsSet('look-around', false); state.fieldErr = null; home(); state.focus = 'page-h'; render(); window.scrollTo(0, 0); return; }
      if ((id !== 'start' && id !== 'join') || !canFolder) return;
      setView('setup'); state.runKey = null; state.processId = null; resetRunUi(); state.fieldErr = null;
      setupState(id); state.focus = 'su-h'; render(); window.scrollTo(0, 0);
    },
    /* Home's Continue (and Settings): the start flow at that step, in the team folder that's open. */
    'setup-continue': function (id) {
      var su = setupState('start', id); su.created = true; lsSet('setup-hidden:' + fsKey(), false);
      setView('setup'); state.runKey = null; state.processId = null; resetRunUi();
      if (id === 'second') setupAppCheck();
      state.focus = 'su-h'; render(); window.scrollTo(0, 0);
    },
    'setup-step': function (id) {
      var su = state.setup; if (!su || PF.setup.STEPS.every(function (x) { return x.id !== id; })) return;
      if (su.created && (id === 'folder' || id === 'people')) { su.step = 'checklist'; } else su.step = id;
      if (su.step === 'second') setupAppCheck();
      state.fieldErr = null; state.focus = 'su-h'; render(); window.scrollTo(0, 0);
    },
    'setup-next': function (id) { ACTIONS['setup-step'](id); },
    'setup-pick': function () { setupPick(); },
    'setup-join-dir': function () { var su = state.setup, d = su && su.joinDir; if (!d) return; su.mode = 'join'; su.step = 'open'; su.err = null; setupOpen(d); },
    'setup-add-row': function () { var su = state.setup; if (!su || su.team.length >= 30) return; su.kn++; su.team.push({ k: 't' + su.kn, name: '', email: '' }); state.focus = 'su-name-t' + su.kn; render(); },
    'setup-del-row': function (id) {
      var su = state.setup; if (!su) return;
      var i = su.team.map(function (x) { return x.k; }).indexOf(id); if (i < 0) return;
      su.team.splice(i, 1); if (su.backup === id) su.backup = '';
      if (!su.team.length) { su.kn++; su.team.push({ k: 't' + su.kn, name: '', email: '' }); }
      state.focus = '[data-act="setup-add-row"]'; render();
    },
    'setup-tpl': function (id) { var su = state.setup; if (!su) return; su.tpl = id; state.focus = '[data-act="setup-tpl"][data-id="' + id + '"]'; render(); },
    'setup-publish': function (id) { setupChecklist(id, false); },
    'setup-edit': function (id) { setupChecklist(id, true); },
    'setup-run': function (id) { var p = processes().filter(function (x) { return x.id === id; })[0]; if (!p || !p.latest) return; state.startMode[id] = 'solo'; ACTIONS.start(id); },
    'setup-app-check': function () { setupAppCheck(); },
    'setup-copy': function (id) {
      var pre = document.getElementById({ prompt: 'su-prompt', invite: 'su-invite', request: 'su-request' }[id] || '');
      if (!pre) return;
      copyText(pre.textContent, pre, id === 'request' ? 'Copied. Send it to them by chat or email.' : id === 'invite' ? 'Copied. Send it by chat or email.' : 'Copied. Paste it to your AI assistant.');
    },
    'setup-open': function () { setupOpen(null); },
    'setup-who': function (id) {
      var p = data.people.filter(function (x) { return x.id === id && !x.inactive; })[0]; if (!p) return;
      state.me = id; lsSet('me', id); state.setup = null; home();
      say('Welcome, ' + p.name.split(' ')[0] + '. Home shows what needs you; Runs and Processes have the rest.', 'good'); state.focus = 'page-h'; render(); window.scrollTo(0, 0);
    },
    'setup-hide': function () { lsSet('setup-hidden:' + fsKey(), true); state.focus = 'page-h'; render(); },
    'setup-finish': function () { home(); state.setup = null; state.focus = 'page-h'; render(); window.scrollTo(0, 0); },
    /* ---------- Settings, People (the folder owner and backup owner) ---------- */
    'people-active': function (id, b) {
      var on = !!(b && b.dataset && b.dataset.on);
      changePeople(on ? 'active' : 'inactive', id, function (doc) { return PF.people.setActive(doc, id, on, state.me); }, function (p) { say(p.name + (on ? ' is active again.' : ' is marked inactive. Their name stays on everything they did.'), 'good'); });
    },
    'people-backup': function (id) { changePeople('backup', id, function (doc) { return PF.people.setRole(doc, id, 'backup'); }, function (p) { say(p.name + ' is the backup owner now.', 'good'); }); },
    'people-owner': function (id) { changePeople('owner', id, function (doc) { return PF.people.setRole(doc, id, 'owner'); }, function (p) { say(p.name + ' is the folder owner now.', 'good'); }); },
    'people-err-dismiss': function () { state.peopleErr = null; render(); },
    /* Choosing a step shows it in the inspector (on a phone, as a sheet). Previous and Next in the inspector keep focus there
       and bring the step's row into view in the checklist. */
    select: function (id, b) {
      var r = ctx.run(), x = r && M.findStep(R.mapOf(r), id); if (!x) return;
      state.unfold[x.phase.id] = true;
      selectStep(id); state.refOpen = true;
      if (b && b.dataset && b.dataset.nav) state.focus = 'ins-h';
      render(); if (b && b.dataset && b.dataset.nav) reveal('#step-' + cssEsc(id));
    },
    'close-ref': function () { state.refOpen = false; render(); },
    unfold: function (id) { state.unfold[id] = true; state.focus = '[data-act="fold"][data-id="' + cssEsc(id) + '"]'; render(); },
    fold: function (id) { state.unfold[id] = false; state.focus = '[data-act="unfold"][data-id="' + cssEsc(id) + '"]'; render(); },
    /* Going to a step selects it and opens what's folded around it; a phase lands on its heading; a gate on its main button. */
    goto: function (id) {
      var r = ctx.run(), map = r && R.mapOf(r), m = /^(step|gate|phase)-(.+)$/.exec(id || ''), x = m && m[1] === 'step' && map ? M.findStep(map, m[2]) : null;
      if (x) { selectStep(x.step.id); state.refOpen = true; state.unfold[x.phase.id] = true; }
      if (!document.getElementById(id) && map && !x) map.phases.forEach(function (p) { state.unfold[p.id] = true; });
      render();
      var el = document.getElementById(id); if (!el) return;
      if (el.scrollIntoView) el.scrollIntoView({ block: m && m[1] === 'phase' ? 'start' : 'center' });
      var f = !m ? el : m[1] === 'step' ? el.querySelector('.check:not([disabled])') || el.querySelector('.s-pick') : m[1] === 'phase' ? el.querySelector('h2') : el.querySelector('.btn.go') || el.querySelector('button:not([disabled])');
      if (f && f.focus) f.focus({ preventScroll: true });
    },
    'run-details': function () { state.runDetails = !state.runDetails; state.focus = state.runDetails ? 'rw-det-h' : narrow() ? '.rw-menu > summary' : '.rw-tools > [data-act="run-details"]'; render(); },
    'run-fu': function (id) { state.fuOpen = !state.fuOpen; state.focus = '[data-act="run-fu"][data-id="' + cssEsc(id || 'rail') + '"]'; render(); },
    help: function () { openOverlay({ html: function () { return V.help(ctx); } }); },
    /* A quick way between the checklist and the selected step, for keyboards and screen readers. */
    'to-ins': function () { state.refOpen = true; state.focus = 'ins-h'; render(); },
    'to-row': function (id) { if (narrow()) state.refOpen = false; state.focus = '[data-act="select"][data-id="' + cssEsc(id) + '"]'; render(); },
    'retry-save': function () { var cur = ctx.run(), r = cur && state.unsaved[cur.id], g = gen, key = state.runKey; if (r) save(r, (state.saveOpts || {})[r.id]).then(function (ok) { if (ok && g === gen && state.runKey === key && r.ended && state.view === 'finish') { setView('receipt'); render(); } }); },
    'discard-unsaved': function () {
      var r = ctx.run(); if (!r || runBusy(r)) return;
      /* Put back the last version this window saved or read, at once: a run whose file is gone can't be reread to undo it. */
      var base = baselines[r.id];
      if (base) { for (var i = 0; i < data.runs.length; i++) if (data.runs[i].id === r.id) data.runs[i] = base.run; bump(r.id); }
      delete state.unsaved[r.id]; delete state.saveErr[r.id]; if (state.saveOpts) delete state.saveOpts[r.id]; say('Your unsaved change was discarded.'); load(true);
    },
    /* ---------- corrections: recorded in runs, decided on the process page (docs/design.md section 19) ---------- */
    /* Correct this step (anyone who has said who they are; it doesn't answer the step) or Done differently (the recorder; it
       answers the step). Correcting starts on the wording, filled in with what the step says now. */
    'corr-open': function (id, b) {
      var r = ctx.run(); if (!r || !state.me) return;
      var map = R.mapOf(r), x = M.findStep(map, id); if (!x) return;
      var mode = b && b.dataset.mode === 'differently' ? 'differently' : 'correct', open = state.corrForm;
      /* Choosing an open composer's button again only brings focus back to it; what's typed stays. */
      if (open && open.key === state.runKey && open.step === id && open.mode === mode) { selectStep(id); state.refOpen = true; state.focus = mode === 'differently' ? 'corr-happened' : corrFocus(open.op); render(); return; }
      /* Done differently is an answer: only the recorder, while the run isn't paused and the step's phase is open. */
      if (mode === 'differently' && !(ctx.recording(r) && !r.paused && R.phaseOpen(r, map, x.phaseIndex))) return;
      var op = b && PF.corrections.OPS.indexOf(b.dataset.op) >= 0 ? b.dataset.op : 'wording';
      state.corrForm = { key: state.runKey, step: id, mode: mode, op: op, scope: 'just', to: x.step.text, text: '', where: 'after', moveTo: '', roles: x.step.roles.slice(), shot: b && b.dataset.shot || '', why: '', happened: '', menu: false };
      selectStep(id); state.refOpen = true; state.fieldErr = null;
      state.focus = mode === 'differently' ? 'corr-happened' : corrFocus(op); state.focusEnd = true; render();
    },
    'partial-dismiss': function (id) { delete state.partial[id]; render(); },
    'goto-corr': function (id) { var el = document.getElementById(id); if (!el) return; if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); if (el.focus) el.focus(); },
    'corr-menu': function () { var f = state.corrForm; if (!f) return; f.menu = !f.menu; state.focus = f.menu ? '.corr-menu-list button' : '[data-act="corr-menu"]'; render(); },
    'corr-op': function (id) {
      var f = state.corrForm; if (!f || PF.corrections.OPS.indexOf(id) < 0) return;
      f.op = id; f.menu = false; state.fieldErr = null; if (f.mode === 'differently') f.scope = 'fix';
      state.focus = corrFocus(id); state.focusEnd = true; render();
    },
    'corr-scope': function (id) { var f = state.corrForm; if (!f) return; f.scope = id === 'fix' ? 'fix' : 'just'; state.fieldErr = null; state.focus = '[data-act="corr-scope"][data-id="' + f.scope + '"]'; render(); },
    'corr-cancel': function () { var f = state.corrForm; state.corrForm = null; state.fieldErr = null; if (f) state.focus = '[data-act="corr-open"][data-id="' + cssEsc(f.step) + '"][data-mode="' + f.mode + '"]'; render(); },
    'corr-save': function () { saveCorrection(false); },
    'corr-done': function () { saveCorrection(true); },
    /* Deciding on a group of corrections: anyone; declining needs a reason; withdrawing is for whoever suggested it. */
    'corr-applied': function (id) { decideCorr(id, 'applied', '', 'Marked as applied to the draft.'); },
    'corr-decline': function (id) { decideCorr(id, 'declined', val('pick-input'), 'Declined. The runs show why.'); },
    'corr-reopen': function (id) { decideCorr(id, 'open', '', 'Reopened.'); },
    'corr-withdraw': function (id, b) { decideCorr(id, 'withdrawn', '', 'Withdrawn.', b && b.dataset.process); },
    /* Applying a correction to the draft: the comparison dialog and what it offers in each state. */
    'corr-review': function (id) {
      var p = currentProcess(); if (!p || !state.me) return;
      state.overlayFocus = '#ca-t';
      openOverlay({ corrApply: true, pid: p.id, gid: id, edit: null, combine: null, declining: false, err: null, html: function () { return V.corrApply(ctx, this); } });
    },
    'corr-apply': function (id, b) { var ov = caOv(); if (ov && ov.gid === id && !ov.busy) applyCorr(ov, b && b.dataset.how === 'edit' ? 'edit' : ''); },
    'corr-edit': function (id) {
      var ov = caOv(); if (!ov || ov.gid !== id) return;
      var x = caFind(ov.pid, ov.gid), g = x.g; if (!g) return;
      var rv = PF.corrections.review(g, caBase(x.p));
      ov.edit = { text: g.change.op === 'wording' ? (rv.result ? rv.result.text : g.change.to) : g.change.op === 'add' ? g.change.text : null }; ov.err = null;
      state.overlayFocus = ov.edit.text != null ? '#ca-edit' : '#ca-t'; render();
    },
    'corr-combine': function (id) {
      var ov = caOv(); if (!ov || ov.gid !== id) return;
      var x = caFind(ov.pid, ov.gid), g = x.g; if (!g) return;
      ov.combine = PF.corrections.alternatives(x.all, g).map(function (y) { return y.id; }); ov.edit = { text: g.change.to }; ov.err = null;
      state.overlayFocus = '#ca-edit'; render();
    },
    'corr-edit-cancel': function () { var ov = caOv(); if (!ov) return; ov.edit = null; ov.combine = null; ov.err = null; state.overlayFocus = '#ca-t'; render(); },
    'corr-link': function (id) {
      var ov = caOv(); if (!ov || ov.gid !== id || ov.busy) return;
      var x = caFind(ov.pid, ov.gid); if (!x.g) return;
      var base = caBase(x.p), rv = PF.corrections.review(x.g, base);
      if (rv.state !== 'already') { caErr(ov, 'The draft changed since this was shown. Look at the comparison again.'); return; }
      caDecide(ov, 'applied', '', 'Linked: the draft already has this correction.', PF.corrections.outcome(x.g, base, rv.result ? rv.result.id : ''));
    },
    'corr-addressed': function (id) {
      var ov = caOv(); if (!ov || ov.gid !== id || ov.busy) return;
      var x = caFind(ov.pid, ov.gid); if (!x.g) return;
      caDecide(ov, 'applied', '', 'Marked as applied to the draft.', PF.corrections.applies(x.g) ? PF.corrections.outcome(x.g, caBase(x.p)) : null);
    },
    'corr-ca-declining': function () { var ov = caOv(); if (!ov) return; ov.declining = true; ov.err = null; state.overlayFocus = '#ca-reason'; render(); },
    'corr-ca-cancel': function () { var ov = caOv(); if (!ov) return; ov.declining = false; ov.err = null; state.overlayFocus = '#ca-t'; render(); },
    'corr-ca-decline': function () { var ov = caOv(); if (!ov || ov.busy) return; caDecide(ov, 'declined', val('ca-reason'), 'Declined. The runs show why.'); },
    'corr-open-editor': function (id) {
      var ov = caOv(), pid = ov ? ov.pid : state.processId, gid = ov ? ov.gid : id;
      if (ov) closeOverlay();
      var x = caFind(pid, gid); if (!x.p || !x.g) return;
      ACTIONS.ptab('edit'); if (state.ptab !== 'edit') return;
      var ed = editorOf(x.p.id), o = PF.outline.parse(ed ? (ed.text != null ? ed.text : ed.base) : ''), s = x.g.target.step && o.steps.filter(function (y) { return y.id === x.g.target.step; })[0];
      if (!s) return;
      if (state.builder && !o.unsupported) { ACTIONS['ob-sel'](s.key); return; }
      ACTIONS['corr-goto-line'](String(s.line + 1));
    },
    /* The Markdown's Open corrections list: select the step's first line and bring it into view. */
    'corr-goto-line': function (id) {
      var ta = document.getElementById('draft-editor'), n = +id; if (!ta || !(n >= 1)) return;
      var lines = ta.value.split('\n'), start = 0;
      for (var i = 0; i < n - 1 && i < lines.length; i++) start += lines[i].length + 1;
      ta.focus(); ta.setSelectionRange(start, start + (lines[n - 1] || '').length);
      var lh = parseFloat(window.getComputedStyle ? getComputedStyle(ta).lineHeight : '') || 20; ta.scrollTop = Math.max(0, (n - 4) * lh);
    },
    'corr-filter': function (id) { state.fixFilter = id === 'all' ? 'all' : 'open'; state.focus = '[data-act="corr-filter"][data-id="' + state.fixFilter + '"]'; render(); },
    'copy-corr-brief': function (id) {
      var p = processes().filter(function (x) { return x.id === id; })[0]; if (!p) return;
      /* The brief quotes the steps as the draft has them now, since that's the file the assistant edits. */
      var map = p.draft ? M.parse(p.draft.md) : p.latest ? p.latest.map : null;
      var text = PF.corrections.brief({ id: p.id, title: p.title }, ctx.corrections(p.id), { map: map, draftFile: p.draft ? p.draft.file : null, version: p.latest && p.latest.info.version, nameOf: function (x) { return V.nameOf(ctx, x); } });
      state.brief = { key: 'corrections:' + p.id, text: text }; render();
      copyText(text, document.getElementById('brief-pre'), 'Copied. Paste it to your AI assistant.');
    },
    'zoom-corr': function (id, b) { var c = corrById(id); if (c) openLightbox(imagesOf(c), +b.dataset.i); },
    'add-note': function (id) {
      var r = ctx.run(), text = val('note-text').trim(), nkey = state.runKey, mine = attachmentsFor(nkey, id), files = mine;
      var who = state.me, nfs = state.fs, ng = gen;
      if (!r || !who || (!text && !files.length)) return;
      /* A note that's too long is refused, not cut short; the draft stays so it can be shortened or split. */
      if (text.length > NOTE_MAX) { state.fieldErr = { id: 'note:' + id, msg: 'Notes can be up to 2,000 characters; this one is ' + text.length.toLocaleString('en-US') + '. Shorten it, or split it into two notes.', field: 'note-text' }; state.focus = '#note-text'; render(); return; }
      state.fieldErr = null;
      var endBusy = busyStart();
      queued(function () {
        return saveFiles(nfs, r, files).then(function (saved) {
          var note = { id: U.randomId(10), at: new Date().toISOString(), by: who, session: WRITER, step: id, text: text, files: saved.paths, fileInfo: saved.info };
          return repo.addNote(nfs, r, WRITER, note);
        });
      }).then(function () {
        endBusy(); if (ng !== gen) return;
        /* Only the submitted note's draft is cleared: another step's draft and attachments stay. */
        state.pendingFiles = state.pendingFiles.filter(function (p) { return mine.indexOf(p) < 0; });
        /* The box is cleared only if it still holds exactly what was sent, on the same run and step; anything typed since stays. */
        if (state.runKey === nkey && state.sel === id && val('note-text').trim() === text) state.clearInputs = 'note-text';
        var nd = draftOf(nkey, id, false); if (nd && String(nd.note).trim() === text) dropDraft(nkey, id, ['note']);
        /* Said where it was added, beside the box, for a moment. */
        if (state.attErr && state.attErr.key === 'note:' + id) state.attErr = null;
        var ack = state.noteAck = { key: nkey, step: id }; setTimeout(function () { if (state.noteAck === ack) { state.noteAck = null; scheduleRender(); } }, 4000);
        if (state.runKey === nkey) { say('Note added to "' + noteStepText(id) + '".', 'good'); state.msg.quiet = true; }
        return refreshRun();
      }, function (e) { endBusy(); if (ng !== gen) return; say('Couldn\'t add the note: ' + e.message, 'bad'); render(); });
    },
    'just-me': function () { app.querySelectorAll('#start-form [data-role], #plan-form [data-role]').forEach(function (el) { el.value = state.me; }); },
    /* The Copy button itself says Copied for a moment, and it's announced once. */
    copy: function (id, b) {
      var text = b.dataset.text, g = gen;
      if (!(navigator.clipboard && navigator.clipboard.writeText)) { copyText(text, null); return; }
      navigator.clipboard.writeText(text).then(function () {
        if (g !== gen) return;
        var mark = state.copied = text; say('Copied.', 'good'); state.msg.quiet = true; render();
        setTimeout(function () { if (state.copied === mark) { state.copied = null; scheduleRender(); } }, 1600);
      }, function () { if (g === gen) { say('Couldn\'t copy. Select the text and press Ctrl+C.', 'warn'); render(); } });
    },
    mission: function () { if (state.view === 'run') savePanes(); setView('mission'); render(); window.scrollTo(0, 0); },
    receipt: function () { setView('receipt'); render(); window.scrollTo(0, 0); },
    'exit-mission': function () { setView('run'); render(); },
    'copy-receipt': function () { var pre = document.getElementById('receipt-text'); copyText(pre ? pre.textContent : '', pre); },
    zoom: function (id, b) { var r = ctx.run(), x = r && M.findStep(R.mapOf(r), id); if (!x) return; openLightbox(x.step.shots.map(function (s) { return { src: s.src, caption: s.caption }; }), +b.dataset.i); },
    'zoom-note': function (id, b) { var r = ctx.run(), n = r && (r._notes || []).filter(function (x) { return x.id === id; })[0]; if (!n) return; openLightbox(imagesOf(n), +b.dataset.i); },
    'att-remove': function (id) { var p = state.pendingFiles.filter(function (x) { return x.id === id; })[0]; if (!p) return; state.pendingFiles = state.pendingFiles.filter(function (x) { return x !== p; }); state.attErr = null; state.focus = /^corr:/.test(p.step) ? 'corr-why' : 'note-text'; render(); },
    /* A text attachment opens as plain text in a dialog; anything else saves a copy. Only files of the note or suggestion named are read. */
    'att-open': function (id, b) {
      var it = attOwner(id, b), path = b && b.dataset.path, g = gen, key = state.runKey, view = state.view, pid = state.processId; if (!it || !path) return;
      var name = PF.attach.nameOf(path, (it.fileInfo || {})[path]);
      /* A slow read that finishes after the person moved to another run or page opens nothing. */
      var still = function () { return g === gen && state.view === view && (view === 'process' ? state.processId === pid : state.runKey === key); };
      state.fs.blob(path).then(function (blob) {
        if (!still()) return;
        if (!blob) { say('"' + name + '" isn\'t in the folder yet. OneDrive may still be syncing it.', 'warn'); render(); return; }
        var cut = blob.size > PF.attach.PREVIEW_MAX;
        return blob.slice(0, PF.attach.PREVIEW_MAX).text().then(function (text) {
          if (!still()) return;
          openOverlay({ text: text, html: function () { return V.textPreview(name, path, cut, blob.size, id, b.dataset.from); } });
        });
      }, function (e) { if (g === gen) { say('Couldn\'t open "' + name + '": ' + e.message, 'bad'); render(); } });
    },
    'att-save': function (id, b) {
      var it = attOwner(id, b), path = b && b.dataset.path, g = gen; if (!it || !path) return;
      var name = PF.attach.nameOf(path, (it.fileInfo || {})[path]);
      state.fs.blob(path).then(function (blob) {
        if (g !== gen) return;
        if (!blob) { say('"' + name + '" isn\'t in the folder yet. OneDrive may still be syncing it.', 'warn'); render(); return; }
        /* Saved as plain bytes, so the browser never opens it as a page. */
        var url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' })), a = document.createElement('a');
        a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      }, function (e) { if (g === gen) { say('Couldn\'t save "' + name + '": ' + e.message, 'bad'); render(); } });
    },
    'lb-step': function (d) { if (state.overlay && state.overlay.list) { var L = state.overlay.list.length; state.overlay.i = (state.overlay.i + (+d) + L) % L; render(); } },
    'close-overlay': function () { closeOverlay(); }
  };
  /* Reread the open run before taking over recording. Resolves to the run's key and generation, or null if the folder changed. */
  /* A correction by ID, from the open run's notes or, on a process page, from the process's corrections. */
  function corrById(id) {
    if (state.view === 'process') { var p = currentProcess(), hit = null; if (p) ctx.corrections(p.id).forEach(function (g) { g.members.forEach(function (c) { if (c.id === id) hit = c; }); }); return hit; }
    var r = ctx.run(); return r && (r._notes || []).filter(function (n) { return n.id === id && (n.kind === 'correction' || n.kind === 'fix' || n.kind === 'map'); })[0];
  }
  function corrFocus(op) { return { wording: 'corr-to', add: 'corr-text', move: 'corr-move', roles: 'corr-roles', screenshot: 'corr-why', remove: 'corr-why', describe: 'corr-why' }[op] || 'corr-to'; }
  /* Saves a correction (a note in this window's own notes file, with its files), or answers the step done differently and,
     with "Fix the checklist too", saves the correction first: if the note can't be written nothing changes; if the run's
     save fails afterwards, the correction stands on its own. Done differently follows every rule of Done. */
  function saveCorrection(answer) {
    var r = ctx.run(), f = state.corrForm; if (!r || !f || !state.me || f.key !== state.runKey || f.sending) return;
    var map = R.mapOf(r), x = M.findStep(map, f.step); if (!x) return;
    readCorrForm(f);
    var withNote = !answer || f.scope === 'fix', mine = attachmentsFor(f.key, 'corr:' + f.step), note = null;
    function bad(e, field) { state.fieldErr = { id: 'corr', msg: e.message || e, field: field || e.field || '' }; state.focus = '#' + (field || e.field || 'corr-to'); render(); }
    if (answer) {
      if (!(ctx.recording(r) && !r.paused && R.phaseOpen(r, map, x.phaseIndex))) return;
      if (!f.happened.trim()) { bad('Say what happened.', 'corr-happened'); return; }
      /* The same rules as Done, checked before the correction is written: an open Fill in is saved or canceled first, and
         required evidence typed on this step goes with the answer. */
      var c = answerCheck(state.runKey, f.step);
      if (!c.r) { if (c.fill) bad(c.why, 'fill-in'); else state.fieldErr = { id: f.step, msg: c.why, field: c.field }; state.focus = c.focus; render(); return; }
    }
    if (withNote) {
      try { note = PF.corrections.build({ id: U.randomId(10), at: new Date().toISOString(), by: state.me, session: WRITER, map: map, step: f.step, op: f.op, to: f.to, text: f.text, where: f.where, moveTo: f.moveTo, roles: f.roles, shot: f.shot, why: f.why, happened: answer ? f.happened : '', version: +r.version || 0, folder: r.folder, files: mine.map(function () { return 'pending'; }) }); }
      catch (e) { bad(e); return; }
    }
    state.fieldErr = null;
    var nfs = state.fs, ng = gen, key = state.runKey, step = f.step, endBusy = busyStart(); f.sending = true; say('Saving…', ''); state.msg.quiet = true;
    if (answer) state.answering = { key: key, step: step };
    render();
    var settled = function () { if (state.answering && state.answering.key === key && state.answering.step === step) state.answering = null; };
    var wrote = withNote ? queued(function () { return saveFiles(nfs, r, mine).then(function (saved) { note.files = saved.paths; note.fileInfo = saved.info; return repo.addNote(nfs, r, WRITER, note); }); }) : Promise.resolve();
    wrote.then(function () {
      endBusy(); f.sending = false; if (ng !== gen) { settled(); return; }
      state.pendingFiles = state.pendingFiles.filter(function (p) { return mine.indexOf(p) < 0; });
      if (state.corrForm === f) { state.corrForm = null; state.fieldErr = null; }
      var then = answer ? function () {
        /* The answer is made on the run that started it, whatever this window shows now, through the one answer path. */
        var here = state.view === 'run' && state.runKey === key;
        return answerStep(key, step, { how: 'differently', happened: f.happened, at: note ? note.at : null, quiet: !here }).then(function (ok) {
          settled();
          if (ok) { delete state.partial[key]; if (state.view === 'run' && state.runKey === key) { say('Done differently' + (withNote ? ', with a correction for the checklist. Saved on this computer.' : '. Saved on this computer.'), 'good'); state.msg.quiet = true; } render(); return; }
          /* It isn't answered in the folder (the run was paused or handed off, its phase closed, its Fill in is open, or the save
             was refused or failed): the run says so until someone acts. A message already shown (a conflict, a warning) stays;
             an answer still on screen waiting for Try again is said as that. */
          if (withNote) state.partial[key] = { step: step };
          var rk = ctx.findRun(key), pa = rk && rk.steps[step], waiting = !!(pa && pa.s === 'done' && pa.differently && state.unsaved[rk.id]);
          if (state.runKey === key && !(state.msg && (state.msg.kind === 'warn' || state.msg.kind === 'bad'))) say(waiting ? 'Done differently isn\'t saved yet. Try again, or discard it, from the bar above.' : withNote ? 'Correction saved; the step wasn\'t marked done.' : 'The step wasn\'t marked done.', 'warn');
          render();
        });
      } : function () { say('Correction saved on this computer. It doesn\'t answer the step.', 'good'); state.msg.quiet = true; state.focus = '[data-act="corr-open"][data-id="' + cssEsc(step) + '"][data-mode="correct"]'; return Promise.resolve(); };
      return then().then(function () { return withNote && state.runKey === key ? refreshRun() : null; }).then(function () { render(); });
    }, function (e) { endBusy(); f.sending = false; settled(); if (ng !== gen) return; say('Couldn\'t save. Try again. ' + e.message, 'bad'); render(); });
  }
  /* The composer's boxes are read into its state as they change, so a redraw (or the live redline) never loses them. */
  function readCorrForm(f) {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : null; };
    ['to', 'text', 'why', 'happened'].forEach(function (k) { var v = g('corr-' + k); if (v != null) f[k] = v; });
    var mv = g('corr-move'); if (mv != null) f.moveTo = mv;
  }
  /* Anyone on the team decides on a group of corrections; the decision is a new file written once, following the decision
     this window shows. */
  function decideCorr(id, status, reason, done, pid) {
    var p = pid ? processes().filter(function (x) { return x.id === pid; })[0] : currentProcess(), g = p && ctx.corrections(p.id).filter(function (x) { return x.id === id; })[0];
    if (!g || !state.me) return;
    var rec;
    try { rec = PF.corrections.decision(g, state.me, status, reason, new Date().toISOString(), { current: g.decision, act: U.randomId(10) }); }
    catch (e) { if (status === 'declined') { state.fieldErr = { id: 'corr-decline', msg: e.message }; state.focus = 'pick-input'; } else say(e.message, 'warn'); render(); return; }
    var dfs = state.fs, gg = gen;
    queued(function () { return repo.decideCorrection(dfs, rec, WRITER); }).then(function () {
      if (gg !== gen) return; state.pick = null; state.fieldErr = null; if (state.view === 'process') state.focus = 'fx-h'; say(done, 'good'); return load(true);
    }, function (e) { if (gg !== gen) return; say('Couldn\'t save the decision: ' + e.message, 'bad'); render(); });
  }
  /* The shared path for keeping a conflict copy or restoring a browser copy. */
  function recover(getCopy, logPrefix, cleanup) {
    var r = ctx.run(), fs = state.fs, g = gen; if (!r || state.recovering) return;
    var key = r.process + '/' + r.id, cur = r, text = null;
    var endBusy = busyStart();
    state.recovering = key; render();
    function done() { endBusy(); if (g === gen) { state.recovering = null; render(); } }
    return queued(function () { return getCopy(fs, cur); }).then(function (c) {
      if (g !== gen) return;
      if (!c) { say('That copy can\'t be read.', 'bad'); return; }
      /* Keeping it would save only what this copy understands of it, erasing the rest. */
      if (c._unrunnable) { say(c._unrunnable + ' That copy can only be read here, so it wasn\'t kept.', 'warn'); return; }
      text = snapshot(cur);
      return repo.keepDisplaced(fs, cur, WRITER).then(function (where) {
        if (g !== gen) return false;
        return mutateRun(key, g, function (run, map, me, now) {
          var extra = c._overflow || [];
          R.adopt(run, c, me, now);
          if (extra.length) run._overflow = (run._overflow || []).concat(extra);
          R.log(run, me, now, logPrefix + where.split('/').pop());
        }, { recovery: true, expect: cur, expectText: text });
      }).then(function (ok) {
        if (!ok || g !== gen) return;
        state.copyView = null;
        return cleanup(fs, cur).then(function () { if (g === gen) return refreshRun(); }, function (e) { if (g === gen) say('Kept the copy, but couldn\'t remove it: ' + e.message, 'warn'); });
      });
    }).catch(function (e) { if (g === gen) say('Couldn\'t keep that copy: ' + e.message, 'bad'); }).then(done);
  }
  function fresh() {
    var r = ctx.run(), g = gen, fs = state.fs, at = startRead(), bad = []; if (!r) return Promise.resolve(null);
    var key = r.process + '/' + r.id;
    return repo.loadRun(fs, r.process, r.id, null, false, false, bad).then(function (f) {
      if (g !== gen) return null;
      var res = f ? { kind: 'run', run: f } : bad.length ? { kind: 'unread', why: bad[0].why } : r._fileHash ? { kind: 'missing' } : null;
      if (res && applyRunRead(key, at, res) && f) { for (var i = 0; i < data.runs.length; i++) if (data.runs[i].process + '/' + data.runs[i].id === key) data.runs[i] = f; }
      return { key: key, g: g };
    });
  }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  /* The opener is remembered by what it is (its id or action), not as a node, because redraws replace nodes. */
  function selectorOf(el) {
    if (!el || el === document.body) return null;
    if (el.id) return '#' + cssEsc(el.id);
    return el.dataset && el.dataset.act ? '[data-act="' + el.dataset.act + '"]' + (el.dataset.id ? '[data-id="' + cssEsc(el.dataset.id) + '"]' : '') : null;
  }
  function openOverlay(o) { o.back = selectorOf(document.activeElement); state.overlay = o; render(); }
  /* Closing returns focus to whatever opened it and releases full-size images. */
  function closeOverlay() {
    var back = state.overlay && state.overlay.back, done = state.overlay && state.overlay.onClose; state.overlay = null; if (done) done(); releaseUrls(state.full); render();
    var el = back && document.querySelector(back); if (el) el.focus();
  }
  function openLightbox(list, i) { openOverlay({ list: list, i: i || 0, html: function () { return V.lightbox(ctx, this.list, this.i); } }); }
  function copyText(text, pre, done) {
    var msg = document.getElementById('copy-msg');
    function fallback() { if (pre) { pre.hidden = false; var rg = document.createRange(); rg.selectNodeContents(pre); var s = window.getSelection(); s.removeAllRanges(); s.addRange(rg); } if (msg) msg.textContent = 'Selected. Press Ctrl+C.'; }
    var g = gen, view = state.view, key = state.runKey;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { if (g !== gen || state.view !== view || state.runKey !== key) return; if (msg && document.contains(msg)) msg.textContent = done || 'Copied. Paste it into the Jira ticket.'; else { say('Copied.', 'good'); render(); } }, function () { if (g === gen && state.view === view && state.runKey === key) fallback(); });
    else fallback();
  }

  /* New process and step-type forms. */
  document.addEventListener('submit', function (e) {
    if (e.target.id === 'type-form') { e.preventDefault(); readTypeForm(); saveType(); return; }
    if (e.target.id !== 'new-process-form') return;
    e.preventDefault();
    var f = { id: val('np-id').trim().toLowerCase(), title: val('np-title').trim(), group: val('np-group').trim(), tags: val('np-tags').trim(), context: val('np-context').trim(), roles: val('np-roles').trim(), owner: val('np-owner'), solo: !!(document.getElementById('np-solo') || {}).checked };
    state.newProc = f;
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(f.id)) { say('The process ID is lowercase letters, numbers and dashes, like release or code-review.', 'warn'); state.focus = 'np-id'; render(); return; }
    if (!f.title) { say('Give the process a title.', 'warn'); state.focus = 'np-title'; render(); return; }
    if (processes().some(function (x) { return x.id === f.id; })) { say('There\'s already a process called "' + f.id + '". Choose another ID, or open that one.', 'warn'); state.focus = 'np-id'; render(); return; }
    var md = V.starterMap(f), sfs = state.fs, g = gen;
    queued(function () { return repo.saveDraft(sfs, f.id + '.md', md, null, { lock: LOCKS ? lock : null }); }).then(function (res) {
      if (g !== gen) return;
      if (res.conflict) { say('A draft for "' + f.id + '" appeared in the folder meanwhile. Open it from Processes.', 'warn'); render(); return; }
      /* Open the new draft only if the person is still on the form they submitted; otherwise say where it is. */
      return load(true).then(function () { if (g !== gen) return; if (state.view !== 'new-process' || state.newProc !== f) { say('Created the draft for "' + f.title + '". Open it from Processes.', 'good'); render(); return; } setView('process'); state.processId = f.id; state.ptab = 'edit'; dropEditor(f.id); var np = currentProcess(); if (np) openEditor(np); state.newProc = null; say('Draft created. Fill in the steps, choose Done, then publish it.', 'good'); state.focus = 'draft-editor'; render(); window.scrollTo(0, 0); });
    }, function (err) { if (g !== gen) return; say('Couldn\'t create the draft: ' + err.message, 'bad'); render(); });
  });
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'start-form') return;
    e.preventDefault();
    var p = processes().filter(function (x) { return x.id === e.target.dataset.process; })[0];
    if (!p || !p.latest || !state.me) return;
    var details = {}, roles = {};
    e.target.querySelectorAll('[data-detail]').forEach(function (el) { details[el.dataset.detail] = el.value; });
    e.target.querySelectorAll('[data-role]').forEach(function (el) { roles[el.dataset.role] = el.value; });
    var plan = state.planId && data.plans.filter(function (x) { return x.id === state.planId; })[0];
    /* Start exactly what was reviewed: the same published version and, for a plan, the same plan content. Only a plan can start
       an older version (the one it was planned on), and only until the person switches to the latest. */
    var pub = plan ? PF.publish.forPlan(p, plan.version, V.planChoice(ctx, plan)).pub : p.latest;
    if (e.target.dataset.folder !== pub.info.folder) { say(plan ? 'The version this plan starts on changed while you were filling this in. Check the form, then start again.' : 'A new version was published while you were filling this in. Check the form, then start again.', 'warn'); render(); return; }
    if (val('start-mode') === 'solo') pub.map.meta.roles.forEach(function (ro) { roles[ro] = state.me; });
    /* Decisions on the plan started to disagree after this form was drawn: show the warning before anything starts. */
    if (plan && plan._conflicting && e.target.dataset.planConflict !== '1') { say('Someone decided on this plan while you were filling this in, and the decisions disagree. Check Runs, then start again if it still needs to run.', 'warn'); render(); return; }
    if (plan && e.target.dataset.planHash !== plan._hash) { say('Someone changed this plan while you were reviewing it. The form now shows the new plan; check it, then start again.', 'warn'); state.planFormReset = true; render(); return; }
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (err) { tz = ''; }
    /* R.create refuses a version this copy can't fully read; verified versions never get here, but the refusal is shown. */
    var r; try { r = R.create(pub, { title: val('run-title') || p.title, details: details, roles: roles, by: state.me, session: SESSION, now: new Date().toISOString(), tz: tz, workflows: data.jira.workflows }); }
    catch (err) { say(err.message, 'warn'); render(); return; }
    var endBusy = busyStart();
    var sfs = state.fs, sg = gen, who = state.me;
    /* The write queue waits for this window's identity check, so the recorder is set to the confirmed identity. */
    queued(function () { r.recorder.session = SESSION; return repo.saveRun(sfs, r, SESSION, { writer: WRITER, lock: LOCKS ? lock : null }); }).then(function () {
      return plan ? repo.recordPlanStatus(sfs, plan, WRITER, 'accepted', r.id, who) : null;
    }).then(function () { endBusy(); if (sg !== gen) return; state.planId = null; state.planPick = null; state.planDiff = false; return load(true); }).then(function () { if (sg !== gen) return; openRun(r.process + '/' + r.id); say(R.solo(r) ? 'Run started.' : 'Run started. You\'re recording.', 'good'); render(); },
      function (err) { endBusy(); if (sg !== gen) return; say('Couldn\'t start the run: ' + err.message, 'bad'); render(); });
  });

  /* Getting started's people, and Settings' Add a person. */
  document.addEventListener('submit', function (e) {
    if (e.target.id === 'setup-people-form') { e.preventDefault(); createTeam(); return; }
    if (e.target.id !== 'people-add-form') return;
    e.preventDefault();
    var P = PF.people, add = state.peopleAdd || { name: val('pa-name'), email: val('pa-email') };
    state.fieldErr = null;
    try { P.checkName(add.name); } catch (err) { state.fieldErr = { id: 'setup', field: 'pa-name', msg: err.message }; state.focus = 'pa-name'; render(); return; }
    try { P.checkEmail(add.email); } catch (err) { state.fieldErr = { id: 'setup', field: 'pa-email', msg: err.message }; state.focus = 'pa-email'; render(); return; }
    changePeople('add', null, function (doc) { return P.add(doc, add.name, add.email); }, function (p) { state.peopleAdd = null; state.focus = 'pa-name'; say('Added ' + p.name + ' as ' + p.id + '. They choose their name when they open the folder.', 'good'); });
  });
  /* Save a plan: a new file, never a replacement for one that's there. */
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'plan-form') return;
    e.preventDefault();
    var p = processes().filter(function (x) { return x.id === e.target.dataset.process; })[0], planning = state.planning;
    if (!p || !p.latest || !state.me || !planning || planning.process !== p.id) return;
    var pub = p.latest, details = {}, roles = {};
    if (e.target.dataset.folder !== pub.info.folder) { say('A new version was published while you were filling this in. Check the form, then save again.', 'warn'); render(); return; }
    e.target.querySelectorAll('[data-detail]').forEach(function (el) { var v = el.value.trim(); if (v) details[el.dataset.detail] = v.slice(0, 120); });
    e.target.querySelectorAll('[data-role]').forEach(function (el) { if (el.value) roles[el.dataset.role] = el.value; });
    if (val('start-mode') === 'solo') pub.map.meta.roles.forEach(function (ro) { roles[ro] = state.me; });
    var whenText = val('plan-when').trim(), parsed = whenText ? U.localDateTime(whenText) : null, when = parsed && parsed.date;
    if (parsed && parsed.error) { state.fieldErr = { id: 'plan-when', msg: parsed.error === 'gap' ? 'That time doesn\'t exist on that day (clocks change); pick another.' : 'Enter a date and time, or leave it blank.' }; state.focus = 'plan-when'; render(); return; }
    state.fieldErr = null;
    var plan = { kind: 'plan', id: 'plan-' + p.id + '-' + U.randomId(8), process: p.id, version: pub.info.version, title: (val('run-title').trim() || pub.map.meta.title || p.title).slice(0, 100), details: details, roles: roles };
    if (when) plan.when = when.toISOString();
    var note = val('plan-note').trim();
    if (note) plan.note = note.slice(0, 300);
    if (planning.from) plan.from = planning.from;
    plan.by = state.me; plan.created = new Date().toISOString();
    /* One save of a plan form at a time: a second click while it saves would write the same plan twice. */
    if (planning.saving) { say('Still saving this plan.', 'warn'); render(); return; }
    planning.saving = true;
    var sfs = state.fs, g = gen, endBusy = busyStart();
    queued(function () { return repo.savePlan(sfs, plan, { lock: LOCKS ? lock : null }); }).then(function (res) {
      endBusy(); planning.saving = false; if (g !== gen) return;
      if (res.conflict) { say(res.afterWrite ? 'Something else wrote the same plan file just now. Check Runs before planning it again.' : 'A plan with the same name is already in the folder, so nothing was saved. Save again.', 'warn'); render(); return; }
      return load(true).then(function () {
        if (g !== gen) return;
        if (state.planning === planning && state.view === 'start') { state.planning = null; setView('runs'); state.processId = null; state.focus = 'card-' + plan.id; window.scrollTo(0, 0); }
        say('Planned ' + plan.title + '.', 'good'); render();
      });
    }, function (err) { endBusy(); planning.saving = false; if (g !== gen) return; say('Couldn\'t save the plan: ' + err.message, 'bad'); render(); });
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'rel-search') { state.rel.q = e.target.value; render(); }
    if (e.target.id === 'ca-edit' && caOv() && caOv().edit) { caOv().edit.text = e.target.value; caOv().err = null; }
    /* The correction composer keeps what's typed in its state, so the Before/After redline follows the wording as it changes. */
    if (/^corr-(to|text|why|happened)$/.test(e.target.id || '') && state.corrForm) { state.corrForm[e.target.id.slice(5)] = e.target.value; if (state.fieldErr && state.fieldErr.id === 'corr') state.fieldErr = null; render(); }
    /* The draft editor checks and previews as you type (redrawn at most every 250 ms; the editor itself is never replaced). */
    if (e.target.id === 'draft-editor') {
      var p = currentProcess(); if (!p) return;
      var ed = openEditor(p), next = e.target.value, prev = ed.text != null ? ed.text : ed.base;
      if (!imeStep(e, 'draft-editor', prev)) { var was = ime ? true : false, from = imeBefore('draft-editor', prev); recordTyping(ed, from, next, e.inputType); if (from !== prev || was) TL.close(tlOf(ed)); }
      ed.text = next; scheduleRender();
    }
    if (/^tf-/.test(e.target.id || '') && state.typeForm) { typeFormInput(e, true); scheduleRender(); }
    /* Text typed into the builder's form counts as unsaved at once, before it's applied on leaving the box or Enter. */
    if (/^ob-(text|ph-title|tr-title|g-title|g-approves|fld-[\w-]+|new-text|new-title)$/.test(e.target.id || '') && state.processId) {
      /* Pending only while the box differs from what the draft says (or, for a new item, holds anything). */
      var differs = norm(e.target.value) !== norm(fieldApplied(e.target.id)), was = !!state.obPending;
      if (differs) { state.obPending = state.processId; state.obPendingField = e.target.id; } else if (state.obPendingField === e.target.id) dropPending();
      if (was !== !!state.obPending) scheduleRender();
    }
    if (e.target.id === 'ob-part-q' || e.target.id === 'ob-part-q2') { state.obQ = String(e.target.value || '').slice(0, 60); render(); }
    /* Getting started's forms keep what's typed in their state, so ID previews and the request follow the names. */
    var su = state.setup, sm = /^su-(me|name|email|rq)-?(name|email|t\d+)?$/.exec(e.target.id || '');
    if (su && sm) {
      var v = String(e.target.value || '');
      if (sm[1] === 'me') su.me[sm[2]] = v;
      else if (sm[1] === 'rq') (su.request = su.request || {})[sm[2]] = v;
      else su.team.forEach(function (x) { if (x.k === sm[2]) x[sm[1]] = v; });
      if (state.fieldErr && state.fieldErr.id === 'setup' && state.fieldErr.field === e.target.id) state.fieldErr = null;
      render();
    }
    if (e.target.id === 'pa-name' || e.target.id === 'pa-email') { (state.peopleAdd = state.peopleAdd || { name: '', email: '' })[e.target.id.slice(3)] = String(e.target.value || ''); if (state.fieldErr && state.fieldErr.field === e.target.id) state.fieldErr = null; render(); }
  });
  /* The browser's own Undo and Redo (the Edit menu, a context menu) in the draft editor and step-type form go to the timeline,
     so there is one history, never two that disagree. Leaving the editor ends the typing unit. */
  document.addEventListener('beforeinput', function (e) {
    if ((e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') || composing) return;
    var id = (e.target && e.target.id) || '', scope = id === 'draft-editor' ? 'draft' : /^tf-/.test(id) && !/add$/.test(id) && state.typeForm ? 'type' : null;
    if (!scope) return;
    e.preventDefault(); tlMove(scope, e.inputType === 'historyRedo', 'key');
  });
  document.addEventListener('focusout', function (e) {
    var id = (e.target && e.target.id) || '', p, ed;
    if (id === 'draft-editor' && (p = currentProcess()) && (ed = editorOf(p.id)) && ed.tl) TL.close(ed.tl);
    if (/^tf-/.test(id) && state.typeForm && state.typeForm.tl) TL.close(state.typeForm.tl);
    /* Leaving an Add box adds what it holds. */
    if ((id === 'tf-tagadd' || /^tf-[fr]-k\d+-optadd$/.test(id)) && state.typeForm && flushAdds(state.typeForm)) render();
  });
  /* Folded groups and opened or closed details (a brief, a list of deviations) stay as the person left them across redraws. */
  document.addEventListener('toggle', function (e) {
    var d = e.target; if (!d || !d.dataset) return;
    if (d.dataset.group) (state.groupsOpen = state.groupsOpen || {})[d.dataset.group] = d.open;
    if (d.dataset.disc) (state.disc = state.disc || {})[d.dataset.disc] = d.open;
  }, true);
  document.addEventListener('change', function (e) {
    if (e.target.id === 'rel-area') { state.rel.area = e.target.value; render(); }
    if (e.target.id === 'map-ver') { state.mapVer = e.target.value === 'draft' ? null : e.target.value; state.pick = null; render(); }
    if (/^tf-/.test(e.target.id || '') && state.typeForm) { typeFormInput(e, false); render(); }
    if (/^ob-(text|type|fld-[\w-]+|ph-title|ph-mode|g-title|g-owner|g-approves|tr-title|tr-role)$/.test(e.target.id || '') && state.view === 'process' && state.ptab === 'edit') builderField(e.target.id, e.target.value);
    if (/^ob-mark-(step|must|planned)$/.test(e.target.id || '') && e.target.checked && state.view === 'process' && state.ptab === 'edit') builderField('ob-mark', e.target.id.slice(8));
    if (e.target.id === 'me') { state.me = e.target.value.trim().slice(0, 60); lsSet('me', state.me); render(); }
    if (e.target.id === 'su-backup' && state.setup) { state.setup.backup = e.target.value; render(); }
    if (e.target.id === 'su-to' && state.setup) { state.setup.to = e.target.value; render(); }
    /* In Fill in, changing a choice (like a Jira action) redraws the form so the fields that choice needs appear. */
    if (/^fld-/.test(e.target.id || '') && state.pick && state.pick.kind === 'fields') {
      var vals = {}; document.querySelectorAll('[id^="fld-"]').forEach(function (el) { vals[el.id.slice(4)] = el.value; });
      vals[e.target.id.slice(4)] = e.target.value;
      state.fieldsDraft = { id: state.pick.id, values: vals }; render();
    }
    if (e.target.id === 'note-file') { addFiles(e.target.files, state.sel); e.target.value = ''; }
    if (e.target.id === 'me-run') { state.me = String(e.target.value || '').trim().slice(0, 60); lsSet('me', state.me); render(); }
    if (e.target.id === 'rw-phase' && e.target.value) ACTIONS.goto('phase-' + e.target.value);
    /* The correction composer: where a new step goes, where a step moves, who does it, and its files. */
    if (state.corrForm) {
      var cf = state.corrForm;
      if (/^corr-where-/.test(e.target.id || '')) { cf.where = e.target.id.slice(11) === 'end' ? 'end' : 'after'; render(); }
      if (e.target.id === 'corr-move') { cf.moveTo = e.target.value; state.fieldErr = null; render(); }
      if (/^corr-role-/.test(e.target.id || '')) { var ro = e.target.id.slice(10); cf.roles = cf.roles.filter(function (x) { return x !== ro; }); if (e.target.checked) cf.roles.push(ro); state.fieldErr = null; render(); }
      if (e.target.id === 'corr-file') { addFiles(e.target.files, corrFileKey()); e.target.value = ''; }
    }
  });
  function corrFileKey() { return 'corr:' + state.corrForm.step; }
  /* Files dropped, pasted or chosen wait with the note or suggestion they were added to: each is checked (kind, size, and
     that its first bytes are what it says), and anything refused is explained next to that box. An attachment belongs to the
     run and step it was added on, whichever way the person moves around afterwards. */
  function addFiles(list, step) {
    var files = Array.prototype.slice.call(list || []), key = state.runKey, g = gen, errKey = /^corr:/.test(step || '') ? step : 'note:' + step;
    if (!files.length || !step) return Promise.resolve();
    state.attErr = null;
    return files.reduce(function (p, f) {
      return p.then(function () {
        if (g !== gen || state.runKey !== key) return;
        var ok = PF.attach.check(f.name || '', f.type, f.size);
        if (ok.error) { state.attErr = { key: errKey, msg: ok.error }; return; }
        /* Files still being checked hold their place, so two additions at once can't pass the limit together. */
        var slot = key + '|' + step;
        if (attachmentsFor(key, step).length + (checking[slot] || 0) >= PF.attach.PER_NOTE) { state.attErr = { key: errKey, msg: 'Up to ' + PF.attach.PER_NOTE + ' files go with one note. Add the note, then attach the rest to another.' }; return; }
        checking[slot] = (checking[slot] || 0) + 1;
        return headOf(f).then(function (head) {
          checking[slot]--;
          if (g !== gen || state.runKey !== key) return;
          if (!PF.attach.sniff(head, ok.ext)) { state.attErr = { key: errKey, msg: '"' + ok.name + '" doesn\'t look like a .' + ok.ext + ' file inside, so it wasn\'t attached.' }; return; }
          state.pendingFiles.push({ id: U.randomId(8), key: key, step: step, file: f, name: ok.name, size: ok.size, kind: ok.kind });
        });
      });
    }, Promise.resolve()).then(function () { if (g === gen) render(); });
  }
  var checking = Object.create(null);
  function headOf(f) {
    var part = f.slice ? f.slice(0, 4096) : f;
    if (part.arrayBuffer) return part.arrayBuffer().then(function (b) { return new Uint8Array(b); }, function () { return new Uint8Array(0); });
    return Promise.resolve(new Uint8Array(0));
  }
  function attachmentsFor(key, step) { return state.pendingFiles.filter(function (p) { return p.key === key && p.step === step; }); }
  /* Saves each waiting file to the run's files/ folder, in order, with its cleaned name and size for the note. */
  function saveFiles(fs, r, list) {
    var paths = [], info = {};
    return list.reduce(function (pr, p) { return pr.then(function () { return repo.saveAttachment(fs, r, p.file, WRITER, p.name).then(function (path) { paths.push(path); info[path] = { name: p.name, size: p.size }; }); }); }, Promise.resolve())
      .then(function () { return { paths: paths, info: info }; });
  }
  function imagesOf(n) { return (n.files || []).filter(function (f) { return PF.attach.kindOf(f) === 'image'; }).map(function (f) { return { src: f, caption: PF.attach.nameOf(f, (n.fileInfo || {})[f]) + ' from ' + V.nameOf(ctx, n.by) }; }); }
  /* The note or suggestion a file button belongs to, and only if the file is one of its own. */
  function attOwner(id, b) {
    var from = b && b.dataset.from, path = b && b.dataset.path, it = null;
    if (from === 'corr') it = corrById(id);
    else { var r = ctx.run(); it = r && (r._notes || []).filter(function (x) { return x.id === id; })[0]; }
    return it && (it.files || []).indexOf(path) >= 0 ? it : null;
  }
  function noteStepText(id) { var r = ctx.run(), x = r && M.findStep(R.mapOf(r), id); return x ? x.step.text : id; }
  /* Typed evidence, Fill in values and a note's text belong to their run and step. They're kept here while the person moves
     around the run (J/K, clicks, auto-advance), drawn back into the boxes on return, and dropped only when used or canceled.
     An open Fill in is remembered too, so it reopens. */
  var drawn = null;
  /* Keyed by team folder, run and step: another folder never sees this folder's drafts, even for a run with the same ID. */
  function draftKey(key, id, fk) { return (fk == null ? fsKey() : fk) + '\n' + key + '|' + id; }
  function draftOf(key, id, make, fk) {
    var k = draftKey(key, id, fk), d = state.stepDrafts[k];
    if (!d && make) d = state.stepDrafts[k] = { record: {}, fields: {}, note: '', open: false, fd: null };
    return d || null;
  }
  function hasDraft(d) { return !!d && (d.open || !!String(d.note || '').trim() || Object.keys(d.record).length > 0 || Object.keys(d.fields).length > 0); }
  function dropDraft(key, id, parts) {
    var d = draftOf(key, id, false); if (!d) return;
    (parts || ['record', 'fields', 'note', 'open']).forEach(function (p) { if (p === 'note') d.note = ''; else if (p === 'open') { d.open = false; d.fd = null; } else d[p] = {}; });
    /* What's on screen was just used: it isn't read back into the draft before the next redraw. */
    if (drawn && drawn.fs === fsKey() && drawn.key === key && drawn.sel === id) (parts || ['record', 'fields', 'note']).forEach(function (p) { drawn.skip[p === 'note' ? 'note' : 'box'] = true; });
    if (!hasDraft(d)) delete state.stepDrafts[draftKey(key, id)];
  }
  /* What a box held as drawn: a value that still matches is not a draft. */
  function baseOf(id) { return drawn && drawn.base[id] != null ? drawn.base[id] : ''; }
  function unesc(v) { return String(v).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
  /* Reads the boxes on screen into the draft of the step and folder they were drawn for. A box left as drawn keeps its draft.
     The folder is the one they were drawn in, so typing is kept for it even when the folder changed before this read. */
  function harvest() {
    if (!drawn || drawn.key !== state.runKey || state.view !== 'run') return;
    var d = draftOf(drawn.key, drawn.sel, true, drawn.fs), part = d[drawn.kind];
    drawn.ids.forEach(function (id) {
      var el = document.getElementById(id); if (!el || el.value === baseOf(id) || drawn.skip[id === 'note-text' ? 'note' : 'box']) return;
      if (id === 'note-text') { d.note = el.value; return; }
      /* A box emptied on purpose is a draft too: it stays empty when the step comes back. */
      part[id] = el.value;
    });
    if (!hasDraft(d)) delete state.stepDrafts[draftKey(drawn.key, drawn.sel, drawn.fs)];
  }
  function noteDrawn(html) {
    var sel = V.runSel(ctx), ids = [], m, re = /id="((?:rec|fld)-[\w-]+|note-text)"/g;
    if (state.view !== 'run' || !sel) { drawn = null; return; }
    var base = {};
    while ((m = re.exec(html))) {
      var id = m[1], at = m.index, tag = html.lastIndexOf('<', at), name = html.slice(tag + 1, tag + 9), v = '';
      if (/^textarea/.test(name)) { var o = html.indexOf('>', at) + 1; v = html.slice(o, html.indexOf('</textarea>', o)); }
      else if (/^select/.test(name)) { var sh = html.slice(at, html.indexOf('</select>', at)), so = /<option[^>]*\sselected[^>]*>([^<]*)/.exec(sh); v = so ? so[1] : ''; }
      else { var tg = html.slice(at, html.indexOf('>', at)), vm2 = /\svalue="([^"]*)"/.exec(tg); v = vm2 ? vm2[1] : ''; }
      ids.push(id); base[id] = unesc(v);
    }
    drawn = { fs: fsKey(), key: state.runKey, sel: sel, kind: state.pick && state.pick.kind === 'fields' && state.pick.id === sel ? 'fields' : 'record', ids: ids, base: base, skip: {} };
  }
  /* After a redraw the boxes show their step's draft, else what was drawn. On a new step or form every box is set, since a
     redraw can keep an old node (same markup) that still holds another step's typing; on the same one, typing stays. */
  function restoreDrafts(changed) {
    if (!drawn) return;
    var d = draftOf(drawn.key, drawn.sel, false);
    drawn.ids.forEach(function (id) {
      var el = document.getElementById(id), mine = d ? (id === 'note-text' ? d.note || null : Object.prototype.hasOwnProperty.call(d[drawn.kind], id) ? d[drawn.kind][id] : null) : null, want = mine != null ? mine : baseOf(id);
      if (!el || el.value === want) return;
      if (changed || (mine && !el.value)) el.value = want;
    });
  }
  /* Every change of screen goes through here: what's typed on the run's selected step is kept first. */
  function setView(v) { harvest(); state.view = v; }
  /* One way to select a step, for the mouse and the keyboard alike. An open Fill in is remembered with its step. */
  function selectStep(id) {
    if (state.sel !== id) {
      state.attErr = null; harvest();
      /* An open Fill in is remembered for the folder it was drawn in, never carried into another. */
      if (state.pick && state.pick.kind === 'fields' && state.runKey) { var od = draftOf(state.runKey, state.pick.id, true, drawn ? drawn.fs : null); od.open = true; od.fd = state.fieldsDraft; }
    }
    state.sel = id; if (state.pick && state.pick.id !== id) { state.pick = null; state.fieldsDraft = null; }
    var d = state.runKey && draftOf(state.runKey, id, false);
    if (d && d.open && !state.pick) { state.pick = { kind: 'fields', id: id, back: '[data-act="pick"][data-kind="fields"][data-id="' + cssEsc(id) + '"]' }; state.fieldsDraft = d.fd; }
  }
  function nextStepId(r, map) { var nx = R.nextUp(r, map, state.me); return nx.kind === 'step' && nx.step ? nx.step.id : null; }
  /* Whether a step can be answered now, and with what: its own draft's evidence, else what's saved, else what the box would
     show. An open or unsaved Fill in on it is saved or canceled first. Returns { r, map, x, values } or { why, focus, field }. */
  function answerCheck(key, id) {
    harvest();
    var r = ctx.findRun(key), map = r && R.mapOf(r), x = map && M.findStep(map, id);
    if (!x) return { why: '' };
    var a = r.steps[id], d = draftOf(key, id, false);
    if ((state.pick && state.pick.kind === 'fields' && state.pick.id === id && state.runKey === key) || (d && (d.open || Object.keys(d.fields).length))) return { why: 'Save or cancel Fill in first.', fill: true, focus: '[data-act="pick"][data-kind="fields"][data-id="' + cssEsc(id) + '"], [data-act="save-fields"][data-id="' + cssEsc(id) + '"]' };
    var values = null;
    if (!(a && a.s === 'done') && x.step.type !== 'run.process') {
      values = {};
      R.evidenceFor(r, x.step).list.forEach(function (ev) {
        var k = 'rec-' + ev.name;
        values[ev.name] = d && Object.prototype.hasOwnProperty.call(d.record, k) ? d.record[k] : V.evidenceDefault(ctx, r, x.step, ev);
      });
      var chk = R.checkEvidence(r, x.step, null, Object.assign({}, (a && a.s !== 'recheck' && a.values) || {}, values));
      if (chk.error) return { why: chk.error, focus: chk.field ? 'rec-' + chk.field : '[aria-invalid="true"]', field: chk.field ? 'rec-' + chk.field : '' };
    }
    return { r: r, map: map, x: x, values: values };
  }
  /* The one way to answer a step, Done or Done differently, from every place that does it (row check, inspector Done, Space
     and X, the Done differently composer and Mark it now). It works on that step only, with answerCheck's values, and only
     its own forms close. o: { how: 'done' | 'differently', happened, at, quiet (no selection or messages: the person may be
     elsewhere) }. Resolves true only when the answer is saved in the team folder: a refused or failed save resolves false, and
     its own message (the conflict, or the unsaved change with Try again) says what happened. */
  function answerStep(key, id, o) {
    var g = gen, here = state.view === 'run' && state.runKey === key, quiet = !!o.quiet || !here, c = answerCheck(key, id);
    if (!c.r) {
      if (quiet || !c.why) return Promise.resolve(false);
      selectStep(id); state.refOpen = true;
      if (c.fill) { say(c.why, 'warn'); state.msg.quiet = true; } else state.fieldErr = { id: id, msg: c.why, field: c.field };
      state.focus = c.focus; render(); return Promise.resolve(false);
    }
    var was = here ? nextStepId(c.r, c.map) : null, applied = false;
    var saving = mutateRun(key, g, function (r2, map2, me, now) {
      if (o.how === 'differently') R.doneDifferently(r2, map2, id, o.happened, me, o.at || now, c.values);
      else R.done(r2, map2, id, me, now, c.values);
      applied = true;
    }, quiet ? { only: id, background: true } : { only: id });
    if (applied) { dropDraft(key, id, ['record']); if (!quiet && state.view === 'run' && state.runKey === key) afterAnswer(id, was); }
    return saving.then(function (saved) { return applied && saved === true; });
  }
  /* After checking the step Next up pointed at, the next one in its phase is selected and its check gets focus, with one
     announcement. A step checked out of order stays selected. Nothing moves while a note or a suggestion is being written
     on the step, so no draft is left behind. */
  function afterAnswer(id, was) {
    var r = ctx.run(), map = r && R.mapOf(r), x = map && M.findStep(map, id), a = r && r.steps[id];
    if (!x || !a || a.s !== 'done') return;
    var title = '"' + x.step.text + '" checked.';
    /* Typed text lives in its box, so a note or suggestion being written keeps the selection where it is. Waiting files are
       kept with their own step either way. */
    harvest();
    var f = state.corrForm, draft = !!(val('note-text').trim() || hasDraft(draftOf(state.runKey, state.sel, false)) || (f && f.key === state.runKey && f.step === state.sel));
    if (was !== id || draft) { say(title + (draft && was === id ? ' What you\'re writing isn\'t sent yet, so this step stays selected.' : ''), ''); state.msg.quiet = true; render(); return; }
    var nxt = R.nextInPhase(r, map, id), g = map.phases[x.phaseIndex].gate;
    if (nxt) {
      /* On a phone the sheet stays open on the next step, with focus on its title. */
      /* A step that starts a child run has no check to focus; its title in the inspector takes focus instead. */
      selectStep(nxt.id); state.focus = (narrow() && state.refOpen) || nxt.type === 'run.process' ? 'ins-h' : '[data-act="toggle"][data-id="' + cssEsc(nxt.id) + '"]';
      if (nxt.type === 'run.process') state.refOpen = true;
      say(title + ' Next: "' + nxt.text + '".', ''); state.msg.quiet = true; render(); reveal('#step-' + cssEsc(nxt.id));
      return;
    }
    /* On a phone the step sheet closes first, so the gate can take focus. */
    if (narrow()) state.refOpen = false;
    state.focus = '#gate-' + cssEsc(g.id) + ' .btn.go';
    say(title + ' Next: ' + (g.implicit ? 'confirm the phase.' : 'the "' + g.title + '" gate.'), ''); state.msg.quiet = true; render(); reveal('#gate-' + cssEsc(g.id));
  }
  var NOTE_MAX = 2000;
  /* Where a pasted or dropped file goes: a suggestion when it's dropped or pasted in that form (or the form asks for the
     right screenshot), otherwise the selected step's note. */
  function dropTarget(t) {
    var cx = state.corrForm && state.corrForm.key === state.runKey ? corrFileKey() : null;
    if (cx && t && t.closest && t.closest('.corrform')) return cx;
    if (cx && state.corrForm.op === 'screenshot' && !(t && t.closest && t.closest('[data-drop="note"]'))) return cx;
    return state.sel;
  }
  document.addEventListener('paste', function (e) {
    if (state.view !== 'run' || !state.sel || !state.me || !e.clipboardData) return;
    var items = e.clipboardData.items || [], files = [];
    for (var i = 0; i < items.length; i++) if (items[i].kind === 'file') { var f = items[i].getAsFile(); if (f) files.push(f); }
    if (!files.length) return;
    e.preventDefault(); addFiles(files, dropTarget(e.target));
  });
  /* Files dragged from the computer onto a note or suggestion box. */
  function filesDrag(e) { var dt = e.dataTransfer; return !!dt && Array.prototype.indexOf.call(dt.types || [], 'Files') >= 0; }
  function dropZone(e) { return state.view === 'run' && state.me && e.target && e.target.closest ? e.target.closest('[data-drop]') : null; }
  /* A file let go anywhere else on a run is caught, so the browser never swaps the app for the file. */
  document.addEventListener('dragover', function (e) {
    if (!filesDrag(e) || state.view !== 'run') return;
    var z = dropZone(e); if (!z) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'none'; } catch (err) { /* older browsers */ } return; }
    e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch (err) { /* older browsers */ }
    if (z.classList && !z.classList.contains('dropping')) z.classList.add('dropping');
  });
  document.addEventListener('dragleave', function (e) { var z = dropZone(e); if (z && z.classList && !(e.relatedTarget && z.contains(e.relatedTarget))) z.classList.remove('dropping'); });
  document.addEventListener('drop', function (e) {
    if (!filesDrag(e) || state.view !== 'run') return;
    var z = dropZone(e); if (!z) { e.preventDefault(); if (state.me) { say('Drop files on a note box to attach them.', 'warn'); render(); } return; }
    e.preventDefault(); if (z.classList) z.classList.remove('dropping');
    addFiles(e.dataTransfer.files, z.getAttribute('data-drop') === 'corr' && state.corrForm ? corrFileKey() : z.getAttribute('data-id') || state.sel);
  });

  document.addEventListener('keydown', function (e) {
    var t = e.target, typing = t && /INPUT|TEXTAREA|SELECT/.test(t.tagName);
    if (e.key === 'Escape') { if (state.overlay) { closeOverlay(); return; } var om = document.querySelector && document.querySelector('.rw-menu[open]'); if (om) { om.open = false; (state.disc = state.disc || {})['rw-menu'] = false; var sm = om.querySelector('summary'); if (sm) sm.focus(); return; } if (state.tfPreview && state.view === 'types') { ACTIONS['tf-preview'](); return; } if (state.obPlace) { cancelPlacing(); return; } if (state.obAsk) { ACTIONS['ob-ask-cancel'](); return; } if (obSheetOpen) { ACTIONS['ob-done'](); return; } if (sheetWasOpen) { state.refOpen = false; render(); return; } if (state.pick || state.edit) { var pk = state.pick; if (pk && pk.kind === 'fields') { dropDraft(state.runKey, pk.id, ['fields', 'open']); state.fieldsDraft = null; } state.pick = null; state.edit = null; state.fieldErr = null; if (pk && pk.back) state.focus = pk.back; render(); return; } if (state.corrForm) { if (state.corrForm.menu) { state.corrForm.menu = false; state.focus = '[data-act="corr-menu"]'; render(); return; } ACTIONS['corr-cancel'](); return; } if (state.view === 'mission' || state.view === 'receipt') { setView('run'); render(); } return; }
    /* A dialog keeps Tab and Shift+Tab inside it, wrapping at the ends, so keyboard focus never falls behind it. */
    var trap = state.overlay ? overlayEl : state.tfPreview && state.view === 'types' ? document.getElementById('tf-preview') : null;
    if (e.key === 'Tab' && trap && !e.altKey && !e.ctrlKey && !e.metaKey) {
      /* Only controls on screen count: a hidden one (a narrow screen's other panel, a closed section) can't take focus. */
      var fo = Array.prototype.slice.call(trap.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')).filter(function (el) { return !el.getClientRects || el.getClientRects().length > 0; });
      if (fo.length) {
        var fa = document.activeElement, inside = trap.contains(fa);
        if (e.shiftKey && (!inside || fa === fo[0])) { e.preventDefault(); fo[fo.length - 1].focus(); }
        else if (!e.shiftKey && (!inside || fa === fo[fo.length - 1])) { e.preventDefault(); fo[0].focus(); }
      }
      return;
    }
    if (state.overlay && state.overlay.list && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { ACTIONS['lb-step'](e.key === 'ArrowLeft' ? '-1' : '1'); return; }
    /* A comma ends a tag: it's added at once (a tag can't hold a comma). */
    if (typing && e.key === ',' && t.id === 'tf-tagadd') { e.preventDefault(); ACTIONS['tf-tag-add'](); return; }
    if (typing && e.key === 'Enter' && t.dataset.enter) {
      e.preventDefault();
      var act = t.dataset.enter;
      if (act === 'save-edit') ACTIONS['save-edit'](); else if (act === 'block') ACTIONS.block(t.dataset.id, t); else if (ACTIONS[act]) ACTIONS[act](t.dataset.id, t);
      return;
    }
    /* Undo and Redo in the draft editor and the step-type form, also while typing: Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z or Ctrl+Y.
       A builder box with typing not yet applied keeps the browser's own undo for that typing; once it matches what's
       applied, the keys go to the timeline. Other boxes (the name at the top, searches) keep the browser's. */
    var zk = String(e.key || '').toLowerCase();
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (zk === 'z' || (zk === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey))) {
      /* While an input method is composing, its own keys come first. */
      if (composing || e.isComposing || e.keyCode === 229) return;
      var zs = tlScope(); if (!zs) return;
      var zid = (t && t.id) || '';
      /* The step-type editor's Add-a-tag and Add-an-option boxes hold typing not yet applied, like the builder's boxes. */
      /* Searches and filters (the parts search) aren't part of the draft: their typing is the browser's to undo. */
      if (typing && (t.type === 'search' || /^ob-part-q/.test(zid))) return;
      var pending = /^ob-/.test(zid) || /^tf-.*add$/.test(zid);
      if (typing && !(zid === 'draft-editor' || (/^tf-/.test(zid) && !pending) || (pending && (t.tagName === 'SELECT' || t.value === (t.defaultValue || ''))))) return;
      e.preventDefault(); tlMove(zs, zk === 'y' || e.shiftKey, 'key'); return;
    }
    /* The inspector's tabs: the arrow keys (Home, End) move between them. */
    if (t && t.dataset && t.dataset.act === 'ins-tab' && /^(Arrow(Left|Right)|Home|End)$/.test(e.key) && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      var tabs = (state.builder !== false ? ['selected'] : []).concat(['checks', 'preview']), ti = Math.max(0, tabs.indexOf(t.dataset.id));
      ACTIONS['ins-tab'](tabs[e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (ti + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length]);
      return;
    }
    /* Placing a part: the arrow keys (Home, End) move among the places it can go. */
    if (state.obPlace && t && t.dataset && t.dataset.act === 'ob-place-at' && /^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(e.key) && !e.altKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); movePlace(e); return; }
    /* In the outline builder, Alt+Up / Alt+Down move the focused step or phase. Never while typing in a field. */
    if (e.altKey && !e.metaKey && !e.ctrlKey && !typing && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && state.view === 'process' && state.ptab === 'edit' && state.builder && !state.overlay) {
      var obr = t && t.closest && t.closest('[data-ob-step], [data-ob-phase]');
      if (obr) {
        e.preventDefault();
        var dir = e.key === 'ArrowUp' ? 'up' : 'down';
        if (obr.dataset.obStep != null) ACTIONS['ob-move'](obr.dataset.obStep, { dataset: { dir: dir, from: 'key' } });
        else ACTIONS['ob-ph-move'](obr.dataset.obPhase, { dataset: { dir: dir, from: 'key' } });
        return;
      }
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '?') { openOverlay({ html: function () { return V.help(ctx); } }); return; }
    /* Single-letter shortcuts can be turned off (WCAG 2.1.4), and Space never steals a focused button's own action. */
    if (!state.keys) return;
    var onControl = document.activeElement && document.activeElement !== document.body && document.activeElement.closest('button, a, summary, select, [role="checkbox"]');
    if (onControl && (e.key === ' ' || e.key === 'Enter')) return;
    if (state.view !== 'run' && !(state.view === 'mission' && e.key === 'm')) return;
    if (state.overlay) return;
    var r = ctx.run(); if (!r) return;
    var all = M.steps(R.mapOf(r)).map(function (x) { return x.step.id; }), i = all.indexOf(state.sel);
    /* J / K move the selection, opening a folded phase it lands in; only the checklist pane scrolls, just enough. */
    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault();
      var to = all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'j' ? 1 : -1)))] || all[0], tx = M.findStep(R.mapOf(r), to);
      if (tx) state.unfold[tx.phase.id] = true;
      selectStep(to); render(); var el = document.getElementById('step-' + state.sel); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); return;
    }
    /* Space (or X) checks the selected step. A held key checks one step, not a run of them. */
    if ((e.key === ' ' || e.key === 'x') && state.sel) { e.preventDefault(); if (!e.repeat) ACTIONS.toggle(state.sel); return; }
    if (e.key === 'b' && state.sel) { state.pick = { kind: 'block', id: state.sel, back: '[data-act="select"][data-id="' + cssEsc(state.sel) + '"]' }; state.refOpen = true; render(); return; }
    /* C opens Correct this step on the selected step. */
    if (e.key === 'c' && state.sel && state.me && state.view === 'run') { e.preventDefault(); ACTIONS['corr-open'](state.sel, { dataset: { mode: 'correct' } }); return; }
    if (e.key === 'n' && state.sel) { state.refOpen = true; render(); var nt = document.getElementById('note-text'); if (nt) { e.preventDefault(); nt.focus(); } return; }
    if (e.key === 'm') { if (state.view === 'run') savePanes(); setView(state.view === 'mission' ? 'run' : 'mission'); render(); }
  });

  render();
  /* A refresh while editing a draft comes back to the editor (this tab only). Unsaved edits don't survive a refresh, so the
     browser asks before leaving with any. */
  function resumeEditor() {
    var id = resumeEdit; resumeEdit = null;
    var p = id && processes().filter(function (x) { return x.id === id; })[0]; if (!p) return;
    setView('process'); state.processId = id; state.ptab = 'edit'; state.mapVer = null; openEditor(p); state.focus = 'ed-h'; render();
  }
  window.addEventListener('beforeunload', function (e) {
    var any = !!state.obPending || Object.keys(state.editors || {}).some(function (k) { return dirty(state.editors[k]); });
    if (any) { e.preventDefault(); e.returnValue = ''; }
  });
  boot().then(resumeEditor, resumeEditor).then(announceRelease, announceRelease);
})();
