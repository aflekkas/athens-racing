#!/usr/bin/env node
// Repository browser workflow: tools/browser-slot.sh node tools/render-lighting-browser.mjs [--before]
// Private server and browser; no shared CDP ports. Fixed simulation/camera, canvas-only luminance.
import { createGameServer } from '../server/index.mjs';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const restoreOnly=process.argv.includes('--restore-only');
const before=process.argv.includes('--before'), out=resolve(process.env.RENDER_EVIDENCE_DIR || resolve(root,'.scratch/render-lighting'), before?'before':restoreOnly?'restore':'after');
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
let pw; for(const name of [process.env.PLAYWRIGHT_MODULE,'/tmp/pw/node_modules/playwright/index.mjs','playwright'].filter(Boolean)) {try{pw=await import(name.startsWith('/')?pathToFileURL(name).href:name);break;}catch{}}
if(!pw)throw Error('Install Playwright or set PLAYWRIGHT_MODULE');
await fs.mkdir(out,{recursive:true});
const frozen=new Map(); for(const base of ['src','data'])for(const file of await fs.readdir(resolve(root,base),{recursive:true})){const path=resolve(root,base,file);if((await fs.stat(path)).isFile())frozen.set(path,await fs.readFile(path));}
for(const file of ['index.html','style.css'])frozen.set(resolve(root,file),await fs.readFile(resolve(root,file)));
if(before)for(const name of ['main','graphics','env','post','weather','settings']){const p=resolve(root,'.scratch/render-lighting/baseline',name+'.js');if(existsSync(p))frozen.set(resolve(root,'src',name+'.js'),await fs.readFile(p));}
const app=await createGameServer({dataDir:resolve(out,'server-data')});
const serve=app.server.listeners('request')[0]; app.server.removeAllListeners('request'); app.server.on('request',(req,res)=>{let file=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(file===root)file=resolve(root,'index.html');if(frozen.has(file)){res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[extname(file)]||'application/octet-stream');res.end(frozen.get(file));}else serve(req,res);});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await pw.chromium.launch({headless:true,executablePath:process.env.CHROME_BIN || resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:640,height:400},deviceScaleFactor:1}),errors=[],report={before,views:{},switches:[],errors};
page.on('pageerror',e=>{errors.push(String(e));console.log('PAGEERROR',String(e));});
page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('CONSOLE',m.text());}});
await page.route('**/src/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('stencil: false','stencil: false, preserveDrawingBuffer: true').replace("import * as THREE from 'three';", "import * as THREE from 'three'; window.__lightingTHREE = THREE;")});});
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__freezeLighting&&cb.name==='frame'?0:raf(cb);});
async function capture(label){const shot=await page.evaluate(()=>{const r=window.__replay.ctx;r.render();r.renderer.getContext().finish();const c=document.createElement('canvas');c.width=640;c.height=400;const x=c.getContext('2d');x.drawImage(r.canvas,0,0,640,400);const a=x.getImageData(0,0,640,400).data;let sum=0;for(let i=0;i<a.length;i+=4)sum+=.2126*a[i]+.7152*a[i+1]+.0722*a[i+2];const THREE=window.__lightingTHREE;const rt=new THREE.WebGLRenderTarget(32,32),scene=new THREE.Scene(),material=new THREE.ShaderMaterial({uniforms:{t:{value:r.scene.environment}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform sampler2D t;varying vec2 v;void main(){gl_FragColor=vec4(texture2D(t,v).rgb,1.);}'}),geometry=new THREE.PlaneGeometry(2,2);scene.add(new THREE.Mesh(geometry,material));r.renderer.setRenderTarget(rt);r.renderer.render(scene,new THREE.Camera());const data=new Uint8Array(32*32*4);r.renderer.readRenderTargetPixels(rt,0,0,32,32,data);let ibl=0;for(let i=0;i<data.length;i+=4)ibl+=data[i]+data[i+1]+data[i+2];r.renderer.setRenderTarget(null);rt.dispose();material.dispose();geometry.dispose();return {iblLuminance:ibl/(32*32*3),luminance:sum/(a.length/4),png:c.toDataURL().split(',')[1],health:window.__lightingInfo?.(),render:window.__renderInfo()};});await fs.writeFile(resolve(out,label+'.png'),Buffer.from(shot.png,'base64'));delete shot.png;console.log(label,JSON.stringify(shot));return shot;}
async function view(cam){await page.evaluate(cam=>{const {G,camera}=window.__replay.ctx;G.cam=G.userCam=cam;const {player}=window.__sim;player.model.root.visible=true;player.model.body.visible=true;player.cockpit.setVisible(true);player.driver.head.visible=cam!=='cockpit';player.model.root.updateMatrixWorld(true);const forward=player.model.root.position.clone().set(0,0,-1).applyQuaternion(player.model.root.quaternion),p=player.model.root.position;if(cam==='cockpit'){player.driver.head.getWorldPosition(camera.position);camera.position.y+=.02;camera.lookAt(camera.position.clone().add(forward));camera.fov=66;camera.near=.05;}else{camera.position.copy(p).addScaledVector(forward,-7);camera.position.y+=2.8;camera.lookAt(p.clone().addScaledVector(forward,8).add(player.model.root.position.clone().set(0,1,0)));camera.fov=58;camera.near=.25;}camera.updateProjectionMatrix();camera.updateMatrixWorld(true);window.__replay.ctx.post.resetHistory();},cam);}

try{
await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&fixedres&fixeddt&notraffic&quality=high&map=megara&car=mini`,{waitUntil:'domcontentloaded',timeout:120000});
console.log('Loading game on port',app.server.address().port);
await page.waitForFunction(()=>document.body.classList.contains('loaded'),null,{timeout:600000,polling:100});console.log('READY');
await page.evaluate(()=>{window.__freezeLighting=true;});
// Drain a frame queued before the freeze before recording exact race state.
await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
await page.evaluate(()=>{window.__game.state='race';window.__sim.player.veh.reset(254,0,0);window.__sim.step(1);});console.log('FROZEN');
console.log('SOCKET',await page.evaluate(()=>({state:window.__multiplayer.ws?.readyState,connected:window.__multiplayer.connected,status:document.querySelector('#mp-status')?.textContent})));
await page.waitForFunction(()=>window.__multiplayer.ws?.readyState===1,null,{timeout:30000,polling:100});
const navigation=await page.evaluate(()=>performance.timeOrigin),identity=await page.evaluate(()=>{window.__lightingIdentity={world:window.__replay.ctx.scene.getObjectByName('map-world:megara'),player:window.__sim.player,post:window.__post,veh:window.__sim.player.veh,socket:window.__multiplayer.ws,raceT:window.__game.raceT};return window.__sim.player.veh.s;});console.log('IDENTITY');
for(const cam of ['cockpit','chase']){console.log('VIEW',cam);await view(cam);console.log('CAPTURE',cam);report.views[cam]={initial:await capture(cam+'-initial')};}
// Baseline reproducer: the second PMREM bake reuses its output with a fresh, uninitialized generator.
if(before){report.condition=await page.evaluate(()=>{try{window.__setConditions({time:'day',weather:'overcast'});return {ok:true};}catch(e){return {ok:false,error:String(e)};}});console.log('CONDITION',JSON.stringify(report.condition));await page.evaluate(()=>window.__setConditions({time:'afternoon',weather:'clear'}));await page.evaluate(()=>(window.__loseExt = window.__replay.ctx.renderer.getContext().getExtension('WEBGL_lose_context')).loseContext());await page.waitForFunction(()=>window.__game.ctxLost);await page.evaluate(()=>window.__loseExt.restoreContext());await page.waitForFunction(()=>!window.__game.ctxLost);for(const cam of ['cockpit','chase']){await view(cam);report.views[cam].final=await capture(cam+'-final');}}
else {
for(let i=0;i<(restoreOnly?0:20);i++){
 const row=await page.evaluate(async i=>{const {applyQualityTier,applyRenderResolution}=window.__renderTest;const q=['med','low','ultra','high'][i%4];applyQualityTier(q);applyRenderResolution(i%5===0?'auto':.5+(i%6)*.1,{pixelRatioCap:i%2?1:2});window.__setConditions({time:i%2?'night':'day',weather:['clear','overcast','rain'][i%3]});window.__replay.ctx.render();return {i,q,health:window.__lightingInfo(),render:window.__renderInfo(),state:window.__game.state,s:window.__sim.player.veh.s,sameWorld:window.__lightingIdentity.world===window.__replay.ctx.scene.getObjectByName('map-world:megara'),samePlayer:window.__lightingIdentity.player===window.__sim.player,samePost:window.__lightingIdentity.post===window.__post,sameSocket:window.__lightingIdentity.socket===window.__multiplayer.ws,socketOpen:window.__multiplayer.ws.readyState===1,raceT:window.__game.raceT};},i);report.switches.push(row);assert(row.health.valid,JSON.stringify(row));assert(row.sameWorld&&row.samePlayer&&row.samePost&&row.sameSocket&&row.socketOpen);assert.equal(row.raceT,await page.evaluate(()=>window.__lightingIdentity.raceT));assert.equal(row.state,'race');assert.equal(row.s,identity);console.log('SWITCH',i,row.q,row.health.valid);
 await page.evaluate(()=>{window.__setConditions({time:'afternoon',weather:'clear'});window.__post.snapGrade();});await view(i%2?'cockpit':'chase');const sample=await capture('switch-'+i);row.luminance=sample.luminance;assert(sample.luminance>=report.views[i%2?'cockpit':'chase'].initial.luminance*.75,`switch ${i} lost >25% luminance`);
}
await page.evaluate(async()=>{const g=window.__renderTest;g.applyQualityTier('high');g.applyRenderResolution(1,{pixelRatioCap:1});window.__setConditions({time:'afternoon',weather:'clear'});window.__lightingGuard(true);});
// Force a partial probe cycle immediately before loss; restored empty faces must never overwrite the seed.
await page.evaluate(()=>{window.__renderTest.probeFace(4);(window.__loseExt = window.__replay.ctx.renderer.getContext().getExtension('WEBGL_lose_context')).loseContext();});
await page.waitForFunction(()=>window.__game.ctxLost,null,{timeout:10000,polling:100});
await page.evaluate(()=>window.__loseExt.restoreContext());
await page.waitForFunction(()=>!window.__game.ctxLost,null,{timeout:30000,polling:100});
await page.evaluate(()=>window.__lightingGuard(true));
assert(await page.evaluate(()=>window.__lightingInfo().valid));
console.log('RESTORED',await page.evaluate(()=>window.__lightingInfo()));
await page.evaluate(()=>{for(let i=0;i<12;i++){window.__sim.step(1);window.__replay.ctx.render();}});console.log('PROBE CYCLE COMPLETE');
for(const cam of ['cockpit','chase']){await view(cam);report.views[cam].final=await capture(cam+'-final');const v=report.views[cam];assert(v.final.luminance>=v.initial.luminance*.75,cam+' lost >25% luminance');assert(v.final.health.valid);assert(v.final.iblLuminance>=v.initial.iblLuminance*.75,'PMREM mip atlas lost light');}
// Guard fault injection, measured against the same fixed chase screenshot.
await page.evaluate(()=>{window.__renderTest.breakLighting();window.__lightingGuard(true);window.__replay.ctx.render();});report.guard=await capture('chase-guard-repaired');assert(report.guard.health.valid);assert(report.guard.luminance>=report.views.chase.initial.luminance*.75);
assert.equal(await page.evaluate(()=>performance.timeOrigin),navigation);assert.equal(errors.length,0,errors.join('\n'));
}
}catch(error){console.error('VERIFICATION FAILED',error);throw error;}finally{await fs.writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));await browser.close();await app.close();}
