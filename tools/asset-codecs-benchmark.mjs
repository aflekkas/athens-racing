import { generateMapBake } from './bake-world.mjs';
import { encodeMeshoptPack } from './meshopt-pack.mjs';
import { decodeGeometryPack } from '../src/baked-geometry.js';
import { decodeMeshoptPack } from '../src/meshopt-pack.js';
import { gzipSync, gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { getMap } from '../src/map-catalog.js';
const results = [];
for (const id of ['riviera', 'penteli', 'megara']) {
  const root = resolve(import.meta.dirname, '..');
  let bake;
  if (process.argv.includes('--from-build')) {
    const data = JSON.parse(await readFile(resolve(root, '.deploy/assets', getMap(id).dataUrl), 'utf8'));
    bake = {};
    for (const kind of ['terrain', 'roads']) { const bytes = gunzipSync(await readFile(resolve(root, '.deploy/assets', data.bakedWorld[kind]))); bake[kind] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
  } else bake = await generateMapBake(root, id);
  const result = { id, before: { bytes: 0, decodeMs: 0, decodeCpuMs: 0, decodedBytes: 0 }, after: { bytes: 0, decodeMs: 0, decodeCpuMs: 0, decodedBytes: 0 } };
  for (const kind of ['terrain', 'roads']) {
    const compact = await encodeMeshoptPack(bake[kind]);
    for (const [side, source, decode] of [['before', new Uint8Array(bake[kind]), decodeGeometryPack], ['after', compact, decodeMeshoptPack]]) {
      const compressed = gzipSync(source, { level: 9 });
      result[side].bytes += compressed.length;
      const timings = [], cpuTimings = [];
      for (let i = 0; i < 4; i++) {
        globalThis.gc?.();
        const cpu = process.cpuUsage(), start = performance.now(), inflated = gunzipSync(compressed), buffer = inflated.buffer.slice(inflated.byteOffset, inflated.byteOffset + inflated.byteLength), pack = await decode(buffer);
        timings.push(performance.now() - start); const used = process.cpuUsage(cpu); cpuTimings.push((used.user + used.system) / 1000);
        const mem = process.memoryUsage(); result[side].sampledPeakHeapBytes = Math.max(result[side].sampledPeakHeapBytes || 0, mem.heapUsed); result[side].sampledPeakArrayBufferBytes = Math.max(result[side].sampledPeakArrayBufferBytes || 0, mem.arrayBuffers);
        if (!i) {
          const original = decodeGeometryPack(bake[kind]); assert.deepEqual(pack.arrays, original.arrays);
          result[side].decodedBytes += pack.arrays.reduce((sum, a) => sum + a.byteLength, 0);
        }
      }
      result[side].decodeMs += timings.slice(1).sort((a,b) => a-b)[1];
      result[side].decodeCpuMs += cpuTimings.slice(1).sort((a,b) => a-b)[1];
      result[side].heapAfterDecodeBytes = process.memoryUsage().heapUsed;
    }
  }
  console.log(JSON.stringify(result)); results.push(result);
}
await writeFile(resolve(process.argv.slice(2).find(a => !a.startsWith('--')) || '.scratch/perf-2026-10-15/textures-data/geometry.json'), JSON.stringify(results, null, 2));
