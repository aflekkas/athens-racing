// Run with tools/browser-slot.sh node tools/phone-wheel-browser.mjs [ROOT] [OUT].
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]||'.'),out=resolve(process.argv[3]||'.scratch/phone-wheel');await fs.mkdir(out,{recursive:true});
const {createGameServer}=await import(pathToFileURL(resolve(root,'server/index.mjs')));
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});
const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.bin':'application/octet-stream','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.wav':'audio/wav','.mp3':'audio/mpeg','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(path.startsWith('/api/')||path==='/health'||path==='/wheel')return app.server.emit('request',req,res);try{let file=resolve(root,'.'+(path==='/'?'/index.html':path));if(path.startsWith('/vendor/'))file=resolve(root,'node_modules/three',path.slice(8));let body=await fs.readFile(file);if(file.endsWith('index.html'))body=Buffer.from(body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/vendor/'));res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}});
server.on('upgrade',(...args)=>app.server.emit('upgrade',...args));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/pw/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const desktop=await browser.newContext({viewport:{width:1280,height:800}}),mobile=await browser.newContext({viewport:{width:844,height:390},screen:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1});
const page=await desktop.newPage(),phone=await mobile.newPage(),errors=[];
for(const p of [page,phone])p.on('pageerror',e=>{errors.push(e.stack);console.error('PAGEERROR',e.stack);});
// Rendering is intentionally frozen and the other device may own the visible surface.
for(const p of [page,phone]){const wait=p.waitForFunction.bind(p);p.waitForFunction=(predicate,arg,options={})=>wait(predicate,arg,{polling:50,...options});}
// Freeze expensive race RAF only. Physics is stepped through the game's existing sim hook.
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>['frame','onAnimationFrame'].includes(cb.name)?0:raf(cb);});
await mobile.addInitScript(()=>{window.__permissionCalls=[];DeviceOrientationEvent.requestPermission=async()=>{__permissionCalls.push(navigator.userActivation.isActive);return window.__allowMotion?'granted':'denied';};Object.defineProperty(screen.orientation,'angle',{get:()=>90});});
let buddy;
const report={base,latencyKind:'application round-trip time, same-machine LAN loopback',errors};
try {
  await page.goto(base+'/?menu&simhook&debug&quality=potato&notraffic&car=mini&map=megara',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.__flow?.menu&&document.body.classList.contains('loaded'),null,{timeout:300000});
  await page.waitForSelector('[data-title-hero][data-ready=true]',{timeout:120000});
  await page.evaluate(()=>__flow.menu.show('settings',{tab:'controls'},true));
  await page.locator('[data-act="phoneWheel"]').click();
  await page.waitForSelector('.wheel-pair-code');await page.waitForTimeout(250);
  if (!process.env.PHONE_WHEEL_SKIP_CAPTURE) await page.screenshot({timeout:120000,animations:'disabled',path:resolve(out,'pairing-1280.png')});
  const code=(await page.locator('.wheel-pair-code').textContent()).trim();report.codeLength=code.length; console.log('Pairing captured');
  await phone.goto(base+'/wheel?c='+code);
  for (const p of [page,phone]) await p.evaluate(async()=>{const {WheelLink}=await import('/src/phone-wheel-link.js');const original=WheelLink.prototype.status;window.__wheelStatus=[];window.__wheelPings=[];const originalData=WheelLink.prototype.data;WheelLink.prototype.data=function(data){const pong=this.pendingPings.has(data?.pong),transport=this.channel?.readyState==='open'?'P2P':'WebSocket';originalData.call(this,data);if(pong&&window.__wheelMeasure)__wheelPings.push({phase:__wheelMeasure,transport,ms:this.latency});};WheelLink.prototype.status=function(...args){original.apply(this,args);window.__wheelLink=this;__wheelStatus.push({t:performance.now(),transport:this.channel?.readyState==='open'?'P2P':'WebSocket',latency:this.latency,state:this.state});};});
  await phone.locator('[data-act="start"]').click();
  await phone.waitForFunction(()=>document.querySelector('#wheel-error').textContent.includes('permission denied'));
  report.permissionDeniedShown=true;
  await phone.evaluate(()=>window.__allowMotion=true);
  await phone.locator('[data-act="start"]').click();
  await phone.waitForFunction(()=>document.querySelector('#wheel-status').textContent.includes('Connected'),null,{timeout:20000});
  assert.deepEqual(await phone.evaluate(()=>__permissionCalls),[true,true]);
  await phone.waitForTimeout(700);
  report.permissionFlow={calls:await phone.evaluate(()=>__permissionCalls)};
  console.log('P2P connected'); report.p2pPhone=await phone.locator('#wheel-status').textContent();report.p2pDesktop=await page.locator('[data-wheel-status]').textContent();
  if (!process.env.PHONE_WHEEL_SKIP_CAPTURE) await phone.screenshot({timeout:120000,animations:'disabled',path:resolve(out,'controller-844x390.png')});
  await phone.evaluate(async()=>{if(document.fullscreenElement)await document.exitFullscreen();});
  await phone.setViewportSize({width:1180,height:820});if (!process.env.PHONE_WHEEL_SKIP_CAPTURE) await phone.screenshot({timeout:120000,animations:'disabled',path:resolve(out,'controller-tablet-1180x820.png')});
  await phone.setViewportSize({width:390,height:844});if (!process.env.PHONE_WHEEL_SKIP_CAPTURE) await phone.screenshot({timeout:120000,animations:'disabled',path:resolve(out,'controller-390x844.png')});
  await phone.setViewportSize({width:844,height:390});
  // Use the real game's car and Input, with rendering paused for repeatability.
  await page.evaluate(async()=>{await __flow.switchMap('megara');await __flow.startEvent(__flow.freeRoamDef());});
  console.log('World loaded');
  await page.waitForFunction(()=>window.__sim?.step&&window.__vehicle?.(),null,{timeout:300000});
  await page.evaluate(()=>{__flow.menu.hide();__game.state='race';__game.paused=null;__sim.G.trafficMul=0;__sim.traffic.disabled=true;const v=__vehicle();v.reset(v.s,v.u,12);});
  report.visibility={desktop:await page.evaluate(()=>document.hidden),phone:await phone.evaluate(()=>document.hidden)};
  await phone.evaluate(()=>{window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{beta:0,gamma:-80,alpha:0}));});
  await phone.locator('[data-act="calibrate"]').click();
  const pedal=await phone.locator('[data-pedal="throttle"]').boundingBox();
  await phone.touchscreen.tap(pedal.x+pedal.width/2,pedal.y+8);
  // Keep a synthetic touch pointer down so pedal pressure remains analog.
  await phone.evaluate(()=>{const el=document.querySelector('[data-pedal="throttle"]'),r=el.getBoundingClientRect();el.setPointerCapture=()=>{};el.dispatchEvent(new PointerEvent('pointerdown',{pointerId:31,clientY:r.top+r.height*.15,bubbles:true}));});
  for(let i=0;i<20;i++){await phone.evaluate(()=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{beta:38,gamma:-80,alpha:0})));await phone.waitForTimeout(16);}
  await page.waitForFunction(async()=>{const {input}=await import('/src/input.js');return input.phoneWheel.sample().steer>.2;},null,{timeout:15000});
  await phone.evaluate(()=>window.dispatchEvent(new Event('orientationchange')));
  await phone.waitForTimeout(30);
  assert.ok(parseFloat(await phone.locator('#wheel-steer').textContent())>20,'viewport rotation preserves calibrated wheel angle');
  console.log('Car ready'); report.before=await page.evaluate(()=>{const v=__vehicle();return{x:v.x,z:v.z,yaw:v.yaw};});
  const trace=[];
  for(let i=0;i<30;i++){trace.push(await page.evaluate(()=>{__sim.step(1,1/60);const v=__vehicle();return{steer:__sim.input.steer,throttle:__sim.input.throttle,x:v.x,z:v.z,yaw:v.yaw};}));await phone.waitForTimeout(16);}
  report.trace=trace;report.after=trace.at(-1);assert.ok(trace.some(t=>t.steer>.25),'synthetic tilt reaches game Input');assert.ok(trace.some(t=>t.throttle>.8),'analog phone pedal reaches game Input');
  assert.ok(Math.hypot(report.after.x-report.before.x,report.after.z-report.before.z)>.1,'real car moves');assert.ok(Math.abs(report.after.yaw-report.before.yaw)>.01,'real car turns');

  // Negotiate again if loading/screenshots stalled the first direct link, then measure without rendering work.
  await page.evaluate(()=>{__wheelLink.dropPeer();__wheelLink.candidates=[];});
  await phone.evaluate(async()=>{const {WheelLink}=await import('/src/phone-wheel-link.js');window.__originalSend=WheelLink.prototype.send;__wheelLink.dropPeer();__wheelLink.candidates=[];await __wheelLink.startPeer();});
  await phone.waitForFunction(()=>document.querySelector('#wheel-status').textContent.includes('P2P'),null,{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('.wheel-hud').textContent.includes('P2P'),null,{timeout:20000});
  for(const p of [page,phone])await p.evaluate(()=>window.__wheelMeasure='P2P');
  await phone.waitForTimeout(5000);
  for(const p of [page,phone])await p.evaluate(()=>window.__wheelMeasure=false);
  // Force genuine RTC failure at both endpoints; existing WebSocket takes over.
  await phone.evaluate(async()=>{const {WheelLink}=await import('/src/phone-wheel-link.js');WheelLink.prototype.send=function(data){if(this.pc)this.dropPeer();return __originalSend.call(this,data);};});
  await phone.waitForFunction(()=>document.querySelector('#wheel-status').textContent.includes('WebSocket'),null,{timeout:6000});await phone.waitForTimeout(1000);
  await page.waitForFunction(()=>document.querySelector('.wheel-hud').textContent.includes('WebSocket'),null,{timeout:10000});
  for(const p of [page,phone])await p.evaluate(()=>window.__wheelMeasure='WebSocket');
  await phone.waitForTimeout(3000);
  for(const p of [page,phone])await p.evaluate(()=>window.__wheelMeasure=false);
  report.relayPhone=await phone.locator('#wheel-status').textContent();report.relayDesktop=await page.locator('.wheel-hud').textContent();
  await page.evaluate(()=>__sim.step(1,1/60));assert.ok((await page.evaluate(()=>__sim.input.throttle))>.8,'relay maintains input');
  await page.evaluate(()=>{window.__mpTrace=[];__multiplayer.ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.type==='error'||m.type==='lobby'){__mpTrace.push({type:m.type,message:m.message,status:m.lobby?.status,players:m.lobby?.players?.map(p=>({id:p.id,connected:p.connected,ready:p.ready,loaded:p.loaded}))});if(__mpTrace.length>30)__mpTrace.shift();}});});
  // Online uses the same phone source: a second driver joins through the real lobby protocol.
  await page.evaluate(()=>__multiplayer.createLobby({private:true,mapId:'megara',config:{traffic:0,police:false,rivals:0}}));
  await page.waitForFunction(()=>__multiplayer.lobby?.status==='waiting'&&__multiplayer.worldReady&&__multiplayer.me?.loaded,null,{timeout:120000});
  const lobby=await page.evaluate(()=>({code:__multiplayer.lobby.code,version:__multiplayer.lobby.track.version}));
  const buddyMessages=[];buddy=new WebSocket(base.replace('http:','ws:')+'/ws?protocol='+MULTIPLAYER_PROTOCOL);buddy.on('message',data=>buddyMessages.push(JSON.parse(data)));
  await new Promise((r,j)=>{buddy.once('open',r);buddy.once('error',j);});
  buddy.send(JSON.stringify({type:'join',code:lobby.code,name:'WHEEL TEST',car:'mini'}));
  await page.waitForFunction(()=>__multiplayer.lobby.players.length===2);
  buddy.send(JSON.stringify({type:'ready',ready:true,mapId:'megara',version:lobby.version}));
  await page.waitForFunction(()=>__multiplayer.lobby.players.every(p=>p.loaded));
  await page.evaluate(()=>{window.__clockAck=false;const sent=Date.now();const handler=event=>{const m=JSON.parse(event.data);if(m.type==='pong'&&m.sent===sent){window.__clockAck=true;__multiplayer.ws.removeEventListener('message',handler);}};__multiplayer.ws.addEventListener('message',handler);__multiplayer.send({type:'ping',sent});});
  await page.waitForFunction(()=>window.__clockAck);
  report.forceStart=await page.evaluate(()=>({result:__multiplayer.startRace({force:true}),host:__multiplayer.lobby.host,id:__multiplayer.id,status:__multiplayer.lobby.status,players:__multiplayer.lobby.players}));console.log('FORCE START',JSON.stringify(report.forceStart));
  await page.waitForFunction(()=>__multiplayer.lobby.status==='race'&&__multiplayer.now()>=__multiplayer.lobby.startAt,null,{timeout:20000});
  await page.evaluate(()=>{__multiplayer.close();__flow.menu.hide();__game.state='race';__game.paused=null;const v=__vehicle();v.reset(v.s,v.u,12);__multiplayer.stateSender.discontinuity();});
  for(let i=0;i<20;i++){await phone.evaluate(()=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{beta:-38,gamma:-80,alpha:0})));await phone.waitForTimeout(16);}
  const onlineBefore=await page.evaluate(()=>({x:__vehicle().x,z:__vehicle().z,yaw:__vehicle().yaw}));
  const onlineTrace=[];
  for(let i=0;i<30;i++){onlineTrace.push(await page.evaluate(()=>{__sim.step(1,1/60);const v=__vehicle();return{x:v.x,z:v.z,yaw:v.yaw,steer:__sim.input.steer,throttle:__sim.input.throttle};}));await phone.waitForTimeout(16);}
  const onlineAfter=onlineTrace.at(-1);assert.ok(onlineTrace.some(t=>t.steer<-.25&&t.throttle>.8));assert.ok(Math.hypot(onlineAfter.x-onlineBefore.x,onlineAfter.z-onlineBefore.z)>.1);assert.ok(Math.abs(onlineAfter.yaw-onlineBefore.yaw)>.01);
  const host=await page.evaluate(()=>__multiplayer.id);report.online={before:onlineBefore,after:onlineAfter,guestSawPhoneCar:buddyMessages.some(m=>m.type==='snapshot'&&m.players.some(p=>p.id===host&&p.state&&Number.isFinite(p.state.x)))};assert.ok(report.online.guestSawPhoneCar);
  console.log('Solo and multiplayer steering verified');
  report.hudLayout=await page.evaluate(()=>{const a=document.querySelector('.wheel-hud').getBoundingClientRect(),b=document.querySelector('#race-settings').getBoundingClientRect();return{clear:a.bottom<=b.top||a.top>=b.bottom||a.right<=b.left||a.left>=b.right,top:a.top,right:a.right,width:a.width};});assert.ok(report.hudLayout.clear,'phone latency stays clear of Settings');
  if (!process.env.PHONE_WHEEL_SKIP_CAPTURE) await page.evaluate(()=>__sim.render());if (!process.env.PHONE_WHEEL_SKIP_CAPTURE) await page.screenshot({timeout:120000,animations:'disabled',path:resolve(out,'car-phone-steering.png')});
  // Sender starvation: do not close the link, prove held axes then safe timeout.
  await phone.evaluate(async()=>{const {WheelLink}=await import('/src/phone-wheel-link.js');WheelLink.prototype.send=function(data){if(!(data instanceof ArrayBuffer))return __originalSend.call(this,data);};});
  await page.waitForTimeout(80);report.held=await page.evaluate(()=>{__sim.step(1,1/60);return{...__sim.input};});assert.ok(report.held.throttle>.8);
  await page.waitForTimeout(220);report.safe=await page.evaluate(()=>{__sim.step(1,1/60);return{...__sim.input};});assert.equal(report.safe.steer,0);assert.equal(report.safe.throttle,0);assert.equal(report.safe.brake,0);
  await phone.locator('[data-act="unpair"]').click();await page.waitForFunction(()=>document.querySelector('.wheel-hud').hidden);
  report.pings=[...await page.evaluate(()=>__wheelPings),...await phone.evaluate(()=>__wheelPings)];
  report.latency={};for(const type of ['P2P','WebSocket']){const values=report.pings.filter(p=>p.phase===type&&p.transport===type).map(p=>p.ms).sort((a,b)=>a-b);assert.ok(values.length>=4,type+' latency samples');report.latency[type]={samples:values.length,min:values[0],p50:values[Math.floor(values.length*.5)],p95:values[Math.min(values.length-1,Math.floor(values.length*.95))],max:values.at(-1)};}
  assert.deepEqual(errors,[]);report.pass=true;
} finally {
  report.mpTrace=await page.evaluate(()=>window.__mpTrace||[]).catch(()=>[]);
  report.desktopEvents=await page.evaluate(()=>window.__wheelStatus||[]).catch(()=>[]);report.phoneEvents=await phone.evaluate(()=>window.__wheelStatus||[]).catch(()=>[]);
  await fs.writeFile(resolve(out,'browser-report.json'),JSON.stringify(report,null,2));buddy?.terminate();await browser.close();await app.close();await new Promise(r=>server.close(r));
}
console.log(JSON.stringify({pass:report.pass,latency:report.latency,solo:report.after,online:report.online,errors},null,2));

// Assertions and explicit browser/server cleanup are complete; do not retain driver handles.
process.exit(0);
