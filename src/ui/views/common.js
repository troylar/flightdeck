/* Screens are split by area (views/*.js); this file holds what they share. Each screen returns HTML; app.js wires events.
   Everything shown from files goes through esc() or the escape-first Markdown. */
PF.views = {};
PF.vk = (function () {
  'use strict';
  var U = PF.util, I = PF.icons.icon, esc = U.esc;
  /* ---------- small helpers ---------- */
  function person(ctx, id) { return ctx.peopleById[id] || null; }
  function nameOf(ctx, id) { var p = person(ctx, id); return p ? p.name : id ? String(id) : 'nobody'; }
  /* Who looks after a checklist: its owner and backup owner (the published version's, else the draft's) who are active on the
     team. null when nobody is, so what they'd see goes to everyone. */
  function keepers(ctx, p) {
    var meta = p.latest ? p.latest.map.meta : p.draftMeta || (p.draft ? PF.map.parse(p.draft.md).meta : null);
    var by = ctx.peopleById, on = function (id) { var x = id && Object.prototype.hasOwnProperty.call(by, id) ? by[id] : null; return x && !x.inactive ? id : null; };
    var list = meta ? [on(meta.owner), on(meta.backup)].filter(Boolean) : [];
    return list.length ? list : null;
  }
  function keeps(ctx, p) { var k = keepers(ctx, p); return !k || (!!ctx.state.me && k.indexOf(ctx.state.me) >= 0); }
  function avatar(ctx, id, lg) {
    var p = person(ctx, id), ini = p ? p.initials : String(id || '?').slice(0, 2).toUpperCase();
    return '<span class="avatar' + (lg ? ' lg' : '') + '" title="' + esc(nameOf(ctx, id)) + '">' + esc(ini) + '</span>';
  }
  /* The examples in a browser that refuses storage live in this tab only. The page shell's badge says so, short on screen and
     in full to screen readers; it holds nothing focusable, so it never traps or takes focus. */
  function tabOnly(ctx) {
    return ctx.state.fs && ctx.state.fs.volatile ? '<div class="tab-badge" id="tab-only" role="note"><span aria-hidden="true">Tab only: changes vanish on reload</span>' +
      '<span class="sr">Kept in this tab only. This browser doesn\'t let Flightdeck keep anything, so the examples and your changes to them last only while this tab is open. Reloading or closing it loses them. To keep your work, use a team folder.</span></div>' : '';
  }
  function notices(ctx, opts) {
    var h = '';
    /* A quiet message (a check said back, Copied) is only announced, never shown as a notice. */
    if (ctx.state.msg && !ctx.state.msg.quiet) h += '<div class="notice ' + (ctx.state.msg.kind || '') + '" role="status"><span>' + esc(ctx.state.msg.text) + '</span><span class="row">' + (ctx.state.msg.act ? '<button class="btn" data-act="' + esc(ctx.state.msg.act) + '"' + (ctx.state.msg.id ? ' data-id="' + esc(ctx.state.msg.id) + '"' : '') + '>' + esc(ctx.state.msg.label) + '</button>' : '') + '<button class="mini" data-act="dismiss">Dismiss</button></span></div>';
    var cur = /^(run|receipt|finish|mission)$/.test(ctx.state.view) && ctx.run();
    if (cur && ctx.state.unsaved[cur.id]) h += '<div class="notice bad" role="alert"><span><b>Your last change isn\'t saved.</b> ' + esc(ctx.state.saveErr[cur.id] || '') + ' It\'s on this screen but not in the team folder' + (cur.ended ? ', so the run hasn\'t really ended yet' : '') + '.</span><span class="row"><button class="btn" data-act="retry-save">Try again</button><button class="mini" data-act="discard-unsaved">Discard my change</button></span></div>';
    /* A planned start whose run didn't save (2.1.1): only this window, for the same person, can save that exact run. */
    Object.keys(ctx.state.pendingStarts || {}).sort().forEach(function (pid) {
      var ps = ctx.state.pendingStarts[pid];
      if (ps.fs === ctx.state.fs && ps.key === ctx.fsKey && ps.me === ctx.state.me) h += '<div class="notice bad" role="alert"><span><b>The plan "' + esc(ps.title) + '" is marked started, but ' + esc(PF.vk.unsavedWords(ps)) + '.</b> Try again to save that run (' + esc(ps.id) + '); nothing else starts it.</span><span class="row"><button class="btn" data-act="plan-resume" data-id="' + esc(ps.plan) + '"' + (ctx.state.resuming ? ' disabled' : '') + '>Try again</button></span></div>';
    });
    if (ctx.state.folderErr) h += '<div class="notice bad" role="alert"><span><b>Can\'t read the team folder.</b> ' + esc(ctx.state.folderErr) + ' You\'re seeing what was last read at ' + U.hm(ctx.data.readAt) + '. Check that OneDrive is running and the folder is available offline.</span><span class="row"><button class="btn" data-act="refresh">Try again</button><button class="mini" data-act="recovery" data-id="onedrive-isnt-syncing">What to do</button></span></div>';
    /* Part of the folder couldn't be read: what was read before for it stays on screen, and this says so. */
    var failed = Object.keys(ctx.data.failed || {});
    if (failed.length && !ctx.state.folderErr) h += '<div class="notice warn" role="status"><span><b>Part of the team folder couldn\'t be read</b> (' + esc(failed.join(', ')) + '). You\'re seeing what was read before for ' + (failed.length === 1 ? 'it' : 'them') + '.</span><span class="row"><button class="btn" data-act="refresh">Try again</button><button class="mini" data-act="health">Folder health</button></span></div>';
    if (PF.vk.connBanner) h += PF.vk.connBanner(ctx);
    if (!ctx.state.me && !(opts && opts.noMe)) h += '<div class="notice warn"><span>Choose who you are at the top right. Everything you record or note is stamped with your name.</span></div>';
    return h;
  }
  function ago(iso, now) {
    var s = Math.max(0, Math.round((now - new Date(iso)) / 1000));
    if (s < 60) return s + ' s ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    return U.when(iso);
  }
  function runKey(r) { return r.process + '/' + r.id; }
  /* Three different facts, never blurred: when this computer saved, when it last read the folder, and whether it can read it at all.
     None of them proves another computer has the change yet; OneDrive decides that. */
  function freshness(ctx, r, short) {
    var st = ctx.state, now = ctx.now(), parts = [], here = st.fs && st.fs.volatile ? 'saved in this tab only ' : 'saved here ';
    if (st.folderErr) return '<span class="small" style="color:var(--stop)">Can\'t read the folder right now</span>';
    if ((r && ((st.unread || {}).runs || {})[r.process + '/' + r.id]) || Object.keys(ctx.data.failed || {}).length) return '<span class="small" style="color:var(--stop)">Part of the folder couldn\'t be read · checked ' + esc(U.hm(st.runReadAt || ctx.data.readAt)) + '</span>';
    /* The run screen's strip: the same two facts, in fewer words. */
    if (short) return '<span class="small">' + esc((r && r.savedAt ? (ctx.recording && ctx.recording(r) ? 'S' + here.slice(1) : 'Last saved ') + U.hm(r.savedAt) + ' · ' : '') + 'Folder checked ' + U.hm(st.runReadAt || ctx.data.readAt)) + '</span>';
    if (r && r.savedAt) parts.push(here + U.hm(r.savedAt) + ' (' + ago(r.savedAt, now) + ')');
    parts.push('folder checked ' + U.hm(st.runReadAt || ctx.data.readAt));
    return '<span class="small">' + esc(parts.join(' · ')) + (st.fs && st.fs.kind === 'folder' ? ' · OneDrive shares it with others' : '') + '</span>';
  }

  /* A hierarchy (group paths like ["Engineering", "Releases"]) as nested, foldable lists. Items without a group go last. Group
     names sort by name, naturally (Group 2 before Group 10). */
  function treeOf(items, pathOf) {
    /* Group names come from files, so nodes have no prototype: a group called "constructor" is just a group. */
    var root = { kids: Object.create(null), order: [], items: [] };
    items.forEach(function (it) {
      var node = root;
      (pathOf(it) || []).forEach(function (seg) { if (!node.kids[seg]) { node.kids[seg] = { kids: Object.create(null), order: [], items: [] }; node.order.push(seg); } node = node.kids[seg]; });
      node.items.push(it);
    });
    (function sort(n) { n.order.sort(PF.text.natural); n.order.forEach(function (k) { sort(n.kids[k]); }); })(root);
    return root;
  }
  /* The items in the order the tree draws them: each level's groups by name, then its own items. */
  function treeOrder(root) {
    var out = [];
    (function walk(n) { n.order.forEach(function (k) { walk(n.kids[k]); }); n.items.forEach(function (it) { out.push(it); }); })(root);
    return out;
  }
  /* on: the keys of the items to draw (keyOf), or null for all of them. A group with none of them drawn isn't drawn; its count
     is always of every item, and says how many are shown when that's fewer ("12 · 3 shown"). The shape (which groups fold
     into one heading) is the whole list's, so paging never renames a group. */
  function treeDraw(root, render, openSet, on, keyOf) {
    var N = function (x) { return x.toLocaleString('en-US'); };
    function count(n, only) { return n.items.reduce(function (s, it) { return s + (!only || on[keyOf(it)] ? 1 : 0); }, 0) + n.order.reduce(function (s, k) { return s + count(n.kids[k], only); }, 0); }
    function draw(n, path) {
      var groups = n.order.map(function (seg) {
        /* A group whose only child is a group is one heading ("Delivery / Backlog"); a count of 1 isn't drawn. */
        var kid = n.kids[seg], p = path.concat(seg), name = [seg];
        while (!kid.items.length && kid.order.length === 1) { name.push(kid.order[0]); p = p.concat(kid.order[0]); kid = kid.kids[kid.order[0]]; }
        var c = count(kid, false), s = on ? count(kid, true) : c;
        if (!s) return '';
        var key = p.join(' / '), shut = openSet && Object.prototype.hasOwnProperty.call(openSet, key) && openSet[key] === false;
        return '<li class="tgroup"><details' + (shut ? '' : ' open') + ' data-group="' + esc(key) + '"><summary><span class="t">' + esc(name.join(' / ')) + '</span>' + (c > 1 ? ' <span class="small">' + N(c) + (s < c ? ' · ' + N(s) + ' shown' : '') + '</span>' : '') + '</summary><ul class="plist">' + draw(kid, p) + '</ul></details></li>';
      }).join('');
      return groups + n.items.filter(function (it) { return !on || on[keyOf(it)]; }).map(render).join('');
    }
    return '<ul class="plist tree">' + draw(root, []) + '</ul>';
  }
  function tree(items, pathOf, render, openSet) { return treeDraw(treeOf(items, pathOf), render, openSet, null, null); }
  /* A tree a page at a time (2.11): the page is the first n items in the order the tree draws them, and only their groups are
     drawn, so closed folds and 1,000 groups of one still draw 50 rows. Group counts are of every item given. o: as K.list,
     with keyOf required. */
  function treeList(st, id, items, pathOf, render, o) {
    var root = treeOf(items, pathOf), keyOf = o.keyOf;
    return list(st, id, treeOrder(root), Object.assign({}, o, { draw: function (shown) {
      var on = Object.create(null); shown.forEach(function (it) { on[keyOf(it)] = true; });
      return treeDraw(root, render, st.groupsOpen, on, keyOf);
    } }));
  }
  /* The tag filter: every tag in use, as toggles. A list shows only items with all chosen tags. */
  /* Folded into Filter by tag (N) unless a tag is chosen or it was opened (st.disc.tags). With st, the tags are drawn 50 at a
     time (2.11), chosen ones always. */
  function tagBar(all, chosen, disc, st) {
    if (!all.length) return '';
    var open = chosen.length || (disc || {}).tags;
    return '<details class="tagfold" data-disc="tags"' + (open ? ' open' : '') + '><summary class="small">Filter by tag (' + all.length + ')</summary>' + tagButtons(all, chosen, st) + '</details>';
  }
  function tagButtons(all, chosen, st) {
    var btn = function (t) { var on = chosen.indexOf(t) >= 0; return '<button class="tag' + (on ? ' on' : '') + '" data-act="tag" data-id="' + esc(t) + '" aria-pressed="' + on + '">#' + esc(t) + '</button>'; };
    var body = st ? list(st, 'tags', all, { draw: function (shown) { return shown.map(btn).join(''); }, keyOf: function (t) { return t; }, focusOf: function (t) { return byAct('tag', t); }, soft: chosen, keptLabel: 'Chosen' }) : all.map(btn).join('');
    return '<div class="tagbar" role="group" aria-label="Filter by tag">' + body + (chosen.length ? '<button class="mini" data-act="tag" data-id="">Clear</button>' : '') + '</div>';
  }
  /* ---------- Find boxes (2.11) ---------- */
  /* What's typed in a list's Find box (state.find, for this folder only: renderNow drops it after a folder switch). */
  function findQ(st, id) { return st.find && st.find.q ? String(st.find.q[id] || '') : ''; }
  /* Whether a list's Find box is drawn: when the list is long enough (over), and whatever its length while the box has text
     or focus (st.selFocus, kept by the app while focus is in it), so a newer read that shortens the list never takes away
     the box someone is typing in or filtering with (code review round 19). */
  function findOn(st, id, over) { return !!over || !!findQ(st, id) || st.selFocus === id; }
  /* Whether an item's words hold every term typed, ignoring case. */
  function finds(q) {
    var terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    return function (words) {
      if (!terms.length) return true;
      var w = words.filter(function (x) { return x != null && x !== ''; }).join('\n').toLowerCase();
      return terms.every(function (t) { return w.indexOf(t) >= 0; });
    };
  }
  /* The box, drawn from state (data-bound), with its count: "12 of 1,000 match", or that none does, and Clear. */
  function findBox(st, id, label, n, total, noun) {
    var q = findQ(st, id), N = function (x) { return x.toLocaleString('en-US'); }, fid = 'find-' + id;
    var count = !q ? '' : n ? N(n) + ' of ' + N(total) + ' match' : 'No ' + noun + ' matches "' + esc(q) + '"';
    return '<div class="row findbox"><label for="' + esc(fid) + '">' + esc(label) + '</label><input type="search" id="' + esc(fid) + '" data-find="' + esc(id) + '" data-nav-safe data-bound value="' + esc(q) + '" autocomplete="off" maxlength="200" aria-describedby="' + esc(fid) + '-n">' +
      '<span class="small" id="' + esc(fid) + '-n" role="status">' + count + '</span>' + (q ? '<button type="button" class="mini" data-act="find-clear" data-id="' + esc(id) + '">Clear</button>' : '') + '</div>';
  }
  /* A long list, 50 at a time: the first n items (n grows by 50 with Show more, kept per list in state.more), how many there
     are, and the button. keyOf names an item, so focus can move to the first one Show more adds. Paging rather than
     scrolling tricks keeps Ctrl+F, screen readers and the page's patching working. */
  var PAGE = 50;
  function paged(st, id, items, draw, keyOf) { return list(st, id, items, { draw: draw, keyOf: keyOf }); }
  /* The same, with what a list says about itself (2.11). Items are light descriptors: the costly work for a row happens in
     o.draw, which only gets the rows drawn. o:
       draw(shown), keyOf(item): the rows' HTML, and an item's key;
       focusOf(key): the selector Show more focuses for the first item it adds, something always there and focusable (a row's
         heading or title with tabindex="-1", or a row that is one button). Without it, the run card with that key, as before;
       page: the page size (50); keep: keys drawn whatever the page (a row being edited: pinned, never dropped); soft: keys
         drawn past the page while they fit in a page of them (a role given someone, its value kept elsewhere);
       outside: items Find leaves out, drawn after the list only when pinned or focused (K.roleRows);
       tail: the last n items, with Show earlier above them (a thread read newest last); gap(n): the line between a tail's kept
         rows and the tail ("270 notes between");
       inDialog: the list is in a dialog, so focus moves through the dialog's own focus;
       groupOf(item): the item a row belongs to, when several rows draw one item (below).
     The item Flightdeck just showed you (state.justShown, ensureListItemVisible in app.js) is drawn whatever the page too.
     So is the row that has focus (focusHeld): a refresh that sorts something in above it never takes it off the page.
     Rows kept past the page are drawn after it (before it, for a tail), so nobody loses the row they're working on.
       hold: false for a list that keeps its focused row itself (the note thread and corrections, by the note's anchor). */
  /* The keys each list drew last time, so a redraw can tell which of them had focus (focusHeld). */
  var drawnBy = Object.create(null);
  function runCardSel(k) { return '[data-act="open-run"][data-id="' + cssStr(k) + '"]'; }
  /* The row with focus, among those this list drew last time and won't draw now: its key, kept drawn whatever the page (one
     extra row, for this list only), or, when its item is gone, focus goes to the list's heading (PF.vk.focusAt is set by the
     app's render while focus is on the page, and holds the page as it was drawn). drawn: every key this render draws without
     it, the same set the rows are drawn from, so a row skipped here as drawn always is (code review round 12). cands: the
     list's items and its outside ones. */
  function focusHeld(id, cands, drawn, o) {
    var fa = PF.vk.focusAt, was = drawnBy[id];
    if (!fa || !was || !was.length || o.hold === false) return null;
    var sel = function (k) { return o.focusOf ? o.focusOf(k) : runCardSel(k); };
    if (was.length > 1 && fa.away(sel(was[0]), sel(was[was.length - 1]))) return null;
    /* Every row drawn last time is looked at, however many (Show more can reach thousands): those not drawn now are looked
       for around the focused element first (fa.near, no search of the whole page), then checked row by row. */
    for (var i = 0; i < was.length; i++) {
      var k = was[i];
      if (drawn[k]) continue;
      if (fa.near && !fa.near(sel(k))) continue;
      var other = was[0] !== k ? was[0] : was.length > 1 ? was[1] : null;
      if (!fa.inRow(sel(k), other == null ? null : sel(other))) continue;
      for (var j = 0; j < cands.length; j++) if (o.keyOf(cands[j]) === k) return k;
      fa.lost(id);
      return null;
    }
    return null;
  }
  function list(st, id, items, o) {
    var P = o.page || PAGE, n = Math.max(P, Math.floor(((st.more || {})[id]) || P));
    /* Tests turn paging off for one list (PF.vk.PAGE_OFF = its id), to prove the bounds test notices; PF.vk.ARRIVE = its id
       moves the list's last item to the top (its first, for a tail), as a newer read that sorts one in above would. */
    if (PF.vk.PAGE_OFF === id) n = items.length;
    if (PF.vk.ARRIVE === id && items.length > 1) items = o.tail ? items.slice(1).concat(items.slice(0, 1)) : items.slice(-1).concat(items.slice(0, -1));
    var keyOf = o.keyOf, outside = o.outside || [], L = items.length;
    var from = o.tail ? Math.max(0, L - n) : 0, shown = items.slice(from, from + n), left = L - shown.length;
    /* The rows drawn, in three tiers (code review round 12):
       1. the page: the first n items (the last n, for a tail). With Find, the caller gives only the matches as items, so the
          page is matches and nothing else pushes them off it;
       2. pinned rows, never dropped and bounded by what they are: o.keep (a row with text typed and not applied, refused, held
          by its note, being edited or renamed, a fixed value just chosen), what a search just showed (state.justShown) and
          the row with focus. A pinned row Find leaves out is drawn from o.outside, after the matches;
       3. ordinary kept rows, o.soft (a role given someone, whose value a form keeps in a hidden field or in state): past the
          page, the nearest page of them, and with Find only those that match.
       Focus is looked for among rows not drawn by these tiers, and Show more's label and step come from the same tiers
       worked out for the bigger page, so what it says it adds is what the next draw adds. */
    var pin = Object.create(null), soft = Object.create(null), js = st.justShown && st.justShown.lists ? st.justShown.lists[id] : null;
    (o.keep || []).forEach(function (k) { if (k != null) pin[k] = true; });
    if (js != null) pin[js] = true;
    (o.soft || []).forEach(function (k) { if (k != null && !pin[k]) soft[k] = true; });
    var drawn = Object.create(null), at = function (t) { return o.tail ? from - 1 - t : from + shown.length + t; };
    shown.forEach(function (it) { drawn[keyOf(it)] = true; });
    var inPage = Object.assign(Object.create(null), drawn);
    /* Past the page, in page order (away from it): softAt holds each ordinary kept row's offset, the first page of them drawn. */
    var softAt = [];
    for (var t = 0; t < left; t++) { var kt = keyOf(items[at(t)]); if (pin[kt]) drawn[kt] = true; else if (soft[kt]) { if (softAt.length < P) drawn[kt] = true; softAt.push(t); } }
    var outPin = outside.filter(function (it) { return pin[keyOf(it)]; });
    outPin.forEach(function (it) { drawn[keyOf(it)] = true; });
    var held = focusHeld(id, outside.length ? items.concat(outside) : items, drawn, o);
    if (held != null) {
      drawn[held] = true;
      if (!items.some(function (it) { return keyOf(it) === held; })) outPin = outPin.concat(outside.filter(function (it) { return keyOf(it) === held; }));
    }
    var extra = [], plus = false, kept = false, onIt = false;
    items.forEach(function (it) {
      var k = keyOf(it); if (inPage[k] || !drawn[k]) return;
      extra.push(it);
      if (k === js) plus = true; else if (k === held && !pin[k] && !soft[k]) onIt = true; else kept = true;
    });
    outPin.forEach(function (it) { var k = keyOf(it); extra.push(it); if (k === js) plus = true; else if (k === held && !pin[k]) onIt = true; else kept = true; });
    drawnBy[id] = Object.keys(inPage).concat(extra.map(keyOf));
    /* Tests list every list drawn (PF.vk.TRACE, an array): its id, every item's key, and the selector Show more focuses. */
    if (PF.vk.TRACE) PF.vk.TRACE.push({ id: id, keys: items.map(keyOf), page: shown.map(keyOf), extra: extra.map(keyOf), tail: !!o.tail, hold: o.hold !== false, focusOf: function (k) { return o.focusOf ? o.focusOf(k) : runCardSel(k); } });
    /* No row to draw (Find matches none, or the list is empty): o.empty. A list drawn even then still reports the row with focus
       gone (focusHeld), so focus goes to the list's heading, never to the page (code review round 18). */
    if (!shown.length && !extra.length && o.empty != null) return o.empty;
    var h = '', more = '';
    /* Show more: the page grows by step, the smallest that adds the most new rows up to a page, counted as the next draw will
       draw them: rows it steps over not drawn now, and ordinary kept rows that come into the nearest page past the bigger page
       (softAt[b..b+P), b of them now inside it). add is that count, and first the earliest of them in the list. */
    var add = 0, step = 0;
    if (left > 0) {
      var newIn = 0, b = 0, best = 0, bestS = 0, newKept = function (b) { var c = 0; for (var x = Math.max(b, P); x < b + P && x < softAt.length; x++) if (!drawn[keyOf(items[at(softAt[x])])]) c++; return c; };
      for (var s = 1; s <= left; s++) {
        var ks = keyOf(items[at(s - 1)]);
        if (!drawn[ks]) newIn++;
        if (soft[ks]) b++;
        var a = newIn + newKept(b);
        if (a > P) { if (!best) { best = a; bestS = s; } break; }
        if (a > best) { best = a; bestS = s; }
      }
      add = best; step = bestS;
    }
    if (add > 0) {
      var first = -1, bs = 0;
      for (var u = 0; u < step; u++) { var ku = keyOf(items[at(u)]); if (soft[ku]) bs++; if (!drawn[ku] && (first < 0 || at(u) < first)) first = at(u); }
      for (var x = Math.max(bs, P); x < bs + P && x < softAt.length; x++) { var ix = at(softAt[x]); if (!drawn[keyOf(items[ix])] && (first < 0 || ix < first)) first = ix; }
      var k = keyOf(items[first]), f = o.focusOf ? o.focusOf(k) : null;
      more = '<div class="row paged"><span class="small" role="status">Showing ' + shown.length.toLocaleString('en-US') + ' of ' + L.toLocaleString('en-US') + (plus ? ', plus the one you just ' + esc((st.justShown.words || {})[id] || o.shownWord || 'added') : '') + (onIt ? (plus ? ' and' : ', plus') + ' the one you\'re on' : '') + '</span>' +
        '<button type="button" class="btn" data-act="more" data-id="' + esc(id) + '" data-next="' + esc(k) + '"' + (f ? ' data-focus="' + esc(f) + '"' : '') + (P !== PAGE ? ' data-page="' + P + '"' : '') + (step !== P && !(step === add && step === left) ? ' data-step="' + step + '"' : '') + (o.inDialog ? ' data-dialog="1"' : '') + '>' +
        (o.tail ? 'Show ' + add + ' earlier' : 'Show ' + add + ' more') + '</button></div>';
    }
    /* groupOf: rows of one item drawn as one (a correction group's members, a change's): a kept row whose item is on the page
       is drawn inside it, after that item's last row there, so no item is drawn twice. */
    if (o.groupOf && !o.tail && extra.length) {
      var lastAt = Object.create(null), into = Object.create(null), apart = [], seq = [];
      shown.forEach(function (it, j) { lastAt[o.groupOf(it)] = j; });
      extra.forEach(function (it) { var g = o.groupOf(it); if (g in lastAt) (into[lastAt[g]] = into[lastAt[g]] || []).push(it); else apart.push(it); });
      shown.forEach(function (it, j) { seq.push(it); if (into[j]) seq.push.apply(seq, into[j]); });
      shown = seq; extra = apart; kept = kept && apart.some(function (it) { var k = keyOf(it); return pin[k] || soft[k]; });
    }
    var rest = extra.length ? (kept ? '<p class="small kept-h">' + esc(o.keptLabel || 'You\'re editing this one') + '</p>' : '') + o.draw(extra) : '';
    /* A tail's kept rows sit above it: o.gap(n) says how many rows lie between the last of them and the tail. */
    if (o.tail && extra.length && o.gap) { var last = items.indexOf(extra[extra.length - 1]), gap = from - last - 1; if (gap > 0) rest += '<p class="small tgap">' + esc(o.gap(gap)) + '</p>'; }
    if (o.tail) h = more + rest + o.draw(shown);
    else h = o.draw(shown) + more + rest;
    return h;
  }
  /* A form's roles a page at a time (2.11), as Start and Plan draw them: 20 in checklist order, with Find a role past 20 (or
     o.label and o.noun for another list of names: a step's run details in the builder). o:
     row(role), the role's HTML; keep, the roles always drawn, Find or not (being edited, refused, typed and not applied);
     soft, the roles drawn past the page when they fit in a page of them, and with Find only when they match (given someone
     on this form: their value is kept); hidden(role), what stands in for a role not drawn (its value in a hidden field), so
     the form sends exactly what it would with every role drawn; focusOf, keptLabel, inDialog as K.list. With Find, the page
     is the matches (K.list's tiers), so a kept role never pushes one off it. Returns { box, rows, hidden }. */
  function roleRows(st, id, roles, o) {
    var P = o.page || 20, q = findQ(st, id), hit = finds(q), on = Object.create(null);
    var found = q ? roles.filter(function (r) { return hit([r]); }) : roles;
    var box = findOn(st, id, roles.length > P) ? findBox(st, id, o.label || 'Find a role', found.length, roles.length, o.noun || 'role') : '';
    var rows = list(st, id, found, { page: P, keep: o.keep, soft: o.soft, outside: q ? roles.filter(function (r) { return !hit([r]); }) : null, keptLabel: o.keptLabel || 'Roles you\'ve chosen someone for', keyOf: function (r) { return r; }, focusOf: o.focusOf, inDialog: o.inDialog,
      draw: function (shown) { return shown.map(function (r) { on[r] = true; return o.row(r); }).join(''); } });
    var hidden = o.hidden ? roles.filter(function (r) { return !on[r]; }).map(o.hidden).join('') : '';
    return { box: box, rows: rows, hidden: hidden };
  }
  /* A list joined into one line (2.11, D10): the first 50 names, then "and 250 more" with Show more, which adds 50 and keeps
     focus on the line. name(item) is the item's escaped HTML; only the names shown are built. o: lead (the line's escaped
     start), noun ("run"), cls (the line's class, small by default). */
  function joined(st, id, items, name, o) {
    o = o || {};
    var n = Math.max(PAGE, Math.floor(((st.more || {})[id]) || PAGE));
    if (PF.vk.PAGE_OFF === id) n = items.length;
    var shown = items.slice(0, n), left = items.length - shown.length, lid = 'joined-' + id;
    var h = '<p class="' + esc(o.cls || 'small') + ' joined" id="' + esc(lid) + '" tabindex="-1">' + (o.lead || '') + shown.map(name).join(', ') + (left ? ', and ' + left.toLocaleString('en-US') + ' more' : '') + '</p>';
    if (left) h += '<div class="row paged"><button type="button" class="mini" data-act="more" data-id="' + esc(id) + '" data-focus="' + esc(byId(lid)) + '">Show ' + Math.min(PAGE, left) + ' more ' + esc(o.noun ? o.noun + 's' : '') + '</button></div>';
    return h;
  }
  /* A list joined into text where it can't page (a sentence, a preview, a reason): the first 50 and "and 250 more" (D10).
     name(item), when given, is the item's text or HTML, built only for the names shown; sep is ', ' by default (' and ' ends
     "and 250 more" without a second and). id lets a test turn the cap off (PF.vk.PAGE_OFF), to prove the bounds check
     notices. more(n), when given, is what follows the names instead (for a list of sentences: " And 250 more."). */
  function capJoin(items, name, sep, id, more) {
    sep = sep || ', ';
    var n = id != null && PF.vk.PAGE_OFF === id ? items.length : PAGE, shown = items.slice(0, n), left = items.length - shown.length;
    var tail = !left ? '' : more ? more(left) : sep + (/\band $/.test(sep) ? '' : 'and ') + left.toLocaleString('en-US') + ' more';
    return (name ? shown.map(function (x) { return name(x); }) : shown).join(sep) + tail;
  }
  /* A step's or lane's roles as text, "@r1 @r2 and 250 more" (code review round 11): the checklist's author can give one
     step or lane any number of roles, so its summary is capped like any list (K.capJoin). Plain text, for esc(). */
  function atRoles(roles, id) { return capJoin(roles || [], function (r) { return '@' + r; }, ' ', id); }
  /* ---------- a dropdown over a growing list (2.11, K.select) ---------- */
  /* The value of the last option, "Show 50 more…": no real value can be it (folder, run, plan and step values are words,
     dashes, slashes and colons). Choosing it widens the list and leaves the choice as it was (app.js). */
  var SEL_MORE = '#more';
  /* Whether a change or input is a K.select's "Show 50 more…" being chosen: only on a select K.select drew (data-kselect)
     with more to show (data-step), and only its last option, so a value that happens to be "#more" (a Decide step's choice
     from its options:) is always a choice (code review round 19). */
  function isSelMore(t) {
    if (!t || t.tagName !== 'SELECT' || t.value !== SEL_MORE || !t.dataset || t.dataset.kselect == null || t.dataset.step == null) return false;
    return !t.options || t.selectedIndex === t.options.length - 1;
  }
  /* A native <select> over a list that grows with the team folder: at most 50 of its items (the page) as options, plus the
     chosen one, in the list's own order; past 50, a Find box above narrows them over every item, and "Show 50 more…" (an
     option, and a Show more choices button for the keyboard) widens them. The box stays while it has text or focus
     (st.selFocus), even when fewer than 50 are left. Only the drawn options are built. items: { v, t, place, words,
     disabled, group } in order; place tells apart items with the same label ("Confirm the result · Phase 3, step 4"), and Find
     matches it. sel: the value drawn as chosen (the saved one: a choice not saved yet is put back by the page after the draw,
     so leaving still sees it as unsaved). o: attrs (the select's own attributes, escaped), lead and trail (its fixed options'
     HTML: None, Any, Latest), keep (values always drawn, sel by default), around (the item to center the first 50 on, with
     no Find text: the current phase), cur (the choice to keep when Show 50 more… is chosen), noun ("run or plan"), page,
     draw(item) (what's worked out only for a drawn option: { more: text added to its label, disabled }), group(item) (its
     optgroup's label).
     Returns { box, select, more, html, drawn, total }. */
  function select(st, id, items, sel, o) {
    o = o || {};
    var P = o.page || PAGE, n = Math.max(P, Math.floor(((st.more || {})[id]) || P)), q = findQ(st, id), Nn = function (x) { return x.toLocaleString('en-US'); };
    if (PF.vk.PAGE_OFF === id) n = items.length;
    var seen = Object.create(null);
    items.forEach(function (it) { seen[it.t] = (seen[it.t] || 0) + 1; });
    var text = function (it) { return seen[it.t] > 1 && it.place ? it.t + ' · ' + it.place : it.t; };
    var hit = finds(q), match = [];
    items.forEach(function (it, i) { if (!q || hit([text(it), it.place || '', it.words || ''])) match.push(i); });
    var fromAt = function (n) { return !q && o.around != null && o.around >= 0 ? Math.max(0, Math.min(o.around - Math.floor(n / 2), match.length - n)) : 0; }, from = fromAt(n);
    var on = Object.create(null), keep = Object.create(null), cur = o.cur != null ? o.cur : sel;
    match.slice(from, from + n).forEach(function (i) { on[i] = true; });
    (o.keep || [sel]).forEach(function (v) { if (v != null && v !== '') keep[v] = true; });
    items.forEach(function (it, i) { if (keep[it.v]) on[i] = true; });
    /* Show more counts only the choices still hidden (kept ones are drawn already): it says how many it adds, and the page
       grows by however many it steps over (data-step) to add them. */
    var hidden = 0; match.forEach(function (i) { if (!on[i]) hidden++; });
    var want = Math.min(P, hidden), step = 0;
    if (want && !(o.around != null && o.around >= 0 && !q)) { for (var j = from + n, add = 0; add < want && j < match.length; j++) { step++; if (!on[match[j]]) add++; } }
    else if (want) {
      for (var n2 = n + 1, add2 = 0; add2 < want && n2 <= match.length; n2++) {
        var f2 = fromAt(n2); add2 = 0;
        for (var k = f2; k < f2 + n2 && k < match.length; k++) if (!on[match[k]]) add2++;
        step = n2 - n;
      }
    }
    var more = hidden > 0, drawn = 0, grp = null, opts = '';
    items.forEach(function (it, i) {
      if (!on[i]) return;
      drawn++;
      var g = o.group ? o.group(it) : null;
      if (g !== grp) { opts += (grp != null ? '</optgroup>' : '') + (g != null ? '<optgroup label="' + esc(g) + '">' : ''); grp = g; }
      var d = o.draw ? o.draw(it) : null, off = d && d.disabled != null ? d.disabled : it.disabled;
      opts += '<option value="' + esc(it.v) + '"' + (it.v === sel ? ' selected' : '') + (off ? ' disabled' : '') + '>' + esc(text(it) + (d && d.more ? d.more : '')) + '</option>';
    });
    if (grp != null) opts += '</optgroup>';
    var fid = 'find-' + id, showBox = findOn(st, id, items.length > P);
    var box = !showBox ? '' : '<div class="row findbox selfind"><label for="' + esc(fid) + '">Find a ' + esc(o.noun || 'choice') + '</label><input type="search" id="' + esc(fid) + '" data-find="' + esc(id) + '" data-sel-find="' + esc(id) + '" data-nav-safe data-bound value="' + esc(q) + '" autocomplete="off" maxlength="200" aria-controls="' + esc(id) + '" aria-describedby="' + esc(fid) + '-n">' +
      '<span class="small" id="' + esc(fid) + '-n" role="status">' + (!q ? '' : match.length ? Nn(match.length) + ' of ' + Nn(items.length) + ' match' : 'No ' + esc(o.noun || 'choice') + ' matches "' + esc(q) + '"') + '</span>' + (q ? '<button type="button" class="mini" data-act="find-clear" data-id="' + esc(id) + '">Clear</button>' : '') + '</div>';
    var selHtml = '<select id="' + esc(id) + '"' + (o.attrs || '') + ' data-kselect data-cur="' + esc(cur == null ? '' : cur) + '"' + (more ? ' data-step="' + step + '"' : '') + '>' + (o.lead || '') + opts + (o.trail || '') + (more ? '<option value="' + SEL_MORE + '">Show ' + want + ' more…</option>' : '') + '</select>';
    var moreBtn = more ? '<button type="button" class="mini selmore" data-act="sel-more" data-id="' + esc(id) + '" data-step="' + step + '" aria-controls="' + esc(id) + '">Show more choices</button>' : '';
    return { box: box, select: selHtml, more: moreBtn, html: box + selHtml + moreBtn, drawn: drawn, total: items.length };
  }
  /* An element id's part for a key made from content (a line of text, a path): _, then the key with each character but a
     letter or digit written as _ and its 4 hex digits, as PF.followups.formId does. Two keys give one id part only when they
     are the same key, so a list can page, keep and focus its rows by it (code review round 19: a hash of the key, 32 bits
     however long it was written, let two changes share a key and one go missing). It has no -, so an id ending in -t or -go
     is never another key's, and its leading _ keeps it from any fixed id (todo-h). It's valid in a #selector as it is. */
  function domKey(k) { return '_' + String(k).replace(/[^A-Za-z0-9]/g, function (c) { return '_' + ('000' + c.charCodeAt(0).toString(16)).slice(-4); }); }
  /* Keys for items from what they are (sig(item)), never their place: the second item with the same content is sig#2, told
     apart from a literal "sig#2" (U.nthKey). */
  function uniqKeys(items, sig) {
    var seen = Object.create(null);
    return items.map(function (it) { var s = String(sig(it)); seen[s] = (seen[s] || 0) + 1; return U.nthKey(s, seen[s]); });
  }
  /* A selector for the element with this id, whatever the id holds (it comes from files). */
  /* A CSS string's contents: quotes and backslashes escaped, and control characters (a newline in an id from a file) as hex
     escapes, so the selector stays valid. */
  function cssStr(v) { return String(v).replace(/[\0-\x1f\x7f"\\]/g, function (c) { return c === '"' || c === '\\' ? '\\' + c : c === '\0' ? '\ufffd' : '\\' + c.charCodeAt(0).toString(16) + ' '; }); }
  function byId(id) { return '[id="' + cssStr(id) + '"]'; }
  /* A selector for the control that does act on this id (a row that is one button). */
  function byAct(act, id) { return '[data-act="' + cssStr(act) + '"][data-id="' + cssStr(id) + '"]'; }
  /* A must-do step on a row: a small red mark, named for screen readers and on hover; the step's own pane says it in words. */
  function mustMark() { return '<span class="mustmark" role="img" aria-label="Must do" title="Must do">!</span>'; }
  /* How a phase is worked, in words (the file keeps READ-DO and DO-CONFIRM). */
  var MODE_WORD = { 'READ-DO': 'Read, then do', 'DO-CONFIRM': 'Do, then confirm' };
  function modeWord(m) { return MODE_WORD[m] || m; }
  /* ^detail in rendered text (code or plain) shown as the detail's name, without the caret. html is already escaped. */
  function detailWords(html) {
    return String(html).replace(/<code>\^([\w-]+)<\/code>/g, '<b class="dname">$1</b>').split(/(<[^>]*>)/).map(function (part, i) {
      return i % 2 ? part : part.replace(/\^([A-Za-z][\w-]*)/g, '<b class="dname">$1</b>');
    }).join('');
  }
  /* A phase's or step's conditions (2.1) in words: "Only when risk is high and ...", or '' without any. */
  function whenWords(x) { return x && x.when && x.when.length ? detailWords(esc('Only when ' + x.when.map(function (w) { return w.text; }).join(' and '))) : ''; }
  /* An outcome as it reads on screen: US spelling for Cancelled, which run files keep as written. */
  /* A gate's state in words (2.3.1): the receipt and the run read the same. */
  var GATE_WORD = { passed: 'Passed', waived: 'Waived', failed: 'Failed', review: 'Needs review', ready: 'Ready', open: 'Waiting on steps', locked: 'Locked', skipped: 'Not needed' };
  function gateWord(st) { return GATE_WORD[st] || st; }
  function outcomeWord(o) { return o === 'Cancelled' ? 'Canceled' : o; }
  function hlText(r, hl) { return r && r.ended ? 'Ended: ' + outcomeWord(r.ended.outcome) : hl.text; }
  /* A test run (2.1) says so wherever it's listed or opened, and its version is the stage's proposed number, never a version's. */
  function testTag(r) { return PF.run.isTest(r) ? '<span class="badge b-test">Test run</span>' : ''; }
  function verWord(r) { return PF.run.isTest(r) ? 'Test run · staged v' + r.version : 'v' + r.version; }
  function tagChips(tags) { return (tags || []).length ? '<span class="tags">' + tags.map(function (t) { return '<span class="tag">#' + esc(t) + '</span>'; }).join('') + '</span>' : ''; }
  /* A typed value's box (2.0): only a value with a kind gets one; a text value keeps its plain box, so a checklist without typed
     values looks exactly as before. Yes/no, and a choice of up to five, are radios in a fieldset whose legend is the label (its
     id is the field's, so a form reads the checked one); more choices a select; a number a text box for decimals; a date the
     browser's date box. attrs is trusted markup the caller built (already escaped). */
  function typedField(id, label, def, value, attrs, cls) {
    var Vv = PF.values, k = Vv.kindOf(def), v = typeof value === 'string' ? value : '', a = attrs ? ' ' + attrs : '', c = cls || 'field';
    function radios(opts, shown) {
      return '<fieldset class="' + c + ' typed" id="' + esc(id) + '"' + a + '><legend>' + esc(label) + '</legend><span class="row">' + opts.map(function (o, i) {
        return '<label class="radio"><input type="radio" id="opt-' + esc(id) + '-' + i + '" name="' + esc(id) + '" value="' + esc(o) + '"' + (o === v ? ' checked' : '') + '> ' + esc(shown[i]) + '</label>';
      }).join('') + '</span></fieldset>';
    }
    /* A stored value that isn't one of its kind can't be shown in that kind's box: it's shown as written, in a plain box, so
       it stays until the person changes it (saving checks it again). */
    if (v && k !== 'text' && !Vv.valid(def, v)) return '<label class="' + c + '" for="' + esc(id) + '">' + esc(label) + '<input id="' + esc(id) + '" maxlength="300" value="' + esc(v) + '"' + a + '></label>';
    if (k === 'yes-no') return radios(['yes', 'no'], ['Yes', 'No']);
    if (k === 'choice' && (def.options || []).length <= 5) return radios(def.options, def.options);
    var lab = '<label class="' + c + '" for="' + esc(id) + '">' + esc(label);
    if (k === 'choice') return lab + '<select id="' + esc(id) + '"' + a + '><option value="">Choose…</option>' + def.options.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></label>';
    if (k === 'date') return lab + '<input type="date" id="' + esc(id) + '" min="0001-01-01" max="9999-12-31" value="' + esc(Vv.isDate(v) ? v : '') + '"' + a + '></label>';
    if (k === 'number') return lab + (def.unit ? ' <span class="small">(' + esc(def.unit) + ')</span>' : '') + '<input id="' + esc(id) + '" inputmode="decimal" maxlength="30" value="' + esc(v) + '"' + a + '></label>';
    if (k === 'url') return lab + ' <span class="small">Starts with https://</span><input type="url" id="' + esc(id) + '" maxlength="120" placeholder="https://" value="' + esc(v) + '"' + a + '></label>';
    return lab + '<input id="' + esc(id) + '" maxlength="120" value="' + esc(v) + '"' + a + '></label>';
  }
  /* A typed value as people read it, with the stored text in brackets where they differ; text as it is. */
  /* A run's details as step text shows them (2.3.1): the value as its kind reads, '' when not set; no run, no values. */
  function refValue(r, map) {
    if (!r || !r.details) return function () { return ''; };
    return function (k) {
      var v = Object.prototype.hasOwnProperty.call(r.details, k) ? r.details[k] : '';
      if (v == null || String(v).trim() === '') return '';
      var d = r.format === PF.run.FORMAT3 && map ? PF.run.typedDef(r, map, 'details.' + k) : null;
      return d ? valueText(d, v) : String(v);
    };
  }
  /* Step text as HTML with its run details in place (2.3.1): the step's escaped Markdown, then, in text only (never in a
     tag or an attribute), each reference as its escaped value or a quiet ‹name›. links: false drops links, for buttons. */
  function stepHtml(step, valueOf, links) {
    var m = PF.map.marked(step), h = U.mdInline(m.src);
    if (links === false) h = h.replace(/<a\b[^>]*>|<\/a>/g, '');
    if (!m.names.length) return h;
    return h.split(/(<[^>]*>)/).map(function (part, i) {
      return i % 2 ? part.replace(PF.map.MARK, '') : part.replace(PF.map.MARK, function (c) {
        var k = m.names[c.charCodeAt(0) - 0xE000], v = valueOf ? valueOf(k) : '';
        return v ? esc(v) : '<span class="ref-empty">\u2039' + esc(k) + '\u203a</span>';
      });
    }).join('');
  }
  /* The same, as plain text: accessible names, announcements and copied text. */
  function stepPlain(step, valueOf) { return PF.map.shownText(step, valueOf); }
  /* The run's headline and Next up as screens show them: a blocked step's text with its details in place. */
  function shownOpt(r, map) { var rv = refValue(r, map); return { shown: function (st) { return stepPlain(st, rv); } }; }
  function headline(r, map) { return PF.run.headline(r, map, shownOpt(r, map)); }
  /* What became of a planned start's run (2.3.1): said only as surely as it's known. */
  /* Where the progress fill starts when the share answered changes: what is shown now as a scale of the new width, so a
     second change mid-motion continues from where the bar visibly is. null: no motion (nothing shown yet, empty, or the same). */
  function fillFrom(shown, next) {
    if (shown == null || !(next > 0) || Math.abs(shown - next) <= 0.005) return null;
    return Math.round(shown / next * 1e4) / 1e4;
  }
  function unsavedWords(ps) { return ps && ps.saved ? 'its run was saved and has changed since' : ps && ps.certain === false ? 'Flightdeck couldn\'t confirm whether its run saved' : 'its run didn\'t save'; }
  function valueText(def, v) { return !def ? String(v == null ? '' : v) : PF.values.kindOf(def) === 'yes-no' ? PF.values.show(def, v) : PF.values.both(def, v); }
  return { fillFrom: fillFrom, unsavedWords: unsavedWords, refValue: refValue, stepHtml: stepHtml, stepPlain: stepPlain, shownOpt: shownOpt, headline: headline, gateWord: gateWord, typedField: typedField, valueText: valueText, keepers: keepers, keeps: keeps, person: person, nameOf: nameOf, avatar: avatar, notices: notices, tabOnly: tabOnly, ago: ago, runKey: runKey, freshness: freshness, tree: tree, treeList: treeList, findQ: findQ, findOn: findOn, finds: finds, findBox: findBox, roleRows: roleRows, byAct: byAct, tagBar: tagBar, tagButtons: tagButtons, tagChips: tagChips, mustMark: mustMark, modeWord: modeWord, MODE_WORD: MODE_WORD, detailWords: detailWords, whenWords: whenWords, outcomeWord: outcomeWord, hlText: hlText, paged: paged, list: list, joined: joined, capJoin: capJoin, atRoles: atRoles, select: select, SEL_MORE: SEL_MORE, isSelMore: isSelMore, byId: byId, cssStr: cssStr, PAGE: PAGE, PAGE_OFF: null, ARRIVE: null, TRACE: null, focusAt: null, domKey: domKey, uniqKeys: uniqKeys, testTag: testTag, verWord: verWord };
})();
(function () {
  'use strict';
  var THEMES = { system: { label: 'Match this computer', icon: 'contrast', next: 'light' }, light: { label: 'Light', icon: 'sun', next: 'dark' }, dark: { label: 'Dark', icon: 'moon', next: 'system' } };
  var K = PF.vk, V = PF.views, U = PF.util, R = PF.run, M = PF.map, T = PF.types, I = PF.icons.icon, esc = U.esc;
  var person = K.person, nameOf = K.nameOf, avatar = K.avatar, notices = K.notices, ago = K.ago, runKey = K.runKey, freshness = K.freshness;
  /* ---------- top bar ---------- */
  /* The sections, always in the top bar. Every screen belongs to one, so where you are is always lit. */
  /* Skills and Step types belong to Processes: its page links to them, and so do Settings and search. */
  var NAV = [['home', 'Home'], ['runs', 'Runs'], ['processes', 'Checklists'], ['settings', 'Settings']];
  var SECTION = { setup: 'home', health: 'settings', connection: 'settings', recovery: 'settings', home: 'home', runs: 'runs', followups: 'runs', run: 'runs', receipt: 'runs', mission: 'runs', finish: 'runs', processes: 'processes', process: 'processes', start: 'processes', 'new-process': 'processes', skills: 'processes', skill: 'processes', types: 'processes', settings: 'settings' };
  function sectionOf(view) { return SECTION[view] || 'home'; }
  function top(ctx) {
    var st = ctx.state, fs = st.fs, cur = sectionOf(st.view), rel = ctx.releases;
    /* The first-run welcome has its own three choices: only the name and What's new above them. */
    if (ctx.welcome && ctx.welcome()) return '<span class="brand"><span class="brand-mark" aria-hidden="true"></span>Flightdeck</span>' + whatsNew(rel);
    var h = '<button class="brand" data-act="nav" data-id="home" aria-label="Flightdeck home"><span class="brand-mark" aria-hidden="true"></span>Flightdeck</button>';
    h += '<nav class="mainnav" aria-label="Sections">' + NAV.map(function (n) { return '<button data-act="nav" data-id="' + n[0] + '"' + (cur === n[0] ? ' aria-current="page"' : '') + '>' + n[1] + '</button>'; }).join('') + '</nav>';
    /* Search is one button and one shortcut everywhere: Ctrl+K (Cmd+K on a Mac). */
    if (fs) h += '<button class="mini sx-btn" data-act="search" aria-keyshortcuts="' + (ctx.mac ? 'Meta+K' : 'Control+K') + '" aria-label="Search the team folder (' + (ctx.mac ? 'Cmd+K' : 'Ctrl+K') + ')">' + I('search') + '<span class="sx-lbl">Search</span><kbd>' + (ctx.mac ? '⌘K' : 'Ctrl K') + '</kbd></button>';
    h += '<div class="folder">';
    if (fs && fs.kind === 'folder') h += '<span class="dotlive' + (st.folderErr ? ' off' : '') + '" aria-hidden="true"></span><span title="Team folder ' + esc(fs.name) + '"><b>' + esc(fs.name) + '</b> · ' + (st.folderErr ? 'can\'t read it' : U.hm(st.runReadAt && st.runReadAt > ctx.data.readAt ? st.runReadAt : ctx.data.readAt)) + '</span><button class="mini" data-act="refresh" aria-label="Refresh the team folder">Refresh</button>' + (st.folderErr ? '<button class="mini" data-act="recovery" data-id="onedrive-isnt-syncing">What to do</button>' : '');
    else if (st.needsReconnect) h += '<span class="dotlive off" aria-hidden="true"></span><span>The team folder needs your OK again</span><button class="mini" data-act="reconnect">Reconnect "' + esc(st.needsReconnect.dir.name) + '"</button><button class="mini" data-act="recovery" data-id="flightdeck-lost-access-to-the-folder">What to do</button>';
    else h += '<span class="dotlive off" aria-hidden="true"></span><span>Examples</span>';
    h += '</div>';
    if (rel.newer) h += '<span class="pill newer" title="Open flightdeck.html from the team folder to use it">Flightdeck ' + esc(rel.newer) + ' is in the team folder</span>';
    h += whatsNew(rel);
    /* Appearance: follow the computer, or always light or dark. One button steps through the three. */
    var th = THEMES[st.theme] ? st.theme : 'system';
    h += '<button class="mini icon-btn" data-act="theme" data-id="' + THEMES[th].next + '" aria-label="Appearance: ' + THEMES[th].label + '. Switch to ' + THEMES[THEMES[th].next].label + '" title="Appearance: ' + THEMES[th].label + '">' + I(THEMES[th].icon) + '</button>';
    h += '<label class="me" for="me">You are ';
    var people = PF.people.sorted(ctx).filter(function (p) { return !p.inactive; });
    var nmMe = PF.people.labeler(ctx.data.people);
    if (people.length) h += '<select id="me"><option value="">Choose…</option>' + people.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === st.me ? ' selected' : '') + '>' + esc(nmMe(p)) + '</option>'; }).join('') + '</select>';
    else h += '<input id="me" value="' + esc(st.me) + '" placeholder="Your name" maxlength="40">';
    h += '</label>';
    /* On a run, which run it is stays in view while scrolling: its name, process and version, where it is and how far. */
    var r = (st.view === 'run' || st.view === 'mission') && ctx.run && ctx.run();
    if (r) {
      var map = PF.run.mapOf(r), hl = K.headline(r, map), tot = PF.run.totals(r, map);
      h += '<div class="runstrip" role="region" aria-label="This run"><span class="rs-dot ' + esc(hl.s) + '" aria-hidden="true"></span><b class="rs-title">' + esc(r.title) + '</b>' +
        '<span class="rs-sub">' + esc(map.meta.title) + ' · v' + esc(r.version) + '</span><span class="rs-now">' + esc(K.hlText(r, hl)) + '</span><span class="rs-count">' + tot.done + '/' + tot.total + '</span></div>';
    }
    return h;
  }

  function whatsNew(rel) {
    return rel.version === 'dev'
      ? '<button class="mini wn" disabled title="This is the unbuilt source. Open dist/flightdeck.html to read the release history.">What\'s new · source</button>'
      : '<button class="mini wn" data-act="whats-new" aria-label="' + (rel.fresh ? 'What\'s new: Flightdeck ' + esc(rel.version) + ', not seen yet' : 'What\'s new in Flightdeck ' + esc(rel.version)) + '">What\'s new<span class="ver"> · v' + esc(rel.version) + '</span>' + (rel.fresh ? '<span class="wn-dot" aria-hidden="true"></span>' : '') + '</button>';
  }

  /* ---------- Undo, Redo and History: the same three controls on every editor ---------- */
  /* scope names the editor ('draft', 'type'); tl is its session timeline (PF.timeline). A control with nothing to do stays
     focusable and says why, so a keyboard or screen reader user hears the reason instead of finding a dead button. */
  var WHAT = { draft: 'draft', type: 'step type' };
  function undoBar(scope, tl, opts) {
    var TL = PF.timeline, k = TL.peek(tl), id = esc(scope), h = '';
    var off = function (act, label, why, keys) { return '<button type="button" class="mini" data-act="' + act + '" data-id="' + id + '" aria-disabled="true" aria-keyshortcuts="' + keys + '" aria-describedby="' + act + '-why-' + id + '">' + label + '</button><span class="sr" id="' + act + '-why-' + id + '">' + why + '</span>'; };
    h += k.undo ? '<button type="button" class="mini" data-act="tl-undo" data-id="' + id + '" aria-keyshortcuts="Control+Z Meta+Z" aria-label="Undo ' + esc(TL.describe(k.undo)) + '">' + I('undo') + '<span>Undo<span class="tl-what"> ' + esc(k.undo.label) + '</span></span></button>'
      : off('tl-undo', I('undo') + 'Undo', k.locked ? 'Earlier changes can\'t be undone: the ' + WHAT[scope] + ' was replaced since. History shows where.' : 'Nothing to undo yet.', 'Control+Z Meta+Z');
    h += k.redo ? '<button type="button" class="mini" data-act="tl-redo" data-id="' + id + '" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" aria-label="Redo ' + esc(TL.describe(k.redo)) + '">' + I('redo') + 'Redo</button>'
      : off('tl-redo', I('redo') + 'Redo', 'Nothing to redo.', 'Control+Shift+Z Meta+Shift+Z Control+Y');
    if (!(opts && opts.noHistory)) h += '<button type="button" class="mini" data-act="hist-open" data-id="' + id + '" aria-haspopup="dialog">' + I('clock') + 'History</button>';
    return '<div class="undobar" role="toolbar" aria-label="Undo and history">' + h + '</div>';
  }

  /* Editor sidebars people can resize. Each has its own width, kept per browser (state.panes); app.js fits each to the window
     (state.paneFit: the width the layout gives it, and the widest it can be while the main pane keeps MAIN_MIN). end: the
     sidebar is right of its separator, so moving the separator left widens it. def stands in until the layout is measured. */
  var PANES = {
    tf: { label: 'Resize preview', controls: 'tf-preview', end: true, min: 280, max: 720, def: 400 },
    parts: { label: 'Resize parts', controls: 'ob-parts', end: false, min: 160, max: 400, def: 208 },
    ins: { label: 'Resize inspector', controls: 'fpe-ins', end: true, min: 300, max: 720, def: 400 }
  };
  function paneW(ctx, key) {
    var spec = PANES[key], fit = (ctx.state.paneFit || {})[key] || {}, pref = (ctx.state.panes || {})[key];
    var max = Math.max(spec.min, Math.min(spec.max, typeof fit.max === 'number' ? fit.max : spec.max));
    var set = typeof pref === 'number' && isFinite(pref);
    var w = set ? pref : typeof fit.w === 'number' ? fit.w : spec.def;
    return { w: Math.round(Math.max(spec.min, Math.min(max, w))), min: spec.min, max: max, set: set };
  }
  /* The panes' style attribute: app.js writes the same string while dragging, so a redraw finds nothing to change. */
  function paneStyle(ctx, keys) {
    return keys.filter(function (k) { return paneW(ctx, k).set; }).map(function (k) { return '--pane-' + k + ':' + paneW(ctx, k).w + 'px'; }).join(';');
  }
  /* All the sidebars of one panes container, fitted together to its width W in one pass. items, in markup order: { key, pref
     (the width chosen, or none), measured (its width now), fixed (shown but not resizable here: Parts as a rail) }. A chosen
     width is read from the choice, never from what was drawn, and a sidebar left at the layout's width keeps it, so fitting
     what was drawn gives the same answer (no back and forth). Chosen widths give way in SHRINK order (the inspector first)
     until the main pane has MAIN_MIN. Returns { key: { w, max } } for the resizable ones. */
  var MAIN_MIN = 360, SHRINK = ['ins', 'tf', 'parts'];
  function fitPanes(W, items) {
    var w = {}, chosen = {}, total = 0, room = W - MAIN_MIN, out = {};
    items.forEach(function (it) {
      var spec = PANES[it.key];
      chosen[it.key] = !it.fixed && typeof it.pref === 'number' && isFinite(it.pref);
      w[it.key] = Math.round(chosen[it.key] ? Math.max(spec.min, Math.min(spec.max, it.pref)) : it.measured || 0);
      total += w[it.key];
    });
    var excess = total - room;
    SHRINK.forEach(function (k) {
      if (excess <= 0 || !chosen[k]) return;
      var cut = Math.min(excess, w[k] - PANES[k].min); w[k] -= cut; excess -= cut; total -= cut;
    });
    items.forEach(function (it) {
      if (it.fixed) return;
      var spec = PANES[it.key];
      out[it.key] = { w: w[it.key], max: Math.max(spec.min, Math.min(spec.max, room - (total - w[it.key]))) };
    });
    return out;
  }
  function paneAttr(ctx, keys) { var s = paneStyle(ctx, keys); return s ? ' style="' + s + '"' : ''; }
  function splitter(ctx, key) {
    var spec = PANES[key], w = paneW(ctx, key);
    return '<div class="pane-split" role="separator" aria-orientation="vertical" aria-label="' + spec.label + '" aria-controls="' + spec.controls + '" aria-valuenow="' + w.w + '" aria-valuemin="' + w.min + '" aria-valuemax="' + w.max + '" tabindex="0" data-split="' + key + '" data-act="pane-split" data-id="' + key + '" title="Drag to resize. Arrow keys move it; Enter or a double-click puts it back."></div>';
  }

  V.undoBar = undoBar;
  V.tabOnly = PF.vk.tabOnly; V.PANES = PANES; V.MAIN_MIN = MAIN_MIN; V.fitPanes = fitPanes; V.paneW = paneW; V.paneStyle = paneStyle; V.paneAttr = paneAttr; V.splitter = splitter;
  V.top = top; V.nameOf = nameOf; V.freshness = freshness; V.THEMES = THEMES; V.sectionOf = sectionOf;
})();
