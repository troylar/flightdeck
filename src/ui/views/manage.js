/* Managing what runs are built from: a process's checklist (shown in place, an editor that checks as you type, versions to restore),
   new processes, and step types (every built-in and team type, and a form to create or change a team one). */
(function () {
  'use strict';
  var K = PF.vk, V = PF.views, U = PF.util, M = PF.map, T = PF.types, I = PF.icons.icon, esc = U.esc;
  var nameOf = K.nameOf, notices = K.notices;

  /* ---------- a process page: the checklist itself, in place ---------- */
  /* Which view the page shows: the checklist (with a version picked), the editor, or how runs go. */
  function tabOf(ctx) { var t = ctx.state.ptab; return t === 'edit' || t === 'insights' ? t : 'overview'; }
  /* The version being looked at: one picked from Versions, else the draft when it has unpublished changes (or nothing is
     published yet), else the current version. */
  function shownOf(p, st) {
    var pick = (p.all || []).filter(function (v) { return v.folder === st.mapVer; })[0];
    if (pick) return { pub: pick, md: pick.md, current: pick === p.latest };
    if (p.draft && (!p.latest || (p.draftChanged && st.mapVer !== 'current'))) return { draft: true, md: p.draft.md, current: true };
    return p.latest ? { pub: p.latest, md: p.latest.md, current: true } : null;
  }
  function checklistPanel(ctx, p) {
    var st = ctx.state, shown = shownOf(p, st), restoring = (st.draftSaving || {})[ctx.fsKey + '\n' + p.id] === 'restore';
    if (!shown) return '<section class="panel"><p class="small">This process has nothing written down yet.</p><button class="btn go" data-act="ptab" data-id="edit">' + I('edit') + 'Write the checklist</button></section>';
    var all = p.all || [], hasDraft = p.draft && (p.draftChanged || !p.latest), gone = (p.broken || []).filter(function (b) { return PF.publish.versionOf(b.folder); });
    var cur = shown.draft ? 'draft' : shown.pub.folder;
    var opts = (hasDraft ? '<option value="draft"' + (cur === 'draft' ? ' selected' : '') + '>Draft (not published)</option>' : '') +
      all.map(function (v) { return '<option value="' + esc(v.folder) + '"' + (v.folder === cur ? ' selected' : '') + '>v' + v.info.version + (v === p.latest ? ' (current)' : '') + ' · ' + esc(v.info.changes.slice(0, 50)) + '</option>'; }).join('') +
      /* Versions in the folder that can't be shown or run here (still syncing, damaged, or too new for this copy) say why. */
      gone.map(function (b) { return '<option value="" disabled>v' + PF.publish.versionOf(b.folder) + ' · can\'t be used here: ' + esc(String(b.why).slice(0, 200)) + '</option>'; }).join('');
    var h = '<section class="panel mapview" aria-labelledby="cl-h"><div class="row between"><h2 id="cl-h" tabindex="-1" style="margin:0">' + (shown.draft ? 'The draft' : 'The checklist') + '</h2>' +
      '<div class="row">' + (all.length + (hasDraft ? 1 : 0) + gone.length > 1 ? '<label class="sr" for="map-ver">Version to show</label><select id="map-ver" class="ver-pick" data-bound>' + opts + '</select>' : '<span class="small">' + (shown.draft ? 'Draft' : 'v' + shown.pub.info.version) + '</span>') +
      '<div class="seg" role="group" aria-label="Show as"><button type="button" data-act="flight" data-id="list" aria-pressed="' + !st.flight + '">Checklist</button><button type="button" data-act="flight" data-id="plan" aria-pressed="' + !!st.flight + '">Flight plan</button></div>' +
      (st.flight ? '' : '<button class="mini" data-act="toggle-md" aria-pressed="' + !!st.showMd + '">Markdown</button>') +
      (restoring ? '<span class="small" role="status">Restoring…</span>' : shown.current ? '<button class="btn" data-act="ptab" data-id="edit">' + I('edit') + 'Edit</button>' : '<button class="btn" data-act="restore-draft" data-id="' + esc(shown.pub.folder) + '">Restore as draft</button>') + '</div></div>';
    /* Edits made and not saved stay in the editor; say so here, where the saved version is showing. */
    var ed = st.editor && st.editor.pid === p.id ? st.editor : null;
    if (!restoring && ed && ed.text != null && ed.text !== ed.base) h += '<div class="notice"><span>You have edits in the draft that aren\'t saved.</span><button class="mini" data-act="ptab" data-id="edit">Continue editing</button></div>';
    if (!shown.current) h += '<div class="notice warn"><span>You\'re looking at v' + shown.pub.info.version + ', an older version. Runs that used it keep it.</span><button class="mini" data-act="back-current">Back to current</button></div>';
    if (st.pick && st.pick.kind === 'restore' && shown.pub && st.pick.id === shown.pub.folder) h += '<div class="notice warn"><span>' + (st.pick.dirty ? 'You have unsaved edits in the draft, and they\'ll be lost. ' : '') + 'The draft has changes that aren\'t published. Replace it with v' + shown.pub.info.version + '?</span><button class="btn stop" data-act="restore-draft" data-id="' + esc(shown.pub.folder) + '" data-sure="1">Replace the draft</button><button class="mini" data-act="unpick">Cancel</button></div>';
    if (st.showMd && !st.flight) return h + '<div class="row"><button class="mini" data-act="copy-map">' + I('copy') + 'Copy</button><span id="copy-msg" class="small" role="status"></span></div><pre class="source" id="map-source" tabindex="0">' + esc(shown.md) + '</pre></section>';
    var map = shown.draft ? M.parse(shown.md) : shown.pub.map, types = shown.draft ? (ctx.data.stepTypes || {}).types : shown.pub.types;
    if (st.flight) return h + V.flightPlan(ctx, p, map, shown) + '</section>';
    return h + (map.phases.length ? V.mapPreview(map, types, p.skills, 'cl-ph-') : '<p class="small">No phases yet. Choose Edit to add one.</p>') + '</section>';
  }

  /* Which inspector tab shows: the one chosen (selecting something clears that choice), else Selected while something is
     selected, else the tab last chosen in this browser, else Checks when something blocks publishing, else Preview. */
  function insTabOf(st, sel, blockers, builder) {
    var t = st.insTab;
    if (t === 'selected' && builder) return t;
    if (t === 'checks' || t === 'preview') return t;
    if (builder && sel) return 'selected';
    if (st.insTabSaved === 'checks' || st.insTabSaved === 'preview') return st.insTabSaved;
    return blockers ? 'checks' : 'preview';
  }
  /* The draft editor takes the whole page: its own header (Done, the name, save state, Builder | Markdown, Undo / Redo,
     Checks and Save), the messages and conflicts right under it, then panes that each scroll on their own: Parts, the
     outline and the inspector in the builder, or the Markdown and the inspector. */
  function editTab(ctx, p) {
    var st = ctx.state, ed = st.editor && st.editor.pid === p.id && st.editor.fsKey === ctx.fsKey ? st.editor : null;
    var text = ed && ed.text != null ? ed.text : ed ? ed.base : p.draft ? p.draft.md : p.latest ? p.latest.md : '';
    var map = M.parse(text), c = M.check(map, { people: ctx.data.people, types: (ctx.data.stepTypes || {}).types, workflows: (ctx.data.jira || {}).workflows, processes: ctx.processes().filter(function (x) { return x.latest; }).map(function (x) { return x.id; }) });
    var dirty = ed && ed.text != null && ed.text !== ed.base || st.obPending === p.id, file = p.draft ? p.draft.file : p.id + '.md', saving = (st.draftSaving || {})[ctx.fsKey + '\n' + p.id];
    var builder = st.builder !== false, o = PF.outline.parse(text), sel = builder && !o.unsupported && st.obSel && st.obSel.pid === p.id ? st.obSel : null;
    var nb = c.blockers.length, nt = c.suggestions.length, tab = insTabOf(st, !!sel, nb, builder);
    var status = saving === 'restore' ? 'Restoring…' : saving ? 'Saving…' : ed && ed.conflict ? 'Not saved: someone else changed it' : dirty ? 'Unsaved changes' : p.draft ? 'Saved' : 'New draft, from ' + (p.latest ? 'v' + p.latest.info.version : 'scratch');
    var un = ed && ed.undo ? ed.undo.length : 0, rn = ed && ed.redo ? ed.redo.length : 0, lu = un ? ed.undo[un - 1].what || '' : '', lr = rn ? ed.redo[rn - 1].what || '' : '';
    var count = nb || nt, checksLabel = nb ? nb + ' thing' + (nb === 1 ? '' : 's') + ' to fix before publishing' : nt ? nt + ' tip' + (nt === 1 ? '' : 's') : 'ready to publish';
    /* Three groups that never trade places: who it is, the editing tools, and saving. Discard keeps its place when hidden. */
    var just = !dirty && !saving && st.justSaved && st.justSaved.pid === p.id;
    var h = '<div class="fpe" id="fpe"><header class="fpe-head" role="region" aria-labelledby="ed-h"><div class="fpe-id">' +
      '<button type="button" class="btn fpe-done" data-act="ed-done">' + I('back') + 'Done</button>' +
      '<div class="fpe-title"><h1 id="ed-h" tabindex="-1">' + esc(p.title) + ' <span class="cat">Draft</span></h1><span class="small fpe-file">maps/drafts/' + esc(file) + '</span></div></div>' +
      '<div class="fpe-tools"><div class="seg" role="group" aria-label="Edit with"><button type="button" data-act="ed-mode" data-id="builder" aria-pressed="' + builder + '">Builder</button><button type="button" data-act="ed-mode" data-id="markdown" aria-pressed="' + !builder + '">Markdown</button></div>' +
      '<div class="row fpe-undo" role="group" aria-label="Undo and redo">' +
      '<button type="button" class="mini" data-act="ob-undo"' + (un ? '' : ' disabled') + (lu ? ' title="Undo ' + esc(lu) + '"' : '') + '>Undo' + (lu ? '<span class="sr"> ' + esc(lu) + '</span>' : '') + '</button>' +
      '<button type="button" class="mini" data-act="ob-redo"' + (rn ? '' : ' disabled') + (lr ? ' title="Redo ' + esc(lr) + '"' : '') + '>Redo' + (lr ? '<span class="sr"> ' + esc(lr) + '</span>' : '') + '</button></div>' +
      '<button type="button" class="chipbtn fpe-checks' + (nb ? ' bad' : '') + '" data-act="ins-tab" data-id="checks" aria-label="Checks: ' + checksLabel + '">' + (count ? '<span class="fpe-checks-t">Checks </span><span class="cnt' + (nb ? ' bad' : '') + '">' + count + '</span>' : I('check') + '<span class="fpe-checks-t">Checks</span>') + '</button></div>' +
      '<div class="fpe-save"><span class="fpe-savestate"><span class="fpe-state' + (dirty ? ' dirty' : '') + (just ? ' just' : '') + '" role="status">' + (just ? I('check') : '') + status + '</span>' +
      '<button type="button" class="linkish fpe-discard" data-act="revert-draft" data-id="' + esc(p.id) + '"' + (dirty ? '' : ' hidden') + '>Discard my changes</button></span>' +
      '<button type="button" class="btn go" data-act="save-draft" data-id="' + esc(p.id) + '" title="Saving never publishes. Choose Done, then publish it."' + ((dirty || !p.draft) && !saving ? '' : ' disabled') + '>' + (saving && saving !== 'restore' ? 'Saving…' : 'Save draft') + '</button></div></header>';
    /* Messages and conflicts stay in view, right under the header. */
    var al = '';
    if (st.msg && !st.msg.quiet) al += '<div class="notice ' + (st.msg.kind || '') + '" role="status"><span>' + esc(st.msg.text) + '</span><span class="row">' + (st.msg.act ? '<button type="button" class="btn" data-act="' + esc(st.msg.act) + '">' + esc(st.msg.label) + '</button>' : '') + '<button type="button" class="mini" data-act="dismiss">Dismiss</button></span></div>';
    if (st.folderErr) al += '<div class="notice bad" role="alert"><span><b>Can\'t read the team folder.</b> ' + esc(st.folderErr) + '</span><button type="button" class="btn" data-act="refresh">Try again</button></div>';
    if (ed && ed.conflict) al += '<div class="notice bad" role="alert"><span><b>Someone else changed this draft</b> since you opened it (a teammate, or your AI assistant). Nothing was saved. Compare below, then keep yours or take theirs.</span>' + (saving ? '<span class="small" role="status">Saving…</span>' : '<button class="btn stop" data-act="draft-keep-mine">Keep mine</button><button class="mini" data-act="draft-take-theirs">Take theirs</button>') + '</div>' +
      '<details open class="fpe-theirs"><summary class="small">Their version</summary><pre class="source">' + esc(ed.conflict.theirs || '(the draft was deleted)') + '</pre></details>';
    h += '<div class="fpe-alerts">' + al + '</div>';
    /* The inspector: a tablist of Selected (builder only), Checks and Preview. */
    var sl = sel && sel.kind === 'step' ? o.steps.filter(function (x) { return x.key === sel.key; })[0] : null, sp = sel && sel.kind !== 'step' ? o.phases.filter(function (x) { return x.key === sel.key; })[0] : null;
    var hl = sl ? { line: sl.line + 1 } : sp ? { phase: sp.index } : null;
    var form = builder ? V.builderForm(ctx, p, text) : '';
    var panes = {
      selected: form || '<div class="ob-nosel"><p><b>Nothing selected.</b> Choose a step, lane, phase or gate in the outline to change it here.</p>' +
        '<ul class="ob-sample" aria-hidden="true"><li class="s-ph">Phase</li><li class="s-st on">' + I('check') + 'A step, selected</li><li class="s-st">' + I('check') + 'Another step</li><li class="s-gt">Gate</li></ul></div>',
      checks: (dirty && !builder ? V.changedLines(ed.base, text) : '') + '<h2 class="fpe-ph">' + (nb ? 'Won\'t publish yet' : 'Checks') + '</h2>' + V.checkList(c) +
        '<p class="small">Saving never publishes. When it\'s ready, choose Done and publish it.</p><p class="small">The full format, every step type and its fields: <button class="link" data-act="open-types">Step types</button>. Or ask your AI assistant: <code>/flightdeck-edit-checklist</code>.</p>',
      preview: map.phases.length ? '<div class="mapview">' + V.mapPreview(map, (ctx.data.stepTypes || {}).types, p.skills, null, PF.fixes.openCounts(V.fixesOf(ctx, p)), hl) + '</div>' : '<p class="small">Add a phase to see it here.</p>'
    };
    var tabs = (builder ? [['selected', 'Selected']] : []).concat([['checks', 'Checks'], ['preview', 'Preview']]);
    var ins = '<aside class="fpe-pane fpe-ins" aria-label="Inspector"><div class="fpe-tabs" role="tablist" aria-label="Inspector">' + tabs.map(function (t) {
      var on = t[0] === tab;
      return '<button type="button" role="tab" id="ins-t-' + t[0] + '" aria-selected="' + on + '" aria-controls="ins-p-' + t[0] + '" tabindex="' + (on ? 0 : -1) + '" data-act="ins-tab" data-id="' + t[0] + '">' + t[1] + (t[0] === 'checks' && count ? ' <span class="cnt' + (nb ? ' bad' : '') + '">' + count + '</span>' : '') + '</button>';
    }).join('') + '</div>' + tabs.map(function (t) { return '<div class="fpe-tabpanel" role="tabpanel" id="ins-p-' + t[0] + '" aria-labelledby="ins-t-' + t[0] + '" tabindex="0"' + (t[0] === tab ? '' : ' hidden') + '>' + panes[t[0]] + '</div>'; }).join('') + '</aside>';
    if (builder) h += '<div class="fpe-panes' + (st.partsRail ? ' rail' : '') + '">' + V.obPartsPane(ctx, p) + '<section class="fpe-pane fpe-outline" id="ob-outline" aria-label="Outline">' + V.builder(ctx, p, text) + '</section>' + ins + '</div>';
    else h += '<div class="fpe-panes md"><section class="fpe-pane fpe-md" aria-label="Markdown"><label class="sr" for="draft-editor">Checklist Markdown</label><textarea id="draft-editor" class="code-editor" spellcheck="false" data-bound>\n' + esc(text) + '</textarea></section>' + ins + '</div>';
    return h + '</div>';
  }

  /* ---------- a new process ---------- */
  function newProcess(ctx) {
    var st = ctx.state, f = st.newProc || {};
    var field = function (id, label, hint, val, extra) { return '<label class="field" for="np-' + id + '">' + label + (hint ? ' <span class="small">' + hint + '</span>' : '') + '<input id="np-' + id + '" maxlength="120" value="' + esc(val || '') + '"' + (extra || '') + '></label>'; };
    var people = ctx.data.people.filter(function (p) { return !p.inactive; });
    return notices(ctx) + '<div class="runhead"><div><div class="eyebrow">New process</div><h1>Write down how something is done</h1><div class="small">This starts a draft checklist in <code>maps/drafts/</code>. Edit it here or with your AI assistant, then publish it.</div></div></div>' +
      '<form class="panel stack" id="new-process-form" data-scope="new-process">' +
      '<div class="grid2">' + field('id', 'Process ID', 'lowercase, dashes: the file name and what skills point to', f.id, ' pattern="[a-z0-9][a-z0-9-]*" required') + field('title', 'Title', '', f.title, ' required') + '</div>' +
      '<div class="grid2">' + field('group', 'Group', 'its place in the hierarchy, like Engineering / Releases', f.group) + field('tags', 'Tags', 'comma-separated', f.tags) + '</div>' +
      '<div class="grid2">' + field('context', 'Run details', 'filled in when a run starts, like ticket, commit', f.context) + field('roles', 'Roles', 'who does what, like lead, reviewer', f.roles) + '</div>' +
      '<label class="field" for="np-owner">Owner <span class="small">signs versions off as ready for a skill</span><select id="np-owner">' + people.map(function (p) { return '<option value="' + esc(p.id) + '"' + ((f.owner || st.me) === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="row"><input type="checkbox" id="np-solo"' + (f.solo ? ' checked' : '') + '> Usually run by one person</label>' +
      '<div class="row"><button class="btn go" type="submit">' + I('edit') + 'Create the draft</button><button class="mini" type="button" data-act="home">Cancel</button></div></form>';
  }
  /* The starting Markdown for a new process: front matter plus one phase to fill in. */
  function starterMap(f) {
    return ['---', 'process: ' + f.id, 'title: ' + f.title, 'category: ' + (f.group.split('/').pop().trim() || 'Other'), f.group ? 'group: ' + f.group : null, f.tags ? 'tags: ' + f.tags : null,
      'owner: ' + f.owner, f.context ? 'context: ' + f.context : null, f.roles ? 'roles: ' + f.roles : null, f.solo ? 'runs: solo' : null, '---', '',
      '## First phase · READ-DO {#first}', '- [ ] {confirm} The first thing to do {#first-step}', ''].filter(function (x) { return x !== null; }).join('\n');
  }

  /* ---------- step types ---------- */
  var KIND_HELP = { text: 'a line of text', url: 'a web link', code: 'a command or code', message: 'a message to post', list: 'choices, separated by commas', choice: 'one of fixed options' };
  /* One line per type: what it's for, where it's used, one action. What it asks for stays folded until someone wants it. */
  function typeCard(st, t, team, uses) {
    var fields = Object.keys(t.fields || {}), rec = t.record || [], key = 'type:' + t.id;
    var open = st.disc && st.disc[key];
    var list = function (items) { return items.length ? '<ul class="small">' + items.join('') + '</ul>' : '<div class="small">Nothing.</div>'; };
    return '<li class="tcard"><div class="row between"><span>' + I(t.icon || 'check') + ' <b>' + esc(t.label) + '</b> <code>{' + esc(t.id) + '}</code>' + (team ? ' <span class="pill open">team</span>' : '') + K.tagChips(T.tagsOf(t)) + '</span>' +
      '<span class="row"><span class="small">' + (uses ? 'in ' + uses + ' checklist' + (uses === 1 ? '' : 's') : 'not used yet') + '</span>' + (team ? '<button class="mini" data-act="edit-type" data-id="' + esc(t.id) + '">' + I('edit') + 'Edit</button>' : '<button class="mini" data-act="copy-type" data-id="' + esc(t.id) + '">Copy to a team type</button>') + '</span></div>' +
      (t.hint ? '<div class="small">' + esc(t.hint) + '</div>' : '') +
      '<details data-disc="' + esc(key) + '"' + (open ? ' open' : '') + '><summary class="small">What it asks for</summary><div class="tcols">' +
      '<div><div class="small"><b>In the checklist</b></div>' + list(fields.map(function (f) { var d = t.fields[f]; return '<li><code>' + esc(f) + '</code> ' + esc(d.label) + ' · ' + esc(d.kind) + (d.required ? ', usually filled in' : '') + (d.requiredWhen ? ', when ' + esc(JSON.stringify(d.requiredWhen).replace(/[{}"]/g, '')) : '') + (d.options ? ': ' + esc(d.options.join(' / ')) : '') + '</li>'; })) + '</div>' +
      '<div><div class="small"><b>When it\'s checked</b></div>' + list(rec.map(function (d) { return '<li><code>' + esc(d.name) + '</code> ' + esc(d.label) + ' · ' + esc(d.kind) + (d.options ? ': ' + esc(d.options.join(' / ')) : '') + (d.when ? ', when ' + esc(JSON.stringify(d.when).replace(/[{}"]/g, '')) : '') + '</li>'; })) + '</div></div></details></li>';
  }
  function types(ctx) {
    var st = ctx.state, team = (ctx.data.stepTypes || {}).types || {}, errs = (ctx.data.stepTypes || {}).errors || [];
    var uses = function (id) { return ctx.processes().filter(function (p) { return p.latest && M.usedTypes(p.latest.map).indexOf(id) >= 0; }).length; };
    if (st.typeForm && st.typeForm.fsKey === ctx.fsKey) return typeForm(ctx);
    var h = notices(ctx) + '<div class="runhead"><div><div class="eyebrow">Library</div><h1>Step types</h1><div class="small">A step\'s type decides what it asks for. Add your own for tools the built-ins don\'t cover.</div></div><div class="row"><button class="btn go" data-act="new-type">' + I('edit') + 'New step type</button></div></div>';
    if (errs.length) h += '<div class="notice warn"><span>' + errs.map(function (e) { return 'step-types/' + esc(e.file) + ': ' + esc(e.errors.join('; ')); }).join('<br>') + '</span></div>';
    /* Organized like processes and skills: a tag filter, then each list as a tree by group. */
    var teamTypes = Object.keys(team).sort().map(function (id) { return team[id]; }), chosen = st.tags || [];
    var allT = chosen.slice(); teamTypes.forEach(function (t) { T.tagsOf(t).forEach(function (x) { if (allT.indexOf(x) < 0) allT.push(x); }); }); allT.sort();
    var has = function (t) { var tg = T.tagsOf(t); return chosen.every(function (c) { return tg.indexOf(c) >= 0; }); };
    var shownTeam = teamTypes.filter(has), shownBuilt = T.LIST.filter(has);
    h += K.tagBar(allT, chosen);
    h += '<section class="panel"><h2>Your team\'s types · ' + teamTypes.length + '</h2>' + (teamTypes.length ? (shownTeam.length ? K.tree(shownTeam, T.groupOf, function (t) { return typeCard(st, t, true, uses(t.id)); }, st.groupsOpen) : '<p class="small">None with these tags.</p>') : '<p class="small">None yet. Choose <b>New step type</b>, or copy a built-in below.</p>') + '</section>';
    if (shownBuilt.length) h += '<section class="panel"><h2>Built-in types · ' + T.LIST.length + '</h2>' + K.tree(shownBuilt, T.groupOf, function (t) { return typeCard(st, t, false, uses(t.id)); }, st.groupsOpen) + '</section>';
    return h;
  }
  /* The form for a team step type. Rows for fields and evidence; checked on every change with the same rules the folder uses. */
  function typeForm(ctx) {
    var st = ctx.state, f = st.typeForm, d = f.def, errs = formErrors(d), at = errorTargets(d, errs);
    /* Every control is bound to the form's state (data-bound), and points at the errors about it. */
    var a11y = function (id) { var e = at[id]; return ' data-bound' + (e ? ' aria-invalid="true" aria-describedby="' + e.map(function (n) { return 'tf-err-' + n; }).join(' ') + '"' : ''); };
    /* Each row has its own key (not its position), so removing one never moves another's values into its place. */
    var row = function (kind, i, r) {
      var kinds = kind === 'f' ? Object.keys(KIND_HELP) : ['text', 'url', 'choice'], k = r.k, id = function (x) { return 'tf-' + kind + '-' + k + '-' + x; };
      return '<div class="trow" data-scope="tf-' + kind + '-' + k + '">' +
        '<input id="' + id('name') + '" aria-label="Name" placeholder="name" value="' + esc(r.name) + '"' + a11y(id('name')) + '>' +
        '<input id="' + id('label') + '" aria-label="Label" placeholder="Label people see" value="' + esc(r.label) + '"' + a11y(id('label')) + '>' +
        '<select id="' + id('kind') + '" aria-label="Kind"' + a11y(id('kind')) + '>' + kinds.map(function (x) { return '<option value="' + x + '"' + (r.kind === x ? ' selected' : '') + '>' + x + (KIND_HELP[x] && kind === 'f' ? ': ' + KIND_HELP[x] : '') + '</option>'; }).join('') + '</select>' +
        '<textarea id="' + id('options') + '" aria-label="Options, one per line" placeholder="options, one per line" rows="2"' + a11y(id('options')) + '>\n' + esc(r.options) + '</textarea>' +
        (kind === 'f' ? '<label class="small"><input type="checkbox" id="' + id('required') + '" data-bound' + (r.required ? ' checked' : '') + '> usually filled in</label>' : '<label class="small"><input type="checkbox" id="' + id('long') + '" data-bound' + (r.long ? ' checked' : '') + '> long text</label>') +
        '<button class="mini" type="button" data-act="tf-remove" data-id="' + kind + ':' + k + '" aria-label="Remove ' + esc(r.name || 'this row') + '">Remove</button></div>';
    };
    var json = JSON.stringify(defOf(d), null, 2);
    return notices(ctx) + '<div class="runhead"><div><div class="eyebrow">Step types</div><h1>' + (f.existing ? 'Edit {' + esc(f.existing) + '}' : 'New step type') + '</h1><div class="small">Saved as <code>step-types/' + esc(d.id || '<id>') + '.json</code>. Checklists can use it as <code>{' + esc(d.id || 'your.type') + '}</code> as soon as it\'s saved; publishing freezes it into each version, so later edits never change an old one.</div></div></div>' +
      '<div class="editor-grid"><form class="panel stack" id="type-form" data-scope="type-form">' +
      '<div class="grid2"><label class="field" for="tf-id">ID <span class="small">lowercase with dots, like change.request</span><input id="tf-id" value="' + esc(d.id) + '"' + (f.existing ? ' readonly' : '') + a11y('tf-id') + '></label><label class="field" for="tf-label">Label<input id="tf-label" value="' + esc(d.label) + '"' + a11y('tf-label') + '></label></div>' +
      '<div class="grid2"><label class="field" for="tf-group">Group <span class="small">where it sits, like Releases / Approvals</span><input id="tf-group" maxlength="80" value="' + esc(d.group || '') + '"' + a11y('tf-group') + '></label><label class="field" for="tf-tags">Tags <span class="small">comma-separated</span><input id="tf-tags" maxlength="400" value="' + esc(d.tags || '') + '"' + a11y('tf-tags') + '></label></div>' +
      '<div class="grid2"><label class="field" for="tf-hint">What it\'s for<input id="tf-hint" maxlength="120" value="' + esc(d.hint) + '"' + a11y('tf-hint') + '></label><label class="field" for="tf-icon">Icon<select id="tf-icon" data-bound>' + T.ICONS.map(function (ic) { return '<option' + (d.icon === ic ? ' selected' : '') + '>' + ic + '</option>'; }).join('') + '</select></label></div>' +
      '<h3>Fields <span class="small">what a checklist can say about the step</span></h3>' + d.fields.map(function (r, i) { return row('f', i, r); }).join('') + '<button class="mini" type="button" data-act="tf-add" data-id="f">Add a field</button>' +
      '<h3>Evidence <span class="small">what can be recorded when it\'s checked</span></h3>' + d.record.map(function (r, i) { return row('r', i, r); }).join('') + '<button class="mini" type="button" data-act="tf-add" data-id="r">Add evidence</button>' +
      (f.conflict ? '<div class="notice bad" role="alert"><span><b>Someone else changed this file</b> since you opened it. Nothing was saved. Compare, then keep yours or take theirs.</span>' + (f.saving ? '<span class="small" role="status">Saving…</span>' : '<button class="btn stop" type="button" data-act="type-keep-mine">Keep mine</button><button class="mini" type="button" data-act="type-take-theirs">Take theirs</button>') + '</div>' +
        '<details open><summary class="small">Their version</summary><pre class="source">' + esc(f.conflict.theirs == null ? '(the file was deleted)' : f.conflict.theirs) + '</pre></details>' : '') +
      '<div class="row"><button class="btn go" type="submit"' + (errs.length || f.saving ? ' disabled' : '') + (errs.length ? ' aria-describedby="tf-errs"' : '') + '>' + (f.saving ? 'Saving…' : 'Save step type') + '</button><button class="mini" type="button" data-act="type-cancel">Cancel</button></div></form>' +
      '<aside class="stack"><section class="panel"><h2 role="status">' + (errs.length ? 'Not ready yet · ' + errs.length + ' to fix' : 'Ready to save') + '</h2>' + (errs.length ? '<ul class="checks" id="tf-errs">' + errs.map(function (e, n) { return '<li id="tf-err-' + n + '"><span class="lvl bad">Fix</span><span>' + esc(e) + '</span></li>'; }).join('') + '</ul>' : '<p class="small">Checked with the same rules the team folder uses.</p>') + '</section>' +
      '<section class="panel"><h2>In a checklist</h2><pre class="source">' + esc('- [ ] {' + (d.id || 'your.type') + '} What to do {#step-id}' + d.fields.filter(function (r) { return r.name; }).map(function (r) { return '\n  ' + r.name + ': ...'; }).join('') + (d.record.length ? '\n  require: all' : '')) + '</pre></section>' +
      '<section class="panel"><h2>The file</h2><pre class="source">' + esc(json) + '</pre></section></aside></div>';
  }
  /* What's wrong with the form: the folder's own checks, plus two names the same (which a JSON object would silently merge). */
  function formErrors(d) {
    var errs = [], seen = {};
    d.fields.forEach(function (r) { var n = (r.name || '').trim(); if (!n) return; if (seen[n]) errs.push('field "' + n + '" is listed twice; give each field its own name'); seen[n] = 1; });
    /* A row with a label or options but no name would be dropped on save; say so instead. */
    var unnamed = function (r) { return !(r.name || '').trim() && ((r.label || '').trim() || (r.options || '').trim()); };
    var what = function (r) { return (r.label || '').trim() ? 'labeled "' + r.label.trim() + '"' : 'with options'; };
    d.fields.forEach(function (r) { if (unnamed(r)) errs.push('a field ' + what(r) + ' has no name; name it or remove it'); });
    d.record.forEach(function (r) { if (unnamed(r)) errs.push('evidence ' + what(r) + ' has no name; name it or remove it'); });
    return errs.concat(T.checkCustom(defOf(d)));
  }
  /* Which control each error is about, by the error's position: { 'tf-id': [0], 'tf-f-k3-name': [2] }. */
  function errorTargets(d, errs) {
    var at = {}, add = function (id, n) { (at[id] = at[id] || []).push(n); };
    var rowOf = function (list, name) { return list.filter(function (r) { return (r.name || '').trim() === name; })[0]; };
    errs.forEach(function (e, n) {
      var m;
      if (/^"id"| is a built-in type/.test(e)) add('tf-id', n);
      else if (/^"label"/.test(e)) add('tf-label', n);
      else if (/^"hint"/.test(e)) add('tf-hint', n);
      else if (/^"group"/.test(e)) add('tf-group', n);
      else if (/^"tags"/.test(e)) add('tf-tags', n);
      else if ((m = /^(field|record) "([^"]*)"(: label)?/.exec(e))) { var kind = m[1] === 'field' ? 'f' : 'r', r = rowOf(kind === 'f' ? d.fields : d.record, m[2]); if (r) add('tf-' + kind + '-' + r.k + '-' + (m[3] ? 'label' : /options|choice/.test(e) ? 'options' : 'name'), n); }
      else if ((m = /^record (\d+): /.exec(e))) { var named = d.record.filter(function (r) { return r.name; }), rr = named[+m[1] - 1]; if (rr) add('tf-r-' + rr.k + '-' + (/options/.test(e) ? 'options' : /label/.test(e) ? 'label' : /kind/.test(e) ? 'kind' : 'name'), n); }
      else if ((m = /^(a field|evidence) (?:labeled "([^"]*)"|with options) has no name/.exec(e))) { var k2 = m[1] === 'a field' ? 'f' : 'r'; (k2 === 'f' ? d.fields : d.record).forEach(function (r) { if (!(r.name || '').trim() && (m[2] == null ? !(r.label || '').trim() && (r.options || '').trim() : (r.label || '').trim() === m[2])) add('tf-' + k2 + '-' + r.k + '-name', n); }); }
    });
    return at;
  }
  /* The form's state → a step-type definition, in the folder's format. Options are one per line, so commas stay in an option. */
  function defOf(d) {
    /* Options a person didn't touch are kept exactly as the file had them (an option may hold spaces or a line break). */
    var out = { id: (d.id || '').trim(), label: (d.label || '').trim() }, norm = function (x) { return String(x || '').replace(/\r\n?/g, '\n'); }, opts = function (r) { return r.orig && norm(r.options) === norm(r.orig.join('\n')) ? r.orig.slice() : String(r.options || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };
    if (d.hint) out.hint = d.hint.trim();
    if (d.group && T.groupText(d.group)) out.group = T.groupText(d.group);
    var tg = String(d.tags || '').split(',').map(T.tagText).filter(Boolean);
    if (tg.length) out.tags = tg;
    if (d.icon) out.icon = d.icon;
    out.fields = {};
    d.fields.forEach(function (r) { if (!r.name) return; var x = { label: r.label, kind: r.kind }; if (r.required) x.required = true; if (r.kind === 'choice') x.options = opts(r); out.fields[r.name] = x; });
    out.record = d.record.filter(function (r) { return r.name; }).map(function (r) { var x = { name: r.name, label: r.label, kind: r.kind }; if (r.kind === 'choice') x.options = opts(r); if (r.long) x.long = true; return x; });
    return out;
  }
  /* A definition (from a file or a built-in) → the form's state. */
  function formOf(t, keepId) {
    return { id: keepId ? t.id : '', label: t.label || '', hint: t.hint || '', icon: t.icon || 'check', group: keepId && t.group ? t.group.join(' / ') : '', tags: keepId && t.tags ? t.tags.join(', ') : '',
      fields: Object.keys(t.fields || {}).map(function (n) { var x = t.fields[n], fixed = x.kind !== 'choice' || ((x.options || []).length && !x.optionsFrom); return { k: nextKey(), name: n, label: x.label, kind: fixed ? x.kind : 'text', required: !!x.required, options: fixed ? (x.options || []).join('\n') : '', orig: fixed && x.options ? x.options.slice() : null }; }),
      /* A built-in choice whose options come from the step (optionsFrom) has no fixed list a team type can hold: it becomes text. */
      record: (t.record || []).map(function (r) { var fixed = r.kind === 'choice' && (r.options || []).length && !r.optionsFrom; return { k: nextKey(), name: r.name, label: r.label, kind: fixed ? 'choice' : r.kind === 'url' ? 'url' : 'text', long: !!r.long, options: fixed ? r.options.join('\n') : '', orig: fixed ? r.options.slice() : null }; }) };
  }

  /* ---------- one skill: what it is, where it lives, what it follows, and whether it still matches ---------- */
  var STATUS_WORDS = {
    current: ['passed', 'In step', ''],
    unaffected: ['open', 'Note the new version', 'Copy the brief for your LLM to note it.'],
    update: ['failed', 'Needs an update', 'Give your LLM the update brief: it has the exact before and after.'],
    missing: ['failed', 'Check it', '']
  };
  function skillPage(ctx) {
    var st = ctx.state, hit = null, proc = null;
    ctx.processes().forEach(function (p) { p.skills.forEach(function (x) { if ((x.skill.file || x.skill.name) === st.skillFile) { hit = x; proc = p; } }); });
    (ctx.orphanSkills ? ctx.orphanSkills() : []).forEach(function (x) { if ((x.skill.file || x.skill.name) === st.skillFile) hit = x; });
    if (!hit) return notices(ctx) + '<div class="panel" role="alert">That skill isn\'t registered in this folder any more. <button class="mini" id="page-back" data-act="nav" data-id="skills">Back to Skills</button></div>';
    var s = hit.skill, sw = STATUS_WORDS[hit.status.s] || STATUS_WORDS.missing, href = PF.skills.link(s.location), base = hit.status.base, latest = hit.status.latest;
    var stepText = function (id) { var f = (base || latest) && M.findStep((base || latest).map, id); return f ? f.step.text : id; };
    var h = notices(ctx) + '<div class="runhead"><div><div class="eyebrow">Skill' + (s.version ? ' · version ' + esc(s.version) : '') + '</div><h1 id="page-h" tabindex="-1">' + I('spark') + ' ' + esc(s.name) + '</h1>' + (s.description ? '<div class="small">' + esc(s.description) + '</div>' : '') + K.tagChips(s.tags) + '</div>' +
      '<div class="row">' + (proc ? '<button class="btn" data-act="open-process" data-id="' + esc(proc.id) + '">Open ' + esc(proc.title) + '</button>' : '') + '</div></div>';
    h += '<section class="panel status-card" data-s="' + esc(hit.status.s) + '" aria-labelledby="ss-h"><h2 id="ss-h"><span class="pill ' + sw[0] + '">' + sw[1] + '</span></h2><p>' + esc(hit.status.text) + (sw[2] ? ' ' + esc(sw[2]) : '') + '</p>';
    if (hit.status.s === 'update' && hit.status.changes) h += '<ul class="changes">' + hit.status.changes.map(function (c) {
      if (c.change === 'order') return '<li><b>Order:</b> its steps now run in a different order.</li>';
      if (c.change === 'context') return '<li><b>Run details:</b> now ' + esc(c.to.join(', ') || 'none') + ' (was ' + esc(c.from.join(', ') || 'none') + ').</li>';
      return '<li><b>' + esc((c.to || c.from).text) + '</b>: ' + ({ changed: 'changed', removed: 'removed', added: 'new' })[c.change] + '</li>';
    }).join('') + '</ul>';
    if (hit.status.s === 'update' || hit.status.s === 'unaffected') h += '<div class="row"><button class="btn go" data-act="copy-brief" data-id="update:' + esc(s.file) + '">' + I('copy') + 'Copy the update brief</button></div>' + briefBoxOf(st, 'update:' + s.file);
    h += '</section>';
    h += '<section class="panel" aria-labelledby="sf-h"><h2 id="sf-h">About this skill</h2><dl class="facts">' +
      '<dt>Source</dt><dd>' + (s.location ? (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(s.location) + '</a>' : '<code>' + esc(s.location) + '</code>') : 'Not recorded') + '</dd>' +
      '<dt>Automates</dt><dd>' + (proc ? '<button class="link" data-act="open-process" data-id="' + esc(proc.id) + '">' + esc(proc.title) + '</button>, version ' + s.implements + (latest && latest.info.version !== s.implements ? ' (the process is now at v' + latest.info.version + ')' : '') : esc(s.process || '?') + '@' + s.implements) + '</dd>' +
      '<dt>Covers</dt><dd>' + (s.steps ? '<ol class="small">' + s.steps.map(function (id) { return '<li>' + esc(stepText(id)) + ' <code>' + esc(id) + '</code></li>'; }).join('') + '</ol>' : 'The whole process') + '</dd>' +
      '<dt>Registered in</dt><dd><code>skills/' + esc(s.file || s.name + '.json') + '</code>' + (s.updated ? ' · updated ' + esc(s.updated) : '') + '</dd>' +
      (s.group.length ? '<dt>Group</dt><dd>' + esc(s.group.join(' / ')) + '</dd>' : '') + '</dl></section>';
    return h;
  }
  function briefBoxOf(st, key) {
    if (!st.brief || st.brief.key !== key) return '';
    return '<details open class="brief"><summary class="small"><span id="copy-msg" role="status"></span> The brief</summary><pre id="brief-pre" class="source" tabindex="0">' + esc(st.brief.text) + '</pre></details>';
  }

  /* ---------- Settings: the team folder, people, integrations, keyboard and version ---------- */
  function settings(ctx) {
    var st = ctx.state, fs = st.fs, d = ctx.data, rel = ctx.releases;
    var h = notices(ctx) + V.pageHead('Settings', 'Settings', '');
    h += '<section class="panel stack" aria-labelledby="set-folder"><h2 id="set-folder">' + I('doc') + 'Team folder</h2>';
    if (fs && fs.kind === 'folder') h += '<p>Using <b>' + esc(fs.name) + '</b>' + (st.folderErr ? ', which can\'t be read right now: ' + esc(st.folderErr) : ', read ' + esc(U.hm(st.runReadAt || new Date().toISOString())) + '.') + '</p>';
    else if (st.needsReconnect) h += '<p>The team folder needs your OK again.</p><div class="row"><button class="btn go" data-act="reconnect">Reconnect</button></div>';
    else h += '<p>You\'re using the <b>examples</b>, saved in this browser only.</p>';
    h += ctx.canFolder ? '<div class="row"><button class="btn" data-act="connect">' + (fs && fs.kind === 'folder' ? 'Change team folder' : 'Open team folder') + '</button><button class="btn" data-act="new-folder">Start a new team folder</button>' + (fs && fs.kind === 'memory' ? '<button class="mini" data-act="reset-examples">Reset examples</button>' : '') + '</div>' +
      '<p class="small">Pick a shared OneDrive folder set to <i>Always keep on this device</i>.</p>'
      : '<p class="small">This browser can\'t open folders. Use Edge or Chrome on a computer.</p>';
    h += '</section>';
    h += '<section class="panel" aria-labelledby="set-people"><h2 id="set-people">' + I('people') + 'People · ' + d.people.length + '</h2>' + (d.people.length ? '<ul class="vlist">' + d.people.map(function (p) { return '<li>' + K.avatar(ctx, p.id) + '<span><b>' + esc(p.name) + '</b>' + (p.inactive ? ' <span class="small">(inactive)</span>' : '') + '<br><span class="small">' + esc(p.id) + (p.email ? ' · ' + esc(p.email) : '') + '</span></span></li>'; }).join('') + '</ul>' : '<p class="small">Nobody yet.</p>') +
      '<p class="small">To change this list, edit <code>people.json</code> in the team folder.</p></section>';
    h += V.teamSetup(ctx);
    var th = V.THEMES[st.theme] ? st.theme : 'system';
    h += '<section class="panel" aria-labelledby="set-look"><h2 id="set-look">Appearance</h2><div class="seg" role="group" aria-labelledby="set-look">' + ['system', 'light', 'dark'].map(function (k) { return '<button type="button" data-act="theme" data-id="' + k + '" aria-pressed="' + (th === k) + '">' + I(V.THEMES[k].icon) + V.THEMES[k].label + '</button>'; }).join('') + '</div></section>';
    h += '<section class="panel" aria-labelledby="set-keys"><h2 id="set-keys">Keyboard</h2><div class="row"><button class="btn" data-act="toggle-keys" aria-pressed="' + (st.keys !== false) + '">' + (st.keys !== false ? 'Single-key shortcuts are on' : 'Single-key shortcuts are off') + '</button><span class="small">Press ? anywhere to see them.</span></div></section>';
    h += '<section class="panel" aria-labelledby="set-about"><h2 id="set-about">About</h2><p>Flightdeck <b>' + esc(rel.version) + '</b>' + (rel.newer ? ' · <b>' + esc(rel.newer) + '</b> is in the team folder' : '') + '</p><div class="row">' + (rel.version === 'dev' ? '' : '<button class="btn" data-act="whats-new">What\'s new</button>') + '</div>' +
      '<p class="small">Install or update from a terminal: <code>npm install -g @troylar/flightdeck</code>, then <code>flightdeck install &lt;team folder&gt;</code>.</p></section>';
    return h;
  }

  var keySeq = 0;
  function nextKey() { return 'k' + (++keySeq); }
  V.settings = settings; V.skill = skillPage; V.typeErrors = formErrors; V.nextRowKey = nextKey;
  V.tabOf = tabOf; V.checklistPanel = checklistPanel; V.shownOf = shownOf; V.editTab = editTab; V.insTabOf = insTabOf; V.newProcess = newProcess; V.starterMap = starterMap;
  V.types = types; V.typeDefOf = defOf; V.typeFormOf = formOf;
  /* Everything a person can change in the form, unnamed rows included, so a half-filled row still counts as a change. */
  V.typeFormSnapshot = function (d) { var row = function (r) { return [r.name, r.label, r.kind, String(r.options || '').replace(/\r\n?/g, '\n'), !!r.required, !!r.long]; }; return JSON.stringify([d.id, d.label, d.hint, d.icon, d.group || '', d.tags || '', d.fields.map(row), d.record.map(row)]); };
})();
