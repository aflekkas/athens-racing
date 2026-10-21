import {Route} from './map.js';
import {RoadNetwork} from './road-network-surface.js';
import {PsychikoStreetscape} from './maps/psychiko-streetscape.js';
import {Ground} from './ground.js';
import {carOverlap} from './crash-contact.js';
import {settings} from './settings.js';
const P={lat0:37.98,lon0:23.73,mlat:111320,mlon:111320*Math.cos(37.98*Math.PI/180)};
/** Retains Vas-Per's actual streetscape recipes, with tile-lifetime geometry and shared world contact. */
export class WorldPsychikoDetail {
 constructor(session,parent,data){this.session=session;this.data=data;const p=data.proj;this.sx=P.mlon/p.mlon;this.sz=P.mlat/p.mlat;this.ox=(p.lon0-P.lon0)*P.mlon;this.oz=-(p.lat0-P.lat0)*P.mlat;this.roofs=new Map();this.roofQueue=new Set();
  const route=new Route(data.route),height=(x,z)=>session.stream.contact(this.ox+x*this.sx,this.oz+z*this.sz,{layer:0})?.y??0,map={id:'psychiko',route,data,terrain:{sceneryHeight:height}};
  map.roadNetwork=new RoadNetwork(map);map.roadNetwork.height=height;const originalPoint=route.point.bind(route);route.point=(s,u,out)=>{const p=originalPoint(s,u,out);p.y=height(p.x,p.z);return p;};
  this.street=new PsychikoStreetscape(map,parent,height);for(const mesh of this.street.parking){mesh.count=0;mesh.visible=false;}this.street.streamed=true;this.street.activeAt=(x,z)=>this.active(x,z);this.street.groundY=height;
  this.street.network.height=height;this.height=height;this.obstacleBuckets=new Map();for(const b of this.street.obstacles){const p={...b,...this.world(b.x,b.z),yaw:Math.atan2(Math.sin(b.yaw)*this.sx,Math.cos(b.yaw)*this.sz),hl:b.hl*Math.max(this.sx,this.sz),hw:b.hw*Math.max(this.sx,this.sz),kind:'parked'};const k=`${Math.floor(p.x/64)},${Math.floor(p.z/64)}`;if(!this.obstacleBuckets.has(k))this.obstacleBuckets.set(k,[]);this.obstacleBuckets.get(k).push(p);}this.off=session.subscribeTiles({activated:k=>this.changed(k,true),removed:k=>this.changed(k,false)});
 }
 world(x,z){return{x:this.ox+x*this.sx,z:this.oz+z*this.sz};}
 active(x,z){const p=this.world(x,z);return this.session.stream.readyAt(p.x,p.z);}
 changed(k,on){const street=this.street;for(const mesh of street.cells.values())if(mesh){mesh.removeFromParent();mesh.geometry.dispose();}street.cells.clear();street.last.x=Infinity;
  const previous=this.roofs.get(k);if(previous){previous.removeFromParent();previous.geometry.dispose();previous.material.dispose();this.roofs.delete(k);}
  if(on)this.roofQueue.add(k);else this.roofQueue.delete(k);
 }
 buildRoof(k){const street=this.street;{const buildings=this.data.buildings.filter(b=>b.pitched&&this.cellOf(b.p[0],b.p[1])===k).map(b=>({...b,top:this.height(b.p[0],b.p[1])+b.h}));if(buildings.length){const mesh=street.buildRoofs(buildings);this.roofs.set(k,mesh);street.roofs=null;}}
 }
 cellOf(x,z){const p=this.world(x,z);return `${Math.floor(p.x/512)},${Math.floor(p.z/512)}`;}
 update(player){if(this.roofQueue.size){const k=this.roofQueue.values().next().value;this.roofQueue.delete(k);this.buildRoof(k);}const o=this.session.stream.origin,group=this.street.group;group.position.set(this.ox-o.x,0,this.oz-o.z);group.scale.set(this.sx,1,this.sz);const p={x:(player.x-this.ox)/this.sx,z:(player.z-this.oz)/this.sz};this.street.update({position:p});}
 nearby(p){const result=[],x=Math.floor(p.x/64),z=Math.floor(p.z/64);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const b of this.obstacleBuckets.get(`${x+dx},${z+dz}`)||[])if(this.session.stream.readyAt(b.x,b.z)&&Math.hypot(b.x-p.x,b.z-p.z)<12)result.push(b);return result;}
 safe(p,{halfLength,halfWidth}){return !this.nearby(p).some(b=>carOverlap({...p,halfL:halfLength,halfW:halfWidth},{...b,halfL:b.hl,halfW:b.hw}));}
 resolve(v){for(const b of this.nearby(v)){const c=carOverlap(v,{...b,halfL:b.hl,halfW:b.hw});if(c)Ground.prototype._hit.call(this,v,c.nx,c.nz,c.depth,undefined,b);}}
 dispose(){this.off?.();this.off=null;for(const mesh of this.roofs.values()){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}this.roofs.clear();this.street.dispose();this.street.group.removeFromParent();}
}
