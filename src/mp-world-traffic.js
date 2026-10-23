import {projectEdge} from './route-geometry.js';
import {worldOwner,worldPackets,WorldAssembler,packWorldCar,packWorldCone,WORLD_CAR,WORLD_CONE,ZONES,worldFrameIntervalMs} from './shared-world-protocol.js';
import {sameRouteIdentity} from './route-network.js';
import {trafficSeed} from './mp-shared-world.js';
import {RNG} from './util.js';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function applyWorldTrafficCar(traffic,row,{age=0,promote=false}={}){
 const c=traffic.cars[row[0]];if(!c)return null;
 const fresh=!c.active;if(fresh||promote)traffic.pool.initDrive(c,false);
 const yaw=row[5]/1000,vx=row[WORLD_CAR.VX]/100,vz=row[WORLD_CAR.VZ]/100,layer=row[WORLD_CAR.LAYER],p={x:row[WORLD_CAR.X]/100+vx*age,y:row[WORLD_CAR.Y]/100,z:row[WORLD_CAR.Z]/100+vz*age,yaw,layer};
 const near=traffic.session.roads.graph.nearest(p.x,p.z,{referenceY:p.y,layer,maxDistance:30});
 if(promote&&(!near||!traffic.session.safePose({...p,edge:near.edge},{halfWidth:c.wid/2,halfLength:c.len/2}))){c.active=false;c.m.root.visible=false;return null;}
 const q=traffic.route.project(p.x,p.z,{referenceY:p.y,heading:yaw}),v=c.vehicle||{};Object.assign(v,p,{s:Number.isFinite(q.s)?q.s:0,u:Number.isFinite(q.u)?q.u:0,m:c.mass,halfL:c.len/2,halfW:c.wid/2,vLong:-Math.sin(yaw)*vx-Math.cos(yaw)*vz,vLat:Math.cos(yaw)*vx-Math.sin(yaw)*vz,w:row[6]/1000,air:!(row[WORLD_CAR.CONTACT]&1)});
 c.vehicle=c.veh=v;c.point={...p,edge:near?.edge,edgeId:near?.edge};const edge=traffic.session.roads.graph.edges?.get(near?.edge)?.value;c.offset=edge?projectEdge(edge,p.x,p.z).offsetM:near?.offsetM||0;c.active=true;c.v=Math.max(0,v.vLong);c.dir=row[12];c.s=v.s;c.u=v.u;c.x=v.x;c.y=v.y;c.z=v.z;c.vs=v.vLong;c.vu=v.vLat;c.turn=null;c.yielding=null;c.laneShift=0;c.crashed=!!(row[13]&1);c.braking=!!(row[13]&16);c.contactAt=-Infinity;c.recoveryT=0;c.lastSeenAt=traffic.t;c.wheel=row[14]/100;c.steerA=row[15]/1000;c.dmg=row[23]/100;
 c.dz=Object.fromEntries(ZONES.map((z,i)=>[z,row[16+i]/1000]));c.m.setDamageSnapshot?.(c.dz);c.indL.emissiveIntensity=row[20]&1?3.5:0;c.indR.emissiveIntensity=row[20]&2?3.5:0;c.flash.emissiveIntensity=row[20]&4?5:0;
 if(c.police){c.cop||={};Object.assign(c.cop,{siren:!!(row[13]&32),chase:!!(row[13]&64),target:((row[13]>>7)&15)-1});if(c.cop.target<0)c.cop.target=null;}
 if(row[WORLD_CAR.CONTACT]&2)c.rider=Object.fromEntries(['x','z','y','yaw','vx','vz','vy','age'].map((k,i)=>[k,row[24+i]/100]));else c.rider=null;
 return c;
}
export function applyWorldTrafficCone(k,row,age=0){if(!k)return;Object.assign(k,{hit:true,x:row[WORLD_CONE.X]/100+row[WORLD_CONE.VX]/100*age,y:row[WORLD_CONE.Y]/100,z:row[WORLD_CONE.Z]/100+row[WORLD_CONE.VZ]/100*age,layer:row[WORLD_CONE.LAYER],vx:row[WORLD_CONE.VX]/100,vz:row[WORLD_CONE.VZ]/100,air:!(row[WORLD_CONE.CONTACT]&1)});}
/** The elected driver's real graph simulation owns NPCs; replicas receive world
 * poses and never choose their own successors or run a private police pursuit. */
