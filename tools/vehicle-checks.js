// Browser regression checks against the actual Three.js models (import via the studio).
import { CARS, CarModel, TRAFFIC_TYPES, trafficModel, setPaint } from '../src/cars.js';
import { PAINTS, savedPaint, savePaint } from '../src/vehicle-paint.js';
import { Hud } from '../src/hud.js';
import { RNG } from '../src/util.js';
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
    const a=trafficModel(type,type.colors[0],rng),b=trafficModel(type,type.colors[1],rng);plates.add(a.plate);plates.add(b.plate);
    roofFits(a);
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
