/* Boxes that know the checklist's run details (2.7): step text, gate approves and the fields a run fills in. A mirror under
   the box colors each ^name by what PF.refs says about it there; under the box, what's wrong with a fix for each, and the
   box as a run will show it. app.js redraws these parts as you type, never the box itself. Everything shown is escaped. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, M = PF.map, R = PF.run, X = PF.refs, I = PF.icons.icon, esc = U.esc;

  /* Where a box is: data-at "s:<n>" (the nth step, checklist order) or "g:<n>" (the nth phase's gate). */
  function placeOf(map, at) {
    var m = /^([sg]):(\d+)$/.exec(String(at || '')); if (!m) return null;
    if (m[1] === 'g') return +m[2] < map.phases.length ? X.atGate(map, +m[2]) : null;
    var x = M.steps(map)[+m[2]];
    return x ? X.atStep(map, x.step) : null;
  }
  function judge(map, value, at, caret) { var place = placeOf(map, at); return place ? X.judge(map, value, place, caret) : []; }

  /* The mirror: the box's text, escaped, with each reference wrapped. A trailing space keeps a last empty line's height. */
  function mirror(value, toks) {
    var out = '', last = 0;
    toks.forEach(function (t) { out += esc(value.slice(last, t.start)) + '<mark class="dbx-t v-' + t.verdict.v + '">' + esc(value.slice(t.start, t.end)) + '</mark>'; last = t.end; });
    return out + esc(value.slice(last)) + ' ';
  }

  /* What's wrong, one line per name, each with its fix. kind: step | field | approves (unknown in a field isn't wrong: a run
     shows it as written). */
  function issues(id, kind, value, toks) {
    var seen = Object.create(null), out = [];
    toks.forEach(function (t) {
      var v = t.verdict, key = t.name + '|' + v.v;
      if (seen[key] || (v.v !== 'unknown' && v.v !== 'maybe-unset')) return;
      seen[key] = true;
      var fix = '';
      if (v.v === 'unknown') {
        if (v.suggest) fix += '<button type="button" class="mini" data-act="dbx-fix" data-for="' + esc(id) + '" data-from="' + esc(t.name) + '" data-to="' + esc(v.suggest) + '">Use ^' + esc(v.suggest) + '</button>';
        fix += '<button type="button" class="mini" data-act="dbx-add" data-for="' + esc(id) + '" data-name="' + esc(t.name) + '">' + I('plus') + 'Add ^' + esc(t.name) + ' as a run detail</button>';
        out.push('<li class="dbx-i bad"><span>' + (kind === 'field' ? '^' + esc(t.name) + ' isn\'t a run detail, so a run shows it as written.' : '^' + esc(t.name) + ' isn\'t a run detail. Publishing waits until it is, or it\'s gone.') + (v.suggest ? ' Did you mean ^' + esc(v.suggest) + '?' : '') + '</span>' + fix + '</li>');
        return;
      }
      var s0 = v.setters[0];
      out.push('<li class="dbx-i late"><span>^' + esc(t.name) + ' may not be set yet here: “' + esc(s0.text) + '” sets it' + (s0.when.length ? ' only when ' + esc(s0.when.join(' and ')) : '') + '.</span>' +
        (s0.id ? '<button type="button" class="mini" data-act="dbx-show" data-id="' + esc(s0.id) + '">Show that step</button>' : '') + '</li>');
    });
    return out.join('');
  }

  /* Values for the preview: the latest run of this checklist, by name, where the draft still has that detail with the same
     kind; anything else shows as a run shows a detail with no value. */
  function values(ctx, map, pid) {
    var runs = ((ctx.data && ctx.data.runs) || []).filter(function (r) { return r.process === pid && !r.test && r.details; });
    runs.sort(function (a, b) { return String(b.created || '').localeCompare(String(a.created || '')); });
    var r = runs[0], rmap = null;
    if (r) { try { rmap = R.mapOf(r); } catch (e) { rmap = null; } }
    var kind = function (m, n) { var d = m && m.meta.detailTypes && Object.prototype.hasOwnProperty.call(m.meta.detailTypes, n) ? m.meta.detailTypes[n] : null; return d ? d.kind : 'text'; };
    var rv = r && rmap ? K.refValue(r, rmap) : null;
    var same = function (n) { return rv && rmap.meta.context.indexOf(n) >= 0 && map.meta.context.indexOf(n) >= 0 && kind(rmap, n) === kind(map, n); };
    var get = function (n) { return same(n) ? rv(n) : ''; };
    /* Fields and approves fill in the stored value, as the run screen does (fill reads r.details), not its display text. */
    var raw = function (n) { var v = same(n) && Object.prototype.hasOwnProperty.call(r.details, n) ? r.details[n] : ''; return v == null ? '' : String(v); };
    return { run: rv ? r : null, get: get, raw: raw };
  }
  /* The box as a run shows it: step text the run screen's way (values in text only, ‹name› when unset); a field or approves
     filled from raw text, then escaped. */
  function preview(kind, value, map, vals) {
    if (kind === 'step') {
      var parts = [], last = 0;
      X.tokens(value).forEach(function (t) { if (t.start > last) parts.push({ t: 'text', v: value.slice(last, t.start) }); parts.push({ t: 'ref', k: t.name }); last = t.end; });
      if (last < value.length) parts.push({ t: 'text', v: value.slice(last) });
      return K.stepHtml({ textParts: parts }, vals.get);
    }
    var d = {}; map.meta.context.forEach(function (n) { d[n] = (vals.raw || vals.get)(n); });
    return esc(R.fill(value, d, map.meta.context));
  }
  function previewLine(kind, value, map, vals) {
    if (!X.tokens(value).length) return '';
    var r = vals.run;
    return '<span class="dbx-pv-k">In a run' + (r ? ' <span class="small">(values from ' + esc(r.title || r.id) + ')</span>' : '') + ':</span> <span class="dbx-pv-v">' + preview(kind, value, map, vals) + '</span>';
  }

  /* The autocomplete's options for a typed name at a place: matches first by prefix, then containing; a name that may not be
     set here is listed last with that note; Add when nothing matches exactly. */
  function options(map, at, q) {
    var place = placeOf(map, at), src = X.sources(map), low = String(q || '').toLowerCase(), out = [];
    if (!place) return out;
    var types = map.meta.detailTypes || {};
    map.meta.context.forEach(function (n) {
      var l = n.toLowerCase(), rank = !low ? 1 : l.indexOf(low) === 0 ? 0 : l.indexOf(low) > 0 ? 1 : -1;
      if (rank < 0) return;
      var v = X.verdict(map, src, n, place), t = Object.prototype.hasOwnProperty.call(types, n) ? types[n] : null;
      out.push({ name: n, rank: rank + (v.v === 'maybe-unset' ? 2 : 0), kind: t ? PF.values.label({ kind: t.kind, options: t.options }) : 'text', from: X.where(src, n), late: v.v === 'maybe-unset' });
    });
    out.sort(function (a, b) { return a.rank - b.rank || map.meta.context.indexOf(a.name) - map.meta.context.indexOf(b.name); });
    if (low && map.meta.context.indexOf(q) < 0 && /^[\w-]+$/.test(q)) out.push({ name: q, add: true });
    return out.slice(0, 41);
  }
  function optionsHtml(id, opts, active) {
    return opts.map(function (o, i) {
      return '<li role="option" id="dbx-o-' + esc(id) + '-' + i + '" class="dbx-o' + (i === active ? ' on' : '') + (o.add ? ' add' : '') + '" aria-selected="' + (i === active) + '" data-act="dbx-pick" data-for="' + esc(id) + '" data-i="' + i + '">' +
        (o.add ? I('plus') + 'Add <b>^' + esc(o.name) + '</b> as a run detail' : '<b>^' + esc(o.name) + '</b> <span class="small">' + esc(o.kind) + ' · ' + esc(o.from) + (o.late ? ' · may not be set yet here' : '') + '</span>') + '</li>';
    }).join('');
  }

  var TIE = 'If a detail here changes during a run, this step is checked again.';
  /* The box. o: { id, kind (step | field | approves), tag (input | textarea), attrs (the control's own), value, label, g (guide
     entry), at, map, vals, describedBy (ids from the form) }. */
  function box(o) {
    var toks = judge(o.map, o.value, o.at), id = o.id, iss = issues(id, o.kind, o.value, toks), pv = previewLine(o.kind, o.value, o.map, o.vals);
    var desc = [o.describedBy, 'dbx-iss-' + id, 'dbx-pv-' + id].filter(Boolean).join(' ');
    var ctl = '<' + o.tag + ' id="' + esc(id) + '" class="dbx-in" spellcheck="false" autocomplete="off" aria-autocomplete="list" aria-controls="dbx-ac-' + esc(id) + '"' + (o.tag === 'input' ? ' role="combobox" aria-expanded="false" value="' + esc(o.value) + '"' : '') + o.attrs + ' aria-describedby="' + esc(desc) + '">' + (o.tag === 'textarea' ? esc(o.value) + '</textarea>' : '');
    return '<div class="field dbx-field"><label for="' + esc(id) + '">' + esc(o.label) + '</label>' +
      '<div class="dbx" data-dbx="' + esc(id) + '" data-kind="' + o.kind + '" data-at="' + esc(o.at) + '"><div class="dbx-mirror" aria-hidden="true">' + mirror(o.value, toks) + '</div>' + ctl +
      '<ul class="dbx-ac" id="dbx-ac-' + esc(id) + '" role="listbox" aria-label="Run details" hidden></ul></div>' +
      '<div class="dbx-tools"><button type="button" class="mini" data-act="dbx-insert" data-for="' + esc(id) + '">' + I('plus') + 'Insert a detail</button>' + (o.kind === 'step' ? '<span class="small">' + esc(TIE) + '</span>' : '') + '</div>' +
      '<ul class="dbx-iss" id="dbx-iss-' + esc(id) + '" aria-live="polite">' + iss + '</ul>' +
      '<p class="dbx-pv small" id="dbx-pv-' + esc(id) + '">' + pv + '</p>' + (o.after || '') + '</div>';
  }

  V.dbx = { box: box, mirror: mirror, issues: issues, preview: preview, previewLine: previewLine, options: options, optionsHtml: optionsHtml, values: values, judge: judge, placeOf: placeOf };
})();
