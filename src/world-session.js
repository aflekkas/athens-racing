import {PenteliHouses} from './penteli-houses.js';
import {WorldRegionalScenerySet} from './world-regional-scenery.js';
import {roadLayersConnect} from './world-tile-graph.js';
import {worldRecoveryTarget} from './world-recovery.js';
import {createWorldSelection} from './world-selection.js';
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
import {validateWorldDefinition,loadWorldDefinition} from './world-manifest.js';
export async function createWorldSession({renderer,scene,resources,progress=()=>{},worldDefinition={},signal}){
 // Base scans and manifests are independent. Keep their I/O parallel, then
 // gate shader preparation on uploads rather than delaying contact admission.
 const startsRegional=['penteli','megara'].includes(worldDefinition.regionId),texturesReady=loadAthensTextures(renderer,{penteli:startsRegional});texturesReady.catch(()=>{});
 const manifestURL=new URL(worldDefinition.manifestURL||'/data/athens/manifest.json',globalThis.location?.href||'http://localhost/');
 const manifest=worldDefinition.manifest||(await loadWorldDefinition(manifestURL,{signal})).manifest;validateWorldDefinition({...worldDefinition,manifest});
 let stream,roads,route=null,ground=null,interest=null,plan=null,selection=null,disposed=false,inventoryFrames=0,plannedRoute=null,plannedS=-Infinity,planAge=0;const tileListeners=new Set(),enrichments=new Map();
 const detailRoot=new THREE.Group();scene.add(detailRoot);
 const houses=new PenteliHouses(detailRoot,{enabled:settings.worldDetail!==false});
 const detail=new WorldDetail({id:'athens',terrain:{},data:{buildings:[],vegetation:[]},route:{length:0}},detailRoot,()=>0);
 const props=new AthensProps(detailRoot,{enabled:settings.worldDetail!==false,skip:(kind,x,z)=>settings.worldDetail!==false&&(kind===PROP_KINDS.monument||kind===PROP_KINDS.fountain)&&insideLandmark(x,z)}),horizon=new AthensHorizon(scene,scene.fog,{enabled:settings.worldDetail!==false}),landmarks=new AthensLandmarks(detailRoot,scene.fog,{enabled:settings.worldDetail!==false,groundAt:(x,z,y)=>{const c=stream?.contact(x,z,{referenceY:y,layer:0});return c?c.y:null;}}),boxRoots=new Set(),trees=new AthensTrees(detailRoot,{enabled:settings.worldDetail!==false}),signs=new AthensSigns(detailRoot,{enabled:settings.worldDetail!==false}),marks=new AthensMarks(detailRoot,{enabled:settings.worldDetail!==false}),lawns=new AthensPlazas(detailRoot,{enabled:settings.worldDetail!==false,material:lawnMaterial(),isRoad:(x,z,y)=>{const c=stream?.contact(x,z,{referenceY:y,layer:0});return !!c&&(c.flags&1)===1;},groundAt:(x,z,y)=>{const c=stream?.contact(x,z,{referenceY:y,layer:0});return c?c.y:null;}}),plazas=new AthensPlazas(detailRoot,{enabled:settings.worldDetail!==false,material:plazaMaterial(),extra:forecourtPlazas(),isRoad:(x,z,y)=>{const c=stream?.contact(x,z,{referenceY:y,layer:0});return !!c&&(c.flags&1)===1;},groundAt:(x,z,y)=>{const c=stream?.contact(x,z,{referenceY:y,layer:0});return c?c.y:null;}});
 // Buildings a landmark model replaces stay in their tile as hidden meshes; World detail Off shows the old boxes again.
 const syncBoxes=()=>{const hidden=settings.worldDetail!==false;for(const root of boxRoots)for(const c of root.children)if(c.userData.landmarkBox)c.visible=!hidden;};
 const obstacles=new WorldTileObstacles({detailEnabled:settings.worldDetail!==false});
 const unsubscribeProps=onSettings((s,key)=>{if(!key||key==='worldDetail'){if(s.worldDetail!==false)loadAthensTextures(renderer,{penteli:true}).catch(error=>console.warn('Regional texture preparation',error));obstacles.setDetailEnabled(s.worldDetail!==false);props.setEnabled(s.worldDetail!==false);horizon.setEnabled(s.worldDetail!==false);landmarks.setEnabled(s.worldDetail!==false);plazas.setEnabled(s.worldDetail!==false);lawns.setEnabled(s.worldDetail!==false);signs.setEnabled(s.worldDetail!==false);marks.setEnabled(s.worldDetail!==false);trees.setEnabled(s.worldDetail!==false);houses.setEnabled(s.worldDetail!==false);syncBoxes();}});
 horizon.load(new URL('./assets/athens/horizon.bin',document.baseURI)).catch(e=>console.warn(e.message));plazas.load(new URL('./assets/athens/plazas.json',document.baseURI)).catch(e=>console.warn(e.message));lawns.load(new URL('./assets/athens/lawns.json',document.baseURI)).catch(e=>console.warn(e.message));signs.load(new URL('./assets/athens/pois.json',document.baseURI)).catch(e=>console.warn(e.message));
 // A composed world can contain distant regions. Load their texture library
 // only when a cell from that region is admitted, before its shader warmup.
 // The unified game (including mirrors) draws world meshes into linear render
 // targets. Only the final post quad draws to the canvas; its world variants
 // would double startup compilation without being used by a race frame.
 const sceneTiles=new WorldTileScene(scene,{renderer,materialFactory:athensMaterial,warmCanvas:false}),barriers=new WorldTileBarriers();
 // These shared basin programs are start readiness, independent of which
 // neighbouring cell first supplies a facade, coastal rock or water mesh.
 // Warm them before countdown so optional admission cannot trigger first-use
 // driver work during the countdown or the first seconds of driving.
 const commonPrograms=startsRegional?Promise.resolve():texturesReady.then(()=>sceneTiles.warmVariants(DRESSING_VARIANTS));commonPrograms.catch(()=>{});
 let regionalTextures=startsRegional?texturesReady:null;
 const regionalScenery=new WorldRegionalScenerySet(scene,{trees});const activationSteps=[];
 const adapter={
  warmup:async p=>{await commonPrograms;await texturesReady;if([p.metadata.regionalScenery?.surface,...p.metadata.meshes.map(m=>m.userData?.tileSurface)].some(surface=>/^(penteli|megara)/.test(surface||'')))await(regionalTextures??=loadAthensTextures(renderer,{penteli:true}));await Promise.all([sceneTiles.warmup(p),regionalScenery.prepare(p.metadata.regionalScenery)]);},
  rebase(origin,previous){sceneTiles.rebase(origin,previous);regionalScenery.rebase(origin);detailRoot.position.set(-origin.x,0,-origin.z);},
  prepare(key,packet,origin){const build=sceneTiles.prepare(key,packet,origin);let installed=false,committed=false,disposed=false;
   const measured=(name,fn)=>{const at=performance.now();fn();const ms=performance.now()-at;if(ms>1){activationSteps.push({name,ms});if(activationSteps.length>64)activationSteps.shift();}};
   function cleanup(){if(disposed)return;disposed=true;if(committed)for(const l of tileListeners)l.removed?.(key);if(installed){roads.graph.remove(key);barriers.remove(key);obstacles.remove(key);detail.removeTile(key);regionalScenery.remove(key);props.removeTile(key);trees.removeTile(key);houses.removeTile(key);signs.removeTile(key);marks.removeTile(key);landmarks.removeTile(key);plazas.removeTile(key);lawns.removeTile(key);}for(const r of [...boxRoots])if(r.name==='tile:'+key)boxRoots.delete(r);build.dispose();}
   function* steps(){yield* build.steps;installed=true;
    if(manifest.tiles[key].contactEligible!==false)yield* roads.graph.installSteps(key,packet);yield;
    barriers.install(key,packet);obstacles.install(key,packet);yield;
    detail.addRecords(key,packet.metadata.authoredDetail||[]);regionalScenery.add(key,packet.metadata.regionalScenery);yield;
    for(const [name,layer]of [['houses',houses],['props',props],['trees',trees],['signs',signs],['marks',marks]]){if(layer.addTileSteps)yield* layer.addTileSteps(key,packet);else measured(name,()=>layer.addTile(key,packet));yield {stage:name};}
    for(const [name,layer]of [['landmarks',landmarks],['plazas',plazas],['lawns',lawns]]){measured(name,()=>layer.addTile(key));yield {stage:name};}
   }
   return{steps:steps(),commit(){try{const handle=build.commit();boxRoots.add(handle.root);for(const c of handle.root.children)if(c.userData.landmarkBox)c.visible=settings.worldDetail===false;committed=true;for(const l of tileListeners)l.activated?.(key);return handle;}catch(error){cleanup();throw error;}},dispose:cleanup};
  }
 };
 stream=new WorldTileStream(manifest,{...resources.stream,...worldDefinition.streamOptions,adapter,capBytes:(worldDefinition.streamOptions?.capBytes||resources.stream.capBytes)-(manifest.regionResidentBytes||0),baseURL:manifestURL,activationMs:.75,pinSpawn:false});roads=new WorldTileRoads(stream);

 const safeAbort=()=>{if(disposed||signal?.aborted)throw Error('World selection cancelled');};
 const safePose=(p,{halfWidth=1.1,halfLength=2.8}={})=>{if([...enrichments.values()].some(e=>!e.safe(p,{halfWidth,halfLength})))return false;if(session.closures?.safe(p,{halfWidth,halfLength})===false)return false;if(!roads.safe({...p,edge:p.edgeId||p.edge,surfaceId:p.surfaceId||stream.contact(p.x,p.z,{referenceY:p.y,layer:p.layer,requiredFlags:1})?.surfaceId},{halfWidth,halfLength,connected:true})||!barriers.safe(p,{halfWidth,halfLength}))return false;for(const a of [-halfLength+halfWidth,0,halfLength-halfWidth])if(obstacles.contact(p.x-Math.sin(p.yaw)*a,p.y,p.z-Math.cos(p.yaw)*a,halfWidth+.1))return false;return true;};
 const inventory=()=>{const sceneBytes=estimateSceneMemory(scene);let tileJS=0,tileGPU=0;for(const t of stream.tiles.values())if(t.packet){tileJS+=t.packet.jsBytes||0;tileGPU+=t.packet.gpuBytes||0;}const size=renderer.getDrawingBufferSize(new THREE.Vector2()),js=Math.max(performance.memory?.usedJSHeapSize||0,tileJS+sceneBytes.geometryBytes+sceneBytes.textureBytes)+regionalScenery.cachedBytes,gpu=sceneBytes.gpuBytes+tileGPU+size.x*size.y*20+16*1024*1024;session.metrics.maxEstimatedJSBytes=Math.max(session.metrics.maxEstimatedJSBytes||0,js);session.metrics.maxEstimatedGPUBytes=Math.max(session.metrics.maxEstimatedGPUBytes||0,gpu);const result={jsBytes:js,gpuBytes:gpu,streamResidentBytes:stream.residentBytes,decoderReservationBytes:stream.transientBytes};if(js>resources.jsBytes||gpu>resources.gpuBytes)throw Object.assign(Error('World resource admission exceeded'),{detail:result});return result;};
 const session={inventory,safePose,
 warmOptional(){if(route?.isWorldRoute)stream.update({...route.compiled.startPose,routeInterest:plan?.routeInterest||[]});},
 async prepareEnrichments(point){for(const spec of manifest.enrichments||[]){if(enrichments.has(spec.kind)||point.x<spec.bounds[0]-400||point.x>spec.bounds[2]+400||point.z<spec.bounds[1]-400||point.z>spec.bounds[3]+400)continue;if(spec.kind!=='psychiko-streetscape-v1')throw Error('Unknown world detail recipe');const response=await fetch(spec.url,{signal});if(!response.ok)throw Error('World detail unavailable');const data=await response.json();safeAbort();if(data.sourceMapSha256!==spec.sourceMapSha256)throw Error('World detail release mismatch');const {WorldPsychikoDetail}=await import('./world-psychiko-detail.js');safeAbort();enrichments.set(spec.kind,new WorldPsychikoDetail(session,scene,data));}},
 subscribeTiles:listener=>selection.subscribeTiles(listener),stream,roads,barriers,obstacles,manifest,detail,props,trees,signs,marks,horizon,landmarks,plazas,lawns,sceneTiles,
 get tileListenerCount(){return selection.listenerCount;},get ground(){return ground;},get route(){return route;},get selectionToken(){return selection.token;},
 prepareRoute:(compiled,options)=>selection.prepareRoute(compiled,options),
 prepareSpawn:(point,options)=>selection.prepareSpawn(point,options),
 setInterest(next){interest=next;},
 update(dt){if(!interest?.player||disposed)return;const p=interest.player;
  if(route?.isWorldRoute){const cursorS=interest.routeCursor?.s??p.s;if(cursorS>40)selection.releasePins();planAge+=dt;if(plannedRoute!==route||Math.abs(cursorS-plannedS)>=16||planAge>=.5){plan=planRouteInterest({route,manifest,cursorS,speedMps:Math.abs(p.vLong||0),p95FetchDecodeSeconds:stream.metrics.p95FetchDecodeSeconds||1,player:{...p,footprint:ground.footprint(p,.5)},actors:interest.actors||[],capBytes:stream.capBytes,transientBytes:stream.transientCap,generation:selection.token});plannedRoute=route;plannedS=cursorS;planAge=0;}}
  const fx=-Math.sin(p.yaw),fz=-Math.cos(p.yaw);stream.update({x:p.x,z:p.z,vx:fx*(p.vLong||0),vz:fz*(p.vLong||0),contacts:ground?.footprint(p,.5)||[],interest:(interest.actors||[]).filter(a=>Math.hypot(a.x-p.x,a.z-p.z)<=500),routeInterest:route?.isWorldRoute?plan?.routeInterest:[]});
  if(++inventoryFrames%120===0)inventory();
  for(const e of enrichments.values())e.update(p);detail.update({position:p});SEA_TIME.value=session.time+=dt;props.update({position:p},session.time);trees.update({position:p});houses.update({position:p});signs.update({position:p});marks.update({position:p});
 },
 activateFrame(){stream.activateFrame();},
 updateView(camera){const o=stream.origin,ax=camera.position.x+o.x,az=camera.position.z+o.z;regionalScenery.view(camera);trees.view(camera,o);horizon.setEnabled(settings.worldDetail!==false&&!regionalScenery.has(ax,az));horizon.update(camera,ax,camera.position.y,az);landmarks.update(ax,camera.position.y,az,camera.far);plazas.update(ax,camera.position.y,az);lawns.update(ax,camera.position.y,az);},
 time:0,metrics:{activationSteps,entryMs:0,initialWorldBytes:0,mandatoryBytes:0,holds:0,missingContacts:0,p95FetchDecodeSeconds:1},
 dispose(){if(disposed)return;disposed=true;removeEventListener('pagehide',onPageHide);signal?.removeEventListener('abort',onSessionAbort);selection.dispose();for(const e of enrichments.values())e.dispose();enrichments.clear();stream.dispose();roads.dispose();barriers.dispose();obstacles.dispose();detail.dispose();regionalScenery.dispose();unsubscribeProps();props.dispose();trees.dispose();houses.dispose();signs.dispose();marks.dispose();horizon.dispose();landmarks.dispose();plazas.dispose();lawns.dispose();sceneTiles.dispose();detailRoot.removeFromParent();tileListeners.clear();}
 };stream.roads=roads;
 selection=createWorldSelection({stream,manifest,signal,listeners:tileListeners,metrics:session.metrics,progress,prepareEnrichments:p=>session.prepareEnrichments(p),safePose,
  findSpawn:(p,car)=>worldRecoveryTarget(session,{...p,y:p.y??0,yaw:p.yaw??0},{route:null,halfWidth:(car.width||2.2)/2,halfLength:(car.length||5.6)/2}),
  makeGround(prepared){prepared.contactAt=(x,z,o)=>stream.contact(x,z,o);prepared.contactAllowed=(q,p)=>{if(compiledSurfaces(prepared,q,p))return true;const e=roads.graph.edges.get(q.edgeId)?.value;if(!e)return false;const pos=prepared.point(q.s);if(e.layer===p.layer&&roads.publicSurfaces(e.layer).has(p.surfaceId))return true;if(e.layer!==p.layer)return [...roads.graph.edges.values()].some(({value:n})=>n.layer===p.layer&&n.surface===p.surfaceId&&(roadLayersConnect(n,e)||roadLayersConnect(e,n))&&[e.points[0],e.points.at(-1)].some(a=>Math.hypot(a[0]-pos.x,a[2]-pos.z)<=.15));if(![e.points[0],e.points.at(-1)].some(n=>Math.hypot(n[0]-pos.x,n[2]-pos.z)<=32))return false;return [...roads.graph.edges.values()].some(({value:v})=>v.surface===p.surfaceId&&v.layer===p.layer&&[e.from,e.to].some(n=>v.from===n||v.to===n));};const g=new AthensGround(stream,prepared,barriers,obstacles);g.enrichments=enrichments;return g;},
  onPlan:p=>{plan=p;},onCommit(r,g,p){route=r||new AthensRoute(p);ground=g||new AthensGround(stream,route,barriers,obstacles);ground.enrichments=enrichments;}
 });
 function compiledSurfaces(r,q,p){const s=r.closed?r.wrap(q.s):q.s;return r.compiled.occurrences.some(o=>o.layer===p.layer&&o.surfaceId===p.surfaceId&&s>=o.s0-4&&s<=o.s1+4);}
 const onSessionAbort=()=>session.dispose();const onPageHide=()=>session.dispose();if(signal?.aborted){session.dispose();throw Error('World selection cancelled');}signal?.addEventListener('abort',onSessionAbort,{once:true});addEventListener('pagehide',onPageHide,{once:true});return session;
}
