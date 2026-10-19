/* ZIP files written in plain JavaScript, for evidence packs: STORE only (no compression, so every original is in the pack
   byte for byte), CRC-32, UTF-8 names (flag bit 11), and no Zip64, so limits follow PKWARE's APPNOTE for classic ZIP:
   at most 65,535 entries, and every size and offset below 2^32 - 1 (the value 0xFFFFFFFF means "see Zip64"). Names are
   relative, never "..", never start with "/", never hold "\" or a drive letter, are at most 512 UTF-8 bytes (the format
   allows 65,535), and are unique even ignoring letter case, so a pack unpacks the same on Windows. plan() checks a list of
   sizes without building anything (tests use sizes no test could allocate); writer() counts every byte it writes and stops
   at a limit or a byte cap. */
PF.zip = (function () {
  'use strict';
  var MAX = 0xFFFFFFFE, LIMITS = { entries: 65535, max: MAX, name: 512 };
  var LOCAL = 30, CENTRAL = 46, END = 22;

  var TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return typeof Int32Array === 'function' ? new Int32Array(t) : t;
  })();
  /* CRC-32 (ISO 3309), incremental: crc32(more, crc32(first)). */
  function crc32(u8, prev) {
    var c = (prev == null ? 0 : prev) ^ -1;
    for (var i = 0, n = u8.length; i < n; i++) c = TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }
  function bytesOf(name) { return PF.sha256.utf8(name); }
  function mb(n) { var x = n / 1048576; return (x % 1 === 0 ? x : x.toFixed(1)) + ' MB'; }

  /* Why a name can't go in a pack, or ''. */
  function checkName(name) {
    if (typeof name !== 'string' || !name) return 'A file in the pack has no name.';
    if (/[\u0000-\u001f\u007f]/.test(name)) return '"' + name + '" has a control character in its name.';
    if (name.indexOf('\\') >= 0) return '"' + name + '" has a backslash in its name.';
    if (name[0] === '/') return '"' + name + '" starts with "/".';
    if (/^[A-Za-z]:/.test(name)) return '"' + name + '" starts with a drive letter.';
    var parts = name.split('/');
    for (var i = 0; i < parts.length; i++) if (!parts[i] || parts[i] === '.' || parts[i] === '..') return '"' + name + '" isn\'t a plain relative path.';
    if (bytesOf(name).length > LIMITS.name) return '"' + name.slice(0, 60) + '…" is longer than ' + LIMITS.name + ' bytes.';
    return '';
  }
  function fold(name) { return (name.normalize ? name.normalize('NFC') : name).toLowerCase(); }
  /* Names that can't go in a pack: bad ones, and every repeat, exact or differing only in letter case. */
  function checkNames(names) {
    var out = [], exact = Object.create(null), loose = Object.create(null);
    names.forEach(function (n) {
      var why = checkName(n);
      if (!why && exact[n]) why = '"' + n + '" is in the pack twice.';
      else if (!why && loose[fold(n)]) why = '"' + n + '" and "' + loose[fold(n)] + '" differ only in letter case, so they can\'t both unpack on Windows.';
      if (why) out.push({ name: n, why: why });
      exact[n] = true; if (!loose[fold(n)]) loose[fold(n)] = n;
    });
    return out;
  }

  /* What a pack of these entries ({name, size}) takes, checked against the format's limits and opts.cap, without building it. */
  function plan(entries, opts) {
    opts = opts || {};
    if (entries.length > LIMITS.entries) return { ok: false, why: 'A pack can hold at most 65,535 files; this one would have ' + entries.length + '.' };
    var bad = checkNames(entries.map(function (e) { return e.name; }));
    if (bad.length) return { ok: false, why: bad[0].why };
    var off = 0, cd = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i], n = bytesOf(e.name).length;
      if (!(e.size >= 0) || e.size > MAX) return { ok: false, why: e.name + ' is 4 GB or more, which a pack without Zip64 can\'t hold.' };
      if (off > MAX) return { ok: false, why: 'The file ' + e.name + ' would start past 4 GB, which a pack without Zip64 can\'t hold.' };
      off += LOCAL + n + e.size; cd += CENTRAL + n;
    }
    var total = off + cd + END;
    if (off > MAX || cd > MAX || total > MAX) return { ok: false, why: 'The pack would end past 4 GB, which a pack without Zip64 can\'t hold.', bytes: total };
    if (opts.cap && total > opts.cap) return { ok: false, why: 'The pack would be about ' + mb(total) + ', over the ' + mb(opts.cap) + ' limit here.', bytes: total };
    return { ok: true, bytes: total };
  }

  function u16(a, at, v) { a[at] = v & 255; a[at + 1] = (v >>> 8) & 255; }
  function u32(a, at, v) { a[at] = v & 255; a[at + 1] = (v >>> 8) & 255; a[at + 2] = (v >>> 16) & 255; a[at + 3] = (v >>> 24) & 255; }
  function dos(d) {
    d = d || new Date(1980, 0, 1);
    var y = Math.max(1980, Math.min(2107, d.getFullYear()));
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }
  function failure(msg, changed) { var e = new Error(msg); if (changed) e.changed = true; return e; }

  /* A pack written as it goes: begin(name, size, crc), data(bytes)…, end(); add(name, bytes) for a whole file; finish().
     opts.sink(bytes) takes each piece (it may return a promise); opts.cap is a byte limit; opts.date stamps every entry.
     Every piece passes checked counters: a file whose bytes don't match the size and CRC it was declared with "changed
     while it was packed" (e.changed), and nothing goes past a limit. Each call returns a promise. */
  function writer(opts) {
    var off = 0, entries = [], exact = Object.create(null), loose = Object.create(null), cur = null, stamp = dos(opts.date), closed = false;
    var cap = opts.cap || 0;
    function emit(u8) { off += u8.length; return Promise.resolve(opts.sink(u8)); }
    function fits(more) { return off + more <= MAX && (!cap || off + more <= cap); }
    function limit() { return failure(cap && off <= MAX ? 'The pack would go past its ' + mb(cap) + ' limit here.' : 'The pack would go past 4 GB, which a pack without Zip64 can\'t hold.'); }
    function begin(name, size, crc) {
      try {
        if (closed || cur) throw failure('The pack isn\'t ready for another file.');
        var why = checkName(name);
        if (!why && exact[name]) why = '"' + name + '" is in the pack twice.';
        if (!why && loose[fold(name)]) why = '"' + name + '" and "' + loose[fold(name)] + '" differ only in letter case, so they can\'t both unpack on Windows.';
        if (why) throw failure(why);
        if (entries.length >= LIMITS.entries) throw failure('A pack can hold at most 65,535 files.');
        if (!(size >= 0) || size > MAX) throw failure(name + ' is 4 GB or more, which a pack without Zip64 can\'t hold.');
        if (off > MAX) throw limit();
        var nb = bytesOf(name), cdSoFar = entries.reduce(function (s, e) { return s + CENTRAL + e.nb.length; }, 0);
        if (!fits(LOCAL + nb.length + size + cdSoFar + CENTRAL + nb.length + END)) throw limit();
        exact[name] = true; loose[fold(name)] = name;
        var h = new Uint8Array(LOCAL + nb.length);
        u32(h, 0, 0x04034b50); u16(h, 4, 20); u16(h, 6, 0x0800); u16(h, 8, 0); u16(h, 10, stamp.time); u16(h, 12, stamp.date);
        u32(h, 14, crc >>> 0); u32(h, 18, size); u32(h, 22, size); u16(h, 26, nb.length); u16(h, 28, 0); h.set(nb, LOCAL);
        cur = { name: name, nb: nb, size: size, crc: crc >>> 0, at: off, got: 0, c: 0 };
        return emit(h);
      } catch (e) { return Promise.reject(e); }
    }
    function data(u8) {
      if (!cur) return Promise.reject(failure('No file is open in the pack.'));
      cur.got += u8.length;
      if (cur.got > cur.size) return Promise.reject(failure(cur.name + ' changed while it was packed: it grew.', true));
      cur.c = crc32(u8, cur.c);
      return emit(u8);
    }
    function end() {
      if (!cur) return Promise.reject(failure('No file is open in the pack.'));
      var e = cur; cur = null;
      if (e.got !== e.size || e.c !== e.crc) return Promise.reject(failure(e.name + ' changed while it was packed.', true));
      entries.push(e);
      return Promise.resolve();
    }
    function add(name, u8) { return begin(name, u8.length, crc32(u8)).then(function () { return data(u8); }).then(end); }
    function finish() {
      try {
        if (cur || closed) throw failure('The pack isn\'t ready to finish.');
        closed = true;
        var cdAt = off, size = entries.reduce(function (s, e) { return s + CENTRAL + e.nb.length; }, 0);
        if (cdAt > MAX || size > MAX || !fits(size + END)) throw limit();
        var cd = new Uint8Array(size + END), p = 0;
        entries.forEach(function (e) {
          u32(cd, p, 0x02014b50); u16(cd, p + 4, 20); u16(cd, p + 6, 20); u16(cd, p + 8, 0x0800); u16(cd, p + 10, 0); u16(cd, p + 12, stamp.time); u16(cd, p + 14, stamp.date);
          u32(cd, p + 16, e.crc); u32(cd, p + 20, e.size); u32(cd, p + 24, e.size); u16(cd, p + 28, e.nb.length); u16(cd, p + 30, 0); u16(cd, p + 32, 0);
          u16(cd, p + 34, 0); u16(cd, p + 36, 0); u32(cd, p + 38, 0); u32(cd, p + 42, e.at); cd.set(e.nb, p + CENTRAL);
          p += CENTRAL + e.nb.length;
        });
        u32(cd, p, 0x06054b50); u16(cd, p + 4, 0); u16(cd, p + 6, 0); u16(cd, p + 8, entries.length); u16(cd, p + 10, entries.length);
        u32(cd, p + 12, size); u32(cd, p + 16, cdAt); u16(cd, p + 20, 0);
        return emit(cd).then(function () { return off; });
      } catch (e) { return Promise.reject(e); }
    }
    return { begin: begin, data: data, end: end, add: add, finish: finish, bytes: function () { return off; } };
  }

  return { LIMITS: LIMITS, HEADER: { local: LOCAL, central: CENTRAL, end: END }, crc32: crc32, checkName: checkName, checkNames: checkNames, plan: plan, writer: writer };
})();
