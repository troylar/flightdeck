/* Keep for next time (4.0 slice 5, docs/design.md 45.3): a to-do or a spread on a living run, kept as a suggestion for the
   checklist it came from. One nonblocking structured correction request: a record in proposals/ (kind "keep",
   flightdeck-plan/4), written once, never applied. It changes no work, holds no gate and needs no resolution; the run goes on
   exactly as before. Pure: no files, no clocks.

   A keep names the governing checklist's exact publication (process, folder, version and its two fingerprints), the place
   the new step goes (anchor: a phase, and the step it goes after, or the end of the phase), what that place said then (base),
   and the change: a missing step, in the to-do's words or the person's. Item work (a to-do on a loop's item, a spread)
   teaches the checklist the items run (the child); phase and step work teaches the run's own checklist (the parent). When
   that place can't be told (an item's to-do says nothing about where in the child it goes, the child's version can't be
   read), the keep says why it needs placement and is never guessed onto another checklist.

   Keeps join the corrections of their checklist (PF.corrections): one group per checklist and place, every source kept in
   it, different wording kept as alternatives the owner chooses between. They are reviewed, applied to a draft and published
   through the same decisions, draft application and publication proof as any correction, and only the checklist's active
   owner (PF.skills.signer) decides them. */
PF.learn = (function () {
  'use strict';
  var LIMITS = { text: 2000, reason: 300, needs: 300 };
  var REQ = /^req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24}$/, TD = /^td-[0-9a-f]{24}$/, SP = /^sp-[0-9a-f]{24}$/, H8 = /^[0-9a-f]{8}$/;
  var PROC = /^[a-z0-9][a-z0-9-]{0,59}$/, RUN = /^[a-z0-9-]{1,40}$/i, STEP = /^[a-z0-9][a-z0-9-]{0,59}$/i, PERSON = /^[A-Za-z0-9_.-]{1,80}$/;
  var TOOL = /^[a-z0-9][a-z0-9-]{0,29}$/, VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/, FOLDER = /^v([1-9][0-9]{0,8})-[a-z0-9]{1,40}$/;
  var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/, CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
  var KEYS = ['format', 'features', 'app', 'kind', 'id', 'run', 'by', 'producer', 'key', 'at', 'source', 'template', 'anchor', 'base', 'change', 'needs', 'reason'];
  var LABEL = { open: 'Suggested', applied: 'Applied to draft' };

  function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function hex(v) { return PF.sha256.hex(JSON.stringify(v)); }
  function norm(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  function only(o, keys, what, errors) { Object.keys(o).forEach(function (k) { if (keys.indexOf(k) < 0) errors.push(what + ' has "' + String(k).slice(0, 70) + '".'); }); }
  function line(v, max, what, errors) {
    if (typeof v !== 'string' || !v.trim()) { errors.push(what + ' is text.'); return null; }
    if (v.length > max) { errors.push(what + ' is ' + v.length + ' characters; the most is ' + max + '.'); return null; }
    if (CONTROL.test(v)) { errors.push(what + ' has a line break or another control character.'); return null; }
    return v;
  }
  /* A new step's text as a checklist line can hold it (PF.corrections' rule): no @roles, ^details or {#ids}, never cut. */
  function stepTextWhy(t) {
    if (!norm(t)) return 'Say what the missing step is.';
    if (norm(t).length > LIMITS.text) return 'A step is at most ' + LIMITS.text + ' characters (this is ' + norm(t).length + '). Nothing was cut.';
    if (/\{#/.test(t) || /(^|\s)[@^][\w-]/.test(t)) return 'Leave out @roles, ^details and {#ids}: a checklist line would read them as its own. Say it in plain words with --text.';
    return '';
  }

  /* ---- Names. A keep is named by what it keeps, where and in which words (spacing aside), never by who or when: the same
     to-do kept for the same place in the same words, by a person or any tool, is one file. Kept for another place it is
     another, and so is another wording of it: an alternative in the same group, for the owner to choose between. ---- */
  function sourceKey(s) { return s.todo ? 'todo:' + s.todo : 'spread:' + s.spread; }
  function anchorKey(a) { return a ? a.phase + '/' + (a.after || '') : ''; }
  function hashOf(run, source, template, anchor, text) { return hex(['keep', run.process, run.id, sourceKey(source), template ? template.process : '', anchorKey(anchor), norm(text)]).slice(0, 24); }
  function idFor(run, source, template, anchor, text) { return 'req-keep-' + hashOf(run, source, template, anchor, text); }
  function keyFor(run, source, template, anchor, text) { return 'kp-' + hashOf(run, source, template, anchor, text); }

  /* A phase as a place for a new step: its steps, each with its signature. A phase that gains, loses or changes a step since
     the run's version is another place. */
  function phaseSig(map, phase) {
    var p = map && (map.phases || []).filter(function (x) { return x.id === phase; })[0];
    if (!p) return '';
    return PF.util.hash('phase|' + p.steps.map(function (s) { return s.id + ':' + PF.corrections.stepSig(map, s.id); }).join(','));
  }

  /* ---- Reading. ---- */
  function cleanTemplate(v, errors) {
    if (!isMap(v)) { errors.push('"template" is {"process", "folder", "version", "mapHash", "typesHash"}.'); return null; }
    var n0 = errors.length;
    only(v, ['process', 'folder', 'version', 'mapHash', 'typesHash'], '"template"', errors);
    if (typeof v.process !== 'string' || !PROC.test(v.process)) errors.push('"template" "process" is a checklist id.');
    var m = typeof v.folder === 'string' ? FOLDER.exec(v.folder) : null;
    if (!m) errors.push('"template" "folder" is a version folder, like v3-k3m9p2q8.');
    else if (typeof v.version !== 'number' || v.version !== +m[1]) errors.push('"template" "version" is its folder\'s version number.');
    if (typeof v.mapHash !== 'string' || !H8.test(v.mapHash) || typeof v.typesHash !== 'string' || !H8.test(v.typesHash)) errors.push('"template" names its version\'s two fingerprints ("mapHash", "typesHash").');
    return errors.length > n0 ? null : { process: v.process, folder: v.folder, version: v.version, mapHash: v.mapHash, typesHash: v.typesHash };
  }
  function cleanAnchor(v, errors) {
    if (!isMap(v)) { errors.push('"anchor" is {"phase": <phase id>, "after": <step id>?}.'); return null; }
    var n0 = errors.length;
    only(v, ['phase', 'after'], '"anchor"', errors);
    if (typeof v.phase !== 'string' || !STEP.test(v.phase)) errors.push('"anchor" "phase" is a phase id.');
    if (v.after != null && (typeof v.after !== 'string' || !STEP.test(v.after))) errors.push('"anchor" "after" is a step id.');
    if (errors.length > n0) return null;
    var out = { phase: v.phase }; if (v.after != null) out.after = v.after;
    return out;
  }
  function cleanSource(v, errors) {
    if (isMap(v) && Object.keys(v).length === 1 && typeof v.todo === 'string' && TD.test(v.todo)) return { todo: v.todo };
    if (isMap(v) && Object.keys(v).length === 1 && typeof v.spread === 'string' && SP.test(v.spread)) return { spread: v.spread };
    errors.push('"source" is {"todo": <to-do id>} or {"spread": <spread id>}.'); return null;
  }
  /* A keep record read back (PF.todos.cleanFile hands it over once the format and feature are checked): { ok, record } or a
     refusal. Every field is checked whole; anything over a limit is refused, never cut. */
  function cleanFile(o, name, mal) {
    if (typeof o.id !== 'string' || !REQ.test(o.id)) return mal('is a keep without a request id');
    if (typeof name === 'string' && !PF.todos.requestFile(name, o.id)) return mal('is a keep whose name isn\'t its id');
    var errors = [];
    only(o, KEYS, 'It', errors);
    var r = { id: o.id, kind: 'keep', run: null, by: null, at: '', source: null, template: null, anchor: null, base: '', change: null, needs: '', reason: '' };
    var run = o.run;
    if (!isMap(run) || Object.keys(run).length !== 2 || typeof run.process !== 'string' || !PROC.test(run.process) || typeof run.id !== 'string' || !RUN.test(run.id)) errors.push('"run" is {"process": <checklist>, "id": <run id>}.');
    else r.run = { process: run.process, id: run.id };
    if (o.producer != null) {
      var p = o.producer;
      if (!isMap(p) || Object.keys(p).length !== 2 || typeof p.name !== 'string' || !TOOL.test(p.name) || typeof p.version !== 'string' || !VERSION.test(p.version)) errors.push('"producer" is {"name": <tool>, "version": <its version>}.');
      else r.by = { tool: p.name, version: p.version };
      if (o.by != null) errors.push('A tool\'s keep has no "by".');
    } else if (typeof o.by !== 'string' || !PERSON.test(o.by)) errors.push('"by" is the ID from people.json of the person who kept it.');
    else { r.by = { person: o.by }; if (o.key != null) errors.push('Only a tool\'s keep has a "key".'); }
    if (typeof o.at !== 'string' || !ISO.test(o.at)) errors.push('"at" is a date and time.'); else r.at = o.at;
    r.source = cleanSource(o.source, errors);
    if (o.template != null) r.template = cleanTemplate(o.template, errors);
    if (o.anchor != null) r.anchor = cleanAnchor(o.anchor, errors);
    var ch = o.change;
    if (!isMap(ch)) errors.push('"change" is {"op": "add", "text", "where"}.');
    else {
      only(ch, ['op', 'text', 'where'], '"change"', errors);
      if (ch.op !== 'add') errors.push('"change" "op" is add: a keep suggests a missing step.');
      var t = line(ch.text, LIMITS.text, '"change" "text"', errors);
      if (t && stepTextWhy(t)) errors.push('"change" "text" ' + stepTextWhy(t).charAt(0).toLowerCase() + stepTextWhy(t).slice(1));
      if (ch.where !== 'after' && ch.where !== 'end') errors.push('"change" "where" is after or end.');
      else if (o.anchor != null && (ch.where === 'after') !== (isMap(o.anchor) && o.anchor.after != null)) errors.push('"change" "where" is after exactly when "anchor" names a step.');
      else if (o.anchor == null && ch.where !== 'end') errors.push('"change" "where" is end while it needs placement.');
      if (t) r.change = { op: 'add', text: t, where: ch.where };
    }
    /* Placed: a checklist, a place and what that place said then. Not placed: why, and no place guessed. */
    if (o.anchor != null) {
      if (o.template == null) errors.push('A placed keep names its checklist ("template").');
      if (typeof o.base !== 'string' || !H8.test(o.base)) errors.push('"base" is the signature of its place as the run\'s version had it.'); else r.base = o.base;
      if (o.needs != null) errors.push('A placed keep has no "needs".');
    } else {
      if (o.base != null) errors.push('Only a placed keep has a "base".');
      var nd = line(o.needs, LIMITS.needs, '"needs" (why it needs placement)', errors); if (nd) r.needs = nd;
    }
    if (o.reason != null) { var rs = line(o.reason, LIMITS.reason, '"reason"', errors); if (rs) r.reason = rs; }
    if (!errors.length && o.id !== idFor(r.run, r.source, r.template, r.anchor, r.change.text)) errors.push('Its id isn\'t the one its run, source, place and wording give.');
    if (!errors.length && r.by.tool && o.key !== keyFor(r.run, r.source, r.template, r.anchor, r.change.text)) errors.push('Its key isn\'t the one its run, source, place and wording give.');
    if (errors.length) return mal('is a keep that isn\'t in its format: ' + errors[0]);
    return { ok: true, record: r };
  }
  /* A keep as it is filed. o: { run, by (person) | producer: { name, version }, at, app, source, template, anchor, base, change,
     needs, reason }. */
  function build(o) {
    var f = { format: PF.todos.FORMAT, features: [PF.todos.FEATURE] };
    if (PF.envelope.semver(o.app)) f.app = o.app;
    f.kind = 'keep'; f.id = idFor(o.run, o.source, o.template || null, o.anchor || null, o.change.text); f.run = { process: o.run.process, id: o.run.id };
    if (o.producer) { f.producer = { name: o.producer.name, version: o.producer.version }; f.key = keyFor(o.run, o.source, o.template || null, o.anchor || null, o.change.text); } else f.by = o.by;
    f.at = o.at; f.source = o.source;
    if (o.template) f.template = o.template;
    if (o.anchor) { f.anchor = o.anchor; f.base = o.base; }
    f.change = { op: 'add', text: o.change.text, where: o.change.where };
    if (!o.anchor) f.needs = o.needs;
    if (o.reason) f.reason = o.reason;
    return f;
  }
  /* OneDrive's identical copies of one keep (" (1)", "-COMPUTER", the same record under another name) are one keep, under
     its own name when that copy is there: before retry checks, grouping and the 500 count (QD). Copies that differ are all
     kept, so the retry and the place stay refused as before. Every other record is untouched. */
  function canon(x) { return JSON.stringify(x, function (k, v) { return k.charAt(0) === '_' ? undefined : v; }); }
  function oneCopy(records) {
    var seen = Object.create(null), out = [];
    (records || []).forEach(function (x) {
      if (!x || x.kind !== 'keep' || typeof x.id !== 'string') { out.push(x); return; }
      var sig = canon(x), e = seen[x.id];
      if (!e) { seen[x.id] = { sigs: [sig], at: out.length }; out.push(x); return; }
      if (e.sigs.indexOf(sig) >= 0) { if (x._file === x.id + '.json' && canon(out[e.at]) === sig) out[e.at] = x; return; }
      e.sigs.push(sig); out.push(x);
    });
    return out;
  }
  function keepsOf(records) { return oneCopy(records).filter(function (x) { return x && x.kind === 'keep'; }); }
  /* Every file of one keep (QE): its own name and each OneDrive copy the reader read. same is false when they differ. */
  function copiesOf(records, id) {
    var all = (records || []).filter(function (x) { return x && x.kind === 'keep' && x.id === id && typeof x._file === 'string'; });
    return { files: all.map(function (x) { return x._file; }), same: all.every(function (x) { return canon(x) === canon(all[0]); }) };
  }

  /* ---- Where it goes. Item work (a to-do on a loop's item, a spread) teaches the checklist the items run; phase and step
     work the run's own. Returns { template, map, anchor, base, where } or { needs, template? } (never a guessed place). ---- */
  function ownTemplate(r) { return { process: r.process, folder: r.folder, version: +r.version, mapHash: r.mapHash, typesHash: r.typesHash }; }
  function templateOk(t) { var e = []; return !!cleanTemplate(t, e); }
  function childOf(r, map, loopStep, procOf) {
    var x = map ? PF.map.findStep(map, loopStep) : null;
    if (!x || x.step.type !== 'for.each') return { why: 'its loop step ' + loopStep + ' isn\'t in this run\'s checklist' };
    var name = String(PF.run.fieldsOf(r, x.step).process || '');
    if (!name) return { why: 'loop ' + loopStep + ' names no checklist for its items' };
    var c = procOf ? PF.pins.childTarget(r, x.step, procOf) : { why: 'the checklist its items run can\'t be read here' };
    if (!c.pub && procOf) { var rf = readFailure(r, x.step, name, procOf(name)); if (rf) return { held: rf }; }
    if (!c.pub || c.legacy) return { why: 'the checklist its items run (' + name + ') can\'t be used here: ' + String(c.why || 'it isn\'t published').replace(/\.$/, '') };
    var i = c.pub.info, t = c.pin ? { process: name, folder: c.pin.folder, version: c.pin.version, mapHash: c.pin.mapHash || i.mapHash, typesHash: c.pin.typesHash || i.typesHash } : { process: name, folder: i.folder, version: i.version, mapHash: i.mapHash, typesHash: i.typesHash };
    if (!templateOk(t)) return { why: 'the checklist its items run (' + name + ') has no exact version here' };
    return { template: t, map: c.pub.map };
  }
  /* Why the checklist a loop's items run can't be read at all ('' when it can): its folder that can't be listed, or the
     version that counts (the pinned one, or any while none is pinned) failing to read. A read failure is never a reason to
     place a keep elsewhere or call it needing placement: the keep is held, naming the path and its kind. */
  function readFailure(r, step, name, proc) {
    if (!proc) return '';
    if (proc.unlisted) return 'The checklist its items run can\'t be read here: publications/' + name + '/ (unreadable): ' + String(proc.unlisted).replace(/\.$/, '') + '.';
    var pin = r.pins && isMap(r.pins.children) && Object.prototype.hasOwnProperty.call(r.pins.children, step.id) ? r.pins.children[step.id] : null;
    var bad = (proc.all || []).concat(proc.broken || []).filter(function (p) { return p && p._readFailed && (!pin || p.folder === pin.folder); })[0];
    return bad ? 'The checklist its items run can\'t be read here: publications/' + name + '/' + bad.folder + '/ (unreadable): ' + String(bad.why || 'it didn\'t read').replace(/\.$/, '') + '.' : '';
  }
  /* A place inside a checklist (map): o.place { phase } (the end of a phase) or { after } (after a step). */
  function placeIn(map, place) {
    if (place.after) {
      var x = PF.map.findStep(map, place.after);
      if (!x) return { why: 'step ' + place.after + ' isn\'t in that checklist' };
      return { anchor: { phase: x.phase.id, after: x.step.id }, where: 'after', base: PF.corrections.stepSig(map, x.step.id) };
    }
    if (!map.phases.some(function (p) { return p.id === place.phase; })) return { why: 'phase ' + place.phase + ' isn\'t in that checklist' };
    return { anchor: { phase: place.phase }, where: 'end', base: phaseSig(map, place.phase) };
  }
  function route(r, map, T, source, o) {
    o = o || {};
    var place = o.place || null, tpl = null, tmap = null, at = null;
    if (source.spread) {
      var sp = T.bySpread[source.spread];
      var c = childOf(r, map, sp.loopStep, o.procOf);
      if (c.held) return { why: c.held, held: true };
      if (c.why) return { needs: 'It is a requirement on every item of a loop, so it belongs to the checklist those items run, but ' + c.why + '.' };
      tpl = c.template; tmap = c.map;
      var gp = PF.spreads.phaseOfGate(tmap, sp.child.beforeGate);
      at = place || (gp ? { phase: gp.id } : null);
      if (!at) return { needs: 'Its gate ' + sp.child.beforeGate + ' isn\'t in ' + tpl.process + ' v' + tpl.version + ', so where it goes there can\'t be told. Say where with --phase or --after.', template: tpl };
    } else {
      var x = T.byTodo[source.todo], t = x.target;
      if (t.item) {
        var ci = childOf(r, map, t.item.loopStep, o.procOf);
        if (ci.held) return { why: ci.held, held: true };
        if (ci.why) return { needs: 'It is work on one item of a loop, so it belongs to the checklist the items run, but ' + ci.why + '.' };
        tpl = ci.template; tmap = ci.map;
        if (!place) return { needs: 'It is work on one item of loop ' + t.item.loopStep + ', so it belongs to ' + tpl.process + ', but the to-do doesn\'t say where in that checklist it goes. Say where with --phase or --after.', template: tpl };
        at = place;
      } else {
        tpl = ownTemplate(r); tmap = map;
        if (!templateOk(tpl)) return { needs: 'This run\'s own version can\'t be named exactly here, so where it goes can\'t be told.' };
        at = place || (t.step ? { after: t.step } : { phase: t.phase });
      }
    }
    var P = placeIn(tmap, at);
    if (P.why) return { why: 'It can\'t be placed in ' + tpl.process + ' v' + tpl.version + ': ' + P.why + '.' };
    return { template: tpl, map: tmap, anchor: P.anchor, base: P.base, where: P.where };
  }

  /* ---- Keeping (flightdeck todo keep, spread keep, and Keep for next time on the run screen): the record a keep would file,
     or why nothing can be. o: { source: { todo } | { spread }, text, reason, place: { phase } | { after }, by: { person } |
     { tool, version }, records, unread, people, procOf, at, app, now }. Returns { why } (held: true while what it rests on
     can't be read; taken: true when its name holds something else), or { id, name, file, record, status: 'new' | 'already',
     preview: { placed, template, anchor, where, words } }. Nothing is written here. ---- */
  function prepare(r, o) {
    o = o || {};
    var map = null; try { map = PF.run.mapOf(r); } catch (e) { map = null; }
    if (!map) return { why: 'This run\'s checklist can\'t be read, so nothing can be kept from it.' };
    if (r._unrunnable) return { why: 'This run can only be read here.' };
    var by = o.by || {};
    if (!by.person && !by.tool) return { why: 'Say who keeps it: a person in people.json, or a tool.' };
    if (by.person && !PERSON.test(String(by.person))) return { why: 'Who keeps it is the ID from people.json of that person.' };
    var deps = o.deps || { records: o.records || [], unread: o.unread || [] };
    var T = PF.todos.view(r, { records: PF.todos.recordsFor(o.records, r), unread: (o.unread || []).filter(function (u) { return u && (!u.run || (u.run.process === r.process && u.run.id === r.id)); }), people: o.people, deps: deps, now: o.now });
    if (T.broken || T.unread.length || T.held.length) return { why: 'This run\'s to-do records can\'t all be read in order here, so what would be kept isn\'t known.', held: true };
    var s = o.source || {}, source = null, text = '';
    if (typeof s.todo === 'string') { var x = T.byTodo[s.todo]; if (!x) return { why: 'That to-do isn\'t in this run.' }; source = { todo: x.id }; text = x.text; }
    else if (typeof s.spread === 'string') { var sp = T.bySpread[s.spread]; if (!sp) return { why: 'That spread isn\'t on this run.' }; source = { spread: sp.id }; text = sp.text; }
    else return { why: 'Say what to keep: a to-do or a spread.' };
    if (o.text != null) text = String(o.text);
    var tw = stepTextWhy(text);
    if (tw) return { why: tw };
    text = norm(text);
    var reason = o.reason == null ? '' : norm(o.reason);
    if (reason.length > LIMITS.reason) return { why: 'A reason is at most ' + LIMITS.reason + ' characters (this is ' + reason.length + '). Nothing was cut.' };
    var place = null;
    if (o.place) {
      if (o.place.after != null) { if (typeof o.place.after !== 'string' || !STEP.test(o.place.after)) return { why: 'Say the step it goes after by its id.' }; place = { after: o.place.after }; }
      else if (o.place.phase != null) { if (typeof o.place.phase !== 'string' || !STEP.test(o.place.phase)) return { why: 'Say the phase it goes at the end of by its id.' }; place = { phase: o.place.phase }; }
    }
    var W = route(r, map, T, source, { procOf: o.procOf, place: place });
    if (W.held) return { why: W.why + ' Nothing is kept until it can be read.', held: true };
    if (W.why) return { why: W.why };
    var needs = W.needs || '';
    if (needs.length > LIMITS.needs) needs = 'Where it goes in the checklist can\'t be told here.';
    var f = build({ run: r, by: by.person, producer: by.tool ? { name: by.tool, version: by.version || '0' } : null, at: o.at, app: o.app, source: source, template: W.template || null, anchor: W.anchor || null, base: W.base,
      change: { text: text, where: W.anchor ? W.where : 'end' }, needs: needs, reason: reason });
    var name = f.id + '.json';
    var prior = oneCopy(o.records).filter(function (y) { return y && y.id === f.id; });
    if (prior.length) {
      if (prior.length > 1 || prior[0].kind !== 'keep') return { why: 'Something else is already filed under this keep\'s name (proposals/' + name + ').', taken: true };
      var a = prior[0];
      if (norm(a.change.text) !== text || (a.reason || '') !== reason) return { why: 'It was already kept for this place in these words, with another reason (proposals/' + name + '). A keep is filed once; keep it in other words for another alternative.', taken: true };
      return { id: f.id, name: name, status: 'already', record: a, preview: previewOf(a) };
    }
    if ((o.unread || []).some(function (u) { return u && u.file === name; })) return { why: 'A keep under this name is in the folder but can\'t be read yet.', held: true };
    var fd = PF.todos.filed(name, f);
    if (fd.why) return { why: fd.why };
    /* A group of keeps holds at most the members one decision can name (PF.corrections.MEMBERS_MAX): the next keep that would
       join a full group is refused here, so its owner can still decide or withdraw it. The decision cap stays as a backstop. */
    if (fd.record.anchor && fd.record.template) {
      var mine = members([fd.record], [], fd.record.template.process)[0], key = mine && groupKey(mine), max = PF.corrections.MEMBERS_MAX;
      var count = key ? members(o.records || [], [], fd.record.template.process).filter(function (m) { return groupKey(m) === key; }).length : 0;
      if (count >= max) return { why: 'This place already has ' + count + ' keeps, the most one correction holds (' + max + '), so nothing was kept. Ask the checklist\'s owner to review the ones there first.' };
    }
    return { id: f.id, name: name, file: f, record: fd.record, status: 'new', preview: previewOf(fd.record) };
  }
  function previewOf(k) {
    var t = k.template, a = k.anchor;
    var words = a ? 'Suggest for next time in ' + t.process + ' v' + t.version + ': add "' + k.change.text + '" ' + (a.after ? 'after step ' + a.after : 'at the end of phase ' + a.phase) + '. The checklist\'s owner reviews it; this run doesn\'t change.' :
      'Kept for next time, but it needs placement: ' + k.needs + ' This run doesn\'t change.';
    return { placed: !!a, template: t || null, anchor: a || null, where: a ? k.change.where : null, needs: k.needs || null, words: words };
  }

  /* ---- Corrections. Each placed keep on a checklist is a member of that checklist's corrections (PF.corrections.forProcess
     takes them), with its source linked: the run, and the to-do or spread. A keep that needs placement is no member: it shows
     on its to-do, never guessed into a checklist. ---- */
  function members(records, runs, pid) {
    var byRun = Object.create(null); (runs || []).forEach(function (r) { if (r && r.process && r.id) byRun[r.process + '/' + r.id] = r; });
    /* Copies of one keep that differ (VA) are one member, never its id twice, carrying every file (copiesDiffer): its
       group decides nothing until one is removed (PF.corrections.decideWhy). */
    var once = Object.create(null);
    return keepsOf(records).filter(function (k) { if (once[k.id]) return false; once[k.id] = true; return true; }).filter(function (k) { return k.anchor && k.template && k.template.process === pid; }).map(function (k) {
      var cp = copiesOf(records, k.id);
      var rk = k.run.process + '/' + k.run.id, r = byRun[rk];
      return { id: k.id, process: pid, run: k.run.id, runKey: rk, runTitle: r ? String(r.title || r.process) : rk, by: k.by.person || k.by.tool, at: k.at, files: [], fileInfo: {}, runEnded: !!(r && r.ended), test: !!(r && PF.run.isTest(r)),
        version: k.template.version, folder: k.template.folder, target: { phase: k.anchor.phase, step: k.anchor.after || null }, change: { op: 'add', text: k.change.text, where: k.change.where },
        from: '', sig: k.base, why: k.reason || '', happened: '', newer: false, keep: { run: { process: k.run.process, id: k.run.id }, source: k.source, record: k.id, template: k.template }, copiesDiffer: cp.same ? null : cp.files.slice() };
    });
  }
  /* Why a group of keeps is held because copies of one of its keeps differ ('' when none do): every file named. */
  function copiesWhy(g) {
    var m = (g && g.keep && g.members || []).filter(function (c) { return c && c.copiesDiffer && c.copiesDiffer.length > 1; })[0];
    return m ? 'Copies of a keep in this correction say different things (' + m.copiesDiffer.map(function (f) { return 'proposals/' + f; }).join(', ') + '), so which one was kept can\'t be told and nothing is decided or applied. Remove the copy that\'s wrong, then look again.' : '';
  }
  /* What a group of keeps groups on: its checklist and place, as that place was, never the wording. */
  function groupKey(c) { return [c.process, 'keep', c.target.step || 'phase:' + c.target.phase, c.change.where, c.sig].join('\n'); }
  /* The wordings a group's members suggested, in the order first suggested: [{ text, members: [ids] }]. */
  function alternatives(g) {
    var out = [], at = Object.create(null);
    g.members.forEach(function (m) { var k = norm(m.change.text); if (!(k in at)) { at[k] = out.length; out.push({ text: m.change.text, members: [] }); } out[at[k]].members.push(m.id); });
    return out;
  }
  /* Why this person can't decide a group of keeps ('' when they can, and for every other correction: nothing changes for
     those). Only the checklist's active owner reviews and publishes what was kept for next time: its owner, or its backup
     while the owner is inactive or gone (PF.skills.signer, on the latest version). Whoever decides is read in people.json,
     listed and active, never assumed: while it can't be read or lists nobody, nobody decides. */
  function ownerWhy(g, proc, people, me, peopleUnread) {
    if (!g || !g.keep) return '';
    var pub = proc && proc.latest;
    if (!pub || !pub.map) return 'Its checklist isn\'t published here, so its owner can\'t be told.';
    if (!me) return 'Choose who you are first.';
    if (peopleUnread || !(people || []).length) return 'people.json can\'t be read here, so whether you are this checklist\'s active owner can\'t be told. Nothing kept for next time is decided until it can.';
    var mine = (people || []).filter(function (p) { return p && p.id === me; })[0];
    if (!mine) return 'You aren\'t listed in people.json, so you can\'t decide what was kept for next time.';
    if (mine.inactive) return 'You are marked inactive in people.json, so you can\'t decide what was kept for next time' + (pub.map.meta.backup && pub.map.meta.owner === me ? '; its backup owner can' : '') + '.';
    if (PF.skills.signer(pub, people, me, false)) return '';
    var o = pub.map.meta.owner, who = ((people || []).filter(function (p) { return p.id === o; })[0] || {}).name || o;
    return 'Only the checklist\'s owner' + (who ? ', ' + who + ',' : '') + ' reviews what was kept for next time' + (pub.map.meta.backup ? ' (or its backup owner while the owner is inactive)' : '') + '.';
  }
  function label(g) { return g.tie ? 'Needs review' : g.landed ? 'Published in v' + g.landed.version : g.status === 'applied' && g.decision && g.decision.addressed ? 'Addressed differently' : LABEL[g.status] || PF.corrections.STATUS[g.status] || 'Suggested'; }
  /* Where a run's to-do or spread stands as kept for next time: { keeps (its records), group, label, words } or null. gs: the
     groups of each checklist it could be kept on (by process). */
  function forSource(records, gsOf, run, source) {
    var mine = keepsOf(records).filter(function (k) { return k.run && k.run.process === run.process && k.run.id === run.id && sourceKey(k.source) === sourceKey(source); });
    if (!mine.length) return null;
    var placed = mine.filter(function (k) { return k.anchor; }), out = { keeps: mine, group: null, process: '', label: '', words: '' };
    if (!placed.length) { out.label = 'Needs placement'; out.words = 'Kept for next time · needs placement: ' + mine[0].needs; return out; }
    var gs = gsOf ? gsOf(placed[0].template.process) || [] : [], groupOf = function (k) { return gs.filter(function (g) { return g.keep && g.members.some(function (m) { return m.id === k.id; }); })[0] || null; };
    /* A wording the owner reviewed stands as it was decided, even while a wording kept since waits for review (PF.corrections
       status: reviewed); one that wasn't reviewed is only Suggested. */
    var seen = function (k) { var g = groupOf(k); return !!(g && g.reviewed && g.reviewed.members.indexOf(k.id) >= 0); };
    var k = placed.filter(seen)[0] || placed[0], g = groupOf(k), landed = null;
    out.group = g; out.process = k.template.process;
    if (g && seen(k)) { landed = g.reviewedLanded || null; out.label = landed ? 'Published in v' + landed.version : g.reviewed.decision.addressed ? 'Addressed differently' : 'Applied to draft'; }
    else { landed = g ? g.landed : null; out.label = g ? label(g) : 'Suggested'; }
    out.words = (landed ? 'Learned: published in ' : out.label === 'Suggested' ? 'Suggested for next time in ' : 'Kept for next time in ') + k.template.process + (landed ? ' v' + landed.version : '') + (g && !landed ? ' · ' + out.label : '') + '.';
    return out;
  }

  /* ---- Kept content in a text about to be published or promoted (one rule for Publish and Promote, read fresh at every
     write): worked out from durable proof, never from the keep records or groups that happen to be visible. A group is a keep
     group when any decision on it names a keep (members, req-keep-*). Its content is in the text when a decision that applied
     it (applied or included, any time, so an explicit Reopen or a later wording never erases it) recorded a result step the
     text has and the version published before it (prev) doesn't, or has with other content that is now the applied one; an
     applied decision without a checkable result can't be told apart, so it counts. R: { decisions, decUnread, keeps,
     keepUnread, listed } read fresh, for pid (listed: the correction IDs the version names). Returns { owner, hold, groups, unclassified }: owner when the checklist's active owner
     must write it; hold (why) when a keep that content rests on is missing or unreadable, for everyone; unclassified when a
     decision on pid can't be read while pid has kept anything, which needs the owner, never no one. ---- */
  var KEEP_ID = /^req-keep-/, GONE_SIG = PF.util.hash('gone');
  /* A version whose correction list (ids: what it will name) is full without a kept group in it can't be shown to include it:
     refused, naming the limit, never published with the keep's proof cut ('' or why). */
  function keptCapWhy(K, ids) {
    var max = PF.corrections.LISTED_MAX, list = (ids || []).map(function (x) { return typeof x === 'string' ? x : x && x.id; });
    if (!K || !K.groups || list.length < max || K.groups.every(function (g) { return list.indexOf(g) >= 0; })) return '';
    return 'this version would list ' + max + ' corrections, the most a version names, and what was kept for next time isn\'t among them, so it can\'t be shown to include it. Publish the other corrections first, then this.';
  }
  function keptIn(text, prev, R, pid) {
    R = R || {};
    var C = PF.corrections, map = null, pmap = null;
    try { map = text == null ? null : PF.map.parse(String(text)); } catch (e) { map = null; }
    try { pmap = prev ? PF.map.parse(String(prev)) : null; } catch (e) { pmap = null; }
    var decs = (R.decisions || []).filter(function (d) { return d && d.process === pid && d.kind === 'correction-decision' && typeof d.group === 'string'; });
    var by = Object.create(null), order = [];
    decs.forEach(function (d) { if (!by[d.group]) { by[d.group] = []; order.push(d.group); } by[d.group].push(d); });
    var keeps = keepsOf(R.keeps), have = Object.create(null); keeps.forEach(function (k) { have[k.id] = true; });
    var unread = Object.create(null); (R.keepUnread || []).forEach(function (u) { var f = String(u && u.file || ''); if (KEEP_ID.test(f)) unread[f.replace(/\.json$/, '')] = true; });
    var out = { owner: false, hold: '', groups: [], unclassified: false };
    var shown = function (d) {
      var r = d.result;
      if (d.addressed || !r || !r.step || !map) return true;
      if (r.sig === GONE_SIG) return false;
      var now = C.stepSig(map, r.step);
      if (!now) return false;
      var before = pmap ? C.stepSig(pmap, r.step) : '';
      return !before || (before !== now && now === r.sig);
    };
    order.forEach(function (gid) {
      /* What kept content rests on is the members of the decisions that applied it to this text (applied or included,
         shown in it): a decline is history only, and a keep withdrawn since is never a dependency (VC). */
      var ds = by[gid], named = [], applying = ds.filter(function (d) { return (d.status === 'applied' || d.status === 'included') && shown(d); });
      if (!ds.some(function (d) { return (d.members || []).some(function (m) { return KEEP_ID.test(m); }); })) return;
      if (!applying.length) return;
      applying.forEach(function (d) { (d.members || []).forEach(function (m) { if (KEEP_ID.test(m) && named.indexOf(m) < 0) named.push(m); }); });
      out.owner = true; out.groups.push(gid);
      var bad = named.filter(function (m) { return unread[m]; }), gone = named.filter(function (m) { return !unread[m] && !have[m]; });
      if (!out.hold && (bad.length || gone.length)) out.hold = 'this version includes what was kept for next time, and a keep it rests on ' + (bad.length ? 'can\'t be read' : 'isn\'t in the folder') + ' (' + bad.concat(gone).slice(0, 3).map(function (m) { return 'proposals/' + m + '.json'; }).join(', ') + '), so who may publish it can\'t be told. Check Folder health, then try again.';
    });
    var kept = order.some(function (gid) { return by[gid].some(function (d) { return (d.members || []).some(function (m) { return KEEP_ID.test(m); }); }); }) ||
      keeps.some(function (k) { return k.template && k.template.process === pid; }) || Object.keys(unread).length > 0;
    if (!out.owner && kept && (R.decUnread || []).some(function (u) { return u && u.process === pid; })) { out.owner = true; out.unclassified = true; }
    /* A correction the version lists (R.listed) with no decision at all can't be told apart from a keep: the owner's. */
    if (!out.owner && (R.listed || []).some(function (x) { var id = typeof x === 'string' ? x : x && x.id; return id && !by[id]; })) { out.owner = true; out.unclassified = true; }
    /* Positive proof (OA): where the checklist has kept anything (a keep or a decision naming one, readable or not, or a
       decision on it that can't be read), someone other than the owner writes only a text whose every change against the
       version before is an ordinary correction's recorded result, read in a readable decision. Lost proof is never
       read as "nothing kept". */
    var keepGroup = Object.create(null);
    order.forEach(function (gid) { if (by[gid].some(function (d) { return (d.members || []).some(function (m) { return KEEP_ID.test(m); }); })) keepGroup[gid] = true; });
    try { C.groups(members(keeps.filter(function (k) { return k.run && k.by && k.anchor; }), [], pid)).forEach(function (g) { keepGroup[g.id] = true; }); } catch (e) { /* a keep that can't be grouped proves nothing */ }
    var traced = kept || Object.keys(keepGroup).length > 0 || (R.decUnread || []).some(function (u) { return u && u.process === pid; });
    if (!out.owner && traced) {
      var proof = decs.filter(function (d) { return !keepGroup[d.group] && (d.status === 'applied' || d.status === 'included') && !d.addressed && d.result; });
      var u = unproven(map, pmap, proof);
      if (u) { out.owner = true; out.unclassified = true; out.unproven = u; }
    }
    /* QA: proof that can't be read (a decision on pid, or any keep record) where the text may rest on it holds for everyone,
       the owner included, before any authority check: nobody publishes past what can't be read. */
    var du = (R.decUnread || []).filter(function (u) { return u && u.process === pid; }), ku = (R.keepUnread || []).filter(Boolean);
    if (!out.hold && (du.length || ku.length) && (kept || out.owner)) {
      var at = du.map(function (u) { return u.path || 'corrections/' + pid + '/' + u._file; }).concat(ku.map(function (u) { return 'proposals/' + u.file; }));
      out.hold = 'this version may include what was kept for next time, and a file that says so can\'t be read (' + at.slice(0, 3).join(', ') + '), so who may publish it can\'t be told, the checklist\'s owner included. Check Folder health, then try again.';
    }
    return out;
  }
  /* The first change in map against pmap no ordinary decision recorded as its result ('' when every change is): a step's
     content new or changed (its recorded step and signature), a step removed (a recorded removal), a phase's or gate's note
     (its recorded note), or anything else about the checklist (its details, phases or gates), which no correction records. */
  function unproven(map, pmap, proof) {
    if (!map) return 'its text can\'t be read';
    var C = PF.corrections, M = PF.map, has = function (step, sig) { return proof.some(function (d) { return d.result.sig === sig && (d.result.step === step || (sig === GONE_SIG && !d.result.step)); }); };
    var now = M.steps(map), before = pmap ? M.steps(pmap) : [], ids = Object.create(null);
    for (var i = 0; i < now.length; i++) {
      var id = now[i].step.id, s = C.stepSig(map, id); ids[id] = true;
      if (pmap && C.stepSig(pmap, id) === s) continue;
      if (!has(id, s)) return 'step ' + (id || now[i].step.text);
    }
    for (var j = 0; j < before.length; j++) if (!ids[before[j].step.id] && !has(before[j].step.id, GONE_SIG)) return 'the removal of step ' + before[j].step.id;
    var noteOf = function (m, kind, id) { var p = m ? m.phases.filter(function (x) { return (kind === 'gate' ? x.gate && x.gate.id : x.id) === id; })[0] : null; return p ? norm((kind === 'gate' ? p.gate : p).note) : null; };
    var notes = [];
    map.phases.forEach(function (p) { notes.push(['phase', p.id]); if (p.gate) notes.push(['gate', p.gate.id]); });
    for (var k = 0; k < notes.length; k++) {
      var n = noteOf(map, notes[k][0], notes[k][1]);
      if (n === noteOf(pmap, notes[k][0], notes[k][1])) continue;
      if (!proof.some(function (d) { return !d.result.step && d.result.sig === PF.util.hash('note|' + n); })) return 'the note of ' + notes[k][0] + ' ' + notes[k][1];
    }
    var skel = function (m) { return m ? JSON.stringify({ meta: m.meta, phases: m.phases }, function (key, v) { return key === 'steps' || key === 'note' || key === 'noted' || key === 'line' ? undefined : v; }) : ''; };
    if (skel(map) !== skel(pmap)) return 'its details, phases or gates';
    return '';
  }

  return { LIMITS: LIMITS, idFor: idFor, keyFor: keyFor, phaseSig: phaseSig, cleanFile: cleanFile, build: build, keepsOf: keepsOf, copiesOf: copiesOf, copiesWhy: copiesWhy, route: route, prepare: prepare, previewOf: previewOf, stepTextWhy: stepTextWhy,
    members: members, keptIn: keptIn, keptCapWhy: keptCapWhy, groupKey: groupKey, alternatives: alternatives, ownerWhy: ownerWhy, label: label, forSource: forSource, sourceKey: sourceKey };
})();
