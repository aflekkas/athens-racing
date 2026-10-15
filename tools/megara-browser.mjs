// Run only through tools/browser-slot.sh. Private server, deterministic real
// simulation, screenshots and quality/night/reset/tyre impact evidence.
import { createGameServer } from '../server/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const sceneryOnly = process.argv.includes('--scenery-only');
const root = resolve(import.meta.dirname, '..'), out = resolve(process.env.MEGARA_EVIDENCE_DIR || resolve(root, '.scratch/megara-back'));
await mkdir(out, {recursive:true});
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs').href);
const app = await createGameServer({dataDir:resolve(out,'browser-server-data')});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser = await pw.chromium.launch({headless:true,executablePath:process.env.CHROME_BIN || resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport:{width:1100,height:720},deviceScaleFactor:1}), report={errors:[],quality:[]};
page.on('pageerror',e=>{report.errors.push(String(e));console.error('PAGEERROR',String(e));});
page.on('console',m=>{if(m.type()==='error' && !/favicon|ERR_CONNECTION|WebSocket/.test(m.text())){report.errors.push(m.text());console.error(m.text());}});
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__freezeMegara&&cb.name==='frame'?0:raf(cb);});
const shot=async name=>{await page.screenshot({path:resolve(out,name+'.png'),timeout:60000});console.log('SCREENSHOT',name);};
const render=async()=>page.evaluate(async()=>{const {camera,scene,render}=window.__replay.ctx; const {updateSceneryLod}=await import('./src/scenery.js');const lod=[];scene.traverse(o=>{if(o.userData.far&&o.boundingSphere)lod.push(o);});updateSceneryLod(lod,camera);render();});
try {
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&fixeddt&quality=low&map=megara&car=z4`,{waitUntil:'domcontentloaded',timeout:120000});
 console.log('LOADING',app.server.address().port);
 await page.waitForFunction(()=>document.body.classList.contains('loaded'),null,{timeout:600000});
 await page.evaluate(()=>{window.__freezeMegara=true;window.__flow.menu.show('maps',{mode:'sprint'});});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await page.locator('.track-pin[data-map-id=megara]').waitFor({state:'visible'});
 await page.locator('.track-pin[data-map-id=megara]').click();
 assert.equal(await page.locator('.track-pin').count(),3);
 await shot('01-map-selector');
 await page.evaluate(()=>{window.__flow.menu.hide();window.__flow.startEvent('megara-race');});
 await page.waitForFunction(()=>window.__game.state==='countdown',null,{timeout:30000});
 await page.evaluate(()=>{window.__game.userCam=window.__game.cam='chase';window.__sim.step(90);});
 report.start=await page.evaluate(()=>({state:window.__game.state,map:window.__flow.mapId,event:window.__flow.event().def.id,rivals:window.__flow.grid.length,traffic:window.__sim.traffic.disabled,playerS:window.__sim.player.veh.s}));
 assert.equal(report.start.map,'megara');assert.equal(report.start.rivals,3);assert.equal(report.start.traffic,true);
 await render();await shot('02-solo-race-start');
 await page.evaluate(frames=>{window.__game.autodrive=true;window.__sim.step(frames);window.__game.autodrive=false;},sceneryOnly?600:1200);
 report.mid=await page.evaluate(()=>({s:window.__sim.player.veh.s,rivals:window.__flow.grid.map(c=>({s:c.veh.s,u:c.veh.u,wall:c.veh.wallHit})),render:window.__renderInfo()}));
 assert.ok(report.mid.s>150);
 await render();await shot('03-solo-mid-lap');
 await page.evaluate(()=>{window.__sim.player.veh.reset(600,3,0);window.__flow.resetCar();});
 await page.waitForFunction(()=>!window.__game.towing && !document.body.classList.contains('fading') && Number(getComputedStyle(document.querySelector('#fade')).opacity)<.01);
 report.reset=await page.evaluate(()=>{const v=window.__sim.player.veh;return {s:v.s,u:v.u,y:v.y,finite:[v.s,v.u,v.y].every(Number.isFinite)};});assert.ok(report.reset.finite);assert.ok(Math.abs(report.reset.u)<.1);
 // Frame a real barrier on the outside of a corner; retained placement IDs identify the struck stack.
 report.barrier=await page.evaluate(()=>{const {scene,camera}=window.__replay.ctx,sim=window.__sim;const stacks=scene.getObjectByName('megara-circuit').userData.tyreWalls;
  const stack=stacks.map(p=>({p,at:sim.route.project(p.x,p.z)})).filter(v=>v.at.s>90&&v.at.s<180).sort((a,b)=>Math.abs(a.at.s-130)-Math.abs(b.at.s-130))[0];
  if(!stack)throw Error('No outside corner stack');window.__tyreProofStack=stack.p;window.__game.state='race';window.__replay.recorder=null;window.__flow.hideGrid();
  const centre=sim.route.point(stack.at.s,0),dx=centre.x-stack.p.x,dz=centre.z-stack.p.z,l=Math.hypot(dx,dz);camera.position.set(stack.p.x+dx/l*9-dz/l*4,stack.p.y+4,stack.p.z+dz/l*9+dx/l*4);camera.lookAt(stack.p.x,stack.p.y+.5,stack.p.z);camera.updateMatrixWorld(true);return {id:stack.p.id,x:stack.p.x,y:stack.p.y,z:stack.p.z,s:stack.at.s};});
 await render();await shot('04-corner-tyre-walls');
 // Run the real Ground collision resolver: no direct onImpact call and no visual-only debris injection.
 report.impact=await page.evaluate(()=>{const sim=window.__sim,v=sim.player.veh,p=window.__tyreProofStack;const r=sim.route.project(p.x,p.z),centre=sim.route.point(r.s,0);let dx=p.x-centre.x,dz=p.z-centre.z;const l=Math.hypot(dx,dz);dx/=l;dz/=l;
  v.reset(r.s,0,22);v.x=p.x-dx*5;v.z=p.z-dz*5;v.yaw=Math.atan2(-dx,-dz);v.vLong=22;v.vLat=0;v.syncWheels();window.__tyreProofDir={dx,dz};
  // Update the physical body directly to hold this crash-test camera fixed.
  for(let i=0;i<14;i++)v.update(1/60,{throttle:0,brake:0,steer:0});
  window.__game.towing=false;sim.render();return {speed:v.vLong,wallHit:v.wallHit,loose:sim.G.state,initialSpeed:22};});
 // The normal simulation owns debris update, even while using a fixed external camera.
 const advance=async frames=>page.evaluate(frames=>{const sim=window.__sim,v=sim.player.veh;const c=window.__replay.ctx.camera,pose=c.position.clone(),rotation=c.quaternion.clone();for(let i=0;i<frames;i++){sim.step(1);c.position.copy(pose);c.quaternion.copy(rotation);c.updateMatrixWorld(true);}return {speed:v.vLong,wall:v.wallHit,bodies:window.__replay.ctx.scene.getObjectByName('loose-circuit-tyres').count};},frames);
 report.impact.frames1=await advance(8);await render();await shot('05-impact-contact');
 report.impact.frames2=await advance(20);await render();await shot('06-tyres-flying');
 report.impact.frames3=await advance(90);await render();await shot('07-tyres-bouncing');
 assert.ok(report.impact.frames2.bodies>0,'physical impact must release tyres');assert.ok(report.impact.frames2.speed<20,'wall must absorb car speed');
 // Night shader and all live quality presets on the actual Megara road.
 for(const q of (sceneryOnly?['low']:['low','med','high','ultra'])){console.log('QUALITY',q);report.quality.push(await page.evaluate(q=>{window.__renderTest.applyQualityTier(q);window.__setConditions({time:'night',weather:'clear'});window.__replay.ctx.render();const road=window.__replay.ctx.scene.getObjectByName('megara-road');return {q,health:window.__lightingInfo(),materials:road.children.filter(o=>o.isMesh).map(o=>o.material.customProgramCacheKey()),render:window.__renderInfo()};},q));}
 await shot('08-night-tyre-walls');
 assert.ok(report.quality.every(q=>q.health.valid && q.materials.some(m=>m.startsWith('megara-photo-surface-v2-asphalt')&&m.includes('|wx-road'))));
 await page.evaluate(()=>window.__flow.startEvent('megara-race'));
 await page.waitForFunction(()=>window.__game.state==='countdown',null,{timeout:30000});
 report.restart=await page.evaluate(()=>window.__replay.ctx.scene.getObjectByName('loose-circuit-tyres').count);assert.equal(report.restart,0);
 await page.waitForFunction(()=>window.__multiplayer.connected);
 await page.evaluate(()=>{window.__multiplayer.open({entry:'host',mapId:'megara'});window.__multiplayer.createLobby({mapId:'megara',eventId:'megara-race',private:true,lobbyName:'Megara restored'});});
 await page.waitForFunction(()=>window.__multiplayer.lobby?.mapId==='megara');
 report.online=await page.evaluate(()=>({map:window.__multiplayer.lobby.mapId,event:window.__multiplayer.lobby.eventId,config:window.__multiplayer.lobby.config,options:[...document.querySelector('#mp-map').options].map(o=>o.value)}));
 assert.ok(report.online.options.includes('megara'));
 await shot('09-online-host-lobby');
 assert.equal(report.errors.length,0,report.errors.join('\n'));
 console.log('PASS',JSON.stringify(report));
} finally {await writeFile(resolve(out,sceneryOnly?'browser-scenery-report.json':'browser-report.json'),JSON.stringify(report,null,2));await browser.close();await app.close();}
