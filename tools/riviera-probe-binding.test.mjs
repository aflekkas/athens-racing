import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createHash} from 'node:crypto';
import {tileGPUPlan} from '../src/world-tile-gpu.js';
import {WorldTileScene} from '../src/world-tile-scene.js';
import {bindActiveTileProbe} from './riviera-probe-binding.mjs';
import {pickProbeMeshes} from './riviera-probe-geometry.mjs';
const hash=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
function fixture({terrain=false}={}) {
 const live=new Map();let bound=null,vao=null,n=0;
 const gl={COPY_WRITE_BUFFER:36663,COPY_WRITE_BUFFER_BINDING:36663,STATIC_DRAW:35044,FLOAT:5126,UNSIGNED_BYTE:5121,BYTE:5120,UNSIGNED_SHORT:5123,SHORT:5122,UNSIGNED_INT:5125,INT:5124,ELEMENT_ARRAY_BUFFER:34963,VERTEX_ARRAY_BINDING:34229,
 createBuffer(){const b={n:++n};live.set(b,null);return b;},getParameter(t){return t===this.VERTEX_ARRAY_BINDING?vao:bound;},createVertexArray(){return {};},bindVertexArray(v){vao=v;},deleteVertexArray(){},bindBuffer(t,b){if(t!==this.ELEMENT_ARRAY_BUFFER)bound=b;},bufferData(t,size){live.set(bound,new Uint8Array(size));},bufferSubData(t,offset,a){live.get(bound).set(a,offset);},deleteBuffer(b){live.delete(b);}};
 const backing=new ArrayBuffer(128),position=terrain?new Uint16Array(backing,8,9):new Float32Array(backing,16,9);
 position.set(terrain?[0,0,0,2,0,0,1,2,0]:[-1,-1,-5,1,-1,-5,0,1,-5]);
 const ib=new ArrayBuffer(16),index=new Uint16Array(ib,2,3);index.set([0,1,2]);
 const arrays=[position,index,new Uint8Array(9).fill(128)];
 const attrs={position:{array:0,itemSize:3,normalized:false},color:{array:2,itemSize:3,normalized:true}},userData={tileSurface:'basic'};
 if(terrain){attrs.aHeightResidual={array:3,itemSize:1,normalized:false};arrays.push(new Float32Array(3));userData.terrainDecode={version:1,offset:[-1,-1,-5],scale:[1,1,1]};}
 const m={name:'probe',attributes:attrs,index:1,material:0,userData,bounds:{box:[-1,-1,-5,1,1,-5],sphere:[0,0,-5,2]},drawRange:{start:0,count:3}};
 const packet={metadata:{world:'athens-source',revision:'b'.repeat(64),cell:[0,0],origin:[0,0,0],palette:[[.5,.5,.5]],meshes:[structuredClone(m),structuredClone(m)]},arrays};packet.gpuPlan=tileGPUPlan(packet);
 const adapter=new WorldTileScene(new T.Scene(),{renderer:{getContext:()=>gl},uploadChunkBytes:64});
 const build=adapter.prepare('0,0',packet,{x:0,z:0});for(const s of build.steps)void s;const handle=build.commit();
 const entry={sha256:'c'.repeat(64),source:{world:packet.metadata.world,revision:packet.metadata.revision}};
 const tile={state:'active',generation:4,packet,handle},stream={disposed:false,origin:{x:0,z:0},manifest:{world:'athens',revision:'a'.repeat(64)},entry:k=>k==='0,0'?entry:null,tiles:new Map([['0,0',tile]])};
 const expected={worldId:'athens',worldSetRevision:'a'.repeat(64),cellSha256:entry.sha256,sourceWorld:entry.source.world,sourceRevision:entry.source.revision};
 return {packet,stream,tile,entry,expected,handle,adapter,live,close(){handle.dispose();adapter.dispose();assert.equal(live.size,0);}};
}
const bind=f=>bindActiveTileProbe({stream:f.stream,key:'0,0',expected:f.expected});
for(const terrain of [false,true])test(`native compact upload-plan parity, array offsets/index/terrain=${terrain}, no source or GL mutation`,async()=>{
 const f=fixture({terrain});try{
  const before=f.packet.arrays.map(hash),count=f.live.size,b=await bind(f),mesh=f.handle.root.children[0];
  assert.equal(mesh.geometry.index.isGLBufferAttribute,true);assert.equal(mesh.geometry.index.array,undefined);
  for(const row of b.receipt.arrays){assert.equal(row.sha256,hash(f.packet.arrays[row.packetArray]));}
  for(const m of b.receipt.meshes)for(const a of m.layouts){const g=f.handle.root.children[m.meshIndex].geometry,actual=a.label==='index'?g.index:g.attributes[a.label],uploaded=f.live.get(actual.buffer);assert.deepEqual(uploaded,new Uint8Array(f.packet.arrays[a.packetArray].buffer,a.byteOffset,a.byteLength));assert.equal(a.gpuUploadByteOffset,0);}
  const positions=b.receipt.meshes[0].layouts.find(a=>a.label==='position');assert.equal(positions.byteOffset,terrain?8:16);assert.equal(b.receipt.meshes[0].layouts.find(a=>a.label==='index').byteOffset,2);
  const camera=new T.PerspectiveCamera(60,1.6,.1,100);camera.updateMatrixWorld(true);
  const r=pickProbeMeshes({objects:f.handle.root.children,camera,pixel:[640,400],viewport:[1280,800],wrapMesh:m=>b.wrap(m)});assert.equal(r.complete,true);assert.equal(r.hits.length,2);assert.deepEqual(r.hits[0].worldXYZ,[0,0,-5]);assert.deepEqual(r.hits[0].projectedPixel,[640,400]);
  await b.assertArrayBytesUnchanged();assert.deepEqual(f.packet.arrays.map(hash),before);assert.equal(f.live.size,count);assert.equal(mesh.geometry.index.isGLBufferAttribute,true);
 }finally{f.close();}
});
test('source SHA/world/cell/revision and GPU plan mismatches fail before owner binding',async()=>{
 for(const mutate of [f=>f.expected.cellSha256='d'.repeat(64),f=>f.expected.sourceWorld='other',f=>f.packet.metadata.cell=[1,0],f=>f.packet.metadata.revision='old',f=>f.packet.gpuPlan.meshes[0].index='foreign',f=>{f.handle.root.position.x=1;f.handle.root.updateMatrixWorld(true)}]){
  const f=fixture();try{mutate(f);await assert.rejects(bind(f),/mismatch/);}finally{f.close();}
 }
});
test('render GL itemsize/type/count/normalization/index/view and shared-identity mismatches fail closed',async()=>{
 const changes=[f=>f.handle.root.children[0].geometry.attributes.position.itemSize=2,f=>f.handle.root.children[0].geometry.attributes.position.type=5123,f=>f.handle.root.children[0].geometry.index.count=2,f=>f.handle.root.children[0].geometry.attributes.color.normalized=false,f=>f.handle.root.children[1].geometry.index=new T.GLBufferAttribute({},5123,1,2,3),f=>f.packet.arrays[0]=new Float32Array(8)];
 for(const mutate of changes){const f=fixture();try{mutate(f);await assert.rejects(bind(f),/mismatch/);}finally{f.close();}}
});
test('stale tile/packet/handle, changed matrix/material/layers/groups/drawrange and replaced arrays are rejected',async()=>{
 const changes=[f=>f.tile.packet={...f.packet},f=>f.tile.generation++,f=>f.tile.state='preparing',f=>f.tile.handle={root:new T.Group()},f=>f.handle.root.children[0].matrixWorld.elements[12]++,f=>f.handle.root.children[0].material.side=T.BackSide,f=>f.handle.root.children[0].layers.set(3),f=>f.handle.root.children[0].geometry.addGroup(0,3,0),f=>f.handle.root.children[0].geometry.drawRange.count=0,f=>f.packet.arrays[0]=f.packet.arrays[0].slice(),f=>f.handle.root.children[0].geometry.index.count=1,f=>f.handle.root.children[0].geometry.attributes.position.setBuffer({})];
 for(const mutate of changes){const f=fixture();try{const b=await bind(f);mutate(f);assert.throws(()=>b.assertStable(),/stale/);}finally{f.close();}}
});
test('in-place CPU array edits are detected by post-pick digest audit',async()=>{
 const f=fixture();try{const b=await bind(f);f.packet.arrays[0][0]+=1;await assert.rejects(b.assertArrayBytesUnchanged(),/content changed/);}finally{f.close();}
});
test('unbound unsupported foreground cannot be skipped to a farther bound hit',async()=>{
 const f=fixture();try{const b=await bind(f),foreign=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());foreign.position.z=-2;foreign.updateMatrixWorld(true);const camera=new T.PerspectiveCamera(60,1.6,.1,100);camera.updateMatrixWorld(true);const r=pickProbeMeshes({objects:[...f.handle.root.children,foreign],camera,pixel:[640,400],viewport:[1280,800],wrapMesh:m=>b.wrap(m)});assert.equal(r.complete,false);assert.deepEqual(r.hits,[]);assert.equal(r.partialCandidateCount,2);assert.match(r.unsupported[0].reason,/outside authenticated/);}finally{f.close();}
});
