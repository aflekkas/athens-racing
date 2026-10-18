import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createGameCore } from './core.mjs';
import { smokeClient } from '../tools/resumable-smoke-client.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
async function arena(t){
 const maps=new Map([['riviera',{track:{version:'v'},definitions:new Map([['quick',{id:'quick',type:'sprint',s0:0,s1:320,dir:1,len:320}]])}]]);
 const core=createGameCore({maps,cars:new Set(['mini']),leaderboard:{submit:async()=>{}},countdownMs:0});
 const server=http.createServer(),wss=new WebSocketServer({server});wss.on('connection',ws=>{core.connect(ws,'test',{protocol:MULTIPLAYER_PROTOCOL});ws.on('message',m=>core.message(ws,String(m)));ws.on('close',()=>core.disconnect(ws));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const timer=setInterval(()=>core.tick(),10),clients=[];
 t.after(async()=>{for(const c of clients)await c.close();clearInterval(timer);for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));});
 const client=name=>{const c=smokeClient('http://127.0.0.1:'+server.address().port,name);clients.push(c);return c;};return{core,client};
}
test('real TCP loss resumes both route progress and the same seat through finish',async t=>{
 const {client}=await arena(t),a=client('host'),b=client('guest');const [ah,bh]=await Promise.all([a.next(m=>m.type==='hello'),b.next(m=>m.type==='hello')]);
 a.send({type:'create',private:true});const created=(await a.next(m=>m.type==='lobby')).lobby;b.send({type:'join',code:created.code});await b.next(m=>m.type==='lobby');
 for(const c of [a,b])c.send({type:'ready',ready:true,version:'v'});await a.next(m=>m.type==='lobby'&&m.lobby.players.every(p=>p.ready));a.send({type:'start'});
 const race=(await b.next(m=>m.type==='lobby'&&m.lobby.status==='race')).lobby;const slot=race.players.find(p=>p.id===bh.id).gridSlot;
 let s=0,dropped=false;const timer=setInterval(()=>{if(!a.available||!b.available||s>322)return;s=Math.min(322,s+6);for(const c of [a,b])c.send({type:'state',raceId:race.raceId,state:{s,u:0,x:s,y:0,z:0,yaw:0,vLong:120,vLat:0,steer:0,rpm:3000,gear:3}});if(s>=120&&!dropped){dropped=true;b.forceReset();}},50);t.after(()=>clearInterval(timer));
 const finish=await Promise.all([a,b].map(c=>c.next(m=>m.type==='lobby'&&m.lobby.status==='results',15000)));clearInterval(timer);
 assert.equal(b.reconnects,1);assert.equal(b.id,bh.id);assert.equal(a.id,ah.id);assert.equal(finish[0].lobby.raceId,race.raceId);assert.equal(finish[1].lobby.players.find(p=>p.id===bh.id).gridSlot,slot);assert.ok(finish[0].lobby.results.every(p=>Number.isFinite(p.finish)&&!p.dnf));
});
test('a create command lost before acknowledgement is retried after token resume',async t=>{
 const {core,client}=await arena(t),a=client('host');await a.next(m=>m.type==='hello');a.send({type:'create',private:true});a.forceReset();const m=await a.next(m=>m.type==='lobby');assert.equal(m.lobby.players.length,1);assert.equal(core.lobbies.size,1);assert.equal(a.reconnects,1);
});
