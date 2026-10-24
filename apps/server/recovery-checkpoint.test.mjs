import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { encodeRecoverySidecar } from '../../server/route-road-wire.mjs';
import { canonicalJSON, sha256 } from '../../src/route-definition.js';
import { validateCheckpointArtifacts } from './recovery-pool.mjs';

test('resumed checkpoint readmits original artifact bytes and rejects cell/source swaps, byte tampering and accounting drift', async () => {
  const out = await mkdtemp(resolve(tmpdir(), 'athens-cell-checkpoint.'));
  try {
    const key = '0,0', sourceHash = 'b'.repeat(64), manifest = { revision: 'a'.repeat(64), tiles: { [key]: { sha256: sourceHash } } };
    const body = encodeRecoverySidecar({ schemaVersion: 1, worldId: 'athens', projectionId: 'athens-v1', worldSetRevision: manifest.revision, sourceHashes: [[key, sourceHash]], edges: [{ id: 'road', from: 'a', to: 'b', points: [[100, 0, 80], [100, 0, 160]], surface: 'road', layer: 0, flags: 0 }], anchors: [{ edgeId: 'road', offsetM: 20, x: 100, y: 0, z: 100, yaw: -Math.PI, layer: 0, surfaceId: 'road', leftM: 4, rightM: 4, halfWidth: 1, halfLength: 2, footprints: [{ halfWidth: 1, halfLength: 2 }] }] });
    const text = canonicalJSON(body), hash = await sha256(body), path = resolve(out, `${key}.${hash}.json`), result = { key, descriptor: { sourceHash, parts: [hash] }, bytes: Buffer.byteLength(text) };
    await writeFile(path, text); await validateCheckpointArtifacts(result, { key, manifest, out });
    await assert.rejects(validateCheckpointArtifacts({ ...result, key: '1,0' }, { key, manifest, out }), /cell\/source drift/);
    await assert.rejects(validateCheckpointArtifacts({ ...result, descriptor: { ...result.descriptor, sourceHash: 'c'.repeat(64) } }, { key, manifest, out }), /cell\/source drift/);
    await assert.rejects(validateCheckpointArtifacts({ ...result, bytes: result.bytes + 1 }, { key, manifest, out }), /byte accounting drift/);
    await writeFile(path, text.replace('"x"', '"q"') + ' ');
    await assert.rejects(validateCheckpointArtifacts(result, { key, manifest, out }));
  } finally { await rm(out, { recursive: true, force: true }); }
});
