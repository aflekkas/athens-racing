import {resolve} from 'node:path';
import fs from 'node:fs/promises';
import {createGameServer} from '../server/index.mjs';
const {chromium}=await import('/tmp/pw/node_modules/playwright/index.mjs');
const root=resolve('.'),out=resolve(process.argv[2]),phase=process.argv[3]||'before';await fs.mkdir(out,{recursive:true});
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1200,height:1080}});page.on('pageerror',e=>console.error(e.stack));
await page.route('**/lowpoly-studio',r=>r.fulfill({contentType:'text/html',body:'<html><body style="margin:0;background:#18212a"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></body></html>'}));
await page.route('**/node_modules/three/**',async r=>r.fulfill({body:await fs.readFile(resolve(root,new URL(r.request().url()).pathname.slice(1))),contentType:'text/javascript'}));
try{
 await page.goto(`http://127.0.0.1:${app.server.address().port}/lowpoly-studio`);
 const ids=await page.evaluate(async()=>{
 const T=await import('three'),{CARS,CarModel}=await import('/src/cars.js'),{Cockpit}=await import('/src/cockpit.js');
 window.studio={T,CARS,CarModel,Cockpit};return CARS.map(c=>c.id);
 });
 for(let batch=0;batch<ids.length;batch+=4){
 const data=await page.evaluate(async({batch,phase})=>{
 const {T,CARS,CarModel,Cockpit}=studio;
 const measures=[];const sheet=document.createElement('canvas');sheet.width=1200;sheet.height=1080;const c=sheet.getContext('2d');c.fillStyle='#18212a';c.fillRect(0,0,1200,1080);
 const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(400,240);renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.4;
 for(let row=0;row<4&&batch+row<CARS.length;row++){
 const spec=CARS[batch+row],car=new CarModel(spec),scene=new T.Scene();scene.background=new T.Color('#8696a5');scene.add(new T.HemisphereLight('#ffffff','#546171',3));const light=new T.DirectionalLight('#fff4dc',4);light.position.set(-4,8,-6);scene.add(light);scene.add(car.root);
 const camera=new T.PerspectiveCamera(38,400/240,.01,100);car.root.updateMatrixWorld(true);const L=car.dims.L;
 for(let view=0;view<3;view++){
 if(view<2){camera.position.set((view?1:-1)*L*.9,L*.43,(view?1:-1)*L*1.12);camera.lookAt(0,car.dims.H*.48,0);}
 else{try{const cockpit=new Cockpit(spec,car,null);cockpit.setVisible(true);cockpit.update(.1,{steerInput:0,rpm:2200,redline:spec.redline||6500,kmh:64,gear:3,gearLabel:"3",ignition:true,engineRunning:true});cockpit.lod?.levels.forEach((l,i)=>l.object.visible=i===0);camera.fov=70;camera.updateProjectionMatrix();camera.position.copy(cockpit.eye||car.seat);camera.rotation.set(cockpit.eyePitch||0,0,0); }catch(e){console.error(spec.id,e.message);camera.position.copy(car.seat);camera.lookAt(camera.position.clone().add(new T.Vector3(0,0,-3)));}}
 car.root.traverse(o=>{if(o.isLOD){o.autoUpdate=false;o.levels.forEach((l,i)=>l.object.visible=i===0);}});renderer.render(scene,camera);measures.push({id:spec.id,view,triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,heap:performance.memory?.usedJSHeapSize});c.drawImage(renderer.domElement,view*400,row*270+30);
 }
 c.fillStyle='white';c.font='16px sans-serif';c.fillText(`${phase} · ${spec.id}   |   front / rear / cockpit`,12,row*270+22);
 car.disposeDamage?.();scene.traverse(o=>{o.geometry?.dispose();});
 }
 renderer.dispose();return {image:sheet.toDataURL('image/png').split(',')[1],measures};
 },{batch,phase});
 await fs.writeFile(resolve(out,`${phase}-${String(batch/4+1).padStart(2,'0')}.png`),Buffer.from(data.image,'base64'));await fs.writeFile(resolve(out,`${phase}-${String(batch/4+1).padStart(2,'0')}.json`),JSON.stringify(data.measures,null,2));console.log('SHEET',batch,ids.slice(batch,batch+4).join(','));
 }
}finally{await browser.close();await app.close();}
