import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {vegetationContactIndex,circleIntersectsTriangle,filterStreetVegetation,vegetationRadius,streetTreeHeight,clearPacketVegetation,psychikoVegetationRadius} from '../src/vegetation-clearance.js';
import {assertVegetationClearance,clearForestCell,forestByCell} from './audit-world-vegetation.mjs';
import {forestCandidates,forestRadius} from '../src/vegetation-forest.js';
import {AthensTrees,TREE} from '../src/athens-trees.js';
import {fadeMergedVegetation} from '../src/vegetation-fade.js';
const t={contactPositions:new Float32Array([100,0,20,112,0,20,112,0,490,100,0,490,200,20,100,240,20,100,220,20,130]),contactTriangles:new Uint32Array([0,1,2,2,1,0,2,3,2,1,4,5,6,8,1]),finePositions:new Float32Array([300,0,100,330,0,100,315,0,160]),fineTriangles:new Uint32Array([0,1,2]),fineFlags:new Uint8Array([1])};
test('clearance uses full shoulder/lay-by triangles, classic flags column 4, compact contacts and elevated layers',()=>{
 const q=vegetationContactIndex(t);assert.equal(q.clear(115,80,4),false);assert.equal(q.clear(220,115,2),false);assert.equal(q.clear(315,130,2),false);assert.equal(q.clear(140,80,4),true);
 // A surface ID with its low bit set is not itself drivable.
 assert.equal(vegetationContactIndex({...t,contactTriangles:new Uint32Array([0,1,2,1,2]),fineFlags:new Uint8Array([2])}).clear(105,100,4),true);
});
test('continuous footprint intersection catches thin corners between point probes and rejects neighbouring ownership',()=>{
 assert.equal(circleIntersectsTriangle(0,0,2,[1.2,1.2],[9,1.21],[9,1.22]),true);
 assert.equal(circleIntersectsTriangle(0,0,1,[1.2,1.2],[9,1.21],[9,1.22]),false);
 assert.equal(vegetationContactIndex(t).clear(510,250,4),false);
});
test('shrubs and the largest leaning pine crowns carry their required margins; audit fails unsafe wire rows',()=>{
 const rows=new Float32Array([115,0,80,0,39,130,0,80,0,15,180,0,80,0,15]);
 const packet={metadata:{extensions:{worldDetail:{penteli:true,streetTrees:0,coastalTreeCount:3}}},arrays:[rows]};assert.throws(()=>assertVegetationClearance(packet,t),/Vegetation intersects/);
 const filtered=clearPacketVegetation(packet,t);assert.equal(filtered.removed,1);assert.equal(assertVegetationClearance(packet,t).checked,2);
 assert.ok(vegetationRadius(4,streetTreeHeight(4,7))>=1.5+2.5*1.13);
 assert.ok(vegetationRadius(1,streetTreeHeight(1,7,true),true)>=3+7.8*1.59);
});
test('all camera-facing and near model vertices fit the audited crown envelope',()=>{
 const layer=new AthensTrees(new THREE.Group());
 for(const mountain of [false,true])for(const species of Object.values(TREE))for(let variant=0;variant<8;variant++){
  if(mountain)layer.setMountainForest({metadata:{},arrays:[]});else layer.setMountainForest(null);
  const row=new Float32Array([200,100,200,1.7,species*8+variant]);layer.addTile('0,0',{metadata:{origin:[0,0,0],extensions:{worldDetail:{streetTrees:0,penteli:mountain,coastalTreeCount:1}}},arrays:[row]});layer.rebuild(200,200);
  const mesh=layer.meshes.get(species).mesh,m=new THREE.Matrix4(),v=new THREE.Vector3(),radius=vegetationRadius(species,streetTreeHeight(species,variant,mountain),true)-(species===4?1.5:3);mesh.getMatrixAt(0,m);
  const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(m);assert.ok(Math.hypot(v.x-200,v.z-200)<=radius+1e-4,species+':'+variant);}
  layer.rebuild(200,300);const far=layer.coastFar.get(species)?.mesh;if(far?.count){far.getMatrixAt(0,m);const p=far.geometry.attributes.position;for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(m);assert.ok(Math.hypot(v.x-200,v.z-200)<=radius+1e-4);}}
 }
 layer.dispose();
});
test('late streamed foliage starts with zero coverage and keeps birth time across rebuilds; Off hides both LODs',()=>{
 const layer=new AthensTrees(new THREE.Group()),p={metadata:{origin:[0,0,0],extensions:{worldDetail:{streetTrees:0,penteli:true,coastalTreeCount:1}}},arrays:[new Float32Array([200,0,200,0,8])]};layer.addTile('0,0',p);layer.rebuild(200,240);
 const mesh=layer.meshes.get(TREE.pine).mesh,a=mesh.geometry.attributes.aVegetationFade,birth=a.getW(0);assert.ok(Math.abs(birth-layer.fade.clock.value)<1e-5);layer.rebuild(200,245);assert.equal(a.getW(0),birth);
 const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <clipping_planes_fragment>'};mesh.material.onBeforeCompile(shader);assert.match(shader.vertexShader,/smoothstep\(0.,1.2/);assert.match(shader.fragmentShader,/vVegetationFade<=threshold/);
 layer.setEnabled(false);assert.equal(layer.group.visible,false);layer.dispose();
});
test('distant forest certifies the same jittered positions used by its renderer',()=>{
 const nx=4,nz=4,p=new Float32Array(nx*nz*3);for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)p.set([80+x*32,20,z*32+64],(z*nx+x)*3);
 const asset={metadata:{spacing:32,forest:{array:1,nx,nz,clearanceArray:2}},arrays:[p,new Uint8Array(nx*nz).fill(1),new Uint8Array(nx*nz)]},rows=[...forestCandidates(asset)],q=vegetationContactIndex(t);
 clearForestCell(asset,rows,t,[0,0]);let kept=0,rejected=0;for(const r of rows){const drawn=!!(asset.arrays[2][r.i]&(1<<r.j));assert.equal(drawn,q.clear(r.x,r.z,forestRadius(r.scale)));drawn?kept++:rejected++;}assert.ok(kept>0&&rejected>0);
});
test('dither preserves the analytic impostor silhouette and its discard mask',()=>{
 const layer=new AthensTrees(new THREE.Group()),shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>\n#include <clipping_planes_fragment>'};layer.coastFar.get(TREE.oleander).mesh.material.onBeforeCompile(shader);assert.match(shader.fragmentShader,/if\(crown>1.\)discard/);assert.match(shader.fragmentShader,/vVegetationFade<=threshold/);layer.dispose();
});
test('retained Psychiko tree cells fade on arrival, retain distance uniforms and dispose their private materials',()=>{
 const source=new THREE.MeshStandardMaterial(),far={value:420};source.onBeforeCompile=s=>{s.uniforms.far=far;};
 const a=fadeMergedVegetation(new THREE.Mesh(new THREE.BufferGeometry(),source)),b=fadeMergedVegetation(new THREE.Mesh(new THREE.BufferGeometry(),source));
 const shader=()=>({uniforms:{},fragmentShader:'#include <common>\n#include <clipping_planes_fragment>'}),sa=shader(),sb=shader();a.material.onBeforeCompile(sa);b.material.onBeforeCompile(sb);
 assert.equal(sa.uniforms.far,far);assert.notEqual(sa.uniforms.uVegetationArrival,sb.uniforms.uVegetationArrival);assert.equal(sa.uniforms.uVegetationArrival.value,0);
 let disposed=false;a.material.addEventListener('dispose',()=>disposed=true);a.geometry.dispose();assert.equal(disposed,true);b.geometry.dispose();source.dispose();
});
test('the retained Psychiko crown envelope contains every actual template at its maximum width',async()=>{
 const source=await readFile(new URL('../src/maps/psychiko-streetscape.js',import.meta.url),'utf8'),templates=Function('THREE','assertWorldBudget',source.slice(source.indexOf('const C ='),source.indexOf('// Kerb car'))+';return treeTemplates();')(THREE,()=>{});
 for(let species=0;species<templates.length;species++)for(const t of templates[species])for(let i=0;i<t.p.length;i+=3){const width=species<2?1.25:1,margin=species===5?1.5:3;assert.ok(Math.hypot(t.p[i],t.p[i+2])*width<=psychikoVegetationRadius(species,1)-margin);}
});
