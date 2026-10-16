// One atlas, no per-car GPU textures. The flag controls every mounting.
import * as THREE from 'three';
import { loadCompressedTexture } from './compressed-textures.js';
import { textureCodecsEnabled } from './asset-metrics.js';
export const BRAND_BADGES = {
  alfaromeo: { enabled:true, cell:0 },
  bmw: { enabled:true, cell:1 },
  fiat: { enabled:true, cell:2 },
  honda: { enabled:true, cell:3 },
  lamborghini: { enabled:true, cell:4 },
  mazda: { enabled:true, cell:5 },
  mercedes: { enabled:true, cell:6 },
  mini: { enabled:true, cell:7 },
  porsche: { enabled:true, cell:8 },
  seat: { enabled:true, cell:9 },
  skoda: { enabled:true, cell:10 },
  toyota: { enabled:true, cell:11 },
  volkswagen: { enabled:true, cell:12 },
};
const BRANDS={panda:'fiat',jazz:'honda',yaris:'toyota',gr_yaris:'toyota',corolla:'toyota',ibiza:'seat',golf:'volkswagen',mini:'mini',mini_hardtop:'mini',mini_jcw:'mini',z4:'bmw',e36:'bmw',carrera:'porsche',aventador:'lamborghini',huracan:'lamborghini',gtv:'alfaromeo',octavia:'skoda',taxi:'skoda',superb:'skoda',police_octavia:'skoda',gla:'mercedes',gla45:'mercedes',cla:'mercedes',cle:'mercedes',mx5:'mazda'};
export function badgeBrand(spec){return spec.marque||BRANDS[spec.body]||BRANDS[spec.id];}
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
  m.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * .25 + vec2(${(cell%4/4).toFixed(2)},${(1-(Math.floor(cell/4)+1)/4).toFixed(2)});\n#endif`);};
  m.customProgramCacheKey=()=>`brand-badge-${cell}`;materials.set(cell,m);return m;
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
    if(existing||d.mercedes)continue;
    const hood=sign<0&&car.modelKind==='huracan';
    const y=sign<0?d.front-.04:car.modelKind==='gr_yaris'?.87:d.rear-.09;
    const origin=body.localToWorld(hood?new THREE.Vector3(0,1.1,-d.L/2+.19):new THREE.Vector3(0,y,sign*(d.L/2+.5))),direction=(hood?new THREE.Vector3(0,-1,0):new THREE.Vector3(0,0,-sign)).transformDirection(body.matrixWorld);
    const hit=new THREE.Raycaster(origin,direction,0,1.5).intersectObjects(shells,false)[0];if(!hit)continue;
    const badge=new THREE.Mesh(new THREE.PlaneGeometry(.115,.115),M.badge);badge.name=sign<0?'brand-badge-front':'brand-badge-rear';
    badge.position.copy(body.worldToLocal(hit.point));
    badge.position.z+=sign*.003;badge.rotation.y=sign<0?Math.PI:0;
    body.add(badge);
  }
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
