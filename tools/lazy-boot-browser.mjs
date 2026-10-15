// Run through tools/browser-slot.sh node tools/lazy-boot-browser.mjs ROOT OUT [scenarios|multiplayer].
// Local CDN mirror and immutable static cache keep cold/warm timing repeatable without routing (which disables Chrome caching).
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]),out=resolve(process.argv[3]);await fs.mkdir(out,{recursive:true});
const {createGameServer}=await import(pathToFileURL(resolve(root,'server/index.mjs')));
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});
const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.bin':'application/octet-stream','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.wav':'audio/wav','.mp3':'audio/mpeg','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(path.startsWith('/api/')||path==='/health')return app.server.emit('request',req,res);try{let file=resolve(root,'.'+(path==='/'?'/index.html':path));if(path.startsWith('/vendor/'))file=resolve(root,'node_modules/three',path.slice(8));let body=await fs.readFile(file);if(file.endsWith('index.html'))body=Buffer.from(body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/vendor/'));res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':body.length,'Cache-Control':file.endsWith('index.html')?'no-cache':'public,max-age=3600'});res.end(body);}catch{res.writeHead(404);res.end();}});
server.on('upgrade',(...args)=>app.server.emit('upgrade',...args));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1000,height:650}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.stack);console.error('PAGEERROR',e.stack);});
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>['frame','onAnimationFrame'].includes(cb.name)?0:raf(cb);const ob=new MutationObserver(()=>{if(document.body?.dataset.ui==='title'&&!window.__menuAt){window.__menuAt=performance.now();}});ob.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-ui']});});
const report={root,boots:[],errors};
const scenarios = ['scenarios','multiplayer'].includes(process.argv[4]);
const dataRequests = []; page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/data/')) dataRequests.push(request.url()); });
async function click(act) { await page.locator(`[data-act="${act}"]`).first().evaluate(el => el.click(),null,{timeout:120000}); }
async function snap(label) { await page.screenshot({path:resolve(out,label+'.png'),timeout:60000}); }
async function waitWorld(id) { await page.waitForFunction(id => __flow.mapId === id && !__mapRuntime().switching && ['countdown','race','lobby'].includes(__game.state), id, {timeout:600000}); }

