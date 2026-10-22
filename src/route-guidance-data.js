import {RouteRuntime} from './route-runtime.js';
import {cellKey} from './route-geometry.js';
import {decisionPoints} from './route-guidance/route.js';
export function buildRouteGuidanceData(compiled){const route=new RouteRuntime(compiled),polyline=compiled.points.map(([x,y,z,s,leftM,rightM])=>{const o=route.edgeAt(s);return{x,y,z,s,leftM,rightM,edgeId:o.edgeId,occurrence:o.occurrence,layer:o.layer,cell:cellKey(x,z)};}),line=(pose,s)=>{const f=route.frame(s);return{...pose,s,leftM:f.leftM,rightM:f.rightM};};
 const decisions=compiled.decisions.map(d=>{const i=compiled.occurrences.findIndex(o=>o.s0===d.s&&o.edgeId===d.toEdge),p=route.point(d.s),a=route.frame(d.s-.05),b=route.frame(d.s+.05),angle=Math.atan2(a.tx*b.tz-a.tz*b.tx,a.tx*b.tx+a.tz*b.tz);return{id:`${compiled.id}:${i}:${d.viaNode}`,s:d.s,...p,layer:b.layer,fromEdge:d.fromEdge,viaNode:d.viaNode,toEdge:d.toEdge,occurrence:i,incoming:[a.tx,a.tz],outgoing:[b.tx,b.tz],turn:Math.abs(angle)>Math.PI*.8?'uturn':Math.abs(angle)<25*Math.PI/180?'straight':angle>0?'right':'left',rejectedEdges:[...d.rejected],cell:cellKey(p.x,p.z)};});
 // Compiled decisions describe graph junctions. A hairpin inside one edge is
 // still a visual turn, without becoming a progress gate or a graph exit.
 for(const d of decisionPoints(polyline))if(!decisions.some(j=>Math.abs(j.s-d.s)<18)){
  const p=route.point(d.s),a=route.frame(d.s-12),b=route.frame(d.s+12),o=route.edgeAt(d.s);
  decisions.push({id:`${compiled.id}:bend:${d.s}`,s:d.s,...p,layer:o.layer,occurrence:o.occurrence,incoming:[a.tx,a.tz],outgoing:[b.tx,b.tz],turn:d.angle>0?'right':'left',rejectedEdges:[],cell:cellKey(p.x,p.z)});
 }
 decisions.sort((a,b)=>a.s-b.s);
 return{version:1,routeId:compiled.id,geometryHash:compiled.geometryHash,worldId:compiled.worldId,regionId:compiled.regionId,closed:route.closed,lengthM:route.length,polyline,decisions,start:line(compiled.startPose,0),finish:line(compiled.finishPose,route.length)};
}
