import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dopplerFactor, spatialEngine, NearestEngines} from '../src/audio/engine-spatial.js';
import {engineProfile, gearboxSound} from '../src/audio/engine-profiles.js';
import {EngineLifecycle} from '../src/audio/engine-lifecycle.js';
import {recordingFor, rpmBlend} from '../src/engine-recordings.js';
import {CARS} from './vehicle-budget-support.mjs';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
test('Doppler: stationary, approaching, receding, shared velocity, corrupt telemetry', () => {
  assert.equal(dopplerFactor(0), 1);
  assert.ok(dopplerFactor(40) > 1); assert.ok(dopplerFactor(-40) < 1);
  assert.equal(dopplerFactor(NaN), 1);
  assert.ok(dopplerFactor(10000) <= 1.4); assert.ok(dopplerFactor(-10000) >= .72);
  const state = {}; assert.equal(spatialEngine(state,{d:10,vr:40,pan:1},0), state);
  const first = state.doppler; spatialEngine(state,{d:200,vr:-40,pan:-1},.016);
  assert.ok(Math.abs(state.doppler-first) <= 1.8*.016 + 1e-8);
  assert.ok(state.cutoff < 2500); assert.ok(state.gain < .03);
});
test('fixed nearest selector: hard cap, shared IDs, deterministic order, invalid and absent inputs', () => {
  const rivals = Array.from({length:100},(_,id)=>({id,d:id*2}));
  const traffic = Array.from({length:100},(_,id)=>({id,d:id*2+1}));
  const pool = new NearestEngines(); const sources = pool.sources;
  pool.select(rivals,traffic); assert.equal(pool.count,8); assert.equal(pool.detail,6);
  assert.deepEqual([...pool.distances], [0,1,2,3,4,5,6,7]);
  pool.select([...rivals].reverse(),[...traffic].reverse()); assert.equal(pool.sources,sources);
  assert.deepEqual([...pool.distances], [0,1,2,3,4,5,6,7]);
  pool.select([{id:'bad',d:NaN},{id:'negative',d:-2},{id:'far',d:260}],null); assert.equal(pool.count,0);
  pool.select(); assert.equal(pool.count,0);
});
test('profile selection honors layouts and matching licensed substitutes', () => {
  for (const [engine,cyl] of [['turbo4',4],['diesel',4],['turbo6',6],['na6',6],['flat6',6],['v10',10],['v6biturbo',6],['v8biturbo',8],['na3',3]]) {
    const spec={id:'test',engine}; assert.equal(engineProfile(spec).cylinders,cyl); assert.equal(engineProfile(spec),engineProfile(spec));
  }
  assert.equal(engineProfile({id:'panda',engine:'na4'}).id,'fiat-i4');assert.equal(engineProfile({id:'yaris',engine:'na4'}).id,'city-i4');
  assert.equal(engineProfile({id:'e36_m3',engine:'na6'}).id,'na-i6');
  assert.equal(recordingFor({id:'golf_gti',engine:'turbo4'}).engine,'turbo4');
  assert.equal(recordingFor({id:'golf_gtd',engine:'diesel'}).engine,'diesel');
  assert.equal(recordingFor({id:'carrera',engine:'flat6'}).engine,'flat6');
  assert.equal(engineProfile({kind:'bus'}).cylinders,6);
  assert.equal(engineProfile({kind:'van'}).pops,0);
  assert.equal(gearboxSound({gearbox:'AT'}),'auto'); assert.equal(gearboxSound({gearbox:'PDK'}),'dct');
});
test('recorded RPM blend reuses output with equal power and bounded end points',()=>{
  const out=new Float32Array(4), p=[800,1800,4000,6000];
  for(const rpm of [100,800,1200,4000,9000]) {
    assert.equal(rpmBlend(p,rpm,out),out); assert.ok(Math.abs(out.reduce((s,x)=>s+x*x,0)-1)<1e-6);
  }
});
test('manual cabin lever and clutch are quiet outside; grind requires explicit state; shift edges debounce',()=>{
  const calls=[], host={engineSpec:{gearbox:'MT',shiftT:.2},eng:{},noise(p){calls.push(p);},tone(p){calls.push(p);}};
  const life=new EngineLifecycle(host), p={rpm:3000,shift:1,open:false};
  life.update(p,0); const interior=calls.reduce((s,c)=>s+c.gain,0); assert.equal(calls.length,3);
  life.update(p,.016); assert.equal(calls.length,3);
  life.update({...p,shift:0},.032); calls.length=0;
  life.update({...p,open:true},.05); assert.ok(calls.reduce((s,c)=>s+c.gain,0)<interior*.1);
  calls.length=0; life.update({...p,shift:0},.1); life.update({...p,shiftGrind:true},.2); assert.equal(calls.length,4);
  calls.length=0; life.update({...p,shift:0},.3); life.update({...p,gearboxType:'DCT'},.4);
  assert.equal(calls.length,2, 'actuator texture and low engagement body');
  assert.equal(calls[0].type,'bandpass', 'no bright highpass spit');
  assert.ok(calls[1].f<200, 'body stays beneath the engine');
});
test('starter flare settles, explicit stall shuts off, restart recovers',()=>{
  const host={noise(){},tone(){},engineSpec:{},eng:{}}; const life=new EngineLifecycle(host);
  life.start(0); life.update({rpm:800},.1,800); assert.equal(life.level,0);
  life.update({rpm:800},.6,800); assert.ok(life.rpm>800);
  life.update({rpm:800},3,800); assert.equal(life.state,'running');
  life.update({rpm:0,stalled:true},4,800); life.update({rpm:0,stalled:true},5,800); assert.equal(life.level,0);
  life.update({rpm:800,engineRunning:true},6,800); assert.equal(life.state,'starting');
});
test('physical powertrain type wins over legacy badge; durable event serials fire once',()=>{
 const calls=[],host={engineSpec:{id:'mini',gearbox:'DCT',powertrain:{gearboxType:'manual',shiftTime:.34}},eng:{},noise(p){calls.push(p);},tone(p){calls.push(p);}};
 assert.equal(gearboxSound(host.engineSpec),'manual');
 const life=new EngineLifecycle(host), p={rpm:2500,manual:true,cockpit:true,shiftStart:{serial:4,direction:-1,duration:.34}};
 life.update(p,1);assert.equal(calls.length,3);
 assert.ok(calls[0].f<1200,'downshift gate uses its lower resonance even if the frame shift pulse was missed');
 life.update({...p,shiftStart:{...p.shiftStart}},1.1);assert.equal(calls.length,3,'same serial cloned into new telemetry is not replayed');
 life.update({...p,shiftEnd:{serial:5}},1.34);assert.equal(calls.length,4,'clutch release follows shift-end');
});
test('existing world loop licences are retained through bus/bike banks and guard metadata',async()=>{
 const {ExternalEngines}=await import('../src/audio/engine-spatial.js');
 const {ENGINE_PROFILES}=await import('../src/audio/engine-profiles.js');
 const pool={world:{},recorded:new Map()};
 const sound={buffer:{duration:20},loopStart:.025,loopEnd:19.9};
 for(const name of ['bus-idle','diesel-engine','scooter-idle','scooter-run']) ExternalEngines.prototype.attachWorld.call(pool,name,sound);
 assert.equal(pool.recorded.size,2);
 for(const profile of [ENGINE_PROFILES.bus,ENGINE_PROFILES.bike]) {
  const bank=pool.recorded.get(profile);assert.equal(bank.loops.length,2);
  assert.equal(bank.loops[0].loopStart,.025);assert.equal(bank.loops[1].loopEnd,19.9);
 }
});

