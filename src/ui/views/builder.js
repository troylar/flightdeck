/* The outline builder: the draft's phases as cards, its steps as rows, its lanes side by side and its gates as
   hazard-striped thresholds, edited by buttons, a side form, dragging or Alt+Up / Alt+Down, with a parts box to add from.
   It shows what PF.outline reads from the Markdown, and every change is an operation on that same text (app.js), so the
   Markdown editor and the builder always agree. */
(function () {
  'use strict';
  var V = PF.views, U = PF.util, T = PF.types, O = PF.outline, M = PF.map, I = PF.icons.icon, esc = U.esc;
  var LAND = 'Cleared to land here · or move with Alt+Up / Alt+Down';
  var LANES_SAY = 'Do all lanes. Finish every lane before the gate.';

  function teamTypes(ctx) { return (ctx.data.stepTypes || {}).types || {}; }
  /* Built-in types, then the team's, as select options; a type the step names that isn't known stays choosable. */
  function typeOptions(ctx, cur) {
    var team = teamTypes(ctx), ids = Object.keys(team).sort(), known = T.LIST.some(function (t) { return t.id === cur; }) || ids.indexOf(cur) >= 0;
    var opt = function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === cur ? ' selected' : '') + '>' + esc(t.label) + '</option>'; };
    return (cur && !known ? '<option value="' + esc(cur) + '" selected>{' + esc(cur) + '} (unknown type)</option>' : '') +
      '<optgroup label="Built-in">' + T.LIST.map(opt).join('') + '</optgroup>' + (ids.length ? '<optgroup label="Your team\'s">' + ids.map(function (id) { return opt(team[id]); }).join('') + '</optgroup>' : '');
  }
  /* Rows are buttons, so the step text shows without its Markdown markers rather than as links inside a button. */
  function plain(s) { return String(s || '').replace(/\*\*|__|`/g, ''); }
  function selOf(ctx, p) { var s = ctx.state.obSel; return s && s.pid === p.id ? s : null; }
  function addOf(ctx, p) { var a = ctx.state.obAdd; return a && a.pid === p.id ? a : null; }
  /* A refused value shows its reason next to its field (app.js sets fieldErr { id: 'ob', field }). */
  function errOf(ctx, id) { var e = ctx.state.fieldErr; return e && e.id === 'ob' && e.field === id ? e : null; }
  function errAt(ctx, id) { return errOf(ctx, id) ? ' aria-invalid="true" aria-describedby="ferr-' + esc(id) + '"' : ''; }
  function errMsg(ctx, id) { var e = errOf(ctx, id); return e ? '<p class="ferr" id="ferr-' + esc(id) + '" role="alert">' + esc(e.msg) + '</p>' : ''; }
  /* The form's scope names what it shows and the lines it was drawn from, so a redraw after those lines changed (in this
     window or in the folder) shows the new values instead of carrying over what the old boxes held. */
  function sigOf(o, from, to) { return U.hash(o.lines.slice(from, to).join('\n')); }

  /* ---------- the parts box ---------- */
  /* Structure, the everyday steps, then every step type grouped as the Step types page groups them (the team's first).
     kind is where a part can go (PF.outline.places). Confirm and Run another process are the Step and its namesake above. */
  function an(s) { return (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s; }
  function parts(ctx) {
    var out = [
      { id: 'phase', kind: 'phase', group: 'Structure', label: 'Phase', hint: 'A stage of the work, with its own way of working', glyph: ['ph', '##'], title: 'New phase', noun: 'a phase', keys: 'stage section' },
      { id: 'lanes', kind: 'lanes', group: 'Structure', label: 'Parallel lanes', hint: 'Work that happens at the same time, a lane per role', glyph: ['ln', '||'], title: 'New lane', text: 'First step in this lane', noun: 'a lane', keys: 'track parallel lane role' },
      { id: 'gate', kind: 'gate', group: 'Structure', label: 'Gate', hint: 'Someone signs off to go on', glyph: ['gt', ''], title: 'Ready to go on', noun: 'a gate', keys: 'approve approval sign off owner' },
      { id: 'step', kind: 'step', group: 'Steps', label: 'Step', hint: 'Someone does it and checks it off', glyph: ['st', '[ ]'], type: 'confirm', mark: ' ', text: 'New step', noun: 'a step', keys: 'confirm check' },
      { id: 'must', kind: 'step', group: 'Steps', label: 'Must-do', hint: 'A step that can\'t be marked N/A or waived', glyph: ['md', '[!]'], type: 'confirm', mark: '!', text: 'New must-do step', noun: 'a must-do step', keys: 'confirm required must do' },
      { id: 'process', kind: 'step', group: 'Steps', label: 'Run another process', hint: 'Starts a linked run; done when that run completes', icon: 'nest', type: 'run.process', mark: ' ', text: 'Run another process', noun: 'a step that runs another process', keys: 'run.process child nested linked' }
    ];
    var team = teamTypes(ctx), typePart = function (t, team) {
      return { id: 'type:' + t.id, kind: 'step', group: T.groupOf(t).join(' / '), team: team, label: t.label, hint: t.id === 'ci.gate' ? 'Records a CI build or test result for a commit. Not a sign-off.' : t.hint || '', icon: t.icon, type: t.id, mark: ' ', text: t.label, noun: an(t.label + ' step'), keys: t.id + ' ' + T.tagsOf(t).join(' ') };
    };
    var mine = Object.keys(team).map(function (id) { return typePart(team[id], true); });
    mine.sort(function (a, b) { return a.group.localeCompare(b.group) || a.label.localeCompare(b.label); });
    out.forEach(function (pt) { pt.base = true; });
    return out.concat(mine, T.LIST.filter(function (t) { return t.id !== 'confirm' && t.id !== 'run.process'; }).map(function (t) { return typePart(t, false); }));
  }
  function partOf(ctx, id) { return parts(ctx).filter(function (x) { return x.id === id; })[0] || null; }
  function matches(pt, q) { return !q || [pt.label, pt.hint, pt.group, pt.keys || '', pt.type || ''].join(' ').toLowerCase().indexOf(q) >= 0; }
  function pic(pt) { return pt.glyph ? '<span class="ob-pic g-' + pt.glyph[0] + '" aria-hidden="true">' + esc(pt.glyph[1]) + '</span>' : '<span class="ob-pic g-ty" aria-hidden="true">' + I(pt.icon || 'check') + '</span>'; }
  function placeOf(ctx, p) { var pl = ctx.state.obPlace; return pl && pl.pid === p.id ? pl : null; }
  /* The search box and the list, apart, so the box stays put while the list scrolls. sfx tells the parts pane ('') from
     the phone's sheet ('2'): only the first drags. Structure is always there, whatever the search. */
  function partsSearch(ctx, sfx) {
    return '<label class="sr" for="ob-part-q' + sfx + '">Find a part</label><input id="ob-part-q' + sfx + '" class="ob-q" type="search" maxlength="60" autocomplete="off" placeholder="Find a part" value="' + esc(String(ctx.state.obQ || '').trim()) + '">';
  }
  function partsList(ctx, p, sfx) {
    var st = ctx.state, q = String(st.obQ || '').trim(), ql = q.toLowerCase(), all = parts(ctx), shown = all.filter(function (pt) { return pt.group === 'Structure' && pt.base || matches(pt, ql); }), pl = placeOf(ctx, p);
    var errs = ((ctx.data.stepTypes || {}).errors || []).filter(function (e) { return !ql || String(e.file).toLowerCase().indexOf(ql) >= 0; });
    var h = '', none = q && !errs.length && !all.some(function (pt) { return matches(pt, ql); });
    if (none) h += '<div class="ob-none" role="status"><p>No parts match “' + esc(q) + '”.</p><button type="button" class="mini" data-act="ob-part-clear">Clear search</button></div>';
    var btn = function (pt) {
      return '<li><button type="button" class="ob-part' + (pt.base ? '' : ' type') + '" data-act="ob-part" data-id="' + esc(pt.id) + '"' + (sfx ? '' : ' draggable="true" data-ob-part="' + esc(pt.id) + '"') + ' aria-pressed="' + !!(pl && pl.part === pt.id) + '" title="' + esc(pt.label + ': ' + pt.hint) + '" data-tip="' + esc(pt.label) + '">' +
        pic(pt) + '<span class="ob-pt"><b>' + esc(pt.label) + '</b><small>' + esc(pt.hint) + '</small></span></button></li>';
    };
    var section = function (head, list, extra, sub) { return list.length || extra ? '<div class="ob-pgroup"><h4' + (sub ? ' class="sub"' : '') + '>' + esc(head) + '</h4>' + (list.length ? '<ul>' + list.map(btn).join('') + '</ul>' : '') + (extra || '') + '</div>' : ''; };
    var by = function (list) { var g = []; list.forEach(function (pt) { if (g.indexOf(pt.group) < 0) g.push(pt.group); }); return g.map(function (name) { return [name, list.filter(function (pt) { return pt.group === name; })]; }); };
    h += section('Structure', shown.filter(function (pt) { return pt.base && pt.group === 'Structure'; })) + section('Steps', shown.filter(function (pt) { return pt.base && pt.group === 'Steps'; }));
    var team = shown.filter(function (pt) { return pt.team; }), anyTeam = all.some(function (pt) { return pt.team; });
    var broken = errs.map(function (e) { return '<li class="ob-broken"><b>' + esc(e.file) + '</b><span class="small">Can\'t use this type yet.</span> <button type="button" class="linkish" data-act="open-types">View errors</button></li>'; }).join('');
    if (team.length || broken || (!anyTeam && !q)) {
      h += '<div class="ob-pgroup"><h4>Your team\'s step types</h4>' + (!anyTeam && !q ? '<p class="small">None yet. <button type="button" class="linkish" data-act="new-type">Create a step type</button></p>' : '') + '</div>';
      by(team).forEach(function (g) { h += section(g[0], g[1], '', true); });
      if (broken) h += '<ul class="ob-pgroup">' + broken + '</ul>';
    }
    var built = shown.filter(function (pt) { return !pt.base && !pt.team; });
    if (built.length) { h += '<div class="ob-pgroup"><h4>Built-in step types</h4></div>'; by(built).forEach(function (g) { h += section(g[0], g[1], '', true); }); }
    return '<div class="ob-plist" id="ob-plist' + sfx + '">' + h + '</div>';
  }
  /* The parts pane of the full-page editor: it folds to a rail of icons (remembered in this browser). */
  function partsPane(ctx, p) {
    var rail = !!ctx.state.partsRail;
    return '<aside class="fpe-pane fpe-parts" id="ob-parts" aria-labelledby="ob-parts-h"><div class="fpe-parts-head"><div class="row between"><h2 id="ob-parts-h">Parts</h2>' +
      '<button type="button" class="mini ob-railbtn" data-act="ob-rail" aria-expanded="' + !rail + '" aria-controls="ob-plist" title="' + (rail ? 'Show part names' : 'Fold to icons') + '">' + I('swap') + '<span class="sr">' + (rail ? 'Show part names' : 'Fold the parts to icons') + '</span></button></div>' +
      '<p class="small ob-blurb">Drag one onto the checklist, or choose it and pick a place.</p>' + partsSearch(ctx, '') +
      '<button type="button" class="mini ob-findparts" data-act="ob-parts-open" title="Find parts">' + I('plus') + '<span>Find parts</span></button></div>' + partsList(ctx, p, '') + '</aside>';
  }
  function partsSheet(ctx, p) {
    return '<div class="overlay" data-act="close-overlay"><div class="ob-sheet" role="dialog" aria-modal="true" aria-labelledby="ob-sheet-h"><div class="row between"><h2 id="ob-sheet-h">Add a part</h2><button type="button" class="mini" data-act="close-overlay" id="ob-sheet-close">Close</button></div>' +
      '<p class="small">Choose a part, then choose where it goes in the checklist.</p>' + partsSearch(ctx, '2') + partsList(ctx, p, '2') + '</div></div>';
  }

  /* ---------- placing: where the chosen part can go ---------- */
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  /* Why a part has nowhere to go, so the strip never leaves someone stuck without a reason. */
  function nowhere(o, pt) {
    if (pt.kind !== 'phase' && !o.phases.length) return 'There are no phases yet. Add a phase first.';
    if (pt.kind === 'gate') return 'Every phase already has a gate. Select one to edit it.';
    return 'Nothing in this draft can take it safely. Edit it in Markdown.';
  }
  function sentence(pt, place) { return cap(pt.noun) + ' will go ' + place.where + '.'; }
  /* Everything the outline needs to draw its drop lines: the places for each kind of part, and what's being placed. */
  function placing(ctx, p, text, o) {
    var P = {}, pl = placeOf(ctx, p), pt = pl && partOf(ctx, pl.part);
    ['step', 'lanes', 'gate', 'phase'].forEach(function (k) { P[k] = {}; O.places(text, k, o).forEach(function (x) { P[k][x.id] = x; }); });
    var list = pt ? O.places(text, pt.kind, o) : [], cur = pt && (P[pt.kind][pl.at] || list[0]);
    return { P: P, pt: pt, list: list, cur: cur };
  }
  function strip(B, o) {
    var pt = B.pt; if (!pt) return '';
    if (!B.cur) return '<div class="ob-placing none" role="group" aria-label="Placing ' + esc(pt.label) + '">' + pic(pt) + '<p><b>Nowhere to put ' + esc(pt.noun) + '.</b> ' + esc(nowhere(o, pt)) + '</p>' +
      (pt.kind === 'step' && !o.phases.length ? '<button type="button" class="btn go" data-act="ob-phase-with" id="ob-phase-with">Add a phase with this step</button>' : '') + '<button type="button" class="mini" data-act="ob-place-cancel" id="ob-place-cancel">Cancel</button></div>';
    return '<div class="ob-placing" role="group" aria-label="Placing ' + esc(pt.label) + '">' + pic(pt) + '<p><b>Placing ' + esc(pt.label) + '.</b> <span id="ob-preview">' + esc(sentence(pt, B.cur)) + '</span>' +
      '<span class="small ob-keys">Arrow keys choose a place · Enter puts it there · Escape cancels</span></p><button type="button" class="mini" data-act="ob-place-cancel" id="ob-place-cancel">Cancel</button></div>';
  }
  /* A drop line. It takes no room, so nothing moves while a part is dragged; while a part is being placed by a click or the
     keyboard, the lines it can use become buttons. Step lines also take a step being moved (data-ob-drop). */
  function slot(B, tag, kind, id, cls) {
    var x = B.P[kind][id]; if (!x) return '';
    cls = cls ? ' ' + cls : '';
    var attrs = ' data-ob-place="' + esc(id) + '" data-for="' + kind + '" data-say="' + esc(x.where) + '"' + (kind === 'step' ? ' data-ob-drop="' + esc(id) + '"' : '');
    if (B.pt && B.pt.kind === kind) {
      var on = B.cur && B.cur.id === id;
      return '<' + tag + ' class="ob-slot' + cls + ' legal' + (on ? ' on' : '') + '"' + attrs + '><button type="button" class="ob-dest" data-act="ob-place-at" data-id="' + esc(id) + '" tabindex="' + (on ? 0 : -1) + '" aria-label="Put ' + esc(B.pt.label) + ' here: ' + esc(x.spoken) + '" data-say="' + esc(sentence(B.pt, x)) + '"><span>Put it here</span></button></' + tag + '>';
    }
    return '<' + tag + ' class="ob-slot' + cls + '" aria-hidden="true"' + attrs + '>' + (kind === 'step' ? '<span>' + LAND + '</span>' : '') + '</' + tag + '>';
  }

  /* ---------- the outline ---------- */
  function addStepForm(ctx) {
    return '<li class="ob-addform"><div class="row"><label class="sr" for="ob-new-text">New step: what to do</label><input id="ob-new-text" maxlength="200" placeholder="What to do" data-enter="ob-add-go"' + errAt(ctx, 'ob-new-text') + '>' +
      '<label class="sr" for="ob-new-type">Type of the new step</label><select id="ob-new-type">' + typeOptions(ctx, 'confirm') + '</select>' +
      '<button type="button" class="btn go" data-act="ob-add-go">Add step</button><button type="button" class="mini" data-act="ob-add-cancel">Cancel</button></div>' + errMsg(ctx, 'ob-new-text') + '</li>';
  }
  /* Steps with open corrections are marked, so whoever edits the draft sees them (B.fix: open groups per step ID). */
  function fixBadge(B, id) { var n = id && B && B.fix && B.fix[id]; return n ? '<span class="badge b-warn">' + n + ' open correction' + (n === 1 ? '' : 's') + '</span>' : ''; }
  /* A step or phase a change from outside touched (your AI assistant's, or the folder's): a bar and words, until the person's
     next save, Dismiss or Undo (slice 2). */
  function incoming(ctx, kind, key) { var ed = ctx.state.editor, inc = ed && ed.incoming; return inc && inc.keys && inc.keys[kind + ':' + key] ? inc : null; }
  function incWords(inc) { return inc ? '<span class="ob-inc-t">' + (inc.who === 'assistant' ? 'Changed by your AI assistant' : 'Changed in the team folder') + '</span>' : ''; }
  function isNew(ctx, kind, key, track) { var f = ctx.state.obFlash; return !!f && f.kind === kind && f.key === key && (track == null || +f.track === +track); }
  function stepRow(ctx, p, s, sel, B) {
    var t = T.get(s.type, teamTypes(ctx)), on = sel && sel.kind === 'step' && sel.key === s.key;
    var meta = (s.must ? '<span class="badge b-must">Must do</span>' : '') + (s.planned ? '<span class="badge b-plan">Automation planned</span>' : '') +
      (s.roles.length ? '<span class="ob-role">@' + esc(s.roles.join(' @')) + '</span>' : '') + s.binds.map(function (b) { return '<span class="ob-chip">^' + esc(b) + '</span>'; }).join('') + fixBadge(B, s.id);
    var inc = incoming(ctx, 'step', s.key);
    if (inc) meta = incWords(inc) + meta;
    return slot(B, 'li', 'step', 'before:' + s.key, '') +
      '<li class="ob-step' + (on ? ' sel' : '') + (s.odd ? ' odd' : '') + (isNew(ctx, 'step', s.key) ? ' ob-new' : '') + (inc ? ' ob-inc' : '') + '" draggable="' + !s.odd + '" data-ob-step="' + esc(s.key) + '"><span class="ob-grip" aria-hidden="true"></span>' +
      '<button type="button" class="ob-pick" data-act="ob-sel" data-id="' + esc(s.key) + '" aria-pressed="' + on + '" aria-describedby="ob-kbd">' + (t ? I(t.icon, t.label) : I('check', 'Unknown type')) +
      '<span class="ob-row"><span class="ob-txt">' + esc(plain(s.text)) + '</span>' + (meta ? '<span class="ob-meta">' + meta + '</span>' : '') + '</span></button></li>';
  }
  /* One group of steps: the steps before any lane (g = -1) or one lane's. */
  function groupList(ctx, p, ph, g, sel, add, B, label) {
    var h = '';
    ph.steps.filter(function (s) { return s.track === g; }).forEach(function (s) {
      h += stepRow(ctx, p, s, sel, B);
      if (add && add.kind === 'step' && add.after === s.key) h += addStepForm(ctx);
    });
    h += slot(B, 'li', 'step', 'end:' + ph.key + ':' + g, '');
    h += add && add.kind === 'step' && add.after == null && add.phase === ph.key && +add.track === g ? addStepForm(ctx) :
      '<li class="ob-addrow"><button type="button" class="mini" data-act="ob-add" data-id="' + esc(ph.key) + '" data-track="' + g + '">' + I('plus') + 'Add a step' + (g >= 0 ? ' to ' + esc(ph.tracks[g].title || 'this lane') : '') + '</button></li>';
    return '<ul class="ob-steps" aria-label="' + esc(label) + '">' + h + '</ul>';
  }
  function phaseCard(ctx, o, p, ph, sel, add, B) {
    var on = sel && sel.kind === 'phase' && sel.key === ph.key, body = '', title = ph.title || 'Untitled phase';
    /* Before the first lane, a phase's own group shows only when it has steps or the phase has no lanes. */
    if (ph.steps.some(function (s) { return s.track < 0; }) || !ph.tracks.length) body += groupList(ctx, p, ph, -1, sel, add, B, 'Steps in ' + title);
    if (ph.tracks.length) {
      body += '<div class="ob-lanes" role="group" aria-label="Parallel lanes in ' + esc(title) + '"><p class="ob-lanes-h">' + I('swap') + LANES_SAY + '</p><div class="ob-lane-row">';
      ph.tracks.forEach(function (tr, k) {
        var name = tr.title || 'Untitled lane', tsel = sel && sel.kind === 'track' && sel.key === ph.key && +sel.track === k;
        body += slot(B, 'div', 'lanes', 'lane:' + ph.key + ':' + k, 'v') +
          '<section class="ob-lane' + (tsel ? ' sel' : '') + (isNew(ctx, 'track', ph.key, k) ? ' ob-new' : '') + '" aria-label="Lane: ' + esc(name) + '"><div class="ob-lane-h">' +
          '<button type="button" class="ob-lane-name" data-act="ob-sel-track" data-id="' + esc(ph.key) + '" data-track="' + k + '" aria-pressed="' + !!tsel + '">' + esc(name) + '</button>' +
          (tr.roles.length ? '<span class="small">@' + esc(tr.roles.join(' @')) + '</span>' : '<span class="small">No role</span>') + '</div>' +
          groupList(ctx, p, ph, k, sel, add, B, 'Steps in the ' + name + ' lane') + '</section>';
      });
      body += slot(B, 'div', 'lanes', 'lane:' + ph.key + ':end', 'v') + '</div></div>';
    } else body += slot(B, 'div', 'lanes', 'lane:' + ph.key + ':end', '');
    var gt = ph.gate, gate = gt ? '<div class="fp-gate ob-gate' + (isNew(ctx, 'gate', ph.key) ? ' ob-new' : '') + '"><div class="ob-gate-copy"><span class="fp-gate-t">' + I('gate') + 'Gate: ' + esc(gt.title) + '</span>' + (gt.owner ? '<span class="small">owner @' + esc(gt.owner) + '</span>' : '') + (gt.approves ? '<span class="small">approves ' + esc(plain(gt.approves)) + '</span>' : '') + '</div>' +
      '<button type="button" class="mini" data-act="ob-sel-phase" data-id="' + esc(ph.key) + '" data-focus="ob-g-title" aria-label="Edit gate ' + esc(gt.title) + '">Edit gate</button></div>' :
      slot(B, 'div', 'gate', 'gate:' + ph.key, '') + '<div class="fp-gate implicit ob-gate"><div class="ob-gate-copy"><span class="small">Ends with a check that the phase is done.</span></div><button type="button" class="mini" data-act="ob-sel-phase" data-id="' + esc(ph.key) + '" data-focus="ob-g-title" aria-label="Add a gate to ' + esc(ph.title) + '">' + I('plus') + 'Add a gate</button></div>';
    var inc = incoming(ctx, 'phase', ph.key);
    return '<li class="ob-phase' + (on ? ' sel' : '') + (isNew(ctx, 'phase', ph.key) ? ' ob-new' : '') + (inc ? ' ob-inc' : '') + '"><div class="ob-ph-head"><div class="fp-eye">Phase ' + (ph.index + 1) + '</div>' +
      '<h3 class="ob-ph-h"><button type="button" class="ob-ph-name" data-act="ob-sel-phase" data-id="' + esc(ph.key) + '" data-ob-phase="' + esc(ph.key) + '" aria-pressed="' + on + '" aria-describedby="ob-kbd">' + esc(title) + '</button></h3>' + incWords(inc) +
      (ph.mode ? '<span class="cat">' + esc(ph.mode) + '</span>' : '<span class="cat">No mode</span>') + fixBadge(B, ph.id && 'phase:' + ph.id) + '</div><div class="ob-body">' + body + '</div>' + gate + '</li>';
  }

  /* The outline pane of the full-page editor. The parts pane (partsPane) and the inspector sit beside it (manage.js). */
  function builder(ctx, p, text) {
    var o = O.parse(text), sel = selOf(ctx, p), add = addOf(ctx, p), map = M.parse(text), h = '';
    if (o.unsupported) return '<div class="notice warn"><span>The builder can\'t edit this draft safely: ' + esc(o.unsupported) + ' Use Markdown instead.</span><button class="mini" data-act="ed-mode" data-id="markdown">Markdown</button></div>';
    var B = placing(ctx, p, text, o); B.fix = PF.corrections.openCounts(V.fixesOf(ctx, p));
    if (map.errors.length) h += '<div class="notice warn"><span>' + map.errors.length + ' line' + (map.errors.length === 1 ? ' isn\'t' : 's aren\'t') + ' understood (see Checks). The builder keeps ' + (map.errors.length === 1 ? 'it' : 'them') + ' exactly as written; fix ' + (map.errors.length === 1 ? 'it' : 'them') + ' in Markdown.</span></div>';
    if (o.questions >= 0) h += '<div class="notice warn"><span>It still has a Questions section. Answer the questions in Markdown.</span></div>';
    h = strip(B, o) + h + '<div class="row between ob-bar"><details class="ob-help"><summary>Editing help</summary><p id="ob-kbd" class="small">Drag a part onto the checklist, or choose one and pick a place with the arrow keys. Drag a step by its grip, or select it and press Alt+Up or Alt+Down to move it. Select a step, lane, phase or gate to change it.</p></details>' +
      '<button type="button" class="btn ob-addpart" data-act="ob-parts-open">' + I('plus') + 'Add part</button></div>';
    var phaseForm = '<div class="ob-addform row"><label class="sr" for="ob-new-title">New phase name</label><input id="ob-new-title" maxlength="120" placeholder="Phase name" data-enter="ob-add-go"' + errAt(ctx, 'ob-new-title') + '>' +
      '<label class="sr" for="ob-new-mode">How it\'s worked</label><select id="ob-new-mode"><option value="READ-DO">READ-DO</option><option value="DO-CONFIRM">DO-CONFIRM</option></select>' +
      '<button type="button" class="btn go" data-act="ob-add-go">Add phase</button><button type="button" class="mini" data-act="ob-add-cancel">Cancel</button></div>' + errMsg(ctx, 'ob-new-title');
    var addingPhase = add && add.kind === 'phase', out = '<ol class="ob-phases" aria-label="Phases">' + slot(B, 'li', 'phase', 'phase:^', 'h') +
      o.phases.map(function (ph) { return phaseCard(ctx, o, p, ph, sel, add, B) + (addingPhase && add.after === ph.key ? '<li>' + phaseForm + '</li>' : '') + slot(B, 'li', 'phase', 'phase:' + ph.key, 'h'); }).join('') + '</ol>';
    if (addingPhase && add.after == null) out += phaseForm;
    else if (!o.phases.length) out += '<div class="ob-empty"><p><b>This checklist is empty.</b> Start with a phase: a stage of the work, like Prepare or Deploy. Then add its steps.</p><button type="button" class="btn go" data-act="ob-add-phase">' + I('plus') + 'Add your first phase</button></div>';
    else out += '<button type="button" class="mini ob-addphase" data-act="ob-add-phase">' + I('plus') + 'Add a phase</button>';
    h += out;
    return '<div class="ob' + (B.pt ? ' placing for-' + B.pt.kind : '') + '" id="ob">' + h + '</div>';
  }

  /* ---------- the side form ---------- */
  function fieldRow(ctx, def, s, name) {
    var d = T.fieldDef(def, name) || { label: name, kind: 'text' }, v = s.fields[name] || '', id = 'ob-fld-' + name;
    var label = esc(d.label || name) + (d.required ? ' <span class="small">usually filled in</span>' : '');
    var opts = d.kind === 'choice' ? T.options(d, s.fields) : [];
    if (opts.length) {
      var list = opts.indexOf(v) < 0 && v ? opts.concat([v]) : opts;
      return '<label class="field" for="' + esc(id) + '">' + label + '<select id="' + esc(id) + '" data-bound' + errAt(ctx, id) + '><option value=""' + (v ? '' : ' selected') + '>Not set</option>' + list.map(function (x) { return '<option value="' + esc(x) + '"' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></label>' + errMsg(ctx, id);
    }
    return '<label class="field" for="' + esc(id) + '">' + label + '<input id="' + esc(id) + '" maxlength="300" data-enter="ob-commit" value="' + esc(v) + '"' + errAt(ctx, id) + '></label>' + errMsg(ctx, id);
  }
  /* On a phone the form is a sheet over the outline; Done closes it. */
  /* The selected item's name, Previous / Next through the steps, and on a phone Done to close the sheet. */
  /* crumbs: where it is, as a trail (Verify in production / Product checks / Step 11 of 14). */
  function formHead(title, crumbs, prev, next) {
    return '<div class="ob-form-top"><div class="row between"><h2 id="ob-form-h">' + I('edit') + esc(title) + '</h2><button type="button" class="mini ob-done" data-act="ob-done">Done</button></div>' +
      (crumbs && crumbs.length ? '<nav aria-label="Where it is"><ol class="ob-crumbs">' + crumbs.map(function (c) { return '<li>' + esc(plain(c)) + '</li>'; }).join('') + '</ol></nav>' : '') +
      (prev !== undefined ? '<div class="row ob-prevnext"><button type="button" class="mini" data-act="ob-sel" data-id="' + esc(prev || '') + '"' + (prev ? '' : ' disabled') + '>Previous step</button><button type="button" class="mini" data-act="ob-sel" data-id="' + esc(next || '') + '"' + (next ? '' : ' disabled') + '>Next step</button></div>' : '') + '</div>';
  }
  /* The Markdown behind a form, for whoever wants it: type, ID and field names. */
  function source(ctx, id, what, fallback, extra) { return '<details class="ob-src"><summary>Source details</summary>' + (extra || '') + idLine(ctx, id, what, fallback) + '</details>'; }
  function idLine(ctx, id, what, fallback) {
    var ed = ctx.state.editor, fresh = !!(ed && ed.fresh && id && Object.prototype.hasOwnProperty.call(ed.fresh, id));
    if (!id) return '<p class="small">No ID yet. Add one in Markdown, like {#' + esc(fallback) + '}.</p>';
    return '<p class="small">ID <code>' + esc(id) + '</code>. ' + (fresh ? 'It follows the name until you save the draft; after that it never changes.' : 'It never changes, so runs and skills keep finding this ' + what + '.') + '</p>';
  }
  function askOf(ctx, kind, key, track) { var a = ctx.state.obAsk; return a && a.kind === kind && a.key === key && (track == null || +a.track === +track) ? a : null; }
  /* The side form for what's selected: a step's text, kind, type, roles, run details and fields; a lane; or a phase and its
     gate. Text boxes apply when you leave them (or press Enter); choices apply at once. */
  function builderForm(ctx, p, text) {
    var sel = selOf(ctx, p); if (!sel) return '';
    var o = O.parse(text); if (o.unsupported) return '';
    var meta = M.parse(text).meta;
    if (sel.kind === 'step') {
      var s = o.steps.filter(function (x) { return x.key === sel.key; })[0]; if (!s) return '';
      var at = o.steps.indexOf(s), prevS = o.steps[at - 1], nextS = o.steps[at + 1];
      var h = '<section class="panel stack ob-form" aria-labelledby="ob-form-h" data-scope="ob-step|' + esc(s.key) + '|' + sigOf(o, s.line, s.end) + '">' + formHead('Step', [s.phase.title || 'Untitled phase'].concat(s.track >= 0 ? [s.phase.tracks[s.track].title || 'Untitled lane'] : [], ['Step ' + (at + 1) + ' of ' + o.steps.length]), prevS ? prevS.key : null, nextS ? nextS.key : null);
      if (s.odd) return h + '<p class="small">This step has lines the builder can\'t change safely (a field or note separated from it). Edit it in Markdown.</p></section>';
      var def = T.get(s.type, teamTypes(ctx)), reveal = ctx.state.obReveal === s.key;
      /* Two wrapping rows, so the whole instruction shows; it's still one line in the checklist, and Enter applies it. */
      h += '<label class="field" for="ob-text">What to do<textarea id="ob-text" rows="2" maxlength="200" data-enter="ob-commit"' + errAt(ctx, 'ob-text') + '>' + esc(s.text) + '</textarea></label>' + errMsg(ctx, 'ob-text') +
        '<fieldset class="field ob-kind"><legend>Kind</legend>' + [['step', 'Step', 'Done and checked off; can be marked N/A.', !s.must && !s.planned], ['must', 'Must do', 'Can\'t be marked N/A or waived.', s.must], ['planned', 'Automation planned', 'Still done by hand for now; can be marked N/A.', s.planned]].map(function (k) {
          return '<label class="ob-switch' + (reveal && k[0] === 'must' ? ' reveal' : '') + '" for="ob-mark-' + k[0] + '"><input type="radio" name="ob-mark" id="ob-mark-' + k[0] + '" value="' + k[0] + '" data-bound' + (k[3] ? ' checked' : '') + '><span><b>' + k[1] + '</b> <span class="small">' + k[2] + '</span></span></label>';
        }).join('') + '</fieldset>' +
        '<label class="field" for="ob-type">Type<select id="ob-type" data-bound>' + typeOptions(ctx, s.type) + '</select></label>';
      var own = s.parts.roles, roles = meta.roles.concat(own.filter(function (r) { return meta.roles.indexOf(r) < 0; }));
      h += '<div class="field"><span id="ob-roles-l">Who does it</span>' + (roles.length ? '<div class="row" role="group" aria-labelledby="ob-roles-l">' + roles.map(function (r) { return '<button type="button" class="chipbtn" data-act="ob-role" data-id="' + esc(r) + '" aria-pressed="' + (own.indexOf(r) >= 0) + '">@' + esc(r) + '</button>'; }).join('') + '</div>' : '<span class="small">The checklist lists no roles. Add them to "roles:" in Markdown.</span>') +
        (s.track >= 0 && !own.length ? '<span class="small">With no role of its own, it goes to the lane\'s people.</span>' : '') + '</div>';
      var binds = s.parts.binds, ctxs = meta.context.concat(binds.filter(function (b) { return meta.context.indexOf(b) < 0; }));
      h += '<div class="field"><span id="ob-binds-l">Tied to run details</span><span class="small">When one of these changes during a run, the step needs a re-check.</span>' + (ctxs.length ? '<div class="row" role="group" aria-labelledby="ob-binds-l">' + ctxs.map(function (b) { return '<button type="button" class="ob-chip" data-act="ob-bind" data-id="' + esc(b) + '" aria-pressed="' + (binds.indexOf(b) >= 0) + '">^' + esc(b) + '</button>'; }).join('') + '</div>' : '<span class="small">The checklist lists no run details ("context:").</span>') + '</div>';
      var names = def ? Object.keys(def.fields || {}) : [];
      Object.keys(s.fields).forEach(function (f) { if (names.indexOf(f) < 0) names.push(f); });
      h += '<h3 class="ob-sec">Fields</h3>' + (names.length ? names.map(function (f) { return fieldRow(ctx, def, s, f); }).join('') : '<p class="small">This type asks for nothing more.</p>');
      if (s.notes) h += '<p class="small">Its ' + (s.notes === 1 ? 'note line stays' : s.notes + ' note lines stay') + ' as written; edit notes in Markdown.</p>';
      h += shotsSection(ctx, p, s);
      h += source(ctx, s.id, 'step', U.slug(s.text, 24), '<p class="small">Type <code>{' + esc(s.type || '?') + '}</code>' + (names.length ? ' · fields ' + names.map(function (f) { return '<code>' + esc(f) + '</code>'; }).join(' ') : '') + '</p>');
      h += '<div class="row"><button type="button" class="mini" data-act="ob-move" data-id="' + esc(s.key) + '" data-dir="up">Move up</button><button type="button" class="mini" data-act="ob-move" data-id="' + esc(s.key) + '" data-dir="down">Move down</button>' +
        '<button type="button" class="mini" data-act="ob-add-after" data-id="' + esc(s.key) + '">' + I('plus') + 'Add a step after it</button><button type="button" class="mini" data-act="ob-del" data-id="' + esc(s.key) + '">Delete this step</button>' +
        '<button type="button" class="mini" data-act="hist-open" data-id="draft" data-item="step:' + esc(s.key) + '" aria-haspopup="dialog">' + I('clock') + 'History of this step</button></div>';
      return h + '</section>';
    }
    var ph = o.phases.filter(function (x) { return x.key === sel.key; })[0]; if (!ph) return '';
    if (sel.kind === 'track') {
      var tr = ph.tracks[+sel.track]; if (!tr) return '';
      var n = ph.steps.filter(function (x) { return x.track === tr.index; }).length, name = tr.title || 'Untitled lane', ask = askOf(ctx, 'track', ph.key, tr.index);
      var lroles = meta.roles.concat(tr.roles.filter(function (r) { return meta.roles.indexOf(r) < 0; }));
      var t = '<section class="panel stack ob-form" aria-labelledby="ob-form-h" data-scope="ob-track|' + esc(ph.key) + '|' + tr.index + '|' + sigOf(o, tr.line, tr.line + 1) + '">' + formHead('Lane', [ph.title || 'Untitled phase', name]) +
        '<p class="small">' + LANES_SAY + '</p>' +
        '<label class="field" for="ob-tr-title">Name<input id="ob-tr-title" maxlength="120" data-enter="ob-commit" value="' + esc(tr.title) + '"' + errAt(ctx, 'ob-tr-title') + '></label>' + errMsg(ctx, 'ob-tr-title') +
        '<label class="field" for="ob-tr-role">Who works it<select id="ob-tr-role" data-bound' + errAt(ctx, 'ob-tr-role') + '><option value=""' + (tr.roles.length ? '' : ' selected') + '>Nobody in particular</option>' + lroles.map(function (r) { return '<option value="' + esc(r) + '"' + (r === tr.roles[0] ? ' selected' : '') + '>@' + esc(r) + '</option>'; }).join('') + '</select></label>' + errMsg(ctx, 'ob-tr-role') +
        '<p class="small">Its steps without a role of their own go to this role.</p>' + source(ctx, tr.id, 'lane', U.slug(name, 24)) +
        '<div class="row"><button type="button" class="mini" data-act="ob-add" data-id="' + esc(ph.key) + '" data-track="' + tr.index + '">' + I('plus') + 'Add a step to this lane</button><button type="button" class="mini" data-act="ob-ask" data-id="track">Delete this lane</button></div>';
      if (ask) t += '<div class="notice warn" role="group" aria-labelledby="ob-ask-t"><span id="ob-ask-t">' + (n ? 'Delete the ' + esc(name) + ' lane? Its ' + n + ' step' + (n === 1 ? '' : 's') + ' can move up into the phase, or go with it.' : 'Delete the ' + esc(name) + ' lane?') + '</span>' +
        (n ? '<button type="button" class="btn" data-act="ob-del-track" data-id="keep" id="ob-ask-go">Keep its steps</button><button type="button" class="btn stop" data-act="ob-del-track" data-id="all">Delete lane and steps</button>' : '<button type="button" class="btn stop" data-act="ob-del-track" data-id="all" id="ob-ask-go">Delete lane</button>') +
        '<button type="button" class="mini" data-act="ob-ask-cancel">Cancel</button></div>';
      return t + '</section>';
    }
    var gt = ph.gate, sig = sigOf(o, ph.line, ph.end) + (gt ? '.' + sigOf(o, gt.line, gt.end) : ''), pask = askOf(ctx, 'phase', ph.key);
    var f = '<section class="panel stack ob-form" aria-labelledby="ob-form-h" data-scope="ob-phase|' + esc(ph.key) + '|' + sig + '">' + formHead('Phase', ['Phase ' + (ph.index + 1) + ' of ' + o.phases.length]) +
      '<label class="field" for="ob-ph-title">Name<input id="ob-ph-title" maxlength="120" data-enter="ob-commit" value="' + esc(ph.title) + '"' + errAt(ctx, 'ob-ph-title') + '></label>' + errMsg(ctx, 'ob-ph-title') +
      '<label class="field" for="ob-ph-mode">How it\'s worked<select id="ob-ph-mode" data-bound><option value=""' + (ph.mode ? '' : ' selected') + '>Not set</option><option value="READ-DO"' + (ph.mode === 'READ-DO' ? ' selected' : '') + '>READ-DO: read each step, then do it</option><option value="DO-CONFIRM"' + (ph.mode === 'DO-CONFIRM' ? ' selected' : '') + '>DO-CONFIRM: do the work, then confirm together</option></select></label>' +
      '<label class="field" for="ob-ph-note">Note for the phase <span class="small">shown at the top of the phase in runs. Needs Flightdeck 2.0 to run.</span><textarea id="ob-ph-note" rows="3" maxlength="2000"' + errAt(ctx, 'ob-ph-note') + '>' + esc(ph.note || '') + '</textarea></label>' + errMsg(ctx, 'ob-ph-note') +
      (ph.odd ? '<p class="small">This phase has lines under its heading the builder can\'t change safely. Edit its note and screenshots in Markdown.</p>' : shotsSection(ctx, p, ph, 'phase')) +
      source(ctx, ph.id, 'phase', U.slug(ph.title, 24)) +
      '<div class="row"><button type="button" class="mini" data-act="ob-ph-move" data-id="' + esc(ph.key) + '" data-dir="up">Move phase up</button><button type="button" class="mini" data-act="ob-ph-move" data-id="' + esc(ph.key) + '" data-dir="down">Move phase down</button><button type="button" class="mini" data-act="ob-add-phase" data-id="' + esc(ph.key) + '">' + I('plus') + 'Add a phase after it</button><button type="button" class="mini" data-act="ob-ask" data-id="phase">Delete this phase</button>' +
      '<button type="button" class="mini" data-act="hist-open" data-id="draft" data-item="phase:' + esc(ph.key) + '" aria-haspopup="dialog">' + I('clock') + 'History of this phase</button></div>';
    if (pask) f += '<div class="notice warn" role="group" aria-labelledby="ob-ask-t"><span id="ob-ask-t">Delete ' + esc(ph.title || 'this phase') + (ph.steps.length ? ' and its ' + ph.steps.length + ' step' + (ph.steps.length === 1 ? '' : 's') : '') + (gt ? ', with its gate' : '') + '? Undo brings it back.</span>' +
      '<button type="button" class="btn stop" data-act="ob-del-phase" data-id="' + esc(ph.key) + '" id="ob-ask-go">Delete phase</button><button type="button" class="mini" data-act="ob-ask-cancel">Cancel</button></div>';
    f += '<h3 class="ob-sec">' + I('gate') + 'Closing gate</h3>';
    if (gt && gt.odd) return f + '<p class="small">This gate has options the builder doesn\'t know. Edit it in Markdown.</p></section>';
    if (!gt) return f + '<p class="small">Without a gate, the phase ends with a check that it\'s done. Name a gate to add one.</p><label class="field" for="ob-g-title">Gate name<input id="ob-g-title" maxlength="120" data-enter="ob-commit" value="" placeholder="Ready to deploy"' + errAt(ctx, 'ob-g-title') + '></label>' + errMsg(ctx, 'ob-g-title') + '</section>';
    var roles = meta.roles.concat(gt.owner && meta.roles.indexOf(gt.owner) < 0 ? [gt.owner] : []);
    return f + '<label class="field" for="ob-g-title">Gate name<input id="ob-g-title" maxlength="120" data-enter="ob-commit" value="' + esc(gt.title) + '"' + errAt(ctx, 'ob-g-title') + '></label>' + errMsg(ctx, 'ob-g-title') +
      '<label class="field" for="ob-g-owner">Who signs off<select id="ob-g-owner" data-bound><option value=""' + (gt.owner ? '' : ' selected') + '>Nobody in particular</option>' + roles.map(function (r) { return '<option value="' + esc(r) + '"' + (r === gt.owner ? ' selected' : '') + '>@' + esc(r) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field" for="ob-g-approves">What passing it approves <span class="small">use ^details from the run</span><input id="ob-g-approves" maxlength="200" data-enter="ob-commit" value="' + esc(gt.approves) + '"' + errAt(ctx, 'ob-g-approves') + '></label>' + errMsg(ctx, 'ob-g-approves') +
      source(ctx, gt.id, 'gate', U.slug(gt.title, 24)) +
      '<div class="row"><button type="button" class="mini" data-act="ob-gate-remove" data-id="' + esc(ph.key) + '">Remove this gate</button><span class="small">The phase then ends with a check that it\'s done.</span></div></section>';
  }

  /* A step's reference screenshots: thumbnails (alt text is the caption) with the caption as a box, Move up / Move down and
     Remove (the line only; the file stays in images/), then a place to add more by Choose files, drop or paste (app.js
     writes each image once and reads it back before its line is added). Thumbnails come from the folder's images/, never a
     run's publication (the last argument to ctx.img). */
  function shotsSection(ctx, p, s, kind) {
    var A = PF.attach, n = s.shots.length, busy = ctx.shotBusy ? +ctx.shotBusy(p.id) || 0 : 0;
    var h = '<h3 class="ob-sec" id="ob-shots-h">Screenshots</h3>';
    if (n) {
      h += '<ol class="ob-shots" aria-labelledby="ob-shots-h">' + s.shots.map(function (sh, k) {
        var id = 'ob-shot-cap-' + k, which = 'screenshot ' + (k + 1);
        return '<li class="ob-shot"><div class="thumb ob-shot-pic">' + ctx.img(sh.src, sh.caption, false, true) + '</div><div class="ob-shot-body">' +
          '<label class="field" for="' + id + '">Caption<span class="sr"> for ' + which + ' of ' + n + '</span><input id="' + id + '" maxlength="200" data-enter="ob-commit" value="' + esc(sh.caption) + '"' + errAt(ctx, id) + '></label>' + errMsg(ctx, id) +
          '<div class="row ob-shot-acts"><button type="button" class="mini" data-act="ob-shot-move" data-id="' + k + '" data-dir="up" aria-label="Move ' + which + ' up">Move up</button>' +
          '<button type="button" class="mini" data-act="ob-shot-move" data-id="' + k + '" data-dir="down" aria-label="Move ' + which + ' down">Move down</button>' +
          '<button type="button" class="mini" data-act="ob-shot-remove" data-id="' + k + '" aria-label="Remove ' + which + ': ' + esc(sh.caption) + '">Remove</button></div>' +
          '<p class="small ob-shot-src"><code>' + esc(sh.src) + '</code></p></div></li>';
      }).join('') + '</ol><p class="small">Removing takes it out of this draft only. The image file stays in the folder, since other versions or runs may use it.</p>';
    } else h += '<p class="small">No screenshots yet.</p>';
    return h + '<div class="ob-shot-add" data-drop="shots" data-id="' + esc(s.key) + '" role="group" aria-labelledby="ob-shot-add-h"><p class="ob-shot-add-h" id="ob-shot-add-h"><b>Add screenshots</b></p>' +
      '<label class="field" for="ob-shot-new">Caption for the next screenshot<input id="ob-shot-new" maxlength="200" data-nav-safe placeholder="What it shows"' + errAt(ctx, 'ob-shot-new') + '></label>' + errMsg(ctx, 'ob-shot-new') +
      '<div class="row"><label class="btn" for="ob-shot-file">' + I('clip') + 'Choose files</label><input type="file" id="ob-shot-file" class="sr" accept="' + esc(A.SHOT_ACCEPT) + '" multiple' + (errOf(ctx, 'ob-shot-file') ? ' aria-invalid="true" aria-describedby="ferr-ob-shot-file ob-shot-hint"' : ' aria-describedby="ob-shot-hint"') + '>' +
      '<span class="small" id="ob-shot-hint">Or drop or paste images here. PNG, JPEG, WebP or GIF, up to 5 MB each.</span></div>' + errMsg(ctx, 'ob-shot-file') +
      '<p class="small" id="ob-shot-status" role="status">' + (busy ? 'Adding ' + busy + ' screenshot' + (busy === 1 ? '' : 's') + '…' : '') + '</p></div>';
  }

  /* After builder edits, the Markdown view lists the lines that changed since the draft was opened or saved. */
  function changedLines(base, text) {
    var d = O.diff(base, text), lines = String(text).split('\n');
    if (!d.added.length && !d.removed.length) return '';
    return '<details class="ob-changed"><summary>Changed lines · ' + d.added.length + ' new or changed' + (d.removed.length ? ', ' + d.removed.length + ' removed' : '') + '</summary><ol class="ob-lines">' +
      d.added.slice(0, 40).map(function (i) { return '<li><span class="small">Line ' + (i + 1) + '</span> <code>' + esc(lines[i].replace(/\r$/, '')) + '</code></li>'; }).join('') +
      (d.added.length > 40 ? '<li class="small">and ' + (d.added.length - 40) + ' more</li>' : '') + '</ol></details>';
  }

  V.builder = builder; V.builderForm = builderForm; V.obPartsPane = partsPane; V.changedLines = changedLines;
  V.obParts = parts; V.obPart = partOf; V.obPartsSheet = partsSheet; V.obSentence = sentence; V.obNowhere = nowhere;
})();
