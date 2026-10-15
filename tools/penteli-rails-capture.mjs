// Production map/terrain/scenery/car fixture; fixed camera and light before/after.
// Run one job through tools/browser-slot.sh. Captures renderer, no HTML overlays.
import fs from 'node:fs/promises';import {createServer} from 'node:http';import {resolve,extname} from 'node:path';import {homedir} from 'node:os';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.scratch/penteli-rails');
const fixture=`<!doctype html><base href="/"><script type="importmap">{"imports":{"three":"/world-three/build/three.module.js","three/addons/":"/world-three/examples/jsm/"}}</script><script type="module">
import * as THREE from 'three';import {loadMap} from '/src/map.js';import {loadTextures} from '/src/tex.js';import {RoadNetwork} from '/src/road-network-surface.js';import {buildRoadNetwork} from '/src/road-network.js';import {buildTerrain} from '/src/terrain.js';import {buildScenery} from '/src/maps/penteli.js';import {CarModel,CARS} from '/src/cars.js';import {prepareSceneryLod,updateSceneryLod,setDrawDistance} from '/src/scenery.js';
try{
await loadTextures();const map=await loadMap(undefined,'./','penteli',{preload:false});map.roadNetwork=new RoadNetwork(map);
const scene=new THREE.Scene();scene.background=new THREE.Color('#bacfdd');scene.fog=new THREE.Fog('#bacfdd',650,2800);
scene.add(new THREE.HemisphereLight('#e5efff','#8b8063',2));const sun=new THREE.DirectionalLight('#fff2dc',2.2);sun.position.set(-200,500,100);scene.add(sun);
const terrain=buildTerrain(map.terrain,map.route,[],scene,{coastal:false,network:map.roadNetwork});buildRoadNetwork(map.roadNetwork,scene);const world=buildScenery(scene,map,{heightC:terrain.heightC,assets:{network:map.roadNetwork}});
const cars=[new CarModel(CARS.find(c=>c.id==='mini')),new CarModel(CARS.find(c=>c.id==='mini'))];cars.forEach(c=>scene.add(c.root));cars[1].paint.color.set('#cc4c33');
const camera=new THREE.PerspectiveCamera(52,960/600,.1,3500),renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(960,600);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.append(renderer.domElement);
setDrawDistance(1000,'low',.7);const lod=prepareSceneryLod(scene,'low');scene.updateMatrixWorld(true);
window.capture=(s,view)=>{const r=map.route;for(let i=0;i<2;i++){const p=r.point(s,[-1.8,1.8][i]);cars[i].root.position.copy(p);cars[i].root.rotation.y=r.heading(s);}
 const at=r.point(s+12,0),eye=r.point(s-16,-1);eye.y+=view==='hairpin'?28:6;
 if(view==='hairpin'){eye.copy(r.point(s-32,-28));eye.y+=48;at.copy(r.point(s+16,0));}
 camera.position.copy(eye);camera.lookAt(at.x,at.y+.5,at.z);camera.updateMatrixWorld();scene.updateMatrixWorld(true);updateSceneryLod(lod,camera);renderer.render(scene,camera);
 const railMeshes=[];world.group.traverse(o=>{if(o.name.includes('barrier chunk'))railMeshes.push(o);});
 return {png:renderer.domElement.toDataURL('image/png').split(',')[1],metrics:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,rails:world.group.userData.guardrails,railTriangles:railMeshes.reduce((n,m)=>n+m.geometry.index.count/3,0),railChunks:railMeshes.length,width:r.edge(s)*2,carWidth:cars[0].dims.W,camera:camera.position.toArray(),target:at.toArray()}};
};window.ready=true;
}catch(e){window.failure=e.stack;console.error(e);}
</script>`;
let phase='before';
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://local').pathname;let data,file;
if(p==='/fixture'){data=fixture;file='fixture.html';}else {file=p.startsWith('/world-three/')?resolve(root,'node_modules/three',p.slice(13)):resolve(root,'.'+p);
if(phase==='before'&&p==='/src/maps/penteli.js')file=resolve(out,'before-penteli.js');if(phase==='before'&&p==='/data/maps/penteli/map.json')file=resolve(out,'before-map.json');data=await fs.readFile(file);}
res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.webp':'image/webp','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(data);
}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const pw=await import('/tmp/pw/node_modules/playwright/index.mjs');const browser=await pw.chromium.launch({headless:true,executablePath:resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={fixture:'Production terrain, road, scenery and Mini models, fixed lighting/cameras. No game HUD or running AI.',errors:[],shots:[]};
try{for(phase of (process.env.CAPTURE_PHASES||'before,after').split(',')){
const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));console.log('BUILD',phase);await page.goto('http://127.0.0.1:'+server.address().port+'/fixture',{waitUntil:'domcontentloaded',timeout:120000});await page.waitForFunction(()=>window.ready||window.failure,null,{timeout:600000});const error=await page.evaluate(()=>window.failure);if(error)throw Error(error);
for(const [name,s,view] of [['hairpin',3920,'hairpin'],['valley',6900,'valley'],['two-cars',4500,'width']]){const shot=await page.evaluate(({s,view})=>window.capture(s,view),{s,view});await fs.writeFile(resolve(out,phase+'-'+name+'.png'),Buffer.from(shot.png,'base64'));report.shots.push({phase,name,s,...shot.metrics});console.log('CAPTURE',phase,name,JSON.stringify(shot.metrics));}
await page.close();}
const page=await browser.newPage();const data=JSON.parse(await fs.readFile(resolve(out,'placement.json')));await page.setContent('<canvas width="1200" height="1000"></canvas>');const png=await page.evaluate(data=>{const c=document.querySelector('canvas'),g=c.getContext('2d'),xs=data.route.map(p=>p[0]),zs=data.route.map(p=>p[1]),minX=Math.min(...xs),minZ=Math.min(...zs),scale=Math.min(1050/(Math.max(...xs)-minX),800/(Math.max(...zs)-minZ));const point=p=>[70+(p[0]-minX)*scale,110+(p[1]-minZ)*scale];g.fillStyle='#15212a';g.fillRect(0,0,1200,1000);g.fillStyle='#eef3f7';g.font='26px sans-serif';g.fillText('Penteli barrier placement · terrain-derived reconstruction',40,45);g.font='18px sans-serif';g.fillText('Grey: road   Cyan: steel   Orange: concrete bridge parapets',40,78);const line=(pts,color,w)=>{g.strokeStyle=color;g.lineWidth=w;g.beginPath();pts.forEach((p,i)=>{const q=point(p);i?g.lineTo(...q):g.moveTo(...q);});g.stroke();};line(data.route,'#79858c',7);for(const run of data.rails)line(run.pts,run.kind==='steel'?'#47e7ee':'#ffb358',3);g.fillStyle='#fff';g.font='16px sans-serif';for(let i=0;i<data.route.length;i+=250){const q=point(data.route[i]);g.fillText(String(i*2)+' m',q[0]+8,q[1]-7);}g.fillText('Gaps retain junction access; new placements are not a surveyed inventory.',40,965);return c.toDataURL().split(',')[1];},data);await fs.writeFile(resolve(out,'placement-debug.png'),Buffer.from(png,'base64'));await page.close();
}finally{await fs.writeFile(resolve(out,'capture-report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
