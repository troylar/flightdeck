/* App wiring: state, loading, saving, refresh, events. Screens are in views.js; rules are in core/. */
(function () {
  'use strict';
  var U = PF.util, R = PF.run, M = PF.map, T = PF.types, V = PF.views, repo = PF.repo;
  var EXAMPLES = /*@EXAMPLES@*/{};
  /* src/releases.json, checked and embedded by build.py, newest first. The app's version is the newest release; "dev" means
     this is the unbuilt source, not a copy people should use. */
  var RELEASES = /*@RELEASES@*/[];
  var APP_VERSION = RELEASES[0] ? RELEASES[0].version : 'dev';
  var LS = 'preflight';
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
    folderErr: null, keys: lsGet('keys', true), theme: lsGet('theme', 'system'), fieldErr: null, startMode: {}, showRoles: false, copyView: null, archive: {}
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
    recording: function (r) { return !!r && !!state.me && !r.ended && r.recorder.person === state.me && r.recorder.session === SESSION; },
    /* Who may resolve conflict copies: the recorder's window while it runs; once it has ended, whoever recorded or ended it. */
    canRecover: function (r) { return !!r && !!state.me && (ctx.recording(r) || (!!r.ended && (r.recorder.person === state.me || r.ended.by === state.me))); },
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
    /* The release history and what this person has seen of it (for "New for you" and the dot on What's new). */
    get releases() { var seen = state.relShownSeen || relSeen(); return { list: RELEASES, version: APP_VERSION, lastSeen: seen, fresh: APP_VERSION !== 'dev' && V.semverCmp(APP_VERSION, relSeen()) > 0, newer: state.newer }; },
    localCopy: function (r) { var c = lsGet(localKey(r.id), null); return c && c.id === r.id ? c : null; },
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
    if (state.msg) return;
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
  var procCache = null, orphanSkills = [];
  function processes() {
    if (procCache) return procCache;
    var by = Object.create(null);
    function entry(id) { return by[id] = by[id] || { id: id, title: id, category: 'Other', latest: null, all: [], clashes: [], broken: [], draft: null, draftChanged: false, lastRun: null, staleSkills: 0, skills: [], group: [], tags: [] }; }
    data.processes.forEach(function (p) {
      var e = entry(p.process); e.latest = p.index.latest; e.all = p.index.all; e.clashes = p.index.clashes;
      e.broken = p.pubs.filter(function (x) { return !x.ok; });
      if (e.latest) { e.title = e.latest.map.meta.title || e.id; e.category = e.latest.map.meta.category || 'Other'; e.group = e.latest.map.meta.group; e.tags = e.latest.map.meta.tags; }
    });
    data.drafts.forEach(function (d) {
      var m = M.parse(d.md), id = m.meta.process || d.file.replace(/\.md$/i, ''), e = entry(id);
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
    return JSON.stringify([d.people.length, d.drafts.map(function (x) { return x.file + x.mtime; }), d.processes.map(function (p) { return p.pubs.map(function (x) { return x.folder + x.ok; }); }),
      d.runs.map(function (r) { return r.id + ':' + r._fileHash + ':' + (r._notes || []).length + ':' + (r._conflicts || []).length; }), d.skills.map(function (x) { return JSON.stringify(x.skill); }), (d.validations || []).length, d.plans.map(function (p) { return p.id + p._hash + !!p._status + !!p._conflicting; })]);
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
    return edits(id) === (before[id] || 0);
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
      var s = signature(d), changed = s !== sig, wasErr = state.folderErr;
      for (var i = 0; i < d.runs.length; i++) {
        var id = d.runs[i].id, mine = localRun(id);
        if (!canReplace(id, before)) d.runs[i] = state.unsaved[id] || mine || d.runs[i];
        else if (!mine || mine._fileHash !== d.runs[i]._fileHash) bump(id);
      }
      /* Any run this read may not replace stays, even if the read didn't list it (a file briefly missing mid-sync). */
      data.runs.forEach(function (x) { if (!canReplace(x.id, before) && !d.runs.some(function (y) { return y.id === x.id; })) d.runs.push(state.unsaved[x.id] || x); });
      data = d; sig = s; procCache = null; state.folderErr = null; state.runReadAt = d.readAt;
      if (changed || force || wasErr) render(); else renderTop();
      syncChildren();
    }, function (e) { if (g !== gen) return; loading = null; state.folderErr = e.message || String(e); render(); });
    loading = { gen: g, p: p };
    return p;
  }
  /* While a run is open, refresh just that run and its notes. The rest of the folder refreshes less often. */
  function refreshRun() {
    var r = ctx.run();
    if (!r || !state.fs || (loading && loading.gen === gen)) return Promise.resolve();
    var before = r._fileHash + ':' + (r._notes || []).length + ':' + (r._conflicts || []).length, g = gen, revs = revsNow();
    var p = repo.loadRun(state.fs, r.process, r.id).then(function (f) {
      if (g !== gen) return;
      loading = null; state.folderErr = null; state.runReadAt = new Date().toISOString();
      if (!f || !canReplace(r.id, revs)) { renderTop(); return; }
      if (f._fileHash !== r._fileHash) bump(r.id);
      for (var i = 0; i < data.runs.length; i++) if (data.runs[i].id === r.id) data.runs[i] = f;
      if (f._fileHash + ':' + (f._notes || []).length + ':' + (f._conflicts || []).length !== before) render(); else { renderTop(); updateFreshness(); }
    }, function (e) { if (g !== gen) return; loading = null; state.folderErr = e.message || String(e); render(); });
    loading = { gen: g, p: p };
    return p;
  }
  function updateFreshness() { var el = document.getElementById('fresh'); if (el) el.innerHTML = V.freshness(ctx, ctx.run()); }
  function useFs(fs) {
    /* Unsaved changes stay with their own folder: kept in this browser under that folder's name, never carried into the new one. */
    Object.keys(state.unsaved).forEach(function (id) { lsSet(localKey(id), state.unsaved[id]); });
    gen++; loading = null; state.copyView = null; state.newer = null; state.archive = {}; editCount = {}; state.unsaved = {}; state.saveErr = {}; state.saveOpts = {}; state.folderErr = null; state.busyN = 0; state.pendingSaves = {}; state.recovering = null;
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

  /* Start a new team folder: an empty folder gets people.json with you in it, a starter map and the assistant contract. */
  function newFolder() {
    if (!state.me) { say('Type your name at the top right first, so the new folder starts with you in its people list.', 'warn'); render(); return; }
    var t = ++opening;
    window.showDirectoryPicker({ id: 'preflight', mode: 'readwrite' }).then(function (dir) {
      if (t !== opening) return;
      var fs = new PF.fs.FolderFS(dir);
      /* Two windows starting a new folder at once take turns, and the second finds it no longer empty. */
      var init = function () { return fs.list('').then(function (items) {
        /* Only operating-system clutter may already be there; anything else (including hidden folders) means it isn't new. */
        var clutter = { '.DS_Store': 1, 'desktop.ini': 1, 'Thumbs.db': 1 };
        if (items.some(function (i) { return !clutter[i.name]; })) { say('"' + dir.name + '" isn\'t empty. Choose an empty folder for a new team folder, or use Open team folder for an existing one.', 'warn'); render(); return; }
        var known = ctx.peopleById[state.me], me = known ? known.name : state.me, id = known ? known.id : 'person-' + U.slug(me, 30);
        var people = [{ id: id, name: me, initials: me.split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 3).toUpperCase(), email: '' }];
        var mine = JSON.stringify(people, null, 2) + '\n';
        /* Two browsers starting the same folder at once can't share a lock, so each checks that people.json is the one it wrote. */
        return fs.write('people.json', mine)
          .then(function () { return fs.read('people.json'); })
          .then(function (f) { if (!f || f.text !== mine) throw new Error('another window started this folder at the same moment; open it with Open team folder instead'); })
          .then(function () { return fs.write('maps/drafts/check-in.md', EXAMPLES['maps/drafts/check-in.md']); })
          .then(function () { return EXAMPLES['AGENTS.md'] ? fs.write('AGENTS.md', EXAMPLES['AGENTS.md']) : null; })
          .then(function () { return Object.keys(EXAMPLES).filter(function (k) { return /^\.flightdeck\/skills\//.test(k); }).reduce(function (p, k) { return p.then(function () { return fs.write(k, EXAMPLES[k]); }); }, Promise.resolve()); })
          .then(function () { return handles.set(dir); })
          .then(function (rec) { if (t !== opening) return; state.me = id; lsSet('me', id); home(); return useFs(folderFs(rec)); })
          .then(function () { if (t !== opening) return; say('Created the team folder "' + dir.name + '" with you in people.json and a starter checklist. Add teammates to people.json, and keep the folder available offline in OneDrive.', 'good'); render(); });
      }); };
      return (LOCKS ? lock('preflight:new-folder', init) : init()).catch(function (e) { if (t !== opening) return; say('The new team folder wasn\'t finished: ' + e.message + '. Check what\'s in "' + dir.name + '", empty it, and try again.', 'bad'); render(); });
    }, function () { /* picker closed */ });
  }

  /* ---------- rendering ---------- */
  var app = document.getElementById('app'), topEl = document.getElementById('top'), overlayEl = document.getElementById('overlay');
  function say(text, kind) { state.msg = text ? { text: text, kind: kind || '' } : null; }
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
  window.addEventListener('resize', function () { pinOffsets(); });
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
      if (el.type === 'checkbox') { if (el.checked !== el.defaultChecked) el.checked = el.defaultChecked; return; }
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
    procCache = null;
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
    var v = state.view;
    app.dataset.scope = [v, state.runKey, state.processId, state.fs ? state.fs.id || state.fs.name : '', gen].join('|');
    var PAGES = { run: V.run, mission: V.mission, receipt: V.receipt, finish: V.finish, process: V.process, start: V.start, runs: V.runs, processes: V.processesPage, skills: V.skillsPage, skill: V.skill, types: V.types, settings: V.settings, 'new-process': V.newProcess };
    patch(app, (PAGES[v] || V.home)(ctx));
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
    syncBound();
    var target = state.focus ? document.getElementById(state.focus) || app.querySelector(state.focus) || topEl.querySelector(state.focus) : focusKey ? app.querySelector(focusKey) || topEl.querySelector(focusKey) : null;
    /* The page someone was on went away (its skill was removed): focus goes to the way back, next to the message saying so. */
    if (!target && focusKey === '#page-h') target = document.getElementById('page-back');
    state.focus = null;
    /* The caret goes back where it was: from the carried-over value, or for a bound control from the node it had before. */
    var caret = keep[target && target.id] || (ae && target && ae.id && ae.id === target.id && ae.selectionStart != null ? { s: ae.selectionStart, e: ae.selectionEnd } : null);
    if (target && document.activeElement !== target) { target.focus({ preventScroll: true }); if (caret && target.setSelectionRange && caret.s != null) try { target.setSelectionRange(caret.s, caret.e); } catch (e) { /* not a text field */ } }
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
      var want = state.overlayFocus || osel; state.overlayFocus = null;
      var back = want && overlayEl.querySelector(want); if (back) { back.focus(); if (os != null && back.setSelectionRange && !state.overlayFocus) try { back.setSelectionRange(os, os); } catch (e) { /* not a text field */ } }
    }
    if (state.overlay) {
      /* If focus was lost (the focused control disappeared), it goes to the dialog's close button rather than the page. */
      var c = overlayEl.querySelector('#lb-close, #rel-close, .help [data-act="close-overlay"]');
      if (c && !overlayEl.contains(document.activeElement)) c.focus();
      app.setAttribute('inert', ''); topEl.setAttribute('inert', '');
    } else { app.removeAttribute('inert'); topEl.removeAttribute('inert'); }
    sheet();
    announce();
    tick();
    lsSet('filter', state.filter);
  }
  var lastOverlay = '';
  /* On a phone the step panel covers the screen, so it behaves like a dialog: the rest is inert, focus moves into it, and
     closing returns focus to the step it came from. */
  var sheetWasOpen = false;
  function sheet() {
    var narrow = window.matchMedia && window.matchMedia('(max-width: 800px)').matches, ref = app.querySelector('.ref[data-open="true"]');
    var open = !!(narrow && ref && state.view === 'run');
    app.querySelectorAll('.run > .rail, .run > .deck, .runhead, .headline, .notice').forEach(function (el) { if (open) el.setAttribute('inert', ''); else el.removeAttribute('inert'); });
    if (open) { topEl.setAttribute('inert', ''); ref.setAttribute('role', 'dialog'); ref.setAttribute('aria-modal', 'true'); if (!sheetWasOpen || !ref.contains(document.activeElement)) { var c = ref.querySelector('.close'); if (c) c.focus(); } }
    else if (!state.overlay) topEl.removeAttribute('inert');
    if (sheetWasOpen && !open && state.sel) { var back = document.querySelector('[data-act="select"][data-id="' + cssEsc(state.sel) + '"]'); if (back) back.focus({ preventScroll: true }); }
    sheetWasOpen = open;
  }
  /* Messages are announced from one stable live region outside the redrawn screen, so screen readers hear each one once. */
  var said = '';
  function announce() {
    var t = state.msg ? state.msg.text : '', el = document.getElementById('live');
    if (el && t && t !== said) el.textContent = t;
    said = t;
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
    if (!ctx.recording(r) || r.paused || state.msg) return;
    var seen = state.reminded = state.reminded || {};
    R.schedule(r, R.mapOf(r), now).some(function (it) {
      var k = r.id + ':' + it.id + ':' + it.status;
      if (seen[k] || (it.status !== 'soon' && it.status !== 'late' && it.status !== 'started?')) return false;
      seen[k] = true;
      say((it.status === 'soon' ? 'Coming up at ' : it.status === 'late' ? 'Late (due ' : 'Was due to start at ') + U.hm(new Date(it.ms).toISOString()) + (it.status === 'late' ? ')' : '') + ': ' + it.title, it.status === 'soon' ? 'good' : 'warn');
      render(); return true;
    });
  }
  function tick() {
    var now = Date.now(), soonest = null;
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
    return queued(function () { return repo.saveRun(fs, r, SESSION, Object.assign({}, opts, { writer: WRITER, lock: LOCKS ? lock : null })); }).then(function () {
      settled();
      if (g !== gen) return true;
      /* Only the change this save carried is now safe; a newer one stays marked until its own save lands. */
      if (edits(r.id) === rev && (!state.unsaved[r.id] || state.unsaved[r.id] === r)) { delete state.unsaved[r.id]; delete state.saveErr[r.id]; if (state.saveOpts) delete state.saveOpts[r.id]; }
      render();
      return true;
    }, function (e) {
      settled();
      if (g !== gen) { lsSet(localKey(r.id, fs), r); return false; }
      if (e.disk) {
        if (state.unsaved[r.id] === r && edits(r.id) === rev) delete state.unsaved[r.id];
        if (!e.keptAs) lsSet(localKey(r.id), r);
        /* "Before" is this save's own revision: if the person changed anything after it, the newer change stays on screen. */
        var mineAt = {}; mineAt[r.id] = rev;
        return repo.loadRun(fs, r.process, r.id).then(function (fresh) {
          if (g !== gen) return false;
          var replaced = !!fresh && canReplace(r.id, mineAt);
          if (replaced) { bump(r.id); for (var i = 0; i < data.runs.length; i++) if (data.runs[i].id === r.id) data.runs[i] = fresh; }
          say(V.nameOf(ctx, e.disk.recorder.person) + ' saved this run from another window or computer, so your change wasn\'t written over theirs. ' +
            (replaced ? 'You\'re seeing their version. ' : 'Your newer change is still on screen and will be checked against theirs when it saves. ') +
            (e.keptAs ? 'Yours is kept as a conflict copy; compare it below and keep whichever is right.' : 'Your copy is kept in this browser.'), 'bad');
          render();
          return false;
        });
      }
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
    var child = R.create(pub, { title: pub.map.meta.title + ' for ' + parent.title, details: details, roles: roles, by: state.me, session: SESSION, now: new Date().toISOString(), tz: tz, workflows: data.jira.workflows, parent: { process: parent.process, id: parent.id, step: stepId, inputs: inputs } });
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
      var ed = editorOf(p.id); if (!ed || ed.conflict || dirty(ed) || !p.draft || (data.readSeq || 0) <= (ed.after || 0)) return;
      var h = U.hash(p.draft.md); if (h !== ed.baseHash) { ed.base = p.draft.md; ed.baseHash = h; ed.text = null; }
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
    if (state.draftSaving[sk]) { say('Still saving this draft. Try again in a moment.', 'warn'); render(); return; }
    state.draftSaving[sk] = opts.replace ? 'restore' : 'save';
    /* When it ends, the controls it disabled come back, also if someone left this folder and returned meanwhile. */
    var done = function () { delete state.draftSaving[sk]; if (fsKey() === key) scheduleRender(); };
    render();
    queued(function () { return repo.saveDraft(sfs, file, text, expectHash, { lock: LOCKS ? lock : null }); }).then(function (res) {
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
      if (!opts.replace && ed && ed.text != null && ed.text !== text) { ed.base = text; ed.baseHash = res.hash; ed.conflict = null; ed.seen = cachedHash(p.id); ed.after = readsStarted; }
      else setEditor({ pid: p.id, fsKey: key, base: text, baseHash: res.hash, text: null, seen: cachedHash(p.id), after: readsStarted });
      if (g !== gen) return;
      if (opts.replace && here) { state.mapVer = null; state.focus = 'cl-h'; }
      say(okMsg, 'good');
      return load(true);
    }, function (err) { done(); if (fsKey() !== key) return; say('Couldn\'t save the draft of ' + p.title + ': ' + err.message, 'bad'); render(); });
  }
  /* The step-type form's inputs → its state, read in one place so typing, choosing and saving all agree. */
  function readTypeForm() {
    var f = state.typeForm; if (!f) return;
    var v = function (id) { var el = document.getElementById(id); return el ? el.value : undefined; }, c = function (id) { var el = document.getElementById(id); return el ? !!el.checked : undefined; };
    var d = f.def;
    ['id', 'label', 'hint', 'icon'].forEach(function (k) { var x = v('tf-' + k); if (x !== undefined) d[k] = x; });
    d.fields.forEach(function (r) { ['name', 'label', 'kind', 'options'].forEach(function (k) { var x = v('tf-f-' + r.k + '-' + k); if (x !== undefined) r[k] = x; }); var q = c('tf-f-' + r.k + '-required'); if (q !== undefined) r.required = q; });
    d.record.forEach(function (r) { ['name', 'label', 'kind', 'options'].forEach(function (k) { var x = v('tf-r-' + r.k + '-' + k); if (x !== undefined) r[k] = x; }); var q = c('tf-r-' + r.k + '-long'); if (q !== undefined) r.long = q; });
  }
  var typeOpens = 0;
  function typeFormFor(def, existing, baseHash) { typeOpens++; return { fsKey: fsKey(), def: def, existing: existing, baseHash: baseHash, initial: V.typeFormSnapshot(def) }; }
  function typeFormChanged(f) { return V.typeFormSnapshot(f.def) !== f.initial; }
  function saveType() {
    var f = state.typeForm; if (!f) return;
    var def = V.typeDefOf(f.def), errs = V.typeErrors(f.def), sent = JSON.stringify(def), savedSnap = V.typeFormSnapshot(f.def);
    if (errs.length) { say(errs[0], 'warn'); render(); return; }
    if (!f.existing && (T.get(def.id) || ((data.stepTypes || {}).types || {})[def.id])) { say('There\'s already a step type {' + def.id + '}. Choose another ID, or edit that one.', 'warn'); render(); return; }
    var sfs = state.fs, g = gen;
    queued(function () { return repo.saveStepType(sfs, def, f.baseHash, { lock: LOCKS ? lock : null }); }).then(function (res) {
      /* The form is updated in its own folder even if someone switched folders meanwhile; only the screen waits. */
      var here = g === gen, open = typeForms[f.fsKey] === f;
      if (res.conflict) { f.conflict = res; if (here) render(); return; }
      /* Saved. If the form changed while it saved, it stays open on the saved version, with those changes still unsaved. */
      if (open && V.typeFormSnapshot(f.def) !== savedSnap) {
        /* If the ID was changed while it saved, the form now describes a different, unsaved type; keep it a new one. */
        var sameId = (f.def.id || '').trim() === def.id;
        f.existing = sameId ? def.id : null; f.baseHash = sameId ? res.hash : null; f.initial = sameId ? savedSnap : '';
        if (!here) return;
        say(sameId ? 'Saved {' + def.id + '}. Your later changes aren\'t saved yet.' : 'Saved {' + def.id + '}. The ID you changed it to isn\'t saved yet; save again to create it.', 'good');
        return load(true);
      }
      if (open) delete typeForms[f.fsKey];
      if (!here) return;
      if (open) state.focus = '[data-act="edit-type"][data-id="' + cssEsc(def.id) + '"]';
      say('Saved {' + def.id + '}. Checklists can use it now.', 'good');
      return load(true);
    }, function (err) { if (fsKey() !== f.fsKey) return; say('Couldn\'t save the step type {' + def.id + '}: ' + err.message, 'bad'); render(); });
  }
  function mutate(fn, opts) { return mutateRun(state.runKey, gen, fn, opts); }
  /* Change one run, named by its key, in the folder generation the action started in. An action that finishes after the
     person switched folders or runs does nothing, rather than landing on whatever is on screen now. */
  function mutateRun(key, g, fn, opts) {
    opts = opts || {};
    if (g !== gen) { say('That didn\'t happen: the folder changed while it was in progress.', 'warn'); render(); return Promise.resolve(false); }
    var r = null; for (var i = 0; i < data.runs.length; i++) if (data.runs[i].process + '/' + data.runs[i].id === key) r = data.runs[i];
    if (!r) return Promise.resolve(false);
    /* While a copy is being kept or restored, nothing else may change the run; the person is told to wait. */
    if (state.recovering && !opts.recovery) { say('Wait until the copy is kept, then try again.', 'warn'); render(); return Promise.resolve(false); }
    /* Recovery applies only to the exact contents it backed up: same object and same contents. */
    if (opts.expect && (r !== opts.expect || (opts.expectText && snapshot(r) !== opts.expectText))) { say('The run changed while the copy was being kept, so nothing was replaced. Compare again, then choose.', 'warn'); render(); return Promise.resolve(false); }
    var allowed = ctx.recording(r) || opts.any || (opts.recovery && ctx.canRecover(r));
    if (!allowed) { say('Only the recorder\'s window can change the run.', 'warn'); render(); return Promise.resolve(false); }
    var map = R.mapOf(r), recoveringEnded = !!(opts.recovery && r.ended);
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
    if (!opts.background) { state.pick = null; state.edit = null; state.fieldErr = null; state.fieldsDraft = null; }
    render(); return save(r, recoveringEnded ? Object.assign({}, opts, { takeover: true }) : opts);
  }

  /* ---------- navigation ---------- */
  function home() { releaseUrls(state.urls); state.view = 'home'; state.processId = null; state.runKey = null; resetRunUi(); }
  function resetRunUi() { state.fieldsDraft = null; state.copyView = null; state.sel = null; state.pick = null; state.edit = null; state.unfold = {}; state.pendingFiles = []; state.justPassed = null; state.msg = null; }
  function openRun(key) {
    if (key !== state.runKey) releaseUrls(state.urls);
    state.view = 'run'; state.runKey = key; resetRunUi();
    var r = ctx.run();
    if (r) { var nx = R.myNext(r, R.mapOf(r), state.me) || null; state.sel = nx ? nx.step.id : null; }
    state.refOpen = window.innerWidth > 1220;
    window.scrollTo(0, 0);
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    if (b.classList.contains('overlay') && e.target !== b) return;
    var act = b.dataset.act, id = b.dataset.id;
    var handler = ACTIONS[act];
    if (!handler) return;
    e.preventDefault();
    handler(id, b);
  });

  var ACTIONS = {
    home: function () { home(); render(); },
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
      if (pub.map.meta.owner && pub.map.meta.owner !== state.me) { say('Only the process owner, ' + V.nameOf(ctx, pub.map.meta.owner) + ', can sign off a version.', 'warn'); render(); return; }
      var ready = PF.skills.readiness(data.runs, pub, null), note = val('pick-input'), sfs = state.fs, sg = gen;
      if (!ready.enough) { say('Sign-off needs ' + ready.needed + ' clean completed runs of v' + pub.info.version + '.', 'warn'); render(); return; }
      queued(function () { return repo.recordValidation(sfs, pub, WRITER, state.me, note, { completed: ready.completed, clean: ready.clean, runs: ready.cleanRuns }); }).then(function () {
        if (sg !== gen) return; state.pick = null; say('Signed off v' + pub.info.version + ' as ready for a skill.', 'good'); return load(true);
      }, function (e) { if (sg !== gen) return; say('Couldn\'t save the sign-off: ' + e.message, 'bad'); render(); });
    },
    /* The brief an LLM needs to create a skill from a signed-off version, or to update one after the process changed. */
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
      copyText(text, document.getElementById('brief-pre'), 'Copied. Paste it to your LLM.');
    },
    'lib-tab': function (id) { state.libTab = id === 'skills' ? 'skills' : 'processes'; state.focus = '[data-act="lib-tab"][data-id="' + state.libTab + '"]'; render(); },
    tag: function (id) { var t = state.tags || []; state.tags = !id ? [] : t.indexOf(id) >= 0 ? t.filter(function (x) { return x !== id; }) : t.concat(id); state.focus = id ? '[data-act="tag"][data-id="' + cssEsc(id) + '"]' : null; render(); },
    'open-process': function (id) { state.view = 'process'; state.processId = id; state.diffOf = null; state.ptab = 'overview'; state.mapVer = null; resetRunUi(); render(); window.scrollTo(0, 0); },
    /* ---------- the sections ---------- */
    nav: function (id) {
      typeOpens++;
      if (id === 'home') { home(); state.focus = '[data-act="nav"][data-id="home"]'; render(); window.scrollTo(0, 0); return; }
      if (['runs', 'processes', 'skills', 'types', 'settings'].indexOf(id) < 0) return;
      releaseUrls(state.urls); state.view = id; state.processId = null; state.runKey = null; resetRunUi();
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
      if (id === 'edit') { var p = currentProcess(); if (p && state.draftSaving[edKey(p.id)] === 'restore') { state.ptab = 'overview'; say('Restoring the draft. You can edit it when that finishes.', 'warn'); render(); return; } if (p) openEditor(p); state.mapVer = null; }
      state.focus = id === 'edit' ? 'draft-editor' : id === 'insights' ? '[data-act="ptab"][data-id="overview"]' : 'cl-h';
      render(); window.scrollTo(0, 0);
    },
    'view-version': function (id) { state.ptab = 'overview'; state.mapVer = id; state.pick = null; state.focus = 'cl-h'; render(); window.scrollTo(0, 0); },
    'back-current': function () { state.mapVer = 'current'; state.pick = null; state.focus = 'map-ver'; render(); },
    'toggle-md': function () { state.showMd = !state.showMd; state.focus = '[data-act="toggle-md"]'; render(); },
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
      saveDraftText(p, v.md, expect, 'Restored v' + v.info.version + ' as the draft. Edit it, then publish a new version.', { replace: true });
    },
    /* Saving keeps you in the editor: focus goes back to the text, since the Save button is disabled while it saves. */
    'save-draft': function () { var p = currentProcess(); if (!p) return; var ed = openEditor(p); state.focus = 'draft-editor'; saveDraftText(p, ed.text != null ? ed.text : ed.base, ed.baseHash, 'Draft saved.'); },
    'revert-draft': function () { var p = currentProcess(); if (!p || stillSaving(p)) return; dropEditor(p.id); openEditor(p); state.planFormReset = true; render(); },
    /* The draft file disappeared while it had unsaved edits: write them back as a new draft. */
    'recover-draft': function () {
      var ed = editorOf(state.processId); if (!ed || ed.text == null) return;
      saveDraftText({ id: state.processId, title: state.processId, draft: null }, ed.text, null, 'Saved your draft again.');
    },
    'draft-keep-mine': function () { var p = currentProcess(), ed = p && editorOf(p.id); if (!p || !ed || !ed.conflict) return; saveDraftText(p, ed.text != null ? ed.text : ed.base, ed.conflict.theirsHash, 'Draft saved over the other change.'); },
    'draft-take-theirs': function () { var p = currentProcess(), ed = p && editorOf(p.id); if (!ed || !ed.conflict || stillSaving(p)) return; var t = ed.conflict.theirs || ''; setEditor({ pid: ed.pid, fsKey: ed.fsKey, text: null, base: t, baseHash: ed.conflict.theirsHash, seen: cachedHash(ed.pid), after: readsStarted }); state.planFormReset = true; render(); },
    'open-skill': function (id) { state.view = 'skill'; state.skillFile = id; state.brief = null; resetRunUi(); state.focus = 'page-h'; render(); window.scrollTo(0, 0); },
    'new-process': function () { state.view = 'new-process'; state.newProc = {}; resetRunUi(); render(); window.scrollTo(0, 0); },
    /* ---------- step types ---------- */
    'open-types': function () { ACTIONS.nav('types'); },
    'new-type': function () { state.view = 'types'; state.typeForm = typeFormFor({ id: '', label: '', hint: '', icon: 'check', fields: [{ k: V.nextRowKey(), name: '', label: '', kind: 'text' }], record: [] }, null, null); state.planFormReset = true; state.focus = 'tf-id'; render(); window.scrollTo(0, 0); },
    'copy-type': function (id) { var t = T.get(id); if (!t) return; state.view = 'types'; state.typeForm = typeFormFor(V.typeFormOf(t, false), null, null); state.planFormReset = true; state.focus = 'tf-id'; render(); window.scrollTo(0, 0); },
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
        state.view = 'types'; state.typeForm = typeFormFor(V.typeFormOf(T.customType(o), true), id, U.hash(f.text)); state.planFormReset = true; state.focus = 'tf-label'; render(); window.scrollTo(0, 0);
      }, function (e) { if (g !== gen || t !== typeOpens) return; say('Couldn\'t open step-types/' + id + '.json: ' + e.message, 'bad'); render(); });
    },
    'tf-add': function (id) { var d = state.typeForm && state.typeForm.def; if (!d) return; readTypeForm(); var row = { k: V.nextRowKey(), name: '', label: '', kind: 'text' }; (id === 'f' ? d.fields : d.record).push(row); state.focus = 'tf-' + id + '-' + row.k + '-name'; render(); },
    'tf-remove': function (id) {
      var d = state.typeForm && state.typeForm.def, parts = String(id).split(':'); if (!d) return;
      readTypeForm();
      var list = parts[0] === 'f' ? d.fields : d.record, i = list.map(function (r) { return r.k; }).indexOf(parts[1]);
      if (i < 0) return;
      list.splice(i, 1);
      /* Focus goes to the row that took its place, or the add button. */
      var next = list[i] || list[i - 1];
      state.focus = next ? 'tf-' + parts[0] + '-' + next.k + '-name' : '[data-act="tf-add"][data-id="' + parts[0] + '"]';
      render();
    },
    'type-cancel': function () { state.typeForm = null; render(); },
    'type-keep-mine': function () { var f = state.typeForm; if (f && f.conflict) { f.baseHash = f.conflict.theirsHash; f.conflict = null; saveType(); } },
    'type-take-theirs': function () {
      var f = state.typeForm; if (!f || !f.conflict) return;
      var o = null; try { o = JSON.parse(f.conflict.theirs || 'null'); } catch (e) { o = null; }
      if (!o || T.checkCustom(o).length) { say('Their version can\'t be used as a step type' + (f.conflict.theirs == null ? ' (the file was deleted)' : '') + '. Keep yours, or cancel.', 'warn'); render(); return; }
      f.def = V.typeFormOf(T.customType(o), true); f.baseHash = f.conflict.theirsHash; f.initial = V.typeFormSnapshot(f.def); f.conflict = null; state.planFormReset = true; render();
    },
    'open-run': function (id) { openRun(id); render(); },
    'review-plan': function (id) { var p = data.plans.filter(function (x) { return x.id === id; })[0]; if (!p) return; state.view = 'start'; state.processId = p.process; state.planId = id; render(); window.scrollTo(0, 0); },
    start: function (id) { state.view = 'start'; state.processId = id; state.planId = null; render(); window.scrollTo(0, 0); },
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
          return repo.publish(pfs, f.text, { people: people, customTypes: got[1].types, workflows: wfs, processes: pids, by: by, changes: note, existing: p.all.map(function (x) { return x.info; }), now: new Date().toISOString() });
        });
      }).then(function (res) {
        if (pg !== gen) return;
        if (res.changed) { say('The draft changed since this page was drawn, so nothing was published. Here is the newest draft: check it, then publish.', 'warn'); return load(true); }
        if (res.blockers) { say(res.blockers[0], 'warn'); render(); return; }
        state.clearInputs = 'change-note'; say('Published v' + res.version + '. New runs use it; runs already started keep their version.', 'good');
        return load(true);
      }, function (e) { if (pg !== gen) return; say('Couldn\'t publish: ' + e.message, 'bad'); render(); });
    },
    toggle: function (id) {
      var r = ctx.run(), x = r && M.findStep(R.mapOf(r), id), a = r && r.steps[id];
      var need = x && R.evidenceFor(r, x.step).list.filter(function (d) { return d.required && !(a && a.s !== 'recheck' && a.values && a.values[d.name]); });
      if (x && !(a && a.s === 'done') && need.length) {
        state.pick = { kind: 'record', id: id }; state.sel = id; state.focus = 'rec-' + need[0].name; render(); return;
      }
      mutate(function (r, map, me, now) { if (a && a.s === 'done') R.clear(r, map, id, me, now); else R.done(r, map, id, me, now); });
    },
    'save-fields': function (id) {
      var r = ctx.run(), x = M.findStep(R.mapOf(r), id), t = T.get(x.step.type, r.types), fields = {}, values = {};
      T.editable(t).forEach(function (f) { var el = document.getElementById('fld-' + f); if (el) fields[f] = el.value; });
      /* Evidence is collected and checked against the fields as they'll be after this save, not as they were. */
      var merged = Object.assign({}, R.fieldsOf(r, x.step), fields);
      R.evidenceFor(r, x.step, merged).list.forEach(function (d) { var el = document.getElementById('rec-' + d.name); if (el) values[d.name] = el.value; });
      var chk = R.checkEvidence(r, x.step, merged, values, true);
      if (chk.error) { state.fieldErr = { id: id, msg: chk.error, field: chk.field ? 'rec-' + chk.field : '' }; state.focus = chk.field ? '#rec-' + chk.field : '[aria-invalid="true"]'; render(); return; }
      state.fieldErr = null;
      mutate(function (r, map, me, now) { R.setFields(r, map, id, fields, values, me, now); }, { fieldsFor: id });
    },
    record: function (id) {
      var r = ctx.run(), x = M.findStep(R.mapOf(r), id), values = {};
      R.evidenceFor(r, x.step).list.forEach(function (d) { values[d.name] = val('rec-' + d.name); });
      var chk = R.checkEvidence(r, x.step, null, Object.assign({}, (r.steps[id] || {}).values || {}, values));
      if (chk.error) { state.fieldErr = { id: id, msg: chk.error, field: chk.field ? 'rec-' + chk.field : '' }; state.focus = chk.field ? '#rec-' + chk.field : '[aria-invalid="true"]'; render(); return; }
      state.fieldErr = null;
      mutate(function (r, map, me, now) { R.done(r, map, id, me, now, values); });
    },
    pause: function () { var why = val('pick-input'); if (!why.trim()) { say('Say why the run is paused, so others know what it\'s waiting for.', 'warn'); render(); return; } state.pick = null; mutate(function (r, map, me, now) { R.pause(r, why, me, now); }); },
    resume: function () { mutate(function (r, map, me, now) { R.resume(r, me, now); }); },
    'start-child': function (id) { startChild(id); },
    /* A child run that was saved but whose link didn't land (the parent changed meanwhile): link it now, with the inputs it was started for. */
    'link-child': function (id, b) {
      var c = ctx.findRun(b.dataset.child);
      if (!c || !c.parent) return;
      mutate(function (r, map, me, now) { R.linkChild(r, map, id, { process: c.process, id: c.id, inputs: c.parent.inputs }, me, now); });
    },
    timeline: function () { state.timeline = !state.timeline; state.overlayFocus = null; state.focus = '[data-act="timeline"]'; render(); },
    'start-step': function (id) { mutate(function (r, map, me, now) { R.start(r, map, id, me, now); }); },
    na: function (id) { mutate(function (r, map, me, now) { R.na(r, map, id, me, now); }); },
    clear: function (id) { mutate(function (r, map, me, now) { R.clear(r, map, id, me, now); }); },
    pick: function (id, b) { state.pick = { kind: b.dataset.kind, id: id }; state.fieldsDraft = null; if (b.dataset.kind === 'block' || b.dataset.kind === 'differently' || b.dataset.kind === 'deadline' || b.dataset.kind === 'fields') state.sel = id; render(); },
    unpick: function () { state.pick = null; state.fieldErr = null; state.fieldsDraft = null; render(); },
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
    pickup: function () { fresh().then(function (t) { if (t) mutateRun(t.key, t.g, function (r, map, me, now) { R.pickUp(r, me, SESSION, now); }, { any: true }); }); },
    takeover: function () { fresh().then(function (t) { if (t) mutateRun(t.key, t.g, function (r, map, me, now) { R.takeOver(r, me, SESSION, now); }, { any: true, takeover: true }); }); },
    /* The receipt opens only once the ending is really in the team folder; a failed save keeps you here with Try again. */
    end: function (id) { var g = gen, key = state.runKey; mutate(function (r, map, me, now) { R.end(r, map, id, me, V.nameOf(ctx, me), now); }).then(function (ok) { if (ok && g === gen && state.runKey === key && ctx.run() && ctx.run().ended) { state.view = 'receipt'; render(); window.scrollTo(0, 0); } }); },
    /* Finishing: outcome, follow-ups and suggested map changes, then the receipt. */
    finish: function () { state.view = 'finish'; state.pick = null; render(); window.scrollTo(0, 0); },
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
    'use-copy': function (name) { recover(function (fs, cur) { return repo.readCopy(fs, cur, name); }, 'The version it replaced is kept as ', function (fs, cur) { return repo.removeCopy(fs, Object.assign({}, cur, { _conflicts: null }), name); }); },
    'delete-copy': function (name) {
      var r = ctx.run(); if (!r) return;
      if (!(state.pick && state.pick.kind === 'delete-copy' && state.pick.id === name)) { state.pick = { kind: 'delete-copy', id: name }; render(); return; }
      var g = gen, key = state.runKey;
      repo.removeCopy(state.fs, r, name).then(function () { if (g !== gen) return; if (state.runKey === key) { if (state.pick && state.pick.kind === 'delete-copy' && state.pick.id === name) state.pick = null; if (state.copyView && state.copyView.name === name) state.copyView = null; } say('Conflict copy deleted.', 'good'); return refreshRun(); }, function (e) { if (g === gen) { say('Couldn\'t delete it: ' + e.message, 'bad'); render(); } });
    },
    'restore-local': function () {
      var r = ctx.run(); if (!r) return;
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
    'new-folder': function () { newFolder(); },
    select: function (id) { selectStep(id); state.refOpen = true; render(); },
    'close-ref': function () { state.refOpen = false; render(); },
    unfold: function (id) { state.unfold[id] = true; render(); },
    goto: function (id) { var el = document.getElementById(id); if (!el) { var r = ctx.run(); if (r) { R.mapOf(r).phases.forEach(function (p) { state.unfold[p.id] = true; }); render(); el = document.getElementById(id); } } if (el) { el.scrollIntoView({ block: 'center' }); var f = el.querySelector('h2, .check, button'); if (f) f.focus({ preventScroll: true }); } },
    'retry-save': function () { var cur = ctx.run(), r = cur && state.unsaved[cur.id], g = gen, key = state.runKey; if (r) save(r, (state.saveOpts || {})[r.id]).then(function (ok) { if (ok && g === gen && state.runKey === key && r.ended && state.view === 'finish') { state.view = 'receipt'; render(); } }); },
    'discard-unsaved': function () { var r = ctx.run(); if (!r) return; delete state.unsaved[r.id]; delete state.saveErr[r.id]; if (state.saveOpts) delete state.saveOpts[r.id]; say('Your unsaved change was discarded.'); load(true); },
    'add-note': function (id) {
      var r = ctx.run(), text = val('note-text').trim(), nkey = state.runKey, mine = attachmentsFor(nkey, id), files = mine.map(function (p) { return p.file; });
      var who = state.me, nfs = state.fs, ng = gen, asMap = !!(document.getElementById('note-map') || {}).checked;
      if (!r || !who || (!text && !files.length)) return;
      /* A note that's too long is refused, not cut short; the draft stays so it can be shortened or split. */
      if (text.length > NOTE_MAX) { state.fieldErr = { id: 'note:' + id, msg: 'Notes can be up to 2,000 characters; this one is ' + text.length.toLocaleString('en-US') + '. Shorten it, or split it into two notes.', field: 'note-text' }; state.focus = '#note-text'; render(); return; }
      state.fieldErr = null;
      var endBusy = busyStart();
      queued(function () {
        return files.reduce(function (pr, f) { return pr.then(function (acc) { return repo.saveAttachment(nfs, r, f, WRITER).then(function (p) { return acc.concat([p]); }); }); }, Promise.resolve([])).then(function (paths) {
          var note = { id: U.randomId(10), at: new Date().toISOString(), by: who, session: WRITER, step: id, text: text, files: paths };
          if (asMap) note.kind = 'map';
          return repo.addNote(nfs, r, WRITER, note);
        });
      }).then(function () {
        endBusy(); if (ng !== gen) return;
        /* Only the submitted note's draft is cleared: another step's draft and attachments stay. */
        state.pendingFiles = state.pendingFiles.filter(function (p) { return mine.indexOf(p) < 0; });
        /* The box is cleared only if it still holds exactly what was sent, on the same run and step; anything typed since stays. */
        if (state.runKey === nkey && state.sel === id && val('note-text').trim() === text) state.clearInputs = 'note-text';
        return refreshRun();
      }, function (e) { endBusy(); if (ng !== gen) return; say('Couldn\'t add the note: ' + e.message, 'bad'); render(); });
    },
    'just-me': function () { app.querySelectorAll('#start-form [data-role]').forEach(function (el) { el.value = state.me; }); },
    copy: function (id, b) { copyText(b.dataset.text, null); },
    mission: function () { state.view = 'mission'; render(); window.scrollTo(0, 0); },
    receipt: function () { state.view = 'receipt'; render(); window.scrollTo(0, 0); },
    'exit-mission': function () { state.view = 'run'; render(); },
    'copy-receipt': function () { var pre = document.getElementById('receipt-text'); copyText(pre ? pre.textContent : '', pre); },
    zoom: function (id, b) { var r = ctx.run(), x = r && M.findStep(R.mapOf(r), id); if (!x) return; openLightbox(x.step.shots.map(function (s) { return { src: s.src, caption: s.caption }; }), +b.dataset.i); },
    'zoom-note': function (id, b) { var r = ctx.run(), n = r && (r._notes || []).filter(function (x) { return x.id === id; })[0]; if (!n) return; openLightbox(n.files.map(function (f, i) { return { src: f, caption: 'Attachment ' + (i + 1) + ' from ' + V.nameOf(ctx, n.by) }; }), +b.dataset.i); },
    'lb-step': function (d) { if (state.overlay && state.overlay.list) { var L = state.overlay.list.length; state.overlay.i = (state.overlay.i + (+d) + L) % L; render(); } },
    'close-overlay': function () { closeOverlay(); }
  };
  /* Reread the open run before taking over recording. Resolves to the run's key and generation, or null if the folder changed. */
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
    var r = ctx.run(), g = gen, fs = state.fs, revs = revsNow(); if (!r) return Promise.resolve(null);
    var key = r.process + '/' + r.id;
    return repo.loadRun(fs, r.process, r.id).then(function (f) {
      if (g !== gen) return null;
      if (f && canReplace(r.id, revs)) { if (f._fileHash !== r._fileHash) bump(r.id); for (var i = 0; i < data.runs.length; i++) if (data.runs[i].process + '/' + data.runs[i].id === key) data.runs[i] = f; }
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
      return load(true).then(function () { if (g !== gen) return; if (state.view !== 'new-process' || state.newProc !== f) { say('Created the draft for "' + f.title + '". Open it from Processes.', 'good'); render(); return; } state.view = 'process'; state.processId = f.id; state.ptab = 'edit'; dropEditor(f.id); var np = currentProcess(); if (np) openEditor(np); state.newProc = null; say('Draft created. Fill in the steps, choose Done, then publish it.', 'good'); state.focus = 'draft-editor'; render(); window.scrollTo(0, 0); });
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
    if (val('start-mode') === 'solo') p.latest.map.meta.roles.forEach(function (ro) { roles[ro] = state.me; });
    var plan = state.planId && data.plans.filter(function (x) { return x.id === state.planId; })[0];
    /* Start exactly what was reviewed: the same published version and, for a plan, the same plan content. */
    if (e.target.dataset.folder !== p.latest.info.folder) { say('A new version was published while you were filling this in. Check the form, then start again.', 'warn'); render(); return; }
    /* Decisions on the plan started to disagree after this form was drawn: show the warning before anything starts. */
    if (plan && plan._conflicting && e.target.dataset.planConflict !== '1') { say('Someone decided on this plan while you were filling this in, and the decisions disagree. Check Runs, then start again if it still needs to run.', 'warn'); render(); return; }
    if (plan && e.target.dataset.planHash !== plan._hash) { say('Someone changed this plan while you were reviewing it. The form now shows the new plan; check it, then start again.', 'warn'); state.planFormReset = true; render(); return; }
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (err) { tz = ''; }
    var r = R.create(p.latest, { title: val('run-title') || p.title, details: details, roles: roles, by: state.me, session: SESSION, now: new Date().toISOString(), tz: tz, workflows: data.jira.workflows });
    var endBusy = busyStart();
    var sfs = state.fs, sg = gen, who = state.me;
    /* The write queue waits for this window's identity check, so the recorder is set to the confirmed identity. */
    queued(function () { r.recorder.session = SESSION; return repo.saveRun(sfs, r, SESSION, { writer: WRITER, lock: LOCKS ? lock : null }); }).then(function () {
      return plan ? repo.recordPlanStatus(sfs, plan, WRITER, 'accepted', r.id, who) : null;
    }).then(function () { endBusy(); if (sg !== gen) return; state.planId = null; return load(true); }).then(function () { if (sg !== gen) return; openRun(r.process + '/' + r.id); say(R.solo(r) ? 'Run started.' : 'Run started. You\'re recording.', 'good'); render(); },
      function (err) { endBusy(); if (sg !== gen) return; say('Couldn\'t start the run: ' + err.message, 'bad'); render(); });
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'rel-search') { state.rel.q = e.target.value; render(); }
    /* The draft editor checks and previews as you type (redrawn at most every 250 ms; the editor itself is never replaced). */
    if (e.target.id === 'draft-editor') {
      var p = currentProcess(); if (!p) return;
      openEditor(p).text = e.target.value; scheduleRender();
    }
    if (/^tf-/.test(e.target.id || '') && state.typeForm) { readTypeForm(); scheduleRender(); }
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
    if (/^tf-/.test(e.target.id || '') && state.typeForm) { readTypeForm(); render(); }
    if (e.target.id === 'me') { state.me = e.target.value.trim().slice(0, 60); lsSet('me', state.me); render(); }
    /* In Fill in, changing a choice (like a Jira action) redraws the form so the fields that choice needs appear. */
    if (/^fld-/.test(e.target.id || '') && state.pick && state.pick.kind === 'fields') {
      var vals = {}; document.querySelectorAll('[id^="fld-"]').forEach(function (el) { vals[el.id.slice(4)] = el.value; });
      vals[e.target.id.slice(4)] = e.target.value;
      state.fieldsDraft = { id: state.pick.id, values: vals }; render();
    }
    if (e.target.id === 'note-file') { addPending(e.target.files && e.target.files[0]); e.target.value = ''; }
  });
  function addPending(f) {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { say('Use a PNG, JPEG or WebP image.', 'warn'); render(); return; }
    if (f.size > 3 * 1024 * 1024) { say('That image is over 3 MB. Crop it to the part that matters.', 'warn'); render(); return; }
    /* An attachment belongs to the run and step it was added on, whichever way the person moves around afterwards. */
    state.pendingFiles.push({ key: state.runKey, step: state.sel, file: f }); render();
  }
  function attachmentsFor(key, step) { return state.pendingFiles.filter(function (p) { return p.key === key && p.step === step; }); }
  /* One way to select a step, for the mouse and the keyboard alike. */
  function selectStep(id) { state.sel = id; if (state.pick && state.pick.id !== id) state.pick = null; }
  var NOTE_MAX = 2000;
  document.addEventListener('paste', function (e) {
    if (state.view !== 'run' || !state.sel || !state.me || !e.clipboardData) return;
    var items = e.clipboardData.items || [];
    for (var i = 0; i < items.length; i++) if (items[i].type.indexOf('image/') === 0) { addPending(items[i].getAsFile()); e.preventDefault(); return; }
  });

  document.addEventListener('keydown', function (e) {
    var t = e.target, typing = t && /INPUT|TEXTAREA|SELECT/.test(t.tagName);
    if (e.key === 'Escape') { if (state.overlay) { closeOverlay(); return; } if (sheetWasOpen) { state.refOpen = false; render(); return; } if (state.pick || state.edit) { state.pick = null; state.edit = null; render(); return; } if (state.view === 'mission' || state.view === 'receipt') { state.view = 'run'; render(); } return; }
    if (state.overlay && state.overlay.list && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { ACTIONS['lb-step'](e.key === 'ArrowLeft' ? '-1' : '1'); return; }
    if (typing && e.key === 'Enter' && t.dataset.enter) {
      e.preventDefault();
      var act = t.dataset.enter;
      if (act === 'save-edit') ACTIONS['save-edit'](); else if (act === 'block') ACTIONS.block(t.dataset.id, t); else if (ACTIONS[act]) ACTIONS[act](t.dataset.id, t);
      return;
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
    if (e.key === 'j' || e.key === 'k') { e.preventDefault(); selectStep(all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'j' ? 1 : -1)))] || all[0]); render(); var el = document.getElementById('step-' + state.sel); if (el) el.scrollIntoView({ block: 'nearest' }); return; }
    if (e.key === ' ' && state.sel) { e.preventDefault(); ACTIONS.toggle(state.sel); return; }
    if (e.key === 'b' && state.sel) { state.pick = { kind: 'block', id: state.sel }; render(); return; }
    if (e.key === 'n' && state.sel) { state.refOpen = true; render(); var nt = document.getElementById('note-text'); if (nt) { e.preventDefault(); nt.focus(); } return; }
    if (e.key === 'm') { state.view = state.view === 'mission' ? 'run' : 'mission'; render(); }
  });

  render();
  boot().then(announceRelease, announceRelease);
})();
