/* Insights on a process page (How runs go), and the Runs page's filters and drill-downs (docs/design.md section 23). The
   numbers come from PF.insights; this file only draws them. Charts are inline SVG drawn to scale with the page's tokens,
   and every chart has a text or table equivalent. */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, I = PF.insights, IC = PF.icons.icon, esc = U.esc;
  var nameOf = K.nameOf;

  /* "41 min", "2 h 5 min", "3 days 4 h": typical times are approximate, so seconds would be false precision. */
  function about(ms) {
    if (ms == null) return '';
    var m = Math.round(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (m < 1) return 'under a minute';
    if (d >= 2) return d + ' days' + (h % 24 ? ' ' + (h % 24) + ' h' : '');
    return h ? h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min';
  }
  function hms(ms) { var d = new Date(ms); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }); }
  function plural(n, one, many) { return I.num(n) + ' ' + (n === 1 ? one : many || one + 's'); }

  /* What PF.insights reads, from what the app has accepted: runs, which ones couldn't be read or are gone, parts that failed,
     decisions that couldn't be read, a load still under way, and the process's corrections and follow-ups. */
  function input(ctx, pid) {
    var st = ctx.state || {}, d = ctx.data || {}, status = {};
    Object.keys((st.unread || {}).runs || {}).forEach(function (k) { status[k] = 'unread'; });
    Object.keys(st.missing || {}).forEach(function (k) { status[k] = 'missing'; });
    var mine = function (list) { return (list || []).filter(function (u) { return u.process === pid; }).length; };
    return { runs: d.runs || [], runStatus: status, failedParts: d.failed || {}, decisionsUnread: { corrections: mine(d.corrUnread), followups: mine(d.fuUnread) },
      loading: st.reading || null, corrections: V.corrGroups ? V.corrGroups(ctx, pid) : [], followUps: V.fuList ? V.fuList(ctx) : [] };
  }
  /* Worked out once per redraw when the app hands a memo (ctx.insightsMemo), else every time (the views tests). */
  function insightsOf(ctx, pid, folder, includeRunning) {
    var memo = ctx.insightsMemo, k = pid + '\n' + folder + '\n' + !!includeRunning;
    if (memo && memo[k]) return memo[k];
    var res = I.forProcess(input(ctx, pid), pid, { now: ctx.now(), folder: folder, includeRunning: !!includeRunning });
    if (memo) memo[k] = res;
    return res;
  }
  function folderList(ctx, p) { return I.folders(ctx.data.runs || [], p.id, p.all || [], p.clashes || []); }
  /* The folder picked on this process page, else the latest version if it has runs, else the newest folder with runs. */
  function chosen(ctx, p, list) {
    var want = (ctx.state.insFolder || {})[p.id], find = function (f) { return list.filter(function (x) { return x.folder === f; })[0]; };
    if (want && find(want)) return want;
    var latest = p.latest && find(p.latest.info.folder);
    if (latest && latest.runs) return latest.folder;
    var used = list.filter(function (x) { return x.runs; })[0];
    return used ? used.folder : latest ? latest.folder : list.length ? list[0].folder : null;
  }
  function verLabel(f) { return 'v' + f.version + (f.clash ? ' · Clash · ' + f.folder : ''); }
  /* A count that opens the runs behind it; a zero is plain text. */
  function link(path, text, hits) {
    if (!hits) return esc(text);
    return '<button class="linkish" data-act="ins-runs" data-id="' + esc(path) + '">' + esc(text) + '</button>';
  }
  /* The one way a number says what it left out ("Not counted: 1 run, a time is later than now, by the recorder's clock"),
     from its qualifications (PF.insights q). How runs go, Compare versions and the flight plan all use it. hide: reasons
     the place already says another way ('incomplete' for a row with its own history-incomplete link). */
  function qualLine(q, hide, tag) {
    var t = I.notCounted(q, hide);
    return t ? '<' + (tag || 'p') + ' class="small ins-q">' + esc(t) + '</' + (tag || 'p') + '>' : '';
  }

  /* ---------- How runs go ---------- */
  function page(ctx, p) {
    var list = folderList(ctx, p);
    if (!list.length) return '';
    var folder = chosen(ctx, p, list), f = list.filter(function (x) { return x.folder === folder; })[0];
    var res = insightsOf(ctx, p.id, folder, false);
    return summary(ctx, p, res, list, f) + timePanel(ctx, res) + hotSpots(ctx, res) + followUps(ctx, res) + roles(ctx, res) + counted() + compare(ctx, p, list);
  }
  function summary(ctx, p, res, list, f) {
    var h = '<section class="panel ins" aria-labelledby="ins-h"><div class="row between ins-head"><h2 id="ins-h" tabindex="-1">' + IC('chart') + 'How runs go</h2>';
    h += list.length > 1 ? '<span class="ins-pick"><label for="ins-folder">Version</label><select id="ins-folder" data-bound data-nav-safe>' + list.map(function (x) {
      return '<option value="' + esc(x.folder) + '"' + (x.folder === f.folder ? ' selected' : '') + '>' + esc(verLabel(x)) + ' · ' + plural(x.runs, 'run') + '</option>';
    }).join('') + '</select></span>' : '<span class="small">' + esc(verLabel(f)) + '</span>';
    h += '</div>';
    if (f.clash) h += '<div class="notice warn"><span>Two folders are numbered v' + f.version + '. Each is counted on its own; this is <code>' + esc(f.folder) + '</code>.</span></div>';
    var notes = res.notes.map(function (t) { return '<div class="notice warn" role="status"><span>' + esc(t) + '</span></div>'; }).join('');
    h += notes;
    var r = res.runs, outs = Object.keys(r.outcomes);
    h += '<ul class="ins-sum">' +
      '<li><span class="big">' + link('runs:all', I.num(r.n), r.n) + '</span><span class="small">' + (r.n === 1 ? 'run' : 'runs') + ' of v' + f.version + '</span></li>' +
      outs.map(function (o) { return '<li><span class="big">' + link('runs:o:' + o, I.num(r.outcomes[o].length), 1) + '</span><span class="small">' + esc(o.toLowerCase()) + '</span></li>'; }).join('') +
      (r.running ? '<li><span class="big">' + link('runs:running', I.num(r.running), 1) + '</span><span class="small">still going</span></li>' : '') + '</ul>';
    h += '<p class="small">As of ' + esc(hms(res.now)) + '. Every number counts runs of this version only, says how many runs it\'s out of, and opens the runs behind it.' + (res.pool.note ? ' ' + esc(res.pool.note) : '') + '</p>';
    /* A run never read has no copy to show: Folder health lists its file. */
    if (res.excluded.length) h += '<ul class="small ins-ex">' + res.excluded.map(function (e) { return '<li>' + esc(e.text) + ' ' + (e.why === 'unknown' ? '<button class="linkish" data-act="health">Folder health</button>' : link('ex:' + e.why, e.keys.length === 1 ? 'Show it' : 'Show them', 1)) + '</li>'; }).join('') + '</ul>';
    if (res.history.incomplete.length) h += '<p class="small">' + esc(plural(res.history.incomplete.length, 'run')) + ' started before Flightdeck kept a full record of what went off-script, so the "ever" numbers count ' + (res.history.incomplete.length === 1 ? 'it' : 'them') + ' apart as history incomplete, never as clean.</p>';
    if (res.pool.n && !I.rated(res.pool.n)) h += '<p class="small">' + esc(I.FEW) + ' Under 5 runs, only counts are shown.</p>';
    return h + '</section>';
  }

  /* Completed runs as dots on one line, to scale from zero to the longest, with the median marked. Each dot opens its run
     with the mouse; the dots stay out of the tab order, since the table under it is the keyboard path. At most DOTS are
     drawn, the latest to end, so a big folder doesn't put thousands of links on the page; the table has every run. */
  var DOTS = 300;
  function dotStrip(ctx, all, median) {
    var values = all.length > DOTS ? all.slice().sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; }).slice(0, DOTS) : all;
    var W = 600, R0 = 6, pad = 10, max = Math.max.apply(null, all.map(function (v) { return v.ms; }).concat([1]));
    var x = function (ms) { return pad + (W - 2 * pad) * ms / max; }, rows = [], dots = '';
    values.slice().sort(function (a, b) { return a.ms - b.ms; }).forEach(function (v) {
      var cx = x(v.ms), row = 0;
      while (row < 2 && rows[row] != null && cx - rows[row] < 2 * R0 + 1) row++;
      rows[row] = cx;
      var r = ctx.findRun ? ctx.findRun(v.key) : null, name = (r ? r.title : v.key) + ', ' + about(v.ms);
      dots += '<a href="#" class="ins-dot-a" tabindex="-1" data-act="go" data-view="run" data-run="' + esc(v.key) + '" aria-label="' + esc(name) + '"><title>' + esc(name) + '</title><circle class="ins-dot" cx="' + cx.toFixed(1) + '" cy="' + (38 - row * 13) + '" r="' + R0 + '"/></a>';
    });
    var mx = x(median);
    return '<div class="ins-chart"><svg class="ins-strip" viewBox="0 0 ' + W + ' 48" role="group" aria-label="Completed runs by active time, from 0 to ' + esc(about(max)) + '">' +
      '<line class="ins-axis" x1="' + pad + '" x2="' + (W - pad) + '" y1="46" y2="46"/>' +
      '<line class="ins-mid" x1="' + mx.toFixed(1) + '" x2="' + mx.toFixed(1) + '" y1="2" y2="46"><title>Median ' + esc(about(median)) + '</title></line>' + dots + '</svg>' +
      '<div class="ins-ticks small" aria-hidden="true"><span>0</span><span>' + esc(about(max)) + '</span></div>' +
      (all.length > DOTS ? '<p class="small">The latest ' + DOTS + ' of ' + I.num(all.length) + ' completed runs are drawn; the table has them all.</p>' : '') + '</div>';
  }
  /* A bar against its own denominator: a track for every run, the filled part for the runs counted. Only from 5 runs. */
  function bar(hits, n) {
    if (!I.rated(n)) return '<span class="ins-nobar"></span>';
    var w = Math.max(hits ? 1 : 0, Math.round(1000 * hits / n) / 10);
    return '<svg class="ins-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="ins-track" width="100" height="8" rx="2"/><rect class="ins-fill" width="' + w + '" height="8" rx="2"/></svg>';
  }
  function timePanel(ctx, res) {
    var d = res.duration, h = '<section class="panel ins" aria-labelledby="ins-time-h"><h2 id="ins-time-h">' + IC('clock') + 'Time</h2>';
    if (!d.n) h += '<p class="small">No completed runs with times that can be read yet.</p>';
    else {
      h += '<p>Typical completed run: <b>' + esc(about(d.median)) + '</b>' + (d.q1 != null ? ' · middle half ' + esc(about(d.q1)) + ' to ' + esc(about(d.q3)) : '') + ' · ' +
        link('dur', I.num(d.n) + ' of ' + plural(d.of, 'completed run'), d.n) + '. Paused time isn\'t counted.</p>';
      h += dotStrip(ctx, d.values, d.median);
      var rows = function (list) { return '<div class="grid-wrap"><table class="grid"><thead><tr><th scope="col">Run</th><th scope="col">Active time</th></tr></thead><tbody>' +
        list.map(function (v) { var r = ctx.findRun ? ctx.findRun(v.key) : null; return '<tr id="ins-row-' + esc(v.key.replace(/\//g, '-')) + '"><td><button class="linkish" data-act="go" data-view="run" data-run="' + esc(v.key) + '">' + esc(r ? r.title : v.key) + '</button></td><td>' + esc(about(v.ms)) + '</td></tr>'; }).join('') + '</tbody></table></div>'; };
      h += '<details data-disc="ins-dur-table"' + ((ctx.state.disc || {})['ins-dur-table'] ? ' open' : '') + '><summary class="small">The same as a table</summary>' +
        K.paged(ctx.state, 'ins-dur', d.values.slice().sort(function (a, b) { return a.ms - b.ms; }), rows, function (v) { return 'ins-row-' + v.key.replace(/\//g, '-'); }) + '</details>';
    }
    h += qualLine(d.q);
    if (res.phases.length) {
      var top = Math.max.apply(null, res.phases.map(function (x) { return x.median || 0; }).concat([1]));
      h += '<h3>Each phase</h3><ul class="ins-phases">' + res.phases.map(function (x) {
        var w = x.median != null ? Math.max(1, Math.round(1000 * x.median / top) / 10) : 0;
        return '<li><div class="ins-row"><span class="ins-lab">' + esc(x.title) + '</span>' +
          (x.n ? '<svg class="ins-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="ins-track" width="100" height="8" rx="2"/><rect class="ins-fill" width="' + w + '" height="8" rx="2"/></svg>' : '<span class="ins-nobar"></span>') +
          '<span class="ins-num">' + (x.n ? '<b>' + esc(about(x.median)) + '</b>' + (x.q1 != null ? ' <span class="small">(' + esc(about(x.q1)) + ' to ' + esc(about(x.q3)) + ')</span>' : '') + ' · ' : '') + link('phase:' + x.id, I.num(x.n) + ' of ' + plural(x.of, 'run'), x.n) + '</span></div>' +
          qualLine(x.q) +
          gateLine(x) + '</li>';
      }).join('') + '</ul><p class="small">Bars are typical times, to scale with the longest phase.</p>';
    }
    return h + '</section>';
  }

  /* A gate's waived and failed counts, each with what it left out; drawn when either has runs or left out a run it should
     have counted (a failure the log can't place, say), even with no runs waived or failed. */
  function gateLine(x) {
    var kinds = [['waived', 'waived'], ['failed', 'failed at least once']].filter(function (k) { var m = x.gate[k[0]]; return m.hits || I.hasProblems(m.q); });
    if (!kinds.length) return '';
    return '<p class="small">Gate "' + esc(x.gate.title) + '": ' + kinds.map(function (k) { var m = x.gate[k[0]]; return k[1] + ' in ' + link('gate:' + x.id + ':' + k[0], I.count(m.hits, m.n), m.hits) + qualLine(m.q, null, 'span'); }).join(' · ') + '</p>';
  }
  var ROWS = [['offScript', 'Any off-script'], ['blocked', 'Ever blocked'], ['redone', 'Ever redone'], ['na', 'Ever N/A'], ['differently', 'Done differently'], ['skipped', 'Skipped (N/A now)'], ['corrections', 'Corrections']];
  var STATUS_WORDS = { open: 'open', applied: 'applied', declined: 'declined', withdrawn: 'withdrawn', included: 'published', tie: 'needs review', legacy: 'accepted' };
  function hotSpots(ctx, res) {
    var h = '<section class="panel ins" aria-labelledby="ins-hot-h"><h2 id="ins-hot-h">' + IC('flag') + 'Steps that go off-script</h2>';
    if (res.corrections.note) h += '<div class="notice warn" role="status"><span>' + esc(res.corrections.note) + '</span></div>';
    var list = res.steps.filter(function (s) { return s.offScript.hits || s.offScript.incomplete || s.skipped.hits || s.corrections.hits || ROWS.some(function (r) { return I.hasProblems(s[r[0]].q); }); });
    if (!list.length) return h + '<p class="small">' + (res.pool.n ? 'No step went off-script in ' + esc(plural(res.pool.n, 'run')) + '.' : 'No finished runs of this version yet.') + '</p></section>';
    if (!res.pool.n) h += '<p class="small">Nothing has finished in this version yet; corrections on runs still going are shown.</p>';
    var order = res.steps.map(function (s) { return s.id; });
    list.sort(function (a, b) { return b.offScript.hits - a.offScript.hits || b.corrections.hits - a.corrections.hits || order.indexOf(a.id) - order.indexOf(b.id); });
    h += '<p class="small">Each bar is out of its own runs, shown from 5 runs. Choose a count to see the runs behind it. These are good places to change the checklist.</p>';
    var draw = function (shown) {
      return '<ul class="ins-steps">' + shown.map(function (s) {
        var rows = ROWS.filter(function (r) { var m = s[r[0]]; return r[0] === 'offScript' || m.hits || m.incomplete || I.hasProblems(m.q); }).map(function (r) {
          var m = s[r[0]], extra = '';
          if (r[0] === 'corrections') extra = ' <span class="small">(groups: ' + Object.keys(m.groups).map(function (k) { return m.groups[k] + ' ' + (STATUS_WORDS[k] || k); }).join(', ') + ')</span>';
          if (m.incomplete) extra += ' · ' + link('step:' + s.id + ':' + r[0] + ':incomplete', I.num(m.incomplete) + ' history incomplete', 1);
          return '<div class="ins-row"><span class="ins-lab">' + r[1] + '</span>' + bar(m.hits, m.n) + '<span class="ins-num">' + link('step:' + s.id + ':' + r[0], I.count(m.hits, m.n), m.hits) + extra + qualLine(m.q, ['incomplete'], 'span') + '</span></div>';
        }).join('');
        return '<li class="ins-step" id="ins-' + esc(s.id) + '"><h3>' + U.mdInline(s.text) + '</h3>' + rows + '</li>';
      }).join('') + '</ul>';
    };
    return h + K.paged(ctx.state, 'ins-hot', list, draw, function (s) { return 'ins-' + s.id; }) + '</section>';
  }
  function followUps(ctx, res) {
    var f = res.followUps, o = f.open, d = f.decided;
    if (!o.n && !d.n && !o.excluded.length && !d.excluded.length && !f.note) return '';
    var h = '<section class="panel ins" aria-labelledby="ins-fu-h"><h2 id="ins-fu-h">' + IC('flag') + 'Follow-ups</h2>';
    if (f.note) h += '<div class="notice warn" role="status"><span>' + esc(f.note) + '</span></div>';
    h += o.n ? '<p class="small">Open follow-ups by how long since they were added, ' + esc(o.clock) + ':</p><ul class="ins-sum">' + o.buckets.map(function (b) {
      return '<li><span class="big">' + link('fu:' + b.id, I.num(b.items.length), b.items.length) + '</span><span class="small">' + esc(b.label.toLowerCase()) + (b.items.length ? ', in ' + esc(plural(b.keys.length, 'run')) : '') + '</span></li>';
    }).join('') + '</ul>' : '<p class="small">No open follow-ups.</p>';
    h += qualLine(o.q);
    if (d.n) h += '<p>Typical time to a decision: <b>' + esc(about(d.median)) + '</b>' + (d.q1 != null ? ' · middle half ' + esc(about(d.q1)) + ' to ' + esc(about(d.q3)) : '') + ' · ' + link('fu:decided', plural(d.n, 'decided follow-up') + ' in ' + plural(d.keys.length, 'run'), d.n) + ', ' + esc(d.clock) + '.</p>';
    h += qualLine(d.q);
    return h + '</section>';
  }
  function roles(ctx, res) {
    var rot = res.roles, people = Object.keys(rot.grid);
    if (!rot.roles.length || !people.length) return '';
    return '<section class="panel ins" aria-labelledby="ins-rot-h"><h2 id="ins-rot-h">Who has done each role</h2><div class="grid-wrap"><table class="grid"><thead><tr><th scope="col">Person</th>' + rot.roles.map(function (ro) { return '<th scope="col">' + esc(ro) + '</th>'; }).join('') + '</tr></thead><tbody>' + people.sort(function (a, b) { return nameOf(ctx, a).localeCompare(nameOf(ctx, b)); }).map(function (pid) {
      return '<tr><th scope="row">' + esc(nameOf(ctx, pid)) + '</th>' + rot.roles.map(function (ro) { var c = rot.grid[pid][ro]; return c ? '<td>' + c.count + '× · last ' + esc(U.when(c.last)) + '</td>' : '<td class="cold">never</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div><p class="small">In runs of this version. "Never" is a good place to rotate someone in. Starting a run suggests whoever did a role least recently.</p></section>';
  }
  function counted() {
    return '<details class="panel ins-defs" data-disc="ins-defs"><summary><h2>How these are counted</h2></summary><dl>' + I.DEFS.map(function (d) {
      return '<dt>' + esc(d.name) + '</dt><dd>' + esc(d.counts) + '.' + (d.denominator !== '—' ? ' <span class="small">Out of: ' + esc(d.denominator) + '.</span>' : '') + '</dd>';
    }).join('') + '</dl><p class="small">Each version (publication folder) is counted on its own, even when two share a number. Runs still going aren\'t in the step and phase numbers. A run that couldn\'t be read, is gone or is from a newer Flightdeck isn\'t counted anywhere, and is listed. A rate shows from 5 runs; under 5, only counts.</p></details>';
  }
  /* Versions side by side, each with its own number of runs; never added together. */
  function compare(ctx, p, list) {
    if (list.length < 2) return '';
    var open = (ctx.state.disc || {})['ins-cmp'];
    /* Drawn closed too: opening a details element doesn't redraw the page. */
    return '<details class="panel" data-disc="ins-cmp"' + (open ? ' open' : '') + '><summary><h2>Compare versions</h2></summary><p class="small">Side by side, each out of its own runs. Versions aren\'t added together.</p><div class="grid-wrap"><table class="grid"><thead><tr><th scope="col">Version</th><th scope="col">Runs</th><th scope="col">Completed, timed</th><th scope="col">Typical completed run</th><th scope="col">Not counted</th></tr></thead><tbody>' +
      list.map(function (f) {
        var r = insightsOf(ctx, p.id, f.folder, false);
        return '<tr><th scope="row">' + esc(verLabel(f)) + '</th><td>' + I.num(r.runs.n) + '</td><td>' + I.num(r.duration.n) + '</td><td>' + (r.duration.n ? esc(about(r.duration.median)) : '—') + '</td><td>' + ((qualLine(r.runs.q, null, 'span') + qualLine(r.duration.q, null, 'span')) || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div></details>';
  }

  /* ---------- Runs: filters and the runs behind a number ---------- */
  var OUTCOMES = [['', 'Any'], ['running', 'Still going'], ['Completed', 'Completed'], ['Stopped early', 'Stopped early'], ['Cancelled', 'Cancelled']];
  function active(f) { return !!f && !f.cohort && !!(f.process || f.folder || f.outcome || f.from || f.through); }
  function filterBar(ctx) {
    var st = ctx.state, f = st.runFilter && !st.runFilter.cohort ? st.runFilter : {}, runs = ctx.data.runs || [];
    var procs = []; runs.forEach(function (r) { if (procs.indexOf(r.process) < 0) procs.push(r.process); });
    procs.sort(function (a, b) { return ctx.processTitle(a).localeCompare(ctx.processTitle(b)); });
    var opt = function (v, label, cur) { return '<option value="' + esc(v) + '"' + (v === (cur || '') ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    var vers = f.process ? I.folders(runs, f.process, [], []) : [];
    var chips = [];
    if (f.process) chips.push(['process', 'Process: ' + ctx.processTitle(f.process)]);
    if (f.folder) { var fv = vers.filter(function (x) { return x.folder === f.folder; })[0]; chips.push(['folder', 'Version: ' + (fv ? verLabel(fv) : f.folder)]); }
    if (f.outcome) chips.push(['outcome', 'Outcome: ' + OUTCOMES.filter(function (o) { return o[0] === f.outcome; })[0][1]]);
    if (f.from) chips.push(['from', 'Started from ' + f.from]);
    if (f.through) chips.push(['through', 'Started through ' + f.through]);
    var open = active(f) || (st.disc || {}).rf;
    return '<details class="panel rf" data-disc="rf"' + (open ? ' open' : '') + '><summary><h2>Filter runs</h2></summary><div class="rf-row">' +
      '<span class="rf-f"><label for="rf-process">Process</label><select id="rf-process" data-bound data-nav-safe>' + opt('', 'Any', f.process) + procs.map(function (pid) { return opt(pid, ctx.processTitle(pid), f.process); }).join('') + '</select></span>' +
      (f.process ? '<span class="rf-f"><label for="rf-folder">Version</label><select id="rf-folder" data-bound data-nav-safe>' + opt('', 'Any', f.folder) + vers.map(function (x) { return opt(x.folder, verLabel(x), f.folder); }).join('') + '</select></span>' : '') +
      '<span class="rf-f"><label for="rf-outcome">Outcome</label><select id="rf-outcome" data-bound data-nav-safe>' + OUTCOMES.map(function (o) { return opt(o[0], o[1], f.outcome); }).join('') + '</select></span>' +
      '<span class="rf-f"><label for="rf-from">Started from</label><input type="date" id="rf-from" value="' + esc(f.from || '') + '" data-bound data-nav-safe></span>' +
      '<span class="rf-f"><label for="rf-through">through</label><input type="date" id="rf-through" value="' + esc(f.through || '') + '" data-bound data-nav-safe></span></div>' +
      (chips.length ? '<div class="rf-chips" role="group" aria-label="Filters in use">' + chips.map(function (c) { return '<button class="chipbtn" data-act="rf-clear" data-id="' + c[0] + '" aria-label="Remove filter ' + esc(c[1]) + '">' + esc(c[1]) + ' <span aria-hidden="true">×</span></button>'; }).join('') +
        '<button class="mini" data-act="rf-clear" data-id="all">Clear filters</button></div>' : '') + '<p class="small">Dates are when a run started, in this computer\'s time zone, and include both days.</p></details>';
  }
  /* The Runs page while a filter or a drill-down is in use: its own list, or '' when there's none. */
  function filtered(ctx, cards) {
    var st = ctx.state, f = st.runFilter, d = ctx.data, all = d.runs || [];
    if (f && f.cohort) {
      var by = {}; all.forEach(function (r) { by[r.process + '/' + r.id] = r; });
      var shown = f.keys.filter(function (k) { return by[k]; }).map(function (k) { return by[k]; }), gone = f.keys.length - shown.length;
      var ch = I.changed(f, all, insightsOf(ctx, f.process, f.folder, f.includeRunning));
      /* Never "vnull": the version comes from the spec, else the folder's publication or runs; a clash names the folder. */
      var proc = ctx.processes ? (ctx.processes() || []).filter(function (x) { return x.id === f.process; })[0] : null;
      var fl = I.folders(all, f.process, proc ? proc.all : [], proc ? proc.clashes : []).filter(function (x) { return x.folder === f.folder; })[0];
      var vn = f.version != null ? f.version : fl && fl.version ? fl.version : null;
      var ver = vn != null ? 'v' + vn + (fl && fl.clash ? ' (folder ' + f.folder + ')' : '') : 'folder ' + f.folder;
      var h = '<div class="notice ins-banner" role="status" id="ins-banner"><span><b>The runs behind a number in How runs go:</b> ' + esc(f.label) + ' · ' + esc(ctx.processTitle(f.process)) + ' ' + esc(ver) + ' · as of ' + esc(hms(f.asOf)) + '.</span>' +
        '<span class="row"><button class="btn" data-act="ins-back">' + IC('back') + 'Back to How runs go</button><button class="mini" data-act="rf-clear" data-id="all">Show all runs</button></span></div>';
      if (ch) h += '<div class="notice warn" role="status"><span>' + esc(ch === 1 ? '1 of these runs changed since.' : ch + ' of these runs changed since.') + '</span><button class="btn" data-act="ins-refresh">Show current numbers</button></div>';
      h += '<section class="panel"><h2 id="rf-h" tabindex="-1">' + esc(plural(f.keys.length, 'run')) + '</h2>' + (gone ? '<p class="small">' + esc(gone === 1 ? '1 of them is no longer in the folder.' : gone + ' of them are no longer in the folder.') + '</p>' : '') +
        (shown.length ? K.paged(st, 'runs-cohort', shown, cards, K.runKey) : '<p class="small">None of these runs is in the folder now.</p>') + '</section>';
      return h;
    }
    if (!active(f)) return '';
    var list = I.filterRuns(all, f).sort(function (a, b) { return (b.created || '') < (a.created || '') ? -1 : 1; });
    return '<section class="panel"><h2 id="rf-h" tabindex="-1">Matching runs · ' + I.num(list.length) + '</h2>' + (list.length ? K.paged(st, 'runs-filtered', list, cards, K.runKey) : '<p class="small">No run matches these filters.' + (st.reading ? ' Some runs aren\'t read yet.' : '') + '</p>') + '</section>';
  }

  V.insightsQual = qualLine;
  V.insightsInput = input; V.insightsOf = insightsOf; V.insightsPage = page; V.insightsFolders = folderList; V.insightsChosen = chosen;
  V.runsFilterBar = filterBar; V.runsFiltered = filtered; V.about = about;
})();
