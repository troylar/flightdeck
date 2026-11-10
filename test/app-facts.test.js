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
  put(PARENT, 'release-readiness', 'rr000001');
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

run();
