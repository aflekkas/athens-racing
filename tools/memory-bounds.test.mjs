import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { resolveGraphics, RENDER, RESOURCE_BUDGETS } from '../src/graphics.js';
import { encodeGeometryPack, decodeGeometryPack } from '../src/baked-geometry.js';
import { RoadNetwork } from '../src/road-network-surface.js';
import { estimateSceneMemory } from '../src/asset-metrics.js';
const source = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// Memory and resolution bounds that serve every desktop. (The phone-only parts of this file went with phone support, 2026-10-19:
// docs/plans/desktop-only.md. The low-end desktop budget below is what the former phone cap became.)
test('auto resolution follows the class, an explicit scale and range stay available, and the look never changes', () => {
  for (const perfClass of ['auto', 'potato', 'low', 'med', 'high']) for (const renderScale of ['auto', .5, 1]) {
    const g = resolveGraphics({ perfClass, renderScale }, { deviceRatio: 3 });
    assert(g.pixelRatio <= 2); assert.equal(g.R, RENDER);
  }
  assert.equal(resolveGraphics({ drawDistance: 2000 }).drawDistance, 2000, 'explicit range remains available');
  assert.equal(resolveGraphics({ perfClass: 'high' }, { deviceRatio: 3 }).pixelRatio, 1.5);
  assert.match(source('src/car-select.js'), /setPixelRatio\(Math\.min\(devicePixelRatio \|\| 1, lite \? 1 : 1\.5\)\)/, 'the showroom is capped at 1.5, and at 1 on the lite class');
});

test('shared resource budgets: every class resolves to its own frozen budget, and the low-end desktop classes stay small enough to decode one dense cell', () => {
  const MiB = 1024 * 1024;
  for (const perfClass of ['potato', 'low', 'med', 'high']) {
    const resources = resolveGraphics({ perfClass }).resources;
    assert.equal(resources, RESOURCE_BUDGETS[perfClass]);
    assert(Object.isFrozen(resources)); assert(Object.isFrozen(resources.stream));
    assert(resources.stream.capBytes + resources.stream.transientBytes < resources.jsBytes);
  }
  for (const perfClass of ['potato', 'low']) { // the low-end desktop budget
    const { jsBytes, gpuBytes, stream } = RESOURCE_BUDGETS[perfClass];
    assert(jsBytes <= 256 * MiB); assert(gpuBytes <= 192 * MiB);
    assert.equal(stream.concurrency, 1);
    assert(stream.transientBytes >= 2 * 20 * MiB + 4 * MiB);
  }
});

test('consuming a mixed shuffled pack keeps one backing store with bit-exact values', () => {
  const arrays=[new Float32Array([Math.PI, -1.5, 0, Infinity]), new Uint8Array([1,2,3]), new Float64Array([1.1,3.3])];
  const buffer=encodeGeometryPack({},arrays,[true,false,true]);
  const decoded=decodeGeometryPack(buffer,{consume:true});
  decoded.arrays.forEach((a,i)=>{assert.deepEqual(a,arrays[i]);assert.equal(a.buffer,buffer);});
  const original=encodeGeometryPack({},arrays,[true,false,true]),copy=original.slice(0);decodeGeometryPack(original);assert.deepEqual(original,copy,'default API remains non-destructive');
});

test('road contact index uses compact offsets and preserves triangle order, slope, kerb and gaps', () => {
  const network=Object.create(RoadNetwork.prototype);
  const positions=new Float32Array([0,1,0, 8,3,0, 0,5,8, 0,10,0, 8,10,0, 0,10,8]);
  const col=new Float32Array(18);col[0]=1;
  network.installSurface([{positions,col}]);
  const groups=network.surfaceCells.get('0,0');assert(groups[0].indices instanceof Uint32Array);assert.equal(groups[0].p,positions);assert.deepEqual([...groups[0].indices],[0,9]);
  assert(Math.abs(network.meshHeight(2,2)-(2.5-.14))<1e-6);
  assert.equal(network.meshHeight(7,7),null);assert.equal(network.meshHeight(-1,-1),null);
});

test('memory estimate includes shared shader textures, cube faces and instance buffers once', () => {
  const scene=new THREE.Scene(),texture=new THREE.Texture({width:512,height:512});texture.generateMipmaps=false;
  const geometry=new THREE.BoxGeometry(),material=new THREE.ShaderMaterial({uniforms:{t:{value:texture}}});
  const mesh=new THREE.InstancedMesh(geometry,material,10);scene.add(mesh,new THREE.Mesh(geometry,material));
  const memory=estimateSceneMemory(scene);
  assert.equal(memory.textureBytes,512*512*4);
  assert.equal(memory.geometryBytes,Object.values(geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+geometry.index.array.byteLength+10*16*4);
});
