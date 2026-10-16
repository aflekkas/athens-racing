// Run through tools/browser-slot.sh; one browser, sequential map/phase captures.
import fs from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {homedir} from 'node:os';
import {createGameServer} from '../server/index.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.scratch/realism');
await fs.mkdir(out,{recursive:true});
const phase='before';
const app=await createGameServer({root,dataDir:resolve(out,'server-data')}),serve=app.server.listeners('request')[0];
app.server.removeAllListeners('request');app.server.on('request',async(req,res)=>{
 const p=new URL(req.url,'http://local').pathname;let file=resolve(root,'.'+(p==='/'?'/index.html':p));
 try{
  if(p.startsWith('/world-three/'))file=resolve(root,'node_modules/three',p.slice(13));
  if(p==='/src/realism-after.js')file=resolve(root,'src/buildings.js');
  if(p==='/src/buildings.js'&&phase==='before')file=resolve(out,'before-buildings.js');
  let bytes=await fs.readFile(file);
  if(p==='/'||p==='/index.html')bytes=Buffer.from(bytes.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/world-three/'));
  if(p==='/src/main.js')bytes=Buffer.from(bytes.toString().replace('stencil: false','stencil: false, preserveDrawingBuffer: true'));
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');res.end(bytes);
 }catch{serve(req,res);}
});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const pw=await import('/tmp/pw/node_modules/playwright/index.mjs');
const browser=await pw.chromium.launch({headless:true,executablePath:resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const capture=async({pose,time,cam,phase})=>{
 const sim=window.__sim,{G,route:r,camera,player}=sim;
 if(!window.realismPairs){
  const THREE=await import('three'),{buildBuildings}=await import('/src/realism-after.js');
  const map=G.mapId,data=await (await fetch(map==='riviera'?'/data/map.json':`/data/maps/${map}/map.json`)).json();
  const newer=buildBuildings({data},new THREE.Group(),sim.ground.heightC);
  window.realismPairs=[];
  newer.group.traverse(o=>{if(!o.geometry)return;const old=sim.scene.getObjectByName(o.name);if(!old)throw Error('Missing baseline chunk '+o.name);
   for(const k of ['position','normal']){const a=o.geometry.attributes[k].array,b=old.geometry.attributes[k].array;if(a.length!==b.length||a.some((v,i)=>v!==b[i]))throw Error('Geometry mismatch '+o.name);}
   window.realismPairs.push({mesh:old,before:old.geometry.attributes.color.array.slice(),after:o.geometry.attributes.color.array.slice()});o.geometry.dispose();
  });newer.group.children[0]?.material.dispose();
 }
 for(const pair of window.realismPairs){pair.mesh.geometry.attributes.color.array.set(pair[phase]);pair.mesh.geometry.attributes.color.needsUpdate=true;}
 G.state='race';G.cam=G.userCam=cam;G.lastDt=0;
 const s=pose==='start'?r.start+30:r.length*.5;
 if(phase==='before'){
 player.veh.reset(s,r.laneU(s,0),0);player.veh.place(player.model.root);player.model.update(0,0,0,false,player.veh.pose,player.veh.corners||player.veh.wheel,0);
 window.__setConditions({time,weather:'clear'});sim.post.snapGrade?.();
 player.model.root.visible=true;player.model.body.visible=true;player.cockpit.setVisible(cam==='cockpit');if(player.driver?.head)player.driver.head.visible=false;
 player.model.root.updateMatrixWorld(true);
 const f=r.frame(s,{}),p=r.point(s,r.laneU(s,0));
 if(cam==='cockpit'){
  const eye=player.cockpit.eye;camera.position.set(eye.x,eye.y+.02,eye.z);player.model.body.localToWorld(camera.position);player.model.body.getWorldQuaternion(camera.quaternion);camera.rotateX(-.045);camera.near=.05;
 }else{camera.position.set(p.x-f.tx*(pose==='overview'?50:8),p.y+(pose==='overview'?35:3),p.z-f.tz*(pose==='overview'?50:8));const at=r.point(s+20,0);camera.lookAt(at.x,at.y+1,at.z);camera.near=.25;}
 camera.fov=cam==='cockpit'?66:58;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 }
 for(let realismWarm=0;realismWarm<4;realismWarm++)sim.render();sim.renderer.getContext().finish();
 const geometries=new Set(),textures=new Set();let geometryBytes=0,textureBytes=0;
 sim.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])for(const v of Object.values(m))if(v?.isTexture)textures.add(v);});
 for(const g of geometries){for(const a of Object.values(g.attributes))geometryBytes+=a.array.byteLength;geometryBytes+=g.index?.array.byteLength||0;}
 for(const t of textures){const i=t.image;textureBytes+=(i?.width||0)*(i?.height||0)*4*(t.generateMipmaps?4/3:1);}
 return {map:G.mapId,s,camera:camera.position.toArray(),quaternion:camera.quaternion.toArray(),calls:sim.renderer.info.render.calls,triangles:sim.renderer.info.render.triangles,geometryBytes,textureBytes,shadows:sim.renderer.shadowMap.enabled,png:sim.canvas.toDataURL().split(',')[1]};
};
const prior=JSON.parse(await fs.readFile(resolve(out,'paired-report.json'),'utf8').catch(()=>'{}'));
const maps=(process.env.REALISM_MAPS||'riviera,penteli,megara').split(',');
const report={method:"Same frozen scene; baseline and candidate colour buffers; geometry identity asserted",shots:(prior.shots||[]).filter(x=>!maps.includes(x.map)),errors:[]};
const page=await browser.newPage({viewport:{width:800,height:500},deviceScaleFactor:1});
try{for(const map of maps){
 page.on('pageerror',e=>{report.errors.push(String(e));console.log('PAGEERROR',String(e));});
 page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
 await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.freezeRealism&&cb.name==='frame'?0:raf(cb);localStorage.setItem('paraliaki.settings',JSON.stringify({lighting:'off',effects:'off',graphics:'low',mirrors:false,renderScale:1,dynamicResolution:false}));});
 console.log('BOOT',map);
 if(map===maps[0])await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&fixedres&fixeddt&notraffic&map=${map}&car=mini`,{waitUntil:'domcontentloaded',timeout:120000});
 if(map!==maps[0])await page.evaluate(async id=>{window.realismPairs=null;await window.__flow.switchMap(id);},map);
 await page.waitForFunction(()=>document.body.classList.contains('loaded')&&window.__sim?.player,null,{timeout:1200000});
 await page.evaluate(()=>{window.freezeRealism=true;});await page.waitForTimeout(100);
 for(const pose of map==='riviera'?['start','mid']:map==='megara'?['overview']:['mid'])for(const time of ['day','night'])for(const cam of ['chase','cockpit'])for(const phase of ['before','after']){
  const shot=await page.evaluate(capture,{pose,time,cam,phase}),name=`${phase}-${map}-${pose}-${time}-${cam}`;
  await fs.writeFile(resolve(out,name+'.png'),Buffer.from(shot.png,'base64'));delete shot.png;report.shots.push({name,...shot});console.log('PAIRED',name,shot.calls,shot.triangles);
  await fs.writeFile(resolve(out,'paired-report.json'),JSON.stringify(report,null,2));
 }

}}finally{await fs.writeFile(resolve(out,'paired-report.json'),JSON.stringify(report,null,2));await browser.close();await app.close();}
