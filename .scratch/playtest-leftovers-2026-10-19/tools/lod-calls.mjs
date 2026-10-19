// ROOT=<archive> OUT=<file.json> IDS=golf,z4 tools/browser-slot.sh node lod-calls.mjs
// Draw calls of one rival-style car (same CarModel the race builds for other drivers) seen from 4-25 m, at each class's vehicle LOD scale.
import fs from 'node:fs/promises';import {createServer} from 'node:http';
const {chromium}=await import('/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
const root=process.env.ROOT,ids=(process.env.IDS||'golf').split(',');
const html=`<html><body style="margin:0"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script><script type="module">
import * as T from 'three';import {CARS,CarModel} from '/src/cars.js';import {scaleVehicleLod} from '/src/vehicle-lod.js';import {PERFORMANCE} from '/src/graphics.js';
const renderer=new T.WebGLRenderer({antialias:false});renderer.setSize(320,200);document.body.append(renderer.domElement);
const scene=new T.Scene();scene.add(new T.HemisphereLight(0xffffff,0x555566,2));const camera=new T.PerspectiveCamera(50,1.6,.05,300);
window.measure=async(id)=>{const model=new CarModel(CARS.find(c=>c.id===id));model.cockpit?.setVisible(false);scene.add(model.root);await new Promise(r=>setTimeout(r,500));
 const out={};for(const [name,k] of [['high',PERFORMANCE.high.lod],['med',PERFORMANCE.med.lod],['low',PERFORMANCE.low.lod],['potato',PERFORMANCE.potato.lod]]){scaleVehicleLod(model,k);out[name]={};
  for(const d of [4,6,8,10,12,16,25]){camera.position.set(d,1.2,0);camera.lookAt(0,.6,0);camera.updateMatrixWorld(true);model.root.updateMatrixWorld(true);renderer.render(scene,camera);renderer.render(scene,camera);out[name][d]=renderer.info.render.calls;}}
 scene.remove(model.root);return out;};window.ready=true;
</script></body></html>`;
const types={'.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.json':'application/json','.wav':'audio/wav'};
const server=createServer(async(req,res)=>{try{if(req.url==='/fixture'){res.setHeader('Content-Type','text/html');res.end(html);return;}const path=root+decodeURIComponent(req.url.split('?')[0]);res.setHeader('Content-Type',types[path.slice(path.lastIndexOf('.'))]||'application/octet-stream');res.end(await fs.readFile(path));}catch{res.statusCode=404;res.end('nf');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage();page.on('pageerror',e=>console.log('PAGEERROR',e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');await page.waitForFunction(()=>window.ready,null,{timeout:120000});
 const res={};for(const id of ids)res[id]=await page.evaluate(id=>measure(id),id);await fs.writeFile(process.env.OUT,JSON.stringify(res,null,1));console.log(JSON.stringify(res));
}finally{await browser.close();server.close();}
