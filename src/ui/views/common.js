/* Screens are split by area (views/*.js); this file holds what they share. Each screen returns HTML; app.js wires events.
   Everything shown from files goes through esc() or the escape-first Markdown. */
PF.views = {};
PF.vk = (function () {
  'use strict';
  var U = PF.util, I = PF.icons.icon, esc = U.esc;
  /* ---------- small helpers ---------- */
  function person(ctx, id) { return ctx.peopleById[id] || null; }
  function nameOf(ctx, id) { var p = person(ctx, id); return p ? p.name : id ? String(id) : 'nobody'; }
  function avatar(ctx, id, lg) {
    var p = person(ctx, id), ini = p ? p.initials : String(id || '?').slice(0, 2).toUpperCase();
    return '<span class="avatar' + (lg ? ' lg' : '') + '" title="' + esc(nameOf(ctx, id)) + '">' + esc(ini) + '</span>';
  }
  function notices(ctx) {
    var h = '';
    /* A quiet message (a check said back, Copied) is only announced, never shown as a notice. */
    if (ctx.state.msg && !ctx.state.msg.quiet) h += '<div class="notice ' + (ctx.state.msg.kind || '') + '" role="status"><span>' + esc(ctx.state.msg.text) + '</span><span class="row">' + (ctx.state.msg.act ? '<button class="btn" data-act="' + esc(ctx.state.msg.act) + '"' + (ctx.state.msg.id ? ' data-id="' + esc(ctx.state.msg.id) + '"' : '') + '>' + esc(ctx.state.msg.label) + '</button>' : '') + '<button class="mini" data-act="dismiss">Dismiss</button></span></div>';
    var cur = /^(run|receipt|finish|mission)$/.test(ctx.state.view) && ctx.run();
    if (cur && ctx.state.unsaved[cur.id]) h += '<div class="notice bad" role="alert"><span><b>Your last change isn\'t saved.</b> ' + esc(ctx.state.saveErr[cur.id] || '') + ' It\'s on this screen but not in the team folder' + (cur.ended ? ', so the run hasn\'t really ended yet' : '') + '.</span><span class="row"><button class="btn" data-act="retry-save">Try again</button><button class="mini" data-act="discard-unsaved">Discard my change</button></span></div>';
    if (ctx.state.folderErr) h += '<div class="notice bad" role="alert"><span><b>Can\'t read the team folder.</b> ' + esc(ctx.state.folderErr) + ' You\'re seeing what was last read at ' + U.hm(ctx.data.readAt) + '. Check that OneDrive is running and the folder is available offline.</span><span class="row"><button class="btn" data-act="refresh">Try again</button><button class="mini" data-act="recovery" data-id="onedrive-isnt-syncing">What to do</button></span></div>';
    /* Part of the folder couldn't be read: what was read before for it stays on screen, and this says so. */
    var failed = Object.keys(ctx.data.failed || {});
    if (failed.length && !ctx.state.folderErr) h += '<div class="notice warn" role="status"><span><b>Part of the team folder couldn\'t be read</b> (' + esc(failed.join(', ')) + '). You\'re seeing what was read before for ' + (failed.length === 1 ? 'it' : 'them') + '.</span><span class="row"><button class="btn" data-act="refresh">Try again</button><button class="mini" data-act="health">Folder health</button></span></div>';
    if (PF.vk.connBanner) h += PF.vk.connBanner(ctx);
    if (!ctx.state.me) h += '<div class="notice warn"><span>Choose who you are at the top right. Everything you record or note is stamped with your name.</span></div>';
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
    var st = ctx.state, now = ctx.now(), parts = [];
    if (st.folderErr) return '<span class="small" style="color:var(--stop)">Can\'t read the folder right now</span>';
    if ((r && ((st.unread || {}).runs || {})[r.process + '/' + r.id]) || Object.keys(ctx.data.failed || {}).length) return '<span class="small" style="color:var(--stop)">Part of the folder couldn\'t be read · checked ' + esc(U.hm(st.runReadAt || ctx.data.readAt)) + '</span>';
    /* The run screen's strip: the same two facts, in fewer words. */
    if (short) return '<span class="small">' + esc((r && r.savedAt ? (ctx.recording && ctx.recording(r) ? 'Saved here ' : 'Last saved ') + U.hm(r.savedAt) + ' · ' : '') + 'Folder checked ' + U.hm(st.runReadAt || ctx.data.readAt)) + '</span>';
    if (r && r.savedAt) parts.push('saved here ' + U.hm(r.savedAt) + ' (' + ago(r.savedAt, now) + ')');
    parts.push('folder checked ' + U.hm(st.runReadAt || ctx.data.readAt));
    return '<span class="small">' + esc(parts.join(' · ')) + (st.fs && st.fs.kind === 'folder' ? ' · OneDrive shares it with others' : '') + '</span>';
  }

  /* A hierarchy (group paths like ["Engineering", "Releases"]) as nested, foldable lists. Items without a group go last. */
  function tree(items, pathOf, render, openSet) {
    /* Group names come from files, so nodes have no prototype: a group called "constructor" is just a group. */
    var root = { kids: Object.create(null), order: [], items: [] };
    items.forEach(function (it) {
      var node = root;
      (pathOf(it) || []).forEach(function (seg) { if (!node.kids[seg]) { node.kids[seg] = { kids: Object.create(null), order: [], items: [] }; node.order.push(seg); } node = node.kids[seg]; });
      node.items.push(it);
    });
    function count(n) { return n.items.length + n.order.reduce(function (s, k) { return s + count(n.kids[k]); }, 0); }
    function draw(n, path) {
      var groups = n.order.slice().sort().map(function (seg) {
        var p = path.concat(seg), key = p.join(' / '), shut = openSet && Object.prototype.hasOwnProperty.call(openSet, key) && openSet[key] === false;
        return '<li class="tgroup"><details' + (shut ? '' : ' open') + ' data-group="' + esc(key) + '"><summary><span class="t">' + esc(seg) + '</span> <span class="small">' + count(n.kids[seg]) + '</span></summary><ul class="plist">' + draw(n.kids[seg], p) + '</ul></details></li>';
      }).join('');
      return groups + n.items.map(render).join('');
    }
    return '<ul class="plist tree">' + draw(root, []) + '</ul>';
  }
  /* The tag filter: every tag in use, as toggles. A list shows only items with all chosen tags. */
  function tagBar(all, chosen) {
    if (!all.length) return '';
    return '<div class="tagbar" role="group" aria-label="Filter by tag">' + all.map(function (t) { var on = chosen.indexOf(t) >= 0; return '<button class="tag' + (on ? ' on' : '') + '" data-act="tag" data-id="' + esc(t) + '" aria-pressed="' + on + '">#' + esc(t) + '</button>'; }).join('') +
      (chosen.length ? '<button class="mini" data-act="tag" data-id="">Clear</button>' : '') + '</div>';
  }
  function tagChips(tags) { return (tags || []).length ? '<span class="tags">' + tags.map(function (t) { return '<span class="tag">#' + esc(t) + '</span>'; }).join('') + '</span>' : ''; }
  return { person: person, nameOf: nameOf, avatar: avatar, notices: notices, ago: ago, runKey: runKey, freshness: freshness, tree: tree, tagBar: tagBar, tagChips: tagChips };
})();
(function () {
  'use strict';
  var THEMES = { system: { label: 'Match this computer', icon: 'contrast', next: 'light' }, light: { label: 'Light', icon: 'sun', next: 'dark' }, dark: { label: 'Dark', icon: 'moon', next: 'system' } };
  var K = PF.vk, V = PF.views, U = PF.util, R = PF.run, M = PF.map, T = PF.types, I = PF.icons.icon, esc = U.esc;
  var person = K.person, nameOf = K.nameOf, avatar = K.avatar, notices = K.notices, ago = K.ago, runKey = K.runKey, freshness = K.freshness;
  /* ---------- top bar ---------- */
  /* The sections, always in the top bar. Every screen belongs to one, so where you are is always lit. */
  var NAV = [['home', 'Home'], ['runs', 'Runs'], ['processes', 'Processes'], ['skills', 'Skills'], ['types', 'Step types'], ['settings', 'Settings']];
  var SECTION = { health: 'settings', connection: 'settings', recovery: 'settings', home: 'home', runs: 'runs', run: 'runs', receipt: 'runs', mission: 'runs', finish: 'runs', processes: 'processes', process: 'processes', start: 'processes', 'new-process': 'processes', skills: 'skills', skill: 'skills', types: 'types', settings: 'settings' };
  function sectionOf(view) { return SECTION[view] || 'home'; }
  function top(ctx) {
    var st = ctx.state, fs = st.fs, cur = sectionOf(st.view), h = '<button class="brand" data-act="nav" data-id="home" aria-label="Flightdeck home"><span class="brand-mark" aria-hidden="true"></span>Flightdeck</button>';
    h += '<nav class="mainnav" aria-label="Sections">' + NAV.map(function (n) { return '<button data-act="nav" data-id="' + n[0] + '"' + (cur === n[0] ? ' aria-current="page"' : '') + '>' + n[1] + '</button>'; }).join('') + '</nav>';
    h += '<div class="folder">';
    if (fs && fs.kind === 'folder') h += '<span class="dotlive' + (st.folderErr ? ' off' : '') + '" aria-hidden="true"></span><span title="Team folder ' + esc(fs.name) + '"><b>' + esc(fs.name) + '</b> · ' + (st.folderErr ? 'can\'t read it' : U.hm(st.runReadAt && st.runReadAt > ctx.data.readAt ? st.runReadAt : ctx.data.readAt)) + '</span><button class="mini" data-act="refresh" aria-label="Refresh the team folder">Refresh</button>' + (st.folderErr ? '<button class="mini" data-act="recovery" data-id="onedrive-isnt-syncing">What to do</button>' : '');
    else if (st.needsReconnect) h += '<span class="dotlive off" aria-hidden="true"></span><span>The team folder needs your OK again</span><button class="mini" data-act="reconnect">Reconnect "' + esc(st.needsReconnect.dir.name) + '"</button><button class="mini" data-act="recovery" data-id="flightdeck-lost-access-to-the-folder">What to do</button>';
    else h += '<span class="dotlive off" aria-hidden="true"></span><span>Examples</span>';
    h += '</div>';
    var rel = ctx.releases;
    if (rel.newer) h += '<span class="pill newer" title="Open flightdeck.html from the team folder to use it">Flightdeck ' + esc(rel.newer) + ' is in the team folder</span>';
    h += rel.version === 'dev'
      ? '<button class="mini wn" disabled title="This is the unbuilt source. Open dist/flightdeck.html to read the release history.">What\'s new · source</button>'
      : '<button class="mini wn" data-act="whats-new" aria-label="' + (rel.fresh ? 'What\'s new: Flightdeck ' + esc(rel.version) + ', not seen yet' : 'What\'s new in Flightdeck ' + esc(rel.version)) + '">What\'s new<span class="ver"> · v' + esc(rel.version) + '</span>' + (rel.fresh ? '<span class="wn-dot" aria-hidden="true"></span>' : '') + '</button>';
    /* Appearance: follow the computer, or always light or dark. One button steps through the three. */
    var th = THEMES[st.theme] ? st.theme : 'system';
    h += '<button class="mini icon-btn" data-act="theme" data-id="' + THEMES[th].next + '" aria-label="Appearance: ' + THEMES[th].label + '. Switch to ' + THEMES[THEMES[th].next].label + '" title="Appearance: ' + THEMES[th].label + '">' + I(THEMES[th].icon) + '</button>';
    h += '<label class="me" for="me">You are ';
    var people = ctx.data.people.filter(function (p) { return !p.inactive; });
    if (people.length) h += '<select id="me"><option value="">Choose…</option>' + people.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === st.me ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select>';
    else h += '<input id="me" value="' + esc(st.me) + '" placeholder="Your name" maxlength="40">';
    h += '</label>';
    /* On a run, which run it is stays in view while scrolling: its name, process and version, where it is and how far. */
    var r = (st.view === 'run' || st.view === 'mission') && ctx.run && ctx.run();
    if (r) {
      var map = PF.run.mapOf(r), hl = PF.run.headline(r, map), tot = PF.run.totals(r, map);
      h += '<div class="runstrip" role="region" aria-label="This run"><span class="rs-dot ' + esc(hl.s) + '" aria-hidden="true"></span><b class="rs-title">' + esc(r.title) + '</b>' +
        '<span class="rs-sub">' + esc(map.meta.title) + ' · v' + esc(r.version) + '</span><span class="rs-now">' + esc(hl.text) + '</span><span class="rs-count">' + tot.done + '/' + tot.total + '</span></div>';
    }
    return h;
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

  V.undoBar = undoBar;
  V.top = top; V.nameOf = nameOf; V.freshness = freshness; V.THEMES = THEMES; V.sectionOf = sectionOf;
})();
