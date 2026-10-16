import * as THREE from 'three';
import {DEFAULTS} from './settings.js';

// Owner-locked: default cockpit view reserves >=80% of the frame for the road.
// The mesh ID-pass guard in tools/pov-camera-mask.mjs validates every config.
export const POV_MIN_WINDSCREEN = .80;
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
 const cluster=cockpit.group?.getObjectByName('instrument-cluster')||cockpit.display;
 cockpit.eyePitch=-.055;
 eye.z-=.04;
 if(cluster){
  const centre=model.body.worldToLocal(cluster.getWorldPosition(v()));
  // Put the actual instrument face in the bottom band at default cockpit FOV.
  // This retains the authored seated station and never moves its geometry.
  const down=.055+Math.atan(.80*Math.tan(THREE.MathUtils.degToRad(DEFAULTS.cockpitFov/2)));
  eye.y=centre.y+Math.max(.15,eye.z-centre.z)*Math.tan(down);
  eye.y=THREE.MathUtils.clamp(eye.y,model.seat.y-.04,model.seat.y+.16);
 }else eye.y+=.08;
 if(glass&&!model.spec.twoWheeler)eye.y=Math.min(eye.y,glass.max.y-.08);
 cockpit.eye=eye;cockpit.eyePitch=-.055;
 cockpit.eyeGeometry={windscreen:glass?{min:glass.min.toArray(),max:glass.max.toArray()}:null,legacyEye:model.seat.toArray()};
 return eye;
}
