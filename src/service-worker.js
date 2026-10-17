// Offline-fast repeat visits (deploy builds only). tools/prepare-deploy.mjs prepends
//   self.ASR_RELEASE = { build, files: { '/src/main.js': '<sha256-16>', ... }, core: ['/src/', ...] }
// and publishes this file as /sw.js. Every listed file is also published content-addressed at /_c/<hash><ext> with
// `immutable` caching, so this cache is keyed by CONTENT, not by release: a new deploy re-downloads only what changed.
//  - same-origin GETs of listed files: Cache Storage first, else the immutable /_c/ copy from the network
//  - `/` and `/index.html`: network first (always the current release), the last copy when offline
//  - the pinned CDN modules (three.js) and font files: cache first (their URLs are versioned)
//  - everything else (the /ws socket, /api, /auth, /health, music streams, uploads) is never touched
// The page registers it from the deploy-only snippet in index.html; ?nosw unregisters it and clears the caches.
// Release skew: every navigation is checked against this worker's release (<meta name="asr-build"> in the fresh
// index.html). A newer release bypasses the cache (the network has the matching files) until the new worker takes
// over (the page asks for it, src/offline-cache.js: a worker's own update() is rate-limited by Chrome); a page
// without the meta (a rollback to a pre-cache build, or the kill switch) or ?nosw removes this worker.
const RELEASE = self.ASR_RELEASE || { build: 'dev', files: {}, core: [] };
const CONTENT = 'asr-content-v1', PAGES = 'asr-pages-v1', CDN = 'asr-cdn-v1';
const CDN_HOSTS = new Set(['cdn.jsdelivr.net', 'fonts.gstatic.com']);
let bypassUntil = 0; // ms: a newer (or unmanaged) release is loading; its files come from the network meanwhile

const extOf = (path) => { const m = /\.[a-z0-9]+$/i.exec(path); return m ? m[0].toLowerCase() : ''; };
/** the immutable, content-addressed URL path of a listed file (null when not listed) */
function contentPath(path, files = RELEASE.files) {
  const hash = files[path];
  return hash ? `/_c/${hash}${extOf(path)}` : null;
}
/** what the worker does with a request: 'content' | 'page' | 'cdn' | null (leave it to the network) */
function routeOf(method, url, mode, hasRange, scope = self.location.origin, files = RELEASE.files) {
  if (method !== 'GET') return null;
  const u = new URL(url);
  if (u.origin === scope) {
    if (u.pathname === '/' || u.pathname === '/index.html') return mode === 'navigate' ? 'page' : null;
    if (hasRange || !files[u.pathname]) return null;
    return 'content';
  }
  return CDN_HOSTS.has(u.host) ? 'cdn' : null;
}
/** the release of a page: <meta name="asr-build" content="…"> (null: an unmanaged / pre-cache build) */
function releaseOf(html) { return /<meta name="asr-build" content="([^"]+)"/.exec(html)?.[1] || null; }
/** what a navigation means for this worker: 'same' | 'newer' (another release: bypass, update) | 'remove' */
function verdictOf(url, html, build = RELEASE.build) {
  if (new URL(url).searchParams.has('nosw')) return 'remove';
  const page = releaseOf(html);
  return !page ? 'remove' : page === build ? 'same' : 'newer';
}
async function removeSelf() {
  bypassUntil = Infinity;
  for (const name of await caches.keys()) if (name.startsWith('asr-')) await caches.delete(name);
  await self.registration.unregister();
}
async function hex16(buffer) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  let s = ''; for (let i = 0; i < 8; i++) s += d[i].toString(16).padStart(2, '0');
  return s;
}
// A synthesized response has no URL of its own, so a module keeps its request URL as its base (relative imports).
const asOwn = (r) => new Response(r.body, { status: 200, statusText: 'OK', headers: r.headers });
async function optionalStorage(operation) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation).catch(() => null), new Promise(resolve => { timer = setTimeout(() => resolve(null), 300); })]); }
  finally { clearTimeout(timer); }
}

