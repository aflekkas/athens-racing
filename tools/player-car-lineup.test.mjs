import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {CARS,TRAFFIC_TYPES,trafficModel} from './vehicle-budget-support.mjs';
import {CAR_MODELS,CAR_CLASSES,inGarage,carModel,trimChoices,migrateCarSelection,migrateStoredCarSelection} from '../src/car-catalog.js';
import {readCarCapabilities} from '../server/car-capabilities.mjs';import {createGameCore} from '../server/core.mjs';import {sanitizeCarRules} from '../src/mp-car-rules.js';import {MULTIPLAYER_PROTOCOL} from '../src/multiplayer-protocol.js';import {RNG} from '../src/util.js';
const retired=['delivery','scooter','moto','police_moto'],fallback=migrateCarSelection('mini');
const capabilities=readCarCapabilities(readFileSync(new URL('../src/cars.js',import.meta.url),'utf8'));
const maps=new Map([['riviera',{track:{version:'v'},geometry:{step:20,x:[0,20],z:[0,0],y:[0,0],lanes:[1,1],div:[0,0]},definitions:new Map([['quick',{id:'quick',type:'sprint',s0:0,s1:200,dir:1,len:200}]])}]]);
const options={maps,cars:new Set(capabilities.cars),carSpecs:capabilities.specs,leaderboard:{submit:async()=>{}}};
const socket=()=>({readyState:1,messages:[],send(s){this.messages.push(JSON.parse(s));},close(){this.readyState=3;}});
test('retired bikes cannot enter the garage, trim list, server catalogue or car-class rules',()=>{
 assert.deepEqual(capabilities.cars,CARS.map(c=>c.id));assert(!CAR_CLASSES.includes('motorcycle'));
 const ctx={knownIds:capabilities.cars,categories:CAR_CLASSES};
 assert(sanitizeCarRules({preset:'category',category:'motorcycle'},ctx).error);
 for(const id of retired){assert(!CARS.some(c=>c.id===id));assert(!CAR_MODELS.some(m=>m.trims.includes(id)));assert.equal(inGarage(id),false);assert.equal(carModel(id),undefined);assert.deepEqual(trimChoices(id),[]);assert(!capabilities.cars.includes(id));assert(!Object.hasOwn(capabilities.specs,id));assert(sanitizeCarRules({preset:'spec',spec:id},ctx).error);assert(sanitizeCarRules({allowedCars:[id]},ctx).error);}
 assert(CARS.every(c=>!c.twoWheeler&&c.engine!=='bike'));
});
test('legacy and structured bike selections migrate persistently and idempotently to the MINI',()=>{
 for(const id of retired)for(const legacy of [true,false]){
  const data=new Map(legacy?[['paraliaki.car',id]]:[['paraliaki.car.selection',JSON.stringify({entry:id,trim:id})]]),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
  assert.deepEqual(migrateStoredCarSelection(storage),fallback);assert.equal(data.get('paraliaki.car'),'mini');assert.deepEqual(JSON.parse(data.get('paraliaki.car.selection')),fallback);assert.deepEqual(migrateStoredCarSelection(storage),fallback);
 }
 for(const id of ['sl65','f348_ts','mini_jcw','gla45']){const data=new Map([['paraliaki.car',id]]),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};assert.equal(migrateStoredCarSelection(storage).trim,id);assert.equal(data.get('paraliaki.car'),id);}
 assert.deepEqual(migrateStoredCarSelection({getItem:k=>k==='paraliaki.car'?'moto':null,setItem(){throw Error('read-only storage');}}),fallback);
 assert.equal(migrateStoredCarSelection({getItem:()=>null}),null);
});
test('shared native/Worker protocol rejects bike changes and excludes them from lobby manifests',()=>{
 const core=createGameCore(options),ws=socket();core.connect(ws,'test',{protocol:MULTIPLAYER_PROTOCOL});const send=m=>core.message(ws,JSON.stringify(m));send({type:'create',car:'mini'});const lobby=[...core.lobbies.values()][0];assert(lobby);
 for(const id of retired){send({type:'car',car:id});assert.match(ws.messages.at(-1).message,/Unknown car/);send({type:'ready',car:id,ready:true,version:'v'});assert.match(ws.messages.at(-1).message,/Unknown car/);assert.equal([...lobby.players.values()][0].car,'mini');}
 const pub=core.publicLobby(lobby);assert(retired.every(id=>!pub.allowedCars.includes(id)));assert(retired.every(id=>!pub.players.some(p=>p.car===id)));
});
test('Worker hibernation cannot restore a retired bike or bike-only host rules',()=>{
 for(const id of retired){const core=createGameCore(options),ws=socket();core.connect(ws,'test',{protocol:MULTIPLAYER_PROTOCOL});core.message(ws,JSON.stringify({type:'create',car:'mini'}));const saved=JSON.parse(JSON.stringify(core.exportState()));for(const s of saved.sessions){s.car=id;s.ready=true;s.loaded=true;s.state={s:1};}saved.lobbies[0].advancedCars=[id];saved.lobbies[0].carRules={preset:'spec',spec:id};
  const restored=createGameCore(options);restored.restore(saved);const l=[...restored.lobbies.values()][0],c=[...l.players.values()][0];assert.equal(c.car,'mini');assert.equal(c.ready,false);assert.equal(c.loaded,false);assert.equal(c.state,null);assert.equal(l.carRules.preset,'open');assert.equal(l.advancedCars,null);assert(retired.every(id=>!l.allowedCars.includes(id)));
 }
});
test('traffic bikes retain both wheel models and attached riders at near and far detail',()=>{
 for(const id of retired)for(const low of [false,true]){const type=TRAFFIC_TYPES.find(t=>t.id===id);assert(type,id);const model=trafficModel(type,'#718293',new RNG(7),{low});assert.equal(model.wheels.length,2,id);assert(model.body.getObjectByName('attached-rider'),`${id} ${low?'far':'near'} rider`);model.disposeDamage?.();}
});
