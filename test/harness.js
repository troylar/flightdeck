// Loads Flightdeck's core and storage modules from src/ into a sandbox, with an in-memory localStorage.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const FILES = ['core/util.js', 'core/types.js', 'core/jira.js', 'core/map.js', 'core/outline.js', 'core/timeline.js', 'core/publish.js', 'core/run.js', 'core/corrections.js', 'core/followups.js', 'core/skills.js', 'core/attach.js', 'core/contract.js', 'core/people.js', 'core/health.js', 'core/connection.js', 'core/setup.js', 'core/search.js', 'core/sha256.js', 'core/zip.js', 'core/evidence.js', 'storage/fs.js', 'storage/repo.js'];

/* edit(file, source) can change a module before it loads, to stand in for an older copy of Flightdeck. */
function load(withViews, edit) {
  const store = {};
  const sandbox = {
    PF: {}, console, Date, Math, JSON, Promise, setTimeout, Blob, fetch, btoa, Uint8Array,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }
  };
  vm.createContext(sandbox);
  (withViews ? FILES.concat(['ui/icons.js', 'ui/views/common.js', 'ui/views/home.js', 'ui/views/process.js', 'ui/views/run.js', 'ui/views/pages.js', 'ui/views/overlays.js', 'ui/views/builder.js', 'ui/views/manage.js', 'ui/views/flight.js', 'ui/views/health.js', 'ui/views/setup.js', 'ui/views/evidence.js']) : FILES).forEach(f => { const src = fs.readFileSync(path.join(SRC, f), 'utf8'); vm.runInContext(edit ? edit(f, src) : src, sandbox, { filename: f }); });
  // Checklists parsed once are shared by every run of a version: frozen in tests, so a rule that changed one would fail.
  if (sandbox.PF.run && sandbox.PF.run.mapMemo) sandbox.PF.run.mapMemo.freeze = true;
  return sandbox.PF;
}
/* The example folder's own step types and Jira workflows, as the app loads them, for publishing its maps. */
function exampleSetup(PF) {
  const dir = path.join(__dirname, '..', 'example-folder'), customTypes = {};
  fs.readdirSync(path.join(dir, 'step-types')).forEach(f => { const d = JSON.parse(fs.readFileSync(path.join(dir, 'step-types', f), 'utf8')); customTypes[d.id] = PF.types.customType(d); });
  return { customTypes, workflows: PF.jira.check(JSON.parse(fs.readFileSync(path.join(dir, 'jira', 'workflows.json'), 'utf8'))).workflows };
}
function example(rel) { return fs.readFileSync(path.join(__dirname, '..', 'example-folder', rel), 'utf8'); }

let passed = 0, failed = 0;
const queue = [];
function rule(name, fn) { queue.push([name, fn]); }
async function run() {
  // ONLY=<text> runs just the rules whose names contain it, while working on them.
  for (const [name, fn] of queue) {
    if (process.env.ONLY && name.indexOf(process.env.ONLY) < 0) continue;
    try { await fn(); passed++; } catch (e) { failed++; console.log('FAIL: ' + name + '\n  ' + (process.env.STACK ? e && e.stack : e && e.message)); }
  }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}
/* Checks a step with sample values for whatever its type requires, for tests about other rules. */
function sampleDone(PF) {
  return (r, map, id, who, now) => {
    const x = PF.map.findStep(map, id), values = {};
    // A step that runs another process is checked by its child run: link a completed one with the right details.
    if (x && x.step.type === 'run.process') {
      const inputs = PF.run.childDetails(r, x.step, Object.keys(r.details)), cid = 'child-' + id;
      PF.run.linkChild(r, map, id, { process: PF.run.fieldsOf(r, x.step).process, id: cid, inputs }, who, now);
      return PF.run.settleChild(r, map, id, { process: PF.run.fieldsOf(r, x.step).process, id: cid, details: inputs, ended: { outcome: 'Completed' } }, who, now);
    }
    if (x) PF.run.evidenceFor(r, x.step).list.forEach(d => {
      if (d.required) values[d.name] = d.kind === 'url' ? 'https://example.com/' + d.name : d.kind === 'choice' ? d.options[0] : 'sample ' + d.name;
    });
    return PF.run.done(r, map, id, who, now, values);
  };
}
/* The screens too: views only build HTML strings, so they load without a browser. */
function loadViews() { return load(true); }
/* Play a run through: every step done (child-run steps through a child), every gate passed, ended Completed. */
function completeRun(PF, r, now) {
  const done = sampleDone(PF), map = PF.run.mapOf(r);
  map.phases.forEach((p, pi) => { p.steps.forEach(s => done(r, map, s.id, 'person-casey', now)); PF.run.pass(r, map, pi, 'person-casey', now); });
  r.ended = { outcome: 'Completed', at: now };
  return r;
}
module.exports = { completeRun, load, loadViews, example, exampleSetup, rule, run, sampleDone };
