import {createGameServer} from '../server/index.mjs';
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {resolve} from 'node:path';import {chromium} from '/tmp/pw/node_modules/playwright/index.mjs';
const root=resolve(import.meta.dirname,'..');
const app=await createGameServer({dataDir:resolve(root,'.scratch/roundabouts/browser-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const budgetCapture=async({pose,time,cam,phase})=>{
 const sim=window.__sim,{G,route:r,camera,player}=sim;
 G.state='race';G.cam=G.userCam=cam;G.lastDt=0;
 const s=pose==='start'?r.start+30:r.length*.5;
 {
 player.veh.reset(s,r.laneU(s,0),0);player.veh.place(player.model.root);player.model.update(0,0,0,false,player.veh.pose,player.veh.corners||player.veh.wheel,0);
 window.__setConditions({time,weather:'clear'});const ENV=await import('/src/env.js');ENV.updateWorldBlend(100);ENV.updateWorldBlend(100);sim.post.snapGrade?.();
 player.model.root.visible=true;player.model.body.visible=true;player.cockpit.setVisible(cam==='cockpit');if(player.driver?.head)player.driver.head.visible=false;
 player.model.root.updateMatrixWorld(true);
 const f=r.frame(s,{}),p=r.point(s,r.laneU(s,0));
 if(cam==='cockpit'){
  const eye=player.cockpit.eye;camera.position.set(eye.x,eye.y+.02,eye.z);player.model.body.localToWorld(camera.position);player.model.body.getWorldQuaternion(camera.quaternion);camera.rotateX(-.045);camera.near=.05;
 }else{camera.position.set(p.x-f.tx*(pose==='overview'?50:8),p.y+(pose==='overview'?35:3),p.z-f.tz*(pose==='overview'?50:8));const at=r.point(s+20,0);camera.lookAt(at.x,at.y+1,at.z);camera.near=.25;}
 camera.fov=cam==='cockpit'?66:58;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 }
 // Reset the terrain selector's pose history, then run its real full selection.
 // This prevents unrelated incremental far-LOD slices from skewing On/Off costs.
 const coldCamera=camera.clone();coldCamera.updateMatrixWorld(true);const oldLodCamera=sim.renderer.terrainLodCamera;
 sim.scene.traverse(o=>{const st=o.terrainLodState;if(!st)return;let at=0;st.patches.forEach((p,i)=>{p.current=0;st.offsets[i]=at;o.geometry.index.array.set(p.levels[0].indices,at);at+=p.levels[0].count;});st.offsets[st.patches.length]=at;o.geometry.setDrawRange(0,at);o.geometry.index.needsUpdate=true;});
 sim.renderer.terrainLodCamera=coldCamera;sim.scene.traverse(o=>{if(o.terrainLodState)o.onBeforeRender(sim.renderer,sim.scene,coldCamera);});sim.renderer.terrainLodCamera=oldLodCamera;
 const {updateSceneryLod}=await import('/src/scenery.js');if(sim.lod)updateSceneryLod(sim.lod,camera);
 for(let realismWarm=0;realismWarm<4;realismWarm++)sim.render();sim.renderer.getContext().finish();
 const geometries=new Set(),textures=new Set();let geometryBytes=0,textureBytes=0;
 sim.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])for(const v of Object.values(m))if(v?.isTexture)textures.add(v);});
 for(const g of geometries){for(const a of Object.values(g.attributes))geometryBytes+=a.array.byteLength;geometryBytes+=g.index?.array.byteLength||0;}
 for(const t of textures){const i=t.image;textureBytes+=(i?.width||0)*(i?.height||0)*4*(t.generateMipmaps?4/3:1);}
 return {map:G.mapId,s,camera:camera.position.toArray(),quaternion:camera.quaternion.toArray(),calls:sim.renderer.info.render.calls,triangles:sim.renderer.info.render.triangles,geometryBytes,textureBytes,shadows:sim.renderer.shadowMap.enabled,png:sim.canvas.toDataURL().split(',')[1]};
};


