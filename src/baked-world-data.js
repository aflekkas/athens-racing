// Start map-specific downloads as soon as map data arrives, alongside HUD and sky construction.
import { generatedWorld } from './generated-world-cache.js';
import { assetMetrics, assetCodecsEnabled, heapBytes } from './asset-metrics.js';
import { decodeMeshoptPack } from './meshopt-pack.js';
import { decodeGeometryPack } from './baked-geometry.js';

export async function loadBakedWorldData(map) {
  const def = map.data.bakedWorld;
  if (!def || def.version !== 1 || !map.data.roadNetwork || ['nobake', 'noroadnetwork'].some(key => new URLSearchParams(typeof location === 'undefined' ? '' : location.search).has(key))) return null;
  try {
    const metric = assetMetrics.maps[map.id] = { started: performance.now(), downloadBytes: 0, decodeWallMs: 0, inflateFetchWallMs: 0, bufferDecodeWallMs: 0, peakHeapBytes: heapBytes(), codec: assetCodecsEnabled() && def.meshopt && def.meshopt.enabled !== false ? 'meshopt' : 'legacy' };
    let generated = null;
    try { if (!new URLSearchParams(typeof location === 'undefined' ? '' : location.search).has('bakedownload')) generated = await generatedWorld(map); } catch (e) { console.warn('World worker unavailable; using build buffers:', e.message); }
    const generatedDecodeStarted = performance.now();
    const packs = generated ? [decodeGeometryPack(generated.terrain), decodeGeometryPack(generated.roads)] : await Promise.all((metric.codec === 'meshopt' ? [def.meshopt.terrain, def.meshopt.roads] : [def.terrain, def.roads]).map(async url => {
      const download = async path => { const r = await fetch(path); if (!r.ok) throw new Error(`Baked world HTTP ${r.status}`); return r; };
      const body = Array.isArray(url) ? new Blob(await Promise.all(url.map(async part => (await download(part)).arrayBuffer()))).stream() : (await download(url)).body;
      if (def.compression !== 'gzip' || typeof DecompressionStream === 'undefined') throw new Error('Baked compression unsupported');
      const t = performance.now();
      const counted = body.pipeThrough(new TransformStream({ transform(chunk, controller) { metric.downloadBytes += chunk.byteLength; controller.enqueue(chunk); } }));
      const buffer = await new Response(counted.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      metric.inflateFetchWallMs += performance.now() - t;
      const decodeStarted = performance.now();
      const pack = metric.codec === 'meshopt' ? await decodeMeshoptPack(buffer) : decodeGeometryPack(buffer);
      metric.bufferDecodeWallMs += performance.now() - decodeStarted;
      metric.decodeWallMs += performance.now() - t; metric.peakHeapBytes = Math.max(metric.peakHeapBytes || 0, heapBytes() || 0) || null;
      return pack;
    }));
    if (generated) { metric.codec = 'raw-generated'; metric.decodeWallMs = performance.now() - generatedDecodeStarted; metric.source = 'generated-worker'; metric.workerTimings = generated.timings || null; }
    for (const p of packs) if (p.metadata.map !== map.id || p.metadata.grid !== map.terrain.GX * map.terrain.GZ) throw new Error('Baked world belongs to a different map');
    if (packs[0].arrays[packs[0].metadata.height].length !== packs[0].metadata.grid || packs[0].arrays[packs[0].metadata.source].length !== packs[0].metadata.grid) throw new Error('Invalid baked height grid');
    // Validate every geometry before installing any state, so fallback never sees half a bake.
    for (const p of packs) for (const m of p.metadata.meshes) {
      for (const a of Object.values(m.attributes)) if (!p.arrays[a.array] || !a.itemSize || p.arrays[a.array].length % a.itemSize) throw new Error('Invalid baked attribute');
      if (m.index != null && !p.arrays[m.index]) throw new Error('Invalid baked index');
    }
    metric.loadMs = performance.now() - metric.started; metric.geometryBytes = packs.reduce((sum, p) => sum + p.arrays.reduce((n, a) => n + a.byteLength, 0), 0);
    return { terrain: packs[0], roads: packs[1] };
  } catch (e) { if (assetMetrics.maps[map.id]) assetMetrics.maps[map.id].error = e.message; console.warn('Baked world unavailable; generating:', e.message); return null; }
}
