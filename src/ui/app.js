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
  /* Editor sidebar widths this viewer chose (V.PANES): kept in this browser only, never in the team folder. */
  function panesKept() { var v = lsGet('panes', {}), out = {}; if (v && typeof v === 'object') Object.keys(PF.views.PANES).forEach(function (k) { if (typeof v[k] === 'number' && isFinite(v[k])) out[k] = Math.round(v[k]); }); return out; }
  /* Which flight plan phases show their steps, per process (views/flight.js): kept in this browser only. Read, never
     trusted: only a process id, Show all or Hide all (d) and phase numbers (p) with true or false are kept. */
  var FP_MAX = 200;
  function fpStepsKept() {
    var v = lsGet('fpSteps', {}), out = Object.create(null);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    Object.keys(v).slice(0, FP_MAX).forEach(function (k) {
      var x = v[k], o = {};
      if (!/^[\w.-]{1,100}$/.test(k) || k === '__proto__' || !x || typeof x !== 'object') return;
      if (typeof x.d === 'boolean') o.d = x.d;
      if (x.p && typeof x.p === 'object') Object.keys(x.p).forEach(function (i) { if (/^\d{1,3}$/.test(i) && typeof x.p[i] === 'boolean') (o.p = o.p || {})[i] = x.p[i]; });
      out[k] = o;
    });
    return out;
  }
  function fpStepsKeep(pid, o) {
    var all = state.fpSteps = state.fpSteps || Object.create(null);
    delete all[pid]; all[pid] = o;
    var ks = Object.keys(all); if (ks.length > FP_MAX) delete all[ks[0]];
    var plain = Object.create(null); Object.keys(all).forEach(function (k) { plain[k] = all[k]; });
    lsSet('fpSteps', plain);
  }
  /* Home acknowledgments this viewer dismissed in this folder: only keys of the form PF.corrections.acks makes are kept. */
  var ACK_KEY = /^[ld]\.[a-z0-9][a-z0-9-]{0,59}\.[\w-]{1,60}(\.\d{1,9})?$/, ACK_MAX = 300;
  function acksDismissed() { var v = lsGet('acks:' + fsKey(), []); return Array.isArray(v) ? v.filter(function (k) { return typeof k === 'string' && ACK_KEY.test(k); }).slice(-ACK_MAX) : []; }
  /* One writer per browser window: a session ID that survives a reload of the same tab. A duplicated tab inherits a copy of
     that ID, so each window announces its ID when it opens; if a live window already uses it, the newcomer takes a fresh one.
     A reload is safe: the old page is gone, so nothing answers. Writes wait until this check is done, at most 300 ms; on a slow
     machine the answer can come later than that, and it still counts. */
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
    var chan, nonce = U.randomId(8);
    try { chan = new BroadcastChannel(LS + ':windows'); } catch (e) { return Promise.resolve(); }
    return new Promise(function (res) {
      chan.onmessage = function (e) {
        var m = e.data || {};
        if (m.ask === SESSION && m.nonce !== nonce) chan.postMessage({ taken: SESSION, nonce: m.nonce });
        if (m.taken === SESSION && m.nonce === nonce) {
          SESSION = U.randomId(10);
          try { sessionStorage.setItem(LS + ':session', SESSION); } catch (err) { /* this window keeps the new ID in memory */ }
          res(); if (typeof render === 'function') render();
        }
      };
      chan.postMessage({ ask: SESSION, nonce: nonce });
      setTimeout(res, 300);
    });
  })();

  var state = {
    view: 'home', fs: null, me: lsGet('me', ''), filter: lsGet('filter', 'mine'), processId: null, planId: null, runKey: null,
    sel: null, refOpen: true, pick: null, edit: null, unfold: Object.create(null), diffOf: null, msg: null, justPassed: null,
    pendingFiles: [], pendingStarts: Object.create(null), urls: {}, full: {}, needsReconnect: null, overlay: null, busy: false,
    rel: { q: '', kind: '', area: '', sel: 0, detail: false }, newer: null,
    folderErr: null, deviceName: lsGet('device-name', ''), keys: lsGet('keys', true), theme: lsGet('theme', 'system'), builder: lsGet('builder', true), insTabSaved: lsGet('insTab', ''), partsRail: lsGet('partsRail', false), renamed: lsGet('renamed-checklists', false), panes: panesKept(), fpSteps: fpStepsKept(), paneFit: {}, fieldErr: null, startMode: Object.create(null), startModeAt: Object.create(null), obMore: lsGet('obMore', false), obGroups: null, showRoles: false, lookAround: lsGet('look-around', !!lsGet('me', '')), copyView: null, archive: {}, stepDrafts: {}, partial: {}, answering: null
  };
  /* Keyed by run or checklist IDs from the folder, which can be names every plain object has (constructor): these never have a
     prototype, whatever a folder switch sets them to. */
  ['unsaved', 'saveErr', 'saveOpts', 'pendingSaves', 'insFolder'].forEach(function (k) {
    var v = Object.create(null);
    Object.defineProperty(state, k, { enumerable: true, get: function () { return v; }, set: function (x) { v = Object.setPrototypeOf(x, null); } });
  });
  /* A step-type form belongs to its folder: switching folders and back finds it again, and another folder's form never
     replaces it. */
  var typeForms = {};
  Object.defineProperty(state, 'typeForm', { enumerable: true,
    get: function () { return typeForms[fsKey()] || null; },
    set: function (v) { if ((v || null) !== (typeForms[fsKey()] || null)) navSeq++; if (v) typeForms[fsKey()] = v; else delete typeForms[fsKey()]; } });
  /* Back and Forward (docs/design.md section 29): every field the location is built from bumps navSeq when it changes, so a
     person's move makes a new history entry and anything else (a folder read, typing) replaces at most. */
  var navSeq = 0;
  ['view', 'processId', 'runKey', 'ptab', 'mapVer', 'planId', 'skillFile', 'recoveryAt', 'testStage'].forEach(function (name) {
    var v = state[name];
    Object.defineProperty(state, name, { enumerable: true, get: function () { return v; }, set: function (x) { if (x !== v) navSeq++; v = x; } });
  });
  var HIST = (function () { try { return typeof history !== 'undefined' && history && typeof history.replaceState === 'function' && typeof location !== 'undefined' ? history : null; } catch (e) { return null; } })();
  var H = { on: !!HIST, pos: 0, cur: { n: 0, hash: '#/', f: null }, seen: 0, queued: false, restoring: null, pending: null, hold: null, mode: null, loadedGen: -1, bootLink: false, retry: null, retryLoc: null };
  applyTheme();
  /* Runs by key (2.5.0): one look, not a scan of every run (PF.util.keyIndex). */
  var runIdx = U.keyIndex(function (r) { return r.process + '/' + r.id; }, 'runs');
  var data = { people: [], drafts: [], processes: [], runs: [], legacy: [], skills: [], plans: [], stepTypes: { types: {}, errors: [] }, jira: { workflows: {}, errors: [] }, proposed: { procs: {} }, presence: [], readAt: new Date().toISOString() };
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
    /* Built once per draw (2.5.0), not once per name shown; the last row for an ID wins, as it always has here. */
    get peopleById() {
      var ps = data.people;
      if (PF.perf.plain) { var all = Object.create(null); ps.forEach(function (p) { all[p.id] = p; }); return all; }
      if (!pplBy || pplBy.list !== ps || pplBy.len !== ps.length) { var o = Object.create(null); ps.forEach(function (p) { o[p.id] = p; }); pplBy = { list: ps, len: ps.length, by: o }; }
      return pplBy.by;
    },
    /* Everyone in name order (2.11), sorted once per draw for every picker on it; views filter it, never change it. */
    peopleSorted: function () {
      var ps = data.people;
      if (!pplSorted || pplSorted.list !== ps || pplSorted.len !== ps.length) pplSorted = { list: ps, len: ps.length, out: PF.people.byName(ps) };
      return pplSorted.out;
    },
    run: function () { return findRun(state.runKey); },
    /* The runs a sign-off counts: every run shown, less those whose latest read failed or whose file is gone (their last copy
       stays on screen, but isn't what the folder holds), and none while the runs folder can't be read. */
    countedRuns: countedRuns,
    recording: function (r) { return !!r && !!state.me && !r.ended && !r._unrunnable && r.recorder.person === state.me && r.recorder.session === SESSION; },
    /* Who may resolve conflict copies: the recorder's window while it runs; once it has ended, whoever recorded or ended it. */
    canRecover: function (r) { return !!r && !!state.me && !r._unrunnable && (ctx.recording(r) || (!!r.ended && (r.recorder.person === state.me || r.ended.by === state.me))); },
    processTitle: function (id) { var p = procFind(id); return p ? p.title : id; },
    processes: function () { return processes(); },
    /* The first time, with only the examples to show, Home is the welcome: Start your team, Join, or Look around. */
    welcome: function () { return state.view === 'home' && !!state.fs && state.fs.kind === 'memory' && !state.needsReconnect && !state.lookAround; },
    get fsKey() { return fsKey(); },
    /* A link waiting for the folder (Home says Reconnect opens it). */
    navPending: function () { return !!H.pending; },
    orphanSkills: function () { processes(); return orphanSkills; },
    /* Unsaved edits to a draft that was removed from this folder, so they stay findable. */
    lostDrafts: function () { var k = fsKey() + '\n', ids = processes().map(function (x) { return x.id; }); return Object.keys(state.editors || {}).filter(function (e) { var ed = state.editors[e]; return e.indexOf(k) === 0 && ed.text != null && ids.indexOf(ed.pid) < 0; }).map(function (e) { return state.editors[e].pid; }); },
    findRun: function (key) { return findRun(key); },
    procOf: function (id) { return procFind(id); },
    /* What other files say about renaming a run detail of this checklist (PF.refs.dependents): the folder's other checklists
       (latest published version and saved draft), the children this one runs, and the Jira workflows. */
    renameDeps: function (map, name) { return renameDeps(map, name); },
    latestPub: function (id) { var p = procFind(id); return p ? p.latest : null; },
    suggestRole: suggestRole,
    /* What each role of the Start, Plan or test-run form being drawn held at the last redraw, as 2.10's selects carry it
       (roleBoxes in process.js, code review round 16). */
    roleCarry: function (scope) { return roleCarry(scope); },
    attachments: function (key, step) { return attachmentsFor(key, step); },
    /* What was typed on a step of the open run and not used yet: evidence, Fill in values, a note. */
    stepDraft: function (id) { return draftOf(state.runKey, id, false); },
    /* Corrections on a process, grouped, with where each group stands, worked out once per redraw like processes(). */
    /* What Home acknowledges for this person: corrections of theirs that were published or declined, less what they dismissed. */
    acks: function () {
      var since = new Date(Date.now() - 30 * 86400000).toISOString(), gone = acksDismissed(), out = [];
      processes().forEach(function (p) { PF.corrections.acks(ctx.corrections(p.id), state.me, since).forEach(function (a) { if (gone.indexOf(a.key) < 0) out.push(a); }); });
      return out;
    },
    /* Every follow-up with what became of it (PF.followups), worked out once per redraw. */
    followUps: function () { return fuMemo || (fuMemo = PF.followups.list(data.runs, data.fuDecisions || [])); },
    /* Insights (views/insights.js) worked out once per redraw, like the follow-ups. */
    get insightsMemo() { return insMemo; },
    /* Reports on a run (PF.reports): read for the run that's open, with where each stands. */
    reports: function (r) { return reportsOf(r); },
    reportCur: function () { return repCur(); },
    repDraft: function (key) { return repDraft(key); },
    repGone: function (r, stepId) { return repGone(r, stepId); },
    /* Runs this person records, with how many reports on each nobody has decided yet (Home). */
    reportsWaiting: function () { return reportsWaiting(); },
    corrections: function (pid) {
      if (!fixMemo[pid]) { var proc = procFind(pid); fixMemo[pid] = PF.corrections.forProcess(procRuns(pid), pid, data.corrDecisions, proc); }
      return fixMemo[pid];
    },
    /* The release history and what this person has seen of it (for "New for you" and the dot on What's new). */
    get releases() { var seen = state.relShownSeen || relSeen(); return { list: RELEASES, version: APP_VERSION, lastSeen: seen, fresh: APP_VERSION !== 'dev' && V.semverCmp(APP_VERSION, relSeen()) > 0, newer: state.newer }; },
    /* How many images this window is adding to a draft's step right now (the builder's Screenshots section says so). */
    shotBusy: function (pid) { return shotBusy(pid); },
    localCopy: function (r) { var c = lsGet(localKey(r.id), null); return c && c.id === r.id ? c : null; },
    /* Folder health from what's loaded (full: with this folder's last scan of every file). Worked out once per change. */
    health: function (full) { return healthReport(full); },
    recovery: RECOVERY, writer: WRITER,
    /* The search palette's state: the query and results (state.sx), whether the index is still being built, how many run
       files couldn't be read, and when the folder was last read. */
    search: function () {
      var u = Object.keys((state.unread || {}).runs || {}).length + Object.keys(state.missing || {}).length;
      /* Still reading: the folder's first read (how many runs of how many), else the index's first build. */
      var building = state.reading ? { done: state.reading.done || 0, total: state.reading.total } : sx.job && !sx.built ? sx.job.runs : null;
      return { building: building, unread: u, readAt: state.runReadAt && state.runReadAt > data.readAt ? state.runReadAt : data.readAt, err: state.sx ? state.sx.err : '' };
    },
    mac: /Mac|iPhone|iPad/.test((typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || ''),
    /* Getting started, worked out from the folder (PF.setup.progress); setupCard is null when Home shouldn't show it. */
    setupProgress: function () { return setupProgress(); },
    setupCard: function () { return setupShown() ? setupProgress() : null; },
    setupTemplate: function (id) { return setupTemplate(id); },
    device: function () { return PF.connection.device(navigator.userAgent, state.deviceName); },
    /* Connection checks from other windows that this one hasn't answered or put off. */
    connPending: function () { return state.conn ? PF.connection.pending(state.conn, WRITER, state.connDismissed).filter(function (p) { return !(state.connAnswering || {})[p._file]; }) : []; },
    /* Thumbnails are small copies made once per image; the full image is loaded only in the lightbox and released when it closes. */
    /* own: the folder's images/ file itself, as the draft builder shows it, never a run's frozen copy. */
    img: function (src, caption, full, own) {
      /* A run shows the screenshots frozen into its own publication. Only publications made before screenshots were frozen fall back to images/. */
      var r = own ? null : ctx.run(), paths = [src], key = src;
      if (r && /^images\//.test(src)) {
        /* The run itself records whether its publication froze screenshots, so a publication that's still syncing shows
           "Missing", never today's images/ file. Only runs of older publications fall back to images/. */
        var own = R.pubDir(r) + src;
        var legacy = !r.shotsFrozen && legacyPub(r);
        paths = legacy ? [own, src] : [own]; key = r.process + '/' + r.folder + '|' + src + (legacy ? '|legacy' : '');
      }
      var cache = full ? state.full : state.urls;
      /* A thumbnail waits until it scrolls into view (one shared IntersectionObserver), so a long page doesn't read and
         shrink every picture on it at once. Browsers without one load it now, as before. */
      if (!full && !(key in cache) && typeof IntersectionObserver === 'function') {
        if (!thumbWant[key]) thumbWant[key] = { paths: paths, g: gen };
        return '<span class="small" data-thumb="' + U.esc(key) + '" style="display:grid;place-items:center;height:100%;padding:4px">…</span>';
      }
      if (!(key in cache)) {
        var g = gen, ep = cache._epoch || 0; cache[key] = null;
        /* A picture that finishes after the folder changed, its lightbox closed or the person moved on is released. Its entry
           was already cleared with its epoch (releaseUrls), so it loads again if it's needed again; whatever is there now
           belongs to a newer request and is left alone. Thumbnails and full images have separate epochs. */
        (full ? fullUrl(paths) : thumbJob(paths)).then(function (u) {
          if (g !== gen || ep !== (cache._epoch || 0)) { if (u) URL.revokeObjectURL(u); return; }
          cache[key] = u || ''; later();
        }, function () { if (g === gen && ep === (cache._epoch || 0)) { cache[key] = ''; later(); } });
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
  function firstBlob(paths, fs) {
    fs = fs || state.fs;
    return paths.reduce(function (p, path) { return p.then(function (b) { return b || (/^(images|runs|publications)\//.test(path) ? fs.blob(path).catch(function () { return null; }) : null); }); }, Promise.resolve(null));
  }
  function thumbUrl(paths, fs) {
    return firstBlob(paths, fs).then(function (b) {
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
  /* Thumbnails take turns in the folder's shared pool (at most 4 at once, after the open run and loading). The job reads
     and shrinks the picture itself, so it never waits for another turn while holding one. */
  /* A job is bound to the folder and generation it was queued in: if the folder changed while it waited, it stops before
     reading anything, so an old folder's path is never read through the new one. */
  function thumbJob(paths) {
    var fs = state.fs, g = gen;
    return fs ? repo.poolOf(fs)('thumb', function () { return g === gen && state.fs === fs ? thumbUrl(paths, fs) : ''; }) : Promise.resolve('');
  }
  /* thumbWant: keys drawn as a placeholder with no result and no live job. thumbSeen: the nodes the observer tracks right
     now; a node leaves it whenever it's unobserved or the observer goes. After every redraw each wanted placeholder on the
     page that the observer isn't tracking is observed, whatever happened to that node before (a redraw keeps a node that
     was seen, and its job's result can be thrown away when the run changes underneath it). */
  var thumbWant = {}, thumbIO = null, thumbSeen = [];
  function watchThumbs() {
    pruneThumbs();
    if (typeof IntersectionObserver !== 'function' || !Object.keys(thumbWant).length) return;
    if (!thumbIO) thumbIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var k = en.target && en.target.dataset && en.target.dataset.thumb, w = k && thumbWant[k];
        if (thumbIO && thumbIO.unobserve && en.target.nodeType) { thumbIO.unobserve(en.target); thumbSeen = thumbSeen.filter(function (el) { return el !== en.target; }); }
        if (!w) return;
        delete thumbWant[k];
        if (w.g !== gen) return;
        state.urls[k] = null;
        var g = gen, ep = state.urls._epoch || 0;
        thumbJob(w.paths).then(function (u) {
          if (g !== gen || ep !== (state.urls._epoch || 0)) { if (u) URL.revokeObjectURL(u); return; }
          state.urls[k] = u || ''; later();
        }, function () { if (g === gen && ep === (state.urls._epoch || 0)) { state.urls[k] = ''; later(); } });
      });
    }, { rootMargin: '200px' });
    Array.prototype.forEach.call(app.querySelectorAll('[data-thumb]'), function (el) {
      if (thumbWant[el.dataset.thumb] && thumbSeen.indexOf(el) < 0) { thumbIO.observe(el); thumbSeen.push(el); }
    });
  }
  /* Placeholders a redraw removed are no longer watched; with nothing left to watch, the observer goes. */
  function pruneThumbs() {
    if (!thumbIO) return;
    thumbSeen = thumbSeen.filter(function (el) { if (app.contains(el)) return true; if (thumbIO.unobserve) thumbIO.unobserve(el); return false; });
    if (!thumbSeen.length && !Object.keys(thumbWant).length) { if (thumbIO.disconnect) thumbIO.disconnect(); thumbIO = null; }
  }
  function stopThumbs() { thumbWant = {}; thumbSeen = []; if (thumbIO && thumbIO.disconnect) thumbIO.disconnect(); thumbIO = null; }
  function fullUrl(paths) { return firstBlob(paths).then(function (b) { return b ? URL.createObjectURL(b) : ''; }); }
  function releaseUrls(map) { if (map === state.urls) thumbWant = {}; var ep = (map._epoch || 0) + 1; Object.keys(map).forEach(function (k) { if (map[k] && /^blob:/.test(map[k])) URL.revokeObjectURL(map[k]); delete map[k]; }); map._epoch = ep; }
  /* Several images finishing at once cause one redraw, not one each. */
  var pending = false;
  function later() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; render(); }); }

  /* ---------- Search (docs/design.md section 22) ---------- */
  /* The index lives in memory only, for the folder it was built from (gen). It's built when the palette first opens, in 8 ms
     slices; a newer build or a folder switch stops the older one. While the palette is open, every redraw checks whether
     the accepted data changed and, if so, catches the index up in the same 8 ms slices (a run whose file and notes are
     unchanged is skipped whole), then runs the query again. */
  var sx = { gen: -1, ix: null, job: null, built: false, seen: null, memo: {}, vis: null, status: null };
  function sxOpen() { return !!(state.overlay && state.overlay.search && state.sx); }
  function sxInput() {
    return { runs: data.runs, pubs: data.processes, drafts: data.drafts, people: data.people, stepTypes: (data.stepTypes || {}).types || {}, skills: data.skills,
      corrDecisions: data.corrDecisions || [], followUps: ctx.followUps(), rev: function (r) { return edits(r.id); } };
  }
  function sxReset() { if (sx.job) sx.job.cancel(); sx = { gen: -1, ix: null, job: null, built: false, seen: null, memo: {}, vis: null, status: null }; }
  /* What the index was last brought in line with: the data read, each run object, its file and its local version (an edit
     on screen changes the run in place, saved or not), and the people. */
  function sxMark() { sx.seen = { data: data, runs: data.runs.slice(), h: data.runs.map(function (r) { return r._fileHash + '|' + edits(r.id); }), people: data.people }; }
  function sxStale() {
    var s = sx.seen, runs = data.runs;
    if (!s || s.data !== data || s.people !== data.people || s.runs.length !== runs.length) return true;
    for (var i = 0; i < runs.length; i++) if (s.runs[i] !== runs[i] || s.h[i] !== runs[i]._fileHash + '|' + edits(runs[i].id)) return true;
    return false;
  }
  /* Works through the accepted data in slices: the first build, and every catch-up after the data changed. The first slice
     runs now, so a small change shows at once; the rest follow, with results shown at most every 150 ms and once at the end. */
  function sxIndex() {
    if (sx.gen !== gen || !sx.ix) { sxReset(); sx.gen = gen; sx.ix = PF.search.create(); }
    if (sx.job) sx.job.cancel();
    var g = gen, inp = sxInput(), job = PF.search.start(sx.ix, PF.search.docs(inp, sx.memo), inp), last = elapsed();
    sx.job = job; sxMark();
    function step() {
      if (g !== gen || sx.job !== job) { job.cancel(); return true; }
      var done = job.step(8, elapsed);
      if (job.canceled) return true;
      if (done) { sx.built = true; sx.job = null; }
      return done;
    }
    if (step()) return;
    (function pump() {
      setTimeout(function () {
        if (g !== gen || sx.job !== job) { job.cancel(); return; }
        var done = step();
        if (job.canceled) return;
        if (sxOpen() && (done || elapsed() - last > 150)) { last = elapsed(); sxRun(); render(); }
        if (!done) pump();
      }, 0);
    })();
  }
  function sxStatus() {
    var o = {}, u = (state.unread || {}).runs || {}, m = state.missing || {};
    Object.keys(u).forEach(function (k) { o[k] = 'unread'; });
    Object.keys(m).forEach(function (k) { o[k] = 'missing'; });
    return o;
  }
  /* Called on every redraw while the palette is open. Status is compared by its contents: a refresh replaces those objects
     even when nothing about any run changed. */
  function sxRefresh() {
    if (!state.sx) return;
    if (sx.gen !== gen || !sx.ix) { sxIndex(); sxRun(); return; }
    var st = JSON.stringify(sxStatus());
    if (sxStale()) { sxIndex(); sx.status = st; sxRun(); return; }
    if (sx.status !== st) { sx.status = st; sxRun(); }
  }
  /* Runs the query. The active row is kept by its ID; if it's gone, the row now at its place is chosen. The count is
     announced only when the results shown or their total changed, so a refresh that changes nothing says nothing. */
  function sxRun() {
    var s = state.sx; if (!s) return;
    var res = sx.ix ? PF.search.query(sx.ix, s.q, { context: { process: state.processId, run: state.runKey }, status: sxStatus() }) : null, flat = [];
    (res ? res.groups : []).forEach(function (g) { g.items.forEach(function (x) { flat.push(x); }); });
    var ids = flat.map(function (x) { return x.id; }), at = ids.indexOf(s.active);
    if (at < 0) at = flat.length ? Math.min(Math.max(0, s.pos || 0), flat.length - 1) : -1;
    s.res = res; s.flat = flat; s.pos = at; s.active = at >= 0 ? ids[at] : null;
    var typed = !!String(s.q).trim(), vis = typed && res ? res.total + '\n' + ids.join('\n') : '';
    if (vis === sx.vis) return;
    sx.vis = vis;
    if (typed && res) sxSay(res.total ? res.total.toLocaleString('en-US') + (res.total === 1 ? ' result' : ' results') : 'No results');
  }
  function sxSay(t) { var el = document.getElementById('live'); if (el) el.textContent = el.textContent === t ? t + ' ' : t; }
  /* Opens the palette. A read-only dialog gives way to it; a dialog with typing or choices in it is never replaced. */
  function openSearch() {
    if (!state.fs) return;
    if (sxOpen()) { state.overlayFocus = '#sx-q'; render(); return; }
    if (state.overlay) {
      var held = (state.overlay.held && state.overlay.held()) || dirtyControl([overlayEl]);
      if (held) { say('Finish or cancel this first.', 'warn'); render(); focusOverlay(); return; }
      closeOverlay();
    }
    state.sx = { q: '', active: null, pos: 0, res: null, flat: [], err: '' };
    sx.vis = null;
    if (sx.gen !== gen || !sx.ix) sxIndex();
    /* Closing lets go of what the index was compared with, so a folder's data isn't kept alive by a closed palette. */
    /* Set before the first render: that's the one that draws the box, so typing right after Ctrl+K lands in it. */
    state.overlayFocus = '#sx-q';
    openOverlay({ search: true, html: function () { return V.search(ctx); }, onClose: function () { state.sx = null; sx.seen = null; } });
  }
  /* Why a result can't be opened any more (its run, process, version, step or skill left the folder since it was listed), or ''. */
  function sxGone(t) {
    if (t.view === 'run' && !ctx.findRun(t.run)) return 'That run isn\'t in this folder anymore.';
    if (t.view === 'process') {
      var p = procFind(t.process);
      if (!p) return 'That checklist isn\'t in this folder anymore.';
      /* A version or step result names its exact publication; another version is never shown in its place. */
      var v = t.mapVer ? (p.all || []).filter(function (x) { return x.folder === t.mapVer && x.ok && x.map; })[0] : null;
      if (t.mapVer && !v) return 'That version isn\'t in this folder anymore.';
      if (t.step && !(v && M.findStep(v.map, t.step))) return 'That step isn\'t in this folder anymore.';
    }
    if (t.view === 'skill' && !(data.skills || []).some(function (x) { return (x.file || (x.skill && x.skill.name)) === t.skill; })) return 'That skill isn\'t in this folder anymore.';
    return '';
  }
  /* Opening a result goes through go(). When the page holds typing go() would refuse over, the palette closes first, so the
     message and the box it points at can be seen. A result whose target is gone keeps the palette open and says so. */
  function sxOpenResult(id) {
    var s = state.sx; if (!s) return;
    var x = (s.flat || []).filter(function (y) { return y.id === id; })[0];
    if (!x) return;
    var gone = sxGone(x.target);
    if (gone) { s.err = gone; sxSay(gone); state.overlayFocus = '#sx-q'; render(); return; }
    if (state.obPending || dirtyControl([app])) closeOverlay();
    /* A result that names a place on the page (a decision's group, a version, a step) leaves focus to the reveal; only a
       checklist itself focuses its page's heading (2.11). */
    var t = x.target;
    if (go(t) && t.view === 'process' && !t.mapVer && !t.group && !t.step && !t.decision) { state.focus = 'page-h'; render(); }
  }
  function sxMove(d) {
    var s = state.sx; if (!s || !s.flat || !s.flat.length) return;
    var n = s.flat.length, at = d === 'first' ? 0 : d === 'last' ? n - 1 : ((s.pos < 0 ? -1 : s.pos) + d + n) % n;
    s.pos = at; s.active = s.flat[at].id; state.overlayFocus = '#sx-q'; render();
    var el = document.getElementById('sx-o-' + at); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

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
  var pplBy = { list: null, len: -1, by: null };
  var pplSorted = null;
  var procCache = null, orphanSkills = [], fixMemo = Object.create(null), fuMemo = null, insMemo = Object.create(null), repMemo = Object.create(null), repCurMemo = null;
  /* A process by ID (2.5.0): one look in a map built once for each list processes() makes, keeping the first entry for an ID
     as the old filter()[0] did. */
  var procBy = { list: null, by: null };
  /* A linked step's child for a rename (2.8): a pinned version's map, or the latest published and the saved draft. */
  function renameChild(process, pin) {
    var e = procFind(process); if (!e) return null;
    if (pin) { var at = PF.pins.atVersion(e, process, +pin); return at.pub ? at.pub.map : null; }
    var out = e.latest ? [e.latest.map] : [];
    if (e.draft && e.draft.md != null) { try { out.push(M.parse(e.draft.md)); } catch (x) { /* an unreadable draft takes nothing */ } }
    return out;
  }
  function renameDeps(map, name) {
    var me = map.meta.process, others = [];
    processes().forEach(function (e) {
      if (e.id === me) return;
      var title = e.title || e.id;
      if (e.latest && e.latest.map) others.push({ label: title + ' (published)', map: e.latest.map });
      if (e.draft && e.draft.md != null) { try { others.push({ label: title + ' (draft)', map: M.parse(e.draft.md) }); } catch (x) { /* an unreadable draft passes nothing */ } }
    });
    var child = function (process, pin) {
      var e = procFind(process); if (!e) return null;
      if (pin) { var at = PF.pins.atVersion(e, process, +pin); return at.pub ? at.pub.map : null; }
      /* Latest: what's published now, and the saved draft that will be published next. */
      var out = e.latest ? [e.latest.map] : [];
      if (e.draft && e.draft.md != null) { try { out.push(M.parse(e.draft.md)); } catch (x) { /* an unreadable draft takes nothing */ } }
      return out;
    };
    return PF.refs.dependents(map, name, { others: others, child: child, workflows: data.jira && data.jira.workflows });
  }
  function procFind(id) {
    var ps = processes();
    if (PF.perf.plain) return ps.filter(function (x) { return x.id === id; })[0] || null;
    if (!procBy || procBy.list !== ps) {
      var by = Object.create(null);
      PF.perf.add('procs.inspected', ps.length);
      ps.forEach(function (x) { if (!(x.id in by)) by[x.id] = x; });
      procBy = { list: ps, by: by };
    }
    return id != null && id in procBy.by ? procBy.by[id] : null;
  }
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
      /* Two drafts that say the same process (a OneDrive copy, release-LAPTOP.md): both are listed on the checklist\'s page and in
         Folder health. The one named for the process is shown; otherwise the first by name, the same on every computer. */
      if (e.draft) {
        e.sharedDrafts = (e.sharedDrafts || [e.draft.file]).concat([d.file]).sort();
        var keep = e.draft.file === id + '.md' || (d.file !== id + '.md' && e.draft.file < d.file);
        if (keep) return;
      }
      e.draft = d; e.draftMeta = { owner: m.meta.owner, backup: m.meta.backup };
      if (!e.latest) { e.title = m.meta.title || id; e.category = m.meta.category || 'Other'; e.group = m.meta.group; e.tags = m.meta.tags; }
      e.draftChanged = !e.latest || U.hash(d.md) !== e.latest.info.mapHash;
      /* A team step type the map uses changed since it was frozen into the publication: republishing picks it up. */
      if (e.latest && !e.draftChanged) {
        var custom = (data.stepTypes || {}).types || {}, frozen = e.latest.types || {};
        e.typesChanged = M.usedTypes(m).filter(function (t) { return (custom[t] || (frozen[t] && frozen[t].custom)) && JSON.stringify(T.freeze([t], custom)[t] || null) !== JSON.stringify(frozen[t] || null); });
        e.draftChanged = e.typesChanged.length > 0;
      }
    });
    data.runs.forEach(function (r) { var e = by[r.process]; if (e && !R.isTest(r) && (!e.lastRun || r.created > e.lastRun)) e.lastRun = r.created; });
    /* Proposals from AI assistants, judged against the draft as this window last read or saved it; a process with only a
       proposal is listed too ("Proposed, not drafted yet"). Who else is editing, as far as this computer can see. */
    var PP = PF.proposals, procs = (data.proposed || {}).procs || {};
    Object.keys(procs).forEach(function (pid) {
      var pr = procs[pid], e = by[pid], fresh = !e;
      e = entry(pid); if (fresh) e.proposedOnly = true;
      var all = pr.all, shown = {}, recs = {};
      pr.shown.forEach(function (m) { shown[m.id] = true; }); all.forEach(function (m) { recs[m.id] = []; });
      pr.records.forEach(function (r) { var m = /^(p-[a-z0-9]{1,12}-[a-z0-9]{10})\./.exec(r.name); if (m && recs[m[1]]) recs[m[1]].push(r); });
      /* Judged with every proposal (a listed one may follow an older one), shown at most the newest 200. */
      e.proposed = { list: PP.judge(all, recs, draftInfo(e)).filter(function (x) { return shown[x.id]; }), bad: pr.bad, older: pr.older, records: recs };
    });
    presenceInto(by);
    /* Each registered skill, with where it stands against its process. "Needs attention" = its steps changed, or it can't be matched. */
    /* Registrations that match no process here, or can't be read, are kept and listed with why, never dropped. */
    orphanSkills = [];
    data.skills.forEach(function (x) {
      var e = x.skill && Object.prototype.hasOwnProperty.call(by, x.skill.process) ? by[x.skill.process] : null;
      if (!e) { orphanSkills.push({ skill: x.skill || { name: x.name || x.file || '?', process: '', implements: 0, steps: null, group: [], tags: [], version: '', location: '' }, errors: x.errors, status: { s: x.unmatched ? 'unmatched' : 'missing', text: x.errors.length ? x.errors.join('; ') : 'It names the checklist "' + x.skill.process + '", which isn\'t in this folder.' } }); return; }
      /* A 2.0 registration that can't be matched (Needs review, two registrations, or its exact version isn't usable here) is
         never current. */
      var st = x.unmatched ? { s: 'unmatched', text: 'Can\'t be matched: ' + x.errors.join('; ') } : x.errors.length ? { s: 'missing', text: x.errors.join('; ') } : PF.skills.status(x.skill, e.all, e.latest, e);
      e.skills.push({ skill: x.skill, errors: x.errors, status: st });
      if (st.s === 'update' || st.s === 'missing' || st.s === 'unmatched') e.staleSkills++;
    });
    /* Category, then title, by name (2.11): naturally and ignoring case, ties by ID. For the screen only; the CLI lists its own. */
    var Nat = PF.text.natural;
    procCache = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return Nat(a.category, b.category) || Nat(a.title, b.title) || Nat(a.id, b.id); });
    return procCache;
  }

  /* Rotation: suggest whoever has gone longest without this role in this process. */
  function suggestRole(processId, role) {
    var people = data.people.filter(function (p) { return !p.inactive; });
    if (!people.length) return null;
    var last = Object.create(null);
    data.runs.forEach(function (r) { if (r.process === processId && r.state !== 'cancelled' && !R.isTest(r) && r.roles && r.roles[role]) { var p = r.roles[role]; if (!last[p] || r.created > last[p]) last[p] = r.created; } });
    var best = people.slice().sort(function (a, b) { var la = last[a.id] || '', lb = last[b.id] || ''; return la === lb ? (a.name < b.name ? -1 : 1) : la < lb ? -1 : 1; })[0];
    return { person: best.id, why: last[best.id] ? 'last did it ' + U.day(last[best.id]) : 'hasn\'t done it yet', last: last[best.id] || '' };
  }

  /* ---------- loading ---------- */
  /* What a redraw decision compares a run by: its file, what its notes files say (a note replaced at the same size and time
     changes _notesSig, never the count), notes added here since the read, and its conflict copies by name. */
  function shownSig(r) { return r._fileHash + ':' + (r._notesSig || '') + ':' + (r._notes || []).length + ':' + (r._conflicts || []).join('/'); }
  function signature(d) {
    return JSON.stringify([d.people.length, d.people.hash, d.drafts.map(function (x) { return x.file + x.mtime; }), d.processes.map(function (p) { return p.pubs.map(function (x) { return x.folder + x.ok + (x.fromStage ? ':' + x.fromStage.folder + x.fromStage.ok : ''); }); }),
      d.runs.map(function (r) { return r.id + ':' + shownSig(r); }), d.skills.map(function (x) { return JSON.stringify(x.skill); }), (d.validations || []).map(function (x) { return JSON.stringify(x); }), (d.valUnread || []).map(function (u) { return u.path + ':' + !!u.ignored + !!u.claimed + ':' + (u.process || '') + ':' + (u.folder || '') + ':' + (u.stage || ''); }), (d.refused || []).map(function (x) { return x.path + ':' + x.kind + ':' + (x.needs || ''); }), (d.planUnread || []).map(function (u) { return u.path + ':' + u.kind + (u.unnamed ? ':unnamed' : ''); }),
      /* Decisions by content, not by file and time: a file rewritten with the same name and time still redraws. */
      (d.corrDecisions || []).map(function (x) { return JSON.stringify(x); }), (d.corrUnread || []).map(function (x) { return x.dir + '/' + x.process + '/' + x._file; }), (d.fuDecisions || []).map(function (x) { return JSON.stringify(x); }), (d.fuUnread || []).map(function (x) { return x.process + '/' + x._file; }), d.plans.map(function (p) { return p.id + p._hash + !!p._status + !!p._decidedEarlier + !!p._conflicting + p._copies + !!p._copiesDiffer + (p._files || []).join('|') + JSON.stringify([p._retarget || null, p._retargetClash || null, p._statusHeld || null]); }), (d.unreadable || []).map(function (u) { return u.path; }), Object.keys(d.failed || {}),
      Object.keys((d.proposed || {}).procs || {}).map(function (k) { var x = d.proposed.procs[k]; return k + ':' + x.all.map(function (m) { return m.id; }).join() + ':' + x.bad.map(function (b) { return b.name; }).join() + ':' + x.records.map(function (r) { return r.name + r.sha; }).join(); }),
      (d.presence || []).map(function (x) { return x.name + ':' + (x.rec ? x.rec.beat + JSON.stringify(x.rec.main) + x.rec.drafts.join() : '-'); }),
      d.reports ? d.reports.files.map(function (f) { return f.path; }).concat(d.reports.bad.map(function (b) { return b.path; })) : [], (d.repDecisions || []).map(function (x) { return JSON.stringify(x); }), (d.repUnread || []).map(function (x) { return x.process + '/' + x._file; }),
      Object.keys((d.stages || {}).procs || {}).map(function (k) { var x = d.stages.procs[k]; return k + ':' + x.unlisted + ':' + x.stages.map(function (s) { return s.folder + s.ok; }).join() + ':' + x.decisions.map(function (y) { return y._file; }).join() + ':' + x.unread.map(function (u) { return u.path; }).join() + ':' + x.refused.map(function (r) { return r.path + r.needs; }).join(); }),
      d.teamValues ? d.teamValues.state + ':' + d.teamValues.hash + ':' + (d.teamValues.why || '') : '']);
  }
  /* One read of the folder at a time. If the folder can't be read, keep showing what was last read and say so;
     an unreadable folder never looks empty. */
  /* Every read and write belongs to the folder it started in. Switching folders starts a new generation, and anything still
     in flight from the old folder is ignored when it finishes, so two folders' data never mix. */
  var loading = null, gen = 0;
  /* Team values (2.9): every read of team-values.json (a refresh, Settings, a child's start just before it writes) is
     numbered when it starts (teamReads) and reaches the app only through applyTeam, which ignores another folder's and keeps
     the newest; switching folders starts over. */
  var teamReads = 0, teamAt = { n: 0, res: null };
  /* The team values the app now holds after this read: the read's own result if it's the newest, else the newer one kept;
     null when the read was another folder's. */
  function applyTeam(fs, g, n, result) {
    if (fs !== state.fs || g !== gen) return null;
    if (!teamAt.res || n > teamAt.n) teamAt = { n: n, res: result };
    data.teamValues = teamAt.res;
    return teamAt.res;
  }
  /* A read of team-values.json now, through applyTeam: the accepted result, or null (another folder by the time it read). */
  function readTeam(fs) {
    var g = gen, n = ++teamReads;
    return repo.readTeamValues(fs).then(function (res) { return applyTeam(fs, g, n, res); });
  }
  /* The one rule for replacing a run with the folder's copy, used by every read: never when the run has a change not yet
     saved, a save still in flight, or any edit made since the read began (its local revision moved). A read that started
     before an edit is older than what's on screen, whatever the folder says. */
  /* Each run's version lives here, not on the run object, so it never resets when a newer object replaces the old one. It
     advances on every local edit and every time a newer copy from the folder is accepted, so a read that began before
     either can never install an older run over it. */
  var editCount = {};
  function bump(id) { editCount[id] = edits(id) + 1; }
  function edits(id) { return Object.prototype.hasOwnProperty.call(editCount, id) ? editCount[id] : 0; }
  function revsNow() { return Object.assign(Object.create(null), editCount); }
  function localRun(id) { for (var i = 0; i < data.runs.length; i++) if (data.runs[i].id === id) return data.runs[i]; return null; }
  function canReplace(id, before) {
    if (state.unsaved[id] || (state.pendingSaves || {})[id]) return false;
    /* '~' + id counts this window's successful saves and restores of the run: a read that started before one is older than
       what's in the folder now. */
    return edits(id) === (before[id] || 0) && edits('~' + id) === (before['~' + id] || 0);
  }
  /* Elapsed time on this computer, never the wall clock (which can be changed or roll back). */
  function elapsed() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
  /* Reads are numbered as they start, so an editor can tell a read that began after its own save from an older one. */
  var readsStarted = 0;
  /* Which runs to read first, from what this window last accepted: running, then ended in the last week; runs it doesn't
     know yet come next (repo's default), the rest last. */
  function readPriority() {
    var pr = {}, week = Date.now() - 7 * 86400000;
    data.runs.forEach(function (r) { pr[r.process + '/' + r.id] = !r.ended ? 0 : Date.parse(r.ended.at) > week ? 1 : 3; });
    return pr;
  }
  /* A batch of a load still under way: fresh and unreadable results only, each through applyRunRead with the load's own
     start, so a newer read, an edit or a save since it began wins. Runs not read yet are pending: nothing about them
     changes, and nothing is ever marked gone here; only the complete result can do that (applyRunsRead). */
  function applyBatch(b, at) {
    var shown = false;
    PF.perf.add('batch.applied');
    Object.keys(b.reads).forEach(function (k) {
      var res = b.reads[k], i = runIdx.pos(data.runs, k), prev = i >= 0 ? data.runs[i] : null, got = applyRunRead(k, at, res, prev);
      if (!got && !prev && res.kind === 'fresh') got = res.run;
      if (!got || got === prev) { if (res.kind === 'unreadable') shown = true; return; }
      if (i >= 0) data.runs[i] = got; else runIdx.push(data.runs, got);
      shown = true;
    });
    /* Each path once, the batch's last word on it at the end, in the batch's order (as replacing them one by one did). */
    var un = b.unreadable || [];
    if (un.length) {
      var last = Object.create(null); un.forEach(function (u, j) { last[u.path] = j; });
      data.unreadable = (data.unreadable || []).filter(function (x) { return !(x.path in last); }).concat(un.filter(function (u, j) { return last[u.path] === j; }));
    }
    if (state.reading) state.reading = { done: b.done, total: b.total };
    if (shown || state.reading) { procCache = null; batchRender(); }
  }
  /* A load's batches draw the first time at once, then at most once per 250 ms: a burst of batches draws once. Any full redraw
     (a click, the complete result) draws what they brought and drops the one waiting; so does a switch of folders. */
  var batchTimer = null, batchDrawn = false;
  function batchRender() {
    if (!batchDrawn) { batchDrawn = true; PF.perf.add('batch.renders'); render(); return; }
    if (batchTimer) return;
    var g = gen;
    batchTimer = setTimeout(function () { batchTimer = null; if (g !== gen) return; PF.perf.add('batch.renders'); render(); }, 250);
  }
  function dropBatchRender() { if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; } }
  /* A read started after a write: a refresh already under way may have read the folder before it, so it's awaited first. */
  function loadAfterWrite() {
    var g = gen, wait = loading && loading.gen === gen ? loading.p.then(function () {}, function () {}) : Promise.resolve();
    return wait.then(function () { if (g === gen) return load(true); });
  }
  function load(force, deep) {
    if (!state.fs) return Promise.resolve();
    if (deep) checkNewerCopy(state.fs, gen);
    if (loading && loading.gen === gen) return loading.p;
    var g = gen, before = revsNow(), seq = ++readsStarted, t0 = elapsed(), lfs = state.fs, tn = ++teamReads;
    batchDrawn = false;
    /* Runs whose last check failed are read in full: only a real read clears that, never what the cache remembers. So are
       runs whose cached copy turned out older than the one shown. */
    var retry = Object.keys((state.unread || {}).runs || {}).concat(Object.keys(state.missing || {}), Object.keys(staleCache), Object.keys(notCounted));
    staleCache = {};
    var at = { seq: seq, revs: before };
    var p = repo.loadAll(state.fs, { deep: !!deep, fresh: retry, clock: elapsed, priority: readPriority(),
      onBatch: function (b) { if (g === gen) applyBatch(b, at); } }).then(function (d) {
      if (g !== gen) return;
      PF.perf.add('load.done');
      var wasReading = !!state.reading || !!batchTimer;
      state.reading = null;
      /* How long routine refreshes take here, for Folder health (the last 3). */
      if (!deep) state.refreshMs = (state.refreshMs || []).concat([elapsed() - t0]).slice(-3);
      d.readSeq = seq;
      loading = null;
      keepUnread(d);
      keepNewerDrafts(d, seq);
      /* Presence, like drafts, is never put back by a read older than the newest one applied (the watcher's included). */
      var presNewer = presSeq > seq;
      if (presNewer) d.presence = data.presence; else if (!(d.failed || {}).presence) presSeq = seq;
      notePresence(d, !presNewer && !(d.failed || {}).presence);
      /* The folder's read replaced what the watcher had read of proposed/: it reads that process again on its next look. */
      watch.names = null;
      d.runs = applyRunsRead(d, at);
      d.teamValues = applyTeam(lfs, g, tn, d.teamValues || PF.teamValues.parse(null));
      R.mapMemo.keep(d.runs);
      var s = signature(d), changed = s !== sig, wasErr = state.folderErr;
      /* A decision that couldn't be read this time keeps the last one read from the same file. */
      /* Not for a part kept whole from before (keepUnread): its lists are the ones already shown, kept ones included. */
      var fresh = function (part) { return !(part in (d.failed || {})); };
      if (fresh('corrections')) (d.corrUnread || []).forEach(function (u) { (data.corrDecisions || []).forEach(function (x) { if (x.process === u.process && x._file === u._file && x._dir === u.dir) { d.corrDecisions.push(x); u.kept = true; } }); });
      if (fresh('follow-ups')) (d.fuUnread || []).forEach(function (u) { (data.fuDecisions || []).forEach(function (x) { if (x.process === u.process && x._file === u._file) { d.fuDecisions.push(x); u.kept = true; } }); });
      if (fresh('report decisions')) (d.repUnread || []).forEach(function (u) { (data.repDecisions || []).forEach(function (x) { if (x.process === u.process && x._file === u._file) { d.repDecisions.push(x); u.kept = true; } }); });
      /* A sign-off read before whose file can't be read now (still syncing) keeps counting as what it said then. */
      if (fresh('sign-offs')) (d.valUnread || []).forEach(function (u) { (data.validations || []).forEach(function (x) { if (x._file === u._file && !u.kept && !u.ignored) { d.validations.push(x); u.kept = true; } }); });
      /* A plan whose own file can't be read now stays shown as last read, held until it reads: it may have been started. */
      if (fresh('proposals')) (d.planUnread || []).forEach(function (u) {
        if (u.kind !== 'unreadable' || /\.status-/.test(u._file)) return;
        (data.plans || []).forEach(function (x) {
          if ((x._files || []).indexOf(u._file) < 0) return;
          /* Another copy of it that still reads is held too: the copy that can't be read may be the one already started. */
          var c = d.plans.filter(function (y) { return y.id === x.id; })[0];
          if (!c) { c = Object.assign({}, x); d.plans.push(c); u.kept = true; }
          c._statusHeld = [{ path: u.path, kind: 'unreadable', needs: '' }].concat(c._statusHeld || []); c._statusUnread = c._statusHeld.map(function (h) { return h.path; });
        });
      });
      /* A process's stages that couldn't be listed this time keep what was read before, said as such. */
      Object.keys((d.stages || {}).procs || {}).forEach(function (k) { var x = d.stages.procs[k], op = (data.stages || {}).procs || {}, old = Object.prototype.hasOwnProperty.call(op, k) ? op[k] : null; if (x.unlisted && old) { x.stages = old.stages; x.decisions = old.decisions; } });
      data = d; sig = s; procCache = null; state.folderErr = null; state.runReadAt = d.readAt; folderUnread = false;
      if (changed || force || wasErr || wasReading) render(); else renderTop();
      navLoaded();
      syncChildren();
      loadConn();
      loadSetupAnswers();
      finishAccepts();
    }, function (e) { if (g !== gen) return; PF.perf.add('load.done'); loading = null; state.reading = null; state.folderErr = e.message || String(e); folderUnread = true; render(); navLoadFailed(); });
    loading = { gen: g, p: p };
    return p;
  }
  /* A part of the folder that couldn't be read this time keeps what was read before, and so does a run whose file couldn't
     be read: an unreadable part never looks empty, and Folder health and the Runs page say what couldn't be read. */
  var KEEP = { people: ['people'], drafts: ['drafts'], publications: ['processes'], legacy: ['legacy'], skills: ['skills', 'skillsSkipped'], proposals: ['plans', 'planUnread'], 'step types': ['stepTypes'], 'Jira workflows': ['jira'], 'sign-offs': ['validations', 'valUnread'], corrections: ['corrDecisions', 'corrUnread'], 'follow-ups': ['fuDecisions', 'fuUnread'], 'proposed changes': ['proposed'], presence: ['presence'], reports: ['reports'], 'report decisions': ['repDecisions', 'repUnread'], stages: ['stages'] };
  function keepUnread(d) {
    Object.keys(d.failed || {}).forEach(function (k) { (KEEP[k] || []).forEach(function (f) { if (data[f] !== undefined) d[f] = data[f]; }); });
    /* Versions kept from before because publications/ couldn't be read now: their bytes weren't checked against their stage
       this time, so none of a stage's test runs or sign-offs count for them until they are (2.1). */
    if (d.failed && 'publications' in d.failed) (d.processes || []).forEach(function (p) {
      [p.latest, p.index && p.index.latest].concat(p.pubs || []).forEach(function (x) { if (x && x.fromStage && x.fromStage.ok) x.fromStage = { folder: x.fromStage.folder, ok: false, why: 'Its files couldn\'t be read this time.', stage: null }; });
    });
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
  /* A read result (docs/design.md section 25) is one of:
       { kind: 'fresh', run, build }   the file, read now
       { kind: 'cached', sig, build }  an ended run unchanged since it was read; build() makes a new object from what was read
       { kind: 'unreadable', why }     the file couldn't be read or understood
       { kind: 'missing' }             not in a complete listing (or no run.json), for a run that has been on disk
       { kind: 'pending' }             not read yet; never means missing
     at = { seq, revs }: when the read started. applyRunRead ignores the whole result if the run was edited, saved or
     restored since then (canReplace: every one of those advances its version) or a newer read of it was applied first.
     Only a fresh read clears "couldn't be read" or "gone"; a cached one never changes a run's status. Nothing about a run
     (its contents, gone, unreadable) changes any other way, except the outcome of this window's own save, which is newer
     than any read (runOutcome). Returns the run object to show when the result replaced it, else null. */
  var applied = {}, baselines = Object.create(null), staleCache = {};
  /* Runs whose latest read failed (unreadable, or gone), whatever is on screen: a run kept on screen for its unsaved work still
     isn't counted toward a sign-off while its file can't be read as it (2.0.1). */
  var notCounted = {};
  /* The last read of the whole folder failed: what's shown is from before it. */
  var folderUnread = false;
  function startRead() { return { seq: ++readsStarted, revs: revsNow() }; }
  /* The runs a sign-off counts, of one process or of all (2.5.0). Positions of each process's runs are kept for the runs array
     as it stands: runs are only ever added at the end or replaced where they are with the same key (runIdx), so a position
     keeps its process until the array is replaced or grows, and then they're worked out again. */
  var runsAt = { arr: null, len: -1, by: null };
  function procRuns(pid) {
    var a = data.runs;
    if (PF.perf.plain) return a.filter(function (x) { return x.process === pid; });
    if (!runsAt || runsAt.arr !== a || runsAt.len !== a.length) {
      var by = Object.create(null);
      a.forEach(function (r, i) { (by[r.process] = by[r.process] || []).push(i); });
      runsAt = { arr: a, len: a.length, by: by };
    }
    var at = pid in runsAt.by ? runsAt.by[pid] : [], out = [];
    for (var i = 0; i < at.length; i++) {
      var r = a[at[i]];
      /* Never expected; if a run did move, the positions are worked out again rather than trusted. */
      if (!r || r.process !== pid) { runsAt.arr = null; return a.filter(function (x) { return x.process === pid; }); }
      out.push(r);
    }
    return out;
  }
  function countedRuns(pid) { return (pid == null ? data.runs : procRuns(pid)).filter(counted); }
  /* For tests (2.5.0): what the lookups answer, against scans from the start ([] when they all agree); and one draw of what's
     on screen now, changing nothing. */
  PF.perf.check = function () {
    var a = data.runs, bad = [], all = countedRuns(), pids = Object.create(null), ps = processes();
    a.forEach(function (r) {
      var k = r.process + '/' + r.id, scan = null;
      for (var i = 0; i < a.length; i++) if (a[i].process + '/' + a[i].id === k) { scan = a[i]; break; }
      if (findRun(k) !== scan) bad.push('findRun ' + k);
      pids[r.process] = true;
    });
    if (findRun('no-such/run') !== null) bad.push('findRun of a missing key');
    ps.forEach(function (p) { pids[p.id] = true; });
    Object.keys(pids).forEach(function (pid) {
      var mine = countedRuns(pid), want = all.filter(function (r) { return r.process === pid; });
      if (mine.length !== want.length || mine.some(function (r, i) { return r !== want[i]; })) bad.push('countedRuns ' + pid);
      if (procFind(pid) !== (ps.filter(function (x) { return x.id === pid; })[0] || null)) bad.push('procFind ' + pid);
    });
    return bad;
  };
  PF.perf.draw = function () { renderNow(); };
  PF.perf.maps = function () { return { unread: (state.unread || {}).runs || null, missing: state.missing || null }; };
  /* Whether a run (on screen, or just read again) counts toward a sign-off now. */
  function counted(r) {
    PF.perf.add('runs.counted');
    /* While the runs folder (or the whole folder) can't be read, none of what's shown is what it holds now. */
    if (folderUnread || (data.failed || {}).runs) return false;
    /* Nor is a run with a change that couldn't be saved. */
    var u = (state.unread || {}).runs || {}, m = state.missing || {}, un = state.unsaved || {}, k = r.process + '/' + r.id;
    return !u[k] && !m[k] && !notCounted[k] && !un[r.id];
  }
  /* What a sign-off's own reread of a run found, said as any read is, so a run it found gone or not itself stops counting
     on the page too. */
  /* Why a plan can't be started, declined or switched now: a decision on it can't be read ('' when none). */
  function planHeld(plan) { return V.planHeldWhy(plan, data); }
  function rereadOutcome(key, at, res) { if (res && (res.kind === 'missing' || res.kind === 'unreadable')) applyRunRead(key, at, res); }
  function findRun(key) { return runIdx.find(data.runs, key); }
  /* Changed in place: nothing keeps an old copy of either map to compare with (search compares their text, insights builds its
     own, health reads them at once), so a folder of thousands of unreadable runs doesn't copy every status for each one. */
  function setRunStatus(key, kind, why) {
    var u = state.unread = state.unread || { runs: {}, drafts: {} };
    if (!u.runs) u.runs = {};
    if (!state.missing) state.missing = {};
    delete u.runs[key]; delete state.missing[key];
    if (kind === 'unread') u.runs[key] = why;
    if (kind === 'missing') state.missing[key] = true;
  }
  /* Discard goes back to a version built new from what was read or saved, never to an object anyone can change. */
  function keepBaseline(id, make) { baselines[id] = { make: make }; }
  /* cur: the run shown now under this key (null for none), when the caller has looked it up already; left out, it's looked up. */
  function applyRunRead(key, at, res, cur) {
    var id = key.slice(key.indexOf('/') + 1), shownNow = function () { return cur === undefined ? findRun(key) : cur; };
    if (!res || res.kind === 'pending') return null;
    if ((applied[key] || 0) > at.seq) return null;
    /* Only a real read clears it, never what the cache remembers. */
    if (res.kind === 'unreadable' || res.kind === 'missing') notCounted[key] = true; else if (res.kind === 'fresh') delete notCounted[key];
    if (res.kind === 'cached') {
      var shown = shownNow();
      if (shown && repo.runSig(shown) === res.sig) return null;
      if (!canReplace(id, at.revs)) return null;
      var built = res.build();
      /* What the cache kept is older than what's shown (a revision this window saved or read since): never go back to it;
         read the run fresh next time instead. */
      if (shown && (built.rev || 0) < (shown.rev || 0)) { staleCache[key] = true; return null; }
      applied[key] = at.seq;
      if (!shown || shown._fileHash !== built._fileHash) bump(id);
      keepBaseline(id, res.build);
      return built;
    }
    if (!canReplace(id, at.revs)) {
      /* The run on screen stays (a change of this window's waits), but a file that reads again is news: an old "couldn't be
         read" or "gone" would otherwise stay, and refuse changes, until that change is saved. Not while a save is under way
         or landed since the read began: what that save found is newer. */
      if (res.kind === 'fresh' && !(state.pendingSaves || {})[id] && edits('~' + id) === (at.revs['~' + id] || 0)) { applied[key] = at.seq; setRunStatus(key, 'run'); }
      return null;
    }
    applied[key] = at.seq;
    setRunStatus(key, res.kind === 'fresh' ? 'run' : res.kind === 'unreadable' ? 'unread' : res.kind, res.why);
    if (res.kind !== 'fresh') return shownNow();
    var mine = shownNow();
    if (!mine || mine._fileHash !== res.run._fileHash) bump(id);
    /* A read hands over how to build the run again; only without that is a copy taken now (2.5.0: not for every read). */
    if (res.build) keepBaseline(id, res.build);
    else { PF.perf.add('baseline.copied'); var text = JSON.stringify(res.run); keepBaseline(id, function () { return JSON.parse(text); }); }
    return res.run;
  }
  /* What this window's own save found (gone, unreadable) is current: it outranks any read still in flight. */
  function runOutcome(key, kind, why) { applied[key] = ++readsStarted; if (kind === 'unread' || kind === 'missing') notCounted[key] = true; else delete notCounted[key]; setRunStatus(key, kind, why); }
  /* A refresh of every run: each run's result goes through applyRunRead. A run the read didn't list that has been on disk is
     gone only when the listing was complete; one never saved yet, or one the read may not replace, stays as it is. */
  function applyRunsRead(d, at) {
    var reads = d.reads || {}, complete = d.runsComplete === true && !(d.failed || {}).runs, keys = [], out = [], seen = Object.create(null);
    function note(k) { PF.perf.add('runs.dedupe'); if (!(k in seen)) { seen[k] = true; keys.push(k); } }
    data.runs.forEach(function (x) { note(x.process + '/' + x.id); });
    Object.keys(reads).forEach(note);
    keys.forEach(function (k) {
      var prev = findRun(k), res = reads[k] || (complete && prev && prev._fileHash ? { kind: 'missing' } : null);
      var got = res ? applyRunRead(k, at, res, prev) : null;
      var show = got || (prev ? state.unsaved[prev.id] || prev : res && res.kind === 'fresh' ? res.run : res && res.kind === 'cached' ? res.build() : null);
      if (show) out.push(show);
    });
    return out;
  }
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
    var key = [sig, state.me, Object.keys(state.missing || {}).join(','), hs && full ? hs.n : 0, Math.floor(Date.now() / 60000), state.newer, conn ? conn.readAt : '', (state.refreshMs || []).map(function (x) { return Math.round(x / 1000); }).join(',')].join('|');
    if (healthMemo && healthMemo.key === key) return healthMemo.rep;
    var rep = PF.health.check({ data: data, scan: full && hs ? hs.scan : null, me: state.me, app: APP_VERSION, newer: state.newer, contract: hs ? hs.contract : null, connection: conn, missing: state.missing, refreshMs: state.refreshMs }, Date.now());
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
  var connListing = false, lastConn = -Infinity;
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
    var before = shownSig(r), g = gen, revs = revsNow();
    var at = startRead(), key = r.process + '/' + r.id, bad = [];
    var p = repo.loadRun(state.fs, r.process, r.id, null, false, false, bad).then(function (f) {
      if (g !== gen) return;
      loading = null; state.folderErr = null; state.runReadAt = new Date().toISOString();
      var cur = findRun(key) || r, was = runUnread(cur);
      var res = f ? { kind: 'fresh', run: f } : bad.length ? { kind: 'unreadable', why: bad[0].why } : cur._fileHash ? { kind: 'missing' } : null;
      var changed = !!f && f._fileHash !== cur._fileHash;
      if (!res || !applyRunRead(key, at, res)) { if (runUnread(cur) !== was) render(); else renderTop(); return; }
      if (res.kind !== 'fresh') { if (runUnread(cur) !== was) render(); else renderTop(); return; }
      if (changed) flashChanged(cur, f);
      for (var i = 0; i < data.runs.length; i++) if (data.runs[i].process + '/' + data.runs[i].id === key) data.runs[i] = f;
      if (shownSig(f) !== before || runUnread(f) !== was) render(); else { renderTop(); updateFreshness(); }
    }, function (e) { if (g !== gen) return; loading = null; applyRunRead(key, at, { kind: 'unreadable', why: 'couldn\'t be read (' + (e.message || String(e)) + ')' }); state.folderErr = e.message || String(e); render(); });
    loading = { gen: g, p: p };
    return p;
  }
  /* Answers another window changed light up their rows for a moment, without moving anything or anyone. */
  function flashChanged(was, now) {
    var ids = Object.keys(now.steps || {}).filter(function (id) { var a = was.steps && Object.prototype.hasOwnProperty.call(was.steps, id) ? was.steps[id] : null, b = now.steps[id]; return !a || a.s !== b.s || a.at !== b.at; });
    if (!ids.length) return;
    var mark = state.flash = { ids: ids };
    setTimeout(function () { if (state.flash === mark) { state.flash = null; scheduleRender(); } }, 1800);
  }
  function updateFreshness() { var el = document.getElementById('fresh'); if (el) el.innerHTML = V.freshness(ctx, ctx.run(), el.dataset && el.dataset.k === 'strip'); }
  /* opts.setup: Getting started's own folder step, which keeps the wizard. */
  function useFs(fs, opts) {
    /* Unsaved changes stay with their own folder: kept in this browser under that folder's name, never carried into the new one. */
    Object.keys(state.unsaved).forEach(function (id) { lsSet(localKey(id), state.unsaved[id]); });
    /* Typing is kept as drafts of the folder it was typed in (keys carry the folder); nothing open goes to the next one. */
    if (state.fs) leaveContext();
    state.pick = null; state.fieldsDraft = null; state.edit = null; state.fieldErr = null;
    gen++; teamAt = { n: 0, res: null }; loading = null; folderUnread = false; dropBatchRender(); state.pendingStarts = Object.create(null); startEpoch++; state.planPick = null; state.copyView = null; state.newer = null; state.archive = {}; editCount = {}; state.unsaved = {}; state.saveErr = {}; state.saveOpts = {}; state.folderErr = null; state.busyN = 0; state.pendingSaves = {}; state.recovering = null; state.fuSaving = {}; state.fuPick = null; state.repPick = null; state.repSaving = null; repCache = Object.create(null);
    state.setupAnswers = []; state.setupSeen = {}; answersBusy = false; state.healthScan = null; state.healthBusy = false; state.healthErr = null; state.conn = null; state.connSent = []; state.connSeen = {}; state.connAnswered = []; state.connAnswering = {}; state.connDismissed = {}; state.connErr = null; state.connSending = false; state.connN = 0; state.connKept = {}; state.unread = { runs: {}, drafts: {} }; state.missing = {}; applied = {}; notCounted = {}; baselines = {}; connListing = false;
    data = { people: [], drafts: [], processes: [], runs: [], legacy: [], skills: [], plans: [], stepTypes: { types: {}, errors: [] }, jira: { workflows: {}, errors: [] }, readAt: new Date().toISOString() };
    state.more = {}; state.refreshMs = []; stopThumbs(); R.mapMemo.clear(); staleCache = {}; sxReset();
    /* Nothing from this folder is read yet: Home and Runs say so, with counts, until the first complete read. */
    state.reading = { done: 0, total: null };
    /* Input kept for return belongs to its folder: a new folder starts clean. */
    state.corrDrafts = {}; state.noteCorrs = {}; state.pendingFiles = []; state.newProc = null; state.corrForm = null; state.peopleAdd = null; state.teamAdd = null; state.teamEdit = null; state.teamErr = null; state.planning = null;
    if (!(opts && opts.setup)) { state.setup = null; if (state.view === 'setup') home(); }
    /* Opening a folder isn't the person's move: the entry is replaced with where it lands, tagged with the new folder. */
    H.seen = navSeq; H.mode = 'replace';
    /* A drill-down's runs and the version picked on How runs go belong to this folder. */
    state.runFilter = null; state.insFolder = {};
    state.fs = fs; releaseUrls(state.urls); releaseUrls(state.full); sig = ''; procCache = null;
    if (fs.volatile) explainTabOnly();
    return load(true, true);
  }

  /* The first time this session's examples are tab-only, a dialog says what that means; the badge keeps saying it. Remembered
     for the tab's session where the browser allows, else for this page. */
  var tabOnlyExplained = false;
  function explainTabOnly() {
    try { tabOnlyExplained = tabOnlyExplained || sessionStorage.getItem('preflight:tab-only-seen') === '1'; } catch (e) { /* storage blocked */ }
    if (tabOnlyExplained || state.overlay) return;
    tabOnlyExplained = true;
    try { sessionStorage.setItem('preflight:tab-only-seen', '1'); } catch (e) { /* storage blocked */ }
    state.overlay = { back: null, html: function () { return V.tabOnlyHelp(ctx); } };
  }
  function seedExamples(mem) { mem.reset(EXAMPLES); return PF.examples.seed(mem, EXAMPLES); }
  function boot() {
    var mem = new PF.fs.MemoryFS(LS + ':examples', null);
    /* A browser that refuses storage still gets the examples, kept in this tab only; a failed seed shows what failed. */
    var seeded = Object.keys(mem.files).length ? Promise.resolve() : Promise.resolve().then(function () { return seedExamples(mem); }).catch(function (e) { say(e && e.message || 'The examples couldn\'t be set up.', 'warn'); });
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
  /* Another folder is about to open. A dialog still up belongs to the one being left, and what it holds (a screenshot's path, a
     form's target) would be read from or written to the new one, so it closes first, and focus goes to where the folder lands:
     what opened the dialog is about to be gone. A dialog with typing or choices in it is never closed: the folder doesn't open
     (false) and the person finishes or cancels first. Called by whoever switches: useFs is gated, and a read it starts draws the rest. */
  function leaveFolderOverlay(to) {
    if (!state.overlay) return true;
    if (overlayHeld()) { say('Finish or cancel this first.', 'warn'); render(); focusOverlay(); return false; }
    childEpoch++;
    var done = state.overlay.onClose; state.overlay = null; if (done) done(); releaseUrls(state.full);
    /* The screen behind a dialog is inert, and an inert heading can't take focus. */
    app.removeAttribute('inert'); topEl.removeAttribute('inert');
    state.focus = to; state.focusWins = true; later();
    return true;
  }
  function overlayHeld() { return !!state.overlay && !!((state.overlay.held && state.overlay.held()) || dirtyControl([overlayEl])); }
  function connect() {
    var t = ++opening;
    window.showDirectoryPicker({ id: 'preflight', mode: 'readwrite' }).then(function (dir) {
      if (t !== opening) return;
      var notRemembered = '', was = null;
      return handles.read('folder').then(function (v) { was = { v: v }; return handles.set(dir); }).catch(function (e) { notRemembered = ' This browser couldn\'t remember the folder (' + e.message + '), so you\'ll be asked to choose it again next time.'; return { dir: dir, id: 'unremembered-' + U.randomId(12) }; }).then(function (rec) {
        if (t !== opening) return;
        /* Not opened, so not what this browser opens next time either. */
        if (!leaveFolderOverlay('page-h')) { if (was) handles.write('folder', was.v).catch(function () {}); return; } state.needsReconnect = null; home();
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
  function setupState(mode, step) { state.setup = { fs: fsKey(), mode: mode, step: step || (mode === 'start' ? 'folder' : mode === 'join' ? 'open' : ''), me: { name: '', email: '' }, team: [{ k: 't1', name: '', email: '' }], backup: '', kn: 1 }; return state.setup; }
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
      if (!leaveFolderOverlay('su-h')) { su.busy = false; render(); return; } state.me = myId; lsSet('me', myId); state.needsReconnect = null; forgetStartIfNotMine();
      var made = useFs(folderFs(rec), { setup: true }); su.fs = fsKey();
      return made.then(function () {
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
    var open = function () { setView('process'); state.processId = pid; state.ptab = 'edit'; state.mapVer = null; resetRunUi(); dropEditor(pid); var p = currentProcess(); if (p) openEditor(p); state.focus = 'draft-editor'; say('This is your first checklist. Change what you like, choose Save draft, then Review & publish.', 'good'); render(); window.scrollTo(0, 0); };
    queued(function () { return repo.saveDraft(sfs, pid + '.md', md, null, { lock: LOCKS ? lock : null, expectText: null }); }).then(function (res) {
      if (g !== gen) return null;
      if (res.conflict && res.theirs !== md) { su.busy = false; say('A draft called ' + pid + '.md is already in the folder, so nothing was replaced. Open it from Checklists.', 'warn'); render(); return null; }
      if (res.ok) logSave(sfs, fsKey(), { kind: 'draft-edit', id: pid, from: null, to: res.hash, before: '', after: md, source: 'new', units: ['Created the draft'], items: [] });
      return load(true).then(function () {
        if (g !== gen) return null;
        var p = procFind(pid);
        if (edit) { su.busy = false; open(); return null; }
        if (p && p.latest && !p.draftChanged) { su.busy = false; say(p.title + ' is published already.', 'good'); render(); return null; }
        var people = data.people, wfs = data.jira.workflows, pids = processes().filter(function (x) { return x.latest; }).map(function (x) { return x.id; });
        return queued(function () {
          return repo.loadStepTypes(sfs).then(function (types) { return repo.publish(sfs, md, { people: people, customTypes: types.types, workflows: wfs, processes: pids, by: by, changes: 'First version', existing: p ? p.taken : [], now: new Date().toISOString(), app: APP_VERSION }); });
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
        if (!leaveFolderOverlay('su-h')) { su.busy = false; render(); return; } state.needsReconnect = null;
        var opened = useFs(folderFs(rec), { setup: true }); su.fs = fsKey();
        return opened.then(function () {
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
    var sfs = state.fs, g = gen, expect = people.hash, expectText = people.text == null ? null : people.text;
    state.peopleSaving = true; state.peopleErr = null; render();
    queued(function () { return repo.savePeople(sfs, P.text(res.doc), expect, { lock: LOCKS ? lock : null, expectText: expectText }); }).then(function (out) {
      state.peopleSaving = false; if (g !== gen) return null;
      if (out.conflict) state.peopleErr = out.afterWrite ? 'Something else wrote people.json at the same moment. Check the list below; make your change again if it isn\'t there.' : 'people.json changed since this page was drawn, so your change wasn\'t saved. Here is the list as it is now; make your change again.';
      else { state.pick = null; if (done) done(res.person); }
      return load(true);
    }, function (e) { state.peopleSaving = false; if (g !== gen) return; state.peopleErr = 'Couldn\'t save people.json: ' + e.message; render(); });
  }

  /* Settings, Team values (2.9): one change at a time to exactly the team-values.json on screen, saved only over that; a save
     over a newer file reloads the list and asks for the change again, as people.json does. fn changes a copy of the values. */
  function changeTeam(fn, done, base) {
    var T = PF.teamValues, tv = data.teamValues || T.parse(null);
    if (!PF.people.canManage(data.people, state.me)) { state.teamErr = 'Only the folder owner and backup owner change team values.'; render(); return; }
    if (tv.state !== 'ok' && tv.state !== 'missing') { state.teamErr = tv.why || T.FILE + ' can\'t be read.'; render(); return; }
    if (tv.readOnly) { state.teamErr = tv.readOnly; render(); return; }
    if (state.teamSaving) { state.teamErr = 'Still saving the last change.'; render(); return; }
    if (base && (base.hash !== tv.hash || base.text !== tv.text)) {
      base.hash = tv.hash; base.text = tv.text;
      state.teamErr = T.FILE + ' changed since you opened Edit, so your change wasn\'t saved. The list shows it as it is now; check it and Save again.'; render(); return;
    }
    var doc = { values: {} };
    Object.keys(tv.doc.values).forEach(function (n) { var e = tv.doc.values[n]; doc.values[n] = e.about ? { value: e.value, about: e.about } : { value: e.value }; });
    var res; try { res = fn(doc); } catch (e) { state.teamErr = e.message; render(); return; }
    var why = T.check(doc);
    if (why) { state.teamErr = why; render(); return; }
    var sfs = state.fs, g = gen, expect = tv.hash == null ? null : tv.hash, expectText = tv.text == null ? null : tv.text, pk = state.pick;
    state.teamSaving = true; state.teamErr = null; render();
    queued(function () { return repo.saveTeamValues(sfs, T.text(doc), expect, { lock: LOCKS ? lock : null, expectText: expectText }); }).then(function (out) {
      state.teamSaving = false; if (g !== gen) return null;
      if (out.conflict) state.teamErr = out.afterWrite ? 'Something else wrote ' + T.FILE + ' at the same moment. Check the list below; make your change again if it isn\'t there.' : T.FILE + ' changed since this page was drawn, so your change wasn\'t saved. Here is the list as it is now; make your change again.';
      /* Only the Remove confirmation this save came from closes; a form opened since stays as it is. */
      else { if (pk && pk.kind === 'team-remove' && state.pick === pk) state.pick = null; if (done) done(res); }
      return readTeam(sfs).then(function () { if (g === gen) render(); });
    }, function (e) { state.teamSaving = false; if (g !== gen) return; state.teamErr = 'Couldn\'t save ' + T.FILE + ': ' + e.message; render(); });
  }
  /* What Settings' boxes give: trimmed (a value never has outer spaces), checked the way the file is. */
  function teamEntryOf(value, about) {
    var T = PF.teamValues, v = String(value == null ? '' : value).trim(), a = String(about == null ? '' : about).trim();
    var p = T.valueProblem(v, 'The value');
    if (p) throw Object.assign(new Error(p), { field: 'value' });
    if (a.length > T.ABOUT_MAX) throw Object.assign(new Error('What it\'s for can be at most ' + T.ABOUT_MAX + ' characters.'), { field: 'about' });
    if (/[\u0000-\u001f\u007f]/.test(a)) throw Object.assign(new Error('What it\'s for has a control character.'), { field: 'about' });
    return a ? { value: v, about: a } : { value: v };
  }

  /* ---------- rendering ---------- */
  var app = document.getElementById('app'), topEl = document.getElementById('top'), overlayEl = document.getElementById('overlay');
  /* act: an optional button on the message, like { act: 'tl-undo', id: 'draft', label: 'Undo' }. */
  /* Promote, retire or reopen the stage named on the open process page: worked out again from the folder in the queue, so
     what it does is what the folder says now, never what this page last drew. */
  function stageAct(folder, what) {
    var pid = state.processId, sfs = state.fs, pg = gen, by = state.me;
    if (!pid || !by || state.stageBusy) return;
    state.stageBusy = pid; render();
    queued(function () {
      var still = function () { return pg === gen && state.fs === sfs && state.me === by; };
      if (!still()) return { dropped: true };
      var lk = LOCKS ? lock : null;
      return what === 'promote' ? repo.promote(sfs, pid, folder, { by: by, now: new Date().toISOString(), app: APP_VERSION, lock: lk, still: still })
        : repo.decideStage(sfs, pid, folder, what, { by: by, now: new Date().toISOString(), window: WRITER, app: APP_VERSION, lock: lk, still: still });
    }).then(function (res) {
      state.stageBusy = null;
      if (res && res.dropped) { if (pg === gen) { say('Nothing was changed: another folder was opened, or the person using this window changed, before it could be saved.', 'warn'); render(); } return; }
      if (pg !== gen) return;
      if (res && res.dropped) { say('Nothing was changed: another folder was opened, or the person using this window changed, before it could be saved.', 'warn'); render(); return; }
      say(what === 'promote' ? 'Published as v' + res.version + (res.renumbered ? ': someone published v' + res.proposed + ' while it was staged' : '') + '. New runs use it; runs already started keep their version.' : what === 'retired' ? 'Retired. It stays in the folder; reopen it any time.' : 'Reopened.', 'good');
      return load(true);
    }, function (e) { state.stageBusy = null; if (pg !== gen) return; say('Couldn\'t ' + (what === 'promote' ? 'make it the default' : what === 'retired' ? 'retire it' : 'reopen it') + ': ' + e.message, 'bad'); load(true); });
  }
  /* Try again belongs to the person who started the plan, in the folder it was started in (2.1.1): another person, or another
     folder, forgets it, so switching back never brings it back. */
  /* startEpoch: bumped by every change of person or folder. A planned action (start, decline, switch, Try again) captures
     it with the folder and person it was asked in (planStill); once any of them changes, even changed back, it writes
     nothing it hasn't written yet, and announces nothing. */
  var startEpoch = 0, startMe = state.me;
  function planStill(g, fs, key, who) { var ep = startEpoch; return function () { return g === gen && ep === startEpoch && state.fs === fs && fsKey() === key && state.me === who; }; }
  /* Messages about an action whose folder or person changed before it finished (2.3.1) say which it was about. */
  function folderWord(fs) { return fs && fs.name ? fs.name : 'the folder it was in'; }
  function sameFolder(g, fs, key) { return g === gen && state.fs === fs && fsKey() === key; }
  function nothingWritten(g, fs, key, who) { return sameFolder(g, fs, key) ? 'Nothing was written for ' + personName(who) + ': the person was changed.' : 'Nothing was written to ' + folderWord(fs) + ': another folder was opened.'; }
  function aboutWhat(still, g, fs, key, who) { return still() ? '' : sameFolder(g, fs, key) ? 'For ' + personName(who) + ': ' : 'In ' + folderWord(fs) + ': '; }
  function forgetStartIfNotMine() {
    if (state.me !== startMe) { startEpoch++; startMe = state.me; }
    var gone = false;
    Object.keys(state.pendingStarts).forEach(function (id) { if (state.pendingStarts[id].me !== state.me) { delete state.pendingStarts[id]; gone = true; } });
    if (gone && state.msg && state.msg.pendingStart) state.msg = null;
  }
  function say(text, kind, act) { state.msg = text ? { text: text, kind: kind || '' } : null; if (state.msg && act) { state.msg.act = act.act; state.msg.id = act.id; state.msg.label = act.label; } }
  /* A builder change said back with a real Undo button. */
  function sayUndo(text) { say(text, 'good', { act: 'tl-undo', id: 'draft', label: 'Undo' }); }
  /* The examples kept in this tab only: a badge in the page shell, fixed above every screen, sheet and dialog. The root's
     class leaves room for it at the top (--keep-h in page.html). Messages never mention it; the badge is the one place. */
  var badgeEl = document.getElementById('tab-badge'), badgeHtml = null;
  function renderBadge() {
    var h = V.tabOnly(ctx), root = document.documentElement;
    if (badgeEl && h !== badgeHtml) { badgeEl.innerHTML = h; badgeHtml = h; }
    if (root && root.classList) { if (h) root.classList.add('tab-only'); else root.classList.remove('tab-only'); }
  }
  function renderTop() {
    renderBadge();
    var meVal = document.activeElement && document.activeElement.id === 'me' ? null : true;
    if (meVal) patch(topEl, V.top(ctx));
    pinOffsets();
    /* A refresh that redraws only the top bar still reaches an open search palette, so new data shows without typing. */
    if (!rendering && sxOpen()) later();
  }
  /* Sticky phase headers sit just under the top bar, whose height changes as it wraps on narrow screens. */
  function pinOffsets() {
    var root = document.documentElement, pl = app.querySelector && app.querySelector('.phase[data-s="open"] .placard');
    if (!root || !root.style || !topEl.offsetHeight) return;
    var bar = (topEl.closest && topEl.closest('.top')) || topEl, pinned = window.getComputedStyle && window.getComputedStyle(bar).position === 'sticky';
    root.style.setProperty('--top-h', (pinned ? bar.offsetHeight : 0) + (badgeEl && badgeEl.offsetHeight || 0) + 'px');
    if (pl && pl.offsetHeight) root.style.setProperty('--placard-h', pl.offsetHeight + 'px');
  }
  /* Crossing the phone breakpoint redraws, so the properties sheet's modal state follows the layout. */
  var wasNarrow = null;
  window.addEventListener('resize', function () { pinOffsets(); fitPanes(); var n = !!(window.matchMedia && window.matchMedia('(max-width: 800px)').matches); if (wasNarrow !== null && n !== wasNarrow) render(); wasNarrow = n; });
  /* Redraw only what changed: unchanged regions keep their nodes, so focus, the caret, typed text and scroll inside them stay.
     Nodes that differ are compared a few levels down (screen → run → deck → phase → steps → step) and replaced there. */
  function patch(el, html) {
    var tpl = document.createElement('template');
    if (!tpl.content || !el.firstChild) { el.innerHTML = html; return; }
    tpl.innerHTML = html;
    /* The phone sheets' temporary inert marks aren't in the markup: off before comparing, so the nodes under them are kept
       (and the sheet's scroll with them); sheet() puts them back after the redraw. */
    if (el === app) { obInert.forEach(function (n) { n.removeAttribute('inert'); }); obInert = []; }
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
    var fits = function (x, y) { return x.isEqualNode(y) || (x.nodeType === 1 && x.nodeName === y.nodeName && (sameAttrs(x, y) || typingIn(x, y))); };
    var i = 0, ja = as.length - 1, jb = bs.length - 1;
    while (i <= ja && i <= jb && fits(as[i], bs[i])) i++;
    while (ja >= i && jb >= i && fits(as[ja], bs[jb])) { ja--; jb--; }
    /* A changed region next to the one being typed in (a notice appearing) mustn't take it along: the new markup's match for
       it (same tag, id, class and scope) is morphed into it instead. */
    var ae = document.activeElement, keepX = null, keepY = null;
    if (dbxBox(ae)) as.slice(i, ja + 1).forEach(function (x) {
      if (keepX || x.nodeType !== 1 || !x.contains(ae)) return;
      var key = function (n) { return n.nodeType === 1 ? [n.nodeName, n.id, n.className, n.getAttribute('data-scope')].join('|') : null; };
      var y = bs.slice(i, jb + 1).filter(function (c) { return key(c) === key(x); })[0];
      if (y) { keepX = x; keepY = y; }
    });
    as.slice(i, ja + 1).forEach(function (x) { if (x !== keepX) el.removeChild(x); });
    /* The kept node never moves (moving a focused box blurs it too): the new nodes go in around it. */
    var before = as[ja + 1] || null, past = !keepX;
    bs.slice(i, jb + 1).forEach(function (y) {
      if (y === keepY) { past = true; takeAttrs(keepX, y); morph(keepX, y, depth - 1); return; }
      el.insertBefore(y, past ? before : keepX);
    });
    as.slice(0, i).concat(as.slice(ja + 1)).forEach(function (x, k) {
      var y = k < i ? bs[k] : bs[jb + 1 + (k - i)];
      if (x.isEqualNode(y)) return;
      if (typingIn(x, y)) { takeAttrs(x, y); return; }
      if (x.nodeType === 1 && (depth > 0 || (dbxBox(document.activeElement) && x.contains(document.activeElement)))) morph(x, y, depth - 1);
      else el.replaceChild(y, x);
    });
  }
  /* The detail box being typed in is never swapped for a copy (the swap fires change, which applies half-typed text, and loses the
     caret): it keeps its value and takes the new markup's attributes. Its ancestors are followed however deep it is. */
  function typingIn(x, y) { return x.nodeType === 1 && x === document.activeElement && dbxBox(x) && x.nodeName === y.nodeName && !!x.id && x.id === y.id; }
  /* Only the detail boxes change their own attributes and surroundings as you type; every other box is drawn as before. */
  function dbxBox(n) { return !!n && !!n.classList && n.classList.contains('dbx-in') && !n.hasAttribute('data-bound'); }
  function takeAttrs(x, y) {
    Array.prototype.slice.call(x.attributes).forEach(function (a) { if (!y.hasAttribute(a.name)) x.removeAttribute(a.name); });
    Array.prototype.forEach.call(y.attributes, function (a) { if (x.getAttribute(a.name) !== a.value && a.name !== 'value') x.setAttribute(a.name, a.value); });
  }
  /* A redraw can keep a control's node while its markup changed; a bound control then shows what the markup says, which is the
     state, never a stale value the browser held on to (a textarea's value stops following its text once typed in). */
  function syncBound() {
    app.querySelectorAll('[data-bound]').forEach(function (el) {
      if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== el.defaultChecked) el.checked = el.defaultChecked; return; }
      var want = el.defaultValue;
      if (el.tagName === 'SELECT') { want = el.options.length ? el.options[0].value : ''; for (var i = 0; i < el.options.length; i++) if (el.options[i].defaultSelected) want = el.options[i].value; }
      if (el.value === want) return;
      var mine = document.activeElement === el, a = el.selectionStart, b = el.selectionEnd, dir = el.selectionDirection, top = el.scrollTop, old = String(el.value);
      el.value = want;
      /* The caret and selection (and its direction) move with the text around them, through the one span that changed (a
         change that arrived while someone was reading); the scroll stays. */
      if (mine && el.setSelectionRange && a != null) try { el.setSelectionRange(mapAt(old, want, a), mapAt(old, want, b), dir || 'none'); } catch (e) { /* not a text field */ }
      if (top != null && el.scrollTop !== top) el.scrollTop = top;
    });
  }
  /* Where a position in text a lands in text b, through the one span between their common start and end. */
  function mapAt(a, b, at) {
    var n = Math.min(a.length, b.length), i = 0, j = 0;
    while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    while (j < n - i && a.charCodeAt(a.length - 1 - j) === b.charCodeAt(b.length - 1 - j)) j++;
    if (at <= i) return at;
    if (at >= a.length - j) return Math.max(0, Math.min(b.length, at + b.length - a.length));
    return b.length - j;
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
    /* Any inline form opened or closed (Fill in, Blocked, Edit, a correction, a note's correction), however it was reached, counts as moving. */
    var fsig = [state.pick ? state.pick.kind + ':' + state.pick.id : '', state.edit || '', state.corrForm ? state.corrForm.step + ':' + state.corrForm.mode : '', Object.keys(state.noteCorrs || {}).sort().join(',')].join('|');
    if (fsig !== formSig) { formSig = fsig; childEpoch++; }
    /* Revealed boxes belong to one checklist's editor: leaving it (another checklist, folder or screen) forgets them. */
    if (state.obShown && (state.view !== 'process' || state.ptab !== 'edit' || state.obShown.key.indexOf(fsKey() + '\n' + state.processId + '\n') !== 0)) state.obShown = null;
    var fill = fillShown();
    try { renderNow(); } finally { rendering = false; }
    fillAfter(fill);
    dbxAfter();
    scheduleSync();
  }
  /* Motion that answers an action; presentation only: nothing here is saved, and a redraw that replaces a node just ends it. */
  function calm() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function fillKey() { return [state.view, state.view === 'practice' ? state.processId : state.runKey, gen].join('|'); }
  /* The progress fill as the screen shows it now, mid-motion included, read before a redraw replaces it. */
  function fillShown() {
    var bar = app.querySelector('.rw-bar'), fill = bar && bar.querySelector('i');
    if (!fill || !bar.clientWidth || !fill.getBoundingClientRect) return null;
    return { key: fillDrawn, at: fill.getBoundingClientRect().width / bar.clientWidth };
  }
  /* fillDrawn names the run or practice the bar on screen was drawn for; state may already point somewhere else. */
  var fillAnim = null, fillEl = null, fillNext = null, fillDrawn = null;
  function fillAfter(was) {
    var key = fillKey(), same = !!was && was.key === key;
    fillDrawn = key;
    if (!same) { if (fillAnim) { fillAnim.cancel(); fillAnim = null; } return; }
    var bar = app.querySelector('.rw-bar'), fill = bar && bar.querySelector('i');
    if (!fill || typeof fill.animate !== 'function') return;
    var next = Number(bar.getAttribute('aria-valuenow')) / Math.max(1, Number(bar.getAttribute('aria-valuemax')));
    if (fillAnim && fillEl === fill && fillNext === next) return;
    var from = PF.vk.fillFrom(was.at, next);
    if (from === null && next > 0) return;
    if (fillAnim) { fillAnim.cancel(); fillAnim = null; }
    if (from === null || calm()) return;
    fillEl = fill; fillNext = next;
    fillAnim = fill.animate([{ transform: 'scaleX(' + from + ')' }, { transform: 'scaleX(1)' }], { duration: 450, easing: 'cubic-bezier(.2, .7, .2, 1)' });
  }
  /* A step just checked off lands: its check springs and its row glows green once. Looked up after this action's redraws. */
  function land(key, id) {
    var g = gen, v = state.view;
    requestAnimationFrame(function () {
      if (g !== gen || state.view !== v || (v === 'practice' ? state.processId : state.runKey) !== key) return;
      var row = app.querySelector('.rw #step-' + cssEsc(id));
      if (!row || typeof row.animate !== 'function' || calm()) return;
      var go = getComputedStyle(document.documentElement).getPropertyValue('--go').trim(), m = /^#([0-9a-f]{6})$/i.exec(go), n = m ? parseInt(m[1], 16) : 0x1D7650;
      row.animate([{ backgroundColor: 'rgba(' + (n >> 16) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',.24)' }, { backgroundColor: getComputedStyle(row).backgroundColor }], { duration: 900, easing: 'ease-out' });
      var chk = row.querySelector('.check');
      if (chk) chk.animate([{ transform: 'scale(.7)' }, { transform: 'scale(1.18)', offset: 0.55 }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.34, 1.56, .64, 1)' });
    });
  }
  /* Re-render without losing what someone is typing or where their focus is. */
  function renderNow() {
    PF.perf.add('render');
    /* What was just shown is this folder's: after a folder switch it's gone (gen), without the switch itself changing. */
    if (state.justShown && state.justShown.gen !== gen) state.justShown = null;
    if (state.noteShown && state.noteShown.gen !== gen) state.noteShown = null;
    sentNotes();
    justNotes();
    if (state.find && state.find.gen !== gen) state.find = null;
    if (state.justPlanned && state.justPlanned.gen !== gen) state.justPlanned = null;
    /* What the Start, Plan or test-run form's roles held at the last redraw goes to this redraw only, as 2.10's page carries
       its selects (roleCarry): none when the form is drawn afresh (planFormReset), and gone if this redraw doesn't draw it. */
    carryPrev = state.planFormReset ? null : state.roleCarry; state.roleCarry = null;
    dropBatchRender();
    repHarvest();
    corrHarvest();
    procCache = null; pplBy = { list: null, len: -1, by: null }; pplSorted = null; fixMemo = Object.create(null); fuMemo = null; insMemo = Object.create(null); repMemo = Object.create(null); repCurMemo = null;
    pruneUnapplied();
    var keep = {}, ae = document.activeElement, focusKey = null;
    /* What a person typed or ticked survives a redraw of the same thing: the same screen, run, step and open form. Moving to
       another step or form starts clean, so a note or a value never jumps to the wrong place. Hidden inputs are never carried. */
    /* Each input's scope is read from the page it's on: the old page when saving drafts, the new page when restoring them. */
    function scopeOf(el) { var z = el.closest('[data-scope]'); return (app.dataset.scope || '') + '|' + (z ? z.dataset.scope : ''); }
    /* Controls marked data-bound are drawn from state (the draft editor, the step-type form), so they're never carried over. */
    if (!state.planFormReset) app.querySelectorAll('input[id], textarea[id], select[id]').forEach(function (el) { if (el.type !== 'file' && el.type !== 'hidden' && !(el.hasAttribute && el.hasAttribute('data-bound'))) keep[el.id] = { v: el.value, c: el.checked, s: el.selectionStart, e: el.selectionEnd, box: el.type === 'checkbox' || (el.type === 'radio' && el.id.indexOf('opt-') === 0), scope: scopeOf(el) }; });
    state.planFormReset = false;
    /* A control without an id (a row's button) is found again inside its own row (actAt), never by its action alone, which
       would land on the same button in another row; its row gone, focus goes to its list's heading (rowHead). */
    var rowHead = null;
    if (ae && (app.contains(ae) || topEl.contains(ae))) {
      if (ae.id) focusKey = noteFocus(ae.id, /^[A-Za-z][\w-]*$/.test(ae.id) ? '#' + ae.id : PF.vk.byId(ae.id));
      else {
        var at = actAt(ae);
        if (at) { rowHead = listHeadOf(ae); focusKey = at.row ? rowFocus(at.row, at.sel) : at.only ? at.sel : null; }
      }
    }
    /* The thread note or correction that has focus (or holds it: its row's buttons) stays drawn by its exact anchor (one
       note, 2.11), even when newer notes push it out of the page Show earlier reached. */
    var heldLi = ae && ae.id && /^(tn|corr)-/.test(ae.id) ? ae : ae && ae !== document.body && ae.closest ? ae.closest('li[id]') : null;
    state.noteHeld = focusKey && heldLi && /^(tn|corr)-/.test(heldLi.id) ? noteHold(heldLi.id) : null;
    /* A list row with focus stays drawn while it has it, whatever a newer read sorts in above it (K.list); gone, focus goes to
       its list's heading. Only for the folder it was drawn for. */
    var heldAe = ae && ae !== document.body && holdGen === gen && (app.contains(ae) || topEl.contains(ae) || overlayEl.contains(ae)) ? ae : null, lostHead = null;
    holdGen = gen;
    var heldOut = null;
    PF.vk.focusAt = heldAe ? { inRow: function (sel, other) { return rowHas(heldAe, sel, other); }, near: function (sel) { if (!heldOut) heldOut = outerRow(heldAe); return nearRow(heldAe, heldOut, sel); }, away: function (sel, other) { return awayFrom(heldAe, sel, other); }, lost: function () { if (!lostHead) lostHead = listHeadOf(heldAe); } } : null;
    var y = window.scrollY;
    renderTop();
    followDrafts();
    /* After followDrafts: a newer draft it just took can give the selected step a Condition. */
    obGroupsSync();
    state.editor = state.processId ? editorOf(state.processId) : null;
    state.tags = (state.tagsBy || {})[state.view] || [];
    var v = state.view;
    app.dataset.scope = [v, state.runKey, state.processId, state.fs ? state.fs.id || state.fs.name : '', gen].join('|');
    var PAGES = { run: V.run, practice: V.practicePage, mission: V.mission, receipt: V.receipt, finish: V.finish, process: V.process, start: V.start, runs: V.runs, followups: V.followUpsPage, processes: V.processesPage, skills: V.skillsPage, skill: V.skill, types: V.types, settings: V.settings, 'new-process': V.newProcess, health: V.health, connection: V.connection, recovery: V.recoveryPage, setup: V.setup };
    tfPreviewFits();
    if (drawn && drawn.key === draftScope() && drawn.sel === V.runSel(ctx) && drawn.kind === (state.pick && state.pick.kind === 'fields' && state.pick.id === drawn.sel ? 'fields' : 'record')) harvest();
    /* The first time, with only the examples to show, Home is the welcome: Start your team, Join, or Look around. */
    var welcome = ctx.welcome();
    var page = (welcome ? V.setup : PAGES[v] || V.home)(ctx), was = drawn;
    carryPrev = null;
    /* In the editor, a practice open for this draft follows each change as it's applied, and where you are in it. */
    if (v === 'process' && state.ptab === 'edit') { var epx = currentProcess(); if (epx && prs[edKey(epx.id)]) { prFollow(epx); prTargetNow(epx); } }
    /* A run's panes keep their scroll when a redraw replaces one showing the same step (on a phone the inspector is a sheet
       that scrolls on its own, and a note brought into view in it must stay in view; 2.11). */
    var panes = ['rw-list', 'rw-ins'].map(function (id) { var el = document.getElementById(id); return el ? { id: id, el: el, scope: el.getAttribute('data-scope'), top: el.scrollTop } : null; }).filter(Boolean);
    patch(app, page);
    panes.forEach(function (w) { var el = document.getElementById(w.id); if (el && el !== w.el && w.top && el.getAttribute('data-scope') === w.scope && el.scrollTop !== w.top) el.scrollTop = w.top; });
    noteDrawn(page);
    repNoteDrawn(page);
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
    var asked = state.focus, askedOv = state.overlayFocus, wins = state.focusWins; state.focusWins = false;
    var target = state.focus ? document.getElementById(state.focus) || app.querySelector(state.focus) || topEl.querySelector(state.focus) : focusKey ? app.querySelector(focusKey) || topEl.querySelector(focusKey) : null;
    /* The page someone was on went away (its skill was removed): focus goes to the way back, next to the message saying so. */
    if (!target && focusKey === '#page-h') target = document.getElementById('page-back');
    /* A row that had focus is gone (a change that arrived removed it) and no dialog is open: the editor's heading, never the page. */
    if (!target && !state.overlay && focusKey && /data-act="ob-sel/.test(focusKey)) target = document.getElementById('ed-h');
    /* A list row that had focus is gone: its list's heading. */
    if (!target && lostHead && !asked) target = app.querySelector(lostHead) || topEl.querySelector(lostHead);
    /* A row's button whose row is gone, or whose row no longer has it: that list's heading, never another row's button. */
    if (!target && rowHead && !asked) target = app.querySelector(rowHead) || topEl.querySelector(rowHead);
    /* A heading taking focus (a row's, or a list's when its row went) can: it's drawn without a tab stop of its own. */
    if (target && /^H[1-6]$/.test(target.tagName || '') && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    /* A group of radios takes focus on its chosen option, else its first. */
    if (target && target.tagName === 'FIELDSET') target = target.querySelector('input:checked') || target.querySelector('input') || target;
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
    /* An open pick or edit box takes focus when it opens, then keeps it as any control does, by its id: focus the person moved
       elsewhere (Show more, a click) isn't pulled back by a later draw, and focus an action asked for wins (focusWins). */
    var pi = document.getElementById('pick-input') || document.getElementById('edit-input');
    var piKey = pi ? [pi.id, state.view, state.runKey, state.processId, state.pick ? state.pick.kind + ':' + state.pick.id : '', state.edit || ''].join('|') : '';
    if (pi && piKey !== lastPick && !wins && document.activeElement !== pi) pi.focus({ preventScroll: true });
    lastPick = piKey;
    pinOffsets();
    if (window.scrollY !== y) window.scrollTo(0, y);
    /* An open dialog isn't rebuilt by background refreshes unless its content changed, so focus inside it stays put. */
    if (sxOpen()) sxRefresh();
    var ov = state.overlay ? state.overlay.html() : '';
    PF.vk.focusAt = null;
    if (ov !== lastOverlay) {
      /* Typing in a dialog's search redraws it; focus and the caret go back to the same control. */
      var oa = document.activeElement, osel = oa && overlayEl.contains(oa) ? selectorOf(oa) : null, os = oa && oa.selectionStart;
      overlayEl.innerHTML = ov; lastOverlay = ov;
      /* A text attachment is put in as text, never as markup. */
      var tp = state.overlay && state.overlay.text != null && document.getElementById('att-text'); if (tp) tp.textContent = state.overlay.text;
      var want = state.overlayFocus || osel; state.overlayFocus = null;
      var back = want && overlayEl.querySelector(want); if (back) { back.focus(); if (os != null && back.setSelectionRange && !state.overlayFocus) try { back.setSelectionRange(os, os); } catch (e) { /* not a text field */ } }
    } else if (state.overlayFocus) {
      /* Focus asked for on a dialog whose content didn't change still goes there. */
      var to = overlayEl.querySelector(state.overlayFocus); state.overlayFocus = null; if (to && document.activeElement !== to) to.focus();
    }
    if (state.overlay) {
      /* If focus was lost (the focused control disappeared), it goes to the dialog's close button rather than the page. */
      var c = overlayEl.querySelector('#tab-only-ok, #lb-close, #rel-close, #ob-sheet-close, #tp-close, #ca-close, #ev-close, .help [data-act="close-overlay"]');
      if (c && !overlayEl.contains(document.activeElement)) c.focus();
      app.setAttribute('inert', ''); topEl.setAttribute('inert', '');
    } else { app.removeAttribute('inert'); topEl.removeAttribute('inert'); }
    /* Typed text whose box has left the screen (a mode switch, another screen) was never applied: it isn't pending. */
    if (state.obPendingField && (!document.getElementById(state.obPendingField) || app.innerHTML.indexOf('id="' + state.obPendingField + '"') < 0)) dropPending();
    if (state.obRepend) { state.obRepend = false; obRepend(); }
    editorPage();
    runPage();
    revealNow(asked, askedOv);
    fitPanes();
    sheet();
    prArrived();
    watchThumbs();
    announce();
    tick();
    lsSet('filter', state.filter);
    var nr = /^(run|finish|receipt)$/.test(state.view) && ctx.run();
    notesSeen = nr ? { run: state.runKey, notes: nr._notes || [], diffs: answersOf(nr) } : null;
  }
  /* A focused note or correction row is that note, not its place among the notes sharing its id (2.11): after a newer read
     moves its twins, focus follows the note by its whole content (PF.search.noteFind). A note that's gone, or can no longer
     be told apart, leaves focus on the inspector's title (the page's heading off the run screen), never on another note. */
  var notesSeen = null;
  /* Each step's Done differently answer, as drawn: who, when and what (a one-off row's identity, 2.11). */
  function answersOf(r) {
    var o = Object.create(null);
    Object.keys(r.steps || {}).forEach(function (k) { var d = r.steps[k] && r.steps[k].differently; if (d) o[k] = { by: d.by, at: d.at, note: d.note }; });
    return o;
  }
  /* The one-off row (a Done differently answer with no correction, V.oneOffDom: a row id no note's can be) a drawn row id
     names: { step, a (its answer as drawn) }. */
  function oneOffAt(was, id) {
    var pre = V.oneOffDom('');
    if (!was || !was.diffs || id.indexOf(pre) !== 0) return null;
    var sid = id.slice(pre.length), a = Object.prototype.hasOwnProperty.call(was.diffs, sid) ? was.diffs[sid] : null;
    return a ? { step: sid, a: a } : null;
  }
  /* Whether the run still draws that answer as a one-off row: the same step, who, when and what. */
  function oneOffNow(r, o) {
    return PF.corrections.forRun(r, PF.run.mapOf(r), { at: true }).some(function (c) { return c.oneOff && c.step === o.step && c.by === o.a.by && c.at === o.a.at && c.happened === o.a.note; });
  }
  function noteFocus(id, key) {
    var was = notesSeen, r = /^(run|finish|receipt)$/.test(state.view) && ctx.run(), S = PF.search;
    if (!was || !r || was.run !== state.runKey || !/^(tn|corr)-/.test(id)) return key;
    /* A one-off row is its answer: changed or gone, focus goes to the heading, never onto another answer in its place. */
    var off = oneOffAt(was, id);
    if (off) return oneOffNow(r, off) ? key : state.view === 'run' ? '#ins-h' : '#page-h';
    if (was.notes === r._notes) return key;
    var ats = S.noteAts(was.notes), old = null;
    for (var i = 0; i < was.notes.length && !old; i++) {
      var n = was.notes[i], corr = n.kind === 'correction' || n.kind === 'fix' || n.kind === 'map';
      if (id === (corr ? V.corrDomId(n.id, ats[i]) : V.noteDomId(n.step, S.noteKey(n.id, ats[i])))) old = n;
    }
    if (!old) return key;
    var hit = S.noteFind(r._notes || [], keepNote(state.runKey, was.notes, old));
    if (!hit) return state.view === 'run' ? '#ins-h' : '#page-h';
    var hc = hit.n.kind === 'correction' || hit.n.kind === 'fix' || hit.n.kind === 'map';
    return PF.vk.byId(hc ? V.corrDomId(hit.n.id, hit.k) : V.noteDomId(hit.n.step, hit.key));
  }
  /* Whether the row of a list's item (the element sel finds, as the page was drawn, and the row around it) holds el. A row
     around it that also holds another item (other) of the same list isn't its row: the element itself is. A row drawn as
     another element marks itself data-row, so focus on any control nested in it (a dropdown's Find box, its Show more
     choices, a value's box) holds the row (code review round 13). */
  var holdGen = null, ROW_SEL = 'li, tr, .card, .copyrow, .rep-card, .rr-rep, [data-row]';
  function rowHas(el, sel, other) {
    var t = null, o = null;
    try { t = document.querySelector(sel); o = other ? document.querySelector(other) : null; } catch (e) { return false; }
    if (!t) return false;
    var row = t.closest ? t.closest(ROW_SEL) : null;
    if (row && o && o !== t && row.contains(o)) row = null;
    row = row || t;
    return row === el || row.contains(el);
  }
  /* The outermost row around el (el itself when none). */
  function outerRow(el) {
    var r = el.closest ? el.closest(ROW_SEL) : null, up = null;
    while (r && r.parentElement && (up = r.parentElement.closest(ROW_SEL))) r = up;
    return r || el;
  }
  /* A quick look before rowHas, searching only around el, never the whole page: whether the element sel finds could be the
     one whose row holds el. Any row holding el lies inside its outermost row (out), and an element that is its own row and
     holds el is around it, so a no here is always a no for rowHas too. A list can have thousands of rows drawn last time. */
  function nearRow(el, out, sel) {
    try { return out.closest(sel) === out || !!out.querySelector(sel) || !!el.closest(sel); } catch (e) { return false; }
  }
  /* Whether el is outside the section that holds two of a list's rows (sel, other), so outside the list: one look, before
     looking row by row. A section around one row only (a report card is one) isn't the list's. */
  function awayFrom(el, sel, other) {
    var t = null, o = null; try { t = document.querySelector(sel); o = other ? document.querySelector(other) : null; } catch (e) { return false; }
    var sec = t && o && t.closest ? t.closest('section, aside, [role="dialog"], .panel') : null;
    return !!sec && sec.contains(o) && sec !== el && !sec.contains(el);
  }
  /* The heading of the list el is in: the element naming its section, or the section's first heading with an id, else the
     page's. */
  function listHeadOf(el) {
    var lab = el.closest && el.closest('section[aria-labelledby], [role="dialog"][aria-labelledby], details[aria-labelledby]'), id = lab && lab.getAttribute('aria-labelledby');
    if (id && document.getElementById(id)) return PF.vk.byId(id);
    var sec = el.closest && el.closest('section, aside, .panel'), h = sec && sec.querySelector('h1[id], h2[id], h3[id], h4[id]');
    return h && h.id ? PF.vk.byId(h.id) : '#page-h';
  }
  /* Where a control with no id of its own is (2.11): sel, its action (data-act, with data-id when it has one), and row, the id
     of the nearest element around it holding no other control with that action, so the control is found again in the same
     row (a note's Make it a follow-up, never another note's). With no such row, only: it can be found by sel alone, either
     the only one on the page, or told apart by its other data- attributes (sel then has them too), or the same command as
     every other match (the same action on the same thing, drawn twice). Otherwise only is false: nothing tells it apart, and
     focus goes to its list's heading. null for a control with no action. */
  function actAt(el) {
    if (!el || !el.dataset || !el.dataset.act) return null;
    var sel = '[data-act="' + cssEsc(el.dataset.act) + '"]' + (el.dataset.id ? '[data-id="' + cssEsc(el.dataset.id) + '"]' : '');
    for (var up = el.parentElement; up && up.nodeType === 1; up = up.parentElement) {
      if (!up.id) continue;
      var n = up.querySelectorAll ? up.querySelectorAll(sel).length : 0;
      if (n === 1) return { sel: sel, row: up.id };
      if (n > 1) break;
    }
    var matches = function (q) { var out = []; [app, topEl, overlayEl].forEach(function (r) { if (r && r.querySelectorAll) Array.prototype.push.apply(out, Array.prototype.slice.call(r.querySelectorAll(q))); }); return out; };
    if (matches(sel).length <= 1) return { sel: sel, row: null, only: true };
    var full = sel + dataSel(el), extra = Object.create(null);
    /* A data- attribute the others have and it hasn't tells it apart too (a page's History beside a step's History of this step). */
    matches(full).forEach(function (x) { Array.prototype.forEach.call(x.attributes || [], function (a) { if (/^data-/.test(a.name) && !el.hasAttribute(a.name)) extra[a.name] = true; }); });
    full += Object.keys(extra).sort().map(function (k) { return ':not([' + k + '])'; }).join('');
    var same = matches(full);
    return { sel: full, row: null, only: same.length <= 1 || same.every(function (x) { return dataSel(x) === dataSel(el); }) };
  }
  /* Every data- attribute but the action and its id, as a selector, in name order. */
  function dataSel(el) {
    var out = [];
    Array.prototype.forEach.call(el.attributes || [], function (a) { if (/^data-/.test(a.name) && a.name !== 'data-act' && a.name !== 'data-id') out.push('[' + a.name + '="' + cssEsc(a.value) + '"]'); });
    return out.sort().join('');
  }
  /* The selector for a control inside the row with this id: a note or correction row by its note (noteFocus), so a newer read
     that renumbers twins keeps it on the same note; the note gone, the heading noteFocus names. */
  function rowFocus(rowId, sel) {
    var key = noteFocus(rowId, PF.vk.byId(rowId));
    return key === '#ins-h' || key === '#page-h' ? key : key + ' ' + sel;
  }
  /* A run's folder, as its reader names it: where its notes' attachments must be for a read to keep them. */
  function runBase(r) { return 'runs/' + r.process + '/' + r.id + '/'; }
  /* A note kept across redraws, for this folder only (gen): PF.search.noteKeep, the one way a note is held by what it is. */
  function keepNote(key, notes, n, step, sent) { var t = PF.search.noteKeep(key, notes, n, step, sent); if (t) t.gen = gen; return t; }
  /* A note or correction this window just saved (state.noteSent), until a read has it: the read right after the save may not
     yet (another read in progress). Found, it's kept by what it is from then on: a note in its step's thread (state.noteShown,
     brought into view) or a correction in its step's list (just shown, focused). Found by the whole record it was written
     with, as a read gives it back (PF.search.noteRead), never by its id alone, which a twin shares (code review round 22). */
  function sentNotes() {
    var ns = state.noteSent; if (!ns) return;
    if (ns.gen !== gen) { state.noteSent = null; return; }
    var r = ctx.findRun(ns.run), notes = r ? r._notes || [] : [], t = keepNote(ns.run, notes, null, ns.step, ns.sent), hit = t && PF.search.noteFind(notes, t);
    if (!hit) return;
    state.noteSent = null;
    var here = state.view === 'run' && state.runKey === ns.run;
    if (ns.corr) { if (here) ensureListItemVisible('rcorr:' + ns.run + ':' + ns.step, hit.key, { note: t, focus: PF.vk.byId(V.corrDomId(hit.n.id, hit.k)), word: 'added' }); return; }
    state.noteShown = t;
    if (here && state.sel === ns.step) revealAt(PF.vk.byId(V.noteDomId(ns.step, hit.key)));
  }
  /* A list's just-shown row that is a note (a correction just saved, ensureListItemVisible's o.note) is found again by what it
     is at every draw, and shown by its key then; gone, no row is shown in its place (code review round 21). */
  function justNotes() {
    var js = state.justShown; if (!js || !js.notes) return;
    Object.keys(js.notes).forEach(function (list) {
      var t = js.notes[list], r = ctx.findRun(t.run), hit = r ? PF.search.noteFind(r._notes || [], t) : null;
      if (hit) js.lists[list] = hit.key; else delete js.lists[list];
    });
  }
  function noteHold(id) {
    var was = notesSeen, S = PF.search;
    if (!was || was.run !== state.runKey || !/^(tn|corr)-/.test(id)) return null;
    var ats = S.noteAts(was.notes);
    for (var i = 0; i < was.notes.length; i++) {
      var n = was.notes[i], corr = n.kind === 'correction' || n.kind === 'fix' || n.kind === 'map';
      if (id !== (corr ? V.corrDomId(n.id, ats[i]) : V.noteDomId(n.step, S.noteKey(n.id, ats[i])))) continue;
      return keepNote(state.runKey, was.notes, n);
    }
    /* A one-off row (Done differently, no correction) is held by its answer. */
    var off = oneOffAt(was, id);
    return off ? { gen: gen, run: state.runKey, step: off.step, oneOff: off.a } : null;
  }
  var lastOverlay = '', lastPick = '';
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
    reveal(s.kind === 'step' ? '[data-ob-step="' + cssEsc(s.key) + '"]' : s.kind === 'track' ? '.ob-lane.sel' : s.kind === 'details' ? '.ob-details' : s.kind === 'questions' ? '#ob-q-note' : '[data-ob-phase="' + cssEsc(s.key) + '"]');
    reveal('#pv-sel', 'center');
  }
  /* The run screen is a page of its own too: the top bar hides and, on a wider screen, each pane scrolls on its own. Next up
     sticks under the header on a phone, whatever height the header wraps to. Pane positions saved on the way to screen share
     come back on the way out. */
  function runPage() {
    var on = (state.view === 'run' && !!ctx.run()) || state.view === 'practice', de = document.documentElement;
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
  /* Resizable sidebars (V.splitter). After each redraw and on a window resize, each panes container on screen is fitted as a
     whole (V.fitPanes) from its width and the widths chosen; a sidebar left at the layout's width is measured. A change redraws
     once, so the separators say the real widths, and a chosen width is clamped to the window while the choice is kept. */
  function fitPanes() {
    var fit = {}, changed = false, boxes = [];
    Array.prototype.forEach.call(app.querySelectorAll ? app.querySelectorAll('.pane-split') : [], function (sp) { if (sp.parentNode && boxes.indexOf(sp.parentNode) < 0) boxes.push(sp.parentNode); });
    boxes.forEach(function (box) {
      if (!box.clientWidth) return;
      var items = [], shown = false;
      Array.prototype.forEach.call(box.children, function (c) {
        var k = c.getAttribute('data-split'), spec = k && V.PANES[k], pane = spec && document.getElementById(spec.controls);
        /* Hidden where the panes stack (a phone): nothing there to fit. */
        if (!pane || !c.offsetParent) return;
        var fixed = window.getComputedStyle(c).visibility === 'hidden';
        if (!fixed) shown = true;
        items.push({ key: k, fixed: fixed, pref: state.panes[k], measured: pane.getBoundingClientRect().width });
      });
      if (!shown) return;
      var f = V.fitPanes(box.clientWidth, items);
      Object.keys(f).forEach(function (k) { fit[k] = f[k]; });
    });
    if (!Object.keys(fit).length) return;
    Object.keys(fit).forEach(function (k) { var was = state.paneFit[k]; if (!was || was.w !== fit[k].w || was.max !== fit[k].max) changed = true; });
    state.paneFit = fit;
    if (changed) render();
  }
  function paneSet(key, w) {
    var spec = V.PANES[key]; if (!spec) return;
    if (w == null) delete state.panes[key];
    else { var lim = V.paneW(ctx, key); state.panes[key] = Math.round(Math.max(lim.min, Math.min(lim.max, w))); }
  }
  /* While dragging, only the panes' variable and the separator's value change, written exactly as the view draws them. */
  function paneLive(sp) {
    var box = sp.parentNode, keys = Array.prototype.map.call(box.querySelectorAll(':scope > .pane-split'), function (x) { return x.getAttribute('data-split'); });
    var css = V.paneStyle(ctx, keys);
    if (css) box.setAttribute('style', css); else box.removeAttribute('style');
    sp.setAttribute('aria-valuenow', String(V.paneW(ctx, sp.getAttribute('data-split')).w));
  }
  function paneDone(key) { lsSet('panes', state.panes); state.focus = '.pane-split[data-split="' + key + '"]'; render(); }
  /* Left and Right move the separator 16px (Shift: 64px), Home and End go to the narrowest and widest, Enter puts it back. */
  function paneKey(key, e) {
    var spec = V.PANES[key], lim = V.paneW(ctx, key), step = e.shiftKey ? 64 : 16, dir = spec.end ? -1 : 1;
    if (e.key === 'ArrowLeft') paneSet(key, lim.w - dir * step);
    else if (e.key === 'ArrowRight') paneSet(key, lim.w + dir * step);
    else if (e.key === 'Home') paneSet(key, lim.min);
    else if (e.key === 'End') paneSet(key, lim.max);
    else if (e.key === 'Enter') paneSet(key, null);
    else return false;
    paneDone(key);
    return true;
  }
  /* Dragging: the pointer is captured, so a fast move past the editor's edge keeps resizing, and nothing is selected. The drag
     is known by its sidebar, and each move uses the separator the page has now (a redraw can replace it); if it's gone, or
     the pointer is released, canceled, loses capture or the window loses focus, the drag ends and text can be selected again. */
  var paneDrag = null;
  function rootClass(c, on) { var de = document.documentElement; if (de && de.classList) de.classList[on ? 'add' : 'remove'](c); }
  function liveSplit(key) { return app.querySelector ? app.querySelector('.pane-split[data-split="' + key + '"]') : null; }
  function paneCapture(sp, id) { try { sp.setPointerCapture(id); return true; } catch (x) { return false; } }
  /* A press anywhere (a divider dragged, a box clicked into) is activity too, for Stage from Practice. */
  document.addEventListener('pointerdown', function () { uiActs++; }, true);
  document.addEventListener('pointerdown', function (e) {
    var sp = e.target && e.target.closest && e.target.closest('.pane-split'), spec = sp && V.PANES[sp.getAttribute('data-split')];
    if (!spec || e.button !== 0) return;
    var pane = document.getElementById(spec.controls); if (!pane) return;
    e.preventDefault();
    if (paneDrag) paneDragEnd();
    sp.focus({ preventScroll: true });
    paneCapture(sp, e.pointerId);
    paneDrag = { sp: sp, key: sp.getAttribute('data-split'), id: e.pointerId, x: e.clientX, w: pane.getBoundingClientRect().width };
    rootClass('pane-drag', true);
  });
  document.addEventListener('pointermove', function (e) {
    if (!paneDrag || e.pointerId !== paneDrag.id) return;
    var sp = liveSplit(paneDrag.key);
    if (!sp) { paneDragEnd(); return; }
    if (sp !== paneDrag.sp) { paneDrag.sp = sp; paneCapture(sp, paneDrag.id); }
    var dx = e.clientX - paneDrag.x;
    paneSet(paneDrag.key, paneDrag.w + (V.PANES[paneDrag.key].end ? -dx : dx));
    paneLive(sp);
  });
  function paneDragEnd() {
    if (!paneDrag) return;
    var d = paneDrag; paneDrag = null;
    rootClass('pane-drag', false);
    var sp = liveSplit(d.key);
    if (sp) try { sp.releasePointerCapture(d.id); } catch (x) { /* already released */ }
    paneDone(d.key);
  }
  function paneDragStop(e) { if (paneDrag && e.pointerId === paneDrag.id) paneDragEnd(); }
  document.addEventListener('pointerup', paneDragStop);
  document.addEventListener('pointercancel', paneDragStop);
  /* Capture moves to the new separator when a redraw replaced the old one mid-drag; otherwise losing it ends the drag. */
  document.addEventListener('lostpointercapture', function (e) {
    if (!paneDrag || e.pointerId !== paneDrag.id) return;
    var sp = liveSplit(paneDrag.key);
    if (sp && sp !== paneDrag.sp && paneCapture(sp, paneDrag.id)) { paneDrag.sp = sp; return; }
    paneDragEnd();
  });
  window.addEventListener('blur', paneDragEnd);
  document.addEventListener('dblclick', function (e) {
    var sp = e.target && e.target.closest && e.target.closest('.pane-split');
    if (!sp || !V.PANES[sp.getAttribute('data-split')]) return;
    paneSet(sp.getAttribute('data-split'), null); paneDone(sp.getAttribute('data-split'));
  });
  function savePanes() { var k = { key: state.runKey }; ['rw-list', 'rw-ins'].forEach(function (id) { var el = document.getElementById(id); if (el) k[id] = el.scrollTop; }); state.paneScroll = k; }
  /* On a phone the step panel covers the screen, so it behaves like a dialog: the rest is inert, focus moves into it, and
     closing returns focus to the step it came from. */
  /* sheetFor: the sheet opens on something inside it (a note from search, 2.11), which keeps focus instead of Close. */
  var sheetWasOpen = false, obSheetOpen = false, obInert = [], sheetFor = null;
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
    var open = !!(narrow && ref && (state.view === 'run' || state.view === 'practice'));
    app.querySelectorAll('.rw-head, .rw-strip, .rw-alerts, .rw-rail, .rw-list').forEach(function (el) { if (open) el.setAttribute('inert', ''); else el.removeAttribute('inert'); });
    if (open) { topEl.setAttribute('inert', ''); ref.setAttribute('role', 'dialog'); ref.setAttribute('aria-modal', 'true'); if ((!sheetWasOpen || !ref.contains(document.activeElement)) && !(state.view === 'practice' && ref.contains(document.activeElement)) && !(sheetFor && ref.contains(document.activeElement))) { var c = ref.querySelector('.close'); if (c) c.focus(); }
      /* The sheet's layout comes after the draw's reveal, so what it opened on is brought into view again inside it. */
      var on = null; try { on = sheetFor ? ref.querySelector(sheetFor) : null; } catch (e) { on = null; } if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' }); }
    else if (!state.overlay) topEl.removeAttribute('inert');
    sheetFor = null;
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
  /* Inside a quoted selector, CSS.escape's output is valid too; without it, PF.vk.cssStr (quotes, backslashes, control characters). */
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : PF.vk.cssStr(s); }

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
      var t = p._status || p._decidedEarlier ? null : V.planWhen(p);
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
  /* Timed on both clocks: the time since the last beat is the larger of elapsed time (performance.now, which some systems
     pause while the computer sleeps) and wall-clock time (which a person can set back), counted once. So setting the clock
     back never delays a refresh, and waking from sleep never hides how long it's been. */
  var beat = { mono: elapsed(), wall: Date.now(), v: 0 };
  function since() {
    var m = elapsed(), w = Date.now();
    beat.v += Math.max(0, m - beat.mono, w - beat.wall); beat.mono = m; beat.wall = w;
    return beat.v;
  }
  var lastRun = -Infinity, lastAll = -Infinity;
  function inRun() { return state.view === 'run' || state.view === 'mission' || state.view === 'receipt' || state.view === 'finish'; }
  setInterval(function () {
    var now = since();
    if (document.hidden || isBusy() || !state.fs || loading) return;
    if ((state.view === 'connection' || (state.view === 'setup' && state.setup && state.setup.step === 'second')) && now - lastConn >= PF.connection.EVERY_MS) { lastConn = now; loadConn(); }
    if (inRun() && now - lastRun >= 5000) { lastRun = now; refreshRun(); return; }
    if (now - lastAll >= (inRun() ? 60000 : 30000)) { lastAll = now; load(); }
  }, 1000);
  /* resumed: after a gap, the whole folder is due too, so it's read right after the open run. A plain focus rereads only
     the open run. */
  function refreshNow(resumed) { if (!state.fs || isBusy() || document.hidden) return; var now = since(); if (inRun()) { lastRun = now; if (resumed === true) lastAll = -Infinity; refreshRun(); } else { lastAll = now; load(); } }
  window.addEventListener('focus', function () { var gap = Date.now() - beat.wall; refreshNow(gap > 60000 || gap < -120000); });
  /* Coming back (the tab shown again, the page restored, the network back) after more than a minute on the wall clock
     without a beat (the computer slept): refresh at once. The folder's own clock (repo) then finds everything past its age. */
  function resumed() { var gap = Date.now() - beat.wall; if (gap > 60000 || gap < -120000) refreshNow(true); else since(); }
  document.addEventListener('visibilitychange', resumed);
  window.addEventListener('pageshow', resumed);
  window.addEventListener('online', resumed);

  /* ---------- saving ---------- */
  /* Resolves true once the change is in the team folder, false if it isn't. The save always goes to the folder the change was
     made in, even if someone switches folders while it's queued. */
  function save(r, opts) {
    var fs = state.fs, g = gen, endBusy = busyStart(), rev = edits(r.id), pend = state.pendingSaves;
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
        landed._fileHash = repo.fileHash(wrote.text); landed._overflow = [];
        var landedText = JSON.stringify(landed);
        keepBaseline(r.id, function () { return JSON.parse(landedText); });
        finishAccepts(key);
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
        var reread = [];
        return repo.loadRun(fs, r.process, r.id, null, false, false, reread).then(null, function (e) { reread.push({ why: 'couldn\'t be read (' + (e && e.message || String(e)) + ')' }); return null; }).then(function (fresh) {
          if (g !== gen) return false;
          /* A reread that isn't this run (unreadable, gone, or another run's file) is said, so what's on screen stops counting. */
          if (!fresh) applyRunRead(r.process + '/' + r.id, at, reread.length ? { kind: 'unreadable', why: reread[0].why } : { kind: 'missing' });
          var replaced = !!fresh && !!applyRunRead(r.process + '/' + r.id, at, { kind: 'fresh', run: fresh });
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
      state.unsaved[r.id] = r; state.saveErr[r.id] = e.message; state.saveOpts[r.id] = opts;
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
  /* What starting stepId's child needs, worked out once from the run as it is now, or null (and why, said). A step with a
     pass: line (2.8) also gets its rows, the details its child asks, and the passed values that don't convert to the child's
     kind; the start dialog shows those, and its guard (childStale) compares this with the run as it is later. */
  function childPrep(stepId) {
    var parent = ctx.run(), map = parent && R.mapOf(parent), x = map && M.findStep(map, stepId);
    if (!x || !ctx.recording(parent)) return null;
    var f = R.fieldsOf(parent, x.step), target = PF.pins.childTarget(parent, x.step, ctx.procOf), pub = target.pub, a0 = Object.prototype.hasOwnProperty.call(parent.steps, stepId) ? parent.steps[stepId] : null, rkey = state.runKey + ':' + stepId;
    /* One start at a time per step: a second click while the first is saving, or a step that already has a current child, does nothing. */
    if ((state.startingChild = state.startingChild || {})[rkey] || (a0 && a0.child && R.childCurrent(parent, x.step, a0) && !a0.child.failed && !(ctx.findRun(a0.child.process + '/' + a0.child.id) && R.childHeld(parent, stepId, ctx.findRun(a0.child.process + '/' + a0.child.id), ctx.procOf))) || parent.paused) return null;
    /* A run/3 starts the child on its pin and only its pin; a run/2 never starts one on a 2.0 version (it offers a 2.0 run). */
    if (target.legacy || !pub) { say(target.why || '"' + f.process + '" isn\'t published in this folder yet.', 'warn'); render(); return null; }
    /* Conditions (2.1): the step must be needed and its phase open, now and again when the queued write runs. */
    var cw = R.canStartChild(parent, map, stepId);
    if (cw) { say(cw, 'warn'); render(); return null; }
    var cp = R.childProblem(parent, x.step, pub.map.meta.context);
    if (cp) { say(cp, 'warn'); render(); return null; }
    var link2 = PF.links.has(x.step), details = R.childDetails(parent, x.step, link2 ? pub.map : pub.map.meta.context), inputs = {};
    if (link2) inputs = PF.links.inputs(parent, R.effStep(parent, x.step), Object.keys(parent.details), pub.map);
    else {
      /* The child counts for exactly the details it was started with: snapshot them now, before any save can let them change. */
      var own = String(f.sets || '').split(',').map(function (k) { return k.trim(); });
      Object.keys(details).forEach(function (k) { inputs[k] = details[k]; }); (x.step.binds || []).forEach(function (k) { inputs[k] = parent.details[k] || ''; });
      own.forEach(function (k) { delete inputs[k]; });
    }
    var rows = link2 ? PF.links.rows(R.effStep(parent, x.step), Object.keys(parent.details), pub.map).rows : [], setBy = M.setBy(pub.map), ask = [], open = [];
    /* Team values (2.9): each looked up now (prep.team), never part of details or inputs. A set one is passed like a parent
       detail (teamSrc); one that isn't set is asked (teamAsk); one that can't be read refuses the start with the reason. */
    var team = [], teamSrc = {}, teamAsk = [], bad = '';
    rows.forEach(function (r) {
      if (r.source !== 'team' || bad) return;
      var res = PF.teamValues.lookup(data.teamValues, r.team);
      if (res.unreadable || res.malformed || res.newer) { bad = res.why + ' So the team value ' + r.team + ' can\'t be read, and nothing was started.'; return; }
      team.push({ name: r.name, team: r.team, result: res });
      if (res.missing) { if (!Object.prototype.hasOwnProperty.call(setBy, r.name)) { teamAsk.push(r.name); ask.push(r.name); } }
      else teamSrc[r.name] = res.value;
    });
    if (bad) { say(bad, 'warn'); render(); return null; }
    rows.forEach(function (r) {
      if (r.source === 'ask') { if (!Object.prototype.hasOwnProperty.call(setBy, r.name)) ask.push(r.name); return; }
      if (r.source === 'team' && !Object.prototype.hasOwnProperty.call(teamSrc, r.name)) return;
      var def = R.typedDef({ snapshot: '' }, pub.map, 'details.' + r.name), v = Object.prototype.hasOwnProperty.call(teamSrc, r.name) ? teamSrc[r.name] : Object.prototype.hasOwnProperty.call(details, r.name) ? details[r.name] : '';
      var m = def && v !== '' ? R.migrateDetail(def, v) : null;
      if (m && m.verdict !== 'exact' && m.verdict !== 'converted') open.push(r.name);
    });
    return { stepId: stepId, rkey: rkey, key: state.runKey, gen: gen, me: state.me, step: x.step, f: f, target: target, pub: pub, link2: link2, details: details, inputs: inputs, rows: rows, ask: ask, open: open,
      team: team, teamSrc: teamSrc, teamAsk: teamAsk, epoch: childEpoch,
      linked: a0 && a0.child ? a0.child.process + '/' + a0.child.id + (a0.child.failed ? ' failed' : '') : '' };
  }
  /* The guard on a pass: step's start (2.8), asked on submit and again right before the first write: '' when the run, the
     person, the child's version and what this step passes are what prep saw, or what changed. */
  function childStale(prep) {
    if (gen !== prep.gen) return 'The team folder changed while you were filling this in, so nothing was started.';
    var cur = findRun(prep.key);
    if (!cur) return 'The run isn\'t in the folder anymore.';
    if (state.me !== prep.me || !ctx.recording(cur)) return 'You aren\'t recording this run anymore, so nothing was started.';
    var map = R.mapOf(cur), x = M.findStep(map, prep.stepId);
    if (!x) return 'This step isn\'t in the run anymore.';
    var why = R.canStartChild(cur, map, prep.stepId);
    if (why) return why;
    var t = PF.pins.childTarget(cur, x.step, ctx.procOf), title = prep.pub.map.meta.title;
    if (!t.pub || t.legacy || t.pub.info.folder !== prep.pub.info.folder) return 'Another version of ' + title + ' was published while you were filling this in. Check the form, then start again.';
    var a = Object.prototype.hasOwnProperty.call(cur.steps, prep.stepId) ? cur.steps[prep.stepId] : null;
    if ((a && a.child ? a.child.process + '/' + a.child.id + (a.child.failed ? ' failed' : '') : '') !== prep.linked) return 'Another ' + title + ' run was linked to this step while you were filling this in. Check the step, then start again if it still needs one.';
    var cp = R.childProblem(cur, x.step, t.pub.map.meta.context);
    if (cp) return cp;
    var now = PF.links.inputs(cur, R.effStep(cur, x.step), Object.keys(cur.details), t.pub.map), was = prep.inputs;
    if (Object.keys(now).length !== Object.keys(was).length || Object.keys(was).some(function (k) { return !Object.prototype.hasOwnProperty.call(now, k) || now[k] !== was[k]; }) || JSON.stringify(R.childDetails(cur, x.step, t.pub.map)) !== JSON.stringify(prep.details))
      return 'A detail this run passes changed while you were filling this in. Check the form, then start again.';
    return '';
  }
  /* The team values' guard (2.9), kept apart from childStale: '' when every team value prep looked up reads the same in tv (the
     app's accepted team values), or what changed. Asked on submit, in the prewrite against a fresh read, and in still. */
  function teamStale(prep, tv) {
    var T = PF.teamValues, ch = (prep.team || []).filter(function (e) {
      var now = T.lookup(tv, e.team), was = e.result;
      return !!now.missing !== !!was.missing || (now.value != null) !== (was.value != null) || (now.value != null && now.value !== was.value) || !!(now.unreadable || now.malformed || now.newer);
    })[0];
    if (!ch) return '';
    var now = T.lookup(tv, ch.team);
    if (now.unreadable || now.malformed || now.newer) return now.why + ' So the team value ' + ch.team + ' can\'t be read, and nothing was started.';
    return 'The team value ' + ch.team + ' changed while you were filling this in.';
  }
  /* What a start that was refused keeps (2.9): the answers and roles submitted, stamped with where they were given, and what
     each team value was then, so a refill knows which boxes still mean what they did. */
  function childKeep(prep, asked, roles) {
    var was = {}; (prep.team || []).forEach(function (e) { was[e.name] = e.result.value != null ? e.result.value : null; });
    return { gen: prep.gen, key: prep.key, step: prep.stepId, token: prep.token, values: asked || {}, roles: roles || null, teamAsk: (prep.teamAsk || []).slice(), teamWas: was };
  }
  /* A new prep filled from what was kept: answers to boxes that still ask the same thing. A team value that was missing (so
     the person typed it) and is now set isn't submitted: it's said (replaced), or, when it doesn't convert, its box opens as
     a correction, empty, with a note. A team value that changed otherwise starts its box over. */
  function childRefill(np, kept) {
    var own = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };
    np.values = {}; np.replaced = {}; np.notes = {};
    if (kept.roles) np.roleVals = kept.roles;
    Object.keys(kept.values || {}).forEach(function (k) {
      var typedThen = (kept.teamAsk || []).indexOf(k) >= 0, isTeam = own(kept.teamWas, k), nowSet = own(np.teamSrc, k), v = kept.values[k];
      if (typedThen && nowSet) {
        if (np.open.indexOf(k) >= 0) { np.values[k] = ''; np.notes[k] = 'The team value is now "' + np.teamSrc[k] + '", which doesn\'t fit here. You typed ' + v + ' before.'; }
        else if (String(v).trim()) np.replaced[k] = v;
        return;
      }
      if (isTeam && (kept.teamWas[k] || null) !== (nowSet ? np.teamSrc[k] : null)) return;
      if (np.ask.indexOf(k) >= 0 || np.open.indexOf(k) >= 0) np.values[k] = v;
    });
  }
  /* The one way a refused start comes back (2.9): the form reopens, rebuilt from the app's accepted team values, with the
     answers kept, when nothing has moved since (the same folder, the run view on the same run, no dialog open, and no
     navigation or form opened or closed since the start). Otherwise it says why and the answers wait in childKept. */
  function childRetry(prep, why, asked, roles) {
    var keep = childKeep(prep, asked, roles), cur = findRun(prep.key);
    var here = gen === prep.gen && state.view === 'run' && state.runKey === prep.key && !!cur && !state.overlay && childEpoch === prep.epoch;
    var np = here ? childPrep(prep.stepId) : null;
    if (!np) { (state.childKept = state.childKept || {})[prep.rkey] = keep; say(why + ' What you filled in is kept for when you start it again.', 'warn'); render(); return; }
    np.token = ++childToken; childRefill(np, keep); np.error = why; say(why, 'warn');
    openOverlay({ childStart: np, html: function () { return V.childStart(ctx, this.childStart); }, held: function () { return csHeld(this.childStart); } });
    state.overlayFocus = '#cs-err';
  }
  function startChild(stepId) {
    var prep = childPrep(stepId);
    if (!prep) return;
    /* 2.8: a pass: step opens its start dialog only when something needs asking or converting (Q2); otherwise it starts now. */
    /* What a start that couldn't be saved was given comes back once, in the same folder: in the form, even when nothing needs
       asking now, so the roles chosen then are shown before it starts. */
    var kept = prep.link2 && state.childKept && state.childKept[prep.rkey];
    if (kept) { delete state.childKept[prep.rkey]; if (kept.gen !== gen) kept = null; }
    if (prep.link2 && (prep.ask.length || prep.open.length || kept)) {
      prep.token = ++childToken;
      if (kept) { if (kept.teamWas) childRefill(prep, kept); else { prep.values = kept.values; prep.roleVals = kept.roles; } }
      openOverlay({ childStart: prep, html: function () { return V.childStart(ctx, this.childStart); }, held: function () { return csHeld(this.childStart); } });
      state.overlayFocus = '#cs-t';
      return;
    }
    launchChild(prep, {}, null);
  }
  var childToken = 0;
  /* Counts what the person did since a start was submitted: every click on a control but Refresh, every key, navigation and
     every form opened or closed. A refused start reopens its form only when nothing happened since (childRetry); otherwise
     its answers wait for the next start. */
  var childEpoch = 0, formSig = '';
  /* An answer or a changed role in the child's start dialog is kept on prep, so after a redraw the boxes hold it as their
     own value and dirtyControl() no longer sees it: navigation asks this instead. */
  function csHeld(prep) {
    var vals = prep.values || {}, rv = prep.roleVals || {}, parent = findRun(prep.key), had = (parent && parent.roles) || {};
    if (Object.keys(vals).some(function (k) { return String(vals[k] == null ? '' : vals[k]).trim() !== ''; })) return true;
    return Object.keys(rv).some(function (k) { return String(rv[k] || '') !== String(had[k] || ''); });
  }
  /* Start prep's child with asked (the dialog's values, by the child's names) and roles (null: the parent's same-name roles).
     invalid(err): from the dialog, told when a value can't start the run (the dialog stays open); it closes once one can. */
  function launchChild(prep, asked, roles, invalid) {
    var parent = findRun(prep.key), map = parent && R.mapOf(parent), stepId = prep.stepId, pub = prep.pub, target = prep.target, rkey = prep.rkey;
    if (!parent) return;
    var teamSrc = prep.teamSrc || {}, details = Object.assign({}, prep.details, teamSrc, asked || {});
    if (!roles) { roles = {}; pub.map.meta.roles.forEach(function (ro) { roles[ro] = parent.roles[ro] || ''; }); }
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (err) { tz = ''; }
    var inputs = prep.inputs;
    var child; try { child = R.create(pub, { title: pub.map.meta.title + ' for ' + parent.title, details: details, from: { source: 'carry', details: Object.assign({}, prep.details, teamSrc) }, roles: roles, by: state.me, session: SESSION, now: new Date().toISOString(), tz: tz, workflows: data.jira.workflows, parent: { process: parent.process, id: parent.id, step: stepId, inputs: inputs, folder: parent.folder }, app: APP_VERSION, pins: pinsAtStart(pub) }); }
    catch (err) { if (invalid) { invalid(err); return; } say(err.message, 'warn'); render(); return; }
    /* Whatever stops this start, what it was given is kept with where each value came from (childKeep). */
    var keep = childKeep(prep, asked, roles);
    if (invalid) closeOverlay();
    prep.epoch = childEpoch;
    /* Try the link on a copy first, so a step that can't take a child never leaves an orphan run in the folder. */
    var link = { process: child.process, id: child.id, inputs: inputs, folder: pub.info.folder, mapHash: pub.info.mapHash, typesHash: pub.info.typesHash, format: child.format, pin: target.first ? target.pin : null };
    /* What each team value passed was (2.9): its text as read, or typed by the person when it wasn't set. */
    if ((prep.team || []).length) { link.teamPassed = {}; prep.team.forEach(function (e) { link.teamPassed[e.name] = e.result.value != null ? { text: e.result.value } : { typed: true }; }); }
    var lopts = { run: child, procOf: ctx.procOf, findRun: ctx.findRun };
    try { R.linkChild(JSON.parse(JSON.stringify(parent)), map, stepId, link, state.me, new Date().toISOString(), lopts); }
    catch (err) { say(err.message, 'warn'); render(); return; }
    var sfs = state.fs, sg = gen, key = state.runKey, endBusy = busyStart(), stale = '';
    state.startingChild[rkey] = true;
    var done = function () { endBusy(); delete state.startingChild[rkey]; };
    /* A pass: step's guard runs in the queued check and again after saveRun's reads, right before it writes (D4). */
    var saveOpts = { writer: WRITER, lock: LOCKS ? lock : null };
    if (prep.link2) saveOpts.still = function () { stale = childStale(prep) || teamStale(prep, data.teamValues); return !stale; };
    /* A start that passes a team value reads team-values.json again right before it writes; a read another folder's or a
       value changed since the form was built writes nothing. */
    if ((prep.team || []).length) saveOpts.prewrite = function (fs) {
      return readTeam(fs).then(function (acc) {
        if (!acc) { stale = 'The team folder changed while you were filling this in, so nothing was started.'; return false; }
        stale = teamStale(prep, acc); return !stale;
      });
    };
    queued(function () {
      var cur = findRun(key), why = cur ? R.canStartChild(cur, R.mapOf(cur), stepId) : 'The run isn\'t in the folder anymore.';
      /* A start refused in the queue (the parent paused, say) comes back through childRetry, its answers kept with where each
         came from. */
      if (why && prep.link2) { stale = why; throw Object.assign(new Error(why), { dropped: true }); }
      if (why) throw new Error(why);
      /* A guard refused in the queue comes back the way a refusal at the write does: through childRetry. */
      if (prep.link2) { stale = childStale(prep) || teamStale(prep, data.teamValues); if (stale) throw Object.assign(new Error(stale), { dropped: true }); }
      child.recorder.session = SESSION; return repo.saveRun(sfs, child, SESSION, saveOpts);
    }).then(function () {
      if (sg !== gen) { done(); return; }
      return mutateRun(key, sg, function (r, m, me, now) { R.linkChild(r, m, stepId, link, me, now, lopts); }).then(function (ok) {
        done();
        if (sg !== gen) return;
        if (ok === false) { say('"' + child.title + '" was started but isn\'t linked to this step yet. Use Link it on the step.', 'warn'); render(); return load(true); }
        say('Started "' + child.title + '". This step is checked when it completes.', 'good'); return load(true);
      });
    }, function (err) {
      done(); if (sg !== gen) return;
      if (err && err.dropped && stale && prep.link2) { childRetry(prep, stale, asked, roles); return; }
      /* A pass: step's start comes back in its form next time, with what it was given (startChild); an older step's has no form. */
      if (prep.link2) (state.childKept = state.childKept || {})[rkey] = keep;
      var again = prep.link2 ? ' What you filled in is kept for when you start it again.' : '';
      if (err && err.dropped && stale) { say(stale + again, 'warn'); render(); return; }
      say('Couldn\'t start the run: ' + err.message + again, 'bad'); render();
    });
  }
  /* The children a run/3 on pub follows, pinned when it starts: the version's own pins, the rest at the latest usable now. */
  function pinsAtStart(pub) {
    if (pub.info.format !== PF.publish.FORMAT2) return null;
    return PF.pins.atStart(pub.map, pub.info.payload && pub.info.payload.pins, ctx.procOf);
  }
  /* "Start it as a Flightdeck 2.0 run": a run/2 parent whose child needs Flightdeck 2.0 continues as a run/3 on the same /1
     version, chosen by a person: details and roles copied, no answers, its children pinned now. The old step is then Blocked,
     "Continued in run <key>", an answer every copy reads. */
  function continueTwo(stepId) {
    var old = ctx.run(), map = old && R.mapOf(old), x = map && M.findStep(map, stepId);
    if (!x || !old || old.format === R.FORMAT3 || !state.me) return;
    if (!ctx.recording(old)) { say('Only the recorder can start it as a Flightdeck 2.0 run.', 'warn'); render(); return; }
    var p = ctx.procOf(old.process), pub = p && (p.all || []).filter(function (v) { return v.info.folder === old.folder; })[0];
    if (!pub) { say('v' + old.version + ' of this checklist can\'t be used here, so it can\'t continue as a Flightdeck 2.0 run.', 'warn'); render(); return; }
    if (state.continuing) return;
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (err) { tz = ''; }
    var n; try { n = R.continuation(old, pub, { by: state.me, session: SESSION, now: new Date().toISOString(), tz: tz, workflows: data.jira.workflows, app: APP_VERSION, pins: PF.pins.atStart(pub.map, null, ctx.procOf) }); }
    catch (err) { say(err.message, 'warn'); render(); return; }
    try { R.continued(JSON.parse(JSON.stringify(old)), map, stepId, n, state.me, new Date().toISOString()); } catch (err) { say(err.message, 'warn'); render(); return; }
    var sfs = state.fs, sg = gen, key = state.runKey, endBusy = busyStart(), held = holdNav(false);
    state.continuing = true;
    var done = function () { endBusy(); state.continuing = false; };
    queued(function () { n.recorder.session = SESSION; return repo.saveRun(sfs, n, SESSION, { writer: WRITER, lock: LOCKS ? lock : null }); }).then(function () {
      if (sg !== gen) { done(); releaseNav(held); return; }
      return mutateRun(key, sg, function (r, m, me, now) { R.continued(r, m, stepId, n, me, now); }).then(function (ok) {
        done(); if (sg !== gen) { releaseNav(held); return; }
        return load(true).then(function () {
          releaseNav(held); if (sg !== gen) return;
          openRun(n.process + '/' + n.id);
          say(ok === false ? 'Started "' + n.title + '" as a Flightdeck 2.0 run, but the old run\'s step isn\'t marked yet. Block it with "Continued in run ' + n.process + '/' + n.id + '".' : 'Started "' + n.title + '" as a Flightdeck 2.0 run. The old run\'s step says where it continued.', ok === false ? 'warn' : 'good'); render();
        });
      });
    }, function (err) { done(); releaseNav(held); if (sg !== gen) return; say('Couldn\'t start the run: ' + err.message, 'bad'); render(); });
  }
  /* The recorder's window settles a parent step once its child run ends: done if it completed, blocked otherwise. */
  function syncChildren() {
    data.runs.forEach(function (r) {
      if (!ctx.recording(r) || r.paused || state.unsaved[r.id]) return;
      Object.keys(r.steps).forEach(function (sid) {
        var a = r.steps[sid], c = a && a.child && ctx.findRun(a.child.process + '/' + a.child.id), x = M.findStep(R.mapOf(r), sid), v = x && R.childVerdict(r, x.step, a, c, ctx.procOf);
        /* Settled once: a failed child stays failed (unblocking the step won't re-block it); a new child replaces it. */
        if (!v || a.child.failed || !R.childCurrent(r, x.step, a) || a.s === 'done' || a.s === 'na') return;
        mutateRun(r.process + '/' + r.id, gen, function (rr, m, me, now) { R.settleChild(rr, m, sid, c, me, now, ctx.procOf); }, { background: true });
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
  function dropEditor(pid) { resetEditor(pid); if (state.editors) delete state.editors[edKey(pid)]; }
  /* A draft editor's epoch: bumped whenever its text is reset rather than edited (Discard, Take theirs, Restore, a new or
     dropped editor). Work that finishes later (an image being added) captures it and does nothing once it changed. A folder
     switch is covered by gen. */
  var edEpochs = {};
  function edEpoch(pid, fk) { return edEpochs[edKey(pid, fk)] || 0; }
  function resetEditor(pid, fk) { var k = edKey(pid, fk); edEpochs[k] = (edEpochs[k] || 0) + 1; }
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
  function cachedHash(pid) { var p = procFind(pid); return p && p.draft ? U.hash(p.draft.md) : null; }
  /* An editor with nothing unsaved follows the draft in the folder; one with unsaved changes keeps what it started from,
     so saving it over a newer draft is a conflict, never an overwrite. */
  function followDrafts() {
    if (!state.editors) return;
    processes().forEach(function (p) {
      /* Only a read that started after the editor's own save or Take theirs counts, so an older copy still in memory or
         an older read finishing late never undoes it. A later read is the folder as it is, whatever it holds. */
      /* Nor while this window's own save of it is still finishing (an Undo made meanwhile is newer than either), nor while
         text typed in the builder's form isn't applied yet (that's unsaved too; a box still on screen after its pending mark
         was cleared counts until the redraw looks again). */
      /* A read of this draft (a routine load, or the editor's watcher) counts by its own sequence. */
      var readAt = p.draft && fileSeq[p.draft.file] != null ? fileSeq[p.draft.file] : data.readSeq || 0;
      /* On the practice page a change waits (said in its header) and is adopted, with these same checks, back in the editor. */
      var ed = editorOf(p.id); if (!ed || (state.view === 'practice' && state.processId === p.id) || ed.conflict || dirty(ed) || state.obPending === p.id || (state.obRepend && state.processId === p.id && obTyped(null)) || shotBusy(p.id) || !p.draft || state.draftSaving[edKey(p.id)] || readAt <= (ed.after || 0)) return;
      /* The newer draft is one change in the editor's timeline (slice 2): one Undo takes it back as an unsaved edit, and the
         changes before it stay undoable. It's already in the folder, so a later save never lists it as the person's. */
      var h = U.hash(p.draft.md); if (h === ed.baseHash || p.draft.md === ed.base) return;
      var before = ed.base, after = p.draft.md, ch = PF.proposals.changes(before, after);
      var mine = ((p.proposed || {}).list || []).some(function (x) { return x.meta && x.meta.rev === draftInfo(p).rev; });
      var e = TL.record(tlOf(ed), before, after, { kind: 'incoming', label: mine ? 'change from your AI assistant' : 'change from the team folder', lines: true, items: ch.keys });
      if (e) e.savedAs = h;
      ed.base = after; ed.baseHash = h; ed.text = null; ed.fresh = null;
      ed.incoming = { keys: keySet(ch.keys), who: mine ? 'assistant' : 'folder' };
      if (state.view === 'process' && state.ptab === 'edit' && state.processId === p.id) {
        say((mine ? 'Your AI assistant changed this draft (applied in another window): ' + PF.proposals.changeWords(ch) + '.' : 'This draft changed in the team folder.') + ' Undo available.', 'good', { act: 'tl-undo', id: 'draft', label: 'Undo' });
      }
    });
  }
  function keySet(keys) { var o = Object.create(null); keys.forEach(function (k) { o[k] = true; }); return o; }
  /* ---------- drafts as this window last read or saved them (docs/design.md section 27) ----------
     Each draft file carries the sequence of the read (or this window's own save) it came from. A folder read that finishes
     after a newer one, or after this window saved the draft, never puts back the older text it read. */
  var fileSeq = {};
  function keepNewerDrafts(d, seq) {
    var paths = {};
    d.drafts.concat(data.drafts || []).forEach(function (x) { paths[x.file] = true; });
    Object.keys(paths).forEach(function (f) {
      if ((fileSeq[f] || 0) <= seq) { fileSeq[f] = seq; return; }
      var mine = (data.drafts || []).filter(function (x) { return x.file === f; })[0];
      d.drafts = d.drafts.filter(function (x) { return x.file !== f; });
      if (mine) d.drafts.push(mine);
    });
  }
  /* This window saved a draft: that text is what the folder has now, newer than any read already under way. */
  function savedDraft(file, text) {
    fileSeq[file] = ++readsStarted;
    var mine = { file: file, md: text, mtime: Date.now() };
    data.drafts = (data.drafts || []).filter(function (x) { return x.file !== file; }).concat([mine]);
    procCache = null;
  }
  /* A draft's SHA-256, remembered per text: proposals are judged against it on every redraw. */
  var shaMemo = Object.create(null);
  function draftInfo(e) {
    if (!e.draft) return { exists: false, rev: null };
    var m = shaMemo[e.id];
    if (!m || m.text !== e.draft.md) m = shaMemo[e.id] = { text: e.draft.md, rev: PF.sha256.hex(e.draft.md) };
    return { exists: true, rev: m.rev };
  }

  /* ---------- presence: who has a draft open, the soft lock (docs/design.md section 27) ----------
     While this window holds a draft editor for this folder (on screen, or with unsaved work kept in memory), it rewrites
     presence/<WRITER>.json every 10 s; it removes it when it holds none, and on pagehide. Other windows' presence is fresh by
     its beat in elapsed time (PF.proposals.freshApp). It decides nothing about saving: every save is checked anyway. */
  /* The sequence (readsStarted) of the read whose presence/ listing data.presence holds. */
  var presSeq = 0;
  var pres = { memo: Object.create(null), beat: 0, at: -Infinity, since: null, written: null, busy: false, cleanAt: -Infinity, fsKey: '' };
  state.claims = {};
  /* On this draft's editor, or practicing it (2.3): both hold presence and the main-editor claim, and the watcher keeps reading. */
  function onDraftPage(pid) { return ((state.view === 'process' && state.ptab === 'edit') || state.view === 'practice') && state.processId === pid; }
  function heldDrafts() {
    var k = fsKey() + '\n', out = [];
    Object.keys(state.editors || {}).forEach(function (e) {
      var ed = state.editors[e];
      if (e.indexOf(k) !== 0) return;
      var onScreen = onDraftPage(ed.pid);
      if ((onScreen || dirty(ed) || state.obPending === ed.pid || shotBusy(ed.pid)) && out.indexOf(ed.pid) < 0) out.push(ed.pid);
    });
    return out.sort();
  }
  function ownPresence() {
    var drafts = heldDrafts();
    if (!drafts.length) return null;
    return PF.proposals.presence({ app: APP_VERSION, writer: WRITER, by: state.me || '', device: ctx.device(), since: pres.since || new Date().toISOString(), at: new Date().toISOString(), beat: pres.beat,
      drafts: drafts, main: drafts.filter(function (pid) { return state.claims[fsKey() + '|' + pid]; }).map(function (pid) { var c = state.claims[fsKey() + '|' + pid]; return { process: pid, claimRev: c.claimRev, seen: c.seen }; }) });
  }
  /* now: write a beat whatever the time (opening an editor, a claim, coming back from sleep). */
  function presenceBeat(now) {
    var sfs = state.fs, key = fsKey();
    if (!sfs) return;
    if (pres.busy) { if (now) pres.again = true; return; }
    if (pres.written && pres.fsKey !== key) { var oldFs = pres.fs; pres.written = null; if (oldFs) repo.removePresence(oldFs, WRITER); }
    var rec = ownPresence(), t = elapsed();
    if (!rec) {
      if (!pres.written) return;
      pres.busy = true; pres.written = null; pres.since = null;
      repo.removePresence(sfs, WRITER).then(function () { pres.busy = false; }, function () { pres.busy = false; });
      return;
    }
    var shape = JSON.stringify([rec.drafts, rec.main, rec.by]);
    if (!now && pres.written === shape && t - pres.at < PF.proposals.BEAT_MS) return;
    pres.beat++; rec.beat = pres.beat; if (!pres.since) pres.since = rec.since = rec.at;
    pres.busy = true; pres.at = t;
    repo.writePresence(sfs, rec).then(function () {
      pres.busy = false; pres.written = shape; pres.fsKey = key; pres.fs = sfs;
      if (pres.again) { pres.again = false; presenceBeat(true); }
      /* Old presence files are cleaned up now and then by any window that writes presence (at most 20 a pass). */
      if (t - pres.cleanAt > 600000) { pres.cleanAt = t; repo.cleanPresence(sfs, Date.now()).then(null, function () {}); }
    }, function () { pres.busy = false; });
  }
  setInterval(function () { if (!document.hidden) presenceBeat(false); }, 1000);
  window.addEventListener('pagehide', function () { if (pres.written && pres.fs) { pres.written = null; repo.removePresence(pres.fs, WRITER); } });
  /* What the last read found in presence/, remembered by elapsed time: a beat seen now is fresh for 60 s. */
  /* listed: presence/ was really listed now (a part that failed keeps the last read, which isn't a new look). */
  function notePresence(d, listed) {
    var mono = elapsed(), wall = Date.now(), memo = Object.create(null);
    (d.presence || []).forEach(function (x) { if (!x.rec || x.writer === WRITER) return; memo[x.writer] = PF.proposals.freshApp(x.rec, pres.memo[x.writer], mono, wall).memo; });
    pres.memo = memo; if (listed) pres.listedAt = mono;
  }
  function freshOthers() {
    var mono = elapsed(), wall = Date.now();
    return (data.presence || []).filter(function (x) { var m = x.rec && pres.memo[x.writer]; return m && x.writer !== WRITER && mono - m.at <= PF.proposals.FRESH_MS; })
      .map(function (x) { var m = pres.memo[x.writer]; return Object.assign({}, x.rec, { ago: m.at === -Infinity ? wall - Date.parse(x.rec.at) : mono - m.at }); });
  }
  /* Each process: who else has its draft open (editing), and, where this window holds it, which window is the main editor. */
  function presenceInto(by) {
    var others = freshOthers(), mine = ownPresence(), held = mine ? mine.drafts : [];
    Object.keys(by).forEach(function (pid) {
      var e = by[pid], eds = others.filter(function (r) { return r.drafts.indexOf(pid) >= 0; });
      e.editing = eds.map(function (r) { return { writer: r.writer, by: r.by, device: r.device, ago: r.ago }; });
      if (held.indexOf(pid) < 0 || !eds.length && !state.claims[fsKey() + '|' + pid]) { e.main = null; return; }
      var m = PF.proposals.mainOf(pid, eds.concat([mine])), win = m.writer && eds.concat([mine]).filter(function (r) { return r.writer === m.writer; })[0];
      e.main = { me: m.writer === WRITER, ambiguous: m.ambiguous, claimRev: m.claimRev, by: win ? win.by : '', lost: !!m.writer && m.writer !== WRITER && m.claimRev > 0 };
    });
  }

  /* ---------- live while you watch (slice 2, docs/design.md section 27) ----------
     While a draft editor is on screen, every 2 s of elapsed time: list proposed/<process>/, stat the draft, and read it when
     its size or time changed or 10 s have passed (size and time are never proof, section 25); presence/ is listed again when
     the last look is 10 s old. Skipped while the tab is hidden, the folder busy, an input method composing, or this draft
     saving. Then the main editor applies a waiting fast-forward live; otherwise the proposal waits, said once through #live. */
  var WATCH_MS = 2000, WATCH_FULL_MS = 10000, WATCH_PRES_MS = 10000;
  var watch = { key: '', at: -Infinity, full: -Infinity, pres: -Infinity, names: null, stamp: null, busy: false };
  function watchTick() {
    var p = currentProcess();
    if (!state.fs || document.hidden || isBusy() || composing || watch.busy || !p) return;
    if (!onDraftPage(p.id) || state.draftSaving[edKey(p.id)]) return;
    var now = elapsed(), key = fsKey() + '|' + p.id;
    if (watch.key !== key) watch = { key: key, at: -Infinity, full: -Infinity, pres: -Infinity, names: null, stamp: null, busy: false };
    if (now - watch.at < WATCH_MS) return;
    var w = watch, sfs = state.fs, g = gen, pid = p.id, file = p.draft ? p.draft.file : pid + '.md', path = 'maps/drafts/' + file, seq = ++readsStarted, changed = false;
    w.at = now; w.busy = true;
    var wantPres = now - w.pres >= WATCH_PRES_MS;
    Promise.all([
      sfs.list(PF.proposals.DIR + '/' + pid).then(null, function () { return null; }),
      sfs.stat ? sfs.stat(path).then(null, function () { return null; }) : Promise.resolve(null),
      wantPres ? repo.loadPresence(sfs).then(null, function () { return null; }) : Promise.resolve(null)
    ]).then(function (got) {
      if (g !== gen || watch !== w) return;
      if (got[2] && seq > presSeq) { presSeq = seq; data.presence = got[2]; notePresence({ presence: got[2] }, true); w.pres = now; changed = true; }
      var jobs = [], names = got[0] ? got[0].map(function (i) { return i.name; }).sort().join('\n') : null;
      if (names != null && names !== w.names) jobs.push(repo.loadProposedOne(sfs, pid).then(function (x) {
        if (g !== gen || watch !== w) return;
        w.names = names; data.proposed = data.proposed || { procs: {} };
        if (x) data.proposed.procs[pid] = x; else delete data.proposed.procs[pid];
        changed = true;
      }, function () {}));
      var st = got[1], stamp = st ? st.size + ':' + st.mtime : '-';
      if (st && p.draft && (stamp !== w.stamp || now - w.full >= WATCH_FULL_MS)) jobs.push(sfs.read(path, { maxBytes: U.DRAFT_BYTES }).then(function (f) {
        if (g !== gen || watch !== w) return;
        w.stamp = stamp; w.full = now;
        if (!f || U.utf8Bytes(f.text) > U.DRAFT_BYTES) return;
        /* Only a read newer than any other read or save of this file is used (fileSeq), so it never puts back older text. */
        if ((fileSeq[file] || 0) > seq) return;
        fileSeq[file] = seq;
        var old = (data.drafts || []).filter(function (x) { return x.file === file; })[0];
        if (old && old.md === f.text) return;
        data.drafts = (data.drafts || []).filter(function (x) { return x.file !== file; }).concat([{ file: file, md: f.text, mtime: f.mtime }]);
        changed = true;
      }, function () {}));
      else if (!st && p.draft) w.stamp = stamp;
      return Promise.all(jobs);
    }).then(function () {
      w.busy = false;
      if (g !== gen || watch !== w) return;
      if (changed) { procCache = null; render(); }
      liveCheck();
    }, function () { w.busy = false; });
  }
  setInterval(watchTick, 1000);
  /* After a look: apply the oldest waiting fast-forward live when this window may (liveWhy), else say once that it waits. */
  var whispered = {}, whisperAt = -Infinity;
  function liveCheck() {
    var p = currentProcess();
    if (!p || !p.proposed || state.view !== 'process' || state.ptab !== 'edit') return;
    var key = fsKey() + '|' + p.id;
    if (state.propRun[key]) return;
    var list = p.proposed.list || [], ready = list.filter(function (x) { return x.fit === 'ready' && x.rec && x.rec.auto; });
    if (ready.length && !liveWhy(p.id)) { acceptProposal(p.id, ready[ready.length - 1].id, 'live', null); return; }
    var waiting = list.filter(function (x) { return x.fit === 'ready' || x.fit === 'older' || x.fit === 'already' || x.fit === 'review'; })[0], ed = editorOf(p.id);
    if (!waiting || whispered[key + '|' + waiting.id]) return;
    if (whisper(dirty(ed) || state.obPending === p.id || shotBusy(p.id) ? 'Your AI assistant proposed changes while you have unsaved ones. They\'ll wait for you to review them.' : 'Your AI assistant proposed changes. Review them from the notice in the editor.')) whispered[key + '|' + waiting.id] = true;
  }
  /* Said through #live only (the one announcement path), without a notice of its own, moving focus or switching tabs; at
     most one every 5 s, so a burst of arrivals isn't a burst of speech. */
  function whisper(text) {
    var el = document.getElementById('live'), now = elapsed();
    if (!el || now - whisperAt < 5000) return false;
    whisperAt = now; el.textContent = text;
    return true;
  }

  /* ---------- proposals: Review, Apply, Decline, Reopen (docs/design.md section 27) ---------- */
  function propOf(pid, id) {
    var p = procFind(pid), x = p && p.proposed && p.proposed.list.filter(function (y) { return y.id === id; })[0];
    return { p: p, x: x || null };
  }
  /* Why nothing may be applied to this draft from this window right now (caBlocked's rules, and an input method composing). */
  function propBlocked(p) {
    if (!p) return 'That checklist isn\'t in this folder anymore.';
    var why = caBlocked(p); if (why) return why;
    if (composing) return 'Finish typing first.';
    return '';
  }
  /* Everything about this window's editor that a change would show: its identity, text, base and conflict, and builder text
     waiting. Captured before any file is read or written, and compared again right before saving. */
  function edToken(pid) { var ed = editorOf(pid); return { ed: ed, text: ed ? ed.text : null, base: ed ? ed.base : null, conflict: ed ? ed.conflict : null, ob: state.obPending === pid, shots: shotBusy(pid) }; }
  function sameToken(a, b) { return a.ed === b.ed && a.text === b.text && a.base === b.base && a.conflict === b.conflict && a.ob === b.ob && a.shots === b.shots; }
  var attemptN = 0;
  state.propTx = {};
  var PROP_SAY = {
    older: 'This started from an older draft. Review it on the checklist\'s page.', already: 'That\'s already in the draft. Review it to mark it as applied.',
    waiting: 'It follows an earlier proposal that isn\'t applied yet.', review: 'The proposal it follows was declined or replaced. Review it first.',
    replaced: 'A newer proposal replaces this one.', invalid: 'This proposal can\'t be used.', applied: 'This was already applied.', 'applied-twice': 'This was already applied.',
    declined: 'This was declined. Reopen it to apply it.', unknown: 'A record about this proposal can\'t be read yet. Try again once it has arrived.'
  };
  /* Why this window can't apply a proposal live (slice 2) right now, or '': the draft's editor is on screen here, nothing is
     unsaved (no unsaved text, builder text waiting, conflict or composition), nothing is saving, this window is the one
     unambiguous main editor among the editors it can see, and it listed presence/ in the last 20 s. */
  /* adopted: the change is already in the editor (so it differs from the draft and is saving); everything else still holds. */
  function liveWhy(pid, adopted) {
    var ed = editorOf(pid);
    if (!ed || document.hidden || state.view !== 'process' || state.ptab !== 'edit' || state.processId !== pid) return 'not open';
    if ((!adopted && dirty(ed)) || ed.conflict || state.obPending === pid || shotBusy(pid) || composing) return 'unsaved';
    if (!adopted && state.draftSaving[edKey(pid)]) return 'saving';
    var mine = ownPresence(), m = PF.proposals.mainOf(pid, freshOthers().concat(mine ? [mine] : []));
    if (m.ambiguous || m.writer !== WRITER) return 'not main';
    if (!(elapsed() - (pres.listedAt == null ? -Infinity : pres.listedAt) <= PF.proposals.LISTED_MS)) return 'not listed';
    return '';
  }
  state.propRun = {};
  /* The one acceptance transaction for a folder and process (docs/design.md section 27): one at a time per key in this window,
     and inside a Web Lock across this browser's windows. It captures the editor first, rechecks everything when it runs,
     records an attempt before anything changes, checks again right before adopting that nothing changed and that the records
     are exactly the expected set (the person's reviewed set plus this attempt), adopts the text into an open editor as one
     Undo entry, checks again when the queued save starts (an Undo before then withdraws it), saves with the exact text it
     expects, and only then records applied. Nothing is retried on its own. how: 'apply' (a person, on the checklist\'s page or
     in Review) or 'live' (the main editor, slice 2: only a proposal with no record at all, refusals unsaid). reviewed: the
     records a person saw in Review, or null. */
  function acceptProposal(pid, id, how, reviewed) {
    var sfs = state.fs, g = gen, fk = fsKey(), key = fk + '|' + pid, tok = edToken(pid), PP = PF.proposals, isLive = how === 'live', sk = edKey(pid, fk);
    var first = propBlocked(propOf(pid, id).p) || (isLive ? liveWhy(pid) : '');
    if (first) { if (!isLive) { say(first, 'warn'); render(); } return Promise.resolve(false); }
    function live() { return g === gen; }
    function stop(msg, kind, act) { if (live() && msg) { say(msg, kind || 'warn', act); render(); } return false; }
    /* A refusal before anything was written: said for a person's Apply, never for a live one (the proposal just waits). */
    function refuse(why) { return stop(why === 'gone' || isLive ? '' : why); }
    /* How it stands, judged with every proposal of the process and all their records as read now (set), never from what
       the page last drew: a replacement or a relative that arrived since counts. */
    function judged(proposal, recs, set) {
      var p = propOf(pid, id).p, metas = set.metas.filter(function (m) { return m.id !== id; }).concat([PP.check(proposal, id + '.json', pid, 0).meta]), all = {};
      metas.forEach(function (m) { all[m.id] = set.records[m.id] || []; });
      all[id] = recs;
      return PP.judge(metas, all, p ? draftInfo(p) : { exists: false, rev: null }).filter(function (y) { return y.id === id; })[0];
    }
    /* Everything that must hold to go on, from the proposal and its records as read now. */
    function eligible(r, recs, set) {
      if (!live()) return 'gone';
      if (!r.ok) return 'This proposal ' + r.why + '.';
      if (recs.some(function (x) { return !x.rec; })) return PROP_SAY.unknown;
      if (reviewed ? !PP.sameSet(PP.reviewed(recs), reviewed) : recs.length) return reviewed ? 'This proposal changed since you reviewed it. Look again.' : 'Flightdeck tried to apply this before. Review it first.';
      var x = judged(r.proposal, recs, set); if (!x) return 'That proposal isn\'t listed any more.';
      if (x.fit !== 'ready') return PROP_SAY[x.fit] || 'This can\'t be applied now.';
      if (U.draftTooBig(r.proposal.text)) return U.draftTooBig(r.proposal.text).why;
      var p = propOf(pid, id).p, why = p ? propBlocked(p) : '';
      if (why) return why;
      if (isLive && (why = liveWhy(pid))) return why;
      if (!sameToken(tok, edToken(pid))) return 'The draft changed while you were applying it. Look again.';
      return '';
    }
    function look() { return Promise.all([repo.readProposal(sfs, pid, id), repo.listRecords(sfs, pid, id), repo.loadProposalSet(sfs, pid)]); }
    function run() {
      if (!live()) return false;
      /* Checked before waiting for the lock, so a refusal is said at once; checked again inside it. */
      return look().then(function (got) {
        var why = eligible(got[0], got[1], got[2]);
        if (why) return refuse(why);
        return LOCKS ? lock('preflight:accept:' + fk + '|' + pid, locked) : locked();
      });
    }
    function locked() {
      if (!live()) return false;
      return look().then(function (got) {
        var r = got[0], recs = got[1], why = eligible(r, recs, got[2]), openBefore = PP.recState(recs).open;
        if (why) return refuse(why);
        var p = propOf(pid, id).p, file = p && p.draft ? p.draft.file : pid + '.md', expectText = p && p.draft ? p.draft.md : null, text = r.proposal.text;
        var at = PP.attempt({ proposal: id, proposalRev: r.proposal.rev, writer: WRITER, n: ++attemptN, how: how, from: expectText == null ? null : PP.sha(expectText), by: state.me || '', at: new Date().toISOString() });
        var mineSha = PP.sha(JSON.stringify(at.rec, null, 2) + '\n'), expected = (reviewed || []).concat([{ name: at.name, sha: mineSha }]), mine = WRITER + '.' + attemptNo(at), adopted = null;
        return repo.writeRecord(sfs, pid, at.name, at.rec).then(function () {
          /* Immediately before adopting: nothing changed here, and the records are exactly the expected set. */
          return Promise.all([repo.listRecords(sfs, pid, id), repo.loadProposalSet(sfs, pid)]).then(function (now) {
            if (!stillEditor(tok) || !stillRecords(now[0], now[1])) return outcome('cancelled');
            adopted = adopt();
            return queued(function () {
              return Promise.all([repo.listRecords(sfs, pid, id), repo.loadProposalSet(sfs, pid)]).then(function (again) {
                /* When the save starts: an Undo of the adopted change since then withdraws it; anything else changed cancels it. */
                if (adopted && undone()) return { withdrawn: true };
                if (!stillEditor(adopted ? adopted.tok : tok) || !stillRecords(again[0], again[1])) return { cancelled: true };
                /* Live: still allowed to apply live (shown, the main editor, presence/ looked at lately); otherwise the change
                   stays in the editor, unsaved, for the person to save or undo. */
                if (isLive && liveWhy(pid, true)) return { cancelled: true, kept: true };
                return repo.saveDraft(sfs, file, text, expectText == null ? null : U.hash(expectText), { lock: LOCKS ? lock : null, expectText: expectText });
              });
            }).then(function (res) {
              if (adopted) delete state.draftSaving[sk];
              if (res.withdrawn) { if (adopted.ed.incoming) adopted.ed.incoming = null; return outcome('withdrawn', null, 'You took back your AI assistant\'s change. It\'s listed on the checklist\'s page if you want it later.'); }
              if (res.cancelled && res.kept) return outcome('cancelled', null, 'Your AI assistant\'s change is in the editor but wasn\'t saved: this window stopped applying changes live (hidden, or no longer the main editor). Save the draft to keep it, or Undo it.');
              if (res.cancelled) return outcome('cancelled');
              if (!res.ok) {
                /* Adopted, then refused: the proposal's text stays in the editor, unsaved, with today's conflict panel. */
                var ce = editorOf(pid, fk);
                if (adopted && ce === adopted.ed && res.conflict) { ce.conflict = res; ce.baseHash = expectText == null ? null : U.hash(expectText); }
                /* Written, then replaced by another change before the read-back: it was saved, so it never says it wasn't. */
                if (res.afterWrite) return outcome('overwritten', null, 'Your save was written, then replaced by another change. Compare them ' + (adopted ? 'below' : 'in the editor') + '. Your AI assistant\'s change is listed on the checklist\'s page.');
                return outcome('not-saved', null, isLive ? 'Not saved: someone else changed this draft.' : 'Not saved: someone else changed this draft. Review the proposal again on the checklist\'s page.');
              }
              if (live() && fsKey() === fk) {
                savedDraft(file, text);
                /* The adopted editor now starts from what was saved. Typing, or an Undo, since the save started stays, unsaved. */
                var ed = editorOf(pid);
                if (adopted && ed === adopted.ed) { ed.base = text; ed.baseHash = res.hash; ed.after = readsStarted; ed.conflict = null; if (ed.text === text) ed.text = null; if (adopted.entry) TL.saved([adopted.entry], res.hash); }
              }
              logSave(sfs, fk, { kind: 'draft-edit', id: pid, from: expectText == null ? null : U.hash(expectText), to: res.hash, before: expectText == null ? '' : expectText, after: text, source: 'proposal', proposal: id, units: ['Applied your AI assistant\'s change'], items: [] });
              var words = PP.changeWords(adopted ? adopted.ch : PP.changes(expectText == null ? '' : expectText, text)), here = adopted && state.view === 'process' && state.processId === pid;
              return outcome('applied', { rev: PP.sha(text) }, isLive ? 'Your AI assistant changed this draft: ' + words + '. Undo available.' : 'Applied your AI assistant\'s change to the draft' + (here ? '. Undo available.' : '.'), here ? { act: 'tl-undo', id: 'draft', label: 'Undo' } : null);
            }, function (e) {
              if (adopted) delete state.draftSaving[sk];
              return outcome('not-saved', null, e && e.tooBig ? e.message : 'Couldn\'t save the draft: ' + (e && e.message || e) + '. Review the proposal again on the checklist\'s page.');
            });
          });
          /* The editor as captured (t): the same object, text, base, conflict and builder text, nothing blocking, the draft as it was. */
          function stillEditor(t) {
            if (!live() || fsKey() !== fk) return false;
            var p2 = propOf(pid, id).p;
            if (!sameToken(t, edToken(pid)) || composing || state.obPending === pid || (p2 && p2.draft ? p2.draft.md : null) !== expectText) return false;
            if (!adopted && p2 && propBlocked(p2)) return false;
            if (isLive && !adopted && liveWhy(pid)) return false;
            return true;
          }
          function stillRecords(list, set) {
            var x = judged(r.proposal, list.filter(function (y) { return y.name !== at.name; }), set);
            if (!x || x.fit !== 'ready') return false;
            return PP.sameSet(PP.reviewed(list) || [], expected) && !list.some(function (y) { return !y.rec; });
          }
          /* Adopt (an open editor in this folder, which has nothing unsaved): the proposal's text, as one Undo entry. Its save is
             queued; until it starts, the editor shows it as saving and an Undo withdraws it. */
          function adopt() {
            var ed = fsKey() === fk ? editorOf(pid) : null;
            if (!ed) return null;
            var before = ed.text != null ? ed.text : ed.base, ch = PP.changes(before, text);
            var e = TL.record(tlOf(ed), before, text, { kind: 'incoming', label: 'change from your AI assistant', lines: true, items: ch.keys, adopt: { proposal: id, attempt: mine } });
            ed.text = text; ed.incoming = { keys: keySet(ch.keys), who: 'assistant' };
            state.draftSaving[sk] = 'save';
            render();
            return { ed: ed, entry: e, tok: edToken(pid), ch: ch, before: before };
          }
          function undone() {
            var ed = editorOf(pid, fk);
            return ed === adopted.ed && !!adopted.entry && TL.peek(tlOf(ed)).undo !== adopted.entry && !dirty(ed) && state.obPending !== pid;
          }
          function outcome(status, result, msg, act) {
            return repo.listRecords(sfs, pid, id).then(function (list) {
              /* An application settles the attempts the person reviewed as open, too (Apply again); other outcomes only their own. */
              var settles = status === 'applied' ? openBefore.concat([mine]) : [mine];
              var st = PP.recState(list), d = PP.decision({ proposal: id, proposalRev: r.proposal.rev, writer: WRITER, decisionRev: st.nextRev, seen: st.seen, status: status, attempt: mine, settles: settles, result: result, by: state.me || '', at: new Date().toISOString() });
              return repo.writeRecord(sfs, pid, d.name, d.rec);
            }).then(function () { return true; }, function () { return false; }).then(function (recorded) {
              if (status === 'applied') { stop(recorded ? msg : msg.replace(/(\. Undo available)?\.$/, '') + ', but recording that didn\'t save. The checklist\'s page shows it as May already be applied.', recorded ? 'good' : 'warn', recorded ? act : null); if (live()) load(true); return true; }
              stop(msg || 'Your AI assistant\'s change wasn\'t applied because the draft changed while it was being applied. Review it on the checklist\'s page.', 'warn');
              if (live()) load(true);
              return false;
            });
          }
        }, function () {
          return stop('Couldn\'t record that your AI assistant\'s change is being applied, so it wasn\'t.', 'bad', { act: 'prop-apply', id: id, label: 'Try again' });
        });
      });
    }
    var prev = state.propTx[key] || Promise.resolve();
    state.propRun[key] = (state.propRun[key] || 0) + 1;
    var p = prev.then(run, run);
    var done = function () { state.propRun[key] = Math.max(0, (state.propRun[key] || 1) - 1); };
    state.propTx[key] = p.then(done, done);
    return p;
  }
  function attemptNo(at) { return /\.(\d+)\.json$/.exec(at.name)[1]; }
  /* A decision a person makes on a proposal (declined, reopened, applied as found): written once, one more than the
     highest decisionRev, naming it. reviewed, when given, must still be exactly the records Review showed. */
  function decideProposal(pid, id, status, opts) {
    opts = opts || {};
    var sfs = state.fs, g = gen, PP = PF.proposals, fk = fsKey(), key = fk + '|' + pid;
    /* Decisions take their turn with every acceptance and decision on this process: in this window's queue, then under the
       same Web Lock, and only then are the records read and the revision chosen. Two at once never share a revision or a
       file name, and the second sees the first. */
    function run() {
      if (g !== gen) return false;
      return LOCKS ? lock('preflight:accept:' + fk + '|' + pid, decide) : decide();
    }
    var prev = state.propTx[key] || Promise.resolve(), p = prev.then(run, run);
    state.propTx[key] = p.then(null, function () {});
    return p;
    function decide() {
    return Promise.all([repo.readProposal(sfs, pid, id), repo.listRecords(sfs, pid, id)]).then(function (got) {
      if (g !== gen) return;
      var r = got[0], recs = got[1], st = PP.recState(recs);
      if (!r.ok) { say('This proposal ' + r.why + '.', 'warn'); render(); return; }
      /* Never decide over a record this window can't read: it may be a newer decision still arriving. */
      if (st.bad.length) { say('A record about this proposal can\'t be read yet (' + st.bad.join(', ') + '). Nothing was decided. Try again once it has arrived.', 'warn'); render(); return; }
      if (opts.reviewed && !PP.sameSet(PP.reviewed(recs), opts.reviewed)) { say('This proposal changed since you reviewed it. Look again.', 'warn'); render(); return; }
      if (status === 'reopened' && st.state !== 'declined') { say('Only a declined proposal can be reopened.', 'warn'); render(); return; }
      var result = null, attemptId = null;
      if (status === 'applied') {
        var p = propOf(pid, id).p, now = p && p.draft ? p.draft.md : null;
        if (st.state !== 'maybe' && now !== r.proposal.text) { say('The draft doesn\'t have this change. Apply it, or decline it.', 'warn'); render(); return; }
        result = { rev: PP.sha(now == null ? '' : now) }; attemptId = st.open[0] || null;
      }
      /* A person's decision settles every attempt still open, so an interrupted one never lingers as May already be applied. */
      var d = PP.decision({ proposal: id, proposalRev: r.proposal.rev, writer: WRITER, decisionRev: st.nextRev, seen: st.seen, status: status, attempt: attemptId, settles: st.open, result: result, by: state.me || '', at: new Date().toISOString() });
      return repo.writeRecord(sfs, pid, d.name, d.rec).then(function () {
        if (g !== gen) return;
        if (state.overlay && state.overlay.propReview) closeOverlay();
        say(status === 'declined' ? 'Declined. It stays listed on the checklist\'s page.' : status === 'reopened' ? 'Reopened. Review it to apply it.' : 'Marked as applied.', 'good');
        return load(true);
      }, function (e) { if (g !== gen) return; say('Couldn\'t save the decision: ' + e.message, 'bad'); render(); });
    });
    }
  }
  /* Review: the proposal read whole and its records read now; what they were is the reviewed set Apply carries. */
  function openReview(pid, id) {
    var x = propOf(pid, id), p = x.p, sfs = state.fs, g = gen;
    state.overlayFocus = '#pr-t';
    var ov = { propReview: true, pid: pid, id: id, item: x.x, proposal: null, records: [], reviewed: null, draftText: p && p.draft ? p.draft.md : null, err: null, html: function () { return V.proposalReview(ctx, this); } };
    openOverlay(ov);
    Promise.all([repo.readProposal(sfs, pid, id), repo.listRecords(sfs, pid, id)]).then(function (got) {
      if (g !== gen || state.overlay !== ov) return;
      if (!got[0].ok) { ov.loadErr = 'This proposal ' + got[0].why + '.'; render(); return; }
      ov.proposal = got[0].proposal; ov.records = got[1]; ov.reviewed = PF.proposals.reviewed(got[1]);
      var p2 = propOf(pid, id).p, pr2 = data.proposed.procs[pid] || {}, metas = pr2.all || [], all = {};
      metas.forEach(function (m) { all[m.id] = ((p2 && p2.proposed && p2.proposed.records) || {})[m.id] || []; }); all[id] = got[1];
      ov.item = PF.proposals.judge(metas, all, p2 ? draftInfo(p2) : { exists: false, rev: null }).filter(function (y) { return y.id === id; })[0] || ov.item;
      ov.draftText = p2 && p2.draft ? p2.draft.md : null;
      render();
    }, function (e) { if (state.overlay === ov) { ov.loadErr = 'This proposal couldn\'t be read: ' + e.message; render(); } });
  }
  function currentProcess() { return procFind(state.processId); }
  var renderTimer = null;
  function scheduleRender() { if (renderTimer) return; renderTimer = setTimeout(function () { renderTimer = null; render(); }, 250); }
  /* Save a draft only over the version the editor started from; anything else is shown as a conflict, never overwritten. */
  /* opts.replace (a restore): the editor is replaced only once the save succeeds; a failed or refused one keeps it as it was. */
  /* One save of a draft at a time: a second save would start from the same fingerprint and conflict with this window's own
     first save, and edits typed during a restore would be replaced by it. While a restore saves, the draft can't be edited. */
  state.draftSaving = {};
  /* ---------- saved history (docs/design.md section 20, slice 2): a line in this window's own history file per save ----------
     Written through the write queue after a save succeeded, never for a refused one. A line that couldn't be written stays in
     memory, per folder and history folder (so it outlives the editor being replaced after a save), and goes ahead of the next. */
  var histSeq = 0, histRoll = {}, histPending = {}, histSeen = {};
  function histKey(key, dir) { return key + '\n' + dir; }
  function capFirst(t) { t = String(t); return t.charAt(0).toUpperCase() + t.slice(1); }
  /* The changes a save carries that weren't saved before, as History labels and items. */
  function histUnits(carried) {
    var fresh = carried.filter(function (e) { return !e.savedAs; }), items = [];
    fresh.forEach(function (e) { e.items.forEach(function (x) { if (items.indexOf(x) < 0) items.push(x); }); });
    return { units: fresh.map(function (e) { return capFirst(TL.describe(e)); }), items: items, reverse: fresh.length > 0 && fresh.every(function (e) { return e.kind === 'reverse'; }) };
  }
  function logSave(sfs, key, o) {
    var dir = repo.historyDir(o.kind, o.id), k = histKey(key, dir), rec;
    try { rec = TL.histLine(Object.assign({}, o, { id: U.randomId(10), process: o.id, type: o.id, writer: WRITER, seq: ++histSeq, by: state.me || '', at: new Date().toISOString(), seen: histSeen[k] || null })); } catch (e) { return; }
    histSeen[k] = rec.id;
    var pend = histPending[k] = histPending[k] || [];
    pend.push(JSON.stringify(rec));
    queued(function () {
      if (!pend.length) return;
      var lines = pend.slice();
      return repo.appendHistory(sfs, dir, WRITER, lines, histRoll[key] = histRoll[key] || {}).then(function () { pend.splice(0, lines.length); }, function () { /* kept for the next save */ });
    });
  }
  function saveDraftText(p, text, expectHash, okMsg, opts) {
    opts = opts || {};
    var sfs = state.fs, g = gen, key = fsKey(), file = p.draft ? p.draft.file : p.id + '.md', sk = edKey(p.id, key);
    var dw = draftUnread(p);
    if (dw) { say(dw + ' Nothing was saved over it. Choose Refresh, then save again.', 'warn'); render(); return; }
    if (state.draftSaving[sk]) { say('Still saving this draft. Try again in a moment.', 'warn'); render(); return; }
    /* Over the size limit: nothing is written, the text stays where it is, and the message says how much to cut. */
    var big = U.draftTooBig(text);
    if (big) { say(big.why, 'bad'); render(); return; }
    state.draftSaving[sk] = opts.replace ? 'restore' : 'save';
    var done0 = function () { delete state.draftSaving[sk]; };
    /* The changes this save carries, so History can say they were saved; typing after it starts a new unit. */
    var ed0 = editorOf(p.id, key), carried = ed0 && ed0.tl ? ed0.tl.entries.slice(0, ed0.tl.pos) : [];
    if (ed0 && ed0.tl) TL.close(ed0.tl);
    /* For the saved history: the text this save replaces (the one whose fingerprint it expects) and what it carries. */
    /* The exact text this save expects to find (opts.expectText), compared right before writing; also what History says it
       replaced. Never one found by matching fingerprints. */
    var expectText = opts.expectText !== undefined ? opts.expectText : expectHash == null ? null : undefined;
    if (expectText === undefined) { done0(); say('Couldn\'t save the draft of ' + p.title + ': Flightdeck doesn\'t know the exact text it started from. Choose Refresh, then save again.', 'bad'); render(); return; }
    var hu = histUnits(carried), before = expectText == null ? '' : expectText;
    var hsource = opts.source || (expectHash == null ? 'new' : hu.reverse ? 'reverse' : 'editor');
    /* When it ends, the controls it disabled come back, also if someone left this folder and returned meanwhile. */
    var done = function () { delete state.draftSaving[sk]; if (fsKey() === key) scheduleRender(); };
    render();
    var write = opts.write || function (f, name, t, h, o) { return repo.saveDraft(f, name, t, h, o); };
    queued(function () { return write(sfs, file, text, expectHash, { lock: LOCKS ? lock : null, expectText: expectText }); }).then(function (res) {
      done();
      if (res.ok && fsKey() === key && g === gen) savedDraft(file, text);
      /* Only this process's editor in its own folder is touched, whatever is on screen now, even after a folder switch. */
      var ed = editorOf(p.id, key), here = g === gen && state.processId === p.id && fsKey() === key;
      if (res.conflict && opts.replace) { if (g === gen) { say('The draft changed since you looked, so nothing was restored. Look again, then restore.', 'warn'); render(); } return; }
      if (res.conflict) {
        if (ed) { if (ed.text == null) ed.text = text; ed.baseHash = expectHash; ed.conflict = res; }
        else setEditor({ pid: p.id, fsKey: key, text: text, base: '', baseHash: expectHash, conflict: res });
        if (opts.done) opts.done('conflict');
        if (g !== gen) return;
        if (here) state.ptab = 'edit'; else say(res.afterWrite ? 'Your save of the draft of ' + p.title + ' was written, then replaced by another change. Open it to compare.' : 'The draft of ' + p.title + ' wasn\'t saved: someone else changed it. Open it to compare.', 'warn');
        render();
        /* A draft that was missing and is back (a recovery that found a new file) needs the folder read to show it. */
        if (!p.draft) return load(true);
        return;
      }
      /* Saved: the editor now starts from what was saved. Anything typed while it saved stays, as unsaved changes. */
      /* Undo steps survive a save: undoing one makes the draft unsaved again, and saving it is checked like any other. A
         restore replaced the text, so nothing before it can be undone. Parts saved are no longer new. */
      if (!opts.replace && ed && ed.text != null && ed.text !== text) { ed.base = text; ed.baseHash = res.hash; ed.conflict = null; ed.seen = cachedHash(p.id); ed.after = readsStarted; ed.fresh = null; ed.incoming = null; }
      else ed = setEditor({ pid: p.id, fsKey: key, base: text, baseHash: res.hash, text: null, seen: cachedHash(p.id), after: readsStarted, tl: ed && ed.tl });
      if (opts.replace) { resetEditor(p.id, key); if (ed.tl) TL.barrier(ed.tl, opts.why || 'The draft was replaced here. Earlier changes can\'t be undone.'); }
      else TL.saved(carried, res.hash);
      logSave(sfs, key, { kind: 'draft-edit', id: p.id, from: expectHash, to: res.hash, before: before, after: text, source: hsource, version: opts.version, units: opts.units || hu.units, items: hu.items });
      if (ed.tl) learnIds(ed, text);
      if (g !== gen) return;
      if (opts.replace) dropPending();
      if (opts.replace && here) { state.mapVer = null; state.focus = 'cl-h'; }
      say(okMsg, 'good', opts.act);
      if (opts.done) opts.done('saved');
      /* In the editor a save is confirmed by a quiet check beside Save (and still announced), not a notice. */
      if (!opts.replace && state.view === 'process' && state.ptab === 'edit' && state.processId === p.id) state.msg.quiet = true;
      /* A quiet check beside Save, for a moment. */
      if (!opts.replace) { var mark = state.justSaved = { pid: p.id }; setTimeout(function () { if (state.justSaved === mark) { state.justSaved = null; scheduleRender(); } }, 1600); }
      /* What has to follow the save (an applied correction's decision) happens only once the draft is in the folder. */
      return Promise.resolve(opts.after ? opts.after(res) : null).then(function () { if (g === gen) return load(true); });
    }, function (err) { done(); if (fsKey() !== key) return; if (opts.done) opts.done('failed'); say(err && err.tooBig ? err.message : 'Couldn\'t save the draft of ' + p.title + ': ' + err.message + (opts.failed ? opts.failed(err) || '' : ''), 'bad'); render(); });
  }
  /* ---------- practice (2.2, docs/design.md section 34): the draft as it's on screen, in this tab only ----------
     Never a run: its state lives here and in sessionStorage, never in data.runs, the save queues or the folder. Every rule
     is PF.practice's (which reads PF.run's). Its own Undo, separate from the draft's. */
  var PR = PF.practice;
  state.practicing = {};
  var prs = {};
  function prStoreKey(pid) { return LS + ':practice:' + fsKey() + ':' + pid; }
  function prEntry(pid) {
    var k = edKey(pid), e = prs[k];
    if (e) return e;
    var st = null, raw = null, lost = false;
    try { raw = sessionStorage.getItem(prStoreKey(pid)); } catch (err) { raw = null; }
    if (raw) { try { st = PR.check(JSON.parse(raw), pid); } catch (err) { st = null; } lost = !st; }
    prLoadTyped(pid);
    return (prs[k] = { pid: pid, st: st || PR.fresh(pid), undo: [], redo: [], renames: {}, moved: {}, cache: null, good: null, mem: false, sampleErr: {}, typed: {}, gateErr: null, refusal: null, saveErr: null, trip: null,
      note: lost ? 'The practice kept in this tab couldn\'t be read, so it starts fresh. The draft isn\'t affected.' : '' });
  }
  function prSave(e) {
    var present = Object.create(null);
    if (e.good) e.good.map.phases.forEach(function (ph) { present[ph.id] = present[ph.gate.id] = true; ph.steps.forEach(function (s) { present[s.id] = true; }); });
    var text = PR.keep(e.st, present, e.good ? e.good.map : null);
    try { if (text == null) throw new Error('too big'); sessionStorage.setItem(prStoreKey(e.pid), text); }
    catch (err) { if (!e.mem) { e.mem = true; say('Practice is kept in this window only for now: the browser won\'t store more. Nothing in the draft is affected.', 'warn'); } }
  }
  /* A builder edit gave a part a new ID: its practice answer follows (as another try) and stays under the old one. */
  function prRename(pid, from, to) {
    if (!from || !to || from === to) return;
    var e = prs[edKey(pid)]; if (!e) return;
    e.renames[from] = to; e.renames[from + '-confirm'] = to + '-confirm';
    /* Where every ID practice recorded is now, for practice Undo (PR.applyEntry) and Back to practice's target. */
    var add = {}; add[from] = to; add[from + '-confirm'] = to + '-confirm';
    e.moved = PR.chain(e.moved, add);
  }
  function typesRev() { var t = (data.stepTypes || {}).types || {}; return Object.keys(t).length + ':' + U.hash(JSON.stringify(t)); }
  /* The admitted map for this text (cached by text and step types); a refused text keeps the last one that was admitted. */
  function prMap(e, text) {
    var key = typesRev() + '\n' + text;
    if (e.cache && e.cache.key === key) return e.cache;
    var a = PR.admit(text, prEnv());
    if (a.ok) {
      var was = e.st, wasFrom = e.st.from || '', rn = e.renames;
      e.st = PR.settle(e.st, a.map, e.renames, e.good ? e.good.map : null); e.renames = {};
      if (wasFrom && e.st.from !== wasFrom && rn[wasFrom] !== e.st.from) e.note = e.st.from ? 'The step you practiced from was removed, so practice runs from the next one.' : 'The step you practiced from was removed, so practice starts from the beginning.';
      /* An edit can also make it stop applying: it hands over for good, said once. */
      var pinned = PR.repin(e.st, a.map, prEnv());
      if (pinned.moved) { e.st = pinned.state; e.note = prMovedNote(pinned.moved); }
      e.good = { text: text, map: a.map };
      /* Kept as soon as it changed (a reload never brings back a from step that moved). */
      if (e.st !== was) prSave(e);
    }
    e.cache = { key: key, problem: a.ok ? '' : a.why, map: e.good ? e.good.map : null };
    return e.cache;
  }
  function prMovedNote(m) { return m === 'next' ? 'The step you practiced from doesn\'t apply now, so practice runs from the next one that does.' : 'The step you practiced from doesn\'t apply now, so practice starts from the beginning.'; }
  /* ---------- the practice run screen (2.3): views/run.js over a stand-in, with ctx.practice ----------
     A page of its own (#/practice/<process>, state.view 'practice'). It never sets runKey, so nothing that reads the open
     run finds one; its actions are only those in PRACTICE (the guarded dispatch below), and its only writes are the
     editor's own Save draft and stageDraft. */
  function prKey(pid) { return 'practice:' + pid; }
  function prPending(pid) { return state.obPending === pid && state.obPendingField ? 'Apply or clear what you typed in the box first ' + applyHint(state.obPendingField) + ', then practice it.' : ''; }
  /* The builder key for a practiced part, checked against the text it's admitted from: its own ID, or (a part without one)
     the part at the same place in the outline, if it's the same part. '' when there isn't one. */
  function prBuilderKey(p, id) {
    var e = prEntry(p.id), c = prMap(e, prText(p)); if (!c.map || c.problem) return '';
    var o = PF.outline.parse(prText(p)); if (o.unsupported) return '';
    var steps = M.steps(c.map), k = -1;
    steps.forEach(function (x, i) { if (x.step.id === id) k = i; });
    if (k >= 0) { var os = o.steps[k]; return os && (PR.isTemp(id) ? os.text === steps[k].step.text : os.key === id) ? os.key : ''; }
    var pi = -1; c.map.phases.forEach(function (ph, i) { if (ph.gate.id === id || ph.id === id) pi = i; });
    var op = pi >= 0 ? o.phases[pi] : null;
    return op ? op.key : '';
  }
  /* The practice screen's model: the follow model (statuses and why), the stand-in the run view draws, and the header's. */
  function prModel() {
    var p = currentProcess(); if (!p) return null;
    var e = prEntry(p.id), text = prText(p), c = prMap(e, text), map = c.map, ed = editorOf(p.id), types = prEnv(), key = prKey(p.id);
    var model = map ? PR.follow(e.st, map, types, state.me) : null, d = map ? PR.derive(e.st, map, types) : null;
    var r = d ? Object.assign(PR.asRun(d.view, d.map, state.me, true, types), { title: p.title, process: p.id, id: '~practice', version: 'Draft' }) : null;
    var steps = {}, gates = {}, kept = {}, gone = [];
    if (model) model.phases.forEach(function (ph) { gates[ph.gate.id] = ph.gate; ph.steps.forEach(function (s) { steps[s.id] = s; }); });
    /* Typing kept for this practice that no box on the step takes now (a box removed or renamed, or the step gone). */
    if (d) Object.keys(state.stepDrafts).forEach(function (k) {
      var pre = draftKey(key, ''), id = k.indexOf(pre) === 0 ? k.slice(pre.length) : null, dr = id != null ? state.stepDrafts[k] : null; if (!dr || /^gate:/.test(id)) return;
      var x = M.findStep(d.map, id), names = {};
      if (x) { R.evidenceFor(r, x.step, null, d.map).list.forEach(function (ev) { names['rec-' + ev.name] = true; }); var tt = T.get(x.step.type || 'confirm', types.types || {}); if (tt) T.editable(tt).forEach(function (f) { names['fld-' + f] = true; }); }
      var vals = [];
      ['record', 'fields'].forEach(function (part) { Object.keys(dr[part] || {}).forEach(function (b) { if (!names[b] && String(dr[part][b]).trim()) vals.push({ name: b.replace(/^(rec|fld)-/, ''), value: dr[part][b] }); }); });
      if (vals.length) kept[id] = { id: id, text: x ? M.shownText(x.step, function (n) { return e.st.sample[n] || ''; }) : dr.text || id, values: vals, gone: !x };
    });
    if (model) {
      var goneIds = model.gone.filter(function (id) { return !PR.isTemp(id); });
      Object.keys(kept).forEach(function (id) { if (kept[id].gone && goneIds.indexOf(id) < 0) goneIds.push(id); });
      goneIds.slice(0, 5).forEach(function (id) { gone.push({ id: id, text: kept[id] ? kept[id].text : '', kept: kept[id] || null }); });
    }
    var details = map ? (map.meta.context || []).map(function (n) {
      var dd = PF.run.detailValueDef(map, n), hint = dd && dd.options && dd.options.length ? 'one of ' + dd.options.join(', ') : dd && dd.kind && dd.kind !== 'text' ? dd.kind : '';
      var by = model && model.setBy[n] ? M.findStep(map, model.setBy[n]) : null;
      return { name: n, value: e.st.sample[n] || '', hint: hint, setBy: by ? M.shownText(by.step, function (n) { return e.st.sample[n] || ''; }) : '' };
    }) : [];
    var saving = (state.draftSaving || {})[edKey(p.id)];
    var P = { key: key, pid: p.id, title: p.title, model: model, steps: steps, gates: gates, kept: kept, gone: gone, from: model ? model.from : null, details: details,
      problem: c.problem, note: e.note, refusal: e.refusal, gateErr: e.gateErr, paused: prPending(p.id), typed: e.typed, sampleErr: e.sampleErr, found: e.st.found,
      canUndo: e.undo.length > 0, canRedo: e.redo.length > 0, undoLabel: e.undo.length ? e.undo[e.undo.length - 1].label : '',
      hasAnswers: Object.keys(e.st.answers).length > 0 || Object.keys(e.st.gates).length > 0 || Object.keys(e.st.fields || {}).length > 0 || !!e.st.from,
      dirty: !!(ed && editorDirty(p)) || state.obPending === p.id, saving: !!saving, saveState: V.draftStatus(ctx, p, ed, text), saveErr: e.saveErr || null, incoming: prIncoming(p),
      stageNote: e.stageNote != null ? e.stageNote : p.latest ? '' : 'First version', noteErr: e.noteErr || '', staging: state.stageBusy === p.id,
      canEdit: function (id) { return !!prBuilderKey(p, id); },
      waiveText: function (gid) { var dr = draftOf(key, 'gate:' + gid, false); return dr && dr.record['pick-input'] != null ? dr.record['pick-input'] : ''; } };
    return { P: P, r: r, map: d ? d.map : null };
  }
  /* The run view's context for the practice page: the stand-in for the run, Practice's map, and nothing a run records. */
  function prCtx() {
    var m = prModel(); if (!m) return null;
    var c = Object.create(ctx);
    c.practice = m.P;
    c.run = function () { return m.r; };
    c.mapOf = function () { return m.map; };
    c.recording = function () { return true; };
    c.canRecover = function () { return false; };
    c.localCopy = function () { return null; };
    c.findRun = function () { return null; };
    c.attachments = function () { return []; };
    c.stepDraft = function (id) { return draftOf(m.P.key, id, false); };
    c.img = function (src, cap, full) { return ctx.img(src, cap, full, true); };
    return c;
  }
  V.practicePage = function () {
    var c = prCtx();
    if (!c) return '<div class="panel">That checklist isn\'t in this folder anymore. <button class="mini" data-act="nav" data-id="processes">Checklists</button></div>';
    return c.run() ? V.run(c) : '<div class="fpe rw pr-run" id="rw">' + V.practiceHead(c, c.practice, { total: 0, done: 0 }, 0) + '<div class="fpe-alerts rw-alerts">' + V.practiceAlerts(c, c.practice) + '</div></div>';
  };
  /* A change to the draft that waits while practicing (the editor adopts it, with its own checks, when you go back). */
  function prIncoming(p) {
    var ed = editorOf(p.id), w = ((p.proposed || {}).list || []).filter(function (x) { return x.fit === 'ready' || x.fit === 'older' || x.fit === 'already' || x.fit === 'review'; })[0];
    if (w) return 'Your assistant changed the draft. Back to the draft to see it.';
    if (ed && !ed.conflict && p.draft && ed.baseHash != null && U.hash(p.draft.md) !== ed.baseHash && p.draft.md !== ed.base) return 'Someone changed the draft. Back to the draft to see it.';
    return '';
  }

  /* One practice action: refused ones say why; done ones push one Undo entry. */
  function prDo(pid, label, fn, focus, at) {
    var p = currentProcess(); if (!p || p.id !== pid) return;
    var e = prEntry(pid), c = prMap(e, prText(p));
    if (!c.map) return false;
    var pend = prPending(pid);
    if (pend) { say(pend, 'warn'); render(); return false; }
    prTouch(e);
    var r = fn(e.st, c.map);
    /* Refused: said beside the step or gate it was about, and announced. */
    if (r.error) { e.refusal = { at: at == null ? null : String(at), msg: r.error }; say(r.error, 'warn'); state.msg.quiet = true; render(); return false; }
    e.refusal = null; e.note = r.moved ? prMovedNote(r.moved) : '';
    if (r.state === e.st) return null;
    e.undo.push(PR.undoEntry(e.st, r.state, label)); if (e.undo.length > PR.UNDO_MAX) e.undo.shift();
    e.redo = []; e.st = r.state; prSave(e);
    if (focus) state.focus = focus;
    render();
    return true;
  }
  function prMove(pid, back) {
    var e = prs[edKey(pid)]; if (!e) return;
    var from = back ? e.undo : e.redo, to = back ? e.redo : e.undo, x = from.pop(); if (!x) return; prTouch(e);
    var r = PR.applyEntry(e.st, x, e.moved); to.push(r.back); e.st = r.state; Object.keys(x.sample || {}).forEach(function (n) { delete e.typed[n]; delete e.sampleErr[n]; }); prSave(e);
    say((back ? 'Undid: ' : 'Redid: ') + x.label + '.', 'good'); state.msg.quiet = true; render();
  }
  /* A successful publish or stage of exactly the practiced text ends the practice; anything else keeps it. */
  function prEnded(pid, text) {
    var k = edKey(pid), e = prs[k];
    if (!e || !e.good || e.good.text !== text) return;
    delete prs[k]; delete state.practicing[k];
    Object.keys(state.stepDrafts).forEach(function (dk) { if (dk.indexOf(draftKey(prKey(pid), '')) === 0) delete state.stepDrafts[dk]; });
    try { sessionStorage.removeItem(prStoreKey(pid)); sessionStorage.removeItem(prStoreKey(pid) + ':typed'); } catch (err) { /* this tab only */ }
  }
  /* Any practice action, selection, form or typing (not the stage note): a stage that finishes later leaves practice as it is. */
  function prTouch(e) { e.act = (e.act || 0) + 1; }
  /* The team's step types and Jira workflows, as practice reads them (a run copies the same when it starts). */
  function prEnv() { return PR.env((data.stepTypes || {}).types || {}, data.jira && data.jira.workflows); }
  function prText(p) { var ed = editorOf(p.id); return ed ? (ed.text != null ? ed.text : ed.base) : p.draft ? p.draft.md : p.latest ? p.latest.md : ''; }
  function prNow() { var p = currentProcess(); return p && state.view === 'practice' ? p : null; }
  function prStepOf(id) { var m = prModel(); return m && m.P.steps[id] || null; }
  function prFocusRow(id) { return '#step-' + cssEsc(id) + ' .check:not([disabled]), #step-' + cssEsc(id) + ' .s-pick'; }
  /* Typed evidence and Fill in on the practice screen are drafts of their step, as in a run (harvest), kept per practice and
     with it in this tab (sessionStorage), so a reload or a trip to the editor keeps them. */
  function prKeepTyped(pid) {
    var pre = draftKey(prKey(pid), ''), out = Object.create(null);
    var e = prs[edKey(pid)], p = e && procFind(pid), c = p ? prMap(e, prText(p)) : null;
    Object.keys(state.stepDrafts).forEach(function (k) {
      if (k.indexOf(pre) !== 0) return;
      var d = state.stepDrafts[k], id = k.slice(pre.length), x = c && c.map && !/^gate:/.test(id) ? M.findStep(c.map, id) : null;
      /* The step's text goes with its typing, so a step removed from the draft can still be named. */
      if (x) d.text = x.step.text;
      /* Fill in open on screen is open in storage too, until Save or Cancel closes it. */
      var openNow = state.view === 'practice' && state.pick && state.pick.kind === 'fields' && state.pick.id === id;
      out[id] = { record: d.record, fields: d.fields, open: !!d.open || !!openNow, text: typeof d.text === 'string' ? d.text : '' };
    });
    try { var t = JSON.stringify(out); if (t.length > 200000) return; sessionStorage.setItem(prStoreKey(pid) + ':typed', t); } catch (err) { /* this tab only */ }
  }
  function prLoadTyped(pid) {
    var raw = null; try { raw = sessionStorage.getItem(prStoreKey(pid) + ':typed'); } catch (err) { raw = null; }
    if (!raw) return;
    var o; try { o = JSON.parse(raw); } catch (err) { return; }
    if (!o || typeof o !== 'object') return;
    var str = function (x) { var out = {}; if (x && typeof x === 'object') Object.keys(x).slice(0, 40).forEach(function (k) { if (typeof x[k] === 'string' && /^(rec|fld)-[\w-]{1,60}$|^pick-input$/.test(k)) out[k] = x[k].slice(0, PR.VALUE_MAX); }); return out; };
    Object.keys(o).slice(0, 50).forEach(function (id) {
      var v = o[id];
      if (typeof id !== 'string' || id.length > 90 || id in Object.prototype || !v || typeof v !== 'object' || Array.isArray(v)) return;
      var d = draftOf(prKey(pid), id, true); d.record = str(v.record); d.fields = str(v.fields); d.open = v.open === true;
      if (typeof v.text === 'string') d.text = v.text.slice(0, 300);
      if (!hasDraft(d)) delete state.stepDrafts[draftKey(prKey(pid), id)];
    });
  }
  /* What's typed on the practice screen goes to its drafts: the boxes (harvest) and a waiver's reason. */
  function prHarvest() {
    if (state.view !== 'practice' || !state.processId) return;
    harvest();
    var pk = state.pick, el = document.getElementById('pick-input'), p = currentProcess();
    if (pk && pk.kind === 'waive' && el && p) { var d = draftOf(prKey(p.id), 'gate:' + pk.id, true); d.record['pick-input'] = el.value; if (!el.value) delete d.record['pick-input']; }
    if (p) prKeepTyped(p.id);
  }

  /* ---------- the round trip: practice → the editor (Edit) → Back to practice ---------- */
  /* Where practice was: the selected step, its row's place on screen, the inspector and a form open on it. */
  function prTripOut(e) {
    var row = state.sel && document.getElementById('step-' + state.sel), top = row && row.getBoundingClientRect ? row.getBoundingClientRect().top : null;
    var ae = document.activeElement, box = ae && ae.id && /^(rec|fld)-|^pick-input$/.test(ae.id) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName || '') ? { id: ae.id, s: ae.selectionStart, e: ae.selectionEnd, top: ae.scrollTop || 0 } : prLastBox;
    prLastBox = null;
    e.trip = { sel: state.sel, top: top, insOpen: !!state.refOpen, pick: state.pick ? { kind: state.pick.kind, id: state.pick.id } : null, box: box, target: e.trip && e.trip.target || null };
  }
  /* The editor's last-touched part, kept as its own record (it outlives the builder's selection being cleared or deleted). */
  function prTarget(p, kind, key) {
    var e = prs[edKey(p.id)]; if (!e || !e.trip) return;
    var o = PF.outline.parse(edText(p)); if (o.unsupported) return;
    if (kind === 'step') {
      var s = o.steps.filter(function (x) { return x.key === key; })[0]; if (!s || !s.id) return;
      var ph = o.phases.filter(function (x) { return x.index === s.phase; })[0], sib = o.steps.filter(function (x) { return x.phase === s.phase; }), k = sib.indexOf(s);
      e.trip.target = { kind: 'step', id: s.id, phase: ph ? ph.id : '', prev: k > 0 ? sib[k - 1].id || '' : '', next: k < sib.length - 1 ? sib[k + 1].id || '' : '' };
    } else if (kind === 'phase') {
      var pp = o.phases.filter(function (x) { return x.key === key; })[0]; if (!pp) return;
      var m = PR.admit(edText(p), prEnv()), g = m.ok ? m.map.phases[pp.index] : null;
      e.trip.target = { kind: 'gate', id: g ? g.gate.id : '', phase: pp.id || '', prev: '', next: '' };
    }
  }
  /* The editor's selection as Practice's target: the builder's, or in Markdown the step whose lines hold the caret. */
  function prTargetNow(p) {
    var e = prs[edKey(p.id)]; if (!e || !e.trip) return;
    if (state.builder !== false) { var s = state.obSel; if (s && s.pid === p.id && (s.kind === 'step' || s.kind === 'phase')) prTarget(p, s.kind, s.key); return; }
    var ta = document.getElementById('draft-editor'); if (!ta || ta.selectionStart == null) return;
    var line = String(ta.value).slice(0, ta.selectionStart).split('\n').length - 1, o = PF.outline.parse(edText(p)); if (o.unsupported) return;
    var hit = null; o.steps.forEach(function (x) { if (x.line <= line && (x.end == null ? x.line : x.end) >= line) hit = x; });
    if (hit) { prTarget(p, 'step', hit.key); return; }
    /* The caret on a gate's lines: that gate. */
    var gp = o.phases.filter(function (x) { return x.gate && x.gate.line <= line && (x.gate.end == null ? x.gate.line : x.gate.end) >= line; })[0];
    if (gp) prTarget(p, 'phase', gp.key);
  }
  /* Where Back to practice lands: the target as it's named now; gone, the step after it, else before it, else its phase's
     gate, else the step practice had selected. */
  function prResolve(e, model) {
    var t = e.trip && e.trip.target, moved = e.moved || {}, cur = function (id) { return id && Object.prototype.hasOwnProperty.call(moved, id) ? moved[id] : id; };
    var has = Object.create(null), gates = Object.create(null);
    model.phases.forEach(function (ph) { gates[ph.gate.id] = ph; ph.steps.forEach(function (s) { if (s.status !== 'hidden') has[s.id] = true; }); });
    if (t && t.kind === 'gate' && gates[cur(t.id)]) return { kind: 'gate', id: cur(t.id) };
    if (t && t.kind === 'step') { var tries = [t.id, t.next, t.prev].map(cur); for (var i = 0; i < tries.length; i++) if (tries[i] && has[tries[i]]) return { kind: 'step', id: tries[i] }; var gph = model.phases.filter(function (ph) { return ph.id === t.phase; })[0]; if (gph) return { kind: 'gate', id: gph.gate.id }; }
    var sel = e.trip && cur(e.trip.sel);
    return sel && has[sel] ? { kind: 'step', id: sel } : null;
  }
  /* Edit: the draft editor with this part selected (its form open in the builder, its line selected in Markdown). */
  function prEdit(id) {
    var p = prNow(); if (!p) return;
    var e = prEntry(p.id), c = prMap(e, prText(p));
    if (c.problem) { e.refusal = { at: null, msg: 'The draft has a problem: ' + c.problem + ' Back to the draft to fix it.' }; render(); return; }
    var key = prBuilderKey(p, id); if (!key) return;
    var isStep = !!(c.map && M.findStep(c.map, id));
    prHarvest(); prTripOut(e); prTouch(e);
    if (isStep) e.trip.target = null;
    prToEditor(p, function () {
      if (isStep) { state.obSel = { pid: p.id, kind: 'step', key: key }; prTarget(p, 'step', key); state.focus = state.builder !== false ? 'ob-text' : 'draft-editor'; }
      else { state.obSel = { pid: p.id, kind: 'phase', key: key, part: 'gate' }; prTarget(p, 'phase', key); state.focus = state.builder !== false ? 'ob-g-title' : 'draft-editor'; }
      state.insTab = null;
      if (state.builder === false) {
        var o = PF.outline.parse(edText(p)), s = isStep ? o.steps.filter(function (x) { return x.key === key; })[0] : o.phases.filter(function (x) { return x.key === key; })[0];
        /* A gate's own line, when the draft writes one; else its phase's heading. */
        var isGate = !isStep && c.map && c.map.phases.some(function (ph) { return ph.gate.id === id; });
        state.mdLine = s ? (isGate && s.gate ? s.gate.line : s.line) : null;
      }
    });
  }
  /* To the editor (a history entry, so Back returns to practice). */
  function prToEditor(p, then) {
    setView('process'); state.processId = p.id; state.ptab = 'edit'; state.mapVer = null; openEditor(p);
    state.sel = null; state.pick = null; state.refOpen = false; state.fieldErr = null;
    if (then) then();
    render();
    if (state.mdLine != null) { var ta = document.getElementById('draft-editor'); if (ta && ta.setSelectionRange) { var lines = String(ta.value).split('\n'), at = 0; for (var i = 0; i < state.mdLine && i < lines.length; i++) at += lines[i].length + 1; try { ta.setSelectionRange(at, at + (lines[state.mdLine] || '').length); } catch (err) { /* not a text field */ } } state.mdLine = null; }
  }
  /* Into the practice page for the open draft, from the editor or a link: the editor's typing is applied first (refused with
     the usual hint); the run that was open is put away (its typing kept, as leaving it does), never restored from here. */
  function prEnter(p, how) {
    var pend = prPending(p.id) || (state.obPending === p.id ? 'Apply or clear what you typed in the box first, then practice it.' : '');
    if (pend && state.view === 'process') { say(pend, 'warn'); render(); return false; }
    var e = prEntry(p.id), was = state.view === 'process' && state.ptab === 'edit' && state.processId === p.id;
    if (was) { if (!e.trip) e.trip = { sel: null, top: null, insOpen: !narrow(), pick: null, target: null }; prTargetNow(p); }
    /* A change that arrived while away is adopted first, with the editor's own checks, so practice follows it. */
    followDrafts();
    leaveContext();
    state.practicing[edKey(p.id)] = true; prTouch(e);
    if (state.runKey) { state.runKey = null; resetRunUi(); }
    openEditor(p);
    setView('practice'); state.processId = p.id; state.ptab = 'edit'; state.mapVer = null;
    state.obPlace = null; state.obAsk = null; state.obRename = null; state.obRenamed = null; state.sel = null; state.pick = null; state.edit = null; state.fieldErr = null;
    prFollow(p);
    var c = prMap(e, prText(p)), model = c.map ? PR.follow(e.st, c.map, prEnv(), state.me) : null, dest = model ? prResolve(e, model) : null, t = e.trip;
    /* The restore order (docs/design.md section 34): reconciled, the target resolved, its phase unfolded, drawn, the inspector
       and a form it had open, the place on screen, then focus last. */
    if (dest && dest.kind === 'step') {
      var x = M.findStep(c.map, dest.id); if (x) state.unfold[x.phase.id] = true;
      state.sel = dest.id; state.refOpen = t && t.sel === dest.id ? t.insOpen : !narrow();
      if (t && t.pick && t.pick.id === dest.id && t.pick.kind === 'fields') state.pick = { kind: 'fields', id: dest.id, back: '[data-act="pick"][data-kind="fields"][data-id="' + cssEsc(dest.id) + '"]' };
      arriveAtStep(dest.id);
    } else if (dest && dest.kind === 'gate') {
      c.map.phases.forEach(function (ph) { if (ph.gate.id === dest.id) state.unfold[ph.id] = true; });
      if (t && t.pick && t.pick.id === dest.id) state.pick = { kind: t.pick.kind, id: dest.id };
    } else if (!dest && model && model.nextUp.step) { state.sel = model.nextUp.step; state.refOpen = !narrow(); arriveAtStep(state.sel); }
    var same = dest && t && dest.kind === 'step' && dest.id === t.sel;
    state.focus = dest && dest.kind === 'gate' ? '#gate-' + cssEsc(dest.id) + ' .btn.go, #gate-' + cssEsc(dest.id) + ' button:not([disabled])' : state.sel ? prFocusRow(state.sel) : 'run-h';
    if (same && t.pick && state.pick) state.focus = '#rw-ins input, #rw-ins select, #rw-ins textarea';
    if (same && t.box) state.focus = t.box.id;
    state.prArrive = { anchor: same && t.top != null ? { id: dest.id, top: t.top } : null, reveal: dest ? (dest.kind === 'gate' ? '#gate-' + cssEsc(dest.id) : '#step-' + cssEsc(dest.id)) : null, box: same ? t.box : null };
    if (how) H.mode = how;
    e.trip = null;
    render();
    return true;
  }
  /* After drawing the practice page from a trip: the row back where it was on screen, or just scrolled into view. */
  function prArrived() {
    var a = state.prArrive; state.prArrive = null; if (!a || state.view !== 'practice') return;
    var bx = a.box && document.getElementById(a.box.id);
    if (bx && document.activeElement === bx) { if (bx.setSelectionRange && a.box.s != null) try { bx.setSelectionRange(a.box.s, a.box.e); } catch (err) { /* not a text field */ } if (a.box.top) bx.scrollTop = a.box.top; }
    var el = a.anchor ? document.getElementById('step-' + a.anchor.id) : a.reveal ? app.querySelector(a.reveal) : null; if (!el || !el.getBoundingClientRect) return;
    if (a.anchor) { var dy = el.getBoundingClientRect().top - a.anchor.top, list = document.getElementById('rw-list'); if (list && list.scrollHeight > list.clientHeight) list.scrollTop += dy; else window.scrollBy(0, dy); }
    else if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
  /* Practice follows the draft after every change applied in the editor, page shown or not, so renames are followed in order. */
  function prFollow(p) { var e = prs[edKey(p.id)]; if (e) prMap(e, prText(p)); }

  /* ---------- the practice page's actions: run-screen names mapped to practice (the guarded dispatch) ---------- */
  function prPickStep(id) {
    var p = prNow(); if (!p) return null;
    var e = prEntry(p.id); prTouch(e);
    if (state.sel !== id) { harvest(); state.attErr = null; state.fieldErr = null; }
    /* An unfinished Fill in left for another step stays open, as in a run, and is open again on the way back. */
    if (state.pick && state.pick.id !== id) { if (state.pick.kind === 'fields') leaveFillIn(); else prHarvest(); state.pick = null; state.fieldsDraft = null; prKeepTyped(p.id); }
    state.sel = id;
    arriveAtStep(id);
    return e;
  }
  /* Check a step: with the evidence typed for it (its draft, else what the box would show); refused, the box says why. */
  function prAnswer(id, how) {
    var p = prNow(); if (!p) return; var e = prEntry(p.id), m = prModel(), s = m && m.P.steps[id]; if (!s) return;
    harvest();
    var d = draftOf(prKey(p.id), id, false);
    if (how !== 'skip' && s.status !== 'done' && (state.pick && state.pick.kind === 'fields' && state.pick.id === id || (d && d.open))) { say('Save or cancel Fill in first.', 'warn'); state.focus = '[data-act="save-fields"][data-id="' + cssEsc(id) + '"]'; render(); return; }
    var values = null, x = M.findStep(m.map, id);
    if (how === 'done' && x && s.status !== 'done') { values = {}; R.evidenceFor(m.r, x.step, null, m.map).list.forEach(function (ev) { var k = 'rec-' + ev.name; values[ev.name] = d && Object.prototype.hasOwnProperty.call(d.record, k) ? d.record[k] : V.evidenceDefault(ctx, m.r, x.step, ev); }); }
    var err = null, label = how === 'open' ? 'Uncheck' : how === 'na' ? 'Not needed' : how === 'skip' ? 'Check without evidence' : 'Check';
    var to = how === 'open' ? 'open' : how === 'na' ? 'na' : 'done', opts = how === 'skip' ? { skipped: true } : values && Object.keys(values).length ? { values: values } : undefined;
    state.fieldErr = null;
    var ok = prDo(p.id, label, function (st, map) { var r = PR.answer(st, map, id, to, prEnv(), new Date().toISOString(), opts); if (r.error && r.field) { err = r; return { state: st }; } return r; }, prFocusRow(id), id);
    if (err) { prPickStep(id); state.refOpen = true; state.fieldErr = { id: id, msg: err.error, field: 'rec-' + err.field }; state.focus = '#rec-' + cssEsc(err.field); render(); return; }
    if (ok && (to === 'done' || to === 'na')) dropDraft(prKey(p.id), id, ['record']);
    if (ok && to === 'done') land(state.processId, id);
    if (ok) prKeepTyped(p.id);
  }
  var PRACTICE = {
    toggle: function (id) { var s = prStepOf(id); if (!s) return; prPickStep(id); if (s.status === 'done') prAnswer(id, 'open'); else if (s.ask && s.status !== 'done') { state.refOpen = true; var m = prModel(), x = m && M.findStep(m.map, id); if (x && V.recordShown(prCtx(), m.r, m.map, id)) { state.focus = '#rw-ins [id^="rec-"]'; render(); return; } prAnswer(id, 'done'); } else prAnswer(id, 'done'); },
    record: function (id) { prPickStep(id); prAnswer(id, 'done'); },
    'pr-ev-skip': function (id) { prPickStep(id); prAnswer(id, 'skip'); },
    na: function (id) { prPickStep(id); prAnswer(id, 'na'); },
    clear: function (id) { prPickStep(id); prAnswer(id, 'open'); },
    select: function (id, b) {
      var m = prModel(), x = m && m.map && M.findStep(m.map, id); if (!x) return;
      state.unfold[x.phase.id] = true; prPickStep(id); state.refOpen = true;
      if (b && b.dataset && b.dataset.nav) state.focus = 'ins-h';
      render(); if (b && b.dataset && b.dataset.nav) reveal('#step-' + cssEsc(id));
    },
    goto: function (id) {
      var m = prModel(), map = m && m.map, mm = /^(step|gate|phase)-(.+)$/.exec(id || ''), x = mm && mm[1] === 'step' && map ? M.findStep(map, mm[2]) : null;
      if (x) { prPickStep(x.step.id); state.refOpen = true; state.unfold[x.phase.id] = true; }
      if (!document.getElementById(id) && map && !x) map.phases.forEach(function (p) { state.unfold[p.id] = true; });
      render();
      var el = document.getElementById(id); if (!el) return;
      if (el.scrollIntoView) el.scrollIntoView({ block: mm && mm[1] === 'phase' ? 'start' : 'center' });
      var f = !mm ? el : mm[1] === 'step' ? el.querySelector('.check:not([disabled])') || el.querySelector('.s-pick') : mm[1] === 'phase' ? el.querySelector('h2') : el.querySelector('.btn.go') || el.querySelector('button:not([disabled])');
      if (f && f.focus) f.focus({ preventScroll: true });
    },
    'to-ins': function () { state.refOpen = true; state.focus = 'ins-h'; render(); },
    'to-row': function (id) { if (narrow()) state.refOpen = false; state.focus = '[data-act="select"][data-id="' + cssEsc(id) + '"]'; render(); },
    'close-ref': function () { prHarvest(); state.refOpen = false; render(); },
    unfold: function (id) { state.unfold[id] = true; state.focus = '[data-act="fold"][data-id="' + cssEsc(id) + '"]'; render(); },
    fold: function (id) { state.unfold[id] = false; state.focus = '[data-act="unfold"][data-id="' + cssEsc(id) + '"]'; render(); },
    /* Only the forms practice has: Fill in, and Pass and Waive on a gate. */
    pick: function (id, b) {
      var kind = b && b.dataset.kind, p = prNow(); if (!p || ['fields', 'pass', 'waive'].indexOf(kind) < 0) return;
      /* A Fill in open on another form's way is left open, with its typing, as switching steps leaves it. */
      if (state.pick && state.pick.kind === 'fields' && !(kind === 'fields' && state.pick.id === id)) { leaveFillIn(); state.pick = null; }
      prHarvest(); prTouch(prEntry(p.id));
      if (kind === 'fields') { prPickStep(id); var fd = draftOf(prKey(p.id), id, false); if (fd) fd.open = false; }
      state.pick = { kind: kind, id: id, back: '[data-act="pick"][data-kind="' + cssEsc(kind) + '"][data-id="' + cssEsc(id) + '"]' };
      state.focus = kind === 'fields' ? '#rw-ins [id^="fld-"]' : kind === 'waive' ? 'pick-input' : '[data-act="pass"]';
      render();
    },
    /* Cancel closes the form and keeps what was typed in it (Discard is the form's own). */
    unpick: function () { var pk = state.pick; prHarvest(); state.pick = null; state.fieldErr = null; state.fieldsDraft = null; var p = prNow(); if (p && pk && pk.kind === 'fields') { var d = draftOf(prKey(p.id), pk.id, false); if (d) { d.open = false; if (!hasDraft(d)) dropDraft(prKey(p.id), pk.id, ['open']); } prKeepTyped(p.id); } if (pk && pk.back) state.focus = pk.back; render(); },
    'save-fields': function (id) {
      var p = prNow(); if (!p) return; var e = prEntry(p.id), m = prModel(), x = m && M.findStep(m.map, id); if (!x) return;
      var t = T.get(x.step.type || 'confirm', prEnv().types || {}), fields = {};
      if (t) T.editable(t).forEach(function (f) { var el = document.getElementById('fld-' + f); if (el) fields[f] = inputValue(el); });
      var err = null, ok = prDo(p.id, 'Fill in', function (st, map) { var r = PR.fillIn(st, map, id, fields, prEnv()); if (r.error) { err = r; return { state: st }; } return r; }, prFocusRow(id), id);
      if (err) { state.fieldErr = { id: id, msg: err.error, field: err.field ? err.field : '' }; state.focus = err.field ? '#' + cssEsc(err.field) : '[aria-invalid="true"]'; render(); return; }
      if (ok === false) return;
      state.pick = null; state.fieldErr = null; dropDraft(prKey(p.id), id, ['fields', 'open']); prKeepTyped(p.id);
      say('Filled in for practice.', 'good'); state.msg.quiet = true; state.focus = prFocusRow(id); render();
      void e;
    },
    pass: function (pi) { prGate(+pi, 'pass'); },
    waive: function (pi) { prGate(+pi, 'waive'); },
    reopen: function (pi) { prGate(+pi, 'reopen'); },
    'pr-edit': function (id) { prEdit(id); },
    'pr-back': function (id) {
      var p = prNow(); if (!p) return; var e = prEntry(p.id);
      prHarvest(); prTripOut(e); e.trip.target = null; prTouch(e);
      /* The editor shows the step being practiced, so coming straight back lands where you were. */
      var key = state.sel ? prBuilderKey(p, state.sel) : '';
      prToEditor(p, function () {
        state.focus = id === 'compare' ? '[data-act="draft-keep-mine"]' : 'ed-h';
        if (!key) return;
        state.obSel = { pid: p.id, kind: 'step', key: key }; prTarget(p, 'step', key);
        if (state.builder === false) { var os = PF.outline.parse(edText(p)).steps.filter(function (x) { return x.key === key; })[0]; state.mdLine = os ? os.line : null; }
      });
    },
    'pr-close': function () { var p = prNow(); if (!p) return; prHarvest(); prTouch(prEntry(p.id)); prToEditor(p, function () { state.focus = '[data-act="pr-open"]'; say('Practice is kept in this tab. Choose Practice to pick it up again.', 'good'); state.msg.quiet = true; }); },
    'pr-samples': function () { state.prSamples = !state.prSamples; state.focus = state.prSamples ? 'pr-sample-h' : '[data-act="pr-samples"]'; render(); },
    'pr-found-open': function () { state.prFound = !state.prFound; state.focus = state.prFound ? 'pr-found' : '[data-act="pr-found-open"]'; render(); },
    'pr-save': function () {
      var p = prNow(); if (!p) return; var e = prEntry(p.id), pend = prPending(p.id); if (pend) { say(pend, 'warn'); render(); return; }
      prHarvest(); e.saveErr = null;
      var ed = openEditor(p), ae = document.activeElement, from = ae && ae.dataset ? ae.dataset.act : null, back = from === 'pr-save' ? '[data-act="pr-save"], [data-act="pr-close"]' : null;
      saveDraftText(p, ed.text != null ? ed.text : ed.base, ed.baseHash, 'Draft saved.', { expectText: ed.baseHash == null ? null : ed.base, done: function (how) {
        e.saveErr = how === 'conflict' ? { conflict: true, msg: 'Not saved: someone else changed this draft since you opened it. Compare them in the editor, then keep yours or take theirs.' } : how === 'failed' ? { conflict: false, msg: 'The draft couldn\'t be saved. Your edits are still here.' } : null;
        /* A save that finishes after you moved on only updates the save state and its message. */
        if (state.view !== 'practice' || state.processId !== p.id) return;
        if (how === 'saved' && state.msg) state.msg.quiet = true;
        /* Focus moves only if it's still where the save started: never out of a box you went on to. */
        var now = document.activeElement, moved = now && now !== document.body && !(now.dataset && now.dataset.act && now.dataset.act === from);
        state.focus = moved ? null : e.saveErr ? (e.saveErr.conflict ? '[data-act="pr-back"][data-id="compare"]' : '[data-act="pr-save"]') : back;
        render();
      } });
    },
    'pr-kept-copy': function (id) { var m = prModel(), k = m && m.P.kept[id]; if (!k) return; copyText(k.values.map(function (v) { return v.name + ': ' + v.value; }).join('\n'), null, 'Copied what you typed.'); },
    'pr-kept-drop': function (id) { var p = prNow(); if (!p) return; dropDraft(prKey(p.id), id, ['record', 'fields', 'open']); prKeepTyped(p.id); say('Discarded what you typed for that step.', 'good'); state.msg.quiet = true; state.focus = 'run-h'; render(); },
    dismiss: function () { var p = prNow(); if (p) { var e = prEntry(p.id); e.note = ''; e.refusal = null; } say(null); render(); },
    help: function () { openOverlay({ html: function () { return V.help(ctx); } }); },
    zoom: function (id, b) { var m = prModel(), x = m && M.findStep(m.map, id); if (!x) return; openLightbox(x.step.shots.map(function (s) { return { src: s.src, caption: s.caption }; }), +b.dataset.i); },
    'zoom-phase': function (id, b) { var m = prModel(), ph = m && m.map.phases.filter(function (x) { return x.id === id; })[0]; if (ph) openLightbox((ph.shots || []).map(function (s) { return { src: s.src, caption: s.caption }; }), +b.dataset.i); },
    'zoom-gate': function (id, b) { var m = prModel(), ph = m && m.map.phases.filter(function (x) { return x.gate.id === id; })[0]; if (ph) openLightbox((ph.gate.shots || []).map(function (s) { return { src: s.src, caption: s.caption }; }), +b.dataset.i); }
  };
  /* A gate: Pass, Waive (with its reason) or Reopen this phase. */
  function prGate(pi, how) {
    var p = prNow(); if (!p) return; var e = prEntry(p.id), why = how === 'waive' ? val('pick-input') : '';
    e.gateErr = null;
    var ok = prDo(p.id, how === 'reopen' ? 'Reopen the phase' : how === 'waive' ? 'Waive the gate' : 'Pass the gate', function (st, map) { var r = PR.gateAct(st, map, pi, how, why, prEnv(), new Date().toISOString()); if (r.error && how === 'waive') { e.gateErr = { pi: pi, msg: r.error }; return { state: st }; } return r; }, null, 'gate:' + pi);
    var c = prMap(e, prText(p)), g = c.map && c.map.phases[pi] ? c.map.phases[pi].gate : null;
    if (!ok && e.gateErr) { state.focus = 'pick-input'; render(); return; }
    if (ok) { if (g && how !== 'reopen') { dropDraft(prKey(p.id), 'gate:' + g.id, ['record']); prKeepTyped(p.id); } if (!(state.pick && state.pick.kind === 'fields')) state.pick = null; var pm2 = how === 'pass' ? prModel() : null; if (pm2 && pm2.r && pm2.map) { afterPass(R.nextUp(pm2.r, pm2.map, state.me), pm2.map, true); render(); return; } state.focus = g ? '#gate-' + cssEsc(g.id) + ' button:not([disabled])' : 'run-h'; render(); }
  }
  /* Run-screen actions the practice page allows, with any condition on their payload; pr-* are practice's own. */
  var PRACTICE_OK = { toggle: 1, record: 1, na: 1, clear: 1, select: 1, goto: 1, 'to-ins': 1, 'to-row': 1, 'close-ref': 1, unfold: 1, fold: 1, pick: function (b) { return !!b && /^(fields|pass|waive)$/.test(b.dataset.kind || ''); }, unpick: 1, 'save-fields': 1, pass: 1, waive: 1, reopen: 1, dismiss: 1, help: 1, 'find-clear': 1, 'sel-more': 1, copy: 1, zoom: 1, 'zoom-phase': 1, 'zoom-gate': 1, nav: function (b) { return !!b && b.dataset.id === 'processes'; } };
  /* The one way an action runs: on the practice page only what's allowed there, through Practice's own handlers. */
  /* The practice page's own controls (not the top bar's or a dialog's, which act as anywhere). */
  function onPracticePage(el) { return state.view === 'practice' && !(el && el.closest && (el.closest('#top') || el.closest('#overlay'))); }
  function dispatch(act, id, el) {
    if (onPracticePage(el)) {
      var ok = /^pr-/.test(act) ? !!(PRACTICE[act] || prActs[act]) : PRACTICE_OK[act];
      if (!ok || (typeof ok === 'function' && !ok(el))) return false;
      var h = PRACTICE[act] || prActs[act] || ACTIONS[act];
      h(id, el); return true;
    }
    var handler = ACTIONS[act]; if (!handler) return false;
    handler(id, el); return true;
  }
  var prActs = {
    /* The editor's Practice (and Back to practice): the practice run screen for what's on screen. */
    'pr-open': function () { var p = currentProcess(); if (!p) return; prEnter(p); },
    'pr-undo': function () { var p = prNow(); if (p) prMove(p.id, true); },
    'pr-redo': function () { var p = prNow(); if (p) prMove(p.id, false); },
    'pr-reset': function () { var p = prNow(); if (!p) return; var re = prEntry(p.id); if (!prDo(p.id, 'Reset', function (st) { re.typed = {}; re.sampleErr = {}; return PR.reset(st); }, 'run-h')) return; say('Practice reset. Undo brings it back.', 'good', { act: 'pr-undo', label: 'Undo' }); render(); },
    'pr-from': function (id) { var p = prNow(); if (!p) return; prPickStep(id); prDo(p.id, 'Run from here', function (st, map) { return PR.setFrom(st, map, id); }, prFocusRow(id), id); },
    'pr-from-clear': function () { var p = prNow(); if (!p) return; prDo(p.id, 'Start from the beginning', function (st, map) { return PR.setFrom(st, map, ''); }, 'run-h'); },
    /* Copy what I found: the clipboard when the browser allows it; otherwise the text is selected in its box to copy by hand. */
    'pr-copy': function () {
      var p = prNow(); if (!p) return; var e = prEntry(p.id), text = e.st.found; if (!text) return;
      var say1 = function (m) { var el = document.getElementById('pr-copy-msg'); if (el) el.textContent = m; };
      var hand = function () { var ta = document.getElementById('pr-found'); if (ta) { ta.focus(); if (ta.select) ta.select(); } say1('Selected. Press Ctrl+C (Cmd+C on a Mac) to copy it.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { say1('Copied. Paste it wherever you keep notes, or to your AI assistant.'); }, hand);
      else hand();
    },
    /* From the success notice: unsaved edits are saved first (the notice offers Save draft then); a saved draft goes to its
       process page with All versions open on the change note, where Stage the draft for testing is. */
    'pr-stage': function () {
      var p = currentProcess(); if (!p) return;
      if (state.obPending === p.id && state.obPendingField) { say('Apply or clear what you typed in the box first ' + applyHint(state.obPendingField) + ', then save the draft and stage it.', 'warn'); render(); return; }
      if (editorDirty(p)) { say('Save the draft first, then stage it.', 'warn'); state.focus = '[data-act="pr-save"]'; render(); return; }
      var e = prEntry(p.id), note = String(e.stageNote != null ? e.stageNote : p.latest ? '' : 'First version').trim();
      if (!note) { e.noteErr = 'Write what changed (one line), then stage it.'; state.focus = 'pr-note'; render(); return; }
      stageDraft(p.id, note, { e: e, act: e.act || 0, text: edText(p), note: e.stageNote, ui: uiActs });
    }
  };
  /* Every click on a control, key pressed, or box typed in or changed counts here: anything done after Stage is someone
     moving on, even when it ends where it began. */
  var uiActs = 0;
  /* Stage the saved draft for test runs (the overview's Stage button, or Practice's: origin). Same checks and write either way. */
  function stageDraft(id, note, origin) {
      var p = procFind(id);
      if (!p || !p.draft || stillSaving(p) || state.stageBusy) return;
      var ed = editorOf(p.id);
      if (dirty(ed) || (ed && ed.conflict) || state.obPending === p.id || shotBusy(p.id)) { say('Your edits to this draft aren\'t saved yet, so nothing was staged. Save them first.', 'warn'); render(); return; }
      var shown = p.draft.md, sfs = state.fs, pg = gen, by = state.me, people = data.people, wfs = data.jira.workflows, pids = processes().filter(function (x) { return x.latest; }).map(function (x) { return x.id; });
      state.stageBusy = id; render();
      /* Bound to the folder it was asked in: another folder opened meanwhile drops it, before any read and before the write. */
      var stale = function () { return pg !== gen || state.fs !== sfs || state.me !== by; };
      queued(function () {
        if (stale()) return { dropped: true };
        return Promise.all([sfs.read('maps/drafts/' + p.draft.file), repo.loadStepTypes(sfs)]).then(function (got) {
          if (stale()) return { dropped: true };
          if (!got[0] || got[0].text !== shown) return { changed: true };
          /* The corrections this exact text includes, as publishing records them, so promoting it keeps them. */
          var inc = PF.corrections.forPublish(got[0].text, ctx.corrections(id)).list;
          return repo.stage(sfs, got[0].text, { people: people, customTypes: got[1].types, workflows: wfs, processes: pids, by: by, changes: note, existing: p.taken, now: new Date().toISOString(), corrections: inc, app: APP_VERSION, still: function () { return !stale(); } });
        });
      }).then(function (res) {
        state.stageBusy = null; if (pg !== gen) return;
        if (res.dropped) { say('Nothing was staged: the person using this window changed before it could be saved.', 'warn'); render(); return; }
        if (res.changed) { say('The draft changed since this page was drawn, so nothing was staged. Here is the newest draft.', 'warn'); return load(true); }
        if (res.blockers) { say(res.blockers[0], 'warn'); render(); return; }
        if (!origin) {
          prEnded(id, shown); state.clearInputs = 'change-note'; state.disc = Object.assign({}, state.disc); state.disc['vers:' + id] = true;
          say('Staged. Only test runs use it until someone makes it the default.', 'good');
          /* The new stage is shown whatever the page of Stages (2.11), with Start a test run focused and in view. */
          return loadAfterWrite().then(function () { if (pg !== gen || state.processId !== id || state.view !== 'process') return; ensureListItemVisible('stages:' + id, res.folder, { focus: '[data-act="start-test"][data-id="' + cssEsc(res.folder) + '"]', word: 'staged' }); render(); });
        }
        /* From Practice: the stage's page opens, and practice ends, only if nobody moved on meanwhile (same folder, person and
           process, the editor's text as it was, no unapplied typing, no practice activity since the click). */
        var calm = function () {
          var cp = currentProcess(), oe = prs[edKey(id)], ae = document.activeElement;
          return pg === gen && state.fs === sfs && state.me === by && cp && cp.id === id && state.view === 'practice' &&
            oe === origin.e && (oe.act || 0) === origin.act && edText(cp) === origin.text && uiActs === origin.ui && !(state.obPending === id && state.obPendingField) &&
            !(ae && ae.id !== 'pr-note' && /INPUT|TEXTAREA|SELECT/.test(ae.tagName || ''));
        };
        /* A note typed since the click is the person's next one: only the note that was staged is cleared. */
        /* Cleared now, before the folder is read again, so nothing typed after this point is touched; '' (not the "First
           version" prefill) so an empty box is refused like any other. */
        if (origin.e.stageNote === origin.note) { origin.e.stageNote = ''; origin.e.noteErr = null; var nb = document.getElementById('pr-note'), np = currentProcess(); if (nb && np && np.id === id && prs[edKey(id)] === origin.e) nb.value = ''; }
        /* The stage must be in what the folder read says, ready to start a test run from, before practice ends for it. */
        var shown1 = function () {
          var procs = (data.stages || {}).procs || {}, sp = Object.prototype.hasOwnProperty.call(procs, id) ? procs[id] : null, cp = procFind(id);
          var s = sp && cp ? sp.stages.filter(function (x) { return x.folder === res.folder; })[0] : null;
          if (state.folderErr || (data.failed || {}).stages || !s || !s.ok || s.newer || sp.unlisted || sp.unread.length || sp.refused.some(function (r) { return /\/decisions\//.test(r.path); })) return false;
          return PF.staging.status(s, sp.decisions, cp.all).status === 'staged';
        };
        return loadAfterWrite().then(function () {
          if (pg !== gen) return;
          if (!shown1()) { say('Staged as ' + res.folder + ', but a test run can\'t start from it yet: part of the folder couldn\'t be read just now. Your practice is still open.', 'warn'); render(); return; }
          if (!calm()) { say('Staged. Your practice is still open.', 'good'); render(); return; }
          prEnded(id, shown); setView('process'); state.processId = id; state.ptab = 'overview'; state.mapVer = null; state.disc = Object.assign({}, state.disc); state.disc['vers:' + id] = true;
          ensureListItemVisible('stages:' + id, res.folder, { focus: '[data-act="start-test"][data-id="' + cssEsc(res.folder) + '"]', word: 'staged' });
          say('Staged. Start a test run from it; only test runs use it until someone makes it the default.', 'good'); render();
        });
      }, function (e) { state.stageBusy = null; if (pg !== gen) return; say('Couldn\'t stage it: ' + e.message, 'bad'); load(true); });

  }
  /* ---------- applying a correction to the draft (docs/design.md section 19, slice 2) ---------- */
  function caOv() { return state.overlay && state.overlay.corrApply ? state.overlay : null; }
  function caFind(pid, gid) {
    var p = procFind(pid), all = p ? ctx.corrections(p.id) : [];
    return { p: p, all: all, g: all.filter(function (x) { return x.id === gid; })[0] || null };
  }
  function caErr(ov, msg, field) { ov.err = { msg: msg, field: field || 'ca-acts' }; state.overlayFocus = field ? '#' + field : '#ca-t'; render(); }
  /* The draft a correction is compared with: the editor's starting point, the same one the dialog shows (views corrBase). */
  function caBase(p) { var ed = editorOf(p.id); return ed ? ed.base : p.draft ? p.draft.md : p.latest ? p.latest.md : ''; }
  /* What this window applied whose decision isn't written yet, per folder, process and group (views/process.js reads it too):
     the next look recognizes it, in the person's own words too, and offers Link. */
  state.corrApplied = {};
  function caKey(pid, gid) { return fsKey() + '\n' + pid + '\n' + gid; }
  function caApplied(pid, gid) { return state.corrApplied[caKey(pid, gid)] || null; }
  /* Why nothing may be applied to this draft right now, or ''. Unsaved edits in this window come first: applying over them
     would mix the correction into changes nobody has saved. */
  function caBlocked(p) {
    var dw = draftUnread(p); if (dw) return dw + ' Nothing is applied until it reads again.';
    if (state.draftSaving[edKey(p.id)]) return 'Still saving this draft. Try again in a moment.';
    var ed = editorOf(p.id);
    if (ed && ed.conflict) return 'Someone else changed this draft while you were editing it. Settle that in the editor first.';
    if (dirty(ed) || state.obPending === p.id) return 'You have unsaved changes to this draft. Save or discard them in the editor first.';
    if (shotBusy(p.id)) return 'A screenshot is still being added to this draft. Try again when it\'s done.';
    return '';
  }
  /* A decision of applied, with the result it records, written once; Link, Already addressed and Mark as applied in the dialog. */
  function caDecide(ov, status, reason, msg, result, more) {
    var x = caFind(ov.pid, ov.gid), g = x.g; if (!g || !state.me) return;
    var rec;
    try { rec = PF.corrections.decision(g, state.me, status, reason, new Date().toISOString(), Object.assign({ current: g.decision, act: U.randomId(10), result: result }, more || {})); }
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
    ed.text = rv.text; state.planFormReset = true; state.obFlash = null; state.obAsk = null; state.obRename = null; state.obRenamed = null;
    var dfs = state.fs, gg = gen, text = rv.text, added = rv.added, me = state.me, left = others.filter(function (y) { return ids.indexOf(y.id) < 0; }).length;
    closeOverlay(); state.focus = 'fx-h';
    saveDraftText(p, text, ed.baseHash, TL.past(lb.past, subj) + '. Saved to the draft.' + (left ? ' The other proposal' + (left === 1 ? ' is' : 's are') + ' still open.' : ''), {
      act: { act: 'tl-undo', id: 'draft', label: 'Undo' }, source: 'correction', expectText: ed.baseHash == null ? null : base,
      /* Not saved: the change waits in the editor as unsaved, so the editor opens rather than hiding it. */
      failed: function () { if (gg !== gen || state.processId !== p.id || state.view !== 'process') return ''; state.ptab = 'edit'; state.focus = 'ed-h'; return ' The correction is in the editor, not saved yet. Save draft to try again.'; },
      write: function (f, file, t, h, o) { return repo.applyCorrection(f, { process: p.id, file: file, base: base, expect: h, group: g, edited: edited, confirmed: how === 'edit', text: t }, o); },
      after: function () {
        if (gg !== gen) return null;
        return gs.reduce(function (pr, y) {
          return pr.then(function () {
            var res = C.outcome(y, text, y === g ? added : ''), k = caKey(p.id, y.id), rec = C.decision(y, me, 'applied', '', new Date().toISOString(), { current: y.decision, act: U.randomId(10), result: res });
            state.corrApplied[k] = res;
            return queued(function () { return repo.decideCorrection(dfs, rec, WRITER); }).then(function () { delete state.corrApplied[k]; });
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
  /* keep: the caller keeps every box's typing itself (shotApply); otherwise a change while another box holds typing it hasn't
     applied (or refused) waits, since the redraw would drop that typing. */
  function builderEdit(op, field, what, keep) {
    var p = currentProcess(); if (!p || builderBlocked(p)) return null;
    if (!keep && obHeld(p, 'then change anything else', field)) return null;
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
    /* The checklist's details and its Questions section aren't steps or phases: they stay selected while they're there. */
    var sl = state.obSel; if (sl && sl.pid === p.id && !isWhole(sl)) { var nk = F(sl.kind === 'track' ? 'phase' : sl.kind, sl.key); if (nk) sl.key = nk; else state.obSel = null; }
    gateKept(state.obSel, res.text);
    var ad = state.obAdd;
    if (ad && ad.pid === p.id) {
      if (ad.after != null) ad.after = F(ad.kind === 'phase' ? 'phase' : 'step', ad.after);
      if (ad.phase != null) ad.phase = F('phase', ad.phase);
      if (ad.kind === 'step' && ad.after == null && ad.phase == null) state.obAdd = null;
    }
    return res;
  }
  /* ---------- screenshots in the builder (docs/design.md section 20) ---------- */
  /* Images being added, per folder and process: unsaved work while they're written, so live apply waits, Apply and
     corrections wait, presence holds the draft and leaving the page asks first. */
  state.shotBusy = {};
  function shotKey(pid, fk) { return (fk == null ? fsKey() : fk) + '|' + pid; }
  function shotBusy(pid) { return state.shotBusy[shotKey(pid)] || 0; }
  function shotErr(field, msg) { state.fieldErr = { id: 'ob', field: field, msg: msg }; state.focus = '#' + field; say(null); render(); }
  /* Images chosen, pasted or dropped on the selected step, one at a time and in order: each is checked (kind, 5 MB, its first
     bytes), the line it would add is checked against the draft (its caption, the step, the 1 MB limit), then the image is
     written once and read back (repo.saveShot), and only then is its line added through builderEdit, as one Undo entry. A
     refusal or a failed write stops there, adds nothing and says why next to Choose files. The editor stays the only writer
     of the draft: the line is unsaved until Save draft. */
  function shotAdd(list, stepKey) {
    var files = Array.prototype.slice.call(list || []), p = currentProcess(), sel = state.obSel;
    if (!files.length || !p || !sel || (sel.kind !== 'step' && sel.kind !== 'phase') || sel.pid !== p.id || builderBlocked(p)) return Promise.resolve();
    /* A phase's own screenshots (2.0) are added the same way, from the phase's form. */
    var kind = sel.kind, opOf = function (k, more) { var o = { op: 'addShot' }; o[kind] = k; Object.keys(more).forEach(function (x) { o[x] = more[x]; }); return o; };
    var capEl = document.getElementById('ob-shot-new'), capRaw = capEl ? capEl.value : '', cap = PF.outline.caption(capRaw);
    if (cap.error) { shotErr('ob-shot-new', cap.error); return Promise.resolve(); }
    if (state.fieldErr && state.fieldErr.id === 'ob') state.fieldErr = null;
    var sfs = state.fs, g = gen, fk = fsKey(), pid = p.id, key = shotKey(pid, fk), n = files.length, left = n, stopped = false, epoch = edEpoch(pid, fk);
    var gone = 'That ' + kind + ' isn\'t in the draft anymore, so the image wasn\'t added.';
    var ident = shotIdent(edText(p), stepKey != null ? String(stepKey) : sel.key, kind);
    if (!ident) { shotErr('ob-shot-file', 'That ' + kind + ' isn\'t in the draft anymore. It may have just changed.'); return Promise.resolve(); }
    state.shotBusy[key] = (state.shotBusy[key] || 0) + n; render();
    function settle(k) { k = Math.min(k, left); left -= k; state.shotBusy[key] = (state.shotBusy[key] || 0) - k; if (state.shotBusy[key] <= 0) delete state.shotBusy[key]; }
    function here() { return g === gen && fsKey() === fk && state.processId === pid; }
    /* A reason shows next to Choose files when that step's form is the one open; otherwise it's said as a message. */
    function stop(field, msg) {
      stopped = true; settle(left);
      if (!here() || !msg) { render(); return; }
      var s = state.obSel, on = s && s.kind === kind && shotFind(edText(p), ident);
      if (on && on.key === s.key) shotErr(field, msg); else { say(msg, 'warn'); render(); }
    }
    return files.reduce(function (pr, f, i) {
      return pr.then(function () {
        if (stopped) return;
        if (!here() || edEpoch(pid, fk) !== epoch) { stop(); return; }
        var name = String(f.name || 'image').split(/[\\/]/).pop().slice(0, 80), caption = cap.value + (n > 1 ? ' (' + (i + 1) + ' of ' + n + ')' : '');
        var ok = PF.attach.checkShot(name, f.type, f.size); if (ok.error) { stop('ob-shot-file', ok.error); return; }
        var st = shotFind(edText(p), ident); if (!st) { stop('ob-shot-file', gone); return; }
        var plan = PF.outline.apply(edText(p), opOf(st.key, { caption: caption, src: PF.attach.shotPath(pid, ident.id, Date.now(), WRITER, 'aaaaaa', ok.ext) }));
        if (plan.error) { stop('ob-shot-file', plan.error); return; }
        if (U.draftTooBig(plan.text)) { stop('ob-shot-file', '"' + name + '" wasn\'t added: its line would take this draft over 1 MB, and Flightdeck saves drafts up to 1 MB. Shorten the draft first.'); return; }
        return headOf(f).then(function (head) {
          if (!PF.attach.sniff(head, ok.ext)) throw { plain: '"' + ok.name + '" doesn\'t look like a .' + ok.ext + ' file inside, so it wasn\'t added.' };
          return queued(function () { return repo.saveShot(sfs, { process: pid, step: ident.id, file: f, writer: WRITER }); });
        }).then(function (r) {
          if (g !== gen || edEpoch(pid, fk) !== epoch) { stop(); say('The image was saved as ' + r.path + ' but not added, because the draft was reset.', 'warn'); render(); return; }
          if (!here()) { stop(); if (g === gen && fsKey() === fk) say('The image was saved as ' + r.path + ', but the draft of ' + p.title + ' was closed, so it wasn\'t added to it. Add it again from the step.', 'warn'); render(); return; }
          /* Exactly the step it was added for, or nothing: a step without an ID is matched by its whole block and phase. */
          var now = shotFind(edText(p), ident);
          if (!now) { stop('ob-shot-file', gone + ' It\'s saved as ' + r.path + '.'); return; }
          settle(1);
          var res = shotApply(opOf(now.key, { caption: caption, src: r.path }), i === n - 1 ? capRaw : null);
          if (!res) { stopped = true; settle(left); return; }
          /* The block now holds the new line; later images in this batch look for that. */
          var po = PF.outline.parse(edText(p)), after = (kind === 'phase' ? po.phases : po.steps).filter(function (x) { return x.line === now.line; })[0];
          if (after) ident = shotIdentOf(po, after, kind);
        }, function (e) {
          stop('ob-shot-file', e && e.plain ? e.plain : 'Couldn\'t add "' + name + '": ' + (e && e.message || 'the image couldn\'t be saved.') + ' Nothing was added to the step.');
        });
      });
    }, Promise.resolve()).then(function () { if (left) settle(left); if (g === gen) render(); });
  }
  /* Who a step is, kept while its image is written: its ID when exactly one step has it, else its whole block (its lines)
     and its phase. shotFind answers only that same step, never one that took its place. */
  function shotIdentOf(o, s, kind) {
    var list = kind === 'phase' ? o.phases : o.steps, unique = s.id && list.filter(function (x) { return x.id === s.id; }).length === 1;
    var ph = kind === 'phase' ? s : s.phase;
    return { kind: kind === 'phase' ? 'phase' : 'step', id: unique ? s.id : '', block: o.lines.slice(s.line, s.end).join('\n'), phase: ph.title + '\n' + ph.index };
  }
  function shotIdent(text, k, kind) { var o = PF.outline.parse(text), s = (kind === 'phase' ? o.phases : o.steps).filter(function (x) { return x.key === k; })[0]; return s ? shotIdentOf(o, s, kind) : null; }
  function shotFind(text, ident) {
    var o = PF.outline.parse(text), hits = (ident.kind === 'phase' ? o.phases : o.steps).filter(function (x) {
      if (ident.id) return x.id === ident.id;
      var ph = ident.kind === 'phase' ? x : x.phase;
      return o.lines.slice(x.line, x.end).join('\n') === ident.block && ph.title + '\n' + ph.index === ident.phase;
    });
    return hits.length === 1 ? hits[0] : null;
  }
  /* An image's line, added while the person may be typing elsewhere in the builder: what they typed (applied or not, refused
     or not), which box is pending, its reason and where focus is all stay as they were. Nothing typed is applied for them.
     capRaw: the caption box's text this batch used, cleared once the batch is done unless it was changed meanwhile. */
  function shotApply(op, capRaw) {
    var typed = [], pend = { p: state.obPending, f: state.obPendingField }, err = state.fieldErr && state.fieldErr.id === 'ob' ? state.fieldErr : null;
    Array.prototype.forEach.call(app.querySelectorAll('input[id], textarea[id]'), function (el) {
      if (!/^ob-/.test(el.id || '') || el.type === 'file' || /^ob-part-q/.test(el.id)) return;
      var drawnV = /^ob-new-|^ob-shot-new$/.test(el.id) ? '' : fieldApplied(el.id);
      if (el.id === 'ob-shot-new' ? el.value !== capRaw && el.value !== '' : el.value !== drawnV) typed.push({ id: el.id, v: el.value });
    });
    var res = builderEdit(op, 'ob-shot-file', null, true);
    if (!res) return null;
    if (pend.p) { state.obPending = pend.p; state.obPendingField = pend.f; }
    if (err) state.fieldErr = err;
    state.planFormReset = false;
    render();
    typed.forEach(function (t) { var el = document.getElementById(t.id); if (el && el.value !== t.v) el.value = t.v; });
    if (capRaw != null && !typed.some(function (t) { return t.id === 'ob-shot-new'; })) { var ce = document.getElementById('ob-shot-new'); if (ce) ce.value = ''; }
    return res;
  }
  /* An image pasted while a step's or a phase's form has focus goes to it. */
  document.addEventListener('paste', function (e) {
    if (state.view !== 'process' || state.ptab !== 'edit' || !state.obSel || (state.obSel.kind !== 'step' && state.obSel.kind !== 'phase') || state.obSel.part === 'gate' || !e.clipboardData) return;
    var t = e.target; if (!(t && t.closest && t.closest('.ob-form'))) return;
    var items = e.clipboardData.items || [], files = [];
    for (var i = 0; i < items.length; i++) if (items[i].kind === 'file') { var f = items[i].getAsFile(); if (f) files.push(f); }
    if (!files.length) return;
    e.preventDefault(); shotAdd(files);
  });
  /* Files dragged from the computer onto Add screenshots. Let go anywhere else in the editor, they're caught, so the browser
     never swaps the page (and unsaved work) for the file. Dragging steps and parts is left to the builder's own handlers. */
  function shotZone(e) { return e.target && e.target.closest ? e.target.closest('[data-drop="shots"]') : null; }
  function shotDrag(e) { return state.view === 'process' && state.ptab === 'edit' && !drag && !partDrag && filesDrag(e); }
  document.addEventListener('dragover', function (e) {
    if (!shotDrag(e)) return;
    var z = shotZone(e); e.preventDefault();
    try { e.dataTransfer.dropEffect = z ? 'copy' : 'none'; } catch (err) { /* older browsers */ }
    if (z && z.classList && !z.classList.contains('dropping')) z.classList.add('dropping');
  });
  document.addEventListener('dragleave', function (e) { if (!shotDrag(e)) return; var z = shotZone(e); if (z && z.classList && !(e.relatedTarget && z.contains(e.relatedTarget))) z.classList.remove('dropping'); });
  document.addEventListener('drop', function (e) {
    if (!shotDrag(e)) return;
    var z = shotZone(e); e.preventDefault();
    if (!z) { say('Drop images on Add screenshots in a step\'s form.', 'warn'); render(); return; }
    if (z.classList) z.classList.remove('dropping');
    shotAdd(e.dataTransfer.files, z.getAttribute('data-id'));
  });

  /* ---------- Undo, Redo and History (PF.timeline): one timeline per draft editor and per step-type form ---------- */
  var TL = PF.timeline;
  function tlOf(ed) { return ed.tl || (ed.tl = TL.create()); }
  /* Every ID that was ever in a saved or loaded draft in this session: such a part is never new again, so no Undo can let
     its ID follow its name. Kept on the timeline, which outlives the editor objects a save replaces. */
  function learnIds(ed, text) { if (!ed || text == null) return; var tl = tlOf(ed), ids = PF.outline.parse(text).ids, k = tl.savedIds || (tl.savedIds = Object.create(null)); Object.keys(ids).forEach(function (x) { k[x] = true; }); }
  /* What rides along with a builder change: the selection, what's being added and the parts new in this window (freshCopy),
     so Undo and Redo put them back with the text. Typing not yet applied is never replayed: Undo waits for it instead. */
  /* Where the step form's groups sit (2.10): decided when a step is selected and again after its lines change (an apply,
     Discard, Undo or Redo, a newer folder draft, an adopted proposal, a reset), never on typing. A group with focus in it
     keeps its place at that moment, so a box is never moved while it's in use. */
  function obGroupsSync() {
    var sel = state.obSel, p = state.view === 'process' && state.ptab === 'edit' && sel && sel.kind === 'step' ? currentProcess() : null;
    if (!p || sel.pid !== p.id) { state.obGroups = null; return; }
    var text = edText(p), st = PF.outline.parse(text).steps.filter(function (x) { return x.key === sel.key; })[0];
    if (!st) { state.obGroups = null; return; }
    var sig = text.split('\n').slice(st.line, st.end).join('\n'), g = state.obGroups, same = g && g.pid === p.id && g.key === sel.key;
    if (same && g.sig === sig) return;
    var has = V.obGroupsHas(text, sel.key, (data.stepTypes || {}).types) || {};
    if (same) { var a = document.activeElement, box = a && a.closest && a.closest('[data-obg]'), k = box && box.dataset && box.dataset.obg; if (k) has[k] = !!g.out[k]; }
    state.obGroups = { pid: p.id, key: sel.key, sig: sig, out: has };
  }
  /* An approval stays selected only while its phase has one; otherwise the selection is the phase's. */
  function gateKept(sel, text) {
    if (!sel || sel.part !== 'gate') return;
    var ph = PF.outline.parse(text).phases.filter(function (x) { return x.key === sel.key; })[0];
    if (!ph || !ph.gate) delete sel.part;
  }
  function obSnap(ed) { var snap = function (x) { return x ? JSON.parse(JSON.stringify(x)) : null; }; return { obSel: snap(state.obSel), obAdd: snap(state.obAdd), fresh: ed ? freshCopy(ed) : null }; }
  /* The step or phase an outline operation is about, in words and as a History item. */
  function opSubject(text, op) {
    if (op.op === 'meta' || op.op === 'questions' || op.op === 'removeQuestions') return '';
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
  /* text: the exact text of the step type's file the kept form was based on; it's resumed only over that same text. */
  function keepTypeTl(f, id, def, text) { if (f.tl && id) typeTls[f.fsKey + '\n' + id] = { tl: f.tl, def: def ? JSON.parse(JSON.stringify(def)) : null, text: text == null ? null : text, tail: def ? typeTail(f) : null }; }
  function resumeTypeTl(f, id, text) {
    var k = typeTls[fsKey() + '\n' + id]; if (!k) return f;
    f.tl = k.tl;
    if (k.def && k.text != null && k.text === text) { f.def = k.def; f.tlTail = k.tail; f.initial = V.typeFormSnapshot(f.def); }
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
  /* Text typed in a builder box and not applied (or refused) isn't in the draft: anything that replaces the draft's text
     (Undo, Redo, Reverse this change) would replace the box and lose it, so it waits until that text is applied or cleared.
     An Add box keeps its text (see addAnchorKept). Returns true when it has to wait, having said why and gone to the box. */
  function typedFirst(p, what) {
    var pf = state.obPending === p.id && state.obPendingField;
    /* An Add box's typing is kept by Undo itself (tlMove), but another box beside it that holds typing isn't. */
    if (pf && OB_KEPT.test(pf)) pf = state.processId === p.id ? obTyped(null, true) : null;
    if (!pf) return false;
    if (state.overlay) closeOverlay();
    say('Apply or clear what you typed in the box first ' + applyHint(pf) + ', then ' + what + '.', 'warn');
    holdAt(p.id, pf);
    state.focus = '#' + pf; render(); return true;
  }
  /* Undo or Redo in one editor. how: 'button' keeps focus on the button pressed, so it can be pressed again; 'key' moves focus
     to what changed (the step's row, the field, or the caret in the Markdown). Either way the message says what happened. */
  function tlMove(scope, redo, how) {
    var tl = tlFor(scope); if (!tl) return;
    var p = scope === 'draft' ? currentProcess() : null, ed = p && openEditor(p), f = scope === 'type' ? state.typeForm : null;
    if (p && builderBlocked(p)) return;
    if (p && typedFirst(p, redo ? 'Redo' : 'Undo')) return;
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
      /* A change that arrived (your AI assistant's, or the folder's) is highlighted while it's there; Undo takes that away too. */
      if (r.entry.kind === 'incoming') ed.incoming = redo ? { keys: keySet(r.entry.items), who: /AI assistant/.test(r.entry.label) ? 'assistant' : 'folder' } : null;
      ed.text = r.text; obClearErr(); state.planFormReset = !adding; state.obPlace = null; state.obAsk = null; state.obFlash = null;
      if (r.sel && 'obSel' in r.sel) {
        state.obSel = r.sel.obSel; state.obAdd = adding || r.sel.obAdd; gateKept(state.obSel, r.text);
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
    var ov = { hist: scope, item: item || null, mode: state.histMode === 'saved' ? 'saved' : 'session', html: function () {
      var o = this, t = tlFor(o.hist), p = currentProcess(), f = state.typeForm, name = o.item, savedItem = o.item;
      /* A field or evidence row is known in the form by its row; in saved history, by its name. */
      if (o.item && o.hist === 'type' && f) { var rm = /^(field|evidence):(.+)$/.exec(o.item), row = rm && (rm[1] === 'field' ? f.def.fields : f.def.record).filter(function (r) { return String(r.k) === rm[2]; })[0]; if (row) savedItem = rm[1] + ':' + row.name; }
      if (o.item && o.hist === 'draft' && p) { var m = /^(step|phase):(.+)$/.exec(o.item), ed = editorOf(p.id); if (m && ed) { var x = PF.outline.parse(ed.text != null ? ed.text : ed.base)[m[1] === 'step' ? 'steps' : 'phases'].filter(function (y) { return y.key === m[2]; })[0]; if (x) name = m[1] + ' "' + String(m[1] === 'step' ? x.text : x.title).replace(/\*\*|__|`/g, '') + '"'; } }
      if (o.item && o.hist === 'type' && f) { var c = tfControl(f.def, 'tf-' + (/^field:/.test(o.item) ? 'f-' : 'r-') + o.item.split(':')[1] + '-name'); if (c) name = c.name.replace(/^name of /, ''); }
      return V.historyDrawer(ctx, { scope: o.hist, tl: t, item: o.item, itemName: name, savedItem: savedItem, mode: o.mode, saved: o.saved, compare: o.compare, compareMsg: o.compareMsg,
        title: o.hist === 'draft' ? (p ? 'Draft of ' + p.title : '') : f ? (f.existing ? '{' + f.existing + '}' : 'New step type') : '' });
    } };
    openOverlay(ov);
    if (ov.mode === 'saved') loadSavedHistory(ov);
  }
  /* The saved history of the draft or step type open in the editor, read from history/ now (never in routine refreshes). It
     starts from the fingerprint of the file as this window last read it, and places the draft's publications by theirs. */
  function loadSavedHistory(ov) {
    var sfs = state.fs, g = gen, key = fsKey(), p = currentProcess(), f = state.typeForm, dir, current, pubs = [];
    if (ov.hist === 'draft') {
      if (!p || !sfs) return;
      dir = repo.historyDir('draft-edit', p.id); current = p.draft ? U.hash(p.draft.md) : null;
      pubs = (p.all || []).map(function (x) { return { version: x.info.version, hash: x.info.mapHash, by: x.info.publishedBy, at: x.info.publishedAt }; });
    } else {
      if (!f || !f.existing || !sfs) { ov.saved = { state: 'none' }; render(); return; }
      dir = repo.historyDir('type-edit', f.existing); current = f.baseHash;
    }
    var mark = ov.saved = { state: 'loading' }; render();
    repo.loadEditHistory(sfs, dir, current).then(function (res) {
      if (g !== gen || ov.saved !== mark) return;
      var first = res.items.filter(function (x) { return x.entry; })[0];
      if (first) histSeen[histKey(key, dir)] = first.entry.id;
      ov.saved = { state: 'ok', items: ov.hist === 'draft' ? TL.placePublications(res.items, pubs) : res.items, bad: res.bad, skipped: res.skipped, unknown: res.unknown, dir: dir };
      if (state.overlay === ov) render();
    }, function (e) { if (g !== gen || ov.saved !== mark) return; ov.saved = { state: 'error', msg: e && e.message || String(e) }; if (state.overlay === ov) render(); });
  }
  /* Reverse one saved change in the editor's text: only when every line it inserted is still there, exactly once. The draft
     is then unsaved, and Undo takes the reversal back. Otherwise Compare opens on that change. */
  function reverseSaved(id) {
    var ov = state.overlay, p = currentProcess();
    if (!ov || ov.hist !== 'draft' || !ov.saved || !ov.saved.items || !p) return;
    var x = ov.saved.items.filter(function (y) { return y.entry && y.entry.ref === id; })[0], e = x && x.entry;
    if (!e || stillSaving(p) || builderBlocked(p) || typedFirst(p, 'Reverse this change')) return;
    var ed = openEditor(p);
    if (ed.conflict) { say('Someone else changed this draft while you were editing it. Settle that in the editor first.', 'warn'); render(); return; }
    var cur = ed.text != null ? ed.text : ed.base, nt = TL.reversible(e) ? TL.reverse(cur, e.hunks) : null;
    /* A new step or phase being written in its Add box keeps its place, as with Undo. */
    var adding = nt != null && state.obAdd && state.obAdd.pid === p.id && (val('ob-new-text') || val('ob-new-title')) ? state.obAdd : null;
    if (adding && !addAnchorKept(adding, cur, nt)) { closeOverlay(); say('Add or cancel the new ' + (adding.kind === 'phase' ? 'phase' : 'step') + ' you\'re writing first: reversing that change would take away the place it goes.', 'warn'); state.focus = adding.kind === 'phase' ? 'ob-new-title' : 'ob-new-text'; render(); return; }
    if (nt == null || nt === cur) { ov.compare = e.ref; ov.compareMsg = 'The text changed since. Compare and edit it yourself.'; state.overlayFocus = '#hist-cmp-' + cssEsc(e.ref); render(); return; }
    var sel = obSnap(ed);
    learnIds(ed, ed.base); dropPending(); obClearErr();
    TL.record(tlOf(ed), cur, nt, { kind: 'reverse', lines: true, label: 'reversal of a saved change', items: e.items.slice(), selBefore: sel });
    ed.text = nt; state.planFormReset = true; state.obFlash = null; state.obAsk = null; state.obPlace = null;
    if (state.view === 'process' && state.ptab !== 'edit') state.ptab = 'edit';
    say('Reversed that change in the editor. It isn\'t saved yet: save the draft to keep it.', 'good', { act: 'tl-undo', id: 'draft', label: 'Undo' });
    state.overlayFocus = '#hist-t'; render();
  }
  /* A value as the outline ops apply it (lineValue): line breaks become spaces and the ends are trimmed; spaces inside
     (a command's arguments) are its content. */
  function norm(v) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim(); }
  function dropPending() { state.obPending = null; state.obPendingField = null; state.obHold = null; }
  /* Every builder box of the selected step or phase holding text not applied (typed, or refused), not only the latest one
     (state.obPendingField): a list that pages its rows keeps each of them drawn, so Find or Show more never takes away
     an earlier one's text (code review round 13). { pid, key, ids }, for one selection only. */
  function markUnapplied(id, on) {
    var s = state.obSel, u = state.obUnapplied;
    if (!s || !state.processId) return;
    if (!u || u.pid !== state.processId || u.key !== s.key) u = state.obUnapplied = { pid: state.processId, key: s.key, ids: Object.create(null) };
    if (on) u.ids[id] = true; else delete u.ids[id];
  }
  /* Before a redraw, from the page as drawn: a box applied, cleared back to what the draft says, or gone with its form is no
     longer one; a form drawn afresh (planFormReset) or another selection forgets them all. */
  function pruneUnapplied() {
    var u = state.obUnapplied, s = state.obSel; if (!u) return;
    if (state.planFormReset || state.view !== 'process' || state.ptab !== 'edit' || !s || u.pid !== state.processId || u.key !== s.key) { state.obUnapplied = null; return; }
    Object.keys(u.ids).forEach(function (id) { var el = document.getElementById(id); if (!el || boxNorm(id, el.value) === boxNorm(id, fieldApplied(id))) delete u.ids[id]; });
  }
  /* What the draft says now for a box in the builder's form, to tell typed text from what's applied. */
  function fieldApplied(id) {
    var p = currentProcess(), s = state.obSel; if (!p || !s || /^ob-new-/.test(id)) return '';
    var o = PF.outline.parse(edText(p)), st = s.kind === 'step' && o.steps.filter(function (x) { return x.key === s.key; })[0], ph = s.kind !== 'step' && o.phases.filter(function (x) { return x.key === s.key; })[0];
    if (id === 'ob-ren-ctx') return state.obRename && state.obRename.pid === p.id ? state.obRename.name : '';
    if (id === 'ob-text') return st ? PF.outline.inPlace(st.parts.rest) : '';
    if (id === 'ob-note') return st ? st.note : '';
    if (id === 'ob-q-text') return s.kind === 'questions' && o.questions >= 0 ? o.qText : '';
    if (/^ob-fld-/.test(id)) return st ? st.fields[id.slice(7)] || '' : '';
    if (id === 'ob-link-proc-other') return st ? st.fields.process || '' : '';
    if (/^ob-link-val-/.test(id)) { var lv = st ? PF.links.parse(st.fields.pass).entries.filter(function (e) { return e.name === id.slice(12) && e.source === 'value'; })[0] : null; return lv ? lv.value : ''; }
    if (/^ob-shot-cap-\d+$/.test(id)) { var sh = (st || ph) && (st || ph).shots[+id.slice(12)]; return sh ? sh.caption : ''; }
    if (id === 'ob-ph-title') return ph ? ph.title : '';
    if (id === 'ob-ph-mode') return ph ? ph.mode : '';
    if (id === 'ob-type') return st ? st.type || '' : '';
    if (id === 'ob-ph-note') return ph ? ph.note : '';
    if (id === 'ob-when') return st ? st.when.join('\n') : '';
    if (id === 'ob-ph-when') return ph ? ph.when.join('\n') : '';
    if (id === 'ob-tr-title') { var tr = ph && ph.tracks[+s.track]; return tr ? tr.title : ''; }
    if (id === 'ob-g-title' || id === 'ob-g-approves') return ph && ph.gate ? (id === 'ob-g-title' ? ph.gate.title : ph.gate.approves) : '';
    return '';
  }
  /* Boxes that hold several lines compare as written (only \r dropped); one-line boxes as the ops apply them (norm). */
  var MULTI = /^ob-(note|ph-note|q-text|when|ph-when)$/;
  function boxNorm(id, v) { return MULTI.test(id) ? String(v == null ? '' : v).replace(/\r/g, '') : norm(v); }
  /* Enter applies a one-line box; a box of several lines is applied when you leave it. */
  function applyHint(id) { return MULTI.test(id || '') ? '(leaving the box applies it)' : '(Enter applies it)'; }
  /* Selections that are about the whole checklist rather than one of its steps or phases. */
  function isWhole(s) { return !!s && (s.kind === 'details' || s.kind === 'questions'); }
  /* A box that still holds typing once the form is redrawn stays pending (obRepend), so clearing a message never unprotects it. */
  function obClearErr() { if (state.fieldErr && state.fieldErr.id === 'ob') state.fieldErr = null; dropPending(); state.obRepend = true; }

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
    if (isWhole(s)) return s.kind === 'details' ? '[data-act="ob-sel-details"]' : '[data-act="ob-sel-questions"]';
    if (s.part === 'gate') return '[data-act="ob-sel-gate"][data-id="' + cssEsc(s.key) + '"]';
    return s.kind === 'step' ? '[data-act="ob-sel"][data-id="' + cssEsc(s.key) + '"]' : s.kind === 'track' ? '[data-act="ob-sel-track"][data-id="' + cssEsc(s.key) + '"][data-track="' + s.track + '"]' : '[data-act="ob-sel-phase"][data-id="' + cssEsc(s.key) + '"]';
  }
  function narrow() { return !!(window.matchMedia && window.matchMedia('(max-width: 800px)').matches); }
  function edText(p) { var ed = openEditor(p); return ed.text != null ? ed.text : ed.base; }
  /* The new item is shown: the page scrolls just enough to bring it into view (renders keep the scroll where it was). */
  function reveal(sel, block) { var el = sel && document.querySelector(sel); if (el && el.scrollIntoView) el.scrollIntoView({ block: block || 'nearest' }); }
  /* Brought into view after the next draw (revealNow), on any screen or dialog, for the folder it was asked in. open: folds the
     person closed above it are opened first (Show more, a just-shown row). */
  function revealAt(sel, open) { state.revealTarget = sel; state.revealOpen = !!open; state.revealGen = gen; }
  /* A row Flightdeck has to show you, whatever the page or the filters (2.11): the latest one per list is drawn as an exception
     (K.list), focused and brought into view. It's held for this folder only (gen), and goes on nav, on a folder switch and when
     that list's Find text changes. o.focus: the selector to focus (also brought into view); o.reveal: to bring into view only;
     o.word: how the count line says it ("plus the one you just opened"; added by default). */
  function ensureListItemVisible(list, key, o) {
    o = o || {};
    var js = state.justShown && state.justShown.gen === gen ? state.justShown : { gen: gen, lists: {} };
    js.lists[list] = key; (js.words = js.words || {})[list] = o.word || ''; state.justShown = js;
    /* o.note: the row is a note, kept by what it is (PF.search.noteKeep), its key worked out again at every draw (justNotes). */
    js.notes = js.notes || {}; if (o.note) js.notes[list] = o.note; else delete js.notes[list];
    if (o.focus) { state.focus = o.focus; state.focusWins = true; }
    if (o.focus || o.reveal) revealAt(o.reveal || o.focus, true);
  }
  /* What's typed in a list's Find box (2.11), held for this folder only (gen) and never in the URL. Changing it starts the list
     from its first page and lets go of the row just shown in it. */
  function setFind(list, q) {
    var f = state.find && state.find.gen === gen ? state.find : { gen: gen, q: {} };
    f.q[list] = String(q || '').slice(0, 200); state.find = f;
    state.more = Object.assign({}, state.more); delete state.more[list];
    if (state.justShown && state.justShown.lists) delete state.justShown.lists[list];
    if (state.justShown && state.justShown.notes) delete state.justShown.notes[list];
  }
  /* A long dropdown's Find box (K.select) stays drawn while it has focus, even emptied below the page size; leaving it lets it
     go (the focusout below). It's noted for whichever Find box is in use; only a dropdown's box reads it. */
  function selBoxKept(list) { if (list) state.selFocus = list; }
  /* 50 more of a long dropdown's options (K.select); its own choice is untouched. */
  function selMore(id, step) { if (!id) return; var P = PF.vk.PAGE, m = state.more = Object.assign({}, state.more); m[id] = Math.max(P, m[id] || P) + (+step > 0 ? Math.min(+step, 100000) : P); render(); }
  /* Focusing the box is enough, before anything is typed: a refresh that leaves 50 or fewer choices doesn't take it away. So
     for every list's Find box, not only a dropdown's (K.findOn, code review round 19). */
  document.addEventListener('focusin', function (e) { var t = e.target; if (t && t.dataset && t.dataset.find != null) selBoxKept(findList(t)); });
  /* Leaving the box lets go of it and draws nothing: a redraw then would land between a click's press and its click, or a
     key's press and its activation, and replace what was pressed. A box drawn for its focus alone stays until the next
     redraw, which no longer draws it (code review round 25). Focus still in it (the window left) keeps it. */
  document.addEventListener('focusout', function (e) {
    var id = findList(e.target), a = document.activeElement;
    if (id && state.selFocus === id && !(a && a.id === 'find-' + id)) state.selFocus = null;
  });
  /* The list a Find box filters (its data-find, which matches its id: find-<list>), or null for any other control. */
  function findList(el) { var m = el && /^find-([a-z][\w-]*)$/.exec(el.id || ''); return m && (!el.dataset || !el.dataset.find || el.dataset.find === m[1]) ? m[1] : null; }
  /* The one place a reveal happens, after every draw, once focus and the scroll are put back: the page, then the top bar, then
     the open dialog (scrollIntoView moves the nearest scrolling box, so a dialog's list scrolls inside the dialog). Asked once,
     found or not. A row inside a closed fold has the fold opened and recorded as its own toggle records it, and takes the
     focus it was asked for, which a closed fold refused. */
  function revealNow(asked, askedOv) {
    var sel = state.revealTarget, open = state.revealOpen, ok = state.revealGen === gen;
    state.revealTarget = null; state.revealOpen = false;
    if (!sel || !ok) return;
    var el = null;
    try { el = app.querySelector(sel) || topEl.querySelector(sel) || (state.overlay ? overlayEl.querySelector(sel) : null); } catch (e) { el = null; }
    if (!el) return;
    var shut = false;
    for (var x = el.parentNode; open && x && x !== app && x !== overlayEl && x !== topEl; x = x.parentNode) {
      if (x.tagName !== 'DETAILS' || x.open) continue;
      x.open = true; shut = true;
      if (x.dataset && x.dataset.group) (state.groupsOpen = state.groupsOpen || Object.create(null))[x.dataset.group] = true;
      else if (x.dataset && x.dataset.disc) (state.disc = state.disc || {})[x.dataset.disc] = true;
    }
    if (shut && (asked === sel || askedOv === sel) && document.activeElement !== el && el.focus) el.focus({ preventScroll: true });
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- the parts box: placing a new part ---------- */
  /* Choosing a part (click, Enter or Space) starts placing it: the place nearest what's selected is offered first, the
     arrow keys move among the places it can legally go, Enter puts it there, Escape cancels. A part dragged in skips this. */
  function startPlacing(partId, via) {
    var p = currentProcess(), pt = p && V.obPart(ctx, partId); if (!pt || obHeld(p)) return;
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
    if (pt.kind === 'step') op = { op: 'add', to: m[0] === 'before' ? { before: m[1] } : { phase: m[1], track: +m[2], where: 'end' }, text: pt.text, type: pt.pr ? V.obPrHost(edText(p)) : pt.type, mark: pt.mark };
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
    else if (pt.kind === 'gate') { markFresh(ed, res.id); state.obSel = { pid: p.id, kind: 'phase', key: m[1], part: 'gate' }; state.obFlash = { kind: 'gate', key: m[1] }; state.focus = 'ob-g-title'; }
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
  /* Boxes revealed in the step form (2.6.0): UI state for the step selected, never written. A box stays while it has focus,
     typing or a value; one left empty goes back behind its "+ add" chip on the next draw. */
  function obShowKey() { var p = currentProcess(), s = state.obSel; return p && s && s.kind === 'step' && s.pid === p.id ? fsKey() + '\n' + p.id + '\n' + s.key : null; }
  function obShow(name, on) {
    var k = obShowKey(); if (!k) return;
    if (!state.obShown || state.obShown.key !== k) state.obShown = { key: k, names: {} };
    if (on) state.obShown.names[name] = true; else delete state.obShown.names[name];
  }
  /* A chip in require: or sets: adds or removes its name, in the order written. A marked chip goes when pressed, so focus
     moves to the group's first chip (the marked ones come last), or the group when none is left. */
  function chipToggle(name, act, id, b) {
    var p = currentProcess(), s = state.obSel; if (!p || !s || s.kind !== 'step' || !id) return;
    var box = 'ob-fld-' + name, cur = String(fieldApplied(box) || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean), at = cur.indexOf(id);
    var gone = at >= 0 && !!(b && b.dataset && b.dataset.bad);
    if (at >= 0) cur.splice(at, 1); else cur.push(id);
    /* require: always keeps All; sets: keeps the run details, and whatever names are left. */
    var left = name === 'require' || cur.length || ((PF.map.parse(edText(p)).meta || {}).context || []).length;
    builderField(box, cur.join(', '), gone ? '#' + box + (left ? ' [data-act]' : '') : '[data-act="' + act + '"][data-id="' + cssEsc(id) + '"]');
  }
  /* focus: where focus goes after the change, when it isn't the box itself (a requirement chip). */
  /* What a change in a linked step's section (2.8) sets with O.editLink, or null (redraw only). Sources keep what still
     applies: PF.links.write gives the shortest carry: and pass: lines meaning exactly the rows wanted. */
  function linkSet(o, key, id, value) {
    var st0 = o.steps.filter(function (x) { return x.key === key; })[0]; if (!st0) return null;
    var text = edText(currentProcess()), map = M.parse(text), x = PF.outline.mapStep(map, st0); if (!x) return null;
    var st = x.step, f = st.fields, fixed = state.obLinkFixed = state.obLinkFixed || {};
    if (id === 'ob-link-proc') {
      if (value === '__other') { state.obLinkOther = key; return null; }
      state.obLinkOther = null; return { process: value, version: null };
    }
    if (id === 'ob-link-proc-other') return value.trim() ? { process: value.trim(), version: null } : null;
    if (id === 'ob-link-ver') {
      if (value === 'latest') return { version: null };
      var e = procFind(f.process), nums = e ? (e.all || []).map(function (v) { return v.info.version; }).filter(function (n) { return !PF.pins.atVersion(e, f.process, n).why; }) : [];
      return nums.length ? { version: String(Math.max.apply(null, nums)) } : null;
    }
    if (id === 'ob-link-vn') return { version: value };
    var kid = V.linkChildOf(ctx, f.process, f.version); if (!kid) return null;
    var rows = PF.links.rows(st, map.meta.context, kid.map).rows, name = id.replace(/^ob-link-(src|val)-/, ''), r = rows.filter(function (y) { return y.name === name; })[0];
    if (!r) return null;
    if (/^ob-link-src-/.test(id)) {
      delete fixed[key + ':' + name];
      if (value === '=') { if (r.source === 'value') return null; fixed[key + ':' + name] = true; return null; }
      if (value === '-') return null;
      if (value === '?') { r.source = 'ask'; r.explicit = true; delete r.from; delete r.value; delete r.team; }
      else if (/^team:/.test(value)) { if (!PF.teamValues.NAME.test(value.slice(5))) return null; r.source = 'team'; r.team = value.slice(5); delete r.from; delete r.value; }
      else { r.source = 'detail'; r.from = value.replace(/^\^/, ''); delete r.value; delete r.team; }
    } else {
      var v = String(value || '').trim(); if (!v) return null;
      var bad = PF.links.valueProblem(v); if (bad) return { error: bad };
      r.source = 'value'; r.value = v; delete r.from; delete r.team; delete fixed[key + ':' + name];
    }
    var w = PF.links.write(rows, st, map.meta.context, kid.map);
    return { carry: w.carry, pass: w.pass };
  }
  function builderField(id, value, focus) {
    var s = state.obSel, cp = currentProcess(); if (!s || !cp || s.pid !== cp.id) return;
    if (s.kind === 'step' && /^ob-fld-[\w-]+$/.test(id)) obShow(id.slice(7), true);
    var refocus = focus || '#' + id, res = null, ed = openEditor(cp), o = PF.outline.parse(edText(cp)), fresh = function (x) { return isFresh(ed, x); };
    var ph = o.phases.filter(function (x) { return x.key === s.key; })[0];
    /* A part added in this window and not saved yet takes its ID from the name it's given (it's in no run or skill). */
    var reid = function (oldId, r) { if (r && r.id && r.id !== oldId && fresh(oldId)) markFresh(ed, r.id); if (r && r.id && oldId && r.id !== oldId) prRename(cp.id, oldId, r.id); return r; };
    if (s.kind === 'details') {
      var mk2 = { 'ob-owner': 'owner', 'ob-backup': 'backup', 'ob-add-role': 'roles', 'ob-add-ctx': 'context' }, key = Object.prototype.hasOwnProperty.call(mk2, id) ? mk2[id] : null;
      if (!key) return;
      var adding = key === 'roles' || key === 'context', name = adding ? String(value == null ? '' : value).trim() : String(value == null ? '' : value);
      if (adding && !name) return;
      /* The change event of a box redrawn right after its add carries the name just added: it's that add, not another. */
      if (adding && state.obJustAdded && state.obJustAdded.id === id && state.obJustAdded.name === name) return;
      res = builderEdit({ op: 'meta', key: key, set: adding ? { add: name } : { value: name } }, id);
      /* Emptied before the redraw, so the box that redraw replaces holds nothing to add again. */
      if (res && adding) { state.obJustAdded = { id: id, name: name }; var bx = document.getElementById(id); if (bx) bx.value = ''; if (state.obPendingField === id) dropPending(); }
      if (res && !res.same) say(adding ? 'Added ' + (key === 'roles' ? '@' : '^') + name + '. Undo available.' : key === 'owner' ? (name ? 'The owner is now ' + personName(name) + '.' : 'The checklist has no owner now.') + ' Undo available.' : (name ? 'The backup owner is now ' + personName(name) + '.' : 'The checklist has no backup owner now.') + ' Undo available.', 'good', { act: 'tl-undo', id: 'draft', label: 'Undo' });
      return obApplied(res, id, adding ? '' : undefined);
    }
    if (s.kind === 'questions') {
      if (id !== 'ob-q-text') return;
      return obApplied(builderEdit({ op: 'questions', text: value }, id), id, null);
    }
    if (s.kind === 'step' && /^ob-link-/.test(id)) {
      var lset = linkSet(o, s.key, id, value);
      if (!lset) { render(); return; }
      if (lset.error) { state.fieldErr = { id: 'ob', msg: lset.error, field: id }; state.focus = '#' + id; say(null); render(); return; }
      return obApplied(builderEdit({ op: 'editLink', key: s.key, set: lset }, id), id);
    }
    if (s.kind === 'step' && id === 'ob-note') return obApplied(builderEdit({ op: 'note', step: s.key, text: value }, id), id, null);
    if (s.kind === 'step' && id === 'ob-when') return obApplied(builderEdit({ op: 'when', step: s.key, text: value }, id), id, null);
    if (s.kind === 'step') {
      var st = o.steps.filter(function (x) { return x.key === s.key; })[0], mk = id === 'ob-mark' ? (value === 'must' ? '!' : value === 'planned' ? '~' : ' ') : null;
      var set = id === 'ob-text' ? null : mk ? { mark: mk } : id === 'ob-type' ? { type: value } : /^ob-fld-[\w-]+$/.test(id) ? { field: id.slice(7), value: value } : null;
      if (/^ob-shot-cap-\d+$/.test(id)) { if (builderEdit({ op: 'editShot', step: s.key, shot: +id.slice(12), caption: value }, id)) { state.focus = refocus; render(); } return; }
      /* Step text keeps its ^details where they're typed (2.7). */
      if (id === 'ob-text') res = reid(st && st.id, builderEdit({ op: 'editText', step: s.key, text: value, reid: !!(st && fresh(st.id)) }, id));
      else if (!set) return;
      else res = reid(st && st.id, builderEdit({ op: 'edit', step: s.key, set: set }, id));
      /* Must be done and Automation planned exclude each other: say what the new mark means, what leaving must-do allows, and what checking one cleared. */
      if (res && !res.same && mk) {
        var cleared = st && st.planned && mk === '!' ? 'No longer marked Automation planned. ' : st && st.must && mk !== '!' ? (mk === '~' ? 'No longer marked Must be done' : 'No longer a must-do step') + ': it can now be marked N/A or waived. ' : '';
        say(cleared + (mk === '!' ? 'Now a must-do step: it can\'t be marked N/A or waived.' : mk === '~' ? 'Automation planned. It\'s still done by hand for now.' : 'Now a plain step.'), 'good');
        refocus = '#' + (state.obMarkFrom || (mk === '~' ? 'ob-planned' : 'ob-must'));
      }
    } else if (s.kind === 'track') {
      var tr = ph && ph.tracks[+s.track]; if (!tr) return;
      if (id === 'ob-tr-title') res = reid(tr.id, builderEdit({ op: 'editTrack', phase: s.key, track: s.track, set: { title: value, reid: fresh(tr.id) } }, id));
      else if (id === 'ob-tr-role') res = builderEdit({ op: 'editTrack', phase: s.key, track: s.track, set: { role: value } }, id);
      else return;
    } else {
      if (/^ob-shot-cap-\d+$/.test(id)) { if (builderEdit({ op: 'editShot', phase: s.key, shot: +id.slice(12), caption: value }, id)) { state.focus = refocus; render(); } return; }
      if (id === 'ob-ph-title') res = reid(ph && ph.id, builderEdit({ op: 'editPhase', phase: s.key, set: { title: value, reid: !!(ph && fresh(ph.id)) } }, id));
      else if (id === 'ob-ph-note') return obApplied(builderEdit({ op: 'phaseNote', phase: s.key, note: value }, id), id, null);
      else if (id === 'ob-ph-when') return obApplied(builderEdit({ op: 'when', phase: s.key, text: value }, id), id, null);
      else if (id === 'ob-ph-mode') res = builderEdit({ op: 'editPhase', phase: s.key, set: { mode: value } }, id);
      else if (id === 'ob-g-title' || id === 'ob-g-owner' || id === 'ob-g-approves') {
        /* Leaving the "name a gate" box empty adds nothing. */
        if (ph && !ph.gate && !String(value).trim()) return;
        var g = {}; g[id === 'ob-g-title' ? 'title' : id === 'ob-g-owner' ? 'owner' : 'approves'] = value;
        if (id === 'ob-g-title' && ph && ph.gate && fresh(ph.gate.id)) g.reid = true;
        res = reid(ph && ph.gate && ph.gate.id, builderEdit({ op: 'gate', phase: s.key, set: g }, id));
        if (res && id === 'ob-g-title' && ph && !ph.gate) { state.focus = 'ob-g-owner'; render(); return; }
      } else return;
    }
    if (res) { state.focus = refocus; render(); }
  }
  /* After a box's value was applied (or was already what the draft says), the box shows exactly what the draft holds, so
     nothing it shows differs from the draft without being pending. clear: '' empties an Add box; null takes the draft's;
     undefined leaves the control alone (a choice, drawn from the draft). */
  function obApplied(res, id, clear) {
    if (!res) return;
    state.planFormReset = true; state.focus = '#' + id; render();
    var el = clear === undefined ? null : document.getElementById(id), want = clear != null ? clear : fieldApplied(id);
    if (el && el.value !== want) el.value = want;
    if (state.obPendingField === id) dropPending();
    obRepend();
  }
  /* Selecting the checklist's details or its Questions section. focus: a box in the form to start in (an Add box). */
  /* Text typed in a builder box and not applied (refused, or not left yet) would be dropped by choosing something else or
     opening an Add box: that waits until it's applied or cleared, as Back does. */
  /* The builder boxes a change event applies. */
  var OB_CHANGE = /^ob-(text|type|fld-[\w-]+|ph-title|ph-note|ph-mode|g-title|g-owner|g-approves|tr-title|tr-role|shot-cap-\d+|note|q-text|owner|backup|add-role|add-ctx|when|ph-when)$/;
  /* The Add step and Add phase boxes, whose typing Undo, Redo and closing the form keep (a new role's name isn't kept). */
  var OB_KEPT = /^ob-new-(text|title)$/;
  var OB_TYPED = /^ob-(ren-ctx|new-role|text|ph-title|ph-note|tr-title|g-title|g-approves|fld-[\w-]+|new-text|new-title|shot-cap-\d+|note|q-text|add-role|add-ctx|when|ph-when|link-proc-other|link-val-[\w-]+)$/;
  /* A builder box on the page, other than except, whose text differs from what the draft says (an Add box: holds anything).
     Several can hold typing at once (one refused, another being typed in), so every box is looked at, not just the last. */
  function obTyped(except, skipNew) {
    var list = app.querySelectorAll ? app.querySelectorAll('input[id], textarea[id]') : [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i], id = el.id || '';
      if (id === except || !OB_TYPED.test(id) || (skipNew && OB_KEPT.test(id))) continue;
      if (boxNorm(id, el.value) !== boxNorm(id, /^ob-(new|add)-/.test(id) ? '' : fieldApplied(id))) return id;
    }
    return null;
  }
  /* With no box marked pending, another box that still differs from the draft (refused, say) becomes the pending one, so
     Undo, Done, live apply and leaving keep protecting it after a different box is cleared (input) or applied (obApplied). */
  function obRepend() {
    if (state.obPendingField || !state.processId || state.view !== 'process' || state.ptab !== 'edit') return;
    var other = obTyped(null); if (other) { state.obPending = state.processId; state.obPendingField = other; }
  }
  /* The refusal just said, drawn beside its builder box instead of in the editor's message area (V.obHoldIn); it's still
     announced. The box becomes the pending one, so a closed More options around it opens. */
  function holdAt(pid, pf) {
    if (!pid || !/^ob-/.test(pf || '') || !document.getElementById(pf) || state.view !== 'process' || state.ptab !== 'edit') return;
    if (state.msg) state.msg.quiet = true;
    state.obPending = pid; state.obPendingField = pf;
    state.obHold = { pid: pid, field: pf, text: state.msg ? state.msg.text : '', apply: OB_CHANGE.test(pf) && !/^ob-add-(role|ctx)$/.test(pf) || /^ob-new-(text|title|role)$/.test(pf) };
  }
  function obHeld(p, then, except, skipNew) {
    var pf = state.obPending === p.id && state.obPendingField !== except && state.obPendingField && !(skipNew && OB_KEPT.test(state.obPendingField)) && document.getElementById(state.obPendingField) ? state.obPendingField : obTyped(except, skipNew);
    if (!pf) return false;
    say('Apply or clear what you typed in the box first ' + applyHint(pf) + ', ' + (then || 'then choose another') + '.', 'warn');
    /* 2.10: said beside the box, inside the form (on a phone everything outside it is inert), with Apply and Discard; a box in
       a closed More options opens it, as typing not applied does. */
    holdAt(p.id, pf);
    state.focus = '#' + cssEsc(pf); render(); return true;
  }
  function obSelWhole(kind, focus) {
    var p = currentProcess(); if (!p || obHeld(p)) return;
    obClearErr(); state.insTab = null; state.obShown = null; state.obSel = { pid: p.id, kind: kind, key: ':' + kind }; state.obAdd = null; state.obAsk = null; state.obRename = null; state.obRenamed = null; state.obPlace = null; state.planFormReset = true;
    state.focus = focus === 'ob-add-role' || focus === 'ob-add-ctx' ? '#' + focus : kind === 'details' ? '[data-act="ob-sel-details"]' : 'ob-q-text';
    render();
  }
  function personName(id) { var x = (ctx.data.people || []).filter(function (q) { return q.id === id; })[0]; return x ? x.name : id; }
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
  /* baseText: the exact text of the file the form started from (saved only over that); baseHash its FNV, for the history. */
  function typeFormFor(def, existing, baseHash, baseText) { typeOpens++; return { fsKey: fsKey(), def: def, existing: existing, baseHash: baseHash, baseText: baseText == null ? null : baseText, initial: V.typeFormSnapshot(def) }; }
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
      state.focus = bad && bad.id ? '#' + cssEsc(bad.id) : 'tf-h'; render(); return;
    }
    if (!f.existing && (T.get(def.id) || Object.prototype.hasOwnProperty.call((data.stepTypes || {}).types || {}, def.id))) { say('There\'s already a step type {' + def.id + '}. Choose another ID, or edit that one.', 'warn'); render(); return; }
    if (f.saving) { say('Still saving this step type. Try again in a moment.', 'warn'); render(); return; }
    var sfs = state.fs, g = gen, carried = f.tl ? f.tl.entries.slice(0, f.tl.pos) : [], savedDef = JSON.parse(JSON.stringify(f.def));
    var expect = f.baseHash, hu = histUnits(carried), hbefore = expect == null ? null : f.baseDef || null, hsource = f.keepMine ? 'keep-mine' : expect == null ? 'new' : 'editor';
    if (f.tl) TL.close(f.tl);
    f.saving = true; render();
    var expectText = expect == null ? null : f.baseText;
    queued(function () { return repo.saveStepType(sfs, def, expect, { lock: LOCKS ? lock : null, expectText: expectText }); }).then(function (res) {
      f.saving = false;
      /* The form is updated in its own folder even if someone switched folders meanwhile; only the screen waits. */
      var here = g === gen, open = typeForms[f.fsKey] === f;
      if (res.conflict) { f.conflict = res; f.closeAfterSave = false; if (here) render(); return; }
      TL.saved(carried, res.hash);
      f.keepMine = false;
      logSave(sfs, f.fsKey, { kind: 'type-edit', id: def.id, from: expect, to: res.hash, before: hbefore, after: def, source: hsource, units: hu.units, items: [] });
      /* Saved. If the form changed while it saved, it stays open on the saved version, with those changes still unsaved. */
      if (open && V.typeFormSnapshot(f.def) !== savedSnap) {
        /* If the ID was changed while it saved, the form now describes a different, unsaved type; keep it a new one. */
        /* An ID still made from the label is the saved one now: changing the label later doesn't make it another type. */
        var sameId = !f.def.idSet || (f.def.id || '').trim() === def.id;
        if (sameId) { var keepTail = typeTail(f); f.def.id = def.id; f.justSaved = Date.now(); f.baseDef = def; }
        f.existing = sameId ? def.id : null; f.baseHash = sameId ? res.hash : null; f.baseText = sameId ? res.text : null; f.initial = sameId ? savedSnap : '';
        if (sameId) f.tlTail = keepTail;
        if (!here) return;
        say(sameId ? 'Saved {' + def.id + '}. Your later changes aren\'t saved yet.' : 'Saved {' + def.id + '}. The ID you changed it to isn\'t saved yet; save again to create it.', 'good');
        return load(true);
      }
      /* Saving keeps you in the editor, on the saved version, like the draft editor; Done goes back to the list. */
      if (open) {
        /* The saved ID can differ from what was typed (spaces trimmed); the history keeps what was typed, so it still applies. */
        var tail = typeTail(f);
        f.existing = def.id; f.def.id = def.id; f.tlTail = tail; f.baseHash = res.hash; f.baseText = res.text; f.baseDef = def; f.initial = savedSnap; f.tried = false; f.idEdit = false; f.leaving = false; f.justSaved = Date.now();
        keepTypeTl(f, def.id, savedDef, res.text);
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
    if (!baselines[r.id]) { var baseText = JSON.stringify(r); keepBaseline(r.id, function () { return JSON.parse(baseText); }); }
    try {
      var now = new Date().toISOString();
      fn(r, map, state.me, now);
      /* Recovering a copy that is still running reopens the run: this window becomes its recorder, and that's logged. */
      if (recoveringEnded && !r.ended && !(r.recorder.person === state.me && r.recorder.session === SESSION)) R.takeOver(r, state.me, SESSION, now, R.legacyLinks(r, ctx.findRun));
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
    if (!planning.fs) planning.fs = fsKey();
    setView('start'); state.processId = planning.process; state.planId = null; state.planning = planning; state.fieldErr = null; state.testStage = null;
    state.planFormReset = true; state.focus = 'run-title'; render(); window.scrollTo(0, 0);
  }
  function home() { releaseUrls(state.urls); setView('home'); state.processId = null; state.runKey = null; resetRunUi(); }
  /* Input held in app state belongs to the context it was typed in: the folder, run and step (and, for a correction, its
     mode). leaveContext() runs first in every change of context (setView, selectStep, opening a correction), before any
     state key is reassigned, and keeps everything of the departing context under that context's own key: typed boxes go to
     the step's draft (harvest), an open Fill in is remembered with its step, and a correction being written goes to
     corrDrafts. enterContext() brings back only what belongs to the destination. Files picked but not attached stay in
     pendingFiles, keyed by run and step. All of it is cleared only by Cancel, a successful save, or switching folders. */
  var corrSeq = 0;
  function corrKey(f) { return draftKey(f.key, f.step + '#' + f.mode); }
  function stashCorr() { var f = state.corrForm; if (!f) return; f._at = ++corrSeq; (state.corrDrafts = state.corrDrafts || {})[corrKey(f)] = f; state.corrForm = null; }
  function leaveContext() { leaveFillIn(); stashCorr(); repHarvest(); }
  /* The open Fill in, kept with its folder, run and step: what's typed (harvest) and the choices that decide its fields. */
  function leaveFillIn() {
    harvest();
    var lk = draftScope();
    if (state.pick && state.pick.kind === 'fields' && lk) { var od = draftOf(lk, state.pick.id, true, drawn ? drawn.fs : null); od.open = true; od.fd = fillDraft(state.pick.id); state.pick = null; state.fieldsDraft = null; }
  }
  /* Fill in's unsaved choices for a step of the open run, only if they belong to this folder and run. */
  function fillDraft(id) { var f = state.fieldsDraft; return f && f.id === id && f.key === draftScope() && f.fs === fsKey() ? f : null; }
  /* The destination's own kept correction comes back: for its run and selected step, or exactly the step and mode asked for. */
  function takeCorrDraft(key, step, mode) {
    var all = state.corrDrafts || {}, best = null;
    Object.keys(all).forEach(function (k) { var f = all[k]; if (f.key === key && f.step === step && (mode == null || f.mode === mode) && k === corrKey(f) && (!best || f._at > all[best]._at)) best = k; });
    if (!best) return null;
    var f = all[best]; delete all[best]; return f;
  }
  function enterContext() {
    if (state.corrForm || state.view !== 'run' || !state.runKey || !state.sel) return;
    var f = takeCorrDraft(state.runKey, state.sel);
    if (f) state.corrForm = f;
  }
  function dropCorrDraft(f) { var all = state.corrDrafts || {}; Object.keys(all).forEach(function (k) { if (all[k] === f) delete all[k]; }); }
  /* How a run's screen is shown starts over; input was already kept by leaveContext (setView calls it). */
  function resetRunUi() { leaveContext(); state.fieldsDraft = null; state.copyView = null; state.sel = null; state.pick = null; state.edit = null; state.unfold = Object.create(null); state.justPassed = null; state.msg = null; state.corrForm = null; state.repPick = null; }
  function openRun(key) {
    if (key !== state.runKey) releaseUrls(state.urls);
    setView('run'); state.runKey = key; resetRunUi();
    var r = ctx.run();
    if (r) { var nx = R.nextUp(r, R.mapOf(r), state.me); state.sel = nx.step ? nx.step.id : null; }
    arriveAtStep(state.sel);
    state.refOpen = window.innerWidth > 800; state.revealSel = true;
    window.scrollTo(0, 0);
  }

  /* ---------- Back and Forward (docs/design.md section 29) ---------- */
  /* Each entry's history.state is { fd: 1, n, f }: n numbers it (a push is pos + 1, no two entries share one), f is a
     fingerprint of its team folder. pos is the entry the browser is on, cur the entry whose screen is drawn; they differ only
     while a link waits (H.pending). The URL is written only by syncLocation(), once after a render; Back and Forward come in
     through onPop(), with go()'s guards and the click's own functions. history.go(0) is never called (it would reload). */
  function navFp() { return state.fs ? U.hash(fsKey()) : null; }
  function navOff() { H.on = false; H.pending = null; H.hold = null; if (H.restoring) { clearTimeout(H.restoring.timer); H.restoring = null; } }
  /* The first refused call (an unusual browser, a sandboxed frame) turns history off for this page. */
  function histWrite(push, hash, n, f) {
    var s = { fd: 1, n: n, f: f };
    try { if (push) HIST.pushState(s, '', hash); else if (hash == null) HIST.replaceState(s, ''); else HIST.replaceState(s, '', hash); return true; } catch (e) { navOff(); return false; }
  }
  function navHere() { return PF.nav.format(PF.nav.locate(state)); }
  function scheduleSync() { if (!H.on || H.queued) return; H.queued = true; Promise.resolve().then(function () { H.queued = false; syncLocation(); }); }
  function syncLocation() {
    if (!H.on || H.restoring) return;
    /* A move that spans an await writes nothing until it lands, unless the person moves meanwhile. */
    if (H.hold) { if (navSeq === H.hold.seq) return; H.hold = null; }
    var moved = navSeq !== H.seen, replace = H.mode === 'replace';
    H.seen = navSeq; H.mode = null;
    if (H.pending) {
      if (!moved || replace) return;
      var waited = !!state.needsReconnect; H.pending = null;
      if (waited) { say('The linked page wasn\'t opened.', 'warn'); render(); }
    }
    var hash = navHere(), f = navFp(), c = H.cur;
    if (moved && !replace) {
      if (hash === c.hash && f === c.f && c.n === H.pos && !c.gone) return;
      if (histWrite(true, hash, H.pos + 1, f)) { H.pos++; H.cur = { n: H.pos, hash: hash, f: f }; }
      return;
    }
    if (hash === c.hash && f === c.f && c.n === H.pos) return;
    if (histWrite(false, hash, H.pos, f)) H.cur = { n: H.pos, hash: hash, f: f };
  }
  /* A move that spans an await (starting a run, a step type's read) holds the URL; heldOwn marks the operation's own
     in-between changes, releaseNav its landing. replace: the landing replaces the entry (it came from Back or Forward). */
  function holdNav(replace) { var t = { seq: navSeq, replace: !!replace }; if (H.on) H.hold = t; return t; }
  function heldOwn(t, fn) { fn(); if (H.hold === t) t.seq = navSeq; }
  function releaseNav(t) { if (!t || H.hold !== t) return; H.hold = null; if (t.replace) H.mode = 'replace'; scheduleSync(); }
  /* Links wait for the folder's first complete read; while the examples stand in for a folder that needs Reconnect, only
     entries made in the examples open (a typed link or one from the team folder waits for Reconnect). */
  function readyFor(t) { return H.loadedGen === gen && (!state.needsReconnect || (t.f != null && t.f === navFp())); }
  function navLoaded() {
    H.loadedGen = gen;
    /* A run link that couldn't be read opens once a later read finds it, if nothing was moved to since. */
    var rt = H.retry; if (rt && (rt.seq !== navSeq || rt.f !== navFp())) rt = H.retry = null;
    if (rt && H.on && !H.pending && (!navUnread(rt.loc) || navFound(rt.loc))) { H.retry = null; arrive({ loc: rt.loc, n: H.pos, f: rt.f }); return; }
    var t = H.pending; if (!H.on || !t || !readyFor(t)) return;
    H.pending = null; arrive(t);
  }
  function navLoadFailed() {
    if (!H.on || !H.pending || state.needsReconnect) return;
    H.pending = null;
    arrive({ loc: { view: 'home' }, n: H.pos, f: null, msg: 'The team folder couldn\'t be read, so the linked page wasn\'t opened.' });
  }
  function navBoot() {
    if (!H.on) return;
    try { HIST.scrollRestoration = 'manual'; } catch (e) { /* not supported */ }
    var es = null, hash = '';
    try { es = PF.nav.entry(HIST.state); hash = String(location.hash || ''); } catch (e) { navOff(); return; }
    var n = es ? es.n : 0;
    H.pos = n; H.cur = { n: n, hash: '#/', f: es ? es.f : null };
    if (hash && hash !== '#/' && hash !== '#') {
      H.bootLink = true; H.pending = { loc: PF.nav.parse(hash), n: n, f: es ? es.f : null, typed: !es };
      if (!es) histWrite(false, null, n, null);
      return;
    }
    histWrite(false, '#/', n, H.cur.f);
  }
  function onPop(ev) {
    uiActs++;
    if (!H.on) return;
    harvest();
    var es = PF.nav.entry(ev ? ev.state : null);
    /* A restore in progress: every move is swallowed until the browser is back on the drawn entry. */
    if (H.restoring) { if (es) H.pos = es.n; if (es && es.n === H.restoring.n) { clearTimeout(H.restoring.timer); H.restoring = null; scheduleSync(); } return; }
    popAt(es);
  }
  function popAt(es) {
    var hash = String(location.hash || '');
    if (!es) {
      /* Typed or pasted into the address bar: a new entry after the one the browser was on, numbered now. */
      var n = H.pos + 1;
      if (H.cur.n >= n) H.cur.gone = true;
      if (!histWrite(false, null, n, null)) return;
      es = { n: n, f: null, typed: true };
    }
    H.pos = es.n;
    var t = { loc: PF.nav.parse(hash), n: es.n, f: es.f, typed: !!es.typed };
    if (!readyFor(t)) { H.pending = t; render(); return; }
    H.pending = null;
    arrive(t);
  }
  function restoreTimedOut() {
    H.restoring = null;
    var es = null; try { es = PF.nav.entry(HIST.state); } catch (e) { es = null; }
    if (es && es.n === H.cur.n) { H.pos = es.n; scheduleSync(); return; }
    popAt(es);
  }
  /* After a refusal the screen never moved: put the browser back on the drawn entry without touching the entries after it,
     or, when that entry is gone or this one was typed, write the drawn location where the browser is. */
  function restoreUrl(t) {
    var c = H.cur;
    if (!t.typed && !c.gone && c.n !== H.pos) {
      H.restoring = { n: c.n, timer: setTimeout(restoreTimedOut, 1000) };
      try { HIST.go(c.n - H.pos); } catch (e) { navOff(); }
      return;
    }
    if (histWrite(false, c.hash, H.pos, c.f)) H.cur = { n: H.pos, hash: c.hash, f: c.f };
  }
  function refuseFor(dirty) {
    say(/^ob-/.test(dirty.id || '') ? 'Apply or clear what you typed in the box first ' + applyHint(dirty.id) + ', then go there.' : 'Finish or cancel this first.', 'warn');
    holdAt(state.processId, dirty.id);
    /* Focus never lands on a box in a closed phone sheet. */
    if (state.view === 'run' && narrow() && !state.refOpen) state.refOpen = true;
    /* Nor on a builder box behind the inspector's Checks or Preview: Selected, where it is, is shown. */
    var bx = /^ob-/.test(dirty.id || '') && state.view === 'process' && state.ptab === 'edit' ? document.getElementById(dirty.id) : null;
    if (bx && bx.closest && bx.closest('[hidden]') && (state.insTab === 'checks' || state.insTab === 'preview')) state.insTab = 'selected';
    state.focus = dirty.id ? '#' + cssEsc(dirty.id) : null; render();
  }
  /* ---------- boxes that know the run details (2.7, views/detailbox.js) ----------
     As you type, the mirror, the list of what's wrong and the run preview are redrawn beside the box, never the box itself.
     Typing ^ (or + Insert a detail) opens the run details at the caret: Up and Down choose, Enter or Tab picks, Escape closes. */
  var dbxAc = null, dbxMemo = { t: null, map: null };
  var DBX_STYLE = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'textTransform'];
  function dbxMap() {
    var p = currentProcess(); if (!p) return null;
    var t = edText(p); if (dbxMemo.t !== t) dbxMemo = { t: t, map: PF.map.parse(t) };
    return dbxMemo.map;
  }
  function dbxFit(el) {
    var w = el.closest('.dbx'), mi = w && w.querySelector('.dbx-mirror'); if (!mi || !window.getComputedStyle) return;
    var cs = window.getComputedStyle(el);
    DBX_STYLE.forEach(function (k) { mi.style[k] = cs[k]; });
    mi.style.whiteSpace = el.tagName === 'INPUT' ? 'pre' : 'pre-wrap';
    mi.scrollTop = el.scrollTop; mi.scrollLeft = el.scrollLeft;
  }
  function dbxSync(el) {
    var w = el.closest && el.closest('.dbx'), map = dbxMap(), p = currentProcess(); if (!w || !map || !p) return;
    var caret = document.activeElement === el ? el.selectionStart : null, toks = V.dbx.judge(map, el.value, w.dataset.at, caret);
    w.querySelector('.dbx-mirror').innerHTML = V.dbx.mirror(el.value, toks);
    var iss = document.getElementById('dbx-iss-' + el.id), pv = document.getElementById('dbx-pv-' + el.id);
    if (iss) iss.innerHTML = V.dbx.issues(el.id, w.dataset.kind, el.value, toks);
    if (pv) pv.innerHTML = V.dbx.previewLine(w.dataset.kind, el.value, map, V.dbx.values(ctx, map, p.id));
    dbxFit(el);
  }
  function dbxAfter() {
    /* A redraw puts typed text back into its box: mark and preview what the box holds, not what the draft says. */
    Array.prototype.forEach.call(document.querySelectorAll('.dbx-in'), dbxSync);
    if (dbxAc && !document.getElementById(dbxAc.id)) dbxAc = null;
    else if (dbxAc) dbxDraw();
  }
  /* The name being typed: a ^ right before the caret, and the letters after it. */
  function dbxQuery(el) {
    if (el.selectionStart !== el.selectionEnd) return null;
    var before = el.value.slice(0, el.selectionStart), m = /\^([\w-]*)$/.exec(before);
    return m ? { q: m[1], start: before.length - m[0].length } : null;
  }
  function dbxTyped(el, e) {
    dbxSync(el);
    if (composing || (e && e.isComposing)) return;
    var cq = dbxQuery(el);
    if (!cq) { dbxClose(); return; }
    var map = dbxMap(), opts = map ? V.dbx.options(map, el.closest('.dbx').dataset.at, cq.q) : [];
    if (!opts.length) { dbxClose(); return; }
    var keep = dbxAc && dbxAc.id === el.id && dbxAc.start === cq.start && dbxAc.opts[dbxAc.i] ? dbxAc.opts[dbxAc.i].name : null, at = 0;
    opts.forEach(function (o, i) { if (o.name === keep && !o.add) at = i; });
    dbxAc = { id: el.id, start: cq.start, q: cq.q, opts: opts, i: at };
    dbxDraw();
  }
  /* The list sits under the caret: where a marker at the caret lands in the mirror, less the box's scroll. */
  function dbxDraw() {
    var a = dbxAc, el = document.getElementById(a.id), list = document.getElementById('dbx-ac-' + a.id); if (!el || !list) return;
    list.innerHTML = V.dbx.optionsHtml(a.id, a.opts, a.i); list.hidden = false;
    el.setAttribute('aria-activedescendant', 'dbx-o-' + a.id + '-' + a.i);
    if (el.tagName === 'INPUT') el.setAttribute('aria-expanded', 'true');
    var mi = el.closest('.dbx').querySelector('.dbx-mirror'), keep = mi.innerHTML;
    mi.innerHTML = U.esc(el.value.slice(0, a.start)) + '<span class="dbx-at">^</span>';
    var mk = mi.querySelector('.dbx-at'), top = mk.offsetTop + mk.offsetHeight - el.scrollTop, left = Math.max(0, Math.min(mk.offsetLeft - el.scrollLeft, el.clientWidth - 240));
    mi.innerHTML = keep;
    list.style.top = top + 'px'; list.style.left = left + 'px';
    var on = document.getElementById('dbx-o-' + a.id + '-' + a.i); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
  function dbxClose() {
    var a = dbxAc; dbxAc = null; if (!a) return;
    var el = document.getElementById(a.id), list = document.getElementById('dbx-ac-' + a.id);
    if (list) { list.hidden = true; list.innerHTML = ''; }
    if (el) { el.removeAttribute('aria-activedescendant'); if (el.tagName === 'INPUT') el.setAttribute('aria-expanded', 'false'); }
  }
  function dbxKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return false;
    var n = dbxAc.opts.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); dbxAc.i = (dbxAc.i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; dbxDraw(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); dbxPick(dbxAc.i); return true; }
    if (e.key === 'Escape') { e.preventDefault(); dbxClose(); return true; }
    return false;
  }
  /* Picking puts ^name in place of the whole name being typed, letters after the caret too; nothing around it changes. Add
     also lists it as a run detail. */
  function dbxPick(i) {
    var a = dbxAc, el = a && document.getElementById(a.id), o = a && a.opts[i]; if (!el || !o) return;
    var after = el.value.slice(el.selectionStart), rest = /^[\w-]*/.exec(after)[0], ins = '^' + o.name;
    after = after.slice(rest.length);
    dbxClose();
    el.value = el.value.slice(0, a.start) + ins + after;
    var pos = a.start + ins.length; el.focus(); el.setSelectionRange(pos, pos);
    dbxSet[el.id] = true;
    if (typeof Event === 'function') el.dispatchEvent(new Event('input', { bubbles: true }));
    dbxClose();
    if (o.add) dbxAdd(o.name, el);
  }
  /* A new run detail, added without losing what's typed in the boxes (as shotApply keeps it): one undo step. */
  function dbxAdd(name, el) {
    var typed = [], pend = { p: state.obPending, f: state.obPendingField }, caret = el ? el.selectionStart : null;
    Array.prototype.forEach.call(app.querySelectorAll('input[id], textarea[id]'), function (x) {
      if (!/^ob-/.test(x.id || '') || x.type === 'file' || /^ob-part-q/.test(x.id)) return;
      var drawn = /^ob-new-|^ob-shot-new$/.test(x.id) ? '' : fieldApplied(x.id);
      if (x.value !== drawn) typed.push({ id: x.id, v: x.value });
    });
    var res = builderEdit({ op: 'meta', key: 'context', set: { add: name } }, el && el.id, null, true);
    if (!res) return;
    if (pend.p) { state.obPending = pend.p; state.obPendingField = pend.f; }
    state.planFormReset = false;
    if (!res.same) say('Added ^' + name + ' as a run detail. Undo available.', 'good', { act: 'tl-undo', id: 'draft', label: 'Undo' });
    render();
    typed.forEach(function (t) { var x = document.getElementById(t.id); if (x && x.value !== t.v) x.value = t.v; });
    var back = el && document.getElementById(el.id);
    if (back) { back.focus(); if (caret != null) back.setSelectionRange(caret, caret); dbxSync(back); }
  }
  /* A typo fixed in place: every ^from in the box becomes ^to, then the box is applied as Enter would: one undo step. */
  function dbxFix(t) {
    var el = document.getElementById(t.dataset.for); if (!el) return;
    var from = t.dataset.from, to = t.dataset.to;
    el.value = el.value.replace(new RegExp('\\^' + from.replace(/[-]/g, '\\-') + '(?![\\w-])', 'g'), '^' + to);
    dbxClose();
    builderField(el.id, el.value);
  }
  function dbxInsert(t) {
    var el = document.getElementById(t.dataset.for); if (!el) return;
    /* Where the caret was when the box was left (the button took focus), or the end for a box never typed in. */
    var at = document.activeElement === el ? { s: el.selectionStart, e: el.selectionEnd } : dbxCaret[el.id] && dbxCaret[el.id].v === el.value ? dbxCaret[el.id] : { s: el.value.length, e: el.value.length };
    var s0 = at.s == null ? el.value.length : at.s, e0 = at.e == null ? s0 : at.e;
    /* A space only to keep the name off a word just before it; quotes, = and the like stay as typed. */
    var pre = el.value.slice(0, s0), ins = (/[A-Za-z0-9]$/.test(pre) ? ' ' : '') + '^';
    el.value = pre + ins + el.value.slice(e0);
    el.focus(); el.setSelectionRange(s0 + ins.length, s0 + ins.length);
    dbxSet[el.id] = true;
    if (typeof Event === 'function') el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  /* A box whose text was last set here (Insert a detail, a picked suggestion) gets no change event when it's left, as a
     browser only sends one for typing. So leaving it applies it, once; a redraw that puts focus back in it doesn't. */
  var dbxSet = Object.create(null);
  document.addEventListener('focusout', function (e) {
    var id = e.target && e.target.id; if (!id || !dbxSet[id]) return;
    setTimeout(function () {
      var f = document.activeElement; if (!dbxSet[id] || (f && f.id === id)) return;
      delete dbxSet[id];
      var el = document.getElementById(id);
      if (!el || !OB_CHANGE.test(id) || state.view !== 'process' || state.ptab !== 'edit') return;
      if (boxNorm(id, el.value) !== boxNorm(id, fieldApplied(id))) builderField(id, el.value);
    }, 0);
  }, true);
  var dbxCaret = Object.create(null);
  document.addEventListener('focusout', function (e) { var t = e.target; if (dbxBox(t)) dbxCaret[t.id] = { s: t.selectionStart, e: t.selectionEnd, v: t.value }; }, true);
  document.addEventListener('scroll', function (e) { var t = e.target; if (t && t.classList && t.classList.contains('dbx-in')) dbxFit(t); }, true);
  /* The caret moving (arrows, a click) changes which name is being typed. */
  ['keyup', 'click'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var t = e.target; if (!t || !t.classList || !t.classList.contains('dbx-in') || (ev === 'keyup' && /^(Arrow(Up|Down)|Enter|Tab|Escape)$/.test(e.key) && dbxAc)) return;
      if (ev === 'keyup' && !/^(Arrow(Left|Right)|Home|End)$/.test(e.key)) return;
      dbxTyped(t, e);
    });
  });
  /* Choosing an option, or Insert a detail, with the pointer keeps focus (and the caret) in the box. */
  /* The refusal's Apply and Discard (2.10) keep focus in their box too: leaving it would apply it, be refused again, and the
     redraw would drop the click. */
  document.addEventListener('mousedown', function (e) { if (e.target && e.target.closest && e.target.closest('.dbx-o, [data-act="dbx-insert"], [data-act="ob-hold-apply"], [data-act="ob-hold-discard"]')) e.preventDefault(); });
  /* Leaving the box closes the list; a redraw that puts the same box back (focus follows it) doesn't. */
  document.addEventListener('focusout', function (e) {
    if (!dbxAc || !e.target || e.target.id !== dbxAc.id) return;
    setTimeout(function () { var f = document.activeElement; if (dbxAc && (!f || f.id !== dbxAc.id)) dbxClose(); }, 0);
  });

  function pendingBox() { var pf = state.obPending && state.obPendingField; return pf ? document.getElementById(pf) || { id: pf } : dirtyControl() || fuPending() || rolesPending() || corrGonePending(); }
  /* An open follow-up form holding a chosen destination, a link or text is unsaved work, even once a redraw has drawn it as the
     page's own (2.11): leaving refuses, as for any changed control. */
  function fuPending() {
    var p = state.fuPick; if (!p) return null;
    var base = PF.followups.formId(p.key);
    if (p.to) return document.getElementById(base + '-to') || { id: base + '-to' };
    var hit = null;
    ['link', 'note', 'ticket', 'reason'].some(function (k) { var el = document.getElementById(base + '-' + k); if (el && String(el.value || '').trim()) hit = el; return !!hit; });
    return hit;
  }
  /* A decline reason with text in it is unsaved work even after a redraw draws it as the box's own text, or while another
     step is selected: leaving refuses, and its step is brought back so the box is on screen. */
  /* Back with a layer open (a dialog, the run's More menu, a sheet, placing a part, a question) closes that one, as Escape
     does, and stays; one holding typing or choices isn't closed. Returns whether there was one. */
  function navLayer() {
    if (state.overlay) {
      if ((state.overlay.held && state.overlay.held()) || dirtyControl([overlayEl])) { say('Finish or cancel this first.', 'warn'); render(); focusOverlay(); }
      else closeOverlay();
      return true;
    }
    var om = document.querySelector && document.querySelector('.rw-menu[open]');
    if (om) { om.open = false; (state.disc = state.disc || {})[(om.dataset && om.dataset.disc) || 'rw-menu'] = false; render(); var sm = om.querySelector && om.querySelector('summary'); if (sm) sm.focus(); return true; }
    var tf = state.tfPreview && state.view === 'types';
    if (!tf && !state.obPlace && !state.obAsk && !obSheetOpen && !(sheetWasOpen && (state.view === 'run' || state.view === 'practice'))) return false;
    var dirty = pendingBox();
    if (dirty) { refuseFor(dirty); return true; }
    if (tf) ACTIONS['tf-preview']();
    else if (state.obPlace) cancelPlacing();
    else if (state.obAsk) ACTIONS['ob-ask-cancel']();
    else if (obSheetOpen) ACTIONS['ob-done']();
    else { state.refOpen = false; render(); }
    return true;
  }
  function headingOf() { var v = state.view; return v === 'run' || v === 'practice' ? 'run-h' : v === 'process' && state.ptab === 'edit' ? 'ed-h' : v === 'types' && state.typeForm ? 'tf-h' : v === 'setup' ? 'su-h' : 'page-h'; }
  /* A target the browser is on: the folder check, layers, guards, then the move, and the entry gets what is drawn. */
  function arrive(t) {
    var loc = t.loc, msg = t.msg || null; H.retry = null; H.retryLoc = null;
    if (!loc) { loc = { view: 'home' }; msg = 'That link isn\'t one Flightdeck can open.'; }
    if (t.f != null && t.f !== navFp()) {
      say('That page was in another team folder, so it wasn\'t opened.', 'warn');
      var here = navHere(), f = navFp();
      if (histWrite(false, here, H.pos, f)) H.cur = { n: H.pos, hash: here, f: f };
      render(); return;
    }
    if (navLayer()) { restoreUrl(t); return; }
    var dirty = pendingBox();
    if (dirty) { refuseFor(dirty); restoreUrl(t); return; }
    var res = moveTo(loc);
    if (res === 'stay') { restoreUrl(t); render(); return; }
    if (msg) say(msg, 'warn');
    if (res === 'async') {
      H.cur = { n: H.pos, hash: String(location.hash || ''), f: navFp() }; H.seen = navSeq; H.mode = null;
      if (H.hold) H.hold.seq = navSeq;
      state.focus = 'page-h'; render(); window.scrollTo(0, 0); return;
    }
    var hash = navHere(), fp = navFp();
    H.seen = navSeq; H.mode = null;
    if (histWrite(false, hash, H.pos, fp)) H.cur = { n: H.pos, hash: hash, f: fp };
    if (H.retryLoc) { H.retry = { loc: H.retryLoc, seq: navSeq, f: fp }; H.retryLoc = null; }
    if (res !== 'focus') state.focus = headingOf();
    render(); window.scrollTo(0, 0);
  }
  function navWarn(m) { say(m, 'warn'); }
  /* A link's target not found while part of the folder couldn't be read may only be unread: it isn't called gone, and the
     link is kept, to open (or be called gone) after the next read that can tell (navLoaded), unless you've moved since. */
  function navUnread(loc) {
    var f = data.failed || {}, u = state.unread || {}, v = loc.view, drafts = !!(f.drafts || f.publications || Object.keys(u.drafts || {}).length);
    if (v === 'run') { var key = loc.process + '/' + loc.run; return !!(f.runs || (u.runs || {})[key] || drafts || (data.unreadable || []).some(function (x) { return String(x.path || '').indexOf('runs/' + key + '/') === 0; })); }
    if (v === 'process') return drafts;
    if (v === 'plan') return !!f.proposals;
    if (v === 'skill') return !!(f.skills || drafts);
    return false;
  }
  function navFound(loc) {
    if (loc.view === 'run') return !!ctx.findRun(loc.process + '/' + loc.run);
    var p = loc.view === 'process' && procFind(loc.process);
    if (p) return !loc.version || (loc.version === 'current' ? !!p.latest : (p.all || []).some(function (x) { return x.folder === loc.version && x.map; }));
    return false;
  }
  function navGone(what, loc) {
    if (!navUnread(loc)) { navWarn('That ' + what + ' isn\'t in this folder anymore.'); return; }
    H.retryLoc = loc; navWarn('That ' + what + ' wasn\'t found, but part of the team folder couldn\'t be read just now. Refresh tries again.');
  }
  /* The move: the smallest step a click would take, through the click's own functions. Returns 'moved', 'focus' (moved,
     focus already chosen), 'stay' (the screen is as it was; the URL is put back) or 'async' (a step type's read). */
  function moveTo(loc) {
    var F = state.typeForm, onForm = !!F && state.view === 'types';
    if (onForm) flushAdds(F);
    if (loc.view === 'types') return moveToTypes(loc, F, onForm);
    var unsaved = false;
    if (state.view === 'process' && state.ptab === 'edit' && !(loc.view === 'process' && loc.process === state.processId && loc.tab === 'edit')) {
      var cp = currentProcess(); state.obPlace = null; state.obAsk = null;
      unsaved = !!cp && editorDirty(cp);
    }
    var res = moveToScreen(loc);
    if (unsaved && !state.msg) say('Your changes aren\'t saved yet. They stay in the editor until you save or discard them.', 'warn');
    /* As a top-bar click: a step-type form with changes stays for when you come back; an untouched one closes. */
    if (onForm && F && typeForms[F.fsKey] === F && !typeFormChanged(F) && state.view !== 'types') state.typeForm = null;
    return res;
  }
  function moveToScreen(loc) {
    var v = loc.view;
    if (v === 'home') { home(); return 'moved'; }
    if (['runs', 'followups', 'processes', 'skills', 'settings'].indexOf(v) >= 0) { ACTIONS.nav(v); return 'moved'; }
    if (v === 'new-process') { ACTIONS['new-process'](); return 'moved'; }
    if (v === 'health' || v === 'connection') { ACTIONS[v](); return 'moved'; }
    if (v === 'recovery') { var ok = !!loc.section && PF.health.sections(RECOVERY).list.some(function (x) { return x.id === loc.section; }); ACTIONS.recovery(ok ? loc.section : ''); return 'moved'; }
    if (v === 'setup') {
      if (state.setup && state.setup.fs === fsKey()) { setView('setup'); state.runKey = null; state.processId = null; resetRunUi(); return 'moved'; }
      home(); navWarn('Getting started was closed. Continue it from Home.'); return 'moved';
    }
    if (v === 'process') return moveToProcess(loc);
    if (v === 'practice') return moveToPractice(loc);
    if (v === 'plan') return moveToPlan(loc);
    if (v === 'run') return moveToRun(loc);
    if (v === 'skill') {
      var files = [];
      var add = function (x) { var k = x.skill.file || x.skill.name; if (U.hash(PF.nav.skillKey(k)) === loc.skill && files.indexOf(k) < 0) files.push(k); };
      processes().forEach(function (p) { p.skills.forEach(add); }); ctx.orphanSkills().forEach(add);
      if (files.length === 1) { ACTIONS['open-skill'](files[0]); return 'moved'; }
      ACTIONS.nav('skills'); navGone('skill', loc); return 'moved';
    }
    home(); return 'moved';
  }
  function moveToProcess(loc) {
    var pid = loc.process, p = procFind(pid);
    if (!p && ctx.lostDrafts().indexOf(pid) < 0) { ACTIONS.nav('processes'); navGone('checklist', loc); return 'moved'; }
    var rf = state.runFilter;
    if (state.view === 'runs' && rf && rf.back && rf.back.process === pid && loc.tab === 'insights') { ACTIONS['ins-back'](); return 'focus'; }
    /* A test run's form (2.1) comes back as a test run's form, never as an ordinary start. */
    if (loc.sub === 'start' && loc.stage) {
      if (p && state.me) { state.processId = pid; ACTIONS['start-test'](loc.stage); return 'moved'; }
      loc = { view: 'process', process: pid };
    }
    if (loc.sub === 'start') {
      if (p && p.latest && state.me) { var pl = state.planning; if (pl && pl.fs === fsKey() && pl.process === pid) openPlanForm(pl); else ACTIONS.start(pid); return 'moved'; }
      loc = { view: 'process', process: pid };
    }
    if (!(state.view === 'process' && state.processId === pid)) ACTIONS['open-process'](pid);
    if (!p) return 'moved';
    if (loc.tab === 'edit') {
      /* Nobody skips the Edit anyway choice the button offers. */
      if ((p.editing || []).length) { ACTIONS['view-version'](null); navWarn('Someone else has this draft open. Choose Edit anyway to edit it too.'); return 'moved'; }
      if (state.ptab !== 'edit') ACTIONS.ptab('edit');
      return 'moved';
    }
    if (loc.tab === 'insights') { if ((p.all || []).length) ACTIONS.ptab('insights'); else ACTIONS['view-version'](null); return 'moved'; }
    if (loc.version === 'current') {
      if (p.latest) { state.ptab = 'overview'; ACTIONS['back-current'](); return 'moved'; }
      /* No published version read: if publications couldn't be read, the link waits for the next read rather than the draft. */
      ACTIONS['view-version'](null); if (navUnread(loc)) navGone('version', loc); return 'moved';
    }
    if (loc.version) {
      var pub = (p.all || []).filter(function (x) { return x.folder === loc.version; })[0];
      if (pub && pub.map) ACTIONS['view-version'](loc.version); else { ACTIONS['view-version'](null); navGone('version', loc); }
      return 'moved';
    }
    ACTIONS['view-version'](null); return 'moved';
  }
  /* A practice link: the draft opens in the editor as Edit does (with its checks), then the practice kept in this tab. */
  function moveToPractice(loc) {
    if (state.view === 'practice' && state.processId === loc.process) return 'moved';
    var res = moveToProcess({ view: 'process', process: loc.process, tab: 'edit' });
    var p = currentProcess();
    if (p && p.id === loc.process && state.view === 'process' && state.ptab === 'edit') { prEnter(p); return 'focus'; }
    return res;
  }
  function moveToPlan(loc) {
    var ids = [];
    data.plans.forEach(function (x) { if (U.hash(x.id) === loc.plan && ids.indexOf(x.id) < 0) ids.push(x.id); });
    var p = ids.length === 1 ? data.plans.filter(function (x) { return x.id === ids[0]; })[0] : null, s = p && p._status;
    if (p && !s) { ACTIONS['review-plan'](p.id); return 'moved'; }
    /* A decided plan never reopens with Start the run or Decline. */
    if (s && s.status === 'accepted' && s.run && ctx.findRun(p.process + '/' + s.run)) { openRun(p.process + '/' + s.run); return 'moved'; }
    ACTIONS.nav('runs');
    if (!s) navGone('plan', loc); else navWarn(s.status === 'accepted' ? 'That plan was already started.' : 'That plan was declined.');
    return 'moved';
  }
  function moveToRun(loc) {
    var key = loc.process + '/' + loc.run, r = ctx.findRun(key);
    if (!r) {
      if (processes().some(function (x) { return x.id === loc.process; })) ACTIONS['open-process'](loc.process); else ACTIONS.nav('runs');
      navGone('run', loc); return 'moved';
    }
    var sub = loc.sub || '';
    if (sub === 'finish' && r.ended) sub = 'receipt';
    else if (sub === 'finish' && !ctx.recording(r)) sub = '';
    var same = state.runKey === key && inRun();
    if (!sub) { if (!same) openRun(key); else if (state.view !== 'run') reenterRun(); return 'moved'; }
    if (!same) openRun(key); else if (state.view === 'run') savePanes();
    setView(sub === 'share' ? 'mission' : sub);
    if (sub === 'finish') state.pick = null;
    return 'moved';
  }
  /* Step types (docs/design.md section 29, Kept work): a kept form is never discarded by Back, and the URL always matches what is drawn. */
  function navTypes() { typeOpens++; releaseUrls(state.urls); setView('types'); state.processId = null; state.runKey = null; resetRunUi(); state.fuPick = null; state.more = {}; }
  function moveToTypes(loc, F, onForm) {
    var wantNew = loc.sub === 'new', wantId = loc.type != null ? loc.type : null;
    if (F) {
      if (wantNew ? !F.existing : wantId != null && F.existing === wantId) { navTypes(); return 'moved'; }
      if (typeFormChanged(F)) {
        navTypes(); F.leaving = true;
        if (!wantNew && wantId == null) F.backLeave = true; else say('Save or leave this step type first, then go back again.', 'warn');
        state.focus = '[data-act="type-save"]'; return onForm ? 'stay' : 'focus';
      }
      ACTIONS['type-cancel']();
      if (!wantNew && wantId == null) { navTypes(); return 'moved'; }
    }
    navTypes();
    if (wantNew) { navWarn('That new step type was closed.'); return 'moved'; }
    if (wantId != null) {
      if (!Object.prototype.hasOwnProperty.call((data.stepTypes || {}).types || {}, wantId)) { navWarn('That step type isn\'t in this folder anymore.'); return 'moved'; }
      ACTIONS['edit-type'](wantId, null, true); return 'async';
    }
    return 'moved';
  }
  /* Back to the run screen keeps the selected step and brings back what's kept on it, as selecting it would. */
  function reenterRun() { var sel = state.sel; setView('run'); state.sel = sel; arriveAtStep(sel); }

  /* ---------- events ---------- */
  /* Anything the person does but Refresh counts as moving on, for a refused start's reopen (childRetry): any click, on a
     control of the app's or the browser's own (a select, a menu's summary), and any choice changed. A menu the app closes
     itself fires a toggle, so toggles don't count. */
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || b.dataset.act !== 'refresh') childEpoch++;
  }, true);
  document.addEventListener('change', function () { childEpoch++; }, true);
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    if (b.classList.contains('overlay') && e.target !== b) return;
    var act = b.dataset.act, id = b.dataset.id;
    /* Choosing something from the run's More menu closes the menu. */
    var menu = b.closest && b.closest('.rw-menu'); if (menu) { menu.open = false; (state.disc = state.disc || {})[(menu.dataset && menu.dataset.disc) || 'rw-menu'] = false; }
    var handler = ACTIONS[act], guarded = onPracticePage(b);
    if (!handler && !guarded) return;
    e.preventDefault();
    uiActs++;
    harvest();
    if (guarded) dispatch(act, id, b); else handler(id, b);
  });

  var BACK = { home: 'Home', runs: 'Runs', run: 'Back to the run', processes: 'Checklists', process: 'Back to the checklist', skills: 'Skills', skill: 'Back to the skill', types: 'Step types', settings: 'Settings', health: 'Folder health', connection: 'Connection check' };
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
      state.focus = 'page-h'; render(); window.scrollTo(0, 0); lastConn = since(); loadConn();
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
    dismiss: function () { var cp = currentProcess(), ce = cp && editorOf(cp.id); if (ce) ce.incoming = null; say(null); render(); announceRelease(); },
    refresh: function () { load(true, true); },
    connect: function () { connect(); },
    reconnect: function () { var rec = state.needsReconnect, t = ++opening; rec.dir.requestPermission({ mode: 'readwrite' }).then(function (p) { if (p !== 'granted' || t !== opening) return; var had = !!state.overlay; if (!leaveFolderOverlay(headingOf())) return; state.needsReconnect = null; var read = useFs(folderFs(rec)); if (had) read.then(function () { if (t === opening) { state.focus = headingOf(); state.focusWins = true; render(); } }); }); },
    'reset-examples': function () { var mem = new PF.fs.MemoryFS(LS + ':examples', null), t = ++opening; seedExamples(mem).then(function () { if (t !== opening || !leaveFolderOverlay('page-h')) return; home(); return useFs(mem).then(function () { if (t === opening) { say('Examples reset.', 'good'); render(); } }); }, function (e) { if (t === opening) { say(e && e.message || 'The examples couldn\'t be reset.', 'warn'); render(); } }); },
    filter: function (id) { state.filter = id; render(); },
    /* ---------- Insights (docs/design.md section 23): the runs behind a number, and back ---------- */
    'ins-runs': function (path) { insightRuns(path); },
    /* Back from the runs behind a number: the row it was in is drawn whatever the page (2.11), its count focused and the place
       on the page put back. A row a newer read took away focuses its list's heading instead. */
    'ins-back': function () {
      var f = state.runFilter, b = f && f.back; if (!b) return;
      if (!go({ view: 'process', process: b.process, ptab: 'insights' })) return;
      state.runFilter = null; state.insFolder[b.process] = b.folder;
      if (b.list) { if (b.more) { state.more = Object.assign({}, state.more); state.more[b.list] = b.more; } ensureListItemVisible(b.list, b.key, { word: 'opened' }); }
      state.focus = b.focus || 'ins-h'; state.focusWins = true; render();
      if (b.list && b.focus && !app.querySelector(b.focus)) { state.focus = b.head || 'ins-h'; render(); }
      setTimeout(function () { window.scrollTo(0, b.scrollY || 0); }, 0);
    },
    /* The same number, worked out again from what's loaded now: the cohort is replaced, Back still goes where it went. */
    'ins-refresh': function () {
      var f = state.runFilter; if (!f || !f.cohort) return;
      var res = V.insightsOf(ctx, f.process, f.folder, f.includeRunning), sp = PF.insights.spec(res, f.path, data.runs);
      if (!sp) { say('That number isn\'t shown any more.', 'warn'); render(); return; }
      state.runFilter = Object.assign(sp, { cohort: true, back: f.back }); state.more = Object.assign({}, state.more, { 'runs-cohort': 0 });
      say('Showing the current ' + sp.keys.length + ' run' + (sp.keys.length === 1 ? '' : 's') + '.', 'good'); state.focus = 'rf-h'; render();
    },
    'rf-clear': function (id) {
      var f = state.runFilter;
      if (!f || f.cohort || id === 'all') state.runFilter = null;
      else { f = state.runFilter = Object.assign({}, f); delete f[id]; if (id === 'process') delete f.folder; }
      state.focus = 'page-h'; render();
    },
    /* Sign off the current version of a process as ready for a skill, with the run evidence it was signed on. */
    signoff: function (id) {
      var p = procFind(id), pub = p && p.latest;
      if (!pub || !state.me) return;
      var as = PF.skills.signer(pub, data.people, state.me, !!(data.failed || {}).people);
      if (!as) { say('Only the checklist\'s owner, ' + V.nameOf(ctx, pub.map.meta.owner) + ', can sign off a version' + (pub.map.meta.backup ? ', or its backup owner while the owner is inactive or gone' : '') + '.', 'warn'); render(); return; }
      var ready = PF.skills.readiness(countedRuns(pub.map.meta.process), pub, null), note = val('pick-input'), sfs = state.fs, sg = gen, unk = PF.skills.signUnknown(data, pub);
      if (unk) { say('Nothing was signed off: ' + unk + (PF.skills.signHold(data, pub).kind === 'newer' ? '. Update Flightdeck to see it.' : ', so it isn\'t known whether v' + pub.info.version + ' is already signed off. If that file stays this way, restore it from a backup or delete it.'), 'warn'); render(); return; }
      if (!ready.enough) { say('Sign-off needs ' + ready.needed + ' clean completed runs of v' + pub.info.version + '.', 'warn'); render(); return; }
      var by = state.me, still = function () { return sg === gen && state.fs === sfs && state.me === by; };
      queued(function () {
        if (!ready.tests) return repo.recordValidation(sfs, pub, WRITER, by, note, { completed: ready.completed, clean: ready.clean, runs: ready.cleanRuns }, as === 'backup' ? 'backup' : null);
        /* It leans on test runs (2.1): the version's bytes are checked against its stage again and those test runs read again
           now, and the count worked out again from them, before anything is written. */
        /* Only test runs counted now (2.0.1) are read again, and only runs counted now join them. */
        var st = pub.fromStage && pub.fromStage.stage, tests = st ? countedRuns(id).filter(function (r) { return r.process === id && PF.run.isTest(r) && r.folder === st.folder; }) : [];
        var ids = tests.map(function (r) { return r.id; }), at = startRead();
        var reread = function (rid) {
          var bad = [];
          return repo.loadRun(sfs, id, rid, null, true, false, bad).then(function (r) {
            if (r && r.process === id && r.id === rid) return r;
            if (sg === gen) rereadOutcome(id + '/' + rid, at, bad.length ? { kind: 'unreadable', why: bad[0].why } : { kind: 'missing' });
            return null;
          }, function (e) { if (sg === gen) rereadOutcome(id + '/' + rid, at, { kind: 'unreadable', why: 'couldn\'t be read (' + (e && e.message || String(e)) + ')' }); throw e; });
        };
        return Promise.all([st ? repo.stageCarried(sfs, pub, st) : Promise.resolve('Its stage isn\'t known.'), Promise.all(ids.map(reread))]).then(function (f) {
          if (f[0]) throw new Error(f[0]);
          /* Read again now, and still counted now (2.0.1): a refresh that landed meanwhile may have found the folder unreadable. */
          var fresh = f[1].filter(function (r) { return r && counted(r); });
          var onSt = function (r) { return r.process === id && PF.run.isTest(r) && r.folder === st.folder; };
          var again = PF.skills.readiness(countedRuns(pub.map.meta.process).filter(function (r) { return !onSt(r); }).concat(fresh), pub, null);
          if (!again.enough) throw new Error('It needs ' + again.needed + ' clean completed runs; it has ' + again.clean + ' now.');
          if (!still()) return { dropped: true };
          return repo.recordValidation(sfs, pub, WRITER, by, note, { completed: again.completed, clean: again.clean, runs: again.cleanRuns }, as === 'backup' ? 'backup' : null);
        });
      }).then(function (res) {
        if (sg !== gen) return;
        if (res && res.dropped) { say('Nothing was signed off: the person using this window changed before it could be saved.', 'warn'); render(); return; }
        state.pick = null; say('Signed off v' + pub.info.version + ' as ready to automate.', 'good'); return load(true);
      }, function (e) { if (sg !== gen) return; say('Couldn\'t save the sign-off: ' + e.message, 'bad'); render(); });
    },
    /* The brief an AI assistant needs to create a skill from a signed-off version, or to update one after the process changed. */
    'copy-brief': function (id) {
      var kind = id.split(':')[0], name = id.slice(kind.length + 1), text = '';
      var withNames = function (signs) { return signs.map(function (v) { return Object.assign({}, v, { byName: V.nameOf(ctx, v.by) }); }); };
      if (kind === 'create') {
        var p = procFind(name), pub = p && p.latest;
        if (!pub) return;
        text = PF.skills.createBrief(pub, null, PF.skills.readiness(countedRuns(pub.map.meta.process), pub, null), withNames(PF.skills.signoffs(data.validations, pub)));
      } else {
        /* Registrations are identified by their file, so two skills with the same name never get each other's brief. */
        var hit = null; processes().forEach(function (q) { q.skills.forEach(function (x) { if (x.skill.file === name) hit = x; }); });
        if (!hit || !hit.status.latest) return;
        var lp = hit.status.latest;
        text = PF.skills.updateBrief(hit.skill, hit.status, PF.skills.readiness(countedRuns(lp.map.meta.process), lp, hit.skill.steps), withNames(PF.skills.signoffs(data.validations, lp)));
      }
      state.brief = { key: id, text: text }; render();
      copyText(text, document.getElementById('brief-pre'), 'Copied. Paste it to your AI assistant.');
    },
    'lib-tab': function (id) { state.libTab = id === 'skills' ? 'skills' : 'processes'; state.focus = '[data-act="lib-tab"][data-id="' + state.libTab + '"]'; render(); },
    /* Each list keeps its own tag filter, so a tag picked on one page never hides things on another. */
    /* A Find box's Clear: the box empties and takes focus. */
    'find-clear': function (id) { if (!id) return; setFind(id, ''); selBoxKept(id); state.focus = 'find-' + id; state.focusWins = true; render(); },
    /* A long dropdown's Show more choices (K.select): 50 more options, and focus goes to the dropdown to choose among them. */
    'sel-more': function (id, b) { if (!id) return; selMore(id, b && b.dataset && b.dataset.step); state.focus = id; state.focusWins = true; render(); },
    tag: function (id) { var t = state.tags || []; state.tags = !id ? [] : t.indexOf(id) >= 0 ? t.filter(function (x) { return x !== id; }) : t.concat(id); (state.tagsBy = state.tagsBy || {})[state.view] = state.tags; state.focus = id ? '[data-act="tag"][data-id="' + cssEsc(id) + '"]' : null; render(); },
    'open-process': function (id) { setView('process'); state.processId = id; state.diffOf = null; state.ptab = 'overview'; state.mapVer = null; resetRunUi(); render(); window.scrollTo(0, 0); },
    /* ---------- the sections ---------- */
    /* Go straight to a run's step, a process or a section (go()), keeping what's typed. */
    go: function (id, b) { var d = (b && b.dataset) || {}; go({ view: d.view, process: d.process, ptab: d.ptab, mapVer: d.mapVer, run: d.run, step: d.step, note: d.note, filter: d.filter }); },
    /* Show 50 more of a long list (K.list): focus moves to the first one added, which is brought into view, with any fold the
       person closed above it opened. A list in a dialog moves the dialog's focus. A list without its own focus target is a list
       of run cards. */
    more: function (id, b) {
      var d = (b && b.dataset) || {}, P = +d.page > 0 ? +d.page : PF.vk.PAGE, m = state.more = state.more || {};
      /* data-step: the page grows past rows already drawn (kept ones), so it adds as many new rows as it says. */
      m[id] = Math.max(P, m[id] || P) + (+d.step > 0 ? Math.min(+d.step, 100000) : P);
      var to = d.focus || (d.next ? '[data-act="open-run"][data-id="' + cssEsc(d.next) + '"]' : null);
      if (to) { if (d.dialog) state.overlayFocus = to; else { state.focus = to; state.focusWins = true; } revealAt(to, true); }
      render();
    },
    nav: function (id) {
      typeOpens++; state.more = {}; state.justShown = null; state.noteShown = null; state.noteSent = null; state.revealTarget = null; state.justPlanned = null;
      if (id === 'home') { home(); state.focus = '[data-act="nav"][data-id="home"]'; render(); window.scrollTo(0, 0); return; }
      if (['runs', 'followups', 'processes', 'skills', 'types', 'settings'].indexOf(id) < 0) return;
      releaseUrls(state.urls); setView(id); state.processId = null; state.runKey = null; resetRunUi(); state.fuPick = null;
      /* A step-type form with changes stays for when you come back to Step types; an untouched one closes. */
      if (state.typeForm && !typeFormChanged(state.typeForm)) state.typeForm = null;
      /* Skills and Step types aren't in the top bar: focus goes to their page's heading. */
      state.focus = V.sectionOf(id) === id ? '[data-act="nav"][data-id="' + id + '"]' : 'page-h'; render(); window.scrollTo(0, 0);
    },
    /* All runs of one process: Runs, filtered to it. */
    'runs-of': function (id) {
      if (!processes().some(function (x) { return x.id === id; })) return;
      state.runFilter = { process: id }; state.more = Object.assign({}, state.more, { 'runs-filtered': 0 });
      ACTIONS.nav('runs');
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
    /* The checklist preview names 50 skills on a step or the whole checklist; the rest are in the Skills panel (2.11, D10). */
    'pv-skills': function () {
      var p = currentProcess(); if (!p) return;
      /* From the editor's Preview it leaves the editor: text typed in a builder box and not applied refuses it, as go() does. */
      if (state.ptab === 'edit') { var dirty = pendingBox(); if (dirty) { refuseFor(dirty); return; } }
      state.ptab = 'overview'; state.pick = null; state.disc = Object.assign({}, state.disc); state.disc['sk:' + p.id] = true;
      state.focus = 'sk-h'; revealAt('#sk-h'); render();
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
    /* Show all steps or Hide all steps in the flight plan: every phase of this process, kept in this browser. */
    'fp-steps': function (id) {
      if (!state.processId) return;
      fpStepsKeep(state.processId, { d: id === 'show' });
      state.focus = '[data-act="fp-steps"]'; render();
    },
    'copy-map': function () { var pre = document.getElementById('map-source'); copyText(pre ? pre.textContent : '', pre, 'Copied.'); },
    'restore-draft': function (id, b) {
      var p = currentProcess(), v = p && p.all.filter(function (x) { return x.folder === id; })[0];
      if (!v) return;
      var expect = p.draft ? U.hash(p.draft.md) : null, expectText = p.draft ? p.draft.md : null, sure = b && b.dataset.sure && state.pick && state.pick.kind === 'restore' && state.pick.id === id;
      /* Ask first if anything would be lost (unpublished changes, or unsaved edits), and save over exactly what was shown then. */
      if (!sure && ((p.draft && p.draftChanged) || editorDirty(p))) { state.pick = { kind: 'restore', id: id, expect: expect, expectText: expectText, dirty: editorDirty(p) }; render(); return; }
      if (sure) { expect = state.pick.expect; expectText = state.pick.expectText; }
      state.pick = null;
      state.planFormReset = true;
      saveDraftText(p, v.md, expect, 'Restored v' + v.info.version + ' as the draft. Edit it, then publish a new version.', { replace: true, why: 'You restored v' + v.info.version + ' as the draft here. Earlier changes can\'t be undone.', source: 'restore', version: v.info.version, units: ['Restored v' + v.info.version + ' as the draft'], expectText: expectText });
    },
    /* Saving keeps you in the editor: focus goes back to the text, since the Save button is disabled while it saves. */
    'save-draft': function () { var p = currentProcess(); if (!p) return; var ed = openEditor(p); state.focus = 'draft-editor'; saveDraftText(p, ed.text != null ? ed.text : ed.base, ed.baseHash, 'Draft saved.', { expectText: ed.baseHash == null ? null : ed.base }); },
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
      saveDraftText({ id: state.processId, title: state.processId, draft: null }, ed.text, null, 'Saved your draft again.', { expectText: null });
    },
    'draft-keep-mine': function () { var p = currentProcess(), ed = p && editorOf(p.id); if (!p || !ed || !ed.conflict) return; saveDraftText(p, ed.text != null ? ed.text : ed.base, ed.conflict.theirsHash, 'Draft saved over the other change.', { source: 'keep-mine', expectText: ed.conflict.theirs == null ? null : ed.conflict.theirs }); },
    'draft-take-theirs': function () { var p = currentProcess(), ed = p && editorOf(p.id); if (!ed || !ed.conflict || stillSaving(p)) return; var t = ed.conflict.theirs || ''; dropPending(); resetEditor(ed.pid, ed.fsKey); setEditor({ pid: ed.pid, fsKey: ed.fsKey, text: null, base: t, baseHash: ed.conflict.theirsHash, seen: cachedHash(ed.pid), after: readsStarted, tl: ed.tl }); if (ed.tl) TL.barrier(ed.tl, 'You took their version here. Earlier changes can\'t be undone.'); state.planFormReset = true; render(); },
    /* ---------- proposals from AI assistants (docs/design.md section 27) ---------- */
    'prop-review': function (id) { var pid = state.processId; if (!pid || !id) return; openReview(pid, id); },
    /* From Review, Apply carries the records the person saw there; from the list, there are none to carry. */
    'prop-apply': function (id) {
      var ov = state.overlay && state.overlay.propReview && state.overlay.id === id ? state.overlay : null, pid = ov ? ov.pid : state.processId;
      if (!pid || !id || !state.me) { if (!state.me) { say('Choose who you are first.', 'warn'); render(); } return; }
      if (ov && !ov.proposal) return;
      var reviewed = ov ? ov.reviewed : null;
      if (ov) closeOverlay();
      acceptProposal(pid, id, 'apply', reviewed);
    },
    'prop-decline': function (id) { var ov = state.overlay && state.overlay.propReview ? state.overlay : null, pid = ov ? ov.pid : state.processId; if (pid && id && state.me) decideProposal(pid, id, 'declined'); },
    'prop-reopen': function (id) { var ov = state.overlay && state.overlay.propReview ? state.overlay : null, pid = ov ? ov.pid : state.processId; if (pid && id && state.me) decideProposal(pid, id, 'reopened'); },
    'prop-mark-applied': function (id) { var ov = state.overlay && state.overlay.propReview && state.overlay.id === id ? state.overlay : null; if (ov && ov.proposal && state.me) decideProposal(ov.pid, id, 'applied', { reviewed: ov.reviewed || [] }); },
    /* Make this the main editor: a claim one higher than any this window has seen for the process. It decides only which
       window will apply proposals live; it never lets anything else write. */
    'main-editor': function () {
      var pid = state.processId; if (!pid) return;
      var mine = ownPresence(), list = freshOthers().concat(mine ? [mine] : []);
      state.claims[fsKey() + '|' + pid] = PF.proposals.claim(pid, list);
      presenceBeat(true); say('This is the main editor for this draft now.', 'good'); render();
    },
    /* ---------- the outline builder: every change is an operation on the editor's text (PF.outline) ---------- */
    'ed-mode': function (id) {
      state.builder = id !== 'markdown'; lsSet('builder', state.builder); state.obPlace = null;
      var cp = currentProcess(), ce = cp && editorOf(cp.id); if (ce && ce.tl) TL.close(ce.tl);
      state.focus = '[data-act="ed-mode"][data-id="' + (state.builder ? 'builder' : 'markdown') + '"]'; render();
    },
    'ob-sel': function (id) { var p = currentProcess(); if (!p || !id) return; if (obHeld(p)) return; obClearErr(); state.obShown = null; state.insTab = null; state.obSel = { pid: p.id, kind: 'step', key: id }; state.prSel = null; state.obAdd = null; state.obAsk = null; state.planFormReset = true; state.focus = '[data-act="ob-sel"][data-id="' + cssEsc(id) + '"]'; render(); },
    'ob-sel-track': function (id, b) { var p = currentProcess(); if (!p) return; if (obHeld(p)) return; obClearErr(); state.obShown = null; state.insTab = null; var k = b && b.dataset ? +b.dataset.track : 0; state.obSel = { pid: p.id, kind: 'track', key: id, track: k }; state.obAdd = null; state.obAsk = null; state.planFormReset = true; state.focus = '[data-act="ob-sel-track"][data-id="' + cssEsc(id) + '"][data-track="' + k + '"]'; render(); },
    'ob-part': function (id) {
      var pl = state.obPlace, sheet = !!(state.overlay && state.overlay.obParts);
      if (pl && pl.part === id && !sheet) { cancelPlacing(); return; }
      /* From the phone's sheet: it closes, and the outline is where the place is chosen. */
      if (sheet) partsSheetAway();
      startPlacing(id, sheet ? 'sheet' : '');
    },
    /* The inspector's tabs; Checks and Preview are remembered in this browser. */
    'ins-tab': function (id) {
      if (['selected', 'checks', 'preview', 'practice'].indexOf(id) < 0) return;
      var tp = currentProcess(); if (tp && state.practicing[edKey(tp.id)]) prTouch(prEntry(tp.id));
      state.insTab = id; if (id !== 'selected' && id !== 'practice') { state.insTabSaved = id; lsSet('insTab', id); }
      state.focus = '#ins-t-' + id; render();
    },
    'renamed-ok': function () { state.renamed = true; lsSet('renamed-checklists', true); state.focus = 'page-h'; render(); },
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
      var res = builderEdit({ op: 'addPhase', title: 'New phase', mode: 'READ-DO', step: { text: pt.text, type: pt.pr ? V.obPrHost(edText(p)) : pt.type, mark: pt.mark } }, null, 'added a phase with ' + pt.noun); if (!res) return;
      var ed = openEditor(p); markFresh(ed, res.id); markFresh(ed, res.step);
      state.obPlace = null; state.obSel = { pid: p.id, kind: 'step', key: res.step }; state.obFlash = { kind: 'step', key: res.step }; state.insTab = null;
      state.focus = 'ob-text'; state.focusSelect = true; sayUndo('Added a phase with ' + pt.noun + ' in it.'); render();
    },
    'ob-place-at': function (id) { var pl = state.obPlace; if (pl) placePart(pl.part, id); },
    'ob-place-cancel': function () { cancelPlacing(); },
    'ob-part-clear': function () { state.obQ = ''; state.focus = state.overlay && state.overlay.obParts ? null : 'ob-part-q'; if (state.overlay) state.overlayFocus = '#ob-part-q2'; render(); },
    'ob-parts-open': function () { var p = currentProcess(); if (!p) return; state.overlayFocus = '#ob-part-q2'; openOverlay({ obParts: true, html: function () { return V.obPartsSheet(ctx, currentProcess() || p); } }); },
    'ob-ask': function (id) {
      var s = state.obSel; if (!s) return;
      if (id === 'questions') { if (s.kind !== 'questions') return; state.obAsk = { kind: 'questions', key: s.key }; }
      else if (isWhole(s)) return;
      else state.obAsk = { kind: id === 'track' ? 'track' : 'phase', key: s.key, track: s.track };
      state.focus = 'ob-ask-go'; render();
    },
    'ob-q-remove': function () {
      var s = state.obSel, a = state.obAsk; if (!s || s.kind !== 'questions' || !a || a.kind !== 'questions') return;
      var res = builderEdit({ op: 'removeQuestions' }, null, 'removed the Questions section'); if (!res) return;
      state.obSel = null; state.obAsk = null;
      sayUndo('Removed the Questions section.' + (res.later ? ' Flightdeck now reads the ' + (res.later === 1 ? 'phase' : res.later + ' phases') + ' after it: see Checks.' : ''));
      state.focus = '[data-act="tl-undo"][data-id="draft"]'; render();
    },
    'ob-sel-details': function (id, b) { obSelWhole('details', b && b.dataset && b.dataset.focus); },
    'ob-sel-questions': function () { obSelWhole('questions'); },
    'ob-meta-add': function (key) { if (key !== 'roles' && key !== 'context') return; var bid = key === 'roles' ? 'ob-add-role' : 'ob-add-ctx', v = val(bid); if (!String(v).trim()) { state.fieldErr = { id: 'ob', field: bid, msg: 'Type a name first.' }; state.focus = '#' + bid; render(); return; } builderField(bid, v); },
    'ob-meta-del': function (id, b) {
      var key = b && b.dataset && b.dataset.key, s = state.obSel; if ((key !== 'roles' && key !== 'context') || !s || s.kind !== 'details') return;
      var bid = key === 'roles' ? 'ob-add-role' : 'ob-add-ctx', mark = key === 'roles' ? '@' : '^', cp = currentProcess();
      /* Remove applies no box, so typing in any box (its own list's Add box included) waits. */
      if (!cp || obHeld(cp, 'then change anything else')) return;
      var res = builderEdit({ op: 'meta', key: key, set: { remove: String(id) } }, bid); if (!res || res.same) return;
      sayUndo('Removed ' + mark + id + '.'); state.focus = '#' + bid; render();
    },
    'ob-ren': function (id) {
      var s = state.obSel, cp = currentProcess(); if (!s || s.kind !== 'details' || !cp || obHeld(cp, 'then rename')) return;
      /* The box redraws holding what it held; it starts from this detail's name instead. */
      var was = document.getElementById('ob-ren-ctx'); if (was) was.value = String(id);
      state.obRename = { pid: cp.id, name: String(id) }; state.obRenamed = null; state.fieldErr = null; state.more = Object.assign({}, state.more); delete state.more['ob-ren-deps']; state.focus = '#ob-ren-ctx'; render();
      var bx = document.getElementById('ob-ren-ctx'); if (bx && bx.select) bx.select();
    },
    'ob-ren-cancel': function (id) {
      /* Cancel is the one way to drop what's typed for a new name. */
      var bx = document.getElementById('ob-ren-ctx'); if (bx) bx.value = ''; if (state.obPendingField === 'ob-ren-ctx') dropPending();
      state.obRename = null; state.obRenamed = null; state.fieldErr = null; state.focus = '[data-act="ob-ren"][data-id="' + cssEsc(String(id)) + '"]'; render();
    },
    'ob-ren-go': function (id) {
      var s = state.obSel, cp = currentProcess(), from = String(id); if (!s || s.kind !== 'details' || !cp || !state.obRename || state.obRename.pid !== cp.id || state.obRename.name !== from) return;
      var to = String(val('ob-ren-ctx') || '').trim().replace(/^\^/, '');
      if (!to) { state.fieldErr = { id: 'ob', field: 'ob-ren-ctx', msg: 'Type the new name first.' }; state.focus = '#ob-ren-ctx'; render(); return; }
      if (to === from) { state.obRename = null; if (state.obPendingField === 'ob-ren-ctx') dropPending(); state.focus = '[data-act="ob-ren"][data-id="' + cssEsc(from) + '"]'; render(); return; }
      var map; try { map = M.parse(edText(cp)); } catch (e) { map = null; }
      var res = builderEdit({ op: 'renameDetail', from: from, to: to, depends: map ? renameDeps(map, from) : [], child: renameChild }, 'ob-ren-ctx', 'renamed ^' + from);
      if (!res || res.same) return;
      state.obRename = null; state.fieldErr = null; if (state.obPendingField === 'ob-ren-ctx') dropPending();
      var done = document.getElementById('ob-ren-ctx'); if (done) done.value = '';
      sayUndo('Renamed ^' + from + ' to ^' + to + (res.places ? ' in ' + res.places + ' place' + (res.places === 1 ? '' : 's') : '') + '.' + (res.notes && res.notes.length ? ' ' + res.notes.slice(0, 3).join(' ') + (res.notes.length > 3 ? ' And ' + (res.notes.length - 3).toLocaleString('en-US') + ' more like these.' : '') : ''));
      /* Drawn whatever the Find text or the page (2.11), so focus has its row to go to; it stays drawn, as just renamed, when the
         Find text changes, until another rename or the form is left. */
      state.obRenamed = { pid: cp.id, name: to };
      ensureListItemVisible('ob-meta-context', to, { focus: '[data-act="ob-ren"][data-id="' + cssEsc(to) + '"]', word: 'renamed' }); render();
    },
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
      var res = builderEdit({ op: 'removeGate', phase: id }, null, 'removed an approval'); if (!res) return;
      if (state.obSel && state.obSel.key === id) delete state.obSel.part;
      sayUndo('Removed the approval. The phase ends with a check that it\'s done.'); state.focus = '[data-act="ob-sel-gate"][data-id="' + cssEsc(id) + '"]'; render();
    },
    /* On a phone, Done closes the side form's sheet and goes back to what was selected. */
    'ob-done': function () {
      /* Typed text not yet applied is applied first; if it's refused, the sheet stays open with the reason. */
      var pf = state.obPending && state.obPendingField, pel = pf && document.getElementById(pf);
      if (pel && /^ob-(text|ph-title|ph-note|tr-title|g-title|g-approves|fld-[\w-]+|shot-cap-\d+|note|q-text|add-role|add-ctx|when|ph-when)$/.test(pf)) {
        builderField(pf, pel.value);
        if (state.fieldErr && state.fieldErr.id === 'ob') { var hp = currentProcess(); say('Apply or clear what you typed in the box first ' + applyHint(pf) + ', then close the form.', 'warn'); holdAt(hp && hp.id, pf); state.focus = '#' + cssEsc(pf); render(); return; }
      }
      /* Another box that still holds typing (refused earlier, say) keeps the form open too. */
      var cp = currentProcess(); if (cp && obTyped(null, true) && obHeld(cp, 'then close the form', null, true)) return;
      var s = state.obSel; state.obSel = null; state.obAsk = null; obClearErr();
      state.focus = !s ? 'ed-h' : selFocus(s);
      render();
    },
    /* + Add role (2.10) in the approval, step and lane forms: one box; Enter adds and assigns as one change. */
    'ob-role-add': function (at) {
      var p = currentProcess(), s = state.obSel; if (!p || !s || ['gate', 'step', 'track'].indexOf(at) < 0) return; if (obHeld(p)) return;
      obClearErr(); state.obNewRole = { pid: s.pid, key: s.key, track: s.track, at: at }; state.focus = 'ob-new-role'; render();
    },
    'ob-role-add-cancel': function () {
      var nr = state.obNewRole; state.obNewRole = null; if (state.obPendingField === 'ob-new-role') dropPending(); obClearErr();
      state.focus = nr ? '[data-act="ob-role-add"][data-id="' + nr.at + '"]' : null; render();
    },
    'ob-role-add-go': function () {
      var p = currentProcess(), s = state.obSel, nr = state.obNewRole; if (!p || !s || !nr) return;
      var name = String(val('ob-new-role')).trim().replace(/^@/, '').replace(/\s+/g, '-');
      var to = nr.at === 'gate' ? { gate: s.key } : nr.at === 'track' ? { phase: s.key, track: +s.track } : { step: s.key };
      var res = builderEdit({ op: 'addRoleTo', name: name, to: to }, 'ob-new-role', 'added @' + name); if (!res) return;
      state.obNewRole = null;
      say('Added @' + name + ' and gave it to ' + (nr.at === 'gate' ? 'the approval' : nr.at === 'track' ? 'the lane' : 'the step') + '. Undo available.', 'good', { act: 'tl-undo', id: 'draft', label: 'Undo' });
      state.focus = nr.at === 'gate' ? 'ob-g-owner' : nr.at === 'track' ? 'ob-tr-role' : '[data-act="ob-role"][data-id="' + cssEsc(name) + '"]'; render();
    },
    'ob-sel-gate': function (id) { var p = currentProcess(); if (!p) return; if (obHeld(p)) return; obClearErr(); state.obShown = null; state.insTab = null; state.obSel = { pid: p.id, kind: 'phase', key: id, part: 'gate' }; state.obAdd = null; state.planFormReset = true; state.focus = 'ob-g-title'; render(); },
    'ob-sel-phase': function (id, b) { var p = currentProcess(); if (!p) return; if (obHeld(p)) return; obClearErr(); state.obShown = null; state.insTab = null; state.obSel = { pid: p.id, kind: 'phase', key: id }; state.obAdd = null; state.planFormReset = true; state.focus = b && b.dataset && b.dataset.focus ? b.dataset.focus : '[data-act="ob-sel-phase"][data-id="' + cssEsc(id) + '"]'; render(); },
    'ob-move': function (id, b) { builderMoveStep(id, b && b.dataset.dir === 'up' ? -1 : 1, b && b.dataset.from === 'key' ? 'row' : 'button'); },
    'ob-ph-move': function (id, b) {
      var up = b && b.dataset.dir === 'up', res = builderEdit({ op: 'movePhase', phase: id, dir: up ? -1 : 1 }); if (!res) return;
      var ed = openEditor(currentProcess()), nk = PF.outline.keyAt(ed.text != null ? ed.text : ed.base, res.at, 'phase') || id;
      state.focus = b && b.dataset.from === 'key' ? '[data-act="ob-sel-phase"][data-id="' + cssEsc(nk) + '"]' : '[data-act="ob-ph-move"][data-dir="' + (up ? 'up' : 'down') + '"]'; render();
    },
    'ob-role': function (id) { builderToggle('role', id); },
    /* The refusal's own buttons (2.10): Apply does what Enter or leaving the box does; Discard puts back only that box. */
    'ob-hold-apply': function () {
      var h = state.obHold, el = h && document.getElementById(h.field); if (!h || !el) return;
      if (h.field === 'ob-new-text' || h.field === 'ob-new-title') return ACTIONS['ob-add-go'](null, el);
      if (h.field === 'ob-new-role') return ACTIONS['ob-role-add-go']();
      builderField(h.field, el.value);
    },
    'ob-hold-discard': function () {
      var h = state.obHold, el = h && document.getElementById(h.field); if (!h) return;
      if (el) el.value = /^ob-(new|add)-/.test(h.field) ? '' : fieldApplied(h.field);
      if (state.fieldErr && state.fieldErr.id === 'ob' && state.fieldErr.field === h.field) state.fieldErr = null;
      dropPending(); obRepend();
      say('Put back what the draft says in that box.', 'good'); state.msg.quiet = true;
      var gone = h.field === 'ob-note' && !String(fieldApplied('ob-note')).trim(); if (gone) obShow('ob:note', false);
      state.focus = gone ? '[data-act="ob-note-open"]' : el ? '#' + cssEsc(h.field) : null; render();
    },
    /* "+ add": shows a waiting box, focused. Typing held in another box is applied or refused first, as any change waits. */
    'ob-note-open': function () { var p = currentProcess(); if (!p || obHeld(p)) return; obShow('ob:note', true); state.focus = 'ob-note'; render(); },
    'ob-show': function (id) {
      var p = currentProcess(); if (!p || !id || obHeld(p)) return; obShow(id, true);
      /* A group of chips is focused on its first chip; run details with none listed, on the group. */
      var chips = id === 'require' || (id === 'sets' && ((PF.map.parse(edText(p)).meta || {}).context || []).length);
      state.focus = '#ob-fld-' + cssEsc(id) + (chips ? ' [data-act]' : ''); render();
    },
    /* A choice button applies its value through the control's own path; the checked one does nothing. */
    'ob-choice': function (id, b) {
      var val = b && b.dataset ? String(b.dataset.val == null ? '' : b.dataset.val) : '';
      if (!/^ob-(fld-[\w-]+|ph-mode|host|new-mode)$/.test(id || '')) return;
      /* The new phase's mode is the add form's own, applied with it. */
      if (id === 'ob-new-mode') { if (state.obAdd && state.obAdd.kind === 'phase' && /^(READ-DO|DO-CONFIRM)$/.test(val)) state.obAdd.mode = val; state.focus = '#ob-new-mode'; render(); return; }
      /* The pull request host buttons change the step's type. */
      var to = id === 'ob-host' ? 'ob-type' : id;
      if (String(fieldApplied(to) || '').toLowerCase() === val.toLowerCase()) { state.focus = '#' + id; render(); return; }
      builderField(to, val, '#' + id);
    },
    /* A requirement chip: adds or removes its name in require:, in the order written. */
    'ob-req': function (id, b) { chipToggle('require', 'ob-req', id, b); },
    'ob-sets': function (id, b) { chipToggle('sets', 'ob-sets', id, b); },
    'ob-bind': function (id) { builderToggle('bind', id); },
    'ob-shot-move': function (id, b) {
      var s = state.obSel, up = !!(b && b.dataset.dir === 'up'); if (!s || (s.kind !== 'step' && s.kind !== 'phase')) return;
      var mv = { op: 'moveShot', shot: +id, dir: up ? 'up' : 'down' }; mv[s.kind] = s.key;
      var res = builderEdit(mv); if (!res) return;
      state.focus = '[data-act="ob-shot-move"][data-id="' + (+id + (res.same ? 0 : up ? -1 : 1)) + '"][data-dir="' + (up ? 'up' : 'down') + '"]'; render();
    },
    'ob-shot-remove': function (id) {
      var s = state.obSel; if (!s || (s.kind !== 'step' && s.kind !== 'phase')) return;
      var rm = { op: 'removeShot', shot: +id }; rm[s.kind] = s.key;
      var res = builderEdit(rm); if (!res || res.same) return;
      sayUndo('Removed the screenshot from this draft. The image file stays in the folder.'); state.focus = '#ob-shot-new'; render();
    },
    /* A name this step passes that its child doesn't have: taken out of carry: and pass: (2.8). */
    'ob-link-rm': function (id, el) {
      var o = PF.outline.parse(edText(currentProcess())), st0 = o.steps.filter(function (x) { return x.key === id; })[0], name = el && el.dataset ? el.dataset.name : '';
      if (!st0 || !name) return;
      var map = M.parse(edText(currentProcess())), x = PF.outline.mapStep(map, st0); if (!x) return;
      var st = x.step, kid = V.linkChildOf(ctx, st.fields.process, st.fields.version); if (!kid) return;
      /* What every other child detail gets stays exactly as it is: emptying carry: must not start passing shared names. */
      var want = PF.links.rows(st, map.meta.context, kid.map).rows, carry = PF.links.carryList(st).filter(function (n) { return n !== name; });
      var pe = PF.links.parse(st.fields.pass).entries.filter(function (e) { return e.name !== name; });
      var fields = Object.assign({}, st.fields); delete fields.carry; delete fields.pass;
      if (carry.length) fields.carry = carry.join(', ');
      if (pe.length || PF.links.has(st)) fields.pass = pe.map(PF.links.entryText).join(', ');
      var w = PF.links.write(want, Object.assign({}, st, { fields: fields }), map.meta.context, kid.map);
      var res = builderEdit({ op: 'editLink', key: id, set: { carry: w.carry, pass: w.pass } }, null, 'removed ^' + name);
      if (res && !res.same) say('Removed ^' + name + ' from what this step passes. Undo available.', 'good');
      render();
    },
    'ob-del': function (id) {
      var p = currentProcess(), st = p && PF.outline.parse(edText(p)).steps.filter(function (x) { return x.key === id; })[0];
      var res = builderEdit({ op: 'delete', step: id }, null, 'deleted the step “' + (st ? String(st.text).slice(0, 60) : '') + '”'); if (!res) return;
      state.obSel = null; sayUndo('Deleted the step.'); state.focus = '[data-act="tl-undo"][data-id="draft"]'; render();
    },
    'ob-add': function (id, b) { var p = currentProcess(); if (!p) return; if (obHeld(p)) return; obClearErr(); sheetAway(); state.obAdd = { pid: p.id, kind: 'step', phase: id, track: b && b.dataset.track != null ? +b.dataset.track : -1 }; state.planFormReset = true; state.focus = 'ob-new-text'; render(); },
    'ob-add-after': function (id) { var p = currentProcess(); if (!p) return; if (obHeld(p)) return; obClearErr(); sheetAway(); state.obAdd = { pid: p.id, kind: 'step', after: id }; state.planFormReset = true; state.focus = 'ob-new-text'; render(); },
    'ob-add-phase': function (id) { var p = currentProcess(); if (!p) return; if (obHeld(p)) return; obClearErr(); sheetAway(); state.obAdd = { pid: p.id, kind: 'phase', after: id || null }; state.planFormReset = true; state.focus = 'ob-new-title'; render(); },
    'ob-add-cancel': function () { var a = state.obAdd; state.obAdd = null; obClearErr(); state.focus = a && a.kind === 'phase' ? '[data-act="ob-add-phase"]' : a && a.after ? '[data-act="ob-sel"][data-id="' + cssEsc(a.after) + '"]' : a ? '[data-act="ob-add"][data-id="' + cssEsc(a.phase) + '"][data-track="' + a.track + '"]' : 'ed-h'; render(); },
    /* Enter in the box (b: the box) keeps it open after the step it added, for the next one; the Add step button adds and opens it. */
    'ob-add-go': function (id, b) {
      var a = state.obAdd, p = currentProcess(); if (!a || !p || a.pid !== p.id) return;
      var quick = a.kind === 'step' && b && b.id === 'ob-new-text';
      if (a.kind === 'phase') {
        var pr = builderEdit({ op: 'addPhase', after: a.after, title: val('ob-new-title'), mode: a.mode || 'READ-DO' }, 'ob-new-title'); if (!pr) return;
        /* A phase needs a step: the new phase opens with its "add a step" box ready. */
        state.obSel = { pid: p.id, kind: 'phase', key: pr.id }; state.obAdd = { pid: p.id, kind: 'step', phase: pr.id, track: -1 }; state.focus = 'ob-new-text'; render(); return;
      }
      var to = a.after != null ? { after: a.after } : { phase: a.phase, track: a.track, where: 'end' };
      if (quick && !val('ob-new-text').trim()) { if (obHeld(p, 'then close Add a step', null, true)) return; state.obAdd = null; obClearErr(); if (a.added && a.after != null) state.obSel = { pid: p.id, kind: 'step', key: a.after }; state.focus = a.after ? '[data-act="ob-sel"][data-id="' + cssEsc(a.after) + '"]' : '[data-act="ob-add"][data-id="' + cssEsc(a.phase) + '"][data-track="' + a.track + '"]'; render(); return; }
      var type = val('ob-new-type') || 'confirm', res = builderEdit({ op: 'add', to: to, text: val('ob-new-text'), type: type }, 'ob-new-text'); if (!res) return;
      var ed = editorOf(p.id); if (ed) markFresh(ed, res.id);
      if (quick) { state.obAdd = { pid: p.id, kind: 'step', after: res.id, added: true, type: type }; state.obSel = { pid: p.id, kind: 'step', key: res.id }; state.focus = 'ob-new-text'; render(); reveal('#ob-new-text'); return; }
      state.obAdd = null; state.obSel = { pid: p.id, kind: 'step', key: res.id }; state.focus = 'ob-text'; render();
    },
    'dbx-insert': function (id, t) { dbxInsert(t); },
    'dbx-pick': function (id, t) { if (dbxAc && dbxAc.id === t.dataset.for) dbxPick(+t.dataset.i); },
    'dbx-fix': function (id, t) { dbxFix(t); },
    'dbx-add': function (id, t) { dbxAdd(t.dataset.name, document.getElementById(t.dataset.for)); },
    'dbx-show': function (id) { ACTIONS['ob-sel'](id); },
    'ob-commit': function (id, t) { if (t && t.id) builderField(t.id, t.value); },
    /* ---------- Undo, Redo and History, the same on every editor (id: 'draft' or 'type') ---------- */
    'tl-undo': function (id) { if (id === 'draft' || id === 'type') tlMove(id, false, 'button'); },
    'tl-redo': function (id) { if (id === 'draft' || id === 'type') tlMove(id, true, 'button'); },
    'hist-open': function (id, b) { if (id === 'draft' || id === 'type') openHistory(id, b && b.dataset && b.dataset.item); },
    'hist-item': function (id) { if (!state.overlay || !state.overlay.hist) return; state.overlay.item = id || null; state.overlayFocus = '#hist-t'; render(); },
    'hist-mode': function (id) {
      var ov = state.overlay; if (!ov || !ov.hist) return;
      ov.mode = state.histMode = id === 'saved' ? 'saved' : 'session'; state.overlayFocus = '[data-act="hist-mode"][data-id="' + ov.mode + '"]';
      if (ov.mode === 'saved' && (!ov.saved || ov.saved.state !== 'loading')) loadSavedHistory(ov); else render();
    },
    'hist-compare': function (id) { var ov = state.overlay; if (!ov || !ov.hist) return; ov.compare = ov.compare === id ? null : id; ov.compareMsg = null; state.overlayFocus = '[data-act="hist-compare"][data-id="' + cssEsc(id) + '"]'; render(); },
    'hist-reverse': function (id) { reverseSaved(id); },
    'open-skill': function (id) { setView('skill'); state.skillFile = id; state.brief = null; resetRunUi(); state.focus = 'page-h'; render(); window.scrollTo(0, 0); },
    /* What was submitted and refused stays until Cancel or the draft is created, so leaving and coming back keeps it. */
    'new-process': function () { setView('new-process'); state.newProc = state.newProc || { token: ++npToken }; resetRunUi(); render(); window.scrollTo(0, 0); },
    'np-tpl': function (id) {
      var f = state.newProc = state.newProc || { token: ++npToken };
      /* The assistant's prompt replaces the boxes, so what's typed in them is kept with the form first. */
      if (document.getElementById('np-title')) { var k = newProcForm(); ['token', 'title', 'group', 'tags', 'context', 'roles', 'owner', 'solo'].forEach(function (x) { f[x] = k[x]; }); f.id = k.ownId; f.typed = null; }
      /* A template's own "runs: solo" is where the box starts; unchecking it leaves it out. */
      if (f.tpl !== id && id !== 'assistant') { var tb = id === 'blank' ? '' : npBase(id) || ''; f.solo = /^runs:[ \t]*solo[ \t]*$/m.test(tb.split(/^---[ \t]*$/m)[1] || ''); var cb = document.getElementById('np-solo'); if (cb) cb.checked = f.solo; }
      f.tpl = id; state.focus = '[data-act="np-tpl"][data-id="' + cssEsc(id) + '"]'; render(); },
    'np-publish': function () { createProcess(true); },
    'np-copy': function () { var pre = document.getElementById('np-prompt'); if (pre) copyText(pre.textContent, pre, 'Copied. Paste it to your AI assistant.'); },
    'np-cancel': function () { state.newProc = null; home(); state.focus = '[data-act="nav"][data-id="processes"]'; render(); window.scrollTo(0, 0); },
    /* ---------- step types ---------- */
    'open-types': function () { partsSheetAway(); ACTIONS.nav('types'); },
    'new-type': function () { partsSheetAway(); setView('types'); state.typeForm = typeFormFor({ id: '', label: '', hint: '', icon: 'check', group: '', tags: '', fields: [], record: [] }, null, null); state.planFormReset = true; state.focus = 'tf-label'; render(); window.scrollTo(0, 0); },
    'copy-type': function (id) { var t = T.get(id); if (!t) return; setView('types'); state.typeForm = typeFormFor(V.typeFormOf(t, false), null, null); state.planFormReset = true; state.focus = 'tf-id'; render(); window.scrollTo(0, 0); },
    /* Edit a team type from the file as it is now: its content and its fingerprint come from the same read. */
    'edit-type': function (id, b, fromHistory) {
      /* Only the latest open request lands: one that finishes after another form was opened, or after leaving, does nothing. */
      var sfs = state.fs, g = gen, t = ++typeOpens, held = holdNav(fromHistory);
      sfs.read('step-types/' + id + '.json').then(function (f) {
        releaseNav(held);
        /* And only on the Step types list: never over a run, a page or a form someone moved on to. */
        if (g !== gen || t !== typeOpens || state.view !== 'types' || (state.typeForm && state.typeForm.fsKey === fsKey())) return;
        var o = null; try { o = f ? JSON.parse(f.text) : null; } catch (e) { o = null; }
        var errs = o ? T.checkCustom(o) : ['it can\'t be read'];
        if (!o || errs.length) { say('step-types/' + id + '.json ' + (errs[0] || 'has a problem') + '. Fix the file, or ask your AI assistant to.', 'warn'); render(); return; }
        var tf = typeFormFor(V.typeFormOf(T.customType(o), true), id, U.hash(f.text), f.text); tf.baseDef = o;
        setView('types'); state.typeForm = resumeTypeTl(tf, id, f.text); state.planFormReset = true; state.focus = 'tf-label'; render(); window.scrollTo(0, 0);
      }, function (e) { releaseNav(held); if (g !== gen || t !== typeOpens) return; say('Couldn\'t open step-types/' + id + '.json: ' + e.message, 'bad'); render(); });
    },
    'tf-add': function (id, b) {
      var f = state.typeForm, d = f && f.def; if (!d) return; flushAdds(f);
      var kd = b && b.dataset && b.dataset.kind, kinds = id === 'f' ? ['text', 'url', 'code', 'message', 'list', 'choice'] : ['text', 'url', 'choice', 'number', 'yes-no', 'date'];
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
      var f = state.typeForm; if (!f) return; flushAdds(f); f.backLeave = false;
      if (typeFormChanged(f)) { f.leaving = true; state.focus = '[data-act="type-save"]'; render(); return; }
      ACTIONS['type-cancel']();
    },
    /* On a phone the preview is a sheet over the form, so the place being edited stays where it was. */
    'tf-preview': function () { state.tfPreview = !state.tfPreview; state.focus = state.tfPreview ? '.tf-prevclose' : '.tf-prevbtn'; render(); },
    'type-stay': function () { var f = state.typeForm; if (f) { f.leaving = false; f.backLeave = false; } state.focus = 'tf-h'; render(); },
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
      if (f && f.existing && f.tl) { if (typeFormChanged(f)) { TL.barrier(f.tl, 'You closed it without saving here. Earlier changes can\'t be undone.'); keepTypeTl(f, f.existing, null, null); } else keepTypeTl(f, f.existing, f.def, f.baseText); }
      /* Leaving from the prompt Back showed lands on the list in that entry's place. */
      if (f && f.backLeave) H.mode = 'replace';
      state.typeForm = null; state.focus = '[data-act="new-type"]'; render(); },
    'type-keep-mine': function () { var f = state.typeForm; if (f && f.conflict && !f.saving) { var o = null; try { o = JSON.parse(f.conflict.theirs || 'null'); } catch (e) { o = null; } f.baseHash = f.conflict.theirsHash; f.baseText = f.conflict.theirs == null ? null : f.conflict.theirs; f.baseDef = o; f.keepMine = true; f.conflict = null; saveType(); } },
    'type-take-theirs': function () {
      var f = state.typeForm; if (!f || !f.conflict || f.saving) return;
      var o = null; try { o = JSON.parse(f.conflict.theirs || 'null'); } catch (e) { o = null; }
      if (!o || T.checkCustom(o).length) { say('Their version can\'t be used as a step type' + (f.conflict.theirs == null ? ' (the file was deleted)' : '') + '. Keep yours, or cancel.', 'warn'); render(); return; }
      f.def = V.typeFormOf(T.customType(o), true); f.baseHash = f.conflict.theirsHash; f.baseText = f.conflict.theirs == null ? null : f.conflict.theirs; f.baseDef = o; f.initial = V.typeFormSnapshot(f.def); f.conflict = null; state.planFormReset = true;
      if (f.tl) TL.barrier(f.tl, 'You took their version here. Earlier changes can\'t be undone.');
      render();
    },
    'open-run': function (id) { openRun(id); render(); },
    'review-plan': function (id) { var p = data.plans.filter(function (x) { return x.id === id; })[0]; if (!p) return; setView('start'); state.processId = p.process; state.planId = id; state.planning = null; state.testStage = null; state.planDiff = false; if (!state.planPick || state.planPick.plan !== id) state.planPick = null; state.fieldErr = null; render(); window.scrollTo(0, 0); },
    start: function (id) { setView('start'); state.processId = id; state.planId = null; state.planning = null; state.fieldErr = null; state.testStage = null; render(); window.scrollTo(0, 0); },
    /* A test run (2.1), from a stage's line under All versions on the open process. */
    'start-test': function (folder) { var pid = state.processId; if (!pid || !PF.publish.STAGE.test(String(folder))) return; setView('start'); state.processId = pid; state.planId = null; state.planning = null; state.fieldErr = null; state.testStage = folder; render(); window.scrollTo(0, 0); },
    /* Plan a run for later: the start form, saving a plan instead of starting. */
    'plan-run': function (id) { openPlanForm({ process: id, from: null }); },
    /* Duplicate a run into a plan: its details and roles, never its answers, notes or gates. Details a step sets during the run
       (sets:) are left out, since the new run produces them again. */
    'plan-from-run': function (key) {
      var r = data.runs.filter(function (x) { return x.process + '/' + x.id === key; })[0], p = r && procFind(r.process);
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
      var plan = data.plans.filter(function (x) { return x.id === id; })[0], p = plan && procFind(plan.process);
      if (!p || !p.latest) return;
      if (planHeld(plan)) { say(planHeld(plan), 'warn'); render(); return; }
      /* The exact version shown, never "whatever is latest": a newer one published later asks again. */
      state.planPick = { key: fsKey(), plan: id, hash: plan._sha, folder: p.latest.info.folder };
      state.planDiff = false; state.focus = 'start-submit'; say(null); render();
    },
    /* A plan/2 switched to another exact version by a person, in so many words: written down (plan-status/2, retargeted) so
       every window starts it on that version, never on whatever is latest. */
    'plan-retarget': function (id, b) {
      var plan = data.plans.filter(function (x) { return x.id === id; })[0], p = plan && procFind(plan.process), g = gen;
      var pub = p && (p.all || []).filter(function (x) { return x.info.folder === b.dataset.folder; })[0];
      if (!plan || !pub || !state.me) return;
      if (planHeld(plan)) { say(planHeld(plan), 'warn'); render(); return; }
      if (state.planRetargeting) { say('Still switching this plan.', 'warn'); render(); return; }
      state.planRetargeting = true;
      /* The folder and the person are the ones this was asked in: if either changed while it waited its turn, nothing is
         written, here or anywhere else. */
      var rfs = state.fs, rkey = fsKey(), who = state.me, still = planStill(g, rfs, rkey, who);
      queued(function () {
        if (!still()) return { dropped: true };
        return repo.decidePlan(rfs, plan, { action: 'retargeted', sha: plan._sha, lock: LOCKS ? lock : null, still: still, write: function () { return repo.recordPlanStatus(rfs, plan, WRITER, 'retargeted', null, who, { folder: pub.info.folder, version: pub.info.version }, APP_VERSION); } });
      }).then(function (res) {
        state.planRetargeting = false;
        if (res && res.dropped) { say('The plan wasn\'t switched. ' + nothingWritten(g, rfs, rkey, who) + ' Open the plan again to switch it.', 'warn'); render(); return; }
        if (g !== gen) return;
        if (!still()) return load(true);
        state.planDiff = false; state.focus = 'start-submit';
        return load(true).then(function () { if (!still()) return; say('This plan now starts on v' + pub.info.version + '.', 'good'); render(); });
      }, function (e) { state.planRetargeting = false; say(aboutWhat(still, g, rfs, rkey, who) + 'Couldn\'t switch it: ' + e.message, 'bad'); render(); });
    },
    /* Try again (2.1.1): the run a planned start reserved, saved from the exact bytes kept, in this window, for the same person.
       Each plan keeps its own (state.pendingStarts, by plan ID), so another plan's failed start never takes it away. */
    'plan-resume': function (id) {
      var k = Object.prototype.hasOwnProperty.call(state.pendingStarts, id) ? state.pendingStarts[id] : null, g = gen;
      if (!k || k.plan !== id || k.fs !== state.fs || k.key !== fsKey() || k.me !== state.me) { say('Only the window that started this plan, for the same person, can save its run again. Nothing was written.', 'warn'); render(); return; }
      if (state.resuming) return;
      state.resuming = true; render();
      var held = holdNav(false), same = planStill(g, k.fs, k.key, k.me);
      /* Who and which folder are asked again under each lock and right before the write, and whether this Try again is still
         the one on offer: a change while it waits writes nothing, even one changed back (that forgot it). */
      var still = function () { return g === gen && state.pendingStarts[k.plan] === k && state.fs === k.fs && fsKey() === k.key && state.me === k.me; };
      queued(function () {
        if (!still()) return { dropped: true };
        return repo.resumeStart(k.fs, k.plan, k, { me: k.me, lock: LOCKS ? lock : null, still: still, writing: function () { k.certain = false; if (state.msg && state.msg.pendingStart) state.msg = null; render(); } });
      }).then(function (res) {
        state.resuming = false;
        if (res && res.dropped) { releaseNav(held); say('The run wasn\'t saved. ' + nothingWritten(g, k.fs, k.key, k.me), 'warn'); render(); return null; }
        if (g !== gen) { releaseNav(held); return null; }
        if (state.pendingStarts[k.plan] === k) delete state.pendingStarts[k.plan];
        /* Saved for the person who asked, who has since changed (even changed back): nobody is taken to it or told it started. */
        if (!same()) { releaseNav(held); return load(true).then(function () { return null; }); }
        heldOwn(held, function () { if (state.planId === k.plan) state.planId = null; }); state.planPick = null; state.planDiff = false;
        return load(true).then(function () { return true; });
      }).then(function (ok) { if (!ok) return; releaseNav(held); if (!same()) { if (g === gen) render(); return; } openRun(k.process + '/' + k.id); say('Run started.', 'good'); render(); },
        function (e) {
          state.resuming = false; releaseNav(held);
          /* Certainty belongs to every attempt together: once a save may have landed, it stays unknown until one is confirmed. */
          if (e && e.maybeWritten) k.certain = false;
          if (e && /was saved and has changed since/.test(e.message || '')) k.saved = true;
          say(aboutWhat(same, g, k.fs, k.key, k.me) + (k.saved ? 'Couldn\'t save the run: ' : k.certain === false ? 'Flightdeck couldn\'t confirm whether the run saved: ' : 'Couldn\'t save the run: ') + e.message, 'bad'); render();
        });
    },
    'decline-plan': function (id) { var p = data.plans.filter(function (x) { return x.id === id; })[0], g = gen; if (!p) return; if (planHeld(p)) { say(planHeld(p), 'warn'); render(); return; } var dfs = state.fs, dkey = fsKey(), who = state.me, still = planStill(g, dfs, dkey, who); queued(function () { if (!still()) return { dropped: true }; return repo.decidePlan(dfs, p, { action: 'declined', sha: p._sha, lock: LOCKS ? lock : null, still: still, write: function () { return repo.recordPlanStatus(dfs, p, WRITER, 'declined', null, who, null, APP_VERSION); } }); }).then(function (res) { if (res && res.dropped) { say('The plan wasn\'t declined. ' + nothingWritten(g, dfs, dkey, who), 'warn'); render(); return; } if (g !== gen) return; if (!still()) return load(true); home(); say('Plan declined. It stays in the folder for reference.'); return load(true); }, function (e) { say(aboutWhat(still, g, dfs, dkey, who) + 'Couldn\'t decline it: ' + e.message, 'bad'); render(); }); },
    diff: function (id) { state.diffOf = state.diffOf === id ? null : id; render(); },
    publish: function (id) {
      var p = procFind(id), note = (document.getElementById('change-note') || {}).value || '';
      if (!p || !p.draft || stillSaving(p)) return;
      /* Publishing takes the draft in the folder, so edits waiting unsaved in the editor would be left out: never publish then. */
      var ed = editorOf(p.id);
      if (dirty(ed) || (ed && ed.conflict) || state.obPending === p.id) { say('Your edits to this draft aren\'t saved, so nothing was published. Save or discard them in the editor, then publish.', 'warn'); render(); return; }
      if (shotBusy(p.id)) { say('A screenshot is still being added to this draft, so nothing was published. Publish when it\'s done.', 'warn'); render(); return; }
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
          /* The corrections this exact text includes, worked out from the folder as last read (see PF.corrections.forPublish). */
          var inc = pg === gen ? PF.corrections.forPublish(f.text, ctx.corrections(id)).list : [];
          return repo.publish(pfs, f.text, { people: people, customTypes: got[1].types, workflows: wfs, processes: pids, by: by, changes: note, existing: p.taken, now: new Date().toISOString(), corrections: inc, app: APP_VERSION }).then(function (res) { if (res && !res.blockers) res.included = inc.length; return res; });
        });
      }).then(function (res) {
        if (pg !== gen) return;
        if (res.changed) { say('The draft changed since this page was drawn, so nothing was published. Here is the newest draft: check it, then publish.', 'warn'); return load(true); }
        if (res.blockers) { say(res.blockers[0], 'warn'); render(); return; }
        prEnded(id, shown); state.clearInputs = 'change-note'; say('Published v' + res.version + '. New runs use it; runs already started keep their version.' + (res.included ? ' It includes ' + res.included + ' correction' + (res.included === 1 ? '' : 's') + '.' : ''), 'good');
        return load(true);
      }, function (e) { if (pg !== gen) return; say('Couldn\'t publish: ' + e.message, 'bad'); render(); });
    },
    /* Staging (2.1): stage the draft as shown, make a stage the default, retire or reopen one. Anyone may; each is logged. */
    'stage-draft': function (id) {
      var note = ((document.getElementById('change-note') || {}).value || '').trim();
      if (!note) { say('Write what changed (one line) above, then stage it.', 'warn'); state.focus = 'change-note'; render(); return; }
      stageDraft(id, note, null);
    },
    'promote-stage': function (folder) { stageAct(folder, 'promote'); },
    'retire-stage': function (folder) { stageAct(folder, 'retired'); },
    /* Sign off a staged version (2.1 slice 6): its owner, once enough of its test runs are clean; the person is checked again
       right before the write. */
    'signoff-stage': function (folder) {
      var p = procFind(state.processId);
      if (!p || !state.me || state.stageBusy) return;
      var sg = V.stageSign(ctx, p, folder);
      if (!sg.stage || !sg.as) { say(sg.why || (sg.signs && sg.signs.length ? 'It\'s already signed off.' : 'Only the checklist\'s owner signs off a staged version, once ' + PF.skills.READY_RUNS + ' of its test runs are clean.'), 'warn'); render(); return; }
      var sfs = state.fs, pg = gen, by = state.me, pid = p.id, proposed = sg.stage.info.stage.proposed;
      var still = function () { return pg === gen && state.fs === sfs && state.me === by; };
      state.stageBusy = pid; render();
      queued(function () {
        if (!still()) return { dropped: true };
        /* The stage, its decisions, the versions, its test runs, people.json and its sign-offs are read again inside the stage
           lock; eligibility is worked out again from what was read, with the person who clicked. */
        var ids = countedRuns(pid).filter(function (r) { return r.process === pid && r.folder === folder && PF.run.isTest(r); }).map(function (r) { return r.id; });
        /* The read sequence starts when the test runs are read again (reading), after the lock and the stage's reads: a refresh
           that began while this waited is older than what the reread finds. */
        var at = null;
        return repo.signOffStage(sfs, pid, folder, { window: WRITER, by: by, note: '', app: APP_VERSION, lock: LOCKS ? lock : null, still: still, runIds: ids,
          reading: function () { at = startRead(); },
          outcome: function (rid, res) { if (pg === gen && at) rereadOutcome(pid + '/' + rid, at, res); },
          check: function (st, now) {
            /* Read again now, and still counted now (2.0.1). */
            var r = PF.skills.readiness(now.runs.filter(counted), st, null), as = PF.skills.signer(st, now.people, by, false);
            if (!r.enough) throw new Error('It needs ' + r.needed + ' clean test runs; it has ' + r.clean + '.');
            if (!as) throw new Error('Only the checklist\'s owner signs off a staged version.');
            if (PF.skills.signoffs(now.validations, st).length) throw new Error('It\'s already signed off.');
            return { as: as === 'backup' ? 'backup' : null, evidence: { completed: r.completed, clean: r.clean, runs: r.cleanIds } };
          } });
      }).then(function (res) {
        state.stageBusy = null; if (pg !== gen) return;
        if (res && res.dropped) { say('Nothing was signed off: the person using this window changed before it could be saved.', 'warn'); render(); return; }
        say('Signed off staged v' + proposed + '. It counts for the version made from it.', 'good'); return load(true);
      }, function (e) { state.stageBusy = null; if (pg !== gen) return; say('Couldn\'t save the sign-off: ' + e.message, 'bad'); render(); });
    },
    'reopen-stage': function (folder) { stageAct(folder, 'reopened'); },
    /* The check on a row, Done in the inspector, Space and X: one step, one path (answerStep). A done step unchecks. */
    toggle: function (id) {
      var r = ctx.run(), a = r && r.steps[id];
      if (!r || !M.findStep(R.mapOf(r), id)) return;
      if (a && a.s === 'done') { mutate(function (r, map, me, now) { R.clear(r, map, id, me, now); }); return; }
      answerStep(state.runKey, id, { how: 'done' });
    },
    'save-fields': function (id) {
      var r = ctx.run(), x = M.findStep(R.mapOf(r), id), t = T.get(x.step.type, r.types), fields = {}, values = {};
      T.editable(t).forEach(function (f) { var el = document.getElementById('fld-' + f); if (el) fields[f] = inputValue(el); });
      /* Evidence is collected and checked against the fields as they'll be after this save, not as they were. */
      var merged = Object.assign({}, R.fieldsOf(r, x.step), fields);
      R.evidenceFor(r, x.step, merged).list.forEach(function (d) { var el = document.getElementById('rec-' + d.name); if (el) values[d.name] = inputValue(el); });
      var chk = R.checkEvidence(r, x.step, merged, values, true);
      if (chk.error) { state.fieldErr = { id: id, msg: chk.error, field: chk.field ? 'rec-' + chk.field : '' }; state.focus = chk.field ? '#' + cssEsc('rec-' + chk.field) : '[aria-invalid="true"]'; render(); return; }
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
    'continue-two': function (id) { continueTwo(id); },
    /* A child run that was saved but whose link didn't land (the parent changed meanwhile): link it now, with the inputs it was started for. */
    'link-child': function (id, b) {
      var c = ctx.findRun(b.dataset.child);
      if (!c || !c.parent) return;
      /* A step that passes team values (2.9) links a run started without that record only once a person confirms the run's
         values, as shown: openLinkConfirm, then link-child-confirm. */
      var lr = ctx.run(), lx = lr && M.findStep(R.mapOf(lr), id);
      if (lx && PF.links.teams(R.effStep(lr, lx.step)).length) { openLinkConfirm(id, c); return; }
      mutate(function (r, map, me, now) { R.linkChild(r, map, id, { process: c.process, id: c.id, inputs: c.parent.inputs, folder: c.folder, format: c.format }, me, now, { run: c, procOf: ctx.procOf, findRun: ctx.findRun }); });
    },
    'link-child-confirm': function () {
      var ov = state.overlay, snap = ov && ov.linkConfirm;
      if (!snap) return;
      var c = findRun(snap.child), cur = linkSnap(snap.stepId, c);
      if (snap.gen !== gen || state.runKey !== snap.key || !cur) { closeOverlay(); say('This run isn\'t the one on screen anymore, so nothing was linked.', 'warn'); render(); return; }
      if (cur.rev !== snap.rev || JSON.stringify(cur.values) !== JSON.stringify(snap.values)) { cur.changed = 'This run changed while you were looking. Check the values again.'; ov.linkConfirm = cur; render(); return; }
      if (cur.empty) return;
      closeOverlay();
      mutate(function (r, map, me, now) {
        var tp = {}; Object.keys(snap.values).forEach(function (n) { tp[n] = { text: snap.values[n], confirmed: { by: me, at: now } }; });
        R.linkChild(r, map, snap.stepId, { process: c.process, id: c.id, inputs: c.parent.inputs, folder: c.folder, format: c.format, teamPassed: tp }, me, now, { run: c, procOf: ctx.procOf, findRun: ctx.findRun });
      });
    },
    timeline: function (id) { state.timeline = !state.timeline; state.overlayFocus = null; state.focus = '[data-act="timeline"]' + (id ? '[data-id="' + cssEsc(id) + '"]' : ''); render(); },
    'start-step': function (id) { mutate(function (r, map, me, now) { R.start(r, map, id, me, now); }); },
    na: function (id) { mutate(function (r, map, me, now) { R.na(r, map, id, me, now); }); },
    clear: function (id) { mutate(function (r, map, me, now) { R.clear(r, map, id, me, now); }); },
    pick: function (id, b) { childEpoch++;
      /* While Done differently is finishing on a step, Fill in waits: the answer landing would close it. */
      var ans = state.answering;
      if (b.dataset.kind === 'fields' && ans && ans.key === state.runKey && ans.step === id) { say('Finishing the answer… Fill in opens once it\'s saved.', 'warn'); render(); return; }
      /* Another small form on the step keeps an open Fill in (as leaving the step would); opening Fill in brings back its own. */
      leaveFillIn();
      state.pick = { kind: b.dataset.kind, id: id, back: '[data-act="pick"][data-kind="' + cssEsc(b.dataset.kind || '') + '"][data-id="' + cssEsc(id || '') + '"]' };
      if (b.dataset.kind === 'corr-decline') state.pick.snap = corrSnap(id);
      var fd = b.dataset.kind === 'fields' && state.runKey ? draftOf(state.runKey, id, false) : null;
      state.fieldsDraft = fd && fd.fd && fd.fd.key === state.runKey && fd.fd.fs === fsKey() ? fd.fd : null; if (fd) fd.open = false;
      if (b.dataset.kind === 'block' || b.dataset.kind === 'differently' || b.dataset.kind === 'deadline' || b.dataset.kind === 'fields') state.sel = id; render(); },
    unpick: function () { childEpoch++; var pk = state.pick; state.pick = null; state.fieldErr = null; state.fieldsDraft = null; if (pk && pk.kind === 'fields') dropDraft(state.runKey, pk.id, ['fields', 'open']); if (pk && pk.back) state.focus = pk.back; if (corrGoneOf(pk)) state.focus = 'fx-h'; render(); },
    /* A decline reason on a correction that's gone (2.11): copied, since it can't be saved. */
    'corr-copy-reason': function () { var pk = state.pick, el = document.getElementById('pick-input'); copyText(el ? String(el.value || '') : (pk && pk.text) || '', null, 'Copied.'); },
    block: function (id, b) { var reason = b.dataset.reason || val('pick-input'); if (!reason.trim()) return; mutate(function (r, map, me, now) { R.block(r, map, id, reason, me, now); }); },
    differently: function (id) { var note = val('pick-input'); if (!note.trim()) return; mutate(function (r, map, me, now) { R.differently(r, map, id, note, me, now); }); },
    deadline: function (id) {
      var iso = U.timeToday(val('pick-input'));
      if (!iso) { say('Type the time the tool shows, like 21:30 or 9:30 PM.', 'warn'); render(); return; }
      if (new Date(iso) < Date.now() - 12 * 3600000) iso = new Date(new Date(iso).getTime() + 86400000).toISOString();
      mutate(function (r, map, me, now) { R.setDeadline(r, map, id, iso, me, now); });
    },
    /* Passing closes only the gate's own forms: the step it moves to keeps its Fill in, as selecting it does (2.3.1). */
    pass: function (pi) { var o = { only: null }; mutate(function (r, map, me, now) { R.pass(r, map, +pi, me, now); o.only = state.justPassed = map.phases[+pi].gate.id; state.edit = null; afterPass(R.nextUp(r, map, me), map, false); }, o); },
    waive: function (pi) { var why = val('pick-input'); mutate(function (r, map, me, now) { R.waive(r, map, +pi, why, me, now); }); },
    fail: function (pi) { var why = val('pick-input') || 'Failed'; mutate(function (r, map, me, now) { R.fail(r, map, +pi, why, me, now); }); },
    reopen: function (pi) { mutate(function (r, map, me, now) { R.reopen(r, map, +pi, me, now); }); },
    edit: function (id) { childEpoch++; state.edit = id; render(); },
    unedit: function () { childEpoch++; state.edit = null; render(); },
    'save-edit': function () {
      var e = state.edit, v = val('edit-input');
      if (!e) return;
      mutate(function (r, map, me, now) {
        if (e.indexOf('detail:') === 0) { var n = R.setDetail(r, map, e.slice(7), v, me, now); if (n) say(n + ' step' + (n === 1 ? ' needs' : 's need') + ' a re-check because ' + e.slice(7) + ' changed. Gates that approved the old value need review.', 'warn'); }
        else R.setRole(r, map, e.slice(5), v, me, now);
      });
    },
    handoff: function () { var to = val('handoff-to'); if (!to) return; mutate(function (r, map, me, now) { R.handOff(r, to, me, now, R.legacyLinks(r, ctx.findRun)); }); },
    /* Picking up or taking over starts from the newest copy in the folder, never from what this screen showed earlier. */
    pickup: function () { if (runBusy(ctx.run())) return; fresh().then(function (t) { if (t) mutateRun(t.key, t.g, function (r, map, me, now) { R.pickUp(r, me, SESSION, now, R.legacyLinks(r, ctx.findRun)); }, { any: true }); }); },
    takeover: function () { if (runBusy(ctx.run())) return; fresh().then(function (t) { if (t) mutateRun(t.key, t.g, function (r, map, me, now) { R.takeOver(r, me, SESSION, now, R.legacyLinks(r, ctx.findRun)); }, { any: true, takeover: true }); }); },
    /* The receipt opens only once the ending is really in the team folder; a failed save keeps you here with Try again. */
    end: function (id) { var g = gen, key = state.runKey; mutate(function (r, map, me, now) { R.end(r, map, id, me, V.nameOf(ctx, me), now); }).then(function (ok) { if (ok && g === gen && state.runKey === key && ctx.run() && ctx.run().ended) { H.mode = 'replace'; setView('receipt'); render(); window.scrollTo(0, 0); } }); },
    /* Finishing: outcome, follow-ups and suggested map changes, then the receipt. */
    finish: function () { setView('finish'); state.pick = null; render(); window.scrollTo(0, 0); },
    'add-followup': function (id, b) {
      var text = b && b.dataset.text != null ? b.dataset.text : val('fu-text'), owner = b && b.dataset.text != null ? '' : val('fu-owner'), ticket = b && b.dataset.text != null ? '' : val('fu-ticket');
      if (!String(text).trim()) { state.fieldErr = { id: 'followup', msg: 'Say what needs doing.' }; render(); return; }
      state.fieldErr = null; state.clearInputs = 'fu-text';
      mutate(function (r, map, me, now) { R.addFollowUp(r, { text: text, owner: owner, ticket: ticket, step: b && b.dataset.step || '', from: b && b.dataset.from || '' }, me, now); });
    },
    'remove-followup': function (id) { mutate(function (r, map, me, now) { R.removeFollowUp(r, id, me, now); }); },
    /* What became of a follow-up: anyone on the team says, in a file of their own (decideFu). */
    'fu-pick': function (id, b) {
      var k = b && b.dataset.status; if (!PF.followups.LABEL[k] || k === 'open') return;
      /* Each follow-up's form has its own boxes (PF.followups.formId); switching to another starts it empty. */
      /* A snapshot of the row goes with the form (2.11): a newer read that removes the follow-up still draws it, marked, with
         what's typed, so it can be copied. Moved to's Find starts empty. */
      var sx = ctx.followUps().filter(function (y) { return y.key === id; })[0];
      state.fuPick = { key: id, status: k, snap: sx ? { key: sx.key, id: sx.id, process: sx.process, run: sx.run, runKey: sx.runKey, runTitle: sx.runTitle, test: sx.test, f: { text: sx.f.text, ticket: sx.f.ticket }, text: sx.text, owner: sx.owner, at: sx.at, status: 'open' } : null, to: null }; state.fieldErr = null;
      if (k === 'moved') setFind(PF.followups.formId(id) + '-to', '');
      state.focus = PF.followups.formId(id) + '-' + { done: 'link', ticket: 'ticket', moved: 'to', wont: 'reason' }[k]; render();
    },
    'fu-cancel': function (id) { var k = state.fuPick && state.fuPick.status; state.fuPick = null; state.fieldErr = null; state.focus = k ? '[data-act="fu-pick"][data-id="' + cssEsc(id) + '"][data-status="' + k + '"]' : null; render(); },
    /* A follow-up removed elsewhere while its form was open: what was typed in the form, to keep somewhere else. */
    'fu-copy': function (id) {
      var base = PF.followups.formId(id), parts = [];
      [['link', 'Link'], ['note', 'Note'], ['ticket', 'Ticket'], ['to', 'Moved to'], ['reason', 'Why']].forEach(function (b) { var v = val(base + '-' + b[0]); if (String(v || '').trim()) parts.push(b[1] + ': ' + String(v).trim()); });
      var snap = state.fuPick && state.fuPick.key === id && state.fuPick.snap;
      copyText((snap ? snap.text + '\n' : '') + parts.join('\n'), null, 'Copied what you typed.');
    },
    'fu-save': function (id) { if (state.fuPick && state.fuPick.key === id) decideFu(id, state.fuPick.status); },
    'fu-reopen': function (id) { decideFu(id, 'open'); },
    /* Open, Yours or All: an open form stays open with what's typed in it (2.11); its row is drawn whichever chip is on. */
    'fu-filter': function (id) { state.fuFilter = id === 'mine' || id === 'all' ? id : 'open'; state.more = Object.assign({}, state.more); delete state.more.fu; state.focus = '[data-act="fu-filter"][data-id="' + state.fuFilter + '"]'; render(); },
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
      recover(function () { var own = {}; Object.keys(local).forEach(function (k) { if (k[0] !== '_') own[k] = local[k]; }); var c = R.sanitize(R.testLast(own)); if (c) c._overflow = local._overflow || []; return Promise.resolve(c); }, 'Restored the copy kept in this browser; the version it replaced is kept as ', function () { lsSet(lkey, null); return Promise.resolve(); });
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
    search: function () { openSearch(); },
    'sx-open': function (id) { sxOpenResult(id); },
    'toggle-keys': function () { state.keys = !state.keys; lsSet('keys', state.keys); render(); },
    'start-mode': function (id, b) {
      state.startMode[b.dataset.process] = id; state.startModeAt[b.dataset.process] = startFormKey(); render();
    },
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
    'setup-run': function (id) { var p = procFind(id); if (!p || !p.latest) return; if (V.approvals(p.latest.map).length) delete state.startMode[id]; else state.startMode[id] = 'solo'; ACTIONS.start(id); },
    'setup-app-check': function () { setupAppCheck(); },
    'setup-copy': function (id) {
      var pre = document.getElementById({ prompt: 'su-prompt', invite: 'su-invite', request: 'su-request' }[id] || '');
      if (!pre) return;
      copyText(pre.textContent, pre, id === 'request' ? 'Copied. Send it to them by chat or email.' : id === 'invite' ? 'Copied. Send it by chat or email.' : 'Copied. Paste it to your AI assistant.');
    },
    'setup-open': function () { setupOpen(null); },
    'setup-who': function (id) {
      var p = data.people.filter(function (x) { return x.id === id && !x.inactive; })[0]; if (!p) return;
      state.me = id; lsSet('me', id); forgetStartIfNotMine(); state.setup = null; home();
      say('Welcome, ' + p.name.split(' ')[0] + '. Home shows what needs you; Runs and Checklists have the rest.', 'good'); state.focus = 'page-h'; render(); window.scrollTo(0, 0);
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
    'team-err-dismiss': function () { state.teamErr = null; render(); },
    'team-edit': function (id) {
      var tv = data.teamValues, e = tv && tv.doc && tv.doc.values && Object.prototype.hasOwnProperty.call(tv.doc.values, id) ? tv.doc.values[id] : null;
      if (!e) return;
      state.teamEdit = { name: id, value: e.value, about: e.about || '', base: { hash: tv.hash, text: tv.text } }; state.pick = null; state.fieldErr = null; state.focus = 'tv-e-value'; render();
    },
    'team-cancel': function () { state.teamEdit = null; state.fieldErr = null; render(); },
    'team-remove': function (id) { changeTeam(function (doc) { if (!Object.prototype.hasOwnProperty.call(doc.values, id)) throw new Error('"' + id + '" isn\'t a team value anymore.'); delete doc.values[id]; return id; }, function () { say('Removed the team value ' + id + '.', 'good'); }); },
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
    'run-reports': function (id) { state.repOpen = !state.repOpen; state.focus = '[data-act="run-reports"][data-id="' + cssEsc(id || 'rail') + '"]'; render(); },
    /* Reports: Accept asks first, in the card; Decline asks why. Nothing has a single-key shortcut. */
    'rep-accept': function (id) { repOpenForm(id, 'accept'); },
    'rep-decline': function (id) { repOpenForm(id, 'decline'); },
    /* A Reports panel row opens its own report's card (2.11): its step is selected, and the card is drawn whatever the page,
       unfolded, focused and brought into view. */
    'rep-goto': function (id, b) {
      var r = ctx.run(), map = r && R.mapOf(r), m = /^step-(.+)$/.exec(id || ''), x = m && map ? M.findStep(map, m[1]) : null, key = b && b.dataset ? b.dataset.report : '';
      var on = x && key ? ((reportsOf(r) || { list: [] }).list).filter(function (it) { return it.g.step === x.step.id; }).map(function (it) { return it.g.key; }) : [], n = on.indexOf(key);
      if (n < 0) { ACTIONS.goto(id); return; }
      selectStep(x.step.id); state.refOpen = true; state.unfold[x.phase.id] = true;
      /* The card's id is its report's (2.11), so focus stays on this report when another arrives ahead of it. */
      var hsel = '#' + V.reportCardId(key) + '-h';
      ensureListItemVisible(V.reportListId(r, x.step.id), key, { focus: hsel, word: 'opened' });
      /* On a phone the inspector sheet opens on the report, which keeps focus instead of Close, as a note from search does. */
      sheetFor = hsel;
      render();
    },
    /* Every copy of a report, 50 at a time in its Details fold (2.11), with focus on the first one the first 10 didn't show. */
    'rep-copies': function (id, b) { if (!id) return; (state.repCopies = state.repCopies || {})[id] = true; var to = b && b.dataset && b.dataset.focus || PF.vk.byId('repc-' + id); state.focus = to; state.focusWins = true; revealAt(to, true); render(); },
    /* A kept reason on a report that's gone (2.11): copied, since it can't be saved. */
    'rep-copy-reason': function (id) { var el = document.getElementById(PF.reports.reasonId(id)); copyText(el ? String(el.value || '') : repDraft(id) || '', null, 'Copied.'); },
    'rep-cancel': function (id) { delete repDrafts()[id]; delete repSnaps()[id]; repBoxes = repBoxes.filter(function (x) { return x.key !== id; }); state.repPick = null; if (state.fieldErr && /^rep-reason-/.test(state.fieldErr.id)) state.fieldErr = null; state.focus = '[data-act="rep-accept"][data-id="' + cssEsc(id) + '"], [data-act="rep-decline"][data-id="' + cssEsc(id) + '"]'; render(); },
    'rep-accept-go': function (id) { acceptReport(id); },
    'rep-decline-go': function (id) { decideOnReport(id, 'declined'); },
    'rep-reopen': function (id) { decideOnReport(id, 'open'); },
    'rep-record': function (id) { recordAccept(id); },
    help: function () { openOverlay({ html: function () { return V.help(ctx); } }); },
    /* A quick way between the checklist and the selected step, for keyboards and screen readers. */
    'to-ins': function () { state.refOpen = true; state.focus = 'ins-h'; render(); },
    'to-row': function (id) { if (narrow()) state.refOpen = false; state.focus = '[data-act="select"][data-id="' + cssEsc(id) + '"]'; render(); },
    'retry-save': function () { var cur = ctx.run(), r = cur && state.unsaved[cur.id], g = gen, key = state.runKey; if (r) save(r, (state.saveOpts || {})[r.id]).then(function (ok) { if (ok && g === gen && state.runKey === key && r.ended && state.view === 'finish') { H.mode = 'replace'; setView('receipt'); render(); } }); },
    'discard-unsaved': function () {
      var r = ctx.run(); if (!r || runBusy(r)) return;
      /* Put back the last version this window saved or read, at once: a run whose file is gone can't be reread to undo it. */
      var base = Object.prototype.hasOwnProperty.call(baselines, r.id) ? baselines[r.id] : null;
      if (base) { var back = base.make(); for (var i = 0; i < data.runs.length; i++) if (data.runs[i].id === r.id) data.runs[i] = back; bump(r.id); }
      delete state.unsaved[r.id]; delete state.saveErr[r.id]; if (state.saveOpts) delete state.saveOpts[r.id]; say('Your unsaved change was discarded.'); load(true);
    },
    /* ---------- corrections: recorded in runs, decided on the checklist\'s page (docs/design.md section 19) ---------- */
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
      /* Any composer on screen (this one's, or the step's other mode brought back by selecting it) is kept first, never
         written over; then this step and mode gets back its own, or a new one. */
      selectStep(id);
      if (state.corrForm && !(state.corrForm.step === id && state.corrForm.mode === mode)) stashCorr();
      var kept = state.corrForm || takeCorrDraft(state.runKey, id, mode);
      if (kept) { state.corrForm = kept; state.refOpen = true; state.focus = mode === 'differently' ? 'corr-happened' : corrFocus(kept.op); render(); return; }
      var op = b && PF.corrections.OPS.indexOf(b.dataset.op) >= 0 ? b.dataset.op : 'wording';
      state.corrForm = { key: state.runKey, step: id, mode: mode, op: op, scope: 'just', to: x.step.text, text: '', where: 'after', moveTo: '', roles: x.step.roles.slice(), shot: b && b.dataset.shot || '', why: '', happened: '', menu: false };
      state.refOpen = true; state.fieldErr = null;
      state.focus = mode === 'differently' ? 'corr-happened' : corrFocus(op); state.focusEnd = true; render();
    },
    'partial-dismiss': function (id) { delete state.partial[id]; render(); },
    /* View correction (Done differently): the correction is drawn whatever the page of the step's list (2.11), then focused and
       brought into view. It's kept by the note's identity (state.noteShown, its anchor), as a search result is, so a newer
       read that moves its twins never puts another in its place. */
    'goto-corr': function (id) {
      /* The row's id is corr-<key>; a note whose id is "" has the key "" (code review round 16). */
      var r = ctx.run(); if (!r || !state.sel || typeof id !== 'string' || id.indexOf('corr-') !== 0) return;
      var cid = id.slice(5);
      var m = U.nthOf(cid), nid = m.s, at = m.n, S = PF.search, notes = r._notes || [], ats = S.noteAts(notes), cn = null;
      notes.forEach(function (n, i) { if (!cn && n.id === nid && ats[i] === at && (n.kind === 'correction' || n.kind === 'fix' || n.kind === 'map')) cn = n; });
      if (!cn) return;
      state.noteShown = keepNote(state.runKey, notes, cn, state.sel);
      var csel = PF.vk.byId(V.corrDomId(nid, at)); state.focus = csel; state.focusWins = true; revealAt(csel, true); render();
    },
    'corr-menu': function () { var f = state.corrForm; if (!f) return; f.menu = !f.menu; state.focus = f.menu ? '.corr-menu-list button' : '[data-act="corr-menu"]'; render(); },
    'corr-op': function (id) {
      var f = state.corrForm; if (!f || PF.corrections.OPS.indexOf(id) < 0) return;
      f.op = id; f.menu = false; state.fieldErr = null; if (f.mode === 'differently') f.scope = 'fix';
      state.focus = corrFocus(id); state.focusEnd = true; render();
    },
    'corr-scope': function (id) { var f = state.corrForm; if (!f) return; f.scope = id === 'fix' ? 'fix' : 'just'; state.fieldErr = null; state.focus = '[data-act="corr-scope"][data-id="' + f.scope + '"]'; render(); },
    'corr-cancel': function () { var f = state.corrForm; if (f) dropCorrDraft(f); state.corrForm = null; state.fieldErr = null; if (f) state.focus = '[data-act="corr-open"][data-id="' + cssEsc(f.step) + '"][data-mode="' + f.mode + '"]'; render(); },
    'corr-save': function () { saveCorrection(false); },
    /* A correction to a phase's note or a gate's (2.0). */
    'nc-open': function (id, b) {
      var r = ctx.run(); if (!r || !state.me) return;
      var kind = b && b.dataset.kind === 'gate' ? 'gate' : 'phase';
      var ph = R.mapOf(r).phases.filter(function (p) { return kind === 'gate' ? p.gate && p.gate.id === id : p.id === id; })[0]; if (!ph) return;
      /* Each one is its own draft: opening another never touches it, and opening it again brings back what was typed. */
      var all = state.noteCorrs = state.noteCorrs || {}, k = ncKey(state.runKey, kind, id);
      if (!all[k]) all[k] = { key: state.runKey, kind: kind, id: id, to: (kind === 'gate' ? ph.gate.note : ph.note) || '', why: '' };
      state.fieldErr = null; state.focus = 'nc-to-' + kind + '-' + id; state.focusEnd = true; render();
    },
    'nc-cancel': function (id, b) {
      var kind = b && b.dataset.kind === 'gate' ? 'gate' : 'phase', all = state.noteCorrs || {}, k = ncKey(state.runKey, kind, id);
      if (!all[k]) return;
      delete all[k]; if (state.fieldErr && state.fieldErr.id === 'nc-' + kind + '-' + id) state.fieldErr = null;
      state.focus = '[data-act="nc-open"][data-kind="' + kind + '"][data-id="' + cssEsc(id) + '"]'; render();
    },
    'nc-save': function (id, b) { saveNoteCorrection(b && b.dataset.kind === 'gate' ? 'gate' : 'phase', id); },
    'corr-done': function () { saveCorrection(true); },
    /* Deciding on a group of corrections: anyone; declining needs a reason; withdrawing is for whoever suggested it. */
    'corr-applied': function (id) { decideCorr(id, 'applied', '', 'Marked as applied to the draft.'); },
    'corr-decline': function (id) { decideCorr(id, 'declined', val('pick-input'), 'Declined. The runs show why.'); },
    'corr-reopen': function (id) { decideCorr(id, 'open', '', 'Reopened.'); },
    'corr-withdraw': function (id, b) { decideCorr(id, 'withdrawn', '', 'Withdrawn.', b && b.dataset.process); },
    /* An item applied before 1.16: a person says which published version has it. Flightdeck still checks that version makes the change. */
    'corr-included': function (id, b) {
      var f = b && b.dataset.folder, v = PF.publish.versionOf(f || '');
      if (!v) return;
      decideCorr(id, 'included', '', 'Noted: v' + v + ' has it.', null, { version: v, folder: f });
    },
    /* Home acknowledgments: View change opens the process's corrections; Dismiss is remembered in this browser only. */
    /* It lands on the group it's about (2.11), drawn whatever the page, focused and in view; fx-h when that group is gone. */
    'ack-view': function (id, b) {
      var pid = b && b.dataset.process; if (!pid) return;
      ACTIONS['open-process'](pid); state.fixFilter = 'all'; (state.disc = state.disc || {})['fx:' + pid] = true; state.focus = 'fx-h';
      corrShow(pid, b.dataset.group); render();
    },
    'ack-dismiss': function (id) {
      if (!ACK_KEY.test(id || '')) return;
      var list = acksDismissed(); if (list.indexOf(id) < 0) list.push(id);
      lsSet('acks:' + fsKey(), list.slice(-ACK_MAX)); state.focus = 'page-h'; say('Dismissed. It won\'t show again in this browser.'); render();
    },
    /* Applying a correction to the draft: the comparison dialog and what it offers in each state. */
    'corr-review': function (id) {
      var p = currentProcess(); if (!p || !state.me) return;
      state.overlayFocus = '#ca-t';
      openOverlay({ corrApply: true, pid: p.id, gid: id, edit: null, combine: null, declining: false, err: null, html: function () { return V.corrApply(ctx, this); },
        /* Choices made in the dialog live in it: an edited result, alternatives being combined, or a decline started. */
        held: function () { return !!(this.declining || this.combine || (this.edit && this.edit.text !== this.edit.from)); } });
    },
    'corr-apply': function (id, b) { var ov = caOv(); if (ov && ov.gid === id && !ov.busy) applyCorr(ov, b && b.dataset.how === 'edit' ? 'edit' : ''); },
    'corr-edit': function (id) {
      var ov = caOv(); if (!ov || ov.gid !== id) return;
      var x = caFind(ov.pid, ov.gid), g = x.g; if (!g) return;
      var rv = PF.corrections.review(g, caBase(x.p));
      ov.edit = { text: g.change.op === 'wording' ? (rv.result ? rv.result.text : g.change.to) : g.change.op === 'add' ? g.change.text : null }; ov.edit.from = ov.edit.text; ov.err = null;
      state.overlayFocus = ov.edit.text != null ? '#ca-edit' : '#ca-t'; render();
    },
    'corr-combine': function (id) {
      var ov = caOv(); if (!ov || ov.gid !== id) return;
      var x = caFind(ov.pid, ov.gid), g = x.g; if (!g) return;
      ov.combine = PF.corrections.alternatives(x.all, g).map(function (y) { return y.id; }); ov.edit = { text: g.change.to, from: g.change.to }; ov.err = null;
      state.overlayFocus = '#ca-edit'; render();
    },
    'corr-edit-cancel': function () { var ov = caOv(); if (!ov) return; ov.edit = null; ov.combine = null; ov.err = null; state.overlayFocus = '#ca-t'; render(); },
    'corr-link': function (id) {
      var ov = caOv(); if (!ov || ov.gid !== id || ov.busy) return;
      var x = caFind(ov.pid, ov.gid); if (!x.g) return;
      var base = caBase(x.p), rv = PF.corrections.review(x.g, base, null, { applied: caApplied(x.p.id, x.g.id) });
      if (rv.state !== 'already') { caErr(ov, 'The draft changed since this was shown. Look at the comparison again.'); return; }
      var ap = caApplied(x.p.id, x.g.id);
      caDecide(ov, 'applied', '', 'Linked: the draft already has this correction.', PF.corrections.outcome(x.g, base, rv.result ? rv.result.id : ap ? ap.step : ''));
    },
    'corr-addressed': function (id) {
      var ov = caOv(); if (!ov || ov.gid !== id || ov.busy) return;
      var x = caFind(ov.pid, ov.gid); if (!x.g) return;
      /* Already addressed (the step changed, or is gone) is addressed differently: it records no result, so it's never taken as
         the proposed change. Mark as applied (made by hand) records none either; a version's text decides whether it has it. */
      var st = PF.corrections.review(x.g, caBase(x.p), null, { applied: caApplied(x.p.id, x.g.id) }).state;
      if (st === 'changed' || st === 'gone') caDecide(ov, 'applied', '', 'Marked as addressed differently.', null, { addressed: true });
      else caDecide(ov, 'applied', '', 'Marked as applied to the draft.', null);
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
    'corr-filter': function (id) { state.fixFilter = id === 'all' ? 'all' : 'open'; state.more = Object.assign({}, state.more); delete state.more['fx:' + state.processId]; state.focus = '[data-act="corr-filter"][data-id="' + state.fixFilter + '"]'; render(); },
    'copy-corr-brief': function (id) {
      var p = procFind(id); if (!p) return;
      /* The brief quotes the steps as the draft has them now, since that's the file the assistant edits. */
      var map = p.draft ? M.parse(p.draft.md) : p.latest ? p.latest.map : null;
      var text = PF.corrections.brief({ id: p.id, title: p.title }, ctx.corrections(p.id), { map: map, draftFile: p.draft ? p.draft.file : null, version: p.latest && p.latest.info.version, nameOf: function (x) { return V.nameOf(ctx, x); } });
      state.brief = { key: 'corrections:' + p.id, text: text }; render();
      copyText(text, document.getElementById('brief-pre'), 'Copied. Paste it to your AI assistant.');
    },
    'zoom-corr': function (id, b) { var c = attNote(b); if (c) openLightbox(imagesOf(c), +b.dataset.i); },
    'add-note': function (id) {
      var r = ctx.run(), text = val('note-text').trim(), nkey = state.runKey, mine = attachmentsFor(nkey, id), files = mine;
      var who = state.me, nfs = state.fs, ng = gen;
      if (!r || !who || (!text && !files.length)) return;
      /* A note that's too long is refused, not cut short; the draft stays so it can be shortened or split. */
      if (text.length > NOTE_MAX) { state.fieldErr = { id: 'note:' + id, msg: 'Notes can be up to 2,000 characters; this one is ' + text.length.toLocaleString('en-US') + '. Shorten it, or split it into two notes.', field: 'note-text' }; state.focus = '#note-text'; render(); return; }
      state.fieldErr = null;
      var endBusy = busyStart(), nid = U.randomId(10), sent = null;
      queued(function () {
        return saveFiles(nfs, r, files).then(function (saved) {
          var note = sent = { id: nid, at: new Date().toISOString(), by: who, session: WRITER, step: id, text: text, files: saved.paths, fileInfo: saved.info };
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
        /* The new note is drawn wherever its time sorts it, even outside the newest 20 (a clock behind), and brought into view (2.11).
           It's kept by what it is, as read back (keepNote), so a twin arriving later never takes its place (code review round 21). */
        return refreshRun().then(function () {
          if (ng !== gen || state.runKey !== nkey || !sent) return;
          state.noteShown = null; state.noteSent = { gen: gen, run: nkey, step: id, sent: PF.search.noteRead(sent, runBase(r)) };
          render();
        });
      }, function (e) { endBusy(); if (ng !== gen) return; say('Couldn\'t add the note: ' + e.message, 'bad'); render(); });
    },
    /* Every role, drawn or in a hidden field, kept in the form's state so a redraw (Show more, Find, a refresh) draws it so. */
    'just-me': function () {
      var rc = state.view === 'start' ? state.roleCarry : null, me = state.me, on = PF.people.sorted(ctx).some(function (x) { return x.id === me && !x.inactive; });
      /* As 2.10 sets every role's select to you: a select can't hold someone who isn't on the team, so it's nobody then. */
      if (rc) Object.keys(rc.vals).forEach(function (role) { rc.vals[role] = on ? me : ''; var el = document.getElementById('role-' + role); if (el) el.value = on ? me : ''; });
      render();
    },
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
    'exit-mission': function () { reenterRun(); render(); },
    /* The key other apps use for this run (flightdeck run <folder> <key> --json). */
    'copy-run-key': function (id) { copyText(id, null, 'Copied the run key.'); },
    /* The receipt's text is worked out when it's copied (2.11), with every report and correction, and put in its hidden box for
       a browser that can't copy by itself. */
    'copy-receipt': function () { var pre = document.getElementById('receipt-text'), text = V.receiptText(ctx); if (pre) pre.textContent = text; copyText(text, pre); },
    zoom: function (id, b) { var r = ctx.run(), x = r && M.findStep(R.mapOf(r), id); if (!x) return; openLightbox(x.step.shots.map(function (s) { return { src: s.src, caption: s.caption }; }), +b.dataset.i); },
    'zoom-phase': function (id, b) { var r = ctx.run(), ph = r && R.mapOf(r).phases.filter(function (x) { return x.id === id; })[0]; if (!ph) return; openLightbox(ph.shots.map(function (s) { return { src: s.src, caption: s.caption }; }), +b.dataset.i); },
    'zoom-gate': function (id, b) { var r = ctx.run(), ph = r && R.mapOf(r).phases.filter(function (x) { return x.gate.id === id; })[0]; if (!ph) return; openLightbox(ph.gate.shots.map(function (s) { return { src: s.src, caption: s.caption }; }), +b.dataset.i); },
    'zoom-note': function (id, b) { var n = attNote(b); if (n) openLightbox(imagesOf(n), +b.dataset.i); },
    'att-remove': function (id) { var p = state.pendingFiles.filter(function (x) { return x.id === id; })[0]; if (!p) return; state.pendingFiles = state.pendingFiles.filter(function (x) { return x !== p; }); state.attErr = null; state.focus = /^corr:/.test(p.step) ? 'corr-why' : 'note-text'; render(); },
    /* A text attachment opens as plain text in a dialog; anything else saves a copy. Only files of the note or suggestion named are read. */
    'att-open': function (id, b) {
      var it = attOwner(b), path = b && b.dataset.path, g = gen, key = state.runKey, view = state.view, pid = state.processId, ov = state.overlay; if (!it || !path) return;
      var name = PF.attach.nameOf(path, (it.fileInfo || {})[path]);
      /* A slow read that finishes after the person moved to another run or page, or opened a dialog meanwhile, opens nothing. */
      var still = function () { return g === gen && state.overlay === ov && state.view === view && (view === 'process' ? state.processId === pid : state.runKey === key); };
      state.fs.blob(path).then(function (blob) {
        if (!still()) return;
        if (!blob) { say('"' + name + '" isn\'t in the folder yet. OneDrive may still be syncing it.', 'warn'); render(); return; }
        var cut = blob.size > PF.attach.PREVIEW_MAX;
        return blob.slice(0, PF.attach.PREVIEW_MAX).text().then(function (text) {
          if (!still()) return;
          if (overlayHeld()) { say('Finish or cancel this first.', 'warn'); render(); focusOverlay(); return; }
          openOverlay({ text: text, html: function () { return V.textPreview(name, path, cut, blob.size, id, b.dataset.from, b.dataset.note); } });
        });
      }, function (e) { if (g === gen) { say('Couldn\'t open "' + name + '": ' + e.message, 'bad'); render(); } });
    },
    'att-save': function (id, b) {
      var it = attOwner(b), path = b && b.dataset.path, g = gen; if (!it || !path) return;
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
  /* Export evidence: the dialog's actions live in src/ui/exporter.js. */
  var exporter = PF.exporter({ ctx: ctx, state: state, gen: function () { return gen; }, open: openOverlay, render: render, version: APP_VERSION });
  Object.keys(exporter.actions).forEach(function (k) { ACTIONS[k] = exporter.actions[k]; });
  /* Reread the open run before taking over recording. Resolves to the run's key and generation, or null if the folder changed. */
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
      dropCorrDraft(f);
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
      /* The new correction is drawn whatever the page of the step's list (2.11), focused and brought into view. */
      return then().then(function () { return withNote && state.runKey === key ? refreshRun() : null; }).then(function () {
        /* By what it is, as read back (sentNotes), never by its key now: a twin arriving later never takes its place. */
        if (note && state.view === 'run' && state.runKey === key && ng === gen) state.noteSent = { gen: gen, run: key, step: step, sent: PF.search.noteRead(note, runBase(r)), corr: true };
        render();
      });
    }, function (e) { endBusy(); f.sending = false; settled(); if (ng !== gen) return; say('Couldn\'t save. Try again. ' + e.message, 'bad'); render(); });
  }
  /* A note correction's draft: by folder, run and the phase or gate it's about. */
  function ncKey(key, kind, id) { return draftKey(key, 'nc:' + kind + ':' + id); }
  function saveNoteCorrection(kind, tid) {
    var r = ctx.run(), all = state.noteCorrs || {}, k = ncKey(state.runKey, kind, tid), f = all[k], sfx = '-' + kind + '-' + tid;
    if (!r || !f || !state.me || f.sending) return;
    var o = { id: U.randomId(10), at: new Date().toISOString(), by: state.me, session: WRITER, map: R.mapOf(r), op: 'wording', to: f.to, why: f.why, version: +r.version || 0, folder: r.folder, files: [] }, note;
    o[f.kind] = f.id;
    try { note = PF.corrections.build(o); }
    catch (e) { var fld = e.field === 'corr-why' ? 'why' : 'to'; state.fieldErr = { id: 'nc' + sfx, msg: e.message, field: fld }; state.focus = 'nc-' + fld + sfx; render(); return; }
    state.fieldErr = null; f.sending = true;
    var nfs = state.fs, ng = gen, endBusy = busyStart(); say('Saving…', ''); state.msg.quiet = true; render();
    queued(function () { return repo.addNote(nfs, r, WRITER, note); }).then(function () {
      endBusy(); f.sending = false; if (ng !== gen) return;
      if (all[k] === f) delete all[k];
      say('Correction saved on this computer.', 'good'); state.msg.quiet = true;
      return (state.runKey === f.key ? refreshRun() : null);
    }).then(function () { render(); }, function (e) { endBusy(); f.sending = false; if (ng !== gen) return; say('Couldn\'t save. Try again. ' + e.message, 'bad'); render(); });
  }
  /* The composer's boxes are read into its state as they change, so a redraw (or the live redline) never loses them. */
  function readCorrForm(f) {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : null; };
    ['to', 'text', 'why', 'happened'].forEach(function (k) { var v = g('corr-' + k); if (v != null) f[k] = v; });
    var mv = g('corr-move'); if (mv != null) f.moveTo = mv;
  }
  /* Anyone on the team decides on a group of corrections; the decision is a new file written once, following the decision
     this window shows. */
  /* What a correction being declined said (2.11), kept with the decline: if a newer read no longer has it, its row is drawn
     from this, as Removed elsewhere, with the reason typed (D4). */
  function corrSnap(id) {
    var p = currentProcess(), g = p && ctx.corrections(p.id).filter(function (x) { return x.id === id; })[0], C = PF.corrections;
    if (!g) return null;
    return { process: p.id, op: C.OP_LABEL[g.change.op] || '', target: C.targetName(g), from: g.change.op !== 'describe' ? g.from || '' : '', to: g.change.op === 'wording' ? g.change.to || '' : '' };
  }
  /* The decline pick whose correction is no longer in the folder. */
  function corrGoneOf(pk) {
    if (!pk || pk.kind !== 'corr-decline' || !pk.snap) return false;
    return !ctx.corrections(pk.snap.process).some(function (g) { return g.id === pk.id; });
  }
  /* Its reason is kept through redraws (drawn as the box's own text), so navigation asks this instead of dirtyControl(). */
  function corrHarvest() {
    var pk = state.pick; if (!pk || pk.kind !== 'corr-decline') return;
    var el = document.getElementById('pick-input'); if (el) pk.text = String(el.value == null ? '' : el.value);
  }
  function corrGonePending() {
    var pk = state.pick; if (!corrGoneOf(pk)) return null;
    var el = document.getElementById('pick-input'), t = el ? String(el.value || '') : pk.text || '';
    return t.trim() ? el || { id: 'pick-input' } : null;
  }
  function decideCorr(id, status, reason, done, pid, more) {
    var p = pid ? procFind(pid) : currentProcess(), g = p && ctx.corrections(p.id).filter(function (x) { return x.id === id; })[0];
    if (!g || !state.me) return;
    var rec;
    try { rec = PF.corrections.decision(g, state.me, status, reason, new Date().toISOString(), Object.assign({ current: g.decision, act: U.randomId(10) }, more || {})); }
    catch (e) { if (status === 'declined') { state.fieldErr = { id: 'corr-decline', msg: e.message }; state.focus = 'pick-input'; } else say(e.message, 'warn'); render(); return; }
    var dfs = state.fs, gg = gen;
    queued(function () { return repo.decideCorrection(dfs, rec, WRITER); }).then(function () {
      if (gg !== gen) return; state.pick = null; state.fieldErr = null; if (state.view === 'process') state.focus = 'fx-h'; say(done, 'good'); return load(true);
    }, function (e) { if (gg !== gen) return; say('Couldn\'t save the decision: ' + e.message, 'bad'); render(); });
  }
  /* A decision on a follow-up is a new file written once, following the decision this window shows; run.json never changes. */
  var FU_SAID = { open: 'Reopened. It\'s open again.', done: 'Marked done.', ticket: 'Marked as moved to a ticket.', moved: 'Marked as moved to another run.', wont: 'Marked won\'t do. The run shows why.' };
  /* Saving is tracked per follow-up (state.fuSaving: key → true, one object per folder): another follow-up's form stays open
     and saves on its own, and a save that finishes closes only its own form. */
  function decideFu(key, status) {
    var x = ctx.followUps().filter(function (y) { return y.key === key; })[0];
    if (!x) return;
    var saving = state.fuSaving || (state.fuSaving = {});
    if (saving[key]) { say('Still saving what became of this one.', 'warn'); render(); return; }
    if (!state.me) { say('Choose who you are first, at the top right.', 'warn'); render(); return; }
    var base = PF.followups.formId(key), box = function (k) { return val(base + '-' + k); };
    var rec, o = status === 'open' ? {} : { link: box('link'), note: box('note'), ticket: box('ticket'), to: box('to'), reason: box('reason') };
    try { rec = PF.followups.decision(x, state.me, status, o, new Date().toISOString(), x.decision); }
    catch (e) { if (e.field) { var fid = base + e.field.replace(/^fud/, ''); state.fieldErr = { id: fid, msg: e.message }; state.focus = fid; } else say(e.message, 'warn'); render(); return; }
    var dfs = state.fs, gg = gen;
    saving[key] = true; if (state.fieldErr && state.fieldErr.id.indexOf(base + '-') === 0) state.fieldErr = null; render();
    /* Switching folders replaces state.fuSaving, so this only ever clears its own folder's entry. */
    function settle() { delete saving[key]; }
    queued(function () { return repo.decideFollowUp(dfs, rec, WRITER); }).then(function () {
      settle();
      if (gg !== gen) return;
      say(FU_SAID[status], 'good');
      /* Only this follow-up's form closes; one open for another follow-up keeps its place and its text. */
      if (state.fuPick && state.fuPick.key === key) {
        state.fuPick = null;
        /* The row may leave the list (Home, Open): focus goes to the list's heading, else to the run's Follow-ups. */
        state.focus = state.view === 'followups' ? 'fu-list-h' : state.view === 'home' ? 'page-h' : '[data-act="run-fu"]';
      }
      return load(true);
    }, function (e) { settle(); if (gg !== gen) return; say('Couldn\'t save what became of it: ' + e.message, 'bad'); render(); });
  }
  /* ---------- reports from tools (PF.reports, docs/design.md section 26) ---------- */
  /* Report contents are read only for the run that's open (repo.loadRunReports), again after each read of the folder, so a
     file replaced under the same name is never shown from an old read. A run with no report names costs nothing. */
  var repCache = Object.create(null);
  function repLoad(r) {
    var X = PF.reports, rep = data.reports;
    if (!r || !rep || !state.fs) return null;
    var key = r.process + '/' + r.id, names = rep.files.filter(function (f) { return f.process === r.process && f.run === r.id; }).map(function (f) { return f.name; });
    var unsure = rep.files.length >= X.LIMITS.reports || !!(data.failed || {}).reports || rep.bad.some(function (b) { return b.path === X.DIR + '/' + r.process + '/'; });
    if (!names.length && !unsure) return null;
    var k = fsKey() + '\n' + key, e = repCache[k], sigN = names.join('/') + '@' + data.readAt;
    if (e && (e.loading || e.sig === sigN)) return e;
    var g = gen, ne = { sig: sigN, list: e ? e.list : [], badNames: e ? e.badNames : [], failed: e ? e.failed : '', loading: true };
    repCache[k] = ne;
    repo.loadRunReports(state.fs, r.process, r.id).then(function (res) {
      if (g !== gen) return;
      /* A folder that couldn't be read isn't an empty one: the reports last read stay shown, with the failure named (Accept
         and Record the decision read every copy again first, so nothing is decided from them). */
      ne.loading = false; ne.failed = res.failed;
      if (!res.failed) { ne.list = res.list.map(function (g) { return { g: g, depth: g.order ? g.order.depth : 0, note: g.order ? g.order.note : '' }; }); ne.badNames = res.badNames; }
      render();
    }, function (err) { if (g !== gen) return; ne.failed = err && err.message || String(err); ne.loading = false; render(); });
    /* A full log has archived its oldest lines, which may name an acceptance: the history is read too, and one that can't be
       read (or has lines this copy can't read) is named, never taken as "no acceptance there". */
    ne.archived = e ? e.archived : []; ne.histFailed = '';
    if (names.length && (r.log || []).length >= R.LOG_MAX) {
      ne.histLoading = true;
      repo.loadHistory(state.fs, r).then(function (h) {
        if (g !== gen) return;
        ne.histLoading = false; ne.archived = h.filter(function (x) { return x && x.kind === 'log'; });
        if (h.refused && h.refused.length) ne.histFailed = h.refused[0].path + ' ' + h.refused[0].why;
        render();
      }, function (err) { if (g !== gen) return; ne.histLoading = false; ne.histFailed = err && err.message || String(err); render(); });
    }
    return ne;
  }
  function repArchived(r) { var e = r ? repCache[fsKey() + '\n' + r.process + '/' + r.id] : null; return e ? e.archived || [] : []; }
  function repCur() { return repCurMemo || (repCurMemo = PF.reports.current(data.repDecisions || [])); }
  function reportsOf(r) {
    if (!r) return null;
    var key = r.process + '/' + r.id;
    if (repMemo[key]) return repMemo[key];
    var e = repLoad(r), cur = repCur(), found = e ? e.list : [];
    /* A report whose every copy is gone still shows from the decisions on it. */
    var list = found.concat(PF.reports.fromDecisions(found.map(function (it) { return it.g; }), data.repDecisions, r.process, r.id).map(function (g) { return { g: g, depth: 0, note: '' }; }));
    return (repMemo[key] = { list: list, badNames: e ? e.badNames : [], failed: e ? e.failed : '', loading: !!(e && e.loading), cur: cur,
      archived: e ? e.archived || [] : [], histFailed: e ? e.histFailed || '' : '',
      unrecorded: PF.reports.unrecorded(r, list.map(function (it) { return it.g; }), cur, R.mapOf(r), e ? e.archived : null), pending: pendingAccepts(key), unsaved: !!runUnsaved(r), readOnly: repReadOnly(r),
      fillOpen: function (id) { return fillOpenOn(key, id); }, held: repHeld, canRecord: function () { return repCanRecord(r); } });
  }
  function reportsWaiting() {
    if (!state.me || !data.reports) return {};
    var keys = Object.create(null);
    data.runs.forEach(function (r) { if (r.state === 'running' && !r.ended && r.recorder.person === state.me) keys[r.process + '/' + r.id] = true; });
    return PF.reports.undecided(data.reports.files, repCur(), keys);
  }
  /* Why nothing may be decided on a report now: a decision on it, or the decisions folder, couldn't be read, so what was
     decided isn't known (a failed read is never "not decided"). '' when it may be. */
  function repHeld(g) {
    if ((data.failed || {})['report decisions']) return 'Decisions on reports couldn\'t be read on the last check, so nothing can be decided here until they can.';
    var files = PF.reports.unreadOn(g, data.repUnread);
    return files.length ? 'A decision on this report can\'t be read (' + files[0] + '), so nobody here knows what was decided. Decide once it can be read.' : '';
  }
  /* Who may record an acceptance the run logs: its recorder while it runs, and once it has ended, whoever recorded or ended it
     (as for conflict copies). A decision never changes run.json. */
  function repCanRecord(r) { return ctx.recording(r) || ctx.canRecover(r); }
  /* Why the open run can't take an answer here, as mutateRun would say it, or ''. */
  function repReadOnly(r) { return r._unrunnable ? r._unrunnable + ' This run is read-only here.' : runUnread(r) || (state.recovering ? 'Wait until the copy is kept, then try again.' : ''); }
  function fillOpenOn(key, id) {
    var d = draftOf(key, id, false);
    return !!((state.pick && state.pick.kind === 'fields' && state.pick.id === id && state.runKey === key) || (d && (d.open || Object.keys(d.fields).length)));
  }
  /* Decline reasons being typed, per folder and report: kept work, as a step's draft is. Leaving the run, another step or
     another report's form keeps each one; it is drawn again with its report until Cancel or the decline is saved. */
  var repBoxes = [], repBoxFs = null;
  function repDrafts(fk) { var all = state.repDrafts || (state.repDrafts = {}), k = fk == null ? fsKey() : fk; return all[k] || (all[k] = Object.create(null)); }
  function repDraft(key) { var d = repDrafts(); return typeof d[key] === 'string' ? d[key] : null; }
  /* What a report with a kept reason said (2.11), beside the reason, per folder: so if its files go, its card can still be drawn
     from this, as Removed elsewhere, with the reason. */
  function repSnaps(fk) { var all = state.repSnaps || (state.repSnaps = {}), k = fk == null ? fsKey() : fk; return all[k] || (all[k] = Object.create(null)); }
  function repSnapNow(r) {
    var d = repDrafts(), keys = Object.keys(d), b = keys.length && r ? reportsOf(r) : null; if (!b) return;
    var sn = repSnaps(), rk = r.process + '/' + r.id;
    b.list.forEach(function (it) { if (typeof d[it.g.key] === 'string') sn[it.g.key] = { run: rk, step: it.g.step, producer: it.g.producer, says: V.reportSays(it.g.report) }; });
  }
  /* Kept reasons on a run's step whose report is no longer in the folder. */
  function repGone(r, stepId) {
    var d = repDrafts(), sn = repSnaps(), rk = r.process + '/' + r.id, b = reportsOf(r), here = Object.create(null);
    if (!b) return [];
    b.list.forEach(function (it) { here[it.g.key] = true; });
    return Object.keys(d).filter(function (k) { return typeof d[k] === 'string' && sn[k] && sn[k].run === rk && sn[k].step === stepId && !here[k]; }).sort().map(function (k) { return { key: k, snap: sn[k], text: d[k] }; });
  }
  /* Only the boxes the last render drew hold typing. */
  function repHarvest() {
    if (!repBoxes.length) return;
    var d = repDrafts(repBoxFs);
    repBoxes.forEach(function (b) { var el = document.getElementById(b.id); if (el) d[b.key] = String(el.value == null ? '' : el.value); });
  }
  function repNoteDrawn(page) {
    repSnapNow(ctx.run && ctx.run());
    var d = repDrafts(), keys = Object.keys(d), p = state.repPick;
    if (p && p.mode === 'decline' && keys.indexOf(p.key) < 0) keys.push(p.key);
    repBoxFs = fsKey();
    repBoxes = keys.map(function (k) { return { key: k, id: PF.reports.reasonId(k) }; }).filter(function (b) { return page.indexOf('id="' + b.id + '"') >= 0; });
  }
  function repItem(id) { var r = ctx.run(), b = reportsOf(r); return { r: r, b: b, it: b ? b.list.filter(function (x) { return x.g.key === id; })[0] : null }; }
  function repOpenForm(id, mode) {
    var o = repItem(id);
    if (!o.it || !ctx.recording(o.r)) return;
    repHarvest();
    state.repPick = { key: id, mode: mode };
    if (state.fieldErr && /^rep-reason-/.test(state.fieldErr.id)) state.fieldErr = null;
    state.focus = mode === 'decline' ? PF.reports.reasonId(id) : V.reportCardId(id) + '-cf';
    render();
  }
  /* Acceptances this window made in this session, per folder: only a hint that the finalizer should try them by itself, once
     (run key, report key, SHA-256 and the answer's at and by). A hint holds no decision and decides nothing; saved state does. */
  function hintsOf(fk) { var all = state.repHints || (state.repHints = {}), k = fk == null ? fsKey() : fk; return all[k] || (all[k] = Object.create(null)); }
  function pendingAccepts(key) { var hs = hintsOf(); return Object.keys(hs).filter(function (k) { return hs[k].runKey === key; }).map(function (k) { return { key: k }; }); }
  /* A report as the folder has it now: every copy read again and grouped (PF.reports.group), so a copy that arrived or
     changed since it was shown is judged too. Rejects when the reports folder can't be read. */
  function freshGroup(dfs, g) {
    return repo.loadRunReports(dfs, g.process, g.run).then(function (res) {
      if (res.failed) throw new Error('The reports folder couldn\'t be read: ' + res.failed);
      return res.list.filter(function (x) { return x.key === g.key; })[0] || null;
    });
  }
  /* Every decision on a report is written here, and the hold is checked again right before the write, in the write queue. */
  function putDecision(dfs, rec) {
    return queued(function () {
      var held = repHeld({ process: rec.process, run: rec.run, step: rec.step, producer: rec.producer, id: rec.report });
      if (held) return Promise.reject(new Error(held));
      return repo.decideReport(dfs, rec, WRITER);
    });
  }
  /* Accept: every copy is read again and the report must be the bytes shown, with no copy that differs or can't be read; then
     the answer goes through answerStep like every answer. */
  function acceptReport(id) {
    var o = repItem(id);
    if (!o.it || state.repSaving) return;
    var X = PF.reports, shown = o.it.g, key = o.r.process + '/' + o.r.id, gg = gen, fk = fsKey(), dfs = state.fs;
    state.repSaving = id; render();
    freshGroup(dfs, shown).then(function (g) {
      if (gg !== gen) return;
      state.repSaving = null;
      if (!g || !g.report || g.differ || g.unreadable.length || g.sha256 !== shown.sha256) { delete repCache[fk + '\n' + key]; state.repPick = null; say('This report changed in the team folder since it was shown, so nothing was accepted. Look at it again, then decide.', 'warn'); render(); return; }
      var r2 = ctx.findRun(key), map = r2 && R.mapOf(r2);
      var el = X.eligible(g, r2, map, { recording: ctx.recording(r2), readOnly: r2 ? repReadOnly(r2) : '', held: repHeld(g), fillOpen: fillOpenOn(key, g.step) });
      if (!el.ok) { say(el.why, 'warn'); render(); return; }
      return answerStep(key, g.step, { how: 'report', report: { g: g, sha: g.sha256, values: el.values, fk: fk } });
    }, function (e) { if (gg !== gen) return; state.repSaving = null; say('Couldn\'t read the report again: ' + (e && e.message || e), 'bad'); render(); });
  }
  function reportCheck(key, id, rp) {
    var r = ctx.findRun(key), map = r && R.mapOf(r), x = map && M.findStep(map, id);
    if (!x || !rp) return { why: '' };
    if (fillOpenOn(key, id)) return { why: 'Save or cancel Fill in first.', fill: true, focus: '[data-act="pick"][data-kind="fields"][data-id="' + cssEsc(id) + '"], [data-act="save-fields"][data-id="' + cssEsc(id) + '"]' };
    try { skillSeen(r, x.step); } catch (e) { return { why: e.message, fill: true, focus: '[data-act="refresh"]' }; }
    return { r: r, map: map, x: x, values: rp.values };
  }
  /* Inside the run's change: the answer with exactly the report's evidence (and, on a run/3 skill step, the registration as
     observed, as Done records it) and the log line naming the SHA-256 of the bytes accepted. Returns the hint. */
  function acceptInto(r2, map2, id, me, now, rp) {
    var X = PF.reports, x = M.findStep(map2, id), seen = skillSeen(r2, x.step);
    R.done(r2, map2, id, me, now, seen ? Object.assign({}, rp.values, { _skill: seen }) : rp.values, { exact: true });
    R.log(r2, me, now, X.logLine(rp.g, rp.sha, x.step.text));
    return { runKey: r2.process + '/' + r2.id, gkey: rp.g.key, sha: rp.sha, at: now, by: me };
  }
  /* After a save of a run lands (key), or after a read (no key): this window's own acceptances are tried by the finalizer. */
  function finishAccepts(key) {
    var hs = hintsOf();
    Object.keys(hs).forEach(function (k) { var h = hs[k]; if (!h.busy && (key == null || h.runKey === key)) finalizeAccept(h.runKey, k, h, h); });
  }
  /* The one way an acceptance's decision is written (plan rev 6), automatically for this window's hint or by Record the
     decision; want: { sha, at, by }, the one acceptance to record. Judged in its write's turn from saved state only: the run as the folder holds it (with its archived log), every
     copy of the report and the decisions on it, both read again. Resolves { wait } when it couldn't start (the run isn't
     saved or can't be read, a decision can't be read), { done } once written, else { why }. */
  function finalizeAccept(key, gkey, want, hint) {
    var X = PF.reports, dfs = state.fs, gg = gen, fk = fsKey(), part = gkey.split('/'), id = { key: gkey, process: part[0], run: part[1], step: part[2], producer: part[3], id: part[4] };
    var wait = function () { var r = ctx.findRun(key); return runNotSure(r) || repHeld(id) || (!repCanRecord(r) ? 'Only the recorder can record this decision.' : ''); };
    if (hint) hint.busy = true;
    return queued(function () {
      if (wait()) return { wait: wait() };
      var g;
      return freshGroup(dfs, id).then(function (got) {
        g = got;
        return repo.loadDecisionsOn(dfs, id);
      }).then(function (dd) {
        if (gg !== gen) return { wait: 'gone' };
        if (wait() || dd.unread.length) return { wait: wait() || 'A decision on this report can\'t be read (' + dd.unread[0] + '), so nobody here knows what was decided. Decide once it can be read.' };
        if (!g) return { why: 'The report it accepted isn\'t in the folder in that form anymore, so no decision was recorded.' };
        var r = ctx.findRun(key), map = R.mapOf(r), cur = X.current(dd.decisions);
        var u = X.unrecorded(r, [g], cur, map, repArchived(r)).filter(function (y) { return y.sha256 === want.sha && y.at === want.at && y.by === want.by; })[0];
        if (!u) return { why: 'There\'s no acceptance of this report left to record: it\'s recorded, or the step was answered again since.' };
        if (!u.recordable) return { why: u.why === 'changed' ? 'The step\'s evidence was changed after the report was accepted, so the decision can\'t be recorded from this report.' : 'The report it accepted isn\'t in the folder in that form anymore, so no decision was recorded.' };
        if (hint && u.other) return { why: '' };
        var x = M.findStep(map, g.step), ap = X.applies(g.report, r, map, x.step);
        var rec = X.decision(g, u.sha256, 'accepted', state.me, new Date().toISOString(), cur[g.key] ? cur[g.key].d : null, { answer: { at: u.at, by: u.by, fp: X.fingerprint(r.steps[g.step].values || {}, X.schemaOf(r, x.step)) }, inputs: ap.result === 'match' ? 'match' : 'unknown' });
        return repo.decideReport(dfs, rec, WRITER).then(function () { return { done: true }; });
      });
    }).then(function (res) {
      if (hint) hint.busy = false;
      if (gg !== gen) return res;
      state.repSaving = null;
      /* The hint is used up by the first attempt that reaches a judgment; it waits only while the attempt can't start. */
      if (res.wait) { if (!hint) say(res.wait, 'warn'); render(); return res; }
      var hs = hintsOf(fk); if (hint && hs[gkey] === hint) delete hs[gkey];
      if (res.done) { say(hint ? 'Report accepted. The step is checked with its evidence.' : 'The decision is recorded.', 'good'); load(true); return res; }
      if (!hint && res.why) say(res.why, 'warn');
      render(); return res;
    }, function (e) {
      if (hint) hint.busy = false;
      if (gg !== gen) return { why: e.message };
      state.repSaving = null;
      var hs = hintsOf(fk); if (hint && hs[gkey] === hint) delete hs[gkey];
      say(hint ? 'The step is checked, but the decision on the report couldn\'t be saved: ' + (e && e.message || e) + ' Choose Record the decision to try again.' : 'Couldn\'t record the decision: ' + (e && e.message || e), 'bad');
      render(); return { why: e && e.message };
    });
  }
  /* Decline (with a reason) and Reopen write a decision file only; run.json never changes. */
  function decideOnReport(id, status) {
    var o = repItem(id);
    if (!o.it || state.repSaving) return;
    if (!ctx.recording(o.r)) { say('Only the recorder can decide on a report.', 'warn'); render(); return; }
    if (repHeld(o.it.g)) { say(repHeld(o.it.g), 'warn'); render(); return; }
    var X = PF.reports, g = o.it.g, cur = repCur()[g.key], rid = X.reasonId(g.key), reason = status === 'declined' ? val(rid) : '', rec;
    try { rec = X.decision(g, g.sha256 || (cur ? cur.d.sha256 : ''), status, state.me, new Date().toISOString(), cur ? cur.d : null, { reason: reason }); }
    catch (e) { if (e.field) { var fid = e.field === 'rep-reason' ? rid : e.field; repDrafts()[g.key] = reason; state.fieldErr = { id: fid, msg: e.message }; state.focus = fid; } else say(e.message, 'warn'); render(); return; }
    var dfs = state.fs, gg = gen, fk = fsKey();
    state.repSaving = id; render();
    putDecision(dfs, rec).then(function () {
      if (gg !== gen) return;
      /* This person decided again: an acceptance of theirs still waiting for its decision is superseded (the run's log still
         names it, so it can be recorded later as a choice). */
      var hs = hintsOf(fk); if (hs[g.key] && !hs[g.key].busy) delete hs[g.key];
      if (status === 'declined') { delete repDrafts(fk)[g.key]; repBoxes = repBoxes.filter(function (x) { return x.key !== g.key; }); }
      state.repSaving = null; state.repPick = null; if (state.fieldErr && /^rep-reason-/.test(state.fieldErr.id)) state.fieldErr = null;
      say(status === 'declined' ? 'Report declined. The run shows why.' : 'Reopened. The report isn\'t accepted.', 'good');
      state.focus = 'ins-reps';
      return load(true);
    }, function (e) { if (gg !== gen) return; state.repSaving = null; say('Couldn\'t save the decision: ' + (e && e.message || e), 'bad'); render(); });
  }
  /* A decision vouches for the run as it is in the folder: never while this window holds a change to it that isn't saved. */
  function runUnsaved(r) { return r && (state.unsaved[r.id] || (state.pendingSaves || {})[r.id]) ? 'The run isn\'t saved yet. The decision is recorded once the step is saved.' : ''; }
  /* ...nor while the run couldn't be read: what this window shows of it may not be what the folder holds. */
  function runNotSure(r) { return !r ? 'The run isn\'t in the team folder as this window last read it, so no decision was recorded.' : runUnsaved(r) || repReadOnly(r); }
  /* Record the decision: an acceptance the run logs whose decision isn't in the folder, through the finalizer. */
  function recordAccept(id) {
    var o = repItem(id), r = o.r, u = o.b ? o.b.unrecorded.filter(function (x) { return x.g.key === id; })[0] : null;
    if (!r || !u || !u.recordable || !repCanRecord(r) || state.repSaving) return;
    if (repHeld(u.g) || runNotSure(r)) { say(repHeld(u.g) || runNotSure(r), 'warn'); render(); return; }
    state.repSaving = id; render();
    finalizeAccept(r.process + '/' + r.id, id, { sha: u.sha256, at: u.at, by: u.by }, null);
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
      var res = f ? { kind: 'fresh', run: f } : bad.length ? { kind: 'unreadable', why: bad[0].why } : r._fileHash ? { kind: 'missing' } : null;
      if (res && applyRunRead(key, at, res) && f) { for (var i = 0; i < data.runs.length; i++) if (data.runs[i].process + '/' + data.runs[i].id === key) data.runs[i] = f; }
      return { key: key, g: g };
    });
  }
  /* A fieldset of radios (a typed yes/no or choice) reads as its checked value. */
  function val(id) { var el = document.getElementById(id); return !el ? '' : el.tagName === 'FIELDSET' ? inputValue(el) : el.value; }
  function setInput(el, v) { if (el.tagName !== 'FIELDSET') { el.value = v; return; } el.querySelectorAll('input[type="radio"]').forEach(function (x) { x.checked = x.value === v; }); }
  function inputValue(el) { if (el.tagName !== 'FIELDSET') return el.value; var c = el.querySelector('input:checked'); return c ? c.value : ''; }
  /* The opener is remembered by what it is (its id or action), not as a node, because redraws replace nodes. */
  function selectorOf(el) {
    if (!el || el === document.body) return null;
    if (el.id) return '#' + cssEsc(el.id);
    /* A row's button, inside its row (actAt); one that can't be told apart from another row's goes to its list's heading. */
    var at = actAt(el);
    return !at ? null : at.row ? PF.vk.byId(at.row) + ' ' + at.sel : at.only ? at.sel : listHeadOf(el);
  }
  function openOverlay(o) { childEpoch++; var ae = document.activeElement; o.back = selectorOf(ae); o.backAtt = attOpener(ae); state.overlay = o; render(); }
  /* Closing returns focus to whatever opened it and releases full-size images. */
  function closeOverlay() {
    childEpoch++;
    var back = state.overlay && state.overlay.back, att = state.overlay && state.overlay.backAtt, done = state.overlay && state.overlay.onClose; state.overlay = null; if (done) done(); releaseUrls(state.full); render();
    if (att && att.gen === gen && att.view === state.view && att.run === state.runKey && att.pid === state.processId) { attBack(att); return; }
    var el = back && document.querySelector(back); if (el) el.focus();
  }
  /* An attachment's button (V.attachments) is on one note, and its row can move or go while the overlay is open: a twin arrives
     and the row's key changes, or the note is removed. So the opener is kept by the note it's on and which attachment, not by
     where the row was: t, the note as PF.search.noteKeep holds it; act with i or path, the attachment. */
  function attOpener(el) {
    var t = attTarget(el);
    return t ? { t: t, act: el.dataset.act, i: el.dataset.i, path: el.dataset.path, head: listHeadOf(el), gen: gen, view: state.view, run: state.runKey, pid: state.processId } : null;
  }
  /* That note's attachment button as drawn now, or null. */
  function attButton(b, r, hit) {
    var all = app.querySelectorAll ? Array.prototype.slice.call(app.querySelectorAll('[data-act="' + cssEsc(b.act) + '"][data-note]')) : [];
    return all.filter(function (x) {
      if (x.dataset.i !== b.i || x.dataset.path !== b.path) return false;
      var t = attTarget(x), h = t ? PF.search.noteFind(r._notes || [], t) : null;
      return !!h && h.n === hit.n;
    })[0] || null;
  }
  /* Brings a note's row onto its list, wherever it sorts now: a step's thread or Corrections, Finish, the receipt, or a
     checklist's Corrections (where the row is its group's member). */
  function attReveal(r, hit) {
    var t = keepNote(r.process + '/' + r.id, r._notes || [], hit.n, state.view === 'run' ? state.sel : undefined);
    if (state.view === 'run') { state.noteShown = t; return; }
    if (state.view === 'finish') { ensureListItemVisible('fin-corr:' + r.process + '/' + r.id, hit.key, { note: t, word: 'opened' }); return; }
    if (state.view === 'receipt') { ensureListItemVisible('rcpt-corr:' + r.process + '/' + r.id, hit.key, { note: t, word: 'opened' }); return; }
    if (state.view !== 'process') return;
    ctx.corrections(state.processId).forEach(function (g) {
      var ks = V.fxKeys(g);
      g.members.forEach(function (m, i) { if (m.note === hit.n) ensureListItemVisible('fx:' + state.processId, ks[i], { word: 'opened' }); });
    });
  }
  /* Focus back on the button: on the note's row as it is now, brought onto its list if a newer read moved it off. A note that's
     gone, or can no longer be told from a copy, sends focus to its list's heading, never to another note's button. */
  function attBack(b) {
    var r = ctx.findRun(b.t.run), hit = r ? PF.search.noteFind(r._notes || [], b.t) : null, el = hit ? attButton(b, r, hit) : null;
    if (hit && !el) { attReveal(r, hit); render(); el = attButton(b, r, hit); }
    if (el) { el.focus(); return; }
    state.focus = document.querySelector(b.head) ? b.head : '#page-h'; state.focusWins = true; render();
  }
  /* What Link it's confirm shows (2.9), bound to the child as the app has it now: the folder, the parent run and step, the
     child and its revision, and each team row's value in it. null when the step or the child isn't there. */
  function linkSnap(stepId, c) {
    var r = ctx.run(), x = r && M.findStep(R.mapOf(r), stepId);
    if (!x || !c || !c.parent) return null;
    var values = {}, empty = [];
    PF.links.parse(R.fieldsOf(r, x.step).pass).entries.forEach(function (e) {
      if (e.source !== 'team') return;
      var v = c.details && Object.prototype.hasOwnProperty.call(c.details, e.name) ? String(c.details[e.name] || '') : '';
      values[e.name] = v; if (PF.teamValues.valueProblem(v)) empty.push(e.name);
    });
    var teams = {}; PF.links.parse(R.fieldsOf(r, x.step).pass).entries.forEach(function (e) { if (e.source === 'team') teams[e.name] = e.team; });
    return { gen: gen, key: state.runKey, stepId: stepId, child: c.process + '/' + c.id, title: c.title, rev: c.rev || 0, values: values, teams: teams, empty: empty.length ? empty : null };
  }
  function openLinkConfirm(stepId, c) {
    var snap = linkSnap(stepId, c);
    if (!snap) return;
    openOverlay({ linkConfirm: snap, html: function () { return V.linkConfirm(ctx, this.linkConfirm); } });
    state.overlayFocus = '#lc-t';
  }
  function openLightbox(list, i) { openOverlay({ list: list, i: i || 0, html: function () { return V.lightbox(ctx, this.list, this.i); } }); }
  function copyText(text, pre, done) {
    var msg = document.getElementById('copy-msg');
    function fallback() { if (pre) { pre.hidden = false; var rg = document.createRange(); rg.selectNodeContents(pre); var s = window.getSelection(); s.removeAllRanges(); s.addRange(rg); } if (msg) msg.textContent = 'Selected. Press Ctrl+C.'; }
    var g = gen, view = state.view, key = state.runKey;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { if (g !== gen || state.view !== view || state.runKey !== key) return; if (msg && document.contains(msg)) msg.textContent = done || 'Copied. Paste it into the Jira ticket.'; else { say('Copied.', 'good'); render(); } }, function () { if (g === gen && state.view === view && state.runKey === key) fallback(); });
    else fallback();
  }

  /* New process and step-type forms. Each New process form (opened fresh or submitted) gets a new token: a creation that
     finishes later clears and leaves only the form it came from, never a newer one. */
  var npToken = 0;
  /* New process: the form's values, with the file name made from the title unless one was typed under More options. */
  function newProcForm() {
    var title = val('np-title').trim(), own = val('np-id').trim().toLowerCase(), was = state.newProc || {};
    return { token: ++npToken, tpl: was.tpl || 'blank', id: own || V.fileIdOf(title), ownId: own, title: title, group: val('np-group').trim(), tags: val('np-tags').trim(), context: val('np-context').trim(), roles: val('np-roles').trim(), owner: val('np-owner') || state.me, solo: !!(document.getElementById('np-solo') || {}).checked };
  }
  /* A refused file name opens More options on it, with the reason. */
  function npRefuse(f, msg, box, more) { say(msg, 'warn'); if (more || box === 'np-id') (state.disc = state.disc || {})['np-more'] = true; state.focus = box; render(); }
  /* Run details (key 'context', name or name:kind) or roles typed in the form: each name trimmed, inner spaces made dashes,
     then checked as the builder checks it. A kind and its choice labels are left exactly as typed. */
  function npNames(text, key) {
    var out = [], renamed = [], seen = Object.create(null), mark = key === 'roles' ? '@' : '^';
    var parts = String(text || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (key === 'context' && parts.length > 40) return { error: 'A checklist can have at most 40 run details.' };
    for (var i = 0; i < parts.length; i++) {
      var e = parts[i], at = key === 'context' ? e.indexOf(':') : -1, raw = (at < 0 ? e : e.slice(0, at)).trim(), name = raw.replace(/\s+/g, '-');
      var bad = PF.outline.checkName(name, key); if (bad) return { error: (raw !== name ? '"' + raw + '": ' : '') + bad };
      if (seen[name]) return { error: mark + name + ' is listed twice.' };
      seen[name] = true;
      if (name !== raw) renamed.push([(key === 'roles' ? 'Role ' : 'Run detail ') + raw, name]);
      out.push(at < 0 ? name : name + ':' + e.slice(at + 1).trim());
    }
    return { text: out.join(', '), renamed: renamed };
  }
  function npBase(id) { var t = PF.setup.TEMPLATES.filter(function (x) { return x.id === id; })[0]; return id === 'check-in' ? EXAMPLES['maps/drafts/check-in.md'] : t && t.md; }
  /* The draft's text: the starter, or a template made this process's own (only its front-matter lines change). */
  function newProcMd(f) {
    if (f.tpl === 'blank' || !f.tpl) return V.starterMap(f);
    var base = npBase(f.tpl);
    if (!base) return V.starterMap(f);
    if (!f.solo) base = base.replace(/^runs:[ \t]*solo[ \t]*\r?\n/m, '');
    var set = { process: f.id, title: f.title, owner: f.owner };
    if (f.group) { set.group = f.group; set.category = f.group.split('/').pop().trim() || 'Other'; }
    if (f.tags) set.tags = f.tags; if (f.context) set.context = f.context; if (f.roles) set.roles = f.roles; if (f.solo) set.runs = 'solo';
    return M.withMeta(base, set);
  }
  function createProcess(publish) {
    if (npBusy.gen === gen && state.newProc && state.newProc.token === npBusy.token) return;
    var f = newProcForm();
    /* The form keeps only a file name typed by hand; one made from the title follows the title. */
    state.newProc = Object.assign({}, f, { id: f.ownId, typed: null });
    if (!f.title) return npRefuse(f, 'Give the checklist a title.', 'np-title');
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(f.id)) return npRefuse(f, 'The file name is lowercase letters, numbers and dashes, like release or code-review.', f.ownId ? 'np-id' : 'np-title');
    if (processes().some(function (x) { return x.id === f.id; })) return npRefuse(f, 'There\'s already a checklist called "' + f.id + '". Choose another title, or another file name under More options.', f.ownId ? 'np-id' : 'np-title', true);
    var cx = npNames(f.context, 'context'), rl = npNames(f.roles, 'roles'), bad = cx.error ? ['np-context', cx.error] : rl.error ? ['np-roles', rl.error] : null;
    if (bad) { state.newProc.err = { box: bad[0], msg: bad[1] }; return npRefuse(f, bad[1], bad[0], true); }
    f.context = cx.text; f.roles = rl.text;
    var renamed = cx.renamed.concat(rl.renamed).map(function (x) { return x[0] + ' is ' + x[1] + '.'; }).join(' ');
    var md = newProcMd(f), sfs = state.fs, g = gen, mine = f.token, by = state.me;
    npBusy = { gen: gen, token: mine };
    var done = function () { if (npBusy.token === mine) npBusy = { gen: -1, token: -1 }; };
    queued(function () { return repo.saveDraft(sfs, f.id + '.md', md, null, { lock: LOCKS ? lock : null, expectText: null }); }).then(function (res) {
      if (g !== gen) return;
      if (res.conflict) { say('A draft for "' + f.id + '" appeared in the folder meanwhile. Open it from Checklists.', 'warn'); render(); return; }
      logSave(sfs, fsKey(), { kind: 'draft-edit', id: f.id, from: null, to: res.hash, before: '', after: md, source: 'new', units: ['Created the draft'], items: [] });
      var here = function () { return state.view === 'new-process' && state.newProc && state.newProc.token === mine; };
      /* Open the new draft only if the person is still on the form they submitted; otherwise say where it is. */
      return loadAfterWrite().then(function () {
        if (g !== gen) return;
        if (!here() || !processes().some(function (x) { return x.id === f.id; })) { say('Created the draft for "' + f.title + '". Open it from Checklists.', 'good'); render(); return; }
        if (!publish) {
          setView('process'); state.processId = f.id; state.ptab = 'edit'; dropEditor(f.id); var np = currentProcess(); if (np) openEditor(np); state.newProc = null;
          var msg = 'Draft created. Fill in the steps, choose Save draft, then Review & publish.'; state.focus = 'draft-editor';
          /* A blank one opens ready to type its steps; Practice in the header runs it on the run screen. */
          if (np && (f.tpl === 'blank' || !f.tpl)) {
            var ph0 = PF.outline.parse(edText(np)).phases[0];
            if (state.builder !== false && ph0) { state.obAdd = { pid: np.id, kind: 'step', phase: ph0.key, track: -1 }; state.focus = 'ob-new-text'; msg = 'Draft created. Type a step and press Enter for the next one.'; }
            else msg = 'Draft created. Write its steps here.';
            msg += ' Choose Practice to run it as you go.';
          }
          say(msg + (renamed ? ' ' + renamed : ''), 'good'); render(); window.scrollTo(0, 0); return;
        }
        /* Publish v1 as it is: the same publish setup uses, of exactly the draft just saved. */
        var p = procFind(f.id), people = data.people, wfs = data.jira.workflows, pids = processes().filter(function (x) { return x.latest; }).map(function (x) { return x.id; });
        return queued(function () {
          return repo.loadStepTypes(sfs).then(function (types) { return repo.publish(sfs, md, { people: people, customTypes: types.types, workflows: wfs, processes: pids, by: by, changes: 'First version', existing: p ? p.taken : [], now: new Date().toISOString(), app: APP_VERSION }); });
        }).then(function (pub) {
          if (g !== gen) return;
          if (!here()) { say(pub.blockers ? 'Created the draft for "' + f.title + '", but it can\'t be published yet. Open it from Checklists.' : 'Published ' + f.title + ' v' + pub.version + '. Open it from Checklists.', pub.blockers ? 'warn' : 'good'); render(); return; }
          state.newProc = null; setView('process'); state.processId = f.id; state.ptab = 'overview';
          if (pub.blockers) { say('The draft is saved, but it can\'t be published yet: ' + pub.blockers[0], 'warn'); render(); return; }
          say('Published ' + f.title + ' v' + pub.version + '. Start a run when you\'re ready.', 'good'); state.focus = 'page-h';
          return load(true).then(function () { if (g === gen) { render(); window.scrollTo(0, 0); } });
        });
      });
    }).catch(function (err) { if (g !== gen) return; say('Couldn\'t ' + (publish ? 'publish' : 'create') + ' the draft: ' + err.message, 'bad'); render(); }).then(done, done);
  }
  var npBusy = { gen: -1, token: -1 };
  document.addEventListener('submit', function (e) {
    if (e.target.id === 'type-form') { e.preventDefault(); readTypeForm(); saveType(); return; }
    if (e.target.id !== 'new-process-form') return;
    e.preventDefault();
    createProcess(false);
  });
  /* What the child's start dialog holds: the asked values and the roles. Kept on prep as they're typed, so a redraw (a
     refresh, a new version's notice) puts them back. */
  function csHarvest(form, prep) {
    var asked = {}, roles = {};
    form.querySelectorAll('[data-detail]').forEach(function (el) { if (prep.ask.indexOf(el.dataset.detail) >= 0 || prep.open.indexOf(el.dataset.detail) >= 0) asked[el.dataset.detail] = inputValue(el); });
    form.querySelectorAll('[data-role]').forEach(function (el) { roles[el.dataset.role] = el.value; });
    return { asked: asked, roles: roles };
  }
  ['input', 'change'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var id = (e.target && e.target.id) || '', ov = state.overlay, prep = ov && ov.childStart;
      if (!/^(opt-)?cs-/.test(id) || !prep) return;
      var form = document.getElementById('child-start-form');
      if (form && form.dataset && String(prep.token) !== form.dataset.token) return;
      var got = form && form.querySelectorAll ? csHarvest(form, prep) : { asked: {}, roles: {} };
      prep.values = Object.assign({}, prep.values || {}, got.asked); prep.roleVals = Object.assign({}, prep.roleVals || {}, got.roles);
      /* The box itself, by its ID (cs-<detail>, cs-role-<role>), whatever the form around it can be read for. */
      var rm = /^cs-role-(.+)$/.exec(id), om = /^opt-cs-(.+)-\d+$/.exec(id), d = id.slice(3);
      if (rm) prep.roleVals[rm[1]] = e.target.value;
      /* A choice or yes-no box is a row of radios (opt-cs-<detail>-<n>): the checked one is the answer. */
      else if (om) { if (e.target.checked !== false && (prep.ask.indexOf(om[1]) >= 0 || prep.open.indexOf(om[1]) >= 0)) prep.values[om[1]] = e.target.value; }
      else if (prep.ask.indexOf(d) >= 0 || prep.open.indexOf(d) >= 0) prep.values[d] = inputValue(e.target);
    });
  });
  /* The child's start dialog (2.8): the same prep, still current, with the asked values and roles. */
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'child-start-form') return;
    e.preventDefault();
    var ov = state.overlay, prep = ov && ov.childStart;
    if (!prep || String(prep.token) !== e.target.dataset.token) return;
    var got = csHarvest(e.target, prep), asked = got.asked, roles = got.roles;
    var why = childStale(prep) || teamStale(prep, data.teamValues);
    if (why) { closeOverlay(); prep.epoch = childEpoch; childRetry(prep, why, asked, roles); return; }
    /* A value that doesn't fit keeps the dialog open with everything typed, and says which box. */
    launchChild(prep, asked, roles, function (err) {
      prep.values = asked; prep.roleVals = roles; prep.error = err.message;
      state.overlayFocus = err.field && prep.ask.concat(prep.open).indexOf(err.field) >= 0 ? '#cs-' + cssEsc(err.field) : '#cs-err'; render();
    });
  });
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'start-form') return;
    e.preventDefault();
    var p = procFind(e.target.dataset.process);
    if (p && state.me && e.target.dataset.test === '1') { startTestRun(e.target, p); return; }
    if (!p || !p.latest || !state.me) return;
    var details = {}, roles = {};
    e.target.querySelectorAll('[data-detail]').forEach(function (el) { details[el.dataset.detail] = inputValue(el); });
    e.target.querySelectorAll('[data-role]').forEach(function (el) { roles[el.dataset.role] = el.value; });
    var plan = state.planId && data.plans.filter(function (x) { return x.id === state.planId; })[0];
    /* A plan that isn't there now (gone, or its file can't be read) never becomes an ordinary run. */
    if (state.planId && !plan) { say('This plan isn\'t in the folder as read now, so nothing was started. Check Folder health, then open it again.', 'warn'); render(); return; }
    /* Start exactly what was reviewed: the same published version and, for a plan, the same plan content. Only a plan can start
       an older version (the one it was planned on), and only until the person switches to the latest. */
    var pick = plan ? PF.plans.pick(p, plan, V.planChoice(ctx, plan)) : null, pub = plan ? pick.pub : p.latest;
    if (!pub) { say('This plan\'s version can\'t be used here: ' + pick.ask + '. It won\'t start on another version by itself.', 'warn'); render(); return; }
    if (e.target.dataset.folder !== pub.info.folder) { say(plan ? 'The version this plan starts on changed while you were filling this in. Check the form, then start again.' : 'A new version was published while you were filling this in. Check the form, then start again.', 'warn'); render(); return; }
    if (val('start-mode') === 'solo') pub.map.meta.roles.forEach(function (ro) { roles[ro] = state.me; });
    if (approverMissing(pub, roles)) return;
    /* A decision on the plan that can't be read could say it was started already: nothing starts until it reads. */
    if (plan && planHeld(plan)) { say(planHeld(plan), 'warn'); render(); return; }
    /* A plan whose run is waiting on Try again here is decided: it's never started again. */
    if (plan && Object.prototype.hasOwnProperty.call(state.pendingStarts, plan.id)) { say('This plan is marked started, but ' + PF.vk.unsavedWords(state.pendingStarts[plan.id]) + '. Use Try again to save that run; nothing else starts it.', 'warn'); state.msg.pendingStart = true; render(); return; }
    /* Two different copies of the plan (OneDrive kept both): nothing starts until a person deletes one. */
    if (plan && plan._copiesDiffer) { say('Two different copies of this plan are in the folder. Delete the wrong one, then start it.', 'warn'); render(); return; }
    /* Decisions on the plan started to disagree after this form was drawn: show the warning before anything starts. */
    if (plan && plan._conflicting && e.target.dataset.planConflict !== '1') { say('Someone decided on this plan while you were filling this in, and the decisions disagree. Check Runs, then start again if it still needs to run.', 'warn'); render(); return; }
    if (plan && e.target.dataset.planHash !== plan._sha) { say('Someone changed this plan while you were reviewing it. The form now shows the new plan; check it, then start again.', 'warn'); state.planFormReset = true; render(); return; }
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (err) { tz = ''; }
    /* R.create refuses a version this copy can't fully read; verified versions never get here, but the refusal is shown. */
    /* A plan's details are text: typed ones are migrated from it (PF.run.create), never guessed. */
    var from = plan && plan.details && typeof plan.details === 'object' ? { source: pick.chosen ? 'switch' : 'plan', details: plan.details } : null;
    var r; try { r = R.create(pub, { title: val('run-title') || p.title, details: details, from: from, roles: roles, by: state.me, session: SESSION, now: new Date().toISOString(), tz: tz, workflows: data.jira.workflows, app: APP_VERSION, pins: pinsAtStart(pub) }); }
    catch (err) { if (err.field) state.focus = 'detail-' + err.field; say(err.message, 'warn'); render(); return; }
    var endBusy = busyStart();
    var sfs = state.fs, sg = gen, who = state.me, held = holdNav(false), skey = fsKey(), still = planStill(sg, sfs, skey, who);
    /* The write queue waits for this window's identity check, so the recorder is set to the confirmed identity. */
    /* A plan is started only past the write-time gate (repo.decidePlan): every file of the plan read again now, under the
       plan's lock, whatever this page last read. Its decision, naming the run, is written first and the run then (2.1.1):
       the decision reserves the plan for this one run, so a run that doesn't save can only be saved again, never started
       twice. The exact bytes it tried are kept in this window, by plan (state.pendingStarts), for Try again (repo.resumeStart). */
    var formSha = e.target.dataset.planHash, startFolder = pub.info.folder, dec = null;
    queued(function () {
      r.recorder.session = SESSION;
      var save = function (keep) { return repo.saveRun(sfs, r, SESSION, { writer: WRITER, lock: LOCKS ? lock : null, keep: keep }); };
      if (!plan) return save(false);
      /* Asked when its turn comes, once the plan's lock is held and right before the decision is written: a start whose folder
         or person changed meanwhile, even changed back, writes nothing. Once the decision is written, its run is saved as
         started (a plan marked started without its run is worse), but nothing is opened or announced. */
      if (!still()) return { dropped: true };
      return repo.decidePlan(sfs, plan, { action: 'start', sha: formSha, folder: startFolder, lock: LOCKS ? lock : null, still: still, write: function () {
        return repo.recordPlanStatus(sfs, plan, WRITER, 'accepted', r.id, who, null, APP_VERSION).then(function (path) { dec = path; return save(true); });
      } });
    }).then(function (res) {
      endBusy();
      if (res && res.dropped) { releaseNav(held); say('The plan wasn\'t started. ' + nothingWritten(sg, sfs, skey, who), 'warn'); render(); return null; }
      if (sg !== gen) { releaseNav(held); return null; }
      if (!still()) { releaseNav(held); return load(true).then(function () { return null; }); }
      heldOwn(held, function () { state.planId = null; }); state.planPick = null; state.planDiff = false; return load(true).then(function () { return true; });
    }).then(function (ok) { if (!ok) return; releaseNav(held); if (!still()) { render(); return; } openRun(r.process + '/' + r.id); say(R.solo(r) ? 'Run started.' : 'Run started. You\'re recording.', 'good'); state.msg.quiet = true; render(); },
      function (err) {
        endBusy(); releaseNav(held);
        if (dec && err && err.pending && still()) {
          state.pendingStarts[plan.id] = { plan: plan.id, title: plan.title || plan.id, fs: sfs, key: skey, me: who, process: r.process, id: r.id, path: err.pending.path, text: err.pending.text, certain: err.pending.certain, cand: err.pending.cand, dec: dec };
          say('The plan is marked started, but ' + PF.vk.unsavedWords(err.pending) + ' (' + err.message + '). Try again.', 'bad'); state.msg.pendingStart = true; render(); return;
        }
        if (dec && err && err.pending) { say(aboutWhat(still, sg, sfs, skey, who) + 'The plan is marked started, but ' + PF.vk.unsavedWords(err.pending) + ' (' + err.message + '). The person using this window changed while it was saving, so Try again isn\'t offered here.', 'warn'); render(); return; }
        say(aboutWhat(still, sg, sfs, skey, who) + 'Couldn\'t start the run: ' + err.message, 'bad'); render();
      });
  });

  /* Start a test run (2.1) from its form: the stage and its decisions are read again when it's saved (repo.startTestRun), and
     the run is built only then, after every read, in the name of the person who submitted, if they're still this window's. */
  var testBusy = false;
  function startTestRun(form, p) {
    if (testBusy) return;
    var ts = V.testStage(ctx, p), folder = form.dataset.folder;
    if (!ts.stage || ts.stage.folder !== folder) { say(ts.why || 'The staged version changed while you were filling this in. Check the form, then start again.', 'warn'); render(); return; }
    var details = {}, roles = {};
    form.querySelectorAll('[data-detail]').forEach(function (el) { details[el.dataset.detail] = inputValue(el); });
    form.querySelectorAll('[data-role]').forEach(function (el) { roles[el.dataset.role] = el.value; });
    var title = val('run-title') || p.title, tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (err) { tz = ''; }
    var sfs = state.fs, skey = fsKey(), sg = gen, who = state.me, made = null, still = planStill(sg, sfs, skey, who);
    var mk = function (stage) { return R.create(stage, { test: true, title: title, details: details, roles: roles, by: who, session: SESSION, now: new Date().toISOString(), tz: tz, workflows: data.jira.workflows, app: APP_VERSION, pins: pinsAtStart(stage) }); };
    /* The form's values are checked now, so a typed detail that doesn't read is said before anything is read again. */
    try { mk(ts.stage); } catch (err) { if (err.field) state.focus = 'detail-' + err.field; say(err.message, 'warn'); render(); return; }
    testBusy = true;
    var endBusy = busyStart(), held = holdNav(false), done = function () { testBusy = false; endBusy(); };
    queued(function () {
      return repo.startTestRun(sfs, p.id, folder, { session: SESSION, writer: WRITER, lock: LOCKS ? lock : null,
        still: still, make: function (stage) { made = mk(stage); return made; } });
    }).then(function (res) {
      done(); if (res && res.dropped) { releaseNav(held); say('The test run wasn\'t started. ' + nothingWritten(sg, sfs, skey, who), 'warn'); render(); return null; }
      if (!still()) { releaseNav(held); return load(true).then(function () { return null; }); }
      state.testStage = null;
      return load(true).then(function () { return true; });
    }).then(function (ok) { if (!ok) return; releaseNav(held); if (!still()) { render(); return; } openRun(made.process + '/' + made.id); say('Test run started. It isn\'t counted with the real runs.', 'good'); state.msg.quiet = true; render(); },
      function (err) { done(); releaseNav(held); say(aboutWhat(still, sg, sfs, skey, who) + (err && err.maybeWritten ? 'Flightdeck couldn\'t confirm whether the test run started (' + err.message + '). Check Runs before starting another.' : 'Couldn\'t start the test run: ' + err.message), 'bad'); if (err && err.maybeWritten) load(true).then(render); else render(); });
  }

  /* Getting started's people, and Settings' Add a person. */
  document.addEventListener('submit', function (e) {
    if (e.target.id === 'setup-people-form') { e.preventDefault(); createTeam(); return; }
    if (e.target.id !== 'people-add-form') return;
    e.preventDefault();
    var P = PF.people, add = state.peopleAdd || { name: val('pa-name'), email: val('pa-email') };
    state.fieldErr = null;
    try { P.checkName(add.name); } catch (err) { state.fieldErr = { id: 'setup', field: 'pa-name', msg: err.message }; state.focus = 'pa-name'; render(); return; }
    try { P.checkEmail(add.email); } catch (err) { state.fieldErr = { id: 'setup', field: 'pa-email', msg: err.message }; state.focus = 'pa-email'; render(); return; }
    changePeople('add', null, function (doc) { return P.add(doc, add.name, add.email); }, function (p) { state.peopleAdd = null; state.focus = 'pa-name'; ensureListItemVisible('people', p.id, { word: 'added' }); say('Added ' + p.name + ' as ' + p.id + '. They choose their name when they open the folder.', 'good'); });
  });
  /* Settings' Add a team value and its Edit (2.9). */
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'team-add-form' && e.target.id !== 'team-edit-form') return;
    e.preventDefault();
    var T = PF.teamValues, adding = e.target.id === 'team-add-form', f = adding ? (state.teamAdd || { name: val('tv-name'), value: val('tv-value'), about: val('tv-about') }) : state.teamEdit;
    if (!f) return;
    var pre = adding ? 'tv-' : 'tv-e-', name = String(f.name || '').trim(), entry, sent = adding ? state.teamAdd : f, was = JSON.stringify(sent ? [sent.name, sent.value, sent.about] : null);
    /* A save that finishes later closes its form only if it's still the one submitted, as it was then. */
    var same = function () { var cur = adding ? state.teamAdd : state.teamEdit; return cur === sent && JSON.stringify(cur ? [cur.name, cur.value, cur.about] : null) === was; };
    state.fieldErr = null;
    if (adding) {
      var nerr = !name ? 'Give it a name.' : !T.NAME.test(name) ? 'Use lowercase letters, digits and - (at most 40), starting with a letter or digit.' : '';
      var tv = data.teamValues, has = tv && tv.doc && tv.doc.values && Object.prototype.hasOwnProperty.call(tv.doc.values, name);
      if (!nerr && has) nerr = 'There\'s already a team value named ' + name + '.';
      if (nerr) { state.fieldErr = { id: 'setup', field: 'tv-name', msg: nerr }; state.focus = 'tv-name'; render(); return; }
    }
    try { entry = teamEntryOf(f.value, f.about); } catch (err) { state.fieldErr = { id: 'setup', field: pre + err.field, msg: err.message }; state.focus = pre + err.field; render(); return; }
    changeTeam(function (doc) {
      if (adding && Object.prototype.hasOwnProperty.call(doc.values, name)) throw new Error('There\'s already a team value named ' + name + '.');
      if (!adding && !Object.prototype.hasOwnProperty.call(doc.values, name)) throw new Error('"' + name + '" isn\'t a team value anymore.');
      doc.values[name] = entry; return name;
    }, function () {
      /* The value just saved is focused and brought into view (2.11); team values aren't paged (100 at most), so it's drawn. */
      if (same()) { if (adding) state.teamAdd = null; else state.teamEdit = null; state.focus = PF.vk.byId('tvv-' + name); state.focusWins = true; revealAt(state.focus); }
      say((adding ? 'Added the team value ' : 'Saved the team value ') + name + '.', 'good');
    }, adding ? null : f.base);
  });
  /* The role boxes of the Start, Plan or test-run form being drawn (roleBoxes in process.js): what each held at the last
     redraw (prev), only when that redraw drew this very form in the same place, as renderNow carries a select in 2.10 (the
     screen, run, checklist, folder and folder generation in app.dataset.scope, and the form's data-scope); and what each
     holds now, which the next redraw, a change and Just me read. */
  var carryPrev = null;
  function roleCarry(scope) {
    var key = (app.dataset.scope || '') + '|' + scope, prev = carryPrev && carryPrev.key === key ? carryPrev : null;
    var now = state.roleCarry = { key: key, vals: Object.create(null), touched: Object.create(null) };
    return { prev: prev, now: now };
  }
  /* A role redrawn with its value as the control's own, and one not drawn (a hidden field), are both out of dirtyControl()'s
     sight: one whose value differs from its default as drawn now (data-was) is unsaved work, as 2.10's carried select is. Focus
     goes to the role, or for a hidden one the submit button. */
  function rolesPending() {
    var rb = state.view === 'start' ? state.roleCarry : null; if (!rb) return null;
    var roles = Object.keys(rb.vals);
    for (var i = 0; i < roles.length; i++) {
      var el = document.getElementById('role-' + roles[i]);
      if (!el || !el.getAttribute) continue;
      var was = el.getAttribute('data-was');
      if (was != null && String(el.value == null ? '' : el.value) !== was) return el.type === 'hidden' ? document.getElementById('start-submit') || el : el;
    }
    return null;
  }
  /* The version the Start or Plan form starts: the latest, or the one its plan names. */
  function startFormPub() {
    var p = procFind(state.processId); if (!p || !p.latest) return null;
    var planning = state.planning && state.planning.process === p.id ? state.planning : null;
    var plan = !planning && state.planId ? data.plans.filter(function (x) { return x.id === state.planId; })[0] : null;
    return plan ? PF.plans.pick(p, plan, V.planChoice(ctx, plan)).pub : p.latest;
  }
  /* Which start or plan form is open, as the view names it (its scope and the version it starts): a choice of mode made on
     it applies to it alone when the version has an approval role (2.10). */
  function startFormKey() {
    var p = procFind(state.processId); if (!p || !p.latest) return '';
    var planning = state.planning && state.planning.process === p.id ? state.planning : null;
    var plan = !planning && state.planId ? data.plans.filter(function (x) { return x.id === state.planId; })[0] : null;
    var pub = startFormPub();
    return (planning ? 'plan:' + p.id + ':' + (planning.from || '') : 'start:' + p.id + ':' + (plan ? plan.id : '')) + ':' + (pub ? pub.info.folder : '');
  }
  /* Who approves has to be chosen (2.10): left empty, Start and Save the plan are refused there, and nothing typed is lost. */
  function approverMissing(pub, roles) {
    var gap = V.approvals(pub.map).filter(function (a) { return !roles[a.role]; })[0];
    if (!gap) { if (state.fieldErr && state.fieldErr.id === 'start-approver') state.fieldErr = null; return false; }
    state.fieldErr = { id: 'start-approver', field: 'role-' + gap.role, msg: 'Choose who approves "' + gap.title + '".' };
    state.focus = '#' + cssEsc('role-' + gap.role); say(null); render(); return true;
  }
  /* Save a plan: a new file, never a replacement for one that's there. */
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'plan-form') return;
    e.preventDefault();
    var p = procFind(e.target.dataset.process), planning = state.planning;
    if (!p || !p.latest || !state.me || !planning || planning.process !== p.id) return;
    var pub = p.latest, details = {}, roles = {};
    if (e.target.dataset.folder !== pub.info.folder) { say('A new version was published while you were filling this in. Check the form, then save again.', 'warn'); render(); return; }
    e.target.querySelectorAll('[data-detail]').forEach(function (el) { var v = String(inputValue(el) || '').trim(); if (v) details[el.dataset.detail] = v.slice(0, 120); });
    e.target.querySelectorAll('[data-role]').forEach(function (el) { if (el.value) roles[el.dataset.role] = el.value; });
    if (val('start-mode') === 'solo') pub.map.meta.roles.forEach(function (ro) { roles[ro] = state.me; });
    if (approverMissing(pub, roles)) return;
    var whenText = val('plan-when').trim(), parsed = whenText ? U.localDateTime(whenText) : null, when = parsed && parsed.date;
    if (parsed && parsed.error) { state.fieldErr = { id: 'plan-when', msg: parsed.error === 'gap' ? 'That time doesn\'t exist on that day (clocks change); pick another.' : 'Enter a date and time, or leave it blank.' }; state.focus = 'plan-when'; render(); return; }
    state.fieldErr = null;
    var note = val('plan-note').trim();
    /* A 2.0 version is planned as a plan/2 pinned to its exact folder; a 1.x version keeps the number plan every copy reads. */
    var plan = PF.plans.make(pub, { id: 'plan-' + p.id + '-' + U.randomId(8), process: p.id, title: (val('run-title').trim() || pub.map.meta.title || p.title).slice(0, 100), details: details, roles: roles,
      when: when ? when.toISOString() : null, note: note ? note.slice(0, 300) : null, from: planning.from || null, by: state.me, created: new Date().toISOString() }, false, APP_VERSION);
    /* One save of a plan form at a time: a second click while it saves would write the same plan twice. */
    if (planning.saving) { say('Still saving this plan.', 'warn'); render(); return; }
    planning.saving = true;
    var sfs = state.fs, g = gen, endBusy = busyStart();
    queued(function () { return repo.savePlan(sfs, plan, { lock: LOCKS ? lock : null }); }).then(function (res) {
      endBusy(); planning.saving = false; if (g !== gen) return;
      if (res.conflict) { say(res.afterWrite ? 'Something else wrote the same plan file just now. Check Runs before planning it again.' : 'A plan with the same name is already in the folder, so nothing was saved. Save again.', 'warn'); render(); return; }
      /* A read already under way when the save landed is joined by load() and doesn't have the plan: read again, up to
         three times, until a read started after the save is the one shown, so Just planned has its card to focus. */
      var after = readsStarted, tries = 0;
      var settle = function () { return load(true).then(function () { if (g === gen && (data.readSeq || 0) <= after && ++tries < 3) return settle(); }); };
      return settle().then(function () {
        if (g !== gen) return;
        if (state.planning === planning && state.view === 'start') { state.planning = null; setView('runs'); state.processId = null; state.justPlanned = { id: plan.id, gen: gen }; state.focus = 'card-' + plan.id; state.focusWins = true; window.scrollTo(0, 0); revealAt('#card-' + cssEsc(plan.id)); }
        say('Planned ' + plan.title + '.', 'good'); render();
      });
    }, function (err) { endBusy(); planning.saving = false; if (g !== gen) return; say('Couldn\'t save the plan: ' + err.message, 'bad'); render(); });
  });

  /* Anything typed or chosen on the practice page counts as practice activity (Stage from Practice ends it only if none). */
  function prActivity(t) { uiActs++; var cp = state.view === 'practice' && t && t.id !== 'pr-note' && currentProcess(); if (cp) prTouch(prEntry(cp.id)); }
  /* A box on the practice page whose typing is kept: evidence, Fill in (a radio by its name) and a waiver's reason. */
  function prTypedBox(t) { return state.view === 'practice' && !!t && (/^(opt-)?(rec|fld)-|^pick-input$/.test(t.id || '') || /^(rec|fld)-/.test(t.name || '')); }
  document.addEventListener('change', function (e) { prActivity(e.target); if (prTypedBox(e.target)) prHarvest(); }, true);
  /* The box last typed in on the practice page, kept until focus goes anywhere but Edit or Back to the draft, so a trip
     to the editor can bring focus and its selection back to it. */
  var prLastBox = null;
  document.addEventListener('focusout', function (e) { var t = e.target; if (prTypedBox(t) && /INPUT|TEXTAREA|SELECT/.test(t.tagName || '')) prLastBox = { id: t.id, s: t.selectionStart, e: t.selectionEnd, top: t.scrollTop || 0 }; }, true);
  document.addEventListener('focusin', function (e) { var t = e.target, a = t && t.dataset && t.dataset.act; if (!(a === 'pr-edit' || a === 'pr-back')) prLastBox = null; }, true);
  document.addEventListener('input', function (e) {
    /* A long dropdown's "Show 50 more…" is handled when it changes (below), never as a choice: only on a K.select (any other
       control's "#more" is a value like any other). */
    if (PF.vk.isSelMore(e.target)) return;
    prActivity(e.target);
    if (e.target && e.target.dataset && e.target.dataset.prSample) { var tpx = currentProcess(); if (tpx) { var tpe = prEntry(tpx.id); tpe.typed[e.target.dataset.prSample] = e.target.value; } return; }
    /* What changed, for Stage it for a test run: kept on the practice entry, so a redraw or a reopened phase never loses it. */
    /* Evidence, Fill in and a waiver's reason on the practice page reach this tab's storage as they're typed (a reload keeps them). */
    if (prTypedBox(e.target)) { prHarvest(); return; }
    if (e.target && e.target.id === 'pr-note') { var npx = currentProcess(); if (npx) { var ne = prEntry(npx.id); ne.stageNote = e.target.value; ne.noteErr = null; } return; }
    if (e.target && e.target.id === 'pr-found') { var fpx = currentProcess(); if (fpx) { var fe = prEntry(fpx.id); fe.st = PF.practice.setFound(fe.st, e.target.value).state; prSave(fe); var cm = e.target.closest('.field'); var cnt = cm && cm.querySelector('.small'); if (cnt) cnt.textContent = fe.st.found.length + ' of ' + PF.practice.FOUND_MAX; var cb = document.querySelector('[data-act="pr-copy"]'); if (cb) cb.disabled = !fe.st.found; } return; }
    if (e.target.id === 'rel-search') { state.rel.q = e.target.value; render(); }
    var fl = findList(e.target); if (fl) { selBoxKept(fl); setFind(fl, e.target.value); render(); return; }
    if (e.target.id === 'sx-q' && state.sx) { state.sx.q = String(e.target.value || '').slice(0, 200); state.sx.active = null; state.sx.pos = 0; state.sx.err = ''; sxRun(); render(); }
    if (e.target.id === 'ca-edit' && caOv() && caOv().edit) { caOv().edit.text = e.target.value; caOv().err = null; }
    /* The correction composer keeps what's typed in its state, so the Before/After redline follows the wording as it changes. */
    var ncm = /^nc-(to|why)-(phase|gate)-(.+)$/.exec(e.target.id || ''), ncf = ncm && state.runKey && (state.noteCorrs || {})[ncKey(state.runKey, ncm[2], ncm[3])];
    if (ncf && !ncf.sending) { ncf[ncm[1]] = e.target.value; if (state.fieldErr && state.fieldErr.id === 'nc-' + ncm[2] + '-' + ncm[3]) state.fieldErr = null; }
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
    if (state.obJustAdded && state.obJustAdded.id === e.target.id) state.obJustAdded = null;
    if (e.target.classList && e.target.classList.contains('dbx-in')) dbxTyped(e.target, e);
    if (OB_TYPED.test(e.target.id || '') && state.processId) {
      /* Pending only while the box differs from what the draft says (or, for a new item, holds anything). */
      var differs = boxNorm(e.target.id, e.target.value) !== boxNorm(e.target.id, fieldApplied(e.target.id)), was = !!state.obPending;
      markUnapplied(e.target.id, differs);
      if (differs) { state.obPending = state.processId; state.obPendingField = e.target.id; } else if (state.obPendingField === e.target.id) { dropPending(); obRepend(); }
      if (was !== !!state.obPending) scheduleRender();
    }
    /* Typing in a New process form after Create the draft makes it a newer form: a late creation then leaves it alone. */
    if (/^np-/.test(e.target.id || '') && state.newProc) state.newProc.token = ++npToken;
    /* The file name follows the title as it's typed, drawn beside the box (never into it). */
    if ((e.target.id === 'np-title' || e.target.id === 'np-id') && state.view === 'new-process') {
      var npf = state.newProc = state.newProc || { token: ++npToken }, ty = npf.typed = npf.typed || {};
      ty[e.target.id === 'np-title' ? 'title' : 'id'] = String(e.target.value || '').slice(0, 120); render();
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
    var tvm = /^tv-(e-)?(name|value|about)$/.exec(e.target.id || '');
    if (tvm) {
      if (tvm[1]) { if (state.teamEdit) state.teamEdit[tvm[2]] = String(e.target.value || ''); }
      else (state.teamAdd = state.teamAdd || { name: '', value: '', about: '' })[tvm[2]] = String(e.target.value || '');
      if (state.fieldErr && state.fieldErr.field === e.target.id) { state.fieldErr = null; render(); }
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
  /* A step's field box with focus stays shown; left empty with nothing pending, it waits behind its chip again (next draw). */
  /* A group of chips (require:, sets:) counts as one box: focus anywhere in it is focus in the box. */
  function fieldBoxOf(t) { var g = t && t.closest && t.closest('.ob-grp'); return (g && g.id) || (t && t.id) || ''; }
  document.addEventListener('focusin', function (e) { var id = fieldBoxOf(e.target); if (/^ob-fld-[\w-]+$/.test(id) && state.view === 'process' && state.ptab === 'edit') obShow(id.slice(7), true); }, true);
  /* The note box (2.10) goes back behind + Add instructions the same way, and focus goes to that button if it had nowhere else. */
  document.addEventListener('focusout', function (e) {
    if (!e.target || e.target.id !== 'ob-note' || state.view !== 'process' || state.ptab !== 'edit') return;
    setTimeout(function () {
      var a = document.activeElement, el = document.getElementById('ob-note');
      if ((a && a.id === 'ob-note') || state.obPendingField === 'ob-note' || (el && String(el.value || '').trim()) || String(fieldApplied('ob-note') || '').trim()) return;
      obShow('ob:note', false); if (!a || a === document.body) state.focus = '[data-act="ob-note-open"]'; render();
    }, 0);
  }, true);
  document.addEventListener('focusout', function (e) {
    var id = fieldBoxOf(e.target);
    if (!/^ob-fld-[\w-]+$/.test(id) || state.view !== 'process' || state.ptab !== 'edit') return;
    setTimeout(function () {
      var a = document.activeElement, el = document.getElementById(id);
      if ((a && (a.id === id || fieldBoxOf(a) === id)) || state.obPendingField === id || (el && el.tagName !== 'BUTTON' && String(el.value || '').trim()) || String(fieldApplied(id) || '')) return;
      obShow(id.slice(7), false);
    }, 0);
  }, true);
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
    prActivity(d);
    if (d.dataset.group) (state.groupsOpen = state.groupsOpen || Object.create(null))[d.dataset.group] = d.open;
    /* More options (2.10): one setting for the whole editor, kept in this browser; it can't close over typing not applied. */
    if (d.dataset.disc === 'ob-more') {
      /* Drawn open over typing not applied: not the person's choice, so it isn't kept (a browser fires toggle for that too). */
      if (d.dataset.busy) { if (!d.open) { d.open = true; say('Apply or clear what you typed under More options first.', 'warn'); render(); } return; }
      if (!!state.obMore !== !!d.open) { state.obMore = !!d.open; lsSet('obMore', state.obMore); }
      return;
    }
    if (d.dataset.disc) (state.disc = state.disc || {})[d.dataset.disc] = d.open;
    /* A flight plan phase opened or closed by hand. Only a change from what the page drew counts: a browser also fires
       toggle for a disclosure drawn open. */
    if (d.dataset.fps != null && state.processId && /^\d{1,3}$/.test(d.dataset.fps) && !!d.open !== (d.dataset.fpsOpen === '1')) {
      var was = (state.fpSteps || {})[state.processId] || {}, o = { p: Object.assign({}, was.p) };
      if (typeof was.d === 'boolean') o.d = was.d;
      o.p[d.dataset.fps] = !!d.open;
      fpStepsKeep(state.processId, o); render();
    }
  }, true);
  document.addEventListener('change', function (e) {
    /* A long dropdown's "Show 50 more…" (K.select): the list widens and the choice stays what it was; nothing else hears it. */
    if (PF.vk.isSelMore(e.target)) { e.target.value = (e.target.dataset && e.target.dataset.cur) || ''; selMore(e.target.id, e.target.dataset && e.target.dataset.step); return; }
    /* A role given someone on Start or Plan (2.11) stays drawn through Show more, Find and a refresh, for this form only. */
    var rm = state.view === 'start' && e.target && /^role-(.+)$/.exec(e.target.id || '');
    /* A test run's form is its own form: its key is its scope (test:<process>:<stage>). */
    var rc = rm ? state.roleCarry : null;
    if (rc && Object.prototype.hasOwnProperty.call(rc.vals, rm[1])) { rc.vals[rm[1]] = String(e.target.value == null ? '' : e.target.value); rc.touched[rm[1]] = true; }
    /* A practice sample is one practice action when it's committed (Enter or leaving the box). */
    var smp = e.target && e.target.dataset && e.target.dataset.prSample;
    if (smp) {
      var spx = currentProcess(); if (!spx) return;
      var se = prEntry(spx.id), sv = e.target.value;
      se.typed[smp] = sv;
      var ran = false;
      prDo(spx.id, 'Sample ' + smp, function (st, map) { ran = true; delete se.typed[smp]; var r = PF.practice.setSample(st, map, smp, sv, prEnv()); if (r.error) se.sampleErr[smp] = { msg: r.error, value: sv }; else delete se.sampleErr[smp]; return r.error ? { state: st } : r; }, '#pr-s-' + cssEsc(smp));
      if (se.sampleErr[smp]) { state.focus = '#pr-s-' + cssEsc(smp); render(); }
      return;
    }
    if (e.target.id === 'rel-area') { state.rel.area = e.target.value; render(); }
    if (e.target.id === 'ins-folder' && state.processId) { state.insFolder[state.processId] = e.target.value; state.more = Object.assign({}, state.more, { 'ins-hot': 0, 'ins-dur': 0, 'ins-ph': 0, 'ins-rot': 0, 'ins-rolecols': 0, 'ins-notes': 0 }); render(); }
    if (/^rf-(process|folder|outcome|from|through)$/.test(e.target.id || '')) {
      var rf = state.runFilter && !state.runFilter.cohort ? Object.assign({}, state.runFilter) : {}, rk = e.target.id.slice(3);
      if (e.target.value) rf[rk] = String(e.target.value).slice(0, 120); else delete rf[rk];
      if (rk === 'process') delete rf.folder;
      state.runFilter = rf; state.more = Object.assign({}, state.more, { 'runs-filtered': 0 }); render();
    }
    if (e.target.id === 'map-ver') { state.mapVer = e.target.value === 'draft' ? null : e.target.value; state.pick = null; render(); }
    if (/^tf-/.test(e.target.id || '') && state.typeForm) { typeFormInput(e, false); render(); }
    if (e.target.id) delete dbxSet[e.target.id];
    if (OB_CHANGE.test(e.target.id || '') && state.view === 'process' && state.ptab === 'edit') builderField(e.target.id, e.target.value);
    if (e.target.id === 'ob-shot-file' && state.view === 'process' && state.ptab === 'edit') { shotAdd(e.target.files); e.target.value = ''; }
    /* 2.10: Must be done and Automation planned are two checkboxes over the step's one mark; checking one clears the other. */
    if ((e.target.id === 'ob-must' || e.target.id === 'ob-planned') && state.view === 'process' && state.ptab === 'edit') { state.obMarkFrom = e.target.id; builderField('ob-mark', e.target.checked ? e.target.id.slice(3) : 'step'); state.obMarkFrom = null; }
    if (/^ob-link-(proc|proc-other|vn|src-[\w-]+|val-[\w-]+)$/.test(e.target.id || '') && state.view === 'process' && state.ptab === 'edit') builderField(e.target.id, e.target.value);
    if (/^ob-link-ver-(latest|pin)$/.test(e.target.id || '') && e.target.checked && state.view === 'process' && state.ptab === 'edit') builderField('ob-link-ver', e.target.value);
    if (/^np-/.test(e.target.id || '') && state.newProc) state.newProc.token = ++npToken;
    if (e.target.id === 'me') { state.me = e.target.value.trim().slice(0, 60); lsSet('me', state.me); forgetStartIfNotMine(); render(); }
    if (e.target.id === 'su-backup' && state.setup) { state.setup.backup = e.target.value; render(); }
    if (e.target.id === 'su-to' && state.setup) { state.setup.to = e.target.value; render(); }
    /* In Fill in, changing a choice (like a Jira action) redraws the form so the fields that choice needs appear. */
    if (/^fld-/.test(e.target.id || '') && state.pick && state.pick.kind === 'fields') {
      var vals = {}; document.querySelectorAll('[id^="fld-"]').forEach(function (el) { vals[el.id.slice(4)] = el.value; });
      vals[e.target.id.slice(4)] = e.target.value;
      state.fieldsDraft = { fs: fsKey(), key: draftScope(), id: state.pick.id, values: vals };
      /* The step's draft holds the same choices, so the action shown and the fields drawn for it always agree. */
      var sd = draftOf(draftScope(), state.pick.id, true); Object.keys(vals).forEach(function (k) { sd.fields['fld-' + k] = vals[k]; });
      render();
    }
    if (e.target.id === 'note-file') { addFiles(e.target.files, state.sel); e.target.value = ''; }
    if (e.target.id === 'me-run') { state.me = String(e.target.value || '').trim().slice(0, 60); lsSet('me', state.me); forgetStartIfNotMine(); render(); }
    if (e.target.id === 'rw-phase' && e.target.value) ACTIONS.goto('phase-' + e.target.value);
    /* Moved to's choice is remembered with the form (2.11), so it's drawn whatever Find shows and after a newer read. */
    if (state.fuPick && state.fuPick.status === 'moved' && e.target.id === PF.followups.formId(state.fuPick.key) + '-to') {
      var tv = String(e.target.value || ''), tp = /^plan:(.+)$/.exec(tv), tr = tp ? null : ctx.findRun(tv), tpl = tp ? data.plans.filter(function (q) { return q.id === tp[1]; })[0] : null;
      state.fuPick.to = tv ? { v: tv, t: tr ? tr.title : tpl ? tpl.title : tv } : null; render();
    }
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
  /* What an attachment button carries (V.attachments): the page drew it, so it's only compared with the notes read. */
  function attTarget(b) {
    var t = null;
    try { t = JSON.parse((b && b.dataset && b.dataset.note) || 'null'); } catch (e) { return null; }
    return t;
  }
  /* The note an attachment button is on: the run and note it carries (V.attachments), found as any kept note is. None if that
     note is gone, or can't be told from a copy any more; never another in its place. */
  function attNote(b) {
    var t = attTarget(b), r = t && ctx.findRun(t.run), hit = r ? PF.search.noteFind(r._notes || [], t) : null;
    return hit ? hit.n : null;
  }
  /* The note or suggestion a file button belongs to, and only if the file is one of its own. */
  function attOwner(b) { var it = attNote(b); return it && (it.files || []).indexOf(b.dataset.path) >= 0 ? it : null; }
  function noteStepText(id) { var r = ctx.run(), x = r && M.findStep(R.mapOf(r), id); return x ? M.shownText(x.step, M.valuesOf(r)) : id; }
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
  /* Whose drafts the boxes on screen are: the open run's, or (on the practice page) the practice's. */
  function draftScope() { return state.view === 'run' ? state.runKey : state.view === 'practice' && state.processId ? prKey(state.processId) : null; }
  function harvest() {
    if (!drawn || !draftScope() || drawn.key !== draftScope()) return;
    var d = draftOf(drawn.key, drawn.sel, true, drawn.fs), part = d[drawn.kind];
    drawn.ids.forEach(function (id) {
      var el = document.getElementById(id); if (!el || drawn.skip[id === 'note-text' ? 'note' : 'box']) return;
      /* Back at what was drawn: only a draft it already has follows it (typed, then erased, is erased). */
      if (inputValue(el) === baseOf(id)) { if (id === 'note-text') { if (d.note != null && d.note !== '') d.note = el.value; } else if (Object.prototype.hasOwnProperty.call(part, id)) part[id] = inputValue(el); return; }
      if (id === 'note-text') { d.note = el.value; return; }
      /* A box emptied on purpose is a draft too: it stays empty when the step comes back. */
      part[id] = inputValue(el);
    });
    if (!hasDraft(d)) delete state.stepDrafts[draftKey(drawn.key, drawn.sel, drawn.fs)];
  }
  function noteDrawn(html) {
    var sel = V.runSel(ctx), ids = [], m, re = /id="((?:rec|fld)-[\w-]+|note-text)"/g;
    if (!draftScope() || !sel) { drawn = null; return; }
    var base = {};
    while ((m = re.exec(html))) {
      var id = m[1], at = m.index, tag = html.lastIndexOf('<', at), name = html.slice(tag + 1, tag + 9), v = '';
      if (/^textarea/.test(name)) { var o = html.indexOf('>', at) + 1; v = html.slice(o, html.indexOf('</textarea>', o)); }
      else if (/^fieldset/.test(name)) { var fh = html.slice(at, html.indexOf('</fieldset>', at)), fo = /<input[^>]*\svalue="([^"]*)"[^>]*\schecked/.exec(fh); v = fo ? fo[1] : ''; }
      else if (/^select/.test(name)) { var sh = html.slice(at, html.indexOf('</select>', at)), so = /<option[^>]*\sselected[^>]*>([^<]*)/.exec(sh); v = so ? so[1] : ''; }
      else { var tg = html.slice(at, html.indexOf('>', at)), vm2 = /\svalue="([^"]*)"/.exec(tg); v = vm2 ? vm2[1] : ''; }
      ids.push(id); base[id] = unesc(v);
    }
    drawn = { fs: fsKey(), key: draftScope(), sel: sel, kind: state.pick && state.pick.kind === 'fields' && state.pick.id === sel ? 'fields' : 'record', ids: ids, base: base, skip: {} };
  }
  /* After a redraw the boxes show their step's draft, else what was drawn. On a new step or form every box is set, since a
     redraw can keep an old node (same markup) that still holds another step's typing; on the same one, typing stays. */
  function restoreDrafts(changed) {
    if (!drawn) return;
    var d = draftOf(drawn.key, drawn.sel, false);
    drawn.ids.forEach(function (id) {
      var el = document.getElementById(id), mine = d ? (id === 'note-text' ? d.note || null : Object.prototype.hasOwnProperty.call(d[drawn.kind], id) ? d[drawn.kind][id] : null) : null, want = mine != null ? mine : baseOf(id);
      if (!el || inputValue(el) === want) return;
      if (changed || (mine && !inputValue(el))) setInput(el, want);
    });
  }
  /* Every change of screen goes through here: what's typed on the run's selected step is kept first. */
  function setView(v) { childEpoch++; if (v !== 'runs') state.justPlanned = null; if (state.view === 'start' && v !== 'start') { state.startModeAt = Object.create(null); state.roleCarry = null; } if (state.view === 'practice' && v !== 'practice') prLeave(); leaveContext(); state.view = v; }
  /* Leaving the practice page (any way: Edit, Back, a link): what's typed is kept, and where it was, for coming back. */
  function prLeave() {
    prHarvest(); var p = currentProcess(), e = p && prs[edKey(p.id)];
    /* Done practicing or browser Back: the builder shows the step being practiced, so coming back lands there. */
    if (e && !e.trip) { prTripOut(e); var key = state.sel && state.builder !== false ? prBuilderKey(p, state.sel) : ''; if (key) { state.obSel = { pid: p.id, kind: 'step', key: key }; prTarget(p, 'step', key); } }
  }
  /* A number in How runs go opens the runs behind it on the Runs page, as they are now; the cohort is kept, not re-asked
     (PF.insights.spec), and Back returns to the version and the place on the page. */
  function insightRuns(path) {
    var pid = state.processId, p = currentProcess(); if (!p) return;
    var list = V.insightsFolders(ctx, p), folder = V.insightsChosen(ctx, p, list); if (!folder) return;
    var sp = PF.insights.spec(V.insightsOf(ctx, pid, folder, false), path, data.runs); if (!sp) return;
    var back = { process: pid, folder: folder, scrollY: window.scrollY || window.pageYOffset || 0, focus: '[data-act="ins-runs"][data-id="' + cssEsc(path) + '"]' };
    /* The row the count is in, when it's in a paged list (2.11): Back draws it whatever the page. */
    var pm = /^step:([^:]+):/.exec(path) || null, ph = /^(?:phase|gate):([^:]+)/.exec(path) || null;
    if (pm) { back.list = 'ins-hot'; back.key = 'ins-' + pm[1]; back.head = 'ins-hot-h'; }
    else if (ph) { back.list = 'ins-ph'; back.key = 'ins-ph-' + ph[1]; back.head = 'ins-ph-h'; }
    /* And how far that list was shown, so the page is as long as it was and the scroll comes back to the same place. */
    if (back.list) back.more = (state.more || {})[back.list] || 0;
    if (!go({ view: 'runs' })) return;
    state.runFilter = Object.assign(sp, { cohort: true, back: back }); state.more = Object.assign({}, state.more, { 'runs-cohort': 0 });
    state.focus = 'rf-h'; render(); window.scrollTo(0, 0);
  }
  /* Go straight to something: { view, process, ptab, mapVer, run, step, note, filter }. It goes through setView, so typed
     evidence, an open Fill in and an unsent note are kept as drafts and come back. It refuses rather than lose input: text
     typed in a builder box and not applied, a correction or follow-up decision with text in it, or a dialog that isn't
     read-only (that one is never replaced; focus goes back to it). A read-only dialog is closed first, and so is a phone's
     step sheet. Returns whether it went. */
  function go(t) {
    t = t || {};
    var dirty = pendingBox();
    if (!dirty && state.overlay && state.overlay.held && state.overlay.held()) { say('Finish or cancel this first.', 'warn'); render(); focusOverlay(); return false; }
    if (dirty) {
      say(/^ob-/.test(dirty.id || '') ? 'Apply or clear what you typed in the box first ' + applyHint(dirty.id) + ', then go there.' : 'Finish or cancel this first.', 'warn');
      holdAt(state.processId, dirty.id);
      state.focus = dirty.id ? '#' + cssEsc(dirty.id) : null; render(); return false;
    }
    if (state.overlay) closeOverlay();
    if (narrow() && state.refOpen && state.view === 'run') state.refOpen = false;
    if (t.view === 'run') {
      if (!t.run || !ctx.findRun(t.run)) return false;
      /* A correction, fix or map note (2.11): on a step, its row in the inspector's Corrections, kept past the page; on a phase
         or a gate, its group on the checklist's page. */
      /* A note is found by its id and its whole content (2.11): of notes sharing an id, only the one the target names is
         chosen, never another in its place (PF.search.noteFind). */
      var tr = ctx.findRun(t.run), hasNote = typeof t.note === 'string', hit = hasNote ? PF.search.noteFind(tr._notes || [], t) : null;
      var cn = hit && (hit.n.kind === 'correction' || hit.n.kind === 'fix' || hit.n.kind === 'map') ? hit.n : null;
      if (cn && !t.step) { var cg = corrGroupOf(tr, cn); if (cg) return go({ view: 'process', process: tr.process, group: cg }); }
      if (t.run !== state.runKey || !inRun()) openRun(t.run); else setView('run');
      var r = ctx.run(), x = t.step ? M.findStep(R.mapOf(r), t.step) : null;
      if (x && cn) {
        state.unfold[x.phase.id] = true; selectStep(x.step.id); state.refOpen = true;
        /* Kept in the step's Corrections by its identity (state.noteShown), so a newer read can't put another in its place. */
        state.noteShown = keepNote(t.run, tr._notes, cn, x.step.id);
        var csel = PF.vk.byId(V.corrDomId(cn.id, hit.k)); state.focus = csel; state.focusWins = true; revealAt(csel, true); sheetFor = csel;
      } else if (x) {
        state.unfold[x.phase.id] = true; selectStep(x.step.id); state.refOpen = !narrow() || hasNote;
        /* A note: drawn in its step's thread whatever the page, focused and brought into view; on a phone the inspector
           sheet opens on it. A note that's gone leaves the step selected and the thread says so. */
        var nsel = hit ? PF.vk.byId(V.noteDomId(x.step.id, hit.key)) : null;
        /* A note that's gone is still asked for by the hit's identity, so the thread says it's gone. */
        if (hasNote) state.noteShown = hit ? keepNote(t.run, tr._notes, hit.n, x.step.id) : { gen: gen, run: t.run, step: x.step.id, note: t.note, anchor: t.anchor, same: t.same, rank: t.rank };
        if (nsel) { state.focus = nsel; state.focusWins = true; revealAt(nsel, true); sheetFor = nsel; }
        else { state.focus = '[data-act="select"][data-id="' + cssEsc(x.step.id) + '"]'; revealAt('#step-' + cssEsc(x.step.id)); }
        /* The note flashes by what it is, its key worked out at each draw. */
        var mark = state.flash = { ids: [x.step.id], note: hit ? keepNote(t.run, tr._notes, hit.n, x.step.id) : null };
        setTimeout(function () { if (state.flash === mark) { state.flash = null; scheduleRender(); } }, 1800);
      }
      render(); return true;
    }
    if (t.view === 'process') {
      if (!t.process) return false;
      ACTIONS['open-process'](t.process);
      if (t.mapVer) ACTIONS['view-version'](t.mapVer);
      if (t.ptab && t.ptab !== 'overview') ACTIONS.ptab(t.ptab);
      /* A correction's group (2.11): Corrections unfolded, the group drawn whatever the page and Open/All, and focused. */
      if (t.group && corrShow(t.process, t.group)) { (state.disc = state.disc || {})['fx:' + t.process] = true; render(); }
      /* A step opens in the checklist, at that step, with focus on it. */
      if (t.step) {
        var sid = 'cl-st-' + t.step;
        state.clView = 'list'; state.focus = sid; render();
        var el = document.getElementById(sid);
        if (el) { if (el.scrollIntoView) el.scrollIntoView({ block: 'center' }); if (document.activeElement !== el) el.focus({ preventScroll: true }); }
      }
      return true;
    }
    if (t.view === 'skill') { if (!t.skill) return false; ACTIONS['open-skill'](t.skill); return true; }
    if (t.view === 'health' || t.view === 'connection' || t.view === 'recovery') { ACTIONS[t.view](t.section); return true; }
    if (t.view === 'runs' && (t.filter === 'mine' || t.filter === 'all')) state.filter = t.filter;
    ACTIONS.nav(t.view || 'home');
    return true;
  }
  /* A correction group shown on its checklist's page whatever the page or Open/All (2.11): drawn as Process › Corrections'
     just-shown item, focused and brought into view. false when the group isn't there. */
  function corrShow(pid, gid) {
    var g = gid ? ctx.corrections(pid).filter(function (x) { return x.id === gid; })[0] : null;
    if (!g) return false;
    (state.disc = state.disc || {})['fx:' + pid] = true;
    ensureListItemVisible('fx:' + pid, V.fxKeys(g)[0], { focus: PF.vk.byId('fxg-' + g.id), word: 'opened' });
    return true;
  }
  /* The group on a run's checklist a correction note is in: the one whose member is this very note, matched on everything the
     note says (2.11), its target included, so twins on a phase and a gate never open each other's group. A note no group holds,
     or one that two groups could hold, opens none (as PF.search.noteFind chooses nothing rather than guess). */
  function corrGroupOf(r, n) {
    var A = PF.search.noteAnchor, same = function (a, b) { return A(a == null ? null : a) === A(b == null ? null : b); };
    var text = String(n.text || ''), fixT = n.kind === 'fix' && n.target ? n.target : null;
    var isIt = function (m) {
      /* A member keeps the note it was read from (m.note): it is this note when their whole content is the same, every field,
         from and base among them, as noteFind and V.memberKeys tell twins apart. */
      if (m.note) return m.run === r.id && m.id === n.id && (m.note === n || PF.search.noteAnchor(m.note) === PF.search.noteAnchor(n));
      if (m.id !== n.id || m.run !== r.id || m.at !== n.at || m.by !== n.by || !same(m.files || [], n.files || [])) return false;
      if (n.kind === 'correction') return !m.legacy && !!m.newer === !!n.newer && same(m.target, n.target) && same(m.change, n.change) &&
        m.why === (n.newer ? n.text || n.why || '' : n.why || '') && (m.happened || '') === (n.happened || '');
      var why = String(m.why || '');
      return m.legacy === n.kind && (m.fixKind || '') === (n.kind === 'fix' ? n.fixKind || '' : '') && why.slice(why.length - text.length) === text &&
        (m.target && m.target.step || null) === ((fixT ? fixT.step : n.step) || null) && (!fixT || !fixT.phase || (m.target && m.target.phase) === fixT.phase);
    };
    var gs = ctx.corrections(r.process).filter(function (g) { return g.members.some(isIt); });
    return gs.length === 1 ? gs[0].id : null;
  }
  /* What go() would lose: the first control on the page or in the open dialog whose value isn't what the page drew
     (input and textarea: value vs defaultValue; checkbox and radio: checked vs defaultChecked; select: the chosen option vs
     the one drawn as chosen, or the first). The page itself is the record, so a new form is covered without being listed.
     Input held in app state isn't this check's job: navigation keeps it (resetRunUi, corrDrafts, newProc), and a dialog
     holding choices says so with held(). Skipped: controls kept as drafts (data-draft-kept: the note, evidence,
     Fill in, the draft editor and the step-type form), boxes that are safe to leave (type="search", data-nav-safe), and
     hidden or file inputs. */
  function changedControl(el) {
    if (el.type === 'checkbox' || el.type === 'radio') return !!el.checked !== !!el.defaultChecked;
    if (el.tagName === 'SELECT' && el.options && el.options.length) {
      if (el.multiple) return Array.prototype.some.call(el.options, function (o) { return o.selected !== o.defaultSelected; });
      var d = 0; for (var i = 0; i < el.options.length; i++) if (el.options[i].defaultSelected) { d = i; break; }
      return el.selectedIndex !== d;
    }
    return String(el.value == null ? '' : el.value) !== String(el.defaultValue == null ? '' : el.defaultValue);
  }
  function dirtyControl(only) {
    var roots = only || (state.overlay ? [app, overlayEl] : [app]);
    for (var r = 0; r < roots.length; r++) {
      var list = roots[r].querySelectorAll ? roots[r].querySelectorAll('input, textarea, select') : [];
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (/^(hidden|file|button|submit|reset|search)$/.test(el.type || '')) continue;
        if (el.closest && el.closest('[data-draft-kept], [data-nav-safe]')) continue;
        if (changedControl(el)) return el;
      }
    }
    return null;
  }
  function focusOverlay() {
    var el = overlayEl && overlayEl.querySelector && overlayEl.querySelector('input, textarea, select, button');
    if (el && el.focus) el.focus();
  }
  /* One way to select a step, for the mouse and the keyboard alike. An open Fill in is remembered with its step. */
  /* After a gate passes (2.3.1): go where Next up now points. A step: select it (kept typing and forms go with the step
     being left) and focus its check; a phase whose steps are all held: its heading, selecting nothing; another gate: its
     button; the end: Finish (practice: its completion line). Typing on the selected step keeps the selection where it is. */
  function afterPass(nx, map, practice) {
    var pp = practice ? prNow() : null, dk = practice ? (pp ? prKey(pp.id) : null) : state.runKey;
    var keep = !!state.sel && ((dk && hasDraft(draftOf(dk, state.sel, false))) || (state.pick && state.pick.kind === 'fields' && state.pick.id === state.sel) || (!practice && state.corrForm && state.corrForm.key === state.runKey && state.corrForm.step === state.sel));
    if (nx.kind === 'step' && nx.step) {
      var id = nx.step.id || nx.step;
      if (keep) { state.focus = 'ph-' + map.phases[nx.phaseIndex].id; return; }
      if (practice) prPickStep(id); else selectStep(id);
      /* A step that starts a child run has no check to focus; its title in the inspector takes it, as after an answer. */
      var child = nx.step.type === 'run.process';
      state.focus = (narrow() && state.refOpen) || child ? 'ins-h' : '[data-act="toggle"][data-id="' + cssEsc(id) + '"]';
      if (child) state.refOpen = true;
    } else if (nx.kind === 'step' && map.phases[nx.phaseIndex]) state.focus = 'ph-' + map.phases[nx.phaseIndex].id;
    else if (nx.kind === 'gate' && nx.gate) state.focus = '#gate-' + cssEsc(nx.gate.id || nx.gate) + ' .btn.go';
    else if (nx.kind === 'complete') state.focus = practice ? '.pr-done' : '[data-act="finish"]';
  }
  function selectStep(id) {
    if (state.sel !== id) {
      childEpoch++;
      state.attErr = null;
      /* The step being left keeps its typing, its open Fill in and its correction; the new one gets back its own. */
      leaveContext();
    }
    state.sel = id; if (state.pick && state.pick.id !== id) { state.pick = null; state.fieldsDraft = null; }
    arriveAtStep(id);
  }
  /* Arriving at a step (selecting it, opening the run, coming back to it): its kept correction, and a Fill in it had open,
     with its values. */
  function arriveAtStep(id) {
    enterContext();
    var dk = draftScope(), d = id && dk && draftOf(dk, id, false);
    if (d && d.open && !state.pick) { state.pick = { kind: 'fields', id: id, back: '[data-act="pick"][data-kind="fields"][data-id="' + cssEsc(id) + '"]' }; state.fieldsDraft = d.fd && d.fd.key === dk && d.fd.fs === fsKey() ? d.fd : null; }
  }
  function nextStepId(r, map) { var nx = R.nextUp(r, map, state.me); return nx.kind === 'step' && nx.step ? nx.step.id : null; }
  /* Whether a step can be answered now, and with what: its own draft's evidence, else what's saved, else what the box would
     show. An open or unsaved Fill in on it is saved or canceled first. Returns { r, map, x, values } or { why, focus, field }. */
  /* The Jira problem a step's Fill in can fix ({ why, field }), or null: no issue type the team's workflows know, or no status
     with a transition into it. A workflow file that can't be read or is invalid isn't something Fill in fixes. */
  function jiraFill(r, step, fields) {
    var f = fields || R.fieldsOf(r, step), why = R.jiraProblem(r, step, f);
    if (!why || PF.jira.fileProblem(r.jira)) return null;
    var w = PF.jira.forType(r.jira, f.issueType);
    if (!w) return { why: why, field: 'issueType' };
    return w.workflow.invalid ? null : { why: why, field: 'status' };
  }
  V.jiraFill = jiraFill;
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
      var seen; try { seen = skillSeen(r, x.step); } catch (e) { return { why: e.message, focus: '[data-act="refresh"]' }; }
      if (seen) values._skill = seen;
      /* A value only Fill in holds (a Jira issue type or status): Fill in opens on that box instead of a refusal up top. */
      var jf = jiraFill(r, x.step);
      if (jf) return { why: jf.why, open: 'fields', focus: 'fld-' + jf.field };
    }
    return { r: r, map: map, x: x, values: values };
  }
  /* A skill step in a run/3 records the registration as it is when the step is checked (pinned-skills), however it's checked:
     Done, or accepting a report. null when there's nothing to record. */
  function skillSeen(r, step) {
    if (step.type !== 'run.skill' || r.format !== R.FORMAT3) return null;
    /* When the skills couldn't be read this time, the list shown is the one read before: never evidence of what's current now. */
    if ((data.failed && data.failed.skills) || (data.skills && (data.skills.unlisted || data.skills.regsUnlisted))) throw new Error('The team folder\'s skills couldn\'t be read just now, so this step can\'t record which registration is current. Choose Try again above, then check it again.');
    var sname = R.fieldsOf(r, step).skill, vs = data.skills && data.skills.verdicts, vd = vs && typeof sname === 'string' && Object.prototype.hasOwnProperty.call(vs, sname) ? vs[sname] : null;
    /* A registration that's there but couldn't be read or listed is never recorded as none. */
    if (vd && vd.kinds.some(function (k) { return k === 'legacy-unreadable' || k === 'revisions-unlisted' || k === 'revision-refused'; })) throw new Error('A registration of ' + sname + ' couldn\'t be read, so this step can\'t record which one is current. See Folder health, then check it again.');
    var reg = (data.skills || []).filter(function (k) { return k.skill && k.skill.name === sname && k.skill.regId && !k.unmatched; })[0];
    return reg ? PF.skills.observed(reg.skill) : null;
  }
  /* The one way to answer a step, Done or Done differently, from every place that does it (row check, inspector Done, Space
     and X, the Done differently composer and Mark it now). It works on that step only, with answerCheck's values, and only
     its own forms close. o: { how: 'done' | 'differently', happened, at, quiet (no selection or messages: the person may be
     elsewhere) }. Resolves true only when the answer is saved in the team folder: a refused or failed save resolves false, and
     its own message (the conflict, or the unsaved change with Try again) says what happened. */
  function answerStep(key, id, o) {
    var g = gen, here = state.view === 'run' && state.runKey === key, quiet = !!o.quiet || !here, c = o.how === 'report' ? reportCheck(key, id, o.report) : answerCheck(key, id), intent = null;
    if (!c.r) {
      if (quiet || !c.why) return Promise.resolve(false);
      selectStep(id); state.refOpen = true;
      if (c.open === 'fields') {
        /* Fill in opens on the box that needs the value; the reason shows beside it and is announced once. */
        leaveFillIn(); state.pick = { kind: 'fields', id: id, back: '[data-act="pick"][data-kind="fields"][data-id="' + cssEsc(id) + '"]' };
        var fd0 = draftOf(key, id, false); state.fieldsDraft = fd0 && fd0.fd && fd0.fd.key === state.runKey && fd0.fd.fs === fsKey() ? fd0.fd : null; if (fd0) fd0.open = false;
        say(c.why, 'warn'); state.msg.quiet = true;
      } else if (c.fill) { say(c.why, 'warn'); state.msg.quiet = true; } else state.fieldErr = { id: id, msg: c.why, field: c.field };
      state.focus = c.focus; render(); return Promise.resolve(false);
    }
    var was = here ? nextStepId(c.r, c.map) : null, applied = false;
    var saving = mutateRun(key, g, function (r2, map2, me, now) {
      if (o.how === 'differently') R.doneDifferently(r2, map2, id, o.happened, me, o.at || now, c.values);
      else if (o.how === 'report') intent = acceptInto(r2, map2, id, me, now, o.report);
      else R.done(r2, map2, id, me, now, c.values);
      applied = true;
    }, quiet ? { only: id, background: true } : { only: id });
    /* An accepted report leaves the step's own drafts (evidence typed, a note) as they are. */
    if (intent) { hintsOf(o.report.fk)[intent.gkey] = intent; state.repPick = null; }
    if (applied && o.how !== 'report') dropDraft(key, id, ['record']);
    if (applied && !quiet && state.view === 'run' && state.runKey === key) { afterAnswer(id, was); var now = ctx.run(), st = now && now.steps[id]; if (st && st.s === 'done') land(key, id); }
    return saving.then(function (saved) { return applied && saved === true; });
  }
  /* After checking the step Next up pointed at, the next one in its phase is selected and its check gets focus, with one
     announcement. A step checked out of order stays selected. Nothing moves while a note or a suggestion is being written
     on the step, so no draft is left behind. */
  function afterAnswer(id, was) {
    var r = ctx.run(), map = r && R.mapOf(r), x = map && M.findStep(map, id), a = r && r.steps[id];
    if (!x || !a || a.s !== 'done') return;
    var rv = M.valuesOf(r), title = '"' + M.shownText(x.step, rv) + '" checked.';
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
      say(title + ' Next: "' + M.shownText(nxt, rv) + '".', ''); state.msg.quiet = true; render(); reveal('#step-' + cssEsc(nxt.id));
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
  /* Practice keeps no files: one let go on its page is caught, so the browser never swaps the app (and unsaved edits) for it. */
  document.addEventListener('dragover', function (e) { if (!filesDrag(e) || state.view !== 'practice') return; e.preventDefault(); try { e.dataTransfer.dropEffect = 'none'; } catch (err) { /* older browsers */ } });
  document.addEventListener('drop', function (e) { if (!filesDrag(e) || state.view !== 'practice') return; e.preventDefault(); say('Practice doesn\'t keep files. Add screenshots in the editor, or to a note in a real run.', 'warn'); render(); });
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
    uiActs++;
    if (!/^(Shift|Control|Alt|Meta|CapsLock)$/.test(String(e.key || ''))) childEpoch++;
    /* While an input method is composing, every key is its own (Escape cancels the composition, letters build it). */
    if (e.isComposing || e.keyCode === 229) return;
    var t = e.target, typing = t && /INPUT|TEXTAREA|SELECT/.test(t.tagName);
    if (dbxAc && t && t.id === dbxAc.id && dbxKey(e)) return;
    /* Ctrl+K (Cmd+K on a Mac) opens search from anywhere on the page, also while typing. */
    /* On a Mac it's Cmd+K, and Ctrl+K stays the text box's own (it deletes to the end of the line there). */
    if ((ctx.mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && String(e.key || '').toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
    /* In the search box: Up and Down move through the results (wrapping), Enter opens the active one. */
    if (t && t.id === 'sx-q' && state.sx && !e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sxMove(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Enter') { e.preventDefault(); if (state.sx.active) sxOpenResult(state.sx.active); return; }
    }
    var split = !typing && !e.metaKey && !e.ctrlKey && !e.altKey && t && t.closest && t.closest('.pane-split');
    if (split && V.PANES[split.dataset.split] && paneKey(split.dataset.split, e)) { e.preventDefault(); return; }
    /* A Find box's own Escape: with text, it clears the box and keeps focus there, and nothing else happens; empty, Escape does
       what it always does. */
    if (e.key === 'Escape' && findList(t) && String(t.value || '') && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); if (e.stopPropagation) e.stopPropagation();
      setFind(findList(t), ''); selBoxKept(findList(t)); state.focus = t.id; state.focusWins = true; render(); return;
    }
    /* Find narrows as you type; Enter in its box never submits the form around it (Export evidence, Start a run). */
    if (e.key === 'Enter' && findList(t) && t.closest && t.closest('form')) { e.preventDefault(); return; }
    if (e.key === 'Escape') { if (state.overlay) { closeOverlay(); return; } var om = document.querySelector && document.querySelector('.rw-menu[open]'); if (om) { om.open = false; (state.disc = state.disc || {})[(om.dataset && om.dataset.disc) || 'rw-menu'] = false; var sm = om.querySelector('summary'); if (sm) sm.focus(); return; } if (state.tfPreview && state.view === 'types') { ACTIONS['tf-preview'](); return; } if (state.obAdd && !composing && t && /^ob-new-/.test(t.id || '')) { ACTIONS['ob-add-cancel'](); return; } if (state.obPlace) { cancelPlacing(); return; } if (state.obAsk) { ACTIONS['ob-ask-cancel'](); return; } if (obSheetOpen) { ACTIONS['ob-done'](); return; } if (state.view === 'practice' && state.pick) { PRACTICE.unpick(); return; } if (sheetWasOpen && state.view === 'practice') { PRACTICE['close-ref'](); return; } if (sheetWasOpen) { state.refOpen = false; render(); return; } if (state.view === 'practice' && !typing) { PRACTICE['pr-back'](); return; } if (state.pick || state.edit) { var pk = state.pick; if (pk && pk.kind === 'fields') { dropDraft(state.runKey, pk.id, ['fields', 'open']); state.fieldsDraft = null; } state.pick = null; state.edit = null; state.fieldErr = null; if (pk && pk.back) state.focus = pk.back; render(); return; } if (state.corrForm) { if (state.corrForm.menu) { state.corrForm.menu = false; state.focus = '[data-act="corr-menu"]'; render(); return; } ACTIONS['corr-cancel'](); return; } if (state.view === 'mission' || state.view === 'receipt') { reenterRun(); render(); } return; }
    /* A dialog keeps Tab and Shift+Tab inside it, wrapping at the ends, so keyboard focus never falls behind it. */
    var trap = state.overlay ? overlayEl : state.tfPreview && state.view === 'types' ? document.getElementById('tf-preview') : null;
    if (e.key === 'Tab' && trap && !e.altKey && !e.ctrlKey && !e.metaKey) {
      /* Only controls on screen count: a hidden one (a narrow screen's other panel, a closed section) can't take focus. */
      var fo = Array.prototype.slice.call(trap.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')).filter(function (el) { return !el.getClientRects || el.getClientRects().length > 0; });
      if (fo.length) {
        /* Focus on something inside that isn't a control (a dialog's heading, focused when it opens; a row Show more focused)
           moves on from where it is: Tab to the next control after it, Shift+Tab to the one before it, wrapping at the ends. */
        var fa = document.activeElement, inside = trap.contains(fa), off = inside && fo.indexOf(fa) < 0;
        if (off && fa.compareDocumentPosition) {
          var pos = function (el) { return fa.compareDocumentPosition(el); };
          var to = e.shiftKey ? fo.filter(function (el) { return pos(el) & 2; }).pop() || fo[fo.length - 1] : fo.filter(function (el) { return pos(el) & 4; })[0] || fo[0];
          e.preventDefault(); to.focus();
        }
        else if (e.shiftKey && (!inside || off || fa === fo[0])) { e.preventDefault(); fo[fo.length - 1].focus(); }
        else if (!e.shiftKey && (!inside || off || fa === fo[fo.length - 1])) { e.preventDefault(); fo[0].focus(); }
      }
      return;
    }
    /* Alt+Left and Alt+Right are the browser's Back and Forward, never the picture's. */
    if (state.overlay && state.overlay.list && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey) { ACTIONS['lb-step'](e.key === 'ArrowLeft' ? '-1' : '1'); return; }
    /* Choice buttons: the arrow keys move to the next or previous choice and choose it, as radio buttons do. */
    if (t && t.dataset && t.dataset.act === 'ob-choice' && /^Arrow(Left|Right|Up|Down)$/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); ACTIONS['ob-choice'](t.dataset.id, { dataset: { val: /Right|Down/.test(e.key) ? t.dataset.next : t.dataset.prev } }); return;
    }
    /* A comma ends a tag: it's added at once (a tag can't hold a comma). */
    if (typing && e.key === ',' && t.id === 'tf-tagadd') { e.preventDefault(); ACTIONS['tf-tag-add'](); return; }
    /* A form on the practice page: Ctrl/Cmd+Enter submits from any box (a select, or a multiline box where Enter is a new line). */
    var prf = state.view === 'practice' && t && t.closest && t.closest('.pick.record');
    if (prf && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !composing && !e.isComposing) { var sc = /^(record|fields):(.+)$/.exec(prf.dataset.scope || ''); if (sc) { e.preventDefault(); dispatch(sc[1] === 'fields' ? 'save-fields' : 'record', sc[2], prf); } return; }
    if (typing && e.key === 'Enter' && t.dataset.enter && (composing || e.isComposing)) return;
    if (typing && e.key === 'Enter' && t.dataset.enter) {
      e.preventDefault();
      var act = t.dataset.enter;
      if (state.view === 'practice') dispatch(act, t.dataset.id, t);
      else if (act === 'save-edit') ACTIONS['save-edit'](); else if (act === 'block') ACTIONS.block(t.dataset.id, t); else if (ACTIONS[act]) ACTIONS[act](t.dataset.id, t);
      return;
    }
    /* Undo and Redo in the draft editor and the step-type form, also while typing: Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z or Ctrl+Y.
       A builder box with typing not yet applied keeps the browser's own undo for that typing; once it matches what's
       applied, the keys go to the timeline. Other boxes (the name at the top, searches) keep the browser's. */
    var zk = String(e.key || '').toLowerCase();
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (zk === 'z' || (zk === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey))) {
      /* While an input method is composing, its own keys come first. */
      if (composing || e.isComposing || e.keyCode === 229) return;
      /* Practice (2.2): its controls have their own Undo; its text boxes keep the browser's; the rest of the editor is the draft's. */
      if (state.view === 'practice') { if (typing) return; var pcp = currentProcess(); if (pcp) { e.preventDefault(); prMove(pcp.id, !(zk === 'y' || e.shiftKey)); } return; }
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
    /* / opens search, as a single-key shortcut (off with the others). */
    if (e.key === '/' && !state.overlay) { e.preventDefault(); openSearch(); return; }
    var onControl = document.activeElement && document.activeElement !== document.body && document.activeElement.closest('button, a, summary, select, [role="checkbox"]');
    if (onControl && (e.key === ' ' || e.key === 'Enter')) return;
    if (state.view === 'practice' && !state.overlay) { prKey1(e); return; }
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
    if (e.key === 'm') { if (state.view === 'run') { savePanes(); setView('mission'); } else reenterRun(); render(); }
  });

  /* The practice page's single keys, as a run's: J / K move, Space or X checks, E edits the selected step, F fills it in. */
  function prKey1(e) {
    var m = prModel(); if (!m || !m.map) return;
    var all = M.steps(m.map).map(function (x) { return x.step.id; }).filter(function (id) { var s = m.P.steps[id]; return s && s.status !== 'hidden' && s.status !== 'assumed'; }), i = all.indexOf(state.sel);
    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault();
      var to = all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'j' ? 1 : -1)))] || all[0], tx = to && M.findStep(m.map, to); if (!tx) return;
      state.unfold[tx.phase.id] = true; prPickStep(to); render(); var el = document.getElementById('step-' + state.sel); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); return;
    }
    if ((e.key === ' ' || e.key === 'x') && state.sel) { e.preventDefault(); if (!e.repeat) dispatch('toggle', state.sel); return; }
    if (e.key === 'e' && state.sel && m.P.canEdit(state.sel)) { e.preventDefault(); dispatch('pr-edit', state.sel); return; }
    if (e.key === 'f' && state.sel) { var fs = m.P.steps[state.sel]; if (fs && fs.fill) { e.preventDefault(); dispatch('pick', state.sel, { dataset: { kind: 'fields' } }); } else if (fs) { e.preventDefault(); say('Nothing to fill in for this step.', ''); state.msg.quiet = true; render(); } }
  }
  Object.keys(prActs).forEach(function (k) { ACTIONS[k] = prActs[k]; });
  navBoot();
  render();
  /* A refresh while editing a draft comes back to the editor (this tab only). Unsaved edits don't survive a refresh, so the
     browser asks before leaving with any. */
  function resumeEditor() {
    var id = resumeEdit; resumeEdit = null;
    /* A link decides where a reload lands; the editor comes back only without one. */
    if (H.bootLink) return;
    var p = id && procFind(id); if (!p) return;
    setView('process'); state.processId = id; state.ptab = 'edit'; state.mapVer = null; openEditor(p); state.focus = 'ed-h'; H.mode = 'replace'; render();
  }
  window.addEventListener('beforeunload', function (e) {
    var any = !!state.obPending || Object.keys(state.shotBusy).length > 0 || Object.keys(state.editors || {}).some(function (k) { return dirty(state.editors[k]); });
    if (any) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('popstate', onPop);
  boot().then(resumeEditor, resumeEditor).then(announceRelease, announceRelease);
})();
