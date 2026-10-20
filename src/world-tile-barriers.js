// Solid vertical bridge guardrails. Continuous swept-OBB collision prevents
// tunnelling even when a whole car crosses a thin rail between physics steps.
// Rails impart horizontal impulses only; they are never wheel contact ramps.
import {solveContact,alignAlong,noteHit,noteWall} from './crash-contact.js';
const EPS=.002;
function sweep(a,b,halfL,halfW,rail,origin){
  const ax=rail[0]+origin[0],az=rail[2]+origin[2],bx=rail[3]+origin[0],bz=rail[5]+origin[2];
  const reach=Math.hypot(halfL,halfW)+.16;
  if(Math.max(a.x,b.x)+reach<Math.min(ax,bx)||Math.min(a.x,b.x)-reach>Math.max(ax,bx)||Math.max(a.z,b.z)+reach<Math.min(az,bz)||Math.min(a.z,b.z)-reach>Math.max(az,bz))return null;
  const length=Math.hypot(bx-ax,bz-az);if(length<1e-8)return null;
  const tx=(bx-ax)/length,tz=(bz-az)/length,nx=-tz,nz=tx;
  const fx=-Math.sin(a.yaw),fz=-Math.cos(a.yaw),rx=Math.cos(a.yaw),rz=-Math.sin(a.yaw);
  // Enclose the complete orientation sweep. On collision restore that original
  // orientation, rather than letting a rotated rear corner protrude through.
  const angle=Math.abs(Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw)));
  const margin=Math.hypot(halfL,halfW)*Math.min(2,angle);
  const dx=b.x-a.x,dz=b.z-a.z,cx=(ax+bx)/2,cz=(az+bz)/2;
  let enter=0,leave=1,normal=null,penetration=Infinity;
  for(const [ux,uz] of [[fx,fz],[rx,rz],[tx,tz],[nx,nz]]){
    const radius=(halfL+margin)*Math.abs(ux*fx+uz*fz)+(halfW+margin)*Math.abs(ux*rx+uz*rz)+length/2*Math.abs(ux*tx+uz*tz)+.15*Math.abs(ux*nx+uz*nz);
    const start=(a.x-cx)*ux+(a.z-cz)*uz,move=dx*ux+dz*uz,depth=radius-Math.abs(start);
    if(depth>=0&&depth<penetration){penetration=depth;if(enter===0)normal=[ux*(Math.sign(start)||1),uz*(Math.sign(start)||1)];}
    if(Math.abs(move)<1e-12){if(Math.abs(start)>radius)return null;continue;}
    const first=(-radius-start)/move,last=(radius-start)/move,lo=Math.min(first,last),hi=Math.max(first,last);
    if(lo>enter){enter=lo;normal=[-Math.sign(move)*ux,-Math.sign(move)*uz];}
    leave=Math.min(leave,hi);if(enter>leave)return null;
  }
  if(leave<0||enter>1||!normal)return null;
  const x=a.x+dx*enter,z=a.z+dz*enter,f=Math.max(0,Math.min(1,((x-ax)*tx+(z-az)*tz)/length));
  const y=rail[1]+(rail[4]-rail[1])*f,carY=a.y+(b.y-a.y)*enter;
  if(carY+2<y-.5||carY>y+rail[6])return null; // traffic underneath is independent
  return {t:enter,nx:normal[0],nz:normal[1],penetration:enter===0?Math.max(0,penetration):0};
}
export class WorldTileBarriers{
  constructor(){this.tiles=new Map();}
  install(key,packet){this.tiles.set(key,{rails:packet.metadata.rails||[],origin:packet.metadata.origin});}
  remove(key){this.tiles.delete(key);}
  dispose(){this.tiles.clear();}
  resolve(vehicle,previous){
    let first=null;
    for(const {rails,origin} of this.tiles.values())for(const rail of rails){
      const hit=sweep(previous,vehicle,vehicle.halfL,vehicle.halfW,rail,origin);
      if(hit&&(!first||hit.t<first.t))first=hit;
    }
    if(!first)return false;
    const {t,nx,nz,penetration}=first;
    const fx=-Math.sin(vehicle.yaw),fz=-Math.cos(vehicle.yaw),rx=Math.cos(vehicle.yaw),rz=-Math.sin(vehicle.yaw);
    // Back to the moment of contact (position and heading), then a rigid-body blow at the corner that touches the rail, with the
    // car's yaw inertia: a glancing hit turns the car along the rail and scrubs speed (friction), a square one stops it and bounces
    // it back a little. The old response froze the heading and zeroed the yaw rate, which pinned a glancing car to the rail
    // until it stopped. The rail still never lifts or rolls the car: the block is planar.
    const dyaw=Math.atan2(Math.sin(vehicle.yaw-previous.yaw),Math.cos(vehicle.yaw-previous.yaw));
    vehicle.x=previous.x+(vehicle.x-previous.x)*t+nx*(EPS+penetration);
    vehicle.z=previous.z+(vehicle.z-previous.z)*t+nz*(EPS+penetration);
    vehicle.yaw=previous.yaw+dyaw*t;
    const fx2=-Math.sin(vehicle.yaw),fz2=-Math.cos(vehicle.yaw),rx2=Math.cos(vehicle.yaw),rz2=-Math.sin(vehicle.yaw);
    // the corners nearest the rail; those level with the deepest (a square hit meets with the whole face) share the blow
    const corners=[];
    for(const a of [vehicle.halfL,-vehicle.halfL])for(const b of [vehicle.halfW,-vehicle.halfW]){
      const cx=vehicle.x+fx2*a+rx2*b,cz=vehicle.z+fz2*a+rz2*b;corners.push({x:cx,z:cz,d:cx*nx+cz*nz});
    }
    const low=Math.min(...corners.map(c=>c.d)),near=corners.filter(c=>c.d<=low+.1);
    let best={x:near.reduce((s,c)=>s+c.x,0)/near.length,z:near.reduce((s,c)=>s+c.z,0)/near.length};
    const dF=-(nx*fx2+nz*fz2),dR=-(nx*rx2+nz*rz2);
    // (lying along the rail, the middle of the side that touches it)
    if(Math.abs(dF)<.12)best={x:vehicle.x+rx2*Math.sign(dR||1)*vehicle.halfW,z:vehicle.z+rz2*Math.sign(dR||1)*vehicle.halfW};
    const blow=solveContact(vehicle,nx,nz,best.x,best.z,{mu:.22});
    if(blow){
      const zone=Math.abs(dF)>Math.abs(dR)?(dF>0?'front':'rear'):(dR>0?'right':'left');
      vehicle.addDamage?.(zone,blow.vn,{kind:'wall',localPoint:{x:blow.py,y:.45,z:-blow.px},localNormal:{x:-dR,y:0,z:dF}});
      noteHit(vehicle,blow.dv);
      vehicle.wallHit=Math.max(vehicle.wallHit||0,blow.vn);vehicle.wallNx=nx;vehicle.wallNz=nz;
    }
    alignAlong(vehicle,nx,nz,1/240);noteWall(vehicle,nx,nz);
    void fx;void fz;void rx;void rz;
    vehicle.syncWheels?.();
    return true;
  }
}
