// Focused actual-builder views, through tools/browser-slot.sh. Baseline is an
// immutable prod SHA; no extra checkout and no shared working-tree reads.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {homedir} from 'node:os';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.scratch/detail-pass/signs');await fs.mkdir(out,{recursive:true});
const baseline=process.env.SIGN_BASE||'85a37e6a1b2d4c1947feb0f500ea97c623e5da6f',repo='/home/dev/projects/paraliaki-racing';
let phase='before';const cache=new Map();
const server=createServer(async(req,res)=>{try{
 const p=new URL(req.url,'http://local').pathname;let b;
 if(p==='/')b=Buffer.from('<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script><body style="margin:0"></body>');
 else if(phase==='before'&&p.startsWith('/src/')){if(!cache.has(p))cache.set(p,execFileSync('git',['show',baseline+':'+p.slice(1)],{cwd:repo}));b=cache.get(p);if(p==='/src/road.js')b=Buffer.from(b.toString().replace('function buildFurniture(', 'export function buildFurniture('));}
 else b=await fs.readFile(resolve(root,'.'+p));
 res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp'})[extname(p)]||'text/html');res.end(b);
 }catch(e){res.statusCode=404;res.end(String(e));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const pw=await import('/tmp/pw/node_modules/playwright/index.mjs'),browser=await pw.chromium.launch({headless:true,executablePath:resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={baseline,shots:[]},poses=new Map();
try{for(phase of ['before','after']){const page=await browser.newPage({viewport:{width:960,height:600}});page.on('pageerror',e=>console.log(String(e)));await page.goto(`http://127.0.0.1:${server.address().port}`);
 for(const fixture of ['speed-riviera','direction-penteli','gantry-psychiko','fixed-megara','event-megara','parking']){
 const result=await page.evaluate(async ({fixture,pose})=>{
  const THREE=await import('three'),{loadMap}=await import('/src/map.js'),{buildFurniture}=await import('/src/road.js'),{buildSpeedSigns}=await import('/src/speed-signs.js'),{EventMarkers}=await import('/src/event-markers.js'),{createRoadsideModels}=await import('/src/roadside.js');
  const scene=new THREE.Scene();scene.background=new THREE.Color('#b5c5d0');const root=new THREE.Group();scene.add(root);let target,post;
  if(fixture==='parking'){for(const part of createRoadsideModels().models.parking.parts)root.add(new THREE.Mesh(part.geometry,part.material));target=new THREE.Vector3(0,2.5,0);post=new THREE.Vector3(0,0,1);}
  else{const [kind,id]=fixture.split('-'),map=await loadMap(undefined,'/',id,{preload:false});const {RoadNetwork}=await import('/src/road-network-surface.js');map.roadNetwork=new RoadNetwork(map);
   if(kind==='fixed'){const {buildScenery}=await import('/src/maps/megara.js');const {bannerTex}=await import('/src/event-markers.js');buildScenery(root,map,{heightC:()=>map.route.frame(map.route.start,{}).y,assets:{makeLabel:(t,w,h,bg,fg)=>{const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:bannerTex(t,bg,fg)}));mesh.name='fixed-start-label';return mesh;}}});}else if(kind==='gantry')buildFurniture(map,root,()=>0,{});else if(kind==='event')new EventMarkers(root,map.route).arch(map.route.start,'START','#ff3d2e',1);else buildSpeedSigns(map,root,()=>0);
   root.updateMatrixWorld(true);let face;root.traverse(o=>{if(face||!o.isMesh||!o.material.map)return;if(kind==='gantry'&&o.position.y!==6.4)return;if(kind==='fixed'&&o.name!=='fixed-start-label')return;if(kind==='direction'&&o.parent.name!=='Greek direction and warning signs')return;face=o;});
   if(!face)throw Error('missing '+fixture);const matrix=face.matrixWorld.clone();if(face.isInstancedMesh){const m=new THREE.Matrix4();face.getMatrixAt(0,m);matrix.multiply(m);}target=new THREE.Vector3().setFromMatrixPosition(matrix);post=new THREE.Vector3(0,0,1).transformDirection(matrix);if(kind==='event'){target.y+=6.4;}if(kind==='fixed'){const f=map.route.frame(map.route.start,{});post.set(-f.tx,0,-f.tz);}
  }
  root.traverse(o=>{if(o.isMesh){const m=o.material;o.material=new THREE.MeshBasicMaterial({color:m.color,map:m.map,side:m.side,vertexColors:m.vertexColors,transparent:m.transparent,opacity:m.opacity,alphaTest:m.alphaTest});}});
  const camera=new THREE.PerspectiveCamera(45,960/600,.05,100);const distance=fixture.includes('gantry')||fixture.includes('event')||fixture.includes('fixed')?23:5;
  camera.position.copy(target).addScaledVector(post,distance).add(new THREE.Vector3(.2,-.3,0));if(pose){camera.position.fromArray(pose.position);target.fromArray(pose.target);}camera.lookAt(target);camera.updateMatrixWorld(true);
  const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(960,600);document.body.replaceChildren(renderer.domElement);
  for(let i=0;i<3;i++)renderer.render(scene,camera);const textures=new Set();root.traverse(o=>{if(o.material?.map)textures.add(o.material.map);});const textureBytes=[...textures].reduce((n,t)=>n+(t.image?.width||0)*(t.image?.height||0)*4*4/3,0);const result={pose:{position:camera.position.toArray(),target:target.toArray()},textureBytes,frameUpdateMs:0,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,png:renderer.domElement.toDataURL().split(',')[1]};renderer.dispose();return result;
 },{fixture,pose:poses.get(fixture)});poses.set(fixture,result.pose);
 await fs.writeFile(resolve(out,fixture+'-'+phase+'.png'),Buffer.from(result.png,'base64'));delete result.png;report.shots.push({fixture,phase,...result});console.log(fixture,phase,result);
 }await page.close();}}
finally{await fs.writeFile(resolve(out,'metrics.json'),JSON.stringify(report,null,2));await browser.close();server.close();}
