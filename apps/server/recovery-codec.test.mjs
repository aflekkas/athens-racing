import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRecoverySidecar, decodeRecoverySidecar, scanRecoveryJSON } from '../../server/route-road-wire.mjs';
import { validateRouteRoads } from '../../server/route-roads.mjs';
import { admitRecoverySidecar, RECOVERY_MEMORY } from '../../server/route-road-stream.mjs';
import { canonicalJSON, sha256 } from '../../src/route-definition.js';

function fixture() {
  const worldSetRevision = 'a'.repeat(64), edgeId = 'road:an-exact-emitted-road-identifier', surfaceId = 'surface:an-exact-emitted-surface';
  return { schemaVersion: 1, worldId: 'athens', projectionId: 'athens-v1', worldSetRevision, sourceHashes: [['0,0', 'b'.repeat(64)]], edges: [{ id: edgeId, from: 'a', to: 'b', flags: 1, layer: 0, surface: surfaceId, points: [[0, 0, 0], [100, 0, 0]] }], anchors: Array.from({ length: 50 }, (_, i) => ({ edgeId, x: i * 2, y: 0, z: 0, yaw: -Math.PI / 2, offsetM: i * 2, layer: 0, surfaceId, leftM: 4, rightM: 4, halfWidth: 1, halfLength: 2.5, footprints: [{ halfWidth: 1, halfLength: 2.5 }] })) };
}

const options = async packed => ({ expectedHash: await sha256(packed), worldSetRevision: packed.worldSetRevision });

test('schema 3 exact string dictionary round-trips without changing any pose, edge or certificate', () => {
  const original = fixture(), before = structuredClone(original), packed = encodeRecoverySidecar(original, { dictionary: true });
  assert.equal(packed.schemaVersion, 3); assert.equal(encodeRecoverySidecar(original).schemaVersion, 2);
  assert.deepEqual(decodeRecoverySidecar(packed).body, original);
  assert.deepEqual(decodeRecoverySidecar(structuredClone(packed), { consume: true }).body, original);
  assert.deepEqual(original, before, 'encoder takes a private copy');
  assert.ok(scanRecoveryJSON(canonicalJSON(packed)).estimatedDecodedBytes < scanRecoveryJSON(canonicalJSON(encodeRecoverySidecar(original))).estimatedDecodedBytes);
});

test('schema 3 uses the same authenticated request admission and fixed memory caps', async () => {
  const original = fixture(), packed = encodeRecoverySidecar(original, { dictionary: true }), settings = await options(packed);
  assert.deepEqual(await validateRouteRoads(packed, settings), original);
  const admitted = await admitRecoverySidecar(canonicalJSON(packed), settings);
  assert.deepEqual(admitted.body.anchors, original.anchors);
  assert.equal(RECOVERY_MEMORY.decoded, 12 * 1024 ** 2);
  assert.ok(admitted.metrics.memory.expansionBytes <= RECOVERY_MEMORY.decoded);
  await assert.rejects(validateRouteRoads(packed, { ...settings, maxCombinedBytes: 128 }), /memory budget/);
  assert.throws(() => decodeRecoverySidecar(packed, { maxCombinedBytes: 128 }), /memory budget/);
  await assert.rejects(admitRecoverySidecar(canonicalJSON(packed), { ...settings, expectedHash: 'c'.repeat(64) }), /Invalid authoritative/);
});

test('forged string references, duplicate/unused dictionaries and schema confusion are rejected', () => {
  const packed = encodeRecoverySidecar(fixture(), { dictionary: true }), at = packed.anchorFields.indexOf('edgeId');
  for (const value of [-1, packed.stringTable.length, .5, NaN, Infinity, '0', null]) {
    const changed = structuredClone(packed); changed.anchors[0][at] = value;
    assert.throws(() => decodeRecoverySidecar(changed), /Invalid packed/);
  }
  for (const change of [p => p.stringTable.push(p.stringTable[0]), p => p.stringTable.push('unused'), p => p.stringTable[0] = '', p => delete p.stringTable[0], p => { p.schemaVersion = 2; }, p => { delete p.stringTable; }]) {
    const changed = structuredClone(packed); change(changed); assert.throws(() => decodeRecoverySidecar(changed), /Invalid packed/);
  }
});

test('caller-owned accessor/sparse dictionaries are rejected without evaluating getters', async () => {
  let called = false;
  const packed = structuredClone(encodeRecoverySidecar(fixture(), { dictionary: true }));
  Object.defineProperty(packed.stringTable, '0', { enumerable: true, get() { called = true; return 'malicious'; } });
  await assert.rejects(validateRouteRoads(packed, { expectedHash: 'c'.repeat(64), worldSetRevision: packed.worldSetRevision }), /strict JSON/);
  assert.equal(called, false);
});


test('schema 3 canonical authentication streams tokens without allocating an uncharged complete UTF-16 serialization', async () => {
  const packed = encodeRecoverySidecar(fixture(), { dictionary: true }), settings = await options(packed), text = canonicalJSON(packed);
  const encode = TextEncoder.prototype.encode;
  TextEncoder.prototype.encode = function () { throw Error('Unexpected full canonical encoding allocation'); };
  try {
    const admitted = await admitRecoverySidecar(text, settings);
    assert.equal(admitted.body.anchors.length, packed.anchors.length);
  } finally { TextEncoder.prototype.encode = encode; }
});


test('oversized dictionary strings and sparse arrays cannot bypass preallocation guards', async () => {
  const packed = structuredClone(encodeRecoverySidecar(fixture(), { dictionary: true }));
  packed.stringTable[0] = 'x'.repeat(2 * 1024 ** 2);
  await assert.rejects(validateRouteRoads(packed, { expectedHash: 'c'.repeat(64), worldSetRevision: packed.worldSetRevision }), /budget/);
  const sparse = structuredClone(encodeRecoverySidecar(fixture(), { dictionary: true }));
  delete sparse.stringTable[0]; sparse.stringTable.extra = 'replacement';
  assert.throws(() => decodeRecoverySidecar(sparse), /Invalid packed/);
});
