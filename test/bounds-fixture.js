// The big folder test/bounds-app.test.js boots on: every list that grows with the team folder, filled past its page at once,
// so a list drawn without a bound shows up there (docs: the 2.11 plan's D8). Files are made with the real rules, the same
// every time; runs and records are written as the app writes them. Generating takes some seconds, so a process makes it once.
'use strict';
const { load, exactOf } = require('./harness');

const NOW = Date.parse('2026-10-26T12:00:00.000Z'), MIN = 60000, HOUR = 3600000, DAY = 86400000;
/* mulberry32, as tools/big-folder.js: the same on every computer. */
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pad = (n, w) => String(n).padStart(w || 4, '0');
const iso = ms => new Date(ms).toISOString();

/* The sizes. Each is over the bound of every list it fills; the plan's target sizes (10,000 runs, 500 people...) where the
   list's work grows with them. */
const SIZE = {
  procs: 1000, tags: 400, people: 500, followUps: 5000, running: 10000, plans: 5000, versions: 300, stages: 200,
  members: 400, health: 1000, many: 300, ended: 400, steps: 400, teamValues: 100, legacy: 300, archived: 1000, hot: 120
};

function make(opts) {
  opts = opts || {};
  const PF = load(), R = PF.run, P = PF.publish, U = PF.util, C = PF.corrections, S = Object.assign({}, SIZE, opts.size || {});
  const rand = prng(opts.seed || 211), id8 = () => { let s = ''; for (let i = 0; i < 8; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)]; return s; };
  const randomId = U.randomId;
  U.randomId = n => { let s = ''; for (let i = 0; i < (n || 8); i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)]; return s; };
  const files = {}, put = (p, text) => { files[p] = text; }, json = o => JSON.stringify(o, null, 2) + '\n';
  const facts = {};
  try {
    /* ---------- people: 500, scrambled, with names two people share ---------- */
    const people = [
      { id: 'person-avery', name: 'Avery Lee', initials: 'AL', email: 'avery@example.com', folderRole: 'owner' },
      { id: 'person-blake', name: 'Blake Ortiz', initials: 'BO', email: 'blake@example.com', folderRole: 'backup' },
      { id: 'person-casey', name: 'Casey Nguyen', initials: 'CN', email: 'casey@example.com' },
      { id: 'person-morgan', name: 'Morgan Diaz', initials: 'MD', email: 'morgan@example.com' }];
    for (let i = 1; people.length < S.people; i++) people.push({ id: 'person-p' + i, name: i % 50 === 0 ? 'Sam Twin' : 'Person ' + i, email: 'p' + i + '@example.com' });
    for (let i = people.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = people[i]; people[i] = people[j]; people[j] = t; }
    put('people.json', json(people));
    facts.people = people;
    const ids = people.map(p => p.id), who = i => ids[i % ids.length];

    /* ---------- checklists ---------- */
    const pubs = {};
    function publish(md, n, more) {
      const proc = /\nprocess: ([\w-]+)/.exec(md)[1], existing = (pubs[proc] || []).map(x => ({ version: x.info.version }));
      const built = P.build(md, Object.assign({ people, by: 'person-avery', changes: 'Version ' + (existing.length + 1), existing, now: iso(NOW - 300 * DAY + existing.length * HOUR), rand: id8() }, more || {}));
      if (built.blockers) throw new Error(proc + ': ' + built.blockers.join('; '));
      const base = (more && more.stage ? 'staged/' : 'publications/') + proc + '/' + built.folder + '/';
      Object.keys(built.files).forEach(f => put(base + f, built.files[f]));
      let v = P.verify(built.folder, built.files, null, { stage: !!(more && more.stage) });
      /* A version that needs its exact bytes read (a step that passes details, 2.8) is checked with them. */
      if (v.needsBytes) v = P.verify(built.folder, built.files, exactOf(PF, built.files), { stage: !!(more && more.stage) });
      const pub = { proc, folder: built.folder, base, info: v.info, md, map: v.map, types: v.types };
      if (!(more && more.stage)) (pubs[proc] = pubs[proc] || []).push(pub);
      return pub;
    }
    const head = (proc, title, o) => '---\nprocess: ' + proc + '\ntitle: ' + title + '\ncategory: ' + (o.category || 'Synthetic') + (o.group ? '\ngroup: ' + o.group : '') + (o.tags ? '\ntags: ' + o.tags : '') +
      '\nowner: person-avery' + (o.context ? '\ncontext: ' + o.context : '') + '\nroles: ' + (o.roles || 'lead') + '\n---\n\n';
    const stepLine = (id, text, o) => '- [ ] {' + ((o && o.type) || 'confirm') + '} ' + text + ' @' + ((o && o.role) || 'lead') + ' {#' + id + '}\n' + ((o && o.extra) || '');
    function phases(nPh, perPh, text, o) {
      let md = '', n = 0;
      for (let p = 0; p < nPh; p++) {
        md += '## Phase ' + (p + 1) + ' · READ-DO {#ph' + (p + 1) + '}\n';
        for (let s = 0; s < perPh; s++, n++) md += stepLine('s' + n, text(n), o);
        md += '\n';
      }
      return md;
    }

    /* 1,000 checklists in 1,000 groups, 400 tags among them. */
    for (let i = 1; i <= S.procs; i++) publish(head('proc-' + pad(i), 'Process ' + i, { group: 'Group ' + i, tags: 'tag-' + pad(i % S.tags, 3) }) + phases(1, 2, n => 'Check part ' + n + ' of process ' + i));
    /* The small checklist 10,000 runs are of, and 5,000 plans for. */
    const tiny = publish(head('tiny', 'Tiny checklist', { group: 'Busy' }) + phases(1, 1, () => 'Do the one thing'));
    facts.tiny = tiny;
    /* A checklist with 300 versions; the ended runs of one version fill How runs go. */
    let vers;
    for (let v = 1; v <= S.versions; v++) vers = publish(head('versions', 'Many versions', { group: 'Busy' }) + phases(2, 3, n => 'Step ' + n + ' of version ' + v));
    facts.versions = pubs.versions;

    /* ---------- runs ---------- */
    const runFile = r => { const c = {}; Object.keys(r).forEach(k => { if (k[0] !== '_') c[k] = r[k]; }); return json(c); };
    const base = r => 'runs/' + r.process + '/' + r.id + '/';
    function newRun(pub, o) {
      const t0 = o.start, r = R.create(pub, { id: o.id || id8(), title: o.title, roles: o.roles || { lead: o.by || 'person-casey' }, by: o.by || 'person-casey', session: 's-' + (o.id || id8()), now: iso(t0), tz: 'UTC', details: o.details });
      return r;
    }
    function playAll(r, by, t) {
      const map = R.mapOf(r);
      map.phases.forEach((ph, pi) => { ph.steps.forEach(s => { R.done(r, map, s.id, by, iso(t += MIN), {}); }); R.pass(r, map, pi, by, iso(t += MIN)); });
      return t;
    }
    /* 10,000 running runs of the tiny checklist. */
    const running = [];
    for (let i = 0; i < S.running; i++) { const r = newRun(tiny, { title: 'Running ' + i, start: NOW - (i + 1) * MIN, by: who(i), roles: { lead: who(i) } }); put(base(r) + 'run.json', runFile(r)); running.push(r); }
    facts.running = running.length;
    /* 400 ended runs of one version, with 5,000 follow-ups among them (a run holds at most 100). */
    let fus = 0;
    for (let i = 0; i < S.ended; i++) {
      const by = who(i), r = newRun(vers, { title: 'Ended ' + i, start: NOW - (i + 2) * HOUR, by, roles: { lead: by } });
      let t = playAll(r, by, NOW - (i + 2) * HOUR + (i % 17) * MIN);
      const n = Math.min(100, Math.ceil((S.followUps - fus) / (S.ended - i)));
      for (let k = 0; k < n; k++, fus++) R.addFollowUp(r, { id: 'f' + pad(fus, 5), text: 'Follow up ' + fus, owner: who(fus) }, by, iso(t += 1000));
      R.end(r, R.mapOf(r), 'Completed', by, by, iso(t += MIN));
      put(base(r) + 'run.json', runFile(r));
    }
    facts.followUps = fus;

    /* ---------- one busy run: 300 notes, corrections and reports, 1,000 archived answers, 300 bad note lines, on step s0 ---------- */
    /* Phase 1 has a gate of its own, so a gate's note can be corrected. */
    const busyPub = publish(head('busy', 'Busy run', { group: 'Busy' }) + phases(2, 3, n => 'Busy step ' + n).replace('\n\n## Phase 2', '\n## Gate: Phase one checked {#g1}\n\n## Phase 2'));
    const busy = newRun(busyPub, { id: 'busyrun1', title: 'Busy run', start: NOW - 3 * DAY, by: 'person-casey' });
    R.done(busy, R.mapOf(busy), 's1', 'person-casey', iso(NOW - 3 * DAY + MIN), {});
    const noteLines = [], sess = 'busy-s1';
    for (let i = 0; i < S.many; i++) noteLines.push({ id: 'n' + pad(i), at: iso(NOW - 2 * DAY + i * MIN), by: who(i), session: sess, step: 's0', text: 'Note ' + i + ' on the busy step' });
    /* Two notes sharing an ID, both older than the newest 20; 25 notes an hour ahead of the clock. */
    noteLines.push({ id: 'twin-note', at: iso(NOW - 2 * DAY - 10 * MIN), by: 'person-blake', session: sess, step: 's0', text: 'The first twin note' });
    noteLines.push({ id: 'twin-note', at: iso(NOW - 2 * DAY - 5 * MIN), by: 'person-morgan', session: sess, step: 's0', text: 'The second twin note' });
    for (let i = 0; i < 25; i++) noteLines.push({ id: 'ahead' + pad(i, 2), at: iso(NOW + HOUR + i * MIN), by: 'person-blake', session: sess, step: 's0', text: 'From a clock an hour ahead ' + i });
    const bmap = R.mapOf(busy), corr = (i, o) => C.build(Object.assign({ id: o.id || 'c' + pad(i), at: iso(NOW - 2 * DAY + i * MIN), by: who(i), session: sess, map: bmap, version: +busy.version, folder: busy.folder, step: 's0', op: 'wording', to: 'Busy step 0, worded ' + i, why: 'Reason ' + i }, o));
    for (let i = 0; i < S.many; i++) noteLines.push(corr(i, {}));
    noteLines.push(corr(900, { id: 'twin-corr', to: 'The first twin correction' }), corr(901, { id: 'twin-corr', to: 'The second twin correction' }));
    put(base(busy) + 'notes-' + sess + '.jsonl', noteLines.map(x => JSON.stringify(x)).join('\n') + '\n');
    put(base(busy) + 'notes-broken.jsonl', Array.from({ length: S.many }, (x, i) => '{"id": "bad' + i + '", "text": ').join('\n') + '\n');
    put(base(busy) + 'history-' + sess + '.jsonl', Array.from({ length: S.archived }, (x, i) => JSON.stringify({ kind: 'answer', step: 's0', s: 'done', by: who(i), at: iso(NOW - 3 * DAY + i * 1000), id: 'h' + pad(i, 5) })).join('\n') + '\n');
    put(base(busy) + 'run.json', runFile(busy));
    const report = (id, o) => json(Object.assign({ format: 'flightdeck-report/1', run: 'busy/' + busy.id, publication: { folder: busy.folder, version: +busy.version }, step: 's0', verdict: 'pass', evidence: {},
      producer: { name: 'ci-check', version: '1.0.0' }, created: iso(NOW - DAY), id, summary: 'Report ' + id }, o || {}));
    for (let i = 0; i < S.many; i++) put('reports/busy/' + busy.id + '.s0.ci-check.r' + pad(i, 7) + '.json', report('r' + pad(i, 7)));
    /* One report with 300 copies that agree, and one whose 300 copies differ. */
    for (let i = 0; i < S.many; i++) put('reports/busy/' + busy.id + '.s1.ci-check.samecopy (' + i + ').json', report('samecopy', { step: 's1' }));
    for (let i = 0; i < S.many; i++) put('reports/busy/' + busy.id + '.s2.ci-check.diffcopy (' + i + ').json', report('diffcopy', { step: 's2', summary: 'Copy ' + i }));
    facts.busy = 'busy/' + busy.id;

    /* ---------- a run with 300 conflict copies; 1,000 other runs with one each (1,000 health issues) ---------- */
    const copies = newRun(tiny, { id: 'copiesrun', title: 'Run with copies', start: NOW - DAY, by: 'person-avery' });
    put(base(copies) + 'run.json', runFile(copies));
    for (let i = 0; i < S.many; i++) put(base(copies) + 'run-COPY' + pad(i) + '.json', runFile(Object.assign({}, copies, { title: 'Copy ' + i })));
    facts.copies = 'tiny/' + copies.id;
    for (let i = 0; i < S.health; i++) put(base(running[i]) + 'run-LAPTOP.json', runFile(Object.assign({}, running[i], { title: running[i].title + ' (laptop)' })));

    /* ---------- one correction group with 400 members: the same change suggested in 400 runs ---------- */
    const vmap = R.mapOf(newRun(vers, { title: 'x', start: NOW }));
    for (let i = 0; i < S.members; i++) {
      const pth = 'runs/versions/', dir = Object.keys(files).filter(f => f.indexOf(pth) === 0 && /run\.json$/.test(f))[i];
      if (!dir) break;
      const rid = dir.split('/')[2];
      put(pth + rid + '/notes-corr.jsonl', JSON.stringify(C.build({ id: 'm' + pad(i), at: iso(NOW - 2 * HOUR + i * 1000), by: who(i), session: 'corr', map: vmap, version: +vers.info.version, folder: vers.folder, step: 's0', op: 'wording', to: 'Step 0, said better', why: 'Member ' + i })) + '\n');
    }

    /* ---------- a landed correction with 300 members: suggested in 300 v1 runs, in v2 ---------- */
    const landedMd = w => head('landed', 'Landed change', { group: 'Busy' }) + '## Only · READ-DO {#ph1}\n' + stepLine('s0', w) + stepLine('s1', 'Then the rest') + '\n';
    const l1 = publish(landedMd('Check it the old way'));
    const lmap = R.mapOf(newRun(l1, { title: 'x', start: NOW })), lnotes = [];
    for (let i = 0; i < S.many; i++) {
      const by = who(i), r = newRun(l1, { title: 'Landed ' + i, start: NOW - 30 * DAY + i * HOUR, by, roles: { lead: by } });
      R.end(r, R.mapOf(r), 'Completed', by, by, iso(playAll(r, by, NOW - 30 * DAY + i * HOUR) + MIN));
      const n = C.build({ id: 'l' + pad(i), at: iso(NOW - 30 * DAY + i * HOUR + 30 * MIN), by, session: 'landed', map: lmap, version: 1, folder: l1.folder, step: 's0', op: 'wording', to: 'Check it the new way', why: 'Landed member ' + i });
      put(base(r) + 'run.json', runFile(r)); put(base(r) + 'notes-landed.jsonl', JSON.stringify(n) + '\n');
      lnotes.push(Object.assign({}, r, { _notes: [C.cleanNote ? Object.assign({}, n) : n] }));
    }
    const l2 = publish(landedMd('Check it the new way'));
    const lg = C.groups(C.collect(lnotes.map(r => Object.assign({}, r, { _notes: r._notes.map(n => Object.assign({ files: [], fileInfo: [] }, n)) })), 'landed'))[0];
    const ld = C.decision(lg, 'person-avery', 'included', '', iso(NOW - 2 * DAY), { folder: l2.folder, version: 2 });
    put('corrections/landed/' + lg.id + '.w-landed.1.json', json(ld));
    const lrun = newRun(l2, { id: 'landedrun', title: 'On the landed version', start: NOW - HOUR, by: 'person-avery' });
    put(base(lrun) + 'run.json', runFile(lrun));
    facts.landed = 'landed/' + lrun.id;

    /* ---------- checklists that are big themselves ---------- */
    /* 300 roles, and 60 people who have done them. */
    const rolesMd = head('roles', 'Many roles', { group: 'Busy', roles: Array.from({ length: S.many }, (x, i) => 'r' + (i + 1)).join(', ') }) + '## Only · READ-DO {#ph1}\n' + Array.from({ length: S.many }, (x, i) => stepLine('s' + i, 'Role ' + (i + 1) + ' does this', { role: 'r' + (i + 1) })).join('') + '\n';
    const rolesPub = publish(rolesMd);
    for (let k = 0; k < 60; k++) {
      const roles = {}, by = who(k * 7); rolesPub.map.meta.roles.forEach(ro => { roles[ro] = by; });
      const r = newRun(rolesPub, { title: 'Roles run ' + k, start: NOW - (k + 10) * DAY, by, roles });
      R.end(r, R.mapOf(r), 'Completed', by, by, iso(playAll(r, by, NOW - (k + 10) * DAY) + MIN));
      put(base(r) + 'run.json', runFile(r));
    }
    const rolesRun = newRun(rolesPub, { id: 'rolesrun', title: 'A run with 300 roles', start: NOW - HOUR, by: 'person-avery', roles: { r1: 'person-avery' } });
    put(base(rolesRun) + 'run.json', runFile(rolesRun));
    facts.roles = 'roles/' + rolesRun.id;
    /* A team run of it someone else records: its Details show the roles to a viewer, as disabled chips. */
    const rolesTeam = newRun(rolesPub, { id: 'rolesteam', title: 'A team run with 300 roles', start: NOW - HOUR, by: 'person-blake', roles: { r1: 'person-blake', r2: 'person-casey' } });
    put(base(rolesTeam) + 'run.json', runFile(rolesTeam));
    facts.rolesTeam = 'roles/' + rolesTeam.id;
    /* The other forms that ask for every role: a staged version's Start a test run, and a step that starts a 300-role child. */
    publish(rolesMd.replace('Role 1 does this', 'Role 1 does this, staged'), 0, { stage: true, existing: pubs.roles.map(x => ({ version: x.info.version })) });
    publish(head('roleskid', 'Many roles, started from a step', { group: 'Busy', context: 'ticket', roles: rolesPub.map.meta.roles.join(', ') }) + '## Only · READ-DO {#ph1}\n' + Array.from({ length: S.many }, (x, i) => stepLine('s' + i, 'Role ' + (i + 1) + ' does this', { role: 'r' + (i + 1) })).join('') + '\n');
    const rlink = publish(head('rolelink', 'Starts many roles', { group: 'Busy' }) + '## Start · READ-DO {#start}\n- [ ] {run.process} Start the many-role run {#kid}\n  process: roleskid\n  pass: ticket=?\n\n');
    const rlRun = newRun(rlink, { id: 'rolelinkrun', title: 'A run that starts a 300-role run', start: NOW - HOUR, by: 'person-avery', roles: { lead: 'person-avery' } });
    put(base(rlRun) + 'run.json', runFile(rlRun));
    facts.rolelink = 'rolelink/' + rlRun.id;
    /* 300 phases, run, practiced, and ended five times. */
    const phasesPub = publish(head('phases', 'Many phases', { group: 'Busy' }) + phases(S.many, 1, n => 'Phase step ' + n));
    for (let k = 0; k < 5; k++) { const r = newRun(phasesPub, { title: 'Phases run ' + k, start: NOW - (k + 3) * DAY, by: 'person-casey' }); R.end(r, R.mapOf(r), 'Completed', 'person-casey', 'person-casey', iso(playAll(r, 'person-casey', NOW - (k + 3) * DAY) + MIN)); put(base(r) + 'run.json', runFile(r)); }
    const phasesRun = newRun(phasesPub, { id: 'phasesrun', title: 'A run with 300 phases', start: NOW - HOUR, by: 'person-avery' });
    put(base(phasesRun) + 'run.json', runFile(phasesRun));
    facts.phases = 'phases/' + phasesRun.id;
    /* 400 steps, 200 of them "Confirm the result"; v2 changes every step; a draft to edit. */
    const stepsMd = v => head('steps', 'Four hundred steps', { group: 'Busy' }) + phases(8, S.steps / 8, n => (n % 2 ? 'Confirm the result' : 'Do part ' + n) + (v > 1 ? ' (v' + v + ')' : ''));
    const steps1 = publish(stepsMd(1)), steps2 = publish(stepsMd(2));
    put('maps/drafts/steps.md', stepsMd(2));
    const stepsRun = newRun(steps2, { id: 'stepsrun', title: 'A run with 400 steps', start: NOW - HOUR, by: 'person-avery' });
    put(base(stepsRun) + 'run.json', runFile(stepsRun));
    /* One correction on each of 120 steps, so How runs go lists 120 steps that go off-script. */
    const smap = R.mapOf(stepsRun);
    put(base(stepsRun) + 'notes-hot.jsonl', Array.from({ length: S.hot }, (x, i) => JSON.stringify(C.build({ id: 'hot' + pad(i), at: iso(NOW - 30 * MIN + i * 1000), by: who(i), session: 'hot', map: smap, version: +stepsRun.version, folder: stepsRun.folder, step: 's' + i, op: 'wording', to: 'Step ' + i + ', said better', why: 'Hot ' + i }))).join('\n') + '\n');
    facts.steps = 'steps/' + stepsRun.id;
    /* Skills: 300 on one step and 300 for the whole checklist of v2, and one built on v1. */
    for (let i = 0; i < S.many; i++) {
      const id = 'sk-' + ('a' + pad(i, 7)).slice(0, 8), name = 'step-skill-' + pad(i, 3);
      put('skill-registrations/' + name + '/' + id + '.1.w-skills.json', json({ format: 'flightdeck-skill/2', app: '', id, rev: 1, seen: null, name, version: '1.0.0', location: 'skills/' + name,
        implements: { process: 'steps', folder: steps2.info.folder, mapHash: steps2.info.mapHash, typesHash: steps2.info.typesHash }, steps: ['s0'], tags: ['skilltag-' + (i % 40)], by: 'person-avery', updated: iso(NOW - DAY) }));
      put('skills/whole-skill-' + pad(i, 3) + '.json', json({ name: 'whole-skill-' + pad(i, 3), implements: 'steps@2', version: '1.0.0', location: 'skills/whole-' + i }));
    }
    put('skills/old-whole-skill.json', json({ name: 'old-whole-skill', implements: 'steps@1', version: '0.9.0', location: 'skills/old' }));
    /* A checklist that went from 1 role to 300, and a skill built on the 1-role version (code review round 9): its What it takes. */
    publish(head('rolesgrow', 'Roles that grew', { group: 'Busy' }) + phases(1, 2, n => 'Grown step ' + n));
    publish(head('rolesgrow', 'Roles that grew', { group: 'Busy', roles: ['lead'].concat(Array.from({ length: S.many - 1 }, (x, i) => 'r' + (i + 1))).join(', ') }) + phases(1, 2, n => 'Grown step ' + n));
    put('skills/old-roles-skill.json', json({ name: 'old-roles-skill', implements: 'rolesgrow@1', version: '0.9.0', location: 'skills/old-roles' }));
    /* A draft with 400 Run a command steps missing their command: 400 checks. */
    put('maps/drafts/commands.md', head('commands', 'Commands to fill in', { group: 'Busy' }) + phases(4, S.steps / 4, n => 'Run command ' + n, { type: 'run.command' }));
    /* 30 linked steps passing a detail their child's latest version doesn't have (slice 5): one notice, not 30. */
    publish(head('linkkid', 'Linked child', { group: 'Busy', context: 'region' }) + phases(1, 1, n => 'Child step ' + n));
    publish(head('linker', 'Many linked steps', { group: 'Busy', context: 'env' }) + '## Ship · READ-DO {#ship}\n' +
      Array.from({ length: 30 }, (x, i) => '- [ ] {run.process} Start child ' + i + ' {#lk' + i + '}\n  process: linkkid\n  pass: environment=^env\n').join(''));
    /* Code review round 10: run details and approvals by the hundred. A child draft with 300 run details, not published yet,
       and a draft whose linked step names it (the builder's What it needs); a checklist with 40 run details, the most a
       version can have (core/map.js), published and staged (Start, Plan, Start a test run), and a step that starts it asking
       for all 40 (the child's start dialog); a checklist with 300 approvals, each owned by one role (who approves). */
    const dets = Array.from({ length: S.many }, (x, i) => 'd' + pad(i, 3));
    put('maps/drafts/bigkid.md', head('bigkid', 'Big child draft', { group: 'Busy', context: dets.join(', ') }) + phases(1, 1, () => 'Use ^d000 and ^d299'));
    put('maps/drafts/linkbig.md', head('linkbig', 'Links a big draft', { group: 'Busy', context: 'env' }) + '## Ship · READ-DO {#ship}\n- [ ] {run.process} Start the big child {#lkb}\n  process: bigkid\n\n');
    const dets40 = dets.slice(0, 40), manyDetMd = v => head('manydet', 'Many run details', { group: 'Busy', context: dets40.join(', ') }) + phases(1, 2, n => 'Detail step ' + n + (v > 1 ? ' (v' + v + ')' : ''));
    publish(manyDetMd(1));
    publish(manyDetMd(2), 0, { stage: true, existing: pubs.manydet.map(x => ({ version: x.info.version })) });
    const dlink = publish(head('detlink', 'Starts many details', { group: 'Busy' }) + '## Start · READ-DO {#start}\n- [ ] {run.process} Start the many-detail run {#kid}\n  process: manydet\n  pass: ' + dets40.map(d => d + '=?').join(', ') + '\n\n');
    const dlRun = newRun(dlink, { id: 'detlinkrun', title: 'A run that starts a 40-detail run', start: NOW - HOUR, by: 'person-avery', roles: { lead: 'person-avery' } });
    put(base(dlRun) + 'run.json', runFile(dlRun));
    facts.detlink = 'detlink/' + dlRun.id;
    publish(head('gates', 'Many approvals', { group: 'Busy', roles: 'lead, approver' }) + Array.from({ length: S.many }, (x, i) => '## Phase ' + (i + 1) + ' · READ-DO {#ph' + (i + 1) + '}\n' + stepLine('s' + i, 'Gate step ' + i) + '\n## Gate: Approval ' + (i + 1) + ' · owner @approver {#g' + (i + 1) + '}\n\n').join(''));
    /* Code review round 11: a checklist whose one step and one lane name 300 roles each (the role summaries on a step, a lane,
       the previews and a run), published, with someone else's run giving every role a different person and its first step done,
       so Next up is in the 300-role lane (nothing on Avery's Home); and a draft whose linked step carries 40 run details its child doesn't have (stale). */
    const wideRoles = Array.from({ length: S.many }, (x, i) => 'w' + (i + 1)), ats = wideRoles.map(r => '@' + r).join(' ');
    const wideMd = head('wide', 'Wide roles', { group: 'Busy', roles: ['lead'].concat(wideRoles).join(', ') }) + '## Only · READ-DO {#ph1}\n' +
      '- [ ] {confirm} Everyone signs this ' + ats + ' {#all}\n\n### Track: Wide lane ' + ats + ' {#wide}\n- [ ] {confirm} In the wide lane {#inwide}\n\n' +
      '### Track: Small lane @lead {#small}\n- [ ] {confirm} In the small lane @lead {#insmall}\n\n';
    const widePub = publish(wideMd);
    put('maps/drafts/wide.md', wideMd);
    const named = people.filter(p => /^Person \d+$/.test(p.name)), wideAs = { lead: 'person-blake' };
    wideRoles.forEach((r, i) => { wideAs[r] = named[i % named.length].id; });
    const wideRun = newRun(widePub, { id: 'widerun', title: 'A run with a 300-role step', start: NOW - HOUR, by: 'person-blake', roles: wideAs });
    R.done(wideRun, R.mapOf(wideRun), 'all', 'person-blake', iso(NOW - HOUR + MIN), {});
    put(base(wideRun) + 'run.json', runFile(wideRun));
    facts.wide = 'wide/' + wideRun.id;
    publish(head('stalekid', 'Stale child', { group: 'Busy', context: 'region' }) + phases(1, 1, n => 'Stale child step ' + n));
    put('maps/drafts/staleparent.md', head('staleparent', 'Carries stale details', { group: 'Busy', context: dets40.join(', ') }) + '## Ship · READ-DO {#ship}\n' +
      '- [ ] {run.process} Start the stale child {#lks}\n  process: stalekid\n  carry: ' + dets40.join(', ') + '\n\n');
    /* 300 drafts that say the same process. */
    for (let i = 0; i < S.many; i++) put('maps/drafts/dupe-' + pad(i, 3) + '.md', head('dupes', 'Duplicated draft', { group: 'Busy' }) + phases(1, 1, () => 'Draft ' + i));

    /* ---------- versions' extras: 200 stages, 300 broken publications, a proposal with 300 records ---------- */
    for (let i = 0; i < S.stages; i++) publish(head('versions', 'Many versions', { group: 'Busy' }) + phases(2, 3, n => 'Staged step ' + n + ' of stage ' + i), 0, { stage: true, existing: pubs.versions.map(x => ({ version: x.info.version })) });
    for (let i = 0; i < S.many; i++) put('publications/versions/v' + (1000 + i) + '-broken' + pad(i, 3) + '/map.md', '---\nprocess: versions\n---\n');
    const PP = PF.proposals, ptext = head('versions', 'Many versions', { group: 'Busy' }) + phases(2, 3, n => 'Proposed step ' + n);
    const prop = PP.make({ id: 'p-mzz00000-proposal01', process: 'versions', session: 'cli-1', label: 'Proposed', by: 'An assistant', at: iso(NOW - DAY), app: '2.10.0', base: { kind: 'none', text: '' }, text: ptext });
    put('proposed/versions/' + prop.id + '.json', json(prop));
    for (let i = 1; i <= S.many / 2; i++) {
      const a = PP.attempt({ proposal: prop.id, proposalRev: prop.rev, writer: 'w-prop', n: i, how: 'apply', by: 'person-avery', at: iso(NOW - DAY + i * MIN) });
      put('proposed/versions/' + a.name, json(a.rec));
      const d = PP.decision({ proposal: prop.id, proposalRev: prop.rev, writer: 'w-prop', decisionRev: i, status: i % 2 ? 'declined' : 'reopened', by: 'person-avery', at: iso(NOW - DAY + i * MIN + 1000), attempt: 'w-prop.' + i });
      put('proposed/versions/' + d.name, json(d.rec));
    }

    /* ---------- the rest of the folder ---------- */
    const tv = {}; for (let i = 0; i < S.teamValues; i++) tv['value-' + pad(i, 3)] = { value: 'https://example.com/' + i, about: 'Team value ' + i };
    put('team-values.json', json({ format: 'flightdeck-team-values/1', values: tv }));
    for (let i = 0; i < S.many; i++) put('area-' + pad(i, 3) + '/readme.txt', 'Area ' + i + '\n');
    for (let i = 0; i < S.legacy; i++) put('runs/legacy-' + pad(i, 3) + '.json', json({ format: 'preflight-run/1', name: 'Legacy run ' + i, started: iso(NOW - 900 * DAY + i * HOUR), ended: iso(NOW - 900 * DAY + i * HOUR + MIN) }));

    /* ---------- 5,000 plans ---------- */
    for (let i = 0; i < S.plans; i++) {
      const plan = PF.plans.make(tiny, { id: 'plan-' + pad(i, 5), process: 'tiny', title: 'Planned ' + i, when: iso(NOW + (i + 1) * HOUR), by: 'person-avery', created: iso(NOW - DAY), roles: { lead: who(i) } }, false);
      put('proposals/' + plan.id + '.json', json(plan));
    }
    facts.plans = S.plans;
    return { files, facts };
  } finally { U.randomId = randomId; }
}

