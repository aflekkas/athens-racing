import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeGeometryPack } from '../src/baked-geometry.js';
import { encodeMeshoptPack } from './meshopt-pack.mjs';
import { decodeMeshoptPack } from '../src/meshopt-pack.js';
test('unselected maps and the fresh menu never enable the texture transcoder', async () => {
  const { setAssetCodecMap, textureCodecsEnabled } = await import('../src/asset-metrics.js');
  const previous = globalThis.location;
  try {
    globalThis.location = { search: '?assetcodec=1&bakedownload=1' };
    for (const id of [null, 'megara', 'unmeasured-map']) { setAssetCodecMap(id); assert.equal(textureCodecsEnabled(), false); }
    setAssetCodecMap('riviera'); assert.equal(textureCodecsEnabled(), true);
    globalThis.location = { search: '?assetcodec=1' }; assert.equal(textureCodecsEnabled(), false, 'generated-world startup must not pay for Basis');
    globalThis.location = { search: '' }; assert.equal(textureCodecsEnabled(), false);
  } finally { globalThis.location = previous; setAssetCodecMap(null); }
});
for (const Type of [Float32Array, Float64Array, Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array]) test(`lossless generic meshopt: ${Type.name}, odd lengths, offsets and normalized layouts`, async () => {
  const a = new Type(4099);
  for (let i = 0; i < a.length; i++) a[i] = i % 23 - 11;
  if (Type === Float32Array) new Uint32Array(a.buffer).set([0x7fc01234, 0x80000000], 1); // NaN payload and negative zero.
  const arrays = [a.subarray(1, 4098), new Type(0), new Type([1, 2, 3])];
  const metadata = { meshes: [{ attributes: { normal: { array: 0, itemSize: 3, normalized: true } } }] };
  const bytes = await encodeMeshoptPack(encodeGeometryPack(metadata, arrays)), decoded = await decodeMeshoptPack(bytes.buffer);
  for (let i = 0; i < arrays.length; i++) assert.deepEqual(new Uint8Array(decoded.arrays[i].buffer, decoded.arrays[i].byteOffset, decoded.arrays[i].byteLength), new Uint8Array(arrays[i].buffer, arrays[i].byteOffset, arrays[i].byteLength));
  assert.deepEqual(decoded.arrays, arrays); assert.deepEqual(decoded.metadata.meshes, metadata.meshes);
  await assert.rejects(() => decodeMeshoptPack(bytes.buffer.slice(0, 20)));
});
test('meshopt validates corrupt compressed data', async () => {
  const a = Float32Array.from({length:100000}, (_,i)=>Math.sin(i/100)), bytes = await encodeMeshoptPack(encodeGeometryPack({}, [a]));
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12,12+new DataView(bytes.buffer).getUint32(4,true))));
  assert.ok(meta.views.some(v=>v.codec==='ATTRIBUTES'),'fixture must exercise the compressed decoder');
  const start = new DataView(bytes.buffer).getUint32(8, true); bytes.fill(255, start);
  await assert.rejects(() => decodeMeshoptPack(bytes.buffer));
});

test('ASR2 preserves real map terrain buffers, attribute types, normalized flags and chunk metadata', async () => {
  const { generateMapBake } = await import('./bake-world.mjs');
  const { resolve } = await import('node:path');
  const { decodeGeometryPack } = await import('../src/baked-geometry.js');
  const bake = await generateMapBake(resolve(import.meta.dirname, '..'), 'megara');
  for (const kind of ['terrain', 'roads']) {
    const before = decodeGeometryPack(bake[kind]), bytes = await encodeMeshoptPack(bake[kind]), after = await decodeMeshoptPack(bytes.buffer);
    if(kind==='terrain'){assert.ok(before.metadata.meshes.some(m=>before.arrays[m.attributes.normal.array] instanceof Int8Array));assert.ok(before.metadata.meshes.some(m=>before.arrays[m.attributes.position.array] instanceof Uint16Array || before.arrays[m.attributes.position.array] instanceof Int16Array));console.log('Real prod terrain types:', [...new Set(before.arrays.map(a=>a.constructor.name))].join(','), 'bounds/drawRange/LOD metadata preserved');}
    for (let i = 0; i < before.arrays.length; i++) assert.deepEqual(new Uint8Array(after.arrays[i].buffer, after.arrays[i].byteOffset, after.arrays[i].byteLength), new Uint8Array(before.arrays[i].buffer, before.arrays[i].byteOffset, before.arrays[i].byteLength));
    assert.deepEqual(after.arrays, before.arrays);
    assert.deepEqual(after.metadata.meshes, before.metadata.meshes);
    for (const mesh of before.metadata.meshes) for (const attr of Object.values(mesh.attributes)) {
      assert.equal(after.arrays[attr.array].constructor, before.arrays[attr.array].constructor);
    }
  }
  bake.terrainGroup.traverse(m => m.geometry?.dispose()); bake.roadsGroup.traverse(m => m.geometry?.dispose());
});

