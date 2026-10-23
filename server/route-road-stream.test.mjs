import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../src/route-definition.js';
import { validateRecoveryManifest, createStreamedRoadAuthority } from './route-road-stream.mjs';
import { validateRouteRoads, routeRoadAuthority } from './route-roads.mjs';
const revision = 'a'.repeat(64), source = 'b'.repeat(64);
async function setup({ maxEntries } = {}) {
  const cells = {}, bodies = new Map();
  for (const [key, x] of [['0,0', 100], ['1,0', 600]]) {
    const body = { schemaVersion: 1, worldId: 'athens', projectionId: 'athens-v1', worldSetRevision: revision, sourceHashes: [[key, source]], edges: [{ id: key, from: 'a', to: 'b', layer: 0, flags: 1, surface: 'road', points: [[x, 0, 100], [x, 0, 200]] }], anchors: [{ edgeId: key, offsetM: 50, x, y: 0, z: 150, yaw: -Math.PI, layer: 0, surfaceId: 'road', leftM: 4, rightM: 4, halfWidth: 1.1, halfLength: 6, footprints: [{ halfWidth: 1.1, halfLength: 6 }, { halfWidth: 1.5, halfLength: 3 }] }] };
    const hash = await sha256(body), url = `/world/recovery/${key}.${hash}.json`; cells[key] = { sourceHash: source, hash, url }; bodies.set(url, body);
  }
  const manifest = { schemaVersion: 1, projectionId: 'athens-v1', worldId: 'athens', worldSetRevision: revision, cells, footprints: [{ halfWidth: 1.1, halfLength: 6 }, { halfWidth: 1.5, halfLength: 3 }] }, hash = await sha256(manifest), calls = [];
  await validateRecoveryManifest(manifest, { expectedHash: hash, worldSetRevision: revision });
  const authority = createStreamedRoadAuthority(manifest, async url => { calls.push(url); return structuredClone(bodies.get(url)); }, { maxEntries });
  return { manifest, bodies, hash, calls, authority, pose: { x: 100, y: 0, z: 150 } };
}
test('streamed recovery authenticates immutable URLs/world/source hashes before any fetch', async () => {
  const { manifest } = await setup(), clone = structuredClone(manifest); clone.cells['0,0'].url = 'https://attacker/geometry';
  await assert.rejects(validateRecoveryManifest(clone, { expectedHash: await sha256(clone), worldSetRevision: revision }));
  await assert.rejects(validateRecoveryManifest(manifest, { expectedHash: 'c'.repeat(64), worldSetRevision: revision }));
  await assert.rejects(validateRecoveryManifest(manifest, { expectedHash: await sha256(manifest), worldSetRevision: 'd'.repeat(64) }));
});
test('whole current safety set loads once, concurrent loads deduplicate, and uncached cells never produce candidates', async () => {
  const { authority, pose, calls } = await setup(); assert.deepEqual(authority.candidates(pose, { halfWidth: 1, halfLength: 2 }), []);
  await Promise.all([authority.ensure(pose), authority.ensure(pose)]); assert.equal(calls.length, 2); assert.equal(authority.readyFor(pose), true); assert.equal(authority.candidates(pose, { halfWidth: 1, halfLength: 2 }).length, 1);
  await authority.ensure(pose); assert.equal(calls.length, 2); assert.ok(authority.stats().bytes < 2 * 1024 * 1024); assert.equal(authority.stats().pending, 0);
  assert.deepEqual(authority.candidates({ ...pose, x: 9000 }, { halfWidth: 1, halfLength: 2 }), []);
});
test('Pareto vehicle certificates never invent a wider and longer combined footprint', async () => {
  const { authority, pose } = await setup(); await authority.ensure(pose);
  for (const footprint of [{ halfWidth: 1.1, halfLength: 6 }, { halfWidth: 1.5, halfLength: 3 }]) assert.equal(authority.candidates(pose, footprint).length, 1);
  assert.equal(authority.candidates(pose, { halfWidth: 1.5, halfLength: 6 }).length, 0);
});
test('missing neighbor and LRU pressure fail closed instead of using a partially loaded road set', async () => {
  const small = await setup({ maxEntries: 1 }); await assert.rejects(small.authority.ensure(small.pose), /cache budget/); assert.equal(small.authority.readyFor(small.pose), false); assert.deepEqual(small.authority.candidates(small.pose, { halfWidth: 1, halfLength: 2 }), []);
  const x = await setup(); x.bodies.delete(x.manifest.cells['1,0'].url); await assert.rejects(x.authority.ensure(x.pose)); assert.equal(x.authority.readyFor(x.pose), false); assert.deepEqual(x.authority.candidates(x.pose, { halfWidth: 1, halfLength: 2 }), []);
});
test('sidecar bytes and source drift cannot be admitted after a matching manifest', async () => {
  const x = await setup(); x.bodies.get(x.manifest.cells['0,0'].url).anchors[0].y = 12; await assert.rejects(x.authority.ensure(x.pose)); assert.equal(x.authority.stats().entries, 0);
  const y = await setup(), manifest = structuredClone(y.manifest), cell = manifest.cells['0,0'], body = structuredClone(y.bodies.get(cell.url)); body.sourceHashes[0][1] = 'e'.repeat(64); cell.hash = await sha256(body); cell.url = `/world/recovery/0,0.${cell.hash}.json`;
  await validateRecoveryManifest(manifest, { expectedHash: await sha256(manifest), worldSetRevision: revision });
  const authority = createStreamedRoadAuthority(manifest, async () => body); await assert.rejects(authority.ensure(y.pose), /source drift/);
});
test('streamed recovery bounds concurrent unique fetches and releases its in-flight slot', async () => {
  const x = await setup(), manifest = structuredClone(x.manifest); manifest.cells['10,0'] = { ...manifest.cells['0,0'], url: `/world/recovery/10,0.${manifest.cells['0,0'].hash}.json` };
  await validateRecoveryManifest(manifest, { expectedHash: await sha256(manifest), worldSetRevision: revision });
  let release; const blocked = new Promise(resolve => release = resolve); let first = true;
  const authority = createStreamedRoadAuthority(manifest, async url => { if (first) { first = false; await blocked; } return structuredClone(x.bodies.get(url)); }, { maxPending: 1 });
  const preparing = authority.ensure(x.pose); await assert.rejects(authority.ensure({ ...x.pose, x: 5200 }), /busy/); assert.equal(authority.stats().pending, 1);
  release(); await preparing; assert.equal(authority.stats().pending, 0); assert.equal(authority.readyFor(x.pose), true);
});
