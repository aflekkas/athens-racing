// Repository browser workflow: run through tools/browser-slot.sh.
import { createGameServer } from '../server/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.scratch/psychiko');await mkdir(out,{recursive:true});
const pw=await import(pathToFileURL('/tmp/pw/node_modules/playwright/index.mjs').href);
const app=await createGameServer({dataDir:resolve(out,'browser-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await pw.chromium.launch({headless:true,executablePath:resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),report={errors:[],shots:[]};
page.on('pageerror',e=>{report.errors.push(String(e));console.error('PAGEERROR',String(e));});
page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text());});
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__freezePsychiko&&cb.name==='frame'?0:raf(cb);});
const shot=async name=>{await page.screenshot({path:resolve(out,name+'.png'),timeout:60000});report.shots.push(name);console.log('SCREENSHOT',name);};
try{
 const url=`http://127.0.0.1:${app.server.address().port}`;console.log('URL',url);await writeFile(resolve(out,'browser-url.txt'),url);
 await page.goto(url+'/?menu&simhook&fixeddt&map=psychiko&car=z4',{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>document.body.classList.contains('loaded'),null,{timeout:600000});
 await page.evaluate(()=>{window.__freezePsychiko=true;__flow.menu.show('maps',{mode:'sprint'});});
 await page.locator('.track-pin[data-map-id=psychiko]').waitFor({state:'visible'});await shot('catalogue');
 await page.evaluate(()=>{__flow.menu.hide();__flow.startEvent('psychiko-race');});
 await page.waitForFunction(()=>__game.state==='countdown',null,{timeout:60000});
 await page.evaluate(()=>{__game.countWall=performance.now()-5000;__game.cam=__game.userCam='chase';__sim.step(90);__sim.render();});
 report.race=await page.evaluate(()=>({map:__flow.mapId,event:__flow.event().def.id,rivals:__flow.grid.length,roadworks:__sim.scene.getObjectByName('race-roadworks').visible,trafficDisabled:__sim.traffic.disabled}));
 assert.equal(report.race.map,'psychiko');assert.equal(report.race.rivals,2);assert.equal(report.race.roadworks,true);
 for(const time of ['afternoon','night'])for(const pose of ['start','mid'])for(const cam of ['chase','cockpit']){
  await page.evaluate(({time,pose,cam})=>{__setConditions({time,weather:'clear'});__game.cam=__game.userCam=cam;__sim.player.veh.reset(pose==='start'?10:2900,0,0);__sim.step(2);__sim.render();},{time,pose,cam});
  await shot(`${time}-${pose}-${cam}`);
 }
 for(const time of ['afternoon','night']){
  report.overview=await page.evaluate(time=>{__setConditions({time,weather:'clear'});const {camera,route,render}=__sim;const p=route.point(2900,0);camera.position.set(p.x+900,p.y+1500,p.z+1200);camera.far=15000;camera.updateProjectionMatrix();camera.lookAt(p.x,p.y,p.z);camera.updateMatrixWorld(true);render();return window.__renderInfo?.();},time);
  await shot(`${time}-overview`);
 }
 await page.evaluate(()=>__flow.startEvent(__flow.freeRoamDef()));await page.waitForFunction(()=>__game.state==='countdown',null,{timeout:60000});
 report.free=await page.evaluate(()=>{__game.countWall=performance.now()-5000;__sim.step(180);return {roadworks:__sim.scene.getObjectByName('race-roadworks').visible,trafficDisabled:__sim.traffic.disabled,traffic:__sim.traffic.cars.filter(c=>c.active).length,police:!!window.__police};});
 assert.equal(report.free.roadworks,false);assert.equal(report.free.trafficDisabled,false);assert(report.free.traffic>0);
 assert.deepEqual(report.errors,[]);console.log('PASS',JSON.stringify(report));
}finally{await writeFile(resolve(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();await app.close();}
