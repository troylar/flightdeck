/* Pages about one run: screen-share mode, finishing it, and the receipt. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, R = PF.run, M = PF.map, T = PF.types, I = PF.icons.icon, esc = U.esc;
  var person = K.person, nameOf = K.nameOf, avatar = K.avatar, notices = K.notices, ago = K.ago, runKey = K.runKey, freshness = K.freshness;
  var ferr = function (s, id) { return K.ferr(s, id); };
  /* ---------- mission control ---------- */
  function mission(ctx) {
    var r = ctx.run(); if (!r) return V.run(ctx);
    var map = R.mapOf(r), hl = K.headline(r, map), now = ctx.now(), rv = K.refValue(r, map), cur = null;
    map.phases.some(function (p, pi) { var st = R.gateStatus(r, map, pi); if (st !== 'passed' && st !== 'waived') { cur = pi; return true; } return false; });
    /* Who records and whether it's paused stay visible during a call, with save and folder problems (notices) above. */
    var who = r.ended ? 'Ended' : r.paused ? 'Paused by ' + nameOf(ctx, r.paused.by) + ': ' + r.paused.reason : !r.recorder.session ? 'Waiting for ' + nameOf(ctx, r.recorder.person) + ' to pick up recording' : nameOf(ctx, r.recorder.person) + ' is recording' + (ctx.recording(r) ? ' (you, in this window)' : '');
    var h = notices(ctx) + '<div class="runhead"><div><div class="eyebrow">' + esc(map.meta.title) + ' · ' + esc(K.verWord(r)) + '</div><h1 id="page-h" tabindex="-1">' + esc(r.title) + '</h1><div class="m-rec">' + esc(who) + '</div><span id="fresh">' + freshness(ctx, r) + '</span></div><button class="btn" data-act="exit-mission">' + I('back') + 'Back to the run</button></div>';
    h += '<div class="mission"><div class="stack"><div class="headline" data-s="' + hl.s + '"><div><div class="now">' + esc(K.hlText(r, hl)) + '</div><div>' + esc(hl.sub) + '</div></div></div>';
    if (cur != null) {
      var p = map.phases[cur];
      h += '<h2>' + esc(p.title) + '</h2><ul class="msteps">' + p.steps.map(function (s) {
        var a = r.steps[s.id], st = a && a.s !== 'open' ? a.s : 'open', who = s.roles.map(function (ro) { return r.roles[ro] ? avatar(ctx, r.roles[ro], true) : ''; }).join('');
        var right = a && a.deadline && st !== 'done' ? '<span class="timer due" data-until="' + esc(a.deadline.at) + '">' + U.clock(new Date(a.deadline.at) - now) + '</span>' : a && a.started && st !== 'done' && st !== 'na' ? (r.paused ? '<span class="timer">' + U.clock(R.activeMs(r, a.started.at, now)) + ' · paused</span>' : '<span class="timer" data-since="' + esc(a.started.at) + '" data-offset="' + ((now - new Date(a.started.at).getTime()) - R.activeMs(r, a.started.at, now)) + '">' + U.clock(R.activeMs(r, a.started.at, now)) + '</span>') : '';
        var why = a && (st === 'blocked' || st === 'recheck') && a.reason ? '<span class="m-why">' + (st === 'blocked' ? 'Blocked: ' : 'Re-check: ') + esc(a.reason) + '</span>' : '';
        return '<li data-a="' + st + '"><span class="ric ' + st + '">' + ({ done: '✓', na: 'N/A', blocked: '■', recheck: '↻', open: '○' }[st]) + '<span class="sr"> ' + st + '</span></span><span>' + K.stepHtml(s, rv) + ' ' + who + why + '</span>' + right + '</li>';
      }).join('') + '</ul>';
    }
    h += '</div><div class="stack"><h2>Gates</h2><ul class="gates">' + map.phases.map(function (p, pi) {
      var st = R.gateStatus(r, map, pi);
      return '<li><span>' + esc(p.gate.implicit ? 'Confirm ' + p.title : p.gate.title) + '</span><span class="pill ' + st + '">' + esc(st) + '</span></li>';
    }).join('') + '</ul><h2>Who\'s on what</h2><ul class="gates">' + map.meta.roles.map(function (ro) { return '<li><span>' + esc(ro) + '</span><span class="row">' + (r.roles[ro] ? avatar(ctx, r.roles[ro], true) + esc(nameOf(ctx, r.roles[ro])) : '<span class="muted">nobody</span>') + '</span></li>'; }).join('') + '</ul></div></div>';
    return h;
  }

  /* A correction row's own id from its list key (id, or id#n for a later note sharing that id). */
  function corrFocus(k) { var m = /^(.*)#(\d+)$/.exec(k); return K.byId(m ? V.corrDomId(m[1], +m[2]) : V.corrDomId(k, 1)); }
  /* ---------- finishing a run ---------- */
  function finish(ctx) {
    var r = ctx.run(); if (!r) return V.run(ctx);
    var s = ctx.state, map = R.mapOf(r), rec = ctx.recording(r), ok = R.allGatesOk(r, map), fus = r.followUps || [], cor = PF.corrections.forRun(r, map, { at: true }), idx = cor.length ? V.corrIndex(ctx, r.process) : {};
    var people = PF.people.sorted(ctx).filter(function (p) { return !p.inactive; });
    var h = notices(ctx) + '<div class="runhead"><div><div class="eyebrow">' + esc(map.meta.title) + ' · ' + esc(K.verWord(r)) + '</div><h1 id="page-h" tabindex="-1">Finish ' + esc(r.title) + '</h1></div><button class="btn" data-act="exit-mission">' + I('back') + 'Back to the run</button></div>';
    if (!rec) return h + '<div class="notice warn"><span>Only the recorder can finish the run.</span></div>';
    /* Only what has something in it: the follow-up form waits under Add a follow-up (opened by an error, or once opened). */
    var fuOpen = (s.disc || {})['fu-add'] || (s.fieldErr && s.fieldErr.id === 'followup');
    h += '<div class="finish"><section class="panel stack"><h2>Follow-ups' + (fus.length ? ' · ' + fus.length : '') + '</h2>';
    if (fus.length) h += '<ul class="fulist">' + PF.followups.forRun(V.fuList(ctx), r).map(function (x) { return V.fuRow(ctx, x, { remove: true, actions: false }); }).join('') + '</ul>';
    var nmFu = PF.people.labeler(people);
    h += '<details class="fu-add" data-disc="fu-add"' + (fuOpen ? ' open' : '') + '><summary class="btn">Add a follow-up</summary><p class="small">Work this run turned up that outlives it. It goes on the receipt and stays on its owner\'s Home until someone says what became of it.</p>' + ferr(s, 'followup') + '<div class="grid2"><label class="field" for="fu-text">What needs doing<input id="fu-text" maxlength="300" data-enter="add-followup"' + (s.fieldErr && s.fieldErr.id === 'followup' ? ' aria-invalid="true" aria-describedby="ferr-followup"' : '') + '></label><label class="field" for="fu-owner">Who<select id="fu-owner"><option value="">Nobody yet</option>' + people.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(nmFu(p)) + '</option>'; }).join('') + '</select></label><label class="field" for="fu-ticket">Jira ticket (optional)<input id="fu-ticket" maxlength="120" placeholder="ABC-123"></label></div><button class="btn" style="align-self:flex-start" data-act="add-followup">Add follow-up</button></details></section>';
    h += !cor.length ? '<p class="small fin-none">No corrections.</p>' : '<section class="panel stack"><h2>Corrections · ' + cor.length + '</h2><p class="small">Where the checklist was wrong or the work went differently. They also wait on the checklist\'s page, where the team decides on them.</p>' +
      K.list(s, 'fin-corr:' + r.process + '/' + r.id, V.corrItems(cor), { keyOf: function (x) { return x.k; }, focusOf: corrFocus, draw: function (shown) { return '<ul class="corrlist">' + shown.map(function (x) {
        var c = x.c;
        var fu = '<button class="mini" data-act="add-followup" data-text="' + esc(('Update the checklist: ' + (c.stepText || c.step) + ' (' + (c.proposed || c.why || c.happened) + ')').slice(0, 300)) + '" data-step="' + esc(c.step) + '" data-from="' + esc(c.id) + '">Make it a follow-up</button>';
        return V.corrRow(ctx, c, idx[c.id], { step: true, domId: x.dom, followUp: fus.some(function (f) { return f.from === c.id; }) ? '<span class="small">Follow-up added</span>' : fu });
      }).join('') + '</ul>'; } }) + '</section>';
    h += '<section class="panel stack"><h2>End the run</h2><div class="row">' + ['Completed', 'Stopped early', 'Cancelled'].map(function (o) {
      var allowed = o !== 'Completed' || ok;
      return '<button class="btn' + (o === 'Completed' ? ' go' : '') + '" data-act="end" data-id="' + o + '"' + (allowed ? '' : ' disabled aria-describedby="end-why"') + '>End as ' + esc(K.outcomeWord(o)) + '</button>';
    }).join('') + '</div>' + (ok ? '' : '<p class="small" id="end-why">Completed needs every gate passed or waived.</p>') + '<p class="small">The receipt opens next, ready to copy into Jira.</p></section></div>';
    return h;
  }

  /* ---------- receipt ---------- */
  /* What a receipt's reports and statuses read, shared by the page and the copied text. */
  function receiptParts(ctx, r, map) {
    var who = function (id) { return nameOf(ctx, id); }, rb = ctx.reports ? ctx.reports(r) : null, reps = rb ? rb.list.map(function (it) { return it.g; }) : [];
    var reportOf = function (id) { return PF.reports.provenance(r, id, who, rb ? rb.archived : null); };
    var cor = R.corrections(r, map), idx = cor.length ? V.corrIndex(ctx, r.process) : {};
    var statusOf = function (c) { var g = idx[c.id]; return c.oneOff ? 'One-off' : g ? PF.corrections.label(g) + (g.status === 'declined' && g.decision && g.decision.reason ? ': ' + g.decision.reason : '') : 'Open'; };
    var fuX = PF.followups.forRun(V.fuList(ctx), r), fuOf = function (f) { return fuX.filter(function (x) { return x.id === f.id; })[0]; };
    var fuStatusOf = function (f) { var x = fuOf(f); if (!x) return 'Open'; var d = PF.followups.detail(x, function (k) { if (/^plan:/.test(k)) { var pl = (ctx.data.plans || []).filter(function (q) { return 'plan:' + q.id === k; })[0]; return pl ? pl.title : ''; } var t = ctx.findRun ? ctx.findRun(k) : null; return t ? t.title : ''; }); return x.status === 'open' || !d ? x.label : d; };
    return { who: who, rb: rb, reps: reps, reportOf: reportOf, cor: cor, idx: idx, statusOf: statusOf, fuOf: fuOf, fuStatusOf: fuStatusOf };
  }
  /* The receipt as text, for Copy for Jira: every report and correction, worked out when it's copied, not on every draw (2.11). */
  function receiptText(ctx) {
    var r = ctx.run(); if (!r) return '';
    var map = R.mapOf(r), x = receiptParts(ctx, r, map);
    x.reportOf.lines = PF.reports.lines(x.reps, x.rb ? x.rb.cur : null, r, map, x.who);
    return R.receipt(r, map, x.who, new Date(ctx.now()).toISOString(), r._notes, x.statusOf, x.fuStatusOf, x.reportOf);
  }
  function receipt(ctx) {
    var r = ctx.run(); if (!r) return V.run(ctx);
    var map = R.mapOf(r), hl = K.headline(r, map), rv = K.refValue(r, map), ICON = { done: '✓', na: 'N/A', blocked: '■', recheck: '↻', open: '○' };
    var det = map.meta.context.filter(function (f) { return r.details[f]; }).map(function (f) { return f + ': ' + R.shown(r, map, 'details.' + f, r.details[f]); }).join(' · ');
    /* Where an answer came from, when it was an accepted report: from the run's own log line, which names the report's bytes. */
    var parts = receiptParts(ctx, r, map), rb = parts.rb, reps = parts.reps, reportOf = parts.reportOf, st = ctx.state, rkey = r.process + '/' + r.id;
    /* Conditions (2.1): what wasn't needed is listed once, with why, after the phases. */
    var notNeeded = [];
    var body = map.phases.map(function (p, pi) {
      var gst = R.gateStatus(r, map, pi);
      if (gst === 'skipped') { notNeeded.push(p.title + ' (phase): ' + R.applies(r, map, pi).why); return ''; }
      return '<div><h4><span>' + esc(p.title) + '</span><span class="pill plain ' + gst + '">' + esc(p.gate.title) + ' · ' + esc(K.gateWord(gst)) + '</span></h4>' + p.steps.map(function (s) {
        var ap = R.applies(r, map, pi, s);
        if (ap.applies === false) { notNeeded.push(K.stepPlain(s, rv) + ': ' + ap.why); return ''; }
        var a = r.steps[s.id], st = a && a.s !== 'open' ? a.s : 'open';
        var ev = a && a.s === 'done' && a.values ? R.evidenceFor(r, s).list.filter(function (d) { return a.values[d.name]; }).map(function (d) { return esc(d.label) + ': ' + esc(R.shown(r, map, 'steps.' + s.id + '.values.' + d.name, a.values[d.name])); }).join(' · ') : '';
        var from = a && a.s === 'done' ? reportOf(s.id) : '';
        return '<div class="rrow"><span class="ric ' + st + '">' + ICON[st] + '<span class="sr"> ' + st + '</span></span><span>' + K.stepHtml(s, rv) + (a && a.differently ? ' <span class="badge b-diff">differently</span>' : '') + (ev ? '<span class="small" style="display:block">' + ev + '</span>' : '') + (from ? '<span class="small" style="display:block">' + esc(from[0].toUpperCase() + from.slice(1)) + '</span>' : '') + '</span><span class="small">' + esc(ap.applies === null ? ap.why : a && (a.s === 'blocked' || a.s === 'recheck') ? a.reason : '') + '</span></div>';
      }).join('') + '</div>';
    }).join('');
    if (notNeeded.length) body += '<div class="r-nn"><h4><span>Not needed in this run</span></h4>' + notNeeded.map(function (x) { return '<div class="rrow"><span class="ric open">–</span><span class="small">' + esc(x.replace(/\^/g, '')) + '</span></div>'; }).join('') + '</div>';
    var fus = r.followUps || [], cor = parts.cor, idx = parts.idx;
    var pz = (r.pauses || []).concat(r.paused ? [{ from: r.paused.at, to: null, by: r.paused.by, reason: r.paused.reason }] : []);
    if (pz.length) body += '<div><h4><span>Pauses</span></h4>' + pz.map(function (p) { return '<div class="rrow"><span class="ric open">' + I('pause') + '</span><span>' + esc(U.hm(p.from)) + (p.to ? '–' + esc(U.hm(p.to)) + ' (' + U.clock(new Date(p.to) - new Date(p.from)) + ')' : ', still paused') + ': ' + esc(p.reason) + ' <span class="cat">' + esc(nameOf(ctx, p.by)) + '</span></span></div>'; }).join('') + '</div>';
    var fuOf = parts.fuOf, fuStatusOf = parts.fuStatusOf;
    if (fus.length) body += '<div class="r-fu"><h4><span>Follow-ups</span></h4>' + fus.map(function (f) {
      var x = fuOf(f);
      return '<div class="rrow"><span class="ric open">→</span><span>' + esc(f.text) + (f.ticket ? ' <span class="cat">' + esc(f.ticket) + '</span>' : '') + (x ? ' ' + V.fuPill(x) : '') + (x && x.decision && !x.tie && x.status !== 'open' ? '<span class="small" style="display:block">' + esc(fuStatusOf(f)) + '</span>' : '') + '</span><span class="small">' + esc(f.owner ? nameOf(ctx, f.owner) : '') + '</span></div>';
    }).join('') + '</div>';
    var unread = reps.filter(function (g) { return g.unreadable.length; }).length;
    /* 50 report groups at a time, formatted only when drawn (2.11); Copy for Jira formats every one. */
    if (reps.length || (rb && (rb.loading || rb.failed))) body += '<div class="r-reps"><h4><span>Reports · ' + reps.length + '</span></h4>' +
      (rb.loading ? '<p class="small" role="status">Reading reports…</p>' : '') +
      (rb.failed ? '<p class="small">The reports couldn\'t be read, so this receipt may be missing some.</p>' : unread ? '<p class="small">' + unread + ' report' + (unread === 1 ? ' couldn\'t' : 's couldn\'t') + ' be read; this receipt may be missing ' + (unread === 1 ? 'it' : 'them') + '.</p>' : '') +
      K.list(st, 'rcpt-reps:' + rkey, reps, { keyOf: function (g) { return g.key; }, focusOf: function (k) { return K.byId('rr-' + k); },
        draw: function (shown) { return PF.reports.lines(shown, rb ? rb.cur : null, r, map, parts.who).map(function (l, i) { return '<div class="rrow rr-rep" id="' + esc('rr-' + shown[i].key) + '" tabindex="-1"><span class="ric open">◇</span><span>' + esc(l) + '</span><span></span></div>'; }).join(''); } }) + '</div>';
    /* The page's rows are told apart when two share an id ({ at: true }); the copied text (receiptText) is as it always was. */
    if (cor.length) body += '<div class="r-corr"><h4><span>Corrections · ' + cor.length + '</span></h4>' + K.list(st, 'rcpt-corr:' + rkey, V.corrItems(PF.corrections.forRun(r, map, { at: true })), { keyOf: function (x) { return x.k; }, focusOf: corrFocus,
      draw: function (shown) { return '<ul class="corrlist">' + shown.map(function (x) { return V.corrRow(ctx, x.c, idx[x.c.id], { step: true, domId: x.dom }); }).join('') + '</ul>'; } }) + '</div>';
    return notices(ctx) + '<div class="runhead"><div><div class="eyebrow">Receipt · Copy it into your ticket, or take a screenshot</div><h1 id="page-h" tabindex="-1">' + esc(r.title) + '</h1></div><div class="row"><button class="btn primary" data-act="copy-receipt">' + I('copy') + 'Copy for Jira</button><button class="btn" data-act="exit-mission">' + I('back') + 'Back to the run</button><button class="btn" data-act="ev-open" data-id="' + esc(r.process + '/' + r.id) + '">' + I('doc') + 'Export evidence</button>' + V.planAgain(ctx, r) + '<span class="small" id="copy-msg" aria-live="polite"></span></div></div>' +
      '<div class="receipt"><div class="head"><div><div class="eyebrow">' + esc(map.meta.title) + ' · ' + esc(K.verWord(r)) + '</div><div class="rt">' + esc(r.title) + '</div>' + (det ? '<div class="small">' + esc(det) + '</div>' : '') + '</div><div style="text-align:right"><div class="pill ' + hl.s + '">' + esc(r.ended ? K.hlText(r, hl) : 'In progress') + '</div><div class="small">started ' + esc(U.when(r.created)) + '<br>run ' + esc(r.id) + '</div></div></div>' + body +
      '<div class="small">✓ done · N/A not applicable · ■ blocked · ↻ re-check · ○ not checked</div></div><pre id="receipt-text" hidden></pre>';
  }

  V.mission = mission; V.finish = finish; V.receipt = receipt; V.receiptText = receiptText;
})();
