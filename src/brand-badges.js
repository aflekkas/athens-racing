// One atlas, no per-car GPU textures. The flag controls every mounting.
import * as THREE from 'three';
import { loadCompressedTexture } from './compressed-textures.js';
import { textureCodecsEnabled } from './asset-metrics.js';
import { BRAND_BADGES, badgeBrand } from './manufacturers.js';
export { BRAND_BADGES, badgeBrand } from './manufacturers.js';
let atlas;const materials=new Map();
export function brandBadgeMaterial(spec){
  const brand=badgeBrand(spec),entry=BRAND_BADGES[brand],cell=entry?.enabled?entry.cell:15;
  if(materials.has(cell))return materials.get(cell);
  if(!atlas){
    atlas=new THREE.Texture();atlas.colorSpace=THREE.SRGBColorSpace;atlas.anisotropy=1;atlas.name='shared-brand-badges';
    const fallback=()=>new THREE.ImageLoader().load('/assets/brand-badges/atlas.svg',image=>{atlas.image=image;atlas.needsUpdate=true;});
    if(!textureCodecsEnabled())fallback();
    else void loadCompressedTexture(atlas,'/assets/brand-badges/atlas.svg').then(loaded=>{if(!loaded)fallback();});
  }
  const m=new THREE.MeshStandardMaterial({map:atlas,transparent:true,depthWrite:false,roughness:.3,metalness:.25,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  m.name='brand-badge';m.userData.brandBadge=true;
  m.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * vec2(.25,.20) + vec2(${(cell%4/4).toFixed(2)},${(1-(Math.floor(cell/4)+1)/5).toFixed(2)});\n#endif`);};
  m.customProgramCacheKey=()=>`brand-badge-${cell}`;materials.set(cell,m);return m;
}
// Rear trim lettering is authored as a flat plane at the nominal tail line. Seat it on the finished boot or
// tailgate skin (following the chord across its width) and slide it clear of the tail lamps.
function seatTrimBadges(car,shells){
  const body=car.body,d=car.shape,badges=[];body.traverse(o=>{if(o.isMesh&&o.name==='trim-badge')badges.push(o);});
  if(!badges.length)return;
  const lamps=[];body.traverse(o=>{if(o.isMesh&&o.name!=='trim-badge'&&(o.material===car.tail||o.material===car.materials.plate||/^light_r/.test(o.userData.damagePart||''))){
    const b=new THREE.Box3().setFromObject(o);b.min.copy(body.worldToLocal(b.min.clone()));b.max.copy(body.worldToLocal(b.max.clone()));if(b.min.z>d.L*.3&&b.max.y>.3)lamps.push(b);}});
  const dir=new THREE.Vector3(0,0,-1).transformDirection(body.matrixWorld),caster=new THREE.Raycaster();caster.far=2;
  const zAt=(x,y)=>{caster.set(body.localToWorld(new THREE.Vector3(x,y,d.L/2+.5)),dir);const hit=caster.intersectObjects(shells,false)[0];return hit?body.worldToLocal(hit.point.clone()).z:null;};
  for(const badge of badges){
    const {width:w,height:h}=badge.geometry.parameters,x0=Math.abs(badge.position.x),y0=badge.position.y,margin=.02;
    const clear=(x,y)=>!lamps.some(b=>b.min.x<x+w/2+margin&&b.max.x>x-w/2-margin&&b.min.y<y+h/2+margin&&b.max.y>y-h/2-margin);
    let best=[x0,y0];
    search:for(let dy=0;dy>=-.4;dy-=.02)for(let x=x0;x>=.1+w/2;x-=.02)if(clear(x,y0+dy)){best=[x,y0+dy];break search;}
    const [x,y]=best,left=zAt(x-w/2,y),mid=zAt(x,y),right=zAt(x+w/2,y);
    if(mid===null)continue;
    badge.position.set(x,y,Math.max(mid,left??mid,right??mid)+.004);badge.rotation.y=-Math.atan2((right??mid)-(left??mid),w);
  }
}
// Body construction uses varied shell shapes. Seat missing medallions on the
// actual end-cap surface rather than guessing a Z plane through the bodywork.
export function finishBrandBadges(car){
  const M=car.materials,body=car.body,d=car.shape;
  // Detailed wheel discs are built facing +X on both sides. Turn left caps
  // outward so the driver-side logo is not a mirrored back-face rendering.
  for(const wheel of car.wheels)wheel.spin.traverse(o=>{
    if(!o.isMesh||o.material!==M.badge)return;
    o.updateMatrix();const n=new THREE.Vector3().fromBufferAttribute(o.geometry.attributes.normal,0).transformDirection(o.matrix);
    if(n.x*wheel.side<0)o.rotateY(Math.PI);
  });
  body.traverse(o=>{if(o.isMesh&&o.name==='manufacturer-emblem')o.material=M.badge;});
  body.updateWorldMatrix(true,true);
  const shells=[];body.traverse(o=>{if(o.isMesh&&!o.material.transparent&&o.geometry?.attributes.position)shells.push(o);});
  for(const sign of [-1,1]){
    let existing=false;body.traverse(o=>{if(o.isMesh&&o.material===M.badge){const p=body.worldToLocal(o.getWorldPosition(new THREE.Vector3()));if(sign*p.z>d.L*.3)existing=true;}});
    if(existing||(d.mercedes&&!d.a160))continue;
    const hood=sign<0&&car.modelKind==='huracan';
    const y=sign<0?d.front-.04:car.modelKind==='gr_yaris'?.87:d.rear-.09;
    const origin=body.localToWorld(hood?new THREE.Vector3(0,1.1,-d.L/2+.19):new THREE.Vector3(0,y,sign*(d.L/2+.5))),direction=(hood?new THREE.Vector3(0,-1,0):new THREE.Vector3(0,0,-sign)).transformDirection(body.matrixWorld);
    const hit=new THREE.Raycaster(origin,direction,0,1.5).intersectObjects(shells,false)[0];if(!hit)continue;
    const badge=new THREE.Mesh(new THREE.PlaneGeometry(.115,.115),M.badge);badge.name=sign<0?'brand-badge-front':'brand-badge-rear';
    badge.position.copy(body.worldToLocal(hit.point));
    badge.position.z+=sign*.003;badge.rotation.y=sign<0?Math.PI:0;
    body.add(badge);
  }
  seatTrimBadges(car,shells);
  // Seat both inherited and new artwork against the finished body (the sports
  // refinements can put a curved panel or grille in front of the old flat disk).
  const badges=[];body.traverse(o=>{if(o.isMesh&&o.material===M.badge)badges.push(o);});
  body.updateWorldMatrix(true,true);
  for(const badge of badges){
    const centre=body.worldToLocal(badge.getWorldPosition(new THREE.Vector3()));
    if(Math.abs(centre.z)<d.L*.3)continue;
    // The other models already have authored mounts; do not snap a hood
    // medallion onto a neighbouring grille slat or move a rear mesh badge.
    if(!['carrera','gr_yaris'].includes(car.modelKind)&&!(car.modelKind==='huracan'&&centre.z<0))continue;
    const sign=Math.sign(centre.z),hood=badge.name==='carrera-bonnet-crest'||(car.modelKind==='huracan'&&sign<0);
    const origin=body.localToWorld(hood?new THREE.Vector3(centre.x,d.H+.2,centre.z):new THREE.Vector3(centre.x,centre.y,sign*(d.L/2+.5)));
    const direction=(hood?new THREE.Vector3(0,-1,0):new THREE.Vector3(0,0,-sign)).transformDirection(body.matrixWorld);
    const hit=new THREE.Raycaster(origin,direction,0,2).intersectObjects(shells,false)[0];if(!hit)continue;
    const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);if(normal.dot(direction)>0)normal.negate();
    const up=(hood?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0)).transformDirection(body.matrixWorld);
    up.addScaledVector(normal,-up.dot(normal)).normalize();const right=up.clone().cross(normal).normalize();
    const orientation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,normal));
    badge.position.copy(badge.parent.worldToLocal(hit.point.clone().addScaledVector(normal,.006)));
    badge.quaternion.copy(badge.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));
  }

}

