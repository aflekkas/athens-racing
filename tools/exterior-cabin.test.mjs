import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {CARS,CarModel,Cockpit,TRAFFIC_TYPES,trafficModel,triangles} from './vehicle-budget-support.mjs';
import {exteriorCabinEnvelope,cabinSection} from '../src/vehicle-cabin-envelope.js';
import {buildExteriorCabin} from '../src/vehicle-cabin.js';
import {RNG} from '../src/util.js';
import {OWNER_VEHICLE_DECISION as WHY} from '../src/vehicle-budgets.js';

function inside(mesh,model,{cheap=false}={}){
 const e=exteriorCabinEnvelope(model,{cheap}),p=mesh.geometry.attributes.position;
 assert.ok(p.count>0,'Cabin must contain furniture');
 // Test actual baked vertices, including their hierarchy transforms. An AABB
 // alone misses a dashboard projecting through a sloping windscreen.
 model.root.updateMatrixWorld(true);
 const matrix=model.body.matrixWorld.clone().invert().multiply(mesh.matrixWorld),v=new T.Vector3(),eps=2e-5;
 for(let i=0;i<p.count;i++){
  v.fromBufferAttribute(p,i).applyMatrix4(matrix);const s=cabinSection(e,v.y);
  assert.ok(Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.z),'Nonfinite cabin vertex');
  if(v.y<e.floor-eps||v.y>e.roof-e.margin+eps)assert.fail(`${model.spec.id}: outside floor/roof at ${v.toArray()}. ${WHY}`);
  if(Math.abs(v.x)>s.half+eps)assert.fail(`${model.spec.id}: through door/glass at ${v.toArray()}. ${WHY}`);
  if(v.z<s.front-eps||v.z>s.back+eps)assert.fail(`${model.spec.id}: outside windscreen/rear cabin at ${v.toArray()}. ${WHY}`);
 }
}
const cabinMeshes=root=>{const a=[];root.traverseVisible(o=>{if(o.isMesh&&o.userData.vehicleCabin)a.push(o);});return a;};
for(const spec of CARS)test(`${spec.id}: one bounded exterior cabin in garage and transformed chase view`,()=>{
 const model=new CarModel(spec),cockpit=new Cockpit(spec,model);
 for(const posed of [false,true]){
  if(posed){model.root.position.set(12,3,-7);model.root.rotation.y=.7;model.body.position.y=.08;model.body.rotation.set(.04,0,-.03);}
  cockpit.setVisible(false);model.root.updateMatrixWorld(true);
  cockpit.lod.levels.slice(0,2).forEach((level,i)=>inside(level.object,model,{cheap:i===1}));
  assert.equal(cabinMeshes(cockpit.lod).length,1,'No duplicate dash/foundation or overlapping cabin LODs. '+WHY);
  assert.equal(cockpit.group.parent,null,'POV-only furniture must be detached in garage/chase. '+WHY);
  assert.equal(model.root.getObjectByName('cockpit-structure'),undefined,'No second wiper/pillar/mirror mount shell. '+WHY);
  model.root.traverseVisible(o=>{if(o.isMesh)assert.equal(o.userData.cockpitStructure,undefined,'No live dash/wiper/mirror-stalk mesh beside the baked cabin. '+WHY);});
  if(model.exteriorDash)assert.equal(model.exteriorDash.parent,null,'Legacy exterior dash must not also render. '+WHY);
  cockpit.setVisible(true);
  const camera=new T.PerspectiveCamera();camera.position.copy(model.root.position);camera.updateMatrixWorld(true);
  cockpit.lod.update(camera); // mirrors/audits may explicitly update every LOD
  assert.equal(cabinMeshes(cockpit.lod).length,0,'POV cannot overlap its exterior snapshot after any camera update. '+WHY);
  assert.equal(cockpit.structure.visible,true,'POV structure remains intact. '+WHY);
 }
 cockpit.disposeMirrors();model.disposeDamage?.();
});
for(const type of TRAFFIC_TYPES)test(`${type.id}: near/far/parked traffic furniture stays inside coachwork`,()=>{
 for(const opts of [{},{low:true},{parked:true}]){
  const model=trafficModel(type,'#dde1e0',new RNG(9),opts),lod=model.body.getObjectByName('traffic-cabin-lod');
  if(type.scooter||type.moto){assert.equal(lod,undefined);continue;}
  assert.ok(lod,type.id+' missing traffic cabin');model.root.updateMatrixWorld(true);inside(lod.levels[0].object,model,{cheap:true});
  assert.equal(cabinMeshes(lod).length,1);assert.ok(triangles(lod)<=360);model.disposeDamage?.();
 }
});
test('export excludes POV wipers/mirror stalks/deck even when their group is visible',()=>{
 const model=new CarModel(CARS.find(s=>s.id==='van')),cockpit=model.cockpit;
 const before=buildExteriorCabin(model,cockpit);cockpit.structure.visible=true;
 for(const name of ['cockpit-wiper-blade','cockpit-mirror-mount','cockpit-deck']){
  const stray=new T.Mesh(new T.BoxGeometry(5,5,5));stray.name=name;stray.position.set(0,6,-8);cockpit.structure.add(stray);cockpit.group.add(stray.clone());
 }
 const after=buildExteriorCabin(model,cockpit);
 assert.deepEqual(after.geometry.attributes.position.array,before.geometry.attributes.position.array,'POV-only parts were duplicated into the exterior. '+WHY);
 before.geometry.dispose();after.geometry.dispose();cockpit.disposeMirrors();model.disposeDamage?.();
});
test('bounds guard catches bonnet boxes, roof trim, side tubes and rear overshoot',()=>{
 const model=new CarModel(CARS.find(s=>s.id==='van')),mesh=model.cockpit.lod.levels[0].object,p=mesh.geometry.attributes.position,old=[p.getX(0),p.getY(0),p.getZ(0)];
 for(const point of [[0,1.6,-2.3],[0,2.55,-1],[1.1,1.5,-1],[0,1.5,0]]){p.setXYZ(0,...point);assert.throws(()=>inside(mesh,model),/outside|through/);}
 p.setXYZ(0,...old);inside(mesh,model);model.cockpit.disposeMirrors();model.disposeDamage?.();
});
test('commercial bounds follow the cab panes rather than the bonnet or cargo box',()=>{
 for(const [id,front,back,width,height]of [['van',-1.92,-.66,1.92,2.12],['truck',-3.17,-1.36,1.94,2.15]]){
  const model=new CarModel(CARS.find(s=>s.id===id)),e=exteriorCabinEnvelope(model);
  assert.equal(e.front,front);assert.equal(e.back,back);assert.equal(e.half*2,width);assert.equal(e.roof,height);
  const mirrors=[];model.root.traverse(o=>{if(o.userData.commercialMirror&&o.userData.mirrorAssembly)mirrors.push(o);});
  assert.equal(mirrors.length,2);for(const mirror of mirrors){assert.equal(mirror.getObjectByName('mirror-housing').geometry.type,'BoxGeometry');assert.ok(mirror.getObjectByName('mirror-stalk'));}
  model.cockpit.disposeMirrors();model.disposeDamage?.();
 }
});
