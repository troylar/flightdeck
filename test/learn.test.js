// Living runs (4.0, docs/design.md 45.3), slice 5: Keep for next time. A to-do or a spread kept as a suggestion for the
// checklist it came from: one nonblocking record in proposals/, routed to the child checklist for item work and to the parent
// for phase and step work, grouped per checklist and place with every source and each wording kept, reviewed and published
// through the corrections machinery by the checklist's active owner only, and said back as Suggested, Applied to draft and
// Published in vN on both the to-do and the correction.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), T = PF.todos, L = PF.learn, C = PF.corrections, LP = PF.loop, R = PF.run, M = PF.map, P = PF.publish;
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const AT = '2026-11-10T09:00:00.000Z';
const PEOPLE = [{ id: 'person-morgan', name: 'Morgan' }, { id: 'person-avery', name: 'Avery' }, { id: 'person-blake', name: 'Blake' }, { id: 'person-casey', name: 'Casey' }];

const CHILD = ['---', 'process: validate-story', 'title: Validate a story', 'owner: person-avery', 'backup: person-blake', 'context: issue, fix_version, disposition:choice(cleared|needs-work)',
  'result: disposition', '---', '', '## Assess · DO-CONFIRM {#assess}', '- [!] {confirm} Read the story {#read}',
  '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', '', '## Wrap up {#wrap}', '- [ ] {confirm} File the result {#file}', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release readiness', 'owner: person-morgan', 'context: fix_version', '---', '', '## Stories · DO-CONFIRM {#stories}',
  '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key, fix_version=^fix_version', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', '', '## Notes {#notes}', '- [ ] {confirm} Note anything odd {#odd}', ''].join('\n');
const exactOf = (files) => P.exactOf({ 'map.md': new Uint8Array(Buffer.from(files['map.md'], 'utf8')), 'types.json': new Uint8Array(Buffer.from(files['types.json'], 'utf8')) });
let seq = 0;
function publishMd(md, n, extra) {
  const existing = []; for (let i = 1; i < (n || 1); i++) existing.push({ version: i });
  const b = P.build(md, Object.assign({ by: 'person-morgan', changes: 'x', now: AT, existing, rand: 's' + String(++seq).padStart(7, '0'), app: '4.0.0' }, extra || {}));
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const v = P.verify(b.folder, b.files, exactOf(b.files)); assert.ok(v.ok, v.why); v.folder = b.folder; v.process = M.parse(md).meta.process; v.files = b.files; v.md = b.files['map.md'];
  return v;
}
const procOf3 = (pubs) => { const i = P.index(pubs); return { latest: i.latest, all: i.all, clashes: i.clashes, broken: [] }; };
const story = (n) => ({ id: String(10000 + n), key: 'ABC-' + n, title: 'Story ' + n });
const obs = (ns) => ({ source: { system: 'jira' }, generation: 'g1', query: 'fixVersion = 4.1', observedAt: '2026-11-07T09:00:00Z', items: ns.map(story), reported: ns.length, fetched: ns.length, complete: false, errors: [] });
function scope(key, ns) {
  const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: 'r-41', step: 'each' }, observation: obs(ns), changes: [] }, key, { name: 'release-helper', version: '1.0' });
  const f = LP.buildRequest(c.intent, { seen: [], children: [], now: AT, app: '3.0.0' });
  return LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json').record;
}
let revs = 0; const rev = () => (++revs).toString(16).padStart(8, '0');
const uid = (n) => 'jira:' + (10000 + n);

