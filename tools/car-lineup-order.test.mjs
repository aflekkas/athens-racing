import test from 'node:test';import assert from 'node:assert/strict';
import {CARS} from '../src/cars.js';import {CAR_MODELS,GARAGE_CARS,inGarage,sortCars,filterCars,carModel} from '../src/car-catalog.js';import {renderCarSelect} from '../src/car-select.js';import {ruleViews,renderCars} from '../src/ui/mp-screens.js';import {Multiplayer} from '../src/multiplayer.js';
const get=id=>CARS.find(c=>c.id===id),ids=xs=>xs.map(c=>c.id);
// Owner decision 2026-10-20 (docs/OWNER-DECISIONS.md): one garage entry per model, its top trim; no trims, no body choice.
test('the garage lists one car per model, the kept top trim, in lineup order',()=>{
 const list=filterCars(CARS);
 assert.equal(list.length,CAR_MODELS.length);
 assert.deepEqual(list.map(x=>carModel(x.car).id),GARAGE_CARS);
 for(const {car,index} of list){assert.equal(car.id,carModel(car).car,car.id+' is the kept car of its model');assert.equal(CARS[index],car);}
 assert.equal(list.find(x=>carModel(x.car).id==='z4').car.id,'z4');assert.equal(list.find(x=>carModel(x.car).id==='mini').car.id,'mini_jcw');assert.equal(list.find(x=>carModel(x.car).id==='golf').car.id,'golf_r');
 assert.deepEqual(ids(sortCars([get('z4'),get('golf_r'),get('mini_jcw')])),['golf_r','mini_jcw','z4'].sort((a,b)=>GARAGE_CARS.indexOf(carModel(a).id)-GARAGE_CARS.indexOf(carModel(b).id)));
});
test('the garage cards and detail show no trim, body or generation text',()=>{
 const grid=renderCarSelect({filters:{search:'BMW Z4'}});assert.match(grid,new RegExp(`data-car-index="${CARS.indexOf(get('z4'))}"`));assert.equal((grid.match(/data-car-index=/g)||[]).length,1);
 for(const id of CAR_MODELS.map(m=>m.car)){
  const html=renderCarSelect({index:CARS.indexOf(get(id)),detail:true});
  for(const gone of ['carTrim','carBody','trim-picker','data-trim-current'])assert(!html.includes(gone),id+' '+gone);
  assert.doesNotMatch(html,/\bTRIMS?\b|\bBODY\b|HARDTOP|CONVERTIBLE/,id);
 }
 assert.doesNotMatch(renderCarSelect({}),/\bTRIMS?\b|\bBODIES\b/);
});
test('multiplayer allowed lists and class/spec rule controls use the lineup order and offer only the kept cars',()=>{
 const cars=[...CARS].reverse(),mp={cars,lobby:{allowedCars:cars.map(c=>c.id)},carRules:{preset:'spec',spec:'golf_r'},get allowedCars(){return Object.getOwnPropertyDescriptor(Multiplayer.prototype,'allowedCars').get.call(this);}};
 const expected=ids(sortCars(cars.filter(inGarage)));assert.equal(expected.length,CAR_MODELS.length);
 assert.deepEqual(mp.allowedCars,expected);assert.deepEqual(ruleViews(mp).map(v=>v.id),expected);
 const html=renderCars({},mp),options=JSON.parse(html.match(/data-options="([^"]+)"/)[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));assert.deepEqual(options.map(([id])=>id),expected);
 const advanced=renderCars({},{...mp,carRules:{preset:'open'}}),shown=[...advanced.matchAll(/data-key="([^"]+)"[^>]*data-scope="mpAllow"/g)].map(m=>m[1]);assert.deepEqual(shown,expected);
});
