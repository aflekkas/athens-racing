import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCars, carCategory, GARAGE_CLASSES, GARAGE_CARS, inGarage, CAR_MODELS, carModel, migrateCarSelection, bodyTrim, trimChoices, stepTrim, isRivalCar } from '../src/car-catalog.js';
import { bindingLabel, gearboxMessage } from '../src/input-labels.js';
import {engineProfile} from '../src/audio/engine-profiles.js';
import { CARS } from '../src/cars.js';
const cars=[{id:'panda',name:'Fiat Panda',power:44,mass:900,drive:'fwd'},{id:'z4',name:'BMW Z4',power:250,mass:1500,drive:'rwd'},{id:'huracan',name:'Lamborghini Huracán',power:470,mass:1500,drive:'awd'},{id:'cla',name:'Mercedes CLA',power:120,mass:1500,drive:'fwd'}];
test('catalogue composes search, class, drivetrain and HP filters without losing original indices',()=>{assert.deepEqual(filterCars(cars,{search:'bmw',category:'sports',drive:'RWD',power:'high'}).map(x=>x.index),[1]);assert.equal(filterCars(cars,{category:'classic'}).length,0);assert.equal(carCategory(cars[0]),'city');assert.deepEqual(filterCars(cars,{sort:'power'}).map(x=>x.car.id),['panda','cla','z4','huracan']);});
test('the garage lineup is grouped by class, names only real catalogue cars and leaves the rest to traffic and AI',()=>{
  const ids=new Set(CARS.map(c=>c.id));
  assert.deepEqual(GARAGE_CLASSES.map(([id])=>id),['city','hot hatch','sedan/coupe','suv','sports','super','classic','electric','commercial','public transport','motorcycle','service']);
  for(const id of GARAGE_CARS)assert(ids.has(id),id+' is in CARS');
  assert.equal(new Set(GARAGE_CARS).size,GARAGE_CARS.length);
  assert(inGarage(CARS[0]),'the default car (CARS[0]) is offered in the garage');
  assert(inGarage('police_octavia'));
  for(const id of ['cla','gla','gla45','superb','mini_jcw'])assert(inGarage(id));
  assert(inGarage('corolla'),'the Corolla stays: playtesters race it');
  const listed=filterCars(CARS).map(x=>x.car.id);assert.deepEqual(listed,GARAGE_CARS,'default order follows the grouped lineup');
  for(const {car,index} of filterCars(CARS))assert.equal(CARS[index],car);
});
test('labels and gearbox feedback use remapped keyboard/controller/touch bindings',()=>{const b={keyboard:{shiftUp:['KeyI'],shiftDown:['KeyK'],transmission:['KeyL']},gamepad:{shiftUp:['b0'],shiftDown:['b2'],transmission:['b3']}};assert.equal(bindingLabel(b,'transmission'),'L');assert.match(gearboxMessage(null,true,b,'keyboard'),/I ↑ \/ K ↓ TO SHIFT · L FOR AUTO/);assert.match(gearboxMessage(null,false,b,'gamepad'),/AUTOMATIC · Y FOR MANUAL/);assert.equal(bindingLabel(b,'shiftUp','touch'),'GEAR +');assert.equal(bindingLabel(b,'tow'),'UNBOUND');});

