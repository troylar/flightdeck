/* Where you are, as the address bar's hash: one format and one parser for Back and Forward (docs/design.md section 29).
   No DOM, no state. A hash holds route words and IDs only (skills and plans as a fingerprint), never a title, a person or a
   folder. parse() treats every hash as hostile: it refuses (null) anything that isn't exactly one of the routes, and never
   throws. The ID patterns are the readers' own (map, run, types, publish), looked up when used. */
PF.nav = (function () {
  'use strict';
  var MAX = 2048, SEGS = 6, HEX = /^[0-9a-f]{8}$/, ANCHOR = /^[a-z0-9-]{1,80}$/, BAD = /[\u0000-\u001f\u007f\/\\<>"']/;
  function set(list) { var o = Object.create(null); list.forEach(function (k) { o[k] = true; }); return o; }
  var PAGES = set(['runs', 'followups', 'processes', 'skills', 'settings', 'new-process', 'setup', 'health', 'connection']);
  var TABS = set(['edit', 'insights']), RUN_SUBS = set(['share', 'finish', 'receipt']);

  function isProcess(s) { return typeof s === 'string' && PF.map.PROCESS_ID.test(s); }
  function isStage(s) { return typeof s === 'string' && /^stage-[a-z0-9]{8}$/.test(s); }
  function isRun(s) { return typeof s === 'string' && PF.run.RUN_ID.test(s); }
  function isType(s) { return typeof s === 'string' && s.length <= PF.types.ID_MAX && PF.types.ID.test(s); }
  function isVersion(s) { return typeof s === 'string' && PF.publish.versionOf(s) != null; }
  function isHex(s) { return typeof s === 'string' && HEX.test(s); }
  function isAnchor(s) { return typeof s === 'string' && ANCHOR.test(s); }

  /* What a skill link names: a legacy registration by its file, an exact one (2.0) by its name's folder, so the link still
     opens the skill after a newer revision of its registration arrives. */
  function skillKey(file) { var m = /^(skill-registrations\/[^/]+\/)/.exec(String(file == null ? '' : file)); return m ? m[1] : file; }

  function join(parts) { return '#/' + parts.map(encodeURIComponent).join('/'); }

  /* loc: { view, process, tab, version, run, sub, plan, skill, type, section }. A value that isn't a valid ID gives the list
     it would be found in, so a hash is always one parse() accepts. */
  function format(loc) {
    loc = loc || {};
    var v = loc.view;
    if (typeof v === 'string' && PAGES[v] === true) return join([v]);
    if (v === 'types') return loc.sub === 'new' ? join(['types', 'new']) : loc.type != null && isType(loc.type) ? join(['types', 'edit', loc.type]) : join(['types']);
    if (v === 'recovery') return isAnchor(loc.section) ? join(['recovery', loc.section]) : join(['recovery']);
    if (v === 'process') {
      if (!isProcess(loc.process)) return join(['processes']);
      var p = ['process', loc.process];
      if (loc.sub === 'start') { p.push('start'); if (isStage(loc.stage)) p.push(loc.stage); }
      else if (typeof loc.tab === 'string' && TABS[loc.tab] === true) p.push(loc.tab);
      else if (loc.version === 'current') p.push('current');
      else if (isVersion(loc.version)) p.push('v', loc.version);
      return join(p);
    }
    if (v === 'plan') return isHex(loc.plan) ? join(['plan', loc.plan]) : join(['runs']);
    if (v === 'run') {
      if (!isProcess(loc.process) || !isRun(loc.run)) return join(['runs']);
      var r = ['run', loc.process, loc.run];
      if (typeof loc.sub === 'string' && RUN_SUBS[loc.sub] === true) r.push(loc.sub);
      return join(r);
    }
    if (v === 'skill') return isHex(loc.skill) ? join(['skill', loc.skill]) : join(['skills']);
    return '#/';
  }

  /* The location of what's on screen, from the app's route fields only (never from the folder's data), so a folder read
     can't change it. null: a screen without a route (a test catches one). */
  var RUN_VIEWS = { run: '', mission: 'share', receipt: 'receipt', finish: 'finish' };
  function locate(s) {
    var v = s.view, H = PF.util.hash;
    if (v === 'home') return { view: 'home' };
    if (typeof v === 'string' && PAGES[v] === true) return { view: v };
    if (v === 'types') return !s.typeForm ? { view: 'types' } : s.typeForm.existing ? { view: 'types', type: s.typeForm.existing } : { view: 'types', sub: 'new' };
    if (v === 'recovery') return s.recoveryAt ? { view: 'recovery', section: s.recoveryAt } : { view: 'recovery' };
    if (v === 'process') {
      var loc = { view: 'process', process: s.processId };
      if (s.ptab === 'edit' || s.ptab === 'insights') loc.tab = s.ptab; else if (s.mapVer != null) loc.version = s.mapVer;
      return loc;
    }
    if (v === 'start') return s.planId != null ? { view: 'plan', plan: H(s.planId) } : isStage(s.testStage) ? { view: 'process', process: s.processId, sub: 'start', stage: s.testStage } : { view: 'process', process: s.processId, sub: 'start' };
    if (Object.prototype.hasOwnProperty.call(RUN_VIEWS, v)) {
      var k = String(s.runKey || ''), i = k.indexOf('/'), r = { view: 'run', process: k.slice(0, i), run: k.slice(i + 1) };
      if (RUN_VIEWS[v]) r.sub = RUN_VIEWS[v];
      return r;
    }
    if (v === 'skill') return { view: 'skill', skill: H(skillKey(s.skillFile)) };
    return null;
  }

  function parseNow(hash) {
    if (typeof hash !== 'string' || hash.length > MAX) return null;
    if (hash === '' || hash === '#' || hash === '#/') return { view: 'home' };
    if (hash.slice(0, 2) !== '#/') return null;
    var raw = hash.slice(2).split('/');
    if (raw.length > SEGS) return null;
    var s = [];
    for (var i = 0; i < raw.length; i++) {
      var d;
      try { d = decodeURIComponent(raw[i]); } catch (e) { return null; }
      if (!d || BAD.test(d) || d.indexOf('..') >= 0) return null;
      s.push(d);
    }
    var w = s[0], n = s.length;
    if (n === 1 && PAGES[w] === true) return { view: w };
    if (w === 'types') {
      if (n === 1) return { view: 'types' };
      if (n === 2 && s[1] === 'new') return { view: 'types', sub: 'new' };
      if (n === 3 && s[1] === 'edit' && isType(s[2])) return { view: 'types', type: s[2] };
      return null;
    }
    if (w === 'recovery') {
      if (n === 1) return { view: 'recovery' };
      return n === 2 && isAnchor(s[1]) ? { view: 'recovery', section: s[1] } : null;
    }
    if (w === 'process' && n >= 2 && isProcess(s[1])) {
      var loc = { view: 'process', process: s[1] };
      if (n === 2) return loc;
      if (n === 3 && TABS[s[2]] === true) { loc.tab = s[2]; return loc; }
      if (n === 3 && s[2] === 'current') { loc.version = 'current'; return loc; }
      if (n === 3 && s[2] === 'start') { loc.sub = 'start'; return loc; }
      if (n === 4 && s[2] === 'start' && isStage(s[3])) { loc.sub = 'start'; loc.stage = s[3]; return loc; }
      if (n === 4 && s[2] === 'v' && isVersion(s[3])) { loc.version = s[3]; return loc; }
      return null;
    }
    if (w === 'plan') return n === 2 && isHex(s[1]) ? { view: 'plan', plan: s[1] } : null;
    if (w === 'run' && (n === 3 || n === 4) && isProcess(s[1]) && isRun(s[2])) {
      var r = { view: 'run', process: s[1], run: s[2] };
      if (n === 3) return r;
      if (RUN_SUBS[s[3]] === true) { r.sub = s[3]; return r; }
      return null;
    }
    if (w === 'skill') return n === 2 && isHex(s[1]) ? { view: 'skill', skill: s[1] } : null;
    return null;
  }
  function parse(hash) { try { return parseNow(hash); } catch (e) { return null; } }

  /* history.state as Flightdeck writes it, { fd: 1, n, f }, or null for anything else (a typed hash, another page's). */
  function entry(s) {
    if (!s || typeof s !== 'object' || s.fd !== 1) return null;
    var n = s.n, f = s.f;
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || Math.floor(n) !== n || n > 1e9) return null;
    if (f !== null && !isHex(f)) return null;
    return { n: n, f: f };
  }

  return { MAX: MAX, locate: locate, format: format, parse: parse, entry: entry, isHex: isHex, skillKey: skillKey };
})();
