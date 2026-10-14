// CPU protocol integration: actual customization service + game core and
// in-memory sockets. Server-bound accountSub is an explicit fixture because
// the separately owned OAuth backend is not required by this regression.
// No account authentication, browser or deployed Durable Object claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameCore} from './core.mjs';
import {createCustomizationService} from './customization.mjs';
import {createMemoryCustomizationStore} from './customization-store.mjs';
import {packDecals,unpackDecals} from '../src/vehicle-decal-data.js';
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=','base64');
test('signed preset photos/driver synchronize; guest, forged ownership and deleted assets are stripped; restore preserves bounded look',t=>{
  let now=100000;t.mock.method(Date,'now',()=>now);
  const appearance=createCustomizationService(createMemoryCustomizationStore()),owned=appearance.upload('private-google-A',image,'image/png'),foreign=appearance.upload('private-google-B',image,'image/png');
  const maps=new Map([['riviera',{id:'riviera',name:'Test',track:{start:0,finish:1000,version:'fixture'},definitions:new Map([['quick',{id:'quick',type:'sprint',s0:0,s1:1000,dir:1,len:1000,routeKey:'0>1000'}]])}]]);
  const opts={maps,cars:new Set(['mini']),leaderboard:{submit:async()=>({})},appearance,countdownMs:100};
  const core=createGameCore(opts),socket=()=>({readyState:1,messages:[],send(s){this.messages.push(JSON.parse(s));},close(){}}),a=socket(),b=socket();core.connect(a,'fixture-A');core.connect(b,'fixture-B');
  // The trusted server/session boundary supplies ownership; client state
  // must never be allowed to replace it with a forged accountSub field.
  [...core.clients].find(c=>c.ws===a).accountSub='private-google-A';
  const send=(ws,m)=>core.message(ws,JSON.stringify(m));send(a,{type:'create',mapId:'riviera'});const code=a.messages.at(-1).lobby.code;send(b,{type:'join',code});
  for(const ws of [a,b])send(ws,{type:'ready',ready:true,version:'fixture'});send(a,{type:'start'});now+=101;core.tick();const raceId=a.messages.at(-1).lobby.raceId;
  const layers=[{id:'stripes',position:'bonnet',color:'#ffffff',x:.3,scale:.8},{id:'photo',assetId:owned.id,position:'doors',rotation:40,flipX:true},{id:'photo',assetId:foreign.id,position:'roof'}];
  const state={x:2,y:0,z:0,yaw:0,s:2,u:0,vLong:0,vLat:0,steer:0,rpm:900,gear:1,paint:'#2288AA',decals:packDecals(layers),driver:{skin:'#bc8866',shirt:'#123456',hair:'#ffffff',hairStyle:'short',helmet:true,email:'not-public'},accountSub:'private-google-B'};
  send(a,{type:'state',raceId,state});core.tick();const packet=b.messages.at(-1),received=packet.players.find(p=>p.state)?.state;
  assert.deepEqual(unpackDecals(received.decals),unpackDecals(packDecals(layers.slice(0,2))));assert.equal(received.paint,'#2288aa');assert.equal(received.driver.shirt,'#123456');assert.equal(received.driver.helmet,true);assert(!('email'in received.driver));assert(!JSON.stringify(packet).includes('private-google'));
  send(b,{type:'state',raceId,state});core.tick();const guest=[...core.clients].find(c=>c.ws===b);assert.equal(unpackDecals(guest.state.decals).filter(d=>d.id==='photo').length,0,'guest cannot spoof accountSub or reuse signed photo');
  const saved=JSON.parse(JSON.stringify(core.exportState())),restored=createGameCore(opts);restored.restore(saved,new Map([...core.clients].map(c=>[c.token,c.ws])));const resumed=[...restored.clients].find(c=>c.accountSub==='private-google-A');assert.equal(resumed.state.driver.hairStyle,'short');assert.equal(unpackDecals(resumed.state.decals)[1].assetId,owned.id);
  appearance.delete('private-google-A',owned.id);now+=100;send(a,{type:'state',raceId,state});core.tick();assert.equal(unpackDecals([...core.clients].find(c=>c.ws===a).state.decals).filter(d=>d.id==='photo').length,0,'next packet drops deleted photo');
  assert(JSON.stringify(received.decals).length<256,'reference-only wire stays bounded');
});
