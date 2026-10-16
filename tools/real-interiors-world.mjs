import {resolve} from 'node:path';import fs from 'node:fs/promises';import {execFileSync} from 'node:child_process';import sharp from 'sharp';import {createGameServer} from '../server/index.mjs';
const {chromium}=await import('/tmp/pw/node_modules/playwright/index.mjs');
const root=resolve('.'),out=resolve('.scratch/real-interiors'),base='85a37e6a1b2d4c1947feb0f500ea97c623e5da6f',repo='/home/dev/projects/paraliaki-racing';
const changes=['src/cockpit.js','src/cockpit-structure.js','src/fleet-cockpit.js','src/pov-camera.js','src/pov-instruments.js'];
await fs.mkdir(out,{recursive:true});
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const errors=[];
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{for(const phase of process.env.CAPTURE_PHASES?.split(',')||['after','before']){
 const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();page.setDefaultTimeout(600000);page.on('pageerror',e=>{errors.push(phase+': '+e.stack);console.log('PAGEERROR',e.stack);});
 await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async r=>r.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',r.request().url().split('three@0.170.0/')[1])),contentType:'text/javascript'}));
 if(phase==='before')await page.route('**/*',async r=>{const p=new URL(r.request().url()).pathname.slice(1);if(changes.includes(p)||/^assets\/tex\/ktx2\/atlas-/.test(p)){await r.fulfill({body:execFileSync('git',['-C',repo,'show',base+':'+p]),contentType:p.endsWith('.js')?'text/javascript':p.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});}else await r.fallback();});
 await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>cb.name==='frame'?raf(t=>{if(!window.__holdFrame)cb(t);}):raf(cb);});
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&quality=low&fixedres&map=riviera&notraffic&tod=afternoon&wx=clear`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.classList.contains('loaded'));console.log(phase,'MENU');await page.evaluate(()=>__flow.startEvent(__flow.freeRoamDef(),{car:'mini'}));
 await page.waitForFunction(()=>window.__sim?.player&&['race','countdown'].includes(window.__game?.state)&&!document.body.classList.contains('fading'));
 await page.evaluate(()=>{window.__holdFrame=true;window.__startPose={s:__sim.player.veh.s,u:__sim.player.veh.u};});console.log(phase,'WORLD');
 const pose=await fs.readFile(out+'/world-pose.json','utf8').then(JSON.parse).catch(()=>null);if(pose)await page.evaluate(p=>window.__startPose=p,pose);else await fs.writeFile(out+'/world-pose.json',JSON.stringify(await page.evaluate(()=>__startPose)));
 const ids=process.env.CAPTURE_IDS?.split(',')||await page.evaluate(async()=>{const {CAR_MODELS}=await import('/src/car-catalog.js');return [...CAR_MODELS.map(m=>m.trims.includes(m.id)?m.id:m.trims[0]),'mini_jcw'];});
 const rows=await fs.readFile(out+'/'+phase+'-world.json','utf8').then(JSON.parse).catch(()=>[]);for(const id of ids.filter(id=>!rows.some(r=>r.id===id))){const row=await page.evaluate(async({id,phase})=>{
  const T=await import('three'),ENV=await import('/src/env.js');__flow.switchRoamCar(id);__holdFrame=true;
  const {player,camera,scene,renderer}=__sim,{model,cockpit}=player;player.veh.reset(__startPose.s,__startPose.u,0);__game.cam='cockpit';__game.countWall=performance.now()-5000;__sim.step(1,1/60);__sim.cameraBlend.active=false;
  const capture=async weather=>{__setConditions({time:'afternoon',weather});ENV.U.time.value=8.25;__sim.render();cockpit.setVisible(true);cockpit.update(0,{ignition:true,rpm:3500,kmh:85,redline:player.spec.redline,gearLabel:'3',steerInput:0,vehicle:player.veh});await new Promise(r=>setTimeout(r,250));cockpit.clusterKey=undefined;cockpit.povLast=undefined;cockpit.update(0,{ignition:true,rpm:3500,kmh:85,redline:player.spec.redline,gearLabel:'3',steerInput:0,vehicle:player.veh});
   camera.position.copy(cockpit.eye);model.body.localToWorld(camera.position);camera.quaternion.copy(model.body.getWorldQuaternion(new T.Quaternion())).multiply(new T.Quaternion().setFromEuler(new T.Euler(cockpit.eyePitch,0,0,'YXZ')));camera.fov=66;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);ENV.U.time.value=8.25;model.updateCockpitWipers?.(8.25,weather==='rain');renderer.info.reset();renderer.render(scene,camera);const render={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
   const overlays=[];scene.traverse(o=>{if(o.isMesh&&o.material?.name==='cockpit-rain-overlay')overlays.push({name:o.name,visible:o.visible,triangles:(o.geometry.index?.count||o.geometry.attributes.position.count)/3,texture:o.material.uniforms.uDrops?.value.name});});
   return {image:renderer.domElement.toDataURL().split(',')[1],render,eye:camera.position.toArray(),quaternion:camera.quaternion.toArray(),overlays};};
  const dry=await capture('clear'),rain=null;return {id,phase,dry,rain};
 },{id,phase});
 for(const weather of ['dry','rain'])if(row[weather]){await sharp(Buffer.from(row[weather].image,'base64')).webp({quality:92}).toFile(`${out}/${phase}-${id}-${weather}.webp`);delete row[weather].image;}
 rows.push(row);await fs.writeFile(out+'/'+phase+'-world.json',JSON.stringify(rows,null,2));console.log(phase,id,JSON.stringify({dry:row.dry.render,rain:row.rain?.render}));}
 await context.close();}
 await fs.writeFile(out+'/world-errors.json',JSON.stringify(errors,null,2));if(errors.length)process.exitCode=1;
}finally{await browser.close();await app.close();}
