import {normalizeRouteDefinition,RouteError,sha256,canonicalJSON} from './route-definition.js';
import {edgeValue,edgeLength,edgePoint,projectEdge,allowedTurn,cellKey} from './route-geometry.js';
import {roadLayersConnect} from './world-tile-graph.js';
const fail=(def,code,detail={})=>{throw new RouteError(code,{routeId:def.id,...detail});};
const outgoing=(g,node)=>[...(g.outgoing.get(node)||[])].sort().map(id=>edgeValue(g,id));
function snapped(def,g,p){const choices=[];for(const id of g.edges.keys()){const e=edgeValue(g,id);if(e.layer!==p.layer||e.flags&8)continue;const q=projectEdge(e,p.x,p.z);if(q.distance<=p.snapM&&q.tx*-Math.sin(p.headingRad)+q.tz*-Math.cos(p.headingRad)>=.5)choices.push(q);}choices.sort((a,b)=>a.distance-b.distance||a.edge.localeCompare(b.edge));if(!choices.length)fail(def,'waypoint-unsnapped',{point:p});if(choices[1]&&choices[1].distance<=choices[0].distance+Math.max(.05,choices[0].distance*.01))fail(def,'waypoint-ambiguous',{candidates:choices.slice(0,4)});return choices[0];}
function shortest(def,g,a,b,history){
 if(a.edge===b.edge&&b.offsetM>a.offsetM)return [a.edge];
 const first=edgeValue(g,a.edge),last=edgeValue(g,b.edge),queue=[{edge:first,path:[first.id],cost:edgeLength(first)-a.offsetM}],visits=new Map(),found=[];let steps=0;
 while(queue.length&&steps++<50000){queue.sort((a,b)=>b.cost-a.cost||b.path.join().localeCompare(a.path.join()));const q=queue.pop();if(found[0]&&q.cost>found[0].cost*1.01+1e-8)break;
  if(q.edge.to===last.from&&allowedTurn(def,g,q.edge,last,[...history,...q.path])){const cost=q.cost+b.offsetM;found.push({path:[...q.path,last.id],cost});found.sort((a,b)=>a.cost-b.cost);if(found.length>1&&found[1].cost<=found[0].cost*1.01)fail(def,'path-ambiguous',{candidates:found.slice(0,2)});}
  for(const e of outgoing(g,q.edge.to)){if(!allowedTurn(def,g,q.edge,e,[...history,...q.path]))continue;const cost=q.cost+edgeLength(e),key=e.id+'|'+q.path.slice(-8).join(),seen=visits.get(key)||[];if(seen.length>=2&&cost>=seen[1])continue;seen.push(cost);seen.sort((a,b)=>a-b);visits.set(key,seen.slice(0,2));queue.push({edge:e,path:[...q.path,e.id],cost});}
 }
 if(!found.length)fail(def,'path-disconnected',{edgeId:a.edge,toEdge:b.edge});return found[0].path;
}
export function resolveRoutePath(input,graph){const def=normalizeRouteDefinition(input);if(def.path.edges)return [...def.path.edges];const snaps=def.path.waypoints.map(p=>snapped(def,graph,p)),path=[];for(let i=1;i<snaps.length;i++){const leg=shortest(def,graph,snaps[i-1],snaps[i],path);path.push(...(path.at(-1)===leg[0]?leg.slice(1):leg));}if(path[0]!==def.start.edgeId||path.at(-1)!==def.finish.edgeId)fail(def,'waypoint-endpoint');return path;}
function extend(def,g,e,offset,distance,backward,routeIds=null){const result=[],seen=new Set();let remaining=distance,at=offset,index=backward?0:(routeIds?.length||1)-1;
 while(remaining>1e-6){if(seen.size>1000)fail(def,'runout-disconnected',{edgeId:e.id});seen.add(e.id);const len=edgeLength(e),take=Math.min(remaining,backward?at:len-at),begin=backward?at-take:at,end=backward?at:at+take,pts=[];for(let s=begin;s<end;s+=4)pts.push(edgePoint(e,s));pts.push(edgePoint(e,end));if(backward)result.unshift(...pts);else result.push(...pts);remaining-=take;if(remaining<=1e-6)break;
 const previous=e,candidates=backward?[...g.edges.keys()].map(id=>edgeValue(g,id)).filter(p=>p.to===e.from&&allowedTurn(def,g,p,e,[])):outgoing(g,e.to).filter(n=>allowedTurn(def,g,e,n,[]));
 const tangent=edgePoint(e,backward?0:len);candidates.sort((a,b)=>{const aa=edgePoint(a,backward?edgeLength(a):0),bb=edgePoint(b,backward?edgeLength(b):0);return (bb.tx*tangent.tx+bb.tz*tangent.tz)-(aa.tx*tangent.tx+aa.tz*tangent.tz)||a.id.localeCompare(b.id);});
 if(routeIds){index+=backward?-1:1;if(index<0)index=routeIds.length-2;if(index>=routeIds.length)index=1;e=candidates.find(n=>n.id===routeIds[index]);}
 else e=candidates.find(n=>!seen.has(n.id));
 if(!e)fail(def,backward?'runin-disconnected':'runout-disconnected',{edgeId:previous.id});const a=backward?e.points.at(-1):previous.points.at(-1),b=backward?previous.points[0]:e.points[0];if(Math.hypot(...a.map((v,i)=>v-b[i]))>.025)fail(def,'runout-contact-seam',{edgeId:e.id});at=backward?edgeLength(e):0;
 }return result;
}
export async function routeGeometryHash(c){return sha256({ruleVersion:'route-progress-width-v1',occurrences:c.occurrences,points:c.points,startPose:c.startPose,finishPose:c.finishPose,grid:c.grid,runIn:c.runIn,runOut:c.runOut,decisions:c.decisions,sectorsM:c.sectorsM,...(c.closures?.length?{closures:c.closures}:{}),direction:c.definition.events.some(e=>e.reverse)?'with-reverse':'forward'});}
// A quantized portal boundary may be owned by its adjoining approach. Only
// that exact continuous structure node (2.5 cm) may supply the boundary height;
// every interior sample must still prove the selected edge's physical layer.
function routeSurfaceContact(p,e,graph,contacts){
 const direct=contacts.contact(p.x,p.z,{referenceY:p.y,layer:e.layer,requiredFlags:1});if(direct)return direct;
 if(![e.points[0],e.points.at(-1)].some(a=>Math.hypot(a[0]-p.x,a[2]-p.z)<=.025))return null;
 for(const id of graph.edges.keys()){
  const n=edgeValue(graph,id);if(n.layer===e.layer||!(roadLayersConnect(n,e)||roadLayersConnect(e,n)))continue;
  const boundary=contacts.contact(p.x,p.z,{referenceY:p.y,layer:n.layer,requiredFlags:1});
  if(boundary&&Math.abs(boundary.y-p.y)<=.025&&contacts.surfaceAllowed(n,boundary))return {...boundary,layer:e.layer,surfaceId:e.surface};
 }
 return null;
}
export async function compileRoute(input,graph,contacts,{worldSetRevision=contacts?.worldSetRevision,closures=new Set(),halfWidth=1.1,halfLength=2.8,compileReverse=true}={}){
 const def=normalizeRouteDefinition(input),ids=resolveRoutePath(def,graph),occurrences=[],points=[],decisions=[],towAnchors=[],referenced=new Map(),cells=new Set();let s=0;
 if(!/^[a-f0-9]{64}$/.test(worldSetRevision||''))fail(def,'world-revision-unavailable');if(!contacts?.contact||!contacts?.width||!contacts?.safe)fail(def,'contacts-unavailable');
 for(const id of def.closureIds)if(!closures.has(id))fail(def,'unknown-closure',{closureId:id});
 if(ids[0]!==def.start.edgeId||ids.at(-1)!==def.finish.edgeId)fail(def,'endpoint-edge');
 const sample=(p,e,i,footprint=false)=>{const cell=cellKey(p.x,p.z),detail={occurrence:i,edgeId:e.id,cell};if(!contacts.eligible?.(cell))fail(def,'missing-contact-cell',detail);cells.add(cell);const c=routeSurfaceContact(p,e,graph,contacts);if(!c||!(c.flags&1)||c.layer!==e.layer||!contacts.surfaceAllowed(e,c))fail(def,'contact-mismatch',{...detail,actualSurface:c?.surfaceId,expectedSurface:e.surface});const width=contacts.width({...p,y:c.y,edge:e.id,surfaceId:c.surfaceId},{connected:true});if(!width||width.left+width.right<2*(halfWidth+.15))fail(def,'unsafe-corridor',detail);const q={...p,y:c.y,leftM:width.left,rightM:width.right,surfaceId:c.surfaceId};if(footprint&&!contacts.safe(q,{halfWidth,halfLength,connected:true}))fail(def,'unsafe-grid-footprint',detail);return q;};
 for(let i=0;i<ids.length;i++){
  const e=edgeValue(graph,ids[i]);if(!e)fail(def,'missing-edge',{occurrence:i,edgeId:ids[i]});referenced.set(e.id,e);if(e.flags&8)fail(def,'access-forbidden',{occurrence:i,edgeId:e.id});const len=edgeLength(e),fromM=i===0?def.start.offsetM:0,toM=i===ids.length-1?def.finish.offsetM:len;
  if(fromM>len||toM>len||toM<=fromM)fail(def,'edge-offset',{occurrence:i,edgeId:e.id});
  const prev=i?edgeValue(graph,ids[i-1]):null;if(prev){if(prev.to!==e.from)fail(def,'disconnected-portal',{occurrence:i,edgeId:e.id});if(!roadLayersConnect(prev,e))fail(def,'wrong-layer',{occurrence:i,edgeId:e.id});if(!allowedTurn(def,graph,prev,e,ids.slice(0,i)))fail(def,'illegal-successor',{occurrence:i,edgeId:e.id});if(Math.hypot(...prev.points.at(-1).map((v,k)=>v-e.points[0][k]))>.025)fail(def,'contact-seam',{occurrence:i,edgeId:e.id});}
  const offsets=[fromM,toM];let at=0;for(let j=1;j<e.points.length;j++){at+=Math.hypot(...e.points[j].map((v,k)=>v-e.points[j-1][k]));if(at>fromM&&at<toM)offsets.push(at);}offsets.sort((a,b)=>a-b);const samples=[];for(let j=1;j<offsets.length;j++){const a=offsets[j-1],b=offsets[j],n=Math.ceil((b-a)/4);for(let k=0;k<n;k++)samples.push(a+(b-a)*k/n);}samples.push(toM);
  const owned=new Set(),surfaceRuns=[];for(const station of samples){const p=sample(edgePoint(e,station),e,i),distance=s+station-fromM;owned.add(cellKey(p.x,p.z));if(surfaceRuns.at(-1)?.surfaceId!==p.surfaceId)surfaceRuns.push({fromM:station,s0:distance,surfaceId:p.surfaceId});const point=[p.x,p.y,p.z,distance,p.leftM,p.rightM];if(points.length&&Math.abs(points.at(-1)[3]-distance)<1e-7)points[points.length-1]=point;else points.push(point);if(station>fromM+3&&station<toM-3&&(!towAnchors.length||distance-(towAnchors.at(-1).s??0)>=40)&&contacts.safe(p,{halfWidth,halfLength,connected:true}))towAnchors.push({id:`${def.id}:tow:${i}:${Math.round(station)}`,x:p.x,y:p.y,z:p.z,yaw:p.yaw,edgeId:e.id,layer:e.layer,s:distance});}
  for(let j=0;j<surfaceRuns.length;j++){const r=surfaceRuns[j],end=surfaceRuns[j+1]?.fromM??toM;if(end<=r.fromM+1e-6)continue;occurrences.push({edgeId:e.id,fromM:r.fromM,toM:end,s0:r.s0,s1:s+end-fromM,surfaceId:r.surfaceId,layer:e.layer,cells:[...owned].sort()});}
  if(prev){const incoming=edgePoint(prev,edgeLength(prev)),out=edgePoint(e,0),rejected=outgoing(graph,e.from).filter(q=>q.id!==e.id&&!(q.flags&8)&&graph.legal(prev.id,q,ids.slice(0,i))).map(q=>q.id);const angle=Math.atan2(incoming.tx*out.tz-incoming.tz*out.tx,incoming.tx*out.tx+incoming.tz*out.tz);if(rejected.length||Math.abs(angle)>=25*Math.PI/180)decisions.push({s,fromEdge:prev.id,viaNode:e.from,toEdge:e.id,rejected});}
  s+=toM-fromM;
 }
 // Contact-conformed 3D distances own runtime timing; graph offsets retain their authoring identity.
 const stations=points.map(p=>p[3]);let physical=0;for(let i=0;i<points.length;i++){if(i)physical+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1],points[i][2]-points[i-1][2]);points[i][3]=physical;}
 const mapStation=q=>{let i=stations.findIndex(v=>v>=q-1e-7);if(i<0)return physical;if(!i)return points[0][3];const f=(q-stations[i-1])/(stations[i]-stations[i-1]);return points[i-1][3]+(points[i][3]-points[i-1][3])*f;};
 for(const o of occurrences){o.s0=mapStation(o.s0);o.s1=mapStation(o.s1);}for(const d of decisions)d.s=mapStation(d.s);s=physical;
 if(Math.abs(s-def.lengthM)>Math.max(2,def.lengthM*.005))fail(def,'length-mismatch',{declared:def.lengthM,actual:s});if(def.sectorsM.some(d=>d>=s))fail(def,'sector-range');
 const resolvePose=(spec,index)=>{const e=edgeValue(graph,spec.edgeId),p=edgePoint(e,spec.offsetM);p.x+=p.rx*spec.lateralM;p.z+=p.rz*spec.lateralM;if(Math.cos(spec.yawRad-p.yaw)<Math.cos(5*Math.PI/180))fail(def,'pose-heading',{occurrence:index,edgeId:e.id});const q=sample(p,e,index,true);return{x:q.x,y:q.y,z:q.z,yaw:spec.yawRad,edgeId:e.id,layer:e.layer};};
 const startPose=resolvePose(def.start,0),finishPose=resolvePose(def.finish,ids.length-1);
 if(def.kind==='circuit'&&(Math.hypot(startPose.x-finishPose.x,startPose.z-finishPose.z,startPose.y-finishPose.y)>.25||Math.cos(startPose.yaw-finishPose.yaw)<Math.cos(5*Math.PI/180)))fail(def,'circuit-closure');
 const circuitIds=def.kind==='circuit'?ids:null;
 const runInPoints=extend(def,graph,edgeValue(graph,ids[0]),def.start.offsetM,80,true,circuitIds),runOutPoints=extend(def,graph,edgeValue(graph,ids.at(-1)),def.finish.offsetM,151,false,circuitIds);
 const proveRun=(arr,footprint=false)=>arr.map(p=>{const e=edgeValue(graph,p.edge);referenced.set(e.id,e);const q=sample(p,e,-1,footprint);return[q.x,q.y,q.z];});
 const runIn=proveRun(runInPoints),runOut=proveRun(runOutPoints,true),grid=[];for(const p of [...points.map(p=>[p[0],p[1],p[2]]),...runIn,...runOut])for(const dx of [-31.99999,0,31.99999])for(const dz of [-31.99999,0,31.99999]){const key=cellKey(p[0]+dx,p[2]+dz);if(!contacts.eligible(key))fail(def,'missing-contact-cell',{cell:key});cells.add(key);}const count=Math.max(...def.events.map(e=>e.rivals))+1;
 for(let i=0;i<count;i++){let remain=(i+1)*8,found;for(let j=runInPoints.length-1;j>0;j--){const a=runInPoints[j-1],b=runInPoints[j],d=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);if(remain<=d){const f=1-remain/d;found={...a,x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f,yaw:Math.atan2(a.x-b.x,a.z-b.z)};break;}remain-=d;}if(!found)fail(def,'grid-runin');found.x+=found.rx*def.start.lateralM;found.z+=found.rz*def.start.lateralM;const q=sample(found,edgeValue(graph,found.edge),-1,true);grid.push({x:q.x,y:q.y,z:q.z,yaw:q.yaw,edgeId:q.edge,layer:q.layer});}
 const compiled={schemaVersion:1,id:def.id,revision:def.revision,worldId:def.worldId,regionId:def.regionId,routeHash:'',geometryHash:'',graphDigest:'',worldSetRevision,definition:def,lengthM:s,occurrences,points,startPose,finishPose,grid,cells:[...cells].sort(),decisions,sectorsM:[...def.sectorsM],towAnchors:towAnchors.map(({s,...a})=>a),runIn,runOut,...(def.closureIds.length?{closures:def.closureIds.map(id=>closures.get?.(id)).filter(Boolean)}:{})};
 compiled.graphDigest=await sha256({edges:[...referenced].sort(([a],[b])=>a.localeCompare(b)),restrictions:contacts.restrictions||[...(graph.turns?.values()||[])].map(v=>v.value||v).filter(t=>referenced.has(t.from)||t.sequence?.some(id=>referenced.has(id))),contactSources:contacts.sourceHashes?.(compiled.cells)||[]});compiled.geometryHash=await routeGeometryHash(compiled);compiled.routeHash=await sha256({definition:def,geometryHash:compiled.geometryHash,worldSetRevision});
 if(new TextEncoder().encode(canonicalJSON(compiled)).length>2*1024*1024)fail(def,'compiled-size');
 if(def.allowReverse&&compileReverse){const reversed=ids.toReversed().map(id=>{const e=edgeValue(graph,id),candidates=[...graph.edges.keys()].map(k=>edgeValue(graph,k)).filter(q=>q.from===e.to&&q.to===e.from&&q.surface===e.surface&&q.layer===e.layer&&!(q.flags&8));if(candidates.length!==1)fail(def,'reverse-edge-unavailable',{edgeId:id});return candidates[0];});const a=reversed[0],b=reversed.at(-1),reverseDef={...def,allowReverse:false,path:{edges:reversed.map(e=>e.id)},start:{edgeId:a.id,offsetM:edgeLength(a)-def.finish.offsetM,lateralM:-def.finish.lateralM,yawRad:edgePoint(a,edgeLength(a)-def.finish.offsetM).yaw},finish:{edgeId:b.id,offsetM:edgeLength(b)-def.start.offsetM,lateralM:-def.start.lateralM,yawRad:edgePoint(b,edgeLength(b)-def.start.offsetM).yaw},events:def.events.map(e=>({...e,reverse:false}))};compiled.reverse=await compileRoute(reverseDef,graph,contacts,{worldSetRevision,closures,halfWidth,halfLength,compileReverse:false});}
 return compiled;
}
