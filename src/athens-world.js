// Development-only connected world. This entry owns its scene and never calls
// loadMap/buildMapWorld: no monolithic legacy geometry or contact pack coexists.
import * as THREE from 'three';
import {settings,onSettings} from './settings.js';
import {resolveGraphics} from './graphics.js';
import {WorldTileStream} from './world-tile-stream.js';
import {WorldTileScene} from './world-tile-scene.js';
import {WorldTileRoads} from './world-tile-roads.js';
import {WorldTileBarriers} from './world-tile-barriers.js';
import {WorldTileObstacles} from './world-tile-obstacles.js';
import {AthensRoute,AthensGround} from './athens-ground.js';
import {WorldDetail} from './world-detail.js';
import {athensMaterial,loadAthensTextures} from './athens-materials.js';
import {SEA_TIME} from './athens-detail.js';
import {AthensProps,KINDS as PROP_KINDS} from './athens-props.js';
import {AthensHorizon} from './athens-horizon.js';
import {AthensLandmarks,insideLandmark} from './athens-landmarks.js';
import {DRESSING_VARIANTS} from './world-tile-dressing.js';
import {Vehicle} from './physics.js';
import {CARS,CarModel,setCarEnv,catalogueTrafficTypes} from './cars.js';
import {fleetModel} from './traffic-fleet.js';
import {input} from './input.js';
import {resolvePlayerContacts} from './multiplayer-contact.js';
import {AccountsClient} from './accounts-client.js';
import {loading} from './ui/loading.js';
import {ui} from './ui/components.js';
import {Hud,fmtTime} from './hud.js';
import {estimateSceneMemory} from './asset-metrics.js';
import {RNG} from './util.js';
import {createPost} from './post.js';
import * as ENV from './env.js';
const MiB=1024*1024,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export async function bootAthens(){
 const started=performance.now(),query=new URLSearchParams(location.search);
 if(query.get('map')!=='athens')throw Error('Athens requires its development map flag');
 const account=new AccountsClient();await account.init();
 if(account.blocked){await ui.prompt({title:'SIGN IN TO DRIVE',body:'Sign in from the main menu to continue.',actions:[{id:'menu',label:'MAIN MENU',variant:'primary'}]});location.assign('/?menu=1');return;}
 const canvas=document.getElementById('c'),renderer=new THREE.WebGLRenderer({canvas,antialias:false,stencil:false,powerPreference:'high-performance'}),gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
 const gfx=resolveGraphics(settings,{gpuName:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):''}),resources=gfx.resources;
 renderer.setPixelRatio(gfx.pixelRatio);renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=false;
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.15,Math.min(gfx.drawDistance,850));
 scene.fog=new THREE.Fog('#9caeae',camera.far*.65,camera.far);const sky=ENV.createSky();scene.add(sky);const baked=ENV.bakeSky(renderer,sky);scene.environment=baked.env;setCarEnv(baked.env);const {sun}=ENV.createLights(scene);sun.castShadow=false;
 const post=createPost(renderer,scene,camera),detailRoot=new THREE.Group();scene.add(detailRoot);
 const detail=new WorldDetail({id:'athens',terrain:{},data:{buildings:[],vegetation:[]},route:{length:0}},detailRoot,()=>0);
 const props=new AthensProps(detailRoot,{enabled:settings.worldDetail!==false,skip:(kind,x,z)=>settings.worldDetail!==false&&(kind===PROP_KINDS.monument||kind===PROP_KINDS.fountain)&&insideLandmark(x,z)}),horizon=new AthensHorizon(scene,scene.fog,{enabled:settings.worldDetail!==false}),landmarks=new AthensLandmarks(detailRoot,scene.fog,{enabled:settings.worldDetail!==false,groundAt:(x,z,y)=>{const c=stream?.contact(x,z,{referenceY:y,layer:0});return c?c.y:null;}}),boxRoots=new Set();
 // Buildings a landmark model replaces stay in their tile as hidden meshes; World detail Off shows the old boxes again.
 const syncBoxes=()=>{const hidden=settings.worldDetail!==false;for(const root of boxRoots)for(const c of root.children)if(c.userData.landmarkBox)c.visible=!hidden;};
 const unsubscribeProps=onSettings((s,key)=>{if(!key||key==='worldDetail'){props.setEnabled(s.worldDetail!==false);horizon.setEnabled(s.worldDetail!==false);landmarks.setEnabled(s.worldDetail!==false);syncBoxes();}});
 horizon.load(new URL('./assets/athens/horizon.bin',document.baseURI)).catch(e=>console.warn(e.message));
 await loadAthensTextures(renderer);const sceneTiles=new WorldTileScene(scene,{renderer,materialFactory:athensMaterial}),barriers=new WorldTileBarriers(),obstacles=new WorldTileObstacles();
 loading.show('athens','FREE ROAM');document.getElementById('ldName').textContent='ATHENS';
 const manifestURL=new URL('./data/athens/manifest.json',document.baseURI),response=await fetch(manifestURL);
 if(!response.ok)throw Error('Athens development cells are not hosted on this server');
 const manifest=await response.json();if(!manifest.developmentOnly||manifest.releaseReady!==false)throw Error('Unexpected Athens activation policy');
 let scripted=false,driver=null,cameraHook=null,stream,roads,player=null,stopped=false,paused=false,towing=false,frameId,elapsed=0,accumulator=0,last=performance.now(),lastTraffic=-10,trafficDt=0;
 const traffic=[],contacts=new Map(),stats={frames:0,simulationSeconds:0,metres:0,holds:0,missingContacts:0,carHits:0,frameMs:[],cpuMs:[],initialDownloadBytes:0,initialDriveMs:0,maxEstimatedJSBytes:0,maxEstimatedGPUBytes:0},rng=new RNG(71018);
 const adapter={
  warmup:p=>sceneTiles.warmup(p),
  rebase(origin,previous){sceneTiles.rebase(origin,previous);detailRoot.position.set(-origin.x,0,-origin.z);},
  prepare(key,packet,origin){const build=sceneTiles.prepare(key,packet,origin);let installed=false;
   return {steps:build.steps,commit(){
    try{
     if(manifest.tiles[key].contactEligible!==false)roads.graph.install(key,packet);
     barriers.install(key,packet);obstacles.install(key,packet);
     const ext=packet.metadata.extensions?.worldDetail?.vegetation,records=[];
     if(ext){const p=packet.arrays[ext.positionHeight],k=packet.arrays[ext.kind],seed=packet.arrays[ext.seed],o=packet.metadata.origin;for(let i=0;i<k.length;i++)records.push({kind:'tree',treeKind:k[i],x:p[i*4]+o[0],y:p[i*4+1],z:p[i*4+2]+o[2],height:p[i*4+3],seed:seed[i]});}
     detail.addRecords(key,records);props.addTile(key,packet);landmarks.addTile(key);installed=true;const handle=build.commit();boxRoots.add(handle.root);syncBoxes();return handle;
    }catch(e){roads.graph.remove(key);barriers.remove(key);obstacles.remove(key);detail.removeTile(key);props.removeTile(key);landmarks.removeTile(key);build.dispose();throw e;}
   },dispose(){if(installed){roads.graph.remove(key);barriers.remove(key);obstacles.remove(key);detail.removeTile(key);props.removeTile(key);landmarks.removeTile(key);installed=false;}for(const r of [...boxRoots])if(r.name==='tile:'+key)boxRoots.delete(r);build.dispose();}};
  }
 };
 stream=new WorldTileStream(manifest,{...resources.stream,adapter,baseURL:manifestURL,activationMs:3});roads=new WorldTileRoads(stream);
 if(manifest.renderVariants){const declared=new Set(manifest.renderVariants.map(v=>v.key));await sceneTiles.prewarm([...manifest.renderVariants,...DRESSING_VARIANTS.filter(v=>!declared.has(v.key))]);}
 const spec=CARS.find(c=>c.id===query.get('car'))||CARS.find(c=>c.id==='carrera')||CARS[0];
 function place(v,p){v.reset(0,0,0);Object.assign(v,{x:p.x,y:p.y,z:p.z,yaw:p.yaw,vLong:0,vLat:0,w:0,_network:true});Object.assign(v,v.route.project(v.x,v.z));v.ground.referenceY=p.y;v.ground.begin(v);v.ground.resolve(v,1/240);v.syncWheels();}
 await stream.spawn(p=>{const route=new AthensRoute(p),veh=new Vehicle(spec,route),model=new CarModel(spec);veh.ground=new AthensGround(stream,route,barriers,obstacles);place(veh,p);scene.add(model.root);player={veh,model,spec};},{halfWidth:(spec.width||2)/2,halfLength:(spec.length||5)/2,timeoutMs:180000});
 // The free roam spawn picker (?map=athens&menu=1) sends the chosen point as ?spawn=x,z (Athens world metres): the car goes on the nearest safe road anchor there.
 async function spawnAt(x,z){towing=true;try{await stream.teleport({x,z},()=>{const p=[...roads.anchors({validate:false})].filter(p=>roads.safe(p)).sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0];if(!p)throw Error('No safe road near the chosen point');place(player.veh,p);});}finally{towing=false;}}
 stream.releaseSpawn();input.setCarSpec(spec);
 {const chosen=(query.get('spawn')||'').split(',').map(Number);if(chosen.length===2&&chosen.every(Number.isFinite))await spawnAt(chosen[0],chosen[1]);}
 stats.initialDownloadBytes=stream.pool?.downloadedBytes||stream.metrics.loadedBytes;stats.initialDriveMs=performance.now()-started;
 loading.hide();document.body.classList.remove('menu-backdrop');document.body.classList.add('loaded','racing');document.getElementById('ui').replaceChildren();
 for(const id of ['posBox','mapBox','sigBox','rbar','rToGo'])document.getElementById(id).style.display='none';
 document.getElementById('rZone').textContent='ATHENS';document.getElementById('rRoad').textContent='FREE ROAM';
 const tacho=document.getElementById('tacho'),dial=Object.assign(Object.create(Hud.prototype),{tacho,tctx:tacho.getContext('2d')}); // the tacho is Hud's own drawing code, so the dial needs Hud's methods (tachoBase, fontsReady) too
 let sharedMemory=estimateSceneMemory(scene),sharedJS=sharedMemory.geometryBytes+sharedMemory.textureBytes;
 function inventory(){sharedMemory=estimateSceneMemory(scene);sharedJS=sharedMemory.geometryBytes+sharedMemory.textureBytes;let tileJS=0,tileGPU=0;for(const t of stream.tiles.values())if(t.packet){tileJS+=t.packet.jsBytes;tileGPU+=t.packet.gpuBytes;}
  const size=renderer.getDrawingBufferSize(new THREE.Vector2()),targets=size.x*size.y*20+16*MiB;
  const heap=performance.memory?.usedJSHeapSize??64*MiB,js=heap+sharedJS+tileJS+stream.transientBytes,gpu=sharedMemory.gpuBytes+tileGPU+targets;
  stats.maxEstimatedJSBytes=Math.max(stats.maxEstimatedJSBytes,js);stats.maxEstimatedGPUBytes=Math.max(stats.maxEstimatedGPUBytes,gpu);
  return {js,gpu,heap,sharedJS,tileJS,tileGPU,renderTargetsAndSkyAllowance:targets,resources,streamReserved:stream.residentBytes+stream.reservedBytes,transient:stream.transientBytes};
 }
 async function tow(){if(towing)return;towing=true;try{const v=player.veh,p=[...roads.anchors({validate:false})].sort((a,b)=>Math.hypot(a.x-v.x,a.z-v.z)-Math.hypot(b.x-v.x,b.z-v.z)).find(p=>roads.safe(p));if(!p)throw Error('No safe loaded tow anchor');await roads.tow(p.id,target=>place(v,target));}finally{towing=false;}}
 function maintainTraffic(){
  const v=player.veh,count=resources.stream.concurrency===1?3:5;
  for(const c of traffic)if(c.active&&Math.hypot(c.veh.x-v.x,c.veh.z-v.z)>300){c.active=false;c.model.root.visible=false;}
  const available=[...roads.anchors({validate:false})].filter(a=>{const d=Math.hypot(a.x-v.x,a.z-v.z);return d>40&&d<180&&!traffic.some(c=>c.active&&Math.hypot(c.veh.x-a.x,c.veh.z-a.z)<20);});
  while(traffic.filter(c=>c.active).length<count&&available.length){const p=available.shift();if(!roads.safe(p))continue;let c=traffic.find(c=>!c.active);
   if(!c){const type=catalogueTrafficTypes(CARS)[0],trafficSpec=CARS.find(c=>c.id===type.catalogueCar?.id)||CARS.find(c=>c.id==='mini')||spec,route=new AthensRoute(p),veh=new Vehicle(trafficSpec,route),model=fleetModel(type,'#869da2',rng,{low:true});veh.ground=new AthensGround(stream,route,barriers,obstacles);c={id:'traffic:'+traffic.length,veh,model,spec:trafficSpec,active:false};traffic.push(c);scene.add(model.root);}
   place(c.veh,p);c.point={...p,layer:0};c.active=true;c.model.root.visible=true;
  }
 }
 function step(dt,drive){
  if(paused||towing||account.blocked)return;const v=player.veh;
  const points=v.ground.footprint(v,Math.hypot(v.vLong,v.vLat)*dt+.5),fx=-Math.sin(v.yaw),fz=-Math.cos(v.yaw),rx=Math.cos(v.yaw),rz=-Math.sin(v.yaw);
  stream.update({x:v.x,z:v.z,vx:fx*v.vLong+rx*v.vLat,vz:fz*v.vLong+rz*v.vLat,contacts:points,interest:traffic.filter(c=>c.active).map(c=>c.veh)});
  if(!v.ground.ready(v,dt)){stats.holds++;return;}
  const old={x:v.x,y:v.y,z:v.z,yaw:v.yaw};v.ground.begin(v);
  try{v.update(dt,drive||(driver?driver(v,dt):input.state));}catch(e){Object.assign(v,old,{vLong:0,vLat:0,w:0});stats.missingContacts++;throw e;}
  trafficDt+=dt;
  if(trafficDt>=.1){for(const c of traffic)if(c.active){
   // AI stops for a red or amber signal at its stop line; the player is never forced to.
   if(props.hold(c.point,roads.graph.edges.get(c.point.edge)?.value.points||[[0,0,0]])){c.veh.vLong=0;continue;}
   const p=roads.advance(c.point,trafficDt*8,{halfWidth:c.veh.halfW,halfLength:c.veh.halfL});c.veh.vLong=p?8:0;
   if(p){c.point=p;Object.assign(c.veh,p);Object.assign(c.veh,c.veh.route.project(p.x,p.z));}
  }
  trafficDt=0;}
  stats.carHits+=resolvePlayerContacts(v,traffic.filter(c=>c.active).map(c=>({id:c.id,vehicle:c.veh})),dt,elapsed*1000,contacts).length;
  barriers.resolve(v,old);stats.metres+=Math.hypot(v.x-old.x,v.z-old.z);elapsed+=dt;stats.simulationSeconds=elapsed;
 }
 function render(dt){
  const v=player.veh,o=stream.origin;v.place(player.model.root);player.model.root.position.x-=o.x;player.model.root.position.z-=o.z;player.model.update(dt,v.vLong,v.steer,input.state.brake>.2,v.pose,v.corners,v.w);
  for(const c of traffic)if(c.active){c.veh.place(c.model.root);c.model.root.position.x-=o.x;c.model.root.position.z-=o.z;}
  const fx=-Math.sin(v.yaw),fz=-Math.cos(v.yaw),target=new THREE.Vector3(v.x-o.x-fx*8,v.y+3.8,v.z-o.z-fz*8);
  camera.position.copy(target);camera.lookAt(v.x-o.x+fx*8,v.y+1,v.z-o.z+fz*8);if(cameraHook)cameraHook(camera,v,o);sky.position.copy(camera.position);ENV.updateSun(sun,player.model.root.position);ENV.U.time.value=elapsed;SEA_TIME.value=elapsed;
  detail.update({position:{x:v.x,z:v.z}});props.update({position:{x:v.x,z:v.z}},elapsed);
  {const ax=camera.position.x+o.x,az=camera.position.z+o.z;horizon.update(camera,ax,camera.position.y,az);landmarks.update(ax,camera.position.y,az,camera.far);}
  post.render(dt);
  dial.drawTacho({...v,redline:spec.redline,kmh:Math.abs(v.vLong)*3.6,gearLabel:v.reverse?'R':String(v.gear),aidsOff:!settings.aids});document.getElementById('tRace').textContent=fmtTime(elapsed);
 }
 function tick(now){if(stopped)return;if(scripted){last=now;frameId=requestAnimationFrame(tick);return;}const cpu=performance.now(),delta=Math.min(.1,(now-last)/1000);stats.frameMs.push(now-last);if(stats.frameMs.length>900)stats.frameMs.shift();last=now;
  try{
   input.update(delta,{speed:player.veh.vLong,inMenu:false,blocked:paused||towing});
   for(const action of input.actions){if(action==='tow'||action==='reset')void tow();if(action==='pause')paused=!paused;if(action==='garage')location.assign('/?menu=1');}
   stream.activateFrame();if(elapsed-lastTraffic>2){maintainTraffic();lastTraffic=elapsed;}
   accumulator=Math.min(accumulator+delta,.1);while(accumulator>=1/240){step(1/240);accumulator-=1/240;}
   render(delta);stats.frames++;if(stats.frames%30===0){const m=inventory();if(m.gpu>resources.gpuBytes||m.js>resources.jsBytes)throw Error('Athens resource admission exceeded');}
  }catch(e){paused=true;document.getElementById('err').style.display='block';document.getElementById('err').textContent=e.message;console.error(e);}
  stats.cpuMs.push(performance.now()-cpu);if(stats.cpuMs.length>900)stats.cpuMs.shift();frameId=requestAnimationFrame(tick);
 }
 function dispose(){if(stopped)return;stopped=true;cancelAnimationFrame(frameId);stream.dispose();roads.dispose();barriers.dispose();obstacles.dispose();detail.dispose();unsubscribeProps();props.dispose();horizon.dispose();landmarks.dispose();sceneTiles.dispose();renderer.dispose();}
 addEventListener('pagehide',dispose,{once:true});addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();post.setSize(innerWidth,innerHeight,gfx.pixelRatio);});
 document.addEventListener('visibilitychange',()=>{last=performance.now();accumulator=0;if(!document.hidden)void account.revalidate();});
 // Scripted measurement drive: wall-clock paced like a 30 fps game, optional sparse rendering.
 async function advance(seconds,{renderEvery=0,paceMs=1000/30}={}){
  const frames=Math.round(seconds*30);scripted=true;
  try{for(let f=0;f<frames&&!stopped;f++){
   const begin=performance.now();stream.activateFrame();if(elapsed-lastTraffic>2){maintainTraffic();lastTraffic=elapsed;}
   for(let i=0;i<8;i++)step(1/240);
   if(renderEvery&&f%renderEvery===0){render(renderEvery/30);stats.frames++;}
   if(f%30===0)inventory();
   await new Promise(r=>setTimeout(r,Math.max(0,paceMs-(performance.now()-begin))));
  }}finally{scripted=false;last=performance.now();}
 }
 async function goto(id,x,z){towing=true;try{await stream.teleport({x,z},()=>{const p=stream.anchor(id);if(!p)throw Error('Unknown anchor '+id);place(player.veh,p);});}finally{towing=false;}}
 window.__athens={props,horizon,landmarks,place:p=>place(player.veh,p),advance,goto,setDriver:fn=>{driver=fn;},setCameraHook:fn=>{cameraHook=fn;},stream,roads,barriers,obstacles,player,traffic,scene,renderer,camera,stats,inventory,tow,dispose,step,render,setPaused:value=>{paused=!!value;},get paused(){return paused;}};
 last=performance.now();frameId=requestAnimationFrame(tick);return window.__athens;
}
