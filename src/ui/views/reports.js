/* Reports from tools on a run's steps (PF.reports, docs/design.md section 26): the card in the inspector, the badge on a
   step's row, and the run's Reports panel. Three facts stay apart on every surface: what the report says (a claim that changes
   nothing), what a person decided, and whether its inputs match the run. Everything from a report file is escaped. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, R = PF.run, M = PF.map, X = PF.reports, I = PF.icons.icon, esc = U.esc;
  var nameOf = K.nameOf;
  var EMPTY = { list: [], badNames: [], failed: '', loading: false, cur: null, unrecorded: [], pending: [], readOnly: '' };

  function bundle(ctx, r) { return (ctx.reports && ctx.reports(r)) || EMPTY; }
  function onStep(ctx, r, id) { return bundle(ctx, r).list.filter(function (it) { return it.g.step === id; }); }
  function who(ctx) { return function (id) { return nameOf(ctx, id); }; }
  function verdictPill(rep) { return rep.verdict === 'pass' ? 'passed' : rep.verdict === 'fail' ? 'failed' : 'review'; }
  function saysText(rep) {
    if (!rep) return 'Report can\'t be read';
    var n = rep.blockers.length;
    return 'Report says ' + rep.verdict + (n ? ' · ' + n + ' blocker' + (n === 1 ? '' : 's') : '');
  }
  function decidedOf(ctx, r, map, g) { var x = M.findStep(map, g.step); return X.decided(g, bundle(ctx, r).cur, r, x ? x.step : null, who(ctx)); }
  function appliesOf(r, map, g) { var x = M.findStep(map, g.step); return g.report && x ? X.applies(g.report, r, map, x.step) : null; }

  /* The row badge: accepted first, then a report whose inputs don't match, else what the first one says. */
  function badge(ctx, r, map, id) {
    var items = onStep(ctx, r, id);
    if (!items.length) return '';
    var states = items.map(function (it) { return decidedOf(ctx, r, map, it.g).state; });
    if (states.indexOf('accepted') >= 0) return '<span class="badge b-rep">Report accepted</span>';
    if (items.some(function (it) { var a = appliesOf(r, map, it.g); return a && a.result === 'mismatch'; })) return '<span class="badge b-warn">Report: doesn\'t match</span>';
    var rep = items[0].g.report;
    return '<span class="badge b-rep">' + (rep ? 'Report: says ' + esc(rep.verdict) : 'Report: can\'t be read') + '</span>';
  }

  /* What the report says, by the step's own evidence labels. Secret inputs are named, never shown. */
  function saysBody(r, step, rep, unused) {
    var h = '<p class="rep-says"><span class="pill ' + verdictPill(rep) + '">' + esc(saysText(rep)) + '</span></p>';
    if (rep.summary) h += '<p>' + esc(rep.summary) + '</p>';
    if (rep.blockers.length) h += '<ul class="small rep-blockers">' + rep.blockers.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>';
    var labels = Object.create(null);
    if (step) R.evidenceFor(r, step).list.forEach(function (d) { labels[d.name] = d; });
    var ev = Object.keys(rep.evidence || {}).filter(function (k) { return labels[k]; }).map(function (k) {
      var d = labels[k], v = rep.evidence[k], url = d.kind === 'url' ? U.safeUrl(v) : '';
      return url ? '<a class="fchip rec" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"><b>' + esc(d.label) + '</b> ' + esc(v) + '</a>' : '<span class="fchip rec"><b>' + esc(d.label) + ':</b> ' + esc(v) + '</span>';
    });
    if (ev.length) h += '<div class="fields">' + ev.join('') + '</div>';
    if (unused.length) h += '<p class="small">Not used: this step doesn\'t record ' + esc(unused.join(', ')) + '.</p>';
    var links = (rep.links || []).map(function (l) { var u = U.safeUrl(l.url); return u ? '<li><a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(l.label || l.url) + '</a></li>' : ''; }).join('');
    if (links) h += '<ul class="small rep-links">' + links + '</ul>';
    var ins = (rep.inputs || []).map(function (x) { return '<li>' + esc(x.name) + (x.secret ? ' (secret, not shown)' : ': ' + esc(x.value)) + '</li>'; }).join('');
    if (ins) h += '<div class="small">Inputs it examined<ul class="rep-inputs">' + ins + '</ul></div>';
    return h;
  }

  /* One report on the selected step: the three facts, the producer line, Details, and the recorder's actions. */
  /* A report card's id, from its report's key (2.11), so a report arriving ahead of it never gives its id to another. */
  function cardId(key) { return 'rep-' + PF.sha256.hex(String(key)).slice(0, 32); }
  function card(ctx, r, map, it, folded) {
    var g = it.g, rep = g.report, st = ctx.state, b = bundle(ctx, r), x = M.findStep(map, g.step), step = x ? x.step : null;
    var dec = decidedOf(ctx, r, map, g), ap = appliesOf(r, map, g), id = cardId(g.key);
    var head = (rep ? esc(saysText(rep)) : 'A report that can\'t be read') + ' · ' + esc(g.producer);
    var h = '';
    if (it.depth) h += '<p class="small">Replaced by a newer report from ' + esc(g.producer) + '.</p>';
    if (it.note) h += '<p class="small">' + esc(it.note) + '</p>';
    if (rep) {
      var vu = step ? X.valuesFor(rep, r, step) : { unused: [] };
      h += '<div class="rep-fact"><h4 class="small">What it says</h4>' + saysBody(r, step, rep, vu.unused) + '</div>';
      h += '<p class="small rep-producer">From ' + esc(rep.producer.name) + (rep.producer.version ? ' ' + esc(rep.producer.version) : '') + ', by its own account.</p>';
    } else h += reasonHtml(st, g);
    if (rep && g.reason) h += reasonHtml(st, g);
    h += '<div class="rep-fact"><h4 class="small">What a person decided</h4><p>' + esc(dec.text) + '</p></div>';
    if (ap) h += '<div class="rep-fact"><h4 class="small">Whether its inputs match the run</h4><p>' + esc(X.appliesText(ap)) + '</p></div>';
    /* An acceptance the run logs whose decision isn't in the folder (from saved state); this window's own while its step
       isn't saved yet says so. */
    var mine = (b.pending || []).filter(function (p) { return p.key === g.key; })[0], un = (b.unrecorded || []).filter(function (u) { return u.g.key === g.key; })[0];
    if (un && mine && b.unsaved) h += '<p class="small" role="status">Saving the decision once the step is saved…</p>';
    else if (un) h += un.recordable ? '<div class="notice warn"><span>Accepted in the run, but the decision isn\'t in the team folder yet.' + (un.other ? ' Another decision on it is in the folder too (' + esc(un.other.status === 'open' ? 'reopened' : un.other.status) + ' by ' + esc(nameOf(ctx, un.other.by)) + '), and Flightdeck can\'t tell which came last. Record the decision makes this acceptance the current one.' : '') + '</span>' + (b.canRecord && b.canRecord() && !(b.held && b.held(g)) ? '<button class="mini" data-act="rep-record" data-id="' + esc(g.key) + '">Record the decision</button>' : '') + '</div>'
      : un.why === 'changed' ? '<div class="notice warn"><span>Accepted in the run, but the step\'s evidence was changed since, so the decision can\'t be recorded from this report.</span></div>'
      : '<div class="notice warn"><span>Accepted in the run, but the report it accepted isn\'t in the folder in that form anymore.</span></div>';
    h += actions(ctx, r, map, g, dec, id);
    h += '<details class="small rep-details"><summary>Details</summary><p>Flightdeck can\'t confirm which tool or person wrote this file.</p>' +
      (rep && rep.created ? '<p>The tool\'s clock said ' + esc(rep.created) + '.</p>' : '') + copiesHtml(st, g) +
      '<p>Flightdeck compares inputs with this run\'s details only; it can\'t see your other systems.</p></details>';
    return '<section class="rep-card" aria-labelledby="' + id + '-h">' + (folded
      ? '<details><summary><h4 class="rep-h" id="' + id + '-h" tabindex="-1">' + head + '</h4></summary>' + h + '</details>'
      : '<h4 class="rep-h" id="' + id + '-h" tabindex="-1">' + head + '</h4>' + h) + '</section>';
  }
  /* Why a report can't be accepted. Copies that differ are named in the line when there are a few; past 3, one summary line
     and a fold naming them 50 at a time (2.11, D10), built only for the names shown. The reason core gives (for the CLI and
     outside apps) is unchanged. */
  function reasonText(g) { return g.differ && g.copies.length > 3 ? g.copies.length.toLocaleString('en-US') + ' copies of this report differ, so none of them can be accepted. Delete the wrong ones.' : g.reason; }
  function reasonHtml(st, g) {
    if (!(g.differ && g.copies.length > 3)) return '<div class="notice warn"><span>' + esc(g.reason) + '</span></div>';
    var k = 'repdiff:' + g.key;
    return '<div class="notice warn rep-differ"><div>' + esc(reasonText(g)) + '<details data-disc="' + esc(k) + '"' + ((st.disc || {})[k] ? ' open' : '') + '><summary class="small">Which copies</summary>' +
      K.list(st, k, copyRows(g), { keyOf: function (x) { return x.k; }, focusOf: function (i) { return K.byId('repd-' + g.key + '-' + i); },
        draw: function (shown) { return '<ul class="small rep-names">' + shown.map(function (x) { PF.perf.add('rep.differ'); return '<li id="' + esc('repd-' + g.key + '-' + x.k) + '" tabindex="-1"><code>' + esc(x.c.name) + '</code></li>'; }).join('') + '</ul>'; } }) + '</details></div></div>';
  }
  /* A report's copies as list items, each keyed by its file (its path), never its place: a copy arriving above doesn't turn
     the line someone is on into another. */
  function copyRows(g) { var ks = K.uniqKeys(g.copies, function (c) { return c.path || c.name; }); return g.copies.map(function (c, i) { return { c: c, k: K.domKey(ks[i]) }; }); }
  /* Every physical copy of a report, each line built only when drawn (2.11): the first 10, then Show all, which lists them
     50 at a time inside the fold. */
  function copiesHtml(st, g) {
    var line = function (c, i) { PF.perf.add('rep.copy'); return '<p class="rep-copy" id="' + esc('repc-' + g.key + '-' + i) + '" tabindex="-1">' + esc(c.path || c.name) + (c.sha256 ? ' · SHA-256 ' + esc(c.sha256) : '') + (c.ok ? '' : ' · ' + esc(c.why || 'can\'t be read')) + '</p>'; };
    var all = (st.repCopies || {})[g.key], list = copyRows(g);
    if (list.length <= 10) return list.map(function (x) { return line(x.c, x.k); }).join('');
    if (!all) return list.slice(0, 10).map(function (x) { return line(x.c, x.k); }).join('') + '<p class="row"><button type="button" class="mini" data-act="rep-copies" data-id="' + esc(g.key) + '" data-focus="' + esc(K.byId('repc-' + g.key + '-' + list[10].k)) + '">Show all ' + list.length.toLocaleString('en-US') + ' copies</button></p>';
    return K.list(st, 'repc:' + g.key, list, { keyOf: function (x) { return x.k; }, focusOf: function (k) { return K.byId('repc-' + g.key + '-' + k); }, draw: function (shown) { return shown.map(function (x) { return line(x.c, x.k); }).join(''); } });
  }
  /* A report with a decline reason kept (repDrafts) whose files are gone, from what it said when the reason was typed
     (repSnaps): the reason, Copy my text and Cancel, never Decline (2.11). */
  function goneCard(ctx, x) {
    var rid = X.reasonId(x.key), id = 'repg-' + X.reasonId(x.key).replace(/^rep-reason-/, '');
    return '<section class="rep-card rep-gone" aria-labelledby="' + esc(id) + '-h"><h4 class="rep-h" id="' + esc(id) + '-h" tabindex="-1">' + esc(x.snap.says || 'A report') + ' · ' + esc(x.snap.producer || '') + '</h4>' +
      '<p class="small"><b>Removed elsewhere.</b> This report\'s files aren\'t in the team folder anymore, so it can\'t be declined. Your reason is still here to copy.</p>' +
      '<div class="rep-confirm" role="group" data-draft-kept><label class="small" for="' + esc(rid) + '">Why not?</label><textarea id="' + esc(rid) + '" rows="2" maxlength="' + X.LIMITS.text + '">' + esc(x.text || '') + '</textarea>' +
      '<div class="row"><button class="btn" data-act="rep-copy-reason" data-id="' + esc(x.key) + '">Copy my text</button><button class="btn" data-act="rep-cancel" data-id="' + esc(x.key) + '">Cancel</button></div></div></section>';
  }

  /* Accept, Decline and Reopen, for the recorder; disabled with the reason beside it when a report can't be accepted. */
  function actions(ctx, r, map, g, dec, id) {
    var st = ctx.state, b = bundle(ctx, r), busy0 = st.repSaving === g.key, pick = st.repPick && st.repPick.key === g.key ? st.repPick : null;
    /* A decline reason being typed (open, or kept from before) stays on screen with Cancel whatever changes under it. */
    var draft = ctx.repDraft ? ctx.repDraft(g.key) : null;
    if ((pick && pick.mode === 'decline') || draft != null) {
      var stop = !ctx.recording(r) ? 'You aren\'t recording this run now, so this report can\'t be declined here.' : !g.report ? 'Every copy of this report is gone, so it can\'t be declined.' : (b.held ? b.held(g) : '');
      var rid = X.reasonId(g.key), err = st.fieldErr && st.fieldErr.id === rid;
      return '<div class="rep-confirm" role="group" data-draft-kept aria-labelledby="' + id + '-dc"><h4 id="' + id + '-dc" tabindex="-1">Decline this report?</h4>' + K.ferr(st, rid) +
        '<label class="small" for="' + rid + '">Why not? The run will show this.</label><textarea id="' + rid + '" rows="2" maxlength="' + X.LIMITS.text + '"' + (busy0 ? ' readonly' : '') + (err ? ' aria-invalid="true" aria-describedby="ferr-' + rid + '"' : '') + '>' + esc(draft || '') + '</textarea>' +
        (stop ? '<p class="small" id="' + id + '-dcwhy">' + esc(stop) + '</p>' : '') +
        '<div class="row"><button class="btn"' + (stop ? ' disabled aria-describedby="' + id + '-dcwhy"' : ' data-act="rep-decline-go" data-id="' + esc(g.key) + '"' + (busy0 ? ' disabled' : '')) + '>Decline</button><button class="btn" data-act="rep-cancel" data-id="' + esc(g.key) + '">Cancel</button></div></div>';
    }
    if (!ctx.recording(r)) return '';
    /* Every copy gone: only Reopen, on the decision's own SHA-256. */
    if (!g.report) return dec.d && dec.d.status !== 'open' && !(b.held && b.held(g)) ? '<div class="row rep-acts" role="group" aria-label="Decide on this report"><button class="mini" data-act="rep-reopen" data-id="' + esc(g.key) + '"' + (busy0 ? ' disabled' : '') + '>Reopen</button></div>' : '';
    var busy = busy0;
    var held = b.held ? b.held(g) : '';
    var el = X.eligible(g, r, map, { recording: true, readOnly: b.readOnly, held: held, fillOpen: b.fillOpen ? b.fillOpen(g.step) : false });
    var h = '';
    if (held) return '<div class="notice warn" role="status"><span>' + esc(held) + '</span></div>';
    if (pick && pick.mode === 'accept' && el.ok) {
      var labels = el.step ? R.evidenceFor(r, el.step).list : [], vals = labels.filter(function (d) { return el.values[d.name]; }).map(function (d) { return d.label + ' ' + el.values[d.name]; });
      h += '<div class="rep-confirm" role="group" aria-labelledby="' + id + '-cf"><h4 id="' + id + '-cf" tabindex="-1">Accept this report?</h4>' +
        '<p>Checks "' + esc(K.stepPlain(el.step, K.refValue(r, R.mapOf(r)))) + '"' + (vals.length ? ' with: ' + esc(vals.join(', ')) : ' with no evidence') + '.</p>' +
        el.replaces.map(function (x) { return '<p class="small">Replaces ' + esc(x.label) + ' ' + esc(x.was) + '.</p>'; }).join('') +
        (el.applies.result === 'unknown' ? '<p class="small">Flightdeck can\'t compare these inputs.</p>' : '') +
        (el.applies.untied.length ? '<p class="small">' + esc(X.appliesText(el.applies)) + '</p>' : '') +
        '<div class="row"><button class="btn go" data-act="rep-accept-go" data-id="' + esc(g.key) + '"' + (busy ? ' disabled' : '') + '>Accept and check the step</button><button class="btn" data-act="rep-cancel" data-id="' + esc(g.key) + '">Cancel</button></div></div>';
      return h;
    }
    var acts = '';
    if (dec.state !== 'accepted') acts += el.ok ? '<button class="btn go" data-act="rep-accept" data-id="' + esc(g.key) + '"' + (busy ? ' disabled' : '') + '>Accept</button>'
      : '<button class="btn" disabled aria-describedby="' + id + '-why">Accept</button><span class="small rw-why-off" id="' + id + '-why">' + esc(el.why === g.reason ? reasonText(g) : el.why) + '</span>';
    if (dec.state !== 'declined' && g.sha256) acts += '<button class="btn" data-act="rep-decline" data-id="' + esc(g.key) + '"' + (busy ? ' disabled' : '') + '>Decline</button>';
    if (dec.state !== 'none' && dec.state !== 'open' && g.sha256) acts += '<button class="mini" data-act="rep-reopen" data-id="' + esc(g.key) + '"' + (busy ? ' disabled' : '') + '>Reopen</button>';
    return acts ? '<div class="row rep-acts" role="group" aria-label="Decide on this report">' + acts + '</div>' : '';
  }

  /* The inspector's Reports section: only on steps with a report. Several are folded to one line each, in order: 20 at a
     time (2.11), in the same order, with an open form, a kept decline reason and a report a panel link opened always drawn. */
  function listId(r, stepId) { return 'repcards:' + r.process + '/' + r.id + ':' + stepId; }
  function section(ctx, r, map, stepId) {
    var b = bundle(ctx, r), items = onStep(ctx, r, stepId), st = ctx.state, lid = listId(r, stepId);
    var gone = ctx.repGone ? ctx.repGone(r, stepId) : [];
    if (!items.length && !gone.length) return '';
    var many = items.length > 1, open = st.repPick ? st.repPick.key : '', js = st.justShown && st.justShown.lists ? st.justShown.lists[lid] : null;
    var kept = function (k) { return ctx.repDraft && ctx.repDraft(k) != null; };
    var list = items.map(function (it) { return { it: it }; });
    var keep = list.filter(function (x) { return x.it.g.key === open || kept(x.it.g.key); }).map(function (x) { return x.it.g.key; });
    return '<section class="rw-box rw-reps" aria-labelledby="ins-reps"><h3 class="rw-h3" id="ins-reps">Reports · ' + items.length + '</h3>' +
      failedNote(b) + (b.loading ? '<p class="small" role="status">Reading reports…</p>' : '') +
      (list.length ? K.list(st, lid, list, { page: 20, keyOf: function (x) { return x.it.g.key; }, focusOf: function (k) { return '#' + cardId(k) + '-h'; }, keep: keep, keptLabel: 'The ones you\'re deciding on', shownWord: 'opened',
        draw: function (shown) { return shown.map(function (x) { PF.perf.add('rep.card'); return card(ctx, r, map, x.it, many && x.it.g.key !== open && !kept(x.it.g.key) && x.it.g.key !== js); }).join(''); } }) : '') +
      gone.map(function (x) { return goneCard(ctx, x); }).join('') + '</section>';
  }

  /* The reports folder couldn't be read on the last check: what's shown is the last read, said wherever reports are. */
  function failedNote(b) {
    return (b.failed ? '<div class="notice warn" role="status"><span>The reports folder couldn\'t be read on the last check: ' + esc(b.failed) + (b.list.length ? ' These are the reports as last read.' : '') + '</span></div>' : '') +
      (b.histFailed ? '<div class="notice warn" role="status"><span>The run\'s history couldn\'t all be read (' + esc(b.histFailed) + '), so an acceptance it names may not be shown.</span></div>' : '');
  }

  /* The run's Reports panel (rail): every report on the run in checklist order, with where each stands. */
  function panel(ctx, r, map) {
    if (!ctx.state.repOpen) return '';
    var b = bundle(ctx, r), order = M.steps(map).map(function (y) { return y.step.id; });
    var items = b.list.slice().sort(function (a, c) { var i = order.indexOf(a.g.step), j = order.indexOf(c.g.step); return (i < 0 ? 1e9 : i) - (j < 0 ? 1e9 : j); });
    /* 20 at a time (2.11), each row built only when drawn; each opens its own card (data-report), not only its step. */
    var row = function (it) {
      PF.perf.add('rep.row');
      var g = it.g, x = M.findStep(map, g.step), dec = decidedOf(ctx, r, map, g);
      return '<li><button class="link" data-act="rep-goto" data-id="step-' + esc(g.step) + '" data-report="' + esc(g.key) + '">' + (x ? K.stepHtml(x.step, K.refValue(r, map), false) : esc(g.step)) + '</button><span class="small">' + esc(saysText(g.report)) + ' · ' + esc(g.producer) + ' · ' + esc(dec.text) + '</span></li>';
    };
    /* A file that isn't named as a report, keyed by its path. */
    var bn = b.badNames || [], bk = K.uniqKeys(bn, function (e) { return e.path || e.name; }).map(K.domKey);
    var all = items.concat(bn.map(function (e, i) { return { bad: '<li class="small" id="repbad-' + bk[i] + '" tabindex="-1">' + esc(e.path || e.name) + ': isn\'t named as a report.</li>', k: bk[i] }; }));
    return '<section class="rw-panel" id="rw-reps" aria-label="Reports"><h2 class="rw-h2">Reports</h2>' +
      failedNote(b) +
      (b.loading ? '<p class="small" role="status">Reading reports…</p>' : '') +
      (all.length ? K.list(ctx.state, 'reppanel:' + r.process + '/' + r.id, all, { page: 20, keyOf: function (it) { return it.bad != null ? 'bad#' + it.k : it.g.key; },
        focusOf: function (k) { return /^bad#/.test(k) ? '#repbad-' + String(k).slice(4) : '[data-act="rep-goto"][data-report="' + K.cssStr(k) + '"]'; },
        draw: function (shown) { return '<ul class="replist">' + shown.map(function (it) { return it.bad != null ? it.bad : row(it); }).join('') + '</ul>'; } }) : b.failed ? '' : '<p class="small">No reports on this run. A tool writes them with flightdeck report write.</p>') + '</section>';
  }
  /* The rail button beside Follow-ups. */
  function button(ctx, r, where) {
    var n = bundle(ctx, r).list.length;
    var failed = !!bundle(ctx, r).failed;
    if (!n && !failed && !ctx.state.repOpen) return '';
    return '<button class="mini" data-act="run-reports" data-id="' + esc(where) + '" aria-expanded="' + !!ctx.state.repOpen + '" aria-controls="rw-reps">' + I('flag') + 'Reports · ' + n + (failed ? ' · couldn\'t be read' : '') + '</button>';
  }

  V.reportCardId = cardId; V.reportListId = listId; V.reportBadge = badge; V.reportSection = section; V.reportPanel = panel; V.reportButton = button; V.reportSays = saysText;
})();
