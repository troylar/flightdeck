// 2.4 fresh coat: every control answers hover, press and focus; selected and warning states keep their marks while hovered;
// nothing clips a focus ring; motion moves only color, shadow, opacity and transform, and stops for reduced motion; forced
// colors keep selections visible; the body face is embedded with its license; a checked step lands once.
// The harness can't compute :hover, so these read the built stylesheet's rules; a browser pass checks what they paint.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { rule, run, loadViews } = require('./harness');
const { boot } = require('./app-harness');

const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8');
const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];

/* The stylesheet as rules: { at: ['@media screen', …], sel: [selector, …], body: 'prop: value; …' }. Comments go first. */
function parse(src) {
  const out = [], s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  (function walk(text, at) {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i); if (open < 0) return;
      const head = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
      const inner = text.slice(open + 1, j - 1);
      if (/^@(media|supports)/.test(head)) walk(inner, at.concat(head.replace(/\s+/g, ' ')));
      else if (!/^@/.test(head)) out.push({ at, sel: head.split(',').map(x => x.trim()), body: inner });
      else out.push({ at, sel: [head], body: inner, atRule: true });
      i = j;
    }
  })(s, []);
  return out;
}
const RULES = parse(css);
const decl = (body, prop) => { const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i').exec(body); return m ? m[1].trim() : null; };
const screenOnly = r => r.at.some(a => /@media screen/.test(a));
/* The 2.3.1 base layer's own hover rules moved in place into "@media screen and (hover: hover)" (2.16): they were never a
   fresh-coat state, so the fresh-coat checks read only rules written for screen (a hover nested in @media screen). */
const freshOnly = r => screenOnly(r) && !(r.at.length === 1 && r.at[0] === '@media screen and (hover: hover)');
const STATE_PROPS = ['background', 'background-color', 'background-image', 'border-color', 'color', 'box-shadow', 'transform', 'outline', 'outline-color', 'text-decoration-color', 'border-bottom-color', 'opacity', 'filter'];
const setsState = body => STATE_PROPS.some(p => decl(body, p) !== null);
/* Rules in @media screen whose selector list has one starting with base and carrying state (":hover"…). */
const stateRules = (base, state) => RULES.filter(r => screenOnly(r) && r.sel.some(x => x.indexOf(base) === 0 && x.indexOf(state) > base.length - 1 && x.slice(base.length).indexOf(state) >= 0) && setsState(r.body));

/* Tokens: the bare :root block and the two dark ones. */
const rootBlocks = () => {
  const bare = RULES.filter(r => !r.at.length && r.sel.length === 1 && r.sel[0] === ':root').map(r => r.body).join(';');
  const sys = RULES.filter(r => r.at.some(a => /prefers-color-scheme: dark/.test(a)) && r.sel.some(x => /:root:not\(\[data-theme="light"\]\)/.test(x))).map(r => r.body).join(';');
  const pick = RULES.filter(r => !r.at.length && r.sel.length === 1 && r.sel[0] === ':root[data-theme="dark"]').map(r => r.body).join(';');
  return { bare, sys, pick };
};
const token = (body, name) => decl(body, name.replace(/[-]/g, '\\-'));
const hex = v => { const m = /^#([0-9a-f]{6})$/i.exec(String(v || '').trim()); if (!m) throw new Error('not a plain hex color: ' + v); return [0, 2, 4].map(k => parseInt(m[1].slice(k, k + 2), 16)); };
const lum = c => { const l = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const contrast = (a, b) => { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/* ---------- 1. tokens ---------- */

const TOKENS = ['--hov', '--prs', '--hov-fill', '--prs-fill', '--track', '--edge', '--edge-strong', '--lift', '--lift-hi', '--ring', '--thumb', '--thumb-on', '--track-off', '--track-on', '--hero-eyebrow', '--t-fast', '--t', '--ease', '--spring'];
rule('Fresh coat: every state token is defined on :root and again in both dark blocks', () => {
  const b = rootBlocks();
  TOKENS.forEach(t => assert.ok(token(b.bare, t) !== null, t + ' on :root'));
  ['--hov', '--prs', '--hov-fill', '--prs-fill', '--track', '--edge', '--edge-strong', '--lift', '--lift-hi', '--ring', '--thumb', '--thumb-on', '--track-off', '--track-on', '--hero-eyebrow'].forEach(t => {
    assert.ok(token(b.sys, t) !== null, t + ' in the system dark block');
    assert.ok(token(b.pick, t) !== null, t + ' in the chosen dark block');
  });
});

/* ---------- 2. every family hovers and presses, inside @media screen ---------- */

const HOVER = ['.btn', '.btn.primary', '.btn.go', '.btn.stop', '.hero .btn', '.mini', '.fpe .mini', '.plist .tcard button.mini', '.chipbtn', 'button.ob-chip', '.seg button', '.mainnav button', '.mainnav button[aria-current="page"]', '.fpe-tabs [role="tab"]', 'button.card', '.tile', '.tile.warn', '.su-choice', '.su-tpl', '.rw .step', '.check', '.ob-step', '.ob-step.sel', '.ob-part', '.tf-switch input[type="checkbox"]', '.ev-switch', 'summary'];
const PRESS = ['.btn', '.mini', '.chipbtn', 'button.ob-chip', '.seg button', '.mainnav button', '[role="tab"]', 'summary', 'button.card', '.tile', '.su-choice', '.su-tpl', '.check', '.ev-switch'];
rule('Fresh coat: every control family has a hover rule in @media screen that changes how it looks', () => {
  const missing = HOVER.filter(b => !stateRules(b, ':hover').length);
  assert.deepStrictEqual(missing, [], 'no hover: ' + missing.join(' | '));
});
rule('Fresh coat: every button family has a press (:active) rule in @media screen', () => {
  const missing = PRESS.filter(b => !stateRules(b, ':active').length);
  assert.deepStrictEqual(missing, [], 'no press: ' + missing.join(' | '));
});
rule('Fresh coat: press and lift never apply to a disabled control, native or aria-disabled', () => {
  const bad = []; let seen = 0;
  RULES.filter(screenOnly).forEach(r => r.sel.forEach(x => {
    if (!/:active/.test(x) && !(/:hover/.test(x) && decl(r.body, 'transform'))) return;
    if (!/^(\.btn|\.mini|\.fpe \.mini|\.chipbtn|button\.|\.seg button|\.mainnav button|\.su-choice|\.check|\.ev-switch)/.test(x)) return;
    seen++; if (!/:not\(:disabled\)/.test(x) || !/:not\(\[aria-disabled="true"\]\)/.test(x)) bad.push(x);
  }));
  assert.ok(seen >= 15, 'press and lift rules to check: ' + seen);
  assert.deepStrictEqual(bad, [], 'press or lift without the disabled guard: ' + bad.join(' | '));
});
rule('Fresh coat: filled buttons keep their own color and border on hover and press (a tint over the fill, no gray ring)', () => {
  /* R1 (2.16): one black overlay for every filled primary, 8% on hover and 12% pressed; the hover excludes :active and the
     pressed rule comes after it, so pressed always wins. */
  ['.btn.primary', '.btn.go', '.btn.stop', '.hero .btn'].forEach(b => {
    const rs = stateRules(b, ':hover').concat(stateRules(b, ':active'));
    assert.ok(rs.length && rs.every(r => /var\(--r1-(hov|prs)\)/.test(decl(r.body, 'background-image') || '')), b + ' tints with the R1 overlays');
    const hov = RULES.findIndex(r => stateRules(b, ':hover').indexOf(r) >= 0), prs = RULES.findIndex(r => screenOnly(r) && r.sel.some(x => x.indexOf(b + ':active') === 0));
    assert.ok(stateRules(b, ':hover').every(r => r.sel.filter(x => x.indexOf(b) === 0 && /:hover/.test(x)).every(x => /:not\(:active\)/.test(x))), b + ' hover leaves :active out');
    assert.ok(prs > hov, b + ' pressed comes after hover');
    rs.forEach(r => ['background', 'background-color', 'border-color'].forEach(p => assert.strictEqual(decl(r.body, p), null, b + ' sets ' + p)));
  });
});
rule('Fresh coat: hover and press tint over a control instead of replacing its color, so selected and warning colors survive', () => {
  const bad = []; let seen = 0, tinted = 0;
  RULES.filter(freshOnly).forEach(r => r.sel.forEach(x => {
    if (!/:hover|:active/.test(x) || !/^(\.btn(?!\.)|\.btn:|\.mini|\.fpe \.mini|\.plist \.tcard button\.mini|\.chipbtn|button\.ob-chip|\.mainnav button|\.rw \.step|\.rw-ph)/.test(x)) return;
    seen++; if (/:hover/.test(x) && /var\(--(hov|prs)(-fill)?\)/.test(decl(r.body, 'background-image') || '')) tinted++;
    ['background', 'background-color'].forEach(p => { if (decl(r.body, p) !== null) bad.push(x + ' sets ' + p); });
  }));
  assert.ok(seen >= 12 && tinted >= 6, 'hover and press rules to check: ' + seen + ', tinting: ' + tinted);
  assert.deepStrictEqual(bad, [], bad.join('\n'));
});

/* ---------- 3. combined states keep their marks ---------- */

rule('Fresh coat: a hovered run row keeps its Next up bar, selection outline and blocked or re-check color', () => {
  const rs = RULES.filter(r => freshOnly(r) && r.sel.some(x => /^\.rw \.step\b.*:hover/.test(x)));
  assert.ok(rs.length, 'run rows hover');
  rs.forEach(r => {
    assert.ok(/var\(--hov\)/.test(decl(r.body, 'background-image') || ''), 'a tint: ' + r.sel.join(', '));
    ['background', 'background-color', 'box-shadow'].forEach(p => assert.strictEqual(decl(r.body, p), null, r.sel.join(', ') + ' sets ' + p));
  });
  const blocked = RULES.filter(r => screenOnly(r) && r.sel.some(x => /^\.(rw \.)?step\[data-a="blocked"\] \.check:hover/.test(x)));
  blocked.forEach(r => assert.ok(!decl(r.body, 'border-color') || /--stop/.test(decl(r.body, 'border-color')), 'a blocked check keeps its red edge'));
});
rule('Fresh coat: a hovered selected or incoming builder row keeps its insets; the half-row hover fill is gone', () => {
  const inc = stateRules('.ob-step.ob-inc', ':hover');
  assert.ok(inc.length && inc.every(r => /inset 4px 0 0 var\(--incoming\)/.test(decl(r.body, 'box-shadow') || '')), 'incoming inset kept while hovered');
  const sel = stateRules('.ob-step.sel', ':hover');
  assert.ok(sel.length && sel.every(r => /inset 3px 0 0 var\(--amber\)/.test(decl(r.body, 'box-shadow') || '')), 'amber inset kept while hovered');
  assert.ok(!RULES.some(r => r.sel.some(x => /\.ob-step:hover \.ob-pick/.test(x)) && (decl(r.body, 'background') || '') !== 'none' && decl(r.body, 'background') !== null && !/transparent|none/.test(decl(r.body, 'background'))), 'no partial fill on .ob-pick');
});
rule('Fresh coat: .ob-part has one hover rule, and it never moves (rail tooltips are fixed to it)', () => {
  const hov = RULES.filter(r => r.sel.some(x => x === '.ob-part:hover'));
  assert.strictEqual(hov.length, 1, 'exactly one .ob-part:hover rule, found ' + hov.length);
  assert.ok(!decl(hov[0].body, 'transform') || /none/.test(decl(hov[0].body, 'transform')), 'no transform on .ob-part hover');
});
rule('Fresh coat: the mini-button contexts that set a resting border still let hover through', () => {
  ['.fpe .mini', '.plist .tcard button.mini'].forEach(b => assert.ok(stateRules(b, ':hover').some(r => decl(r.body, 'border-color')), b + ' hover sets a border'));
});

/* ---------- 4. corners and focus ---------- */

rule('Fresh coat: a segmented toggle clips nothing, so a focus ring shows whole', () => {
  const scr = RULES.filter(r => screenOnly(r) && r.sel.indexOf('.seg') >= 0);
  assert.ok(scr.some(r => /^visible$/.test(decl(r.body, 'overflow') || '')), 'on screen the toggle clips nothing');
  scr.forEach(r => { const o = decl(r.body, 'overflow'); assert.ok(!o || !/hidden|clip/.test(o), '.seg overflow: ' + o); });
});
rule('Fresh coat: the gate stripe follows its rounded corner', () => {
  const r = RULES.find(x => screenOnly(x) && x.sel.some(s => s === '.fp-gate:not(.implicit)::before'));
  assert.ok(r && /border-radius|border-bottom-left-radius/.test(r.body), 'stripe has a bottom-left radius');
});

/* ---------- 5. motion ---------- */

rule('Fresh coat: no transition moves a layout property', () => {
  const bad = [];
  RULES.forEach(r => ['transition', 'transition-property'].forEach(p => { const v = decl(r.body, p); if (v && /(^|[\s,])(width|height|top|left|right|bottom|margin[\w-]*|padding[\w-]*|all)\b/.test(v)) bad.push(r.sel.join(', ') + ' { ' + p + ': ' + v + ' }'); }));
  assert.deepStrictEqual(bad, [], bad.join('\n'));
});
rule('Fresh coat: reduced motion stops transitions and animations on pseudo-elements too, and the landing moment', () => {
  const rm = RULES.filter(r => r.at.some(a => /prefers-reduced-motion: reduce/.test(a)));
  const all = rm.find(r => r.sel.indexOf('*') >= 0);
  assert.ok(all && all.sel.indexOf('*::before') >= 0 && all.sel.indexOf('*::after') >= 0, 'the override selects ::before and ::after');
  assert.ok(/transition:\s*none !important/.test(all.body) && /animation:\s*none !important/.test(all.body));
});

/* ---------- 6. forced colors ---------- */

rule('Fresh coat: forced colors keep current, selected, armed and checked states visible with a system-color edge', () => {
  const fc = RULES.filter(r => r.at.some(a => /forced-colors: active/.test(a)));
  ['.mainnav button[aria-current="page"]', '.seg button[aria-checked="true"]', '.seg button[aria-pressed="true"]', '.rw .step.sel', '.ob-part[aria-pressed="true"]', '.ob-step.sel', '.step[data-a="done"] .check'].forEach(s => {
    const r = fc.find(x => x.sel.indexOf(s) >= 0);
    assert.ok(r && /(Highlight|CanvasText|ButtonText|SelectedItem)/.test(r.body) && /(outline|border)/.test(r.body), 'forced colors for ' + s);
  });
});

/* ---------- 7. contrast that the new states depend on ---------- */

rule('Fresh coat: both switch thumbs read against their tracks, off and on, in light and dark (3:1)', () => {
  const b = rootBlocks();
  [['light', b.bare], ['dark', b.sys], ['dark (chosen)', b.pick]].forEach(([name, body]) => {
    const t = n => token(body, n) || token(b.bare, n);
    assert.ok(contrast(t('--thumb'), t('--track-off')) >= 3, name + ' off: ' + contrast(t('--thumb'), t('--track-off')).toFixed(2));
    assert.ok(contrast(t('--thumb-on'), t('--track-on')) >= 3, name + ' on: ' + contrast(t('--thumb-on'), t('--track-on')).toFixed(2));
  });
  ['.tf-switch input[type="checkbox"]::after', '.ev-knob::after'].forEach(s => assert.ok(RULES.some(r => r.sel.indexOf(s) >= 0 && /var\(--thumb\)/.test(r.body)), s + ' uses --thumb'));
  ['.tf-switch input[type="checkbox"]:checked::after', '.ev-switch[aria-checked="true"] .ev-knob::after'].forEach(s => assert.ok(RULES.some(r => r.sel.indexOf(s) >= 0 && /var\(--thumb-on\)/.test(r.body)), s + ' uses --thumb-on'));
});
rule('Fresh coat: the welcome eyebrow reads on its banner in both themes (4.5:1), and field edges keep 3:1', () => {
  const b = rootBlocks();
  [['light', b.bare], ['dark', b.sys], ['dark (chosen)', b.pick]].forEach(([name, body]) => {
    const t = n => token(body, n) || token(b.bare, n);
    assert.ok(contrast(t('--hero-eyebrow'), t('--ink')) >= 4.5, name + ' eyebrow: ' + contrast(t('--hero-eyebrow'), t('--ink')).toFixed(2));
    assert.ok(contrast(t('--field'), t('--card')) >= 3, name + ' field edge: ' + contrast(t('--field'), t('--card')).toFixed(2));
  });
  assert.ok(RULES.some(r => r.sel.indexOf('.su-hero .eyebrow') >= 0 && /var\(--hero-eyebrow\)/.test(r.body)));
});
rule('Fresh coat: fields keep their resting 3:1 edge, and the edge follows hover, focus and invalid', () => {
  assert.ok(!/border-color:\s*var\(--field\)\s*!important/.test(css), 'the edge is no longer pinned to --field');
  assert.ok(/border-color:\s*var\(--field-edge\)\s*!important/.test(css), 'the edge reads --field-edge');
  ['hover', 'focus'].forEach(st => assert.ok(RULES.some(r => r.sel.some(x => /^(input|select|textarea)/.test(x) && x.indexOf(':' + st) >= 0) && decl(r.body, '--field-edge')), st + ' sets --field-edge'));
  assert.ok(RULES.some(r => r.sel.some(x => /\[aria-invalid="true"\]/.test(x)) && /--field-edge:\s*var\(--stop\)/.test(r.body)), 'an invalid field has a red edge');
});

/* ---------- 8. the body face ---------- */

rule('Fresh coat: Instrument Sans is embedded (400–700) with its license, and the body uses it first', () => {
  const faces = [...css.matchAll(/@font-face\{([^}]*)\}/g)].map(m => m[1]);
  const inst = faces.filter(f => /font-family:'Instrument Sans'/.test(f));
  assert.strictEqual(inst.length, 1, 'one Instrument Sans face');
  assert.ok(/font-weight:400 700/.test(inst[0]), 'weight range 400–700');
  assert.ok(faces.some(f => /Barlow Condensed/.test(f)), 'headings still Barlow Condensed');
  assert.ok(/Copyright 2022 The Instrument Sans Project Authors/.test(css), 'license comment names Instrument Sans');
  assert.ok(/Instrument Sans Project Authors/.test(fs.readFileSync(path.join(__dirname, '..', 'dist', 'FONT-LICENSE.txt'), 'utf8')), 'FONT-LICENSE.txt too');
  assert.ok(/--body:\s*'Instrument Sans'/.test(css));
});

/* ---------- 9. the landing moment and the progress fill ---------- */

const V = loadViews(), K = V.vk;
rule('Fresh coat: the progress fill starts from what is shown, never from a stale target, and empty snaps', () => {
  assert.strictEqual(K.fillFrom(null, 0.5), null, 'nothing shown before: no motion');
  assert.strictEqual(K.fillFrom(0.25, 0), null, 'to empty: no motion');
  assert.strictEqual(K.fillFrom(0.5, 0.5), null, 'no change');
  assert.strictEqual(K.fillFrom(0.5, 0.503), null, 'a change under half a percent: no motion');
  assert.strictEqual(K.fillFrom(0, 0.5), 0, 'from empty: starts at scaleX(0)');
  assert.strictEqual(K.fillFrom(0.25, 0.5), 0.5, 'growing: from half');
  assert.strictEqual(K.fillFrom(0.75, 0.5), 1.5, 'shrinking: from wider');
  assert.strictEqual(K.fillFrom(0.3, 0.75), 0.4, 'mid-animation: from where it visibly is (0.3), not the old target');
});

const SMALL = ['---', 'process: release', 'title: Production release', 'owner: person-casey', '---', '',
  '## One {#one}', '- [ ] {confirm} Write it down {#w}', '- [ ] {confirm} Read it back {#rb}', '- [ ] {communicate} Post it {#post}', '  channel: #team-releases', '  message: Starting.', '', '## Gate: First check {#g1}', '', '## Two {#two}', '- [ ] {confirm} Ship it {#ship}'].join('\n');
const LAYOUT = o => Object.assign({ localStore: { 'preflight:builder': 'false' }, domFocus: true, layout: true }, o || {});
async function recorded(o) {
  const app = boot(LAYOUT(o)); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  await app.fs.write('maps/drafts/release.md', SMALL);
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  app.set('change-note', 'Small'); app.click('publish', 'release'); await app.tick(120);
  app.click('start', 'release'); await app.tick();
  app.chooseApprovers().submitForm('start-form', {}); await app.tick(200);
  assert.ok(/data-act="toggle" data-id="w"/.test(app.html()), 'set-up: recording the small run');
  return app;
}
async function practicing(o) {
  const app = boot(LAYOUT(o)); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  await app.fs.write('maps/drafts/release.md', SMALL);
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  app.click('ptab', 'edit'); await app.tick();
  app.click('pr-open'); await app.tick(60);
  assert.ok(/Practice<\/span> not recorded/.test(app.html()), 'set-up: practicing');
  return app;
}
/* What the app animated (the harness records animate() instead of playing it): the row glow, the check's spring, the fill. */
const anims = app => app.animations();
const rowLands = (app, id) => anims(app).filter(a => a.id === 'step-' + id && a.keyframes.some(k => 'backgroundColor' in k)).length;
const springs = app => anims(app).filter(a => /\bcheck\b/.test(a.cls) && a.keyframes.some(k => /scale\(1\.18\)/.test(k.transform || ''))).length;
const fills = app => anims(app).filter(a => a.tag === 'i' && a.keyframes.some(k => /scaleX/.test(k.transform || '')));
const fromOf = a => +/scaleX\(([\d.]+)\)/.exec(a.keyframes[0].transform)[1];
const runId = app => app.html().match(/data-act="open-run" data-id="([^"]+)"/g).map(x => x.split('"')[3]);

rule('Fresh coat: checking a step lands it once (row glow and check spring); unchecking, Refresh and opening it again replay nothing', async () => {
  const app = await recorded();
  app.click('toggle', 'w'); await app.tick(60);
  assert.strictEqual(rowLands(app, 'w'), 1, 'the row glows once');
  assert.strictEqual(springs(app), 1, 'the check springs once');
  app.click('toggle', 'w'); await app.tick(60);
  assert.strictEqual(rowLands(app, 'w'), 1, 'none after unchecking');
  app.click('toggle', 'w'); await app.tick(60);
  assert.strictEqual(rowLands(app, 'w'), 2, 'checking it again lands again');
  app.click('refresh'); await app.tick(120);
  assert.strictEqual(rowLands(app, 'w'), 2, 'a Refresh redraw lands nothing');
  app.click('nav', 'runs'); await app.tick(); app.click('open-run', runId(app)[0]); await app.tick(60);
  assert.strictEqual(rowLands(app, 'w'), 2, 'opening the run again replays nothing');
  assert.strictEqual(rowLands(app, 'rb'), 0, 'a step nobody checked never lands');
});
rule('Fresh coat: a refused check (a locked step) lands nothing, and Fill in on a done step corrects values without landing again', async () => {
  const app = await recorded();
  app.click('toggle', 'ship'); await app.tick(60);
  assert.notStrictEqual(app.html().match(/id="step-ship"[^>]*data-a="([^"]*)"/) && app.html().match(/id="step-ship"[^>]*data-a="([^"]*)"/)[1], 'done', 'set-up: the locked step stays open');
  assert.strictEqual(rowLands(app, 'ship'), 0, 'refused: no landing');
  app.click('toggle', 'post'); await app.tick(60);
  assert.strictEqual(rowLands(app, 'post'), 1, 'checking Post it lands');
  app.click('pick', 'post', { kind: 'fields' }); await app.tick();
  app.set('fld-channel', '#release-room'); app.click('save-fields', 'post'); await app.tick(120);
  assert.strictEqual(rowLands(app, 'post'), 1, 'correcting its values lands nothing more');
});
rule('Fresh coat: an answer made quietly or in another window (a background redraw) never lands', async () => {
  const app = await recorded();
  const p = Object.keys(app.fs.files).find(k => /^runs\/release\/[^/]+\/run\.json$/.test(k) && /\{#post\}/.test(JSON.parse(app.fs.files[k].t).snapshot || ''));
  const PF = require('./harness').load(), R = PF.run, json = R.sanitize(JSON.parse(app.fs.files[p].t));
  R.done(json, R.mapOf(json), 'w', 'person-blake', new Date().toISOString(), {});
  await app.fs.write(p, JSON.stringify(json, null, 2) + '\n');
  app.click('refresh'); await app.tick(200);
  assert.ok(/id="step-w"[^>]*data-a="done"/.test(app.html()) || /data-a="done"[^>]*id="step-w"/.test(app.html()), 'set-up: the answer from elsewhere is shown');
  assert.strictEqual(rowLands(app, 'w'), 0, 'another window\'s answer arrives without a landing');
  assert.strictEqual(springs(app), 0, 'and without a spring');
});
rule('Fresh coat: a check in practice lands; nothing is written for it', async () => {
  const app = await practicing();
  const files = Object.keys(app.fs.files).length;
  app.click('toggle', 'w'); await app.tick(60);
  assert.strictEqual(rowLands(app, 'w'), 1, 'practice lands too');
  assert.strictEqual(Object.keys(app.fs.files).length, files, 'no file for it');
});
rule('Fresh coat: with less motion asked for, nothing lands and the fill snaps', async () => {
  const app = await recorded({ reducedMotion: true });
  app.click('toggle', 'w'); await app.tick(60);
  app.click('toggle', 'rb'); await app.tick(60);
  assert.deepStrictEqual(anims(app), [], 'no animation at all');
});
rule('Fresh coat: the fill grows from what was drawn, shrinks on uncheck, snaps to empty, and a quick second check cancels the first', async () => {
  const app = await recorded();
  app.click('toggle', 'w'); await app.tick(60);
  let f = fills(app);
  assert.strictEqual(f.length, 1, 'one fill animation for a check');
  assert.strictEqual(fromOf(f[0]), 0, 'from empty: scaleX(0)');
  app.click('toggle', 'rb'); await app.tick(60);
  f = fills(app);
  assert.strictEqual(f.length, 2, 'a second check animates again');
  assert.ok(f[0].canceled, 'the first fill is canceled when the second starts');
  assert.ok(Math.abs(fromOf(f[1]) - 0.5) < 0.02, 'one of four answered to two of four: from half, ' + fromOf(f[1]));
  app.click('toggle', 'rb'); await app.tick(60);
  f = fills(app);
  assert.ok(fromOf(f[f.length - 1]) > 1.9, 'unchecking shrinks it from twice the new width, ' + fromOf(f[f.length - 1]));
  const n = f.length;
  app.click('toggle', 'w'); await app.tick(60);
  assert.strictEqual(fills(app).length, n, 'back to empty snaps: no animation');
  assert.ok(fills(app).every(a => a.canceled || a === fills(app)[n - 1]) && fills(app)[n - 1].canceled, 'and the running one is canceled');
});
rule('Fresh coat: opening another run never animates its bar from the last run\'s progress', async () => {
  const app = await recorded();
  app.click('toggle', 'w'); await app.tick(60); app.click('toggle', 'rb'); await app.tick(60); app.click('toggle', 'post'); await app.tick(60);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  app.click('start', 'release'); await app.tick(); app.chooseApprovers().submitForm('start-form', {}); await app.tick(200);
  const n = fills(app).length;
  app.click('nav', 'runs'); await app.tick();
  const ids = runId(app);
  ids.forEach(id => { app.click('open-run', id); });
  await app.tick(60);
  assert.strictEqual(fills(app).length, n, 'no fill animation when the run changes');
  assert.ok(fills(app).every(a => a.canceled), 'and whatever was running is canceled');
});

/* ---------- 10. what the review found missing ---------- */

rule('Fresh coat: printing keeps 2.3.1\'s look: no rule outside @media screen uses a fresh-coat token, and the base toggles, switches, gate stripe and eyebrow are 2.3.1\'s', () => {
  const NEW = ['--sel-bg', '--sel-ring', '--ctl-edge', '--ctl-edge-hi', '--link', '--r1-hov', '--r1-prs', '--hov', '--prs', '--hov-fill', '--prs-fill', '--track', '--edge', '--edge-strong', '--lift', '--lift-hi', '--ring', '--thumb', '--thumb-on', '--track-off', '--track-on', '--hero-eyebrow', '--spring'];
  const leaks = RULES.filter(r => !screenOnly(r) && !r.atRule && !r.sel.some(x => /^:root/.test(x)) && !r.at.some(a => /prefers-reduced-motion|forced-colors/.test(a)))
    .filter(r => NEW.some(t => new RegExp('var\\(' + t.replace(/-/g, '\\-') + '\\)').test(r.body))).map(r => r.sel.join(', '));
  assert.deepStrictEqual(leaks, [], 'fresh-coat tokens outside @media screen: ' + leaks.join(' | '));
  const base = s => RULES.filter(r => !r.at.length && r.sel.indexOf(s) >= 0).map(r => r.body).join(';');
  assert.ok(/overflow:\s*hidden/.test(base('.seg')) && /border:\s*1px solid var\(--field\)/.test(base('.seg')), 'the printed toggle is 2.3.1\'s');
  assert.ok(/background:\s*var\(--ink\)/.test(base('.seg button[aria-checked="true"]')), 'the printed choice is 2.3.1\'s dark block');
  assert.ok(!/radius/.test(base('.fp-gate:not(.implicit)::before')), 'the printed gate stripe is 2.3.1\'s');
  assert.ok(/var\(--amber\)/.test(base('.su-hero .eyebrow')), 'the printed eyebrow is 2.3.1\'s');
  assert.ok(/var\(--go\)/.test(base('.tf-switch input[type="checkbox"]:checked')) && /var\(--ink\)/.test(base('.ev-switch[aria-checked="true"] .ev-knob')), 'the printed switches are 2.3.1\'s');
  assert.ok(!RULES.some(r => !screenOnly(r) && r.sel.some(x => /\[aria-invalid="true"\]/.test(x)) && /--field-edge/.test(r.body)), 'the red invalid edge is screen only');
});
rule('Fresh coat: with less motion, nothing lifts, sinks or shrinks under the pointer', () => {
  const rm = RULES.filter(r => r.at.some(a => /prefers-reduced-motion: reduce/.test(a)) && /transform:\s*none !important/.test(r.body));
  const covered = new Set(rm.flatMap(r => r.sel));
  const moving = [];
  RULES.filter(screenOnly).forEach(r => { const t = decl(r.body, 'transform'); if (!t || /none/.test(t)) return; r.sel.forEach(x => { if (/:hover|:active/.test(x)) moving.push(x); }); });
  const fam = x => ['.btn', '.mini', '.chipbtn', 'button.ob-chip', '.mainnav button', '.seg button', '[role="tab"]', 'summary', 'button.card', '.tile', '.su-choice', '.su-tpl', '.check', '.ev-knob'].find(f => x.indexOf(f) === 0 || x.indexOf(' ' + f) >= 0);
  const bad = moving.filter(x => !fam(x) || !covered.has(fam(x)));
  assert.ok(moving.length >= 8, 'hover and press move things: ' + moving.length);
  assert.deepStrictEqual(bad, [], 'moves with less motion: ' + bad.join(' | '));
});
rule('Fresh coat: in forced colors a focused selected control gets its own ring, outside the selection edge', () => {
  const fc = RULES.filter(r => r.at.some(a => /forced-colors: active/.test(a)));
  ['.mainnav button[aria-current="page"]', '.seg button[aria-checked="true"]', '.seg button[aria-pressed="true"]', '.ob-part[aria-pressed="true"]', '.step[data-a="done"] .check'].forEach(s => {
    const r = fc.find(x => x.sel.indexOf(s + ':focus-visible') >= 0);
    assert.ok(r && /outline:\s*3px solid CanvasText/.test(r.body) && /outline-offset:\s*2px/.test(r.body), 'focus ring for ' + s);
  });
});
rule('Fresh coat: read-only and disabled fields keep still on hover and focus, and read as not editable', () => {
  RULES.filter(r => screenOnly(r) && r.sel.some(x => /^(input|select|textarea)/.test(x) && /:hover|:focus/.test(x)) && (decl(r.body, '--field-edge') || decl(r.body, 'box-shadow')))
    .forEach(r => r.sel.forEach(x => assert.ok(/:not\(\[readonly\]\):not\(:disabled\)/.test(x), 'unguarded: ' + x)));
  assert.ok(RULES.some(r => screenOnly(r) && r.sel.indexOf('textarea[readonly]') >= 0 && /var\(--muted\)/.test(r.body)), 'a read-only box reads muted');
});
rule('Fresh coat: a planned run\'s card keeps its purple edge while hovered', () => {
  assert.ok(RULES.some(r => screenOnly(r) && r.sel.indexOf('button.card.plan:hover') >= 0 && /border-color:\s*var\(--plan\)/.test(r.body)));
});
rule('Fresh coat: switch tracks ease between off and on and deepen on hover', () => {
  const tr = RULES.filter(r => screenOnly(r) && r.sel.indexOf('.tf-switch input[type="checkbox"]') >= 0).map(r => decl(r.body, 'transition') || '').join(' ');
  assert.ok(/background-color/.test(tr), 'the type editor\'s track eases: ' + tr);
  ['.tf-switch input[type="checkbox"]:hover:not(:disabled)', '.ev-switch:hover:not(:disabled):not([aria-disabled="true"]) .ev-knob'].forEach(s =>
    assert.ok(RULES.some(r => screenOnly(r) && r.sel.indexOf(s) >= 0 && /var\(--prs-fill\)/.test(decl(r.body, 'background-image') || '')), s + ' deepens'));
});

rule('Fresh coat: a quick second check starts the fill from where it visibly is mid-motion, not from the last target', async () => {
  const app = await recorded();
  app.paintAt(0.1);
  app.click('toggle', 'w'); await app.tick(60);
  const live = fills(app).filter(x => !x.canceled).pop(), n = fills(app).length;
  /* Held a tenth of the way, the bar shows a quarter (one of four) times where its animation is; two of four is a half. */
  const shown = 0.25 * (fromOf(live) + (1 - fromOf(live)) * 0.1), want = shown / 0.5;
  app.click('toggle', 'rb'); await app.tick(60);
  const next = fills(app)[n];
  assert.ok(next && Math.abs(fromOf(next) - want) < 0.02, 'from ' + want.toFixed(3) + ' (shown), not 0.5 (the last target): ' + (next && fromOf(next)));
  assert.ok(Math.abs(want - 0.5) > 0.1, 'set-up: shown and target differ');
});
rule('Fresh coat: Not needed lands nothing; Fill in in practice corrects values without landing again', async () => {
  const app = await recorded();
  app.click('na', 'rb'); await app.tick(60);
  assert.strictEqual(rowLands(app, 'rb'), 0, 'Not needed is not a landing');
  const pr = await practicing();
  pr.click('toggle', 'post'); await pr.tick(60);
  assert.strictEqual(rowLands(pr, 'post'), 1, 'practice: checking Post it lands');
  pr.click('pick', 'post', { kind: 'fields' }); await pr.tick();
  pr.set('fld-channel', '#release-room'); pr.click('save-fields', 'post'); await pr.tick(120);
  assert.strictEqual(rowLands(pr, 'post'), 1, 'practice: Fill in lands nothing more');
});
rule('Fresh coat: reopening the app on a run with answers replays no landing and no fill motion', async () => {
  const files = {};
  const a = await recorded({ sharedFiles: files });
  a.click('toggle', 'w'); await a.tick(60); a.click('toggle', 'rb'); await a.tick(200);
  const b = boot(LAYOUT({ sharedFiles: files })); await b.tick(60);
  b.choose('person-casey'); await b.tick();
  b.click('nav', 'runs'); await b.tick();
  const id = runId(b).find(x => { b.click('open-run', x); return /data-act="toggle" data-id="post"/.test(b.html()); });
  await b.tick(60);
  assert.ok(id, 'set-up: the small run opens in the new window');
  assert.strictEqual(rowLands(b, 'w') + rowLands(b, 'rb'), 0, 'no landing replays');
  assert.strictEqual(fills(b).length, 0, 'the bar draws where it is');
});
/* Composite a translucent tint over an opaque hex, as the browser paints background-image over background-color. */
const over = (rgba, hexBase) => { const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(rgba), b = hex(hexBase), a = +m[4]; return '#' + [1, 2, 3].map((k, i) => Math.round(+m[k] * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join(''); };
rule('Fresh coat: hovering or pressing a filled button never takes its text below 4.5:1, in either theme', () => {
  const b = rootBlocks();
  const fam = [['.btn.primary', '--ink', '--paper'], ['.btn.go', '--go', '--card'], ['.btn.stop', '--stop', '--card'], ['.hero .btn', '--amber', '--on-amber']];
  const tintOf = (sel, st) => { const rs = stateRules(sel, st).filter(r => r.sel.some(x => x.indexOf(sel + ':' + st.slice(1)) === 0)); const v = rs.map(r => decl(r.body, 'background-image')).filter(Boolean).pop(); return /var\((--[\w-]+)\)/.exec(v || '')[1]; };
  [['light', b.bare], ['dark', b.sys], ['dark (chosen)', b.pick]].forEach(([name, body]) => {
    const t = n => token(body, n) || token(b.bare, n);
    fam.forEach(([sel, bg, fg]) => [':hover', ':active'].forEach(st => {
      const tint = t(tintOf(sel, st)), shown = over(tint, t(bg)), c = contrast(shown, t(fg));
      assert.ok(c >= 4.5, name + ' ' + sel + st + ' (' + tintOf(sel, st) + '): ' + c.toFixed(2));
    }));
  });
});
rule('Fresh coat: every tab presses, the current one too, and a disabled tab never does', () => {
  const rs = RULES.filter(r => screenOnly(r) && r.sel.some(x => /^\[role="tab"\]:active/.test(x)));
  assert.ok(rs.length, 'a tab press rule');
  rs.forEach(r => r.sel.forEach(x => {
    assert.ok(!/aria-selected/.test(x), 'the current tab presses too: ' + x);
    assert.ok(/:not\(:disabled\)/.test(x) && /:not\(\[aria-disabled="true"\]\)/.test(x), 'guarded: ' + x);
  }));
});
rule('Fresh coat: emphasis never asks the body face for a weight it doesn\'t have (embedded 400–700)', () => {
  const bad = RULES.filter(r => /font-weight:\s*(800|900|bolder)/.test(r.body)).map(r => r.sel.join(', '));
  assert.deepStrictEqual(bad, [], bad.join(' | '));
  assert.ok(RULES.some(r => !r.at.length && r.sel.indexOf('b') >= 0 && r.sel.indexOf('strong') >= 0 && /font-weight:\s*700/.test(r.body)), 'b and strong are 700, never the browser\'s bolder');
});

/* ---------- one header and the affordance recipes (docs/design.md section 34) ---------- */
rule('Affordance: every :hover rule sits inside @media screen and (hover: hover), so a tap never leaves a hover look stuck', () => {
  const bad = RULES.filter(r => r.sel.some(x => /:hover/.test(x)) && !r.at.some(a => /hover:\s*hover/.test(a)));
  assert.deepStrictEqual(bad.map(r => r.sel.join(', ')).slice(0, 8), [], bad.length + ' hover rules outside (hover: hover)');
});
rule('Affordance: the recipe tokens are on :root, --link is redefined for both dark blocks, and none leaks into print', () => {
  const b = rootBlocks();
  ['--ctl-edge', '--ctl-edge-hi', '--sel-bg', '--sel-ring', '--link', '--gut', '--r1-hov', '--r1-prs'].forEach(t => assert.ok(token(b.bare, t) !== null, t + ' on :root'));
  assert.ok(token(b.sys, '--link') && token(b.pick, '--link'), '--link in both dark blocks');
  const leak = RULES.filter(r => !r.atRule && !screenOnly(r) && !(r.sel.length && /^:root/.test(r.sel[0])) && /var\(--(sel-bg|sel-ring|ctl-edge|link|r1-hov|r1-prs)\)/.test(r.body));
  assert.deepStrictEqual(leak.map(r => r.sel.join(', ')), [], 'recipe tokens used outside @media screen');
});
rule('Affordance: R1 hover is a black 8% overlay that excludes :active, and the 12% pressed rule comes after it', () => {
  ['.btn.primary', '.btn.go', '.btn.stop'].forEach(b => {
    const hi = RULES.findIndex(r => r.at.some(a => /hover:\s*hover/.test(a)) && r.sel.some(x => x.indexOf(b + ':hover:not(:active)') === 0) && /var\(--r1-hov\)/.test(decl(r.body, 'background-image') || ''));
    const pi = RULES.findIndex(r => screenOnly(r) && r.sel.some(x => x.indexOf(b + ':active') === 0) && /var\(--r1-prs\)/.test(decl(r.body, 'background-image') || ''));
    assert.ok(hi >= 0, b + ' hover uses --r1-hov and excludes :active'); assert.ok(pi > hi, b + ' pressed comes after hover');
  });
  const b = rootBlocks();
  assert.strictEqual(token(b.bare, '--r1-hov').replace(/\s/g, ''), 'rgba(0,0,0,.08)'); assert.strictEqual(token(b.bare, '--r1-prs').replace(/\s/g, ''), 'rgba(0,0,0,.12)');
});
rule('Affordance: selection never uses an action fill, and every selected recipe keeps a Highlight border under forced colors', () => {
  const SEL = ['.mainnav button[aria-current="page"]', 'button.tag.on', '.filter .chipbtn[aria-pressed="true"]', 'button.ob-chip[aria-pressed="true"]', '.ob-form .chipbtn[aria-pressed="true"]', '.tf-icon:has(input:checked)', '.rn-kinds .chipbtn[aria-pressed="true"]', '.rw-ph[data-s="current"]', '.sx-opt[aria-selected="true"]', '.dbx-o.on'];
  SEL.forEach(x => {
    const rs = RULES.filter(r => screenOnly(r) && !r.at.some(a => /forced-colors/.test(a)) && r.sel.indexOf(x) >= 0 && /var\(--sel-bg\)/.test(r.body));
    assert.ok(rs.length, x + ' uses the selected recipe');
    assert.ok(RULES.some(r => r.at.some(a => /forced-colors:\s*active/.test(a)) && r.sel.indexOf(x) >= 0 && /Highlight/.test(r.body)), x + ' under forced colors');
  });
});
rule('Affordance: the Markdown editor keeps the global focus outline (the field-focus rule leaves .code-editor out)', () => {
  const r = RULES.filter(r => r.sel.some(x => /textarea:not\(\[readonly\]\):not\(:disabled\)/.test(x) && /:focus/.test(x)));
  assert.ok(r.length && r.every(x => x.sel.filter(y => /^textarea:not/.test(y)).every(y => /:not\(\.code-editor\)/.test(y))), 'amended with :not(.code-editor)');
  assert.ok(RULES.some(r => r.sel.indexOf('.fpe-md .code-editor:focus-visible') >= 0 && /solid var\(--focus\)/.test(decl(r.body, 'outline') || '')), 'a solid inset outline');
});
rule('Affordance: separators sit in a 28px gutter column; only the 24px strip takes the pointer', () => {
  const cols = RULES.filter(r => r.sel.some(x => /fpe-panes/.test(x)) && decl(r.body, 'grid-template-columns'));
  assert.ok(cols.length >= 4, 'pane grids'); assert.ok(cols.some(r => /var\(--gut\)/.test(decl(r.body, 'grid-template-columns'))), 'gutter columns');
  assert.ok(!cols.some(r => /(^|\s)0(\s|$)/.test(decl(r.body, 'grid-template-columns')) && !/rail|max-width: 1100px/.test(r.sel.join(' ') + r.at.join(' '))), 'no 0 separator column but the rail\'s');
  assert.ok(RULES.some(r => r.sel.indexOf('.pane-split') >= 0 && decl(r.body, 'pointer-events') === 'none'), 'the separator itself takes no pointer');
  assert.ok(RULES.some(r => r.sel.indexOf('.pane-split::before') >= 0 && decl(r.body, 'width') === '24px' && decl(r.body, 'pointer-events') === 'auto'), 'its 24px strip does');
});
rule('One header: one rule hides the top bar on every work screen, and the old header layouts are gone', () => {
  assert.ok(RULES.some(r => r.sel.indexOf('html.work-on .top') >= 0 && decl(r.body, 'display') === 'none'), 'html.work-on .top');
  const old = RULES.filter(r => r.sel.some(x => /\.(fpe-head|ws-head|ws-right|fpe-tools|fpe-save|fpe-id|fpe-title|rw-tools|rw-me|pr-badge)\b/.test(x)) && !/min-width:\s*10ch/.test('') );
  assert.deepStrictEqual(old.map(r => r.sel.join(', ')).slice(0, 6), [], old.length + ' rules for the old header');
  assert.ok(!RULES.some(r => r.sel.some(x => /html\.(fpe-on|rw-on|tfe-on|rw-page) \.top/.test(x))), 'no per-screen top-bar rules');
  ['.hd', '.hd-l', '.hd-c', '.hd-r', '.hd-acts', '.tr', '.tg', '.facts', '.more-list'].forEach(x => assert.ok(RULES.some(r => r.sel.indexOf(x) >= 0), x + ' styled'));
  assert.ok(RULES.some(r => r.at.some(a => /max-width: 800px/.test(a)) && r.sel.indexOf('html.work-on .hd') >= 0 && decl(r.body, 'position') === 'sticky' && /var\(--keep-h\)/.test(decl(r.body, 'top') || '')), 'row 1 sticks under the banner on a phone');
  assert.ok(RULES.some(r => r.sel.indexOf('[role="tabpanel"]') >= 0 && /var\(--keep-h[^)]*\)\s*\+\s*var\(--hd-h/.test(decl(r.body, 'scroll-margin-top') || '')), 'tab panels land below the header');
});
rule('One header: above 800px every row 1 control is exactly 36px: the way back, the view switch, the primary and More', () => {
  const wide = RULES.filter(r => r.at.some(a => /min-width: 801px/.test(a)));
  const r1 = wide.filter(r => r.sel.some(x => /^\.hd :is\(/.test(x)) && decl(r.body, 'height') === '36px');
  assert.strictEqual(r1.length, 1, 'one shared row 1 sizing rule');
  const sel = r1[0].sel.join(', ');
  /* Exactly these four: row 1's way back, the view switch, the primary's slot and More's opener. Nothing in More's list (its
     items keep R8), and the status line's links keep their link recipe. */
  assert.strictEqual(sel, '.hd :is(.hd-l > .backc, .hd-c button, .hd-acts :is(.btn, .mini), .more-btn):not(.linkish)');
  assert.strictEqual(decl(r1[0].body, 'min-height'), '36px');
  assert.strictEqual(decl(r1[0].body, 'box-sizing'), 'border-box');
});
rule('One header: a status line\'s links are 24px targets: the inline-sentence exception leaves .hd-st alone', () => {
  const ex = RULES.filter(r => r.sel.some(x => /^p\b[^,]*button\.linkish/.test(x)) && decl(r.body, 'display') === 'inline');
  assert.ok(ex.length >= 1, 'the inline-sentence exception exists');
  ex.forEach(r => r.sel.forEach(x => assert.match(x, /^p:not\(\.hd-st\) /, 'the exception skips the status line: ' + x)));
  assert.ok(RULES.some(r => r.sel.indexOf('button.linkish') >= 0 && decl(r.body, 'min-height') === '24px' && decl(r.body, 'display') === 'inline-flex'), 'the 24px link recipe');
});
rule('One header: native fields in a tool row (Pause\'s box, Hand off\'s select) and the reason line\'s controls are sized: 32px above 800, 44px at 800 and less', () => {
  const wide = RULES.filter(r => r.at.some(a => /min-width: 801px/.test(a))), phone = RULES.filter(r => r.at.some(a => /max-width: 800px/.test(a)));
  const fields = '.tr :is(input:not([type="checkbox"]):not([type="radio"]), select)';
  assert.ok(wide.some(r => r.sel.join(', ') === fields && decl(r.body, 'height') === '32px' && decl(r.body, 'box-sizing') === 'border-box'), 'tool-row fields 32px above 800');
  assert.ok(phone.some(r => r.sel.join(', ') === fields && decl(r.body, 'min-height') === '44px'), 'tool-row fields 44px on a phone');
  assert.ok(wide.some(r => r.sel.join(', ') === '.hd-why :is(.btn, .mini)' && decl(r.body, 'height') === '32px'), 'reason-line controls 32px above 800');
});
rule('One header: a long way back shrinks with an ellipsis and keeps its view suffix whole', () => {
  const t = RULES.filter(r => r.sel.some(x => /\.backc-t\b/.test(x)));
  assert.ok(t.some(r => decl(r.body, 'min-width') === '0' && decl(r.body, 'overflow') === 'hidden' && decl(r.body, 'text-overflow') === 'ellipsis'), 'the label truncates: ' + t.map(r => r.body).join(' | '));
  assert.ok(RULES.some(r => r.sel.indexOf('.backc .backc-v') >= 0 && decl(r.body, 'flex') === 'none'), 'the view suffix never shrinks');
  assert.ok(RULES.some(r => r.sel.indexOf('.backc') >= 0 && decl(r.body, 'min-width') === '0'), 'the button itself can shrink');
});
rule('One header: nothing hides the step-type editor\'s status on a phone, and the old header pieces have no styles left', () => {
  const st = RULES.filter(r => r.sel.some(x => /\.fpe-type \.fpe-state/.test(x)) && (decl(r.body, 'display') === 'none' || /rect\(/.test(decl(r.body, 'clip') || '') || decl(r.body, 'width') === '1px'));
  assert.deepStrictEqual(st.map(r => r.sel.join(', ') + ' { ' + r.body.trim() + ' }'), [], 'the status line shows');
  const gone = RULES.filter(r => r.sel.some(x => /\.(fpe-checks|fpe-done|fpe-practice|rw-back)\b/.test(x)));
  assert.deepStrictEqual(gone.map(r => r.sel.join(', ')), [], 'unused');
});
rule('One header: above 800px every tool-row control is exactly 32px, the Builder | Markdown group too', () => {
  const wide = RULES.filter(r => r.at.some(a => /min-width: 801px/.test(a)));
  assert.ok(wide.some(r => r.sel.some(x => /^\.tr :is\(/.test(x)) && decl(r.body, 'height') === '32px'), '.tr controls 32px');
  assert.ok(wide.some(r => r.sel.indexOf('.tr .seg') >= 0 && decl(r.body, 'height') === '32px'), 'the group 32px');
});

rule('One header: at 800px and narrower every header and tool-row control is 44px tall, on every work screen', () => {
  const phone = RULES.filter(r => r.at.some(a => /max-width: 800px/.test(a)) && /^44px$/.test(decl(r.body, 'min-height') || ''));
  const has = s => phone.some(r => r.sel.some(x => x.startsWith(s)));
  ['.hd :is(', '.tr :is(', '.tr .seg button'].forEach(s => assert.ok(has(s), s + ' 44px on a phone'));
});

rule('One header: at 800px and narrower a link-styled button in a header or tool row (Discard my changes) is 44px tall too', () => {
  const phone = RULES.filter(r => r.at.some(a => /max-width: 800px/.test(a)) && /^44px$/.test(decl(r.body, 'min-height') || ''));
  const heads = phone.map(r => r.sel.join(', '));
  ['.hd', '.tr'].forEach(w => assert.ok(heads.some(h => h.indexOf(w + ' :is(button.link, button.linkish)') >= 0), w + ': button.link and button.linkish 44px on a phone'));
});

/* 2.16.1 polish: one header for real, and a spacing system (the design's section 11). */
const R = (sel, at) => RULES.filter(r => r.sel.join(', ') === sel && (at === undefined ? !r.at.length : r.at.some(a => at.test(a))));
rule('Polish: the spacing scale and its roles are tokens on the first :root', () => {
  const root = RULES.find(r => r.sel.join(', ') === ':root' && !r.at.length);
  [['--sp-h', '2px'], ['--sp-1', '4px'], ['--sp-2', '8px'], ['--sp-3', '12px'], ['--sp-4', '16px'], ['--sp-5', '20px'], ['--sp-6', '24px'], ['--sp-8', '32px'], ['--sp-12', '48px'], ['--lh-meta', '18px']]
    .forEach(([k, v]) => assert.strictEqual(decl(root.body, k), v, k));
  ['--hd-py', '--hd-px', '--tr-py', '--pane-pt', '--pane-px', '--pane-pb', '--rail-px', '--card-py', '--card-px', '--stripe-pad'].forEach(k => assert.ok(/^var\(--sp-/.test(decl(root.body, k) || ''), k + ' on the scale'));
});
rule('Polish: the header, the tool row and the alerts pad with tokens inside their safe-area formulas', () => {
  const pad = sel => decl(R(sel)[0].body, 'padding') || '';
  assert.strictEqual(pad('.hd'), 'var(--hd-py) max(var(--hd-px), env(safe-area-inset-right, 0px)) var(--hd-py) max(var(--hd-px), env(safe-area-inset-left, 0px))');
  assert.strictEqual(pad('.tr'), 'var(--tr-py) max(var(--hd-px), env(safe-area-inset-right, 0px)) var(--tr-py) max(var(--hd-px), env(safe-area-inset-left, 0px))');
  const ins = R('.rw-ins-body', /max-width: 800px/).map(r => decl(r.body, 'padding')).filter(Boolean);
  assert.ok(ins.some(v => /env\(safe-area-inset-bottom, 0px\)/.test(v)), 'the phone inspector keeps its bottom safe area: ' + ins);
});
rule('Polish: the header is a grid from 801px, and row 1 is pinned to the first line, not centered on what wraps', () => {
  assert.ok(R('.hd', /^@media \(min-width: 801px\)$/).some(r => decl(r.body, 'display') === 'grid'), 'grid from 801');
  assert.ok(!RULES.some(r => r.sel.join(', ') === '.hd' && r.at.some(a => /min-width: 1180px/.test(a)) && decl(r.body, 'display') === 'grid'), 'not from 1180');
  assert.strictEqual(decl(R('.hd')[0].body, 'align-items'), 'flex-start');
  assert.ok(!RULES.some(r => r.sel.some(x => /\.hd-l > \.backc/.test(x)) && /--hd-id-h/.test(decl(r.body, 'margin-top') || '')), 'no offset to keep in step with a status height: row 1 is the way back\'s own line');
});
rule('Polish: one owner for header type: .hd-st sets it, the nested save state inherits, and the checklist page is the one larger variant', () => {
  const st = R('.hd-st')[0].body;
  assert.strictEqual(decl(st, 'font-size'), '13px'); assert.strictEqual(decl(st, 'line-height'), '20px'); assert.strictEqual(decl(st, 'min-height'), '24px');
  RULES.filter(r => r.sel.some(x => /\.fpe-state\b/.test(x) && !/\.fpe-state \.ic\b/.test(x))).forEach(r =>
    ['font-size', 'line-height'].forEach(p => assert.strictEqual(decl(r.body, p), null, r.sel.join(', ') + ' sets its own ' + p)));
  assert.strictEqual(decl(R('.phd .hd-id h1')[0].body, 'font-size'), '30px');
});
rule('Polish: Discard has a slot before the primary, never a reserved place or a reordered one; it is 44px on a phone', () => {
  assert.ok(R('.hd-sa').some(r => decl(r.body, 'display') === 'flex'), '.hd-sa');
  assert.ok(!RULES.some(r => r.sel.some(x => /\.fpe-discard\[hidden\]/.test(x))), 'no reservation for a hidden Discard');
  assert.ok(!RULES.some(r => r.sel.some(x => /\.hd-sa\b/.test(x)) && decl(r.body, 'order') !== null), 'visual order is DOM order');
  assert.ok(R('.hd-sa > button', /max-width: 800px/).some(r => decl(r.body, 'min-height') === '44px'), '44px on a phone');
});
rule('Polish: the progress bar gives way at 801-999 visually only: it is never display:none, so its progressbar role and values stay', () => {
  RULES.filter(r => r.sel.some(x => /\.hd-bar\b/.test(x))).forEach(r => assert.notStrictEqual(decl(r.body, 'display'), 'none', r.sel.join(', ') + ' in ' + r.at.join(' ')));
  assert.ok(R('.hd-bar', /min-width: 801px\) and \(max-width: 1099px/).some(r => decl(r.body, 'clip-path') === 'inset(50%)' && decl(r.body, 'position') === 'absolute'), 'visually hidden up to 1099');
});
rule('Polish: the progress gives way before More does: its word up to 1279, its bar up to 1099, and in the workspace at 801-859 all of it, visually only', () => {
  assert.ok(R('.hd:has(.ws-views) .hd-prog .w', /^@media \(max-width: 1279px\)$/).some(r => decl(r.body, 'display') === 'none'), 'in the workspace, answered hides up to 1279');
  const w = RULES.filter(r => r.sel.join(', ') === '.hd-prog .w'); 
  assert.ok(w.length === 1 && w[0].at.length === 1 && w[0].at[0] === '@media (max-width: 1179px)' && decl(w[0].body, 'display') === 'none', 'every run follows one rule, 2.16.0\'s: answered hides up to 1179, well clear of the 1280 the screenshots use');
  const ws = R('.hd:has(.ws-views) .hd-prog', /min-width: 801px\) and \(max-width: 859px/);
  assert.ok(ws.some(r => decl(r.body, 'clip-path') === 'inset(50%)' && decl(r.body, 'position') === 'absolute'), 'the workspace\'s progress, whose count the Practice button also says, is visually hidden at 801-859');
  assert.ok(R('.hd:has(.ws-views) .hd-bar', /^@media \(max-width: 800px\)$/).some(r => decl(r.body, 'clip-path') === 'inset(50%)' && decl(r.body, 'position') === 'absolute'), 'and on a phone the workspace\'s bar gives way to its count, so More stays beside the primary');
});
rule('Polish: Practice\'s real-systems warning wraps: nothing truncates it', () => {
  RULES.filter(r => r.sel.some(x => /\.rw-say\b/.test(x))).forEach(r => {
    assert.notStrictEqual(decl(r.body, 'white-space'), 'nowrap', r.sel.join(', ')); assert.strictEqual(decl(r.body, 'text-overflow'), null, r.sel.join(', '));
  });
});
rule('Polish: the run screen\'s overrides no longer shrink the base spacing, and keep their layout', () => {
  assert.strictEqual(RULES.filter(r => r.sel.join(', ') === '.rw-list .deck').length, 0, 'no 14px deck override');
  const step = R('.rw .step')[0].body;
  assert.strictEqual(decl(step, 'padding'), null); assert.strictEqual(decl(step, 'gap'), null); assert.ok(decl(step, 'grid-template-columns') && decl(step, 'border-top') === '0' && decl(step, 'align-items') === 'center', 'keeps its grid, border and alignment');
  assert.ok(R('.rw .phase .placard').length && R('.rw .phase .placard').every(r => decl(r.body, 'padding') === null), 'the run placard pads like the base');
  assert.strictEqual(decl(R('.rw .steps .step + .step')[0].body, 'margin-top'), 'var(--sp-1)');
  assert.ok(/^248px /.test(decl(R('.fpe-panes.rw-panes')[0].body, 'grid-template-columns')), 'the rail is 248 in its own rule');
  assert.strictEqual(decl(R('.s-meta')[0].body, 'line-height'), 'var(--lh-meta)');
});
rule('Polish: the builder\'s phase gap, phase body and tool-group divider are on the scale, with the slot that sits in the gap', () => {
  assert.strictEqual(decl(R('.ob-phases')[0].body, 'gap'), 'var(--sp-4)');
  assert.strictEqual(decl(R('.ob-phases > .ob-slot')[0].body, 'margin-top'), 'calc(-1 * var(--sp-4))');
  assert.strictEqual(decl(R('.ob-body')[0].body, 'padding'), 'var(--sp-1) var(--sp-3) var(--sp-2)');
  const tg = R('.tg + .tg')[0].body; assert.strictEqual(decl(tg, 'padding-left'), 'var(--sp-3)'); assert.strictEqual(decl(tg, 'margin-left'), 'var(--sp-1)');
});

rule('Polish: the status line spans the left column under the way back and the title, so a status has room before it wraps', () => {
  assert.strictEqual(decl(R('.hd-l')[0].body, 'display'), 'grid');
  assert.strictEqual(decl(R('.hd-id')[0].body, 'display'), 'contents');
  assert.strictEqual(decl(R('.hd-st')[0].body, 'grid-column'), '1 / -1');
  assert.ok(RULES.some(r => r.sel.join(', ') === '.hd-l:not(:has(> .backc))' && /^minmax\(0, 1fr\)$/.test(decl(r.body, 'grid-template-columns') || '')), 'with no way back, the title has the whole width');
});
rule('Polish: a status separator never begins or ends a line: each piece leads with one the same width on both sides, and the line is pulled left and clipped so the one leading a line never shows', () => {
  assert.ok(!RULES.some(r => r.sel.some(x => /\.hd-st\b/.test(x) && /::after/.test(x)) && /"·"/.test(decl(r.body, 'content') || '')), 'no separator hangs after a piece');
  const sep = RULES.filter(r => r.sel.join(', ') === '.hd-st > :is(.d, .act)::before');
  assert.ok(sep.length === 1 && /^"·" \/ ""$/.test(decl(sep[0].body, 'content') || '') && decl(sep[0].body, 'position') === 'absolute' && decl(sep[0].body, 'left') === '0' && decl(sep[0].body, 'width') === 'var(--sep-w)' && decl(sep[0].body, 'justify-content') === 'center' && decl(sep[0].body, 'margin') === null, 'one centered separator of a fixed width, no margin to make one side wider');
  // A piece that wraps inside itself keeps every line out of the clipped strip: the inset is the piece's own, on every line.
  assert.ok(RULES.some(r => r.sel.join(', ') === '.hd-st > :is(.d, .act)' && decl(r.body, 'padding-left') === 'var(--sep-w)' && decl(r.body, 'position') === 'relative'), 'each piece is inset by the separator width on every line');
  const st = R('.hd-st')[0].body;
  assert.strictEqual(decl(st, 'margin-left'), 'calc(-1 * var(--sep-w))', 'the line starts a separator to the left of the column');
  assert.ok(/^inset\(-\d+px -\d+px -\d+px calc\(var\(--sep-w\) - [3-5]px\)\)$/.test(decl(st, 'clip-path') || ''), 'and clips it away, leaving room for a focus ring: ' + decl(st, 'clip-path'));
  assert.ok(/^\d+px 0$/.test(decl(st, 'gap') || ''), 'the separator is the only space between pieces: ' + decl(st, 'gap'));
  assert.ok(/--sep-w: 14px/.test(R(':root')[0].body), 'the separator width is a token');
  assert.ok(R('.hd-st .hd-dot').some(r => decl(r.body, 'word-spacing') === 'var(--sep-ws)') && /--sep-ws: [\d.]+px/.test(R(':root')[0].body), 'a "·" inside a piece is widened to the same width');
  RULES.filter(r => r.sel.some(x => /^\.hd-st \.d$/.test(x))).forEach(r => { assert.strictEqual(decl(r.body, 'text-overflow'), null); assert.notStrictEqual(decl(r.body, 'white-space'), 'nowrap'); });
});
rule('Polish: at 801-859 Edit\'s unsaved row 1 fits on one line like Practice\'s: the view switch drops its icons there, and Discard never takes a line of its own', () => {
  assert.ok(R('.ws-views .ic', /min-width: 801px\) and \(max-width: 859px/).some(r => decl(r.body, 'display') === 'none'), 'the labels stay, the icons go');
  assert.ok(!RULES.some(r => r.sel.join(', ') === '.hd-sa' && decl(r.body, 'flex-basis') === '100%'), 'no line of its own');
});
rule('Polish: a header with no view switch gives its title the room: two columns, not a centered empty one', () => {
  assert.ok(R('.hd:has(> .hd-c:empty)', /^@media \(min-width: 801px\)$/).some(r => decl(r.body, 'grid-template-columns') === 'minmax(0, 1fr) auto'));
  assert.ok(R('.hd-c:empty', /^@media \(min-width: 801px\)$/).some(r => decl(r.body, 'display') === 'none'));
});
rule('Polish: a run detail\'s Rename and Remove stay on its row; only the "used in" note wraps when the inspector is narrow', () => {
  const g = R('.ob-metalist li:has(> [data-act="ob-ren"])');
  assert.ok(g.some(r => decl(r.body, 'display') === 'grid' && decl(r.body, 'grid-template-columns') === 'minmax(0, max-content) minmax(min-content, 1fr) auto auto'), 'one row: name, note, Rename, Remove');
});

rule('Polish: the inspector\'s top row wraps, and where the step is takes the room left of Previous and Next', () => {
  assert.ok(R('.rw-ins-top').some(r => decl(r.body, 'flex-wrap') === 'wrap'));
  assert.ok(R('.rw-where').some(r => decl(r.body, 'margin-right') === 'auto' && decl(r.body, 'min-width') === '0'));
});

rule('Polish: at 801-899 the view switch shows Practice without its kept count in Edit and Practice alike (its name still says it), so Edit\'s Discard, Save draft and More stay on row 1', () => {
  assert.ok(R('.ws-views .ws-cnt', /min-width: 801px\) and \(max-width: 899px/).some(r => decl(r.body, 'display') === 'none'));
});

rule('Polish: the checklist page\'s run buttons keep their own width, and wrap inside their column, so they never cover its tabs at any width', () => {
  assert.ok(R('.hd.phd', /^@media \(min-width: 801px\)$/).some(r => decl(r.body, 'grid-template-columns') === 'minmax(0, 1fr) auto minmax(min-content, 1fr)'), 'the right column is never narrower than its widest button');
  assert.ok(R('.phd .hd-acts', /^@media \(min-width: 801px\)$/).some(r => decl(r.body, 'flex-wrap') === 'wrap'), 'and the buttons wrap inside it');
  assert.ok(!RULES.some(r => r.sel.join(', ') === '.phd > .hd-r' && decl(r.body, 'grid-column') === '1 / -1'), 'no breakpoint guess sends them to a row of their own');
});

rule('Styles: every comment in the page\'s CSS closes before the next one opens, so no rule is swallowed', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'page.html'), 'utf8'), css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
  const bad = []; let i = 0;
  for (;;) { const j = css.indexOf('/*', i); if (j < 0) break; const k = css.indexOf('*/', j + 2); if (k < 0) { bad.push('unclosed: ' + css.slice(j, j + 60)); break; } if (css.slice(j + 2, k).indexOf('/*') >= 0) bad.push(css.slice(j, j + 60)); i = k + 2; }
  assert.deepStrictEqual(bad, [], 'a comment holds another comment\'s start: rules between them are dead');
});

rule('One header: the tool row\'s facts rules are scoped to the tool row, so the skill page\'s dl.facts keeps its grid', () => {
  const facts = RULES.filter(r => !r.atRule && r.sel.some(x => /(^|[\s>+~])\.facts\b/.test(x) || /^\.facts\b/.test(x)));
  const bare = facts.filter(r => r.sel.some(x => /^\.facts(\s|$)/.test(x)));
  bare.forEach(r => { const d = decl(r.body, 'display'); assert.ok(d === null || d === 'grid', 'a bare .facts rule changes the grid: ' + r.sel.join(', ') + ' { ' + r.body.trim() + ' }'); ['flex-basis', 'margin-left', 'justify-content', 'flex-wrap'].forEach(pr => assert.strictEqual(decl(r.body, pr), null, 'a bare .facts rule sets ' + pr + ': ' + r.sel.join(', '))); });
  assert.ok(RULES.some(r => !r.at.length && r.sel.join(', ') === '.tr > .facts' && decl(r.body, 'display') === 'flex' && decl(r.body, 'margin-left') === 'auto'), 'the tool row\'s facts: flex, pushed right');
  assert.ok(RULES.some(r => r.at.some(a => /max-width: 800px/.test(a)) && r.sel.join(', ') === '.tr > .facts' && decl(r.body, 'flex-basis') === '100%'), 'the tool row\'s facts on a phone: their own line');
  const grid = RULES.filter(r => !r.at.length && r.sel.join(', ') === '.facts' && decl(r.body, 'display') === 'grid');
  assert.strictEqual(grid.length, 1, 'the dl.facts grid');
});
rule('One header: the save state in a status line reads whole: no fixed width or end-justified box clips its start, and it wraps on a phone', () => {
  const st = RULES.filter(r => !r.atRule && r.sel.some(x => /\.fpe-state\b/.test(x) && !/\.fpe-state\.(dirty|just)\b|\.fpe-state \.ic\b/.test(x)));
  st.forEach(r => {
    const w = decl(r.body, 'width'); assert.ok(w === null || w === 'auto', 'a fixed width on the save state: ' + r.sel.join(', ') + ' width: ' + w);
    assert.notStrictEqual(decl(r.body, 'justify-content'), 'flex-end', 'an end-justified save state overflows at its start: ' + r.sel.join(', '));
  });
  const sv = RULES.filter(r => !r.at.length && r.sel.join(', ') === '.hd-st .d.sv');
  assert.strictEqual(sv.length, 1, 'the status line\'s save-state piece has its own rule');
  assert.strictEqual(decl(sv[0].body, 'white-space'), 'normal', 'it wraps');
  assert.strictEqual(decl(sv[0].body, 'overflow'), 'visible', 'it clips nothing');
});
run();
