import {RouteGuidance} from '../route-guidance.js';
import {decisionPoints,projectRoute,sampleRoute,routeMetrics,cellKey} from './route.js';
import {drawGuidanceMinimap,streetPaths} from './minimap.js';
import {DEMO_ROUTE} from './demo-route.js';

/** Explicit development race-guidance preview, never enabled by ordinary free roam. */
export function createGuidanceDemo(scene,stream,roads){
  const route=routeMetrics(DEMO_ROUTE),visuals=new RouteGuidance(scene,{contact:(x,z,y,layer=0)=>stream.contact(x,z,{referenceY:y,layer,requiredFlags:1})});
  let paths=new Map(),decisions=[],dirty=true,disposed=false,timer=null,lastMap=-Infinity,lastProject=-Infinity,progress=0;
  const stats={updateMs:0,maxUpdateMs:0,decisionMs:0,updates:0};
  const timing=s=>{const p=sampleRoute(route,s);return {...p,yaw:Math.atan2(-p.tx,-p.tz),leftM:3,rightM:3,layer:0};};
  function setData(points){
    decisions=points.map((d,i)=>{const p=sampleRoute(route,d.s),a=sampleRoute(route,Math.max(0,d.s-6));return {
      id:`guidance-demo:${i}:${d.node||'bend'}`,s:d.s,x:p.x,y:p.y,z:p.z,layer:0,
      fromEdge:'',viaNode:d.node||'',toEdge:'',occurrence:i,
      incoming:[a.tx,a.tz],outgoing:[p.tx,p.tz],turn:Math.abs(d.angle)<.44?'straight':d.angle>0?'right':'left',
      rejectedEdges:d.wrong.map(e=>e.edge),cell:cellKey(p.x,p.z)};});
    if(visuals.data){visuals.data={...visuals.data,decisions};visuals.paint.setDecisions(decisions);return;}
    visuals.setRoute({version:1,routeId:'guidance-demo',geometryHash:'development-preview',worldId:'athens',regionId:'basin',closed:true,lengthM:route.length,
      polyline:route.points.map((p,i)=>({...p,s:route.stations[i],leftM:3,rightM:3,edgeId:'',occurrence:i,layer:0,cell:cellKey(p.x,p.z)})),
      decisions,start:timing(0),finish:timing(route.length)});
  }
  setData(decisionPoints(DEMO_ROUTE));
  function refresh(){timer=null;if(disposed)return;const start=performance.now();setData(decisionPoints(DEMO_ROUTE,roads.graph));paths=streetPaths(roads.graph);stats.decisionMs=performance.now()-start;}
  return {visuals,stats,route,get paint(){return visuals.paint;},get decisions(){return decisions;},get progress(){return progress;},
    spawnPose(){for(const s of [8,16,24,32]){const p=sampleRoute(route,s),c=stream.contact(p.x,p.z,{referenceY:p.y,layer:0,requiredFlags:1});if(!c)continue;
      const n=roads.graph.nearest(p.x,p.z,{referenceY:c.y,layer:0,maxDistance:2});if(!n)continue;
      const pose={...n,y:c.y,yaw:Math.atan2(-p.tx,-p.tz)};if(roads.safe(pose))return pose;}return null;},
    addCell(key){visuals.onTileActivated(key);dirty=true;},removeCell(key){visuals.onTileRemoved(key);dirty=true;},
    update(car,origin,now){const start=performance.now();
      // Topology is prepared after a stream transaction, outside the render callback.
      if(dirty&&!timer){dirty=false;timer=setTimeout(refresh,0);}
      if(now-lastProject>=100){progress=projectRoute(route,car,progress).s;lastProject=now;}
      visuals.update({cursorS:progress,occurrence:0,lap:0,position:car,heading:car.yaw,origin,isRace:true});
      if(now-lastMap>=100){drawGuidanceMinimap(document.getElementById('minimap'),paths,route,progress,decisions,car);lastMap=now;}
      const ms=performance.now()-start;stats.updateMs+=(ms-stats.updateMs)/++stats.updates;stats.maxUpdateMs=Math.max(stats.maxUpdateMs,ms);
    },dispose(){disposed=true;clearTimeout(timer);visuals.dispose();paths.clear();}};
}
export {DEMO_ROUTE};
