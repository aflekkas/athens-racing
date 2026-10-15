import {resolve} from 'node:path';
import fs from 'node:fs/promises';
import {createGameServer} from '../server/index.mjs';
const {chromium}=await import('/tmp/pw/node_modules/playwright/index.mjs');
const root=resolve('.'),out=resolve('.scratch/svj');
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(180000);const errors=[];
page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
page.on('pageerror',e=>{errors.push(e.stack);console.log('PAGEERROR',e.stack);});
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async r=>r.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',r.request().url().split('three@0.170.0/')[1])),contentType:'text/javascript'}));
await page.route('**/tools/svj-*.js',async r=>r.fulfill({body:await fs.readFile(resolve(root,'tools',new URL(r.request().url()).pathname.split('/').at(-1))),contentType:'text/javascript'}));
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__holdFrame&&cb.name==='frame'?0:raf(cb);});
const save=async n=>{await page.screenshot({path:resolve(out,n+'.png')});console.log('CAPTURE',n);};
try{
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&quality=low&fixedres&map=megara&notraffic`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.classList.contains('loaded'));await page.evaluate(()=>window.__holdFrame=true);
 await page.evaluate(async()=>{const {CARS}=await import('/src/cars.js');__flow.menu.show('car',{index:CARS.findIndex(c=>c.id==='aventador_svj'),detail:true,garage:true});});
 await page.waitForSelector('#carStage canvas');await page.waitForTimeout(600);await save('garage');
 console.log('START');await page.evaluate(()=>{__flow.startEvent(__flow.freeRoamDef(),{car:'aventador_svj'});});
 await page.waitForFunction(()=>window.__sim?.player?.spec.id==='aventador_svj'&&!document.body.classList.contains('fading'),null,{timeout:240000});
 await page.evaluate(()=>{window.__holdFrame=true;__game.countWall=performance.now()-5000;__sim.step(90,1/60);});
 const checks=await page.evaluate(async()=>{const {checkSVJGeometry}=await import('/tools/svj-geometry.js');return checkSVJGeometry();});await fs.writeFile(resolve(out,'geometry-checks.json'),JSON.stringify(checks,null,2));
 const audit=await page.evaluate(async()=>{const m=__sim.player.model;let finite=true,vertices=0;m.root.traverse(o=>{const a=o.geometry?.attributes.position;if(a){vertices+=a.count;for(let i=0;i<a.array.length;i++)if(!Number.isFinite(a.array[i]))finite=false;}});return{finite,vertices,dims:m.dims,wheels:m.wheels.length,exhaust:m.exhaust.map(x=>x.toArray()),flames:!!m.exhaustFlames,errors:[]};});console.log(audit);await fs.writeFile(resolve(out,'geometry.json'),JSON.stringify(audit,null,2));
 for(const [name,pos]of [['front-three-quarter',[-5,2,-6]],['rear-three-quarter',[5,2,6]],['side',[7,1.4,0]]]){
  const data=await page.evaluate(({pos})=>{const {player,camera,renderer,scene}=__sim;const base=player.model.root.position;camera.position.set(...pos).applyQuaternion(player.model.root.quaternion).add(base);camera.lookAt(base.x,base.y+.6,base.z);renderer.render(scene,camera);return renderer.domElement.toDataURL().split(',')[1];},{pos});await fs.writeFile(resolve(out,name+'.png'),Buffer.from(data,'base64'));console.log('CAPTURE',name);
 }
 await page.evaluate(()=>{__game.cam='cockpit';__sim.step(90,1/60);__sim.render();});await save('cockpit');
 const audio=await page.evaluate(async()=>{const {captureSVJ}=await import('/tools/svj-audio.js');return captureSVJ();});await fs.writeFile(resolve(out,'pull-with-pops.wav'),Buffer.from(audio.wav,'base64'));delete audio.wav;if(audio.cockpitImage){await fs.writeFile(resolve(out,'cockpit.png'),Buffer.from(audio.cockpitImage,'base64'));delete audio.cockpitImage;}await fs.writeFile(resolve(out,'audio-metrics.json'),JSON.stringify(audio,null,2));console.log('AUDIO',audio.db,audio.events.length);
 for(const time of ['day','night']){
  await page.evaluate(time=>{__flow.setRoamConditions({time,weather:'clear'});__game.cam='chase';__sim.player.veh.reset(__sim.player.veh.s,2);__sim.player.veh.setManual(false);},time);
  for(const kind of [2,1]){
   const result=await page.evaluate(kind=>{const sim=__sim,v=sim.player.veh,p=sim.player.model.exhaustFlames.pulse;let found=false;const initial=p.serial;for(let i=0;i<480;i++){if(kind===1&&v.rpm>5500)sim.keys.delete('KeyW');else sim.keys.add('KeyW');sim.input.brake=0;sim.input.steer=0;sim.step(1,1/60);if(p.serial>initial&&p.kind===kind&&p.life>0){found=true;break;}}sim.render();return{found,rpm:v.rpm,gear:v.gear,kind:p.kind,serial:p.serial,life:p.life};},kind);
   if(!result.found)throw new Error('Expected a physical exhaust event');console.log('FLAME',time,kind,result);await save('chase-'+time+'-'+(kind===2?'upshift':'overrun'));await fs.writeFile(resolve(out,'chase-'+time+'-'+kind+'.json'),JSON.stringify(result,null,2));
  }
 }
 await fs.writeFile(resolve(out,'browser-errors.json'),JSON.stringify(errors,null,2));
}catch(e){await save('error');console.log(await page.evaluate(()=>document.body.innerText));throw e;}finally{await browser.close();await app.close();}
