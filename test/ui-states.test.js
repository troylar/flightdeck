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
const PRESS = ['.btn', '.mini', '.chipbtn', 'button.ob-chip', '.seg button', '.mainnav button', 'button.card', '.tile', '.su-choice', '.check', '.ev-switch'];
rule('Fresh coat: every control family has a hover rule in @media screen that changes how it looks', () => {
  const missing = HOVER.filter(b => !stateRules(b, ':hover').length);
  assert.deepStrictEqual(missing, [], 'no hover: ' + missing.join(' | '));
});
rule('Fresh coat: every button family has a press (:active) rule in @media screen', () => {
  const missing = PRESS.filter(b => !stateRules(b, ':active').length);
  assert.deepStrictEqual(missing, [], 'no press: ' + missing.join(' | '));
});
rule('Fresh coat: press and lift never apply to a disabled control, native or aria-disabled', () => {
  const bad = [];
  RULES.filter(screenOnly).forEach(r => r.sel.forEach(x => {
    if (!/:active/.test(x) && !(/:hover/.test(x) && decl(r.body, 'transform'))) return;
    if (!/^(\.btn|\.mini|\.fpe \.mini|\.chipbtn|button\.|\.seg button|\.mainnav button|\.su-choice|\.check|\.ev-switch)/.test(x)) return;
    if (!/:not\(:disabled\)/.test(x) || !/:not\(\[aria-disabled="true"\]\)/.test(x)) bad.push(x);
  }));
  assert.deepStrictEqual(bad, [], 'press or lift without the disabled guard: ' + bad.join(' | '));
});
rule('Fresh coat: filled buttons keep their own color and border on hover and press (a tint over the fill, no gray ring)', () => {
  ['.btn.primary', '.btn.go', '.btn.stop', '.hero .btn'].forEach(b => {
    const rs = stateRules(b, ':hover').concat(stateRules(b, ':active'));
    assert.ok(rs.length && rs.every(r => /var\(--(hov|prs)-fill\)/.test(decl(r.body, 'background-image') || '')), b + ' tints with --hov-fill / --prs-fill');
    rs.forEach(r => ['background', 'background-color', 'border-color'].forEach(p => assert.strictEqual(decl(r.body, p), null, b + ' sets ' + p)));
  });
});
rule('Fresh coat: hover and press tint over a control instead of replacing its color, so selected and warning colors survive', () => {
  const bad = [];
  RULES.filter(screenOnly).forEach(r => r.sel.forEach(x => {
    if (!/:hover|:active/.test(x) || !/^(\.btn(?!\.)|\.btn:|\.mini|\.fpe \.mini|\.plist \.tcard button\.mini|\.chipbtn|button\.ob-chip|\.mainnav button|\.rw \.step|\.rw-ph)/.test(x)) return;
    ['background', 'background-color'].forEach(p => { if (decl(r.body, p) !== null) bad.push(x + ' sets ' + p); });
  }));
  assert.deepStrictEqual(bad, [], bad.join('\n'));
});

/* ---------- 3. combined states keep their marks ---------- */

rule('Fresh coat: a hovered run row keeps its Next up bar, selection outline and blocked or re-check color', () => {
  const rs = RULES.filter(r => screenOnly(r) && r.sel.some(x => /^\.rw \.step\b.*:hover/.test(x)));
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
  RULES.filter(r => r.sel.indexOf('.seg') >= 0).forEach(r => { const o = decl(r.body, 'overflow'); assert.ok(!o || !/hidden|clip/.test(o), '.seg overflow: ' + o); });
});
rule('Fresh coat: the gate stripe follows its rounded corner', () => {
  const r = RULES.find(x => x.sel.some(s => s === '.fp-gate:not(.implicit)::before'));
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
  '## One {#one}', '- [ ] {confirm} Write it down {#w}', '- [ ] {confirm} Read it back {#rb}', '', '## Gate: First check {#g1}'].join('\n');
async function recorded() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  await app.fs.write('maps/drafts/release.md', SMALL);
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  app.set('change-note', 'Small'); app.click('publish', 'release'); await app.tick(120);
  app.click('start', 'release'); await app.tick();
  app.submitForm('start-form', {}); await app.tick(200);
  assert.ok(/data-act="toggle" data-id="w"/.test(app.html()), 'set-up: recording the small run');
  return app;
}
async function practicing() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  await app.fs.write('maps/drafts/release.md', SMALL);
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  app.click('ptab', 'edit'); await app.tick();
  app.click('pr-open'); await app.tick(60);
  assert.ok(/Practice · not recorded/.test(app.html()), 'set-up: practicing');
  return app;
}
/* The landing looks its row up once, after the redraws; the harness records what the app asked the page for. */
const lands = (app, id) => app.asked().filter(x => x === '.rw #step-' + id).length;
rule('Fresh coat: checking a step lands it once; unchecking and later redraws never replay it', async () => {
  const app = await recorded();
  app.click('toggle', 'w'); await app.tick(60);
  assert.strictEqual(lands(app, 'w'), 1, 'one landing after a check');
  app.click('toggle', 'w'); await app.tick(60);
  assert.strictEqual(lands(app, 'w'), 1, 'none after unchecking');
  app.click('toggle', 'w'); await app.tick(60);
  assert.strictEqual(lands(app, 'w'), 2, 'checking it again lands again');
  app.click('nav', 'runs'); await app.tick(); app.click('open-run', app.html().match(/data-act="open-run" data-id="([^"]+)"/)[1]); await app.tick(60);
  assert.strictEqual(lands(app, 'w'), 2, 'opening the run again replays nothing');
  assert.strictEqual(lands(app, 'rb'), 0, 'a step nobody checked never lands');
});
rule('Fresh coat: a check in practice lands; nothing is written for it', async () => {
  const app = await practicing();
  const files = Object.keys(app.fs.files).length;
  app.click('toggle', 'w'); await app.tick(60);
  assert.strictEqual(lands(app, 'w'), 1, 'practice lands too');
  assert.strictEqual(Object.keys(app.fs.files).length, files, 'no file for it');
});

run();
