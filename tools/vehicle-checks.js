// Browser regression checks against the actual Three.js models (import via the studio).
import { CARS, CarModel, TRAFFIC_TYPES, trafficModel, setPaint } from '../src/cars.js';
import { PAINTS, savedPaint, savePaint } from '../src/vehicle-paint.js';
import { Hud } from '../src/hud.js';
import { RNG } from '../src/util.js';
import * as THREE from 'three';
import { bakeParkedFleet } from '../src/traffic-fleet.js';
export function runVehicleChecks() {
  const results=[];const check=(label,value)=>{results.push({label,pass:!!value});if(!value)throw new Error(label);};
  // Test the actual assembled vertices: both curved glass edges must meet painted roof vertices.
  const roofFits=car=>{
    const rear=car.body.getObjectByName('rear-glass');if(!rear)return;
    const front=car.body.getObjectByName('windscreen'),paint=[];
    car.body.traverse(o=>{if(o.isMesh&&(o.material===car.paint||car.modelKind==='gr_yaris'&&o.material===car.materials.black))paint.push(o.geometry.attributes.position);});
    let gap=0;
    for(const [glass,indices] of [[front,[10,12*11+10,24*11+10]],[rear,[0,11*13,22*13]]]){
      const a=glass.geometry.attributes.position;
      for(const i of indices){let nearest=Infinity;for(const p of paint)for(let j=0;j<p.count;j++)nearest=Math.min(nearest,Math.hypot(a.getX(i)-p.getX(j),a.getY(i)-p.getY(j),a.getZ(i)-p.getZ(j)));gap=Math.max(gap,nearest);}
    }
    check((car.spec.id||car.modelKind)+' roof joins front and rear glass within 0.1 mm',gap<.0001);
  };
  check('Six unique playable cars including AWD and rear-engine',CARS.length===6&&new Set(CARS.map(s=>s.id)).size===6&&CARS.some(s=>s.drive==='awd')&&CARS.some(s=>s.engineZone==='rear'));
  for(const spec of CARS){
    const car=new CarModel(spec);check(spec.id+' independent four wheel assemblies',car.wheels.length===4&&new Set(car.wheels.map(w=>w.spin)).size===4&&car.wheels.every(w=>w.spin.parent===w.pivot&&w.pivot.parent===car.root));
    roofFits(car);
    check(spec.id+' six to eight named factory/fleet paints',PAINTS[spec.id].length>=6&&PAINTS[spec.id].length<=8);
    const originalSpecColor=spec.color,originalGlass=car.materials.glass.color.getHex(),originalLamp=car.materials.head.color.getHex();
    check(spec.id+' custom paint changes body only',setPaint(car,'#123abc')&&car.paint.color.getHexString()==='123abc'&&spec.color===originalSpecColor&&car.materials.glass.color.getHex()===originalGlass&&car.materials.head.color.getHex()===originalLamp);
    check(spec.id+' invalid paint is rejected',!setPaint(car,'not-a-colour')&&car.paint.color.getHexString()==='123abc');
    const before=car.wheels.map(w=>w.caliper.rotation.x);car.update(.1,10,.3,true,null,[{vw:12},{vw:8},{vw:9},{vw:11}]);
    check(spec.id+' each mesh follows its actual corner speed',car.wheels.every((w,i)=>Math.abs(w.spin.rotation.x+[12,8,9,11][i]*.1/w.r)<1e-6));
    check(spec.id+' calipers do not spin',car.wheels.every((w,i)=>w.caliper.rotation.x===before[i]));
    check(spec.id+' right turn steers right, inner more',car.wheels[0].pivot.rotation.y<0&&car.wheels[1].pivot.rotation.y<car.wheels[0].pivot.rotation.y&&car.wheels[2].pivot.rotation.y===0);
    const v0=car.wheels[0].spin.rotation.x;car.update(.1,-5,0,false,null);check(spec.id+' reversing reverses wheel spin',car.wheels[0].spin.rotation.x>v0);
    const originals=car.damageMeshes.map(m=>m.geometry.attributes.position.array.slice());car.setDamage('front',.9);car.setDamage('left',.5);
    check(spec.id+' damage deforms panels',car.damageMeshes.some((m,k)=>m.geometry.attributes.position.array.some((v,i)=>Math.abs(v-originals[k][i])>1e-5)));
    car.setDamage('front',0);car.setDamage('left',0);
    check(spec.id+' repair restores every vertex',car.damageMeshes.every((m,k)=>m.geometry.attributes.position.array.every((v,i)=>Math.abs(v-originals[k][i])<1e-6)));
    let finite=true;car.root.traverse(o=>{if(o.isMesh)for(const v of o.geometry.attributes.position.array)if(!Number.isFinite(v))finite=false;});check(spec.id+' geometry finite',finite);
    check(spec.id+' body dimensions match physical collider',Math.abs(car.dims.L-spec.length)<.001&&Math.abs(car.dims.W-spec.width)<.001);
  }
  const types=TRAFFIC_TYPES.filter(t=>t.model&&!t.police),rng=new RNG(41),plates=new Set();
  for(const type of types){
    const otherColor=type.colors.find(c=>c!==type.colors[0])||'#426a8d';
    const a=trafficModel(type,type.colors[0],rng),b=trafficModel(type,otherColor,rng);plates.add(a.plate);plates.add(b.plate);
    // Fleet topology has its own checks; the player roof sample indices do not apply.
    check(type.id+' cached geometry shared before damage',a.damageMeshes.some((m,i)=>m.geometry===b.damageMeshes[i]?.geometry));
    const rest=b.damageMeshes.map(m=>m.geometry.attributes.position.array.slice());a.setDamage('rear',1);
    check(type.id+' damage is isolated to hit car',b.damageMeshes.every((m,k)=>m.geometry.attributes.position.array.every((v,i)=>v===rest[k][i])));
    check(type.id+' paint independently coloured',a.paint!==b.paint&&a.paint.color.getHex()!==b.paint.color.getHex());
    check(type.id+' brake lights independent',a.tail!==b.tail);
  }
  check('Traffic registrations unique',plates.size===types.length*2);
  const key='paraliaki.paint.__vehicle_test',prior=localStorage.getItem(key);
  try{savePaint('__vehicle_test','#Fa3400');check('Custom paint persists by car id',savedPaint({id:'__vehicle_test',color:'#ffffff'})==='#fa3400');localStorage.setItem(key,'broken');check('Corrupt saved paint falls back safely',savedPaint({id:'__vehicle_test',color:'#ffffff'})==='#ffffff');}
  finally{if(prior===null)localStorage.removeItem(key);else localStorage.setItem(key,prior);}
  return {passed:results.length,results};
}

