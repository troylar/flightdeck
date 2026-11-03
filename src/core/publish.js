/* Publishing: freeze a draft map plus the step types it uses into an immutable, numbered version. */
PF.publish = (function () {
  'use strict';
  var U = PF.util, M = PF.map, T = PF.types;
  var FORMAT = 'preflight-publication/1', FORMAT2 = 'preflight-publication/2';
  var HEX64 = /^[0-9a-f]{64}$/;
  var NEWER = 'This version uses checklist features this copy of Flightdeck doesn\'t understand. Update Flightdeck to run it.';

  /* Each publish gets its own folder (v5-k3m9p2q8), so two people publishing at once never write the same files. */
  function folderName(version, rand) { return 'v' + version + '-' + (rand || U.randomId(8)); }
  /* A stage's folder (2.1): staged/<process>/stage-<random8>/, written once. */
  var STAGE = /^stage-[a-z0-9]{8}$/;
  function stageName(rand) { return 'stage-' + (rand || U.randomId(8)); }
  function versionOf(folder) { var m = /^v(\d+)-[a-z0-9]+$/.exec(folder); return m ? +m[1] : null; }

  function nextVersion(existing) {
    var max = 0;
    (existing || []).forEach(function (p) { if (p.version > max) max = p.version; });
    return max + 1;
  }

  /* Pins (2.0): version: N on a linked step resolves now to the one usable version numbered N (childProcs: each linked process
     as listed, { latest, all, clashes, broken }); skillVersion: names the skill version the step expects. Both are frozen in
     the payload, so every run of this version follows them. Returns { pins, blockers }. unknown(process), when given: a
     process that couldn't be read, whose pins are left unchecked (draft check). */
  function pinCheck(map, childProcs, unknown) {
    var pins = { children: {}, skills: {} }, pinBlockers = [];
    M.steps(map).forEach(function (x) {
      var s = x.step, label = 'Step "' + s.text.slice(0, 40) + '"';
      if (s.type === 'run.process' && Object.prototype.hasOwnProperty.call(s.fields, 'version') && !(unknown && unknown(s.fields.process, s.fields.version))) {
        var cp = childProcs && Object.prototype.hasOwnProperty.call(childProcs, s.fields.process) ? childProcs[s.fields.process] : null;
        var got = PF.pins.atVersion(cp, s.fields.process || '?', +s.fields.version);
        if (got.why) pinBlockers.push(label + ': version: ' + s.fields.version + ' can\'t be pinned: ' + got.why + '.'); else pins.children[s.id] = got.pin;
      }
      if (s.type === 'run.skill' && Object.prototype.hasOwnProperty.call(s.fields, 'skillVersion')) {
        if (!String(s.fields.skill || '').trim()) pinBlockers.push(label + ': skillVersion: needs the skill it names (skill:).');
        else pins.skills[s.id] = { name: String(s.fields.skill).trim(), version: String(s.fields.skillVersion).trim() };
      }
    });
    return { pins: pins, blockers: pinBlockers };
  }

  /* Returns { folder, files } or { blockers }. */
  function build(draftMd, opts) {
    var map = M.parse(draftMd), c = M.check(map, { people: opts.people, types: opts.customTypes, workflows: opts.workflows, processes: opts.processes, children: opts.childProcs ? PF.links.childrenFrom(opts.childProcs) : opts.children, teamValues: opts.teamValues });
    if (c.blockers.length) return { blockers: c.blockers };
    if (!opts.by) return { blockers: ['Choose who you are before publishing.'] };
    var changes = String(opts.changes || '').trim();
    if (!changes) return { blockers: ['Write a one-line change note.'] };
    /* opts.stage (2.1): a stage, which only test runs use. It proposes the next number but has none, names staged, and always
       freezes its payload, so promotion can prove it publishes exactly what was tried. */
    var stage = !!opts.stage, version = nextVersion(opts.existing), folder = stage ? stageName(opts.rand) : folderName(version, opts.rand);
    var types = T.freeze(M.usedTypes(map), opts.customTypes);
    var typesJson = JSON.stringify(types, null, 2);
    /* Lowest sufficient format (docs/design.md section 28): /1 unless the checklist uses a 2.0 feature, so every older copy
       keeps running a version that needs nothing new. */
    var feats = features(map, types);
    if (stage) feats = PF.envelope.FROZEN.filter(function (f) { return f === 'staged' || feats.indexOf(f) >= 0; });
    var env = feats.length ? PF.envelope.stamp('preflight-publication', feats, opts.app) : {};
    var images = opts.images || {}, bytes = opts.imageBytes || {};
    var pc = pinCheck(map, opts.childProcs), pins = pc.pins, pinBlockers = pc.blockers;
    if (pinBlockers.length) return { blockers: pinBlockers };
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
    if (stage) delete base.version;
    Object.keys(base).forEach(function (k) { info[k] = base[k]; });
    /* Reference screenshots copied into this version, each with a fingerprint, so a version is complete only when they've all arrived intact. */
    info.images = images;
    /* A /2 version also freezes its payload: SHA-256 over the exact bytes of every file it holds. */
    if (feats.length) {
      var imgBytes = Object.create(null);
      Object.keys(images).forEach(function (src) { imgBytes[src] = bytes[src]; });
      info.payload = payload({ 'map.md': draftMd, 'types.json': typesJson, images: imgBytes, pins: pins });
    }
    /* The corrections this version includes, from PF.corrections.forPublish. Older copies ignore the field (verify reads only
       what it checks), so a version that has it runs everywhere a version without it does. */
    if (stage) { info.stage = { proposed: version }; info.stagedBy = opts.by; info.stagedAt = opts.now; }
    if (Array.isArray(opts.corrections) && opts.corrections.length) info.corrections = opts.corrections.slice(0, 500).map(function (c) {
      var x = { id: String(c.id) };
      if (c.result && typeof c.result === 'object') x.result = { step: String(c.result.step || ''), sig: String(c.result.sig || '') };
      return x;
    });
    return { folder: folder, version: version, files: { 'map.md': draftMd, 'types.json': typesJson, 'publication.json': JSON.stringify(info, null, 2) } };
  }

  /* ---------- Draft checks (2.13): one set of inputs for the editor's Checks, Review & publish and flightdeck draft check ----------
     d: { people, types, workflows, processes, procOf, teamValues, unknownType }, the folder as the app holds it: people.json's
     list, the team's step types, jira/workflows.json, the processes as the app lists them ({ id, latest, ... }) and a lookup
     by ID. A process marked unread (the command line couldn't read all of it) is unknown: never suggested as unpublished,
     never checked as a parent, and a linked step that starts it isn't checked against it. unknownType(id): a team step type
     whose file couldn't be read, so a step of that type is neither an unknown type nor scanned field by field. Any input that
     is null isn't checked at all. The app never marks anything unknown, so for the app these are the inputs it always passed. */
  function checkOptions(d) {
    var procs = d.processes, unread = Object.create(null);
    (procs || []).forEach(function (x) { if (x.unread) unread[x.id] = true; });
    var kids = d.procOf ? PF.links.childrenFrom(d.procOf) : null, o = { people: d.people, types: d.types, workflows: d.workflows,
      processes: procs ? procs.filter(function (x) { return x.latest || x.unread; }).map(function (x) { return x.id; }) : null,
      children: kids ? function (process, version) { return d.unknownAt ? (d.unknownAt(process, version) ? null : kids(process, version)) : process && unread[process] ? null : kids(process, version); } : null,
      parents: procs ? procs.filter(function (x) { return !x.unread; }) : null,
      teamValues: d.teamValues };
    if (d.unknownType) o.unknownType = d.unknownType;
    return o;
  }
  /* Which input a problem's path belongs to: { input: 'all' | 'people' | 'types' | 'workflows' | 'teamValues' | 'publications'
     | 'shot', id (a type or process), version (of a process, from its folder's name), path (a shot's own) }, or null when
     it's none of them. A malformed jira/workflows.json or team-values.json is marked finding: the app shows it as one, so it's
     named but never unknown. */
  function inputOf(x, shots) {
    var p = String(x.path || '').replace(/\/+$/, ''), k = x.kind, m, under = function (q, top) { return q === top || q.indexOf(top + '/') === 0; };
    if (p === '' || p === '.') return { input: 'all' };
    if (p === PF.people.FILE) return { input: 'people' };
    if (p === PF.teamValues.FILE) return k === 'malformed' ? { input: 'teamValues', finding: true } : { input: 'teamValues' };
    if (under(p, 'jira')) return p === 'jira/workflows.json' && k === 'malformed' ? { input: 'workflows', finding: true } : { input: 'workflows' };
    if (p === 'step-types') return { input: 'types' };
    if ((m = /^step-types\/([^/]+)\.json$/i.exec(p))) return { input: 'types', id: m[1] };
    if (p === 'publications') return { input: 'publications' };
    if ((m = /^publications\/([^/]+)(?:\/([^/]+))?/.exec(p))) { var v = m[2] ? versionOf(m[2]) : null; return v ? { input: 'publications', id: m[1], version: v } : { input: 'publications', id: m[1] }; }
    var hit = (shots || []).filter(function (src) { return under(src, p); });
    return hit.length ? { input: 'shot', paths: hit } : null;
  }
  /* What the text uses, so a problem with an input it doesn't use leaves the answer complete: people for an owner or backup,
     the team types its steps name (any of step-types/ when one isn't built in), Jira workflows for a Jira step, team values
     for a team: source, every publication (children, pins, and the parents that start it), the screenshots it shows. */
  function usesOf(map) {
    var types = [], has = function (f) { return M.steps(map).some(f); };
    M.steps(map).forEach(function (x) { var t = x.step.type; if (t && !T.get(t, {}) && types.indexOf(t) < 0) types.push(t); });
    return { people: !!(map.meta.owner || map.meta.backup), types: types, workflows: has(function (x) { return x.step.type === 'jira.issue'; }),
      teamValues: has(function (x) { return x.step.type === 'run.process' && PF.links.teams(x.step).length > 0; }), publications: true, shots: M.shotSources(map) };
  }
  function uses(u, x, shots) {
    var i = inputOf(x, shots);
    if (!i) return false;
    if (i.input === 'all' || i.input === 'publications' || i.input === 'shot') return true;
    if (i.input === 'types') return i.id ? u.types.indexOf(i.id) >= 0 : u.types.length > 0;
    return !!u[i.input];
  }
  /* What the loaders left out over a limit, from their own reads (loadStepTypes' over: the files past the first 100;
     loadWorkflows' over: the issue types past 50), as skipped problems naming each excluded input, so the ledger names them
     and unknownOf leaves their checks unknown. got: { stepTypes, jira } as repo.loadAll gives them. */
  function excludedOf(got) {
    var out = [], st = got.stepTypes || {}, j = got.jira || {};
    (st.over || []).forEach(function (name, i, all) { out.push({ path: 'step-types/' + name, kind: 'skipped', why: 'step-types: ' + (all.length + 100) + ' files; Flightdeck loads the first 100, so this one isn\'t read.' }); });
    if ((j.over || []).length) out.push({ path: 'jira/workflows.json', kind: 'skipped', why: 'jira/workflows.json lists ' + (j.over.length + 50) + ' issue types; Flightdeck reads the first 50, so these aren\'t read: ' + j.over.slice(0, 10).join(', ') + (j.over.length > 10 ? ' and ' + (j.over.length - 10) + ' more' : '') + '.' });
    return out;
  }
  /* The one place that decides what's unknown: every problem the read met (the problem ledger's, the folder adapter's, and
     what the loaders refused, all noted first), each mapped to its input by inputOf. Returns { people, types (true, or the
     IDs), workflows, teamValues, publications, processes (IDs not read at all), versions ([process, version] that weren't
     read), shots (paths) }. */
  function unknownOf(problems, shots) {
    var u = { types: [], processes: [], versions: [], shots: [] }, allTypes = false, add = function (list, v) { if (list.indexOf(v) < 0) list.push(v); };
    (problems || []).forEach(function (x) {
      var i = inputOf(x, shots);
      if (!i || i.finding) return;
      if (i.input === 'all') { u.people = u.workflows = u.teamValues = u.publications = true; allTypes = true; (shots || []).forEach(function (src) { add(u.shots, src); }); }
      else if (i.input === 'types') { if (i.id) add(u.types, i.id); else allTypes = true; }
      else if (i.input === 'publications') {
        if (!i.id) u.publications = true;
        else if (i.version) { if (!u.versions.some(function (v) { return v[0] === i.id && v[1] === i.version; })) u.versions.push([i.id, i.version]); }
        else add(u.processes, i.id);
      }
      else if (i.input === 'shot') i.paths.forEach(function (src) { add(u.shots, src); });
      else u[i.input] = true;
    });
    if (allTypes) u.types = true;
    return u;
  }
  /* What a read of the folder found, and what it couldn't know. got: { people, types ({ id: type }), workflows, processes
     ([{ id, latest, all, clashes, broken }] in any order), teamValues, missingShots (screenshots the folder doesn't have),
     unknown (from unknownOf) }. Each check that needs an unknown input stays unchecked and adds nothing; the caller says the
     answer is partial and names why. The processes are put in the order the app lists them, so findings come in that order. */
  function checkContext(got) {
    var u = got.unknown || {}, N = PF.text.natural, by = Object.create(null), whole = Object.create(null), gone = Object.create(null), vers = Object.create(null);
    (u.processes || []).forEach(function (id) { whole[id] = gone[id] = true; });
    (u.versions || []).forEach(function (v) { (vers[v[0]] = vers[v[0]] || []).push(v[1]); });
    /* Unknown at its latest (gone): not read at all, or a version that isn't read is numbered at or above the latest that is.
       An older version that isn't read leaves the latest, and every other version, checked. */
    Object.keys(vers).forEach(function (id) {
      var p = (got.processes || []).filter(function (x) { return x.id === id; })[0], top = p && p.latest && p.latest.info ? +p.latest.info.version : 0;
      if (vers[id].some(function (n) { return n >= top; })) gone[id] = true;
    });
    /* unknownAt(process, version): that version (a version: pin) or, with none, the latest, wasn't read. */
    var unknownAt = function (id, version) {
      if (!procs) return true;
      if (!id) return false;
      return version !== '' && version != null ? !!whole[id] || (vers[id] || []).indexOf(+version) >= 0 : !!gone[id];
    };
    var procs = u.publications ? null : (got.processes || []).map(function (p) { return gone[p.id] ? Object.assign({}, p, { unread: true }) : p; });
    var meta = function (p) { var m = p.latest && p.latest.map ? p.latest.map.meta : {}; return { title: m.title || p.id, category: m.category || 'Other' }; };
    if (procs) {
      Object.keys(gone).forEach(function (id) { if (!procs.some(function (p) { return p.id === id; })) procs.push({ id: id, latest: null, all: [], clashes: [], broken: [], unread: true }); });
      procs.sort(function (a, b) { var x = meta(a), y = meta(b); return N(x.category, y.category) || N(x.title, y.title) || N(a.id, b.id); });
      procs.forEach(function (p) { by[p.id] = p; });
    }
    var ut = u.types === true ? function () { return true; } : (u.types || []).length ? function (t) { return u.types.indexOf(t) >= 0; } : null;
    return {
      options: checkOptions({ people: u.people ? null : got.people, types: got.types || {}, workflows: u.workflows ? null : got.workflows, processes: procs,
        procOf: procs ? function (id) { return by[id] || null; } : null, teamValues: u.teamValues ? undefined : got.teamValues, unknownType: ut, unknownAt: procs ? unknownAt : null }),
      childProcs: by,
      unknownProcess: unknownAt,
      missingShots: (got.missingShots || []).filter(function (src) { return (u.shots || []).indexOf(src) < 0; })
    };
  }
  /* The verdict for a draft's text, before anything is written: checks, as the editor's Checks and Review & publish show them,
     and publish: { ok, blockers }, what Publish would stop at (the same order: the checks, then version: pins, then
     screenshots). Who publishes and the change note are left out: only a person gives those. Nothing unknown is a finding
     (checkContext). ctx: from checkContext. */
  function publishCheck(draftMd, ctx) {
    var map = M.parse(draftMd), c = M.check(map, ctx.options);
    var pub = c.blockers.length ? c.blockers : pinCheck(map, ctx.childProcs, ctx.unknownProcess).blockers;
    if (!pub.length) pub = ctx.missingShots.map(function (src) { return 'The screenshot ' + src + ' isn\'t in the team folder. Add it, or remove it from the checklist.'; });
    return { checks: { blockers: c.blockers, suggestions: c.suggestions }, publish: { ok: !pub.length, blockers: pub.slice() } };
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
    /* A run keeps its answers, gates, roles and details in plain objects by these names, so one a plain object already has
       (constructor) would read an inherited value as an answer and write onto it. Publishing refuses these; only a hand-edited
       run gets here. */
    var taken = [].concat(map.meta.roles || [], map.meta.context || []);
    map.phases.forEach(function (p) { taken.push(p.id); if (p.gate) taken.push(p.gate.id); });
    all.forEach(function (x) { taken.push(x.step.id); });
    taken = taken.filter(function (n) { return n === '__proto__' || n in Object.prototype; })[0];
    if (taken) return 'It uses the name "' + taken + '" for a step, phase, gate, role or run detail, and Flightdeck keeps that name for itself. Publish the checklist again with another one.';
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

  /* The 2.0 features a version uses, which decide its format: its checklist's own (PF.map.features), plus typed-evidence when
     a step type it uses is defined with a 2.0 evidence kind (frozen as version 3). types: the definitions by ID, frozen or the
     team's own; built-in types never are. */
  function features(map, types) {
    var f = M.features(map);
    if (f.indexOf('typed-evidence') < 0 && M.usedTypes(map).some(function (id) { var d = types && typeof types === 'object' && Object.prototype.hasOwnProperty.call(types, id) ? types[id] : null; return !!d && typeof d === 'object' && (d.version === 3 || T.uses2(d.record)); }))
      f = PF.envelope.FROZEN.filter(function (x) { return x === 'typed-evidence' || f.indexOf(x) >= 0; });
    return f;
  }
  /* What each 2.0 feature is, in words, for the publish panel. */
  var FEATURE_NAMES = { 'typed-details': 'typed run details', 'typed-evidence': 'typed evidence (a number, yes/no or date)', 'phase-notes': 'a note on a phase', 'phase-shots': 'screenshots on a phase', 'gate-shots': 'screenshots on a gate', 'pinned-children': 'a linked run pinned to a version (version:)', 'pinned-skills': 'a skill version a step expects (skillVersion:)', conditions: 'conditions (only when)', 'passed-details': 'a linked step that passes details under other names, fixed values or asks (pass:)', 'team-values': 'a linked step that passes a team value (pass: name=team:…)' };
  function needs(map, types) {
    var f = features(map, types); if (!f.length) return null;
    var typed = Object.keys((map.meta && map.meta.detailTypes) || {});
    return { features: f, needs: PF.envelope.minimum(f), names: f.map(function (x) { return x === 'typed-details' ? FEATURE_NAMES[x] + ' (' + typed.join(', ') + ')' : FEATURE_NAMES[x] || x; }) };
  }

  function sha(data) { return PF.sha256.create().update(data).digest(); }
  /* The frozen payload of a version from its exact files: { 'map.md': text, 'types.json': text, images: { path: bytes },
     pins: { children, skills } } (pins as publish resolved them). The extensions slot stays empty until slice 5. */
  function payload(files) {
    var images = Object.create(null), src = (files && files.images) || {}, pins = files && files.pins ? JSON.parse(JSON.stringify(files.pins)) : {};
    Object.keys(src).forEach(function (p) { images[p] = sha(src[p]); });
    return { map: sha(files['map.md']), types: sha(files['types.json']), images: images, extensions: {}, pins: { children: pins.children || {}, skills: pins.skills || {} } };
  }
  /* Canonical JSON: keys sorted at every level, no spaces. The one way two payloads (or two pins) are compared or hashed, so
     the order a writer happened to use never matters. */
  function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function payloadHash(p) { return sha(canonical(p)); }
  /* The pins a checklist's own lines ask for, as publish records them by step: what a /2 version's payload pins must match. */
  function pinsProblem(info, map) {
    var p = info.payload && info.payload.pins, want = { children: Object.create(null), skills: Object.create(null) };
    if (!p) return '';
    M.steps(map).forEach(function (x) {
      var s = x.step;
      if (s.type === 'run.process' && Object.prototype.hasOwnProperty.call(s.fields, 'version')) want.children[s.id] = { process: s.fields.process, version: +s.fields.version };
      if (s.type === 'run.skill' && Object.prototype.hasOwnProperty.call(s.fields, 'skillVersion')) want.skills[s.id] = { name: String(s.fields.skill || '').trim(), version: String(s.fields.skillVersion).trim() };
    });
    var have = { children: Object.create(null), skills: Object.create(null) };
    Object.keys(p.children).forEach(function (k) { have.children[k] = { process: p.children[k].process, version: p.children[k].version }; });
    Object.keys(p.skills).forEach(function (k) { have.skills[k] = p.skills[k]; });
    return canonical(have) === canonical(want) ? '' : 'Its pins don\'t match its checklist. Edited by hand.';
  }
  /* The payload of any readable version: a /2 version's own, or the one a /1 version implies from its fingerprints. */
  function payloadOf(info) {
    if (info && info.payload && typeof info.payload === 'object' && info.format === FORMAT2) return info.payload;
    var images = Object.create(null), src = info && isObj(info.images) ? info.images : {};
    Object.keys(src).forEach(function (k) { images[k] = src[k]; });
    return { implied: true, map: info.mapHash, types: info.typesHash, images: images, extensions: {}, pins: {} };
  }
  /* The files that make up a version, by its payload: the three records and every screenshot the payload lists. */
  function payloadFiles(info) { var im = payloadOf(info).images; return ['map.md', 'types.json', 'publication.json'].concat(isObj(im) ? Object.keys(im).sort() : []); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  /* A /2 version whose payload this copy can't read or check (missing, odd, or with a pin or extension it doesn't have): a
     later Flightdeck wrote it, so it's refused like a newer format, by name, never read for meaning. */
  function payloadShapeOk(info) {
    var p = info.payload;
    if (!isObj(p) || !isObj(p.images) || !isObj(p.extensions) || !isObj(p.pins)) return false;
    if (Object.keys(p).some(function (k) { return ['map', 'types', 'images', 'extensions', 'pins'].indexOf(k) < 0; })) return false;
    if (!HEX64.test(p.map) || !HEX64.test(p.types) || Object.keys(p.images).some(function (k) { return !HEX64.test(p.images[k]); })) return false;
    if (Object.keys(p.extensions).length) return false;
    return isObj(p.pins.children) && isObj(p.pins.skills) && PF.pins.shapeOk(p.pins);
  }
  /* The SHA-256 of a version's checklist and step types from their exact bytes ({ 'map.md': bytes, 'types.json': bytes }),
     for verify. The one way a /2 version's files are hashed: it takes bytes only, because a reader's text can drop a
     byte-order mark or a bad byte the payload covers. A file not given is left out (still syncing). */
  function exactOf(raw) {
    var out = {};
    ['map.md', 'types.json'].forEach(function (n) {
      var b = raw ? raw[n] : null;
      if (b == null) return;
      if (Object.prototype.toString.call(b) !== '[object Uint8Array]') throw new Error('exactOf takes the exact bytes of ' + n + ', never its text.');
      out[n] = sha(b);
    });
    return out;
  }
  /* Why a readable /2 version's files don't match its payload, or null. exact: from exactOf; without it the version can't
     be checked yet (needsBytes), never from its text. */
  function payloadProblem(info, exact) {
    var p = info.payload, have = Object.keys(isObj(info.images) ? info.images : {}).sort(), want = Object.keys(p.images).sort();
    if (have.join('\n') !== want.join('\n')) return { why: 'Its screenshots don\'t match its payload. Edited by hand.', unusable: true };
    var e = isObj(exact) ? exact : {};
    if (!HEX64.test(e['map.md'] || '') || !HEX64.test(e['types.json'] || '')) return { why: 'Still syncing: the exact bytes of its checklist and step types haven\'t been read.', unusable: false, needsBytes: true };
    var off = e['map.md'] !== p.map ? 'map.md' : e['types.json'] !== p.types ? 'types.json' : '';
    if (off) return { why: off + ' doesn\'t match the version\'s payload byte for byte. Still syncing, or edited by hand.', unusable: false };
    return null;
  }
  function appNeeds(app) { var m = /^(\d+)\.(\d+)\.\d+/.exec(typeof app === 'string' ? app : ''); return m && +m[1] >= 2 ? m[1] + '.' + m[2] : '2.0'; }

  /* A publication is usable only when all three files arrived and match, and this copy understands what they say. Anything
     else is "still syncing", damaged or unusable here, and never listed as a version to run. */
  /* exact: for a /2 version, the SHA-256 of its checklist's and step types' exact bytes (exactOf), which its payload is
     checked against; a /1 version is checked by its fingerprints over text, as every 1.x copy checks it. */
  /* opts.stage (2.1): the folder is a stage under staged/, checked by the stage rules (a stage-<random8> folder, staged named, the
     number it proposes, who staged it and when); without it a record naming staged is never a version to run. */
  function verify(folder, files, exact, opts) {
    var res = verifyAny(folder, files, exact, !!(opts && opts.stage));
    return res;
  }
  function stageProblem(info, folder) {
    var st = info.stage;
    if (info.format !== FORMAT2 || !Array.isArray(info.features) || info.features.indexOf('staged') < 0) return 'It isn\'t a staged version.';
    if (!STAGE.test(folder) || info.folder !== folder || Object.prototype.hasOwnProperty.call(info, 'version')) return 'Folder name doesn\'t match the stage record.';
    if (!isObj(st) || typeof st.proposed !== 'number' || !(st.proposed >= 1) || Math.floor(st.proposed) !== st.proposed || st.proposed > 99999) return 'Its stage record doesn\'t say which number it proposes.';
    if (typeof info.stagedBy !== 'string' || !info.stagedBy || typeof info.stagedAt !== 'string' || !info.stagedAt) return 'Its stage record doesn\'t say who staged it, or when.';
    return '';
  }
  function verifyAny(folder, files, exact, asStage) {
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
    if (info.format === FORMAT2) { var pp = payloadProblem(info, exact); if (pp) return { ok: false, why: pp.why, info: info, unusable: pp.unusable, needsBytes: !!pp.needsBytes }; }
    var staged = Array.isArray(info.features) && info.features.indexOf('staged') >= 0;
    if (asStage) { var sp = stageProblem(info, folder); if (sp) return { ok: false, why: sp, info: info, unusable: true }; }
    else if (staged) return { ok: false, why: 'It\'s a staged version, which only test runs use. Edited by hand: a stage belongs under staged/.', info: info, unusable: true };
    else if (info.folder !== folder || versionOf(folder) !== info.version) return { ok: false, why: 'Folder name doesn\'t match the publication record.', info: info };
    var types; try { types = JSON.parse(files['types.json']); } catch (e) { return { ok: false, why: 'types.json is unreadable.', info: info }; }
    if (!types || typeof types !== 'object' || Array.isArray(types)) return { ok: false, why: 'types.json doesn\'t hold step types.', info: info };
    var bad = unrunnable(files['map.md'], types);
    if (bad) return { ok: false, why: bad, info: info, unusable: true };
    /* What it uses must be what its record says it uses: a /1 version holds no 2.0 feature, and a /2 version lists every one, so
       no copy reads a version by a format that doesn't name what's in it. */
    var used = features(M.parse(files['map.md']), types), listed2 = info.format === FORMAT2 && Array.isArray(info.features) ? info.features : [];
    var unlisted2 = used.filter(function (f) { return listed2.indexOf(f) < 0; });
    if (unlisted2.length) return { ok: false, why: 'It uses ' + unlisted2.join(', ') + ', which its publication record doesn\'t list. Edited by hand.', info: info, unusable: true };
    var pinsBad = info.format === FORMAT2 ? pinsProblem(info, M.parse(files['map.md'])) : '';
    if (pinsBad) return { ok: false, why: pinsBad, info: info, unusable: true };
    /* Every screenshot the checklist shows is part of the version: listed in its record (every 1.x copy lists each one it
       copies) and, for /2, in its payload (which must list the same ones). One that isn't could change unchecked. */
    var listed = isObj(info.images) ? info.images : {}, unlisted = M.shotSources(M.parse(files['map.md'])).filter(function (src) { return !Object.prototype.hasOwnProperty.call(listed, src); });
    if (unlisted.length) return { ok: false, why: 'A screenshot it shows isn\'t in its publication record (' + unlisted[0] + '). Edited by hand.', info: info, unusable: true };
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

  /* The publication record that makes a verified stage the default (2.1): its exact checklist, step types and screenshots in
     the lowest format their content needs (staged dropped; /1 when nothing else is left), the same payload (on /1 too), and stagedFrom
     naming the stage. o: { version, folder, by, now, app }. */
  function promoteRecord(stage, o) {
    var si = stage.info, feats = features(stage.map, stage.types);
    var env = feats.length ? PF.envelope.stamp('preflight-publication', feats, o.app) : {};
    var info = env.format ? { format: env.format, features: env.features } : { format: FORMAT };
    if (env.app) info.app = env.app;
    var base = { process: si.process, title: si.title, version: o.version, folder: o.folder, publishedBy: o.by, publishedAt: o.now, changes: si.changes,
      mapHash: si.mapHash, typesHash: si.typesHash };
    Object.keys(base).forEach(function (k) { info[k] = base[k]; });
    info.images = isObj(si.images) ? JSON.parse(JSON.stringify(si.images)) : {};
    /* The stage's payload, always: a /1 record carries it too (every older copy ignores the field; test/compat-staging.test.js),
       so a promoted version keeps the SHA-256 identity of exactly what was tried. */
    info.payload = JSON.parse(JSON.stringify(si.payload));
    if (Array.isArray(si.corrections) && si.corrections.length) info.corrections = JSON.parse(JSON.stringify(si.corrections));
    info.stagedFrom = { folder: stage.folder || si.folder, at: si.stagedAt };
    return JSON.stringify(info, null, 2);
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

  return { STAGE: STAGE, stageName: stageName, promoteRecord: promoteRecord, FORMAT: FORMAT, FORMAT2: FORMAT2, NEWER: NEWER, canonical: canonical, payloadHash: payloadHash, features: features, payloadFiles: payloadFiles, FEATURE_NAMES: FEATURE_NAMES, needs: needs, payload: payload, payloadOf: payloadOf, newerOf: newerOf, build: build, checkOptions: checkOptions, excludedOf: excludedOf, unknownOf: unknownOf, usesOf: usesOf, uses: uses, checkContext: checkContext, publishCheck: publishCheck, verify: verify, exactOf: exactOf, unrunnable: unrunnable, index: index, diff: diff, forPlan: forPlan, folderName: folderName, versionOf: versionOf, nextVersion: nextVersion };
})();
