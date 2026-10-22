import {roadLayersConnect} from './world-tile-graph.js';
import {Traffic} from './traffic.js';
import {edgePoint,projectEdge,edgeLength} from './route-geometry.js';
import {resolveCarPair,bodyOffset,carOverlap} from './crash-contact.js';
import {HeatMachine,policeTuning,pursuit} from './police.js';
import {events} from './events.js';
import {prewarmFleet} from './fleet-prewarm.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
/** A legal civilian successor may leave the selected race. No route-successor shortcut. */
export function trafficSuccessors(graph,edge,closures){return [...(graph.outgoing.get(edge.to)||[])].map(id=>graph.edges.get(id)?.value).filter(e=>e&&roadLayersConnect(edge,e)&&graph.legal(edge.id,e)&&!closures?.blocksEdge(e));}
export class WorldTraffic {
 constructor(session,scene,route,{closures}={}){Object.assign(this,{session,scene,route,closures});this.pool=null;this.cars=[];this.widthCache=new Map();this.sites=[];this.level=0;this.disabled=true;this.t=0;this.spawnT=0;this.hm=new HeatMachine();this.policeEnabled=false;this.wrecks=[];this.honks=[];this.sounds=[];}
 configure(def,{deferFleet=false}={}){this.definition=def;this.level=clamp(def.traffic??0,0,2);this.disabled=this.level===0;this.policeEnabled=def.rules?.police===true;this.tuning=policeTuning(def.rules?.policeLevel,def.rules?.busted);this.hm=new HeatMachine(this.tuning);this.crossedRed=null;this.spawnT=0;this.widthCache.clear();
  if(!deferFleet&&(this.level>0||this.policeEnabled)&&!this.pool){this.pool=new Traffic(this.scene,{closed:true},{},{poolSize:24,policePoolSize:5,roadVehiclesOnly:true});this.cars=this.pool.cars;}
  for(const c of this.cars){if(c.police)c.cop||={};c.active=false;c.crashed=false;c.m.root.visible=false;c.point=null;c.vehicle=null;}
  Object.assign(pursuit,{enabled:this.policeEnabled,state:this.policeEnabled?'idle':'off',heat:0,level:0,bustMeter:0,evadeMeter:0,units:0});
 }
 async warmFleet(ready=()=>true){
  if(this.pool||!this.definition||!(this.level>0||this.policeEnabled))return;
  if(this.fleetWarming)return this.fleetWarming;
  const pool=this.warmingPool=new Traffic(this.scene,{closed:true},{},{poolSize:24,policePoolSize:5,roadVehiclesOnly:true,deferBuild:true,buildProxies:false});
  this.fleetWarmMetrics={maxStepMs:0};this.fleetController=new AbortController();
  this.fleetWarming=prewarmFleet(pool.build,{ready,disposed:()=>this.disposed,signal:this.fleetController.signal,metrics:this.fleetWarmMetrics}).then(()=>{this.pool=pool;this.cars=pool.cars;this.configure(this.definition);}).catch(error=>{releaseFleet(pool);throw error;}).finally(()=>{this.warmingPool=null;this.fleetWarming=null;this.fleetController=null;});
  return this.fleetWarming;
 }
 candidate(edge,offset,c){const p=edgePoint(edge,offset),key=edge.id+':'+Math.floor(offset/4)+':'+c.wid+':'+c.len,cached=this.widthCache.get(key),width=cached||this.session.roads.width(p,{radius:32,bounded:true,connected:true});if(!width)return null;
  const twins=[...(this.session.roads.graph.outgoing.get(edge.to)||[])].map(id=>this.session.roads.graph.edges.get(id)?.value).some(e=>e?.to===edge.from);
  const u=(width.right-width.left)/2+(twins?width.width/4:0);p.x+=p.rx*u;p.z+=p.rz*u;const contact=this.session.stream.contact(p.x,p.z,{referenceY:p.y,layer:edge.layer,requiredFlags:1});if(!contact)return null;p.y=contact.y;p.surfaceId=contact.surfaceId;p.edge=edge.id;p.edgeId=edge.id;
  if(!cached){if(!this.session.safePose(p,{halfWidth:c.wid/2,halfLength:c.len/2})||this.closures?.safe(p,{halfWidth:c.wid/2,halfLength:c.len/2})===false)return null;if(this.widthCache.size>=4096)this.widthCache.delete(this.widthCache.keys().next().value);this.widthCache.set(key,width);}
  for(const a of [-c.len/2,0,c.len/2])for(const b of [-c.wid/2,0,c.wid/2])if(!this.session.stream.contact(p.x-Math.sin(p.yaw)*a+Math.cos(p.yaw)*b,p.z-Math.cos(p.yaw)*a-Math.sin(p.yaw)*b,{referenceY:p.y,layer:edge.layer,requiredFlags:1}))return null;return p;
 }
 spawn(player,actors){if(!this.pool)return;const count=this.cars.filter(c=>c.active&&!c.police).length,copCount=this.cars.filter(c=>c.active&&c.police).length,needCop=this.policeEnabled&&copCount<Math.min(this.tuning.maxUnits,this.hm.active?1+this.hm.level:2);
  if(!needCop&&count>=Math.round(this.level*12))return;
  const c=needCop?this.cars.find(c=>c.police&&!c.active):this.pool.pickFree(c=>!c.type.bus&&!c.type.scooter);if(!c)return;
  const graph=this.session.roads.graph,edges=[...graph.edges.values()].map(e=>e.value).filter(e=>!(e.flags&8)&&!this.closures?.blocksEdge(e));
  for(let i=0;i<Math.min(80,edges.length);i++){const edge=edges[Math.floor(this.pool.rng.next()*edges.length)],p=this.candidate(edge,edgeLength(edge)*.5,c);if(!p)continue;const d=Math.hypot(p.x-player.x,p.z-player.z);if(d<160||d>450||[...actors,...this.cars.filter(q=>q.active).map(q=>q.vehicle)].some(a=>Math.hypot(a.x-p.x,a.z-p.z)<12))continue;
   this.pool.repair?.(c);this.pool.initDrive(c,false);c.crashed=false;c.recoveryT=0;c.contactT=0;c.contactAt=-Infinity;c.blockedAt=null;c.lastSeenAt=this.t;c.active=true;c.point=p;c.offset=projectEdge(edge,p.x,p.z).offsetM;c.v=needCop?0:7;const q=this.route.project(p.x,p.z,{referenceY:p.y,heading:p.yaw});c.vehicle={...p,s:q.s,u:q.u,m:c.mass,halfL:c.len/2,halfW:c.wid/2,vLong:c.v,vLat:0,w:0};c.veh=c.vehicle;c.model=c.m;Object.assign(c,{s:q.s,u:q.u,hs:c.len/2,hu:c.wid/2,vs:c.v,vu:0,x:p.x,y:p.y,z:p.z});c.m.root.visible=true;return;
  }
 }
 update(dt,player,actors=[]){this.t+=dt;if(!this.pool)return;this.spawnT-=dt;if(this.spawnT<=0){this.spawnT=.5;this.spawn(player,actors);}
  const graph=this.session.roads.graph;
  for(const c of this.cars){if(!c.active)continue;this.watchVisibility(c);if(c.blockedAt!=null&&(c.point.edge!==c.blockedEdge||Math.abs(c.offset-c.blockedOffset)>1))c.blockedAt=null;if(this.retireUnseen(c,[player,...actors]))continue;let edge=graph.edges.get(c.point.edge)?.value;const distance=Math.hypot(c.vehicle.x-player.x,c.vehicle.z-player.z);if(distance>600&&this.outOfView(c,[player,...actors])){c.active=false;c.m.root.visible=false;continue;}if(!edge){this.stopBlocked(c);continue;}
   c.contactT=this.t-(c.contactAt??-Infinity)<.3?(c.contactT||0)+dt:0;if(c.contactT>4&&!c.police)c.crashed=true;
   if(c.crashed){this.recover(c,edge,dt,[player,...actors]);continue;}
   let target=(edge.speedKph||35)/3.6*(c.drv?.vf||1);if(c.police){target=this.hm.state==='idle'?5:Math.min(35,Math.abs(player.vLong)+4);}
   const held=this.session.props.hold(c.point,edge.points);if(held&&!(c.police&&this.hm.active))target=0;
   const f=edgePoint(edge,c.offset);let gap=Infinity,nearest=Infinity,leaderV=target;
   for(const other of [...actors,...this.cars.filter(q=>q.active&&q!==c).map(q=>q.vehicle)]){if(Math.abs(other.y-c.vehicle.y)>2.5)continue;const dx=other.x-c.vehicle.x,dz=other.z-c.vehicle.z,along=dx*f.tx+dz*f.tz,across=Math.abs(dx*f.rx+dz*f.rz);if(along>0&&along<nearest&&across<(other.halfW||1)+c.wid/2+.4){nearest=along;gap=Math.max(.1,along-c.len/2-(other.halfL||2.5));leaderV=Math.max(0,(other.vLong||0)*Math.cos(other.yaw-f.yaw));}}
   const acceleration=target<.1?-4:this.pool.idm(c,c.v,Math.max(.1,target),gap,leaderV);c.v=Math.max(0,c.v+clamp(acceleration,-5,2)*dt);
   const travel=Math.min(c.v*dt,Math.max(0,gap-.35));c.v=travel/dt;let offset=c.offset+travel;
   if(offset>edgeLength(edge)){const choices=trafficSuccessors(graph,edge,this.closures);if(!choices.length){this.stopBlocked(c);continue;}
    const viable=choices.filter(e=>this.candidate(e,Math.min(4,edgeLength(e)/2),c));if(!viable.length){this.stopBlocked(c);continue;}
    const chosen=c.police&&this.hm.active?[...viable].sort((a,b)=>Math.hypot(a.points.at(-1)[0]-player.x,a.points.at(-1)[2]-player.z)-Math.hypot(b.points.at(-1)[0]-player.x,b.points.at(-1)[2]-player.z))[0]:viable[Math.floor(this.pool.rng.next()*viable.length)];offset-=edgeLength(edge);edge=chosen;
   }
   const p=this.candidate(edge,Math.min(offset,edgeLength(edge)),c);if(!p){this.stopBlocked(c);continue;}if(this.poseBlocked(c,p,[...actors,...this.cars.filter(q=>q.active&&q!==c).map(q=>q.vehicle)])){this.stopBlocked(c);continue;}c.offset=Math.min(offset,edgeLength(edge));c.point=p;
   const q=this.route.project(p.x,p.z,{referenceY:p.y,heading:p.yaw});Object.assign(c.vehicle,p,{s:q.s,u:q.u,vLong:c.v,vLat:0,w:0});Object.assign(c,{s:q.s,u:q.u,hs:c.len/2,hu:c.wid/2,vs:c.v,vu:0,x:p.x,y:p.y,z:p.z});
  }
  this.updatePolice(dt,player);
 }
 // Rendering through the main camera OR mirrors protects a car from cleanup.
 watchVisibility(c){
  if(c.visibilityTracked||!c.m.root.traverse)return;
  const owner=this;let meshes=0;c.m.root.traverse(mesh=>{if(!mesh.isMesh)return;meshes++;const before=mesh.onBeforeRender;mesh.onBeforeRender=function(...args){c.lastSeenAt=owner.t;before?.apply(this,args);};});
  if(meshes){c.visibilityTracked=true;c.lastSeenAt=this.t;}
 }
 stopBlocked(c){c.v=c.vehicle.vLong=0;if(c.blockedAt==null){c.blockedAt=this.t;c.blockedEdge=c.point.edge;c.blockedOffset=c.offset;}}
 outOfView(c,actors){return c.visibilityTracked&&this.t-c.lastSeenAt>2&&!actors.some(a=>Math.abs((a.y||0)-c.vehicle.y)<3&&Math.hypot(a.x-c.vehicle.x,a.z-c.vehicle.z)<25);}
 retireUnseen(c,actors){
  if(!(c.recoveryT>8&&c.crashed||c.blockedAt!=null&&this.t-c.blockedAt>8)||!this.outOfView(c,actors))return false;
  c.active=false;c.crashed=false;c.m.root.visible=false;return true;
 }
 poseBlocked(c,p,actors){
  const current={...c.vehicle,halfL:c.len/2+.15,halfW:c.wid/2+.15},next={...current,...p};
  return actors.some(a=>{if(a===c.vehicle||Math.abs(a.y-next.y)>2.5)return false;const other=Number.isFinite(a.yaw)?a:{...a,yaw:0,vLong:0,vLat:0},hit=carOverlap(next,other);if(!hit)return false;const old=carOverlap(current,other);return !old||hit.depth>=old.depth-1e-5;});
 }
 // Rejoin the nearest safe lane slowly after an incident; never snap back to the pre-impact pose.
 recover(c,edge,dt,actors){
  c.recoveryT=(c.recoveryT||0)+dt;if(this.retireUnseen(c,actors))return;c.v*=Math.exp(-dt*3);
  const v=c.vehicle;v.vLong=c.v;v.vLat=0;v.w=0;
  if(c.recoveryT<4||this.t-(c.contactAt??-Infinity)<.5||c.v>.5)return;
  const offset=projectEdge(edge,v.x,v.z).offsetM,p=this.candidate(edge,offset,c);if(!p)return;
  const dx=p.x-v.x,dz=p.z-v.z,d=Math.hypot(dx,dz),angle=Math.atan2(Math.sin(p.yaw-v.yaw),Math.cos(p.yaw-v.yaw));
  if(d>8||Math.abs(p.y-v.y)>1)return;
  const k=Math.min(1,.7*dt/Math.max(.001,Math.hypot(d,p.y-v.y))),next={...p,x:v.x+dx*k,z:v.z+dz*k,y:v.y+(p.y-v.y)*k,yaw:v.yaw+clamp(angle,-.6*dt,.6*dt)};
  const nearby=[...actors,...this.cars.filter(q=>q.active&&q!==c).map(q=>q.vehicle)];
  if(this.poseBlocked(c,next,nearby)||!this.session.safePose(next,{halfWidth:c.wid/2,halfLength:c.len/2}))return;
  Object.assign(v,next);const q=this.route.project(v.x,v.z,{referenceY:v.y,heading:v.yaw});Object.assign(v,{s:q.s,u:q.u});Object.assign(c,{s:q.s,u:q.u,x:v.x,y:v.y,z:v.z,vs:0,vu:0});
  if(d<.05&&Math.abs(p.y-v.y)<.05&&Math.abs(angle)<.03){c.offset=offset;c.point=p;c.crashed=false;c.recoveryT=0;c.v=v.vLong=0;}
 }
 updatePolice(dt,player){if(!this.policeEnabled)return;const C=this.tuning,units=this.cars.filter(c=>c.active&&c.police),visible=units.filter(c=>{const d=Math.hypot(c.vehicle.x-player.x,c.vehicle.z-player.z);if(d>(this.hm.active?C.pursuitRange:C.witnessRange)||Math.abs(c.vehicle.y-player.y)>3||this.session.barriers?.lineBlocked({...c.vehicle,y:c.vehicle.y+1},{...player,y:player.y+1}))return false;for(let t=.1;t<1;t+=.1){const x=c.vehicle.x+(player.x-c.vehicle.x)*t,z=c.vehicle.z+(player.z-c.vehicle.z)*t;if(this.session.obstacles.contact(x,player.y+1,z,.1))return false;}return true;});
  const seen=this.seen=visible.length>0,nearest=this.session.roads.graph.nearest(player.x,player.z,{referenceY:player.y,maxDistance:20}),edge=nearest&&this.session.roads.graph.edges.get(nearest.edge)?.value,limit=edge?.speedKph||50,over=Math.abs(player.vLong)*3.6-limit;
  const wrong=edge&&(edge.flags&1)?Math.cos(player.yaw-projectEdge(edge,player.x,player.z).yaw)<-.4&&Math.abs(player.vLong)>3:false;
  if(seen&&this.crossedRed)this.hm.offence('red',.3,true);this.crossedRed=null;
  if(seen&&over>C.speedMargin)this.hm.offence('speeding',dt*(over>C.seriousMargin?C.seriousSpeedHeat:over>C.warnMargin?C.speedHeat:C.minorSpeedHeat),true,{continuous:true,sustained:this.hm.warningT>=C.sustainedAfter});
  if(seen&&wrong)this.hm.offence('wrongside',dt*C.wrongSideHeat,true,{continuous:true,sustained:this.hm.warningT>=C.sustainedAfter});
  const near=visible.filter(c=>Math.hypot(c.vehicle.x-player.x,c.vehicle.z-player.z)<C.bustDist).length;
  const transitions=this.hm.update(dt,{seen,offending:over>C.speedMargin||wrong,fleeing:over>C.fleeMargin,slow:Math.abs(player.vLong)<C.bustSpeed,copsNear:near,complying:near>0&&Math.abs(player.vLong)<1});
  this.onVoice?.({enabled:true,P:{...player,vs:player.vLong,vu:player.vLat||0},cops:units.filter(c=>!c.crashed),hm:this.hm,distance:(c,p)=>Math.hypot(c.vehicle.x-p.x,c.vehicle.z-p.z)},transitions);
  for(const event of transitions)events.emit('pursuit',event);
  Object.assign(pursuit,{enabled:true,state:this.hm.state,heat:this.hm.heat,level:this.hm.level,bustMeter:this.hm.bust,evadeMeter:this.hm.evade,time:this.hm.time,units:units.length});
 }
 collide(actor,out,now){for(const c of this.cars){if(!c.active||!c.vehicle||Math.abs(c.vehicle.y-actor.veh.y)>2.5||Math.hypot(c.vehicle.x-actor.veh.x,c.vehicle.z-actor.veh.z)>10)continue;const hit=resolveCarPair(actor.veh,c.vehicle);if(!hit)continue;c.contactAt=this.t;if(hit.hitA){const offset=bodyOffset(actor.veh,hit.c.x,hit.c.z),cs=Math.cos(actor.veh.yaw),sn=Math.sin(actor.veh.yaw),localNormal={x:hit.c.nx*cs-hit.c.nz*sn,y:0,z:hit.c.nx*sn+hit.c.nz*cs},zone=Math.abs(localNormal.x)>Math.abs(localNormal.z)?(localNormal.x>0?'left':'right'):(localNormal.z>0?'front':'rear');actor.veh.addDamage?.(zone,hit.hitA.dv,{kind:'crash',sev:hit.vn,car:{mass:c.mass},localPoint:{x:offset.py,y:.5,z:-offset.px},localNormal});actor.veh.impactDynamics?.({dv:hit.hitA.dv,nx:hit.c.nx,nz:hit.c.nz,forward:offset.px,right:offset.py,height:.5,kind:'car',yawSolved:true});}if(hit.vn>3){c.crashed=true;this.pool.damageCar(c,'front',hit.hitB?.dv||0,{ebs:hit.vn});out.push({kind:'crash',sev:hit.vn,car:c,who:actor.kind});if(this.policeEnabled)this.hm.offence('collision',1,this.seen||c.police,{serious:hit.vn>11});}c.v=Math.max(0,c.vehicle.vLong);}}
 sync(){const o=this.session.stream.origin;for(const c of this.cars){const root=c.m.root;if(!c.active){root.visible=false;continue;}const v=c.vehicle;root.visible=true;root.position.set(v.x-o.x,v.y,v.z-o.z);root.rotation.set(0,v.yaw,0);c.m.update?.(1/60,c.v,0,c.v<1,{});c.m.setStrobe?.(c.police&&this.hm.state!=='idle',this.t);}}
 zone(){return 'town';}
 get actors(){return this.cars.filter(c=>c.active).map(c=>c.vehicle);}
 dispose(){this.disposed=true;this.fleetController?.abort();releaseFleet(this.pool||this.warmingPool);this.cars=[];this.pool=null;Object.assign(pursuit,{enabled:false,state:'off'});}
}

function releaseFleet(pool){if(!pool||pool.released)return;pool.released=true;const roots=[...(pool.cars||[]).map(c=>c.m.root),pool.coneMesh,...(pool.proxies?.meshes||[])];const geos=new Set(),mats=new Set();for(const root of roots){root?.removeFromParent?.();root?.traverse?.(o=>{if(o.geometry&&!o.geometry.userData.shared)geos.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])if(!m.userData?.shared)mats.add(m);});}for(const g of geos)g.dispose();for(const m of mats)m.dispose();pool.proxies?.dispose?.();}
