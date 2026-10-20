/* Shapes for other apps (docs/apps.md): what `flightdeck processes | process | runs | run | next | followups --json` and
   `flightdeck plan request` print,
   built only from the app's own rules (R.nextUp, R.myNext, R.headline, R.totals, R.evidenceFor, PF.followups.list), so an
   app reads exactly what a person sees. Pure: no files. One versioned envelope (flightdeck-read/1); adding a field keeps
   the version, removing one or changing what it means is a new version. People are an ID and a name: people-directory
   email fields are omitted. (contract.js already means the AGENTS.md hash contract, hence this name.) */
PF.appjson = (function () {
  'use strict';
  var R = PF.run, M = PF.map, T = PF.types, P = PF.publish, F = PF.followups;
  var CONTRACT = 'flightdeck-read/1', VERSIONS = [1];
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
      copies: 'number', copiesDiffer: 'boolean', requestedBy: opt({ name: 'string', version: 'string' }) }] },
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
      roles: map('string'), when: opt('string'), note: 'string', by: 'string', created: 'string' }), leftEmpty: ['string'], run: opt('string') } }
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
  function envelope(app, readAt, problems, data) {
    var list = problemList(problems);
    return { contract: CONTRACT, app: String(app || ''), readAt: String(readAt || ''), complete: list.length === 0, problems: list, note: NOTE, data: data || {} };
  }
  /* No data at all: kind 'failed' (exit 1), 'not-found' (exit 5), 'contract' or 'usage' (exit 1). problems: what the read
     met before it stopped, the same ledger an envelope reports (empty when nothing was read). */
  function failure(app, kind, why, problems) { return { contract: CONTRACT, app: String(app || ''), error: { kind: kind, why: String(why) }, problems: problemList(problems) }; }

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
  function plan(p, procs, unsure) {
    var st = p._status, status = p._conflicting ? 'conflicting' : st ? s(st.status) : p._changedAfterDecision ? 'changed' : 'pending';
    var v = typeof p.version === 'number' ? p.version : /^\d+$/.test(s(p.version)) ? +p.version : null;
    var out = { id: s(p.id), process: s(p.process), title: s(p.title || p.process), version: v, when: orNull(p.when), by: s(p.by), created: orNull(p.created), note: s(p.note),
      details: strMap(p.details && typeof p.details === 'object' ? p.details : {}), roles: strMap(p.roles && typeof p.roles === 'object' ? p.roles : {}), status: status,
      run: st && st.status === 'accepted' && st.run ? p.process + '/' + st.run : null, startsOn: null, versionMissing: false,
      /* OneDrive copies: how many files hold this plan, and whether they differ (then each is listed and none can be started). */
      copies: typeof p._copies === 'number' ? p._copies : 1, copiesDiffer: !!p._copiesDiffer, requestedBy: PF.requests.claim(p) };
    var proc = (procs || []).filter(function (x) { return x.process === p.process; })[0], pick = proc && proc.index ? P.forPlan(proc.index, p.version, null) : { pub: null, missing: false };
    out.startsOn = pick.pub ? { version: pick.pub.info.version, folder: s(pick.pub.info.folder) } : null;
    out.versionMissing = !!pick.missing || (p.version != null && !pick.pub);
    if (unsure && unsure(p.process)) { out.startsOn = null; out.versionMissing = null; }
    return out;
  }
  function runs(runList, plans, nameOf, procs, unsure) {
    return { runs: (runList || []).map(function (r) { return summary(r, nameOf); }).sort(byCreated),
      planned: (plans || []).map(function (p) { return { p: p, o: plan(p, procs, unsure) }; }).sort(function (a, b) { return a.o.id < b.o.id ? -1 : a.o.id > b.o.id ? 1 : s(a.p._file) < s(b.p._file) ? -1 : 1; }).map(function (x) { return x.o; }) };
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

  /* What plan request prints: status requested (written now), already (in the folder; nothing written), would-request
     (--dry-run), held (nothing written: problems says what couldn't be read). p: the plan file's fields, or null. */
  function request(id, file, status, p, leftEmpty, runKey) {
    var plain = p ? { id: s(p.id), process: s(p.process), version: typeof p.version === 'number' ? p.version : /^\d+$/.test(s(p.version)) ? +p.version : 0, title: s(p.title),
      details: strMap(p.details && typeof p.details === 'object' ? p.details : {}), roles: strMap(p.roles && typeof p.roles === 'object' ? p.roles : {}), when: orNull(p.when),
      note: s(p.note), by: s(p.by), created: s(p.created) } : null;
    return { request: { id: s(id), file: s(file), status: s(status), plan: plain, leftEmpty: (leftEmpty || []).map(s), run: runKey || null } };
  }

  return { CONTRACT: CONTRACT, VERSIONS: VERSIONS, NOTE: NOTE, KINDS: KINDS, SCHEMA: SCHEMA, opt: opt, map: map, conforms: conforms, envelope: envelope, failure: failure, names: names,
    v1Pub: v1Pub, v1Processes: v1Processes, v1Run: v1Run, pubProblem: pubProblem, processes: processes, process: process, runs: runs, run: run, next: next, followUps: followUps, summary: summary, request: request };
})();
