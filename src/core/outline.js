/* The outline builder's model of a draft: the same Markdown the checklist parser reads (map.js), with the lines each phase,
   step and gate came from. Every edit rewrites only the lines it touches and returns the new text; step IDs never change,
   and lines it doesn't model (comments, unusual formatting, notes) are kept exactly. After each edit the result is parsed
   again and compared with the original, and an edit that would change the meaning of anything else is refused. */
PF.outline = (function () {
  'use strict';
  var U = PF.util, M = PF.map;

  var ID_RE = /\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/i, ANY_ID = /\{#([a-z0-9][a-z0-9-]*)\}\s*$/i;
  var STEP_RE = /^- \[( |!|~)\]\s+(.+)$/, TYPE_RE = /^\{([a-z][\w.-]*)\}\s+(.*)$/i;
  var MODES = ['READ-DO', 'DO-CONFIRM'];
  var ERR = {
    gone: 'That isn\'t in the draft anymore. It may have just changed.',
    odd: 'This part of the draft has lines the builder can\'t change safely. Edit it in Markdown.',
    meaning: 'That change would also change what other lines mean, so it wasn\'t made. Edit it in Markdown.',
    first: 'It\'s already first.', last: 'It\'s already last.'
  };

  function bare(l) { return l.charAt(l.length - 1) === '\r' ? l.slice(0, -1) : l; }
  function blank(l) { return !bare(l).trim(); }
  function takeId(s) { var m = ID_RE.exec(s); return m ? { id: m[1].toLowerCase(), rest: s.slice(0, m.index), suffix: s.slice(m.index) } : { id: '', rest: s, suffix: '' }; }
  function tokens(s, ch) {
    var out = [];
    var rest = s.replace(new RegExp('\\s*\\' + ch + '([\\w-]+)', 'g'), function (_, n) { out.push(n); return ''; });
    return { list: out, rest: rest.trim() };
  }
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* A step's first line in pieces, so one piece can change and the rest stays byte for byte. */
  function stepParts(line) {
    var m = STEP_RE.exec(line), body = m[2], pre = line.slice(0, line.length - body.length);
    var head = takeId(body), core = head.rest, typePart = '', type = '', rest = core;
    var tm = TYPE_RE.exec(core);
    if (tm) { type = tm[1]; rest = tm[2]; typePart = core.slice(0, core.length - rest.length); }
    var roles = tokens(rest, '@'), binds = tokens(roles.rest, '^');
    return { pre: pre, mark: m[1], typePart: typePart, type: type, rest: rest, text: binds.rest, roles: roles.list, binds: binds.list, id: head.id, idSuffix: head.suffix };
  }

  /* Read the draft as map.js does, branch for branch, noting each part's lines. A block is a first line plus the indented
     lines right under it (blank lines between them included); an indented line that map.js gives to a step or gate further
     up, past another line, marks that step or gate as odd, and the builder won't move or change it. */
  function parse(text) {
    var src = String(text == null ? '' : text);
    var o = { lines: src.split('\n'), cr: /\r\n/.test(src) ? '\r' : '', front: null, phases: [], steps: [], questions: -1, unsupported: '', ids: {} };
    if (/\r(?!\n)/.test(src)) o.unsupported = 'it uses old Mac line endings.';
    var L = o.lines.map(bare), n = L.length, i = 0, m;
    if (L[0] && L[0].trim() === '---') {
      for (i = 1; i < n && L[i].trim() !== '---'; i++) { /* to the closing line */ }
      o.front = { start: 0, end: Math.min(i + 1, n) };
      i++;
    }
    var phase = null, step = null, gate = null, track = null, questions = false, blk = null;
    function own(b, at) { if (b === blk) b.end = at + 1; else b.odd = true; }
    for (; i < n; i++) {
      var line = L[i];
      if (!line.trim()) continue;
      var ind = /^\s/.test(line);
      if (!ind) blk = null;
      if ((m = /^###\s+Track:\s*(.+?)\s*$/i.exec(line))) {
        step = null;
        if (!phase || gate) continue;
        var th = takeId(m[1]), tr = tokens(th.rest, '@');
        track = { id: th.id, title: tr.rest, roles: tr.list, line: i, index: phase.tracks.length };
        phase.tracks.push(track);
        continue;
      }
      if ((m = /^##\s+(.+?)\s*$/.exec(line))) {
        step = null; gate = null; track = null;
        var head = takeId(m[1]);
        if (/^questions\b/i.test(head.rest)) { questions = true; phase = null; if (o.questions < 0) o.questions = i; continue; }
        var g = /^Gate:\s*(.+)$/i.exec(head.rest);
        if (g) {
          if (!phase || phase.gate) continue;
          var parts = g[1].split(/\s+·\s+/), owner = '', extra = false;
          parts.slice(1).forEach(function (p) { var ow = /^owner\s+@([\w-]+)$/i.exec(p.trim()); if (ow) owner = ow[1]; else extra = true; });
          gate = { id: head.id, idSuffix: head.suffix, title: parts[0].trim(), owner: owner, approves: '', approvesLine: -1, line: i, end: i + 1, odd: extra, phase: phase };
          phase.gate = gate; blk = gate;
          continue;
        }
        var pm = /^(.*?)\s+·\s+(READ-DO|DO-CONFIRM)$/.exec(head.rest);
        phase = { id: head.id, idSuffix: head.suffix, title: (pm ? pm[1] : head.rest).trim(), mode: pm ? pm[2] : '', line: i, steps: [], tracks: [], gate: null, index: o.phases.length };
        o.phases.push(phase);
        continue;
      }
      if (questions) continue;
      if (STEP_RE.test(line)) {
        if (!phase || gate) continue;
        var sp = stepParts(line);
        step = { id: sp.id, type: sp.type, text: sp.text, must: sp.mark === '!', planned: sp.mark === '~', roles: sp.roles, binds: sp.binds, parts: sp,
          fields: {}, fieldLines: {}, notes: 0, line: i, end: i + 1, odd: false, phase: phase, track: track ? track.index : -1, index: o.steps.length };
        phase.steps.push(step); o.steps.push(step); blk = step;
        continue;
      }
      if (/^\s{2,}>\s?(.*)$/.test(line)) {
        var tg = step || gate;
        if (tg) { own(tg, i); tg.notes = (tg.notes || 0) + 1; continue; }
      } else if (step && /^\s{2,}!\[(.*?)\]\(([^)\s]+)\)\s*$/.test(line)) { own(step, i); continue; }
      else if ((m = /^\s{2,}([\w-]+):\s*(.*)$/.exec(line))) {
        if (gate && m[1] === 'approves') { own(gate, i); gate.approves = m[2].trim(); gate.approvesLine = i; continue; }
        if (gate && (m[1] === 'at' || m[1] === 'due' || m[1] === 'after')) { own(gate, i); continue; }
        if (step) { own(step, i); step.fields[m[1]] = m[2].trim(); step.fieldLines[m[1]] = i; continue; }
      }
      /* A line map.js doesn't understand stays where it is, and moves with the block it's indented under. */
      if (ind && blk) blk.end = i + 1;
    }
    /* Each phase's region runs to the next phase (or a Questions section); its content ends at its last non-blank line. */
    o.phases.forEach(function (p, k) {
      var next = k + 1 < o.phases.length ? o.phases[k + 1].line : n;
      if (o.questions > p.line && o.questions < next) next = o.questions;
      var e = next; while (e > p.line + 1 && blank(o.lines[e - 1])) e--;
      p.regionEnd = next; p.contentEnd = e;
    });
    var count = {};
    L.forEach(function (l) { var x = ANY_ID.exec(l); if (x) { var id = x[1].toLowerCase(); o.ids[id] = true; } });
    o.phases.forEach(function (p) { if (p.id) o.ids[p.id + '-confirm'] = true; });
    o.steps.forEach(function (s) { if (s.id) count[s.id] = (count[s.id] || 0) + 1; });
    o.steps.forEach(function (s) { s.key = s.id && count[s.id] === 1 ? s.id : '#' + s.index; });
    var pc = {};
    o.phases.forEach(function (p) { if (p.id) pc[p.id] = (pc[p.id] || 0) + 1; });
    o.phases.forEach(function (p) { p.key = p.id && pc[p.id] === 1 ? p.id : '#' + p.index; });
    /* The safety net: if this reading and map.js ever disagree on the steps, the builder doesn't edit at all. */
    if (!o.unsupported && M.steps(M.parse(src)).length !== o.steps.length) o.unsupported = 'Flightdeck reads its steps in two different ways.';
    return o;
  }

  function stepBy(o, key) { return o.steps.filter(function (s) { return s.key === String(key); })[0] || null; }
  function phaseBy(o, key) { return o.phases.filter(function (p) { return p.key === String(key); })[0] || null; }
  function keyAt(text, line, kind) { var s = parse(text)[kind === 'phase' ? 'phases' : 'steps'].filter(function (x) { return x.line === line; })[0]; return s ? s.key : null; }
  /* Where a selected step or phase is after an operation (op, and the line its result gives as at). A key without a unique
     ID is a position ("#3"), which shifts when steps or phases are added, moved or deleted. Null when it's gone. */
  function follow(oldText, newText, op, at, kind, key) {
    var a = parse(oldText), b = parse(newText), ph = kind === 'phase', A = ph ? a.phases : a.steps, B = ph ? b.phases : b.steps;
    var by = function (L, k) { for (var x = 0; x < L.length; x++) if (L[x].key === String(k)) return x; return -1; };
    var i = by(A, key), from = -1, to = -1, o = op.op; if (i < 0) return null;
    if (!ph && o === 'movePhase') {
      /* Two phases swap places, and their steps with them. */
      var pi = by(a.phases, op.phase), pj = pi + (op.dir === 'up' || op.dir < 0 ? -1 : 1);
      if (pi < 0 || pj < 0 || pj >= a.phases.length) return B[i] ? B[i].key : null;
      var x = a.phases[Math.min(pi, pj)], y = a.phases[Math.max(pi, pj)], s = A[i];
      i += s.phase === x ? y.steps.length : s.phase === y ? -x.steps.length : 0;
      return B[i] ? B[i].key : null;
    }
    if (ph ? o === 'movePhase' || o === 'addPhase' : o === 'move' || o === 'moveTo' || o === 'add' || o === 'delete') {
      if (o !== 'add' && o !== 'addPhase') from = by(A, ph ? op.phase : op.step);
      if (o !== 'delete') for (var k = 0; k < B.length; k++) if (B[k].line === at) to = k;
    }
    if (i === from) return to >= 0 ? B[to].key : null;
    /* Everything else keeps its order: take out the one that left, put in the one that arrived. */
    var r = i - (from >= 0 && from < i ? 1 : 0), j = r + (to >= 0 && to <= r ? 1 : 0);
    return B[j] ? B[j].key : null;
  }

  /* A new ID from the text, unique in the whole file (automatic gate IDs included). A phase's ID also gives its automatic
     gate one (<id>-confirm), so that one must be free too. */
  function newId(o, text, fallback, phase) {
    var base = U.slug(text, 24).replace(/-+$/, '');
    if (!base || base === 'x' || !/^[a-z0-9]/.test(base)) base = fallback;
    var id = base, k = 2;
    while (o.ids[id] || (phase && o.ids[id + '-confirm'])) id = base + '-' + (k++);
    return id;
  }

  /* ---------- the safety net: what the parser reads, before and after ---------- */
  /* Where each phase and step came from rides along unenumerated, so the comparison skips it and compares every other key,
     a field named "_hint" included. */
  function lined(x, line) { return Object.defineProperty(x, '_line', { value: line }); }
  function sigOf(text) {
    var map = M.parse(text);
    return {
      meta: map.meta, questions: map.questions, errors: map.errors.map(function (e) { return e.msg; }).sort(),
      phases: map.phases.map(function (p) {
        var g = p.gate;
        return lined({ id: p.id, title: p.title, mode: p.mode,
          gate: { id: g.id, title: g.title, owner: g.owner, approves: g.approves, binds: g.binds, note: g.note, fields: g.fields, implicit: g.implicit },
          tracks: p.tracks.map(function (t) { return [t.id, t.title, t.roles]; }),
          steps: p.steps.map(function (s) { return lined({ id: s.id, type: s.type, text: s.text, must: s.must, planned: s.planned, roles: s.roles, binds: s.binds, fields: s.fields, note: s.note, shots: s.shots, track: s.track }, s.line); }) }, p.line);
      })
    };
  }
  function json(x) { return JSON.stringify(x); }
  /* Take a step out of a signature by its line (1-based, as map.js counts), and say where it was. */
  function pull(sig, line) {
    for (var pi = 0; pi < sig.phases.length; pi++) {
      var ss = sig.phases[pi].steps;
      for (var si = 0; si < ss.length; si++) if (ss[si]._line === line) return { phase: pi, step: ss.splice(si, 1)[0] };
    }
    return null;
  }
  /* No new problem may appear: every error after the edit was already there before it. */
  function noNewErrors(a, b) {
    var left = a.errors.slice();
    return b.errors.every(function (e) { var k = left.indexOf(e); if (k < 0) return false; left.splice(k, 1); return true; });
  }
  /* Compare everything except what the edit is allowed to change; adjust(a, b) makes that change on the "before" side or
     takes the changed part out of both, and returns false if the changed part itself isn't what was asked for. */
  function checked(oldText, newText, adjust) {
    var a = sigOf(oldText), b = sigOf(newText);
    if (!noNewErrors(a, b)) return false;
    a.errors = b.errors = null;
    if (adjust(a, b) === false) return false;
    return json(a) === json(b);
  }
  function done(o, oldText, lines, adjust, at) {
    var text = lines.join('\n');
    if (text === oldText) return { text: text, at: at, same: true };
    if (!checked(oldText, text, adjust)) return { error: ERR.meaning };
    return { text: text, at: at };
  }
  function crOf(o, i) { var l = o.lines[i]; return l != null && l.charAt(l.length - 1) === '\r' ? '\r' : o.cr; }
  function guard(text) { var o = parse(text); return o.unsupported ? { o: o, error: 'The builder can\'t edit this draft safely: ' + o.unsupported + ' Edit it in Markdown.' } : { o: o }; }
  function oneLine(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  /* A field's value is read as the rest of its line, trimmed: spaces inside it (a command's arguments) are its content. */
  function lineValue(v) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim(); }

  /* ---------- steps ---------- */
  /* Where a step lands: before or after another step, or at the start or end of a phase's group of steps (track -1 is the
     steps before any track). */
  function anchorOf(o, to) {
    if (to.before != null || to.after != null) {
      var t = stepBy(o, to.before != null ? to.before : to.after);
      return t ? { at: to.before != null ? t.line : t.end, phase: t.phase, track: t.track } : null;
    }
    var ph = phaseBy(o, to.phase); if (!ph) return null;
    var tr = to.track == null || to.track === '' ? -1 : +to.track;
    if (!(tr >= -1 && tr < ph.tracks.length)) return null;
    var g = ph.steps.filter(function (x) { return x.track === tr; }), head = (tr >= 0 ? ph.tracks[tr].line : ph.line) + 1;
    /* Indented lines right under the heading belong to no step; a step placed above them would take them as its own. */
    for (var k = head, end = tr + 1 < ph.tracks.length ? ph.tracks[tr + 1].line : ph.regionEnd; k < end && (blank(o.lines[k]) || /^\s/.test(o.lines[k])); k++) if (!blank(o.lines[k])) head = k + 1;
    if (to.where === 'start') return { at: g.length ? g[0].line : head, phase: ph, track: tr };
    return { at: g.length ? g[g.length - 1].end : head, phase: ph, track: tr };
  }
  /* One place up or down: past the next step in its group, else into the next group or phase. */
  function nextPlace(o, s, dir) {
    var ph = s.phase, ps = ph.steps, k = ps.indexOf(s);
    if (dir < 0) {
      if (k > 0 && ps[k - 1].track === s.track) return { before: ps[k - 1].key };
      if (s.track >= 0) return { phase: ph.key, track: s.track - 1, where: 'end' };
      var prev = o.phases[ph.index - 1];
      return prev ? { phase: prev.key, track: prev.tracks.length - 1, where: 'end' } : null;
    }
    if (k < ps.length - 1 && ps[k + 1].track === s.track) return { after: ps[k + 1].key };
    if (s.track < ph.tracks.length - 1) return { phase: ph.key, track: s.track + 1, where: 'start' };
    var next = o.phases[ph.index + 1];
    return next ? { phase: next.key, track: -1, where: 'start' } : null;
  }
  function moveStepTo(text, key, to) {
    var g = guard(text); if (g.error) return { error: g.error };
    var o = g.o, s = stepBy(o, key); if (!s) return { error: ERR.gone };
    if (s.odd) return { error: ERR.odd };
    var a = anchorOf(o, to); if (!a) return { error: ERR.gone };
    if (a.at >= s.line && a.at <= s.end) return { text: text, at: s.line, same: true };
    var size = s.end - s.line, lines = o.lines.slice(), block = lines.splice(s.line, size), at = a.at > s.line ? a.at - size : a.at;
    lines.splice.apply(lines, [at, 0].concat(block));
    var oldLine = s.line + 1, newLine = at + 1, want = a.phase.index;
    return done(o, text, lines, function (A, B) {
      var x = pull(A, oldLine), y = pull(B, newLine);
      if (!x || !y || y.phase !== want) return false;
      /* Its own content is the same; only its place (and roles it takes from a track) may differ. */
      var keep = function (st) { return json({ id: st.id, type: st.type, text: st.text, must: st.must, planned: st.planned, binds: st.binds, fields: st.fields, note: st.note, shots: st.shots }); };
      return keep(x.step) === keep(y.step);
    }, at);
  }
  function moveStep(text, key, dir) {
    var g = guard(text); if (g.error) return { error: g.error };
    var s = stepBy(g.o, key); if (!s) return { error: ERR.gone };
    var to = nextPlace(g.o, s, dir < 0 ? -1 : 1);
    if (!to) return { error: dir < 0 ? ERR.first : ERR.last };
    return moveStepTo(text, key, to);
  }

  /* Change one thing about a step: set = { text } | { mark: ' ' | '!' | '~' } | { type } | { field, value } | { role, on } | { bind, on }. */
  function editStep(text, key, set) {
    var g = guard(text); if (g.error) return { error: g.error };
    var o = g.o, s = stepBy(o, key); if (!s) return { error: ERR.gone };
    if (s.odd) return { error: ERR.odd };
    var p = s.parts, lines = o.lines.slice(), cr = crOf(o, s.line), first = function (q) { lines[s.line] = q.pre + q.typePart + q.rest + q.idSuffix + cr; };
    var q = { pre: p.pre, typePart: p.typePart, rest: p.rest, idSuffix: p.idSuffix }, at = s.line;
    var expect = function () { /* changes the "before" signature of the step */ };
    if ('text' in set) {
      var t = lineValue(set.text);
      if (!t) return { error: 'A step needs some text.' };
      if (t === p.rest.replace(/\s*[@^][\w-]+/g, '').trim()) return { text: text, at: at, same: true };
      if (/[@^][\w-]/.test(t)) return { error: 'Choose roles and run details with their buttons, not with @ or ^ in the text.' };
      if (/\{#/.test(t) || TYPE_RE.test(t + ' x')) return { error: 'Leave out { and } at the start, and IDs; the builder keeps them for you.' };
      var toks = [];
      p.rest.replace(/([@^])([\w-]+)/g, function (_, c, n) { toks.push(c + n); return ''; });
      q.rest = t + (toks.length ? ' ' + toks.join(' ') : '');
      first(q);
      expect = function (st) { st.text = t; };
    } else if ('mark' in set) {
      if ([' ', '!', '~'].indexOf(set.mark) < 0) return { error: 'Choose Step, Must-do or Automation planned.' };
      q.pre = p.pre.slice(0, 3) + set.mark + p.pre.slice(4);
      first(q);
      expect = function (st) { st.must = set.mark === '!'; st.planned = set.mark === '~'; };
    } else if ('type' in set) {
      var ty = String(set.type || '');
      if (!/^[a-z][\w.-]*$/i.test(ty)) return { error: 'Choose a step type.' };
      q.typePart = p.typePart ? p.typePart.replace(/^\{[^}]*\}/, '{' + ty + '}') : '{' + ty + '} ';
      first(q);
      expect = function (st) { st.type = ty; };
    } else if ('role' in set || 'bind' in set) {
      var isRole = 'role' in set, name = String(isRole ? set.role : set.bind), ch = isRole ? '@' : '^', have = (isRole ? p.roles : p.binds).indexOf(name) >= 0;
      if (!/^[\w-]+$/.test(name)) return { error: ERR.gone };
      if (!!set.on === have) return { text: text, at: at, same: true };
      q.rest = set.on ? p.rest.replace(/\s+$/, '') + ' ' + ch + name : p.rest.replace(new RegExp('\\s*\\' + ch + reEsc(name) + '(?![\\w-])', 'g'), '');
      if (!tokens(tokens(q.rest, '@').rest, '^').rest) return { error: 'A step needs some text.' };
      first(q);
      var trackRoles = s.track >= 0 ? s.phase.tracks[s.track].roles : [];
      expect = function (st) {
        if (!isRole) { st.binds = set.on ? p.binds.concat([name]) : p.binds.filter(function (b) { return b !== name; }); return; }
        var own = set.on ? p.roles.concat([name]) : p.roles.filter(function (r) { return r !== name; });
        st.roles = own.length ? own : trackRoles.slice();
      };
    } else if ('field' in set) {
      var f = String(set.field), v = lineValue(set.value), fl = s.fieldLines[f];
      if (!/^[\w-]+$/.test(f)) return { error: ERR.gone };
      if (v === (s.fields[f] || '')) return { text: text, at: at, same: true };
      if (fl != null) {
        if (!v) lines.splice(fl, 1);
        else { var fm = /^(\s{2,}[\w-]+:)(\s*)/.exec(bare(lines[fl])); lines[fl] = fm[1] + (fm[2] || ' ') + v + crOf(o, fl); }
      } else if (v) {
        var last = Object.keys(s.fieldLines).reduce(function (mx, k) { return Math.max(mx, s.fieldLines[k]); }, -1);
        var indent = last >= 0 ? /^\s*/.exec(bare(lines[last]))[0] : '  ';
        lines.splice((last >= 0 ? last : s.line) + 1, 0, indent + f + ': ' + v + cr);
      }
      expect = function (st) { if (v) st.fields[f] = v; else delete st.fields[f]; };
    } else return { error: ERR.gone };
    var line = s.line + 1;
    return done(o, text, lines, function (A) {
      var x = null;
      A.phases.forEach(function (ph) { ph.steps.forEach(function (st) { if (st._line === line) x = st; }); });
      if (!x) return false;
      expect(x);
      /* Lines below it may have shifted (a field added or removed); only the order matters for the comparison. */
    }, at);
  }

  function addStep(text, to, step) {
    var g = guard(text); if (g.error) return { error: g.error };
    var o = g.o, t = lineValue(step && step.text), ty = String((step && step.type) || 'confirm'), mark = (step && step.mark) || ' ';
    if (!t) return { error: 'Say what to do in the new step.' };
    if (/[@^][\w-]/.test(t) || /\{#/.test(t) || TYPE_RE.test(t + ' x')) return { error: 'Write the step as plain text. Choose roles and run details after adding it.' };
    if (!/^[a-z][\w.-]*$/i.test(ty) || [' ', '!', '~'].indexOf(mark) < 0) return { error: 'Choose a step type.' };
    var a = anchorOf(o, to); if (!a) return { error: ERR.gone };
    var id = newId(o, t, 'step'), lines = o.lines.slice();
    lines.splice(a.at, 0, '- [' + mark + '] {' + ty + '} ' + t + ' {#' + id + '}' + o.cr);
    var want = a.phase.index;
    var res = done(o, text, lines, function (A, B) {
      var y = pull(B, a.at + 1);
      /* It is exactly what was asked for: nothing it wasn't given (a note, a field or a picture below it) came with it. */
      var st = y && y.step;
      return !!st && y.phase === want && st.id === id && st.text === t && st.type === ty && st.must === (mark === '!') && st.planned === (mark === '~') &&
        !st.binds.length && !st.note && !(st.shots || []).length && !Object.keys(st.fields).length;
    }, a.at);
    if (!res.error) res.id = id;
    return res;
  }

  function deleteStep(text, key) {
    var g = guard(text); if (g.error) return { error: g.error };
    var o = g.o, s = stepBy(o, key); if (!s) return { error: ERR.gone };
    if (s.odd) return { error: ERR.odd };
    var lines = o.lines.slice(); lines.splice(s.line, s.end - s.line);
    var line = s.line + 1;
    return done(o, text, lines, function (A) { return !!pull(A, line); }, s.line);
  }

  /* ---------- phases and gates ---------- */
  function phaseLine(title, mode, idSuffix) { return '## ' + title + (mode ? ' · ' + mode : '') + idSuffix; }
  function checkTitle(t, what) {
    if (!t) return 'Give the ' + what + ' a name.';
    if (/^(gate:|questions\b)/i.test(t) || /\{#/.test(t) || /\s·\s/.test(t)) return 'Use a plain name for the ' + what + ', without "Gate:", "Questions", "·" or an ID.';
    return '';
  }
  /* Lines for a new block at a position, with a blank line between it and its neighbors. */
  function spaced(o, at, block) {
    var out = block.slice();
    if (at > 0 && !blank(o.lines[at - 1])) out.unshift(o.cr);
    if (at < o.lines.length && !blank(o.lines[at])) out.push(o.cr);
    return out;
  }
  function addPhase(text, after, ph) {
    var g = guard(text); if (g.error) return { error: g.error };
    var o = g.o, t = lineValue(ph && ph.title), mode = (ph && ph.mode) || '', bad = checkTitle(t, 'phase');
    if (bad) return { error: bad };
    if (mode && MODES.indexOf(mode) < 0) return { error: 'Choose READ-DO or DO-CONFIRM.' };
    var prev = after != null && after !== '' ? phaseBy(o, after) : o.phases[o.phases.length - 1];
    if (after != null && after !== '' && !prev) return { error: ERR.gone };
    var at;
    if (prev) at = prev.contentEnd;
    else {
      var stop = o.questions >= 0 ? o.questions : o.lines.length, from = o.front ? o.front.end : 0;
      at = stop; while (at > from && blank(o.lines[at - 1])) at--;
    }
    var id = newId(o, t, 'phase', true), lines = o.lines.slice(), block = spaced(o, at, [phaseLine(t, mode, ' {#' + id + '}') + o.cr]);
    lines.splice.apply(lines, [at, 0].concat(block));
    var index = prev ? prev.index + 1 : 0;
    var res = done(o, text, lines, function (A, B) {
      var y = B.phases.splice(index, 1)[0];
      return !!y && y.id === id && y.title === t && y.mode === mode && !y.steps.length;
    }, at + block.indexOf(phaseLine(t, mode, ' {#' + id + '}') + o.cr));
    if (!res.error) res.id = id;
    return res;
  }
  function editPhase(text, key, set) {
    var g = guard(text); if (g.error) return { error: g.error };
    var o = g.o, p = phaseBy(o, key); if (!p) return { error: ERR.gone };
    var t = 'title' in set ? lineValue(set.title) : p.title, mode = 'mode' in set ? set.mode || '' : p.mode, bad = checkTitle(t, 'phase');
    if (bad) return { error: bad };
    if (mode && MODES.indexOf(mode) < 0) return { error: 'Choose READ-DO or DO-CONFIRM.' };
    if (t === p.title && mode === p.mode) return { text: text, at: p.line, same: true };
    var lines = o.lines.slice(); lines[p.line] = phaseLine(t, mode, p.idSuffix) + crOf(o, p.line);
    return done(o, text, lines, function (A) {
      var x = A.phases[p.index]; x.title = t; x.mode = mode;
      /* Without a named gate, the phase ends with "Confirm <its name>", which follows a rename. */
      if (x.gate.implicit) x.gate.title = 'Confirm ' + t;
    }, p.line);
  }
  /* Phases change places as whole blocks; the blank lines between them stay where they are. */
  function movePhase(text, key, dir) {
    var g = guard(text); if (g.error) return { error: g.error };
    var o = g.o, p = phaseBy(o, key); if (!p) return { error: ERR.gone };
    var j = p.index + (dir < 0 ? -1 : 1);
    if (j < 0) return { error: ERR.first };
    if (j >= o.phases.length) return { error: ERR.last };
    var x = o.phases[Math.min(p.index, j)], y = o.phases[Math.max(p.index, j)];
    var cx = o.lines.slice(x.line, x.contentEnd), sep = o.lines.slice(x.contentEnd, y.line), cy = o.lines.slice(y.line, y.contentEnd);
    var lines = o.lines.slice(0, x.line).concat(cy, sep, cx, o.lines.slice(y.contentEnd));
    var lo = x.index, at = dir < 0 ? x.line : x.line + cy.length + sep.length;
    return done(o, text, lines, function (A) { var t = A.phases[lo]; A.phases[lo] = A.phases[lo + 1]; A.phases[lo + 1] = t; }, at);
  }
  /* Add the phase's closing gate, or change it: { title, owner, approves }; a field left out stays as it is. */
  function setGate(text, key, set) {
    var g = guard(text); if (g.error) return { error: g.error };
    var o = g.o, p = phaseBy(o, key); if (!p) return { error: ERR.gone };
    var gt = p.gate, cur = gt || { title: '', owner: '', approves: '' };
    var t = 'title' in set ? lineValue(set.title) : cur.title, owner = 'owner' in set ? String(set.owner || '') : cur.owner, ap = 'approves' in set ? lineValue(set.approves) : cur.approves;
    var bad = checkTitle(t, 'gate'); if (bad) return { error: bad };
    if (owner && !/^[\w-]+$/.test(owner)) return { error: 'Choose a role for the gate\'s owner.' };
    var lines = o.lines.slice(), at, id;
    if (gt) {
      if (gt.odd) return { error: ERR.odd };
      if (t === gt.title && owner === gt.owner && ap === gt.approves) return { text: text, at: gt.line, same: true };
      at = gt.line; id = gt.id;
      if (ap !== gt.approves) {
        if (gt.approvesLine >= 0) {
          if (!ap) lines.splice(gt.approvesLine, 1);
          else { var am = /^(\s{2,}approves:)(\s*)/.exec(bare(lines[gt.approvesLine])); lines[gt.approvesLine] = am[1] + (am[2] || ' ') + ap + crOf(o, gt.approvesLine); }
        } else lines.splice(gt.line + 1, 0, '  approves: ' + ap + crOf(o, gt.line));
      }
      if (t !== gt.title || owner !== gt.owner) lines[gt.line] = '## Gate: ' + t + (owner ? ' · owner @' + owner : '') + gt.idSuffix + crOf(o, gt.line);
    } else {
      id = newId(o, t, 'gate');
      var blockLines = ['## Gate: ' + t + (owner ? ' · owner @' + owner : '') + ' {#' + id + '}' + o.cr].concat(ap ? ['  approves: ' + ap + o.cr] : []);
      var block = spaced(o, p.contentEnd, blockLines);
      lines.splice.apply(lines, [p.contentEnd, 0].concat(block));
      at = p.contentEnd + block.indexOf(blockLines[0]);
    }
    return done(o, text, lines, function (A, B) {
      var x = A.phases[p.index], y = B.phases[p.index];
      if (!x || !y || y.gate.implicit || y.gate.id !== id || y.gate.title !== t || (y.gate.owner || '') !== owner || y.gate.approves !== ap) return false;
      x.gate = y.gate = null;
    }, at);
  }

  /* ---------- what changed: a line diff, for "Changed lines" and the tests ---------- */
  function diff(a, b) {
    var A = String(a == null ? '' : a).split('\n').map(bare), B = String(b == null ? '' : b).split('\n').map(bare);
    var s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
    var ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    var X = A.slice(s, ea), Y = B.slice(s, eb), added = [], removed = [], i, j;
    if (X.length * Y.length > 1000000) {
      for (i = 0; i < X.length; i++) removed.push(s + i);
      for (j = 0; j < Y.length; j++) added.push(s + j);
      return { added: added, removed: removed };
    }
    var dp = [];
    for (i = X.length; i >= 0; i--) {
      dp[i] = [];
      for (j = Y.length; j >= 0; j--) dp[i][j] = i === X.length || j === Y.length ? 0 : X[i] === Y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    i = 0; j = 0;
    while (i < X.length || j < Y.length) {
      if (i < X.length && j < Y.length && X[i] === Y[j]) { i++; j++; }
      else if (j < Y.length && (i === X.length || dp[i][j + 1] >= dp[i + 1][j])) added.push(s + j++);
      else removed.push(s + i++);
    }
    return { added: added, removed: removed };
  }

  /* One entry point for the app: op names what to do. */
  function apply(text, op) {
    op = op || {};
    switch (op.op) {
      case 'move': return moveStep(text, op.step, op.dir === 'up' || op.dir < 0 ? -1 : 1);
      case 'moveTo': return moveStepTo(text, op.step, op.to || {});
      case 'edit': return editStep(text, op.step, op.set || {});
      case 'add': return addStep(text, op.to || {}, op);
      case 'delete': return deleteStep(text, op.step);
      case 'addPhase': return addPhase(text, op.after, op);
      case 'editPhase': return editPhase(text, op.phase, op.set || {});
      case 'movePhase': return movePhase(text, op.phase, op.dir === 'up' || op.dir < 0 ? -1 : 1);
      case 'gate': return setGate(text, op.phase, op.set || {});
    }
    return { error: 'Nothing to do.' };
  }

  return { MODES: MODES, parse: parse, apply: apply, moveStep: moveStep, moveStepTo: moveStepTo, editStep: editStep, addStep: addStep, deleteStep: deleteStep,
    addPhase: addPhase, editPhase: editPhase, movePhase: movePhase, setGate: setGate, diff: diff, keyAt: keyAt, follow: follow, nextPlace: nextPlace };
})();
