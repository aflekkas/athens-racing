// 348-only visual/integration checks; run in the vehicle studio's browser import map.
import * as THREE from 'three';
import { CARS, CarModel } from '../src/cars.js';
export function runF348VehicleChecks(){
  const car=new CarModel(CARS.find(s=>s.id==='f348')),results=[];
  const check=(pass,label)=>{results.push({label,pass:!!pass});if(!pass)throw new Error(label);};
  car.root.updateMatrixWorld(true);
  const visible=[];car.root.traverseVisible(o=>{if(o.isMesh)visible.push(o);});
  for(const x of [-.60,.60]){
    const hit=new THREE.Raycaster(new THREE.Vector3(x,1.1,-1.72),new THREE.Vector3(0,-1,0),0,1).intersectObjects(visible,false)[0];
    check(hit?.object.material===car.paint&&Math.abs(hit.point.y-car.playerSurface.deck(x,-1.72))<.015,'Daylight pop-up cover is flush painted bonnet at x='+x);
  }
  for(const x of [-.45,.45]){
    const hit=new THREE.Raycaster(new THREE.Vector3(x,.635,2.6),new THREE.Vector3(0,0,-1),0,1).intersectObjects(visible,false)[0];
    check(hit?.object.material===car.tail,'Rectangular rear lens is visible between grille slats at x='+x);
  }
  check(car.exhaust.length===4,'Four exhaust outlets retain their effect anchors');
  for(const outlet of car.exhaust){
    const hit=new THREE.Raycaster(outlet.clone().add(new THREE.Vector3(0,0,.04)),new THREE.Vector3(0,0,-1),0,.1).intersectObjects(visible,false)[0];
    check(hit?.object.material===car.materials.black&&hit.point.distanceTo(outlet)<.005,'Exhaust effect anchor is seated in the rounded tail outlet');
  }
  check(car.shape.rim===.2159&&car.shape.tyreF===.215&&car.shape.tyreR===.255,'17-inch wheels retain 215/255 staggered tyre widths');
  for(const w of car.wheels){
    // Inspect the assembled/batched wheel optically; source mesh names do not survive compaction.
    const meshes=[];w.spin.traverseVisible(o=>{if(o.isMesh)meshes.push(o);});
    for(let j=0;j<10;j++){
      const a=j*Math.PI/5,origin=w.spin.localToWorld(new THREE.Vector3(w.side*.4,.15*Math.cos(a),.15*Math.sin(a)));
      const direction=new THREE.Vector3(-w.side,0,0).transformDirection(w.spin.matrixWorld);
      const hit=new THREE.Raycaster(origin,direction,0,.8).intersectObjects(meshes,false)[0];
      check((hit?.object.material===car.materials.wheelMetal)===(j%2===0),'Cast star blade/opening '+j+' on '+(w.front?'front':'rear')+' wheel '+w.side);
    }
  }
  car.disposeDamage?.();return {passed:results.length,results};
}
