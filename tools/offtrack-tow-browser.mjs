// One browser job, real map/physics/recovery fade. Run with tools/browser-slot.sh.
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {homedir} from 'node:os';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.scratch/offtrack-tow');await fs.mkdir(out,{recursive:true});
const pw=await import('/tmp/pw/node_modules/playwright/index.mjs');
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://local').pathname;
 const file=path.startsWith('/world-three/')?resolve(root,'node_modules/three',path.slice(13)):resolve(root,'.'+(path==='/'?'/index.html':path));
 let data=await fs.readFile(file);
 if(path==='/'||path==='/index.html')data=Buffer.from(data.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/world-three/'));
 if(path==='/src/main.js')data=Buffer.from(data.toString().replace('stencil: false','stencil: false, preserveDrawingBuffer: true'));
 res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(data);
}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await pw.chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const ids=process.argv.slice(2).length?process.argv.slice(2):['riviera','penteli'];
if(ids.some(id=>!['riviera','penteli'].includes(id)))throw Error('Expected riviera or penteli');
const report={capture:'Renderer frames plus live DOM state; PNGs exclude HTML overlays.',maps:[],errors:[]};
try { const previous=JSON.parse(await fs.readFile(resolve(out,'browser-report.json'),'utf8')); report.maps=previous.maps.filter(row=>!ids.includes(row.id)); } catch {}
async function capture(page,path) {
 // Compositor screenshots can stall under SwiftShader. Preserve the real renderer
 // frame and record the live DOM separately; no UI is drawn into the exported image.
 const frame=await page.evaluate(()=>{window.__sim.render();return window.__sim.canvas.toDataURL('image/png').split(',')[1];});
 await fs.writeFile(path,Buffer.from(frame,'base64'));
 const dom=await page.evaluate(()=>({classes:document.body.className,text:document.body.innerText,warning:document.body.classList.contains('offtrack-warning'),notices:[...document.querySelectorAll('.race-notice')].map(n=>({text:n.textContent,kind:n.dataset.kind}))}));
 await fs.writeFile(path.replace('.png','.json'),JSON.stringify(dom,null,2));
}
try{for(const id of ids){
 const page=await browser.newPage({viewport:{width:960,height:600}});
 page.setDefaultTimeout(600000);
 page.on('pageerror',e=>{report.errors.push(String(e));console.log('ERROR',String(e));});
 await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__freezeOfftrack&&cb.name==='frame'?0:raf(cb);});
 console.log('BOOT',id);
 await page.goto(`http://127.0.0.1:${server.address().port}/?menu&simhook&quality=potato&fixedres&notraffic&map=${id}`,{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>document.body.classList.contains('loaded')&&window.__flow,null,{timeout:120000});
 await page.evaluate(async()=>{await window.__flow.startEvent('quick');window.__freezeOfftrack=true;});
 await page.waitForFunction(()=>window.__sim?.ground,null,{timeout:600000});
 console.log('WORLD READY',id);
 await page.waitForTimeout(600);
 const setup=await page.evaluate(()=>{
  const sim=window.__sim,{route:r,ground,player:{veh:v},G,towOffer}=sim;
  G.state='race';G.paused=null;G.towing=false;G.cam='chase';document.body.classList.add('racing');document.body.classList.remove('menu','ui-open','counting');
  // Find an unobstructed strip with no connected road within the warning band.
  let chosen;
  for(let s=150;s<r.length-100&&!chosen;s+=53)for(const side of [-1,1]){
   const p=r.point(s,side*(r.edge(s)+15));if(ground.corridor.distance(p.x,p.z)>13&&ground.corridor.distance(p.x,p.z)<20){chosen={s,side};break;}
  }
  if(!chosen)throw Error('No excursion site');
  const {s,side}=chosen;v.reset(s,side*(r.edge(s)-2),0);towOffer.safe={s,u:0};towOffer.hold=0;towOffer.corridorT=0;
  // Controlled lateral departure, integrating the production physics every sample.
  window.__excursion={s,side};return {s,side};
 });
 const samples=await page.evaluate(()=>{
  const sim=window.__sim,{route:r,player:{veh:v},towOffer}=sim,{s,side}=window.__excursion,rows=[];
  // Move across the edge in short steps, preventing terrain obstacles from obscuring corridor detection.
  for(let beyond=0;beyond<=15;beyond+=1){
   const p=r.point(s,side*(r.edge(s)+beyond));v.x=p.x;v.z=p.z;v.y=p.y;v.s=s;v.u=side*(r.edge(s)+beyond);v.vLong=0;v.vLat=0;
   sim.step(1,.05);rows.push({beyond,distance:sim.ground.corridor.distance(v.x,v.z),timer:towOffer.corridorT,warning:document.body.classList.contains('offtrack-warning'),towing:sim.G.towing});
  }
  sim.render();return rows;
 });
 assert.ok(samples.some(x=>x.warning),'warning appears before tow');
 console.log('WARNING',id,JSON.stringify(samples.at(-1)));
 await capture(page,resolve(out,`${id}-warning.png`));
 const triggering=await page.evaluate(()=>{
  const sim=window.__sim,{route:r,player:{veh:v}}=sim,{s,side}=window.__excursion;
  for(let i=0;i<60&&!sim.G.towing;i++){
   const p=r.point(s,side*(r.edge(s)+15));v.x=p.x;v.z=p.z;v.y=p.y;v.s=s;v.u=side*(r.edge(s)+15);v.vLong=v.vLat=0;sim.step(1,.05);
  }
  return {towing:sim.G.towing,timer:sim.towOffer.corridorT};
 });assert.equal(triggering.towing,true,'automatic tow starts');
 await page.waitForTimeout(900);
 const recovered=await page.evaluate(()=>{const sim=window.__sim,v=sim.player.veh;sim.render();return {s:v.s,u:v.u,edge:sim.route.edge(v.s),halfW:v.halfW,towing:sim.G.towing,notice:document.body.textContent.includes('Recovered to road'),warning:document.body.classList.contains('offtrack-warning'),draws:sim.renderer.info.render.calls,triangles:sim.renderer.info.render.triangles,memory:sim.renderer.info.memory};});
 assert.ok(Math.abs(recovered.u)+recovered.halfW<=recovered.edge);assert.ok(recovered.s<=setup.s+.01,'tow cannot advance progress');assert.equal(recovered.notice,true);
 await capture(page,resolve(out,`${id}-recovered.png`));
 report.maps.push({id,setup,samples,triggering,recovered});await fs.writeFile(resolve(out,'browser-report.json'),JSON.stringify(report,null,2));
 console.log('PASS',id,JSON.stringify(recovered));await page.close();
}
assert.deepEqual(report.errors,[]);
}finally{await fs.writeFile(resolve(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