function world(o) {
  o = o || {};
  const kp = publishMd(o.child || CHILD), procs = { 'validate-story': procOf3([kp]) }, procOf = (id) => procs[id] || null;
  const pp = publishMd(PARENT, 1, { childProcs: procs }); procs['release-readiness'] = procOf3([pp]);
  const r = R.create(pp, { id: 'r-41', title: 'Release 4.1', by: 'person-morgan', session: 'w', now: AT, app: '4.0.0', details: { fix_version: '4.1' }, pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) });
  r.recorder = { person: 'person-morgan' };
  const W = { r, kp, pp, procs, procOf, recs: [], unread: [], scopes: [scope('s1', [101, 102])], people: { people: PEOPLE } };
  W.push = (rec, name) => { rec._file = name || rec.id + '.json'; W.recs.push(rec); return rec; };
  W.view = () => T.view(W.r, { records: W.recs, unread: W.unread, people: W.people });
  W.ask = (body, extra) => { const Pp = T.prepare(W.r, Object.assign({ body, by: { person: 'person-morgan' }, key: 'k-' + rev(), records: W.recs, unread: W.unread, people: W.people, at: AT, app: '4.0.0' }, extra || {})); assert.ok(!Pp.why, Pp.why); W.push(Pp.record, Pp.name); return Pp; };
  W.land = () => {
    for (let i = 0; i < 100; i++) {
      const V = W.view(), q = T.nextQueued(V);
      if (!q) return;
      const plan = T.applyPlan(W.r, V, q);
      if (plan.adopt) { R.todoLand(W.r, R.mapOf(W.r), plan.adopt, { who: 'person-morgan', now: AT, typesHash: W.pp.info.typesHash, app: '4.0.0', todo: plan.adopt.application && plan.adopt.application.effect.todo ? V.byTodo[plan.adopt.application.effect.todo] || null : null, spread: plan.adopt.application && plan.adopt.application.effect.spread ? V.bySpread[plan.adopt.application.effect.spread] || null : null }); continue; }
      assert.fail(JSON.stringify(plan));
    }
  };
  W.todo = (text, target) => { const Pp = W.ask({ op: 'add', text, target }); W.land(); return Pp.preview.todo; };
  W.keep = (source, extra, by) => L.prepare(W.r, Object.assign({ source, by: by || { person: 'person-blake' }, records: W.recs, unread: W.unread, people: W.people, procOf: W.procOf, at: AT, app: '4.0.0' }, extra || {}));
  W.kept = (source, extra, by) => { const K = W.keep(source, extra, by); assert.ok(!K.why, K.why); if (K.status === 'new') W.push(K.record, K.name); return K; };
  W.groups = (pid, decisions, pubs) => C.forProcess([W.r], pid, decisions || [], { all: pubs || [W.procs[pid].latest], clashes: [] }, L.members(W.recs, [W.r], pid));
  return W;
}
const decided = (g, by, status, opts) => Object.assign(C.cleanDecision(plain(C.decision(g, by, status, status === 'declined' ? 'Not now' : '', AT, opts || {})), g.process), { _file: g.id + '.w' + rev() + '.' + 1 + '.json' });

rule('Keeping a phase to-do suggests a step at the end of that phase of the run\'s own checklist, named by its exact version', () => {
  const W = world(), td = W.todo('Post the release notes', { phase: 'ship' });
  const K = W.kept({ todo: td });
  same([K.record.kind, K.record.template.process, K.record.template.folder, K.record.template.mapHash, K.record.anchor, K.record.change], ['keep', 'release-readiness', W.pp.folder, W.pp.info.mapHash, { phase: 'ship' }, { op: 'add', text: 'Post the release notes', where: 'end' }]);
  assert.strictEqual(K.record.base, L.phaseSig(R.mapOf(W.r), 'ship'));
  assert.ok(/^Suggest for next time in release-readiness v1: add "Post the release notes" at the end of phase ship/.test(K.preview.words), K.preview.words);
});

rule('Keeping a step\'s to-do suggests the step right after it, with that step\'s signature as its baseline', () => {
  const W = world(), td = W.todo('Tag the build', { step: 'ship1' }), K = W.kept({ todo: td });
  same([K.record.anchor, K.record.change.where, K.record.base], [{ phase: 'ship', after: 'ship1' }, 'after', C.stepSig(R.mapOf(W.r), 'ship1')]);
});

rule('Item work routes to the checklist the items run; with no place said it needs placement, never a guessed parent correction', () => {
  const W = world(), td = W.todo('Check the screenshots', { item: { loopStep: 'each', uid: uid(101), attempt: 1 } });
  const K = W.kept({ todo: td });
  assert.ok(!K.record.anchor && !K.record.base, 'no place guessed');
  assert.strictEqual(K.record.template.process, 'validate-story', 'the child, never the parent');
  assert.ok(/needs placement/.test(K.preview.words) && /validate-story/.test(K.record.needs), K.preview.words);
  same(L.members(W.recs, [W.r], 'release-readiness'), [], 'no parent correction');
  same(L.members(W.recs, [W.r], 'validate-story'), [], 'nor a child one until placed');
  const P2 = W.kept({ todo: td }, { place: { after: 'read' } });
  assert.notStrictEqual(P2.id, K.id, 'placed, it is its own record');
  same([P2.record.template.process, P2.record.template.folder, P2.record.anchor], ['validate-story', W.kp.folder, { phase: 'assess', after: 'read' }]);
  assert.strictEqual(L.members(W.recs, [W.r], 'validate-story').length, 1);
  const F = L.forSource(W.recs, (pid) => W.groups(pid), W.r, { todo: td });
  assert.strictEqual(F.label, 'Suggested', 'a placed keep supersedes one that needed placement');
  assert.ok(/place/i.test(W.keep({ todo: td }, { place: { after: 'ship1' } }).why), 'a place outside the child checklist is refused');
});

