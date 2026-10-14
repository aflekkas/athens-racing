import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
// Run against Node by default; MP_WORKER_BASE points this same contract suite
// at wrangler dev's real SQLite Durable Object + WebSocket transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from './index.mjs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCourse, roadFrame } from '../src/checkpoints.js';
test('session contract over real '+(process.env.MP_WORKER_BASE?'Worker':'Node')+' sockets',async t=>{
 let app,base=process.env.MP_WORKER_BASE;
 if(!base){const dataDir=await mkdtemp(join(tmpdir(),'mp-session-'));app=await createGameServer({countdownMs:100,dataDir});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true})});}
 const sockets=[];t.after(()=>{for(const ws of sockets)ws.terminate()});
 async function client(name){const ws=new WebSocket(base.replace('http:','ws:')+'/ws?protocol='+MULTIPLAYER_PROTOCOL+'&build=compatible-other-release');sockets.push(ws);ws.on('open',()=>ws.send(JSON.stringify({type:'hello',protocol:MULTIPLAYER_PROTOCOL,build:'compatible-other-release'})));const messages=[];ws.on('message',data=>messages.push(JSON.parse(data)));const wait=async pred=>{const end=Date.now()+12000;while(Date.now()<end){const at=messages.findIndex(pred);if(at>=0)return messages.splice(at,1)[0];await new Promise(r=>setTimeout(r,15))}throw new Error(name+': message timeout '+JSON.stringify(messages.slice(-3)))};const hello=await wait(m=>m.type==='hello');return {ws,hello,wait,send:m=>ws.send(JSON.stringify(m)),room:status=>wait(m=>m.type==='lobby'&&(!status||m.lobby.status===status))};}
 async function rejectsProtocol(search) {
  const ws=new WebSocket(base.replace('http:','ws:')+'/ws'+search);sockets.push(ws);
  const messages=[];ws.on('message',data=>messages.push(JSON.parse(data)));
  const closed=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{ws.terminate();reject(new Error('Protocol close timeout'))},5000);
   ws.on('close',(code,reason)=>{clearTimeout(timer);resolve({code,reason:String(reason)})});
   ws.on('error',error=>{clearTimeout(timer);reject(error)});
  });
  assert.deepEqual(messages,[{type:'reload',reason:'update'}]);assert.equal(closed.code,4001);
 }
 await rejectsProtocol('');await rejectsProtocol('?protocol=0');await rejectsProtocol('?protocol='+(MULTIPLAYER_PROTOCOL+1));
 const a=await client('host'),b=await client('guest');a.send({type:'create',name:'Contract host',private:true});const created=(await a.room()).lobby;const code=created.code;b.send({type:'join',code,name:'Contract guest',driverId:'contract-guest'});await b.room();await a.wait(m=>m.type==='lobby'&&m.lobby.players.length===2);
 b.send({type:'ready',ready:true,version:created.track.version});await b.wait(m=>m.type==='lobby'&&m.lobby.players.find(p=>p.id===b.hello.id)?.ready);b.send({type:'car',car:'z4'});await b.wait(m=>m.type==='lobby'&&m.lobby.players.find(p=>p.id===b.hello.id)?.car==='z4'&&!m.lobby.players.find(p=>p.id===b.hello.id)?.ready);
 a.send({type:'options',allowedCars:['mini']});await b.wait(m=>m.type==='lobby'&&m.lobby.allowedCars.length===1&&m.lobby.players.every(p=>p.car==='mini'));b.send({type:'car',car:'z4'});assert.match((await b.wait(m=>m.type==='error')).message,/allowed/);a.send({type:'options',allowedCars:['mini','z4']});await b.wait(m=>m.type==='lobby'&&m.lobby.allowedCars.length===2);
 b.send({type:'start',force:true});assert.match((await b.wait(m=>m.type==='error')).message,/host/);a.send({type:'start',force:true});const racing=(await b.room('countdown')).lobby;assert.ok(racing.players.every(p=>p.ready));await b.room('race');b.send({type:'car',car:'z4'});assert.match((await b.wait(m=>m.type==='error')).message,/started/);
 const raw=JSON.parse(await readFile(new URL('../data/map.json',import.meta.url),'utf8')).route,course=buildCourse(racing.event,raw),gate=course.gates[0];
 const pose=(s,u)=>{const f=roadFrame(raw,s);return {s,u,x:f.x-f.tz*u,y:f.y,z:f.z+f.tx*u,yaw:0,vLong:20,vLat:0,steer:0,rpm:3000,gear:2,paint:'#abcdef',driver:{},decals:[['legacy-descriptor']]}};
 const state=s=>b.send({type:'state',raceId:racing.raceId,generation:racing.generation,state:s});
 await new Promise(r=>setTimeout(r,800));state(pose(gate.s-racing.event.dir*20,40));await new Promise(r=>setTimeout(r,500));state(pose(gate.s+racing.event.dir*6,40));const warning=await b.wait(m=>m.type==='checkpoint'&&m.missed);assert.match(warning.message,/MISSED CHECKPOINT/);assert.equal(warning.passed,0);
 for(const c of [a,b])c.send({type:'dnf',raceId:racing.raceId,reason:'retired'});await b.room('results');b.send({type:'car',car:'z4'});await b.wait(m=>m.type==='lobby'&&m.lobby.status==='results'&&m.lobby.players.find(p=>p.id===b.hello.id)?.car==='z4');
 b.ws.close();const resumed=await client('resumed');resumed.send({type:'resume',token:b.hello.token});assert.equal((await resumed.wait(m=>m.type==='session')).resumed,true);await resumed.room('results');resumed.send({type:'car',car:'mini'});await resumed.wait(m=>m.type==='lobby'&&m.lobby.players.find(p=>p.id===b.hello.id)?.car==='mini');
 a.send({type:'kick',id:b.hello.id});const kicked=await resumed.wait(m=>m.type==='kicked');assert.ok(kicked.until>Date.now());resumed.send({type:'join',code,driverId:'changed-driver'});assert.equal((await resumed.wait(m=>m.type==='error')).code,'KICK_COOLDOWN');a.send({type:'unblock',id:b.hello.id});await a.wait(m=>m.type==='lobby'&&m.lobby.blockedPlayers.length===0);a.send({type:'rematch'});await a.wait(m=>m.type==='lobby'&&m.lobby.status==='waiting'&&m.lobby.generation>racing.generation);resumed.send({type:'join',code});await resumed.room('waiting');resumed.send({type:'car',car:'z4'});await resumed.wait(m=>m.type==='lobby'&&m.lobby.players.find(p=>p.id===b.hello.id)?.car==='z4');
 for(const c of [a,resumed])c.send({type:'leave'});
});
