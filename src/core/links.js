/* What a linked step passes to its child (2.8): the pass: line, and what a {run.process} step means with and without carry:.
   Pure, ES5. One reader for run time, the checks, the builder and the child's start form (docs/design.md 40).
     No carry: (or an empty one): every child detail the parent also has is passed by name, as before 2.8; then pass: entries
     apply, and a listed name wins (name=? asks it instead).
     With carry: exactly what carry: and pass: list; everything else is asked when the child starts.
   A step without a pass: line keeps every pre-2.8 path (PF.run's own carry: code), so nothing changes for it. */
PF.links = (function () {
  'use strict';
  var NAME = /^[\w-]{1,60}$/, DETAIL = /^\^([\w-]+)$/, MAX = 40, VALUE_MAX = 120;

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function reserved(n) { return n === '__proto__' || n in Object.prototype; }
  function carryList(step) { return String((step.fields || {}).carry || '').split(/[,\s]+/).filter(Boolean); }
  /* Whether a step takes the 2.8 paths: a {run.process} step with a pass: line (even an empty one). */
  function has(step) { return !!step && step.type === 'run.process' && own(step.fields, 'pass'); }

  /* The pass: line's entries, in order: { name, source: detail | value | ask, from, value }, and what's wrong with it. */
  function parse(text) {
    var entries = [], errors = [], seen = Object.create(null), raw = String(text == null ? '' : text);
    if (!raw.trim()) return { entries: entries, errors: errors };
    var parts = raw.split(',');
    if (parts.length > MAX) { errors.push('pass: can list at most ' + MAX + ' details.'); return { entries: [], errors: errors }; }
    parts.forEach(function (seg) {
      var t = seg.trim(), eq = t.indexOf('=');
      if (!t) { errors.push('pass: has an empty entry (two commas in a row, or one at the end).'); return; }
      var name = eq < 0 ? '' : t.slice(0, eq).trim(), right = eq < 0 ? '' : t.slice(eq + 1).trim();
      if (eq < 0 || !name) { errors.push('"' + t + '" needs a name, =, and where its value comes from, like environment=^env.'); return; }
      if (reserved(name)) { errors.push('"' + name + '" is a name Flightdeck keeps for itself.'); return; }
      if (!NAME.test(name)) { errors.push('"' + name + '" isn\'t a run detail name (letters, digits, - and _).'); return; }
      if (seen[name]) { errors.push('pass: names "' + name + '" twice.'); return; }
      seen[name] = true;
      if (!right) { errors.push('"' + name + '=" says where its value comes from after the =: ^a detail, ? to ask, or a fixed value.'); return; }
      if (right === '?') { entries.push({ name: name, source: 'ask' }); return; }
      var m = DETAIL.exec(right);
      if (m) { if (reserved(m[1])) errors.push('"^' + m[1] + '" is a name Flightdeck keeps for itself.'); else entries.push({ name: name, source: 'detail', from: m[1] }); return; }
      if (right === '^') { errors.push('"' + name + '=^" names no run detail: "^" isn\'t a run detail.'); return; }
      if (/^team:/i.test(right)) { errors.push('"' + name + '=' + right + '": Team values aren\'t available yet.'); return; }
      if (right.indexOf('^') >= 0) { errors.push('"' + name + '=' + right + '": a fixed value can\'t hold ^. Use ^name alone to pass a run detail.'); return; }
      if (/[\u0000-\u001f\u007f]/.test(right)) { errors.push('"' + name + '=…" has a control character.'); return; }
      if (right.length > VALUE_MAX) { errors.push('"' + name + '=…": a fixed value can be at most ' + VALUE_MAX + ' characters.'); return; }
      entries.push({ name: name, source: 'value', value: right });
    });
    return { entries: entries, errors: errors };
  }

  /* A child as callers have it: its parsed map, or (as PF.run's older callers pass) just its list of run details. */
  function childOf(x) { return Array.isArray(x) ? { meta: { context: x, detailTypes: {} } } : x; }
  function childNames(childMap) { return (childMap && childMap.meta && childMap.meta.context) || []; }
  function childKinds(childMap) { return (childMap && childMap.meta && childMap.meta.detailTypes) || {}; }

  /* One row per child detail, in the child's order: { name, kind, source: detail | value | ask, from, value, childSets }, and
     stale: names carry: or pass: give that the child doesn't have ({ name, where }). parentNames: this checklist's context. */
  function rows(step, parentNames, childMap) {
    childMap = childOf(childMap);
    var names = childNames(childMap), kinds = childKinds(childMap), sets = childMap && childMap.phases ? PF.map.setBy(childMap) : {};
    var carry = carryList(step), byName = Object.create(null), pe = parse((step.fields || {}).pass).entries, out = [], stale = [];
    pe.forEach(function (e) { byName[e.name] = e; });
    names.forEach(function (n) {
      var e = byName[n], r = { name: n, kind: own(kinds, n) && kinds[n] ? kinds[n].kind || 'text' : 'text' };
      if (e) { r.source = e.source; if (e.source === 'detail') r.from = e.from; if (e.source === 'value') r.value = e.value; }
      else if (carry.length) { if (carry.indexOf(n) >= 0) { r.source = 'detail'; r.from = n; } else r.source = 'ask'; }
      else if ((parentNames || []).indexOf(n) >= 0) { r.source = 'detail'; r.from = n; }
      else r.source = 'ask';
      if (own(sets, n)) r.childSets = true;
      out.push(r);
    });
    carry.forEach(function (n) { if (names.indexOf(n) < 0) stale.push({ name: n, where: 'carry' }); });
    pe.forEach(function (e) { if (names.indexOf(e.name) < 0) stale.push({ name: e.name, where: 'pass' }); });
    return { rows: out, stale: stale };
  }

  function entryText(r) { return r.name + '=' + (r.source === 'ask' ? '?' : r.source === 'value' ? r.value : '^' + r.from); }
  /* The carry: and pass: lines (null: no line) whose meaning is exactly `want` (rows as rows() gives them), as short as it can
     be: an explicit carry: list is kept and grows or shrinks by same-name sources; without one, same-name sources stay
     implicit. An explicit list that would be emptied is dropped, and every other shared name is asked with name=?, since an
     empty carry: passes everything shared. Stale names stay where they are (only Remove takes them out). */
  function write(want, step, parentNames, childMap) {
    childMap = childOf(childMap);
    var cur = carryList(step), names = childNames(childMap), old = rows(step, parentNames, childMap);
    var staleCarry = old.stale.filter(function (s) { return s.where === 'carry'; }).map(function (s) { return s.name; });
    var stalePass = parse((step.fields || {}).pass).entries.filter(function (e) { return names.indexOf(e.name) < 0; });
    var order = parse((step.fields || {}).pass).entries.map(function (e) { return e.name; });
    var byName = Object.create(null);
    (want || []).forEach(function (r) { byName[r.name] = r; });
    var shared = function (n) { return (parentNames || []).indexOf(n) >= 0; };
    var sameName = function (r) { return r.source === 'detail' && r.from === r.name; };
    var pass = [], carry = null;
    var listed = names.filter(function (n) { return byName[n] && sameName(byName[n]); });
    if (cur.length && (listed.length || staleCarry.length)) {
      carry = cur.filter(function (n) { return listed.indexOf(n) >= 0 || staleCarry.indexOf(n) >= 0; });
      listed.forEach(function (n) { if (carry.indexOf(n) < 0) carry.push(n); });
      names.forEach(function (n) { var r = byName[n]; if (r && !sameName(r) && r.source !== 'ask') pass.push(r); });
    } else {
      names.forEach(function (n) {
        var r = byName[n]; if (!r) return;
        if (sameName(r) && shared(n)) return;
        if (r.source === 'ask' && !shared(n)) return;
        pass.push(r);
      });
    }
    pass.sort(function (a, b) { var i = order.indexOf(a.name), j = order.indexOf(b.name); return (i < 0 ? 1e6 + names.indexOf(a.name) : i) - (j < 0 ? 1e6 + names.indexOf(b.name) : j); });
    /* A step with a pass: line keeps one while anything is asked: without it the child starts with no form (as before 2.8).
       The names it already listed are kept; with none of them left, every asked one. */
    if (has(step) && !pass.length && !stalePass.length) {
      var asked = names.filter(function (n) { return byName[n] && byName[n].source === 'ask'; }), was = asked.filter(function (n) { return order.indexOf(n) >= 0; });
      (was.length ? was : asked).forEach(function (n) { pass.push(byName[n]); });
    }
    var text = pass.map(entryText).concat(stalePass.map(entryText));
    return { carry: carry && carry.length ? carry.join(', ') : null, pass: text.length ? text.join(', ') : null };
  }

  /* The values a child starts with, by the child's names: each detail source's value in this run (if the run has it at all,
     as before 2.8), and each fixed value. Asked ones are the start form's. */
  function values(r, step, childMap) {
    var out = {}, d = (r && r.details) || {};
    rows(step, Object.keys(d), childMap).rows.forEach(function (x) {
      if (x.source === 'detail' && own(d, x.from)) out[x.name] = d[x.from] || '';
      else if (x.source === 'value') out[x.name] = x.value;
    });
    return out;
  }
  /* The parent details the child is started from (each detail source once). Implicit names pass: overrides aren't. */
  function sources(step, parentNames, childMap) {
    var out = [];
    rows(step, parentNames, childMap).rows.forEach(function (x) { if (x.source === 'detail' && out.indexOf(x.from) < 0) out.push(x.from); });
    return out;
  }
  /* The snapshot a child counts for, by the parent's names: its sources and the step's ties, less what the step sets. */
  function inputs(r, step, parentNames, childMap) {
    var d = (r && r.details) || {}, sets = String((step.fields || {}).sets || '').split(',').map(function (k) { return k.trim(); }), out = {};
    sources(step, parentNames, childMap).concat(step.binds || []).forEach(function (k) { if (sets.indexOf(k) < 0 && own(d, k)) out[k] = d[k] || ''; });
    return out;
  }

  /* M.check's opts.children from the processes as the app lists them ({ latest, all, clashes, broken }, or { unlisted }):
     an object by name (just read from the folder, when publishing) or a lookup function (the app's, while editing). A
     version: pin that can't be resolved is left to the pin's own blocker. */
  function childrenFrom(procs) {
    var get = typeof procs === 'function' ? procs : function (n) { return own(procs, n) ? procs[n] : null; };
    return function (process, version) {
      var proc = process ? get(process) : null;
      if (!proc) return { unpublished: true };
      if (proc.unlisted) return { unreadable: String(proc.unlisted).replace(/\.?$/, '.') };
      var pub, latest = version === '' || version == null;
      if (latest) pub = proc.latest;
      else { var got = PF.pins.atVersion(proc, process, +version); if (got.why) return null; pub = got.pub; }
      if (!pub || !pub.map) {
        /* Versions are there but none can be used (a damaged publication record): not "unpublished", it can't be checked. */
        var bad = latest && (proc.broken || []).length ? proc.broken[0] : null;
        if (bad) return { unreadable: 'No version of ' + process + ' can be used: ' + String(bad.why || 'its publication can\'t be read').replace(/\.?$/, '.') };
        return { unpublished: true };
      }
      return { map: pub.map, title: pub.map.meta.title || process, version: pub.info.version, latest: latest };
    };
  }

  /* The linked steps whose child, as it is now, can't be started from this checklist (C3): every {run.process} step of the
     map that follows the child's latest (no version: line; a pinned version never changes) and names, in carry: or pass:,
     a detail that latest lacks. A detail passed only because both share it just drops out, so it never counts. children:
     M.check's opts.children (childrenFrom). Returns [{ step, child, title, version, names }]. */
  function broken(map, children) {
    var out = [];
    if (!map || typeof children !== 'function') return out;
    PF.map.steps(map).forEach(function (x) {
      var s = x.step, f = s.fields || {};
      if (s.type !== 'run.process' || !f.process || own(f, 'version')) return;
      var got = children(f.process, '');
      if (!got || !got.map) return;
      var st = rows(s, map.meta.context, got.map).stale;
      if (st.length) out.push({ step: s, child: f.process, title: got.title, version: got.version, names: st.map(function (y) { return y.name; }) });
    });
    return out;
  }
  /* The same, from the child's side: published checklists (procs: [{ id, latest }]) whose latest has a step following
     childMap's process at its latest that childMap couldn't start. Returns [{ process, title, step, names }]. */
  function parentsBroken(childMap, procs) {
    var me = childMap && childMap.meta && childMap.meta.process, out = [];
    if (!me) return out;
    var mine = function (n) { return n === me ? { map: childMap, title: childMap.meta.title || me, version: null } : null; };
    (procs || []).forEach(function (p) {
      if (!p || !p.latest || !p.latest.map || p.id === me) return;
      broken(p.latest.map, mine).forEach(function (b) { out.push({ process: p.id, title: p.latest.map.meta.title || p.id, step: b.step, names: b.names }); });
    });
    return out;
  }

  /* What a step uses and sets, for the builder (Part G): uses: [{ name, where }] (where: "set by …" or "asked when a run
     starts"), from its boxes' ^refs, its ties, its conditions and what it passes its child; sets: its sets: names; passes:
     its rows when the child is known; shared: true when there's no child map and no carry:, so the details it shares by
     name can't be listed yet. */
  function io(map, step, childMap, opts) {
    var src = PF.refs.sources(map), uses = [], seen = Object.create(null);
    var use = function (n) { if (!n || seen[n]) return; seen[n] = true; uses.push({ name: n, where: PF.refs.where(src, n) }); };
    PF.refs.scan(map, opts).forEach(function (t) { if (t.where.step === step && t.where.box !== 'pass') use(t.name); });
    (step.binds || []).forEach(use);
    var x = PF.map.steps(map).filter(function (y) { return y.step === step; })[0];
    PF.conditions.names(x ? map.phases[x.phaseIndex] : null, step).forEach(use);
    var passes = null, shared = false;
    if (step.type === 'run.process') {
      if (childMap) { passes = rows(step, map.meta.context, childMap).rows; passes.forEach(function (r) { if (r.source === 'detail') use(r.from); }); }
      else {
        carryList(step).forEach(use);
        parse((step.fields || {}).pass).entries.forEach(function (e) { if (e.source === 'detail') use(e.from); });
        shared = !carryList(step).length;
      }
    }
    var sets = String((step.fields || {}).sets || '').split(',').map(function (k) { return k.trim(); }).filter(Boolean);
    return { uses: uses, sets: sets, passes: passes, shared: shared };
  }

  return { io: io, childrenFrom: childrenFrom, broken: broken, parentsBroken: parentsBroken, MAX: MAX, VALUE_MAX: VALUE_MAX, has: has, parse: parse, rows: rows, write: write, values: values, sources: sources, inputs: inputs, carryList: carryList };
})();
