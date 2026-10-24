import { encodeRecoveryManifest } from '../../server/recovery-manifest-wire.mjs';
import { Worker } from 'node:worker_threads';
import { readFile, writeFile, mkdir, lstat, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import { garageFootprints } from '../../tools/build-online-grids.mjs';
import { recoveryWorldRegistry, assertRecoveryCoverage, paretoFootprints, MAX_RECOVERY_BYTES, admitRecoveryCell } from '../../tools/build-world-recovery.mjs';
import { authenticateCheckpoint, checkpointSignature } from './proof-checkpoint.mjs';
import { canonicalJSON, sha256 } from '../../src/route-definition.js';

// Parallelism affects proof generation time only. Every worker calls the same
// four-metre sampler and exact request-time admission as the serial builder.
export async function buildParallelRecovery({ world, cells, out, concurrency = 4, checkpoint = null, onCell = () => {} }) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw Error('Recovery proof pool is limited to four workers.');
  const manifest = JSON.parse(await readFile(world, 'utf8')), recoveryWorld = recoveryWorldRegistry(manifest), profiles = await garageFootprints();
  await mkdir(out, { recursive: true });
  const keys = recoveryWorld.sourceHashes.map(([key]) => key), results = new Map(), workers = [];
  let next = 0, totalBytes = 0, anchorCount = 0, partCount = 0, multipartCells = 0, maxSidecarBytes = 0, maxDecodedBytes = 0, admittedCells = 0;
  const accept = result => {
    results.set(result.key, result); totalBytes += result.bytes; anchorCount += result.anchorCount;
    maxSidecarBytes = Math.max(maxSidecarBytes, result.maxSidecarBytes || result.bytes); maxDecodedBytes = Math.max(maxDecodedBytes, result.decodedBytes || 0);
    if (!result.descriptor.empty) { admittedCells++; const count = result.descriptor.parts?.length || 1; partCount += count; if (count > 1) multipartCells++; }
    onCell({ key: result.key, hash: result.descriptor.hash, cells: results.size, total: keys.length, totalBytes, anchorCount, partCount, multipartCells, cached: result.cached === true });
  };
  if (checkpoint) {
    for (const key of keys) {
      const path = resolve(checkpoint.records, key + '.json'); let record;
      try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024) throw Error('Invalid physical proof checkpoint file.'); record = JSON.parse(await readFile(path, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const result = authenticateCheckpoint(record, checkpoint.key, checkpoint.binding);
      await validateCheckpointArtifacts(result, { key, manifest, out });
      accept({ ...result, cached: true });
    }
  }
  const workKeys = keys.filter(key => !results.has(key));
  try {
    if (workKeys.length) await new Promise((resolveDone, reject) => {
      let failed = false;
      const fail = error => { if (!failed) { failed = true; reject(error); } };
      const dispatch = worker => { if (!failed && next < workKeys.length) worker.postMessage(workKeys[next++]); };
      for (let i = 0; i < Math.min(concurrency, availableParallelism(), workKeys.length); i++) {
        const worker = new Worker(new URL('./recovery-worker.mjs', import.meta.url), { workerData: { world, cells, out, profiles }, resourceLimits: { maxOldGenerationSizeMb: 768, maxYoungGenerationSizeMb: 64 } });
        workers.push(worker);
        worker.on('error', fail);
        worker.on('exit', code => { if (code && !failed && results.size < keys.length) fail(Error('Recovery worker exited: ' + code)); });
        worker.on('message', async result => {
          if (failed) return;
          try {
            if (result.error) throw Error('Recovery cell ' + result.key + ': ' + result.error);
            if (!keys.includes(result.key) || results.has(result.key)) throw Error('Recovery worker returned duplicate or unknown cell.');
            if (checkpoint) {
              const path = resolve(checkpoint.records, result.key + '.json'), temporary = path + '.tmp';
              await writeFile(temporary, JSON.stringify({ result, signature: checkpointSignature(checkpoint.key, checkpoint.binding, result) }), { mode: 0o600 }); await rename(temporary, path);
            }
            accept(result);
            if (results.size === keys.length) resolveDone(); else dispatch(worker);
          } catch (error) { fail(error); }
        });
        dispatch(worker);
      }
    });
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
  const root = encodeRecoveryManifest({ schemaVersion: 1, worldId: 'athens', projectionId: 'athens-v1', worldSetRevision: manifest.revision, footprints: paretoFootprints([...results.values()].flatMap(result => result.footprints)), cells: Object.fromEntries(keys.map(key => [key, results.get(key).descriptor])) });
  if (!root.footprints.length) throw Error('World has no certified recovery vehicle');
  assertRecoveryCoverage(root, recoveryWorld);
  const hash = await sha256(root), text = canonicalJSON(root);
  if (Buffer.byteLength(text) > MAX_RECOVERY_BYTES) throw Error('Recovery root exceeds 2 MiB');
  await writeFile(resolve(out, `manifest.${hash}.json`), text); totalBytes += Buffer.byteLength(text);
  return { hash, body: root, recoveryWorld, totalBytes, anchorCount, admission: { cells: admittedCells, partCount, multipartCells, maxSidecarBytes, maxDecodedBytes }, descriptor: { schemaVersion: 1, url: `/world/recovery/manifest.${hash}.json`, hash, streamed: true } };
}

export async function validateCheckpointArtifacts(result, { key, manifest, out }) {
  if (result.key !== key || result.descriptor?.sourceHash !== manifest.tiles[key].sha256) throw Error('Physical proof checkpoint cell/source drift.');
      const descriptor = result.descriptor;
      if (descriptor.empty !== true) {
        const hashes = descriptor.parts || [descriptor.hash];
        if (!Array.isArray(hashes) || !hashes.length || hashes.length > 64 || hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash)) || new Set(hashes).size !== hashes.length) throw Error('Physical proof checkpoint part references invalid.');
        let validatedBytes = 0;
        for (const hash of hashes) {
          const artifact = resolve(out, `${key}.${hash}.json`), info = await lstat(artifact);
          if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_RECOVERY_BYTES) throw Error('Invalid physical proof checkpoint artifact.');
          const raw = await readFile(artifact); await admitRecoveryCell(raw, { key, manifest, hash }); validatedBytes += raw.length;
        }
        if (validatedBytes !== result.bytes) throw Error('Physical proof checkpoint byte accounting drift.');
      }
}
