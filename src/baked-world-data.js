// Start map-specific downloads as soon as map data arrives, alongside HUD and sky construction.
import { generatedWorld } from './generated-world-cache.js';
import { assetMetrics, assetCodecsEnabled, heapBytes } from './asset-metrics.js';
import { decodeMeshoptPack } from './meshopt-pack.js';
import { decodeGeometryPack } from './baked-geometry.js';

function validate(packs, map) {
  for (const p of packs) if (p.metadata.map !== map.id || p.metadata.grid !== map.terrain.GX * map.terrain.GZ) throw new Error('Baked world belongs to a different map');
  if (packs[0].arrays[packs[0].metadata.height].length !== packs[0].metadata.grid || packs[0].arrays[packs[0].metadata.source].length !== packs[0].metadata.grid) throw new Error('Invalid baked height grid');
  // Validate every geometry before installing any state, so fallback never sees half a bake.
  for (const p of packs) for (const m of p.metadata.meshes) {
    for (const a of Object.values(m.attributes)) if (!p.arrays[a.array] || !a.itemSize || p.arrays[a.array].length % a.itemSize) throw new Error('Invalid baked attribute');
    if (m.index != null && !p.arrays[m.index]) throw new Error('Invalid baked index');
  }
  return packs;
}
async function downloadPacks(def, metric, progress) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('World download timed out')), 45000);
  let lastReport = -Infinity;
  try {
    progress('DOWNLOADING TERRAIN + ROADS', .25);
    return await Promise.all((metric.codec === 'meshopt' ? [def.meshopt.terrain, def.meshopt.roads] : [def.terrain, def.roads]).map(async url => {
      const download = async path => { const r = await fetch(path, { signal: controller.signal }); if (!r.ok) throw new Error(`Baked world HTTP ${r.status}`); return r; };
      const body = Array.isArray(url) ? new Blob(await Promise.all(url.map(async part => (await download(part)).arrayBuffer()))).stream() : (await download(url)).body;
      if (def.compression !== 'gzip' || typeof DecompressionStream === 'undefined') throw new Error('Baked compression unsupported');
      const t = performance.now();
      const counted = body.pipeThrough(new TransformStream({ transform(chunk, out) {
        metric.downloadBytes += chunk.byteLength;
        if (performance.now() - lastReport > 150) { lastReport = performance.now(); progress(`DOWNLOADING TERRAIN + ROADS · ${(metric.downloadBytes / 1048576).toFixed(1)} MB`, .25); }
        out.enqueue(chunk);
      } }));
      const buffer = await new Response(counted.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      metric.inflateFetchWallMs += performance.now() - t;
      const decodeStarted = performance.now();
      const pack = metric.codec === 'meshopt' ? await decodeMeshoptPack(buffer) : decodeGeometryPack(buffer);
      metric.bufferDecodeWallMs += performance.now() - decodeStarted;
      metric.decodeWallMs += performance.now() - t; metric.peakHeapBytes = Math.max(metric.peakHeapBytes || 0, heapBytes() || 0) || null;
      return pack;
    }));
  } finally { clearTimeout(timer); controller.abort(); }
}
export async function loadBakedWorldData(map, progress = () => {}) {
  const def = map.data.bakedWorld;
  const query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  if (!def || def.version !== 1 || !map.data.roadNetwork || ['nobake', 'noroadnetwork'].some(key => query.has(key))) return null;
  const metric = assetMetrics.maps[map.id] = { started: performance.now(), downloadBytes: 0, decodeWallMs: 0, inflateFetchWallMs: 0, bufferDecodeWallMs: 0, peakHeapBytes: heapBytes(), codec: assetCodecsEnabled() && def.meshopt && def.meshopt.enabled !== false ? 'meshopt' : 'legacy' };
  const report = (text, fraction) => { metric.phase = text; progress(text, fraction); };
  try {
    let generated = null, packs;
    // Keep existing warm IndexedDB worlds, but never make a cold player run the
    // expensive generators before trying the identical release's prebuilt data.
    try { if (!query.has('bakedownload')) generated = await generatedWorld(map, { cachedOnly: true }); } catch { /* Optional storage. */ }
    const decodeGenerated = buffers => {
      const t = performance.now(), decoded = validate([decodeGeometryPack(buffers.terrain), decodeGeometryPack(buffers.roads)], map);
      metric.codec = 'raw-generated'; metric.decodeWallMs = performance.now() - t; metric.workerTimings = buffers.timings || null;
      return decoded;
    };
    if (generated) {
      try { packs = decodeGenerated(generated); metric.source = 'generated-cache'; } catch { /* A corrupt cache must still try the CDN. */ }
    }
    if (!packs) {
      try { packs = validate(await downloadPacks(def, metric, report), map); metric.source = 'download'; }
      catch (error) {
        metric.downloadError = error.message || 'Invalid baked download';
        report('DOWNLOAD UNAVAILABLE · GENERATING TERRAIN + ROADS', .25);
        const fallback = await generatedWorld(map);
        if (!fallback) throw error;
        packs = decodeGenerated(fallback); metric.source = 'generated-worker';
      }
    }
    report('TERRAIN + ROADS READY', .33);
    metric.loadMs = performance.now() - metric.started; metric.geometryBytes = packs.reduce((sum, p) => sum + p.arrays.reduce((n, a) => n + a.byteLength, 0), 0);
    return { terrain: packs[0], roads: packs[1] };
  } catch (e) { metric.error = e.message; console.warn('Baked world unavailable; generating:', e.message); return null; }
}
