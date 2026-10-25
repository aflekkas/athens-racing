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

test('shared resource budgets: low-end desktop decode parallelism retains the same hard byte limits', () => {
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
    assert.equal(stream.concurrency, perfClass==='low'?2:1);
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


test('route admission is independent of uncollected V8 garbage; retained world and GPU limits still reject', async () => {
  const {worldResourceUsage,worldResourcesFit}=await import('../src/world-resource-usage.js');
  const MiB=1024*1024,scene={geometryBytes:8*MiB,textureBytes:16*MiB,gpuBytes:24*MiB};
  const retained={scene,tileJS:32*MiB,tileGPU:8*MiB,regionalBytes:4*MiB,width:1280,height:800};
  const fresh=worldResourceUsage({...retained,heapBytes:64*MiB}),beforeGC=worldResourceUsage({...retained,heapBytes:400*MiB});
  assert.equal(fresh.residentJSBytes,beforeGC.residentJSBytes);
  assert.equal(beforeGC.jsBytes,400*MiB,'raw heap remains visible in diagnostics');
  assert.equal(worldResourcesFit(fresh,RESOURCE_BUDGETS.low),true);
  assert.equal(worldResourcesFit(beforeGC,RESOURCE_BUDGETS.low),true,'shader/JSON garbage must not strand the track picker');
  assert.equal(worldResourcesFit(worldResourceUsage({...retained,tileJS:300*MiB}),RESOURCE_BUDGETS.low),false);
  assert.equal(worldResourcesFit(worldResourceUsage({...retained,tileGPU:300*MiB}),RESOURCE_BUDGETS.low),false);
});

// Shared materials are common across streamed props: count resources, not mesh references.
test('memory inventory scans shared material identities once, including repeated material-array entries', () => {
  const texture={isTexture:true,image:{width:2,height:3},generateMipmaps:false};
  let materialScans=0,uniformScans=0;
  const uniforms=new Proxy({map:{value:[texture,texture]}},{ownKeys(target){uniformScans++;return Reflect.ownKeys(target);}});
  const material=new Proxy({map:texture,uniforms},{ownKeys(target){materialScans++;return Reflect.ownKeys(target);}});
  const geometry={attributes:{position:{array:new Float32Array(6)}},index:{array:new Uint16Array(3)}};
  const nodes=[{geometry,material},...Array.from({length:20},()=>({geometry,material:[material,material],visible:false}))];
  const scene={traverse(fn){nodes.forEach(fn);},environment:texture,background:texture};
  const memory=estimateSceneMemory(scene);
  assert.equal(memory.geometryBytes,30);assert.equal(memory.textureBytes,24);assert.equal(memory.gpuBytes,54);
  assert.equal(materialScans,1,'shared material properties must be enumerated once per estimate');
  assert.equal(uniformScans,1,'shared shader uniforms must be enumerated once per estimate');
});

test('memory inventory retains unique materials, compressed and shader textures, hidden resources and instance buffers', () => {
  const shared={isTexture:true,image:{width:2,height:3},generateMipmaps:false};
  const compressed={isTexture:true,isCompressedTexture:true,mipmaps:[{data:new Uint8Array(7)},{data:new Uint8Array(3)}]};
  const cube={isTexture:true,image:[{width:1,height:2},{width:1,height:2}],generateMipmaps:false};
  const ignored={isTexture:true,isRenderTargetTexture:true,image:{width:100,height:100}};
  const geometry={attributes:{position:{array:new Float32Array(6)}},index:{array:new Uint16Array(3)}};
  const matrices={array:new Float32Array(16)},colors={array:new Float32Array(3)};
  const a={map:shared,uniforms:{maps:{value:[shared,compressed,ignored]}}},b={map:shared,uniforms:{cube:{value:cube}}};
  const nodes=[{geometry,material:[a,b,a],instanceMatrix:matrices,visible:false},{geometry,material:b,instanceMatrix:matrices,instanceColor:colors}];
  const memory=estimateSceneMemory({traverse(fn){nodes.forEach(fn);},background:shared,environment:cube});
  assert.equal(memory.geometryBytes,30+64+12);assert.equal(memory.textureBytes,24+10+16);
  assert.equal(memory.gpuBytes,156);
});

test('memory inventory recomputes shared materials and geometry after mutations between calls', () => {
  const texture={isTexture:true,image:{width:2,height:3},generateMipmaps:false};
  const material={uniforms:{map:{value:texture}}},geometry={attributes:{position:{array:new Float32Array(3)}}};
  const nodes=[{material,geometry},{material:[material],geometry,visible:false}];
  const scene={traverse(fn){nodes.forEach(fn);}};
  const first=estimateSceneMemory(scene);
  texture.image={width:4,height:5};geometry.attributes.position.array=new Float32Array(6);
  material.uniforms.extra={value:{isTexture:true,image:{width:1,height:1},generateMipmaps:false}};
  const second=estimateSceneMemory(scene);
  assert.equal(first.geometryBytes,12);assert.equal(first.textureBytes,24);
  assert.equal(second.geometryBytes,24);assert.equal(second.textureBytes,84);
  assert.equal(second.gpuBytes,108);
});


test('shared race/free-roam accounting preserves every retained and transient charge while ignoring stale heap for admission', async () => {
  const { worldResourceUsage, worldResourcesFit } = await import('../src/world-resource-usage.js');
  const MiB = 1024 * 1024, scene = { geometryBytes: 8 * MiB, textureBytes: 8 * MiB, gpuBytes: 16 * MiB };
  const baseline = { scene, tileJS: 16 * MiB, tileGPU: 8 * MiB, regionalBytes: 4 * MiB, queryBytes: 2 * MiB, transientBytes: 3 * MiB, width: 1280, height: 800 };
  const fresh = worldResourceUsage({ ...baseline, heapBytes: 64 * MiB });
  const stale = worldResourceUsage({ ...baseline, heapBytes: 800 * MiB });
  assert.equal(fresh.residentJSBytes, 41 * MiB); assert.equal(stale.residentJSBytes, fresh.residentJSBytes);
  assert.equal(stale.jsBytes, 800 * MiB); assert.equal(stale.heapBytes, 800 * MiB);
  assert.equal(worldResourcesFit(fresh, RESOURCE_BUDGETS.low), true); assert.equal(worldResourcesFit(stale, RESOURCE_BUDGETS.low), true);
  for (const bucket of ['tileJS', 'regionalBytes', 'queryBytes', 'transientBytes']) assert.equal(worldResourcesFit(worldResourceUsage({ ...baseline, [bucket]: 300 * MiB }), RESOURCE_BUDGETS.low), false, bucket);
  assert.equal(worldResourcesFit(worldResourceUsage({ ...baseline, scene: { ...scene, geometryBytes: 300 * MiB } }), RESOURCE_BUDGETS.low), false, 'scene bucket');
  assert.equal(worldResourcesFit(worldResourceUsage({ ...baseline, tileGPU: 300 * MiB }), RESOURCE_BUDGETS.low), false, 'GPU bucket');
  const heldQuery = worldResourceUsage({ ...baseline, queryBytes: 7 * MiB });
  assert.equal(heldQuery.residentJSBytes - fresh.residentJSBytes, 5 * MiB, 'query bytes charged once, not once again for the stream reservation lease');
  for (const invalid of [-1, NaN, Infinity, 1.5]) {
    for (const bucket of ['tileJS', 'regionalBytes', 'queryBytes', 'transientBytes']) assert.throws(() => worldResourceUsage({ ...baseline, [bucket]: invalid }), /Invalid world resource accounting/, bucket);
    assert.equal(worldResourcesFit({ ...fresh, residentJSBytes: invalid }, RESOURCE_BUDGETS.low), false);
    assert.equal(worldResourcesFit(fresh, { ...RESOURCE_BUDGETS.low, jsBytes: invalid }), false);
  }
});
