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

  /* pins: the version's resolved pins (payload.pins): a linked step follows the exact child it pins, a skill step the skill
     version it pins. A {run.process} step without carry: passes on every run detail its child shares, so it depends on the
     run details too (implicit carry); with carry: only on what it names, which its fields already say. */
  function texts(list) { return (list || []).map(function (w) { return w.text; }); }
  function conditional(q) { return !!q && (!!q.when || q.steps.some(function (s) { return !!s.when; })); }
  function whenOf(q) { return conditional(q) ? [texts(q.when), q.steps.map(function (s) { return [s.id, texts(s.when)]; })] : null; }
  function pinOf(pins, kind, id) { var p = pins && pins[kind] && own(pins[kind], id) ? pins[kind][id] : null; return p ? PF.publish.canonical(p) : null; }
  /* compact (practice only): a phase's conditions go into each of its steps as one hash, so a long conditional phase costs
     one hash per step. Skills never pass it: their stored signatures stay exactly as they are. */
  function steps(map, types, images, pins, compact) {
    var o = Object.create(null), context = (map.meta && map.meta.context || []).slice();
    map.phases.forEach(function (p, pi) {
      var prev = pi > 0 ? map.phases[pi - 1] : null;
      var when = conditional(p) || conditional(prev) ? (compact ? ['when', PF.util.hash(JSON.stringify([whenOf(prev), whenOf(p)]))] : ['when', whenOf(prev), whenOf(p)]) : null;
      var gates = JSON.stringify([pi > 0 ? gate(map.phases[pi - 1].gate, images) : null, gate(p.gate, images)]);
      var phase = JSON.stringify([p.id, p.mode, p.note || '', shots(p.shots, images)]);
      p.steps.forEach(function (s) {
        var parts = [s.type, s.text, s.must, s.roles, s.binds, s.fields, s.note, s.track, phase, gates, types && own(types, s.type) && types[s.type] ? types[s.type] : null, shots(s.shots, images)];
        /* Added only where they apply, so every other step's signature is exactly what it was. */
        var pin = s.type === 'run.process' ? pinOf(pins, 'children', s.id) : s.type === 'run.skill' ? pinOf(pins, 'skills', s.id) : null;
        if (pin) parts.push(['pin', pin]);
        if (s.type === 'run.process' && !String((s.fields || {}).carry || '').trim()) parts.push(['carry', context]);
        /* Conditions (2.1): whether the step applies, and whether the gate before its phase and the one closing it need a pass
           (a phase whose condition fails, or whose steps all aren't needed, is skipped with its gate). */
        if (when) parts.push(when);
        o[s.id] = { step: s, phase: p, sig: JSON.stringify(parts) };
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
  function process(pub) { var x = inputs(pub); return PF.util.hash(JSON.stringify([x.context, x.roles, x.runs, PF.publish.canonical(x.extensions), PF.publish.canonical(x.pins)])); }
  /* What changed in the inputs apart from the run details (which skills.changes reports on their own), in words. */
  function inputChanges(a, b) { return inputWords(inputs(a), inputs(b)); }
  /* The same words from two inputs() results; list(names) writes a list of roles (a page shows only some: K.capJoin). */
  function inputWords(x, y, list) {
    var out = [];
    list = list || function (l) { return l.join(', ') || 'none'; };
    if (x.roles.join(',') !== y.roles.join(',')) out.push('Roles: now ' + list(y.roles) + ' (was ' + list(x.roles) + ')');
    if (x.runs !== y.runs) out.push('Runs: ' + (y.runs || 'not set') + ' (was ' + (x.runs || 'not set') + ')');
    if (PF.publish.canonical(x.extensions) !== PF.publish.canonical(y.extensions)) out.push('Its extensions changed');
    if (PF.publish.canonical(x.pins) !== PF.publish.canonical(y.pins)) out.push('The versions it pins changed');
    return out;
  }
  /* A gate's and a phase's own instruction parts, the same ones steps() uses (practice compares them; docs/design.md, Practice). */
  function gateParts(g, images) { return JSON.stringify(gate(g, images)); }
  function phaseParts(p, images) { return JSON.stringify([p.id, p.title, p.mode, p.note || '', shots(p.shots, images), texts(p.when)]); }
  return { steps: steps, process: process, inputs: inputs, inputChanges: inputChanges, inputWords: inputWords, gateParts: gateParts, phaseParts: phaseParts };
})();
