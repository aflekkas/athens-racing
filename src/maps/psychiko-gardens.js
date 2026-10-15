// Psychiko-specific assemblies over the shared instancing, scanned textures and fleet kit.
import * as THREE from 'three';
import { CellInstances, GeoBatch, M, RNG, pointInPoly } from '../util.js';
import { TRAFFIC_TYPES, trafficModel } from '../cars.js';
import { bakeParkedFleet } from '../traffic-fleet.js';

const WHITE='#e7e3d8',IRON='#29473e',STONE='#b5a78e';
const flat=()=>new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88});
function template(draw){const batch=new GeoBatch();const box=(x,y,z,w,h,d,c)=>{const g=new THREE.BoxGeometry(w,h,d);batch.add(g,M(x,y,z),c);g.dispose();};draw(box,batch);return batch.build();}
function wallGeometry(type){return template(box=>{
 const h=type===4?2.55:type===2?1.95:type===1?1.55:.72;
 box(0,h/2,0,.4,h,5.95,type===1?'#38553a':type===2?WHITE:STONE);
 if(type===0||type===3){
  for(const z of [-2.85,0,2.85])box(0,1.05,z,.48,2.1,.36,WHITE);
  for(let z=-2.65;z<2.7;z+=.2)box(0,1.35,z,.055,1.15,.045,IRON);
  for(const y of [.86,1.85])box(0,y,0,.065,.06,5.6,IRON);
  if(type===3)box(0,.85,0,.075,1.5,2.8,IRON);
 }
 box(0,h+.04,0,.5,.09,5.98,type===1?'#426039':'#c4b79f');
 });}
function lampGeometry(avenue){return template((box,batch)=>{
 const color=avenue?IRON:'#92958e',h=avenue?5.5:7.2;
 box(0,h/2,0,avenue?.12:.22,h,avenue?.12:.22,color);
 const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,h-.2,0),new THREE.Vector3(0,h+.3,-.25),new THREE.Vector3(0,h+.23,-.75),new THREE.Vector3(0,h-.05,-.9)]);
 const arm=new THREE.TubeGeometry(curve,8,avenue?.045:.055,5,false);batch.add(arm,M(),color);arm.dispose();
 const bell=new THREE.CylinderGeometry(.12,.3,.22,10,1,true);batch.add(bell,M(0,h-.15,-.9),'#e9dfba');bell.dispose();box(0,h-.27,-.9,.32,.025,.32,'#fff2ce');
 });}
