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
    var o = { lines: src.split('\n'), cr: /\r\n/.test(src) ? '\r' : '', front: null, phases: [], steps: [], questions: -1, unsupported: '', ids: Object.create(null) };
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
        track = { id: th.id, idSuffix: th.suffix, pre: /^###\s+Track:\s*/i.exec(line)[0], title: tr.rest, roles: tr.list, line: i, index: phase.tracks.length, phase: phase };
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
          fields: {}, fieldLines: {}, notes: 0, shots: [], line: i, end: i + 1, odd: false, phase: phase, track: track ? track.index : -1, index: o.steps.length };
        phase.steps.push(step); o.steps.push(step); blk = step;
        continue;
      }
      if (/^\s{2,}>\s?(.*)$/.test(line)) {
        var tg = step || gate;
        if (tg) { own(tg, i); tg.notes = (tg.notes || 0) + 1; continue; }
      } else if (step && (m = /^\s{2,}!\[(.*?)\]\(([^)\s]+)\)\s*$/.exec(line))) { own(step, i); step.shots.push({ caption: m[1], src: m[2], line: i }); continue; }
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
      /* A track runs to the next track, else to the gate or the end of the phase. */
      p.tracks.forEach(function (t, j) { t.end = j + 1 < p.tracks.length ? p.tracks[j + 1].line : p.gate ? p.gate.line : e; });
    });
    var count = Object.create(null);
    L.forEach(function (l) { var x = ANY_ID.exec(l); if (x) { var id = x[1].toLowerCase(); o.ids[id] = true; } });
    o.phases.forEach(function (p) { if (p.id) o.ids[p.id + '-confirm'] = true; });
    o.steps.forEach(function (s) { if (s.id) count[s.id] = (count[s.id] || 0) + 1; });
    o.steps.forEach(function (s) { s.key = s.id && count[s.id] === 1 ? s.id : '#' + s.index; });
    var pc = Object.create(null);
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
    /* Several steps left or moved at once: a step with an ID is that ID; one without is found by what it says. */
    if (!ph && (o === 'deleteTrack' || o === 'deletePhase')) {
      var s0 = A[i]; if (s0.id && s0.key === s0.id) return stepBy(b, s0.id) ? s0.id : null;
      var sig = function (x) { return json([x.text, x.type, x.fields, x.must, x.planned]); }, nth = A.slice(0, i).filter(function (x) { return sig(x) === sig(s0); }).length;
      var hits = B.filter(function (x) { return sig(x) === sig(s0); });
      return hits[nth] ? hits[nth].key : null;
    }
    if (!ph && o === 'movePhase') {
      /* Two phases swap places, and their steps with them. */
      var pi = by(a.phases, op.phase), pj = pi + (op.dir === 'up' || op.dir < 0 ? -1 : 1);
      if (pi < 0 || pj < 0 || pj >= a.phases.length) return B[i] ? B[i].key : null;
      var x = a.phases[Math.min(pi, pj)], y = a.phases[Math.max(pi, pj)], s = A[i];
      i += s.phase === x ? y.steps.length : s.phase === y ? -x.steps.length : 0;
      return B[i] ? B[i].key : null;
    }
    if (ph ? o === 'movePhase' || o === 'addPhase' || o === 'deletePhase' : o === 'move' || o === 'moveTo' || o === 'add' || o === 'delete' || o === 'addTrack') {
      if (o !== 'add' && o !== 'addPhase' && o !== 'addTrack') from = by(A, ph ? op.phase : op.step);
      if (o !== 'delete' && o !== 'deletePhase') for (var k = 0; k < B.length; k++) if (B[k].line === at) to = k;
    }
    if (i === from) return to >= 0 ? B[to].key : null;
    /* Everything else keeps its order: take out the one that left, put in the one that arrived. */
    var r = i - (from >= 0 && from < i ? 1 : 0), j = r + (to >= 0 && to <= r ? 1 : 0);
    return B[j] ? B[j].key : null;
  }

  /* A new ID from the text, unique in the whole file (automatic gate IDs included). A phase's ID also gives its automatic
     gate one (<id>-confirm), so that one must be free too. */
  /* own: the ID of the part being renamed, which is free for it to keep. */
  function newId(o, text, fallback, phase, own) {
    /* At most 24 characters, cut at a word where the slug is longer. */
    var whole = U.slug(text, 200), base = U.slug(text, 24).replace(/-+$/, '');
    if (whole.length > 24 && whole.charAt(24) !== '-' && base.lastIndexOf('-') > 8) base = base.slice(0, base.lastIndexOf('-'));
    if (!base || base === 'x' || !/^[a-z0-9]/.test(base)) base = fallback;
    var used = function (x) { return !!o.ids[x] && x !== own && !(phase && own && x === own + '-confirm'); };
    var id = base, k = 2;
    while (used(id) || (phase && used(id + '-confirm'))) id = base + '-' + (k++);
    return id;
  }
  function swapId(suffix, id) { return suffix ? suffix.replace(/\{#[^}]*\}/, '{#' + id + '}') : ' {#' + id + '}'; }

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
    var q = { pre: p.pre, typePart: p.typePart, rest: p.rest, idSuffix: p.idSuffix }, at = s.line, reid = '';
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
      /* reid: a part added in this window and never saved takes its ID from its first real text (app.js decides when). */
      if (set.reid) { var nid = newId(o, t, 'step', false, s.id); if (nid !== s.id) { q.idSuffix = swapId(p.idSuffix, nid); reid = nid; } }
      first(q);
      expect = function (st) { st.text = t; if (reid) st.id = reid; };
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
    var res = done(o, text, lines, function (A) {
      var x = null;
      A.phases.forEach(function (ph) { ph.steps.forEach(function (st) { if (st._line === line) x = st; }); });
      if (!x) return false;
      expect(x);
      /* Lines below it may have shifted (a field added or removed); only the order matters for the comparison. */
    }, at);
    if (!res.error) res.id = reid || s.id;
    return res;
  }

  /* ---------- a step's screenshots: its ![caption](images/…) lines ---------- */
  var SHOT_SRC = /^images\/[\w./-]+$/;
  /* A caption is plain text on one line, said by screen readers as the picture's alt text. */
  function caption(c) {
    var v = oneLine(c);
    if (!v) return { error: 'Write a caption first. It says what the screenshot shows, and it\'s what screen readers read out.' };
    if (/[\[\]]/.test(v)) return { error: 'Leave out [ and ] in a caption.' };
    if (v.length > 200) return { error: 'Keep a caption to 200 characters.' };
    return { value: v };
  }
  /* One step's screenshot lines, as edits that change only those lines; the safety net checks the step's screenshots became
     exactly what was asked for. set: { add: {caption, src} } | { edit: i, caption } | { move: i, dir } | { remove: i }. */
  function editShots(text, key, set) {
    var g = guard(text); if (g.error) return { error: g.error };
    var o = g.o, s = stepBy(o, key); if (!s) return { error: ERR.gone };
    if (s.odd) return { error: ERR.odd };
    var lines = o.lines.slice(), cr = crOf(o, s.line), want = s.shots.map(function (x) { return { caption: x.caption, src: x.src }; }), at = s.line, k;
    var lineOf = function (sh, c, src) { var ind = /^\s*/.exec(bare(lines[sh.line]))[0]; return ind + '![' + c + '](' + src + ')' + crOf(o, sh.line); };
    if (set.add) {
      var c = caption(set.add.caption); if (c.error) return { error: c.error };
      var src = String(set.add.src || '');
      if (!SHOT_SRC.test(src) || src.indexOf('..') >= 0) return { error: 'Screenshots must be under images/.' };
      var last = s.shots[s.shots.length - 1], ind = last ? /^\s*/.exec(bare(lines[last.line]))[0] : '  ';
      at = last ? last.line + 1 : s.end;
      lines.splice(at, 0, ind + '![' + c.value + '](' + src + ')' + cr);
      want.push({ caption: c.value, src: src });
    } else {
      k = +(set.edit != null ? set.edit : set.move != null ? set.move : set.remove);
      var sh = s.shots[k]; if (!(k >= 0) || !sh) return { error: 'That screenshot isn\'t in the draft anymore. It may have just changed.' };
      at = sh.line;
      if (set.edit != null) {
        var e = caption(set.caption); if (e.error) return { error: e.error };
        if (e.value === sh.caption) return { text: text, at: at, same: true };
        lines[sh.line] = lineOf(sh, e.value, sh.src); want[k].caption = e.value;
      } else if (set.move != null) {
        var j = k + (set.dir === 'up' || set.dir < 0 ? -1 : 1), other = s.shots[j];
        if (!other) return { error: j < k ? ERR.first : ERR.last };
        lines[sh.line] = lineOf(sh, other.caption, other.src); lines[other.line] = lineOf(other, sh.caption, sh.src);
        want.splice(j, 0, want.splice(k, 1)[0]); at = other.line;
      } else { lines.splice(sh.line, 1); want.splice(k, 1); }
    }
    var line = s.line + 1;
    return done(o, text, lines, function (A) {
      var x = null;
      A.phases.forEach(function (ph) { ph.steps.forEach(function (st) { if (st._line === line) x = st; }); });
      if (!x) return false;
      x.shots = want;
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
    var first = !!(ph && ph.first), prev = first ? null : after != null && after !== '' ? phaseBy(o, after) : o.phases[o.phases.length - 1];
    if (!first && after != null && after !== '' && !prev) return { error: ERR.gone };
    var at;
    if (first && o.phases.length) at = o.phases[0].line;
    else if (prev) at = prev.contentEnd;
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
    var nid = set.reid && 'title' in set ? newId(o, t, 'phase', true, p.id) : p.id;
    var lines = o.lines.slice(); lines[p.line] = phaseLine(t, mode, nid !== p.id ? swapId(p.idSuffix, nid) : p.idSuffix) + crOf(o, p.line);
    var res = done(o, text, lines, function (A) {
      var x = A.phases[p.index]; x.title = t; x.mode = mode; x.id = nid;
      /* Without a named gate, the phase ends with "Confirm <its name>", which follows a rename. */
      if (x.gate.implicit) { x.gate.title = 'Confirm ' + t; x.gate.id = nid ? nid + '-confirm' : ''; }
    }, p.line);
    if (!res.error) res.id = nid;
    return res;
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
      at = gt.line; id = set.reid && 'title' in set ? newId(o, t, 'gate', false, gt.id) : gt.id;
      if (ap !== gt.approves) {
        if (gt.approvesLine >= 0) {
          if (!ap) lines.splice(gt.approvesLine, 1);
          else { var am = /^(\s{2,}approves:)(\s*)/.exec(bare(lines[gt.approvesLine])); lines[gt.approvesLine] = am[1] + (am[2] || ' ') + ap + crOf(o, gt.approvesLine); }
        } else lines.splice(gt.line + 1, 0, '  approves: ' + ap + crOf(o, gt.line));
      }
      if (t !== gt.title || owner !== gt.owner || id !== gt.id) lines[gt.line] = '## Gate: ' + t + (owner ? ' · owner @' + owner : '') + (id !== gt.id ? swapId(gt.idSuffix, id) : gt.idSuffix) + crOf(o, gt.line);
    } else {
      id = newId(o, t, 'gate');
      var blockLines = ['## Gate: ' + t + (owner ? ' · owner @' + owner : '') + ' {#' + id + '}' + o.cr].concat(ap ? ['  approves: ' + ap + o.cr] : []);
      var block = spaced(o, p.contentEnd, blockLines);
      lines.splice.apply(lines, [p.contentEnd, 0].concat(block));
      at = p.contentEnd + block.indexOf(blockLines[0]);
    }
    var res = done(o, text, lines, function (A, B) {
      var x = A.phases[p.index], y = B.phases[p.index];
      if (!x || !y || y.gate.implicit || y.gate.id !== id || y.gate.title !== t || (y.gate.owner || '') !== owner || y.gate.approves !== ap) return false;
      x.gate = y.gate = null;
    }, at);
    if (!res.error) res.id = id;
    return res;
  }

  /* Without its gate, a phase ends with its automatic check again. */
  function removeGate(text, key) {
    var g = guard(text); if (g.error) return { error: g.error };
    var o = g.o, p = phaseBy(o, key); if (!p) return { error: ERR.gone };
    var gt = p.gate; if (!gt) return { error: 'This phase has no gate to remove.' };
    if (gt.odd) return { error: ERR.odd };
    var auto = p.id ? p.id + '-confirm' : '';
    if (auto && o.lines.some(function (l, i) { var x = ANY_ID.exec(bare(l)); return i !== gt.line && x && x[1].toLowerCase() === auto; })) return { error: 'Its automatic check would take the ID ' + auto + ', which something else already uses. Remove the gate in Markdown.' };
    var lines = o.lines.slice(), at = gt.line;
    lines.splice(gt.line, gt.end - gt.line);
    /* The blank line that set it apart goes too, so no double gap is left behind. */
    if (at > 0 && blank(lines[at - 1]) && (at >= lines.length || blank(lines[at]))) { lines.splice(at - 1, 1); at--; }
    return done(o, text, lines, function (A, B) {
      var y = B.phases[p.index]; if (!y || !y.gate.implicit) return false;
      A.phases[p.index].gate = y.gate = null;
    }, p.line);
  }
  /* A phase goes with everything in it: its steps, lanes, gate and the lines between them. */
  function deletePhase(text, key) {
    var g = guard(text); if (g.error) return { error: g.error };
    var o = g.o, p = phaseBy(o, key); if (!p) return { error: ERR.gone };
    var lines = o.lines.slice(), start = p.line, end = p.regionEnd, keep = [];
    /* The last phase in the file takes the blank lines above it too, and the file keeps its final line break. */
    if (end === o.lines.length) {
      var floor = o.front ? o.front.end : 0;
      while (start > floor && blank(o.lines[start - 1])) start--;
      if (o.lines[o.lines.length - 1] === '') keep = [''];
    }
    lines.splice.apply(lines, [start, end - start].concat(keep));
    var res = done(o, text, lines, function (A) { A.phases.splice(p.index, 1); }, start);
    if (!res.error) res.steps = p.steps.length;
    return res;
  }

  /* ---------- tracks: parallel lanes ---------- */
  function trackAt(o, key, k) { var ph = phaseBy(o, key); return ph && k != null && k !== '' && ph.tracks[+k] || null; }
  function checkLane(t) {
    if (!t) return 'Give the lane a name.';
    if (/@[\w-]/.test(t) || /\{#/.test(t)) return 'Use a plain name for the lane, without @ or an ID. Choose who works it in its form.';
    return '';
  }
  function frontRoles(o) { return o.front ? M.parse(o.lines.slice(o.front.start, o.front.end).join('\n')).meta.roles : []; }
  /* A role the checks would reject as unlisted goes into the front matter's roles: line, or a new one. Called after every
     other line change, since a new line here moves everything below it. Returns the lines it added, or -1. */
  function declareRole(o, lines, role) {
    if (!role || frontRoles(o).indexOf(role) >= 0) return 0;
    if (!o.front || o.front.end < 2 || bare(o.lines[o.front.end - 1]).trim() !== '---') return -1;
    for (var i = o.front.start + 1; i < o.front.end - 1; i++) {
      var m = /^roles:(\s*)(.*?)\s*$/.exec(bare(lines[i]));
      if (m) { lines[i] = 'roles:' + (m[1] || ' ') + (m[2] ? m[2].replace(/,\s*$/, '') + ', ' : '') + role + crOf(o, i); return 0; }
    }
    lines.splice(o.front.end - 1, 0, 'roles: ' + role + o.cr);
    return 1;
  }
  var NO_FRONT = 'The checklist has no front matter to list the lane\'s role in. Add it in Markdown first.';
  /* A step's first line with roles of its own added, so it keeps the people it had from its lane. */
  function withRoles(o, s, roles) { var p = s.parts; return p.pre + p.typePart + p.rest.replace(/\s+$/, '') + roles.map(function (r) { return ' @' + r; }).join('') + p.idSuffix + crOf(o, s.line); }

  /* A new lane, its heading and a first step, goes before another lane or after the phase's last steps: anywhere else, the
     steps below it would join it. */
  function addTrack(text, to, tr) {
    var g = guard(text); if (g.error) return { error: g.error };
    to = to || {}; tr = tr || {};
    var o = g.o, ph = phaseBy(o, to.phase); if (!ph) return { error: ERR.gone };
    var t = lineValue(tr.title), role = String(tr.role || ''), st = lineValue(tr.text), ty = String(tr.type || 'confirm'), bad = checkLane(t);
    if (bad) return { error: bad };
    if (role && !/^[\w-]+$/.test(role)) return { error: 'Choose a role for the lane.' };
    if (!st) return { error: 'Say what the lane\'s first step is.' };
    if (/[@^][\w-]/.test(st) || /\{#/.test(st) || TYPE_RE.test(st + ' x') || !/^[a-z][\w.-]*$/i.test(ty)) return { error: 'Write the step as plain text. Choose roles and run details after adding it.' };
    var before = to.before == null || to.before === '' ? -1 : +to.before;
    if (!(before >= -1 && before < ph.tracks.length)) return { error: ERR.gone };
    var at = before >= 0 ? ph.tracks[before].line : anchorOf(o, { phase: ph.key, track: ph.tracks.length - 1, where: 'end' }).at;
    var tid = newId(o, t, 'lane'); o.ids[tid] = true;
    var sid = newId(o, st, 'step'), lines = o.lines.slice(), listed = !role || frontRoles(o).indexOf(role) >= 0;
    lines.splice(at, 0, '### Track: ' + t + (role ? ' @' + role : '') + ' {#' + tid + '}' + o.cr, '- [ ] {' + ty + '} ' + st + ' {#' + sid + '}' + o.cr);
    var shift = declareRole(o, lines, role); if (shift < 0) return { error: NO_FRONT };
    var k = before >= 0 ? before : ph.tracks.length, want = ph.index, stepLine = at + shift + 2, own = role ? [role] : [];
    var res = done(o, text, lines, function (A, B) {
      if (!listed) A.meta.roles = A.meta.roles.concat([role]);
      var y = B.phases[want], tk = y && y.tracks.splice(k, 1)[0], z = pull(B, stepLine), s1 = z && z.step;
      if (!tk || json(tk) !== json([tid, t, own])) return false;
      return !!s1 && z.phase === want && s1.id === sid && s1.text === st && s1.type === ty && s1.track === tid && json(s1.roles) === json(own) && !s1.must && !s1.planned &&
        !s1.binds.length && !s1.note && !(s1.shots || []).length && !Object.keys(s1.fields).length;
    }, stepLine - 1);
    if (!res.error) { res.id = tid; res.step = sid; res.track = k; res.phase = ph.key; }
    return res;
  }
  /* Rename a lane or change who works it: { title } | { role } (one role, or '' for none). Its steps without a role of their
     own follow the lane's. */
  function editTrack(text, key, k, set) {
    var g = guard(text); if (g.error) return { error: g.error };
    var o = g.o, tr = trackAt(o, key, k); if (!tr) return { error: ERR.gone };
    var t = 'title' in set ? lineValue(set.title) : tr.title, roles = 'role' in set ? (set.role ? [String(set.role)] : []) : tr.roles, bad = 'title' in set ? checkLane(t) : '';
    if (bad) return { error: bad };
    if (roles.some(function (r) { return !/^[\w-]+$/.test(r); })) return { error: 'Choose a role for the lane.' };
    var tid = set.reid && 'title' in set && tr.id ? newId(o, t, 'lane', false, tr.id) : tr.id;
    if (t === tr.title && json(roles) === json(tr.roles) && tid === tr.id) return { text: text, at: tr.line, same: true };
    var lines = o.lines.slice(), ph = tr.phase, role = 'role' in set ? roles[0] || '' : '', listed = !role || frontRoles(o).indexOf(role) >= 0;
    lines[tr.line] = tr.pre + t + roles.map(function (r) { return ' @' + r; }).join('') + (tid !== tr.id ? swapId(tr.idSuffix, tid) : tr.idSuffix) + crOf(o, tr.line);
    var shift = declareRole(o, lines, role); if (shift < 0) return { error: NO_FRONT };
    var mine = ph.steps.filter(function (s) { return s.track === tr.index; }), heirs = mine.filter(function (s) { return !s.parts.roles.length; }).map(function (s) { return s.line + 1; });
    var res = done(o, text, lines, function (A) {
      if (!listed) A.meta.roles = A.meta.roles.concat([role]);
      var x = A.phases[ph.index]; x.tracks[tr.index] = [tid, t, roles];
      x.steps.forEach(function (st) { if (heirs.indexOf(st._line) >= 0) st.roles = roles.slice(); });
      mine.forEach(function (s) { x.steps.forEach(function (st) { if (st._line === s.line + 1) st.track = tid; }); });
    }, tr.line + shift);
    if (!res.error) res.id = tid;
    return res;
  }
  /* Delete a lane. how.steps === 'keep' moves its steps up into the phase, after the steps before any lane, each keeping the
     lane's role as its own; otherwise they go with it. */
  function deleteTrack(text, key, k, how) {
    var g = guard(text); if (g.error) return { error: g.error };
    var o = g.o, tr = trackAt(o, key, k); if (!tr) return { error: ERR.gone };
    var ph = tr.phase, keep = !!(how && how.steps === 'keep'), steps = ph.steps.filter(function (s) { return s.track === tr.index; });
    if (steps.some(function (s) { return s.odd; })) return { error: ERR.odd };
    var lines = o.lines.slice(), cuts = [{ at: tr.line, n: 1 }], moved = [];
    steps.forEach(function (s) {
      var first = !s.parts.roles.length && tr.roles.length ? withRoles(o, s, tr.roles) : o.lines[s.line];
      if (keep && tr.index === 0) { lines[s.line] = first; return; }
      if (keep) moved = moved.concat([first], o.lines.slice(s.line + 1, s.end));
      cuts.push({ at: s.line, n: s.end - s.line });
    });
    cuts.sort(function (a, b) { return b.at - a.at; }).forEach(function (c) { lines.splice(c.at, c.n); });
    /* Before the first lane, which is above every line just taken out, so the place hasn't moved. */
    var dest = moved.length ? anchorOf(o, { phase: ph.key, track: -1, where: 'end' }).at : tr.line;
    if (moved.length) lines.splice.apply(lines, [dest, 0].concat(moved));
    var gone = steps.map(function (s) { return s.line + 1; }), lead = ph.steps.filter(function (s) { return s.track === -1; }).length;
    var res = done(o, text, lines, function (A) {
      var x = A.phases[ph.index]; x.tracks.splice(tr.index, 1);
      var mine = x.steps.filter(function (st) { return gone.indexOf(st._line) >= 0; });
      x.steps = x.steps.filter(function (st) { return gone.indexOf(st._line) < 0; });
      if (keep) { mine.forEach(function (st) { st.track = ''; }); x.steps.splice.apply(x.steps, [lead, 0].concat(mine)); }
    }, dest);
    if (!res.error) res.steps = steps.length;
    return res;
  }

  /* ---------- where a new part can go ---------- */
  function short(s) { s = String(s || '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim(); return s.length > 48 ? s.slice(0, 46).replace(/\s+\S*$/, '') + '…' : s; }
  function quote(s) { return '“' + short(s) + '”'; }
  /* Whether something new put at line L would take an indented line (a separated field or note, past a comment) that
     map.js gives to the step above: such a place is never offered, since the edit would be refused anyway. */
  function captures(o, L) {
    for (var k = L; k < o.lines.length; k++) {
      var l = bare(o.lines[k]);
      if (!l.trim()) continue;
      if (/^\s/.test(l)) return true;
      if (STEP_RE.test(l) || /^#{2,3}\s/.test(l)) return false;
    }
    return false;
  }
  /* Every place a part of a kind ('step', 'lanes', 'gate', 'phase') can be added without changing what anything else means,
     in outline order. Each has the id the builder's drop slots use, the line it would go at, where it is in words ("after
     “Run smoke tests”, inside QA") and a full name for screen readers ("Deploy, QA lane, after Run smoke tests, position 3
     of 5"). */
  function places(text, kind, parsed) {
    var o = parsed || parse(text), out = []; if (o.unsupported) return out;
    var add = function (id, line, where, spoken) { if (!captures(o, line)) out.push({ id: id, line: line, where: where, spoken: spoken }); };
    if (kind === 'phase') {
      var n = o.phases.length + 1;
      if (!o.phases.length) add('phase:^', o.lines.length, 'as the first phase', 'Phases, the first one, position 1 of 1');
      else add('phase:^', o.phases[0].line, 'first, before ' + quote(o.phases[0].title), 'Phases, first, before ' + short(o.phases[0].title) + ', position 1 of ' + n);
      o.phases.forEach(function (p, i) { add('phase:' + p.key, p.contentEnd, 'after ' + quote(p.title), 'Phases, after ' + short(p.title) + ', position ' + (i + 2) + ' of ' + n); });
      return out;
    }
    o.phases.forEach(function (ph) {
      var name = short(ph.title) || 'Untitled phase';
      if (kind === 'gate') { if (!ph.gate) add('gate:' + ph.key, ph.contentEnd, 'at the end of ' + name, name + ', closing gate'); return; }
      if (kind === 'lanes') {
        var m = ph.tracks.length + 1, last = ph.tracks[m - 2], lane = function (t) { return short(t.title) || 'Untitled'; };
        ph.tracks.forEach(function (t, k) { add('lane:' + ph.key + ':' + k, t.line, 'before the ' + lane(t) + ' lane, in ' + name, name + ', lanes, before ' + lane(t) + ', position ' + (k + 1) + ' of ' + m); });
        add('lane:' + ph.key + ':end', anchorOf(o, { phase: ph.key, track: m - 2, where: 'end' }).at, last ? 'after the ' + lane(last) + ' lane, in ' + name : 'at the end of ' + name,
          name + ', lanes, ' + (last ? 'after ' + lane(last) : 'the first lane') + ', position ' + m + ' of ' + m);
        return;
      }
      [-1].concat(ph.tracks.map(function (t) { return t.index; })).forEach(function (gi) {
        var steps = ph.steps.filter(function (s) { return s.track === gi; });
        /* Like the outline: the steps before the first lane are a group only when there are some, or no lanes. */
        if (gi < 0 && !steps.length && ph.tracks.length) return;
        var tr = gi >= 0 ? ph.tracks[gi] : null, inside = tr ? short(tr.title) || 'Untitled' : name, where = name + (tr ? ', ' + inside + ' lane' : ''), m = steps.length + 1;
        var say = function (i) { return (i ? 'after ' + quote(steps[i - 1].text) + ', inside ' : 'first, inside ') + inside; };
        var spoken = function (i) { return where + ', ' + (i ? 'after ' + short(steps[i - 1].text) : 'at the start') + ', position ' + (i + 1) + ' of ' + m; };
        steps.forEach(function (s, i) { add('before:' + s.key, s.line, say(i), spoken(i)); });
        add('end:' + ph.key + ':' + gi, anchorOf(o, { phase: ph.key, track: gi, where: 'end' }).at, say(steps.length), spoken(steps.length));
      });
    });
    return out;
  }
  /* The place nearest what's selected (just after a selected step, at the end of a selected phase or lane), else the first. */
  function nearest(text, kind, sel) {
    var list = places(text, kind); if (!list.length) return null;
    var o = parse(text), ref = -1, p = sel && phaseBy(o, sel.key), s = sel && sel.kind === 'step' && stepBy(o, sel.key);
    if (s) ref = s.end;
    else if (p && sel.kind === 'track' && p.tracks[+sel.track]) ref = p.tracks[+sel.track].end;
    else if (p) ref = p.contentEnd;
    if (ref < 0) return list[0].id;
    var best = list[0], bd = Infinity;
    list.forEach(function (x) { var d = x.line >= ref ? x.line - ref : (ref - x.line) * 2 + 1; if (d < bd) { bd = d; best = x; } });
    return best.id;
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
      case 'addPhase':
        var ph = addPhase(text, op.after, op); if (ph.error || ph.same || !op.step) return ph;
        /* With its first step, as one change. */
        var st = addStep(ph.text, { phase: ph.id, where: 'end' }, op.step); if (st.error) return st;
        return { text: st.text, at: ph.at, id: ph.id, step: st.id };
      case 'editPhase': return editPhase(text, op.phase, op.set || {});
      case 'movePhase': return movePhase(text, op.phase, op.dir === 'up' || op.dir < 0 ? -1 : 1);
      case 'gate': return setGate(text, op.phase, op.set || {});
      case 'removeGate': return removeGate(text, op.phase);
      case 'deletePhase': return deletePhase(text, op.phase);
      case 'addTrack': return addTrack(text, op.to || {}, op);
      case 'editTrack': return editTrack(text, op.phase, op.track, op.set || {});
      case 'deleteTrack': return deleteTrack(text, op.phase, op.track, op);
      case 'addShot': return editShots(text, op.step, { add: { caption: op.caption, src: op.src } });
      case 'editShot': return editShots(text, op.step, { edit: op.shot, caption: op.caption });
      case 'moveShot': return editShots(text, op.step, { move: op.shot, dir: op.dir });
      case 'removeShot': return editShots(text, op.step, { remove: op.shot });
    }
    return { error: 'Nothing to do.' };
  }

  return { MODES: MODES, parse: parse, apply: apply, moveStep: moveStep, moveStepTo: moveStepTo, editStep: editStep, addStep: addStep, deleteStep: deleteStep,
    addPhase: addPhase, editPhase: editPhase, movePhase: movePhase, setGate: setGate, removeGate: removeGate, deletePhase: deletePhase,
    addTrack: addTrack, editTrack: editTrack, deleteTrack: deleteTrack, caption: caption, editShots: editShots, places: places, nearest: nearest, diff: diff, keyAt: keyAt, follow: follow, nextPlace: nextPlace };
})();
