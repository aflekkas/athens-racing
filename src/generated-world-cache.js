// One entry per map, versioned by the deterministic build buffers. Old releases cannot reuse a different bake.
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('asr-world-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('maps');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function read(id, version) {
  let db;
  try {
    db = await database();
    const entry = await new Promise((resolve, reject) => {
      const req = db.transaction('maps').objectStore('maps').get(id);
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
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
  } catch { /* Private browsing / storage pressure: generate again next visit. */ } finally { db?.close(); }
}
export async function generatedWorld(map) {
  const def = map.data.bakedWorld;
  if (!def.worker || typeof Worker === 'undefined') return null;
  const version = `${def.terrain}|${def.roads}`;
  const cached = await read(map.id, version);
  if (cached) { if (new URLSearchParams(location.search).has('debug')) console.log('world-cache', map.id, 'hit'); return cached; }
  const buffers = await new Promise((resolve, reject) => {
    const worker = new Worker(def.worker, { type: 'module', name: `world:${map.id}` });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('World generation timed out')); }, 120000);
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = ({ data }) => { if (new URLSearchParams(location.search).has('debug') && data.timings) console.log('world-worker', map.id, JSON.stringify(data.timings)); finish(); data.error ? reject(new Error(data.error)) : resolve(data); };
    worker.onerror = e => { finish(); reject(new Error(e.message || 'World worker failed')); };
    worker.postMessage({ id: map.id });
  });
  // Storage is optional and must not hold up the first drive. Writes complete while shaders/textures warm up.
  void save(map.id, version, buffers);
  if (new URLSearchParams(location.search).has('debug')) console.log('world-cache', map.id, 'generated');
  return buffers;
}
