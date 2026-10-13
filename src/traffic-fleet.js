// Shared geometry and distance detail for the Athens fleet. Builders author metres, nose -Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPassengerModel } from './traffic-passenger-models.js';
import { buildCommercialModel } from './traffic-commercial-models.js';
import { buildBikeModel } from './traffic-bike-models.js';
import { buildPoliceModel } from './police-models.js';
import { damageSystem, makePlateMaterial, nextRegistration } from './vehicle-models.js';
import { RNG } from './util.js';

const templates=new Map();
const trimMaterial=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.65,metalness:.12,side:THREE.DoubleSide});
function builder(type){return type.police?buildPoliceModel:type.scooter?buildBikeModel:type.bus||type.id==='van'||type.id==='truck'?buildCommercialModel:buildPassengerModel;}
function geometryOf(o,matrix,colored=false){
  let g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(matrix);
  for(const key of Object.keys(g.attributes))if(!['position','normal','uv',...(colored?['color']:[])].includes(key))g.deleteAttribute(key);
  if(!g.attributes.normal)g.computeVertexNormals();
  if(!g.attributes.uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
  if(colored&&!g.attributes.color){const color=o.material.color||new THREE.Color('white'),a=new Float32Array(g.attributes.position.count*3);for(let i=0;i<a.length;i+=3){a[i]=color.r;a[i+1]=color.g;a[i+2]=color.b;}g.setAttribute('color',new THREE.Float32BufferAttribute(a,3));}
  return g;
}
// Preserve named deformation/detachment parts near the camera, and bake harmless trim together.
function compact(parent,car,preserveParts){
  parent.updateMatrixWorld(true);const inv=parent.matrixWorld.clone().invert(),buckets=new Map(),parts=[];
  const visit=o=>{
    if(o!==parent&&preserveParts&&o.userData.damagePart){parts.push(o);return;}
    if(o.isMesh&&!Array.isArray(o.material)){
      const m=o.material,plain=!m.transparent&&!m.map&&m!==car.paint&&m!==car.tail&&m!==car.materials.head&&m!==car.materials.led&&!car.strobeMaterials?.includes(m);
      const material=plain?trimMaterial:m;
      // A taxi roof sign can share the cheap headlamp material, but is not a front lamp.
      const damagePart=!preserveParts&&!o.name.includes('taxi-sign')?(material===car.materials.head||material===car.materials.led?'light_front':material===car.tail?'light_rear':null):null;
      const key=material.uuid+':'+(damagePart||'');
      if(!buckets.has(key))buckets.set(key,{material,damagePart,geos:[],objects:[]});const b=buckets.get(key);
      b.geos.push(geometryOf(o,inv.clone().multiply(o.matrixWorld),plain));b.objects.push(o);
    }
    for(const child of o.children)visit(child);
  };
  for(const child of parent.children)visit(child);
  for(const {material,damagePart,geos,objects}of buckets.values()){
    const geometry=mergeGeometries(geos,false);if(!geometry)continue;
    const mesh=new THREE.Mesh(geometry,material);mesh.name=material.transparent?'fleet-glass':'fleet-assembly';mesh.castShadow=preserveParts&&!material.transparent;mesh.receiveShadow=true;
    // Low detail still needs semantic lamp batches: damage and night lighting run on both levels.
    if(damagePart)mesh.userData.damagePart=damagePart;
    for(const o of objects)o.removeFromParent();parent.add(mesh);for(const g of geos)g.dispose();
  }
  for(const part of parts)if(!part.isMesh)compact(part,car,false);
}
function template(type,low,parked){
  const key=type.id+':'+Number(!!type.taxi)+':'+Number(low)+':'+Number(parked);
  if(templates.has(key))return templates.get(key);
  const car=builder(type)(type,'#ffffff',new RNG(139),{low,parked});
  compact(car.body,car,!low);
  for(const w of car.wheels){compact(w.spin,car,false);for(const child of [...w.pivot.children])if(child!==w.spin&&child.isGroup)compact(child,car,false);}
  let i=0;car.root.traverse(o=>{o.name=o.name||'fleet-node-'+i;o.userData.fleetNode=i++;if(o.geometry)o.geometry.userData.shared=true;
    // Template textures (e.g. the 256x64 TAXI label) live as long as this module cache and are shared by every clone
    // (material.clone() keeps .map): like the geometry, never owned by a map world, never disposed with one.
    for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])for(const v of Object.values(m))if(v?.isTexture&&!v.userData.shared){v.userData.shared=true;v.name=v.name||'fleet-template:'+key+':'+(o.name||'tex');}});
  templates.set(key,car);return car;
}
// Parked plates share one atlas instead of allocating hundreds of 512-pixel textures.
let atlas=null;
function parkedPlate(number){
  if(!atlas||atlas.count===1024){const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=2048;const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.name='fleet-plate-atlas';map.userData.shared=true;atlas={canvas,ctx:canvas.getContext('2d'),map,count:0,material:new THREE.MeshStandardMaterial({map,roughness:.5})};}
  const slot=atlas.count++,x=slot%16*128,y=Math.floor(slot/16)*32,g=atlas.ctx;
  g.fillStyle='#e9e9e1';g.fillRect(x,y,128,32);g.fillStyle='#174582';g.fillRect(x,y,12,32);g.fillStyle='white';g.font='7px Arial';g.fillText('GR',x+1,y+27);g.fillStyle='#111820';g.font='bold 19px Arial';g.textAlign='center';g.fillText(number,x+70,y+23,110);g.textAlign='start';g.strokeStyle='#24282b';g.strokeRect(x+.5,y+.5,127,31);atlas.map.needsUpdate=true;
  return {material:atlas.material,uv:[x/2048,1-(y+32)/2048,128/2048,32/2048]};
}
function cloneTemplate(t,color,plateMaterial,plateUV){
  const root=t.root.clone(true),nodes=new Map(),materials=new Map();root.traverse(o=>nodes.set(o.userData.fleetNode,o));
  const cloneMat=m=>{if(m===t.materials.plate)return plateMaterial;if(!materials.has(m)){const n=m.clone();if(m===t.paint)n.color.set(color);materials.set(m,n);}return materials.get(m);};
  root.traverse(o=>{if(!o.isMesh)return;const wasPlate=o.material===t.materials.plate;o.material=Array.isArray(o.material)?o.material.map(cloneMat):cloneMat(o.material);if(wasPlate&&plateUV){o.geometry=o.geometry.clone();const uv=o.geometry.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,plateUV[0]+uv.getX(i)*plateUV[2],plateUV[1]+uv.getY(i)*plateUV[3]);o.geometry.userData.shared=false;}});
  const car={root,body:nodes.get(t.body.userData.fleetNode),paint:cloneMat(t.paint),tail:cloneMat(t.tail),materials:Object.fromEntries(Object.entries(t.materials).map(([k,m])=>[k,m?.isMaterial?cloneMat(m):m])),dims:{...t.dims},shape:t.shape,modelKind:t.modelKind,spec:{...t.spec,color},wheels:t.wheels.map(w=>({...w,pivot:nodes.get(w.pivot.userData.fleetNode),spin:nodes.get(w.spin.userData.fleetNode),caliper:w.caliper?nodes.get(w.caliper.userData.fleetNode):null}))};
  if(t.strobeMaterials){car.strobeMaterials=t.strobeMaterials.map(cloneMat);car.setStrobe=(on,time=0)=>{const phase=((Number(time)||0)%.64+.64)%.64,side=phase<.32?0:1,p=phase%.32,flash=p<.065||(p>=.105&&p<.17);car.strobeMaterials.forEach((m,i)=>m.emissiveIntensity=on&&flash&&i===side?9:0);};}
  return car;
}
function attachLevels(near,far){
  const root=near.root,nearBody=near.body,body=new THREE.Group();root.remove(nearBody);body.add(nearBody,far.body);root.add(body);near.body=body;
  const nearNodes=[nearBody],farNodes=[far.body];
  // One physical pivot/spin hierarchy drives both visual wheel levels.
  for(let i=0;i<near.wheels.length;i++){
    const a=near.wheels[i],b=far.wheels[i],n=new THREE.Group(),f=new THREE.Group();
    for(const o of [...a.spin.children])n.add(o);for(const o of [...b.spin.children])f.add(o);a.spin.add(n,f);nearNodes.push(n);farNodes.push(f);
    for(const o of [...a.pivot.children])if(o!==a.spin)nearNodes.push(o);
  }
  const replace=new Map([[far.paint,near.paint],[far.tail,near.tail],[far.materials.plate,near.materials.plate]]);
  if(near.strobeMaterials)far.strobeMaterials.forEach((m,i)=>replace.set(m,near.strobeMaterials[i]));
  for(const n of farNodes)n.traverse(o=>{if(o.isMesh&&replace.has(o.material))o.material=replace.get(o.material);});
  let detailed=null;near.setLOD=distance=>{const next=Number(distance)<(detailed?65:55);if(next===detailed)return;detailed=next;for(const o of nearNodes)o.visible=next;for(const o of farNodes)o.visible=!next;near.lodLevel=next?0:1;};
  near.setLOD(0);return near;
}
export function fleetModel(type,color,rng,opts={}){
  const parked=!!opts.parked,plate=nextRegistration(!!type.taxi),p=parked?parkedPlate(plate):{material:makePlateMaterial(plate)};
  const lowOnly=parked||!!opts.low,t=template(type,lowOnly,parked),car=cloneTemplate(t,color,p.material,p.uv);car.plate=plate;car.spec.id=type.id;car.spec.engineZone=type.bus?'rear':'front';
  if(!lowOnly){const far=cloneTemplate(template(type,true,false),color,p.material);attachLevels(car,far);}
  else{car.lodLevel=1;car.setLOD=()=>{};}
  car.setLights=on=>{car.lightsOn=!!on;car.root.traverse(o=>{if(!o.isMesh||!o.userData.damagePart?.startsWith('light_f'))return;const m=o.material;if(m.userData.damageBroken)return;if(m.emissive){m.emissive.set(on?'#fff1df':'#182129');m.emissiveIntensity=on?5:0;}});};
  car.damageCheap=true;damageSystem(car);
  if(parked)car.makeNear=()=>{
    const n=cloneTemplate(template(type,false,true),color,p.material,p.uv);n.plate=plate;n.root.position.copy(car.root.position);n.root.quaternion.copy(car.root.quaternion);n.root.scale.copy(car.root.scale);return n;
  };
  return car;
}