async function fromContent(request, path, event) {
  const key = contentPath(path), reload = ['reload', 'no-store'].includes(request.cache);
  let cache;
  try {
    cache = await optionalStorage(() => caches.open(CONTENT));
    if (cache && !reload) { const hit = await optionalStorage(() => cache.match(key)); if (hit) return asOwn(hit); }
  } catch { /* Storage is optional: a blocked/full cache must never block the network. */ }
  try {
    const res = await fetch(key, { signal: request.signal, ...(reload ? { cache: 'reload' } : {}) });
    if (res.ok) {
      // Return the stream at headers, not after the entire body was cached.
      // Cache writes are best effort and never cause a second download.
      if (cache && request.cache !== 'no-store') {
        const copy = res.clone(), write = Promise.resolve().then(() => cache.put(key, copy)).catch(() => {});
        try { event?.waitUntil(write); } catch { /* The response still streams if event lifetime extension is unavailable. */ }
      }
      return asOwn(res);
    }
  } catch { /* offline: the plain request below fails the same way */ }
  if (request.signal?.aborted) throw request.signal.reason;
  return fetch(request); // e.g. an old worker after a deploy removed its /_c/ copy
}
async function fromPage(request) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(request);
    if (!res.ok) return res;
    // read the release before the page asks for its modules (a few kB of HTML, already in flight)
    const verdict = verdictOf(request.url, await res.clone().text());
    if (verdict === 'remove') await removeSelf();
    else if (verdict === 'newer') bypassUntil = Date.now() + 120000; // the page's update() installs the new worker (src/offline-cache.js)
    else await cache.put('/', res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match('/');
    if (hit) return hit;
    throw e;
  }
}
async function fromCdn(request) {
  const cache = await caches.open(CDN), hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type !== 'opaque') await cache.put(request, res.clone()); // opaque entries cost ~7 MB of quota each
  return res;
}

// Install: copy this release's files into the content cache. Core menu files come from the
// HTTP cache the first page load just filled, or the network; everything else is copied only if the HTTP cache
// already has it. Each copy is verified against its manifest hash, so a stale HTTP entry is never stored.
async function precache() {
  const cache = await caches.open(CONTENT), have = new Set((await cache.keys()).map(r => new URL(r.url).pathname));
  // Map bundles and baked worlds are strictly demand-loaded, even with an older core manifest.
  const todo = Object.keys(RELEASE.files).filter(p => !p.startsWith('/data/') && !have.has(contentPath(p)));
  const isCore = (p) => RELEASE.core.some(prefix => p.startsWith(prefix));
  let next = 0;
  async function lane() {
    while (next < todo.length) {
      const path = todo[next++], key = contentPath(path), core = isCore(path);
      try {
        let res = await fetch(path, core ? { cache: 'force-cache' } : { cache: 'only-if-cached', mode: 'same-origin' });
        let body = res.ok ? await res.arrayBuffer() : null;
        if (body && await hex16(body) !== RELEASE.files[path]) body = null;
        if (!body && core) { res = await fetch(key); body = res.ok ? await res.arrayBuffer() : null; }
        if (body) await cache.put(key, new Response(body, { headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' } }));
      } catch { /* best effort: the fetch handler fills gaps on demand */ }
    }
  }
  await Promise.all(Array.from({ length: 6 }, lane));
}
async function prune() {
  const live = new Set(Object.keys(RELEASE.files).map(p => contentPath(p))), cache = await caches.open(CONTENT);
  for (const r of await cache.keys()) if (!live.has(new URL(r.url).pathname)) await cache.delete(r);
  for (const name of await caches.keys()) if (![CONTENT, PAGES, CDN].includes(name)) await caches.delete(name);
}

if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(precache()); });
  self.addEventListener('activate', (e) => e.waitUntil(prune().then(() => self.clients.claim())));
  self.addEventListener('fetch', (e) => {
    const r = e.request, route = routeOf(r.method, r.url, r.mode, r.headers.has('range'));
    // another release is loading (the network has its files), or this worker removed itself: hands off
    if (route && Date.now() < bypassUntil && (route !== 'page' || bypassUntil === Infinity)) return;
    if (route === 'content') e.respondWith(fromContent(r, new URL(r.url).pathname, e));
    else if (route === 'page') e.respondWith(fromPage(r));
    else if (route === 'cdn') e.respondWith(fromCdn(r));
  });
  self.addEventListener('message', (e) => { if (e.data === 'asr-build') e.source?.postMessage({ build: RELEASE.build }); });
}
// node tests (tools/service-worker.test.mjs) evaluate this file and call these
self.ASR_SW = { contentPath, routeOf, hex16, releaseOf, verdictOf, fromContent };
