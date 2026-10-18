(function () {
  'use strict';
  var esc = PF.esc, hm = PF.hm;
  /* Built-in templates for demo mode; the build fills this from example-folder/templates. */
  var BUILTIN = /*@TEMPLATES@*/{};
  var BLOCK_REASONS = ['Failed', 'Waiting on someone', 'Not sure it passed'];
  var LOCAL = 'preflight-v1';
  var POLL_MS = 15000;
  var MAX_IMG = 3 * 1024 * 1024;
  var KEEP_DAYS = 7;

  function iso() { return new Date().toISOString(); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  /* One recording session per browser tab. It survives a reload of the same tab. */
  var SESSION = (function () {
    try { var s = sessionStorage.getItem('preflight-session'); if (!s) { s = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('preflight-session', s); } return s; }
    catch (e) { return Math.random().toString(36).slice(2, 10); }
  })();

  /* ---------- Storage: a OneDrive-synced folder (Chrome/Edge), or this browser only (examples) ---------- */
  var idb = {
    open: function () { return new Promise(function (res, rej) { var q = indexedDB.open('preflight', 1); q.onupgradeneeded = function () { q.result.createObjectStore('handles'); }; q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; }); },
    get: function (k) { return idb.open().then(function (db) { return new Promise(function (res) { var g = db.transaction('handles').objectStore('handles').get(k); g.onsuccess = function () { res(g.result || null); }; g.onerror = function () { res(null); }; }); }); },
    set: function (k, v) { return idb.open().then(function (db) { return new Promise(function (res) { var tx = db.transaction('handles', 'readwrite'); tx.objectStore('handles').put(v, k); tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); }; }); }); }
  };
  var canFolder = typeof window.showDirectoryPicker === 'function';

  function conflictError(disk) { var e = new Error('conflict'); e.disk = disk; return e; }
  /* A save is refused if the file moved on since we read it, or (unless taking over) another session is recording. */
  function changedElsewhere(disk, r, takeover) { return disk && ((disk.rev || 0) > (r.rev || 0) || (!takeover && disk.session && r.session && disk.session !== r.session)); }

  function eachFile(dirPromise, filter, fn) {
    return dirPromise.then(function (d) {
      var it = d.values(), jobs = [];
      function next() {
        return it.next().then(function (x) {
          if (x.done) return Promise.all(jobs);
          if (x.value.kind === 'file' && filter.test(x.value.name)) jobs.push(fn(x.value));
          return next();
        });
      }
      return next();
    });
  }
  function FolderStore(dir) { this.dir = dir; this.name = dir.name; }
  FolderStore.prototype.sub = function (name, create) { return this.dir.getDirectoryHandle(name, { create: !!create }); };
  FolderStore.prototype.templates = function () {
    var out = [];
    return eachFile(this.sub('templates'), /\.md$/i, function (h) {
      return h.getFile().then(function (f) { return f.text(); }).then(function (md) { out.push({ id: h.name.replace(/\.md$/i, ''), md: md }); });
    }).then(function () { return out.sort(function (a, b) { return a.id < b.id ? -1 : 1; }); }, function () { return []; });
  };
  FolderStore.prototype.runs = function () {
    var out = [];
    return eachFile(this.sub('runs'), /\.json$/i, function (h) {
      return h.getFile().then(function (f) { return f.text().then(function (txt) {
        try { var o = JSON.parse(txt); if (PF.validRun(o)) { o.file = h.name; out.push(o); } } catch (e) { /* skip unreadable files, e.g. a partial OneDrive sync */ }
      }); });
    }).then(function () { return out; }, function () { return []; });
  };
  FolderStore.prototype.readRun = function (file) {
    return this.sub('runs').then(function (d) { return d.getFileHandle(file); }).then(function (h) { return h.getFile(); })
      .then(function (f) { return f.text().then(function (t) { var o = JSON.parse(t); o.file = file; return o; }); }, function () { return null; });
  };
  /* Save only if nobody else saved this run since we read it. This catches most clashes; it can't see a save OneDrive hasn't delivered yet. */
  FolderStore.prototype.saveRun = function (r, takeover) {
    var self = this;
    return self.readRun(r.file).then(function (disk) {
      if (changedElsewhere(disk, r, takeover)) throw conflictError(disk);
      var copy = JSON.parse(JSON.stringify(r)); copy.rev = (r.rev || 0) + 1; copy.savedAt = iso();
      return self.sub('runs', true).then(function (d) { return d.getFileHandle(r.file, { create: true }); }).then(function (h) {
        return h.createWritable().then(function (w) { return w.write(JSON.stringify(copy, null, 2)).then(function () { return w.close(); }); });
      }).then(function () { r.rev = copy.rev; r.savedAt = copy.savedAt; });
    });
  };
  FolderStore.prototype.deleteRun = function (r) { return this.sub('runs').then(function (d) { return d.removeEntry(r.file); }); };
  FolderStore.prototype.saveImage = function (r, key, blob) {
    var ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob.type];
    var name = r.id + '__' + key.replace('.', '-') + '__' + Date.now() + '.' + ext;
    return this.sub('proposals', true).then(function (d) { return d.getFileHandle(name, { create: true }); }).then(function (h) {
      return h.createWritable().then(function (w) { return w.write(blob).then(function () { return w.close(); }); });
    }).then(function () { return 'proposals/' + name; });
  };
  FolderStore.prototype.imageUrl = function (path) {
    if (!/^(images|proposals)\/[\w./-]+$/.test(path) || path.indexOf('..') >= 0) return Promise.resolve(null);
    var parts = path.split('/'), file = parts.pop(), p = Promise.resolve(this.dir);
    parts.forEach(function (seg) { p = p.then(function (d) { return d.getDirectoryHandle(seg); }); });
    return p.then(function (d) { return d.getFileHandle(file); }).then(function (h) { return h.getFile(); })
      .then(function (f) { return /^image\/(png|jpeg|webp|gif)$/.test(f.type) ? URL.createObjectURL(f) : null; }, function () { return null; });
  };

  function LocalStore() { this.name = 'this browser only'; }
  LocalStore.prototype.templates = function () { return Promise.resolve(Object.keys(BUILTIN).sort().map(function (k) { return { id: k, md: BUILTIN[k] }; })); };
  LocalStore.prototype.runs = function () { return Promise.resolve((lsGet(LOCAL + ':runs', []) || []).filter(PF.validRun)); };
  LocalStore.prototype.readRun = function (file) {
    var found = null; lsGet(LOCAL + ':runs', []).forEach(function (x) { if (x.file === file) found = x; });
    return Promise.resolve(found);
  };
  LocalStore.prototype.saveRun = function (r, takeover) {
    var all = lsGet(LOCAL + ':runs', []), disk = null;
    all.forEach(function (x) { if (x.file === r.file) disk = x; });
    if (changedElsewhere(disk, r, takeover)) return Promise.reject(conflictError(disk));
    var copy = JSON.parse(JSON.stringify(r)); copy.rev = (r.rev || 0) + 1; copy.savedAt = iso();
    var next = [copy].concat(all.filter(function (x) { return x.file !== r.file; }));
    if (!lsSet(LOCAL + ':runs', next)) return Promise.reject(new Error('Browser storage is full. Delete old runs or remove pasted screenshots.'));
    r.rev = copy.rev; r.savedAt = copy.savedAt;
    return Promise.resolve();
  };
  LocalStore.prototype.deleteRun = function (r) { lsSet(LOCAL + ':runs', lsGet(LOCAL + ':runs', []).filter(function (x) { return x.file !== r.file; })); return Promise.resolve(); };
  LocalStore.prototype.saveImage = function (r, key, blob) {
    return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result)); }; fr.readAsDataURL(blob); });
  };
  LocalStore.prototype.imageUrl = function (path) { return Promise.resolve(/^data:image\/(png|jpeg|webp);base64,/.test(path) ? path : null); };

  /* ---------- State ---------- */
  var state = {
    view: 'home', who: lsGet(LOCAL + ':who', ''), store: null, templates: [], runs: [], active: lsGet(LOCAL + ':active', null),
    sel: null, refOpen: true, pick: null, ctxEdit: null, tsel: null, endPick: false, del: false, purge: false,
    filter: lsGet(LOCAL + ':filter', 'mine'), summary: false, msg: null, lastCheck: null, savedAt: null, needsReconnect: null, urls: {}, busy: false, focus: null
  };
  function say(text, kind) { state.msg = text ? { text: text, kind: kind || '' } : null; }
  function run() { for (var i = 0; i < state.runs.length; i++) if (state.runs[i].file === state.active) return state.runs[i]; return null; }
  function tmpl(id) { for (var i = 0; i < state.templates.length; i++) if (state.templates[i].id === id) return state.templates[i]; return null; }
  function recording(r) { return !!r && !!state.who && !r.ended && r.lead === state.who && r.session === SESSION; }
  function resetRunUi() { state.msg = null; state.sel = null; state.pick = null; state.ctxEdit = null; state.endPick = false; state.del = false; state.summary = false; }

  function loadAll() {
    return Promise.all([state.store.templates(), state.store.runs()]).then(function (res) {
      state.templates = res[0];
      state.runs = res[1].sort(function (a, b) { return a.started < b.started ? 1 : -1; });
      state.lastCheck = iso();
      if (!state.tsel && state.templates[0]) state.tsel = state.templates[0].id;
      if (state.active && !run()) state.active = null;
      resolveImages();
    });
  }
  function useStore(s) { state.store = s; return loadAll().then(render, function (e) { say('Couldn\'t read the folder: ' + e.message, 'bad'); render(); }); }
  function connectFolder() {
    window.showDirectoryPicker({ id: 'preflight', mode: 'readwrite' }).then(function (dir) {
      state.urls = {};
      return idb.set('folder', dir).then(function () { say('Connected to "' + dir.name + '".'); resetRunUi(); state.active = null; return useStore(new FolderStore(dir)); });
    }, function () { /* picker canceled */ });
  }
  function reconnect() {
    var h = state.needsReconnect; if (!h) return;
    h.requestPermission({ mode: 'readwrite' }).then(function (p) { if (p === 'granted') { state.needsReconnect = null; state.urls = {}; useStore(new FolderStore(h)); } });
  }
  function boot() {
    if (!canFolder) { say('This browser can\'t open folders, so Preflight is showing examples saved in this browser only. Use Edge or Chrome for the team folder.', 'warn'); return useStore(new LocalStore()); }
    return idb.get('folder').then(function (h) {
      if (!h) return useStore(new LocalStore());
      return h.queryPermission({ mode: 'readwrite' }).then(function (p) {
        if (p === 'granted') return useStore(new FolderStore(h));
        state.needsReconnect = h; return useStore(new LocalStore());
      });
    }, function () { return useStore(new LocalStore()); });
  }

  /* Re-read the folder every 15 s and on focus, so viewers see the recorder's saves once OneDrive delivers them. */
  function poll() {
    if (!(state.store instanceof FolderStore) || document.hidden || state.busy) return;
    var ae = document.activeElement;
    if (ae && /INPUT|TEXTAREA/.test(ae.tagName) && app.contains(ae)) return;
    loadAll().then(render, function () {});
  }
  setInterval(poll, POLL_MS);
  window.addEventListener('focus', poll);

  function save(r, takeover) {
    state.busy = true;
    return state.store.saveRun(r, takeover).then(function () { state.busy = false; state.savedAt = r.savedAt; }, function (e) {
      state.busy = false;
      lsSet(LOCAL + ':unsaved:' + r.id, r);
      if (e.disk) {
        for (var i = 0; i < state.runs.length; i++) if (state.runs[i].file === r.file) { e.disk.file = r.file; state.runs[i] = e.disk; }
        say(e.disk.lead + ' saved this run at ' + hm(e.disk.savedAt) + ' from another window or computer, so your last change wasn\'t written. Their version is shown; your copy is kept in this browser. Redo the change if it\'s still needed.', 'bad');
      } else say('Couldn\'t save: ' + e.message + ' Your change is on screen but not in the file.', 'bad');
      render();
    });
  }

  /* ---------- Images ---------- */
  function resolveImages() {
    state.runs.forEach(function (r) {
      var t = PF.parse(r.snapshot), paths = [];
      t.sections.forEach(function (s) { s.items.forEach(function (it) { it.shots.forEach(function (sh) { if (sh.src.indexOf('shot:') !== 0) paths.push(sh.src); }); }); });
      Object.keys(r.proposed || {}).forEach(function (k) { (r.proposed[k] || []).forEach(function (p) { paths.push(p.file); }); });
      paths.forEach(function (p) {
        if (p in state.urls) return;
        state.urls[p] = null;
        state.store.imageUrl(p).then(function (u) { state.urls[p] = u || ''; render(); });
      });
    });
  }
  function shotSvg(key, caption) {
    if (key === 'shot:pipeline') {
      var names = ['Build', 'Test', 'Bake', 'Deploy', 'Verify'], g = '';
      names.forEach(function (n, i) {
        var x = 14 + i * 62;
        g += '<rect class="s-chip" x="' + x + '" y="34" width="52" height="44" rx="6"/><circle class="s-go" cx="' + (x + 26) + '" cy="50" r="8"/><path d="M' + (x + 22) + ' 50l3 3 6-6" stroke="#fff" stroke-width="2" fill="none"/><text class="s-ink" x="' + (x + 26) + '" y="70" text-anchor="middle">' + n + '</text>';
        if (i < 4) g += '<line class="s-line" x1="' + (x + 52) + '" y1="56" x2="' + (x + 62) + '" y2="56"/>';
      });
      return '<svg viewBox="0 0 330 104" role="img" aria-label="' + esc(caption) + '"><rect class="s-bg" width="330" height="104"/><text class="s-mut" x="14" y="20">EXAMPLE · pipeline, all stages succeeded</text>' + g + '</svg>';
    }
    if (key === 'shot:logs') {
      var vals = [2, 1, 3, 2, 1, 2, 9, 4, 2, 1, 1, 2], bars = '';
      vals.forEach(function (v, i) { var h = v * 6, x = 24 + i * 24; bars += '<rect class="' + (v > 6 ? 's-stop' : 's-chip') + '" x="' + x + '" y="' + (84 - h) + '" width="16" height="' + h + '" rx="2"/>'; });
      return '<svg viewBox="0 0 330 112" role="img" aria-label="' + esc(caption) + '"><rect class="s-bg" width="330" height="112"/><text class="s-mut" x="14" y="18">EXAMPLE · error events, 5-min buckets</text><line class="s-line" x1="20" y1="84" x2="316" y2="84"/>' + bars + '<text class="s-ink" x="176" y="30">a spike like this means stop</text></svg>';
    }
    return '<svg viewBox="0 0 330 104" role="img" aria-label="' + esc(caption) + '"><rect class="s-bg" width="330" height="104"/><text class="s-mut" x="14" y="56">' + esc(caption) + '</text></svg>';
  }
  function shotsFor(r, key, it) {
    var out = it.shots.map(function (s) { return { src: s.src, caption: s.caption }; });
    ((r.proposed || {})[key] || []).forEach(function (p) { out.push({ src: p.file, caption: 'Proposed by ' + p.by + ' at ' + hm(p.at), proposed: true }); });
    return out;
  }
  function media(s) {
    if (s.src.indexOf('shot:') === 0) return shotSvg(s.src, s.caption);
    var u = /^data:image\//.test(s.src) ? s.src : state.urls[s.src];
    if (u) return '<img alt="' + esc(s.caption) + '" src="' + esc(u) + '">';
    return shotSvg('missing', u === '' ? 'Image not found: ' + s.src : 'Loading image…');
  }

  /* ---------- Views ---------- */
  var CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function notices() {
    var h = '';
    if (state.msg) h += '<div class="notice ' + state.msg.kind + '" role="status"><span>' + esc(state.msg.text) + '</span><button class="mini" data-dismiss="1">Dismiss</button></div>';
    if (!state.who) h += '<div class="notice warn"><span>Type your name at the top right. Runs you record are stamped with it.</span></div>';
    return h;
  }
  function dupes() {
    var seen = {}, out = [];
    state.runs.forEach(function (r) { (seen[r.id] = seen[r.id] || []).push(r); });
    Object.keys(seen).forEach(function (id) { if (seen[id].length > 1) out.push(seen[id]); });
    return out;
  }
  function oldEnded() {
    var cut = Date.now() - KEEP_DAYS * 864e5;
    return state.runs.filter(function (r) { return r.ended && new Date(r.ended.at).getTime() < cut; });
  }

  function runCard(r) {
    var t = PF.parse(r.snapshot); PF.normalize(r, t);
    var d = PF.decision(r, t), tot = PF.totals(r, t);
    return '<button class="runcard" data-open="' + esc(r.file) + '"><div class="row" style="justify-content:space-between"><span class="cat">' + esc(r.category) + '</span><span class="small">' + (r.lead === state.who ? 'You\'re recording' : 'Recorded by ' + esc(r.lead)) + '</span></div>' +
      '<span class="runcard-title">' + esc(r.name) + '</span><span class="state ' + d.s + '">' + esc(d.text) + '</span>' +
      (r.ended ? '' : '<div class="bar" aria-hidden="true"><i style="width:' + (tot.n ? Math.round(100 * tot.d / tot.n) : 0) + '%"></i></div>') +
      '<span class="small">' + tot.d + ' of ' + tot.n + ' steps · started ' + esc(PF.when(r.started)) + '</span></button>';
  }
  function viewHome() {
    var shown = state.runs.filter(function (r) { return state.filter === 'all' || PF.isMine(r, state.who); });
    var active = shown.filter(function (r) { return !r.ended; }), ended = shown.filter(function (r) { return r.ended; });
    var cards = active.map(runCard).join('') || '<p class="muted">' + (state.filter === 'mine' ? 'Nothing running that you\'ve recorded. Switch to Everyone, or start one below.' : 'No checklists running. Start one below.') + '</p>';
    var groups = {};
    state.templates.forEach(function (x) { var p = PF.parse(x.md), g = p.meta.category || 'Other'; (groups[g] = groups[g] || []).push({ x: x, p: p }); });
    var lib = Object.keys(groups).sort().map(function (g) {
      return '<div class="lib-group"><h3>' + esc(g) + '</h3><div class="lib">' + groups[g].map(function (o) {
        var n = o.p.sections.reduce(function (a, s) { return a + s.items.length; }, 0), bl = PF.blockers(o.p);
        return '<div class="tpl"><span class="tpl-title">' + esc(o.p.meta.title || o.x.id) + '</span><span class="small">' + esc(o.p.meta.when || '') + '</span>' +
          '<div class="row"><span class="small">' + (bl.length ? '<span style="color:var(--stop)">Can\'t run yet: ' + bl.length + ' problem' + (bl.length > 1 ? 's' : '') + '</span>' : o.p.sections.length + ' pause points · ' + n + ' steps') + '</span>' +
          (bl.length ? '<button class="mini" data-tview="' + esc(o.x.id) + '">See why</button>' : '<button class="mini" data-start="' + esc(o.x.id) + '"' + (state.who ? '' : ' disabled') + '>Start</button>') + '</div></div>';
      }).join('') + '</div></div>';
    }).join('') || '<p class="muted">No templates found. Put Markdown templates in the folder\'s <code>templates</code> subfolder. An AI assistant can write them.</p>';
    var dup = dupes().map(function (g) { return '<div class="notice warn"><span>"' + esc(g[0].name) + '" has ' + g.length + ' copies (' + g.map(function (r) { return esc(r.file); }).join(', ') + '), probably a OneDrive conflict copy. Open each, pick the one to keep going with, and delete the other.</span></div>'; }).join('');
    var old = oldEnded(), purge = old.length ? (state.purge
      ? '<div class="row"><span class="small">Delete ' + old.length + ' ended run' + (old.length > 1 ? 's' : '') + ' older than ' + KEEP_DAYS + ' days from the shared folder?</span><button class="btn stop" data-purge="1">Delete</button><button class="mini" data-purgecancel="1">Keep</button></div>'
      : '<button class="mini" data-purgeask="1">Delete ended runs older than ' + KEEP_DAYS + ' days (' + old.length + ')</button>') : '';
    var endedHtml = ended.length ? '<div class="row" style="justify-content:space-between;margin-bottom:8px"><h2 style="margin:0">Ended</h2>' + purge + '</div><p class="small">Runs are scratch work. Share one to Jira if you need a record, then delete it.</p><div class="runs">' + ended.map(runCard).join('') + '</div>' : '';
    return notices() + dup + '<div class="runhead"><div><div class="eyebrow">Codify what we do as a checklist. Automate it once it stops changing.</div><h1>Team checklists</h1></div></div>' +
      '<div class="home"><div><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2 style="margin:0">Running now</h2><div class="filter" role="group" aria-label="Show runs">' +
      '<button class="chipbtn" data-filter="mine" aria-pressed="' + (state.filter === 'mine') + '">Mine</button><button class="chipbtn" data-filter="all" aria-pressed="' + (state.filter === 'all') + '">Everyone</button></div></div>' +
      '<div class="runs">' + cards + '</div><h2>Start a checklist</h2>' + lib + endedHtml + '</div>' +
      '<aside class="panel"><h2>How it works</h2><ol class="path">' +
      '<li><span class="dot">1</span><span><b>Write it down</b>Ask your AI assistant to turn how we do something into a template in the team folder.</span></li>' +
      '<li><span class="dot">2</span><span><b>Run it</b>One person records each run, reading steps aloud. Everyone else follows along on their own screen.</span></li>' +
      '<li><span class="dot">3</span><span><b>Share if it matters</b>Screenshot the summary or paste it into the Jira ticket, then delete the run.</span></li>' +
      '<li><span class="dot">4</span><span><b>Automate what never varies</b>Mark those steps "automation planned", then "automated" once they report pass or fail.</span></li></ol></aside></div>';
  }

  function viewSummary(r, t) {
    var d = PF.decision(r, t), cl = PF.ctxLine(r, t), ICON = { done: '✓', na: 'N/A', blocked: '■', recheck: '↻', open: '○' };
    var body = t.sections.map(function (s, si) {
      return '<div class="sum-pp"><h4>' + (si + 1) + '. ' + esc(s.title) + '<span>' + (r.called[si] ? 'called' : 'not called') + '</span></h4>' +
        s.items.map(function (it, ii) {
          var k = si + '.' + ii, st = PF.stepState(r, k, it), c = r.checks[k];
          var why = st.s === 'blocked' || st.s === 'recheck' ? (it.kind === 'auto' ? 'automation failed' : c && c.reason) : (it.kind === 'auto' ? 'automated' : '');
          return '<div class="sum-row"><span class="sum-ic ' + st.s + '">' + ICON[st.s] + '<span class="sr"> ' + st.s + '</span></span><span>' + esc(it.text) + '</span><span class="sum-st">' + esc(why || '') + '</span></div>';
        }).join('') + '</div>';
    }).join('');
    return notices() + '<div class="runhead"><div><div class="eyebrow">Share · screenshot the card, or copy it as text into the Jira ticket</div><h1>' + esc(r.name) + '</h1></div>' +
      '<div class="row"><button class="btn primary" data-copysum="1">Copy for Jira</button><button class="btn" data-summary="0">Back to checklist</button><span class="small" id="copymsg" aria-live="polite"></span></div></div>' +
      '<div class="sumwrap"><div class="sum"><div class="sum-head"><div><div class="eyebrow">' + esc(r.category) + ' · ' + esc(t.meta.title) + '</div><div class="sum-title">' + esc(r.name) + '</div>' + (cl ? '<div class="small">' + esc(cl) + '</div>' : '') + '</div>' +
      '<div style="text-align:right"><div class="sum-status ' + d.s + '">' + esc(r.ended ? d.text : 'In progress · ' + d.text) + '</div><div class="small">Recorded by ' + esc((r.recorders || [r.lead]).join(', ')) + '<br>started ' + esc(PF.when(r.started)) + ' · captured ' + esc(PF.when(iso())) + '</div></div></div>' + body +
      '<div class="sum-foot">Preflight · run ' + esc(r.id) + ' · ✓ done · N/A not applicable · ■ blocked · ↻ re-check · ○ not checked</div></div><pre id="sumtext" hidden>' + esc(PF.summaryText(r, t, iso())) + '</pre></div>';
  }

  function viewRun() {
    var r = run();
    if (!r) return notices() + '<div class="panel"><h2>No run open</h2><p>Open a running checklist on Home, or start one from a template.</p><button class="btn primary" data-goview="home">Go to Home</button></div>';
    var t = PF.parse(r.snapshot); PF.normalize(r, t);
    if (state.summary) return viewSummary(r, t);
    var d = PF.decision(r, t), tot = PF.totals(r, t), rec = recording(r), stopped = d.s === 'stopped' && !r.ended;
    function edit(field, value) {
      return '<span class="ctxedit"><label class="small" for="ctx-input">' + esc(field === '__name' ? 'name' : field) + '</label><input id="ctx-input" value="' + esc(value) + '" maxlength="' + (field === '__name' ? 80 : 120) + '"><button class="mini" data-ctxsave="' + esc(field) + '">Save</button><button class="mini" data-ctxcancel="1">Cancel</button></span>';
    }
    var ctx = t.meta.ctx.map(function (f) {
      if (state.ctxEdit === f && rec) return edit(f, r.ctx[f] || '');
      var v = r.ctx[f];
      return '<button class="ctxchip' + (v ? '' : ' empty') + '" data-ctx="' + esc(f) + '"' + (rec ? '' : ' disabled') + '><span>' + esc(f) + ':</span> ' + (v ? esc(v) : 'set') + '</button>';
    }).join('') + (rec ? (state.ctxEdit === '__name' ? edit('__name', r.name) : '<button class="ctxchip" data-ctx="__name"><span>rename</span></button>') : '');
    var rail = '', deck = '';
    t.sections.forEach(function (s, si) {
      var inf = PF.sectionInfo(r, t, si), st = PF.status(r, si);
      rail += '<button class="rail-item" data-jump="' + si + '" data-status="' + st + '"><span class="rail-num">' + (st === 'called' ? '✓' : si + 1) + '</span><span class="rail-name">' + esc(s.title) + '</span><span class="rail-count">' + inf.done + '/' + inf.total + '</span></button>';
      var items = s.items.map(function (it, ii) {
        var key = si + '.' + ii, c = r.checks[key], blocked = PF.isBlocked(r, key, it);
        var locked = st !== 'open' || !rec || (stopped && !blocked);
        var stt = PF.stepState(r, key, it).s, shots = shotsFor(r, key, it);
        var statusText = { done: 'Done', na: 'Not applicable', blocked: 'Blocked', recheck: 'Needs a re-check', open: 'Not checked' }[stt] +
          (c && c.reason && (stt === 'blocked' || stt === 'recheck') ? ': ' + c.reason : '');
        var badges = (it.kind === 'must' ? '<span class="badge b-must">Must do</span>' : '') +
          (it.kind === 'plan' ? '<span class="badge b-plan">Automation planned</span>' : '') +
          (it.kind === 'auto' ? '<span class="badge b-auto">Automated · ' + ({ pass: 'passed', fail: 'failed' }[r.auto[key]] || 'no result yet') + '</span>' : '') +
          (stt === 'recheck' ? '<span class="badge b-warn">Re-check: ' + esc(c.reason) + '</span>' : '') +
          (stt === 'blocked' && it.kind !== 'auto' ? '<span class="badge b-stop">Blocked · ' + esc(c.reason) + '</span>' : '') +
          (stt === 'na' ? '<span class="badge b-ref">Not applicable</span>' : '') +
          (it.note ? '<span class="badge b-ref">Note</span>' : '');
        var stamp = c && c.s === 'done' ? '<div class="stamp">' + hm(c.at) + '</div>' : '';
        var acts = '<div class="acts">';
        if (!locked && it.kind !== 'auto') {
          if (!c || c.s === 'recheck') {
            if (it.kind !== 'must') acts += '<button class="mini" data-na="' + key + '">N/A</button>';
            acts += '<button class="mini" data-pick="' + key + '">Blocked</button>';
          } else if (c.s === 'blocked') acts += '<button class="mini" data-clear="' + key + '">Clear block</button>';
          else if (c.s === 'na') acts += '<button class="mini" data-clear="' + key + '">Undo N/A</button>';
        }
        if (it.kind === 'auto' && !locked) acts += '<span class="small">Result:</span><button class="mini" data-auto="pass:' + key + '">Passed</button><button class="mini" data-auto="fail:' + key + '">Failed</button>';
        acts += '<button class="mini" data-ref="' + key + '">Reference</button></div>';
        var pick = state.pick === key ? '<div class="pick">What\'s wrong? ' + BLOCK_REASONS.map(function (x) { return '<button class="chipbtn" data-reason="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '<button class="mini" data-pickcancel="1">Cancel</button></div>' : '';
        return '<li class="item' + (state.sel === key ? ' sel' : '') + '" data-state="' + stt + '" data-kind="' + it.kind + '">' +
          '<button class="check" id="chk-' + key.replace('.', '-') + '" role="checkbox" aria-checked="' + (stt === 'done' ? 'true' : 'false') + '" aria-label="' + esc(it.text) + '" aria-describedby="st-' + key.replace('.', '-') + '" data-check="' + key + '"' + (locked || it.kind === 'auto' ? ' disabled' : '') + '>' + CHECK_SVG + '</button>' +
          '<div><div class="text">' + PF.mdInline(it.text) + '</div><span class="sr" id="st-' + key.replace('.', '-') + '">' + esc(statusText) + (it.kind === 'must' ? ', must do' : '') + '</span>' + (badges ? '<div class="badges" aria-hidden="true">' + badges + '</div>' : '') +
          (shots.length ? '<div class="thumbs">' + shots.map(function (sh, i) { return '<button class="thumb' + (sh.proposed ? ' proposed' : '') + '" data-zoom="' + key + '" data-zi="' + i + '" aria-label="Expand screenshot: ' + esc(sh.caption) + '" title="' + esc(sh.caption) + '">' + media(sh) + '</button>'; }).join('') + '</div>' : '') +
          '</div><div class="side">' + stamp + acts + '</div>' + pick + '</li>';
      }).join('');
      var gate;
      if (st === 'called') gate = '<span class="ok">Called by ' + esc(r.called[si].by) + ' at ' + hm(r.called[si].at) + '</span>' + (rec ? '<button class="mini" data-reopen="' + si + '">Reopen</button>' : '');
      else if (st === 'locked') gate = '<span class="muted">Opens after "' + esc(t.sections[si - 1].title) + '" is called.</span>';
      else if (inf.blocked) gate = '<span class="warn">Stopped. Resolve the blocked step before anyone moves on.</span>';
      else if (inf.left) gate = '<span class="warn">' + inf.left + ' step' + (inf.left > 1 ? 's' : '') + ' still need an answer: done, N/A, or blocked.</span><button class="btn" disabled>Call pause point</button>';
      else gate = '<span>Every step answered. Read the must-dos aloud and confirm together.</span><button class="btn go" data-call="' + si + '"' + (rec ? '' : ' disabled') + '>Call pause point</button>';
      var hint = s.mode === 'READ-DO' ? 'Read each step aloud, then do it.' : s.mode === 'DO-CONFIRM' ? 'Do the work, then stop and confirm each step together.' : '';
      deck += '<section class="pp" id="pp-' + si + '" data-status="' + st + '" aria-labelledby="pph-' + si + '"><div class="placard"><span class="pp-label">Pause point ' + (si + 1) + '</span><h2 class="pp-title" id="pph-' + si + '" tabindex="-1" style="margin:0">' + esc(s.title) + '</h2>' +
        (s.mode ? '<span class="mode">' + s.mode + '</span>' : '') + (hint ? '<span class="mode-hint">' + hint + '</span>' : '') + '</div><ul class="items">' + items + '</ul><div class="gate">' + gate + '</div></section>';
    });
    var hl = '<div class="headline" data-s="' + d.s + '" role="status"><div><div class="headline-text">' + esc(d.text) + '</div><div class="small">' + esc(d.sub) + '</div></div><div class="row">';
    if (d.s === 'ready' && rec) hl += '<button class="btn go" data-call="' + d.si + '">Call pause point</button>';
    if (rec) {
      if (state.endPick) hl += '<span class="small">End as:</span>' + ['Completed', 'Stopped early', 'Abandoned'].map(function (o) {
        var ok = PF.canEnd(r, t, o);
        return '<button class="chipbtn" data-end="' + o + '"' + (ok ? '' : ' disabled title="Call every pause point first"') + '>' + o + '</button>';
      }).join('') + '<button class="mini" data-endcancel="1">Cancel</button>';
      else hl += '<button class="btn' + (stopped ? ' stop' : '') + '" data-endpick="1">End run</button>';
    }
    if (r.ended && state.who) hl += state.del ? '<span class="small">Delete this run from the folder?</span><button class="btn stop" data-delete="1">Delete</button><button class="mini" data-delcancel="1">Keep</button>' : '<button class="btn" data-delask="1">Delete run</button>';
    hl += '</div></div>';
    var leadbar = '';
    if (!r.ended) {
      if (rec) leadbar = '<div class="notice"><span>You\'re recording this run. Read each step aloud; the team answers; you check it.</span><span class="small">' + (state.savedAt ? 'Saved on this computer at ' + hm(state.savedAt) : '') + '</span></div>';
      else if (state.who && r.lead === state.who) leadbar = '<div class="notice warn"><span>You\'re recording this run in another window or on another computer. This window is read-only.</span><button class="mini" data-takeover="1">Record here instead</button></div>';
      else leadbar = '<div class="notice"><span><b>' + esc(r.lead) + '</b> is recording this run. Follow along here; it refreshes every 15 seconds.</span>' + (state.who ? '<button class="mini" data-takeover="1">Take over recording</button>' : '') + '</div>';
    }
    return notices() + '<div class="runhead"><div><div class="eyebrow">' + esc(r.category) + ' · ' + esc(t.meta.title) + '</div><h1>' + esc(r.name) + '</h1><div class="ctx">' + ctx + '</div></div>' +
      '<div class="row"><div><div class="big">' + tot.d + '<span class="muted">/' + tot.n + '</span></div><div class="small">steps answered</div></div><button class="btn primary" data-summary="1">Share</button><button class="btn" data-goview="home">All checklists</button></div></div>' +
      leadbar + hl + '<div class="run"><nav class="rail" aria-label="Pause points">' + rail + '</nav><div class="deck">' + deck + '</div>' + refPanel(r, t, rec) + '</div>';
  }

  function refPanel(r, t, rec) {
    if (!state.sel) return '<aside class="ref" data-open="false"><div class="ref-empty">Choose <b>Reference</b> on a step to see how to do it.</div></aside>';
    var p = state.sel.split('.'), it = t.sections[+p[0]] && t.sections[+p[0]].items[+p[1]];
    if (!it) return '<aside class="ref" data-open="false"></aside>';
    var figs = shotsFor(r, state.sel, it).map(function (s, i) {
      return '<button class="zoomable" data-zoom="' + state.sel + '" data-zi="' + i + '" aria-label="Expand screenshot: ' + esc(s.caption) + '"><figure' + (s.proposed ? ' class="proposed"' : '') + '>' + media(s) + '<figcaption>' + esc(s.caption) + (s.proposed ? ' · not in the template yet' : '') + '</figcaption></figure></button>';
    }).join('');
    return '<aside class="ref" data-open="' + state.refOpen + '" aria-label="Reference"><button class="mini close" data-refclose="1">Close</button><div class="eyebrow">Reference</div><h3>' + PF.mdInline(it.text) + '</h3>' +
      (it.note ? '<div class="note">' + PF.mdBlock(it.note) + '</div>' : '<div class="ref-empty">No note in the template yet.</div>') + figs +
      (rec ? '<div class="drop"><span>Have a better screenshot? Paste it, or choose a file. It\'s saved as a <b>proposal</b>; ask your AI assistant to add it to the template for future runs.</span>' +
        '<label class="mini" for="shotfile">Choose an image</label><input type="file" id="shotfile" accept="image/png,image/jpeg,image/webp" class="sr"></div>' : '') + '</aside>';
  }

  function viewTemplates() {
    var cur = tmpl(state.tsel) || state.templates[0];
    if (!cur) return notices() + '<div class="panel"><h2>No templates yet</h2><p>Put Markdown files in the folder\'s <code>templates</code> subfolder. An AI assistant can write them; the format guide is in the repository\'s docs folder.</p></div>';
    var t = PF.parse(cur.md), h = PF.health(t), bl = PF.blockers(t);
    var list = state.templates.map(function (x) {
      var p = PF.parse(x.md), b = PF.blockers(p), hh = PF.health(p);
      return '<button class="tcard" data-tsel="' + esc(x.id) + '" aria-current="' + (x.id === cur.id) + '"><span class="cat" style="align-self:flex-start">' + esc(p.meta.category || 'Other') + '</span><span class="tcard-title">' + esc(p.meta.title || x.id) + '</span>' +
        '<span class="small">' + esc(x.id) + '.md · ' + (b.length ? '<span style="color:var(--stop)">can\'t run yet</span>' : hh.warns ? hh.warns + ' suggestions' : 'ready') + '</span></button>';
    }).join('');
    var prev = t.sections.map(function (s) {
      return '<div class="prev-pp"><h4>' + esc(s.title) + (s.mode ? ' <span class="badge b-ref">' + s.mode + '</span>' : '') + '</h4><ul>' + s.items.map(function (it) {
        return '<li>' + PF.mdInline(it.text) + (it.kind === 'must' ? ' <span class="badge b-must">Must do</span>' : '') + (it.kind === 'plan' ? ' <span class="badge b-plan">Automation planned</span>' : '') + (it.kind === 'auto' ? ' <span class="badge b-auto">Automated</span>' : '') +
          (it.binds.length ? ' <span class="badge b-ref">tied to ' + esc(it.binds.join(', ')) + '</span>' : '') + '</li>';
      }).join('') + '</ul></div>';
    }).join('');
    var hl = h.items.map(function (x) { return '<li><span class="lvl ' + x.l + '">' + (x.l === 'ok' ? 'Good' : x.l === 'warn' ? 'Fix' : 'Note') + '</span><span>' + esc(x.t) + '</span></li>'; }).join('');
    return notices() + '<div class="runhead"><div><div class="eyebrow">Templates are Markdown files in the folder\'s templates subfolder. An AI assistant writes and edits them; Preflight only reads them.</div><h1>Checklist templates</h1></div>' +
      '<div class="row"><button class="btn" data-reload="1">Reload templates</button><button class="btn primary" data-start="' + esc(cur.id) + '"' + (state.who && !bl.length ? '' : ' disabled') + '>Start a run</button></div></div>' +
      (bl.length ? '<div class="notice bad"><span><b>This template can\'t run yet.</b> ' + esc(bl.join(' ')) + ' Ask your AI assistant to fix it, then choose Reload templates.</span></div>' : '') +
      '<div class="tgrid"><div class="tlist">' + list + '</div><div class="tview"><div class="panel"><h2>Checklist health</h2><ul class="health">' + hl + '</ul>' +
      '<h2 style="margin-top:16px">Preview</h2>' + prev + '</div><div class="panel"><h2>Source · ' + esc(cur.id) + '.md</h2><div class="src"><pre>' + esc(cur.md) + '</pre></div>' +
      '<p class="small">Changes apply to future runs only. Every run keeps a copy of the template it started with.</p></div></div></div>';
  }

  /* ---------- Render ---------- */
  var app = document.getElementById('app');
  function renderFolder() {
    var el = document.getElementById('folder'), s = state.store, h = '';
    if (s instanceof FolderStore) h = '<span class="dotlive" aria-hidden="true"></span><span>Folder: <b>' + esc(s.name) + '</b> · read ' + hm(state.lastCheck) + '</span><button class="mini" data-refresh="1">Refresh</button><button class="mini" data-connect="1">Change folder</button>';
    else if (state.needsReconnect) h = '<span class="dotlive off" aria-hidden="true"></span><span>The team folder needs your permission again</span><button class="mini" data-reconnect="1">Reconnect "' + esc(state.needsReconnect.name) + '"</button>';
    else h = '<span class="dotlive off" aria-hidden="true"></span><span>Examples · saved in this browser only</span>' + (canFolder ? '<button class="mini" data-connect="1">Open team folder</button>' : '');
    el.innerHTML = h;
    var names = {}; state.runs.forEach(function (r) { (r.recorders || [r.lead]).forEach(function (n) { names[n] = 1; }); });
    document.getElementById('names').innerHTML = Object.keys(names).filter(Boolean).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
  }
  function render() {
    document.querySelectorAll('.tab').forEach(function (b) { if (b.dataset.view === state.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    var whoEl = document.getElementById('who'); if (document.activeElement !== whoEl) whoEl.value = state.who;
    renderFolder();
    if (state.store) resolveImages();
    var ae = document.activeElement, key = null, keepId = ae && app.contains(ae) && ae.id ? ae.id : null;
    if (ae && app.contains(ae) && ae.dataset) { var ks = Object.keys(ae.dataset); if (ks.length) key = [ks[0], ae.dataset[ks[0]]]; }
    app.innerHTML = state.view === 'run' ? viewRun() : state.view === 'templates' ? viewTemplates() : viewHome();
    var target = null;
    if (state.focus) { target = document.getElementById(state.focus); state.focus = null; }
    if (!target && keepId) target = document.getElementById(keepId);
    if (!target && key) {
      var attr = 'data-' + key[0].replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
      var cand = app.querySelectorAll('[' + attr + ']');
      for (var i = 0; i < cand.length; i++) if (cand[i].getAttribute(attr) === key[1]) { target = cand[i]; break; }
    }
    var ci = document.getElementById('ctx-input');
    if (ci) target = ci;
    if (target && document.activeElement !== target) target.focus();
    lsSet(LOCAL + ':active', state.active); lsSet(LOCAL + ':filter', state.filter);
  }
  function focusCheck(key) { return 'chk-' + key.replace('.', '-'); }

  /* ---------- Events ---------- */
  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]'); if (!b) return;
    state.view = b.dataset.view; state.summary = false; render(); window.scrollTo(0, 0);
  });
  document.getElementById('folder').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.connect) connectFolder();
    else if (b.dataset.reconnect) reconnect();
    else if (b.dataset.refresh) loadAll().then(render);
  });
  var whoEl = document.getElementById('who');
  whoEl.addEventListener('change', function () { state.who = whoEl.value.trim().slice(0, 40); lsSet(LOCAL + ':who', state.who); state.pick = null; state.ctxEdit = null; render(); });

  function addShot(file) {
    var r = run(), key = state.sel, who = state.who;
    if (!recording(r) || !key || !file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { say('Use a PNG, JPEG or WebP image.', 'warn'); render(); return; }
    if (file.size > MAX_IMG) { say('That image is over 3 MB. Crop it to the part that matters and try again.', 'warn'); render(); return; }
    state.store.saveImage(r, key, file).then(function (path) {
      r.proposed = r.proposed || {};
      (r.proposed[key] = r.proposed[key] || []).push({ file: path, by: who, at: iso() });
      if (/^data:/.test(path)) state.urls[path] = path;
      resolveImages(); render(); return save(r);
    }).then(render, function (e) { say('Couldn\'t save the image: ' + e.message, 'bad'); render(); });
  }

  app.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !app.contains(b) || b.disabled) return;
    var d = b.dataset, r = state.view === 'run' ? run() : null, t = r ? PF.parse(r.snapshot) : null, rec = recording(r), mutated = false;
    if (d.zoom) { openZoom(d.zoom, +d.zi, b); return; }
    if (d.jump) { var el = document.getElementById('pph-' + d.jump); if (el) { el.scrollIntoView({ block: 'start' }); el.focus(); } return; }
    if (d.copysum) { copySummary(r, t); return; }
    if (d.dismiss) { say(null); }
    else if (d.goview) { state.view = d.goview; resetRunUi(); }
    else if (d.filter) { state.filter = d.filter; }
    else if (d.summary) { state.summary = d.summary === '1'; window.scrollTo(0, 0); }
    else if (d.open) { state.active = d.open; state.view = 'run'; resetRunUi(); window.scrollTo(0, 0); }
    else if (d.tview) { state.tsel = d.tview; state.view = 'templates'; }
    else if (d.start) {
      var tp = tmpl(d.start); if (!tp || !state.who || PF.blockers(PF.parse(tp.md)).length) return;
      var nr = PF.newRun(tp.id, tp.md, state.who, Date.now()); nr.session = SESSION;
      state.runs.unshift(nr); state.active = nr.file; state.view = 'run'; resetRunUi();
      state.ctxEdit = PF.parse(tp.md).meta.ctx[0] || null;
      render(); save(nr).then(render); window.scrollTo(0, 0); return;
    }
    else if (d.ref) { state.sel = d.ref; state.refOpen = true; }
    else if (d.refclose) { state.refOpen = false; state.focus = state.sel ? focusCheck(state.sel) : null; }
    else if (d.tsel) { state.tsel = d.tsel; }
    else if (d.reload) { loadAll().then(render); return; }
    else if (d.purgeask) { state.purge = true; }
    else if (d.purgecancel) { state.purge = false; }
    else if (d.purge) {
      var gone = oldEnded();
      Promise.all(gone.map(function (x) { return state.store.deleteRun(x).then(function () { return x.file; }, function () { return null; }); })).then(function (files) {
        state.runs = state.runs.filter(function (x) { return files.indexOf(x.file) < 0; }); state.purge = false;
        say('Deleted ' + files.filter(Boolean).length + ' old run' + (files.filter(Boolean).length === 1 ? '' : 's') + '.'); render();
      });
      return;
    }
    else if (d.delask) { state.del = true; }
    else if (d.delcancel) { state.del = false; }
    else if (d.delete && r) { state.store.deleteRun(r).then(function () { state.runs = state.runs.filter(function (x) { return x.file !== r.file; }); state.active = null; state.view = 'home'; resetRunUi(); render(); }, function (er) { say('Couldn\'t delete: ' + er.message, 'bad'); render(); }); return; }
    else if (d.takeover && r && state.who && !r.ended) {
      state.store.readRun(r.file).then(function (disk) {
        var base = disk || r; base.file = r.file;
        base.lead = state.who; base.session = SESSION; base.recorders = base.recorders || [];
        if (base.recorders.indexOf(state.who) < 0) base.recorders.push(state.who);
        for (var i = 0; i < state.runs.length; i++) if (state.runs[i].file === r.file) state.runs[i] = base;
        render(); return save(base, true);
      }).then(render);
      return;
    }
    else if (!rec) return;
    else if (d.check) {
      var sk = d.check.split('.'), it0 = t.sections[+sk[0]].items[+sk[1]], c = r.checks[d.check];
      if (PF.status(r, +sk[0]) !== 'open' || it0.kind === 'auto') return;
      if (c && c.s === 'done') delete r.checks[d.check];
      else r.checks[d.check] = { s: 'done', by: state.who, at: iso() };
      state.pick = null; mutated = true;
    }
    else if (d.na) {
      var nk = d.na.split('.'), itn = t.sections[+nk[0]].items[+nk[1]];
      if (itn.kind === 'must' || itn.kind === 'auto' || PF.status(r, +nk[0]) !== 'open') return;
      r.checks[d.na] = { s: 'na', reason: 'Not applicable', by: state.who, at: iso() }; mutated = true; state.focus = focusCheck(d.na);
    }
    else if (d.pick) { state.pick = d.pick; }
    else if (d.pickcancel) { state.focus = state.pick ? focusCheck(state.pick) : null; state.pick = null; }
    else if (d.reason && state.pick) {
      var pk = state.pick.split('.');
      if (PF.status(r, +pk[0]) !== 'open') { state.pick = null; return; }
      r.checks[state.pick] = { s: 'blocked', reason: d.reason, by: state.who, at: iso() }; state.focus = focusCheck(state.pick); state.pick = null; mutated = true;
    }
    else if (d.clear) { delete r.checks[d.clear]; mutated = true; state.focus = focusCheck(d.clear); }
    else if (d.auto) { var ap = d.auto.split(':'); r.auto[ap[1]] = ap[0]; mutated = true; }
    else if (d.call) {
      PF.normalize(r, t); var ci = +d.call;
      if (PF.canCall(r, t, ci)) { r.called[ci] = { by: state.who, at: iso() }; mutated = true; state.focus = ci + 1 < t.sections.length ? 'pph-' + (ci + 1) : null; }
    }
    else if (d.reopen) { PF.reopen(r, +d.reopen); mutated = true; state.focus = 'pph-' + d.reopen; }
    else if (d.ctx) { state.ctxEdit = d.ctx; }
    else if (d.ctxcancel) { state.ctxEdit = null; }
    else if (d.ctxsave) {
      var v = (document.getElementById('ctx-input') || {}).value || '';
      if (d.ctxsave === '__name') { if (v.trim()) { r.name = v.trim().slice(0, 80); r.nameCustom = true; mutated = true; } }
      else { var n = PF.setContext(r, t, d.ctxsave, v.slice(0, 120), state.who, iso()); mutated = true; if (n) say(n + ' step' + (n > 1 ? 's need' : ' needs') + ' a re-check because ' + d.ctxsave + ' changed.', 'warn'); }
      state.ctxEdit = null;
    }
    else if (d.endpick) { state.endPick = true; }
    else if (d.endcancel) { state.endPick = false; }
    else if (d.end) { if (!PF.canEnd(r, t, d.end)) return; r.ended = { outcome: d.end, by: state.who, at: iso() }; state.endPick = false; mutated = true; }
    else return;
    if (r && mutated) PF.normalize(r, t);
    render();
    if (r && mutated) save(r).then(render);
  });
  app.addEventListener('keydown', function (e) {
    if (e.target.id !== 'ctx-input') return;
    if (e.key === 'Enter') { var s = app.querySelector('[data-ctxsave]'); if (s) s.click(); }
    if (e.key === 'Escape') { state.ctxEdit = null; render(); }
  });
  app.addEventListener('change', function (e) { if (e.target.id === 'shotfile') { addShot(e.target.files && e.target.files[0]); e.target.value = ''; } });
  document.addEventListener('paste', function (e) {
    if (state.view !== 'run' || !state.sel || !e.clipboardData || !recording(run())) return;
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    var items = e.clipboardData.items || [];
    for (var i = 0; i < items.length; i++) if (items[i].type.indexOf('image/') === 0) { addShot(items[i].getAsFile()); e.preventDefault(); return; }
  });

  function copySummary(r, t) {
    var txt = PF.summaryText(r, t, iso()), msg = document.getElementById('copymsg');
    function fallback() {
      var pre = document.getElementById('sumtext'); if (!pre) return;
      pre.hidden = false; var rg = document.createRange(); rg.selectNodeContents(pre); var sl = window.getSelection(); sl.removeAllRanges(); sl.addRange(rg);
      if (msg) msg.textContent = 'Selected below. Press Ctrl+C.';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { if (msg) msg.textContent = 'Copied. Paste it into the Jira ticket.'; }, fallback);
    else fallback();
  }

  /* ---------- Lightbox ---------- */
  var lb = document.getElementById('lb'), zoom = { list: [], i: 0, back: null };
  function showZoom() {
    var s = zoom.list[zoom.i]; if (!s) return;
    document.getElementById('lb-media').innerHTML = media(s);
    document.getElementById('lb-cap').textContent = s.caption;
    document.getElementById('lb-count').textContent = (zoom.i + 1) + ' of ' + zoom.list.length;
    document.getElementById('lb-prev').hidden = document.getElementById('lb-next').hidden = zoom.list.length < 2;
  }
  function openZoom(key, i, from) {
    var r = run(); if (!r) return;
    var t = PF.parse(r.snapshot), p = key.split('.'), it = t.sections[+p[0]] && t.sections[+p[0]].items[+p[1]];
    if (!it) return;
    zoom = { list: shotsFor(r, key, it), i: i || 0, back: from };
    lb.hidden = false; app.setAttribute('inert', ''); document.querySelector('.top').setAttribute('inert', ''); showZoom(); document.getElementById('lb-close').focus();
  }
  function closeZoom() {
    lb.hidden = true; app.removeAttribute('inert'); document.querySelector('.top').removeAttribute('inert'); document.getElementById('lb-media').innerHTML = '';
    if (zoom.back && document.body.contains(zoom.back)) zoom.back.focus();
  }
  function step(n) { if (zoom.list.length < 2) return; zoom.i = (zoom.i + n + zoom.list.length) % zoom.list.length; showZoom(); }
  document.getElementById('lb-close').addEventListener('click', closeZoom);
  document.getElementById('lb-prev').addEventListener('click', function () { step(-1); });
  document.getElementById('lb-next').addEventListener('click', function () { step(1); });
  lb.addEventListener('click', function (e) { if (e.target === lb) closeZoom(); });
  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeZoom();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'Tab') {
      var f = Array.prototype.slice.call(lb.querySelectorAll('button')).filter(function (x) { return !x.hidden; });
      var idx = f.indexOf(document.activeElement);
      if (e.shiftKey && idx <= 0) { f[f.length - 1].focus(); e.preventDefault(); }
      else if (!e.shiftKey && idx === f.length - 1) { f[0].focus(); e.preventDefault(); }
    }
  });

  boot();
})();
