// Fixed-step, bounded PBD humans. No renderer or physics engine dependency.
export const RAGDOLL_CAP = 3, STEP = 1 / 120, LIFE = 8;
// Same joint order and reference dimensions as human.js's skinned rig.
const REST = [0,.96,0, 0,1.035,0, 0,1.51,.004, 0,1.555,.014,
 .09,.94,0, .09,.50,0, .09,.08,0, .2,1.48,-.005, .2,1.19,-.005, .2,.94,-.005,
 -.09,.94,0, -.09,.50,0, -.09,.08,0, -.2,1.48,-.005, -.2,1.19,-.005, -.2,.94,-.005];
export const PARENTS = [-1,0,1,2,0,4,5,1,7,8,0,10,11,1,13,14];
// Distances between endpoints bound joint opening angles without acos per iteration.
const BRACES = [[4,10,1,1],[7,13,1,1],[0,7,1,1],[0,13,1,1],[2,7,1,1],[2,13,1,1],
 [0,2,.76,1],[1,3,.85,1],[4,6,.32,.995],[10,12,.32,.995],[7,9,.25,.99],[13,15,.25,.99],
 [1,5,.48,1.08],[1,11,.48,1.08],[0,8,.34,1.1],[0,14,.34,1.1]];
const limit=(x,a,b)=>Math.max(a,Math.min(b,x));
export const impactTarget = type => type?.scooter || type?.moto || /^(delivery|scooter|moto|police_moto)$/.test(type?.id) ? 'rider' : 'vehicle';
export class Ragdoll {
 constructor() {
  this.p=new Float64Array(48);this.prev=new Float64Array(48);this.rest=new Float64Array(48);this.radius=new Float64Array(16);this.floor=new Float64Array(16);
  this.links=[];this.active=false;this.age=0;this.acc=0;this.car=null;
 }
 launch(o) {
  const k=o.scale||1,wH=o.wH||1,wT=o.wT||1,c=Math.cos(o.yaw||0),s=Math.sin(o.yaw||0);
  this.age=this.acc=this.quiet=0;this.active=true;this.sleeping=false;this.car=o.car||null;this.owner=o.owner;
  this.groundS=o.s;this.kind=o.kind||'pedestrian';this.seed=o.seed||0;this.maxRise=this.kind==='rider'?Math.max(3,o.vy||0):Math.hypot(o.vx||0,o.vz||0)>19?8:2.2;
  for(let i=0;i<16;i++) {
   const j=i*3,x=REST[j]*k*(i===4||i===5||i===6||i===10||i===11||i===12?wH:wT),y=REST[j+1]*k,z=REST[j+2]*k;
   this.rest[j]=x;this.rest[j+1]=y;this.rest[j+2]=z;
   this.p[j]=o.x+x*c+z*s;this.p[j+1]=o.y+y;this.p[j+2]=o.z-x*s+z*c;
   // The legs take the bumper impulse first; the upper body lags and folds.
   const low=i===0||i>=4&&i<=6||i>=10&&i<=12, speed=Math.hypot(o.vx||0,o.vz||0);
   const gain=this.kind==='rider'?1:low?.72:.36;
   const vy=o.vy??(speed>19?Math.min(7,speed*.22):speed>6?1.35:.35);
   const twist=Math.sin((this.seed+1)*(i+3)*1.71)*Math.min(.65,speed*.025);
   this.prev[j]=this.p[j]-((o.vx||0)*gain+twist)*STEP;
   this.prev[j+1]=this.p[j+1]-(vy+(low?0:.2))*STEP;
   this.prev[j+2]=this.p[j+2]-((o.vz||0)*gain-twist*.5)*STEP;
   this.radius[i]=(i===0?.13:i===1?.18:i===2?.08:i===3?.15:.055)*k;
  }
  this.links.length=0;
  for(let i=1;i<16;i++)this.link(PARENTS[i],i,1,1);
  for(const b of BRACES)this.link(...b);
  return this;
 }
 link(a,b,min,max) {
  const d=Math.hypot(this.rest[a*3]-this.rest[b*3],this.rest[a*3+1]-this.rest[b*3+1],this.rest[a*3+2]-this.rest[b*3+2]);
  this.links.push([a*3,b*3,d*min,d*max]);
 }
 constrain() {
  const p=this.p;
  for(const l of this.links) {
   const [a,b,min,max]=l,dx=p[b]-p[a],dy=p[b+1]-p[a+1],dz=p[b+2]-p[a+2],d=Math.hypot(dx,dy,dz);
   if(d<1e-8)continue;
   const e=(d-limit(d,min,max))/d*.5;
   p[a]+=dx*e;p[a+1]+=dy*e;p[a+2]+=dz*e;p[b]-=dx*e;p[b+1]-=dy*e;p[b+2]-=dz*e;
  }
 }
 step(ground) {
  const p=this.p,q=this.prev;let motion=0;
  for(let j=0;j<48;j+=3) {
   const vx=(p[j]-q[j])*.997,vy=(p[j+1]-q[j+1])*.997,vz=(p[j+2]-q[j+2])*.997;
   q[j]=p[j];q[j+1]=p[j+1];q[j+2]=p[j+2];p[j]+=vx;p[j+1]+=vy-9.81*STEP*STEP;p[j+2]+=vz;
  }
  for(let i=0;i<16;i++) this.floor[i]=ground(p[i*3],p[i*3+2],this);
  for(let n=0;n<10;n++) {this.constrain();this.contacts();}
  // Depenetration at a bumper/glass corner must not become an explosive impulse.
  for(let j=0;j<48;j+=3) q[j+1]=Math.max(q[j+1],p[j+1]-this.maxRise*STEP);
  for(let j=0;j<48;j++)motion+=(p[j]-q[j])**2;
  this.quiet=motion<.000012?this.quiet+STEP:0;
  if(this.quiet>.7&&!this.car)this.sleeping=true;
 }
 contacts() {
  const p=this.p,q=this.prev,C=this.car;
  for(let i=0;i<16;i++) {
   const j=i*3,r=this.radius[i],gy=this.floor[i]+r;
   if(p[j+1]<gy) {p[j+1]=gy;q[j]+=(p[j]-q[j])*.2;q[j+2]+=(p[j+2]-q[j+2])*.2;q[j+1]=p[j+1];}
   if(!C)continue;
   const sn=Math.sin(C.yaw),cs=Math.cos(C.yaw),dx=p[j]-C.x,dz=p[j+2]-C.z;
   const x=dx*cs-dz*sn,z=dx*sn+dz*cs,hl=C.halfL||2.2,hw=C.halfW||.9,h=C.height||1.4,base=C.y||0;
   if(Math.abs(x)>hw+r||Math.abs(z)>hl+r)continue;
   // Piecewise upper hull: bonnet, sloping windscreen, roof, rear deck.
   const front=-hl,hood=-hl*.48,screen=-hl*.05,rear=hl*.62;
   let top,slope=0;
   if(z<hood){slope=h*.17/(hood-front);top=h*.48+(z-front)*slope;}
   else if(z<screen){slope=h*.35/(screen-hood);top=h*.65+(z-hood)*slope;}
   else if(z<rear){top=h;}
   else {slope=-h*.38/(hl-rear);top=h+(z-rear)*slope;}
   // Reject underside entries: push sideways at the bumper instead of teleporting to roof.
   if(p[j+1]<base+.3){
    const side=hw+r-Math.abs(x),end=hl+r-Math.abs(z);
    const ox=side<end?side*(Math.sign(x)||1):0,oz=end<=side?end*(Math.sign(z)||-1):0;
    const wx=cs*ox+sn*oz,wz=-sn*ox+cs*oz;
    p[j]+=wx;p[j+2]+=wz;q[j]+=wx;q[j+2]+=wz;continue;
   }
   const penetration=base+top+r-p[j+1];
   if(penetration>0) {
    const e=penetration/(1+slope*slope);p[j+1]+=e;p[j]-=sn*slope*e;p[j+2]-=cs*slope*e;
    q[j+1]+=e;q[j]-=sn*slope*e;q[j+2]-=cs*slope*e;
    const vx=C.vx||0,vz=C.vz||0;
    q[j]+=(p[j]-q[j]-vx*STEP)*.015;q[j+2]+=(p[j+2]-q[j+2]-vz*STEP)*.015;
    // Remove inward normal velocity while preserving travel up the glass.
    const vy=p[j+1]-q[j+1],along=(p[j]-q[j])*sn+(p[j+2]-q[j+2])*cs,normal=vy-slope*along;
    if(normal<0){q[j+1]+=normal/(1+slope*slope);q[j]-=sn*slope*normal/(1+slope*slope);q[j+2]-=cs*slope*normal/(1+slope*slope);}
   }
  }
 }
 update(dt,ground) {
  if(!this.active)return;this.age+=Math.max(0,dt);
  if(this.age>=LIFE){this.active=false;return;}
  if(this.car?.veh) {
   const c=this.car,v=c.veh;c.x=v.x;c.y=v.y||0;c.z=v.z;c.yaw=v.yaw;
   c.vx=-Math.sin(v.yaw)*v.vLong+Math.cos(v.yaw)*(v.vLat||0);c.vz=-Math.cos(v.yaw)*v.vLong-Math.sin(v.yaw)*(v.vLat||0);
  }
  if(this.car&&Math.hypot(this.p[0]-this.car.x,this.p[2]-this.car.z)>(this.car.halfL||2.2)+3)this.car=null;
  if(this.sleeping)return;
  this.acc+=Math.min(.1,Math.max(0,dt));
  while(this.acc>=STEP){this.step(ground);this.acc-=STEP;}
 }
 get opacity(){return limit(LIFE-this.age,0,1);}
}
export class RagdollPool {
 constructor(){this.bodies=Array.from({length:RAGDOLL_CAP},()=>new Ragdoll());}
 spawn(o){let b=this.bodies.find(b=>!b.active);if(!b)b=this.bodies.reduce((a,b)=>a.age>b.age?a:b);return b.launch(o);}
 update(dt,ground){for(const b of this.bodies)b.update(dt,ground);}
 clear(){for(const b of this.bodies)b.active=false;}
}

/** A human's small share of contact momentum excites the existing suspension/bump hooks. */
export function pedestrianThump(vehicle, speed, dx = 0, dz = 0) {
 const dv = Math.min(Math.abs(vehicle.vLong), limit(speed * 70 / ((vehicle.m || 1200) + 70), .12, 1.6));
 vehicle.vLong -= Math.sign(vehicle.vLong) * dv;
 vehicle.bumpHit = Math.max(vehicle.bumpHit || 0, .3 + Math.min(.4, speed / 45));
 const side = Math.sign(dx * Math.cos(vehicle.yaw) - dz * Math.sin(vehicle.yaw));
 vehicle.bodyKick?.(-.06 - Math.min(.12, speed * .004), -.10 - Math.min(.2, speed * .008), side * .06);
 return dv;
}
