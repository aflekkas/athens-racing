import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { loadBakedWorldData } from '../src/baked-world-data.js';
import { encodeGeometryPack } from '../src/baked-geometry.js';
import { assetMetrics } from '../src/asset-metrics.js';

function fixture() {
  const terrain = encodeGeometryPack({ map:'riviera', grid:1, height:0, source:1, meshes:[] }, [new Float32Array([42]),new Float32Array([43])]);
  const roads = encodeGeometryPack({ map:'riviera', grid:1, meshes:[] }, [new Float32Array([1,2,3])]);
  const map = { id:'riviera', terrain:{GX:1,GZ:1}, data:{roadNetwork:{}, bakedWorld:{version:1,compression:'gzip',worker:'/world.js',terrain:'/terrain',roads:'/roads'}} };
  return { map, terrain, roads, files:new Map([['/terrain',gzipSync(new Uint8Array(terrain))],['/roads',gzipSync(new Uint8Array(roads))]]) };
}
async function isolated(fn) {
  const names = ['fetch','Worker','indexedDB','localStorage','location'];
  const previous = names.map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)]);
  try {
    globalThis.location={search:''}; globalThis.localStorage={getItem:()=>null};
    globalThis.indexedDB={open(){throw Error('optional storage unavailable');}};
    await fn();
  } finally { for(const [name,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]; }
}
test('cold load starts both release downloads without generating a world; progress counts actual bytes', () => isolated(async()=>{
  const {map,files}=fixture(),requested=[],phases=[]; let release;
  const gate=new Promise(resolve=>{release=resolve;});
  globalThis.Worker=class{constructor(){assert.fail('cold load must download before generating');}};
  globalThis.fetch=async(path,{signal})=>{requested.push(path);assert.ok(signal instanceof AbortSignal);await gate;return new Response(files.get(path));};
  const pending=loadBakedWorldData(map,(text,fraction)=>phases.push([text,fraction]));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(requested,['/terrain','/roads'],'terrain and roads start in parallel');release();
  const result=await pending;
  assert.deepEqual(result.terrain.arrays[0],new Float32Array([42]));
  assert.deepEqual(result.roads.arrays[0],new Float32Array([1,2,3]));
  assert.equal(assetMetrics.maps.riviera.source,'download');
  assert.equal(assetMetrics.maps.riviera.downloadBytes,[...files.values()].reduce((n,b)=>n+b.length,0));
  assert.ok(phases.some(([text])=>text.includes('MB')));assert.deepEqual(phases.at(-1),['TERRAIN + ROADS READY',.33]);
  assert.equal(map.terrain.Hc,undefined,'loading buffers never mutates wheel surfaces');
}));
test('an idle network pauses recoverably; retry continues the original load without CPU generation',t=>isolated(async()=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {map,files}=fixture();let failed,requests=0,stall=true,created=0;
  globalThis.fetch=async(path,{signal})=>{requests++;if(!stall)return new Response(files.get(path));return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
  globalThis.Worker=class{constructor(){created++;assert.fail('network failure must not start generation');}};
  const pending=loadBakedWorldData(map,(text,fraction,detail)=>{if(detail.phase==='failed')failed=detail;},{idleMs:100});
  await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(100);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(failed.error.code,'timeout');assert.equal(created,0);assert.equal(typeof failed.retry,'function');assert.equal(typeof failed.fallback,'function');
  t.mock.timers.reset();stall=false;failed.retry();const result=await pending;assert.ok(result);assert.equal(assetMetrics.maps.riviera.source,'download');assert.equal(created,0);assert.equal(requests,4);
}));
test('generation requires an explicit recovery choice and reports real worker progress',()=>isolated(async()=>{
  const {map,terrain,roads}=fixture();let created=0,failed;const stages=[];
  globalThis.fetch=async()=>new Response('missing',{status:404});
  globalThis.Worker=class{constructor(){created++;}postMessage(){queueMicrotask(()=>{this.onmessage({data:{type:'progress',stage:'terrain',step:1,steps:4}});this.onmessage({data:{terrain,roads}});});}terminate(){}};
  const pending=loadBakedWorldData(map,(text,fraction,detail)=>{if(detail.phase==='failed')failed=detail;if(detail.phase==='generate')stages.push(detail.stage);});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(created,0);assert.equal(failed.error.code,'http');failed.fallback();assert.ok(await pending);assert.equal(created,1);assert.ok(stages.includes('terrain'));
}));
test('corrupt generated cache is invalidated and replaced by verified downloads',()=>isolated(async()=>{
 const {map,files}=fixture(),version=`${map.data.bakedWorld.terrain}|${map.data.bakedWorld.roads}|${map.data.bakedWorld.worker}`;let removed=0,deleted=0,requests=0;
 globalThis.Worker=class{constructor(){assert.fail('corrupt cache must not start generation');}};
 globalThis.localStorage={getItem:()=>version,removeItem(){removed++;}};
 globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result={close(){},transaction(){return{objectStore(){return{get(){const req={};queueMicrotask(()=>{req.result={version,buffers:{terrain:new ArrayBuffer(4),roads:new ArrayBuffer(4)}};req.onsuccess();});return req;},delete(){deleted++;}};}};}};request.onsuccess();});return request;}};
 globalThis.fetch=async path=>{requests++;return new Response(files.get(path));};
 const result=await loadBakedWorldData(map,()=>{});assert.deepEqual(result.terrain.arrays[0],new Float32Array([42]));assert.equal(requests,2);assert.equal(removed,1);assert.equal(deleted,1);assert.equal(assetMetrics.maps.riviera.source,'download');
}));
