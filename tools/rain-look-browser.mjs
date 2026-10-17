// Usage: tools/browser-slot.sh node tools/rain-look-browser.mjs before|after OUTPUT BASELINE_DIR
// Sequential deterministic views; no production debug exports or external CDN required.
import fs from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {homedir} from 'node:os';
import {createGameServer} from '../server/index.mjs';
const [phase='after',output='.scratch/rain-look',baseline]=process.argv.slice(2);
const root=resolve(import.meta.dirname,'..'),out=resolve(output);
await fs.mkdir(out,{recursive:true});
const app=await createGameServer({root,dataDir:resolve(out,'server-data')}),serve=app.server.listeners('request')[0];
app.server.removeAllListeners('request');app.server.on('request',async(req,res)=>{
 const p=new URL(req.url,'http://local').pathname;let file=resolve(root,'.'+(p==='/'?'/index.html':p));
 try{
  if(p.startsWith('/world-three/'))file=resolve(root,'node_modules/three',p.slice(13));
  if(phase==='before'&&['/src/weather.js','/src/rain-overlays.js','/src/cockpit-rain.js'].includes(p))file=resolve(baseline,p.split('/').at(-1));
  let bytes=await fs.readFile(file);
  if(p==='/src/weather.js')bytes=Buffer.from(bytes+'\nexport const __state=()=>W;');
  if(p==='/'||p==='/index.html')bytes=Buffer.from(bytes.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/world-three/'));
  if(p==='/src/main.js')bytes=Buffer.from(bytes.toString().replace('stencil: false','stencil: false, preserveDrawingBuffer: true'));
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');res.end(bytes);
 }catch{serve(req,res);}
});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const pw=await import(process.env.RAIN_PLAYWRIGHT || 'playwright');
const browser=await pw.chromium.launch({headless:true,executablePath:resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={phase,method:'960x600, fixed pose/time, 4 warmups + 12 render/readPixels samples; SwiftShader software frame timings, not hardware GPU timing',shots:[],errors:[]};
try{
 for(const map of ['riviera','penteli']){
 const page=await browser.newPage({viewport:{width:960,height:600},deviceScaleFactor:1});
 page.on('response',r=>{if(r.status()>=400)console.log('HTTP',r.status(),r.url());});
 page.on('pageerror',e=>{report.errors.push(String(e));console.log('ERROR',String(e));});
 page.on('console',m=>{if(m.type()==='error'){report.errors.push(m.text());console.log('CONSOLE',m.text().slice(0,1200));}});
 await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.freezeRain&&cb.name==='frame'?0:raf(cb);localStorage.setItem('paraliaki.settings',JSON.stringify({mirrors:false,renderScale:1,dynamicResolution:false}));});
 console.log('BOOT',phase,map);
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&fixedres&fixeddt&notraffic&map=${map}&event=free:${map}&car=mini`,{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>document.body.classList.contains('loaded')&&window.__sim?.player,null,{timeout:600000});
 await page.evaluate(()=>{window.freezeRain=true;});await page.waitForTimeout(200);
 for(const time of ['day','night'])for(const cam of ['chase','cockpit']){
 const shot=await page.evaluate(async({time,cam})=>{
  const sim=window.__sim,{G,route:r,camera,player}=sim,wx=await import('/src/weather.js'),env=await import('/src/env.js');
  G.state='race';G.cam=G.userCam=cam;G.lastDt=0;
  const s=r.start+120;player.veh.reset(s,r.laneU(s,0),0);player.veh.place(player.model.root);player.model.update(0,0,0,false,player.veh.pose,player.veh.corners,0);
  window.__setConditions({time,weather:'rain'});sim.post.snapGrade?.();(await import('/src/wet-grip.js')).WEATHER.wet=.8;
  player.veh.vLong=25;env.U.time.value=12.4;
  player.model.root.visible=true;player.model.body.visible=true;player.cockpit.setVisible(cam==='cockpit');(await import('/src/pov-visibility.js')).setPovExteriorView(player.model,cam==='cockpit');if(player.driver?.head)player.driver.head.visible=false;
  player.model.root.updateMatrixWorld(true);
  const f=r.frame(s,{}),p=r.point(s,r.laneU(s,0));
  if(cam==='cockpit'){camera.position.copy(player.cockpit.eye);player.model.body.localToWorld(camera.position);player.model.body.getWorldQuaternion(camera.quaternion);camera.rotateX(player.cockpit.eyePitch??-.045);camera.near=.03;}
  else{camera.position.set(p.x-f.tx*8,p.y+3,p.z-f.tz*8);const at=r.point(s+20,0);camera.lookAt(at.x,at.y+1,at.z);camera.near=.25;}
  camera.fov=cam==='cockpit'?66:58;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  const w=wx.__state();w.prevCam.copy(camera.position).addScaledVector({x:f.tx,y:0,z:f.tz},-25/60);
  wx.updateWeather(1/60);w.rain.mat.uniforms.uTime.value=12.4;
  const render=()=>{w.prevCam.copy(camera.position).addScaledVector({x:f.tx,y:0,z:f.tz},-25/60);w.rain.mat.uniforms.uTime.value=12.4;sim.render();};
  for(let i=0;i<4;i++)render();sim.renderer.getContext().finish();
  const gl=sim.renderer.getContext(),pixel=new Uint8Array(4);
  const samples=[];for(let i=0;i<12;i++){const t=performance.now();render();gl.readPixels(480,300,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);samples.push(performance.now()-t);}samples.sort((a,b)=>a-b);
  return {gpu:window.__renderInfo?.(),s,camera:camera.position.toArray(),quaternion:camera.quaternion.toArray(),quality:w.q,calls:sim.renderer.info.render.calls,triangles:sim.renderer.info.render.triangles,medianMs:samples[6],p95Ms:samples[11],samples,webp:sim.canvas.toDataURL('image/webp',.8).split(',')[1]};
 },{time,cam});
 const name=`${map}-${time}-${cam}-${phase}`;await fs.writeFile(resolve(out,name+'.webp'),Buffer.from(shot.webp,'base64'));delete shot.webp;report.shots.push({name,...shot});console.log('SHOT',name,shot.calls,shot.triangles,shot.medianMs);
 await fs.writeFile(resolve(out,phase+'.json'),JSON.stringify(report,null,2));
 }
 if(phase==='after'&&map==='riviera')report.behavior=await page.evaluate(async()=>{
  const T=await import('three'),wx=await import('/src/weather.js'),{settings}=await import('/src/settings.js');
  const w=wx.__state(),sim=window.__sim,oldClass=settings.perfClass;
  settings.perfClass='potato';wx.updateWeather(1/60);const potato=w.rain.mesh.geometry.instanceCount;
  settings.perfClass=oldClass;wx.updateWeather(1/60);
  const normal=w.rain.mesh.geometry.instanceCount,st=(await import('/src/env.js')).COND_STATE,oldRain=st.rain;
  st.rain=.25;wx.updateWeather(1/60);const light=w.rain.mesh.geometry.instanceCount;
  st.rain=0;wx.updateWeather(1/60);const dry=w.rain.mesh.geometry.instanceCount;
  st.rain=oldRain;wx.updateWeather(1/60);
  const wipe=sim.player.model.updateCockpitWipers;sim.player.model.updateCockpitWipers=null;sim.player.veh.vLong=40;wx.updateWeather(1/60);
  const noWipers=w.dropMat.uniforms.uHasWipers.value,speed=w.dropMat.uniforms.uSpeed.value;
  sim.player.model.updateCockpitWipers=wipe;wx.updateWeather(1/60);const hasWipers=w.dropMat.uniforms.uHasWipers.value;
  const renderer=sim.renderer,target=new T.WebGLRenderTarget(160,100),previous=renderer.getRenderTarget(),color=renderer.getClearColor(new T.Color()),alpha=renderer.getClearAlpha();
  const scene=new T.Scene(),mat=w.rain.mat.clone(),mesh=new T.Mesh(w.rain.mesh.geometry,mat);mesh.frustumCulled=false;scene.add(mesh);
  mat.uniforms.uCol.value.set(1,1,1);mat.uniforms.uAlpha.value=.8;
  const samples=[],pixels=new Uint8Array(160*100*4),forward=new T.Vector3();sim.camera.getWorldDirection(forward);
  try{renderer.setClearColor(0,0);for(const v of [0,25,50]){
   mat.uniforms.uVelocity.value.copy(forward).multiplyScalar(v);renderer.setRenderTarget(target);renderer.render(scene,sim.camera);renderer.readRenderTargetPixels(target,0,0,160,100,pixels);
   let coverage=0,sum=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]>0)coverage++;sum+=pixels[i];}samples.push({speed:v,coverage,alphaSum:sum});
  }}finally{renderer.setRenderTarget(previous);renderer.setClearColor(color,alpha);target.dispose();mat.dispose();}
  if(potato!==64||normal!==320||light!==80||dry!==0||noWipers!==0||hasWipers!==1||speed!==40||samples.some(s=>s.coverage<5)||new Set(samples.map(s=>s.alphaSum)).size!==3)throw Error('Rain behavior check failed: '+JSON.stringify({potato,normal,light,dry,noWipers,hasWipers,speed,samples}));
  return {potato,normal,light,dry,noWipers,hasWipers,speed,motion:samples};
 });
 await page.close();
 }
}finally{await fs.writeFile(resolve(out,phase+'.json'),JSON.stringify(report,null,2));await browser.close();await app.close();}
