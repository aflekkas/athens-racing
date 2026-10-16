import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fixture } from './world-tile-format.test.mjs';
import { encodeGeometryPack } from '../src/baked-geometry.js';
import { fetchTilePacket } from '../src/world-tile-worker.js';
import { WorldTileScene } from '../src/world-tile-scene.js';

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
