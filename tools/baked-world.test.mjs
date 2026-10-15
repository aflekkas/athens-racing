import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { packGroup } from '../src/baked-world-pack.js';
import { generateMapBake } from './bake-world.mjs';
import { encodeGeometryPack, decodeGeometryPack } from '../src/baked-geometry.js';
import { restoreBakedTerrain, restoreBakedRoads } from '../src/baked-world.js';
import { loadBakedWorldData } from '../src/baked-world-data.js';
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
for (const id of ['riviera', 'penteli', 'psychiko']) test(`baked ${id} exactly equals generated terrain, roads and wheel surface`, async () => {
  const bake = await generateMapBake(root, id), terrainPack = roundTrip(bake.terrain), roadsPack = roundTrip(bake.roads);
  // The worker uses raw (unshuffled) transferable packs; build bakes choose gzip-friendly byte planes.
  const workerTerrain = decodeGeometryPack(packGroup(bake.terrainGroup, { map: id, grid: bake.map.terrain.GX * bake.map.terrain.GZ, height: 0, source: 1 }, [bake.map.terrain.Hc, bake.network.source]));
  const workerRoads = decodeGeometryPack(packGroup(bake.roadsGroup, { map: id, grid: bake.map.terrain.GX * bake.map.terrain.GZ, stats: roadsPack.metadata.stats }));
  const network = new RoadNetwork(bake.map), scene = new THREE.Group();
  const ter = restoreBakedTerrain(terrainPack, bake.map.terrain, network, scene, { coastal: id === 'riviera', gardens: id === 'psychiko' });
  const roads = restoreBakedRoads(roadsPack, network, scene);
  equalGroup(bake.terrainGroup, ter.group); equalGroup(bake.roadsGroup, roads);
  const rawNetwork = new RoadNetwork(bake.map), rawScene = new THREE.Group();
  equalGroup(ter.group, restoreBakedTerrain(workerTerrain, bake.map.terrain, rawNetwork, rawScene, { coastal: id === 'riviera', gardens: id === 'psychiko' }).group);
  equalGroup(roads, restoreBakedRoads(workerRoads, rawNetwork, rawScene));
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

test('missing, disabled and corrupt baked downloads fall back without installing partial state', async () => {
  const previousFetch = globalThis.fetch, previousLocation = globalThis.location, warn = console.warn;
  const map = { id: 'riviera', data: { roadNetwork: {}, bakedWorld: { version: 1, compression: 'gzip', terrain: '/terrain', roads: '/roads' } }, terrain: { GX: 1, GZ: 1 } };
  let requests = 0;
  try {
    console.warn = () => {}; globalThis.location = { search: '?nobake' };
    globalThis.fetch = async () => { requests++; return new Response('missing', { status: 404 }); };
    assert.equal(await loadBakedWorldData(map), null); assert.equal(requests, 0);
    globalThis.location.search = '?noroadnetwork'; assert.equal(await loadBakedWorldData(map), null); assert.equal(requests, 0);
    globalThis.location.search = ''; assert.equal(await loadBakedWorldData(map), null); assert.equal(requests, 2);
    globalThis.fetch = async () => new Response(gzipSync(Buffer.from('invalid binary')));
    assert.equal(await loadBakedWorldData(map), null); assert.equal(map.terrain.Hc, undefined);
    delete map.data.bakedWorld; assert.equal(await loadBakedWorldData(map), null);
  } finally { globalThis.fetch = previousFetch; console.warn = warn; if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation; }
});

test('split CDN downloads reconstruct the exact geometry; a missing piece falls back cleanly', async () => {
  const terrain = gzipSync(new Uint8Array(encodeGeometryPack({map:'psychiko',grid:1,height:0,source:1,meshes:[]},[new Float32Array([42]),new Float32Array([43])])));
  const roads = gzipSync(new Uint8Array(encodeGeometryPack({map:'psychiko',grid:1,meshes:[]},[new Float32Array([1,2,3])])));
  // Split inside the gzip header and compressed payload, as CDN pieces are not individually gzip files.
  const files = new Map([['/terrain',terrain],['/a',roads.subarray(0,5)],['/b',roads.subarray(5,41)],['/c',roads.subarray(41)]]);
  const map = {id:'psychiko',data:{roadNetwork:{},bakedWorld:{version:1,compression:'gzip',terrain:'/terrain',roads:['/a','/b','/c']}},terrain:{GX:1,GZ:1}};
  const before = globalThis.fetch, warn = console.warn;
  try {
    globalThis.fetch = async path => new Response(files.get(path)||'missing',{status:files.has(path)?200:404});
    const decoded = await loadBakedWorldData(map);
    assert.deepEqual(decoded.terrain.arrays[0],new Float32Array([42]));
    assert.deepEqual(decoded.roads.arrays[0],new Float32Array([1,2,3]));
    files.delete('/b');console.warn=()=>{};
    assert.equal(await loadBakedWorldData(map),null);
    assert.equal(map.terrain.Hc,undefined);
  } finally {globalThis.fetch=before;console.warn=warn;}
});
