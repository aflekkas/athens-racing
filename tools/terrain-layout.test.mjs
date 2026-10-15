import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { compactTerrainGeometry, restoreTerrainLayout } from '../src/terrain-layout.js';
import { buildTerrainLods, buildTerrainPatchLods, installTerrainLods, selectTerrainLod } from '../src/terrain-lod.js';
import { packGroup } from '../src/baked-world-pack.js';
import { decodeGeometryPack } from '../src/baked-geometry.js';
function fixture() {
  const g=new THREE.BufferGeometry(),p=[],c=[],n=[],u=[],ix=[];
  for(let z=0;z<=16;z++)for(let x=0;x<=16;x++){p.push(123.125+x*1.25,100+Math.fround((x+z)*.00021),-432.125+z*1.25);c.push(.3,.4,.5);n.push(0,1,0);u.push(0);}
  for(let z=0;z<16;z++)for(let x=0;x<16;x++){const a=z*17+x;ix.push(a,a+17,a+18,a,a+18,a+1);}
  for(const [name,array,size]of [['position',p,3],['color',c,3],['normal',n,3],['aU',u,1]])g.setAttribute(name,new THREE.Float32BufferAttribute(array,size));g.setIndex(ix);return g;
}
test('integer layout preserves every Float32 position and uses compact normalized attributes',()=>{
  const g=fixture(),source=g.attributes.position.array.slice();compactTerrainGeometry(g,1.25);
  assert.ok(g.attributes.position.array instanceof Uint16Array);assert.ok(g.index.array instanceof Uint16Array);assert.ok(g.attributes.normal.array instanceof Int8Array);
  for(let i=0;i<source.length/3;i++)assert.deepEqual([g.attributes.position.getX(i),g.attributes.position.getY(i),g.attributes.position.getZ(i)],Array.from(source.subarray(i*3,i*3+3)));
  const mesh=new THREE.Mesh(g,new THREE.MeshLambertMaterial());mesh.userData.terrainDecode=g.userData.terrainDecode;restoreTerrainLayout(mesh);
  const sh={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>'};mesh.material.onBeforeCompile(sh);assert.match(sh.vertexShader,/transformed.y \+= aHeightResidual/);
});
test('LOD stitches all boundary vertices, stays Uint16, pins before sampling and survives the pack',()=>{
  const g=compactTerrainGeometry(fixture(),1.25);buildTerrainLods(g);const levels=g.userData.terrainLod;assert.equal(levels.length,4);assert.ok(levels[3].count<levels[0].count);
  const full=new Set(g.index.array.subarray(0,levels[0].count));
  for(const level of levels){const used=new Set(g.index.array.subarray(level.start,level.start+level.count));for(const v of full){const x=v%17,z=Math.floor(v/17);if(x===0||z===0||x===16||z===16)assert.ok(used.has(v));}}
  const mesh=new THREE.Mesh(g,new THREE.MeshLambertMaterial());Object.assign(mesh.userData,{terrainDecode:g.userData.terrainDecode,terrainLod:levels});const group=new THREE.Group();group.add(mesh);const terrain={refinedHeight:()=>100};const chunks=installTerrainLods(terrain,group);
  assert.equal(selectTerrainLod(levels,0,2000,500,'high'),3);assert.equal(selectTerrainLod(levels,3,10,500,'potato'),0);
  g.setDrawRange(levels[3].start,levels[3].count);assert.equal(terrain.refinedHeight(125,-430),100);assert.ok(chunks[0].pinned);assert.equal(g.drawRange.count,levels[0].count);
  const pack=decodeGeometryPack(packGroup(group,{}));assert.deepEqual(pack.metadata.meshes[0].userData,mesh.userData);assert.equal(pack.metadata.meshes[0].drawRange.count,levels[0].count);
});
test('LOD hysteresis and quality thresholds use projected error',()=>{
  const levels=[{error:0},{error:10}];assert.equal(selectTerrainLod(levels,0,1000,300,'high'),0);assert.equal(selectTerrainLod(levels,1,1000,300,'high'),1);assert.equal(selectTerrainLod(levels,0,1000,300,'potato'),1);assert.equal(selectTerrainLod(levels,0,1000,300,'ultra'),0);
});
test('LOD error bounds include diagonal crossings, and near-detail hysteresis has a dead band',()=>{
  const source=fixture(),p=source.attributes.position;
  for(let i=0;i<p.count;i++)p.setY(i,100+Math.sin(i%17*.7)*Math.cos(Math.floor(i/17)*.9)*3);
  const g=compactTerrainGeometry(source,1.25);buildTerrainLods(g);
  const pos=g.attributes.position,indices=g.index.array,levels=g.userData.terrainLod;
  const sample=(level,x,z)=>{for(let k=level.start;k<level.start+level.count;k+=3){const a=indices[k],b=indices[k+1],c=indices[k+2],ax=pos.getX(a),az=pos.getZ(a),bx=pos.getX(b),bz=pos.getZ(b),cx=pos.getX(c),cz=pos.getZ(c),det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz),u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/det,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/det;if(u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8)return u*pos.getY(a)+v*pos.getY(b)+(1-u-v)*pos.getY(c);}throw Error('hole in LOD');};
  for(let z=.125;z<16;z+=.5)for(let x=.125;x<16;x+=.5){const wx=123.125+x*1.25,wz=-432.125+z*1.25,h=sample(levels[0],wx,wz);for(const l of levels.slice(1))assert.ok(Math.abs(sample(l,wx,wz)-h)<=l.error+1e-8);}
  const flat=[{error:0},{error:0}];assert.equal(selectTerrainLod(flat,0,275,500),0);assert.equal(selectTerrainLod(flat,1,275,500),1);
});
test('flat but multicolored ground cannot bypass the visual LOD error budget',()=>{
  const g=fixture();for(let i=0;i<g.attributes.position.count;i++){g.attributes.position.setY(i,100);g.attributes.color.setX(i,i%3===0?.9:.1);}
  compactTerrainGeometry(g,1.25);buildTerrainLods(g);assert.ok(g.userData.terrainLod[1].error>1);
});

