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
  const intervals = [];
  // Tests start past the first-run welcome unless they ask for it (firstRun).
  const els = {}, listeners = {}, winListeners = {}, store = Object.assign(opts.firstRun ? {} : { 'preflight:look-around': 'true' }, opts.localStore || {}), inputs = new Set();
  const get = id => (els[id] = els[id] || element(id));
  ['app', 'top', 'overlay', 'live', 'tab-badge'].forEach(get);
  /* Like a real page: a redraw recreates the screen's inputs as their markup draws them, and the app's own code puts back what
     was typed. Only the boxes drawn now are on the page; one that isn't keeps its last value, so a test can still read it. */
  const appEl = els.app;
  const drawnValue = (html, id) => {
    const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const at = html.indexOf('id="' + id + '"'); if (at < 0) return null;
    const tag = html.lastIndexOf('<', at), name = html.slice(tag + 1, tag + 9);
    if (/^textarea/.test(name)) { const o = html.indexOf('>', at) + 1; return un(html.slice(o, html.indexOf('</textarea>', o))); }
    if (/^select/.test(name)) { const m = /<option[^>]*value="([^"]*)"[^>]*\sselected/.exec(html.slice(at, html.indexOf('</select>', at))); return m ? un(m[1]) : ''; }
    const m = /\svalue="([^"]*)"/.exec(html.slice(at, html.indexOf('>', at))); return m ? un(m[1]) : '';
  };
  Object.defineProperty(appEl, 'innerHTML', { get() { return this._html; }, set(v) { this._html = String(v); inputs.forEach(id => { const d = drawnValue(this._html, id); if (d !== null) els[id].value = d; }); } });
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
  /* The builder's properties form, as far as the phone sheet needs it: a node under the screen that can be marked. */
  appEl.children = [];
  const formAttrs = {};
  const form = { closest: () => null, contains: () => false, querySelector: () => null, parentNode: appEl, setAttribute(k, v) { formAttrs[k] = v; }, removeAttribute(k) { delete formAttrs[k]; }, hasAttribute: k => k in formAttrs };
  appEl.querySelector = sel => { asked.push(sel); return sel === '.ob-form' && /class="panel stack ob-form"/.test(appEl._html) ? form : null; };
  const session = opts.sessionStore || {};
  const sessionStorage = { getItem: k => (k in session ? session[k] : null), setItem: (k, v) => { session[k] = String(v); }, removeItem: k => { delete session[k]; } };
  // storageThrows: a pattern of keys the browser refuses to read or write (blocked site data, a full quota): those calls throw.
  const refuse = k => { if (opts.storageThrows === true || (opts.storageThrows && opts.storageThrows.test(k))) throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' }); };
  const storage = () => ({ getItem: k => (refuse(k), k in store ? store[k] : null), setItem: (k, v) => { refuse(k); store[k] = String(v); }, removeItem: k => { refuse(k); delete store[k]; } });
  const document = {
    hidden: false, title: '', body: element('body'), activeElement: null,
    getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: () => element('x'),
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }, contains: () => false
  };
  document.activeElement = document.body;
  // The page's root element, for the classes the app puts on it (the editor's page, a separator being dragged).
  const rootClasses = new Set();
  document.documentElement = { classList: { add: (...c) => c.forEach(x => rootClasses.add(x)), remove: (...c) => c.forEach(x => rootClasses.delete(x)), contains: c => rootClasses.has(c) }, setAttribute() {}, removeAttribute() {} };
  const bodyClasses = new Set();
  document.body.classList = { add: (...c) => c.forEach(x => bodyClasses.add(x)), remove: (...c) => c.forEach(x => bodyClasses.delete(x)), contains: c => bodyClasses.has(c) };
  const window = {
    innerWidth: opts.narrow ? 375 : 1400, scrollY: 0, scrollTo() {}, matchMedia: q => ({ matches: !!opts.narrow && /max-width/.test(q) }), getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); }
  };
  // A folder the picker hands over (see folderHandle), for the screens that choose a real folder.
  if (opts.picker) window.showDirectoryPicker = () => Promise.resolve(opts.picker);
  const ctx = vm.createContext({
    window, document, localStorage: storage(), sessionStorage, navigator: opts.locks ? { locks: opts.locks } : {}, BroadcastChannel: opts.Channel, console, Date: opts.Date || Date, Math, JSON, Promise, Blob, fetch, btoa, Uint8Array,
    setTimeout, clearTimeout, setInterval: fn => { intervals.push(fn); return 0; }, requestAnimationFrame: fn => setTimeout(fn, 0), URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    crypto: globalThis.crypto, TextEncoder, indexedDB: opts.indexedDB, IntersectionObserver: opts.IntersectionObserver,
    // An elapsed-time clock the test moves (performance.now()); left out, the app falls back on Date.now().
    performance: opts.performance
  });
  vm.runInContext(script('pf-core'), ctx);
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
    set(id, value) { const el = get(id); el.value = value; el.type = 'text'; inputs.add(id); return this; },
    // Like set(), for an input inside one data-scope element with no other scope opened before it closes (the builder's
    // side form): the app then sees which form it belongs to, as closest() does in a browser.
    setScoped(id, value) { this.set(id, value); get(id).closest = sel => sel === '[data-scope]' ? scopeOf(id) : null; return this; },
    draft(id) { return els[id] ? els[id].value : ''; },
    click(act, id, data) { const btn = { dataset: Object.assign({ act, id }, data || {}), disabled: false, classList: { contains: () => false } }; (listeners.click || []).forEach(fn => fn({ target: { closest: () => btn }, preventDefault() {} })); },
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
    files(prefix) { return Object.keys(app.fs.files).filter(p => p.indexOf(prefix) === 0); }
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
      getFile: () => Promise.resolve({ size: files[p].length, lastModified: Date.now(), text: () => Promise.resolve(files[p]) }),
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
