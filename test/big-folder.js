// A big team folder in memory, for the perf tests: the synthetic folder from tools/big-folder.js behind the same interface as
// PF.fs, counting every folder call by kind and by top-level part (runs, publications, followups…). Counts, not clocks, are
// what the budgets assert, so they're the same on every computer. Optional latency (ms per call) makes order effects visible.
'use strict';
const { generate } = require('../tools/big-folder');

class CountingFS {
  /* g: what generate() returns. opts.readSize false: read() returns only text and time, as FolderFS did before 1.17. */
  constructor(g, opts) {
    opts = opts || {};
    this.kind = 'memory'; this.name = 'Big synthetic folder'; this.latency = opts.latency || 0; this.readSize = opts.readSize !== false;
    this.files = new Map(); this.dirs = new Map([['', new Map()]]);
    Object.keys(g.files).forEach(p => this._put(p, { t: g.files[p], m: g.mtimes[p] }));
    Object.keys(g.virtual || {}).forEach(p => this._put(p, { size: g.virtual[p], m: g.mtimes[p] }));
    this.reset();
  }
  reset() { this.counts = { list: 0, read: 0, stat: 0, blob: 0 }; this.by = {}; }
  total() { return this.counts.list + this.counts.read + this.counts.stat + this.counts.blob; }
  _count(kind, path) { this.counts[kind]++; const top = String(path).split('/')[0] || '(top)'; const b = this.by[top] = this.by[top] || { list: 0, read: 0, stat: 0, blob: 0 }; b[kind]++; }
  _wait(v) { return this.latency ? new Promise(res => setTimeout(() => res(v), this.latency)) : Promise.resolve(v); }
  _put(p, f) {
    const parts = p.split('/');
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/'), name = parts[i];
      if (!this.dirs.has(dir)) this.dirs.set(dir, new Map());
      this.dirs.get(dir).set(name, i === parts.length - 1 ? 'file' : 'dir');
      if (i < parts.length - 1 && !this.dirs.has(parts.slice(0, i + 1).join('/'))) this.dirs.set(parts.slice(0, i + 1).join('/'), new Map());
    }
    this.files.set(p, f);
  }
  _size(f) { return f.t != null ? Buffer.byteLength(f.t) : f.size; }
  list(path) { this._count('list', path); const d = this.dirs.get(path || ''); return this._wait(d ? [...d].map(([name, kind]) => ({ name, kind })) : []); }
  read(path) {
    this._count('read', path); const f = this.files.get(path);
    if (!f) return this._wait(null);
    const t = f.t != null ? f.t : '\u0000'.repeat(Math.min(f.size, 64));
    return this._wait(this.readSize ? { text: t, mtime: f.m, size: this._size(f) } : { text: t, mtime: f.m });
  }
  stat(path) { this._count('stat', path); const f = this.files.get(path); return this._wait(f ? { size: this._size(f), mtime: f.m } : null); }
  blob(path) { this._count('blob', path); const f = this.files.get(path); return this._wait(f ? new Blob([f.t != null ? f.t : new Uint8Array(Math.min(f.size, 1024))]) : null); }
  write(path, data) { const m = (this.files.get(path) || {}).m; const put = t => this._put(path, { t, m: Math.max(Date.now(), (m || 0) + 1) }); if (typeof data === 'string') { put(data); return Promise.resolve(); } return data.text().then(put); }
  append(path, text) { const f = this.files.get(path); return this.write(path, (f && f.t || '') + text); }
  remove(path) { this.files.delete(path); const i = path.lastIndexOf('/'), d = this.dirs.get(i < 0 ? '' : path.slice(0, i)); if (d) d.delete(path.slice(i + 1)); return Promise.resolve(); }
}

const memo = {};
/* The same generated folder is shared by every test in one process (generating takes a second or two). */
function bigFolder(PF, opts) {
  opts = opts || {};
  const key = JSON.stringify([opts.profile || 'default', opts.runs || 0, opts.seed || 17]);
  const g = memo[key] = memo[key] || generate(PF, opts);
  return new CountingFS(g, opts);
}
module.exports = { CountingFS, bigFolder };
