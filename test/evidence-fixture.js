// A team folder for the evidence tests, byte for byte: one published checklist (v1), a finished run on it with notes,
// attachments, follow-ups, corrections and every oddity a pack must keep (OneDrive copies, an orphan save receipt, a malformed
// notes line, duplicate note IDs, legacy suggestions/ decisions, unreadable decisions), and a v2 that publishes the run's
// correction. Synthetic people only. bytesFS() serves it from memory; toDisk() writes it to a real folder for the CLI.
'use strict';
const fs = require('fs'), path = require('path');
const { example, exampleSetup, sampleDone } = require('./harness');

const NOW = '2026-10-17T21:00:00.000Z';
/* The smallest valid PNG (1x1), so an image is really an image. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/* A folder in memory with exact bytes, behind the same interface as PF.fs. Mutating calls are counted, and can be made to throw. */
class BytesFS {
  constructor(files, opts) {
    opts = opts || {};
    this.kind = 'memory'; this.name = 'Evidence test folder';
    this.files = new Map(); this.mtimes = new Map(); this.mutations = [];
    this.strict = !!opts.strict;
    Object.keys(files).forEach(p => { this.files.set(p, Buffer.from(files[p])); this.mtimes.set(p, 1760000000000); });
    this.calls = { list: 0, read: 0, stat: 0, blob: 0 };
    this.hooks = opts.hooks || {};
  }
  _names(dir) {
    const pre = dir ? dir + '/' : '', seen = new Map();
    for (const p of this.files.keys()) {
      if (!p.startsWith(pre)) continue;
      const rest = p.slice(pre.length), i = rest.indexOf('/');
      seen.set(i < 0 ? rest : rest.slice(0, i), i < 0 ? 'file' : 'dir');
    }
    return [...seen].map(([name, kind]) => ({ name, kind }));
  }
  list(p) { this.calls.list++; if (this.hooks.list) this.hooks.list(p, this); return Promise.resolve(this._names(p || '')); }
  read(p) {
    this.calls.read++; if (this.hooks.read) this.hooks.read(p, this);
    const b = this.files.get(p); return Promise.resolve(b ? { text: b.toString('utf8'), mtime: this.mtimes.get(p), size: b.length } : null);
  }
  stat(p) { this.calls.stat++; if (this.hooks.stat) this.hooks.stat(p, this); const b = this.files.get(p); return Promise.resolve(b ? { size: b.length, mtime: this.mtimes.get(p) } : null); }
  blob(p) {
    this.calls.blob++; if (this.hooks.blob) this.hooks.blob(p, this);
    const b = this.files.get(p); return Promise.resolve(b ? new Blob([b]) : null);
  }
  _mut(kind, p) { this.mutations.push(kind + ' ' + p); if (this.strict) throw new Error('A mutating call (' + kind + ') reached the folder: ' + p); }
  write(p, data) { this._mut('write', p); const put = b => { this.files.set(p, Buffer.from(b)); this.mtimes.set(p, Date.now()); }; if (typeof data === 'string') { put(data); return Promise.resolve(); } return data.arrayBuffer().then(put); }
  append(p, text) { this._mut('append', p); const b = this.files.get(p) || Buffer.alloc(0); this.files.set(p, Buffer.concat([b, Buffer.from(text)])); return Promise.resolve(); }
  remove(p) { this._mut('remove', p); this.files.delete(p); return Promise.resolve(); }
  snapshot() { const o = {}; for (const [p, b] of this.files) o[p] = b.toString('base64') + '@' + this.mtimes.get(p); return JSON.stringify(o); }
}

/* Everything a MemoryFS holds, as bytes (attachments and screenshots are data: URLs there). */
function bytesOf(mem) {
  const out = {};
  Object.keys(mem.files).forEach(p => {
    const t = mem.files[p].t, m = /^data:[^;,]*;base64,(.*)$/.exec(t);
    out[p] = m ? Buffer.from(m[1], 'base64') : Buffer.from(t, 'utf8');
  });
  return out;
}

