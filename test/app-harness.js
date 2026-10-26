// Runs the built app (dist/flightdeck.html) under a tiny stand-in for the browser, so tests can click buttons, pause the folder
// at an exact moment, and check what ended up in the files. It isn't a browser: layout, focus and screen readers still need people.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

function element(id) {
  const attrs = {};
  return {
    id, value: '', checked: false, dataset: {}, _html: '',
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; }, hasAttribute(k) { return k in attrs; },
    querySelector() { return null; }, querySelectorAll() { return []; }, contains() { return false; }, focus() {}, closest() { return null; }
  };
}

/* A stand-in for BroadcastChannel shared by every window booted with the same bus. */
function bus() {
  const chans = [];
  return class { constructor(name) { this.name = name; this.onmessage = null; chans.push(this); }
    postMessage(data) { chans.forEach(c => { if (c !== this && c.name === this.name && c.onmessage) setTimeout(() => c.onmessage({ data: JSON.parse(JSON.stringify(data)) }), 0); }); }
    close() { const i = chans.indexOf(this); if (i >= 0) chans.splice(i, 1); } };
}

/* A stand-in for navigator.locks shared by windows: one holder per name at a time. */
function locks() {
  const tails = {};
  return { request(name, fn) { const prev = tails[name] || Promise.resolve(); let release; const mine = new Promise(r => { release = r; }); tails[name] = prev.then(() => mine); return prev.then(() => Promise.resolve().then(fn)).then(v => { release(); return v; }, e => { release(); throw e; }); } };
}

