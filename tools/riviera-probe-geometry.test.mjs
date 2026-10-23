import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {wrapProbeMesh, pickProbeMeshes, cameraNeighborhoodReceipt} from './riviera-probe-geometry.mjs';
const viewport = [1280,800], pixel = [640,400];
function fixture() {
 const geometry = new T.BufferGeometry(), positions = new Float32Array([-1,-1,0,1,-1,0,0,1,0]), indices = new Uint16Array([0,1,2]);
 // The compact plain descriptors intentionally have no getX/getY/getZ methods.
 geometry.attributes.position = {array:positions,itemSize:3,normalized:false,count:3};
 geometry.index = {array:indices,itemSize:1,normalized:false,count:3};
 const mesh = new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.FrontSide}));mesh.name='compact';mesh.position.z=-5;mesh.updateMatrixWorld(true);
 const camera=new T.PerspectiveCamera(60,1.6,.1,100);camera.updateMatrixWorld(true);
 return {mesh,camera,positions,indices};
}
const pick = (f, objects=[f.mesh]) => pickProbeMeshes({objects,camera:f.camera,pixel,viewport,origin:{x:5632,z:19456}});
test('compact indexed negative control fails, CPU wrapper hits and projects exact triangle without mutation',()=>{
 const f=fixture(), before=Array.from(f.positions), index=f.mesh.geometry.index, attrs=f.mesh.geometry.attributes;
 const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(0,0),f.camera);
 assert.throws(()=>ray.intersectObject(f.mesh),/getX/);
 let disposed=0;f.mesh.geometry.addEventListener('dispose',()=>disposed++);f.mesh.material.addEventListener('dispose',()=>disposed++);
 const w=wrapProbeMesh(f.mesh);assert.equal(w.proxy.geometry.attributes.position.array,f.positions);assert.equal(w.proxy.geometry.index.array,f.indices);w.dispose();
 const r=pick(f);assert.equal(r.complete,true);assert.equal(r.hits.length,1);assert.equal(r.hits[0].faceIndex,0);assert.deepEqual(r.hits[0].worldXYZ,[5632,0,19451]);assert.deepEqual(r.hits[0].projectedPixel,pixel);assert.deepEqual(r.hits[0].vertices,[[5631,-1,19451],[5633,-1,19451],[5632,1,19451]]);
 assert.deepEqual(Array.from(f.positions),before);assert.equal(f.mesh.geometry.index,index);assert.equal(f.mesh.geometry.attributes,attrs);assert.equal(disposed,0);
});
test('matrixWorld is retained; back/front/double sided materials, visibility and layers match source',()=>{
 const f=fixture();f.mesh.rotation.y=Math.PI;f.mesh.updateMatrixWorld(true);assert.equal(pick(f).hits.length,0);
 f.mesh.material.side=T.BackSide;assert.equal(pick(f).hits.length,1);f.mesh.material.side=T.DoubleSide;assert.equal(pick(f).hits.length,1);
 const parent=new T.Group();parent.add(f.mesh);parent.visible=false;assert.equal(pick(f).hits.length,0);parent.visible=true;f.mesh.layers.set(2);assert.equal(pick(f).hits.length,0);f.camera.layers.set(2);assert.equal(pick(f).hits.length,1);
});
test('draw range and indexed material group side are respected',()=>{
 const f=fixture();f.mesh.geometry.setDrawRange(0,0);assert.equal(pick(f).hits.length,0);f.mesh.geometry.setDrawRange(0,3);
 f.mesh.material=[new T.MeshBasicMaterial({side:T.BackSide}),new T.MeshBasicMaterial({side:T.FrontSide})];f.mesh.geometry.addGroup(0,3,1);assert.equal(pick(f).hits[0].materialIndex,1);
});
test('interleaved position array is shared read-only and normalized colour retained',()=>{
 const f=fixture(), a=new Float32Array([-1,-1,0,7,1,-1,0,7,0,1,0,7]);f.mesh.geometry.attributes.position=new T.InterleavedBufferAttribute(new T.InterleavedBuffer(a,4),3,0);
 f.mesh.geometry.attributes.color={array:new Uint8Array(9).fill(128),itemSize:3,normalized:true};
 const w=wrapProbeMesh(f.mesh);assert.equal(w.proxy.geometry.attributes.position.data.array,a);assert.equal(w.proxy.geometry.attributes.color.normalized,true);w.dispose();assert.equal(pick(f).hits.length,1);assert.equal(a[3],7);
});
test('terrain quantization and residual decode use the render contract, not raw integer coordinates',()=>{
 const f=fixture();f.mesh.geometry.attributes.position={array:new Uint16Array([0,0,0,2,0,0,1,2,0]),itemSize:3,normalized:false};f.mesh.geometry.attributes.aHeightResidual={array:new Float32Array(3),itemSize:1};f.mesh.userData.terrainDecode={version:1,offset:[-1,-1,0],scale:[1,1,1]};
 assert.equal(pick(f).hits.length,1);assert.deepEqual(pick(f).hits[0].worldXYZ,[5632,0,19451]);
});
test('unsupported GPU-only/instanced/skinned/morph/custom shader cannot be skipped into horizon classification',()=>{
 for(const kind of ['gpu','instanced','skinned','morph','shader']){const f=fixture(), unsupported=fixture().mesh;unsupported.name=kind;
 if(kind==='gpu')unsupported.geometry.index={isGLBufferAttribute:true,itemSize:1,count:3};if(kind==='instanced')unsupported.isInstancedMesh=true;if(kind==='skinned')unsupported.isSkinnedMesh=true;if(kind==='morph')unsupported.geometry.morphAttributes.position=[{}];if(kind==='shader')unsupported.material=new T.ShaderMaterial();
 const r=pick(f,[f.mesh,unsupported]);assert.equal(r.complete,false,kind);assert.equal(r.unsupported.length,1,kind);assert.deepEqual(r.hits,[],kind);assert.equal(r.partialCandidateCount,1,kind);
 }
});
test('stale camera matrix is rejected and off-centre ray projects to the requested pixel',()=>{
 const f=fixture();f.camera.position.x=.2;assert.throws(()=>pick(f),/matrixWorld stale/);f.camera.updateMatrixWorld(true);
 const r=pickProbeMeshes({objects:[f.mesh],camera:f.camera,pixel:[650,410],viewport});assert.equal(r.hits.length,1);assert.ok(r.hits[0].projectionErrorPx<1e-8);
});

