/* Dialogs: What's new, keyboard help and the screenshot viewer. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, R = PF.run, M = PF.map, T = PF.types, I = PF.icons.icon, esc = U.esc;
  var person = K.person, nameOf = K.nameOf, avatar = K.avatar, notices = K.notices, ago = K.ago, runKey = K.runKey, freshness = K.freshness;
  /* ---------- What's new: the release history ---------- */
  var REL_KINDS = [['new', 'New'], ['improved', 'Improved'], ['fixed', 'Fixed']], MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function semverCmp(a, b) { var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (var i = 0; i < 3; i++) { var d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; }
  function relDate(iso) { var p = iso.split('-').map(Number); return MONTHS[p[1] - 1].slice(0, 3) + ' ' + p[2] + ', ' + p[0]; }
  function cap(t) { return t ? t[0].toUpperCase() + t.slice(1) : t; }
  /* The changes in a release that pass the search and filters. A search that matches the release itself keeps all of them. */
  function relChanges(r, f) {
    var q = (f.q || '').trim().toLowerCase(), head = !q || (r.version + ' ' + r.headline).toLowerCase().indexOf(q) >= 0;
    return r.changes.filter(function (c) { return (!f.kind || c.kind === f.kind) && (!f.area || c.area === f.area) && (head || [c.title, c.now, c.before || '', c.where || '', c.area].join(' ').toLowerCase().indexOf(q) >= 0); });
  }
  function releases(ctx) {
    var rel = ctx.releases, f = ctx.state.rel, list = rel.list;
    var vis = list.map(function (r, i) { return { r: r, i: i, cs: relChanges(r, f) }; }).filter(function (x) { return x.cs.length; });
    if (vis.length && !vis.some(function (x) { return x.i === f.sel; })) f.sel = vis[0].i;
    var areas = list.reduce(function (a, r) { r.changes.forEach(function (c) { if (a.indexOf(c.area) < 0) a.push(c.area); }); return a; }, []).sort();
    var side = '<div class="rn-tools"><label class="sr" for="rel-search">Search release notes</label><input id="rel-search" type="search" placeholder="Search release notes" value="' + esc(f.q || '') + '">' +
      '<div class="rn-kinds" role="group" aria-label="Kind of change">' + [['', 'All']].concat(REL_KINDS).map(function (k) { return '<button class="chipbtn" data-act="rel-kind" data-id="' + k[0] + '" aria-pressed="' + ((f.kind || '') === k[0]) + '">' + k[1] + '</button>'; }).join('') + '</div>' +
      '<label class="sr" for="rel-area">Area</label><select id="rel-area"><option value="">All areas</option>' + areas.map(function (a) { return '<option' + (f.area === a ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') + '</select></div><ul class="rn-list">';
    var month = '';
    vis.forEach(function (x) {
      var m = x.r.date.slice(0, 7);
      if (m !== month) { month = m; side += '<li class="rn-month">' + MONTHS[Number(m.slice(5)) - 1] + ' ' + m.slice(0, 4) + '</li>'; }
      side += '<li><button class="rn-item" data-act="rel-sel" data-id="' + x.i + '" aria-current="' + (x.i === f.sel) + '"><span class="l1"><b>' + esc(x.r.version) + '</b>' + (x.i === 0 ? '<span class="rn-tag latest">Latest</span>' : '') + (semverCmp(x.r.version, rel.lastSeen) > 0 ? '<span class="rn-tag fresh">New for you</span>' : '') + '<span class="d">' + relDate(x.r.date) + '</span></span>' +
        '<span class="h">' + esc(cap(x.r.headline)) + '</span><span class="n">' + REL_KINDS.map(function (k) { var n = x.cs.filter(function (c) { return c.kind === k[0]; }).length; return n ? '<span class="rn-k-' + k[0] + '">' + n + ' ' + k[1].toLowerCase() + '</span>' : ''; }).join('') + '</span></button></li>';
    });
    if (!vis.length) side += '<li class="rn-empty">No changes match. Try another search or filter.</li>';
    side += '</ul>';
    var x = vis.filter(function (v) { return v.i === f.sel; })[0], detail = '';
    if (x) {
      var r = x.r, older = list[x.i + 1], at = vis.indexOf(x), prev = vis[at + 1], next = vis[at - 1];
      detail = '<button class="mini rn-back" data-act="rel-back">← All releases</button><h3 class="rn-title" id="rel-detail-title" tabindex="-1">Flightdeck ' + esc(r.version) + '</h3><p class="rn-sub">' + esc(cap(r.headline)) + '.</p>' +
        '<p class="small">Released ' + relDate(r.date) + (older ? ' · compared with ' + esc(older.version) : '') + '</p>' +
        (x.cs.length !== r.changes.length ? '<p class="small">Showing ' + x.cs.length + ' of ' + r.changes.length + ' changes. <button class="linkish" data-act="rel-clear">Show all</button></p>' : '') +
        REL_KINDS.map(function (k) {
          var items = x.cs.filter(function (c) { return c.kind === k[0]; });
          if (!items.length) return '';
          return '<section class="rn-group"><h4><span class="rn-kind rn-k-' + k[0] + '">' + k[1] + '</span> ' + items.length + '</h4>' + items.map(function (c) {
            return '<article class="rn-chg"><div class="t">' + esc(c.title) + '<span class="cat">' + esc(c.area) + '</span></div>' +
              (c.before ? '<div class="rn-ba"><div><b>Before</b> ' + esc(c.before) + '</div><div><b>Now</b> ' + esc(c.now) + '</div></div>' : '<p>' + esc(c.now) + '</p>') +
              (c.where ? '<p class="small"><b>Where:</b> ' + esc(c.where) + '</p>' : '') + '</article>';
          }).join('') + '</section>';
        }).join('') +
        '<nav class="row between rn-nav" aria-label="Other releases">' + (prev ? '<button class="mini" data-act="rel-sel" data-id="' + prev.i + '">← ' + esc(prev.r.version) + '</button>' : '<span></span>') + (next ? '<button class="mini" data-act="rel-sel" data-id="' + next.i + '">' + esc(next.r.version) + ' →</button>' : '') + '</nav>';
    }
    return '<div class="overlay" data-act="close-overlay"><div class="rn-box' + (f.detail ? ' detail' : '') + '" role="dialog" aria-modal="true" aria-labelledby="rel-t">' +
      '<div class="rn-head"><h2 id="rel-t">What\'s new in Flightdeck<span>You\'re on ' + esc(rel.version) + '</span></h2><button class="mini" data-act="close-overlay" id="rel-close">Close</button></div>' +
      '<div class="rn-body"><div class="rn-side">' + side + '</div><div class="rn-main">' + detail + '</div></div></div></div>';
  }

  function help(ctx) {
    var on = ctx.state.keys;
    return '<div class="overlay" data-act="close-overlay"><div class="help" role="dialog" aria-modal="true" aria-labelledby="help-t"><h2 id="help-t">Keyboard</h2>' +
      '<p class="small">Single-key shortcuts are <b>' + (on ? 'on' : 'off') + '</b>. They only work outside text fields. <button class="mini" data-act="toggle-keys">' + (on ? 'Turn them off' : 'Turn them on') + '</button></p><dl>' +
      '<dt>Ctrl+K · Cmd+K</dt><dd>Search, from anywhere (also while typing)</dd><dt>/</dt><dd>Search</dd><dt>J / K</dt><dd>Next or previous step</dd><dt>Space or X</dt><dd>Check the selected step, or open the evidence it needs (recorder). Then the next step in the phase is selected.</dd><dt>B</dt><dd>Blocked</dd><dt>N</dt><dd>Write a note on the selected step</dd><dt>C</dt><dd>Correct the selected step</dd><dt>M</dt><dd>Screen share mode</dd><dt>Esc</dt><dd>Close or cancel</dd><dt>?</dt><dd>This help</dd><dt>Alt+Left / Alt+Right</dt><dd>Back and Forward move between screens. Back closes an open dialog first.</dd></dl>' +
      '<p class="small">On a focused button, Space presses that button.</p>' +
      '<h3>In the draft editor and the step-type form</h3><p class="small">These work in text fields too. A builder box with typing not yet applied undoes that typing first.</p><dl>' +
      '<dt>Ctrl+Z · Cmd+Z</dt><dd>Undo, and say what was undone</dd><dt>Ctrl+Shift+Z · Cmd+Shift+Z · Ctrl+Y</dt><dd>Redo</dd><dt>Alt+Up / Alt+Down</dt><dd>Move the focused step or phase (builder)</dd><dt>Enter in Add a step</dt><dd>Add it and type the next one (Enter on an empty box closes it)</dd><dt>Escape in Add a step</dt><dd>Close the box</dd></dl>' +
      '<h3>In Practice</h3><dl><dt>Up / Down</dt><dd>Next or previous step</dd><dt>Space</dt><dd>Check the step</dd><dt>X</dt><dd>Not needed</dd><dt>E</dt><dd>Open the step in the builder</dd><dt>F</dt><dd>Fill in the step</dd><dt>Ctrl+Enter · Cmd+Enter</dt><dd>Check or save the open form</dd><dt>Ctrl+Z · Cmd+Z</dt><dd>Undo in practice (on its buttons)</dd><dt>Escape</dt><dd>Back to the editor</dd></dl>' +
      '<button class="btn" data-act="close-overlay">Close</button></div></div>';
  }
  /* ---------- Search: the command palette (docs/design.md section 22) ---------- */
  /* A combobox (the search box) that controls a listbox of results grouped by kind; the active result is
     aria-activedescendant, so focus stays in the box. Every piece of text from a file is escaped segment by segment, and
     only the hits are wrapped in <mark>. */
  function marked(segs) { return segs.map(function (x) { return x.hit ? '<mark>' + esc(x.t) + '</mark>' : esc(x.t); }).join(''); }
  function num(n) { return Number(n || 0).toLocaleString('en-US'); }
  function clockTime(iso) { if (iso == null || iso === '') return 'time unknown'; var d = new Date(iso); return isNaN(d) ? 'time unknown' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }); }
  var SX_ICON = { run: 'flag', step: 'check', note: 'note', correction: 'edit', followup: 'clock', process: 'doc', version: 'timeline', type: 'nest', skill: 'spark', page: 'cursor' };
  function search(ctx) {
    var st = ctx.state.sx || { q: '' }, info = ctx.search(), res = st.res, q = st.q || '', S = PF.search, typed = !!q.trim();
    var flat = st.flat || [], any = typed && res && res.total > 0, body = '', n = 0;
    if (!typed) body = '<p class="sx-msg">Search runs, steps, notes, corrections, follow-ups, step types and skills.</p><p class="sx-msg small">Use the arrow keys to move through the results and Enter to open one. Esc closes this.</p>';
    else if (!any && info.building) body = '<p class="sx-msg" role="status">Reading the team folder…</p>';
    else if (!any) body = '<p class="sx-msg">Nothing matches “' + esc(q.trim()) + '”. Try fewer words, or a ticket like ABC-123.</p>';
    if (info.err) body = '<p class="sx-msg sx-err">' + esc(info.err) + '</p>' + body;
    var list = '';
    if (any) res.groups.forEach(function (g) {
      list += '<li role="presentation" class="sx-group"><div class="sx-gh" id="sx-g-' + esc(g.kind) + '">' + esc(g.label) + ' <span>' + num(g.total) + '</span></div><ul role="group" aria-labelledby="sx-g-' + esc(g.kind) + '">';
      g.items.forEach(function (x) {
        var i = n++, on = i === st.pos, flag = x.status === 'unread' ? '<span class="pill warn">Couldn\'t be read; last copy</span>' : x.status === 'missing' ? '<span class="pill warn">File gone; last copy</span>' : '';
        list += '<li role="option" id="sx-o-' + i + '" class="sx-opt" aria-selected="' + on + '" data-act="sx-open" data-id="' + esc(x.id) + '">' +
          '<span class="sx-ic" aria-hidden="true">' + I(SX_ICON[x.kind] || 'doc') + '</span><span class="sx-tx"><span class="sx-t">' + marked(S.mark(x.shown || x.title, res.terms)) + '</span>' +
          (x.text ? '<span class="sx-x">' + marked(S.snippet(x.text, res.terms, 140)) + '</span>' : '') +
          '<span class="sx-s">' + esc(x.sub) + flag + '</span></span></li>';
      });
      list += '</ul>' + (g.total > g.items.length ? '<p class="sx-more small">' + num(g.total - g.items.length) + ' more. Add a word to narrow it down.</p>' : '') + '</li>';
    });
    var foot = [];
    if (info.building) foot.push(info.building.total ? 'Still reading ' + num(info.building.done) + ' of ' + num(info.building.total) + ' runs.' : 'Still reading the team folder.');
    if (info.unread) foot.push(info.unread === 1 ? '1 run file couldn\'t be read; its last copy is searched and marked.' : num(info.unread) + ' run files couldn\'t be read; their last copies are searched and marked.');
    if (info.readAt) foot.push('Folder last read ' + clockTime(info.readAt) + '.');
    return '<div class="overlay" data-act="close-overlay"><div class="sx-box" role="dialog" aria-modal="true" aria-labelledby="sx-t">' +
      '<div class="sx-head"><h2 id="sx-t" class="sr">Search</h2><span class="sx-glass" aria-hidden="true">' + I('search') + '</span>' +
      '<label class="sr" for="sx-q">Search the team folder</label><input id="sx-q" type="search" role="combobox" aria-autocomplete="list" aria-controls="sx-list" aria-expanded="' + !!any + '"' +
      (any && st.pos >= 0 && flat[st.pos] ? ' aria-activedescendant="sx-o-' + st.pos + '"' : '') + ' placeholder="Search the team folder" value="' + esc(q) + '" autocomplete="off" spellcheck="false" maxlength="200">' +
      '<button class="mini" data-act="close-overlay" id="sx-close">Close</button></div>' +
      '<div class="sx-body">' + body + '<ul id="sx-list" role="listbox" aria-label="Results"' + (any ? '' : ' hidden') + '>' + list + '</ul></div>' +
      (foot.length ? '<p class="sx-foot small">' + foot.map(esc).join(' ') + '</p>' : '') + '</div></div>';
  }

  /* Shown once, the first time the examples are kept in this tab only. */
  function tabOnlyHelp() {
    return '<div class="overlay" data-act="close-overlay"><div class="help" role="dialog" aria-modal="true" aria-labelledby="tab-only-t" aria-describedby="tab-only-d"><h2 id="tab-only-t">Kept in this tab only</h2>' +
      '<p id="tab-only-d">This browser doesn\'t let Flightdeck keep anything, so the examples and your changes to them last only while this tab is open. Reloading or closing the tab loses them.</p>' +
      '<p>The <b>Tab only</b> badge at the top stays while this lasts. To keep your work, use a team folder.</p>' +
      '<button class="btn primary" data-act="close-overlay" id="tab-only-ok">Got it</button></div></div>';
  }
  function lightbox(ctx, list, i) {
    var it = list[i];
    return '<div class="overlay" data-act="close-overlay" role="dialog" aria-modal="true" aria-label="Screenshot"><div class="lb-box"><div class="lb-bar"><span class="cap">' + esc(it.caption) + '</span><span class="small" style="color:#cfd6db">' + (i + 1) + ' of ' + list.length + '</span>' +
      (list.length > 1 ? '<button data-act="lb-step" data-id="-1" aria-label="Previous">‹ Prev</button><button data-act="lb-step" data-id="1" aria-label="Next">Next ›</button>' : '') + '<button data-act="close-overlay" id="lb-close">Close</button></div><div class="lb-media">' + ctx.img(it.src, it.caption, true) + '</div></div></div>';
  }

  /* A text attachment, shown as plain text: the app fills #att-text with textContent after drawing, so nothing in the file is
     ever read as markup. */
  function textPreview(name, path, cut, bytes, owner, from) {
    return '<div class="overlay" data-act="close-overlay"><div class="tp-box" role="dialog" aria-modal="true" aria-labelledby="tp-t"><div class="tp-bar"><h2 id="tp-t">' + esc(name) + '</h2>' +
      '<span class="small">' + esc(PF.attach.size(bytes)) + (cut ? ' · showing the first ' + esc(PF.attach.size(PF.attach.PREVIEW_MAX)) : '') + '</span>' +
      '<button class="mini" data-act="att-save" data-id="' + esc(owner) + '" data-from="' + esc(from || 'note') + '" data-path="' + esc(path) + '">Save a copy</button><button class="mini" data-act="close-overlay" id="tp-close">Close</button></div>' +
      '<pre class="tp-text" id="att-text" tabindex="0"></pre></div></div>';
  }

  /* ---------- History: what changed in an editor ---------- */
  /* o: { scope, tl, title, item (only changes to one step, phase or field), itemName, mode ('session' or 'saved'), saved
     ({ state: 'loading' | 'ok' | 'error' | 'none', items from PF.timeline.order with publications placed, bad }), savedItem (the
     item as saved history names it), compare (the saved entry whose Compare is open), compareMsg }. */
  function historyDrawer(ctx, o) {
    var TL = PF.timeline, tl = o.tl || TL.create(), list = '', n = 0, saved = o.mode === 'saved';
    var marks = tl.marks || [];
    for (var i = tl.entries.length; i >= 0; i--) {
      marks.forEach(function (m) { if (m.at === i && !o.item) list += '<li class="hist-mark">' + esc(m.why) + '</li>'; });
      var e = tl.entries[i - 1]; if (!e) continue;
      if (o.item && e.items.indexOf(o.item) < 0) continue;
      n++;
      var st = i - 1 >= tl.pos ? 'Undone · Redo brings it back' : i - 1 < tl.barrier ? 'Can\'t be undone' : '';
      list += '<li class="hist-entry' + (i - 1 >= tl.pos ? ' undone' : '') + '"><div class="hist-what">' + esc(histCap(TL.describe(e))) + '</div><div class="small">You · ' + esc(U.hm(new Date(e.at).toISOString())) + (e.savedAs ? ' · saved' : '') + (st ? ' · ' + st : '') + '</div>' +
        (e.show ? histBa(e.show.before, e.show.after) : histBa(e.del, e.ins)) + '</li>';
    }
    var filter = o.item ? '<p class="row"><span class="small">Only changes to <b>' + esc(o.itemName || o.item) + '</b></span><button type="button" class="mini" data-act="hist-item" data-id="">Show all</button></p>' : '';
    var sw = '<div class="seg hist-switch" role="group" aria-label="Which history"><button type="button" data-act="hist-mode" data-id="session" aria-pressed="' + !saved + '">This session</button><button type="button" data-act="hist-mode" data-id="saved" aria-pressed="' + saved + '">Saved history</button></div>';
    var body = saved ? '<h3>Saved history</h3><p class="small">' + (o.scope === 'type' ? 'Every save of this step type' : 'Every save of this draft') + ' kept in the team folder, newest first, in the order the saves build on each other.</p>' + filter + savedHistory(ctx, o)
      : '<h3>This session</h3><p class="small">Changes made in this window since you opened it, newest first. They\'re kept until you close or reload the window.</p>' + filter +
        (n ? '<ol class="hist-list">' + list + '</ol>' : '<p class="small">' + (o.item ? 'No changes to it yet in this session.' : 'No changes yet in this session.') + '</p>' + (list ? '<ol class="hist-list">' + list + '</ol>' : ''));
    return '<div class="overlay" data-act="close-overlay"><div class="help hist" role="dialog" aria-modal="true" aria-labelledby="hist-t">' +
      '<div class="row between"><h2 id="hist-t" tabindex="-1" style="margin:0">History <span class="small">' + esc(o.title || '') + '</span></h2><button type="button" class="mini" data-act="close-overlay">Close</button></div>' +
      V.undoBar(o.scope, tl, { noHistory: true }) + sw + body + '</div></div>';
  }
  function histCap(t) { t = String(t); return t.charAt(0).toUpperCase() + t.slice(1); }
  function histClip(t) { t = String(t); return t.length > 400 ? t.slice(0, 400) + '…' : t; }
  function histBa(b, a, label) {
    return '<details><summary class="small">' + esc(label || 'Before and after') + '</summary><div class="hist-ba"><div><b>Before</b><pre class="source">' + (b ? esc(histClip(b)) : '<span class="small">(nothing)</span>') + '</pre></div><div><b>After</b><pre class="source">' + (a ? esc(histClip(a)) : '<span class="small">(nothing)</span>') + '</pre></div></div></details>';
  }
  /* What a saved line says it was, in words. */
  function histSource(e) {
    if (e.source === 'restore') return e.version ? 'Restored from v' + e.version : 'Restored an earlier version';
    if (e.source === 'reverse') return 'Reversed a saved change';
    if (e.source === 'keep-mine') return 'Saved over another change';
    if (e.source === 'new') return e.kind === 'type-edit' ? 'Created in Flightdeck' : 'Started the draft in Flightdeck';
    if (e.source === 'correction') return 'Applied correction';
    if (e.source === 'editor') return 'Saved in Flightdeck';
    if (e.source === 'agent') return 'Changed by your AI assistant';
    if (e.source === 'proposal') return 'Changed by your AI assistant, applied in Flightdeck';
    return 'Saved';
  }
  /* A draft's hunks that touch one step or phase (its {#id}), or all of them when none does. */
  function histHunks(e, item) {
    var hs = e.hunks || [], m = /^(step|phase):(.+)$/.exec(item || '');
    if (!m) return hs;
    var tag = '{#' + m[2] + '}', mine = hs.filter(function (h) { return h.del.concat(h.ins).some(function (l) { return l.indexOf(tag) >= 0; }); });
    return mine.length ? mine : hs;
  }
  function histCompare(e, o, item) {
    var TL = PF.timeline, rows = '';
    if (e.kind === 'type-edit') TL.typeChanges(e.before, e.after).forEach(function (c) {
      if (item && c.item !== item) return;
      rows += '<span class="small"><b>' + esc(c.label) + '</b></span>\n' + (c.before ? '<span class="del">- ' + esc(c.before) + '</span>' : '') + (c.after ? '<span class="add">+ ' + esc(c.after) + '</span>' : '');
    });
    else histHunks(e, item).forEach(function (h) {
      /* The unchanged lines a hunk carries to be found again show as they are. */
      var a = 0, b = 0, same = function (l) { return '<span>  ' + esc(l) + '</span>\n'; };
      while (a < h.del.length && a < h.ins.length && h.del[a] === h.ins[a]) a++;
      while (b < h.del.length - a && b < h.ins.length - a && h.del[h.del.length - 1 - b] === h.ins[h.ins.length - 1 - b]) b++;
      rows += '<span class="small">Line ' + (h.at + 1) + '</span>\n' + h.del.slice(0, a).map(same).join('') + h.del.slice(a, h.del.length - b).map(function (l) { return '<span class="del">- ' + esc(l) + '</span>'; }).join('') +
        h.ins.slice(a, h.ins.length - b).map(function (l) { return '<span class="add">+ ' + esc(l) + '</span>'; }).join('') + h.del.slice(h.del.length - b).map(same).join('');
    });
    return '<div class="hist-cmp" id="hist-cmp-' + esc(e.ref) + '" tabindex="-1">' + (o.compareMsg ? '<p class="notice warn" role="status">' + esc(o.compareMsg) + '</p>' : '') +
      (rows ? '<pre class="diff" aria-label="Compare: lines removed, then lines added">' + rows + '</pre>' : '<p class="small">' + (e.big ? 'This change was too big to keep line by line, so only its fingerprints were kept.' : e.badDef ? 'This save\'s step type couldn\'t be read from its history file.' : 'Nothing to compare for it.') + '</p>') + '</div>';
  }
  function savedEntry(ctx, o, e, item) {
    var TL = PF.timeline, who = e.by ? nameOf(ctx, e.by) : 'Someone', ai = /^agent-/.test(e.writer), detail = '';
    if (e.kind === 'type-edit' && e.badDef) detail = '<p class="small">This save\'s step type couldn\'t be read from its history file, so its fields aren\'t shown.</p>';
    else if (e.kind === 'type-edit') {
      var cs = TL.typeChanges(e.before, e.after).filter(function (c) { return !item || c.item === item; });
      detail = e.big ? '<p class="small">Too big to keep field by field; only its fingerprints were kept.</p>' : cs.map(function (c) { return histBa(c.before, c.after, c.label); }).join('');
    } else if (e.big) detail = '<p class="small">Too big to keep line by line; only its fingerprints were kept.</p>';
    else detail = histHunks(e, item).map(function (h) { return histBa(h.del.join('\n'), h.ins.join('\n'), 'Line ' + (h.at + 1) + ': before and after'); }).join('');
    var open = o.compare === e.ref, canReverse = PF.timeline.reversible(e);
    return '<li class="hist-entry saved"><div class="hist-what">' + esc(histSource(e)) + '</div><div class="small">' + esc(who) + (ai ? ' (AI assistant)' : '') + (e.at ? ' · ' + esc(U.when(e.at)) : '') + '</div>' +
      (e.units.length ? '<ul class="hist-units small">' + e.units.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul>' : '') + detail +
      '<div class="row hist-acts"><button type="button" class="mini" data-act="hist-compare" data-id="' + esc(e.ref) + '" aria-expanded="' + open + '">Compare</button>' +
      (canReverse ? '<button type="button" class="mini" data-act="hist-reverse" data-id="' + esc(e.ref) + '">Reverse this change</button>' : '') + '</div>' +
      (open ? histCompare(e, o, item) : '') + '</li>';
  }
  function savedHistory(ctx, o) {
    var s = o.saved || {}, item = o.savedItem || o.item, n = 0, list = '';
    if (s.state === 'none') return '<p class="small">Saved history starts once this step type is saved.</p>';
    if (s.state === 'error') return '<p class="small" role="status">Couldn\'t read the saved history: ' + esc(s.msg || '') + '</p>';
    if (s.state !== 'ok') return '<p class="small" role="status">Reading the saved history…</p>';
    s.items.forEach(function (x) {
      if (x.gap) { if (!item) list += '<li class="hist-mark hist-outside"><b>Changed outside Flightdeck</b> · by hand, by an AI assistant, or by a copy of Flightdeck that doesn\'t keep history.</li>'; return; }
      if (x.pub) { if (!item) list += '<li class="hist-mark hist-pub"><b>Published v' + esc(String(x.pub.version)) + '</b> · ' + esc(nameOf(ctx, x.pub.by)) + (x.pub.at ? ' · ' + esc(U.when(x.pub.at)) : '') + '</li>'; return; }
      if (item && x.entry.items.indexOf(item) < 0) return;
      n++; list += savedEntry(ctx, o, x.entry, item);
    });
    var other = s.unknown && s.unknown.length ? '<p class="small">Not read, since they aren\'t history files: ' + s.unknown.map(esc).join(', ') + '.</p>' : '';
    if (s.skipped) other += '<p class="small">' + s.skipped + (s.skipped === 1 ? ' older line' : ' older lines') + ' in the history files ' + (s.skipped === 1 ? 'isn\'t' : 'aren\'t') + ' shown: only each file\'s newest 2,000 are read.</p>';
    var bad = s.bad ? '<p class="small">' + s.bad + (s.bad === 1 ? ' line' : ' lines') + ' in the history files couldn\'t be read and ' + (s.bad === 1 ? 'isn\'t' : 'aren\'t') + ' shown.</p>' : '';
    if (!n) return '<p class="small">' + (item ? 'No saved changes to it yet.' : 'No saved changes yet. Each save from now on is kept here.') + '</p>' + (list && !item ? '<ol class="hist-list">' + list + '</ol>' : '') + bad + other;
    return '<ol class="hist-list">' + list + '</ol>' + bad + other;
  }

  /* ---------- Starting a linked step's child (2.8): what it passes, read-only, and the boxes it asks ---------- */
  /* Why this version, from where the target came from (design.md 40): a version: pin, a pin this run keeps, the first pin, or
     a run/2's latest. A pin doesn't say whether it was taken at the start or later, so the wording doesn't claim either. */
  function childVersionWords(ctx, prep) {
    var t = prep.target, pub = prep.pub, v = pub.info.version, r = ctx.run(), id = prep.stepId;
    var own = function (o, k) { return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); };
    var why = r && r.payload && r.payload.pins && own(r.payload.pins.children, id) ? 'this step always uses v' + v
      : t.first ? 'the latest now; this run uses it from here on' : r && r.format === R.FORMAT3 ? 'this run keeps v' + v : 'the latest now';
    var proc = ctx.procOf && ctx.procOf(prep.f.process), latest = proc && proc.latest;
    var newer = latest && latest.info.version > v ? 'v' + latest.info.version + ' is published; this run keeps v' + v + '.' : '';
    return { head: pub.map.meta.title + ' v' + v + ' · ' + why, newer: newer };
  }
  function childStart(ctx, prep) {
    var pub = prep.pub, meta = pub.map.meta, r = ctx.run(), setBy = M.setBy(pub.map), w = childVersionWords(ctx, prep);
    var people = PF.people.sorted(ctx).filter(function (x) { return !x.inactive; }), nm = PF.people.labeler(people);
    var h = '<div class="overlay" data-act="close-overlay"><div class="help cs-box" role="dialog" aria-modal="true" aria-labelledby="cs-t"><div class="eyebrow">' + esc(w.head) + '</div><h2 id="cs-t" tabindex="-1">Start the ' + esc(meta.title) + ' run</h2>' +
      (w.newer ? '<p class="small">' + esc(w.newer) + '</p>' : '') +
      '<form class="stack" id="child-start-form" data-token="' + esc(String(prep.token)) + '">' +
      (prep.error ? '<p class="notice bad" id="cs-err" role="alert" tabindex="-1">' + esc(prep.error) + '</p>' : '');
    var typed = prep.values || {}, kept = function (f) { return Object.prototype.hasOwnProperty.call(typed, f) ? String(typed[f]) : ''; };
    var own = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }, teamSrc = prep.teamSrc || {}, teamOf = {};
    (prep.team || []).forEach(function (e) { teamOf[e.name] = e.team; });
    var passed = prep.rows.filter(function (x) { return x.source !== 'ask' && prep.open.indexOf(x.name) < 0 && (x.source !== 'team' || own(teamSrc, x.name)); });
    /* A team value (2.9) is shown as the child gets it: converted to its kind when the child's detail has one. */
    var shown = function (x) {
      if (x.source !== 'team') return own(prep.details, x.name) ? prep.details[x.name] : '';
      var def = R.typedDef({ snapshot: '' }, pub.map, 'details.' + x.name), m = def ? R.migrateDetail(def, teamSrc[x.name]) : null;
      return m && (m.verdict === 'exact' || m.verdict === 'converted') ? m.result : teamSrc[x.name];
    };
    if (passed.length) h += '<h3>Passed from this run</h3><dl>' + passed.map(function (x) {
      var v = shown(x);
      return '<dt>' + esc(x.name) + '</dt><dd>' + (v === '' ? '<span class="small">(empty)</span>' : esc(v)) + ' <span class="small">· ' + (x.source === 'value' ? 'fixed in the checklist' : x.source === 'team' ? 'team value ' + esc(x.team) : 'from ^' + esc(x.from) + ' of this run') + '</span></dd>';
    }).join('') + '</dl>';
    Object.keys(prep.replaced || {}).forEach(function (k) { h += '<p class="notice warn" role="status">You typed ' + esc(prep.replaced[k]) + '; the team value ' + esc(teamOf[k] || k) + ' is now ' + esc(teamSrc[k]) + ', and that\'s what will be used.</p>'; });
    var boxes = prep.open.concat(prep.ask);
    if (boxes.length) {
      h += '<h3>' + (prep.ask.length ? 'What ' + esc(meta.title) + ' needs from you' : 'Check these') + '</h3><div class="grid2">';
      boxes.forEach(function (f) {
        var def = R.typedDef({ snapshot: '' }, pub.map, 'details.' + f), opened = prep.open.indexOf(f) >= 0, g = opened ? (own(teamSrc, f) ? teamSrc[f] : prep.details[f] || '') : '';
        /* What the box is for, under it: a team value that isn't set, a team value that doesn't convert, a refill's note. */
        var note = own(prep.notes, f) ? prep.notes[f] : (prep.teamAsk || []).indexOf(f) >= 0 ? 'The team value ' + (teamOf[f] || f) + ' isn\'t set; type it for this run.' : opened && own(teamSrc, f) ? 'From the team value ' + teamOf[f] + '. ' + PF.values.ask(def, g) : opened ? PF.values.ask(def, g) : '';
        if (!def) { var box = '<label class="field" for="cs-' + esc(f) + '">' + esc(f) + '<input id="cs-' + esc(f) + '" data-detail="' + esc(f) + '" maxlength="120" value="' + esc(kept(f)) + '"></label>'; h += note ? '<div>' + box + '<p class="small">' + esc(note) + '</p></div>' : box; return; }
        h += '<div>' + K.typedField('cs-' + f, f, def, kept(f), 'data-detail="' + esc(f) + '"') + (note ? '<p class="small">' + esc(note) + '</p>' : '') + '</div>';
      });
      h += '</div>';
    }
    var later = prep.rows.filter(function (x) { return x.source === 'ask' && Object.prototype.hasOwnProperty.call(setBy, x.name); });
    if (later.length) h += '<p class="small">' + later.map(function (x) { return '<b>' + esc(x.name) + '</b> is filled in by "' + esc(setBy[x.name][0].text) + '"'; }).join('; ') + '.</p>';
    if (meta.roles.length) {
      h += '<h3>Who\'s doing what</h3><div class="grid2">';
      meta.roles.forEach(function (role) {
        var chosen = prep.roleVals && typeof prep.roleVals[role] === 'string' ? prep.roleVals[role] : r && r.roles && typeof r.roles[role] === 'string' ? r.roles[role] : '';
        h += '<label class="field" for="cs-role-' + esc(role) + '">' + esc(role) + '<select id="cs-role-' + esc(role) + '" data-role="' + esc(role) + '"><option value="">Nobody yet</option>' +
          people.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === chosen ? ' selected' : '') + '>' + esc(nm(x)) + '</option>'; }).join('') + '</select></label>';
      });
      h += '</div>';
    }
    return h + '<div class="row"><button class="btn go" type="submit" id="cs-submit">' + I('play') + 'Start the run</button><button class="mini" type="button" data-act="close-overlay">Cancel</button><span class="small">This step is checked when it completes.</span></div></form></div></div>';
  }
  /* Link it on a step that passes team values (2.9): the run was linked after it started, so its values are confirmed, as
     shown, by a person; a change while it's open redraws it. */
  function linkConfirm(ctx, snap) {
    var names = Object.keys(snap.values);
    var h = '<div class="overlay" data-act="close-overlay"><div class="help cs-box" role="dialog" aria-modal="true" aria-labelledby="lc-t"><h2 id="lc-t" tabindex="-1">Link "' + esc(snap.title) + '"</h2>' +
      (snap.changed ? '<p class="notice warn" role="alert">' + esc(snap.changed) + '</p>' : '') +
      '<p>This run was linked after it started, so Flightdeck didn\'t record what it was passed. Link it if these are the values it was meant to get.</p><dl>' +
      names.map(function (n) { var v = snap.values[n]; return '<dt>' + esc(n) + '</dt><dd>' + (v === '' ? '<span class="small">(empty)</span>' : esc(v)) + ' <span class="small">· team value ' + esc(snap.teams[n]) + '</span></dd>'; }).join('') + '</dl>' +
      (snap.empty ? '<p class="notice warn" role="status">' + esc(snap.empty.join(', ')) + (snap.empty.length > 1 ? ' aren\'t values' : ' isn\'t a value') + ' a team value can be, so this run can\'t be linked this way. Start a new run instead.</p>' : '') +
      '<div class="row">' + (snap.empty ? '' : '<button class="btn go" type="button" data-act="link-child-confirm">Link it with these values</button>') + '<button class="mini" type="button" data-act="close-overlay">Cancel</button></div></div></div>';
    return h;
  }
  V.historyDrawer = historyDrawer;
  V.linkConfirm = linkConfirm;
  V.search = search; V.releases = releases; V.textPreview = textPreview; V.semverCmp = semverCmp; V.help = help; V.tabOnlyHelp = tabOnlyHelp; V.lightbox = lightbox; V.childStart = childStart; V.childVersionWords = childVersionWords;
})();
