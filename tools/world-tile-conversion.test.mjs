import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,readFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{resolve}from'node:path';import{gunzipSync}from'node:zlib';import*as THREE from'three';
import{bakeExistingTiles}from'./tile-existing-worlds.mjs';import{decodeGeometryPack}from'../src/baked-geometry.js';import{tileTables}from'../src/world-tile-format.js';import{validateDirectory}from'./validate-world-tiles.mjs';
test('conversion clips active terrain triangles, excludes stored inactive LODs, and validates shared tile edges',async()=>{
 const out=await mkdtemp(resolve(tmpdir(),'awt-conversion-'));
 try{
  const geometry=new THREE.BufferGeometry(),p=[0,0,0,1024,0,0,0,0,1024,1024,0,1024,0,2,0,1024,2,0,0,2,1024,1024,2,1024];
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Array(p.length).fill(.5),3));geometry.setIndex([0,2,1,1,2,3,4,6,5,5,6,7]);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());mesh.userData.terrainLod=[{start:0,count:6},{start:6,count:6}];
  const group=new THREE.Group();group.add(mesh);
  const map={id:'fixture',route:{length:0,start:0,point:()=>({x:10,y:0,z:10})},data:{proj:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700}},definition:{terrainUrl:'fixture'},terrain:{H:new Float32Array(4),height:()=>0,refinedHeight:()=>0}};
  await bakeExistingTiles({map,network:{},terrain:new ArrayBuffer(8),roads:new ArrayBuffer(8),terrainGroup:group,roadsGroup:new THREE.Group()},out);
  const path=resolve(out,'data/tiles/fixture/world.json'),m=JSON.parse(await readFile(path,'utf8'));assert.equal(m.migration.seamFailures,0);assert.equal(Object.keys(m.tiles).length,4);
  for(const e of Object.values(m.tiles)){const raw=gunzipSync(await readFile(resolve(out,'data/tiles/fixture',e.url))),pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),t=tileTables(pack);for(let i=1;i<t.finePositions.length;i+=3)assert.equal(t.finePositions[i],0,'inactive LOD heights must not become contacts');}
  const result=await validateDirectory(path);assert.equal(result.triangles,8);geometry.dispose();mesh.material.dispose();
 }finally{await rm(out,{recursive:true,force:true});}
});


test('vertical road faces on exact tile borders survive render clipping without becoming floor contacts',async()=>{
 const out=await mkdtemp(resolve(tmpdir(),'awt-vertical-'));
 try{
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([512,0,0,512,1,0,512,0,1024,512,1,0,512,1,1024,512,0,1024],3));
  const road=new THREE.Group(),mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());road.add(mesh);
  const map={id:'fixture',route:{length:0,start:0,point:()=>({x:520,y:0,z:10})},data:{proj:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700}},definition:{terrainUrl:'fixture'},terrain:{H:new Float32Array(4),height:()=>0,refinedHeight:()=>0}};
  await bakeExistingTiles({map,network:{},terrain:new ArrayBuffer(8),roads:new ArrayBuffer(8),terrainGroup:new THREE.Group(),roadsGroup:road},out);
  const path=resolve(out,'data/tiles/fixture/world.json'),m=JSON.parse(await readFile(path));assert.equal(Object.keys(m.tiles).length,2);
  for(const entry of Object.values(m.tiles)){const raw=gunzipSync(await readFile(resolve(out,'data/tiles/fixture',entry.url))),pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));assert.equal(tileTables(pack).contactTriangles.length,0);assert(pack.metadata.budgets.triangles>0);}
  await validateDirectory(path);geometry.dispose();mesh.material.dispose();
 }finally{await rm(out,{recursive:true,force:true});}
});


test('shared borders prefer emitted refined terrain over a conflicting coarse underlay',async()=>{
 const out=await mkdtemp(resolve(tmpdir(),'awt-resolution-')),group=new THREE.Group();
 try{
  for(const [x0,x1,y,coarse]of [[0,512,5,true],[512,1024,0,false]]){
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([x0,y,0,x1,y,0,x0,y,512,x1,y,512],3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Array(12).fill(.5),3));geometry.setIndex([0,2,1,1,2,3]);
   const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());if(coarse)mesh.userData.coarseTerrain=true;else mesh.userData.terrainRefinement=8;group.add(mesh);
  }
  const map={id:'fixture',route:{length:0,start:0,point:()=>({x:520,y:0,z:10})},data:{proj:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700}},definition:{terrainUrl:'fixture'},terrain:{T:10,H:new Float32Array(4),height:()=>5,refinedHeight:()=>5}};
  await bakeExistingTiles({map,network:{},terrain:new ArrayBuffer(8),roads:new ArrayBuffer(8),terrainGroup:group,roadsGroup:new THREE.Group()},out);
  const path=resolve(out,'data/tiles/fixture/world.json'),m=JSON.parse(await readFile(path));assert.equal(m.migration.seamFailures,0);
  for(const entry of Object.values(m.tiles)){const raw=gunzipSync(await readFile(resolve(out,'data/tiles/fixture',entry.url))),pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),p=tileTables(pack).finePositions;for(let i=0;i<p.length;i+=3)if(p[i]+pack.metadata.origin[0]===512)assert.equal(p[i+1],0,'fine contact edge takes priority over underlay or ambiguous sampler');}
  await validateDirectory(path);
 }finally{group.traverse(m=>{m.geometry?.dispose();m.material?.dispose();});await rm(out,{recursive:true,force:true});}
});

test('overlapping road fans weld to a common source profile with matching render/contact subdivisions',async()=>{
 const out=await mkdtemp(resolve(tmpdir(),'awt-road-weld-')),terrain=new THREE.Group(),roads=new THREE.Group();
 try{
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,.9,0,1024,.9,0,0,.9,512,1024,.9,512],3));g.setIndex([0,2,1,1,2,3]);terrain.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial()));
  const r=new THREE.BufferGeometry();r.setAttribute('position',new THREE.Float32BufferAttribute([510,1,10,514,1,10,510,1,502,514,1,502,512,.96,255.5,513,.96,254.5,513,.96,256.5],3));r.setAttribute('color',new THREE.Float32BufferAttribute(new Array(21).fill(0),3));r.setIndex([0,2,1,1,2,3,4,5,6]);roads.add(new THREE.Mesh(r,new THREE.MeshBasicMaterial()));
  const map={id:'fixture',route:{length:0,start:0,point:()=>({x:10,y:.9,z:10})},data:{proj:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700}},definition:{terrainUrl:'fixture'},terrain:{H:new Float32Array(4),height:()=>.9,refinedHeight:()=>.9}};
  await bakeExistingTiles({map,network:{baseHeight:()=>1},terrain:new ArrayBuffer(8),roads:new ArrayBuffer(8),terrainGroup:terrain,roadsGroup:roads},out);
  const path=resolve(out,'data/tiles/fixture/world.json'),report=JSON.parse(await readFile(resolve(out,'data/tiles/fixture/report.json')));assert.ok(report.roadWeld.maxAdjustment>.039&&report.roadWeld.maxAdjustment<.041);assert.ok(report.roadWeld.addedTriangles>0);
  await validateDirectory(path);const{validateDirectoryContacts}=await import('./validate-world-tile-contacts.mjs');const sampled=await validateDirectoryContacts(path);assert.equal(sampled.missing,0);assert.deepEqual(sampled.failures,[]);assert.ok(sampled.maxDelta<.00001);
 }finally{for(const group of[terrain,roads])group.traverse(m=>{m.geometry?.dispose();m.material?.dispose();});await rm(out,{recursive:true,force:true});}
});
