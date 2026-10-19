// ROOT=<archive> OUT=<dir> TAG=before|after IDS=gla,golf [LOBBY=1] tools/browser-slot.sh node garage-shots.mjs
// Screenshots the real garage (catalogue + spec screen) at 1280x800 and 390x844 through the running game.
import {resolve} from 'node:path';import fs from 'node:fs/promises';import sharp from 'sharp';
const root=process.env.ROOT,out=resolve(process.env.OUT),tag=process.env.TAG||'shot';await fs.mkdir(out,{recursive:true});
const {createGameServer}=await import(root+'/server/index.mjs');
const {chromium}=await import('/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
const dataDir=await fs.mkdtemp('/tmp/athens-garage-srv.');
const app=await createGameServer({root,dataDir});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const save=async(page,name)=>{const buf=await page.screenshot({type:'png'});await sharp(buf).webp({quality:82}).toFile(`${out}/${name}.webp`);console.log('SHOT',name);};
try{
 for(const [w,h] of [[1280,800],[390,844]]){
  const page=await browser.newPage({viewport:{width:w,height:h}});page.on('pageerror',e=>console.log('PAGEERROR',e.message));page.setDefaultTimeout(120000);
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async route=>{const suffix=route.request().url().split('three@0.170.0/')[1];await route.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',suffix)),contentType:'text/javascript'});});
  await page.addInitScript(()=>{localStorage.setItem('paraliaki.graphics-onboarding','1');});
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&map=penteli&guest=1`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.classList.contains('loaded'),null,{timeout:240000});await page.waitForTimeout(800);
  await page.evaluate(async()=>{const {CARS}=await import('/src/cars.js');__flow.menu.show('car',{index:0,garage:true});});await page.waitForFunction(()=>[...document.querySelectorAll('.car-card img[data-car-thumb]')].filter(i=>i.complete&&i.naturalWidth>0).length>=4,null,{timeout:120000}).catch(()=>{});await page.waitForTimeout(1500);
  await save(page,`garage-catalogue-${tag}-${w}x${h}`);
  for(const id of process.env.IDS.split(',')){
   await page.evaluate(async id=>{const {CARS}=await import('/src/cars.js');__flow.menu.show('car',{index:CARS.findIndex(c=>c.id===id),detail:true,garage:true});},id);
   await page.waitForSelector('#carStage canvas');await page.waitForTimeout(3500);
   await save(page,`garage-${id}-${tag}-${w}x${h}`);
  }
  await page.close();
 }
}finally{await browser.close();app.server.close();await fs.rm(dataDir,{recursive:true,force:true});setTimeout(()=>process.exit(0),500);}
