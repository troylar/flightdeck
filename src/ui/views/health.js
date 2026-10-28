/* Team confidence: Folder health, the connection check, and "When something goes wrong" (docs/recovery.md in the app). */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, H = PF.health, CN = PF.connection, I = PF.icons.icon, esc = U.esc;
  var notices = K.notices, nameOf = K.nameOf;
  var SEV = { stop: 'Needs action', warn: 'Worth a look', info: 'For your information' };

  function back(label) { return '<button type="button" class="mini" data-act="nav" data-id="settings">' + I('back') + (label || 'Settings') + '</button>'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  /* ---------- Folder health ---------- */
  function issueRow(i) {
    var paths = i.paths || [], shown = paths.slice(0, 3);
    var files = paths.length ? (paths.length <= 3 ? '<ul class="hz-paths">' + shown.map(function (p) { return '<li><code>' + esc(p) + '</code></li>'; }).join('') + '</ul>'
      : '<details class="hz-more"><summary class="small">' + plural(paths.length, 'file or folder', 'files and folders') + '</summary><ul class="hz-paths">' + paths.map(function (p) { return '<li><code>' + esc(p) + '</code></li>'; }).join('') + '</ul></details>') : '';
    var a = i.action;
    return '<li class="hz-issue ' + esc(i.severity) + '"><div class="hz-main"><span class="cat">' + esc(i.area) + '</span><b class="hz-t">' + esc(i.title) + '</b><p class="small">' + esc(i.detail) + '</p>' + files + '</div>' +
      '<button type="button" class="btn' + (i.severity === 'stop' ? ' primary' : '') + '" data-act="' + esc(a.act) + '" data-id="' + esc(a.id) + '">' + esc(a.label) + '</button></li>';
  }
  function health(ctx) {
    var st = ctx.state, hs = st.healthScan, busy = st.healthBusy, fs = st.fs;
    var rep = ctx.health ? ctx.health(true) : null, n = rep ? rep.counts : { stop: 0, warn: 0, info: 0 };
    var h = notices(ctx) + '<div class="sub-back">' + back() + '</div>';
    h += V.pageHead('Settings', 'Folder health', 'What in the team folder needs a person, and what\'s fine. Flightdeck never fixes files by itself; each problem says what you can do.',
      '<button type="button" class="btn" data-act="health-again"' + (busy ? ' disabled' : '') + '>' + I('swap') + 'Check again</button><button type="button" class="btn" data-act="health-copy"' + (rep && rep.scanned && !busy ? '' : ' disabled') + '>' + I('copy') + 'Copy details</button><span class="small" id="copy-msg" role="status"></span>', 'page-h');
    var kind = busy && !(rep && rep.scanned) ? 'busy' : n.stop ? 'stop' : n.warn ? 'warn' : 'ok';
    var head = kind === 'busy' ? 'Checking every file…' : n.stop ? plural(n.stop, 'thing needs', 'things need') + ' action' : n.warn ? plural(n.warn, 'thing is', 'things are') + ' worth a look' : 'All clear';
    var sub = kind === 'busy' ? (st.healthFound ? plural(st.healthFound, 'file') + ' found so far.' : 'Listing the folder.') + ' A big folder takes a minute.'
      : hs && hs.scan ? (!n.stop && !n.warn && n.info ? plural(n.info, 'note', 'notes') + ' below · ' : '') + 'Checked ' + esc(U.hm(hs.scan.at)) + ' · ' + plural(hs.scan.files, 'file') + ' in ' + (hs.scan.ms < 1000 ? 'under a second' : Math.round(hs.scan.ms / 1000) + ' s') + (fs ? ' · ' + esc(fs.name) : '') + (busy ? ' · checking again…' : '') : '';
    if (st.healthErr) h += '<div class="notice bad" role="alert"><span><b>The check didn\'t finish.</b> ' + esc(st.healthErr) + '</span><button class="btn" data-act="health-again">Try again</button></div>';
    h += '<section class="hz-sum ' + kind + '" aria-live="polite"><span class="hz-mark" aria-hidden="true">' + (kind === 'ok' ? I('check') : kind === 'busy' ? I('pulse') : I('flag')) + '</span><div><div class="hz-head">' + head + '</div><div class="small">' + sub + '</div></div>' +
      (rep && rep.scanned ? '<ul class="hz-counts" aria-label="Summary"><li class="stop"><b>' + n.stop + '</b> need action</li><li class="warn"><b>' + (n.warn + n.info) + '</b> worth a look</li><li class="ok"><b>' + rep.clear.length + '</b> all clear</li></ul>' : '') +
      (kind === 'busy' ? '<span class="hz-busy" aria-hidden="true"></span>' : '') + '</section>';
    if (!rep || (!rep.scanned && busy)) return h + links();
    var stop = rep.issues.filter(function (i) { return i.severity === 'stop'; }), look = rep.issues.filter(function (i) { return i.severity !== 'stop'; });
    if (stop.length) h += '<section class="panel hz-sec" aria-labelledby="hz-stop"><h2 id="hz-stop">Needs action · ' + stop.length + '</h2><ul class="hz-list">' + stop.map(issueRow).join('') + '</ul></section>';
    if (look.length) h += '<section class="panel hz-sec" aria-labelledby="hz-look"><h2 id="hz-look">Worth a look · ' + look.length + '</h2><ul class="hz-list">' + look.map(issueRow).join('') + '</ul></section>';
    h += '<details class="panel hz-sec" data-disc="hz-ok"' + ((st.disc || {})['hz-ok'] ? ' open' : '') + '><summary><h2 id="hz-ok">All clear · ' + plural(rep.clear.length, 'check') + ' passed</h2></summary><ul class="hz-clear">' + rep.clear.map(function (c) { return '<li><span class="hz-tick" aria-hidden="true">' + I('check') + '</span><span>' + esc(c.text) + '</span></li>'; }).join('') + '</ul></details>' +
      (rep.scanned ? '' : '<p class="small">Choose Check again to read every file, not just what Flightdeck already loaded.</p>');
    if (hs && hs.scan) {
      var areas = hs.scan.areas || {}, keys = Object.keys(areas).sort(function (a, b) { return areas[b].bytes - areas[a].bytes || (a < b ? -1 : 1); });
      /* Largest first, 50 at a time (2.11); the fold stays open through Show more. */
      var row = function (k) { return '<tr><th scope="row"><code id="hz-area-' + esc(k) + '" tabindex="-1">' + esc(k === '(top)' ? 'top level' : k + '/') + '</code></th><td>' + areas[k].files.toLocaleString('en-US') + '</td><td>' + esc(H.bytes(areas[k].bytes)) + '</td></tr>'; };
      h += '<details class="panel hz-sec" data-disc="hz-areas"' + ((st.disc || {})['hz-areas'] ? ' open' : '') + '><summary><h2 style="display:inline">What\'s in the folder</h2></summary>' +
        K.list(st, 'hz-areas', keys, { keyOf: function (k) { return k; }, focusOf: function (k) { return K.byId('hz-area-' + k); }, draw: function (shown) { return '<table class="hz-table"><thead><tr><th scope="col">Folder</th><th scope="col">Files</th><th scope="col">Size</th></tr></thead><tbody>' + shown.map(row).join('') + '</tbody></table>'; } }) +
        '<p class="small">Longest path: ' + hs.scan.longest + ' characters.</p></details>';
    }
    return h + links();
  }
  function links() {
    return '<section class="panel hz-sec" aria-labelledby="hz-more"><h2 id="hz-more">More ways to check</h2><div class="hz-links">' +
      '<button type="button" class="tile" data-act="connection"><b>' + I('swap') + 'Connection check</b><span class="small">Send a check to another computer and time the answer, both ways.</span></button>' +
      '<button type="button" class="tile" data-act="recovery" data-id=""><b>' + I('doc') + 'When something goes wrong</b><span class="small">Conflict copies, lost access, OneDrive not syncing, restoring a backup.</span></button></div></section>';
  }

  /* ---------- Connection check ---------- */
  function route(ans, row, who) {
    return '<ol class="cx-route" aria-label="How check ' + row.n + ' traveled"><li><span class="cx-dot" aria-hidden="true"></span><b>Sent here</b><span class="small">' + esc(CN.hms(row.at)) + '</span></li>' +
      '<li class="cx-leg" aria-hidden="true">' + (ans.oneWay != null ? esc(CN.dur(ans.oneWay)) : '?') + '</li>' +
      '<li><span class="cx-dot" aria-hidden="true"></span><b>Seen by ' + esc(who) + '</b><span class="small">' + esc(CN.hms(ans.theirSeen)) + ' their clock</span></li>' +
      '<li class="cx-leg" aria-hidden="true">' + (ans.roundTrip != null && ans.oneWay != null ? esc(CN.dur(Math.max(0, ans.roundTrip - ans.oneWay))) : '?') + '</li>' +
      '<li><span class="cx-dot done" aria-hidden="true"></span><b>Answer here</b><span class="small">' + (ans.roundTrip != null ? esc(CN.hms(row.at + ans.roundTrip)) : '') + '</span></li></ol>';
  }
  function connection(ctx) {
    var st = ctx.state, me = st.me, list = st.conn || { probes: [], acks: [] }, now = ctx.now(), dev = ctx.device ? ctx.device() : '';
    var rows = CN.results(st.connSent || [], list, st.connSeen || {}, now), title = function (k) { var r = ctx.findRun(k); return r ? r.title : k; };
    var h = notices(ctx) + '<div class="sub-back">' + back() + '</div>';
    h += V.pageHead('Settings', 'Connection check', 'Check that files travel between this computer and another one through the team folder, in both directions, and how long it takes.', '', 'page-h');
    if (st.fs && st.fs.kind !== 'folder') h += '<div class="notice warn"><span><b>You\'re looking at the examples</b>, kept in this browser only, so only another tab of this browser can answer. Open your team folder to check a real connection.</span><button class="btn" data-act="nav" data-id="settings">Open team folder</button></div>';
    h += '<div class="cx-grid"><section class="panel stack" aria-labelledby="cx-how"><h2 id="cx-how">How it works</h2><ol class="howto">' +
      '<li><b>Open this page on the other computer too.</b><span>Settings, then Connection check. While it\'s open there, it answers checks by itself.</span></li>' +
      '<li><b>Send a check from here.</b><span>It\'s a small file in <code>connection/</code>. Nothing else in the folder changes.</span></li>' +
      '<li><b>Watch the answer come back.</b><span>Each leg is timed. Then send one from the other computer, so both directions are proven.</span></li></ol></section>';
    h += '<section class="panel stack" aria-labelledby="cx-me"><h2 id="cx-me">This computer</h2><p><b>' + esc(me ? nameOf(ctx, me) : 'Nobody chosen yet') + '</b> · ' + esc(dev) + '</p>' +
      '<div class="row"><label class="field" for="cx-name" style="flex:1;min-width:180px">Name this browser (optional)<input id="cx-name" maxlength="40" value="' + esc(st.deviceName || '') + '" placeholder="e.g. Release laptop" data-enter="conn-name"></label><button type="button" class="mini" data-act="conn-name" style="align-self:flex-end">Save name</button></div>' +
      '<p class="small">Shown to whoever answers, so they can tell your computers apart. Kept in this browser only.</p></section></div>';
    if (st.connErr) h += '<div class="notice bad" role="alert"><span>' + esc(st.connErr) + '</span><button class="mini" data-act="dismiss-conn">Dismiss</button></div>';
    var skewed = [];
    rows.forEach(function (r) { r.answers.forEach(function (a) { if (a.skew) skewed.push(a); }); });
    if (skewed.length) h += '<div class="notice warn" role="status"><span><b>Clocks differ.</b> ' + esc(nameOf(ctx, skewed[0].ack.by)) + '\'s clock looks at least ' + esc(CN.dur(skewed[0].skew.ms)) + ' ' + skewed[0].skew.dir + ' yours. Times marked "their clock" come from their computer; the times measured here are on this computer\'s clock alone. Deadlines always come from the real tools.</span></div>';
    h += '<section class="panel stack" aria-labelledby="cx-sent"><h2 id="cx-sent">Checks you sent' + (rows.length ? ' · ' + rows.length : '') + '</h2>';
    if (!rows.length) h += '<p class="muted">None yet. Send one with the button at the bottom of the page.</p>';
    rows.forEach(function (r) {
      h += '<article class="cx-card' + (r.answers.length ? ' answered' : '') + '" aria-labelledby="cx-c-' + esc(r.id) + '"><div class="row between"><h3 id="cx-c-' + esc(r.id) + '" style="margin:0">Check ' + r.n + ' <span class="small">sent ' + esc(CN.hms(r.at)) + '</span></h3>' +
        (r.answers.length ? '<span class="pill passed">' + plural(r.answers.length, 'answer') + '</span>' : '<span class="pill open">Waiting · <span data-since="' + esc(new Date(r.at).toISOString()) + '">' + U.clock(r.waiting) + '</span></span>') + '</div>';
      r.answers.forEach(function (a) {
        h += '<div class="cx-ans">' + route(a, r, nameOf(ctx, a.ack.by)) + '<ul class="cx-lines">' + CN.sentences(r, a, nameOf(ctx, a.ack.by), title).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
      });
      if (r.hint) h += '<div class="cx-hint"><p><b>No answer after ' + esc(CN.dur(r.waiting)) + '.</b> Things to look at:</p><ul>' + CN.HINTS.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
      h += '</article>';
    });
    h += '</section>';
    var mine = st.connAnswered || [], theirs = (list.probes || []).filter(function (p) { return p.writer !== ctx.writer; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    h += '<section class="panel stack" aria-labelledby="cx-from"><h2 id="cx-from">Checks from other computers' + (theirs.length ? ' · ' + theirs.length : '') + '</h2>';
    if (!theirs.length) h += '<p class="muted">None in the last 15 minutes. When another computer sends one, it shows here and this page answers it.</p>';
    else h += '<ul class="cx-from">' + theirs.map(function (p) {
      var ans = mine.filter(function (x) { return x.probe === p.id; })[0], seen = ans && CN.confirmed(list, ans.file);
      return '<li><span><b>' + esc(nameOf(ctx, p.by)) + '</b> · ' + esc(p.device) + ' sent check ' + p.n + ' at ' + esc(CN.hms(Date.parse(p.at))) + ' on their clock.</span><span class="small">' +
        (ans ? 'You answered at ' + esc(CN.hms(ans.at)) + '. ' + (seen ? 'Their computer has your answer.' : 'Their next check will say whether your answer reached them.') : (me ? 'Answering…' : 'Choose who you are at the top right to answer.')) + '</span></li>';
    }).join('') + '</ul>';
    h += '</section>';
    h += '<div class="cx-spacer" aria-hidden="true"></div>';
    var can = !!me && !st.connSending;
    h += '<div class="cx-foot" role="region" aria-label="Send a check"><div class="cx-foot-in"><span class="small">' + (me ? 'This page looks for answers every 5 seconds and answers checks from other computers while it\'s open.' : 'Choose who you are at the top right first; checks say who sent them.') + '</span>' +
      '<button type="button" class="btn go" data-act="conn-send"' + (can ? '' : ' disabled') + '>' + I('swap') + (st.connSending ? 'Sending…' : rows.length ? 'Send another check' : 'Send a check') + '</button></div></div>';
    return h;
  }
  /* On any page: another computer is checking the connection. One click answers it; nothing is answered without asking,
     except on the Connection check page itself. */
  function connBanner(ctx) {
    if (!ctx.connPending || ctx.state.view === 'connection') return '';
    var p = ctx.connPending()[0];
    if (!p) return '';
    var who = nameOf(ctx, p.by);
    return '<div class="notice cx-ask" role="status"><span><b>' + esc(who) + ' is checking the connection</b> from ' + esc(p.device) + '. Answering tells them files from them reach this computer, and how fast.</span><span class="row">' +
      (ctx.state.me ? '<button type="button" class="btn go" data-act="conn-answer" data-id="' + esc(p._file) + '">Answer</button>' : '<span class="small">Choose who you are to answer.</span>') + '<button type="button" class="mini" data-act="conn-dismiss" data-id="' + esc(p._file) + '">Not now</button></span></div>';
  }

  /* ---------- When something goes wrong: docs/recovery.md, section by section, with the same anchors ---------- */
  /* Links inside the guide: another section opens here, another document is named (the app is offline), a web link stays. */
  function inline(text) {
    var links = [];
    var t = String(text).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
      var sec = /^(?:recovery\.md)?#([\w-]+)$/.exec(url), doc = /^([\w-]+\.md)(#[\w-]+)?$/.exec(url), web = U.safeUrl(url);
      links.push(sec ? '<button type="button" class="linkish" data-act="recovery" data-id="' + esc(sec[1]) + '">' + esc(label) + '</button>'
        : doc ? esc(label) + ' (<code>docs/' + esc(doc[1]) + '</code>)' : web ? '<a href="' + esc(web) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>' : esc(label));
      return '\u0001' + (links.length - 1) + '\u0001';
    });
    return U.mdInline(t).replace(/\u0001(\d+)\u0001/g, function (m, i) { return links[+i]; });
  }
  function block(md) {
    var out = [], list = null, kind = '', para = [];
    function flushP() { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } }
    function flushL() { if (list) { out.push('<' + kind + '>' + list.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</' + kind + '>'); list = null; } }
    String(md || '').split('\n').forEach(function (line) {
      var b = /^\s*[-*]\s+(.*)$/.exec(line), o = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (b || o) { flushP(); var k = b ? 'ul' : 'ol'; if (list && k !== kind) flushL(); kind = k; (list = list || []).push((b || o)[1]); }
      else if (!line.trim()) { flushP(); flushL(); }
      else if (list && /^\s{2,}\S/.test(line)) list[list.length - 1] += ' ' + line.trim();
      else { flushL(); para.push(line.trim()); }
    });
    flushP(); flushL();
    return out.join('');
  }
  function recoveryPage(ctx) {
    var st = ctx.state, doc = H.sections(ctx.recovery || ''), cur = st.recoveryAt || '';
    var backTo = st.recBack && st.recBack.label ? st.recBack.label : 'Settings';
    var h = notices(ctx) + '<div class="sub-back"><button type="button" class="mini" data-act="recovery-back" id="rv-back">' + I('back') + esc(backTo) + '</button></div>';
    h += V.pageHead('Settings', esc(doc.title || 'When something goes wrong'), '', '', 'page-h');
    if (doc.intro) h += '<div class="rv-intro">' + block(doc.intro) + '</div>';
    if (!doc.list.length) return h + '<p class="muted">This copy of Flightdeck doesn\'t include the guide. It\'s in <code>docs/recovery.md</code>.</p>';
    h += '<nav class="rv-toc" aria-label="Problems"><ul>' + doc.list.map(function (s) { return '<li><button type="button" class="chipbtn" data-act="recovery" data-id="' + esc(s.id) + '"' + (s.id === cur ? ' aria-current="true"' : '') + '>' + esc(s.title) + '</button></li>'; }).join('') + '</ul></nav>';
    h += doc.list.map(function (s) { return '<section class="panel rv-sec' + (s.id === cur ? ' on' : '') + '" id="rv-' + esc(s.id) + '" aria-labelledby="rv-h-' + esc(s.id) + '"><h2 id="rv-h-' + esc(s.id) + '" tabindex="-1">' + esc(s.title) + '</h2>' + block(s.body) + '</section>'; }).join('');
    return h;
  }

  V.health = health; V.connection = connection; V.recoveryPage = recoveryPage; V.recoveryBlock = block; K.connBanner = connBanner;
})();
