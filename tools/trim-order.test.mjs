import test from 'node:test';import assert from 'node:assert/strict';
import {CARS} from '../src/cars.js';import {CAR_MODELS,sortTrims,baseTrim,filterCars,carModel,trimChoices,stepTrim,migrateCarSelection} from '../src/car-catalog.js';import {carPerformanceIndex} from '../src/car-performance.js';import {renderCarSelect} from '../src/car-select.js';import {ruleViews,renderCars} from '../src/ui/mp-screens.js';import {Multiplayer} from '../src/multiplayer.js';
const get=id=>CARS.find(c=>c.id===id),ids=xs=>xs.map(c=>c.id);
test('every generation and body has base-to-top canonical trims; fantasy builds are last',()=>{
 for(const model of CAR_MODELS)for(const list of [model.trims,...(model.bodies||[]).map(b=>b[2])]){
  const specs=list.map(get);assert(specs.every(Boolean),model.id);assert.deepEqual(ids(sortTrims(specs)),list,model.id+' trim metadata is out of order');
  for(let i=1;i<specs.length;i++){const a=specs[i-1],b=specs[i];assert(!a.fantasy||b.fantasy,model.id+' fantasy must be last');if(!!a.fantasy===!!b.fantasy)assert(a.power<b.power||a.power===b.power&&carPerformanceIndex(a)<=carPerformanceIndex(b),model.id+' performance decreases');}
 }
 assert.deepEqual(carModel('golf').trims,['golf','golf_gtd','golf_gti','golf_r']);assert.deepEqual(carModel('cle').trims,['cle200','cle','cle300e','cle450','cle53']);assert.deepEqual(carModel('sl65').trims,['sl400','sl500','sl63','sl65']);assert.deepEqual(carModel('jazz').trims,['jazz','jazz_dynamic','jazz_drift']);
});
test('one helper prioritizes power, then PI, then factory hierarchy, with fantasy always last and no mutation',()=>{
 const stats={power:100,mass:1500,torque:250,zeroTo100:8,vmax:200,grip:1,brake:1,drive:'fwd'},ties=['cle53','cle450','cle300e','cle','cle200'].map(id=>({...stats,id}));const snapshot=JSON.stringify(ties);assert.deepEqual(ids(sortTrims(ties)),['cle200','cle','cle300e','cle450','cle53']);assert.equal(JSON.stringify(ties),snapshot);
 assert.deepEqual(ids(sortTrims(['golf_r','golf_gti','golf_gtd','golf'].map(id=>({...stats,id})))),['golf','golf_gtd','golf_gti','golf_r']);
 assert.deepEqual(ids(sortTrims([{...get('jazz_drift'),power:1},{...get('jazz'),power:1000}])),['jazz','jazz_drift']);
 assert.deepEqual(ids(sortTrims([get('f348'),get('f348_ts')])),['f348_ts','f348'],'equal kW uses PI');
});
test('fresh generation cards open their base trim, while saved and filtered choices survive',()=>{
 const list=filterCars(CARS);for(const {car}of list)assert.equal(car.id,baseTrim(carModel(car)),car.id);
 assert.equal(list.find(x=>carModel(x.car).id==='z4').car.id,'z4_20i');assert.equal(list.find(x=>carModel(x.car).id==='mini').car.id,'mini_cooper');assert.equal(baseTrim(carModel('f348')),'f348');
 const selection=migrateCarSelection('z4');assert.equal(filterCars(CARS,{},selection).find(x=>carModel(x.car).id==='z4').car.id,'z4');
 const old=globalThis.localStorage;try{globalThis.localStorage={getItem:()=>null};const fresh=renderCarSelect({filters:{search:'BMW Z4'}});assert.match(fresh,new RegExp(`data-car-index="${CARS.indexOf(get('z4_20i'))}"`));globalThis.localStorage={getItem:key=>key==='paraliaki.car'?'z4':null};const saved=renderCarSelect({filters:{search:'BMW Z4'}});assert.match(saved,new RegExp(`data-car-index="${CARS.indexOf(get('z4'))}"`));assert.match(renderCarSelect({index:CARS.indexOf(get('z4_30i')),detail:true}),/data-trim-current="z4_30i"/);}finally{globalThis.localStorage=old;}
 assert.deepEqual(trimChoices('z4',{cars:CARS}),['z4_20i','z4_30i','z4']);assert.equal(stepTrim('z4_20i',1,{cars:CARS}),'z4_30i');assert.equal(stepTrim('z4',1,{cars:CARS}),'z4_20i');assert.deepEqual(trimChoices('z4',{cars:CARS,allowedCars:['z4','z4_30i']}),['z4_30i','z4']);
 const detail=renderCarSelect({index:CARS.indexOf(get('z4_30i')),detail:true});assert.match(detail,/aria-label="Trim 2 of 3"/);
});
test('multiplayer allowed lists and class/spec rule controls use the same generation order',()=>{
 const cars=[...CARS].reverse(),mp={cars,lobby:{allowedCars:cars.map(c=>c.id)},carRules:{preset:'spec',spec:'golf'},get allowedCars(){return Object.getOwnPropertyDescriptor(Multiplayer.prototype,'allowedCars').get.call(this);}};
 const expected=ids(sortTrims(cars));assert.deepEqual(mp.allowedCars,expected);assert.deepEqual(ruleViews(mp).map(v=>v.id),expected);
 const html=renderCars({},mp),options=JSON.parse(html.match(/data-options="([^"]+)"/)[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));assert.deepEqual(options.map(([id])=>id),expected);
 const advanced=renderCars({},{...mp,carRules:{preset:'open'}}),shown=[...advanced.matchAll(/data-key="([^"]+)"[^>]*data-scope="mpAllow"/g)].map(m=>m[1]);assert.deepEqual(shown,expected);
});
