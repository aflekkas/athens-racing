// Follow tools/browser-slot.sh: one sequential browser job, paired source archives.
import http from 'node:http';
import fs from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const after=resolve(process.argv[2]),before=resolve(process.argv[3]),out=resolve(process.argv[4]);await fs.mkdir(out,{recursive:true});
const {createGameServer}=await import(pathToFileURL(resolve(after,'server/index.mjs')));
const app=await createGameServer({root:after,dataDir:resolve(out,'server-data')});
let root=before;
const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.bin':'application/octet-stream','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname.startsWith('/api/')||pathname==='/health')return app.server.emit('request',req,res);try{let file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(pathname.startsWith('/vendor/'))file=resolve(after,'node_modules/three',pathname.slice(8));let body=await fs.readFile(file);if(file.endsWith('index.html'))body=Buffer.from(body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/vendor/'));res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':body.length,'Cache-Control':'no-store'});res.end(body);}catch{res.writeHead(404);res.end();}});
server.on('upgrade',(...args)=>app.server.emit('upgrade',...args));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import('/tmp/pw/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true,executablePath:'/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const variants=process.env.CPU_VARIANT?[process.env.CPU_VARIANT]:['before','after'];
const results=process.env.CPU_VARIANT?JSON.parse(await fs.readFile(resolve(out,'browser-metrics.json'),'utf8')).filter(r=>!variants.includes(r.variant)):[];
try{for(const variant of variants){
 root=variant==='before'?before:after;const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];
 globalThis.cpuBrowser={page,browser,context};
 page.on('pageerror',e=>{errors.push(String(e));console.log('PAGEERROR',String(e));});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());console.log(variant,m.type(),m.text().slice(0,500));});
 await page.addInitScript(()=>{
  localStorage.setItem('paraliaki.graphics','low');localStorage.setItem('paraliaki.graphics-onboarding','1');
  localStorage.setItem('paraliaki.settings',JSON.stringify({dynamicResolution:false,hudMotion:'off',frameCap:60}));
  let seed=9001;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  window.cpuReport={enabled:false,frames:0,systems:{},longTasks:[],input:[],inputAt:0,framesMs:[]};
  new PerformanceObserver(list=>{if(cpuReport.enabled)for(const e of list.getEntries())cpuReport.longTasks.push(e.duration);}).observe({type:'longtask'});
  addEventListener('keydown',e=>{if(e.isTrusted)cpuReport.inputAt=performance.now();});
  const raf=requestAnimationFrame;window.__freeze=true;
  window.requestAnimationFrame=function(cb){return raf(t=>{if(window.__freeze&&cb.name==='frame')return;if(cb.name!=='frame')return cb(t);const start=performance.now();cb(t);if(cpuReport.enabled){cpuReport.frames++;cpuReport.framesMs.push(performance.now()-start);if(cpuReport.inputAt){cpuReport.input.push(performance.now()-cpuReport.inputAt);cpuReport.inputAt=0;}}});};
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/?simhook&s=4200&quality=low&guest=1&fixeddt&autodrive&cpuProfile&debug`,{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>window.__sim?.player&&document.body.classList.contains('loaded'),null,{timeout:600000}).catch(async error=>{console.log('BOOT FAILURE',errors,await page.locator('body').innerText());await page.screenshot({path:resolve(out,variant+'-boot-failure.png')});throw error;});
 console.log(variant+' loaded');
 await page.evaluate(async()=>{
  const s=__sim,f=__flow;await f.startEvent({...f.event().def,id:'cpu-busy',rivals:2,traffic:2,police:true,rules:{police:true},conditions:{time:'morning',weather:'clear'}});
  s.G.state='race';s.G.autodrive=true;f.menu.hide();document.body.classList.remove('counting');document.body.classList.add('racing');__police.reset(true);
  const wrap=(object,key,name)=>{const original=object[key];if(!original)return;object[key]=function(...args){const t=performance.now();try{return original.apply(this,args);}finally{if(cpuReport.enabled)cpuReport.systems[name]=(cpuReport.systems[name]||0)+performance.now()-t;}};};
  const {Vehicle}=await import('/src/physics.js'),{RivalAI}=await import('/src/rival-ai.js'),{Audio}=await import('/src/audio.js'),{Hud}=await import('/src/hud.js');
  const original=Vehicle.prototype.update;Vehicle.prototype.update=function(...args){const t=performance.now();try{return original.apply(this,args);}finally{if(cpuReport.enabled){const n=this===__sim.player.veh?'playerPhysics':'rivalPhysics';cpuReport.systems[n]=(cpuReport.systems[n]||0)+performance.now()-t;}};};
  wrap(RivalAI.prototype,'update','rivalPlanning');wrap(Audio.prototype,'update','audio');wrap(Hud.prototype,'update','hud');wrap(s.traffic,'update','traffic');wrap(__police,'update','police');wrap(s.people,'update','pedestrians');
  // Sustained solver workload, without changing racer contacts.
  window.__launchBodies=()=>{const v=__sim.player.veh;for(let i=0;i<3;i++)__sim.people.bodies.spawn({x:v.x+12+i,y:v.y,z:v.z,s:v.s,vx:12,vz:4,seed:i});};
  __launchBodies();window.__bodyTimer=setInterval(__launchBodies,1800);
 });
 console.log(variant+' scene configured');await page.keyboard.press('ArrowUp');console.log(variant+' audio input received');await page.evaluate(()=>{__sim.step(5);});await page.waitForTimeout(300);
 console.log(variant+' warmup done');const cdp=await context.newCDPSession(page);globalThis.cpuBrowser.cdp=cdp;await cdp.send('Performance.enable');
 const beforeMetrics=await cdp.send('Performance.getMetrics');

 await page.evaluate(()=>{cpuReport.enabled=true;cpuReport.start=performance.now();window.__cpuMetrics?.reset();const tick=()=>{if(!cpuReport.enabled)return;const start=performance.now();__sim.step(1);cpuReport.frames++;cpuReport.framesMs.push(performance.now()-start);if(cpuReport.inputAt){cpuReport.input.push(performance.now()-cpuReport.inputAt);cpuReport.inputAt=0;}cpuReport.timer=setTimeout(tick,Math.max(0,1000/60-(performance.now()-start)));};cpuReport.timer=setTimeout(tick,0);setTimeout(()=>{cpuReport.enabled=false;clearTimeout(cpuReport.timer);},60000);});
 console.log(variant+' measuring 60 s');
 const inputs=setInterval(()=>{page.keyboard.press('ArrowUp').catch(()=>{});},10000);await page.waitForTimeout(60500);clearInterval(inputs);console.log(variant+' timer finished');
 const report=await page.evaluate(()=>{cpuReport.enabled=false;clearInterval(__bodyTimer);const scene=__dbg();delete scene.rdbg;delete scene.pdbg;return {...cpuReport,seconds:(performance.now()-cpuReport.start)/1000,scene,render:__renderInfo(),workerDisabled:__sim.people.bodies.workerSim?.disabled,resources:performance.getEntriesByType('resource').reduce((s,r)=>({requests:s.requests+1,transferBytes:s.transferBytes+r.transferSize}),{requests:0,transferBytes:0})};});
 console.log(variant+' report read');const afterMetrics=await cdp.send('Performance.getMetrics');
 const gc=[]; // Browser-wide tracing waits on SwiftShader GPU processes; use measured Node GC instead.
 const get=(m,key)=>m.metrics.find(x=>x.name===key)?.value;
 const result={variant,mode:'CPU-only actual game step; GL paused during 60 s measurement',...report,systemMsPerFrame:Object.fromEntries(Object.entries(report.systems).map(([k,v])=>[k,v/report.frames])),mainTaskMsPerFrame:1000*(get(afterMetrics,'TaskDuration')-get(beforeMetrics,'TaskDuration'))/report.frames,gc:{available:false,count:null,totalMs:null,maxMs:null},heapBytes:get(afterMetrics,'JSHeapUsedSize')};
 delete result.framesMs;result.over50ms=report.framesMs.filter(n=>n>50).length;result.longTaskCount=report.longTasks.length;result.longTaskMaxMs=Math.max(0,...report.longTasks);result.inputToRenderSubmissionProxyMs=report.input.reduce((a,b)=>a+b,0)/Math.max(1,report.input.length);delete result.systems;
 results.push(result);await fs.writeFile(resolve(out,'browser-metrics.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({variant,frames:result.frames,mainTaskMsPerFrame:result.mainTaskMsPerFrame,errors}));
 // Match a stopped car and camera; dynamic resolution disabled in both variants for comparison.
 await page.evaluate(()=>{__freeze=true;const s=__sim;s.people.bodies.clear();s.player.veh.reset(4200,s.route.laneU(4200,0),0);s.G.cam='chase';s.step(1);const f=s.route.frame(4200,{}),p=s.route.point(4200,s.route.laneU(4200,0));s.camera.position.set(p.x-f.tx*9,p.y+3.5,p.z-f.tz*9);s.camera.lookAt(p.x+f.tx*12,p.y+1,p.z+f.tz*12);s.camera.updateMatrixWorld();s.render();});
 console.log(variant+' capturing race');await page.screenshot({path:resolve(out,variant+'-riviera.png'),timeout:60000});
 await page.evaluate(()=>{__flow.menu.show('settings',{tab:'video',from:'pause'});});await page.waitForTimeout(500);
 await page.screenshot({path:resolve(out,variant+'-video.png'),timeout:60000});
 if(variant==='after'){
  await page.getByText('Dynamic resolution',{exact:true}).first().waitFor();
  await page.evaluate(async()=>{const {settings,setSetting}=await import('/src/settings.js');setSetting('dynamicResolution',true);window.__dynamicPersisted=settings.dynamicResolution;});
 }
 await fs.writeFile(resolve(out,variant+'-browser-errors.json'),JSON.stringify(errors,null,2));await context.close();
}}finally{await browser.close();server.close();await app.close();}
