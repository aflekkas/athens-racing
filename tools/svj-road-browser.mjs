import {resolve} from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createGameServer} from '../server/index.mjs';
const {chromium}=await import('/tmp/pw/node_modules/playwright/index.mjs');
const root=resolve('.'),out=resolve('.scratch/svj'),app=await createGameServer({root,dataDir:resolve(out,'server-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(240000);const errors=[];
page.on('pageerror',e=>{errors.push(e.stack);console.log('PAGEERROR',e.stack);});
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async r=>r.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',r.request().url().split('three@0.170.0/')[1])),contentType:'text/javascript'}));
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__holdFrame&&cb.name==='frame'?0:raf(cb);});
const save=async n=>{const data=await page.evaluate(()=>{__sim.render();return __sim.canvas.toDataURL('image/png').split(',')[1];});await fs.writeFile(resolve(out,n+'.png'),Buffer.from(data,'base64'));console.log('CAPTURE',n);};
try{
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&car=aventador_svj&quality=low&fixedres&map=megara&event=free&notraffic`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__sim?.player?.spec.id==='aventador_svj'&&document.body.classList.contains('loaded'));
 await page.evaluate(()=>{window.__holdFrame=true;__flow.menu.hide();__game.state='race';__game.cam='chase';window.__svjStart=__sim.player.veh.s;__sim.step(90,1/60);});console.log('ROAD READY');
 for(const time of ['day','night']){
  await page.evaluate(time=>{__flow.setRoamConditions({time,weather:'clear'});const v=__sim.player.veh;__sim.keys.clear();v.reset(window.__svjStart,0);v.setManual(false);__game.state='race';__game.cam='chase';__sim.step(60,1/60);},time);
  await page.keyboard.down('w');
  const shift=await page.evaluate(()=>{const sim=__sim,v=sim.player.veh,p=sim.player.model.exhaustFlames.pulse,n=p.serial;let found=false;for(let i=0;i<480;i++){sim.step(1,1/60);if(p.serial>n&&p.kind===2&&p.life>0){found=true;break;}}sim.player.cockpit.rearLast=-Infinity;sim.render();return{found,rpm:v.rpm,gear:v.gear,speed:v.kmh,kind:p.kind,serial:p.serial,life:p.life,throttle:sim.input.throttle,state:__game.state,keys:[...sim.keys],conditions:window.__conditions(),mirrorUpdates:sim.player.cockpit.mirrorUpdates};});
  console.log('SHIFT',time,shift);await save('chase-'+time+'-upshift');await fs.writeFile(resolve(out,'chase-'+time+'-upshift.json'),JSON.stringify(shift,null,2));assert.ok(shift.found,'real loaded upshift must flame');assert.equal(shift.conditions.time,time,'capture must use the requested world time');
  await page.keyboard.up('w');
  const lift=await page.evaluate(()=>{const sim=__sim,v=sim.player.veh,p=sim.player.model.exhaustFlames.pulse,n=p.serial;let found=false;for(let i=0;i<180;i++){sim.step(1,1/60);if(p.serial>n&&p.kind===1&&p.life>0){found=true;break;}}sim.player.cockpit.rearLast=-Infinity;sim.render();return{found,rpm:v.rpm,gear:v.gear,speed:v.kmh,kind:p.kind,serial:p.serial,life:p.life,overrun:v.overrun,throttle:sim.input.throttle};});
  console.log('OVERRUN',time,lift);await save('chase-'+time+'-overrun');await fs.writeFile(resolve(out,'chase-'+time+'-overrun.json'),JSON.stringify(lift,null,2));assert.ok(lift.found,'real high-rpm lift must flame');
 }
 await fs.writeFile(resolve(out,'road-errors.json'),JSON.stringify(errors,null,2));assert.deepEqual(errors,[]);
}finally{await browser.close();await app.close();}