function boot(opts) {
  opts = opts || {};
  /* opts.html: another build of the app (an older release, for the cross-version tests); this build by default. */
  const html = opts.html || fs.readFileSync(path.join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8');
  const script = id => new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>').exec(html)[1];
  const intervals = [];
  // Tests start past the first-run welcome unless they ask for it (firstRun).
  const els = {}, listeners = {}, winListeners = {}, store = Object.assign(opts.firstRun ? {} : { 'preflight:look-around': 'true' }, opts.localStore || {}), inputs = new Set();
  /* opts.replace: a redraw makes typed boxes anew, as setting innerHTML does: focus leaves them and the caret goes to the start,
     so only the app's own code puts them back. focus() and setSelectionRange() then work on the boxes, as on a page. */
  const get = id => {
    if (!els[id]) {
      const el = els[id] = element(id);
      el.focus = () => { if (opts.domFocus || opts.replace) document.activeElement = el; };
      if (opts.replace) el.setSelectionRange = (a, b) => { el.selectionStart = a; el.selectionEnd = b; };
    }
    return els[id];
  };
  ['app', 'top', 'overlay', 'live', 'tab-badge'].forEach(get);
  /* Like a real page: a redraw recreates the screen's inputs as their markup draws them, and the app's own code puts back what
     was typed. Only the boxes drawn now are on the page; one that isn't keeps its last value, so a test can still read it. */
  const appEl = els.app;
  const drawnValue = (html, id) => {
    const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const at = html.indexOf('id="' + id + '"'); if (at < 0) return null;
    const tag = html.lastIndexOf('<', at), name = html.slice(tag + 1, tag + 9);
    /* As in HTML, a line break right after <textarea> isn't part of its value. */
    if (/^textarea/.test(name)) { const o = html.indexOf('>', at) + 1; return un(html.slice(o, html.indexOf('</textarea>', o))).replace(/^\n/, ''); }
    if (/^select/.test(name)) { const m = /<option[^>]*value="([^"]*)"[^>]*\sselected/.exec(html.slice(at, html.indexOf('</select>', at))); return m ? un(m[1]) : ''; }
    const m = /\svalue="([^"]*)"/.exec(html.slice(at, html.indexOf('>', at))); return m ? un(m[1]) : '';
  };
  Object.defineProperty(appEl, 'innerHTML', { get() { return this._html; }, set(v) { this._html = String(v); inputs.forEach(id => { const d = drawnValue(this._html, id); if (d === null) return; els[id].value = d; if (opts.replace) { els[id].selectionStart = els[id].selectionEnd = 0; if (document.activeElement === els[id]) document.activeElement = document.body; } }); } });
  const onScreen = id => appEl._html.indexOf('id="' + id + '"') >= 0;
  /* Thumbnail placeholders as nodes: the same node while it stays drawn, a new one once it's drawn again (as morph does). */
  const thumbs = new Map(), unq = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const drawnThumbs = () => [...appEl._html.matchAll(/data-thumb="([^"]*)"/g)].map(m => unq(m[1]));
  /* Every form control drawn in a region, as the page has it now: what was typed (set(), select(), check()) on the ones a test
     touched, the drawn value on the rest. defaultValue / defaultChecked are what the markup draws, as in a browser, and
     closest() answers for the marks that say a control is kept as a draft or safe to leave. */
  const controls = root => {
    const html = root._html || '', out = [];
    const spans = attr => { const r = []; const re = new RegExp('<(\\w+)\\b[^>]*\\s' + attr + '\\b[^>]*>', 'g'); let m; while ((m = re.exec(html))) { const tag = m[1]; let depth = 1, i = m.index + m[0].length; const tre = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'g'); tre.lastIndex = i; let t; while (depth && (t = tre.exec(html))) depth += t[1] ? -1 : 1; r.push([m.index, t ? t.index : html.length]); } return r; };
    const marked = ['data-draft-kept', 'data-nav-safe'].map(spans).reduce((a, b) => a.concat(b), []);
    const re = /<(input|textarea|select)\b[^>]*>/g; let m;
    while ((m = re.exec(html))) {
      const tag = m[0], idm = /\sid="([^"]*)"/.exec(tag); if (!idm) continue;
      const id = unq(idm[1]), typ = (/\stype="([^"]*)"/.exec(tag) || [])[1] || (m[1] === 'input' ? 'text' : m[1]);
      const def = drawnValue(html, id), defChecked = /\schecked\b/.test(tag), at = m.index;
      const el = inputs.has(id) || (els[id] && els[id]._touched) ? els[id] : { id, value: def, checked: defChecked, dataset: {} };
      el.tagName = m[1].toUpperCase(); if (!inputs.has(id) || !el.type) el.type = typ;
      Object.defineProperty(el, 'defaultValue', { configurable: true, get: () => def }); el.defaultChecked = defChecked;
      el.hasAttribute = a => new RegExp('\\s' + a + '(=|\\s|>|$)').test(tag);
      if (!el._ownClosest) el._ownClosest = el.closest || (() => null);
      const own = el._ownClosest;
      el.closest = sel => /data-draft-kept/.test(sel) ? (/\sdata-(draft-kept|nav-safe)\b/.test(tag) || marked.some(([a, b]) => at >= a && at < b) ? {} : null) : own.call(el, sel);
      out.push(el);
    }
    return out;
  };
  els.overlay.querySelectorAll = sel => sel === 'input, textarea, select' ? controls(els.overlay) : [];
  appEl.querySelectorAll = sel => {
    if (sel === 'input, textarea, select') return controls(appEl);
    if (sel === '[data-thumb]') { const now = drawnThumbs(); [...thumbs.keys()].forEach(k => { if (now.indexOf(k) < 0) thumbs.delete(k); }); return now.map(k => { if (!thumbs.has(k)) thumbs.set(k, { nodeType: 1, dataset: { thumb: k } }); return thumbs.get(k); }); }
    return /input|textarea|select/.test(sel) ? [...inputs].filter(onScreen).map(id => els[id]) : [];
  };
  appEl.contains = el => !!el && (el.dataset && el.dataset.thumb != null && !el.id ? drawnThumbs().indexOf(el.dataset.thumb) >= 0 && thumbs.get(el.dataset.thumb) === el : inputs.has(el.id) && onScreen(el.id));
  /* Where the app asked focus to go: renders look up their focus target with querySelector. */
  const asked = [];
  /* Animations the app started (opts.layout): which node, its keyframes, and whether it was canceled. */
  const animations = [];
  /* How far a moving fill has got (0 to 1); 1, finished, unless a test holds it partway. */
  const paint = { t: 1 };
  /* The builder's properties form, as far as the phone sheet needs it: a node under the screen that can be marked. */
  appEl.children = [];
  const formAttrs = {};
  const form = { closest: () => null, contains: () => false, querySelector: () => null, parentNode: appEl, setAttribute(k, v) { formAttrs[k] = v; }, removeAttribute(k) { delete formAttrs[k]; }, hasAttribute: k => k in formAttrs };
  appEl.querySelector = sel => { asked.push(sel); if (sel === '.ob-form') return /class="panel stack ob-form"/.test(appEl._html) ? form : null; if (opts.replace && /^#[\w-]+$/.test(sel) && inputs.has(sel.slice(1)) && onScreen(sel.slice(1))) return els[sel.slice(1)]; return opts.domFocus ? drawn(appEl, sel) : null; };
  if (opts.domFocus) { const was = appEl.contains; appEl.contains = el => !!el && ((el._region === appEl && el._src === appEl._html) || was(el)); }
  const session = opts.sessionStore || {};
  const sessionStorage = { getItem: k => (k in session ? session[k] : null), setItem: (k, v) => { session[k] = String(v); }, removeItem: k => { delete session[k]; } };
  // storageThrows: a pattern of keys the browser refuses to read or write (blocked site data, a full quota): those calls throw.
  const refuse = k => { if (opts.storageThrows === true || (opts.storageThrows && opts.storageThrows.test(k))) throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' }); };
  const storage = () => ({ getItem: k => (refuse(k), k in store ? store[k] : null), setItem: (k, v) => { refuse(k); store[k] = String(v); }, removeItem: k => { refuse(k); delete store[k]; } });
  const document = {
    hidden: false, title: '', body: element('body'), activeElement: null,
    getElementById: id => els[id] || (opts.domFocus ? drawnAnywhere('#' + id) : null), querySelector: sel => (opts.domFocus ? drawnAnywhere(sel) : null), querySelectorAll: () => [], createElement: () => element('x'), createRange: () => ({ selectNodeContents() {} }),
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }, contains: () => false
  };
  document.activeElement = document.body;
  // The page's root element, for the classes the app puts on it (the editor's page, a separator being dragged).
  const rootClasses = new Set();
  document.documentElement = { classList: { add: (...c) => c.forEach(x => rootClasses.add(x)), remove: (...c) => c.forEach(x => rootClasses.delete(x)), contains: c => rootClasses.has(c) }, setAttribute() {}, removeAttribute() {} };
  const bodyClasses = new Set();
  document.body.classList = { add: (...c) => c.forEach(x => bodyClasses.add(x)), remove: (...c) => c.forEach(x => bodyClasses.delete(x)), contains: c => bodyClasses.has(c) };
  const window = {
    innerWidth: opts.narrow ? 375 : 1400, scrollY: 0, scrollTo() {}, matchMedia: q => ({ matches: (!!opts.narrow && /max-width/.test(q)) || (!!opts.reducedMotion && /prefers-reduced-motion: reduce/.test(q)) }), getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); }
  };
  /* The address bar and session history of a file:// page: a list of entries and an index. back(), forward() and go(n)
     queue a traversal; each completes on a later tick, one at a time, moving the index, the URL and history.state before
     its popstate fires, as a browser does. holdPops() holds the queue (a slow browser, keys pressed quickly). go(0) and
     location.reload() would reload the page and lose what's in memory: reloads() counts them. A URL that isn't a bare
     hash throws, as a cross-document change would; historyThrows makes every call throw (a sandboxed frame). */
  const BASE = 'file:///C:/team/flightdeck.html';
  const copyState = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
  // opts.hash and opts.historyState: the entry the page loads on (a reload, a bookmark); opts.entries (and opts.index): the
  // whole session history it loads into, as { hash, state } (entries made before a reload).
  const hist = { entries: (opts.entries || [{ hash: opts.hash || '', state: opts.historyState }]).map(e => ({ url: BASE + (e.hash || ''), state: copyState(e.state) })), queue: [], held: false, busy: false, reloads: 0, mismatch: 0 };
  hist.index = opts.index != null ? opts.index : hist.entries.length - 1;
  const secErr = m => Object.assign(new Error(m), { name: 'SecurityError' });
  const hashOf = u => { const i = u.indexOf('#'); return i < 0 || i === u.length - 1 ? '' : u.slice(i); };
  const urlOf = u => { if (u === undefined || u === null) return hist.entries[hist.index].url; if (typeof u !== 'string' || u[0] !== '#') throw secErr('Only the hash may change: ' + u); return BASE + u; };
  const blocked = () => { if (opts.historyThrows) throw secErr('The operation is insecure.'); };
  const history = {
    get length() { return hist.entries.length; }, scrollRestoration: 'auto',
    get state() { return copyState(hist.entries[hist.index].state); },
    pushState(st, t, u) { blocked(); const url = urlOf(u); hist.entries.splice(hist.index + 1); hist.entries.push({ url, state: copyState(st) }); hist.index++; },
    replaceState(st, t, u) { blocked(); const url = urlOf(u); hist.entries[hist.index] = { url, state: copyState(st) }; },
    go(n) { blocked(); n = Number(n) || 0; if (!n) { hist.reloads++; return; } traverse({ delta: n }); },
    back() { this.go(-1); }, forward() { this.go(1); }
  };
  const location = { protocol: 'file:', get href() { return hist.entries[hist.index].url; }, get hash() { return hashOf(hist.entries[hist.index].url); }, reload() { hist.reloads++; } };
  window.history = history; window.location = location;
  function traverse(item) { hist.queue.push(item); pump(); }
  function pump() {
    if (hist.held || hist.busy || !hist.queue.length) return;
    hist.busy = true;
    setTimeout(() => {
      hist.busy = false;
      if (hist.held || !hist.queue.length) return;
      const it = hist.queue.shift();
      if (it.typed != null) { hist.entries.splice(hist.index + 1); hist.entries.push({ url: BASE + it.typed, state: null }); hist.index++; }
      else { const to = hist.index + it.delta; if (to < 0 || to >= hist.entries.length) { pump(); return; } hist.index = to; }
      const ev = { state: history.state }, at = hist.index, url = hist.entries[at].url;
      (winListeners.popstate || []).forEach(fn => {
        // The event and the entry the browser is on always agree when a listener starts.
        if (hist.index !== at || hist.entries[at].url !== url || JSON.stringify(ev.state) !== JSON.stringify(history.state)) hist.mismatch++;
        fn(ev);
      });
      pump();
    }, 0);
  }
  /* Opt-in (domFocus): the drawn HTML answers getElementById and querySelector with nodes, and focus() moves
     document.activeElement, so a test can see where focus went. One node per drawn element while the HTML is unchanged. */
  const parsedRegions = new Map();
  const VOID = /^(input|img|br|hr|meta|link|area|base|col|embed|source|track|wbr)$/;
  const attrsOf = src => { const a = {}; src.replace(/\s([\w:-]+)(?:="([^"]*)")?/g, (m, k, v) => { a[k] = v == null ? '' : unq(v); return m; }); return a; };
  function nodesOf(region) {
    const html = region._html || '', was = parsedRegions.get(region);
    if (was && was.html === html) return was.nodes;
    const nodes = [], stack = [], re = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g; let m;
    while ((m = re.exec(html))) {
      const tag = m[2].toLowerCase();
      if (m[1]) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.splice(i).forEach(n => { n._end = m.index; }); break; } continue; }
      const n = drawnNode(region, html, tag, attrsOf(m[3]), m.index, stack[stack.length - 1] || null);
      nodes.push(n);
      if (!VOID.test(tag) && !/\/$/.test(m[3])) stack.push(n); else n._end = m.index + m[0].length;
    }
    stack.forEach(n => { n._end = html.length; });
    parsedRegions.set(region, { html, nodes });
    return nodes;
  }
  function splitTop(sel, ch) { const out = []; let depth = 0, q = false, cur = ''; for (const c of sel) { if (c === '"') q = !q; if (!q && c === '[') depth++; if (!q && c === ']') depth--; if (!q && !depth && (ch === ',' ? c === ',' : /\s/.test(c))) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; } cur += c; } if (cur.trim()) out.push(cur.trim()); return out; }
  function compound(c) {
    const re = /^([a-zA-Z][\w-]*|\*)?((?:#[\w-]+|\.[\w-]+|\[[\w-]+(?:="(?:[^"\\]|\\.)*")?\])*)$/, m = re.exec(c);
    if (!m) return null;
    const parts = { tag: m[1] && m[1] !== '*' ? m[1].toLowerCase() : null, ids: [], classes: [], attrs: [] };
    m[2].replace(/#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="((?:[^"\\]|\\.)*)")?\]/g, (x, id, cl, k, v) => { if (id) parts.ids.push(id); else if (cl) parts.classes.push(cl); else parts.attrs.push([k, v == null ? null : v.replace(/\\(.)/g, '$1')]); return x; });
    return parts;
  }
  function matchOne(n, p) {
    if (!p) return false;
    if (p.tag && n.tagName.toLowerCase() !== p.tag) return false;
    if (p.ids.some(id => n._attrs.id !== id)) return false;
    const cls = (n._attrs.class || '').split(/\s+/);
    if (p.classes.some(c => cls.indexOf(c) < 0)) return false;
    return p.attrs.every(([k, v]) => k in n._attrs && (v == null || n._attrs[k] === v));
  }
  function matches(n, sel) {
    return splitTop(sel, ',').some(alt => {
      const chain = splitTop(alt, ' ').map(compound);
      if (!matchOne(n, chain[chain.length - 1])) return false;
      let anc = n._parent, i = chain.length - 2;
      while (i >= 0 && anc) { if (matchOne(anc, chain[i])) i--; anc = anc._parent; }
      return i < 0;
    });
  }
  function drawnNode(region, html, tag, attrs, at, parent) {
    const ds = {}; Object.keys(attrs).forEach(k => { if (/^data-/.test(k)) ds[k.slice(5).replace(/-(\w)/g, (x, c) => c.toUpperCase())] = attrs[k]; });
    const n = {
      tagName: tag.toUpperCase(), id: attrs.id || '', dataset: ds, _attrs: attrs, _region: region, _src: html, _at: at, _parent: parent, nodeType: 1,
      getAttribute: k => (k in attrs ? attrs[k] : null), hasAttribute: k => k in attrs, setAttribute(k, v) { attrs[k] = String(v); }, removeAttribute(k) { delete attrs[k]; },
      classList: { contains: c => (attrs.class || '').split(/\s+/).indexOf(c) >= 0, add() {}, remove() {} },
      focus() { document.activeElement = n; }, scrollIntoView() {}, getClientRects: () => [1], select() {}, setSelectionRange() {},
      // A typed box (an element the test made) is inside when its drawn node is.
      contains: o => { if (o && o._src === undefined && o.id) o = nodesOf(region).filter(x => x.id === o.id)[0]; return !!o && o._src === n._src && o._region === n._region && o._at >= n._at && o._at < n._end; },
      closest: sel => { for (let x = n; x; x = x._parent) if (matches(x, sel)) return x; return null; },
      querySelectorAll: sel => nodesOf(region).filter(x => x !== n && n.contains(x) && matches(x, sel)),
      // opts.layout: a 1,000-pixel-wide page where a drawn width:N% is N% of its box, and animate() is recorded, not played.
      ...(opts.layout ? {
        clientWidth: 1000,
        getBoundingClientRect: () => {
          const m = /width:\s*([\d.]+)%/.exec(attrs.style || ''); let w = m ? +m[1] * 10 : 1000;
          // A progress fill that's still moving shows where its animation is (app.paintAt), not its target.
          const live = tag === 'i' && parent && /\brw-bar\b/.test(parent._attrs.class || '') && animations.filter(a => a.tag === 'i' && !a.canceled).pop();
          if (live) { const from = +(/scaleX\(([\d.]+)\)/.exec(live.keyframes[0].transform) || [0, 1])[1]; w *= from + (1 - from) * paint.t; }
          return { width: w, height: 20, top: 0, left: 0, right: 1000, bottom: 20 };
        },
        animate(keyframes, o) { const a = { id: n.id, cls: attrs.class || '', tag, keyframes, opts: o, canceled: false, cancel() { a.canceled = true; } }; animations.push(a); return a; }
      } : {}),
      querySelector: sel => n.querySelectorAll(sel)[0] || null
    };
    if (/^(input|textarea|select)$/.test(tag) && attrs.id) { const d = drawnValue(html, attrs.id); n.value = d == null ? '' : d; n.defaultValue = n.value; n.type = attrs.type || (tag === 'input' ? 'text' : tag); }
    return n;
  }
  const drawn = (region, sel) => { try { return nodesOf(region).filter(x => matches(x, sel))[0] || null; } catch (e) { return null; } };
  const drawnAnywhere = sel => [appEl, els.overlay, els.top].map(r => drawn(r, sel)).filter(Boolean)[0] || null;
  if (opts.domFocus) {
    const own = r => el => !!el && el._region === r && el._src === r._html;
    ['top', 'overlay'].forEach(k => { const r = els[k]; r.querySelector = sel => drawn(r, sel); r.contains = own(r); });
  }
  // A folder the picker hands over (see folderHandle), for the screens that choose a real folder.
  // A function picks the folder at each choice, so a test can hand over another folder the next time.
  if (opts.picker) window.showDirectoryPicker = () => Promise.resolve(typeof opts.picker === 'function' ? opts.picker() : opts.picker);
  /* opts.timers: the app's delayed timers (any delay over 0) wait in a queue the test moves with advanceTimers(ms); none
     fires on its own. Zero-delay timers still run as usual, so promise chains and redraws on the next turn aren't held. */
  const timerQ = [], clock = { now: 0, id: 1 };
  const appSetTimeout = !opts.timers ? setTimeout : (fn, ms) => { if (!(ms > 0)) return setTimeout(fn, 0); const t = { id: 'm' + clock.id++, at: clock.now + ms, fn }; timerQ.push(t); return t.id; };
  const appClearTimeout = !opts.timers ? clearTimeout : id => { const i = timerQ.findIndex(t => t.id === id); if (i >= 0) timerQ.splice(i, 1); else clearTimeout(id); };
  const ctx = vm.createContext({
    window, document, history, location, localStorage: storage(), sessionStorage, navigator: Object.assign(opts.locks ? { locks: opts.locks } : {}, opts.navigator || {}), BroadcastChannel: opts.Channel, console, Date: opts.Date || Date, Math, JSON, Promise, Blob, fetch, btoa, Uint8Array,
    setTimeout: appSetTimeout, clearTimeout: appClearTimeout, setInterval: fn => { intervals.push(fn); return 0; }, requestAnimationFrame: fn => setTimeout(fn, 0), URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    crypto: globalThis.crypto, TextEncoder, indexedDB: opts.indexedDB, IntersectionObserver: opts.IntersectionObserver,
    // An elapsed-time clock the test moves (performance.now()); left out, the app falls back on Date.now().
    performance: opts.performance,
    getComputedStyle: opts.layout ? () => ({ getPropertyValue: () => '#1D7650', backgroundColor: 'rgba(0, 0, 0, 0)', position: 'static', visibility: 'visible', lineHeight: '20px' }) : undefined
  });
  vm.runInContext(script('pf-core'), ctx);
  /* Builds before 1.17 kept storage inside pf-app (the cross-version tests run those). */
  if (/<script id="pf-storage">/.test(html)) vm.runInContext(script('pf-storage'), ctx);
  // Checklists parsed once are shared by every run of a version: frozen here, so a rule that changed one would fail a test.
  if (ctx.PF.run.mapMemo) ctx.PF.run.mapMemo.freeze = true;
  // Remember the in-browser folder the app creates, so tests can plant files in it as "another computer" would.
  const PF = ctx.PF;
  let fsModule, app = null;
  Object.defineProperty(PF, 'fs', {
    configurable: true, get: () => fsModule,
    set: v => {
      fsModule = v; const origList = v.MemoryFS.prototype.list; v.MemoryFS.prototype.list = function (p) { if (app) app.fs = this; return origList.call(this, p); };
      // Windows booted with the same sharedFiles object see one folder, as two tabs on one computer do.
      if (opts.sharedFiles) { Object.defineProperty(v.MemoryFS.prototype, 'files', { configurable: true, get: () => opts.sharedFiles, set: () => {} }); v.MemoryFS.prototype.persist = () => true; }
    }
  });
  vm.runInContext(script('pf-app'), ctx);
  /* The scope an input sits in, read from the page as drawn now: the nearest data-scope before it. */
  const scopeOf = id => { const h = els.app.innerHTML, at = h.indexOf('id="' + id + '"'); if (at < 0) return null; const m = h.slice(0, at).match(/data-scope="([^"]*)"/g); return m ? { dataset: { scope: m[m.length - 1].slice(12, -1) } } : null; };
  const tick = (n = 20) => new Promise(res => { let i = 0; (function loop() { if (i++ >= n) return res(); setTimeout(loop, 0); })(); });
  app = {
    PF, store, session, fs: null, tick,
    // With opts.timers: move the app's clock by ms, firing every delayed timer that comes due, in order; and the ones waiting.
    advanceTimers(ms) { const until = clock.now + ms; for (;;) { timerQ.sort((x, y) => x.at - y.at); const t = timerQ[0]; if (!t || t.at > until) break; timerQ.shift(); clock.now = t.at; t.fn(); } clock.now = until; },
    pendingTimers: () => timerQ.map(t => ({ in: t.at - clock.now })),
    html: () => els.app.innerHTML,
    // The last place a render tried to put focus (a selector or an element id), ignoring the app's own lookups by class.
    focused: () => asked.filter(x => x && x[0] !== '.').pop() || null,
    live: () => els.live.textContent || '',
    bodyClasses: () => [...bodyClasses],
    rootClasses: () => [...rootClasses],
    // A window event the app listens for (blur, resize…).
    winFire(type, ev) { (winListeners[type] || []).forEach(fn => fn(Object.assign({}, ev || {}))); },
    // Whether the top bar is inert, and the form marked as a dialog (the phone's properties sheet).
    topInert: () => els.top.hasAttribute('inert'), formModal: () => formAttrs.role === 'dialog',
    // Change the window across the phone breakpoint, as resizing or rotating does.
    setNarrow(v) { opts.narrow = v; (winListeners.resize || []).forEach(fn => fn()); },
    // Whether leaving the page now would ask first (beforeunload).
    leaveWarns() { let warned = false; (winListeners.beforeunload || []).forEach(fn => fn({ preventDefault() { warned = true; }, set returnValue(v) { warned = true; } })); return warned; },
    top: () => els.top.innerHTML,
    // The page shell's tab-only badge (fixed above every screen, sheet and dialog), and whether anything made it inert.
    badge: () => els['tab-badge'].innerHTML,
    badgeInert: () => els['tab-badge'].hasAttribute('inert'),
    overlay: () => els.overlay.innerHTML,
    // Submit a form as a browser would: its data-* attributes, and its fields' values (typed with set(), else as drawn), come
    // from the page. dataset overrides what the page drew, to simulate a form drawn earlier.
    submitForm(id, dataset) {
      const html = els.app.innerHTML, at = html.search(new RegExp('<form[^>]*\\bid="' + id + '"'));
      if (at < 0) throw new Error('No form ' + id + ' on the page');
      const form = html.slice(at, html.indexOf('</form>', at)), el = get(id), ds = {};
      const unesc = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      const attr = (tag, k) => { const m = new RegExp('\\s' + k + '="([^"]*)"').exec(tag); return m ? unesc(m[1]) : null; };
      form.slice(0, form.indexOf('>') + 1).replace(/\sdata-([\w-]+)="([^"]*)"/g, (m, k, v) => { ds[k.replace(/-(\w)/g, (x, c) => c.toUpperCase())] = unesc(v); });
      el.dataset = Object.assign(ds, dataset || {});
      const fields = [];
      (form.match(/<input\b[^>]*>/g) || []).forEach(tag => { const fid = attr(tag, 'id'); if (!fid) return; if (!inputs.has(fid)) get(fid).value = attr(tag, 'value') || ''; if (attr(tag, 'data-detail') != null) fields.push({ id: fid, dataset: { detail: attr(tag, 'data-detail') } }); });
      (form.match(/<select\b[^>]*>[\s\S]*?<\/select>/g) || []).forEach(sel => { const tag = sel.slice(0, sel.indexOf('>') + 1), fid = attr(tag, 'id'), m = /<option value="([^"]*)" selected>/.exec(sel); if (!inputs.has(fid)) get(fid).value = m ? unesc(m[1]) : ''; if (attr(tag, 'data-role') != null) fields.push({ id: fid, dataset: { role: attr(tag, 'data-role') } }); });
      el.querySelectorAll = sel => fields.filter(f => sel === '[data-detail]' ? f.dataset.detail != null : sel === '[data-role]' ? f.dataset.role != null : false).map(f => ({ dataset: f.dataset, get value() { return els[f.id].value; } }));
      (listeners.submit || []).forEach(fn => fn({ target: el, preventDefault() {} }));
    },
    submit(id) { const el = get(id); (listeners.submit || []).forEach(fn => fn({ target: el, preventDefault() {} })); },
    // inputType as a browser sets it ('insertText', 'insertFromPaste'…); left out, it's plain typing.
    input(id, value, inputType) { const el = get(id); el.value = value; (listeners.input || []).forEach(fn => fn({ target: el, inputType })); },
    // The browser about to change a box (its Edit menu's Undo is 'historyUndo'). Returns whether the app cancelled it.
    beforeinput(id, inputType) { let cancelled = false; (listeners.beforeinput || []).forEach(fn => fn({ target: get(id), inputType, preventDefault() { cancelled = true; } })); return cancelled; },
    // What the screen reader was last told (the #live region).
    live: () => els.live.textContent || '',
    // Any page event the app listens for on the document (compositionstart, focusout…), with the event's own fields.
    fire(type, props) { (listeners[type] || []).forEach(fn => fn(Object.assign({ preventDefault() {} }, props || {}))); },
    // An element stand-in by id, and the document, for tests that need focus or a dialog's controls.
    el: get, doc: document,
    // A control no longer drawn: the page no longer finds it (this stand-in otherwise keeps every node it ever made).
    gone(id) { delete els[id]; inputs.delete(id); },
    // Every typed box not drawn now is gone, as after a new folder's screen replaced the page.
    goneUndrawn() { Object.keys(els).forEach(id => { if (['app', 'top', 'overlay', 'live', 'body'].indexOf(id) < 0 && !onScreen(id) && (els.overlay._html || '').indexOf('id="' + id + '"') < 0) { delete els[id]; inputs.delete(id); } }); },
    asked: () => asked.slice(),
    animations: () => animations.slice(),
    paintAt(t) { paint.t = t; },
    set(id, value) { const el = get(id); el.value = value; el.type = 'text'; inputs.add(id); return this; },
    // Like set(), for an input inside one data-scope element with no other scope opened before it closes (the builder's
    // side form): the app then sees which form it belongs to, as closest() does in a browser.
    setScoped(id, value) { this.set(id, value); get(id).closest = sel => sel === '[data-scope]' ? scopeOf(id) : null; return this; },
    draft(id) { return els[id] ? els[id].value : ''; },
    click(act, id, data) {
      const btn = { dataset: Object.assign({ act, id }, data || {}), disabled: false, classList: { contains: () => false } };
      // As a real click does, the pressed control takes focus first (domFocus).
      if (opts.domFocus) { const q = v => String(v).replace(/"/g, '\\"'), n = drawnAnywhere('[data-act="' + q(act) + '"]' + (id != null ? '[data-id="' + q(id) + '"]' : '')); if (n) document.activeElement = n; }
      (listeners.click || []).forEach(fn => fn({ target: { closest: () => btn }, preventDefault() {} }));
    },
    // A key pressed on an element (a stand-in with dataset and closest), with modifier keys such as { altKey: true }.
    keyOn(k, mods, target) { (listeners.keydown || []).forEach(fn => fn(Object.assign({ key: k, target: target || document.body, preventDefault() {}, metaKey: false, ctrlKey: false, altKey: false }, mods || {}))); },
    key(k) { (listeners.keydown || []).forEach(fn => fn({ key: k, target: document.body, preventDefault() {}, metaKey: false, ctrlKey: false, altKey: false })); },
    selected() { const m = /<li class="step sel[^"]*"[^>]*id="step-([\w-]+)"/.exec(els.app.innerHTML); return m ? m[1] : null; },
    // The step Next up points at: the row marked as the run's place.
    nextStep() { const m = /<li class="step[^"]*\bnext\b[^"]*"[^>]*id="step-([\w-]+)"/.exec(els.app.innerHTML); return m ? m[1] : null; },
    // What the app put into an element as plain text (textContent), never as markup.
    text: id => els[id] ? els[id].textContent : undefined,
    change(id, files) { (listeners.change || []).forEach(fn => fn({ target: { id, files, value: '' } })); },
    select(id, value) { const el = get(id); el.value = value; el._touched = true; (listeners.change || []).forEach(fn => fn({ target: el })); },
    // Turn a checkbox or switch on or off, as a click on it would.
    check(id, on) { const el = get(id); el.type = 'checkbox'; el.checked = !!on; el._touched = true; (listeners.change || []).forEach(fn => fn({ target: el })); },
    // Fire any document event the app listens for (drag and drop, mouseover) with a stand-in event.
    fire(type, ev) { (listeners[type] || []).forEach(fn => fn(Object.assign({ preventDefault() {}, dataTransfer: { setData() {}, effectAllowed: '', dropEffect: '' } }, ev))); },
    choose(personId) { (listeners.change || []).forEach(fn => fn({ target: { id: 'me', value: personId } })); },
    focus() { (winListeners.focus || []).forEach(fn => fn()); },
    // One beat of the app's timers (countdowns, the tab title, refreshes), as a second passing would trigger.
    every() { intervals.forEach(fn => fn()); },
    // The example release in progress (the folder also holds earlier, ended releases).
    run() {
      const k = app._runPath && app.fs.files[app._runPath] ? app._runPath : (app._runPath = Object.keys(app.fs.files).find(p => /^runs\/release\/[^/]+\/run\.json$/.test(p) && JSON.parse(app.fs.files[p].t).title === 'Release 2026.10.16'));
      return { path: k, key: 'release/' + k.split('/')[2], json: JSON.parse(app.fs.files[k].t) }; },
    files(prefix) { return Object.keys(app.fs.files).filter(p => p.indexOf(prefix) === 0); },
    // The browser's Back and Forward (a button, Alt+Left, a mouse button), a jump from the Back menu, and a hash typed or
    // pasted into the address bar. Each lands on a later tick; settle() waits until every one has.
    back() { history.go(-1); }, forward() { history.go(1); }, go(n) { history.go(n); },
    typeHash(h) { traverse({ typed: h }); },
    holdPops() { hist.held = true; }, releasePops() { hist.held = false; pump(); },
    async settle() { for (let i = 0; i < 200 && (hist.queue.length || hist.busy); i++) await tick(2); await tick(); },
    url: () => hist.entries[hist.index].url, hash: () => location.hash,
    entries: () => hist.entries.map(e => ({ hash: hashOf(e.url), state: copyState(e.state) })), index: () => hist.index,
    reloads: () => hist.reloads, popMismatch: () => hist.mismatch, scrollRestoration: () => history.scrollRestoration,
    // Where focus is (domFocus): the focused node's id, or its data-act and data-id, or 'body'.
    activeId() { const a = document.activeElement; if (!a || a === document.body) return 'body'; if (a.id) return a.id; return a.dataset && a.dataset.act ? '[data-act="' + a.dataset.act + '"]' + (a.dataset.id != null ? '[data-id="' + a.dataset.id + '"]' : '') : null; },
    node: sel => drawnAnywhere(sel)
  };
  return app;
}

/* A folder as the browser's File System Access API hands it over, kept in memory: files maps "a/b.txt" to its text. */
function folderHandle(name, files) {
  files = files || {};
  const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
  const dirs = new Set();
  function dir(prefix, dname) {
    const under = (p) => p.startsWith(prefix) && p.length > prefix.length;
    return {
      kind: 'directory', name: dname,
      getDirectoryHandle(n, o) { const p = prefix + n + '/'; if (!(o && o.create) && ![...Object.keys(files), ...dirs].some(x => x.startsWith(p))) return Promise.reject(notFound()); dirs.add(p); return Promise.resolve(dir(p, n)); },
      getFileHandle(n, o) { const p = prefix + n; if (!(p in files)) { if (!(o && o.create)) return Promise.reject(notFound()); files[p] = ''; } return Promise.resolve(file(p, n)); },
      removeEntry(n) { if (!(prefix + n in files)) return Promise.reject(notFound()); delete files[prefix + n]; return Promise.resolve(); },
      values() {
        const names = new Map();
        [...Object.keys(files), ...dirs].filter(under).forEach(p => { const rest = p.slice(prefix.length), i = rest.indexOf('/'); if (rest) names.set(i < 0 ? rest : rest.slice(0, i), i < 0 ? 'file' : 'directory'); });
        const list = [...names].map(([n, kind]) => ({ name: n, kind }));
        return { next: () => Promise.resolve(list.length ? { done: false, value: list.shift() } : { done: true }) };
      },
      queryPermission: () => Promise.resolve('granted'), requestPermission: () => Promise.resolve('granted'),
      isSameEntry: (other) => Promise.resolve(other && other.name === dname)
    };
  }
  function file(p, n) {
    return {
      kind: 'file', name: n,
      // slice() as a File has it: the newer-copy check reads only the head of flightdeck.html.
      getFile: () => Promise.resolve({ size: files[p].length, lastModified: Date.now(), text: () => Promise.resolve(files[p]), slice: (a, b) => new Blob([files[p]]).slice(a, b) }),
      createWritable(o) {
        let buf = o && o.keepExistingData ? files[p] : '';
        return Promise.resolve({ seek: () => Promise.resolve(), write: (d) => Promise.resolve(typeof d === 'string' ? d : d.text()).then(t => { buf += t; }), close: () => { files[p] = buf; return Promise.resolve(); } });
      }
    };
  }
  const root = dir('', name);
  root.files = files;
  return root;
}
/* A stand-in for indexedDB, enough for the app to remember a folder: one database of plain key-value stores. */
function memoryIDB() {
  const data = {};
  const later = (q, v) => { setTimeout(() => { q.result = v; if (q.onsuccess) q.onsuccess(); }, 0); return q; };
  const db = { transaction: () => { const tx = {}; tx.objectStore = () => ({ get: k => later({}, data[k]), put: (v, k) => { data[k] = v; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); } }); return tx; }, createObjectStore() {} };
  return { open: () => later({}, db) };
}

/* A promise you resolve later: pause an async call at an exact point. */
function gate() { let open; const p = new Promise(res => { open = res; }); return { p, open }; }

module.exports = { boot, gate, bus, locks, folderHandle, memoryIDB };