test('camera context receipt requires all nine authenticated active cells and dependencies',()=>{
 const entries=new Map(), tiles=new Map();for(let x=-2;x<=0;x++)for(let z=20;z<=22;z++){const key=`${x},${z}`;entries.set(key,{sha256:'a'.repeat(64)});tiles.set(key,{state:'active'});}
 const stream={entry:k=>entries.get(k),tiles,dependencies:k=>new Set([k]),origin:{x:-512,z:12800},position:{x:-180,z:10765}};
 let r=cameraNeighborhoodReceipt(stream,{x:-180,z:10765},{x:-181,z:10764});assert.equal(r.completeNine,true);assert.ok(r.cameraToPlayerM<2);assert.deepEqual(r.origin,{x:-512,z:12800});
 tiles.get('-1,21').state='preparing';assert.equal(cameraNeighborhoodReceipt(stream,{x:-180,z:10765},null).completeNine,false);tiles.get('-1,21').state='active';entries.delete('-2,20');assert.equal(cameraNeighborhoodReceipt(stream,{x:-180,z:10765},null).completeNine,false);
});
test('actual initial-spawn to Tower stream focus reproduces observed origin without a distant player',async()=>{
 const {WorldTileStream}=await import('../src/world-tile-stream.js');
 const manifest={tileVersion:1,tileMetres:512,world:'athens',revision:'test',projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700},spawn:{cell:[-1,21],anchor:'spawn:0'},tiles:{'-1,21':{url:'a.bin.gz',sha256:'0'.repeat(64),bytes:10,decodedBytes:100,dependencies:[],triangles:0}}};
 const s=new WorldTileStream(manifest,{load:()=>{throw Error('must not load')},concurrency:0,pinSpawn:false,nearRing:0});
 try{s.update({x:2304,z:13056});assert.deepEqual(s.origin,{x:2048,z:12800});s.update({x:-180.00943192260831,z:10765.144939999354});assert.deepEqual(s.origin,{x:-512,z:12800});assert.equal(s.position.z,10765.144939999354);assert.equal(s.tiles.size,0);}finally{s.dispose();}
});

test('material-hidden triangles are excluded; transparency/discard/displacement fail closed',()=>{
 const f=fixture();f.mesh.material.visible=false;assert.equal(pick(f).hits.length,0);f.mesh.material.visible=true;
 for(const change of [m=>m.transparent=true,m=>m.alphaTest=.5,m=>m.displacementMap={}]){const a=fixture();change(a.mesh.material);const r=pick(a);assert.equal(r.complete,false);assert.deepEqual(r.hits,[]);}
});