test('engine families have their own voice: the 911 is a flat-six and no recording is shared by most of the garage',()=>{
  const groups=new Map();
  for(const c of CARS){const p=engineProfile(c),key=p.sample||'synth:'+p.synth;groups.set(key,(groups.get(key)||0)+1);}
  // Before 2026-10-18 thirty-five cars shared the MINI recording ("why do all the cars sound like papaya?").
  for(const [key,n] of groups)assert.ok(n<=20,key+' is shared by '+n+' cars');
  assert.ok(groups.get('mini')<=8,'the MINI recording belongs to the MINI and the B48 Z4s');
  assert.ok(groups.size>=14,'distinct engine voices: '+groups.size);
  const car=id=>CARS.find(c=>c.id===id);
  for(const id of ['carrera','carrera_s','carrera_gts']){const r=recordingFor(car(id));assert.equal(r.engine,'flat6',id);assert.equal(r.cylinders,6,id);}
  for(const id of ['aventador_svj','sl65'])assert.equal(recordingFor(car(id)).cylinders,12,id);
  assert.notEqual(recordingFor(car('golf')),recordingFor(car('panda')));assert.notEqual(engineProfile(car('golf_gti')).id,engineProfile(car('golf')).id,'sport and mainstream turbo fours are calibrated differently');
  assert.ok(engineProfile(car('golf')).tone<engineProfile(car('golf_gti')).tone,'mainstream calibration is darker than the sport one');
  assert.equal(engineProfile(car('bus')).synth,'bus');assert.equal(engineProfile(car('truck')).synth,'bus');
  // Every recording is licensed and listed: each loop file exists, rises in rpm and matches sources.json.
  const manifest=JSON.parse(readFileSync(new URL('../assets/audio/engines/sources.json',import.meta.url),'utf8'));
  for(const spec of CARS){const r=recordingFor(spec);if(!r)continue;
    const rpms=r.loops.map(l=>l.rpm);assert.deepEqual(rpms,[...rpms].sort((x,y)=>x-y),spec.id+' loops ascend');
    for(const l of r.loops){const file=fileURLToPath(l.url.split('?')[0]);assert.ok(existsSync(file),file);const entry=manifest.assets.find(a=>file.endsWith('/'+a.file));assert.ok(entry,file+' missing from sources.json');assert.equal(entry.rpm,l.rpm,file);assert.ok(manifest.sources[entry.source]?.licenseUrl,file+' needs a licence');}
  }
});
