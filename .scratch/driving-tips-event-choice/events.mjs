// node events.mjs ROOT OUTDIR LABEL ROUTE  (through tools/browser-slot.sh). The real menu: Quick Race → track → Race Setup.
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
const [rootArg,outArg,label='after',route='megara-club']=process.argv.slice(2);
const root=resolve(rootArg),out=resolve(outArg);await fs.mkdir(out,{recursive:true});
const pw=await import(resolve(root,'node_modules/playwright/index.mjs'));
const {serve}=await import('./serve.mjs');const server=await serve(root,resolve(out,'../proxy-cache'));
const browser=await pw.chromium.launch({headless:true,executablePath:resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={label,route,steps:[],errors:[]};const log=(step,data={})=>{const row={step,at:new Date().toISOString(),...data};report.steps.push(row);console.log(JSON.stringify(row));};
const shot=async(page,name)=>{const path=resolve(out,`${label}-${name}.jpg`);await page.screenshot({path,type:'jpeg',quality:82,timeout:180000});return path;};
const setupState=page=>page.evaluate(()=>{const m=window.__flow.menu,root=m.root,ev=root.querySelector('[data-key="event"]');return {screen:m.screen,def:m.data.def&&{id:m.data.def.id,type:m.data.def.type,laps:m.data.def.laps},event:ev?{value:ev.dataset.value,options:[...ev.querySelectorAll('.seg__opt')].map(o=>o.textContent.trim())}:null,rivals:root.querySelector('[data-key="rivals"]')?.dataset.value??null,laps:root.querySelector('[data-key="laps"]')?.dataset.value??null,format:[...root.querySelectorAll('.setup-head__facts .stat-tile')].map(t=>t.textContent.trim()).join(' | '),kick:root.querySelector('.hu-status, .scr__kick')?.textContent.trim()};});
const toSetup=async page=>{
 await page.evaluate(()=>window.__flow.menu.openQuickRace());
 await page.waitForFunction(()=>window.__flow.menu.screen==='maps'&&document.querySelector('[data-confirm-track]'),null,{timeout:120000});
 await page.evaluate(id=>window.__flow.menu.mapView?.preview?.(id),route);await page.waitForTimeout(1500);
 const card=await page.evaluate(()=>document.querySelector('[data-confirm-track]').dataset.mapId);
 return card;
};
const startRace=async page=>{
 await page.click('[data-act="setupGo"]');await page.waitForFunction(()=>window.__flow.menu.screen==='car',null,{timeout:60000});
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>(G=>['countdown','race'].includes(G?.state)&&G.ev?.def)(window.__routePilot?.G||window.__sim?.G),null,{timeout:900000,polling:1000});
 await page.waitForTimeout(3000);
 return page.evaluate(()=>{const G=window.__routePilot?.G||window.__sim.G,d=G.ev.def;return {state:G.state,id:d.id,baseId:d.baseId,type:d.type,laps:d.laps,rivalCount:d.rivalCount??null,rivalsOnGrid:(window.__routePilot?.rivals||[]).length,hudLap:document.getElementById('lapTiming')?.textContent.trim().slice(0,40)||null};});
};
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(600000);
 page.on('request',r=>{if(/\/api\/(leaderboard|records)/.test(r.url())){const q=Object.fromEntries(new URL(r.url()).searchParams);report.boards=(report.boards||[]);report.boards.push(q);console.log('BOARD',JSON.stringify(q));}});page.on('pageerror',e=>{report.errors.push(String(e));console.log('PAGEERROR',String(e).slice(0,300));});
 await page.addInitScript(()=>{try{localStorage.removeItem('paraliaki.raceSetup');}catch{}});
 await page.goto(`http://127.0.0.1:${server.address().port}/?menu&simhook&quality=potato&fixedres&notraffic`,{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>document.body.classList.contains('loaded')&&window.__flow?.menu,null,{timeout:300000});
 log('picker',{card:await toSetup(page),shot:await shot(page,'1-picker')});
 await page.click('[data-confirm-track]');
 await page.waitForFunction(()=>window.__flow.menu.screen==='setup'&&!document.querySelector('#loading.open'),null,{timeout:900000,polling:1000});
 await page.waitForTimeout(1200);
 log('setup-default',{...await setupState(page),shot:await shot(page,'2-setup-default')});
 if(label.includes('single')){log('free-session-setup',await page.evaluate(()=>{const m=window.__flow.menu;m.show('setup',{mode:'free'},true);return {screen:m.screen,title:m.root.querySelector('h1,h2,.sheet-head__title')?.textContent.trim(),eventRow:!!m.root.querySelector('[data-key="event"]')};}));await shot(page,'free-session-setup');}
 if(label==='before'||label.includes('single')){await fs.writeFile(resolve(out,`${label}-events.json`),JSON.stringify(report,null,2));process.exit(0);}
 // TIME TRIAL through the real segmented control
 await page.click('[data-key="event"] .seg__opt:not(.on)');await page.waitForTimeout(700);
 await page.click('[data-act="setupAdvanced"]');await page.waitForTimeout(500);
 log('setup-tt',{...await setupState(page),shot:await shot(page,'3-setup-timetrial')});
 // CHOOSE CAR then Back: the choice is kept
 await page.click('[data-act="setupGo"]');await page.waitForFunction(()=>window.__flow.menu.screen==='car',null,{timeout:60000});
 const backs=[];for(let i=0;i<3;i++){await page.keyboard.press('Escape');await page.waitForTimeout(900);backs.push(await page.evaluate(()=>window.__flow.menu.screen));if(backs.at(-1)==='setup')break;}log('back-path',{screens:backs});await page.waitForFunction(()=>window.__flow.menu.screen==='setup',null,{timeout:30000});await page.waitForTimeout(500);
 log('setup-after-back',await setupState(page));
 const tt=await startRace(page);log('race-tt',{...tt,shot:await shot(page,'4-race-timetrial')});
 // back to the picker: the race is the default again; start it
 await page.evaluate(()=>window.__flow.menu.h.quit('title'));await page.waitForFunction(()=>window.__flow.menu.screen==='title',null,{timeout:120000});
 await toSetup(page);await page.click('[data-confirm-track]');
 await page.waitForFunction(()=>window.__flow.menu.screen==='setup'&&!document.querySelector('#loading.open'),null,{timeout:900000,polling:1000});await page.waitForTimeout(800);
 log('setup-race-again',await setupState(page));
 const race=await startRace(page);log('race-sprint',{...race,shot:await shot(page,'5-race-sprint')});
}finally{await fs.writeFile(resolve(out,`${label}-events.json`),JSON.stringify(report,null,2));await browser.close();server.close();}
