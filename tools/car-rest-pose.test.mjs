import test from 'node:test';import assert from 'node:assert/strict';
import * as T from 'three';
import {CARS,CarModel} from './vehicle-budget-support.mjs';
import {OWNER_VEHICLE_DECISION as WHY} from '../src/vehicle-budgets.js';
// A car parked on flat ground must sit level (pitch is also guarded in tools/physics-test/rest-pose.test.mjs), with its wheels
// sitting evenly in their arches (the same tyre-to-arch clearance front and rear, wheels centred fore/aft).
const MAX_BODY_PITCH_DEG=.3,MAX_ARCH_TILT_DEG=2.5,MAX_FORE_AFT=.08;
// Arch ceiling above a wheel, ignoring interior sill trim, glazing and the exterior-cabin snapshot.
function archClearance(model,wheel,dz){
 const meshes=[];model.body.traverse(o=>{
  if(!o.isMesh||o.userData.vehicleCabin)return;let ok=true;for(let p=o;p;p=p.parent)if(!p.visible||p.name==='cockpit-lod'||/^interior|^damage-internal/.test(p.name))ok=false;
  if(ok&&![].concat(o.material).some(m=>m.transparent))meshes.push(o);});
 const centre=wheel.pivot.getWorldPosition(new T.Vector3()),ray=new T.Raycaster(new T.Vector3(centre.x,centre.y,centre.z+dz),new T.Vector3(0,1,0),0,2);
 const hit=ray.intersectObjects(meshes,false)[0];
 return hit?hit.point.y-(centre.y+Math.sqrt(Math.max(0,wheel.r*wheel.r-dz*dz))):NaN;
}
test('every player car rests level on its wheels with the wheels centred in their arches',()=>{
 assert.ok(CARS.length>=77,'expected every player configuration');
 for(const spec of CARS){
  const model=new CarModel(spec);model.update(.016,0,0,false,{heave:0,pitch:0,roll:0},null);model.root.updateMatrixWorld(true);
  const id=spec.id;
  assert.ok(Math.abs(T.MathUtils.radToDeg(model.body.rotation.x))<MAX_BODY_PITCH_DEG&&Math.abs(model.root.rotation.x)<1e-6,`${id}: body is pitched at rest. ${WHY}`);
  const bottoms=model.wheels.map(w=>w.pivot.getWorldPosition(new T.Vector3()).y-w.r);
  assert.ok(bottoms.every(y=>Math.abs(y)<.01),`${id}: wheels do not all touch the ground (${bottoms.map(y=>y.toFixed(3))}). ${WHY}`);
  if(spec.nativeFleet)continue; // van / truck / bus arches are open cargo or chassis structure, judged by their own guards
  const wheels=model.wheels.filter(w=>w.side<0),front=wheels.find(w=>w.front),rear=wheels.find(w=>!w.front);
  const gap=(w,dz=0)=>archClearance(model,w,dz*w.r);
  const wb=Math.abs(front.pivot.position.z-rear.pivot.position.z);
  assert.ok(gap(front)>-.03&&gap(rear)>-.03,`${id}: a tyre pokes through the body (front ${gap(front).toFixed(3)} m, rear ${gap(rear).toFixed(3)} m clearance). ${WHY}`);
  const tilt=T.MathUtils.radToDeg(Math.atan2(gap(rear)-gap(front),wb));
  assert.ok(Math.abs(tilt)<MAX_ARCH_TILT_DEG,`${id}: body sits ${Math.abs(tilt).toFixed(1)} degrees nose-${tilt>0?'down':'up'} on its wheels (arch clearance front ${gap(front).toFixed(3)} m, rear ${gap(rear).toFixed(3)} m). ${WHY}`);
  for(const [name,w] of [['front',front],['rear',rear]]){
   const fore=gap(w,-.7),aft=gap(w,.7);
   if(Number.isFinite(fore)&&Number.isFinite(aft))assert.ok(Math.abs(fore-aft)<MAX_FORE_AFT,`${id}: ${name} wheel is off-centre in its arch (${fore.toFixed(3)} m ahead vs ${aft.toFixed(3)} m behind). ${WHY}`);
  }
  model.cockpit.disposeMirrors();model.disposeDamage?.();
 }
});
