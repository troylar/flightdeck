/* SHA-256 (FIPS 180-4) in plain JavaScript, incremental: create().update(bytes or text)… .digest() gives lowercase hex.
   Evidence packs hash every file in chunks with it, in the browser and in the command line, so a pack is hashed the same
   way everywhere and hashing can stop between chunks (crypto.subtle can't hash a file a piece at a time). Text is hashed as
   UTF-8. Tests check it against Node's crypto at the padding boundaries and on random chunk splits. */
PF.sha256 = (function () {
  'use strict';
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  /* Text as UTF-8 bytes; a lone surrogate becomes U+FFFD, as TextEncoder does. */
  function utf8(s) {
    s = String(s);
    var out = new Uint8Array(s.length * 3), n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
      }
      if (c >= 0xd800 && c < 0xe000) c = 0xfffd;
      if (c < 0x80) out[n++] = c;
      else if (c < 0x800) { out[n++] = 0xc0 | (c >> 6); out[n++] = 0x80 | (c & 63); }
      else if (c < 0x10000) { out[n++] = 0xe0 | (c >> 12); out[n++] = 0x80 | ((c >> 6) & 63); out[n++] = 0x80 | (c & 63); }
      else { out[n++] = 0xf0 | (c >> 18); out[n++] = 0x80 | ((c >> 12) & 63); out[n++] = 0x80 | ((c >> 6) & 63); out[n++] = 0x80 | (c & 63); }
    }
    return out.subarray(0, n);
  }

  function create() {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Int32Array(64), buf = new Uint8Array(64), have = 0, lo = 0, hi = 0, done = false;
    function block(b, at) {
      var i, t1, t2;
      for (i = 0; i < 16; i++) w[i] = (b[at + 4 * i] << 24) | (b[at + 4 * i + 1] << 16) | (b[at + 4 * i + 2] << 8) | b[at + 4 * i + 3];
      for (i = 16; i < 64; i++) {
        var x = w[i - 15], y = w[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3), s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        t1 = (hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    function update(data) {
      if (done) throw new Error('This digest is already finished.');
      var b = typeof data === 'string' ? utf8(data) : data, n = b.length, i = 0;
      lo += n; if (lo > 0xffffffff) { hi += Math.floor(lo / 0x100000000); lo = lo % 0x100000000; }
      if (have) {
        while (have < 64 && i < n) buf[have++] = b[i++];
        if (have < 64) return api;
        block(buf, 0); have = 0;
      }
      for (; i + 64 <= n; i += 64) block(b, i);
      while (i < n) buf[have++] = b[i++];
      return api;
    }
    function digest() {
      if (done) throw new Error('This digest is already finished.');
      var bitsHi = hi * 8 + Math.floor(lo / 0x20000000), bitsLo = (lo * 8) % 0x100000000;
      buf[have++] = 0x80;
      if (have > 56) { while (have < 64) buf[have++] = 0; block(buf, 0); have = 0; }
      while (have < 56) buf[have++] = 0;
      buf[56] = (bitsHi >>> 24) & 255; buf[57] = (bitsHi >>> 16) & 255; buf[58] = (bitsHi >>> 8) & 255; buf[59] = bitsHi & 255;
      buf[60] = (bitsLo >>> 24) & 255; buf[61] = (bitsLo >>> 16) & 255; buf[62] = (bitsLo >>> 8) & 255; buf[63] = bitsLo & 255;
      block(buf, 0); done = true;
      var out = '';
      for (var j = 0; j < 8; j++) out += ('0000000' + (h[j] >>> 0).toString(16)).slice(-8);
      return out;
    }
    var api = { update: update, digest: digest };
    return api;
  }
  function hex(data) { return create().update(data).digest(); }

  return { create: create, hex: hex, utf8: utf8 };
})();
