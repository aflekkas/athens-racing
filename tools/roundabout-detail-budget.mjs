import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {resolve} from 'node:path';import {chromium} from '/tmp/pw/node_modules/playwright/index.mjs';import {createGameServer} from '../server/index.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.scratch/roundabouts/detail-budget');await fs.mkdir(out,{recursive:true});
const app=await createGameServer({dataDir:resolve(out,'server-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const capture=async({pose,time,cam,phase})=>{
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

const page=await browser.newPage({viewport:{width:800,height:500},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
try{await page.route('**/src/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('stencil: false','stencil: false, preserveDrawingBuffer: true')});});
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>{if(window.freezeRealism&&cb.name==='frame')return 0;const id=raf(cb);if(cb.name==='frame')window.captureFrame=id;return id;};localStorage.setItem('paraliaki.settings',JSON.stringify({mirrors:false,renderScale:1,dynamicResolution:false,worldDetail:false}));});
await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&fixedres&fixeddt&notraffic&map=psychiko&car=mini`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.classList.contains('loaded')&&window.__sim?.player,null,{timeout:600000});await page.evaluate(()=>{window.freezeRealism=true;cancelAnimationFrame(window.captureFrame);});
const rows=[];for(const time of ['day','night'])for(const cam of ['chase','cockpit']){const states={};for(const detail of [false,true]){await page.evaluate(async detail=>{const {setSetting}=await import('/src/settings.js');setSetting('worldDetail',detail);},detail);const shot=await page.evaluate(capture,{pose:'mid',time,cam,phase:'roundabout'});await fs.writeFile(resolve(out,`${time}-${cam}-${detail?'on':'off'}.png`),Buffer.from(shot.png,'base64'));delete shot.png;states[detail?'on':'off']=shot;console.log(time,cam,detail,shot.calls,shot.triangles);}rows.push({name:`psychiko-mid-${time}-${cam}`,map:'psychiko',before:{...states.off},off:states.off,on:states.on});}
const path=resolve(root,'.scratch/detail-pass/budgets.json'),report=JSON.parse(await fs.readFile(path,'utf8'));report.rows=report.rows.map(row=>rows.find(r=>r.name===row.name)||row);report.browserErrors=errors;report.baseline.psychiko='61833e8 (base geometry with optional detail Off)';report.method+='; Psychiko refreshed after legal roundabout rerouting, with current base geometry/Off as the component baseline; unchanged maps retain their source-identical measurements.';report.sourceHashes['data/maps/psychiko/map.json']=createHash('sha256').update(await fs.readFile(resolve(root,'data/maps/psychiko/map.json'))).digest('hex');await fs.writeFile(path,JSON.stringify(report,null,2));await fs.writeFile(resolve(out,'report.json'),JSON.stringify({rows,errors},null,2));if(errors.length)throw Error(JSON.stringify(errors));
}finally{await browser.close();await app.close();}
