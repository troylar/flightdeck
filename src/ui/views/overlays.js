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
      '<dt>J / K</dt><dd>Next or previous step</dd><dt>Space</dt><dd>Mark the step done (recorder)</dd><dt>B</dt><dd>Blocked</dd><dt>N</dt><dd>Write a note</dd><dt>M</dt><dd>Screen share mode</dd><dt>Esc</dt><dd>Close or cancel</dd><dt>?</dt><dd>This help</dd></dl>' +
      '<button class="btn" data-act="close-overlay">Close</button></div></div>';
  }
  function lightbox(ctx, list, i) {
    var it = list[i];
    return '<div class="overlay" data-act="close-overlay" role="dialog" aria-modal="true" aria-label="Screenshot"><div class="lb-box"><div class="lb-bar"><span class="cap">' + esc(it.caption) + '</span><span class="small" style="color:#cfd6db">' + (i + 1) + ' of ' + list.length + '</span>' +
      (list.length > 1 ? '<button data-act="lb-step" data-id="-1" aria-label="Previous">‹ Prev</button><button data-act="lb-step" data-id="1" aria-label="Next">Next ›</button>' : '') + '<button data-act="close-overlay" id="lb-close">Close</button></div><div class="lb-media">' + ctx.img(it.src, it.caption, true) + '</div></div></div>';
  }

  V.releases = releases; V.semverCmp = semverCmp; V.help = help; V.lightbox = lightbox;
})();
