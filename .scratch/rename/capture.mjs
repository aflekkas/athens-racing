import {createGameServer} from '../../server/index.mjs';
import {chromium} from '/tmp/pw/node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
const xvfb=spawn('Xvfb',[':274','-screen','0','1400x1000x24','-nolisten','tcp']);
await new Promise(r=>setTimeout(r,500));
const app=await createGameServer({root:process.cwd(),dataDir:process.cwd()+'/.scratch/rename/server-data'});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:false,env:{...process.env,DISPLAY:':274'},executablePath:'/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1400,1000']});
const report={errors:[],screens:[]};
try{
const page=await browser.newPage({viewport:{width:1280,height:800},serviceWorkers:'block'});
page.on('pageerror',e=>report.errors.push(e.message));
await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&quality=low`,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__flow?.menu.screen==='title' && document.body.classList.contains('loaded'),null,{timeout:120000});
await page.waitForFunction(()=>document.querySelector('[data-title-hero]')?.dataset.ready==='true',null,{timeout:120000});
await page.evaluate(()=>document.fonts.ready);
for(const [width,height] of [[1280,800],[1920,1080],[390,844]]){
 await page.setViewportSize({width,height});await page.waitForTimeout(1200);
 assert.equal(await page.locator('#ui .wordmark').first().innerText(),'ATHENS\nRACING');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`.scratch/rename/title-${width}.png`});report.screens.push({width,height});
}
report.tabTitle=await page.title();assert.equal(report.tabTitle,'ATHENS RACING — Free Browser Racing');
execFileSync('scrot',['.scratch/rename/browser-tab-title.png'],{env:{...process.env,DISPLAY:':274'}});
await writeFile('.scratch/rename/browser-tab-title.json',JSON.stringify({title:report.tabTitle,url:page.url()},null,2));
await page.setViewportSize({width:1280,height:800});await page.waitForTimeout(1000);
const card=await page.evaluate(async()=>{
 const {renderResultCard}=await import('/src/result-share.js');
 const screenshot=document.querySelector('[data-title-hero] canvas');
 const {canvas}=await renderResultCard({screenshot,mapName:'ATHENS RIVIERA',routeName:'COASTAL SPRINT',carName:'MINI COOPER S CABRIO',time:94.32,position:1,field:4,pb:true,date:'2026-10-15T12:00:00Z'});
 return canvas.toDataURL('image/png').split(',')[1];
});await writeFile('.scratch/rename/share-card.png',Buffer.from(card,'base64'));
const hero=await page.evaluate(()=>document.querySelector('[data-title-hero] canvas').toDataURL());
const brand=await page.locator('.title__mark').innerHTML();
await page.evaluate(({hero,brand})=>{
 const style=document.createElement('style');style.textContent=`.og-art{position:fixed;inset:0;z-index:999999;background:#0b1117;color:white;overflow:hidden}.og-car{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:80% 80%;transform:translate(160px,80px) scale(.95)}.og-brand{position:absolute;top:48px;left:48px;display:flex;align-items:center;gap:24px;font-size:76px}.og-brand .brand-mark{width:96px;height:96px}.og-tag{position:absolute;left:48px;bottom:76px;font:600 28px var(--f-body);letter-spacing:.04em}.og-url{position:absolute;left:48px;bottom:38px;font:500 18px var(--f-body);color:#a9b6be}`;document.head.append(style);
 const el=document.createElement('div');el.className='og-art';el.innerHTML=`<img class="og-car" src="${hero}"><div class="og-brand">${brand}</div><div class="og-tag">REAL ROADS. NOTHING BUT TIME.</div><div class="og-url">athensracing.com</div>`;document.body.append(el);
}, {hero,brand});
for(const [height,name] of [[630,'og-image'],[1200,'og-image-square']]){await page.setViewportSize({width:1200,height});await page.waitForTimeout(500);await page.screenshot({path:`assets/share/${name}.jpg`,type:'jpeg',quality:90});}
await writeFile('.scratch/rename/browser-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
}finally{await browser.close();await app.close();xvfb.kill();}
