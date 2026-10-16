// Browser checks: run from tools/models.html after loading Three.js via its import map.
import {CARS,CarModel} from '../src/cars.js';
import {Cockpit} from '../src/cockpit.js';
import * as THREE from 'three';
export function runVehiclePolishChecks(){
  let passed=0;const check=(value,label)=>{if(!value)throw new Error(label);passed++;};
  const spec=CARS.find(s=>s.id==='z4'),car=new CarModel(spec);
  const R=car.dims.L/2,{top,side}=car.playerSurface;
  check(top(R)<.93&&top(1.26)>top(R)+.04,'Z4 tail is lower than wide rear haunches');
  check(side(R,.7)<side(1.26,.7)*.91,'Z4 hips taper to narrow tail');
  const carrera=new CarModel(CARS.find(s=>s.id==='carrera'));
  check(carrera.materials.glass.opacity===1&&carrera.materials.glass.userData.vehicleGlass,'Carrera has opaque exterior glass');
  return {passed};
}
