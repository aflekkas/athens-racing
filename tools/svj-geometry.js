import * as THREE from 'three';
import {CarModel,CARS} from '../src/cars.js';
export function checkSVJGeometry(){
 const car=new CarModel(CARS.find(s=>s.id==='aventador_svj')),out=[];
 const check=(name,pass,value)=>{out.push({name,pass:!!pass,value});if(!pass)throw new Error(name+': '+JSON.stringify(value));};
 car.root.updateMatrixWorld(true);let count=0,finite=true;
 car.root.traverse(o=>{const a=o.geometry?.attributes.position;if(!a)return;count+=a.count;for(let i=0;i<a.array.length;i++)if(!Number.isFinite(a.array[i]))finite=false;});check('finite real mesh vertices',finite,count);
 car.exhaustFlames.group.removeFromParent();const bounds=new THREE.Box3().setFromObject(car.body),size=bounds.getSize(new THREE.Vector3());car.body.add(car.exhaustFlames.group);check('actual shell proportions include long deck and fixed wing',size.z>4.9&&size.z<5.4&&size.x>2.09&&size.x<2.6&&bounds.max.y>1.2&&bounds.max.y<1.6,size.toArray());
 check('four wheels on 2.70m wheelbase',car.wheels.length===4&&Math.abs(car.wheels[2].pivot.position.z-car.wheels[0].pivot.position.z-2.7)<.01,car.wheels.map(w=>w.pivot.position.toArray()));
 check('high central twin hex outlets',car.exhaust.length===2&&car.exhaust.every(p=>Math.abs(p.x)<.2&&p.y>.7&&p.z>2.5),car.exhaust.map(p=>p.toArray()));
 const fx=car.exhaustFlames,s={rpm:7800,redline:8500,throttle:1,events:[{serial:1,type:'shift-start',direction:1}]};fx.update(.016,s,true,'high');check('flash on high',fx.light.visible&&fx.light.intensity>0,fx.light.intensity);
 check('six axial noise-textured ribbons, no cone geometry',fx.flames.length===6&&fx.noiseMap.isDataTexture&&fx.flames.every(f=>f.geometry===fx.ribbonGeometry&&f.material.isShaderMaterial&&f.scale.z>.3&&f.scale.z<=.8));
 car.root.position.set(7,2,-13);car.root.rotation.set(.12,1.3,-.1);car.body.rotation.set(.08,0,.06);car.root.updateMatrixWorld(true);
 for(let i=0;i<2;i++){const expected=car.body.localToWorld(car.exhaust[i].clone()),actual=fx.group.children[i].getWorldPosition(new THREE.Vector3());check('flame attached through body pitch/roll '+i,expected.distanceTo(actual)<1e-6,expected.distanceTo(actual));}
 fx.beginMirror(car.body);fx.mirrorRoot.updateMatrixWorld(true);check('mirror proxy keeps exhaust world position',fx.mirrorRoot.children[0].getWorldPosition(new THREE.Vector3()).distanceTo(car.body.localToWorld(car.exhaust[0].clone()))<1e-6);fx.endMirror();
 fx.update(.01,s,true,'potato');check('Potato no light or sparks',!fx.light.visible&&!fx.sparks.visible);
 const geometries=new Set(),materials=new Set();car.root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});const n=geometries.size,m=materials.size;
 for(let i=0;i<1000;i++)fx.update(1/60,s,true,'low');car.root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});check('effect reuses GPU resources over 1000 frames',n===geometries.size&&m===materials.size,{geometries:n,materials:m});
 fx.dispose();car.disposeDamage?.();return out;
}
