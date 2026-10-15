// One browser job, real map/physics/recovery fade. Run with tools/browser-slot.sh.
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {homedir} from 'node:os';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.scratch/riviera-rails');await fs.mkdir(out,{recursive:true});
const pw=await import('/tmp/pw/node_modules/playwright/index.mjs');
let phase='before';
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://local').pathname;
 const file=phase==='before'&&path==='/src/road.js'?resolve(out,'before-road.js'):path.startsWith('/world-three/')?resolve(root,'node_modules/three',path.slice(13)):resolve(root,'.'+(path==='/'?'/index.html':path));
 let data=await fs.readFile(file);
 if(path==='/'||path==='/index.html')data=Buffer.from(data.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/world-three/'));
 if(path==='/src/main.js')data=Buffer.from(data.toString().replace('stencil: false','stencil: false, preserveDrawingBuffer: true'));
 res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(data);
}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await pw.chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={shots:[],errors:[]};
const suffix=process.env.CAPTURE_FULLRES?'-fullres':'';
try{for(phase of (process.env.CAPTURE_PHASES||'before,after').split(',')){
 const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(600000);
 page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
 page.on('pageerror',e=>{console.log('ERROR',e.stack);report.errors.push(String(e));});
 await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__freezeOfftrack&&cb.name==='frame'?0:raf(cb);});
 console.log('BOOT',phase);
 await page.goto(`http://127.0.0.1:${server.address().port}/?menu&simhook&quality=potato&fixedres&notraffic&map=riviera`,{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>document.body.classList.contains('loaded')&&window.__flow,null,{timeout:120000});
 await page.evaluate(async()=>{await window.__flow.startEvent('quick');window.__freezeOfftrack=true;});
 await page.waitForFunction(()=>window.__sim?.ground && window.__sim.G.run,null,{timeout:600000});console.log('READY',phase);
 for(const s of (process.env.CAPTURE_FULLRES?[2860,8200,3920]:[2860,8200])){
  const shot=await page.evaluate(({s,fullres})=>{
   const sim=window.__sim,{route:r,player:{veh:v},G}=sim;
   if(fullres){sim.renderer.setPixelRatio(1);sim.renderer.setSize(1280,800,false);sim.post?.setSize(1280,800,1);}
   G.state='race';G.paused=null;G.towing=false;G.cam='chase';
   v.reset(s,Math.min(3,r.edge(s)-2),0);sim.step(180,1/60);
   // Production chase camera, settled after teleport; freeze simulation for capture.
   sim.render();let rails,placements;sim.scene.traverse(o=>{if(o.userData.guardrails)rails=o.userData.guardrails;if(o.userData.placements)placements=o.userData.placements.filter(p=>['stairs','canteen','shack'].includes(p.model)).map(p=>({model:p.model,...r.project(p.x,p.z)}));});
   return {png:sim.canvas.toDataURL('image/png').split(',')[1],s:v.s,u:v.u,camera:sim.camera.position.toArray(),calls:sim.renderer.info.render.calls,triangles:sim.renderer.info.render.triangles,rails,placements};
  },{s,fullres:!!process.env.CAPTURE_FULLRES});
  await fs.writeFile(resolve(out,`${phase}-${s}${suffix}.png`),Buffer.from(shot.png,'base64'));delete shot.png;report.shots.push({phase,...shot});console.log('SHOT',JSON.stringify(report.shots.at(-1)));
 }
 await page.close();
}}finally{await fs.writeFile(resolve(out,`browser-report${suffix}.json`),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
