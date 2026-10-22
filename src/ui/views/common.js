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
        /* A group whose only child is a group is one heading ("Delivery / Backlog"); a count of 1 isn't drawn. */
        var kid = n.kids[seg], p = path.concat(seg), name = [seg];
        while (!kid.items.length && kid.order.length === 1) { name.push(kid.order[0]); p = p.concat(kid.order[0]); kid = kid.kids[kid.order[0]]; }
        var key = p.join(' / '), shut = openSet && Object.prototype.hasOwnProperty.call(openSet, key) && openSet[key] === false, c = count(kid);
        return '<li class="tgroup"><details' + (shut ? '' : ' open') + ' data-group="' + esc(key) + '"><summary><span class="t">' + esc(name.join(' / ')) + '</span>' + (c > 1 ? ' <span class="small">' + c + '</span>' : '') + '</summary><ul class="plist">' + draw(kid, p) + '</ul></details></li>';
      }).join('');
      return groups + n.items.map(render).join('');
    }
    return '<ul class="plist tree">' + draw(root, []) + '</ul>';
  }
  /* The tag filter: every tag in use, as toggles. A list shows only items with all chosen tags. */
  /* Folded into Filter by tag (N) unless a tag is chosen or it was opened (st.disc.tags). */
  function tagBar(all, chosen, disc) {
    if (!all.length) return '';
    var open = chosen.length || (disc || {}).tags;
    return '<details class="tagfold" data-disc="tags"' + (open ? ' open' : '') + '><summary class="small">Filter by tag (' + all.length + ')</summary>' + tagButtons(all, chosen) + '</details>';
  }
  function tagButtons(all, chosen) {
    return '<div class="tagbar" role="group" aria-label="Filter by tag">' + all.map(function (t) { var on = chosen.indexOf(t) >= 0; return '<button class="tag' + (on ? ' on' : '') + '" data-act="tag" data-id="' + esc(t) + '" aria-pressed="' + on + '">#' + esc(t) + '</button>'; }).join('') +
      (chosen.length ? '<button class="mini" data-act="tag" data-id="">Clear</button>' : '') + '</div>';
  }
  /* A long list, 50 at a time: the first n items (n grows by 50 with Show more, kept per list in state.more), how many there
     are, and the button. keyOf names an item, so focus can move to the first one Show more adds. Paging rather than
     scrolling tricks keeps Ctrl+F, screen readers and the page's patching working. */
  var PAGE = 50;
  function paged(st, id, items, draw, keyOf) {
    var n = Math.max(PAGE, Math.floor(((st.more || {})[id]) || PAGE)), shown = items.slice(0, n), left = items.length - shown.length;
    var h = draw(shown);
    if (left > 0) h += '<div class="row paged"><span class="small">Showing ' + shown.length.toLocaleString('en-US') + ' of ' + items.length.toLocaleString('en-US') + '</span>' +
      '<button class="btn" data-act="more" data-id="' + esc(id) + '" data-next="' + esc(keyOf(items[n])) + '">Show ' + Math.min(PAGE, left) + ' more</button></div>';
    return h;
  }
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
  function outcomeWord(o) { return o === 'Cancelled' ? 'Canceled' : o; }
  function hlText(r, hl) { return r && r.ended ? 'Ended: ' + outcomeWord(r.ended.outcome) : hl.text; }
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
  function valueText(def, v) { return !def ? String(v == null ? '' : v) : PF.values.kindOf(def) === 'yes-no' ? PF.values.show(def, v) : PF.values.both(def, v); }
  return { typedField: typedField, valueText: valueText, keepers: keepers, keeps: keeps, person: person, nameOf: nameOf, avatar: avatar, notices: notices, tabOnly: tabOnly, ago: ago, runKey: runKey, freshness: freshness, tree: tree, tagBar: tagBar, tagButtons: tagButtons, tagChips: tagChips, mustMark: mustMark, modeWord: modeWord, MODE_WORD: MODE_WORD, detailWords: detailWords, whenWords: whenWords, outcomeWord: outcomeWord, hlText: hlText, paged: paged, PAGE: PAGE };
})();
(function () {
  'use strict';
  var THEMES = { system: { label: 'Match this computer', icon: 'contrast', next: 'light' }, light: { label: 'Light', icon: 'sun', next: 'dark' }, dark: { label: 'Dark', icon: 'moon', next: 'system' } };
  var K = PF.vk, V = PF.views, U = PF.util, R = PF.run, M = PF.map, T = PF.types, I = PF.icons.icon, esc = U.esc;
  var person = K.person, nameOf = K.nameOf, avatar = K.avatar, notices = K.notices, ago = K.ago, runKey = K.runKey, freshness = K.freshness;
  /* ---------- top bar ---------- */
  /* The sections, always in the top bar. Every screen belongs to one, so where you are is always lit. */
  /* Skills and Step types belong to Processes: its page links to them, and so do Settings and search. */
  var NAV = [['home', 'Home'], ['runs', 'Runs'], ['processes', 'Processes'], ['settings', 'Settings']];
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
    var people = ctx.data.people.filter(function (p) { return !p.inactive; });
    if (people.length) h += '<select id="me"><option value="">Choose…</option>' + people.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === st.me ? ' selected' : '') + '>' + esc(PF.people.label(p, ctx.data.people)) + '</option>'; }).join('') + '</select>';
    else h += '<input id="me" value="' + esc(st.me) + '" placeholder="Your name" maxlength="40">';
    h += '</label>';
    /* On a run, which run it is stays in view while scrolling: its name, process and version, where it is and how far. */
    var r = (st.view === 'run' || st.view === 'mission') && ctx.run && ctx.run();
    if (r) {
      var map = PF.run.mapOf(r), hl = PF.run.headline(r, map), tot = PF.run.totals(r, map);
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
