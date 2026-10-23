/* Shapes for other apps (docs/apps.md): what `flightdeck processes | process | runs | run | next | followups --json` and
   `flightdeck plan request` print,
   built only from the app's own rules (R.nextUp, R.myNext, R.headline, R.totals, R.evidenceFor, PF.followups.list), so an
   app reads exactly what a person sees. Pure: no files. One versioned envelope (flightdeck-read/1); adding a field keeps
   the version, removing one or changing what it means is a new version. People are an ID and a name: people-directory
   email fields are omitted. (contract.js already means the AGENTS.md hash contract, hence this name.) */
PF.appjson = (function () {
  'use strict';
  var R = PF.run, M = PF.map, T = PF.types, P = PF.publish, F = PF.followups;
  var CONTRACT = 'flightdeck-read/1', CONTRACT2 = 'flightdeck-read/2', VERSIONS = [1, 2];
  var NOTE = 'Read from the team folder just now; another computer may be a minute ahead. A passed gate means passed for those details, by that person, at that time. People-directory email fields are omitted.';
  /* Every problem is one file or folder and one of these. */
  var KINDS = ['unreadable', 'nofile', 'malformed', 'newer', 'unusable', 'conflict', 'still-syncing', 'link', 'skipped', 'vanished'];

  /* ---- the schema: what each command's data holds, checked by conforms() and documented in docs/apps.md ----
     'string', 'number', 'boolean'; [x] a list of x; { k: x } an object with exactly these keys; opt(x) x or null;
     map(x) an object of any keys whose values are x. */
  function opt(x) { return { $or: [x, 'null'] }; }
  function map(x) { return { $map: x }; }
  var PERSON = { id: 'string', name: opt('string') };
  var EVIDENCE = { name: 'string', label: 'string', kind: 'string', required: 'boolean', options: ['string'] };
  var TIMING = { at: opt('string'), due: opt('string'), after: opt('string') };
  var VERSION = { folder: 'string', version: opt('number'), publishedAt: opt('string'), publishedBy: opt('string'), usable: 'boolean', why: opt('string'), clash: 'boolean' };
  var ABOUT = { id: 'string', title: 'string', category: 'string', group: ['string'], tags: ['string'], owner: opt('string') };
  var HEADLINE = { status: 'string', text: 'string', detail: 'string' };
  var SUMMARY = { key: 'string', id: 'string', process: 'string', title: 'string', version: 'number', folder: 'string', state: 'string', paused: 'boolean',
    created: 'string', ended: opt({ outcome: 'string', at: 'string', by: opt(PERSON) }), recorder: opt(PERSON), details: map('string'),
    progress: { done: 'number', total: 'number' }, headline: HEADLINE, readOnly: opt('string'), marksComplete: 'boolean' };
  var DECISION = { status: 'string', by: opt(PERSON), at: 'string', rev: 'number', ticket: opt('string'), link: opt('string'), to: opt('string'), reason: opt('string'), note: opt('string') };
  var FOLLOWUP = { key: 'string', process: 'string', run: 'string', runTitle: 'string', runEnded: 'boolean', id: 'string', text: 'string', owner: opt(PERSON),
    ticket: 'string', step: 'string', at: 'string', status: 'string', label: 'string', tie: 'boolean', decision: opt(DECISION) };
  var ROLE = { role: 'string', person: opt(PERSON) };
  var SCHEMA = {
    envelope: { contract: 'string', app: 'string', readAt: 'string', complete: 'boolean', problems: [{ path: 'string', kind: 'string', why: 'string' }], note: 'string', data: map('any') },
    error: { contract: 'string', app: 'string', error: { kind: 'string', why: 'string' }, problems: [{ path: 'string', kind: 'string', why: 'string' }] },
    processes: { processes: [{ id: 'string', title: 'string', category: 'string', group: ['string'], tags: ['string'], owner: opt('string'), latest: opt({ version: 'number', folder: 'string' }), versions: [VERSION] }] },
    process: { process: ABOUT, version: VERSION, usable: 'boolean', evidenceFrom: 'string', context: ['string'], roles: ['string'], types: [{ id: 'string', label: 'string' }],
      phases: [{ id: 'string', title: 'string', mode: 'string', tracks: [{ id: 'string', title: 'string', roles: ['string'] }],
        steps: [{ id: 'string', text: 'string', type: 'string', must: 'boolean', planned: 'boolean', roles: ['string'], binds: ['string'], sets: ['string'], fields: map('string'), track: opt('string'), timing: TIMING, evidence: [EVIDENCE] }],
        gate: { id: 'string', title: 'string', implicit: 'boolean', owner: opt('string'), approves: 'string', binds: ['string'], note: 'string', timing: TIMING } }] },
    runs: { runs: [SUMMARY], planned: [{ id: 'string', process: 'string', title: 'string', version: opt('number'), when: opt('string'), by: 'string', created: opt('string'), note: 'string',
      details: map('string'), roles: map('string'), status: 'string', run: opt('string'), startsOn: opt({ version: 'number', folder: 'string' }), versionMissing: opt('boolean'),
      copies: 'number', copiesDiffer: 'boolean', requestedBy: opt({ name: 'string', version: 'string' }), held: opt({ why: 'string', files: [{ file: 'string', kind: 'string' }] }) }] },
    run: { run: opt(extend(SUMMARY, { roles: [ROLE],
      steps: [{ id: 'string', phase: 'string', text: 'string', type: 'string', must: 'boolean', roles: ['string'], state: 'string', by: opt(PERSON), at: opt('string'), reason: opt('string'),
        values: map('string'), differently: opt({ note: 'string', by: opt(PERSON), at: opt('string') }), marks: ['string'], child: opt({ process: 'string', id: 'string' }), evidence: [EVIDENCE] }],
      gates: [{ id: 'string', phase: 'string', title: 'string', status: 'string', by: opt(PERSON), at: opt('string'), reason: opt('string'), approved: map('string') }],
      followUps: [FOLLOWUP] })) },
    next: { run: 'string', person: opt(PERSON),
      next: opt({ kind: 'string', headline: HEADLINE, phase: opt({ index: 'number', id: 'string', title: 'string' }), step: opt({ id: 'string', text: 'string', roles: [ROLE] }),
        gate: opt({ id: 'string', title: 'string', status: 'string', owner: opt('string') }),
        tracks: [{ id: 'string', title: 'string', left: 'number', step: opt({ id: 'string', text: 'string' }), people: [PERSON] }] }),
      mine: opt({ phase: { index: 'number', id: 'string', title: 'string' }, step: { id: 'string', text: 'string' } }) },
    followups: { followUps: [FOLLOWUP] },
    /* flightdeck plan request (1.20): what it did, and the plan as written, as already in the folder, or as it would be written. */
    request: { request: { id: 'string', file: 'string', status: 'string', plan: opt({ id: 'string', process: 'string', version: 'number', title: 'string', details: map('string'),
      roles: map('string'), when: opt('string'), note: 'string', by: 'string', created: 'string' }), leftEmpty: ['string'], run: opt('string') } },
    /* flightdeck report check | write (2.0, flightdeck-read/2): the report as read, where it goes, and what it would mean. */
    report: { report: { file: 'string', sha256: opt('string'), status: 'string', run: 'string', step: 'string', id: 'string', verdict: 'string', producer: { name: 'string', version: 'string' },
      created: 'string', applies: opt('string'), warnings: ['string'] } },
    /* flightdeck report targets (2.0, flightdeck-read/2): running runs and the steps a report can be written for. */
    targets: { runs: [{ key: 'string', title: 'string', folder: 'string', version: 'number', recorder: opt(PERSON), details: map('string'),
      steps: [{ id: 'string', phase: 'string', text: 'string', type: 'string', state: 'string', binds: ['string'], evidence: [EVIDENCE], accepts: 'boolean', why: opt('string') }] }] }
  };
  /* ---- contract 2 (Flightdeck 2.0): the same commands; 2.0 versions and run/3 runs are data, and values are typed ----
     A detail or evidence value: its kind, the stored text, the value (a string for numbers, a boolean for yes/no, null when
     empty, waiting or not valid), whether the stored text is valid, and the latest migration record about it. */
  var MIGRATION = { path: 'string', at: 'string', from: 'string', source: 'string', verdict: 'string', result: opt('string'), resolved: opt({ by: opt(PERSON), at: 'string', value: 'string' }), open: 'boolean' };
  var VALUE = { type: 'string', text: 'string', value: { $or: ['string', 'boolean', 'null'] }, valid: 'boolean', migration: opt(MIGRATION) };
  var EVIDENCE2 = extend(EVIDENCE, { type: 'string' });
  var PIN = { process: 'string', version: 'number', folder: 'string', mapHash: 'string', typesHash: 'string' };
  /* Conditions (2.1): whether a step or a phase (on its gate) applies in the run: true, false (Not needed) or null (held). */
  var APPLIES = { $or: ['boolean', 'null'] };
  /* Test runs (2.1): test says a run is one; stage names its stage folder (null for any other run). */
  var SUMMARY2 = extend(SUMMARY, { format: 'string', features: ['string'], details: map(VALUE), test: 'boolean', stage: opt({ folder: 'string' }) });
  var FOLLOWUP2 = extend(FOLLOWUP, { test: 'boolean' });
  var SCHEMA2 = {
    envelope: SCHEMA.envelope, error: SCHEMA.error, processes: SCHEMA.processes, next: SCHEMA.next, followups: { followUps: [FOLLOWUP2] }, request: SCHEMA.request,
    /* stage: the staged version shown (process --stage), else null. */
    process: extend(SCHEMA.process, { format: 'string', features: ['string'], stage: opt({ folder: 'string', proposed: 'number', stagedBy: 'string', stagedAt: 'string' }), details: [{ name: 'string', type: 'string', options: ['string'] }],
      phases: [extend(SCHEMA.process.phases[0], { when: ['string'], steps: [extend(SCHEMA.process.phases[0].steps[0], { when: ['string'], evidence: [extend(EVIDENCE2, { min: opt('string'), max: opt('string'), unit: opt('string') })] })] })] }),
    /* testRunsLeftOut: test runs that match but aren't listed (D3: left out unless asked for with --tests). */
    runs: { runs: [SUMMARY2], planned: [extend(SCHEMA.runs.planned[0], { format: 'string', pin: opt({ folder: 'string', version: 'number' }) })], testRunsLeftOut: 'number' },
    run: { run: opt(extend(SUMMARY2, { roles: [ROLE], pins: map(PIN), migrations: [MIGRATION],
      steps: [extend(SCHEMA.run.run.$or[0].steps[0], { values: map(VALUE), evidence: [EVIDENCE2], applies: APPLIES, held: opt('string') })],
      gates: [extend(SCHEMA.run.run.$or[0].gates[0], { applies: APPLIES })], followUps: [FOLLOWUP2] })) }
  };
  function extend(a, b) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; }); Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; }

  /* What's wrong with a value against a schema entry: a list of "where: what" lines, empty when it conforms. */
  function conforms(v, d, at) {
    var out = [], here = at || 'data';
    function kind(x) { return x === null ? 'null' : Array.isArray(x) ? 'list' : typeof x; }
    if (typeof d === 'string') {
      if (d === 'any') return out;
      if (kind(v) !== (d === 'null' ? 'null' : d)) out.push(here + ': ' + kind(v) + ', not ' + d);
      return out;
    }
    if (Array.isArray(d)) {
      if (!Array.isArray(v)) return [here + ': ' + kind(v) + ', not a list'];
      v.forEach(function (x, i) { out = out.concat(conforms(x, d[0], here + '[' + i + ']')); });
      return out;
    }
    if (d.$or) {
      var tries = d.$or.map(function (x) { return conforms(v, x, here); });
      if (tries.some(function (e) { return !e.length; })) return [];
      /* The most useful complaint is the one about the shape that isn't null. */
      return tries.filter(function (e, i) { return d.$or[i] !== 'null'; })[0] || tries[0];
    }
    if (kind(v) !== 'object') return [here + ': ' + kind(v) + ', not an object'];
    if (d.$map) { Object.keys(v).forEach(function (k) { out = out.concat(conforms(v[k], d.$map, here + '.' + k)); }); return out; }
    Object.keys(d).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(v, k)) out.push(here + '.' + k + ': missing'); else out = out.concat(conforms(v[k], d[k], here + '.' + k)); });
    Object.keys(v).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(d, k)) out.push(here + '.' + k + ': extra'); });
    return out;
  }

  /* ---- the envelope ---- */
  function problemList(problems) {
    (problems || []).forEach(function (p) { if (KINDS.indexOf(p.kind) < 0) throw new Error('Unknown problem kind: ' + p.kind); });
    return (problems || []).map(function (p) { return { path: String(p.path), kind: p.kind, why: String(p.why || '') }; })
      .sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0; });
  }
  function contractOf(n) { return +n === 2 || n === CONTRACT2 ? CONTRACT2 : CONTRACT; }
  function envelope(app, readAt, problems, data, c) {
    var list = problemList(problems);
    return { contract: contractOf(c), app: String(app || ''), readAt: String(readAt || ''), complete: list.length === 0, problems: list, note: NOTE, data: data || {} };
  }
  /* No data at all: kind 'failed' (exit 1), 'not-found' (exit 5), 'contract' or 'usage' (exit 1). problems: what the read
     met before it stopped, the same ledger an envelope reports (empty when nothing was read). */
  function failure(app, kind, why, problems, c) { return { contract: contractOf(c), app: String(app || ''), error: { kind: kind, why: String(why) }, problems: problemList(problems) }; }

  /* People are an ID and the name people.json gives it; nothing else from the directory, emails least of all. */
  function names(people) {
    var byId = Object.create(null);
    (people || []).forEach(function (p) { if (p && typeof p.id === 'string') byId[p.id] = typeof p.name === 'string' ? p.name : null; });
    return function (id) { if (!id || typeof id !== 'string') return null; return { id: id, name: Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : null }; };
  }
  /* Text from a file's value: a string, number or boolean as text, anything else (an object, even one with its own
     toString) as empty, so a value in the wrong shape can never throw or show up as code. */
  function s(v) { return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''; }
  function orNull(v) { var t = s(v); return t === '' ? null : t; }
  function strMap(o) { var c = {}; Object.keys(o || {}).forEach(function (k) { c[k] = s(o[k]); }); return c; }
  function list(v) { return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  function timing(f) { f = f || {}; return { at: orNull(f.at), due: orNull(f.due), after: orNull(f.after) }; }
  function evidence(listIn) {
    return (listIn || []).map(function (d) { return { name: s(d.name), label: s(d.label || d.name), kind: s(d.kind || 'text'), required: !!d.required, options: Array.isArray(d.options) ? d.options.map(s) : [] }; });
  }

  /* ---- contract 1 keeps what Flightdeck 1.x could read (docs/apps.md) ----
     It shows exactly what 1.18 showed, so a script that never asked for more never sees a 2.0 record as data: a 2.0 version
     (preflight-publication/2) is named as newer, never usable and never the latest; a run/3 is listed by name only, as
     newer. Both stay problems (exit 4), as 1.18 names them. */
  var V1_WHY = ' flightdeck-read/1 shows only what Flightdeck 1.x reads, so it names this instead of reading it.';
  function v1Pub(p) {
    if (!p || !p.ok || !p.info || p.info.format !== P.FORMAT2) return p;
    var out = {}; Object.keys(p).forEach(function (k) { out[k] = p[k]; });
    var v = typeof p.info.version === 'number' ? 'v' + p.info.version : 'This version';
    out.ok = false; out.unusable = true; out.newer = true; out.needs = '2.0';
    out.why = v + ' was published with Flightdeck 2.0 (it uses ' + (Array.isArray(p.info.features) ? p.info.features.join(', ') : 'its features') + ').' + V1_WHY;
    return out;
  }
  function v1Processes(list) {
    return (list || []).map(function (proc) {
      var pubs = (proc.pubs || []).map(v1Pub), out = {};
      if (pubs.every(function (p, i) { return p === proc.pubs[i]; })) return proc;
      Object.keys(proc).forEach(function (k) { out[k] = proc[k]; });
      out.pubs = pubs; out.index = P.index(pubs);
      return out;
    });
  }
  function v1Run(r) {
    if (!r || r.format !== R.FORMAT3) return r;
    var out = R.nameOnly(r, '2.0');
    if (out) out._unrunnable = R.NEWER + ' Made with Flightdeck 2.0.' + V1_WHY;
    return out;
  }

  /* ---- processes and versions ---- */
  /* Why a version can't be used, as a problem kind: from a newer Flightdeck, unusable here, still arriving, or damaged. */
  function pubProblem(res) {
    var why = s(res && res.why);
    if (res && res.unusable) return { kind: res.newer || why.indexOf(P.NEWER) === 0 ? 'newer' : 'unusable', why: why };
    if (/^Still syncing|^Files don't match/.test(why)) return { kind: 'still-syncing', why: why };
    return { kind: 'malformed', why: why || 'This version can\'t be read.' };
  }
  function version(p, clashes) {
    var info = p.info || {}, v = typeof info.version === 'number' ? info.version : P.versionOf(p.folder);
    return { folder: s(p.folder), version: typeof v === 'number' ? v : null, publishedAt: orNull(info.publishedAt), publishedBy: orNull(info.publishedBy),
      usable: !!p.ok, why: p.ok ? null : s(p.why), clash: !!p.ok && (clashes || []).indexOf(info.version) >= 0 };
  }
  function about(proc) {
    var latest = proc.index && proc.index.latest, meta = latest ? latest.map.meta : null, any = (proc.pubs || []).filter(function (p) { return p.info && p.info.title; })[0];
    return { id: s(proc.process), title: s(meta ? meta.title : any ? any.info.title : proc.process), category: s(meta && meta.category || 'Other'),
      group: meta ? meta.group.map(s) : [], tags: meta ? meta.tags.map(s) : [], owner: meta ? orNull(meta.owner) : null };
  }
  function byVersion(a, b) { return (b.version || 0) - (a.version || 0) || (a.folder < b.folder ? -1 : 1); }
  function processes(procs) {
    return { processes: (procs || []).slice().sort(function (a, b) { return a.process < b.process ? -1 : 1; }).map(function (proc) {
      var latest = proc.index && proc.index.latest, o = about(proc);
      o.latest = latest ? { version: latest.info.version, folder: latest.info.folder } : null;
      o.versions = (proc.pubs || []).map(function (p) { return version(p, proc.index && proc.index.clashes); }).sort(byVersion);
      return o;
    }) };
  }
  /* One version of a checklist. Evidence here is the publication's schema (what its step types record); a run's own
     evidence (filled-in fields, fields an issue tracker's transition requires) comes from `run`. */
  function process(proc, pub) {
    var out = { process: about(proc), version: version(pub, proc.index && proc.index.clashes), usable: !!pub.ok, evidenceFrom: 'publication', context: [], roles: [], types: [], phases: [] };
    if (!pub.ok) return out;
    var mp = pub.map, types = pub.types || {};
    out.context = mp.meta.context.map(s); out.roles = mp.meta.roles.map(s);
    var used = {};
    M.steps(mp).forEach(function (x) { if (x.step.type) used[x.step.type] = true; });
    out.types = Object.keys(used).sort().map(function (id) { var t = T.get(id, types); return { id: id, label: s(t && t.label || id) }; });
    out.phases = mp.phases.map(function (ph) {
      return { id: s(ph.id), title: s(ph.title), mode: s(ph.mode), tracks: (ph.tracks || []).map(function (t) { return { id: s(t.id), title: s(t.title), roles: t.roles.map(s) }; }),
        steps: ph.steps.map(function (st) {
          var t = T.get(st.type, types);
          return { id: s(st.id), text: s(st.text), type: s(st.type), must: !!st.must, planned: !!st.planned, roles: st.roles.map(s), binds: st.binds.map(s), sets: list(st.fields.sets),
            fields: strMap(st.fields), track: orNull(st.track), timing: timing(st.fields), evidence: evidence(t ? T.recordFields(t, st.fields) : []) };
        }),
        gate: { id: s(ph.gate.id), title: s(ph.gate.title), implicit: !!ph.gate.implicit, owner: orNull(ph.gate.owner), approves: s(ph.gate.approves), binds: ph.gate.binds.map(s), note: s(ph.gate.note), timing: timing(ph.gate.fields) } };
    });
    return out;
  }

  /* ---- runs ---- */
  function headline(h) { return { status: s(h.s), text: s(h.text), detail: s(h.sub) }; }
  function summary(r, nameOf) {
    var mp = R.mapOf(r), t = R.totals(r, mp);
    return { key: r.process + '/' + r.id, id: s(r.id), process: s(r.process), title: s(r.title), version: +r.version || 0, folder: s(r.folder), state: s(r.state), paused: !!r.paused,
      created: s(r.created), ended: r.ended ? { outcome: s(r.ended.outcome), at: s(r.ended.at), by: nameOf(r.ended.by) } : null, recorder: nameOf(r.recorder && r.recorder.person),
      details: strMap(r.details), progress: { done: t.done, total: t.total }, headline: headline(R.headline(r, mp)), readOnly: orNull(r._unrunnable),
      /* Whether marks were kept from the run's start: false means a step showing none may still have had some (unknown). */
      marksComplete: r.marksFrom === 'start' };
  }
  function byCreated(a, b) { return a.created < b.created ? 1 : a.created > b.created ? -1 : a.key < b.key ? -1 : 1; }
  /* Plans as the app shows them: pending, accepted (started, with its run), declined, conflicting (two decisions disagree)
     or changed (edited after a decision). */
  /* procs: the processes as loaded, to say which version a person starting the plan gets (P.forPlan, as the app picks it).
     unsure(process): true when some of that process's versions couldn't be read, so both are unknown (null). */
  /* Held (2.1.1): a plan nothing has decided yet that the app still won't start, decline or switch, because a decision on it
     (or proposals/ itself) can't be read: the app's words (PF.plans.heldWhy) and the files that hold it. null otherwise. */
  function held(p, data) {
    if (p._status || p._decidedEarlier) return null;
    var why = PF.plans.heldWhy(p, data || {});
    if (!why) return null;
    var f = data && data.failed && Object.prototype.hasOwnProperty.call(data.failed, 'proposals') ? [{ file: 'proposals/', kind: 'unreadable' }]
      : (p._statusHeld || []).map(function (u) { return { file: s(u.path), kind: s(u.kind) }; });
    return { why: s(why), files: f };
  }
  function plan(p, procs, unsure, data) {
    var st = p._status, status = p._conflicting ? 'conflicting' : st ? s(st.status) : p._changedAfterDecision ? 'changed' : 'pending';
    var v = typeof p.version === 'number' ? p.version : /^\d+$/.test(s(p.version)) ? +p.version : null;
    var out = { id: s(p.id), process: s(p.process), title: s(p.title || p.process), version: v, when: orNull(p.when), by: s(p.by), created: orNull(p.created), note: s(p.note),
      details: strMap(p.details && typeof p.details === 'object' ? p.details : {}), roles: strMap(p.roles && typeof p.roles === 'object' ? p.roles : {}), status: status,
      run: st && st.status === 'accepted' && st.run ? p.process + '/' + st.run : null, startsOn: null, versionMissing: false,
      /* OneDrive copies: how many files hold this plan, and whether they differ (then each is listed and none can be started). */
      copies: typeof p._copies === 'number' ? p._copies : 1, copiesDiffer: !!p._copiesDiffer, requestedBy: PF.requests.claim(p), held: held(p, data) };
    var proc = (procs || []).filter(function (x) { return x.process === p.process; })[0], pick = proc && proc.index ? P.forPlan(proc.index, p.version, null) : { pub: null, missing: false };
    out.startsOn = pick.pub ? { version: pick.pub.info.version, folder: s(pick.pub.info.folder) } : null;
    out.versionMissing = !!pick.missing || (p.version != null && !pick.pub);
    if (unsure && unsure(p.process)) { out.startsOn = null; out.versionMissing = null; }
    return out;
  }
  /* data: the folder as read (repo.loadAll), for why a plan is held; without it, only what the plans themselves say. */
  function runs(runList, plans, nameOf, procs, unsure, data) {
    return { runs: (runList || []).map(function (r) { return summary(r, nameOf); }).sort(byCreated),
      planned: plannedPairs(plans, procs, unsure, data).map(function (x) { return x.o; }) };
  }
  function followUp(x, nameOf) {
    var d = x.decision;
    return { key: s(x.key), process: s(x.process), run: s(x.run), runTitle: s(x.runTitle), runEnded: !!x.runEnded, id: s(x.id), text: s(x.text), owner: nameOf(x.owner),
      ticket: s(x.f && x.f.ticket), step: s(x.f && x.f.step), at: s(x.at), status: s(x.status), label: s(x.label), tie: !!x.tie,
      decision: d ? { status: s(d.status), by: nameOf(d.by), at: s(d.at), rev: d.rev, ticket: orNull(d.ticket), link: orNull(d.link),
        to: d.to ? (d.to.plan ? 'plan:' + d.to.plan : s(d.to.run)) : null, reason: orNull(d.reason), note: orNull(d.note) } : null };
  }
  function followUps(items, nameOf) { return { followUps: (items || []).map(function (x) { return followUp(x, nameOf); }) }; }
  function rolePeople(r, roles, nameOf) { return (roles || []).map(function (ro) { return { role: s(ro), person: nameOf(r.roles[ro]) }; }); }
  /* Every kind of mark a step ever had, as Insights counts them: its durable marks and the answers the run still holds. */
  var MARK_ORDER = ['blocked', 'recheck', 'na', 'differently'];
  function marksOf(r, id) { var set = PF.insights.evidence(r, id).set; return MARK_ORDER.filter(function (k) { return set[k]; }); }
  /* A run in full: each step's state with who and when, its values, and the evidence this run asks for (R.evidenceFor). */
  function run(r, items, nameOf) {
    var mp = R.mapOf(r), out = summary(r, nameOf), mine = F.forRun(items, r);
    out.roles = Object.keys(r.roles || {}).map(function (ro) { return { role: s(ro), person: nameOf(r.roles[ro]) }; });
    out.steps = [];
    mp.phases.forEach(function (ph) {
      ph.steps.forEach(function (st) {
        var a = r.steps[st.id] || null, ev = R.evidenceFor(r, st).list;
        out.steps.push({ id: s(st.id), phase: s(ph.id), text: s(st.text), type: s(st.type), must: !!st.must, roles: st.roles.map(s), state: a ? s(a.s) : 'open',
          by: a ? nameOf(a.by) : null, at: a ? orNull(a.at) : null, reason: a ? orNull(a.reason) : null, values: strMap(a && a.values),
          differently: a && a.differently ? { note: s(a.differently.note), by: nameOf(a.differently.by), at: orNull(a.differently.at) } : null,
          marks: marksOf(r, st.id),
          child: a && a.child ? { process: s(a.child.process), id: s(a.child.id) } : null, evidence: evidence(ev) });
      });
    });
    out.gates = mp.phases.map(function (ph, pi) {
      var g = r.gates[ph.gate.id] || null;
      return { id: s(ph.gate.id), phase: s(ph.id), title: s(ph.gate.title), status: R.gateStatus(r, mp, pi), by: g ? nameOf(g.by) : null, at: g ? orNull(g.at) : null,
        reason: g ? orNull(g.reason) : null, approved: strMap(g && g.approved) };
    });
    out.followUps = mine.map(function (x) { return followUp(x, nameOf); });
    return { run: out };
  }
  /* What's waiting and on whom: R.nextUp exactly, the same for everyone who asks; with a person, R.myNext too (mine). */
  function next(r, nameOf, personId) {
    var mp = R.mapOf(r), nu = R.nextUp(r, mp), ph = nu.phaseIndex != null && mp.phases[nu.phaseIndex] ? mp.phases[nu.phaseIndex] : null;
    var out = { kind: s(nu.kind), headline: headline(nu.hl), phase: ph && (nu.kind === 'step' || nu.kind === 'gate' || nu.kind === 'blocked') ? { index: nu.phaseIndex, id: s(ph.id), title: s(ph.title) } : null,
      step: nu.step ? { id: s(nu.step.id), text: s(nu.step.text), roles: rolePeople(r, nu.step.roles, nameOf) } : null,
      gate: nu.gate ? { id: s(nu.gate.id), title: s(nu.gate.title), status: s(nu.status), owner: orNull(nu.gate.owner) } : null,
      tracks: (nu.tracks || []).map(function (t) { return { id: s(t.track.id), title: s(t.track.title), left: t.left, step: t.step ? { id: s(t.step.id), text: s(t.step.text) } : null, people: t.people.map(nameOf).filter(Boolean) }; }) };
    var my = personId ? R.myNext(r, mp, personId) : null, mph = my ? mp.phases[my.phaseIndex] : null;
    return { run: r.process + '/' + r.id, person: personId ? nameOf(personId) : null, next: out,
      mine: my ? { phase: { index: my.phaseIndex, id: s(mph.id), title: s(mph.title) }, step: { id: s(my.step.id), text: s(my.step.text) } } : null };
  }

  /* ---- contract 2 ---- */
  var V = PF.values, KIND_TYPE = { url: 'link', link: 'link' };
  function typeOf(def) { var k = def ? V.kindOf(def) : 'text'; return KIND_TYPE[k] || k; }
  function migration(m, nameOf) {
    return { path: s(m.path), at: s(m.at), from: s(m.from), source: s(m.source), verdict: s(m.verdict), result: m.result == null ? null : s(m.result),
      resolved: m.resolved ? { by: nameOf(m.resolved.by), at: s(m.resolved.at), value: s(m.resolved.value) } : null, open: R.isOpenMigration(m) };
  }
  function value(r, mp, path, text, nameOf) {
    var def = r.format === R.FORMAT3 ? R.typedDef(r, mp, path) : null, t = s(text), mig = null;
    (Array.isArray(r.migrations) ? r.migrations : []).forEach(function (m) { if (m && m.path === path) mig = m; });
    var open = !!mig && R.isOpenMigration(mig), ok = !def || t === '' || V.valid(def, t);
    return { type: typeOf(def), text: t, value: open || !ok || t === '' ? null : def ? V.json(def, t) : t, valid: ok, migration: mig ? migration(mig, nameOf) : null };
  }
  function details2(r, mp, nameOf) { var o = {}; Object.keys(r.details || {}).forEach(function (k) { o[k] = value(r, mp, 'details.' + k, r.details[k], nameOf); }); return o; }
  function head2(r, out) { out.format = s(r.format); out.features = Array.isArray(r.features) ? r.features.map(s) : []; return out; }
  function summary2(r, nameOf) { var out = summary(r, nameOf); out.details = details2(r, R.mapOf(r), nameOf); head2(r, out); out.test = R.isTest(r); out.stage = r.test === true && r.stage ? { folder: s(r.stage.folder) } : null; return out; }
  function followUps2(items, nameOf) { return { followUps: (items || []).map(function (x) { var o = followUp(x, nameOf); o.test = !!x.test; return o; }) }; }
  function evidence2(listIn) {
    return (listIn || []).map(function (d) {
      var e = evidence([d])[0]; e.type = (PF.values.isNew(d.kind) || (d.detailKind && d.detailKind !== 'text')) ? typeOf(d) : 'text';
      return e;
    });
  }
  function process2(proc, pub) {
    var out = process(proc, pub), si = pub.info || {};
    out.format = s(si.format); out.features = Array.isArray(si.features) ? si.features.map(s) : [];
    out.stage = pub.stage && si.stage ? { folder: s(si.folder), proposed: +si.stage.proposed || 0, stagedBy: s(si.stagedBy), stagedAt: s(si.stagedAt) } : null;
    out.details = [];
    if (!pub.ok) return out;
    var mp = pub.map, types = pub.types || {}, dt = mp.meta.detailTypes || {};
    out.details = mp.meta.context.map(function (n) { var d = Object.prototype.hasOwnProperty.call(dt, n) ? dt[n] : null; return { name: s(n), type: d ? typeOf(d) : 'text', options: d && d.options ? d.options.map(s) : [] }; });
    out.phases.forEach(function (ph, pi) {
      var when = function (o) { return (o.when || []).map(function (w) { return s(w.text); }); };
      ph.when = when(mp.phases[pi]);
      ph.steps.forEach(function (st, si) {
        st.when = when(mp.phases[pi].steps[si]);
        var x = mp.phases[pi].steps[si], t = T.get(x.type, types), list = t ? T.recordFields(t, x.fields) : [];
        st.evidence = evidence2(list).map(function (e, i) { var d = list[i]; e.min = d.kind === 'number' && d.min != null ? s(d.min) : null; e.max = d.kind === 'number' && d.max != null ? s(d.max) : null; e.unit = d.kind === 'number' && d.unit != null ? s(d.unit) : null; return e; });
      });
    });
    return out;
  }
  /* Plans for runs' planned list, each with its entry, in the list's order: by ID, then by file. */
  function plannedPairs(plans, procs, unsure, data) {
    return (plans || []).map(function (p) { return { p: p, o: plan(p, procs, unsure, data) }; }).sort(function (a, b) { return a.o.id < b.o.id ? -1 : a.o.id > b.o.id ? 1 : s(a.p._file) < s(b.p._file) ? -1 : 1; });
  }
  function runs2(runList, plans, nameOf, procs, unsure, leftOut, data) {
    var out = runs(runList, plans, nameOf, procs, unsure, data);
    out.testRunsLeftOut = leftOut || 0;
    out.runs = (runList || []).map(function (r) { return summary2(r, nameOf); }).sort(byCreated);
    /* Each entry with its own plan (copies of one plan that differ share an ID, so never joined by ID). */
    out.planned = plannedPairs(plans, procs, unsure, data).map(function (x) {
      var o = x.o, p = x.p, two = !!p && p.format === PF.plans.FORMAT2;
      o.format = two ? s(p.format) : 'flightdeck-plan/1'; o.pin = two && p.pin ? { folder: s(p.pin.folder), version: +p.pin.version || 0 } : null;
      /* A plan/2 starts on its pin (or the version it was switched to), never on another: no fallback to the latest. */
      if (two && o.versionMissing !== null) {
        var proc = (procs || []).filter(function (x) { return x.process === p.process; })[0], pick = proc && proc.index ? PF.plans.pick(proc.index, p, null) : { pub: null };
        o.startsOn = pick.pub ? { version: pick.pub.info.version, folder: s(pick.pub.info.folder) } : null; o.versionMissing = !pick.pub;
      }
      return o;
    });
    return out;
  }
  function run2(r, items, nameOf) {
    var mp = R.mapOf(r), out = run(r, items, nameOf).run, base = summary2(r, nameOf);
    out.details = base.details; head2(r, out); out.test = base.test; out.stage = base.stage;
    out.pins = {}; if (r.pins && r.pins.children) Object.keys(r.pins.children).forEach(function (k) { var c = r.pins.children[k]; out.pins[k] = { process: s(c.process), version: +c.version || 0, folder: s(c.folder), mapHash: s(c.mapHash), typesHash: s(c.typesHash) }; });
    out.followUps.forEach(function (f) { f.test = R.isTest(r); });
    out.migrations = (r._archivedMigrations || []).concat(Array.isArray(r.migrations) ? r.migrations : []).map(function (m) { return migration(m, nameOf); });
    out.steps.forEach(function (st) {
      var x = M.findStep(mp, st.id), a = r.steps[st.id] || null, vals = {};
      Object.keys((a && a.values) || {}).forEach(function (k) { vals[k] = value(r, mp, 'steps.' + st.id + '.values.' + k, a.values[k], nameOf); });
      st.values = vals; st.evidence = evidence2(x ? R.evidenceFor(r, x.step).list : []);
      var ap = x ? R.applies(r, mp, x.phaseIndex, x.step) : { applies: true };
      st.applies = ap.applies; st.held = ap.applies === null ? s(ap.why) : null;
    });
    out.gates.forEach(function (g, pi) { g.applies = R.applies(r, mp, pi).applies; });
    return { run: out };
  }

  /* What plan request prints: status requested (written now), already (in the folder; nothing written), would-request
     (--dry-run), held (nothing written: problems says what couldn't be read). p: the plan file's fields, or null. */
  function request(id, file, status, p, leftEmpty, runKey) {
    var plain = p ? { id: s(p.id), process: s(p.process), version: typeof p.version === 'number' ? p.version : /^\d+$/.test(s(p.version)) ? +p.version : 0, title: s(p.title),
      details: strMap(p.details && typeof p.details === 'object' ? p.details : {}), roles: strMap(p.roles && typeof p.roles === 'object' ? p.roles : {}), when: orNull(p.when),
      note: s(p.note), by: s(p.by), created: s(p.created) } : null;
    return { request: { id: s(id), file: s(file), status: s(status), plan: plain, leftEmpty: (leftEmpty || []).map(s), run: runKey || null } };
  }

  /* What report check and write print. rep: PF.reports.clean's report; t: PF.reports.target's result, or null without a folder. */
  function reportOut(file, sha, status, rep, t) {
    return { report: { file: s(file), sha256: sha || null, status: s(status), run: s(rep.process) + '/' + s(rep.run), step: s(rep.step), id: s(rep.id), verdict: s(rep.verdict),
      producer: { name: s(rep.producer.name), version: s(rep.producer.version) }, created: s(rep.created), applies: t && t.applies ? s(t.applies) : null, warnings: t ? t.warnings.map(s) : [] } };
  }
  /* What report targets prints: each running run with its steps, the evidence each records (R.evidenceFor, the run's own),
     and whether a person could accept a report on it (PF.reports.eligible's rules that don't depend on the report). */
  function targets(runList, nameOf) {
    return { runs: (runList || []).map(function (r) {
      var mp = R.mapOf(r), steps = [];
      mp.phases.forEach(function (ph) { ph.steps.forEach(function (st) {
        var a = r.steps && Object.prototype.hasOwnProperty.call(r.steps, st.id) ? r.steps[st.id] : null;
        var why = st.type === 'run.process' ? 'Checked by its linked run, never by a report.' : String(R.fieldsOf(r, st).sets || '').trim() ? 'Sets run details; a person checks it.' : !PF.reports.parseName(r.id + '.' + st.id + '.x.aaaaaaaa.json') ? 'Its step ID can\'t be part of a report\'s file name.' : null;
        steps.push({ id: s(st.id), phase: s(ph.id), text: s(st.text), type: s(st.type), state: s(a && a.s || 'open'), binds: (st.binds || []).map(s), evidence: evidence(R.evidenceFor(r, st).list), accepts: !why, why: why });
      }); });
      return { key: r.process + '/' + r.id, title: s(r.title), folder: s(r.folder), version: +r.version || 0, recorder: r.recorder && r.recorder.person ? nameOf(r.recorder.person) : null, details: strMap(r.details || {}), steps: steps };
    }).sort(function (a, b) { return a.key < b.key ? -1 : 1; }) };
  }

  return { CONTRACT: CONTRACT, CONTRACT2: CONTRACT2, reportOut: reportOut, targets: targets, SCHEMA2: SCHEMA2, process2: process2, runs2: runs2, followUps2: followUps2, run2: run2, summary2: summary2, CONTRACT_OF: contractOf, VERSIONS: VERSIONS, NOTE: NOTE, KINDS: KINDS, SCHEMA: SCHEMA, opt: opt, map: map, conforms: conforms, envelope: envelope, failure: failure, names: names,
    v1Pub: v1Pub, v1Processes: v1Processes, v1Run: v1Run, pubProblem: pubProblem, processes: processes, process: process, runs: runs, run: run, next: next, followUps: followUps, summary: summary, request: request };
})();