test('each generation has unique valid trim IDs and legacy selections migrate without losing their engine',()=>{
  const all=CAR_MODELS.flatMap(m=>m.trims);
  assert.equal(new Set(all).size,all.length);
  for(const m of CAR_MODELS)for(const id of m.trims){
    const c=CARS.find(c=>c.id===id);assert(c,id);
    assert.equal(migrateCarSelection(id).entry,m.id);assert.equal(migrateCarSelection(id).trim,id);
    assert.deepEqual(migrateCarSelection(migrateCarSelection(id)),migrateCarSelection(id));
    for(const k of ['mass','power','torque','wheelR','final'])assert(c[k]>0,`${id}.${k}`);
    assert(c.gears.length>=(c.electric?1:c.vehicleClass==='bus'?4:5) && c.gears.every((v,i)=>v>0&&(!i||v<c.gears[i-1])));
    assert(['fwd','rwd','awd'].includes(c.drive));
  }
  assert.deepEqual(migrateCarSelection('missing'),{entry:'mini',trim:'mini',body:'convertible'});
  assert.deepEqual(migrateCarSelection('gla45'),{entry:'gla',trim:'gla45'});
  assert.equal(carModel('mini').id,'mini');assert.equal(carModel('mini_jcw').id,'mini','hardtop and convertible share one generation-family entry');
  assert.equal(filterCars(CARS,{search:'CLE 53'})[0].car.id,'cle53');
  assert.equal(filterCars(CARS,{search:'GLA 45',drive:'AWD'})[0].car.id,'gla45');
  assert.equal(carCategory(CARS.find(c=>c.id==='gla45')),'suv');
});
test('CLE and E36 factory output anchors differ by engine and performance trim has visible parts',()=>{
  const specs={cle200:[150,320,1715,'rwd',9],cle:[190,400,1805,'awd',9],cle450:[280,500,1870,'awd',9],cle53:[330,560,1925,'awd',9],e36_m3:[236,350,1460,'rwd',6]};
  for(const [id,expected]of Object.entries(specs)){const c=CARS.find(c=>c.id===id);assert.deepEqual([c.power,c.torque,c.mass,c.drive,c.gears.length],expected);}
  const base=CARS.find(c=>c.id==='cle200').visual,amg=CARS.find(c=>c.id==='cle53').visual;
  assert.equal(base.exhaust,2);assert.equal(amg.exhaust,4);assert(amg.amg&&amg.lip&&amg.rim>base.rim&&amg.ride<base.ride);
});
test('garage renders the shared trim control, torque and a selectable model when only its performance trim is allowed',async()=>{
  const {renderCarSelect}=await import('../src/car-select.js');
  const index=CARS.findIndex(c=>c.id==='cle53');
  const detail=renderCarSelect({index,detail:true,allowedCars:['cle53']});
  assert.match(detail,/data-trim-current="cle53"/);assert.match(detail,/560 NM/);assert(!detail.includes('<select'));
  assert.match(detail,/AMG CLE 53/);assert(!detail.includes('data-act="carTrimPrev"') || detail.includes('disabled'));
  const grid=renderCarSelect({allowedCars:['gla45'],filters:{search:'GLA'}});
  assert.match(grid,new RegExp(`data-car-index="${CARS.findIndex(c=>c.id==='gla45')}"`));
  assert(!grid.includes('car-card off'));
});

test('generation labels match the existing represented Panda, Ibiza and Huracán',()=>{assert.match(carModel('panda').name,/169/);assert.match(carModel('ibiza').name,/6K/);assert.match(carModel('huracan').name,/EVO/);});

test('MINI body and engine choices preserve all legacy IDs and respect host restrictions',()=>{
  const m=carModel('mini');assert.equal(CAR_MODELS.length,31);assert.equal(m.bodies.length,2);
  assert.deepEqual(migrateCarSelection('mini'),{entry:'mini',trim:'mini',body:'convertible'});
  assert.deepEqual(migrateCarSelection({entry:'mini_jcw',trim:'mini_jcw'}),{entry:'mini',trim:'mini_jcw',body:'hardtop'});
  for(let i=0;i<3;i++){
    const hard=m.bodies[0][2][i],open=m.bodies[1][2][i];
    assert.equal(bodyTrim(m,hard,'convertible'),open);assert.equal(bodyTrim(m,open,'hardtop'),hard);
    const h=CARS.find(c=>c.id===hard),o=CARS.find(c=>c.id===open);
    assert.equal(h.power,o.power);assert.equal(h.torque,o.torque);assert(o.mass>h.mass);assert(o.convertible);assert(!h.convertible);
    assert.equal(o.body,'mini');assert.equal(h.body,'mini_jcw');
  }
  assert.equal(bodyTrim(m,'mini_jcw','convertible',['mini_cabrio_cooper']),'mini_cabrio_cooper');
  assert.equal(bodyTrim(m,'mini_jcw','convertible',['mini_jcw']),null);
});
test('new trim IDs reach server and deployment catalogues, with exactly one nitrous car',async()=>{
  const {readFileSync}=await import('node:fs');const {readCarCapabilities}=await import('../server/car-capabilities.mjs');
  const cap=readCarCapabilities(readFileSync(new URL('../src/cars.js',import.meta.url),'utf8'));
  assert.deepEqual(cap.cars,CARS.map(c=>c.id));assert.deepEqual(cap.nitrousCars,['ibiza']);
  for(const m of CAR_MODELS)for(const id of m.trims){const c=CARS.find(c=>c.id===id);if(!c.nativeFleet&&!c.police){assert(c.zeroTo100>0);assert(c.visual.rim>=13&&c.visual.rim<=21);}}
  assert(CAR_MODELS.filter(m=>m.trims.length>=2).length>=15);
});
test('body uses shared segments beside trim arrows, filtering forbidden body-engine combinations',async()=>{
 const {renderCarSelect}=await import('../src/car-select.js');
 const html=renderCarSelect({index:CARS.findIndex(c=>c.id==='mini'),detail:true,allowedCars:['mini','mini_jcw']});
 assert.match(html,/data-key="carBody"/);assert.match(html,/data-trim-current="mini"/);assert.match(html,/HARDTOP/);assert.match(html,/CONVERTIBLE/);assert.match(html,/role="radiogroup"/);assert(!html.includes('<select'));
 assert(!html.includes('data-key="carTrim"'));assert.match(html,/data-act="carTrimNext"/);
 const z4=renderCarSelect({index:CARS.findIndex(c=>c.id==='z4'),detail:true});assert(!z4.includes('data-key="carBody"'));
});

