// Run through tools/browser-slot.sh. Requires PLAYWRIGHT_MODULE (or playwright).
// Git revisions are served in memory: the shared checkout/index are never changed.
import {resolve} from 'node:path';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createGameServer} from '../server/index.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(),out=resolve(root,'.scratch/cabin-fixes/evidence');
const scratch=await fs.mkdtemp(resolve(tmpdir(),'cabin-benchmark-'));
const app=await createGameServer({root,dataDir:resolve(scratch,'server')});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
let browser;
const report={method:'Real app, Megara, MINI chase, 3 AI (test-only override), 74 traffic pool, SwiftShader, 640x400 including post targets; frozen standard chase camera, 4 warmup + 12 measured frames; CPU submission excludes readPixels, completed frame includes readPixels.',baselineCommit:'5149f16d',beforeCommit:'b99589d5'};
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 for(const phase of ['baseline','before','after']){
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(600000);
  page.on('pageerror',e=>console.error(phase,e.stack));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async r=>r.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',r.request().url().split('three@0.170.0/')[1])),contentType:'text/javascript'}));
  await page.route('**/src/events.js*',async r=>r.fulfill({body:(await fs.readFile(resolve(root,'src/events.js'),'utf8')).replace('MAX_RIVALS = 2','MAX_RIVALS = 3'),contentType:'text/javascript'}));
  const files=phase==='baseline'?['cars.js','cockpit.js','fleet-cockpit.js','glass-tint.js','main.js','traffic-fleet.js','vehicle-models.js']:phase==='before'?['vehicle-cabin.js']:[];
  for(const file of files){const body=execFileSync('git',['show',`${phase==='baseline'?'5149f16d':'b99589d5'}:src/${file}`]);await page.route('**/src/'+file+'*',r=>r.fulfill({body,contentType:'text/javascript'}));}
  // Settle world detail for this frozen view, independent of the live loop's
  // six-frame LOD cadence. This hook is served only to the benchmark browser.
  const main=(phase==='baseline'?execFileSync('git',['show','5149f16d:src/main.js']).toString():await fs.readFile(resolve(root,'src/main.js'),'utf8')).replace('render: () => render(),','updateLod: () => updateLod(), render: () => render(),');
  await page.route('**/src/main.js*',r=>r.fulfill({body:main,contentType:'text/javascript'}));
  await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>cb.name==='frame'?raf(t=>{if(!window.__holdFrame)cb(t);}):raf(cb);});
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&quality=low&fixedres&map=megara`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.classList.contains('loaded'));
  await page.evaluate(async()=>{const EV=await import('/src/events.js');__flow.startEvent({...EV.QUICK_RACE,rivalCount:3,traffic:1},{car:'mini'});});
  await page.waitForFunction(()=>window.__sim?.player&&['race','countdown'].includes(__game.state)&&!document.body.classList.contains('fading'));
  await page.evaluate(async()=>{
   window.__holdFrame=true;__game.cam='chase';__game.state='countdown';__game.countWall=performance.now();__sim.cameraBlend.active=false;__sim.step(1,1/60);
   const {chaseRig}=await import('/src/vehicle-camera.js'),{player,camera,renderer,post}=__sim,v=player.veh,{back,up,targetY}=chaseRig(player.spec,0);
   camera.position.set(v.x+Math.sin(v.yaw)*back,v.y+up,v.z+Math.cos(v.yaw)*back);camera.lookAt(v.x-Math.sin(v.yaw)*5,v.y+targetY,v.z-Math.cos(v.yaw)*5);camera.fov=60;camera.aspect=1.6;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
   renderer.setPixelRatio(1);renderer.setSize(640,400,false);post.setSize(640,400,1);__sim.updateLod();
  });
  report[phase]=await page.evaluate(()=>{
   const {renderer,camera,cars,traffic}=__sim,gl=renderer.getContext(),pixel=new Uint8Array(4),cpuSamples=[],samples=[];
   for(let i=0;i<16;i++){const start=performance.now();__sim.render();const cpu=performance.now()-start;gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);if(i>=4){cpuSamples.push(cpu);samples.push(performance.now()-start);}}
   const percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))];
   return {renderSize:[renderer.domElement.width,renderer.domElement.height],ai:cars.length-1,traffic:traffic.cars.length,activeTraffic:traffic.cars.filter(c=>c.active).length,cpuMedian:percentile(cpuSamples,.5),cpuP95:percentile(cpuSamples,.95),cpuSamples,median:percentile(samples,.5),samples,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,camera:camera.position.toArray(),quaternion:camera.quaternion.toArray()};
  });
  console.log(phase,JSON.stringify(report[phase]));await page.close();
 }
 report.delta={calls:report.after.calls-report.baseline.calls,cpuMedian:report.after.cpuMedian-report.baseline.cpuMedian};
 report.targets={extraCalls:40,extraCpuMedianMs:1.5};
 report.priorReported={baseline:{calls:302,cpuMedian:10.2},round2:{calls:485,cpuMedian:16.5},note:'Prior temporary harness was removed. This replay records a fixed chase camera and settles the world LOD; absolute scene draws differ, but the round-2 overhead reproduces at +183 draws.'};
 await fs.writeFile(resolve(out,'frame-cost.json'),JSON.stringify(report,null,2));
 if(report.delta.calls>report.targets.extraCalls||report.delta.cpuMedian>report.targets.extraCpuMedianMs)throw Error('Cabin render budget exceeded; see frame-cost.json');
}finally{await browser?.close();await app.close();await fs.rm(scratch,{recursive:true,force:true});}