test('cached KTX2 candidates have complete mip chains, content-addressed names and stay below the asset limit', async () => {
  const { TEXTURE_MANIFEST, BASIS_TRANSCODER_PATH } = await import('../src/texture-manifest.js');
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const { resolve } = await import('node:path');
  const basis = await Promise.all(['basis_transcoder.js', 'basis_transcoder.wasm'].map(name => readFile(resolve(import.meta.dirname, '..', BASIS_TRANSCODER_PATH.slice(1), name))));
  assert.ok(BASIS_TRANSCODER_PATH.includes(createHash('sha256').update(basis[0]).update(basis[1]).digest('hex').slice(0,16)));
  for (const entry of Object.values(TEXTURE_MANIFEST)) {
    const bytes = await readFile(resolve(import.meta.dirname, '..', entry.url.slice(1)));
    assert.equal(bytes.length, entry.bytes); assert.ok(bytes.length < 25 * 1024 * 1024);
    assert.ok(entry.url.includes(createHash('sha256').update(bytes).digest('hex').slice(0,16)));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.deepEqual([...bytes.subarray(0,12)], [171,75,84,88,32,50,48,187,13,10,26,10]);
    assert.equal(view.getUint32(40,true), Math.floor(Math.log2(Math.max(view.getUint32(20,true),view.getUint32(24,true))))+1);
  }
});

test('streamed loader decodes normalized signed attributes and rejects corrupt packs without partial state', async () => {
  const { loadBakedWorldData } = await import('../src/baked-world-data.js');
  const { gzipSync } = await import('node:zlib');
  const originalFetch = globalThis.fetch, originalLocation = globalThis.location, warn = console.warn;
  const attributes = { position: { array: 2, itemSize: 3, normalized: false }, normal: { array: 3, itemSize: 3, normalized: true } };
  const metadata = { map: 'codec-fixture', grid: 1, height: 0, source: 1, meshes: [{ attributes, userData: { terrainDecode: { version: 1, offset: [3,4,5], scale: [.1,.2,.3] }, terrainLod: [{ start: 0, count: 3, error: 0 }] }, drawRange: { start: 0, count: 3 }, index: 4 }] };
  const arrays = [new Float32Array([2.5]),new Uint8Array([1]),new Int16Array([-3,5,7,12,0,-6,7,8,9]),new Int8Array([-127,0,127,0,127,0,127,0,0]),new Uint16Array([0,1,2])];
  const compact = await encodeMeshoptPack(encodeGeometryPack(metadata, arrays)), bytes = gzipSync(compact);
  const map = { id: metadata.map, data: { roadNetwork: {}, bakedWorld: { version: 1, compression: 'gzip', meshopt: { terrain: '/terrain.meshopt.gz', roads: '/roads.meshopt.gz' } } }, terrain: { GX: 1, GZ: 1 } };
  try {
    globalThis.location = { search: '?assetcodec=1' }; console.warn = () => {};
    globalThis.fetch = async () => new Response(bytes);
    const data = await loadBakedWorldData(map);
    assert.deepEqual(data.terrain.arrays, arrays); assert.deepEqual(data.terrain.metadata.meshes, metadata.meshes);
    globalThis.fetch = async () => new Response(gzipSync(Buffer.from('corrupt')));
    assert.equal(await loadBakedWorldData(map), null); assert.equal(map.terrain.Hc, undefined);
  } finally { globalThis.fetch = originalFetch; globalThis.location = originalLocation; console.warn = warn; }
});
