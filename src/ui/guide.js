/* What each entry box asks (docs/design.md section 37): a question, a gray example and one line on what filling it in does
   and what an empty box means. Display only, for the editor and the run screen's forms. Labels stay in the type definitions,
   which are frozen into versions, signatures, receipts and briefs; nothing here is written to a file. A team type's boxes
   fall back on their own labels and the type's hint. */
PF.guide = (function () {
  'use strict';
  var T = PF.types;
  var S = 'Shown with the step to whoever does it, and to an assistant doing it.';
  var R = 'Saved in the run and on its receipt.';
  var OPENS = 'Opens from the step.';
  var COPY = 'Shown with a Copy button. ^details are filled in.';

  /* A row: question, example (none for choices and chips), the why's body. Each why gets its empty-box sentence added (own
     marks a why that already says what empty means, so nothing is added). */
  function e(q, eg, why, own) { return { q: q, eg: eg || '', why: why || '', own: !!own }; }
  var PR = {
    action: e('What do you do with the pull request?', '', 'Decides which other questions apply and what\'s recorded.'),
    repo: e('Which repository?', 'payments-api', S),
    pull: e('Link to the pull request', 'https://github.com/acme/payments-api/pull/88', OPENS + ' Not needed to open one.'),
    from: e('From which branch?', 'release/^tag', S),
    to: e('Into which branch?', 'main', S)
  };
  var PR_REC = {
    pr: e('Link to the pull request', 'https://github.com/acme/payments-api/pull/88', R),
    checks: e('Did the checks pass?', '', R),
    mergeCommit: e('Which merge commit?', '3f9c2ab', R + ' Asked only for a merge.')
  };
  var FIELDS = {
    confirm: { where: e('Where do you look?', 'the Grafana "API latency" board', S), looks: e('What does right look like?', 'all six pods Running, no restarts', S + ' It\'s what they check against.') },
    communicate: { channel: e('Where do you post it?', '#release-announcements', S), audience: e('Who needs to hear it?', 'support and the on-call engineer', S),
      message: e('What do you say?', 'Release ^tag goes out at 2 pm. Expect a short slowdown.', 'Shown with a Copy button, so it goes out as written. ^details are filled in.') },
    meeting: { attendees: e('Who should be there?', 'release manager, QA lead', S), agenda: e('Link to the agenda', 'https://docs.acme.com/release-agenda', OPENS),
      join: e('Link to join', 'https://acme.zoom.us/j/123', OPENS), outcome: e('What should you leave with?', 'a go or no-go for Thursday', S) },
    decide: { options: e('What are the choices?', 'Go, No-go, Delay a day', 'They\'re the choices offered when the decision is recorded. At least two, separated by commas.'),
      decider: e('Who decides?', 'the release manager', S), criteria: e('What is it decided on?', 'open P1 bugs and the error rate', S) },
    review: { document: e('Link to what\'s reviewed', 'https://docs.acme.com/design', OPENS), focus: e('What should the reviewer look for?', 'rollback steps and the data migration', S) },
    wait: { for: e('What are you waiting for?', 'the vendor\'s security sign-off', S), contact: e('Who do you chase if it\'s late?', 'Dana at Acme', S) },
    'ui.action': { system: e('Which tool?', 'ServiceNow', S), page: e('Link to the page', 'https://acme.service-now.com/change', OPENS) },
    'jenkins.job': { job: e('Which job?', 'release/build-and-test', S), page: e('Link to the job', 'https://jenkins.acme.com/job/release', OPENS),
      parameters: e('Which parameters?', 'BRANCH=release/^tag', COPY), stage: e('Which stage do you watch?', 'Integration tests', S) },
    'bitbucket.pr': { action: PR.action, repo: PR.repo, from: PR.from, to: PR.to },
    'github.pr': PR,
    'jira.issue': { action: e('What do you do in Jira?', '', 'Decides which other questions apply.'), issue: e('Which issue?', 'PAY-1234', S), project: e('In which project?', 'PAY', S + ' Asked only to create.'),
      issueType: e('What kind of issue?', 'Task', S), status: e('Move it to?', 'In Review', S + ' Checked against the team\'s Jira workflow.'),
      assignee: e('Assign it to?', 'dana@acme.com', S), linkTo: e('Link it to which issue?', 'PAY-1200', S), set: e('Which fields do you set?', 'Fix Version=^tag', S + ' ^details are filled in.') },
    'run.process': { process: e('Which process? (its file name)', 'database-migration', 'The process\'s file name, not its title: it\'s looked up by that exact ID. Whoever reaches this step starts its run from here (Start), and it links back.'),
      carry: e('Which run details does it pass on?', 'tag, environment', 'Left empty, it passes on every run detail the other checklist also has.', true),
      version: e('Which version of it?', '3', 'Left empty, the run uses its latest published version.', true),
      pass: e('What does each of its details get?', 'environment=^env, region=us-east-1, notify=?', 'name=^detail passes this run\'s detail under another name, name=? asks it when it starts, and anything else is a fixed value. Left empty, it passes what carry: says. Needs Flightdeck 2.8.', true) },
    'run.command': { command: e('What do you run?', 'git fetch origin && git rebase origin/main', COPY), where: e('Where do you run it?', 'a terminal in the payments-api repo', S),
      expected: e('What should you see?', 'Successfully rebased', S + ' It\'s what they compare against.') },
    'run.script': { script: e('Which script?', 'scripts/smoke-test.sh', 'Shown with a Copy button.'), args: e('With which arguments?', '--env staging', 'Shown with a Copy button.'),
      where: e('Where do you run it?', 'the build server', S), expected: e('What should you see?', '12 passed, 0 failed', S) },
    'run.skill': { skill: e('Which skill?', 'release-notes', 'Shown with the step, with the skill\'s registration and a warning when it\'s out of date.'),
      skillVersion: e('Which version of the skill?', '2', 'Left empty, any registered version matches.', true),
      inputs: e('What does it need?', 'the tag and the merged pull requests', S), expected: e('What should it produce?', 'a draft on the release page', S) },
    'ci.gate': { pipeline: e('Which pipeline?', 'payments-api main', S), page: e('Link to the pipeline', 'https://ci.acme.com/payments-api', OPENS) },
    'jira.sprint': { action: e('What do you do with the sprint?', '', 'Decides which other questions apply.'), board: e('Which board?', 'Payments', S), sprint: e('Which sprint?', 'Sprint 42', S),
      goal: e('What\'s the goal?', 'Ship refunds v2', S + ' Asked only to set a goal.') },
    deploy: { environment: e('To which environment?', 'production', S), artifact: e('What do you deploy?', 'payments-api', S), version: e('Which version?', '^tag', S + ' ^details are filled in.'),
      tool: e('Link to the deploy tool', 'https://deploy.acme.com', OPENS), rollback: e('What do you roll back to if it goes wrong?', 'the previous release', S) },
    'verify.health': { dashboard: e('Link to the dashboard', 'https://grafana.acme.com/d/api', OPENS), metric: e('What do you watch?', 'p95 latency', S),
      threshold: e('Healthy when?', 'under 300 ms for 10 minutes', S + ' It\'s what they check against.'), watch: e('What warning signs?', '5xx spikes', S) },
    measure: { metric: e('What do you measure?', 'checkout time', S), unit: e('In what unit?', 'seconds', S), where: e('Where do you read it?', 'the Grafana checkout board', S) }
  };
  var RECORD = {
    communicate: { sent: e('Link to the message you posted', 'https://acme.slack.com/archives/C01/p17', R) },
    meeting: { outcome: e('What did you leave with?', 'Go, with the cache change held back', R) },
    decide: { decision: e('What was decided?', '', R), why: e('Why?', 'Two P1 bugs are still open', R) },
    review: { verdict: e('What\'s the verdict?', '', R), comments: e('Link to the comments', 'https://docs.acme.com/design#comments', R) },
    wait: { arrived: e('What arrived?', 'Signed letter, attached to the ticket', R) },
    'ui.action': { reference: e('ID or link of what you did', 'CHG0012345', R) },
    'jenkins.job': { build: e('Which build number?', '412', R), buildLink: e('Link to the build', 'https://jenkins.acme.com/job/release/412', R) },
    'bitbucket.pr': { pr: PR_REC.pr, mergeCommit: PR_REC.mergeCommit },
    'github.pr': PR_REC,
    'jira.issue': { key: e('Which issue was created?', 'PAY-1301', R) },
    'run.command': { result: e('What did you see?', 'Successfully rebased and updated main', R) },
    'run.script': { result: e('What did you see?', '12 passed, 0 failed', R) },
    'run.skill': { output: e('Link to what it produced', 'https://docs.acme.com/release-notes', R) },
    'ci.gate': { run: e('Which run number?', '1187', R), runLink: e('Link to the run', 'https://ci.acme.com/payments-api/1187', R) },
    'jira.sprint': { sprintLink: e('Link to the sprint', 'https://acme.atlassian.net/jira/sprint/42', R), name: e('What\'s the sprint called?', 'Sprint 43', R),
      dates: e('What are its dates?', 'Oct 27 – Nov 7', R), carriedOver: e('Which issues carried over?', 'PAY-12, PAY-15', R), moved: e('Which issues moved?', 'PAY-12, PAY-15', R) },
    deploy: { deployed: e('Which version went out?', '2026.10.16', R), deployLink: e('Link to the deploy', 'https://deploy.acme.com/runs/88', R), finished: e('When did it finish?', '14:32', R) },
    'verify.health': { result: e('Did it pass?', '', R), observed: e('What did you see?', '240 ms', R), snapshot: e('Screenshot or link', 'https://grafana.acme.com/d/api?from=now-1h', R) },
    measure: { value: e('What did you measure?', '3.2', R), unit: e('In what unit?', 'seconds', R) }
  };
  var COMMON = {
    link: e('A link they may need', 'https://wiki.acme.com/runbook', OPENS),
    expect: e('How long does it usually take?', '25m', 'Shown on the step, so people can plan.'),
    deadline: e('Is there a deadline?', 'external', 'With external, whoever runs it copies the deadline in from the real tool (Set deadline).'),
    evidence: e('Ask for proof?', '', 'Whoever checks the step has to give it.'),
    require: e('What must be recorded to check it?', '', 'Checking the step waits for these.'),
    at: e('At what time?', '14:00', 'Shown as a time on the step, in each person\'s own time zone. Only one of At, Done by and Due after.'),
    due: e('Done by what time?', '17:30', 'Same as At. Only one of the three.'),
    after: e('How long after the run starts?', '2h', 'Shown as a time on the step, counted from the run\'s start. Only one of the three.'),
    sets: e('Which run detail does it set?', '', 'Checking it asks for the value; later steps can use it as ^name.')
  };
  var EVIDENCE = {
    link: e('Link to the proof', 'https://ci.acme.com/payments-api/1187', R),
    note: e('What did you see?', 'All six pods Running, no restarts', R),
    number: e('Which number?', '412', R),
    'yes-no': e('Yes or no?', '', R),
    date: e('Which date?', '2026-10-27', R)
  };
  /* The step's own boxes and the other forms: their whys already say what empty means. */
  var STEP = {
    text: e('What do you do?', 'Order equipment', 'Shown on the run screen, in Next up and on the receipt.', true),
    roles: e('Who does it?', '', 'Their name shows on the step, and it goes to them in Next up.', true),
    binds: e('Which run details does it depend on?', '', 'If one changes during a run, the step asks to be checked again.', true),
    note: e('Anything else they should know?', 'Ask the manager for the start date first.', 'Shown with the step; Markdown works.', true)
  };
  var FORMS = {
    when: e('Only when…?', '^environment is production', 'One condition a line. When it isn\'t true in a run, the step shows as Not needed. Left empty, this step adds no condition of its own; its stage\'s conditions still apply.', true),
    caption: e('What does it show?', 'The deploy button, top right', 'Shown under the picture during a run, and read out by screen readers. Needed: a screenshot can\'t be added or kept without one.', true),
    'ph-title': e('What\'s this stage called?', 'Deploy', 'Shown as a heading in runs. Needed: an empty name is refused.', true),
    'ph-mode': e('How is it worked?', '', 'Read, then do: one step at a time. Do, then confirm: do it all, then confirm together.', true),
    'ph-note': e('Anything to know before this stage?', 'Bring the signed offer letter', 'Shown at the top of the stage in runs. Left empty, nothing is shown.', true),
    'ph-when': e('Only when…?', '^hotfix is yes', 'When it isn\'t true, the whole stage is Not needed. Left empty, the stage adds no condition of its own; it\'s still Not needed when every step in it is.', true),
    'g-title': e('What does passing it mean?', 'Manager sign-off', 'Shown on the gate in runs. Needed: an empty name is refused.', true),
    'g-owner': e('Who signs it off?', '', 'Their name shows on the gate as its owner. Whoever passes it in the run is recorded as passing it. Left empty, no owner is shown.', true),
    'g-approves': e('What does passing it approve?', 'release ^tag to production', 'Asked as "Approve …?" when it\'s passed; ^details are filled in. Left empty, it asks "Pass …?" with the gate\'s name.', true),
    'tr-title': e('What\'s this lane called?', 'Database', 'Shown as the lane\'s heading. Needed: an empty name is refused.', true),
    'tr-role': e('Who works it?', '', 'Its steps without a role of their own go to them. Left empty, they go to nobody in particular.', true),
    owner: e('Who owns this checklist?', '', 'Signs versions off as ready to automate. Left empty, no one is named.', true),
    backup: e('Who stands in for them?', '', 'Signs off only while the owner is away. Left empty, no one stands in.', true),
    role: e('Add a role', 'release-manager', 'Steps and gates can be given to a role. One at a time; an empty name adds nothing.', true),
    context: e('Add a run detail each run needs', 'tag', 'Asked when a run starts; steps can use it as ^name. One at a time; an empty name adds nothing.', true),
    'link-proc': e('Which checklist does it run?', '', 'Its run starts from this step and links back; this step is checked when it completes.', true),
    'link-proc-other': e('Which checklist ID?', 'database-migration', 'For a checklist that isn\'t in this folder yet: its file name, not its title.', true),
    'link-vn': e('Which version, always?', '', 'Every run of this checklist starts that exact version, even after a newer one is published.', true),
    'link-src': e('Where does this detail come from?', '', 'This run\'s detail (even under another name), a fixed value, or asked when the other checklist starts.', true),
    'link-val': e('Which fixed value?', 'us-east-1', 'Every run passes exactly this. At most 120 characters, no commas.', true),
    'pr-host': e('Where is the pull request?', '', 'Changes the step between a GitHub and a Bitbucket pull request. Every value is kept; what the other one doesn\'t use is flagged.', true),
    questions: e('What\'s still to be answered?', 'Who approves a hotfix?', 'Questions for the owner, written while drafting. Left in, the checklist can\'t be published; answer them in the steps, then remove the section.', true)
  };

  var USUAL = 'Usually filled in. Left empty, the checklist check gives a tip.', OPTIONAL = 'Optional. Left empty, it isn\'t shown.';
  var NEEDED = 'Needed to check the step.', MAYBE = 'Optional unless this step requires it.';
  function own(o, k) { return o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null; }
  function builtIn(type) { return !!type && !type.custom && !!own(FIELDS, type.id); }
  function out(x, why, tail) { return { q: x.q, eg: x.eg, why: x.own || !tail ? why : (why ? why + ' ' : '') + tail }; }
  /* Whether a checklist field is one the type usually has filled in, for this step as it stands. */
  function usual(d, fields) {
    if (!d) return false;
    var m = function (c) { return Object.keys(c).every(function (k) { return String((fields || {})[k] || '').toLowerCase() === c[k]; }); };
    return !!(d.required || (d.requiredWhen && m(d.requiredWhen)) || (d.requiredUnless && !m(d.requiredUnless)));
  }
  /* A checklist field's box: a built-in type's own entry, the fields every type accepts, a pin; or for a team type (or a
     field the type doesn't have), its label, with the type's hint as the why. */
  function field(type, name, fields) {
    var d = T.fieldDef(type, name), tail = usual(own(type && type.fields, name), fields) ? USUAL : OPTIONAL;
    var x = (builtIn(type) && own(FIELDS[type.id], name)) || own(COMMON, name);
    if (x) return out(x, x.why, tail);
    return out({ q: (d && d.label) || name, eg: '' }, type && type.custom && own(type.fields, name) ? type.hint || '' : '', tail);
  }
  /* A box filled in when the step is checked, from the effective record definition (R.evidenceFor's list): its own entry,
     an evidence kind's, a run detail it sets, or its label (a team type's, a Jira workflow field). */
  function record(type, d, fields) {
    var tail = d && d.required ? NEEDED : MAYBE, x = null;
    if (!d) return null;
    if (d.detail) x = e('What\'s the ^' + d.detail + '?', '', R + ' Later steps can use it as ^' + d.detail + '.');
    else if (d.name === 'evidence') x = own(EVIDENCE, String((fields || {}).evidence || '').toLowerCase());
    else if (!d.jira && builtIn(type)) x = own(RECORD[type.id], d.name);
    if (x) return out(x, x.why, tail);
    return out({ q: d.label || d.name, eg: '' }, '', tail);
  }
  /* The "+ add" chip that shows a waiting box: the fields every type accepts by these short names, a type's own fields
     and pins by their labels. */
  var CHIPS = { link: 'Link', expect: 'How long it takes', deadline: 'Deadline', evidence: 'Ask for proof', require: 'What must be recorded',
    at: 'At', due: 'Done by', after: 'Due after', sets: 'Sets a run detail' };
  function chip(type, name) { var d = T.fieldDef(type, name); return own(CHIPS, name) || (d && d.label) || name; }
  function step(name) { var x = own(STEP, name); return x ? out(x, x.why) : null; }
  function form(name) { var x = own(FORMS, name); return x ? out(x, x.why) : null; }

  return { field: field, record: record, step: step, form: form, usual: usual, chip: chip,
    /* The tables as written, for the tests that check every box is covered and every example is accepted. */
    FIELDS: FIELDS, RECORD: RECORD, COMMON: COMMON, EVIDENCE: EVIDENCE, STEP: STEP, FORMS: FORMS,
    TAILS: { usual: USUAL, optional: OPTIONAL, needed: NEEDED, maybe: MAYBE } };
})();