/* Builds the folder. Returns { files: {path: Buffer}, run, groupId, v2, fuId, notesPath, base }. */
async function build(PF) {
  const R = PF.run, repo = PF.repo, C = PF.corrections, EX = exampleSetup(PF);
  const people = example('people.json'), md = example('maps/drafts/release.md');
  const mem = new PF.fs.MemoryFS('evidence:' + Math.random(), null);
  mem.reset({ 'people.json': people, 'maps/drafts/release.md': md });
  const pub1 = await repo.publish(mem, md, { people: JSON.parse(people), ...EX, by: 'person-avery', changes: 'First version', existing: [], now: NOW, rand: 'aaaa1111' });
  if (pub1.blockers) throw new Error(String(pub1.blockers));
  let d = await repo.loadAll(mem);
  const v1 = d.processes[0].index.latest;
  const r = R.create(v1, { title: 'Release 2026.10.17', details: { commit: 'aaa111', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'w1', now: NOW, id: 'run1' });
  const map = R.mapOf(r), first = map.phases[0].steps[0].id;
  const done = sampleDone(PF);
  done(r, map, first, 'person-casey', NOW);
  r.followUps.push({ id: 'fu1', text: 'Rotate the deploy key', owner: 'person-blake', ticket: 'ABC-123', step: '', from: '', by: 'person-casey', at: NOW });
  await repo.saveRun(mem, r, 'w1');
  const second = map.phases[0].steps[1].id;
  done(r, map, second, 'person-casey', NOW);
  r.ended = { outcome: 'Completed', by: 'person-casey', byName: 'Casey', at: '2026-10-17T22:00:00.000Z' }; r.state = 'completed';
  await repo.saveRun(mem, r, 'w1');
  const base = 'runs/release/run1/';
  // A correction (a wording change on the step "pods"), a legacy suggested fix, and plain notes: one with an attachment,
  // two sharing an ID, one with markup in it, and a malformed line.
  const corr = C.build({ id: 'c1', at: NOW, by: 'person-blake', session: 'w2', map, step: 'pods', op: 'wording', to: 'New pods stay up for 20 minutes', version: 1, folder: r.folder });
  const shot = base + 'files/20261017-aaaaaa-w2-shot.png', log = base + 'files/20261017-bbbbbb-w2-deploy.log';
  const notes = [
    { id: 'n1', at: '2026-10-17T21:01:00.000Z', by: 'person-blake', session: 'w2', step: first, text: 'Screenshot of the deploy', files: [shot, log], fileInfo: {} },
    { id: 'dup', at: '2026-10-17T21:02:00.000Z', by: 'person-blake', session: 'w2', step: first, text: 'First note with the shared ID' },
    { id: 'dup', at: '2026-10-17T21:03:00.000Z', by: 'person-blake', session: 'w2', step: first, text: 'Second note with the shared ID' },
    { id: 'x1', at: '2026-10-17T21:04:00.000Z', by: 'person-blake', session: 'w2', step: first, text: '<script>alert(1)</script> and <img src=x onerror=alert(2)>' },
    { id: 'f1', at: '2026-10-17T21:05:00.000Z', by: 'person-blake', session: 'w2', step: first, kind: 'fix', fixKind: 'instructions', text: 'The command is wrong', target: { phase: map.phases[0].id, step: first }, version: 1 },
    corr
  ];
  const notesText = notes.slice(0, 3).map(n => JSON.stringify(n)).join('\n') + '\n{"id": "broken", "text": "cut off\n' + notes.slice(3).map(n => JSON.stringify(n)).join('\n') + '\n';
  const files = bytesOf(mem);
  files[base + 'notes-w2.jsonl'] = Buffer.from(notesText);
  files[shot] = PNG;
  files[log] = Buffer.from('deploy ok\n');
  // OneDrive's copies, a conflict copy, an orphan save receipt and a temporary file.
  const runText = files[base + 'run.json'].toString('utf8');
  files[base + 'run-LAPTOP.json'] = Buffer.from(runText);
  files[base + 'run (1).json'] = Buffer.from(runText.replace('Release 2026.10.17', 'Release 2026.10.17 (copy)'));
  files[base + 'candidate-other-zzzz9999.json'] = Buffer.from(runText.replace('"rev": 2', '"rev": 3'));
  files[base + 'run.json.1a2b.tmp'] = Buffer.from('partial');
  files[base + 'history-w1.jsonl'] = Buffer.from('{"kind":"log","at":"' + NOW + '","by":"person-casey","what":"archived"}\n');
  // Follow-up decisions: one good, OneDrive's copy of it, and one that can't be read.
  const fu = { kind: 'followup-decision', fv: 1, process: 'release', run: 'run1', followUp: 'fu1', status: 'ticket', ticket: 'ABC-124', by: 'person-blake', at: NOW, rev: 1, seen: null };
  files['followups/release/run1.fu1.w2.1.json'] = Buffer.from(JSON.stringify(fu, null, 2));
  files['followups/release/run1.fu1.w2.1-LAPTOP.json'] = Buffer.from(JSON.stringify(fu, null, 2));
  files['followups/release/run1.fu2.w3.1.json'] = Buffer.from('{"kind": "followup-dec');
  files['followups/release/run9.fu1.w2.1.json'] = Buffer.from(JSON.stringify(Object.assign({}, fu, { run: 'run9' })));
  // A legacy decision on the suggested fix, and one on someone else's.
  files['suggestions/release/f1.w3.json'] = Buffer.from(JSON.stringify({ kind: 'fix-decision', suggestion: 'f1', status: 'accepted', by: 'person-avery', at: NOW, reason: '' }));
  files['suggestions/release/other.w3.json'] = Buffer.from(JSON.stringify({ kind: 'fix-decision', suggestion: 'other', status: 'declined', by: 'person-avery', at: NOW, reason: 'no' }));
  // The correction applied to the draft, then published in v2, which lists it.
  const runObj = R.sanitize(JSON.parse(runText)); runObj._notes = [corr];
  const g = C.groups(C.collect([runObj], 'release'))[0], rv = C.review(g, md);
  const dec = C.decision(g, 'person-avery', 'applied', '', NOW, { act: 'a1', result: C.outcome(g, rv.text) });
  files['corrections/release/' + g.id + '.w4.1.json'] = Buffer.from(JSON.stringify(dec, null, 2) + '\n');
  files['corrections/release/zzz.w5.1.json'] = Buffer.from('not json at all');
  const gs = C.landing(C.status([g], [Object.assign(C.cleanDecision(dec, 'release'), { _file: g.id + '.w4.1.json' })]), [v1], []);
  const mem2 = new PF.fs.MemoryFS('evidence2:' + Math.random(), null);
  mem2.reset({});
  const pub2 = await repo.publish(mem2, rv.text, { people: JSON.parse(people), ...EX, by: 'person-avery', changes: 'Pods wording', existing: [v1.info], now: NOW, rand: 'bbbb2222', corrections: C.forPublish(rv.text, gs).list });
  if (pub2.blockers) throw new Error(String(pub2.blockers));
  Object.assign(files, bytesOf(mem2));
  return { files, run: r, groupId: g.id, v1: r.folder, v2: pub2.folder, base, notesPath: base + 'notes-w2.jsonl', shot, log };
}

/* Write a byte map into a real folder. */
function toDisk(files, dir) {
  Object.keys(files).forEach(p => { const f = path.join(dir, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, files[p]); });
  return dir;
}
/* Every file under a folder with its bytes and time, for "nothing changed" checks. */
function tree(dir) {
  const out = {};
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name, st = fs.lstatSync(p);
      if (e.isDirectory()) { out[r + '/'] = String(st.mtimeMs); walk(p, r); }
      else out[r] = (st.isSymbolicLink() ? 'link:' + fs.readlinkSync(p) : fs.readFileSync(p).toString('base64')) + '@' + st.mtimeMs;
    }
  })(dir, '');
  return out;
}

module.exports = { BytesFS, build, bytesOf, toDisk, tree, NOW, PNG };
