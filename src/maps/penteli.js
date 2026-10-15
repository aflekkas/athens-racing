// Penteli inland scenery. Road/elevations and land-use footprints come from the bundle.
// Vegetation is a deterministic reconstruction, not a tree-by-tree survey. The two
// crown forms evoke Mediterranean pines; their proportions do not assert species.
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

// Branch-aligned cylinders form a branching silhouette rather than a straight pole.
function branch(a, b, r0, r1) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a.x+b.x)/2, (a.y+b.y)/2, (a.z+b.z)/2);
  return g;
}
function pineTemplate(seed, upright = false) {
  const rng = new RNG(seed), limbs = [], clusters = [];
  const base = new THREE.Vector3(), fork = new THREE.Vector3(.28, 3.7, -.16);
  limbs.push(branch(base, fork, .23, .12));
  for (let i=0;i<7;i++) {
    const a = i*2.399 + rng.range(-.3,.3), r = upright ? 1.8-i*.16 : rng.range(1.7,3.1);
    const c = new THREE.Vector3(Math.cos(a)*r, upright ? 4+i*.47 : rng.range(5.1,6.8), Math.sin(a)*r);
    limbs.push(branch(fork, c, .095, .023));
    clusters.push({c, r: upright ? [1.6,1.5,1.6] : [2.1,1.25,1.8]});
  }
  const trunk = mergeGeometries(limbs); limbs.forEach(g=>g.dispose());
  return {trunk, close: needleCards(clusters,seed,14), far: needleCards(clusters,seed,4,1.35)};
}
function needleCards(clusters, seed, count, enlarge=1, rect=[0,0,.5,.5]) {
  const rng = new RNG(seed), pos=[], uv=[], normals=[], colors=[], index=[];
  const right=new THREE.Vector3(), up=new THREE.Vector3(), normal=new THREE.Vector3(), q=new THREE.Vector3();
  for (const {c,r} of clusters) for (let i=0;i<count;i++) {
    const a=rng.range(0,TAU), h=rng.range(-.6,1), rad=Math.sqrt(1-h*h);
    const p=new THREE.Vector3(c.x+Math.cos(a)*rad*r[0], c.y+h*r[1], c.z+Math.sin(a)*rad*r[2]);
    right.set(Math.cos(a),rng.range(-.3,.3),Math.sin(a)).normalize();
    up.set(-Math.sin(a)*.45,.8,Math.cos(a)*.45).normalize();
    normal.crossVectors(right,up).normalize();
    const w=rng.range(1.7,2.7)*enlarge, hh=rng.range(1.4,2.1)*enlarge, start=pos.length/3;
    [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].forEach(([x,y],k)=>{
      q.copy(p).addScaledVector(right,x*w).addScaledVector(up,y*hh);
      pos.push(q.x,q.y,q.z);
      // Outward normals avoid the harsh alternating black planes of crossed billboards.
      const n=new THREE.Vector3(q.x-c.x,(q.y-c.y)*1.4,q.z-c.z).normalize().addScaledVector(normal,.15).normalize();
      normals.push(n.x,n.y,n.z); uv.push(k===1||k===2?rect[2]:rect[0],k>=2?rect[3]:rect[1]);
      const shade=.85+.15*clamp((q.y-c.y+r[1])/(2*r[1]),0,1); colors.push(shade,shade,shade);
    });
    index.push(start,start+1,start+2,start,start+2,start+3);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(index);g.computeBoundingSphere();return g;
}
function polygons(data,key) { return (data.areas?.[key] || []).filter(a=>a.p?.length>=6).map(a=>({...a,b:polyBounds(a.p)})); }
function inside(x,z,polys) { return polys.some(a=>x>=a.b.x0&&x<=a.b.x1&&z>=a.b.z0&&z<=a.b.z1&&pointInPoly(x,z,a.p)); }

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
  const stone=std('#aaa18e',{map:TX.rock_diff,normalMap:TX.rock_nor});
  const marble=std('#ddd9cc',{map:TX.rock_diff,normalMap:TX.rock_nor});
  const bark=std('#b5a18a',{map:TX.pinebark_diff,normalMap:TX.pinebark_nor});
  const leaf=std('#ffffff',{map:TX.foliage,alphaTest:.34,alphaToCoverage:true,side:THREE.DoubleSide,vertexColors:true});
  // The atlas already contains dark needle colour. Do not multiply it by another
  // dark material tint, and do not flip radial crown normals on card backfaces.
  leaf.customProgramCacheKey=()=> 'penteli-pine-transmission-v3';
  leaf.onBeforeCompile=sh=>{
    sh.uniforms.uPineDaylight={get value(){return COND_STATE.daylight;}};
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform float uPineDaylight;')
      .replace('#include <normal_fragment_begin>',THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;','// Crown-shell normals remain outward on both card faces.'))
      .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * (0.38 * uPineDaylight);');
  };
  const metal=std('#959a9e',{metalness:.68,roughness:.42,side:THREE.DoubleSide});
  const white=std('#e7e3d7'), black=std('#252a27'), red=std('#a83c2a',{roughness:.4});
  const box=geo(new THREE.BoxGeometry(1,1,1));
  const buckets=[];
  // 640 m cells: small low-poly props, so bigger chunks cost less than more draw calls
  const instances=(g,m,options={})=>{geo(g);const b=new CellInstances(g,m,{cell:640,far:1100,...options});buckets.push(b);return b;};
  const posts=instances(box,metal,{far:700,shadow:false}), reflectorPosts=instances(box,white,{far:450,shadow:false});
  const reflectorBlack=instances(box,black,{far:350,shadow:false}), reflectorRed=instances(box,red,{far:350,shadow:false});
  const rockGeo=geo(new THREE.IcosahedronGeometry(1,0));
  const rocks=instances(rockGeo,stone,{colors:true,shadow:false,far:900});
  const quarryRocks=instances(rockGeo,marble,{colors:true,shadow:false,far:2200,cell:500});
  const pines=[pineTemplate(58),pineTemplate(92),pineTemplate(74,true)].map(t=>({
    trunk:instances(t.trunk,bark,{far:1200}),
    close:instances(t.close,leaf,{colors:true,far:490,cell:240}),
    far:instances(t.far,leaf,{colors:true,near:360,far:2300,cell:440,shadow:false}),
  }));
  const shrubGeo=needleCards([{c:new THREE.Vector3(0,.75,0),r:[1.25,.7,1.1]}],202,19,.78,[.5,0,1,.5]);
  const shrubs=instances(shrubGeo,leaf,{colors:true,shadow:false,far:680,cell:200});
  const farShrubs=instances(needleCards([{c:new THREE.Vector3(0,.55,0),r:[1,.5,1]}],209,6,1.1,[.5,0,1,.5]),leaf,{colors:true,shadow:false,far:1500,cell:360});
  // Reserve civic/villa access courts. Filter after random transforms are drawn,
  // so removing a town shrub does not reseed vegetation along the mountain route.
  const clearance = { excluded: 0 }; group.userData.worldLifeClearance = clearance;
  for (const pool of [shrubs, farShrubs, rocks, ...pines.flatMap(p => [p.trunk, p.close, p.far])]) {
    const add = pool.add;
    pool.add = function(matrix, color) {
      const e = matrix.elements;
      if (villageForecourtBuffer(map, e[12], e[14])) { clearance.excluded++; return; }
      return add.call(this, matrix, color);
    };
  }
  const forest=[...polygons(data,'forest'),...polygons(data,'wood')], quarries=polygons(data,'quarry');
  const buildings=(data.buildings||[]).filter(b=>b.p).map(b=>({...b,b:polyBounds(b.p)}));
  // Sample world-space cells once: nearby legs of a hairpin do not double plant.
  const seen=new Set();
  function plant(x,z,s,far=false) {
    const q=route.project(x,z);
    const roadGap=Math.abs(q.u);
    if(roadGap<route.edge(q.s)+(far?17:7.5)||branchVerge(x,z)||inside(x,z,quarries)||inside(x,z,buildings))return;
    const y=heightC(x,z);if(!Number.isFinite(y)||y<10)return;
    const steep=Math.hypot(terrain.height(x+5,z)-terrain.height(x-5,z),terrain.height(x,z+5)-terrain.height(x,z-5))/10;
    const wooded=forest.length?inside(x,z,forest):q.s<6100;
    // Satellite review: open tawny slopes with regrowth dominate beyond Dionysos.
    // OSM wood polygons may predate fires, so they are a low-density mask.
    const town=q.s<550;
    const burnedCorridor=(q.s>=1200&&q.s<=5000)||(q.s>=7400&&q.s<=9300); // Google Sep2025 stations02–04 + Mar2026 station07
    const density=town?(wooded?.58:.30):burnedCorridor?.007:(wooded?.085:.024);
    if(rng.next()>density*(1-clamp(steep-.6,0,.78))) {
      if(!far&&rng.next()<(burnedCorridor?.53:.30))shrubs.addTRS(x,y-.06,z,rng.range(0,TAU),rng.range(.8,1.5),rng.range(.7,1.5),rng.range(.8,1.5),new THREE.Color(1.12,1.25,.88));
      if(!far&&steep>.28&&rng.next()<.14)rocks.addTRS(x,y-.25,z,rng.range(0,TAU),rng.range(.5,1.9),rng.range(.3,.9),rng.range(.5,1.6),'#c8bca5');
      return;
    }
    const t=pines[rng.next()<.18?2:rng.int(0,1)], scale=town?rng.range(.8,1.5):rng.range(.48,1.1), yaw=rng.range(0,TAU);
    const m=M(x,y-.18,z,rng.range(-.025,.025),yaw,rng.range(-.025,.025),scale,scale*rng.range(.88,1.2),scale);
    const tint=new THREE.Color().setRGB(rng.range(.87,1.03),rng.range(.92,1.08),rng.range(.83,.98));
    t.trunk.add(m);t.close.add(m,tint);t.far.add(m,tint);
  }
  for(let s=0;s<route.length;s+=40) {
    const f=route.frame(s,{});
    for(const side of [-1,1])for(let d=14;d<650;d+=d<160?14:44){
      const cell=d<160?13:38, x0=Math.floor((f.x+f.rx*d*side)/cell),z0=Math.floor((f.z+f.rz*d*side)/cell);
      for(let j=-1;j<=1;j++){
        const cx=x0+Math.round(f.tx*j),cz=z0+Math.round(f.tz*j),key=cell+':'+cx+','+cz;if(seen.has(key))continue;seen.add(key);
        plant((cx+rng.range(.12,.88))*cell,(cz+rng.range(.12,.88))*cell,s,d>=160);
      }
    }
  }
  // The paired Street View frames show near-continuous low phrygana/maquis,
  // rather than isolated bushes. Populate irregular world cells, with cheaper
  // cards farther uphill; avoid paved road, buildings and mapped quarry floors.
  const coverRng=new RNG(731),coverCells=new Set();
  for(let s=0;s<route.length;s+=14){const f=route.frame(s,{});
    for(const side of [-1,1])for(let d=7;d<520;d+=d<80?6:d<190?15:31){
      const cell=d<80?5.6:d<190?13:27,cx=Math.floor((f.x+f.rx*d*side)/cell),cz=Math.floor((f.z+f.rz*d*side)/cell),key=cell+':'+cx+','+cz;
      if(coverCells.has(key))continue;coverCells.add(key);
      if(coverRng.next()>(d<80?.87:.78))continue;
      const x=(cx+coverRng.range(.12,.88))*cell,z=(cz+coverRng.range(.12,.88))*cell,q=route.project(x,z);
      if(Math.abs(q.u)<route.edge(q.s)+1.5||branchVerge(x,z)||inside(x,z,buildings)||inside(x,z,quarries))continue;
      const y=heightC(x,z);if(y<10)continue;
      const dry=coverRng.next()<.29,tint=dry?new THREE.Color(1.65,1.42,.78):new THREE.Color(coverRng.range(.95,1.35),coverRng.range(1.12,1.5),coverRng.range(.65,.98));
      const scale=coverRng.range(.60,1.65)*(d>80?1.45:1),height=coverRng.range(.48,1.18);
      (d>150?farShrubs:shrubs).addTRS(x,y-.12,z,coverRng.range(0,TAU),scale,scale*height,scale,tint);
      if(coverRng.next()<.19){const size=coverRng.range(.28,1.6);rocks.addTRS(x+1.8,y-size*.18,z-.8,coverRng.range(0,TAU),size,size*coverRng.range(.25,.7),size*1.2,new THREE.Color(1.2,1.15,1.04));}
    }
  }
  // Town source01 has tall close pines with foliage crossing above the verge.
  const townRng=new RNG(192);
  for(let s=170;s<760;s+=23)for(const side of [-1,1]){
    if(townRng.next()>.8)continue;const p=route.point(s+townRng.range(-6,6),side*townRng.range(6.8,17));
    if(inside(p.x,p.z,buildings))continue;const t=pines[townRng.next()<.48?2:townRng.int(0,1)],scale=townRng.range(1.3,2.05),m=M(p.x,heightC(p.x,p.z)-.1,p.z,0,townRng.range(0,TAU),0,scale,scale*1.22,scale);
    t.trunk.add(m);t.close.add(m,new THREE.Color(.94,1.02,.91));t.far.add(m,new THREE.Color(.94,1.02,.91));
  }
  // Karakanta source08 and the Boskovits walk show a mature plane-tree grove.
  // March reference is leafless: pale, spreading branch architecture is visible.
  const planeParts=[],planeRng=new RNG(808),planeFork=new THREE.Vector3(.2,3.5,0);
  planeParts.push(branch(new THREE.Vector3(),planeFork,.48,.32));
  for(let i=0;i<8;i++){
    const a=i*2.399,tip=new THREE.Vector3(Math.cos(a)*planeRng.range(2.2,4),planeRng.range(7.5,10.5),Math.sin(a)*planeRng.range(2.2,4));
    planeParts.push(branch(planeFork,tip,.24,.065));
    for(let j=0;j<5;j++){
      const fork=planeFork.clone().lerp(tip,.32+j*.13),end=fork.clone().add(new THREE.Vector3(Math.cos(a+j*1.5)*planeRng.range(1.2,2.1),planeRng.range(1.5,2.8),Math.sin(a+j*1.5)*planeRng.range(1.2,2.1)));
      planeParts.push(branch(fork,end,.073,.018));
      for(let k=0;k<3;k++){const at=fork.clone().lerp(end,.35+k*.22),twig=at.clone().add(new THREE.Vector3(Math.cos(a+j+k)*.8,planeRng.range(.6,1.4),Math.sin(a+j+k)*.8));planeParts.push(branch(at,twig,.024,.003));}
    }
  }
  const planeGeo=mergeGeometries(planeParts);planeParts.forEach(g=>g.dispose());
  const planes=instances(planeGeo,std('#b4ae92',{map:TX.pinebark_diff}),{far:1400,cell:250});
  for(const [s,u,scale] of [[10178,8,1.12],[10191,12,.98],[10206,9,1.05],[10221,14,.9],[10237,11,1.07],[10251,16,1.02],[10271,12,.88]]){
    const p=route.point(s,u);planes.addTRS(p.x,heightC(p.x,p.z),p.z,planeRng.range(0,TAU),scale,scale,scale);
  }
  // Sep2025 Google road imagery (stations02–04) confirms fine black snags and
  // low regrowth on this corridor. Placement is representative, not individually
  // surveyed. One shared branched template keeps the draw/memory cost low.
  const snagParts=[],snagRng=new RNG(925);
  const snagRoot=new THREE.Vector3(0,0,0),snagFork=new THREE.Vector3(.07,1.35,-.05);
  snagParts.push(branch(snagRoot,snagFork,.065,.038));
  for(let i=0;i<8;i++){
    const a=i*2.399,tip=new THREE.Vector3(Math.cos(a)*snagRng.range(.5,1.15),snagRng.range(2.1,3.4),Math.sin(a)*snagRng.range(.5,1.15));
    snagParts.push(branch(snagFork,tip,.034,.011));
    for(let j=0;j<4;j++){
      const root=snagFork.clone().lerp(tip,.34+j*.16),end=root.clone().add(new THREE.Vector3(Math.cos(a+j+.7)*.43,.48,Math.sin(a+j+.7)*.43));
      snagParts.push(branch(root,end,.012,.003));
      const mid=root.clone().lerp(end,.55),fine=end.clone().add(new THREE.Vector3(-.17,.24,.16));snagParts.push(branch(mid,fine,.007,.002));
    }
  }
  const snagGeo=mergeGeometries(snagParts);snagParts.forEach(g=>g.dispose());
  const snags=instances(snagGeo,std('#37322c'),{far:670,cell:280,shadow:false});
  for(const [from,to] of [[1200,5000],[7400,9300]])for(let s=from;s<to;s+=11)for(const side of [-1,1]){
    if(snagRng.next()>.82)continue;
    const p=route.point(s+snagRng.range(-10,10),side*snagRng.range(6.8,48)),q=route.project(p.x,p.z);
    if(Math.abs(q.u)<route.edge(q.s)+2.2||branchVerge(p.x,p.z)||inside(p.x,p.z,quarries)||inside(p.x,p.z,buildings))continue;
    const h=heightC(p.x,p.z),scale=s>7400?snagRng.range(.95,2.05):snagRng.range(.62,1.45);if(h>0)snags.addTRS(p.x,h-.04,p.z,snagRng.range(0,TAU),scale,scale,scale);
  }
  // Exposures stay within mapped quarry polygons. DEM provides their true relief.
  for(const a of quarries){const b=a.b;let count=0;for(let x=b.x0;x<b.x1;x+=22)for(let z=b.z0;z<b.z1;z+=22){
    if(count>1200||!pointInPoly(x,z,a.p))continue;count++;
    const xx=x+rng.range(0,10),zz=z+rng.range(0,10),y=heightC(xx,zz);if(y<0)continue;
    quarryRocks.addTRS(xx,y-.9,zz,rng.range(0,TAU),rng.range(3,10),rng.range(1,3),rng.range(3,8),'#e0d9c9');
  }}

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

  // March2026 Google station06 shows a natural layered rock cut on the left.
  // Keep its rock appearance on the conformed ground beyond the re-entry
  // shoulder, instead of lofting an extra vertical face above the wheel surface.
  const cutPos=[],cutUV=[],cutCol=[],cutIdx=[],cutValid=[],cutLevels=9;
  for(let s=6520,row=0;s<=6800;s+=5,row++){
    const edge=route.edge(s);
    for(let k=0;k<cutLevels;k++){
      const d=8+16*k/(cutLevels-1),p=route.point(s,-(edge+d)),groundY=heightC(p.x,p.z),q=route.project(p.x,p.z,null);
      cutPos.push(p.x,groundY+.015,p.z);cutUV.push(s*.35,d*.46);
      cutValid.push(Math.abs(q.u)>route.edge(q.s)+6&&!map.roadNetwork?.sample(p.x,p.z));
      const shade=(k%3===0?.65:.92)+Math.sin(s*.09+k)*.04;cutCol.push(shade,shade*.97,shade*.86);
      if(row&&k){const a=(row-1)*cutLevels+k-1,b=a+cutLevels;
        if([a,a+1,b,b+1].every(i=>cutValid[i]))cutIdx.push(a,b,a+1,a+1,b,b+1);
      }
    }
  }
  const cutting=new THREE.BufferGeometry();cutting.setAttribute('position',new THREE.Float32BufferAttribute(cutPos,3));cutting.setAttribute('uv',new THREE.Float32BufferAttribute(cutUV,2));cutting.setAttribute('color',new THREE.Float32BufferAttribute(cutCol,3));cutting.setIndex(cutIdx);cutting.computeVertexNormals();
  const cutMaterial=std('#ede8d7',{map:TX.rock_diff,vertexColors:true,side:THREE.DoubleSide});
  const cutHook=cutMaterial.onBeforeCompile;cutMaterial.customProgramCacheKey=()=> 'penteli-cut-diffuse-v3';
  cutMaterial.onBeforeCompile=sh=>{cutHook(sh);sh.fragmentShader=sh.fragmentShader
    .replace('#include <normal_fragment_begin>',THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;','// Exposure normals face the road.'))
    .replace('#include <color_fragment>','#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.23,.215,.185),.28);');};
  mesh(cutting,cutMaterial,'EP5 layered natural rock cutting · source station06');

  // Agios Petros: exact OSM compound plan, refined from dboskovits 2021 photos
  // 00/56/57/62. Photos establish material/porch form, not surveyed dimensions.
  const chapel=data.buildings?.find(b=>String(b.id)==='368804380');
  const footprint=chapel?.p||CHAPEL,cx=3015.5,cz=880.5,baseY=heightC(cx,cz);
  const makePlan=(porch=false)=>{const sh=new THREE.Shape();
    for(let i=0;i<footprint.length;i+=2){const x=footprint[i]-cx,z=(porch?Math.min(883.3,footprint[i+1]):footprint[i+1])-cz;i?sh.lineTo(x,-z):sh.moveTo(x,-z);}sh.closePath();return sh;};
  const plaster=std('#e7e2ce',{map:TX.plaster_diff}),tile=std('#a26043'),wood=std('#77502c');
  const masonry=std('#b6ac91',{map:TX.rock_diff,normalMap:TX.rock_nor});
  const slab=new THREE.ExtrudeGeometry(makePlan(),{depth:.16,bevelEnabled:false});slab.rotateX(-Math.PI/2);slab.translate(cx,baseY,cz);mesh(slab,masonry,'Agios Petros exact OSM footprint');
  // The southern projection contains the open porch; keep its mapped outline as
  // the foundation and roof, with the cream entrance recessed behind the columns.
  const body=new THREE.ExtrudeGeometry(makePlan(true),{depth:2.75,bevelEnabled:false});body.rotateX(-Math.PI/2);body.translate(cx,baseY,cz);mesh(body,masonry,'Agios Petros stone compound').castShadow=true;
  const chapelX=3010.7,frontZ=883.34,yaw=.059,halfWidth=2.85,rise=1.22;
  const facade=mesh(new THREE.BoxGeometry(4.45,2.6,.12),plaster,'cream chapel entrance');facade.position.set(chapelX,baseY+1.42,frontZ);facade.rotation.y=yaw;
  for(const side of [-1,1]){
    const roof=mesh(new THREE.BoxGeometry(Math.hypot(halfWidth,rise),.16,12.1),tile,'narrow terracotta chapel gable');
    roof.position.set(chapelX+side*halfWidth/2,baseY+2.83+rise/2,880.85);roof.rotation.set(0,yaw,-side*Math.atan2(rise,halfWidth));roof.castShadow=true;
  }
  const detailStone=instances(box,masonry,{colors:true,far:800});
  // Separate staggered blocks make the photographed dressed-stone pillars legible.
  for(const px of [3008.62,3012.78])for(let row=0;row<8;row++){
    detailStone.addTRS(px,baseY+.18+row*.325,885.95,yaw,.57,.303,.57,row%3===0?'#d0c7b3':row%3===1?'#b7ad93':'#d6d2c7');
  }
  const lintel=mesh(new THREE.BoxGeometry(4.75,.22,.22),wood,'exposed timber porch beam');lintel.position.set(chapelX,baseY+2.79,886.05);lintel.rotation.y=yaw;
  const trussA=new THREE.Vector3(chapelX-2.7,baseY+2.81,886.07),trussB=new THREE.Vector3(chapelX,baseY+3.98,886.07),trussC=new THREE.Vector3(chapelX+2.7,baseY+2.81,886.07);
  for(const [v,w] of [[trussA,trussB],[trussB,trussC],[new THREE.Vector3(chapelX,baseY+2.8,886.07),trussB]])mesh(branch(v,w,.07,.07),wood,'porch timber truss');
  const doorShape=new THREE.Shape();doorShape.moveTo(-.5,0);doorShape.lineTo(.5,0);doorShape.lineTo(.5,1.45);doorShape.absarc(0,1.45,.5,0,Math.PI,false);doorShape.closePath();
  const door=mesh(new THREE.ShapeGeometry(doorShape),std('#1e2421'),'arched chapel door');door.position.set(chapelX,baseY+.2,frontZ+.085);door.rotation.y=yaw;
  const step=mesh(new THREE.BoxGeometry(1.55,.16,.8),plaster,'chapel entrance step');step.position.set(chapelX,baseY+.14,frontZ+.5);
  const gate=mesh(new THREE.BoxGeometry(1.45,2.35,.1),std('#25362c'),'compound dark green door');gate.position.set(3018.3,baseY+1.2,881.06);gate.rotation.y=yaw;
  // Photo 00 has a flat stone enclosure to the right; do not cover it with the
  // previously guessed 16 m church roof or add the unsupported rooftop cross.
  // A modest irregular flagstone court follows local ground beyond the entry.
  const courtPos=[],courtCol=[],courtIdx=[],courtRng=new RNG(561);
  for(let x=3007.8;x<3014;x+=1.1)for(let z=886.7;z<891;z+=1.05){
    const q=route.project(x,z);if(Math.abs(q.u)<route.edge(q.s)+2||pointInPoly(x,z,footprint))continue;
    const n=courtPos.length/3,shade=courtRng.range(.65,.94),tint=new THREE.Color().setRGB(shade*.79,shade*.79,shade*.70);
    for(const [dx,dz] of [[.05,.03],[1.03,.1],[1.04,.94],[.06,1.0]]){
      courtPos.push(x+dx,heightC(x+dx,z+dz)+.055,z+dz);courtCol.push(tint.r,tint.g,tint.b);
    }courtIdx.push(n,n+2,n+1,n,n+3,n+2);
  }
  const court=new THREE.BufferGeometry();court.setAttribute('position',new THREE.Float32BufferAttribute(courtPos,3));court.setAttribute('color',new THREE.Float32BufferAttribute(courtCol,3));court.setIndex(courtIdx);court.computeVertexNormals();
  mesh(court,std('#ffffff',{vertexColors:true,side:THREE.DoubleSide}),'Agios Petros flagstone court');
  // Photo62 confirms a kandylaki on a compound path, but gives no reliable map
  // position. It is documented in SOURCES and intentionally not geolocated here.

  // Small, real building footprints at the town exit. Heights use bundle estimates;
  // neutral plaster and flat terraces avoid inventing detailed private properties.
  const villaWall=std('#d4c8b3',{map:TX.plaster_diff}),villaRoof=std('#a8a399',{map:TX.concrete_diff});
  const windowMat=std('#3f5657',{roughness:.35,metalness:.12});
  const windows=instances(box,windowMat,{far:750,shadow:false});
  for(const b of data.buildings||[]){
    if(String(b.id)==='368804380'||!b.p||b.p.length<6)continue;
    const bounds=polyBounds(b.p),bx=(bounds.x0+bounds.x1)/2,bz=(bounds.z0+bounds.z1)/2,by=heightC(bx,bz),h=clamp(b.h||5.5,2.8,11);
    const sh=new THREE.Shape();for(let i=0;i<b.p.length;i+=2){i?sh.lineTo(b.p[i]-bx,bz-b.p[i+1]):sh.moveTo(b.p[i]-bx,bz-b.p[i+1]);}sh.closePath();
    const g=new THREE.ExtrudeGeometry(sh,{depth:h,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(bx,by,bz);
    const building=mesh(g,villaWall,'OSM building '+b.id);building.castShadow=true;
    const roof=new THREE.ShapeGeometry(sh);roof.rotateX(-Math.PI/2);roof.translate(bx,by+h+.03,bz);mesh(roof,villaRoof,'villa-terrace');
    for(let i=0;i+3<b.p.length;i+=2){
      const ax=b.p[i],az=b.p[i+1],dx=b.p[i+2]-ax,dz=b.p[i+3]-az,L=Math.hypot(dx,dz);if(L<4)continue;
      for(let t=2;t<L-1.5;t+=3.2)for(let yy=1.8;yy<h-.5;yy+=3){
        windows.addTRS(ax+dx*t/L,by+yy,az+dz*t/L,Math.atan2(-dz,dx),1,.95,.10);
      }
    }
  }

  // All unused OSM arms are rendered and contacted by RoadNetwork. A second
  // decorative EP29 strip would overlap that surface and bypass its contacts.

  for(const b of buckets){b.build(group);b.cells.clear();}
  group.userData.reconstruction='Street View roadside inventory; OSM footprints; reconstructed cuts and vegetation';
  group.userData.treeCount=pines.reduce((n,p)=>n+p.trunk.meshes.reduce((m,o)=>m+o.count,0),0);
  let disposed=false;
  return {group,road,ground:new PenteliGround(map,heightC,{...assets,rails},road),assets:{rails},dispose(){
    if(disposed)return;disposed=true;road.dispose?.();group.removeFromParent();
    // Shared TX textures and LabelAtlas materials belong to the application.
    for(const g of geos)g.dispose();for(const m of mats)m.dispose();for(const t of ownedTextures)t.dispose();group.clear();
  }};
}
