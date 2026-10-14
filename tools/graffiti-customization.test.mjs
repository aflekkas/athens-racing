import test from 'node:test';
import assert from 'node:assert/strict';
import {DECAL_LIBRARY,normalizeDecals,packDecals,unpackDecals} from '../src/vehicle-decal-data.js';
import {createCustomizationService} from '../server/customization.mjs';
import {createMemoryCustomizationStore} from '../server/customization-store.mjs';
import {createPresetRepository} from '../src/customization-repository.js';
import {createGameCore} from '../server/core.mjs';
const styles=['bubble','throwup','tag','drip'];
const layers=styles.map((style,i)=>({id:'toe_'+style,position:'doors',color:'#e948ac',x:i/10,y:-.2,scale:.8,rotation:15,flipX:true}));
test('Graffiti styles keep legacy and photo wire IDs and bounded transforms',()=>{
  assert.deepEqual(DECAL_LIBRARY.filter(d=>d.category==='Graffiti').map(d=>d.graffitiStyle),styles);
  assert.deepEqual(packDecals(layers).map(d=>d[0]),[8,9,10,11]);
  assert.deepEqual(unpackDecals(packDecals(layers)),normalizeDecals(layers));
  assert.deepEqual(packDecals([{id:'ion',position:'bonnet',color:'#ffffff'}]),[[6,0,'ffffff']]);
  const photo={id:'photo',assetId:'a'.repeat(32),position:'roof',color:'#ffffff'};
  assert.equal(packDecals([photo])[0][0],7);assert.deepEqual(unpackDecals(packDecals([photo])),[photo]);
  assert.deepEqual(unpackDecals([[12,1,'e948ac'],[-1,1,'e948ac']]),[]);
});
test('named Graffiti presets save, reload, duplicate and delete through owned service',async()=>{
  const service=createCustomizationService(createMemoryCustomizationStore(),{cars:new Set(['mini','z4'])});
  const make=()=>createPresetRepository({load:()=>service.get('owner'),write:value=>service.save('owner',value)});
  let repo=make();await repo.reload();const preset=await repo.save('mini','TOE Night',{paint:'#112233',decals:layers});
  repo=make();await repo.reload();assert.deepEqual(normalizeDecals(repo.selected('mini').decals),normalizeDecals(layers));assert.deepEqual(repo.forCar('z4'),[]);assert.deepEqual(service.get('other').presets,[]);
  const duplicate=await repo.duplicate(preset.id,'TOE Copy');await repo.rename(duplicate.id,'TOE Drift');await repo.delete(preset.id);
  repo=make();await repo.reload();assert.equal(repo.forCar('mini')[0].name,'TOE Drift');assert.deepEqual(normalizeDecals(repo.selected('mini').decals),normalizeDecals(layers));
});
test('multiplayer relays and hibernation restores Graffiti styles without photo ownership',t=>{
  let now=100000;t.mock.method(Date,'now',()=>now);
  const maps=new Map([['riviera',{id:'riviera',track:{start:0,finish:1000,version:'fixture'},definitions:new Map([['quick',{id:'quick',type:'sprint',s0:0,s1:1000,dir:1,len:1000,routeKey:'0>1000'}]])}]]);
  const opts={maps,cars:new Set(['mini']),countdownMs:100,leaderboard:{submit:async()=>({})}};
  const core=createGameCore(opts),socket=()=>({readyState:1,messages:[],send(s){this.messages.push(JSON.parse(s));},close(){}}),a=socket(),b=socket();core.connect(a,'a');core.connect(b,'b');
  const send=(ws,m)=>core.message(ws,JSON.stringify(m));send(a,{type:'create',mapId:'riviera'});const code=a.messages.at(-1).lobby.code;send(b,{type:'join',code});for(const ws of [a,b])send(ws,{type:'ready',ready:true,version:'fixture'});send(a,{type:'start'});now+=101;core.tick();const raceId=a.messages.at(-1).lobby.raceId;
  const wire=packDecals(layers);send(a,{type:'state',raceId,state:{x:2,y:0,z:0,yaw:0,s:2,u:0,vLong:0,vLat:0,steer:0,rpm:900,gear:1,decals:wire}});core.tick();
  assert.deepEqual(b.messages.at(-1).players.find(p=>p.state)?.state.decals,wire);
  const saved=JSON.parse(JSON.stringify(core.exportState())),restored=createGameCore(opts);restored.restore(saved,new Map([...core.clients].map(c=>[c.token,c.ws])));assert.deepEqual([...restored.clients].find(c=>c.state)?.state.decals,wire);
});
