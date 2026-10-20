// Real game, headless: a 60 km/h hit then the lane card, chase and cockpit views, at three viewport sizes.
// Run through tools/browser-slot.sh: node ui-capture.mjs ROOT OUTDIR TAG  (ROOT is an unpacked checkout; its tools/notices-capture-helper.cjs is used).
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]),out=resolve(process.argv[3]);const captureHelpers=(await import(pathToFileURL(resolve(root,'tools/notices-capture-helper.cjs')))).default;await fs.mkdir(out,{recursive:true});
const {createGameServer}=await import(pathToFileURL(resolve(root,'server/index.mjs')));
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});
const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.bin':'application/octet-stream','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.wav':'audio/wav','.mp3':'audio/mpeg','.woff2':'font/woff2'};
const {buildReleaseInfo,buildCredits}=await import(pathToFileURL(resolve(root,'tools/release-data.mjs')));
const release=await buildReleaseInfo(root,{sha:'ui-audit'}),credits=await buildCredits(root,{authors:[]});
const fixtureHTML=variant=>{const prefix=variant==='before'?'/legacy':'';return `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,600;1,700;1,800;1,900&family=Barlow:wght@300;400;500;600;700&display=swap" rel="stylesheet">${['/style.css','/src/ui/ui.css','/src/menu.css','/src/recovery-prompt.css'].map(path=>`<link rel="stylesheet" href="${prefix}${path}">`).join('')}<style>html,body{background:#101a20!important}#hud{opacity:0}</style></head><body class="racing started loaded"><div id="hud"><div id="dialBox"></div><div id="mapBox"></div></div><div id="multiplayer" hidden></div><script type="module">import {notifications} from '${prefix}/src/ui/notifications.js';import {updateEngineHud} from '${prefix}/src/engine-hud.js';import * as C from '${prefix}/src/ui/components.js';window.__notifications=notifications;window.auditEngine=updateEngineHud;window.auditComponents=C;window.auditChecks=0;notifications.mount();window.fixtureReady=true;</script></body></html>`;};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),legacy=url.pathname.startsWith('/legacy/'),path=legacy?url.pathname.slice(7):url.pathname;
 if(path==='/notice-fixture'){res.writeHead(200,{'Content-Type':'text/html'});res.end(fixtureHTML(url.searchParams.get('variant')));return;}
 if(path==='/api/auth/config'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({providers:[],required:false}));return;}
 if(path.startsWith('/api/')||path==='/health')return app.server.emit('request',req,res);
 try{
  let file=resolve(root,'.'+(path==='/'?'/index.html':path));if(path.startsWith('/vendor/'))file=resolve(root,'node_modules/three',path.slice(8));
  let body=await fs.readFile(file);
  if(path==='/src/main.js')body=Buffer.from(body.toString().replaceAll('await compileScene();','/* Notice fixture: compile visible materials on its explicit real render. */'));
  if(file.endsWith('index.html'))body=Buffer.from(body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/vendor/').replace('</head>',`<meta name="asr-version" content="${release.version}"><script id="asr-release-data" type="application/json">${JSON.stringify({release,credits}).replaceAll('<','\\u003c')}</script></head>`));
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':body.length,'Cache-Control':file.endsWith('index.html')?'no-cache':'public,max-age=3600'});res.end(body);
 }catch{res.writeHead(404);res.end();}
});
server.on('upgrade',(...args)=>app.server.emit('upgrade',...args));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[];const tag=process.argv[4]||'run';
const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();page.setDefaultTimeout(240000);
page.on('pageerror',e=>{errors.push(e.stack);console.log('PAGEERROR',e.message);});page.on('console',msg=>{if(msg.type()==='error')console.log('BROWSER',msg.text().slice(0,250));});
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>{if(cb.name==='frame'){window.auditFrame=cb;return 0;}return raf(cb);};});
const shot=async(path)=>{await captureHelpers.prepareCapture(page);const cdp=await context.newCDPSession(page),data=await cdp.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path,Buffer.from(data.data,'base64'));await cdp.detach();};
const report=[];
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/?simhook&map=megara&event=free&quality=low&notraffic&nopedestrians&cam=chase`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__sim?.player&&document.body.classList.contains('loaded'));
 await page.evaluate(async()=>{await document.fonts.load('italic 800 17px "Barlow Condensed"');await document.fonts.ready;});
 await page.evaluate(()=>{__flow.menu.hide();document.querySelector('#accounts-offline')?.remove();__multiplayer.panel.hidden=true;__sim.G.state='race';__sim.G.cam='chase';__sim.G.cameraStarting=false;__sim.step(1);document.body.classList.remove('menu','menu-backdrop','ui-open','counting');document.body.classList.add('racing');document.querySelector('#count').textContent='';__sim.render();});
 console.log('WORLD READY');
 // main.js calls updateEngineHud every frame with these arguments; the frozen harness frame does not reach it, so call the real function the same way
const engine=()=>page.evaluate(async()=>{const e=await import('/src/engine-hud.js');e.updateEngineHud(__sim.player.veh,{visible:true,spectating:false,towLabel:'R / T',repairAvailable:true,towCost:0,gamepad:false,confirmLabel:'A',onRepair(){}});__notifications.dirty=true;__notifications.update();});
const view=async v=>{await page.evaluate(v=>{__sim.G.cam=v;__sim.G.userCam=v;document.body.dataset.cameraView=v;__sim.cameraBlend.active=false;__sim.step(2);__sim.cameraBlend.active=false;__notifications.clear();__sim.step(8);__sim.cameraBlend.active=false;__sim.render();},v);await engine();await page.waitForTimeout(300);};
 // a real 60 km/h head-on blow to the nose, as Ground reports it (contact point and normal in visual-car coordinates)
 const hit=(kmh,zone='front')=>page.evaluate(([kmh,zone])=>{const v=__sim.player.veh;v.addDamage(zone,kmh/3.6,{kind:'wall',localPoint:{x:-.35,y:.45,z:-v.spec.length/2},localNormal:{x:.15,y:0,z:.99}});v.damageFx(.05);__sim.step(3);},[kmh,zone]);
 const lane=()=>page.evaluate(()=>{const l=document.querySelector('#notification-lane');const r=l.getBoundingClientRect();return{text:l.innerText.replace(/\s+/g,' ').trim(),visible:[...l.children].filter(e=>!e.hidden).map(e=>e.dataset.notificationId),rect:[r.left,r.top,r.right,r.bottom].map(Math.round),overlaps:(()=>{const els=[...l.querySelectorAll('.race-notice:not([hidden]) *')].filter(e=>e.getClientRects().length&&e.children.length===0&&e.textContent.trim());const boxes=els.map(e=>e.getBoundingClientRect());let n=0;for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)n++;}return n;})()}});
 const dial=()=>page.evaluate(()=>document.querySelector('#dialBox')?.getBoundingClientRect().toJSON());
 for(const[w,h]of[[1280,800],[1440,900],[1920,1080]]){
  await page.setViewportSize({width:w,height:h});
  await page.evaluate(()=>{const v=__sim.player.veh;v.reset(v.s,v.u,0);__sim.player.model.setDamageSnapshot?.({front:0,rear:0,left:0,right:0});});
  for(const v of ['chase','cockpit']){await view(v);await shot(resolve(out,`${tag}-clean-${v}-${w}.png`));}
  await hit(60);
  await page.evaluate(()=>{__sim.G.state='race';__sim.step(10);});
  for(const v of ['chase','cockpit']){await view(v);await page.waitForTimeout(300);await shot(resolve(out,`${tag}-hit60-${v}-${w}.png`));report.push({w,h,view:v,state:'60 km/h hit',...await lane(),health:await page.evaluate(()=>__sim.player.veh.engHealth)});}
  // an acute failure: the engine stops after a 95 km/h blow
  await page.evaluate(()=>{const v=__sim.player.veh;v.engineStalled=true;v.engHealth=0;v.damageFx(.05);__sim.step(6);});
  await view('chase');await page.waitForTimeout(300);await shot(resolve(out,`${tag}-stalled-chase-${w}.png`));report.push({w,h,view:'chase',state:'engine stopped',...await lane()});
  // the NEED A TOW? prompt next to the stopped-engine card (same lane group: it must never overlap)
  await page.evaluate(async()=>{const C=await import('/src/ui/components.js');const tow=document.createElement('aside');tow.id='tow-prompt';tow.className='tow-prompt ui-prompt';tow.innerHTML='<strong>NEED A TOW?</strong><p>Return to the road.</p><div class="tow-actions"><button type="button">'+C.kbd('R')+' Tow to the road</button><button type="button">Keep driving</button></div>';__notifications.adopt('tow',tow,{priority:60,persistent:true});__notifications.dirty=true;__notifications.update();});
  await page.waitForTimeout(300);await shot(resolve(out,`${tag}-stalled-tow-chase-${w}.png`));report.push({w,h,view:'chase',state:'engine stopped + tow prompt',...await lane()});
  await page.evaluate(()=>{__notifications.dismiss('tow');});
  await page.evaluate(()=>{const v=__sim.player.veh;v.engineStalled=false;v.engineDamage=.4;v.damageFx(.05);__sim.step(3);});await engine();await page.waitForTimeout(300);
  await shot(resolve(out,`${tag}-wear-chase-${w}.png`));report.push({w,h,view:'chase',state:'engine wear',...await lane()});
  await page.evaluate(()=>{const v=__sim.player.veh;v.engineDamage=0;v.damageFx(.05);__sim.step(3);});
 }
 await fs.writeFile(resolve(out,`${tag}-report.json`),JSON.stringify({report,errors},null,1));console.log(JSON.stringify(report.map(r=>({w:r.w,view:r.view,state:r.state,visible:r.visible,overlaps:r.overlaps,text:r.text.slice(0,120)})),null,1));
}catch(e){console.error(e);await shot(resolve(out,tag+'-failure.png')).catch(()=>{});process.exitCode=1;}finally{await browser.close();server.close();app.server.close();process.exit(process.exitCode||0);}
