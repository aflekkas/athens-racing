import {createGameServer} from '../server/index.mjs';
import fs from 'node:fs/promises';import {resolve} from 'node:path';import {chromium} from '/tmp/pw/node_modules/playwright/index.mjs';
const root=resolve(import.meta.dirname,'..');
const app=await createGameServer({dataDir:resolve(root,'.scratch/roundabouts/browser-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
try{for(const id of ['psychiko']){const page=await browser.newPage({viewport:{width:960,height:600}});page.on('pageerror',e=>console.log(id,'ERROR',String(e)));page.on('console',m=>{if(m.type()==='error')console.log(id,m.text().slice(0,500));});
await page.route('**/src/main.js',async r=>{const res=await r.fetch();await r.fulfill({response:res,body:(await res.text()).replace('stencil: false','stencil: false, preserveDrawingBuffer: true')});});
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>{if(window.__freezeRoads&&cb.name==='frame')return 0;const id=raf(cb);if(cb.name==='frame')window.__captureFrame=id;return id;};});
await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&quality=low&fixeddt&map=${id}`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.classList.contains('loaded'),null,{timeout:600000});
const take=async(dir,name,pose)=>{await fs.mkdir(resolve(root,'.scratch',dir),{recursive:true});const result=await page.evaluate(pose=>{window.__freezeRoads=true;const r=__sim,{camera,route}=r,n=r.ground.network;r.G.state='paused';for(const c of r.cars)c.model.root.visible=false;const [x,z]=pose,y=n.height(x,z);camera.position.set(x,y+115,z+.01);camera.lookAt(x,y,z);camera.far=20000;camera.fov=65;camera.updateProjectionMatrix();r.post.dof=0;r.post.resetHistory();if(window.__roundCars){for(const c of __roundCars)c.active=true;r.traffic.sync(__roundCars[0].s);}r.render();r.renderer.getContext().finish();return{png:r.canvas.toDataURL('image/png').split(',')[1],calls:r.renderer.info.render.calls,stats:n.stats,x,z};},pose);await fs.writeFile(resolve(root,'.scratch',dir,name+'.png'),Buffer.from(result.png,'base64'));delete result.png;console.log(id,name,JSON.stringify(result));};
await page.evaluate(async()=>{await __flow.startEvent(__flow.freeRoamDef());});
await page.evaluate(()=>{window.__freezeRoads=true;cancelAnimationFrame(window.__captureFrame);const r=__sim;r.G.state='paused';r.traffic._disabled=false;r.traffic.signals=null;r.traffic.people=null;r.traffic.racers=[];for(const c of r.traffic.cars)c.active=false;});
await page.waitForTimeout(1000);
for(const index of (process.argv[3]||'0,1,2,3,4').split(',').map(Number)){
 const initial=await page.evaluate(index=>{const {traffic:t,route:r}=__sim,q=r.roundabouts[index];const cars=t.cars.filter(c=>!c.type.police&&!c.type.scooter&&!c.type.bus).slice(0,3);for(const c of t.cars)c.active=false;
 const reverse=q.reverse,reverseDistance=reverse.entryDistance+(reverse.exitDistance-reverse.entryDistance)*.35;const states=[{s:q.s0+8,dir:1},{s:reverse.s1-reverseDistance/reverse.length*(reverse.s1-reverse.s0),dir:-1},{s:q.s0-14,dir:1}];
 cars.forEach((c,i)=>{Object.assign(c,{...states[i],lane:0,len:c.type.len,wid:c.type.wid,active:true,mode:'drive',crash:null,cross:null});t.personality(c);t.initDrive(c);c.u=t.laneUOf(c,c.s);c.uT=c.u;c.v=i===2?2:3;c.wheel=0;c.m.root.visible=true;});t.racers=[];t.wrecks=[];__roundCars=cars;const p=q.p.reduce((a,p)=>[a[0]+p[0]/q.p.length,a[1]+p[1]/q.p.length],[0,0]);return {id:q.id,p};},index);
 const frames=[];
 for(const steps of [0,60,120,180]){
  const state=await page.evaluate(steps=>{const {traffic:t,route:r,camera,ground}=__sim;let violations=0;for(let i=0;i<steps;i++){t.t+=1/60;t.gather([]);for(const c of __roundCars){c.active=true;t.drive(c,1/60,null);}for(const c of __roundCars){const p=t.point(c,{});if(ground.network.islandAt(p.x,p.z))violations++;}}for(const c of __roundCars)c.active=true;t.sync(__roundCars[0].s);for(const c of __roundCars)if(c._world&&Math.hypot(c.m.root.position.x-c._world.x,c.m.root.position.z-c._world.z)>.01)throw Error('Traffic rendering differs from its path');return {violations,cars:__roundCars.map(c=>({id:c.id,dir:c.dir,s:c.s,v:c.v,circulating:!!c._roundabout,active:c.active,world:c._world?{x:c._world.x,z:c._world.z}:null,x:c.m.root.position.x,z:c.m.root.position.z}))};},steps);
  if(state.violations)throw Error('Traffic entered an island: '+JSON.stringify(state));frames.push(state);
  await take('roundabouts',`traffic-${index}-${steps}`,initial.p);
 }
 await fs.writeFile(resolve(root,'.scratch/roundabouts',`traffic-${index}.json`),JSON.stringify({initial,frames},null,2));
}
await page.close();}}
finally{await browser.close();await app.close();}
