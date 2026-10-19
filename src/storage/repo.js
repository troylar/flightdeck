/* The team folder: reading everything, saving runs safely, publishing maps. See docs/design.md section 4. */
PF.repo = (function () {
  'use strict';
  var U = PF.util, P = PF.publish, R = PF.run;

  function json(text) { try { return JSON.parse(text); } catch (e) { return undefined; } }
  function readJson(fs, path) { return fs.read(path).then(function (f) { return f ? json(f.text) : null; }); }

  /* The people list as the app shows it, carrying the file's own document and fingerprint, so the folder owner's changes in
     Settings are applied to exactly what was read and saved only over that (repo.savePeople). */
  function loadPeople(fs) {
    return fs.read(PF.people.FILE).then(function (f) {
      var o = f ? json(f.text) : null, out = PF.people.clean(o);
      out.hash = f ? U.hash(f.text) : null; out.doc = o === undefined ? null : o;
      return out;
    });
  }

  function loadDrafts(fs) {
    return fs.list('maps/drafts').then(function (items) {
      return Promise.all(items.filter(function (i) { return i.kind === 'file' && /\.md$/i.test(i.name); }).map(function (i) {
        return fs.read('maps/drafts/' + i.name).then(function (f) { return f ? { file: i.name, md: f.text, mtime: f.mtime } : null; }, function (e) { return { unread: 'maps/drafts/' + i.name, file: i.name, why: why(e) }; });
      }));
    }).then(function (x) {
      var out = x.filter(function (d) { return d && !d.unread; });
      out.unreadable = x.filter(function (d) { return d && d.unread; }).map(function (d) { return { path: d.unread, draft: d.file, why: d.why }; });
      return out;
    });
  }
  function why(e) { return 'couldn\'t be read (' + (e && e.message || String(e)) + ')'; }

  /* What's already been read from a folder. Complete publications never change, and ended runs rarely do, so routine refreshes
     skip them; a deep refresh (the Refresh button) reads everything again. */
  var caches = typeof WeakMap === 'function' ? new WeakMap() : null;
  function newCache() { return { pubs: {}, runs: {}, notes: {}, approved: {}, bad: {}, intern: {}, dec: {}, contentAt: {} }; }
  function cacheOf(fs) { fs = fs && fs._raw || fs; if (!caches) return newCache(); var c = caches.get(fs); if (!c) { c = newCache(); caches.set(fs, c); } return c; }
  /* Run at most n reads at once, so a folder with hundreds of runs doesn't flood OneDrive or the browser. */
  function limited(items, n, fn) {
    var out = new Array(items.length), i = 0;
    function next() { if (i >= items.length) return Promise.resolve(); var k = i++; return Promise.resolve(fn(items[k], k)).then(function (v) { out[k] = v; return next(); }); }
    var workers = []; for (var w = 0; w < Math.min(n, items.length); w++) workers.push(next());
    return Promise.all(workers).then(function () { return out; });
  }

  /* Reading the versions also notes which are unusable here (cache.bad: a hard refusal for runs on them), and forgets what it
     knew about a folder that's gone. Complete versions stay cached, so a routine refresh asks nothing about them. */
  function loadPublications(fs, cache, deep) {
    var seen = {};
    cache.bad = cache.bad || {}; cache.approved = cache.approved || {};
    return fs.list('publications').then(function (procs) {
      return Promise.all(procs.filter(function (p) { return p.kind === 'dir'; }).map(function (p) {
        return fs.list('publications/' + p.name).then(function (vers) {
          return Promise.all(vers.filter(function (v) { return v.kind === 'dir' && P.versionOf(v.name); }).map(function (v) {
            var base = 'publications/' + p.name + '/' + v.name + '/';
            seen[base] = true;
            if (!deep && cache.pubs[base]) return cache.pubs[base];
            return Promise.all(['map.md', 'types.json', 'publication.json'].map(function (n) { return fs.read(base + n); })).then(function (r) {
              var res = P.verify(v.name, { 'map.md': r[0] && r[0].text, 'types.json': r[1] && r[1].text, 'publication.json': r[2] && r[2].text });
              res.folder = v.name; res.process = p.name;
              return checkImages(fs, base, res).then(function (res) {
                if (res.ok) cache.pubs[base] = res; else delete cache.pubs[base];
                if (res.unusable) cache.bad[base] = res.why; else delete cache.bad[base];
                return res;
              });
            });
          }));
        }).then(function (pubs) { return { process: p.name, pubs: pubs, index: P.index(pubs) }; });
      }));
    }).then(function (out) {
      /* A folder that's gone is forgotten, so one recreated under the same name is judged afresh. */
      [cache.pubs, cache.bad, cache.approved].forEach(function (m) { Object.keys(m).forEach(function (k) { if (/^publications\//.test(k) && !seen[k]) delete m[k]; }); });
      return out;
    });
  }

  function bytesHash(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf), s = '';
      for (var i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768));
      return U.hash(s);
    });
  }
  function checkImages(fs, base, res) {
    var imgs = res.ok && res.info.images ? Object.keys(res.info.images) : [];
    return imgs.reduce(function (p, src) {
      return p.then(function (r) {
        if (!r.ok) return r;
        return fs.blob(base + src).then(function (b) { return b ? bytesHash(b) : null; }).then(function (h) {
          return h === res.info.images[src] ? r : { ok: false, why: h ? 'Screenshot ' + src + ' doesn\'t match its publication record.' : 'Still syncing: screenshot ' + src + ' hasn\'t arrived.', info: r.info, folder: r.folder, process: r.process };
        });
      });
    }, Promise.resolve(res));
  }

  /* Every run folder's result, by key ("process/id"), as the app accepts it (docs/design.md section 25):
       fresh: read now, { run, build }   cached: unchanged since it was read, { fileHash, sig, build }   unreadable: { why }
     A run folder without run.json has no result. complete: every process folder in runs/ was listed, which is the only
     thing that lets the app call a run it knew gone. The cache keeps frozen texts (entries), never an object the app shows
     or changes: every cached result is built new from them. freshKeys: runs read in full this time whatever the cache says
     (the app's runs whose last check failed, so only a real read can clear that).
     What each run costs is decided by elapsed time (sched), never by counting refreshes: a run not read before, one the app
     asks for fresh, and every run on Refresh (deep) is read; one past its maximum content age is read in full, bypassing the
     notes cache; a running or recently ended run gets its sizes and times checked (one list, a stat per file) every time; an
     older one gets that check within 10 minutes, a share each refresh; the rest cost nothing. Size and time are only a
     shortcut: they can't prove a file is unchanged, which is why every run is read in full by its maximum age anyway.
     o: { priority: {key: rank} (0 first), onBatch(batch), batch: results per batch }. With onBatch, fresh and unreadable
     results are handed over as they arrive, with the keys still pending; a batch never says a run is missing. */
  function loadRuns(fs, cache, deep, freshKeys, sched, o) {
    o = o || {};
    var force = {}; (freshKeys || []).forEach(function (k) { force[k] = true; });
    return fs.list('runs').then(function (procs) {
      return Promise.all(procs.filter(function (p) { return p.kind === 'dir'; }).map(function (p) {
        return fs.list('runs/' + p.name).then(function (items) { return items.filter(function (i) { return i.kind === 'dir'; }).map(function (i) { return p.name + '/' + i.name; }); });
      }));
    }).then(function (nested) {
      var unreadable = [], keys = [].concat.apply([], nested), listed = {};
      keys.forEach(function (k) { listed[k] = true; });
      /* A run folder that's gone is forgotten, so one that comes back under the same name is read again. */
      Object.keys(cache.runs).forEach(function (k) { if (!listed[k]) delete cache.runs[k]; });
      Object.keys(cache.contentAt).forEach(function (k) { if (!listed[k]) delete cache.contentAt[k]; });
      var plan = planRuns(keys, cache, deep, force, sched), pr = o.priority || null;
      function rank(k) { if (pr) return pr[k] != null ? pr[k] : 2; var h = cache.runs[k]; return !h ? 2 : !h.entry.ended ? 0 : recent(h.entry, sched.wall) ? 1 : 3; }
      /* Reads first (overdue runs, after a hidden tab or a long pause), each group in priority order: running, recently
         ended, not known yet (new folders are likely new runs), the rest. */
      var order = keys.map(function (k, i) { return { k: k, i: i, r: (plan[k] === 'read' || plan[k] === 'content' ? 0 : 10) + rank(k) }; })
        .sort(function (a, b) { return a.r - b.r || a.i - b.i; }).map(function (x) { return x.k; });
      var size = o.batch || config.batch, batch = null, inBatch = 0, done = 0, finished = {};
      function flush() {
        var b = batch; batch = null; inBatch = 0;
        Object.keys(b.reads).forEach(function (k) { markBad(b.reads[k], cache); });
        o.onBatch({ reads: b.reads, unreadable: b.unreadable, done: done, total: keys.length, pending: keys.filter(function (k) { return !finished[k]; }) });
      }
      return limited(order, 8, function (key) {
        var hit = cache.runs[key], proc = key.split('/')[0], id = key.split('/')[1], bad = [], dir = 'runs/' + key;
        /* One run that can't be read (a placeholder OneDrive hasn't downloaded, a file being replaced) is listed as unreadable;
           the rest of the folder still loads. */
        return go().then(null, function (e) { delete cache.runs[key]; bad.push({ path: dir + '/run.json', key: key, why: why(e) }); return null; }).then(function (res) {
          unreadable.push.apply(unreadable, bad);
          res = res || (bad.length ? { kind: 'unreadable', why: bad[0].why } : null);
          done++; finished[key] = true;
          if (o.onBatch && res && (res.kind === 'fresh' || res.kind === 'unreadable')) {
            batch = batch || { reads: {}, unreadable: [] }; batch.reads[key] = res; batch.unreadable.push.apply(batch.unreadable, bad);
            if (++inBatch >= size) flush();
          }
          return res;
        });
        function go() {
          var what = plan[key];
          if (what === 'skip') return Promise.resolve(cachedResult(hit.entry, cache));
          if (what === 'meta') return fingerprint(fs, dir).then(function (fp) {
            if (fp === hit.fp && !(hit.entry.recheckAt && Date.now() >= hit.entry.recheckAt)) { hit.metaAt = sched.now; return cachedResult(hit.entry, cache); }
            return read(false);
          });
          return read(what === 'content');
        }
        /* full: read every file in full, bypassing the notes cache (Refresh, or past the run's maximum content age). */
        function read(full) {
          /* However this read came about (a run not cached since this window wrote to it, sizes or times that changed), it's
             a full read when the run's last full read is past its maximum age: writing more often than refreshing never
             postpones it. */
          var t0 = sched.now, all = deep || full || overdue(cache, key, t0);
          /* A folder whose reads don't give their own size and time: fingerprint before and after reading, and cache only if
             nothing changed in between. */
          if (!cache.sized || !fs.stat) {
            var before;
            return fingerprint(fs, dir).then(function (fp) { before = fp; return readRun(fs, proc, id, cache, all, true, bad); }).then(function (entry) {
              if (cache.sized == null && entry) cache.sized = isExact(entry);
              return fingerprint(fs, dir).then(function (after) { return keep(entry, after === before ? after : null, t0, all); });
            });
          }
          /* Sizes and times come with the reads: stat only the files that weren't read (copies, receipts, history), then
             list again. The run is cached only if the folder still holds the same files, under the stamps of the texts read;
             anything that changed after its read shows up as a different stamp at the next check. */
          return readRun(fs, proc, id, cache, all, true, bad).then(function (entry) {
            if (!entry) return keep(null, null, t0, all);
            if (!isExact(entry)) cache.sized = false;
            var others = entry.names.filter(function (n) { return entry.stamps[n] == null; });
            return Promise.all(others.map(function (n) { return fs.stat(dir + '/' + n).then(function (st) { return st ? st.size + ':' + st.mtime : '-'; }); })).then(function (st) {
              var got = {}; others.forEach(function (n, i) { got[n] = st[i]; });
              return fs.list(dir).then(function (items) {
                var now = items.filter(function (i) { return i.kind === 'file'; }).map(function (i) { return i.name; }).sort();
                var fp = isExact(entry) && now.join('/') === entry.names.join('/') ? entry.names.map(function (n) { return n + ':' + (got[n] || entry.stamps[n]); }).join('/') : null;
                return keep(entry, fp, t0, all);
              });
            });
          });
        }
        function keep(entry, fp, t0, all) {
          if (!entry || !fp) delete cache.runs[key];
          if (!entry) return null;
          /* A full read (every file read now, none from memory) starts the content age again; anything less keeps the age of
             the last full read, which outlives the entry (this window's own writes drop the entry, and must never extend the
             age: notes may still come from memory). Never read in full here: due at once. */
          var rec = cache.contentAt[key], age = all || entry.full ? t0 : rec ? rec.at : -Infinity;
          cache.contentAt[key] = { at: age, ended: entry.ended };
          if (fp) cache.runs[key] = { entry: entry, fp: fp, metaAt: t0, contentAt: age };
          var run = build(entry, cache);
          return { kind: 'fresh', run: run, fileHash: entry.fileHash, build: function () { return build(entry, cache); } };
        }
      }).then(function (list) {
        /* What's left of the last batch arrives with the complete result, which follows at once. */
        var reads = {}, used = {};
        order.forEach(function (k, i) { if (list[i]) reads[k] = list[i]; });
        Object.keys(cache.runs).forEach(function (k) { var e = cache.runs[k].entry; used[e.internKey] = true; });
        Object.keys(reads).forEach(function (k) { if (reads[k].run) used[reads[k].run.folder + '|' + reads[k].run.mapHash] = true; });
        Object.keys(cache.intern).forEach(function (k) { if (!used[k]) delete cache.intern[k]; });
        return { reads: reads, keys: keys, complete: true, unreadable: unreadable };
      });
    });
  }
  /* Whether a run's last full read (cache.contentAt, which outlives its cache entry) is past its maximum age at now, in the
     folder's own elapsed time; a run never read in full, or an age that's ahead of now, is overdue. */
  function overdue(cache, key, now) {
    var rec = cache.contentAt[key]; if (!rec || now == null) return true;
    return now - rec.at >= (rec.ended ? config.endedMs : config.liveMs) || now < rec.at;
  }
  /* The folder's elapsed time right now, without starting a new refresh: for the open run's reread between refreshes. A
     clock that went back (elapsed at all, or the wall clock by more than 2 minutes) gives null: everything is overdue. */
  function peekNow(cache) {
    var c = cache.clk; if (!c) return null;
    var dm = (cache.clockFn || elapsed)() - c.mono, dw = Date.now() - c.wall;
    return dm < 0 || dw < -BACK_MS ? null : c.v + Math.max(0, dm, dw);
  }
  /* A run's stamps all came with its reads (or from memory under the same stamps). */
  function isExact(entry) { return ['run.json'].concat(entry.names.filter(function (n) { return /^notes-[\w-]+\.jsonl$/.test(n); })).every(function (n) { return entry.stamps[n] != null; }); }
  /* Ended within recentMs by the run's own end time, against the wall clock (wall): a clock set back only makes more runs
     look recent, which checks more, never less. */
  function recent(entry, wall) { return entry.ended && entry.endedAt && wall - entry.endedAt < config.recentMs; }
  /* What each listed run costs this time: 'read' (not known, asked for fresh, Refresh, or a save receipt's grace time is
     up), 'content' (past its maximum content age: read in full), 'meta' (sizes and times checked) or 'skip'. */
  function planRuns(keys, cache, deep, force, sched) {
    var plan = {}, live = [], ended = [];
    keys.forEach(function (k) {
      var h = cache.runs[k];
      if (deep || force[k] || !h || (h.entry.recheckAt && Date.now() >= h.entry.recheckAt)) plan[k] = 'read';
      else (h.entry.ended ? ended : live).push(k);
    });
    function at(f) { return function (k) { return cache.runs[k][f]; }; }
    sched.due('live', live, at('contentAt'), config.liveMs).forEach(function (k) { plan[k] = 'content'; });
    sched.due('ended', ended, at('contentAt'), config.endedMs).forEach(function (k) { plan[k] = 'content'; });
    var old = [];
    live.concat(ended).forEach(function (k) { if (plan[k]) return; if (!cache.runs[k].entry.ended || recent(cache.runs[k].entry, sched.wall)) plan[k] = 'meta'; else old.push(k); });
    sched.due('meta', old, at('metaAt'), config.metaMs).forEach(function (k) { plan[k] = 'meta'; });
    keys.forEach(function (k) { if (!plan[k]) plan[k] = 'skip'; });
    return plan;
  }
  /* Elapsed time for one refresh of a folder, from two clocks: the monotonic one (performance.now, which some systems pause
     while the computer sleeps) and the wall clock (which a person can change). Time since the last refresh is the larger of
     the two (counted once, never added), kept as the folder's own running total (cache.clk.v), which is what every age is
     measured in. Either clock going backward can't say how old anything is, so everything is due. due(name, keys, lastOf,
     maxMs) picks every key at or past maxMs since its last time, then the oldest others until this kind has had its share
     of the time since the last refresh: keys × elapsed / maxMs, carried over, so the work is spread evenly and each key
     comes up within maxMs. */
  /* A wall clock that steps back less than this while elapsed time moves on is time sync, not a clock set back. */
  var BACK_MS = 120000;
  function scheduler(cache, clock, deep, wall) {
    var mono = clock(), c = cache.clk, dm = c ? mono - c.mono : 0, dw = c ? wall - c.wall : 0, back = dm < 0 || dw < -BACK_MS;
    var dt = Math.max(0, dm, dw), now = (c ? c.v : 0) + dt;
    cache.clk = { mono: mono, wall: wall, v: now }; cache.credit = cache.credit || {};
    return { now: now, wall: wall, deep: deep, due: function (name, keys, lastOf, maxMs) {
      if (!keys.length) { cache.credit[name] = 0; return []; }
      if (back) { cache.credit[name] = 0; return keys.slice(); }
      var span = Math.min(dt, maxMs), credit = Math.min(keys.length, (cache.credit[name] || 0) + keys.length * span / maxMs);
      var sorted = keys.map(function (k, i) { return { k: k, t: lastOf(k), i: i }; }).sort(function (a, b) { return a.t - b.t || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0); });
      var out = sorted.filter(function (x) { return (x.o = now - x.t >= maxMs || now < x.t); });
      for (var i = 0; i < sorted.length && out.length < Math.floor(credit); i++) if (!sorted[i].o) out.push(sorted[i]);
      cache.credit[name] = Math.max(0, credit - out.length);
      return out.map(function (x) { return x.k; });
    } };
  }
  function cachedResult(entry, cache) {
    return { kind: 'cached', fileHash: entry.fileHash, entry: entry, sig: sigOf(entry.fileHash, entry.notesSig, entry.conflicts, entry.unrunnable || badFor(cache, entry), entry.recheckAt),
      build: function () { return build(entry, cache); } };
  }
  function badFor(cache, entry) { return (cache.bad || {})['publications/' + entry.process + '/' + entry.folder + '/'] || ''; }
  /* What a displayed run and a cached result are compared by: the same file, notes, copies and read-only reason. */
  function sigOf(fileHash, notesSig, conflicts, unrunnable, recheckAt) { return [fileHash || '', notesSig || '', (conflicts || []).join('/'), unrunnable || '', recheckAt || ''].join('|'); }
  function runSig(run) { return sigOf(run._fileHash, run._notesSig, run._conflicts, run._unrunnable, run._recheckAt); }
  /* A run object built from a cache entry's texts, the same way a fresh read builds one: new every time. Runs of one version
     share one checklist text and one step-type object, but only when they're equal (cache.intern). */
  function build(entry, cacheIn) {
    var run = R.sanitize(json(entry.text)), base = entry.base;
    if (!run._unrunnable && entry.unrunnable) run._unrunnable = entry.unrunnable;
    var bad = cacheIn ? badFor(cacheIn, entry) : '';
    if (bad && !run._unrunnable) run._unrunnable = bad;
    run._path = base; run._mtime = entry.mtime; run._conflicts = entry.conflicts.slice(); run._fileHash = entry.fileHash; run._notesSig = entry.notesSig;
    if (entry.recheckAt) run._recheckAt = entry.recheckAt;
    var notes = [];
    entry.notes.forEach(function (t) {
      if (t == null) return;
      t.split('\n').forEach(function (line) { var n = line.trim() && json(line); if (n && typeof n.text === 'string' && typeof n.id === 'string') notes.push(cleanNote(n, base)); });
    });
    run._notes = notes.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    if (cacheIn) intern(run, cacheIn);
    return run;
  }
  /* Interned step types are shared by many runs: frozen in tests (PF.run.mapMemo.freeze), so nothing may change them. */
  function intern(run, cache) {
    var k = run.folder + '|' + run.mapHash, e = cache.intern[k], tj = JSON.stringify(run.types);
    if (!e) { e = cache.intern[k] = { snapshot: run.snapshot, typesJson: tj, types: json(tj) }; if (R.mapMemo && R.mapMemo.freeze && e.types) R.mapMemo.deepFreeze(e.types); }
    if (run.snapshot === e.snapshot) run.snapshot = e.snapshot;
    if (tj === e.typesJson) run.types = e.types;
  }
  /* Names, sizes and times of the files directly in a run folder: cheap to get, and different whenever anything in it changed. */
  function fingerprint(fs, dir) {
    return fs.list(dir).then(function (items) {
      var files = items.filter(function (i) { return i.kind === 'file'; }).map(function (i) { return i.name; }).sort();
      if (!fs.stat) return files.join('/');
      return Promise.all(files.map(function (n) { return fs.stat(dir + '/' + n).then(function (st) { return n + ':' + (st ? st.size + ':' + st.mtime : '-'); }); })).then(function (x) { return x.join('/'); });
    });
  }

  /* A file's size and time, or '' when the folder doesn't give both: a record replaced in place gets a new one. */
  function fileStamp(fs, path) {
    if (!fs.stat) return Promise.resolve('');
    return fs.stat(path).then(function (st) { return st && st.size != null && st.mtime != null ? st.size + ':' + st.mtime : ''; }, function () { return ''; });
  }
  /* Why the publication a run names can't be recorded on here, or ''. Checked for that one publication only, when the run is
     saved or the open run is reread, so routine refreshes cost nothing. One known unusable is refused with no read. One whose
     format was approved is trusted only while its record keeps the same size and time (one stat); without both, or once they
     change, the record is read again, and an approval is kept only with a real size and time. A missing or unreadable
     record says nothing (it may still be syncing, and the run carries its own copy of the checklist). */
  var CHANGED = 'This version was changed in the folder after this copy checked it, so nothing can be recorded on it until it\'s checked again. Choose Refresh.';
  /* A run started from other contents than the version it names holds is refused, for that run only (never cached). */
  function runMismatch(run, info) { return info && (run.folder !== info.folder || (run.mapHash && run.mapHash !== info.mapHash) || (run.version && +run.version !== info.version)) ? CHANGED : ''; }
  function pubProblem(fs, run, cacheIn) {
    if (!run || typeof run.process !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(run.process) || typeof run.folder !== 'string' || !P.versionOf(run.folder)) return Promise.resolve('');
    var c = cacheIn || cacheOf(fs), dir = 'publications/' + run.process + '/' + run.folder + '/', rec = dir + 'publication.json';
    c.approved = c.approved || {}; c.bad = c.bad || {};
    if (c.bad[dir]) return Promise.resolve(c.bad[dir]);
    return fileStamp(fs, rec).then(function (stamp) {
      var ok = c.approved[dir];
      if (stamp && ok && ok.stamp === stamp) return runMismatch(run, ok.info);
      delete c.approved[dir];
      return fs.read(rec).then(function (f) {
        var info = f && json(f.text);
        if (!info || typeof info !== 'object' || Array.isArray(info)) return '';
        if (info.format !== P.FORMAT) return P.NEWER;
        /* Same format, different contents from what this copy verified: unusable here until the versions are read again,
           which the next refresh now does, since its cached check is dropped. */
        var was = c.pubs[dir] ? c.pubs[dir].info : null;
        if (info.folder !== run.folder || (was && (info.mapHash !== was.mapHash || info.typesHash !== was.typesHash || info.version !== was.version))) {
          delete c.pubs[dir];
          return (c.bad[dir] = CHANGED);
        }
        var approve = function (v) { if (stamp) c.approved[dir] = { stamp: stamp, info: { folder: v.folder, mapHash: v.mapHash, version: v.version } }; return runMismatch(run, v); };
        if (was) return approve(was);
        /* Never verified here: verify the version itself, once (its checklist and step types, as a refresh would). A run's
           own copy of them is never taken as evidence for the version, so one run can't vouch for it for every other run.
           Files not there yet, or not matching the record, are still syncing: no approval, checked again next time. */
        return Promise.all([fs.read(dir + 'map.md'), fs.read(dir + 'types.json')]).then(function (r) {
          var v = P.verify(run.folder, { 'map.md': r[0] && r[0].text, 'types.json': r[1] && r[1].text, 'publication.json': f.text });
          if (!v.ok) return v.unusable ? (c.bad[dir] = v.why) : '';
          return approve(info);
        }, function () { return ''; });
      }, function () { return ''; });
    });
  }
  /* allRuns: part of a refresh of every run, which checks publications only through cache.bad (see loadAll); rereading
     one run (the open one) also checks its own publication. */
  /* bad: a list that a run.json which can't be understood is added to (it's never just left out). */
  function loadRun(fs, proc, id, cacheIn, deep, allRuns, bad) {
    cacheIn = cacheIn || cacheOf(fs);
    /* The open run's reread takes unchanged notes from memory, except past the run's maximum content age, when it reads
       them all: the same age the refresh keeps, so this window's own writes never postpone it. */
    var key = proc + '/' + id, now = peekNow(cacheIn), full = deep || (!!cacheIn.contentAt && !!cacheIn.contentAt[key] && overdue(cacheIn, key, now));
    return readRun(fs, proc, id, cacheIn, full, allRuns, bad).then(function (entry) {
      if (!entry) return null;
      if ((full || entry.full) && now != null && cacheIn.contentAt) cacheIn.contentAt[key] = { at: now, ended: entry.ended };
      return build(entry, cacheIn);
    });
  }
  /* A run folder read into a frozen entry: run.json's text, each notes file's text, the conflict copies found, and when to
     look again at a save that may still be arriving. Objects are built from it (build), never kept in it. It also records
     the folder's file names and, for each file read, the size and time that came with the very text read (stamps), so a
     refresh can tell later whether anything changed without asking again (docs/design.md section 25). full: every notes
     file was read now, none taken from memory. */
  function readRun(fs, proc, id, cacheIn, deep, allRuns, bad) {
    cacheIn = cacheIn || cacheOf(fs); fs = bounded(fs, allRuns ? 'load' : 'open');
    var base = 'runs/' + proc + '/' + id + '/', stamps = {}, full = true;
    function stampOf(f) { return f && f.size != null && f.mtime != null ? f.size + ':' + f.mtime : null; }
    function withPublication(res) {
      if (allRuns) return res;
      var o = res[0] && json(res[0].text);
      return pubProblem(fs, o, cacheIn).then(function (why) { res.pubProblem = why; return res; });
    }
    return fs.list(base.slice(0, -1)).then(function (items) {
      var names = items.filter(function (i) { return i.kind === 'file'; }).map(function (i) { return i.name; });
      var extra = names.filter(function (n) { return n !== 'run.json' && /^run.*\.json$/i.test(n); });
      var noteFiles = names.filter(function (n) { return /^notes-[\w-]+\.jsonl$/.test(n); });
      if (names.indexOf('run.json') < 0) return null;
      /* Notes files only grow, so one that hasn't changed size or time since the last read is taken from memory. */
      var notesCache = cacheIn.notes;
      function same(a, b) { return !!a && !!b && a.size === b.size && a.mtime === b.mtime; }
      function remember(path, n, f) { var st = stampOf(f); stamps[n] = st; if (st) notesCache[path] = { size: f.size, mtime: f.mtime, file: { text: f.text, mtime: f.mtime } }; else delete notesCache[path]; return f; }
      function readNotes(n) {
        var path = base + n, hit = notesCache[path];
        if (!fs.stat) return fs.read(path);
        /* Reading the whole folder from a folder whose reads give their size and time: nothing remembered (or a full
           reread), so read it straight away, with no stat before. */
        if (allRuns && cacheIn.sized && (deep || !hit)) return fs.read(path).then(function (f) { if (f && !stampOf(f)) cacheIn.sized = false; return remember(path, n, f); });
        return fs.stat(path).then(function (st) {
          if (!deep && hit && same(hit, st)) { full = false; stamps[n] = hit.size + ':' + hit.mtime; return hit.file; }
          return fs.read(path).then(function (f) {
            /* A read that says its own size and time describes exactly the text it returned: remembered under those. */
            if (stampOf(f)) return remember(path, n, f);
            /* Otherwise cached only when the file didn't change while it was being read; else it's read again next time. */
            return fs.stat(path).then(function (st2) { if (f && same(st, st2)) { notesCache[path] = { size: st2.size, mtime: st2.mtime, file: f }; stamps[n] = st2.size + ':' + st2.mtime; } else { delete notesCache[path]; stamps[n] = null; } return f; });
          });
        });
      }
      return Promise.all([fs.read(base + 'run.json')].concat(noteFiles.map(readNotes))).then(withPublication).then(function (res) {
        var run = res[0] && R.sanitize(json(res[0].text));
        if (!run) { if (res[0] && bad) bad.push({ path: base + 'run.json', key: proc + '/' + id, why: json(res[0].text) === undefined ? 'isn\'t complete JSON (it may still be arriving)' : 'isn\'t a run this copy can read' }); return null; }
        stamps['run.json'] = stampOf(res[0]);
        var notesTexts = res.slice(1).map(function (f) { return f ? f.text : null; });
        /* A run started by a newer copy on a version in a publication format this copy doesn't know is read-only, even when
           its own copy of the checklist happens to read. */
        var entry = { process: proc, folder: run.folder, internKey: run.folder + '|' + run.mapHash, base: base, text: res[0].text, mtime: res[0].mtime, fileHash: U.hash(res[0].text),
          notes: notesTexts, notesSig: U.hash(noteFiles.join('/') + '\u0000' + notesTexts.map(function (t) { return t == null ? '-' : t.length + ':' + U.hash(t); }).join('/')),
          unrunnable: run._unrunnable || res.pubProblem || '', ended: !!run.ended, endedAt: run.ended ? Date.parse(run.ended.at) || 0 : 0, conflicts: extra, recheckAt: 0,
          names: names.slice().sort(), stamps: stamps, full: full };
        function done() { Object.freeze(entry.conflicts); Object.freeze(entry.notes); Object.freeze(entry.names); Object.freeze(entry.stamps); return Object.freeze(entry); }
        /* A candidate whose save isn't listed in run.json, and that's old enough not to be a save still in progress, was
           overwritten by another window or computer: it's offered like any other conflict copy. */
        var lineage = run.lineage || [], lost = names.filter(function (n) { var t = candidateTag(n); return t && lineage.indexOf(t) < 0; });
        if (!lost.length) return done();
        var now = Date.now(), current = sameRun(res[0].text);
        return Promise.all(lost.map(function (n) {
          var age = fs.stat ? fs.stat(base + n).then(function (st) { return st ? st.mtime : now; }, function () { return now; }) : Promise.resolve(0);
          return age.then(function (mtime) {
            /* Still within the grace period: maybe a save in progress. Check again once it's old enough (finished runs too). */
            if (now - mtime < config.candidateGraceMs) { var at = mtime + config.candidateGraceMs; entry.recheckAt = entry.recheckAt ? Math.min(entry.recheckAt, at) : at; return null; }
            /* A receipt whose contents are already the current version lost nothing (a late delivery, or a save older than the
               list remembers): it's removed instead of shown as a conflict. Names are unique per save, so this can't race. */
            return fs.read(base + n).then(function (f) {
              if (f && sameRun(f.text) === current) { fs.remove(base + n).catch(function () {}); return null; }
              return n;
            }, function () { return n; });
          });
        }))
          .then(function (old) {
            old = old.filter(Boolean);
            if (!old.length || !extra.length) { entry.conflicts = extra.concat(old); return done(); }
            /* A lost save that OneDrive already kept as its own conflict copy is listed once, not twice. */
            return Promise.all(extra.concat(old).map(function (n) { return fs.read(base + n).then(function (f) { return f ? f.text : '\u0000' + n; }, function () { return '\u0000' + n; }); })).then(function (h) {
              var known = h.slice(0, extra.length);
              entry.conflicts = extra.concat(old.filter(function (n, i) { return known.indexOf(h[extra.length + i]) < 0; }));
              return done();
            });
          });
      });
    });
  }

  /* Notes come from files anyone can edit: keep only the shape the app understands, and only attachments inside this run's files/ folder. */
  function cleanNote(n, base) {
    var files = Array.isArray(n.files) ? n.files.filter(function (f) { return PF.attach.pathOk(f, base); }) : [];
    var c = { id: n.id.slice(0, 40), at: typeof n.at === 'string' ? n.at : '', by: typeof n.by === 'string' ? n.by.slice(0, 80) : '', session: typeof n.session === 'string' ? n.session.slice(0, 40) : '',
      step: typeof n.step === 'string' ? n.step.slice(0, 60) : '', text: n.text.slice(0, 2000), files: files, fileInfo: PF.attach.cleanInfo(n.fileInfo, files), kind: n.kind === 'map' || n.kind === 'fix' || n.kind === 'correction' ? n.kind : undefined };
    if (n.kind === 'correction') return Object.assign(c, PF.corrections.cleanNote(n));
    if (n.kind === 'fix') {
      /* A suggested fix from before 1.13: its kind and target, read as before. */
      var t = n.target && typeof n.target === 'object' ? n.target : {};
      c.fixKind = /^(missing|instructions|screenshot|order|role|other)$/.test(n.fixKind || '') ? n.fixKind : 'other';
      c.target = { phase: typeof t.phase === 'string' ? t.phase.slice(0, 60) : '', step: typeof t.step === 'string' && t.step ? t.step.slice(0, 60) : null };
      c.version = typeof n.version === 'number' && isFinite(n.version) ? Math.floor(n.version) : 0;
    }
    return c;
  }

  function loadLegacy(fs) {
    return fs.list('runs').then(function (items) {
      return Promise.all(items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) {
        return readJson(fs, 'runs/' + i.name).then(function (o) { return o && o.format === 'preflight-run/1' ? { file: i.name, name: o.name, ended: o.ended, started: o.started } : null; });
      }));
    }).then(function (x) { return x.filter(Boolean); });
  }

  function loadJsonDir(fs, dir, ok) {
    return fs.list(dir).then(function (items) {
      return Promise.all(items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) {
        return readJson(fs, dir + '/' + i.name).then(function (o) { if (o && ok(o)) { o._file = i.name; return o; } return null; });
      }));
    }).then(function (x) { return x.filter(Boolean); });
  }

  /* Each part of the folder is read on its own: one that fails is named in failed (the app keeps what it read before for it).
     A folder that can't be listed, or where every part fails, is an unreadable folder. */
  var PARTS = ['people', 'drafts', 'publications', 'runs', 'legacy', 'skills', 'proposals', 'step types', 'Jira workflows', 'sign-offs', 'corrections', 'follow-ups'];
  /* The same folder, with at most 8 reads, lists and stats in flight at once however many runs and notes files it holds.
     Only those leaf calls wait for a turn, so nothing waiting holds a turn another call needs. Caches stay keyed by the
     folder itself. */
  function bounded(fs, lane) {
    if (fs._bounded) return fs;
    lane = lane || 'load';
    var raw = fs, ws = wrappers ? wrappers.get(raw) : null;
    if (ws && ws[lane]) return ws[lane];
    var go = poolOf(raw), b = Object.create(raw);
    ['list', 'read', 'stat', 'blob'].forEach(function (m) { if (typeof raw[m] === 'function') b[m] = function (p) { return go(lane, function () { return raw[m](p); }); }; });
    b._bounded = lane; b._raw = raw;
    if (wrappers) { ws = ws || {}; ws[lane] = b; wrappers.set(raw, ws); }
    return b;
  }
  /* One pool of 8 per folder, shared by loading, the open run's reread, thumbnails and (later) export. Waiting calls start
     in lane order: the open run first, then loading, then thumbnails (at most 4 at once), then export (at most 2), so
     pictures or an export never slow the run being recorded. */
  var LANES = ['open', 'load', 'thumb', 'export'], LANE_MAX = { open: 8, load: 8, thumb: 4, export: 2 };
  var pools = typeof WeakMap === 'function' ? new WeakMap() : null, wrappers = typeof WeakMap === 'function' ? new WeakMap() : null;
  function poolOf(fs) {
    fs = fs && fs._raw || fs;
    var p = pools && pools.get(fs);
    if (!p) { p = lanes(8); if (pools) pools.set(fs, p); }
    return p;
  }
  function lanes(n) {
    var active = 0, by = {}, q = {};
    function next() {
      while (active < n) {
        var lane = null;
        for (var i = 0; i < LANES.length && !lane; i++) { var l = LANES[i]; if (q[l] && q[l].length && (by[l] || 0) < LANE_MAX[l]) lane = l; }
        if (!lane) return;
        start(lane, q[lane].shift());
      }
    }
    function start(lane, job) {
      active++; by[lane] = (by[lane] || 0) + 1;
      var end = function () { active--; by[lane]--; next(); };
      Promise.resolve().then(job.fn).then(function (v) { end(); job.res(v); }, function (e) { end(); job.rej(e); });
    }
    return function (lane, fn) { if (!LANE_MAX[lane]) lane = 'load'; return new Promise(function (res, rej) { (q[lane] = q[lane] || []).push({ fn: fn, res: res, rej: rej }); next(); }); };
  }
  /* Runs and versions are read side by side, so a run read before its version was judged unusable is marked when its
     result is handed over. */
  function markBad(x, cache) { if (x.kind !== 'fresh') return; var bad = cache.bad && cache.bad['publications/' + x.run.process + '/' + x.run.folder + '/']; if (bad && !x.run._unrunnable) x.run._unrunnable = bad; }
  /* Elapsed time on this computer, never the wall clock (which can be changed or roll back). */
  function elapsed() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
  /* opts: { deep: read everything again (Refresh), fresh: run keys to read in full whatever the cache says, clock: elapsed
     milliseconds (performance.now by default), now: the wall clock's time (Date.now by default; only says which runs ended
     recently), priority, onBatch, batch: see loadRuns }. The result's reads (by run key)
     and runsComplete are what the app applies; runs is built from them only when someone asks for it. */
  function loadAll(fs, opts) {
    opts = opts || {};
    var cache = cacheOf(fs); fs = bounded(fs); var deep = !!opts.deep, failed = {}, errs = [];
    cache.clockFn = opts.clock || elapsed;
    var sched = scheduler(cache, cache.clockFn, deep, opts.now != null ? opts.now : Date.now());
    var EMPTY = [[], [], [], { reads: {}, keys: [], complete: false, unreadable: [] }, [], [], [], { types: {}, errors: [], skipped: 0 }, { workflows: null, errors: [] }, [], [], []];
    /* The folder itself must list: one that can't is unreadable, never empty. */
    return fs.list('').then(function () { return Promise.all([loadPeople(fs), loadDrafts(fs), loadPublications(fs, cache, deep), loadRuns(fs, cache, deep, opts.fresh, sched, opts), loadLegacy(fs),
      loadSkills(fs),
      loadJsonDir(fs, 'proposals', function (o) { return o.kind === 'plan' || o.kind === 'status'; }),
      loadStepTypes(fs), loadWorkflows(fs),
      loadJsonDir(fs, 'validations', function (o) { return o.kind === 'validation' && typeof o.process === 'string' && typeof o.folder === 'string' && typeof o.by === 'string' && typeof o.at === 'string'; }),
      loadCorrectionDecisions(fs, cache, sched),
      loadFollowUpDecisions(fs, cache, sched)
    ].map(function (p, i) { return p.then(null, function (e) { failed[PARTS[i]] = e && e.message || String(e); errs.push(e); return EMPTY[i]; }); })); }).then(function (r) {
      if (errs.length === PARTS.length) throw errs[0];
      var unreadable = r[3].unreadable.concat(r[1].unreadable || []), reads = r[3].reads, keys = r[3].keys, complete = r[3].complete;
      /* Sign-offs are read as plain strings and numbers only, so odd values in a file can't break a page. */
      r[9] = r[9].map(function (v) { var o = { kind: 'validation', process: v.process.slice(0, 60), folder: v.folder.slice(0, 60), by: v.by.slice(0, 80), at: v.at.slice(0, 40), version: typeof v.version === 'number' && isFinite(v.version) ? v.version : 0, note: typeof v.note === 'string' ? v.note.slice(0, 300) : '', _file: v._file }; if (v.as === 'backup') o.as = 'backup'; return o; });
      var props = r[6], statuses = props.filter(function (p) { return p.kind === 'status'; }), plans = props.filter(function (p) { return p.kind === 'plan' && typeof p.id === 'string' && typeof p.process === 'string'; });
      /* A decision counts only for the exact plan it was made on; if the plan changed afterwards, it's pending again. */
      plans.forEach(function (p) {
        p._hash = U.hash(JSON.stringify(stripMeta(p)));
        var mine = statuses.filter(function (s) { return s.proposal === p.id; });
        /* Decisions that disagree (one accepted, one declined) leave the plan undecided rather than picking one. */
        var match = mine.filter(function (s) { return s.proposalHash === p._hash; });
        p._conflicting = match.some(function (s) { return s.status !== match[0].status; });
        p._status = match.length && !p._conflicting ? match[0] : null;
        p._changedAfterDecision = !p._status && !p._conflicting && mine.length > 0;
      });
      /* Runs and versions are read side by side, so a run read before its version was judged unusable is marked here. */
      keys.forEach(function (k) {
        var x = reads[k]; if (!x) return;
        markBad(x, cache);
        if (x.kind === 'cached') { var e = x.entry; x.sig = sigOf(e.fileHash, e.notesSig, e.conflicts, e.unrunnable || badFor(cache, e), e.recheckAt); delete x.entry; }
      });
      var out = { people: r[0], drafts: r[1], processes: r[2], reads: reads, runsComplete: complete, legacy: r[4], skills: r[5], validations: r[9], corrDecisions: r[10].filter(function (d) { return !d._unread; }), corrUnread: r[10].filter(function (d) { return d._unread; }),
        fuDecisions: r[11].filter(function (d) { return !d._unread; }), fuUnread: r[11].filter(function (d) { return d._unread; }), plans: plans, stepTypes: r[7], jira: r[8],
        unreadable: unreadable, failed: failed, skillsSkipped: r[5].skipped || 0, readAt: new Date().toISOString() };
      /* Every run, as objects: fresh ones as read, cached ones built new. Built on first use, since the app applies reads instead. */
      var runs = null;
      Object.defineProperty(out, 'runs', { enumerable: true, configurable: true,
        get: function () { if (!runs) runs = keys.map(function (k) { var x = reads[k]; return !x ? null : x.kind === 'fresh' ? x.run : x.kind === 'cached' ? x.build() : null; }).filter(Boolean); return runs; },
        set: function (v) { runs = v; } });
      return out;
    });
  }
  /* Decision files are written once and tiny. Each refresh lists their folders; a file is read when it's new, couldn't be
     read or understood last time, on Refresh, or once it's past the hour (a share each refresh, as runs are), and otherwise
     taken from the text kept from its last read. A file that's gone from the listing is forgotten. dirs: the top folders
     this listing covered; texts are kept by path in cache.dec. */
  function decisionTexts(fs, cache, sched, dirs, items, kind) {
    var dec = cache.dec = cache.dec || {}, listed = {};
    items.forEach(function (x) { listed[x.path] = true; });
    Object.keys(dec).forEach(function (p) { if (!listed[p] && dirs.indexOf(p.split('/')[0]) >= 0) delete dec[p]; });
    var known = sched && !sched.deep ? items.filter(function (x) { return dec[x.path]; }).map(function (x) { return x.path; }) : [];
    var due = {}; (sched ? sched.due(kind, known, function (p) { return dec[p].at; }, config.endedMs) : []).forEach(function (p) { due[p] = true; });
    return limited(items, 8, function (x) {
      var hit = dec[x.path];
      if (sched && !sched.deep && hit && !due[x.path]) return { x: x, f: { text: hit.text } };
      return fs.read(x.path).then(function (f) {
        if (f && sched) dec[x.path] = { text: f.text, at: sched.now }; else delete dec[x.path];
        return { x: x, f: f };
      }, function () { delete dec[x.path]; return { x: x, failed: true }; });
    });
  }
  /* What couldn't be read or understood is never kept, so it's read again next time: only a real read clears a failure. */
  function forgetText(cache, path) { if (cache && cache.dec) delete cache.dec[path]; }
  /* Decisions on corrections: corrections/<process>/<group>.<writer>.<rev>.json, each written once. Decisions on suggested
     fixes from before 1.13 (suggestions/<process>/<suggestion>.<writer>.json) are read too. A file that can't be read is
     reported in corrUnread, never dropped, so its group doesn't quietly look open again. */
  function loadCorrectionDecisions(fs, cache, sched) {
    var dirs = ['corrections', 'suggestions'];
    return Promise.all(dirs.map(function (dir) {
      return fs.list(dir).then(function (procs) {
        return Promise.all(procs.filter(function (p) { return p.kind === 'dir' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(p.name); }).map(function (p) {
          return fs.list(dir + '/' + p.name).then(function (items) { return items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return { dir: dir, process: p.name, name: i.name, path: dir + '/' + p.name + '/' + i.name }; }); });
        }));
      });
    })).then(function (nested) {
      var all = [].concat.apply([], [].concat.apply([], nested));
      return decisionTexts(fs, cache || {}, sched, dirs, all, 'corr').then(function (got) {
        return got.map(function (g) {
          var x = g.x, unread = { _unread: true, dir: x.dir, process: x.process, _file: x.name };
          /* A file that's missing now was removed; one that won't read, parse or check (a half-synced write) is unread. */
          if (g.failed) return unread;
          if (!g.f) return null;
          var d = PF.corrections.cleanDecision(json(g.f.text), x.process);
          if (!d || (x.dir === 'suggestions') !== (d.kind === 'fix-decision')) { forgetText(cache, x.path); return unread; }
          d._file = x.name; d._dir = x.dir; return d;
        });
      });
    }).then(function (list) { return list.filter(Boolean); });
  }
  /* A decision on a group of corrections, in a new file named for this window and the decision's rev. It's written once:
     if a file of that name is already there, nothing is written. */
  function decideCorrection(fs, rec, writer) {
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(rec.process) || !/^[\w-]{1,40}$/.test(rec.group) || !/^[\w-]{1,40}$/.test(writer) || !(rec.rev >= 1)) return Promise.reject(new Error('That correction can\'t be decided here.'));
    var path = 'corrections/' + rec.process + '/' + rec.group + '.' + writer + '.' + Math.floor(rec.rev) + '.json';
    return fs.read(path).then(function (f) {
      if (f) throw new Error('A decision with that name is already in the folder. Look again, then decide.');
      return fs.write(path, JSON.stringify(rec, null, 2) + '\n').then(function () { return path; });
    });
  }
  /* What became of follow-ups: followups/<process>/<run>.<follow-up>.<writer>.<rev>.json, each written once by whoever
     decided. run.json never changes. Read like corrections' decisions (decisionTexts); a file that can't be read is
     reported in fuUnread, never dropped, so its follow-up doesn't quietly look open again. */
  function loadFollowUpDecisions(fs, cache, sched) {
    return fs.list('followups').then(function (procs) {
      return Promise.all(procs.filter(function (p) { return p.kind === 'dir' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(p.name); }).map(function (p) {
        return fs.list('followups/' + p.name).then(function (items) { return items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return { process: p.name, name: i.name, path: 'followups/' + p.name + '/' + i.name }; }); });
      }));
    }).then(function (nested) {
      return decisionTexts(fs, cache || {}, sched, ['followups'], [].concat.apply([], nested), 'fu').then(function (got) {
        return got.map(function (g) {
          var x = g.x, unread = { _unread: true, dir: 'followups', process: x.process, _file: x.name };
          /* Each file on its own: one that won't read, parse or check is listed as unreadable, never a reason to drop the rest. */
          if (g.failed) return unread;
          if (!g.f) return null;
          var d = null; try { d = PF.followups.cleanDecision(json(g.f.text), x.process, x.name); } catch (e) { d = null; }
          if (!d) { forgetText(cache, x.path); return unread; }
          return d;
        });
      });
    }).then(function (list) { return list.filter(Boolean); });
  }
  /* A decision on a follow-up, in a new file named for its run, the follow-up, this window and the decision's rev. Written
     once. A shared folder has no create-if-absent, so: a name is claimed in this window before it's checked (only this window
     writes names with its own window part, so two saves of one name can only race here, and the second is refused), the
     file must be absent, and after writing it must read back as exactly this decision, else the save is refused. */
  function decideFollowUp(fs, rec, writer) {
    var F = PF.followups;
    if (!rec || rec.kind !== 'followup-decision' || !F.decidable(rec.process, rec.run, rec.followUp) || typeof writer !== 'string' || !/^[\w-]{1,40}$/.test(writer) || !F.revOk(rec.rev)) return Promise.reject(new Error('That follow-up can\'t be decided here.'));
    var name = F.fileName(rec, writer), path = 'followups/' + rec.process + '/' + name, text = JSON.stringify(rec, null, 2) + '\n';
    var claims = fs._fuClaims || (fs._fuClaims = {});
    if (claims[path]) return Promise.reject(new Error('A decision with that name is already being saved. Look again, then decide.'));
    claims[path] = true;
    function release(v) { delete claims[path]; return v; }
    return fs.read(path).then(function (f) {
      if (f) throw new Error('A decision with that name is already in the folder. Look again, then decide.');
      return fs.write(path, text);
    }).then(function () { return fs.read(path); }).then(function (f) {
      var back = f ? F.cleanDecision(json(f.text), rec.process, name) : null;
      if (!back || f.text !== text) throw new Error('The decision didn\'t read back from the team folder as it was written. Look again, then decide.');
      return path;
    }).then(release, function (e) { release(); throw e; });
  }
  /* Team step types: step-types/<id>.json. Each file is checked; good ones are usable, bad ones are listed with their problems. */
  function loadStepTypes(fs) {
    var skipped = 0;
    return fs.list('step-types').then(function (items) {
      var files = items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      skipped = Math.max(0, files.length - MAX_TYPES);
      return Promise.all(files.slice(0, MAX_TYPES).map(function (i) {
        return fs.read('step-types/' + i.name).then(function (f) { var o = f && json(f.text); return { file: i.name, def: o, errors: o === undefined ? ['isn\'t valid JSON'] : PF.types.checkCustom(o) }; }, function (e) { return { file: i.name, def: null, errors: [why(e)] }; });
      }));
    }).then(function (list) {
      var types = {}, errors = [];
      list.forEach(function (x) {
        if (!x.errors.length && x.file !== x.def.id + '.json') x.errors.push('the file name must be ' + x.def.id + '.json');
        if (!x.errors.length && types[x.def.id]) x.errors.push('another file already defines ' + x.def.id);
        if (!x.errors.length) { try { types[x.def.id] = PF.types.customType(x.def); } catch (e) { x.errors.push('couldn\'t be read as a step type'); } }
        if (x.errors.length) errors.push({ file: x.file, errors: x.errors });
      });
      return { types: types, errors: errors, skipped: skipped };
    });
  }
  /* Past these, the first files by name are read and the rest are counted (Folder health reports them), never silently cut. */
  var MAX_TYPES = 100, MAX_SKILLS = 500;
  /* Skill registrations, one file at a time: a file that can't be read, isn't JSON or isn't an object is listed with why. */
  function loadSkills(fs) {
    var skipped = 0;
    return fs.list('skills').then(function (items) {
      var files = items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      skipped = Math.max(0, files.length - MAX_SKILLS);
      return Promise.all(files.slice(0, MAX_SKILLS).map(function (i) {
        var bad = function (why) { return { skill: null, errors: ['skills/' + i.name + ': ' + why], file: i.name }; };
        return fs.read('skills/' + i.name).then(function (f) {
          if (!f) return bad('couldn\'t be read');
          var o = json(f.text);
          if (o === undefined) return bad('isn\'t valid JSON');
          if (!o || typeof o !== 'object' || Array.isArray(o)) return bad('must be a JSON object');
          try { var c = PF.skills.check(o, i.name); c.file = i.name; return c; } catch (e) { return bad('couldn\'t be read as a skill registration'); }
        }, function () { return bad('couldn\'t be read'); });
      }));
    }).then(function (list) { list.skipped = skipped; return list; });
  }
  /* The team's Jira workflows: jira/workflows.json (see core/jira.js). Missing is fine; a broken file is reported. */
  function loadWorkflows(fs) {
    return fs.read('jira/workflows.json').then(function (f) {
      if (!f) return { workflows: null, errors: [] };
      var o = json(f.text);
      if (o === undefined) return { workflows: PF.jira.broken('jira/workflows.json isn\'t valid JSON'), errors: ['jira/workflows.json isn\'t valid JSON'] };
      var c = PF.jira.check(o);
      return { workflows: Object.keys(c.workflows).length ? c.workflows : null, errors: c.errors };
    });
  }
  function stripMeta(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k[0] !== '_') c[k] = o[k]; }); return c; }

  /* Save only if the file is exactly what this window last read (same fingerprint) and this window still records it.
     Anything else (another save, a OneDrive replacement, an unreadable file) is never overwritten. */
  /* session: who records the run (stays the same across a reload). opts.writer: this page load's own ID, used for every file
     this window writes besides run.json, so two windows can never append to the same file (defaults to session). */
  /* This window wrote into a run's folder: what the cache knew about it is dropped, so the next refresh reads it, even if a
     save happened to leave the same size and time. */
  function forgetRun(fs, run) { var c = cacheOf(fs); if (c.runs) delete c.runs[run.process + '/' + run.id]; }
  function saveRun(fs, run, session, opts) {
    opts = opts || {};
    forgetRun(fs, run);
    var writer = opts.writer || session;
    var path = 'runs/' + run.process + '/' + run.id + '/run.json';
    if (run._unrunnable) return Promise.reject(readOnly(run._unrunnable));
    /* The check and the write happen together: with opts.lock (the browser's Web Locks), windows on this computer save a run one
       at a time, so a second window always sees the first one's save and keeps its own change as a conflict copy. */
    if (opts.lock) return opts.lock('preflight:run:' + run.process + '/' + run.id, function () { return checkAndWrite(); });
    return checkAndWrite();
    /* The publication record may have arrived (by sync) after the run was loaded; a newer format makes the run read-only. */
    function checkAndWrite() {
    return pubProblem(fs, run).then(function (why) {
      if (why) { run._unrunnable = why; throw readOnly(why); }
      return fs.read(path);
    }).then(function (f) {
      var e;
      if (f) {
        var disk = R.sanitize(json(f.text));
        if (!disk) { e = new Error('The run file is unreadable, so it wasn\'t overwritten.'); e.unreadable = true; throw e; }
        if (disk._unrunnable) throw readOnly(disk._unrunnable);
        var changed = U.hash(f.text) !== run._fileHash;
        var otherWriter = !opts.takeover && disk.recorder.session && disk.recorder.session !== session;
        if (changed || otherWriter) {
          /* Keep this window's version next to the run as a conflict copy, so nothing is lost and the team can review it. */
          e = new Error('changed'); e.disk = disk;
          var keep = 'runs/' + run.process + '/' + run.id + '/run.conflict-' + writer + '-' + Date.now() + '.json';
          /* Archived history is a record of what happened whichever version wins, so it's written first. */
          return archiveOverflow(fs, run, writer).then(function () { return fs.write(keep, JSON.stringify(stripMeta(run), null, 2)); })
            .then(function () { forgetRun(fs, run); e.keptAs = keep; throw e; }, function () { throw e; });
        }
      }
      /* A run this window read from (or saved to) the folder whose file is gone now was deleted or moved by someone: it's
         never written back by an ordinary save, only by an explicit restore. A run never saved yet is created here. */
      if (!f && run._fileHash && !opts.restoreMissing) { e = new Error('This run\'s file is gone from the team folder, so it wasn\'t written back. Someone may have deleted or moved it.'); e.missing = true; throw e; }
      var copy = stripMeta(run); copy.rev = (run.rev || 0) + 1; copy.savedAt = new Date().toISOString(); copy.savedBy = session;
      /* Every save is first written to its own uniquely named candidate file, and run.json lists the saves it includes.
         Where windows can't take turns (two browsers, two computers, no Web Locks), a save that another save replaced is
         therefore never lost: its candidate isn't in the list, so loadRun shows it as a conflict copy to compare and keep. */
      var saveId = U.randomId(8), tag = writer + '.' + saveId, dir = 'runs/' + run.process + '/' + run.id + '/';
      copy.lineage = (run.lineage || []).concat([tag]).slice(-LINEAGE_MAX);
      var text = JSON.stringify(copy, null, 2), cand = dir + 'candidate-' + writer + '-' + saveId + '.json';
      return fs.write(cand, text)
        .then(function () { return archiveOverflow(fs, run, writer); })
        .then(function () { return fs.write(path, text); })
        .then(function () {
          forgetRun(fs, run);
          run.rev = copy.rev; run.savedAt = copy.savedAt; run._fileHash = U.hash(text); run.lineage = copy.lineage;
          /* What was written, exactly: the run may change in memory while this save is under way. */
          return cleanCandidates(fs, dir, copy.lineage).then(function () { return { savedAt: copy.savedAt, text: text }; });
        }, function (e) { return fs.remove(cand).then(function () { throw e; }, function () { throw e; }); });
    });
    }
  }
  /* A run this copy can't fully read is never written, not even as a conflict copy: R.sanitize dropped what it doesn't know. */
  function readOnly(why) { var e = new Error(why + ' This run is read-only here, so nothing was saved.'); e.unrunnable = true; return e; }
  /* A candidate is removed once a later save includes it (it's in the list and isn't the newest entry). The newest save's
     candidate stays until the next save, so it's still there if that next save comes from a window that never saw it.
     Names are unique per save, so removing one never touches a candidate another window is writing right now. */
  var LINEAGE_MAX = 200, CAND = /^candidate-(.+)-([a-z0-9]{8})\.json$/;
  function candidateTag(name) { var m = CAND.exec(name); return m ? m[1] + '.' + m[2] : null; }
  function cleanCandidates(fs, dir, lineage) {
    return fs.list(dir.slice(0, -1)).then(function (items) {
      var newest = lineage[lineage.length - 1];
      return Promise.all(items.filter(function (i) { var t = candidateTag(i.name); return t && t !== newest && lineage.indexOf(t) >= 0; }).map(function (i) { return fs.remove(dir + i.name).catch(function () {}); }));
    }, function () {});
  }
  /* metaMs: every run's sizes and times are checked at least this often; endedMs and liveMs: a finished run, and a running
     one that isn't open, is read in full at least this often; recentMs: a run ended this recently is checked every refresh;
     batch: results per progressive batch. All in elapsed milliseconds. */
  var config = { candidateGraceMs: 60000, metaMs: 600000, endedMs: 3600000, liveMs: 300000, recentMs: 7 * 86400000, batch: 100 };
  /* A run's contents without the bookkeeping that differs between two saves of the same change. */
  function sameRun(text) {
    var o = json(text); if (!o || typeof o !== 'object') return '\u0000' + text;
    var c = {}; Object.keys(o).sort().forEach(function (k) { if (['rev', 'savedAt', 'savedBy', 'lineage'].indexOf(k) < 0) c[k] = o[k]; });
    return JSON.stringify(c);
  }

  /* The batch is taken off the run before writing, so records added meanwhile wait for the next save; if the write fails,
     the batch goes back in front of them. Record IDs let loadHistory ignore a batch written twice. */
  function archiveOverflow(fs, run, session) {
    var batch = (run._overflow || []).splice(0);
    if (!batch.length) return Promise.resolve();
    return fs.append('runs/' + run.process + '/' + run.id + '/history-' + session + '.jsonl', batch.map(function (x) { return JSON.stringify(x); }).join('\n') + '\n')
      .catch(function (e) { run._overflow = batch.concat(run._overflow || []); throw e; });
  }
  /* Everything archived from a run's history files, oldest first. Read on demand, never during routine refreshes. */
  function loadHistory(fs, run) {
    var dir = 'runs/' + run.process + '/' + run.id;
    return fs.list(dir).then(function (items) {
      return Promise.all(items.filter(function (i) { return /^history-[\w-]+\.jsonl$/.test(i.name); }).map(function (i) { return fs.read(dir + '/' + i.name); }));
    }).then(function (files) {
      var out = [];
      var seen = {};
      /* An entry whose time is missing or can't be read is kept (it shows "time unknown"), never dropped; it sorts first. */
      files.forEach(function (f) { if (f) f.text.split('\n').forEach(function (line) { var x = line.trim() && json(line); if (x && typeof x === 'object' && !Array.isArray(x) && !(x.id && seen[x.id])) { if (x.id) seen[x.id] = 1; out.push(x); } }); });
      var key = function (x) { return typeof x.at === 'string' && !isNaN(Date.parse(x.at)) ? x.at : ''; };
      return out.sort(function (a, b) { return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0; });
    });
  }
  /* Only a copy that was actually listed next to this run, by its exact name. */
  function isCopy(run, name) { return typeof name === 'string' && name !== 'run.json' && (/^run.*\.json$/i.test(name) || CAND.test(name)) && !/[\/\\]/.test(name) && (!run._conflicts || run._conflicts.indexOf(name) >= 0); }
  function readCopy(fs, run, name) {
    if (!isCopy(run, name)) return Promise.reject(new Error('Not a run copy.'));
    return fs.read('runs/' + run.process + '/' + run.id + '/' + name).then(function (f) { return f ? R.sanitize(json(f.text)) : null; });
  }
  /* Before a conflict copy replaces the current version, the current one is saved beside it. The name doesn't start with "run",
     so it's kept as a record without showing up as another conflict. */
  function keepDisplaced(fs, run, session) {
    forgetRun(fs, run);
    var path = 'runs/' + run.process + '/' + run.id + '/replaced-' + session + '-' + Date.now() + '.json';
    return fs.write(path, JSON.stringify(stripMeta(run), null, 2)).then(function () { return path; });
  }
  /* Removing a copy also removes any lost-save candidate with exactly the same contents, so one decision covers one version. */
  function removeCopy(fs, run, name) {
    if (!isCopy(run, name)) return Promise.reject(new Error('Not a run copy.'));
    var dir = 'runs/' + run.process + '/' + run.id + '/', lineage = run.lineage || [];
    return fs.read(dir + name).then(function (f) {
      var h = f ? f.text : null;
      return fs.remove(dir + name).then(function () {
        forgetRun(fs, run);
        if (!h) return;
        return fs.list(dir.slice(0, -1)).then(function (items) {
          var twins = items.filter(function (it) { var t = candidateTag(it.name); return t && it.name !== name && lineage.indexOf(t) < 0; });
          return Promise.all(twins.map(function (it) { return fs.read(dir + it.name).then(function (g) { if (g && g.text === h) return fs.remove(dir + it.name).catch(function () {}); }, function () {}); }));
        });
      });
    });
  }


  /* Each window appends only to its own notes file. */
  function addNote(fs, run, session, note) {
    forgetRun(fs, run);
    return fs.append('runs/' + run.process + '/' + run.id + '/notes-' + session + '.jsonl', JSON.stringify(note) + '\n');
  }
  /* An attachment is checked against the allowed kinds and the 10 MB limit (PF.attach) and named after the person's own file,
     cleaned. Older copies keep these notes: the path still matches what they read, and an image still shows as one. */
  function saveAttachment(fs, run, blob, session, name) {
    var ok = PF.attach.check(name || blob.name || '', blob.type, blob.size);
    if (ok.error) return Promise.reject(new Error(ok.error));
    var path = PF.attach.pathFor('runs/' + run.process + '/' + run.id + '/', Date.now(), U.randomId(6), session, ok.name);
    return fs.write(path, blob).then(function () { return path; });
  }

  /* Write the map and types first and the publication record last, so a half-synced publication is never mistaken for a complete one. */
  function publish(fs, draftMd, opts) {
    var built = P.build(draftMd, opts);
    if (built.blockers) return Promise.resolve(built);
    var parsed = PF.map.parse(draftMd), process = parsed.meta.process, base = 'publications/' + process + '/' + built.folder + '/';
    /* Reference screenshots are copied into the publication with a fingerprint each, so replacing one in images/ later never changes
       an old version's instructions. A screenshot that isn't in the folder stops the publish rather than vanishing from it. */
    var shots = [], blobs = {};
    PF.map.steps(parsed).forEach(function (x) { x.step.shots.forEach(function (sh) { if (shots.indexOf(sh.src) < 0) shots.push(sh.src); }); });
    var read = shots.reduce(function (p, src) { return p.then(function (missing) { return fs.blob(src).then(function (b) { if (!b) return missing.concat([src]); blobs[src] = b; return missing; }); }); }, Promise.resolve([]));
    return read.then(function (missing) {
      if (missing.length) return { blockers: missing.map(function (src) { return 'The screenshot ' + src + ' isn\'t in the team folder. Add it, or remove it from the checklist.'; }) };
      return shots.reduce(function (p, src) { return p.then(function (m) { return bytesHash(blobs[src]).then(function (h) { m[src] = h; return m; }); }); }, Promise.resolve({})).then(function (images) {
        var rebuilt = Object.keys(images).length ? P.build(draftMd, Object.assign({}, opts, { images: images, rand: built.folder.replace(/^v\d+-/, '') })) : built;
        return shots.reduce(function (p, src) { return p.then(function () { return fs.write(base + src, blobs[src]); }); }, Promise.resolve())
          .then(function () { return writePublication(fs, base, rebuilt); });
      });
    });
  }
  function writePublication(fs, base, built) {
    return fs.write(base + 'map.md', built.files['map.md'])
      .then(function () { return fs.write(base + 'types.json', built.files['types.json']); })
      .then(function () { return fs.write(base + 'publication.json', built.files['publication.json']); })
      .then(function () { return built; });
  }

  /* Save a text file only if it's still exactly what the editor started from (expect: that text's fingerprint, or null for
     "doesn't exist yet"). If someone (a person or an AI assistant) changed it meanwhile, nothing is written and their version comes
     back, so two editors over a shared folder never silently overwrite each other. */
  function saveChecked(fs, path, text, expect, opts) {
    var go = function () {
      return fs.read(path).then(function (f) {
        var now = f ? U.hash(f.text) : null;
        if (now !== expect) return { conflict: true, theirs: f ? f.text : null, theirsHash: now };
        /* A folder can't check and write in one step, so read it back: if anything else is there now, say so rather than
           report a save that didn't stick. (Across computers, OneDrive keeps both copies of a file changed on two.) */
        return fs.write(path, text).then(function () { return fs.read(path); }).then(function (back) {
          if (back && back.text === text) return { ok: true, hash: U.hash(text) };
          return { conflict: true, theirs: back ? back.text : null, theirsHash: back ? U.hash(back.text) : null, afterWrite: true };
        });
      });
    };
    return opts && opts.lock ? opts.lock('preflight:file:' + path, go) : go();
  }
  function saveDraft(fs, file, md, expect, opts) {
    if (!/^[a-z0-9][a-z0-9-]{0,59}\.md$/.test(file)) return Promise.reject(new Error('A checklist file is named <process>.md, in lowercase letters, numbers and dashes.'));
    return saveChecked(fs, 'maps/drafts/' + file, md, expect, opts);
  }
  /* A correction applied to a draft (docs/design.md section 19). o.base is the draft as it was compared (o.expect its
     fingerprint, or null when there's no draft yet and base is the latest version: the draft is created from it). The result
     is worked out again here and saved only over that same draft: if the draft changed since, nothing is written and the
     conflict is returned, as for any draft save. o.edited is a person's own wording; o.confirmed says a person confirmed a
     comparison that wasn't clean. o.text, when given, must be the result the window showed. */
  function applyCorrection(fs, o, opts) {
    var file = o.file || o.process + '.md', rv;
    try { rv = PF.corrections.review(o.group, o.base, o.edited == null ? null : o.edited); } catch (e) { return Promise.reject(e); }
    var ok = rv.text && rv.text !== o.base && (rv.state === 'clean' || (o.confirmed && rv.state === 'changed'));
    if (!ok) return Promise.reject(new Error(rv.state === 'already' ? 'The draft already has this correction.' : rv.reason || 'This correction can\'t be applied to the draft as it is.'));
    if (o.text != null && o.text !== rv.text) return Promise.reject(new Error('The draft changed since the comparison was shown. Look again.'));
    return saveDraft(fs, file, rv.text, o.expect == null ? null : o.expect, opts).then(function (res) { res.text = rv.text; res.file = file; res.added = rv.added || ''; return res; });
  }
  function saveStepType(fs, def, expect, opts) {
    var errs = PF.types.checkCustom(def);
    if (errs.length) return Promise.reject(new Error(errs[0]));
    return saveChecked(fs, 'step-types/' + def.id + '.json', JSON.stringify(def, null, 2) + '\n', expect, opts);
  }
  /* A person's sign-off that a published version is ready for a skill, in their window's own file. as: "backup" when the
     checklist's backup owner signs while its owner is inactive or gone (older copies count only the owner's). */
  function recordValidation(fs, pub, session, by, note, evidence, as) {
    var rec = { kind: 'validation', process: pub.map.meta.process, version: pub.info.version, folder: pub.info.folder, by: by, at: new Date().toISOString(), note: String(note || '').slice(0, 300), evidence: evidence };
    if (as === 'backup') rec.as = 'backup';
    return fs.write('validations/' + pub.map.meta.process + '.v' + pub.info.version + '.' + session + '.json', JSON.stringify(rec, null, 2));
  }
  /* people.json, changed by the folder owner or backup in Settings: checked against the version they saw, like a draft. */
  function savePeople(fs, text, expect, opts) { return saveChecked(fs, PF.people.FILE, text, expect, opts); }
  /* Setup's write test: a file only this window writes, read back, then removed. Resolves { removed } (and the path when it
     stayed; Folder health lists it later as a leftover .tmp). */
  function writeTest(fs, writer) {
    var path = '.flightdeck/write-test-' + writer + '.tmp', text = 'Flightdeck checks it can save in this folder. This file is removed right away.\n';
    /* The file is always removed (or said to be left), whatever the read back found. */
    var remove = function () { return fs.remove(path).then(function () { return { removed: true }; }, function () { return { removed: false, path: path }; }); };
    return fs.write(path, text).then(function () { return fs.read(path).catch(function () { return null; }); }).then(function (f) {
      return remove().then(function (res) { if (!f || f.text !== text) throw new Error('a test file didn\'t read back as written' + (res.removed ? '' : ', and ' + path + ' couldn\'t be removed; delete it')); return res; });
    });
  }
  /* A plan made in the app is a new file this window creates once (expect null: "doesn't exist yet"), so it never replaces one. */
  function savePlan(fs, plan, opts) {
    if (!/^plan-[a-z0-9-]{1,100}$/.test(plan.id)) return Promise.reject(new Error('A plan ID is plan- followed by lowercase letters, numbers and dashes.'));
    return saveChecked(fs, 'proposals/' + plan.id + '.json', JSON.stringify(plan, null, 2) + '\n', null, opts);
  }
  function recordPlanStatus(fs, plan, session, status, runId, by) {
    var rec = { kind: 'status', proposal: plan.id, proposalHash: plan._hash, status: status, run: runId || null, by: by, at: new Date().toISOString() };
    return fs.write('proposals/' + plan.id + '.status-' + session + '.json', JSON.stringify(rec, null, 2));
  }


  /* ---------- Saved history of drafts and step types: history/drafts/<process>/ and history/step-types/<id>/ ----------
     Each window appends only to its own <writer>.jsonl (then <writer>-2.jsonl past 512 KB), so every file keeps one writer.
     No loader lists history/: it's read only when someone opens History. */
  function historyDir(kind, id) { return (kind === 'type-edit' ? 'history/step-types/' : 'history/drafts/') + id; }
  /* lines: JSON strings, appended in order. roll: { <dir>: n } this window's current file number per folder. A file takes lines
     until the next would pass 512 KB, then the rest go to the next file, so a batch kept for a retry rolls over too. A batch
     cut short by a failed append is retried whole; the lines that did land are read once (reading drops repeats). */
  function appendHistory(fs, dir, writer, lines, roll) {
    var TL = PF.timeline, n = roll[dir] || 1, i = 0;
    var path = function () { return dir + '/' + TL.histFile(writer, n); };
    var sizeOf = function () { return fs.stat ? fs.stat(path()).then(function (st) { return st ? st.size : 0; }) : Promise.resolve(0); };
    function next(size) {
      if (i >= lines.length) return Promise.resolve(path());
      var chunk = '', b = size;
      while (i < lines.length) { var t = lines[i] + '\n', tb = TL.bytes(t); if (TL.rolls(b, tb)) break; chunk += t; b += tb; i++; }
      if (!chunk) { roll[dir] = ++n; return sizeOf().then(next); }
      return fs.append(path(), chunk).then(function () { return next(b); });
    }
    return sizeOf().then(next);
  }
  /* Every history file in one folder (8 reads at a time), OneDrive's copies of them included ("w1 (1).jsonl", "w1-LAPTOP.jsonl"):
     each file's newest 2,000 lines, a line over 80 KB skipped before it's parsed, each checked by PF.timeline.cleanEntry, then
     put in the order PF.timeline.order gives from the file's current fingerprint (an entry in two files counts once), newest
     2,000. Each entry gets `ref`, its own reference for the page (two entries may share an ID). Returns { items, bad (lines
     looked at that couldn't be read), skipped (older lines not looked at), files, unknown (other names there, not read) }. */
  function loadEditHistory(fs, dir, current) {
    var TL = PF.timeline, H = TL.HIST;
    return fs.list(dir).then(function (items) {
      var files = items.filter(function (i) { return i.kind === 'file'; }).map(function (i) { return i.name; }).sort();
      var names = files.filter(function (n) { return /\.jsonl$/i.test(n) && n.length <= 200; }), unknown = files.filter(function (n) { return names.indexOf(n) < 0; }).slice(0, 20);
      var bad = 0, skipped = 0;
      return limited(names, H.FILES, function (n) {
        return fs.read(dir + '/' + n).then(function (f) {
          /* At most the newest 2,000 lines are looked at, readable or not; older ones are counted as skipped. */
          var out = [], lines = f ? f.text.split('\n') : [], seen = 0;
          for (var i = lines.length - 1; i >= 0; i--) {
            var line = lines[i];
            if (!line.trim()) continue;
            if (++seen > H.READ) { skipped++; continue; }
            if (line.length > H.LINE || TL.bytes(line) > H.LINE) { bad++; continue; }
            var e = TL.cleanEntry(json(line), n);
            if (e) out.push(e); else bad++;
          }
          return out.reverse();
        }, function () { bad++; return []; });
      }).then(function (lists) {
        var items = TL.order([].concat.apply([], lists), current);
        for (var i = 0, k = 0; i < items.length; i++) if (items[i].entry && ++k > H.READ) { items = items.slice(0, i); break; }
        TL.refs(items);
        return { items: items, bad: bad, skipped: skipped, files: names, unknown: unknown };
      });
    });
  }

  /* ---------- Folder health: every file, on demand (never during routine refreshes) ---------- */
  /* At most n folder calls in flight at once, across a whole scan, so a big folder never floods OneDrive or the browser. */
  function pool(n) {
    var active = 0, waiting = [];
    function next() { if (active >= n || !waiting.length) return; active++; var job = waiting.shift(); Promise.resolve().then(job.fn).then(function (v) { active--; next(); job.res(v); }, function (e) { active--; next(); job.rej(e); }); }
    return function (fn) { return new Promise(function (res, rej) { waiting.push({ fn: fn, res: res, rej: rej }); next(); }); };
  }
  var SCAN_MAX = 50000, SKIP_DIRS = { '.git': 1, 'node_modules': 1 };
  /* Lists every file with its size and time (8 calls at a time), and reads the few small files nothing else checks: people.json,
     plans and sign-offs, the Jira workflows, and the files for AI assistants. opts.alive() false stops it (the folder was
     switched); opts.progress(n) hears how many files it has found. Returns what PF.health.check needs. */
  function scan(fs, opts) {
    opts = opts || {};
    var go = pool(8), alive = opts.alive || function () { return true; }, files = [], unreadable = [], truncated = false, started = Date.now();
    function stop() { var e = new Error('The folder changed before the check finished.'); e.cancelled = true; return e; }
    function walk(dir) {
      if (!alive()) return Promise.reject(stop());
      return go(function () { return fs.list(dir); }).then(function (items) {
        var subs = [];
        items.forEach(function (i) {
          var p = dir ? dir + '/' + i.name : i.name;
          if (i.kind === 'dir') { if (!SKIP_DIRS[i.name]) subs.push(p); }
          else if (files.length < SCAN_MAX) files.push({ p: p, s: null, m: null }); else truncated = true;
        });
        if (opts.progress) opts.progress(files.length);
        return Promise.all(subs.map(walk));
      }, function (e) { unreadable.push({ path: dir || '(the team folder)', why: why(e) }); });
    }
    return walk('').then(function () {
      if (!fs.stat) return;
      return Promise.all(files.map(function (f) {
        return go(function () { if (!alive()) throw stop(); return fs.stat(f.p); }).then(function (st) { if (st) { f.s = st.size; f.m = st.mtime; } }, function (e) { if (e && e.cancelled) throw e; unreadable.push({ path: f.p, why: why(e) }); });
      }));
    }).then(function () {
      var want = files.filter(function (f) { return f.p === 'people.json' || f.p === 'jira/workflows.json' || f.p === '.flightdeck/installed.json' || f.p === PF.contract.AGENTS || /^(proposals|validations)\/[^/]+\.json$/i.test(f.p) || /^\.flightdeck\/skills\//.test(f.p); });
      var texts = {}, installed = null;
      return Promise.all(want.map(function (f) {
        return go(function () { if (!alive()) throw stop(); return fs.read(f.p); }).then(function (r) {
          if (!r) return;
          if (/^\.flightdeck\/skills\//.test(f.p) || f.p === PF.contract.AGENTS) { texts[f.p] = r.text; return; }
          var o = json(r.text);
          if (f.p === '.flightdeck/installed.json') { installed = o && typeof o === 'object' && !Array.isArray(o) ? o : 'bad'; return; }
          if (o === undefined) unreadable.push({ path: f.p, why: 'isn\'t valid JSON' });
          else if (f.p === 'people.json' && !Array.isArray(o) && !(o && Array.isArray(o.people))) unreadable.push({ path: f.p, why: 'isn\'t a list of people' });
        }, function (e) { if (e && e.cancelled) throw e; unreadable.push({ path: f.p, why: why(e) }); });
      })).then(function () {
        var bytes = 0, longest = 0, pubs = {}, areas = {};
        files.forEach(function (f) {
          bytes += f.s || 0; if (f.p.length > longest) longest = f.p.length;
          var top = f.p.indexOf('/') < 0 ? '(top)' : f.p.slice(0, f.p.indexOf('/')), a = areas[top] = areas[top] || { files: 0, bytes: 0 };
          a.files++; a.bytes += f.s || 0;
          var m = /^(publications\/[^/]+\/[^/]+)\//.exec(f.p);
          if (m && f.m != null && (pubs[m[1]] == null || f.m > pubs[m[1]])) pubs[m[1]] = f.m;
        });
        return { at: new Date().toISOString(), ms: Date.now() - started, files: files.length, bytes: bytes, longest: longest, areas: areas, pubs: pubs, list: files, unreadable: unreadable, truncated: truncated,
          contractTexts: texts, installed: files.some(function (f) { return f.p === '.flightdeck/installed.json'; }) ? installed || 'bad' : null,
          updates: files.filter(function (f) { return /^\.flightdeck\/updates\//.test(f.p) && !/\/README\.md$/i.test(f.p) && !/\/replaced\//.test(f.p) && !/\.base$/.test(f.p); }).map(function (f) { return f.p; }) };
      });
    });
  }

  /* ---------- The connection check: connection/ (see core/connection.js) ---------- */
  /* Only checks from the last 15 minutes and the answers to them are read; older copies never list this folder. */
  function loadConnection(fs, now) {
    var CN = PF.connection;
    return fs.list(CN.DIR).then(function (items) {
      var names = items.filter(function (i) { return i.kind === 'file'; }).map(function (i) { return i.name; });
      var probes = names.filter(function (n) { return CN.fresh(n, now); }), ids = {};
      probes.forEach(function (n) { ids[CN.parseName(n).id] = true; });
      var acks = names.filter(function (n) { var x = CN.parseName(n); return x && x.kind === 'ack' && ids[x.probe]; });
      return limited(probes.concat(acks), 8, function (n) {
        return fs.read(CN.DIR + '/' + n).then(function (f) { return f ? CN.clean(json(f.text), n) : null; }, function () { return null; });
      }).then(function (list) {
        list = list.filter(Boolean);
        return { probes: list.filter(function (x) { return x.kind === 'probe'; }), acks: list.filter(function (x) { return x.kind === 'ack'; }), readAt: new Date(now).toISOString() };
      });
    });
  }
  /* Answers of any age still in connection/ (kept 7 days), for Getting started: the second computer counts once another
     person answered. Only names not read before (seen), at most 20 a time. */
  function loadAnswers(fs, seen) {
    var CN = PF.connection;
    return fs.list(CN.DIR).then(function (items) {
      var names = items.filter(function (i) { return i.kind === 'file' && !seen[i.name] && (CN.parseName(i.name) || {}).kind === 'ack'; }).map(function (i) { return i.name; }).slice(0, 20);
      return limited(names, 8, function (n) {
        return fs.read(CN.DIR + '/' + n).then(function (f) { return { name: n, rec: f ? CN.clean(json(f.text), n) : null }; }, function () { return { name: n, rec: null }; });
      });
    });
  }
  /* Each check and each answer is a new file named for its window, written once: never over a file that's there. */
  function writeOnce(fs, path, rec) {
    var text = JSON.stringify(rec, null, 2) + '\n';
    return fs.read(path).then(function (f) {
      if (f) throw new Error('A file with that name is already in the folder.');
      return fs.write(path, text);
    }).then(function () { return path; });
  }
  function sendProbe(fs, rec, atMs) {
    var CN = PF.connection, name = CN.probeName(atMs, rec.id, rec.writer);
    return writeOnce(fs, CN.DIR + '/' + name, CN.probe(rec)).then(function () { return name; });
  }
  function sendAck(fs, rec) {
    var CN = PF.connection, name = CN.ackName(rec.probe, rec.writer);
    return writeOnce(fs, CN.DIR + '/' + name, CN.ack(rec)).then(function () { return name; });
  }
  /* Checks and answers older than 7 days may be deleted by any window: the one exception to one writer per file, since nobody
     waits on them any more (docs/onedrive.md). At most 100 at a time. */
  function cleanConnection(fs, now) {
    var CN = PF.connection;
    return fs.list(CN.DIR).then(function (items) {
      var names = items.filter(function (i) { return i.kind === 'file' && CN.parseName(i.name); }).map(function (i) { return i.name; }).slice(0, 2000), gone = 0;
      return limited(names, 8, function (n) {
        if (gone >= 100) return null;
        var x = CN.parseName(n), when = x.kind === 'probe' || !fs.stat ? Promise.resolve(null) : fs.stat(CN.DIR + '/' + n).then(function (st) { return st ? st.mtime : null; }, function () { return null; });
        return when.then(function (mtime) { if (gone < 100 && CN.old(n, mtime, now)) { gone++; return fs.remove(CN.DIR + '/' + n).catch(function () {}); } });
      }).then(function () { return gone; });
    });
  }

  /* ---------- Evidence packs (docs/evidence.md, docs/design.md section 24) ----------
     A raw, read-only collector, separate from display loading. It never calls loadRun or readRun: those can delete a save
     receipt already in run.json's lineage and build display objects. It sees the folder only through readOnly(), which has
     list, read, stat and blob and throws on anything that would change a file, in the app and in the command line alike. */
  function readOnlyView(fs) {
    var ro = {};
    ['list', 'read', 'stat', 'blob'].forEach(function (m) { if (typeof fs[m] === 'function') ro[m] = function (p) { return fs[m](p); }; });
    ['write', 'append', 'remove'].forEach(function (m) { ro[m] = function () { throw new Error('Exporting evidence is read-only: it never changes a file in the team folder (' + m + ').'); }; });
    return ro;
  }
  var EV_CHUNK = 1048576, EV_TRIES = 3, EV_KEY = /^[a-z0-9][a-z0-9-]{0,59}\/[a-z0-9-]{1,40}$/i, EV_PROC = /^[a-z0-9][a-z0-9-]{0,59}$/;
  function evCancelled() { var e = new Error('Export canceled. Nothing was saved.'); e.cancelled = true; return e; }
  function evYield() { return new Promise(function (res) { setTimeout(res, 0); }); }
  function evMsg(e) { return e && e.message || String(e); }

  /* scope: { run: '<process>/<id>' } or { process, from, through, tz } (days inclusive in tz, against each run's created).
     opts: attachments (default true), keepBytes (keep every original's bytes for writing; the command line rereads them
     instead), cap (bytes; the browser's), maxFile (one file's limit; 100 MB when there's a cap), maxRuns, now, tz, window
     (this window's unsaved or in-flight change to the runs), app, madeWith, format, plan (stop after the estimate),
     progress(o), cancelled(), pool (false: no shared pool). Resolves to the collection PF.evidence.generate turns into a pack. */
  function collectEvidence(fsIn, scope, opts) {
    opts = opts || {};
    var E = PF.evidence, S = PF.sha256, Z = PF.zip, C = PF.corrections, FU = PF.followups;
    var ro = readOnlyView(opts.pool === false ? fsIn : bounded(fsIn, 'export'));
    var now = opts.now || Date.now, cap = opts.cap || 0, maxFile = opts.maxFile != null ? opts.maxFile : cap ? E.CAPS.file : 0;
    var attachments = opts.attachments !== false, keepAll = opts.keepBytes !== false;
    var tz = scope.tz || opts.tz || 'UTC';
    var col = { format: E.FORMAT, app: opts.app || '', madeWith: opts.madeWith || '', scope: null, tz: tz, startedAt: new Date(now()).toISOString(), endedAt: '', attempts: 1,
      runs: [], files: [], exclusions: [], unresolved: [], people: {}, window: opts.window || null, options: { attachments: attachments, format: opts.format === 'report' ? 'report' : 'pack' }, status: 'complete' };
    function stop() { if (opts.cancelled && opts.cancelled()) throw evCancelled(); }
    function progress(o) { if (opts.progress) try { opts.progress(o); } catch (e) { /* a progress line never stops an export */ } }
    function listFiles(dir) {
      return ro.list(dir).then(function (items) {
        var out = [];
        return items.reduce(function (p, i) {
          return p.then(function () {
            var path = dir + '/' + i.name;
            if (i.kind === 'file') out.push({ path: path, kind: 'file' });
            else if (i.kind === 'dir') return listFiles(path).then(function (more) { out = out.concat(more); });
            else out.push({ path: path, kind: 'link' });
          });
        }, Promise.resolve()).then(function () { return out; });
      });
    }
    function names(items, dir) { return items.map(function (x) { return x.path.slice(dir.length + 1); }).sort(); }
    function textOf(path) { return ro.read(path).then(function (f) { return f ? f.text : null; }, function () { return null; }); }
    function statOf(path) { return ro.stat(path).then(function (st) { return st ? st.size : null; }); }
    /* Records (run.json, notes, decisions, a version's files) are read in full only once their size says they may be: never
       one over the limit. Decisions are tiny; one over 1 MB isn't read as one. Other runs of a process, read only to work out
       where corrections stand, have a budget of their own. */
    var recordMax = maxFile || E.CAPS.file, DEC_MAX = 1048576, CTX_MAX = cap ? Math.min(64 * 1048576, Math.floor(cap / 4)) : 64 * 1048576;
    function smallText(path, limit) {
      return statOf(path).then(function (size) {
        if (size == null) return { missing: true };
        if (size > (limit || recordMax)) return { over: size };
        return textOf(path).then(function (t) { return t == null ? { missing: true } : { text: t, size: size }; });
      });
    }
    /* Pack names: the folder's own path under originals/, made unique ignoring letter case (so the pack unpacks on Windows)
       and short enough, before any name is checked. */
    function assignPacks(list) {
      var taken = {};
      list.slice().sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; }).forEach(function (f, i) {
        var want = 'originals/' + f.path, n = 2;
        if (Z.checkName(want)) want = 'originals/_long-paths/' + (i + 1) + (/\.[\w]{1,8}$/.exec(f.path) || [''])[0];
        var base = want, fold = function (x) { return (x.normalize ? x.normalize('NFC') : x).toLowerCase(); };
        while (taken[fold(want)]) { var m = /^(.*?)(\.[^./]*)?$/.exec(base); want = m[1] + ' (' + n++ + ')' + (m[2] || ''); }
        taken[fold(want)] = true; f.pack = want;
      });
      return list;
    }

    /* ---- which runs ---- */
    function runKeys() {
      if (scope.run) {
        if (!EV_KEY.test(scope.run)) return Promise.reject(new Error('"' + scope.run + '" isn\'t a run. Give it as <process>/<run id>.'));
        col.scope = { run: scope.run, tz: tz };
        var k = scope.run.split('/');
        return ro.list('runs/' + k[0]).then(function (items) {
          if (!items.some(function (i) { return i.name === k[1] && i.kind === 'dir'; })) throw new Error('That run isn\'t in the team folder: ' + scope.run + '.');
          return [scope.run];
        });
      }
      if (!scope.process || !EV_PROC.test(scope.process)) return Promise.reject(new Error('Choose a process.'));
      var range;
      try { range = E.dayRange(scope.from, scope.through, tz); } catch (e) { return Promise.reject(e); }
      col.scope = { process: scope.process, from: scope.from, through: scope.through, tz: tz };
      return ro.list('runs/' + scope.process).then(function (items) {
        var dirs = items.filter(function (i) { return i.kind === 'dir' && /^[a-z0-9-]{1,40}$/i.test(i.name); }).map(function (i) { return i.name; }).sort();
        return limited(dirs, 8, function (id) {
          return smallText('runs/' + scope.process + '/' + id + '/run.json').then(function (r) {
            var o = r.text == null ? undefined : json(r.text);
            if (o && typeof o === 'object' && typeof o.created === 'string' && !isNaN(Date.parse(o.created))) return E.inRange(o.created, range) ? { id: id } : null;
            return { id: id, undated: r.over ? 'run.json is over ' + E.size(recordMax) : r.missing ? 'run.json is missing' : 'run.json couldn\'t be read' };
          });
        });
      }).then(function (list) {
        list = list.filter(Boolean);
        if (!list.length) throw new Error('No runs of ' + scope.process + ' were started from ' + scope.from + ' through ' + scope.through + ' (' + tz + ').');
        var max = opts.maxRuns || 0;
        if (max && list.length > max) throw new Error('That\'s ' + list.length + ' runs; a pack made here holds up to ' + max + '. Choose fewer days.');
        list.forEach(function (x) { if (x.undated) col.unresolved.push('runs/' + scope.process + '/' + x.id + ': ' + x.undated + ', so when it started can\'t be checked. It\'s included so nothing is hidden.'); });
        return list.map(function (x) { return scope.process + '/' + x.id; });
      });
    }

    /* ---- what a process's corrections, decisions and versions say, read once: for "Published in vN" ---- */
    var procCache = {};
    function processContext(proc) {
      if (procCache[proc]) return procCache[proc];
      var dirs = ['corrections', 'suggestions'];
      var decisions = Promise.all(dirs.map(function (dir) {
        return ro.list(dir + '/' + proc).then(function (items) {
          return limited(items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return i.name; }).sort(), 8, function (n) {
            var path = dir + '/' + proc + '/' + n;
            return smallText(path, DEC_MAX).then(function (r) {
              var t = r.text == null ? null : r.text, o = t == null ? undefined : json(t), d = o === undefined ? null : C.cleanDecision(o, proc, n);
              if (d && (dir === 'suggestions') !== (d.kind === 'fix-decision')) d = null;
              if (d) { d._file = n; d._dir = dir; }
              return { path: path, dir: dir, name: n, text: t, d: d };
            });
          });
        });
      })).then(function (x) { return x[0].concat(x[1]); });
      var why = '';
      /* Every run of the process, sizes first: read only within the budget, and never a file over the limit. */
      var runs = ro.list('runs/' + proc).then(function (items) {
        return limited(items.filter(function (i) { return i.kind === 'dir'; }).map(function (i) { return i.name; }).sort(), 8, function (id) {
          var base = 'runs/' + proc + '/' + id + '/';
          return ro.list(base.slice(0, -1)).then(function (files) {
            var want = files.some(function (i) { return i.name === 'run.json' && i.kind === 'file'; }) ? ['run.json'].concat(files.filter(function (i) { return i.kind === 'file' && /^notes-[\w-]+\.jsonl$/.test(i.name); }).map(function (i) { return i.name; }).sort()) : [];
            return Promise.all(want.map(function (n) { return statOf(base + n); })).then(function (sizes) { return { base: base, want: want, sizes: sizes }; });
          });
        });
      }).then(function (metas) {
        var total = 0, over = false;
        metas.forEach(function (m) { m.sizes.forEach(function (z) { if (z == null) return; total += z; if (z > recordMax) over = true; }); });
        if (over || total > CTX_MAX) { why = 'The runs of ' + proc + ' are too big to read here (' + E.size(total) + '), so where its corrections stand can\'t be worked out.'; return []; }
        return limited(metas.filter(function (m) { return m.want.length; }), 8, function (m) {
          return Promise.all(m.want.map(function (n) { return textOf(m.base + n); })).then(function (t) {
            if (t[0] == null || !R.sanitize(json(t[0]))) return null;
            return build({ text: t[0], base: m.base, notes: t.slice(1), conflicts: [], fileHash: U.hash(t[0]), notesSig: '', unrunnable: '' }, null);
          });
        }).then(function (x) { return x.filter(Boolean); });
      });
      var pubs = ro.list('publications/' + proc).then(function (items) {
        return limited(items.filter(function (i) { return i.kind === 'dir' && P.versionOf(i.name); }).map(function (i) { return i.name; }).sort(), 8, function (folder) {
          var b = 'publications/' + proc + '/' + folder + '/';
          return Promise.all(['map.md', 'types.json', 'publication.json'].map(function (n) { return smallText(b + n); })).then(function (rs) {
            var t = rs.map(function (r) { return r.text == null ? null : r.text; }), files = { 'map.md': t[0], 'types.json': t[1], 'publication.json': t[2] }, v = P.verify(folder, files);
            return { folder: folder, files: files, v: v };
          });
        });
      });
      return (procCache[proc] = Promise.all([decisions, runs, pubs]).then(function (r) {
        var ds = r[0], pubList = r[2], verified = pubList.filter(function (p) { return p.v.ok; }).map(function (p) { return p.v; });
        var idx = P.index(verified), groups = why ? [] : C.forProcess(r[1], proc, ds.filter(function (x) { return x.d; }).map(function (x) { return x.d; }), idx);
        return { decisions: ds, groups: groups, pubs: pubList, why: why };
      }));
    }

    /* ---- one run: list and stat what goes in (nothing read in full yet, except the small records that decide it) ---- */
    function planRun(key) {
      var k = key.split('/'), proc = k[0], id = k[1], base = 'runs/' + proc + '/' + id;
      var p = { key: key, process: proc, id: id, base: base, files: [], excl: [], listing: [], fuListing: [], decListing: [], texts: {}, readTexts: {} };
      function add(path, cls, runs) { p.files.push({ path: path, role: cls.role, label: cls.label, flag: cls.flag || '' }); }
      return listFiles(base).then(function (items) {
        p.listing = names(items, base);
        p.items = items;
        return smallText(base + '/run.json');
      }).then(function (r) {
        var runText = r.text == null ? null : r.text, raw = runText == null ? undefined : json(runText);
        p.runText = runText;
        /* What's kept and left out is decided from this text; the bytes hashed into the pack must be the same text. */
        if (runText != null) p.readTexts[base + '/run.json'] = runText;
        var lineage = raw && typeof raw === 'object' && Array.isArray(raw.lineage) ? raw.lineage.filter(function (t) { return typeof t === 'string'; }) : null;
        p.folder = raw && typeof raw === 'object' && typeof raw.folder === 'string' && P.versionOf(raw.folder) ? raw.folder : '';
        p.items.forEach(function (x) {
          var rel = x.path.slice(base.length + 1);
          if (x.kind === 'link') { p.excl.push({ path: x.path, reason: 'a link; Flightdeck never follows links' }); return; }
          var cls = E.classify(rel, lineage);
          if (cls.exclude) p.excl.push({ path: x.path, reason: cls.exclude });
          else add(x.path, cls);
        });
        var notes = p.files.filter(function (f) { return f.role === 'notes'; });
        return Promise.all(notes.map(function (f) { return smallText(f.path).then(function (r) { if (r.text != null) p.readTexts[f.path] = r.text; return r.text == null ? null : r.text; }); })).then(function (t) {
          var ids = { corr: {}, fix: {} };
          t.forEach(function (x) { if (x != null) E.notesFile(x).notes.forEach(function (n) { if (n.note.kind === 'correction') ids.corr[n.note.id] = true; if (n.note.kind === 'fix' || n.note.kind === 'map') ids.fix[n.note.id] = true; }); });
          p.ids = ids;
        });
      }).then(function () {
        /* Follow-up decisions on this run, OneDrive's copies of them, and any that can't be read. */
        return ro.list('followups/' + proc).then(function (items) {
          var mine = items.filter(function (i) { return i.kind === 'file' && i.name.indexOf(id + '.') === 0 && /\.json$/i.test(i.name); }).map(function (i) { return i.name; }).sort();
          p.fuListing = mine;
          return limited(mine, 8, function (n) {
            var path = 'followups/' + proc + '/' + n;
            return smallText(path, DEC_MAX).then(function (r) {
              var t = r.text == null ? null : r.text;
              if (t != null) p.readTexts[path] = t;
              var o = t == null ? undefined : json(t), d = o === undefined ? null : FU.cleanDecision(o, proc, n), loose = !d && o ? FU.cleanDecision(o, proc) : null;
              add(path, { role: 'followup', label: 'What became of a follow-up', flag: d ? '' : o === undefined ? 'couldn\'t be read; may relate to this run' : loose ? 'a copy of a decision under another name (OneDrive may have made it)' : 'isn\'t a decision this copy can read; may relate to this run' });
            });
          });
        });
      }).then(function () {
        return processContext(proc).then(function (ctx) {
          p.ctx = ctx;
          var mineGroups = {};
          ctx.groups.forEach(function (g) { if (g.members.some(function (c) { return c.run === id; })) mineGroups[g.id] = g; });
          p.groups = mineGroups;
          p.decListing = ctx.decisions.map(function (x) { return x.path; }).sort();
          ctx.decisions.forEach(function (x) {
            var d = x.d;
            if (x.text != null) p.readTexts[x.path] = x.text;
            if (!d) { add(x.path, { role: x.dir === 'suggestions' ? 'suggestion' : 'correction', label: x.dir === 'suggestions' ? 'A decision on a suggested fix (before 1.13)' : 'A decision on corrections', flag: 'couldn\'t be read; may relate to this run' }); return; }
            if (d.kind === 'fix-decision' ? p.ids.fix[d.suggestion] : ((d.members || []).some(function (m) { return p.ids.corr[m]; }) || mineGroups[d.group]))
              add(x.path, d.kind === 'fix-decision' ? { role: 'suggestion', label: 'A decision on a suggested fix (before 1.13)' } : { role: 'correction', label: 'A decision on corrections' });
          });
          /* The version the run names, and the versions behind any "Published in vN". */
          var vers = {};
          if (p.folder) vers[p.folder] = 'publication';
          p.claims = [];
          Object.keys(mineGroups).forEach(function (gid) {
            var g = mineGroups[gid];
            g.members.filter(function (c) { return c.run === id; }).forEach(function (c) {
              if (g.landed) { vers[g.landed.folder] = vers[g.landed.folder] || 'proof'; p.claims.push({ correction: c.id, group: g.id, text: 'Published in v' + g.landed.version, folder: g.landed.folder }); return; }
              /* A version that lists the correction but can't be checked: the claim can't be confirmed from what's here. */
              ctx.pubs.forEach(function (pub) {
                if (pub.v.ok) return;
                var info = pub.files['publication.json'] != null ? json(pub.files['publication.json']) : undefined;
                if (info && typeof info === 'object' && C.listed(info)[g.id]) { vers[pub.folder] = vers[pub.folder] || 'proof'; p.claims.push({ correction: c.id, group: g.id, text: 'Published in v' + P.versionOf(pub.folder), folder: pub.folder, why: pub.v.why }); }
              });
            });
          });
          return Promise.all(Object.keys(vers).map(function (folder) {
            var b = 'publications/' + proc + '/' + folder;
            return listFiles(b).then(function (items) {
              items.forEach(function (x) {
                if (x.kind === 'link') { p.excl.push({ path: x.path, reason: 'a link; Flightdeck never follows links' }); return; }
                var rel = x.path.slice(b.length + 1), pub = ctx.pubs.filter(function (q) { return q.folder === folder; })[0];
                if (pub && pub.files[rel] != null) p.readTexts[x.path] = pub.files[rel];
                if (vers[folder] === 'publication' && (['map.md', 'types.json', 'publication.json'].indexOf(rel) >= 0 || rel.indexOf('images/') === 0)) add(x.path, { role: 'publication', label: rel.indexOf('images/') === 0 ? 'A screenshot in the version the run ran' : 'The version the run ran' });
                else if (['map.md', 'types.json', 'publication.json'].indexOf(rel) >= 0) add(x.path, { role: 'proof', label: 'Backs up "Published in v' + P.versionOf(folder) + '"' });
              });
            });
          }));
        });
      }).then(function () {
        /* Sizes, without reading. Attachments left out, or over the one-file limit, are listed with their size and never read. */
        var seen = {};
        p.files = p.files.filter(function (f) { if (seen[f.path]) return false; seen[f.path] = true; return true; });
        return limited(p.files, 8, function (f) { return statOf(f.path).then(function (s) { f.size = s; }); }).then(function () {
          p.files = p.files.filter(function (f) {
            if (f.size == null) { p.changes = (p.changes || []).concat([f.path.split('/').pop() + ' was removed']); return false; }
            if (f.role === 'attachment' && !attachments) { p.excl.push({ path: f.path, reason: 'left out, not hashed', size: f.size }); return false; }
            if (maxFile && f.size > maxFile) { p.excl.push({ path: f.path, reason: 'over ' + E.size(maxFile) + ', the most one file can be in a pack made here', size: f.size }); return false; }
            return true;
          });
          return p;
        });
      });
    }

    /* ---- reading: every file hashed in 1 MB chunks, a yield between them, canceled between them ---- */
    function keepBytes(f) { return keepAll || (f.size <= recordMax && (f.role !== 'attachment' || /\.(png|jpe?g|gif|webp)$/i.test(f.path))); }
    /* A file that turned into a link since it was listed is never read: it counts as removed, so the run is listed again
       (and the link left out, with its reason). */
    function hashFile(f) {
      return ro.blob(f.path).then(null, function (e) { if (e && e.link) return null; throw e; }).then(function (b) {
        if (!b) return { gone: true };
        var h = S.create(), crc = 0, off = 0, size = b.size, parts = keepBytes(f) ? [] : null;
        function step() {
          stop();
          if (off >= size) { if (b.close) b.close(); return { size: off, sha256: h.digest(), crc: crc, bytes: parts }; }
          return b.slice(off, Math.min(size, off + EV_CHUNK)).arrayBuffer().then(function (ab) {
            var u = new Uint8Array(ab);
            if (!u.length) throw new Error(f.path + ' ended early while it was read.');
            h.update(u); crc = Z.crc32(u, crc); if (parts) parts.push(u); off += u.length;
            return evYield().then(step);
          });
        }
        return Promise.resolve().then(step).then(null, function (e) { if (b.close) b.close(); throw e; });
      });
    }
    function readRun(p, n0, total) {
      var changes = (p.changes || []).slice(), done = n0;
      return p.files.reduce(function (q, f) {
        return q.then(function () {
          stop();
          progress({ phase: 'read', done: ++done, total: total, path: f.path });
          return hashFile(f).then(function (r) {
            if (r.gone) { changes.push(f.path.split('/').pop() + ' was removed'); return; }
            if (r.size !== f.size) changes.push(f.path.split('/').pop() + (r.size > f.size ? ' grew' : ' changed'));
            f.size = r.size; f.sha256 = r.sha256; f.crc = r.crc; f.bytes = r.bytes; f.image = r.bytes && r.bytes.length ? E.imageType(f.path, r.bytes[0]) : '';
            if (f.bytes && f.role !== 'attachment' && f.size <= recordMax) p.texts[f.path] = E.text(E.join(f.bytes));
            /* A record read earlier to decide what goes in must be exactly what's packed; otherwise the run is read again. */
            var nm = f.path.split('/').pop();
            if (p.readTexts[f.path] !== undefined && p.texts[f.path] !== p.readTexts[f.path] && !changes.some(function (c) { return c.indexOf(nm + ' ') === 0; })) changes.push(nm + ' changed');
          });
        });
      }, Promise.resolve()).then(function () { return changes; });
    }
    /* After reading: the run folder listed again, run.json reread, notes and every file's size checked, decision folders listed. */
    function recheck(p) {
      var changes = [];
      return listFiles(p.base).then(function (items) {
        var now = names(items, p.base);
        now.forEach(function (n) { if (p.listing.indexOf(n) < 0) changes.push(n + ' was added'); });
        p.listing.forEach(function (n) { if (now.indexOf(n) < 0) changes.push(n + ' was removed'); });
        var rj = p.files.filter(function (f) { return f.path === p.base + '/run.json'; })[0];
        return (rj ? hashFile({ path: rj.path, role: 'attachment' }).then(function (r) { if (r.gone || r.sha256 !== rj.sha256) changes.push('run.json changed'); }) : Promise.resolve()).then(function () {
          return limited(p.files.filter(function (f) { return f.path.indexOf(p.base + '/') === 0 && f.role !== 'run'; }), 8, function (f) {
            return statOf(f.path).then(function (s) { var n = f.path.slice(p.base.length + 1); if (s == null) changes.push(n + ' was removed'); else if (s !== f.size) changes.push(n + (s > f.size ? ' grew' : ' changed')); });
          });
        });
      }).then(function () {
        return ro.list('followups/' + p.process).then(function (items) {
          var now = items.filter(function (i) { return i.kind === 'file' && i.name.indexOf(p.id + '.') === 0 && /\.json$/i.test(i.name); }).map(function (i) { return i.name; }).sort();
          if (now.join('/') !== p.fuListing.join('/')) changes.push('a follow-up decision was added or removed');
        });
      }).then(function () {
        return Promise.all(['corrections', 'suggestions'].map(function (dir) {
          return ro.list(dir + '/' + p.process).then(function (items) { return items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return dir + '/' + p.process + '/' + i.name; }); });
        })).then(function (x) {
          if (x[0].concat(x[1]).sort().join('/') !== p.decListing.join('/')) changes.push('a decision on corrections was added or removed');
        });
      }).then(function () {
        return changes;
      });
    }

    /* ---- what the page says about one run ---- */
    function interpret(p) {
      var rc = { key: p.key, process: p.process, id: p.id, title: '', source: { runJson: null, listing: p.listing }, raw: null, run: null, map: null, notes: [], corrections: [], claims: [], checks: [], fuDecisions: [], limited: '' };
      var limits = [], rj = p.files.filter(function (f) { return f.path === p.base + '/run.json'; })[0];
      var raw = rj ? json(p.texts[rj.path]) : undefined;
      if (!rj) { limits.push('run.json is missing, so only the other files are shown.'); col.unresolved.push(p.key + ': run.json is missing. The pack holds the other files in its folder.'); }
      else if (raw === undefined) limits.push('run.json isn\'t complete JSON.');
      rc.raw = raw && typeof raw === 'object' ? raw : null;
      if (rj) rc.source.runJson = { rev: rc.raw && typeof rc.raw.rev === 'number' ? rc.raw.rev : null, sha256: rj.sha256 };
      var run = rc.raw ? R.sanitize(rc.raw) : null;
      if (rc.raw && !run) limits.push('run.json isn\'t a run this copy can read.');
      if (run && run._unrunnable) limits.push(run._unrunnable);
      if (run && run._badTimes) limits.push('Some times in run.json couldn\'t be read, so this page shows them as unknown; the original file has them as written.');
      rc.title = run ? run.title : rc.raw && typeof rc.raw.title === 'string' ? rc.raw.title.slice(0, 100) : '';
      var notes = [];
      p.files.filter(function (f) { return f.role === 'notes'; }).sort(function (a, b) { return a.path < b.path ? -1 : 1; }).forEach(function (f) {
        var t = p.texts[f.path], nf = t == null ? { notes: [], malformed: [], lines: 0 } : E.notesFile(t); nf.file = f.path.split('/').pop(); rc.notes.push(nf);
        if (t == null) limits.push(nf.file + ' is too big to show here; it\'s in the pack as it is.');
        nf.notes.forEach(function (x) { notes.push(cleanNote(x.note, p.base + '/')); });
      });
      if (rc.notes.some(function (n) { return n.malformed.length; })) limits.push('Some lines in its notes files couldn\'t be read.');
      if (run) {
        run._notes = notes.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
        rc.run = run;
        try { rc.map = R.mapOf(run); } catch (e) { rc.map = null; }
        var byId = C.statusById(Object.keys(p.groups).map(function (k) { return p.groups[k]; }));
        try { rc.corrections = rc.map ? C.forRun(run, rc.map).map(function (c) { var g = byId[c.id]; return Object.assign({}, c, { status: c.oneOff ? 'One-off' : p.ctx && p.ctx.why ? 'Can\'t be worked out here' : g ? C.label(g) : 'Open' }); }) : []; } catch (e) { rc.corrections = []; }
        if (p.ctx && p.ctx.why) limits.push(p.ctx.why);
      }
      rc.fuDecisions = p.files.filter(function (f) { return f.role === 'followup'; }).map(function (f) { var o = json(p.texts[f.path]); return o ? PF.followups.cleanDecision(o, p.process, f.path.split('/').pop()) : null; }).filter(Boolean);
      var pubTexts = {};
      if (p.folder) ['map.md', 'types.json', 'publication.json'].forEach(function (n) { var x = p.texts['publications/' + p.process + '/' + p.folder + '/' + n]; if (x != null) pubTexts[n] = x; });
      rc.checks = E.checks(rc.raw, p.folder ? pubTexts : null);
      if (rc.raw && !p.folder) limits.push('The version it names isn\'t one this copy can find.');
      rc.claims = p.claims.map(function (c) {
        var proof = ['map.md', 'types.json', 'publication.json'].map(function (n) { return 'publications/' + p.process + '/' + c.folder + '/' + n; });
        var have = proof.every(function (x) { return p.files.some(function (f) { return f.path === x && f.sha256; }); });
        var ok = have && !c.why;
        return { correction: c.correction, group: c.group, text: c.text, folder: c.folder, proof: proof, verified: ok, status: ok ? c.text : 'Can\'t be confirmed from this pack: ' + (c.why || 'the files of that version aren\'t all here.') };
      });
      rc.limited = limits.join(' ');
      return rc;
    }

    /* ---- the whole collection ---- */
    var plans = [], peopleOut = [];
    function exclusions() { return plans.reduce(function (a, p) { return a.concat(p.excl); }, peopleOut.slice()); }
    /* Sizes alone, before any record is read: the run folders, as they'd go in (every save receipt counted), checked against
       the limits and the cap. */
    function preEstimate(keys) {
      var list = [];
      return keys.reduce(function (q, key) {
        return q.then(function () {
          stop();
          var k = key.split('/'), base = 'runs/' + k[0] + '/' + k[1];
          return listFiles(base).then(function (items) {
            var fl = items.filter(function (x) { var rel = x.path.slice(base.length + 1); return x.kind === 'file' && !/\.tmp$/i.test(rel) && (attachments || !/^files\//.test(rel)); });
            return limited(fl, 8, function (x) { return statOf(x.path).then(function (z) { if (z != null && !(maxFile && z > maxFile)) list.push({ path: x.path, size: z, role: /^files\//.test(x.path.slice(base.length + 1)) ? 'attachment' : 'record' }); }); });
          });
        });
      }, Promise.resolve()).then(function () {
        var est = E.estimate(assignPacks(list), cap);
        if (!est.ok) throw new Error(est.why + ' Export fewer runs, or leave out attachments.');
        return keys;
      });
    }
    progress({ phase: 'list' });
    return runKeys().then(preEstimate).then(function (keys) {
      return keys.reduce(function (q, k) { return q.then(function () { stop(); return planRun(k).then(function (p) { plans.push(p); }); }); }, Promise.resolve());
    }).then(function () {
      return textOf(PF.people.FILE).then(function (t) {
        if (t == null) return;
        PF.people.clean(json(t)).forEach(function (x) { col.people[x.id] = x.name; });
        peopleOut = [{ path: PF.people.FILE, reason: 'The people directory and its email fields are left out. The page shows names and IDs from it.' }];
      });
    }).then(function () {
      /* The estimate, before anything is read in full: refused here if it can't fit. */
      var all = {}, list = [];
      plans.forEach(function (p) { p.files.forEach(function (f) { if (!all[f.path]) { all[f.path] = true; list.push({ path: f.path, size: f.size, role: f.role }); } }); });
      var est = E.estimate(assignPacks(list), cap);
      col.estimate = est.bytes || 0;
      col.exclusions = exclusions();
      if (!est.ok) throw new Error(est.why + ' Export fewer runs, or leave out attachments.');
      if (opts.plan) { col.files = list; col.runs = plans.map(function (p) { return { key: p.key }; }); return col; }
      var total = list.length, done = 0;
      return plans.reduce(function (q, p, i) {
        return q.then(function () {
          var attempt = 1;
          function go(pl) {
            return readRun(pl, done, total).then(function (c1) {
              progress({ phase: 'check', done: done, total: total });
              return recheck(pl).then(function (c2) {
                var changes = c1.concat(c2).filter(function (x, j, a) { return a.indexOf(x) === j; });
                if (!changes.length || attempt >= EV_TRIES) { pl.unresolved = changes; pl.attempts = attempt; return pl; }
                attempt++;
                delete procCache[pl.process];
                return planRun(pl.key).then(go);
              });
            });
          }
          return go(p).then(function (pl) { plans[i] = pl; done += pl.files.length; });
        });
      }, Promise.resolve()).then(finish);
    });
    function finish() {
      var seen = {};
      col.exclusions = exclusions();
      plans.forEach(function (p) {
          col.attempts = Math.max(col.attempts, p.attempts || 1);
          p.files.forEach(function (f) {
            if (seen[f.path]) { if (seen[f.path].runs.indexOf(p.key) < 0) seen[f.path].runs.push(p.key); return; }
            f.runs = [p.key]; seen[f.path] = f; col.files.push(f);
          });
          if (p.unresolved && p.unresolved.length) col.unresolved.push('The run changed while this pack was made: ' + p.unresolved.join(', ') + '.' + (plans.length > 1 ? ' (' + p.key + ')' : ''));
        });
        col.files.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
        assignPacks(col.files);
        col.runs = plans.map(interpret);
        col.endedAt = new Date(now()).toISOString();
        col.status = col.unresolved.length ? 'partial' : 'complete';
        return col;
    }
  }

  /* Collect, then write the pack through opts.sink(bytes) as it goes (or the one-page report with format: 'report').
     Resolves to { status: complete | partial, name, bytes, digest (the SHA-256 of exactly what went to the sink), col }. */
  function exportEvidence(fsIn, scope, opts) {
    opts = opts || {};
    var E = PF.evidence, Z = PF.zip, S = PF.sha256, now = opts.now || Date.now;
    var ro = readOnlyView(opts.pool === false ? fsIn : bounded(fsIn, 'export'));
    function stop() { if (opts.cancelled && opts.cancelled()) throw evCancelled(); }
    return collectEvidence(fsIn, scope, opts).then(function (col) {
      var h = S.create(), total = 0, name = E.packName(col, now(), U.randomId(6));
      function sink(u8) { h.update(u8); total += u8.length; return opts.sink(u8); }
      function result() { return { status: col.status, name: name, bytes: total, digest: h.digest(), col: col }; }
      stop();
      if (opts.begin) opts.begin(name);
      /* The report goes through the same byte accounting as a pack: past the cap, nothing is handed over. */
      if (col.options.format === 'report') {
        var page = S.utf8(E.page(col, { report: true }));
        if (opts.cap && page.length > opts.cap) return Promise.reject(new Error('The report would be ' + E.size(page.length) + ', over the ' + E.size(opts.cap) + ' limit here. Export fewer runs.'));
        return Promise.resolve(sink(page)).then(result);
      }
      var gen = E.generate(col), w = Z.writer({ sink: sink, cap: opts.cap || 0, date: new Date(now()) }), n = 0;
      if (opts.progress) opts.progress({ phase: 'write', done: 0, total: col.files.length });
      return col.files.reduce(function (q, f) {
        return q.then(function () {
          stop();
          if (opts.progress) opts.progress({ phase: 'write', done: ++n, total: col.files.length, path: f.path });
          return w.begin(f.pack, f.size, f.crc).then(function () {
            if (f.bytes) { var parts = f.bytes; f.bytes = null; return parts.reduce(function (p2, u) { return p2.then(function () { return w.data(u); }); }, Promise.resolve()); }
            /* Not kept in memory (the command line): read again, chunk by chunk; the writer checks it's the same size and CRC. */
            return ro.blob(f.path).then(function (b) {
              if (!b) { var e = new Error(f.path + ' changed while the pack was written. Try again.'); e.changed = true; throw e; }
              /* Read again: the bytes written must have the SHA-256 the manifest gives, not only the same size and CRC. */
              var off = 0, again = S.create();
              function step() {
                stop();
                if (off >= b.size) {
                  if (b.close) b.close();
                  if (again.digest() !== f.sha256) { var e2 = new Error(f.path + ' changed while the pack was written. Try again.'); e2.changed = true; throw e2; }
                  return;
                }
                return b.slice(off, Math.min(b.size, off + EV_CHUNK)).arrayBuffer().then(function (ab) { var u = new Uint8Array(ab); if (!u.length) throw new Error(f.path + ' ended early while it was read.'); off += u.length; again.update(u); return w.data(u); }).then(evYield).then(step);
              }
              return Promise.resolve().then(step).then(null, function (e) { if (b.close) b.close(); throw e; });
            });
          }).then(function () { return w.end(); });
        });
      }, Promise.resolve()).then(function () {
        return gen.files.reduce(function (q, g) { return q.then(function () { stop(); return w.add(g.path, g.bytes); }); }, Promise.resolve());
      }).then(function () { return w.finish(); }).then(result);
    });
  }

  return { readOnly: readOnlyView, collectEvidence: collectEvidence, exportEvidence: exportEvidence, poolOf: poolOf, lane: bounded, runSig: runSig, historyDir: historyDir, appendHistory: appendHistory, loadEditHistory: loadEditHistory, config: config, loadStepTypes: loadStepTypes, saveDraft: saveDraft, applyCorrection: applyCorrection, decideFollowUp: decideFollowUp, saveStepType: saveStepType, recordValidation: recordValidation, savePeople: savePeople, writeTest: writeTest, loadAnswers: loadAnswers, loadAll: loadAll, loadRun: loadRun, loadHistory: loadHistory, readCopy: readCopy, removeCopy: removeCopy, keepDisplaced: keepDisplaced, saveRun: saveRun, addNote: addNote, saveAttachment: saveAttachment, publish: publish, savePlan: savePlan, recordPlanStatus: recordPlanStatus, decideCorrection: decideCorrection, scan: scan, loadConnection: loadConnection, sendProbe: sendProbe, sendAck: sendAck, cleanConnection: cleanConnection };
})();
