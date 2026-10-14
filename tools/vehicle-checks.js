// Browser regression checks against the actual Three.js models (import via the studio).
import { CARS, CarModel, TRAFFIC_TYPES, trafficModel, setPaint } from '../src/cars.js';
import { PAINTS, savedPaint, savePaint } from '../src/vehicle-paint.js';
import { Hud } from '../src/hud.js';
import { RNG } from '../src/util.js';
import * as THREE from 'three';
import { nearestSurface, mirrorSurfaces } from '../src/vehicle-mirrors.js';
import { bakeParkedFleet } from '../src/traffic-fleet.js';
export function runVehicleChecks(carIds=null) {
  const results=[];const check=(label,value)=>{results.push({label,pass:!!value});if(!value)throw new Error(label);};
  // Test the actual assembled vertices: both curved glass edges must meet painted roof vertices.
  const roofFits=car=>{
    const rear=car.body.getObjectByName('rear-glass');if(!rear||car.spec.fleet)return;
    const front=car.body.getObjectByName('windscreen'),paint=[];
    car.body.traverse(o=>{if(o.isMesh&&(o.material===car.paint||car.shape.blackRoof&&o.material.color?.getHex()===car.materials.black.color.getHex()))paint.push(o.geometry.attributes.position);});
    let gap=0;
    for(const [glass,indices] of [[front,[10,12*11+10,24*11+10]],[rear,[0,11*13,22*13]]]){
      const a=glass.geometry.attributes.position;
      for(const i of indices){let nearest=Infinity;for(const p of paint)for(let j=0;j<p.count;j++)nearest=Math.min(nearest,Math.hypot(a.getX(i)-p.getX(j),a.getY(i)-p.getY(j),a.getZ(i)-p.getZ(j)));gap=Math.max(gap,nearest);}
    }
    check((car.spec.id||car.modelKind)+' roof joins front and rear glass within 0.1 mm',gap<.0001);
  };
  check('Unique playable catalogue including AWD and rear-engine',CARS.length>=10&&new Set(CARS.map(s=>s.id)).size===CARS.length&&CARS.some(s=>s.drive==='awd')&&CARS.some(s=>s.engineZone==='rear'));
  for(const spec of CARS.filter(s=>!carIds||carIds.includes(s.id))){
    const car=new CarModel(spec);check(spec.id+' independent four wheel assemblies',car.wheels.length===4&&new Set(car.wheels.map(w=>w.spin)).size===4&&car.wheels.every(w=>w.spin.parent===w.pivot&&w.pivot.parent===car.root));
    roofFits(car);
    if(spec.marque==='mercedes'){
      check(spec.id+' uses dedicated Mercedes body',!!car.mercedesSurface&&car.shape.mercedes);
      check(spec.id+' retains player parts, LOD and three mirror anchors',!!car.playerParts&&car.visualLOD.levels.length>=3&&!!car.windscreen&&!!car.mirrorL&&!!car.mirrorR);
      check(spec.id+' sourced wheelbase and height',Math.abs(car.shape.wb-spec.wheelbase)<.001&&Math.abs(car.dims.H-spec.height)<.001);
      check(spec.id+' matching registration faces',!!car.plate&&!!car.materials.plate.map);
      check(spec.id+' named paint is the default',PAINTS[spec.id].some(p=>p[1]===spec.color));
      check(spec.id+' correct exhaust count',car.exhaust.length===(spec.id==='gla45'?4:2));
      if(spec.id==='cle'||spec.id==='gla45')check(spec.id+' AWD distribution',spec.drive==='awd'&&spec.awdRear>0&&spec.awdRear<1);
      else check(spec.id+' front driven hybrid/petrol',spec.drive==='fwd');
      if(spec.id==='cla')check('New CLA defaults to obsidian black',spec.color==='#111419');
      if(car.shape.suv){
        const glass=car.body.getObjectByName('rear-glass');glass.geometry.computeBoundingBox();const b=glass.geometry.boundingBox;
        check(spec.id+' hatch roof extends behind the rear axle',b.min.z>car.shape.wb/2+car.shape.axleOffset+(car.shape.sculpted?.18:.25));
        check(spec.id+' short raised hatch glazing, no saloon backlight',b.min.y>1.14&&b.max.y-b.min.y>.24&&b.max.z-b.min.z<(car.shape.sculpted?.60:.45));
        check(spec.id+' fixed rear quarter-light and complete hatch panel',!!car.body.getObjectByName('rear-quarter-glass')&&car.playerParts.boot.children.length>0);
        check(spec.id+' rear axle uses its sourced track',car.wheels.filter(w=>!w.front).every(w=>Math.abs(Math.abs(w.pivot.position.x)*2-spec.trackRear)<.001));
        const face=car.mercedesSurface.face,z=car.shape.L/2;
        check(spec.id+' bumper rolls under and rounds its outer corners',face(0,z,.63)-face(0,z,.20)>.07&&face(0,z,.63)-face(.72,z,.63)>.07);
        if(spec.id==='gla45'){
          const side=car.mercedesSurface.side,axle=-car.shape.wb/2+car.shape.axleOffset;
          check('AMG sculpted fender projects beyond door waist',side(axle,car.shape.r*2+.08)-side(0,.78)>.05);
          check('AMG distinct dark wheels and fixed red calipers',car.materials.wheelMetal===car.materials.darkAlloy&&car.wheels.every(w=>w.caliper.material===car.materials.red));
        }
      }
    }
    if(spec.id==='z4'){
      const {top,side,deck}=car.playerSurface,R=car.dims.L/2;
      check('Z4 low rear deck',deck(0,R)<.98&&deck(0,R-.2)<.97);
      check('Z4 short ducktail rise',top(R)-top(R-.14)>.015&&top(R)-top(R-.14)<.04);
      check('Z4 hips taper into tail',side(R,.8)<side(car.shape.wb/2,.8)*.90);
    }

    check(spec.id+' six to eight named factory/fleet paints',PAINTS[spec.id].length>=6&&PAINTS[spec.id].length<=8);
    const originalSpecColor=spec.color,originalGlass=car.materials.glass.color.getHex(),originalLamp=car.materials.head.color.getHex();
    check(spec.id+' custom paint changes body only',setPaint(car,'#123abc')&&car.paint.color.getHexString()==='123abc'&&spec.color===originalSpecColor&&car.materials.glass.color.getHex()===originalGlass&&car.materials.head.color.getHex()===originalLamp);
    check(spec.id+' invalid paint is rejected',!setPaint(car,'not-a-colour')&&car.paint.color.getHexString()==='123abc');
    const before=car.wheels.map(w=>w.caliper.rotation.x);car.update(.1,10,.3,true,null,[{vw:12},{vw:8},{vw:9},{vw:11}]);
    check(spec.id+' each mesh follows its actual corner speed',car.wheels.every((w,i)=>Math.abs(w.spin.rotation.x+[12,8,9,11][i]*.1/w.r)<1e-6));
    check(spec.id+' calipers do not spin',car.wheels.every((w,i)=>w.caliper.rotation.x===before[i]));
    check(spec.id+' right turn steers right, inner more',car.wheels[0].pivot.rotation.y<0&&car.wheels[1].pivot.rotation.y<car.wheels[0].pivot.rotation.y&&car.wheels[2].pivot.rotation.y===0);
    const v0=car.wheels[0].spin.rotation.x;car.update(.1,-5,0,false,null);check(spec.id+' reversing reverses wheel spin',car.wheels[0].spin.rotation.x>v0);
    const travel=[.07,-.025,.018,-.042],pose={heave:.09,pitch:.10,roll:-.07};
    const corners=travel.map(zu=>({zu,vw:0}));
    car.update(0,0,0,false,pose,corners);car.update(0,0,0,false,pose,corners);
    check(spec.id+' independent suspension travel does not accumulate or inherit body motion',car.wheels.every((w,i)=>Math.abs(w.pivot.position.y-w.restY-travel[i])<1e-9));
    const mounted=car.wheels[0];car.body.add(mounted.pivot);car.update(0,0,0,false,pose,corners);
    car.body.updateMatrix();const centre=mounted.pivot.position.clone().applyMatrix4(car.body.matrix);
    check(spec.id+' body-mounted suspension removes heave pitch and roll',Math.abs(centre.y-mounted.restY-travel[0])<1e-9);
    car.root.add(mounted.pivot);car.update(0,0,0,false,{heave:0,pitch:0,roll:0},travel.map(()=>({zu:0,vw:0})));
    check(spec.id+' suspension reset restores wheel centres',car.wheels.every(w=>Math.abs(w.pivot.position.y-w.restY)<1e-9));
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
      assert(hud.el.cIdx.textContent===`${i+1}/${CARS.length}`,'Garage index derives from catalogue');
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
export function runTrafficFleetChecks(carIds=null){
  const results=[],counts=[],plates=new Set(),rng=new RNG(994);
  const check=(label,ok)=>{results.push({label,pass:!!ok});if(!ok)throw new Error(label);};
  const triangles=root=>{let n=0;root.traverseVisible(o=>{if(o.isMesh)n+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});return n;};
  const finite=root=>{let ok=true;root.traverse(o=>{if(o.isMesh)for(const v of o.geometry.attributes.position.array)if(!Number.isFinite(v))ok=false;});return ok;};
  for(const type of TRAFFIC_TYPES.filter(t=>!carIds||carIds.includes(t.id))){
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
  const type=TRAFFIC_TYPES.find(t=>t.id==='golf'),parked=[trafficModel(type,'#bbbbbb',rng,{parked:true}),trafficModel(type,'#224477',rng,{parked:true})];parked[1].root.position.x=5;
  const hidden=new THREE.Group();hidden.visible=false;const sentinel=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),parked[0].paint);sentinel.position.y=50;hidden.add(sentinel);parked[0].root.add(hidden);
  const cells=bakeParkedFleet(parked,40),camera=new THREE.PerspectiveCamera();camera.position.set(0,3,10);
  check('Parked bake excludes children of hidden damage groups',new THREE.Box3().setFromObject(cells).max.y<5);sentinel.geometry.dispose();hidden.removeFromParent();
  for(const cell of cells.children){cell.update(camera);check('Parked cell creates near LOD safely',cell.levels.length===2&&cell.near?.visible);camera.position.set(1000,3,1000);cell.update(camera);check('Parked cell evicts expensive geometry',!cell.near&&cell.levels.length===1&&cell.low.visible);}
  return {passed:results.length,counts,results};
}

// Measure the complete playable assembly, including the hero cockpit, using
// actual visibility after THREE.LOD updates rather than counting hidden levels.
export async function runPlayerBudgetChecks(carIds=null) {
  const { Cockpit } = await import('../src/cockpit.js');
  const results=[],counts=[],camera=new THREE.PerspectiveCamera();
  for(const spec of CARS.filter(s=>!carIds||carIds.includes(s.id))){
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


// Measure actual cylinder cap vertices against body triangles, not bounding boxes
// or authored metadata. A 20 mm displaced stalk must fail this same test.
export function measureMirrorGaps(car){
  car.root.updateMatrixWorld(true);const rows=[];
  car.body.traverseVisible(group=>{
    if(!group.userData.mirrorAssembly)return;
    const arm=group.getObjectByName('mirror-stalk'),housing=group.getObjectByName('mirror-housing'),scope=group.parent;
    const p=arm.geometry.parameters,n=p.radialSegments,h=p.heightSegments,a=arm.geometry.attributes.position;
    const inScope=i=>scope.worldToLocal(arm.localToWorld(new THREE.Vector3().fromBufferAttribute(a,i)));
    const tip=inScope((n+1)*(h+1)),root=inScope((n+1)*(h+1)+2*n+1);
    const mount=nearestSurface(root,mirrorSurfaces(car,scope),scope);
    // Tip is embedded in the housing; distance to its bounding volume is zero.
    const tipWorld=scope.localToWorld(tip.clone()),box=new THREE.Box3().setFromObject(housing);
    rows.push({side:group.name,rootGap:mount?.distance??Infinity,tipGap:box.distanceToPoint(tipWorld),stalkLength:root.distanceTo(tip),stalkRadius:p.radiusTop});
  });return rows;
}
export function runMirrorChecks(carIds=null){
  const results=[],rng=new RNG(502),camera=new THREE.PerspectiveCamera();
  const verify=(car,label)=>{const rows=measureMirrorGaps(car);if(rows.length!==2)throw new Error(label+': expected two visible mirrors, got '+rows.length);for(const row of rows){const pass=row.rootGap<=.005&&row.tipGap<=.005;results.push({label:label+' '+row.side,pass,...row});if(!pass)throw new Error(JSON.stringify(results.at(-1)));}};
  for(const spec of CARS.filter(s=>!carIds||carIds.includes(s.id))){const car=new CarModel(spec);
    for(const distance of [5,20,100]){camera.position.set(0,0,distance);camera.updateMatrixWorld();car.root.updateMatrixWorld(true);car.root.traverse(o=>{if(o.isLOD)o.update(camera);});
      if(spec.id!=='gtv')for(const row of measureMirrorGaps(car)){const pass=row.stalkLength<.20&&row.stalkRadius>=.018;results.push({label:spec.id+' '+distance+'m short door-mirror stalk '+row.side,pass,...row});if(!pass)throw new Error(JSON.stringify(results.at(-1)));}
      for(const color of [spec.color,'#2375a9']){setPaint(car,color);verify(car,spec.id+' '+distance+'m '+color);}
      car.setDamage('left',.12);car.setDamage('front',.3);verify(car,spec.id+' '+distance+'m dented');car.setDamage('left',0);car.setDamage('front',0);verify(car,spec.id+' '+distance+'m repaired');
    }
  }
  if(!carIds)for(const type of TRAFFIC_TYPES)for(const parked of [false,true]){
    const car=trafficModel(type,type.colors[0],rng,{parked});
    for(const distance of parked?[0]:[0,150]){car.setLOD(distance);verify(car,type.id+' '+(parked?'parked':distance));car.setDamage('right',.12);car.setDamage('front',.3);verify(car,type.id+' damaged '+distance);car.setDamage('right',0);car.setDamage('front',0);verify(car,type.id+' repaired '+distance);setPaint(car,'#4386a1');verify(car,type.id+' repainted '+distance);}
    if(parked)verify(car.makeNear(),type.id+' parked near');
  }
  const probe=new CarModel(CARS[0]),arm=probe.root.getObjectByName('mirror-stalk');arm.position.x-=.03;
  if(!measureMirrorGaps(probe).some(r=>r.rootGap>.005))throw new Error('Gap check missed deliberately displaced mirror');
  return {passed:results.length,maxGap:Math.max(...results.map(r=>r.rootGap)),results};
}

// Driver sightlines, independent optical views, update cadence and low-quality off.
export async function runCockpitMirrorChecks(carIds=null){
  const {Cockpit}=await import('../src/cockpit.js'),results=[];
  const check=(label,pass)=>{results.push({label,pass:!!pass});if(!pass)throw new Error(label);};
  for(const spec of CARS.filter(s=>!carIds||carIds.includes(s.id))){
    const car=new CarModel(spec),cockpit=new Cockpit(spec,car),camera=new THREE.PerspectiveCamera(66,1.6,.04,600);
    camera.position.copy(cockpit.eye);camera.position.y+=.02;camera.rotation.x=-.045;
    camera.fov=Math.max(66,cockpit.mirrorFov(camera.aspect));camera.updateProjectionMatrix();camera.updateMatrixWorld(true);car.root.updateMatrixWorld(true);
    const visible=[];car.root.traverseVisible(o=>{if(o.isMesh&&(!o.material.transparent||o.material.opacity>.9))visible.push(o);});
    // A mirror fit must not turn the windscreen into a narrow slit. Measure
    // actual opaque geometry at the driver's forward centre line, at 16:9.
    const roadCamera=camera.clone();roadCamera.aspect=16/9;
    roadCamera.fov=Math.max(66,cockpit.mirrorFov(roadCamera.aspect));roadCamera.updateProjectionMatrix();roadCamera.updateMatrixWorld(true);
    check(spec.id+' natural widescreen cockpit FOV',roadCamera.fov<=71);
    const roadRay=new THREE.Raycaster();roadRay.far=3;let opening=1;
    for(let i=0;i<=50;i++){roadRay.setFromCamera(new THREE.Vector2(0,1-i*.02),roadCamera);if(!roadRay.intersectObjects(visible,false).length){opening=i/100;break;}}
    check(spec.id+' header leaves upper forward road view open',opening<=.18);
    roadRay.setFromCamera(new THREE.Vector2(0,0),roadCamera);
    check(spec.id+' forward horizon unobstructed',roadRay.intersectObjects(visible,false).length===0);
    check(spec.id+' three optical faces',cockpit.mirrors.length===3);
    const mount=car.body.worldToLocal(cockpit.mirrorMount.getWorldPosition(new THREE.Vector3()));
    check(spec.id+' rearview mount seated on windscreen',nearestSurface(mount,[car.windscreen],car.body).distance<.005);
    for(const mirror of cockpit.mirrors){
      const p=mirror.mesh.getWorldPosition(new THREE.Vector3()),viewCamera=camera.clone();
      // Exterior mirrors must fit a natural head glance, not force both sides
      // into the forward road view. Keep the eye at the real driver's seat.
      if(mirror.name!=='interior'){viewCamera.lookAt(p);viewCamera.updateMatrixWorld(true);}
      const screen=p.clone().project(viewCamera);
      check(spec.id+' '+mirror.name+' in '+(mirror.name==='interior'?'forward':'glance')+' field of view',Math.abs(screen.x)<.94&&Math.abs(screen.y)<.9&&screen.z<1);
      mirror.mesh.geometry.computeBoundingBox();const edgeBox=mirror.mesh.geometry.boundingBox;
      for(const x of [edgeBox.min.x,edgeBox.max.x])for(const y of [edgeBox.min.y,edgeBox.max.y]){const edge=mirror.mesh.localToWorld(new THREE.Vector3(x,y,edgeBox.max.z)).project(viewCamera);check(spec.id+' '+mirror.name+' full glass within frame',Math.abs(edge.x)<1&&Math.abs(edge.y)<1);}
      let clear=0;
      for(const x of [-.3,0,.3])for(const y of [-.3,0,.3]){
        mirror.mesh.geometry.computeBoundingBox();const box=mirror.mesh.geometry.boundingBox,point=box.getCenter(new THREE.Vector3());point.x+=box.max.x*x+.00001;point.y+=box.max.y*y+.00001;mirror.mesh.localToWorld(point);
        const dir=point.clone().sub(camera.position),ray=new THREE.Raycaster(camera.position,dir.clone().normalize(),0,dir.length()+.02),hit=ray.intersectObjects(visible,false)[0];if(hit?.object===mirror.mesh)clear++;
      }
      check(spec.id+' '+mirror.name+' glass unobstructed from driver eye',clear>=8);
    }
    let renders=0,target=null;const renderer={shadowMap:{autoUpdate:true},getRenderTarget:()=>target,setRenderTarget:t=>target=t,render:()=>renders++};
    cockpit.renderMirrors(renderer,new THREE.Scene(),{enabled:false});check(spec.id+' low quality allocates no targets',renders===0&&cockpit.mirrors.every(m=>!m.target));
    cockpit.renderMirrors(renderer,new THREE.Scene(),{now:0});check(spec.id+' independent mirror targets',renders===3&&new Set(cockpit.mirrors.map(m=>m.target)).size===3);
    for(const m of cockpit.mirrors){check(spec.id+' '+m.name+' camera at glass',m.camera.position.distanceTo(m.mesh.getWorldPosition(new THREE.Vector3()))<.001);check(spec.id+' '+m.name+' horizontally reversed UVs',m.name==='interior'?m.mesh.geometry.attributes.uv.getX(0)>.99:m.mesh.geometry.attributes.uv.getX(1)<.01);}
    cockpit.renderMirrors(renderer,new THREE.Scene(),{now:16});check(spec.id+' alternate frame skipped',renders===3);
    cockpit.renderMirrors(renderer,new THREE.Scene(),{now:32});check(spec.id+' next even frame refreshed',renders===6);
    cockpit.renderMirrors(renderer,new THREE.Scene(),{enabled:false,now:64});check(spec.id+' low quality stops reflection rendering',renders===6&&cockpit.mirrors.every(m=>m.material.map===null));
    check(spec.id+' reflection restores renderer state',target===null&&renderer.shadowMap.autoUpdate&&car.root.visible);cockpit.disposeMirrors();
  }return {passed:results.length,results};
}