test('trim arrows wrap within the current body and obey event and multiplayer restrictions',()=>{
 assert.equal(stepTrim('cle200',1),'cle');assert.equal(stepTrim('cle',1),'cle300e');assert.equal(stepTrim('cle53',1),'cle200');assert.equal(stepTrim('cle200',-1),'cle53');
 assert.deepEqual(trimChoices('mini_jcw'),['mini_cooper','mini_s','mini_jcw']);assert.equal(stepTrim('mini_jcw',1),'mini_cooper');
 assert.equal(stepTrim('mini_cabrio_jcw',1),'mini_cabrio_cooper');
 assert.equal(stepTrim('cle200',1,{allowedCars:['cle200','cle53']}),'cle53');
 assert.equal(stepTrim('cle200',1,{def:{car:'cle200'}}),'cle200');assert.equal(stepTrim('cle',1,{allowedCars:[]}),null);
});
test('CLE offers a real PHEV without adding transient 48V ratings to continuous engine power',()=>{
 const p=CARS.find(c=>c.id==='cle300e');assert.deepEqual([p.power,p.torque,p.mass,p.drive,p.gears.length,p.zeroTo100],[230,550,2100,'rwd',9,6.3]);assert.equal(p.hybrid.type,'phev');assert.equal(p.hybrid.electricPowerKW,95);assert.equal(p.hybrid.icePowerKW,150);assert.equal(p.hybrid.simulation,'charged-blended-curve');
 for(const id of ['cle200','cle','cle450','cle53']){const c=CARS.find(c=>c.id===id);assert.equal(c.hybrid.type,'mhev');assert.equal(c.hybrid.electricPowerKW,17);assert.equal(c.hybrid.electricTorqueNm,205);}
});

test('Jazz GK factory manuals and fantasy RWD build stay distinct and host-filterable',()=>{
 const get=id=>CARS.find(c=>c.id===id),a=get('jazz'),b=get('jazz_dynamic'),d=get('jazz_drift');
 assert.deepEqual([a.power,a.torque,a.drive,a.gears.length],[75,123,'fwd',6]);
 assert.deepEqual([b.power,b.torque,b.drive,b.gears.length],[96,155,'fwd',6]);
 assert.equal(carCategory(d),'city');assert.equal(d.drive,'rwd');assert.equal(d.lsd,1);assert.equal(d.fantasy,true);
 assert.match(d.name,/FANTASY/);assert.match(d.tag,/Fantasy/);assert.equal(d.power,149);assert.match(engineProfile(d).id,/-sport$/);assert(engineProfile(d).pops>engineProfile(a).pops);
 assert(d.visual.wing&&d.visual.track>a.track&&d.visual.ride<a.visual.ride);assert.equal(d.visual.exhaust,1);
 assert.deepEqual(trimChoices('jazz',{allowedCars:['jazz','jazz_drift']}),['jazz','jazz_drift']);
 assert.equal(stepTrim('jazz',1,{allowedCars:['jazz','jazz_drift']}),'jazz_drift');
});

