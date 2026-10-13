// Browser regression checks against the actual Three.js models (import via the studio).
import { CARS, CarModel, TRAFFIC_TYPES, trafficModel, setPaint } from '../src/cars.js';
import { PAINTS, savedPaint, savePaint } from '../src/vehicle-paint.js';
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
  const types=TRAFFIC_TYPES.filter(t=>t.model),rng=new RNG(41),plates=new Set();
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
