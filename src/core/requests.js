/* Requests from other apps (docs/apps.md, docs/design.md section 26): `flightdeck plan request` asks for a run by writing a
   planned run to proposals/, which a person reviews and starts like any plan. Pure: no files.
   A request is a plan with only the fields plans already have, so every older copy lists it as one.
   Idempotent by (tool, key): the file name comes from both, and a request already in the folder is compared with this
   call's canonical intent before anything is resolved, so a retry writes nothing and keeps the original time and version. */
PF.requests = (function () {
  'use strict';
  var KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/, TOOL = /^[a-z0-9][a-z0-9-]{0,29}$/, TOOL_VERSION = /^[A-Za-z0-9_.+-]{1,40}$/;
  var PROC = /^[a-z0-9][a-z0-9-]{0,59}$/, NAME = /^[A-Za-z0-9_-]{1,60}$/, PERSON = /^[A-Za-z0-9_.-]{1,80}$/;
  var ID = /^req-([a-z0-9][a-z0-9-]{0,29})-([0-9a-f]{24})$/, BY = /^([a-z0-9][a-z0-9-]{0,29}) ([A-Za-z0-9_.+-]{1,40}) \(a tool\)$/;
  var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  /* bytes: the most a request (a file or stdin) may hold; the rest as the app's own plan form caps them. */
  var LIMITS = { bytes: 16384, title: 100, detail: 120, note: 250, entries: 40, version: 999999, file: 65536 };
  var FIELDS = ['process', 'version', 'title', 'details', 'roles', 'when', 'note', 'producer'];
  var CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
  /* What docs/apps.md must name (test/build.test.js checks it). */
  var CLI = { input: FIELDS.concat(['name']), statuses: ['requested', 'already', 'would-request', 'held'], errors: ['usage', 'invalid', 'key-taken', 'failed', 'not-found'],
    output: ['id', 'file', 'status', 'plan', 'leftEmpty', 'run'] };

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function reserved(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype' || k in Object.prototype; }
  function q(k) { return '"' + String(k).slice(0, 70) + '"'; }

  /* The plan's id and file stem: the tool's name, for people reading the folder, then 24 hex of SHA-256 over the encoded pair,
     so (a-b, c) and (a, b-c) never meet. */
  function idFor(tool, key) { return 'req-' + tool + '-' + PF.sha256.hex(JSON.stringify([tool, key])).slice(0, 24); }
  /* The file itself, or a copy OneDrive kept beside it ("-LAPTOP", " (1)"): the name, then a marker that never starts with a
     digit or a dot, so a plan decision (<id>.status-…) is never one. A name can look like a copy of another request's (a tool
     named a-<hash>-x), so the reader also checks the id inside. */
  function isCopyName(name, id) {
    if (typeof name !== 'string' || name.slice(0, id.length) !== id || !/\.json$/.test(name)) return false;
    var rest = name.slice(id.length, -5);
    return rest === '' || /^[^\d.\/\\][^\/\\]{0,99}$/.test(rest);
  }

  /* An untrusted value (parsed JSON) and its key as a request: { intent, errors }. The intent keeps what the caller supplied
     (supplied: only the fields given) apart from anything Flightdeck resolves later. With errors, intent is what could be read,
     so the checklist's own reasons can be added; nothing is ever written from it. */
  function clean(v, key) {
    var errors = [], supplied = {}, out = { key: key, process: '', producer: { name: '', version: '' }, supplied: supplied };
    if (typeof key !== 'string' || !KEY.test(key)) errors.push('The key is lowercase letters, numbers, dots, dashes or underscores, at most 64 characters, starting with a letter or number, like 2026-11.');
    if (!isMap(v)) return { intent: null, errors: errors.concat('A request is a JSON object, like {"process": "backup-check", "producer": {"name": "my-tool", "version": "1.0"}}.') };
    Object.keys(v).forEach(function (k) { if (FIELDS.indexOf(k) < 0) errors.push('The request has ' + q(k) + ', which a request doesn\'t have. It can have: ' + FIELDS.join(', ') + '.'); });
    var given = function (k) { return own(v, k) && v[k] !== null && v[k] !== undefined; };
    var text = function (k, x, max, what) {
      if (typeof x !== 'string' || !x.trim()) { errors.push(what + ' is text.'); return null; }
      if (x.length > max) { errors.push(what + ' is ' + x.length + ' characters; the most is ' + max + '.'); return null; }
      if (CONTROL.test(x)) { errors.push(what + ' has a line break or another control character.'); return null; }
      return x;
    };
    if (typeof v.process !== 'string' || !PROC.test(v.process)) errors.push('"process" is a process ID: lowercase letters, numbers and dashes, like backup-check.');
    else out.process = v.process;
    var p = v.producer;
    if (!isMap(p)) errors.push('"producer" is {"name": "<your tool>", "version": "<its version>"}.');
    else {
      var bad = Object.keys(p).filter(function (k) { return k !== 'name' && k !== 'version'; });
      bad.forEach(function (k) { errors.push('"producer" has ' + q(k) + '; it has only name and version.'); });
      var okName = typeof p.name === 'string' && TOOL.test(p.name), okVer = typeof p.version === 'string' && TOOL_VERSION.test(p.version);
      if (!okName) errors.push('"producer" name is lowercase letters, numbers and dashes, at most 30 characters, like ci-check.');
      if (!okVer) errors.push('"producer" version is letters, numbers, dots, dashes, underscores or pluses, at most 40 characters, like 1.4.0.');
      if (okName && okVer && !bad.length) out.producer = { name: p.name, version: p.version };
    }
    if (given('version')) {
      if (typeof v.version !== 'number' || Math.floor(v.version) !== v.version || v.version < 1 || v.version > LIMITS.version) errors.push('"version" is a version number, like 3.');
      else supplied.version = v.version;
    }
    if (given('title')) { var t = text('title', v.title, LIMITS.title, '"title"'); if (t !== null) supplied.title = t; }
    if (given('when')) {
      var at = typeof v.when === 'string' && ISO.test(v.when) ? Date.parse(v.when) : NaN;
      if (isNaN(at)) errors.push('"when" is a date and time with its zone, like 2026-11-01T09:00:00Z.');
      else supplied.when = new Date(at).toISOString();
    }
    if (given('note')) { var n = text('note', v.note, LIMITS.note, '"note"'); if (n !== null) supplied.note = n; }
    ['details', 'roles'].forEach(function (k) {
      if (!given(k)) return;
      if (!isMap(v[k])) { errors.push(q(k) + ' is an object of names and ' + (k === 'details' ? 'text' : 'people IDs') + '.'); return; }
      var keys = Object.keys(v[k]), m = {};
      if (keys.length > LIMITS.entries) { errors.push(q(k) + ' has ' + keys.length + ' entries; the most is ' + LIMITS.entries + '.'); return; }
      keys.forEach(function (name) {
        var x = v[k][name];
        if (!NAME.test(name) || reserved(name)) { errors.push(q(k) + ' has ' + q(name) + ', which can\'t be a ' + (k === 'details' ? 'run detail' : 'role') + '\'s name.'); return; }
        if (k === 'details') { var d = text(name, x, LIMITS.detail, 'Run detail ' + q(name)); if (d !== null) m[name] = d; }
        else if (typeof x !== 'string' || !PERSON.test(x) || reserved(x)) errors.push('Role ' + q(name) + ' is a person\'s ID from people.json, like person-casey.');
        else m[name] = x;
      });
      supplied[k] = m;
    });
    return { intent: out, errors: errors };
  }

  /* The canonical intent: what this request asks for, whatever order or form it came in. version and title are null when
     left out (Flightdeck chooses them: the latest usable version and its checklist's title); details, roles, when and note
     have no default, so leaving one out asks for none. The tool's version is never part of it. */
  function canonical(intent) {
    var s = intent.supplied;
    return { process: intent.process, producer: intent.producer.name, version: s.version != null ? s.version : null, title: s.title != null ? s.title : null,
      details: sorted(s.details || {}), roles: sorted(s.roles || {}), when: s.when || null, note: s.note != null ? s.note : null };
  }
  function sorted(m) { var o = {}; Object.keys(m).sort().forEach(function (k) { o[k] = m[k]; }); return o; }
  function prefix(tool) { return 'Requested by ' + tool + '.'; }
  function noteFor(tool, note) { return prefix(tool) + (note != null ? ' ' + note : ''); }
  /* A plan already in the folder, read back as the canonical intent that would have written it. A field it can't hold as
     text (a hand edit) is kept as it is, so it compares unequal. */
  function intentOf(plan) {
    var c = claim(plan), tool = c ? c.name : null, note = plan.note, n = null;
    if (typeof note === 'string' && tool) {
      if (note === prefix(tool)) n = null;
      else if (note.indexOf(prefix(tool) + ' ') === 0) n = note.slice(prefix(tool).length + 1);
      else n = { raw: note };
    } else n = { raw: note };
    var when = plan.when == null ? null : typeof plan.when === 'string' && !isNaN(Date.parse(plan.when)) ? new Date(Date.parse(plan.when)).toISOString() : { raw: plan.when };
    var version = typeof plan.version === 'number' ? plan.version : typeof plan.version === 'string' && /^\d+$/.test(plan.version) ? +plan.version : { raw: plan.version };
    return { process: plan.process, producer: tool, version: version, title: plan.title, details: isMap(plan.details) ? sorted(plan.details) : { raw: plan.details },
      roles: isMap(plan.roles) ? sorted(plan.roles) : { raw: plan.roles }, when: when, note: n };
  }
  /* Which fields of this call's canonical intent differ from a plan already under its name (empty: the same request). The
     version and title Flightdeck chose are compared only when this call names them, so the original choice stands. */
  function differs(intent, plan) {
    if (!isMap(plan) || plan.kind !== 'plan') return ['kind'];
    var a = canonical(intent), b = intentOf(plan), out = [];
    if (b.producer !== a.producer) out.push('tool');
    ['process', 'version', 'title', 'details', 'roles', 'when', 'note'].forEach(function (k) {
      if ((k === 'version' || k === 'title') && a[k] === null) return;
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
    });
    return out;
  }

  function versionOf(p) { var v = p && p.info ? p.info.version : null; return typeof v === 'number' ? v : PF.publish.versionOf(p && p.folder); }
  /* What this request asks for, against its process as loaded (a loadAll processes entry): the version it starts on (the one
     named, else the latest this copy can use) and the reasons it can't be. Run details must be the checklist's, roles its roles. */
  function check(intent, proc) {
    var s = intent.supplied, idx = proc && proc.index;
    if (!proc || !(proc.pubs || []).length) return { notFound: 'There\'s no published checklist for ' + intent.process + ' in the team folder.' };
    var pub = null;
    if (s.version != null) {
      var any = proc.pubs.filter(function (x) { return versionOf(x) === s.version; });
      if (!any.length) return { notFound: 'There\'s no version ' + s.version + ' of ' + intent.process + ' in the team folder.' };
      var usable = ((idx && idx.all) || []).filter(function (x) { return x.info.version === s.version; });
      if (usable.length !== 1 || ((idx && idx.clashes) || []).indexOf(s.version) >= 0) {
        var bad = any.filter(function (x) { return !x.ok; })[0];
        return { errors: ['Version ' + s.version + ' of ' + intent.process + ' can\'t be used here' + (bad && bad.why ? ': ' + bad.why : usable.length > 1 ? ': two versions have that number.' : '.')] };
      }
      pub = usable[0];
    } else {
      pub = idx && idx.latest;
      if (!pub) return { errors: ['None of the versions of ' + intent.process + ' can be used here, so it can\'t be requested.'] };
    }
    var meta = pub.map.meta, errors = [], title = (meta.title || intent.process) + ' v' + pub.info.version;
    Object.keys(s.details || {}).forEach(function (k) { if (meta.context.indexOf(k) < 0) errors.push(q(k) + ' isn\'t a run detail of ' + title + '. It has: ' + (meta.context.join(', ') || 'none') + '.'); });
    Object.keys(s.roles || {}).forEach(function (k) { if (meta.roles.indexOf(k) < 0) errors.push(q(k) + ' isn\'t a role in ' + title + '. It has: ' + (meta.roles.join(', ') || 'none') + '.'); });
    return errors.length ? { errors: errors } : { pub: pub };
  }
  /* Roles whose person isn't active in people.json: kept in the plan as asked, and left empty by the start form (it offers
     active people only), so the person who starts the run chooses. */
  function leftEmpty(intent, people) {
    var on = Object.create(null), roles = intent.supplied.roles || {};
    (people || []).forEach(function (p) { if (p && typeof p.id === 'string' && !p.inactive) on[p.id] = true; });
    return Object.keys(roles).filter(function (k) { return !on[roles[k]]; }).sort();
  }
  /* The plan written: only fields plans already have, in the order the app writes them. */
  function build(intent, pub, now) {
    var s = intent.supplied, tool = intent.producer.name;
    var plan = { kind: 'plan', id: idFor(tool, intent.key), process: intent.process, version: pub.info.version,
      title: s.title != null ? s.title : String(pub.map.meta.title || intent.process).slice(0, LIMITS.title), details: sorted(s.details || {}), roles: sorted(s.roles || {}) };
    if (s.when) plan.when = s.when;
    plan.note = noteFor(tool, s.note);
    plan.by = tool + ' ' + intent.producer.version + ' (a tool)';
    plan.created = now;
    return plan;
  }
  function text(plan) { return JSON.stringify(plan, null, 2) + '\n'; }

  /* Who a plan says asked for it, when it's a request: { name, version } from its id and by, or null. A claim: anyone who can
     write to the folder can write this. */
  function claim(plan) {
    var m = plan && typeof plan.id === 'string' ? ID.exec(plan.id) : null, b = m && typeof plan.by === 'string' ? BY.exec(plan.by) : null;
    return b && b[1] === m[1] ? { name: b[1], version: b[2] } : null;
  }
  /* Two files holding one plan (OneDrive copies) say the same thing: equal apart from when each was written, and, for a
     request from the same tool on both, which version of the tool wrote it (that's never part of what it asks for). */
  function same(a, b) {
    function canon(v) {
      if (Array.isArray(v)) return v.map(canon);
      if (isMap(v)) { var o = {}; Object.keys(v).sort().forEach(function (k) { if (k[0] !== '_') o[k] = canon(v[k]); }); return o; }
      return v;
    }
    var x = canon(a), y = canon(b), ca = claim(a), cb = claim(b);
    delete x.created; delete y.created;
    if (ca && cb && ca.name === cb.name) { delete x.by; delete y.by; }
    return JSON.stringify(x) === JSON.stringify(y);
  }

  return { KEY: KEY, TOOL: TOOL, LIMITS: LIMITS, CLI: CLI, idFor: idFor, isCopyName: isCopyName, clean: clean, canonical: canonical, differs: differs, check: check,
    leftEmpty: leftEmpty, build: build, text: text, claim: claim, same: same };
})();
