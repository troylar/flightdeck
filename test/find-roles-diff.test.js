// Find things in big folders (2.11), code review round 16: the Start and Plan forms' roles, past the first 20, are hidden
// fields, and each must submit exactly what its select would hold in 2.10, where every role is a drawn <select> and the
// page's own carry-over across redraws decides what's submitted. This drives the last release's shipped page, 2.11.0's (the cached release,
// tools/old-bundles.js) and this build side by side, in the same stand-in page (test/app-harness.js, liveForms: every drawn
// control a live node, a select's value one of its options), through the same seeded random events, and after each one
// compares every role value the open form would send. ROLES_SEED=<n> picks another walk; ROLES_STEPS=<n> sets its length.
'use strict';
const assert = require('assert');
const { load, exactOf, rule, run } = require('./harness');
const { boot, folderHandle, memoryIDB } = require('./app-harness');
const bundles = require('../tools/old-bundles');

const SEED = +(process.env.ROLES_SEED || 16), STEPS = +(process.env.ROLES_STEPS || 45);
const PID = 'manyroles', PLAN = 'plan-manyroles-diff', PLAN_FILE = 'proposals/' + PLAN + '.json';
const NOW = Date.parse('2026-10-26T12:00:00.000Z'), DAY = 86400000, iso = ms => new Date(ms).toISOString();
const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* Divergences from 2.10 that are intended (the 2.11 plan says so), by event, with why. None: every role, drawn or not, is
   what 2.10 would send, after every event this walk makes. */
const INTENDED = [];

let mainHtml = null;
function shipped() {
  if (mainHtml) return mainHtml;
  const b = bundles.get('v2.11.0');
  assert.ok(b, '2.11.0\'s shipped page is needed (node tools/old-bundles.js caches it from the release tag)');
  return (mainHtml = b.files['flightdeck.html']);
}

/* The checklist (n roles, r3 approving a gate), its versions as published, past runs and a saved plan, made with the real
   rules once per walk; both windows get the very same files. */
function world(n, rand) {
  const PF = load(), P = PF.publish, R = PF.run;
  const people = [
    { id: 'person-avery', name: 'Avery Lee', initials: 'AL', email: 'avery@example.com', folderRole: 'owner' },
    { id: 'person-blake', name: 'Blake Ortiz', initials: 'BO', email: 'blake@example.com', folderRole: 'backup' },
    { id: 'person-casey', name: 'Casey Nguyen', initials: 'CN', email: 'casey@example.com' },
    { id: 'person-morgan', name: 'Morgan Diaz', initials: 'MD', email: 'morgan@example.com' },
    { id: 'person-p1', name: 'Pat One', email: 'p1@example.com' },
    { id: 'person-p2', name: 'Pat Two', email: 'p2@example.com' }];
  const W = { PF, people, roles: Array.from({ length: n }, (x, i) => 'r' + (i + 1)), pubs: [], made: 0, runs: 0, added: 0, nextRole: n + 1 };
  W.md = (roles, k) => {
    const half = Math.ceil(roles.length / 2), line = (r, i) => '- [ ] {confirm} ' + r + ' does part ' + i + ' (v' + k + ') @' + r + ' {#s' + i + '}\n';
    const gate = roles.indexOf('r3') >= 0 ? '## Gate: Approval · owner @r3 {#g1}\n\n' : '';
    return '---\nprocess: ' + PID + '\ntitle: Many roles\ncategory: Synthetic\nowner: person-avery\nroles: ' + roles.join(', ') + '\n---\n\n' +
      '## One · READ-DO {#ph1}\n' + roles.slice(0, half).map((r, i) => line(r, i)).join('') + '\n' + gate +
      '## Two · READ-DO {#ph2}\n' + roles.slice(half).map((r, i) => line(r, half + i)).join('') + '\n';
  };
  W.publish = roles => {
    const existing = W.pubs.map(x => ({ version: x.info.version })), k = existing.length + 1;
    const built = P.build(W.md(roles, k), { people: W.people, by: 'person-avery', changes: 'Version ' + k, existing, now: iso(NOW - 30 * DAY + k * 3600000), rand: 'd' + String(k).padStart(7, '0') });
    if (built.blockers) throw new Error(built.blockers.join('; '));
    let v = P.verify(built.folder, built.files, null, {});
    if (v.needsBytes) v = P.verify(built.folder, built.files, exactOf(PF, built.files), {});
    const pub = { folder: built.folder, info: v.info, map: v.map, md: W.md(roles, k) };
    W.pubs.push(pub); W.roles = roles.slice();
    const out = {}; Object.keys(built.files).forEach(f => { out['publications/' + PID + '/' + built.folder + '/' + f] = built.files[f]; });
    return out;
  };
  /* A run of the latest version with each role given someone at random: the rotation's suggestions move with it. */
  W.runFile = who => {
    const pub = W.pubs[W.pubs.length - 1], roles = {}, id = 'rd' + String(++W.runs).padStart(6, '0');
    W.roles.forEach(r => { roles[r] = who ? who(r) : W.people[Math.floor(rand() * W.people.length)].id; });
    const r = R.create(pub, { id, title: 'Past run ' + W.runs, roles, by: 'person-avery', session: 's-' + id, now: iso(NOW - DAY + W.runs * 60000), tz: 'UTC' });
    const c = {}; Object.keys(r).forEach(k => { if (k[0] !== '_') c[k] = r[k]; });
    return { ['runs/' + PID + '/' + id + '/run.json']: JSON.stringify(c, null, 2) + '\n' };
  };
  W.planFile = roles => {
    const pub = W.pubs[W.pubs.length - 1];
    const plan = PF.plans.make(pub, { id: PLAN, process: PID, title: 'Planned many roles', when: iso(NOW + DAY), by: 'person-avery', created: iso(NOW - DAY), roles }, false);
    return { [PLAN_FILE]: JSON.stringify(plan, null, 2) + '\n' };
  };
  W.peopleFile = () => ({ 'people.json': JSON.stringify(W.people, null, 2) + '\n' });
  return W;
}

