import * as THREE from 'three';
import {CARS,CarModel} from '../src/cars.js';
import {Driver} from '../src/driver.js';
import {Cockpit} from '../src/cockpit.js';
import {bindDriverToCar} from '../src/driver-seating.js';
import {CHARACTER_PRESETS} from '../src/character-presets.js';
import {runCharacterModelChecks} from './character-model-checks.js';
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(420,350);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;document.querySelector('#work').append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#1d2934');scene.add(new THREE.HemisphereLight('#eff4ff','#38424c',3));for(const p of [[-4,6,-5],[4,3,5]]){const light=new THREE.DirectionalLight('#ffffff',3);light.position.set(...p);scene.add(light);}
const camera=new THREE.PerspectiveCamera(40,420/350,.02,30),spec=CARS.find(c=>c.id==='mini'),car=new CarModel(spec,{decals:[]}),driver=new Driver(),cockpit=new Cockpit(spec,car);scene.add(car.root);
// Cabin inspection uses the actual seat meshes and actual Cockpit wheel.
// Omit the shell, dashboard fascia and mirror so they cannot hide the hands.
for(const child of car.root.children)child.visible=child===car.body;
car.body.traverse(o=>{if(o.isMesh)o.visible=(Array.isArray(o.material)?o.material:[o.material]).includes(car.materials.seat);else if(o.isPoints)o.visible=false;});
if(car.visualLOD){car.visualLOD.autoUpdate=false;car.visualLOD.levels.forEach((level,i)=>level.object.visible=i===0);}
car.root.updateMatrixWorld(true);car.body.attach(cockpit.wheel);cockpit.wheel.traverse(o=>o.visible=true);
bindDriverToCar(driver,car);
const checks=runCharacterModelChecks(),captures=[];
for(const view of ['front','in-car'])for(const preset of CHARACTER_PRESETS){
  driver.setAppearance(preset.look);driver.head.visible=true;
  if(view==='front'){
    car.root.visible=false;scene.add(driver.root);driver.root.position.set(driver.passenger?-.23:0,0,0);
    if(driver.passenger){scene.add(driver.passenger.root);driver.passenger.root.position.set(.25,0,0);}
    driver.update(0,0,0,{}, {pos:new THREE.Vector3(driver.root.position.x,-.135,-.53),angle:0,euler:new THREE.Euler(-.36,0,0),r:.18});
    camera.fov=40;camera.position.set(0,.07,driver.passenger?-1.65:-1.35);camera.lookAt(0,-.13,0);
  }else{
    car.root.visible=true;bindDriverToCar(driver,car);driver.update(0,0,0,{},cockpit.wheelInfo,0);
    camera.fov=60;camera.position.set(-.12,1.35,-.90);camera.lookAt(-.04,.94,.05);
  }
  camera.updateProjectionMatrix();renderer.render(scene,camera);
  const src=renderer.domElement.toDataURL('image/png'),card=document.createElement('article');card.className='card';const title=document.createElement('h2');title.textContent=preset.name+' · '+(view==='front'?'Front':preset.id==='vasilis_pefaltes'?'In-car with Jonia':'In-car');const image=new Image();image.src=src;image.alt=title.textContent;card.append(title,image);document.querySelector('#sheet').append(card);captures.push({presetId:preset.id,view,passenger:!!driver.passenger,passengerSeat:driver.passenger?.root.userData.seat,driverSeatZ:driver.root.position.z,passengerSeatZ:driver.passenger?.root.position.z,canVisible:driver.characterRig.can.visible,handPositions:driver.arms.map(a=>a.hand.getWorldPosition(new THREE.Vector3()).toArray()),wheelPosition:cockpit.wheelInfo.pos.toArray()});
}
window.characterReview={checks,captures,ready:true};document.querySelector('#result').textContent=checks.passed+' real geometry/pose/resource checks passed · Six views rendered.';
driver.dispose();cockpit.disposeMirrors();renderer.dispose();renderer.forceContextLoss();
