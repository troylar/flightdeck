/* Export evidence in the app (docs/evidence.md): the dialog's state and actions, kept apart from app.js. The pack is built
   in memory by repo.exportEvidence (read-only, through the shared pool's export lane), then offered as a download; nothing
   is ever written into the team folder. Bound to the folder and generation it started in: switching folders, closing the
   dialog or Cancel stops it between chunks. api: { ctx, state, gen(), open(ov), render(), version }. */
PF.exporter = function (api) {
  'use strict';
  var E = PF.evidence, repo = PF.repo, state = api.state;
  var MAX_RUNS = E.CAPS.runs;

  function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } }
  function cap() { return E.capFor({ width: window.innerWidth, deviceMemory: typeof navigator !== 'undefined' ? navigator.deviceMemory : 0 }); }
  function day(t) { var d = new Date(t), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  /* This window's unsaved or in-flight changes to the runs in the pack: the pack holds only what's in the folder. */
  function windowState(keys) {
    var o = { unsaved: false, pending: false };
    keys.forEach(function (k) { var id = k.split('/')[1]; if ((state.unsaved || {})[id]) o.unsaved = true; if ((state.pendingSaves || {})[id]) o.pending = true; });
    return o;
  }
  function current(ov) { return state.overlay === ov; }
  function bound(ov) { var g = api.gen(), fs = state.fs; return function () { return !ov.canceled && api.gen() === g && state.fs === fs && current(ov); }; }
  function release(ov) { if (ov.url) { try { URL.revokeObjectURL(ov.url); } catch (e) { /* already gone */ } ov.url = null; } ov.blob = null; }

  function open(scope, title, procTitle) {
    var ov = { evidence: true, stage: scope.run ? 'plan' : 'ask', scope: scope, title: title, procTitle: procTitle, tz: tz(), attachments: true, format: 'pack',
      form: { process: scope.process || '', from: day(Date.now() - 30 * 86400000), through: day(Date.now()) },
      html: function () { return PF.views.evidence(api.ctx, this); },
      held: function () { return ov.stage === 'work'; } };
    /* closeOverlay calls this unbound: closing stops an export under way and lets go of the pack. */
    ov.onClose = function () { ov.canceled = true; release(ov); };
    state.overlayFocus = scope.run ? '#ev-close' : '#ev-proc';
    api.open(ov);
    if (scope.run) plan(ov);
    return ov;
  }
  function plan(ov) {
    var live = bound(ov), fs = state.fs;
    ov.stage = 'plan'; ov.err = ''; api.render();
    var scope = ov.scope.run ? { run: ov.scope.run } : ov.scope;
    repo.collectEvidence(fs, scope, { plan: true, cap: cap(), maxRuns: MAX_RUNS, attachments: ov.attachments, tz: ov.tz }).then(function (col) {
      if (!live()) return;
      var attach = { n: 0, bytes: 0 };
      col.files.forEach(function (f) { if (f.role === 'attachment') { attach.n++; attach.bytes += f.size; } });
      col.exclusions.forEach(function (x) { if (x.reason === 'left out, not hashed') { attach.n++; attach.bytes += x.size || 0; } });
      ov.plan = { keys: col.runs.map(function (r) { return r.key; }), estimate: col.estimate, attach: attach, exclusions: col.exclusions };
      ov.window = windowState(ov.plan.keys);
      ov.stage = 'ready'; state.overlayFocus = '#ev-make'; api.render();
    }, function (e) { if (!live()) return; ov.stage = 'error'; ov.err = e && e.message || String(e); api.render(); });
  }
  function make(ov) {
    var live = bound(ov), fs = state.fs, parts = [], last = 0;
    ov.stage = 'work'; ov.progress = null; ov.canceled = false; state.overlayFocus = '#ev-cancel'; api.render();
    var scope = ov.scope.run ? { run: ov.scope.run } : ov.scope;
    repo.exportEvidence(fs, scope, {
      sink: function (u) { parts.push(u); }, cap: cap(), maxRuns: MAX_RUNS, attachments: ov.attachments, format: ov.format, tz: ov.tz, window: windowState(ov.plan.keys), app: api.version, madeWith: 'app',
      cancelled: function () { return !live(); },
      progress: function (p) { if (!live()) return; ov.progress = p; var t = Date.now(); if (t - last > 120) { last = t; api.render(); } }
    }).then(function (res) {
      if (!live()) return;
      ov.blob = new Blob(parts, { type: ov.format === 'pack' ? 'application/zip' : 'text/html' }); parts = null;
      ov.result = { name: res.name, digest: res.digest, size: res.bytes, status: res.status, unresolved: res.col.unresolved };
      ov.stage = 'done'; state.overlayFocus = '#ev-save'; api.render();
    }, function (e) {
      parts = null;
      if (!current(ov)) return;
      if (e && e.cancelled) { ov.stage = 'ready'; ov.canceled = false; state.overlayFocus = '#ev-make'; api.render(); return; }
      ov.stage = 'error'; ov.err = e && e.message || String(e); api.render();
    });
  }
  function waitForSave(ov) {
    ov.waiting = true; api.render();
    var tick = function () {
      if (!current(ov)) return;
      ov.window = windowState(ov.plan.keys);
      if (ov.window.pending) { setTimeout(tick, 300); return; }
      ov.waiting = false;
      /* The save finished: what's in the folder now is what goes in the pack, so look again. */
      plan(ov);
    };
    setTimeout(tick, 300);
  }
  function readForm(ov) {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    ov.form = { process: g('ev-proc'), from: g('ev-from'), through: g('ev-through') };
    ov.fieldErr = null; ov.err = '';
    if (!ov.form.process) { ov.err = 'Choose a checklist.'; ov.fieldErr = 'ev-proc'; return false; }
    try { E.dayRange(ov.form.from, ov.form.through, ov.tz); } catch (e) { ov.err = e.message; ov.fieldErr = /first day/.test(e.message) && !/after/.test(e.message) ? 'ev-from' : 'ev-through'; return false; }
    ov.scope = { process: ov.form.process, from: ov.form.from, through: ov.form.through, tz: ov.tz };
    ov.procTitle = api.ctx.processTitle(ov.form.process);
    return true;
  }
  function ov() { return state.overlay && state.overlay.evidence ? state.overlay : null; }
  /* Typing in the days form is kept in the dialog's state, so a redraw never loses it. */
  document.addEventListener('input', function (e) { var o = ov(); if (!o || o.stage !== 'ask' || !e.target || !/^ev-(proc|from|through)$/.test(e.target.id) || e.target.value === PF.vk.SEL_MORE) return; o.form[{ 'ev-proc': 'process', 'ev-from': 'from', 'ev-through': 'through' }[e.target.id]] = e.target.value; });
  document.addEventListener('change', function (e) { var o = ov(); if (!o || o.stage !== 'ask' || !e.target || e.target.id !== 'ev-proc' || e.target.value === PF.vk.SEL_MORE) return; o.form.process = e.target.value; });

  var actions = {
    'ev-open': function (key) { var r = api.ctx.findRun(key); open({ run: key }, r ? r.title : key); },
    'ev-range': function () { open({}); },
    'ev-check': function () { var o = ov(); if (!o) return; if (!readForm(o)) { state.overlayFocus = '#' + (o.fieldErr || 'ev-proc'); api.render(); return; } plan(o); },
    'ev-back': function () { var o = ov(); if (!o) return; o.stage = 'ask'; o.err = ''; state.overlayFocus = '#ev-from'; api.render(); },
    'ev-again': function () { var o = ov(); if (o) plan(o); },
    'ev-attach': function () { var o = ov(); if (!o || o.stage !== 'ready') return; o.attachments = !o.attachments; state.overlayFocus = '[data-act="ev-attach"]'; plan(o); },
    'ev-format': function (id) { var o = ov(); if (!o || o.stage !== 'ready') return; o.format = id === 'report' ? 'report' : 'pack'; state.overlayFocus = '[data-act="ev-format"][data-id="' + o.format + '"]'; api.render(); },
    'ev-make': function () { var o = ov(); if (o && o.stage === 'ready' && !o.waiting) make(o); },
    'ev-cancel': function () { var o = ov(); if (o && o.stage === 'work') { o.canceled = true; } },
    'ev-wait': function () { var o = ov(); if (o && o.stage === 'ready') waitForSave(o); },
    'ev-save': function () {
      var o = ov(); if (!o || !o.blob) return;
      if (!o.url) o.url = URL.createObjectURL(o.blob);
      var a = document.createElement('a'); a.href = o.url; a.download = o.result.name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    },
    'ev-copy': function () {
      var o = ov(); if (!o || !o.result) return;
      var done = function (msg) { if (!current(o)) return; o.copied = msg; api.render(); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(o.result.digest).then(function () { done('Copied.'); }, function () { done('Select it above and copy it.'); });
      else done('Select it above and copy it.');
    }
  };
  return { actions: actions, open: open };
};
