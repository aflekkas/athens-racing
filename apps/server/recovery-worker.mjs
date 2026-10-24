import { parentPort, workerData } from 'node:worker_threads';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readEmittedRouteWorld } from '../../tools/emitted-route-world.mjs';
import { proveRecoveryCell, recoveryNeighborhood, admitRecoveryCell, paretoFootprints } from '../../tools/build-world-recovery.mjs';
import { encodeRecoverySidecar } from '../../server/route-road-wire.mjs';
import { canonicalJSON, sha256 } from '../../src/route-definition.js';
import { accelerateRecoveryWorld } from './recovery-spatial-index.mjs';

const manifest = JSON.parse(await readFile(workerData.world, 'utf8'));
parentPort.on('message', async key => {
  let sample;
  try {
    const keys = recoveryNeighborhood(key, manifest);
    sample = await readEmittedRouteWorld({ world: workerData.world, cells: workerData.cells, keys });
    for (const neighbour of keys) if (!sample.tiles.has(neighbour)) throw Error('Incomplete recovery neighborhood: ' + key + ' missing ' + neighbour);
    accelerateRecoveryWorld(sample);
    const body = proveRecoveryCell(key, sample, workerData.profiles);
    if (!body) { parentPort.postMessage({ key, descriptor: { sourceHash: manifest.tiles[key].sha256, empty: true }, anchorCount: 0, bytes: 0, footprints: [] }); return; }
    const parts = []; let totalBytes = 0, maxSidecarBytes = 0, maxDecodedBytes = 0;
    const save = async anchors => {
      const portion = { ...body, anchors };
      let packed = encodeRecoverySidecar(portion), text = canonicalJSON(packed), hash = await sha256(packed), metrics;
      try { metrics = await admitRecoveryCell(Buffer.from(text), { key, manifest, hash }); }
      catch (error) {
        if (!/memory budget|artifact budget|cache budget|exceeds 2 MiB/.test(error.message)) throw error;
        packed = encodeRecoverySidecar(portion, { dictionary: true }); text = canonicalJSON(packed); hash = await sha256(packed);
        try { metrics = await admitRecoveryCell(Buffer.from(text), { key, manifest, hash }); }
        catch (failure) {
          if (!/memory budget|artifact budget|cache budget|exceeds 2 MiB/.test(failure.message) || anchors.length < 2 || parts.length >= 63) throw failure;
          const middle = Math.floor(anchors.length / 2); await save(anchors.slice(0, middle)); await save(anchors.slice(middle)); return;
        }
      }
      if (parts.length >= 64) throw Error('Recovery cell exceeds 64 bounded parts: ' + key);
      const name = `${key}.${hash}.json`; await writeFile(resolve(workerData.out, name), text);
      parts.push(hash); totalBytes += Buffer.byteLength(text); maxSidecarBytes = Math.max(maxSidecarBytes, Buffer.byteLength(text)); maxDecodedBytes = Math.max(maxDecodedBytes, metrics.decodedBytes);
    };
    await save(body.anchors);
    const descriptor = parts.length === 1 ? { sourceHash: manifest.tiles[key].sha256, hash: parts[0], url: `/world/recovery/${key}.${parts[0]}.json` } : { sourceHash: manifest.tiles[key].sha256, parts };
    parentPort.postMessage({ key, descriptor, anchorCount: body.anchors.length, bytes: totalBytes, maxSidecarBytes, decodedBytes: maxDecodedBytes, footprints: paretoFootprints(body.anchors.flatMap(anchor => anchor.footprints)) });
  } catch (error) { parentPort.postMessage({ key, error: error.stack }); }
  finally { sample?.roads.graph.dispose(); sample?.tiles.clear(); }
});