// Last word on placement, run once the bodywork is final (compaction and LOD grouping can leave a model-specific crest sunk
// into a panel or standing well off it): look at every manufacturer mark from outside along its own facing and, when it is
// sunk or hovering more than 4 cm, slide it along that axis until it rests on the first skin it meets (a mark that sits a
// finger's width proud of a grille is authored that way). Wheel caps are seated by the wheel builders.
export function settleBadges(car){
  const body=car.body;if(!body)return 0;
  body.updateWorldMatrix(true,true);
  const hidden=o=>{for(let p=o;p&&p!==body;p=p.parent)if(p.name==='player-road-detail'||p.name==='player-distance-shell'||p.name==='cockpit-lod'||p.userData.vehicleCabin||p.userData.damageInterior)return true;return false;};
  const marks=[],shells=[];
  body.traverse(o=>{
    if(!o.isMesh||!o.geometry?.attributes.position||!o.visible||hidden(o))return;
    if([].concat(o.material).some(m=>m?.userData?.brandBadge)){marks.push(o);return;}
    if(!o.material.transparent&&!/cockpit|interior|seat|distant|distance|trim-badge/.test(o.name))shells.push(o);
  });
  const centre=body.localToWorld(new THREE.Vector3(0,(car.dims?.H||1.3)*.4,0)),caster=new THREE.Raycaster();caster.far=.45;
  let moved=0;
  for(const mark of marks){
    const c=new THREE.Box3().setFromObject(mark).getCenter(new THREE.Vector3());
    if(Math.abs(body.worldToLocal(c.clone()).z)<(car.dims?.L||4)*.3)continue;
    const normal=new THREE.Vector3(0,0,1).transformDirection(mark.matrixWorld),out=normal.dot(c.clone().sub(centre))>=0?normal:normal.negate();
    caster.set(c.clone().addScaledVector(out,.3),out.clone().negate());
    const hit=caster.intersectObjects(shells,false)[0];if(!hit)continue;
    const gap=hit.distance-.3;if(gap>-.004&&gap<.04)continue;if(Math.abs(gap)>.25)continue;
    const to=c.clone().addScaledVector(out,.004-gap);
    mark.position.add(mark.parent.worldToLocal(to.clone()).sub(mark.parent.worldToLocal(c.clone())));mark.updateMatrixWorld(true);moved++;
  }
  return moved;
}
