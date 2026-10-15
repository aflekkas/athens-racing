// Run: tools/browser-slot.sh node tools/car-trims-browser.mjs [artifact-directory]
import {resolve} from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createGameServer} from '../server/index.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/pw/node_modules/playwright/index.mjs');
const root=resolve(new URL('../',import.meta.url).pathname),out=resolve(process.argv[2]||'.scratch/car-trims-2');await fs.mkdir(out,{recursive:true});
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>{errors.push(e.stack);console.log('PAGEERROR',e.stack);});page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async route=>{const suffix=route.request().url().split('three@0.170.0/')[1];await route.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',suffix)),contentType:'text/javascript'});});
await page.route('**/tools/physics-test/jazz-slide.mjs',async route=>route.fulfill({body:await fs.readFile(resolve(root,'tools/physics-test/jazz-slide.mjs')),contentType:'text/javascript'}));
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__holdFrame&&cb.name==='frame'?0:raf(cb);});
page.setDefaultTimeout(120000);
try{
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&quality=low&fixedres&map=${process.env.JAZZ?'megara&notraffic':'penteli'}`,{waitUntil:'domcontentloaded'});
 console.log('DOM READY');await page.waitForFunction(()=>document.body.classList.contains('loaded'),null,{timeout:180000});console.log('LOADED');await page.evaluate(()=>{window.__holdFrame=true;});
 const show=async id=>{await page.evaluate(async id=>{const {CARS}=await import('/src/cars.js');__flow.menu.show('car',{index:CARS.findIndex(c=>c.id===id),detail:true,garage:true});},id);await page.waitForSelector('#carStage canvas');await page.waitForTimeout(500);};
 const capture=async name=>{
  if(process.env.RENDERER_ONLY&&!(process.env.GARAGE_UI&&name.startsWith('garage-'))){
   const result=await page.evaluate(name=>{
    const garage=name.startsWith('garage-');
    if(garage)__flow.menu.carView?.captureFrame?.();else __sim.render();
    const canvas=garage?document.querySelector('#carStage canvas'):__sim.canvas;
    return {image:canvas.toDataURL('image/png').split(',')[1],dom:{capture:'Actual WebGL renderer frame; HTML controls recorded separately.',name,trim:document.querySelector('[data-trim-current]')?.dataset.trimCurrent,text:document.body.innerText,classes:document.body.className}};
   },name);
   await fs.writeFile(resolve(out,name+'.png'),Buffer.from(result.image,'base64'));
   await fs.writeFile(resolve(out,name+'.dom.json'),JSON.stringify(result.dom,null,2));
  }else{
   await page.evaluate(()=>__flow.menu.carView?.captureFrame?.());
   const cdp=await page.context().newCDPSession(page);try{const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(resolve(out,name+'.png'),Buffer.from(shot.data,'base64'));}finally{await cdp.detach();}
  }
  console.log('CAPTURE',name);
 };
 for(const id of (process.env.CHASE_ONLY||process.env.MINI_ONLY?[]:process.env.CAPTURE_IDS?process.env.CAPTURE_IDS.split(','):['panda_11','panda_100hp','golf','golf_r','cla','cla45s'])){await show(id);await capture('garage-'+id);}
 if(!process.env.TRIM_ONLY&&!process.env.CHASE_ONLY&&!process.env.JAZZ){
 await show('cle200');await capture('garage-cle200');
 await page.evaluate(()=>{window.__trimCanvas=document.querySelector('#carStage canvas');window.__trimRotation=__flow.menu.carView.rotation;});
 for(const id of ['cle','cle300e','cle450','cle53']){
   await page.locator('[data-act="carTrimNext"]').click();
   assert.equal(await page.locator('[data-trim-current]').getAttribute('data-trim-current'),id);
   assert(await page.evaluate(()=>window.__trimCanvas===document.querySelector('#carStage canvas')),'trim changes preserve the WebGL canvas');
   assert(Math.abs(await page.evaluate(()=>__flow.menu.carView.rotation-window.__trimRotation))<.001,'turntable angle is continuous');
   await capture('garage-'+id);
 }
 await page.keyboard.press('KeyD');assert.equal(await page.locator('[data-trim-current]').getAttribute('data-trim-current'),'cle200');
 await page.keyboard.press('KeyA');assert.equal(await page.locator('[data-trim-current]').getAttribute('data-trim-current'),'cle53');
 // Simulated RB is read by the same rising-edge poll used for a real pad.
 await page.evaluate(()=>{window.__trimPad=[{buttons:Array.from({length:6},(_,i)=>({pressed:i===5}))}];Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.__trimPad});});
 await page.waitForFunction(()=>document.querySelector('[data-trim-current]')?.dataset.trimCurrent==='cle200');await page.evaluate(()=>{window.__trimPad=[];});
 await show('mini_cooper');await capture('garage-mini-hardtop-cooper');
 await page.locator('[data-act="carTrimNext"]').click();await page.locator('[data-act="carTrimNext"]').click();
 assert.equal(await page.locator('[data-trim-current]').getAttribute('data-trim-current'),'mini_jcw');await capture('garage-mini-hardtop-jcw');
 await page.locator('[data-key="carBody"] [data-v="convertible"]').click();
 assert.equal(await page.locator('[data-trim-current]').getAttribute('data-trim-current'),'mini_cabrio_jcw');await capture('garage-mini-convertible-jcw');
 await page.locator('[data-act="carTrimNext"]').click();await capture('garage-mini-convertible-cooper');
 await page.locator('[data-key="carBody"] [data-v="hardtop"]').click();
 assert.equal(await page.locator('[data-trim-current]').getAttribute('data-trim-current'),'mini_cooper');
 // Swipe changes trim, while a mouse drag remains a free turntable rotation.
 await page.evaluate(()=>{const el=document.querySelector('.car-preview-viewport');el.setPointerCapture=()=>{};el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:99,pointerType:'touch',clientX:280}));el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:99,pointerType:'touch',clientX:170}));});
 assert.equal(await page.locator('[data-trim-current]').getAttribute('data-trim-current'),'mini_s');
 }
 // Six actual stationary world views use the same spawn, camera and body colour.
 for(const id of (process.env.MINI_ONLY?[]:process.env.CAPTURE_IDS?process.env.CAPTURE_IDS.split(','):['panda_11','panda_100hp','golf','golf_r','cla','cla45s'])){
   console.log('START',id);
   await page.evaluate(async id=>{await __flow.startEvent(__flow.freeRoamDef(),{car:id});},id);
   await page.waitForFunction(id=>__sim.player.spec.id===id&&!document.body.classList.contains('fading'),id,{timeout:120000});
   await page.waitForTimeout(1000);
   await page.evaluate(()=>{__game.countWall=performance.now()-5000;__sim.step(1,.05);__game.cam='chase';__sim.step(60,1/60);__sim.render();});
   const actual=await page.evaluate(()=>({id:__sim.player.spec.id,physics:__sim.player.veh.spec.id,model:__sim.player.model.spec.id,body:__sim.player.model.modelKind,expectedBody:__sim.player.spec.body}));assert.equal(actual.id,id,'capture uses requested trim');assert.equal(actual.physics,id);assert.equal(actual.model,id);assert.equal(actual.body,actual.expectedBody);console.log('CHASE_ID',JSON.stringify(actual));await capture('chase-'+id);
   if(process.env.JAZZ&&id==='jazz_drift'){
    const slide=await page.evaluate(async()=>{
      const {jazzSlideInput}=await import('/tools/physics-test/jazz-slide.mjs');
      const sim=__sim,v=sim.player.veh,m=sim.player.model,dt=1/60;
      // Use the actual Megara road, vehicle and suspension; keep world stepping frozen.
      v.reset(750,0,70/3.6);
      let corridorExcess=-Infinity;const tick=input=>{v.update(dt,input);corridorExcess=Math.max(corridorExcess,Math.abs(v.u)+v.halfW-sim.route.edge(v.s));};
      for(let i=0;i<90;i++){tick({throttle:.25,brake:0,steer:0});v.vLong=70/3.6;}
      for(let i=0;i<24;i++)tick({throttle:0,brake:0,steer:.6,handbrake:i<21});
      for(let i=0;i<24;i++)tick(jazzSlideInput(v));
      v.place(m.root);m.update(dt,v.vLong,v.steer,false,v.pose,v.corners,v.w);
      const speed=Math.hypot(v.vLong,v.vLat)*3.6,beta=Math.atan2(v.vLat,Math.abs(v.vLong))*180/Math.PI;
      const c=sim.camera;c.position.set(v.x+Math.cos(v.yaw)*5+Math.sin(v.yaw)*5,v.y+2.6,v.z-Math.sin(v.yaw)*5+Math.cos(v.yaw)*5);c.lookAt(v.x,v.y+.65,v.z);c.fov=55;c.updateProjectionMatrix();sim.render();
      return {id:v.spec.id,speed,beta,steer:v.steer,gear:v.gear,s:v.s,u:v.u,corridorExcess};
    });
    assert.equal(slide.id,'jazz_drift');assert(slide.speed>20);assert(slide.corridorExcess<=0,'slide stays fully on the tarmac');assert(Math.abs(slide.beta)>17&&Math.abs(slide.beta)<40,JSON.stringify(slide));
    console.log('JAZZ_SLIDE',JSON.stringify(slide));await fs.writeFile(resolve(out,'jazz-slide.json'),JSON.stringify(slide,null,2));await capture('jazz-mid-drift');
   }
   await page.evaluate(()=>__flow.quit());
 }
 const geometry=await page.evaluate(async()=>{const {CARS,CarModel}=await import('/src/cars.js');return ['mini_cooper','mini_s','mini_jcw','mini_cabrio_cooper','mini','mini_cabrio_jcw','panda_11','panda_100hp','golf','golf_r','cla','cla45s','cle300e','jazz','jazz_dynamic','jazz_drift'].filter(id=>CARS.some(c=>c.id===id)).map(id=>{const spec=CARS.find(c=>c.id===id),car=new CarModel(spec);const result={id,body:car.modelKind,open:!!car.shape.open,exhaust:car.exhaust.length,expected:spec.visual.exhaust};car.disposeDamage?.();return result;});});
 for(const row of geometry){assert.equal(row.exhaust,row.expected,row.id+' outlet count');if(row.id.startsWith('mini'))assert.equal(row.open,row.body==='mini',row.id+' roof geometry');}
 await fs.writeFile(resolve(out,process.env.MINI_ONLY?'mini-browser-results.json':'browser-results.json'),JSON.stringify({errors,geometry},null,2));
 assert.deepEqual(errors,[]);console.log('PASS trim/body pickers, model construction, chase captures');
}finally{await browser.close();await app.close();}
