// Solid vertical bridge guardrails. Continuous swept-OBB collision prevents
// tunnelling even when a whole car crosses a thin rail between physics steps.
// Rails impart horizontal impulses only; they are never wheel contact ramps.
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
    let vx=fx*vehicle.vLong+rx*vehicle.vLat,vz=fz*vehicle.vLong+rz*vehicle.vLat;
    const speed=Math.max(0,-vx*nx-vz*nz);
    vehicle.x=previous.x+(vehicle.x-previous.x)*t+nx*(EPS+penetration);
    vehicle.z=previous.z+(vehicle.z-previous.z)*t+nz*(EPS+penetration);
    vehicle.yaw=previous.yaw;vehicle.w=0;
    if(speed>0){
      const forward=-(nx*fx+nz*fz),right=-(nx*rx+nz*rz);
      const zone=Math.abs(forward)>Math.abs(right)?(forward>0?'front':'rear'):(right>0?'right':'left');
      vehicle.addDamage?.(zone,speed,{kind:'wall',localPoint:{x:right*vehicle.halfW,y:.45,z:-forward*vehicle.halfL},localNormal:{x:-right,y:0,z:forward}});
      vx=(vx+nx*speed)*.96;vz=(vz+nz*speed)*.96;
      vehicle.wallHit=Math.max(vehicle.wallHit||0,speed);vehicle.wallNx=nx;vehicle.wallNz=nz;
    }
    // No impactDynamics lift/roll impulse. Suspension keeps its normal road
    // contact response; neither y nor vertical velocity is changed by a rail.
    const sin=Math.sin(vehicle.yaw),cos=Math.cos(vehicle.yaw);
    vehicle.vLong=-sin*vx-cos*vz;vehicle.vLat=cos*vx-sin*vz;vehicle.syncWheels?.();
    return true;
  }
}
