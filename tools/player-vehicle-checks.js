// Run in tools/models.html: (await import('/tools/player-vehicle-checks.js')).runPlayerVehicleChecks()
import * as THREE from 'three';
import { CARS, CarModel } from '../src/cars.js';
export function runPlayerVehicleChecks(){
  const results=[];const check=(ok,label)=>{results.push({label,pass:!!ok});if(!ok)throw new Error(label);};
  const camera=new THREE.PerspectiveCamera(45,1,.1,1000);
  for(const spec of CARS){
    const car=new CarModel(spec),id=spec.id;
    for(const part of ['bumper_f','bumper_r','bonnet','boot','door_lf','door_rf','mirror_l','mirror_r','light_fl','light_fr','light_rl','light_rr','glass_windscreen']){
      const g=car.body.getObjectByName(part);let meshes=0;g?.traverse(o=>{if(o.isMesh)meshes++;});check(g?.userData.damagePart===part&&meshes>0,id+' populated damage part '+part);
    }
    for(const side of ['l','r']){let panel=false;car.playerParts['door_'+side+'f'].traverse(o=>{if(o.material===car.paint)panel=true;});check(panel,id+' detachable door has painted skin');}
    car.root.updateMatrixWorld(true);
    for(const end of ['f','r']){const b=new THREE.Box3().setFromObject(car.playerParts['bumper_'+end]);check(b.max.y<.54,id+' bumper '+end+' excludes upper end cap');}
    const m=car.signalMaterials;
    for(const signal of Object.values(m)){let attached=false;car.body.traverse(o=>{if(o.material===signal)attached=true;});check(attached,id+' signal material is on visible geometry');}
    car.setIndicators('left');car.updateSignalLights(.1,0);check(m.left.emissiveIntensity>0&&m.right.emissiveIntensity===0,id+' independent left signal');
    car.updateSignalLights(.41,0);check(m.left.emissiveIntensity===0,id+' indicator dark phase');
    car.setIndicators('hazard');car.signalTime=0;car.updateSignalLights(.1,-2);check(m.left.emissiveIntensity>0&&m.right.emissiveIntensity>0&&m.reverse.emissiveIntensity>0,id+' hazard and reverse lights');
    car.setIndicators('off');car.updateSignalLights(0,2);check(m.left.emissiveIntensity===0&&m.right.emissiveIntensity===0&&m.reverse.emissiveIntensity===0,id+' signals and reverse switch off');
    car.root.updateMatrixWorld(true);camera.position.set(0,2,8);camera.updateMatrixWorld(true);car.visualLOD.update(camera);check(car.visualLOD.getCurrentLevel()===0,id+' close LOD');
    camera.position.z=100;camera.updateMatrixWorld(true);car.visualLOD.update(camera);check(car.visualLOD.getCurrentLevel()===2,id+' distant LOD');
    let close=0,far=0;car.visualLOD.levels[0].object.traverse(o=>{if(o.isMesh)close+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});car.visualLOD.levels[2].object.traverse(o=>{if(o.isMesh)far+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});check(far<close*.1,id+' distant shell below 10% triangle count');
    check(car.wheels.every(w=>w.spin.parent===w.pivot&&w.pivot.parent===car.root&&w.caliper.parent===w.pivot),id+' LOD preserves wheel and caliper hooks');
  }
  return {passed:results.length,results};
}
