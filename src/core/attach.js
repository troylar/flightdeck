/* Files attached to notes and suggested fixes: which ones are allowed, the name each gets in the run's files/ folder, and how
   each is shown. Images show as pictures; text files open as plain text; anything else is a file to save. Nothing attached is
   ever shown as a web page or an SVG. */
PF.attach = (function () {
  'use strict';
  var MAX = 10 * 1024 * 1024, PER_NOTE = 10, PREVIEW_MAX = 256 * 1024;
  /* Extension -> how it's shown, and the MIME types a browser may report for it. Text kinds also accept no type at all, since
     browsers often give none for .log, .md or .yaml. */
  var TYPES = {
    png: { kind: 'image', mime: 'image/png', also: [] },
    jpg: { kind: 'image', mime: 'image/jpeg', also: ['image/jpg', 'image/pjpeg'] },
    webp: { kind: 'image', mime: 'image/webp', also: [] },
    gif: { kind: 'image', mime: 'image/gif', also: [] },
    pdf: { kind: 'file', mime: 'application/pdf', also: ['application/x-pdf'] },
    zip: { kind: 'file', mime: 'application/zip', also: ['application/x-zip-compressed', 'application/x-zip', 'multipart/x-zip'] },
    txt: { kind: 'text', mime: 'text/plain', also: [] },
    log: { kind: 'text', mime: 'text/plain', also: ['text/x-log'] },
    md: { kind: 'text', mime: 'text/markdown', also: ['text/x-markdown', 'text/plain'] },
    csv: { kind: 'text', mime: 'text/csv', also: ['text/plain', 'application/vnd.ms-excel', 'text/x-csv'] },
    json: { kind: 'text', mime: 'application/json', also: ['text/json', 'text/plain'] },
    yaml: { kind: 'text', mime: 'application/yaml', also: ['application/x-yaml', 'text/yaml', 'text/x-yaml', 'text/plain'] }
  };
  var ALIAS = { jpeg: 'jpg', yml: 'yaml', text: 'txt', markdown: 'md' };
  var ALLOWED = 'PNG, JPEG, WebP or GIF images, PDF, text (.txt, .log, .md, .csv, .json, .yaml) and .zip files';
  /* What the file picker offers: the same list. */
  var ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.pdf,.zip,.txt,.log,.md,.csv,.json,.yaml,.yml,image/png,image/jpeg,image/webp,image/gif,application/pdf,application/zip,text/plain';
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function extOf(name) {
    var base = String(name || '').split(/[\\/]/).pop(), i = base.lastIndexOf('.');
    if (i <= 0) return '';
    var e = base.slice(i + 1).toLowerCase();
    return own(ALIAS, e) ? ALIAS[e] : e;
  }
  function extForMime(mime) { var k = Object.keys(TYPES).filter(function (e) { return TYPES[e].kind !== 'text' && (TYPES[e].mime === mime || TYPES[e].also.indexOf(mime) >= 0); })[0]; return k || ''; }
  function size(n) {
    n = +n || 0;
    if (n < 1024) return n + ' bytes';
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (Math.round(n / 1024 / 1024 * 10) / 10) + ' MB';
  }
  /* A name safe to put in a path and on screen: letters, digits, dots, dashes and underscores; never a path, never hidden. */
  function safeName(name, ext) {
    var base = String(name || '').split(/[\\/]/).pop(), i = base.lastIndexOf('.'), stem = i > 0 ? base.slice(0, i) : base;
    stem = stem.normalize ? stem.normalize('NFKD').replace(/[̀-ͯ]/g, '') : stem;
    /* Runs of dots collapse to one, so a saved name always passes pathOk (which refuses ".."). */
    stem = stem.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/\.{2,}/g, '.').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60).replace(/[-.]+$/g, '');
    return (stem || 'file') + '.' + ext;
  }
  /* Whether a file can be attached. Returns { ext, kind, mime, name, size } or { error } in plain words. */
  function check(name, type, bytes) {
    var shown = String(name || '').split(/[\\/]/).pop().slice(0, 80), mime = String(type || '').toLowerCase().split(';')[0].trim();
    var ext = extOf(name);
    if (!ext && mime) ext = extForMime(mime);
    var t = own(TYPES, ext) ? TYPES[ext] : null;
    var label = shown ? '"' + shown + '"' : 'That file';
    if (!t) return { error: label + ' can\'t be attached. Flightdeck attaches ' + ALLOWED + '.' };
    if (mime && mime !== t.mime && t.also.indexOf(mime) < 0) return { error: label + ' says it\'s a .' + ext + ' file, but it\'s ' + mime + '. Flightdeck attaches ' + ALLOWED + '.' };
    if (!mime && t.kind !== 'text') return { error: label + ' has no file type. Save it again as a .' + ext + ' file and attach that.' };
    if (!(+bytes > 0)) return { error: label + ' is empty.' };
    if (+bytes > MAX) return { error: label + ' is ' + size(bytes) + '. Attachments can be up to 10 MB each.' };
    return { ext: ext, kind: t.kind, mime: t.mime, name: safeName(name || 'file', ext), size: +bytes };
  }
  /* The first bytes of a file agree with what it says it is: an image is that image, a PDF starts like one, a .zip is a zip,
     and a text file has no zero bytes. */
  function sniff(head, ext) {
    var b = head || [], at = function (i, s) { for (var k = 0; k < s.length; k++) if (b[i + k] !== s[k]) return false; return true; };
    if (ext === 'png') return at(0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    if (ext === 'jpg') return at(0, [0xFF, 0xD8, 0xFF]);
    if (ext === 'gif') return at(0, [0x47, 0x49, 0x46, 0x38]);
    if (ext === 'webp') return at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]);
    if (ext === 'pdf') return at(0, [0x25, 0x50, 0x44, 0x46]);
    if (ext === 'zip') return at(0, [0x50, 0x4B, 0x03, 0x04]) || at(0, [0x50, 0x4B, 0x05, 0x06]);
    if (own(TYPES, ext) && TYPES[ext].kind === 'text') { for (var i = 0; i < b.length; i++) if (b[i] === 0) return false; return true; }
    return false;
  }
  /* Where an attachment goes: the run's files/ folder, named so two windows never collide, ending in the person's own
     (cleaned) file name. */
  function pathFor(base, now, rand, writer, name) { return base + 'files/' + now + '-' + rand + '-' + writer + '-' + name; }
  /* The one rule for a path a note may list: inside this run's files/ folder, only the characters safeName and pathFor
     produce, and never "..". Older copies apply the same characters, so they keep these paths too. */
  function pathOk(path, base) { return typeof path === 'string' && path.indexOf(base + 'files/') === 0 && /^[\w.@\/-]+$/.test(path) && path.indexOf('..') < 0; }
  /* How a saved attachment is shown, from its extension: image, text or file; null for anything else. */
  function kindOf(path) { var e = extOf(path); return own(TYPES, e) ? TYPES[e].kind : null; }
  /* The name to show: the one recorded with the note, else the person's name kept in the path, else a plain word. */
  function nameOf(path, info) {
    if (info && typeof info.name === 'string' && info.name) return info.name;
    var leaf = String(path || '').split('/').pop(), m = /^\d+-[a-z0-9]+-[\w]+-(.+)$/i.exec(leaf);
    if (m) return m[1];
    var k = kindOf(path);
    return (k === 'image' ? 'Screenshot' : 'Attachment') + '.' + (extOf(path) || 'file');
  }
  /* Details recorded with a note's files, read from a file anyone can edit: only for files the note keeps, short names, sizes as numbers. */
  function cleanInfo(o, files) {
    var out = {};
    if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
    (files || []).forEach(function (f) {
      var x = own(o, f) ? o[f] : null;
      if (!x || typeof x !== 'object') return;
      var c = {};
      if (typeof x.name === 'string' && x.name) c.name = safeName(x.name, extOf(x.name) || extOf(f) || 'file');
      if (typeof x.size === 'number' && isFinite(x.size) && x.size >= 0) c.size = Math.min(Math.floor(x.size), MAX * 10);
      if (Object.keys(c).length) out[f] = c;
    });
    return out;
  }
  return { MAX: MAX, PER_NOTE: PER_NOTE, PREVIEW_MAX: PREVIEW_MAX, ACCEPT: ACCEPT, ALLOWED: ALLOWED, check: check, sniff: sniff, safeName: safeName, pathFor: pathFor, pathOk: pathOk, kindOf: kindOf, nameOf: nameOf, extOf: extOf, size: size, cleanInfo: cleanInfo };
})();
