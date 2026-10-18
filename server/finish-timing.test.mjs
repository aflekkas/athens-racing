import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameCore} from './core.mjs';
import {MULTIPLAYER_PROTOCOL} from '../src/multiplayer-protocol.js';
const socket=()=>({readyState:1,messages:[],send(d){this.messages.push(JSON.parse(d))},close(){}});
for(const dir of [1,-1])test(`authoritative ${dir>0?'forward':'reverse'} finish uses the crossing and publishes before others finish`,t=>{
 let now=100000;t.mock.method(Date,'now',()=>now);
 const geometry={step:20,x:Array.from({length:11},(_,i)=>i*20),z:Array(11).fill(0),y:Array(11).fill(0),lanes:Array(11).fill(1),div:Array(11).fill(0)};
 const event={id:'quick',type:'sprint',s0:dir>0?0:200,s1:dir>0?200:0,dir,len:200,sectors:[]};
 const maps=new Map([['riviera',{track:{version:'v'},geometry,definitions:new Map([['quick',event]])}]]);
 const core=createGameCore({maps,cars:new Set(['mini']),leaderboard:{submit:async()=>{}},countdownMs:100}),a=socket(),b=socket(),send=(s,m)=>core.message(s,JSON.stringify(m));
 core.connect(a,'a',{protocol:MULTIPLAYER_PROTOCOL});core.connect(b,'b',{protocol:MULTIPLAYER_PROTOCOL});send(a,{type:'create'});const l=[...core.lobbies.values()][0];send(b,{type:'join',code:l.code});send(a,{type:'start',force:true});now+=100;core.tick();
 const drive=ws=>{for(const d of [70,90,150,190,210]){now+=1000;core.tick();const s=event.s0+dir*d;send(ws,{type:'state',raceId:l.raceId,state:{s,u:0,x:s,y:0,z:0,yaw:0,vLong:20,vLat:0,steer:0,rpm:3000,gear:2}})}};
 drive(a);assert.ok(Math.abs(core.clientData(a).finish-4.5)<1e-4);assert.equal(l.status,'race');assert.equal(core.clientData(b).finish,null);assert.equal(a.messages.findLast(m=>m.type==='lobby').lobby.players.find(p=>p.id===core.clientData(a).id).finish,core.clientData(a).finish);
 drive(b);assert.equal(l.status,'results');assert.ok(Math.abs(core.clientData(a).finish-4.5)<1e-4);assert.ok(Math.abs(core.clientData(b).finish-9.5)<1e-4);
});
