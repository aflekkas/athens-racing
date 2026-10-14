// Run through tools/browser-slot.sh. One LOW WebGL receiver + one Node 10Hz/5Hz host.
// The optional MOTION_TIMELINE file overrides only the receiver's timeline import,
// so a local fix can be compared on staging without deploying anything.
import { chromium } from '/tmp/pw/node_modules/playwright/index.mjs';
import { WebSocket } from 'ws';
import { StateSender } from '../src/multiplayer-state.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
const base = process.env.MOTION_URL || 'https://athens-street-racers-staging.aflekkas.workers.dev';
const out = resolve(process.env.MOTION_OUT || '.scratch/mp-motion-followup/baseline');
await mkdir(out,{recursive:true});
const errors=[], inbox=[], waiters=[], packets=[];
let lobby, browser, page, sampler, sender, start, id, timelineHash;
const ws = new WebSocket(base.replace(/^http/,'ws')+'/ws',{origin:base});
ws.on('message',data=>{const m=JSON.parse(data);if(m.type==='lobby')lobby=m.lobby;const i=waiters.findIndex(w=>w.pred(m));if(i>=0){const w=waiters.splice(i,1)[0];clearTimeout(w.timer);w.resolve(m);}else inbox.push(m);});
const next=(pred,timeout=30000)=>new Promise((resolve,reject)=>{const i=inbox.findIndex(pred);if(i>=0)return resolve(inbox.splice(i,1)[0]);const w={pred,resolve,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(w),1);reject(new Error('Socket timeout'));},timeout)};waiters.push(w);});
const send=m=>ws.send(JSON.stringify({car:'mini',name:'motion control host',...m}));
try {
 const hello=await next(m=>m.type==='hello');id=hello.id;
 const map=hello.maps.find(m=>m.id===(process.env.MOTION_MAP||'megara'))||(!process.env.MOTION_MAP&&hello.maps[0]);
 if(!map)throw new Error('Requested motion-proof map is unavailable');
 const event=map.events.find(e=>e.dir>0);
 console.log('PROOF MAP',map.id,'URL',base);
 send({type:'create',private:true,lobbyName:'motion clock control',mapId:map.id,eventId:event.id});await next(m=>m.type==='lobby');
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/home/dev/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader-webgl','--disable-dev-shm-usage']});
 const ctx=await browser.newContext({viewport:{width:512,height:384}});
 if(process.env.MOTION_TIMELINE){const source=await readFile(process.env.MOTION_TIMELINE,'utf8');timelineHash=createHash('sha256').update(source).digest('hex');await ctx.route('**/src/remote-timeline.js*',route=>route.fulfill({status:200,contentType:'text/javascript',body:source}));}
 page=await ctx.newPage();page.setDefaultTimeout(180000);
 page.on('pageerror',e=>errors.push(e.stack));
 await page.addInitScript(()=>{
  window.__motionFrames=[];window.__motionHooks=[];window.__motionArrivals=[];
  const raf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=cb=>raf(timestamp=>{
   if(cb.name!=='frame'||!window.__motionCapture)return cb(timestamp);
   const now=performance.now(), before=window.__motionHooks.length;cb(timestamp);const end=performance.now();
   const remote=window.__onlineCars?.().find(c=>c.id===window.__motionId),local=window.__sim?.player?.veh;
   if(!remote||!local)return;
   const peer=__multiplayer.peers.get(__motionId),t=peer?.timeline,last=t?.samples.at(-1),first=t?.samples[0];
   __motionFrames.push({now,end,wallNow:Date.now(),rafTimestamp:timestamp,physicsDt:__sim.G.lastDt,localS:local.s,localX:local.x,localZ:local.z,localVelocity:local.vLong,remoteS:remote.s,authoritativeS:peer?.state.s,hooks:__motionHooks.length-before,playhead:t?.playhead,delay:t?.delay,offset:t?.offset,first:first?.time,latest:last?.time,bufferCount:t?.samples.length,latestArrival:last?.receivedAt,mode:t?.mode,resetCount:t?.resetCount,recovering:t?.recovering,hidden:document.hidden});
  });
 });
 await page.goto(base+'/?map='+map.id+'&quality=low&simhook=1&debug=1&quick=1&motion-control=1',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__multiplayer?.loaded&&window.__sim?.player,null,{polling:100,timeout:300000});
 await page.evaluate(()=>__multiplayer.open());await page.waitForFunction(()=>__multiplayer.connected,null,{polling:100});
 await page.locator('#mp-code').fill(lobby.code);await page.locator('#mp-join-form button').click({force:true});
 await page.waitForFunction(()=>__multiplayer.worldReady&&__multiplayer.active,null,{polling:100});
 const points=await page.evaluate(()=>Array.from({length:4001},(_,s)=>{const r=__sim.route,u=r.laneU(s,0),p=r.point(s,u);return{x:p.x,y:p.y,z:p.z,u,yaw:-r.heading(s)}}));
 send({type:'options',traffic:false});await next(m=>m.type==='lobby'&&!m.lobby.traffic&&m.lobby.players.every(p=>!p.ready));
 send({type:'ready',ready:true,version:map.track.version});await page.evaluate(()=>__multiplayer.send({type:'ready',ready:true,mapId:__multiplayer.mapId,version:__multiplayer.trackVersion}));
 await next(m=>m.type==='lobby'&&m.lobby.players.length===2&&m.lobby.players.every(p=>p.ready));send({type:'start'});
 await next(m=>m.type==='lobby'&&m.lobby.status==='race');await page.waitForFunction(()=>__sim.G.state==='race',null,{polling:100});
 start=performance.now();sender=new StateSender(packet=>{packets.push({at:performance.now()-start,samples:packet.states?.map(s=>({sampleTime:s.sampleTime,s:s.s,sampleAge:s.sampleAge}))});send(packet);});
 sampler=setInterval(()=>{const s=lobby.event.s0+20+(performance.now()-start)*.02,i=Math.floor(s),t=s-i,a=points[i],b=points[i+1];if(!a||!b)return;const state={s,gear:2,vLong:20,vLat:0,steer:0,rpm:3000,damage:{front:0,rear:0,left:0,right:0},reverse:false};for(const k of ['x','y','z','u','yaw'])state[k]=a[k]+(b[k]-a[k])*t;sender.sample(state,lobby.raceId,{batching:true});},10);
 await page.evaluate(async id=>{
  window.__motionId=id;const module=await import('/src/remote-timeline.js');
  const push=module.RemoteTimeline.prototype.push;
  module.RemoteTimeline.prototype.push=function(state,meta){const previous=this.samples.at(-1),offset=this.offset,result=push.call(this,state,meta);__motionArrivals.push({...meta,wallNow:Date.now(),s:state.s,source:state.sampleTime,accepted:result,reset:result&&!!previous&&this.samples.length===1,offsetBefore:offset,offsetAfter:this.offset});return result;};
  const original=__multiplayer.hooks.remote;
  __multiplayer.hooks.remote=function(peers,dt){original.call(this,peers,dt);const now=performance.now(),p=peers.get(id),t=p?.timeline,last=t?.samples.at(-1);__motionHooks.push({now,dt,s:__onlineCars().find(c=>c.id===id)?.s,localS:__sim.player.veh.s,playhead:t?.playhead,latest:last?.time,delay:t?.delay,offset:t?.offset,mode:t?.mode,recovering:t?.recovering});};
  __multiplayer.spectating=()=>__multiplayer.lobby.players.find(p=>p.id===id);__multiplayer.hidePanel();
  // Local-car control: the real player Vehicle and model follow the same constant
  // 20m/s route fixture, using the game's physics dt (including its .5s cap).
  // This avoids acceleration, steering and collision noise in the clock control.
  const v=__sim.player.veh,start=__multiplayer.lobby.event.s0+20;v.reset(start,__sim.route.laneU(start,0),20);
  v.update=function(dt){this.s+=20*dt;const r=__sim.route;this.u=r.laneU(this.s,0);const p=r.point(this.s,this.u);this.x=p.x;this.y=p.y;this.z=p.z;this.yaw=-r.heading(this.s);this.vLong=20;this.vLat=0;this.rpm=3000;};
 },id);
 await sleep(4000);await page.evaluate(()=>{__motionFrames.length=0;__motionHooks.length=0;__motionArrivals.length=0;window.__motionCapture=true;});
 console.log('CAPTURE START');
 await sleep(+(process.env.MOTION_SECONDS||22)*1000);
 await page.evaluate(()=>{window.__motionCapture=false;});
 const data=await page.evaluate(()=>({frames:__motionFrames,hooks:__motionHooks,arrivals:__motionArrivals,state:__sim.G.state,error:document.querySelector('#err')?.textContent,renderInfo:__renderInfo()}));
 // Screenshots follow the measurement so readback cannot change measured frame dt.
 const strip=[];for(let i=0;i<4;i++){const pose=await page.evaluate(()=>({clock:performance.now(),remote:__onlineCars().find(c=>c.id===__motionId)?.s,local:__sim.player.veh.s}));await page.screenshot({path:resolve(out,`frame-${i}.png`)});strip.push({file:`frame-${i}.png`,...pose});if(i<3)await sleep(350);}
 function metric(values){const mean=values.reduce((a,b)=>a+b,0)/values.length;return{count:values.length,mean,min:Math.min(...values),max:Math.max(...values),cv:Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length)/Math.abs(mean)};}
 const speeds=data.frames.slice(1).map((f,i)=>{const prev=data.frames[i],dt=(f.now-prev.now)/1000,endDt=(f.end-prev.end)/1000;return{dt,local:(f.localS-prev.localS)/dt,remote:(f.remoteS-prev.remoteS)/dt,remoteEndClock:(f.remoteS-prev.remoteS)/endDt,simulationExpected:20*Math.min(dt,.5)/dt};});
 const hookSpeeds=[];
 let previous=data.hooks[0];for(const f of data.hooks.slice(1)){const dt=(f.now-previous.now)/1000;if(dt<.01)continue;hookSpeeds.push({local:(f.localS-previous.localS)/dt,remote:(f.s-previous.s)/dt});previous=f;}
 const report={url:base,timelineOverride:process.env.MOTION_TIMELINE||null,timelineHash,proof:'one real LOW512x384 WebGL receiver; Node 10Hz samples/5Hz batching; once-per-rAF measurement with performance.now callback-start clock; real local-player model uses constant20m/s route fixture advanced by game physics dt',frames:data.frames.length,remote:metric(speeds.map(s=>s.remote)),local:metric(speeds.map(s=>s.local)),remoteEndClock:metric(speeds.map(s=>s.remoteEndClock)),physicsDtCapControl:metric(speeds.map(s=>s.simulationExpected)),renderDt:metric(speeds.map(s=>s.dt)),hooks:{remote:metric(hookSpeeds.map(s=>s.remote)),local:metric(hookSpeeds.map(s=>s.local))},underrunCalls:data.hooks.filter(f=>f.playhead>f.latest).length,freezeCalls:data.hooks.filter(f=>f.mode==='freeze'||f.playhead-f.latest>=120).length,resets:data.arrivals.filter(a=>a.reset).length,rate:packets.length/((performance.now()-start)/1000),strip,errors,data,packets};
 await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,data:undefined,packets:undefined},null,2));
} finally {
 clearInterval(sampler);sender?.reset();
 if(ws.readyState===1)send({type:'leave'});
 if(page)await page.evaluate(()=>{if(window.__multiplayer?.active)__multiplayer.send({type:'leave'});}).catch(()=>{});
 ws.close();for(const w of waiters)clearTimeout(w.timer);await browser?.close();
}
