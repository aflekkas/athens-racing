// tools/browser-slot.sh node tools/play-every-model-browser.mjs [artifact-directory]
import {resolve} from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createGameServer} from '../server/index.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/pw/node_modules/playwright/index.mjs');
const root=resolve(new URL('../',import.meta.url).pathname),out=resolve(process.argv[2]||'.scratch/play-every-model');await fs.mkdir(out,{recursive:true});
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>{errors.push(e.stack);console.log('PAGEERROR',e.stack);});
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async r=>r.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',r.request().url().split('three@0.170.0/')[1])),contentType:'text/javascript'}));
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__holdFrame&&cb.name==='frame'?0:raf(cb);});
page.setDefaultTimeout(180000);
const capture=async(name,world=false)=>{
 if(world){const frame=await page.evaluate(()=>{__sim.render();return __sim.canvas.toDataURL('image/png').split(',')[1];});await fs.writeFile(resolve(out,name+'.png'),Buffer.from(frame,'base64'));}
 else{await page.evaluate(()=>__flow.menu.carView?.captureFrame?.());const cdp=await page.context().newCDPSession(page);try{const s=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(resolve(out,name+'.png'),Buffer.from(s.data,'base64'));}finally{await cdp.detach();}}
 await fs.writeFile(resolve(out,name+'.dom.json'),JSON.stringify(await page.evaluate(()=>({text:document.body.innerText,classes:document.body.className,car:window.__sim?.player?.spec?.id,cam:window.__game?.cam,camera:window.__sim?.camera?.position?.toArray()})),null,2));console.log('CAPTURE',name);
};
try{
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&quality=low&fixedres&map=riviera&notraffic`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.classList.contains('loaded'));await page.evaluate(()=>window.__holdFrame=true);console.log('MENU READY');
 for(const category of ['commercial','public transport','motorcycle','service']){
  await page.evaluate(category=>__flow.menu.show('car',{garage:true,filters:{category}}),category);await page.waitForTimeout(400);await capture('garage-'+category.replaceAll(' ','-'));
 }
 await page.evaluate(async()=>{const {CARS}=await import('/src/cars.js');__flow.menu.show('car',{index:CARS.findIndex(c=>c.id==='bus'),detail:true,garage:true});});await page.waitForSelector('#carStage canvas');await page.waitForTimeout(600);await capture('garage-bus');
 console.log('START RIVIERA');await page.evaluate(async()=>__flow.startEvent(__flow.freeRoamDef(),{car:'bus'}));
 await page.waitForFunction(()=>__sim.player.spec.id==='bus'&&!document.body.classList.contains('fading'),null,{timeout:240000});
 for(const cam of ['chase','cockpit']){
  await page.evaluate(cam=>{__game.countWall=performance.now()-5000;__game.cam=cam;__sim.step(90,1/60);__sim.render();},cam);
  const state=await page.evaluate(()=>({car:__sim.player.spec.id,physics:__sim.player.veh.spec.id,model:__sim.player.model.spec.id,cam:__game.cam,map:__sim.route.id||__game.ev?.def?.map,camera:__sim.camera.position.toArray(),position:__sim.player.model.root.position.toArray()}));assert.equal(state.car,'bus');assert.equal(state.physics,'bus');assert.equal(state.model,'bus');assert.equal(state.cam,cam);console.log('BUS',JSON.stringify(state));await fs.writeFile(resolve(out,'bus-'+cam+'.json'),JSON.stringify(state,null,2));await capture('bus-riviera-'+cam,true);
 }
 await fs.writeFile(resolve(out,'browser-results.json'),JSON.stringify({errors},null,2));assert.deepEqual(errors,[]);console.log('PASS fleet garage, bus chase and cockpit on Riviera');
}finally{await browser.close();await app.close();}
