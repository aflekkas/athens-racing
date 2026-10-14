import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { generateMapBake } from './bake-world.mjs';
import { encodeGeometryPack, decodeGeometryPack } from '../src/baked-geometry.js';
import { restoreBakedTerrain, restoreBakedRoads } from '../src/baked-world.js';
import { RoadNetwork } from '../src/road-network-surface.js';
const root = resolve(import.meta.dirname, '..');
function roundTrip(buffer) {
  const bytes = gunzipSync(gzipSync(new Uint8Array(buffer)));
  return decodeGeometryPack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
function equalGroup(a, b) {
  assert.equal(a.children.length, b.children.length);
  for (let i = 0; i < a.children.length; i++) {
    const x = a.children[i], y = b.children[i];
    for (const key of ['receiveShadow', 'castShadow', 'renderOrder', 'name']) assert.equal(y[key], x[key]);
    assert.equal(y.layers.mask, x.layers.mask); assert.deepEqual(y.userData, x.userData);
    assert.equal(y.material.customProgramCacheKey(), x.material.customProgramCacheKey());
    assert.equal(y.material.polygonOffset, x.material.polygonOffset);
    assert.deepEqual(Object.keys(y.geometry.attributes), Object.keys(x.geometry.attributes));
    for (const [key, attr] of Object.entries(x.geometry.attributes)) {
      const actual = y.geometry.attributes[key];
      assert.equal(actual.itemSize, attr.itemSize); assert.equal(actual.normalized, attr.normalized);
      assert.deepEqual(actual.array, attr.array, `mesh ${i} ${key}`);
    }
    assert.deepEqual(y.geometry.index?.array, x.geometry.index?.array);
    assert.deepEqual(y.geometry.boundingSphere, x.geometry.boundingSphere);
  }
}
test('geometry packs reject invalid magic, versions and out-of-bounds views', () => {
  const pack = encodeGeometryPack({}, [new Float32Array([1, 2, 3]), new Uint16Array([0, 1, 2])], [true, false]);
  assert.deepEqual(roundTrip(pack).arrays[1], new Uint16Array([0, 1, 2]));
  const bad = pack.slice(0); new DataView(bad).setUint32(0, 0); assert.throws(() => decodeGeometryPack(bad));
  assert.throws(() => decodeGeometryPack(pack.slice(0, 16)));
});
for (const id of ['riviera', 'penteli']) test(`baked ${id} exactly equals generated terrain, roads and wheel surface`, async () => {
  const bake = await generateMapBake(root, id), terrainPack = roundTrip(bake.terrain), roadsPack = roundTrip(bake.roads);
  const network = new RoadNetwork(bake.map), scene = new THREE.Group();
  const ter = restoreBakedTerrain(terrainPack, bake.map.terrain, network, scene, { coastal: id === 'riviera' });
  const roads = restoreBakedRoads(roadsPack, network, scene);
  equalGroup(bake.terrainGroup, ter.group); equalGroup(bake.roadsGroup, roads);
  assert.deepEqual(bake.map.terrain.Hc, terrainPack.arrays[0]); assert.deepEqual(network.source, bake.network.source);
  assert.equal(network.stats.triangles, bake.network.stats.triangles);
  // Includes random barycentric locations on the actual road triangles and fallback DEM points.
  for (const m of roads.children) {
    const p = m.geometry.attributes.position.array;
    for (let i = 0; i + 8 < p.length; i += 9 * 137) {
      const x = p[i] * .21 + p[i + 3] * .33 + p[i + 6] * .46, z = p[i + 2] * .21 + p[i + 5] * .33 + p[i + 8] * .46;
      assert.equal(network.height(x, z), bake.network.height(x, z));
    }
  }
});
