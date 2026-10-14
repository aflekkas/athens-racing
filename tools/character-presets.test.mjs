import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTER_PRESETS,characterPresetLook} from '../src/character-presets.js';
import {normalizeDriverAppearance,DEFAULT_DRIVER_APPEARANCE} from '../src/driver-appearance-data.js';
import {normalizeAppearance} from '../src/customization-data.js';
import {createPresetRepository} from '../src/customization-repository.js';
import {createGameCore} from '../server/core.mjs';
import {StateSender} from '../src/multiplayer-state.js';

test('three plain physical presets, paired neutral passenger and legacy appearance compatibility',()=>{
  assert.deepEqual(CHARACTER_PRESETS.map(p=>p.id),['alex_david','alex_adelman','vasilis_pefaltes']);
  const david=characterPresetLook('alex_david'),adelman=characterPresetLook('alex_adelman'),vasilis=characterPresetLook('vasilis_pefaltes');
  assert.equal(david.heightCm,163);assert.equal(david.hairStyle,'curly');assert(david.hairVolume>1.5);
  assert.equal(adelman.heightCm,168);assert.equal(adelman.hairStyle,'messy');assert.equal(adelman.accessory,'sprayCan');
  assert.equal(vasilis.passenger.id,'jonia_peroti');assert.equal(vasilis.passenger.gender,'female');assert(CHARACTER_PRESETS[2].appearanceTODO);
  assert.equal(characterPresetLook('jonia_peroti'),null);vasilis.passenger.shirt='#ffffff';assert.notEqual(characterPresetLook('vasilis_pefaltes').passenger.shirt,'#ffffff');
  assert.deepEqual(normalizeDriverAppearance({}),DEFAULT_DRIVER_APPEARANCE);
});
test('bounded schema keeps tunable traits, enforces Jonia and strips executable/nested identity data',()=>{
  const look=normalizeDriverAppearance({presetId:'vasilis_pefaltes',heightCm:999,build:'broad',hairVolume:-9,skin:'#AABBCC',url:'evil',passenger:{id:'other',gender:'male',skin:'#CC9988',heightCm:2,passenger:{url:'evil'},email:'private'}});
  assert.equal(look.heightCm,210);assert.equal(look.hairVolume,.5);assert.equal(look.skin,'#aabbcc');assert.equal(look.passenger.heightCm,140);assert.equal(look.passenger.gender,'female');assert.equal(look.passenger.id,'jonia_peroti');assert(!JSON.stringify(look).includes('evil'));assert(!JSON.stringify(look).includes('private'));
  assert.equal(normalizeDriverAppearance({presetId:'vasilis_pefaltes',passenger:null}).passenger.id,'jonia_peroti');
  assert(!normalizeDriverAppearance({presetId:'jonia_peroti',passenger:look.passenger}).passenger);
  for(const p of CHARACTER_PRESETS)assert.deepEqual(normalizeAppearance({driver:p.look}).driver,normalizeDriverAppearance(p.look));
  assert(JSON.stringify(look).length<650);
});
test('all characters save/reload as per-car local appearance presets',async()=>{
  {
    let disk={};
    const make=()=>createPresetRepository({load:()=>disk,write:v=>disk={...v,revision:v.revision+1}});
    let repo=make();await repo.reload();const saved=[];
    for(const p of CHARACTER_PRESETS)saved.push(await repo.save('mini',p.name,{driver:p.look}));
    repo=make();await repo.reload();assert.equal(repo.forCar('mini').length,3);assert.deepEqual(repo.forCar('z4'),[]);
    for(let i=0;i<saved.length;i++){await repo.select('mini',saved[i].id);assert.deepEqual(repo.selected('mini').driver,normalizeDriverAppearance(CHARACTER_PRESETS[i].look));}
    const copy=await repo.duplicate(saved[2].id,'Vasilis Copy');await repo.rename(copy.id,'Paired Riders');await repo.delete(saved[2].id);repo=make();await repo.reload();assert.equal(repo.selected('mini').name,'Paired Riders');assert.equal(repo.selected('mini').driver.passenger.id,'jonia_peroti');
  }
});
test('passenger changes transmit while parked without mutating a prior queued snapshot',()=>{
  let now=0;const packets=[],sender=new StateSender(p=>packets.push(p),{now:()=>now});const state={x:0,y:0,z:0,s:0,u:0,yaw:0,steer:0,vLong:0,vLat:0,rpm:850,gear:1,damage:{},driver:characterPresetLook('vasilis_pefaltes')};
  sender.sample(state,'race');state.driver.passenger.shirt='#ffffff';now+=100;assert(sender.sample(state,'race'));assert.notEqual(packets[0].state.driver.passenger.shirt,'#ffffff');assert.equal(packets[1].state.driver.passenger.shirt,'#ffffff');
});
test('multiplayer relays all character fields and preserves the paired passenger after hibernation',t=>{
  let now=100000;t.mock.method(Date,'now',()=>now);const maps=new Map([['riviera',{id:'riviera',track:{start:0,finish:1000,version:'fixture'},definitions:new Map([['quick',{id:'quick',type:'sprint',s0:0,s1:1000,dir:1,len:1000,routeKey:'0>1000'}]])}]]);
  const opts={maps,cars:new Set(['mini']),countdownMs:100,leaderboard:{submit:async()=>({})}},core=createGameCore(opts),socket=()=>({readyState:1,messages:[],send(s){this.messages.push(JSON.parse(s));},close(){}}),a=socket(),b=socket();core.connect(a,'a',{protocol:MULTIPLAYER_PROTOCOL});core.connect(b,'b',{protocol:MULTIPLAYER_PROTOCOL});const send=(ws,m)=>core.message(ws,JSON.stringify(m));
  send(a,{type:'create',mapId:'riviera'});send(b,{type:'join',code:a.messages.at(-1).lobby.code});for(const ws of [a,b])send(ws,{type:'ready',ready:true,version:'fixture'});send(a,{type:'start'});now+=101;core.tick();const raceId=a.messages.at(-1).lobby.raceId;
  for(const p of CHARACTER_PRESETS){send(a,{type:'state',raceId,state:{x:2,y:0,z:0,yaw:0,s:2,u:0,vLong:0,vLat:0,steer:0,rpm:900,gear:1,driver:p.look}});core.tick();assert.deepEqual(b.messages.at(-1).players.find(p=>p.state)?.state.driver,normalizeDriverAppearance(p.look));now+=110;}
  const restored=createGameCore(opts);restored.restore(JSON.parse(JSON.stringify(core.exportState())),new Map([...core.clients].map(c=>[c.token,c.ws])));assert.equal([...restored.clients].find(c=>c.state)?.state.driver.passenger.id,'jonia_peroti');
});
