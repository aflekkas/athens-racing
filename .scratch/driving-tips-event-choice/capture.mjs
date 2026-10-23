// node capture.mjs ROOT OUTDIR LABEL [variants]  (through tools/browser-slot.sh)
// One real Quick Race (Riviera). The first variant uses the real first-run schedule (wall clock advanced by a test offset);
// later variants reset the saved tips and drive the same drivingHints.update() at another window size / device / binding.
// variant = device-WxH[-rebind]   device: kb | pad
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
const [rootArg,outArg,label='after',variantArg='kb-1280x800']=process.argv.slice(2);
const root=resolve(rootArg),out=resolve(outArg);await fs.mkdir(out,{recursive:true});
const pw=await import(resolve(root,'node_modules/playwright/index.mjs'));
const {serve}=await import('./serve.mjs');const server=await serve(root,resolve(out,'../proxy-cache'));
const browser=await pw.chromium.launch({headless:true,executablePath:resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={label,variants:[],errors:[]};
const SEL='#notification-lane .race-notice[data-notification-id="tip:controls"]';
const tipCard=page=>page.evaluate(sel=>{const lane=document.getElementById('notification-lane'),c=document.querySelector(sel);const queued=!!window.__notifications?.queue.items.has('tip:controls');
 if(!c||c.hidden||lane.hidden)return {shown:false,queued,laneMode:lane?.dataset.mode||null};const r=c.getBoundingClientRect();
 const rows=[...c.querySelectorAll('.driving-controls > span')].map(s=>({keys:[...s.querySelectorAll('kbd')].map(k=>k.textContent.trim()||(k.querySelector('use')?.getAttribute('href')||'').split('#').pop()),label:s.querySelector('b')?.textContent.trim()}));
 const els=[...c.querySelectorAll('kbd, b, button')].map(e=>e.getBoundingClientRect());let overlaps=0;for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){const a=els[i],b=els[j];const inside=(p,q)=>p.left>=q.left&&p.right<=q.right&&p.top>=q.top&&p.bottom<=q.bottom;if(a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1&&!inside(a,b)&&!inside(b,a))overlaps++;}
 return {shown:true,queued,laneMode:lane.dataset.mode,box:[r.left,r.top,r.width,r.height].map(Math.round),viewport:[innerWidth,innerHeight],rows,srText:c.querySelector('.sr-only')?.textContent||null,overflowX:c.scrollWidth>c.clientWidth+1,overlaps};},SEL);
try{
 const variants=variantArg.split(',');const [w0,h0]=variants[0].split('-')[1].split('x').map(Number);
 const page=await browser.newPage({viewport:{width:w0,height:h0}});page.setDefaultTimeout(600000);
 page.on('pageerror',e=>{report.errors.push(String(e));console.log('PAGEERROR',String(e).slice(0,300));});
 await page.addInitScript(()=>{const real=Date.now;window.__dt=0;Date.now=()=>real()+window.__dt;try{localStorage.removeItem('paraliaki.drivingTips.v2');localStorage.removeItem('paraliaki.drivingTips.v1');}catch{}});
 console.log('BOOT',new Date().toISOString());
 // the Riviera Quick Race as a direct route start (same loader as Quick Race → Riviera; tools/vegetation-capture.mjs pattern)
 await page.goto(`http://127.0.0.1:${server.address().port}/?routes=1&route=riviera-coast&simhook&quality=potato&fixedres&notraffic&nopedestrians&cam=chase`,{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>window.__routePilot&&!window.__routePilot.G.routePreparing&&document.body.classList.contains('loaded'),null,{timeout:900000,polling:1000});console.log('READY',new Date().toISOString());
 const raced=await page.waitForFunction(()=>window.__routePilot.G.state==='race',null,{timeout:180000,polling:1000}).then(()=>'countdown finished',()=>null);
 // SwiftShader can take minutes per countdown second: then enter the race state the way the countdown does
 if(!raced)await page.evaluate(()=>{const G=window.__routePilot.G;window.__flow.menu?.hide?.();G.state='race';document.body.classList.remove('counting','ui-open','menu');document.body.classList.add('racing');});
 report.raceEntry=raced||'forced after 180 s countdown';console.log('RACING',report.raceEntry,new Date().toISOString());
 await page.waitForTimeout(2500);
 for(const [index,variant] of variants.entries()){
  const [device,size,rebind]=variant.split('-');const [w,h]=size.split('x').map(Number);
  await page.setViewportSize({width:w,height:h});await page.waitForTimeout(600);
  const info=await page.evaluate(async({device,rebind,first})=>{
   const {input}=await import('/src/input.js');const {drivingHints}=await import('/src/ui/driving-hints.js');
   if(rebind==='rebind'){input.bindings.keyboard.camera=['KeyV'];input.bindings.keyboard.lookBack=['KeyN'];input.bindings.gamepad.lookBack=['b3'];}
   const v=window.__routePilot.player.veh,state=()=>({state:'race',device:device==='pad'?'gamepad':'keyboard',manual:v.manual,car:window.__routePilot.player.spec});
   if(first&&device==='kb'){window.__dt+=11000;return {manual:v.manual,path:'main loop'};} // the real first-run schedule
   window.__notifications.dismiss('tip:controls');await new Promise(r=>setTimeout(r,4600)); // the queue holds a dismissed id back for 4 s
   for(const k of Object.keys(drivingHints.saved))delete drivingHints.saved[k];
   drivingHints.lastState='menu';drivingHints.update(state());window.__dt+=11000;drivingHints.update(state());
   return {manual:v.manual,path:'drivingHints.update'};
  },{device,rebind,first:index===0});
  await page.waitForFunction(()=>window.__notifications?.queue.items.has('tip:controls'),null,{timeout:60000,polling:200});
  // harness only: hold the tip on screen while SwiftShader screenshots (its normal 6 s would expire mid-capture)
  await page.evaluate(()=>{const n=window.__notifications.queue.items.get('tip:controls');if(n){n.remaining=1e9;n.staleAt=Infinity;}});
  await page.waitForTimeout(700);
  const card=await tipCard(page),shot=resolve(out,`${label}-tip-${variant}.jpg`);
  let afterShot;for(let attempt=0;attempt<3;attempt++){await page.screenshot({path:shot,type:'jpeg',quality:84,timeout:180000});afterShot=await tipCard(page);if(afterShot.shown)break;console.log('RETRY-SHOT',variant,JSON.stringify(afterShot),await page.evaluate(()=>({body:document.body.className,lane:document.getElementById('notification-lane')?.hidden,items:[...window.__notifications.queue.items.keys()]})));await page.waitForTimeout(800);}
  const row={variant,...info,card,afterShot,shot};
  if(card.shown&&index===0){ // HIDE TIPS: the real button
   await page.click(`${SEL} button`,{timeout:15000});await page.waitForTimeout(600);
   row.afterHide={card:await tipCard(page),enabled:await page.evaluate(async()=>(await import('/src/ui/driving-hints.js')).drivingHints.enabled),stored:await page.evaluate(()=>localStorage.getItem('paraliaki.drivingTips.v2'))};
   await page.evaluate(async()=>{const {drivingHints}=await import('/src/ui/driving-hints.js');if(!drivingHints.enabled)drivingHints.toggle();});
  }
  report.variants.push(row);console.log(JSON.stringify(row).slice(0,1500));
 }
}finally{await fs.writeFile(resolve(out,`${label}-report.json`),JSON.stringify(report,null,2));await browser.close();server.close();}
