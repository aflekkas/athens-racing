// Run: tools/browser-slot.sh node tools/car-trims-browser.mjs [artifact-directory]
import {resolve} from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createGameServer} from '../server/index.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/pw/node_modules/playwright/index.mjs');
const root=resolve(new URL('../',import.meta.url).pathname),out=resolve(process.argv[2]||'.scratch/car-trims');await fs.mkdir(out,{recursive:true});
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>{errors.push(e.stack);console.log('PAGEERROR',e.stack);});page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async route=>{const suffix=route.request().url().split('three@0.170.0/')[1];await route.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',suffix)),contentType:'text/javascript'});});
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__holdFrame&&cb.name==='frame'?0:raf(cb);});
page.setDefaultTimeout(120000);
try{
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&quality=low&fixedres&map=penteli`,{waitUntil:'domcontentloaded'});
 console.log('DOM READY');await page.waitForFunction(()=>document.body.classList.contains('loaded'),null,{timeout:180000});console.log('LOADED');await page.evaluate(()=>{window.__holdFrame=true;});
 await page.evaluate(async()=>{const {CARS}=await import('/src/cars.js');__flow.menu.show('car',{index:CARS.findIndex(c=>c.id==='cle200'),detail:true,garage:true});});
 await page.waitForSelector('#carStage canvas');await page.waitForTimeout(1500);
 await page.evaluate(()=>__flow.menu.carView?.captureFrame?.());await page.screenshot({timeout:120000,path:resolve(out,'garage-cle200.png')});
 await page.locator('[data-key="carTrim"]').click();
 await page.evaluate(()=>__flow.menu.carView?.captureFrame?.());await page.screenshot({timeout:120000,path:resolve(out,'garage-trim-picker.png')});
 console.log('OPTIONS',await page.locator('[role="option"]').allTextContents());
 await page.locator('[role="option"]').filter({hasText:'AMG CLE 53'}).click();
 await page.waitForTimeout(1000);
 assert.equal(await page.locator('[data-key="carTrim"]').getAttribute('data-value'),'cle53');
 await page.evaluate(()=>__flow.menu.carView?.captureFrame?.());await page.screenshot({timeout:120000,path:resolve(out,'garage-cle53.png')});
 // Actual game camera and world, sequential captures at the same stationary spawn.
 for(const id of ['cle200','cle53']){
   await page.evaluate(async id=>{const {CARS}=await import('/src/cars.js');__flow.menu.h.chooseCar(CARS.findIndex(c=>c.id===id),null,true);await __flow.startEvent(__flow.freeRoamDef());},id);
   await page.waitForTimeout(1500);
   await page.evaluate(()=>{__game.countWall=performance.now()-5000;__sim.step(1,.05);__game.cam='chase';__sim.step(60,1/60);__sim.render();});
   await page.evaluate(()=>__flow.menu.carView?.captureFrame?.());await page.screenshot({timeout:120000,path:resolve(out,`chase-${id}.png`)});
   await page.evaluate(()=>__flow.quit());
 }
 const captures=await Promise.all(['cle200','cle53'].map(async id=>({id,data:(await fs.readFile(resolve(out,`chase-${id}.png`))).toString('base64')})));
 await page.setContent(`<body style="margin:0;background:#101820;color:white;font:16px sans-serif"><div style="display:flex">${captures.map(({id,data})=>`<figure style="margin:0;width:50%"><figcaption style="padding:12px">${id==='cle200'?'CLE 200 · 18 inch · twin outlets':'AMG CLE 53 · 20 inch · quad outlets'}</figcaption><img style="width:100%" src="data:image/png;base64,${data}"></figure>`).join('')}</div></body>`);
 await page.screenshot({path:resolve(out,'chase-comparison.png')});
 await fs.writeFile(resolve(out,'browser-results.json'),JSON.stringify({errors},null,2));
 assert.deepEqual(errors,[]);console.log('PASS trim picker, model construction, chase captures');
}finally{await browser.close();await app.close();}
