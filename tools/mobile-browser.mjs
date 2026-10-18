// Run through tools/browser-slot.sh. Tests the deploy bundle with real touch input.
const { chromium, devices } = await import(process.env.PLAYWRIGHT_MODULE || '/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
import { serveBundle } from './serve-bundle.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const out = resolve(process.env.MOBILE_EVIDENCE || '.scratch/mobile/evidence');
await mkdir(out,{recursive:true});
const app = await serveBundle(resolve(process.env.MOBILE_BUNDLE || '.deploy/assets'),{dataDir:resolve(out,'server')});
const browser = await chromium.launch({executablePath:process.env.CHROME_BIN || '/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-precise-memory-info']});
const report = {errors:[],runs:[]};
const baseline = process.argv.includes('--before');
const landscape = process.argv.includes('--landscape');
async function screenshot(page, path) {
  if(process.argv.includes('--no-capture'))return;
  // Hold the picture still during capture only; racing always runs its normal loop.
  await page.evaluate(()=>{window.__mobileCapture=true;});
  try {
    await page.screenshot({path,scale:'css',timeout:120000,animations:'disabled'});
  }
  finally { await page.evaluate(()=>{window.__mobileCapture=false;}); }
}
const memoryFunction = (await readFile('src/asset-metrics.js','utf8')).split('export function estimateSceneMemory')[1];
try {
 if (process.argv.includes('--matrix') || process.argv.includes('--race')) {
  for (const map of ['megara','riviera','penteli','psychiko']) {
   const context=await browser.newContext({...devices['Pixel 8 landscape']});
   await context.addInitScript(()=>localStorage.setItem('paraliaki.settings',JSON.stringify({perfClass:'low',dynamicResolution:false})));
   const page=await context.newPage(),cdp=await context.newCDPSession(page);let peak=0;
   page.on('console',m=>{if(m.text().startsWith('MOBILE_PHASE'))console.log(m.text());});
   await page.addInitScript(()=>setInterval(()=>console.log('MOBILE_PHASE',window.__game?.state,document.body?.dataset.ui,document.querySelector('#loading')?.innerText?.slice(-140)),10000));
   page.on('pageerror',e=>console.log('ERROR',String(e)));
   await page.goto(app.url+'/?simhook&map='+map+'&bakedownload',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>{window.__peakMobileHeap=Math.max(window.__peakMobileHeap||0,performance.memory?.usedJSHeapSize||0);return window.__game?.state==='race';},null,{timeout:900000,polling:250});
   console.log('MAP_READY',map);
   for(const perfClass of ['potato','low','med','high']){
    await page.evaluate(perfClass=>{__settings.perfClass=perfClass;__renderTest.applyRenderResolution(.9);__renderTest.applyRenderResolution('auto');},perfClass);
    await page.waitForTimeout(1500);
    const result=await page.evaluate(memoryFunction=>({render:__renderInfo(),memory:Function('return function estimateSceneMemory'+memoryFunction)()(__sim.scene),peakHeap:window.__peakMobileHeap,metrics:__assetMetrics.maps[__game.mapId],resources:performance.getEntriesByType('resource').filter(e=>e.name.includes('/data/')).map(e=>({url:e.name.split('/').at(-1),transfer:e.transferSize,encoded:e.encodedBodySize,ms:e.duration}))}),memoryFunction);
    await cdp.send('HeapProfiler.collectGarbage');result.heap=await cdp.send('Runtime.getHeapUsage');
    report.runs.push({map,perfClass,...result});console.log('MAP',JSON.stringify({map,perfClass,...result}));
   }
   await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
   await context.close();
  }
 }
 if (!process.argv.includes('--matrix')) {
 for (const device of ['iPhone 15','Pixel 8']) {
  const context = await browser.newContext({...devices[device+(landscape?' landscape':'')]});
  await context.addInitScript(baseline=>localStorage.setItem('paraliaki.settings',JSON.stringify({perfClass:baseline?'med':'low'})),baseline);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>raf(function run(t){if(window.__mobileCapture && cb.name==='frame'){raf(run);return;}cb(t);});});
  page.on('requestfailed',r=>console.log('REQUEST_FAILED',r.url(),r.failure()?.errorText));
  page.on('response',r=>{if(r.status()>=400)console.log('HTTP_ERROR',r.status(),r.url());});
  page.on('pageerror',e=>{report.errors.push(String(e)); console.log('ERROR',String(e));});
  page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,400));});
  page.on('console',m=>{if(m.text().startsWith('MOBILE_PHASE'))console.log(m.text());});
  await page.addInitScript(()=>setInterval(()=>console.log('MOBILE_PHASE',window.__game?.state,document.body?.dataset.ui,document.querySelector('#loading')?.innerText?.slice(-140)),10000));
  const cdp=await context.newCDPSession(page);
  await page.goto(app.url+'/?menu&simhook&bakedownload',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bootMenu?.open,null,{timeout:120000}).catch(async error=>{console.log('BOOT_FAILED',await page.evaluate(()=>({html:document.body.innerText,errors:document.querySelector('#err')?.innerText,resources:performance.getEntriesByType('resource').map(e=>({name:e.name,ms:e.duration,bytes:e.transferSize}))})));throw error;});
  console.log('TITLE',device,await page.locator('#ui').innerText());
  if(await page.locator('[data-act=dismissNews]').count())await page.locator('[data-act=dismissNews]').tap();
  await screenshot(page,resolve(out,device+(landscape?'-landscape-menu.png':'-portrait-menu.png')));
  const tap=async selector=>{console.log('TAP',device,selector);const el=page.locator(selector).first();await el.scrollIntoViewIfNeeded({timeout:120000});await el.tap({timeout:120000});};
  await tap('[data-act=play]');
  console.log('MODE',await page.locator('#ui').innerText());
  await tap('[data-act=quick]');
  console.log('MAPS',await page.locator('#ui').innerText());
  await tap('[data-act=mapNext]');
  await tap('[data-confirm-track][data-map-id=megara]');
  console.log('SELECTED',await page.locator('#ui').innerText());
  if(await page.locator('[data-act=mapContinue]').count())await tap('[data-act=mapContinue]');
  const go=page.locator('[data-act=setupGo]');
  if (process.argv.includes('--race')) {
   await tap('[data-act=setupAdvanced]');
   await tap('[data-key=laps] [data-step="-1"]');await tap('[data-key=laps] [data-step="-1"]');
  }
  if(await go.count())await tap('[data-act=setupGo]');
  await page.locator('[data-act=carDetail], [data-act=carConfirm]').first().waitFor({timeout:120000});
  console.log('CAR',await page.locator('#ui').innerText());
  if(await page.locator('[data-act=carDetail]').count())await tap('[data-act=carDetail]');
  await tap('[data-act=carConfirm]');
  await page.waitForFunction(()=>window.__game?.state==='race',null,{timeout:900000});
  console.log('RACE',device,await page.evaluate(()=>({render:__renderInfo(),metrics:__assetMetrics,heap:performance.memory?.usedJSHeapSize,state:__game.state})));
  await screenshot(page,resolve(out,device+(landscape?'-landscape-race.png':'-portrait-race.png')));
  if (!landscape) await page.setViewportSize(devices[device+' landscape'].viewport);
  const bounds=await page.evaluate(()=>[...document.querySelectorAll('#touch-controls button,.touch-steer')].filter(el=>!el.hidden).map(el=>({action:el.dataset.action||'steer',...Object.fromEntries(['x','y','width','height'].map(k=>[k,el.getBoundingClientRect()[k]]))})));
  console.log('BOUNDS',device,JSON.stringify(bounds));
  const pedal=bounds.find(b=>b.action==='throttle'),steer=bounds.find(b=>b.action==='steer');
  const points=[{id:1,x:pedal.x+pedal.width/2,y:pedal.y+pedal.height/2},{id:2,x:steer.x+steer.width*.6,y:steer.y+steer.height/2}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});
  await page.waitForFunction(()=>__sim.input.throttle===1 && __sim.input.steer>0 && __sim.player.veh.vLong>0,null,{timeout:60000});
  const drive=await page.evaluate(()=>({input:__sim.input,speed:__sim.player.veh.vLong,state:__game.state}));
  console.log('DRIVE',device,JSON.stringify(drive));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  if(!baseline){assert.equal(drive.input.throttle,1);assert(drive.input.steer>0);assert(drive.speed>0);}
  for(const cpu of [1,4]){
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
   const frames=await page.evaluate(()=>new Promise(done=>{let start=performance.now(),last=start,ms=[];function tick(t){ms.push(t-last);last=t;if(t-start<5000)requestAnimationFrame(tick);else done({fps:ms.length*1000/(t-start),p95:ms.sort((a,b)=>a-b)[Math.floor(ms.length*.95)],render:__renderInfo(),heap:performance.memory?.usedJSHeapSize,metrics:__assetMetrics});}requestAnimationFrame(tick);}));
   report.runs.push({device,cpu,frames,drive,bounds});console.log('PERF',device,cpu,JSON.stringify(frames));
  }
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  if (process.argv.includes('--race')) {
   // Read-only telemetry chooses a steering target. Only CDP touch events drive
   // the vehicle: no key presses, teleports, simulation steps or input injection.
   await page.locator('#touch-controls [data-action=pause]').tap();
   await page.locator('[data-act=resume]').tap();
   const start=Date.now();let lastLog=0,activePedal,started=false;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:2,x:steer.x+steer.width/2,y:steer.y+steer.height/2}]});
   while(Date.now()-start<720000){
    const drive=await page.evaluate(()=>{
     const v=__sim.player.veh,r=__sim.route,look=8+Math.max(0,v.vLong)*.85,p=r.point(v.s+look,r.racingU(v.s+look));
     const dx=p.x-v.x,dz=p.z-v.z,k=2*(dx*Math.cos(v.yaw)-dz*Math.sin(v.yaw))/(dx*dx+dz*dz);
     let turn=0;for(let ds=0;ds<45;ds+=5)turn=Math.max(turn,Math.abs(r.curv(v.s+ds)));
     const target=Math.min(23,Math.max(7,Math.sqrt(3.5/Math.max(.001,turn))));
     return {state:__game.state,screen:__flow.menu.screen,s:v.s,speed:v.vLong,steer:v.steerInputFor(k,Math.max(1,v.vLong)),pedal:v.vLong<target?'throttle':v.vLong>target+2?'brake':null,u:v.u,course:__game.ev?.next};
    });
    if(drive.screen==='results'){report.runs.push({device,race:drive,wallMs:Date.now()-start});console.log('FINISHED',device,JSON.stringify(drive));break;}
    if(drive.state==='finished'){await page.waitForTimeout(100);continue;}
    assert.equal(drive.state,'race',JSON.stringify(drive));
    const steering={id:2,x:steer.x+steer.width/2+Math.max(-1,Math.min(1,drive.steer))*steer.width*.4,y:steer.y+steer.height/2};
    if(drive.pedal!==activePedal){await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});activePedal=drive.pedal;const touches=[steering];if(activePedal){const b=bounds.find(b=>b.action===activePedal);touches.push({id:1,x:b.x+b.width/2,y:b.y+b.height/2});}await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches});}
    const touches=[steering];if(activePedal){const b=bounds.find(b=>b.action===activePedal);touches.push({id:1,x:b.x+b.width/2,y:b.y+b.height/2});}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touches});
    if(Date.now()-lastLog>10000){console.log('LAP',device,JSON.stringify(drive));lastLog=Date.now();}
    await page.waitForTimeout(100);
   }
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.equal(await page.evaluate(()=>__flow.menu.screen),'results','full touch race must reach results');
  }
  await context.close();
 }
 }
} finally {await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));await browser.close();await app.close();}
