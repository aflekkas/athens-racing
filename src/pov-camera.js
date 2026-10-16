import * as THREE from 'three';

// Owner clarified: seated camera, substantial cabin, roughly 65–70% road/window.
// Percentage is a reported proxy with a soft warning band, never a geometry
// stripping target. Road, instruments, structure and identity are hard guards.
export const POV_MIN_WINDSCREEN = .55;
export const POV_MAX_WINDSCREEN = .78;
const v=()=>new THREE.Vector3();
export function opaqueCabinMeshes(model,includeDriver=false){
 const meshes=[];model.body.traverse(o=>{if(!o.isMesh)return;let visible=true;for(let p=o;p&&p!==model.body;p=p.parent)if(!p.visible||(!includeDriver&&p.name==='driver'))visible=false;
 if(visible&&[].concat(o.material||[]).some(m=>!m.transparent&&m.opacity!==0))meshes.push(o);});return meshes;
}
export function unobstructed(eye,target,meshes){
 const delta=target.clone().sub(eye),ray=new THREE.Raycaster(eye,delta.clone().normalize(),.005,delta.length()-.005);
 return !ray.intersectObjects(meshes,false).some(hit=>{const m=Array.isArray(hit.object.material)?hit.object.material[hit.face.materialIndex]:hit.object.material;return m&&!m.transparent&&m.opacity!==0;});
}
export function windscreenBounds(model){
 const glass=model.windscreen||model.body.getObjectByName('windscreen-glass')||model.body.getObjectByName('cab-windscreen-glass')||model.body.getObjectByName('panoramic-front-glass');
 if(!glass)return null;
 model.root.updateMatrixWorld(true);glass.geometry.computeBoundingBox();
 return glass.geometry.boundingBox.clone().applyMatrix4(glass.matrixWorld).applyMatrix4(model.body.matrixWorld.clone().invert());
}
export function derivePovEye(model,cockpit){
 const eye=model.seat.clone(),glass=windscreenBounds(model),wheel=cockpit.steering||cockpit.wheel;
 if(wheel)eye.x=model.body.worldToLocal(wheel.getWorldPosition(v())).x;
 cockpit.eyePitch=-.07;
 eye.z=model.seat.z-(model.spec.nativeFleet?.03:.05);
 eye.y=model.spec.nativeFleet?model.seat.y+.06:Math.min(model.seat.y+.15,model.shape.H-.11);
 if(glass&&!model.spec.twoWheeler)eye.y=Math.min(eye.y,glass.max.y+.08);
 if(model.spec.twoWheeler){eye.copy(model.seat).add(new THREE.Vector3(0,-.05,.35));cockpit.eyePitch=-.12;}
 cockpit.eye=eye;
 cockpit.eyeGeometry={windscreen:glass?{min:glass.min.toArray(),max:glass.max.toArray()}:null,legacyEye:model.seat.toArray()};
 return eye;
}
