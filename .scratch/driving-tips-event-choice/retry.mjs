// node retry.mjs ROOT OUTDIR  (through tools/browser-slot.sh). Real menu: Quick Race picker with a map label under the floating
// card (measured in the DOM before the shot), then Race Setup → RACE (default) → CHOOSE CAR → race on track.
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
const [rootArg,outArg]=process.argv.slice(2);const root=resolve(rootArg),out=resolve(outArg);await fs.mkdir(out,{recursive:true});
const pw=await import(resolve(root,'node_modules/playwright/index.mjs'));
const {serve}=await import('./serve.mjs');const server=await serve(root,resolve(out,'../proxy-cache'));
const browser=await pw.chromium.launch({headless:true,executablePath:resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={steps:[],errors:[]};const log=(step,data={})=>{const row={step,at:new Date().toISOString(),...data};report.steps.push(row);console.log(JSON.stringify(row).slice(0,1200));};
const underCard=page=>page.evaluate(()=>{const card=document.querySelector('.map-preview')?.getBoundingClientRect();if(!card)return null;
 const hits=[...document.querySelectorAll('.track-pin, .map-label')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&+getComputedStyle(e).opacity>0).map(e=>({text:e.textContent.trim().slice(0,40),r:e.getBoundingClientRect()})).filter(({r})=>r.left<card.right&&r.right>card.left&&r.top<card.bottom&&r.bottom>card.top).map(({text,r})=>({text,box:[r.left,r.top,r.width,r.height].map(Math.round)}));
 const cs=getComputedStyle(document.querySelector('.map-preview'));return {card:[card.left,card.top,card.width,card.height].map(Math.round),background:cs.backgroundColor,backdrop:cs.backdropFilter,uiBackdrop:document.documentElement.dataset.uiBackdrop,moving:document.querySelector('.map-preview').classList.contains('panel--moving'),hits};});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(120000);
 page.on('pageerror',e=>{report.errors.push(String(e));console.log('PAGEERROR',String(e).slice(0,300));});
 page.on('request',r=>{if(/\/api\/leaderboard/.test(r.url()))(report.boards||=[]).push(Object.fromEntries(new URL(r.url()).searchParams));});
 await page.addInitScript(()=>{try{localStorage.removeItem('paraliaki.raceSetup');}catch{}});
 await page.goto(`http://127.0.0.1:${server.address().port}/?menu&simhook&quality=potato&fixedres&notraffic`,{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>document.body.classList.contains('loaded')&&window.__flow?.menu,null,{timeout:180000});
 await page.evaluate(()=>window.__flow.menu.openQuickRace());
 await page.waitForFunction(()=>window.__flow.menu.screen==='maps'&&document.querySelector('[data-confirm-track]'),null,{timeout:120000});
 await page.evaluate(()=>window.__flow.menu.mapView?.preview?.('megara-club'));await page.waitForTimeout(2500);
 let m=await underCard(page);
 for(let i=0;i<6&&!(m?.hits?.length&&!m.moving);i++){await page.evaluate(()=>window.__flow.menu.mapView?.action('mapZoomOut'));await page.waitForTimeout(1500);m=await underCard(page);}
 const shot=resolve(out,'after-picker-label-under-card.jpg');await page.screenshot({path:shot,type:'jpeg',quality:86});
 log('picker',{...m,after:await underCard(page),shot});
 await page.click('[data-confirm-track]');
 await page.waitForFunction(()=>window.__flow.menu.screen==='setup'&&!document.querySelector('#loading.open'),null,{timeout:240000,polling:1000});await page.waitForTimeout(800);
 log('setup',await page.evaluate(()=>{const r=window.__flow.menu.root,e=r.querySelector('[data-key="event"]');return {event:e?.dataset.value,rivals:r.querySelector('[data-key="rivals"]')?.dataset.value};}));
 await page.click('[data-act="setupGo"]');await page.waitForFunction(()=>window.__flow.menu.screen==='car',null,{timeout:60000});
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>(G=>['countdown','race'].includes(G?.state)&&G.ev?.def)(window.__routePilot?.G||window.__sim?.G),null,{timeout:240000,polling:1000});
 await page.waitForTimeout(3000);
 const race=await page.evaluate(()=>{const G=window.__routePilot?.G||window.__sim.G,d=G.ev.def;return {state:G.state,id:d.id,baseId:d.baseId,type:d.type,laps:d.laps,rivalCount:d.rivalCount??null,rivalsOnGrid:(window.__routePilot?.rivals||[]).length,hud:document.getElementById('lapTiming')?.textContent.trim().slice(0,30)||null};});
 log('race',{...race,shot:resolve(out,'after-race-sprint.jpg')});await page.screenshot({path:resolve(out,'after-race-sprint.jpg'),type:'jpeg',quality:84});
}finally{await fs.writeFile(resolve(out,'retry-report.json'),JSON.stringify(report,null,2));await browser.close();server.close();}
