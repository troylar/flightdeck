// Facts (4.0, docs/design.md 45.2) in the app, slice 4: the loop says what is known about each item by source, with its
// completeness and freshness, and missing data never reads as "no blockers". Facts change no run: importing them alone writes
// nothing. A done suggested on evidence shows that evidence while it waits, and once applied the to-do quietly says what it
// was done on. Between preparing an application and each write (the application record, then the run), the evidence and the
// authority are asked again: evidence replaced or gone stale, or a delegation revoked, lands nothing.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot, gate } = require('./app-harness');

const KID = ['---', 'process: validate-story', 'title: Validate a story', 'owner: person-avery', 'context: issue, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
  '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release 4.1', 'owner: person-avery', '---', '',
  '## Stories · DO-CONFIRM {#stories}', '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
/* The parent with a step beside the loop, open to check while the loop runs. */
const PARENT_TELL = PARENT.replace('  accepts: cleared\n', '  accepts: cleared\n- [!] {confirm} Tell the team {#tell}\n');
const HOUR = 3600000;
const BB = { feed: 'bitbucket', site: 'git.example.com' }, JIRA = { feed: 'jira' };
/* A clock the test moves forward (skew), for the app's Date. */
function clockOf() {
  const c = { skew: 0 };
  c.Date = class extends Date { constructor(...a) { if (a.length) super(...a); else super(Date.now() + c.skew); } static now() { return Date.now() + c.skew; } };
  return c;
}
async function setup(o) {
  o = o || {};
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, o.Date ? { Date: o.Date } : {})); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const put = (md, id, rand) => {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '4.0.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  };
  put(KID, 'validate-story', 'vs000001');
  put(o.parent || PARENT, 'release-readiness', 'rr000001');
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-readiness'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150); app.set('loop-add-each', ''); await app.tick();
  await refresh(app, 200);
  return app;
}
const parentPath = (app) => app.files('runs/release-readiness/').find(p => /run\.json$/.test(p));
const parentRun = (app) => JSON.parse(app.fs.files[parentPath(app)].t);
const runFiles = (app) => { const o = {}; app.files('runs/').forEach(p => { o[p] = app.fs.files[p].t; }); return o; };
const txt = (h) => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const refresh = async (app, ms) => { app.click('refresh'); await app.tick(ms || 250); };
let seq = 0; const hex = (n) => (++seq).toString(16).padStart(n, '0');
const ago = (ms) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
async function now(app) {
  const PF = app.PF, d = await PF.repo.loadAll(app.fs, {});
  const procOf = (id) => { const x = d.processes.filter(p => p.process === id)[0]; return x ? { latest: x.index.latest, all: x.index.all, clashes: x.index.clashes, broken: [] } : null; };
  const parent = d.runs.find(x => x.process === 'release-readiness');
  const items = app.PF.loop.view(parent, 'each', { records: d.scopes, runs: d.runs, procOf }).rollup.items;
  return { d, procOf, people: JSON.parse(app.fs.files['people.json'].t), parent, items, uid: (k) => items.find(i => i.key === k).uid };
}
/* A tool files one observation (what flightdeck fact sync writes), seeing what is in the folder now unless told otherwise. */
async function fact(app, key, o, records) {
  const PF = app.PF, W = await now(app);
  const P = PF.facts.prepare(W.parent, { obs: Object.assign({ key, loopStep: 'each', item: 'ABC-101', source: BB, domain: 'prs', observedAt: ago(3 * HOUR), complete: true, reported: 1, entries: [{ id: '17', text: 'Fix the login', state: 'merged' }] }, o || {}),
    by: { tool: 'git-bot', version: '1.0' }, records: records || W.d.todos, unread: W.d.todosUnread, items: W.items, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
  assert.ok(!P.why, P.why);
  await app.fs.write('proposals/' + P.name, PF.todos.text(P.file));
  return P;
}
/* An open to-do on ABC-101, asked and decided by the recorder in one gesture, and landed. */
async function todo(app) {
  const PF = app.PF, T = PF.todos, W = await now(app);
  const P = T.prepare(W.parent, { body: { op: 'add', text: 'Merge the fix', target: { item: { loopStep: 'each', uid: W.uid('ABC-101'), attempt: 1 } } }, by: { person: 'person-avery' }, key: 'k-' + hex(6), records: W.d.todos, unread: W.d.todosUnread, people: W.people, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
  assert.ok(!P.why, P.why);
  await app.fs.write('proposals/' + P.name, T.text(P.file));
  await refresh(app, 300); await refresh(app, 300);
  const r = parentRun(app);
  assert.ok(r.living && r.living.head, 'set-up: the to-do landed');
  return P.preview.todo;
}
/* git-bot may resolve to-dos on ABC-101 without a person (a delegation the recorder granted). */
async function grant(app) {
  const PF = app.PF, T = PF.todos, W = await now(app);
  const g = T.grantOf(W.parent, { subject: { tool: 'git-bot' }, ops: ['done'], targets: [{ item: { loopStep: 'each', uid: W.uid('ABC-101'), attempt: 1 } }], by: 'person-avery', key: 'g-' + hex(6), records: W.d.todos, unread: W.d.todosUnread, people: W.people, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
  assert.ok(!g.why, g.why);
  await app.fs.write('proposals/' + g.name, T.text(g.file));
  return g;
}
/* What flightdeck todo suggest-done writes: a done on the fact's evidence, named by it. */
async function suggest(app, todoId, factId) {
  const PF = app.PF, T = PF.todos, W = await now(app), x = T.view(W.parent, { records: W.d.todos, people: W.people, now: Date.now() }).byTodo[todoId];
  const S = PF.facts.supportFor(W.parent, x, factId, { records: W.d.todos, unread: W.d.todosUnread, now: Date.now() });
  assert.ok(!S.why, S.why);
  const P = T.prepare(W.parent, { body: { op: 'done', todo: todoId, support: S.support }, by: { tool: 'git-bot', version: '1.0' }, records: W.d.todos, unread: W.d.todosUnread, people: W.people, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
  assert.ok(!P.why, P.why);
  return P;
}
const apps = (app, id) => app.files('proposals/').filter(p => p.indexOf(id + '.status-') >= 0 && JSON.parse(app.fs.files[p].t).kind === 'application');
const landedFor = (app, id) => { const a = apps(app, id), r = parentRun(app); return a.length > 0 && !!r.living && a.some(p => p === 'proposals/' + r.living.head + '.json'); };
/* Holds the read the application's save makes right before it asks the guard and writes. */
function holdApplication(app, id) {
  const fs = app.fs, read = fs.read.bind(fs), hold = gate(); let n = 0, on = true;
  fs.read = (p, o) => on && n === 0 && p.indexOf('proposals/' + id + '.status-') === 0 ? (n++, hold.p.then(() => read(p, o))) : read(p, o);
  return { hold, seen: () => n, off: () => { on = false; } };
}
/* Holds the first read of the run made once the application is in the folder: the landing save's read. */
function holdLanding(app, id) {
  const fs = app.fs, read = fs.read.bind(fs), hold = gate(); let n = 0, on = true;
  fs.read = (p, o) => on && n === 0 && /runs\/release-readiness\/.*run\.json$/.test(p) && apps(app, id).length ? (n++, hold.p.then(() => read(p, o))) : read(p, o);
  return { hold, seen: () => n, off: () => { on = false; } };
}

rule('Importing facts alone changes no run bytes, however many, disputed or failed, and however often the folder is read', async () => {
  const app = await setup(), before = runFiles(app);
  const W = await now(app);
  await fact(app, 'prs-1');
  await fact(app, 'blk-1', { source: JIRA, domain: 'blockers', complete: false, reported: null, entries: [], errors: ['The links API answered 503.'] });
  /* Two observations of one slot made at once that disagree: disputed. */
  await fact(app, 'st-a', { item: 'ABC-102', source: JIRA, domain: 'status', entries: [{ id: 'ABC-102', text: 'In Review', category: 'doing' }] }, W.d.todos);
  await fact(app, 'st-b', { item: 'ABC-102', source: JIRA, domain: 'status', entries: [{ id: 'ABC-102', text: 'Done', category: 'done' }] }, W.d.todos);
  for (let i = 0; i < 3; i++) await refresh(app, 300);
  app.click('open-run', parentRun(app).process + '/' + parentRun(app).id); await app.tick(80);
  await refresh(app, 300);
  assert.deepStrictEqual(runFiles(app), before, 'no run file written');
  assert.strictEqual(parentRun(app).living, undefined, 'and the run never became a living run');
});

rule('The loop says each item\'s facts by source, with completeness and freshness; missing data never reads as no blockers; nothing to press', async () => {
  const app = await setup(), W = await now(app);
  await fact(app, 'prs-1');
  await fact(app, 'blk-1', { source: JIRA, domain: 'blockers', complete: false, reported: null, entries: [], errors: ['The links API answered 503.'] });
  await fact(app, 'st-a', { item: 'ABC-102', source: JIRA, domain: 'status', entries: [{ id: 'ABC-102', text: 'In Review', category: 'doing' }] }, W.d.todos);
  await fact(app, 'st-b', { item: 'ABC-102', source: JIRA, domain: 'status', entries: [{ id: 'ABC-102', text: 'Done', category: 'done' }] }, W.d.todos);
  await refresh(app, 300);
  const h = txt(app.html());
  assert.ok(h.includes('PRs (bitbucket · git.example.com): 1 of 1 merged · complete · checked 3 hours ago.'), (h.match(/PRs \([^\n]{0,120}/) || [h.slice(0, 400)])[0]);
  assert.ok(h.includes('Blockers (jira): couldn\'t be read (The links API answered 503.) · checked 3 hours ago.'), 'a failed read says so');
  assert.ok(h.includes('Commits: not checked.') && h.includes('Status: not checked.'), 'an unobserved domain is not checked');
  assert.ok(/Status \(jira\): disputed\./.test(h), 'contrary observations made at once show as disputed');
  assert.ok(!/no blockers|none open/i.test(h), 'missing data never reads as no blockers');
  assert.ok((app.html().match(/class="fact-lines/g) || []).length === 2, 'fact lines on the two items observed');
  assert.ok(!/data-act="fact-(?!more")/.test(app.html()), 'syncing facts goes through flightdeck fact, not buttons here');
});

rule('More than 12 contrary lines all show on first display; the limit applies only to the rest', async () => {
  const app = await setup();
  for (let i = 0; i < 14; i++) await fact(app, 'blk-' + i, { source: { feed: 'trk' + String(i).padStart(2, '0') }, domain: 'blockers', complete: true, reported: 1, entries: [{ id: 'B-' + i, text: 'Waiting ' + i, state: 'open' }] });
  for (let i = 0; i < 13; i++) await fact(app, 'prs-' + i, { source: { feed: 'git' + String(i).padStart(2, '0') } });
  await refresh(app, 300);
  const m = /<ul class="fact-lines[^"]*">([\s\S]*?)<\/ul>/.exec(app.html()), shown = m ? (m[1].match(/<li[^>]*>[\s\S]*?<\/li>/g) || []).map(txt) : [];
  assert.strictEqual(shown.filter(l => /^Blockers \(trk\d\d\): 1 open/.test(l)).length, 14, 'every contrary line: ' + shown.join(' | '));
  assert.strictEqual(shown.length - 14, 12, 'twelve of the rest');
  assert.ok(/data-act="fact-more"/.test(app.html()), 'the rest past twelve behind Show all');
});
rule('Every fact line is reachable: past the first lines a count and Show all; contrary evidence (an open blocker, a dispute) is never the part hidden', async () => {
  const app = await setup(), W = await now(app);
  for (let i = 0; i < 13; i++) await fact(app, 'prs-' + i, { source: { feed: 'git' + String(i).padStart(2, '0') } });
  await fact(app, 'blk-z', { source: { feed: 'zz-tracker' }, domain: 'blockers', complete: true, reported: 1, entries: [{ id: 'B-1', text: 'Waiting on legal', state: 'open' }] });
  await fact(app, 'st-a', { source: { feed: 'zz-jira' }, domain: 'status', entries: [{ id: 'ABC-101', text: 'Doing', category: 'doing' }] }, W.d.todos);
  await fact(app, 'st-b', { source: { feed: 'zz-jira' }, domain: 'status', entries: [{ id: 'ABC-101', text: 'Done', category: 'done' }] }, W.d.todos);
  await refresh(app, 300);
  const lines = () => { const m = /<ul class="fact-lines[^"]*">([\s\S]*?)<\/ul>/.exec(app.html()); return m ? (m[1].match(/<li[^>]*>[\s\S]*?<\/li>/g) || []).map(txt) : []; };
  const shown = lines();
  assert.ok(/^Blockers \(zz-tracker\): 1 open/.test(shown[0]) || /^Status \(zz-jira\): disputed/.test(shown[0]), 'contrary first: ' + shown.slice(0, 3).join(' | '));
  assert.ok(shown.some(l => /^Blockers \(zz-tracker\): 1 open/.test(l)) && shown.some(l => /^Status \(zz-jira\): disputed/.test(l)), 'both contrary lines shown: ' + shown.join(' | '));
  const total = 13 + 2 + 1;
  assert.ok(shown.length < total, 'set-up: more lines than are shown at first');
  const more = new RegExp('data-act="fact-more"[^>]*>Show all ' + total + ' facts').test(app.html());
  assert.ok(more && txt(app.html()).includes((total - shown.length) + ' more'), 'the count left out and Show all');
  const b = /data-act="fact-more" data-id="([^"]+)" data-item="([^"]+)"/.exec(app.html());
  app.click('fact-more', b[1], { item: b[2] }); await app.tick(20);
  assert.strictEqual(lines().length, total, 'every line, once asked');
  assert.ok(!/data-act="fact-more"/.test(app.html()));
});

rule('A done suggested on evidence shows that evidence while it waits; once applied, the to-do quietly says what it was done on', async () => {
  const app = await setup(), x = await todo(app), f = await fact(app, 'prs-1');
  const S = await suggest(app, x, f.id);
  await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
  await refresh(app, 300);
  let html = app.html(), h = txt(html);
  assert.ok(/On evidence: PRs \(bitbucket · git\.example\.com\): 1 of 1 merged · complete · checked 3 hours ago\./.test(h), (h.match(/Merge the fix[^\n]{0,300}/) || [''])[0]);
  assert.ok(!/class="small td-ack"/.test(html), 'no acknowledgment before it is applied');
  app.click('td-inbox', ''); await app.tick(20);
  const ov = app.overlay() || '';
  assert.ok(/on evidence: PRs from bitbucket/.test(txt(ov)), 'the decision shows the evidence: ' + txt(ov).slice(0, 400));
  const b = /data-act="td-accept" data-id="([^"]+)" data-run="([^"]+)" data-fp="([^"]+)"/.exec(ov);
  app.click('td-accept', b[1], { run: b[2], fp: b[3] }); await app.tick(80);
  app.click('close-overlay'); await app.tick();
  for (let i = 0; i < 3; i++) await refresh(app, 300);
  assert.ok(landedFor(app, S.id), 'set-up: applied');
  html = app.html(); h = txt(html);
  assert.ok(/class="small td-ack"/.test(html) && h.includes('Checked off on its evidence: PRs from bitbucket · git.example.com.'), (h.match(/Merge the fix[^\n]{0,300}/) || [''])[0]);
  assert.strictEqual((html.match(/class="small td-ack"/g) || []).length, 1, 'one quiet line, on the to-do');
});

rule('A plan filed under a fact\'s id as a OneDrive copy holds the suggestion resting on that fact: nothing lands', async () => {
  for (const copy of [false, true]) {
    const app = await setup(), x = await todo(app), f = await fact(app, 'prs-1', { observedAt: ago(30000) }), g = await grant(app);
    const S = await suggest(app, x, f.id);
    if (copy) app.fs.files['proposals/' + f.id + ' (1).json'] = { t: JSON.stringify({ kind: 'plan', id: f.id, process: 'release-readiness', version: 1, title: 'Later', details: {}, roles: {} }), m: Date.now() };
    await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
    await refresh(app, 300); await refresh(app, 300);
    assert.strictEqual(landedFor(app, S.id), !copy, (copy ? 'with' : 'without') + ' the plan copy: ' + JSON.stringify(parentRun(app).living));
    assert.ok(g);
  }
});

rule('An acceptance whose evidence goes stale between pressing Accept and its write writes no decision; fresh, the same press writes it', async () => {
  for (const how of ['none', 'stale']) {
    const c = clockOf(), app = await setup({ Date: c.Date }), x = await todo(app), f = await fact(app, 'prs-1', { observedAt: ago(30000), maxAgeSeconds: 120 });
    const S = await suggest(app, x, f.id);
    await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
    await refresh(app, 300);
    const W = await now(app), it = app.PF.todos.inbox([W.parent], { records: W.d.todos, unread: W.d.todosUnread, people: W.people, me: 'person-avery', now: Date.now() }).find((y) => y.id === S.id);
    assert.ok(it, how + ' set-up: waiting for Avery');
    const h = holdApplication(app, S.id);
    app.click('td-accept', S.id, { run: W.parent.process + '/' + W.parent.id, fp: it.consequence.fingerprint }); await app.tick(80);
    assert.strictEqual(h.seen(), 1, how + ' set-up: the save is held before its write');
    h.off();
    if (how === 'stale') c.skew += 5 * 60000;
    h.hold.open(); await app.tick(400);
    const decs = app.files('proposals/').filter((p) => p.indexOf(S.id + '.status-') >= 0 && JSON.parse(app.fs.files[p].t).kind === 'decision');
    assert.strictEqual(decs.length, how === 'none' ? 1 : 0, how + ': ' + decs.join(', '));
  }
});

rule('Evidence replaced or gone stale, a contrary fact about the item, or the delegation revoked, between preparing and each write lands nothing; with nothing changed it lands', async () => {
  for (const point of ['application', 'run']) {
    for (const how of ['none', 'replaced', 'stale', 'blocker', 'revoked']) {
      const c = clockOf(), app = await setup({ Date: c.Date }), x = await todo(app), f = await fact(app, 'prs-1', { observedAt: ago(30000), maxAgeSeconds: 120 }), g = await grant(app);
      const S = await suggest(app, x, f.id), tag = point + '/' + how;
      const h = point === 'application' ? holdApplication(app, S.id) : holdLanding(app, S.id);
      await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
      await refresh(app, 300);
      assert.strictEqual(h.seen(), 1, tag + ' set-up: held before the write');
      h.off();
      if (how === 'replaced') await fact(app, 'prs-2', { observedAt: ago(10000), maxAgeSeconds: 120, entries: [{ id: '17', text: 'Fix the login', state: 'open' }] });
      if (how === 'stale') c.skew += 5 * 60000;
      if (how === 'blocker') await fact(app, 'blk-1', { observedAt: ago(10000), source: JIRA, domain: 'blockers', complete: true, reported: 1, entries: [{ id: 'B-1', text: 'Waiting on legal', state: 'open' }] });
      if (how === 'revoked') {
        const W = await now(app), rv = app.PF.todos.revokeOf(W.parent, { grant: g.id, by: 'person-avery', key: 'rv-' + hex(6), records: W.d.todos, unread: W.d.todosUnread, people: W.people, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
        assert.ok(!rv.why, rv.why);
        await app.fs.write('proposals/' + rv.name, app.PF.todos.text(rv.file));
      }
      await refresh(app, 300);
      h.hold.open(); await app.tick(400);
      await refresh(app, 300);
      assert.strictEqual(landedFor(app, S.id), how === 'none', tag + ': ' + JSON.stringify(parentRun(app).living));
      if (point === 'application' && how !== 'none') assert.deepStrictEqual(apps(app, S.id), [], tag + ': no application written');
    }
  }
});

/* JB: the guards read the folder again at the write, bound to its folder and read; nothing changed in this window meanwhile
   (no Refresh between the change and the write). */
rule('A blocker filed, the evidence made unreadable, or the delegation revoked (for a decision, people.json made unreadable) while a decision, an application or a landing is held writes nothing, with no Refresh in between; with nothing changed each writes', async () => {
  for (const point of ['decision', 'application', 'run']) {
    for (const how of ['none', 'blocker', 'malformed', 'revoked']) {
      const app = await setup(), x = await todo(app), f = await fact(app, 'prs-1', { observedAt: ago(30000), maxAgeSeconds: 120 }), tag = point + '/' + how;
      const g = point === 'decision' ? null : await grant(app);
      const S = await suggest(app, x, f.id);
      let h;
      if (point === 'decision') {
        await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
        await refresh(app, 300);
        const W = await now(app), it = app.PF.todos.inbox([W.parent], { records: W.d.todos, unread: W.d.todosUnread, people: W.people, me: 'person-avery', now: Date.now() }).find((y) => y.id === S.id);
        assert.ok(it, tag + ' set-up: waiting for Avery');
        h = holdApplication(app, S.id);
        app.click('td-accept', S.id, { run: W.parent.process + '/' + W.parent.id, fp: it.consequence.fingerprint }); await app.tick(80);
      } else {
        h = point === 'application' ? holdApplication(app, S.id) : holdLanding(app, S.id);
        await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
        await refresh(app, 300);
      }
      assert.strictEqual(h.seen(), 1, tag + ' set-up: held before the write');
      h.off();
      const before = runFiles(app);
      if (how === 'blocker') await fact(app, 'blk-1', { observedAt: ago(10000), source: JIRA, domain: 'blockers', complete: true, reported: 1, entries: [{ id: 'B-1', text: 'Waiting on legal', state: 'open' }] });
      if (how === 'malformed') app.fs.files['proposals/' + f.name] = { t: '{"kind": "fact", ', m: Date.now() };
      if (how === 'revoked') {
        const W = await now(app);
        if (g) {
          const rv = app.PF.todos.revokeOf(W.parent, { grant: g.id, by: 'person-avery', key: 'rv-' + hex(6), records: W.d.todos, unread: W.d.todosUnread, people: W.people, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
          assert.ok(!rv.why, rv.why);
          await app.fs.write('proposals/' + rv.name, app.PF.todos.text(rv.file));
        } else {
          const ppl = JSON.parse(app.fs.files['people.json'].t);
          app.fs.files['people.json'] = { t: '{', m: Date.now() };
          assert.ok(ppl);
        }
      }
      h.hold.open(); await app.tick(500);
      const st = app.files('proposals/').filter((p) => p.indexOf(S.id + '.status-') >= 0).map((p) => JSON.parse(app.fs.files[p].t).kind);
      const r = parentRun(app), landed = !!r.living && apps(app, S.id).some((p) => p === 'proposals/' + r.living.head + '.json');
      if (point === 'decision') assert.deepStrictEqual(st.filter((k) => k === 'decision').length, how === 'none' ? 1 : 0, tag + ': ' + st.join(', '));
      if (point === 'application') assert.strictEqual(st.filter((k) => k === 'application').length, how === 'none' ? 1 : 0, tag + ': ' + st.join(', '));
      if (point !== 'decision') assert.strictEqual(landed, how === 'none', tag + ': ' + JSON.stringify(r.living));
      if (point === 'run' && how !== 'none') assert.deepStrictEqual(runFiles(app), before, tag + ': the run is as it was');
      if (point === 'run' && how !== 'none') assert.ok(!/data-act="retry-save"/.test(app.html()), tag + ': the landing is put back, never kept for Try again');
    }
  }
});

/* KA: a pause at each write of the landing's save chain (held right after the step before it), then a change with no Refresh. */
function holdAt(app, at) {
  const fs = app.fs, hold = gate(); let n = 0, on = true;
  const after = (p) => p.then((r) => hold.p.then(() => r));
  if (at === 'before candidate') {
    const read = fs.read.bind(fs);
    fs.read = (p, o) => on && n === 0 && /runs\/release-readiness\/.*run\.json$/.test(p) && apps(app, '').length ? (n++, hold.p.then(() => read(p, o))) : read(p, o);
  } else if (at === 'after archive') {
    const ap = fs.append.bind(fs);
    fs.append = (p, t) => on && n === 0 && /runs\/release-readiness\/.*history-[^/]*\.jsonl$/.test(p) ? (n++, after(ap(p, t))) : ap(p, t);
  } else {
    const w = fs.write.bind(fs);
    fs.write = (p, t) => on && n === 0 && /runs\/release-readiness\/.*\/candidate-[^/]*\.json$/.test(p) ? (n++, after(w(p, t))) : w(p, t);
  }
  return { hold, seen: () => n, off: () => { on = false; } };
}
/* The parent's log filled to its limit on disk, so the landing's own log line moves the oldest one to the history file. */
async function fullLog(app) {
  const p = parentPath(app), r = JSON.parse(app.fs.files[p].t), at = new Date().toISOString();
  while (r.log.length < 300) r.log.unshift({ at, by: 'person-avery', what: 'Padding ' + r.log.length });
  app.fs.files[p] = { t: JSON.stringify(r, null, 2), m: Date.now() };
  await refresh(app, 300);
}
const historyOf = (app) => app.files('runs/release-readiness/').filter((p) => /history-[^/]*\.jsonl$/.test(p)).map((p) => app.fs.files[p].t).join('');
rule('A blocker, unreadable evidence, the evidence replaced by an open PR, or the delegation revoked, at any write of the landing (before the candidate, after it, after the history, before run.json) lands nothing, with no Refresh in between; with nothing changed it lands', async () => {
  for (const at of ['before candidate', 'after candidate', 'after archive', 'before final']) {
    for (const how of ['none', 'blocker', 'malformed', 'replaced', 'revoked']) {
      const app = await setup(), x = await todo(app), f = await fact(app, 'prs-1', { observedAt: ago(30000), maxAgeSeconds: 120 }), g = await grant(app), tag = at + '/' + how;
      if (at !== 'before final') await fullLog(app);
      const S = await suggest(app, x, f.id);
      const h = holdAt(app, at), hist0 = historyOf(app);
      await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
      await refresh(app, 300);
      assert.strictEqual(h.seen(), 1, tag + ' set-up: held at that write');
      h.off();
      const run0 = app.fs.files[parentPath(app)].t;
      if (how === 'blocker') await fact(app, 'blk-1', { observedAt: ago(10000), source: JIRA, domain: 'blockers', complete: true, reported: 1, entries: [{ id: 'B-1', text: 'Waiting on legal', state: 'open' }] });
      if (how === 'malformed') app.fs.files['proposals/' + f.name] = { t: '{"kind": "fact", ', m: Date.now() };
      if (how === 'replaced') await fact(app, 'prs-2', { observedAt: ago(10000), maxAgeSeconds: 120, entries: [{ id: '17', text: 'Fix the login', state: 'open' }] });
      if (how === 'revoked') {
        const W = await now(app), rv = app.PF.todos.revokeOf(W.parent, { grant: g.id, by: 'person-avery', key: 'rv-' + hex(6), records: W.d.todos, unread: W.d.todosUnread, people: W.people, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
        assert.ok(!rv.why, rv.why);
        await app.fs.write('proposals/' + rv.name, app.PF.todos.text(rv.file));
      }
      h.hold.open(); await app.tick(500);
      const r = parentRun(app), landed = !!r.living && apps(app, S.id).some((p) => p === 'proposals/' + r.living.head + '.json');
      assert.strictEqual(landed, how === 'none', tag + ': ' + JSON.stringify(r.living));
      if (how !== 'none') {
        assert.strictEqual(app.fs.files[parentPath(app)].t, run0, tag + ': run.json is as it was');
        assert.ok(!/data-act="retry-save"/.test(app.html()), tag + ': the landing is put back, never kept for Try again');
        if (at === 'after candidate') assert.strictEqual(historyOf(app), hist0, tag + ': nothing archived');
      } else if (at !== 'before final') assert.ok(historyOf(app).length > hist0.length, tag + ' set-up: the landing archived its oldest line');
    }
  }
});

/* LB: every log line the run had, in run.json or its history (the oldest move there past 300). */
const logLines = (app) => {
  const r = parentRun(app), out = new Set(r.log.map((l) => l.at + '|' + l.by + '|' + l.what));
  historyOf(app).split('\n').filter(Boolean).forEach((t) => { const x = JSON.parse(t); if (x.kind === 'log') out.add(x.at + '|' + x.by + '|' + x.what); });
  return out;
};
const blocker = (app) => fact(app, 'blk-1', { observedAt: ago(10000), source: JIRA, domain: 'blockers', complete: true, reported: 1, entries: [{ id: 'B-1', text: 'Waiting on legal', state: 'open' }] });
rule('A landing put back while a Pause, a note or a step check was made meanwhile loses no log line (run.json and the history together keep every one) and the other change is saved', async () => {
  for (const at of ['before candidate', 'after candidate', 'after archive', 'before final']) {
    for (const edit of ['pause', 'note', 'check']) {
      const app = await setup({ parent: PARENT_TELL }), x = await todo(app), f = await fact(app, 'prs-1', { observedAt: ago(30000), maxAgeSeconds: 120 }), g = await grant(app), tag = at + '/' + edit;
      await fullLog(app);
      app.click('open-run', parentRun(app).process + '/' + parentRun(app).id); await app.tick(80);
      const S = await suggest(app, x, f.id);
      const h = holdAt(app, at);
      await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
      await refresh(app, 300);
      assert.strictEqual(h.seen(), 1, tag + ' set-up: held at that write');
      h.off();
      const orig = logLines(app);
      await blocker(app);
      if (edit === 'pause') { app.click('pick', 'run', { kind: 'pause' }); await app.tick(); app.set('pick-input', 'Waiting'); app.click('pause', 'run'); }
      if (edit === 'note') { app.click('select', 'tell'); await app.tick(); app.set('note-text', 'A note meanwhile'); app.click('add-note', 'tell'); }
      if (edit === 'check') app.click('toggle', 'tell');
      await app.tick(40);
      h.hold.open(); await app.tick(600);
      const r = parentRun(app), landed = !!r.living && apps(app, S.id).some((p) => p === 'proposals/' + r.living.head + '.json');
      assert.strictEqual(landed, false, tag + ': nothing lands');
      const now1 = logLines(app), lost = [...orig].filter((k) => !now1.has(k));
      assert.deepStrictEqual(lost, [], tag + ': no log line lost');
      if (edit === 'pause') assert.ok(r.paused, tag + ': the pause is saved');
      if (edit === 'note') assert.ok(app.files('runs/release-readiness/').some((p) => app.fs.files[p].t.includes('A note meanwhile')), tag + ': the note is saved');
      if (edit === 'check') assert.ok(r.steps && r.steps.tell && r.steps.tell.s === 'done', tag + ': the check is saved: ' + JSON.stringify(r.steps));
      assert.ok(g);
    }
  }
});

/* LA: keeping a conflict copy (Use copy) that holds a supported done this run never landed goes through the same save-chain
   guard as a landing: a change at any of its writes keeps nothing of the copy's to-dos, and the copy stays. */
rule('Use copy of a copy holding a supported done: a blocker, unreadable evidence, an open-PR replacement or the delegation revoked at any write of its save keeps none of it and the copy stays, with no Refresh in between; with nothing changed it is kept', async () => {
  for (const at of ['before candidate', 'after candidate', 'after archive', 'before final']) {
    for (const how of ['none', 'blocker', 'malformed', 'replaced', 'revoked']) {
      const app = await setup(), x = await todo(app), f = await fact(app, 'prs-1', { observedAt: ago(30000), maxAgeSeconds: 120 }), g = await grant(app), tag = 'use copy/' + at + '/' + how;
      if (at !== 'before final') await fullLog(app);
      const pre = app.fs.files[parentPath(app)].t, S = await suggest(app, x, f.id);
      await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
      await refresh(app, 300); await refresh(app, 300);
      assert.ok(landedFor(app, S.id), tag + ' set-up: landed');
      const landed = app.fs.files[parentPath(app)].t, cp = parentPath(app).replace('run.json', 'run-OTHER.json');
      await app.fs.write(cp, landed);
      const r0 = JSON.parse(pre); r0.paused = { by: 'person-avery', at: new Date().toISOString(), reason: 'Lunch' }; r0.rev = (JSON.parse(landed).rev || 0) + 1;
      await app.fs.write(parentPath(app), JSON.stringify(r0, null, 2));
      await refresh(app, 300);
      app.click('open-run', r0.process + '/' + r0.id); await app.tick(80);
      assert.ok(/data-act="use-copy"/.test(app.html()), tag + ' set-up: the copy is offered');
      assert.ok(!landedFor(app, S.id), tag + ' set-up: not landed here');
      const h = holdAt(app, at);
      app.click('use-copy', 'run-OTHER.json'); await app.tick(80);
      assert.strictEqual(h.seen(), 1, tag + ' set-up: held at that write');
      h.off();
      if (how === 'blocker') await blocker(app);
      if (how === 'malformed') app.fs.files['proposals/' + f.name] = { t: '{"kind": "fact", ', m: Date.now() };
      if (how === 'replaced') await fact(app, 'prs-2', { observedAt: ago(10000), maxAgeSeconds: 120, entries: [{ id: '17', text: 'Fix the login', state: 'open' }] });
      if (how === 'revoked') {
        const W = await now(app), rv = app.PF.todos.revokeOf(W.parent, { grant: g.id, by: 'person-avery', key: 'rv-' + hex(6), records: W.d.todos, unread: W.d.todosUnread, people: W.people, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
        assert.ok(!rv.why, rv.why);
        await app.fs.write('proposals/' + rv.name, app.PF.todos.text(rv.file));
      }
      h.hold.open(); await app.tick(600);
      assert.strictEqual(landedFor(app, S.id), how === 'none', tag + ': ' + JSON.stringify(parentRun(app).living));
      assert.strictEqual(!!app.fs.files[cp], how !== 'none', tag + ': the copy ' + (how === 'none' ? 'is removed once kept' : 'stays'));
    }
  }
});

/* MA: one write of the run's save fails (an I/O error, not a guard refusal). */
function failAt(app, at) {
  const fs = app.fs; let n = 0;
  const err = () => Promise.reject(new Error('EIO: the folder answered an error'));
  if (at === 'history') { const ap = fs.append.bind(fs); fs.append = (p, t) => n === 0 && /runs\/release-readiness\/.*history-[^/]*\.jsonl$/.test(p) ? (n++, err()) : ap(p, t); }
  else { const w = fs.write.bind(fs), re = at === 'candidate' ? /runs\/release-readiness\/.*\/candidate-[^/]*\.json$/ : /runs\/release-readiness\/[^/]+\/run\.json$/; fs.write = (p, t) => n === 0 && re.test(p) ? (n++, err()) : w(p, t); }
  return () => n;
}
rule('Use copy whose save fails at the candidate, the history or run.json keeps nothing in this window: a later Resume, after a blocker or a revoked delegation, lands nothing, and the copy stays', async () => {
  for (const at of ['candidate', 'history', 'final']) {
    for (const how of ['blocker', 'revoked']) {
      const app = await setup(), x = await todo(app), f = await fact(app, 'prs-1', { observedAt: ago(30000), maxAgeSeconds: 120 }), g = await grant(app), tag = 'use copy fails/' + at + '/' + how;
      await fullLog(app);
      const pre = app.fs.files[parentPath(app)].t, S = await suggest(app, x, f.id);
      await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
      await refresh(app, 300); await refresh(app, 300);
      assert.ok(landedFor(app, S.id), tag + ' set-up: landed');
      const landed = app.fs.files[parentPath(app)].t, cp = parentPath(app).replace('run.json', 'run-OTHER.json');
      await app.fs.write(cp, landed);
      const r0 = JSON.parse(pre); r0.paused = { by: 'person-avery', at: new Date().toISOString(), reason: 'Lunch' }; r0.rev = (JSON.parse(landed).rev || 0) + 1;
      await app.fs.write(parentPath(app), JSON.stringify(r0, null, 2));
      await refresh(app, 300);
      app.click('open-run', r0.process + '/' + r0.id); await app.tick(80);
      assert.ok(/data-act="use-copy"/.test(app.html()), tag + ' set-up: the copy is offered');
      const failed = failAt(app, at);
      app.click('use-copy', 'run-OTHER.json'); await app.tick(400);
      assert.strictEqual(failed(), 1, tag + ' set-up: that write failed');
      assert.ok(!landedFor(app, S.id), tag + ' set-up: not kept');
      if (how === 'blocker') await blocker(app);
      if (how === 'revoked') {
        const W = await now(app), rv = app.PF.todos.revokeOf(W.parent, { grant: g.id, by: 'person-avery', key: 'rv-' + hex(6), records: W.d.todos, unread: W.d.todosUnread, people: W.people, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
        assert.ok(!rv.why, rv.why);
        await app.fs.write('proposals/' + rv.name, app.PF.todos.text(rv.file));
      }
      app.click('resume', 'run'); await app.tick(400);
      await refresh(app, 300);
      const r = parentRun(app);
      assert.ok(!r.paused, tag + ' set-up: resumed');
      assert.strictEqual(landedFor(app, S.id), false, tag + ': ' + JSON.stringify(r.living));
      assert.ok(app.fs.files[cp], tag + ': the copy stays');
    }
  }
});

/* NA: the save meets a run changed on disk, and the conflict copy it keeps fails to write. */
rule('A landing or a copy kept whose conflict copy fails to write keeps nothing in this window: after a blocker, a later Pause or Resume persists no unsupported head in run.json or any conflict copy', async () => {
  for (const caller of ['landing', 'use copy']) {
    const app = await setup(), x = await todo(app), f = await fact(app, 'prs-1', { observedAt: ago(30000), maxAgeSeconds: 120 }), g = await grant(app), tag = caller;
    const S = await suggest(app, x, f.id);
    let cp = null;
    if (caller === 'use copy') {
      const pre = app.fs.files[parentPath(app)].t;
      await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
      await refresh(app, 300); await refresh(app, 300);
      assert.ok(landedFor(app, S.id), tag + ' set-up: landed');
      const landed = app.fs.files[parentPath(app)].t; cp = parentPath(app).replace('run.json', 'run-OTHER.json');
      await app.fs.write(cp, landed);
      const r0 = JSON.parse(pre); r0.paused = { by: 'person-avery', at: new Date().toISOString(), reason: 'Lunch' }; r0.rev = (JSON.parse(landed).rev || 0) + 1;
      await app.fs.write(parentPath(app), JSON.stringify(r0, null, 2));
      await refresh(app, 300);
    }
    app.click('open-run', parentRun(app).process + '/' + parentRun(app).id); await app.tick(80);
    const head = () => { const a = apps(app, S.id); return a.length ? a[0].replace(/^proposals\//, '').replace(/\.json$/, '') : '?'; };
    const h = holdAt(app, 'before candidate');
    if (caller === 'landing') { await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file)); await refresh(app, 300); }
    else { app.click('use-copy', 'run-OTHER.json'); await app.tick(80); }
    assert.strictEqual(h.seen(), 1, tag + ' set-up: held at the read');
    h.off();
    /* Another window saved the run meanwhile, and the conflict copy this save keeps can't be written. */
    const other = JSON.parse(app.fs.files[parentPath(app)].t); other.rev = (other.rev || 0) + 1; other.recorder.session = 'another-window';
    app.fs.files[parentPath(app)] = { t: JSON.stringify(other, null, 2), m: Date.now() };
    /* The conflict copy's write waits, then fails; the blocker is filed while it waits, after the guard let it start. */
    const w = app.fs.write.bind(app.fs), cw = gate(); let n = 0;
    app.fs.write = (p, t) => n === 0 && /run\.conflict-[^/]*\.json$/.test(p) ? (n++, cw.p.then(() => Promise.reject(new Error('EIO: the folder answered an error')))) : w(p, t);
    /* The person pauses while the conflict copy is written (a landing): an edit of their own, so the run as this window has
       it stays on screen rather than replaced by the other window's. A copy being kept holds every edit until it is done. */
    const pause = async () => { app.click('pick', 'run', { kind: 'pause' }); await app.tick(); app.set('pick-input', 'Waiting'); app.click('pause', 'run'); await app.tick(5); };
    h.hold.open(); await app.tick(300);
    assert.strictEqual(n, 1, tag + ' set-up: the conflict copy is being written');
    await blocker(app);
    if (caller === 'landing') { await pause(); assert.ok(/data-act="resume"/.test(app.html()), tag + ' set-up: paused while the conflict copy is written'); }
    cw.open(); await app.tick(500);
    /* Then the next edits save the run as this window has it (a Resume, a Pause again). */
    app.click('resume', 'run'); await app.tick(400);
    if (caller === 'landing') { await pause(); await app.tick(400); }
    await refresh(app, 300);
    const id = head(), holders = app.files('runs/release-readiness/').filter((p) => p !== cp && /(run|run\.conflict-[^/]*)\.json$/.test(p) && /^runs\/release-readiness\/[^/]+\/run[.a-z0-9-]*\.json$/.test(p) && app.fs.files[p].t.includes(id));
    assert.deepStrictEqual(holders, [], tag + ': no run file or conflict copy holds the unsupported head ' + id);
    if (cp) assert.ok(app.fs.files[cp], tag + ': the copy stays');
    assert.ok(g);
  }
});


/* PA: a story's to-do done on evidence filed on its parent (the loop's run): every guarded write reads that run and its pinned
   version again, never the copy this window read last. */
const SF = require('./app-spread-fixture');
async function storyWorld() {
  const app = await SF.setup(), PF = app.PF, T = PF.todos;
  let W = await SF.now(app);
  const kid0 = W.d.runs.find(x => x.process === 'validate-story' && x.parent.item.key === 'ABC-102'), kk = kid0.process + '/' + kid0.id;
  const A = T.prepare(kid0, { body: { op: 'add', text: 'Merge the fix', target: { phase: 'assess' } }, by: { person: 'person-avery' }, key: 'pa-' + hex(6), records: W.d.todos, unread: W.d.todosUnread, people: W.people, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
  assert.ok(!A.why, A.why);
  await app.fs.write('proposals/' + A.name, T.text(A.file));
  for (let i = 0; i < 3; i++) await refresh(app, 300);
  W = await SF.now(app);
  const items = PF.loop.view(W.parent, 'each', { records: W.d.scopes, runs: W.d.runs, procOf: W.procOf }).rollup.items;
  const F = PF.facts.prepare(W.parent, { obs: { key: 'pa-prs', loopStep: 'each', item: 'ABC-102', source: BB, domain: 'prs', observedAt: ago(30000), maxAgeSeconds: 120, complete: true, reported: 1, entries: [{ id: '17', text: 'Fix the login', state: 'merged' }] },
    by: { tool: 'git-bot', version: '1.0' }, records: W.d.todos, unread: W.d.todosUnread, items, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
  assert.ok(!F.why, F.why);
  await app.fs.write('proposals/' + F.name, PF.todos.text(F.file));
  W = await SF.now(app);
  const kid = W.d.runs.find(x => x.process + '/' + x.id === kk), x = T.view(kid, { records: T.recordsFor(W.d.todos, kid), people: W.people, now: Date.now() }).byTodo[A.preview.todo];
  assert.ok(x && x.state === 'open', 'set-up: the story\'s to-do is open');
  const kidPath = () => app.files('runs/validate-story/').find(p => p.indexOf('/' + kid0.id + '/') > 0 && /\/run\.json$/.test(p));
  const grantIt = async () => {
    const V = await SF.now(app), k = V.d.runs.find(y => y.process + '/' + y.id === kk);
    const g = T.grantOf(k, { subject: { tool: 'git-bot' }, ops: ['done'], targets: [{ phase: 'assess' }], by: 'person-avery', key: 'g-' + hex(6), records: V.d.todos, unread: V.d.todosUnread, people: V.people, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
    assert.ok(!g.why, g.why);
    await app.fs.write('proposals/' + g.name, T.text(g.file));
  };
  const suggestIt = async () => {
    const V = await SF.now(app), k = V.d.runs.find(y => y.process + '/' + y.id === kk), y = T.view(k, { records: T.recordsFor(V.d.todos, k), people: V.people, now: Date.now() }).byTodo[A.preview.todo];
    const S = PF.facts.supportFor(k, y, F.id, { records: V.d.todos, unread: V.d.todosUnread, now: Date.now() });
    assert.ok(!S.why, S.why);
    const P = T.prepare(k, { body: { op: 'done', todo: A.preview.todo, support: S.support }, by: { tool: 'git-bot', version: '1.0' }, records: V.d.todos, unread: V.d.todosUnread, people: V.people, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
    assert.ok(!P.why, P.why);
    return P;
  };
  return { app, kk, kidPath, grantIt, suggestIt, fact: F };
}
/* Holds the first read of a path matching re once cond() holds. */
function holdRead(app, re, cond) {
  const fs = app.fs, read = fs.read.bind(fs), hold = gate(); let n = 0, on = true;
  fs.read = (p, o) => on && n === 0 && re.test(p) && (!cond || cond()) ? (n++, hold.p.then(() => read(p, o))) : read(p, o);
  return { hold, seen: () => n, off: () => { on = false; } };
}
/* The evidence's run made unreadable, with no Refresh: its run.json gone or answering an error, or its pinned version gone. */
function breakEvidence(app, how) {
  const rp = SF.parentPath(app);
  if (how === 'gone') { delete app.fs.files[rp]; return; }
  if (how === 'eio') { const read = app.fs.read.bind(app.fs); app.fs.read = (p, o) => p === rp ? Promise.reject(new Error('EIO: the folder answered an error')) : read(p, o); return; }
  if (how === 'pin') app.files('publications/release-readiness/').forEach((p) => { delete app.fs.files[p]; });
}
const storyFiles = (app, kk) => { const o = {}; app.files('runs/' + kk + '/').forEach(p => { o[p] = app.fs.files[p].t; }); return o; };
const kindsOf = (app, id) => app.files('proposals/').filter((p) => p.indexOf(id + '.status-') >= 0).map((p) => JSON.parse(app.fs.files[p].t).kind);
rule('PA: the run a story\'s evidence is on, or its pinned version, gone or unreadable while a decision, an application or a landing is held writes no decision, application, candidate or run.json; with nothing changed each writes', async () => {
  for (const point of ['decision', 'application', 'run']) {
    for (const how of ['none', 'gone', 'eio', 'pin']) {
      const Wd = await storyWorld(), app = Wd.app, tag = point + '/' + how;
      if (point !== 'decision') await Wd.grantIt();
      const S = await Wd.suggestIt();
      let h;
      if (point === 'decision') {
        await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
        await refresh(app, 300);
        const W = await SF.now(app), it = app.PF.todos.inbox(W.d.runs.filter(y => y.process + '/' + y.id === Wd.kk), { records: W.d.todos, unread: W.d.todosUnread, people: W.people, me: 'person-avery', now: Date.now() }).find((y) => y.id === S.id);
        assert.ok(it, tag + ' set-up: waiting for Avery');
        h = holdRead(app, new RegExp('^proposals/' + S.id + '\\.status-'));
        app.click('td-accept', S.id, { run: Wd.kk, fp: it.consequence.fingerprint }); await app.tick(80);
      } else {
        h = point === 'application' ? holdRead(app, new RegExp('^proposals/' + S.id + '\\.status-')) : holdRead(app, /^runs\/validate-story\/.*run\.json$/, () => kindsOf(app, S.id).indexOf('application') >= 0);
        await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
        await refresh(app, 300);
      }
      assert.strictEqual(h.seen(), 1, tag + ' set-up: held before the write');
      h.off();
      const before = storyFiles(app, Wd.kk);
      breakEvidence(app, how);
      h.hold.open(); await app.tick(500);
      const st = kindsOf(app, S.id), r = JSON.parse(app.fs.files[Wd.kidPath()].t);
      const landed = !!r.living && st.indexOf('application') >= 0 && app.files('proposals/').some((p) => p === 'proposals/' + r.living.head + '.json' && p.indexOf(S.id + '.status-') >= 0);
      if (point === 'decision') assert.strictEqual(st.filter((k) => k === 'decision').length, how === 'none' ? 1 : 0, tag + ': ' + st.join(', '));
      if (point === 'application') assert.strictEqual(st.filter((k) => k === 'application').length, how === 'none' ? 1 : 0, tag + ': ' + st.join(', '));
      if (point !== 'decision') assert.strictEqual(landed, how === 'none', tag + ': ' + JSON.stringify(r.living));
      if (point === 'run' && how !== 'none') assert.deepStrictEqual(storyFiles(app, Wd.kk), before, tag + ': no candidate or run.json is written');
    }
  }
});
rule('PA: the run a story\'s evidence is on, or its pinned version, gone or unreadable while Use copy is held keeps nothing of the copy and writes no candidate or run.json; with nothing changed it is kept', async () => {
  for (const how of ['none', 'gone', 'eio', 'pin']) {
    const Wd = await storyWorld(), app = Wd.app, tag = 'use copy/' + how;
    await Wd.grantIt();
    const pre = app.fs.files[Wd.kidPath()].t, S = await Wd.suggestIt();
    await app.fs.write('proposals/' + S.name, app.PF.todos.text(S.file));
    await refresh(app, 300); await refresh(app, 300);
    const head = () => JSON.parse(app.fs.files[Wd.kidPath()].t).living, isMine = (lv) => !!lv && app.files('proposals/').some((p) => p === 'proposals/' + lv.head + '.json' && p.indexOf(S.id + '.status-') >= 0);
    assert.ok(isMine(head()), tag + ' set-up: landed');
    const landed = app.fs.files[Wd.kidPath()].t, cp = Wd.kidPath().replace('run.json', 'run-OTHER.json');
    await app.fs.write(cp, landed);
    const r0 = JSON.parse(pre); r0.paused = { by: 'person-avery', at: new Date().toISOString(), reason: 'Lunch' }; r0.rev = (JSON.parse(landed).rev || 0) + 1;
    await app.fs.write(Wd.kidPath(), JSON.stringify(r0, null, 2));
    await refresh(app, 300);
    app.click('open-run', Wd.kk); await app.tick(80);
    assert.ok(/data-act="use-copy"/.test(app.html()), tag + ' set-up: the copy is offered');
    assert.ok(!isMine(head()), tag + ' set-up: not landed here');
    const h = holdRead(app, /^runs\/validate-story\/.*run\.json$/);
    app.click('use-copy', 'run-OTHER.json'); await app.tick(80);
    assert.strictEqual(h.seen(), 1, tag + ' set-up: held before the candidate');
    h.off();
    const before = storyFiles(app, Wd.kk);
    breakEvidence(app, how);
    h.hold.open(); await app.tick(600);
    assert.strictEqual(isMine(head()), how === 'none', tag + ': ' + JSON.stringify(head()));
    assert.strictEqual(!!app.fs.files[cp], how !== 'none', tag + ': the copy ' + (how === 'none' ? 'is removed once kept' : 'stays'));
    if (how !== 'none') assert.deepStrictEqual(storyFiles(app, Wd.kk), before, tag + ': no candidate or run.json is written');
  }
});

run();