async function remembered(files) {
  const dir = folderHandle('Team', files), idb = memoryIDB();
  dir.queryPermission = () => Promise.resolve('prompt');
  await new Promise(res => { const q = idb.open(); q.onsuccess = () => { const tx = q.result.transaction(); tx.oncomplete = res; tx.objectStore().put({ dir, id: 'team-1' }, 'folder'); }; });
  return idb;
}
async function reread(app) {
  const was = app.PF.perf.n['load.done'] || 0;
  app.click('refresh');
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(10);
}
/* Two windows, 2.11.0 and this build, each on the examples with a team folder to reconnect to, the same files put in both. */
async function pair(W, initial) {
  const sides = [];
  for (const which of ['2.11.0', 'this build']) {
    const files = {};
    const app = boot({ html: which === '2.11.0' ? shipped() : undefined, liveForms: true, localStore: { 'preflight:builder': 'false' }, indexedDB: await remembered(files), picker: folderHandle('Other', {}) });
    await app.tick(60);
    app.choose('person-avery'); await app.tick();
    sides.push({ which, app, files, team: false });
  }
  await put(sides, initial);
  return sides;
}
async function put(sides, files) {
  for (const s of sides) {
    for (const p of Object.keys(files)) { if (s.team) s.files[p] = files[p]; else await s.app.fs.write(p, files[p]); }
    await reread(s.app);
  }
}

/* Every role value the open Start or Plan form would send, drawn or hidden, by role. */
function formRoles(app) {
  const h = app.html(), m = /<form[^>]*\bid="(start-form|plan-form)"[^>]*>/.exec(h); if (!m) return null;
  const body = h.slice(m.index, h.indexOf('</form>', m.index)), roles = {};
  for (const c of body.matchAll(/<(?:input|select)\b[^>]*\sid="([^"]*)"[^>]*\sdata-role="([^"]*)"/g)) roles[un(c[2])] = app.el(un(c[1])).value;
  return { form: m[1], roles };
}
const hiddenRole = (h, role) => h.indexOf('<input type="hidden" id="role-' + role + '"') >= 0;
async function typeFind(app, v) { app.set('find-start-roles', v); app.input('find-start-roles', v); await app.tick(5); }

/* One walk: n roles, STEPS events, each chosen by the seeded generator and done in both windows; after each, the forms must
   send the same roles. Show more and Find must change nothing sent. */
