// Start map-specific downloads as soon as map data arrives, alongside HUD and sky construction.
import { generatedWorld, forgetGeneratedWorld } from './generated-world-cache.js';
import { assetMetrics, assetCodecsEnabled, heapBytes } from './asset-metrics.js';
import { decodeMeshoptPack } from './meshopt-pack.js';
import { decodeGeometryPack } from './baked-geometry.js';
import { WorldDownloads, WorldDownloadError, inflateWorldGzip } from './world-download.js';

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
const NO_PROGRESS = () => {};
export async function loadBakedWorldData(map, progress = NO_PROGRESS, { interactive = progress !== NO_PROGRESS, idleMs = 30000 } = {}) {
  const def = map.data.bakedWorld;
  const query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  if (!def || def.version !== 1 || !map.data.roadNetwork || ['nobake', 'noroadnetwork'].some(key => query.has(key))) return null;
  const metric = assetMetrics.maps[map.id] = { started: performance.now(), downloadBytes: 0, decodeWallMs: 0, inflateFetchWallMs: 0, bufferDecodeWallMs: 0, peakHeapBytes: heapBytes(), codec: assetCodecsEnabled() && def.meshopt && def.meshopt.enabled !== false ? 'meshopt' : 'legacy', failures: [] };
  let downloads, lastReport = -Infinity;
  const report = (text, fraction, detail = {}) => {
    metric.phase = text;
    progress(text, fraction, { mapId: map.id, phase: 'download', source: metric.source === 'generated-worker' ? 'worker' : metric.source || 'download', ...downloads?.snapshot(), elapsedMs: performance.now() - metric.started, ...detail });
  };
  const selected = metric.codec === 'meshopt' ? def.meshopt : def;
  downloads = new WorldDownloads({ terrain: selected.terrain, roads: selected.roads }, { assets: def.assets, totals: selected.downloadBytes, idleMs, onProgress(detail) {
    metric.downloadBytes = detail.loadedBytes; metric.responseBytes = detail.responseBytes;
    if (performance.now() - lastReport < 150 && detail.loadedBytes !== detail.totalBytes) return;
    lastReport = performance.now();
    report(`DOWNLOADING TERRAIN + ROADS · ${(detail.loadedBytes / 1048576).toFixed(1)} MB`, .25 + (detail.totalBytes ? .08 * detail.loadedBytes / detail.totalBytes : 0), detail);
  } });
  const decoded = {};
  const decodeGenerated = buffers => {
    const t = performance.now(), packs = validate([decodeGeometryPack(buffers.terrain, { consume: true }), decodeGeometryPack(buffers.roads, { consume: true })], map);
    metric.codec = 'raw-generated'; metric.decodeWallMs = performance.now() - t; metric.workerTimings = buffers.timings || null;
    return packs;
  };
  let generate = false;
  try {
    let cached;
    try { if (!query.has('bakedownload')) cached = await generatedWorld(map, { cachedOnly: true, onProgress: detail => report('READING SAVED TRACK', .25, { ...detail, loadedBytes: 0, totalBytes: null }) }); } catch { /* Optional storage never blocks downloads. */ }
    if (cached) {
      try { const packs = decodeGenerated(cached); metric.source = 'generated-cache'; decoded.terrain = packs[0]; decoded.roads = packs[1]; }
      catch { void forgetGeneratedWorld(map); }
    }
    while (!decoded.terrain || !decoded.roads) {
      try {
        if (generate) {
          metric.source = 'worker';
          report('BUILDING TERRAIN ON THIS DEVICE', .25, { phase: 'generate' });
          const buffers = await generatedWorld(map, { skipCache: true, onProgress: detail => report('BUILDING TRACK ON THIS DEVICE', .25, { phase: 'generate', ...detail }) });
          if (!buffers) throw new WorldDownloadError('generate', 'World worker is unavailable');
          const packs = decodeGenerated(buffers); decoded.terrain = packs[0]; decoded.roads = packs[1]; metric.source = 'generated-worker';
        } else {
          if (def.compression !== 'gzip') throw new WorldDownloadError('invalid', 'Unsupported world compression');
          metric.source = 'download'; report('DOWNLOADING TERRAIN + ROADS', .25);
          await downloads.run();
          for (const kind of ['terrain', 'roads']) {
            if (decoded[kind]) continue;
            try {
              report('UNPACKING ' + kind.toUpperCase(), .32, { phase: 'inflate', asset: kind });
              await new Promise(resolve => setTimeout(resolve, 0));
              const t = performance.now(), buffer = await inflateWorldGzip(downloads.blob(kind));
              metric.inflateFetchWallMs += performance.now() - t;
              report('PREPARING ' + kind.toUpperCase(), .32, { phase: 'decode', asset: kind });
              const decodeStarted = performance.now();
              const pack = metric.codec === 'meshopt' ? await decodeMeshoptPack(buffer) : decodeGeometryPack(buffer, { consume: true });
              // Validate a whole pair before releasing compressed input below.
              decoded[kind] = pack; metric.bufferDecodeWallMs += performance.now() - decodeStarted;
            } catch (error) { downloads.reset(kind); throw new WorldDownloadError('invalid', error.message || 'World data could not be decoded', kind); }
          }
          try { validate([decoded.terrain, decoded.roads], map); }
          catch (error) { for (const kind of ['terrain', 'roads']) { delete decoded[kind]; downloads.reset(kind); } throw new WorldDownloadError('invalid', error.message); }
          metric.decodeWallMs = metric.inflateFetchWallMs + metric.bufferDecodeWallMs;
        }
      } catch (error) {
        const code = generate ? 'generate' : error.code || 'network';
        metric.downloadError = error.message || 'World data unavailable'; metric.error = metric.downloadError;
        metric.failures.push({ code, message: metric.error, asset: error.asset || null, loadedBytes: downloads.snapshot().loadedBytes, at: performance.now() - metric.started });
        if (!interactive) { console.warn('Baked world unavailable:', metric.error); return null; }
        const choice = await new Promise(resolve => {
          let chosen = false;
          const choose = value => { if (!chosen) { chosen = true; resolve(value); } };
          report('TRACK LOAD PAUSED', .25, { phase: 'failed', error: { code, message: metric.error, retryable: true }, retry: () => choose('retry'), fallback: def.worker && typeof Worker !== 'undefined' ? () => choose('generate') : null });
        });
        delete metric.error; generate = choice === 'generate';
      }
    }
    const packs = validate([decoded.terrain, decoded.roads], map);
    report('TERRAIN + ROADS READY', .33, { phase: 'ready', error: null, retry: null, fallback: null });
    for (const kind of ['terrain', 'roads']) downloads.release(kind);
    metric.loadMs = performance.now() - metric.started; metric.geometryBytes = packs.reduce((sum, p) => sum + p.arrays.reduce((n, a) => n + a.byteLength, 0), 0);
    metric.peakHeapBytes = Math.max(metric.peakHeapBytes || 0, heapBytes() || 0) || null;
    return { terrain: packs[0], roads: packs[1] };
  } catch (error) { metric.error = error.message; throw error; }
}
