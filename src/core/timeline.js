/* One editor's change history for this session: the draft editor (builder and Markdown share it) and the step-type form.
   Each entry is the smallest text patch between before and after (common prefix and suffix cut off), so Undo puts back
   exactly what changed and refuses when the text at that place is no longer what the entry wrote. A barrier marks where the
   text was replaced from outside (a newer draft, their version, a restore, a discard): entries before it stay listed but
   can't be undone, because applying them would bring older text back over the newer one. */
PF.timeline = (function () {
  'use strict';
  var MAX = 200, MAX_CHARS = 1048576, PAUSE = 1000;
  /* What an outline operation is called, and how a message says it was done ({s} is the step or phase). */
  var OPS = {
    move: ['move', 'Moved {s}'], phaseMove: ['phase move', 'Moved phase {s}'],
    text: ['wording change', 'Changed the wording of {s}'], mark: ['must-do change', 'Changed whether {s} is a must-do'], type: ['type change', 'Changed the type of {s}'],
    role: ['role change', 'Changed the roles of {s}'], bind: ['run detail change', 'Changed the run details of {s}'], field: ['field change', 'Changed a field of {s}'],
    add: ['new step', 'Added the step {s}'], 'delete': ['step deletion', 'Step deleted: {s}'], addPhase: ['new phase', 'Added the phase {s}'],
    phaseTitle: ['phase wording', 'Renamed the phase {s}'], phaseMode: ['phase mode change', 'Changed how {s} is worked'],
    gate: ['gate wording', 'Changed the gate of {s}'], gateOwner: ['gate owner change', 'Changed who owns the gate of {s}'],
    removeGate: ['gate removal', 'Removed the gate of {s}'], deletePhase: ['phase deletion', 'Deleted the phase {s}'],
    addTrack: ['new lane', 'Added the lane {s}'], trackTitle: ['lane wording', 'Renamed the lane {s}'], trackRole: ['lane role change', 'Changed who works the lane {s}'], deleteTrack: ['lane deletion', 'Deleted the lane {s}'],
    applyCorrection: ['applied correction', 'Applied correction to {s}']
  };
  var PREP = { typing: ' in ', paste: ' in ', cut: ' in ', drop: ' in ', correction: ' in ', indent: ' in ', 'new step': ' ', 'new phase': ' ', 'new lane': ' ', 'new field': ' ', 'new evidence': ' ', 'applied correction': ' to ' };

  function create() { return { entries: [], pos: 0, barrier: 0, chars: 0, marks: [], seq: 0 }; }
  function patch(a, b) {
    var n = Math.min(a.length, b.length), i = 0, j = 0;
    while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    while (j < n - i && a.charCodeAt(a.length - 1 - j) === b.charCodeAt(b.length - 1 - j)) j++;
    return { start: i, del: a.slice(i, a.length - j), ins: b.slice(i, b.length - j) };
  }
  function cls(p) { return p.ins && !p.del ? 'insert' : p.del && !p.ins ? 'delete' : 'replace'; }
  function size(e) { return e.del.length + e.ins.length; }
  /* The text before an entry, from the text right after it. */
  function unapply(text, e) { return text.slice(0, e.start) + e.del + text.slice(e.start + e.ins.length); }
  /* Typing joins the open unit only when it continues it: same control, same direction (typing on after replacing a
     selection counts), within a second, right where the caret was, and no new line. */
  function joins(last, p, at, meta) {
    if (!last || last.kind !== 'typing' || last.closed || at - last.t > PAUSE || p.ins.indexOf('\n') >= 0 || (meta.group || '') !== last.group) return false;
    var c = cls(p);
    if (c === 'insert') return (last.cls === 'insert' || last.cls === 'replace') && p.start === last.caret;
    if (c === 'delete') return last.cls === 'delete' && (p.start + p.del.length === last.caret || p.start === last.caret);
    return false;
  }
  /* For History: the whole lines a change touched, before and after, rather than the cut-off characters of the patch. */
  function linesOf(a, b, p) {
    var cut = function (t) { return t.length > 4000 ? t.slice(0, 4000) + '…' : t; };
    var span = function (t, n) { var s = t.lastIndexOf('\n', p.start - 1) + 1, e = t.indexOf('\n', p.start + n); return cut(t.slice(s, e < 0 ? t.length : e)); };
    return { before: span(a, p.del.length), after: span(b, p.ins.length) };
  }
  function drop(tl, from) {
    for (var i = from; i < tl.entries.length; i++) tl.chars -= size(tl.entries[i]);
    tl.entries.length = from;
    tl.marks = tl.marks.filter(function (m) { return m.at <= from; });
  }
  /* Past 200 entries or 1 MB of changed text, the oldest go; the newest always stays. */
  function trim(tl) {
    while (tl.entries.length > 1 && (tl.entries.length > MAX || tl.chars > MAX_CHARS)) {
      tl.chars -= size(tl.entries.shift());
      tl.pos = Math.max(0, tl.pos - 1); tl.barrier = Math.max(0, tl.barrier - 1);
      tl.marks.forEach(function (m) { m.at = Math.max(0, m.at - 1); });
    }
  }
  /* meta: kind ('op', 'typing', 'paste', 'cut', 'drop', 'correction', 'indent', 'form'), label, subject, items, group (the
     control typed in), selBefore, selAfter, at (ms), wait / join (a change that waits for its other half, and that half:
     'drag' for a drag-and-drop move), and for History either lines (show the whole lines changed) or show
     ({ before, after } in words). */
  function record(tl, before, after, meta) {
    before = String(before); after = String(after); meta = meta || {};
    if (before === after) return null;
    var p = patch(before, after), kind = meta.kind || 'op', at = meta.at != null ? meta.at : Date.now();
    var last = tl.pos > tl.barrier && tl.pos === tl.entries.length ? tl.entries[tl.pos - 1] : null;
    /* Moving text by dragging arrives as two changes (taken from one place, dropped at another); the drop joins the
       taking-out, so one Undo puts the text back where it was. */
    var dragged = meta.join && last && last.waits === meta.join && at - last.t <= PAUSE;
    if (dragged || (kind === 'typing' && joins(last, p, at, meta))) {
      if (dragged) delete last.waits;
      var orig = unapply(before, last), q = patch(orig, after);
      if (last.lines) last.show = linesOf(orig, after, q);
      tl.chars += q.del.length + q.ins.length - size(last);
      last.start = q.start; last.del = q.del; last.ins = q.ins; last.t = at;
      last.caret = cls(p) === 'delete' ? p.start : p.start + p.ins.length;
      if (meta.selAfter) last.selAfter = meta.selAfter;
      if (meta.show && last.show && !last.lines) last.show.after = meta.show.after;
      trim(tl);
      return last;
    }
    drop(tl, tl.pos);
    if (last) last.closed = true;
    var e = { id: ++tl.seq, kind: kind, label: meta.label || (kind === 'op' || kind === 'form' ? 'change' : kind), subject: meta.subject || '', start: p.start, del: p.del, ins: p.ins,
      cls: cls(p), caret: cls(p) === 'delete' ? p.start : p.start + p.ins.length, group: meta.group || '', items: (meta.items || []).slice(0, 50),
      selBefore: meta.selBefore || null, selAfter: meta.selAfter || null, lines: !!meta.lines, show: meta.lines ? linesOf(before, after, p) : meta.show ? { before: meta.show.before, after: meta.show.after } : null,
      at: at, t: at, closed: kind !== 'typing', savedAs: null };
    if (meta.wait) e.waits = meta.wait;
    tl.entries.push(e); tl.pos = tl.entries.length; tl.chars += size(e);
    trim(tl);
    return e;
  }
  /* Saving, a builder change, switching views and leaving the editor end the typing unit, so the next keystroke starts one. */
  function close(tl) { var l = tl && tl.entries[tl.pos - 1]; if (l) l.closed = true; }
  /* The text was replaced from outside: nothing before here can be undone, and what was undone can't be redone. */
  function barrier(tl, why) {
    drop(tl, tl.pos);
    if (tl.pos > tl.barrier) tl.marks.push({ at: tl.pos, why: why || '' });
    else if (tl.marks.length && tl.marks[tl.marks.length - 1].at === tl.pos && why) tl.marks[tl.marks.length - 1].why = why;
    tl.barrier = tl.pos; close(tl);
  }
  function peek(tl) {
    return { undo: tl && tl.pos > tl.barrier ? tl.entries[tl.pos - 1] : null, redo: tl && tl.pos < tl.entries.length ? tl.entries[tl.pos] : null, locked: !!tl && tl.pos > 0 && tl.pos <= tl.barrier };
  }
  /* Returns { text, sel, caret, entry } or { error }. sel is what was selected before (undo) or after (redo) the change;
     caret is where the changed text now is. */
  function undo(tl, text) {
    var k = peek(tl);
    if (!k.undo) return { error: k.locked ? 'Earlier changes can\'t be undone: the text was replaced since.' : 'Nothing to undo yet.', none: true };
    var e = k.undo;
    if (String(text).substr(e.start, e.ins.length) !== e.ins) return { error: 'It changed since; nothing undone.' };
    tl.pos--; e.closed = true;
    return { text: unapply(text, e), sel: e.selBefore, caret: { start: e.start, end: e.start + e.del.length }, entry: e };
  }
  function redo(tl, text) {
    var e = peek(tl).redo;
    if (!e) return { error: 'Nothing to redo.', none: true };
    if (String(text).substr(e.start, e.del.length) !== e.del) return { error: 'It changed since; nothing redone.' };
    tl.pos++;
    return { text: text.slice(0, e.start) + e.ins + text.slice(e.start + e.del.length), sel: e.selAfter, caret: { start: e.start + e.ins.length, end: e.start + e.ins.length }, entry: e };
  }
  /* Entries included in a save are stamped with the saved file's fingerprint. */
  function saved(entries, hash) { entries.forEach(function (e) { if (!e.savedAs) e.savedAs = hash; }); }

  /* What an outline operation is called. */
  function labelOf(op) {
    var o = op && op.op, s = (op && op.set) || {}, k;
    if (o === 'move' || o === 'moveTo') k = 'move';
    else if (o === 'movePhase') k = 'phaseMove';
    else if (o === 'edit') k = 'text' in s ? 'text' : 'mark' in s ? 'mark' : 'type' in s ? 'type' : 'role' in s ? 'role' : 'bind' in s ? 'bind' : 'field';
    else if (o === 'editPhase') k = 'title' in s ? 'phaseTitle' : 'phaseMode';
    else if (o === 'gate') k = 'owner' in s && !('title' in s) && !('approves' in s) ? 'gateOwner' : 'gate';
    else if (o === 'editTrack') k = 'title' in s ? 'trackTitle' : 'trackRole';
    else k = OPS[o] ? o : null;
    var x = k ? OPS[k] : ['change', 'Changed {s}'];
    return { label: x[0], past: x[1] };
  }
  function quoted(s) { return s ? '"' + s + '"' : ''; }
  /* "the move of "Smoke tests"", "the typing in "Label"", "the new step "Check the dashboards"". */
  function describe(e) { return 'the ' + e.label + (e.subject ? (PREP[e.label] || PREP[e.kind] || ' of ') + quoted(e.subject) : ''); }
  function past(tpl, subject) { return tpl.replace('{s}', subject ? quoted(subject) : 'it').replace(/\s+$/, ''); }
  /* The step or phase a place in the Markdown belongs to, for naming typing there. */
  function itemAt(text, at) {
    var o = PF.outline.parse(text), line = String(text).slice(0, at).split('\n').length - 1, hit = null;
    o.steps.forEach(function (s) { if (line >= s.line && line < s.end) hit = { item: 'step:' + s.key, subject: s.text.replace(/\*\*|__|`/g, '') }; });
    if (!hit) o.phases.forEach(function (p) { if (line === p.line || (p.gate && line >= p.gate.line && line < p.gate.end)) hit = { item: 'phase:' + p.key, subject: p.title }; });
    return hit;
  }

  /* ---------- Saved history (slice 2): one file per writer under history/, never read by the draft or step-type loaders ----------
     history/drafts/<process>/<writer>.jsonl and history/step-types/<id>/<writer>.jsonl get one line after each successful
     checked save. Lines are ordered by the fingerprints they link (from → to), never by clocks: `at` is for display only. */
  var HIST = { LINE: 81920, HUNKS: 65536, ROLL: 524288, READ: 2000, FILES: 8, UNITS: 20, ITEMS: 50, CONTEXT: 3 };
  var SOURCES = ['editor', 'restore', 'reverse', 'keep-mine', 'new', 'correction'];
  function bytes(s) {
    var n = 0; s = String(s);
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3; }
    return n;
  }
  function count(list, block) {
    var n = 0, at = -1;
    if (!block.length) return { n: 0, at: -1 };
    for (var i = 0; i + block.length <= list.length; i++) {
      var k = 0; while (k < block.length && list[i + k] === block[k]) k++;
      if (k === block.length) { n++; at = i; }
    }
    return { n: n, at: at };
  }
  /* The lines a save changed, as hunks { at (line in the text before), del, ins }, from PF.publish.diff. A hunk whose inserted
     lines are empty or appear more than once in the text after takes up to 3 unchanged lines around it, so Reverse can find
     it again exactly. */
  function hunks(a, b) {
    var x = String(a).split('\n'), y = String(b).split('\n'), n = x.length, m = y.length, head = 0, tail = 0;
    while (head < n && head < m && x[head] === y[head]) head++;
    while (tail < n - head && tail < m - head && x[n - 1 - tail] === y[m - 1 - tail]) tail++;
    var mx = x.slice(head, n - tail), my = y.slice(head, m - tail), ops;
    if (!mx.length && !my.length) return [];
    if (!mx.length || !my.length || mx.length * my.length > 4000000) ops = mx.map(function (t) { return { op: '-', text: t }; }).concat(my.map(function (t) { return { op: '+', text: t }; }));
    else ops = PF.publish.diff(mx.join('\n'), my.join('\n'));
    var out = [], i = head, j = head, cur = null;
    ops.forEach(function (o) {
      if (o.op === ' ') { if (cur) { out.push(cur); cur = null; } i++; j++; return; }
      if (!cur) cur = { at: i, yAt: j, del: [], ins: [] };
      if (o.op === '-') { cur.del.push(o.text); i++; } else { cur.ins.push(o.text); j++; }
    });
    if (cur) out.push(cur);
    out.forEach(function (h, k) {
      var lo = k ? out[k - 1].yAt + out[k - 1].ins.length : 0, hi = k + 1 < out.length ? out[k + 1].yAt : m, pre = 0, post = 0;
      while ((!h.ins.length || count(y, h.ins).n !== 1) && (pre < HIST.CONTEXT || post < HIST.CONTEXT)) {
        if (pre < HIST.CONTEXT && h.yAt > lo) { h.yAt--; h.at--; h.del.unshift(y[h.yAt]); h.ins.unshift(y[h.yAt]); pre++; }
        else if (post < HIST.CONTEXT && h.yAt + h.ins.length < hi) { var t = y[h.yAt + h.ins.length]; h.del.push(t); h.ins.push(t); post++; }
        else break;
      }
    });
    return out.map(function (h) { return { at: h.at, del: h.del, ins: h.ins }; });
  }
  /* Reverse a saved change in the text as it is now: each hunk's inserted lines must be found exactly once, without overlap.
     Returns the new text, or null when the text changed since. */
  function reverse(text, hs) {
    if (!Array.isArray(hs) || !hs.length) return null;
    var y = String(text).split('\n'), spots = [];
    for (var i = 0; i < hs.length; i++) {
      var c = count(y, hs[i].ins);
      if (c.n !== 1) return null;
      spots.push({ at: c.at, h: hs[i] });
    }
    spots.sort(function (p, q) { return p.at - q.at; });
    for (i = 1; i < spots.length; i++) if (spots[i - 1].at + spots[i - 1].h.ins.length > spots[i].at) return null;
    for (i = spots.length - 1; i >= 0; i--) Array.prototype.splice.apply(y, [spots[i].at, spots[i].h.ins.length].concat(spots[i].h.del));
    return y.join('\n');
  }
  /* A step type's definition as a few readable rows, keyed by what they describe, for field-level before and after. */
  function rowText(r) {
    if (!r || typeof r !== 'object') return '';
    var t = String(r.label || r.name || '') + (r.name ? ' (' + r.name + ')' : '') + ' · ' + String(r.kind || 'text');
    if (Array.isArray(r.options) && r.options.length) t += ' · options: ' + r.options.join(', ');
    if (r.required) t += ' · usually filled in';
    if (r.long) t += ' · long text';
    return t;
  }
  var TYPE_KEYS = [['label', 'Label'], ['id', 'ID'], ['hint', 'What it\'s for'], ['icon', 'Icon'], ['group', 'Group'], ['tags', 'Tags']];
  function typeRows(d) {
    var out = {}, val = function (v) { return Array.isArray(v) ? v.join(' / ') : v == null ? '' : String(v); };
    if (!d || typeof d !== 'object') return out;
    TYPE_KEYS.forEach(function (k) { if (d[k[0]] != null && d[k[0]] !== '') out['type:' + k[0]] = { label: k[1], text: k[0] === 'tags' && Array.isArray(d.tags) ? d.tags.join(', ') : val(d[k[0]]) }; });
    var f = d.fields && typeof d.fields === 'object' ? d.fields : {};
    if (Array.isArray(f)) f.forEach(function (r) { if (r && r.name) out['field:' + r.name] = { label: 'Field "' + (r.label || r.name) + '"', text: rowText(r) }; });
    else Object.keys(f).forEach(function (n) { var r = f[n] || {}; out['field:' + n] = { label: 'Field "' + (r.label || n) + '"', text: rowText({ name: n, label: r.label, kind: r.kind, options: r.options, required: r.required }) }; });
    (Array.isArray(d.record) ? d.record : []).forEach(function (r) { if (r && r.name) out['evidence:' + r.name] = { label: 'Evidence "' + (r.label || r.name) + '"', text: rowText(r) }; });
    return out;
  }
  /* What changed between two definitions: [{ item, label, before, after }], in the order the form shows them. */
  function typeChanges(a, b) {
    var x = typeRows(a), y = typeRows(b), keys = Object.keys(x), out = [];
    Object.keys(y).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    var rank = function (k) { return /^type:/.test(k) ? 0 : /^field:/.test(k) ? 1 : 2; };
    keys.sort(function (p, q) { return rank(p) - rank(q); });
    keys.forEach(function (k) {
      var p = x[k] ? x[k].text : '', q = y[k] ? y[k].text : '';
      if (p !== q) out.push({ item: k, label: (y[k] || x[k]).label, before: p, after: q });
    });
    if (a && b && !out.length && JSON.stringify(a) !== JSON.stringify(b)) out.push({ item: 'type:order', label: 'Order', before: '', after: '' });
    return out;
  }
  /* One line of saved history (o: kind, id, process or type, writer, seq, by, at, from, to, seen, source, version, units, items,
     and before/after: the draft's text, or the type's definition). Hunks over 64 KB keep only the fingerprints (big: true);
     a line never passes 80 KB. */
  function histLine(o) {
    var draft = o.kind === 'draft-edit', e = { v: 1, kind: draft ? 'draft-edit' : 'type-edit', id: String(o.id) };
    if (draft) e.process = String(o.process); else e.type = String(o.type);
    e.writer = String(o.writer); e.seq = +o.seq || 0; e.by = String(o.by || '').slice(0, 80); e.at = String(o.at || '').slice(0, 40);
    e.from = o.from || null; e.to = String(o.to); e.seen = o.seen || null; e.source = SOURCES.indexOf(o.source) >= 0 ? o.source : 'editor';
    if (o.version) e.version = +o.version;
    var items = (o.items || []).slice();
    if (!draft) typeChanges(o.before, o.after).forEach(function (c) { if (items.indexOf(c.item) < 0) items.push(c.item); });
    e.units = (o.units || []).slice(0, HIST.UNITS).map(function (u) { return String(u).slice(0, 200); });
    e.items = items.filter(function (x, i) { return items.indexOf(x) === i; }).slice(0, HIST.ITEMS).map(function (x) { return String(x).slice(0, 120); });
    if (draft) {
      if (o.before != null) { var hs = hunks(o.before, o.after); if (bytes(JSON.stringify(hs)) <= HIST.HUNKS) e.hunks = hs; else e.big = true; }
    } else if (bytes(JSON.stringify([o.before || null, o.after || null])) <= HIST.HUNKS) { e.before = o.before || null; e.after = o.after || null; }
    else e.big = true;
    if (bytes(JSON.stringify(e)) > HIST.LINE) { delete e.hunks; delete e.before; delete e.after; e.big = true; }
    return e;
  }
  /* A value from a line, as plain data: no prototype, no __proto__ or constructor keys, depth and sizes capped. */
  function plain(v, depth) {
    if (typeof v === 'string') return v.slice(0, 4000);
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof v === 'boolean' || v == null) return v == null ? null : v;
    if (depth > 5 || typeof v !== 'object') return null;
    if (Array.isArray(v)) return v.slice(0, 200).map(function (x) { return plain(x, depth + 1); });
    var o = Object.create(null);
    Object.keys(v).slice(0, 200).forEach(function (k) { if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') o[k] = plain(v[k], depth + 1); });
    return o;
  }
  var HASH = /^[0-9a-f]{8}$/, ID = /^[\w-]{1,60}$/;
  function strs(a, n, len) { return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }).slice(0, n).map(function (x) { return x.slice(0, len); }) : []; }
  /* A line read from the folder, checked: the right types and lengths, or null. file is the file it came from (for order). */
  function cleanEntry(o, file) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return null;
    if (o.kind !== 'draft-edit' && o.kind !== 'type-edit') return null;
    if (typeof o.id !== 'string' || !ID.test(o.id) || typeof o.writer !== 'string' || !ID.test(o.writer) || typeof o.to !== 'string' || !HASH.test(o.to)) return null;
    if (o.from != null && (typeof o.from !== 'string' || !HASH.test(o.from))) return null;
    var e = Object.create(null), draft = o.kind === 'draft-edit';
    e.v = 1; e.kind = o.kind; e.id = o.id;
    if (draft) { if (typeof o.process !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(o.process)) return null; e.process = o.process; }
    else { if (typeof o.type !== 'string' || !/^[\w.-]{1,60}$/.test(o.type)) return null; e.type = o.type; }
    e.writer = o.writer; e.seq = typeof o.seq === 'number' && isFinite(o.seq) && o.seq >= 0 ? Math.floor(o.seq) : 0;
    e.by = typeof o.by === 'string' ? o.by.slice(0, 80) : ''; e.at = typeof o.at === 'string' ? o.at.slice(0, 40) : '';
    e.from = o.from || null; e.to = o.to; e.seen = typeof o.seen === 'string' && ID.test(o.seen) ? o.seen : null;
    e.source = SOURCES.indexOf(o.source) >= 0 ? o.source : '';
    if (typeof o.version === 'number' && isFinite(o.version) && o.version >= 1 && o.version < 1e6) e.version = Math.floor(o.version);
    e.units = strs(o.units, HIST.UNITS, 200); e.items = strs(o.items, HIST.ITEMS, 120); e.big = o.big === true;
    if (draft && Array.isArray(o.hunks)) {
      e.hunks = o.hunks.slice(0, 2000).filter(function (h) { return h && typeof h === 'object' && typeof h.at === 'number' && isFinite(h.at) && h.at >= 0 && Array.isArray(h.del) && Array.isArray(h.ins); })
        .map(function (h) { var x = Object.create(null); x.at = Math.floor(h.at); x.del = strs(h.del, 5000, 4000); x.ins = strs(h.ins, 5000, 4000); return x; });
      if (e.hunks.length !== Math.min(o.hunks.length, 2000)) delete e.hunks;
    }
    if (!draft) { e.before = o.before && typeof o.before === 'object' ? plain(o.before, 0) : null; e.after = o.after && typeof o.after === 'object' ? plain(o.after, 0) : null; }
    e.file = typeof file === 'string' ? file.slice(0, 200) : '';
    return e;
  }
  /* The order of saved history, newest first: from the file's current fingerprint, walk back through entries whose `to` is it
     (of several, the latest in causal order). Where nothing leads on, it was changed outside Flightdeck. Entries off that chain
     follow in causal order: after the entry they saw (seen), then by writer and seq, ties by file name. Never by clocks.
     Returns [{ entry } | { gap: true }]. */
  function order(list, current) {
    var all = [], have = Object.create(null);
    (list || []).forEach(function (e) { var k = e && e.writer + '\n' + e.id; if (e && !have[k]) { have[k] = true; all.push(e); } });
    var key = function (e) { return (e.file || '') + '\n' + ('000000000000' + e.seq).slice(-12) + '\n' + e.writer + '\n' + e.id; };
    all.sort(function (a, b) { return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0; });
    var byId = Object.create(null), prev = [], last = Object.create(null);
    all.forEach(function (e) { (byId[e.id] = byId[e.id] || []).push(e); });
    /* Within one writer, lines follow their seq (all is sorted by file, then seq; a writer's files sort -2 after the first). */
    var byWriter = all.slice().sort(function (a, b) { return a.writer < b.writer ? -1 : a.writer > b.writer ? 1 : a.seq - b.seq || (key(a) < key(b) ? -1 : 1); });
    var placed = [], done = Object.create(null), n = all.length, idx = Object.create(null);
    all.forEach(function (e, i) { idx[e.writer + '\n' + e.id] = i; });
    byWriter.forEach(function (e) { prev[idx[e.writer + '\n' + e.id]] = last[e.writer] || null; last[e.writer] = e; });
    var ready = function (e, i) {
      if (prev[i] && !done[idx[prev[i].writer + '\n' + prev[i].id]]) return false;
      return !(e.seen && byId[e.seen] && byId[e.seen].some(function (s) { return s !== e && !done[idx[s.writer + '\n' + s.id]]; }));
    };
    while (placed.length < n) {
      var pick = -1;
      for (var i = 0; i < n; i++) if (!done[i] && ready(all[i], i)) { pick = i; break; }
      if (pick < 0) for (i = 0; i < n; i++) if (!done[i]) { pick = i; break; }
      done[pick] = true; placed.push(all[pick]);
    }
    var rank = Object.create(null);
    placed.forEach(function (e, i) { rank[e.writer + '\n' + e.id] = i; });
    var used = Object.create(null), chain = [], h = current || null;
    while (h) {
      var best = null;
      for (i = 0; i < n; i++) { var c = all[i], ck = c.writer + '\n' + c.id; if (!used[ck] && c.to === h && (!best || rank[ck] > rank[best.writer + '\n' + best.id])) best = c; }
      if (!best) break;
      used[best.writer + '\n' + best.id] = true; chain.push(best); h = best.from;
    }
    var rest = placed.filter(function (e) { return !used[e.writer + '\n' + e.id]; }).reverse(), out = [], want = current || null;
    chain.concat(rest).forEach(function (e) {
      if (e.to !== want) out.push({ gap: true });
      out.push({ entry: e }); want = e.from;
    });
    return out;
  }
  /* Publications go where the draft's fingerprint was the one they published: above the newest entry that saved it, each
     version below the one after it. pubs: [{ version, hash, by, at }]. */
  function placePublications(items, pubs) {
    var out = items.slice(), floor = 0;
    (pubs || []).slice().sort(function (a, b) { return b.version - a.version; }).forEach(function (p) {
      for (var i = floor; i < out.length; i++) if (out[i].entry && out[i].entry.to === p.hash) { out.splice(i, 0, { pub: p }); floor = i + 1; return; }
    });
    return out;
  }
  /* The file a writer appends to: <writer>.jsonl, then <writer>-2.jsonl and on, each started when the last passes 512 KB. */
  function histFile(writer, n) { return writer + (n > 1 ? '-' + n : '') + '.jsonl'; }
  function rolls(size, add) { return size > 0 && size + add > HIST.ROLL; }

  return { MAX: MAX, MAX_CHARS: MAX_CHARS, PAUSE: PAUSE, create: create, patch: patch, record: record, close: close, barrier: barrier, peek: peek, undo: undo, redo: redo,
    saved: saved, labelOf: labelOf, describe: describe, past: past, itemAt: itemAt,
    HIST: HIST, SOURCES: SOURCES, bytes: bytes, hunks: hunks, reverse: reverse, typeChanges: typeChanges, histLine: histLine, cleanEntry: cleanEntry, order: order,
    placePublications: placePublications, histFile: histFile, rolls: rolls };
})();
