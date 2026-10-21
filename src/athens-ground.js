import {Ground,SURF} from './ground.js';
import {WEATHER} from './wet-grip.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
/** Local coordinate adapter for the existing Vehicle. World-space wheel contact
 * always comes from active tile triangles, including independent bridge layers. */
export class AthensRoute{
 constructor(anchor){this.origin=anchor;this.height=anchor.y;this.nx=this.nz=0;this.length=1e7;this.GR=null;this.closed=false;}
 project(x,z){return {s:this.origin.z-z,u:x-this.origin.x};}
 point(s,u){return {x:this.origin.x+u,y:this.height,z:this.origin.z-s};}
 frame(s,o={}){return Object.assign(o,{tx:0,tz:-1,rx:1,rz:0,grade:-this.nz,bank:this.nx,mapped:true});}
 contactFrame(s,u,o){return this.frame(s,o);}
 y(){return this.height;}surfaceY(){return this.height;}urban(){return 1;}edge(){return 1e7;}medHalf(){return 0;}div(){return 0;}bank(){return this.nx;}lin(){return -this.nz;}
}
export class AthensGround{
 constructor(stream,route,barriers,obstacles){Object.assign(this,{stream,route,barriers,obstacles});this.referenceY=route.height;this.previous=null;this.holds=0;this.barrierHits=0;this.buildingHits=0;}
 begin(v){this.referenceY=v.y;this.previous={x:v.x,y:v.y,z:v.z,yaw:v.yaw};const c=this.stream.contact(v.x,v.z,{referenceY:v.y});if(c){if(!this.route.isWorldRoute){this.route.height=c.y;this.route.nx=c.nx;this.route.nz=c.nz;}}v._network=true;}
 footprint(v,extra=0){const points=[],fx=-Math.sin(v.yaw),fz=-Math.cos(v.yaw),rx=Math.cos(v.yaw),rz=-Math.sin(v.yaw),l=Math.max(v.halfL,3)+extra,w=v.halfW+extra;
  for(const along of [-l,0,l])for(const across of [-w,0,w])points.push({x:v.x+fx*along+rx*across,z:v.z+fz*along+rz*across});return points;
 }
 ready(v,dt){const speed=Math.hypot(v.vLong,v.vLat);return this.footprint(v,speed*dt+.25).every(p=>this.stream.readyAt(p.x,p.z));}
 at(x,z,s,u,out={}){
  const c=this.stream.contact(x,z,{referenceY:this.referenceY});if(!c)throw new Error('Missing mandatory Athens contact');
  const surf=c.y<-.05?'water':c.flags&1?'asphalt':'dirt';
  return Object.assign(out,c,{surf,water:Math.max(0,-.05-c.y),hump:0,network:true,planeY:c.y});
 }
 resolve(v,dt){
  this.closures?.resolve(v);for(const e of this.enrichments?.values()||[])e.resolve(v);
  if(this.barriers.resolve(v,this.previous))this.barrierHits++;
  this.previous={x:v.x,y:v.y,z:v.z,yaw:v.yaw}; // each substep sweeps from where the last one ended
  let fx=-Math.sin(v.yaw),fz=-Math.cos(v.yaw),rx=Math.cos(v.yaw),rz=-Math.sin(v.yaw);
  const radius=v.halfW+.05;
  for(const k of [v.halfL-radius,0,-v.halfL+radius]){
   const wall=this.obstacles.contact(v.x+fx*k,v.y,v.z+fz*k,radius);
   if(wall){Ground.prototype._hit.call(this,v,wall.nx,wall.nz,wall.pen,k,wall);this.buildingHits++;}
  }
  // A building impulse must not push the car through an adjacent bridge rail.
  if(this.barriers.resolve(v,this.previous))this.barrierHits++;
  this.previous={x:v.x,y:v.y,z:v.z,yaw:v.yaw};
  fx=-Math.sin(v.yaw);fz=-Math.cos(v.yaw);rx=Math.cos(v.yaw);rz=-Math.sin(v.yaw);
  const c=this.at(v.x,v.z),ys=[],surfaces=[];v.wheelBump||=[0,0,0,0];v.wheelMu||=[1,1,1,1];v.wheelPeak||=[1,1,1,1];v.wheelSlide||=[null,null,null,null];v.wheelSlideV||=[null,null,null,null];
  let mu=0,drag=0,res=0,soft=0;
  for(let i=0;i<4;i++){
   const a=i<2?v.a:-v.b,b=(i&1?1:-1)*v.track/2,q=this.at(v.x+fx*a+rx*b,v.z+fz*a+rz*b),surface=SURF[q.surf];ys.push(q.y);surfaces.push(q.surf);
   v.wheelBump[i]=0;const grip=surface.mu*(q.surf==='asphalt'?WEATHER.gripScale:1);
   v.wheelMu[i]=v.bodyDynamic?0:grip;v.wheelPeak[i]=surface.peak||1;v.wheelSlide[i]=surface.slide??null;v.wheelSlideV[i]=surface.slideV??null;
   mu+=grip/4;drag+=surface.drag/4;res+=(surface.res||0)/4;soft+=(surface.soft||0)/4;
  }
  v.gradeG=v.grade=clamp(((ys[0]+ys[1])-(ys[2]+ys[3]))/(2*v.wb),-.8,.8);
  v.bank=clamp(((ys[1]+ys[3])-(ys[0]+ys[2]))/(2*v.track),-.6,.6);
  v.resolveBodyContact(dt,Math.max(c.y,ys.reduce((a,b)=>a+b,0)/4),v.gradeG,v.bank);
  v.wheelSurf=surfaces;v.surf=c.surf;v.surfMu=v.bodyDynamic?0:mu;v.surfDrag=v.bodyDynamic?0:drag;v.surfRes=v.air?0:res;v.surfSoft=v.air?0:soft;v.surfBow=0;v.water=c.water;v._network=true;
  const q=this.route.project(v.x,v.z,{hint:v.s,referenceY:v.y,heading:v.yaw});v.s=q.s;v.u=q.u;v.routeContact={layer:c.layer,surfaceId:c.surfaceId};this.referenceY=v.y;
 }
}
