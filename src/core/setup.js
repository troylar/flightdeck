/* Getting started: the five steps of setting up a team folder, worked out from what's in the folder (nothing is stored but a
   per-browser "dismissed"), the starter checklists, and the messages people copy. Pure; see docs/design.md section 11. */
PF.setup = (function () {
  'use strict';
  var M = PF.map;
  var STEPS = [
    { id: 'folder', title: 'Choose the team folder', short: 'Team folder' },
    { id: 'people', title: 'Add your people', short: 'People' },
    { id: 'checklist', title: 'Publish a first checklist', short: 'First checklist' },
    { id: 'run', title: 'Do a first run', short: 'First run' },
    { id: 'second', title: 'Open it on a second computer', short: 'Second computer' }
  ];

  /* snap: { folder (a real team folder is open), people (cleaned), me, processes (repo.loadAll's), runs, answers (connection
     answers this window has seen) }. The second computer counts once someone else answered a connection check, or recorded
     a run or wrote a note here: proof another person opened the folder. */
  function progress(snap) {
    var people = snap.people || [], me = snap.me, runs = snap.runs || [];
    var other = function (id) { return !!id && id !== me; };
    var done = {
      folder: !!snap.folder,
      people: !!snap.folder && people.some(function (p) { return p.id === me; }) && people.some(function (p) { return p.folderRole === 'owner'; }),
      checklist: (snap.processes || []).some(function (p) { return p.index && p.index.latest; }),
      run: runs.some(function (r) { return r.ended && r.ended.outcome === 'Completed'; }),
      second: (snap.answers || []).some(function (a) { return other(a.by); }) || runs.some(function (r) { return other(r.recorder && r.recorder.person) || (r._notes || []).some(function (n) { return other(n.by); }); })
    };
    var steps = STEPS.map(function (s) { return { id: s.id, title: s.title, short: s.short, done: done[s.id] }; });
    var count = steps.filter(function (s) { return s.done; }).length, next = steps.filter(function (s) { return !s.done; })[0];
    return { steps: steps, count: count, total: steps.length, complete: count === steps.length, next: next ? next.id : null };
  }

  var WEEKLY = ['---', 'process: weekly-review', 'title: Weekly review', 'category: Team', 'group: Team', 'tags: planning', 'owner: person-you', 'runs: solo', '---', '',
    '## Look back · DO-CONFIRM {#look-back}',
    '- [ ] {confirm} Last week\'s follow-ups closed or carried over {#follow-ups}',
    '- [ ] {confirm} One thing that went well and one that didn\'t, written down {#retro}', '',
    '## Look ahead · READ-DO {#look-ahead}',
    '- [!] {confirm} The three most important things for this week chosen {#top-three}',
    '- [ ] {confirm} Calendar checked for deadlines and time off {#calendar}',
    '- [ ] {confirm} Anything blocked raised with whoever can unblock it {#blockers}', ''].join('\n');
  var BLANK = ['---', 'process: my-checklist', 'title: My checklist', 'category: Other', 'owner: person-you', 'runs: solo', '---', '',
    '## First phase · READ-DO {#first}', '- [ ] {confirm} The first thing to do {#first-step}', ''].join('\n');
  /* The first checklists on offer. Code check-in is the example folder's own (the app passes its text in). */
  var TEMPLATES = [
    { id: 'check-in', title: 'Code check-in', text: 'Rebase, run the tests, open the pull request, get it reviewed. Two roles: author and reviewer.' },
    { id: 'weekly-review', title: 'Weekly review', text: 'Ten minutes on your own each week: look back, then choose what matters next.', md: WEEKLY },
    { id: 'blank', title: 'Start blank', text: 'One phase and one step to rename. Build the rest in the editor.', md: BLANK },
    { id: 'assistant', title: 'I\'ll ask my AI assistant', text: 'Copy a prompt, paste in your notes or runbook, and your AI assistant writes the draft.' }
  ];
  /* A starter with its owner and backup owner set to real people (only those front-matter lines change). */
  function starter(md, owner, backup) {
    var set = { owner: owner };
    if (backup && backup !== owner) set.backup = backup;
    return M.withMeta(md, set);
  }
  function assistantPrompt(o) {
    return ['Use /flightdeck-new-checklist to write our first checklist in the team folder "' + o.folder + '".',
      'Set owner: ' + o.owner + (o.backup ? ' and backup: ' + o.backup : '') + ' in its front matter. Keep it short: three to six steps a phase.', '',
      'Here is how we do it today:', '(paste your notes, runbook or the steps here)'].join('\n');
  }
  /* The message the folder owner sends a teammate so they can open the folder on their own computer. */
  function invite(o) {
    return ['Hi ' + String(o.to).split(' ')[0] + ',', '',
      'Our checklists are in Flightdeck now. To open it on your computer:', '',
      '1. In OneDrive, find the shared folder "' + o.folder + '" (Shared with me, then Add shortcut to My files if it isn\'t there yet).',
      '2. Right-click the folder and choose Always keep on this device.',
      '3. Open flightdeck.html in that folder with Edge or Chrome.',
      '4. Choose Join your team\'s folder, pick "' + o.folder + '", and choose ' + o.to + ' as who you are.', '',
      'If you\'re asked to answer a connection check, choose Answer. That tells me the folder reaches your computer.', '',
      'Thanks,', o.from].join('\n');
  }

  /* Whether a folder can start a new team: only operating-system clutter at its top, and in .flightdeck/ only this setup's own
     write-test leftovers. Anything else (skills a team already has, installed.json) means it isn't new; nothing is replaced. */
  var CLUTTER = { '.DS_Store': 1, 'desktop.ini': 1, 'Thumbs.db': 1 };
  function emptyFolder(top, inFlightdeck) {
    return (top || []).every(function (i) { return CLUTTER[i.name] || i.name === '.flightdeck'; }) &&
      (inFlightdeck || []).every(function (i) { return i.kind === 'file' && /^write-test-[\w-]+\.tmp$/.test(i.name); });
  }

  return { STEPS: STEPS, emptyFolder: emptyFolder, TEMPLATES: TEMPLATES, progress: progress, starter: starter, assistantPrompt: assistantPrompt, invite: invite };
})();
