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
    if(spec.fleet)for(const side of ['l','r']){
      const lenses=[];car.playerParts['light_r'+side].traverse(o=>{if(o.isMesh&&o.material===car.tail)lenses.push(o);});
      const visible=lenses.some(o=>{const pos=o.geometry.attributes.position,idx=o.geometry.index,target=new THREE.Vector3();for(let i=0;i<3;i++)target.add(new THREE.Vector3().fromBufferAttribute(pos,idx?idx.getX(i):i));target.multiplyScalar(1/3);o.localToWorld(target);return new THREE.Raycaster(target.clone().add(new THREE.Vector3(0,0,1)),new THREE.Vector3(0,0,-1),0,1.01).intersectObjects(lenses,false).length>0;});
      check(visible,id+' rear '+side+' lens visible from behind');
    }
    for(const end of ['f','r']){const b=new THREE.Box3().setFromObject(car.playerParts['bumper_'+end]);check(b.max.y<.54,id+' bumper '+end+' excludes upper end cap');}
    const left=[],right=[];car.body.traverse(o=>{if(o.userData.damageInterior)(o.userData.damageSide==='left'?left:right).push(o);});
    car.setDamage('left',.5);check(left.length>0&&left.every(o=>!o.visible)&&right.every(o=>o.visible),id+' side intrusion hides only hit-side interior');car.setDamage('left',0);check(left.every(o=>o.visible),id+' repair restores interior upholstery');
    for(const [side,nodes] of [['left',left],['right',right]]){
      check(nodes.some(o=>o.material===car.materials.cloth&&new THREE.Box3().setFromObject(o).min.y<.34),id+' '+side+' carpet retracts independently');
      check(nodes.some(o=>o.material===car.materials.black&&new THREE.Box3().setFromObject(o).min.y<.25),id+' '+side+' underfloor retracts independently');
    }
    car.setDamage('left',1,{localPoint:{x:-car.dims.W/2,y:.72,z:-.25},localNormal:{x:1,y:0,z:0},ebs:50/3.6});
    check(left.every(o=>!o.visible)&&right.every(o=>o.visible),id+' full side50 impact hides only struck furniture and floor');
    car.setDamage('left',0);check(left.every(o=>o.visible),id+' side50 repair restores floor and furniture');
    const visible=[];car.root.traverseVisible(o=>{if(o.isMesh)visible.push(o);});
    for(const mirror of [car.mirrorL,car.mirrorR]){mirror.geometry.computeBoundingBox();const target=mirror.geometry.boundingBox.getCenter(new THREE.Vector3());target.x+=.003;target.y+=.002; // Avoid the shared centre vertex of triangulated circular glass.
      mirror.localToWorld(target);const ray=new THREE.Raycaster(target.clone().add(new THREE.Vector3(0,0,.4)),new THREE.Vector3(0,0,-1),0,.5);const hit=ray.intersectObjects(visible,false)[0];check(hit?.object===mirror,id+' reflective mirror face clears housing');}
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
