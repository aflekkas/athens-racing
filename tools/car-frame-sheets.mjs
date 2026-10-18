#!/usr/bin/env node
// Contact sheets for every player configuration: the cockpit view (driver's eye, default FOV) and an exterior side view
// at rest on flat ground. Used to inspect windscreen pillars/header, ride pitch and ground shadow by eye.
//   PLAYWRIGHT_MODULE=<path to playwright/index.mjs> PLAYWRIGHT_EXECUTABLE_PATH=<chrome> \
//   OUT=<dir> [CAPTURE_IDS=a,b] [PER_SHEET=12] node tools/car-frame-sheets.mjs
import fs from 'node:fs/promises';import {createServer} from 'node:http';import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const sharp=(await import('sharp')).default;
const root=process.cwd(),out=resolve(process.env.OUT||'.scratch/car-frame-sheets'),per=+process.env.PER_SHEET||12;await fs.mkdir(out,{recursive:true});
const html=`<html><body style="margin:0"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script><script type="module">
import * as T from 'three';import {CARS,CarModel} from '/src/cars.js';import {Cockpit} from '/src/cockpit.js';import {settings} from '/src/settings.js';
const W=960,H=600,renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(W,H);document.body.append(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#b1c3d1');scene.add(new T.HemisphereLight(0xffffff,0x555566,3));const sun=new T.DirectionalLight(0xffffff,3);sun.position.set(-3,5,4);scene.add(sun);
const ground=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:'#55575a',roughness:1}));ground.rotation.x=-Math.PI/2;scene.add(ground);
const camera=new T.PerspectiveCamera(settings.cockpitFov,W/H,.035,200);let model,cockpit;window.ids=CARS.map(c=>c.id);
window.capture=async(id,view)=>{
 if(!model||model.spec.id!==id){if(model){scene.remove(model.root);model.root.traverse(o=>o.geometry?.dispose());cockpit.disposeMirrors();model.disposeDamage?.();}
  model=new CarModel(CARS.find(c=>c.id===id));cockpit=model.cockpit;scene.add(model.root);}
 model.update(.016,0,0,false,{heave:0,pitch:0,roll:0},null);model.root.updateMatrixWorld(true);
 if(view==='cockpit'){cockpit.setVisible(true);const st={ignition:true,rpm:3500,kmh:85,redline:model.spec.redline,gearLabel:'3',steerInput:0,vehicle:{}};cockpit.update(0,st);await new Promise(r=>setTimeout(r,120));cockpit.clusterKey=undefined;cockpit.update(0,st);
  camera.fov=settings.cockpitFov;camera.position.copy(cockpit.eye);model.body.localToWorld(camera.position);camera.rotation.set(cockpit.eyePitch,0,0);}
 else{cockpit.setVisible(false);const L=model.dims.L,d=Math.max(7,L*1.55),side=view==='side';camera.fov=side?26:34;
  camera.position.set(side?d:d*.62,side?.95:1.35,side?0:-d*.72);camera.lookAt(0,.7,0);}
 camera.updateProjectionMatrix();camera.updateMatrixWorld(true);renderer.render(scene,camera);
 const pose={rootY:model.root.position.y,bodyY:model.body.position.y,bodyPitch:model.body.rotation.x,wheels:model.wheels.map(w=>w.pivot.position.y)};
 return {image:renderer.domElement.toDataURL('image/jpeg',.9).split(',')[1],pose};};
window.ready=true;
</script></body></html>`;
const types={'.js':'text/javascript','.svg':'image/svg+xml','.json':'application/json'};
const server=createServer(async(req,res)=>{try{if(req.url==='/fixture'){res.setHeader('Content-Type','text/html');res.end(html);return;}const path=root+decodeURIComponent(req.url.split('?')[0]);res.setHeader('Content-Type',types[path.slice(path.lastIndexOf('.'))]||'application/octet-stream');res.end(await fs.readFile(path));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const tiles=new Map(),poses={};
try{
 const page=await browser.newPage({viewport:{width:960,height:600}});page.on('pageerror',e=>console.log('ERROR',e.stack));
 await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');await page.waitForFunction(()=>window.ready,null,{timeout:120000});
 const ids=process.env.CAPTURE_IDS?.split(',')||await page.evaluate(()=>ids);
 const views=process.env.VIEWS?.split(',')||['cockpit','side'];
 for(const id of ids)for(const view of views){const row=await page.evaluate(([id,view])=>capture(id,view),[id,view]);tiles.set(id+'/'+view,Buffer.from(row.image,'base64'));if(process.env.FULL)await fs.writeFile(`${out}/${id}-${view}.jpg`,tiles.get(id+'/'+view));poses[id]=row.pose;console.log(id,view);}
}finally{await browser.close();server.close();}
await fs.writeFile(out+'/rest-poses.json',JSON.stringify(poses,null,1));
const ids=[...new Set([...tiles.keys()].map(k=>k.split('/')[0]))],tw=480,th=300,cols=4;
for(const view of process.env.VIEWS?.split(',')||['cockpit','side'])for(let s=0;s*per<ids.length;s++){
 const chunk=ids.slice(s*per,(s+1)*per),rows=Math.ceil(chunk.length/cols);
 const composite=await Promise.all(chunk.map(async(id,i)=>({input:await sharp(tiles.get(id+'/'+view)).resize(tw,th).composite([{input:Buffer.from(`<svg width="${tw}" height="26"><rect width="${tw}" height="26" fill="#000a"/><text x="8" y="19" font-family="monospace" font-size="17" fill="#fff">${id}</text></svg>`),top:0,left:0}]).toBuffer(),left:(i%cols)*tw,top:Math.floor(i/cols)*th})));
 await sharp({create:{width:cols*tw,height:rows*th,channels:3,background:'#000'}}).composite(composite).webp({quality:82}).toFile(`${out}/${view}-sheet-${String(s+1).padStart(2,'0')}.webp`);
}
