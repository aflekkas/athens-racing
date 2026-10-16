// Isolated water-entry visual fixture; run through tools/browser-slot.sh.
import http from 'node:http';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.scratch/realism');
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;const file=path.startsWith('/three/')?resolve(root,'node_modules/three',path.slice(7)):resolve(root,'.'+path);res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import('/tmp/pw/node_modules/playwright/index.mjs');const browser=await chromium.launch({headless:true,executablePath:resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:800,height:500}});page.on('pageerror',e=>{throw e;});await page.goto(`http://127.0.0.1:${server.address().port}/src/rain-overlays.js`);
 await page.setContent('<script type="importmap">{"imports":{"three":"/three/build/three.module.js"}}</script>');
 for(const phase of ['before','after']){
 const shot=await page.evaluate(async phase=>{const T=await import('three'),{Splash}=await import('/.scratch/realism/splash-before.mjs'),{WaterSplash}=await import('/src/rain-overlays.js');
 const scene=new T.Scene();scene.background=new T.Color('#9aabb4');const camera=new T.PerspectiveCamera(50,1.6,.1,100);camera.position.set(8,4,8);camera.lookAt(0,.8,0);
 const renderer=new T.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(800,500);const water=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshBasicMaterial({color:'#315f74'}));water.rotation.x=-Math.PI/2;water.position.y=-.02;scene.add(water);
 const car=new T.Mesh(new T.BoxGeometry(1.8,.7,4),new T.MeshBasicMaterial({color:'#8a292b'}));car.position.y=.35;scene.add(car);
 let seed=123;Math.random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};const splash=phase==='before'?new Splash(scene):new WaterSplash(scene,0);splash.burst(0,0,5,0,1);for(let i=0;i<30;i++)splash.update(1/60);renderer.render(scene,camera);const result={png:renderer.domElement.toDataURL().split(',')[1],...renderer.info.render};renderer.dispose();return result;
 },phase);await fs.writeFile(resolve(out,`splash-${phase}.png`),Buffer.from(shot.png,'base64'));delete shot.png;console.log(phase,shot);
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