try{for(const id of ['psychiko']){const page=await browser.newPage({viewport:{width:960,height:600}}),errors=[];page.on('pageerror',e=>{errors.push(String(e));console.log(id,'ERROR',String(e));});page.on('console',m=>{if(m.type()==='error')console.log(id,m.text().slice(0,500));});
await page.route('**/src/main.js',async r=>{const res=await r.fetch();await r.fulfill({response:res,body:(await res.text()).replace('stencil: false','stencil: false, preserveDrawingBuffer: true')});});
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>{if(window.__freezeRoads&&cb.name==='frame')return 0;const id=raf(cb);if(cb.name==='frame')window.__captureFrame=id;return id;};});
await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&quality=low&fixeddt&map=${id}`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.classList.contains('loaded'),null,{timeout:600000});
const take=async(dir,name,pose)=>{await fs.mkdir(resolve(root,'.scratch',dir),{recursive:true});const result=await page.evaluate(pose=>{window.__freezeRoads=true;const r=__sim,{camera,route}=r,n=r.ground.network;r.G.state='paused';for(const c of r.cars)c.model.root.visible=false;let x,z,y,dx=0,dz=1;if(pose==='side'){const seg=n.segments.find(s=>s.road.sf==='asphalt'&&s.L>12&&Math.abs(n.project((s.ax+s.bx)/2,(s.az+s.bz)/2).u)>60)||n.segments[0];x=(seg.ax+seg.bx)/2;z=(seg.az+seg.bz)/2;y=n.height(x,z);dx=seg.dx/seg.L;dz=seg.dz/seg.L;camera.position.set(x-dx*10-dz*3,y+3.5,z-dz*10+dx*3);camera.lookAt(x+dx*18,y,z+dz*18);}else{[x,z]=pose;y=n.height(x,z);camera.position.set(x,y+115,z+.01);camera.lookAt(x,y,z);}camera.far=20000;camera.fov=65;camera.updateProjectionMatrix();r.post.dof=0;r.post.resetHistory();if(window.__roundCars){for(const c of __roundCars)c.active=true;r.traffic.sync(__roundCars[0].s);}r.render();r.renderer.getContext().finish();return{png:r.canvas.toDataURL('image/png').split(',')[1],calls:r.renderer.info.render.calls,stats:n.stats,x,z};},pose);await fs.writeFile(resolve(root,'.scratch',dir,name+'.png'),Buffer.from(result.png,'base64'));delete result.png;console.log(id,name,JSON.stringify(result));};
await page.evaluate(()=>{window.__freezeRoads=true;window.freezeRealism=true;cancelAnimationFrame(window.__captureFrame);});await take('sideroad-texture','after-psychiko','side');for(const [i,p] of [[-251,-462],[-61,138],[210,-264],[317,-546],[421,-1255]].entries())await take('roundabouts',`after-psychiko-${i}`,p);
await page.evaluate(async()=>{await __flow.startEvent(__flow.freeRoamDef());});
await page.evaluate(()=>{window.__freezeRoads=true;window.freezeRealism=true;cancelAnimationFrame(window.__captureFrame);const r=__sim;r.G.state='paused';r.traffic._disabled=false;r.traffic.signals=null;r.traffic.people=null;r.traffic.racers=[];for(const c of r.traffic.cars)c.active=false;});
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
await page.evaluate(()=>{for(const c of __sim.traffic.cars)c.active=false;window.__roundCars=null;});
const rows=[];for(const time of ['day','night'])for(const cam of ['chase','cockpit']){const states={};for(const detail of [false,true]){await page.evaluate(async detail=>{const {setSetting}=await import('/src/settings.js');setSetting('worldDetail',detail);},detail);const shot=await page.evaluate(budgetCapture,{pose:'mid',time,cam,phase:'roundabout'});await fs.writeFile(resolve(root,'.scratch/roundabouts/detail-budget',`${time}-${cam}-${detail?'on':'off'}.png`),Buffer.from(shot.png,'base64'));delete shot.png;states[detail?'on':'off']=shot;console.log(time,cam,detail,shot.calls,shot.triangles);}rows.push({name:`psychiko-mid-${time}-${cam}`,map:'psychiko',before:{...states.off},off:states.off,on:states.on});}
const path=resolve(root,'.scratch/detail-pass/budgets.json'),report=JSON.parse(await fs.readFile(path,'utf8'));report.rows=report.rows.map(row=>rows.find(r=>r.name===row.name)||row);report.browserErrors=errors;report.baseline.psychiko='Current authored-height-preserving base geometry with optional detail Off (height reference 492f14e)';report.method='Source-identical earlier measurements retained for Riviera, Penteli and Megara; Psychiko uses current runtime-built terrain/roads with authored world-space heights, fixed day/night chase/cockpit cameras, and detail Off/On. SwiftShader; no timing claims.';report.sourceHashes['data/maps/psychiko/map.json']=createHash('sha256').update(await fs.readFile(resolve(root,'data/maps/psychiko/map.json'))).digest('hex');await fs.writeFile(path,JSON.stringify(report,null,2));await fs.writeFile(resolve(root,'.scratch/roundabouts/detail-budget/report.json'),JSON.stringify({rows,errors},null,2));if(errors.length)throw Error(JSON.stringify(errors));
await page.close();}}
finally{await browser.close();await app.close();}
