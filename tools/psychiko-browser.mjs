// Repository browser workflow: run through tools/browser-slot.sh.
import { createGameServer } from '../server/index.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.scratch/psychiko');await mkdir(out,{recursive:true});
const pw=await import(pathToFileURL('/tmp/pw/node_modules/playwright/index.mjs').href);
const app=await createGameServer({dataDir:resolve(out,'browser-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await pw.chromium.launch({headless:true,executablePath:resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),report={errors:[],shots:[],captureMethod:'Native game-canvas PNG at fixed camera poses'};
page.on('pageerror',e=>{report.errors.push(String(e));console.error('PAGEERROR',String(e));});
page.on('response',r=>{if(r.status()>=400)console.error('HTTP',r.status(),r.url());});
page.on('console',m=>console.log('CONSOLE',new Date().toISOString(),m.type(),m.text().slice(0,400)));
const bakeRoot=resolve(out,'browser-bake');
if(existsSync(resolve(bakeRoot,'data/maps/psychiko/map.json'))){
 const baked=JSON.parse(await readFile(resolve(bakeRoot,'data/maps/psychiko/map.json'),'utf8'));
 if(baked.bakedWorld){await page.route('**/data/maps/psychiko/map.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(baked)}));await page.route('**/data/baked/**',r=>r.fulfill({path:resolve(bakeRoot,new URL(r.request().url()).pathname.slice(1)),contentType:'application/octet-stream'}));report.terrainSource='current deterministic baked buffers';console.log('USING BAKED REVIEW BUFFERS');}
}
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__freezePsychiko&&cb.name==='frame'?0:raf(cb);});
const shot=async name=>{
 const encoded=await page.evaluate(()=>{__sim.render();return __sim.canvas.toDataURL('image/png').split(',')[1];});
 await writeFile(resolve(out,name+'.png'),Buffer.from(encoded,'base64'));
 report.shots.push(name);console.log('SCREENSHOT',name);
};
try{
 const url=`http://127.0.0.1:${app.server.address().port}`;console.log('URL',url);await writeFile(resolve(out,'browser-url.txt'),url);
 await page.goto(url+'/?menu&simhook&fixeddt&map=psychiko&car=z4&debug',{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>document.body.classList.contains('loaded'),null,{timeout:600000});
 await page.evaluate(()=>{window.__freezePsychiko=true;__flow.menu.show('maps',{mode:'sprint'});});
 await page.locator('.track-pin[data-map-id=psychiko]').waitFor({state:'visible'});report.catalogue=await page.locator('.track-pin').count();assert.equal(report.catalogue,4);
 await page.evaluate(()=>{__flow.menu.hide();__flow.startEvent('psychiko-race');});
 await page.waitForFunction(()=>__game.state==='countdown',null,{timeout:600000});
 await page.evaluate(()=>{__game.countWall=performance.now()-5000;__game.cam=__game.userCam='chase';__sim.step(90);__sim.render();});
 report.race=await page.evaluate(()=>({map:__flow.mapId,event:__flow.event().def.id,rivals:__flow.grid.length,laps:__flow.event().r.laps,roadworks:__sim.scene.getObjectByName('race-roadworks').visible,trafficDisabled:__sim.traffic.disabled}));
 assert.equal(report.race.map,'psychiko');assert.equal(report.race.rivals,2);assert.equal(report.race.laps,2);assert.equal(report.race.roadworks,true);
 for(const time of ['afternoon','night'])for(const pose of ['start','mid'])for(const cam of ['chase','cockpit']){
  await page.evaluate(({time,pose,cam})=>{__setConditions({time,weather:'clear'});__game.state='race';if(__game.cam!==cam)__flow.action('camera');__game.run=null;__game.state='loading';__sim.cameraBlend.active=false;Object.assign(__sim.look,{yaw:0,pitch:0,targetYaw:0,targetPitch:0,back:0,yawV:0,pitchV:0});__sim.player.veh.reset(pose==='start'?10:2900,0,0);__sim.cameraBlend.active=false;__sim.step(60);__sim.render();},{time,pose,cam});
  await shot(`${time}-${pose}-${cam}`);
  if(time==='afternoon'&&pose==='mid'&&cam==='chase'){const data=await page.evaluate(()=>{__sim.render();return __sim.canvas.toDataURL('image/webp',.85).split(',')[1];});await mkdir(resolve(root,'assets/changelog/2026.10.16.1'),{recursive:true});await writeFile(resolve(root,'assets/changelog/2026.10.16.1/psychiko.webp'),Buffer.from(data,'base64'));}
 }
 for(const time of ['afternoon','night']){
  report.overview=await page.evaluate(time=>{__setConditions({time,weather:'clear'});const {camera,route,render}=__sim;const p=route.point(2900,0);camera.position.set(p.x+900,p.y+1500,p.z+1200);camera.far=15000;camera.updateProjectionMatrix();camera.lookAt(p.x,p.y,p.z);camera.updateMatrixWorld(true);render();return window.__renderInfo?.();},time);
  await shot(`${time}-overview`);
 }
 await page.evaluate(()=>__flow.startEvent(__flow.freeRoamDef()));await page.waitForFunction(()=>__flow.event()?.def.type==='free'&&__game.state==='race',null,{timeout:60000});
 report.free=await page.evaluate(()=>{__game.countWall=performance.now()-5000;__sim.step(180);return {roadworks:__sim.scene.getObjectByName('race-roadworks').visible,trafficDisabled:__sim.traffic.disabled,traffic:__sim.traffic.cars.filter(c=>c.active).length,police:!!window.__police};});
 assert.equal(report.free.roadworks,false);assert.equal(report.free.trafficDisabled,false);assert(report.free.traffic>0);
 assert.deepEqual(report.errors,[]);console.log('PASS',JSON.stringify(report));
}catch(error){report.failure=String(error);try{report.loading=await page.evaluate(()=>({state:window.__game?.state,map:window.__flow?.mapId,phase:document.getElementById('lstat')?.textContent,sim:!!window.__sim}));console.error('DIAGNOSTIC',JSON.stringify(report.loading));}catch{}throw error;}finally{await writeFile(resolve(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();await app.close();}
