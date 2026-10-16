// Deterministic controlled surfaces; used by Node regressions AND browser evidence.
export const flatAirborneRoute = {
  GR:null,length:1e5,closed:false,frame:(s,o={})=>Object.assign(o,{tx:0,tz:-1,rx:1,rz:0,grade:0,bank:0}),
  point:(s,u)=>({x:u,y:0,z:-s}),project:(x,z)=>({s:-z,u:x}),edge:()=>900,medHalf:()=>0,div:()=>0,
  urban:()=>1,seaR:()=>Infinity,seaL:()=>Infinity,y:()=>0,surfaceY:()=>0,bank:()=>0,lin:()=>0,
};
export function scenarioVehicle(Vehicle,specs,name,Ground=null) {
  let route=flatAirborneRoute;
  if(name==='crest') {
    const y=s=>s<30?.15*s:s<50?4.5+.15*(s-30)-.0075*(s-30)**2:4.5;
    const grade=s=>s<30?.15:s<50?.15-.015*(s-30):0;
    route={...flatAirborneRoute,y,surfaceY:s=>y(s),frame:(s,o={})=>Object.assign(o,{tx:0,tz:-1,rx:1,rz:0,grade:grade(s),bank:0}),point:(s,u)=>({x:u,y:y(s),z:-s})};
    route.contactFrame=(s,u,o)=>route.frame(s,o);
  }
  const id=name==='bus'?'bus':'carrera',v=new Vehicle(specs.find(c=>c.id===id),route);
  v.roadZ=()=>0;v.reset(0,0,name==='crest'?38:name==='barrier'?150/3.6:70/3.6);v.steerAssist=0;
  if(Ground){
    const g=Object.assign(Object.create(Ground.prototype),{route,out:{},limits:()=>({min:-1e4,max:1e4}),walls:()=>null});
    g.at=(x,z,s,u,o={})=>Object.assign(o,{y:route.surfaceY(s,u),hump:0,surf:'asphalt',water:0});v.ground=g;
  }
  if(name==='barrier') {
    const a=Math.PI/4,nx=Math.sin(a),nz=Math.cos(a);
    if(v.ground)v.ground._hit(v,nx,nz,.01,v.a*.7,{kind:'wall'});
    else {
      const dv=v.vLong*nz*1.15,wx=nx*dv,wz=-v.vLong+nz*dv;v.vLong=-wz;v.vLat=wx;
      v.impactDynamics?.({dv,nx,nz,forward:v.a,right:-v.halfW*.7,height:.45});
    }
  }
  return v;
}
export function scenarioStep(v,name,i) {
  const input={throttle:0,brake:0,steer:0};
  if(name==='bus'||name==='sports')input.steer=i<12?0:i<36?1:i<72?-1:0;
  // The identical 12 cm kerb trip arrests 5 m/s of lateral motion during
  // the emergency lane reversal. This is a tripped rollover, not an invented
  // untripped flip below the stock bus tyres' lateral friction limit.
  if((name==='bus'||name==='sports')&&i===40) {
    if(v.impactDynamics)v.impactDynamics({dv:5,nx:-1,nz:0,forward:0,right:v.track/2,height:.12,kind:'kerb',yawSolved:true});
    else v.bodyKick(0,0,-.6); // legacy contact had only the damped spring kick
  }
  v.update(1/60,input);
}
export function runAirborneScenario(Vehicle,specs,name,Ground=null) {
  const v=scenarioVehicle(Vehicle,specs,name,Ground),trace=[];
  let maxAir=0,airTime=0,maxRoll=0,maxHeight=0,minY=Infinity,peakLanding=0;
  for(let i=0;i<480;i++) {
    scenarioStep(v,name,i);
    const q=v.rigid?.q,up=q?1-2*(q[0]**2+q[2]**2):Math.cos(v.pose.roll)*Math.cos(v.pose.pitch);
    maxRoll=Math.max(maxRoll,Math.acos(Math.max(-1,Math.min(1,up))));
    if(v.air){airTime+=1/60;maxAir=Math.max(maxAir,v.y-v.route.surfaceY(v.s,v.u));}
    maxHeight=Math.max(maxHeight,v.y-v.route.surfaceY(v.s,v.u));minY=Math.min(minY,v.y-v.route.surfaceY(v.s,v.u));peakLanding=Math.max(peakLanding,v.landingSpeed||0);
    if(i%3===0)trace.push({t:(i+1)/60,x:v.x,y:v.y,z:v.z,yaw:v.yaw,air:v.air,bodyDynamic:v.bodyDynamic,q:q?.slice(),pose:{...v.pose},vy:v.vy,roll:Math.acos(Math.max(-1,Math.min(1,up))),speed:v.speed,load:v.corners.map(c=>c.Fz)});
  }
  return {name,maxAir,airTime,maxRoll,maxHeight,minY,peakLanding,final:{y:v.y,vy:v.vy,speed:v.speed,air:v.air,bodyDynamic:v.bodyDynamic,pose:v.pose},trace};
}
