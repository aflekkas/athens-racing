import {projectEdge,edgePoint} from './route-geometry.js';
// Short kerb, verge and junction cuts are normal driving, not recovery events.
export const ROUTE_TOLERANCE = Object.freeze({ margin: 18, height: 3, seconds: 12, distance: 180 });
export class RouteNavigation {
 constructor(route){this.route=route;this.reset();}
 reset(){this.cursorS=0;this.offRoute=false;this.wrongWay=false;this.outT=this.inT=this.wrongT=this.outDistance=0;this.previousPosition=null;this.lastNotice=-Infinity;}
 update({dt,position,heading,speed,earnedS=0,time=0,contact}){let q=this.route.project(position.x,position.z,{hint:this.cursorS,referenceY:position.y,layer:contact?.layer,heading,maxTravel:Math.max(16,Math.abs(speed)*dt*2+8),continuityWeight:.05,headingWeight:4});
 // Navigation may reacquire after a tow or a long excursion. This cursor cannot
 // grant race progress; the course tracker retains its independent rejoin debt.
 if(!Number.isFinite(q.distance)||q.distance>Math.max(q.leftM||0,q.rightM||0)+3){const near=this.route.project(position.x,position.z,{hint:this.cursorS,referenceY:position.y,layer:contact?.layer,heading,maxTravel:Infinity});if(near.distance<q.distance)q=near;}
 const f=this.route.frame(q.s),physical=!!contact&&contact.layer===q.layer&&Math.abs(contact.y-q.y)<ROUTE_TOLERANCE.height&&(this.route.contactAllowed?this.route.contactAllowed(q,contact):contact.surfaceId===q.surfaceId),outside=!physical||q.u < -f.leftM-3||q.u>f.rightM+3,inside=physical&&q.u>=-f.leftM-2&&q.u<=f.rightM+2;
 const moved=this.previousPosition?Math.hypot(position.x-this.previousPosition.x,position.z-this.previousPosition.z):0;
 this.previousPosition={x:position.x,z:position.z};
 this.cursorS=q.s;this.outT=outside?this.outT+dt:0;this.outDistance=outside?this.outDistance+moved:0;this.inT=inside?this.inT+dt:0;
 if(this.outT>=ROUTE_TOLERANCE.seconds||this.outT>=3&&this.outDistance>=ROUTE_TOLERANCE.distance)this.offRoute=true;
 if(this.inT>=.3)this.offRoute=false;
 this.wrongT=q.headingDot<-.25&&speed>3?this.wrongT+dt:0;this.wrongWay=this.wrongT>=1.5;
 let notice=null;if((this.offRoute||this.wrongWay)&&time-this.lastNotice>=5){notice=this.wrongWay?'WRONG WAY':'RETURN TO ROUTE';this.lastNotice=time;}
 return{...q,offRoute:this.offRoute,wrongWay:this.wrongWay,notice,rejoinS:earnedS};}
}

/** Trim the legal graph path to its two actual positions; the target never advances earned progress. */
export function returnRoutePoints(path,graph){
 if(!path?.edges?.length||!path.start||!path.end)return null;const result=[];
 for(const [i,id]of path.edges.entries()){const edge=graph.edges.get(id)?.value;if(!edge)return null;const start=i===0?projectEdge(edge,path.start.x,path.start.z).offsetM:0,end=i===path.edges.length-1?projectEdge(edge,path.end.x,path.end.z).offsetM:Infinity;let s=0;const p=edgePoint(edge,start);result.push([p.x,p.y,p.z]);for(let j=1;j<edge.points.length;j++){s+=Math.hypot(...edge.points[j].map((v,k)=>v-edge.points[j-1][k]));if(s>start&&s<end)result.push(edge.points[j]);}if(Number.isFinite(end)){const p=edgePoint(edge,end);result.push([p.x,p.y,p.z]);}}
 return result;
}
