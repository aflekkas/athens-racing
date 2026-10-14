import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
// Run through tools/browser-slot.sh; uses a private server and browser process.
const root=resolve(process.argv[2] || new URL('../',import.meta.url).pathname), out=resolve(process.argv[3] || '.scratch/map-lifecycle-browser'); await fs.mkdir(out,{recursive:true});
const {createGameServer}=await import(pathToFileURL(resolve(root,'server/index.mjs')));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs');
const {existsSync}=await import('node:fs');
const {homedir}=await import('node:os');
let executablePath=process.env.CHROME_BIN;
if(!executablePath&&!existsSync(chromium.executablePath())){for(const dir of (await fs.readdir(resolve(homedir(),'.cache/ms-playwright'))).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse()){const bin=resolve(homedir(),'.cache/ms-playwright',dir,'chrome-linux64/chrome');if(existsSync(bin)){executablePath=bin;break;}}}
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const app=await createGameServer({root,dataDir:resolve(out,'data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:800,height:500}}), errors=[], paths=[];
page.on('pageerror',e=>{errors.push(e.stack); console.log('PAGEERROR',e.stack);});
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async route=>{const url=route.request().url();const suffix=url.split('three@0.170.0/')[1];await route.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',suffix)),contentType:'text/javascript'});});
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__holdFrame&&cb.name==='frame'?0:raf(cb);});
async function evalRun(fn,arg){return page.evaluate(fn,arg);}
async function draw(label){paths.push(label);await evalRun(()=>{window.__sim.step(1,1/60);window.__sim.render();}); console.log('PATH',label,await evalRun(()=>({state:__game.state,screen:__flow.menu.screen,runtime:__mapRuntime()})));}
async function click(act){await page.waitForFunction(()=>!document.pointerLockElement);await page.locator(`[data-act="${act}"]`).first().click();}
async function assertMenu(){const state=await evalRun(()=>({state:__game.state,cam:__game.cam,paused:__game.paused,locked:!!document.pointerLockElement,racing:document.body.classList.contains('racing'),worlds:__mapRuntime().worlds}));assert.equal(state.state,'menu');assert.equal(state.cam,'orbit');assert.equal(state.paused,null);assert.equal(state.locked,false);assert.equal(state.racing,false);assert.equal(state.worlds.length,1);}
async function startRoam(){await evalRun(()=>__flow.startEvent(__flow.freeRoamDef()));await page.waitForTimeout(350);await evalRun(()=>{__game.countWall=performance.now()-2000;__sim.step(1,.05);});await draw('start-roam');}
try {
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&quality=low&fixedres&map=penteli`,{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>document.body.classList.contains('loaded'),null,{timeout:600000});if(await page.locator('[data-act="continue-play"]').count())await click('continue-play');await evalRun(()=>{window.__holdFrame=true;});console.log('READY');
 for(const map of ['penteli','riviera']){
  await evalRun(id=>__flow.switchMap(id),map);await startRoam();
  for(const action of ['roamCar','roamConditions','roamLandmarks','roamTow','reset','settings']){
   await evalRun(()=>__flow.pause());await click(action); await draw(map+'-'+action);
   if(action==='roamCar'){await evalRun(()=>{const m=__flow.menu;m.h.chooseCar((__game.carIdx+1)%6,null,true);});}
   if(action==='roamConditions'){await evalRun(()=>__flow.setRoamConditions({time:'night',weather:'rain'}));}
   if(action==='roamLandmarks'){await evalRun(()=>__flow.teleportLandmark(__flow.landmarks()[1]?.id||__flow.landmarks()[0].id));}
   await page.waitForTimeout(500);await evalRun(()=>{while(__flow.menu.screen!=='pause'&&__flow.menu.stack.length)__flow.menu.back();__flow.resume();});await draw(map+'-'+action+'-resume');
  }
  await evalRun(()=>__flow.pause());await page.screenshot({path:resolve(out,map+'-pause.png')});await click('quit');await page.waitForTimeout(350);await draw(map+'-quit');await assertMenu();await page.screenshot({path:resolve(out,map+'-menu.png')});
 }
 for(let i=0;i<3;i++)for(const id of ['penteli','riviera']){await evalRun(id=>__flow.switchMap(id),id);await startRoam();await evalRun(()=>__flow.pause());await click('quit');await page.waitForTimeout(350);await draw(`cycle-${i}-${id}`);await assertMenu();}
 await evalRun(()=>__flow.startEvent('quick'));await page.waitForTimeout(350);await evalRun(()=>{__game.countT=2;__game.countWall=performance.now();__sim.step(1,.05);__game.run.r.timeLimit=.01;__sim.step(1,.05);});await draw('race-finish');assert.equal(await evalRun(()=>__game.state),'finished');await evalRun(()=>{__game.finishedT=3;__sim.step(1,.05);});await draw('race-results');assert.equal(await evalRun(()=>__game.state),'results');await click('list');await page.waitForTimeout(350);await draw('race-quit');await assertMenu();await page.screenshot({path:resolve(out,'race-menu.png')});
 // The reported exception also arises after damage, when far-traffic batching removes mirror children.
 await evalRun(()=>setTimeout(()=>{for(const c of __sim.traffic.cars)c.m.setDamage('front',.5);},0));await page.waitForTimeout(150);await draw('traffic-damage');
 assert.equal(await evalRun(()=>__flow.menu.screen),'events');assert.equal(errors.length,0,errors.join('\n'));
 // A queued start followed immediately by quit must not revive the race.
 await evalRun(()=>{__flow.startEvent(__flow.freeRoamDef());__flow.quit();});await page.waitForTimeout(400);await draw('quit-during-restart');await assertMenu();
 await evalRun(()=>__flow.startEvent(__flow.freeRoamDef()));await page.waitForTimeout(350);await evalRun(()=>{__flow.resetCar();__flow.quit();});await page.waitForTimeout(500);await draw('quit-during-tow');await assertMenu();
 assert.equal(errors.length,0,errors.join('\n'));
} catch(e){process.exitCode=1;console.log('RUN FAILURE',e.stack);await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});}
finally{await fs.writeFile(resolve(out,'report.json'),JSON.stringify({root,errors,paths},null,2));await browser.close();await app.close();}
