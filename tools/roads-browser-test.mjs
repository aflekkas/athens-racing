#!/usr/bin/env node
// Run through tools/browser-slot.sh. A private game server owns an ephemeral HTTP/WebSocket port;
// Playwright owns its browser through a pipe, so this runner never shares a CDP port with another agent.
// Before = legacy network, after = drivable OSM network. Capture renderer throughput at fixed resolution.
import {createGameServer} from '../server/index.mjs';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,extname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),out=resolve(root,'.scratch/roads-v2');
const mode=process.argv[2]||'after',ids=(process.argv[3]||'riviera,megara,penteli').split(',');
// Photo mode hides the text UI. An external font request must not hold a road screenshot indefinitely.
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
let pw;
for(const name of [process.env.PLAYWRIGHT_MODULE,'playwright','/tmp/pw/node_modules/playwright/index.mjs'].filter(Boolean)){try{pw=await import(name.startsWith('/')?pathToFileURL(name).href:name);break;}catch{}}
if(!pw)throw Error('Set PLAYWRIGHT_MODULE to an installed Playwright module');
let executablePath=process.env.CHROME_BIN;
if(!executablePath&&!existsSync(pw.chromium.executablePath()))for(const folder of (await fs.readdir(resolve(homedir(),'.cache/ms-playwright')).catch(()=>[])).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse()){const p=resolve(homedir(),'.cache/ms-playwright',folder,'chrome-linux64/chrome');if(existsSync(p)){executablePath=p;break;}}
const frozen=new Map();for(const base of ['src','data'])for(const file of await fs.readdir(resolve(root,base),{recursive:true})){const path=resolve(root,base,file);if((await fs.stat(path)).isFile())frozen.set(path,await fs.readFile(path));}for(const file of ['index.html','style.css'])frozen.set(resolve(root,file),await fs.readFile(resolve(root,file)));
await fs.mkdir(out,{recursive:true});const app=await createGameServer({dataDir:resolve(out,'server-data')});
const serve=app.server.listeners('request')[0];app.server.removeAllListeners('request');app.server.on('request',(req,res)=>{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname),file=path===resolve(root)?resolve(root,'index.html'):path;if(frozen.has(file)){res.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':extname(file)==='.css'?'text/css':extname(file)==='.html'?'text/html':extname(file)==='.json'?'application/json':'application/octet-stream');res.end(frozen.get(file));}else serve(req,res);});
await new Promise(done=>app.server.listen(0,'127.0.0.1',done));const port=app.server.address().port;
console.log('Road verification HTTP port',port,'PID',process.pid);
const browser=await pw.chromium.launch({headless:true,executablePath,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report=[];
// Use roads-overlay-capture.mjs for orthographic OSM overlays; perspective collages distort terrain scale.

try{for(const id of ids)for(const label of mode==='compare'?['before','final']:[mode]){
 const page=await browser.newPage({viewport:{width:640,height:400},deviceScaleFactor:1}),errors=[];
 page.on('pageerror',e=>{errors.push(String(e));console.log(id,'PAGEERROR',String(e));});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(id,'CONSOLE',m.text());}});
 await page.route('**/src/main.js',async r=>{const response=await r.fetch();const source=(await response.text()).replace('stencil: false','stencil: false, preserveDrawingBuffer: true');await r.fulfill({response,body:source});});
 await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__freezeRoads&&cb.name==='frame'?0:raf(cb);});
 await page.goto(`http://127.0.0.1:${port}/?menu&simhook&quality=low&notraffic&fixeddt&map=${id}${label==='before'?'&noroadnetwork':''}`,{waitUntil:'domcontentloaded',timeout:120000});
 let probing=false;const probe=setInterval(async()=>{if(probing)return;probing=true;try{console.log(id,'BOOT',await page.evaluate(()=>document.body.innerText.slice(-140)));}catch{}finally{probing=false;}},20000);try{await page.waitForFunction(()=>document.body.classList.contains('loaded'),null,{timeout:600000});}finally{clearInterval(probe);}console.log(id,'READY');
 await page.evaluate(()=>{window.__freezeRoads=true;});
 const station=id==='riviera'?970:id==='megara'?254:5744;
 await page.evaluate(s=>{const r=window.__replay,{route,camera,G}=r.ctx;G.state='paused';if(!r.photo())throw Error('Photo mode unavailable');r.ui.hidden=true;document.querySelector('#graphics-quality').style.visibility='hidden';const v=window.__sim.player.veh;v.reset(s,route.closed?0:route.laneU(s,0),0);const p=route.point(s,0),f=route.frame(s,{});camera.position.set(p.x-f.tx*11+f.rx*4,p.y+4,p.z-f.tz*11+f.rz*4);camera.lookAt(p.x+f.tx*16,p.y+1,p.z+f.tz*16);camera.rotation.reorder('YXZ');Object.assign(r.photoState,{position:camera.position.clone(),yaw:camera.rotation.y,pitch:camera.rotation.x,roll:0,fov:78,dof:0});r.ctx.post.setPhoto(r.photoState);r.updateCamera(0);r.ctx.render();},station);
 console.log(id,label,'MEASURE');
 const perf=await page.evaluate(()=>{const c=window.__replay.ctx,gl=c.renderer.getContext(),calls=[],tris=[],frames=[];for(let i=0;i<2;i++){window.__sim.step(1);c.render();gl.finish();}for(let i=0;i<6;i++){const start=performance.now();window.__sim.step(1);c.render();gl.finish();frames.push(performance.now()-start);calls.push(c.renderer.info.render.calls);tris.push(c.renderer.info.render.triangles);}const mean=a=>a.reduce((s,n)=>s+n,0)/a.length;return{fps:1000/mean(frames),calls:mean(calls),triangles:mean(tris),gpu:window.__renderInfo().gpu,pixelRatio:window.__renderInfo().pixelRatio};});
 await fs.writeFile(resolve(out,`${label}-${id}-perf.json`),JSON.stringify({id,label,...perf,errors},null,2));console.log(id,'PERF',JSON.stringify(perf));
 const chase=await page.evaluate(()=>{const c=window.__replay.ctx;c.render();c.renderer.getContext().finish();return c.canvas.toDataURL('image/png').split(',')[1];});await fs.writeFile(resolve(out,`${label}-${id}-chase.png`),Buffer.from(chase,'base64'));console.log(id,'CHASE');
 await page.evaluate(()=>{const r=window.__replay,{route,camera}=r.ctx,p=route.point(window.__sim.player.veh.s,0);for(const car of r.cars)car.model.root.visible=false;camera.position.set(p.x,p.y+260,p.z+.01);camera.lookAt(p.x,p.y,p.z);camera.rotation.reorder('YXZ');Object.assign(r.photoState,{position:camera.position.clone(),yaw:camera.rotation.y,pitch:camera.rotation.x,roll:0,fov:70,dof:0});r.updateCamera(0);r.ctx.render();});
 const top=await page.evaluate(()=>{const c=window.__replay.ctx;c.render();c.renderer.getContext().finish();return c.canvas.toDataURL('image/png').split(',')[1];});await fs.writeFile(resolve(out,`${label}-${id}-top.png`),Buffer.from(top,'base64'));console.log(id,'TOP');
 const verification=await page.evaluate(()=>{const n=window.__sim.ground.network;if(!n)return null;let samples=0;const failures=[];for(const seg of n.segments){const x=(seg.ax+seg.bx)/2,z=(seg.az+seg.bz)/2,q=n.project(x,z),a={};window.__sim.ground.at(x,z,q.s,q.u,a);if(Math.abs(q.u)<n.route.edge(q.s)+.7)continue;samples++;if(!a.network||Math.abs(a.y-n.height(x,z))>.001)failures.push({x,z,surf:a.surf,y:a.y});}return{samples,failures,stats:n.stats};});
 const row={id,label,station,...perf,errors,verification};report.push(row);await fs.writeFile(resolve(out,`${label}-${id}-perf.json`),JSON.stringify(row,null,2));await fs.writeFile(resolve(out,`${label}-perf.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(row));await page.close();
 if(errors.length||verification?.failures.length)throw Error(`${id}: browser validation failed; see ${label}-${id}-perf.json`);
}}
finally{await browser.close();await app.close();}
