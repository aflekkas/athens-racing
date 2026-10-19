import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './world-tile-format.test.mjs';
import { validateWorldTile, tileTables, legacyTables, tileEdgeSignatures, TILE_COMPACT_TABLES } from '../src/world-tile-format.js';
import { buildTileContactIndex, sampleTileContact } from '../src/world-tile-contact.js';
import { addDerivedBuildings, deriveBuildingMeshes, buildingTriangleCount } from '../src/world-tile-buildings.js';
import { prepareTilePacket } from '../src/world-tile-worker.js';

function addTable(p, name, array) { p.metadata.tables[name] = p.arrays.length; p.arrays.push(array); }
function building(p, corners, base = 3, height = 9, colour = 0) {
  const set = (k, a) => { p.arrays[p.metadata.tables[k]] = a; };
  set('buildings', Uint32Array.of(...(tileTables(p).buildings), p.metadata.ids.push('building:b' + p.metadata.ids.length) - 1, 0, corners.length, colour));
  set('buildingCorners', Float32Array.from(corners.flat())); set('buildingHeights', Float32Array.of(base, height));
}
// Two ground triangles (a road and plain terrain) plus one deck triangle, as the generator emits them.
function compactTile() {
  const p = fixture(); p.metadata.ids.push('surface:road', 'terrain:0:0');
  p.arrays[p.metadata.tables.finePositions] = new Float32Array([0,5,0, 100,5,0, 0,5,100, 100,5,100, 0,9,0, 100,9,0, 0,9,100]);
  p.arrays[p.metadata.tables.contactPositions] = new Float32Array([0,5,0, 100,5,0, 0,5,100, 100,5,100, 0,9,0, 100,9,0, 0,9,100]);
  p.arrays[p.metadata.tables.fineTriangles] = new Uint32Array([0,2,1, 1,2,3]);
  addTable(p, 'fineSurface', Uint32Array.of(1, 2)); addTable(p, 'fineFlags', Uint8Array.of(1, 2));
  p.arrays[p.metadata.tables.contactTriangles] = new Uint32Array([4,6,5, 1, 1]); p.arrays[p.metadata.tables.contactLayers] = Int8Array.of(1);
  return p;
}
test('compact tiles validate, and their classic table shape lists the ground rows first', () => {
  const p = compactTile(); assert.equal(validateWorldTile(p).triangles, 0);
  const l = legacyTables(tileTables(p));
  assert.deepEqual([...l.contactTriangles], [0,2,1,1,1, 1,2,3,2,2, 4,6,5,1,1]); assert.deepEqual([...l.contactLayers], [0,0,1]);
  assert.equal(l.fineSurface, undefined);
  p.arrays[p.metadata.tables.fineFlags] = Uint8Array.of(1, 16); assert.throws(() => validateWorldTile(p), /contact flags/);
  p.arrays[p.metadata.tables.fineFlags] = Uint8Array.of(1); assert.throws(() => validateWorldTile(p), /compact ground rows/);
  delete p.metadata.tables.fineFlags; assert.throws(() => validateWorldTile(p), /compact tables/);
  const q = compactTile(); q.arrays[q.metadata.tables.contactPositions] = new Float32Array(3); assert.throws(() => validateWorldTile(q), /compact positions|vertex/);
  assert.deepEqual(Object.keys(TILE_COMPACT_TABLES), ['fineSurface', 'fineFlags']);
});
test('a compact tile answers every contact query exactly like its classic table shape, with half the references', () => {
  const p = compactTile(), t = tileTables(p), l = legacyTables(t), compact = buildTileContactIndex(t), classic = buildTileContactIndex(l);
  assert.ok(compact.refs.length < classic.refs.length);
  const options = [{}, { requiredFlags: 1 }, { requiredFlags: 2 }, { layer: 0 }, { layer: 1 }, { layer: 0, requiredFlags: 1 }, { referenceY: 9 }, { referenceY: 9, layer: null, requiredFlags: 1 }];
  for (let x = 1; x < 100; x += 7) for (let z = 1; z < 100; z += 9) for (const o of options) assert.deepEqual(sampleTileContact(t, compact, x, z, o), sampleTileContact(l, classic, x, z, o), `${x},${z} ${JSON.stringify(o)}`);
  assert.equal(sampleTileContact(t, compact, 10, 20, { requiredFlags: 1 }).surface, 1);
});
test('seam signatures do not depend on the table shape', () => {
  const p = compactTile(); const a = tileEdgeSignatures(p);
  const q = compactTile(); q.arrays[q.metadata.tables.contactTriangles] = new Uint32Array([0,2,1,1,1, 1,2,3,2,2, 4,6,5,1,1]); q.arrays[q.metadata.tables.contactLayers] = Int8Array.of(0, 0, 1);
  for (const k of Object.keys(TILE_COMPACT_TABLES)) delete q.metadata.tables[k];
  assert.deepEqual(tileEdgeSignatures(q), a);
});
test('building walls and roof are derived from the footprint table: counts, outward walls, upward roof, the old shades', () => {
  const p = fixture(); p.metadata.extensions = { derivedBuildings: { version: 1 } };
  building(p, [[10, 10], [10, 30], [40, 30], [40, 10]], 3, 9, 0);
  const t = tileTables(p), { arrays, meshes } = deriveBuildingMeshes(t, p.metadata);
  assert.equal(meshes.length, 1); const [mesh] = meshes, P = arrays[mesh.attributes.position.array], C = arrays[mesh.attributes.color.array], I = arrays[mesh.index];
  assert.equal(I.length / 3, buildingTriangleCount(4)); assert.equal(P.length / 3, 5 * 4);
  let roof = 0, walls = 0;
  for (let k = 0; k < I.length; k += 3) {
    const [a, b, c] = [0, 1, 2].map(j => [P[I[k+j]*3], P[I[k+j]*3+1], P[I[k+j]*3+2]]), u = b.map((v, i) => v - a[i]), v = c.map((w, i) => w - a[i]);
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]], len = Math.hypot(...n), cx = (a[0]+b[0]+c[0])/3, cz = (a[2]+b[2]+c[2])/3;
    if (n[1] / len > .9) { roof++; assert.equal(a[1], 12); assert.equal(C[I[k]*3], 255); }
    else { walls++; assert.ok(Math.abs(n[1]) < 1e-6); assert.ok(n[0] * (cx - 25) + n[2] * (cz - 20) > 0, 'wall faces outward'); }
  }
  assert.deepEqual([roof, walls], [2, 8]);
  // The west wall (normal -x) is lit by the NW sun: .75 + .1*.6 in display space, as face_shaded() computed it.
  const level = .75 + .1 * .6, expected = Math.round((((level + .055) / 1.055) ** 2.4) * 255);
  assert.ok([...C].includes(expected));
});
test('a concave footprint is ear clipped into n-2 roof triangles whatever its winding', () => {
  const l = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]];
  for (const corners of [l, [...l].reverse()]) {
    const p = fixture(); p.metadata.extensions = { derivedBuildings: { version: 1 } }; building(p, corners);
    const { arrays, meshes } = deriveBuildingMeshes(tileTables(p), p.metadata), P = arrays[meshes[0].attributes.position.array], I = arrays[meshes[0].index];
    assert.equal(I.length / 3, buildingTriangleCount(6));
    let area = 0;
    for (let k = 0; k < I.length; k += 3) { const [a, b, c] = [0, 1, 2].map(j => I[k+j]); if (P[a*3+1] === 12 && P[b*3+1] === 12 && P[c*3+1] === 12) area += ((P[b*3]-P[a*3]) * (P[c*3+2]-P[a*3+2]) - (P[c*3]-P[a*3]) * (P[b*3+2]-P[a*3+2])) / -2; }
    assert.ok(Math.abs(area - 500) < 1e-3, 'the roof covers exactly the L footprint');
  }
});
test('derived buildings count in the triangle budget once, and the worker adds them before bounds and byte accounting', () => {
  const p = fixture(); p.metadata.extensions = { derivedBuildings: { version: 1 } }; building(p, [[10, 10], [10, 30], [40, 30], [40, 10]]);
  assert.throws(() => validateWorldTile(p), /triangle accounting/);
  p.metadata.budgets.triangles = buildingTriangleCount(4); p.metadata.budgets.buildingTriangles = buildingTriangleCount(4);
  assert.equal(validateWorldTile(p).triangles, 10);
  const packet = prepareTilePacket(p, { entry: { decodedBytes: 1e8, triangles: 10 }, world: 'athens', revision: 'test', cell: [0, 0] });
  assert.equal(packet.metadata.meshes.length, 1); assert.deepEqual(packet.metadata.meshes[0].bounds.box, [10, 3, 10, 40, 12, 30]);
  assert.equal(validateWorldTile(packet).triangles, 10); assert.equal(addDerivedBuildings(packet, tileTables(packet)).metadata.meshes.length, 1);
  assert.ok(packet.gpuBytes > 0);
});
