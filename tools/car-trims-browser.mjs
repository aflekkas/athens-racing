// Run: tools/browser-slot.sh node tools/car-trims-browser.mjs [artifact-directory]
import {resolve} from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createGameServer} from '../server/index.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/pw/node_modules/playwright/index.mjs');
const root=resolve(new URL('../',import.meta.url).pathname),out=resolve(process.argv[2]||'.scratch/car-trims-2');await fs.mkdir(out,{recursive:true});
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
 const show=async id=>{await page.evaluate(async id=>{const {CARS}=await import('/src/cars.js');__flow.menu.show('car',{index:CARS.findIndex(c=>c.id===id),detail:true,garage:true});},id);await page.waitForSelector('#carStage canvas');await page.waitForTimeout(500);};
 const capture=async name=>{await page.evaluate(()=>__flow.menu.carView?.captureFrame?.());await page.screenshot({timeout:120000,path:resolve(out,name+'.png')});};
 for(const id of (process.env.MINI_ONLY?[]:['panda_11','panda_100hp','golf','golf_r','cla','cla45s'])){await show(id);await capture('garage-'+id);}
 await show('mini_cooper');await capture('garage-mini-hardtop-cooper');
 await page.locator('[data-key="carTrim"] [data-v="mini_jcw"]').click();
 assert.equal(await page.locator('[data-key="carTrim"]').getAttribute('data-value'),'mini_jcw');
 await capture('garage-mini-hardtop-jcw');
 await page.locator('[data-key="carBody"] [data-v="convertible"]').click();
 assert.equal(await page.locator('[data-key="carTrim"]').getAttribute('data-value'),'mini_cabrio_jcw');
 await capture('garage-mini-convertible-jcw');
 await page.locator('[data-key="carTrim"] [data-v="mini_cabrio_cooper"]').click();
 await capture('garage-mini-convertible-cooper');
 await page.locator('[data-key="carBody"] [data-v="hardtop"]').click();
 assert.equal(await page.locator('[data-key="carTrim"]').getAttribute('data-value'),'mini_cooper');
 // Six actual stationary world views use the same spawn, camera and body colour.
 for(const id of (process.env.MINI_ONLY?[]:['panda_11','panda_100hp','golf','golf_r','cla','cla45s'])){
   await page.evaluate(async id=>{const {CARS}=await import('/src/cars.js');__flow.menu.h.chooseCar(CARS.findIndex(c=>c.id===id),null,true);await __flow.startEvent(__flow.freeRoamDef());},id);
   await page.waitForTimeout(1000);
   await page.evaluate(()=>{__game.countWall=performance.now()-5000;__sim.step(1,.05);__game.cam='chase';__sim.step(60,1/60);__sim.render();});
   await capture('chase-'+id);await page.evaluate(()=>__flow.quit());
 }
 const geometry=await page.evaluate(async()=>{const {CARS,CarModel}=await import('/src/cars.js');return ['mini_cooper','mini_s','mini_jcw','mini_cabrio_cooper','mini','mini_cabrio_jcw','panda_11','panda_100hp','golf','golf_r','cla','cla45s'].map(id=>{const spec=CARS.find(c=>c.id===id),car=new CarModel(spec);const result={id,body:car.modelKind,open:!!car.shape.open,exhaust:car.exhaust.length,expected:spec.visual.exhaust};car.disposeDamage?.();return result;});});
 for(const row of geometry){assert.equal(row.exhaust,row.expected,row.id+' outlet count');if(row.id.startsWith('mini'))assert.equal(row.open,row.body==='mini',row.id+' roof geometry');}
 await fs.writeFile(resolve(out,process.env.MINI_ONLY?'mini-browser-results.json':'browser-results.json'),JSON.stringify({errors,geometry},null,2));
 assert.deepEqual(errors,[]);console.log('PASS trim/body pickers, model construction, chase captures');
}finally{await browser.close();await app.close();}
