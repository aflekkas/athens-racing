// Run in the vehicle studio: (await import('/tools/p928-vehicle-checks.js')).runP928Checks()
import * as THREE from 'three';
import { CARS, CarModel, setPaint } from '../src/cars.js';
import { setCarLights } from '../src/vehicle-models.js';

export function runP928Checks(){
  const car=new CarModel(CARS.find(s=>s.id==='p928')),results=[];
  const check=(label,pass)=>{results.push({label,pass:!!pass});if(!pass)throw new Error(label);};
  const glass=car.body.getObjectByName('rear-glass'),quarter=car.body.getObjectByName('rear-door-glass');
  const sample=(o,u,v)=>{const uv=o.geometry.attributes.uv,p=o.geometry.attributes.position;let nearest=Infinity,index=0;for(let i=0;i<uv.count;i++){const d=(uv.getX(i)-u)**2+(uv.getY(i)-v)**2;if(d<nearest){nearest=d;index=i;}}return new THREE.Vector3().fromBufferAttribute(p,index);};
  const start=sample(glass,.5,0),middle=sample(glass,.5,.5),end=sample(glass,.5,1);
  check('928 curved hatch extends 1.5 m from roof into tail',end.z-start.z>1.45&&end.y<.93);
  check('928 hatch bows above a straight backlight',middle.y>(start.y+end.y)/2+.025);
  const tipTop=sample(quarter,1,1),tipBottom=sample(quarter,1,0),paneTop=sample(quarter,.25,1);
  check('928 quarter glass tapers to a point above rear axle',tipTop.distanceTo(tipBottom)<.012&&Math.abs(tipTop.z-car.shape.wb/2)<.10&&paneTop.y>tipTop.y+.18);
  check('928 side/hatch tint survives shared material setup',glass.material===quarter.material&&glass.material.opacity>.65&&glass.material.metalness===0);
  check('928 road LOD retains the tinted hatch',car.mediumDetail.children.some(o=>o.material===glass.material));
  const tint=glass.material.color.getHex();setPaint(car,'#135b38');
  check('928 repaint preserves glazing',glass.material.color.getHex()===tint&&car.paint.color.getHexString()==='135b38');
  car.root.updateMatrixWorld(true);
  const hinges=[];car.body.traverse(o=>{if(o.name==='popup-headlamp')hinges.push(o);});
  check('928 retains two independently damaged popup assemblies',hinges.length===2&&hinges.every(o=>o.children.length>=4&&o.parent.userData.damagePart?.startsWith('light_f')));
  const lenses=hinges.map(o=>o.getObjectByName('headlamp-lens'));
  const vertex=o=>car.body.worldToLocal(o.localToWorld(new THREE.Vector3().fromBufferAttribute(o.geometry.attributes.position,1)));
  const rest=lenses.map(vertex);
  check('928 closed lenses follow crowned wings within 3 cm',rest.every(q=>Math.abs(q.y-car.playerSurface.deck(q.x,q.z))<.03));
  setCarLights(car,true);car.updateHeadlamps(1);car.root.updateMatrixWorld(true);
  check('928 lights raise both lenses toward the road',lenses.every((o,i)=>vertex(o).y>rest[i].y+.10)&&hinges.every(o=>o.rotation.x<-.9));
  setCarLights(car,false);car.updateHeadlamps(1);car.root.updateMatrixWorld(true);
  check('928 lamps return to their original closed pose',lenses.every((o,i)=>vertex(o).distanceTo(rest[i])<1e-6));
  const base=car.damageMeshes.map(o=>o.geometry.attributes.position.array.slice());
  car.setDamage('front',.7);car.setDamage('rear',.6);
  check('928 new shell deforms on impact',car.damageMeshes.some((o,k)=>o.geometry.attributes.position.array.some((v,i)=>Math.abs(v-base[k][i])>1e-5)));
  car.setDamage('front',0);car.setDamage('rear',0);
  check('928 repaired geometry returns to its rest shape',car.damageMeshes.every((o,k)=>o.geometry.attributes.position.array.every((v,i)=>Math.abs(v-base[k][i])<1e-6)));
  check('928 geometry remains finite',car.damageMeshes.every(o=>o.geometry.attributes.position.array.every(Number.isFinite)));
  car.disposeDamage?.();
  return {passed:results.length,results};
}
