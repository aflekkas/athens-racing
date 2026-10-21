import {RouteRuntime} from './route-runtime.js';
import {planRouteInterest} from './route-stream-policy.js';
/** Selection lifetime shared by the real streamed session and the headless cancellation fixtures. */
export function createWorldSelection({stream,manifest,makeGround,safePose,prepareEnrichments=async()=>{},progress=()=>{},onCommit=()=>{},onPlan=()=>{},metrics={},findSpawn,listeners=new Set(),signal,waitFrame=()=>new Promise(r=>requestAnimationFrame(r)),now=()=>performance.now()}){
 let route=null,ground=null,controller=null,token=0,disposed=false,pendingRouteId=null,plan=null;const releases=[];
 const releasePins=()=>{while(releases.length)releases.pop()();};
 const assertAlive=()=>{if(disposed||signal?.aborted)throw Error('World selection cancelled');};
 const begin=external=>{assertAlive();controller?.abort();controller=new AbortController();const local=controller,generation=++token,cancel=()=>local.abort();external?.addEventListener('abort',cancel,{once:true});if(external?.aborted)local.abort();releasePins();const release=()=>{if(generation===token)releasePins();};local.signal.addEventListener('abort',release,{once:true});return{local,generation,check(){assertAlive();if(local.signal.aborted||generation!==token)throw Error('World selection cancelled');},finish(){external?.removeEventListener('abort',cancel);local.signal.removeEventListener('abort',release);}};};
 const emit=(phase,text)=>{const required=plan?.requiredCells||[],active=required.filter(k=>stream.tiles.get(k)?.state==='active'),loaded=required.reduce((n,k)=>n+(stream.tiles.get(k)?.packet?manifest.tiles[k].bytes:0),0);progress(text,0,{worldId:'athens',routeId:pendingRouteId||route?.compiled.id,selectionToken:token,requiredCells:required,activeCells:active,loadedBytes:loaded,totalBytes:plan?.totalBytes||0,phase});};
 const selection={get route(){return route;},get ground(){return ground;},get token(){return token;},get listenerCount(){return listeners.size;},releasePins,
  subscribeTiles(listener){assertAlive();listeners.add(listener);for(const [k,t]of stream.tiles)if(t.state==='active')listener.activated?.(k);return()=>listeners.delete(listener);},
  async prepareRoute(compiled,{cars=[],signal:external}={}){
   const job=begin(external);pendingRouteId=compiled.id;
   try{
    if(compiled.worldSetRevision!==manifest.revision)throw Error('Route and world release differ');
    const footprint={halfWidth:Math.max(1.1,...cars.map(c=>(c.width||2.2)/2)),halfLength:Math.max(2.8,...cars.map(c=>(c.length||5.6)/2)),connected:true};
    if(route?.compiled.routeHash===compiled.routeHash&&plan?.requiredCells?.every(k=>stream.tiles.get(k)?.state==='active')&&compiled.grid.every(p=>safePose({...p,edge:p.edgeId},footprint))){
     for(const key of plan.requiredCells)releases.push(stream.pin('route-start',key));job.check();pendingRouteId=null;onCommit(route,ground);emit('warm','Preparing roads');Object.assign(metrics,{entryMs:0,initialWorldBytes:stream.pool?.downloadedBytes??stream.metrics.loadedBytes,mandatoryBytes:plan.totalBytes});return route;
    }
    const prepared=new RouteRuntime(compiled),preparedGround=makeGround(prepared);plan=planRouteInterest({route:prepared,manifest,phase:'prepare',capBytes:stream.capBytes,transientBytes:stream.transientCap,sharedBytes:512*1024,generation:job.generation});onPlan(plan);
    for(const key of plan.requiredCells)releases.push(stream.pin('route-start',key));const previous=stream.position;
    if(previous&&stream.entry(`${Math.floor(previous.x/512)},${Math.floor(previous.z/512)}`))releases.push(stream.pin('previous-safe',`${Math.floor(previous.x/512)},${Math.floor(previous.z/512)}`));
    const start=now();emit('route','Preparing race');
    // The route cells and the local visual recipe are independent requests. Start
    // the mandatory cell fetch before waiting for the recipe so both can prepare
    // during the same network round trip.
    stream.update({...compiled.startPose,routeInterest:plan.routeInterest});
    await prepareEnrichments(compiled.startPose);job.check();
    while(!plan.requiredCells.every(k=>stream.tiles.get(k)?.state==='active')){
     job.check();if(now()-start>180000)throw Error('Route start timed out');stream.update({...compiled.startPose,routeInterest:plan.routeInterest});stream.activateFrame();
     for(const k of plan.requiredCells){const t=stream.tiles.get(k);if(t?.state==='failed'&&t.attempts>=3)throw t.error;}
     emit(stream.inflight?'download':'activate',stream.inflight?'Loading start area':'Preparing roads');await waitFrame();
    }
    job.check();await stream.spawnAtRoute(compiled.startPose,cars.map((c,i)=>({pose:compiled.grid[i]||compiled.startPose,halfWidth:(c.width||2.2)/2,halfLength:(c.length||5.6)/2})),()=>{},{signal:job.local.signal,validatePose:safePose});job.check();
    for(const p of compiled.grid)if(!safePose({...p,edge:p.edgeId},footprint))throw Error('Route grid no longer safe');
    route=prepared;ground=preparedGround;pendingRouteId=null;onCommit(route,ground);emit('warm','Preparing roads');Object.assign(metrics,{entryMs:now()-start,initialWorldBytes:stream.pool?.downloadedBytes??stream.metrics.loadedBytes,mandatoryBytes:plan.totalBytes});return route;
   }catch(error){if(job.generation===token){releasePins();pendingRouteId=null;emit('failed','Preparing race');}throw error;}finally{job.finish();}
  },
  async prepareSpawn(point,{car={},signal:external}={}){const job=begin(external);try{await prepareEnrichments(point);job.check();await stream.teleport(point,()=>{},{signal:job.local.signal});job.check();const p=findSpawn?findSpawn(point,car):[...stream.roads.anchors({validate:false})].filter(p=>stream.roads.safe(p,{halfWidth:(car.width||2.2)/2,halfLength:(car.length||5.6)/2})).sort((a,b)=>Math.hypot(a.x-point.x,a.z-point.z)-Math.hypot(b.x-point.x,b.z-point.z))[0];if(!p)throw Error('No safe road near selection');job.check();route=null;ground=null;onCommit(null,null,p);return p;}finally{job.finish();}},
  dispose(){if(disposed)return;disposed=true;controller?.abort();++token;releasePins();listeners.clear();signal?.removeEventListener('abort',onAbort);}
 };const onAbort=()=>selection.dispose();if(signal?.aborted)selection.dispose();else signal?.addEventListener('abort',onAbort,{once:true});return selection;
}
