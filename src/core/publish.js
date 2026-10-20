/* Publishing: freeze a draft map plus the step types it uses into an immutable, numbered version. */
PF.publish = (function () {
  'use strict';
  var U = PF.util, M = PF.map, T = PF.types;
  var FORMAT = 'preflight-publication/1', FORMAT2 = 'preflight-publication/2';
  var HEX64 = /^[0-9a-f]{64}$/;
  var NEWER = 'This version uses checklist features this copy of Flightdeck doesn\'t understand. Update Flightdeck to run it.';

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
    /* Lowest sufficient format (docs/design.md section 28): /1 unless the checklist uses a 2.0 feature, so every older copy
       keeps running a version that needs nothing new. */
    var feats = features(map), env = feats.length ? PF.envelope.stamp('preflight-publication', feats, opts.app) : {};
    var images = opts.images || {}, bytes = opts.imageBytes || {};
    if (feats.length) {
      var missing = Object.keys(images).filter(function (src) { return !bytes[src]; });
      if (missing.length) return { blockers: ['Screenshot ' + missing[0] + ' hasn\'t been read yet. Try publishing again.'] };
    }
    var info = env.format ? { format: env.format, features: env.features } : { format: FORMAT };
    if (env.app) info.app = env.app;
    var base = {
      process: map.meta.process, title: map.meta.title, version: version, folder: folder,
      publishedBy: opts.by, publishedAt: opts.now, changes: changes.slice(0, 200),
      mapHash: U.hash(draftMd), typesHash: U.hash(typesJson)
    };
    Object.keys(base).forEach(function (k) { info[k] = base[k]; });
    /* Reference screenshots copied into this version, each with a fingerprint, so a version is complete only when they've all arrived intact. */
    info.images = images;
    /* A /2 version also freezes its payload: SHA-256 over the exact bytes of every file it holds. */
    if (feats.length) {
      var imgBytes = {};
      Object.keys(images).forEach(function (src) { imgBytes[src] = bytes[src]; });
      info.payload = payload({ 'map.md': draftMd, 'types.json': typesJson, images: imgBytes });
    }
    /* The corrections this version includes, from PF.corrections.forPublish. Older copies ignore the field (verify reads only
       what it checks), so a version that has it runs everywhere a version without it does. */
    if (Array.isArray(opts.corrections) && opts.corrections.length) info.corrections = opts.corrections.slice(0, 500).map(function (c) {
      var x = { id: String(c.id) };
      if (c.result && typeof c.result === 'object') x.result = { step: String(c.result.step || ''), sig: String(c.result.sig || '') };
      return x;
    });
    return { folder: folder, version: version, files: { 'map.md': draftMd, 'types.json': typesJson, 'publication.json': JSON.stringify(info, null, 2) } };
  }

  /* Why this copy can't run a checklist, or '' if it can. Only what the version itself holds is checked, never the folder's
     people, screenshots or Jira workflows, and only what decides how a run reads: syntax the parser skipped, a skipped
     Questions section, a step type that isn't built in or frozen with it, a frozen type this copy can't fully read, and fields
     its type doesn't have. Those are what a
     newer Flightdeck, or a hand or AI edit, leaves behind; publishing always refused them, so no published version trips this. */
  function unrunnable(md, types) {
    var map = M.parse(md), e = map.errors[0], all = M.steps(map);
    if (e) return NEWER + ' Line ' + e.line + ': ' + e.msg;
    if (map.questions) return 'It has a "Questions" section, so steps after it would be skipped. Publish it again without one.';
    for (var i = 0; i < all.length; i++) {
      var s = all[i].step, label = 'Step "' + s.text.slice(0, 40) + '"', def = s.type ? T.get(s.type, types) : null;
      if (!s.type) return label + ' has no step type, so it can\'t be run. Publish the checklist again.';
      if (!def) return label + ' uses the step type {' + s.type + '}, which this copy of Flightdeck doesn\'t have and this version doesn\'t include. Update Flightdeck, or publish the checklist again.';
      /* A hand-written or newer types.json can hold anything; a type this copy can't fully read is reported, never thrown. */
      if (!T.understood(def)) return NEWER + ' ' + label + ' has a step type this copy can\'t read.';
      var bad; try { bad = T.checkFields(def, s.fields).errors[0]; } catch (err) { return NEWER + ' ' + label + ' has a step type this copy can\'t read.'; }
      if (bad) return NEWER + ' ' + label + ' ' + bad;
    }
    return '';
  }

  /* The 2.0 features a checklist uses (PF.map.features), which decide its version's format. */
  function features(map) { return M.features(map); }
  /* What each 2.0 feature is, in words, for the publish panel. */
  var FEATURE_NAMES = { 'phase-notes': 'a note on a phase', 'phase-shots': 'screenshots on a phase', 'gate-shots': 'screenshots on a gate' };
  function needs(map) {
    var f = features(map); if (!f.length) return null;
    return { features: f, names: f.map(function (x) { return FEATURE_NAMES[x] || x; }) };
  }

  function sha(data) { return PF.sha256.create().update(data).digest(); }
  /* The frozen payload of a version from its exact files: { 'map.md': text, 'types.json': text, images: { path: bytes } }. Slots
     for extensions and pins exist and stay empty until the slices that write them. */
  function payload(files) {
    var images = {}, src = (files && files.images) || {};
    Object.keys(src).forEach(function (p) { images[p] = sha(src[p]); });
    return { map: sha(files['map.md']), types: sha(files['types.json']), images: images, extensions: {}, pins: { children: {}, skills: {} } };
  }
  /* The payload of any readable version: a /2 version's own, or the one a /1 version implies from its fingerprints. */
  function payloadOf(info) {
    if (info && info.payload && typeof info.payload === 'object' && info.format === FORMAT2) return info.payload;
    var images = {}, src = info && isObj(info.images) ? info.images : {};
    Object.keys(src).forEach(function (k) { images[k] = src[k]; });
    return { implied: true, map: info.mapHash, types: info.typesHash, images: images, extensions: {}, pins: {} };
  }
  /* The files that make up a version, by its payload: the three records and every screenshot the payload lists. */
  function payloadFiles(info) { return ['map.md', 'types.json', 'publication.json'].concat(Object.keys(payloadOf(info).images || {}).sort()); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  /* A /2 version whose payload this copy can't read or check (missing, odd, or with a pin or extension it doesn't have): a
     later Flightdeck wrote it, so it's refused like a newer format, by name, never read for meaning. */
  function payloadShapeOk(info) {
    var p = info.payload;
    if (!isObj(p) || !isObj(p.images) || !isObj(p.extensions) || !isObj(p.pins)) return false;
    if (Object.keys(p).some(function (k) { return ['map', 'types', 'images', 'extensions', 'pins'].indexOf(k) < 0; })) return false;
    if (!HEX64.test(p.map) || !HEX64.test(p.types) || Object.keys(p.images).some(function (k) { return !HEX64.test(p.images[k]); })) return false;
    if (Object.keys(p.extensions).length) return false;
    return Object.keys(p.pins).every(function (k) { return (k === 'children' || k === 'skills') && isObj(p.pins[k]) && !Object.keys(p.pins[k]).length; });
  }
  /* Why a readable /2 version's files don't match its payload, or null. */
  function payloadProblem(info, files) {
    var p = info.payload, have = Object.keys(isObj(info.images) ? info.images : {}).sort(), want = Object.keys(p.images).sort();
    if (have.join('\n') !== want.join('\n')) return { why: 'Its screenshots don\'t match its payload. Edited by hand.', unusable: true };
    if (sha(files['map.md']) !== p.map || sha(files['types.json']) !== p.types) return { why: 'Files don\'t match their publication record. Still syncing, or edited by hand.', unusable: false };
    return null;
  }
  function appNeeds(app) { var m = /^(\d+)\.(\d+)\.\d+/.exec(typeof app === 'string' ? app : ''); return m && +m[1] >= 2 ? m[1] + '.' + m[2] : '2.0'; }

  /* A publication is usable only when all three files arrived and match, and this copy understands what they say. Anything
     else is "still syncing", damaged or unusable here, and never listed as a version to run. */
  function verify(folder, files) {
    var info = null;
    try { info = files['publication.json'] ? JSON.parse(files['publication.json']) : null; } catch (e) { return { ok: false, why: 'publication.json is unreadable.' }; }
    if (!info) return { ok: false, why: 'Still syncing: publication.json hasn\'t arrived.' };
    if (typeof info !== 'object' || Array.isArray(info)) return { ok: false, why: 'publication.json isn\'t a publication record.' };
    /* The envelope first (docs/design.md section 28): another format, a newer major or a feature this copy doesn't know makes
       the version unusable here, named with the Flightdeck it needs, never read for meaning. */
    var env = envelopeOf(info);
    if (env) return { ok: false, why: newerWhy(info, env.needs), info: info, unusable: true, newer: true, needs: env.needs || '' };
    if (files['map.md'] == null || files['types.json'] == null) return { ok: false, why: 'Still syncing: some files haven\'t arrived.', info: info };
    if (U.hash(files['map.md']) !== info.mapHash || U.hash(files['types.json']) !== info.typesHash) return { ok: false, why: 'Files don\'t match their publication record. Still syncing, or edited by hand.', info: info };
    if (info.format === FORMAT2) { var pp = payloadProblem(info, files); if (pp) return { ok: false, why: pp.why, info: info, unusable: pp.unusable }; }
    if (info.folder !== folder || versionOf(folder) !== info.version) return { ok: false, why: 'Folder name doesn\'t match the publication record.', info: info };
    var types; try { types = JSON.parse(files['types.json']); } catch (e) { return { ok: false, why: 'types.json is unreadable.', info: info }; }
    if (!types || typeof types !== 'object' || Array.isArray(types)) return { ok: false, why: 'types.json doesn\'t hold step types.', info: info };
    var bad = unrunnable(files['map.md'], types);
    if (bad) return { ok: false, why: bad, info: info, unusable: true };
    return { ok: true, info: info, map: M.parse(files['map.md']), md: files['map.md'], types: types };
  }

  /* The envelope's refusal of a publication record, or null when this copy reads its format. */
  function envelopeOf(info) {
    if (info.format === FORMAT && info.features == null) return null;
    var env = PF.envelope.judge('preflight-publication', info);
    if (!env.ok) return { needs: env.needs || '' };
    return info.format === FORMAT2 && !payloadShapeOk(info) ? { needs: appNeeds(info.app) } : null;
  }
  /* Why a run's version can't be used because a newer Flightdeck wrote it, or '' (pubProblem, before anything else is read). */
  function newerOf(info) { var env = envelopeOf(info); return env ? newerWhy(info, env.needs) : ''; }
  /* Why a version from a newer Flightdeck can't run here: the version it needs when the file or the contract says, else NEWER. */
  function newerWhy(info, needs) {
    if (!needs) return NEWER;
    var v = typeof info.version === 'number' && isFinite(info.version) ? 'v' + Math.floor(info.version) : 'This version';
    return v + ' needs Flightdeck ' + needs + '. This copy shows it but won\'t run it. Open the team folder\'s own flightdeck.html.';
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

  /* The publication a planned run starts on: the exact one the person chose (chosen: a publication folder), else the version it
     was planned on. A choice or version that can't be used any more (removed, damaged or clashing) gives the latest, and
     `missing` says so. `older` is true whenever a newer version than the one starting is published. */
  function forPlan(proc, version, chosen) {
    var latest = proc.latest, clashes = proc.clashes || [], all = proc.all || [];
    var out = function (pub, missing) { return { pub: pub, older: !!pub && pub.info.folder !== latest.info.folder, missing: !!missing, chosen: !!chosen && !missing }; };
    if (!latest) return out(null, false);
    var ok = function (list) { return list.length === 1 && clashes.indexOf(list[0].info.version) < 0 ? list[0] : null; };
    if (chosen) {
      var c = ok(all.filter(function (p) { return p.info.folder === chosen; }));
      return c ? out(c, false) : out(latest, true);
    }
    var v = typeof version === 'string' && /^\d+$/.test(version) ? +version : version;
    if (v == null || v === latest.info.version) return out(latest, false);
    var hit = typeof v === 'number' ? ok(all.filter(function (p) { return p.info.version === v; })) : null;
    return hit ? out(hit, false) : out(latest, true);
  }

  return { FORMAT: FORMAT, FORMAT2: FORMAT2, NEWER: NEWER, features: features, payloadFiles: payloadFiles, FEATURE_NAMES: FEATURE_NAMES, needs: needs, payload: payload, payloadOf: payloadOf, newerOf: newerOf, build: build, verify: verify, unrunnable: unrunnable, index: index, diff: diff, forPlan: forPlan, folderName: folderName, versionOf: versionOf, nextVersion: nextVersion };
})();
