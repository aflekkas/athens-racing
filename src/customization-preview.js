// A small showroom, never a second road/world renderer. Renders only on edits.
import * as THREE from 'three';
import {CarModel,setPaint} from './cars.js';
import {Driver} from './driver.js';
import {applyCarDecals} from './vehicle-decals.js';
import {preparePhotoUrl} from './photo-stickers.js';
import {normalizeAppearance} from './customization-data.js';
import {bindDriverToCar} from './driver-seating.js';
export function mountCustomizationPreview(container,spec,appearance){
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.toneMapping=THREE.ACESFilmicToneMapping;container.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.05,50);scene.add(new THREE.HemisphereLight('#eff4ff','#38424c',3));
  for(const p of [[-4,6,-5],[4,3,5]]){const light=new THREE.DirectionalLight('#ffffff',3);light.position.set(...p);scene.add(light);}
  const model=new CarModel(spec,{decals:[]});scene.add(model.root);let driver,closed=false,view='car',angle='front',generation=0;
  const copies=new Map();const clone=m=>{if(!copies.has(m))copies.set(m,m.clone());return copies.get(m);};
  model.root.traverse(o=>{if(o.material)o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);});model.paint=clone(model.paint);model.paintAccents=(model.paintAccents||[]).map(clone);if(model.materials?.black)model.materials.black=clone(model.materials.black);
  const render=()=>{if(closed)return;const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;
    if(view==='driver'){
      model.root.visible=false;scene.add(driver.root);driver.root.visible=true;driver.root.position.set(driver.passenger?-.23:0,0,0);driver.root.rotation.y=.15;
      driver.update(0,0,0,{}, {pos:new THREE.Vector3(driver.root.position.x,-.135,-.53),angle:0,euler:new THREE.Euler(-.36,0,0),r:.18});
      if(driver.passenger){scene.add(driver.passenger.root);driver.passenger.root.position.set(.25,0,0);driver.passenger.root.visible=true;}
      camera.position.set(driver.passenger ? .12 : .35,.06,driver.passenger?-1.9:-1.3);camera.lookAt(0,-.1,0);
    }
    else{model.root.visible=true;driver.root.rotation.y=0;bindDriverToCar(driver,model);driver.root.visible=true;driver.update(0,0,0,{},null);const distance=Math.max(7.7,5.4/camera.aspect);if(angle==='roof')camera.position.set(.01,distance,0);else if(angle==='rear')camera.position.set(distance*.68,distance*.33,distance*.66);else if(angle==='side')camera.position.set(distance,.9,-.1);else camera.position.set(distance*.68,distance*.33,-distance*.66);camera.lookAt(0,.65,0);}
    camera.updateProjectionMatrix();renderer.render(scene,camera);
  };
  const disposeDriver=()=>{if(!driver)return;driver.root.removeFromParent();if(driver.dispose){driver.dispose();return;}const materials=new Set();driver.root.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])materials.add(m);});for(const m of materials)m.dispose();};
  const update=async value=>{const ticket=++generation,look=normalizeAppearance(value);setPaint(model,look.paint);if(driver?.setAppearance)driver.setAppearance(look.driver);else {disposeDriver();driver=new Driver({...look.driver,hair:look.driver.hairStyle==='none'?false:look.driver.hair});scene.add(driver.root);}
    for(const id of look.decals.filter(d=>d.id==='photo').map(d=>d.assetId))await preparePhotoUrl(id);if(closed||ticket!==generation)return;applyCarDecals(model,look.decals);render();await model.decalReady;if(!closed&&ticket===generation)render();};
  const ro=new ResizeObserver(render);ro.observe(container);update(appearance);
  return {update,setView(value){view=value;render();},setAngle(value){angle=value;view='car';render();},render,model,get driver(){return driver;},dispose(){closed=true;generation++;ro.disconnect();disposeDriver();model.disposeDamage?.();const geometries=new Set(),materials=new Set(),textures=new Set();model.root.traverse(o=>{if(o.geometry&&!o.geometry.userData.shared)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const value of Object.values(m))if(value?.isCanvasTexture)textures.add(value);}});for(const r of [...geometries,...materials,...textures])r.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
}
