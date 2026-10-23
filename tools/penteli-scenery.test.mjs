import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {penteliCover,paintPenteli,populatePenteliScenery} from './world-gen/penteli-scenery.mjs';
import {PenteliHouses} from '../src/penteli-houses.js';
import {penteliTerrainMaterial} from '../src/penteli-terrain.js';
const identity={position:p=>p,inverse:p=>p};
const area=(id,x,z,size)=>({id,p:[x,z,x+size,z,x+size,z+size,x,z+size]});
test('mapped quarry outranks woodland; untagged mountain is Mediterranean, never sand',()=>{
 const cover=penteliCover({data:{areas:{wood:[area(1,0,0,1024)],quarry:[area(2,480,40,80)]}}},identity);
 assert.equal(cover(500,50),'quarry');assert.equal(cover(540,50),'quarry');assert.equal(cover(800,500),'wood');assert.equal(cover(1200,500),'default');
 const a=paintPenteli([512,10,50],[0,0,0],cover),b=paintPenteli([0,10,50],[512,0,0],cover);assert.deepEqual(a,b);assert.equal(a[0],4);
});
test('planting owns one cell, avoids the road corridor, and is deterministic',()=>{
 const bake={map:{data:{areas:Object.fromEntries(['wood','scrub','rock','quarry','residential'].map(k=>[k,[]])),buildings:[]},terrain:{height:()=>100},route:{length:512,edge:()=>4}},network:{nearMain:()=>true,project:(x,z)=>({s:z,u:x-256}),candidates:()=>[]}};
 const make=()=>new Map([['0,0',{cell:[0,0],t:{finePositions:[0,100,0,512,100,0,512,100,512,0,100,512],fineTriangles:[0,2,1,0,3,2],contactPositions:[],contactTriangles:[],contactLayers:[],coarseHeights:new Float32Array(1089).fill(100)}}]]);
 const a=make(),b=make();const counts=populatePenteliScenery(bake,a,identity,()=> 'wood');populatePenteliScenery(bake,b,identity,()=> 'wood');
 assert.ok(counts.pine>500);assert.deepEqual(a.get('0,0').penteliTrees,b.get('0,0').penteliTrees);
 const rows=a.get('0,0').penteliTrees;for(let i=0;i<rows.length;i+=5){assert.ok(rows[i]>=2&&rows[i]<510);assert.ok(Math.abs(rows[i]-256)>4+((rows[i+4]>>3)===1?3:1.1)+.39);assert.ok(Math.abs(rows[i+1]-99.88)<.001);}
});
test('infill uses shared instanced Riviera roofs; Off and eviction remove additions',()=>{
 const root=new THREE.Group(),layer=new PenteliHouses(root),packet={metadata:{origin:[512,0,1024],extensions:{worldDetail:{penteliHouses:0}}},arrays:[new Float32Array([100,50,100,0,10,3.4,10])]};
 layer.addTile('1,2',packet);layer.update({position:{x:612,z:1124}});assert.equal(layer.models[0].mesh.count,1);assert.equal(layer.models[0].mesh.geometry.attributes.position.count/3,30);assert.ok(layer.models.every(m=>m.mesh.isInstancedMesh));
 layer.setEnabled(false);assert.equal(layer.group.visible,false);layer.setEnabled(true);layer.removeTile('1,2');layer.update({position:{x:612,z:1124}});assert.equal(layer.models[0].mesh.count,0);layer.dispose();assert.equal(root.children.length,0);
});
test('mountain detail retains the old Off colour, disables inferred sand and exposes rock slopes',()=>{
 const material=penteliTerrainMaterial(),shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>\n#include <worldpos_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>'};material.onBeforeCompile(shader);
 assert.match(shader.fragmentShader,/if\(uWorldDetail<.5\)\{ diffuseColor.rgb=vc;/);assert.match(shader.fragmentShader,/wSand=0./);assert.match(shader.fragmentShader,/wRock=max\(min\(1.,vPColor.a/);material.dispose();
});

test('distant mountain canopy uses one bounded batch, follows its terrain, and clears on eviction',async()=>{
 const {AthensTrees,TREE}=await import('../src/athens-trees.js'),root=new THREE.Group(),layer=new AthensTrees(root),nx=24,nz=24,p=new Float32Array(nx*nz*3),mask=new Uint8Array(nx*nz).fill(1);
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)p.set([x*32,100+x*6.4,z*32],(z*nx+x)*3);
 layer.setMountainForest({metadata:{spacing:32,forest:{array:1,nx,nz,clearanceArray:2}},arrays:[p,mask,new Uint8Array(nx*nz).fill(15)]});layer.rebuild(0,0);const mesh=layer.coastFar.get(TREE.pine).mesh,m=new THREE.Matrix4();assert.ok(mesh.count>1000);assert.ok(mesh.count<=6000);
 for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,m);assert.ok(Math.abs(m.elements[13]-(100+m.elements[12]*.2-.7))<.001);}
 layer.setEnabled(false);assert.equal(layer.group.visible,false);layer.setEnabled(true);layer.setMountainForest(null);layer.rebuild(0,0);assert.equal(mesh.count,0);layer.dispose();assert.equal(root.children.length,0);
});

// Chained hooks must preserve Three's material receiver, including a whole-scene
// compile while the instance batch is empty or hidden.
test('infill compile hook preserves its material receiver across detail changes',async()=>{
 const {settings,setSetting}=await import('../src/settings.js'),old=settings.worldDetail;
 const layer=new PenteliHouses(new THREE.Group()),material=layer.models[0].mesh.material;
 try{
  for(const detail of [true,false,true]){
   setSetting('worldDetail',detail);
   const shader={uniforms:{},vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader};
   assert.doesNotThrow(()=>material.onBeforeCompile(shader,{}));
   assert.match(shader.vertexShader,/attribute float iKind/);
   assert.match(shader.fragmentShader,/vPart/);
  }
 }finally{layer.dispose();setSetting('worldDetail',old);}
});