function bake(models,origin){
  const group=new THREE.Group(),buckets=new Map();
  for(const car of models){car.root.updateMatrixWorld(true);car.root.traverseVisible(o=>{if(!o.isMesh)return;const m=o.material;if(Array.isArray(m))return;
    const colored=!m.map&&!m.transparent&&m!==car.tail,material=colored?trimMaterial:m,key=colored?'color':m.map?.uuid||[m.color?.getHex(),m.transparent,m.opacity,m.emissive?.getHex()].join(':');
    if(!buckets.has(key))buckets.set(key,{material,geos:[]});
    const matrix=new THREE.Matrix4().makeTranslation(-origin.x,0,-origin.z).multiply(o.matrixWorld);buckets.get(key).geos.push(geometryOf(o,matrix,colored));
  });}
  for(const {material,geos}of buckets.values()){const geometry=mergeGeometries(geos,false);if(geometry){const mesh=new THREE.Mesh(geometry,material);mesh.receiveShadow=true;group.add(mesh);}for(const g of geos)g.dispose();}
  return group;
}
class ParkingCell extends THREE.LOD{
  constructor(models,origin){super();this.models=models;this.origin=origin;this.position.copy(origin);this.low=bake(models,origin);this.addLevel(this.low,0);this.near=null;this.userData.parkingCell=true;}
  update(camera){
    const distance=camera.position.distanceTo(this.position);
    if(distance<75&&!this.near){this.near=bake(this.models.map(m=>m.makeNear()),this.origin);this.levels.length=0;this.addLevel(this.near,0);this.addLevel(this.low,75,.12);}
    if(distance>230&&this.near){this.near.traverse(o=>o.geometry?.dispose());this.remove(this.near);this.near=null;this.levels.length=0;this.addLevel(this.low,0);this.low.visible=true;}
    super.update(camera);
  }
}
export function bakeParkedFleet(models,cell=40){
  const group=new THREE.Group(),cells=new Map();
  for(const car of models){const p=car.root.position,key=Math.floor(p.x/cell)+','+Math.floor(p.z/cell);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(car);}
  for(const cars of cells.values()){const origin=new THREE.Vector3();for(const c of cars)origin.add(c.root.position);origin.multiplyScalar(1/cars.length);origin.y=0;group.add(new ParkingCell(cars,origin));}
  return group;
}