function boundaryMaterial(){const m=flat();m.customProgramCacheKey=()=> 'psychiko-property-boundaries-v1';m.onBeforeCompile=sh=>{
 sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 pWall;').replace('#include <begin_vertex>','#include <begin_vertex>\npWall=position;');
 sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 pWall;').replace('#include <color_fragment>',`#include <color_fragment>
  if(vColor.r>.25 && vColor.g<vColor.r*.96){vec2 q=vec2(pWall.z,pWall.y)/vec2(.52,.24);q.x+=floor(q.y)*.43;float mortar=step(.065,fract(q.x))*step(.09,fract(q.y));float v=fract(sin(dot(floor(q),vec2(127.1,311.7)))*43758.5453);diffuseColor.rgb*=mix(.70,.86+v*.28,mortar);}
 `);};return m;}
function surfaceGeometry(cx,cz,radius,height,ring=false){const p=[],uv=[],idx=[],n=64;for(let i=0;i<=n;i++){const a=i/n*Math.PI*2;for(const r of ring?[radius-2,radius]:[0,radius]){const x=cx+Math.sin(a)*r,z=cz+Math.cos(a)*r;p.push(x,height(x,z),z);uv.push(x,z);}if(i<n){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;}

export function buildPsychikoGardens(map,scene,heightC,buildings,assets){
 const spec=map.data.psychiko.scenery,root=new THREE.Group();root.name='psychiko-properties';scene.add(root);
 const h=(x,z)=>Math.max(heightC(x,z),map.roadNetwork?.height(x,z)-.2||0);
 const schoolRails=new CellInstances(template(box=>{for(const z of [-2.8,0,2.8])box(0,.48,z,.065,.96,.065,IRON);for(const y of [.2,.85])box(0,y,0,.055,.055,5.9,IRON);}),flat(),{cell:240,far:350});
 const walls=[0,1,2,3,4].map(type=>new CellInstances(wallGeometry(type),boundaryMaterial(),{cell:200,far:280}));
 for(const [x,z,yaw,len,type,height] of spec.frontages)walls[type].add(M(x,h(x,z),z,0,yaw,0,1,height/(type===4?2.55:type===2?1.95:type===1?1.8:1.9),len/5.95));
 for(const [x,z,yaw,len,type] of spec.frontages)if(type===4){const px=x-Math.cos(yaw)*1.1,pz=z+Math.sin(yaw)*1.1;schoolRails.add(M(px,h(px,pz)+.14,pz,0,yaw));}
 for(const w of [...walls,schoolRails])w.build(root);
 const lamps=[false,true].map(a=>new CellInstances(lampGeometry(a),flat(),{cell:240,far:320}));
 const bins=new CellInstances(template(box=>{box(0,.57,0,1.15,1.1,.85,'#2b5444');box(0,1.15,0,1.22,.12,.92,IRON);for(const x of [-.48,.48])box(x,.12,.35,.12,.24,.2,'#242a28');}),flat(),{cell:280,far:200});
 const blueBins=new CellInstances(template(box=>{box(0,.6,0,1.15,1.15,.85,'#347aa1');box(0,1.22,0,1.22,.12,.92,'#25566c');}),flat(),{cell:280,far:200});
 const cableGeo=new THREE.CylinderGeometry(.012,.012,1,4),cables=new CellInstances(cableGeo,new THREE.MeshStandardMaterial({color:'#303a34',roughness:1}),{cell:350,far:230,shadow:false});
 const previous=new Map();
 for(let i=0;i<spec.furniture.length;i++){
  const [x,z,yaw,kind,street]=spec.furniture[i],y=h(x,z),avenue=kind==='lamp';lamps[+avenue].add(M(x,y,z,0,yaw));
  if(!avenue){const cell=Math.floor(x/50)+','+Math.floor(z/50),p=previous.get(cell);if(p&&Math.hypot(x-p[0],z-p[2])<42){for(const offset of [-.16,.16])for(let j=0;j<4;j++){
   const a=new THREE.Vector3(p[0]+offset,p[1]+7-Math.sin(j/4*Math.PI)*.5,p[2]),b=new THREE.Vector3(x+offset,y+7,z),t=(j+1)/4;
   const end=new THREE.Vector3(p[0]+(x-p[0])*t+offset,p[1]+(y-p[1])*t+7-Math.sin(t*Math.PI)*.5,p[2]+(z-p[2])*t),start=j===0?a:new THREE.Vector3(p[0]+(x-p[0])*j/4+offset,p[1]+(y-p[1])*j/4+7-Math.sin(j/4*Math.PI)*.5,p[2]+(z-p[2])*j/4);
   const d=end.clone().sub(start),m=new THREE.Matrix4().compose(start.add(end).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize()),new THREE.Vector3(1,d.length(),1));cables.add(m);
  }}previous.set(cell,[x,y,z]);}
  if(i%5===0){bins.add(M(x,y,z,0,yaw));if(i%10===0)blueBins.add(M(x+Math.cos(yaw)*1.4,y,z-Math.sin(yaw)*1.4,0,yaw));}
  if(i%7===0){const label=assets.makeLabel(street==='avenue'?'ΟΔΟΣ ΔΙΑΜΑΝΤΙΔΟΥ':'ΟΔΟΣ · ΨΥΧΙΚΟ',.65,.25,'#245a8d','#ffffff');label.position.set(x,y+2.3,z);label.rotation.y=yaw;root.add(label);}
 }
 for(const a of [...lamps,bins,blueBins,cables])a.build(root);
 // Shared fleet templates, flattened once per type then instanced by cell, rather than one detailed car per space.
 const types=TRAFFIC_TYPES.filter(t=>!t.police&&!t.scooter&&!t.bus&&t.len<4.8&&t.wid<1.95).slice(0,4),rng=new RNG(38125);
 const templates=types.slice(0,2).map(t=>{const c=trafficModel(t,'#ffffff',rng,{parked:true});return bakeParkedFleet([c],240);});
 const carBatches=templates.map(t=>{t.updateMatrixWorld(true);const batches=[];t.traverse(o=>{if(!o.isMesh)return;const g=o.geometry.clone();if(o.isInstancedMesh){const m=new THREE.Matrix4();o.getMatrixAt(0,m);g.applyMatrix4(m);}else g.applyMatrix4(o.matrixWorld);batches.push(new CellInstances(g,o.material,{cell:120,far:140,colors:true,shadow:false}));});return batches;});
 const colors=['#e6e6df','#aaaead','#444b51','#252b30','#c7c9c4','#535d63','#37536d','#974c43'];
 for(const [x,z,yaw,c] of spec.parking)for(const b of carBatches[c%carBatches.length]||[])b.add(M(x,h(x,z)+.14,z,0,yaw),colors[c]);
 for(const a of carBatches.flat())a.build(root);
 for(const q of spec.squares){const [x,z]=q.center,base=(a,b)=>h(a,b)+.18;const lawn=new THREE.Mesh(surfaceGeometry(x,z,q.radius,base),new THREE.MeshStandardMaterial({color:'#657b43',roughness:1,side:THREE.DoubleSide}));lawn.receiveShadow=true;root.add(lawn);
  const path=new THREE.Mesh(surfaceGeometry(x,z,q.radius+1.8,(a,b)=>h(a,b)+.22,true),new THREE.MeshStandardMaterial({color:q.pink?'#c49c91':'#b8b4a6',roughness:.95,side:THREE.DoubleSide}));path.receiveShadow=true;root.add(path);
 }
 // OSM-exact hip roofs; the existing facade kit supplies balconies, shutters and solar heaters on flat roofs.
 const roofBatch=new GeoBatch();
 for(const b of buildings.roofs){if(!b.pitched||!pointInPoly(b.cx,b.cz,b.p))continue;const n=b.p.length/2,rise=Math.min(3.5,Math.min(b.bb.x1-b.bb.x0,b.bb.z1-b.bb.z0)*.24),p=[],uv=[];
  for(let i=0;i<n;i++){const j=(i+1)%n;for(const [x,y,z] of [[b.p[i*2],b.top,b.p[i*2+1]],[b.cx,b.top+rise,b.cz],[b.p[j*2],b.top,b.p[j*2+1]]]){p.push(x,y,z);uv.push(x*2,z*2);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();roofBatch.add(g,M(),b.cx%2?'#a8674c':'#b98265');g.dispose();
 }
 if(roofBatch.count){const mat=flat();mat.side=THREE.DoubleSide;mat.customProgramCacheKey=()=> 'psychiko-roof-tiles-v1';mat.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 tileUV;').replace('#include <begin_vertex>','#include <begin_vertex>\ntileUV=uv;');sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 tileUV;').replace('#include <color_fragment>','#include <color_fragment>\nvec2 tq=tileUV*vec2(2.5,2.);float seam=step(.08,fract(tq.x))*step(.08,fract(tq.y));diffuseColor.rgb*=.66+.34*seam;');};const roof=new THREE.Mesh(roofBatch.build(),mat);roof.castShadow=true;roof.receiveShadow=true;root.add(roof);}
 return {group:root,obstacles:[]}; // All added props are visual; collision authority stays with the mapped roads/buildings/closures.
}
