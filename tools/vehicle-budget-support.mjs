// Real Three.js geometry; canvas drawing is stubbed only for the Node guard.
const noop=()=>{},gradient={addColorStop:noop};
const ctx=new Proxy({measureText:()=>({width:50,actualBoundingBoxLeft:0,actualBoundingBoxRight:50}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})},{get:(o,k)=>k in o?o[k]:noop,set:(o,k,v)=>(o[k]=v,true)});
if(!globalThis.document)globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>ctx}),createElementNS:()=>({addEventListener:noop,removeEventListener:noop,set src(v){}})};
if(!globalThis.localStorage)globalThis.localStorage={getItem:()=>null};
export const {CARS,CarModel,TRAFFIC_TYPES,trafficModel}=await import('../src/cars.js');
export const {Cockpit}=await import('../src/cockpit.js');
export function triangles(root,level=0,{excludeCabin=false}={}){
 let count=0;
 function visit(o,force=false){
  if(!force&&!o.visible)return;
  if(excludeCabin&&o.userData.vehicleCabin)return;
  if(o.isLOD){visit(o.levels[Math.min(level,o.levels.length-1)].object,true);return;}
  if(o.isMesh)count+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);
  for(const child of o.children)visit(child);
 }
 if(root)visit(root,true);return count;
}
export function geometryBytes(root){const seen=new Set();let bytes=0;root.traverse(o=>{if(!o.geometry)return;for(const a of [...Object.values(o.geometry.attributes),o.geometry.index].filter(Boolean)){if(!seen.has(a.array.buffer)){seen.add(a.array.buffer);bytes+=a.array.buffer.byteLength;}}});return bytes;}
export function metrics(car){
 const bytes=geometryBytes(car.root);
 const levels=[0,1,2].map(i=>triangles(car.root,i,{excludeCabin:true}));
 const wheels=car.wheels.map(w=>triangles(w.spin));
 const rider=triangles(car.body.getObjectByName('attached-rider'));
 const cockpit=new Cockpit(car.spec,car,null);cockpit.setVisible(true);
 const interior=triangles(cockpit.group)||(triangles(cockpit.display)+triangles(cockpit.navDisplay));cockpit.setVisible(false);
 return {id:car.spec.id,geometryBytes:bytes,exterior:levels[0],lod1:levels[1],lod2:levels[2],wheels,interior,rider};
}
