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
    if (!shown && p.proposedOnly) return '';
    if (!shown) return '<section class="panel"><p class="small">This checklist has nothing written down yet.</p><button class="btn go" data-act="ptab" data-id="edit">' + I('edit') + 'Write the checklist</button></section>';
    var all = p.all || [], hasDraft = p.draft && (p.draftChanged || !p.latest), gone = (p.broken || []).filter(function (b) { return PF.publish.versionOf(b.folder); });
    var cur = shown.draft ? 'draft' : shown.pub.folder, view = st.clView === 'plan' || st.clView === 'md' ? st.clView : 'list';
    var opts = (hasDraft ? '<option value="draft"' + (cur === 'draft' ? ' selected' : '') + '>Draft (not published)</option>' : '') +
      all.map(function (v) { return '<option value="' + esc(v.folder) + '"' + (v.folder === cur ? ' selected' : '') + '>v' + v.info.version + (v === p.latest ? ' (current)' : '') + ' · ' + esc(v.info.changes.slice(0, 50)) + '</option>'; }).join('') +
      /* Versions in the folder that can't be shown or run here (still syncing, damaged, or too new for this copy) say why. */
      gone.map(function (b) { return '<option value="" disabled>v' + PF.publish.versionOf(b.folder) + ' · can\'t be used here: ' + esc(String(b.why).slice(0, 200)) + '</option>'; }).join('');
    var h = '<section class="panel mapview" aria-labelledby="cl-h"><div class="row between"><h2 id="cl-h" tabindex="-1" style="margin:0">' + (shown.draft ? 'The draft' : 'The checklist') + '</h2>' +
      '<div class="row">' + (all.length + (hasDraft ? 1 : 0) + gone.length > 1 ? '<label class="sr" for="map-ver">Version to show</label><select id="map-ver" class="ver-pick" data-bound>' + opts + '</select>' : '<span class="small">' + (shown.draft ? 'Draft' : 'v' + shown.pub.info.version) + '</span>') +
      /* One switch for the three ways to see the same version: the checklist, its flight plan, or its Markdown source. */
      '<div class="seg" role="group" aria-label="Show as">' + [['list', 'Checklist'], ['plan', 'Flight plan'], ['md', 'Markdown']].map(function (x) { return '<button type="button" data-act="flight" data-id="' + x[0] + '" aria-pressed="' + (view === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      (restoring ? '<span class="small" role="status">Restoring…</span>' : shown.current ? '<button class="btn" data-act="ptab" data-id="edit">' + I('edit') + ((p.editing || []).length ? 'Edit anyway' : 'Edit') + '</button>' : '<button class="btn" data-act="restore-draft" data-id="' + esc(shown.pub.folder) + '">Restore as draft</button>') + '</div></div>';
    /* Edits made and not saved stay in the editor; say so here, where the saved version is showing. */
    var ed = st.editor && st.editor.pid === p.id ? st.editor : null;
    if (!restoring && ed && ed.text != null && ed.text !== ed.base) h += '<div class="notice"><span>You have edits in the draft that aren\'t saved.</span><button class="mini" data-act="ptab" data-id="edit">Continue editing</button></div>';
    if (!shown.current) h += '<div class="notice warn"><span>You\'re looking at v' + shown.pub.info.version + ', an older version. Runs that used it keep it.</span><button class="mini" data-act="back-current">Back to current</button></div>';
    if (st.pick && st.pick.kind === 'restore' && shown.pub && st.pick.id === shown.pub.folder) h += '<div class="notice warn"><span>' + (st.pick.dirty ? 'You have unsaved edits in the draft, and they\'ll be lost. ' : '') + 'The draft has changes that aren\'t published. Replace it with v' + shown.pub.info.version + '?</span><button class="btn stop" data-act="restore-draft" data-id="' + esc(shown.pub.folder) + '" data-sure="1">Replace the draft</button><button class="mini" data-act="unpick">Cancel</button></div>';
    if (view === 'md') return h + '<div class="row"><p class="small" style="margin:0">The ' + (shown.draft ? 'draft' : 'v' + shown.pub.info.version) + ' as written, read-only. Edit changes it.</p><button class="mini" data-act="copy-map">' + I('copy') + 'Copy</button><span id="copy-msg" class="small" role="status"></span></div><pre class="source" id="map-source" tabindex="0" aria-label="Markdown of this version">' + esc(shown.md) + '</pre></section>';
    var map = shown.draft ? M.parse(shown.md) : shown.pub.map, types = shown.draft ? (ctx.data.stepTypes || {}).types : shown.pub.types;
    if (view === 'plan') return h + V.flightPlan(ctx, p, map, shown) + '</section>';
    return h + (map.phases.length ? V.mapPreview(map, types, p.skills, 'cl-ph-') : '<p class="small">No phases yet. Choose Edit to add one.</p>') + '</section>';
  }

  /* Which inspector tab shows: the one chosen (selecting something clears that choice), else Selected while something is
     selected, else the tab last chosen in this browser, else Checks when something blocks publishing, else Preview. A draft
     with no steps at all, blocked only by its empty phases, is a new start: it opens on Preview too. */
  function insTabOf(st, sel, blockers, builder, fresh) {
    var t = st.insTab;
    if (t === 'selected' && builder) return t;
    if (t === 'checks' || t === 'preview') return t;
    if (builder && sel) return 'selected';
    if (st.insTabSaved === 'checks' || st.insTabSaved === 'preview') return st.insTabSaved;
    return blockers && !fresh ? 'checks' : 'preview';
  }
  function freshDraft(map, blockers) {
    if (map.phases.some(function (ph) { return ph.steps.length; })) return false;
    var empty = map.phases.map(function (ph) { return 'Phase "' + ph.title + '" has no steps.'; });
    return blockers.every(function (b) { return empty.indexOf(b) >= 0; });
  }
  /* The draft editor takes the whole page: its own header (Done, the name, save state, Builder | Markdown, Undo / Redo,
     Checks and Save), the messages and conflicts right under it, then panes that each scroll on their own: Parts, the
     outline and the inspector in the builder, or the Markdown and the inspector. */
  function editTab(ctx, p) {
    var st = ctx.state, ed = st.editor && st.editor.pid === p.id && st.editor.fsKey === ctx.fsKey ? st.editor : null;
    var text = ed && ed.text != null ? ed.text : ed ? ed.base : p.draft ? p.draft.md : p.latest ? p.latest.md : '';
    var map = M.parse(text), c = M.check(map, { people: ctx.data.people, types: (ctx.data.stepTypes || {}).types, workflows: (ctx.data.jira || {}).workflows, processes: ctx.processes().filter(function (x) { return x.latest; }).map(function (x) { return x.id; }), children: ctx.procOf ? PF.links.childrenFrom(ctx.procOf) : null, parents: ctx.processes(), teamValues: ctx.data.teamValues });
    var dirty = ed && ed.text != null && ed.text !== ed.base || st.obPending === p.id, file = p.draft ? p.draft.file : p.id + '.md', saving = (st.draftSaving || {})[ctx.fsKey + '\n' + p.id];
    var builder = st.builder !== false, o = PF.outline.parse(text), sel = builder && !o.unsupported && st.obSel && st.obSel.pid === p.id ? st.obSel : null;
    var practicing = !!(st.practicing || {})[ctx.fsKey + '\n' + p.id];
    var nb = c.blockers.length, nt = c.suggestions.length, tab = insTabOf(st, !!sel, nb, builder, freshDraft(map, c.blockers));
    var status = draftStatus(ctx, p, ed, text);
    /* Only problems make a number; tips are listed under Checks without one. */
    var count = nb, checksLabel = nb ? nb + ' thing' + (nb === 1 ? '' : 's') + ' to fix before publishing' : nt ? nt + ' tip' + (nt === 1 ? '' : 's') : 'ready to publish';
    /* Three groups that never trade places: who it is, the editing tools, and saving. Discard keeps its place when hidden. */
    var just = !dirty && !saving && st.justSaved && st.justSaved.pid === p.id, size = U.draftSize(text);
    var h = '<div class="fpe" id="fpe"><header class="fpe-head" role="region" aria-labelledby="ed-h"><div class="fpe-id">' +
      '<button type="button" class="btn fpe-done" data-act="ed-done">' + I('back') + 'Review &amp; publish</button>' +
      '<div class="fpe-title"><h1 id="ed-h" tabindex="-1">' + esc(p.title) + ' <span class="cat">Draft</span></h1><span class="small fpe-file">maps/drafts/' + esc(file) + (size ? ' · ' + size : '') + '</span></div></div>' +
      '<div class="fpe-tools"><div class="seg" role="group" aria-label="Edit with"><button type="button" data-act="ed-mode" data-id="builder" aria-pressed="' + builder + '">Builder</button><button type="button" data-act="ed-mode" data-id="markdown" aria-pressed="' + !builder + '">Markdown</button></div>' +
      /* Undo, Redo and History: the one timeline shared with the Markdown view (and the step-type editor's same controls). */
      V.undoBar('draft', ed && ed.tl) +
      /* Practice opens the run screen for what's on screen; while one is open for this draft, it goes back to it. */
      '<button type="button" class="chipbtn fpe-practice" data-act="pr-open" title="Run what\'s on screen, in this window only. Nothing is recorded.">' + I('play') + (practicing ? 'Back to practice' : 'Practice') + '</button>' +
      '<button type="button" class="chipbtn fpe-checks' + (nb ? ' bad' : '') + '" data-act="ins-tab" data-id="checks" aria-label="Checks: ' + checksLabel + '">' + (count ? '<span class="fpe-checks-t">Checks </span><span class="cnt' + (nb ? ' bad' : '') + '">' + count + '</span>' : I('check') + '<span class="fpe-checks-t">Checks</span>') + '</button></div>' +
      '<div class="fpe-save"><span class="fpe-savestate"><span class="fpe-state' + (dirty ? ' dirty' : '') + (just ? ' just' : '') + '" role="status">' + (just ? I('check') : '') + status + '</span>' +
      '<button type="button" class="linkish fpe-discard" data-act="revert-draft" data-id="' + esc(p.id) + '"' + (dirty ? '' : ' hidden') + '>Discard my changes</button></span>' +
      '<button type="button" class="btn go" data-act="save-draft" data-id="' + esc(p.id) + '" title="Saving never publishes. Choose Save draft, then Review &amp; publish."' + ((dirty || !p.draft) && !saving ? '' : ' disabled') + '>' + (saving && saving !== 'restore' ? 'Saving…' : 'Save draft') + '</button></div></header>';
    /* Messages and conflicts stay in view, right under the header. */
    var al = '';
    /* No live role: messages are announced once, through #live (say and announce in app.js). */
    if (st.msg && !st.msg.quiet) al += '<div class="notice ' + (st.msg.kind || '') + '"><span>' + esc(st.msg.text) + '</span><span class="row">' + (st.msg.act ? '<button type="button" class="btn" data-act="' + esc(st.msg.act) + '"' + (st.msg.id ? ' data-id="' + esc(st.msg.id) + '"' : '') + '>' + esc(st.msg.label) + '</button>' : '') + '<button type="button" class="mini" data-act="dismiss">Dismiss</button></span></div>';
    if (st.folderErr) al += '<div class="notice bad" role="alert"><span><b>Can\'t read the team folder.</b> ' + esc(st.folderErr) + '</span><button type="button" class="btn" data-act="refresh">Try again</button></div>';
    if (ed && ed.conflict) al += '<div class="notice bad" role="alert"><span>' + (ed.conflict.afterWrite ? '<b>Your save was written, then replaced by another change.</b> Compare them below, then keep yours or take theirs.' : '<b>Someone else changed this draft</b> since you opened it (a teammate, or your AI assistant). Nothing was saved. Compare below, then keep yours or take theirs.') + '</span>' + (saving ? '<span class="small" role="status">Saving…</span>' : '<button class="btn stop" data-act="draft-keep-mine">Keep mine</button><button class="mini" data-act="draft-take-theirs">Take theirs</button>') + '</div>' +
      '<details open class="fpe-theirs"><summary class="small">Their version</summary><pre class="source">' + esc(ed.conflict.theirs || '(the draft was deleted)') + '</pre></details>';
    /* Who else has it open, which window is the main editor, and a proposal waiting: no live role here; messages are
       announced once, through #live. */
    al += V.editingNote(ctx, p) + V.mainNote(ctx, p);
    var waiting = ((p.proposed || {}).list || []).filter(function (x) { return x.fit === 'ready' || x.fit === 'older' || x.fit === 'already' || x.fit === 'review'; })[0];
    if (waiting) al += '<div class="notice"><span>' + (dirty ? 'Your AI assistant proposed changes while you have unsaved ones. They\'ll wait for you to review them.' : 'Your AI assistant proposed changes.') + '</span><button type="button" class="btn" data-act="prop-review" data-id="' + esc(waiting.id) + '">Review</button></div>';
    h += '<div class="fpe-alerts">' + al + '</div>';
    /* The inspector: a tablist of Selected (builder only), Checks and Preview. */
    var sl = sel && sel.kind === 'step' ? o.steps.filter(function (x) { return x.key === sel.key; })[0] : null, sp = sel && sel.kind !== 'step' ? o.phases.filter(function (x) { return x.key === sel.key; })[0] : null;
    var hl = sl ? { line: sl.line + 1 } : sp ? { phase: sp.index } : null;
    var form = builder ? V.obHoldIn(ctx, p, V.builderForm(ctx, p, text)) : '';
    var panes = {
      selected: form || '<div class="ob-nosel"><p><b>Nothing selected.</b> Choose a step, lane, phase or gate in the outline, or Checklist details, to change it here.</p>' +
        '<ul class="ob-sample" aria-hidden="true"><li class="s-ph">Phase</li><li class="s-st on">' + I('check') + 'A step, selected</li><li class="s-st">' + I('check') + 'Another step</li><li class="s-gt">Gate</li></ul></div>',
      checks: (dirty && !builder ? V.changedLines(ed.base, text) : '') + '<h2 class="fpe-ph">' + (nb ? 'Won\'t publish yet' : 'Checks') + '</h2>' + V.checkList(c) +
        '<p class="small">Saving never publishes. When it\'s ready, choose Save draft, then Review &amp; publish.</p><p class="small">The full format, every step type and its fields: <button class="link" data-act="open-types">Step types</button>. Or ask your AI assistant: <code>/flightdeck-edit-checklist</code>.</p>',
      preview: map.phases.length ? '<div class="mapview">' + V.mapPreview(map, (ctx.data.stepTypes || {}).types, p.skills, null, PF.corrections.openCounts(V.fixesOf(ctx, p)), hl) + '</div>' : '<p class="small">Add a phase to see it here.</p>'
    };
    var tabs = (builder ? [['selected', 'Selected']] : []).concat([['checks', 'Checks'], ['preview', 'Preview']]);
    var ins = V.splitter(ctx, 'ins') + '<aside class="fpe-pane fpe-ins" id="fpe-ins" aria-label="Inspector"><div class="fpe-tabs" role="tablist" aria-label="Inspector">' + tabs.map(function (t) {
      var on = t[0] === tab;
      return '<button type="button" role="tab" id="ins-t-' + t[0] + '" aria-selected="' + on + '" aria-controls="ins-p-' + t[0] + '" tabindex="' + (on ? 0 : -1) + '" data-act="ins-tab" data-id="' + t[0] + '">' + t[1] + (t[0] === 'checks' && count ? ' <span class="cnt' + (nb ? ' bad' : '') + '">' + count + '</span>' : '') + '</button>';
    }).join('') + '</div>' + tabs.map(function (t) { return '<div class="fpe-tabpanel" role="tabpanel" id="ins-p-' + t[0] + '" aria-labelledby="ins-t-' + t[0] + '" tabindex="0"' + (t[0] === tab ? '' : ' hidden') + '>' + panes[t[0]] + '</div>'; }).join('') + '</aside>';
    if (builder) h += '<div class="fpe-panes' + (st.partsRail ? ' rail' : '') + '"' + V.paneAttr(ctx, ['parts', 'ins']) + '>' + V.obPartsPane(ctx, p) + V.splitter(ctx, 'parts') + '<section class="fpe-pane fpe-outline" id="ob-outline" aria-label="Outline">' + V.obHoldIn(ctx, p, V.builder(ctx, p, text)) + '</section>' + ins + '</div>';
    else h += '<div class="fpe-panes md"' + V.paneAttr(ctx, ['ins']) + '><section class="fpe-pane fpe-md" aria-label="Markdown">' + mdCorrections(ctx, p, text) + '<label class="sr" for="draft-editor">Checklist Markdown</label><textarea id="draft-editor" data-draft-kept class="code-editor" spellcheck="false" data-bound>\n' + esc(text) + '</textarea></section>' + ins + '</div>';
    return h + '</div>';
  }

  /* The draft's save state in words, shared by the editor's header and the practice run screen. */
  function draftStatus(ctx, p, ed, text) {
    var st = ctx.state, dirty = ed && ed.text != null && ed.text !== ed.base || st.obPending === p.id, saving = (st.draftSaving || {})[ctx.fsKey + '\n' + p.id];
    return saving === 'restore' ? 'Restoring…' : saving ? 'Saving…' : ed && ed.conflict ? 'Not saved: someone else changed it' : dirty ? 'Unsaved: Save draft before you publish' : p.draft ? (st.fs && st.fs.volatile ? 'Saved in this tab only' : 'Saved') : 'New draft, from ' + (p.latest ? 'v' + p.latest.info.version : 'scratch');
  }
  /* Open corrections, listed above the Markdown with the line each step starts on (the builder marks its rows instead). */
  function mdCorrections(ctx, p, text) {
    var C = PF.corrections, open = V.fixesOf(ctx, p).filter(function (g) { return g.status === 'open'; });
    if (!open.length) return '';
    var o = PF.outline.parse(text), on = !ctx.state.disc || ctx.state.disc['md-corr'] !== false;
    return '<details class="md-corr" data-disc="md-corr"' + (on ? ' open' : '') + '><summary class="small">Open corrections · ' + open.length + '</summary><ul class="small">' + open.map(function (g) {
      var s = g.target.step && o.steps.filter(function (x) { return x.id === g.target.step; })[0], ph = !s && (g.target.gate ? o.phases.filter(function (x) { return x.gate && x.gate.id === g.target.gate; })[0] : g.target.phase && o.phases.filter(function (x) { return x.id === g.target.phase; })[0]);
      var at = s ? s.line : ph && g.target.gate ? ph.gate.line : ph ? ph.line : -1, name = s ? s.text : ph && g.target.gate ? 'Gate: ' + ph.gate.title : ph ? 'Phase: ' + ph.title : C.targetName(g);
      return '<li><span class="md-corr-t">' + esc(C.OP_LABEL[g.change.op]) + ': ' + esc(name) + '</span>' + (at >= 0 ? '<button type="button" class="linkish" data-act="corr-goto-line" data-id="' + (at + 1) + '">Go to line ' + (at + 1) + '</button>' : '<span>Not in the draft</span>') + '</li>';
    }).join('') + '</ul></details>';
  }

  /* ---------- a new process ---------- */
  /* The file name a title makes: "Onboard a new hire!" → onboard-a-new-hire. */
  function fileIdOf(title) { var x = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, ''); return x; }
  /* Title first, and only Title on show: the file name is made from it and shown as it's typed (state.newProc.typed, drawn
     beside the box, never into it, so leaving with typing still asks). The rest waits under More options, opened when a file
     name is refused. A start from the same templates setup offers, or a prompt for your AI assistant. */
  function newProcess(ctx) {
    var st = ctx.state, f = st.newProc || {}, typed = f.typed || {}, tpl = f.tpl || 'blank';
    var field = function (id, label, hint, val, extra) {
      var err = f.err && f.err.box === 'np-' + id ? f.err.msg : '';
      return '<label class="field" for="np-' + id + '">' + label + (hint ? ' <span class="small">' + hint + '</span>' : '') + '<input id="np-' + id + '" maxlength="120" value="' + esc(val || '') + '"' + (extra || '') + (err ? ' aria-invalid="true" aria-describedby="ferr-np-' + id + '"' : '') + '></label>' + (err ? '<p class="ferr" id="ferr-np-' + id + '" role="alert">' + esc(err) + '</p>' : '');
    };
    var people = PF.people.sorted(ctx).filter(function (p) { return !p.inactive; });
    var title = typed.title != null ? typed.title : f.title || '', ownId = typed.id != null ? typed.id : f.id || '', file = String(ownId).trim().toLowerCase() || fileIdOf(title);
    var h = notices(ctx) + '<div class="runhead"><div><div class="eyebrow">New checklist</div><h1 id="page-h" tabindex="-1">Write down how something is done</h1></div></div>' +
      '<form class="panel stack" id="new-process-form" data-scope="new-process">' +
      '<div class="np-tpls" role="group" aria-label="Start from">' + PF.setup.TEMPLATES.slice().sort(function (a, b) { return (a.id === 'blank' ? 0 : 1) - (b.id === 'blank' ? 0 : 1); }).map(function (t) { return '<button type="button" class="chipbtn" data-act="np-tpl" data-id="' + t.id + '" aria-pressed="' + (tpl === t.id) + '">' + esc(t.id === 'assistant' ? 'Ask your AI assistant' : t.title) + '</button>'; }).join('') + '</div>';
    if (tpl === 'assistant') {
      var text = PF.setup.assistantPrompt({ folder: st.fs ? st.fs.name : '', owner: st.me || '', backup: '' });
      return h + '<p class="small">Paste this to your AI assistant, opened in the team folder, with your notes or runbook. Its draft shows up in Checklists, where you publish it.</p><pre class="source" id="np-prompt" tabindex="0">' + esc(text) + '</pre>' +
        '<div class="row"><button class="btn" type="button" data-act="np-copy">' + I('copy') + 'Copy the prompt</button><span class="small" id="copy-msg" role="status"></span><button class="mini" type="button" data-act="np-cancel">Cancel</button></div></form>';
    }
    var nmOwn = PF.people.labeler(people);
    var more = (st.disc || {})['np-more'];
    h += field('title', 'Title', '', f.title, ' required aria-describedby="np-file"') +
      '<span class="small np-file" id="np-file">' + (file ? 'Saved as <code>' + esc(file) + '.md</code>' : 'The file name is made from the title.') + '</span>' +
      '<details class="np-more" data-disc="np-more"' + (more ? ' open' : '') + '><summary>More options</summary>' +
      field('id', 'File name', 'lowercase letters, numbers and dashes; it can\'t change later', f.id, ' pattern="[a-z0-9][a-z0-9\\-]*" placeholder="made from the title"') +
      '<div class="grid2">' + field('group', 'Group', 'its place in the hierarchy, like Engineering / Releases', f.group) + field('tags', 'Tags', 'comma-separated', f.tags) + '</div>' +
      '<div class="grid2">' + field('context', 'Run details', 'filled in when a run starts, like ticket, commit', f.context) + field('roles', 'Roles', 'who does what, like lead, reviewer', f.roles) + '</div>' +
      '<label class="field" for="np-owner">Owner <span class="small">keeps this checklist up to date</span><select id="np-owner">' + people.map(function (p) { return '<option value="' + esc(p.id) + '"' + ((f.owner || st.me) === p.id ? ' selected' : '') + '>' + esc(nmOwn(p)) + '</option>'; }).join('') + '</select></label>' +
      '<label class="row"><input type="checkbox" id="np-solo"' + (f.solo ? ' checked' : '') + '> Usually run by one person</label></details>';
    return h + '<div class="row"><button class="btn go" type="submit">' + I('edit') + 'Create the draft</button>' + (tpl !== 'blank' ? '<button class="btn" type="button" data-act="np-publish">' + I('play') + 'Publish v1 as it is</button>' : '') + '<button class="mini" type="button" data-act="np-cancel">Cancel</button></div></form>';
  }
  /* The starting Markdown for a new process: front matter plus one phase to fill in. */
  function starterMap(f) {
    return ['---', 'process: ' + f.id, 'title: ' + f.title, 'category: ' + (f.group.split('/').pop().trim() || 'Other'), f.group ? 'group: ' + f.group : null, f.tags ? 'tags: ' + f.tags : null,
      'owner: ' + f.owner, f.context ? 'context: ' + f.context : null, f.roles ? 'roles: ' + f.roles : null, f.solo ? 'runs: solo' : null, '---', '',
      '## First phase · READ-DO {#first}', ''].filter(function (x) { return x !== null; }).join('\n');
  }

  /* ---------- step types ---------- */
  var KIND_HELP = { text: 'a line of text', url: 'a web link', code: 'a command or code', message: 'a message to post', list: 'choices, separated by commas', choice: 'one of fixed options' };
  /* One line per type: what it's for, where it's used, one action. What it asks for stays folded until someone wants it. */
  function typeCard(st, t, team, uses) {
    var fields = Object.keys(t.fields || {}), rec = t.record || [], key = 'type:' + t.id;
    var open = st.disc && st.disc[key];
    var list = function (items) { return items.length ? '<ul class="small">' + items.join('') + '</ul>' : '<div class="small">Nothing.</div>'; };
    return '<li class="tcard"><div class="row between"><span>' + I(t.icon || 'check') + ' <b>' + esc(T.nameOf(t)) + '</b>' + (team ? ' <span class="pill open">team</span>' : '') + K.tagChips(T.tagsOf(t)) + '</span>' +
      '<span class="row"><span class="small">' + (uses ? 'in ' + uses + ' checklist' + (uses === 1 ? '' : 's') : 'not used yet') + '</span>' + (team ? '<button class="mini" data-act="edit-type" data-id="' + esc(t.id) + '">' + I('edit') + 'Edit</button>' : '<button class="mini" data-act="copy-type" data-id="' + esc(t.id) + '">Copy to a team type</button>') + '</span></div>' +
      (t.hint ? '<div class="small">' + esc(t.hint) + '</div>' : '') +
      '<details data-disc="' + esc(key) + '"' + (open ? ' open' : '') + '><summary class="small">What it asks for</summary><p class="small">In a checklist: <code>{' + esc(t.id) + '}</code></p><div class="tcols">' +
      '<div><div class="small"><b>In the checklist</b></div>' + list(fields.map(function (f) { var d = t.fields[f]; return '<li><code>' + esc(f) + '</code> ' + esc(d.label) + ' · ' + esc(d.kind) + (d.required ? ', usually filled in' : '') + (d.requiredWhen ? ', when ' + esc(JSON.stringify(d.requiredWhen).replace(/[{}"]/g, '')) : '') + (d.options ? ': ' + esc(d.options.join(' / ')) : '') + '</li>'; })) + '</div>' +
      '<div><div class="small"><b>When it\'s checked</b></div>' + list(rec.map(function (d) { return '<li><code>' + esc(d.name) + '</code> ' + esc(d.label) + ' · ' + esc(d.kind) + (d.options ? ': ' + esc(d.options.join(' / ')) : '') + (d.when ? ', when ' + esc(JSON.stringify(d.when).replace(/[{}"]/g, '')) : '') + '</li>'; })) + '</div></div></details></li>';
  }
  function types(ctx) {
    var st = ctx.state, team = (ctx.data.stepTypes || {}).types || {}, errs = (ctx.data.stepTypes || {}).errors || [];
    var uses = function (id) { return ctx.processes().filter(function (p) { return p.latest && M.usedTypes(p.latest.map).indexOf(id) >= 0; }).length; };
    if (st.typeForm && st.typeForm.fsKey === ctx.fsKey) return typeForm(ctx);
    var h = notices(ctx) + '<div class="runhead"><div><div class="eyebrow">Library</div><h1 id="page-h" tabindex="-1">Step types</h1><div class="small">A step\'s type decides what it asks for. Add your own for tools the built-ins don\'t cover.</div></div><div class="row"><button class="btn go" data-act="new-type">' + I('edit') + 'New step type</button></div></div>';
    if (errs.length) h += '<div class="notice warn"><span>' + errs.map(function (e) { return 'step-types/' + esc(e.file) + ': ' + esc(e.errors.join('; ')); }).join('<br>') + '</span></div>';
    var skipped = (ctx.data.stepTypes || {}).skipped || 0;
    if (skipped) h += '<div class="notice warn" role="status"><span><b>' + skipped + ' more step-type file' + (skipped === 1 ? ' wasn\'t' : 's weren\'t') + ' read.</b> Flightdeck reads the first 100 in <code>step-types/</code>, by name. Remove types nobody uses.</span><button class="mini" data-act="health">Folder health</button></div>';
    /* Organized like processes and skills: a tag filter, then each list as a tree by group. */
    var teamTypes = Object.keys(team).sort().map(function (id) { return team[id]; }), chosen = st.tags || [];
    var allT = chosen.slice(); teamTypes.forEach(function (t) { T.tagsOf(t).forEach(function (x) { if (allT.indexOf(x) < 0) allT.push(x); }); }); allT.sort();
    var has = function (t) { var tg = T.tagsOf(t); return chosen.every(function (c) { return tg.indexOf(c) >= 0; }); };
    var shownTeam = teamTypes.filter(has), shownBuilt = T.LIST.filter(has);
    h += K.tagBar(allT, chosen, st.disc, st);
    h += '<section class="panel"><h2>Your team\'s types · ' + teamTypes.length + '</h2>' + (teamTypes.length ? (shownTeam.length ? K.tree(shownTeam, T.groupOf, function (t) { return typeCard(st, t, true, uses(t.id)); }, st.groupsOpen) : '<p class="small">None with these tags.</p>') : '<p class="small">None yet. Choose <b>New step type</b>, or copy a built-in below.</p>') + '</section>';
    /* The built-ins are a reference: one closed line, open once opened (or while a tag filter is on). */
    if (shownBuilt.length) h += '<details class="panel fold" data-disc="types-built"' + ((st.disc || {})['types-built'] || chosen.length ? ' open' : '') + '><summary><h2>Built-in types · ' + T.LIST.length + '</h2></summary>' + K.tree(shownBuilt, T.groupOf, function (t) { return typeCard(st, t, false, uses(t.id)); }, st.groupsOpen) + '</details>';
    return h;
  }
  /* ---------- the step-type editor: a full page with a slim header, the form on the left and a live preview on the right ---------- */
  var KIND_NAMES = { text: 'Text', url: 'Link', code: 'Code or command', message: 'Message', list: 'List', choice: 'Choice', number: 'Number', 'yes-no': 'Yes/no', date: 'Date' };
  var REC_HELP = { text: 'a line of text, or a box for more', url: 'a web link', choice: 'one of fixed options', number: 'a number, like 12 or 3.5', 'yes-no': 'yes or no', date: 'a calendar date' };
  /* Evidence kinds: number, yes/no and date (2.0) come after the ones every Flightdeck reads. */
  var REC_KINDS = ['text', 'url', 'choice', 'number', 'yes-no', 'date'];
  function uses2(d) { return d.record.some(function (r) { return r.name && PF.values.isNew(r.kind); }); }
  var ICON_NAMES = { check: 'Check', chat: 'Message', people: 'People', fork: 'Decision', doc: 'Document', hourglass: 'Wait', cursor: 'Click', gear: 'Settings', merge: 'Merge', ticket: 'Ticket', terminal: 'Command', script: 'Script', spark: 'Spark', pipeline: 'Pipeline', nest: 'Nested' };
  var SAMPLE = { text: '…', url: 'https://…', code: 'make deploy', message: 'Text to post', list: 'one, two' };
  /* IDs and field names made from what people type: "Change request" → change.request, "Ticket link" → ticket-link. */
  function slugId(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).join('.').replace(/^[^a-z]+/, '').slice(0, 40).replace(/[.-]+$/, ''); }
  function slugName(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 30).replace(/-+$/, ''); }
  function optsOf(r) { return String(r.options || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function tagsOfDef(d) { return String(d.tags || '').split(',').map(function (x) { return x.trim().replace(/^#/, ''); }).filter(Boolean); }
  function cap1(t) { t = String(t); return t.charAt(0).toUpperCase() + t.slice(1); }
  /* The folder's checks speak in file terms ("label" must be…); the editor says the same in the words on screen. */
  function plain(e) {
    if (/^"label"/.test(e)) return 'Give it a label of up to 40 characters.';
    if (/^"id" must be/.test(e)) return 'The ID can use lowercase letters, numbers, dashes and dots, like change.request.';
    if (/is a built-in type/.test(e)) return cap1(e.replace(/; choose another id$/, '')) + '. Change the ID.';
    if (/^"hint"/.test(e)) return 'Keep "What it\'s for" to 120 characters.';
    if (/^"group"/.test(e)) return 'Keep the group to 80 characters.';
    if (/^"tags"/.test(e)) return 'Use up to 10 short tags.';
    if (/^(field "[^"]*"|record \d+): label must be/.test(e)) return 'Give it a label of up to 40 characters.';
    if (/^(field "[^"]*"|record \d+): a choice needs/.test(e)) return 'Add at least one option.';
    if (/^field "[^"]*": names are/.test(e)) return 'The name can use letters, numbers and dashes, and can\'t be a name every step already has.';
    if (/^record \d+: "name" must be/.test(e)) return 'The name can use letters, numbers and dashes, starting with a letter.';
    return cap1(e);
  }
  /* One short line near Save: what stops it, in plain words. */
  /* Which field or evidence a problem is about, for the line near Save (next to its box, the place says it). */
  function where(e) { var m = /^field "([^"]*)"/.exec(e) || /^record "([^"]*)"/.exec(e); if (m) return (/^field/.test(e) ? 'the field ' : 'the evidence ') + (m[1] ? '"' + m[1] + '"' : 'without a name'); m = /^record (\d+):/.exec(e); return m ? 'evidence ' + m[1] : ''; }
  function saveWhy(d, errs) {
    if (!errs.length) return '';
    var first = !String(d.label || '').trim() ? 'Add a label to save.' : !String(d.id || '').trim() ? 'Add an ID to save.' : (where(errs[0]) ? 'To save, fix ' + where(errs[0]) + ': ' + plain(errs[0]).charAt(0).toLowerCase() + plain(errs[0]).slice(1) : 'To save: ' + plain(errs[0]));
    return first + (errs.length > 1 ? ' ' + (errs.length - 1) + ' more to fix below.' : '');
  }
  function typeForm(ctx) {
    var st = ctx.state, f = st.typeForm, d = f.def, errs = formErrors(d), at = errorTargets(d, errs), tried = !!f.tried, disc = st.disc || {}, now = ctx.now();
    var changed = V.typeFormSnapshot(d) !== f.initial;
    /* A missing value is said near Save; next to its box only once Save was tried. A wrong value is said right away. */
    var shown = function (id, has) { return (at[id] || []).length && (tried || has) ? at[id] : []; };
    /* An ID still made from an empty label isn't a second problem: adding the label fixes both. */
    if (!f.existing && !d.idSet && !String(d.label || '').trim()) delete at['tf-id'];
    var errHtml = function (id, has) { return shown(id, has).map(function (n) { return '<p class="ferr" id="tf-err-' + n + '">' + esc(plain(errs[n])) + '</p>'; }).join(''); };
    var describe = function (id, has, help) { var e = shown(id, has).map(function (n) { return 'tf-err-' + n; }); if (help) e.push(id + '-help'); return (shown(id, has).length ? ' aria-invalid="true"' : '') + (e.length ? ' aria-describedby="' + e.join(' ') + '"' : ''); };
    var attrs = function (id, has, help) { return ' data-bound' + describe(id, has, help); };
    var field = function (id, label, control, help, has) { return '<div class="tf-field"><label for="' + id + '">' + label + '</label>' + control + errHtml(id, has) + (help ? '<p class="tf-help" id="' + id + '-help">' + help + '</p>' : '') + '</div>'; };
    /* What just changed glows for a moment in the preview and in its row (not with reduced motion). */
    var flash = function (item) { return f.flash && now - f.flash.at < 1500 && f.flash.items.indexOf(item) >= 0 ? ' flash' : ''; };
    var team = (ctx.data.stepTypes || {}).types || {}, groups = [], tagsAll = [];
    Object.keys(team).forEach(function (k) { var t = team[k], g = (t.group || []).join(' / '); if (g && groups.indexOf(g) < 0) groups.push(g); (t.tags || []).forEach(function (x) { if (tagsAll.indexOf(x) < 0) tagsAll.push(x); }); });
    var name = String(d.label || '').trim() || (f.existing ? '{' + f.existing + '}' : 'New step type');

    /* The header, as in the draft editor: who it is | Undo, Redo, History, Preview | whether it's saved, and Save. */
    var why = saveWhy(d, errs.filter(function (e) { return at['tf-id'] || !/^"id"/.test(e); }));
    var just = !changed && f.justSaved && now - f.justSaved < 4000;
    var status = f.saving ? 'Saving…' : changed ? 'Unsaved changes' : f.existing ? (st.fs && st.fs.volatile ? 'Saved in this tab only' : 'Saved') : 'Not saved yet';
    /* On a phone the preview opens as a dialog over the form: everything behind it is inert until it closes. */
    var modal = !!st.tfPreview, behind = modal ? ' inert' : '';
    var h = '<div class="fpe fpe-type" id="tfe"><header class="fpe-head" role="region" aria-labelledby="tf-h"' + behind + '>' +
      '<div class="fpe-id"><button type="button" class="btn fpe-done" data-act="type-done">' + I('back') + 'Done</button><div class="fpe-title"><h1 id="tf-h" tabindex="-1">' + esc(name) + ' <span class="cat">Step type</span></h1></div></div>' +
      '<div class="fpe-tools">' + V.undoBar('type', f.tl) + '<button type="button" class="mini tf-prevbtn" data-act="tf-preview" aria-expanded="' + !!st.tfPreview + '" aria-controls="tf-preview">' + I('screen') + 'Preview</button></div>' +
      '<div class="fpe-save"><span class="fpe-state' + (changed ? ' dirty' : '') + (just ? ' just' : '') + '" role="status">' + (f.existing && !changed && !f.saving ? I('check') : '') + status + '</span>' +
      '<button class="btn go" type="submit" form="type-form"' + (f.saving ? ' disabled' : '') + (why ? ' aria-describedby="tf-save-why"' : '') + '>' + (f.saving ? 'Saving…' : 'Save step type') + '</button></div></header>';
    /* Messages stay in view under the header. The top bar is hidden here, so its "choose who you are" note isn't shown. */
    var al = (why ? '<p class="tf-why" id="tf-save-why">' + esc(why) + '</p>' : '');
    if (st.msg) al += '<div class="notice ' + (st.msg.kind || '') + '" role="status"><span>' + esc(st.msg.text) + '</span><span class="row">' + (st.msg.act ? '<button type="button" class="btn" data-act="' + esc(st.msg.act) + '"' + (st.msg.id ? ' data-id="' + esc(st.msg.id) + '"' : '') + '>' + esc(st.msg.label) + '</button>' : '') + '<button type="button" class="mini" data-act="dismiss">Dismiss</button></span></div>';
    if (st.folderErr) al += '<div class="notice bad" role="alert"><span><b>Can\'t read the team folder.</b> ' + esc(st.folderErr) + '</span><button type="button" class="btn" data-act="refresh">Try again</button></div>';
    if (f.leaving) al += '<div class="notice warn" role="alert" aria-labelledby="tf-leave-h"><span id="tf-leave-h"><b>This step type has changes that aren\'t saved.</b> Save them, or leave without them.</span><span class="row"><button type="button" class="btn go" data-act="type-save">Save step type</button><button type="button" class="mini" data-act="type-cancel">Leave without saving</button><button type="button" class="mini" data-act="type-stay">Keep editing</button></span></div>';
    if (f.conflict) al += '<div class="notice bad" role="alert"><span><b>Someone else changed this step type</b> since you opened it. Nothing was saved. Compare, then keep yours or take theirs.</span>' + (f.saving ? '<span class="small" role="status">Saving…</span>' : '<button class="btn stop" type="button" data-act="type-keep-mine">Keep mine</button><button class="mini" type="button" data-act="type-take-theirs">Take theirs</button>') + '</div>' +
      '<details open class="fpe-theirs"><summary class="small">Their version</summary><pre class="source">' + esc(f.conflict.theirs == null ? '(the file was deleted)' : f.conflict.theirs) + '</pre></details>';
    h += '<div class="fpe-alerts"' + behind + '>' + al + '</div>';

    /* Basics: what people call it, the ID made from it, what it's for and its icon. Group and tags fold into Organize. */
    var idPart;
    if (f.existing) idPart = '<div class="tf-idrow"><span class="tf-lab">ID</span><code class="tf-idtok">{' + esc(f.existing) + '}</code><span class="tf-help">Fixed once saved, so checklists keep finding it.</span></div>';
    else if (d.idSet || f.idEdit) idPart = field('tf-id', 'ID', '<input id="tf-id" maxlength="40" spellcheck="false" class="mono" value="' + esc(d.id) + '"' + attrs('tf-id', !!d.id, true) + '>', 'Lowercase letters, numbers, dashes and dots, like change.request. Checklists name the type with it.', !!d.id);
    else idPart = '<div class="tf-idrow"><span class="tf-lab" id="tf-id-l">ID</span><code class="tf-idtok' + flash('type:label') + '">{' + esc(d.id || 'made from the label') + '}</code><button type="button" class="linkish" data-act="tf-id-edit" aria-describedby="tf-id-l">Change</button>' + errHtml('tf-id', !!d.id) + '</div>';
    var tags = tagsOfDef(d), tagErr = shown('tf-tags', tags.length > 0);
    var tagsPart = '<div class="tf-field"><label for="tf-tagadd">Tags</label><div class="tf-chipbox">' + (tags.length ? '<ul class="tf-chips" aria-label="Tags">' + tags.map(function (t) { return '<li class="tf-chip">#' + esc(t) + '<button type="button" data-act="tf-tag-del" data-id="' + esc(t) + '" aria-label="Remove tag ' + esc(t) + '">×</button></li>'; }).join('') + '</ul>' : '') +
      '<input id="tf-tagadd" maxlength="30" list="tf-tag-list" placeholder="Add a tag" data-enter="tf-tag-add"' + (tagErr.length ? ' aria-invalid="true"' : '') + ' aria-describedby="' + tagErr.map(function (n) { return 'tf-err-' + n; }).concat(['tf-tagadd-help']).join(' ') + '"></div><datalist id="tf-tag-list">' + tagsAll.filter(function (t) { return tags.indexOf(t) < 0; }).map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist>' +
      errHtml('tf-tags', tags.length > 0) + '<p class="tf-help" id="tf-tagadd-help">Press Enter or type a comma; it\'s also added when you leave the box. Tags filter the Step types list.</p></div>';
    var orgOpen = disc['tf-org'] || shown('tf-group', true).length || tagErr.length, orgSum = [String(d.group || '').trim()].filter(Boolean).concat(tags.map(function (t) { return '#' + t; })).join(' · ');
    h += '<div class="fpe-panes tf-panes"' + V.paneAttr(ctx, ['tf']) + '><section class="fpe-pane tf-formpane" aria-label="Step type"' + behind + '><form class="tf-form stack" id="type-form" data-scope="type-form" data-draft-kept novalidate>' +
      '<section class="panel tf-card" aria-labelledby="tf-basics-h"><h2 id="tf-basics-h">Basics</h2>' +
      field('tf-label', 'What people call it', '<input id="tf-label" maxlength="40" value="' + esc(d.label) + '"' + attrs('tf-label', !!String(d.label || '').trim(), true) + '>', 'Shown on every step of this type, like Change request.', !!String(d.label || '').trim()) +
      idPart +
      field('tf-hint', 'What it\'s for', '<textarea id="tf-hint" rows="2" maxlength="120"' + attrs('tf-hint', true, true) + '>\n' + esc(d.hint) + '</textarea>', 'One line people see when they choose a type.', true) +
      '<fieldset class="tf-icons"><legend>Icon <span class="tf-iconname" aria-hidden="true">' + esc(ICON_NAMES[d.icon] || d.icon || '') + '</span></legend><div class="tf-icongrid">' + T.ICONS.map(function (ic) { return '<label class="tf-icon" title="' + esc(ICON_NAMES[ic] || ic) + '"><input type="radio" name="tf-icon" id="tf-icon-' + ic + '" value="' + ic + '"' + (d.icon === ic ? ' checked' : '') + ' data-bound>' + I(ic) + '<span class="sr">' + esc(ICON_NAMES[ic] || ic) + '</span></label>'; }).join('') + '</div></fieldset>' +
      '<details class="tf-org" data-disc="tf-org"' + (orgOpen ? ' open' : '') + '><summary><span class="tf-chev">' + I('chevron') + '</span><span class="tf-org-t">Organize</span> <span class="small">' + (orgSum ? esc(orgSum) : 'Group and tags, if you want them') + '</span></summary><div class="tf-two">' +
      field('tf-group', 'Group', '<input id="tf-group" maxlength="80" list="tf-group-list" value="' + esc(d.group || '') + '"' + attrs('tf-group', true, true) + '><datalist id="tf-group-list">' + groups.map(function (g) { return '<option value="' + esc(g) + '">'; }).join('') + '</datalist>', 'Where it sits in the list, like Releases / Approvals.', true) + tagsPart + '</div></details></section>';

    /* Fields and evidence: one card each, folded to its label with its name and type below; open one to change it. */
    var row = function (kind, list, r, i) {
      var k = r.k, key = kind + ':' + k, id = function (x) { return 'tf-' + kind + '-' + k + '-' + x; }, mine = Object.keys(at).filter(function (t) { return t.indexOf('tf-' + kind + '-' + k + '-') === 0; });
      var open = f.open === key || (tried && mine.length > 0), title = String(r.label || '').trim() || String(r.name || '').trim() || (kind === 'f' ? 'New field' : 'New evidence');
      var noun = kind === 'f' ? 'field' : 'evidence', item = (kind === 'f' ? 'field:' : 'evidence:') + k;
      var typeName = kind === 'f' ? KIND_NAMES[r.kind] || r.kind : r.kind === 'url' ? 'Link' : r.kind === 'choice' ? 'Choice' : PF.values.isNew(r.kind) ? KIND_NAMES[r.kind] : r.long ? 'Long text' : 'Text';
      var sub = (r.name ? '<code>' + esc(r.name) + '</code> · ' : '') + esc(typeName) + (r.required ? ' · usually filled in' : '');
      var c = '<li class="tf-item' + (open ? ' open' : '') + flash(item) + '" data-tf-row="' + key + '" data-scope="tf-' + kind + '-' + k + '"><div class="tf-item-bar"><span class="ob-grip" draggable="true" aria-hidden="true" title="Drag to reorder"></span>' +
        '<button type="button" class="tf-item-main" data-act="tf-open" data-id="' + key + '" aria-expanded="' + open + '" aria-controls="tf-ed-' + kind + '-' + k + '"><span class="tf-item-text"><span class="tf-item-t">' + esc(title) + '</span><span class="tf-item-sub">' + sub + '</span></span><span class="tf-chev">' + I('chevron') + '</span></button>' +
        '<span class="tf-item-tools"><button type="button" class="mini icon-btn" data-act="tf-move" data-id="' + key + '" data-dir="up" aria-label="Move ' + esc(title) + ' up"' + (i === 0 ? ' disabled' : '') + '>↑</button><button type="button" class="mini icon-btn" data-act="tf-move" data-id="' + key + '" data-dir="down" aria-label="Move ' + esc(title) + ' down"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<details class="tf-menu" data-disc="tfm-' + key + '"' + (disc['tfm-' + key] ? ' open' : '') + '><summary class="mini" aria-label="More for ' + esc(title) + '">More</summary><div class="tf-menu-list">' +
        '<button type="button" data-act="hist-open" data-id="type" data-item="' + item + '" aria-haspopup="dialog">' + I('clock') + 'History</button><button type="button" data-act="tf-remove" data-id="' + key + '">Remove ' + noun + '</button></div></details></span></div>';
      if (!open && mine.length) c += '<p class="ferr tf-item-err">' + mine.length + ' to fix. Open it to see.</p>';
      if (open) {
        var kinds = kind === 'f' ? Object.keys(KIND_HELP) : REC_KINDS, help = kind === 'f' ? KIND_HELP : REC_HELP;
        c += '<div class="tf-item-ed" id="tf-ed-' + kind + '-' + k + '"><div class="tf-two">' +
          field(id('label'), 'Label people see', '<input id="' + id('label') + '" maxlength="40" value="' + esc(r.label) + '"' + attrs(id('label'), !!r.label, false) + '>', '', !!r.label) +
          field(id('name'), kind === 'f' ? 'Name used in a checklist' : 'Name in the record', '<input id="' + id('name') + '" maxlength="30" spellcheck="false" class="mono" value="' + esc(r.name) + '"' + attrs(id('name'), !!r.name, true) + '>', kind === 'f' ? 'Written as ' + esc(r.name || 'name') + ': value. Made from the label until you change it.' : 'Made from the label until you change it.', !!r.name) + '</div>' +
          field(id('kind'), 'Type', '<select id="' + id('kind') + '"' + attrs(id('kind'), true, false) + '>' + kinds.map(function (x) { return '<option value="' + x + '"' + (r.kind === x ? ' selected' : '') + '>' + (KIND_NAMES[x] || x) + ': ' + help[x] + '</option>'; }).join('') + '</select>', '', true);
        if (r.kind === 'choice') {
          var opts = optsOf(r), oe = shown(id('optadd'), opts.length > 0);
          c += '<div class="tf-field"><label for="' + id('optadd') + '">Options</label><div class="tf-chipbox">' + (opts.length ? '<ul class="tf-chips" aria-label="Options">' + opts.map(function (o, j) { return '<li class="tf-chip">' + esc(o) + '<button type="button" data-act="tf-opt-del" data-id="' + key + ':' + j + '" aria-label="Remove option ' + esc(o) + '">×</button></li>'; }).join('') + '</ul>' : '') +
            '<input id="' + id('optadd') + '" maxlength="40" placeholder="Add an option" data-enter="tf-opt-add" data-id="' + key + '"' + (oe.length ? ' aria-invalid="true"' : '') + ' aria-describedby="' + oe.map(function (n) { return 'tf-err-' + n; }).concat([id('optadd') + '-help']).join(' ') + '"><button type="button" class="mini" data-act="tf-opt-add" data-id="' + key + '">Add</button></div>' +
            errHtml(id('optadd'), opts.length > 0) + '<p class="tf-help" id="' + id('optadd') + '-help">Press Enter after each one; it\'s also added when you leave the box. People pick one of them.</p></div>';
        }
        if (kind === 'f') c += '<label class="tf-switch"><input type="checkbox" role="switch" id="' + id('required') + '" data-bound' + (r.required ? ' checked' : '') + ' aria-describedby="' + id('required') + '-help"><span>Usually filled in</span></label><p class="tf-help" id="' + id('required') + '-help">Leaving it out is a tip in the checklist, not an error.</p>';
        else if (r.kind === 'text') c += '<label class="tf-switch"><input type="checkbox" role="switch" id="' + id('long') + '" data-bound' + (r.long ? ' checked' : '') + '><span>Long text: a bigger box for notes</span></label>';
        c += '</div>';
      }
      return c + '</li>';
    };
    var addMenu = function (kind) {
      var kinds = kind === 'f' ? Object.keys(KIND_HELP) : REC_KINDS, help = kind === 'f' ? KIND_HELP : REC_HELP, dk = 'tf-add-' + kind;
      return '<details class="tf-addmenu" data-disc="' + dk + '"' + (disc[dk] ? ' open' : '') + '><summary class="tf-addbtn">' + I('plus') + (kind === 'f' ? 'Add a field' : 'Add evidence') + '</summary><ul class="tf-addlist">' +
        kinds.map(function (x) { return '<li><button type="button" data-act="tf-add" data-id="' + kind + '" data-kind="' + x + '"><b>' + (KIND_NAMES[x] || x) + '</b><span class="small">' + help[x] + '</span></button></li>'; }).join('') + '</ul></details>' +
        (kind === 'r' && uses2(d) ? '<p class="tf-help">Number, yes/no and date evidence need Flightdeck 2.0. Teammates on an older Flightdeck see this step type as one they can\'t use until they update.</p>' : '');
    };
    var section = function (kind, list, title, help) {
      return '<section class="panel tf-card" aria-labelledby="tf-' + kind + '-h"><h2 id="tf-' + kind + '-h">' + title + '</h2><p class="tf-help">' + help + '</p>' +
        (list.length ? '<ol class="tf-items" aria-labelledby="tf-' + kind + '-h">' + list.map(function (r, i) { return row(kind, list, r, i); }).join('') + '</ol>' : '') + addMenu(kind) + '</section>';
    };
    h += section('f', d.fields, 'Fields', 'What a checklist can say about each step of this type. All are optional.');
    h += section('r', d.record, 'Evidence', 'Proof people record when they check a step of this type.');
    var json = JSON.stringify(defOf(d), null, 2);
    h += '<details class="panel tf-where" data-disc="tf-where"' + (disc['tf-where'] ? ' open' : '') + '><summary>Where this is saved</summary><p class="small">In the team folder, as <code>step-types/' + esc(d.id || '…') + '.json</code>. Checklists can use it as soon as it\'s saved. Publishing a checklist keeps a copy of this type with that version, so changing the type later never changes a version already published. Your AI assistant can read and edit the same file.</p><pre class="source">' + esc(json) + '</pre></details>';
    var leftover = errs.map(function (e, n) { return n; }).filter(function (n) { return !(/^"id"/.test(errs[n]) && !at['tf-id']) && !Object.keys(at).some(function (t) { return at[t].indexOf(n) >= 0; }); });
    if (tried && leftover.length) h += '<ul class="checks" id="tf-errs">' + leftover.map(function (n) { return '<li id="tf-err-' + n + '"><span class="lvl bad">Fix</span><span>' + esc(plain(errs[n])) + '</span></li>'; }).join('') + '</ul>';
    h += '</form></section>';

    /* The preview: a step of this type as runners see it (read-only), then as a checklist writes it. */
    var named = d.fields.filter(function (r) { return String(r.name || '').trim(); }), recs = d.record.filter(function (r) { return String(r.name || '').trim(); });
    var sample = function (r) { var o = optsOf(r); return r.kind === 'choice' ? (o[0] || '…') : SAMPLE[r.kind] || '…'; };
    var line = '- [ ] {' + (d.id || 'your.type') + '} What to do {#step-id}' + named.map(function (r) { return '\n  ' + r.name + ': ' + sample(r); }).join('') + (recs.length ? '\n  require: all' : '');
    h += V.splitter(ctx, 'tf') + '<aside class="fpe-pane tf-preview' + (modal ? ' open" id="tf-preview" role="dialog" aria-modal="true" aria-labelledby="tf-prev-h"' : '" id="tf-preview" aria-label="Preview"') + '><div class="tf-prevhead"><h2 id="tf-prev-h">Run preview</h2><button type="button" class="mini tf-prevclose" data-act="tf-preview">Close</button></div>' +
      '<p class="tf-help">How a step of this type looks in a run. It\'s a picture: nothing here can be clicked.</p>' +
      '<div class="tf-run" aria-label="Sample step"><div class="tf-run-head' + flash('type:icon') + '">' + I(d.icon || 'check') + '<b>What to do</b><span class="cat' + flash('type:label') + '">' + esc(String(d.label || '').trim() || 'Your type') + '</span></div>' +
      (d.hint ? '<p class="small tf-run-hint' + flash('type:hint') + '">' + esc(d.hint) + '</p>' : '') +
      (named.length ? '<dl class="tf-run-fields">' + named.map(function (r) { var fl = flash('field:' + r.k) ? ' class="flash"' : ''; return '<dt' + fl + '>' + esc(r.label || r.name) + '</dt><dd' + fl + '>' + esc(sample(r)) + '</dd>'; }).join('') + '</dl>' : '') +
      (recs.length ? '<div class="tf-run-ev"><div class="small"><b>When it\'s checked</b></div>' + recs.map(function (r) { return '<div class="tf-fakefield' + flash('evidence:' + r.k) + '"><span class="small">' + esc(r.label || r.name) + '</span><span class="tf-fake' + (r.long ? ' long' : '') + '">' + esc(r.kind === 'choice' ? (optsOf(r).join(' / ') || 'Choose…') : r.kind === 'url' ? 'https://…' : '') + '</span></div>'; }).join('') + '</div>' : '') +
      '<div class="row"><span class="tf-fakebtn">' + I('check') + 'Done</span></div></div>' +
      '<h3 class="tf-prevsub">As written in a checklist</h3><p class="tf-help">How you, a teammate or your AI assistant write a step of this type.</p><pre class="source">' + esc(line) + '</pre></aside></div></div>';
    return h;
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
      else if ((m = /^(field|record) "([^"]*)"(: label)?/.exec(e))) { var kind = m[1] === 'field' ? 'f' : 'r', r = rowOf(kind === 'f' ? d.fields : d.record, m[2]); if (r) add('tf-' + kind + '-' + r.k + '-' + (m[3] ? 'label' : /options|choice/.test(e) ? 'optadd' : /kind/.test(e) ? 'kind' : 'name'), n); }
      else if ((m = /^record (\d+): /.exec(e))) { var named = d.record.filter(function (r) { return r.name; }), rr = named[+m[1] - 1]; if (rr) add('tf-r-' + rr.k + '-' + (/options/.test(e) ? 'optadd' : /label/.test(e) ? 'label' : /kind/.test(e) ? 'kind' : 'name'), n); }
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
    out.record = d.record.filter(function (r) { return r.name; }).map(function (r) {
      var x = { name: r.name, label: r.label, kind: r.kind }; if (r.kind === 'choice') x.options = opts(r); if (r.long && !PF.values.isNew(r.kind)) x.long = true;
      /* A number's min, max and unit, as the file had them (the form doesn't edit them). */
      if (r.kind === 'number' && r.num) ['min', 'max', 'unit'].forEach(function (k) { if (r.num[k] != null) x[k] = r.num[k]; });
      return x;
    });
    /* A 2.0 kind makes the file a 2.0 step type; without one it stays the 1.x shape every Flightdeck reads. */
    return uses2(d) ? Object.assign({ format: 'flightdeck-step-type/2', features: ['typed-evidence'] }, out) : out;
  }
  /* A definition (from a file or a built-in) → the form's state. */
  function formOf(t, keepId) {
    return { id: keepId ? t.id : '', idSet: !!keepId, label: t.label || '', hint: t.hint || '', icon: t.icon || 'check', group: keepId && t.group ? t.group.join(' / ') : '', tags: keepId && t.tags ? t.tags.join(', ') : '',
      fields: Object.keys(t.fields || {}).map(function (n) { var x = t.fields[n], fixed = x.kind !== 'choice' || ((x.options || []).length && !x.optionsFrom); return { k: nextKey(), name: n, nameSet: true, label: x.label, kind: fixed ? x.kind : 'text', required: !!x.required, options: fixed ? (x.options || []).join('\n') : '', orig: fixed && x.options ? x.options.slice() : null }; }),
      /* A built-in choice whose options come from the step (optionsFrom) has no fixed list a team type can hold: it becomes text. */
      record: (t.record || []).map(function (r) { var fixed = r.kind === 'choice' && (r.options || []).length && !r.optionsFrom; return { k: nextKey(), name: r.name, nameSet: true, label: r.label, kind: fixed ? 'choice' : r.kind === 'url' || PF.values.isNew(r.kind) ? r.kind : 'text', long: !!r.long, options: fixed ? r.options.join('\n') : '', orig: fixed ? r.options.slice() : null, num: r.kind === 'number' ? { min: r.min, max: r.max, unit: r.unit } : null }; }) };
  }

  /* ---------- one skill: what it is, where it lives, what it follows, and whether it still matches ---------- */
  var STATUS_WORDS = {
    current: ['passed', 'In step', ''],
    unaffected: ['open', 'Note the new version', 'Copy the brief for your AI assistant to note it.'],
    update: ['failed', 'Needs an update', 'Give your AI assistant the update brief: it has the exact before and after.'],
    missing: ['failed', 'Check it', ''],
    unmatched: ['failed', 'Can\'t be matched', 'Register it again with flightdeck skill register, from the version it was built from.']
  };
  function skillPage(ctx) {
    var st = ctx.state, hit = null, proc = null;
    ctx.processes().forEach(function (p) { p.skills.forEach(function (x) { if ((x.skill.file || x.skill.name) === st.skillFile) { hit = x; proc = p; } }); });
    (ctx.orphanSkills ? ctx.orphanSkills() : []).forEach(function (x) { if ((x.skill.file || x.skill.name) === st.skillFile) hit = x; });
    if (!hit) return notices(ctx) + '<div class="panel" role="alert">That skill isn\'t registered in this folder any more. <button class="mini" id="page-back" data-act="nav" data-id="skills">Back to Skills</button></div>';
    var s = hit.skill, sw = STATUS_WORDS[hit.status.s] || STATUS_WORDS.missing, href = PF.skills.link(s.location), base = hit.status.base, latest = hit.status.latest;
    var stepText = function (id) { var f = (base || latest) && M.findStep((base || latest).map, id); return f ? K.stepPlain(f.step, null) : id; };
    var h = notices(ctx) + '<div class="runhead"><div><div class="eyebrow">Skill' + (s.version ? ' · version ' + esc(s.version) : '') + '</div><h1 id="page-h" tabindex="-1">' + I('spark') + ' ' + esc(s.name) + '</h1>' + (s.description ? '<div class="small">' + esc(s.description) + '</div>' : '') + K.tagChips(s.tags) + '</div>' +
      '<div class="row">' + (proc ? '<button class="btn" data-act="open-process" data-id="' + esc(proc.id) + '">Open ' + esc(proc.title) + '</button>' : '') + '</div></div>';
    h += '<section class="panel status-card" data-s="' + esc(hit.status.s) + '" aria-labelledby="ss-h"><h2 id="ss-h"><span class="pill ' + sw[0] + '">' + sw[1] + '</span></h2><p>' + esc(hit.status.text) + (sw[2] ? ' ' + esc(sw[2]) : '') + '</p>';
    /* What changed, 50 at a time in its own order (2.11); the update brief is built from all of it when copied. */
    if (hit.status.s === 'update' && hit.status.changes) h += K.list(st, 'sk-changes', hit.status.changes.map(function (c, i) { return { c: c, i: i }; }), { draw: function (shown) { return '<ul class="changes">' + shown.map(function (r) {
      var c = r.c, li = '<li id="skc-' + r.i + '" tabindex="-1">';
      if (c.change === 'order') return li + '<b>Order:</b> its steps now run in a different order.</li>';
      if (c.change === 'inputs') return li + '<b>What it takes:</b> ' + esc(c.what.join('; ')) + '.</li>';
      if (c.change === 'context') return li + '<b>Run details:</b> now ' + esc(c.to.join(', ') || 'none') + ' (was ' + esc(c.from.join(', ') || 'none') + ').</li>';
      return li + '<b>' + esc(K.stepPlain(c.to || c.from, null)) + '</b>: ' + ({ changed: 'changed', removed: 'removed', added: 'new' })[c.change] + '</li>';
    }).join('') + '</ul>'; }, keyOf: function (r) { return 'skc-' + r.i; }, focusOf: function (k) { return K.byId(k); } });
    if (hit.status.s === 'update' || hit.status.s === 'unaffected') h += '<div class="row"><button class="btn go" data-act="copy-brief" data-id="update:' + esc(s.file) + '">' + I('copy') + 'Copy the update brief</button></div>' + briefBoxOf(st, 'update:' + s.file);
    h += '</section>';
    h += '<section class="panel" aria-labelledby="sf-h"><h2 id="sf-h">About this skill</h2><dl class="facts">' +
      '<dt>Source</dt><dd>' + (s.location ? (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(s.location) + '</a>' : '<code>' + esc(s.location) + '</code>') : 'Not recorded') + '</dd>' +
      '<dt>Automates</dt><dd>' + (proc ? '<button class="link" data-act="open-process" data-id="' + esc(proc.id) + '">' + esc(proc.title) + '</button>, version ' + esc(s.implements) + (latest && latest.info.version !== s.implements ? ' (the process is now at v' + esc(latest.info.version) + ')' : '') : esc(s.process || '?') + '@' + esc(s.implements)) + '</dd>' +
      '<dt>Covers</dt><dd>' + (s.steps ? '<ol class="small">' + s.steps.map(function (id) { return '<li>' + esc(stepText(id)) + ' <code>' + esc(id) + '</code></li>'; }).join('') + '</ol>' : 'The whole checklist') + '</dd>' +
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
    h += ctx.canFolder ? '<div class="row"><button class="btn" data-act="connect">' + (fs && fs.kind === 'folder' ? 'Change team folder' : 'Open team folder') + '</button><button class="btn" data-act="new-folder">Start a new team</button>' + (fs && fs.kind === 'folder' && ctx.setupProgress && PF.people.canManage(d.people, st.me) && !ctx.setupProgress().complete ? '<button class="mini" data-act="setup-continue" data-id="' + esc(ctx.setupProgress().next) + '">Getting started</button>' : '') + (fs && fs.kind === 'memory' ? '<button class="mini" data-act="reset-examples">Reset examples</button>' : '') + '</div>' +
      '<p class="small">Pick a shared OneDrive folder set to <i>Always keep on this device</i>.</p>'
      : '<p class="small">This browser can\'t open folders. Use Edge or Chrome on a computer.</p>';
    h += '</section>';
    h += '<section class="panel stack" aria-labelledby="set-health"><h2 id="set-health">' + I('pulse') + 'Folder health</h2><p class="small">Conflict copies, files that can\'t be read, versions still arriving, and more, each with what to do. Then check that files travel between two computers.</p>' +
      '<div class="row"><button class="btn" data-act="health">Check folder health</button><button class="btn" data-act="connection">' + I('swap') + 'Connection check</button><button class="mini" data-act="recovery" data-id="">When something goes wrong</button></div></section>';
    h += '<section class="panel stack" aria-labelledby="set-lib"><h2 id="set-lib">Library</h2><p class="small">Skills built from your checklists, and the kinds of steps a checklist can use.</p><div class="row"><button class="btn" data-act="nav" data-id="skills">' + I('spark') + 'Skills</button><button class="btn" data-act="nav" data-id="types">Step types</button></div></section>';
    h += V.peoplePanel(ctx);
    h += V.teamValuesPanel(ctx);
    /* Jira workflows and Keyboard are rarely changed: under More settings, except that a workflow problem stays on show. */
    var jw = d.jira || { workflows: {}, errors: [] }, jbad = (jw.errors || []).length || Object.keys(jw.workflows || {}).some(function (k) { return jw.workflows[k].invalid; });
    if (jbad) h += V.teamSetup(ctx);
    var th = V.THEMES[st.theme] ? st.theme : 'system';
    h += '<section class="panel" aria-labelledby="set-look"><h2 id="set-look">Appearance</h2><div class="seg" role="group" aria-labelledby="set-look">' + ['system', 'light', 'dark'].map(function (k) { return '<button type="button" data-act="theme" data-id="' + k + '" aria-pressed="' + (th === k) + '">' + I(V.THEMES[k].icon) + V.THEMES[k].label + '</button>'; }).join('') + '</div></section>';
    h += '<details class="panel fold" data-disc="set-more"' + ((st.disc || {})['set-more'] ? ' open' : '') + '><summary><h2>More settings</h2></summary>' + (jbad ? '' : V.teamSetup(ctx)) +
      '<section aria-labelledby="set-keys"><h2 id="set-keys">Keyboard</h2><div class="row"><button class="btn" data-act="toggle-keys" aria-pressed="' + (st.keys !== false) + '">' + (st.keys !== false ? 'Single-key shortcuts are on' : 'Single-key shortcuts are off') + '</button><span class="small">Press ? anywhere to see them.</span></div></section></details>';
    h += '<section class="panel" aria-labelledby="set-about"><h2 id="set-about">About</h2><p>Flightdeck <b>' + esc(rel.version) + '</b>' + (rel.newer ? ' · <b>' + esc(rel.newer) + '</b> is in the team folder' : '') + '</p><div class="row">' + (rel.version === 'dev' ? '' : '<button class="btn" data-act="whats-new">What\'s new</button>') + '</div>' +
      '<p class="small">Install or update from a terminal: <code>npm install -g @troylar/flightdeck</code>, then <code>flightdeck install &lt;team folder&gt;</code>.</p></section>';
    return h;
  }

  var keySeq = 0;
  function nextKey() { return 'k' + (++keySeq); }
  V.settings = settings; V.skill = skillPage; V.typeErrors = formErrors; V.nextRowKey = nextKey;
  V.tabOf = tabOf; V.checklistPanel = checklistPanel; V.shownOf = shownOf; V.editTab = editTab; V.insTabOf = insTabOf; V.draftStatus = draftStatus; V.newProcess = newProcess; V.starterMap = starterMap; V.fileIdOf = fileIdOf;
  V.types = types; V.typeDefOf = defOf; V.typeFormOf = formOf; V.typeSlugs = { id: slugId, name: slugName };
  /* Everything a person can change in the form, unnamed rows included, so a half-filled row still counts as a change. */
  /* The type's own text is compared the way saving writes it (trimmed, the group and tags as the file keeps them), so a form
     just saved is never "unsaved" because of spaces the file doesn't keep. Rows are compared as typed; half-filled ones count. */
  V.typeFormSnapshot = function (d) {
    var t = function (x) { return String(x == null ? '' : x).trim(); };
    var row = function (r) { return [r.name, r.label, r.kind, String(r.options || '').replace(/\r\n?/g, '\n'), !!r.required, !!r.long]; };
    return JSON.stringify([t(d.id), t(d.label), t(d.hint), d.icon, T.groupText(d.group || ''), String(d.tags || '').split(',').map(T.tagText).filter(Boolean), d.fields.map(row), d.record.map(row)]);
  };
})();
