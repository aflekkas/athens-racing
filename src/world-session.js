import {estimateSceneMemory} from './asset-metrics.js';
// Single owner for streamed Athens contacts, graph, scene layers and interest. No driving loop.
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
import {AthensLandmarks,insideLandmark,forecourtPlazas} from './athens-landmarks.js';
import {AthensPlazas,plazaMaterial,lawnMaterial} from './athens-plazas.js';
import {AthensTrees} from './athens-trees.js';
import {AthensSigns} from './athens-signs.js';
import {AthensMarks} from './athens-marks.js';
import {DRESSING_VARIANTS} from './world-tile-dressing.js';
import {RouteRuntime} from './route-runtime.js';
import {planRouteInterest} from './route-stream-policy.js';
import {validateWorldDefinition} from './world-manifest.js';
export async function createWorldSession({renderer,scene,resources,progress=()=>{},worldDefinition={},signal}){
 const manifestURL=new URL(worldDefinition.manifestURL||'/data/athens/manifest.json',globalThis.location?.href||'http://localhost/');
 const manifest=worldDefinition.manifest||await fetch(manifestURL,{signal}).then(r=>{if(!r.ok)throw Error('Athens world unavailable');return r.json();});validateWorldDefinition({...worldDefinition,manifest});
 let stream,roads,route=null,ground=null,interest=null,plan=null,selectionToken=0,selectionAbort=null,pendingRouteId=null,disposed=false,inventoryFrames=0;const releases=[],tileListeners=new Set();
 const detailRoot=new THREE.Group();scene.add(detailRoot);
 const detail=new WorldDetail({id:'athens',terrain:{},data:{buildings:[],vegetation:[]},route:{length:0}},detailRoot,()=>0);
 const props=new AthensProps(detailRoot,{enabled:settings.worldDetail!==false,skip:(kind,x,z)=>settings.worldDetail!==false&&(kind===PROP_KINDS.monument||kind===PROP_KINDS.fountain)&&insideLandmark(x,z)}),horizon=new AthensHorizon(scene,scene.fog,{enabled:settings.worldDetail!==false}),landmarks=new AthensLandmarks(detailRoot,scene.fog,{enabled:settings.worldDetail!==false,groundAt:(x,z,y)=>{const c=stream?.contact(x,z,{referenceY:y,layer:0});return c?c.y:null;}}),boxRoots=new Set(),trees=new AthensTrees(detailRoot,{enabled:settings.worldDetail!==false}),signs=new AthensSigns(detailRoot,{enabled:settings.worldDetail!==false}),marks=new AthensMarks(detailRoot,{enabled:settings.worldDetail!==false}),lawns=new AthensPlazas(detailRoot,{enabled:settings.worldDetail!==false,material:lawnMaterial(),isRoad:(x,z,y)=>{const c=stream?.contact(x,z,{referenceY:y,layer:0});return !!c&&(c.flags&1)===1;},groundAt:(x,z,y)=>{const c=stream?.contact(x,z,{referenceY:y,layer:0});return c?c.y:null;}}),plazas=new AthensPlazas(detailRoot,{enabled:settings.worldDetail!==false,material:plazaMaterial(),extra:forecourtPlazas(),isRoad:(x,z,y)=>{const c=stream?.contact(x,z,{referenceY:y,layer:0});return !!c&&(c.flags&1)===1;},groundAt:(x,z,y)=>{const c=stream?.contact(x,z,{referenceY:y,layer:0});return c?c.y:null;}});
 // Buildings a landmark model replaces stay in their tile as hidden meshes; World detail Off shows the old boxes again.
 const syncBoxes=()=>{const hidden=settings.worldDetail!==false;for(const root of boxRoots)for(const c of root.children)if(c.userData.landmarkBox)c.visible=!hidden;};
 const obstacles=new WorldTileObstacles({detailEnabled:settings.worldDetail!==false});
 const unsubscribeProps=onSettings((s,key)=>{if(!key||key==='worldDetail'){obstacles.setDetailEnabled(s.worldDetail!==false);props.setEnabled(s.worldDetail!==false);horizon.setEnabled(s.worldDetail!==false);landmarks.setEnabled(s.worldDetail!==false);plazas.setEnabled(s.worldDetail!==false);lawns.setEnabled(s.worldDetail!==false);signs.setEnabled(s.worldDetail!==false);marks.setEnabled(s.worldDetail!==false);trees.setEnabled(s.worldDetail!==false);syncBoxes();}});
 horizon.load(new URL('./assets/athens/horizon.bin',document.baseURI)).catch(e=>console.warn(e.message));plazas.load(new URL('./assets/athens/plazas.json',document.baseURI)).catch(e=>console.warn(e.message));lawns.load(new URL('./assets/athens/lawns.json',document.baseURI)).catch(e=>console.warn(e.message));signs.load(new URL('./assets/athens/pois.json',document.baseURI)).catch(e=>console.warn(e.message));
 await loadAthensTextures(renderer);const sceneTiles=new WorldTileScene(scene,{renderer,materialFactory:athensMaterial}),barriers=new WorldTileBarriers();
 const activationSteps=[];
 const adapter={
  warmup:p=>sceneTiles.warmup(p),
  rebase(origin,previous){sceneTiles.rebase(origin,previous);detailRoot.position.set(-origin.x,0,-origin.z);},
  prepare(key,packet,origin){const build=sceneTiles.prepare(key,packet,origin);let installed=false,committed=false,disposed=false;
   const measured=(name,fn)=>{const at=performance.now();fn();const ms=performance.now()-at;if(ms>1){activationSteps.push({name,ms});if(activationSteps.length>64)activationSteps.shift();}};
   function cleanup(){if(disposed)return;disposed=true;if(committed)for(const l of tileListeners)l.removed?.(key);if(installed){roads.graph.remove(key);barriers.remove(key);obstacles.remove(key);detail.removeTile(key);props.removeTile(key);trees.removeTile(key);signs.removeTile(key);marks.removeTile(key);landmarks.removeTile(key);plazas.removeTile(key);lawns.removeTile(key);}for(const r of [...boxRoots])if(r.name==='tile:'+key)boxRoots.delete(r);build.dispose();}
   function* steps(){yield* build.steps;installed=true;
    if(manifest.tiles[key].contactEligible!==false)measured('graph',()=>roads.graph.install(key,packet));yield;
    barriers.install(key,packet);obstacles.install(key,packet);yield;
    detail.addRecords(key,[]);yield;
    for(const [name,layer]of [['props',props],['trees',trees],['signs',signs],['marks',marks]]){measured(name,()=>layer.addTile(key,packet));yield;}
    for(const [name,layer]of [['landmarks',landmarks],['plazas',plazas],['lawns',lawns]]){measured(name,()=>layer.addTile(key));yield;}
   }
   return{steps:steps(),commit(){try{const handle=build.commit();boxRoots.add(handle.root);for(const c of handle.root.children)if(c.userData.landmarkBox)c.visible=settings.worldDetail===false;committed=true;for(const l of tileListeners)l.activated?.(key);return handle;}catch(error){cleanup();throw error;}},dispose:cleanup};
  }
 };
 stream=new WorldTileStream(manifest,{...resources.stream,...worldDefinition.streamOptions,adapter,baseURL:manifestURL,activationMs:1.5,pinSpawn:false});roads=new WorldTileRoads(stream);

 const safeAbort=()=>{if(disposed||signal?.aborted)throw Error('World selection cancelled');};
 const releasePins=()=>{while(releases.length)releases.pop()();};
 const emit=(phase,text)=>{const required=plan?.requiredCells||[],active=required.filter(k=>stream.tiles.get(k)?.state==='active'),loaded=required.reduce((n,k)=>n+(stream.tiles.get(k)?.packet?manifest.tiles[k].bytes:0),0);progress(text,0,{worldId:'athens',routeId:pendingRouteId||route?.compiled.id,selectionToken,requiredCells:required,activeCells:active,loadedBytes:loaded,totalBytes:plan?.totalBytes||0,phase});};
 const safePose=(p,{halfWidth=1.1,halfLength=2.8}={})=>{if(!roads.safe({...p,edge:p.edgeId||p.edge},{halfWidth,halfLength,connected:true})||!barriers.safe(p,{halfWidth,halfLength}))return false;for(const a of [-halfLength+halfWidth,0,halfLength-halfWidth])if(obstacles.contact(p.x-Math.sin(p.yaw)*a,p.y,p.z-Math.cos(p.yaw)*a,halfWidth+.1))return false;return true;};
 const inventory=()=>{const sceneBytes=estimateSceneMemory(scene);let tileJS=0,tileGPU=0;for(const t of stream.tiles.values())if(t.packet){tileJS+=t.packet.jsBytes||0;tileGPU+=t.packet.gpuBytes||0;}const size=renderer.getDrawingBufferSize(new THREE.Vector2()),js=Math.max(performance.memory?.usedJSHeapSize||0,tileJS+sceneBytes.geometryBytes+sceneBytes.textureBytes),gpu=sceneBytes.gpuBytes+tileGPU+size.x*size.y*20+16*1024*1024;session.metrics.maxEstimatedJSBytes=Math.max(session.metrics.maxEstimatedJSBytes||0,js);session.metrics.maxEstimatedGPUBytes=Math.max(session.metrics.maxEstimatedGPUBytes||0,gpu);const result={jsBytes:js,gpuBytes:gpu,streamResidentBytes:stream.residentBytes,decoderReservationBytes:stream.transientBytes};if(js>resources.jsBytes||gpu>resources.gpuBytes)throw Object.assign(Error('World resource admission exceeded'),{detail:result});return result;};
 const session={inventory,safePose,subscribeTiles(listener){tileListeners.add(listener);for(const [k,t]of stream.tiles)if(t.state==='active')listener.activated?.(k);return()=>tileListeners.delete(listener);},stream,roads,barriers,obstacles,manifest,detail,props,trees,signs,marks,horizon,landmarks,plazas,lawns,sceneTiles,
 get ground(){return ground;},get route(){return route;},get selectionToken(){return selectionToken;},
 async prepareRoute(compiled,{cars=[],signal:routeSignal}={}){
  safeAbort();selectionAbort?.abort();const localAbort=selectionAbort=new AbortController();routeSignal?.addEventListener('abort',()=>localAbort.abort(),{once:true});if(routeSignal?.aborted)localAbort.abort();const token=++selectionToken;releasePins();pendingRouteId=compiled.id;if(compiled.worldSetRevision!==manifest.revision)throw Error('Route and world release differ');
  const prepared=new RouteRuntime(compiled),preparedGround=new AthensGround(stream,prepared,barriers,obstacles);
  prepared.contactAt=(x,z,o)=>stream.contact(x,z,o);
  prepared.contactAllowed=(q,p)=>{if(compiled.occurrences.some(o=>o.layer===p.layer&&o.surfaceId===p.surfaceId&&q.s>=o.s0-4&&q.s<=o.s1+4))return true;const e=roads.graph.edges.get(q.edgeId)?.value;if(!e||e.layer!==p.layer)return false;const pos=prepared.point(q.s),nodes=[e.points[0],e.points.at(-1)];if(!nodes.some(n=>Math.hypot(n[0]-pos.x,n[2]-pos.z)<=32))return false;return [...roads.graph.edges.values()].some(({value:v})=>v.surface===p.surfaceId&&v.layer===p.layer&&[e.from,e.to].some(n=>v.from===n||v.to===n));};
  plan=planRouteInterest({route:prepared,manifest,phase:'prepare',capBytes:stream.capBytes,transientBytes:stream.transientCap,sharedBytes:512*1024,generation:token});
  for(const k of plan.requiredCells)releases.push(stream.pin('route-start',k));
  const previous=interest?.player||stream.position;if(previous&&stream.entry(`${Math.floor(previous.x/512)},${Math.floor(previous.z/512)}`))releases.push(stream.pin('previous-safe',`${Math.floor(previous.x/512)},${Math.floor(previous.z/512)}`));
  const start=performance.now();emit('route','Preparing race');
  try{while(!plan.requiredCells.every(k=>stream.tiles.get(k)?.state==='active')){
   safeAbort();if(localAbort.signal.aborted||token!==selectionToken)throw Error('Route selection cancelled');if(performance.now()-start>180000)throw Error('Route start timed out');
   stream.update({...compiled.startPose,routeInterest:plan.routeInterest});stream.activateFrame();
   for(const k of plan.requiredCells){const t=stream.tiles.get(k);if(t?.state==='failed'&&t.attempts>=3)throw t.error;}
   emit(stream.inflight?'download':'activate',stream.inflight?'Loading start area':'Preparing roads');await new Promise(r=>requestAnimationFrame(r));
  }
  if(localAbort.signal.aborted||token!==selectionToken)throw Error('Route selection cancelled');
  await stream.spawnAtRoute(compiled.startPose,cars.map((c,i)=>({pose:compiled.grid[i]||compiled.startPose,halfWidth:(c.width||2.2)/2,halfLength:(c.length||5.6)/2})),()=>{}, {signal:localAbort.signal,validatePose:safePose});
  if(localAbort.signal.aborted||token!==selectionToken)throw Error('Route selection cancelled');
  for(const p of compiled.grid)if(!safePose({...p,edge:p.edgeId},{halfWidth:Math.max(1.1,...cars.map(c=>(c.width||2.2)/2)),halfLength:Math.max(2.8,...cars.map(c=>(c.length||5.6)/2)),connected:true}))throw Error('Route grid no longer safe');
  route=prepared;ground=preparedGround;pendingRouteId=null;emit('warm','Preparing roads');session.metrics.entryMs=performance.now()-start;session.metrics.initialWorldBytes=stream.pool?.downloadedBytes??stream.metrics.loadedBytes;session.metrics.mandatoryBytes=plan.totalBytes;return prepared;
  }catch(error){if(token===selectionToken){releasePins();emit('failed','Preparing race');}throw error;}
 },
 async prepareSpawn(point,{car={},signal:spawnSignal}={}){selectionAbort?.abort();++selectionToken;releasePins();route=null;await stream.teleport(point,()=>{}, {signal:spawnSignal||signal});const p=[...roads.anchors({validate:false})].filter(p=>roads.safe(p,{halfWidth:(car.width||2.2)/2,halfLength:(car.length||5.6)/2})).sort((a,b)=>Math.hypot(a.x-point.x,a.z-point.z)-Math.hypot(b.x-point.x,b.z-point.z))[0];if(!p)throw Error('No safe road near selection');route=new AthensRoute(p);ground=new AthensGround(stream,route,barriers,obstacles);return p;},
 setInterest(next){interest=next;},
 update(dt){if(!interest?.player||disposed)return;const p=interest.player;
  if(route?.isWorldRoute){if((interest.routeCursor?.s??p.s)>40)releasePins();plan=planRouteInterest({route,manifest,cursorS:interest.routeCursor?.s??p.s,speedMps:Math.abs(p.vLong||0),p95FetchDecodeSeconds:stream.metrics.p95FetchDecodeSeconds||1,player:{...p,footprint:ground.footprint(p,.5)},actors:interest.actors||[],capBytes:stream.capBytes,transientBytes:stream.transientCap,generation:selectionToken});}
  const fx=-Math.sin(p.yaw),fz=-Math.cos(p.yaw);stream.update({x:p.x,z:p.z,vx:fx*(p.vLong||0),vz:fz*(p.vLong||0),contacts:ground?.footprint(p,.5)||[],interest:(interest.actors||[]).filter(a=>Math.hypot(a.x-p.x,a.z-p.z)<=500),routeInterest:route?.isWorldRoute?plan?.routeInterest:[]});
  if(++inventoryFrames%120===0)inventory();
  detail.update({position:p});SEA_TIME.value=session.time+=dt;props.update({position:p},session.time);trees.update({position:p});signs.update({position:p});marks.update({position:p});
 },
 activateFrame(){stream.activateFrame();},
 updateView(camera){const o=stream.origin,ax=camera.position.x+o.x,az=camera.position.z+o.z;horizon.update(camera,ax,camera.position.y,az);landmarks.update(ax,camera.position.y,az,camera.far);plazas.update(ax,camera.position.y,az);lawns.update(ax,camera.position.y,az);},
 time:0,metrics:{activationSteps,entryMs:0,initialWorldBytes:0,mandatoryBytes:0,holds:0,missingContacts:0,p95FetchDecodeSeconds:1},
 dispose(){if(disposed)return;disposed=true;selectionAbort?.abort();++selectionToken;releasePins();stream.dispose();roads.dispose();barriers.dispose();obstacles.dispose();detail.dispose();unsubscribeProps();props.dispose();trees.dispose();signs.dispose();marks.dispose();horizon.dispose();landmarks.dispose();plazas.dispose();lawns.dispose();sceneTiles.dispose();detailRoot.removeFromParent();}
 };if(signal?.aborted){session.dispose();throw Error('World selection cancelled');}signal?.addEventListener('abort',()=>session.dispose(),{once:true});addEventListener('pagehide',()=>session.dispose(),{once:true});return session;
}
