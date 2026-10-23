// Interleaved cold-context route startup. Run through tools/browser-slot.sh.
// node tools/measure-route-load.mjs OUTPUT before=http://localhost:8001 after=http://localhost:8002 --runs=3
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const [destination,...args]=process.argv.slice(2),runs=Number(args.find(s=>s.startsWith('--runs='))?.slice(7)||3);
assert.ok(destination&&Number.isInteger(runs)&&runs>0&&runs<=10,'OUTPUT and 1–10 runs required');
const variants=args.filter(s=>!s.startsWith('--')).map(s=>{const i=s.indexOf('=');assert.ok(i>0,'expected LABEL=URL');const label=s.slice(0,i);assert.match(label,/^[a-z0-9-]+$/i);return{label,url:new URL(s.slice(i+1)).origin};});
assert.ok(variants.length,'at least one LABEL=URL required');
const out=resolve(destination);await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const samples=[];
try{
 for(let run=0;run<runs;run++)for(const variant of run%2?[...variants].reverse():variants)for(const route of ['megara-club','penteli-hill']){
  const context=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'});
  try{
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(`${variant.url}/?routes=1&route=${route}&simhook&guest=1&quality=low&car=mini_jcw`,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__routePilot&&!window.__routePilot.G.routePreparing,null,{timeout:120000});
   const preparationObservedAtMs=await page.evaluate(()=>performance.now());
   await page.waitForFunction(()=>window.__routePilot?.G.state==='race'&&!window.__routePilot.G.routePreparing&&!document.querySelector('#loading[aria-busy=true]'),null,{timeout:30000});
   const data=await page.evaluate(()=>{const p=window.__routePilot,marks=name=>performance.getEntriesByName(name).at(-1)?.startTime??null;return{navigationStartUTC:new Date(performance.timeOrigin).toISOString(),playableObservedAtMs:performance.now(),selectionStartedAtMs:marks('athens-route-selection'),routeReadyAtMs:marks('athens-route-ready'),playableAtMs:marks('athens-playable'),metrics:window.__worldSession.metrics,stream:window.__worldSession.stream.metrics,programs:p.renderer.info.programs.length,upload:window.__worldSession.sceneTiles.uploadMetrics,warmup:window.__worldSession.sceneTiles.warmupMetrics,state:p.G.state,stationBeforeDrive:p.player.veh.s};});
   await page.evaluate(()=>window.__routePilot.setDriver(()=>({throttle:1,brake:0,steer:0,handbrake:false})));await page.waitForTimeout(1000);
   const driven=await page.evaluate(()=>({state:window.__routePilot.G.state,station:window.__routePilot.player.veh.s,kmh:window.__routePilot.player.veh.kmh}));
   assert.deepEqual(errors,[]);assert.equal(data.state,'race');assert.equal(driven.state,'race');assert.ok(driven.station>data.stationBeforeDrive+.5,'real rendered frames must move the car');
   const sample={variant:variant.label,run:run+1,route,preparationObservedAtMs,...data,driven,errors};samples.push(sample);console.log(JSON.stringify(sample));
   await writeFile(resolve(out,'samples.json'),JSON.stringify(samples,null,2));
   if(run===0){
    const picture=resolve(out,`${variant.label}-${route}.jpg`);await page.screenshot({path:picture,type:'jpeg',quality:85});console.log('SCREENSHOT '+picture);
   }
  }finally{await context.close();}
 }
}finally{await browser.close();}