// Exercises the real garage controls without constructing a second world/terrain HUD.
export function runGaragePaintChecks(){
  const hud=Object.create(Hud.prototype),host=document.createElement('section');hud.el={};let passed=0;
  for(const id of ['cIdx','cName','cTag','cSpecs','cStats','cBest']){const e=document.createElement('div');host.append(e);hud.el[id]=e;}
  const before=new Map(CARS.map(c=>[c.id,localStorage.getItem('paraliaki.paint.'+c.id)]));
  const assert=(ok,label)=>{if(!ok)throw new Error(label);passed++;};
  try{
    for(const [i,spec]of CARS.entries()){
      const model=new CarModel(spec);hud.onPaint=(id,color)=>{assert(id===spec.id,'Paint callback car id');setPaint(model,color);};hud.showCar(CARS,i,0);
      const buttons=hud.paintPanel.querySelectorAll('button');assert(buttons.length===PAINTS[spec.id].length,'Factory swatches rendered');buttons[1].click();
      assert(model.paint.color.getHexString()===PAINTS[spec.id][1][1].slice(1),'Swatch updates visible model');
      const picker=hud.paintPanel.querySelector('input');picker.value='#3498ab';picker.dispatchEvent(new Event('input'));
      assert(model.paint.color.getHexString()==='3498ab'&&savedPaint(spec)==='#3498ab','Picker updates model and saves per-car preference');
      const restored=new CarModel(spec);assert(restored.paint.color.getHexString()==='3498ab','Rebuilt car restores saved custom colour');
      assert(hud.el.cIdx.textContent===`${i+1}/6`,'Garage index derives from six-car catalogue');
    }
  }finally{for(const [id,c]of before){const key='paraliaki.paint.'+id;if(c===null)localStorage.removeItem(key);else localStorage.setItem(key,c);}host.remove();}
  return {passed};
}

