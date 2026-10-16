// Run through tools/browser-slot.sh; one browser, matched native game-camera views.
import {createGameServer} from '../server/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.scratch/psychiko-followups');
const after=JSON.parse(await readFile(resolve(root,'data/maps/psychiko/map.json'))),before=JSON.parse(await readFile(resolve(out,'before-map.json'))),samples=JSON.parse(await readFile(resolve(out,'frontages-after.json')));
for(const k of ['route','roadNetwork','roadworks'])assert.deepEqual(after[k],before[k]);
const app=await createGameServer({dataDir:resolve(out,'browser-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const {chromium}=await import(pathToFileURL('/tmp/pw/node_modules/playwright/index.mjs').href),browser=await chromium.launch({headless:true,executablePath:resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const report={errors:[],shots:[],poses:samples.map(s=>({id:s.id,street:s.street,s:s.s,centroid:s.sourceCentroid})),capture:'native game-canvas PNG; identical source camera coordinates and conditions'};
try{
 for(const [mode,data]of [['before',before],['after',after]]){
  const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();
  page.on('pageerror',e=>{report.errors.push(mode+': '+e);console.error(e);});
  page.on('console',m=>{if(m.type()==='error')console.log(mode,'console',m.text().slice(0,200));});
  await page.route('**/data/maps/psychiko/map.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({...data,bakedWorld:{version:1,compression:'gzip',terrain:'./data/baked/frontage-terrain.bin.gz',roads:'./data/baked/frontage-roads.bin.gz'}})}));
  await page.route('**/data/baked/frontage-*',r=>r.fulfill({path:resolve(out,'bake',r.request().url().includes('terrain')?'terrain.bin.gz':'roads.bin.gz'),contentType:'application/octet-stream'}));
  await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__freezeFrontages&&cb.name==='frame'?0:raf(cb);});
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&fixeddt&map=psychiko&debug`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>document.body.classList.contains('loaded'),null,{timeout:120000});
  await page.evaluate(()=>{window.__freezeFrontages=true;__flow.menu.hide();__flow.startEvent('free',{car:'z4'});});
  await page.waitForFunction(()=>__flow.mapId==='psychiko'&&__game.state==='race',null,{timeout:600000});
  await page.evaluate(()=>{__flow.setTraffic(0);__setConditions({time:'afternoon',weather:'clear'});__game.state='loading';__sim.step(1);});
  const shot=async name=>{const body=await page.evaluate(()=>{__sim.render();return __sim.canvas.toDataURL('image/png').split(',')[1];});await writeFile(resolve(out,name+'.png'),Buffer.from(body,'base64'));report.shots.push(name);console.log('SHOT',name);};
  for(const sample of samples){
   await page.evaluate(sample=>{const {route,camera}=__sim,p=route.point(sample.s-18,0);camera.position.set(p.x,p.y+1.8,p.z);camera.fov=65;camera.updateProjectionMatrix();camera.lookAt(sample.sourceCentroid[0],route.y(sample.s)+2.1,sample.sourceCentroid[1]);camera.updateMatrixWorld(true);},sample);
   await shot(`${mode}-${sample.street.toLowerCase()}`);
   if(mode==='after'&&sample.street==='Sismanoglou'){const image=await page.evaluate(()=>{__sim.render();return __sim.canvas.toDataURL('image/webp',.85).split(',')[1];});await mkdir(resolve(root,'assets/changelog/2026.10.16.1'),{recursive:true});await writeFile(resolve(root,'assets/changelog/2026.10.16.1/psychiko-frontages.webp'),Buffer.from(image,'base64'));}
  }
  if(mode==='after')for(const event of ['psychiko-race','free']){
   report[event]=await page.evaluate(event=>{__flow.prepareEvent(event);__game.state='loading';const b=__flow.map.data.roadworks[0],g=__sim.ground,camera=__sim.camera,y=g.network?.height(b.x,b.z)??g.heightC(b.x,b.z);camera.position.set(b.x+Math.cos(b.yaw)*12,y+2,b.z-Math.sin(b.yaw)*12);camera.lookAt(b.x,y+.9,b.z);camera.updateMatrixWorld(true);return {event:__flow.event().def.type,visible:__sim.scene.getObjectByName('race-roadworks').visible,colliders:g.parked.filter(p=>p.kind==='roadworks').length};},event);
   await shot(event==='free'?'after-free-open':'after-race-closures');
  }
  await context.close();
 }
 assert.equal(report['psychiko-race'].colliders,after.roadworks.length);assert.equal(report['psychiko-race'].visible,true);assert.equal(report.free.colliders,0);assert.equal(report.free.visible,false);assert.deepEqual(report.errors,[]);console.log('PASS',JSON.stringify(report));
}finally{await writeFile(resolve(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();await app.close();}
