// Repeated real-transport races, including loaded/ready publications and clean
// shutdown. --startup-only retires after the first accepted snapshot; full mode
// drives every checkpoint using the same route as deploy-smoke.mjs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import { getMap } from '../src/map-catalog.js';
import { resolveMap } from '../server/map-definitions.mjs';
import { smokeDrive, SMOKE_SPEED, SMOKE_STEP } from './deploy-smoke-route.mjs';
const base=(process.argv[2]||'').replace(/\/$/,'');
assert.match(base,/^https?:\/\//,'Usage: node tools/multiplayer-smoke-stress.mjs BASE [--rounds=20] [--startup-only] [--without-loaded]');
const rounds=Number(process.argv.find(v=>v.startsWith('--rounds='))?.slice(9)||20);
assert.ok(Number.isSafeInteger(rounds)&&rounds>0&&rounds<=100);
const startup=process.argv.includes('--startup-only'),loaded=!process.argv.includes('--without-loaded');
const idleMs=Number(process.argv.find(v=>v.startsWith('--idle-ms='))?.slice(10)||0);
assert.ok(Number.isFinite(idleMs)&&idleMs>=0&&idleMs<=60000);
const delay=ms=>new Promise(r=>setTimeout(r,ms)),closes=[],results=[];
function client(label){
 const ws=new WebSocket(base.replace(/^http/,'ws')+'/ws?protocol='+MULTIPLAYER_PROTOCOL,{origin:base}),inbox=[],waiters=new Set();
 let failure,closing=false;
 const fail=e=>{failure||=e;for(const w of waiters){clearTimeout(w.timer);w.reject(failure);}waiters.clear();};
 ws.on('error',fail);ws.on('close',(code,reason)=>{closes.push({label,code,reason:String(reason),expected:closing});if(!closing||code!==1000)fail(Error(`${label}: socket closed ${code} ${reason}`));});
 ws.on('message',data=>{if(String(data)==='alive')return;const m=JSON.parse(data);if(m.type==='error'||m.type==='reload')return fail(Error(`${label}: ${JSON.stringify(m)}`));const w=[...waiters].find(w=>w.pred(m));if(w){waiters.delete(w);clearTimeout(w.timer);w.resolve(m);}else inbox.push(m);});
 return{ws,next:(pred,timeout=12000)=>new Promise((resolve,reject)=>{if(failure)return reject(failure);const i=inbox.findIndex(pred);if(i>=0)return resolve(inbox.splice(i,1)[0]);const w={pred,resolve,reject,timer:setTimeout(()=>{waiters.delete(w);reject(Error(`${label}: message timeout; inbox=${JSON.stringify(inbox.slice(-2))}`));},timeout)};waiters.add(w);}),send:m=>{if(failure)throw failure;ws.send(JSON.stringify(m));},check:()=>{if(failure)throw failure;},close:async()=>{closing=true;if(ws.readyState===WebSocket.CLOSED)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.terminate();reject(Error(`${label}: close handshake timeout`));},5000);ws.once('close',(code)=>{clearTimeout(timer);code===1000?resolve():reject(Error(`${label}: close handshake ${code}`));});ws.close(1000,'Stress round complete');});},abort:()=>ws.terminate()};
}
const maps=new Map();
for(const id of ['riviera','penteli']){const meta=getMap(id),data=await(await fetch(new URL(meta.dataUrl,base+'/'))).json();maps.set(id,resolveMap(meta,data));}
for(let i=0;i<rounds;i++){
 const mapId=i%2?'penteli':'riviera',map=maps.get(mapId),sockets=[],start=Date.now();let interval;
 try{
  const a=client(`round ${i+1} host`);sockets.push(a);const ah=await a.next(m=>m.type==='hello');
  a.send({type:'hello',protocol:MULTIPLAYER_PROTOCOL});a.send({type:'create',mapId,private:true,name:'STRESS-HOST',driverId:randomUUID(),car:'mini'});
  const created=(await a.next(m=>m.type==='lobby')).lobby;
  if(idleMs)await delay(idleMs);
  if(loaded){a.send({type:'loaded',loaded:true,mapId,version:map.track.version});await a.next(m=>m.type==='lobby'&&m.lobby.players[0].loaded);}
  const b=client(`round ${i+1} guest`);sockets.push(b);const bh=await b.next(m=>m.type==='hello');b.send({type:'hello',protocol:MULTIPLAYER_PROTOCOL});b.send({type:'join',code:created.code,name:'STRESS-GUEST',driverId:randomUUID(),car:'mini'});await b.next(m=>m.type==='lobby'&&m.lobby.players.length===2);
  if(idleMs)await delay(idleMs);
  for(const c of [a,b]){if(loaded)c.send({type:'loaded',loaded:true,mapId,version:map.track.version});c.send({type:'ready',ready:true,mapId,version:map.track.version});}
  await a.next(m=>m.type==='lobby'&&m.lobby.players.length===2&&m.lobby.players.every(p=>p.ready&&p.loaded));a.send({type:'start'});
  const race=(await b.next(m=>m.type==='lobby'&&m.lobby.status==='race')).lobby;await a.next(m=>m.type==='lobby'&&m.lobby.status==='race');
  const drive=smokeDrive(race.event,map.geometry);let cursor=0;
  interval=setInterval(()=>{if(cursor===drive.samples.length||startup&&cursor>=4)return;const states=drive.samples.slice(cursor,cursor+2);cursor+=states.length;try{for(const c of [a,b])c.send({type:'states',raceId:race.raceId,generation:race.generation,states});}catch{clearInterval(interval);}},2*SMOKE_STEP/SMOKE_SPEED*1000);
  await b.next(m=>m.type==='snapshot'&&m.players.some(p=>p.id===ah.id&&p.state));
  if(startup)for(const c of [a,b])c.send({type:'dnf',raceId:race.raceId,generation:race.generation,reason:'retired'});
  const finished=await Promise.all([a,b].map(c=>c.next(m=>m.type==='lobby'&&m.lobby.status==='results',Math.ceil(race.event.len/SMOKE_SPEED*1000)+30000)));
  if(!startup){assert.equal(finished[0].lobby.results.length,2);assert.ok(finished[0].lobby.results.every(p=>Number.isFinite(p.finish)&&!p.dnf));assert.deepEqual(finished[0].lobby.results,finished[1].lobby.results,'both clients must receive identical results');}
  clearInterval(interval);
  for(const c of [b,a]){c.send({type:'leave'});await c.next(m=>m.type==='left');}
  for(const c of sockets)await c.close();for(const c of sockets)c.check();
  const result={round:i+1,mapId,loaded,startupOnly:startup,durationMs:Date.now()-start,ok:true};results.push(result);console.log(JSON.stringify(result));
 }catch(error){results.push({round:i+1,mapId,ok:false,error:error.stack});console.error(error);process.exitCode=1;break;}
 finally{clearInterval(interval);for(const c of sockets)if(c.ws.readyState!==WebSocket.CLOSED)c.abort();}
}
await delay(100);
console.log(JSON.stringify({proof:'sequential multiplayer smoke stress',rounds,completed:results.filter(r=>r.ok).length,loaded,startupOnly:startup,closes,results,health:await(await fetch(base+'/health')).json()},null,2));
if(closes.some(c=>!c.expected||c.code!==1000))process.exitCode=1;
