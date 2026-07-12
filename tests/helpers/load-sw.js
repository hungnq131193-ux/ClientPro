'use strict';

// ============================================================================
// tests/helpers/load-sw.js — nạp sw.js NGUYÊN VĂN vào sandbox node:vm với stub
// `self`/`caches`/`fetch` in-memory để kiểm thử chiến lược cache (A2) mà không
// cần trình duyệt. Cùng pattern với load-security.js.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

// ---- Stub Response/Request tối thiểu cho sw.js -----------------------------
class FakeHeaders {
  constructor(init) {
    this._m = new Map();
    if (init instanceof FakeHeaders) for (const [k, v] of init._m) this._m.set(k, v);
    else if (init && typeof init === 'object') for (const k of Object.keys(init)) this._m.set(k.toLowerCase(), String(init[k]));
  }
  set(k, v) { this._m.set(String(k).toLowerCase(), String(v)); }
  get(k) { const v = this._m.get(String(k).toLowerCase()); return v === undefined ? null : v; }
}

class FakeResponse {
  constructor(body, opts) {
    opts = opts || {};
    this.body = body;
    this.status = opts.status !== undefined ? opts.status : 200;
    this.statusText = opts.statusText || '';
    this.headers = new FakeHeaders(opts.headers);
    this.type = opts.type || 'basic';
  }
  get ok() { return this.status >= 200 && this.status < 300; }
  clone() { return new FakeResponse(this.body, { status: this.status, statusText: this.statusText, headers: this.headers, type: this.type }); }
}

class FakeRequest {
  constructor(url, opts) {
    this.url = String(url);
    this.method = (opts && opts.method) || 'GET';
    this.mode = (opts && opts.mode) || 'cors';
    this.destination = (opts && opts.destination) || '';
  }
}

// ---- In-memory CacheStorage -------------------------------------------------
class FakeCache {
  constructor(storage) { this._m = new Map(); this._storage = storage; }
  static _key(req) { return typeof req === 'string' ? req : req.url; }
  async match(req) { const v = this._m.get(FakeCache._key(req)); return v ? v.clone() : undefined; }
  async put(req, res) { this._m.set(FakeCache._key(req), res.clone ? res.clone() : res); }
  async delete(req) { return this._m.delete(FakeCache._key(req)); }
  async keys() { return [...this._m.keys()].map((u) => new FakeRequest(u)); }
  async addAll(reqs) {
    for (const r of reqs) {
      const res = await this._storage._fetch(r);
      if (!res || !res.ok) throw new Error('addAll failed: ' + FakeCache._key(r));
      await this.put(r, res);
    }
  }
}

class FakeCacheStorage {
  constructor(fetchFn) { this._caches = new Map(); this._fetch = fetchFn || (async () => { throw new Error('no network'); }); }
  async open(name) {
    if (!this._caches.has(name)) this._caches.set(name, new FakeCache(this));
    return this._caches.get(name);
  }
  async keys() { return [...this._caches.keys()]; }
  async delete(name) { return this._caches.delete(name); }
  async match(req) {
    for (const c of this._caches.values()) {
      const hit = await c.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

/**
 * Nạp sw.js. Trả về { ctx, caches, listeners, fetchLog, setNetwork }:
 * - listeners: map event -> handler đã đăng ký qua self.addEventListener
 * - setNetwork(fn): stub fetch; fn(request) -> FakeResponse | throw
 */
function loadSW() {
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

  const listeners = {};
  const fetchLog = [];
  let networkFn = () => { throw new Error('offline'); };

  const cachesStub = new FakeCacheStorage(async (req) => {
    fetchLog.push(typeof req === 'string' ? req : req.url);
    return networkFn(req);
  });

  const self = {
    location: { origin: 'https://app.local' },
    registration: {},
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
    skipWaiting: () => { self.__skipWaitingCalled = true; },
    clients: { claim: async () => {} },
    __skipWaitingCalled: false,
  };

  const ctx = {
    self,
    caches: cachesStub,
    fetch: async (req) => { fetchLog.push(typeof req === 'string' ? req : req.url); return networkFn(req); },
    Request: FakeRequest,
    Response: FakeResponse,
    Headers: FakeHeaders,
    URL,
    console,
    setTimeout,
    clearTimeout,
    Date,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'sw.js' });

  // Trích hằng số cache name từ nguồn để test không hard-code.
  const version = (src.match(/VERSION\s*=\s*'([^']+)'/) || [])[1];
  const names = {};
  for (const key of ['STATIC_CACHE', 'RUNTIME_SAMEORIGIN_CACHE', 'RUNTIME_CDN_CACHE', 'RUNTIME_TILE_CACHE']) {
    const m = src.match(new RegExp(`${key}\\s*=\\s*\`([^\`]+)\``));
    if (m) {
      names[key] = m[1]
        .replace(/\$\{CACHE_EPOCH\}/g, (src.match(/CACHE_EPOCH\s*=\s*'([^']+)'/) || [, ''])[1])
        .replace(/\$\{VERSION\}/g, version);
    }
  }

  return {
    ctx,
    caches: cachesStub,
    listeners,
    fetchLog,
    names,
    version,
    setNetwork: (fn) => { networkFn = fn; },
    Request: FakeRequest,
    Response: FakeResponse,
    // Gọi fetch handler như trình duyệt: trả promise của respondWith.
    dispatchFetch(request) {
      let responded = null;
      const event = {
        request,
        respondWith: (p) => { responded = Promise.resolve(p); },
        waitUntil: () => {},
        preloadResponse: Promise.resolve(undefined),
      };
      listeners.fetch(event);
      return responded; // null nếu SW không intercept
    },
  };
}

module.exports = { loadSW, FakeRequest, FakeResponse };