export class StreamedSharedWorld{
 constructor(mp,runtime){this.mp=mp;this.runtime=runtime;this.assembler=new WorldAssembler();this.seq=0;this.nonce=0;this.stats={sent:0,bytes:0,contactsSent:0,contactsReceived:0,received:0};this.cooldowns=new Map();}
 configure(){const r=this.runtime(),l=this.mp.lobby,key=l?.raceId?`${l.raceId}:${l.generation}:${l.routeIdentity?.routeHash}:${l.routeIdentity?.onlineGridHash}`:null;
  if(this.traffic!==r.traffic||this.key!==key){this.traffic=r.traffic;this.key=key;this.authority=false;this.frame=null;this.seq=0;this.lastSent=-Infinity;this.intervalMs=200;this.assembler.clear();this.cooldowns.clear();if(key&&this.traffic.pool)this.traffic.pool.rng=new RNG(trafficSeed(key));}
  return r;
 }
 update(dt){const r=this.configure(),l=this.mp.lobby,tr=this.traffic;if(!this.key||!tr||!['countdown','race'].includes(l.status))return;
  if(!tr.pool){tr.warmFleet(()=>this.traffic===tr&&this.mp.active).catch(e=>console.warn('Online fleet preparation',e));return;}
  const authority=worldOwner(l)===this.mp.id;if(authority&&!this.authority&&this.frame)this.apply(this.frame,true);this.authority=authority;
  if(authority){const remotes=r.remotes.filter(x=>x.member?.loaded&&x.member.connected!==false&&!x.member.dnf),actors=[r.player.veh,...remotes.map(x=>x.car.veh)];tr.disabled=!(l.config.traffic>0);if(tr.updateOnlineAuthority)tr.updateOnlineAuthority(dt,{lobby:l,id:this.mp.id,player:r.player.veh,actors,peers:this.mp.peers});else tr.update(dt,r.player.veh,actors);
   if(this.mp.connected&&this.mp.now()-this.lastSent>=this.intervalMs)this.publish();
  }else if(this.frame)this.apply(this.frame);else for(const c of tr.cars){c.active=false;c.m.root.visible=false;}
 }
 publish(){const l=this.mp.lobby,at=this.mp.now(),tr=this.traffic,rows=tr.cars.filter(c=>c.active&&c.vehicle).map(c=>packWorldCar(tr,c)),cones=(tr.pool?.cones||[]).flatMap((k,id)=>k.hit?[packWorldCone(k,id)]:[]);
  const packets=worldPackets({raceId:l.raceId,generation:l.generation||0,owner:worldOwner(l),seq:this.seq++,at,now:at,mapId:l.mapId,routeIdentity:l.routeIdentity},rows,cones);this.intervalMs=worldFrameIntervalMs(packets.length);this.lastSent=at;this.lastPublished={rows,cones,at};
  for(const p of packets){this.stats.sent++;this.stats.bytes+=JSON.stringify(p).length;this.mp.send(p);}
 }
 receive(m){this.configure();const l=this.mp.lobby;if(!l||m.raceId!==l.raceId||m.generation!==(l.generation||0)||m.mapId!==l.mapId||!sameRouteIdentity(m.routeIdentity,l.routeIdentity))return;if(m.type==='world-contact'){if(this.authority)this.acceptContact(m);return;}if(m.owner!==worldOwner(l))return;const full=this.assembler.accept(m);if(!full)return;this.frame=full;this.stats.received++;if(!this.authority&&this.traffic?.pool)this.apply(full);}
 apply(frame,promote=false){const age=promote?0:clamp((this.mp.now()-frame.at)/1000,0,.35),active=new Set(frame.rows.map(r=>r[0]));for(const c of this.traffic.cars)if(!active.has(c.id)){c.active=false;c.m.root.visible=false;}for(const row of frame.rows)applyWorldTrafficCar(this.traffic,row,{age,promote});for(const row of frame.cones)applyWorldTrafficCone(this.traffic.pool?.cones?.[row[0]],row,age);this.lastPoseAge=age;}
 beforeCollide(){if(this.authority)return null;return new Map(this.traffic.cars.filter(c=>c.active&&c.vehicle).map(c=>[c.id,{...c.vehicle}]));}
 afterCollide(before){if(!before||!this.mp.connected)return;for(const c of this.traffic.cars){const old=before.get(c.id),v=c.vehicle;if(!old||!v)continue;const vel=p=>({x:-Math.sin(p.yaw)*p.vLong+Math.cos(p.yaw)*(p.vLat||0),z:-Math.cos(p.yaw)*p.vLong-Math.sin(p.yaw)*(p.vLat||0)}),a=vel(old),b=vel(v),dv=Math.hypot(b.x-a.x,b.z-a.z);if(dv<.01)continue;const now=this.mp.now();if(now-(this.cooldowns.get(c.id)||0)<250)continue;this.cooldowns.set(c.id,now);const body=[c.id,Math.round(clamp(v.x-old.x,-3,3)*100),Math.round(clamp(v.z-old.z,-3,3)*100),Math.round(clamp(b.x-a.x,-60,60)*100),Math.round(clamp(b.z-a.z,-60,60)*100),Math.round(clamp(v.w-old.w,-10,10)*1000),Math.round(clamp(dv,0,60)*100),0,Math.round(clamp(dv,0,100)*100)];this.mp.send({type:'world-contact',raceId:this.mp.lobby.raceId,generation:this.mp.lobby.generation,kind:'car',body,nonce:this.nonce++,at:now});this.stats.contactsSent++;}}
 acceptContact(m){if(m.kind!=='car')return;const c=this.traffic.cars[m.body[0]];if(!c?.active||!c.vehicle)return;const b=m.body,v=c.vehicle,yaw=v.yaw,vx=-Math.sin(yaw)*v.vLong+Math.cos(yaw)*(v.vLat||0)+b[3]/100,vz=-Math.cos(yaw)*v.vLong-Math.sin(yaw)*(v.vLat||0)+b[4]/100;v.x+=b[1]/100;v.z+=b[2]/100;v.vLong=-Math.sin(yaw)*vx-Math.cos(yaw)*vz;v.vLat=Math.cos(yaw)*vx-Math.sin(yaw)*vz;v.w+=b[5]/1000;c.v=Math.max(0,v.vLong);c.crashed=true;c.contactAt=this.traffic.t;this.traffic.pool.damageCar(c,ZONES[b[7]],b[6]/100,{ebs:b[8]/100});this.stats.contactsReceived++;}
}
