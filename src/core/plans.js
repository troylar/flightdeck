/* Planned runs (proposals/plan-*.json) and the decisions on them (proposals/<plan>.status-<writer>.json): the one checked
   reader the app and reading for other apps share (docs/design.md section 28). Pure. A plan or decision in a format from a
   newer Flightdeck (flightdeck-plan/2, an exact-folder pin; flightdeck-plan-status/2) is refused and named with the version it
   needs, never shown as a plan and never started on the latest. */
PF.plans = (function () {
  'use strict';
  var E = PF.envelope;
  function textOr(v) { return v == null || typeof v === 'string'; }
  function plainOf(v, ok) {
    if (v == null) return true;
    if (typeof v !== 'object' || Array.isArray(v)) return false;
    return Object.keys(v).every(function (k) { return ok(v[k]); });
  }
  /* What's wrong with a plan in today's format, or ''. */
  function planWhy(p) {
    if (typeof p.id !== 'string' || typeof p.process !== 'string') return 'is a plan without a text id and process';
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
    if (STATUSES.indexOf(x.status) < 0) return 'is a plan decision that isn\'t accepted or declined';
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
  function clean(o, name) {
    var k = familyOf(o, name);
    if (!k) return { ok: false, kind: 'malformed', why: 'isn\'t a file this copy can read here', needs: '' };
    var v = E.judge(k === 'status' ? 'flightdeck-plan-status' : 'flightdeck-plan', o);
    if (!v.ok) return { ok: false, kind: v.kind, why: v.kind === 'newer' ? 'is a ' + (k === 'status' ? 'plan decision' : 'plan') + ' made with a newer Flightdeck. ' + E.needsText(v.needs) : v.why, needs: v.needs || '' };
    return { ok: true, kind: k, why: k === 'plan' ? planWhy(o) : statusWhy(o) };
  }
  return { clean: clean, planWhy: planWhy, statusWhy: statusWhy, familyOf: familyOf };
})();
