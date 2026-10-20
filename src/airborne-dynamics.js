// Free rigid body between contacts. Coordinates match Three: x right, y up, -z forward.
// Quaternion and world angular momentum avoid Euler clamps/gimbal locks during a roll.
const G = 9.81;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function rotate(q,v) {
  const t=cross(q,v).map(x=>2*x), u=cross(q,t);
  return v.map((x,i)=>x+q[3]*t[i]+u[i]);
}
const inverse = q => [-q[0],-q[1],-q[2],q[3]];
export function bodyQuaternion(yaw,pitch=0,roll=0) {
  const a=Math.sin(pitch/2),b=Math.cos(pitch/2),c=Math.sin(yaw/2),d=Math.cos(yaw/2),e=Math.sin(roll/2),f=Math.cos(roll/2);
  return [a*d*f+b*c*e,b*c*f-a*d*e,b*d*e-a*c*f,b*d*f+a*c*e];
}
export function worldVelocity(v) {
  return [-Math.sin(v.yaw)*v.vLong+Math.cos(v.yaw)*v.vLat,v.vy||0,-Math.cos(v.yaw)*v.vLong-Math.sin(v.yaw)*v.vLat];
}
function setVelocity(v,u) {
  v.vLong=-u[0]*Math.sin(v.yaw)-u[2]*Math.cos(v.yaw);
  v.vLat=u[0]*Math.cos(v.yaw)-u[2]*Math.sin(v.yaw); v.vy=u[1];
}
function inertia(v) { return [v.Iyy*v.m/v.mSpr,v.Iz,v.Ixx*v.m/v.mSpr+v.m*(v.spec.height||1.45)**2/12]; }
function invInertia(v,u) {
  const B=v.rigid,local=rotate(inverse(B.q),u),I=inertia(v);
  return rotate(B.q,local.map((x,i)=>x/I[i]));
}
function mechanicalEnergy(v) {
  const u=worldVelocity(v);
  return .5*v.m*dot(u,u)+.5*dot(v.rigid.L,angularVelocity(v))+v.m*G*v.rigid.cy;
}
export function angularVelocity(v) { return v.rigid ? invInertia(v,v.rigid.L) : [v.pose.pitchV||0,-v.w,v.pose.rollV||0]; }
export function startFlight(v,vertical=v.vy||0) {
  if(v.rigid)return;
  const p=v.pose,q=bodyQuaternion(v.yaw,Math.atan(v._supportGrade ?? v.contactFrame?.grade ?? v.grade ?? 0)+(p.pitch||0),Math.atan(v._supportBank ?? v.contactFrame?.bank ?? v.bank ?? 0)+(p.roll||0));
  const omega=[p.pitchV||0,-v.w,p.rollV||0],I=inertia(v);
  v.rigid={q,L:rotate(q,omega.map((x,i)=>x*I[i])),cy:v.y+(p.heave||0)+v.hcg,age:0,contact:false};
  v.bodyDynamic=true; v.air=1; v.vy=vertical+(p.heaveV||0); v.y=v.rigid.cy-v.hcg;
  Object.assign(p,{heave:0,pitch:0,roll:0,heaveV:0,pitchV:0,rollV:0});
  for(const c of v.corners){c.Fz=c.Fx=c.Fy=0;c.zu=-Math.min(.06,v.spec.droop||.06);}
}
// Apply a world impulse at a point relative to the CoM. Caller owns collision detection.
export function rigidImpulse(v,j,point) {
  startFlight(v);
  setVelocity(v,worldVelocity(v).map((x,i)=>x+j[i]/v.m));
  const torque=cross(point,j);v.rigid.L=v.rigid.L.map((x,i)=>x+torque[i]);
}
// Add the missing out-of-plane part after an existing horizontal collision solve.
// A kerb's or a tyre wall's rising face redirects part of a hard impact upward. A flat wall, a rail or another car's side does not:
// they add only a small hop (a bumper riding up a bumper), and the roll or pitch they cause comes from where the blow lands
// relative to the centre of mass, never from a lift made up for the purpose. The blow itself (yaw included) is solved by
// src/crash-contact.js; smooth glancing scrapes and parking knocks stay in the established contact model.
export function impactDynamics(v,{dv,nx,nz,forward=0,right=0,height=.45,kind='wall',lift=1,yawSolved=false}) {
  if(!(dv>2))return;
  const fx=-Math.sin(v.yaw),fz=-Math.cos(v.yaw),rx=Math.cos(v.yaw),rz=-Math.sin(v.yaw);
  const risen=kind==='kerb'||kind==='tyre';
  const ramp=kind==='kerb'?.34:kind==='tyre'?.07:kind==='car'?.025:.012;
  const up=risen?Math.max(0,dv-4)*ramp*lift:clamp((dv-6)*ramp*lift,0,.7);
  const point=[fx*forward+rx*right,height-v.hcg,fz*forward+rz*right];
  if(!v.rigid&&up<.35&&Math.abs(height-v.hcg)*dv<1.5){return;}
  startFlight(v);
  const j=[nx*dv*v.m,up*v.m,nz*dv*v.m];
  // Horizontal velocity was already solved by the caller. Transfer its moment,
  // retaining the yaw impulse when that caller has already solved yaw at contact.
  const torque=cross(point,j);if(yawSolved)torque[1]=0;
  // Bound added rotation/lift by the normal collision energy dissipated by
  // the planar solve. An off-centre hit must not manufacture kinetic energy.
  const invTorque=invInertia(v,torque),A=.5*dot(torque,invTorque),B=dot(v.rigid.L,invTorque);
  const budget=Math.max(0,(risen?.45:.1)*v.m*dv*dv-.5*v.m*(up*up+2*Math.max(0,v.vy)*up));
  const scale=A>0?Math.min(1,Math.max(0,(-B+Math.sqrt(Math.max(0,B*B+4*A*budget)))/(2*A))):1;
  v.rigid.L=v.rigid.L.map((x,i)=>x+scale*torque[i]);v.vy+=up;
}
function heightAt(v,x,z) {
  const p=v.route.project(x,z,v.s,6);
  return v.ground?.at ? v.ground.at(x,z,p.s,p.u,{}).y : v.route.surfaceY(p.s,p.u);
}
function landingDamage(v,speed,point=[0,-v.hcg,0]) {
  if(speed<=5)return;
  const zone=point[2]<=0?'front':'rear';
  v.addDamage?.(zone,(speed-5)*.8,{kind:'landing-impact',localPoint:{x:point[0],y:0,z:point[2]},localNormal:{x:0,y:1,z:0}});
  v.damageFx?.();
  if(v.cornerDamage)for(let i=0;i<4;i++)v.cornerDamage[i]=Math.min(1,v.cornerDamage[i]+Math.max(0,speed-7)**2*.002);
}
function finishFlight(v,y,grade,bank,slope,impact) {
  const B=v.rigid,q=B.q;
  const pitch=Math.asin(clamp(2*(q[3]*q[0]-q[1]*q[2]),-1,1));
  const roll=Math.atan2(2*(q[0]*q[1]+q[3]*q[2]),1-2*(q[0]*q[0]+q[2]*q[2]));
  const o=angularVelocity(v),local=rotate(inverse(q),o),S=v.sus;
  S.z=clamp(B.cy-v.hcg-y,-v.travel,.12);S.zv=clamp((v.vy-slope)*.65,-8,3);
  S.th=pitch-Math.atan(grade||0);S.ph=-(roll-Math.atan(bank||0));S.thv=local[0];S.phv=-local[2];
  for(let i=0;i<4;i++){S.zu[i]=S.r[i];S.zuv[i]=0;S.Ft[i]=0;}
  S.fresh=false; v.w=-o[1];v.rigid=null;v.bodyDynamic=false;v.air=0;v.y=y;v.vy=slope;
  Object.assign(v.pose,{heave:S.z,heaveV:S.zv,pitch:S.th,pitchV:S.thv,roll:-S.ph,rollV:-S.phv});
  v.landingSpeed=impact;v.bumpHit=Math.max(v.bumpHit,clamp(impact*.12,0,1));landingDamage(v,impact);v.syncWheels();
}
export function stepFlight(v,dt,y,grade=0,bank=0,slope=0) {
  const B=v.rigid;if(!B)return;
  const energyBefore=mechanicalEnergy(v);
  B.age+=dt;B.contact=false;
  v.vy-=G*dt; B.cy+=v.vy*dt;
  const vel=worldVelocity(v),omega=angularVelocity(v),q=B.q;
  const [x,yq,z,w]=q,[a,b,c]=omega;
  const next=[x+dt*.5*(a*w+b*z-c*yq),yq+dt*.5*(-a*z+b*w+c*x),z+dt*.5*(a*yq-b*x+c*w),w-dt*.5*(a*x+b*yq+c*z)];
  const len=Math.hypot(...next);B.q=next.map(n=>n/len);
  // Heading remains a horizontal velocity coordinate; reproject so tumbling
  // cannot rotate the translational momentum.
  v.yaw=Math.atan2(2*(B.q[0]*B.q[2]+B.q[3]*B.q[1]),1-2*(B.q[0]**2+B.q[1]**2));setVelocity(v,vel);
  const up=rotate(B.q,[0,1,0]),upright=up[1]>.88;
  const points=[];
  for(let i=0;i<4;i++)points.push([v.cy[i],-v.hcg,-v.cx[i]]);
  const top=(v.spec.height||1.45)-v.hcg;
  for(const xx of [-v.halfW*.92,v.halfW*.92])for(const zz of [-v.halfL*.88,v.halfL*.88])for(const yy of [Math.min(.2,v.hcg*.3)-v.hcg,top])points.push([xx,yy,zz]);
  // Contact positions and their terrain samples stay fixed during the impulse
  // iterations. Reuse them rather than projecting onto the road per solver pass.
  const samples=points.map((p,index)=>{const r=rotate(B.q,p);return {p,r,hull:index>=4,floor:heightAt(v,v.x+r[0],v.z+r[2])};});
  let lowest=Infinity;
  for(const {r,floor} of samples)lowest=Math.min(lowest,B.cy+r[1]-floor);
  const hitSpeed=Math.max(0,slope-v.vy);
  // A crushed, tumbling body must settle before the spring model takes over;
  // an early handoff otherwise restores rolling wheels in the middle of a scrape.
  if(lowest<=.015&&upright&&(!B.crushed||v.speed<.2&&up[1]>.99&&Math.hypot(omega[0],omega[2])<.5)&&hitSpeed>=0&&v.vy<=slope+.1&&Math.hypot(omega[0],omega[2])<2.2&&B.age>.02){finishFlight(v,y,grade,bank,slope,hitSpeed);return;}
  // Sequential impulses on the oriented hull, with positional projection only
  // for penetration. Sixteen passes resolve roof/side support without a road snap.
  let impact=0,deepest=0;
  const contacts=samples.filter(({r,floor})=>B.cy+r[1]-floor<=.008).map(sample=>{
    const cp=cross(angularVelocity(v),sample.r).map((x,i)=>x+worldVelocity(v)[i]);
    impact=Math.max(impact,-cp[1]);
    deepest=Math.max(deepest,sample.floor-B.cy-sample.r[1]);
    return {...sample,normal:0,tangent:[0,0,0],bounce:cp[1]<-2?-.12*cp[1]:0};
  });
  B.contact=contacts.length>0;
  for(let pass=0;pass<16;pass++)for(const c of contacts){
    const {r}=c,arm=cross(r,[0,1,0]),eff=1/v.m+dot(arm,invInertia(v,arm));
    const cp=cross(angularVelocity(v),r).map((x,i)=>x+worldVelocity(v)[i]);
    // Accumulated impulses can unwind as neighbouring contacts/friction change
    // the constraint. Repeated one-way impulses turn a tumbling corner into a pogo.
    const normal=Math.max(0,c.normal+(c.bounce-cp[1])/eff);
    rigidImpulse(v,[0,normal-c.normal,0],r);c.normal=normal;
    const slip=cross(angularVelocity(v),r).map((x,i)=>x+worldVelocity(v)[i]);
    const planar=Math.hypot(slip[0],slip[2]);
    if(planar>.000001){
      const tangent=[slip[0]/planar,0,slip[2]/planar],ta=cross(r,tangent),te=1/v.m+dot(ta,invInertia(v,ta));
      let next=c.tangent.map((x,i)=>x-tangent[i]*planar/te);
      const length=Math.hypot(...next),limit=(c.hull||!upright?.65:.55)*c.normal;
      if(length>limit)next=next.map(x=>x*limit/length);
      rigidImpulse(v,next.map((x,i)=>x-c.tangent[i]),r);c.tangent=next;
    }
  }
  // The substep cannot tunnel through the support plane, including on its roof.
  // A hard hull strike crushes the contact patch rather than vaulting a rigid
  // corner over asphalt. Dissipate the unresolved spin and bound
  // CoM rebound by the same low restitution as the contact normal. Wheel-edge
  // pivots remain free to roll a tall vehicle over.
  const hullImpact=contacts.length>0&&!upright&&impact>2&&vel[1]<-.5;
  if(hullImpact){
    B.crushed=true;
    const u=worldVelocity(v);u[1]=Math.min(u[1],.12*Math.max(0,-vel[1]));setVelocity(v,u);
    B.L=B.L.map(x=>x*.2);
  }
  B.cy+=deepest;
  if(B.contact){
    // Projection raises potential energy. Pay for it from the remaining kinetic
    // energy, including spin: a corner must not act as a powered launch ramp.
    const kinetic=.5*v.m*dot(worldVelocity(v),worldVelocity(v))+.5*dot(B.L,angularVelocity(v));
    const budget=Math.max(0,energyBefore-v.m*G*B.cy);
    if(kinetic>budget){const scale=Math.sqrt(budget/kinetic);setVelocity(v,worldVelocity(v).map(x=>x*scale));B.L=B.L.map(x=>x*scale);}
  }
  v.y=B.cy-v.hcg;v.yAir=v.y;v.air=B.contact?0:1;
  if(B.contact){v.bumpHit=Math.max(v.bumpHit,clamp(impact*.12,0,1));if(impact>v.landingSpeed+1||!v.landingSpeed){v.landingSpeed=impact;landingDamage(v,impact);} }
  else v.landingSpeed=0;
  v.w=-angularVelocity(v)[1];
}
// Called with the same support plane that Ground.resolve uses, on every surface.
export function bodyContact(v,dt,y,grade,bank) {
  const slope=grade*v.vLong+bank*v.vLat;
  if(!v.rigid){
    const c=v.contactFrame,acc=c?.verticalAcceleration||0;
    v._crestTime=acc< -G*1.04&&v.speed>6 ? (v._crestTime||0)+dt:0;
    const left=v.corners[0].Fz+v.corners[2].Fz,right=v.corners[1].Fz+v.corners[3].Fz;
    const moment=Math.abs(v.ayRaw)*v.hcg,limit=G*v.track/2;
    // The contact edge, not a spring-angle clamp, is the tipping fulcrum.
    // Roll momentum can carry a tall vehicle over even before static tipping.
    const rollEnergy=.5*inertia(v)[2]*v.sus.phv**2;
    const barrier=v.m*G*(Math.hypot(v.hcg,v.track/2)-v.hcg);
    const tip=v.speed>5&&Math.min(left,right)<v.m*G*.035&&
      (moment>limit*.92||rollEnergy>barrier*.65);
    if(v._crestTime>.02||v.sus.z>.1&&v.sus.zv>.5&&v.corners.every(c=>c.Fz<1)||tip){
      startFlight(v,Number.isFinite(v._supportY)?v.vy:slope);
      if(tip){
        const sign=Math.sign(v.ayRaw||v.sus.phv||1),pivot=rotate(v.rigid.q,[-sign*v.track/2,-v.hcg,0]);
        const excess=Math.max(0,Math.abs(v.ayRaw)*v.hcg-G*v.track/2);
        const torque=rotate(v.rigid.q,[0,0,-sign*v.m*(excess+G*v.hcg*.08)]);
        v.rigid.L=v.rigid.L.map((x,i)=>x+torque[i]*dt);
        v.rigid.cy=Math.max(v.rigid.cy,y-pivot[1]);
      }
    }
  }
  if(v.rigid)stepFlight(v,dt,y,grade,bank,slope);
  else {v.y=y;v.vy=slope;}
  v._supportY=y;v._supportGrade=grade;v._supportBank=bank;
}
export function placeRigid(v,obj,q=v.rigid?.q||v.bodyQ) {
  if(!q)return false;
  const offset=rotate(q,[0,v.hcg,0]);
  obj.position.set(v.x-offset[0],v.y+v.hcg-offset[1],v.z-offset[2]);obj.quaternion.set(...q);
  return true;
}

export function restoreRigidState(v,state) {
  if (state.bodyDynamic !== true || !Array.isArray(state.bodyQ) || state.bodyQ.length !== 4) return;
  const q=state.bodyQ.slice(),I=inertia(v),omega=[state.angularX||0,state.angularY||0,state.angularZ||0];
  v.rigid={q,L:rotate(q,rotate(inverse(q),omega).map((x,i)=>x*I[i])),cy:state.y+v.hcg,age:.1,contact:!state.air};
  v.bodyDynamic=true;v.air=state.air?1:0;v.vy=state.vy||0;
  Object.assign(v.pose,{heave:0,pitch:0,roll:0,heaveV:0,pitchV:0,rollV:0});
}
