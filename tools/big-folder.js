// Makes a big synthetic team folder, the same every time for a given profile and seed, for the perf tests and for trying
// Flightdeck on a large folder. People, tickets and hosts are synthetic. Runs are played through the real rules, as the
// examples are. Attachments are "virtual": the folder records their size, and their bytes are made only if someone reads them.
// Run: node tools/big-folder.js --out <empty dir> [--profile default|recent-heavy|old-heavy|6000] [--runs N] [--seed N]
'use strict';
const fs = require('fs'), path = require('path');

/* The distributions in docs/design.md section 25. Every count scales with the number of runs except processes and versions. */
const PROFILES = {
  default: { runs: 2000, running: 50, recent: 100 },
  'recent-heavy': { runs: 2000, running: 150, recent: 150 },
  'old-heavy': { runs: 2000, running: 10, recent: 20 },
  6000: { runs: 6000, running: 150, recent: 300 }
};
const NOW = Date.parse('2026-10-19T12:00:00.000Z'), DAY = 86400000, OLD = NOW - 400 * DAY;
const PEOPLE = ['avery', 'blake', 'casey', 'morgan', 'riley', 'jordan', 'quinn', 'sage', 'rowan', 'emery', 'parker', 'reese'];
const WORDS = ['check', 'confirm', 'deploy', 'review', 'record', 'verify', 'update', 'notify', 'archive', 'compare', 'approve', 'restart', 'backup', 'tag', 'merge', 'scan'];
const THINGS = ['the build', 'the release notes', 'the staging site', 'the dashboard', 'the ticket ABC-123', 'the change log', 'the backup', 'the queue', 'the config', 'the alerts'];