const memo = {};
function fixture(opts) { const k = JSON.stringify(opts || {}); return memo[k] = memo[k] || make(opts); }
/* The big folder in a booted app (test/app-harness.js): added to the examples' in-browser folder, listed by an index so
   listing costs nothing measured, read as Avery. */
async function into(app, fx) {
  const fs = app.fs, files = Object.assign({}, fs.files), now = Date.now();
  Object.keys(fx.files).forEach(p => { files[p] = { t: fx.files[p], m: now }; });
  fs.files = files; fs.persist = () => true;
  let idx = null; const proto = Object.getPrototypeOf(fs);
  ['write', 'append', 'remove', 'reset'].forEach(m => { const f = proto[m]; fs[m] = function () { idx = null; return f.apply(this, arguments); }; });
  fs.list = function (path) {
    if (!idx) { idx = new Map(); Object.keys(this.files).forEach(p => { const parts = p.split('/'); for (let i = 0; i < parts.length; i++) { const d = parts.slice(0, i).join('/'); if (!idx.has(d)) idx.set(d, new Map()); const mm = idx.get(d); if (!mm.has(parts[i])) mm.set(parts[i], i < parts.length - 1 ? 'dir' : 'file'); } }); }
    const d = idx.get(path || ''); return Promise.resolve(d ? [...d].map(([name, kind]) => ({ name, kind })) : []);
  };
  app.choose('person-avery'); await app.tick();
  const was = app.PF.perf.n['load.done'] || 0;
  app.click('refresh');
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
}
module.exports = { fixture, into, SIZE, NOW };
