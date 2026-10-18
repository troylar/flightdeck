/* Built-in step types (v1). Every step has one.
   fields: written in the map, telling people what to do. Filling them in is optional: a step can name only what's known,
     and the recorder can fill in or correct values for one run as they become known.
   record: evidence that can be noted when the step is checked. Optional unless the map's "require:" line asks for it,
     so ordinary steps check in one click and strict processes (a release) can insist on a build number or a PR link. */
PF.types = (function () {
  'use strict';
  var VERSION = 2;

  /* Map fields every type accepts. */
  var COMMON = {
    link: { label: 'Link', kind: 'url' },
    expect: { label: 'Usually takes', kind: 'duration' },
    deadline: { label: 'Deadline', kind: 'deadline' },
    evidence: { label: 'Evidence needed', kind: 'choice', options: ['link', 'note'] },
    require: { label: 'Required when checked', kind: 'require' },
    /* Schedule: clock times on the run's day, or a duration after the run starts. */
    at: { label: 'At', kind: 'time' },
    due: { label: 'Due by', kind: 'time' },
    after: { label: 'Due after start', kind: 'duration' },
    /* Run details this step produces (a release tag, say): checking it asks for them, and later ^details use them. */
    sets: { label: 'Sets run details', kind: 'sets' }
  };
  /* Map fields that shape the step rather than describe it, so a run can't change them. */
  var FIXED = { expect: 1, deadline: 1, evidence: 1, require: 1, sets: 1 };
  /* Record fields added when the map asks for evidence. */
  var EVIDENCE = {
    link: { name: 'evidence', label: 'Link to the evidence', kind: 'url', required: true },
    note: { name: 'evidence', label: 'What you saw', kind: 'text', long: true, required: true }
  };

  var LIST = [
    { id: 'confirm', label: 'Confirm', icon: 'check', hint: 'Check that something is true.',
      fields: { where: { label: 'Where to check', kind: 'text' }, looks: { label: 'True when', kind: 'text' } },
      record: [] },
    { id: 'communicate', label: 'Communicate', icon: 'chat', hint: 'Tell people something.',
      fields: { channel: { label: 'Channel', kind: 'text', required: true }, audience: { label: 'Audience', kind: 'text' }, message: { label: 'Message', kind: 'message' } },
      record: [{ name: 'sent', label: 'Link to the message', kind: 'url' }] },
    { id: 'meeting', label: 'Meeting', icon: 'people', hint: 'A scheduled conversation.',
      fields: { attendees: { label: 'Attendees', kind: 'text' }, agenda: { label: 'Agenda', kind: 'url' }, join: { label: 'Join', kind: 'url' }, outcome: { label: 'Leave with', kind: 'text' } },
      record: [{ name: 'outcome', label: 'Outcome', kind: 'text', long: true }] },
    { id: 'decide', label: 'Decide', icon: 'fork', hint: 'A go/no-go or a choice.',
      fields: { options: { label: 'Options', kind: 'list', required: true }, decider: { label: 'Who decides', kind: 'text' }, criteria: { label: 'Decide on', kind: 'text' } },
      record: [{ name: 'decision', label: 'Decision', kind: 'choice', optionsFrom: 'options' }, { name: 'why', label: 'Why', kind: 'text', long: true }] },
    { id: 'review', label: 'Review', icon: 'doc', hint: 'Read or approve a document.',
      fields: { document: { label: 'Document', kind: 'url', required: true }, focus: { label: 'Look for', kind: 'text' } },
      record: [{ name: 'verdict', label: 'Verdict', kind: 'choice', options: ['Approved', 'Approved with comments', 'Changes needed'] }, { name: 'comments', label: 'Link to comments', kind: 'url' }] },
    { id: 'wait', label: 'Wait', icon: 'hourglass', hint: 'Waiting on someone or something outside the team.',
      fields: { for: { label: 'Waiting for', kind: 'text', required: true }, contact: { label: 'Who to chase', kind: 'text' } },
      record: [{ name: 'arrived', label: 'What arrived', kind: 'text', long: true }] },
    { id: 'ui.action', label: 'Do in a tool', icon: 'cursor', hint: 'Do something by hand in a web tool.',
      fields: { system: { label: 'Tool', kind: 'text', required: true }, page: { label: 'Page', kind: 'url' } },
      record: [{ name: 'reference', label: 'Reference (ID or link)', kind: 'text' }] },
    { id: 'jenkins.job', label: 'Jenkins job', icon: 'gear', hint: 'Start or follow a Jenkins job by hand.',
      fields: { job: { label: 'Job', kind: 'text', required: true }, page: { label: 'Job page', kind: 'url' }, parameters: { label: 'Parameters', kind: 'code' }, stage: { label: 'Watch for', kind: 'text' } },
      record: [{ name: 'build', label: 'Build number', kind: 'text' }, { name: 'buildLink', label: 'Build link', kind: 'url' }] },
    { id: 'bitbucket.pr', label: 'Pull request', icon: 'merge', hint: 'Open, review or merge a Bitbucket pull request.',
      fields: { action: { label: 'Action', kind: 'choice', options: ['open', 'review', 'merge'], required: true }, repo: { label: 'Repository', kind: 'text', required: true }, from: { label: 'From branch', kind: 'text' }, to: { label: 'Into branch', kind: 'text' } },
      record: [{ name: 'pr', label: 'Pull request link', kind: 'url' }, { name: 'mergeCommit', label: 'Merge commit', kind: 'text', when: { action: 'merge' } }] },
    { id: 'jira.issue', label: 'Jira', icon: 'ticket', hint: 'Create or change a Jira issue by hand.',
      fields: { action: { label: 'Action', kind: 'choice', options: ['create', 'update', 'transition', 'assign', 'link'], required: true }, issue: { label: 'Issue', kind: 'text', requiredUnless: { action: 'create' } },
        project: { label: 'Project', kind: 'text', requiredWhen: { action: 'create' } }, issueType: { label: 'Issue type', kind: 'text' }, status: { label: 'Move to', kind: 'text', requiredWhen: { action: 'transition' } },
        assignee: { label: 'Assign to', kind: 'text', requiredWhen: { action: 'assign' } }, linkTo: { label: 'Link to', kind: 'text', requiredWhen: { action: 'link' } }, set: { label: 'Fields to set', kind: 'text' } },
      record: [{ name: 'key', label: 'Issue key', kind: 'text', when: { action: 'create' } }] },
    { id: 'run.process', label: 'Run another process', icon: 'nest', hint: 'Start a linked run of another process; this step is done when it completes.',
      fields: { process: { label: 'Process', kind: 'text', required: true }, carry: { label: 'Details passed on', kind: 'text' } },
      record: [] },
    { id: 'run.command', label: 'Run a command', icon: 'terminal', hint: 'Shown as text to copy. Flightdeck never runs it.',
      fields: { command: { label: 'Command', kind: 'code', required: true }, where: { label: 'Where', kind: 'text' }, expected: { label: 'Expected result', kind: 'text' } },
      record: [{ name: 'result', label: 'What you saw', kind: 'text', long: true }] },
    { id: 'run.script', label: 'Run a script', icon: 'script', hint: 'Shown as text to copy. Flightdeck never runs it.',
      fields: { script: { label: 'Script', kind: 'code', required: true }, args: { label: 'Arguments', kind: 'code' }, where: { label: 'Where', kind: 'text' }, expected: { label: 'Expected result', kind: 'text' } },
      record: [{ name: 'result', label: 'What you saw', kind: 'text', long: true }] },
    { id: 'run.skill', label: 'Run a skill', icon: 'spark', hint: 'Run a skill.',
      fields: { skill: { label: 'Skill', kind: 'text', required: true }, inputs: { label: 'Inputs', kind: 'text' }, expected: { label: 'Expected result', kind: 'text' } },
      record: [{ name: 'output', label: 'Link to the output', kind: 'url' }] },
    { id: 'ci.gate', label: 'Pipeline result', icon: 'pipeline', hint: 'A build or test result for a specific commit.',
      fields: { pipeline: { label: 'Pipeline', kind: 'text', required: true }, page: { label: 'Pipeline page', kind: 'url' } },
      record: [{ name: 'run', label: 'Run number', kind: 'text' }, { name: 'runLink', label: 'Run link', kind: 'url' }] }
  ];

  var BY = {};
  LIST.forEach(function (t) { t.version = VERSION; BY[t.id] = t; });

  /* Own entries only: a step typed {constructor} or {toString} must not find something every object inherits. */
  function own(o, k) { return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) && o[k] && typeof o[k] === 'object' ? o[k] : null; }
  function get(id, frozen) { return own(frozen, id) || own(BY, id); }

  /* ---- Team step types: step-types/<id>.json in the team folder. Checked as strictly as a map, so a bad file never reaches a run. ---- */
  var FIELD_KINDS = { text: 1, url: 1, code: 1, message: 1, list: 1, choice: 1 }, RECORD_KINDS = { text: 1, url: 1, choice: 1 };
  var NAME = /^[a-zA-Z][\w-]{0,29}$/;
  function checkCustom(def) {
    var errs = [];
    if (!def || typeof def !== 'object') return ['must be a JSON object'];
    if (typeof def.id !== 'string' || !/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/.test(def.id) || def.id.length > 40) errs.push('"id" must be lowercase letters, numbers, dashes and dots, like "change.request"');
    else if (BY[def.id]) errs.push('"' + def.id + '" is a built-in type; choose another id');
    if (typeof def.label !== 'string' || !def.label.trim() || def.label.length > 40) errs.push('"label" must be 1-40 characters');
    if (def.hint != null && (typeof def.hint !== 'string' || def.hint.length > 120)) errs.push('"hint" must be at most 120 characters');
    var extra = Object.keys(def).filter(function (k) { return ['id', 'label', 'hint', 'icon', 'fields', 'record', 'group', 'tags'].indexOf(k) < 0; });
    /* Checked as the app writes them (levels joined with " / ", tags without "#"), so opening and saving never changes validity. */
    if (def.group != null && (typeof def.group !== 'string' || groupText(def.group).length > 80)) errs.push('"group" must be text of at most 80 characters, like "Releases / Approvals"');
    if (def.tags != null && (!Array.isArray(def.tags) || def.tags.length > 10 || def.tags.some(function (t) { return typeof t !== 'string' || !tagText(t) || tagText(t).length > 30 || /,/.test(t); }))) errs.push('"tags" must be a list of up to 10 short words, without commas');
    if (extra.length) errs.push('unknown field(s): ' + extra.join(', '));
    var fields = def.fields || {};
    if (typeof fields !== 'object' || Array.isArray(fields)) errs.push('"fields" must be an object of field definitions');
    else Object.keys(fields).forEach(function (f) {
      var d = fields[f];
      if (!NAME.test(f) || COMMON[f]) errs.push('field "' + f + '": names are letters, numbers and dashes, and can\'t reuse ' + Object.keys(COMMON).join(', '));
      if (!d || !FIELD_KINDS[d.kind]) errs.push('field "' + f + '": kind must be one of ' + Object.keys(FIELD_KINDS).join(', '));
      if (d && (typeof d.label !== 'string' || !d.label || d.label.length > 40)) errs.push('field "' + f + '": label must be 1-40 characters');
      if (d && d.options != null && d.kind !== 'choice') errs.push('field "' + f + '": only a choice has "options"');
      if (d && d.kind === 'choice' && (!Array.isArray(d.options) || !d.options.length || d.options.some(function (o) { return typeof o !== 'string' || !o || o.length > 40; }))) errs.push('field "' + f + '": a choice needs "options", a list of short texts');
    });
    var rec = def.record || [], seenRec = Object.create(null);
    if (Array.isArray(rec) && rec.length > 20) errs.push('"record" lists ' + rec.length + ' kinds of evidence; the most a step type can record is 20');
    if (typeof fields === 'object' && fields && Object.keys(fields).length > 30) errs.push('"fields" has ' + Object.keys(fields).length + ' fields; the most a step type can have is 30');
    if (Array.isArray(rec)) rec.forEach(function (d) {
      var n = d && String(d.name || '').toLowerCase();
      if (!n) return;
      if (seenRec[n]) errs.push('record "' + d.name + '" is listed twice; give each kind of evidence its own name');
      if (/^(jf|rd)-/.test(n)) errs.push('record "' + d.name + '": names starting with "jf-" are kept for Jira fields');
      if (n === 'evidence' || n === '__proto__' || n in Object.prototype || String(d.name) in Object.prototype) errs.push('record "' + d.name + '": that name is kept for Flightdeck; choose another');
      seenRec[n] = 1;
    });
    if (!Array.isArray(rec)) errs.push('"record" must be a list');
    else rec.forEach(function (d, i) {
      if (!d || !NAME.test(d.name)) errs.push('record ' + (i + 1) + ': "name" must be letters, numbers and dashes');
      if (!d || !RECORD_KINDS[d.kind]) errs.push('record ' + (i + 1) + ': kind must be one of ' + Object.keys(RECORD_KINDS).join(', '));
      if (d && (typeof d.label !== 'string' || !d.label || d.label.length > 40)) errs.push('record ' + (i + 1) + ': label must be 1-40 characters');
      if (d && d.options != null && d.kind !== 'choice') errs.push('record ' + (i + 1) + ': only a choice has "options"');
      if (d && d.kind === 'choice' && (!Array.isArray(d.options) || !d.options.length || d.options.some(function (o) { return typeof o !== 'string' || !o || o.length > 40; }))) errs.push('record ' + (i + 1) + ': a choice needs "options", a list of short names');
    });
    return errs;
  }
  /* A checked team type, in the same shape as a built-in. */
  function groupText(g) { return String(g).split('/').map(function (x) { return x.trim(); }).filter(Boolean).join(' / '); }
  function tagText(t) { return String(t).replace(/^[#\s]+/, '').trim().toLowerCase(); }
  function customType(def) {
    var fields = {};
    Object.keys(def.fields || {}).forEach(function (f) { var d = def.fields[f]; fields[f] = { label: d.label, kind: d.kind, required: d.required === true }; if (d.options) fields[f].options = d.options.map(String); });
    var group = typeof def.group === 'string' ? groupText(def.group).split(' / ').filter(Boolean) : [];
    var tags = Array.isArray(def.tags) ? def.tags.map(tagText).filter(Boolean) : [];
    return { id: def.id, label: def.label, icon: ICONS_OK.indexOf(def.icon) >= 0 ? def.icon : 'check', hint: def.hint || '', fields: fields, version: VERSION, custom: true, group: group, tags: tags,
      record: (def.record || []).map(function (d) { var c = { name: d.name, label: d.label, kind: d.kind }; if (d.options) c.options = d.options.map(String); if (d.long) c.long = true; return c; }) };
  }
  var ICONS_OK = ['check', 'chat', 'people', 'fork', 'doc', 'hourglass', 'cursor', 'gear', 'merge', 'ticket', 'terminal', 'script', 'spark', 'pipeline', 'nest'];
  function fieldDef(type, name) { return own(type && type.fields, name) || own(COMMON, name); }
  function matches(cond, fields) { return Object.keys(cond).every(function (k) { return String(fields[k] || '').toLowerCase() === cond[k]; }); }
  function options(def, fields) {
    if (def.optionsFrom) return String(fields[def.optionsFrom] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    return def.options || [];
  }
  /* Choices match without regard to case, and are stored as the type spells them. */
  function canonical(def, fields, v) { var want = String(v).trim().toLowerCase(); return options(def, fields).filter(function (o) { return String(o).toLowerCase() === want; })[0]; }
  function hasOption(def, fields, v) { return canonical(def, fields, v) != null; }
  function list(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  /* Problems with one step's map fields. errors stop publishing (a field the type doesn't have, a value it can't take);
     tips only point out a field that's usually filled in, because a map may describe a step without every value. */
  function checkFields(type, fields) {
    var errors = [], tips = [];
    Object.keys(type.fields || {}).forEach(function (f) {
      var d = type.fields[f], usual = d.required || (d.requiredWhen && matches(d.requiredWhen, fields)) || (d.requiredUnless && !matches(d.requiredUnless, fields));
      if (usual && !fields[f]) tips.push('usually says "' + f + ':"' + (d.requiredWhen || d.requiredUnless ? ' for this action' : '') + '. Fine to leave out if it varies; it can be filled in during a run.');
    });
    Object.keys(fields).forEach(function (f) {
      var d = fieldDef(type, f);
      if (!d) { errors.push('has a field "' + f + '" that {' + type.id + '} doesn\'t use.'); return; }
      if (d.kind === 'choice' && !hasOption(d, fields, fields[f])) errors.push('"' + f + '" should be one of: ' + options(d, fields).join(', ') + '.');
      if (d.kind === 'time' && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(fields[f]).trim())) errors.push('"' + f + '" should be a time like 15:00.');
      if (d.kind === 'duration' && f === 'after' && PF.util.duration(fields[f]) == null) errors.push('"after" should be a duration like 2h or 30m.');
      if (d.kind === 'list' && list(fields[f]).length < 2) errors.push('"' + f + '" needs at least two choices, separated by commas.');
      if (d.kind === 'require') {
        var names = ((type.record) || []).map(function (r) { return r.name; });
        list(fields[f]).forEach(function (n) { if (n !== 'all' && names.indexOf(n) < 0) errors.push('"require" names "' + n + '", which {' + type.id + '} doesn\'t record. It records: ' + (names.join(', ') || 'nothing (use "evidence:" instead)') + '.'); });
      }
    });
    return { errors: errors, tips: tips };
  }
  /* Whether a step type frozen into a version uses only what this copy knows: a newer type version, or a property, field
     kind or evidence kind it doesn't know, could change how the step works, so such a version isn't run here. */
  var TYPE_KEYS = { id: 1, label: 1, icon: 1, hint: 1, fields: 1, record: 1, version: 1, custom: 1, group: 1, tags: 1 };
  var FIELD_KEYS = { label: 1, kind: 1, required: 1, requiredWhen: 1, requiredUnless: 1, options: 1 }, RECORD_KEYS = { name: 1, label: 1, kind: 1, long: 1, optionsFrom: 1, options: 1, when: 1 };
  var KNOWN_KINDS = { text: 1, url: 1, code: 1, message: 1, list: 1, choice: 1, duration: 1, deadline: 1, require: 1, time: 1, sets: 1 };
  function plainObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function only(o, keys) { return Object.keys(o).every(function (k) { return Object.prototype.hasOwnProperty.call(keys, k); }); }
  function understood(def) {
    if (!plainObj(def) || !only(def, TYPE_KEYS)) return false;
    if (def.version != null && !(typeof def.version === 'number' && def.version <= VERSION)) return false;
    if (def.fields != null && (!plainObj(def.fields) || !Object.keys(def.fields).every(function (f) { var d = def.fields[f]; return plainObj(d) && only(d, FIELD_KEYS) && Object.prototype.hasOwnProperty.call(KNOWN_KINDS, d.kind); }))) return false;
    if (def.record != null && (!Array.isArray(def.record) || !def.record.every(function (d) { return plainObj(d) && only(d, RECORD_KEYS) && Object.prototype.hasOwnProperty.call(RECORD_KINDS, d.kind); }))) return false;
    return true;
  }
  function editable(type) { return Object.keys((type && type.fields) || {}).concat(['link']).filter(function (f) { return !FIXED[f]; }); }
  /* The editable fields worth showing for this step: skip ones that only apply to another action, unless they already have a value. */
  function relevant(type, fields) {
    return editable(type).filter(function (f) { var d = fieldDef(type, f); return fields[f] || !d.requiredWhen || matches(d.requiredWhen, fields); });
  }
  /* The record fields that apply to this step. */
  function recordFields(type, fields, extra) {
    var req = list(fields.require), all = req.indexOf('all') >= 0;
    var out = ((type && type.record) || []).filter(function (d) { return !d.when || matches(d.when, fields); }).map(function (d) {
      var c = JSON.parse(JSON.stringify(d)); if (d.optionsFrom) c.options = options(d, fields); c.required = all || req.indexOf(d.name) >= 0; return c;
    });
    var ev = EVIDENCE[String(fields.evidence || '').toLowerCase()];
    if (ev) out.push(JSON.parse(JSON.stringify(ev)));
    return extra && extra.length ? out.concat(JSON.parse(JSON.stringify(extra))) : out;
  }
  /* Only required evidence interrupts the check; optional fields ride along when the form opens. */
  function needsRecord(type, fields, extra) { return recordFields(type, fields, extra).some(function (d) { return d.required; }); }
  /* Check recorded values; returns { values } or { error }. partial: saving values before the step is checked, so nothing is required yet. */
  function checkRecord(type, fields, values, partial, extra) {
    var out = {}, list = recordFields(type, fields, extra);
    values = values || {};
    for (var i = 0; i < list.length; i++) {
      /* Only the value's own property: a name like "constructor" must never read something inherited. */
      var d = list[i], raw = Object.prototype.hasOwnProperty.call(values, d.name) ? values[d.name] : null, v = String(raw == null ? '' : raw).trim();
      if (v.length > (d.max || 300)) return { error: d.label + ' can be at most ' + (d.max || 300) + ' characters.', field: d.name };
      if (!v) { if (d.required && !partial) return { error: d.label + ' is needed to check this step.', field: d.name }; continue; }
      if (d.kind === 'url' && !/^https?:\/\/\S+$/i.test(v)) return { error: d.label + ' should be a web link (https://…).', field: d.name };
      if (d.kind === 'choice' && !hasOption(d, fields, v)) return { error: d.label + ' should be one of: ' + d.options.join(', ') + '.', field: d.name };
      out[d.name] = d.kind === 'choice' ? canonical(d, fields, v) : v;
    }
    return { values: out };
  }
  /* The definitions a map uses, frozen into its publication. */
  /* Where a type sits and its tags are for finding it, not for what a step asks: they're never frozen into a version, so
     reorganizing types never makes a process or a skill look changed. */
  function freeze(ids, custom) {
    var out = {};
    ids.forEach(function (id) { var d = BY[id] || (custom && custom[id]); if (d) { out[id] = JSON.parse(JSON.stringify(d)); delete out[id].group; delete out[id].tags; } });
    return out;
  }
  var GROUPS = { confirm: 'General', communicate: 'General', meeting: 'General', decide: 'General', review: 'General', wait: 'General',
    'ui.action': 'Tools', 'jenkins.job': 'Tools', 'bitbucket.pr': 'Tools', 'jira.issue': 'Tools', 'ci.gate': 'Tools',
    'run.process': 'Automation', 'run.command': 'Automation', 'run.script': 'Automation', 'run.skill': 'Automation' };
  function groupOf(t) { return t && t.custom ? (t.group && t.group.length ? t.group : ['Team']) : [GROUPS[t && t.id] || 'General']; }
  function tagsOf(t) { return (t && t.tags) || []; }

  return { VERSION: VERSION, LIST: LIST, COMMON: COMMON, ICONS: ICONS_OK, get: get, fieldDef: fieldDef, options: options, hasOption: hasOption, canonical: canonical, checkFields: checkFields, understood: understood, editable: editable, relevant: relevant, checkCustom: checkCustom, customType: customType, recordFields: recordFields, needsRecord: needsRecord, checkRecord: checkRecord, freeze: freeze, groupOf: groupOf, tagsOf: tagsOf, groupText: groupText, tagText: tagText };
})();
