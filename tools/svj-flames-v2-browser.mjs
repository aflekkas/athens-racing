import {resolve} from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createGameServer} from '../server/index.mjs';
const {chromium}=await import('/tmp/pw/node_modules/playwright/index.mjs');
const root=resolve('.'),out=resolve('.scratch/svj/flames-v2');await fs.mkdir(out,{recursive:true});
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(240000);const errors=[],consoleErrors=[],resourceErrors=[];
page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)resourceErrors.push({url:r.url(),status:r.status()});});
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async r=>r.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',r.request().url().split('three@0.170.0/')[1])),contentType:'text/javascript'}));
await page.route('**/tools/svj-geometry.js',async r=>r.fulfill({body:await fs.readFile(resolve(root,'tools/svj-geometry.js')),contentType:'text/javascript'}));
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__holdFrame&&cb.name==='frame'?0:raf(cb);});
const save=async(n,direct=false)=>{const data=await page.evaluate(direct=>{if(direct)__sim.renderer.render(__sim.scene,__sim.camera);else __sim.render();return __sim.canvas.toDataURL('image/png').split(',')[1];},direct);await fs.writeFile(resolve(out,n+'.png'),Buffer.from(data,'base64'));};
try{
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&car=aventador_svj&quality=low&fixedres&map=megara&event=free&notraffic`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__sim?.player?.spec.id==='aventador_svj'&&document.body.classList.contains('loaded'));
 await page.evaluate(()=>{window.__holdFrame=true;__flow.menu.hide();__game.state='race';__game.cam='chase';window.__svjStart=__sim.player.veh.s;__sim.step(90,1/60);});console.log('READY');
 const geometry=await page.evaluate(async()=>{const {checkSVJGeometry}=await import('/tools/svj-geometry.js');return checkSVJGeometry();});await fs.writeFile(resolve(out,'geometry-checks.json'),JSON.stringify(geometry,null,2));
 for(const time of ['day','night']){
  await page.evaluate(time=>{__flow.setRoamConditions({time,weather:'clear'});__worldLife.world.clockDynamic=false;__worldLife.world.weatherDynamic=false;const v=__sim.player.veh;__sim.keys.clear();v.reset(window.__svjStart,0);v.setManual(false);__game.state='race';__game.cam='chase';__sim.step(60,1/60);},time);
  await page.keyboard.down('w');
  await page.evaluate(()=>{const sim=__sim,p=sim.player.model.exhaustFlames.pulse,n=p.serial;for(let i=0;i<600;i++){sim.step(1,1/60);if(p.serial>n&&p.kind===2&&p.life>0)return;}throw Error('No loaded ISR cut');});
  for(const kind of [2,1]){
  if(process.env.SVJ_CAPTURE_KIND==='overrun'&&kind===2)continue;
  if(kind===1){await page.keyboard.down('w');await page.evaluate(()=>{for(let i=0;i<600;i++){__sim.step(1,1/60);if(__sim.player.veh.rpm>=7000&&__sim.player.veh.gear>=2&&__sim.player.veh.shiftT<=0&&__sim.player.veh.clutch>.95)return;}throw Error('No hot gear-two lift point');});await page.keyboard.up('w');await page.evaluate(()=>{const sim=__sim,p=sim.player.model.exhaustFlames.pulse,n=p.serial;for(let i=0;i<240;i++){sim.step(1,1/120);if(p.serial>n&&p.kind===1&&p.life>0)return;}throw Error('No lift burble '+JSON.stringify({rpm:sim.player.veh.rpm,clutch:sim.player.veh.clutch,throttle:sim.input.throttle,signals:sim.player.veh.powertrainSignals,overrun:p.overrun,serial:p.serial}));});}
  const frames=[],name=time+'-'+(kind===2?'upshift':'overrun'),dt=kind===2?1/120:1/60;
  for(let i=0;i<12;i++){
   const state=await page.evaluate(({i,dt})=>{const sim=__sim,p=sim.player.model.exhaustFlames.pulse;if(i)sim.step(1,dt);sim.player.cockpit.rearLast=-Infinity;sim.render();return{png:sim.canvas.toDataURL('image/png').split(',')[1],frame:i,time:i*dt,kind:p.kind,serial:p.serial,life:p.life,rpm:sim.player.veh.rpm,throttle:sim.input.throttle,overrun:sim.player.veh.overrun,conditions:__conditions()};},{i,dt});await fs.writeFile(resolve(out,name+'-'+String(i).padStart(2,'0')+'.png'),Buffer.from(state.png,'base64'));delete state.png;frames.push(state);
  }
  await page.keyboard.up('w');await fs.writeFile(resolve(out,name+'.json'),JSON.stringify(frames,null,2));assert.equal(frames[0].conditions.time,time);console.log('SEQUENCE',name,frames.map(f=>[f.kind,f.life]));
 }
 }
 await fs.writeFile(resolve(out,'browser-errors.json'),JSON.stringify(errors,null,2));await fs.writeFile(resolve(out,'resource-errors.json'),JSON.stringify(resourceErrors,null,2));await fs.writeFile(resolve(out,'console-errors.json'),JSON.stringify(consoleErrors,null,2));assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors.filter(x=>/Shader Error|THREE.WebGLProgram|VALIDATE_STATUS/.test(x)),[]);
}finally{await browser.close();await app.close();}
