import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {CARS,CarModel,TRAFFIC_TYPES,trafficModel,Cockpit,metrics,triangles} from './vehicle-budget-support.mjs';
import {vehicleBudget,OWNER_VEHICLE_DECISION as locked} from '../src/vehicle-budgets.js';
import {setVehicleCockpitView,GLASS_TINT} from '../src/glass-tint.js';
import {RNG} from '../src/util.js';
import {setCarLights} from '../src/vehicle-models.js';
function occupants(car,bike){const bad=[];car.root.traverse(o=>{if(/^(driver|passenger|hand|hands|arm|arms|attached-rider)(?:$|[-_])/.test(o.name)&&!(bike&&o.name==='attached-rider'))bad.push(o.name);});assert.deepEqual(bad,[],locked);}
function geometry(car){car.root.traverse(o=>{if(!o.geometry)return;for(const [name,a]of Object.entries(o.geometry.attributes))assert.ok(a.array.every(Number.isFinite),`${car.spec?.id} ${o.name} ${name}: ${locked}`);});}
function glass(car){const panes=[];car.root.traverse(o=>{if(!o.isMesh)return;for(const m of [].concat(o.material))if(m.userData?.vehicleGlass){assert.equal(m.opacity,1,locked);assert.equal(m.transparent,false,locked);assert.ok(Math.max(m.color.r,m.color.g,m.color.b)<.03,locked);panes.push(o);}});return panes;}
for(const spec of CARS)test(`${spec.id}: owner-locked geometry and empty-cabin policy`,()=>{
 const car=new CarModel(spec),budget=vehicleBudget(spec);geometry(car);occupants(car,!!spec.twoWheeler);
 car.root.traverse(o=>assert.doesNotMatch(o.name,/^(headliner|door-card|door-armrest|door-interior-handle|front-seat|rear-bench|headrest)(?:$|[-_])/,locked));
 const panes=glass(car);if(!spec.twoWheeler)assert.ok(panes.length,`${spec.id}: exterior windows missing. ${locked}`);
 const expected=JSON.parse(readFileSync(new URL('./fixtures/vehicle-anchors.json',import.meta.url),'utf8'))[spec.id];
 assert.deepEqual(JSON.parse(JSON.stringify({dims:car.dims,seat:car.seat.toArray(),dash:car.dash,wheels:car.wheels.map(w=>({position:w.pivot.position.toArray(),radius:w.r,front:w.front,side:w.side})),exhaust:car.exhaust?.map(t=>t.toArray())})),expected,`${spec.id}: gameplay mounts changed. ${locked}`);
 // Weather switches every playable model between daylight and night, including bikes without DRLs.
 for(const on of [true,false,true]){
  assert.doesNotThrow(()=>setCarLights(car,on),`${spec.id}: weather lamp transition. ${locked}`);
  assert.equal(car.lightsOn,on,locked);
  // Commercial models intentionally share their headlamp and running-light material.
  const sharedLamp=car.materials.head===car.materials.led;
  assert.equal(car.materials.head.emissiveIntensity,sharedLamp?(on?5:1.5):(on?7:0),`${spec.id}: headlamp output. ${locked}`);
  if(car.materials.led)assert.equal(car.materials.led.emissiveIntensity,on?5:1.5,locked);
 }
 const anchors=car.wheels.map(w=>({p:w.pivot.position.toArray(),r:w.r}));
 const m=metrics(car);
 for(const key of ['exterior','lod1','lod2'])assert.ok(m[key]<=budget[key],`${spec.id} ${key}: ${m[key]} > ${budget[key]}. ${locked}`);
 for(const n of m.wheels)assert.ok(n<=budget.wheel,`${spec.id} wheel: ${n}. ${locked}`);
 assert.ok(m.interior<=budget.cockpit,`${spec.id} cockpit: ${m.interior}. ${locked}`);
 assert.ok(m.rider<=budget.bikeRider,locked);
 for(let i=0;i<3;i++){
  setVehicleCockpitView(car,true);assert.ok(panes.every(o=>!o.visible),`${spec.id} cockpit glazing visible. ${locked}`);
  setVehicleCockpitView(car,false);assert.ok(panes.every(o=>o.userData.cockpitGlassVisible===undefined),locked);
 }
 assert.deepEqual(car.wheels.map(w=>({p:w.pivot.position.toArray(),r:w.r})),anchors,locked);
 // Gameplay wheel animation and damage must remain valid after the topology change.
 car.update(.016,12,.12,true,{heave:0,pitch:0,roll:0});
 assert.doesNotThrow(()=>{car.setDamage?.('front',.6);car.setDamage?.('front',0);});
 geometry(car);car.disposeDamage?.();
});
test('traffic and police factories obey the same occupant and glass rules',()=>{
 for(const type of TRAFFIC_TYPES)for(const low of [false,true]){const car=trafficModel(type,'#718293',new RNG(7),{low});occupants(car,!!type.scooter||!!type.moto);glass(car);geometry(car);const n=triangles(car.root),limit=low?299:(type.bus||type.truck?5000:4000);assert.ok(n<=limit,`${type.id} traffic ${low?'far':'near'}: ${n} > ${limit}. ${locked}`);car.disposeDamage?.();}
});
test('no retired driver rig or hand animation can return through the application',()=>{
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.doesNotMatch(main,/new Driver|bindDriverToCar|player\.driver|c\.driver/,locked);
 for(const f of ['driver.js','driver-seating.js','character-driver.js'])assert.equal(existsSync(new URL('../src/'+f,import.meta.url)),false,locked);
 assert.ok(Object.values(GLASS_TINT).every(t=>t.opacity===1),locked);
 const hero=readFileSync(new URL('../src/title-hero-studio.js',import.meta.url),'utf8');
 assert.match(hero,/original\.userData\.vehicleGlass\) tintGlass\(m\)/,locked);
 assert.doesNotMatch(hero,/m\.opacity\s*=\s*\.38/,locked);
 const picker=readFileSync(new URL('../src/car-select.js',import.meta.url),'utf8');
 assert.match(picker,/!copy\.userData\.vehicleGlass/,locked);
});
