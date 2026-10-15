// Run only with tools/browser-slot.sh node tools/multiplayer-universal-browser.mjs BASE OUT.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs');
const base=process.argv[2], out=resolve(process.argv[3] || '.scratch/mp-browser');await fs.mkdir(out,{recursive:true});
let executablePath=process.env.CHROME_BIN;
if(!executablePath&&!existsSync(chromium.executablePath())){const cache=resolve(homedir(),'.cache/ms-playwright');for(const dir of (await fs.readdir(cache)).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse()){const file=resolve(cache,dir,'chrome-linux64/chrome');if(existsSync(file)){executablePath=file;break;}}}
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const pages=[],errors=[],proof={};
const all=async fn=>Promise.all(pages.map(page=>page.evaluate(fn)));
try {
 for(let i=0;i<3;i++){
  const page=await browser.newPage({viewport:{width:800,height:450}});pages.push(page);page.on('pageerror',error=>{errors.push(error.stack);console.error('PAGEERROR',error.stack);});
  await page.addInitScript(({i})=>{
   localStorage.setItem('paraliaki.driver','PARROT');localStorage.setItem('paraliaki.car','mini');localStorage.setItem('paraliaki.paint.mini',['#ffcc00','#0088ff','#ffffff'][i]);
   const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__holdFrame&&cb.name==='frame'?0:raf(cb);
  },{i});
  await page.goto(base+'/?simhook&debug&quality=low&fixedres',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>document.body.classList.contains('loaded')&&__multiplayer.connected,null,{timeout:180000});
  await page.evaluate(()=>{window.__holdFrame=true;});console.log('Loaded client',i+1);
 }
 await pages[0].evaluate(()=>__multiplayer.createLobby({private:true,config:{time:'night',weather:'rain',traffic:2,police:true}}));
 await pages[0].waitForFunction(()=>__multiplayer.lobby?.status==='waiting');const code=await pages[0].evaluate(()=>__multiplayer.lobby.code);
 for(const page of pages.slice(1)){await page.evaluate(code=>__multiplayer.action('join',{code}),code);await page.waitForFunction(()=>__multiplayer.worldReady&&__multiplayer.me?.loaded);}
 await pages[0].waitForFunction(()=>__multiplayer.lobby.players.length===3&&__multiplayer.lobby.players.every(p=>p.loaded));
 proof.lobby=await all(()=>({names:__multiplayer.lobby.players.map(p=>p.name),paint:__multiplayer.lobby.players.map(p=>p.paint),ready:__multiplayer.me.ready,weather:__conditions(),traffic:__sim.traffic.disabled}));
 assert.deepEqual(proof.lobby[0].names,['PARROT','PARROT#2','PARROT#3']);assert.ok(proof.lobby.every(p=>!p.ready));
 for(const page of pages)await page.evaluate(()=>__multiplayer.$('mp-ready').click());
 await pages[0].waitForFunction(()=>__multiplayer.lobby.players.every(p=>p.ready&&p.loaded));
 await pages[0].evaluate(()=>__multiplayer.startRace());
 for(const page of pages)await page.waitForFunction(()=>__multiplayer.lobby.status==='race'&&__multiplayer.now()>=__multiplayer.lobby.startAt);
 await all(()=>{__multiplayer.close();__flow.menu.close?.();__sim.step(1,1/60);});
 proof.start=await all(()=>({race:__multiplayer.lobby.raceId,slot:__multiplayer.me.gridSlot,s:__vehicle().s,weather:__conditions(),world:__multiplayer.lobby.world.state,traffic:__sim.traffic.disabled,visibleTraffic:__sim.traffic.cars.filter(c=>!c.cop&&c.active&&c.m.root.visible).length}));
 assert.ok(proof.start.every(p=>p.race===proof.start[0].race&&p.weather.weather==='rain'&&p.weather.time==='night'&&p.world.wet===1));
 assert.deepEqual(errors,[]);console.log('Shared start verified');

 const tick=async(n=1)=>{for(let k=0;k<n;k++){await all(()=>__sim.step(1,1/30));await pages[0].waitForTimeout(60);}};
 const flush=async()=>{await pages[0].waitForTimeout(220);await pages[0].evaluate(()=>__sim.step(1,1/60));const seq=await pages[0].evaluate(()=>__sharedWorld.seq-1);for(const page of pages)await page.waitForFunction(seq=>__sharedWorld.frame?.seq===seq,seq,{timeout:10000});await Promise.all(pages.slice(1).map(p=>p.evaluate(()=>__sim.step(1,1/60))));};
 await tick(12);await flush();
 proof.traffic=await all(()=>({owner:__sharedWorld.authority,seq:__sharedWorld.frame.seq,rows:__sharedWorld.frame.rows,models:__sim.traffic.cars.filter(c=>c.active).map(c=>[c.id,c.type.id]),moving:__sim.traffic.cars.filter(c=>c.active&&c.mode!=='parked'&&c.v>1).length,poses:__sim.traffic.cars.filter(c=>c.active).map(c=>({id:c.id,s:c.s,u:c.u})),at:__multiplayer.now(),frameAt:__sharedWorld.frame.at,poseAge:__sharedWorld.authority?0:__sharedWorld.lastPoseAge,poseAt:__sharedWorld.lastPoseAt}));
 assert.equal(proof.traffic.filter(p=>p.owner).length,1);assert.ok(proof.traffic[0].moving>3,'Traffic setting must create moving ambient cars');
 for(const p of proof.traffic.slice(1)){assert.deepEqual(p.rows,proof.traffic[0].rows);assert.deepEqual(p.models,proof.traffic[0].models);}
 const aligned=proof.traffic.map(p=>p.poses.map(v=>{const row=p.rows.find(r=>r[0]===v.id),age=p.poseAge;return{id:v.id,s:v.s-row[3]/100*age,u:v.u-row[4]/100*age};}));
 proof.positionError=Math.max(...aligned.flatMap(p=>p.map((v,i)=>Math.hypot(v.s-aligned[0][i].s,v.u-aligned[0][i].u))));
 assert.ok(proof.positionError<.8,`shared traffic error ${proof.positionError}`);console.log('Shared moving traffic verified');
 proof.policy=await all(()=>({policeRequested:__multiplayer.lobby.config.police,policeEnabled:__police.enabled,policeUnits:__sim.traffic.cars.filter(c=>c.active&&c.police).length,pedestrians:Object.values(__sim.people.crowd.parts).reduce((n,p)=>n+p.im.count,0),roadPeople:__sim.people.onRoad.length,marks:__sim.fx.marks.visible,particles:[__sim.fx.smoke,__sim.fx.grit,__sim.fx.sparkP].some(p=>p.pts.visible)}));
 assert.ok(proof.policy.every(p=>p.policeRequested&&!p.policeEnabled&&!p.policeUnits&&!p.pedestrians&&!p.roadPeople&&!p.marks&&!p.particles));
 // Place an existing bus at the guest's bumper. Every client receives it through
 // production world packets; the guest then hits it through production physics.
 await pages[0].waitForTimeout(180);
 const guestPose=await pages[1].evaluate(()=>({s:__vehicle().s,u:__vehicle().u,halfL:__vehicle().halfL}));
 await pages[0].evaluate(p=>{const t=__sim.traffic,c=t.cars[0];t.initDrive(c,false);Object.assign(c,{active:true,s:p.s+p.halfL+c.len/2-.2,u:p.u,v:0,mode:'parked',parkT:1e9,dir:1,dmg:0,dz:{front:0,rear:0,left:0,right:0}});__sharedWorld.publish();},guestPose);
 const placed=await pages[0].evaluate(()=>__sharedWorld.seq-1);for(const page of pages)await page.waitForFunction(seq=>__sharedWorld.frame?.seq===seq,placed);
 proof.collision=await pages[1].evaluate(()=>{const v=__vehicle();v.vLong=24;__sim.G.state='race';const before={speed:v.vLong,y:v.y,sent:__sharedWorld.stats.contactsSent};__sim.step(1,1/60);return{before,after:{speed:v.vLong,y:v.y,sent:__sharedWorld.stats.contactsSent},contacts:__sharedWorld.stats};});
 assert.ok(proof.collision.after.speed<proof.collision.before.speed-2);assert.ok(Math.abs(proof.collision.after.y-proof.collision.before.y)<.5);assert.ok(proof.collision.after.sent>proof.collision.before.sent);
 await pages[0].waitForFunction(()=>__sharedWorld.stats.contactsReceived>0);await flush();
 proof.hitBus=await all(()=>__sharedWorld.frame.rows.find(r=>r[0]===0));for(const row of proof.hitBus.slice(1))assert.deepEqual(row,proof.hitBus[0]);assert.ok(proof.hitBus[0][13]&1,'bus impact must enter shared crash state');assert.ok(proof.hitBus[0].slice(16,20).some(n=>n>0),'bus damage is replicated');
 // A common starting placement makes a real cone contact cheap to reproduce.
 // It uses the existing instanced cone and contact solver, rather than injecting
 // a hit packet or directly setting the resulting broken state.
 const coneSpot=await pages[1].evaluate(()=>({s:__vehicle().s,u:__vehicle().u}));
 for(const page of pages)await page.evaluate(p=>{const t=__sim.traffic;let k=t.cones[0];if(!k){k={};t.cones.push(k);t.coneMesh.count=t.cones.length;}Object.assign(k,{s0:p.s,u0:p.u,s:p.s,u:p.u,y:0,vs:0,vu:0,vy:0,rx:0,rz:0,w:0,hit:false});t.updateCones(0);},coneSpot);
 const received=await pages[0].evaluate(()=>__sharedWorld.stats.contactsReceived);
 await pages[1].evaluate(()=>{__vehicle().vLong=8;__sim.step(1,1/60);});
 await pages[0].waitForFunction(n=>__sharedWorld.stats.contactsReceived>n,received);await tick(14);await flush();
 proof.cones=await all(()=>({rows:__sharedWorld.frame.cones,hit:__sim.traffic.cones[0].hit}));assert.ok(proof.cones.every(p=>p.hit));for(const p of proof.cones.slice(1))assert.deepEqual(p.rows,proof.cones[0].rows);assert.ok(proof.cones[0].rows.some(r=>r[0]===0));console.log('Guest collision, bus damage and displaced cone shared by all clients');
 proof.standings=await all(()=>__multiplayer.ranking().map(p=>p.id));assert.deepEqual(proof.standings[0],proof.standings[1]);assert.deepEqual(proof.standings[1],proof.standings[2]);
 proof.stats=await all(()=>({...__sharedWorld.stats}));
 proof.render=[];
 for(let i=0;i<3;i++){await pages[i].evaluate(()=>{__sim.G.cam='chase';__sim.render();});proof.render.push(await pages[i].evaluate(()=>({info:__renderInfo(),draw:__dbg()})));await pages[i].screenshot({path:resolve(out,`client-${i+1}.png`)});}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({positionError:proof.positionError,policy:proof.policy,stats:proof.stats}));
} catch(error){process.exitCode=1;proof.failure=error.stack;console.error(error);for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:resolve(out,`failure-${i+1}.png`)}).catch(()=>{});}
finally{await fs.writeFile(resolve(out,'evidence.json'),JSON.stringify({proof,errors},null,2));await browser.close();}
