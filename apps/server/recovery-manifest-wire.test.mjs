import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRecoveryHash, decodeRecoveryHash, encodeRecoveryManifest, recoveryCellDescriptor, recoveryCellSourceHash, recoveryCellScratchBytes } from '../../server/recovery-manifest-wire.mjs';
import { validateRecoveryManifest, createStreamedRoadAuthority, RECOVERY_MEMORY } from '../../server/route-road-stream.mjs';
import { encodeRecoverySidecar } from '../../server/route-road-wire.mjs';
import { sha256, canonicalJSON } from '../../src/route-definition.js';
const revision = 'a'.repeat(64), source = 'b'.repeat(64), part = 'c'.repeat(64), other = 'd'.repeat(64);
const root = () => ({ schemaVersion: 1, worldId: 'athens', projectionId: 'athens-v1', worldSetRevision: revision, footprints: [{ halfWidth: 1, halfLength: 2.5 }], cells: { '0,0': { sourceHash: source, hash: part, url: `/world/recovery/0,0.${part}.json` }, '1,0': { sourceHash: source, parts: [part, other] }, '2,0': { sourceHash: source, empty: true } } });
const validate = async (body, sourceHashes = null) => validateRecoveryManifest(body, { expectedHash: await sha256(body), worldSetRevision: revision, sourceHashes });

test('portable SHA tokens round-trip exact 32 bytes and reject alternate base64 encodings', () => {
  for (const value of ['0'.repeat(64), 'f'.repeat(64), source, part, '0123456789abcdef'.repeat(4)]) {
    const token = encodeRecoveryHash(value); assert.equal(token.length, 43);
    assert.equal(token, Buffer.from(value, 'hex').toString('base64url'));
    assert.equal(decodeRecoveryHash(token), value);
  }
  const zero = encodeRecoveryHash('0'.repeat(64));
  for (const token of [zero + '=', zero.slice(0, -1), zero + 'A', zero.slice(0, -1) + 'B', '+'.repeat(43), '/'.repeat(43), ' '.repeat(43)]) assert.throws(() => decodeRecoveryHash(token), /Invalid immutable/);
});

test('compact root preserves ordered sidecar hashes, empty cells and the exact authenticated wire body', async () => {
  const original = root(), compact = encodeRecoveryManifest(original), before = structuredClone(compact);
  assert.equal(compact.schemaVersion, 2); assert.ok(Object.isFrozen(compact.cells));
  assert.deepEqual(recoveryCellDescriptor(compact, '0,0'), { sourceHash: source, parts: [part] });
  assert.deepEqual(recoveryCellDescriptor(compact, '1,0'), { sourceHash: source, parts: [part, other] });
  assert.deepEqual(recoveryCellDescriptor(compact, '2,0'), { sourceHash: source, empty: true });
  const admitted = await validate(compact, [['0,0', source], ['1,0', source], ['2,0', source]]);
  assert.deepEqual(admitted, before); assert.equal(await sha256(admitted), await sha256(before));
  assert.ok(Object.values(admitted.cells).every(value => typeof value === 'string'), 'no full normalized shadow map');
  assert.deepEqual(await validate(original), original, 'schema 1 stays unchanged');
});

test('compact source registry binding and caller ownership survive digest-time mutation', async () => {
  const original = structuredClone(encodeRecoveryManifest(root())), before = structuredClone(original), registry = [['0,0', source], ['1,0', source], ['2,0', source]], expectedHash = await sha256(original);
  const pending = validateRecoveryManifest(original, { expectedHash, worldSetRevision: revision, sourceHashes: registry });
  original.cells['0,0'] = encodeRecoveryHash(other); registry[0][1] = other;
  const admitted = await pending; assert.deepEqual(admitted, before); assert.equal(recoveryCellSourceHash(admitted, '0,0'), source);
  await assert.rejects(validate(before, [['0,0', other], ['1,0', source], ['2,0', source]]), /omits or changes/);
});

test('malformed lengths, separators, pad bits, duplicate and excessive parts fail after hash authentication', async () => {
  const good = encodeRecoveryHash(source), hash = encodeRecoveryHash(part);
  for (const value of ['', good + ':', ':' + hash, good + '::' + hash, good + ':' + hash + ':' + hash, good + ':' + Array(65).fill(hash).join(':'), 'A'.repeat(42), good.slice(0, -1) + 'B']) {
    const changed = structuredClone(encodeRecoveryManifest(root())); changed.cells['0,0'] = value;
    await assert.rejects(validate(changed), /Invalid immutable/);
  }
  const input = root(); input.cells['0,0'].unexpected = 'must not be silently omitted'; assert.throws(() => encodeRecoveryManifest(input), /Invalid immutable/);
});

test('descriptor scratch is checked before allocating decoded hashes and the 64-part bound is exact', () => {
  const legacy = root(), hashes = Array.from({ length: 64 }, (_, i) => (i + 1).toString(16).padStart(64, '0'));
  legacy.cells['0,0'] = { sourceHash: source, parts: hashes };
  const compact = encodeRecoveryManifest(legacy), required = recoveryCellScratchBytes(compact, '0,0'), atob = globalThis.atob; let decodes = 0;
  globalThis.atob = (...args) => { decodes++; return atob(...args); };
  try { assert.throws(() => recoveryCellDescriptor(compact, '0,0', { maxScratchBytes: required - 1 }), /memory budget/); assert.equal(decodes, 0); }
  finally { globalThis.atob = atob; }
  assert.deepEqual(recoveryCellDescriptor(compact, '0,0', { maxScratchBytes: required }).parts, hashes);
  assert.equal(RECOVERY_MEMORY.decoded, 12 * 1024 ** 2);
});

test('authority derives the same immutable URL and charges compact decode scratch before fetching', async () => {
  const body = { schemaVersion: 1, worldId: 'athens', projectionId: 'athens-v1', worldSetRevision: revision, sourceHashes: [['0,0', source]], edges: [{ id: 'edge', from: 'a', to: 'b', surface: 'road', layer: 0, flags: 1, points: [[0,0,0],[100,0,0]] }], anchors: [{ edgeId: 'edge', x: 10, y: 0, z: 0, offsetM: 10, yaw: -Math.PI / 2, layer: 0, surfaceId: 'road', leftM: 4, rightM: 4, halfWidth: 1, halfLength: 2.5, footprints: [{ halfWidth: 1, halfLength: 2.5 }] }] }, packed = encodeRecoverySidecar(body), hash = await sha256(packed);
  const legacy = root(); legacy.cells = { '0,0': { sourceHash: source, parts: [hash] } };
  const compact = await validate(encodeRecoveryManifest(legacy)); let requests = 0;
  const loader = async url => { requests++; assert.equal(url, `/world/recovery/0,0.${hash}.json`); return canonicalJSON(packed); };
  const authority = createStreamedRoadAuthority(compact, loader), context = await authority.prepare({ x: 10, y: 0, z: 0 }, { halfWidth: 1, halfLength: 2.5 });
  assert.deepEqual([...context.candidates], body.anchors); assert.ok(context.bytes >= recoveryCellScratchBytes(compact, '0,0')); context.release(); assert.equal(requests, 1);
  const bounded = createStreamedRoadAuthority(compact, loader, { maxContextBytes: 1024 });
  await assert.rejects(bounded.prepare({ x: 10, y: 0, z: 0 }, { halfWidth: 1, halfLength: 2.5 }), /memory budget/);
  assert.equal(requests, 1, 'no fetch before failed decode reservation');
});
