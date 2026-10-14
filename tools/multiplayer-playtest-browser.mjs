// Run only with tools/browser-slot.sh node tools/multiplayer-playtest-browser.mjs BASE OUT.
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
  const page=await browser.newPage({viewport:{width:800,height:450}});pages.push(page);page.on('pageerror',error=>errors.push(error.stack));
  await page.addInitScript(({i})=>{
   localStorage.setItem('paraliaki.driver','PARROT');localStorage.setItem('paraliaki.car','mini');localStorage.setItem('paraliaki.paint.mini',['#ffcc00','#0088ff','#ffffff'][i]);
   const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__holdFrame&&cb.name==='frame'?0:raf(cb);
  },{i});
  await page.goto(base+'/?simhook&debug&quality=low&fixedres',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>document.body.classList.contains('loaded')&&__multiplayer.connected,null,{timeout:180000});
  await page.evaluate(()=>{window.__holdFrame=true;});console.log('Loaded client',i+1);
 }
 await pages[0].evaluate(()=>__multiplayer.createLobby({private:true,config:{time:'night',weather:'rain',traffic:2,police:false}}));
 await pages[0].waitForFunction(()=>__multiplayer.lobby?.status==='waiting');const code=await pages[0].evaluate(()=>__multiplayer.lobby.code);
 for(const page of pages.slice(1)){await page.evaluate(code=>__multiplayer.action('join',{code}),code);await page.waitForFunction(()=>__multiplayer.worldReady&&__multiplayer.me?.loaded);}
 await pages[0].waitForFunction(()=>__multiplayer.lobby.players.length===3&&__multiplayer.lobby.players.every(p=>p.loaded));
 proof.lobby=await all(()=>({names:__multiplayer.lobby.players.map(p=>p.name),paint:__multiplayer.lobby.players.map(p=>p.paint),ready:__multiplayer.me.ready,weather:__conditions(),traffic:__sim.traffic.disabled}));
 assert.deepEqual(proof.lobby[0].names,['PARROT','PARROT#2','PARROT#3']);assert.ok(proof.lobby.every(p=>!p.ready));
 for(const page of pages)await page.evaluate(()=>__multiplayer.$('mp-ready').click());
 await pages[0].waitForFunction(()=>__multiplayer.lobby.players.every(p=>p.ready&&p.loaded));
 await pages[0].evaluate(()=>__multiplayer.startRace());
 for(const page of pages)await page.waitForFunction(()=>__multiplayer.lobby.status==='race');
 await all(()=>{__multiplayer.close();__flow.menu.close?.();__sim.step(1,1/60);});
 proof.start=await all(()=>({race:__multiplayer.lobby.raceId,slot:__multiplayer.me.gridSlot,s:__vehicle().s,weather:__conditions(),world:__multiplayer.lobby.world.state,traffic:__sim.traffic.disabled,visibleTraffic:__sim.traffic.cars.filter(c=>!c.cop&&c.active&&c.m.root.visible).length}));
 assert.ok(proof.start.every(p=>p.race===proof.start[0].race&&p.weather.weather==='rain'&&p.weather.time==='night'&&p.world.wet===1&&p.traffic&&p.visibleTraffic===0));
 console.log('Shared start verified');
 // Send genuine accepted positions along the route, with the second driver ahead.
 for(let i=0;i<3;i++)await pages[i].evaluate(i=>{const v=__vehicle(),r=__multiplayer.lobby.event,s=r.s0+r.dir*(4+i*4);v.reset(s,__sim.route.laneU(s,0),0);__multiplayer.stateSender.discontinuity();__multiplayer.update(1/60,{...Object.fromEntries(['x','y','z','yaw','s','u','vLong','vLat','steer','rpm','gear','nitro','reverse'].map(k=>[k,v[k]])),damage:{...v.damage}});},i);
 await pages[0].waitForTimeout(400);
 proof.standings=await all(()=>__multiplayer.ranking(99999).map(p=>({id:p.id,name:p.name,progress:__multiplayer.driverProgress(p)})));
 assert.deepEqual(proof.standings[0],proof.standings[1]);assert.deepEqual(proof.standings[1],proof.standings[2]);assert.equal(proof.standings[0][0].name,'PARROT#3');
 console.log('Shared standings verified');
 // Render the peer proxy through the production intake; exercise the production collision hook.
 const remote=await pages[1].evaluate(()=>({id:__multiplayer.id,state:__multiplayer.hooks.appearance()}));
 const contact=await pages[0].evaluate(({id})=>{
  const mp=__multiplayer,v=__vehicle(),peer=mp.peers.get(id);mp.hooks.remote(mp.peers,0);const s=peer.state.s,u=peer.state.u;
  v.reset(s-1,u,30);v.yaw=peer.state.yaw;__sim.G.state='race';__sim.input.throttle=0;__sim.input.brake=0;__sim.input.steer=0;
  peer.at=performance.now();const before={speed:v.vLong,y:v.y,damage:{...v.damage}};__sim.step(1,1/60);
  return {before,after:{speed:v.vLong,y:v.y,damage:{...v.damage}},contacts:mp.lastContacts};
 },remote);
 proof.contact=contact;assert.ok(contact.contacts.length>0,'production multiplayer collision hook must make contact');assert.ok(contact.after.speed<contact.before.speed-2);assert.ok(Math.abs(contact.after.y-contact.before.y)<.5,'no vertical launch');
 console.log('Player contact verified');
 // Restart resets all three; old sampled positions cannot reappear.
 const oldRace=proof.start[0].race;await pages[0].evaluate(()=>__multiplayer.restart());
 for(const page of pages)await page.waitForFunction(old=>__multiplayer.startedRace&&__multiplayer.startedRace!==old,oldRace,{timeout:15000});
 proof.restart=await all(()=>({race:__multiplayer.lobby.raceId,started:__multiplayer.startedRace,s:__vehicle().s,expected:__flow.gridSlot(__multiplayer.me.gridSlot).s,peers:__multiplayer.peers.size}));
 assert.ok(proof.restart.every(p=>p.race!==oldRace&&p.started===p.race&&Math.abs(p.s-p.expected)<.1&&p.peers===0));
 await pages[0].evaluate(()=>{__sim.render();});await pages[0].screenshot({path:resolve(out,'three-clients-restart.png')});
 for(let i=0;i<3;i++)await pages[i].screenshot({path:resolve(out,`client-${i+1}.png`)});
 assert.deepEqual(errors,[]);console.log(JSON.stringify(proof,null,2));
} catch(error){process.exitCode=1;proof.failure=error.stack;console.error(error);for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:resolve(out,`failure-${i+1}.png`)}).catch(()=>{});}
finally{await fs.writeFile(resolve(out,'evidence.json'),JSON.stringify({proof,errors},null,2));await browser.close();}
