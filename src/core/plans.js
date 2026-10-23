/* Planned runs (proposals/plan-*.json) and the decisions on them (proposals/<plan>.status-<writer>.json for a switch, <plan>.status-<writer>-d.json for a start or decline): the one checked
   reader the app and reading for other apps share (docs/design.md section 28). Pure.
   Two kinds of plan: a number plan (kind: plan, version: N) keeps the meaning every copy gives it (a version that's gone starts
   on the latest, and says so); a plan/2 (format: flightdeck-plan/2, no kind) pins one exact version folder, and every exact
   pin is one, even to a /1 version, so an older copy never sees it and never falls back. A plan/2 never starts on anything but
   its pin, or the version a person explicitly switched it to (a plan-status/2, retargeted). */
PF.plans = (function () {
  'use strict';
  var E = PF.envelope, FORMAT2 = 'flightdeck-plan/2', STATUS2 = 'flightdeck-plan-status/2', HASH8 = /^[0-9a-f]{8}$/;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  /* A plan/2 or plan-status/2, by its dispatch field. */
  function isExact(o) { return isObj(o) && (o.format === FORMAT2 || o.format === STATUS2); }
  /* An exact version folder: { folder, version } and, in a plan's pin, its two fingerprints. */
  function pinWhy(p, hashes) {
    var keys = hashes ? ['folder', 'version', 'mapHash', 'typesHash'] : ['folder', 'version'];
    if (!isObj(p) || Object.keys(p).some(function (k) { return keys.indexOf(k) < 0; })) return 'names a version that isn\'t a version folder';
    if (typeof p.folder !== 'string' || typeof p.version !== 'number' || PF.publish.versionOf(p.folder) !== p.version) return 'names a version that isn\'t a version folder';
    if (hashes && !(typeof p.mapHash === 'string' && HASH8.test(p.mapHash) && typeof p.typesHash === 'string' && HASH8.test(p.typesHash))) return 'names a version without its fingerprints';
    return '';
  }
  function textOr(v) { return v == null || typeof v === 'string'; }
  function plainOf(v, ok) {
    if (v == null) return true;
    if (typeof v !== 'object' || Array.isArray(v)) return false;
    return Object.keys(v).every(function (k) { return ok(v[k]); });
  }
  /* What's wrong with a plan in today's format, or ''. */
  function planWhy(p) {
    if (typeof p.id !== 'string' || typeof p.process !== 'string') return 'is a plan without a text id and process';
    if (p.format === FORMAT2) {
      if (p.version != null || p.kind != null) return 'is a plan that names a version two ways';
      var pw = pinWhy(p.pin, true); if (pw) return 'is a plan that ' + pw;
    }
    var bad = ['title', 'when', 'by', 'created', 'note'].filter(function (k) { return !textOr(p[k]); })[0];
    if (bad) return 'is a plan whose ' + bad + ' isn\'t text';
    /* A version is a version number (as the app reads it: a whole number from 1, or one written as digits). */
    if (!(p.version == null || (typeof p.version === 'string' && /^[1-9]\d{0,5}$/.test(p.version)) || (typeof p.version === 'number' && p.version >= 1 && Math.floor(p.version) === p.version))) return 'is a plan whose version isn\'t a version number';
    if (!plainOf(p.details, function (x) { return typeof x === 'string' || (typeof x === 'number' && isFinite(x)); })) return 'is a plan whose details aren\'t text';
    if (!plainOf(p.roles, function (x) { return typeof x === 'string'; })) return 'is a plan whose roles aren\'t people IDs';
    return '';
  }
  var STATUSES = ['accepted', 'declined'];
  function statusWhy(x) {
    if (typeof x.proposal !== 'string') return 'is a plan decision without a plan';
    var two = x.format === STATUS2;
    if (STATUSES.indexOf(x.status) < 0 && !(two && x.status === 'retargeted')) return 'is a plan decision that isn\'t accepted or declined';
    if (two && x.kind != null) return 'is a plan decision that names its format two ways';
    if (x.status === 'retargeted') { var tw = pinWhy(x.to, false); if (tw) return 'is a plan decision that ' + tw; }
    else if (x.to != null) return 'is a plan decision that names a version without switching to it';
    var bad = ['proposalHash', 'run', 'by', 'at'].filter(function (k) { return !textOr(x[k]); })[0];
    return bad ? 'is a plan decision whose ' + bad + ' isn\'t text' : '';
  }
  /* Which of the two a file in proposals/ is, from its name and its dispatch field: 'status', 'plan', or '' (neither). */
  function familyOf(o, name) {
    var f = o && typeof o === 'object' && !Array.isArray(o) && typeof o.format === 'string' ? E.parseFormat(o.format) : null;
    if (f && f.family === 'flightdeck-plan-status') return 'status';
    if (f && f.family === 'flightdeck-plan') return 'plan';
    if (o && o.kind === 'status') return 'status';
    if (o && o.kind === 'plan') return 'plan';
    return '';
  }
  /* The verdict on a file in proposals/: { ok: true, kind: 'plan' | 'status', why: '' (in the format) or what's wrong } or a
     refusal { ok: false, kind: 'newer' | 'malformed', why, needs }. Never throws. */
  function clean(o, name, v1) {
    var k = familyOf(o, name);
    /* Reading for other apps, contract 1, shows what 1.x reads: a plan/2 and its decisions are named newer, as before. */
    if (v1 && isExact(o)) return { ok: false, kind: 'newer', why: 'is a ' + (k === 'status' ? 'plan decision' : 'plan') + ' made with a newer Flightdeck. ' + E.needsText('2.0'), needs: '2.0' };
    if (!k) return { ok: false, kind: 'malformed', why: 'isn\'t a file this copy can read here', needs: '' };
    var v = E.judge(k === 'status' ? 'flightdeck-plan-status' : 'flightdeck-plan', o);
    if (!v.ok) return { ok: false, kind: v.kind, why: v.kind === 'newer' ? 'is a ' + (k === 'status' ? 'plan decision' : 'plan') + ' made with a newer Flightdeck. ' + E.needsText(v.needs) : v.why, needs: v.needs || '' };
    return { ok: true, kind: k, why: k === 'plan' ? planWhy(o) : statusWhy(o) };
  }
  /* A new plan for a published version pub: a plan/2 pinned to its exact folder when pub is a 2.0 version or exact is asked
     for, else a number plan (today's meaning). fields: id, process, title, details, roles, when, note, from, by, created. */
  function make(pub, fields, exact, app) {
    var two = exact || pub.info.format === PF.publish.FORMAT2, out = {};
    if (two) { out.format = FORMAT2; out.app = String(app || ''); } else out.kind = 'plan';
    out.id = fields.id; out.process = fields.process;
    if (two) out.pin = { folder: pub.info.folder, version: pub.info.version, mapHash: pub.info.mapHash, typesHash: pub.info.typesHash };
    else out.version = pub.info.version;
    ['title', 'details', 'roles', 'when', 'note', 'from', 'by', 'created'].forEach(function (k) { if (fields[k] != null) out[k] = fields[k]; });
    return out;
  }
  /* A decision on plan: for a plan/2, a plan-status/2 (retargeted carries to: { folder, version }); else today's. */
  function decision(plan, status, runId, by, at, to, app) {
    var out = {};
    if (plan.format === FORMAT2) { out.format = STATUS2; out.app = String(app || ''); } else out.kind = 'status';
    out.proposal = plan.id; out.proposalHash = plan._hash; out.status = status;
    if (status === 'retargeted') out.to = { folder: to.folder, version: to.version };
    else out.run = runId || null;
    out.by = by; out.at = at;
    return out;
  }
  /* The version a plan starts on, the same way for both kinds: { pub, older, missing, chosen, exact, ask }. A number plan:
     PF.publish.forPlan (chosen: the folder a person switched to in this window). A plan/2: its pin or the version it was
     retargeted to, else ask (pub null) and never the latest. */
  function pick(proc, plan, chosen) {
    if (plan.format !== FORMAT2) { var n = PF.publish.forPlan(proc, plan.version, chosen); n.exact = false; return n; }
    if (plan._retargetClash) return { pub: null, exact: true, ask: 'two people switched it to different versions (' + plan._retargetClash.join(', ') + '); delete the decision that\'s wrong' };
    var x = PF.pins.forPlan(proc, plan, plan._retarget || null);
    return { pub: x.pub, older: !!x.older, missing: false, chosen: !!x.retargeted && !!x.pub, exact: true, ask: x.pub ? '' : x.ask };
  }
  return { FORMAT2: FORMAT2, STATUS2: STATUS2, clean: clean, planWhy: planWhy, statusWhy: statusWhy, familyOf: familyOf, isExact: isExact, make: make, decision: decision, pick: pick };
})();