rule('A spread routes to the items\' checklist, at the end of the phase its child gate closes', () => {
  const W = world(), map = R.mapOf(W.r);
  const sp = W.ask({ op: 'spread-add', loopStep: 'each', text: 'Security sign-off', child: { beforeGate: 'assess-confirm' }, scope: { open: [{ uid: uid(101), attempt: 1 }], cleared: [], fingerprint: '0123456789abcdef' } }, { childMap: W.kp.map });
  assert.ok(map);
  W.land();
  const sid = W.view().spreads[0].id, K = W.kept({ spread: sid });
  same([K.record.source, K.record.template.process, K.record.anchor, K.record.change.where], [{ spread: sid }, 'validate-story', { phase: 'assess' }, 'end']);
  assert.ok(sp);
});

rule('A child checklist that can\'t be read here leaves the keep needing placement, never on the parent', () => {
  const W = world(); const td = W.todo('Check the screenshots', { item: { loopStep: 'each', uid: uid(101), attempt: 1 } });
  W.procOf = () => null;
  const K = W.kept({ todo: td }, { place: { after: 'read' } });
  assert.ok(!K.record.anchor && !K.record.template, JSON.stringify(K.record));
  assert.ok(/can.t be used here|can.t be read/.test(K.record.needs), K.record.needs);
});

