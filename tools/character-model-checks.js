// Real Three.js geometry/IK/resource checks, run in the lightweight browser fixture.
import * as THREE from 'three';
import {CARS,CarModel} from '../src/cars.js';
import {Driver} from '../src/driver.js';
import {bindDriverToCar} from '../src/driver-seating.js';
import {characterPresetLook} from '../src/character-presets.js';
export function runCharacterModelChecks(){
  let passed=0;const check=(ok,label)=>{if(!ok)throw new Error(label);passed++;};
  const model=new CarModel(CARS.find(c=>c.id==='mini'),{decals:[]}),driver=new Driver(characterPresetLook('alex_david'));
  bindDriverToCar(driver,model);
  check(Math.abs(driver.root.scale.y-163/175)<1e-8,'Alex David seated height is163cm');
  check(driver.curlMesh.visible&&driver.hairBase.scale.y>.06,'David has voluminous animated curls');
  const before=driver.head.getWorldPosition(new THREE.Vector3());
  driver.setAppearance(characterPresetLook('alex_adelman'));model.root.updateMatrixWorld(true);
  check(driver.head.getWorldPosition(new THREE.Vector3()).y>before.y,'168cm Adelman sits taller than163cm David');
  check(driver.characterRig.messy.visible&&!driver.curlMesh.visible&&driver.characterRig.messy.children.length>12,'Adelman has straight ruffled locks');
  check(driver.characterRig.can.visible&&driver.characterRig.can.parent===driver.arms[1].hand,'Spray can is attached to the free right hand');
  const wheel=driver.characterRig.wheelFor(0);driver.update(1/30,0,15,{},wheel,0);
  const hand=driver.arms[1].hand.position.clone(),left=driver.arms[0].hand.position.clone();
  for(let i=0;i<30;i++){wheel.angle=1.5;driver.update(1/30,i/30,20,{},wheel,.6);}
  check(driver.characterRig.canLower>.99&&driver.arms[1].hand.position.y<hand.y-.10,'Hard steering lowers the spray can');
  check(driver.arms[0].hand.position.distanceTo(left)>.1,'The left hand continues steering');
  for(let i=0;i<30;i++){wheel.angle=0;driver.update(1/30,i/30,20,{},wheel,0);}
  check(driver.characterRig.canLower<.001&&driver.arms[1].hand.position.distanceTo(hand)<.002,'Gentle steering returns the can to the wheel');
  const legacy=new Driver(),rest=legacy.hairBase.scale.clone();legacy.setAppearance({...legacy.appearance,shirt:'#123456'});check(legacy.hairBase.scale.equals(rest),'Legacy edits preserve default hair fit');legacy.dispose();
  driver.setAppearance(characterPresetLook('vasilis_pefaltes'));const passenger=driver.passenger;
  check(passenger?.appearance.gender==='female'&&passenger.root.name==='passenger:jonia_peroti','Vasilis creates the named female passenger');
  check(passenger.root.parent===model.body&&driver.root.parent===model.body&&passenger.root.position.x>0&&driver.root.position.x<0,'Jonia is attached in the opposite front seat');
  driver.head.visible=false;check(passenger.head.visible&&passenger.root.visible,'Cockpit head hiding leaves the passenger visible');driver.head.visible=true;
  driver.update(1/30,1,30,{x:2,y:0,z:1},wheel,.4);
  check(passenger.arms.every(a=>Math.abs(a.hand.position.y+.48)<1e-8),'Passenger hands rest in her lap');
  const geometry=[...passenger._ownedGeometries],disposals=new Map();for(const g of geometry)g.addEventListener('dispose',()=>disposals.set(g,(disposals.get(g)||0)+1));
  driver.setAppearance(characterPresetLook('alex_david'));
  check(passenger.disposed&&!passenger.root.parent&&!driver.passenger,'Switching characters removes the paired passenger');
  check(geometry.every(g=>disposals.get(g)===1),'Passenger-owned geometry is released once');
  driver.setAppearance(characterPresetLook('vasilis_pefaltes'));const finalPassenger=driver.passenger;
  const own=[...driver._ownedGeometries],counts=new Map();for(const g of own)g.addEventListener('dispose',()=>counts.set(g,(counts.get(g)||0)+1));driver.dispose();driver.dispose();
  check(finalPassenger.disposed&&own.every(g=>counts.get(g)===1),'Driver/accessory/passenger disposal is idempotent');
  // Static car resources belong to the fixture's short-lived renderer; no game/world is started.
  return {passed};
}
