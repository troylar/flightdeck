/* File access behind one small interface, so the rest of the app doesn't care where files live.
   FolderFS: a real folder (the OneDrive team folder) through the browser's File System Access API.
   MemoryFS: an in-browser folder for the built-in examples, kept in localStorage. */
PF.fs = (function () {
  'use strict';

  /* Any name a person or OneDrive might give a file ("run-PC (1).json", "run-LAPTOP José.json") is fine. Never: empty parts,
     "." or "..", a backslash, control characters, or leading/trailing spaces. */
  function split(path) {
    var parts = String(path).split('/');
    if (parts.some(function (seg) { return !seg || seg === '.' || seg === '..' || seg.trim() !== seg || /[\\\u0000-\u001f]/.test(seg); })) throw new Error('Bad path: ' + path);
    return parts;
  }

  /* "Not there" is an ordinary answer (null or []); anything else (permissions, a OneDrive placeholder that can't be read) is an error,
     so an unreadable folder never looks like an empty one. */
  function missing(e) { return e && e.name === 'NotFoundError'; }
  function orNull(e) { if (missing(e)) return null; throw e; }

  function FolderFS(dir) { this.dir = dir; this.name = dir.name; this.kind = 'folder'; }
  FolderFS.prototype.walk = function (parts, create) {
    var p = Promise.resolve(this.dir);
    parts.forEach(function (seg) { p = p.then(function (d) { return d.getDirectoryHandle(seg, { create: !!create }); }); });
    return p;
  };
  FolderFS.prototype.list = function (path) {
    var parts = path ? split(path) : [];
    return this.walk(parts).then(function (d) {
      var out = [], it = d.values();
      function next() { return it.next().then(function (x) { if (x.done) return out; out.push({ name: x.value.name, kind: x.value.kind === 'directory' ? 'dir' : 'file' }); return next(); }); }
      return next();
    }, function (e) { if (missing(e)) return []; throw e; });
  };
  FolderFS.prototype.read = function (path) {
    var parts = split(path), file = parts.pop();
    return this.walk(parts).then(function (d) { return d.getFileHandle(file); }).then(function (h) { return h.getFile(); })
      .then(function (f) { return f.text().then(function (t) { return { text: t, mtime: f.lastModified }; }); }, orNull);
  };
  /* Size and time without reading the contents, so unchanged files can be skipped. */
  FolderFS.prototype.stat = function (path) {
    var parts = split(path), file = parts.pop();
    return this.walk(parts).then(function (d) { return d.getFileHandle(file); }).then(function (h) { return h.getFile(); })
      .then(function (f) { return { size: f.size, mtime: f.lastModified }; }, orNull);
  };
  FolderFS.prototype.blob = function (path) {
    var parts = split(path), file = parts.pop();
    return this.walk(parts).then(function (d) { return d.getFileHandle(file); }).then(function (h) { return h.getFile(); }, orNull);
  };
  /* Add to the end of a file this window owns (a notes or history file) without rewriting it. */
  FolderFS.prototype.append = function (path, text) {
    var parts = split(path), file = parts.pop();
    return this.walk(parts, true).then(function (d) { return d.getFileHandle(file, { create: true }); })
      .then(function (h) { return h.getFile().then(function (f) { return h.createWritable({ keepExistingData: true }).then(function (w) { return w.seek(f.size).then(function () { return w.write(text); }).then(function () { return w.close(); }); }); }); });
  };
  FolderFS.prototype.write = function (path, data) {
    var parts = split(path), file = parts.pop();
    return this.walk(parts, true).then(function (d) { return d.getFileHandle(file, { create: true }); })
      .then(function (h) { return h.createWritable(); })
      .then(function (w) { return w.write(data).then(function () { return w.close(); }); });
  };
  FolderFS.prototype.remove = function (path) {
    var parts = split(path), file = parts.pop();
    return this.walk(parts).then(function (d) { return d.removeEntry(file); });
  };
  FolderFS.prototype.url = function (path) {
    var parts = split(path), file = parts.pop();
    return this.walk(parts).then(function (d) { return d.getFileHandle(file); }).then(function (h) { return h.getFile(); })
      .then(function (f) { return /^image\/(png|jpeg|webp|gif)$/.test(f.type) ? URL.createObjectURL(f) : null; }, function () { return null; });
  };

  /* Files are {path: {t: text or data URL, m: mtime}}. */
  function MemoryFS(key, seed) {
    this.key = key; this.kind = 'memory'; this.name = 'Examples (this browser only)';
    var saved = null;
    /* A browser that refuses storage (blocked site data) keeps the examples in this tab only: volatile. */
    var raw = null;
    try { raw = localStorage.getItem(key); } catch (e) { this.volatile = true; }
    try { saved = JSON.parse(raw || 'null'); } catch (e) { saved = null; }
    this.files = saved || {};
    if (!saved && seed) { var self = this; Object.keys(seed).forEach(function (p) { self.files[p] = { t: seed[p], m: Date.now() }; }); this.persist(); }
  }
  MemoryFS.prototype.persist = function () {
    if (this.volatile) return true;
    try { localStorage.setItem(this.key, JSON.stringify(this.files)); return true; }
    catch (e) { if (e && e.name === 'SecurityError') { this.volatile = true; return true; } return false; }
  };
  MemoryFS.prototype.list = function (path) {
    var prefix = path ? path + '/' : '', seen = {}, out = [];
    Object.keys(this.files).forEach(function (p) {
      if (p.indexOf(prefix) !== 0) return;
      var rest = p.slice(prefix.length), i = rest.indexOf('/'), name = i < 0 ? rest : rest.slice(0, i);
      if (!seen[name]) { seen[name] = true; out.push({ name: name, kind: i < 0 ? 'file' : 'dir' }); }
    });
    return Promise.resolve(out);
  };
  MemoryFS.prototype.read = function (path) { var f = this.files[path]; return Promise.resolve(f && !/^data:/.test(f.t) ? { text: f.t, mtime: f.m } : f ? { text: f.t, mtime: f.m } : null); };
  MemoryFS.prototype.write = function (path, data) {
    split(path);
    var self = this;
    function put(t) { self.files[path] = { t: t, m: Date.now() }; if (self.volatile) self.wrote = true; if (!self.persist()) { delete self.files[path]; throw new Error('This browser\'s storage for the examples is full. Reset examples, or use a team folder.'); } }
    if (typeof data === 'string') { try { put(data); } catch (e) { return Promise.reject(e); } return Promise.resolve(); }
    return data.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf), bin = '';
      for (var i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      put('data:' + (data.type || 'application/octet-stream') + ';base64,' + btoa(bin));
    });
  };
  /* Sizes in bytes as a real folder reports them (UTF-8), not in JavaScript characters. */
  function utf8(s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3; } return n; }
  MemoryFS.prototype.stat = function (path) { var f = this.files[path]; return Promise.resolve(f ? { size: utf8(f.t), mtime: f.m } : null); };
  MemoryFS.prototype.append = function (path, text) { var f = this.files[path]; return this.write(path, (f ? f.t : '') + text); };
  MemoryFS.prototype.blob = function (path) {
    var f = this.files[path];
    if (!f) return Promise.resolve(null);
    if (/^data:/.test(f.t)) return fetch(f.t).then(function (r) { return r.blob(); });
    return Promise.resolve(new Blob([f.t]));
  };
  MemoryFS.prototype.remove = function (path) { delete this.files[path]; this.persist(); return Promise.resolve(); };
  MemoryFS.prototype.url = function (path) { var f = this.files[path]; return Promise.resolve(f && /^data:image\/(png|jpeg|webp|gif);base64,/.test(f.t) ? f.t : null); };
  MemoryFS.prototype.reset = function (seed) { this.files = {}; var self = this; Object.keys(seed || {}).forEach(function (p) { self.files[p] = { t: seed[p], m: Date.now() }; }); this.persist(); };

  return { FolderFS: FolderFS, MemoryFS: MemoryFS };
})();