rule('A child publication that fails to read holds the keep, naming its path and kind; never Needs placement', () => {
  const W = world(), td = W.todo('Check the screenshots', { item: { loopStep: 'each', uid: uid(101), attempt: 1 } });
  const failed = { ok: false, why: 'EACCES: permission denied', folder: W.kp.folder, process: 'validate-story', _readFailed: true };
  W.procOf = (id) => id === 'validate-story' ? { latest: null, all: [], clashes: [], broken: [failed] } : W.procs[id] || null;
  const n = W.recs.length;
  for (const extra of [{ place: { after: 'read' } }, {}]) {
    const K = W.keep({ todo: td }, extra);
    assert.ok(K.held && !K.record, 'held, nothing to file: ' + JSON.stringify(K));
    assert.ok(K.why.indexOf('publications/validate-story/' + W.kp.folder + '/') >= 0 && /unreadable/.test(K.why), K.why);
  }
  W.procOf = (id) => id === 'validate-story' ? { latest: null, all: [], clashes: [], broken: [], unlisted: 'publications/validate-story/ can\'t be listed: EIO' } : W.procs[id] || null;
  const U = W.keep({ todo: td }, { place: { after: 'read' } });
  assert.ok(U.held && /publications\/validate-story\//.test(U.why), U.why);
  W.ask({ op: 'spread-add', loopStep: 'each', text: 'Security sign-off', child: { beforeGate: 'assess-confirm' }, scope: { open: [{ uid: uid(101), attempt: 1 }], cleared: [], fingerprint: '0123456789abcdef' } }, { childMap: W.kp.map });
  W.land();
  const before = L.keepsOf(W.recs).length, S = W.keep({ spread: W.view().spreads[0].id });
  assert.ok(S.held && S.why.indexOf('publications/validate-story/') >= 0, 'a spread too: ' + JSON.stringify(S));
  same([L.keepsOf(W.recs).length, before, n >= 0], [0, 0, true], 'no keep was filed');
});

rule('A draft phase emptied since the run takes the kept step at its end, once a person confirms; the next version proves it', () => {
  const W = world(), td = W.todo('Write the notes', { phase: 'notes' });
  W.kept({ todo: td });
  const g = W.groups('release-readiness')[0];
  assert.ok(g.keep && g.label === 'Suggested', g.label);
  const empty = W.pp.md.replace('- [ ] {confirm} Note anything odd {#odd}\n', '');
  const rv = C.review(g, empty);
  assert.strictEqual(rv.state, 'changed', 'its phase changed since the run\'s version');
  const ph = PF.outline.parse(rv.text).phases.find(p => p.id === 'notes');
  same(ph.steps.map(s => s.text), ['Write the notes'], 'the empty phase takes it');
  const d = decided(g, 'person-morgan', 'applied', { act: 'a1', result: C.outcome(g, rv.text, rv.added) });
  const gs1 = W.groups('release-readiness', [d]);
  assert.strictEqual(L.label(gs1[0]), 'Applied to draft');
  const v2 = publishMd(rv.text, 2, { corrections: C.forPublish(rv.text, gs1).list });
  const gs2 = W.groups('release-readiness', [d], [W.pp, v2]);
  assert.strictEqual(L.label(gs2[0]), 'Published in v2');
  const F = L.forSource(W.recs, () => gs2, W.r, { todo: td });
  same([F.label, F.group.id, F.words], ['Published in v2', g.id, 'Learned: published in release-readiness v2.']);
  const clean = C.review(g, W.pp.md);
  same([clean.state, PF.outline.parse(clean.text).phases.find(p => p.id === 'notes').steps.map(s => s.text)], ['clean', ['Note anything odd', 'Write the notes']], 'at the end of a phase as it was');
});

rule('The same to-do kept twice, by a person and by a tool, is one record; a second wording for it is another alternative in the same group', () => {
  const W = world(), td = W.todo('Post the release notes', { phase: 'ship' });
  const a = W.kept({ todo: td }), b = W.keep({ todo: td }, {}, { tool: 'notes-bot', version: '1.0' });
  same([b.status, b.id], ['already', a.id]);
  assert.strictEqual(W.keep({ todo: td }, { text: 'Post  the release notes ' }).status, 'already', 'the same words, spaced differently, are the same keep');
  const c = W.kept({ todo: td }, { text: 'Post the notes to the wiki' });
  assert.ok(c.status === 'new' && c.id !== a.id, 'another wording is its own keep');
  same([W.keep({ todo: td }, { text: 'Post the notes to the wiki' }, { tool: 'notes-bot', version: '1.0' }).status], ['already'], 'its retry is already');
  const d = W.keep({ todo: td }, { reason: 'Another reason' });
  assert.ok(d.taken && /other words/.test(d.why), 'the same wording with another reason is refused: ' + d.why);
  assert.strictEqual(L.keepsOf(W.recs).length, 2);
  const g = W.groups('release-readiness');
  same([g.length, L.alternatives(g[0]).map(x => x.text).sort()], [1, ['Post the notes to the wiki', 'Post the release notes']], 'one group, both wordings for the owner');
  same(L.forSource(W.recs, () => g, W.r, { todo: td }).keeps.length, 2);
});

rule('Keeps for one place join one group; different wording stays as alternatives the owner chooses between', () => {
  const W = world();
  const t1 = W.todo('Post the release notes', { phase: 'ship' }), t2 = W.todo('Post the  release notes', { phase: 'ship' }), t3 = W.todo('Email the release notes', { phase: 'ship' });
  W.kept({ todo: t1 }); W.kept({ todo: t2 }, {}, { tool: 'notes-bot', version: '1.0' }); W.kept({ todo: t3 }, {}, { person: 'person-casey' });
  const gs = W.groups('release-readiness');
  assert.strictEqual(gs.length, 1, 'one group per checklist and place');
  const g = gs[0];
  same([g.members.length, L.alternatives(g).map(a => [a.text, a.members.length]).sort()], [3, [['Email the release notes', 1], ['Post the release notes', 2]]], 'each wording once, with its sources');
  const rv = C.review(g, W.pp.md);
  assert.strictEqual(rv.state, 'changed', 'two wordings: the owner chooses');
  assert.ok(/2 wordings/.test(rv.reason), rv.reason);
  const pick = C.review(g, W.pp.md, 'Email the release notes');
  assert.strictEqual(pick.state, 'clean');
  const d = decided(g, 'person-morgan', 'applied', { act: 'a1', result: C.outcome(g, pick.text, pick.added) });
  const v2 = publishMd(pick.text, 2, { corrections: C.forPublish(pick.text, W.groups('release-readiness', [d])).list });
  assert.strictEqual(L.label(W.groups('release-readiness', [d], [W.pp, v2])[0]), 'Published in v2', 'the chosen wording is proved by its recorded result');
});

rule('A wording kept after the owner decided waits for review: it never inherits Applied or Published, which stay with what was reviewed', () => {
  const W = world(), t1 = W.todo('Post the release notes', { phase: 'ship' });
  W.kept({ todo: t1 });
  const g = W.groups('release-readiness')[0], rv = C.review(g, W.pp.md);
  const d = decided(g, 'person-morgan', 'applied', { act: 'a1', result: C.outcome(g, rv.text, rv.added) });
  const v2 = publishMd(rv.text, 2, { corrections: C.forPublish(rv.text, W.groups('release-readiness', [d])).list });
  const words = (td) => L.forSource(W.recs, () => W.groups('release-readiness', [d], [W.pp, v2]), W.r, { todo: td });
  same(words(t1).label, 'Published in v2');
  const t2 = W.todo('Email the release notes', { phase: 'ship' }), t3 = W.todo('Post the release notes', { phase: 'ship' });
  W.kept({ todo: t3 }, {}, { person: 'person-casey' });
  same([words(t3).label, words(t1).label], ['Published in v2', 'Published in v2'], 'the same wording as was reviewed joins what was published');
  /* Before v2: a new wording reopens the group, but the draft's applied step is still listed when it is published, so its
     proof and its owner check stay with what was reviewed. */
  const pre = W.groups('release-readiness', [d], [W.pp]);
  W.kept({ todo: t2 }, {}, { person: 'person-casey' });
  const reopened = W.groups('release-readiness', [d], [W.pp]);
  same([pre[0].status, reopened[0].status], ['applied', 'open']);
  const fp = C.forPublish(rv.text, reopened);
  same([fp.list.map(x => x.id), fp.groups.map(x => !!x.keep)], [[g.id], [true]], 'the reviewed wording is still listed for publication');
  same(C.forPublish(W.pp.md, reopened).list, [], 'a draft without it lists nothing');
  const gs = W.groups('release-readiness', [d], [W.pp, v2]);
  same(gs.length, 1);
  assert.ok(!/Published|Applied/.test(words(t2).label + words(t2).words), 'a new wording waits for the owner: ' + words(t2).words);
  same(words(t2).label, 'Suggested');
  same(words(t1).label, 'Published in v2', 'what was reviewed and published still says so');
  assert.strictEqual(gs[0].status, 'open', 'the owner reviews the new wording');
  assert.ok(gs[0].again && gs[0].again.status === 'applied', 'said as suggested again after it was applied');
  const unrelated = world(), ut = unrelated.todo('Write the notes', { phase: 'notes' });
  unrelated.kept({ todo: ut });
  const ug = unrelated.groups('release-readiness')[0];
  const ud = decided(ug, 'person-morgan', 'applied', { act: 'a1', result: C.outcome(ug, C.review(ug, unrelated.pp.md).text, C.review(ug, unrelated.pp.md).added) });
  same(unrelated.groups('release-readiness', [ud])[0].status, 'applied', 'without a new wording nothing changes');
});

rule('Only the checklist\'s active owner decides kept steps; its backup only while the owner is inactive; other corrections are unchanged', () => {
  const W = world(), td = W.todo('Post the release notes', { phase: 'ship' });
  W.kept({ todo: td });
  const g = W.groups('release-readiness')[0], proc = W.procs['release-readiness'];
  assert.strictEqual(L.ownerWhy(g, proc, PEOPLE, 'person-morgan', false), '');
  assert.ok(/Only the checklist.s owner, Morgan,/.test(L.ownerWhy(g, proc, PEOPLE, 'person-avery', false)));
  assert.ok(/people\.json/.test(L.ownerWhy(g, proc, PEOPLE, 'person-morgan', true)), 'not even the owner while people.json can\'t be read');
  assert.ok(/people\.json/.test(L.ownerWhy(g, proc, [], 'person-morgan', false)), 'nor while it lists nobody');
  const gone = PEOPLE.map(p => p.id === 'person-morgan' ? Object.assign({}, p, { inactive: true }) : p);
  assert.ok(/inactive|active/.test(L.ownerWhy(g, proc, gone, 'person-morgan', false)), 'an inactive owner can\'t decide: ' + L.ownerWhy(g, proc, gone, 'person-morgan', false));
  assert.ok(L.ownerWhy(g, proc, PEOPLE.filter(p => p.id !== 'person-morgan'), 'person-morgan', false), 'nor one people.json no longer lists');
  const kid = world(), ktd = kid.todo('Check the screenshots', { item: { loopStep: 'each', uid: uid(101), attempt: 1 } });
  kid.kept({ todo: ktd }, { place: { after: 'read' } });
  const kg = kid.groups('validate-story')[0], kproc = kid.procs['validate-story'];
  assert.ok(L.ownerWhy(kg, kproc, PEOPLE, 'person-blake', false), 'a backup while the owner is active can\'t');
  const away = PEOPLE.map(p => p.id === 'person-avery' ? Object.assign({}, p, { inactive: true }) : p);
  assert.strictEqual(L.ownerWhy(kg, kproc, away, 'person-blake', false), '', 'the backup while the owner is inactive');
  assert.ok(L.ownerWhy(kg, kproc, away, 'person-blake', true), 'never while people.json can\'t be read');
  /* The owner changes in a new version: the new owner decides from then on, the old one no longer. */
  const v2 = publishMd(CHILD.replace('owner: person-avery', 'owner: person-casey'), 2), moved = procOf3([kid.kp, v2]);
  assert.strictEqual(L.ownerWhy(kg, moved, PEOPLE, 'person-casey', false), '');
  assert.ok(L.ownerWhy(kg, moved, PEOPLE, 'person-avery', false));
  const plainGroup = { keep: false, members: [] };
  assert.strictEqual(L.ownerWhy(plainGroup, proc, PEOPLE, 'person-avery', false), '', 'anyone decides any other correction, as before');
});

rule('A draft whose place changed since the run\'s version needs a person; one whose place is gone can\'t take it', () => {
  const W = world(), t1 = W.todo('Tag the build', { step: 'ship1' }), t2 = W.todo('Write the notes', { phase: 'notes' });
  W.kept({ todo: t1 }); W.kept({ todo: t2 });
  const gs = W.groups('release-readiness'), after = gs.find(g => g.change.where === 'after'), end = gs.find(g => g.change.where === 'end');
  const changedStep = W.pp.md.replace('Ship it {#ship1}', 'Ship it to production {#ship1}');
  same([C.review(after, changedStep).state, C.review(end, changedStep).state], ['changed', 'clean']);
  const changedPhase = W.pp.md.replace('{#odd}\n', '{#odd}\n- [ ] {confirm} Check the wiki {#wiki}\n');
  const rv = C.review(end, changedPhase);
  assert.strictEqual(rv.state, 'changed', 'the phase it ends gained a step since');
  assert.ok(/phase/.test(rv.reason), rv.reason);
  const gone = W.pp.md.replace('- [!] {confirm} Ship it {#ship1}\n', '');
  same([C.review(after, gone).state, C.review(end, W.pp.md.replace('## Notes {#notes}\n- [ ] {confirm} Note anything odd {#odd}\n', '')).state], ['gone', 'gone']);
});

rule('A publication claiming a kept step it doesn\'t make, or before the run\'s own version, never makes it Published', () => {
  const W = world(), td = W.todo('Write the notes', { phase: 'notes' });
  W.kept({ todo: td });
  const g = W.groups('release-readiness')[0], rv = C.review(g, W.pp.md);
  const d = decided(g, 'person-morgan', 'applied', { act: 'a1', result: C.outcome(g, rv.text, rv.added) });
  const lie = publishMd(W.pp.md.replace('{#odd}\n', '{#odd}\n- [ ] {confirm} Something else {#else}\n'), 2, { corrections: [{ id: g.id }] });
  const gs = W.groups('release-readiness', [d], [W.pp, lie]);
  same([gs[0].landed, L.label(gs[0])], [null, 'Applied to draft']);
  const inc = Object.assign(C.cleanDecision(plain(C.decision(g, 'person-morgan', 'included', '', AT, { version: 2, folder: lie.folder, current: d })), g.process), { _file: g.id + '.w.2.json' });
  const gi = W.groups('release-readiness', [d, inc], [W.pp, lie])[0];
  assert.ok(!gi.landed && gi.proofless, '"It\'s in v2" for a version that doesn\'t make it is unconfirmed');
});

rule('A keep decision over the 500 members a decision names is refused, never truncated; an ordinary group is as before', () => {
  const mem = (n) => Array.from({ length: n }, (_, i) => ({ id: 'c' + String(i).padStart(5, '0'), by: 'person-blake', change: { text: 'Wording ' + i } }));
  const g = (n, keep) => ({ id: 'g-1', process: 'release-readiness', keep: !!keep, members: mem(n) });
  assert.strictEqual(C.decision(g(500, true), 'person-morgan', 'applied', '', AT).members.length, 500, '500 is decided');
  assert.strictEqual(C.decideWhy(g(500, true)), '');
  assert.ok(/500/.test(C.decideWhy(g(501, true))), 'the limit is named: ' + C.decideWhy(g(501, true)));
  assert.throws(() => C.decision(g(501, true), 'person-morgan', 'applied', '', AT), /500/);
  assert.strictEqual(C.decideWhy(g(501, false)), '', 'an ordinary group is decided as before');
  assert.strictEqual(C.decision(g(501, false), 'person-morgan', 'applied', '', AT).members.length, 501);
});

rule('A keep is information only: the run\'s work, holds and every other correction read exactly as without it', () => {
  const W = world(), td = W.todo('Post the release notes', { phase: 'ship' });
  const before = plain(W.view()), runs = [W.r];
  T.markHolds(runs, { records: W.recs, people: W.people }); const h0 = plain(W.r._todos);
  const pubs = { all: [W.pp], clashes: [] }, other = C.forProcess(runs, 'release-readiness', [], pubs, L.members(W.recs, runs, 'release-readiness'));
  W.kept({ todo: td });
  const V = plain(W.view());
  same([V.todos, V.chain, V.order.filter(id => !/^req-keep-/.test(id)), Object.keys(V.requests)], [before.todos, before.chain, before.order, Object.keys(before.requests)]);
  T.markHolds(runs, { records: W.recs, people: W.people }); same(plain(W.r._todos), h0, 'no hold');
  assert.strictEqual(other.length, 0);
  assert.strictEqual(C.forProcess(runs, 'release-readiness', [], pubs).length, 0, 'without keeps passed, corrections are as before');
  /* An ordinary correction group gains no new fields: its status and landing carry exactly what they did before keeps. */
  const g0 = { id: 'gabc', process: 'release-readiness', target: { step: 'ship1' }, change: { op: 'wording', to: 'Ship it now' }, sig: 'x', members: [{ id: 'c1', by: 'person-avery', version: 1, change: { op: 'wording', to: 'Ship it now' } }] };
  const st = C.status([g0], [])[0], ld = C.landing([st], [W.pp], [])[0];
  same([Object.keys(st).filter(k => !(k in g0)).sort(), Object.keys(ld).filter(k => !(k in st)).sort()], [['again', 'decision', 'label', 'status', 'tie'], ['landed', 'proofless']], 'no reviewed or reviewedLanded on an ordinary group');
});

rule('Keep records are refused whole: wrong id, a place without its checklist, text a checklist line would misread, over a limit', () => {
  const W = world(), td = W.todo('Post the release notes', { phase: 'ship' }), K = W.kept({ todo: td });
  const f = JSON.parse(T.text(K.file || L.build(Object.assign({}, K.record, { by: 'person-blake', run: W.r }))));
  const read = (o, name) => T.cleanFile(o, name || f.id + '.json');
  assert.ok(read(f).ok, read(f).why);
  const bad = [
    Object.assign({}, f, { id: f.id.replace(/.$/, f.id.slice(-1) === '0' ? '1' : '0') }),
    Object.assign({}, f, { template: undefined }),
    Object.assign({}, f, { change: Object.assign({}, f.change, { text: 'Ping @security' }) }),
    Object.assign({}, f, { change: Object.assign({}, f.change, { text: 'x'.repeat(2001) }) }),
    Object.assign({}, f, { reason: 'r'.repeat(301) }),
    Object.assign({}, f, { change: Object.assign({}, f.change, { where: 'after' }) }),
    Object.assign({}, f, { needs: 'x' }),
    Object.assign({}, f, { extra: 1 })
  ];
  bad.forEach((o, i) => assert.ok(!read(JSON.parse(JSON.stringify(o))).ok, 'damaged ' + i + ' is refused'));
  assert.ok(/@roles/.test(W.keep({ todo: td }, { text: 'Ping @security' }).why), 'a person is told why before anything is built');
  assert.ok(/Nothing was cut/.test(W.keep({ todo: td }, { reason: 'r'.repeat(301) }).why));
});

run();