async function walk(n, seed, steps) {
  const rand = prng(seed), W = world(n, rand), pick = a => a[Math.floor(rand() * a.length)];
  const init = Object.assign({}, W.publish(W.roles), W.peopleFile());
  Object.assign(init, W.runFile(() => 'person-avery'));
  const planRoles = {}; W.roles.forEach(r => { if (rand() < 0.3) planRoles[r] = pick(W.people).id; });
  Object.assign(init, W.planFile(planRoles));
  const sides = await pair(W, init), [A, B] = sides, trail = [];
  let snap = null;
  const active = () => W.people.filter(p => !p.inactive).map(p => p.id);
  const both = async fn => { for (const s of sides) await fn(s.app, s); };
  const opens = { start: app => app.click('start', PID), plan: app => app.click('plan-run', PID), review: app => app.click('review-plan', PLAN) };
  const open = async kind => { trail.push('open ' + kind); await both(async app => { opens[kind](app); await app.tick(20); }); };
  const change = async (role, v) => {
    await both(async (app, s) => {
      if (!/id="(start|plan)-form"/.test(app.html())) return;
      if (hiddenRole(app.html(), role)) await typeFind(app, role);
      if (app.html().indexOf('<select id="role-' + role + '"') < 0) return;
      app.select('role-' + role, v); await app.tick(5);
    });
  };
  const EVENTS = {
    change: async () => { const role = pick(W.roles), v = rand() < 0.15 ? '' : pick(active()); trail.push('change ' + role + ' to ' + (v || 'nobody')); await change(role, v); },
    justMe: async () => { const f = formRoles(A.app); snap = f && f.roles; trail.push('Just me'); await both(async app => { if (/data-act="just-me"/.test(app.html())) { app.click('just-me'); await app.tick(5); } }); },
    undo: async () => {
      if (!snap) return;
      const now = formRoles(A.app), back = now ? Object.keys(snap).filter(r => r in now.roles && now.roles[r] !== snap[r]) : [];
      for (let i = 0; i < 3 && back.length; i++) { const r = back.splice(Math.floor(rand() * back.length), 1)[0]; trail.push('Just me undone on ' + r); await change(r, snap[r]); }
    },
    refresh: async () => { trail.push('refresh'); await both(reread); },
    run: async () => { trail.push('a run arrives'); await put(sides, W.runFile()); },
    pubSame: async () => { trail.push('v' + (W.pubs.length + 1) + ' arrives, same roles'); await put(sides, W.publish(W.roles)); },
    pubAdd: async () => { const r = 'r' + W.nextRole++, at = Math.floor(rand() * (W.roles.length + 1)), roles = W.roles.slice(); roles.splice(at, 0, r); trail.push('v' + (W.pubs.length + 1) + ' arrives, adding ' + r); await put(sides, W.publish(roles)); },
    pubRemove: async () => { const r = pick(W.roles); if (r === 'r3') return; trail.push('v' + (W.pubs.length + 1) + ' arrives, without ' + r); await put(sides, W.publish(W.roles.filter(x => x !== r))); },
    inactive: async () => { const p = pick(W.people.filter(x => x.id !== 'person-avery' && !x.inactive)); if (!p) return; p.inactive = true; trail.push(p.id + ' marked inactive'); await put(sides, W.peopleFile()); },
    reactivate: async () => { const p = pick(W.people.filter(x => x.inactive)); if (!p) return; delete p.inactive; trail.push(p.id + ' active again'); await put(sides, W.peopleFile()); },
    addPerson: async () => { const k = ++W.added; W.people.push({ id: 'person-new' + k, name: 'New ' + k, email: 'new' + k + '@example.com' }); trail.push('person-new' + k + ' added'); await put(sides, W.peopleFile()); },
    planChange: async () => { const r = pick(W.roles); planRoles[r] = pick(active()); trail.push('the plan changes ' + r + ' to ' + planRoles[r]); await put(sides, W.planFile(planRoles)); },
    stale: async () => {
      if (!/id="start-form"[^>]*data-plan-hash=/.test(A.app.html())) return;
      trail.push('Start sent from a form drawn before the plan changed');
      await both(async app => { app.submitForm('start-form', { planHash: 'stale' }); await app.tick(40); });
      if (/changed this plan while you were reviewing it/.test(A.app.html() + A.app.live())) trail.push('(refused, drawn afresh)');
    },
    reconnect: async () => {
      if (sides.some(s => s.team || !/data-act="reconnect"/.test(s.app.html() + s.app.top()))) return;
      trail.push('Reconnect');
      await both(async (app, s) => {
        Object.keys(app.fs.files).forEach(p => { const t = app.fs.files[p].t; if (!/^data:/.test(t)) s.files[p] = t; });
        s.team = true; app.click('reconnect'); await app.tick(200);
        assert.ok(!/data-act="reconnect"/.test(app.html() + app.top()), s.which + ': Reconnect opened the team folder');
      });
    },
    findOn: async () => { const q = rand() < 0.5 ? pick(W.roles) : 'r' + Math.floor(rand() * 10); trail.push('Find ' + q + ' (this build)'); if (/id="find-start-roles"/.test(B.app.html())) await typeFind(B.app, q); },
    findOff: async () => { trail.push('Find cleared (this build)'); if (/data-act="find-clear" data-id="start-roles"/.test(B.app.html())) { B.app.click('find-clear', 'start-roles'); await B.app.tick(5); } },
    more: async () => { trail.push('Show more (this build)'); const m = /<button[^>]*data-act="more" data-id="start-roles"([^>]*)>/.exec(B.app.html()); if (!m) return; const d = {}; m[1].replace(/data-([\w-]+)="([^"]*)"/g, (x, k, v) => { d[k] = un(v); return x; }); B.app.click('more', 'start-roles', d); await B.app.tick(5); },
    leave: async () => { trail.push('leave for Home'); await both(async app => { app.click('nav', 'home'); await app.tick(10); }); },
    reopen: async () => { await open(pick(['start', 'plan', 'review'])); },
    mode: async () => { const m = pick(['solo', 'team']); trail.push('mode ' + m); await both(async app => { if (/data-act="start-mode"/.test(app.html())) { app.click('start-mode', m, { process: PID }); await app.tick(5); } }); }
  };
  const WEIGHTS = { change: 12, justMe: 3, undo: 3, refresh: 3, run: 3, pubSame: 3, pubAdd: 1, pubRemove: 1, inactive: 2, reactivate: 2, addPerson: 1, planChange: 2, stale: 2, reconnect: 1, findOn: 3, findOff: 2, more: 3, leave: 1, reopen: 2, mode: 1 };
  const bag = []; Object.keys(WEIGHTS).forEach(k => { for (let i = 0; i < WEIGHTS[k]; i++) bag.push(k); });
  let compared = 0;
  const check = what => {
    const a = formRoles(A.app), b = formRoles(B.app);
    if (a && Object.keys(a.roles).length) compared++;
    if (INTENDED.some(x => x.when(trail))) return;
    const same = (x, y) => (!x && !y) || (!!x && !!y && x.form === y.form && Object.keys(x.roles).length === Object.keys(y.roles).length && Object.keys(x.roles).every(r => y.roles[r] === x.roles[r]));
    if (same(a, b)) return;
    const diff = !a || !b || a.form !== b.form ? 'forms: ' + (a && a.form) + ' / ' + (b && b.form) : Object.keys(Object.assign({}, a.roles, b.roles)).filter(r => a.roles[r] !== b.roles[r]).slice(0, 6).map(r => r + ': 2.11.0 ' + JSON.stringify(a.roles[r]) + ', this build ' + JSON.stringify(b.roles[r])).join('; ');
    assert.fail(n + ' roles, seed ' + seed + ', after ' + what + ': ' + diff + '\n  events: ' + trail.slice(-14).join(' > '));
  };
  await open(pick(['start', 'plan', 'review'])); check('opening');
  for (let i = 0; i < steps; i++) {
    const ev = pick(bag);
    await EVENTS[ev]();
    if (!formRoles(A.app) && rand() < 0.7) await open(pick(['start', 'plan', 'review']));
    check('step ' + (i + 1) + ' (' + ev + ')');
  }
  assert.ok(compared > steps / 3, 'the walk compared roles after ' + compared + ' of ' + steps + ' events');
  if (process.env.ROLES_TRACE) console.log(n + ' roles, seed ' + seed + ': ' + trail.join(' > '));
  return trail.length;
}

