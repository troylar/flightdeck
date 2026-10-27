/* The outline builder: the draft's phases as cards, its steps as rows, its lanes side by side and its gates as
   hazard-striped thresholds, edited by buttons, a side form, dragging or Alt+Up / Alt+Down, with a parts box to add from.
   It shows what PF.outline reads from the Markdown, and every change is an operation on that same text (app.js), so the
   Markdown editor and the builder always agree. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, T = PF.types, O = PF.outline, M = PF.map, I = PF.icons.icon, esc = U.esc;
  var LAND = 'Cleared to land here · or move with Alt+Up / Alt+Down';
  var LANES_SAY = 'Do all lanes. Finish every lane before the gate.';

  function teamTypes(ctx) { return (ctx.data.stepTypes || {}).types || {}; }
  /* One Pull request (2.6.0): GitHub's and Bitbucket's types are one choice in the pickers and the parts box, with the host
     as the step form's first question. Files keep writing the two IDs. A new one takes the host most of the checklist's pull
     requests use (GitHub when there are none, or a tie). */
  var PRS = ['github.pr', 'bitbucket.pr'], HOSTS = { 'github.pr': 'GitHub', 'bitbucket.pr': 'Bitbucket' };
  function isPr(id) { return PRS.indexOf(id) >= 0; }
  function prHost(text) {
    var o = O.parse(String(text || '')), n = function (id) { return (o.steps || []).filter(function (s) { return s.type === id; }).length; };
    return n('bitbucket.pr') > n('github.pr') ? 'bitbucket.pr' : 'github.pr';
  }
  /* Built-in types, then the team's, as select options; a type the step names that isn't known stays choosable. */
  function typeOptions(ctx, cur, host) {
    var team = teamTypes(ctx), ids = Object.keys(team).sort(), known = T.LIST.some(function (t) { return t.id === cur; }) || ids.indexOf(cur) >= 0;
    var opt = function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === cur ? ' selected' : '') + '>' + esc(T.nameOf(t)) + '</option>'; };
    /* A step that is a pull request keeps its host when Pull request is chosen again. */
    var builtIn = T.LIST.filter(function (t) { return !isPr(t.id) || t.id === (isPr(cur) ? cur : host || 'github.pr'); }).map(function (t) { return isPr(t.id) ? { id: t.id, label: 'Pull request' } : t; });
    return (cur && !known ? '<option value="' + esc(cur) + '" selected>{' + esc(cur) + '} (unknown type)</option>' : '') +
      '<optgroup label="Built-in">' + builtIn.map(opt).join('') + '</optgroup>' + (ids.length ? '<optgroup label="Your team\'s">' + ids.map(function (id) { return opt(team[id]); }).join('') + '</optgroup>' : '');
  }
  /* Rows are buttons, so the step text shows without its Markdown markers rather than as links inside a button. */
  function plain(s) { return String(s || '').replace(/\*\*|__|`/g, ''); }
  function selOf(ctx, p) { var s = ctx.state.obSel; return s && s.pid === p.id ? s : null; }
  function addOf(ctx, p) { var a = ctx.state.obAdd; return a && a.pid === p.id ? a : null; }
  /* A refused value shows its reason next to its field (app.js sets fieldErr { id: 'ob', field }). */
  function errOf(ctx, id) { var e = ctx.state.fieldErr; return e && e.id === 'ob' && e.field === id ? e : null; }
  function errAt(ctx, id) { return errOf(ctx, id) ? ' aria-invalid="true" aria-describedby="ferr-' + esc(id) + '"' : ''; }
  function errMsg(ctx, id) { var e = errOf(ctx, id); return e ? '<p class="ferr" id="ferr-' + esc(id) + '" role="alert">' + esc(e.msg) + '</p>' : ''; }
  /* ---------- entry boxes (2.6.0): PF.guide's question is a box's label, its example the placeholder, and its why sits
     under the box, read out with it after any error, then any flag ---------- */
  var G = PF.guide;
  function whyOf(id, g) { return g && g.why ? '<span class="small hint ob-why" id="why-' + esc(id) + '">' + esc(g.why) + '</span>' : ''; }
  function egOf(g) { return g && g.eg ? ' placeholder="' + esc(g.eg) + '"' : ''; }
  function described(ctx, id, g, more) { return [errOf(ctx, id) ? 'ferr-' + id : '', g && g.why ? 'why-' + id : ''].concat(more || []).filter(Boolean).join(' '); }
  function describe(ctx, id, g, more) { var d = described(ctx, id, g, more); return (errOf(ctx, id) ? ' aria-invalid="true"' : '') + (d ? ' aria-describedby="' + esc(d) + '"' : ''); }
  function flagOf(id, text) { return text ? '<span class="small ob-flag" id="flag-' + esc(id) + '">' + esc(text) + '</span>' : ''; }
  function nice(v) { v = String(v).replace(/-/g, ' '); return v.charAt(0).toUpperCase() + v.slice(1); }
  /* Up to five choices, as buttons in a radio group with one tab stop (the checked button, or the first). The tab stop
     carries the control's ID, so focus after a change or a refusal lands on it. Each button names its neighbors, for the
     arrow keys. none: the label of a first button that clears the choice, or null for one that is always set (a phase's
     mode). A stored value that isn't one of the options shows as one more checked button, as a select shows it. */
  function choices(ctx, id, g, opts, cur, none, names, flag) {
    var vals = (none != null ? [''] : []).concat(opts), want = String(cur || '').toLowerCase();
    var on = opts.filter(function (o) { return String(o).toLowerCase() === want; })[0];
    if (on == null && cur) { vals.push(cur); on = cur; }
    if (on == null && none != null) on = '';
    var stop = on != null ? on : vals[0], d = described(ctx, id, g, flag ? ['flag-' + id] : []);
    return '<div class="field"><span id="q-' + esc(id) + '">' + esc(g.q) + '</span><div class="seg ob-choices" role="radiogroup" aria-labelledby="q-' + esc(id) + '"' + (d ? ' aria-describedby="' + esc(d) + '"' : '') + (errOf(ctx, id) ? ' aria-invalid="true"' : '') + '>' +
      vals.map(function (v, k) {
        return '<button type="button" role="radio" class="ob-choice"' + (v === stop ? ' id="' + esc(id) + '"' : '') + ' data-act="ob-choice" data-id="' + esc(id) + '" data-val="' + esc(v) +
          '" data-prev="' + esc(vals[(k + vals.length - 1) % vals.length]) + '" data-next="' + esc(vals[(k + 1) % vals.length]) + '" aria-checked="' + (v === on) + '" tabindex="' + (v === stop ? 0 : -1) + '">' +
          esc(v === '' ? none : (names && Object.prototype.hasOwnProperty.call(names, v) && names[v]) || nice(v)) + '</button>';
      }).join('') + '</div>' + whyOf(id, g) + flagOf(id, flag) + '</div>' + errMsg(ctx, id);
  }
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
      { id: 'process', kind: 'step', group: 'Steps', label: 'Run another checklist', hint: 'Starts a linked run; done when that run completes', icon: 'nest', type: 'run.process', mark: ' ', text: 'Run another checklist', noun: 'a step that runs another checklist', keys: 'run.process child nested linked' }
    ];
    var team = teamTypes(ctx), typePart = function (t, team) {
      return { id: 'type:' + t.id, kind: 'step', group: T.groupOf(t).join(' / '), team: team, label: t.label, hint: t.id === 'ci.gate' ? 'Records a CI build or test result for a commit. Not a sign-off.' : t.hint || '', icon: t.icon, type: t.id, mark: ' ', text: t.label, noun: an(t.label + ' step'), keys: t.id + ' ' + T.tagsOf(t).join(' ') };
    };
    var mine = Object.keys(team).map(function (id) { return typePart(team[id], true); });
    mine.sort(function (a, b) { return a.group.localeCompare(b.group) || a.label.localeCompare(b.label); });
    out.forEach(function (pt) { pt.base = true; });
    /* pr: the type is the checklist's usual host, chosen when it's added (app.js, V.obPrHost). */
    var pr = Object.assign(typePart(T.get('github.pr'), false), { id: 'type:pr', label: 'Pull request', hint: 'Open, review or merge a pull request on GitHub or Bitbucket.', text: 'Pull request', noun: 'a pull request step', pr: true, keys: 'github.pr bitbucket.pr github bitbucket ' + T.tagsOf(T.get('github.pr')).join(' ') });
    return out.concat(mine, T.LIST.filter(function (t) { return t.id !== 'confirm' && t.id !== 'run.process' && !isPr(t.id); }).map(function (t) { return typePart(t, false); }).concat([pr]));
  }
  var QUICK = ['phase', 'gate', 'step', 'must'];
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
    /* Without a search: Phase, Gate, Step and Must-do, and every part under All parts (opened by hand, or while one of its
       parts is being placed). A search shows every match. A type that can't be used is never folded. */
    var fold = !q, rest = fold ? shown.filter(function (pt) { return QUICK.indexOf(pt.id) < 0; }) : shown, list = '';
    if (fold) h += '<ul class="ob-pgroup ob-quick">' + QUICK.map(function (id) { return all.filter(function (pt) { return pt.id === id; })[0]; }).map(btn).join('') + '</ul>';
    list += section('Structure', rest.filter(function (pt) { return pt.base && pt.group === 'Structure'; })) + section('Steps', rest.filter(function (pt) { return pt.base && pt.group === 'Steps'; }));
    var team = rest.filter(function (pt) { return pt.team; }), anyTeam = all.some(function (pt) { return pt.team; });
    var broken = errs.map(function (e) { return '<li class="ob-broken"><b>' + esc(e.file) + '</b><span class="small">Can\'t use this type yet.</span> <button type="button" class="linkish" data-act="open-types">View errors</button></li>'; }).join('');
    if (team.length || (broken && !fold) || (!anyTeam && !q)) {
      list += '<div class="ob-pgroup"><h4>Your team\'s step types</h4>' + (!anyTeam && !q ? '<p class="small">None yet. <button type="button" class="linkish" data-act="new-type">Create a step type</button></p>' : '') + '</div>';
      by(team).forEach(function (g) { list += section(g[0], g[1], '', true); });
      if (broken && !fold) list += '<ul class="ob-pgroup">' + broken + '</ul>';
    }
    var built = rest.filter(function (pt) { return !pt.base && !pt.team; });
    if (built.length) { list += '<div class="ob-pgroup"><h4>Built-in step types</h4></div>'; by(built).forEach(function (g) { list += section(g[0], g[1], '', true); }); }
    if (fold) {
      var open = (st.disc || {})['ob-all'] || (pl && QUICK.indexOf(pl.part) < 0), label = 'All parts (' + all.length + ')';
      h += '<details class="ob-all" data-disc="ob-all"' + (open ? ' open' : '') + '><summary class="ob-all-sum" title="' + esc(label) + '"><span class="ob-pic g-ty" aria-hidden="true">' + I('plus') + '</span><span class="ob-all-t">' + esc(label) + '</span></summary><div class="ob-all-list">' + list + '</div></details>';
      if (broken) h += '<div class="ob-pgroup"><h4>Your team\'s step types</h4></div><ul class="ob-pgroup">' + broken + '</ul>';
    } else h += list;
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
  function addStepForm(ctx, B) {
    return '<li class="ob-addform"><div class="row"><label class="sr" for="ob-new-text">New step: ' + esc(G.step('text').q) + '</label><input id="ob-new-text" maxlength="200"' + egOf(G.step('text')) + ' data-enter="ob-add-go"' + describe(ctx, 'ob-new-text', G.step('text')) + '>' +
      '<label class="sr" for="ob-new-type">Type of the new step</label><select id="ob-new-type">' + typeOptions(ctx, (ctx.state.obAdd && ctx.state.obAdd.type) || 'confirm', B && B.prHost) + '</select>' +
      '<button type="button" class="btn go" data-act="ob-add-go">Add step</button><button type="button" class="mini" data-act="ob-add-cancel">Cancel</button></div>' + errMsg(ctx, 'ob-new-text') + '' + whyOf('ob-new-text', G.step('text')) + '</li>';
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
      '<button type="button" class="ob-pick" data-act="ob-sel" data-id="' + esc(s.key) + '" aria-pressed="' + on + '" aria-describedby="ob-kbd">' + (t ? I(t.icon, T.nameOf(t)) : I('check', 'Unknown type')) +
      '<span class="ob-row"><span class="ob-txt">' + esc(plain(s.text)) + '</span>' + (meta ? '<span class="ob-meta">' + meta + '</span>' : '') + '</span></button></li>';
  }
  /* One group of steps: the steps before any lane (g = -1) or one lane's. */
  function groupList(ctx, p, ph, g, sel, add, B, label) {
    var h = '';
    ph.steps.filter(function (s) { return s.track === g; }).forEach(function (s) {
      h += stepRow(ctx, p, s, sel, B);
      if (add && add.kind === 'step' && add.after === s.key) h += addStepForm(ctx, B);
    });
    h += slot(B, 'li', 'step', 'end:' + ph.key + ':' + g, '');
    h += add && add.kind === 'step' && add.after == null && add.phase === ph.key && +add.track === g ? addStepForm(ctx, B) :
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
      (ph.mode ? '<span class="cat mode">' + esc(K.modeWord(ph.mode)) + '</span>' : '<span class="cat mode">No mode</span>') + fixBadge(B, ph.id && 'phase:' + ph.id) + '</div><div class="ob-body">' + body + '</div>' + gate + '</li>';
  }

  /* The checklist's own details (front matter): who owns it, its roles and its run details, at a glance; selecting it opens
     their form. */
  function personName(ctx, id) { var x = (ctx.data.people || []).filter(function (q) { return q.id === id; })[0]; return x ? x.name : id; }
  function detailsCard(ctx, map, sel) {
    var m = map.meta, on = !!sel && sel.kind === 'details';
    return '<div class="ob-details' + (on ? ' sel' : '') + '"><button type="button" class="ob-det" data-act="ob-sel-details" aria-pressed="' + on + '">' + I('people') +
      '<span class="ob-row"><span class="ob-txt">Checklist details</span><span class="ob-meta"><span class="small">' + (m.owner ? 'Owner ' + esc(personName(ctx, m.owner)) : 'No owner yet') + (m.backup ? ' · backup ' + esc(personName(ctx, m.backup)) : '') + '</span>' +
      (m.roles.length ? '<span class="ob-role">@' + esc(m.roles.join(' @')) + '</span>' : '<span class="small">No roles</span>') +
      (m.context.length ? m.context.map(function (c) { return '<span class="ob-chip">^' + esc(c) + '</span>'; }).join('') : '<span class="small">No run details</span>') + '</span></span></button></div>';
  }

  /* The outline pane of the full-page editor. The parts pane (partsPane) and the inspector sit beside it (manage.js). */
  function builder(ctx, p, text) {
    var o = O.parse(text), sel = selOf(ctx, p), add = addOf(ctx, p), map = M.parse(text), h = '';
    if (o.unsupported) return '<div class="notice warn"><span>The builder can\'t edit this draft safely: ' + esc(o.unsupported) + ' Use Markdown instead.</span><button class="mini" data-act="ed-mode" data-id="markdown">Markdown</button></div>';
    var B = placing(ctx, p, text, o); B.fix = PF.corrections.openCounts(V.fixesOf(ctx, p)); B.prHost = prHost(text);
    if (map.errors.length) h += '<div class="notice warn"><span>' + map.errors.length + ' line' + (map.errors.length === 1 ? ' isn\'t' : 's aren\'t') + ' understood (see Checks). The builder keeps ' + (map.errors.length === 1 ? 'it' : 'them') + ' exactly as written; fix ' + (map.errors.length === 1 ? 'it' : 'them') + ' in Markdown.</span></div>';
    if (o.questions >= 0) h += '<div class="notice warn" id="ob-q-note"><span>It still has a Questions section, so it can\'t be published yet. Answer the questions, then remove the section.</span><button type="button" class="btn" data-act="ob-sel-questions">Open the Questions</button></div>';
    h = strip(B, o) + h + '<div class="row between ob-bar"><details class="ob-help"><summary>Editing help</summary><p id="ob-kbd" class="small">Drag a part onto the checklist, or choose one and pick a place with the arrow keys. Drag a step by its grip, or select it and press Alt+Up or Alt+Down to move it. Select a step, lane, phase or gate to change it, its note included. Checklist details sets the owner, the backup owner, the roles and the run details.</p></details>' +
      '<button type="button" class="btn ob-addpart" data-act="ob-parts-open">' + I('plus') + 'Add part</button></div>' + detailsCard(ctx, map, sel);
    var gT = G.form('ph-title'), gM = G.form('ph-mode');
    var phaseForm = '<div class="ob-addform"><div class="row"><label class="sr" for="ob-new-title">New phase: ' + esc(gT.q) + '</label><input id="ob-new-title" maxlength="120"' + egOf(gT) + ' data-enter="ob-add-go"' + describe(ctx, 'ob-new-title', gT) + '>' +
      '<button type="button" class="btn go" data-act="ob-add-go">Add phase</button><button type="button" class="mini" data-act="ob-add-cancel">Cancel</button></div>' + whyOf('ob-new-title', gT) + errMsg(ctx, 'ob-new-title') +
      choices(ctx, 'ob-new-mode', gM, ['READ-DO', 'DO-CONFIRM'], (add && add.mode) || 'READ-DO', null, { 'READ-DO': 'Read, then do', 'DO-CONFIRM': 'Do, then confirm' }) + '</div>';
    var addingPhase = add && add.kind === 'phase', out = '<ol class="ob-phases" aria-label="Phases">' + slot(B, 'li', 'phase', 'phase:^', 'h') +
      o.phases.map(function (ph) { return phaseCard(ctx, o, p, ph, sel, add, B) + (addingPhase && add.after === ph.key ? '<li>' + phaseForm + '</li>' : '') + slot(B, 'li', 'phase', 'phase:' + ph.key, 'h'); }).join('') + '</ol>';
    if (addingPhase && add.after == null) out += phaseForm;
    else if (!o.phases.length) out += '<div class="ob-empty"><p><b>This checklist is empty.</b> Start with a phase: a stage of the work, like Prepare or Deploy. Then add its steps.</p><button type="button" class="btn go" data-act="ob-add-phase">' + I('plus') + 'Add your first phase</button></div>';
    else out += '<button type="button" class="mini ob-addphase" data-act="ob-add-phase">' + I('plus') + 'Add a phase</button>';
    h += out;
    return '<div class="ob' + (B.pt ? ' placing for-' + B.pt.kind : '') + '" id="ob">' + h + '</div>';
  }

  /* ---------- the side form ---------- */
  /* A text box from the guide's form entries (FORMS): attrs are the control's own (maxlength, data-enter, value). */
  function formBox(ctx, id, name, tag, attrs, body) {
    var g = G.form(name), open = '<' + tag + ' id="' + id + '"' + attrs + egOf(g) + describe(ctx, id, g) + '>';
    return '<label class="field" for="' + id + '">' + esc(g.q) + open + (tag === 'textarea' ? body + '</textarea>' : '') + '</label>' + whyOf(id, g) + errMsg(ctx, id);
  }
  /* A box that knows the run details (2.7, views/detailbox.js), with the guide's example, why line and error as other boxes. */
  var DBX = { text: 1, code: 1, message: 1, url: 1, list: 1 }, here = null;
  function detailBox(ctx, id, kind, g, attrs, value, at, more) {
    return V.dbx.box({ id: id, kind: kind, tag: kind === 'step' ? 'textarea' : 'input', attrs: attrs + egOf(g) + (errOf(ctx, id) ? ' aria-invalid="true"' : ''), value: value, label: g.q, at: at, map: here.map, vals: here.vals,
      describedBy: described(ctx, id, g, more), after: whyOf(id, g) + (more && more.after || '') + errMsg(ctx, id) });
  }
  function formSelect(ctx, id, name, options) { var g = G.form(name); return '<label class="field" for="' + id + '">' + esc(g.q) + '<select id="' + id + '" data-bound' + describe(ctx, id, g) + '>' + options + '</select></label>' + whyOf(id, g) + errMsg(ctx, id); }
  var PROOF = { link: 'Link', note: 'Note', number: 'Number', 'yes-no': 'Yes/no', date: 'Date' };
  /* flag: why a value is kept that the step doesn't use (another action's field, one the type doesn't have, a second time). */
  function fieldRow(ctx, def, s, name, flag) {
    var known = T.fieldDef(def, name), d = known || { label: name, kind: 'text' }, v = s.fields[name] || '', id = 'ob-fld-' + name;
    var g = known ? G.field(def, name, s.fields) : { q: name, eg: '', why: '' }, fl = flag ? ['flag-' + id] : [];
    var opts = d.kind === 'choice' ? T.options(d, s.fields) : [];
    if (!flag && v && opts.length && !T.hasOption(d, s.fields, v)) { flag = '{' + (s.type || '') + '} doesn\'t have ' + v + '. Pick one of: ' + opts.join(', ') + '.'; fl = ['flag-' + id]; }
    if (opts.length && opts.length <= 5) return choices(ctx, id, g, opts, v, 'Not set', name === 'evidence' ? PROOF : null, flag);
    if (opts.length) {
      var list = opts.indexOf(v) < 0 && v ? opts.concat([v]) : opts;
      return '<label class="field" for="' + esc(id) + '">' + esc(g.q) + '<select id="' + esc(id) + '" data-bound' + describe(ctx, id, g, fl) + '><option value=""' + (v ? '' : ' selected') + '>Not set</option>' + list.map(function (x) { return '<option value="' + esc(x) + '"' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></label>' + whyOf(id, g) + flagOf(id, flag) + errMsg(ctx, id);
    }
    if (here && DBX[d.kind] && PF.refs.fillable(s.type, name, teamTypes(ctx))) { var more = fl.slice(); more.after = flagOf(id, flag); return detailBox(ctx, id, 'field', g, ' maxlength="300" data-enter="ob-commit"', v, here.at, more); }
    return '<label class="field" for="' + esc(id) + '">' + esc(g.q) + '<input id="' + esc(id) + '" maxlength="300" data-enter="ob-commit" value="' + esc(v) + '"' + egOf(g) + describe(ctx, id, g, fl) + '></label>' + whyOf(id, g) + flagOf(id, flag) + errMsg(ctx, id);
  }
  function ownKey(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function condText(c) { return Object.keys(c).map(function (k) { return 'the ' + k + ' is ' + c[k]; }).join(' and '); }
  /* What must be recorded (require:): only names it accepts, the type's records and All, each a toggle; what other
     mechanisms already need shows fixed beside them, never written into require:. A name it doesn't accept (after a type
     change, say) is kept, marked, and removed by pressing it. */
  function requireRow(ctx, def, s, ev) {
    var id = 'ob-fld-require', g = G.field(def, 'require', s.fields), cur = String(s.fields.require || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    var recs = (def && def.record) || [], names = recs.map(function (r) { return r.name; }).concat(['all']);
    var chip = function (n, extra, bad) { return '<button type="button" class="chipbtn ob-req' + (bad ? ' bad" data-bad="1' : '') + '" data-act="ob-req" data-id="' + esc(n) + '" aria-pressed="' + (cur.indexOf(n) >= 0) + '">' + esc(n === 'all' ? 'All' : n) + (extra ? ' <span class="small">' + esc(extra) + '</span>' : '') + '</button>'; };
    var h = names.map(function (n) { var r = recs.filter(function (x) { return x.name === n; })[0]; return chip(n, r && r.when && !Object.keys(r.when).every(function (k) { return String(s.fields[k] || '').toLowerCase() === r.when[k]; }) ? 'Only asked when ' + condText(r.when) : ''); }).join('') +
      cur.filter(function (n) { return names.indexOf(n) < 0; }).map(function (n) { return chip(n, '{' + s.type + '} doesn\'t record ' + n + '. Publishing refuses it; press to remove it.', true); }).join('');
    var ev0 = String(s.fields.evidence || '').toLowerCase(), fixed = [];
    if (ownKey(PROOF, ev0)) fixed.push('Needed: ' + (ev0 === 'yes-no' ? 'a yes or no' : 'a ' + PROOF[ev0].toLowerCase()) + ' (from Ask for proof)');
    String(s.fields.sets || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (d) { fixed.push('Needed: ^' + d + ' (from Sets a run detail)'); });
    ((ev && ev.list) || []).forEach(function (d) { if (d.jira) fixed.push('Needed: ' + d.label + ' (from the team\'s Jira workflow)'); });
    return '<div class="field"><span id="q-' + id + '">' + esc(g.q) + '</span><div class="row ob-grp" id="' + id + '" tabindex="-1" role="group" aria-labelledby="q-' + id + '" aria-describedby="' + described(ctx, id, g) + '">' + h +
      fixed.map(function (f) { return '<span class="chip ob-needed">' + esc(f) + '</span>'; }).join('') + '</div>' + whyOf(id, g) + '</div>' + errMsg(ctx, id);
  }
  /* Sets a run detail (sets:): the checklist's run details as toggles; a name that isn't one of them is kept, marked, and
     removed by pressing it. */
  function setsRow(ctx, def, s, meta) {
    var id = 'ob-fld-sets', g = G.field(def, 'sets', s.fields), cur = String(s.fields.sets || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean), all = (meta && meta.context) || [];
    var chip = function (n, bad) { return '<button type="button" class="chipbtn ob-req' + (bad ? ' bad" data-bad="1' : '') + '" data-act="ob-sets" data-id="' + esc(n) + '" aria-pressed="' + (cur.indexOf(n) >= 0) + '">^' + esc(n) + (bad ? ' <span class="small">Not one of this checklist\'s run details; press to remove it.</span>' : '') + '</button>'; };
    var h = all.map(function (n) { return chip(n); }).join('') + cur.filter(function (n) { return all.indexOf(n) < 0; }).map(function (n) { return chip(n, true); }).join('');
    return '<div class="field"><span id="q-' + id + '">' + esc(g.q) + '</span><div class="row ob-grp" id="' + id + '" tabindex="-1" role="group" aria-labelledby="q-' + id + '" aria-describedby="' + described(ctx, id, g) + '">' +
      (h || '<span class="small">The checklist lists no run details yet.</span>') + '</div>' + whyOf(id, g) + '</div>' + errMsg(ctx, id);
  }
  /* What checking the step asks for, read the way the run reads it (R.evidenceFor), given what practice gives it: the
     draft's admitted map, the team's types and Jira workflows (core/practice.js). Kept per text, as a redraw is often. */
  var admitted = { text: null, env: null, out: null };
  function evidenceOf(ctx, text, o, s) {
    var PR = PF.practice, types = teamTypes(ctx), wk = ctx.data.jira && ctx.data.jira.workflows;
    if (admitted.text !== text || admitted.types !== types || admitted.wk !== wk) admitted = { text: text, types: types, wk: wk, out: PR.admit(text, PR.env(types, wk)) };
    var a = admitted.out; if (!a || !a.ok) return null;
    var all = M.steps(a.map), at = o.steps.indexOf(s), x = s.id ? all.filter(function (y) { return y.step.id === s.id; })[0] : all[at];
    if (!x) return null;
    var r = PR.asRun({ sample: {}, steps: {}, gates: {}, fields: {} }, a.map, null, false, PR.env(types, wk));
    return PF.run.evidenceFor(r, x.step, null, a.map);
  }
  function recordsSection(def, ev) {
    if (!ev || !ev.list.length) return '';
    return '<section class="ob-records" aria-labelledby="ob-rec-h"><h3 class="ob-sec" id="ob-rec-h">When it\'s checked, they record</h3><ul>' + ev.list.map(function (d) {
      var g = G.record(def, d, ev.fields);
      return '<li><b>' + esc(g.q) + '</b>' + (d.required ? ' <span class="small">needed to check it</span>' : '') + '<span class="small hint">' + esc(g.why) + '</span></li>';
    }).join('') + '</ul></section>';
  }
  /* The boxes revealed in this window for the step shown (state.obShown, never written): kept while it stays selected. */
  function shownOf(ctx, p, s) { var sh = ctx.state.obShown; return sh && sh.key === ctx.fsKey + '\n' + p.id + '\n' + s.key ? sh.names : {}; }
  function addChip(def, name, g) { return '<button type="button" class="chipbtn ob-add-chip" data-act="ob-show" data-id="' + esc(name) + '" aria-label="Add: ' + esc(g.q) + '">+ ' + esc(G.chip(def, name)) + '</button>'; }
  /* A step's fields: the type's that apply, shown when usual for it as it stands, holding a value or revealed (or else its
     first two), the rest behind "+ add" chips; then any value it doesn't use, flagged; then the fields every type accepts,
     under More about this step. */
  /* The child a linked step names, for the builder (2.8): the pinned version, or the latest published, or (not published
     yet) its saved draft, which can't be checked until it's published. { map, title, version, latest, draft, nextAdds } */
  function linkChildOf(ctx, process, version) {
    var e = process && ctx.procOf ? ctx.procOf(process) : null; if (!e) return null;
    var dm = null; if (e.draft && e.draft.md != null) { try { dm = M.parse(e.draft.md); } catch (x) { dm = null; } }
    if (version) { var at = PF.pins.atVersion(e, process, +version); return at.pub ? { map: at.pub.map, title: at.pub.map.meta.title || process, version: at.pub.info.version } : null; }
    if (e.latest) {
      var adds = dm ? dm.meta.context.filter(function (n) { return e.latest.map.meta.context.indexOf(n) < 0; }) : [];
      return { map: e.latest.map, title: e.latest.map.meta.title || process, version: e.latest.info.version, latest: true, nextAdds: adds };
    }
    return dm ? { map: dm, title: dm.meta.title || process, version: null, latest: true, draft: true } : null;
  }
  /* A {run.process} step's own section (2.8): which process, which version, and what each of its details gets. Every change
     is one O.editLink. */
  function linkSection(ctx, p, text, s, meta) {
    var f = s.fields, map = M.parse(text), x = O.mapStep(map, s) || { step: null }, st = x.step; if (!st) return '';
    var procs = ctx.processes().filter(function (e) { return e.id !== meta.process; }), other = ctx.state.obLinkOther === s.key || (f.process && !procs.some(function (e) { return e.id === f.process; }));
    var h = '<h3 class="ob-sec">Which process</h3><label class="field" for="ob-link-proc">' + esc(G.form('link-proc').q) + '<select id="ob-link-proc" data-bound><option value=""' + (!f.process ? ' selected' : '') + '>Choose one</option>' +
      procs.map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === f.process && !other ? ' selected' : '') + '>' + esc((e.title || e.id) + ' (' + e.id + ') · ' + (e.latest ? 'v' + e.latest.info.version : 'not published yet')) + '</option>'; }).join('') +
      '<option value="__other"' + (other ? ' selected' : '') + '>Other ID…</option></select></label>';
    if (other) h += '<label class="field" for="ob-link-proc-other">' + esc(G.form('link-proc-other').q) + '<input id="ob-link-proc-other" maxlength="60" value="' + esc(f.process || '') + '" data-enter="ob-commit"></label>';
    var e = f.process && ctx.procOf ? ctx.procOf(f.process) : null;
    if (f.process && e) {
      var types = T.freeze(M.usedTypes(map), (ctx.data.stepTypes || {}).types || {}), two = PF.publish.features(map, types).length > 0;
      var nums = []; (e.all || []).forEach(function (v) { if (nums.indexOf(v.info.version) < 0) nums.push(v.info.version); });
      nums.sort(function (a, b) { return b - a; });
      var pinned = !!f.version;
      h += '<fieldset class="field"><legend>Which version</legend><label class="ob-switch" for="ob-link-ver-latest"><input type="radio" name="ob-link-ver" id="ob-link-ver-latest" value="latest" data-bound' + (pinned ? '' : ' checked') + '><span><b>' + (two ? 'Latest when this run starts' : 'Latest when the child starts') + '</b></span></label>';
      if (nums.length) h += '<label class="ob-switch" for="ob-link-ver-pin"><input type="radio" name="ob-link-ver" id="ob-link-ver-pin" value="pin" data-bound' + (pinned ? ' checked' : '') + '><span><b>Always one version</b></span></label>';
      /* Which version is asked only once one is pinned. */
      if (nums.length && pinned) h += '<label class="field" for="ob-link-vn">' + esc(G.form('link-vn').q) + '<select id="ob-link-vn" data-bound>' +
        nums.map(function (n) { var at = PF.pins.atVersion(e, f.process, n); return '<option value="' + n + '"' + (String(n) === String(f.version) ? ' selected' : '') + (at.why ? ' disabled' : '') + '>v' + n + (at.why ? ' (' + esc(at.why) + ')' : '') + '</option>'; }).join('') + '</select></label>';
      h += '</fieldset>';
    }
    var kid = f.process ? linkChildOf(ctx, f.process, f.version) : null;
    if (!kid) return h + (f.process ? '<p class="small">' + esc(f.process) + ' isn\'t in this folder, so what it needs can\'t be shown.</p>' : '');
    var rr = PF.links.rows(st, meta.context, kid.map), setBy = M.setBy(kid.map), fixed = ctx.state.obLinkFixed || {}, t = kid.title;
    h += '<h3 class="ob-sec">What ' + esc(t) + ' needs</h3>' + (kid.draft ? '<p class="small">' + esc(t) + ' isn\'t published yet, so this can\'t be checked until it is.</p>' : '') +
      (kid.nextAdds && kid.nextAdds.length ? '<p class="small">' + esc(t) + '\'s draft adds ^' + kid.nextAdds.map(esc).join(', ^') + '.</p>' : '');
    /* Before 2.8 (no pass: line) nothing is asked: a name with no source starts empty ("Not passed"). Choosing Asked writes
       name=?, which gives the step a pass: line. */
    var asks = function (n) { return PF.links.has(st) || (!PF.links.carryList(st).length && meta.context.indexOf(n) >= 0); };
    var kinds = meta.detailTypes || {}, kindOf = function (n) { return ownKey(kinds, n) && kinds[n] ? ' (' + esc(kinds[n].kind || 'text') + ')' : ''; };
    rr.rows.forEach(function (r) {
      var sid = 'ob-link-src-' + r.name, cur = r.source === 'value' || fixed[s.key + ':' + r.name] ? '=' : r.source === 'detail' ? '^' + r.from : r.source === 'team' ? 'team:' + r.team : ownKey(setBy, r.name) || asks(r.name) ? '?' : '-';
      h += '<div class="field ob-link-row"><label for="' + esc(sid) + '"><b>' + esc(r.name) + '</b> <span class="small">' + esc(r.kind) + (ownKey(setBy, r.name) ? ' · ' + esc(t) + ' also sets this itself, later' : '') + '</span></label><select id="' + esc(sid) + '" data-bound>' +
        meta.context.map(function (n) { return '<option value="^' + esc(n) + '"' + (cur === '^' + n ? ' selected' : '') + '>This run\'s ^' + esc(n) + kindOf(n) + '</option>'; }).join('') +
        teamOpts(ctx, cur) + '<option value="="' + (cur === '=' ? ' selected' : '') + '>A fixed value</option><option value="?"' + (cur === '?' ? ' selected' : '') + '>' + (ownKey(setBy, r.name) ? esc(t) + ' fills this in itself' : 'Asked when ' + esc(t) + ' starts') + '</option>' +
        (cur === '-' ? '<option value="-" selected>Not passed: ' + esc(t) + ' starts without it</option>' : '') + '</select>';
      if (r.source === 'team') h += teamNote(ctx, r.team, t);
      if (cur === '=') h += '<label class="field" for="ob-link-val-' + esc(r.name) + '">' + esc(G.form('link-val').q) + '<input id="ob-link-val-' + esc(r.name) + '" maxlength="120" value="' + esc(r.value || '') + '" data-enter="ob-commit"' + errAt(ctx, 'ob-link-val-' + r.name) + '></label>' + errMsg(ctx, 'ob-link-val-' + r.name);
      h += '</div>';
    });
    rr.stale.forEach(function (x) {
      h += '<div class="notice warn" role="status"><span>' + esc(t) + (kid.version ? ' v' + esc(kid.version) : '') + ' has no run detail ' + esc(x.name) + ', so this step can\'t pass it.</span><button type="button" class="mini" data-act="ob-link-rm" data-id="' + esc(s.key) + '" data-name="' + esc(x.name) + '">Remove ^' + esc(x.name) + ' from what\'s passed</button></div>';
    });
    return h;
  }
  /* "A team value" (2.9): each name in team-values.json, with what it's for; one the step names that isn't there stays
     shown, flagged. */
  function teamOpts(ctx, cur) {
    var tv = ctx.data.teamValues, vals = tv && tv.state === 'ok' && tv.doc ? tv.doc.values : {}, names = Object.keys(vals).sort(), h = '';
    names.forEach(function (n) { h += '<option value="team:' + esc(n) + '"' + (cur === 'team:' + n ? ' selected' : '') + '>Team value ' + esc(n) + (vals[n].about ? ': ' + esc(vals[n].about) : '') + '</option>'; });
    if (/^team:/.test(cur) && names.indexOf(cur.slice(5)) < 0) h += '<option value="' + esc(cur) + '" selected>Team value ' + esc(cur.slice(5)) + ' (not in this folder)</option>';
    return h ? '<optgroup label="A team value">' + h + '</optgroup>' : '';
  }
  function teamNote(ctx, name, t) {
    var l = PF.teamValues.lookup(ctx.data.teamValues, name);
    if (l.value != null) return '<p class="small">Now <code>' + esc(l.value) + '</code>. It\'s read when ' + esc(t) + ' starts, so a later change in Settings › Team values is what new runs get.</p>';
    if (l.missing) return '<div class="notice warn" role="status"><span>' + esc(name) + ' isn\'t a team value in this folder. Add it in Settings › Team values, or pass something else.</span></div>';
    return '<div class="notice warn" role="status"><span>' + esc(l.why) + '</span></div>';
  }
  function fieldsSection(ctx, p, text, o, s, def, meta) {
    var f = s.fields, shown = shownOf(ctx, p, s), names = def ? Object.keys(def.fields || {}) : [];
    var pins = def && !def.custom && ownKey(T.PINS, def.id) ? Object.keys(T.PINS[def.id]) : [];
    var apply = names.filter(function (n) { return T.applies(def, n, f); }).concat(pins);
    /* A linked step's process, version, carry: and pass: are its own section (2.8). */
    var linked = s.type === 'run.process' && def && !def.custom;
    if (linked) apply = apply.filter(function (n) { return ['process', 'version', 'carry', 'pass'].indexOf(n) < 0; });
    var show = function (n) { return !!f[n] || !!shown[n] || (ownKey(def.fields, n) && G.usual(def.fields[n], f)); };
    var rows = apply.filter(show); if (!rows.length) rows = apply.slice(0, 2);
    var common = Object.keys(T.COMMON), times = ['at', 'due', 'after'].filter(function (n) { return f[n]; });
    /* A box the step doesn't use stays while it holds a value, or was just cleared and still has focus (it's in shown). */
    var unused = Object.keys(f).concat(Object.keys(shown).filter(function (n) { return !ownKey(f, n); })).filter(function (n) { return apply.indexOf(n) < 0 && common.indexOf(n) < 0 && !(linked && ['process', 'version', 'carry', 'pass'].indexOf(n) >= 0); });
    var flag = function (n) {
      var d = def && ownKey(def.fields, n) ? def.fields[n] : null;
      if (!T.fieldDef(def, n)) return '{' + (s.type || '') + '} doesn\'t use this; publishing will refuse it.';
      if (d && d.requiredWhen) return 'Only used when ' + condText(d.requiredWhen) + '.';
      if (d && d.requiredUnless) return 'Not used when ' + condText(d.requiredUnless) + '.';
      return times.length > 1 && times.indexOf(n) >= 0 ? 'Give one time, "at:", "due:" or "after:", not more than one.' : '';
    };
    var waiting = apply.filter(function (n) { return rows.indexOf(n) < 0; });
    var h = (linked ? linkSection(ctx, p, text, s, meta) : '') + '<h3 class="ob-sec">Fields</h3>' + (isPr(s.type) ? choices(ctx, 'ob-host', G.form('pr-host'), PRS, s.type, null, HOSTS) : '') + (!names.length && !pins.length && !unused.length ? '<p class="small">This type asks for nothing more.</p>' : '') +
      rows.map(function (n) { return fieldRow(ctx, def, s, n); }).join('') + unused.map(function (n) { return fieldRow(ctx, def, s, n, flag(n)); }).join('') +
      (waiting.length ? '<div class="row ob-adds" role="group" aria-label="More boxes for this step">' + waiting.map(function (n) { return addChip(def, n, G.field(def, n, f)); }).join('') + '</div>' : '');
    var ev = evidenceOf(ctx, text, o, s), cRows = common.filter(function (n) { return !!f[n] || !!shown[n]; }), cWait = common.filter(function (n) { return cRows.indexOf(n) < 0; });
    h += cRows.map(function (n) { return n === 'require' ? requireRow(ctx, def, s, ev) : n === 'sets' ? setsRow(ctx, def, s, meta) : fieldRow(ctx, def, s, n, flag(n)); }).join('');
    if (cWait.length) h += '<div class="field ob-more"><span id="ob-more-l">More about this step</span><div class="row" role="group" aria-labelledby="ob-more-l">' + cWait.map(function (n) { return addChip(def, n, G.field(def, n, f)); }).join('') + '</div></div>';
    return h + recordsSection(def, ev);
  }
  /* On a phone the form is a sheet over the outline; Done closes it. */
  /* The selected item's name, Previous / Next through the steps, and on a phone Done to close the sheet. */
  /* crumbs: where it is, as a trail (Verify in production / Product checks / Step 11 of 14). */
  /* While a practice is open for this draft, the form (a sheet on a phone) also goes straight back to it. */
  var backToPractice = false;
  function formHead(title, crumbs, prev, next) {
    return '<div class="ob-form-top"><div class="row between"><h2 id="ob-form-h">' + I('edit') + esc(title) + '</h2><span class="row">' + (backToPractice ? '<button type="button" class="mini ob-practice" data-act="pr-open">Back to practice</button>' : '') + '<button type="button" class="mini ob-done" data-act="ob-done">Close</button></span></div>' +
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
  /* Conditions (2.1): one quiet "Only when…" line, opened when there are conditions, a refusal, or someone opened it (kept per
     checklist and item, so a step with the same ID elsewhere doesn't open with it). One
     condition a line, as the checklist writes them after "only when". Lines written another way are shown and left to
     Markdown, never rewritten. */
  function whenSection(ctx, p, t, id, meta) {
    if (!t.when.length && (!meta.context.length || t.odd)) return '';
    var fe = ctx.state.fieldErr, err = !!(fe && fe.id === 'ob' && fe.field === id), dk = id + ':' + p.id + ':' + t.key, open = t.when.length || err || (ctx.state.disc || {})[dk] === true;
    var h = '<details class="ob-when" data-disc="' + esc(dk) + '"' + (open ? ' open' : '') + '><summary>Only when…</summary>';
    if (t.whenOdd || t.odd) return h + '<ul class="small">' + t.when.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul><p class="small">Written in a way the builder can\'t keep exactly. Edit them in Markdown.</p></details>';
    return h + formBox(ctx, id, id === 'ob-ph-when' ? 'ph-when' : 'when', 'textarea', ' rows="2"', '\n' + esc(t.when.join('\n'))) + '</details>';
  }
  /* Part G (2.8): what the step uses, sets and, for a linked step, passes to its child, said once below its fields. */
  function ioLines(ctx, map, s) {
    var x = O.mapStep(map, s); if (!x) return '';
    var st = x.step, f = st.fields || {}, got = st.type === 'run.process' && f.process && ctx.procOf ? PF.links.childrenFrom(ctx.procOf)(f.process, f.version || '') : null;
    var io = PF.links.io(map, st, got && got.map ? got.map : null, { types: teamTypes(ctx) }), out = [];
    if (io.uses.length) out.push('<b>Uses:</b> ' + io.uses.map(function (u) { return '<code>^' + esc(u.name) + '</code> (' + esc(u.where) + ')'; }).join(', '));
    if (io.sets.length) out.push('<b>Sets:</b> ' + io.sets.map(function (n) { return '<code>^' + esc(n) + '</code>'; }).join(', '));
    if (io.passes) {
      var given = io.passes.filter(function (r) { return r.source !== 'ask'; });
      out.push('<b>Passes to ' + esc(got.title) + ':</b> ' + (given.length ? given.map(function (r) { return esc(r.name) + (r.source === 'value' ? ' = ' + esc(r.value) : r.source === 'team' ? ' ← team value ' + esc(r.team) : ' ← ^' + esc(r.from)); }).join(', ') : 'nothing') + ioRest(io.passes, st, got.map));
    } else if (io.shared) out.push('May also pass details ' + esc(f.process || 'the other checklist') + ' shares with this checklist.');
    return out.length ? '<div class="small ob-io">' + out.map(function (l) { return '<p>' + l + '</p>'; }).join('') + '</div>' : '';
  }
  /* The rest of a linked step's summary: what the child fills in itself, and what's asked when it starts (a pass: step) or
     starts empty (before 2.8, nothing is asked). */
  function ioRest(rows, st, cmap) {
    var setBy = M.setBy(cmap), left = rows.filter(function (r) { return r.source === 'ask'; }), self = left.filter(function (r) { return ownKey(setBy, r.name); }), rest = left.filter(function (r) { return !ownKey(setBy, r.name); });
    var names = function (a) { return a.map(function (r) { return esc(r.name); }).join(', '); };
    return (rest.length ? (PF.links.has(st) ? '; asks ' : '; starts without ') + names(rest) : '') + (self.length ? '; fills in ' + names(self) + ' itself' : '');
  }
  function askOf(ctx, kind, key, track) { var a = ctx.state.obAsk; return a && a.kind === kind && a.key === key && (track == null || +a.track === +track) ? a : null; }
  /* The side form for what's selected: a step's text, kind, type, roles, run details and fields; a lane; or a phase and its
     gate. Text boxes apply when you leave them (or press Enter); choices apply at once. */
  function builderForm(ctx, p, text) {
    var sel = selOf(ctx, p); here = null; if (!sel) return '';
    backToPractice = !!(ctx.state.practicing || {})[ctx.fsKey + '\n' + p.id];
    var o = O.parse(text); if (o.unsupported) return '';
    var meta = M.parse(text).meta;
    if (sel.kind === 'details') return detailsForm(ctx, o, meta, text);
    if (sel.kind === 'questions') return questionsForm(ctx, o);
    if (sel.kind === 'step') {
      var s = o.steps.filter(function (x) { return x.key === sel.key; })[0]; if (!s) return '';
      var at = o.steps.indexOf(s), prevS = o.steps[at - 1], nextS = o.steps[at + 1];
      var h = '<section class="panel stack ob-form" aria-labelledby="ob-form-h" data-scope="ob-step|' + esc(s.key) + '|' + sigOf(o, s.line, s.end) + '">' + formHead('Step', [s.phase.title || 'Untitled phase'].concat(s.track >= 0 ? [s.phase.tracks[s.track].title || 'Untitled lane'] : [], ['Step ' + (at + 1) + ' of ' + o.steps.length]), prevS ? prevS.key : null, nextS ? nextS.key : null);
      if (s.odd) return h + '<p class="small">This step has lines the builder can\'t change safely (a field or note separated from it). Edit it in Markdown.</p></section>';
      var def = T.get(s.type, teamTypes(ctx)), reveal = ctx.state.obReveal === s.key;
      /* Two wrapping rows, so the whole instruction shows; it's still one line in the checklist, and Enter applies it. */
      var gt0 = G.step('text');
      here = { map: M.parse(text), vals: null, at: 's:' + at }; here.vals = V.dbx.values(ctx, here.map, p.id);
      h += detailBox(ctx, 'ob-text', 'step', gt0, ' rows="2" maxlength="200" data-enter="ob-commit"', O.inPlace(s.parts.rest), here.at) +
        '<fieldset class="field ob-kind"><legend>Kind</legend>' + [['step', 'Step', 'Done and checked off; can be marked N/A.', !s.must && !s.planned], ['must', 'Must do', 'Can\'t be marked N/A or waived.', s.must], ['planned', 'Automation planned', 'Still done by hand for now; can be marked N/A.', s.planned]].map(function (k) {
          return '<label class="ob-switch' + (reveal && k[0] === 'must' ? ' reveal' : '') + '" for="ob-mark-' + k[0] + '"><input type="radio" name="ob-mark" id="ob-mark-' + k[0] + '" value="' + k[0] + '" data-bound' + (k[3] ? ' checked' : '') + '><span><b>' + k[1] + '</b> <span class="small">' + k[2] + '</span></span></label>';
        }).join('') + '</fieldset>' +
        '<label class="field" for="ob-type">Type<select id="ob-type" data-bound>' + typeOptions(ctx, s.type, prHost(text)) + '</select></label>';
      var own = s.parts.roles, roles = meta.roles.concat(own.filter(function (r) { return meta.roles.indexOf(r) < 0; }));
      h += '<div class="field"><span id="ob-roles-l">' + esc(G.step('roles').q) + '</span>' + (roles.length ? '<div class="row" role="group" aria-labelledby="ob-roles-l" aria-describedby="why-ob-roles">' + roles.map(function (r) { return '<button type="button" class="chipbtn" data-act="ob-role" data-id="' + esc(r) + '" aria-pressed="' + (own.indexOf(r) >= 0) + '">@' + esc(r) + '</button>'; }).join('') + '</div>' : '<span class="small">The checklist lists no roles yet.</span> <button type="button" class="linkish" data-act="ob-sel-details" data-focus="ob-add-role">Add roles</button>') +
        whyOf('ob-roles', G.step('roles')) + (s.track >= 0 && !own.length ? '<span class="small">With no role of its own, it goes to the lane\'s people.</span>' : '') + '</div>';
      var binds = s.parts.binds, ctxs = meta.context.concat(binds.filter(function (b) { return meta.context.indexOf(b) < 0; }));
      h += '<div class="field"><span id="ob-binds-l">' + esc(G.step('binds').q) + '</span>' + whyOf('ob-binds', G.step('binds')) + (ctxs.length ? '<div class="row" role="group" aria-labelledby="ob-binds-l" aria-describedby="why-ob-binds">' + ctxs.map(function (b) { return '<button type="button" class="ob-chip" data-act="ob-bind" data-id="' + esc(b) + '" aria-pressed="' + (binds.indexOf(b) >= 0) + '">^' + esc(b) + '</button>'; }).join('') + '</div>' : '<span class="small">The checklist lists no run details yet.</span> <button type="button" class="linkish" data-act="ob-sel-details" data-focus="ob-add-ctx">Add run details</button>') + '</div>';
      var names = def ? Object.keys(def.fields || {}) : [];
      Object.keys(s.fields).forEach(function (f) { if (names.indexOf(f) < 0) names.push(f); });
      h += fieldsSection(ctx, p, text, o, s, def, meta);
      /* A newline right after the tag, so a note's own first line break survives (HTML drops the first one). */
      var gn = G.step('note');
      h += '<label class="field" for="ob-note">' + esc(gn.q) + '<textarea id="ob-note" rows="3" maxlength="2000"' + egOf(gn) + describe(ctx, 'ob-note', gn) + '>\n' + esc(s.note) + '</textarea></label>' + whyOf('ob-note', gn) + errMsg(ctx, 'ob-note');
      h += whenSection(ctx, p, s, 'ob-when', meta);
      h += ioLines(ctx, here.map, s);
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
        formBox(ctx, 'ob-tr-title', 'tr-title', 'input', ' maxlength="120" data-enter="ob-commit" value="' + esc(tr.title) + '"') +
        formSelect(ctx, 'ob-tr-role', 'tr-role', '<option value=""' + (tr.roles.length ? '' : ' selected') + '>Nobody in particular</option>' + lroles.map(function (r) { return '<option value="' + esc(r) + '"' + (r === tr.roles[0] ? ' selected' : '') + '>@' + esc(r) + '</option>'; }).join('')) +
        source(ctx, tr.id, 'lane', U.slug(name, 24)) +
        '<div class="row"><button type="button" class="mini" data-act="ob-add" data-id="' + esc(ph.key) + '" data-track="' + tr.index + '">' + I('plus') + 'Add a step to this lane</button><button type="button" class="mini" data-act="ob-ask" data-id="track">Delete this lane</button></div>';
      if (ask) t += '<div class="notice warn" role="group" aria-labelledby="ob-ask-t"><span id="ob-ask-t">' + (n ? 'Delete the ' + esc(name) + ' lane? Its ' + n + ' step' + (n === 1 ? '' : 's') + ' can move up into the phase, or go with it.' : 'Delete the ' + esc(name) + ' lane?') + '</span>' +
        (n ? '<button type="button" class="btn" data-act="ob-del-track" data-id="keep" id="ob-ask-go">Keep its steps</button><button type="button" class="btn stop" data-act="ob-del-track" data-id="all">Delete lane and steps</button>' : '<button type="button" class="btn stop" data-act="ob-del-track" data-id="all" id="ob-ask-go">Delete lane</button>') +
        '<button type="button" class="mini" data-act="ob-ask-cancel">Cancel</button></div>';
      return t + '</section>';
    }
    var gt = ph.gate, sig = sigOf(o, ph.line, ph.end) + (gt ? '.' + sigOf(o, gt.line, gt.end) : ''), pask = askOf(ctx, 'phase', ph.key);
    var f = '<section class="panel stack ob-form" aria-labelledby="ob-form-h" data-scope="ob-phase|' + esc(ph.key) + '|' + sig + '">' + formHead('Phase', ['Phase ' + (ph.index + 1) + ' of ' + o.phases.length]) +
      formBox(ctx, 'ob-ph-title', 'ph-title', 'input', ' maxlength="120" data-enter="ob-commit" value="' + esc(ph.title) + '"') +
      choices(ctx, 'ob-ph-mode', G.form('ph-mode'), ['READ-DO', 'DO-CONFIRM'], ph.mode, null, { 'READ-DO': 'Read, then do', 'DO-CONFIRM': 'Do, then confirm' }) +
      formBox(ctx, 'ob-ph-note', 'ph-note', 'textarea', ' rows="3" maxlength="2000"', esc(ph.note || '')) +
      whenSection(ctx, p, ph, 'ob-ph-when', meta) +
      (ph.odd ? '<p class="small">This phase has lines under its heading the builder can\'t change safely. Edit its note and screenshots in Markdown.</p>' : shotsSection(ctx, p, ph, 'phase')) +
      source(ctx, ph.id, 'phase', U.slug(ph.title, 24)) +
      '<div class="row"><button type="button" class="mini" data-act="ob-ph-move" data-id="' + esc(ph.key) + '" data-dir="up">Move phase up</button><button type="button" class="mini" data-act="ob-ph-move" data-id="' + esc(ph.key) + '" data-dir="down">Move phase down</button><button type="button" class="mini" data-act="ob-add-phase" data-id="' + esc(ph.key) + '">' + I('plus') + 'Add a phase after it</button><button type="button" class="mini" data-act="ob-ask" data-id="phase">Delete this phase</button>' +
      '<button type="button" class="mini" data-act="hist-open" data-id="draft" data-item="phase:' + esc(ph.key) + '" aria-haspopup="dialog">' + I('clock') + 'History of this phase</button></div>';
    if (pask) f += '<div class="notice warn" role="group" aria-labelledby="ob-ask-t"><span id="ob-ask-t">Delete ' + esc(ph.title || 'this phase') + (ph.steps.length ? ' and its ' + ph.steps.length + ' step' + (ph.steps.length === 1 ? '' : 's') : '') + (gt ? ', with its gate' : '') + '? Undo brings it back.</span>' +
      '<button type="button" class="btn stop" data-act="ob-del-phase" data-id="' + esc(ph.key) + '" id="ob-ask-go">Delete phase</button><button type="button" class="mini" data-act="ob-ask-cancel">Cancel</button></div>';
    f += '<h3 class="ob-sec">' + I('gate') + 'Closing gate</h3>';
    if (gt && gt.odd) return f + '<p class="small">This gate has options the builder doesn\'t know. Edit it in Markdown.</p></section>';
    if (!gt) return f + '<p class="small">Without a gate, the phase ends with a check that it\'s done. Name a gate to add one.</p>' + formBox(ctx, 'ob-g-title', 'g-title', 'input', ' maxlength="120" data-enter="ob-commit" value=""') + '</section>';
    var roles = meta.roles.concat(gt.owner && meta.roles.indexOf(gt.owner) < 0 ? [gt.owner] : []);
    return f + formBox(ctx, 'ob-g-title', 'g-title', 'input', ' maxlength="120" data-enter="ob-commit" value="' + esc(gt.title) + '"') +
      formSelect(ctx, 'ob-g-owner', 'g-owner', '<option value=""' + (gt.owner ? '' : ' selected') + '>Nobody in particular</option>' + roles.map(function (r) { return '<option value="' + esc(r) + '"' + (r === gt.owner ? ' selected' : '') + '>@' + esc(r) + '</option>'; }).join('')) +
      gateApproves(ctx, p, text, ph, gt) +
      source(ctx, gt.id, 'gate', U.slug(gt.title, 24)) +
      '<div class="row"><button type="button" class="mini" data-act="ob-gate-remove" data-id="' + esc(ph.key) + '">Remove this gate</button><span class="small">The phase then ends with a check that it\'s done.</span></div></section>';
  }

  function gateApproves(ctx, p, text, ph, gt) {
    here = { map: M.parse(text), vals: null, at: 'g:' + ph.index }; here.vals = V.dbx.values(ctx, here.map, p.id);
    return detailBox(ctx, 'ob-g-approves', 'approves', G.form('g-approves'), ' maxlength="200" data-enter="ob-commit"', gt.approves, here.at);
  }

  /* ---------- the checklist's details and its Questions section ---------- */
  /* A person to choose: the active people whose IDs a checklist can hold, and the current value even when it isn't one of
     them (inactive, or not in people.json), so an unrelated change never drops it. */
  function personSelect(ctx, id, name, cur, none) {
    var all = ctx.data.people || [], ok = all.filter(function (x) { return !x.inactive && O.personOk(x.id); }), have = ok.some(function (x) { return x.id === cur; });
    var gone = cur && !have ? all.filter(function (x) { return x.id === cur; })[0] : null;
    var nm = PF.people.labeler(all);
    var opt = function (v, t, on) { return '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(t) + '</option>'; };
    return formSelect(ctx, id, name, opt('', none, !cur) + (cur && !have ? opt(cur, (gone ? gone.name : cur) + (gone ? (gone.inactive ? ' (inactive)' : '') : ' (not in people.json)'), true) : '') +
      ok.map(function (x) { return opt(x.id, nm(x), x.id === cur); }).join(''));
  }
  function listField(ctx, key, label, hint, list, mark, addId, ren) {
    var lid = 'ob-' + key + '-l', cls = key === 'roles' ? 'ob-role' : 'ob-chip', g = G.form(key === 'roles' ? 'role' : 'context');
    return '<div class="field"><span id="' + lid + '">' + label + '</span><span class="small">' + hint + '</span>' +
      (list.length ? '<ul class="ob-metalist" aria-labelledby="' + lid + '">' + list.map(function (n) {
        var rn = ctx.state.obRename;
        if (key === 'context' && ren && ren.o && rn && rn.name === n && rn.pid === ren.map.meta.process) return renameRow(ctx, ren, n);
        var used = key === 'context' && ren && ren.o ? O.usesOf(ren.o, 'context', n).length : -1;
        return '<li><span class="' + cls + '">' + mark + esc(n) + '</span>' + (used >= 0 ? '<span class="small">' + (used ? 'used in ' + used + ' place' + (used === 1 ? '' : 's') : 'not used yet') + '</span>' : '') +
          (used >= 0 ? '<button type="button" class="mini" data-act="ob-ren" data-id="' + esc(n) + '" aria-label="Rename ' + mark + esc(n) + '">Rename</button>' : '') +
          '<button type="button" class="mini" data-act="ob-meta-del" data-key="' + key + '" data-id="' + esc(n) + '" aria-label="Remove ' + mark + esc(n) + '">Remove</button></li>';
      }).join('') + '</ul>' : '<span class="small">None yet.</span>') +
      '<div class="row"><label class="sr" for="' + addId + '">' + esc(g.q) + '</label><input id="' + addId + '" maxlength="60" autocomplete="off"' + egOf(g) + ' data-enter="ob-meta-add" data-id="' + key + '"' + describe(ctx, addId, g) + '>' +
      '<button type="button" class="mini" data-act="ob-meta-add" data-id="' + key + '">' + I('plus') + 'Add</button></div>' + whyOf(addId, g) + errMsg(ctx, addId) + '</div>';
  }
  /* Renaming a run detail (2.7): the new name, what else changes with it, and what other files say. A dependent that would
     stop working refuses the rename when it's applied; the rest are notes. */
  function renameRow(ctx, ren, n) {
    var used = O.usesOf(ren.o, 'context', n), deps = ctx.renameDeps ? ctx.renameDeps(ren.map, n) : [];
    var id = 'ob-ren-ctx', note = 'Every ^' + n + ' in this checklist follows: step text, gate approvals, fields, only when and sets. Runs already started keep the old name.';
    return '<li class="ob-ren stack"><label for="' + id + '">New name for ^' + esc(n) + '</label>' +
      '<div class="row"><input id="' + id + '" maxlength="60" autocomplete="off" spellcheck="false" value="' + esc(n) + '" data-enter="ob-ren-go" data-id="' + esc(n) + '" aria-describedby="ob-ren-note' + (ctx.state.fieldErr && ctx.state.fieldErr.field === id ? ' ferr-' + id : '') + '">' +
      '<button type="button" class="mini primary" data-act="ob-ren-go" data-id="' + esc(n) + '">Rename</button><button type="button" class="mini" data-act="ob-ren-cancel" data-id="' + esc(n) + '">Cancel</button></div>' +
      errMsg(ctx, id) +
      '<p class="small" id="ob-ren-note">' + esc(note) + (used.length ? ' Used in ' + esc(used.join(', ')) + '.' : '') + '</p>' +
      (deps.length ? '<ul class="ob-ren-deps small">' + deps.map(function (d) { return '<li class="' + (d.refuse ? 'bad' : 'info') + '">' + esc(d.text) + '</li>'; }).join('') + '</ul>' : '') + '</li>';
  }
  function detailsForm(ctx, o, meta, text) {
    var ren = { o: o, map: null }; try { ren.map = M.parse(text); } catch (e) { ren = null; }
    var sig = o.front ? sigOf(o, o.front.start, o.front.end) : 'none';
    return '<section class="panel stack ob-form" aria-labelledby="ob-form-h" data-scope="ob-details|' + sig + '">' + formHead('Checklist details', ['The whole checklist']) +
      personSelect(ctx, 'ob-owner', 'owner', meta.owner, 'Nobody yet') +
      personSelect(ctx, 'ob-backup', 'backup', meta.backup, 'No backup') +
      listField(ctx, 'roles', 'Roles', 'Who does what, like lead or reviewer. Steps, lanes and gates choose from these.', meta.roles, '@', 'ob-add-role') +
      listField(ctx, 'context', 'Run details', 'Filled in when a run starts, like ticket or commit. Steps can be tied to them.', meta.context, '^', 'ob-add-ctx', ren) +
      '<p class="small">A role or run detail still in use can\'t be removed: take it out of its steps first.</p>' +
      '<details class="ob-src"><summary>Source details</summary><p class="small">The front matter\'s <code>owner:</code>, <code>backup:</code>, <code>roles:</code> and <code>context:</code> lines. Other lines stay as written.</p></details></section>';
  }
  function questionsForm(ctx, o) {
    if (o.questions < 0) return '';
    var ask = askOf(ctx, 'questions', ':questions');
    var h = '<section class="panel stack ob-form" aria-labelledby="ob-form-h" data-scope="ob-questions|' + sigOf(o, o.questions, o.qEnd) + '">' + formHead('Questions', ['Questions section']) +
      '<p class="small">Questions for the owner, written while the checklist was drafted. It can\'t be published while this section is there: answer them in the steps, then remove it.</p>' +
      formBox(ctx, 'ob-q-text', 'questions', 'textarea', ' rows="8" maxlength="20000"', '\n' + esc(o.qText)) +
      '<div class="row"><button type="button" class="mini" data-act="ob-ask" data-id="questions">Remove section</button></div>';
    if (ask) h += '<div class="notice warn" role="group" aria-labelledby="ob-ask-t"><span id="ob-ask-t">Remove the Questions section and everything in it? Undo brings it back.</span>' +
      '<button type="button" class="btn stop" data-act="ob-q-remove" id="ob-ask-go">Remove section</button><button type="button" class="mini" data-act="ob-ask-cancel">Cancel</button></div>';
    return h + '</section>';
  }

  /* A step's reference screenshots: thumbnails (alt text is the caption) with the caption as a box, Move up / Move down and
     Remove (the line only; the file stays in images/), then a place to add more by Choose files, drop or paste (app.js
     writes each image once and reads it back before its line is added). Thumbnails come from the folder's images/, never a
     run's publication (the last argument to ctx.img). */
  function shotsSection(ctx, p, s, kind) {
    var A = PF.attach, n = s.shots.length, busy = ctx.shotBusy ? +ctx.shotBusy(p.id) || 0 : 0, cap = G.form('caption');
    var h = '<h3 class="ob-sec" id="ob-shots-h">Screenshots</h3>';
    if (n) {
      h += '<ol class="ob-shots" aria-labelledby="ob-shots-h">' + s.shots.map(function (sh, k) {
        var id = 'ob-shot-cap-' + k, which = 'screenshot ' + (k + 1);
        return '<li class="ob-shot"><div class="thumb ob-shot-pic">' + ctx.img(sh.src, sh.caption, false, true) + '</div><div class="ob-shot-body">' +
          '<label class="field" for="' + id + '">' + esc(cap.q) + '<span class="sr"> (' + which + ' of ' + n + ')</span><input id="' + id + '" maxlength="200" data-enter="ob-commit" value="' + esc(sh.caption) + '"' + egOf(cap) + describe(ctx, id, cap) + '></label>' + whyOf(id, cap) + errMsg(ctx, id) +
          '<div class="row ob-shot-acts"><button type="button" class="mini" data-act="ob-shot-move" data-id="' + k + '" data-dir="up" aria-label="Move ' + which + ' up">Move up</button>' +
          '<button type="button" class="mini" data-act="ob-shot-move" data-id="' + k + '" data-dir="down" aria-label="Move ' + which + ' down">Move down</button>' +
          '<button type="button" class="mini" data-act="ob-shot-remove" data-id="' + k + '" aria-label="Remove ' + which + ': ' + esc(sh.caption) + '">Remove</button></div>' +
          '<p class="small ob-shot-src"><code>' + esc(sh.src) + '</code></p></div></li>';
      }).join('') + '</ol><p class="small">Removing takes it out of this draft only. The image file stays in the folder, since other versions or runs may use it.</p>';
    } else h += '<p class="small">No screenshots yet.</p>';
    return h + '<div class="ob-shot-add" data-drop="shots" data-id="' + esc(s.key) + '" role="group" aria-labelledby="ob-shot-add-h"><p class="ob-shot-add-h" id="ob-shot-add-h"><b>Add screenshots</b></p>' +
      '<label class="field" for="ob-shot-new">' + esc(cap.q) + '<span class="sr"> (the next screenshot)</span><input id="ob-shot-new" maxlength="200" data-nav-safe' + egOf(cap) + describe(ctx, 'ob-shot-new', cap) + '></label>' + whyOf('ob-shot-new', cap) + errMsg(ctx, 'ob-shot-new') +
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

  V.builder = builder; V.builderForm = builderForm; V.linkChildOf = linkChildOf; V.obPartsPane = partsPane; V.changedLines = changedLines;
  V.obPrHost = prHost; V.obParts = parts; V.obPart = partOf; V.obPartsSheet = partsSheet; V.obSentence = sentence; V.obNowhere = nowhere;
})();
