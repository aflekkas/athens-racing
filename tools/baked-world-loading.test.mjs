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
for(const corrupt of [false,true])test(`${corrupt?'corrupt':'missing'} release pack falls back to worker before installing any terrain`,()=>isolated(async()=>{
  const {map,terrain,roads,files}=fixture();let created=0,terminated=0;
  globalThis.fetch=async path=>path==='/roads'?new Response(corrupt?'bad gzip':'missing',{status:corrupt?200:404}):new Response(files.get(path));
  globalThis.Worker=class{constructor(){created++;}postMessage(){queueMicrotask(()=>this.onmessage({data:{terrain,roads}}));}terminate(){terminated++;}};
  const result=await loadBakedWorldData(map);
  assert.deepEqual(result.terrain.arrays[0],new Float32Array([42]));assert.equal(created,1);assert.equal(terminated,1);
  assert.equal(assetMetrics.maps.riviera.source,'generated-worker');assert.ok(assetMetrics.maps.riviera.downloadError);assert.equal(map.terrain.Hc,undefined);
}));
test('a stalled download is aborted at the deadline and the worker fallback completes',t=>isolated(async()=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {map,terrain,roads}=fixture();let aborted=0,requests=0;
  globalThis.fetch=async(path,{signal})=>{requests++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(signal.reason);},{once:true}));};
  globalThis.Worker=class{postMessage(){queueMicrotask(()=>this.onmessage({data:{terrain,roads}}));}terminate(){}};
  const pending=loadBakedWorldData(map);await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,2);
  t.mock.timers.tick(45000);assert.ok(await pending);assert.equal(aborted,2);assert.equal(assetMetrics.maps.riviera.downloadError,'World download timed out');
}));