module.exports = { world, pair, put, reread, formRoles, prng, PID };
if (require.main !== module) return;

/* ---------- the named sequences of code review rounds 16 and 17, then the random walks ---------- */
rule('Round 16 differential: Plan on 60 roles, Just me, v2 arrives with the same roles, refresh: every role is what 2.11.0 sends', async () => {
  const rand = prng(1), W = world(60, rand);
  const sides = await pair(W, Object.assign({}, W.publish(W.roles), W.peopleFile(), W.runFile(() => 'person-avery')));
  for (const s of sides) { s.app.click('plan-run', PID); await s.app.tick(20); s.app.click('just-me'); await s.app.tick(5); }
  await put(sides, W.publish(W.roles));
  for (const s of sides) await reread(s.app);
  const [a, b] = sides.map(s => formRoles(s.app));
  assert.strictEqual(a.roles.r50, 'person-avery', 'set-up: 2.11.0 keeps Avery in r50');
  assert.deepStrictEqual(b, a, 'this build sends what 2.11.0 sends');
});

/* ---------- code review round 17: whether each build lets the form be left ---------- */
/* Browser Back from the open form, in both windows: whether it left the form or refused ("Finish or cancel this first."). */
async function backFrom(app) {
  const form = formRoles(app); assert.ok(form, 'set-up: a form is open');
  app.back(); await app.tick(30);
  const now = formRoles(app);
  return { left: !now, refused: /Finish or cancel this first/.test(app.live()) };
}
/* A role changed as someone would: in this build, a role past the page is found first so its select is drawn. */
async function setRole(s, role, v) {
  if (s.which === 'this build' && hiddenRole(s.app.html(), role)) await typeFind(s.app, role);
  assert.ok(s.app.html().indexOf('<select id="role-' + role + '"') >= 0, s.which + ': set-up: role ' + role + ' is drawn as a select');
  s.app.select('role-' + role, v); await s.app.tick(5);
}
const LEAVE = {
  untouched: { expect: 'left', go: async () => {} },
  changed: { expect: 'refused', go: async (s, role) => { const was = s.app.el('role-' + role).value; await setRole(s, role, was === 'person-casey' ? 'person-blake' : 'person-casey'); } },
  'Just me': { expect: 'refused', go: async s => { assert.ok(/data-act="just-me"/.test(s.app.html()), s.which + ': set-up: Just me is offered'); s.app.click('just-me'); await s.app.tick(5); } },
  /* As 2.11.0 does: a role changed and then set back to what it was drawn with is nothing to lose. */
  'changed and set back': { expect: 'left', go: async (s, role) => { const was = s.app.el('role-' + role).value; await setRole(s, role, was === 'person-casey' ? 'person-blake' : 'person-casey'); await setRole(s, role, was); } }
};
for (const [n, role] of [[8, 'r2'], [60, 'r50']]) for (const kind of ['start', 'plan']) for (const what of Object.keys(LEAVE)) {
  rule('Round 17 differential: ' + (kind === 'start' ? 'Start' : 'Plan') + ' on ' + n + ' roles, ' + what + (what === 'untouched' || what === 'Just me' ? '' : ' (' + role + ')') + ', then browser Back: ' + (LEAVE[what].expect === 'left' ? 'both builds leave' : 'both builds refuse') + ', and send the same roles', async () => {
    const W = world(n, prng(17));
    const sides = await pair(W, Object.assign({}, W.publish(W.roles), W.peopleFile(), W.runFile(() => 'person-avery')));
    const out = [];
    for (const s of sides) {
      s.app.click(kind === 'start' ? 'start' : 'plan-run', PID); await s.app.tick(20);
      await LEAVE[what].go(s, role);
      const f = formRoles(s.app);
      out.push(Object.assign({ which: s.which, roles: f && f.roles }, await backFrom(s.app)));
    }
    const [a, b] = out;
    assert.deepStrictEqual(b.roles, a.roles, 'this build sends what 2.11.0 sends before Back');
    assert.strictEqual(b.left, a.left, 'Back: 2.11.0 ' + (a.left ? 'left' : 'stayed') + ', this build ' + (b.left ? 'left' : 'stayed'));
    assert.strictEqual(b.refused, a.refused, 'Back: 2.11.0 ' + (a.refused ? 'refused' : 'did not refuse') + ', this build ' + (b.refused ? 'refused' : 'did not refuse'));
    for (const x of out) {
      if (LEAVE[what].expect === 'left') assert.ok(x.left && !x.refused, x.which + ': Back leaves the form');
      else assert.ok(!x.left && x.refused, x.which + ': Back refuses and keeps the form');
    }
  });
}
const walks = (n, count, steps) => { for (let w = 0; w < count; w++) rule('Round 16 differential: ' + n + ' roles, walk ' + (w + 1) + ' of ' + count + ' (seed ' + (SEED + w) + ', ' + steps + ' events): every role sent is what 2.11.0 sends', async () => { await walk(n, SEED + w, steps); }); };
walks(60, 5, STEPS);
walks(300, 1, Math.max(10, Math.round(STEPS / 2)));

run();
