import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCars, carCategory, GARAGE_CLASSES, GARAGE_CARS, inGarage, CAR_MODELS, carModel, migrateCarSelection, canonicalCarId, DEFAULT_CAR_ID, LEGACY_CAR_IDS, isRivalCar } from '../src/car-catalog.js';
import { bindingLabel, gearboxMessage } from '../src/input-labels.js';
import { CARS } from '../src/cars.js';
const cars=[{id:'panda_100hp',name:'Fiat Panda',power:44,mass:900,drive:'fwd'},{id:'z4',name:'BMW Z4',power:250,mass:1500,drive:'rwd'},{id:'huracan',name:'Lamborghini Huracán',power:470,mass:1500,drive:'awd'},{id:'cla45s',name:'Mercedes CLA',power:120,mass:1500,drive:'fwd'}];
test('catalogue composes search, class, drivetrain and HP filters without losing original indices',()=>{assert.deepEqual(filterCars(cars,{search:'bmw',category:'sports',drive:'RWD',power:'high'}).map(x=>x.index),[1]);assert.equal(filterCars(cars,{category:'classic'}).length,0);assert.equal(carCategory(cars[0]),'city');assert.deepEqual(filterCars(cars,{sort:'power'}).map(x=>x.car.id),['panda_100hp','cla45s','z4','huracan']);});
test('the garage lineup is grouped by class, names only real catalogue cars and leaves the rest to traffic and AI',()=>{
  const ids=new Set(CARS.map(c=>c.id));
  assert.deepEqual(GARAGE_CLASSES.map(([id])=>id),['city','hot hatch','sedan/coupe','suv','sports','super','classic','electric','commercial','public transport','service']);
  for(const id of GARAGE_CARS)assert(ids.has(id),id+' is in CARS');
  assert.equal(new Set(GARAGE_CARS).size,GARAGE_CARS.length);
  assert(inGarage(DEFAULT_CAR_ID),'the default car is offered in the garage');for(const old of Object.keys(LEGACY_CAR_IDS))assert(!inGarage(old),old+' is a removed trim, never offered');
  assert(inGarage('police_octavia'));
  for(const id of ['cla45s','gla45','superb_4x4','mini_jcw'])assert(inGarage(id));
  assert(inGarage('corolla'),'the Corolla stays: playtesters race it');
  const listed=filterCars(CARS).map(x=>x.car.id);assert.deepEqual(listed.map(id=>carModel(id).id),GARAGE_CARS,'default order follows the grouped lineup');
  for(const {car,index} of filterCars(CARS))assert.equal(CARS[index],car);
});
test('labels and gearbox feedback use remapped keyboard/controller bindings',()=>{const b={keyboard:{shiftUp:['KeyI'],shiftDown:['KeyK'],transmission:['KeyL']},gamepad:{shiftUp:['b0'],shiftDown:['b2'],transmission:['b3']}};assert.equal(bindingLabel(b,'transmission'),'L');assert.match(gearboxMessage(null,true,b,'keyboard'),/I SHIFT UP \/ K SHIFT DOWN · L FOR AUTO/);assert.match(gearboxMessage(null,false,b,'gamepad'),/AUTOMATIC · Y FOR MANUAL/);assert.equal(bindingLabel(b,'tow'),'UNBOUND');});