// Suspension moves the sprung body; trim lowering must never lower the tyre contact patches.
test('trim ride height survives live suspension poses while all four wheel centres stay grounded',async()=>{
 const previous=globalThis.document,noop=()=>{},gradient={addColorStop:noop};
 const ctx=new Proxy({measureText:()=>({width:50}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(o,k)=>k in o?o[k]:noop,set:(o,k,v)=>(o[k]=v,true)});
 // Geometry-only tests do not decode images; TextureLoader still needs an image event target.
 globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>ctx}),createElementNS:()=>({addEventListener(){},removeEventListener(){}})};
 let car;
 try{
  const {CarModel}=await import('../src/cars.js'),{Vector3}=await import('three');
  car=new CarModel(CARS.find(c=>c.id==='jazz_drift'));
  for(const pose of [{heave:0,pitch:0,roll:0},{heave:.04,pitch:.03,roll:-.04}]){
   car.update(1/60,0,0,false,pose);car.root.updateMatrixWorld(true);
   assert(Math.abs(car.body.position.y-pose.heave-car.spec.visual.ride)<1e-8);
   for(const wheel of car.wheels){
    assert(Math.abs(wheel.pivot.getWorldPosition(new Vector3()).y-wheel.restY)<1e-6,'trim lowering must preserve tyre contact height');
    wheel.spin.traverse(o=>{if(o.isMesh&&o.material.userData.brandBadge){const normal=new Vector3().fromBufferAttribute(o.geometry.attributes.normal,0).transformDirection(o.matrixWorld);assert(normal.x*wheel.side>.99,'centre cap faces outward so the logo is readable');}});
   }
  }
 }finally{car?.disposeDamage?.();globalThis.document=previous;}
});

test('every authored fleet body is reachable, while rivals only draw from race cars',async()=>{
 const {PASSENGER_MODELS}=await import('../src/traffic-passenger-models.js'),{COMMERCIAL_MODELS}=await import('../src/traffic-commercial-models.js'),{BIKE_SPECS}=await import('../src/traffic-bike-models.js');
 const represented=new Set(CARS.flatMap(c=>[c.fleet,c.nativeFleet].filter(Boolean)));
 for(const id of [...Object.keys(PASSENGER_MODELS),...Object.keys(COMMERCIAL_MODELS),...Object.keys(BIKE_SPECS)])assert(represented.has(id),id+' has a garage drivetrain');
 for(const c of CARS){assert(inGarage(c),c.id);if(c.nativeFleet||c.police||c.fantasy)assert(!isRivalCar(c));}
 assert(CARS.filter(isRivalCar).length>20);assert.equal(carCategory('bus'),'public transport');
 const {chaseRig}=await import('../src/vehicle-camera.js');assert(chaseRig(CARS.find(c=>c.id==='bus')).back>9);assert(chaseRig(CARS.find(c=>c.id==='bus')).up>3);
});

test('native fleet builds finite geometry, correct wheel counts and usable cockpit stations',async()=>{
 const old=globalThis.document,noop=()=>{},g={addColorStop:noop},ctx=new Proxy({measureText:()=>({width:50}),createLinearGradient:()=>g,createRadialGradient:()=>g},{get:(o,k)=>k in o?o[k]:noop,set:(o,k,v)=>(o[k]=v,true)});
 // Geometry-only tests do not decode images; TextureLoader still needs an image event target.
 globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>ctx}),createElementNS:()=>({addEventListener(){},removeEventListener(){}})};
 try{const {CarModel}=await import('../src/cars.js'),{Cockpit}=await import('../src/cockpit.js');
  for(const spec of CARS.filter(c=>c.nativeFleet)){
   const car=new CarModel(spec),cockpit=new Cockpit(spec,car);
   assert.equal(typeof cockpit.navCanvas.getContext('2d').fillRect,'function',spec.id+' HUD navigation canvas');assert(cockpit.navTex.isTexture);
   assert.equal(car.wheels.length,spec.twoWheeler?2:4,spec.id);assert.equal(car.dims.L,spec.length,spec.id);
   assert(cockpit.eye.y>.9&&Math.abs(cockpit.eye.z)<spec.length/2,spec.id+' camera inside authored body');
   car.root.traverse(o=>{for(const n of o.geometry?.attributes.position?.array||[])assert(Number.isFinite(n),spec.id);});
   car.update(1/60,10,.05,false,{heave:0,pitch:0,roll:0},null,.1);cockpit.update(1/60,{steerInput:.1,kmh:36,gearLabel:'1'});cockpit.disposeMirrors();car.disposeDamage?.();
  }
 }finally{globalThis.document=old;}
});

test('garage cameras fit utility bodies through a complete turntable and narrow screens',async()=>{
 const {showroomRig}=await import('../src/vehicle-camera.js');
 for(const spec of CARS.filter(c=>c.nativeFleet))for(const aspect of [.5,1,2]){
  const rig=showroomRig(spec,aspect),h=(spec.height||1.5)+(spec.twoWheeler?.6:0),radius=Math.hypot(spec.length,spec.width,h)/2;
  const half=Math.atan(Math.tan(35*Math.PI/360)*Math.min(1,aspect));
  assert(rig.distance*Math.sin(half)>radius,spec.id+' bounding sphere fits');
 }
 assert.equal(showroomRig(CARS.find(c=>c.id==='golf')).distance,8.3);
});
