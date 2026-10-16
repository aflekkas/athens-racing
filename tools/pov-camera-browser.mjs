import {resolve} from 'node:path';import fs from 'node:fs/promises';import {createGameServer} from '../server/index.mjs';
const {chromium}=await import('/tmp/pw/node_modules/playwright/index.mjs');
const root=resolve('.'),out=resolve('.scratch/pov-camera');await fs.mkdir(out,{recursive:true});
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(300000);page.on('console',m=>console.log('BROWSER',m.text()));page.on('pageerror',e=>console.log('PAGEERROR',e.stack));
const monitor=setInterval(()=>page.evaluate(()=>({state:window.__game?.state,body:document.body.className,text:document.body.innerText.slice(-150)})).then(v=>console.log('STATUS',JSON.stringify(v))).catch(()=>{}),30000);
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async r=>r.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',r.request().url().split('three@0.170.0/')[1])),contentType:'text/javascript'}));
for(const file of ['pov-audit.js','pov-mask.js'])await page.route('**/tools/'+file,async r=>r.fulfill({body:await fs.readFile(resolve(root,'tools',file)),contentType:'text/javascript'}));
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>cb.name==='frame'?raf(t=>{if(!window.__holdFrame)cb(t);}):raf(cb);});
try{
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&quality=low&fixedres&map=riviera&notraffic`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.classList.contains('loaded'));console.log('MENU LOADED');
 await page.evaluate(()=>{__flow.startEvent(__flow.freeRoamDef(),{car:'mini'});});
 await page.waitForFunction(()=>window.__sim?.player&&['race','countdown'].includes(window.__game?.state)&&!document.body.classList.contains('fading'),null,{timeout:600000});await page.evaluate(()=>{window.__holdFrame=true;window.__povStart={s:__sim.player.veh.s,u:__sim.player.veh.u};});
 console.log('RIVIERA LOADED');clearInterval(monitor);const ids=await page.evaluate(async()=>{const {CARS}=await import('/src/cars.js'),{CAR_MODELS}=await import('/src/car-catalog.js');const selected=new Set([...CAR_MODELS.map(m=>m.trims.includes(m.id)?m.id:m.trims[0]),'mini_jcw']);return CARS.map(c=>c.id).filter(id=>selected.has(id));});const rows=JSON.parse(await fs.readFile(resolve(out,'audit.json'),'utf8').catch(()=>'[]'));
 for(const id of process.env.CAPTURE_IDS?.split(',')||ids){
  if(rows.some(r=>r.id===id)){console.log('RESUME SKIP',id);continue;}
  const row=await page.evaluate(async id=>{
   console.log('CAR START',id);const T=await import('three'),{auditPov}=await import('/tools/pov-audit.js'),{renderPovMask}=await import('/tools/pov-mask.js'),{DEFAULTS}=await import('/src/settings.js'),{setPovExteriorView}=await import('/src/pov-visibility.js');__flow.switchRoamCar(id);window.__holdFrame=true;console.log('CAR SWITCHED',id);
   const {player,camera,scene,renderer}=__sim;const {model,cockpit}=player;
   player.veh.reset(window.__povStart.s,window.__povStart.u,0);__game.cam='cockpit';__game.countWall=performance.now()-5000;__sim.step(1,1/60);__sim.cameraBlend.active=false;__sim.render();console.log('SCENE RENDERED',id);
   model.root.updateMatrixWorld(true);const base=model.seat.clone().add(new T.Vector3(0,.02,0)),after=cockpit.eye.clone();
   const captures={};for(const [phase,eye]of [['before',base],['after',after]]){
    cockpit.setVisible(true);if(phase==='before'){setPovExteriorView(model,false);if(cockpit.wheel)cockpit.wheel.visible=true;if(cockpit.steering)cockpit.steering.visible=true;}cockpit.update(0,{ignition:true,rpm:3500,kmh:85,redline:player.spec.redline,gearLabel:'3',steerInput:0,vehicle:player.veh});camera.position.copy(eye);model.body.localToWorld(camera.position);camera.quaternion.copy(model.body.getWorldQuaternion(new T.Quaternion())).multiply(new T.Quaternion().setFromEuler(new T.Euler(phase==='before'?-.045:cockpit.eyePitch,0,0,'YXZ')));camera.fov=DEFAULTS.cockpitFov;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    console.log('CAPTURE',id,phase);renderer.info.reset();renderer.render(scene,camera);console.log('AUDIT',id,phase);captures[phase]={...auditPov(model,cockpit,camera),image:renderer.domElement.toDataURL().split(',')[1],render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles},...renderPovMask(renderer,model,camera,1280,800)};
   }console.log('DONE',id);return {id,name:player.spec.name,...captures};
  },id);
  for(const phase of ['before','after']){await fs.writeFile(resolve(out,phase+'-'+id+'.png'),Buffer.from(row[phase].image,'base64'));delete row[phase].image;await fs.writeFile(resolve(out,phase+'-'+id+'-riviera-mask.png'),Buffer.from(row[phase].mask,'base64'));delete row[phase].mask;}
  rows.push(row);console.log(id,JSON.stringify(row.after));await fs.writeFile(resolve(out,'audit.json'),JSON.stringify(rows,null,2));
 }
 await page.evaluate(()=>{__flow.pause();__flow.menu.show('settings',{tab:'camera',from:'pause'},true);});
 const controls=await page.evaluate(async()=>{
  const C=await import('/src/ui/components.js'),S=await import('/src/seat-position.js'),id=__sim.player.spec.id,root=__flow.menu.root;
  C.setValue(root.querySelector('[data-key=seat-height]'),.08);C.setValue(root.querySelector('[data-key=seat-position]'),-.08);
  const saved={...S.seatPosition(id)},stored=JSON.parse(localStorage.getItem('paraliaki.seat-position'))[id];
  __flow.menu.refreshValues();const values=[...root.querySelectorAll('[data-key^=seat-] .slider')].map(e=>e.getAttribute('aria-valuenow'));
  if(saved.height!==.08||saved.position!==-.08||stored.height!==.08)throw Error('Seat controls did not persist');
  return {id,saved,stored,values};
 });
 await page.screenshot({path:resolve(out,'seat-settings-adjusted.png')});
 await page.locator('[data-act="seatReset"]').click();
 controls.reset=await page.evaluate(async()=>{const S=await import('/src/seat-position.js');return S.seatPosition(__sim.player.spec.id);});
 if(controls.reset.height!==0||controls.reset.position!==0)throw Error('Seat reset failed');
 await fs.writeFile(resolve(out,'seat-controls.json'),JSON.stringify(controls,null,2));
 await page.screenshot({path:resolve(out,'seat-settings.png')});
}catch(error){await page.screenshot({path:resolve(out,'capture-error.png'),timeout:60000}).catch(()=>{});console.log(await page.evaluate(()=>document.body.innerText).catch(()=>''));throw error;}finally{clearInterval(monitor);await browser.close();await app.close();}