try{for(const cache of ['cold','warm']){await page.goto(`http://127.0.0.1:${server.address().port}/?menu&quality=low${scenarios ? '&simhook&debug' : ''}`,{waitUntil:'domcontentloaded',timeout:120000});await page.waitForFunction(()=>window.__menuAt&&document.body.classList.contains('loaded'),null,{timeout:600000});report.boots.push(await page.evaluate(cache=>{const rs=performance.getEntriesByType('resource');return{cache,timeToMenuMs:__menuAt,transferBytes:rs.reduce((n,r)=>n+r.transferSize,performance.getEntriesByType('navigation')[0].transferSize),bodyBytes:rs.reduce((n,r)=>n+r.encodedBodySize,0),mapRequests:rs.filter(r=>/\/data\//.test(r.name)).map(r=>({url:r.name,bytes:r.encodedBodySize,transfer:r.transferSize})),runtime:__mapRuntime(),render:__renderInfo()};},cache));await page.screenshot({path:resolve(out,cache+'-menu.png'),timeout:30000});console.log(JSON.stringify(report.boots.at(-1)));}

 if (scenarios) {
  // Hold map responses only while photographing the loader. Otherwise a software GPU's
  // sky/world build can monopolize the compositor and race the screenshot itself.
  let dataGate, releaseData;
  const holdData = () => { dataGate = new Promise(resolve => { releaseData = () => { dataGate=null;resolve(); }; }); };
  await page.route('**/data/**', async route => { if(dataGate)await dataGate;await route.continue(); });
  assert.equal(dataRequests.length,0,'menu fetched no map data across cold and warm visits');
  assert.equal((await page.evaluate(()=>__mapRuntime().worlds)).length,0);
  report.paths=[];
  if(process.argv[4] === 'scenarios') {
  for (const id of ['riviera','penteli','megara']) {
   await page.evaluate(()=>__flow.quit()); await page.waitForTimeout(400);
   const before=dataRequests.length;
   await click('play'); await click('quick');
   // The normal selector UI previews the track; SELECT TRACK goes straight to race setup.
   await page.locator(`.track-pin[data-map-id="${id}"]`).evaluate(el=>el.click());
   await page.locator('[data-confirm-track]').evaluate(el=>el.click());
   await page.waitForFunction(()=>__flow.menu.screen==='setup');
   assert.equal(dataRequests.length,before,'track setup is catalogue only');
   await click('setupGo');
   await page.waitForFunction(()=>__flow.menu.screen==='car');
   await page.locator('[data-act="carDetail"]').first().evaluate(el=>el.click(),null,{timeout:120000});
   console.log('SELECTED CAR',id,await page.evaluate(()=>({screen:__flow.menu.screen,detail:__flow.menu.data.detail,confirm:!!document.querySelector('[data-act=carConfirm]')})));
   assert.equal(dataRequests.length,before,'choosing a car does not fetch a map');
   holdData(); await click('carConfirm'); console.log('STARTING',id);
   await page.waitForFunction(()=>__loading.open);
   assert.match(await page.locator('#ldContext').textContent(),/QUICK RACE/);
   await snap(id+'-loading'); releaseData(); await waitWorld(id);
   await page.evaluate(()=>{__game.countT=2;__sim.step(1,.05);__sim.render();});
   assert.equal(await page.evaluate(()=>__game.state),'race');
   const runtime=await page.evaluate(()=>__mapRuntime()); assert.equal(runtime.worlds.length,1);
   if(id!=='riviera') assert.equal(runtime.lastDisposal.bundleDisposed,true);
   report.paths.push({id,runtime,requests:dataRequests.slice(before)}); await snap(id+'-race');
  }
  await page.evaluate(()=>{__sim.step(10,.05);__game.run.r.timeLimit=.01;__sim.step(1,.05);});
  assert.equal(await page.evaluate(()=>__game.state),'finished');
  assert.equal(await page.locator('[data-action="replay"]').count(),0);
  assert.equal(await page.locator('#replay-controls').count(),0);
  // Same-map restart reuses the world.
  const sameMap=dataRequests.length;
  await page.evaluate(()=>__flow.startEvent(__flow.freeRoamDef())); await waitWorld('megara');
  await page.waitForTimeout(500); await page.evaluate(()=>{__sim.step(1,.05);__sim.render();});
  assert.equal(dataRequests.length,sameMap);
  assert.equal(await page.evaluate(()=>__ghostLap.ctx.route===__sim.route),true);
  }
  // Returning to title and browsing host/join screens must not build another world.
  await page.evaluate(()=>__flow.quit());await page.waitForTimeout(400);
  await click('mpHost'); await page.waitForFunction(()=>__multiplayer.connected);
  holdData(); await page.evaluate(()=>__multiplayer.createLobby({mapId:'penteli',private:true,config:{traffic:0}}));
  await page.waitForFunction(()=>__multiplayer.active);
  await page.waitForFunction(()=>__loading.open);await snap('mp-lobby-loading'); releaseData();
  await page.waitForFunction(()=>__multiplayer.worldReady&&__multiplayer.me?.loaded,null,{timeout:600000});
  report.lobby=await page.evaluate(()=>({code:__multiplayer.lobby.code,worldReady:__multiplayer.worldReady,loaded:__multiplayer.me.loaded,mapId:__flow.mapId}));
  assert.equal(report.lobby.mapId,'penteli');
  if(await page.evaluate(()=>!!__multiplayer.__screens))assert.equal(await page.evaluate(()=>__flow.menu.screen),'mpLobby');
  await snap('mp-host-lobby');
  // A protocol peer supplies the second driver without a second software-rendered world.
  const {WebSocket}=await import(pathToFileURL(resolve(root,'node_modules/ws/wrapper.mjs')));
  const {MULTIPLAYER_PROTOCOL}=await import(pathToFileURL(resolve(root,'src/multiplayer-protocol.js')));
  const code=report.lobby.code; let peerReady=false;
  const peer=new WebSocket(`ws://127.0.0.1:${server.address().port}/ws?protocol=${MULTIPLAYER_PROTOCOL}`);
  peer.on('message',bytes=>{const m=JSON.parse(bytes);if(m.type==='hello')peer.send(JSON.stringify({type:'join',code,name:'LAZY BOOT PEER',car:'mini'}));if(m.type==='lobby'&&m.lobby.status==='waiting'&&!peerReady){peerReady=true;peer.send(JSON.stringify({type:'loaded',loaded:true,mapId:m.lobby.mapId,version:m.lobby.track.version}));peer.send(JSON.stringify({type:'ready',ready:true,car:'mini',mapId:m.lobby.mapId,version:m.lobby.track.version}));}});
  await page.waitForFunction(()=>__multiplayer.lobby.players.length===2&&__multiplayer.lobby.players.every(p=>p.loaded),null,{timeout:30000});
  await page.evaluate(()=>__multiplayer.$('mp-ready').click());
  await page.waitForFunction(()=>__multiplayer.lobby.players.every(p=>p.ready));await page.evaluate(()=>__multiplayer.startRace());
  await page.waitForFunction(()=>__multiplayer.lobby.status==='race',null,{timeout:30000});
  await page.evaluate(()=>{__multiplayer.close();__flow.menu.hide();__multiplayer.advanceClock();__sim.step(1,.05);__sim.render();});
  const race=await page.evaluate(()=>__multiplayer.startedRace);await snap('mp-race');
  holdData(); await page.reload({waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.__loading?.open,null,{timeout:30000});await snap('mp-resume-loading'); releaseData();
  await page.waitForFunction(race=>__multiplayer.startedRace===race&&__multiplayer.worldReady&&__flow.mapId==='penteli',race,{timeout:600000});
  await page.evaluate(()=>{__multiplayer.advanceClock();__sim.step(1,.05);__sim.render();});
  report.resume=await page.evaluate(()=>({race:__multiplayer.startedRace,state:__game.state,mapId:__flow.mapId,resumes:__multiplayer.resumeCount,runtime:__mapRuntime()}));
  assert.equal(report.resume.state,'race');await snap('mp-resumed-race');peer.close();
  await page.evaluate(()=>__multiplayer.send({type:'leave'}));await page.waitForFunction(()=>!__multiplayer.active);
  for (const visit of ['direct','direct-reload']) {
   await page.goto(`http://127.0.0.1:${server.address().port}/?event=quick&map=megara&simhook&debug&quality=low&cam=chase`,{waitUntil:'domcontentloaded',timeout:120000});
   await waitWorld('megara');assert.equal(await page.evaluate(()=>__mapRuntime().worlds.length),1);
   assert.equal(await page.evaluate(()=>__game.cam),'chase','direct race URLs retain the requested driving camera');
   await snap(visit);console.log('DIRECT URL',visit,'megara');
  }
  assert.deepEqual(errors,[]);
  console.log('SCENARIOS',JSON.stringify({paths:report.paths,lobby:report.lobby,resume:report.resume}));
 }

}catch(e){report.failure=e.stack;process.exitCode=1;console.error(e);await snap('failure').catch(()=>{});}finally{await fs.writeFile(resolve(out,'measurement.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));await app.close();}
