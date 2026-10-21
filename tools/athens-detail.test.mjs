// The Athens world's procedural dressing: ground classes from the bake's colours, the shared noise texture, facade attributes.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {GROUND_CLASS_COLOURS,GROUND_NAMES,groundWeights,buildNoise,NOISE_SIZE,detailNoiseBytes,GROUND_GLSL,FACADE_GLSL,SEA_GLSL,FOAM_GLSL} from '../src/athens-detail.js';
import {deriveBuildingMeshes,facadeStyleFor} from '../src/world-tile-buildings.js';
import {tagDressedSurfaces,DRESSING_VARIANTS} from '../src/world-tile-dressing.js';
import * as THREE from 'three';
import {FACADE_PLAIN,FACADE_SHADE_GLSL,patchMaterial,SEA_APPLY,SEA_VERTEX_BODY,SEA_VERTEX_VARYINGS} from '../src/athens-detail.js';
import {terrainChunkMaterial} from '../src/terrain-layout.js';
import {setSetting} from '../src/settings.js';

test('World detail Off compiles away detail and live toggles invalidate ordinary and terrain-cloned programs',()=>{
 const material=patchMaterial(new THREE.MeshBasicMaterial(),{key:'test-sea',vertexVaryings:SEA_VERTEX_VARYINGS,vertexBody:SEA_VERTEX_BODY,fragmentGlsl:SEA_GLSL,apply:SEA_APPLY}),clone=terrainChunkMaterial(material,{offset:[0,0,0],scale:[1,1,1]});
 const compile=m=>{const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>'};m.onBeforeCompile(shader);return shader;};
 try{setSetting('worldDetail',false);const key=clone.customProgramCacheKey(),plain=compile(material),terrain=compile(clone);assert.doesNotMatch(plain.fragmentShader,/seaColour|detailMap|uWorldDetail/);assert.equal(plain.uniforms.detailMap,undefined);assert.match(terrain.vertexShader,/terrainOffset/);
  const version=material.version,cloneVersion=clone.version;setSetting('worldDetail',true);assert.ok(material.version>version);assert.ok(clone.version>cloneVersion);assert.notEqual(clone.customProgramCacheKey(),key);assert.match(compile(clone).fragmentShader,/seaColour/);
 }finally{material.dispose();clone.dispose();setSetting('worldDetail',true);}
});
const linear=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
test('plain derived buildings retain base face shade and flat roofs without facade sampling',()=>{
 const material=patchMaterial(new THREE.MeshBasicMaterial(),{key:'test-facade',fragmentGlsl:FACADE_GLSL,vertexVaryings:'',vertexBody:'',apply:'',plain:FACADE_PLAIN});
 try{setSetting('worldDetail',false);const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>'};material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes(FACADE_SHADE_GLSL));assert.ok(FACADE_GLSL.includes(FACADE_SHADE_GLSL));assert.match(shader.fragmentShader,/diffuseColor.rgb\*=wallShade/);
  assert.match(shader.vertexShader,/transformed.y-=mod\(yy,1024.\)\*\.1/);assert.doesNotMatch(shader.fragmentShader,/texture2D|detailMap|facadeMul/);
 }finally{material.dispose();setSetting('worldDetail',true);}
});
test('the shader classes use exactly the colours the bake paints (appearance.py TERRAIN)',()=>{
  const py=readFileSync(new URL('./world-gen/appearance.py',import.meta.url),'utf8'),terrain=py.match(/TERRAIN=dict\(([^)]*)\)/)[1];
  const baked=Object.fromEntries([...terrain.matchAll(/(\w+)='(#[0-9a-f]{6})'/g)].map(m=>[m[1],m[2]]));
  assert.deepEqual(baked,{...GROUND_CLASS_COLOURS},'a colour changed on one side only');
});
test('every ground class is recognised through the bake\'s +-6% brightness variation, and a boundary blends softly',()=>{
  for(const [i,name] of GROUND_NAMES.entries())for(const k of [.94,1,1.06]){
    const w=groundWeights(linear(GROUND_CLASS_COLOURS[name]).map(v=>v*k));assert.ok(w[i]>.9,`${name} x${k}: ${w[i].toFixed(2)}`);assert.ok(Math.abs(w.reduce((a,b)=>a+b)-1)<1e-9);
  }
  // Half way between grass and forest (what a vertex colour does across a triangle on a boundary) is a real mixture.
  const a=linear(GROUND_CLASS_COLOURS.grass),b=linear(GROUND_CLASS_COLOURS.forest),w=groundWeights(a.map((v,i)=>(v+b[i])/2));
  assert.ok(w.filter(v=>v>.15).length>=2||Math.max(...w)<.9,'a boundary colour is not forced to one class');
});
test('the one noise texture is small, fills its range, tiles without a seam, and is deterministic',()=>{
  const n=buildNoise();assert.equal(n.length,NOISE_SIZE*NOISE_SIZE*4);assert.ok(detailNoiseBytes()<400*1024,'texture budget: well under 3 MB for all new textures');
  for(let c=0;c<4;c++){let lo=255,hi=0,sum=0;for(let i=c;i<n.length;i+=4){lo=Math.min(lo,n[i]);hi=Math.max(hi,n[i]);sum+=n[i];}assert.ok(lo<5&&hi>250,`channel ${c} uses its range`);assert.ok(sum/(n.length/4)>40&&sum/(n.length/4)<215,`channel ${c} is not flat`);}
  // Wrap-around neighbours differ no more than ordinary neighbours do (periodic lattices, no seam at the edge).
  const px=(x,y,c)=>n[((y%NOISE_SIZE)*NOISE_SIZE+(x%NOISE_SIZE))*4+c];
  for(const c of [1,2,3]){let edge=0,inner=0;for(let y=0;y<NOISE_SIZE;y++){edge+=Math.abs(px(NOISE_SIZE-1,y,c)-px(NOISE_SIZE,y,c));inner+=Math.abs(px(100,y,c)-px(101,y,c));}assert.ok(edge<=inner*2+NOISE_SIZE,`channel ${c} wraps smoothly (${edge} vs ${inner})`);}
  assert.deepEqual(buildNoise(),n);
});
test('shader sources are complete: no unresolved template text, every recipe present',()=>{
  for(const src of [GROUND_GLSL,FACADE_GLSL,SEA_GLSL,FOAM_GLSL])assert.ok(!/\$\{|undefined|NaN/.test(src));
  for(const name of GROUND_NAMES)assert.match(GROUND_GLSL,new RegExp(`vec3 g_${name}\\(`));
  assert.match(GROUND_GLSL,/512\.\/3\./,'low-frequency layers use periods that divide the 512 m cell');
  // Every planar divisor (metres per texture repeat) must divide the 512 m cell, or the pattern jumps at tile borders.
  const divisors=[...[GROUND_GLSL,SEA_GLSL,FOAM_GLSL].join('\n').matchAll(/(?:\b[pP]|vSeaP|p\.[xy])\/(\(512\.\/3\.\)|[\d.]+)/g)].map(m=>m[1]==='(512./3.)'?512/3:Number(m[1]));
  assert.ok(divisors.length>=10,'found the periods');for(const d of divisors)assert.ok(Math.abs(512/d-Math.round(512/d))<1e-6,`period ${d} divides the cell`);
  assert.ok(SEA_GLSL.includes('p*.01171875'),'6 repeats per cell (6/512)');
});
const ring=(x,z,w,d)=>[[x,z],[x+w,z],[x+w,z+d],[x,z+d]];
function tile(buildings){const corners=[],rows=[],heights=[],ids=[''];for(const [i,[r,base,h,mat]] of buildings.entries()){rows.push(ids.push('building:w'+(100+i)+':0')-1,corners.length/2,r.length,mat);for(const p of r)corners.push(...p);heights.push(base,h);}
  return [{buildings:Uint32Array.from(rows),buildingCorners:Float32Array.from(corners),buildingHeights:Float32Array.from(heights)},{ids}];}
test('facade attributes: distance along each wall, height above the base, the style, and a roof marker',()=>{
  const [t,m]=tile([[ring(0,0,10,6),2,12,2]]),{arrays,meshes}=deriveBuildingMeshes(t,m,Uint8Array.of(4));
  assert.equal(meshes.length,1);assert.equal(meshes[0].userData.tileSurface,'building');const a=meshes[0].attributes.aFacade,f=arrays[a.array],p=arrays[meshes[0].attributes.position.array];
  assert.equal(a.itemSize,2);assert.ok(f instanceof Uint16Array);assert.equal(f.length,p.length/3*2);
  const wall=[...Array(16).keys()],roof=[16,17,18,19];
  for(const v of wall)assert.equal(Math.floor(f[v*2+1]/4096),4,'stored style travels to the shader');
  assert.deepEqual([f[0],f[2],f[4],f[6]],[0,0,100,100],'first wall is 10 m: 0 and 100 dm');assert.deepEqual([f[1]%4096,f[3]%4096],[0,120],'base 0, top 12 m = 120 dm');
  for(const v of roof)assert.equal(f[v*2],65535);
  const us=Array.from(f).filter((v,i)=>i%2===0&&v!==65535);assert.equal(Math.max(...us),320,'u runs round the 32 m footprint, not from the cell origin');
});
test('facade style: stored style wins; otherwise height and the whole building\'s id pick one, and its pieces agree',()=>{
  assert.equal(facadeStyleFor(7,3,1),7);for(let h=0;h<5;h++){for(const height of [4,9,20])assert.equal(facadeStyleFor(0,height,h),facadeStyleFor(0,height,h));}
  assert.ok([0,2].includes(facadeStyleFor(0,4,5)));assert.ok([1,3,4].includes(facadeStyleFor(0,9,5)));assert.ok([1,4,5].includes(facadeStyleFor(0,25,5)));
  const [t1,m1]=tile([[ring(0,0,8,8),0,15,1]]);m1.ids[1]='building:w9:0/0:0';const [t2,m2]=tile([[ring(500,0,8,8),0,15,1]]);m2.ids[1]='building:w9:0/1:0';
  const style=(t,m)=>{const {arrays,meshes}=deriveBuildingMeshes(t,m);return Math.floor(arrays[meshes[0].attributes.aFacade.array][1]/4096);};
  assert.equal(style(t1,m1),style(t2,m2),'the two cell pieces of one building share a style');
});
test('run-time tagging gives older bakes their ground and sea layers, and declares the layouts they need',()=>{
  const pack={metadata:{meshes:[{material:0,attributes:{position:{},color:{}},userData:{worldSurface:true}},{material:0,attributes:{position:{},color:{}},userData:{worldSurface:true,tileSurface:'urban'}},{material:20,attributes:{position:{}},userData:{water:true}},{material:8,attributes:{position:{}},userData:{worldSurface:true,tileSurface:'paving'}},{material:0,attributes:{position:{},color:{}},userData:{worldSurface:true,terrainDecode:{}}}]}};
  tagDressedSurfaces(pack);assert.deepEqual(pack.metadata.meshes.map(m=>m.userData.tileSurface),['ground','urban','sea','paving',undefined]);
  assert.deepEqual(DRESSING_VARIANTS.map(v=>v.surface),['coastalUrban','coastalGround','coastalDetail','ground','coastalBuilding','building','sea','foam']);for(const v of DRESSING_VARIANTS)assert.equal(v.key,JSON.stringify({surface:v.surface,attributes:v.attributes,index:v.index,terrain:v.terrain}));
});

test('terrain Off removes unused texture uniforms and preserves the plain roughness; live toggles recompile clones',async()=>{
 const {terrainMaterial}=await import('../src/terrain.js'),{penteliTerrainMaterial}=await import('../src/penteli-terrain.js');
 const compile=m=>{const sh={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>\n#include <worldpos_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>'};m.onBeforeCompile(sh);return sh;};
 for(const make of [terrainMaterial,penteliTerrainMaterial]){const material=make(),clone=terrainChunkMaterial(material,{version:1,offset:[0,0,0],scale:[1,1,1]});try{setSetting('worldDetail',false);const plain=compile(clone),key=clone.customProgramCacheKey(),version=clone.version;assert.equal(plain.uniforms.tGD,undefined);assert.match(plain.fragmentShader,/roughnessFactor = 0.95/);assert.match(plain.vertexShader,/terrainOffset/);setSetting('worldDetail',true);assert.ok(clone.version>version);assert.notEqual(clone.customProgramCacheKey(),key);assert.ok(compile(clone).uniforms.tGD);}finally{material.dispose();clone.dispose();setSetting('worldDetail',true);}}
});