export function runPoliceChecks(){
  let passed=0;const check=(v,label)=>{if(!v)throw new Error(label);passed++;};
  const seen=new Set();
  for(const id of ['police','police_moto']){
    const type=TRAFFIC_TYPES.find(t=>t.id===id);check(type?.police&&type.w===0,id+' explicit spawn only');
    const a=trafficModel(type,type.colors[0],new RNG(42)),b=trafficModel(type,type.colors[0],new RNG(43),{parked:true});
    check(a.wheels.length===(type.moto?2:4)&&a.wheels.every(w=>w.spin.parent===w.pivot&&w.pivot!==w.spin),id+' steering/spin hierarchy');
    check(typeof b.setStrobe==='function'&&typeof b.setDamage==='function',id+' parked hooks');
    for(const m of [a,b]){check(m.plate&&!seen.has(m.plate),id+' unique plate');seen.add(m.plate);}
    const levels=t=>{a.setStrobe(true,t);return a.strobeMaterials.map(m=>m.emissiveIntensity);};
    check(levels(.02)[0]===9&&levels(.02)[1]===0&&levels(.12)[0]===9&&levels(.08)[0]===0&&levels(.34)[1]===9,id+' alternating double flash');
    a.setStrobe(false,.34);check(a.strobeMaterials.every(m=>m.emissiveIntensity===0)&&b.strobeMaterials.every(m=>m.emissiveIntensity===0),id+' off and independent');
    const base=a.damageMeshes.map(m=>m.geometry.attributes.position.array.slice());a.setDamage('front',.8);check(a.damageMeshes.some((m,k)=>m.geometry.attributes.position.array.some((v,i)=>Math.abs(v-base[k][i])>1e-5)),id+' damaged');a.setDamage('front',0);check(a.damageMeshes.every((m,k)=>m.geometry.attributes.position.array.every((v,i)=>Math.abs(v-base[k][i])<1e-6)),id+' repaired');
    let finite=true;a.root.traverse(o=>{if(o.isMesh)for(const v of o.geometry.attributes.position.array)if(!Number.isFinite(v))finite=false;});check(finite,id+' finite');
  }
  return {passed};
}

