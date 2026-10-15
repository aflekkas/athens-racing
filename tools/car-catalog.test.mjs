import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCars, carCategory, GARAGE_CLASSES, GARAGE_CARS, inGarage, CAR_MODELS, carModel, migrateCarSelection } from '../src/car-catalog.js';
import { bindingLabel, gearboxMessage } from '../src/input-labels.js';
import { CARS } from '../src/cars.js';
const cars=[{id:'panda',name:'Fiat Panda',power:44,mass:900,drive:'fwd'},{id:'z4',name:'BMW Z4',power:250,mass:1500,drive:'rwd'},{id:'huracan',name:'Lamborghini Huracán',power:470,mass:1500,drive:'awd'},{id:'cla',name:'Mercedes CLA',power:120,mass:1500,drive:'fwd'}];
test('catalogue composes search, class, drivetrain and HP filters without losing original indices',()=>{assert.deepEqual(filterCars(cars,{search:'bmw',category:'sports',drive:'RWD',power:'high'}).map(x=>x.index),[1]);assert.equal(filterCars(cars,{category:'classic'}).length,0);assert.equal(carCategory(cars[0]),'city');assert.deepEqual(filterCars(cars,{sort:'power'}).map(x=>x.car.id),['panda','cla','z4','huracan']);});
test('the garage lineup is grouped by class, names only real catalogue cars and leaves the rest to traffic and AI',()=>{
  const ids=new Set(CARS.map(c=>c.id));
  assert.deepEqual(GARAGE_CLASSES.map(([id])=>id),['city','hot hatch','sedan/coupe','suv','sports','super','classic']);
  for(const id of GARAGE_CARS)assert(ids.has(id),id+' is in CARS');
  assert.equal(new Set(GARAGE_CARS).size,GARAGE_CARS.length);
  assert(inGarage(CARS[0]),'the default car (CARS[0]) is offered in the garage');
  assert(!inGarage('police_octavia'));
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
    assert.deepEqual(migrateCarSelection(id),{entry:m.id,trim:id});
    assert.deepEqual(migrateCarSelection(migrateCarSelection(id)),{entry:m.id,trim:id});
    for(const k of ['mass','power','torque','wheelR','final'])assert(c[k]>0,`${id}.${k}`);
    assert(c.gears.length>=5 && c.gears.every((v,i)=>v>0&&(!i||v<c.gears[i-1])));
    assert(['fwd','rwd','awd'].includes(c.drive));
  }
  assert.deepEqual(migrateCarSelection('missing'),{entry:'mini',trim:'mini'});
  assert.deepEqual(migrateCarSelection('gla45'),{entry:'gla',trim:'gla45'});
  assert.equal(carModel('mini').id,'mini');assert.equal(carModel('mini_jcw').id,'mini_jcw','hardtop and convertible are distinct bodies');
  assert.equal(filterCars(CARS,{search:'CLE 53'})[0].car.id,'cle53');
  assert.equal(filterCars(CARS,{search:'GLA',drive:'AWD'})[0].car.id,'gla45');
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
  assert.match(detail,/data-key="carTrim"/);assert.match(detail,/560 NM/);assert(!detail.includes('<select'));
  assert.match(detail,/AMG CLE 53/);assert(!detail.includes('&quot;cle200&quot;'));
  const grid=renderCarSelect({allowedCars:['gla45'],filters:{search:'GLA'}});
  assert.match(grid,new RegExp(`data-car-index="${CARS.findIndex(c=>c.id==='gla45')}"`));
  assert(!grid.includes('car-card off'));
});

test('generation labels match the existing represented Panda, Ibiza and Huracán',()=>{assert.match(carModel('panda').name,/169/);assert.match(carModel('ibiza').name,/6K/);assert.match(carModel('huracan').name,/EVO/);});
