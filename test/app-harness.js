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
  const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8');
  const script = id => new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>').exec(html)[1];
  const els = {}, listeners = {}, winListeners = {}, store = Object.assign({}, opts.localStore || {}), inputs = new Set();
  const get = id => (els[id] = els[id] || element(id));
  ['app', 'top', 'overlay', 'live'].forEach(get);
  /* Like a real page: a redraw recreates the screen's inputs empty; the app's own code puts back what was typed. */
  const appEl = els.app;
  Object.defineProperty(appEl, 'innerHTML', { get() { return this._html; }, set(v) { this._html = String(v); inputs.forEach(id => { els[id].value = ''; }); } });
  appEl.querySelectorAll = sel => /input|textarea|select/.test(sel) ? [...inputs].map(id => els[id]) : [];
  appEl.contains = el => !!el && inputs.has(el.id);
  const session = opts.sessionStore || {};
  const sessionStorage = { getItem: k => (k in session ? session[k] : null), setItem: (k, v) => { session[k] = String(v); }, removeItem: k => { delete session[k]; } };
  const storage = () => ({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } });
  const document = {
    hidden: false, title: '', body: element('body'), activeElement: null,
    getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: () => element('x'),
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }, contains: () => false
  };
  document.activeElement = document.body;
  const window = {
    innerWidth: 1400, scrollY: 0, scrollTo() {}, matchMedia: () => ({ matches: false }), getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); }
  };
  const ctx = vm.createContext({
    window, document, localStorage: storage(), sessionStorage, navigator: opts.locks ? { locks: opts.locks } : {}, BroadcastChannel: opts.Channel, console, Date: opts.Date || Date, Math, JSON, Promise, Blob, fetch, btoa, Uint8Array,
    setTimeout, clearTimeout, setInterval: () => 0, requestAnimationFrame: fn => setTimeout(fn, 0), URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }
  });
  vm.runInContext(script('pf-core'), ctx);
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
  const tick = (n = 20) => new Promise(res => { let i = 0; (function loop() { if (i++ >= n) return res(); setTimeout(loop, 0); })(); });
  app = {
    PF, store, session, fs: null, tick,
    html: () => els.app.innerHTML,
    top: () => els.top.innerHTML,
    overlay: () => els.overlay.innerHTML,
    submit(id) { const el = get(id); (listeners.submit || []).forEach(fn => fn({ target: el, preventDefault() {} })); },
    input(id, value) { const el = get(id); el.value = value; (listeners.input || []).forEach(fn => fn({ target: el })); },
    set(id, value) { const el = get(id); el.value = value; el.type = 'text'; inputs.add(id); return this; },
    draft(id) { return els[id] ? els[id].value : ''; },
    click(act, id, data) { const btn = { dataset: Object.assign({ act, id }, data || {}), disabled: false, classList: { contains: () => false } }; (listeners.click || []).forEach(fn => fn({ target: { closest: () => btn }, preventDefault() {} })); },
    key(k) { (listeners.keydown || []).forEach(fn => fn({ key: k, target: document.body, preventDefault() {}, metaKey: false, ctrlKey: false, altKey: false })); },
    selected() { const m = /<li class="step sel"[^>]*id="step-([\w-]+)"/.exec(els.app.innerHTML); return m ? m[1] : null; },
    change(id, files) { (listeners.change || []).forEach(fn => fn({ target: { id, files, value: '' } })); },
    select(id, value) { const el = get(id); el.value = value; (listeners.change || []).forEach(fn => fn({ target: el })); },
    choose(personId) { (listeners.change || []).forEach(fn => fn({ target: { id: 'me', value: personId } })); },
    focus() { (winListeners.focus || []).forEach(fn => fn()); },
    // The example release in progress (the folder also holds earlier, ended releases).
    run() {
      const k = app._runPath && app.fs.files[app._runPath] ? app._runPath : (app._runPath = Object.keys(app.fs.files).find(p => /^runs\/release\/[^/]+\/run\.json$/.test(p) && JSON.parse(app.fs.files[p].t).title === 'Release 2026.10.16'));
      return { path: k, key: 'release/' + k.split('/')[2], json: JSON.parse(app.fs.files[k].t) }; },
    files(prefix) { return Object.keys(app.fs.files).filter(p => p.indexOf(prefix) === 0); }
  };
  return app;
}

/* A promise you resolve later: pause an async call at an exact point. */
function gate() { let open; const p = new Promise(res => { open = res; }); return { p, open }; }

module.exports = { boot, gate, bus, locks };
