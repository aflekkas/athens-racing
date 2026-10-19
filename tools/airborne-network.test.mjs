import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteTimeline } from '../src/remote-timeline.js';
import { StateSender } from '../src/multiplayer-state.js';
import { bodyQuaternion } from '../src/airborne-dynamics.js';
import { validateStateExtras } from '../server/mp-lifecycle.mjs';
import { createGameCore } from '../server/core.mjs';
import { socketAttachment } from '../worker/socket-attachment.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import { towCondition } from '../src/recovery-policy.js';
import { containOnlineVehicle } from '../src/multiplayer-contact.js';
const state=(t,extra={})=>({x:0,y:2+4*t-4.905*t*t,z:0,s:0,u:0,yaw:0,vLong:0,vLat:0,vy:4-9.81*t,steer:0,rpm:3000,gear:2,sampleTime:t*1000,bodyDynamic:true,air:true,bodyQ:bodyQuaternion(0,0,t),angularX:0,angularY:0,angularZ:1,...extra});
test('vertical-only airborne snapshots interpolate the apex and rotate smoothly, then freeze',()=>{
  const timeline=new RemoteTimeline();
  for(const t of [0,.2,.4])timeline.push(state(t),{receivedAt:t*1000,serverNow:t*1000,stateAt:t*1000});
  const when=source=>source+timeline.base+timeline.delay,mid=timeline.sample(when(300));assert.ok(Math.abs(mid.y-(2+4*.3-4.905*.3*.3))<1e-8);
  assert.ok(Math.abs(mid.bodyQ[2]-Math.sin(.15))<1e-6);
  const predicted=timeline.sample(when(500));assert.ok(predicted.y>2.7&&predicted.y<2.9);
  const frozen=timeline.sample(when(2000)),again=timeline.sample(when(3000));
  assert.equal(frozen.y,again.y);assert.deepEqual(frozen.bodyQ,again.bodyQ);
});
test('stopped horizontal motion cannot suppress rising/rotating sender samples',()=>{
  let now=0;const packets=[],sender=new StateSender(p=>packets.push(p),{now:()=>now});
  sender.sample(state(0),'race');now=100;sender.sample(state(.1),'race');
  assert.equal(packets.length,2);assert.ok(packets[1].state.y>packets[0].state.y);
});
test('validated 3D state and Worker hibernation retain airborne motion; malformed quaternions are discarded',()=>{
  const valid=validateStateExtras(state(.1));assert.deepEqual(valid.bodyQ,state(.1).bodyQ);assert.equal(valid.vy,3.019);
  assert.equal(validateStateExtras({...state(0),bodyQ:[0,0,0,0]}).bodyQ,undefined);
  assert.equal(validateStateExtras({...state(0),bodyQ:[NaN,0,0,1]}).bodyQ,undefined);
  assert.equal(validateStateExtras({...state(0),vy:Infinity}).vy,undefined);
  const attachment=socketAttachment({state:{...state(.1),unrelated:'x'.repeat(4000)}});
  assert.equal(attachment.state.bodyDynamic,true);assert.equal(attachment.state.air,true);assert.equal(attachment.state.vy,3.019);assert.ok(attachment.state.bodyQ);
});
test('actual authority accepts ballistic y and full orientation while rejecting horizontal teleports',t=>{
  let now=100000;t.mock.method(Date,'now',()=>now);
  const map={id:'riviera',name:'airborne',track:{start:0,finish:10000,version:'v1'},definitions:new Map([['quick',{id:'quick',type:'sprint',s0:0,s1:10000,dir:1,len:10000}]])};
  const core=createGameCore({maps:new Map([['riviera',map]]),cars:new Set(['mini']),leaderboard:{submit:async()=>{}},countdownMs:0});
  const ws={readyState:1,messages:[],send(bytes){this.messages.push(JSON.parse(bytes));},close(){}};
  core.connect(ws,'airborne',{protocol:MULTIPLAYER_PROTOCOL});const send=m=>core.message(ws,JSON.stringify(m));
  send({type:'create'});
  const other={...ws,messages:[]};core.connect(other,'peer',{protocol:MULTIPLAYER_PROTOCOL});
  core.message(other,JSON.stringify({type:'join',code:ws.messages.at(-1).lobby.code}));
  send({type:'ready',ready:true,version:'v1'});send({type:'start',force:true});core.tick();
  const lobby=ws.messages.findLast(m=>m.type==='lobby').lobby;
  for(let i=0;i<10;i++){now+=100;send({type:'state',raceId:lobby.raceId,state:state(i*.1,{y:20+4*i*.1-4.905*(i*.1)**2})});}
  const accepted=core.clientData(ws).state;assert.ok(accepted.y>19);assert.equal(accepted.bodyDynamic,true);assert.ok(accepted.bodyQ);assert.ok(accepted.vy<0);
  now+=100;send({type:'state',raceId:lobby.raceId,state:state(1,{x:5000})});assert.equal(core.clientData(ws).state.x,0);
});
test('stopped side/roof gets tow at 2.5s; moving rollovers keep their momentum and corridor launches are not snapped',()=>{
  const s={offT:0},sample={offroad:false,beyond:0,water:0,inverted:true,disabled:false,speed:0};
  for(let i=0;i<149;i++)assert.equal(towCondition(sample,1/60,s),false);
  assert.equal(towCondition(sample,.04,s),true);
  assert.equal(towCondition({...sample,speed:5},1/60,s),false);assert.equal(s.severeT,0);
  const vehicle={bodyDynamic:true,s:200,u:80,x:80,y:12,z:-200,vLong:30};
  const before={...vehicle};containOnlineVehicle(vehicle,{closed:false,length:1000,edge:()=>7,point:()=>{throw Error('airborne snap');}});assert.deepEqual(vehicle,before);
});
