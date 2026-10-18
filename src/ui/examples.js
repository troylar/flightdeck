/* The example folder's history: runs that show every feature without anyone setting it up. Published maps come from the
   example drafts; the runs are played through the same rules a person's clicks go through, at times in the past. */
PF.examples = (function () {
  'use strict';
  var R = PF.run, U = PF.util, repo = PF.repo;
  var MIN = 60000, DAY = 1440;

  var REL = 'maps/drafts/release.md';
  /* Release v1, before the deploy step was clarified (so skills built from v1 have something to catch up on). */
  function v1Release(md) {
    return md.replace('  expect: 25m\n', '  expect: 20m\n').replace('> The job stops at stage 5 and asks for the release ticket number. Type it exactly as it appears in Jira.', '> The job asks for the ticket number partway through.');
  }
  function seed(mem, files) {
    var people = JSON.parse(files['people.json'] || '[]');
    var nameOf = function (id) { var p = people.filter(function (x) { return x.id === id; })[0]; return p ? p.name : id; };
    var drafts = Object.keys(files).filter(function (p) { return /^maps\/drafts\/.+\.md$/.test(p); });
    var ids = drafts.map(function (p) { return p.replace(/^.*\/|\.md$/g, ''); });
    var t0 = new Date(Date.now() - 40 * DAY * MIN).toISOString(), tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
    var at = function (min) { return new Date(Date.now() - min * MIN).toISOString(); };
    /* The sprint example's clock times are set relative to now (and before midnight), so its timeline looks live whenever the
       examples are created. The draft gets the same times, so it doesn't show as changed. */
    var hhmm = function (min) { var x = new Date(Math.min(Date.now() + min * MIN, new Date().setHours(23, 59, 0, 0))); return x.getHours() + ':' + ('0' + x.getMinutes()).slice(-2); };
    var sp = 'maps/drafts/sprint-start.md';
    if (files[sp]) { files = Object.assign({}, files); files[sp] = files[sp].replace(/\n  at: \d{1,2}:\d{2}/, '\n  at: ' + hhmm(20)).replace(/\n  due: \d{1,2}:\d{2}/, '\n  due: ' + hhmm(140)); }
    var d0;
    return (files[sp] ? mem.write(sp, files[sp]) : Promise.resolve()).then(function () { return repo.loadAll(mem); }).then(function (d) {
      d0 = d;
      return drafts.reduce(function (pr, path) {
        /* The release's history: v1 was published with an older deploy step; today's draft becomes v2 after the runs. */
        var md = path === REL ? v1Release(files[path]) : files[path];
        return pr.then(function () { return repo.publish(mem, md, { people: people, customTypes: d.stepTypes.types, workflows: d.jira.workflows, processes: ids, by: 'person-avery', changes: 'First version (example)', existing: [], now: t0 }); });
      }, Promise.resolve());
    }).then(function () { return repo.loadAll(mem); }).then(function (d) {
      var pub = function (id) { var p = d.processes.filter(function (x) { return x.process === id; })[0]; return p && p.index.latest; };
      if (!pub('release') || !pub('check-in')) return;
      var W = d.jira.workflows, runs = [], notes = [];
      var pr = function (link) { var o = {}; o[PF.jira.key('Pull request')] = link; return o; };

      /* Play a run: answer steps in order from `start` minutes ago, with the quirks real runs have. */
      function play(p, o) {
        var r = R.create(p, { title: o.title, details: o.details, roles: o.roles, by: o.by, session: 'example-session', now: at(o.start), tz: tz, workflows: W, parent: o.parent }), map = R.mapOf(r);
        var t = o.start, q = o.quirks || {}, stop = false;
        var next = function (m) { t -= m; return at(t); };
        var who = function (s) { return (s.roles[0] && r.roles[s.roles[0]]) || o.by; };
        var values = function (s) {
          var out = Object.assign({}, (o.ev || {})[s.id]);
          R.evidenceFor(r, s).list.forEach(function (f) {
            if (out[f.name] || !f.required) return;
            if (f.label === 'Fix version') { out[f.name] = o.title.replace(/^Release /, ''); return; }
            if (f.detail === 'tag') { out[f.name] = 'v' + o.title.replace(/^Release /, ''); return; }
            var v = f.source ? PF.jira.resolve(f.source, r.details, function (ro) { return r.roles[ro] ? nameOf(r.roles[ro]) : ''; }) : '';
            out[f.name] = v || (f.kind === 'url' ? 'https://example.com/' + s.id : f.kind === 'choice' ? f.options[0] : 'OK');
          });
          return out;
        };
        map.phases.forEach(function (ph, pi) {
          if (stop) return;
          ph.steps.forEach(function (s) {
            if (stop) return;
            if (o.until && o.until[0] === pi && o.until[1] === s.id) { stop = true; return; }
            /* A hook may run something first (a child run) and say when it finished; the parent carries on from then. */
            if (q.before && q.before[s.id]) { var until = q.before[s.id](r, map, at(t), t); if (until != null) t = Math.min(t, until); }
            if (s.type === 'run.process' && !(r.steps[s.id] && r.steps[s.id].child)) t = Math.min(t, autoChild(r, map, s, t, o));
            if (r.steps[s.id] && r.steps[s.id].s === 'done') return;
            if (q.block && q.block[s.id]) R.block(r, map, s.id, q.block[s.id], who(s), next(3));
            if (q.na && q.na.indexOf(s.id) >= 0) { R.na(r, map, s.id, who(s), next(1)); return; }
            R.done(r, map, s.id, who(s), next(o.pace || 4), values(s));
            if (q.diff && q.diff[s.id]) R.differently(r, map, s.id, q.diff[s.id], who(s), at(t));
          });
          if (stop) return;
          if (q.pause && q.pause[0] === pi) { R.pause(r, q.pause[2], o.by, next(1)); R.resume(r, o.by, next(q.pause[1])); }
          R.pass(r, map, pi, o.by, next(Math.min(2, o.pace || 4)));
        });
        if (o.started) { var s = R.mapOf(r).phases[o.until[0]].steps.filter(function (x) { return x.id === o.until[1]; })[0]; R.start(r, map, s.id, who(s), at(o.started)); }
        if (o.blockAt) R.block(r, map, o.until[1], o.blockAt, o.by, next(2));
        if (o.pausedNow) R.pause(r, o.pausedNow, o.by, at(o.pausedAt || 5));
        if (o.outcome) R.end(r, map, o.outcome, o.by, nameOf(o.by), next(1));
        else R.handOff(r, o.by, o.by, next(0));
        runs.push(r);
        return r;
      }
      /* A step that runs another process gets a real child run, played to completion and linked, like a person would start it. */
      function autoChild(r, map, s, t, o) {
        var f = R.fieldsOf(r, s), cp = pub(f.process);
        if (!cp) return t;
        var details = R.childDetails(r, s, cp.map.meta.context), inputs = Object.assign({}, details), roles = {};
        cp.map.meta.context.forEach(function (k) { if (!details[k]) details[k] = k === 'branch' ? 'release/' + o.title.replace(/^Release /, '') : k === 'story' ? 'ABC-' + (4500 + runs.length) : 'n/a'; });
        cp.map.meta.roles.forEach(function (ro) { roles[ro] = r.roles[ro] || o.by; });
        if (roles.reviewer === roles.author) roles.reviewer = 'person-blake' === roles.author ? 'person-casey' : 'person-blake';
        var ev = {}; ev['move-story'] = pr('https://bitbucket.example.com/projects/WA/repos/web-app/pull-requests/' + (300 + runs.length));
        var child = play(cp, { title: cp.map.meta.title + ' for ' + o.title, start: t - 1, pace: 1, by: o.by, parent: { process: r.process, id: r.id, step: s.id, inputs: inputs }, details: details, roles: roles, outcome: 'Completed', ev: ev });
        R.linkChild(r, map, s.id, { process: child.process, id: child.id, inputs: inputs }, o.by, at(t - 0.5));
        var after = (Date.now() - Date.parse(child.ended.at)) / MIN - 1;
        R.settleChild(r, map, s.id, child, o.by, at(after));
        return after - 0.5;
      }
      var rel = { ticket: 'ABC-4764', commit: 'd9d8514', environment: 'production' };
      var team1 = { 'release-lead': 'person-casey', qa: 'person-blake', backend: 'person-avery' };

      /* Earlier releases: the history behind "How runs go" and "Who has done each role". Morgan has never been QA. */
      play(pub('release'), { title: 'Release 2026.09.18', start: 29 * DAY, pace: 5, by: 'person-morgan', details: { ticket: 'ABC-4590', commit: '5e01c7a', environment: 'production' },
        roles: { 'release-lead': 'person-morgan', qa: 'person-blake', backend: 'person-casey' }, outcome: 'Completed', ev: { approved: { number: 'CHG0040113' } } });
      play(pub('release'), { title: 'Release 2026.09.25', start: 22 * DAY, pace: 4, by: 'person-casey', details: { ticket: 'ABC-4633', commit: '0b7d2e9', environment: 'production' }, roles: team1,
        quirks: { block: { tests: 'Gate run failed on a flaky contract test' } }, until: [1, 'pods'], blockAt: 'Pods restarting after the deploy; rolled back to 5e01c7a', outcome: 'Stopped early', ev: { approved: { number: 'CHG0040388' } } });
      play(pub('release'), { title: 'Release 2026.10.02', start: 15 * DAY, pace: 6, by: 'person-blake', details: { ticket: 'ABC-4680', commit: '7c3a1f0', environment: 'production' },
        roles: { 'release-lead': 'person-blake', qa: 'person-casey', backend: 'person-morgan' }, outcome: 'Completed', ev: { approved: { number: 'CHG0040702' } },
        quirks: { diff: { pods: 'Watched the pods for 20 minutes, not 10: the cache warms slowly after a restart' }, na: ['announce'] } });
      play(pub('release'), { title: 'Release 2026.10.09', start: 8 * DAY, pace: 4, by: 'person-casey', details: { ticket: 'ABC-4722', commit: 'e4c90b2', environment: 'production' }, roles: team1,
        outcome: 'Completed', ev: { approved: { number: 'CHG0041030' } },
        quirks: { block: { approve: 'Approver was in another meeting; Jenkins nearly rolled back' }, diff: { pods: 'Checked restarts in the dashboard instead of kubectl; the jump box was down' }, pause: [1, 25, 'Waiting for the change board to confirm the window'] } });

      /* Today's release, in progress. Its release-notes check-in ran as a linked child run, which also shows a Jira
         transition whose required fields came from the run. Earlier, the run was paused while the change board met. */
      var current = { title: 'Release 2026.10.16', start: 95, pace: 4, by: 'person-casey', details: rel, roles: team1, until: [1, 'jenkins'], started: 14,
        ev: { approved: { number: 'CHG0041872' }, tests: { run: '1842', runLink: 'https://ci.example.com/job/web-app-gate/1842/' }, merge: { pr: 'https://bitbucket.example.com/projects/WA/repos/web-app/pull-requests/412', mergeCommit: 'a41f9c2' } },
        quirks: { pause: [0, 9, 'Waiting for the change board to approve the window'], before: {} } };
      current.quirks.before.notes = function (r, map, now, t) {
        var inputs = { commit: rel.commit };
        var child = play(pub('check-in'), { title: 'Check in code for Release 2026.10.16', start: t - 1, pace: 1, by: 'person-avery', parent: { process: 'release', id: r.id, step: 'notes', inputs: inputs },
          details: { branch: 'release/2026.10.16', commit: rel.commit, story: 'ABC-4761' }, roles: { author: 'person-avery', reviewer: 'person-blake' }, outcome: 'Completed',
          ev: { 'move-story': pr('https://bitbucket.example.com/projects/WA/repos/web-app/pull-requests/411') } });
        R.linkChild(r, map, 'notes', { process: child.process, id: child.id, inputs: inputs }, 'person-casey', now);
        var after = (Date.now() - Date.parse(child.ended.at)) / MIN - 1;
        R.settleChild(r, map, 'notes', child, 'person-casey', at(after));
        return after - 0.5;
      };
      var main = play(pub('release'), current);
      notes.push([main, { id: U.randomId(8), at: at(50), by: 'person-blake', step: 'tests', text: 'Gate run 1842 was green on `d9d8514`. Took 11 minutes.' }]);

      /* Earlier check-ins, for their own history. */
      play(pub('check-in'), { title: 'Check in the login fix', start: 6 * DAY, pace: 3, by: 'person-blake', details: { branch: 'fix/login-timeout', commit: '91aa0d3', story: 'ABC-4701' }, roles: { author: 'person-blake', reviewer: 'person-casey' }, outcome: 'Completed',
        ev: { 'move-story': pr('https://bitbucket.example.com/projects/WA/repos/web-app/pull-requests/398') }, quirks: { block: { gate: 'Two tests failed after the rebase' } } });

      /* An incident in progress, its Stabilize phase split into a fix track and a comms track. */
      if (pub('incident')) play(pub('incident'), { title: 'Chat replies timing out', start: 18, pace: 2, by: 'person-morgan', details: { alert: 'ALERT-2291 chat latency p95 > 8s' },
        roles: { 'incident-lead': 'person-morgan', comms: 'person-blake' }, until: [1, 'wait'], quirks: {}, ev: { lead: { note: 'Morgan leads' }, decide: { decision: 'Turn a flag off' } } });
      /* A sprint start that's paused until the product owner can join. Its planning meeting and gate have clock times. */
      /* Started today even just after midnight, so its clock times are on the same day as the run. */
      var sinceMidnight = (Date.now() - new Date().setHours(0, 0, 0, 0)) / MIN, sprintStart = Math.min(40, sinceMidnight * 0.9);
      if (pub('sprint-start')) play(pub('sprint-start'), { title: 'Sprint 42', start: sprintStart, pace: sprintStart / 20, by: 'person-blake', details: { sprint: 'Sprint 42' }, roles: { 'scrum-lead': 'person-blake' },
        until: [1, 'meeting'], pausedNow: 'Waiting for the product owner to join planning', pausedAt: sprintStart / 10 });

      /* Suggested fixes from release runs, one in each state: fixed in v2 (accepted before it was published), declined with a
         reason, still open, and accepted into the draft after v2. */
      var fixes = [], byTitle = function (t) { return runs.filter(function (x) { return x.title === t; })[0]; };
      var fix = function (r, o, decided) {
        if (!r) return;
        var n = PF.fixes.build({ id: U.randomId(10), at: at(o.ago), by: o.by, session: 'example-session', kind: o.kind, phase: o.phase, step: o.step, where: o.where, text: o.text, version: +r.version });
        notes.push([r, n]); if (decided) fixes.push([n, decided]);
      };
      fix(byTitle('Release 2026.10.09'), { ago: 8 * DAY - 30, by: 'person-avery', kind: 'instructions', phase: 'deploy', step: 'jenkins', text: 'Say when the job asks for the ticket number. It stops at stage 5, and we waited at the console not knowing it wanted input.' },
        { status: 'accepted', by: 'person-casey', ago: 7 * DAY, known: 1 });
      fix(byTitle('Release 2026.10.02'), { ago: 15 * DAY - 20, by: 'person-morgan', kind: 'order', phase: 'prep', step: 'announce', text: 'Post "starting release" first, before the flag check, so the team hears about it earlier.' },
        { status: 'declined', by: 'person-casey', ago: 14 * DAY, reason: 'We post only once the deploy is sure to start; the checks before it can still stop the release.' });
      fix(main, { ago: 30, by: 'person-blake', kind: 'instructions', phase: 'deploy', step: 'pods', text: 'Watch the pods for 20 minutes, not 10. The cache warms slowly after a restart; two earlier runs did it differently for this reason.' });
      fix(main, { ago: 20, by: 'person-blake', kind: 'missing', phase: 'verify', text: 'Add a last check of the error budget dashboard before the ticket is closed.' }, { status: 'accepted', by: 'person-casey', known: 2 });

      return runs.reduce(function (pr, r) { return pr.then(function () { return repo.saveRun(mem, r, 'example-session'); }); }, Promise.resolve()).then(function () {
        /* Check-in v1 has enough clean runs; its owner signed it off as ready for a skill. */
        var ci = pub('check-in'), ready = PF.skills.readiness(runs, ci, null);
        return ready.enough ? repo.recordValidation(mem, ci, 'example-session', 'person-avery', 'Ran it with the team for two sprints; the steps are what we do.', { completed: ready.completed, clean: ready.clean, runs: ready.cleanRuns }) : null;
      }).then(function () {
        return files[REL] ? repo.loadAll(mem).then(function (d2) {
          var rp = d2.processes.filter(function (p) { return p.process === 'release'; })[0];
          return repo.publish(mem, files[REL], { people: people, customTypes: d2.stepTypes.types, workflows: d2.jira.workflows, processes: ids, by: 'person-casey', changes: 'Deploy job: allow 25 minutes and say when to type the ticket number', existing: rp.index.all.map(function (x) { return x.info; }), now: at(30) });
        }) : null;
      }).then(function () {
        return notes.reduce(function (pr, n) { return pr.then(function () { return repo.addNote(mem, n[0], 'example-session', n[1]); }); }, Promise.resolve());
      }).then(function () {
        /* Each acceptance knew of the versions published before it: v1 for the one v2 fixed, v2 for the one still in the draft. */
        return fixes.reduce(function (pr, x) { var d = x[1]; return pr.then(function () { return repo.decideFix(mem, PF.fixes.decision({ process: 'release', id: x[0].id }, d.by, d.status, d.reason, d.ago ? at(d.ago) : new Date().toISOString(), { latestVersion: d.known }), 'example-session'); }); }, Promise.resolve());
      }).then(function () {
        /* Next week's release, planned in the app by duplicating an earlier one, due in a few hours so it shows on Home. */
        var last = runs.filter(function (r) { return r.title === 'Release 2026.10.09'; })[0], due = new Date(Date.now() + 3 * 60 * MIN);
        due.setMinutes(0, 0, 0);
        if (!last) return null;
        return repo.loadAll(mem).then(function (d3) {
          var rp = d3.processes.filter(function (p) { return p.process === 'release'; })[0];
          return repo.savePlan(mem, { kind: 'plan', id: 'plan-release-example-next', process: 'release', version: rp.index.latest.info.version, title: 'Release 2026.10.23',
            details: { ticket: 'ABC-4760', environment: 'production' }, roles: last.roles, when: due.toISOString(), note: 'Same team as the last release.',
            from: 'release/' + last.id, by: 'person-casey', created: at(20) });
        });
      });
    });
  }
  return { seed: seed };
})();
