/* The team folder: reading everything, saving runs safely, publishing maps. See docs/design.md section 4. */
PF.repo = (function () {
  'use strict';
  var U = PF.util, P = PF.publish, R = PF.run;

  function json(text) { try { return JSON.parse(text); } catch (e) { return undefined; } }
  function readJson(fs, path) { return fs.read(path).then(function (f) { return f ? json(f.text) : null; }); }

  function loadPeople(fs) {
    return readJson(fs, 'people.json').then(function (o) {
      var list = Array.isArray(o) ? o : o && Array.isArray(o.people) ? o.people : [];
      return list.filter(function (p) { return p && typeof p.id === 'string' && typeof p.name === 'string'; }).map(function (p) {
        return { id: p.id, name: p.name.slice(0, 60), initials: String(p.initials || p.name.split(/\s+/).map(function (w) { return w[0]; }).join('')).slice(0, 3).toUpperCase(), email: String(p.email || ''), inactive: !!p.inactive };
      });
    });
  }

  function loadDrafts(fs) {
    return fs.list('maps/drafts').then(function (items) {
      return Promise.all(items.filter(function (i) { return i.kind === 'file' && /\.md$/i.test(i.name); }).map(function (i) {
        return fs.read('maps/drafts/' + i.name).then(function (f) { return f ? { file: i.name, md: f.text, mtime: f.mtime } : null; });
      }));
    }).then(function (x) { return x.filter(Boolean); });
  }

  /* What's already been read from a folder. Complete publications never change, and ended runs rarely do, so routine refreshes
     skip them; a deep refresh (the Refresh button) reads everything again. */
  var caches = typeof WeakMap === 'function' ? new WeakMap() : null;
  function cacheOf(fs) { if (!caches) return { pubs: {}, ended: {}, notes: {} }; var c = caches.get(fs); if (!c) { c = { pubs: {}, ended: {}, notes: {} }; caches.set(fs, c); } return c; }
  /* Run at most n reads at once, so a folder with hundreds of runs doesn't flood OneDrive or the browser. */
  function limited(items, n, fn) {
    var out = new Array(items.length), i = 0;
    function next() { if (i >= items.length) return Promise.resolve(); var k = i++; return Promise.resolve(fn(items[k], k)).then(function (v) { out[k] = v; return next(); }); }
    var workers = []; for (var w = 0; w < Math.min(n, items.length); w++) workers.push(next());
    return Promise.all(workers).then(function () { return out; });
  }

  function loadPublications(fs, cache, deep) {
    return fs.list('publications').then(function (procs) {
      return Promise.all(procs.filter(function (p) { return p.kind === 'dir'; }).map(function (p) {
        return fs.list('publications/' + p.name).then(function (vers) {
          return Promise.all(vers.filter(function (v) { return v.kind === 'dir' && P.versionOf(v.name); }).map(function (v) {
            var base = 'publications/' + p.name + '/' + v.name + '/';
            if (!deep && cache.pubs[base]) return cache.pubs[base];
            return Promise.all(['map.md', 'types.json', 'publication.json'].map(function (n) { return fs.read(base + n); })).then(function (r) {
              var res = P.verify(v.name, { 'map.md': r[0] && r[0].text, 'types.json': r[1] && r[1].text, 'publication.json': r[2] && r[2].text });
              res.folder = v.name; res.process = p.name;
              return checkImages(fs, base, res).then(function (res) { if (res.ok) cache.pubs[base] = res; else delete cache.pubs[base]; return res; });
            });
          }));
        }).then(function (pubs) { return { process: p.name, pubs: pubs, index: P.index(pubs) }; });
      }));
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
      return limited([].concat.apply([], nested), 8, function (key) {
        var hit = cache.ended[key], proc = key.split('/')[0], id = key.split('/')[1];
        /* An ended run is reread only if a file in it arrived, left, or changed size or time (a late note, a conflict copy). */
        if (!deep && hit) return fingerprint(fs, 'runs/' + key).then(function (fp) { return fp === hit.fp && !(hit.run._recheckAt && Date.now() >= hit.run._recheckAt) ? hit.run : fresh(); });
        return fresh();
        /* Fingerprint before and after reading: the run is cached only if nothing changed in between, so a cached copy
           always matches the fingerprint it's checked against. */
        function fresh() {
          var before;
          return fingerprint(fs, 'runs/' + key).then(function (fp) { before = fp; return loadRun(fs, proc, id, cache, deep); })
            .then(function (run) {
              return fingerprint(fs, 'runs/' + key).then(function (after) {
                if (run && run.ended && after === before) cache.ended[key] = { run: run, fp: after }; else delete cache.ended[key];
                return run;
              });
            });
        }
      });
    }).then(function (runs) { return runs.filter(Boolean); });
  }
  /* Names, sizes and times of the files directly in a run folder: cheap to get, and different whenever anything in it changed. */
  function fingerprint(fs, dir) {
    return fs.list(dir).then(function (items) {
      var files = items.filter(function (i) { return i.kind === 'file'; }).map(function (i) { return i.name; }).sort();
      if (!fs.stat) return files.join('/');
      return Promise.all(files.map(function (n) { return fs.stat(dir + '/' + n).then(function (st) { return n + ':' + (st ? st.size + ':' + st.mtime : '-'); }); })).then(function (x) { return x.join('/'); });
    });
  }

  function loadRun(fs, proc, id, cacheIn, deep) {
    var base = 'runs/' + proc + '/' + id + '/';
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
      return Promise.all([fs.read(base + 'run.json')].concat(noteFiles.map(readNotes))).then(function (res) {
        var run = res[0] && R.sanitize(json(res[0].text));
        if (!run) return null;
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
    var files = Array.isArray(n.files) ? n.files.filter(function (f) { return typeof f === 'string' && f.indexOf(base + 'files/') === 0 && /^[\w.@\/-]+$/.test(f) && f.indexOf('..') < 0; }) : [];
    var c = { id: n.id.slice(0, 40), at: typeof n.at === 'string' ? n.at : '', by: typeof n.by === 'string' ? n.by.slice(0, 80) : '', session: typeof n.session === 'string' ? n.session.slice(0, 40) : '',
      step: typeof n.step === 'string' ? n.step.slice(0, 60) : '', text: n.text.slice(0, 2000), files: files, kind: n.kind === 'map' || n.kind === 'fix' ? n.kind : undefined };
    return n.kind === 'fix' ? Object.assign(c, PF.fixes.cleanNote(n)) : c;
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

  function loadAll(fs, opts) {
    var cache = cacheOf(fs), deep = !!(opts && opts.deep);
    return Promise.all([loadPeople(fs), loadDrafts(fs), loadPublications(fs, cache, deep), loadRuns(fs, cache, deep), loadLegacy(fs),
      loadSkills(fs),
      loadJsonDir(fs, 'proposals', function (o) { return o.kind === 'plan' || o.kind === 'status'; }),
      loadStepTypes(fs), loadWorkflows(fs),
      loadJsonDir(fs, 'validations', function (o) { return o.kind === 'validation' && typeof o.process === 'string' && typeof o.folder === 'string' && typeof o.by === 'string' && typeof o.at === 'string'; }),
      loadFixDecisions(fs)
    ]).then(function (r) {
      /* Sign-offs are read as plain strings and numbers only, so odd values in a file can't break a page. */
      r[9] = r[9].map(function (v) { return { kind: 'validation', process: v.process.slice(0, 60), folder: v.folder.slice(0, 60), by: v.by.slice(0, 80), at: v.at.slice(0, 40), version: typeof v.version === 'number' && isFinite(v.version) ? v.version : 0, note: typeof v.note === 'string' ? v.note.slice(0, 300) : '', _file: v._file }; });
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
      return { people: r[0], drafts: r[1], processes: r[2], runs: r[3], legacy: r[4], skills: r[5], validations: r[9], fixDecisions: r[10].filter(function (d) { return !d._unread; }), fixUnread: r[10].filter(function (d) { return d._unread; }), plans: plans, stepTypes: r[7], jira: r[8], readAt: new Date().toISOString() };
    });
  }
  /* Decisions on suggested fixes: suggestions/<process>/<suggestion>.<writer>.json, one small file per person's window and
     suggestion. They're few and tiny, so each refresh reads them all (at most 8 at once). A file that can't be read is
     reported in fixUnread, never dropped, so its suggestion doesn't quietly look open again. */
  function loadFixDecisions(fs) {
    return fs.list('suggestions').then(function (procs) {
      return Promise.all(procs.filter(function (p) { return p.kind === 'dir' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(p.name); }).map(function (p) {
        return fs.list('suggestions/' + p.name).then(function (items) { return items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).map(function (i) { return { process: p.name, name: i.name }; }); });
      }));
    }).then(function (nested) {
      return limited([].concat.apply([], nested), 8, function (x) {
        var unread = { _unread: true, process: x.process, _file: x.name };
        /* A file that's missing now was removed; one that won't read, parse or check (a half-synced write) is unread. */
        return fs.read('suggestions/' + x.process + '/' + x.name).then(function (f) { if (!f) return null; var d = PF.fixes.cleanDecision(json(f.text), x.process); if (!d) return unread; d._file = x.name; return d; }, function () { return unread; });
      });
    }).then(function (list) { return list.filter(Boolean); });
  }
  /* A person's decision on a suggestion, in their window's own file for that suggestion (a later decision replaces only their own). */
  function decideFix(fs, rec, writer) {
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(rec.process) || !/^[\w-]{1,40}$/.test(rec.suggestion) || !/^[\w-]{1,40}$/.test(writer)) return Promise.reject(new Error('That suggestion can\'t be decided here.'));
    return fs.write('suggestions/' + rec.process + '/' + rec.suggestion + '.' + writer + '.json', JSON.stringify(rec, null, 2) + '\n');
  }
  /* Team step types: step-types/<id>.json. Each file is checked; good ones are usable, bad ones are listed with their problems. */
  function loadStepTypes(fs) {
    return fs.list('step-types').then(function (items) {
      return Promise.all(items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).slice(0, 100).map(function (i) {
        return fs.read('step-types/' + i.name).then(function (f) { var o = f && json(f.text); return { file: i.name, def: o, errors: o === undefined ? ['isn\'t valid JSON'] : PF.types.checkCustom(o) }; });
      }));
    }).then(function (list) {
      var types = {}, errors = [];
      list.forEach(function (x) {
        if (!x.errors.length && x.file !== x.def.id + '.json') x.errors.push('the file name must be ' + x.def.id + '.json');
        if (!x.errors.length && types[x.def.id]) x.errors.push('another file already defines ' + x.def.id);
        if (!x.errors.length) { try { types[x.def.id] = PF.types.customType(x.def); } catch (e) { x.errors.push('couldn\'t be read as a step type'); } }
        if (x.errors.length) errors.push({ file: x.file, errors: x.errors });
      });
      return { types: types, errors: errors };
    });
  }
  /* Skill registrations, one file at a time: a file that can't be read, isn't JSON or isn't an object is listed with why. */
  function loadSkills(fs) {
    return fs.list('skills').then(function (items) {
      return Promise.all(items.filter(function (i) { return i.kind === 'file' && /\.json$/i.test(i.name); }).slice(0, 500).map(function (i) {
        var bad = function (why) { return { skill: null, errors: ['skills/' + i.name + ': ' + why], file: i.name }; };
        return fs.read('skills/' + i.name).then(function (f) {
          if (!f) return bad('couldn\'t be read');
          var o = json(f.text);
          if (o === undefined) return bad('isn\'t valid JSON');
          if (!o || typeof o !== 'object' || Array.isArray(o)) return bad('must be a JSON object');
          try { var c = PF.skills.check(o, i.name); c.file = i.name; return c; } catch (e) { return bad('couldn\'t be read as a skill registration'); }
        }, function () { return bad('couldn\'t be read'); });
      }));
    });
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
    /* The check and the write happen together: with opts.lock (the browser's Web Locks), windows on this computer save a run one
       at a time, so a second window always sees the first one's save and keeps its own change as a conflict copy. */
    if (opts.lock) return opts.lock('preflight:run:' + run.process + '/' + run.id, function () { return checkAndWrite(); });
    return checkAndWrite();
    function checkAndWrite() {
    return fs.read(path).then(function (f) {
      var e;
      if (f) {
        var disk = R.sanitize(json(f.text));
        if (!disk) { e = new Error('The run file is unreadable, so it wasn\'t overwritten.'); e.unreadable = true; throw e; }
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
          return cleanCandidates(fs, dir, copy.lineage).then(function () { return copy.savedAt; });
        }, function (e) { return fs.remove(cand).then(function () { throw e; }, function () { throw e; }); });
    });
    }
  }
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
  function saveAttachment(fs, run, blob, session) {
    var ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob.type];
    if (!ext) return Promise.reject(new Error('Use a PNG, JPEG or WebP image.'));
    var path = 'runs/' + run.process + '/' + run.id + '/files/' + Date.now() + '-' + U.randomId(6) + '-' + session + '.' + ext;
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
     "doesn't exist yet"). If someone (a person or an LLM) changed it meanwhile, nothing is written and their version comes
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
  function saveStepType(fs, def, expect, opts) {
    var errs = PF.types.checkCustom(def);
    if (errs.length) return Promise.reject(new Error(errs[0]));
    return saveChecked(fs, 'step-types/' + def.id + '.json', JSON.stringify(def, null, 2) + '\n', expect, opts);
  }
  /* A person's sign-off that a published version is ready for a skill, in their window's own file. */
  function recordValidation(fs, pub, session, by, note, evidence) {
    var rec = { kind: 'validation', process: pub.map.meta.process, version: pub.info.version, folder: pub.info.folder, by: by, at: new Date().toISOString(), note: String(note || '').slice(0, 300), evidence: evidence };
    return fs.write('validations/' + pub.map.meta.process + '.v' + pub.info.version + '.' + session + '.json', JSON.stringify(rec, null, 2));
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

  return { config: config, loadStepTypes: loadStepTypes, saveDraft: saveDraft, saveStepType: saveStepType, recordValidation: recordValidation, loadAll: loadAll, loadRun: loadRun, loadHistory: loadHistory, readCopy: readCopy, removeCopy: removeCopy, keepDisplaced: keepDisplaced, saveRun: saveRun, addNote: addNote, saveAttachment: saveAttachment, publish: publish, savePlan: savePlan, recordPlanStatus: recordPlanStatus, decideFix: decideFix };
})();
