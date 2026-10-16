import { buildBuildings } from '../buildings.js';
// Penteli inland scenery. Road/elevations and land-use footprints come from the bundle.
// Owner-locked block scenery; real elevation and guardrails are retained.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CellInstances, RNG, M, clamp, pointInPoly, polyBounds } from '../util.js';
import { TX } from '../tex.js';
import { COND_STATE } from '../env.js';
import { buildPenteliSurface } from './penteli-surface.js';
import { buildPenteliRails } from './penteli-roadside.js';
import { PenteliGround } from './penteli-ground.js';
import { villageForecourtBuffer } from '../people-policy.js';

const CHAPEL = [3023.3,880.68,3022.94,874.64,3007.82,875.52,3008.47,886.61,3013.55,886.31,3013.25,881.27];
const TAU = Math.PI * 2;

export function buildScenery(scene,map,{heightC=(x,z)=>map.terrain.height(x,z),assets={}}={}) {
  const {route,data,terrain}=map, rng=new RNG(2947);
  const branchVerge=(x,z)=>[[0,0],[1.5,0],[-1.5,0],[0,1.5],[0,-1.5]].some(([dx,dz])=>map.roadNetwork?.sample(x+dx,z+dz));
  const road=buildPenteliSurface(scene,map,heightC);
  const group=new THREE.Group();group.name='penteli-mountain-scenery';scene.add(group);
  const geos=new Set(), mats=new Set(), ownedTextures=new Set();
  const geo=g=>(geos.add(g),g), mat=m=>(mats.add(m),m);
  const std=(color,extra={})=>{
    const material=mat(new THREE.MeshStandardMaterial({color,roughness:.92,...Object.fromEntries(Object.entries(extra).filter(([,v])=>v!==undefined))}));
    // Keep indirect daylight on rough scenery under the lightweight LOW sky.
    material.customProgramCacheKey=()=> 'penteli-daylight-fill-v2';
    material.onBeforeCompile=sh=>{
      sh.uniforms.uSceneryDaylight={get value(){return COND_STATE.daylight;}};
      sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform float uSceneryDaylight;')
        .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * (0.52 * uSceneryDaylight);');
    };return material;
  };
  const metal=std('#959a9e',{metalness:.68,roughness:.42,side:THREE.DoubleSide});
  const white=std('#e7e3d7'), black=std('#252a27'), red=std('#a83c2a',{roughness:.4});
  const box=geo(new THREE.BoxGeometry(1,1,1));
  const buckets=[];
  // 640 m cells: small low-poly props, so bigger chunks cost less than more draw calls
  const instances=(g,m,options={})=>{geo(g);const b=new CellInstances(g,m,{cell:640,far:1100,...options});buckets.push(b);return b;};
  const posts=instances(box,metal,{far:700,shadow:false}), reflectorPosts=instances(box,white,{far:450,shadow:false});
  const reflectorBlack=instances(box,black,{far:350,shadow:false}), reflectorRed=instances(box,red,{far:350,shadow:false});
  const rails=buildPenteliRails(map,heightC);
  for(const run of rails)for(const q of run.pts)if(run.kind==='steel'&&q.terminal>.5&&q.s%4===0)
    posts.addTRS(q.p.x,q.p.y+.43,q.p.z,route.heading(q.s),.11,.86,.09);
  for(let s=12;s<route.length-12;s+=40)for(const side of [-1,1]){
    if(map.roadNetwork?.mouth(s,side,10))continue;
    const p=route.point(s,side*(route.edge(s)+1.15));p.y=heightC(p.x,p.z);
    reflectorPosts.addTRS(p.x,p.y+.50,p.z,route.heading(s),.13,1,.1);
    reflectorBlack.addTRS(p.x,p.y+.82,p.z,route.heading(s),.135,.19,.105);
    reflectorRed.addTRS(p.x,p.y+.82,p.z,route.heading(s),.07,.065,.109);
  }
  function mesh(g,m,name){geo(g);const o=new THREE.Mesh(g,m);o.name=name;o.receiveShadow=true;group.add(o);return o;}
  function sweep(samples,profile,material,name){
    if(samples.length<2)return;const pos=[],uv=[],idx=[],n=profile.length;
    samples.forEach((q,i)=>{for(const [du,dy] of profile){const p=route.point(q.s,q.side*(q.u+du));pos.push(p.x,q.y+dy*(q.terminal??1),p.z);uv.push(q.s*.5,du+dy);}
      if(i)for(let j=0;j<n-1;j++){const a=(i-1)*n+j,b=a+n;idx.push(a,b,a+1,a+1,b,b+1);}});
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return mesh(g,material,name);
  }
  const wBeam=[[0,.51],[.07,.55],[.07,.61],[0,.66],[0,.71],[.07,.76],[.07,.82],[0,.85]];
  // Merge short runs by 240 m world cell and material. Culling and preset scaling
  // use the same scenery LOD policy as instanced posts, without whole-route beams.
  const railChunks=new Map();
  const concrete=std('#b1ada3',{map:TX.concrete_diff,side:THREE.DoubleSide});
  const jersey=[[-.28,0],[-.28,.15],[-.13,.42],[-.09,.82],[.09,.82],[.13,.42],[.28,.15],[.28,0]];
  for(const run of rails){let chunk=[];let lastKey;
    const flush=()=>{if(chunk.length<2)return;const o=sweep(chunk,run.kind==='steel'?wBeam:jersey,run.kind==='steel'?metal:concrete,'mountain-guardrail');
      group.remove(o);const key=lastKey+':'+run.kind;if(!railChunks.has(key))railChunks.set(key,[]);railChunks.get(key).push(o.geometry);};
    for(const q of run.pts){const key=Math.floor(q.p.x/240)+','+Math.floor(q.p.z/240);
      if(lastKey!==undefined&&key!==lastKey){flush();chunk=chunk.slice(-1);}lastKey=key;chunk.push({...q,side:run.side,y:q.p.y});
    }flush();
  }
  for(const [key,parts] of railChunks){const g=mergeGeometries(parts);const o=mesh(g,key.endsWith(':steel')?metal:concrete,'Penteli barrier chunk '+key);
    g.computeBoundingSphere();o.boundingSphere=g.boundingSphere;o.userData={lod:true,far:1800,impostor:false};
    for(const part of parts){geos.delete(part);part.dispose();}
  }
  group.userData.guardrails={runs:rails.length,metres:rails.reduce((n,r)=>n+r.pts.at(-1).s-r.pts[0].s,0),chunks:railChunks.size};
  // The common terrain provides drainage and re-entry shoulders. Raised
  // decorative drains/retaining strips must not recreate a wall across them.

  // All unused OSM arms are rendered and contacted by RoadNetwork. A second
  // decorative EP29 strip would overlap that surface and bypass its contacts.

  for(const b of buckets){b.build(group);b.cells.clear();}
  group.userData.reconstruction='Street View roadside inventory; OSM footprints; block buildings and clean terrain';
  buildBuildings(map, group, heightC);
  let disposed=false;
  return {group,road,ground:new PenteliGround(map,heightC,{...assets,rails},road),assets:{rails},dispose(){
    if(disposed)return;disposed=true;road.dispose?.();group.removeFromParent();
    // Shared TX textures and LabelAtlas materials belong to the application.
    for(const g of geos)g.dispose();for(const m of mats)m.dispose();for(const t of ownedTextures)t.dispose();group.clear();
  }};
}
