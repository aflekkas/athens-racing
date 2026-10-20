import test from 'node:test';import assert from 'node:assert/strict';
import * as T from 'three';
import {CARS,CarModel} from './vehicle-budget-support.mjs';
import {OWNER_VEHICLE_DECISION as WHY} from '../src/vehicle-budgets.js';
// Only the visible exterior body, wheels and its large parts may cast the car's shadow. Glazing, hidden internals, the
// POV cockpit / exterior-cabin furniture and ground decals must never produce a dark patch under or beside the car.
const CABIN=/^(cockpit|fleet-cockpit|exterior-cabin|sealed-carpet-footwell|empty-cabin-seats|cabin-distance|traffic-cabin-lod|cockpit-lod)/;
const DISTANCE_LOD=/distan|lod/i; // hidden until the car is far away, then they are the visible body
const seeThrough=m=>m.transparent||m.opacity===0||m.visible===false||m.colorWrite===false;
const where=o=>{const names=[];for(let p=o;p;p=p.parent)names.push(p.name||'(anon)');return names.reverse().join('/');};
test('no invisible, see-through or interior-only mesh of any player car casts a shadow',()=>{
 assert.ok(CARS.length>=77,'expected every player configuration');
 for(const spec of CARS){
  const model=new CarModel(spec);model.root.updateMatrixWorld(true);
  for(const mode of ['exterior','pov']){
   model.cockpit.setVisible(mode==='pov');
   model.root.traverse(o=>{
    if(!o.isMesh||!o.castShadow)return;
    const materials=[].concat(o.material),id=`${spec.id}: ${where(o)} (${mode})`;
    assert.ok(!materials.every(seeThrough),`${id} is see-through glass/invisible but casts a shadow. ${WHY}`);
    for(let p=o;p&&p!==model.root;p=p.parent){
     assert.ok(!(p.userData.vehicleCabin||CABIN.test(p.name)),`${id} is interior-only furniture but casts a shadow. ${WHY}`);
    }
    const names=[];let hidden=false;for(let p=o;p&&p!==model.root;p=p.parent){names.push(p.name);if(!p.visible)hidden=true;}
    // from inside, the exterior body is deliberately hidden (pov-visibility.js); only the exterior view is judged for hidden parts
    assert.ok(mode==='pov'||!hidden||names.some(n=>DISTANCE_LOD.test(n)),`${id} is hidden but casts a shadow. ${WHY}`);
   });
  }
  model.cockpit.disposeMirrors();model.disposeDamage?.();
 }
});
test('no player car carries a flat ground-contact decal that would show as a hard-edged patch under it',()=>{
 for(const spec of CARS){
  const model=new CarModel(spec);model.root.updateMatrixWorld(true);
  model.root.traverse(o=>{
   if(!o.isMesh)return;
   const box=new T.Box3().setFromObject(o),size=box.getSize(new T.Vector3());
   // a wide, paper-thin, near-ground slab: the old CarModel "blob" plane (or any undertray / floor quad)
   assert.ok(!(size.y<.02&&size.x>.8&&size.z>.8&&box.min.y<.12),`${spec.id}: ${where(o)} is a flat ground patch (${size.x.toFixed(2)} x ${size.z.toFixed(2)} m at y ${box.min.y.toFixed(2)}). ${WHY}`);
  });
  model.cockpit.disposeMirrors();model.disposeDamage?.();
 }
});
