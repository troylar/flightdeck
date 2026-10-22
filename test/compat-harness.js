// Older releases, run headless: each tag's own shipped core and storage code (tools/old-bundles.js) in a vm sandbox, as
// test/harness.js loads this version's src/. Also boots a tag's whole page in test/app-harness.js for its screens.
// A sandbox can be deterministic (opts.at): the clock starts there and moves one second per reading, and Math.random follows
// a fixed seed, so a writer run twice writes the same bytes (tools/old-folders.js depends on it).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const bundles = require('../tools/old-bundles');
const { FILES } = require('./harness');
const SRC = path.join(__dirname, '..', 'src');

/* A seeded generator (mulberry32): the same seed gives the same numbers on every platform. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function sandbox(opts) {
  opts = opts || {};
  const store = {};
  let DateC = Date, MathO = Math;
  if (opts.at) {
    let now = Date.parse(opts.at);
    const tick = () => { const t = now; now += 1000; return t; };
    DateC = class extends Date { constructor(...a) { if (a.length) super(...a); else super(tick()); } static now() { return tick(); } };
    MathO = Object.create(Math); MathO.random = seeded(opts.seed || 1);
  }
  const box = {
    PF: {}, console, Date: DateC, Math: MathO, JSON, Promise, setTimeout, Blob, fetch, btoa, Uint8Array,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }
  };
  vm.createContext(box);
  return box;
}
function finish(box) { if (box.PF.run && box.PF.run.mapMemo) box.PF.run.mapMemo.freeze = true; return box.PF; }

/* One release's core and storage, in the order its page runs them: pf-core, then pf-storage (1.17 on) and the top of pf-app
   (storage/fs.js), or before 1.17 the top of pf-app (fs.js, then repo.js). null when the release isn't available (skipped). */
function loadCopy(tag, opts) {
  const b = bundles.get(tag);
  if (!b) return null;
  const box = sandbox(opts), run = (k) => vm.runInContext(b.files[k], box, { filename: tag + '/' + k });
  run('core.js');
  if (bundles.block(b.files['flightdeck.html'], 'pf-storage') != null) { run('storage.js'); run('fs.js'); } else { run('fs.js'); run('storage.js'); }
  const PF = finish(box);
  PF.__tag = tag; PF.__version = b.version;
  return PF;
}
/* This version, from src/, in the same kind of sandbox (deterministic when asked). */
function loadMain(opts) {
  const box = sandbox(opts);
  FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), box, { filename: f }));
  const PF = finish(box);
  PF.__tag = 'main'; PF.__version = JSON.parse(fs.readFileSync(path.join(SRC, 'releases.json'), 'utf8'))[0].version;
  return PF;
}
/* A release's whole page in the app harness (its screens, its saves), or null when skipped. */
function bootCopy(tag, opts) {
  const b = bundles.get(tag);
  if (!b) return null;
  return require('./app-harness').boot(Object.assign({}, opts || {}, { html: b.files['flightdeck.html'] }));
}

/* A folder in a copy's own MemoryFS, seeded with files (path → text). */
function memFolder(PF, files) {
  const m = new PF.fs.MemoryFS('compat:' + Math.random(), null);
  m.reset(Object.assign({}, files || {}));
  return m;
}
/* A MemoryFS's files as path → text, sorted. */
function filesOf(m) { const out = {}; Object.keys(m.files).sort().forEach(p => { out[p] = m.files[p].t; }); return out; }

/* A folder on disk (test/fixtures/folders/<tag>/) as path → text, and back. A MemoryFS keeps a binary file as a data: URL;
   on disk it's the real bytes, so other readers (a release's own command, its checker) see what a team folder holds. */
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
function readTree(dir) {
  const out = {};
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach(e => {
      const p = path.join(d, e.name), rel = path.relative(dir, p).split(path.sep).join('/'), mime = MIME[(/\.(\w+)$/.exec(e.name) || [])[1]];
      if (e.isDirectory()) walk(p); else out[rel] = mime ? 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64') : fs.readFileSync(p, 'utf8');
    });
  })(dir);
  return out;
}
function writeTree(dir, files) {
  fs.rmSync(dir, { recursive: true, force: true });
  Object.keys(files).forEach(p => {
    const f = path.join(dir, ...p.split('/')), data = /^data:[\w/+.-]+;base64,/.exec(files[p]);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data ? Buffer.from(files[p].slice(data[0].length), 'base64') : files[p]);
  });
}

/* What is newer than a release, for the rules that show it refuses a newer file: to a 1.x copy, what 2.0 writes (a run/3 or a
   /2 version with typed details); to a 2.0 copy, what only a later release writes (a feature 2.0 knows only by name: staged
   versions, test runs). app: the release named in the file, which the copy's message names; needs: the version the message
   names (the bridge and later); stepType: an envelope that copy can't read for a step type. */
function newer(t) {
  if (t.major >= 2) return { app: '2.1.0', needs: '2.1', run: ['test-run'], pub: ['staged'], stepType: { format: 'flightdeck-step-type/3', features: [] } };
  return { app: '2.0.0', needs: '2.0', run: ['typed-details'], pub: ['typed-details'], stepType: { format: 'flightdeck-step-type/2', features: ['typed-evidence'] } };
}

/* A /2 publication record otherwise valid for files map and types and its screenshots (images: { 'images/x.png': bytes }, kept
   with base's fingerprints for them): fingerprints by copy PF's own hash and a payload of the exact bytes. With features a 2.x
   copy knows, that copy finds it usable (given exact2), so a refusal of the same record with a newer feature can only come
   from that feature. */
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
function pub2(PF, base, map, types, features, app, images) {
  const info = Object.assign({}, base, { format: 'preflight-publication/2', features, app, mapHash: PF.util.hash(map), typesHash: PF.util.hash(types) });
  const shots = {};
  Object.keys(images || {}).sort().forEach((k) => { shots[k] = sha256(images[k]); });
  info.payload = { map: sha256(map), types: sha256(types), images: shots, extensions: {}, pins: { children: {}, skills: {} } };
  return info;
}
/* What verify takes as the exact bytes' SHA-256 for map and types (exactOf on 2.x copies). */
const exact2 = (map, types) => ({ 'map.md': sha256(map), 'types.json': sha256(types) });
/* A run file in run/3 with the given features, otherwise as a 2.0 copy writes a run of a /1 version (an explicit run/3: its
   features and its types fingerprint, no payload), so a 2.x copy reads it in full when features holds nothing newer. */
function run3(text, features, app, typesHash) {
  const j = JSON.parse(text);
  j.format = 'preflight-run/3'; j.features = features; j.app = app; j.typesHash = typesHash || j.typesHash || '00000000';
  return JSON.stringify(j, null, 2);
}

module.exports = { bundles, loadCopy, loadMain, bootCopy, memFolder, filesOf, readTree, writeTree, seeded, newer, pub2, exact2, run3 };
