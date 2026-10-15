// Run through tools/browser-slot.sh node tools/menu-capture.mjs ROOT OUT [hero].
// Local CDN mirror and immutable static cache keep cold/warm timing repeatable without routing (which disables Chrome caching).
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]),out=resolve(process.argv[3]);await fs.mkdir(out,{recursive:true});
const {createGameServer}=await import(pathToFileURL(resolve(root,'server/index.mjs')));
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});
const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.bin':'application/octet-stream','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.wav':'audio/wav','.mp3':'audio/mpeg','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(path==='/api/auth/config'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({providers:[],required:false}));return;}if(path.startsWith('/api/')||path==='/health')return app.server.emit('request',req,res);try{let file=resolve(root,'.'+(path==='/'?'/index.html':path));if(path.startsWith('/vendor/'))file=resolve(root,'node_modules/three',path.slice(8));let body=await fs.readFile(file);if(file.endsWith('index.html'))body=Buffer.from(body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/vendor/'));res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':body.length,'Cache-Control':file.endsWith('index.html')?'no-cache':'public,max-age=3600'});res.end(body);}catch{res.writeHead(404);res.end();}});
server.on('upgrade',(...args)=>app.server.emit('upgrade',...args));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});


const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack));
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>['frame','onAnimationFrame'].includes(cb.name)?0:raf(cb);});
const report={errors,cases:[]};let release;
try{
 const gate=new Promise(r=>{release=r});
 await page.route('**/src/title-hero-studio.js',async route=>{await gate;try{await route.continue();}catch(e){if(!String(e).includes('already handled'))throw e;}});
 await page.goto(`http://127.0.0.1:${server.address().port}/?menu&quality=low`,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('[data-act=play]');await page.locator('[data-act=play]').click();
 assert.equal(await page.evaluate(()=>__flow.menu.screen),'mode','PLAY works with the hero module blocked');
 release();await page.unroute('**/src/title-hero-studio.js');await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>__mapRuntime().worlds.length),0);assert.equal(await page.locator('[data-title-hero]').count(),0);report.nonblockingCancellation=true;
 await page.evaluate(()=>__flow.menu.show('title'));await page.waitForSelector('[data-title-hero][data-ready=true]',{timeout:120000});
 for(const [id,paint] of [['mini_s','#17191d'],['carrera_s','#c02624'],['bus','#1e6384'],['moto','#8a1c25'],['mini','#bd1626']]) {
  await page.evaluate(async({id,paint})=>{const {CARS}=await import('/src/cars.js');const m=__flow.menu;m.activate(m.root.querySelector('[data-act=garage]'));m.data={...m.data,index:CARS.findIndex(c=>c.id===id),detail:true};m.render();m.carView.paint(paint);m.activate(m.root.querySelector('[data-act=carConfirm]'));},{id,paint});
  await page.waitForSelector(`[data-title-hero][data-ready=true] canvas[data-car-id="${id}"][data-paint="${paint}"]`,{timeout:120000});
  const state=await page.evaluate(()=>{const m=__flow.menu,c=m.h.carSpec();return {id:c.id,name:c.name,hero:m.root.querySelector('.home__feature b').textContent,garage:m.root.querySelector('[data-act=garage] .option__desc').textContent,ready:m.root.querySelector('.home__session-car b').textContent,paint:m.root.querySelector('[data-title-hero] canvas').dataset.paint,worlds:__mapRuntime().worlds.length,badge:m.root.querySelector('.build-badge')?.textContent,footerDev:!!m.root.querySelector('.title-meta [data-act=whatsNew]')};});
  assert.equal(state.hero,state.name);assert.equal(state.garage,state.name);assert.equal(state.ready,state.name);assert.equal(state.paint,paint);assert.equal(state.worlds,0);assert.equal(state.badge,'DEV');assert.equal(state.footerDev,false);report.cases.push(state);
  await page.screenshot({path:resolve(out,`selected-${id}.png`),timeout:60000});
 }
 for(const [width,height] of [[1280,800],[1920,1080],[390,844]]) {await page.setViewportSize({width,height});await page.waitForTimeout(900);await page.screenshot({path:resolve(out,`after/menu-${width}.png`),timeout:60000});}
 const sheet=await page.evaluate(async()=>{const{createHeroStudio}=await import('/src/title-hero-studio.js');const{CARS}=await import('/src/cars.js');const{GARAGE_CARS}=await import('/src/car-catalog.js');const studio=createHeroStudio(),sheet=document.createElement('canvas');sheet.width=2000;sheet.height=1680;const ctx=sheet.getContext('2d');ctx.fillStyle='#172d36';ctx.fillRect(0,0,2000,1680);const records=[];for(let i=0;i<GARAGE_CARS.length;i++){const c=CARS.find(c=>c.id===GARAGE_CARS[i]),x=i%5*400,y=Math.floor(i/5)*280;studio.setVehicle(c,c.color);await studio.draw(390,210);ctx.drawImage(studio.canvas,x+5,y+5,390,210);ctx.fillStyle='#fff';ctx.font='bold 14px sans-serif';ctx.fillText(c.name,x+12,y+240,375);ctx.fillStyle='#adcbd2';ctx.font='12px sans-serif';ctx.fillText(`${c.id} / ${c.color}`,x+12,y+260);records.push(studio.info);}studio.dispose();return{url:sheet.toDataURL(),records};});
 await fs.writeFile(resolve(out,'hero-sheet.png'),Buffer.from(sheet.url.split(',')[1],'base64'));report.studios=sheet.records;assert.equal(report.studios.length,30);assert.deepEqual(errors,[]);await fs.writeFile(resolve(out,'review-validation.json'),JSON.stringify(report,null,2));
}catch(e){console.error(e);process.exitCode=1;}finally{release?.();await browser.close();server.close();app.server.close();process.exit(process.exitCode||0);}
