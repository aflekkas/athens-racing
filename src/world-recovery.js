import {edgePoint,edgeLength,projectEdge} from './route-geometry.js';
import {planWorldTow} from './tow-placement.js';
import {carOverlap} from './crash-contact.js';
/** Bounded loaded-graph candidates used by native races and the development entry. */
export function worldTowCandidates(session,pose,{halfWidth=1.1,halfLength=2.8,actors=[],radius=160}={}){
 const out=[],roads=session.roads;
 for(const {value:edge}of roads.graph.edges.values()){
  if(edge.flags&8)continue;const nearest=projectEdge(edge,pose.x,pose.z);if(!nearest||nearest.distance>radius)continue;
  for(const slide of [0,4,-4,8,-8,16,-16,24,-24,40,-40]){
   const offset=nearest.offsetM+slide;if(offset<0||offset>edgeLength(edge))continue;const p=edgePoint(edge,offset),contact=session.stream.contact(p.x,p.z,{referenceY:p.y,layer:edge.layer,requiredFlags:1});if(!contact)continue;p.y=contact.y;p.surfaceId=contact.surfaceId;
   const width=roads.width(p,{connected:true,radius:32,bounded:true});if(!width)continue;const twin=[...(roads.graph.outgoing.get(edge.to)||[])].find(id=>{const e=roads.graph.edges.get(id)?.value;return e&&!(e.flags&8)&&e.to===edge.from&&e.layer===edge.layer&&e.surface===edge.surface;}),u=(width.right-width.left)/2+(twin?width.width/4:0);p.x+=p.rx*u;p.z+=p.rz*u;const c=session.stream.contact(p.x,p.z,{referenceY:p.y,layer:edge.layer,requiredFlags:1});if(!c)continue;Object.assign(p,{y:c.y,edgeId:edge.id,surfaceId:c.surfaceId});
   if(!session.safePose(p,{halfWidth,halfLength})||actors.some(a=>Math.hypot(a.x-p.x,a.z-p.z)<12&&carOverlap({...p,halfL:halfLength,halfW:halfWidth},a)))continue;
   if(twin)p.roadId=[edge.id,twin].sort().join('|');out.push(p);
  }
 }
 return out;
}
export function worldRecoveryTarget(session,pose,{course=null,route=session.route,...options}={}){return planWorldTow({pose,course,route,roadCandidates:worldTowCandidates(session,pose,options)});}
