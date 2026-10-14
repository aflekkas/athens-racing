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
