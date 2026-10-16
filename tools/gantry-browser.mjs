// Run through tools/browser-slot.sh; one browser, sequential map/phase captures.
import fs from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {homedir} from 'node:os';
import {createGameServer} from '../server/index.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.scratch/realism');
await fs.mkdir(out,{recursive:true});

const app=await createGameServer({root,dataDir:resolve(out,'server-data')}),serve=app.server.listeners('request')[0];
app.server.removeAllListeners('request');app.server.on('request',async(req,res)=>{
 const p=new URL(req.url,'http://local').pathname;let file=resolve(root,'.'+(p==='/'?'/index.html':p));
 try{
  if(p.startsWith('/world-three/'))file=resolve(root,'node_modules/three',p.slice(13));
  let bytes=await fs.readFile(file);
  if(p==='/'||p==='/index.html')bytes=Buffer.from(bytes.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/world-three/'));
  if(p==='/src/main.js')bytes=Buffer.from(bytes.toString().replace('stencil: false','stencil: false, preserveDrawingBuffer: true'));
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');res.end(bytes);
 }catch{serve(req,res);}
});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const pw=await import('/tmp/pw/node_modules/playwright/index.mjs');
const browser=await pw.chromium.launch({headless:true,executablePath:resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:800,height:500},deviceScaleFactor:1}),report={shots:[],errors:[]};
page.on('pageerror',e=>{report.errors.push(String(e));console.log('PAGEERROR',String(e));});
try{
 await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.freezeRealism&&cb.name==='frame'?0:raf(cb);localStorage.setItem('paraliaki.settings',JSON.stringify({mirrors:false,renderScale:1,dynamicResolution:false}));});
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&fixedres&fixeddt&notraffic&map=riviera&event=free:riviera&car=mini`,{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>document.body.classList.contains('loaded')&&window.__sim?.player,null,{timeout:1200000});
 await page.evaluate(()=>{window.freezeRealism=true;});await page.waitForTimeout(100);
 for(const car of ['mini','aygo','z4','carrera','aventador_svj'])for(const phase of ['before','after','grid']){
  const shot=await page.evaluate(async({car,phase})=>{
   const THREE=await import('three'),{soloStartPosition,raceGridSlot}=await import('/src/start-placement.js'),{setPovExteriorView}=await import('/src/pov-visibility.js');
   const sim=window.__sim,{G,route:r,camera}=sim;G.state='race';G.cam=G.userCam='cockpit';
   if(sim.player.spec.id!==car&&!window.__flow.switchRoamCar(car))throw Error('car switch failed '+car);
   const {player}=sim,base=r.start,p=phase==='before'?{s:base-4,u:r.laneU(base-4,1)}:phase==='after'?soloStartPosition(r,base,1,true):raceGridSlot(r,base,1,0,player.spec.length);
   player.veh.reset(p.s,p.u,0);player.veh.place(player.model.root);player.model.update(0,0,0,false,player.veh.pose,player.veh.corners,0);
   window.__setConditions({time:'day',weather:'clear'});sim.post.snapGrade?.();
   player.model.root.visible=true;player.model.body.visible=true;player.cockpit.setVisible(true);setPovExteriorView(player.model,true);player.model.root.updateMatrixWorld(true);
   camera.position.copy(player.model.body.localToWorld(player.cockpit.eye.clone()));player.model.body.getWorldQuaternion(camera.quaternion);
   camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(player.cockpit.eyePitch??-.045,0,0,'YXZ')));camera.near=.03;camera.fov=66;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
   for(let i=0;i<4;i++)sim.render();sim.renderer.getContext().finish();
   return {car,phase,s:p.s,u:p.u,camera:camera.position.toArray(),calls:sim.renderer.info.render.calls,triangles:sim.renderer.info.render.triangles,png:sim.canvas.toDataURL().split(',')[1]};
  },{car,phase});
  const name=`gantry-${car}-${phase}`;await fs.writeFile(resolve(out,name+'.png'),Buffer.from(shot.png,'base64'));delete shot.png;report.shots.push(shot);console.log(name,shot.s,shot.calls,shot.triangles);
 }
}finally{await fs.writeFile(resolve(out,'gantry-report.json'),JSON.stringify(report,null,2));await browser.close();await app.close();}
