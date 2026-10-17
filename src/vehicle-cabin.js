import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Empty cabins share the same sealed foundation in POV, exterior and traffic.
// This geometry is attached after body batching/damage setup: a dented door may
// hide its trim, but must never remove the load-bearing footwell underneath it.
export function cabinDimensions(model){
 const d={...model.dims,...(typeof model.shape==='object'?model.shape:{})},seat=model.seat||(model.spec?.cameraRig?.eye?new T.Vector3(...model.spec.cameraRig.eye):null);
 const y=seat?Math.max(.20,Math.min(.38,seat.y-.78)):.30;
 const commercial=['bus','truck'].includes(model.spec?.nativeFleet||model.modelKind||model.shape);
 const front=d.cowl??(commercial?-model.dims.L/2+.25:-model.dims.L*.30);
 const seatZ=seat?.z??d.seatZ??(commercial?front+.85:.20);
 return {width:(d.W||model.dims.W)*.94,floor:commercial?(seat?.y??d.H*.68)-.88:y,
  front,
  back:commercial?seatZ+.65:Math.max((seat?.z??.2)+.55,(d.back??model.dims.L*.32)-.10),
  seatZ,seatY:commercial?(seat?.y??d.H*.68)-.66:y+.15,
  belt:d.belt??(seat?.y??(commercial?d.H*.68:1.15))-.2};
}
export function buildCabin(model,{cheap=false}={}){
 const d=cabinDimensions(model),group=new T.Group();group.name=cheap?'cabin-distance':'cabin-foundation';group.userData.vehicleCabin=true;
 const carpet=new T.MeshStandardMaterial({color:'#282a2c',roughness:1,side:T.DoubleSide});
 const upholstery=new T.MeshStandardMaterial({color:model.shape?.leather||'#454344',roughness:.82,side:T.DoubleSide});
 const bins=new Map();
 function box(size,pos,mat=carpet){const geo=new T.BoxGeometry(...size);geo.translate(...pos);if(!bins.has(mat))bins.set(mat,[]);bins.get(mat).push(geo);}
 const length=d.back-d.front,mid=(d.front+d.back)/2;
 box([d.width,.055,length+.10],[0,d.floor,mid]);
 box([d.width,.42,.07],[0,d.floor+.19,d.front]); // firewall meets the dash underside
 box([.20,.18,length],[0,d.floor+.105,mid]); // continuous transmission tunnel
 for(const sign of [-1,1])box([.08,Math.max(.24,d.belt-d.floor-.14),length],[sign*(d.width/2-.025),(d.belt+d.floor-.14)/2,mid]);
 box([d.width,.28,.07],[0,d.floor+.12,d.back]);
 const rows=[d.seatZ];if(d.back-d.seatZ>.95&&model.shape?.seats!==2)rows.push(Math.min(d.back-.36,d.seatZ+.76));
 for(const z of rows)for(const sign of [-1,1]){
  const x=sign*model.dims.W*.215;
  box([.43,.12,.44],[x,d.seatY,z-.03],upholstery);
  box([.43,.46,.10],[x,d.seatY+.26,z+.17],upholstery);
  box([.25,.15,.10],[x,d.seatY+.56,z+.18],upholstery);
  if(!cheap)for(const s of [-1,1])box([.055,.35,.13],[x+s*.19,d.seatY+.25,z+.12],upholstery);
 }
 if(cheap){
  box([d.width-.10,.18,.30],[0,d.belt-.10,d.front+.18]);
  box([.24,.24,.34],[0,d.floor+.31,d.front+.44]);
  const wheel=new T.TorusGeometry(.15,.015,4,12);wheel.rotateX(-.35);wheel.translate(-model.dims.W*.215,d.belt-.10,d.seatZ-.43);bins.get(carpet).push(wheel);
  for(const sign of [-1,1])box([.045,.25,length*.75],[sign*(d.width/2-.06),d.belt-.22,mid],upholstery);
 }
 for(const [material,geometries]of bins){const mesh=new T.Mesh(mergeGeometries(geometries),material);mesh.name=material===carpet?'sealed-carpet-footwell':'empty-cabin-seats';mesh.userData.vehicleCabin=true;mesh.receiveShadow=true;group.add(mesh);geometries.forEach(g=>g.dispose());}
 return group;
}
export function installCabinLOD(model,cockpit){
 const near=cockpit.group;near.add(buildCabin(model));
 // The raised POV framing duplicates exterior pillars/deck and sits above the
 // roof for the high driving eye. The real body provides that framing outside.
 cockpit.structure.visible=false;
 // Keep cabin LOD independent of the 15 m exterior skin LOD.
 const lod=cockpit.lod||new T.LOD();model.body.add(lod);lod.name='cockpit-lod';lod.userData.vehicleCabin=true;
 if(!cockpit.lod)lod.addLevel(near,0);
 for(const level of lod.levels.slice(1))level.object.removeFromParent();lod.levels.splice(1);
 lod.addLevel(buildCabin(model,{cheap:true}),25,.12);
 lod.addLevel(new T.Group(),90,.12);cockpit.lod=lod;lod.visible=true;
 model.cockpit=cockpit;
}
export function installTrafficCabin(model,type){
 if(type.scooter||type.moto)return;
 const lod=new T.LOD();lod.name='traffic-cabin-lod';lod.userData.vehicleCabin=true;
 lod.addLevel(buildCabin(model,{cheap:true}),0);lod.addLevel(new T.Group(),90,.12);model.body.add(lod);
}
