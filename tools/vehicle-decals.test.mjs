import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDecals, packDecals, unpackDecals, MAX_DECALS } from '../src/vehicle-decal-data.js';
import { StateSender } from '../src/multiplayer-state.js';
import { createGameCore } from '../server/core.mjs';
const livery=[{id:'roundel',position:'doors',color:'#FFFFFF',number:42},{id:'greek_flag',position:'bonnet',color:'#168bda'}];
test('decal descriptors are bounded, canonical and round-trip without executable art',()=>{
  const expected=normalizeDecals(livery);
  assert.deepEqual(unpackDecals(packDecals(livery)),expected);
  assert.equal(normalizeDecals(Array(100).fill(livery[0])).length,MAX_DECALS);
  assert.deepEqual(unpackDecals([[999,0,'ffffff'],[0,99,'ffffff'],[0,0,'url(x)'],null]),[]);
  assert.deepEqual(normalizeDecals([{id:'roundel',position:'doors',number:99999,color:'bad',url:'evil'}]),[{id:'roundel',position:'doors',number:999,color:'#ffffff'}]);
  assert.deepEqual(unpackDecals(null),[]);assert.deepEqual(normalizeDecals({length:100}),[]);
});
test('parked livery edits and removal transmit, with snapshot isolation',()=>{
  let now=0;const packets=[],sender=new StateSender(p=>packets.push(p),{now:()=>now});
  const state={x:0,y:0,z:0,s:0,u:0,yaw:0,steer:0,vLong:0,vLat:0,rpm:850,nitro:.4,gear:1,damage:{},decals:[]};
  sender.sample(state,'race');now+=100;assert.equal(sender.sample(state,'race'),false);
  state.decals=packDecals(livery);now+=100;assert.equal(sender.sample(state,'race'),true);
  state.decals[0][3]=5;assert.equal(packets[1].state.decals[0][3],42);
  state.decals=[];now+=100;assert.equal(sender.sample(state,'race'),true);assert.deepEqual(packets[2].state.decals,[]);
});
test('shared multiplayer server relays and restores only validated decal tuples',t=>{
  let now=100000;t.mock.method(Date,'now',()=>now);
  const maps=new Map([['riviera',{id:'riviera',name:'Test',track:{start:0,finish:1000,version:'test'},definitions:new Map([['quick',{id:'quick',type:'sprint',s0:0,s1:1000,dir:1,len:1000,routeKey:'0>1000'}]])}]]);
  const opts={maps,cars:new Set(['mini']),leaderboard:{submit:async()=>({})},countdownMs:100};
  const core=createGameCore(opts),socket=()=>({readyState:1,messages:[],send(s){this.messages.push(JSON.parse(s));},close(){}}),a=socket(),b=socket();core.connect(a,'a');core.connect(b,'b');
  const send=(ws,m)=>core.message(ws,JSON.stringify(m));send(a,{type:'create',mapId:'riviera'});const lobby=a.messages.at(-1).lobby;send(b,{type:'join',code:lobby.code});
  for(const ws of [a,b])send(ws,{type:'ready',ready:true,version:'test'});send(a,{type:'start'});now+=101;core.tick();const raceId=a.messages.at(-1).lobby.raceId;
  const state={x:2,y:0,z:0,yaw:0,s:2,u:0,vLong:0,vLat:0,steer:0,rpm:900,gear:1,paint:'#aBcDeF',decals:[...packDecals(livery),[99,0,'ffffff']]};
  send(a,{type:'state',raceId,state});core.tick();const received=b.messages.at(-1).players.find(p=>p.state)?.state;
  assert.deepEqual(received.decals,packDecals(livery));assert.equal(received.paint,'#abcdef');
  const saved=JSON.parse(JSON.stringify(core.exportState())),restored=createGameCore(opts);restored.restore(saved,new Map([...core.clients].map(c=>[c.token,c.ws])));
  assert.deepEqual([...restored.clients].find(c=>c.state)?.state.decals,packDecals(livery));
  now+=100;send(a,{type:'state',raceId,state:{...state,decals:[]}});core.tick();assert.deepEqual(b.messages.at(-1).players.find(p=>p.state)?.state.decals,[]);
});
