// Real local WebSockets through the production coordinator. The camera is
// explicitly a fixture at the researched Ermou junction, never real placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createGameCore } from '../server/core.mjs';
import { resolveMap } from '../server/map-definitions.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
const camera={id:'fixture-ermou',mapId:'riviera',s:220,dir:1,limitKmh:50,verified:true,active:true,source:'fixture: not a verified post'};
async function room(t,{police=true,cameraDir=1,mode='sprint'}={}) {
 const event={id:'quick',name:'Fixture race',type:mode,s0:200,s1:260,dir:1,len:60,routeKey:'200>260',traffic:false,police};
 const maps=new Map([['riviera',{id:'riviera',name:'Fixture',track:{start:200,finish:260,version:'fixture-v1'},definitions:new Map([['quick',event]]),enforcement:{cameras:[{...camera,dir:cameraDir}],redSites:[]},trips:{taxi:[{pickup:{x:1000,y:0,z:0},dropoff:{x:1100,y:0,z:0}}]}}]]);
 const core=createGameCore({maps,cars:new Set(['mini']),leaderboard:{submit:async()=>{}},countdownMs:10});
 const server=http.createServer(),wss=new WebSocketServer({server});
 wss.on('connection',(ws,req)=>{core.connect(ws,req.socket.remoteAddress,{protocol:MULTIPLAYER_PROTOCOL});ws.on('message',m=>core.message(ws,m.toString()));ws.on('close',()=>core.disconnect(ws));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const timer=setInterval(core.tick,10),connections=[];
 t.after(async()=>{clearInterval(timer);for(const ws of connections)ws.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));});
 async function connect(name){
  const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}`),inbox=[],waiters=[];connections.push(ws);
  ws.on('message',data=>{const m=JSON.parse(data);const i=waiters.findIndex(w=>w.pred(m));if(i<0)inbox.push(m);else waiters.splice(i,1)[0].resolve(m);});
  const next=pred=>new Promise((resolve,reject)=>{const i=inbox.findIndex(pred);if(i>=0)return resolve(inbox.splice(i,1)[0]);const timer=setTimeout(()=>reject(Error('Protocol message timeout')),2500);waiters.push({pred,resolve:m=>{clearTimeout(timer);resolve(m);}});});
  const hello=await next(m=>m.type==='hello');ws.send(JSON.stringify({type:'hello',protocol:MULTIPLAYER_PROTOCOL}));return {ws,id:hello.id,inbox,next,send:m=>ws.send(JSON.stringify({name,car:'mini',...m}))};
 }
 const a=await connect('Fined'),b=await connect('Unfined');a.send({type:'create',mapId:'riviera',eventId:'quick',config:{police}});const waiting=(await a.next(m=>m.type==='lobby')).lobby;
 b.send({type:'join',code:waiting.code});await b.next(m=>m.type==='lobby');
 for(const c of [a,b])c.send({type:'ready',ready:true,mapId:'riviera',version:'fixture-v1'});
 await a.next(m=>m.type==='lobby'&&m.lobby.players.length===2&&m.lobby.players.every(p=>p.ready));a.send({type:'start'});
 const lobby=(await a.next(m=>m.type==='lobby'&&m.lobby.status==='race')).lobby;
 const pose=s=>({x:s,y:0,z:0,yaw:0,s,u:2,vLong:25,vLat:0,steer:0,rpm:3000,gear:2});
 // Keep snapshots continuous under the production checkpoint/discontinuity rules.
 const state=(c,s,extra={})=>{
  let from=c.lastRaceId===lobby.raceId?c.lastS:200;
  while(Math.abs(s-from)>10){from+=Math.sign(s-from)*10;c.send({type:'state',raceId:lobby.raceId,generation:lobby.generation,state:{...pose(from),...extra}});}
  c.send({type:'state',raceId:lobby.raceId,generation:lobby.generation,state:{...pose(s),...extra}});c.lastS=s;c.lastRaceId=lobby.raceId;
 };
 const claim=(c,id,extra={})=>c.send({type:'violation',id,kind:'camera',siteId:camera.id,s:220,kmh:90,dir:1,at:Date.now(),raceId:lobby.raceId,generation:lobby.generation,...extra});
 return {core,a,b,lobby,state,claim};
}
test('two real WebSockets: sender-bound fine affects finish, dedup/cooldown reject new IDs',async t=>{
 const {core,a,b,lobby,state,claim}=await room(t);
 state(a,220);state(b,220);claim(a,'c1',{playerId:b.id});const ack=await a.next(m=>m.type==='violation-ack');
 assert.equal(ack.penaltySec,3);assert.equal(ack.raceId,lobby.raceId);assert.equal(ack.generation,lobby.generation);
 claim(a,'c1');claim(a,'c2');state(a,245);state(b,245);state(a,260);state(b,260);
 const done=(await a.next(m=>m.type==='lobby'&&m.lobby.status==='results')).lobby;const fined=done.results.find(p=>p.id===a.id),unfined=done.results.find(p=>p.id===b.id);
 assert.ok(fined.finish-unfined.finish>2.7&&fined.finish-unfined.finish<3.3,JSON.stringify(done.results));
 assert.equal(a.inbox.filter(m=>m.type==='violation-ack').length,0);assert.equal(b.inbox.filter(m=>m.type==='violation-ack').length,0);
 const session=[...core.clients].find(p=>p.id===a.id);assert.equal(session.enfPenalty,3);
});
test('two real WebSockets: master off and stale generations cannot produce fines',async t=>{
 const {core,a,b,lobby,state,claim}=await room(t,{police:false});state(a,220);state(b,220);claim(a,'off');claim(a,'old',{generation:lobby.generation-1});
 state(a,245);state(b,245);state(a,260);state(b,260);await a.next(m=>m.type==='lobby'&&m.lobby.status==='results');
 assert.equal(a.inbox.some(m=>m.type==='violation-ack'),false);assert.equal([...core.clients].find(p=>p.id===a.id).enfPenalty,0);
});

test('production map resolver binds authoritative camera catalogue to the loaded map',()=>{
 const data={route:{start:200,finish:260,length:500,step:2,x:Array.from({length:251},(_,i)=>i*2),z:Array(251).fill(0)},marks:[],speedCameras:[camera],redLightSites:[{...camera,id:'fixture-red'}]};
 const m=resolveMap({id:'riviera',name:'Fixture'},data);assert.equal(m.enforcement.cameras.length,1);assert.equal(m.enforcement.redSites.length,1);
 assert.equal(m.enforcement.cameras[0].mapId,'riviera');
});

test('real sockets: backward travel enforces only the facing camera',async t=>{
 const {a,b,state,claim}=await room(t,{cameraDir:-1});state(a,220,{reverse:true,vLong:-25});state(b,220);claim(a,'reverse',{dir:-1});
 const ack=await a.next(m=>m.type==='violation-ack');assert.equal(ack.penaltySec,3);
});
test('real sockets: new race generation resets the site latch and penalty',async t=>{
 const {core,a,b,lobby,state,claim}=await room(t);state(a,220);state(b,220);claim(a,'c1');await a.next(m=>m.type==='violation-ack');
 const old=lobby.raceId;a.send({type:'restart'});const next=(await a.next(m=>m.type==='lobby'&&m.lobby.status==='race'&&m.lobby.raceId!==old)).lobby;
 Object.assign(lobby,next);state(a,220);state(b,220);claim(a,'c1');assert.equal((await a.next(m=>m.type==='violation-ack')).penaltySec,3);
 assert.equal([...core.clients].find(p=>p.id===a.id).enfPenalty,3);
});
test('real sockets: taxi fine reduces only the sender session deadline',async t=>{
 const {core,a,b,lobby,state,claim}=await room(t,{mode:'taxi'});const l=core.lobbies.get(lobby.code),before=l.objectives.get(a.id).deadline,other=l.objectives.get(b.id).deadline;
 state(a,220);state(b,220);claim(a,'taxi');assert.equal((await a.next(m=>m.type==='violation-ack')).penaltySec,3);
 assert.equal(l.objectives.get(a.id).deadline,before-3);assert.equal(l.objectives.get(b.id).deadline,other);
});
