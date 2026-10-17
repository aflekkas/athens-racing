import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {CARS,CarModel,Cockpit,triangles} from './vehicle-budget-support.mjs';
import {cabinDimensions} from '../src/vehicle-cabin.js';

for(const spec of CARS)test(`${spec.id}: sealed footwell remains opaque in POV and after side damage`,()=>{
 const model=new CarModel(spec),cockpit=new Cockpit(spec,model),d=cabinDimensions(model);
 const check=()=>{
  cockpit.setVisible(true);model.root.updateMatrixWorld(true);
  const meshes=[];model.root.traverseVisible(o=>{if(o.isMesh)meshes.push(o);});
  const eye=model.body.localToWorld(cockpit.eye.clone());
  for(const x of [-.49,-.43,-.25,0,.25,.43,.49].map(f=>d.width*f))for(const z of [d.front+.10,(d.front+d.seatZ)/2,d.seatZ,d.back-.10]){
   const target=model.body.localToWorld(new T.Vector3(x,d.floor-.09,z)),distance=target.distanceTo(eye);
   const ray=new T.Raycaster(eye,target.clone().sub(eye).normalize(),.05,distance);
   const hit=ray.intersectObjects(meshes,false).find(h=>{const m=[].concat(h.object.material)[h.face.materialIndex||0];return m.visible&&!m.transparent&&m.opacity===1;});
   assert.ok(hit,`${spec.id}: road visible at footwell (${x.toFixed(2)}, ${z.toFixed(2)})`);
  }
 };
 check();model.setDamage?.('left',.8);model.setDamage?.('right',.8);check();
 cockpit.setVisible(false);assert.ok(cockpit.lod.visible,'Empty cabin must remain visible from outside');
 assert.ok(triangles(cockpit.lod.levels[1].object)<=500,'Distance cabin budget');
 cockpit.disposeMirrors();model.disposeDamage?.();
});

test('ray regression detects a removed cabin floor even when an exterior undertray exists',()=>{
 const model=new CarModel(CARS.find(s=>s.id==='mini')),cockpit=new Cockpit(model.spec,model);
 cockpit.setVisible(true);const floor=cockpit.group.getObjectByName('sealed-carpet-footwell');assert.ok(floor);
 const d=cabinDimensions(model),target=new T.Vector3(-d.width*.27,d.floor-.09,d.front+.12);
 model.root.updateMatrixWorld(true);const eye=cockpit.eye.clone(),ray=new T.Raycaster(eye,target.clone().sub(eye).normalize(),.05,eye.distanceTo(target));
 assert.ok(ray.intersectObject(floor,false).length);floor.visible=false;
 const meshes=[];model.root.traverseVisible(o=>{if(o.isMesh)meshes.push(o);});
 assert.equal(ray.intersectObjects(meshes,false).filter(h=>!h.object.material.transparent).length,0,'Removing the sealed floor must expose the original hole');
 cockpit.disposeMirrors();model.disposeDamage?.();
});

test('exterior uses one authored cabin through 25 m, then a bounded traffic-style LOD',()=>{
 const model=new CarModel(CARS.find(s=>s.id==='golf')),cockpit=new Cockpit(model.spec,model);
 assert.equal(cockpit,model.cockpit,'Constructing a view must reuse the cabin');
 cockpit.setVisible(false);assert.equal(cockpit.structure.visible,false,'POV framing cannot protrude above the exterior roof');
 const camera=new T.PerspectiveCamera();
 for(const [distance,level]of [[5,0],[20,0],[30,1],[100,2]]){
  camera.position.set(0,0,distance);camera.updateMatrixWorld(true);model.root.updateMatrixWorld(true);
  model.visualLOD?.update(camera);cockpit.lod.update(camera);
  assert.equal(cockpit.lod.getCurrentLevel(),level);
  assert.ok(cockpit.lod.levels[level].object.visible);
 }
 cockpit.setVisible(true);assert.equal(cockpit.structure.visible,true);assert.ok(cockpit.group.visible);
 assert.ok(model.windscreen&&!model.windscreen.visible,'Own POV glazing stays invisible');
 model.setDamage('front',.8,{ebs:15});assert.ok(model.crackedGlass,'Glass still develops damage');
 cockpit.setVisible(false);assert.ok(model.windscreen.visible);assert.ok(model.crackedGlass.parent,'Cracks stay attached to their pane');
 model.setDamage('front',0);cockpit.disposeMirrors();model.disposeDamage?.();
});

test('exterior cabin submits once, culls normally, and never overlaps the active POV',()=>{
 const model=new CarModel(CARS.find(s=>s.id==='mini')),cockpit=model.cockpit,lod=cockpit.lod,camera=new T.PerspectiveCamera();
 const visibleMeshes=()=>{const result=[];lod.traverseVisible(o=>{if(o.isMesh)result.push(o);});return result;};
 for(const [distance,expected]of [[5,1],[20,1],[30,1],[50,0]]){
  cockpit.setVisible(false);camera.position.set(0,0,distance);camera.updateMatrixWorld(true);model.root.updateMatrixWorld(true);lod.update(camera);
  const meshes=visibleMeshes();assert.equal(meshes.length,expected);for(const mesh of meshes){assert.ok(mesh.frustumCulled);assert.ok(!Array.isArray(mesh.material));assert.equal(mesh.geometry.groups.length,0);}
  assert.equal(cockpit.group.parent,null,'Hidden animated cockpit must not incur scene matrix traversal');
  cockpit.setVisible(true);assert.equal(cockpit.group.parent,model.body);assert.equal(visibleMeshes().length,0,'POV must not double render its exterior snapshot');
 }
 cockpit.setVisible(false);cockpit.disposeMirrors();assert.equal(cockpit.group.parent,model.body,'Detached POV resources must rejoin normal car disposal');model.disposeDamage?.();
});

test('traffic cabins share geometry across colours and near/far instances, bounded at 360 triangles',async()=>{
 const {TRAFFIC_TYPES,trafficModel}=await import('./vehicle-budget-support.mjs');const {RNG}=await import('../src/util.js');
 for(const type of TRAFFIC_TYPES){if(type.scooter||type.moto)continue;
  const a=trafficModel(type,'#324657',new RNG(1)),b=trafficModel(type,'#cfcaba',new RNG(2)),far=trafficModel(type,'#887755',new RNG(3),{low:true});
  const left=a.body.getObjectByName('traffic-cabin-lod'),right=b.body.getObjectByName('traffic-cabin-lod');
  assert.equal(left.levels[0].object.geometry,right.levels[0].object.geometry,type.id+' must share cabin geometry');
  assert.equal(left.levels[0].object.geometry,far.body.getObjectByName('traffic-cabin-lod').levels[0].object.geometry,type.id+' near/far must share cabin geometry');
  assert.ok(triangles(left)<=360,type.id+' cabin exceeds 360 triangles');assert.equal(left.levels[1].distance,40);
  a.disposeDamage?.();b.disposeDamage?.();far.disposeDamage?.();
 }
});
