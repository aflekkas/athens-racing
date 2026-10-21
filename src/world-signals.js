import {edgeLength,edgePoint} from './route-geometry.js';
import {signalState,CYCLE,RED0,STOP_OFF} from './signal-plan.js';
import {crossTimingLine} from './route-timing.js';

// The tile-owned OSM heads are the only signal authority. No native map pack,
// duplicate heads, decorative glow, or dependency on the World detail toggle.
export class WorldSignals {
 constructor(session,route){Object.assign(this,{session,route});this.J=[];this.t=0;this.revision=-1;}
 update(){
  this.t=this.session.props.time;const revision=this.session.roads.graph.revision;
  if(revision!==this.revision||this.signalCount!==this.session.props.byEdge.size||this.cachedRoute!==this.route){this.revision=revision;this.signalCount=this.session.props.byEdge.size;this.cachedRoute=this.route;this.J=[];
  for(const rec of this.session.props.byEdge.values()){
   const edge=this.session.roads.graph.edges.get(rec.edge)?.value;if(!edge)continue;
   const point=edgePoint(edge,Math.max(0,edgeLength(edge)-STOP_OFF));
   const q=this.route.project(point.x,point.z,{referenceY:point.y,layer:edge.layer});
   if(q.edgeId!==edge.id||q.distance>1)continue;
   this.J.push({i:rec.edge,sF:q.s,sO:q.s,s:q.s,rec,point,edge});
  }
  this.J.sort((a,b)=>a.sF-b.sF);}
  for(const j of this.J){const {group,offset}=j.rec,phase=((this.t+offset)%CYCLE+CYCLE)%CYCLE;j.main=signalState(group,offset,this.t);j.left=group===0?(phase<16?16-phase:phase<RED0?RED0-phase:CYCLE-phase):(phase<20?20-phase:phase<25.5?25.5-phase:CYCLE-phase);j.redT=group===0?phase-RED0:phase;j.toGreen=j.main==='G'?0:group===0?CYCLE-phase:(20-phase+CYCLE)%CYCLE;}
 }
 next(front,dir=1){return dir>0?this.J.find(j=>j.sF>front)||null:null;}
 stopFor(front,dir,speed,memo,decel=3){
  const j=this.next(front,dir);if(!j)return null;const d=j.sF-front;
  if(d>170||j.main==='G'){if(memo.sigJ===j.i)memo.sigJ=null;return null;}
  if(memo.sigJ!==j.i){memo.sigJ=j.i;memo.sigGo=j.main==='A'?d<speed*speed/(2*decel)+1.5&&d/Math.max(1,speed)<j.left+.6||d<speed*speed/14:d<.6;}
  return memo.sigGo?null:d;
 }
 crossed(previous,current){
  if(!previous||Math.hypot(current.x-previous.x,current.z-previous.z)>20)return null;
  const bumper=p=>({...p,x:p.x-Math.sin(p.yaw)*(p.halfL||0),z:p.z-Math.cos(p.yaw)*(p.halfL||0)});
  for(const j of this.J){
   if(j.main!=='R'||j.redT<=.3||j.toGreen<=.3||Math.hypot(j.point.x-current.x,j.point.z-current.z)>25)continue;
   const width=this.session.roads.width(j.point,{connected:true,bounded:true,radius:32});if(!width)continue;
   if(crossTimingLine(bumper(previous),bumper(current),{...j.point,leftM:width.left,rightM:width.right}))return j;
  }
  return null;
 }
}