// Covers every road and parked model, rather than only the original detailed taxi/BYD subset.
export function runTrafficFleetChecks(){
  const results=[],counts=[],plates=new Set(),rng=new RNG(994);
  const check=(label,ok)=>{results.push({label,pass:!!ok});if(!ok)throw new Error(label);};
  const triangles=root=>{let n=0;root.traverseVisible(o=>{if(o.isMesh)n+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});return n;};
  const finite=root=>{let ok=true;root.traverse(o=>{if(o.isMesh)for(const v of o.geometry.attributes.position.array)if(!Number.isFinite(v))ok=false;});return ok;};
  for(const type of TRAFFIC_TYPES){
    const a=trafficModel(type,type.colors[0],rng),b=trafficModel(type,'#3277b1',rng),p=trafficModel(type,type.colors[0],rng,{parked:true});
    for(const m of [a,b,p]){check(type.id+' unique registration',!!m.plate&&!plates.has(m.plate));plates.add(m.plate);}
    check(type.id+' real catalogue dimensions',Math.abs(a.dims.L-type.len)<.002&&Math.abs(a.dims.W-type.wid)<.002);
    check(type.id+' independent steering and spinning',a.wheels.length===(type.scooter?2:4)&&a.wheels.every(w=>w.spin.parent===w.pivot&&w.pivot.parent===a.root&&w.r>0));
    check(type.id+' per-instance paint/lights',a.paint!==b.paint&&a.tail!==b.tail&&a.paint.color.getHex()!==b.paint.color.getHex());
    check(type.id+' named damage parts',a.damageParts.length>=2);
    check(type.id+' shared geometry before impacts',a.damageMeshes.some((m,i)=>m.geometry===b.damageMeshes[i]?.geometry));
    a.setLOD(0);const near=triangles(a.root);a.setLOD(150);const far=triangles(a.root);
    check(type.id+' distance detail reduces work',a.lodLevel===1&&far<near*.65);check(type.id+' near budget',near<=20000);check(type.id+' far budget',far<=3000);
    a.wheels.forEach(w=>{w.spin.rotation.x=.8;w.pivot.rotation.y=w.front?.2:0;});a.setLOD(0);
    check(type.id+' LOD keeps wheel transforms',a.wheels.every(w=>w.spin.rotation.x===.8&&w.pivot.rotation.y===(w.front?.2:0)));
    const rest=a.damageMeshes.map(m=>m.geometry.attributes.position.array.slice()),other=b.damageMeshes.map(m=>m.geometry.attributes.position.array.slice());
    a.setDamage('front',.65);a.setDamage('right',.4);
    check(type.id+' deforms on contact',a.damageMeshes.some((m,k)=>m.geometry.attributes.position.array.some((v,i)=>Math.abs(v-rest[k][i])>1e-5)));
    check(type.id+' damage isolated',b.damageMeshes.every((m,k)=>m.geometry.attributes.position.array.every((v,i)=>v===other[k][i])));
    a.setDamage('front',0);a.setDamage('right',0);check(type.id+' fully repairable',a.damageMeshes.every((m,k)=>m.geometry.attributes.position.array.every((v,i)=>Math.abs(v-rest[k][i])<1e-6)));
    const lamps=[];a.root.traverse(o=>{if(o.isMesh&&o.userData.damagePart?.startsWith('light_f')&&o.material.emissive)lamps.push(o.material);});
    for(const m of lamps){m.userData.damageBroken=true;m.emissiveIntensity=0;}a.setLights(true);
    check(type.id+' lighting cannot revive a broken headlamp',lamps.length>0&&lamps.every(m=>m.emissiveIntensity===0));
    for(const m of lamps)delete m.userData.damageBroken;a.setLights(false);
    a.setLOD(150);const farLamps=[];a.root.traverseVisible(o=>{if(o.isMesh&&o.userData.damagePart?.startsWith('light_f'))farLamps.push(o);});
    a.setDamage('front',1);a.setLights(true);
    check(type.id+' far lamps retain damage across LOD and lighting changes',farLamps.length>0&&farLamps.every(o=>o.material.userData.damageBroken&&o.material.emissiveIntensity===0));
    a.setDamage('front',0);a.setLights(false);
    const farTails=[];a.root.traverseVisible(o=>{if(o.isMesh&&o.userData.damagePart?.startsWith('light_r'))farTails.push(o);});
    a.setDamage('rear',1);a.tail.emissiveIntensity=5;a.updateDamage(.01);
    check(type.id+' far broken tail lamps ignore brake-light updates',farTails.length>0&&farTails.every(o=>o.material.userData.damageBroken&&o.material.emissiveIntensity===0));a.setDamage('rear',0);
    check(type.id+' finite geometry',finite(a.root)&&finite(p.root));
    check(type.id+' parked detail available',typeof p.makeNear==='function'&&typeof p.setDamage==='function');
    counts.push({id:type.id,near,far,parked:triangles(p.root),parts:a.damageParts.length});
  }
  const type=TRAFFIC_TYPES.find(t=>t.id==='hatch'),parked=[trafficModel(type,'#bbbbbb',rng,{parked:true}),trafficModel(type,'#224477',rng,{parked:true})];parked[1].root.position.x=5;
  const hidden=new THREE.Group();hidden.visible=false;const sentinel=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),parked[0].paint);sentinel.position.y=50;hidden.add(sentinel);parked[0].root.add(hidden);
  const cells=bakeParkedFleet(parked,40),camera=new THREE.PerspectiveCamera();camera.position.set(0,3,10);
  check('Parked bake excludes children of hidden damage groups',new THREE.Box3().setFromObject(cells).max.y<5);sentinel.geometry.dispose();hidden.removeFromParent();
  for(const cell of cells.children){cell.update(camera);check('Parked cell creates near LOD safely',cell.levels.length===2&&cell.near?.visible);camera.position.set(1000,3,1000);cell.update(camera);check('Parked cell evicts expensive geometry',!cell.near&&cell.levels.length===1&&cell.low.visible);}
  return {passed:results.length,counts,results};
}

// Measure the complete playable assembly, including the hero cockpit, using
// actual visibility after THREE.LOD updates rather than counting hidden levels.
export async function runPlayerBudgetChecks() {
  const { Cockpit } = await import('../src/cockpit.js');
  const results=[],counts=[],camera=new THREE.PerspectiveCamera();
  for(const spec of CARS){
    const car=new CarModel(spec);new Cockpit(spec,car,new THREE.Texture());
    car.root.updateMatrixWorld(true);const rows=[];
    for(const [distance,budget]of [[5,80000],[20,20000],[100,3000]]){
      camera.position.set(0,0,distance);camera.updateMatrixWorld(true);
      car.root.traverse(o=>{if(o.isLOD)o.update(camera);});
      let triangles=0,draws=0;car.root.traverseVisible(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;draws++;}});
      const pass=triangles<=budget,label=`${spec.id} at ${distance}m: ${triangles} triangles <= ${budget}`;
      results.push({label,pass});if(!pass)throw new Error(label);rows.push({distance,triangles,draws});
    }
    counts.push({id:spec.id,levels:rows});car.disposeDamage?.();
  }
  return {passed:results.length,counts,results};
}
