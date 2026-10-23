/* The team folder: reading everything, saving runs safely, publishing maps. See docs/design.md section 4. */
PF.repo = (function () {
  'use strict';
  var U = PF.util, P = PF.publish, R = PF.run;

  function json(text) { try { return JSON.parse(text); } catch (e) { return undefined; } }
  /* A run.json's fingerprint, compared before every save of it: SHA-256 of its exact text. */
  function fileHash(text) { return PF.sha256.hex(text); }
  function readJson(fs, path) { return fs.read(path).then(function (f) { return f ? json(f.text) : null; }); }

  /* The people list as the app shows it, carrying the file's own document and fingerprint, so the folder owner's changes in
     Settings are applied to exactly what was read and saved only over that (repo.savePeople). */
  function loadPeople(fs) {
    return fs.read(PF.people.FILE).then(function (f) {
      var o = f ? json(f.text) : null, v = PF.people.verdict(o);
      if (!v.ok) { var e = new Error(v.why); e.newer = true; e.needs = v.needs; throw e; }
      var out = PF.people.clean(o);
      out.hash = f ? U.hash(f.text) : null; out.text = f ? f.text : null; out.doc = o === undefined ? null : o;
      return out;
    });
  }

  /* Drafts over 1 MB of UTF-8 (U.DRAFT_BYTES) are listed as too big, never loaded: the same limit every draft save checks, so
     Flightdeck never saves a draft it would refuse to read. Measured on the bytes read, also where a folder can't say first. */
  function tooBigWhy(bytes) { return 'is ' + (Math.ceil(bytes / 1048576 * 100) / 100) + ' MB, over the 1 MB Flightdeck reads for a draft'; }
  function loadDrafts(fs) {
    return fs.list('maps/drafts').then(function (items) {
      return Promise.all(items.filter(function (i) { return i.kind === 'file' && /\.md$/i.test(i.name); }).map(function (i) {
        var path = 'maps/drafts/' + i.name;
        return fs.read(path, { maxBytes: U.DRAFT_BYTES }).then(function (f) {
          if (f && U.utf8Bytes(f.text) > U.DRAFT_BYTES) return { unread: path, file: i.name, why: tooBigWhy(U.utf8Bytes(f.text)) };
          return f ? { file: i.name, md: f.text, mtime: f.mtime } : null;
        }, function (e) { return { unread: path, file: i.name, why: e && e.skipped && e.size ? tooBigWhy(e.size) : why(e) }; });
      }));
    }).then(function (x) {
      var out = x.filter(function (d) { return d && !d.unread; });
      out.unreadable = x.filter(function (d) { return d && d.unread; }).map(function (d) { return { path: d.unread, draft: d.file, why: d.why }; });
      return out;
    });
  }
  function why(e) { return 'couldn\'t be read (' + (e && e.message || String(e)) + ')'; }
  /* What kind of failure a read was: a link the folder refused to follow, a file over the size the reader allows, or any
     other failure. */
  function errKind(e) { return e && e.link ? 'link' : e && e.skipped ? 'skipped' : 'unreadable'; }
  /* readRun's answer, with explain, for a run folder that has no run.json. */
  var NOFILE = Object.freeze({ kind: 'nofile' });

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
  /* explain (reading for other apps): a version or process folder that fails to read is kept apart (a version with
     _readFailed, a process left out) instead of failing every version; the folder's ledger names the file. */
  function loadPublications(fs, cache, deep, explain) {
    var seen = {};
    cache.bad = cache.bad || {}; cache.approved = cache.approved || {};
    return fs.list('publications').then(function (procs) {
      return Promise.all(procs.filter(function (p) { return p.kind === 'dir'; }).map(function (p) {
        var one = fs.list('publications/' + p.name).then(function (vers) {
          return Promise.all(vers.filter(function (v) { return v.kind === 'dir' && P.versionOf(v.name); }).map(function (v) {
            var base = 'publications/' + p.name + '/' + v.name + '/';
            seen[base] = true;
            if (!deep && cache.pubs[base]) return cache.pubs[base];
            var got = readVersion(fs, p.name, v.name).then(function (res) {
              if (res.ok) cache.pubs[base] = res; else delete cache.pubs[base];
              if (res.unusable) cache.bad[base] = res.why; else delete cache.bad[base];
              return res;
            });
            return explain ? got.then(null, function (e) { delete cache.pubs[base]; return { ok: false, why: why(e), folder: v.name, process: p.name, _readFailed: true }; }) : got;
          }));
        });
        if (explain) one = one.then(null, function () { return null; });
        return one.then(function (pubs) { return pubs && { process: p.name, pubs: pubs, index: P.index(pubs) }; });
      }));
    }).then(function (out) {
      /* A folder that's gone is forgotten, so one recreated under the same name is judged afresh. */
      [cache.pubs, cache.bad, cache.approved].forEach(function (m) { Object.keys(m).forEach(function (k) { if (/^publications\//.test(k) && !seen[k]) delete m[k]; }); });
      return out.filter(Boolean);
    });
  }
  /* One version folder, verified as a refresh does: its checklist, step types and record, then its screenshots. */
  function readVersion(fs, proc, folder) {
    var base = 'publications/' + proc + '/' + folder + '/';
    return Promise.all(['map.md', 'types.json', 'publication.json'].map(function (n) { return fs.read(base + n); })).then(function (r) {
      return verifyExact(fs, base, folder, { 'map.md': r[0] && r[0].text, 'types.json': r[1] && r[1].text, 'publication.json': r[2] && r[2].text });
    }).then(function (res) {
      res.folder = folder; res.process = proc;
      return checkImages(fs, base, res);
    });
  }
  /* A version verified as the app verifies it: a /2 version by the SHA-256 of the exact bytes of its checklist and step
     types (P.exactOf), read only when it is /2. Every reader of a version in a folder goes through this. */
  function verifyExact(fs, base, folder, texts, vo) {
    var check = function (exact) { return P.verify(folder, texts, exact, vo); }, res = check(null);
    if (!res.needsBytes) return Promise.resolve(res);
    var raw = function (n) { return fs.blob(base + n).then(function (b) { return b ? bytesOf(b) : null; }, function () { return null; }); };
    return Promise.all([raw('map.md'), raw('types.json')]).then(function (b) { return check(P.exactOf({ 'map.md': b[0], 'types.json': b[1] })); });
  }

  function bytesOf(blob) { return blob.arrayBuffer().then(function (buf) { return new Uint8Array(buf); }); }
  function fnvBytes(b) {
    var s = '';
    for (var i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768));
    return U.hash(s);
  }
  function bytesHash(blob) { return bytesOf(blob).then(fnvBytes); }
  /* Every screenshot a version records must be there and match: its fingerprint, and for a /2 version the SHA-256 of its
     exact bytes in the payload too. */
  function checkImages(fs, base, res) {
    var imgs = res.ok && res.info.images ? Object.keys(res.info.images) : [];
    var strong = res.ok && res.info.format === P.FORMAT2 && res.info.payload ? res.info.payload.images : null;
    return imgs.reduce(function (p, src) {
      return p.then(function (r) {
        if (!r.ok) return r;
        return fs.blob(base + src).then(function (b) { return b ? bytesOf(b) : null; }).then(function (b) {
          var good = !!b && fnvBytes(b) === res.info.images[src] && (!strong || PF.sha256.create().update(b).digest() === strong[src]);
          return good ? r : { ok: false, why: b ? 'Screenshot ' + src + ' doesn\'t match its publication record.' : 'Still syncing: screenshot ' + src + ' hasn\'t arrived.', info: r.info, folder: r.folder, process: r.process };
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
    var nofile = [];
    /* Reading for other apps: a run folder without run.json is named (nofile), never just skipped. */
    function readOne(proc, id, all, bad) {
      return readRun(fs, proc, id, cache, all, true, bad, o).then(function (entry) {
        if (entry === NOFILE) { nofile.push({ path: 'runs/' + proc + '/' + id + '/run.json', key: proc + '/' + id }); return null; }
        return entry;
      });
    }
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
        return go().then(null, function (e) { delete cache.runs[key]; bad.push({ path: dir + '/run.json', key: key, kind: errKind(e), why: why(e) }); return null; }).then(function (res) {
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
            return fingerprint(fs, dir).then(function (fp) { before = fp; return readOne(proc, id, all, bad); }).then(function (entry) {
              if (cache.sized == null && entry) cache.sized = isExact(entry);
              return fingerprint(fs, dir).then(function (after) { return keep(entry, after === before ? after : null, t0, all); });
            });
          }
          /* Sizes and times come with the reads: stat only the files that weren't read (copies, receipts, history), then
             list again. The run is cached only if the folder still holds the same files, under the stamps of the texts read;
             anything that changed after its read shows up as a different stamp at the next check. */
          return readOne(proc, id, all, bad).then(function (entry) {
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
        return { reads: reads, keys: keys, complete: true, unreadable: unreadable, nofile: nofile };
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
  /* A test run (2.1), as PF.run.isTest says it. */
  function isTestRun(r) { return !!r && (r.test === true || r._test === true); }
  function badFor(cache, entry) { return (cache.bad || {})[(P.STAGE.test(String(entry.folder)) ? 'staged/' : 'publications/') + entry.process + '/' + entry.folder + '/'] || ''; }
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
    if (entry.repairs && entry.repairs.length) run._repairs = entry.repairs;
    if (entry.drift && entry.drift.length) run._drift = entry.drift;
    run._path = base; run._mtime = entry.mtime; run._conflicts = entry.conflicts.slice(); run._fileHash = entry.fileHash; run._notesSig = entry.notesSig;
    if (entry.recheckAt) run._recheckAt = entry.recheckAt;
    var notes = [], torn = [];
    /* A line that isn't empty and isn't complete JSON (a torn append, or one still arriving) is named, never guessed at:
       _noteLines [{ file, line }] (2.1.1). JSON that isn't a note is left out, as before. */
    entry.notes.forEach(function (t, i) {
      if (t == null) return;
      t.split('\n').forEach(function (line, j) {
        var o = line.trim() ? json(line) : null;
        if (o === undefined) { torn.push({ file: entry.noteFiles ? entry.noteFiles[i] : '', line: j + 1 }); return; }
        var n = noteOf(o, base); if (n) notes.push(n);
      });
    });
    run._notes = notes.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    if (torn.length) run._noteLines = torn;
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
  function pubProblem(fs, run, cacheIn, strict) {
    if (run && isTestRun(run) && typeof run.process === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(run.process)) return stageOfRun(fs, run, cacheIn, strict);
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
        var newer = P.newerOf(info);
        if (newer) return newer;
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
          return verifyExact(fs, dir, run.folder, { 'map.md': r[0] && r[0].text, 'types.json': r[1] && r[1].text, 'publication.json': f.text });
        }).then(function (v) {
          if (!v.ok) return v.unusable ? (c.bad[dir] = v.why) : '';
          /* Its screenshots, and a /2 version's exact bytes, as a refresh checks them: not matching yet is still syncing. */
          return checkImages(fs, dir, v).then(function (x) { return x.ok ? approve(info) : ''; });
        }, function () { return ''; });
      }, function () { return ''; });
    });
  }
  /* Why a run.json (raw, and as cleaned) isn't the run of the folder runs/<proc>/<id>/ it's in, or ''. The process is checked as
     written too: cleaning cuts a name over 60 characters, and a run read under the cut name would save into another folder. */
  function misplaced(raw, run, proc, id) {
    if (raw && typeof raw === 'object' && typeof raw.process === 'string' && raw.process !== run.process) return 'names a process longer than the 60 characters Flightdeck reads, so it isn\'t read as ' + proc + '/' + id;
    if (run.process === proc && run.id === id) return '';
    return 'belongs to ' + (run.process || '(no process)') + '/' + run.id + ', not to the folder it\'s in, so it isn\'t read as ' + proc + '/' + id;
  }
  /* The same rule on a raw run.json alone (the evidence pack, which reads files as they are): why it isn't the run of
     runs/<proc>/<id>/, or ''. */
  function elsewhere(raw, proc, id) {
    /* One without an ID isn't a run at all, and is refused as one; one without its own process can't be this folder's. */
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || (raw.process === proc && raw.id === id)) return '';
    return 'belongs to ' + (typeof raw.process === 'string' && raw.process ? raw.process.slice(0, 80) : '(no process)') + '/' + raw.id.slice(0, 40) + ', not to the folder it\'s in';
  }
  /* A test run's version is its stage (2.1): staged/<process>/<stage>/, verified by the stage rules (readStage) and approved
     like a version while its record keeps its size and time. The number it proposes is the run's version. A stage not there
     yet says nothing, as a version still syncing; one that can't be a stage makes the run read-only, named. */
  /* strict (a new test run's first save): a stage not there, still syncing or not readable is a problem, never fine. */
  function stageOfRun(fs, run, cacheIn, strict) {
    if (typeof run.folder !== 'string' || !P.STAGE.test(run.folder)) return Promise.resolve(strict ? 'Its staged version isn\'t a stage folder.' : '');
    var c = cacheIn || cacheOf(fs), dir = 'staged/' + run.process + '/' + run.folder + '/', rec = dir + 'publication.json';
    var unsure = function (why) { return strict ? 'Its staged version can\'t be read now (' + why + '). Try again once the folder has synced.' : ''; };
    var mismatch = function (info) { return run.folder !== info.folder || (run.mapHash && run.mapHash !== info.mapHash) || +run.version !== info.version ? CHANGED : ''; };
    c.approved = c.approved || {}; c.bad = c.bad || {};
    if (c.bad[dir]) return Promise.resolve(c.bad[dir]);
    return fileStamp(fs, rec).then(function (stamp) {
      var ok = c.approved[dir];
      if (stamp && ok && ok.stamp === stamp && !strict) return mismatch(ok.info);
      delete c.approved[dir];
      return fs.read(rec).then(function (f) {
        if (!f) return unsure('its record isn\'t there');
        return readStage(fs, run.process, run.folder).then(function (v) {
          if (!v.ok) return v.unusable || v.newer ? (c.bad[dir] = v.why) : unsure(v.why || 'not complete yet');
          var info = { folder: v.info.folder, mapHash: v.info.mapHash, version: v.info.stage.proposed };
          if (stamp) c.approved[dir] = { stamp: stamp, info: info };
          return mismatch(info);
        });
      }).then(null, function (e) { return unsure(e && e.message || String(e)); });
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
  /* o: { readOnly: never remove anything (reading for other apps), explain: say what a plain read leaves unsaid (a folder
     without run.json gives NOFILE instead of null; a notes file that can't be read is named in bad and left out, and the
     rest of the run still loads) }. Both off for the app, which is unchanged. */
  function readRun(fs, proc, id, cacheIn, deep, allRuns, bad, o) {
    o = o || {};
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
      if (names.indexOf('run.json') < 0) return o.explain ? NOFILE : null;
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
      function noteOrSay(n) {
        if (!o.explain) return readNotes(n);
        return readNotes(n).then(null, function (e) { full = false; stamps[n] = null; if (bad) bad.push({ path: base + n, key: proc + '/' + id, kind: errKind(e), why: why(e) }); return null; });
      }
      return Promise.all([fs.read(base + 'run.json')].concat(noteFiles.map(noteOrSay))).then(withPublication).then(function (res) {
        var run = res[0] && R.sanitize(json(res[0].text));
        if (!run) { if (res[0] && bad) bad.push({ path: base + 'run.json', key: proc + '/' + id, kind: 'malformed', why: json(res[0].text) === undefined ? 'isn\'t complete JSON (it may still be arriving)' : 'isn\'t a run this copy can read' }); return null; }
        /* A run.json is a run only in its own folder, runs/<its process>/<its id>/ (2.0.1; other apps since 2.0.0). A copy of a
           run in another run folder is never read, counted, opened or joined with that folder's decisions: it's named, with
           where it belongs, and left as it is, so each run counts once. */
        var why0 = misplaced(json(res[0].text), run, proc, id);
        if (why0) {
          if (bad) bad.push({ path: base + 'run.json', key: proc + '/' + id, kind: 'malformed', why: why0 });
          return null;
        }
        stamps['run.json'] = stampOf(res[0]);
        var notesTexts = res.slice(1).map(function (f) { return f ? f.text : null; });
        /* A run started by a newer copy on a version in a publication format this copy doesn't know is read-only, even when
           its own copy of the checklist happens to read. */
        var entry = { process: proc, folder: run.folder, internKey: run.folder + '|' + run.mapHash, base: base, text: res[0].text, mtime: res[0].mtime, fileHash: fileHash(res[0].text),
          notes: notesTexts, noteFiles: noteFiles, notesSig: U.hash(noteFiles.join('/') + '\u0000' + notesTexts.map(function (t) { return t == null ? '-' : t.length + ':' + U.hash(t); }).join('/')),
          unrunnable: run._unrunnable || res.pubProblem || '', ended: !!run.ended, endedAt: run.ended ? Date.parse(run.ended.at) || 0 : 0, conflicts: extra, recheckAt: 0,
          names: names.slice().sort(), stamps: stamps, full: full };
        /* Reading for other apps: every record sanitize dropped, cut or replaced, named by where it is. */
        if (o.explain) { var raw = json(res[0].text); entry.repairs = R.repairs(raw); entry.drift = R.unexplained(raw) || []; }
        function done() { Object.freeze(entry.conflicts); Object.freeze(entry.notes); Object.freeze(entry.noteFiles); Object.freeze(entry.names); Object.freeze(entry.stamps); return Object.freeze(entry); }
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
              if (f && sameRun(f.text) === current) { if (!o.readOnly) fs.remove(base + n).catch(function () {}); return null; }
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

  /* One line of a notes file as a note, or null when it isn't one (no text or id). */
  function noteOf(n, base) { return n && typeof n === 'object' && typeof n.text === 'string' && typeof n.id === 'string' ? cleanNote(n, base) : null; }
  /* Notes come from files anyone can edit: keep only the shape the app understands, and only attachments inside this run's files/ folder.
     Its author is kept exactly: who wrote a correction decides who may withdraw or revise it. */
  function cleanNote(n, base) {
    var files = Array.isArray(n.files) ? n.files.filter(function (f) { return PF.attach.pathOk(f, base); }) : [];
    var c = { id: n.id.slice(0, 40), at: typeof n.at === 'string' ? n.at : '', by: typeof n.by === 'string' ? n.by : '', session: typeof n.session === 'string' ? n.session.slice(0, 40) : '',
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

  /* bad (reading for other apps): each file that won't read, parse or check is named there, and the rest still load.
     Without it, as the app reads: what doesn't parse or check is left out of the result, and a file that won't read fails
     the part. torn (the app): each file left out that way is named there ({ path, _file, why }), never just dropped: one
     still arriving could be the record that decides something. perFile (with torn): a read that's refused is named there
     too, by itself, instead of failing the part; only a folder that can't be listed fails it. */
  function loadJsonDir(fs, dir, ok, bad, only, torn, perFile) {
    return fs.list(dir).then(function (items) {
      return Promise.all(items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name) && (!only || only(i.name)); }).map(function (i) {
        var path = dir + '/' + i.name;
        if (!bad) return fs.read(path).then(function (f) {
          /* Listed but gone when read: it may be moving, so it's named like one still arriving, never just left out. */
          if (!f) { if (torn) torn.push({ path: path, _file: i.name, parsed: false, why: 'was listed but was gone when read' }); return null; }
          var o = json(f.text);
          if (o && typeof o === 'object' && ok(o)) { o._file = i.name; return o; }
          /* parsed: it's JSON, just not this folder's kind of file (ignored, only named); else it may still be arriving. */
          if (torn) torn.push({ path: path, _file: i.name, parsed: o !== undefined, why: o === undefined ? 'isn\'t complete JSON' : 'isn\'t a file Flightdeck reads here, so it\'s ignored' });
          return null;
        }, function (e) { if (!torn || !perFile) throw e; torn.push({ path: path, _file: i.name, parsed: false, why: 'couldn\'t be read (' + why(e) + ')' }); return null; });
        /* Reading for other apps names each of these in bad; with torn too (plans), they're also kept as the app keeps them,
           so a decision that can't be read holds its plan there as in the app. */
        return fs.read(path).then(function (f) {
          if (!f) { if (torn) torn.push({ path: path, _file: i.name, parsed: false, why: 'was listed but was gone when read' }); return null; }
          var o = json(f.text);
          if (o === undefined) { bad.push({ path: path, kind: 'malformed', why: 'isn\'t complete JSON (it may still be arriving)' }); if (torn) torn.push({ path: path, _file: i.name, parsed: false, why: 'isn\'t complete JSON' }); return null; }
          if (!o || typeof o !== 'object' || Array.isArray(o) || !ok(o)) { bad.push({ path: path, kind: 'malformed', why: 'isn\'t a file this copy can read here' }); if (torn) torn.push({ path: path, _file: i.name, parsed: true, why: 'isn\'t a file Flightdeck reads here, so it\'s ignored' }); return null; }
          o._file = i.name; return o;
        }, function (e) { bad.push({ path: path, kind: errKind(e), why: why(e) }); if (torn) torn.push({ path: path, _file: i.name, parsed: false, why: 'couldn\'t be read (' + why(e) + ')' }); return null; });
      }));
    }).then(function (x) { return x.filter(Boolean); });
  }

  /* Each part of the folder is read on its own: one that fails is named in failed (the app keeps what it read before for it).
     A folder that can't be listed, or where every part fails, is an unreadable folder. */
  var PARTS = ['people', 'drafts', 'publications', 'runs', 'legacy', 'skills', 'proposals', 'step types', 'Jira workflows', 'sign-offs', 'corrections', 'follow-ups', 'proposed changes', 'presence', 'reports', 'report decisions', 'stages'];
  /* Parts a folder may not have: they don't count toward "every part failed". */
  var OPTIONAL_PARTS = 5;
  /* The same folder, with at most 8 reads, lists and stats in flight at once however many runs and notes files it holds.
     Only those leaf calls wait for a turn, so nothing waiting holds a turn another call needs. Caches stay keyed by the
     folder itself. */
  function bounded(fs, lane) {
    if (fs._bounded) return fs;
    lane = lane || 'load';
    var raw = fs, ws = wrappers ? wrappers.get(raw) : null;
    if (ws && ws[lane]) return ws[lane];
    var go = poolOf(raw), b = Object.create(raw);
    /* Options (a read's maxBytes) travel with the call, so a cap set above the pool reaches the folder. */
    ['list', 'read', 'stat', 'blob'].forEach(function (m) { if (typeof raw[m] === 'function') b[m] = function (p, o) { return go(lane, function () { return raw[m](p, o); }); }; });
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
  function markBad(x, cache) { if (x.kind !== 'fresh') return; var bad = cache.bad && cache.bad[(isTestRun(x.run) ? 'staged/' : 'publications/') + x.run.process + '/' + x.run.folder + '/']; if (bad && !x.run._unrunnable) x.run._unrunnable = bad; }
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
    var EMPTY = [[], [], [], { reads: {}, keys: [], complete: false, unreadable: [], nofile: [] }, [], [], { plans: [], statuses: [] }, { types: {}, errors: [], skipped: 0 }, { workflows: null, errors: [] }, [], [], [], { procs: {} }, [], { files: [], folders: [], bad: [] }, [], { procs: Object.create(null) }];
    /* Reading for other apps (opts.explain): malformed proposals are named here, file by file. */
    var malformed = opts.explain ? [] : null;
    /* Sign-offs that won't parse or check, named (valUnread), never dropped: one still arriving could be the sign-off. */
    var valTorn = [];
    /* The folder itself must list: one that can't is unreadable, never empty. */
    var top = Object.create(null);
    return fs.list('').then(function (items) { (items || []).forEach(function (i) { if (i && (i.kind === 'dir' || (i.kind === 'link' && i.name === 'skill-registrations'))) top[i.name] = true; }); return Promise.all([loadPeople(fs), loadDrafts(fs), loadPublications(fs, cache, deep, !!opts.explain), loadRuns(fs, cache, deep, opts.fresh, sched, opts), loadLegacy(fs),
      /* skill-registrations/ is listed only where it is, so an ordinary folder costs nothing more. */
      loadSkills(fs, !!opts.explain, !top['skill-registrations']),
      readPlans(fs, malformed, null, opts.contract2),
      loadStepTypes(fs), loadWorkflows(fs),
      loadJsonDir(fs, 'validations', PF.skills.signoffShaped, null, null, valTorn, true),
      loadCorrectionDecisions(fs, cache, sched),
      loadFollowUpDecisions(fs, cache, sched, !!opts.explain),
      /* Proposals and presence, only where those folders are (an ordinary folder costs nothing more), and never for other
         apps' reads (flightdeck-read/1 doesn't report them). */
      !opts.readOnly && top[PF.proposals.DIR] ? loadProposed(fs, cache, deep) : Promise.resolve({ procs: {} }),
      !opts.readOnly && top[PF.proposals.PRESENCE] ? loadPresence(fs) : Promise.resolve([]),
      /* Reports: names only (contents are read for the open run), and decisions on them; only where those folders are, and
         never for flightdeck-read/1 (which doesn't report them). */
      !opts.readOnly && top[PF.reports.DIR] ? loadReportNames(fs) : Promise.resolve({ files: [], folders: [], bad: [] }),
      !opts.readOnly && top[PF.reports.DDIR] ? loadReportDecisions(fs, cache, sched) : Promise.resolve([]),
      /* Stages (2.1): only where staged/ is, so a folder that never stages lists nothing more. */
      !opts.readOnly && top.staged ? loadStaged(fs) : Promise.resolve({ procs: Object.create(null) })
    ].map(function (p, i) { return p.then(null, function (e) { failed[PARTS[i]] = e && e.message || String(e); errs.push(e); return EMPTY[i]; }); })); }).then(function (r) {
      /* The folder is unreadable when every part it always has failed (proposed changes and presence are optional). */
      if (PARTS.slice(0, -OPTIONAL_PARTS).every(function (k) { return k in failed; })) throw errs[0];
      var unreadable = r[3].unreadable.concat(r[1].unreadable || []), reads = r[3].reads, keys = r[3].keys, complete = r[3].complete;
      /* Sign-offs through their one checked reader: plain strings and numbers only, and a newer Flightdeck's refused and named. */
      var refused = (r[6].refused || []).slice();
      r[9] = r[9].map(function (v) {
        var c = PF.skills.cleanValidation(v);
        if (!c.ok && c.kind === 'newer') refused.push(PF.envelope.refusal('validations/' + v._file, 'flightdeck-validation', c));
        /* It says it's a sign-off but doesn't check: it may be anyone's, so what it names (process, version, stage) is kept. */
        else if (!c.ok) valTorn.push({ path: 'validations/' + v._file, _file: v._file, why: 'says it\'s a sign-off but isn\'t one this copy can read', process: typeof v.process === 'string' ? v.process : '', folder: typeof v.folder === 'string' ? v.folder : '', stage: v.stage && typeof v.stage === 'object' && typeof v.stage.folder === 'string' ? v.stage.folder : '' });
        return c.ok ? c.rec : null;
      }).filter(Boolean);
      var valUnread = 'sign-offs' in failed ? [] : valTorn.map(function (u) { var x = { _unread: true, path: u.path, _file: u._file, why: u.why }; if (u.parsed) x.ignored = true; if (u.process != null) { x.claimed = true; x.process = u.process; x.folder = u.folder; x.stage = u.stage; } return x; }).sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
      r[10].concat(r[11]).forEach(function (u) { if (u._unread && u.kind === 'newer') refused.push(PF.envelope.refusal(u.dir + '/' + u.process + '/' + u._file, u.dir === 'followups' ? 'flightdeck-followup-decision' : u.dir === 'suggestions' ? 'flightdeck-fix-decision' : 'flightdeck-correction-decision', u)); });
      r[5].forEach(function (c) { if (c.newer) refused.push(PF.envelope.refusal(/^skill-registrations\//.test(c.file || '') ? c.file : 'skills/' + c.file, 'flightdeck-skill', { kind: 'newer', why: c.errors[0], needs: c.needs })); });
      (r[7].refused || []).forEach(function (x) { refused.push(x); });
      Object.keys(r[16].procs).forEach(function (k) { r[16].procs[k].refused.forEach(function (x) { refused.push(x); }); });
      r[15].forEach(function (u) { if (u._unread && u.kind === 'newer') refused.push(PF.envelope.refusal(u.dir + '/' + u.process + '/' + u._file, 'flightdeck-report-decision', u)); });
      /* skills/ or skill-registrations/ that couldn't be listed holds every name (PF.skills.held) and is still named as the part
         that failed, so a name neither listing showed is never read as having no registration. */
      if (r[5] && (r[5].unlisted || r[5].regsUnlisted) && !('skills' in failed)) failed.skills = r[5].unlisted || r[5].regsUnlisted;
      /* unnamed (2.1.1): a torn file whose name isn't a plan's or request's shape (PF.plans.namesPlan) and starts with no
         readable plan's ID could be a renamed decision on any plan. It holds none, and Folder health names it on its own. */
      var planIds = (r[6].plans || []).map(function (p) { return p.id; });
      var named = function (n) { return PF.plans.namesPlan(String(n)) || planIds.some(function (id) { if (typeof id !== 'string' || !id || String(n).indexOf(id) !== 0) return false; var c = String(n).charAt(id.length); return c === '.' || c === ' ' || c === '-' || c === '('; }); };
      var planUnread = 'proposals' in failed ? [] : (r[6].torn || []).map(function (u) { var x = { _unread: true, path: u.path, _file: u._file, why: u.why, kind: u.parsed ? 'ignored' : 'unreadable' }; if (!u.parsed && !named(u._file)) x.unnamed = true; return x; });
      /* A file refused here (a newer Flightdeck's, not in its format, or a format that can't be read at all) holds its plan as
         one still arriving does, by its name alone (groupPlans: <plan>.status-…), whatever it says it is. A refused plan file
         isn't named so, and holds no plan. */
      var planHolds = planUnread.filter(function (u) { return u.kind === 'unreadable'; }).concat((r[6].refused || []).map(function (x) { return { path: x.path, _file: x.path.slice('proposals/'.length), kind: x.kind, needs: x.needs || '' }; }));
      var plans = groupPlans(r[6].plans, r[6].statuses, planHolds);
      /* A stage that can't be one (2.1) makes its test runs read-only, as an unusable version does its runs; one read again
         and verified clears that. A stage still arriving says nothing. */
      cache.bad = cache.bad || {};
      Object.keys(r[16].procs).forEach(function (k) { r[16].procs[k].stages.forEach(function (st) { var dir = 'staged/' + k + '/' + st.folder + '/'; if (st.ok) delete cache.bad[dir]; else if (st.unusable || st.newer) cache.bad[dir] = st.why; }); });
      /* Runs and versions are read side by side, so a run read before its version was judged unusable is marked here. */
      keys.forEach(function (k) {
        var x = reads[k]; if (!x) return;
        markBad(x, cache);
        if (x.kind === 'cached') { var e = x.entry; x.sig = sigOf(e.fileHash, e.notesSig, e.conflicts, e.unrunnable || badFor(cache, e), e.recheckAt); delete x.entry; }
      });
      var out = { people: r[0], drafts: r[1], processes: r[2], reads: reads, runsComplete: complete, legacy: r[4], skills: r[5], validations: r[9], valUnread: valUnread, corrDecisions: r[10].filter(function (d) { return !d._unread; }), corrUnread: r[10].filter(function (d) { return d._unread; }),
        fuDecisions: r[11].filter(function (d) { return !d._unread; }), fuUnread: r[11].filter(function (d) { return d._unread; }), plans: plans, stepTypes: r[7], jira: r[8],
        unreadable: unreadable, failed: failed, planUnread: planUnread, skillsSkipped: r[5].skipped || 0, readAt: new Date().toISOString(), proposed: r[12], presence: r[13],
        reports: r[14], repDecisions: r[15].filter(function (d) { return !d._unread; }), repUnread: r[15].filter(function (d) { return d._unread; }), stages: r[16],
        /* Files from a newer Flightdeck this copy refused, by path, with the version each needs: shown by Folder health and
           wherever the record would have appeared, never filtered into "nothing there" (docs/design.md section 28). */
        refused: refused.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; }) };
      if (opts.explain) { out.malformed = malformed; out.nofile = r[3].nofile || []; }
      var stagesDone = opts.readOnly ? Promise.resolve() : attachStages(fs, out, cache);
      /* Every run, as objects: fresh ones as read, cached ones built new. Built on first use, since the app applies reads instead. */
      var runs = null;
      Object.defineProperty(out, 'runs', { enumerable: true, configurable: true,
        get: function () { if (!runs) runs = keys.map(function (k) { var x = reads[k]; return !x ? null : x.kind === 'fresh' ? x.run : x.kind === 'cached' ? x.build() : null; }).filter(Boolean); return runs; },
        set: function (v) { runs = v; } });
      return stagesDone.then(function () { return out; });
    });
  }
  /* One run, for other apps (flightdeck run and next): read-only (nothing is removed, not even a save receipt that lost
     nothing), through a view that throws on any change, and only that run's folder, its version's record (pubProblem), its
     follow-up decisions and people.json. Resolves to { found: false } when the folder has no such run folder, else
     { found, run (or null), nofile, bad: [{path, kind, why}], fuDecisions, fuUnread: [{path, why}], people, peopleWhy }. */
  function readRunOnly(fsIn, proc, id) {
    var fs = readOnlyView(fsIn, 'Reading for other apps'), cache = newCache(), bad = [], key = proc + '/' + id, F = PF.followups;
    return fs.list('runs/' + proc).then(function (items) {
      if (!items.some(function (i) { return i.kind === 'dir' && i.name === id; })) return { found: false };
      var out = { found: true, run: null, nofile: false, bad: bad, fuDecisions: [], fuUnread: [], people: [], peopleWhy: '' };
      /* The run's version is checked below (readVersion) and judged by the caller, as runs judges it, not by pubProblem. */
      var runP = readRun(fs, proc, id, cache, true, true, bad, { readOnly: true, explain: true }).then(function (entry) {
        if (entry === NOFILE) out.nofile = true; else if (entry) out.run = build(entry, null);
      }, function (e) { bad.push({ path: 'runs/' + key + '/run.json', key: key, kind: errKind(e), why: why(e) }); });
      /* The process's decisions folder is found through its parent's listing, so one gone between the two is named (vanished)
         by a ledger, never read as "no decisions". */
      var fuP = fs.list('followups').then(function (top) {
        return top.some(function (i) { return i.kind === 'dir' && i.name === proc; }) ? fs.list('followups/' + proc) : [];
      }).then(function (list) {
        var mine = list.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name) && i.name.indexOf(id + '.') === 0; });
        return Promise.all(mine.map(function (i) {
          var path = 'followups/' + proc + '/' + i.name;
          return fs.read(path).then(function (f) {
            if (!f) return;
            var raw = json(f.text), d = null; try { d = F.cleanDecision(raw, proc, i.name); } catch (e) { d = null; }
            if (d) { var dr = fuDrift(raw, d); if (dr.length) d._drift = dr; }
            var v = !d && raw !== undefined ? F.verdict(raw) : null;
            if (d && d.run === id) out.fuDecisions.push(d); else if (!d) out.fuUnread.push(v && !v.ok && v.kind === 'newer' ? { path: path, kind: 'newer', why: 'This decision was made with a newer Flightdeck. ' + PF.envelope.needsText(v.needs) } : { path: path, why: 'isn\'t a follow-up decision this copy can read' });
          }, function (e) { out.fuUnread.push({ path: path, kind: errKind(e), why: why(e) }); });
        }));
      }, function (e) { out.fuUnread.push({ path: 'followups/' + proc + '/', kind: errKind(e), why: why(e) }); });
      var peopleP = loadPeople(fs).then(function (p) { out.people = p; }, function (e) { out.peopleWhy = why(e); out.peopleKind = errKind(e); });
      return Promise.all([runP, fuP, peopleP]).then(function () {
        /* The run's version, verified here so a failure is named, not taken as "nothing to say" (pubProblem's answer). */
        var r = out.run;
        /* A test run's version is its stage (2.1), read by the stage rules. */
        if (r && isTestRun(r) && typeof r.folder === 'string' && P.STAGE.test(r.folder) && /^[a-z0-9][a-z0-9-]{0,59}$/.test(r.process)) return readStage(fs, r.process, r.folder).then(function (res) { out.pub = res; }, function (e) { out.pub = { ok: false, why: why(e), folder: r.folder, process: r.process, _readFailed: true }; }).then(function () { return out; });
        if (!r || typeof r.folder !== 'string' || !P.versionOf(r.folder) || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(r.process)) return out;
        return readVersion(fs, r.process, r.folder).then(function (res) { out.pub = res; }, function (e) { out.pub = { ok: false, why: why(e), folder: r.folder, process: r.process, _readFailed: true }; }).then(function () { return out; });
      });
    });
  }
  /* Decision files are written once and tiny. Each refresh lists their folders; a file is read when it's new, couldn't be
     read or understood last time, on Refresh, or once it's past the hour (a share each refresh, as runs are), and otherwise
     taken from the text kept from its last read. A file that's gone from the listing is forgotten, but only from a folder
     listed this time, so a listing that covers some folders (a schedule's share) never forgets the others' texts.
     scope: { folders: every <top>/<process> folder listed this time, tops: { <top>: the process folders its listing
     holds } }: a text is forgotten when its folder was listed without it, or when its process folder is gone from a top
     listed this time. Texts are kept by path in cache.dec. */
  function decisionTexts(fs, cache, sched, scope, items, kind) {
    var dec = cache.dec = cache.dec || {}, listed = {}, folders = {}, tops = scope.tops || {};
    items.forEach(function (x) { listed[x.path] = true; });
    (scope.folders || []).forEach(function (f) { folders[f] = true; });
    Object.keys(dec).forEach(function (p) {
      var parts = p.split('/'), folder = parts.slice(0, -1).join('/');
      if (listed[p]) return;
      if (folders[folder] || (tops[parts[0]] && tops[parts[0]].indexOf(parts[1]) < 0)) delete dec[p];
    });
    var known = sched && !sched.deep ? items.filter(function (x) { return dec[x.path]; }).map(function (x) { return x.path; }) : [];
    var due = {}; (sched ? sched.due(kind, known, function (p) { return dec[p].at; }, config.endedMs) : []).forEach(function (p) { due[p] = true; });
    return limited(items, 8, function (x) {
      var hit = dec[x.path];
      if (sched && !sched.deep && hit && !due[x.path]) return { x: x, f: { text: hit.text } };
      return fs.read(x.path).then(function (f) {
        /* Listed but gone when read: it may be moving, so it's unread like one that won't read, never "no decision". */
        if (!f) { delete dec[x.path]; return { x: x, failed: true }; }
        if (sched) dec[x.path] = { text: f.text, at: sched.now }; else delete dec[x.path];
        return { x: x, f: f };
      }, function () { delete dec[x.path]; return { x: x, failed: true }; });
    });
  }
  /* An unread decision with the reason: a newer Flightdeck's (the envelope refused it, and says which version it needs), or
     one this copy can't read. A refusal is never filtered into "nothing there". */
  function refusedAs(unread, v) {
    if (v && !v.ok && v.kind === 'newer') { unread.kind = 'newer'; unread.why = 'This decision was made with a newer Flightdeck. ' + PF.envelope.needsText(v.needs); unread.needs = v.needs || ''; }
    else { unread.kind = 'malformed'; unread.why = 'This file couldn\'t be read, or isn\'t a decision this copy can read.'; }
    return unread;
  }
  /* What couldn't be read or understood is never kept, so it's read again next time: only a real read clears a failure. */
  function forgetText(cache, path) { if (cache && cache.dec) delete cache.dec[path]; }
  /* Decisions on corrections: corrections/<process>/<group>.<writer>.<rev>.json, each written once. Decisions on suggested
     fixes from before 1.13 (suggestions/<process>/<suggestion>.<writer>.json) are read too. A file that can't be read is
     reported in corrUnread, never dropped, so its group doesn't quietly look open again. */
  function loadCorrectionDecisions(fs, cache, sched) {
    var dirs = ['corrections', 'suggestions'], scope = { folders: [], tops: {} };
    return Promise.all(dirs.map(function (dir) {
      return fs.list(dir).then(function (procs) {
        var ok = procs.filter(function (p) { return p.kind === 'dir' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(p.name); });
        scope.tops[dir] = ok.map(function (p) { return p.name; });
        return Promise.all(ok.map(function (p) {
          return fs.list(dir + '/' + p.name).then(function (items) { scope.folders.push(dir + '/' + p.name); return items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return { dir: dir, process: p.name, name: i.name, path: dir + '/' + p.name + '/' + i.name }; }); });
        }));
      });
    })).then(function (nested) {
      var all = [].concat.apply([], [].concat.apply([], nested));
      return decisionTexts(fs, cache || {}, sched, scope, all, 'corr').then(function (got) {
        return got.map(function (g) {
          var x = g.x, unread = { _unread: true, dir: x.dir, process: x.process, _file: x.name };
          /* A file that's missing now was removed; one that won't read, parse or check (a half-synced write) is unread. */
          if (g.failed) return unread;
          if (!g.f) return null;
          var raw = json(g.f.text), d = PF.corrections.cleanDecision(raw, x.process);
          if (!d || (x.dir === 'suggestions') !== (d.kind === 'fix-decision')) { forgetText(cache, x.path); return refusedAs(unread, raw === undefined ? null : PF.corrections.verdict(raw)); }
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
  /* Reading for other apps: where a follow-up decision file says something cleanDecision doesn't keep as written. */
  var FU_ALLOW = { added: ['fv'], dropped: [] };
  function fuDrift(raw, d) { var c = {}; Object.keys(d).forEach(function (k) { if (k[0] !== '_') c[k] = d[k]; }); return U.drift(raw, JSON.parse(JSON.stringify(c)), FU_ALLOW); }
  function loadFollowUpDecisions(fs, cache, sched, explain) {
    var scope = { folders: [], tops: {} };
    return fs.list('followups').then(function (procs) {
      var ok = procs.filter(function (p) { return p.kind === 'dir' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(p.name); });
      scope.tops.followups = ok.map(function (p) { return p.name; });
      return Promise.all(ok.map(function (p) {
        return fs.list('followups/' + p.name).then(function (items) { scope.folders.push('followups/' + p.name); return items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return { process: p.name, name: i.name, path: 'followups/' + p.name + '/' + i.name }; }); });
      }));
    }).then(function (nested) {
      return decisionTexts(fs, cache || {}, sched, scope, [].concat.apply([], nested), 'fu').then(function (got) {
        return got.map(function (g) {
          var x = g.x, unread = { _unread: true, dir: 'followups', process: x.process, _file: x.name };
          /* Each file on its own: one that won't read, parse or check is listed as unreadable, never a reason to drop the rest. */
          if (g.failed) return unread;
          if (!g.f) return null;
          var raw = json(g.f.text), d = null; try { d = PF.followups.cleanDecision(raw, x.process, x.name); } catch (e) { d = null; }
          if (!d) { forgetText(cache, x.path); return refusedAs(unread, raw === undefined ? null : PF.followups.verdict(raw)); }
          if (explain) { var dr = fuDrift(raw, d); if (dr.length) d._drift = dr; }
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
  /* ---------- Reports from other apps (docs/design.md section 26) ---------- */
  var PROC_DIR = /^[a-z0-9][a-z0-9-]{0,59}$/;
  /* A file's exact bytes, at most max: { bytes } or null (gone). A file over max is refused from its size before any of it is
     read, and again from what was read (a file that grew). */
  function readBytes(fs, path, max) {
    return fs.blob(path, { maxBytes: max }).then(function (b) {
      if (!b) return null;
      if (typeof b.size === 'number' && b.size > max) { var e = new Error(path + ' is over the ' + Math.round(max / 1024) + ' KB a report can be'); e.skipped = true; throw e; }
      return b.arrayBuffer().then(function (buf) {
        var u8 = new Uint8Array(buf);
        if (u8.length > max) { var e2 = new Error(path + ' is over the ' + Math.round(max / 1024) + ' KB a report can be'); e2.skipped = true; throw e2; }
        return { bytes: u8 };
      });
    });
  }
  /* One report file as Flightdeck reads it: { name, path, sha256, report (or null), why, kind }. A file that can't be read is
     named (unreadable or too big), never taken as absent; one gone between listing and reading is null. */
  function readReport(fs, proc, name) {
    var X = PF.reports, path = X.DIR + '/' + proc + '/' + name;
    return readBytes(fs, path, X.LIMITS.bytes).then(function (got) {
      if (!got) return null;
      var snap = X.snapshot(got.bytes), out = { name: name, path: path, sha256: snap.sha256, report: null, why: '', kind: '' };
      if (snap.text === null) { out.why = snap.why; out.kind = 'malformed'; return out; }
      var c = X.clean(snap.text, proc, name);
      if (c.ok) out.report = c.report; else { out.why = c.why; out.kind = c.kind; out.needs = c.needs || ''; out.errors = c.errors; }
      return out;
    }, function (e) { return { name: name, path: path, sha256: '', report: null, why: why(e), kind: errKind(e) }; });
  }
  /* The names in reports/: { files: [{ process, name, path }], folders: the process folders listed, bad: [{ path, why }] }.
     Contents are read only for the run that's open (loadRunReports), so a folder with thousands of reports costs one list per
     process here. */
  function loadReportNames(fs) {
    var X = PF.reports, out = { files: [], folders: [], bad: [] };
    return fs.list(X.DIR).then(function (procs) {
      return Promise.all(procs.filter(function (p) { return p.kind === 'dir' && PROC_DIR.test(p.name); }).map(function (p) {
        return fs.list(X.DIR + '/' + p.name).then(function (items) {
          out.folders.push(p.name);
          items.forEach(function (i) {
            if (i.kind !== 'file' || !/\.json$/i.test(i.name)) return;
            var nm = X.parseName(i.name), path = X.DIR + '/' + p.name + '/' + i.name;
            if (!nm) { out.bad.push({ path: path, why: 'isn\'t named <run>.<step>.<tool>.<id>.json' }); return; }
            if (out.files.length < X.LIMITS.reports) out.files.push({ process: p.name, name: i.name, path: path, run: nm.run, step: nm.step, producer: nm.producer, id: nm.id });
          });
        }, function (e) { out.bad.push({ path: X.DIR + '/' + p.name + '/', why: why(e), kind: errKind(e) }); });
      }));
    }).then(function () { out.files.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; }); return out; });
  }
  /* The reports of one run, read and grouped: { list (PF.reports.group's, in order), badNames, failed: why the folder couldn't
     be listed, or '' }. */
  function loadRunReports(fs, proc, run) {
    var X = PF.reports;
    if (!PROC_DIR.test(proc) || !/^[a-z0-9-]{1,40}$/.test(run)) return Promise.resolve({ list: [], badNames: [], failed: '' });
    fs = bounded(fs, 'open');
    return fs.list(X.DIR + '/' + proc).then(function (items) {
      var mine = items.filter(function (i) { if (i.kind !== 'file') return false; var nm = X.parseName(i.name); return !!nm && nm.run === run; });
      return limited(mine, 8, function (i) { return readReport(fs, proc, i.name); }).then(function (entries) {
        var g = X.group(proc, entries.filter(Boolean));
        return { list: g.list, badNames: g.badNames, failed: '' };
      });
    }, function (e) { return { list: [], badNames: [], failed: why(e), kind: errKind(e) }; });
  }
  /* Decisions on reports: report-decisions/<process>/<run>.<hash>.<window>.<rev>.json, read like follow-up decisions
     (decisionTexts). A file that can't be read is named in the list as unread, never dropped. */
  function loadReportDecisions(fs, cache, sched) {
    var X = PF.reports, scope = { folders: [], tops: {} };
    return fs.list(X.DDIR).then(function (procs) {
      var ok = procs.filter(function (p) { return p.kind === 'dir' && PROC_DIR.test(p.name); });
      scope.tops[X.DDIR] = ok.map(function (p) { return p.name; });
      return Promise.all(ok.map(function (p) {
        return fs.list(X.DDIR + '/' + p.name).then(function (items) { scope.folders.push(X.DDIR + '/' + p.name); return items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return { process: p.name, name: i.name, path: X.DDIR + '/' + p.name + '/' + i.name }; }); });
      }));
    }).then(function (nested) {
      return decisionTexts(fs, cache || {}, sched, scope, [].concat.apply([], nested), 'rep').then(function (got) {
        return got.map(function (g) {
          var x = g.x, unread = { _unread: true, dir: X.DDIR, process: x.process, _file: x.name };
          if (g.failed) { unread.kind = 'unreadable'; unread.why = 'couldn\'t be read'; return unread; }
          if (!g.f) return null;
          var raw = json(g.f.text), c = raw === undefined ? { ok: false, kind: 'malformed', why: 'isn\'t complete JSON' } : X.cleanDecision(raw, x.process, x.name);
          if (!c.ok) { forgetText(cache, x.path); unread.kind = c.kind; unread.why = c.kind === 'newer' ? 'This decision was made with a newer Flightdeck. ' + PF.envelope.needsText(c.needs) : 'This file couldn\'t be read, or isn\'t a decision on a report this copy can read.'; unread.needs = c.needs || ''; return unread; }
          return c.d;
        });
      });
    }).then(function (list) { return list.filter(Boolean); });
  }
  /* A decision on a report, written once, as decideFollowUp writes one: claimed in this window, the name must be absent,
     and it must read back exactly. A file of that name already holding exactly these bytes is the same decision (a retry
     after a save whose answer was lost), so it succeeds. */
  function decideReport(fs, rec, writer) {
    var X = PF.reports;
    if (!rec || rec.format !== X.DFORMAT || typeof writer !== 'string' || !/^[\w-]{1,40}$/.test(writer)) return Promise.reject(new Error('That report can\'t be decided here.'));
    var clean = X.cleanDecision(JSON.parse(JSON.stringify(rec)), rec.process, X.decisionName(rec, writer));
    if (!clean.ok) return Promise.reject(new Error('That report can\'t be decided here.'));
    var name = X.decisionName(rec, writer), path = X.DDIR + '/' + rec.process + '/' + name, text = JSON.stringify(rec, null, 2) + '\n';
    if (U.utf8Bytes(text) > X.LIMITS.decisionBytes) return Promise.reject(new Error('That decision is too big to record.'));
    var claims = fs._repClaims || (fs._repClaims = {});
    if (claims[path]) return Promise.reject(new Error('A decision with that name is already being saved. Look again, then decide.'));
    claims[path] = true;
    function release(v) { delete claims[path]; return v; }
    return fs.read(path, { maxBytes: X.LIMITS.decisionBytes }).then(function (f) {
      if (f && f.text === text) return 'same';
      if (f) throw new Error('A decision with that name is already in the folder. Look again, then decide.');
      return fs.write(path, text);
    }).then(function () { return fs.read(path, { maxBytes: X.LIMITS.decisionBytes }); }).then(function (f) {
      var back = f ? X.cleanDecision(json(f.text), rec.process, name) : null;
      if (!back || !back.ok || f.text !== text) throw new Error('The decision didn\'t read back from the team folder as it was written. Look again, then decide.');
      return path;
    }).then(release, function (e) { release(); throw e; });
  }
  /* The decisions on one report as the folder has them now, for writing the next one: { decisions, unread }. A listing that
     fails rejects (never "no decisions"); a file that can't be read is named in unread, which holds the report. */
  function loadDecisionsOn(fs, g) {
    var X = PF.reports, h = X.decisionHash(g), dir = X.DDIR + '/' + g.process, out = { decisions: [], unread: [] };
    if (!PROC_DIR.test(g.process)) return Promise.reject(new Error('That report can\'t be decided here.'));
    fs = bounded(fs, 'open');
    return fs.list(X.DDIR).then(function (top) {
      if (!(top || []).some(function (i) { return i.kind === 'dir' && i.name === g.process; })) return [];
      return fs.list(dir);
    }).then(function (items) {
      var mine = (items || []).filter(function (i) { var nm = i.kind === 'file' && X.parseDecisionName(i.name); return !!nm && nm.run === g.run && nm.hash === h; });
      return Promise.all(mine.map(function (i) {
        return fs.read(dir + '/' + i.name, { maxBytes: X.LIMITS.decisionBytes }).then(function (f) {
          var raw = f ? json(f.text) : undefined, c = raw === undefined ? null : X.cleanDecision(raw, g.process, i.name);
          if (c && c.ok) out.decisions.push(c.d); else out.unread.push(i.name);
        }, function () { out.unread.push(i.name); });
      }));
    }).then(function () { return out; });
  }
  /* A report as it is on disk now, for accepting: the entry readReport gives, or null when it's gone. */
  function rereadReport(fs, proc, name) {
    if (!PROC_DIR.test(proc) || !PF.reports.parseName(name)) return Promise.resolve(null);
    return readReport(bounded(fs, 'open'), proc, name);
  }
  /* Team step types: step-types/<id>.json. Each file is checked; good ones are usable, bad ones are listed with their problems. */
  function loadStepTypes(fs) {
    var skipped = 0;
    return fs.list('step-types').then(function (items) {
      var files = items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      skipped = Math.max(0, files.length - MAX_TYPES);
      return Promise.all(files.slice(0, MAX_TYPES).map(function (i) {
        /* Each file on its own: one that can't be checked (whatever it holds) is listed with why, and the rest still load. */
        return fs.read('step-types/' + i.name).then(function (f) { var o = f && json(f.text), errs; try { errs = o === undefined ? ['isn\'t valid JSON'] : PF.types.checkCustom(o); } catch (e) { errs = ['couldn\'t be read as a step type']; } return { file: i.name, def: o, errors: errs }; }, function (e) { return { file: i.name, def: null, errors: [why(e)] }; });
      }));
    }).then(function (list) {
      var types = {}, errors = [], refused = [];
      list.forEach(function (x) {
        if (x.def && typeof x.def === 'object' && (x.def.format != null || x.def.features != null)) { var env = PF.envelope.judge('flightdeck-step-type', x.def); if (!env.ok && env.kind === 'newer') refused.push(PF.envelope.refusal('step-types/' + x.file, 'flightdeck-step-type', { kind: 'newer', why: x.errors[0], needs: env.needs })); }
        if (!x.errors.length && x.file !== x.def.id + '.json') x.errors.push('the file name must be ' + x.def.id + '.json');
        if (!x.errors.length && types[x.def.id]) x.errors.push('another file already defines ' + x.def.id);
        if (!x.errors.length) { try { types[x.def.id] = PF.types.customType(x.def); } catch (e) { x.errors.push('couldn\'t be read as a step type'); } }
        if (x.errors.length) errors.push({ file: x.file, errors: x.errors });
      });
      return { types: types, errors: errors, skipped: skipped, refused: refused };
    });
  }
  /* Past these, the first files by name are read and the rest are counted (Folder health reports them), never silently cut. */
  var MAX_TYPES = 100, MAX_SKILLS = 500;
  /* Skill registrations, one file at a time: a file that can't be read, isn't JSON or isn't an object is listed with why. */
  /* Legacy registrations (skills/) and, for this copy's own reading, the exact 2.0 ones (skill-registrations/<name>/, each with
     the SHA-256 of its bytes), merged into one entry per skill (PF.skills.merge). Reading for other apps with contract 1 keeps
     1.18's scope: registrations aren't discovered (legacy only). */
  function loadSkills(fs, legacyOnly, noRegs) {
    /* For this copy's own reading, a skills/ that can't be listed is unreadable for every name (PF.skills.held), never empty.
       Reading for other apps (contract 1) keeps 1.18's failure. */
    var legacy = legacyOnly ? loadLegacySkills(fs) : loadLegacySkills(fs).then(null, function (e) { var l = []; l.skipped = 0; l.unlisted = 'skills/ ' + listWhy(e) + '.'; return l; });
    return Promise.all([legacy, legacyOnly || noRegs ? Promise.resolve([]) : loadRegistrations(fs)]).then(function (r) {
      if (legacyOnly) return r[0];
      var out = PF.skills.merge(r[0], r[1]); out.skipped = r[0].skipped + (r[1].skipped || 0);
      if (r[0].unlisted) out.unlisted = r[0].unlisted;
      if (r[1].unlisted) out.regsUnlisted = r[1].unlisted;
      return out;
    });
  }
  function listWhy(e) { return 'couldn\'t be listed (' + (e && (e.code || e.message) || String(e)) + ')'; }
  /* Every revision in skill-registrations/ (the first MAX_SKILLS by path). What can't be listed is never left out: the folder
     itself (list.unlisted), a name's folder, a link (Flightdeck doesn't follow them) or a name whose files are past the limit is
     an entry { unlisted: true } for that name, which holds it (PF.skills.resolve). opts.name: only that name's folder (reading
     back what flightdeck skill register wrote). */
  function loadRegistrations(fs, opts) {
    var skipped = 0, marks = [], whole = null, only = opts && opts.name;
    var mark = function (name, why) { marks.push({ skill: null, errors: [why], file: 'skill-registrations/' + name + '/', unlisted: true }); };
    var list = function (p) { return Promise.resolve().then(function () { return fs.list(p); }); };
    return list('skill-registrations').then(function (names) {
      var all = (names || []).filter(function (i) { return !only || i.name === only; });
      all.filter(function (i) { return i.kind === 'link'; }).forEach(function (i) { mark(i.name, 'skill-registrations/' + i.name + ' is a link, which Flightdeck doesn\'t follow.'); });
      var dirs = all.filter(function (i) { return i.kind === 'dir'; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      return Promise.all(dirs.map(function (d) {
        return list('skill-registrations/' + d.name).then(function (items) {
          var json = (items || []).filter(function (i) { return /\.json$/i.test(i.name); });
          json.filter(function (i) { return i.kind === 'link'; }).forEach(function (i) { mark(d.name, 'skill-registrations/' + d.name + '/' + i.name + ' is a link, which Flightdeck doesn\'t follow.'); });
          return json.filter(function (i) { return i.kind === 'file'; }).map(function (i) { return 'skill-registrations/' + d.name + '/' + i.name; });
        }, function (e) { mark(d.name, 'skill-registrations/' + d.name + '/ ' + listWhy(e) + '.'); return []; });
      }));
    }, function (e) { whole = 'skill-registrations/ ' + listWhy(e) + '.'; return []; }).then(function (lists) {
      var paths = [].concat.apply([], lists).sort();
      skipped = Math.max(0, paths.length - MAX_SKILLS);
      var cut = Object.create(null);
      paths.slice(MAX_SKILLS).forEach(function (p) { var n = p.split('/')[1]; if (!cut[n]) { cut[n] = true; mark(n, 'skill-registrations/' + n + '/ has files past the ' + MAX_SKILLS + ' registrations a copy reads.'); } });
      return Promise.all(paths.slice(0, MAX_SKILLS).map(function (path) {
        var bad = function (why) { return { skill: null, errors: [path + ': ' + why], file: path }; };
        return Promise.all([fs.read(path), fs.blob(path).then(function (b) { return b ? bytesOf(b) : null; }, function () { return null; })]).then(function (got) {
          var f = got[0];
          if (!f || !got[1]) return bad('couldn\'t be read');
          var o = json(f.text);
          if (o === undefined) return bad('isn\'t valid JSON');
          try { return PF.skills.checkV2(o, path, PF.sha256.hex(got[1])); } catch (e) { return bad('couldn\'t be read as a skill registration'); }
        }, function () { return bad('couldn\'t be read'); });
      }));
    }).then(function (list) { list = list.concat(marks); list.skipped = skipped; if (whole) list.unlisted = whole; return list; });
  }
  function loadLegacySkills(fs) {
    var skipped = 0, dropped = [];
    return Promise.resolve().then(function () { return fs.list('skills'); }).then(function (items) {
      var files = items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      skipped = Math.max(0, files.length - MAX_SKILLS); dropped = files.slice(MAX_SKILLS).map(function (i) { return i.name; });
      return Promise.all(files.slice(0, MAX_SKILLS).map(function (i) {
        var bad = function (why) { return { skill: null, errors: ['skills/' + i.name + ': ' + why], file: i.name }; };
        return fs.read('skills/' + i.name).then(function (f) {
          if (!f) return Object.assign(bad('couldn\'t be read'), { unreadable: true });
          var o = json(f.text);
          if (o === undefined) return bad('isn\'t valid JSON');
          if (!o || typeof o !== 'object' || Array.isArray(o)) return bad('must be a JSON object');
          try { var c = PF.skills.check(o, i.name); c.file = i.name; return c; } catch (e) { return bad('couldn\'t be read as a skill registration'); }
        }, function () { return Object.assign(bad('couldn\'t be read'), { unreadable: true }); });
      }));
    }).then(function (list) { list.skipped = skipped; if (dropped.length) list.dropped = dropped; return list; });
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
  function stripMeta(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k[0] !== '_') c[k] = o[k]; }); return R.testLast ? R.testLast(c) : c; }

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
    /* opts.keep (a planned run's first save, 2.1.1): the exact text is made before anything can refuse it, and a failure hands
       it back as e.pending { path, text, certain, cand }: certain when nothing was written yet, else the write may have
       landed; cand the save receipt that may be left. Only that window writes those bytes again (resumeStart). */
    var made = opts.keep ? make() : null, wrote = false;
    var kept = function (e) { if (e && typeof e === 'object') e.pending = { path: path, text: made.text, certain: !wrote, cand: wrote ? made.cand : null }; throw e; };
    if (run._unrunnable) return made ? Promise.reject(readOnly(run._unrunnable)).then(null, kept) : Promise.reject(readOnly(run._unrunnable));
    /* The check and the write happen together: with opts.lock (the browser's Web Locks), windows on this computer save a run one
       at a time, so a second window always sees the first one's save and keeps its own change as a conflict copy. */
    var go = opts.lock ? opts.lock('preflight:run:' + run.process + '/' + run.id, function () { return checkAndWrite(); }) : checkAndWrite();
    return made ? go.then(null, kept) : go;
    function make() {
      var copy = stripMeta(run); copy.rev = (run.rev || 0) + 1; copy.savedAt = new Date().toISOString(); copy.savedBy = session;
      /* Every save is first written to its own uniquely named candidate file, and run.json lists the saves it includes.
         Where windows can't take turns (two browsers, two computers, no Web Locks), a save that another save replaced is
         therefore never lost: its candidate isn't in the list, so loadRun shows it as a conflict copy to compare and keep. */
      var saveId = U.randomId(8), tag = writer + '.' + saveId, dir = 'runs/' + run.process + '/' + run.id + '/';
      copy.lineage = (run.lineage || []).concat([tag]).slice(-LINEAGE_MAX);
      /* A test run's frozen fields stay last (test/fixtures/v2 run-t). */
      if (copy.test === true) { var tst = copy.stage; delete copy.test; delete copy.stage; copy.test = true; copy.stage = tst; }
      return { copy: copy, dir: dir, text: JSON.stringify(copy, null, 2), cand: dir + 'candidate-' + writer + '-' + saveId + '.json' };
    }
    /* The publication record may have arrived (by sync) after the run was loaded; a newer format makes the run read-only. */
    function checkAndWrite() {
    return pubProblem(fs, run, null, opts.strict).then(function (why) {
      if (why) { run._unrunnable = why; throw readOnly(why); }
      return fs.read(path);
    }).then(function (f) {
      var e;
      /* opts.still: asked after every read, right before the first write; false writes nothing (e.dropped). */
      if (typeof opts.still === 'function' && !opts.still()) { e = new Error('dropped'); e.dropped = true; throw e; }
      if (f) {
        var disk = R.sanitize(json(f.text));
        if (!disk) { e = new Error('The run file is unreadable, so it wasn\'t overwritten.'); e.unreadable = true; throw e; }
        if (disk._unrunnable) throw readOnly(disk._unrunnable);
        /* SHA-256 of the exact text this window read or wrote (fileHash): an older copy's 8-character FNV never matches, so
           a run kept in this browser from before 2.1 keeps its change as a conflict copy rather than risk writing over one. */
        var changed = fileHash(f.text) !== run._fileHash;
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
      var m = made || make(), copy = m.copy, dir = m.dir, text = m.text, cand = m.cand;
      wrote = true;
      return fs.write(cand, text)
        .then(function () { return archiveOverflow(fs, run, writer); })
        .then(function () { return fs.write(path, text); })
        .then(function () {
          forgetRun(fs, run);
          run.rev = copy.rev; run.savedAt = copy.savedAt; run._fileHash = fileHash(text); run.lineage = copy.lineage;
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
    var names = [];
    return fs.list(dir).then(function (items) {
      var hist = items.filter(function (i) { return /^history-[\w-]+\.jsonl$/.test(i.name); });
      names = hist.map(function (i) { return i.name; });
      return Promise.all(hist.map(function (i) { return fs.read(dir + '/' + i.name); }));
    }).then(function (files) {
      var out = [], refused = [], malformed = [];
      var seen = {};
      /* Each line through R.cleanArchive: log and answer records as always, a 2.0 migration record kept (never shown here), and
         anything else (a newer av, a kind this copy doesn't know) refused and counted with its reason, never read for meaning.
         An entry whose time is missing or can't be read is kept (it shows "time unknown"), never dropped; it sorts first. */
      files.forEach(function (f, fi) { if (f) f.text.split('\n').forEach(function (line) {
        var x = line.trim() && json(line);
        /* A line that isn't a record is counted (reading for other apps names it), never read. */
        if (!x || typeof x !== 'object' || Array.isArray(x)) { if (line.trim()) malformed.push(dir + '/' + names[fi]); return; }
        var v = R.cleanArchive(x);
        if (!v.ok) { refused.push({ path: dir + '/' + names[fi], kind: v.kind, why: v.why, needs: v.needs || '' }); return; }
        if (x.id && Object.prototype.hasOwnProperty.call(seen, x.id)) return;
        if (x.id) seen[x.id] = 1;
        Object.defineProperty(x, '_file', { value: dir + '/' + names[fi], enumerable: false });
        out.push(x);
      }); });
      var key = function (x) { return typeof x.at === 'string' && !isNaN(Date.parse(x.at)) ? x.at : ''; };
      out.sort(function (a, b) { return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0; });
      out.refused = refused; out.malformed = malformed;
      return out;
    });
  }
  /* Only a copy that was actually listed next to this run, by its exact name. */
  function isCopy(run, name) { return typeof name === 'string' && name !== 'run.json' && (/^run.*\.json$/i.test(name) || CAND.test(name)) && !/[\/\\]/.test(name) && (!run._conflicts || run._conflicts.indexOf(name) >= 0); }
  function readCopy(fs, run, name) {
    if (!isCopy(run, name)) return Promise.reject(new Error('Not a run copy.'));
    return fs.read('runs/' + run.process + '/' + run.id + '/' + name).then(function (f) { return f ? R.cleanCopy(json(f.text), run) : null; });
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

  /* A reference screenshot added in the builder (o: { process, step, file, writer, now?, rand? }): checked like an attachment
     (images only, 5 MB, its first bytes), written once under a new name that carries this window's writer ID, so no other
     window can choose it (a name that's taken anyway gets another random part; nothing is ever written over), then read back and compared byte for byte. Resolves { path, ext, size }; the caller adds the line
     to the draft only after that. A failed or partial write rejects, and nothing refers to the file. */
  function saveShot(fs, o) {
    var f = o.file, A = PF.attach, ok = A.checkShot(f && f.name || '', f && f.type, f && f.size);
    if (ok.error) return Promise.reject(new Error(ok.error));
    var now = o.now != null ? o.now : Date.now(), rand = o.rand || function () { return U.randomId(6); }, tries = 0, sent;
    if (!/^[A-Za-z0-9]{1,40}$/.test(String(o.writer || ''))) return Promise.reject(new Error('Flightdeck can\'t name a screenshot without this window\'s ID.'));
    if (!A.shotPath(o.process, o.step, now, o.writer, 'a', ok.ext)) return Promise.reject(new Error('Flightdeck can\'t name a screenshot for this process.'));
    function same(a, b) { if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
    function attempt() {
      var path = A.shotPath(o.process, o.step, now, o.writer, rand(), ok.ext);
      if (!path) throw new Error('Flightdeck can\'t name a screenshot for this process.');
      return fs.stat(path).then(function (st) {
        if (st) { if (++tries >= 3) throw new Error('Couldn\'t find a free name for the image. Try again.'); return attempt(); }
        return fs.write(path, f).then(function () { return fs.blob(path); }).then(function (b) {
          if (!b) throw new Error('The image wasn\'t there when Flightdeck read it back. Try again.');
          return b.arrayBuffer();
        }).then(function (back) {
          if (!same(new Uint8Array(back), sent)) throw new Error('The image didn\'t save completely. Try again.');
          return { path: path, ext: ok.ext, size: ok.size };
        });
      });
    }
    return f.arrayBuffer().then(function (buf) {
      sent = new Uint8Array(buf);
      if (!A.sniff(sent.subarray(0, 4096), ok.ext)) throw new Error('"' + ok.name + '" doesn\'t look like a .' + ok.ext + ' file inside, so it wasn\'t added.');
      return attempt();
    });
  }

  /* Write the map and types first and the publication record last, so a half-synced publication is never mistaken for a complete one. */
  /* The processes a draft pins with version: (2.0), read from the folder as the app lists them ({ latest, all, clashes,
     broken }), so publish.build resolves each pin to exactly one usable folder. */
  function childProcsFor(fs, parsed) {
    var names = [];
    PF.map.steps(parsed).forEach(function (x) { var f = x.step.fields || {}; if (x.step.type === 'run.process' && f.version != null && f.process && names.indexOf(f.process) < 0) names.push(f.process); });
    var out = Object.create(null);
    return Promise.all(names.map(function (name) { return readProcess(fs, name).then(function (p) { if (p) out[name] = p; }); })).then(function () { return out; });
  }
  /* One process's versions, as the app lists them ({ latest, all, clashes, broken }), or null when none is there. One whose
     folder can't be listed is { unlisted: why } with no versions, which every pin lookup refuses with that reason. */
  function readProcess(fs, name) {
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(name)) return Promise.resolve(null);
    var unlisted = null;
    return Promise.resolve().then(function () { return fs.list('publications/' + name); }).then(function (vers) {
      return Promise.all((vers || []).filter(function (v) { return v.kind === 'dir' && P.versionOf(v.name); }).map(function (v) { return readVersion(fs, name, v.name); }));
    }, function (e) { unlisted = 'publications/' + name + '/ ' + listWhy(e); return []; }).then(function (pubs) {
      if (unlisted) return { latest: null, all: [], clashes: [], broken: [], unlisted: unlisted };
      if (!pubs.length) return null;
      var i = P.index(pubs);
      return { latest: i.latest, all: i.all, clashes: i.clashes, broken: pubs.filter(function (x) { return !x.ok; }) };
    });
  }
  function publish(fs, draftMd, opts) {
    return childProcsFor(fs, PF.map.parse(draftMd)).then(function (kids) {
      if (Object.keys(kids).length) opts = Object.assign({}, opts, { childProcs: Object.assign({}, kids, opts.childProcs || {}) });
      return publishWith(fs, draftMd, opts);
    });
  }
  function publishWith(fs, draftMd, opts) {
    var built = P.build(draftMd, opts);
    if (built.blockers) return Promise.resolve(built);
    var parsed = PF.map.parse(draftMd), process = parsed.meta.process, base = 'publications/' + process + '/' + built.folder + '/';
    /* Reference screenshots are copied into the publication with a fingerprint each, so replacing one in images/ later never changes
       an old version's instructions. A screenshot that isn't in the folder stops the publish rather than vanishing from it. */
    var shots = PF.map.shotSources(parsed), blobs = {};
    var read = shots.reduce(function (p, src) { return p.then(function (missing) { return fs.blob(src).then(function (b) { if (!b) return missing.concat([src]); blobs[src] = b; return missing; }); }); }, Promise.resolve([]));
    return read.then(function (missing) {
      if (missing.length) return { blockers: missing.map(function (src) { return 'The screenshot ' + src + ' isn\'t in the team folder. Add it, or remove it from the checklist.'; }) };
      var bytes = {};
      return shots.reduce(function (p, src) { return p.then(function (m) { return bytesOf(blobs[src]).then(function (b) { bytes[src] = b; m[src] = fnvBytes(b); return m; }); }); }, Promise.resolve({})).then(function (images) {
        var rebuilt = Object.keys(images).length ? P.build(draftMd, Object.assign({}, opts, { images: images, imageBytes: bytes, rand: built.folder.replace(/^v\d+-/, '') })) : built;
        if (rebuilt.blockers) return rebuilt;
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

  /* ---------- Staging (2.1, docs/design.md section 31) ---------- */
  var STAGE_PROC = /^[a-z0-9][a-z0-9-]{0,59}$/;
  function sha256Of(b) { return PF.sha256.create().update(b).digest(); }
  /* A file written as part of a stage or a promotion, read back by its exact bytes: anything else there stops it. */
  function readBack(fs, path, want) {
    return fs.blob(path).then(function (b) { return b ? bytesOf(b) : null; }).then(function (b) {
      if (!b || sha256Of(b) !== want) throw new Error(path + ' didn\'t read back as written. Nothing was made from it.');
    });
  }
  /* Stage a draft: a version only test runs use, in staged/<process>/stage-<random8>/, written once. The checklist, step types
     and screenshots are written and read back first; the record is written last and read back as a stage, so a stage
     without a verified record is incomplete, never usable, and Folder health names it. Resolves to { folder, proposed } or
     { blockers }; rejects with the reason when a write or read-back fails. */
  function stage(fs, draftMd, opts) {
    return childProcsFor(fs, PF.map.parse(draftMd)).then(function (kids) {
      var o = Object.assign({}, opts, { stage: true });
      if (Object.keys(kids).length) o.childProcs = Object.assign({}, kids, opts.childProcs || {});
      var built = P.build(draftMd, o);
      if (built.blockers) return built;
      var parsed = PF.map.parse(draftMd), proc = parsed.meta.process, base = 'staged/' + proc + '/' + built.folder + '/';
      var shots = PF.map.shotSources(parsed), blobs = {}, bytes = {}, images = {};
      return shots.reduce(function (p, src) { return p.then(function (missing) { return fs.blob(src).then(function (b) { if (!b) return missing.concat([src]); blobs[src] = b; return missing; }); }); }, Promise.resolve([])).then(function (missing) {
        if (missing.length) return { blockers: missing.map(function (src) { return 'The screenshot ' + src + ' isn\'t in the team folder. Add it, or remove it from the checklist.'; }) };
        return shots.reduce(function (p, src) { return p.then(function () { return bytesOf(blobs[src]).then(function (b) { bytes[src] = b; images[src] = fnvBytes(b); }); }); }, Promise.resolve()).then(function () {
          var b2 = shots.length ? P.build(draftMd, Object.assign({}, o, { images: images, imageBytes: bytes, rand: built.folder.replace(/^stage-/, '') })) : built;
          if (b2.blockers) return b2;
          var put = function (path, data, want) { return fs.write(base + path, data).then(function () { return readBack(fs, base + path, want); }); };
          /* The window's folder and person, checked right before the first write (o.still, as for promote). */
          if (typeof opts.still === 'function' && !opts.still()) return { dropped: true };
          return shots.reduce(function (p, src) { return p.then(function () { return put(src, blobs[src], sha256Of(bytes[src])); }); }, Promise.resolve())
            .then(function () { return put('map.md', b2.files['map.md'], sha256Of(b2.files['map.md'])); })
            .then(function () { return put('types.json', b2.files['types.json'], sha256Of(b2.files['types.json'])); })
            .then(function () { return fs.write(base + 'publication.json', b2.files['publication.json']); })
            .then(function () { return readStage(fs, proc, b2.folder); })
            .then(function (res) {
              if (!res.ok) throw new Error('The stage didn\'t read back as written (' + res.why + '). It isn\'t usable; Folder health names it.');
              return { folder: b2.folder, proposed: res.info.stage.proposed, process: proc };
            });
        });
      });
    });
  }
  /* One stage folder, verified by the stage rules and its screenshots. Anything short of a verified stage is incomplete. */
  /* A stage is its folder's process's: one whose record or checklist names another process (copied in by hand) is
     unusable, named, so no test run or version is ever written for the wrong process. */
  function readStage(fs, proc, folder) {
    var base = 'staged/' + proc + '/' + folder + '/';
    return Promise.all(['map.md', 'types.json', 'publication.json'].map(function (n) { return fs.read(base + n); })).then(function (r) {
      return verifyExact(fs, base, folder, { 'map.md': r[0] && r[0].text, 'types.json': r[1] && r[1].text, 'publication.json': r[2] && r[2].text }, { stage: true });
    }).then(function (res) {
      if (res.ok && res.info.process !== proc) res = { ok: false, why: 'It\'s a stage of ' + String(res.info.process) + ', in ' + proc + '\'s folder. Edited by hand: nothing runs from it here.', info: res.info, unusable: true };
      else if (res.ok && res.map.meta.process !== proc) res = { ok: false, why: 'Its checklist is for ' + String(res.map.meta.process) + ', not ' + proc + '. Edited by hand: nothing runs from it here.', info: res.info, unusable: true };
      return res;
    }).then(function (res) {
      res.folder = folder; res.process = proc;
      return checkImages(fs, base, res);
    }).then(function (res) { if (!res.ok && !res.newer) res.incomplete = true; return res; });
  }
  /* staged/: listed only when the folder has it. { procs: { <process>: { stages, decisions, unread, refused, unlisted } } }.
     A process folder or its decisions that can't be listed hold that process's stages (unlisted), never "no stages". */
  function loadStaged(fs) {
    var procs = Object.create(null);
    return fs.list('staged').then(function (items) {
      return Promise.all(items.filter(function (i) { return i.kind === 'dir' && STAGE_PROC.test(i.name); }).map(function (p) {
        var sp = procs[p.name] = { stages: [], decisions: [], unread: [], refused: [], unlisted: '' };
        return fs.list('staged/' + p.name).then(function (xs) {
          var stages = xs.filter(function (x) { return x.kind === 'dir' && P.STAGE.test(x.name); }).map(function (x) {
            return readStage(fs, p.name, x.name).then(null, function (e) { return { ok: false, folder: x.name, process: p.name, why: why(e), incomplete: true }; });
          });
          var dec = xs.some(function (x) { return x.kind === 'dir' && x.name === 'decisions'; }) ? loadStageDecisions(fs, p.name, sp) : Promise.resolve();
          return Promise.all([Promise.all(stages), dec]).then(function (r) {
            sp.stages = r[0].sort(function (a, b) { return a.folder < b.folder ? -1 : 1; });
            /* A stage a newer Flightdeck wrote is refused by name, never called incomplete. */
            sp.stages.forEach(function (s) { if (s.newer) sp.refused.push(PF.envelope.refusal('staged/' + p.name + '/' + s.folder + '/publication.json', 'preflight-publication', { kind: 'newer', why: s.why, needs: s.needs })); });
          });
        }, function (e) { sp.unlisted = 'staged/' + p.name + '/ ' + why(e); });
      }));
    }).then(function () { return { procs: procs }; });
  }
  function loadStageDecisions(fs, proc, sp) {
    var dir = 'staged/' + proc + '/decisions/';
    return fs.list('staged/' + proc + '/decisions').then(function (items) {
      return Promise.all(items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) {
        return readJson(fs, dir + i.name).then(function (o) {
          var c = PF.staging.cleanDecision(o, proc, i.name);
          if (c.ok) sp.decisions.push(c.rec);
          else if (c.kind === 'newer') sp.refused.push(PF.envelope.refusal(dir + i.name, 'flightdeck-stage-decision', c));
          else sp.unread.push({ path: dir + i.name, why: c.why || 'isn\'t a stage decision' });
        }, function (e) { sp.unread.push({ path: dir + i.name, why: why(e) }); });
      }));
    }, function (e) { sp.unlisted = dir + ' ' + why(e); }).then(function () {
      sp.decisions.sort(function (a, b) { return a.rev - b.rev || (a._file < b._file ? -1 : 1); });
    });
  }
  /* Everything one process's stage decisions say, read now; refuses (rejects) when any of it can't be read, since a decision
     that can't be read could be the one that retired it. */
  function stageState(fs, proc) {
    var sp = { stages: [], decisions: [], unread: [], refused: [], unlisted: '' };
    return fs.list('staged/' + proc).then(function (xs) {
      return xs.some(function (x) { return x.kind === 'dir' && x.name === 'decisions'; }) ? loadStageDecisions(fs, proc, sp) : null;
    }, function (e) { sp.unlisted = 'staged/' + proc + '/ ' + why(e); }).then(function () {
      if (sp.unlisted || sp.unread.length || sp.refused.length) throw new Error('This stage\'s decisions can\'t be read now (' + (sp.unlisted || (sp.unread[0] || sp.refused[0]).path) + '). Try again once the folder has synced.');
      return sp;
    });
  }
  /* The first version that can't say whether it is a given stage's promotion: one that can't be read, reads incomplete (no
     format this copy reads, process, number, folder or fingerprints, or a stagedFrom that names no stage folder), names
     another process, or doesn't verify. Any of these could be the promotion, so the answer is unknown, never "not this
     stage". A version that names this stage is its promotion whatever else is wrong with it: the caller says so. */
  function promotionUnknown(pubs, stage) {
    var sfOk = function (sf) { return !!sf && typeof sf === 'object' && !Array.isArray(sf) && typeof sf.folder === 'string' && P.STAGE.test(sf.folder); };
    if (pubs.some(function (x) { return namesStage(x, stage); })) return null;
    for (var k = 0; k < pubs.length; k++) {
      var x = pubs[k], i = x.info;
      if (!i || typeof i !== 'object' || Array.isArray(i)) return { pub: x, why: x.why };
      if ((i.format !== P.FORMAT && i.format !== P.FORMAT2) || typeof i.process !== 'string' || typeof i.version !== 'number' || i.folder !== x.folder || typeof i.mapHash !== 'string' || typeof i.typesHash !== 'string' ||
        (Object.prototype.hasOwnProperty.call(i, 'stagedFrom') && !sfOk(i.stagedFrom))) return { pub: x, why: 'its publication.json is incomplete' };
      if (i.process !== x.process) return { pub: x, why: 'its publication.json is for ' + i.process };
      if (!x.ok) return { pub: x, why: x.why || 'it doesn\'t verify' };
    }
    return null;
  }
  function namesStage(x, stage) {
    var sf = x.info && typeof x.info === 'object' ? x.info.stagedFrom : null;
    return !!sf && typeof sf === 'object' && sf.folder === stage;
  }
  /* Retire or reopen a stage: a new decision file in this window's name, the rev after the latest read now. Never an edit. */
  /* Promote and decide take one lock per process (o.lock: the app's cross-window lock on this computer), and check everything
     again inside it, so two windows here never promote the same stage twice. Across computers, two at once is the clash
     publishing already has (docs/design.md section 31). */
  /* o.still: when given, asked inside the lock and again right before the first write; false drops the work unwritten
     (resolves to { dropped: true }), so a window that switched folder or person while it waited writes nothing. */
  function stageLocked(o, proc, go) {
    var run = function () { return o && typeof o.still === 'function' && !o.still() ? { dropped: true } : go(); };
    return o && typeof o.lock === 'function' ? o.lock('preflight:stage:' + proc, run) : Promise.resolve().then(run);
  }
  /* Start a test run on a stage (2.1): the stage read and verified now, and its decisions, so a stage retired, tied or
     promoted (o.pubs: the versions as last read) takes no new test run; then, after every read and right before the write,
     o.still() (the same folder and person) and o.make(stage) builds the run, which is saved as any new run is. Resolves to
     { run } or { dropped: true }. */
  function startTestRun(fs, proc, stageFolder, o) {
    if (!STAGE_PROC.test(proc) || !P.STAGE.test(stageFolder)) return Promise.reject(new Error('No such stage.'));
    return stageLocked(o, proc, function () { return startTestRunNow(fs, proc, stageFolder, o); });
  }
  function startTestRunNow(fs, proc, stageFolder, o) {
    var listing = fs.list('publications/' + proc).then(null, function (e) { throw new Error('publications/' + proc + '/ couldn\'t be read (' + (e && e.message || e) + '), so it isn\'t known whether this stage is already the default. Nothing was started.'); });
    return listing.then(function (vers) {
      return Promise.all([
        Promise.all(vers.filter(function (v) { return v.kind === 'dir' && P.versionOf(v.name); }).map(function (v) { return readVersion(fs, proc, v.name); })),
        readStage(fs, proc, stageFolder), stageState(fs, proc)
      ]);
    }).then(function (r) {
      var pubs = r[0], st = r[1], sp = r[2];
      if (!st.ok) throw new Error('This staged version can\'t be read now: ' + st.why);
      var unread = promotionUnknown(pubs, stageFolder);
      if (unread) throw new Error('publications/' + proc + '/' + unread.pub.folder + '/ can\'t be read now (' + unread.why + '), so it isn\'t known whether this stage is already the default. Try again once the folder has synced.');
      var mine = pubs.filter(function (x) { return namesStage(x, stageFolder); })[0];
      if (mine) throw new Error('It\'s already the default, v' + mine.info.version + '. Start an ordinary run on it.');
      var whyNot = PF.staging.promoteWhy(PF.staging.status(st, sp.decisions, pubs));
      if (whyNot) throw new Error(whyNot);
      if (typeof o.still === 'function' && !o.still()) return { dropped: true };
      var run = o.make(st);
      /* Inside the stage lock, so no promote or decision from this computer lands between the check and the write; the
         stage is read again strictly and o.still() asked once more right before the first write. */
      return saveRun(fs, run, o.session, { writer: o.writer, lock: o.lock, strict: true, still: o.still }).then(function () { return { run: run }; }, function (e) {
        if (e && e.dropped) return { dropped: true };
        throw e;
      });
    });
  }
  function stillOk(o) { if (o && typeof o.still === 'function' && !o.still()) { var e = new Error('dropped'); e.dropped = true; throw e; } }
  function decideStage(fs, proc, stageFolder, status, o) {
    if (!STAGE_PROC.test(proc) || !P.STAGE.test(stageFolder)) return Promise.reject(new Error('No such stage.'));
    return stageLocked(o, proc, function () { return decideStageNow(fs, proc, stageFolder, status, o); });
  }
  function decideStageNow(fs, proc, stageFolder, status, o) {
    return stageState(fs, proc).then(function (sp) {
      var l = PF.staging.latest(stageFolder, sp.decisions), d = PF.staging.decision(proc, stageFolder, status, { window: o.window, by: o.by, now: o.now || new Date().toISOString(), reason: o.reason, app: o.app || '', seen: l.rev || null });
      try { stillOk(o); } catch (e) { return { dropped: true }; }
      return fs.write(d.path, JSON.stringify(d.rec, null, 2)).then(function () { return d.rec; });
    });
  }
  /* Make a stage the default: the next number from a fresh listing (renumbered and said when someone published meanwhile),
     its exact files copied and read back, then the record last in the lowest format its content needs, with stagedFrom.
     Refused while publications/<process>/, the stage or its decisions can't be read, and for a stage that's retired, tied
     or already promoted. Resolves to { version, folder, proposed, renumbered }. */
  function promote(fs, proc, stageFolder, o) {
    if (!STAGE_PROC.test(proc) || !P.STAGE.test(stageFolder)) return Promise.reject(new Error('No such stage.'));
    return stageLocked(o, proc, function () { return promoteNow(fs, proc, stageFolder, o); });
  }
  function promoteNow(fs, proc, stageFolder, o) {
    var listing = fs.list('publications/' + proc).then(null, function (e) { throw new Error('publications/' + proc + '/ couldn\'t be read (' + (e && e.message || e) + '). Nothing was published.'); });
    return listing.then(function (vers) {
      return Promise.all([
        Promise.all(vers.filter(function (v) { return v.kind === 'dir' && P.versionOf(v.name); }).map(function (v) { return readVersion(fs, proc, v.name); })),
        stageState(fs, proc), readStage(fs, proc, stageFolder)
      ]).then(function (r) {
        var pubs = r[0], sp = r[1], st = r[2];
        if (!st.ok) throw new Error('This stage can\'t be read now: ' + st.why);
        /* A version whose record can't be read, or reads incomplete, could be this stage's promotion: never promote past one.
           One that names this stage, complete or not, already is. */
        var unread = promotionUnknown(pubs, stageFolder);
        if (unread) throw new Error('publications/' + proc + '/' + unread.pub.folder + '/ can\'t be read now (' + unread.why + '), so it isn\'t known whether this stage was already published. Try again once the folder has synced.');
        var mine = pubs.filter(function (x) { return namesStage(x, stageFolder); })[0];
        if (mine) throw new Error('It\'s already the default: it was published as ' + mine.folder + (mine.ok ? '.' : ', which isn\'t complete yet (' + mine.why + ').'));
        var s = PF.staging.status(st, sp.decisions, pubs), whyNot = PF.staging.promoteWhy(s);
        if (whyNot) throw new Error(whyNot);
        var version = P.nextVersion(vers.filter(function (v) { return v.kind === 'dir'; }).map(function (v) { return { version: P.versionOf(v.name) || 0 }; }));
        var folder = P.folderName(version, o.rand), base = 'publications/' + proc + '/' + folder + '/', from = 'staged/' + proc + '/' + stageFolder + '/';
        var record = P.promoteRecord(st, { version: version, folder: folder, by: o.by, now: o.now || new Date().toISOString(), app: o.app || '' });
        /* Every file is copied by its exact bytes and checked against the stage's frozen payload, before and after: what's
           published is byte for byte what was staged (a byte-order mark included). */
        var shots = Object.keys(st.info.images || {}), pay = st.info.payload;
        var put = function (path, data, want) { return fs.write(base + path, data).then(function () { return readBack(fs, base + path, want); }); };
        var raw = function (name, want) {
          return fs.blob(from + name).then(function (b) { return b ? bytesOf(b) : null; }).then(function (u8) {
            if (!u8 || sha256Of(u8) !== want) throw new Error('Still syncing: ' + from + name + ' doesn\'t match the stage. Nothing was published.');
            return u8;
          });
        };
        var text = function (name, want) { return raw(name, want).then(function (u8) { var t = PF.reports.utf8(u8); if (t == null) throw new Error(from + name + ' isn\'t UTF-8 text. Nothing was published.'); return t; }); };
        /* Everything is read and checked first; the window's folder and person are checked right before the first write. */
        var got = { blobs: {} };
        return shots.reduce(function (p, src) {
          return p.then(function () { return fs.blob(from + src).then(function (b) { if (!b) throw new Error('Still syncing: screenshot ' + src + ' hasn\'t arrived.'); return raw(src, pay.images[src]).then(function () { got.blobs[src] = b; }); }); });
        }, Promise.resolve())
          .then(function () { return text('map.md', pay.map).then(function (t) { got.map = t; }); })
          .then(function () { return text('types.json', pay.types).then(function (t) { got.types = t; }); })
          .then(function () {
            if (o && typeof o.still === 'function' && !o.still()) return { dropped: true };
            return shots.reduce(function (p, src) { return p.then(function () { return put(src, got.blobs[src], pay.images[src]); }); }, Promise.resolve())
              .then(function () { return put('map.md', got.map, pay.map); })
              .then(function () { return put('types.json', got.types, pay.types); })
              .then(function () { return writeRecord(); });
          });
        function writeRecord() { return fs.write(base + 'publication.json', record).then(finish); }
        function finish() { return readVersion(fs, proc, folder).then(function (res) {
            if (!res.ok) throw new Error('The new version didn\'t read back as written (' + res.why + ').');
            return { version: version, folder: folder, proposed: st.info.stage.proposed, renumbered: version !== st.info.stage.proposed };
          }); }
      });
    });
  }

  /* Save a text file only if it's still exactly what the editor started from (expect: that text's fingerprint, or null for
     "doesn't exist yet"). If someone (a person or an AI assistant) changed it meanwhile, nothing is written and their version comes
     back, so two editors over a shared folder never silently overwrite each other. */
  /* opts.expectText: when given, the file must be exactly that text (null: not there), compared right before the write, not
     only its fingerprint (two different drafts can share an FNV fingerprint). */
  function saveChecked(fs, path, text, expect, opts) {
    var exact = opts && opts.expectText !== undefined;
    /* Replacing a file needs the exact text it replaces: a fingerprint alone (32-bit FNV) could match a file that changed. */
    if (expect != null && (!exact || typeof opts.expectText !== 'string')) return Promise.reject(new Error('A save needs the exact text it expects to find.'));
    var go = function () {
      return fs.read(path).then(function (f) {
        var now = f ? U.hash(f.text) : null;
        if (now !== expect || (exact && (f ? f.text : null) !== opts.expectText)) return { conflict: true, theirs: f ? f.text : null, theirsHash: now };
        /* A folder can't check and write in one step, so read it back: if anything else is there now, say so rather than
           report a save that didn't stick. (Across computers, OneDrive keeps both copies of a file changed on two.) */
        return fs.write(path, text).then(function () { return fs.read(path); }).then(function (back) {
          if (back && back.text === text) return { ok: true, hash: U.hash(text), text: text };
          return { conflict: true, theirs: back ? back.text : null, theirsHash: back ? U.hash(back.text) : null, afterWrite: true };
        });
      });
    };
    return opts && opts.lock ? opts.lock('preflight:file:' + path, go) : go();
  }
  /* Every draft save names the exact text it expects (opts.expectText; null when the draft doesn't exist yet), and nothing
     over the size limit is ever written: the refusal (tooBig) says how big it is and what to cut. */
  function saveDraft(fs, file, md, expect, opts) {
    if (!/^[a-z0-9][a-z0-9-]{0,59}\.md$/.test(file)) return Promise.reject(new Error('A checklist file is named <process>.md, in lowercase letters, numbers and dashes.'));
    if (!opts || opts.expectText === undefined || (opts.expectText !== null && typeof opts.expectText !== 'string') || (opts.expectText === null) !== (expect == null)) return Promise.reject(new Error('A draft save needs the exact text it expects to find.'));
    var big = U.draftTooBig(md);
    if (big) { var e = new Error(big.why); e.tooBig = true; e.bytes = big.bytes; return Promise.reject(e); }
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
    return saveDraft(fs, file, rv.text, o.expect == null ? null : o.expect, Object.assign({}, opts, { expectText: o.expect == null ? null : o.base })).then(function (res) { res.text = rv.text; res.file = file; res.added = rv.added || ''; return res; });
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
  /* A stage sign-off (2.1): flightdeck-validation/2 in validations/<process>.<stage>.<window>.json, the frozen shape
     (PF.skills.stageSignoff). o: { window, by, note, evidence, as, app, now }. */
  function recordStageValidation(fs, stage, o) {
    var s = PF.skills.stageSignoff(stage, { window: o.window, by: o.by, at: o.now || new Date().toISOString(), note: o.note, evidence: o.evidence, as: o.as, app: o.app });
    return fs.write(s.path, s.text).then(function () { return s.rec; });
  }
  /* Sign off a stage from the app (2.1 slice 6): under the same per-process lock as promote and retire, the stage, its
     decisions and publications/<process>/ are read again; it must still be staged. o.check(stage) says who signs and with
     what evidence ({ as, evidence }, or throws why not); o.still() is asked right before the write. */
  function signOffStage(fs, proc, stageFolder, o) {
    if (!STAGE_PROC.test(proc) || !P.STAGE.test(stageFolder)) return Promise.reject(new Error('No such stage.'));
    return stageLocked(o, proc, function () {
      var listing = fs.list('publications/' + proc).then(null, function (e) { throw new Error('publications/' + proc + '/ couldn\'t be read (' + (e && e.message || e) + '). Nothing was signed off.'); });
      return listing.then(function (vers) {
        return Promise.all([Promise.all(vers.filter(function (v) { return v.kind === 'dir' && P.versionOf(v.name); }).map(function (v) { return readVersion(fs, proc, v.name); })), readStage(fs, proc, stageFolder), stageState(fs, proc)]);
      }).then(function (r) {
        var pubs = r[0], st = r[1], sp = r[2];
        if (!st.ok) throw new Error('This staged version can\'t be read now: ' + st.why);
        if (pubs.some(function (x) { return !x.info || typeof x.info !== 'object'; })) throw new Error('A version of this process can\'t be read now, so it isn\'t known whether this stage is already the default. Try again once the folder has synced.');
        var x = PF.staging.status(st, sp.decisions, pubs);
        if (x.status !== 'staged') throw new Error(x.status === 'promoted' ? 'It\'s already the default.' : PF.staging.promoteWhy(x) || 'It isn\'t staged now.');
        /* What it is judged on is read again now too: the test runs named (o.runIds, the ones on this stage as last read),
           people.json and this stage's sign-offs. A read that fails signs nothing. */
        var seen = Object.create(null), ids = (o.runIds || []).filter(function (id) { if (typeof id !== 'string' || !R.RUN_ID.test(id) || seen[id]) return false; seen[id] = true; return true; });
        /* A sign-off of this stage that can't be read could be the one already there: nothing is signed off until it reads. */
        var torn = [], newer = [], signs = loadJsonDir(fs, 'validations', PF.skills.signoffShaped, null, function (n) { return n.indexOf(proc + '.' + stageFolder + '.') === 0; }, torn, true).then(function (vs) {
          var out = vs.map(function (v) { var c = PF.skills.cleanValidation(v); if (!c.ok) (c.kind === 'newer' ? newer : torn).push({ path: 'validations/' + v._file, needs: c.needs || '' }); return c.ok ? c.rec : null; }).filter(Boolean);
          /* JSON that isn't a sign-off at all is ignored; one that won't parse, or says it's one but doesn't check, could be. */
          torn = torn.filter(function (t) { return !t.parsed; });
          var e;
          if (newer.length) { e = new Error(newer[0].path + ' is a sign-off of it made with a newer Flightdeck. ' + PF.envelope.needsText(newer[0].needs) + ' Nothing was signed off.'); e.said = true; throw e; }
          if (torn.length) { e = new Error(torn[0].path + ' couldn\'t be read, so it isn\'t known whether it\'s already signed off. Nothing was signed off. If it doesn\'t finish arriving, restore it from a backup or delete it.'); e.said = true; throw e; }
          return out;
        });
        /* Each run's outcome is told (o.outcome(id, { kind, why })) when it's gone or isn't itself, before anything is judged. */
        var said = function (id, res) { if (typeof o.outcome === 'function') o.outcome(id, res); };
        var one = function (id) {
          var bad = [];
          return loadRun(fs, proc, id, null, true, false, bad).then(function (r) {
            /* Only a run whose own record names this process and the folder it was read from. */
            if (r && r.process === proc && r.id === id) return r;
            said(id, bad.length ? { kind: 'unreadable', why: bad[0].why } : { kind: 'missing' });
            return null;
          }, function (e) { said(id, { kind: 'unreadable', why: 'couldn\'t be read (' + why(e) + ')' }); throw e; });
        };
        /* The reads that can say a run is gone start here (o.reading), not when the click waited for the lock. */
        if (typeof o.reading === 'function') o.reading();
        return Promise.all([Promise.all(ids.map(one)), loadPeople(fs), signs]).then(function (f) {
          var c = o.check(st, { runs: f[0].filter(Boolean), people: f[1], validations: f[2] });
          if (typeof o.still === 'function' && !o.still()) return { dropped: true };
          return recordStageValidation(fs, st, { window: o.window, by: o.by, note: o.note, evidence: c.evidence, as: c.as, app: o.app, now: o.now });
        }, function (e) { if (e && e.said) throw e; throw new Error('What it would be signed off on couldn\'t be read now (' + why(e) + '). Nothing was signed off.'); });
      });
    });
  }
  /* The payload rule for a promoted version (2.1): the SHA-256 of its own exact bytes, read now (cached while every file
     keeps its size and time), checked against its stage by PF.skills.carries. Resolves to '' or why not. */
  function stageCarried(fs, pub, stage, cacheIn) {
    var dir = 'publications/' + pub.info.process + '/' + pub.info.folder + '/', names = ['map.md', 'types.json'].concat(Object.keys(pub.info.images && typeof pub.info.images === 'object' ? pub.info.images : {}).sort());
    var c = cacheIn || cacheOf(fs); c.exact = c.exact || {};
    return Promise.all(names.map(function (n) { return fileStamp(fs, dir + n); })).then(function (stamps) {
      var key = names.map(function (n, i) { return n + '=' + stamps[i]; }).join('|'), was = c.exact[dir];
      if (was && was.key === key && stamps.every(Boolean)) return was.exact;
      return Promise.all(names.map(function (n) { return fs.blob(dir + n).then(function (b) { return b ? bytesOf(b) : null; }); })).then(function (bs) {
        if (bs.some(function (b) { return !b; })) return null;
        var exact = { 'map.md': sha256Of(bs[0]), 'types.json': sha256Of(bs[1]), images: Object.create(null) };
        names.slice(2).forEach(function (n, i) { exact.images[n] = sha256Of(bs[i + 2]); });
        c.exact[dir] = { key: key, exact: exact };
        return exact;
      });
    }).then(function (exact) { return PF.skills.carries(pub, stage, exact); }, function (e) { return 'Its files can\'t be read now (' + why(e) + ').'; });
  }
  /* Which stage each promoted version carries (pub.fromStage: { folder, ok, why, stage }), after a load. A stage that couldn't
     be read this time keeps what was worked out before, so a passing sync never changes it. */
  function attachStages(fs, out, cache) {
    var procs = (out.stages || {}).procs || {}, jobs = [];
    cache.carried = cache.carried || {};
    (out.processes || []).forEach(function (p) {
      (p.pubs || []).forEach(function (pub) {
        var sf = pub && pub.ok && pub.info && pub.info.stagedFrom;
        if (!sf || typeof sf !== 'object') return;
        var proc = pub.info.process, key = 'publications/' + proc + '/' + pub.info.folder + '/', folder = String(sf.folder || '');
        var sp = Object.prototype.hasOwnProperty.call(procs, proc) ? procs[proc] : null, st = sp ? sp.stages.filter(function (x) { return x.folder === folder; })[0] : null;
        /* A stage that couldn't be read this time: the one verified before, never the old verdict, and this version's own
           bytes checked against it again. */
        var was = cache.carried[key], unlisted = 'stages' in out.failed || !!(sp && sp.unlisted && /^staged\/[^/]+\/ /.test(sp.unlisted));
        /* Only a stage that wasn't listed this time; one read and failing, or listed as gone, forgets what was worked out. */
        if (!st && unlisted && was && was.stage && was.folder === folder) st = was.stage;
        else if (!st || !st.ok) delete cache.carried[key];
        if (!st) { pub.fromStage = { folder: folder, ok: false, why: 'Its stage isn\'t in the folder.', stage: null }; return; }
        jobs.push(stageCarried(fs, pub, st, cache).then(function (w) { pub.fromStage = { folder: folder, ok: !w, why: w, stage: st }; if (st.ok) cache.carried[key] = pub.fromStage; }));
      });
    });
    return Promise.all(jobs);
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
  /* to: for a plan/2 switched to another version (status retargeted), the exact version folder { folder, version }. */
  /* The write-time gate for a plan (2.1): start, decline or switch it only on a fresh read of every file that is this plan's,
     whatever the page last read. Under o.lock (the app's cross-window lock on this computer) it lists proposals/ now, reads
     every .json there, and refuses (rejects, nothing written) when the listing fails; when a file of this plan (named for it,
     or a copy or decision that says it's for it) is listed but gone, won't read or parse, or is refused or malformed; when
     its copies differ or none of them is the one the form showed (o.sha); or when a decision on it already exists (one
     started or declined; for a switch, any switch; for a start, a switch to another version than o.folder). Only then
     o.write() runs. o: { action: 'start' | 'declined' | 'retargeted', sha, folder, lock, write }. Across computers OneDrive
     has no lock: two at once is the clash groupPlans shows as decisions that disagree. */
  function decidePlan(fs, plan, o) {
    var id = plan && plan.id;
    if (typeof id !== 'string' || !id) return Promise.reject(new Error('No such plan.'));
    var go = function () { return planGate(fs, plan, o).then(function () { return o.write(); }); };
    return typeof o.lock === 'function' ? o.lock('preflight:plan:' + id, go) : Promise.resolve().then(go);
  }
  function planGate(fs, plan, o) {
    var id = plan.id, said = ' Nothing was written.';
    var mine = function (n) { if (n.indexOf(id) !== 0) return false; var c = n.charAt(id.length); return c === '.' || c === ' ' || c === '-' || c === '('; };
    return fs.list('proposals').then(null, function (e) { throw new Error('proposals/ couldn\'t be read (' + why(e) + '), so it isn\'t known whether this plan was already decided.' + said); }).then(function (items) {
      var names = items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return i.name; });
      return Promise.all(names.map(function (n) {
        var path = 'proposals/' + n;
        return fs.read(path).then(function (f) { return { name: n, path: path, o: f ? json(f.text) : undefined, gone: !f }; }, function (e) { return { name: n, path: path, o: undefined, err: why(e) }; });
      }));
    }).then(function (files) {
      var copies = [], decisions = [];
      files.forEach(function (x) {
        var o2 = x.o, ours = mine(x.name);
        if (o2 === undefined || o2 === null || typeof o2 !== 'object' || Array.isArray(o2)) {
          if (ours) throw new Error(x.path + ' can\'t be read now (' + (x.gone ? 'it was listed but gone when read' : x.err || 'it isn\'t complete JSON') + '), so it isn\'t known whether this plan was already decided.' + said);
          return;
        }
        var k = PF.plans.familyOf(o2, x.name), about = k === 'status' ? o2.proposal === id : k === 'plan' ? o2.id === id : false;
        if (!ours && !about) return;
        var v = PF.plans.clean(o2, x.name, false);
        if (!v.ok || v.why) throw new Error(x.path + ' can\'t be used here: it ' + (v.why || 'isn\'t a file this copy can read here').replace(/\.$/, '') + '. Until it can, this plan can\'t be started, declined or switched.' + said);
        if (!about) return;
        if (v.kind === 'plan') copies.push(o2); else decisions.push(o2);
      });
      if (!copies.length) throw new Error('This plan isn\'t in the folder now.' + said);
      var texts = copies.map(function (c) { return JSON.stringify(stripMeta(c)); });
      if (!copies.every(function (c) { return PF.requests.same(c, copies[0]); })) throw new Error('Two different copies of this plan are in the folder. Delete the wrong one first.' + said);
      if (texts.map(function (t) { return PF.sha256.hex(t); }).indexOf(o.sha) < 0) throw new Error('This plan changed since the form showed it. Open it again to see the new plan.' + said);
      var hashes = texts.map(function (t) { return U.hash(t); });
      /* A start or decline on this plan's ID holds it whatever version of the plan it was made on (2.1.1): one made before
         an edit, or on a copy since deleted, still counts. A switch counts only for the exact plan, as it isn't a decision. */
      var made = decisions.filter(function (d) { return d.status !== 'retargeted'; }), done = made.filter(function (d) { return d.status === 'accepted'; })[0] || made[0];
      if (done) throw new Error((done.status === 'accepted' ? 'This plan was already started' + (typeof done.run === 'string' ? ' (' + done.run + ')' : '') + '. Find its run on Runs.' : 'This plan was already ' + (done.status === 'declined' ? 'declined' : 'decided on') + '.') + ' To run it again, make a new plan.' + said);
      var moves = decisions.filter(function (d) { return d.status === 'retargeted' && hashes.indexOf(d.proposalHash) >= 0; });
      if (moves.length && o.action === 'retargeted') throw new Error('This plan was already switched to another version. Open it again to see where it starts.' + said);
      if (o.action === 'start' && moves.some(function (d) { return !d.to || d.to.folder !== o.folder; })) throw new Error('This plan was switched to another version in another window. Open it again to see where it starts.' + said);
    });
  }
  /* A start or decline goes to <plan>.status-<session>-d.json and a switch to <plan>.status-<session>.json (2.1.1), so a start
     never replaces the switch this window made before it. Resolves to the path written. */
  function recordPlanStatus(fs, plan, session, status, runId, by, to, app) {
    var rec = PF.plans.decision(plan, status, runId, by, new Date().toISOString(), to, app), path = 'proposals/' + plan.id + '.status-' + session + (status === 'retargeted' ? '' : '-d') + '.json';
    return fs.write(path, JSON.stringify(rec, null, 2)).then(function () { return path; });
  }
  /* Try again (2.1.1): the run a planned start reserved, written from the exact bytes this window kept when its first save
     failed (k: { process, id, path, text, cand, dec }), never made again. Under the plan's lock and then the run's, on a fresh
     read: this window's own decision (k.dec, by o.me) must still name the run, and the run's version must still be one this
     copy records on. A run.json with exactly those bytes is the first write having landed (success, nothing written); other
     text is refused. With none, the bytes are written only into a run folder with no file at any depth, apart from this
     window's own save receipt (k.cand) holding exactly those bytes: a folder with anything else held a run that was started
     and worked on, and is never recreated. o.still (the same folder and person): asked once each lock is held and again
     right before the write; false writes nothing and resolves { dropped: true }. */
  function resumeStart(fs, planId, k, o) {
    var said = ' Nothing was written.', id = k && k.id, proc = k && k.process;
    if (typeof id !== 'string' || !R.RUN_ID.test(id) || typeof proc !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(proc)) return Promise.reject(new Error('That isn\'t a run Flightdeck can write.' + said));
    var dir = 'runs/' + proc + '/' + id + '/', path = dir + 'run.json';
    if (k.path !== path || typeof k.text !== 'string' || typeof k.dec !== 'string' || k.dec.indexOf('proposals/' + planId + '.status-') !== 0 || /\/|\.\./.test(k.dec.slice('proposals/'.length))) return Promise.reject(new Error('That isn\'t a run Flightdeck can write.' + said));
    var gone = function () { return new Error('Your decision on this plan no longer names this run, so the run wasn\'t saved.' + said); };
    var go = function () {
      stillOk(o);
      return fs.read(k.dec).then(function (f) {
        /* The decision is read through the one plan reader, as the gate reads it. */
        var d = f ? json(f.text) : null, v = d && typeof d === 'object' && !Array.isArray(d) ? PF.plans.clean(d, k.dec.slice('proposals/'.length), false) : null;
        if (!v || !v.ok || v.why || v.kind !== 'status' || d.proposal !== planId || d.status !== 'accepted' || d.run !== id || d.by !== o.me) throw gone();
        return typeof o.lock === 'function' ? o.lock('preflight:run:' + proc + '/' + id, check) : check();
      });
    };
    return (typeof o.lock === 'function' ? o.lock('preflight:plan:' + planId, go) : Promise.resolve().then(go)).then(null, function (e) {
      if (e && e.dropped) return { dropped: true };
      throw e;
    });
    function check() {
      stillOk(o);
      forgetRun(fs, { process: proc, id: id });
      var run = R.sanitize(json(k.text));
      if (!run || run.id !== id || run.process !== proc) return Promise.reject(new Error('That isn\'t a run Flightdeck can write.' + said));
      if (run._unrunnable) return Promise.reject(readOnly(run._unrunnable));
      return pubProblem(fs, run, null, true).then(function (why) {
        if (why) throw readOnly(why);
        return fs.read(path);
      }).then(function (f) {
        stillOk(o);
        if (f) { if (f.text === k.text) return { already: true }; throw new Error('The run was saved and has changed since; open it from Runs.' + said); }
        return filesUnder(fs, dir.slice(0, -1)).then(function (paths) {
          var others = paths.filter(function (p) { return p !== k.cand; });
          var own = paths.length > others.length ? fs.read(k.cand).then(function (c) { return !!c && c.text === k.text; }) : Promise.resolve(true);
          return own.then(function (ok) {
            if (others.length || !ok) throw new Error('The run\'s folder has files but no run.json. Restore run.json from a backup.' + said);
            stillOk(o);
            return fs.write(path, k.text).then(function () { forgetRun(fs, run); return { written: true }; });
          });
        }, function (e) { throw new Error('The run\'s folder ' + why(e) + '.' + said); });
      });
    }
  }
  /* Every file under dir, at any depth, by path. */
  function filesUnder(fs, dir) {
    return fs.list(dir).then(function (items) {
      return Promise.all((items || []).map(function (i) { var p = dir + '/' + i.name; return i.kind === 'dir' ? filesUnder(fs, p) : [p]; })).then(function (l) { return [].concat.apply([], l); });
    });
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


  /* ---------- Proposals and presence (docs/design.md section 27): proposed/<process>/ and presence/ ----------
     Older copies' loaders never list these folders. A proposal is written once by the command line; attempts and decisions
     once by the window that makes them; each presence file by its own window. */
  var REC_MAX = 65536, PRES_MAX = 65536;
  /* Every process folder in proposed/: its proposals' metadata (the newest 200; texts are read again only when Review or
     Apply needs them), each checked (hashes, name, process: line, sizes on the bytes read); those that don't check out yet in
     bad (retried next time: a half-synced file fails its hashes); and every attempt and decision with the SHA-256 of its
     bytes. A proposal, being written once, is read once (cache.prop); records are small and read once too, unless deep. */
  function loadProposed(fs, cache, deep) {
    var PP = PF.proposals, pc = cache.prop = cache.prop || {}, rc = cache.recs = cache.recs || {}, seen = {};
    return fs.list(PP.DIR).then(function (procs) {
      var dirs = procs.filter(function (p) { return p.kind === 'dir' && PP.PROC.test(p.name); });
      return limited(dirs, 4, function (p) {
        var dir = PP.DIR + '/' + p.name;
        return fs.list(dir).then(function (items) {
          var names = items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return i.name; });
          var props = names.filter(function (n) { var x = PP.parseName(n); return x && x.kind === 'proposal'; });
          var ids = {}; props.forEach(function (n) { ids[n.slice(0, -5)] = true; });
          var recNames = names.filter(function (n) { var x = PP.parseName(n); if (x) return x.kind !== 'proposal'; var m = /^(p-[a-z0-9]{1,12}-[a-z0-9]{10})\./.exec(n); return !!(m && ids[m[1]]); });
          var bad = [];
          var gotProps = limited(props, 8, function (n) {
            var path = dir + '/' + n; seen[path] = true;
            if (pc[path] && !deep) return pc[path];
            return fs.read(path, { maxBytes: PP.FILE_MAX }).then(function (f) {
              if (!f) return null;
              var bytes = f.size != null ? f.size : U.utf8Bytes(f.text), res = PP.check(json(f.text), n, p.name, bytes);
              if (!res.ok) { delete pc[path]; bad.push({ name: n, path: path, why: res.why }); return null; }
              pc[path] = res.meta; return res.meta;
            }, function (e) { delete pc[path]; bad.push({ name: n, path: path, why: e && e.skipped ? 'is over 4 MB, more than a proposal can be' : why(e) }); return null; });
          });
          var gotRecs = limited(recNames, 8, function (n) {
            var path = dir + '/' + n; seen[path] = true;
            if (rc[path] && !deep) return rc[path];
            return readRecord(fs, path, n).then(function (r) { if (r.rec) rc[path] = r; else delete rc[path]; return r; });
          });
          return Promise.all([gotProps, gotRecs]).then(function (r) {
            var list = r[0].filter(Boolean).sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1; });
            /* all: every proposal's metadata, so one that depends on an older one is judged against it (only metadata is kept). */
            return { process: p.name, shown: list.slice(0, PP.LIST_MAX), all: list, older: Math.max(0, list.length - PP.LIST_MAX), bad: bad, records: r[1] };
          });
        });
      });
    }).then(function (list) {
      [pc, rc].forEach(function (m) { Object.keys(m).forEach(function (k) { if (!seen[k]) delete m[k]; }); });
      var procs = {}; list.forEach(function (x) { if (x.all.length || x.bad.length) procs[x.process] = x; });
      return { procs: procs };
    });
  }
  /* One process's proposals and every record about them, read now (records never from memory; a proposal, written once,
     may come from the cache), for the acceptance transaction and decisions: { metas, bad, records: { <id>: [...] } }. */
  function loadProposalSet(fs, proc) {
    var PP = PF.proposals, c = cacheOf(fs), sub = { prop: Object.assign({}, c.prop || {}), recs: {} };
    return loadProposed({ list: function (p) { return p === PP.DIR ? Promise.resolve([{ name: proc, kind: 'dir' }]) : fs.list(p); }, read: function (p, o) { return fs.read(p, o); } }, sub, false).then(function (got) {
      var x = got.procs[proc] || { all: [], bad: [], records: [] }, recs = {};
      x.all.forEach(function (m) { recs[m.id] = []; });
      x.records.forEach(function (r) { var m = /^(p-[a-z0-9]{1,12}-[a-z0-9]{10})\./.exec(r.name); if (m) (recs[m[1]] = recs[m[1]] || []).push(r); });
      return { metas: x.all, bad: x.bad, records: recs };
    });
  }
  /* One process's proposals as loadProposed lists them ({ process, shown, all, older, bad, records }, or null when it has none),
     for the draft editor's watcher (slice 2). Proposals and records already read come from memory. */
  function loadProposedOne(fs, proc) {
    var PP = PF.proposals, c = cacheOf(fs), sub = { prop: Object.assign({}, c.prop || {}), recs: Object.assign({}, c.recs || {}) };
    return loadProposed({ list: function (p) { return p === PP.DIR ? Promise.resolve([{ name: proc, kind: 'dir' }]) : fs.list(p); }, read: function (p, o) { return fs.read(p, o); } }, sub, false).then(function (got) {
      /* What it read of this process goes back into the folder's cache (written-once files, keyed by path), so neither the
         next look nor the next full read reads, parses and hashes them again; other processes' entries are untouched. */
      var dir = PP.DIR + '/' + proc + '/';
      [['prop', sub.prop], ['recs', sub.recs]].forEach(function (x) {
        var m = c[x[0]] = c[x[0]] || {};
        Object.keys(m).forEach(function (k) { if (k.indexOf(dir) === 0 && !(k in x[1])) delete m[k]; });
        Object.keys(x[1]).forEach(function (k) { if (k.indexOf(dir) === 0) m[k] = x[1][k]; });
      });
      return got.procs[proc] || null;
    });
  }
  function readRecord(fs, path, name) {
    return fs.read(path, { maxBytes: REC_MAX }).then(function (f) {
      if (!f) return { name: name, sha: null, rec: null, gone: true };
      return { name: name, sha: PF.sha256.hex(f.text), rec: PF.proposals.cleanRecord(json(f.text), name) };
    }, function () { return { name: name, sha: null, rec: null }; });
  }
  /* One proposal read whole and checked again, for Review and Apply: { ok, proposal, meta } or { ok: false, why }. */
  function readProposal(fs, proc, id) {
    var PP = PF.proposals, n = id + '.json';
    return fs.read(PP.DIR + '/' + proc + '/' + n, { maxBytes: PP.FILE_MAX }).then(function (f) {
      if (!f) return { ok: false, why: 'isn\'t in the folder any more' };
      var o = json(f.text), res = PP.check(o, n, proc, f.size != null ? f.size : U.utf8Bytes(f.text));
      return res.ok ? { ok: true, proposal: o, meta: res.meta } : res;
    });
  }
  /* A proposal's attempts and decisions, read now (never from memory): [{ name, sha, rec }], rec null when a file can't be
     read or isn't in the format (it can't be reviewed past). Other files named for the proposal count as records too. */
  function listRecords(fs, proc, id) {
    var dir = PF.proposals.DIR + '/' + proc;
    return fs.list(dir).then(function (items) {
      var names = items.filter(function (i) { return i.kind === 'file' && i.name.indexOf(id + '.') === 0 && i.name !== id + '.json' && /\.json$/i.test(i.name); }).map(function (i) { return i.name; }).sort();
      return limited(names, 8, function (n) { return readRecord(fs, dir + '/' + n, n); }).then(function (l) { return l.filter(function (r) { return !r.gone; }); });
    });
  }
  /* An attempt or a decision: created once (never over a file that's there) and read back. Within a window, the app
     makes every record of one process in turn (acceptProposal's queue and Web Lock), so a name is never taken twice. */
  function writeRecord(fs, proc, name, rec) {
    var path = PF.proposals.DIR + '/' + proc + '/' + name, text = JSON.stringify(rec, null, 2) + '\n';
    return fs.read(path).then(function (f) {
      if (f) throw new Error('A file with that name is already in the folder.');
      return fs.write(path, text);
    }).then(function () { return fs.read(path); }).then(function (back) {
      if (!back || back.text !== text) throw new Error('it didn\'t read back as written');
      return name;
    });
  }
  /* presence/: every file, each checked against its name (rec null: malformed). */
  function loadPresence(fs) {
    var PP = PF.proposals;
    return fs.list(PP.PRESENCE).then(function (items) {
      var names = items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return i.name; }).slice(0, 500);
      return limited(names, 8, function (n) {
        return fs.read(PP.PRESENCE + '/' + n, { maxBytes: PRES_MAX }).then(function (f) {
          return f ? { name: n, writer: n.slice(0, -5), rec: PP.cleanPresence(json(f.text), n), mtime: f.mtime } : null;
        }, function () { return { name: n, writer: n.slice(0, -5), rec: null }; });
      }).then(function (l) { return l.filter(Boolean); });
    });
  }
  function writePresence(fs, rec) { return fs.write(PF.proposals.PRESENCE + '/' + PF.proposals.presenceName(rec.writer), JSON.stringify(rec) + '\n'); }
  function removePresence(fs, writer) { return fs.remove(PF.proposals.PRESENCE + '/' + PF.proposals.presenceName(writer)).then(null, function () {}); }
  /* Any window writing presence may delete files in presence/ over 24 hours old, at most 20 a pass (the second documented
     exception to one writer per file, beside connection/). Each is looked at again first, and deleted only if its size and
     time didn't change meanwhile; a live window whose file is deleted writes it again at its next beat. */
  function cleanPresence(fs, now) {
    var PP = PF.proposals, gone = 0;
    if (!fs.stat) return Promise.resolve(0);
    return fs.list(PP.PRESENCE).then(function (items) {
      var names = items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return i.name; }).slice(0, 500);
      return names.reduce(function (p, n) {
        return p.then(function () {
          if (gone >= PP.CLEAN_MAX) return;
          var path = PP.PRESENCE + '/' + n;
          return fs.stat(path).then(function (st1) {
            if (!st1) return;
            return fs.read(path, { maxBytes: PRES_MAX }).then(function (f) {
              var rec = f && PP.cleanPresence(json(f.text), n), t = rec ? Date.parse(rec.at) : st1.mtime;
              if (!(now - t > PP.CLEAN_MS)) return;
              return fs.stat(path).then(function (st2) {
                if (!st2 || st2.size !== st1.size || st2.mtime !== st1.mtime) return;
                gone++; return fs.remove(path).then(null, function () {});
              });
            }, function () {});
          }, function () {});
        });
      }, Promise.resolve()).then(function () { return gone; });
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
      /* replaced-*.json beside a run (small, and only these) are read to recognize an older copy's placeholder (H10). */
      var want = files.filter(function (f) { return f.p === 'people.json' || f.p === 'jira/workflows.json' || f.p === '.flightdeck/installed.json' || f.p === PF.contract.AGENTS || /^(proposals|validations)\/[^/]+\.json$/i.test(f.p) || /^\.flightdeck\/skills\//.test(f.p) || (/^runs\/[^/]+\/[^/]+\/replaced-[^/]+\.json$/.test(f.p) && f.s != null && f.s <= 65536); });
      var texts = {}, installed = null, placeholders = [];
      return Promise.all(want.map(function (f) {
        return go(function () { if (!alive()) throw stop(); return fs.read(f.p); }).then(function (r) {
          if (!r) return;
          if (/^\.flightdeck\/skills\//.test(f.p) || f.p === PF.contract.AGENTS) { texts[f.p] = r.text; return; }
          var o = json(r.text);
          if (f.p === '.flightdeck/installed.json') { installed = PF.contract.cleanInstalled(o); return; }
          if (/^runs\//.test(f.p)) { if (R.isPlaceholder(o)) placeholders.push(f.p); return; }
          if (o === undefined) unreadable.push({ path: f.p, why: 'isn\'t valid JSON' });
          else if (f.p === 'people.json' && !Array.isArray(o) && !(o && Array.isArray(o.people))) unreadable.push({ path: f.p, why: 'isn\'t a list of people' });
        }, function (e) { if (e && e.cancelled) throw e; unreadable.push({ path: f.p, why: why(e) }); });
      })).then(function () {
        /* Reports, each read as bytes (at most 64 KB), so a report that can't be read, a newer one, or copies that differ
           are named here, never only when someone opens its run. */
        var reps = files.filter(function (f) { var m = /^reports\/([^/]+)\/([^/]+)$/.exec(f.p); return m && PROC_DIR.test(m[1]) && PF.reports.parseName(m[2]); });
        return Promise.all(reps.map(function (f) { var m = /^reports\/([^/]+)\/([^/]+)$/.exec(f.p); return go(function () { if (!alive()) throw stop(); return readReport(fs, m[1], m[2]); }).then(function (e) { return e ? { proc: m[1], e: e } : null; }); }));
      }).then(function (got) {
        var byProc = {}, reports = { checked: 0, problems: [], differ: [] };
        (got || []).filter(Boolean).forEach(function (x) { reports.checked++; (byProc[x.proc] = byProc[x.proc] || []).push(x.e); });
        Object.keys(byProc).sort().forEach(function (proc) {
          PF.reports.group(proc, byProc[proc]).list.forEach(function (g) {
            g.unreadable.forEach(function (u) { reports.problems.push({ path: u.path, kind: u.kind, why: u.why, needs: (byProc[proc].filter(function (e) { return e.path === u.path; })[0] || {}).needs || '' }); });
            if (g.differ) reports.differ.push({ key: g.key, paths: g.copies.map(function (c) { return c.path; }) });
          });
        });
        var bytes = 0, longest = 0, pubs = {}, areas = {};
        files.forEach(function (f) {
          bytes += f.s || 0; if (f.p.length > longest) longest = f.p.length;
          var top = f.p.indexOf('/') < 0 ? '(top)' : f.p.slice(0, f.p.indexOf('/')), a = areas[top] = areas[top] || { files: 0, bytes: 0 };
          a.files++; a.bytes += f.s || 0;
          var m = /^(publications\/[^/]+\/[^/]+)\//.exec(f.p);
          if (m && f.m != null && (pubs[m[1]] == null || f.m > pubs[m[1]])) pubs[m[1]] = f.m;
        });
        return { at: new Date().toISOString(), ms: Date.now() - started, files: files.length, bytes: bytes, longest: longest, areas: areas, pubs: pubs, list: files, unreadable: unreadable, truncated: truncated,
          contractTexts: texts, placeholders: placeholders.sort(), reports: reports, installed: files.some(function (f) { return f.p === '.flightdeck/installed.json'; }) ? installed || 'bad' : null,
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
  /* Plans and their decisions. One plan can be in two files: OneDrive keeps both when two computers wrote it while
     disconnected (a request from another app, made on each). Copies that say the same thing (PF.requests.same: equal apart
     from when each was written) are one plan, shown once from the file under its own name (_copies says how many files);
     copies that differ are each shown, flagged (_copiesDiffer, _files), and the app starts neither until a person deletes one.
     A decision is the plan's _status only for the exact plan it was made on (any copy of it); if the plan changed afterwards,
     it isn't pending again: _decidedEarlier holds it (2.1.1). Decisions that disagree (one accepted and one declined, or two
     starts naming different runs, on any version of it) leave the plan undecided rather than picking one, so a plan started
     on two computers is shown, never hidden. */
  /* unread: files in proposals/ that couldn't be read (repo.loadAll's planUnread). One named <plan>.status-… could be a
     decision on that plan, so the plan holds them (_statusUnread) and isn't started until they read. */
  function groupPlans(plans, statuses, unread) {
    var byId = Object.create(null), order = [], out = [];
    /* _hash is the fingerprint plan decisions name (persisted, so unchanged); _sha (SHA-256) is what a form compares. */
    plans.forEach(function (p) { var t = JSON.stringify(stripMeta(p)); p._hash = U.hash(t); p._sha = PF.sha256.hex(t); if (!byId[p.id]) { byId[p.id] = []; order.push(p.id); } byId[p.id].push(p); });
    order.forEach(function (id) {
      var own = id + '.json', g = byId[id].sort(function (a, b) { var ca = a._file === own ? 0 : 1, cb = b._file === own ? 0 : 1; return ca - cb || (String(a._file) < String(b._file) ? -1 : String(a._file) > String(b._file) ? 1 : 0); });
      var alike = g.every(function (p) { return PF.requests.same(p, g[0]); }), files = g.map(function (p) { return p._file; }), allHashes = g.map(function (p) { return p._hash; });
      (alike ? [g[0]] : g).forEach(function (p) {
        var hashes = alike ? g.map(function (x) { return x._hash; }) : [p._hash];
        var all = statuses.filter(function (s) { return s.proposal === p.id; });
        /* A plan/2 switched to another version by a person (plan-status/2, retargeted) for this exact plan: the switch, not a
           decision. Switches that name different versions ask again. */
        var moves = all.filter(function (s) { return s.status === 'retargeted' && hashes.indexOf(s.proposalHash) >= 0 && s.to && typeof s.to.folder === 'string'; }), mine = all.filter(function (s) { return s.status !== 'retargeted'; });
        var to = moves.map(function (s) { return s.to.folder; }).filter(function (f, i, a) { return a.indexOf(f) === i; }).sort();
        p._retarget = to.length === 1 ? moves.sort(function (a, b) { return String(a.at) < String(b.at) ? 1 : -1; })[0] : null;
        p._retargetClash = to.length > 1 ? to : null;
        var match = mine.filter(function (s) { return hashes.indexOf(s.proposalHash) >= 0; });
        /* Starts and declines are compared across every version of the plan, whatever the hash (2.1.1): a start on one and a
           decline on an edited one, or two starts naming different runs, disagree. _starts keeps the runs they name. */
        var started = mine.filter(function (s) { return s.status === 'accepted'; });
        p._conflicting = mine.some(function (s) { return s.status !== mine[0].status; }) || started.some(function (s) { return (s.run || null) !== (started[0].run || null); });
        p._starts = started.map(function (s) { return s.run || null; }).filter(function (r, i, a) { return a.indexOf(r) === i; });
        p._status = match.length && !p._conflicting ? match[0] : null;
        /* A plan edited after its decision isn't pending again: the decision made on its earlier version holds it. */
        p._changedAfterDecision = !p._status && !p._conflicting && mine.length > 0;
        p._decidedEarlier = p._changedAfterDecision ? mine.slice().sort(function (a, b) { return String(a.at) < String(b.at) ? 1 : -1; })[0] : null;
        p._copies = g.length; p._copiesDiffer = !alike; p._files = files;
        /* _statusHeld: { path, kind (unreadable, newer or malformed), needs }; _statusUnread: their paths. */
        p._statusHeld = (unread || []).filter(function (u) { return String(u._file).indexOf(p.id + '.status-') === 0; }).map(function (u) { return { path: u.path, kind: u.kind || 'unreadable', needs: u.needs || '' }; });
        p._statusUnread = p._statusHeld.map(function (u) { return u.path; });
        out.push(p);
      });
    });
    return out;
  }
  /* Planned runs and their decisions in proposals/, ungrouped: { plans, statuses, refused }. Every file goes through
     PF.plans.clean, the one reader the app and reading for other apps share. With bad (reading for other apps, and flightdeck
     plan request, which reads them with this same code), every file not in the format is named there, by file, and left out;
     a plan or decision from a newer Flightdeck is named newer. Without bad (the app) those are left out too, and the newer
     ones are kept in refused, so Folder health names them. only(name): just those files (plan request reads its own request's). */
  /* two: reading for other apps with contract 2, which reads plan/2 and its decisions as the app does. */
  function readPlans(fs, bad, only, two) {
    var refused = [], torn = [];
    return loadJsonDir(fs, 'proposals', function (o) { return o.kind === 'plan' || o.kind === 'status' || typeof o.format === 'string'; }, bad, only, torn).then(function (props) {
      var plans = [], statuses = [];
      props.forEach(function (p) {
        var v = PF.plans.clean(p, p._file, !!bad && !two), path = 'proposals/' + p._file, fam = PF.plans.familyOf(p, p._file) === 'status' ? 'flightdeck-plan-status' : 'flightdeck-plan';
        if (!v.ok) { if (bad) bad.push({ path: path, kind: v.kind, why: v.why }); refused.push(PF.envelope.refusal(path, fam, v)); return; }
        if (v.why) {
          /* Reading for other apps names it; a decision (or a plan/2) is also refused as in the app, so it holds its plan. */
          if (bad) { bad.push({ path: path, kind: 'malformed', why: v.why }); if (PF.plans.isExact(p) || v.kind === 'status') refused.push(PF.envelope.refusal(path, fam, { kind: 'malformed', why: v.why })); return; }
          /* A plan/2 or plan-status/2 that isn't in its format, and any decision that isn't one (a switch without its version
             among them), is refused with its reason and never kept. A 1.x plan keeps what every 1.x copy did with it. */
          if (PF.plans.isExact(p) || v.kind === 'status') { refused.push(PF.envelope.refusal(path, fam, { kind: 'malformed', why: v.why })); return; }
        }
        if (v.kind === 'status') statuses.push(p);
        else if (typeof p.id === 'string' && typeof p.process === 'string') plans.push(p);
      });
      return { plans: plans, statuses: statuses, refused: refused, torn: torn || [] };
    });
  }
  /* Reading for other apps: a view of a folder that writes down, by path, every list, read, stat or blob that failed (as
     link, skipped or unreadable), including a failure that comes later from a blob it handed out (arrayBuffer, text, a
     slice's), and every file or folder that was listed but gone by the time it was read or listed itself (vanished). A
     folder counts as gone only when the folder says so (a listing marked missing); an empty listing is just empty. Loaders
     add what they found malformed with note(). A file that failed to read isn't named again for what it holds. problems()
     is the list the envelope reports; complete means it's empty. Calls that throw at once are failures like any other. */
  var IO_KINDS = { unreadable: true, link: true, skipped: true, vanished: true };
  function ledger(fs) {
    var byKey = {}, order = [], listed = {}, w = {};
    function note(path, kind, w2) { path = String(path); var k = path + '\u0000' + kind; if (byKey[k]) return; byKey[k] = { path: path, kind: kind, why: String(w2 || '') }; order.push(k); }
    function problems() {
      var io = {}; order.forEach(function (k) { if (IO_KINDS[byKey[k].kind]) io[byKey[k].path] = true; });
      return order.map(function (k) { return byKey[k]; }).filter(function (p) { return IO_KINDS[p.kind] || !io[p.path]; })
        .sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0; })
        .map(function (p) { return { path: p.path, kind: p.kind, why: p.why }; });
    }
    function attempt(f) { return new Promise(function (res) { res(f()); }); }
    function call(m, p, o) { return attempt(function () { return fs[m](p, o); }); }
    function failed(p) { return function (e) { note(p || '', errKind(e), why(e)); throw e; }; }
    function gone(p) { return function (f) { if (!f && listed[p]) note(p, 'vanished', 'was listed, then gone before it could be read'); return f; }; }
    /* A blob's own reads fail later than blob() itself: each is recorded at the blob's path too. */
    function watched(b, p) {
      if (!b || typeof b !== 'object') return b;
      var o = { size: b.size, type: b.type };
      ['arrayBuffer', 'text'].forEach(function (m) { if (typeof b[m] === 'function') o[m] = function () { return attempt(function () { return b[m](); }).then(null, failed(p)); }; });
      if (typeof b.slice === 'function') o.slice = function (x, y) { try { return watched(b.slice(x, y), p); } catch (e) { failed(p)(e); } };
      if (typeof b.stream === 'function') o.stream = function () { try { return b.stream(); } catch (e) { failed(p)(e); } };
      if (typeof b.close === 'function') o.close = function () { return b.close(); };
      return o;
    }
    if (typeof fs.list === 'function') w.list = function (p, o) {
      return call('list', p, o).then(function (items) {
        if (items && items.missing && listed[p]) note(p, 'vanished', 'was listed, then gone before it could be listed itself');
        (items || []).forEach(function (i) { if (i && (i.kind === 'file' || i.kind === 'dir')) listed[(p ? p + '/' : '') + i.name] = true; });
        return items;
      }, failed(p));
    };
    if (typeof fs.read === 'function') w.read = function (p, o) { return call('read', p, o).then(gone(p), failed(p)); };
    if (typeof fs.blob === 'function') w.blob = function (p, o) { return call('blob', p, o).then(function (b) { return watched(gone(p)(b), p); }, failed(p)); };
    if (typeof fs.stat === 'function') w.stat = function (p, o) { return call('stat', p, o).then(gone(p), failed(p)); };
    ['write', 'append', 'remove'].forEach(function (m) { w[m] = function () { return fs[m].apply(fs, arguments); }; });
    return { fs: w, note: note, problems: problems };
  }
  function readOnlyView(fs, what) {
    var ro = {};
    ['list', 'read', 'stat', 'blob'].forEach(function (m) { if (typeof fs[m] === 'function') ro[m] = function (p, o) { return fs[m](p, o); }; });
    ['write', 'append', 'remove'].forEach(function (m) { ro[m] = function () { throw new Error((what || 'Exporting evidence') + ' is read-only: it never changes a file in the team folder (' + m + ').'); }; });
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
  /* A run's report files and decision files by name (copies included): { reports, decisions, listing }. A folder that isn't
     there lists as empty; one that can't be listed fails the export, as followups/ does. */
  function evReportFiles(ro, proc, id) {
    var X = PF.reports, mine = function (dir, re) {
      return ro.list(dir + '/' + proc).then(function (items) { return items.filter(function (i) { var m = i.kind === 'file' ? re.exec(i.name) : null; return !!m && m[1] === id; }).map(function (i) { return i.name; }).sort(); });
    };
    return Promise.all([mine(X.DIR, X.FILE), mine(X.DDIR, X.DFILE)]).then(function (x) {
      return { reports: x[0], decisions: x[1], listing: x[0].map(function (n) { return X.DIR + '/' + n; }).concat(x[1].map(function (n) { return X.DDIR + '/' + n; })) };
    });
  }
  function collectEvidence(fsIn, scope, opts) {
    opts = opts || {};
    var E = PF.evidence, S = PF.sha256, Z = PF.zip, C = PF.corrections, FU = PF.followups;
    var ro = readOnlyView(opts.pool === false ? fsIn : bounded(fsIn, 'export'));
    var now = opts.now || Date.now, cap = opts.cap || 0, maxFile = opts.maxFile != null ? opts.maxFile : cap ? E.CAPS.file : 0;
    var attachments = opts.attachments !== false, keepAll = opts.keepBytes !== false;
    var tz = scope.tz || opts.tz || 'UTC';
    var col = { format: E.FORMAT, app: opts.app || '', madeWith: opts.madeWith || '', scope: null, tz: tz, startedAt: new Date(now()).toISOString(), endedAt: '', attempts: 1,
      runs: [], files: [], exclusions: [], unresolved: [], people: {}, window: opts.window || null, options: { attachments: attachments, format: opts.format === 'report' ? 'report' : 'pack' }, status: 'complete' };
    /* Records (run.json, notes, decisions, a version's files) are read in full only once their size says they may be: never
       one over the limit. Decisions are tiny; one over 1 MB isn't read as one. What other runs and versions of a process are
       read for (to work out where corrections stand) has one budget of its own. */
    var recordMax = maxFile || E.CAPS.file, DEC_MAX = 1048576, PEOPLE_MAX = 4 * 1048576, CTX_MAX = cap ? Math.min(64 * 1048576, Math.floor(cap / 4)) : 64 * 1048576;
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
    function statOf(path) { return ro.stat(path).then(function (st) { return st ? st.size : null; }); }
    /* One decoder for every record, as a browser reads files: UTF-8, a byte-order mark dropped. */
    function decoded(t) { return t == null ? null : String(t).replace(/^﻿/, ''); }
    /* Text of a file that's never packed (another run's records, people.json): sized first, never over limit. */
    function sizedText(path, limit) {
      return statOf(path).then(function (size) {
        if (size == null) return { missing: true };
        if (size > limit) return { over: size };
        return ro.read(path).then(function (f) { return f ? { text: decoded(f.text) } : { missing: true }; }, function () { return { missing: true }; });
      });
    }

    /* ---- one snapshot per file, for the whole pack ----
       Every reader of a file (what goes in, the checks, the claims, the page and the pack itself) uses the same captured
       bytes, so nothing can disagree. A snapshot is taken once: sized first, then hashed in 1 MB chunks (a yield between
       them, canceled between them), its bytes kept when it's a record or a picture (or always, in the browser), and its text
       decoded once. A file whose size changed between the two, or that turned into a link, is marked so; the recheck after
       collecting reads records again and stats the rest, and any file that changed is captured again, with everything that
       depends on it. */
    var snaps = {}, done = {}, decHash = {};
    /* Everything the collection holds in memory is counted, as it's read: one budget for the whole collection (the cap in
       the browser). Past it nothing more is kept: files not read yet are left out, named, and the pack is partial. */
    var retained = { now: 0, peak: 0, limit: cap || (keepAll ? 1024 : 512) * 1048576, full: false };
    function hold(n) { retained.now += n; if (retained.now > retained.peak) retained.peak = retained.now; }
    /* Let go of a snapshot's bytes: what it held no longer counts. */
    function forget(path) { var r = done[path]; if (r && r.bytes) r.bytes.forEach(function (u) { retained.now -= u.length; }); delete snaps[path]; delete done[path]; }
    function keeps(path, size) { return keepAll || (size <= recordMax && (!isAttachment(path) || /\.(png|jpe?g|gif|webp)$/i.test(path))); }
    function isAttachment(path) { return /^runs\/[^/]+\/[^/]+\/files\//.test(path); }
    function hashBlob(b, keep) {
      var h = S.create(), crc = 0, off = 0, size = b.size, parts = keep ? [] : null;
      function step() {
        stop();
        if (off >= size) { if (b.close) b.close(); return { size: off, sha256: h.digest(), crc: crc, bytes: parts }; }
        return b.slice(off, Math.min(size, off + EV_CHUNK)).arrayBuffer().then(function (ab) {
          var u = new Uint8Array(ab);
          if (!u.length) throw new Error('A file ended early while it was read.');
          /* Kept bytes are counted chunk by chunk: past the budget this file is let go, and nothing more is kept. */
          if (parts && retained.now + u.length > retained.limit) { parts.forEach(function (x) { retained.now -= x.length; }); retained.full = true; if (b.close) b.close(); return { skipped: true }; }
          h.update(u); crc = Z.crc32(u, crc); if (parts) { parts.push(u); hold(u.length); } off += u.length;
          return evYield().then(step);
        });
      }
      return Promise.resolve().then(step).then(null, function (e) { if (b.close) b.close(); throw e; });
    }
    function capture(path) {
      return statOf(path).then(function (size) {
        if (size == null) return { gone: true };
        if (retained.full && keeps(path, size)) return { skipped: true, statSize: size };
        return ro.blob(path).then(null, function (e) { if (e && e.link) return null; throw e; }).then(function (b) {
          if (!b) return { gone: true, statSize: size };
          return hashBlob(b, keeps(path, size)).then(function (r) {
            r.statSize = size;
            if (r.skipped) return r;
            if (r.bytes) { r.image = r.bytes.length ? E.imageType(path, r.bytes[0]) : ''; if (!isAttachment(path) && r.size <= recordMax) r.text = decoded(E.text(E.join(r.bytes))); }
            return r;
          });
        });
      });
    }
    function snapshot(path) {
      if (!snaps[path]) snaps[path] = capture(path).then(function (r) { done[path] = r; return r; }, function (e) { delete snaps[path]; throw e; });
      return snaps[path];
    }
    /* A record's text from its snapshot, sized first: one over the limit is never read. */
    function record(path, limit) {
      if (done[path]) return Promise.resolve(done[path].text != null ? { text: done[path].text } : done[path].gone ? { missing: true } : done[path].skipped ? { skipped: true } : { over: done[path].size });
      return statOf(path).then(function (size) {
        if (size == null) return { missing: true };
        if (size > (limit || recordMax)) return { over: size };
        return snapshot(path).then(function (r) { return r.gone ? { missing: true } : r.skipped ? { skipped: true } : r.text != null ? { text: r.text } : { over: r.size }; });
      });
    }
    function textOf(path) { return done[path] && done[path].text != null ? done[path].text : null; }
    /* A copy of what's kept from a file that shares nothing with its text: a slice of a big string keeps the whole string
       alive, so kept fields are written out and parsed again (fresh strings), and what they take is counted. */
    function detach(o) { var t = JSON.stringify(o); hold(t.length * 2); return JSON.parse(t); }
    function changeOf(path, r) { var n = path.split('/').pop(); return r.gone ? n + ' was removed' : r.size > r.statSize ? n + ' grew' : n + ' changed'; }

    /* ---- pack names ----
       The folder's own path under originals/, made unique ignoring letter case (so the pack unpacks on Windows) before any
       name is checked: a file named like another file or like a folder of the pack is renamed, never the folder. */
    function assignPacks(list) {
      var fold = function (x) { return (x.normalize ? x.normalize('NFC') : x).toLowerCase(); }, dirs = {}, taken = {};
      list.forEach(function (f) { var parts = ('originals/' + f.path).split('/'); for (var i = 1; i < parts.length; i++) dirs[fold(parts.slice(0, i).join('/'))] = true; });
      list.slice().sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; }).forEach(function (f, i) {
        var want = 'originals/' + f.path, n = 2;
        if (Z.checkName(want)) want = 'originals/_long-paths/' + (i + 1) + (/\.[\w]{1,8}$/.exec(f.path) || [''])[0];
        var base = want;
        while (taken[fold(want)] || dirs[fold(want)]) { var m = /^(.*?)(\.[^./]*)?$/.exec(base); want = m[1] + ' (' + n++ + ')' + (m[2] || ''); }
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
        /* One run.json at a time, counted in the memory budget while it's read and let go once its start is known. One that
           doesn't fit the budget can't be dated here: it's included, so nothing is hidden, and the pack says so. */
        return limited(dirs, 1, function (id) {
          var path = 'runs/' + scope.process + '/' + id + '/run.json';
          return statOf(path).then(function (size) {
            if (size == null) return { id: id, undated: 'run.json is missing' };
            if (size > recordMax || retained.now + size > retained.limit) return { id: id, undated: 'run.json is too big to read for when it started within the memory a pack may use here' };
            hold(size);
            return ro.read(path).then(function (f) { return f ? decoded(f.text) : null; }, function () { return null; }).then(function (t) {
              var o = t == null ? undefined : json(t), created = o && typeof o === 'object' && typeof o.created === 'string' ? o.created : null;
              /* A run.json that names another run is never dated by that run: included, and named. */
              var other = o && typeof o === 'object' ? elsewhere(o, scope.process, id) : '';
              t = null; o = null; retained.now -= size;
              if (other) return { id: id, undated: 'run.json ' + other };
              if (created && !isNaN(Date.parse(created))) return E.inRange(created, range) ? { id: id } : null;
              return { id: id, undated: 'run.json couldn\'t be read' };
            });
          });
        });
      }).then(function (list) {
        list = list.filter(Boolean);
        if (!list.length) throw new Error('No runs of ' + scope.process + ' were started from ' + scope.from + ' through ' + scope.through + ' (' + tz + ').');
        var max = opts.maxRuns || 0;
        if (max && list.length > max) throw new Error('That\'s ' + list.length + ' runs; a pack made here holds up to ' + max + '. Choose fewer days.');
        return list.map(function (x) { if (x.undated) undated.push('runs/' + scope.process + '/' + x.id + ': ' + x.undated + ', so when it started can\'t be checked. It\'s included so nothing is hidden.'); return scope.process + '/' + x.id; });
      });
    }
    var undated = [];

    /* ---- a process's decisions, runs and versions: for "Published in vN" ---- */
    var procCache = {}, selected = {};
    function processContext(proc) {
      if (procCache[proc]) return procCache[proc];
      var dirs = ['corrections', 'suggestions'];
      /* Decisions are evidence: always read (each sized first), and packed when they belong to a selected run. */
      var decisions = dirs.reduce(function (q, dir) { return q.then(function (acc) {
        return ro.list(dir + '/' + proc).then(function (items) {
          /* One at a time, so at most one decision's bytes are held while they're classified. */
          return limited(items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return i.name; }).sort(), 1, function (n) {
            var path = dir + '/' + proc + '/' + n;
            return record(path, DEC_MAX).then(function (r) {
              var o = r.text == null ? undefined : json(r.text), d = o === undefined ? null : C.cleanDecision(o, proc, n);
              if (d && (dir === 'suggestions') !== (d.kind === 'fix-decision')) d = null;
              if (d) { d._file = n; d._dir = dir; d = detach(d); }
              /* Read one at a time and let go at once: only the cleaned decision (small) and its hash are kept. One that
                 belongs to the pack is read again when the pack is read, and must have the same hash. */
              if (done[path] && done[path].sha256) decHash[path] = done[path].sha256;
              forget(path);
              return { path: path, dir: dir, name: n, d: d, skipped: !!r.skipped };
            });
          });
        }).then(function (got) { return acc.concat(got); });
      }); }, Promise.resolve([]));
      /* Other runs and the versions are read only to work out where corrections stand: sizes first, within one budget. */
      var runMetas = ro.list('runs/' + proc).then(function (items) {
        return limited(items.filter(function (i) { return i.kind === 'dir'; }).map(function (i) { return i.name; }).sort(), 8, function (id) {
          var base = 'runs/' + proc + '/' + id + '/';
          return ro.list(base.slice(0, -1)).then(function (files) {
            var want = files.some(function (i) { return i.name === 'run.json' && i.kind === 'file'; }) ? ['run.json'].concat(files.filter(function (i) { return i.kind === 'file' && /^notes-[\w-]+\.jsonl$/.test(i.name); }).map(function (i) { return i.name; }).sort()) : [];
            return Promise.all(want.map(function (n) { return statOf(base + n); })).then(function (sizes) { return { key: proc + '/' + id, base: base, want: want, sizes: sizes }; });
          });
        });
      });
      var pubMetas = ro.list('publications/' + proc).then(function (items) {
        return limited(items.filter(function (i) { return i.kind === 'dir' && P.versionOf(i.name); }).map(function (i) { return i.name; }).sort(), 8, function (folder) {
          var b = 'publications/' + proc + '/' + folder + '/', want = ['map.md', 'types.json', 'publication.json'];
          return Promise.all(want.map(function (n) { return statOf(b + n); })).then(function (sizes) { return { folder: folder, base: b, want: want, sizes: sizes }; });
        });
      });
      return (procCache[proc] = Promise.all([decisions, runMetas, pubMetas]).then(function (r) {
        var ds = r[0], total = 0, over = false;
        r[1].concat(r[2]).forEach(function (m) { m.sizes.forEach(function (z) { if (z == null) return; total += z; if (z > recordMax) over = true; }); });
        if (over || total > CTX_MAX) return { decisions: ds, groups: [], pubs: [], why: 'The runs and versions of ' + proc + ' are too big to read here (' + E.size(total) + '), so where its corrections stand can\'t be worked out.' };
        var runs = limited(r[1].filter(function (m) { return m.want.length; }), 8, function (m) {
          /* A run in the pack is read from its snapshot; any other only as text. */
          var read = function (n) { return selected[m.key] ? record(m.base + n).then(function (x) { return x.text == null ? null : x.text; }) : sizedText(m.base + n, recordMax).then(function (x) { return x.text == null ? null : x.text; }); };
          return Promise.all(m.want.map(read)).then(function (t) {
            /* Only a run in its own folder: a copy of one elsewhere would add its corrections again. */
            if (t[0] == null || !R.sanitize(json(t[0])) || elsewhere(json(t[0]), proc, m.key.split('/')[1])) return null;
            return build({ text: t[0], base: m.base, notes: t.slice(1), conflicts: [], fileHash: fileHash(t[0]), notesSig: '', unrunnable: '' }, null);
          });
        });
        /* Versions are read from snapshots: the files behind a claim are the very bytes in the pack. */
        var pubs = limited(r[2], 8, function (m) {
          return Promise.all(m.want.map(function (n) { return record(m.base + n); })).then(function (rs) {
            var files = {}, exact = {}; m.want.forEach(function (n, i) { files[n] = rs[i].text == null ? null : rs[i].text; });
            /* A /2 version by the SHA-256 of the exact bytes snapshotted for the pack, never its text. */
            ['map.md', 'types.json'].forEach(function (n) { var x = done[m.base + n]; if (x && !x.gone && x.sha256) exact[n] = x.sha256; });
            return { folder: m.folder, files: files, v: P.verify(m.folder, files, exact) };
          });
        });
        return Promise.all([runs, pubs]).then(function (x) {
          var pubList = x[1], verified = pubList.filter(function (p) { return p.v.ok; }).map(function (p) { return p.v; });
          return { decisions: ds, groups: C.forProcess(x[0].filter(Boolean), proc, ds.filter(function (y) { return y.d; }).map(function (y) { return y.d; }), P.index(verified)), pubs: pubList, why: '' };
        });
      }));
    }

    /* ---- one run: what goes in ---- */
    function planRun(key) {
      var k = key.split('/'), proc = k[0], id = k[1], base = 'runs/' + proc + '/' + id;
      var p = { key: key, process: proc, id: id, base: base, files: [], excl: [], listing: [], fuListing: [], decListing: [], repListing: [] };
      function add(path, cls) { if (!p.files.some(function (f) { return f.path === path; })) p.files.push({ path: path, role: cls.role, label: cls.label, flag: cls.flag || '' }); }
      return listFiles(base).then(function (items) {
        p.listing = names(items, base);
        p.items = items;
        return record(base + '/run.json');
      }).then(function (r) {
        var raw = r.text == null ? undefined : json(r.text);
        p.runOver = r.over;
        var lineage = raw && typeof raw === 'object' && Array.isArray(raw.lineage) ? raw.lineage.filter(function (t) { return typeof t === 'string'; }) : null;
        /* A run.json that names another run is packed as it is, but nothing is taken from it as this folder's run. */
        p.foreign = raw && typeof raw === 'object' ? elsewhere(raw, proc, id) : '';
        /* A test run's version is its stage (2.1), under staged/; any other run's, under publications/. */
        p.test = !p.foreign && !!raw && typeof raw === 'object' && raw.test === true && typeof raw.folder === 'string' && P.STAGE.test(raw.folder);
        p.folder = !p.foreign && raw && typeof raw === 'object' && typeof raw.folder === 'string' && (p.test || P.versionOf(raw.folder)) ? raw.folder : '';
        p.items.forEach(function (x) {
          var rel = x.path.slice(base.length + 1);
          if (x.kind === 'link') { p.excl.push({ path: x.path, reason: 'a link; Flightdeck never follows links' }); return; }
          var cls = E.classify(rel, lineage);
          if (cls.exclude) p.excl.push({ path: x.path, reason: cls.exclude });
          else add(x.path, cls);
        });
        /* What the files are, by the one checked reader: a run from a newer Flightdeck is packed as it is and labeled so; a
           replaced-*.json that is an older copy's placeholder (H10) is labeled a leftover holding no answers. The verdict only
           labels the originals; it never decides what goes in. */
        var cur = raw && typeof raw === 'object' ? R.sanitize(raw) : null;
        if (cur && cur._needs != null) p.files.forEach(function (f) { if (f.role === 'run') f.label = 'The run, made with ' + (cur._needs ? 'Flightdeck ' + cur._needs : 'a newer Flightdeck') + ': packed as it is'; });
        var replaced = p.files.filter(function (f) { return f.role === 'replaced'; });
        return Promise.all(replaced.map(function (f) { return record(f.path).then(function (x) { if (x.text != null && R.isPlaceholder(json(x.text), cur)) { f.role = 'leftover'; f.label = R.PLACEHOLDER; } }); })).then(function () {
        var notes = p.files.filter(function (f) { return f.role === 'notes'; });
        return Promise.all(notes.map(function (f) { return record(f.path).then(function (x) { return x.text == null ? null : x.text; }); })).then(function (t) {
          var ids = { corr: {}, fix: {} };
          t.forEach(function (x) { if (x != null) E.notesFile(x).notes.forEach(function (n) { if (n.note.kind === 'correction') ids.corr[n.note.id] = true; if (n.note.kind === 'fix' || n.note.kind === 'map') ids.fix[n.note.id] = true; }); });
          p.ids = ids;
          /* This run's own correction groups, from its own notes: a group's ID depends only on the correction, so a decision
             on the group belongs to the pack whatever else can be read. */
          var self = raw && !p.foreign ? R.sanitize(raw) : null;
          if (self) { self._notes = []; t.forEach(function (x) { if (x != null) E.notesFile(x).notes.forEach(function (n) { self._notes.push(cleanNote(n.note, base + '/')); }); }); }
          p.ownGroups = {};
          if (self) try { C.groups(C.collect([self], proc)).forEach(function (g) { p.ownGroups[g.id] = true; }); } catch (e) { /* a run this copy can't fully read has no groups to add */ }
        });
        });
      }).then(function () {
        /* Follow-up decisions on this run, OneDrive's copies of them, and any that can't be read. */
        return ro.list('followups/' + proc).then(function (items) {
          var mine = items.filter(function (i) { return i.kind === 'file' && i.name.indexOf(id + '.') === 0 && /\.json$/i.test(i.name); }).map(function (i) { return i.name; }).sort();
          p.fuListing = mine;
          return limited(mine, 8, function (n) {
            var path = 'followups/' + proc + '/' + n;
            return record(path, DEC_MAX).then(function (r) {
              var o = r.text == null ? undefined : json(r.text), d = o === undefined ? null : FU.cleanDecision(o, proc, n), loose = !d && o ? FU.cleanDecision(o, proc) : null;
              add(path, { role: 'followup', label: 'What became of a follow-up', flag: d ? '' : o === undefined ? 'couldn\'t be read; may relate to this run' : loose ? 'a copy of a decision under another name (OneDrive may have made it)' : 'isn\'t a decision this copy can read; may relate to this run' });
            });
          });
        });
      }).then(function () {
        /* Reports from tools on this run (copies included) and the decisions on them, each packed as it is; a report is a
           claim, not proof, and the manifest says which were accepted, by decision file and the hash accepted. */
        return evReportFiles(ro, proc, id).then(function (got) {
          p.repListing = got.listing;
          return limited(got.reports, 8, function (n) {
            var path = PF.reports.DIR + '/' + proc + '/' + n;
            return record(path, PF.reports.LIMITS.bytes).then(function (r) {
              var c = r.text == null ? null : PF.reports.clean(r.text, proc, n);
              add(path, { role: 'report', label: 'A tool\'s report: a claim, not proof', flag: c && c.ok ? '' : r.over ? 'too big to be a report' : 'couldn\'t be read as a report; may relate to this run' });
            });
          }).then(function () {
            return limited(got.decisions, 8, function (n) {
              var path = PF.reports.DDIR + '/' + proc + '/' + n;
              return record(path, DEC_MAX).then(function (r) {
                var o = r.text == null ? undefined : json(r.text), c = o === undefined ? null : PF.reports.cleanDecision(o, proc, n), d = c && c.ok ? c.d : null;
                add(path, d ? { role: 'report decision', label: d.status === 'accepted' ? 'A decision on a report: accepted ' + d.producer + '/' + d.report + ', sha256 ' + d.sha256 : d.status === 'declined' ? 'A decision on a report: declined' : 'A decision on a report: reopened' }
                  : { role: 'report decision', label: 'A decision on a report', flag: 'couldn\'t be read; may relate to this run' });
              });
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
            if (!d) { add(x.path, { role: x.dir === 'suggestions' ? 'suggestion' : 'correction', label: x.dir === 'suggestions' ? 'A decision on a suggested fix (before 1.13)' : 'A decision on corrections', flag: x.skipped ? 'not read: the pack reached the most it may hold in memory here' : 'couldn\'t be read; may relate to this run' }); return; }
            if (d.kind === 'fix-decision' ? p.ids.fix[d.suggestion] : ((d.members || []).some(function (m) { return p.ids.corr[m]; }) || mineGroups[d.group] || p.ownGroups[d.group]))
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
          /* Where its corrections stand couldn't be worked out: every one of them says so, and the pack is partial. */
          if (ctx.why) Object.keys(p.ids.corr).forEach(function (cid) { p.claims.push({ correction: cid, group: '', text: 'Where it stands', folder: '', why: ctx.why }); });
          return Promise.all(Object.keys(vers).map(function (folder) {
            var b = (p.test && folder === p.folder ? 'staged/' : 'publications/') + proc + '/' + folder;
            /* The version the run ran is its payload (2.0): the screenshots it lists. One its payload doesn't list still goes in,
               labeled as not part of the version. */
            var mine = vers[folder] === 'publication' ? record(b + '/publication.json').then(function (x) { var i = x.text != null ? json(x.text) : null; return i && typeof i === 'object' && !Array.isArray(i) && !P.newerOf(i) ? P.payloadFiles(i) : null; }) : Promise.resolve(null);
            return Promise.all([listFiles(b), mine]).then(function (both) {
              var items = both[0], listed = both[1];
              items.forEach(function (x) {
                if (x.kind === 'link') { p.excl.push({ path: x.path, reason: 'a link; Flightdeck never follows links' }); return; }
                var rel = x.path.slice(b.length + 1);
                if (vers[folder] === 'publication' && (['map.md', 'types.json', 'publication.json'].indexOf(rel) >= 0 || rel.indexOf('images/') === 0)) add(x.path, { role: 'publication', label: rel.indexOf('images/') !== 0 ? 'The version the run ran' : !listed || listed.indexOf(rel) >= 0 ? 'A screenshot in the version the run ran' : 'In the version\'s folder, but it isn\'t part of the version (its payload doesn\'t list it)' });
                else if (['map.md', 'types.json', 'publication.json'].indexOf(rel) >= 0) add(x.path, { role: 'proof', label: 'Backs up "Published in v' + P.versionOf(folder) + '"' });
              });
            });
          }));
        });
      }).then(function () {
        /* Sizes: attachments left out, or over the one-file limit, are listed with their size and never read. */
        return limited(p.files, 8, function (f) { return done[f.path] ? (f.size = done[f.path].gone ? null : done[f.path].statSize) : statOf(f.path).then(function (z) { f.size = z; }); }).then(function () {
          p.files = p.files.filter(function (f) {
            if (f.size == null) { p.changes = (p.changes || []).concat([{ path: f.path, what: f.path.split('/').pop() + ' was removed' }]); return false; }
            if (f.role === 'attachment' && !attachments) { p.excl.push({ path: f.path, reason: 'left out, not hashed', size: f.size }); return false; }
            if (maxFile && f.size > maxFile) { p.excl.push({ path: f.path, reason: 'over ' + E.size(maxFile) + ', the most one file can be in a pack made here', size: f.size }); return false; }
            return true;
          });
          return p;
        });
      });
    }

    /* ---- after collecting: did anything the pack holds change? ---- */
    /* Every run folder and decision folder listed again; every record in the pack read again and compared by SHA-256; every
       other file's size checked. Returns the paths that changed (and the runs whose listings did), with what happened. */
    function recheck() {
      var changed = {}, runsChanged = {};
      function note(path, what, key) { changed[path] = what; if (key) runsChanged[key] = (runsChanged[key] || []).concat([what]); }
      var inPack = {};
      plans.forEach(function (p) { p.files.forEach(function (f) { (inPack[f.path] = inPack[f.path] || []).push(p.key); }); });
      return plans.reduce(function (q, p) {
        return q.then(function () {
          stop();
          return listFiles(p.base).then(function (items) {
            var nowL = names(items, p.base);
            nowL.forEach(function (n) { if (p.listing.indexOf(n) < 0) note(p.base + '/' + n, n + ' was added', p.key); });
            p.listing.forEach(function (n) { if (nowL.indexOf(n) < 0) note(p.base + '/' + n, n + ' was removed', p.key); });
            return ro.list('followups/' + p.process);
          }).then(function (items) {
            var nowF = items.filter(function (i) { return i.kind === 'file' && i.name.indexOf(p.id + '.') === 0 && /\.json$/i.test(i.name); }).map(function (i) { return i.name; }).sort();
            if (nowF.join('/') !== p.fuListing.join('/')) note('followups/' + p.process, 'a follow-up decision was added or removed', p.key);
            return evReportFiles(ro, p.process, p.id).then(function (got) { if (got.listing.join('/') !== p.repListing.join('/')) note(PF.reports.DIR + '/' + p.process, 'a report or a decision on one was added or removed', p.key); });
          }).then(function () {
            return Promise.all(['corrections', 'suggestions'].map(function (dir) {
              return ro.list(dir + '/' + p.process).then(function (it) { return it.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return dir + '/' + p.process + '/' + i.name; }); });
            }));
          }).then(function (x) {
            if (x[0].concat(x[1]).sort().join('/') !== p.decListing.join('/')) note('corrections/' + p.process, 'a decision on corrections was added or removed', p.key);
            (p.changes || []).forEach(function (c) { note(c.path, c.what, p.key); });
          });
        });
      }, Promise.resolve()).then(function () {
        return limited(Object.keys(inPack), 8, function (path) {
          var s = done[path];
          if (!s || s.skipped) return null;
          if (decHash[path] && s.sha256 !== decHash[path]) { inPack[path].forEach(function (k) { note(path, path.split('/').pop() + ' changed', k); }); return null; }
          if (s.gone || s.size !== s.statSize) { inPack[path].forEach(function (k) { note(path, changeOf(path, s), k); }); return null; }
          return statOf(path).then(function (z) {
            if (z == null || z !== s.size) { inPack[path].forEach(function (k) { note(path, changeOf(path, { gone: z == null, size: z, statSize: s.size }), k); }); return; }
            if (s.text == null) return;
            /* A record: read again, and compared by its hash. */
            return ro.blob(path).then(null, function (e) { if (e && e.link) return null; throw e; }).then(function (b) {
              if (!b) { inPack[path].forEach(function (k) { note(path, path.split('/').pop() + ' was removed', k); }); return; }
              return hashBlob(b, false).then(function (r) { if (r.sha256 !== s.sha256) inPack[path].forEach(function (k) { note(path, path.split('/').pop() + ' changed', k); }); });
            });
          });
        });
      }).then(function () { return { changed: changed, runs: runsChanged }; });
    }

    /* ---- what the page says about one run ---- */
    function interpret(p) {
      var rc = { key: p.key, process: p.process, id: p.id, title: '', source: { runJson: null, listing: p.listing }, raw: null, run: null, map: null, notes: [], corrections: [], claims: [], checks: [], fuDecisions: [], limited: '' };
      var limits = [], rj = p.files.filter(function (f) { return f.path === p.base + '/run.json'; })[0];
      var raw = rj ? json(textOf(rj.path)) : undefined;
      if (!rj) { limits.push('run.json is missing, so only the other files are shown.'); col.unresolved.push(p.key + ': run.json is missing. The pack holds the other files in its folder.'); }
      else if (textOf(rj.path) == null) limits.push('run.json is too big to show here; it\'s in the pack as it is.');
      else if (raw === undefined) limits.push('run.json isn\'t complete JSON.');
      rc.raw = raw && typeof raw === 'object' ? raw : null;
      if (rj) rc.source.runJson = { rev: rc.raw && typeof rc.raw.rev === 'number' ? rc.raw.rev : null, sha256: rj.sha256 };
      var run = rc.raw && !p.foreign ? R.sanitize(rc.raw) : null;
      if (p.foreign) { limits.push('run.json ' + p.foreign + '. It\'s in the pack as it is.'); col.unresolved.push(p.key + ': run.json ' + p.foreign + '.'); }
      else if (rc.raw && !run) limits.push('run.json isn\'t a run this copy can read.');
      if (run && run._unrunnable) limits.push(run._unrunnable);
      if (run && run._badTimes) limits.push('Some times in run.json couldn\'t be read, so this page shows them as unknown; the original file has them as written.');
      rc.title = run ? run.title : rc.raw && typeof rc.raw.title === 'string' ? rc.raw.title.slice(0, 100) : '';
      var notes = [];
      p.files.filter(function (f) { return f.role === 'notes'; }).sort(function (a, b) { return a.path < b.path ? -1 : 1; }).forEach(function (f) {
        var t = textOf(f.path), nf = t == null ? { notes: [], malformed: [], lines: 0 } : E.notesFile(t); nf.file = f.path.split('/').pop(); rc.notes.push(nf);
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
      }
      if (p.ctx && p.ctx.why && Object.keys(p.ids.corr).length) { limits.push(p.ctx.why); col.unresolved.push(p.key + ': ' + p.ctx.why); }
      rc.fuDecisions = p.files.filter(function (f) { return f.role === 'followup'; }).map(function (f) { var o = json(textOf(f.path)); return o ? PF.followups.cleanDecision(o, p.process, f.path.split('/').pop()) : null; }).filter(Boolean);
      var pubTexts = {};
      var pdir = (p.test ? 'staged/' : 'publications/') + p.process + '/' + p.folder + '/';
      if (p.folder) ['map.md', 'types.json', 'publication.json'].forEach(function (n) { var path = pdir + n, x = p.files.some(function (f) { return f.path === path; }) ? textOf(path) : null; if (x != null) pubTexts[n] = x; });
      /* The version's screenshots, as snapshotted for the pack: their SHA-256, and their bytes when kept. */
      var pubShots = {};
      if (p.folder) { var pinfo = pubTexts['publication.json'] != null ? json(pubTexts['publication.json']) : null; if (pinfo && typeof pinfo === 'object' && !Array.isArray(pinfo) && !P.newerOf(pinfo) && pinfo.images && typeof pinfo.images === 'object') Object.keys(pinfo.images).forEach(function (src) {
        var path = pdir + src, x = done[path];
        if (x && !x.gone && x.sha256) pubShots[src] = { sha256: x.sha256, bytes: x.bytes ? E.join(x.bytes) : null };
      });
      /* The checklist's and step types' exact bytes, for a /2 version's payload. */
      ['map.md', 'types.json'].forEach(function (n) { var x = done[pdir + n]; if (x && !x.gone && x.sha256) pubShots['\u0000' + n] = { sha256: x.sha256 }; }); }
      rc.checks = E.checks(rc.raw, p.folder ? pubTexts : null, p.folder ? pubShots : null, p.test);
      rc.test = p.test;
      if (rc.raw && !p.folder) limits.push('The version it names isn\'t one this copy can find.');
      rc.claims = p.claims.map(function (c) {
        var proof = c.folder ? ['map.md', 'types.json', 'publication.json'].map(function (n) { return 'publications/' + p.process + '/' + c.folder + '/' + n; }) : [];
        var have = proof.length && proof.every(function (x) { return p.files.some(function (f) { return f.path === x; }) && done[x] && !done[x].gone; });
        var ok = !!have && !c.why;
        return { correction: c.correction, group: c.group, text: c.text, folder: c.folder, proof: proof, verified: ok, status: ok ? c.text : 'Can\'t be confirmed from this pack: ' + (c.why || 'the files of that version aren\'t all here.') };
      });
      rc.limited = limits.join(' ');
      return rc;
    }

    /* ---- the whole collection ---- */
    var plans = [], peopleOut = [];
    function exclusions() { var seen = {}; return plans.reduce(function (a, p) { return a.concat(p.excl); }, peopleOut.slice()).filter(function (x) { if (seen[x.path]) return false; seen[x.path] = true; return true; }); }
    /* Sizes alone, before any record is read: the run folders, as they'd go in (every save receipt counted), checked against
       the limits and the cap. */
    function preEstimate(keys) {
      var list = [];
      return keys.reduce(function (q, key) {
        return q.then(function () {
          stop();
          var k = key.split('/'), base = 'runs/' + k[0] + '/' + k[1];
          return listFiles(base).then(function (items) {
            var fl = items.filter(function (x) { return x.kind === 'file' && !/\.tmp$/i.test(x.path) && (attachments || !isAttachment(x.path)); });
            return limited(fl, 8, function (x) { return statOf(x.path).then(function (z) { if (z != null && !(maxFile && z > maxFile)) list.push({ path: x.path, size: z, role: isAttachment(x.path) ? 'attachment' : 'record' }); }); });
          });
        });
      }, Promise.resolve()).then(function () {
        var est = E.estimate(assignPacks(list), cap);
        if (!est.ok) throw new Error(est.why + ' Export fewer runs, or leave out attachments.');
        return keys;
      });
    }
    function planAll(keys) {
      plans = [];
      return keys.reduce(function (q, k) { return q.then(function () { stop(); return planRun(k).then(function (p) { plans.push(p); }); }); }, Promise.resolve());
    }
    function fileList() {
      var all = {}, list = [];
      plans.forEach(function (p) { p.files.forEach(function (f) { if (!all[f.path]) { all[f.path] = { path: f.path, size: f.size, role: f.role, label: f.label, flag: f.flag, runs: [] }; list.push(all[f.path]); } if (all[f.path].runs.indexOf(p.key) < 0) all[f.path].runs.push(p.key); }); });
      return list.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
    }
    /* The estimate, before anything else is read in full: refused here if it can't fit. */
    function fullEstimate() {
      var list = assignPacks(fileList()), est = E.estimate(list, cap);
      col.estimate = est.bytes || 0;
      col.exclusions = exclusions();
      if (!est.ok) throw new Error(est.why + ' Export fewer runs, or leave out attachments.');
      return list;
    }
    var keysAll = null;
    progress({ phase: 'list' });
    return runKeys().then(preEstimate).then(function (keys) {
      keysAll = keys; keys.forEach(function (k) { selected[k] = true; });
      return planAll(keys);
    }).then(function () {
      return sizedText(PF.people.FILE, PEOPLE_MAX).then(function (r) {
        if (r.missing) return;
        if (r.text != null) PF.people.clean(json(r.text)).forEach(function (x) { col.people[x.id] = x.name; });
        peopleOut = [{ path: PF.people.FILE, reason: 'The people directory and its email fields are left out.' + (r.text != null ? ' The page shows names and IDs from it.' : ' It was too big to read for names, so the page shows IDs.') }];
      });
    }).then(function () {
      var list = fullEstimate();
      if (opts.plan) { col.files = list; col.runs = plans.map(function (p) { return { key: p.key }; }); col.retained = { peak: retained.peak, limit: retained.limit }; return col; }
      var attempt = 1;
      function readAll() {
        var list = fileList(), n = 0;
        return list.reduce(function (q, f) { return q.then(function () { stop(); progress({ phase: 'read', done: ++n, total: list.length, path: f.path }); return snapshot(f.path); }); }, Promise.resolve());
      }
      function round() {
        return readAll().then(function () {
          progress({ phase: 'check' });
          return recheck();
        }).then(function (rc) {
          var paths = Object.keys(rc.changed);
          if (!paths.length) return [];
          if (attempt >= EV_TRIES) return Object.keys(rc.runs).map(function (k) { return { key: k, what: rc.runs[k] }; });
          /* Capture again what changed, and everything that depends on it: every run is planned again from the snapshots
             still valid, the process context worked out again. */
          attempt++;
          paths.forEach(function (pth) { forget(pth); delete decHash[pth]; });
          Object.keys(rc.runs).forEach(function (k) { var base = 'runs/' + k + '/'; Object.keys(done).forEach(function (pth) { if (pth.indexOf(base) === 0) forget(pth); }); });
          procCache = {}; decHash = {};
          /* Every attempt starts as the first did: sizes and the cap checked before anything new is read. */
          return preEstimate(keysAll).then(function () { return planAll(keysAll); }).then(fullEstimate).then(round);
        });
      }
      return round().then(function (left) {
        col.attempts = attempt;
        col.unresolved = undated.slice();
        left.forEach(function (x) { var w = x.what.filter(function (v, i, a) { return a.indexOf(v) === i; }); col.unresolved.push('The run changed while this pack was made: ' + w.join(', ') + '.' + (plans.length > 1 ? ' (' + x.key + ')' : '')); });
        col.exclusions = exclusions();
        var skipped = fileList().filter(function (f) { return done[f.path] && done[f.path].skipped; });
        skipped.forEach(function (f) { col.exclusions.push({ path: f.path, reason: 'not read: the pack reached the most it may hold in memory here (' + E.size(retained.limit) + ')', size: done[f.path].statSize }); });
        if (skipped.length) col.unresolved.push('The pack reached the most it may hold in memory here (' + E.size(retained.limit) + '), so ' + skipped.length + ' file' + (skipped.length === 1 ? ' wasn\'t' : 's weren\'t') + ' read. They\'re listed as left out. Export fewer runs, or leave out attachments.');
        col.retained = { peak: retained.peak, limit: retained.limit };
        /* A file still gone after the last attempt is named in unresolved, never packed. */
        col.files = assignPacks(fileList().filter(function (f) { return done[f.path] && !done[f.path].gone && !done[f.path].skipped; })).map(function (f) {
          var s = done[f.path];
          return Object.assign(f, { size: s.size, sha256: s.sha256, crc: s.crc, bytes: s.bytes, image: s.image || '' });
        });
        col.runs = plans.map(interpret);
        col.endedAt = new Date(now()).toISOString();
        col.status = col.unresolved.length ? 'partial' : 'complete';
        return col;
      });
    });
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

  return { loadProposed: loadProposed, loadProposedOne: loadProposedOne, loadProposalSet: loadProposalSet, readProposal: readProposal, listRecords: listRecords, writeRecord: writeRecord, loadPresence: loadPresence, writePresence: writePresence, removePresence: removePresence, cleanPresence: cleanPresence,
    readOnly: readOnlyView, ledger: ledger, fileHash: fileHash, groupPlans: groupPlans, readPlans: readPlans, readProcess: readProcess, loadRegistrations: loadRegistrations, loadLegacySkills: loadLegacySkills, runMismatch: runMismatch, pubProblem: pubProblem, readRunOnly: readRunOnly, decisionTexts: decisionTexts, collectEvidence: collectEvidence, exportEvidence: exportEvidence, poolOf: poolOf, lane: bounded, runSig: runSig, historyDir: historyDir, appendHistory: appendHistory, loadEditHistory: loadEditHistory, config: config, loadStepTypes: loadStepTypes, saveDraft: saveDraft, applyCorrection: applyCorrection, decideFollowUp: decideFollowUp, decideReport: decideReport, loadDecisionsOn: loadDecisionsOn, loadRunReports: loadRunReports, loadReportNames: loadReportNames, loadReportDecisions: loadReportDecisions, rereadReport: rereadReport, readReport: readReport, saveStepType: saveStepType, recordValidation: recordValidation, recordStageValidation: recordStageValidation, signOffStage: signOffStage, stageCarried: stageCarried, savePeople: savePeople, writeTest: writeTest, loadAnswers: loadAnswers, loadAll: loadAll, loadRun: loadRun, loadHistory: loadHistory, readCopy: readCopy, removeCopy: removeCopy, keepDisplaced: keepDisplaced, saveRun: saveRun, addNote: addNote, saveAttachment: saveAttachment, saveShot: saveShot, publish: publish, stage: stage, readStage: readStage, loadStaged: loadStaged, promote: promote, decideStage: decideStage, startTestRun: startTestRun, savePlan: savePlan, recordPlanStatus: recordPlanStatus, decidePlan: decidePlan, resumeStart: resumeStart, decideCorrection: decideCorrection, scan: scan, loadConnection: loadConnection, sendProbe: sendProbe, sendAck: sendAck, cleanConnection: cleanConnection };
})();
