import {RouteGuidance} from '../route-guidance.js';
import {cellKey,decisionPoints} from './route.js';

// The old Quick Race loader has no streamed GuidanceDataV1. Adapt only its
// selected event, in driving order; keep paint on the driver's carriageway.
export function legacyGuidanceData(map,event,junctions=[]){
  const route=map.route,dir=event.dir||1,lengthM=event.closed?route.length:Math.abs(event.s1-event.s0);
  const at=s=>route.point(event.s0+dir*s,route.closed?0:dir*route.laneU(event.s0+dir*s,0));
  const polyline=[];
  for(let s=0;s<lengthM;s+=4)polyline.push({...at(s),s});
  polyline.push({...at(lengthM),s:lengthM});
  const decisions=decisionPoints(polyline);
  const add=station=>{
    let s=(station-event.s0)*dir;if(event.closed)s=((s%lengthM)+lengthM)%lengthM;
    if(s<8||s>lengthM-8||decisions.some(d=>Math.abs(d.s-s)<18))return;
    decisions.push({s,point:at(s),source:'junction',wrong:[]});
  };
  for(const j of junctions)add(j.s);
  // Unsignalised mouths also need a forward cue at the choice of exits.
  for(const road of map.data.sideRoads||[]){
    if(road.f)continue;
    for(let i=0;i<road.p.length;i+=2){const q=route.project(road.p[i],road.p[i+1]);if(Math.abs(q.u)<=route.edge(q.s)+1.5){add(q.s);break;}}
  }
  return {version:1,routeId:map.id,closed:!!event.closed,lengthM,polyline,decisions:decisions.sort((a,b)=>a.s-b.s),paintTiming:false};
}

export function createLegacyGuidance(scene,map,event,junctions,ground){
  const data=legacyGuidanceData(map,event,junctions),route=map.route;
  const guidance=new RouteGuidance(scene,{contact:(x,z,referenceY)=>{
    const q=route.project(x,z),c=ground.at(x,z,q.s,q.u);
    return c.surf==='asphalt'&&Math.abs(c.y-referenceY)<2?c:null;
  }});
  guidance.setRoute(data);
  for(const p of data.polyline)guidance.onTileActivated(cellKey(p.x,p.z));
  return guidance;
}
