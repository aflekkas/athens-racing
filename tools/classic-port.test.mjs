import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {CARS,CarModel,Cockpit} from './vehicle-budget-support.mjs';import {carModel,bodyTrim,carCategory} from '../src/car-catalog.js';import {classifyCar} from '../src/car-performance.js';import {engineProfile} from '../src/audio/engine-profiles.js';import {ENGINE_SOUND} from '../src/audio/engine-synth.js';import {validatePowertrain} from './physics-test/powertrain.mjs';import {shiftGateOffset,cockpitShiftHardware} from '../src/cockpit-controls.js';import {setCarLights} from '../src/vehicle-models.js';
const get=id=>CARS.find(c=>c.id===id),ids=['sl400','sl500','sl63','sl65','a160','a190','f348','f348_ts','f348_spider','p928_s4','p928_gt','p928'];
test('classic port exposes four generations, real trims and matching 348 body choices',()=>{
 for(const [id,trims]of [['sl65',ids.slice(0,4)],['a160',ids.slice(4,6)],['f348',ids.slice(6,9)],['p928',ids.slice(9)]])assert.deepEqual(carModel(id).trims,trims);
 assert.equal(bodyTrim(carModel('f348'),'f348','targa'),'f348_ts');assert.equal(bodyTrim(carModel('f348'),'f348_ts','spider'),'f348_spider');assert.equal(bodyTrim(carModel('f348'),'f348','spider',['f348']),null);
 for(const id of ids){const c=get(id);assert.deepEqual(validatePowertrain(c),[]);assert.equal(cockpitShiftHardware(c).stick,c.powertrain.gearboxType==='manual');}
 assert.equal(carCategory(get('a190')),'city');assert.equal(carCategory(get('p928_gt')),'classic');assert.equal(carCategory(get('sl65')),'sports');
});
test('flat-plane and cross-plane V8s stay eight-cylinder NA; the three SL layouts retain boost',()=>{
 for(const [id,cyl,turbo,synth]of [['f348',8,false,'v8flat'],['p928',8,false,'v8na'],['sl400',6,true,'v6'],['sl500',8,true,'v8'],['sl65',12,true,'v12']]){const p=engineProfile(get(id));assert.equal(p.cylinders,cyl);assert.equal(p.turbo,turbo);assert.equal(p.synth,synth);assert.equal(ENGINE_SOUND[p.synth].cyl,cyl);assert.equal(get(id).powertrain.spoolTime>0,turbo);}
 for(const group of [['a160','a190'],['sl400','sl500','sl63','sl65'],['p928_s4','p928_gt','p928']]){const pi=group.map(id=>classifyCar(get(id)).pi);assert(pi.every((v,i)=>!i||v>pi[i-1]),group.join('/'));}
 assert.equal(get('sl63').powertrain.torqueConverter,false,'MCT wet starting clutch');assert.equal(get('sl65').powertrain.torqueConverter,true);
 assert.deepEqual(get('a190').gears,[3.27,1.92,1.34,1.03,.83]);assert.equal(get('p928_s4').final,2.2);
});
test('348 targa and Spider have actual open roofs; berlinetta retains its roof',()=>{
 for(const id of ['f348','f348_ts','f348_spider']){const m=new CarModel(get(id));m.root.updateMatrixWorld(true);const hits=new T.Raycaster(new T.Vector3(0,3,0),new T.Vector3(0,-1,0),0,4).intersectObject(m.root,true);const height=hits[0]?.point.y;assert(Number.isFinite(height));assert.equal(height>1,id==='f348',`${id}: roof ray height ${height}`);new Cockpit(m.spec,m).disposeMirrors();}
});
test('928 pop-up lamps retain articulated groups through compaction, animation and repair',()=>{
 const m=new CarModel(get('p928')),lamps=[];m.body.traverse(o=>{if(o.name==='popup-headlamp')lamps.push(o);});assert.equal(lamps.length,2);
 setCarLights(m,true);for(let i=0;i<90;i++)m.update(1/60,0,0,false,{heave:0,pitch:0,roll:0});assert(lamps.every(l=>l.rotation.x<-.5));
 m.setDamage('front',.6);m.setDamage('front',0);setCarLights(m,false);for(let i=0;i<90;i++)m.update(1/60,0,0,false,{heave:0,pitch:0,roll:0});assert(lamps.every(l=>Math.abs(l.rotation.x)<1e-8));
});
test('348 dogleg gate puts first down-left and second up-centre while ordinary gates stay unchanged',()=>{
 assert.deepEqual(shiftGateOffset(1,5,null,true),{x:-.022,z:.026});assert.deepEqual(shiftGateOffset(2,5,null,true),{x:0,z:-.026});assert.deepEqual(shiftGateOffset('R',5,null,true),{x:-.022,z:-.026});assert.deepEqual(shiftGateOffset(1,5),{x:-.022,z:-.026});
});

test('adding explicit V8 layouts preserves existing city-car audio routing',()=>{
 const city=CARS.filter(c=>c.engine==='na4'&&/^(panda|yaris|ibiza|corolla)/.test(c.id));assert(city.length>0);for(const c of city)assert.equal(engineProfile(c).id,'city-i4',c.id);
});
