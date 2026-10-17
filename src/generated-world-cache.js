// One entry per map, versioned by the deterministic build buffers. Old releases cannot reuse a different bake.
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('asr-world-v1', 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('World storage unavailable')); }, 3000);
    request.onupgradeneeded = () => request.result.createObjectStore('maps');
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
    request.onerror = request.onblocked = () => { expired = true; clearTimeout(timer); reject(request.error || new Error('World storage blocked')); };
  });
}
async function read(id, version) {
  let db;
  try {
    db = await database();
    const entry = await new Promise((resolve, reject) => {
      const tx = db.transaction('maps'), req = tx.objectStore('maps').get(id);
      const timer = setTimeout(() => { try { tx.abort?.(); } catch {} reject(new Error('World cache read timed out')); }, 3000);
      req.onsuccess = () => { clearTimeout(timer); resolve(req.result); }; req.onerror = () => { clearTimeout(timer); reject(req.error); };
    });
    return entry?.version === version ? entry.buffers : null;
  } catch { return null; } finally { db?.close(); }
}
async function save(id, version, buffers) {
  let db;
  try {
    db = await database();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('maps', 'readwrite'); tx.objectStore('maps').put({ version, buffers }, id);
      tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch { return false; /* Private browsing / storage pressure: generate again next visit. */ } finally { db?.close(); }
}
export async function forgetGeneratedWorld(map) {
  try { localStorage.removeItem(`asr-world-version.${map.id}`); } catch {}
  let db; try { db = await database(); db.transaction('maps', 'readwrite').objectStore('maps').delete(map.id); } catch {} finally { db?.close(); }
}
export async function generatedWorld(map, { cachedOnly = false, skipCache = false, onProgress = () => {} } = {}) {
  const def = map.data.bakedWorld;
  if (!def.worker || typeof Worker === 'undefined') return null;
  const version = `${def.terrain}|${def.roads}|${def.worker}`;
  const marker = `asr-world-version.${map.id}`;
  let known = false;
  try { known = localStorage.getItem(marker) === version; } catch {}
  // A cold miss must start synchronously, before main.js blocks on HUD/sky work.
  // The small marker is written only after the IndexedDB transaction commits.
  if (known && !skipCache) onProgress({ phase: 'download', source: 'generated-cache', stage: 'cache' });
  const cached = known && !skipCache ? await read(map.id, version) : null;
  if (cached) { if (new URLSearchParams(location.search).has('debug')) console.log('world-cache', map.id, 'hit'); return cached; }
  // Production already ships these exact buffers. A cache miss must not spend
  // a minute regenerating them before trying the CDN.
  if (cachedOnly) return null;
  const buffers = await new Promise((resolve, reject) => {
    const worker = new Worker(def.worker, { type: 'module', name: `world:${map.id}` });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('World generation timed out')); }, 120000);
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { onProgress(data); return; }
      if (new URLSearchParams(location.search).has('debug') && data.timings) console.log('world-worker', map.id, JSON.stringify(data.timings)); finish(); data.error ? reject(new Error(data.error)) : resolve(data);
    };
    worker.onerror = e => { finish(); reject(new Error(e.message || 'World worker failed')); };
    worker.postMessage({ id: map.id });
  });
  // Storage is optional and must not hold up the first drive. Writes complete while shaders/textures warm up.
  void save(map.id, version, buffers).then(saved => { if (saved) try { localStorage.setItem(marker, version); } catch {} });
  if (new URLSearchParams(location.search).has('debug')) console.log('world-cache', map.id, 'generated');
  return buffers;
}
