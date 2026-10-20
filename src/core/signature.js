/* The meaning of a checklist, as a skill must follow it (2.0). steps(): one signature per step, covering what it says and
   needs, where it sits, its phase's note and screenshots, and the gate before its phase and the one that closes it (their
   notes and screenshots too). process(): every declared input, bound by a step or not. Skills and their briefs compare
   these; correction identity (corrections.stepSig, group IDs) never uses them. Pure: no I/O. */
PF.signature = (function () {
  'use strict';
  var own = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };
  /* Reference screenshots are instructions too: their captions, paths and the fingerprint frozen into the version. */
  function shots(list, images) { return (list || []).map(function (sh) { return [sh.caption, sh.src, own(images, sh.src) ? images[sh.src] : null]; }); }
  function gate(g, images) { g = g || {}; return [g.title, g.owner, g.approves, g.implicit, g.note, g.binds, g.fields, shots(g.shots, images)]; }

  function steps(map, types, images) {
    var o = Object.create(null);
    map.phases.forEach(function (p, pi) {
      var gates = JSON.stringify([pi > 0 ? gate(map.phases[pi - 1].gate, images) : null, gate(p.gate, images)]);
      var phase = JSON.stringify([p.id, p.mode, p.note || '', shots(p.shots, images)]);
      p.steps.forEach(function (s) {
        o[s.id] = { step: s, phase: p, sig: JSON.stringify([s.type, s.text, s.must, s.roles, s.binds, s.fields, s.note, s.track, phase, gates, types && types[s.type] ? types[s.type] : null, shots(s.shots, images)]) };
      });
    });
    return o;
  }

  /* Every declared input of a process: its run details, roles and runs, and the payload's extensions and pins (empty until
     later 2.0 slices fill them). pub: a publication { map, info } or a map. */
  function inputs(pub) {
    var map = pub.map || pub, meta = map.meta || {}, pay = pub.info && pub.info.payload;
    return { context: (meta.context || []).slice(), roles: (meta.roles || []).slice(), runs: meta.runs || '',
      extensions: pay && pay.extensions || {}, pins: pay && pay.pins || { children: {}, skills: {} } };
  }
  function process(pub) { return PF.util.hash(JSON.stringify(inputs(pub))); }
  /* What changed in the inputs apart from the run details (which skills.changes reports on their own), in words. */
  function inputChanges(a, b) {
    var x = inputs(a), y = inputs(b), out = [], list = function (l) { return l.join(', ') || 'none'; };
    if (x.roles.join(',') !== y.roles.join(',')) out.push('Roles: now ' + list(y.roles) + ' (was ' + list(x.roles) + ')');
    if (x.runs !== y.runs) out.push('Runs: ' + (y.runs || 'not set') + ' (was ' + (x.runs || 'not set') + ')');
    if (JSON.stringify(x.extensions) !== JSON.stringify(y.extensions)) out.push('Its extensions changed');
    if (JSON.stringify(x.pins) !== JSON.stringify(y.pins)) out.push('The versions it pins changed');
    return out;
  }
  return { steps: steps, process: process, inputs: inputs, inputChanges: inputChanges };
})();
