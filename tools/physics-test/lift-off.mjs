// Matched, settled corner before a throttle lift. No velocity clamps after lift.
import './register.mjs';
import { CARS } from './driver-feel.mjs';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');
const route = { frame: (s,o) => Object.assign(o,{tx:0,tz:-1,rx:1,rz:0,grade:0,bank:0}), point:(s,u)=>({x:u,z:-s,y:0}), y:()=>0,surfaceY:()=>0,urban:()=>1,edge:()=>900,lin:()=>0,project:(x,z)=>({s:-z,u:x}) };
export function liftOff(spec, gear, { seconds = 1, declutch = false } = {}) {
  const v = new Vehicle(spec,route), dt=1/60, target=60/3.6;
  v.reset(0,0,target); v.manual=true; v.gear=2;
  let integral=.2;
  for(let i=0;i<360;i++) {
    const e=target-v.speed; integral=Math.max(0,Math.min(.5,integral+e*dt*.6));
    v.update(dt,{throttle:Math.max(0,Math.min(.5,integral+e*.5)),brake:0,steer:.9});
  }
  const sample=()=>({kmh:v.speed*3.6,rpm:v.rpm,torque:v.engT,frontLoad:v.wheel[0].Fz,rearLoad:v.wheel[1].Fz,ax:v.axRaw,yaw:v.w,beta:Math.atan2(v.vLat,v.vLong)*180/Math.PI,latch:v.driftLatch});
  v.gear=gear; v.rpm=Math.max(spec.idle,(v.wheel[0].vw*(1-v.shareR)+v.wheel[1].vw*v.shareR)/spec.wheelR*v.ratio()*30/Math.PI);
  const before=sample(), trace=[];
  // Disconnected driveline control: shifting removes engine torque, with
  // the same wheels/springs and road. This is a diagnostic, not gameplay input.
  if(declutch) {v.shiftT=seconds+1;v.pendingGear=0;}
  for(let i=0;i<seconds/dt;i++) {v.update(dt,{throttle:0,brake:0,steer:.9});trace.push(sample());}
  const window=trace.slice(6,30), avg=k=>window.reduce((s,r)=>s+r[k],0)/window.length;
  return {car:spec.id,gear,before,trace,mean:{ax:avg('ax'),torque:avg('torque'),frontLoad:avg('frontLoad'),rearLoad:avg('rearLoad'),yaw:avg('yaw'),beta:avg('beta')}};
}
if(process.argv[1]?.endsWith('/lift-off.mjs')) {
  for(const spec of CARS) { const gear=spec.gears.findIndex(g=>60/3.6/spec.wheelR*g*spec.final*30/Math.PI<spec.redline*.94)+1;
    for(const g of [gear,4]) {const r=liftOff(spec,g);console.log(spec.id,g,JSON.stringify({...r.mean,pre:r.before}));}
  }
}
