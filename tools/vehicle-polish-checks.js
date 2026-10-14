// Browser checks: run from tools/models.html after loading Three.js via its import map.
import {CARS,CarModel} from '../src/cars.js';
import {Driver} from '../src/driver.js';
import {Cockpit} from '../src/cockpit.js';
import * as THREE from 'three';
export function runVehiclePolishChecks(){
  let passed=0;const check=(value,label)=>{if(!value)throw new Error(label);passed++;};
  const spec=CARS.find(s=>s.id==='z4'),car=new CarModel(spec),cockpit=new Cockpit(spec,car),driver=new Driver();
  driver.root.position.copy(car.seat).add(new THREE.Vector3(0,-.195,.1));car.body.add(driver.root);
  const step=(held,gear,frames,manual=true)=>{for(let i=0;i<frames;i++){cockpit.update(1/60,{steerInput:.15,rpm:900,redline:7000,gear,gearLabel:String(gear),kmh:0,nitro:0,handbrake:held,manual});driver.update(1/60,0,0,{},cockpit.wheelInfo);}};
  step(false,1,60);const left=driver.arms[0].hand.position.clone(),right=driver.arms[1].hand.position.clone();
  step(true,1,60);const distance=(target)=>driver.arms[1].hand.position.clone().add(driver.root.position).distanceTo(target);
  check(distance(cockpit.controlTargets.handbrake)<.001,'Right palm contacts raised brake grip within 1 mm');
  check(driver.arms[0].hand.position.distanceTo(left)<1e-6,'Left hand remains on steering wheel');
  check(cockpit.handbrakePivot.rotation.x>.35,'Brake lever raises while held');
  step(false,1,60);check(driver.arms[1].hand.position.distanceTo(right)<.001,'Right hand returns smoothly to wheel');
  step(false,2,14);check(distance(cockpit.controlTargets.shifter)<.006,'Manual shift reaches selector within 6 mm');
  step(false,2,60);check(driver.arms[1].hand.position.distanceTo(right)<.001,'Manual shift releases back to wheel');
  step(false,3,14,false);check(driver.shiftReach<.001,'Automatic shift does not move hand to selector');
  step(true,4,60);check(distance(cockpit.controlTargets.handbrake)<.001,'Handbrake takes priority over gear change');
  const R=car.dims.L/2,{top,side}=car.playerSurface;
  check(top(R)<.93&&top(1.26)>top(R)+.04,'Z4 tail is lower than wide rear haunches');
  check(side(R,.7)<side(1.26,.7)*.91,'Z4 hips taper to narrow tail');
  const carrera=new CarModel(CARS.find(s=>s.id==='carrera'));
  check(carrera.materials.glass.opacity<=.2&&carrera.materials.glass.metalness===0,'Carrera has light dielectric glass');
  return {passed,handbrakeContactTolerance:.001,manualShiftContactTolerance:.006};
}
