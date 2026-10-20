/* File formats: the envelope every file in the team folder has, explicit or in a legacy spelling, and the one verdict every
   reader takes before it reads a field (docs/design.md section 28). Pure, ES5. A reader that doesn't know a file's family, its
   major version or one of its must-understand features refuses it, names it and never guesses what it means.

   The 1.21 bridge knows every 1.x format and the names of the 2.0 ones (FROZEN), only to refuse those precisely ("Needs
   Flightdeck 2.0"). It knows no feature: each later slice registers only the features it implements. */
PF.envelope = (function () {
  'use strict';
  var FORMAT = /^([a-z][a-z0-9-]{1,59})\/([1-9]\d{0,3})$/, FEATURE = /^[a-z][a-z0-9-]{1,39}$/, MAX_FEATURES = 32;

  /* Every family, with the majors this copy reads and the features it knows in each, its legacy spelling, and whether this
     copy may rewrite such a file. future: majors the 2.0 contract defines (frozen here so messages can name the version).
       legacy.kind: the kind field that marks the family; legacy.field: the field that holds the major (missing = legacyMajor);
       unmarked: a file with no marker at all is major 1 (step types, people.json, skills, types.json entries). */
  var FAMILIES = {
    'flightdeck-checklist': { files: 'maps/drafts/*.md, publications/<p>/<v>/map.md', majors: { 1: [] }, rewrite: true, syntax: true, future: { 2: '2.0' } },
    'preflight-publication': { files: 'publications/<p>/<v>/publication.json', majors: { 1: [] }, rewrite: false, future: { 2: '2.0' } },
    'preflight-run': { files: 'runs/<p>/<id>/run.json and its copies', majors: { 2: [] }, rewrite: true, future: { 3: '2.0' }, legacyOnly: { 1: 'runs/*.json (v0.1)' } },
    'flightdeck-run-archive': { files: 'runs/<p>/<id>/history-*.jsonl lines', majors: { 1: [] }, rewrite: false, legacy: { kinds: ['log', 'answer', 'migration'], field: 'av' }, legacyMajor: 1 },
    'flightdeck-step-type': { files: 'step-types/*.json', majors: { 1: [] }, rewrite: true, unmarked: true, future: { 2: '2.0' } },
    'flightdeck-types': { files: 'types.json entries', majors: { 1: [], 2: [] }, rewrite: false, legacy: { field: 'version' }, legacyMajor: 1, future: { 3: '2.0' } },
    'flightdeck-plan': { files: 'proposals/plan-*.json', majors: { 1: [] }, rewrite: true, legacy: { kinds: ['plan'] }, legacyMajor: 1, future: { 2: '2.0' } },
    'flightdeck-plan-status': { files: 'proposals/*.status-*.json', majors: { 1: [] }, rewrite: false, legacy: { kinds: ['status'] }, legacyMajor: 1, future: { 2: '2.0' } },
    'flightdeck-validation': { files: 'validations/*.json', majors: { 1: [] }, rewrite: false, legacy: { kinds: ['validation'] }, legacyMajor: 1, future: { 2: '2.0' } },
    'flightdeck-followup-decision': { files: 'followups/<p>/*.json', majors: { 1: [] }, rewrite: false, legacy: { kinds: ['followup-decision'], field: 'fv' }, legacyMajor: 1 },
    /* dv 0 (missing) and 1 are decisions from before results were recorded; 2 is today's. */
    'flightdeck-correction-decision': { files: 'corrections/<p>/*.json', majors: { 0: [], 1: [], 2: [] }, rewrite: false, legacy: { kinds: ['correction-decision'], field: 'dv' }, legacyMajor: 0 },
    'flightdeck-fix-decision': { files: 'suggestions/<p>/*.json (1.11 to 1.12)', majors: { 1: [] }, rewrite: false, legacy: { kinds: ['fix-decision'] }, legacyMajor: 1 },
    'flightdeck-proposal': { files: 'proposed/<p>/<op>.json', majors: { 1: [] }, rewrite: false, legacy: { kinds: ['draft-proposal'], field: 'pv' } },
    'flightdeck-presence': { files: 'presence/*.json', majors: { 1: [] }, rewrite: true, legacy: { kinds: ['presence'], field: 'pv' } },
    'flightdeck-connection': { files: 'connection/*.json', majors: { 1: [] }, rewrite: false, legacy: { kinds: ['connection-probe', 'connection-ack'], field: 'cv' } },
    'flightdeck-people': { files: 'people.json', majors: { 1: [] }, rewrite: true, unmarked: true },
    'flightdeck-skill': { files: 'skills/*.json (number pins); skill-registrations/<name>/*.json (exact pins, 2.0)', majors: { 1: [] }, rewrite: false, unmarked: true, future: { 2: '2.0' } },
    'flightdeck-editor-history': { files: 'history/drafts/**, history/step-types/** lines', majors: { 1: [] }, rewrite: false, legacy: { field: 'v' } },
    'flightdeck-installed': { files: '.flightdeck/installed.json', majors: { 1: [] }, rewrite: true },
    'flightdeck-stage-decision': { files: 'staged/<p>/decisions/*.json', majors: {}, rewrite: false, future: { 1: '2.0' } },
    'flightdeck-extension': { files: 'extensions/<ns>/**', majors: {}, rewrite: false, future: { 1: '2.0' } },
    'flightdeck-report': { files: 'reports/<p>/*.json', majors: {}, rewrite: false, future: { 1: '2.0' } },
    'flightdeck-report-decision': { files: 'report-decisions/<p>/*.json', majors: {}, rewrite: false, future: { 1: '2.0' } }
  };
  /* The 2.0 must-understand features, frozen by name (the 2.0 plan). No copy before 2.0 knows any of them. */
  var FROZEN = ['typed-details', 'typed-evidence', 'phase-notes', 'phase-shots', 'gate-shots', 'pinned-children', 'pinned-skills', 'staged', 'test-run', 'extensions'];

  /* Any JSON value as text for a message, without calling anything on it (a file can hold {"toString": null}). */
  function txt(v) { if (typeof v === 'string') return v; var t; try { t = JSON.stringify(v); } catch (e) { t = ''; } return typeof t === 'string' ? t : typeof v; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function obj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function cmp(a, b) { for (var i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); return 0; }
  /* "2.0.0" → [2, 0, 0]; anything else null. Never trusted for meaning, only to name a version in a message. */
  function semver(v) { var m = typeof v === 'string' ? /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(v) : null; return m ? [+m[1], +m[2], +m[3]] : null; }
  /* "preflight-run/3" → { family, major }, or null. */
  function parseFormat(s) { var m = typeof s === 'string' ? FORMAT.exec(s) : null; return m ? { family: m[1], major: +m[2] } : null; }

  /* The version a file needs, in words: its own app field when that says a version, else the version the contract gives
     the major or the feature, else none. */
  function needsOf(fam, major, features, o) {
    var a = semver(o && o.app);
    if (a && a[0] >= 2) return a[0] + '.' + a[1];
    if (fam && fam.future && major != null && own(fam.future, major)) return fam.future[major];
    if (features && features.some(function (f) { return FROZEN.indexOf(f) >= 0; })) return '2.0';
    return '';
  }
  function needsText(needs) { return needs ? 'Needs Flightdeck ' + needs + '.' : 'Needs a newer Flightdeck.'; }
  function refuse(kind, why, extra) { var r = { ok: false, kind: kind, why: why }; if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; }); return r; }

  /* The verdict on one record of a family: { ok, family, major, features, legacy } or { ok: false, kind: 'newer' | 'malformed',
     why, needs }. Never throws, whatever the value (prototype-free checks, types before tests). */
  function judge(family, o) {
    var fam = own(FAMILIES, family) ? FAMILIES[family] : null;
    if (!fam) return refuse('malformed', 'isn\'t a kind of file Flightdeck knows (' + txt(family).slice(0, 60) + ')');
    if (family === 'flightdeck-people' && Array.isArray(o)) return { ok: true, family: family, major: 1, features: [], legacy: true };
    if (!obj(o)) return refuse('malformed', 'isn\'t a JSON object');
    var major = null, legacy = false, features = [];
    if (own(o, 'format') && o.format != null) {
      var f = parseFormat(o.format);
      if (!f) return refuse('malformed', 'has a format this copy can\'t read ("' + txt(o.format).slice(0, 60) + '")');
      if (f.family !== family) {
        var other = own(FAMILIES, f.family) ? FAMILIES[f.family] : null;
        if (!other) return refuse('newer', 'is a ' + f.family + ' file, which this copy doesn\'t know. ' + needsText(needsOf(null, null, null, o)), { needs: needsOf(null, null, null, o), format: o.format });
        return refuse('malformed', 'is a ' + f.family + ' file, not a ' + family + ' file');
      }
      major = f.major;
    } else if (fam.legacy) {
      var L = fam.legacy;
      if (L.kinds && L.kinds.indexOf(o.kind) < 0) return refuse('malformed', 'isn\'t a ' + family + ' file');
      if (L.field && own(o, L.field) && o[L.field] != null) {
        var v = o[L.field];
        if (typeof v !== 'number' || !isFinite(v) || v < 0 || Math.floor(v) !== v || v > 9999) return refuse('malformed', 'has a "' + L.field + '" that isn\'t a version number');
        major = v;
      } else if (fam.legacyMajor != null) major = fam.legacyMajor;
      else return refuse('malformed', 'has no "' + L.field + '"');
      legacy = true;
    } else if (fam.unmarked) { major = 1; legacy = true; }
    else return refuse('malformed', 'has no format');
    if (own(o, 'features') && o.features != null) {
      if (!Array.isArray(o.features) || o.features.length > MAX_FEATURES || !o.features.every(function (x) { return typeof x === 'string' && FEATURE.test(x); })) return refuse('malformed', 'has a "features" list this copy can\'t read');
      features = o.features.slice();
    }
    if (!own(fam.majors, major)) {
      var n = needsOf(fam, major, features, o);
      return refuse('newer', 'was made with a newer Flightdeck (' + family + '/' + major + '). ' + needsText(n), { needs: n, family: family, major: major });
    }
    var known = fam.majors[major], unknown = features.filter(function (x) { return known.indexOf(x) < 0; });
    if (unknown.length) {
      var n2 = needsOf(fam, null, unknown, o);
      return refuse('newer', 'uses ' + unknown.slice(0, 5).join(', ') + ', which this copy doesn\'t understand. ' + needsText(n2), { needs: n2, family: family, major: major, unknown: unknown });
    }
    return { ok: true, family: family, major: major, features: features, legacy: legacy };
  }

  /* The fields a writer adds: none while the lowest sufficient format is the 1.x one. The bridge writes nothing new, so any
     feature is refused here rather than stamped. */
  function stamp(family, features) {
    if (!own(FAMILIES, family)) throw new Error('No file family ' + family + '.');
    if (features && features.length) throw new Error('This copy of Flightdeck writes no ' + features.join(', ') + '.');
    return {};
  }

  /* A checklist's verdict from its front matter. There are no front-matter-only minimums: a format: or features: line counts
     only beside a body construct that every older parser rejects, and this copy parses none, so the line alone is a blocker
     (with a newer major or an unknown feature, the version that's needed is named). '' when there's no such line. */
  function markdown(meta) {
    if (!obj(meta) || (!own(meta, 'format') && !own(meta, 'features'))) return { ok: true, why: '' };
    var f = own(meta, 'format') ? parseFormat(txt(meta.format).trim()) : null;
    var feats = own(meta, 'features') ? txt(meta.features).split(',').map(function (x) { return x.trim(); }).filter(Boolean) : [];
    var known = FAMILIES['flightdeck-checklist'];
    if (own(meta, 'format') && (!f || f.family !== 'flightdeck-checklist')) return refuse('malformed', 'The front matter says "format: ' + txt(meta.format).slice(0, 60) + '", which isn\'t a checklist format. Remove the format line.');
    if (f && !own(known.majors, f.major)) { var n = needsOf(known, f.major, feats, null); return refuse('newer', 'This checklist says it needs ' + (n ? 'Flightdeck ' + n : 'a newer Flightdeck') + ' (format: ' + txt(meta.format).slice(0, 60) + ').' + (n === '2.0' ? ' Nothing in it needs Flightdeck 2.0 that this copy can see; if nothing does, remove the format line.' : ''), { needs: n }); }
    var unknown = feats.filter(function (x) { return known.majors[f ? f.major : 1].indexOf(x) < 0; });
    if (unknown.length) { var n2 = needsOf(known, null, unknown, null); return refuse('newer', 'This checklist says it uses ' + unknown.slice(0, 5).join(', ') + ', which ' + (n2 ? 'needs Flightdeck ' + n2 : 'this copy doesn\'t understand') + '. Remove the features line if nothing in it does.', { needs: n2 }); }
    return refuse('malformed', 'This says it needs Flightdeck 2.0, but nothing in it does. Remove the format line.');
  }

  /* The family a JSON file in the team folder belongs to, by its path; '' for paths with no JSON family. */
  function familyOfPath(p) {
    p = typeof p === 'string' ? p : '';
    if (/^people\.json$/.test(p)) return 'flightdeck-people';
    if (/^(publications|staged)\/[^/]+\/[^/]+\/publication\.json$/.test(p)) return 'preflight-publication';
    if (/^runs\/[^/]+\/[^/]+\/(run|run\.conflict-[^/]+|run-[^/]+|replaced-[^/]+|candidate-[^/]+)\.json$/.test(p)) return 'preflight-run';
    if (/^step-types\/[^/]+\.json$/.test(p)) return 'flightdeck-step-type';
    if (/^proposals\/[^/]+\.status-[^/]+\.json$/.test(p)) return 'flightdeck-plan-status';
    if (/^proposals\/[^/]+\.json$/.test(p)) return 'flightdeck-plan';
    if (/^validations\/[^/]+\.json$/.test(p)) return 'flightdeck-validation';
    if (/^followups\/[^/]+\/[^/]+\.json$/.test(p)) return 'flightdeck-followup-decision';
    if (/^corrections\/[^/]+\/[^/]+\.json$/.test(p)) return 'flightdeck-correction-decision';
    if (/^suggestions\/[^/]+\/[^/]+\.json$/.test(p)) return 'flightdeck-fix-decision';
    if (/^proposed\/[^/]+\/[^/]+\.json$/.test(p)) return 'flightdeck-proposal';
    if (/^presence\/[^/]+\.json$/.test(p)) return 'flightdeck-presence';
    if (/^connection\/[^/]+\.json$/.test(p)) return 'flightdeck-connection';
    if (/^skills\/[^/]+\.json$/.test(p) || /^skill-registrations\//.test(p)) return 'flightdeck-skill';
    if (/^\.flightdeck\/installed\.json$/.test(p)) return 'flightdeck-installed';
    if (/^staged\/[^/]+\/decisions\//.test(p)) return 'flightdeck-stage-decision';
    if (/^extensions\//.test(p)) return 'flightdeck-extension';
    if (/^reports\//.test(p)) return 'flightdeck-report';
    if (/^report-decisions\//.test(p)) return 'flightdeck-report-decision';
    return '';
  }
  /* A refusal as a reader keeps it, by path: { path, family, kind, why, needs }. */
  function refusal(path, family, v) { return { path: txt(path), family: typeof family === 'string' ? family : '', kind: v.kind === 'newer' ? 'newer' : 'malformed', why: typeof v.why === 'string' ? v.why : '', needs: typeof v.needs === 'string' ? v.needs : '' }; }

  return { FAMILIES: FAMILIES, FROZEN: FROZEN, FEATURE: FEATURE, MAX_FEATURES: MAX_FEATURES, parseFormat: parseFormat, semver: semver, cmp: cmp,
    txt: txt, judge: judge, stamp: stamp, markdown: markdown, needsText: needsText, familyOfPath: familyOfPath, refusal: refusal };
})();
