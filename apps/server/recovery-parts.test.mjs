import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJSON, sha256 } from '../../src/route-definition.js';
import { encodeRecoverySidecar } from '../../server/route-road-wire.mjs';
import { validateRecoveryManifest, createStreamedRoadAuthority } from '../../server/route-road-stream.mjs';

async function fixture() {
  const revision = 'a'.repeat(64), sourceHash = 'b'.repeat(64), footprint = { halfWidth: 1, halfLength: 2 };
  const edge = { id: 'road', from: 'a', to: 'b', points: [[100, 0, 80], [100, 0, 160]], surface: 'road', layer: 0, flags: 0 };
  const artifacts = new Map(), hashes = [];
  for (const z of [100, 110]) {
    const body = encodeRecoverySidecar({ schemaVersion: 1, worldId: 'athens', projectionId: 'athens-v1', worldSetRevision: revision, sourceHashes: [['0,0', sourceHash]], edges: [edge], anchors: [{ edgeId: 'road', offsetM: z - 80, x: 100, y: 0, z, yaw: -Math.PI, layer: 0, surfaceId: 'road', leftM: 4, rightM: 4, ...footprint, footprints: [footprint] }] });
    const hash = await sha256(body); hashes.push(hash); artifacts.set(`/world/recovery/0,0.${hash}.json`, canonicalJSON(body));
  }
  const root = { schemaVersion: 1, worldId: 'athens', projectionId: 'athens-v1', worldSetRevision: revision, footprints: [footprint], cells: { '0,0': { sourceHash, parts: hashes } } };
  const validate = async body => validateRecoveryManifest(body, { expectedHash: await sha256(body), worldSetRevision: revision, sourceHashes: [['0,0', sourceHash]] });
  return { root, artifacts, hashes, validate, footprint };
}

test('bounded recovery parts authenticate and preserve every certified candidate and emitted edge', async () => {
  const f = await fixture(), root = await f.validate(f.root), loaded = [];
  assert.equal(Object.isFrozen(root.cells['0,0'].parts), true);
  const authority = createStreamedRoadAuthority(root, async url => { loaded.push(url); return f.artifacts.get(url); });
  const pose = { x: 100, y: 0, z: 105, yaw: -Math.PI, layer: 0 };
  const context = await authority.prepare(pose, f.footprint);
  try { assert.deepEqual(context.candidates.map(a => a.z).sort((a, b) => a - b), [100, 110]); assert.equal(context.edges.length, 1); assert.equal(loaded.length, 2); assert.equal(authority.stats().entries, 2); assert.equal(authority.readyFor(pose), true); }
  finally { context.release(); }
  assert.equal(authority.stats().leases, 0);
});

test('recovery multipart manifests reject ambiguous, missing, repeated, oversized and malformed part references', async () => {
  const f = await fixture();
  for (const change of [cell => { cell.parts = []; }, cell => { cell.parts = [f.hashes[0], f.hashes[0]]; }, cell => { cell.parts = Array(65).fill(f.hashes[0]); }, cell => { cell.parts = ['invalid']; }, cell => { cell.hash = f.hashes[0]; }, cell => { cell.url = '/outside.json'; }, cell => { cell.empty = true; }, cell => { cell.empty = 'false'; }, cell => { cell.empty = false; }]) { const root = structuredClone(f.root); change(root.cells['0,0']); await assert.rejects(f.validate(root), /Invalid immutable/); }
});


test('multipart authority derives only the requested neighborhood and precharges reference scratch before allocation', async () => {
  const f = await fixture();
  const hashes = Array.from({ length: 64 }, (_, i) => i.toString(16).padStart(64, '0'));
  const body = { ...f.root, cells: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`${i},0`, { sourceHash: 'b'.repeat(64), parts: hashes }])) };
  let reads = 0;
  const authority = createStreamedRoadAuthority(body, async () => { reads++; throw Error('No read expected'); }, { maxContextBytes: 256 });
  await assert.rejects(authority.prepare({ x: 100, y: 0, z: 100 }, f.footprint), /reference context memory/);
  assert.equal(reads, 0);
  assert.equal(authority.stats().entries, 0);
});
