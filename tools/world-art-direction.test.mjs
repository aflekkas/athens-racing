import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import * as THREE from 'three';
import {WORLD_STYLE,WORLD_TRIANGLE_BUDGETS as budgets,triangleCount} from '../src/world-art-direction.js';
import {buildingBlockGeometry,facadeMaterial,BUILDING_PALETTE} from '../src/buildings.js';
import {terrainMaterial} from '../src/terrain.js';
import {makeLook,createHumanRig,Crowd} from '../src/human.js';
import {municipalBinGeometry} from '../src/street-life.js';
import {createRoadsideModels} from '../src/roadside.js';
import {squarePost,signFace} from '../src/world-prop-geometries.js';
import {chairGeo,tableGeo} from '../src/people.js';
import {boatGeo} from '../src/nature.js';
import {createWater,CU} from '../src/env.js';
import {simplifyScenery} from '../src/graphics.js';
import {signTexture} from '../src/road.js';
import {bannerTex} from '../src/event-markers.js';
import {LabelAtlas} from '../src/buildings.js';
import {RNG} from '../src/util.js';
const locked='Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('owner lock: no vegetation pipeline or detailed building renderer',()=>{
 assert.deepEqual(WORLD_STYLE,{vegetation:false,beachFurniture:false,buildings:'blocks',terrain:'area-colour-texture',style:'blocky-real-things'},locked);
 for(const p of ['data/map.json','data/maps/megara/map.json','data/maps/penteli/map.json'])assert.equal(JSON.parse(read(p)).trees,undefined,locked);
 for(const p of ['src/nature.js','src/maps/penteli.js','src/maps/megara.js','src/world-context.js','src/buildings.js','src/hillside-cover.js'])assert.doesNotMatch(read(p),/pineTemplate|needleCards|cardCluster|foliageMaterial|addPalm|addPine|trees\.push|plantInstances|new DetailBatch|addFrontage|balcK|makePharmacyCross/,locked);
 for(const p of ['src/nature.js','src/people.js','src/world-context.js'])assert.doesNotMatch(read(p),/umbrellaGeo|parasolGeo|sunbeds|beachBedPose/,locked);
 for(const p of ['tools/build_map.mjs','tools/maps/penteli/build.mjs','tools/maps/megara/build.mjs'])assert.doesNotMatch(read(p),/trees\s*[:,]|trees\.push/,locked);
 assert.equal(existsSync(new URL('../tools/make_foliage.py',import.meta.url)),false,locked);
 assert.doesNotMatch(read('tools/fetch_tex.py'),/LEAVES|palm_tree_bark|pine_bark/,locked);
 assert.doesNotMatch(read('src/tex.js'),/foliage_atlas|palm_frond|pine_bark|palm_tree_bark|leaves_broad|leaves_narrow/,locked);
 assert.doesNotMatch(read('src/env.js').split('function islandMaterial()')[1],/float inz|c0\.r \*.*Math\.sin/,locked);
 assert.doesNotMatch(read('src/maps/penteli-surface.js'),/pGrass|coverPatch|phrygana/,locked);
 for(const m of [facadeMaterial()]){assert.equal(m.map,null,locked);assert.equal(m.normalMap,null,locked);m.dispose();}
});
test('every mapped building remains within the 40 triangle block budget',()=>{
 for(const p of ['data/map.json','data/maps/megara/map.json','data/maps/penteli/map.json'])for(const b of JSON.parse(read(p)).buildings){if(!b.p||b.p.length<6)continue;const g=buildingBlockGeometry(b.p.flat(),b.h||6);assert.ok(triangleCount(g)<=budgets.building,locked);g.dispose();}
});
test('near and instanced pedestrians fit the owner budget with all appearance combinations',()=>{
 for(const role of ['street','beach','cafe','jogger','cyclist','child','elder'])for(let seed=0;seed<30;seed++){
  const look=makeLook(new RNG(seed),role),mat=new THREE.MeshBasicMaterial(),rig=createHumanRig(look,mat);
  assert.ok(triangleCount(rig.mesh.geometry)<=budgets.pedestrian,locked);rig.mesh.geometry.dispose();rig.skeleton.dispose();mat.dispose();
 }
 const crowd=new Crowd(new THREE.Group(),1);let total=0;
 for(const [key,p] of Object.entries(crowd.parts))if(!key.startsWith('far')&&key!=='bicycle')total+=triangleCount(p.im.geometry)*p.mult;
 // This deliberately counts every mutually exclusive hair/hat/torso variant together.
 assert.ok(total<=budgets.pedestrian,locked+' all instanced parts '+total);
});
test('street models, signs, lamps, gantry primitives fit category budgets',()=>{
 const ctx=new Proxy({measureText:()=>({width:20})},{get:(o,k)=>o[k]??(()=>{})});
 globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>ctx})};
 for(const [name,m] of Object.entries(createRoadsideModels().models)){
  const category=name==='stairs'?'stairFlight':name==='parking'||name==='stop'?'sign':'streetProp';
  assert.ok(m.parts.reduce((n,p)=>n+triangleCount(p.geometry),0)<=budgets[category],locked+' '+name);
 }
 for(const g of [chairGeo(),tableGeo(),boatGeo(0),boatGeo(1),boatGeo(2)])assert.ok(triangleCount(g)<=budgets.streetProp,locked);
 for(const recycling of [false,true])assert.ok(triangleCount(municipalBinGeometry(recycling))<=budgets.streetProp,locked);
 assert.ok(triangleCount(squarePost(.08,3))+triangleCount(signFace(.4))<=budgets.sign,locked);
 assert.ok(3*triangleCount(squarePost(.15,9.5))<=budgets.lamp,locked);
 assert.ok(3*triangleCount(squarePost(.5,7))<=budgets.gantry,locked);
 assert.equal(triangleCount(squarePost(.1,1)),budgets.barrierPost,locked);
});

