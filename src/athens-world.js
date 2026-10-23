import {WorldTraffic} from './world-traffic.js';
import {worldRecoveryTarget} from './world-recovery.js';
import {createGuidanceDemo,DEMO_ROUTE} from './route-guidance/demo.js';
import {createWorldSession} from './world-session.js';
// Connected free-roam world. This entry owns its scene and never calls
// loadMap/buildMapWorld: no monolithic legacy geometry or contact pack coexists.
import * as THREE from 'three';
import {settings,setSetting,onSettings,applySteeringAssist,mirrorQuality} from './settings.js';
import {Menu} from './menu.js';
import {Cockpit,mirrorsInView} from './cockpit.js';
import {createCameraViews,CAMERA_NAMES} from './camera-views.js';
import {chaseRig} from './vehicle-camera.js';
import {seatPosition} from './seat-position.js';
import {applyVehicleAids,toggleTractionControl} from './driving-aids.js';
import {shiftTransmission} from './transmission.js';
import {drivingHints} from './ui/driving-hints.js';
import {pickedAthensArea,pollFreeRoam,freeRoamHud,freeRoamJSBytes} from './athens-free-roam.js';
import {resolveGraphics} from './graphics.js';
import {AthensRoute,AthensGround} from './athens-ground.js';
import {SEA_TIME} from './athens-detail.js';
import {Vehicle} from './physics.js';
import {CARS,CarModel,setCarEnv} from './cars.js';
import {input} from './input.js';
import {AccountsClient} from './accounts-client.js';
import {bootScreen} from './ui/boot-screen.js';
import {loading} from './ui/loading.js';
import {ui} from './ui/components.js';
import {Hud,fmtTime} from './hud.js';
import {estimateSceneMemory} from './asset-metrics.js';
import {createPost} from './post.js';
import * as ENV from './env.js';
const MiB=1024*1024,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export async function bootAthens(){
 const started=performance.now(),query=new URLSearchParams(location.search);
 if(query.get('map')!=='athens')throw Error('Athens requires its development map flag');
 // The central launch screen (src/ui/boot-screen.js) checks the session; signed out, the driver goes straight to the
 // title's sign-in dialog instead of a prompt to go there.
 bootScreen.step('CHECKING YOUR SESSION',.6);
 const account=new AccountsClient();await account.init();
 if(account.blocked){location.replace('/?menu=1');return;}
 bootScreen.done();
 const canvas=document.getElementById('c'),renderer=new THREE.WebGLRenderer({canvas,antialias:false,stencil:false,powerPreference:'high-performance'}),gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
 const gfx=resolveGraphics(settings,{gpuName:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):''}),resources=gfx.resources;
 renderer.setPixelRatio(gfx.pixelRatio);renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=false;
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.15,Math.min(gfx.drawDistance,850));
 scene.fog=new THREE.Fog('#9caeae',camera.far*.65,camera.far);const sky=ENV.createSky();scene.add(sky);const baked=ENV.bakeSky(renderer,sky);scene.environment=baked.env;setCarEnv(baked.env);const {sun}=ENV.createLights(scene);sun.castShadow=false;
 const post=createPost(renderer,scene,camera);
 const area=pickedAthensArea(query);
 loading.show('athens','FREE ROAM',{freeRoam:true,area});
 let scripted=false,driver=null,cameraHook=null,player=null,stopped=false,paused=false,towing=false,frameId,elapsed=0,accumulator=0,last=performance.now(),lastTraffic=-10,lookBackA=0;
 let worldTraffic;const stats={frames:0,simulationSeconds:0,metres:0,holds:0,missingContacts:0,carHits:0,frameMs:[],cpuMs:[],initialDownloadBytes:0,initialDriveMs:0,maxEstimatedJSBytes:0,maxEstimatedGPUBytes:0};
 const session=await createWorldSession({renderer,scene,resources,progress:(...args)=>loading.progress(...args)});
 const {stream,roads,barriers,obstacles,detail,props,trees,signs,marks,horizon,landmarks,plazas,lawns,sceneTiles,manifest}=session;
 let guidance=query.get('guidance')==='1'?createGuidanceDemo(scene,stream,roads):null;const offGuidance=session.subscribeTiles({activated:k=>guidance?.addCell(k),removed:k=>guidance?.removeCell(k)});
 const spec=CARS.find(c=>c.id===query.get('car'))||CARS.find(c=>c.id==='carrera_gts')||CARS[0];
 function place(v,p){v.reset(0,0,0);Object.assign(v,{x:p.x,y:p.y,z:p.z,yaw:p.yaw,vLong:0,vLat:0,w:0,_network:true});Object.assign(v,v.route.project(v.x,v.z));v.ground.referenceY=p.y;v.ground.begin(v);v.ground.resolve(v,1/240);v.syncWheels();}
 await stream.spawn(p=>{const route=new AthensRoute(p),veh=new Vehicle(spec,route),model=new CarModel(spec);veh.ground=new AthensGround(stream,route,barriers,obstacles);place(veh,p);scene.add(model.root);player={veh,model,spec};},{halfWidth:(spec.width||2)/2,halfLength:(spec.length||5)/2,timeoutMs:180000});
 // The free roam spawn picker (?map=athens&menu=1) sends the chosen point as ?spawn=x,z (Athens world metres): the car goes on the nearest safe road anchor there.
 async function spawnAt(x,z){towing=true;try{const p=await session.prepareSpawn({x,z},{car:spec});player.veh.route=session.route;player.veh.ground=session.ground;place(player.veh,p);}finally{towing=false;}}
 await spawnAt(player.veh.x,player.veh.z);
 stream.releaseSpawn();input.setCarSpec(spec);
 player.cockpit=new Cockpit(spec,player.model);player.cockpit.setVisible(false);
 const applyDriving=()=>{applyVehicleAids(player.veh,spec);player.veh.setManual(settings.transmission==='manual');applySteeringAssist(player.veh,input.drivingSource);};
 const offSettings=onSettings(applyDriving);applyDriving();
 {const chosen=(query.get('spawn')||(guidance?`${DEMO_ROUTE[0][0]},${DEMO_ROUTE[0][2]}`:'')).split(',').map(Number);if(chosen.length===2&&chosen.every(Number.isFinite))await spawnAt(chosen[0],chosen[1]);}
 if(guidance&&!query.has('spawn')){const p=guidance.spawnPose();if(p)place(player.veh,p);}
 stats.initialDownloadBytes=stream.pool?.downloadedBytes||stream.metrics.loadedBytes;stats.initialDriveMs=performance.now()-started;
 loading.hide();document.body.classList.remove('menu-backdrop');document.body.classList.add('loaded','racing');document.getElementById('ui').replaceChildren();
 document.body.dataset.mode='free';
 for(const id of ['posBox','sigBox','rbar','rToGo','routeBox','lapTiming']){const el=document.getElementById(id);if(el)el.style.display='none';}
 document.getElementById('mapBox').style.display='';document.getElementById('mapLabel').textContent=area?'ATHENS · '+area:'ATHENS';
 document.getElementById('rZone').textContent='ATHENS';document.getElementById('rRoad').textContent=guidance?'ROUTE DEMO':'FREE ROAM';
 const tacho=document.getElementById('tacho'),dial=Object.assign(Object.create(Hud.prototype),{tacho,tctx:tacho.getContext('2d')});
 dial.mini=document.getElementById('minimap');dial.mctx=dial.mini.getContext('2d');dial.worldRoads=roads;dial.worldStreetCache=new Map();
 const cameraViews=createCameraViews(['cockpit','chase','far','bumper'].includes(query.get('cam'))?query.get('cam'):null);
 let cam=cameraViews.current,hudAt=0,mapAt=0;
 const canvasFocus=()=>{canvas.tabIndex=-1;canvas.focus({preventScroll:true});};
 const resume=()=>{menu.hide();paused=false;input.clear();canvasFocus();};
 const pause=()=>{if(towing)return;paused=true;input.clear();menu.show('pause',{inFreeRoam:true,roamActions:false,kick:area?'ATHENS · '+area:'ATHENS'});document.getElementById('ui').focus({preventScroll:true});};
 const quit=()=>location.assign('/?menu=1');
 const menu=new Menu(document.getElementById('ui'),{resume,quit,carSpec:()=>spec,carName:()=>spec.name,manual:()=>player.veh.manual,inputDevice:()=>input.drivingSource,fmtTime,bindings:el=>input.openBindings(el),cancelBindings:()=>input.cancelCapture()});
 const openSettings=()=>{pause();menu.show('settings',{from:'pause',tab:'audio'},true);};
 window.__flow={menu,pause,resume,quit,openSettings,resetCar:()=>{resume();void tow();},inFreeRoam:()=>true,inMenu:()=>menu.open,get state(){return paused?'paused':'race';}};
 canvasFocus();
 function action(name){
  drivingHints.action(name);
  if(ui.action(name))return;
  if(name==='pause')pause();
  else if(name==='tow'||name==='reset')void tow();
  else if(name==='camera'||name==='cameraPosition'){cam=name==='camera'?cameraViews.toggle():cameraViews.cycle();input.toast(CAMERA_NAMES[cam]+' CAM',{ms:1200});}
  else if(name==='map')dial.toggleBigMap();
  else if(name==='transmission')setSetting('transmission',settings.transmission==='manual'?'auto':'manual');
  else if(name==='shiftUp'||name==='shiftDown')shiftTransmission(player.veh,name==='shiftUp'?1:-1);
  else if(name==='tractionControl')toggleTractionControl();
 }
 let sharedMemory=estimateSceneMemory(scene),sharedJS=sharedMemory.geometryBytes+sharedMemory.textureBytes;
 function inventory(){sharedMemory=estimateSceneMemory(scene);sharedJS=sharedMemory.geometryBytes+sharedMemory.textureBytes;let tileJS=0,tileGPU=0;for(const t of stream.tiles.values())if(t.packet){tileJS+=t.packet.jsBytes;tileGPU+=t.packet.gpuBytes;}
  const size=renderer.getDrawingBufferSize(new THREE.Vector2()),targets=size.x*size.y*20+16*MiB;
  const heap=performance.memory?.usedJSHeapSize??64*MiB,js=freeRoamJSBytes(heap,sharedJS,tileJS,stream.transientBytes),gpu=sharedMemory.gpuBytes+tileGPU+targets;
  stats.maxEstimatedJSBytes=Math.max(stats.maxEstimatedJSBytes,js);stats.maxEstimatedGPUBytes=Math.max(stats.maxEstimatedGPUBytes,gpu);
  return {js,gpu,heap,sharedJS,tileJS,tileGPU,renderTargetsAndSkyAllowance:targets,resources,streamReserved:stream.residentBytes+stream.reservedBytes,transient:stream.transientBytes};
 }
 async function tow(){if(towing)return;towing=true;try{const v=player.veh,p=worldRecoveryTarget(session,v,{route:null,halfWidth:v.halfW,halfLength:v.halfL,actors:worldTraffic?.actors||[]});if(!p)throw Error('No safe loaded road');await stream.teleport(p,()=>place(v,p),{validatePose:session.safePose});}finally{towing=false;}}
 worldTraffic=new WorldTraffic(session,scene,player.veh.route);worldTraffic.configure({type:'free',traffic:1,rules:{police:false}});
 function step(dt,drive){
  if(paused||towing||account.blocked)return;const v=player.veh;
  const points=v.ground.footprint(v,Math.hypot(v.vLong,v.vLat)*dt+.5),fx=-Math.sin(v.yaw),fz=-Math.cos(v.yaw),rx=Math.cos(v.yaw),rz=-Math.sin(v.yaw);
  stream.update({x:v.x,z:v.z,vx:fx*v.vLong+rx*v.vLat,vz:fz*v.vLong+rz*v.vLat,contacts:points,interest:worldTraffic.actors});
  if(!v.ground.ready(v,dt)){stats.holds++;return;}
  const old={x:v.x,y:v.y,z:v.z,yaw:v.yaw};v.ground.begin(v);
  try{v.update(dt,drive||(driver?driver(v,dt):input.state));}catch(e){Object.assign(v,old,{vLong:0,vLat:0,w:0});stats.missingContacts++;throw e;}
  worldTraffic.update(dt,v,[v]);const collisions=[];worldTraffic.collide({veh:v,kind:'player'},collisions,elapsed);stats.carHits+=collisions.length;
  barriers.resolve(v,old);stats.metres+=Math.hypot(v.x-old.x,v.z-old.z);elapsed+=dt;stats.simulationSeconds=elapsed;
 }
 function render(dt){
  const v=player.veh,o=stream.origin;v.place(player.model.root);player.model.root.position.x-=o.x;player.model.root.position.z-=o.z;player.model.update(dt,v.vLong,v.steer,input.state.brake>.2,v.pose,v.corners,v.w);
  player.model.setDamageSnapshot?.(v.damage);player.model.updateSurface?.(dt,v,settings.worldDetail!==false,false);worldTraffic.sync();
  const fx=-Math.sin(v.yaw),fz=-Math.cos(v.yaw),cock=cam==='cockpit';
  document.body.dataset.cameraView=cam;
  player.cockpit.setVisible(cock);player.cockpit.update(dt,{vehicle:v,ignition:true,manual:v.manual,rpm:v.rpm,redline:spec.redline,gear:v.gear,gearLabel:String(v.gear),kmh:v.kmh,steerInput:input.state.steer,handbrake:input.state.handbrake});
  // Held look-back (B): eased toward a half turn while held, released back to the road.
  lookBackA+=((input.state.lookBack?Math.PI:0)-lookBackA)*Math.min(1,dt*10);
  if(cock){const seat=seatPosition(spec.id);camera.position.copy(player.cockpit.eye);camera.position.y+=seat.height;camera.position.z-=seat.position;player.model.body.updateWorldMatrix(true,false);player.model.body.localToWorld(camera.position);player.model.body.getWorldQuaternion(camera.quaternion);camera.rotateX(player.cockpit.eyePitch??-.045);if(lookBackA>.001)camera.rotateY(lookBackA);}
  else if(cam==='chase'||cam==='far'){
   const yaw=v.yaw+lookBackA,bx=-Math.sin(yaw),bz=-Math.cos(yaw),rig=chaseRig(spec,clamp(Math.abs(v.vLong)*3.6/260,0,1.2)),scale=cam==='far'?1.55:1;
   camera.position.set(v.x-o.x-bx*rig.back*scale,v.y+rig.up*scale,v.z-o.z-bz*rig.back*scale);
   camera.lookAt(v.x-o.x+bx*5,v.y+rig.targetY,v.z-o.z+bz*5);
  }else{
   const forward=Math.max(1,(spec.length||4)*(cam==='bumper' ? .51 : .36));
   const height=cam==='bumper' ? clamp((spec.height||1.5)*.52,.68,1.05) : clamp((spec.height||1.5)*.85,1.18,2.5);
   camera.position.set(v.x-o.x+fx*forward,v.y+height,v.z-o.z+fz*forward);
   camera.lookAt(camera.position.x+fx*24,camera.position.y+.15,camera.position.z+fz*24);if(lookBackA>.001)camera.rotateY(lookBackA);
  }
  const near=cock?.05:.25;if(camera.near!==near){camera.near=near;camera.updateProjectionMatrix();}
  const fov=cock?settings.cockpitFov:62;if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}if(cameraHook)cameraHook(camera,v,o);sky.position.copy(camera.position);ENV.updateSun(sun,player.model.root.position);ENV.U.time.value=elapsed;SEA_TIME.value=elapsed;
  session.setInterest({player:v,actors:worldTraffic.actors});session.update(dt);session.updateView(camera);
  guidance?.update(v,o,performance.now());
  // In-car mirrors only (Settings > Graphics > Mirror: Off / Low / High), like the race render (src/main.js).
  const mirrorQ=mirrorQuality(settings.mirrors,gfx.perfClass);
  if(mirrorsInView(cam))player.cockpit.renderMirrors(renderer,scene,{enabled:mirrorQ!=='off',quality:mirrorQ});
  post.render(dt);
  const now=performance.now();freeRoamHud(dial,v,{spec,aidsOff:!settings.aids,tacho:now-hudAt>1000/30,map:now-mapAt>1000/15});if(now-hudAt>1000/30)hudAt=now;if(now-mapAt>1000/15)mapAt=now;
  drivingHints.update({state:paused?'paused':'race',blocked:towing||account.blocked,device:input.drivingSource,car:spec,manual:v.manual});document.getElementById('tRace').textContent=fmtTime(elapsed);
 }
 function tick(now){if(stopped)return;if(scripted){last=now;frameId=requestAnimationFrame(tick);return;}const cpu=performance.now(),delta=Math.min(.1,(now-last)/1000);stats.frameMs.push(now-last);if(stats.frameMs.length>900)stats.frameMs.shift();last=now;
  try{
   pollFreeRoam(input,delta,{speed:player.veh.vLong,menu,blocked:towing||account.blocked||document.hidden,action});
   applySteeringAssist(player.veh,input.drivingSource);
   stream.activateFrame();
   accumulator=Math.min(accumulator+delta,.1);while(accumulator>=1/240){step(1/240);accumulator-=1/240;}
   render(delta);stats.frames++;if(stats.frames%30===0){const m=inventory();if(m.gpu>resources.gpuBytes||m.js>resources.jsBytes)throw Error('Athens resource admission exceeded');}
  }catch(e){if(!menu.open)pause();document.getElementById('err').style.display='block';document.getElementById('err').textContent=e.message;console.error(e);}
  stats.cpuMs.push(performance.now()-cpu);if(stats.cpuMs.length>900)stats.cpuMs.shift();frameId=requestAnimationFrame(tick);
 }
 function dispose(){if(stopped)return;stopped=true;cancelAnimationFrame(frameId);offSettings();offGuidance();guidance?.dispose();player.cockpit?.disposeMirrors();worldTraffic?.dispose();session.dispose();renderer.dispose();}
 addEventListener('pagehide',dispose,{once:true});addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();post.setSize(innerWidth,innerHeight,gfx.pixelRatio);});
 document.addEventListener('visibilitychange',()=>{last=performance.now();accumulator=0;if(!document.hidden)void account.revalidate();});
 // Scripted measurement drive: wall-clock paced like a 30 fps game, optional sparse rendering.
 async function advance(seconds,{renderEvery=0,paceMs=1000/30}={}){
  const frames=Math.round(seconds*30);scripted=true;
  try{for(let f=0;f<frames&&!stopped;f++){
   const begin=performance.now();stream.activateFrame();
   for(let i=0;i<8;i++)step(1/240);
   if(renderEvery&&f%renderEvery===0){render(renderEvery/30);stats.frames++;}
   if(f%30===0)inventory();
   await new Promise(r=>setTimeout(r,Math.max(0,paceMs-(performance.now()-begin))));
  }}finally{scripted=false;last=performance.now();}
 }
 async function goto(id,x,z){towing=true;try{await stream.teleport({x,z},()=>{const p=stream.anchor(id);if(!p)throw Error('Unknown anchor '+id);place(player.veh,p);});}finally{towing=false;}}
 window.__athens={input,menu,get cameraMode(){return cam;},guidance,props,trees,signs,marks,horizon,landmarks,plazas,lawns,place:p=>place(player.veh,p),advance,goto,setDriver:fn=>{driver=fn;},setCameraHook:fn=>{cameraHook=fn;},stream,roads,barriers,obstacles,player,get traffic(){return worldTraffic.cars;},scene,renderer,camera,stats,inventory,tow,dispose,step,render,setPaused:value=>{paused=!!value;},get paused(){return paused;}};
 last=performance.now();frameId=requestAnimationFrame(tick);return window.__athens;
}
