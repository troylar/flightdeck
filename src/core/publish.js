/* Publishing: freeze a draft map plus the step types it uses into an immutable, numbered version. */
PF.publish = (function () {
  'use strict';
  var U = PF.util, M = PF.map, T = PF.types;

  /* Each publish gets its own folder (v5-k3m9p2q8), so two people publishing at once never write the same files. */
  function folderName(version, rand) { return 'v' + version + '-' + (rand || U.randomId(8)); }
  function versionOf(folder) { var m = /^v(\d+)-[a-z0-9]+$/.exec(folder); return m ? +m[1] : null; }

  function nextVersion(existing) {
    var max = 0;
    (existing || []).forEach(function (p) { if (p.version > max) max = p.version; });
    return max + 1;
  }

  /* Returns { folder, files } or { blockers }. */
  function build(draftMd, opts) {
    var map = M.parse(draftMd), c = M.check(map, { people: opts.people, types: opts.customTypes, workflows: opts.workflows, processes: opts.processes });
    if (c.blockers.length) return { blockers: c.blockers };
    if (!opts.by) return { blockers: ['Choose who you are before publishing.'] };
    var changes = String(opts.changes || '').trim();
    if (!changes) return { blockers: ['Write a one-line change note.'] };
    var version = nextVersion(opts.existing), folder = folderName(version, opts.rand);
    var types = T.freeze(M.usedTypes(map), opts.customTypes);
    var typesJson = JSON.stringify(types, null, 2);
    var info = {
      format: 'preflight-publication/1', process: map.meta.process, title: map.meta.title, version: version, folder: folder,
      publishedBy: opts.by, publishedAt: opts.now, changes: changes.slice(0, 200),
      mapHash: U.hash(draftMd), typesHash: U.hash(typesJson)
    };
    /* Reference screenshots copied into this version, each with a fingerprint, so a version is complete only when they've all arrived intact. */
    info.images = opts.images || {};
    return { folder: folder, version: version, files: { 'map.md': draftMd, 'types.json': typesJson, 'publication.json': JSON.stringify(info, null, 2) } };
  }

  /* A publication is usable only when all three files arrived and match. Anything else is "still syncing" or damaged. */
  function verify(folder, files) {
    var info = null;
    try { info = files['publication.json'] ? JSON.parse(files['publication.json']) : null; } catch (e) { return { ok: false, why: 'publication.json is unreadable.' }; }
    if (!info) return { ok: false, why: 'Still syncing: publication.json hasn\'t arrived.' };
    if (files['map.md'] == null || files['types.json'] == null) return { ok: false, why: 'Still syncing: some files haven\'t arrived.', info: info };
    if (U.hash(files['map.md']) !== info.mapHash || U.hash(files['types.json']) !== info.typesHash) return { ok: false, why: 'Files don\'t match their publication record. Still syncing, or edited by hand.', info: info };
    if (info.folder !== folder || versionOf(folder) !== info.version) return { ok: false, why: 'Folder name doesn\'t match the publication record.', info: info };
    var types; try { types = JSON.parse(files['types.json']); } catch (e) { return { ok: false, why: 'types.json is unreadable.', info: info }; }
    return { ok: true, info: info, map: M.parse(files['map.md']), md: files['map.md'], types: types };
  }

  /* Group verified publications by version; two with the same number is a clash for people to settle. */
  function index(pubs) {
    var byVersion = {};
    pubs.forEach(function (p) { if (p.ok) (byVersion[p.info.version] = byVersion[p.info.version] || []).push(p); });
    var clashes = Object.keys(byVersion).filter(function (v) { return byVersion[v].length > 1; }).map(Number);
    var good = pubs.filter(function (p) { return p.ok && clashes.indexOf(p.info.version) < 0; }).sort(function (a, b) { return b.info.version - a.info.version; });
    return { latest: good[0] || null, all: pubs.filter(function (p) { return p.ok; }).sort(function (a, b) { return b.info.version - a.info.version; }), clashes: clashes };
  }

  /* Line diff (longest common subsequence) between two published maps. */
  function diff(a, b) {
    var x = String(a || '').split('\n'), y = String(b || '').split('\n'), n = x.length, m = y.length;
    var L = []; for (var i = 0; i <= n; i++) { L.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var out = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { out.push({ op: ' ', text: x[i] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ op: '-', text: x[i] }); i++; }
      else { out.push({ op: '+', text: y[j] }); j++; }
    }
    while (i < n) out.push({ op: '-', text: x[i++] });
    while (j < m) out.push({ op: '+', text: y[j++] });
    return out;
  }

  return { build: build, verify: verify, index: index, diff: diff, folderName: folderName, versionOf: versionOf, nextVersion: nextVersion };
})();
