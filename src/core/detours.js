/* Checklist-linked to-dos (4.0 slice 5, docs/design.md 45.4): a to-do that a whole other checklist settles. Its addition pins
   that checklist's exact publication (checklist: process, folder, version, mapHash, typesHash, and the results it accepts).
   "Run this checklist" makes an ordinary pinned plan (plan/2) whose id comes from the run, the to-do and its opening, and
   starts it through the standalone start every plan uses: the plan's started decision names the run, durably. Nothing settles
   on its own: a person or a tool asks for the to-do done on that run's result (a done carrying evidence: the plan, the run,
   its answer identity R.answerOf and its result), decided and applied like any done, the evidence asked again before every
   write. A change to that run after the to-do was checked off is said (provenance), and never reopens anything by itself.
   No parent-child step relationship is made. Pure: no files, no clocks.

   ev, what evidence is read against: { runs (every run read; a run in unreadRuns couldn't be), plans (grouped as the folder
   reader groups them: _starts, _statusHeld, _copiesDiffer) }. Without it, evidence can't be checked and a request on it holds. */
PF.detours = (function () {
  'use strict';
  var LIMITS = { accepts: 20, accept: 60, answer: 80, result: 60 };
  var PROC = /^[a-z0-9][a-z0-9-]{0,59}$/, RUN = /^[a-z0-9-]{1,40}$/i, FOLDER = /^v([1-9][0-9]{0,8})-[a-z0-9]{1,40}$/, H8 = /^[0-9a-f]{8}$/;
  var PLAN = /^plan-ev-[0-9a-f]{24}$/, CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
  function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function hex(v) { return PF.sha256.hex(JSON.stringify(v)); }
  function only(o, keys, what, errors) { Object.keys(o).forEach(function (k) { if (keys.indexOf(k) < 0) errors.push(what + ' has "' + String(k).slice(0, 70) + '".'); }); }

  /* ---- Records. ---- */
  /* An addition's checklist: the exact publication it pins, and the results of it that settle the to-do (none: any run of
     it that completes). Refused whole, never cut. */
  function cleanChecklist(v, errors) {
    if (!isMap(v)) { errors.push('"checklist" is {"process", "folder", "version", "mapHash", "typesHash", "accepts"?}.'); return null; }
    var n0 = errors.length;
    only(v, ['process', 'folder', 'version', 'mapHash', 'typesHash', 'accepts'], '"checklist"', errors);
    if (typeof v.process !== 'string' || !PROC.test(v.process)) errors.push('"checklist" "process" is a checklist id.');
    var m = typeof v.folder === 'string' ? FOLDER.exec(v.folder) : null;
    if (!m) errors.push('"checklist" "folder" is a version folder, like v3-k3m9p2q8.');
    else if (typeof v.version !== 'number' || v.version !== +m[1]) errors.push('"checklist" "version" is its folder\'s version number.');
    if (typeof v.mapHash !== 'string' || !H8.test(v.mapHash) || typeof v.typesHash !== 'string' || !H8.test(v.typesHash)) errors.push('"checklist" names its version\'s two fingerprints ("mapHash", "typesHash").');
    var acc = null;
    if (v.accepts != null) {
      if (!Array.isArray(v.accepts) || !v.accepts.length || v.accepts.length > LIMITS.accepts) errors.push('"checklist" "accepts" is a list of 1 to ' + LIMITS.accepts + ' results.');
      else if (!v.accepts.every(function (a) { return typeof a === 'string' && a.trim() === a && a.length >= 1 && a.length <= LIMITS.accept && !CONTROL.test(a); })) errors.push('"checklist" "accepts" holds results of at most ' + LIMITS.accept + ' characters each.');
      else if (v.accepts.some(function (a, i) { return v.accepts.indexOf(a) !== i; })) errors.push('"checklist" "accepts" names a result twice.');
      else acc = v.accepts.slice();
    }
    if (errors.length > n0) return null;
    var out = { process: v.process, folder: v.folder, version: v.version, mapHash: v.mapHash, typesHash: v.typesHash };
    if (acc) out.accepts = acc;
    return out;
  }
  /* A done's evidence: the to-do's evidence plan, the run it started, that run's answer identity and its result. */
  function cleanEvidence(v, errors) {
    if (!isMap(v)) { errors.push('"evidence" is {"plan", "run", "answer", "result"}.'); return null; }
    var n0 = errors.length;
    only(v, ['plan', 'run', 'answer', 'result'], '"evidence"', errors);
    if (typeof v.plan !== 'string' || !PLAN.test(v.plan)) errors.push('"evidence" "plan" is the to-do\'s evidence plan (plan-ev-...).');
    var r = v.run;
    if (!isMap(r) || Object.keys(r).length !== 2 || typeof r.process !== 'string' || !PROC.test(r.process) || typeof r.id !== 'string' || !RUN.test(r.id)) errors.push('"evidence" "run" is {"process", "id"}.');
    if (typeof v.answer !== 'string' || !v.answer.trim() || v.answer.length > LIMITS.answer || CONTROL.test(v.answer)) errors.push('"evidence" "answer" is the run\'s answer, as Flightdeck records it.');
    if (typeof v.result !== 'string' || v.result.length > LIMITS.result || CONTROL.test(v.result)) errors.push('"evidence" "result" is the run\'s result, at most ' + LIMITS.result + ' characters.');
    if (errors.length > n0) return null;
    return { plan: v.plan, run: { process: r.process, id: r.id }, answer: v.answer, result: v.result };
  }
  /* ---- Names. The evidence plan of a to-do's opening, and a done on one run's answer: the same from any tool or person. ---- */
  function planId(run, todo, incarnation) { return 'plan-ev-' + hex(['evidence', run.process, run.id, todo, incarnation || '']).slice(0, 24); }
  function evHash(todo, e) { return hex(['evidence-done', todo, e.plan, e.run.process, e.run.id, e.answer, e.result]).slice(0, 24); }
  function requestId(todo, e) { return 'req-evidence-' + evHash(todo, e); }
  function requestKey(todo, e) { return 'ev-' + evHash(todo, e); }
  function incarnation(x) { return PF.facts.incarnationOf(x); }
  function planOf(r, x) { return planId({ process: r.process, id: r.id }, x.id, incarnation(x)); }

  /* ---- Pinning (todo add --checklist <process>@<folder> --accepts ...). proc: that process's versions ({ all, broken }). ---- */
  function pinFor(proc, process, folder, accepts) {
    if (!PROC.test(String(process || '')) || !FOLDER.test(String(folder || ''))) return { why: 'Say the checklist as <process>@<version folder>, like smoke-test@v3-k3m9p2q8.' };
    if (!proc) return { why: 'There\'s no checklist ' + process + ' published in this folder.' };
    var bad = (proc.broken || []).filter(function (x) { return x && x.folder === folder; })[0];
    if (bad) return { why: process + ' ' + folder + ' can\'t be used: ' + String(bad.why || 'it doesn\'t pass its check').replace(/\.$/, '') + '.', held: true };
    var pub = (proc.all || []).filter(function (x) { return x && x.info && x.info.folder === folder; })[0];
    if (!pub) return { why: process + ' has no version ' + folder + ' in this folder.' };
    var t = { process: process, folder: folder, version: pub.info.version, mapHash: pub.info.mapHash, typesHash: pub.info.typesHash };
    if (accepts && accepts.length) {
      var d = PF.map.resultDef(pub.map);
      if (!d) return { why: process + ' v' + pub.info.version + ' has no result to accept; leave out --accepts to count any run of it that completes.' };
      var off = accepts.filter(function (a) { return d.options.indexOf(a) < 0; });
      if (off.length) return { why: process + ' v' + pub.info.version + '\'s result is one of ' + d.options.join(', ') + '; it never returns ' + off.join(', ') + '.' };
      t.accepts = accepts.slice();
    }
    var e = []; t = cleanChecklist(t, e);
    return t ? { checklist: t, pub: pub } : { why: e[0] };
  }
  /* The plan "Run this checklist" makes for a to-do: an ordinary plan/2 pinned to the to-do's publication, named by the run,
     the to-do and its opening, so making it twice is the same plan. pub: that publication. o: { by, at, app, title }. */
  function planFor(r, x, pub, o) {
    o = o || {};
    var c = x && x.checklist;
    if (!c) return { why: 'This to-do isn\'t linked to a checklist.' };
    if (x.state !== 'open') return { why: 'It is already ' + String(PF.todos.STATE_WORDS[x.state] || x.state).toLowerCase() + '.' };
    if (!pub || !pub.info || pub.info.folder !== c.folder || pub.info.mapHash !== c.mapHash || pub.info.typesHash !== c.typesHash) return { why: 'Its checklist, ' + c.process + ' ' + c.folder + ', can\'t be used here: it isn\'t in this folder as it was pinned.', held: true };
    var title = ('For "' + x.text + '"').slice(0, 100);
    var plan = PF.plans.make(pub, { id: planOf(r, x), process: c.process, title: title, from: r.process + '/' + r.id, by: o.by || null, created: o.at || null }, true, o.app);
    return { plan: plan };
  }

  /* ---- Evidence. ---- */
  function findRun(ev, process, id) { return (ev.runs || []).filter(function (y) { return y && y.process === process && y.id === id; })[0] || null; }
  function unreadRun(ev, process, id) { return (ev.unreadRuns || []).indexOf(process + '/' + id) >= 0; }
  function planIn(ev, id) { return (ev.plans || []).filter(function (p) { return p && p.id === id; })[0] || null; }
  /* The runs a to-do's evidence plan started, or why that can't be known: { plan, starts } | { why, held? }. */
  function startsOf(r, x, ev) {
    if (!ev) return { why: 'The run it rests on can\'t be checked here.', held: true };
    var c = x.checklist, id = planOf(r, x), p = planIn(ev, id);
    if (!p) return { why: 'No run of ' + c.process + ' was started for this to-do yet (Run this checklist).' };
    if ((p._statusHeld || []).length || p._copiesDiffer) return { why: 'Its plan (' + id + ') has a decision or a copy that can\'t be read, so which run it started isn\'t known.', held: true };
    if (p.process !== c.process || !p.pin || p.pin.folder !== c.folder) return { why: 'Its plan (' + id + ') isn\'t for ' + c.process + ' ' + c.folder + '.' };
    return { plan: p, starts: (p._starts || []).filter(function (s) { return typeof s === 'string' && s; }) };
  }
  /* A done on one run's result for a to-do (todo suggest-done --evidence-run, Accept on the run screen): { evidence, run,
     words } or { why } (held: true while what it rests on can't be read). runId: which of the runs its plan started. */
  function evidenceFor(r, x, runId, ev) {
    if (!x || !x.checklist) return { why: 'That to-do isn\'t linked to a checklist.' };
    if (x.state !== 'open') return { why: 'It is already ' + String(PF.todos.STATE_WORDS[x.state] || x.state).toLowerCase() + '.' };
    var c = x.checklist, S = startsOf(r, x, ev);
    if (S.why) return S;
    if (!runId) return { why: S.starts.length > 1 ? 'More than one run was started for it (' + S.starts.join(', ') + '). Say which one with --evidence-run.' : 'Say which run with --evidence-run.' + (S.starts.length ? ' Its run is ' + S.starts[0] + '.' : '') };
    if (S.starts.indexOf(runId) < 0) return { why: 'Run ' + runId + ' wasn\'t started for this to-do' + (S.starts.length ? ' (its runs: ' + S.starts.join(', ') + ').' : '.') };
    if (unreadRun(ev, c.process, runId)) return { why: 'Its run, ' + c.process + '/' + runId + ', can\'t be read now.', held: true };
    var run = findRun(ev, c.process, runId);
    if (!run) return { why: 'Its run, ' + c.process + '/' + runId + ', isn\'t in the folder as this computer reads it.', held: true };
    if (run._unrunnable) return { why: 'Its run, ' + c.process + '/' + runId + ', can only be read here: ' + String(run._unrunnable).replace(/\.$/, '') + '.', held: true };
    var title = String(run.title || run.process).slice(0, 60);
    if (run.parent || run.folder !== c.folder || run.mapHash !== c.mapHash) return { why: title + ' isn\'t a run of ' + c.process + ' ' + c.folder + ' on its own.' };
    if (!run.ended || run.ended.outcome !== 'Completed') return { why: title + (run.ended ? ' ended ' + String(run.ended.outcome || '').toLowerCase() + ', not completed.' : ' hasn\'t completed yet.') };
    var res = PF.run.resultOf(run), value = res ? res.value : '';
    if (res && res.conflict) return { why: title + '\'s result can\'t be told: its ^' + res.name + ' and its decision disagree. Correct that run first.' };
    if (c.accepts && c.accepts.indexOf(value) < 0) return { why: title + ' returned ' + (value || 'no result') + '; this to-do accepts ' + c.accepts.join(' or ') + '.' };
    var answer = PF.run.answerOf(run);
    return { run: run, evidence: { plan: S.plan.id, run: { process: run.process, id: run.id }, answer: answer, result: value }, words: title + ' completed' + (value ? ' · ' + value : '') + '.' };
  }
  /* Why a done on evidence can't be applied now ('' when it can): asked in the request's status on every read and before
     every write. The evidence must be this opening's, and the run it names must still give exactly that answer and result. */
  function evidenceWhy(r, q, x, ev) {
    var e = q.evidence;
    if (!x || !x.checklist) return 'It rests on a run, but its to-do isn\'t linked to a checklist.';
    if (e.plan !== planOf(r, x)) return 'It was asked on an earlier opening of this to-do.';
    if (e.run.process !== x.checklist.process) return 'It rests on a run of another checklist.';
    var F = evidenceFor(r, x, e.run.id, ev);
    if (F.why) return F.why;
    if (F.evidence.answer !== e.answer || F.evidence.result !== e.result) return F.words.replace(/\.$/, '') + ', but not as it was when this was asked: it was reopened, corrected or ended again since. Ask again on the run as it is now.';
    return '';
  }
  /* What became of the run a to-do was checked off on, after it was ('' when it stands as it did). Never changes the to-do. */
  function provenance(r, x, ev) {
    if (!x || x.state !== 'done' || !x.evidence || !ev) return '';
    var e = x.evidence, k = e.run.process + '/' + e.run.id;
    if (unreadRun(ev, e.run.process, e.run.id)) return 'The run it was checked off on (' + k + ') can\'t be read now.';
    var run = findRun(ev, e.run.process, e.run.id);
    if (!run) return 'The run it was checked off on (' + k + ') isn\'t in the folder now.';
    var title = String(run.title || run.process).slice(0, 60), res = run.ended ? PF.run.resultOf(run) : null, value = res ? res.value : '';
    if (!run.ended) return title + ', which it was checked off on, was reopened since.';
    if (PF.run.answerOf(run) !== e.answer || value !== e.result) return title + ', which it was checked off on, changed since' + (value !== e.result ? ': it returned ' + (value || 'no result') + ' (was ' + (e.result || 'no result') + ')' : ': it was corrected or ended again') + '.';
    return '';
  }
  /* The to-do a run was started for, from the plan that started it: { from (the run key), plan } or null. */
  function returnOf(run, plans) {
    if (!run) return null;
    var p = (plans || []).filter(function (y) { return y && PLAN.test(String(y.id)) && y.process === run.process && (y._starts || []).indexOf(run.id) >= 0 && typeof y.from === 'string'; });
    return p.length === 1 ? { from: p[0].from, plan: p[0].id } : null;
  }
  /* In words, for the preview and the run screen. */
  function evidenceWords(e) { return 'the run ' + e.run.process + '/' + e.run.id + (e.result ? ' (' + e.result + ')' : ''); }

  return { LIMITS: LIMITS, cleanChecklist: cleanChecklist, cleanEvidence: cleanEvidence, planId: planId, planOf: planOf, requestId: requestId, requestKey: requestKey, pinFor: pinFor, planFor: planFor,
    startsOf: startsOf, evidenceFor: evidenceFor, evidenceWhy: evidenceWhy, provenance: provenance, returnOf: returnOf, evidenceWords: evidenceWords };
})();