// Owner decision 2026-10-20 (docs/OWNER-DECISIONS.md): one car per model, its top trim. Removed trims map to it.
test('each model keeps one valid top-trim car and every removed trim id maps to it',()=>{
  const kept=CAR_MODELS.map(m=>m.car);
  assert.equal(new Set(kept).size,kept.length);
  for(const m of CAR_MODELS){
    const c=CARS.find(c=>c.id===m.car);assert(c,m.car);
    assert.equal(migrateCarSelection(m.car),m.car);assert.equal(migrateCarSelection(migrateCarSelection(m.car)),m.car);
    assert.equal(m.trims,undefined,m.id+' has no trims');assert.equal(m.bodies,undefined,m.id+' has no body choice');
    for(const k of ['mass','power','torque','wheelR','final'])assert(c[k]>0,`${m.car}.${k}`);
    assert(c.gears.length>=(c.electric?1:c.vehicleClass==='bus'?4:5) && c.gears.every((v,i)=>v>0&&(!i||v<c.gears[i-1])));
    assert(['fwd','rwd','awd'].includes(c.drive));
  }
  for(const [old,keptId] of Object.entries(LEGACY_CAR_IDS)){
    assert(kept.includes(keptId),old+' maps to a kept car');assert.equal(canonicalCarId(old),keptId);assert.equal(migrateCarSelection(old),keptId);
    assert.equal(carModel(old).car,keptId,old+' still finds its model');
  }
  for(const id of kept)assert.equal(canonicalCarId(id),id,id+' is its own car');
  assert.equal(migrateCarSelection('missing'),DEFAULT_CAR_ID);assert.equal(migrateCarSelection(null),DEFAULT_CAR_ID);assert.equal(migrateCarSelection('gla45'),'gla45');
  assert.equal(migrateCarSelection({entry:'gla',trim:'gla250'}),'gla45','the old packed {entry,trim} selection');assert.equal(migrateCarSelection({entry:'cle'}),'cle53');
  assert.equal(carModel('mini').id,'mini');assert.equal(carModel('mini_jcw').id,'mini');
  assert.equal(filterCars(CARS,{search:'CLE 53'})[0].car.id,'cle53');
  assert.equal(filterCars(CARS,{search:'GLA 45',drive:'AWD'})[0].car.id,'gla45');
  assert.equal(carCategory(CARS.find(c=>c.id==='gla45')),'suv');
});
test('CLE 53 and E36 M3 keep their factory output anchors',()=>{
  const specs={cle53:[330,560,1925,'awd',9],e36_m3:[236,350,1460,'rwd',6]};
  for(const [id,expected]of Object.entries(specs)){const c=CARS.find(c=>c.id===id);assert.deepEqual([c.power,c.torque,c.mass,c.drive,c.gears.length],expected);}
  const amg=CARS.find(c=>c.id==='cle53').visual;assert.equal(amg.exhaust,4);assert(amg.amg&&amg.rim>18);
});
test('garage renders torque and a selectable car when only that car is allowed, with no trim or body control',async()=>{
  const {renderCarSelect}=await import('../src/car-select.js');
  const index=CARS.findIndex(c=>c.id==='cle53');
  const detail=renderCarSelect({index,detail:true,allowedCars:['cle53']});
  assert.match(detail,/560 NM/);assert(!detail.includes('<select'));assert.match(detail,/AMG CLE 53/);
  for(const gone of ['carTrim','carBody','trim-picker','trim-chip','data-trim-current','carTrimNext','carTrimPrev'])assert(!detail.includes(gone),gone);
  assert.doesNotMatch(detail,/\bTRIMS?\b/);assert.doesNotMatch(detail,/\bBODY\b/);
  const grid=renderCarSelect({allowedCars:['gla45'],filters:{search:'GLA'}});
  assert.match(grid,new RegExp(`data-car-index="${CARS.findIndex(c=>c.id==='gla45')}"`));assert.doesNotMatch(grid,/\bTRIMS?\b/);assert.doesNotMatch(grid,/\bBODIES\b/);
  assert(!grid.includes('car-card off'));
});

test('generation labels match the existing represented Panda, Ibiza and Huracán',()=>{assert.match(carModel('panda').name,/169/);assert.match(carModel('ibiza').name,/6K/);assert.match(carModel('huracan').name,/EVO/);});
test('MINI is one entry, the JCW hardtop; the convertible, the lesser trims and the body choice are gone',async()=>{
  const m=carModel('mini');assert.equal(CAR_MODELS.length,31);assert.equal(m.car,'mini_jcw');
  const jcw=CARS.find(c=>c.id==='mini_jcw');assert(!jcw.convertible);assert.equal(jcw.body,'mini_jcw');
  assert.deepEqual(filterCars(CARS,{search:'MINI'}).map(x=>x.car.id),['mini_jcw']);
  for(const old of ['mini','mini_cooper','mini_s','mini_cabrio_cooper','mini_cabrio_jcw'])assert.equal(canonicalCarId(old),'mini_jcw');
  const {renderCarSelect}=await import('../src/car-select.js');
  const html=renderCarSelect({index:CARS.findIndex(c=>c.id==='mini_jcw'),detail:true});
  assert(!html.includes('carBody'));assert.doesNotMatch(html,/HARDTOP|CONVERTIBLE/);
});
test('the kept cars reach server and deployment catalogues, with exactly one nitrous car',async()=>{
  const {readFileSync}=await import('node:fs');const {readCarCapabilities}=await import('../server/car-capabilities.mjs');
  const cap=readCarCapabilities(readFileSync(new URL('../src/cars.js',import.meta.url),'utf8'));
  assert.deepEqual([...cap.cars].sort(),CAR_MODELS.map(m=>m.car).sort());assert.deepEqual(cap.nitrousCars,['ibiza_cupra']);
  for(const m of CAR_MODELS){const c=CARS.find(c=>c.id===m.car);if(!c.nativeFleet&&!c.police){assert(c.zeroTo100>0);assert(c.visual.rim>=13&&c.visual.rim<=21);}}
});

