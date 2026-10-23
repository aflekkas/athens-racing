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
   // Keep race drawing out of timing; preparation still yields through real rAF.
   await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>cb.name==='frame'?0:raf(cb);});
   await page.goto(`${variant.url}/?routes=1&route=${route}&simhook&guest=1&quality=low`,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__routePilot&&!window.__routePilot.G.routePreparing,null,{timeout:120000});
   const data=await page.evaluate(()=>({navigationToReadyMs:performance.now(),metrics:window.__worldSession.metrics,stream:window.__worldSession.stream.metrics,programs:window.__routePilot.renderer.info.programs.length,upload:window.__worldSession.sceneTiles.uploadMetrics,warmup:window.__worldSession.sceneTiles.warmupMetrics,state:window.__routePilot.G.state}));
   assert.deepEqual(errors,[]);assert.equal(data.state,'countdown');
   const sample={variant:variant.label,run:run+1,route,...data,errors};samples.push(sample);console.log(JSON.stringify(sample));
   await writeFile(resolve(out,'samples.json'),JSON.stringify(samples,null,2));
   if(run===0){
    await page.evaluate(()=>{const p=window.__routePilot;for(let i=0;i<90;i++)p.step(1/60,false,true,1/60);p.step(1/60,true,true,1/60);});
    await page.waitForTimeout(300); // allow the loading fade to leave the rendered game
    await page.screenshot({path:resolve(out,`${variant.label}-${route}.jpg`),type:'jpeg',quality:85});
   }
  }finally{await context.close();}
 }
}finally{await browser.close();}
