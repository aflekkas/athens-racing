import {observeCourse,courseComplete} from './course.js';
// Nearby rivals retain native Vehicle/RivalAI physics. Distant cursors follow ONLY compiled occurrences.
// A distant actor owns no contact pins and can rehydrate only outside the visible 500 m bubble.
export class RouteRivals {
 constructor(route,{seed=1,nearM=500,hideM=650}={}){Object.assign(this,{route,seed,nearM,hideM});}
 pose(c,s){const f=this.route.frame(s),margin=(c.veh.halfW||1)+.25,u=Math.max(-f.leftM+margin,Math.min(f.rightM-margin,c.distantLane||0));return {...this.route.point(s,u),s,u,yaw:f.yaw,layer:f.layer,surfaceId:f.surfaceId,edgeId:f.edgeId};}
 update(dt,cars,player,{ready,safe,step,now=0}){
  for(const [i,c]of cars.slice(0,2).entries()){
   const v=c.veh,distance=Math.hypot(v.x-player.x,v.z-player.z);
   if(!c.distant&&distance>this.hideM){c.distant=true;c.distantS=v.s;c.distantSpeed=Math.max(1,Math.abs(v.vLong));c.distantLane=(i?1:-1)*.4;c.model.root.visible=false;if(c.far)c.far.root.visible=false;}
   if(c.distant){
    const p=this.pose(c,c.distantS),d=Math.hypot(p.x-player.x,p.z-player.z);
    if(d>this.nearM&&d<this.hideM&&ready({...v,...p})&&safe(p,{halfWidth:v.halfW,halfLength:v.halfL})&&!cars.some(other=>other!==c&&Math.hypot(other.veh.x-p.x,other.veh.z-p.z)<8)){
     Object.assign(v,p,{vLong:c.distantSpeed,vLat:0,w:0});v.syncWheels?.();c.distant=false;c.model.root.visible=true;continue;
    }
    // Do not materialise or move a hidden logical cursor through the visible bubble.
    if(d<=this.nearM)continue;
    const target=c.finish!=null?0:Math.max(2,Math.min(32,c.ai?.controller?.profile?.[Math.floor(this.route.wrap(c.distantS)/(c.ai.controller.line.step||4))]||16));
    c.distantSpeed+=Math.max(-4*dt,Math.min(2*dt,target-c.distantSpeed));
    const travel=Math.max(0,c.distantSpeed*dt),n=Math.max(1,Math.ceil(travel/2));
    for(let j=0;j<n;j++){c.distantS+=travel/n;const next=this.pose(c,c.distantS);Object.assign(v,next);if(c.finish==null){observeCourse(c.course,next,now-dt+dt*(j+1)/n,{route:this.route});if(courseComplete(c.course))c.finish=c.course.finishedAt??now;}}
   }else if(ready(v))step(c,dt);
  }
 }
 interests(cars,player){return cars.filter(c=>!c.distant&&Math.hypot(c.veh.x-player.x,c.veh.z-player.z)<=this.hideM).map(c=>({...c.veh,routeS:c.veh.s,halfWidth:c.veh.halfW,halfLength:c.veh.halfL}));}
}
