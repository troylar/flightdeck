/* The Export evidence dialog (docs/evidence.md): choose the runs, see what goes in and about how big it is, make the pack
   with progress and Cancel, then save it and keep its SHA-256 somewhere separate. On a phone it's a sheet. ov is the open
   dialog's state, kept by src/ui/exporter.js. */
(function () {
  'use strict';
  var V = PF.views, U = PF.util, E = PF.evidence, esc = U.esc, I = PF.icons.icon;

  function counts(ctx, ov) {
    var p = ov.plan, runs = p.keys.map(function (k) { return ctx.findRun(k); }).filter(Boolean);
    var answers = 0, notes = 0;
    runs.forEach(function (r) { Object.keys(r.steps || {}).forEach(function (k) { if (r.steps[k] && r.steps[k].s !== 'open') answers++; }); notes += (r._notes || []).length; });
    var parts = [p.keys.length + ' run' + (p.keys.length === 1 ? '' : 's')];
    if (runs.length === p.keys.length) parts.push(answers + ' answer' + (answers === 1 ? '' : 's'), notes + ' note' + (notes === 1 ? '' : 's'));
    parts.push(ov.attachments ? p.attach.n + ' attachment' + (p.attach.n === 1 ? '' : 's') + (p.attach.n ? ' (' + E.size(p.attach.bytes) + ')' : '') : 'attachments left out');
    /* The estimate is an upper bound (the page at its largest), so it's said as one. */
    parts.push('up to ' + E.size(p.estimate));
    return parts.join(' · ');
  }
  function what(ov) {
    var s = ov.scope;
    return s.run ? esc(ov.title || s.run) : s.process ? 'Runs of ' + esc(ov.procTitle || s.process) + ' started ' + esc(s.from) + ' through ' + esc(s.through) + ' (' + esc(s.tz) + ')' : 'Runs of one process, by the days they started';
  }
  function askForm(ctx, ov) {
    var procs = ctx.processes().filter(function (p) { return p.id; }), s = ov.form;
    return '<form class="ev-form" id="ev-form" data-nav-safe><label for="ev-proc">Process</label><select id="ev-proc" data-nav-safe>' + procs.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === s.process ? ' selected' : '') + '>' + esc(p.title) + '</option>'; }).join('') + '</select>' +
      '<div class="ev-days"><span><label for="ev-from">First day</label><input id="ev-from" type="date" data-nav-safe value="' + esc(s.from) + '"' + (ov.fieldErr === 'ev-from' ? ' aria-invalid="true" aria-describedby="ev-err"' : '') + '></span>' +
      '<span><label for="ev-through">Last day</label><input id="ev-through" type="date" data-nav-safe value="' + esc(s.through) + '"' + (ov.fieldErr === 'ev-through' ? ' aria-invalid="true" aria-describedby="ev-err"' : '') + '></span></div>' +
      '<p class="small">Runs that started on these days, both included, in this computer\'s time zone (' + esc(ov.tz) + ').</p>' +
      (ov.err ? '<p class="ferr" id="ev-err" role="alert">' + esc(ov.err) + '</p>' : '') +
      '<div class="row"><button type="button" class="btn primary" data-act="ev-check">Check what\'s included</button></div></form>';
  }
  function evidence(ctx, ov) {
    var st = ov.stage, h = '<div class="overlay" data-act="close-overlay"><div class="ev-box" role="dialog" aria-modal="true" aria-labelledby="ev-t"><div class="ev-bar"><h2 id="ev-t">Export evidence</h2><button type="button" class="mini" id="ev-close" data-act="close-overlay">' + (st === 'work' ? 'Cancel' : 'Close') + '</button></div>';
    h += '<p class="ev-what">' + what(ov) + '</p>';
    if (st === 'ask') return h + askForm(ctx, ov) + '</div></div>';
    if (st === 'plan') return h + '<p class="small" role="status">Checking what\'s included…</p></div></div>';
    if (st === 'error') return h + '<div class="notice bad" role="alert"><span>' + esc(ov.err) + '</span></div><div class="row">' + (ov.scope.run ? '' : '<button type="button" class="btn" data-act="ev-back">Change the days</button>') + '<button type="button" class="btn" data-act="ev-again">Try again</button></div></div></div>';
    if (st === 'ready') {
      h += '<p class="ev-count">' + esc(counts(ctx, ov)) + '</p>';
      h += '<p class="ev-privacy small">' + esc(E.PRIVACY) + '</p>';
      if (ov.window && (ov.window.unsaved || ov.window.pending)) h += '<div class="notice warn" role="status"><span>This window has a change that isn\'t in the team folder yet. The pack holds only what\'s saved in the folder.</span>' + (ov.waiting ? '<span class="small">Waiting for the save…</span>' : '<button type="button" class="btn" data-act="ev-wait">Wait for the save</button>') + '</div>';
      h += '<div class="ev-opts"><button type="button" class="ev-switch" role="switch" data-act="ev-attach" aria-checked="' + !!ov.attachments + '"><span class="ev-knob" aria-hidden="true"></span>Include attachments</button>' +
        '<div class="filter" role="group" aria-label="What to make"><button type="button" class="chipbtn" data-act="ev-format" data-id="pack" aria-pressed="' + (ov.format === 'pack') + '">Evidence pack</button><button type="button" class="chipbtn" data-act="ev-format" data-id="report" aria-pressed="' + (ov.format === 'report') + '">Readable report</button></div>' +
        '<p class="small">' + (ov.format === 'pack' ? 'A zip of the original files, a page to read, and SHA-256 hashes to check them by.' : 'One page to read. It isn\'t the evidence pack: it leaves out the original files and their hashes.') + '</p></div>';
      var ex = ov.plan.exclusions.filter(function (x) { return x.path !== 'people.json'; });
      if (ex.length) h += '<details class="small ev-left"><summary>' + ex.length + ' file' + (ex.length === 1 ? '' : 's') + ' left out, each with its reason</summary><ul>' + ex.slice(0, 50).map(function (x) { return '<li><code>' + esc(x.path) + '</code>: ' + esc(x.reason) + '</li>'; }).join('') + (ex.length > 50 ? '<li>and ' + (ex.length - 50) + ' more, listed in the pack</li>' : '') + '</ul></details>';
      return h + '<div class="row"><button type="button" class="btn primary" id="ev-make" data-act="ev-make"' + (ov.waiting ? ' disabled' : '') + '>' + I('doc') + (ov.format === 'pack' ? 'Make the pack' : 'Make the report') + '</button>' + (ov.scope.run ? '' : '<button type="button" class="btn" data-act="ev-back">Change the days</button>') + '</div></div></div>';
    }
    if (st === 'work') {
      var p = ov.progress || {}, line = p.phase === 'read' ? 'Reading ' + p.done + ' of ' + p.total + ' files… Hashing…' : p.phase === 'check' ? 'Checking nothing changed…' : p.phase === 'write' ? 'Writing ' + p.done + ' of ' + p.total + ' files into the pack…' : 'Listing files…';
      var pct = p.total ? Math.round(100 * p.done / p.total) : 0;
      return h + '<p class="small" role="status" id="ev-progress">' + esc(line) + '</p><progress class="ev-bar-p" max="100" value="' + pct + '" aria-labelledby="ev-progress"></progress><div class="row"><button type="button" class="btn" id="ev-cancel" data-act="ev-cancel">Cancel</button></div></div></div>';
    }
    /* done */
    var r = ov.result;
    if (r.status === 'partial') h += '<div class="notice bad" role="alert"><span><b>Partial.</b> ' + r.unresolved.map(esc).join(' ') + ' The pack lists this at the top.</span></div>';
    else h += '<p class="small" role="status">' + (ov.format === 'pack' ? 'The pack is ready.' : 'The report is ready.') + '</p>';
    h += '<div class="row"><button type="button" class="btn primary" id="ev-save" data-act="ev-save">' + I('doc') + (ov.format === 'pack' ? 'Save the pack' : 'Save the report') + '</button><span class="small">' + esc(r.name) + ' · ' + esc(E.size(r.size)) + '</span></div>' +
      '<p class="small">It goes to your browser\'s downloads, never into the team folder.</p>' +
      '<div class="ev-digest"><span class="small">SHA-256 of this ' + (ov.format === 'pack' ? 'pack' : 'report') + ':</span><code id="ev-sha">' + esc(r.digest) + '</code><span class="small">Keep it somewhere separate. Anyone checking the pack later compares it with the one you kept; the pack can\'t prove by itself that it hasn\'t changed.</span>' +
      '<div class="row"><button type="button" class="mini" data-act="ev-copy">' + I('copy') + 'Copy</button><span class="small" id="ev-copy-msg" aria-live="polite">' + (ov.copied ? esc(ov.copied) : '') + '</span></div></div>';
    return h + '</div></div>';
  }

  V.evidence = evidence;
})();
