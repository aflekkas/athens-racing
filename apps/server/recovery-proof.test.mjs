import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proveRecoveryCell } from '../../tools/build-world-recovery.mjs';
import { admitRecoverySidecar } from '../../server/route-road-stream.mjs';
import { encodeRecoverySidecar } from '../../server/route-road-wire.mjs';
import { canonicalJSON, sha256 } from '../../src/route-definition.js';

test('junction recovery emits the authenticated neighboring contact owner and its reverse-edge closure', async () => {
  const edge = { id: 'owner', from: 'a', to: 'b', surface: 'surface:owner', layer: 0, flags: 0, points: [[100, 0, 80], [100, 0, 120]] };
  const neighbor = { id: 'junction', from: 'b', to: 'c', surface: 'surface:junction', layer: 0, flags: 0, points: [[100, 0, 120], [100, 0, 160]] };
  const reverse = { ...neighbor, id: 'junction-reverse', from: 'c', to: 'b', points: [...neighbor.points].reverse() };
  const world = { manifest: { revision: 'a'.repeat(64), tiles: { '0,0': { sha256: 'b'.repeat(64) }, '0,1': { sha256: 'c'.repeat(64) } } }, tiles: new Map([['0,0', { packet: { roadGraph: { edges: [edge] } } }], ['0,1', { packet: { roadGraph: { edges: [neighbor, reverse] } } }]]), roads: { graph: { edges: new Map([edge, neighbor, reverse].map(value => [value.id, { value }])) } }, contacts: { contact: () => ({ y: 0, layer: 0, surfaceId: 'surface:junction' }), width: () => ({ left: 4, right: 4 }), safe: () => true } };
  const body = proveRecoveryCell('0,0', world, [{ halfWidth: 1, halfLength: 2 }]);
  assert.deepEqual(body.edges.map(e => e.id), ['junction', 'junction-reverse', 'owner']);
  assert.equal(body.anchors.length, 11);
  assert.deepEqual(body.sourceHashes, [['0,0', 'b'.repeat(64)], ['0,1', 'c'.repeat(64)]]);
  const packed = encodeRecoverySidecar(body), expectedHash = await sha256(packed);
  assert.equal((await admitRecoverySidecar(canonicalJSON(packed), { expectedHash, worldSetRevision: world.manifest.revision })).body.anchors.length, 11);
  const incomplete = encodeRecoverySidecar({ ...body, edges: [edge] });
  await assert.rejects(admitRecoverySidecar(canonicalJSON(incomplete), { expectedHash: await sha256(incomplete), worldSetRevision: world.manifest.revision }), /left its emitted edge/);
  // A restricted neighbor cannot certify a public recovery contact merely
  // because its surface name occurs somewhere in the resident graph.
  neighbor.flags = 8; reverse.flags = 8;
  assert.throws(() => proveRecoveryCell('0,0', world, [{ halfWidth: 1, halfLength: 2 }]), /roads but no certified anchors/);
});
