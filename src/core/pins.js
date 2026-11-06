/* Pins (2.0, slice 2): the exact versions a run, a linked run, a plan or a skill follows. A pin names a version folder and
   its fingerprints ({ process, version, folder, mapHash, typesHash }). A pin that can't be used is refused with a reason and
   never falls back to the latest: a missing folder, another folder with the same number, two folders with that number, or
   files that don't match what was pinned (docs/design.md section 28). Pure: callers pass what the folder holds.

   proc: a process as the app and readers list it: { latest, all (usable versions), clashes (numbers), broken (versions that
   can't be used here, with why) }. */
PF.pins = (function () {
  'use strict';
  var HASH8 = /^[0-9a-f]{8}$/, STEP = /^[a-z0-9][a-z0-9-]{0,59}$/i, PROC = /^[a-z0-9][a-z0-9-]{0,59}$/;
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function folderOf(x) { return x && (x.info ? x.info.folder : x.folder); }
  function numberOf(x) { var f = folderOf(x); return f ? PF.publish.versionOf(f) : null; }

  /* A pin to a version, as the payload, a run and a plan record it. */
  function of(pub, process) {
    var i = pub.info;
    return { process: process || i.process || (pub.map && pub.map.meta.process), version: i.version, folder: i.folder, mapHash: i.mapHash, typesHash: i.typesHash };
  }
  /* Shapes: a child pin, a skill pin ({ name, version }), and the payload's pins slot. */
  function childOk(p) {
    return isObj(p) && Object.keys(p).every(function (k) { return ['process', 'version', 'folder', 'mapHash', 'typesHash'].indexOf(k) >= 0; }) &&
      typeof p.process === 'string' && PROC.test(p.process) && typeof p.version === 'number' && isFinite(p.version) && p.version >= 1 && p.version <= 9007199254740991 && Math.floor(p.version) === p.version &&
      typeof p.folder === 'string' && PF.publish.versionOf(p.folder) === p.version && typeof p.mapHash === 'string' && HASH8.test(p.mapHash) && typeof p.typesHash === 'string' && HASH8.test(p.typesHash);
  }
  function skillOk(p) {
    return isObj(p) && Object.keys(p).every(function (k) { return k === 'name' || k === 'version'; }) && typeof p.name === 'string' && p.name.length >= 1 && p.name.length <= 80 && p.name.trim() === p.name && !/[\u0000-\u001f]/.test(p.name) && typeof p.version === 'string' && /^\S{1,40}$/.test(p.version);
  }
  function shapeOk(pins) {
    if (!isObj(pins) || Object.keys(pins).some(function (k) { return k !== 'children' && k !== 'skills'; })) return false;
    var c = own(pins, 'children') ? pins.children : {}, s = own(pins, 'skills') ? pins.skills : {};
    if (!isObj(c) || !isObj(s)) return false;
    return Object.keys(c).every(function (k) { return STEP.test(k) && childOk(c[k]); }) && Object.keys(s).every(function (k) { return STEP.test(k) && skillOk(s[k]); });
  }
  function lower(s) { s = String(s || '').replace(/\.\s*$/, ''); return s.charAt(0).toLowerCase() + s.slice(1); }

  /* Every version of a process with that number, usable here or not. */
  function numbered(proc, n) {
    var out = [];
    (proc.all || []).concat(proc.broken || []).forEach(function (x) { if (numberOf(x) === n && out.indexOf(x) < 0) out.push(x); });
    return out;
  }
  /* version: N on a {run.process} step, at publish: the one version numbered N, or why it can't be pinned. */
  function atVersion(proc, process, n) {
    if (!proc) return { why: '"' + process + '" isn\'t published in this folder' };
    if (proc.unlisted) return { why: proc.unlisted };
    var all = numbered(proc, n);
    if (!all.length) return { why: process + ' v' + n + ' isn\'t in this folder' };
    if (all.length > 1) return { why: 'two versions are numbered ' + process + ' v' + n + ' here (' + all.map(folderOf).sort().join(', ') + '); a person has to choose one' };
    if (!all[0].ok) return { why: process + ' v' + n + ' can\'t be used here: ' + lower(all[0].why) };
    return { pub: all[0], pin: of(all[0], process) };
  }
  /* The exact version a pin names, or why it can't be used. Nothing else stands in for it. */
  function find(proc, pin) {
    if (!proc) return { why: 'its checklist isn\'t published in this folder' };
    if (proc.unlisted) return { why: proc.unlisted };
    var n = PF.publish.versionOf(pin.folder), all = numbered(proc, n), mine = all.filter(function (x) { return folderOf(x) === pin.folder; })[0];
    var others = all.filter(function (x) { return x !== mine; });
    if (!mine) return { why: others.length ? 'this folder\'s v' + n + ' is a different version (' + others.map(folderOf).sort().join(', ') + '), not ' + pin.folder : pin.folder + ' isn\'t in this folder', missing: true };
    if (others.length) return { why: 'two versions are numbered v' + n + ' here (' + all.map(folderOf).sort().join(', ') + '); a person has to choose one', clash: true };
    if (!mine.ok) return { why: lower(mine.why) };
    if ((pin.mapHash && mine.info.mapHash !== pin.mapHash) || (pin.typesHash && mine.info.typesHash !== pin.typesHash)) return { why: 'its files don\'t match what was pinned (' + pin.folder + ')', mismatch: true };
    return { pub: mine };
  }

  function titleOf(proc, pin) { var p = proc && proc.latest; return p && p.map && p.map.meta.title ? p.map.meta.title : pin.process; }
  /* Words for a pinned child, on the step: "Runs Check in code v4 (set when this run started)." */
  function words(pin, title, fromPayload) { return 'Runs ' + (title || pin.process) + ' v' + pin.version + ' (set when ' + (fromPayload ? 'this version was published' : 'this run started') + ').'; }
  function unusable(title, pin, why) { return 'This step runs ' + (title || pin.process) + ' v' + pin.version + ', which can\'t be used here: ' + why + '.'; }

  /* The children a run/3 follows, pinned when it starts: the version's own pins (version: on the step), and for every other
     {run.process} step, the latest usable version of its process now. procOf(id): the listed process, or null. */
  function atStart(map, payloadPins, procOf) {
    var out = {}, fixed = payloadPins && isObj(payloadPins.children) ? payloadPins.children : {};
    PF.map.steps(map).forEach(function (x) {
      var s = x.step;
      if (s.type !== 'run.process' || !s.fields.process) return;
      if (own(fixed, s.id)) { out[s.id] = JSON.parse(JSON.stringify(fixed[s.id])); return; }
      var proc = procOf(s.fields.process);
      if (proc && proc.latest) out[s.id] = of(proc.latest, s.fields.process);
    });
    return out;
  }

  /* The version a {run.process} step's child starts on, for its parent run r (PF.run): { pub, pin, first } or { why } and, for
     a run/2 parent whose child would be a /2 version, { legacy: true, why, pub } (it offers a 2.0 run instead).
     run/3: its pin, and only its pin (pinned now, first: true, if the child wasn't published when the run started).
     run/2: the latest, as every 1.x copy does, but never a /2 version (review #1). */
  function childTarget(r, step, procOf) {
    var f = PF.run.fieldsOf(r, step), name = f.process || '', proc = name ? procOf(name) : null;
    if (r.format === PF.run.FORMAT3) {
      var pin = r.pins && isObj(r.pins.children) && own(r.pins.children, step.id) ? r.pins.children[step.id] : null;
      if (!pin) {
        if (!proc || !proc.latest) return { why: '"' + name + '" isn\'t published in this folder yet.' };
        return { pub: proc.latest, pin: of(proc.latest, name), first: true };
      }
      if (pin.process !== name) return { why: unusable(titleOf(proc, pin), pin, 'this step now names ' + (name || 'no process') + ', not ' + pin.process) };
      var got = find(proc, pin);
      if (!got.pub) return { why: unusable(titleOf(proc, pin), pin, got.why) };
      return { pub: got.pub, pin: pin };
    }
    if (!proc || !proc.latest) return { why: '"' + name + '" isn\'t published in this folder yet.' };
    if (proc.latest.info.format === PF.publish.FORMAT2) return { legacy: true, pub: proc.latest, why: legacyWhy(proc.latest, r) };
    return { pub: proc.latest };
  }
  /* Why a run/2 parent can't start or adopt this child, in the plan's words. */
  function legacyWhy(childPub, r) { return (childPub.map.meta.title || childPub.info.process) + ' v' + childPub.info.version + ' needs a run made with Flightdeck 2.0. Start a new run of this checklist on v' + r.version + ' to use it.'; }

  /* The one verdict on whether a child run stands for a step pinned to pin: '' or why not. It's judged against the verified
     publication of the folder the child ran on (procOf(process): that process as the app lists it), never the run's own say:
     the same folder, that folder's publication matching the pin (PF.pins.find: present, the only one with its number, usable,
     the fingerprints pinned), and the child's own record of what it ran matching that publication: its checklist (mapHash,
     and the snapshot's hash), its step types (typesHash where it records one, as every run/3 does, and its frozen types).
     Anything missing or that can't be checked is no match. linkChild, childVerdict, settleChild, the step and startChild all
     ask this. */
  function childMatch(pin, c, procOf) {
    if (!pin) return '';
    var tail = ', but this step is pinned to ' + pin.process + ' v' + pin.version + ' (' + pin.folder + '), so it can\'t stand for this step.';
    var said = function (what) { return 'That ' + pin.process + ' run ' + what + tail; };
    if (!isObj(c)) return said('isn\'t visible here');
    if (c.process !== pin.process) return said('is a run of another checklist');
    if (typeof c.folder !== 'string' || !c.folder) return said('doesn\'t say its version');
    if (c.folder !== pin.folder) return said('is on ' + c.folder);
    var got = typeof procOf === 'function' ? find(procOf(pin.process), pin) : { why: 'the versions in this folder aren\'t known here' };
    if (!got.pub) return said('can\'t be checked against ' + pin.folder + ': ' + lower(got.why));
    var info = got.pub.info, t;
    if (c.mapHash !== info.mapHash || (typeof c.snapshot === 'string' && PF.util.hash(c.snapshot) !== info.mapHash)) return said('doesn\'t match the checklist of ' + pin.folder);
    if (c.typesHash == null && c.types == null) return said('doesn\'t say which step types it ran');
    if (c.typesHash != null && c.typesHash !== info.typesHash) return said('ran other step types than ' + pin.folder);
    if (c.types != null) { try { t = PF.publish.canonical(c.types) === PF.publish.canonical(got.pub.types); } catch (e) { t = false; } if (!t) return said('ran other step types than ' + pin.folder); }
    return '';
  }

  /* The pin a run/3 step takes from a child run it adopts when it has none yet (its child process wasn't published when the
     run started): that run's version as this folder holds it, verified as childMatch verifies any child (PF.pins.find: present,
     the only one with its number, usable; and the run matching it). { pin } or { why }: one that can't be verified is refused,
     never pinned from the run's own say. */
  function pinOfRun(c, procOf) {
    var name = isObj(c) && typeof c.process === 'string' ? c.process : 'child';
    var no = function (why) { return { why: 'That ' + name + ' run can\'t be linked: ' + why + ', so this step can\'t be pinned to its version.' }; };
    if (!isObj(c)) return no('it isn\'t visible here');
    if (typeof c.folder !== 'string' || !PF.publish.versionOf(c.folder)) return no('it doesn\'t say its version');
    if (typeof procOf !== 'function') return no('its version can\'t be checked: the versions in this folder aren\'t known here');
    var got = find(procOf(c.process), { process: c.process, folder: c.folder });
    if (!got.pub) return no('its version (' + c.folder + ') can\'t be verified: ' + lower(got.why));
    var pin = of(got.pub, c.process);
    if (!childOk(pin)) return no('its version (' + c.folder + ') can\'t be verified: its publication record doesn\'t name its fingerprints');
    var bad = childMatch(pin, c, procOf);
    return bad ? { why: bad } : { pin: pin };
  }

  /* The version a plan/2 starts on: its pin, or the one a person retargeted it to (a plan/2 status, retargeted). Never the
     latest by itself: { pub, older, retargeted } or { pub: null, ask: why }. */
  function forPlan(proc, plan, retarget) {
    var to = retarget && isObj(retarget.to) && typeof retarget.to.folder === 'string' ? { process: plan.process, folder: retarget.to.folder } : plan.pin;
    if (!isObj(to) || typeof to.folder !== 'string' || !PF.publish.versionOf(to.folder)) return { pub: null, ask: 'it doesn\'t say which version to start on' };
    var got = find(proc, to);
    if (!got.pub) return { pub: null, ask: got.why, retargeted: !!retarget };
    var latest = proc && proc.latest;
    return { pub: got.pub, older: !!latest && latest.info.folder !== got.pub.info.folder, retargeted: !!retarget };
  }

  return { of: of, childOk: childOk, skillOk: skillOk, shapeOk: shapeOk, atVersion: atVersion, find: find, childMatch: childMatch, pinOfRun: pinOfRun, atStart: atStart, childTarget: childTarget, legacyWhy: legacyWhy, forPlan: forPlan, words: words, unusable: unusable };
})();
