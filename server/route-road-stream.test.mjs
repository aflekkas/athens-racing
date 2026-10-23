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

test('leased safety snapshots survive eviction, serialize parsing and release all capacity', async () => {
  const x = await setup({ maxEntries: 1 }), f = { halfWidth: 1, halfLength: 2 };
  const [a, b] = await Promise.all([x.authority.prepare(x.pose, f), x.authority.prepare(x.pose, f)]);
  assert.equal(a.candidates.length, 1); assert.equal(b.candidates.length, 1); assert.equal(x.authority.stats().peakParsing, 1);
  assert.equal(x.authority.readyFor(x.pose), false); assert.equal(x.authority.stats().leases, 2);
  await assert.rejects(x.authority.prepare(x.pose, f), /busy/);
  a.release(); a.release(); b.release(); assert.equal(x.authority.stats().leases, 0);
  const c = await x.authority.prepare(x.pose, f); c.release();
  const limited = await setup();
  const authority = createStreamedRoadAuthority(limited.manifest, async url => structuredClone(limited.bodies.get(url)), { maxContextBytes: 256 });
  await assert.rejects(authority.prepare(limited.pose, f), /candidate memory/); assert.equal(authority.stats().leases, 0);
  limited.bodies.delete(limited.manifest.cells['1,0'].url);
  await assert.rejects(limited.authority.prepare(limited.pose, f)); assert.equal(limited.authority.stats().leases, 0);
});

test('nine near-2MiB cells retain the complete safety set under a constrained heap', async () => {
  if (!process.env.ATHENS_RECOVERY_MEMORY_CHILD) {
    const { spawnSync } = await import('node:child_process');
    const env = { ...process.env, ATHENS_RECOVERY_MEMORY_CHILD: '1' }; delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ['--max-old-space-size=24', '--test', '--test-name-pattern=nine near-2MiB', import.meta.filename], { encoding: 'utf8', env, timeout: 30000 });
    assert.equal(child.status, 0, child.stdout + child.stderr); assert.match(child.stdout, /recoveryMemoryProof/); console.log(child.stdout.trim()); return;
  }
  const { canonicalJSON } = await import('../src/route-definition.js'), cells = {}, descriptors = new Map();
  // An emitted shard may carry long source metadata. It must not remain in the
  // decoded cache after validation. All nine candidates are within the query.
  const make = key => ({ schemaVersion: 1, worldId: 'athens', projectionId: 'athens-v1', worldSetRevision: revision, sourceHashes: [[key, source]], edges: [{ id: key, layer: 0, flags: 1, surface: 'road', points: [[500, 0, 400], [500, 0, 600]], sourceMetadata: 'x'.repeat(1940000) }], anchors: [{ edgeId: key, offsetM: 100, x: 500, y: 0, z: 500, yaw: -Math.PI, layer: 0, surfaceId: 'road', leftM: 4, rightM: 4, halfWidth: 1.1, halfLength: 6 }] });
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    const key = `${x},${z}`, body = make(key), hash = await sha256(body), url = `/world/recovery/${key}.${hash}.json`;
    cells[key] = { sourceHash: source, hash, url }; descriptors.set(url, key);
  }
  const manifest = { schemaVersion: 1, projectionId: 'athens-v1', worldId: 'athens', worldSetRevision: revision, cells, footprints: [{ halfWidth: 1.1, halfLength: 6 }] };
  await validateRecoveryManifest(manifest, { expectedHash: await sha256(manifest), worldSetRevision: revision });
  let calls = 0;
  const authority = createStreamedRoadAuthority(manifest, async url => { calls++; return canonicalJSON(make(descriptors.get(url))); }, { maxEntries: 3 });
  const snapshot = await authority.prepare({ x: 500, y: 0, z: 500 }, { halfWidth: 1, halfLength: 2 });
  assert.equal(calls, 9); assert.equal(snapshot.candidates.length, 9); assert.equal(snapshot.edges.length, 9);
  assert.equal(authority.readyFor({ x: 500, y: 0, z: 500 }), false);
  assert.equal(authority.stats().entries, 3); assert.equal(authority.stats().peakParsing, 1);
  assert.ok(authority.stats().bytes <= 12 * 1024 * 1024); assert.ok(authority.stats().decodedBytes < 100000);
  snapshot.release(); assert.equal(authority.stats().leases, 0);
  console.log(JSON.stringify({ recoveryMemoryProof: authority.stats(), maxRSSKiB: process.resourceUsage().maxRSS, heapUsed: process.memoryUsage().heapUsed }));
});

test('dense JSON expansion and decoded cache budgets reject before retaining geometry', async () => {
  const x = await setup();
  const dense = createStreamedRoadAuthority(x.manifest, async () => '[' + '0,'.repeat(110000) + '0]');
  await assert.rejects(dense.prepare(x.pose, { halfWidth: 1, halfLength: 2 }), /decoded memory/);
  assert.equal(dense.stats().entries, 0); assert.equal(dense.stats().leases, 0);
  const tiny = createStreamedRoadAuthority(x.manifest, async url => structuredClone(x.bodies.get(url)), { maxDecodedBytes: 256 });
  await assert.rejects(tiny.prepare(x.pose, { halfWidth: 1, halfLength: 2 }), /cache budget/);
  assert.equal(tiny.stats().decodedBytes, 0); assert.equal(tiny.stats().pending, 0); assert.equal(tiny.stats().leases, 0);
});
