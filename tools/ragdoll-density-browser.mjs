// One browser-slot job. Compare identical real map assets, seeds, 14:00 and clear skies.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),out=process.env.RAGDOLL_EVIDENCE||path.join(root,'.scratch/ragdoll');await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://local').pathname,file=url==='/src/people-density-before.js'?process.env.RAGDOLL_BEFORE:path.join(root,url==='/'?'/index.html':decodeURIComponent(url));
 let data=await fs.readFile(file);
 if(url==='/'||url==='/index.html')data=Buffer.from(data.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/node_modules/three/'));
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(data);
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/pw/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={at:'14:00 clear',sampling:'500 m disjoint route cells; identical RNG 2024 reset per audit',maps:[],errors:[]};
try{
 for(const id of ['riviera','penteli','megara']){
  console.log('BOOT',id);const page=await browser.newPage({viewport:{width:800,height:500}});page.on('pageerror',e=>{report.errors.push(String(e));console.log(String(e));});page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text());});
  await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__freezeWorld&&cb.name==='frame'?0:raf(cb);});
  await page.goto(`http://127.0.0.1:${server.address().port}/?menu&simhook&quality=low&fixedres&fixeddt&map=${id}`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>document.body.classList.contains('loaded')&&window.__flow,null,{timeout:120000});
  await page.evaluate(id=>{window.__startImpactWorld=__flow.startEvent({...__flow.freeRoamDef(),mapId:id});},id);
  await page.waitForFunction(()=>window.__sim?.people&&!__mapRuntime().switching,null,{timeout:600000});
  const result=await page.evaluate(async()=>{
   window.__freezeWorld=true;__sim.G.state='paused';
   const {People:Before}=await import('/src/people-density-before.js'),THREE=await import('three'),{RNG}=await import('/src/util.js'),env=await import('/src/env.js');
   const after=__sim.people,scene=new THREE.Group(),before=new Before(after.map,scene,after.assets,scene);
   before.anchors.push(...(after.streetLife?.artists||[]).map(a=>({...a,ped:null})));before.anchors.sort((a,b)=>a.s-b.s);
   if(after.route.closed){before.dens=()=>0;before.anchors.length=0;}
   env.COND.hour=14;env.COND_STATE.rain=0;
   const audit=people=>{people.rng=new RNG(2024);const counts={sampled:0,peakLocal:0,walkers:0,anchors:0};
    for(let start=0;start<people.route.length;start+=500){people.reset(start+60);counts.peakLocal=Math.max(counts.peakLocal,people.peds.filter(p=>p.active).length);
     for(const p of people.peds)if(p.active){const s=p.rs?p.s:p.anchor.s;if(s>=start&&s<start+500){counts.sampled++;counts[p.rs?'walkers':'anchors']++;}}
    }return counts;};
   return{map:after.map.id,before:audit(before),after:audit(after)};
  });report.maps.push(result);console.log(JSON.stringify(result));await fs.writeFile(path.join(out,'density-report.json'),JSON.stringify(report,null,2));
  if(id==='riviera'){
   report.feedback=[];
   for(const cam of ['cockpit','chase']){
    const feedback=await page.evaluate(async cam=>{
     const sim=__sim,{RNG}=await import('/src/util.js'),H=await import('/src/human.js');
     await __flow.startEvent(__flow.freeRoamDef());
     sim.G.state='race';sim.G.cam=sim.G.userCam=cam;sim.G.cameraStarting=false;sim.cameraBlend.active=false;
     const people=sim.people,v=sim.player.veh;v.reset(1000,sim.route.laneU(1000,0),10);sim.traffic.disabled=true;sim.traffic.reset(1000);__police.enabled=false;
     people.reset(1000);for(const p of people.peds)if(p.active)people.despawn(p);people.spawnWalker=()=>{};people.updateAnchors=()=>{};
     const p=people.peds[0];people.init(p,'fixture',H.makeLook(new RNG(71),'street'));
     const fx=-Math.sin(v.yaw),fz=-Math.cos(v.yaw),rx=Math.cos(v.yaw),rz=-Math.sin(v.yaw);
     Object.assign(p,{rs:false,x:v.x+fx*(v.halfL+.05),y:v.y,wy:v.y,z:v.z+fz*(v.halfL+.05),yaw:v.yaw+Math.PI,mode:'stand'});
     p.home={x:p.x,y:p.y,z:p.z,yaw:p.yaw};
     const before=v.vLong;people.hit(p,{veh:v,fx,fz,rx,rz,v:10,kind:'player'});const after=v.vLong;
     sim.step(20,1/120);sim.render();return{cam,before,after,shake:sim.G.shake,bodyKick:v.pose,activeBodies:people.bodies.bodies.filter(b=>b.active).length};
    },cam);report.feedback.push(feedback);assert(feedback.after<feedback.before);assert(feedback.activeBodies>0);
    const png=await page.evaluate(()=>{__sim.render();return __sim.renderer.domElement.toDataURL('image/png');});
    await fs.writeFile(path.join(out,`impact-${cam}.png`),Buffer.from(png.split(',')[1],'base64'));
   }
  }
  await page.close();
 }
 assert(report.maps.every(r=>r.after.sampled<=r.before.sampled));assert.deepEqual(report.errors,[]);
}finally{await fs.writeFile(path.join(out,'density-report.json'),JSON.stringify(report,null,2));await browser.close();server.close();}
