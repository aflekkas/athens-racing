import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fixture } from './world-tile-format.test.mjs';
import { encodeGeometryPack } from '../src/baked-geometry.js';
import { fetchTilePacket } from '../src/world-tile-worker.js';
import { WorldTileScene } from '../src/world-tile-scene.js';
test('shared Megara origin uniforms warm once per actual vertex layout and surface program',async()=>{
 const adapter=new WorldTileScene(new THREE.Scene(),{renderer:{}}),batches=[];adapter.warmVariantBatch=async variants=>batches.push(variants);
 const variant=(surface,attributes={position:{type:'Float32Array',itemSize:3,normalized:false}})=>{const v={surface,attributes,index:'Uint16Array',terrain:false};return {...v,key:JSON.stringify(v)};};
 const a=variant('megaraAsphalt@-64,-2'),b=variant('megaraAsphalt@-63,-2');await adapter.prewarm([a,b]);assert.equal(batches.length,1);assert.equal(batches[0].length,1);await adapter.warmup({renderVariants:[a,b]});assert.equal(batches.length,1);
 adapter.startupComplete=false;await adapter.warmVariants([variant('megaraWornAsphalt@-63,-2'),variant('megaraAsphalt@-63,-2',{position:{type:'Uint16Array',itemSize:3,normalized:false}})]);assert.equal(batches[1].length,2,'different programs and vertex layouts must still warm');adapter.dispose();
});

test('shared plain/quantized attributes and indices allocate one GPU buffer per worker-accounted identity',async()=>{
 const originalFetch=globalThis.fetch;
 try{
  for(const quantized of [false,true]){
   const p=fixture(),m=p.metadata,a=p.arrays,positions=[0,0,0,512,0,0,0,0,512,512,0,512];
   a[m.tables.finePositions]=new Float32Array(positions);a[m.tables.fineTriangles]=new Uint32Array([0,2,1,1,2,3]);
   const index=a.length;a.push(new Uint16Array([0,2,1,1,2,3]));
   const attributes={position:{array:m.tables.finePositions,itemSize:3,normalized:false}},userData={};
   if(quantized){attributes.position.array=a.length;a.push(new Uint16Array(positions));attributes.aHeightResidual={array:a.length,itemSize:1,normalized:false};a.push(new Float32Array(4));userData.terrainDecode={version:1,offset:[0,0,0],scale:[1,1,1]};}
   m.meshes=[0,1].map(()=>({attributes:structuredClone(attributes),index,material:0,userData:structuredClone(userData)}));m.budgets.triangles=4;
   if(quantized){const distinct=structuredClone(m.meshes[0]);distinct.userData.terrainDecode.offset[1]=1;m.meshes.push(distinct);m.budgets.triangles=6;}
   const body=gzipSync(new Uint8Array(encodeGeometryPack(m,a,a.map(()=>true))));globalThis.fetch=async()=>new Response(body);
   const packet=await fetchTilePacket({url:'http://local/tile',world:m.world,revision:m.revision,cell:m.cell,entry:{bytes:body.length,decodedBytes:1024*1024,triangles:m.budgets.triangles,sha256:createHash('sha256').update(body).digest('hex')}});
   const expected=a[index].byteLength+Object.values(attributes).reduce((sum,attr)=>sum+a[attr.array].byteLength,0)+(quantized?a[attributes.position.array].byteLength:0);assert.equal(packet.gpuBytes,expected);
   const scene=new THREE.Scene(),adapter=new WorldTileScene(scene),build=adapter.prepare('0,0',packet,{x:0,z:0});for(const step of build.steps)void step;const handle=build.commit(),[first,second]=handle.root.children;
   assert.equal(first.geometry.index,second.geometry.index,'a shared EBO must not be uploaded twice');assert.equal(first.geometry.attributes.position,second.geometry.attributes.position,'decoded terrain wrappers share their GPU allocation');
   if(quantized){const third=handle.root.children[2];assert.notEqual(first.geometry.attributes.position,third.geometry.attributes.position,'different terrain decodes require separate GPU position bindings');assert.equal(first.geometry.index,third.geometry.index);}
   handle.dispose();build.dispose();assert.equal(adapter.resources.entries.size,0);assert.equal(adapter.groups.size,0);
  }
 }finally{globalThis.fetch=originalFetch;}
});

test('GPU buffer uploads yield in bounded chunks and cancellation releases allocations before first render',()=>{
 const live=new Map(),writes=[],elementBuffers=new Set();let bound=null,next=0,vao=null;
 const gl={COPY_WRITE_BUFFER:1,COPY_WRITE_BUFFER_BINDING:2,STATIC_DRAW:3,FLOAT:4,UNSIGNED_SHORT:5,ELEMENT_ARRAY_BUFFER:6,VERTEX_ARRAY_BINDING:7,
  createBuffer(){const b=++next;live.set(b,null);return b;},getParameter(target){return target===this.VERTEX_ARRAY_BINDING?vao:bound;},createVertexArray(){return {};},bindVertexArray(value){vao=value;},deleteVertexArray(){},bindBuffer(target,buffer){if(target===this.ELEMENT_ARRAY_BUFFER){assert.ok(vao,'EBO classification must not mutate the render VAO');elementBuffers.add(buffer);}else bound=buffer;},
  bufferData(_,size){live.set(bound,new Uint8Array(size));},bufferSubData(_,offset,bytes){writes.push(bytes.length);live.get(bound).set(bytes,offset);},deleteBuffer(buffer){assert.ok(live.delete(buffer),'allocation must be released exactly once');}};
 const p=fixture(),position=p.arrays.length;p.arrays.push(new Float32Array(60000*3));p.arrays[position][100]=42;
 const index=p.arrays.length;p.arrays.push(new Uint16Array([0,1,2]));p.metadata.meshes=[{attributes:{position:{array:position,itemSize:3}},index,material:0,bounds:{box:[0,0,0,1,1,1],sphere:[0,0,0,2]}}];
 const adapter=new WorldTileScene(new THREE.Scene(),{renderer:{getContext:()=>gl},uploadChunkBytes:32768});
 const cancelled=adapter.prepare('0,0',p,{x:0,z:0});cancelled.steps.next();cancelled.steps.next();assert.equal(live.size,1);cancelled.dispose();cancelled.dispose();assert.equal(live.size,0);
 const build=adapter.prepare('0,0',p,{x:0,z:0});let steps=0;for(const step of build.steps){steps++;void step;}
 assert.ok(steps>20,'large buffer must span many activation steps');assert.ok(Math.max(...writes)<=32768);assert.equal(bound,null,'uploader must restore the GL copy-buffer binding');
 const handle=build.commit(),mesh=handle.root.children[0];assert.ok(mesh.geometry.attributes.position.isGLBufferAttribute);assert.ok(elementBuffers.has(mesh.geometry.index.buffer),'index buffers must be classified before COPY_WRITE uploads');assert.equal(vao,null);assert.equal(new Float32Array(live.get(mesh.geometry.attributes.position.buffer).buffer)[100],42);
 handle.dispose();assert.equal(live.size,0);assert.equal(adapter.uploadMetrics.liveBuffers,0);adapter.dispose();
});