test('Effects Off sea stays blue without a sky cube; both water variants share the safe branch',()=>{
 const water=createWater(null,{minX:0,minZ:0,GX:2,GZ:2,T:10},new THREE.Texture());
 const sky=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());
 simplifyScenery(sky,null,water,null);
 for(const mat of [water.material,water.mesh.material]){
  assert.equal(mat.uniforms.uNight,CU.uNight,locked);
  assert.equal(mat.uniforms.uReflOn.value,0,locked);
  const branch=mat.fragmentShader.split('if (uReflOn < 0.5) {')[1].split('return;')[0];
  assert.match(branch,/vec4\(calmBlue,1.0\)/,locked);
  assert.doesNotMatch(branch,/textureCube|aerial|uSunE|uSkyIrr|tRefl/,locked);
 }
 water.dispose();
});
test('gantry and atlas labels fit their usable panel width even with fallback fonts',()=>{
 const calls=[];const ctx=new Proxy({measureText:t=>({width:t.length*100}),fillText:(...args)=>calls.push(args)},{get:(o,k)=>o[k]??(()=>{})});
 globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>ctx})};
 signTexture({to:'VOULIAGMENI / VERY LONG FINISH DESTINATION'});
 for(const text of ['RIVIERA RUN · START','FINISH · VOULIAGMENI / VERY LONG FINISH DESTINATION']){
  const call=calls.find(a=>a[0]===text);assert.ok(call?.[3]>0&&call[3]<=896,locked+' '+text);
 }
 bannerTex('CAMERA 999 / FINISH','#111','#fff');assert.equal(calls.at(-1)[3],288,locked);
 new LabelAtlas().add('LONG MAP LABEL '.repeat(20),'#111','#fff');assert.equal(calls.at(-1)[3],476,locked);
});

test('terrain keeps area textures and boxes use a separate plaster/accent palette',()=>{
 const material=terrainMaterial(),shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
 material.onBeforeCompile(shader);
 for(const name of ['tGD','tSD','tBD','tRD'])assert.ok(name in shader.uniforms,locked);
 assert.match(shader.fragmentShader,/float steep/,locked);
 assert.doesNotMatch(shader.fragmentShader,/float shrub|vec3 garden|floor\(wp/,locked);
 assert.ok(BUILDING_PALETTE.includes('#ffffff'),locked);
 for(const c of BUILDING_PALETTE)assert.ok(!['#b7ab95','#dcc8a0','#b3a484'].includes(c),locked);
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(),material),group=new THREE.Group();group.add(mesh);
 simplifyScenery(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),null,null,{group});
 assert.equal(mesh.material,material,locked);
});
