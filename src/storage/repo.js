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
  function cacheOf(fs) { if (!caches) return { pubs: {}, ended: {}, notes: {}, approved: {}, bad: {} }; var c = caches.get(fs); if (!c) { c = { pubs: {}, ended: {}, notes: {}, approved: {}, bad: {} }; caches.set(fs, c); } return c; }
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

  function loadRuns(fs, cache, deep) {
    return fs.list('runs').then(function (procs) {
      return Promise.all(procs.filter(function (p) { return p.kind === 'dir'; }).map(function (p) {
        return fs.list('runs/' + p.name).then(function (items) { return items.filter(function (i) { return i.kind === 'dir'; }).map(function (i) { return p.name + '/' + i.name; }); });
      }));
    }).then(function (nested) {
      /* One limit across every process, so a folder with hundreds of runs never has more than 8 being read at once. */
      var unreadable = [];
      return limited([].concat.apply([], nested), 8, function (key) {
        var hit = cache.ended[key], proc = key.split('/')[0], id = key.split('/')[1];
        /* One run that can't be read (a placeholder OneDrive hasn't downloaded, a file being replaced) is listed as unreadable;
           the rest of the folder still loads. */
        return go().then(null, function (e) { delete cache.ended[key]; unreadable.push({ path: 'runs/' + key + '/run.json', key: key, why: why(e) }); return null; });
        function go() {
        /* An ended run is reread only if a file in it arrived, left, or changed size or time (a late note, a conflict copy). */
        if (!deep && hit) return fingerprint(fs, 'runs/' + key).then(function (fp) { return fp === hit.fp && !(hit.run._recheckAt && Date.now() >= hit.run._recheckAt) ? hit.run : fresh(); });
        return fresh();
        }
        /* Fingerprint before and after reading: the run is cached only if nothing changed in between, so a cached copy
           always matches the fingerprint it's checked against. */
        function fresh() {
          var before;
          return fingerprint(fs, 'runs/' + key).then(function (fp) { before = fp; return loadRun(fs, proc, id, cache, deep, true, unreadable); })
            .then(function (run) {
              return fingerprint(fs, 'runs/' + key).then(function (after) {
                if (run && run.ended && after === before) cache.ended[key] = { run: run, fp: after }; else delete cache.ended[key];
                return run;
              });
            });
        }
      }).then(function (runs) { return { runs: runs.filter(Boolean), unreadable: unreadable }; });
    });
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
    cacheIn = cacheIn || cacheOf(fs); fs = bounded(fs);
    var base = 'runs/' + proc + '/' + id + '/';
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
      var notesCache = (cacheIn || cacheOf(fs)).notes;
      function same(a, b) { return !!a && !!b && a.size === b.size && a.mtime === b.mtime; }
      function readNotes(n) {
        var path = base + n, hit = notesCache[path];
        if (!fs.stat) return fs.read(path);
        return fs.stat(path).then(function (st) {
          if (!deep && hit && same(hit, st)) return hit.file;
          /* Cached only when the file didn't change while it was being read; otherwise it's read again next time. */
          return fs.read(path).then(function (f) {
            return fs.stat(path).then(function (st2) { if (f && same(st, st2)) notesCache[path] = { size: st2.size, mtime: st2.mtime, file: f }; else delete notesCache[path]; return f; });
          });
        });
      }
      return Promise.all([fs.read(base + 'run.json')].concat(noteFiles.map(readNotes))).then(withPublication).then(function (res) {
        var run = res[0] && R.sanitize(json(res[0].text));
        if (!run) { if (res[0] && bad) bad.push({ path: base + 'run.json', key: proc + '/' + id, why: json(res[0].text) === undefined ? 'isn\'t complete JSON (it may still be arriving)' : 'isn\'t a run this copy can read' }); return null; }
        /* A run started by a newer copy on a version in a publication format this copy doesn't know is read-only, even when
           its own copy of the checklist happens to read. */
        if (!run._unrunnable && res.pubProblem) run._unrunnable = res.pubProblem;
        run._path = base; run._mtime = res[0].mtime; run._conflicts = extra; run._fileHash = U.hash(res[0].text);
        var notes = [];
        res.slice(1).forEach(function (f) {
          if (!f) return;
          f.text.split('\n').forEach(function (line) { var n = line.trim() && json(line); if (n && typeof n.text === 'string' && typeof n.id === 'string') notes.push(cleanNote(n, base)); });
        });
        run._notes = notes.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
        /* A candidate whose save isn't listed in run.json, and that's old enough not to be a save still in progress, was
           overwritten by another window or computer: it's offered like any other conflict copy. */
        var lineage = run.lineage || [], lost = names.filter(function (n) { var t = candidateTag(n); return t && lineage.indexOf(t) < 0; });
        if (!lost.length) return run;
        var now = Date.now(), current = sameRun(res[0].text);
        return Promise.all(lost.map(function (n) {
          var age = fs.stat ? fs.stat(base + n).then(function (st) { return st ? st.mtime : now; }, function () { return now; }) : Promise.resolve(0);
          return age.then(function (mtime) {
            /* Still within the grace period: maybe a save in progress. Check again once it's old enough (finished runs too). */
            if (now - mtime < config.candidateGraceMs) { var at = mtime + config.candidateGraceMs; run._recheckAt = run._recheckAt ? Math.min(run._recheckAt, at) : at; return null; }
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
            if (!old.length || !extra.length) { run._conflicts = run._conflicts.concat(old); return run; }
            /* A lost save that OneDrive already kept as its own conflict copy is listed once, not twice. */
            return Promise.all(extra.concat(old).map(function (n) { return fs.read(base + n).then(function (f) { return f ? f.text : '\u0000' + n; }, function () { return '\u0000' + n; }); })).then(function (h) {
              var known = h.slice(0, extra.length);
              run._conflicts = run._conflicts.concat(old.filter(function (n, i) { return known.indexOf(h[extra.length + i]) < 0; }));
              return run;
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
  function bounded(fs) {
    if (fs._bounded) return fs;
    var go = pool(8), b = Object.create(fs);
    ['list', 'read', 'stat', 'blob'].forEach(function (m) { if (typeof fs[m] === 'function') b[m] = function (p) { return go(function () { return fs[m](p); }); }; });
    b._bounded = true;
    return b;
  }
  function loadAll(fs, opts) {
    var cache = cacheOf(fs); fs = bounded(fs); var deep = !!(opts && opts.deep), failed = {}, errs = [];
    var EMPTY = [[], [], [], { runs: [], unreadable: [] }, [], [], [], { types: {}, errors: [], skipped: 0 }, { workflows: null, errors: [] }, [], [], []];
    /* The folder itself must list: one that can't is unreadable, never empty. */
    return fs.list('').then(function () { return Promise.all([loadPeople(fs), loadDrafts(fs), loadPublications(fs, cache, deep), loadRuns(fs, cache, deep), loadLegacy(fs),
      loadSkills(fs),
      loadJsonDir(fs, 'proposals', function (o) { return o.kind === 'plan' || o.kind === 'status'; }),
      loadStepTypes(fs), loadWorkflows(fs),
      loadJsonDir(fs, 'validations', function (o) { return o.kind === 'validation' && typeof o.process === 'string' && typeof o.folder === 'string' && typeof o.by === 'string' && typeof o.at === 'string'; }),
      loadCorrectionDecisions(fs),
      loadFollowUpDecisions(fs)
    ].map(function (p, i) { return p.then(null, function (e) { failed[PARTS[i]] = e && e.message || String(e); errs.push(e); return EMPTY[i]; }); })); }).then(function (r) {
      if (errs.length === PARTS.length) throw errs[0];
      var unreadable = r[3].unreadable.concat(r[1].unreadable || []);
      r[3] = r[3].runs;
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
      r[3].forEach(function (run) { var bad = cache.bad && cache.bad['publications/' + run.process + '/' + run.folder + '/']; if (bad && !run._unrunnable) run._unrunnable = bad; });
      return { people: r[0], drafts: r[1], processes: r[2], runs: r[3], legacy: r[4], skills: r[5], validations: r[9], corrDecisions: r[10].filter(function (d) { return !d._unread; }), corrUnread: r[10].filter(function (d) { return d._unread; }),
        fuDecisions: r[11].filter(function (d) { return !d._unread; }), fuUnread: r[11].filter(function (d) { return d._unread; }), plans: plans, stepTypes: r[7], jira: r[8],
        unreadable: unreadable, failed: failed, skillsSkipped: r[5].skipped || 0, readAt: new Date().toISOString() };
    });
  }
  /* Decisions on corrections: corrections/<process>/<group>.<writer>.<rev>.json, each written once. Decisions on suggested
     fixes from before 1.13 (suggestions/<process>/<suggestion>.<writer>.json) are read too. They're few and tiny, so each
     refresh reads them all (at most 8 at once). A file that can't be read is reported in corrUnread, never dropped, so its
     group doesn't quietly look open again. */
  function loadCorrectionDecisions(fs) {
    var dirs = ['corrections', 'suggestions'];
    return Promise.all(dirs.map(function (dir) {
      return fs.list(dir).then(function (procs) {
        return Promise.all(procs.filter(function (p) { return p.kind === 'dir' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(p.name); }).map(function (p) {
          return fs.list(dir + '/' + p.name).then(function (items) { return items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return { dir: dir, process: p.name, name: i.name }; }); });
        }));
      });
    })).then(function (nested) {
      var all = [].concat.apply([], [].concat.apply([], nested));
      return limited(all, 8, function (x) {
        var unread = { _unread: true, dir: x.dir, process: x.process, _file: x.name };
        /* A file that's missing now was removed; one that won't read, parse or check (a half-synced write) is unread. */
        return fs.read(x.dir + '/' + x.process + '/' + x.name).then(function (f) {
          if (!f) return null;
          var d = PF.corrections.cleanDecision(json(f.text), x.process);
          if (!d || (x.dir === 'suggestions') !== (d.kind === 'fix-decision')) return unread;
          d._file = x.name; d._dir = x.dir; return d;
        }, function () { return unread; });
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
     decided. run.json never changes. Like corrections' decisions, they're few and tiny, so each refresh reads them all; a file
     that can't be read is reported in fuUnread, never dropped, so its follow-up doesn't quietly look open again. */
  function loadFollowUpDecisions(fs) {
    return fs.list('followups').then(function (procs) {
      return Promise.all(procs.filter(function (p) { return p.kind === 'dir' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(p.name); }).map(function (p) {
        return fs.list('followups/' + p.name).then(function (items) { return items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return { process: p.name, name: i.name }; }); });
      }));
    }).then(function (nested) {
      return limited([].concat.apply([], nested), 8, function (x) {
        var unread = { _unread: true, dir: 'followups', process: x.process, _file: x.name };
        /* Each file on its own: one that won't read, parse or check is listed as unreadable, never a reason to drop the rest. */
        return fs.read('followups/' + x.process + '/' + x.name).then(function (f) {
          if (!f) return null;
          try { return PF.followups.cleanDecision(json(f.text), x.process, x.name) || unread; } catch (e) { return unread; }
        }).then(null, function () { return unread; });
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
  function saveRun(fs, run, session, opts) {
    opts = opts || {};
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
            .then(function () { e.keptAs = keep; throw e; }, function () { throw e; });
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
  var config = { candidateGraceMs: 60000 };
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
      files.forEach(function (f) { if (f) f.text.split('\n').forEach(function (line) { var x = line.trim() && json(line); if (x && x.at && !(x.id && seen[x.id])) { if (x.id) seen[x.id] = 1; out.push(x); } }); });
      return out.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
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

  return { historyDir: historyDir, appendHistory: appendHistory, loadEditHistory: loadEditHistory, config: config, loadStepTypes: loadStepTypes, saveDraft: saveDraft, applyCorrection: applyCorrection, decideFollowUp: decideFollowUp, saveStepType: saveStepType, recordValidation: recordValidation, savePeople: savePeople, writeTest: writeTest, loadAnswers: loadAnswers, loadAll: loadAll, loadRun: loadRun, loadHistory: loadHistory, readCopy: readCopy, removeCopy: removeCopy, keepDisplaced: keepDisplaced, saveRun: saveRun, addNote: addNote, saveAttachment: saveAttachment, publish: publish, savePlan: savePlan, recordPlanStatus: recordPlanStatus, decideCorrection: decideCorrection, scan: scan, loadConnection: loadConnection, sendProbe: sendProbe, sendAck: sendAck, cleanConnection: cleanConnection };
})();