test('patch LOD coarsens refined terrain in one draw and contact pins only the sampled patch',()=>{
  const source=fixture(),p=source.attributes.position;
  // Four adjacent copies form one submission chunk, with independent patches.
  const big=new THREE.BufferGeometry(),arrays={position:[],normal:[],color:[],aU:[]},indices=[];
  for(let tile=0;tile<4;tile++){
    for(const [name,a]of Object.entries(source.attributes))for(let i=0;i<a.array.length;i++)arrays[name].push(a.array[i]+(name==='position'&&i%3===0?tile*20:0));
    for(const i of source.index.array)indices.push(i+tile*p.count);
  }
  for(const [name,a]of Object.entries(source.attributes))big.setAttribute(name,new THREE.Float32BufferAttribute(arrays[name],a.itemSize));big.setIndex(indices);
  compactTerrainGeometry(big,1.25);buildTerrainPatchLods(big);
  const mesh=new THREE.Mesh(big,new THREE.MeshLambertMaterial());Object.assign(mesh.userData,big.userData);delete mesh.userData.terrainLodSource;
  const group=new THREE.Group();group.add(mesh);const terrain={refinedHeight:()=>100};installTerrainLods(terrain,group);
  const full=big.index.count,sourceIndices=big.userData.terrainLodSource.slice(),camera=new THREE.PerspectiveCamera();camera.far=10000;camera.updateProjectionMatrix();camera.position.set(1000,1000,1000);camera.lookAt(150,100,-420);camera.updateMatrixWorld();
  const renderer={getDrawingBufferSize:v=>v.set(960,600)};mesh.onBeforeRender(renderer,null,camera);
  assert.ok(big.drawRange.count<full*.5);assert.equal(group.children.length,1);assert.equal(big.drawRange.start,0);
  const before=big.drawRange.count;terrain.refinedHeight(125,-430);mesh.onBeforeRender(renderer,null,camera);
  assert.ok(big.drawRange.count>before&&big.drawRange.count<full*.6);
  assert.equal(mesh.terrainLodState.patches.filter(p=>p.pinned).length,1);
  assert.deepEqual(big.userData.terrainLodSource,sourceIndices);
  const packed=decodeGeometryPack(packGroup(group,{}));assert.deepEqual(packed.arrays[packed.metadata.meshes[0].index],sourceIndices);
  const state=mesh.terrainLodState,range=state.updateRange,index=big.index.array;
  camera.position.set(130,100,-430);camera.updateMatrixWorld();mesh.onBeforeRender(renderer,null,camera);
  assert.equal(big.index.array,index);assert.equal(state.updateRange,range);
  const version=big.index.version;mesh.onBeforeRender(renderer,null,camera);assert.equal(big.index.version,version);
  camera.position.set(1000,1000,1000);camera.lookAt(2000,2000,2000);camera.updateMatrixWorld();mesh.onBeforeRender(renderer,null,camera);
  assert.equal(big.drawRange.count,0,'off-screen patches submit no triangles');
});
