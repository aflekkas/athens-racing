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
// A static exterior snapshot keeps all authored furniture but submits it once.
// POV retains its original materials, animation, instruments and damage hooks.
const exteriorMaterial=new T.MeshStandardMaterial({vertexColors:true,roughness:.82,side:T.DoubleSide});
const trafficCabins=new Map();
function mergeCabin(root){
 const geometries=[];root.updateWorldMatrix(true,true);
 const inverse=root.matrixWorld.clone().invert(),visible=root.visible;root.visible=true;
 root.traverseVisible(o=>{
  if(!o.isMesh)return;
  const source=o.geometry,materials=[].concat(o.material);
  const g=source.index?source.toNonIndexed():source.clone();
  g.applyMatrix4(inverse.clone().multiply(o.matrixWorld));
  const count=g.attributes.position.count,colors=new Float32Array(count*3);
  const groups=source.groups.length?source.groups:[{start:0,count,materialIndex:0}];
  for(const part of groups){
   const m=materials[part.materialIndex]||materials[0],color=m.color?.clone()||new T.Color('#34383b');
   // White textured instrument/mirror surfaces would become bright white cards
   // without their map. Their small exterior-facing silhouette is dark glass.
   if(m.map&&color.r>.8&&color.g>.8&&color.b>.8)color.set('#34383b');
   for(let i=part.start;i<Math.min(count,part.start+part.count);i++){
    const old=g.attributes.color;colors[i*3]=color.r*(old?.getX(i)??1);colors[i*3+1]=color.g*(old?.getY(i)??1);colors[i*3+2]=color.b*(old?.getZ(i)??1);
   }
  }
  for(const key of Object.keys(g.attributes))if(!['position','normal'].includes(key))g.deleteAttribute(key);
  if(!g.attributes.normal)g.computeVertexNormals();
  g.setAttribute('color',new T.BufferAttribute(colors,3));g.clearGroups();geometries.push(g);
 });root.visible=visible;
 const geometry=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());
 geometry.computeBoundingSphere();
 const mesh=new T.Mesh(geometry,exteriorMaterial);mesh.name='exterior-cabin';mesh.userData.vehicleCabin=true;mesh.receiveShadow=true;
 mesh.matrixAutoUpdate=false;return mesh;
}
function cheapCabin(model){
 const source=buildCabin(model,{cheap:true}),mesh=mergeCabin(source);
 source.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});return mesh;
}
export function installCabinLOD(model,cockpit){
 const near=cockpit.group;near.add(buildCabin(model));
 cockpit.structure.visible=false;
 const exterior=mergeCabin(near);
 // Keep the large, animated POV tree out of scene matrix traversal altogether
 // while driving in chase view or drawing rivals/garage cars.
 const lod=cockpit.lod||new T.LOD();model.body.add(lod);lod.name='cockpit-lod';lod.userData.vehicleCabin=true;
 for(const level of lod.levels)level.object.removeFromParent();lod.levels.length=0;
 near.removeFromParent();
 lod.addLevel(exterior,0);lod.addLevel(cheapCabin(model),25,.12);
 lod.addLevel(new T.Group(),40,.12);cockpit.lod=lod;lod.visible=true;
 const setVisible=cockpit.setVisible.bind(cockpit);
 cockpit.setVisible=v=>{
  setVisible(v);
  if(v){if(near.parent!==model.body)model.body.add(near);near.visible=true;for(const level of lod.levels)level.object.visible=false;}
  else{near.removeFromParent();if(cockpit.inPOV!==false){lod.levels.forEach((l,i)=>l.object.visible=i===0);}}
  cockpit.inPOV=v;
 };
 // Rejoin the normal car resource-disposal walk before releasing this view.
 const disposeMirrors=cockpit.disposeMirrors.bind(cockpit);
 cockpit.disposeMirrors=()=>{disposeMirrors();if(near.parent!==model.body)model.body.add(near);};
 cockpit.inPOV=false;model.cockpit=cockpit;
}
export function installTrafficCabin(model,type){
 if(type.scooter||type.moto)return;
 // Cache by actual cabin shape/seat layout, including commercial model kind.
 const key=JSON.stringify([cabinDimensions(model),model.dims.W,model.shape?.leather,model.shape?.seats]);
 let template=trafficCabins.get(key);
 if(!template){template=cheapCabin(model);template.geometry.userData.shared=true;trafficCabins.set(key,template);}
 const lod=new T.LOD();lod.name='traffic-cabin-lod';lod.userData.vehicleCabin=true;
 lod.addLevel(template.clone(),0);lod.addLevel(new T.Group(),40,.12);model.body.add(lod);
}