test('CLE offers a real PHEV without adding transient 48V ratings to continuous engine power',()=>{
 const p=CARS.find(c=>c.id==='cle300e');assert.deepEqual([p.power,p.torque,p.mass,p.drive,p.gears.length,p.zeroTo100],[230,550,2100,'rwd',9,6.3]);assert.equal(p.hybrid.type,'phev');assert.equal(p.hybrid.electricPowerKW,95);assert.equal(p.hybrid.icePowerKW,150);assert.equal(p.hybrid.simulation,'charged-blended-curve');
 for(const id of ['cle200','cle','cle450','cle53']){const c=CARS.find(c=>c.id===id);assert.equal(c.hybrid.type,'mhev');assert.equal(c.hybrid.electricPowerKW,17);assert.equal(c.hybrid.electricTorqueNm,205);}
});
test('Honda Jazz is the Dynamic road car; the drift spec is gone',()=>{
 const get=id=>CARS.find(c=>c.id===id),b=get('jazz_dynamic');
 assert.deepEqual([b.power,b.torque,b.drive,b.gears.length],[96,155,'fwd',6]);
 assert.equal(carModel('jazz').car,'jazz_dynamic');assert.equal(canonicalCarId('jazz_drift'),'jazz_dynamic');
 assert(!CARS.some(c=>c.id==='jazz_drift'||/DRIFT SPEC/i.test(c.name)||c.fantasy&&/^jazz/.test(c.id)),'no Jazz drift spec anywhere in the catalogue');
 assert.notEqual(b.drive,'rwd');assert(!b.fantasy);
});

// Suspension moves the sprung body; trim lowering must never lower the tyre contact patches.
test('lowered ride height survives live suspension poses while all four wheel centres stay grounded',async()=>{
 const previous=globalThis.document,noop=()=>{},gradient={addColorStop:noop};
 const ctx=new Proxy({measureText:()=>({width:50}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(o,k)=>k in o?o[k]:noop,set:(o,k,v)=>(o[k]=v,true)});
 // Geometry-only tests do not decode images; TextureLoader still needs an image event target.
 globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>ctx}),createElementNS:()=>({addEventListener(){},removeEventListener(){}})};
 let car;
 try{
  const {CarModel}=await import('../src/cars.js'),{Vector3}=await import('three');
  car=new CarModel(CARS.find(c=>c.id==='golf_r'));
  for(const pose of [{heave:0,pitch:0,roll:0},{heave:.04,pitch:.03,roll:-.04}]){
   car.update(1/60,0,0,false,pose);car.root.updateMatrixWorld(true);
   assert(Math.abs(car.body.position.y-pose.heave-car.spec.visual.ride)<1e-8);
   for(const wheel of car.wheels){
    assert(Math.abs(wheel.pivot.getWorldPosition(new Vector3()).y-wheel.restY)<1e-6,'ride lowering must preserve tyre contact height');
    wheel.spin.traverse(o=>{if(o.isMesh&&o.material.userData.brandBadge){const normal=new Vector3().fromBufferAttribute(o.geometry.attributes.normal,0).transformDirection(o.matrixWorld);assert(normal.x*wheel.side>.99,'centre cap faces outward so the logo is readable');}});
   }
  }
 }finally{car?.disposeDamage?.();globalThis.document=previous;}
});

test('passenger and commercial fleet bodies are reachable, while rivals only draw from race cars',async()=>{
 const {PASSENGER_MODELS}=await import('../src/traffic-passenger-models.js'),{COMMERCIAL_MODELS}=await import('../src/traffic-commercial-models.js');
 const represented=new Set(CARS.flatMap(c=>[c.fleet,c.nativeFleet].filter(Boolean)));
 for(const id of [...Object.keys(PASSENGER_MODELS),...Object.keys(COMMERCIAL_MODELS)])assert(represented.has(id),id+' has a garage drivetrain');
 for(const c of CARS){if(c.nativeFleet||c.police||c.fantasy)assert(!isRivalCar(c));}
 for(const m of CAR_MODELS)assert(inGarage(m.car),m.car);
 assert(CARS.filter(c=>isRivalCar(c)&&inGarage(c)).length>=18);assert.equal(carCategory('bus'),'public transport');
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
   assert.equal(car.wheels.length,4,spec.id);assert.equal(car.dims.L,spec.length,spec.id);
   assert(cockpit.eye.y>.9&&Math.abs(cockpit.eye.z)<spec.length/2,spec.id+' camera inside authored body');
   car.root.traverse(o=>{for(const n of o.geometry?.attributes.position?.array||[])assert(Number.isFinite(n),spec.id);});
   car.update(1/60,10,.05,false,{heave:0,pitch:0,roll:0},null,.1);cockpit.update(1/60,{steerInput:.1,kmh:36,gearLabel:'1'});cockpit.disposeMirrors();car.disposeDamage?.();
  }
 }finally{globalThis.document=old;}
});

test('garage cameras fit utility bodies through a complete turntable and narrow screens',async()=>{
 const {showroomRig}=await import('../src/vehicle-camera.js');
 for(const spec of CARS.filter(c=>c.nativeFleet))for(const aspect of [.5,1,2]){
  const rig=showroomRig(spec,aspect),h=(spec.height||1.5),radius=Math.hypot(spec.length,spec.width,h)/2;
  const half=Math.atan(Math.tan(35*Math.PI/360)*Math.min(1,aspect));
  assert(rig.distance*Math.sin(half)>radius,spec.id+' bounding sphere fits');
 }
 assert.equal(showroomRig(CARS.find(c=>c.id==='golf')).distance,8.3);
});
