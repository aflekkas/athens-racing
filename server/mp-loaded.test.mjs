import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from './core.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
const socket = () => ({ readyState:1, messages:[], send(data){this.messages.push(JSON.parse(data));}, close(){this.readyState=3;} });
test('loaded in a waiting lobby publishes to everyone without throwing, readying or changing the allow-list', t => {
 const errors=[];t.mock.method(console,'error',(...args)=>errors.push(args));
 const core=createGameCore({maps:new Map([['riviera',{track:{version:'v'},definitions:new Map([['quick',{id:'quick',type:'sprint',s0:0,s1:200,dir:1,len:200}]])}]]),cars:new Set(['mini','z4']),leaderboard:{submit:async()=>{}}});
 const a=socket(),b=socket();core.connect(a,'a',{protocol:MULTIPLAYER_PROTOCOL});core.connect(b,'b',{protocol:MULTIPLAYER_PROTOCOL});
 const send=(ws,m)=>core.message(ws,JSON.stringify(m));
 send(a,{type:'create',allowedCars:['mini'],name:'HOST'});const code=a.messages.findLast(m=>m.type==='lobby').lobby.code;
 send(b,{type:'join',code,name:'GUEST'});const guest=core.clientData(b).id;
 const count=ws=>ws.messages.filter(m=>m.type==='lobby').length;
 for(const [loaded,version,expected] of [[true,'v',true],[true,'v',true],[false,'v',false],[true,'old',false],[true,'v',true]]){
  const before=[count(a),count(b)];send(b,{type:'loaded',loaded,mapId:'riviera',version});
  for(const [i,ws] of [a,b].entries()){
   assert.equal(count(ws),before[i]+1,'loaded acknowledgement must reach every member');
   const lobby=ws.messages.findLast(m=>m.type==='lobby').lobby;
   assert.equal(lobby.status,'waiting');assert.deepEqual(lobby.allowedCars,['mini']);
   assert.equal(lobby.players.find(p=>p.id===guest).loaded,expected);assert.ok(lobby.players.every(p=>!p.ready));
   assert.equal(ws.messages.some(m=>m.type==='error'),false);
  }
 }
 assert.deepEqual(errors,[],'the loaded handler must not reference settings-handler locals');
});

test('an abrupt arena replacement gives active racers a fresh grace period and restores compact route progress', t => {
 let now=100000;t.mock.method(Date,'now',()=>now);
 const opts={maps:new Map([['riviera',{track:{version:'v'},definitions:new Map([['quick',{id:'quick',type:'sprint',s0:0,s1:10000,dir:1,len:10000}]])}]]),cars:new Set(['mini']),leaderboard:{submit:async()=>{}},countdownMs:0};
 let core=createGameCore(opts);const a=socket(),b=socket(),send=(ws,m)=>core.message(ws,JSON.stringify(m));
 core.connect(a,'a',{protocol:MULTIPLAYER_PROTOCOL});core.connect(b,'b',{protocol:MULTIPLAYER_PROTOCOL});
 send(a,{type:'create',name:'HOST'});const code=core.clientData(a).lobbyCode;send(b,{type:'join',code,name:'GUEST'});
 for(const ws of [a,b])send(ws,{type:'ready',ready:true,version:'v'});
 send(a,{type:'start'});core.tick();const race=[...core.lobbies.values()][0],raceId=race.raceId;
 // A long race exceeds the reservation measured from connect/create. A recent
 // durable progress cursor must survive a replacement that loses all attachments.
 now+=120000;
 for(const ws of [a,b])send(ws,{type:'state',raceId,state:{x:90,y:0,z:0,s:90,u:0,yaw:0,vLong:20,vLat:0,steer:0,rpm:3000,gear:2}});
 const prior=core.clientData(a),saved=structuredClone(core.exportState());
 assert.equal(prior.course.reached,90);assert.equal(saved.sessions[0].course,undefined);assert.equal(saved.sessions[0].courseCursor.reached,90);assert.equal(saved.sessions[0].courseCursor.lastRoad.s,90);
 assert.ok(JSON.stringify(saved).length<10000,'immutable course data must not be written per player');
 now+=2000;core=createGameCore(opts);core.restore(saved);core.tick();
 assert.equal(core.sessions.size,2,'lost sockets start their grace at restoration');assert.equal(core.nextWake(),now+90001);
 const replacement=socket();core.connect(replacement,'a',{protocol:MULTIPLAYER_PROTOCOL});send(replacement,{type:'resume',token:prior.token});
 const resumed=replacement.messages.find(m=>m.type==='session');assert.equal(resumed.resumed,true);assert.equal(resumed.id,prior.id);
 const lobby=replacement.messages.find(m=>m.type==='lobby');assert.equal(lobby.lobby.raceId,raceId);assert.equal(lobby.lobby.startAt,race.startAt);assert.equal(lobby.state.s,90);
 assert.equal(core.clientData(replacement).course.reached,90);assert.equal(core.clientData(replacement).course.previous.s,90);
});
