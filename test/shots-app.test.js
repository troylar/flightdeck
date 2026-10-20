// 1.19: screenshots in the builder. A step's form adds images by Choose files, paste or drop; each image is checked, written
// once under images/<process>/ and read back, and only then is its ![caption](…) line added through the outline edit path,
// so it's one Undo entry and saved with the editor's checked save. Remove takes the line out and never the file.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot, gate } = require('./app-harness');

const DRAFT = 'maps/drafts/release.md';
const PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4];
/* A file as the browser hands it over: a Blob with a name. */
function file(name, type, bytes) { return Object.assign(new Blob([new Uint8Array(bytes || PNG)], { type }), { name }); }
const png = (name, bytes) => file(name || 'shot.png', 'image/png', bytes);
/* The builder open on the release draft, as Casey, with the Feature flags step selected. */
async function shotsOn(opts) {
  const app = boot(opts); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  return app;
}
const images = app => app.files('images/release/');
const shotLines = text => text.split('\n').filter(l => /^\s{2,}!\[/.test(l));
/* The editor's text as the Markdown view shows it. */
async function markdown(app) { app.click('ed-mode', 'markdown'); await app.tick(); const m = /<textarea[^>]*id="draft-editor"[^>]*>([\s\S]*?)<\/textarea>/.exec(app.html()); app.click('ed-mode', 'builder'); await app.tick(); return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') : ''; }
async function choose(app, caption, files) { app.setScoped('ob-shot-new', caption); app.change('ob-shot-file', files); await app.tick(80); }
/* Inside the step's form, as the paste and drop handlers see it. */
const inForm = { closest: sel => /ob-form|data-drop/.test(sel) ? { getAttribute: k => k === 'data-drop' ? 'shots' : k === 'data-id' ? 'flags' : null, classList: { add() {}, remove() {}, contains: () => false }, contains: () => false } : null };

rule('Shots: Choose files writes the image under images/<process>/ with a unique name, then adds its line to the step, unsaved, one Undo entry', async () => {
  const app = await shotsOn(), before = app.fs.files[DRAFT].t;
  assert.ok(/id="ob-shot-file"/.test(app.html()) && /Screenshots/.test(app.html()), 'the step form has a Screenshots section');
  await choose(app, 'The flags page', [png()]);
  const imgs = images(app);
  assert.strictEqual(imgs.length, 1, 'one image written');
  assert.ok(/^images\/release\/flags-\d+-[a-z0-9]+-[a-z0-9]+\.png$/.test(imgs[0]), imgs[0]);
  assert.strictEqual(app.fs.files[DRAFT].t, before, 'the draft isn\'t written: the line waits in the editor');
  assert.ok(/Unsaved changes/.test(app.html()));
  const md = await markdown(app), lines = md.split('\n'), at = lines.findIndex(l => /\{#flags\}/.test(l));
  assert.deepStrictEqual(shotLines(md), ['  ![The flags page](' + imgs[0] + ')']);
  assert.ok(lines.indexOf('  ![The flags page](' + imgs[0] + ')') > at && lines.slice(at + 1, lines.indexOf('  ![The flags page](' + imgs[0] + ')')).every(l => /^\s{2,}\S/.test(l)), 'under the step, after its own lines');
  assert.ok(/Added a screenshot to &quot;Feature flags set in the deploy values&quot;\. Undo available\./.test(app.html()) || /Added a screenshot/.test(app.live()), 'said, with Undo');
  assert.ok(/<img alt="The flags page"/.test(app.html()), 'a thumbnail whose alt text is the caption');
  app.click('save-draft'); await app.tick(120);
  assert.ok(app.fs.files[DRAFT].t.indexOf('  ![The flags page](' + imgs[0] + ')') > 0, 'saved through the editor\'s checked save');
});

rule('Shots: paste and drop add images the same way; each image is its own line and its own Undo entry', async () => {
  const app = await shotsOn();
  app.setScoped('ob-shot-new', 'Pasted view');
  app.fire('paste', { target: inForm, clipboardData: { items: [{ kind: 'file', getAsFile: () => png('image.png') }] } }); await app.tick(80);
  app.setScoped('ob-shot-new', 'Dropped view');
  app.fire('drop', { target: inForm, dataTransfer: { types: ['Files'], files: [png('a.png'), file('b.gif', 'image/gif', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2])] } }); await app.tick(120);
  const imgs = images(app), md = await markdown(app);
  assert.strictEqual(imgs.length, 3, 'three images');
  assert.deepStrictEqual(shotLines(md).map(l => /!\[(.*?)\]/.exec(l)[1]), ['Pasted view', 'Dropped view (1 of 2)', 'Dropped view (2 of 2)']);
  assert.ok(shotLines(md).some(l => /\.gif\)$/.test(l)), 'a GIF keeps its own extension');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.strictEqual(shotLines(await markdown(app)).length, 2, 'Undo takes back one image');
});

rule('Shots: a caption is required; without one nothing is written and the reason shows next to the caption box', async () => {
  const app = await shotsOn();
  await choose(app, '   ', [png()]);
  assert.strictEqual(images(app).length, 0, 'no file written');
  assert.ok(/id="ob-shot-new"[^>]*aria-invalid="true" aria-describedby="ferr-ob-shot-new"/.test(app.html()), 'the box is marked');
  assert.ok(/id="ferr-ob-shot-new" role="alert">Write a caption first/.test(app.html()), app.html().slice(app.html().indexOf('ob-shot-new') - 200, app.html().indexOf('ob-shot-new') + 600));
  assert.ok(!/Unsaved changes/.test(app.html()));
  /* An existing caption can't be emptied either. */
  await choose(app, 'First', [png()]);
  app.setScoped('ob-shot-cap-0', ''); app.select('ob-shot-cap-0', ''); await app.tick();
  assert.ok(/id="ferr-ob-shot-cap-0" role="alert">/.test(app.html()), 'refused next to its box');
  assert.deepStrictEqual(shotLines(await markdown(app)).map(l => /!\[(.*?)\]/.exec(l)[1]), ['First']);
});

rule('Shots: a caption is edited in place as plain text; brackets are refused rather than breaking the line', async () => {
  const app = await shotsOn();
  await choose(app, 'First', [png()]);
  app.setScoped('ob-shot-cap-0', 'The <b>flags</b> & "values" page'); app.select('ob-shot-cap-0', 'The <b>flags</b> & "values" page'); await app.tick();
  assert.deepStrictEqual(shotLines(await markdown(app)).map(l => /!\[(.*?)\]/.exec(l)[1]), ['The <b>flags</b> & "values" page']);
  assert.ok(!/<b>flags<\/b>/.test(app.html()) && /value="The &lt;b&gt;flags&lt;\/b&gt; &amp; &quot;values&quot; page"/.test(app.html()), 'escaped on the page');
  app.setScoped('ob-shot-cap-0', 'a ] b'); app.select('ob-shot-cap-0', 'a ] b'); await app.tick();
  assert.ok(/id="ferr-ob-shot-cap-0" role="alert">Leave out \[ and \]/.test(app.html()));
});

rule('Shots: reorder moves a line up or down among the step\'s screenshots, each as one Undo entry', async () => {
  const app = await shotsOn();
  await choose(app, 'One', [png()]); await choose(app, 'Two', [png()]);
  app.click('ob-shot-move', '1', { dir: 'up' }); await app.tick();
  assert.deepStrictEqual(shotLines(await markdown(app)).map(l => /!\[(.*?)\]/.exec(l)[1]), ['Two', 'One']);
  app.click('ob-shot-move', '1', { dir: 'down' }); await app.tick();
  assert.ok(/It(?:'|&#39;)s already last\./.test(app.html()), 'the last one says why it can\'t go down');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.deepStrictEqual(shotLines(await markdown(app)).map(l => /!\[(.*?)\]/.exec(l)[1]), ['One', 'Two']);
});

rule('Shots: Remove takes the line out of the draft and never deletes the image; Undo puts the line back and Redo removes it again', async () => {
  const app = await shotsOn();
  await choose(app, 'Keep me', [png()]);
  const img = images(app)[0];
  app.click('ob-shot-remove', '0'); await app.tick();
  assert.deepStrictEqual(shotLines(await markdown(app)), []);
  assert.ok(app.fs.files[img], 'the file stays: other versions or runs may use it');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.deepStrictEqual(shotLines(await markdown(app)), ['  ![Keep me](' + img + ')']);
  app.click('tl-redo', 'draft'); await app.tick();
  assert.deepStrictEqual(shotLines(await markdown(app)), []);
  app.click('save-draft'); await app.tick(120);
  assert.ok(app.fs.files[img] && !/Keep me/.test(app.fs.files[DRAFT].t), 'saved without the line; the file is still there');
  /* Undoing the add keeps the file too. */
  await choose(app, 'Again', [png()]);
  app.click('tl-undo', 'draft'); await app.tick();
  assert.strictEqual(images(app).length, 2);
});

rule('Shots: a failed write adds no line, and says so next to Choose files', async () => {
  const app = await shotsOn(), write = app.fs.write.bind(app.fs);
  app.fs.write = (p, d) => /^images\//.test(p) ? Promise.reject(new Error('The disk is full.')) : write(p, d);
  await choose(app, 'Broken', [png()]);
  app.fs.write = write;
  assert.deepStrictEqual(shotLines(await markdown(app)), []);
  assert.ok(!/Unsaved changes/.test(app.html()), 'nothing changed in the draft');
  assert.ok(/id="ferr-ob-shot-file" role="alert">Couldn&#39;t add &quot;shot\.png&quot;: The disk is full\. Nothing was added to the step\./.test(app.html()), app.html().slice(app.html().indexOf('ob-shot-file'), app.html().indexOf('ob-shot-file') + 900));
});

rule('Shots: a partial write (the file reads back different) adds no line', async () => {
  const app = await shotsOn(), blob = app.fs.blob.bind(app.fs);
  app.fs.blob = p => /^images\//.test(p) ? Promise.resolve(new Blob([new Uint8Array(PNG.slice(0, 9))], { type: 'image/png' })) : blob(p);
  await choose(app, 'Half', [png()]);
  app.fs.blob = blob;
  assert.deepStrictEqual(shotLines(await markdown(app)), []);
  assert.ok(/id="ferr-ob-shot-file" role="alert">[^<]*didn&#39;t save completely/.test(app.html()));
});

rule('Shots: only PNG, JPEG, WebP and GIF images whose bytes agree, up to 5 MB each; nothing is written otherwise', async () => {
  const app = await shotsOn();
  await choose(app, 'A PDF', [file('doc.pdf', 'application/pdf', [0x25, 0x50, 0x44, 0x46, 1])]);
  assert.ok(/id="ferr-ob-shot-file" role="alert">[^<]*PNG, JPEG, WebP or GIF/.test(app.html()), 'not an image');
  await choose(app, 'Fake', [png('fake.png', [1, 2, 3, 4, 5, 6, 7, 8, 9])]);
  assert.ok(/id="ferr-ob-shot-file" role="alert">&quot;fake\.png&quot; doesn&#39;t look like a \.png file inside/.test(app.html()), 'sniffed');
  const big = Object.assign(png('big.png'), {}); Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
  await choose(app, 'Big', [big]);
  assert.ok(/id="ferr-ob-shot-file" role="alert">[^<]*up to 5 MB/.test(app.html()), 'over the size cap');
  assert.strictEqual(images(app).length, 0);
  assert.deepStrictEqual(shotLines(await markdown(app)), []);
});

rule('Shots: a draft the new line would take past 1 MB is refused before any image is written', async () => {
  const app = boot(); await app.tick(60);
  const t = app.fs.files[DRAFT].t, pad = '  > ' + 'x'.repeat(1048576 - t.length - 30);
  app.fs.files[DRAFT].t = t.replace(/(\{#flags\}\n)/, '$1' + pad + '\n');
  assert.ok(app.PF.util.utf8Bytes(app.fs.files[DRAFT].t) <= 1048576 && app.fs.files[DRAFT].t.length > 1048000, 'set-up: just under 1 MB');
  app.focus(); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick(); app.click('ob-sel', 'flags'); await app.tick();
  await choose(app, 'One too many', [png()]);
  assert.strictEqual(images(app).length, 0, 'no file written');
  assert.ok(/id="ferr-ob-shot-file" role="alert">[^<]*1 MB/.test(app.html()), 'says why');
});

rule('Shots: adding works when the examples are kept in this tab only', async () => {
  const app = await shotsOn({ storageThrows: true });
  assert.ok(/Tab only/.test(app.badge()), 'tab-only, as the badge says');
  await choose(app, 'In this tab', [png()]);
  assert.strictEqual(images(app).length, 1);
  assert.deepStrictEqual(shotLines(await markdown(app)).map(l => /!\[(.*?)\]/.exec(l)[1]), ['In this tab']);
});

rule('Shots: while an image is being added, the step form says so, leaving warns, and live apply waits', async () => {
  const clock = { t: 1000 };
  const app = await shotsOn({ performance: { now: () => clock.t } });
  const watch = async () => { clock.t += 2100; app.every(); await app.tick(200); };
  const g = gate(), write = app.fs.write.bind(app.fs);
  app.fs.write = (p, d) => /^images\//.test(p) ? g.p.then(() => write(p, d)) : write(p, d);
  app.setScoped('ob-shot-new', 'Slow'); app.change('ob-shot-file', [png()]); await app.tick(40);
  assert.ok(/id="ob-shot-status" role="status"[^>]*>Adding 1 screenshot…/.test(app.html()), 'said while it\'s added');
  assert.ok(app.leaveWarns(), 'leaving asks first');
  const A = app.fs.files[DRAFT].t, B = A.replace('title: Production release', 'title: B');
  const p = app.PF.proposals.make({ id: 'p-mh4k2a-x7w1k3m9p2', process: 'release', session: 's-k3m9p2q8x7w1', label: 'assistant', by: 'person-avery', at: new Date().toISOString(), app: '1.19.0', replaces: null, after: null, note: 'A change', text: B, base: { kind: 'draft', ref: DRAFT, text: A } });
  app.fs.files['proposed/release/' + p.id + '.json'] = { t: JSON.stringify(p, null, 2), m: Date.now() };
  await watch(); await watch();
  assert.strictEqual(app.fs.files[DRAFT].t, A, 'not applied while the image is being added');
  assert.deepStrictEqual(app.files('proposed/release/' + p.id + '.attempt'), [], 'not even attempted');
  g.open(); await app.tick(120); app.fs.write = write;
  assert.strictEqual(shotLines(await markdown(app)).length, 1, 'the line is added once the image is written');
  await watch();
  assert.strictEqual(app.fs.files[DRAFT].t, A, 'and the line is unsaved work, so it still waits');
  assert.ok(/Your AI assistant proposed changes/.test(app.html()));
});

/* A slow image add, held at its write until the test opens the gate. */
function slowWrite(app) { const g = gate(), write = app.fs.write.bind(app.fs); app.fs.write = (p, d) => /^images\//.test(p) ? g.p.then(() => write(p, d)) : write(p, d); return { g, restore() { app.fs.write = write; } }; }

rule('Shots, counterexample: a phase name typed while an image is being added stays in its box, still unsaved typing, and Enter applies it', async () => {
  const app = await shotsOn(), slow = slowWrite(app);
  app.setScoped('ob-shot-new', 'Slow'); app.change('ob-shot-file', [png()]); await app.tick(40);
  app.click('ob-sel-phase', 'verify'); await app.tick();
  app.setScoped('ob-ph-title', 'Verify it now'); app.input('ob-ph-title', 'Verify it now'); await app.tick();
  slow.g.open(); await app.tick(120); slow.restore();
  assert.strictEqual(app.draft('ob-ph-title'), 'Verify it now', 'the typing is still in its box');
  assert.ok(/Unsaved changes/.test(app.html()));
  assert.strictEqual(shotLines(await markdown(app)).length, 1, 'the image\'s line was added');
  app.click('ob-sel-phase', 'verify'); await app.tick();
  app.keyOn('Enter', {}, { tagName: 'INPUT', id: 'ob-ph-title', value: 'Verify it now', dataset: { enter: 'ob-commit' }, closest: () => null }); await app.tick();
  assert.ok(/## Verify it now · READ-DO \{#verify\}/.test(await markdown(app)), 'and Enter applies it');
});

rule('Shots, counterexample: the step\'s own wording typed during the add stays, and isn\'t applied on its own', async () => {
  const app = await shotsOn(), slow = slowWrite(app);
  app.setScoped('ob-shot-new', 'Slow'); app.change('ob-shot-file', [png()]); await app.tick(40);
  app.setScoped('ob-text', 'Flags half typed'); app.input('ob-text', 'Flags half typed'); await app.tick();
  slow.g.open(); await app.tick(120); slow.restore();
  assert.strictEqual(app.draft('ob-text'), 'Flags half typed', 'kept in the box');
  assert.ok(/Feature flags set in the deploy values/.test(await markdown(app)) && !/Flags half typed/.test(await markdown(app)), 'not applied for the person');
});

rule('Shots, counterexample: a refused caption keeps its text and its reason when an image add completes', async () => {
  const app = await shotsOn();
  await choose(app, 'First', [png()]);
  const slow = slowWrite(app);
  app.setScoped('ob-shot-new', 'Second'); app.change('ob-shot-file', [png()]); await app.tick(40);
  app.setScoped('ob-shot-cap-0', 'a ] b'); app.select('ob-shot-cap-0', 'a ] b'); await app.tick();
  assert.ok(/id="ferr-ob-shot-cap-0" role="alert">Leave out/.test(app.html()), 'set-up: refused');
  slow.g.open(); await app.tick(120); slow.restore();
  assert.strictEqual(app.draft('ob-shot-cap-0'), 'a ] b', 'the refused text stays');
  assert.ok(/id="ferr-ob-shot-cap-0" role="alert">Leave out/.test(app.html()), 'with its reason');
  assert.strictEqual(shotLines(await markdown(app)).length, 2, 'the second image was added');
});

rule('Shots, counterexample: an add for a step without an ID never lands on another step when that one is deleted meanwhile', async () => {
  const app = boot(); await app.tick(60);
  app.fs.files[DRAFT].t = app.fs.files[DRAFT].t.replace(' {#rollback}', '').replace(' {#tests}', '');
  app.focus(); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const O = app.PF.outline, keyOf = re => O.parse(app.fs.files[DRAFT].t).steps.filter(s => re.test(s.text))[0].key;
  const k = keyOf(/^Rollback/);
  app.click('ob-sel', k); await app.tick();
  const slow = slowWrite(app);
  app.setScoped('ob-shot-new', 'For rollback'); app.change('ob-shot-file', [png()]); await app.tick(40);
  app.click('ob-del', k); await app.tick();
  slow.g.open(); await app.tick(120); slow.restore();
  assert.ok(/That step isn(?:'|&#39;)t in the draft anymore/.test(app.html()), 'said');
  assert.strictEqual(images(app).length, 1, 'the image stays');
  assert.deepStrictEqual(shotLines(await markdown(app)), [], 'no line on the step that took its place');
});

const RESET = /The image was saved as images\/release\/[\w.-]+ but not added, because the draft was reset\./;

rule('Shots, counterexample: Discard my changes while an image is being added: its line never comes back, and the person is told', async () => {
  const app = await shotsOn();
  await choose(app, 'First', [png()]);
  const slow = slowWrite(app);
  app.setScoped('ob-shot-new', 'Second'); app.change('ob-shot-file', [png()]); await app.tick(40);
  app.click('revert-draft'); await app.tick();
  assert.ok(!/Unsaved changes/.test(app.html()), 'set-up: discarded');
  slow.g.open(); await app.tick(120); slow.restore();
  assert.ok(RESET.test(app.html()) || RESET.test(app.live()), 'said');
  assert.ok(!/Unsaved changes/.test(app.html()), 'the draft stays as discarded');
  assert.strictEqual(images(app).length, 2, 'both images stay in the folder');
  assert.deepStrictEqual(shotLines(await markdown(app)), []);
});

rule('Shots, counterexample: Take theirs while an image is being added: no line on their text', async () => {
  const app = await shotsOn(), original = app.fs.files[DRAFT].t;
  app.click('ob-del', 'rollback'); await app.tick();
  await app.fs.write(DRAFT, original.replace('title: Production release', 'title: Theirs'));
  app.click('save-draft'); await app.tick(80);
  assert.ok(/Someone else changed this draft/.test(app.html()), 'set-up: a conflict');
  app.click('ob-sel', 'flags'); await app.tick();
  const slow = slowWrite(app);
  app.setScoped('ob-shot-new', 'Mine'); app.change('ob-shot-file', [png()]); await app.tick(40);
  app.click('draft-take-theirs'); await app.tick();
  slow.g.open(); await app.tick(120); slow.restore();
  assert.ok(RESET.test(app.html()) || RESET.test(app.live()), 'said');
  assert.ok(!/Unsaved changes/.test(app.html()), 'their text, nothing unsaved');
  assert.deepStrictEqual(shotLines(await markdown(app)), []);
});

rule('Shots, counterexample: switching folders while an image is being added adds nothing to any editor', async () => {
  const app = await shotsOn();
  const slow = slowWrite(app);
  app.setScoped('ob-shot-new', 'Old folder'); app.change('ob-shot-file', [png()]); await app.tick(40);
  app.click('reset-examples'); await app.tick(80);
  slow.g.open(); await app.tick(120); slow.restore();
  app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  assert.ok(!/Unsaved changes/.test(app.html()));
  assert.deepStrictEqual(shotLines(await markdown(app)), []);
  assert.ok(!app.leaveWarns(), 'nothing left counted as being added');
});

/* 2.0: a phase's form has its note and its screenshots, added the same way as a step's. */
rule('Shots: a phase\'s form edits its note and adds, captions and removes its own screenshots, each one Undo entry', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.click('ob-sel-phase', 'prep'); await app.tick();
  assert.ok(/id="ob-ph-note"/.test(app.html()) && /id="ob-shot-file"/.test(app.html()), 'the phase form has a note and Screenshots');
  app.select('ob-ph-note', 'Use the staging cluster first.\nThen production.'); await app.tick();
  let md = await markdown(app), lines = md.split('\n'), at = lines.findIndex(l => /^## Before production changes/.test(l));
  assert.deepStrictEqual(lines.slice(at + 1, at + 3), ['  > Use the staging cluster first.', '  > Then production.'], 'right under the phase heading');
  app.click('ob-sel-phase', 'prep'); await app.tick();
  await choose(app, 'The cluster page', [png()]);
  const imgs = images(app); assert.strictEqual(imgs.length, 1);
  md = await markdown(app); lines = md.split('\n');
  assert.strictEqual(lines[at + 3], '  ![The cluster page](' + imgs[0] + ')', 'after the phase note');
  const m = JSON.parse(JSON.stringify(require('./harness').load().map.parse(md)));
  assert.strictEqual(m.phases[0].note, 'Use the staging cluster first.\nThen production.');
  assert.deepStrictEqual(m.phases[0].shots.map(x => x.src), [imgs[0]]);
  app.click('ob-sel-phase', 'prep'); await app.tick();
  app.click('ob-shot-remove', '0'); await app.tick();
  assert.deepStrictEqual(shotLines(await markdown(app)), [], 'removed');
  assert.strictEqual(images(app).length, 1, 'the file stays');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.strictEqual(shotLines(await markdown(app)).length, 1, 'Undo puts it back');
});

run();
