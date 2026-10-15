// Run through tools/browser-slot.sh. Deterministic controls in the real Riviera game.
import {resolve} from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createGameServer} from '../server/index.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/pw/node_modules/playwright/index.mjs');
const root=resolve(new URL('../',import.meta.url).pathname),phase=process.argv[2]||'before',out=resolve('.scratch/bus-suspension',phase);await fs.mkdir(out,{recursive:true});
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>{errors.push(e.stack);console.log('PAGEERROR',e.stack);});page.on('console',m=>console.log('BROWSER',m.text()));page.setDefaultTimeout(240000);
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async r=>r.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',r.request().url().split('three@0.170.0/')[1])),contentType:'text/javascript'}));
if(phase==='before')for(const name of ['cars','physics'])await page.route('**/src/'+name+'.js',async r=>r.fulfill({body:await fs.readFile(resolve(root,'.scratch/bus-suspension/'+name+'-before.js')),contentType:'text/javascript'}));
await page.route('**/src/physics-baseline.js',async r=>r.fulfill({body:await fs.readFile(resolve(root,'.scratch/bus-suspension/physics-before.js')),contentType:'text/javascript'}));
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__holdFrame&&cb.name==='frame'?0:raf(cb);});
let captureOut=out;
async function shot(name){const data=await page.evaluate(()=>{__sim.render();return __sim.canvas.toDataURL('image/png').split(',')[1];});await fs.writeFile(resolve(captureOut,name+'.png'),Buffer.from(data,'base64'));await fs.writeFile(resolve(captureOut,name+'.view.json'),JSON.stringify(await page.evaluate(()=>({camera:__sim.camera.position.toArray(),quaternion:__sim.camera.quaternion.toArray(),body:__sim.player.model.root.position.toArray(),pose:__sim.player.veh.pose,s:__sim.player.veh.s,u:__sim.player.veh.u,conditions:window.__conditions()})),null,2));}
try{
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&car=bus&event=free&quality=low&fixedres&map=riviera&notraffic`,{waitUntil:'domcontentloaded'});
 console.log('NAVIGATED');await page.waitForFunction(()=>document.body.classList.contains('loaded'));console.log('LOADED');await page.evaluate(()=>window.__holdFrame=true);
 await page.waitForFunction(()=>__sim?.player?.spec.id==='bus');
 await page.evaluate(()=>{__flow.menu.hide();__game.state='race';__game.paused=null;window.__busStart=__sim.player.veh.s;window.__busRows=[];const v=__sim.player.veh,update=v.update;window.__busInput={throttle:0,brake:0,steer:0};v.update=function(dt){return update.call(this,dt,window.__busInput);};});
 async function drive(cams=['chase','cockpit'],scenarios=['launch','cruise50','cruise80','braking','lane-change','junction-turn','kerb','bump']){
 for(const cam of cams){
  for(const scenario of scenarios){
   await page.evaluate(({cam,scenario})=>{
    const v=__sim.player.veh;__sim.keys.clear();if(__game.cam!==cam)__flow.action('camera');__game.cam=cam;__game.state='race';__game.autodrive=false;
    const speed=scenario==='launch'?0:scenario==='cruise80'?80:scenario==='junction-turn'?15:scenario==='kerb'||scenario==='bump'?25:50;
    v.reset(scenario==='junction-turn'?(__sim.signals.J.find(j=>j.sides.R!==null)?.s||__busStart+150)-12:__busStart+120,scenario==='kerb'?__sim.route.edge(__busStart+120)-1.5:__sim.route.laneU(__busStart+120,0),speed/3.6);v.gear=speed>40?3:1;v.syncWheels();window.__busYaw=v.yaw;window.__busJ=__sim.signals.J.find(j=>j.sides.R!==null);window.__busH=null;
   },{cam,scenario});
   for(let block=0;block<6;block++){
    await page.evaluate(({scenario,cam,block})=>{
     const v=__sim.player.veh;
     for(let j=0;j<60;j++){
      const t=block+j/60;
      const target=scenario==='cruise80'?80:scenario==='launch'?60:scenario==='lane-change'?65:scenario==='junction-turn'?15:scenario==='kerb'||scenario==='bump'?25:50;
      const route=__sim.route,look=Math.max(12,v.speed*.9),lane=route.laneU(v.s,0);
      const offset=scenario==='lane-change'?(t<1?0:t<3?3.2*Math.sin((t-1)*Math.PI/4)**2:3.2):0;
      const u=scenario==='kerb'?route.edge(v.s)+.5:lane+offset;
      const p=route.point(v.s+look,u),dx=p.x-v.x,dz=p.z-v.z,lat=dx*Math.cos(v.yaw)-dz*Math.sin(v.yaw);
      let steer=v.steerInputFor(2*lat/Math.max(1,dx*dx+dz*dz),Math.max(3,v.speed));
      if(scenario==='junction-turn'){
       const turned=window.__busYaw-v.yaw;
       steer=turned<Math.PI/2?v.steerInputFor(1/12,Math.max(3,v.speed)):0;
      }
      if(scenario==='bump'){
       if(!__busH){const h=__sim.ground.humps.filter(h=>h[3]>.08&&h[3]<.25)[0]||__sim.ground.humps.slice().sort((a,b)=>a[3]-b[3])[0];if(h){window.__busH=h;const q=route.project(h[0],h[1]);v.reset(q.s,q.u,25/3.6);v.x=h[0]+Math.sin(v.yaw)*6;v.z=h[1]+Math.cos(v.yaw)*6;}}
       steer=0;
      }
      __busInput={throttle:scenario==='braking'?0:Math.max(0,Math.min(1,.3+(target-v.kmh)*.08)),brake:scenario==='braking'?1:Math.max(0,Math.min(.4,(v.kmh-target-2)*.05)),steer};
      __sim.step(1,1/60);
      __busRows.push({cam,scenario,t,gameTime:__game.t,conditions:window.__conditions(),s:v.s,u:v.u,speed:v.kmh,pitch:v.pose.pitch,roll:v.pose.roll,heave:v.pose.heave,compression:v.sus.d.slice(),tyreCompression:v.sus.r.map((r,i)=>r-v.sus.zu[i]),yaw:v.yaw,ax:v.ax,ay:v.ay,road:v.wheelBump?.slice(),load:v.corners.map(w=>w.Fz),contact:v.corners.map(w=>w.Fz>1),air:v.air});
     }
    },{scenario,cam,block});
    if(cam==='chase'&&(scenario==='kerb'?[0,2,5]:[2]).includes(block))await shot(`${scenario}-${block}`);
   }
   if(cam==='cockpit')await shot(`${scenario}-cockpit`);
   await fs.writeFile(resolve(captureOut,scenario+'-'+cam+'.json'),JSON.stringify(await page.evaluate(({scenario,cam})=>__busRows.filter(r=>r.scenario===scenario&&r.cam===cam),{scenario,cam})));
   console.log(phase,cam,scenario);
  }
 }
 }
 // Keep comparison lighting/weather fixed even while software rendering takes minutes.
 await page.evaluate(()=>{__flow.setRoamConditions({time:'day',weather:'clear'});__worldLife.world.clockDynamic=false;__worldLife.world.weatherDynamic=false;});
 await drive();
 // Exercise corridor auto recovery through the real game policy, then wait for its asynchronous placement.
 const recovery=await page.evaluate(()=>{const v=__sim.player.veh;v.reset(__busStart,__sim.route.laneU(__busStart,0));__busInput={throttle:0,brake:0,steer:0};v.x+=100000;v.z+=100000;v.y=-100;__sim.step(120,1/60);return {triggered:__game.towing};});
 await page.waitForTimeout(700);await page.evaluate(()=>{__game.cam='chase';__sim.step(120,1/60);});await shot('auto-tow');
 assert.equal(recovery.triggered,true,'outside-corridor recovery must be automatic');
 const final=await page.evaluate(()=>({s:__sim.player.veh.s,u:__sim.player.veh.u,pose:__sim.player.veh.pose,conditions:window.__conditions(),gameTime:__game.t,parameters:{mass:__sim.player.veh.m,unsprung:__sim.player.veh.mUns,tyreK:__sim.player.veh.kTyre,bars:__sim.player.veh.kBar},load:__sim.player.veh.corners.map(w=>w.Fz),towing:__game.towing}));
 assert.equal(final.towing,false);assert.ok(final.load.every(f=>f>1),'auto tow must restore four loaded patches');
 await fs.writeFile(resolve(out,'telemetry.json'),JSON.stringify(await page.evaluate(()=>__busRows)));await fs.writeFile(resolve(out,'report.json'),JSON.stringify({recovery,final,errors},null,2));assert.deepEqual(errors,[]);console.log('DONE',phase,JSON.stringify({recovery,final}));
 if(phase==='after'){
  // Same loaded world/camera/kerb, original production solver and original bus specification.
  const source=await fs.readFile(resolve(root,'.scratch/bus-suspension/cars-before.js'),'utf8');
  const oldSpec=Function('return '+source.split('export const CARS = ')[1].split('\n];')[0]+'\n];')().find(c=>c.id==='bus');
  await page.evaluate(async spec=>{const {Vehicle}=await import('/src/physics-baseline.js');const v=__sim.player.veh;Object.setPrototypeOf(v,Vehicle.prototype);v.setSpec(spec);v.update=function(dt){return Vehicle.prototype.update.call(this,dt,__busInput);};window.__busRows=[];},oldSpec);
  captureOut=resolve(out,'../matched-before');await fs.mkdir(captureOut,{recursive:true});
  await drive(['chase'],['kerb']);
  await fs.writeFile(resolve(captureOut,'telemetry.json'),JSON.stringify(await page.evaluate(()=>__busRows)));
  await fs.writeFile(resolve(captureOut,'parameters.json'),JSON.stringify(await page.evaluate(()=>({mass:__sim.player.veh.m,unsprung:__sim.player.veh.mUns,tyreK:__sim.player.veh.kTyre,bars:__sim.player.veh.kBar})),null,2));
 }
}finally{await browser.close();await app.close();}
