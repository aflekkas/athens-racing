import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCars, carCategory, GARAGE_CLASSES, GARAGE_CARS, inGarage } from '../src/car-catalog.js';
import { bindingLabel, gearboxMessage } from '../src/input-labels.js';
import { CARS } from '../src/cars.js';
const cars=[{id:'panda',name:'Fiat Panda',power:44,mass:900,drive:'fwd'},{id:'z4',name:'BMW Z4',power:250,mass:1500,drive:'rwd'},{id:'huracan',name:'Lamborghini Huracán',power:470,mass:1500,drive:'awd'},{id:'cla',name:'Mercedes CLA',power:120,mass:1500,drive:'fwd'}];
test('catalogue composes search, class, drivetrain and HP filters without losing original indices',()=>{assert.deepEqual(filterCars(cars,{search:'bmw',category:'sports',drive:'RWD',power:'high'}).map(x=>x.index),[1]);assert.equal(filterCars(cars,{category:'classic'}).length,0);assert.equal(carCategory(cars[0]),'city');assert.deepEqual(filterCars(cars,{sort:'power'}).map(x=>x.car.id),['panda','z4','huracan']);});
test('the garage lineup is grouped by class, names only real catalogue cars and leaves the rest to traffic and AI',()=>{
  const ids=new Set(CARS.map(c=>c.id));
  assert.deepEqual(GARAGE_CLASSES.map(([id])=>id),['city','hot hatch','sports','super','classic']);
  for(const id of GARAGE_CARS)assert(ids.has(id),id+' is in CARS');
  assert.equal(new Set(GARAGE_CARS).size,GARAGE_CARS.length);
  assert(inGarage(CARS[0]),'the default car (CARS[0]) is offered in the garage');
  for(const id of ['cla','gla','superb','corolla','mini_jcw','police_octavia'])assert(!inGarage(id),id+' left the garage');
  const listed=filterCars(CARS).map(x=>x.car.id);assert.deepEqual(listed,GARAGE_CARS,'default order follows the grouped lineup');
  for(const {car,index} of filterCars(CARS))assert.equal(CARS[index],car);
});
test('labels and gearbox feedback use remapped keyboard/controller/touch bindings',()=>{const b={keyboard:{shiftUp:['KeyI'],shiftDown:['KeyK'],transmission:['KeyL']},gamepad:{shiftUp:['b0'],shiftDown:['b2'],transmission:['b3']}};assert.equal(bindingLabel(b,'transmission'),'L');assert.match(gearboxMessage(null,true,b,'keyboard'),/I ↑ \/ K ↓ TO SHIFT · L FOR AUTO/);assert.match(gearboxMessage(null,false,b,'gamepad'),/AUTOMATIC · Y FOR MANUAL/);assert.equal(bindingLabel(b,'shiftUp','touch'),'GEAR +');assert.equal(bindingLabel(b,'tow'),'UNBOUND');});
