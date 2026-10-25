// What the example folder's checklists make, everywhere but the screen: publication files, step signatures, the skill
// brief, the read contract's process and run, a played-through run's receipt and log. The entry-box guide is display only,
// so these stay byte for byte what 2.4.0 made (test/fixtures/entry-boxes/golden-2.4.0.json, written by `node test/entry-golden.js
// --write` from 2.4.0's src). Inputs are pinned: the clock, every ID and the app version.
'use strict';
const fs = require('fs'), path = require('path');

const NOW = '2026-10-17T21:00:00.000Z', LATER = '2026-10-17T22:00:00.000Z';
const DRAFTS = ['check-in', 'github-pr', 'incident', 'jira-cleanup', 'new-skill', 'release', 'sprint-start'];

function golden(H) {
  const PF = H.load(), P = PF.publish, R = PF.run, EX = H.exampleSetup(PF), people = JSON.parse(H.example('people.json'));
  const nameOf = PF.appjson.names(people), out = {};
  DRAFTS.forEach((id, k) => {
    const md = H.example('maps/drafts/' + id + '.md');
    const b = P.build(md, { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'gold000' + k, app: '0.0.0-golden' });
    if (!b.folder) { out[id] = { refused: b.errors || b }; return; }
    const pub = P.verify(b.folder, b.files, H.exactOf(PF, b.files));
    const files = {}; Object.keys(b.files).sort().forEach(f => { files[f] = b.files[f]; });
    const sig = PF.signature.steps(pub.map, pub.types, (pub.info || {}).images, ((pub.info || {}).payload || {}).pins);
    const proc = { process: pub.map.meta.process, pubs: [pub], index: P.index([pub]) };
    const details = {}; (pub.map.meta.context || []).forEach(c => { details[c] = 'gold-' + c; });
    const roles = {}; (pub.map.meta.roles || []).forEach(ro => { roles[ro] = 'person-casey'; });
    const r = R.create(pub, { title: 'Golden ' + id, details, roles, by: 'person-casey', session: 'gold', now: NOW, id: 'gold-run-' + k, workflows: EX.workflows });
    const map = R.mapOf(r);
    /* One Fill in on the first step that has a field to fill, so the log says how a value is named. */
    const texts = x => { const t = PF.types.get(x.step.type, r.types); return PF.types.relevant(t, R.fieldsOf(r, x.step)).filter(f => (PF.types.fieldDef(t, f) || {}).kind === 'text'); };
    const first = PF.map.steps(map).find(x => texts(x).length);
    if (first) { const f = texts(first)[0]; R.setFields(r, map, first.step.id, { [f]: 'golden ' + f }, null, 'person-casey', NOW); }
    H.completeRun(PF, r, LATER);
    out[id] = {
      files, sig: JSON.parse(JSON.stringify(sig)),
      brief: PF.skills.createBrief(pub, null, PF.skills.readiness([], pub, null), []),
      process: JSON.parse(JSON.stringify(PF.appjson.process2(proc, pub))),
      run: JSON.parse(JSON.stringify(PF.appjson.run2(R.sanitize(JSON.parse(JSON.stringify(r))), [], nameOf))),
      receipt: R.receipt(r, map, id2 => id2.replace('person-', ''), LATER, []),
      log: r.log.map(l => l.at + ' ' + l.by + ' ' + l.what)
    };
  });
  return out;
}

module.exports = { golden };

if (require.main === module && process.argv[2] === '--write') {
  const src = process.argv[3] ? path.resolve(process.argv[3]) : null;
  /* Another tree's harness (2.4.0's), so the fixture comes from its src. */
  const H = require(src ? path.join(src, 'test', 'harness.js') : './harness');
  fs.writeFileSync(path.join(__dirname, 'fixtures', 'entry-boxes', 'golden-2.4.0.json'), JSON.stringify(golden(H), null, 1) + '\n');
  console.log('written');
}