/* mulberry32: small, fast and the same on every computer. */
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* opts: { profile, runs, running, recent, seed }. Returns { files: { path: text }, virtual: { path: size }, mtimes: { path: ms }, stats }. */
function generate(PF, opts) {
  opts = opts || {};
  const prof = Object.assign({}, PROFILES[opts.profile || 'default'] || PROFILES.default, opts);
  const R = PF.run, P = PF.publish, U = PF.util, F = PF.followups;
  const rand = prng(opts.seed || 17), pick = a => a[Math.floor(rand() * a.length)], int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const id8 = () => { let s = ''; for (let i = 0; i < 8; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)]; return s; };
  const files = {}, virtual = {}, mtimes = {};
  const put = (p, text, m) => { files[p] = text; mtimes[p] = m == null ? OLD : m; };
  const iso = ms => new Date(ms).toISOString();
  const scale = prof.runs / 2000;

  put('people.json', JSON.stringify(PEOPLE.map(n => ({ id: 'person-' + n, name: n[0].toUpperCase() + n.slice(1) + ' Example', email: n + '@example.com' })), null, 2));

  /* 200 processes, 600 versions (1-6 each); two processes have two folders with one version number (a clash). */
  const PATTERN = [1, 2, 3, 4, 5, 3, 2, 4, 3, 3], pubs = [], byProc = {};
  let shotN = 0;
  for (let i = 0; i < 200; i++) {
    const proc = 'proc-' + String(i + 1).padStart(3, '0'), nv = PATTERN[i % 10];
    const steps = rand() < 0.5 ? int(20, 40) : 40 + Math.floor(Math.pow(rand(), 2) * 81);
    const phases = Math.max(2, Math.min(5, Math.round(steps / 15)));
    for (let v = 1; v <= nv; v++) {
      const shots = rand() < 0.4 ? int(2, 6) : 0, images = {}, bytesOf = {};
      let md = '---\nprocess: ' + proc + '\ntitle: Process ' + (i + 1) + '\ncategory: Synthetic\nowner: person-avery\nroles: lead\n---\n\n';
      let n = 0;
      for (let ph = 0; ph < phases; ph++) {
        md += '## Phase ' + (ph + 1) + ' · READ-DO {#ph' + (ph + 1) + '}\n';
        const per = Math.ceil(steps / phases);
        for (let s = 0; s < per && n < steps; s++, n++) {
          md += '- [' + (n % 7 === 0 ? '!' : ' ') + '] {confirm} ' + pick(WORDS)[0].toUpperCase() + pick(WORDS).slice(1) + ' ' + pick(THINGS) + ' (v' + v + ') @lead {#s' + n + '}\n';
          md += '  > ' + 'Look at ' + pick(THINGS) + ' and ' + pick(WORDS) + ' ' + pick(THINGS) + ' before going on. Write down anything that looks different from last time, and say so in a note on this step. If it took much longer than usual, note how long.\n';
          if (shots && n < shots) { const src = 'images/' + proc + '-' + v + '-' + n + '.png', bytes = 'synthetic-png-' + (++shotN); images[src] = U.hash(bytes); bytesOf[src] = bytes; md += '  ![Screen ' + n + '](' + src + ')\n'; }
        }
        if (ph < phases - 1) md += '\n## Gate: Phase ' + (ph + 1) + ' done · owner @lead {#g' + (ph + 1) + '}\n';
        md += '\n';
      }
      const clash = (i === 7 || i === 13) && v === nv && nv > 1;
      const built = P.build(md, { people: [], by: 'person-avery', changes: 'Version ' + v, existing: clash ? [{ version: v - 2 }] : pubs.filter(p => p.proc === proc).map(p => ({ version: p.info.version })), now: iso(OLD + v * DAY), rand: id8(), images });
      if (built.blockers) throw new Error(proc + ' v' + v + ': ' + built.blockers.join('; '));
      const base = 'publications/' + proc + '/' + built.folder + '/';
      Object.keys(built.files).forEach(f => put(base + f, built.files[f]));
      Object.keys(images).forEach(src => put(base + src, bytesOf[src]));
      const verified = P.verify(built.folder, built.files);
      const pub = { proc, info: verified.info, md, map: verified.map, types: verified.types };
      pubs.push(pub); (byProc[proc] = byProc[proc] || []).push(pub);
    }
  }

  /* Runs: some running, some ended in the last week, the rest older. */
  const runKeys = [], notesTotal = Math.round(10000 * scale), fusWanted = Math.round(1500 * scale);
  let notesLeft = notesTotal, fuMade = 0, attachLeft = Math.round(2000 * scale);
  const fuItems = [];
  for (let k = 0; k < prof.runs; k++) {
    const pub = pubs[Math.floor(rand() * pubs.length)];
    const running = k < prof.running, recent = !running && k < prof.running + prof.recent;
    const start = running ? NOW - int(1, 600) * 60000 : recent ? NOW - int(1, 7 * 24) * 3600000 : NOW - int(8, 390) * DAY;
    const id = id8(), who = 'person-' + pick(PEOPLE);
    const r = R.create(pub, { id, title: 'Run ' + (k + 1), roles: { lead: who }, by: who, session: 's' + id, now: iso(start), tz: 'UTC' });
    const map = R.mapOf(r), steps = PF.map.steps(map);
    let t = start;
    const at = () => iso(t += int(1, 6) * 60000);
    const upto = running ? Math.floor(steps.length * rand()) : steps.length;
    let ph = 0;
    steps.slice(0, upto).forEach((x, i) => {
      while (x.phase !== map.phases[ph]) { R.pass(r, map, ph, who, at()); ph++; }
      if (!x.step.must && rand() < 0.03) R.na(r, map, x.step.id, who, at());
      else { if (rand() < 0.02) R.block(r, map, x.step.id, 'Waiting on ' + pick(THINGS), who, at()); R.done(r, map, x.step.id, who, at(), {}); }
    });
    if (!running) {
      while (ph < map.phases.length) { R.pass(r, map, ph, who, at()); ph++; }
      if (fuMade < fusWanted) { const f = R.addFollowUp(r, { text: 'Tidy up ' + pick(THINGS) }, who, at()); fuMade++; fuItems.push({ process: r.process, run: r.id, id: f.id, who, at: t }); }
      R.end(r, map, rand() < 0.9 ? 'Completed' : 'Cancelled', who, who, at());
    }
    if (k % 100 === 7 && fuMade) delete r.marksFrom;
    const base = 'runs/' + r.process + '/' + r.id + '/';
    const text = JSON.stringify(stripMeta(r), null, 2);
    put(base + 'run.json', text, running || recent ? t : t);
    runKeys.push({ base, run: r, who, t, running, recent });
  }
  /* Notes: 1 file (60%), 2 (30%) or 3 (10%) per run; the total is 10,000 per 2,000 runs. Attachments go with notes. */
  runKeys.forEach((x, k) => {
    const nf = rand() < 0.6 ? 1 : rand() < 0.75 ? 2 : 3, left = runKeys.length - k;
    const n = Math.max(1, Math.round(notesLeft / left + (rand() - 0.5) * 2));
    notesLeft -= n;
    const lines = Array.from({ length: nf }, () => []);
    const steps = PF.map.steps(R.mapOf(x.run));
    for (let i = 0; i < n; i++) {
      const nid = id8(), note = { id: nid, at: iso(x.t - int(1, 50) * 60000), by: x.who, session: 'n' + (i % nf), step: pick(steps).step.id, text: 'Saw ' + pick(THINGS) + ' change; ' + pick(WORDS) + ' it next time.' };
      if (attachLeft > 0 && rand() < 0.21) {
        const p = x.base + 'files/' + nid + '-shot.png', size = int(5 * 1024, 2 * 1024 * 1024);
        virtual[p] = size; mtimes[p] = OLD; note.files = [p]; note.fileInfo = [{ name: 'shot.png', size }]; attachLeft--;
      }
      lines[i % nf].push(JSON.stringify(note));
    }
    lines.forEach((l, j) => { if (l.length) put(x.base + 'notes-n' + j + '.jsonl', l.join('\n') + '\n', x.t); });
  });
  /* Decision files: what became of follow-ups, decisions on corrections, and legacy suggestion decisions. */
  fuItems.forEach((x, i) => {
    const rec = F.decision({ process: x.process, run: x.run, id: x.id }, x.who, 'done', { note: 'Done.' }, iso(x.at + DAY));
    put('followups/' + x.process + '/' + F.fileName(rec, 'w' + (i % 9)), JSON.stringify(rec, null, 2) + '\n');
  });
  for (let i = 0; i < Math.round(300 * scale); i++) {
    const proc = pick(pubs).proc, g = 'g' + id8();
    put('corrections/' + proc + '/' + g + '.w1.1.json', JSON.stringify({ kind: 'correction-decision', group: g, status: 'declined', reason: 'Not needed.', by: 'person-avery', at: iso(OLD + i * 60000), rev: 1, members: [] }, null, 2) + '\n');
  }
  for (let i = 0; i < Math.round(40 * scale); i++) {
    const proc = pick(pubs).proc, s = 's' + id8();
    put('suggestions/' + proc + '/' + s + '.w1.json', JSON.stringify({ kind: 'fix-decision', suggestion: s, status: 'declined', by: 'person-avery', at: iso(OLD + i * 60000), rev: 1 }, null, 2) + '\n');
  }
  /* Oddities, picked among older ended runs so the running ones stay ordinary. */
  const old = runKeys.filter(x => !x.running && !x.recent);
  const oddN = n => Math.max(1, Math.round(n * scale));
  for (let i = 0; i < Math.round(old.length * 0.03); i++) { const x = old[(i * 31) % old.length]; put(x.base + 'candidate-w' + i + '-' + id8() + '.json', files[x.base + 'run.json'].replace('"title": "', '"title": "Lost save of '), OLD); }
  for (let i = 0; i < oddN(5); i++) { const x = old[(i * 37 + 3) % old.length]; put(x.base + 'run-LAPTOP.json', files[x.base + 'run.json'].replace('"title": "', '"title": "Copy of '), OLD); }
  for (let i = 0; i < oddN(3); i++) { const x = old[(i * 41 + 5) % old.length]; put(x.base + 'run.json', files[x.base + 'run.json'].slice(0, 200), OLD); }
  for (let i = 0; i < oddN(2); i++) { const x = old[(i * 43 + 9) % old.length]; const o = JSON.parse(files[x.base + 'run.json']); o.futureField = { kept: true }; put(x.base + 'run.json', JSON.stringify(o, null, 2), OLD); }

  const stats = { runs: runKeys.length, running: prof.running, publications: pubs.length, notes: notesTotal, attachments: Object.keys(virtual).length, files: Object.keys(files).length + Object.keys(virtual).length };
  return { files, virtual, mtimes, stats, now: NOW };
}
function stripMeta(o) { const c = {}; Object.keys(o).forEach(k => { if (k[0] !== '_') c[k] = o[k]; }); return c; }

module.exports = { generate, PROFILES, NOW };

if (require.main === module) {
  const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const out = arg('--out');
  if (!out) { console.error('Usage: node tools/big-folder.js --out <empty dir> [--profile default|recent-heavy|old-heavy|6000] [--runs N] [--seed N]'); process.exit(2); }
  if (fs.existsSync(out) && fs.readdirSync(out).length) { console.error(out + ' isn\'t empty.'); process.exit(2); }
  const { load } = require('../test/harness');
  const o = { profile: arg('--profile') || 'default', seed: +(arg('--seed') || 17) };
  if (arg('--runs')) { o.runs = +arg('--runs'); o.running = Math.min(o.runs, Math.round(o.runs / 40)); o.recent = Math.min(o.runs - o.running, Math.round(o.runs / 20)); }
  const g = generate(load(), o);
  Object.keys(g.files).forEach(p => { const f = path.join(out, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, g.files[p]); });
  /* Attachments are written small (1 KB), so the folder stays a reasonable size; their recorded sizes stay in the notes. */
  Object.keys(g.virtual).forEach(p => { const f = path.join(out, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(1024)); });
  console.log(JSON.stringify(g.stats));
}
