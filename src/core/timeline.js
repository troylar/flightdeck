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

  return { MAX: MAX, MAX_CHARS: MAX_CHARS, PAUSE: PAUSE, create: create, patch: patch, record: record, close: close, barrier: barrier, peek: peek, undo: undo, redo: redo,
    saved: saved, labelOf: labelOf, describe: describe, past: past, itemAt: itemAt };
})();
